/**
 * Belegkorpus ziehen — die PDFs und die darin eingebetteten E-Rechnungs-XML.
 *
 * ZWECK: Beispieldaten für die Matching-Pipeline des PIM (brain.food). Das ist
 * KEIN Teil des nächtlichen Laufs und wird nie eingereiht. Es ist ein
 * beaufsichtigter Einzelabzug: jemand startet ihn, sieht zu und bricht ab,
 * wenn etwas anders aussieht als erwartet.
 *
 * WARUM ES EIN BEFEHL ZUM SELBERSTARTEN IST — AGENTS.md Regel 7a: LINA weist
 * die Anmeldung aus dem Netzweg der Agentenumgebung ab, mit der irreführenden
 * Meldung „Benutzername oder Passwort ist falsch!". Derselbe Befehl im
 * Terminal des Nutzers meldet sich beim ersten Versuch an. Dieselbe Bauform
 * wie `src/messen.ts`.
 *
 * WEG A, NICHT WEG B. Weg B (`/finanzen/document/filelistByBelegart`) liefert
 * `lineItems` und `is_xrechnung` fertig strukturiert — das wären Labels frei
 * Haus. Er hängt aber am aktiven Mandanten, und ein Mandantenwechsel ist
 * ausgeschlossen: unser Zugang steht auf CONCEPT FAMILY Franchise AG und
 * bleibt dort (Entscheidung Eugene, 13.08.2026). Bleibt Weg A — die Ladenakte
 * mit `admin=1`, dieselbe Tür, durch die der Importer täglich geht.
 *
 * WAS AN DIE STELLE DER LABELS TRITT. Der Kopf jedes Belegs liegt schon in
 * `core.buchungsbeleg`: Lieferant, Netto, MwSt-Aufteilung, Kreditor, Sachkonto,
 * Belegdatum, DATEV-GUID, Bar/Küche-Zuordnung. Der geht als `manifest.jsonl`
 * mit und ist die Kopfebene zum Abgleich. Positionen gibt es nur dort, wo eine
 * E-Rechnung im PDF steckt — die holt dieses Skript heraus.
 *
 * DIE DATEINAMEN-HEURISTIK IST EINE UNTERGRENZE, KEINE ERKENNUNG. 113 Belege
 * heißen „…zugferd…", aber ein ZUGFeRD-PDF muss das nicht im Namen tragen.
 * Erkannt wird deshalb erst NACH dem Laden, an den Bytes: ZUGFeRD ist PDF/A-3
 * mit eingebettetem XML, und das XML findet man, indem man die Ströme im PDF
 * auspackt und hineinschaut. Was der Lauf am Ende meldet, ist gemessen; was
 * die Auswahl vorher schätzt, ist geraten.
 *
 * AUSWAHL AUS DER PRODUKTION, DATEIEN VON LINA. Die lokale Datenbank ist ein
 * Torso ohne Belegarchiv (docs/backfill.md); die einzige Sicht auf den echten
 * Bestand ist Metabase. Gelesen wird über `/api/dataset`, und die Abfrage
 * steht hier im Code — Metabase führt aus, was man ihm gibt, auch ein UPDATE.
 *
 * FORTSETZBAR. Was auf der Platte liegt, wird übersprungen. Ein Abbruch kostet
 * nichts außer der laufenden Datei; ein zweiter Start macht dort weiter.
 *
 * TEMPO. Es gilt derselbe Takt wie im Sync (`TAKT_MIN_MS`/`TAKT_MAX_MS`,
 * voreingestellt 10–20 s). Bei 2.000 Dateien sind das rund acht Stunden. Für
 * einen beaufsichtigten Lauf ist schneller vertretbar — dann aber über
 * Umgebungsvariablen für diesen einen Lauf, nicht durch Ändern der
 * Voreinstellung (so steht es bei TAKT_MIN_MS in src/config.ts). Es gibt genau
 * einen Zugang, und eine Sperre wäre nicht rückgängig zu machen.
 *
 *   bun run belege-vorschau              # rechnet nur: was käme, wie lange dauert es
 *   bun run belege-herunterladen         # zieht die Dateien
 *
 *   BELEGE_ZIEL=/pfad/zum/ordner         # Ablage (Vorgabe: ./belege, nicht im Git)
 *   BELEGE_MAX=2000                      # harte Obergrenze an Dateien für diesen Lauf
 *   TAKT_MIN_MS=2000 TAKT_MAX_MS=5000    # beaufsichtigt schneller
 */
