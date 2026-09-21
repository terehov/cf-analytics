/**
 * Der MCP-Server: die Daten aus Claude, ChatGPT und Copilot befragen.
 *
 * Plan: docs/plan-skybridge.md. Was hier steht, ist die Umsetzung der
 * Abschnitte 3 bis 6.
 *
 * ZEHN WERKZEUGE, NICHT 285. Jede Werkzeugbeschreibung kostet ein Modell
 * 300–600 Token, bevor die erste Frage gestellt ist; Cursor kappt bei 40,
 * Copilot bei 128, Claude Desktop um 100, und die Antwortqualitaet sinkt
 * messbar ab etwa 50. Die 285 Karten sind deshalb ein Werkzeug mit 285
 * Schluesseln, nicht 285 Werkzeuge.
 *
 * JEDES WERKZEUG MUSS OHNE SEINE ANSICHT BRAUCHBAR SEIN. In Copilot gibt es
 * keine gerenderte Ansicht; kaeme die Antwort nur dort an, waere der Server
 * dort wertlos. Deshalb steht das Ergebnis immer auch in
 * `structuredContent` — die Ansicht ist die Kuer, die Daten sind die Pflicht.
 * Was NUR die Ansicht bekommt (die Zeilen 501 bis 5.000), steht in `_meta`.
 */
import { Skybridge } from 'skybridge/server'
import { z } from 'zod'
import { parserBereitstellen } from './ast'
import { anmelden, fragenDuerfen, NichtErlaubt, type Angemeldet } from './auth'
import { abfrageAusfuehren, Abfragefehler, berichtAusfuehren, Gesperrt, probeplanen,
         protokollieren, ZEILEN_FUER_MODELL, type Nutzer } from './ausfuehren'
import { berichtBeschreiben, berichteSuchen, BerichtFehler, alleKarten, karteFinden,
         uebersetzen } from './berichte'
import { abfragen } from './db'
import { defekteSichten, gesundheitBeobachten, gesundheitGemessenAm, sichtlage,
         standLaden, unklareSichten } from './gesundheit'
import { katalogLaden } from './katalog_laden'
import type { Katalog } from './katalog'
import { pruefen } from './pruefen'
import { anmeldungMontieren, metadaten } from './anmeldung/endpunkte'
import { anmeldungAbfragen, anmeldungEingerichtet } from './anmeldung/db'
import { zugangstokenPruefen } from './anmeldung/schluessel'
import { gescheiterteAufrufeProtokollieren } from './zugriff_protokoll'
import { datenAlsTextErgaenzen } from './antwort_text'

/**
 * Die Form, in der JEDES Ergebnis zurueckkommt — Bericht wie freie Abfrage.
 *
 * Zwei Gruende, warum das ein gemeinsames Schema ist und nicht dreimal
 * dasselbe von Hand:
 *
 *   1. Die Ansicht `ergebnis` bedient beide Werkzeuge. Waeren ihre Antworten
 *      nur AEHNLICH, faellt der Unterschied erst im Chat auf, bei dem
 *      Werkzeug, das gerade seltener benutzt wird.
 *   2. Das Modell liest `outputSchema` mit. Es weiss damit vorher, dass eine
 *      Antwort `hinweise` und `datenstand` traegt — und dass es sie lesen
 *      soll, bevor es eine Zahl weitergibt.
 */
const ERGEBNIS_SCHEMA = {
  spalten: z.array(z.string()),
  zeilen: z.array(z.record(z.string(), z.any())),
  zeilen_gesamt: z.number(),
  koernung: z.array(z.object({ sicht: z.string(), koernung: z.string().nullable() })),
  hinweise: z.array(z.object({
    schluessel: z.string(),
    schwere: z.enum(['sperre', 'warnung']),
    hinweis: z.string(),
    berichtigung: z.string().nullish(),
    quelle: z.string().nullish(),
  })),
  datenstand: z.object({
    umsatz_bis: z.string().nullable(),
    bwa_bis: z.string().nullable(),
    betriebe: z.number(),
    umsatz_veraltet: z.number(),
    bwa_im_rueckstand: z.number(),
  }).nullable(),
  /** Je Spalte, was ein Modell fuer die Wahl der Darstellung wissen muss. */
  spalten_info: z.array(z.object({
    spalte: z.string(),
    rolle: z.enum(['zeit', 'merkmal', 'kennzahl', 'ampel', 'schluessel']),
    einheit: z.string().nullish(),
    verschieden: z.number(),
    spanne: z.tuple([z.number(), z.number()]).optional(),
    beispiele: z.array(z.string()).optional(),
    hinweis: z.string().optional(),
  })),
  /** Die Uebergabe an das Modell: die Form ist seine Entscheidung — und die Fallen dabei. */
  darstellung: z.string(),
}

const nutzerAus = (a: Angemeldet): Nutzer =>
  ({ subject: a.subject, anzeige: a.anzeige, client: a.client })

/**
 * Einen abgelehnten SQL-Lauf als gewoehnliche Antwort zurueckgeben.
 *
 * WARUM NICHT ALS WERKZEUGFEHLER. Skybridge macht aus einer Ausnahme `isError`,
 * und Claude zeigt dazu „Failed to load this connector" — der Nutzer sieht
 * weder SQLSTATE noch Meldung noch Berichtigung. Dieselbe Lehre wie bei der
 * Sperre am 16.09.2026, hier fuer den Fall, dass Postgres selbst ablehnt.
 *
 * WARUM AN DREI STELLEN UND NICHT NUR BEI `abfrage_ausfuehren`: die fertigen
 * Berichte laufen durch dieselbe Ausfuehrung. `kw_tagesliste` haengt an
 * mart.vergleichstag und war am 21.09.2026 genauso tot wie die freie Abfrage
 * darauf — ein Klickziel im Dashboard, das niemand mehr erreichte.
 *
 * Protokolliert ist der Fehler schon (ausfuehren.ts).
 */
function sqlFehlerAntwort(f: Abfragefehler, was: string) {
  return {
    structuredContent: {
      spalten: [], zeilen: [], zeilen_gesamt: 0,
      koernung: f.pruefung.koernung, hinweise: [f.befund], datenstand: null,
      spalten_info: [],
      darstellung: 'Nichts darzustellen — Postgres hat die Abfrage abgelehnt. Dem Nutzer die ' +
                   'Meldung nennen und danach berichtigen.',
    },
    content: `${was} ist nicht gelaufen.\n\n${f.message}`,
    _meta: { weitere: [], protokoll_id: null, sql_fehler: f.sqlstate },
  }
}

/** Startzeit des Prozesses — fuer /status. */
const GESTARTET = new Date().toISOString()

/**
 * Die Sichten, die ein Karten-SQL anspricht — fuer den Koernungs-Anhang.
 * Rein textlich und bewusst grosszuegig: es geht um Einordnung, nicht um
 * eine Pruefung, und eine Sicht zu viel schadet hier nicht.
 */
function sichtenImText(sql: string): string[] {
  return [...new Set([...sql.matchAll(/\bmart\.[a-z_0-9]+/g)].map(m => m[0]))]
}

export const app = new Skybridge({
  name: 'cf-analytics',
  title: 'Concept Family Analytics',
  version: '0.1.0',
  description:
    'Die Zahlen der Concept Family AG befragen: Round Table, Umsatz, Personal, Einkauf, ' +
    'Bewertungen, Schulung. Fertige Berichte und freie Abfragen auf der Auswertungsschicht.',

  /**
   * Was jeder Client als Anweisung fuer den ganzen Server bekommt.
   *
   * *Eugene, 13.09.2026:* die Darstellung entscheidet das Modell, nicht der
   * Server. Deshalb steht hier keine Formvorgabe, sondern die Uebergabe: die
   * Daten kommen aufbereitet (Zahlen als Zahlen, je Spalte Rolle und
   * Einheit, ein Hinweis auf die Fallen) — zeichnen tut, wer sie bekommt.
   */
  instructions:
    'Du sprichst mit der Auswertungsschicht der Concept Family AG (Gastronomie, 141 Betriebe, ' +
    'ein Dutzend Marken). ' +
    'DARSTELLUNG: Jede Antwort mit Daten traegt `spalten_info` (Rolle, Einheit, Wertevielfalt je ' +
    'Spalte) und `darstellung` (einen Hinweis mit den Fallen dieser Daten). Die Form ist DEINE ' +
    'Entscheidung — waehle sie und zeichne sie mit deinen eigenen Mitteln: Diagramm, Tabelle ' +
    'oder eine grosse Einzelzahl. Der Nutzer darf jederzeit eine andere Form verlangen; dann ' +
    'die vorliegenden Daten neu darstellen, nicht neu abfragen. ' +
    'ZAHLEN: Prozentwerte sind schon Prozent (23.64), nie mit 100 multiplizieren. Ampeln ' +
    '(rot/orange/gruen) zaehlen, nie mitteln. ' +
    'EHRLICHKEIT: `hinweise` und `datenstand` gehoeren zur Antwort — wer eine Zahl weitergibt, ' +
    'nennt, bis wann sie gilt und was an ihr unvollstaendig ist. Eine gesperrte Abfrage nicht ' +
    'umformulieren, sondern nach der genannten Berichtigung neu stellen.',

  /**
   * Einmal beim Start: Parser laden und den Katalog holen. `katalogLaden`
   * wirft, wenn mcp.fallstrick eine Regelart nennt, die dieser Server nicht
   * umsetzt — dann faehrt er gar nicht erst hoch. Ein Dienst mit halben
   * Wachen waere schlimmer als keiner.
   */
  setup: async () => {
    await parserBereitstellen()
    const katalog = await katalogLaden()
    const offen = await abfragen<{ punkt: string; meldung: string }>(
      `SELECT punkt, meldung FROM mcp.einrichtung_offen`)
    for (const o of offen) {
      console.warn(JSON.stringify({ t: new Date().toISOString(), stufe: 'warn',
        msg: 'Einrichtung offen', punkt: o.punkt, meldung: o.meldung }))
    }
    /**
     * Den Gesundheitsstand aus der Datenbank holen und den Lauf takten.
     *
     * DER STAND ZUERST, DER LAUF DANACH: der erste Nutzer nach einem Deploy
     * soll nicht auf 236 Proben warten, und die Momentaufnahme des letzten
     * Laufs ist dafuer gut genug — sie traegt ihren Zeitstempel, und der
     * Pruefer sperrt nur auf einer frischen Messung.
     *
     * Der Lauf selbst blockiert den Start NICHT (gesundheit.ts): ein Server,
     * der erst nach einer Minute lauscht, sieht fuer Dokploy aus wie einer,
     * der nicht hochkommt.
     */
    await standLaden()
    gesundheitBeobachten()
    console.log(JSON.stringify({ t: new Date().toISOString(), stufe: 'info',
      msg: 'Katalog geladen', sichten: katalog.sichten.size,
      mit_koernung: [...katalog.sichten.values()].filter(s => s.koernung).length,
      fallstricke: katalog.fallstricke.length, berichte: alleKarten.length,
      defekte_sichten: defekteSichten().size, unklare_sichten: unklareSichten().size,
      gesundheit_gemessen_am: gesundheitGemessenAm()?.toISOString() ?? null }))
    return { katalog }
  },

  /**
   * OAuth — von diesem Server selbst, ohne fremden Anbieter.
   *
   * *Eugene, 13.09.2026:* kein externer Identitaetsanbieter, Passwoerter in
   * Postgres. Bei drei Nutzern ist das die ehrlichere Groesse — und es
   * loest nebenbei das Problem, an dem Entra gescheitert waere: ChatGPT
   * meldet sich beim Verbinden per Dynamic Client Registration selbst an,
   * und Entra hat dafuer keinen Endpunkt. Hier sind es zwanzig Zeilen
   * (src/anmeldung/endpunkte.ts).
   *
   * KEIN `customProvider`, obwohl der Server jetzt sein eigener Aussteller
   * ist: der wuerde beim Start sein eigenes Discovery-Dokument ueber HTTP
   * abrufen — ein Server, der auf sich selbst wartet, bevor er lauscht. Die
   * Angaben stehen hier ohnehin fest, und der Pruefer arbeitet mit dem
   * Schluessel aus der Datenbank statt ueber einen Netzaufruf.
   */
  oauth: () => {
    const basis = (process.env.MCP_OEFFENTLICHE_URL ?? '').replace(/\/$/, '')
    if (!basis) {
      throw new Error(
        'MCP_OEFFENTLICHE_URL fehlt — z. B. https://mcp.example.de. Ohne die oeffentliche ' +
        'Adresse kann dieser Server weder Tokens ausstellen noch pruefen: sie ist Aussteller ' +
        'und Publikum zugleich.')
    }
    if (!anmeldungEingerichtet()) {
      throw new Error(
        'MCP_AUTH_DATABASE_URL fehlt. Die Anmeldung hat eine EIGENE Datenbankrolle ' +
        '(mcp_anmeldung) — bewusst getrennt von mcp_leser, unter der die Abfragen der Nutzer ' +
        'laufen. Sonst waere der Signierschluessel per SELECT abfragbar.')
    }

    return {
      baseUrl: basis,
      scopesSupported: ['mcp'],
      oauthMetadata: metadaten(basis),
      verifier: {
        /**
         * Ortlich geprueft, ohne Netzaufruf: der oeffentliche Schluessel
         * liegt in der Datenbank. Ein JWKS-Abruf gegen die eigene Adresse
         * waere ein Umweg ueber das Netz zu sich selbst.
         */
        async verifyAccessToken(token: string) {
          const { payload } = await zugangstokenPruefen(token, basis, basis)
          return {
            token,
            clientId: String(payload.client_id ?? ''),
            scopes: ['mcp'],
            expiresAt: payload.exp,
            extra: payload as Record<string, unknown>,
          }
        },
      },
    }
  },

  handler: (server, { katalog }: { katalog: Katalog }) => server

    // Jeder gescheiterte Aufruf steht im Protokoll — auch der, dessen
    // Werkzeug vor dem eigenen protokollieren() abbrach (zugriff_protokoll.ts).
    .mcpMiddleware('tools/call', gescheiterteAufrufeProtokollieren)

    // Die Daten auch als Text: Claudes Modell sieht structuredContent nicht
    // (16.09.2026), ChatGPTs schon — deshalb nur fuer Hosts ausser ChatGPT
    // (antwort_text.ts).
    .mcpMiddleware('tools/call', datenAlsTextErgaenzen)

    // =================================================================
    // Berichte — die Metabase-Abloesung
    // =================================================================
    .registerTool({
      name: 'berichte_suchen',
      title: 'Fertige Berichte finden',
      description:
        'Sucht unter den 285 fertigen Berichten (denselben, die auch die Dashboards im ' +
        'BI-Tool zeigen) nach Stichwort. Liefert Schluessel, Beschreibung und Parameter. ERST HIER ' +
        'SUCHEN, bevor eine eigene Abfrage geschrieben wird: ein fertiger Bericht ist von ' +
        'Menschen gebaut, die das Schema kennen, und gegen die Excel-Vorlage verifiziert.',
      inputSchema: { stichwort: z.string().describe('z. B. "round table", "umsatz marke", "personal"') },
      annotations: { readOnlyHint: true },
    }, async ({ stichwort }, extra) => {
      const nutzer = await anmelden(extra)
      const treffer = berichteSuchen(stichwort)
      await protokollieren({ nutzer: nutzerAus(nutzer), werkzeug: 'berichte_suchen',
        parameter: { stichwort }, zeilen: treffer.length })
      return {
        structuredContent: { treffer, gesamt: alleKarten.length },
        content: treffer.length
          ? `${treffer.length} Berichte gefunden.`
          : `Kein fertiger Bericht zu "${stichwort}". Mit sichten_suchen nach der passenden ` +
            `mart-Sicht sehen und die Frage selbst stellen.`,
      }
    })

    .registerTool({
      name: 'bericht_ausfuehren',
      title: 'Fertigen Bericht ausfuehren',
      description:
        'Fuehrt einen der fertigen Berichte aus — dieselbe Abfrage, die die Karte im BI-Tool ' +
        'zeigt, mit denselben Parametern. Der Schluessel kommt aus berichte_suchen. ' +
        'Parameter als Objekt, z. B. {"monat":"2026-07-01","marke":"Enchilada"}. Ein Zeitraum ' +
        'als {"von":"2026-01-01","bis":"2026-03-31"}. Die DARSTELLUNG des Ergebnisses ist deine ' +
        'Sache — `spalten_info` und `darstellung` in der Antwort helfen bei der Wahl.',
      inputSchema: {
        schluessel: z.string().describe('Schluessel des Berichts aus berichte_suchen'),
        parameter: z.record(z.string(), z.any()).optional()
          .describe('Parameterwerte; weglassen, was offen bleiben soll'),
      },
      outputSchema: ERGEBNIS_SCHEMA,
      annotations: { readOnlyHint: true },
      view: { component: 'bericht', description: 'Der Bericht als Tabelle' },
    }, async ({ schluessel, parameter }, extra) => {
      const nutzer = await anmelden(extra)
      const karte = karteFinden(schluessel)
      if (!karte) {
        const nah = berichteSuchen(schluessel, 5).map(b => b.schluessel)
        throw new BerichtFehler(
          `Kein Bericht mit dem Schluessel "${schluessel}".` +
          (nah.length ? ` Gemeint sein koennte: ${nah.join(', ')}.` : ' berichte_suchen hilft weiter.'))
      }
      const { sql, parameter: werte } = uebersetzen(karte, parameter ?? {})
      let e
      try {
        e = await berichtAusfuehren(schluessel, sql, werte, sichtenImText(karte.sql),
          katalog, nutzerAus(nutzer), parameter ?? {})
      } catch (f) {
        if (f instanceof Abfragefehler) return sqlFehlerAntwort(f, `Der Bericht "${karte.name}"`)
        throw f
      }
      return {
        structuredContent: {
          spalten: e.spalten, zeilen: e.zeilen, zeilen_gesamt: e.zeilen_gesamt,
          koernung: e.koernung, datenstand: e.datenstand, hinweise: e.hinweise,
          spalten_info: e.spalten_info, darstellung: e.darstellung,
        },
        content: `${karte.name}: ${e.zeilen_gesamt} Zeilen. Im BI-Tool steht dieser Bericht als ` +
                 `"${karte.anzeige}" — ein Hinweis, keine Vorgabe: waehle die Form selbst.`,
        _meta: { weitere: e.weitere, anzeige: karte.anzeige,
                 visualisierung: karte.visualisierung, bericht: berichtBeschreiben(karte) },
      }
    })

    // =================================================================
    // Katalog
    // =================================================================
    .registerTool({
      name: 'sichten_suchen',
      title: 'Auswertungssichten finden',
      description:
        'Sucht in der Auswertungsschicht `mart` nach Sichten. Liefert je Sicht, WOVON sie eine ' +
        'Zeile fuehrt (die Koernung) und was man mit ihr nicht tun darf. Der Einstieg fuer ' +
        'jede Frage, die kein fertiger Bericht abdeckt.',
      inputSchema: {
        stichwort: z.string().describe('z. B. "umsatz", "einkauf", "bewertung", "schulung"'),
      },
      annotations: { readOnlyHint: true },
    }, async ({ stichwort }, extra) => {
      const nutzer = await anmelden(extra)
      const w = stichwort.toLowerCase()
      /**
       * DEFEKTE SICHTEN WERDEN MITGELIEFERT, NICHT WEGGELASSEN.
       *
       * Eine Sicht, die es gibt und die gerade nicht laeuft, aus der Liste zu
       * nehmen waere die bequemere Antwort und die schlechtere: das Modell
       * suchte weiter, fiele auf eine Sicht mit anderer Koernung und lieferte
       * eine Zahl, die etwas anderes bedeutet. Am 21.09.2026 war das der
       * ganze Wettereinfluss — vier Sichten am Boden, und nichts sagte es.
       *
       * Also stehen sie drin, mit `defekt` und der Postgres-Meldung daneben.
       */
      const defekt = defekteSichten()
      const unklar = unklareSichten()
      const treffer = [...katalog.sichten.values()]
        .filter(s => s.sicht.includes(w) || (s.thema ?? '').includes(w)
                  || (s.koernung ?? '').toLowerCase().includes(w)
                  || (s.kommentar ?? '').toLowerCase().includes(w))
        .slice(0, 30)
        .map(s => ({
          sicht: s.sicht, thema: s.thema, koernung: s.koernung, achsen: s.achsen,
          defekt: defekt.has(s.sicht) || undefined,
          defekt_meldung: defekt.get(s.sicht)?.meldung.split('\n')[0],
          // Langsam, nicht kaputt: in der Probe kam in 5 s keine Zeile.
          langsam: unklar.has(s.sicht) || undefined,
        }))
      const kaputt = treffer.filter(t => t.defekt).map(t => t.sicht)
      const langsam = treffer.filter(t => t.langsam).map(t => t.sicht)
      await protokollieren({ nutzer: nutzerAus(nutzer), werkzeug: 'sichten_suchen',
        parameter: { stichwort }, zeilen: treffer.length })
      return {
        structuredContent: { treffer, defekt: kaputt },
        content: `${treffer.length} Sichten zu "${stichwort}".` + (kaputt.length
          ? ` ACHTUNG, ${kaputt.length} davon laufen derzeit NICHT: ${kaputt.join(', ')}. ` +
            `Eine Abfrage darauf scheitert; was fehlt, dem Nutzer sagen statt auf eine Sicht ` +
            `mit anderer Bedeutung auszuweichen.`
          : '') + (langsam.length
          ? ` ${langsam.length} davon sind LANGSAM (in der Probe keine Zeile in 5 s): ` +
            `${langsam.join(', ')}. Nur mit engem Zeitraum abfragen.`
          : ''),
      }
    })

    .registerTool({
      name: 'sicht_beschreiben',
      title: 'Eine Sicht im Einzelnen',
      description:
        'Alles zu einer mart-Sicht: Koernung, Spalten, Achsen (worueber sie mit anderen ' +
        'Sichten zusammenfindet), welche Spalte wie aggregiert werden darf, die Fallstricke, ' +
        'und BEISPIELABFRAGEN aus den fertigen Berichten, die diese Sicht benutzen. VOR jeder ' +
        'eigenen Abfrage aufrufen.',
      inputSchema: { sicht: z.string().describe('z. B. "mart.umsatz_tag"') },
      annotations: { readOnlyHint: true },
    }, async ({ sicht }, extra) => {
      const nutzer = await anmelden(extra)
      const name = sicht.includes('.') ? sicht : `mart.${sicht}`
      const s = katalog.sichten.get(name)
      if (!s) {
        const nah = [...katalog.sichten.keys()].filter(k => k.includes(name.split('.').pop()!)).slice(0, 5)
        throw new Error(`${name} steht nicht im Katalog.` +
          (nah.length ? ` Gemeint sein koennte: ${nah.join(', ')}.` : ''))
      }
      /**
       * Die Berichte, die diese Sicht benutzen, als Beispiele. Fuer ein
       * Modell ist eine Abfrage der Betreuer mehr wert als eine
       * Beschreibung: sie zeigt, WIE man die Sicht richtig fragt —
       * einschliesslich der Filter und Mediane, ohne die die Zahl nichts
       * bedeutet.
       */
      const beispiele = alleKarten
        .filter(k => k.sql.includes(name))
        .slice(0, 3)
        .map(k => ({ schluessel: k.schluessel, name: k.name, sql: k.sql.trim() }))

      const fallstricke = katalog.fallstricke
        .filter(f => f.sicht === name || f.sicht === null)
        .map(f => ({ schwere: f.schwere, hinweis: f.hinweis, berichtigung: f.berichtigung }))

      await protokollieren({ nutzer: nutzerAus(nutzer), werkzeug: 'sicht_beschreiben',
        parameter: { sicht: name }, sichten: [name] })
      return {
        structuredContent: {
          sicht: s.sicht, koernung: s.koernung, thema: s.thema,
          summen_erlaubt: s.summen_erlaubt, kommentar: s.kommentar,
          spalten: s.spalten, achsen: s.achsen, kennzahlen: s.kennzahlen,
          fallstricke, beispiele,
        },
        content: s.koernung
          ? `${s.sicht} — eine Zeile je ${s.koernung}`
          : `${s.sicht} — die Koernung ist NICHT hinterlegt. Eine Summe darueber laesst sich ` +
            `nicht pruefen; vorsichtig sein.`,
      }
    })

    .registerTool({
      name: 'achsen_zeigen',
      title: 'Worueber Sichten zusammenfinden',
      description:
        'Zeigt die Achsen einer Sicht, oder — mit zwei Sichten — worueber genau die beiden ' +
        'verbunden werden duerfen. IMMER VOR EINEM JOIN aufrufen: ueber den Betriebsnamen zu ' +
        'verbinden ist hier falsch, fuenf Betriebe heissen "Karlsruhe".',
      inputSchema: {
        sicht: z.string(),
        andere: z.string().optional().describe('Zweite Sicht, wenn es um eine Verbindung geht'),
      },
      annotations: { readOnlyHint: true },
    }, async ({ sicht, andere }, extra) => {
      const nutzer = await anmelden(extra)
      const voll = (n: string) => (n.includes('.') ? n : `mart.${n}`)
      const a = katalog.sichten.get(voll(sicht))
      if (!a) throw new Error(`${voll(sicht)} steht nicht im Katalog.`)
      const beschreiben = (namen: string[]) => namen.map(n => {
        const ach = katalog.achsen.get(n)
        return { achse: n, bezeichnung: ach?.bezeichnung, hinweis: ach?.hinweis,
                 dimension: ach?.ziel_sicht, anzeige: ach?.anzeige_spalte }
      })
      if (!andere) {
        await protokollieren({ nutzer: nutzerAus(nutzer), werkzeug: 'achsen_zeigen',
          parameter: { sicht }, zeilen: a.achsen.length })
        return {
          structuredContent: { sicht: a.sicht, achsen: beschreiben(a.achsen) },
          content: `${a.sicht} traegt: ${a.achsen.join(', ') || '(keine bekannte Achse)'}`,
        }
      }
      const b = katalog.sichten.get(voll(andere))
      if (!b) throw new Error(`${voll(andere)} steht nicht im Katalog.`)
      const gemeinsam = a.achsen.filter(x => b.achsen.includes(x))
      await protokollieren({ nutzer: nutzerAus(nutzer), werkzeug: 'achsen_zeigen',
        parameter: { sicht, andere }, zeilen: gemeinsam.length })
      return {
        structuredContent: {
          a: a.sicht, b: b.sicht, gemeinsam: beschreiben(gemeinsam),
          koernung: { [a.sicht]: a.koernung, [b.sicht]: b.koernung },
        },
        content: gemeinsam.length
          ? `Gemeinsame Achsen: ${gemeinsam.join(', ')}. Ueber diese verbinden, ueber keine andere.`
          : `${a.sicht} und ${b.sicht} haben KEINE gemeinsame Achse. Ein Join waere geraten — ` +
            `vermutlich braucht es eine dritte Sicht dazwischen.`,
      }
    })

    .registerTool({
      name: 'betriebe_suchen',
      title: 'Betrieb finden',
      description:
        'Loest einen Betriebsnamen in seinen Schluessel auf, mit Marke und Datenstand daneben. ' +
        'NOETIG, WEIL DER NAME NICHT EINDEUTIG IST: fuenf Betriebe heissen "Karlsruhe". In ' +
        'jeder Abfrage betrieb_key verwenden, nie den Namen.',
      inputSchema: { text: z.string().describe('Teil des Namens, z. B. "bayreuth"') },
      annotations: { readOnlyHint: true },
    }, async ({ text }, extra) => {
      const nutzer = await anmelden(extra)
      const zeilen = await abfragen(`
        SELECT d.betrieb_key, d.betrieb, d.konzept, d.letzter_tag::text AS umsatz_bis,
               d.bwa_monat::text AS bwa_bis, d.befund
          FROM mart.datenstand d
         WHERE d.betrieb ILIKE '%' || $1 || '%' OR d.konzept ILIKE '%' || $1 || '%'
         ORDER BY d.konzept, d.betrieb
         LIMIT 50`, [text])
      await protokollieren({ nutzer: nutzerAus(nutzer), werkzeug: 'betriebe_suchen',
        parameter: { text }, zeilen: zeilen.length })
      return {
        structuredContent: { treffer: zeilen },
        content: zeilen.length > 1
          ? `${zeilen.length} Treffer — der Name allein genuegt nicht, betrieb_key verwenden.`
          : `${zeilen.length} Treffer.`,
      }
    })

    .registerTool({
      name: 'datenstand',
      title: 'Was ueberhaupt beurteilbar ist',
      description:
        'Bis wann Umsatz geladen und bis wann die BWA gebucht ist. VOR JEDER AUSWERTUNG: LINA ' +
        'liefert 5–6 Tage nach, und der BWA-Stand ist je Betrieb ein anderer. Eine Julizahl ' +
        'fuer einen Betrieb, dessen BWA bei Mai steht, ist keine Julizahl. ' +
        'OHNE PARAMETER: die Uebersicht nach Befund (wie viele Betriebe vollstaendig sind, wie ' +
        'viele ohne BWA, wie viele ohne Artikeldaten) UND dazu jeder Betrieb, der NICHT ' +
        'vollstaendig ist, einzeln — die vollstaendigen bleiben ungenannt, sonst waeren es 141 ' +
        'Zeilen ohne Aussage. MIT NAMEN: die Zeile dieses Betriebs, gleich ob vollstaendig ' +
        'oder nicht.',
      inputSchema: {
        betrieb: z.string().optional().describe(
          'Name oder Teil davon. Leer = Uebersicht nach Befund plus die Betriebe mit Rueckstand'),
      },
      annotations: { readOnlyHint: true },
    }, async ({ betrieb }, extra) => {
      const nutzer = await anmelden(extra)
      const start = Date.now()
      const JE_BETRIEB = `SELECT betrieb, konzept, letzter_tag::text, umsatz_alter_tage,
                                 bwa_monat::text, bwa_verzug_monate, befund
                            FROM mart.datenstand`
      /**
       * OHNE PARAMETER KAMEN BIS ZUM 21.09.2026 DREI ZEILEN ZURUECK — und die
       * Beschreibung des Parameters sagte "leer = alle". Beides stimmte nicht
       * zusammen: wer "alle" liest und "vollstaendig 75, keine BWA 36, keine
       * Artikeldaten 30" bekommt, muss raten, WELCHE 36 das sind, und fragt
       * dann Betrieb fuer Betrieb nach.
       *
       * Die Auskunft, die fehlte, ist nicht die Liste aller 141 Betriebe — die
       * Uebersicht gibt es gerade deshalb —, sondern die Liste der
       * auffaelligen. Also beides in einer Antwort: die Uebersicht als
       * Einordnung, die Betriebe mit Rueckstand namentlich. Die vollstaendigen
       * bleiben weg; ueber die ist nichts zu sagen.
       */
      const zeilen = betrieb
        ? await abfragen(`${JE_BETRIEB} WHERE betrieb ILIKE '%'||$1||'%'
                           ORDER BY betrieb LIMIT 200`, [betrieb])
        : await abfragen(`SELECT befund, count(*)::int AS betriebe,
                                 max(letzter_tag)::text AS umsatz_bis, max(bwa_monat)::text AS bwa_bis
                            FROM mart.datenstand GROUP BY befund ORDER BY 2 DESC`)
      const rueckstand = betrieb ? [] : await abfragen(
        `${JE_BETRIEB} WHERE befund <> 'vollstaendig'
          ORDER BY bwa_verzug_monate DESC NULLS LAST, umsatz_alter_tage DESC NULLS LAST,
                   betrieb LIMIT 200`)
      // Mit Dauer: am 15.09.2026 lief genau diese Abfrage in die 20-s-Grenze,
      // und niemand konnte hinterher sagen, wie lange sie sonst braucht.
      await protokollieren({ nutzer: nutzerAus(nutzer), werkzeug: 'datenstand',
        parameter: { betrieb }, zeilen: zeilen.length + rueckstand.length,
        dauer_ms: Date.now() - start })
      return {
        structuredContent: betrieb
          ? { zeilen }
          : { zeilen, uebersicht: zeilen, betriebe_mit_rueckstand: rueckstand },
        content: betrieb
          ? `${zeilen.length} Zeilen.`
          : `${zeilen.length} Befunde, dazu ${rueckstand.length} Betriebe mit Rueckstand ` +
            `namentlich. Die vollstaendigen sind nicht aufgefuehrt.`,
      }
    })

    // =================================================================
    // Freies Fragen
    // =================================================================
    .registerTool({
      name: 'abfrage_pruefen',
      title: 'Eine Abfrage pruefen, ohne sie auszufuehren',
      description:
        'Prueft SQL gegen den semantischen Katalog UND gegen die Datenbank, OHNE es laufen zu ' +
        'lassen: welche Sichten, welche Koernung, welche Fallstricke, was gesperrt waere — und ' +
        'ob Postgres die Abfrage ueberhaupt planen kann (EXPLAIN ohne ANALYZE, es wird nichts ' +
        'ausgefuehrt). Ein Tippfehler in einem Spaltennamen und eine defekte Sicht fallen damit ' +
        'hier auf und nicht erst beim Ausfuehren. Vor einer grossen oder unsicheren Abfrage ' +
        'aufrufen — abfrage_ausfuehren prueft dasselbe noch einmal selbst.',
      inputSchema: { sql: z.string() },
      annotations: { readOnlyHint: true },
    }, async ({ sql }, extra) => {
      const nutzer = await anmelden(extra)
      fragenDuerfen(nutzer)
      const e = pruefen(sql, katalog, sichtlage())

      /**
       * DIE ZWEITE HAELFTE DER PRUEFUNG, seit dem 21.09.2026.
       *
       * Bis dahin war dieses Werkzeug rein katalogbasiert und hat fuer SQL
       * auf mart.vergleichstag und mart.betrieb_wetter_tag "Laeuft, mit 1
       * Hinweis(en)" gemeldet — beide Sichten waren unlesbar. Der Katalog
       * kennt die Bedeutung, nicht den Zustand. Also fragt der Pruefer jetzt
       * auch Postgres: `EXPLAIN` plant, fuehrt nichts aus und faellt genau
       * dort um, wo ein Spaltenname falsch ist, eine Sicht fehlt oder ein
       * Funktionsrumpf in ein gesperrtes Schema greift.
       *
       * NUR, WENN DER KATALOG NICHTS GESPERRT HAT: gesperrtes SQL geht hier
       * gar nicht bis zur Datenbank — das ist die Reihenfolge, die
       * abfrage_ausfuehren auch einhaelt.
       *
       * `erlaubt` heisst danach: WUERDE LAUFEN — Katalog UND Postgres sagen ja.
       * Was Postgres allein sagt, steht zusaetzlich in `laeuft`. Die erste
       * Fassung liess `erlaubt` auf true stehen und haengte den Planungsfehler
       * nur als Befund an; ein Client, der allein `erlaubt` liest, haette dann
       * eine Sperre neben einem Ja gesehen.
       */
      const probe = e.erlaubt ? await probeplanen(sql) : null
      if (probe && !probe.laeuft) {
        e.erlaubt = false
        e.befunde.push({
          schluessel: `plan_fehler_${probe.sqlstate ?? 'unbekannt'}`,
          schwere: 'sperre',
          hinweis: `Postgres kann diese Abfrage nicht planen — sie wuerde nicht laufen.\n${probe.meldung}`,
          berichtigung:
            'Nach dieser Meldung berichtigen. sicht_beschreiben nennt die Spalten der ' +
            'beteiligten Sichten; steht eine davon in mart.sicht_defekt, ist die Sicht selbst ' +
            'kaputt und keine Abfrage darauf laeuft.',
        })
      }

      const ergebnis = {
        ...e,
        laeuft: probe === null ? null : probe.laeuft,
        geschaetzte_zeilen: probe?.geschaetzte_zeilen ?? null,
      }
      await protokollieren({ nutzer: nutzerAus(nutzer), werkzeug: 'abfrage_pruefen', sql,
        sichten: e.sichten, hinweise: e.befunde,
        gesperrt: !e.erlaubt || probe?.laeuft === false })
      return {
        structuredContent: ergebnis,
        content: probe && !probe.laeuft
          ? `LAEUFT NICHT — Postgres lehnt schon die Planung ab:\n${probe.meldung}`
          : !e.erlaubt
          ? `GESPERRT: ${e.befunde.filter(b => b.schwere === 'sperre').map(b => b.hinweis).join(' ')}`
          : e.befunde.length
            ? `Laeuft (von Postgres geplant), mit ${e.befunde.length} Hinweis(en).`
            : 'Keine Beanstandung, und Postgres kann sie planen.',
      }
    })

    .registerTool({
      name: 'abfrage_ausfuehren',
      title: 'Eigene Abfrage ausfuehren',
      description:
        'Fuehrt eigenes SQL auf der Auswertungsschicht aus (mart, manual, ampel — nur lesend). ' +
        'Fuer alles, was kein fertiger Bericht abdeckt: beliebige Gruppierung, beliebige ' +
        'Verbindung. Die Antwort traegt die Fallstricke der beruehrten Sichten und den ' +
        'Datenstand bei sich. Eine Abfrage mit einer bekannten Falle wird NICHT ausgefuehrt — ' +
        'die Meldung nennt den Grund und meist die Berichtigung. ' +
        'VORHER sicht_beschreiben und achsen_zeigen benutzen; hoechstens ' +
        `${ZEILEN_FUER_MODELL} Zeilen kommen zurueck, also im SQL zusammenfassen. Die DARSTELLUNG ` +
        'des Ergebnisses ist deine Sache — `spalten_info` und `darstellung` helfen bei der Wahl, ' +
        'und der Nutzer darf jede andere Form verlangen.',
      inputSchema: { sql: z.string().describe('Ein einzelnes SELECT (WITH erlaubt)') },
      outputSchema: ERGEBNIS_SCHEMA,
      annotations: { readOnlyHint: true },
      view: { component: 'ergebnis', description: 'Das Ergebnis als Tabelle' },
    }, async ({ sql }, extra) => {
      const nutzer = await anmelden(extra)
      fragenDuerfen(nutzer)
      let e
      try {
        e = await abfrageAusfuehren(sql, katalog, nutzerAus(nutzer))
      } catch (f) {
        /**
         * EIN SQL-FEHLER IST AUCH EINE ANTWORT — mit der Meldung darin.
         *
         * BEFUND 21.09.2026: zurueck kam nur "current transaction is aborted"
         * (SQLSTATE 25P02), und zwar bei JEDEM Fehler gleich — ein Tippfehler
         * in einem Spaltennamen sah aus wie eine defekte Sicht. Die Ursache
         * lag in ausfuehren.ts (das EXPLAIN brach die Transaktion ab, sein
         * Fehler wurde verschluckt) und ist dort behoben; hier geht es um das,
         * was beim Nutzer ankommt.
         *
         * Als gewoehnliche Antwort und nicht als Werkzeugfehler, aus demselben
         * Grund wie bei der Sperre (16.09.2026): Skybridge macht aus einer
         * Ausnahme isError, und Claude zeigt dazu "Failed to load this
         * connector" — der Nutzer sieht dann weder SQLSTATE noch Meldung noch
         * Berichtigung. Protokolliert ist der Fehler schon (ausfuehren.ts).
         */
        if (f instanceof Abfragefehler) return sqlFehlerAntwort(f, 'Die Abfrage')
        if (!(f instanceof Gesperrt)) throw f
        /**
         * EINE SPERRE IST EINE ANTWORT, KEIN FEHLER. Bis zum 16.09.2026 lief
         * sie als Ausnahme durch, Skybridge machte daraus isError — und Claude
         * zeigte dem Nutzer dazu einen roten Kasten „Failed to load this
         * connector", obwohl der Server genau das getan hatte, wofuer es den
         * Pruefer gibt. Deshalb hier eine gewoehnliche Antwort in der Form des
         * Ergebnisses: keine Zeilen, die Befunde als `hinweise` (die Ansicht
         * zeigt sie als Sperre), der ganze Text fuer das Modell.
         * Protokolliert ist die Sperre schon (abfrageAusfuehren).
         */
        return {
          structuredContent: {
            spalten: [], zeilen: [], zeilen_gesamt: 0,
            koernung: f.pruefung.koernung, hinweise: f.pruefung.befunde, datenstand: null,
            spalten_info: [],
            darstellung: 'Nichts darzustellen — die Abfrage wurde nicht ausgefuehrt. Dem Nutzer ' +
                         'den Grund und die Berichtigung nennen, dann berichtigt neu stellen.',
          },
          content: f.message,
          _meta: { weitere: [], protokoll_id: null, gesperrt: true },
        }
      }
      return {
        structuredContent: {
          spalten: e.spalten, zeilen: e.zeilen, zeilen_gesamt: e.zeilen_gesamt,
          koernung: e.koernung, hinweise: e.hinweise, datenstand: e.datenstand,
          spalten_info: e.spalten_info, darstellung: e.darstellung,
        },
        content: `${e.zeilen_gesamt} Zeilen in ${e.dauer_ms} ms.`,
        _meta: { weitere: e.weitere, protokoll_id: e.protokoll_id },
      }
    })

    // =================================================================
    // Die eine Ansicht, die Text nicht kann
    // =================================================================
    .registerTool({
      name: 'round_table',
      title: 'Der Round Table',
      description:
        'Das Ampelraster fuer einen Monat: je Betrieb Umsatz, Personal, Wareneinsatz Bar und ' +
        'Kueche, Bewertung, OM — bewertet mit dem Standardregelwerk. Die Frage, mit der jeder ' +
        'anfaengt. Ohne Monat der juengste abgeschlossene.',
      inputSchema: {
        monat: z.string().optional().describe('Monatserster, z. B. "2026-07-01"'),
        marke: z.string().optional().describe('Auf eine Marke einschraenken'),
      },
      outputSchema: ERGEBNIS_SCHEMA,
      annotations: { readOnlyHint: true },
      view: { component: 'round-table', description: 'Das Ampelraster' },
    }, async ({ monat, marke }, extra) => {
      const nutzer = await anmelden(extra)
      const karte = karteFinden('dd_filialen_tabelle') ?? karteFinden('rt_eingabe')
        ?? alleKarten.find(k => k.sql.includes('mart.round_table_monat'))!
      const { sql, parameter: werte } = uebersetzen(karte, { monat, marke })
      let e
      try {
        e = await berichtAusfuehren(karte.schluessel, sql, werte,
          ['mart.round_table_monat'], katalog, nutzerAus(nutzer), { monat, marke })
      } catch (f) {
        if (f instanceof Abfragefehler) return sqlFehlerAntwort(f, 'Der Round Table')
        throw f
      }
      return {
        structuredContent: {
          spalten: e.spalten, zeilen: e.zeilen, zeilen_gesamt: e.zeilen_gesamt,
          koernung: e.koernung, datenstand: e.datenstand, hinweise: e.hinweise,
          spalten_info: e.spalten_info, darstellung: e.darstellung,
        },
        content: `Round Table: ${e.zeilen_gesamt} Betriebe.`,
        _meta: { weitere: e.weitere },
      }
    }),
})