import { inflateRawSync, inflateSync } from 'node:zlib'
import { config } from './config'
import { log } from './lib/log'
import { BAUM, ORDNERSEITE, pfadPruefen } from './ladenakte/endpunkte'
import { belegToken, KeinBelegarchiv, cacheLeeren, type Holer } from './ladenakte/token'
import { LinaSession } from './lina/auth'
import type { Endpunkt } from './lina/endpunkte'

// ---------------------------------------------------------------------------
// Die Auswahl
// ---------------------------------------------------------------------------

/**
 * Welche Belege der Korpus umfasst — drei Töpfe mit je eigenem Grund.
 *
 * 1. ALLE Lieferscheine (typ 3970). Es sind 542 Stück konzernweit, verteilt auf
 *    17 von 131 Betrieben, 404 davon aus einem einzigen Betrieb, der im März
 *    2022 aufhörte. Der Ordner trägt nichts für die Auswertung — für einen
 *    Testkorpus ist er trotzdem interessant, weil ein Lieferschein anders
 *    aussieht als eine Rechnung. Vollständig, weil „alle" hier billiger ist als
 *    jede Stichprobenregel.
 *
 * 2. ALLE Belege mit E-Rechnungs-Verdacht im Dateinamen. 113 Stück, laufend bis
 *    19.07.2026 — CWS Hygiene, Metzgerei Schlösser, Lummel, UNIVERSE. Sie sind
 *    die heißeste Spur auf eingebettetes XML, aber siehe oben: eine Spur, kein
 *    Nachweis.
 *
 * 3. Eingangsrechnungen, gestreut über Betrieb UND Jahr. Ein Beleg je Paar aus
 *    Betrieb und Jahr, für 2025/2026 drei — die jüngeren Jahrgänge sind die,
 *    in denen E-Rechnungen überhaupt vorkommen. Die Streuung über Betriebe
 *    bringt die Lieferantenvielfalt mit, ohne dass hier eine Lieferantenliste
 *    gepflegt werden muss.
 *
 * SORTIERT, NICHT ZUFÄLLIG. `ORDER BY lina_id` statt `random()`: derselbe
 * Aufruf liefert morgen dieselbe Auswahl. Ein Korpus, der sich bei jedem Start
 * ändert, ist als Testbestand wertlos.
 */
const AUSWAHL = `
WITH gewaehlt AS (
  SELECT betrieb_key, lina_id, 'lieferschein' AS topf
    FROM core.buchungsbeleg
   WHERE typ_id = '3970'
  UNION
  SELECT betrieb_key, lina_id, 'erechnung_verdacht'
    FROM core.buchungsbeleg
   WHERE datei_name ILIKE '%zugferd%'
      OR datei_name ILIKE '%xrechnung%'
      OR datei_name ILIKE '%factur%'
  UNION
  SELECT betrieb_key, lina_id, 'rechnung_streuung'
    FROM (SELECT betrieb_key, lina_id,
                 date_part('year', beleg_datum)::int AS jahr,
                 row_number() OVER (PARTITION BY betrieb_key,
                                                 date_part('year', beleg_datum)
                                        ORDER BY lina_id) AS rang
            FROM core.buchungsbeleg
           WHERE typ_id = '1'
             AND beleg_datum >= DATE '2019-01-01') x
   WHERE x.rang <= CASE WHEN x.jahr >= 2025 THEN 3 ELSE 1 END
)
SELECT b.lina_id, b.encrypted_id, b.typ_id, a.name AS belegart,
       b.betrieb_key, s.lina_betrieb_id, s.name AS betrieb,
       b.beleg_datum::date::text AS beleg_datum,
       b.datei_name, b.dateiendung, b.netto, b.netto_split_roh,
       b.verkaeufer_name, b.kreditor_konto, b.sachkonto, b.zuordnung_fibu,
       b.datev_guid, b.parashift_status, b.archiviert,
       min(g.topf) AS topf
  FROM core.buchungsbeleg b
  JOIN gewaehlt g USING (betrieb_key, lina_id)
  JOIN core.betrieb s USING (betrieb_key)
  LEFT JOIN core.belegart a ON a.typ_id = b.typ_id
 WHERE b.encrypted_id IS NOT NULL
 GROUP BY b.lina_id, b.encrypted_id, b.typ_id, a.name, b.betrieb_key,
          s.lina_betrieb_id, s.name, b.beleg_datum, b.datei_name, b.dateiendung,
          b.netto, b.netto_split_roh, b.verkaeufer_name, b.kreditor_konto,
          b.sachkonto, b.zuordnung_fibu, b.datev_guid, b.parashift_status,
          b.archiviert
 ORDER BY s.lina_betrieb_id, b.typ_id, b.lina_id
`

export type Beleg = Record<string, unknown> & {
  lina_id: number
  encrypted_id: string
  typ_id: string
  lina_betrieb_id: number
  datei_name: string | null
}

// ---------------------------------------------------------------------------
// Produktion lesen — über Metabase, nur SELECT
// ---------------------------------------------------------------------------

/**
 * Metabase führt aus, was man ihm schickt, und die Datenbank dahinter ist die
 * Produktion. Die Prüfung ist deshalb keine Formsache: sie steht zwischen
 * einem Tippfehler in `AUSWAHL` und einem geschriebenen Datensatz.
 */
const SCHREIBWORT =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|vacuum|refresh|call|do|copy|comment|reindex|cluster|lock|set|reset|begin|commit|rollback|analyze)\b/i

export function nurLesend(sql: string): void {
  const s = sql.trim().replace(/^--.*$/gm, '').trim()
  if (!/^(select|with)\b/i.test(s)) throw new Error(`Nur lesende Abfragen: "${s.slice(0, 60)}"`)
  if (SCHREIBWORT.test(s)) throw new Error(`Schreibwort in der Abfrage — abgelehnt`)
}

async function ausProduktion(sql: string): Promise<Beleg[]> {
  nurLesend(sql)
  const { METABASE_URL, METABASE_USER, METABASE_PASSWORD } = config
  if (!METABASE_USER || !METABASE_PASSWORD) {
    throw new Error('METABASE_USER/METABASE_PASSWORD fehlen — der Korpus wird aus der Produktion ausgewählt.')
  }
  const anmeldung = await fetch(`${METABASE_URL}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: METABASE_USER, password: METABASE_PASSWORD }),
  })
  if (!anmeldung.ok) throw new Error(`Metabase-Anmeldung: ${anmeldung.status} ${await anmeldung.text()}`)
  const sitzung = (await anmeldung.json() as { id: string }).id

  const r = await fetch(`${METABASE_URL}/api/dataset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Metabase-Session': sitzung },
    body: JSON.stringify({
      type: 'native',
      database: Number(process.env.METABASE_DB_ID ?? 2),
      native: { query: sql },
    }),
  })
  const j = await r.json() as any
  if (j.status === 'failed' || j.error) {
    throw new Error(`Auswahl gescheitert: ${j.error ?? JSON.stringify(j).slice(0, 400)}`)
  }
  const spalten: string[] = (j.data?.cols ?? []).map((c: any) => c.name)
  return (j.data?.rows ?? []).map((z: unknown[]) =>
    Object.fromEntries(spalten.map((s, i) => [s, z[i]])) as Beleg)
}

// ---------------------------------------------------------------------------
// Eingebettete E-Rechnung finden
// ---------------------------------------------------------------------------