export type AppType = typeof app

/**
 * Fehler so zurueckgeben, dass ein Modell damit weiterarbeiten kann.
 *
 * Eine Sperre ist keine Panne, sondern eine Antwort: sie nennt den Grund und
 * — wo es einen gibt — den berichtigten Weg. Genau darin besteht der
 * Unterschied zwischen einer Verweigerung und einer falschen Zahl.
 */
/**
 * Der Autorisierungsserver: /authorize, /anmelden, /token, /register, /jwks.
 *
 * Vor `run()` montiert — danach haengt Skybridge seine eigenen Routen und
 * die Fehlerbehandlung an, und eine spaeter registrierte Route kaeme nicht
 * mehr davor.
 */
{
  const basis = (process.env.MCP_OEFFENTLICHE_URL ?? '').replace(/\/$/, '')
  if (basis) anmeldungMontieren(app.express, { aussteller: basis, publikum: basis })
}

/**
 * Keine eigene Fehlerbehandlung fuer Werkzeugfehler: Skybridge macht aus
 * einer Ausnahme im Handler eine Werkzeugantwort mit isError — und genau
 * die Nachricht liest das Modell. Gesperrt.message traegt deshalb den
 * ganzen Befund (ausfuehren.ts, gesperrtText). Ein Express-Middleware dafuer
 * stand hier bis zum Review vom 13.09.2026 und war tot: kein Werkzeugfehler
 * erreicht es je.
 */