/**
 * Das XML aus einem ZUGFeRD-PDF holen — ohne Fremdwerkzeug.
 *
 * Der saubere Weg wäre, den Objektbaum zu lesen: Katalog → Names →
 * EmbeddedFiles → Filespec. Der braucht einen halben PDF-Parser (xref,
 * Objektströme, Filterketten), und für einen Testkorpus zahlt sich das nicht
 * aus. Der kurze Weg tut es hier: jeden `stream…endstream`-Block auspacken und
 * hineinsehen. Wonach wir suchen, erkennt man an drei Zeichen — `<?x`.
 *
 * Das findet auch XML, das nicht die Rechnung ist (Metadaten etwa). Deshalb
 * wird auf die Wurzelelemente der beiden Formate geprüft:
 * `CrossIndustryInvoice` (ZUGFeRD/Factur-X) und `Invoice` mit UBL-Namensraum
 * (XRechnung). Was das nicht trifft, ist keins.
 *
 * Latin-1 als Zwischenform, weil dort ein Byte genau ein Zeichen ist — die
 * Indizes aus `indexOf` passen dann auf den Bytepuffer. Mit UTF-8 verschöbe
 * sich alles ab dem ersten Byte über 0x7F, und das ist in einem PDF sofort.
 */
export function erechnungXml(pdf: Uint8Array): string | null {
  const s = Buffer.from(pdf).toString('latin1')
  let i = 0
  while ((i = s.indexOf('stream', i)) !== -1) {
    let von = i + 'stream'.length
    if (s[von] === '\r') von++
    if (s[von] === '\n') von++
    const bis = s.indexOf('endstream', von)
    if (bis === -1) break
    i = bis + 'endstream'.length

    /*
     * Das Zeilenende VOR `endstream` gehört laut Spezifikation nicht mehr zu
     * den Daten. Für den Entpacker ist das kein Schönheitsfehler: ein Byte zu
     * viel, und er bricht ab — der Anhang wäre dann still nicht gefunden.
     */
    let ende = bis
    if (s[ende - 1] === '\n') ende--
    if (s[ende - 1] === '\r') ende--
    const roh = pdf.subarray(von, ende)
    for (const kandidat of [entpacken(roh), roh]) {
      if (!kandidat) continue
      const text = Buffer.from(kandidat).toString('utf8')
      if (!text.startsWith('<?x') && !text.trimStart().startsWith('<?x')) continue
      if (/<(\w+:)?CrossIndustryInvoice[\s>]/.test(text)) return text
      if (/<(\w+:)?Invoice[\s>]/.test(text) && text.includes('oasis:names:specification:ubl')) return text
    }
  }
  return null
}

/**
 * Beide Deflate-Spielarten versuchen. PDF-Ströme mit `/FlateDecode` tragen
 * üblicherweise den zlib-Kopf, aber nicht alle Erzeuger setzen ihn — und ein
 * Anhang, den wir nicht auspacken, ist ein Anhang, den wir nicht finden.
 */
function entpacken(roh: Uint8Array): Uint8Array | null {
  for (const f of [inflateSync, inflateRawSync]) {
    try { return f(roh) } catch { /* nächste Spielart */ }
  }
  return null
}

// ---------------------------------------------------------------------------
// Der Abzug
// ---------------------------------------------------------------------------