app.express.get('/status', async (_req: any, antwort: any) => {
  try {
    const [offen, nutzung] = await Promise.all([
      abfragen(`SELECT punkt, meldung, behebung FROM mcp.einrichtung_offen`),
      abfragen(`SELECT coalesce(sum(aufrufe), 0)::int AS aufrufe_7t
                  FROM mart.mcp_nutzung WHERE tag > current_date - 7`),
    ])
    // Die Anmeldung laeuft auf der ZWEITEN Verbindung; ihr Zustand gehoert
    // in dieselbe Antwort, sonst prueft der Monitor nur die halbe Miete.
    const [anmeldung] = await anmeldungAbfragen<{ nutzer: number; gescheitert_24h: number }>(
      `SELECT (SELECT count(*)::int FROM mcp.nutzer WHERE aktiv)              AS nutzer,
              (SELECT count(*)::int FROM mcp.anmeldung_protokoll
                WHERE NOT erfolg AND zeitpunkt > now() - interval '24 hours') AS gescheitert_24h`)
    const stufe = offen.length ? 'stoerung' : 'ok'
    // `gestartet`: seit wann DIESER Container laeuft. Nach einem Push die
    // einzige Auskunft von aussen, ob der neue Stand schon antwortet.
    antwort.status(stufe === 'ok' ? 200 : 503).json({
      status: stufe, gestartet: GESTARTET, einrichtung_offen: offen, ...nutzung[0], ...anmeldung })
  } catch (e) {
    antwort.status(503).json({ status: 'stoerung', fehler: String(e).slice(0, 300) })
  }
})