/** Ein Dateiname, der auf jedem Dateisystem überlebt — und lesbar bleibt. */
export function dateiname(b: Beleg): string {
  const roh = (b.datei_name ?? 'ohne_namen').toString()
  const sauber = roh.normalize('NFC').replace(/[\/\\:*?"<>| -]/g, '_').slice(0, 120).trim()
  return `${b.lina_id}__${sauber || 'ohne_namen'}.pdf`
}

/** Ordner: Belegart, darunter Betrieb. So liegt eine Belegart beieinander. */
export function ablage(ziel: string, b: Beleg): string {
  const art = String(b.belegart ?? `typ_${b.typ_id}`).replace(/[^\p{L}\p{N}]+/gu, '_').toLowerCase()
  return `${ziel}/${art}/${b.lina_betrieb_id}`
}

const GET_BELEG = '/intranet/ladenakte/getBeleg'

function schlaf(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function takt(): number {
  const spanne = config.TAKT_MAX_MS - config.TAKT_MIN_MS
  return config.TAKT_MIN_MS + Math.floor(Math.random() * (spanne + 1))
}

/**
 * Der Adapter, über den `belegToken()` den Baumknoten und die Ordnerseite holt.
 *
 * Bewusst nicht der `LinaClient`: der zählt jeden Aufruf auf das Tagesbudget
 * des Sync und liest die Antwort als Text — für eine PDF-Datei wäre das eine
 * stille Beschädigung. Was er an Vorsicht mitbringt, steht hier nachgebaut:
 * Takt vor jedem Aufruf, Pfadprüfung, eine Neuanmeldung bei abgelaufener
 * Sitzung. Was er an Notbremsen hat, braucht ein beaufsichtigter Lauf nicht —
 * hier sitzt jemand davor.
 */
function holerAus(sitzung: LinaSession): Holer {
  return {
    async holen(ep: Endpunkt, parameter: Record<string, string>) {
      pfadPruefen(ep.pfad)
      await schlaf(takt())
      const url = `${config.LINA_BASE_URL}${ep.pfad}?${new URLSearchParams(parameter)}`
      const res = await fetch(url, {
        headers: sitzung.header({ referer: `${config.LINA_BASE_URL}/intranet/ladenakte` }),
        redirect: 'manual',
        signal: AbortSignal.timeout(config.ANFRAGE_TIMEOUT_MS),
      })
      const text = await res.text()
      if (!res.ok) return { art: 'fehler', fehler: `HTTP ${res.status}` }
      if ((ep.form ?? 'json') === 'html') return { art: 'ok', daten: text }
      try { return { art: 'ok', daten: JSON.parse(text) } }
      catch { return { art: 'fehler', fehler: `keine JSON-Antwort (${text.length} Bytes)` } }
    },
  }
}

export async function ziehen(belege: Beleg[], ziel: string, grenze: number): Promise<void> {
  const sitzung = new LinaSession()
  await sitzung.anmelden()
  cacheLeeren()
  const holer = holerAus(sitzung)

  const manifest = Bun.file(`${ziel}/manifest.jsonl`).writer()
  let geladen = 0, uebersprungen = 0, mitXml = 0, fehler = 0
  const ohneArchiv = new Set<number>()

  try {
    for (const b of belege) {
      if (geladen >= grenze) { log.info('belege: Obergrenze erreicht', { grenze }); break }
      if (ohneArchiv.has(b.lina_betrieb_id)) { uebersprungen++; continue }

      const ordner = ablage(ziel, b)
      const pfad = `${ordner}/${dateiname(b)}`
      if (await Bun.file(pfad).exists()) { uebersprungen++; continue }

      let token: string
      try {
        token = await belegToken(holer, String(b.lina_betrieb_id))
      } catch (e) {
        if (e instanceof KeinBelegarchiv) { ohneArchiv.add(b.lina_betrieb_id); uebersprungen++; continue }
        throw e
      }

      pfadPruefen(GET_BELEG)
      await schlaf(takt())
      const url = `${config.LINA_BASE_URL}${GET_BELEG}?`
        + new URLSearchParams({ admin: '1', storeId: token, id: b.encrypted_id })
      const res = await fetch(url, {
        headers: sitzung.header({ referer: `${config.LINA_BASE_URL}/intranet/ladenakte` }),
        redirect: 'manual',
        signal: AbortSignal.timeout(config.ANFRAGE_TIMEOUT_MS),
      })
      const bytes = Buffer.from(await res.arrayBuffer())

      /**
       * Eine HTML-Fehlerseite mit HTTP 200 ist der Normalfall bei LINA, wenn
       * etwas nicht stimmt. Als `.pdf` gespeichert wäre sie im Korpus ein
       * stiller Blindgänger — der PIM-Pipeline fiele sie erst beim Parsen auf.
       */
      if (!res.ok || bytes.length < 5 || Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') {
        fehler++
        log.warn('belege: keine PDF-Antwort', {
          lina_id: b.lina_id, betrieb: b.lina_betrieb_id, status: res.status, bytes: bytes.length,
        })
        continue
      }

      await Bun.write(pfad, bytes)
      const xml = erechnungXml(bytes)
      if (xml) { await Bun.write(pfad.replace(/\.pdf$/, '.xml'), xml); mitXml++ }
      geladen++

      manifest.write(JSON.stringify({
        ...b,
        datei: pfad.slice(ziel.length + 1),
        bytes: bytes.length,
        erechnung_xml: xml ? pfad.replace(/\.pdf$/, '.xml').slice(ziel.length + 1) : null,
      }) + '\n')

      if (geladen % 25 === 0) {
        log.info('belege: Fortschritt', { geladen, uebersprungen, mitXml, fehler, von: belege.length })
      }
    }
  } finally {
    await manifest.end()
  }

  log.info('belege: fertig', { geladen, uebersprungen, mitXml, fehler, ziel })
  console.log(
    `\n${geladen} Dateien geladen, ${uebersprungen} übersprungen, ${fehler} ohne PDF-Antwort.\n`
    + `${mitXml} davon trugen eine eingebettete E-Rechnung (XML liegt daneben).\n`
    + `Ablage: ${ziel}\n`)
}

// ---------------------------------------------------------------------------

/**
 * ZWEI BEFEHLE, KEIN SCHALTER.
 *
 * Vorher entschied `KORPUS_ZIEHEN=1` darüber, ob dieser Lauf 1.585 Dateien aus
 * LINA holt oder nur rechnet. Eine Umgebungsvariable ist dafür die falsche
 * Bauform: sie steht nicht im Befehl, den man später im Verlauf wiederfindet,
 * sie überlebt in der Shell den nächsten Aufruf, und wer sie einmal gesetzt
 * hat, zieht beim nächsten `bun run` unbeabsichtigt erneut.
 *
 * Jetzt sagt der Befehlsname, was passiert. Ohne Flagge passiert das
 * Harmlose — wer sich vertippt, bekommt eine Vorschau und keinen Abzug.
 */
if (import.meta.main) {
  const ziehenGewollt = process.argv.includes('--ziehen')
  const ziel = process.env.BELEGE_ZIEL ?? `${process.cwd()}/belege`
  const grenze = Number(process.env.BELEGE_MAX ?? 2000)

  const belege = await ausProduktion(AUSWAHL)
  const jeTopf = new Map<string, number>()
  for (const b of belege) jeTopf.set(String(b.topf), (jeTopf.get(String(b.topf)) ?? 0) + 1)
  const nimmt = Math.min(belege.length, grenze)
  const sekunden = nimmt * ((config.TAKT_MIN_MS + config.TAKT_MAX_MS) / 2) / 1000

  console.log(`\nAuswahl aus der Produktion: ${belege.length} Belege`)
  for (const [topf, n] of [...jeTopf].sort()) console.log(`  ${topf.padEnd(20)} ${n}`)
  console.log(`\nDieser Lauf zieht höchstens ${nimmt} (BELEGE_MAX=${grenze}).`)
  console.log(`Takt ${config.TAKT_MIN_MS / 1000}–${config.TAKT_MAX_MS / 1000} s`
    + ` → grob ${(sekunden / 3600).toFixed(1)} h, plus ein Tokenaufruf je Betrieb.`)
  console.log(`Ablage: ${ziel}`)

  if (!ziehenGewollt) {
    console.log(`\nVorschau — es wurde nichts geladen.`
      + `  Zum Ziehen:  bun run belege-herunterladen\n`)
    process.exit(0)
  }
  await ziehen(belege, ziel, grenze)
}
