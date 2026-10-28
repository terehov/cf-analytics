/**
 * HTML-Tabellen der Ladenakte lesen.
 *
 * WARUM HIER ÜBERHAUPT HTML GEPARST WIRD. LINA hat eine offizielle
 * Drittanbieter-Schnittstelle mit passenden Scopes („BWAs und SuSas lesen"),
 * aber sie wird nicht angefragt — die Entscheidung ist am 11.08.2026 gefallen
 * und steht in `docs/entscheidungen.md`. HTML-Parsen ist damit der gewählte
 * Weg und kein Notbehelf, und dieser Parser ist auf Dauer angelegt.
 *
 * WARUM KEINE BIBLIOTHEK. Das Projekt hängt an `pg`, `tslog` und `zod` — sonst
 * nichts. Die zwei Tabellenformen hier rechtfertigen keine Parse-Abhängigkeit:
 * das Markup ist serverseitig gerendert, flach, ohne Verschachtelung in den
 * Zellen ausser einem `<a>`. Am 11.08.2026 an vier echten Antworten gemessen.
 *
 * WAS DEN PARSER TRÄGT, IST NICHT DAS LESEN, SONDERN DAS PRÜFEN. Jede Funktion
 * hier wirft lieber, als etwas Halbes zurückzugeben. Das ist Absicht: die
 * Fehlergeschichte dieses Projekts besteht fast vollständig aus Läufen, die
 * „ok" meldeten und eine plausible falsche Zahl hinterliessen. Ein Parser, der
 * bei geändertem Markup still eine leere Liste liefert, wäre genau dieser
 * Fehler in neu. Ändert LINA das Markup, soll der Posten scheitern.
 */

/** Der Parser hat etwas gefunden, das er nicht sicher deuten kann. */
export class ParseFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht)
    this.name = 'ParseFehler'
  }
}

/**
 * Die BWA hat 77 nummerierte Zeilen. Gemessen am 11.08.2026 an zwei sehr
 * verschiedenen Betrieben (Schlager Cafe Düsseldorf mit 20 Monatsspalten,
 * CONCEPT FAMILY Franchise AG mit 80) — beide Male exakt dieselben 77 Nummern
 * im Bereich 82–162.
 *
 * Die Zahl steht hier als Erwartung, nicht als Annahme: weicht sie ab, hat
 * LINA die BWA-Gliederung geändert, und dann ist eine Prüfung fällig statt
 * eines stillen Imports mit verschobenen Zeilen.
 */
export const BWA_ZEILEN_ERWARTET = 77

// ---------------------------------------------------------------------------
// Kleinwerkzeug
// ---------------------------------------------------------------------------

const ENTITAETEN: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü',
  szlig: 'ß', euro: '€', deg: '°',
}

/** HTML-Entitäten auflösen. Nur die, die in LINAs Ausgabe vorkommen, plus numerische. */
export function entitaeten(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (ganz, name) => ENTITAETEN[name] ?? ganz)
}

/** Tags raus, Entitäten auf, Leerraum zusammenziehen. */
function text(roh: string): string {
  return entitaeten(roh.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/**
 * Deutsche Zahl in eine Zahl. `1.234,56` → 1234.56, `-90,98` → -90.98.
 *
 * Gibt `null` zurück, wenn die Zelle leer ist oder nicht wie eine Zahl
 * aussieht — und zwar bewusst `null` und nicht `0`. Der Unterschied zwischen
 * „steht nicht drin" und „ist null" ist bei Geldbeträgen der ganze Punkt:
 * ein Betrieb ohne gebuchte Miete ist etwas anderes als einer mit Miete 0.
 */
export function deutscheZahl(s: string): number | null {
  const t = s.trim()
  if (t === '' || t === '-') return null
  /**
   * Tausenderpunkte müssen echte Dreiergruppen sein. Ein lockereres Muster
   * (`[\d.]+`) würde `1.234.56` klaglos als 123456 durchgehen lassen — eine
   * Zahl, die um den Faktor 1000 danebenliegt und völlig plausibel aussieht.
   * Lieber `null` und ein Eintrag in der Schemaprüfung als ein stiller
   * Faktor-1000-Fehler in einer Geldspalte.
   */
  if (!/^-?(\d{1,3}(\.\d{3})*|\d+)(,\d+)?$/.test(t)) return null
  const n = Number(t.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Alle Tabellen eines Dokuments, verschachtelungsfest.
 *
 * Ein `<table.*?</table>` mit Sparsamkeitsoperator wäre kürzer und bei einer
 * verschachtelten Tabelle still falsch — er endet am ersten `</table>` und
 * schneidet die äussere mitten durch. In LINAs Ausgabe ist am 11.08.2026 keine
 * Verschachtelung gemessen worden; darauf zu bauen wäre trotzdem eine Annahme
 * über fremden Code, den niemand von uns pflegt.
 */
export function tabellen(html: string): string[] {
  const gefunden: string[] = []
  const marken = [...html.matchAll(/<\/?table\b[^>]*>/gi)]
  let tiefe = 0
  let start = -1
  for (const m of marken) {
    const zu = m[0].startsWith('</')
    if (!zu) {
      if (tiefe === 0) start = m.index!
      tiefe++
    } else {
      tiefe--
      if (tiefe === 0 && start >= 0) {
        gefunden.push(html.slice(start, m.index! + m[0].length))
        start = -1
      }
      if (tiefe < 0) throw new ParseFehler('HTML: schliessendes </table> ohne öffnendes')
    }
  }
  if (tiefe !== 0) throw new ParseFehler(`HTML: ${tiefe} nicht geschlossene <table>`)
  return gefunden
}

/** Zeilen einer Tabelle, roh. */
function zeilen(tabelle: string): string[] {
  return [...tabelle.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[0])
}

/** Zellen einer Zeile als Text. `th` und `td` gleichermassen. */
function zellen(zeile: string): string[] {
  return [...zeile.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => text(m[1]))
}

// ---------------------------------------------------------------------------
// BWA-Longterm
// ---------------------------------------------------------------------------

export type BwaZeile = {
  /** Stabile Nummer aus dem Diagramm-Link, z. B. 82 = Erlöse Getränke. */
  zeileId: number
  bezeichnung: string
  /** Einrückung aus `class="indent-N"`. Summenzeilen haben keine. */
  ebene: number | null
  /** Ein Eintrag je Monatsspalte, in derselben Reihenfolge wie `monate`. */
  werte: (number | null)[]
}

export type BwaLongterm = {
  /** Monatsspalten in LINAs Schreibweise, z. B. `01/25`. */
  monate: string[]
  zeilen: BwaZeile[]
  /** Zellen mit einem Wert ungleich null. Das Mass für „hat der Betrieb BWA?". */
  zellenMitWert: number
}

/**
 * Die Longterm-BWA eines Betriebs lesen.
 *
 * Aufbau, am 11.08.2026 gemessen: die zweite Tabelle trägt in der Kopfzeile
 * leere erste Spalte plus N Monate (`01/25`), danach 103 Zeilen. 77 davon
 * tragen im Diagramm-Link eine Nummer (`/img/82/`) und N Wertzellen; die
 * übrigen 26 sind Gliederungsleerzeilen ohne Zellen.
 *
 * Die Nummer ist der Schlüssel, nicht die Beschriftung. Beschriftungen sind
 * teils abgeschnitten („Freiwillige soz. Auf"), tragen Umlaute und ändern sich
 * mit jeder Textpflege in LINA — ein Join darüber hielte, bis ihn jemand still
 * kaputtmacht.
 */
export function bwaLongtermLesen(html: string): BwaLongterm {
  const alle = tabellen(html)

  // Die Datentabelle daran erkennen, dass ihre Kopfzeile Monate enthält —
  // nicht an ihrer Position. Position ist eine Annahme, Inhalt ein Merkmal.
  const istMonat = (s: string) => /^\d{2}\/\d{2}$/.test(s)
  const tabelle = alle.find(t => {
    const erste = zeilen(t)[0]
    if (!erste) return false
    const k = zellen(erste)
    return k.length > 1 && k.slice(1).every(istMonat)
  })
  if (!tabelle) {
    throw new ParseFehler(
      `BWA-Longterm: keine Tabelle mit Monatskopfzeile gefunden (${alle.length} Tabellen geprüft)`)
  }

  const alleZeilen = zeilen(tabelle)
  const monate = zellen(alleZeilen[0]).slice(1)
  if (monate.length === 0) throw new ParseFehler('BWA-Longterm: Kopfzeile ohne Monatsspalten')

  const ergebnis: BwaZeile[] = []
  for (const z of alleZeilen.slice(1)) {
    const roheZellen = [...z.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
    if (roheZellen.length === 0) continue

    const kopf = roheZellen[0][0]
    const nummer = kopf.match(/\/img\/(\d+)\//)
    if (!nummer) continue          // Gliederungsleerzeile: keine Nummer, keine Werte

    const werte = roheZellen.slice(1).map(m => deutscheZahl(text(m[1])))
    if (werte.length !== monate.length) {
      throw new ParseFehler(
        `BWA-Longterm: Zeile ${nummer[1]} hat ${werte.length} Werte, `
        + `die Kopfzeile nennt ${monate.length} Monate`)
    }

    const ebene = kopf.match(/indent-(\d+)/)
    ergebnis.push({
      zeileId: Number(nummer[1]),
      bezeichnung: text(roheZellen[0][1]),
      ebene: ebene ? Number(ebene[1]) : null,
      werte,
    })
  }

  if (ergebnis.length !== BWA_ZEILEN_ERWARTET) {
    throw new ParseFehler(
      `BWA-Longterm: ${ergebnis.length} nummerierte Zeilen statt ${BWA_ZEILEN_ERWARTET}. `
      + `LINA hat die BWA-Gliederung geändert — bitte prüfen, bevor importiert wird.`)
  }
  const ids = new Set(ergebnis.map(z => z.zeileId))
  if (ids.size !== ergebnis.length) {
    throw new ParseFehler('BWA-Longterm: Zeilennummern sind nicht eindeutig')
  }

  const zellenMitWert = ergebnis.reduce(
    (n, z) => n + z.werte.filter(w => w !== null && w !== 0).length, 0)

  return { monate, zeilen: ergebnis, zellenMitWert }
}

/**
 * `01/25` → `2025-01-01`.
 *
 * Das Jahrhundert ist geraten, und das darf es hier: LINAs früheste Spalte ist
 * 06/09, die späteste liegt in der Zukunft des laufenden Jahres. Ein
 * zweistelliges Jahr unter 70 ist in diesem Datenbestand immer 20xx.
 */
export function monatsspalte(s: string): string {
  const m = s.match(/^(\d{2})\/(\d{2})$/)
  if (!m) throw new ParseFehler(`BWA: unlesbare Monatsspalte "${s}"`)
  const monat = Number(m[1])
  if (monat < 1 || monat > 12) throw new ParseFehler(`BWA: Monat ${monat} ausserhalb 1-12`)
  const jahr = Number(m[2]) < 70 ? 2000 + Number(m[2]) : 1900 + Number(m[2])
  return `${jahr}-${m[1]}-01`
}

// ---------------------------------------------------------------------------
// Stammdatenblatt
// ---------------------------------------------------------------------------

export type Kapazitaet = {
  bereich: string
  plaetze: number | null
  tische: number | null
  flaecheQm: number | null
}

export type PlanBwaZeile = {
  zeileId: number
  bezeichnung: string
  /** Ein Eintrag je Monatsspalte der Planung, `monat` als `YYYY-MM-01`. */
  werte: { monat: string; betrag: number | null }[]
}

export type Tagesbudget = {
  /** `YYYY-MM-DD`. */
  datum: string
  umsatzNetto: number | null
  stundenService: number | null
  stundenBar: number | null
  stundenKueche: number | null
}

export type Stammdaten = {
  kapazitaet: Kapazitaet[]
  planBwa: PlanBwaZeile[]
  tagesbudget: Tagesbudget[]
}

export type Adresse = {
  /** Alle Zeilen der Anschrift, wie LINA sie mit `<br>` trennt. */
  zeilen: string[]
  /** Die Zeile vor der Straße — meist die Gesellschaft. */
  nameZeile: string | null
  strasse: string | null
  plz: string | null
  ort: string | null
}

/**
 * Die Anschrift aus dem Stammdatenblatt (Zeile „Adresse" der Schlüssel-Wert-
 * Tabelle) — seit 0125, 29.09.2026.
 *
 * WARUM ERST JETZT. Die Positivliste in `stammdatenLesen` nahm drei Tabellen
 * und ließ die Schlüssel-Wert-Tabelle bewusst liegen. Dabei steht dort die
 * einzige Betriebsanschrift, die LINA liefert — für alle 141 Betriebe,
 * während `manual.betrieb_standort` nur 60 aus Yext hatte. Gelesen wird
 * weiterhin nur, was gebraucht wird: diese eine Zeile. Telefon, E-Mail,
 * Gesellschafter bleiben im Rohlayer.
 *
 * Die Zerlegung sucht die Zeile „PLZ Ort" (fünf Ziffern) und nimmt die Zeile
 * davor als Straße. Ohne PLZ-Zeile bleiben Straße, PLZ und Ort leer und nur
 * `zeilen` gefüllt — lieber keine Adresse als eine geratene.
 */
export function adresseLesen(html: string): Adresse | null {
  for (const t of tabellen(html)) {
    for (const z of zeilen(t)) {
      const roh = [...z.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => m[1])
      if (roh.length < 2 || text(roh[0]) !== 'Adresse') continue
      const teile = roh[1].split(/<br\s*\/?>/i).map(text).filter(s => s !== '')
      if (teile.length === 0) return null
      const i = teile.findIndex(s => /^\d{5}\s+\S/.test(s))
      if (i < 0) return { zeilen: teile, nameZeile: null, strasse: null, plz: null, ort: null }
      const m = teile[i].match(/^(\d{5})\s+(.+)$/)!
      return {
        zeilen: teile,
        nameZeile: i >= 2 ? teile[i - 2] : null,
        strasse: i >= 1 ? teile[i - 1] : null,
        plz: m[1],
        ort: m[2].trim(),
      }
    }
  }
  return null
}

/**
 * Die drei gewünschten Tabellen des Stammdatenblatts.
 *
 * ⚠ POSITIVLISTE, KEINE AUSSCHLUSSLISTE — und das ist kein Stilfrage.
 *
 * Das Stammdatenblatt trägt sieben Tabellen. Eine davon (Kopfzeile
 * `Name | API - Key | …`) enthält die vergebenen **API-Schlüssel im Klartext**,
 * mit IP-Bindung und Scopes. Was von hier in `raw.api_antwort` wandert, ist
 * append-only und nicht mehr zu entfernen (harte Regel 4), und Zugangsdaten
 * gehören nach harter Regel 2 ohnehin nirgends hin ausser in Umgebungsvariablen.
 *
 * Eine Ausschlussliste („alles ausser der Schlüsseltabelle") vergisst man bei
 * der nächsten neuen Tabelle, die LINA hinzufügt. Eine Positivliste übersieht
 * sie höchstens — und das ist der Fehler, den man sich leisten kann.
 *
 * Angesprochen werden die Tabellen über ihre Kopfzeile, nicht über ihre
 * Position. Verschiebt LINA die Reihenfolge, findet der Parser nichts und
 * wirft, statt still die falsche Tabelle zu lesen.
 */
export function stammdatenLesen(html: string): Stammdaten {
  const alle = tabellen(html)

  const mitKopf = (...erwartet: string[]) => alle.find(t => {
    const erste = zeilen(t)[0]
    if (!erste) return false
    const k = zellen(erste).map(s => s.toLowerCase())
    return erwartet.every((e, i) => (k[i] ?? '').startsWith(e.toLowerCase()))
  })

  // --- Kapazität: Bereich | Plätze | Tische | Fläche [qm] ---------------
  const kapazitaet: Kapazitaet[] = []
  const tKap = mitKopf('Bereich', 'Plätze', 'Tische', 'Fläche')
  if (tKap) {
    for (const z of zeilen(tKap).slice(1)) {
      const c = zellen(z)
      if (c.length < 4 || c[0] === '') continue
      kapazitaet.push({
        bereich: c[0],
        plaetze: deutscheZahl(c[1]),
        tische: deutscheZahl(c[2]),
        flaecheQm: deutscheZahl(c[3]),
      })
    }
  }

  // --- Plan-BWA: ID | BWA-Zeile | 1/2025 … --------------------------------
  const planBwa: PlanBwaZeile[] = []
  const tPlan = mitKopf('ID', 'BWA-Zeile')
  if (tPlan) {
    const kopf = zellen(zeilen(tPlan)[0])
    const monate = kopf.slice(2).map(s => {
      const m = s.match(/^(\d{1,2})\/(\d{4})$/)
      if (!m) throw new ParseFehler(`Plan-BWA: unlesbare Monatsspalte "${s}"`)
      return `${m[2]}-${m[1].padStart(2, '0')}-01`
    })
    for (const z of zeilen(tPlan).slice(1)) {
      const c = zellen(z)
      const id = Number(c[0])
      if (!Number.isInteger(id) || c.length < 2) continue
      const werte = monate.map((monat, i) => ({ monat, betrag: deutscheZahl(c[2 + i] ?? '') }))
      planBwa.push({ zeileId: id, bezeichnung: c[1], werte })
    }
    if (planBwa.length > 0 && planBwa.length !== BWA_ZEILEN_ERWARTET) {
      throw new ParseFehler(
        `Plan-BWA: ${planBwa.length} Zeilen statt ${BWA_ZEILEN_ERWARTET} — `
        + `Gliederung weicht von der Ist-BWA ab, der Plan-Ist-Vergleich wäre schief`)
    }
  }

  // --- Tagesbudget: Datum | Umsatz netto | Stunden Service|Bar|Küche -----
  const tagesbudget: Tagesbudget[] = []
  const tTag = mitKopf('Datum', 'Umsatz netto', 'Stunden Service')
  if (tTag) {
    for (const z of zeilen(tTag).slice(1)) {
      const c = zellen(z)
      const d = (c[0] ?? '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
      if (!d) continue
      tagesbudget.push({
        datum: `${d[3]}-${d[2]}-${d[1]}`,
        umsatzNetto: deutscheZahl(c[1] ?? ''),
        stundenService: deutscheZahl(c[2] ?? ''),
        stundenBar: deutscheZahl(c[3] ?? ''),
        stundenKueche: deutscheZahl(c[4] ?? ''),
      })
    }
  }

  if (!tKap && !tPlan && !tTag) {
    throw new ParseFehler(
      `Stammdaten: keine der drei erwarteten Tabellen gefunden (${alle.length} Tabellen im Dokument). `
      + `Entweder ist es nicht das Stammdatenblatt, oder LINA hat die Kopfzeilen geändert.`)
  }

  return { kapazitaet, planBwa, tagesbudget }
}

// ---------------------------------------------------------------------------
// Kassenblatt — Umsatz der Betriebe mit fremder Kasse (28.10.2026)
// ---------------------------------------------------------------------------

/**
 * Ein Tag aus dem Ladenakte-Bericht „Die letzten Tage".
 *
 * `gruppen` sind LINAs UMSATZGRUPPEN des Betriebs, nicht die Hauptsparten des
 * Konzernberichts: Enchilada Bremen führt „Getränke / Essen /
 * Biergartenumsatz", Ratskeller Ludwigsburg „Getränke / Speisen / Divers /
 * Gutschein / Miete&Organisation". Name und Zahl der Gruppen sind je Betrieb
 * verschieden, deshalb kommen sie aus der Kopfzeile und nicht aus einer Liste.
 */
export type KassenblattTag = {
  datum: string
  netto: number
  gruppen: { name: string; netto: number }[]
}

export type KassenblattMonat = {
  /** `YYYY-MM-01` — aus der GEWÄHLTEN Option gelesen, nicht aus der Anfrage. */
  monat: string
  gruppen: string[]
  tage: KassenblattTag[]
  /** Die Monatssummenzeile („August 2026"); 0 bei einer Tabelle ohne Tage. */
  summe: number
  /**
   * Tage, an denen LINAs Gesamt nicht die Summe der angezeigten Gruppen ist
   * (Lauf 182, 28.10.2026: drei Betriebe, je ein Tag, 50 bis 100 EUR). Der
   * Lader meldet sie; `netto` ist trotzdem das Gesamt.
   */
  abweichende_tage: { datum: string; netto: number; gruppen_summe: number }[]
}

const MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
  'August', 'September', 'Oktober', 'November', 'Dezember']

/** `1.624,45 (+0% )` → 1624.45. Die Klammer ist die Forecast-Abweichung. */
function betragVorKlammer(s: string): number | null {
  return deutscheZahl(s.replace(/\s*\(.*\)\s*$/, ''))
}

/** Der Wert der gewählten Option eines `<select name="…">`. */
function gewaehlt(html: string, name: string): string | null {
  const sel = html.match(new RegExp(`<select\\b[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`, 'i'))
  if (!sel) return null
  const opt = sel[1].match(/<option\b[^>]*value="([^"]*)"[^>]*selected/i)
  return opt ? opt[1] : null
}

/**
 * „Die letzten Tage" eines Monats lesen
 * (`/intranet/report/monatsanalyse/laden/<hash>/admin/1/?monat=MM&jahr=JJJJ`).
 *
 * Bei Betrieben mit fremder Kasse ist das der Umsatz, den der Betrieb von Hand
 * ins Kassenblatt einträgt — kein Konzernbericht liefert ihn. Bei LINA-Kassen
 * ist es derselbe Nettoumsatz wie `getUmsatzbericht` (nachgemessen 28.10.2026,
 * drei Betriebe auf den Cent). Messwerte in `docs/lina-api-inventar-ladenakte.md` §2a.
 *
 * ZWEI PRÜFUNGEN, und jede hat einen Grund:
 *
 * 1. **Der gewählte Monat muss der angefragte sein.** LINA ignoriert
 *    unbekannte Parameter still und liefert dann den laufenden Monat — mit
 *    `from/…/to/…` am 28.10.2026 genau so gemessen. Ohne diese Prüfung
 *    landete der Oktober unter dem Datum des Augusts, plausibel und falsch.
 * 2. **Summe der Tage = Monatssummenzeile.** Fängt eine verlorene Zeile.
 *
 * KEINE PRÜFUNG MEHR: „Gesamt = Summe der Gruppen" je Tag. Die erste Fassung
 * warf dort, als Wache gegen eine verrutschte Spalte. Im ersten Produktionslauf
 * (28.10.2026, Lauf 182) scheiterten daran drei von sechs Betrieben an je
 * einem Tag, mit Differenzen von 50,01, 79,83 und 100,00 EUR — LINAs
 * Gesamtspalte führt dort einen Betrag, der in keiner angezeigten Gruppe
 * steht (vermutlich eine inaktive oder ausgeblendete Umsatzgruppe). Das ist
 * eine Eigenschaft der Daten, keine des Parsers. Die Abweichung wird als
 * `abweichende_tage` zurückgegeben und vom Lader gemeldet, nicht geworfen;
 * `netto` bleibt LINAs Gesamt (das ist der Wert, der die Monatszeile trifft
 * und gegen die BWA gemessen wurde). Gegen eine verrutschte Spalte bleiben
 * die Kopfzeile „Gesamt" an erster Stelle, die Pflicht, dass jede Zelle eine
 * Zahl ist, und die Monatssumme.
 *
 * EINE TABELLE OHNE TAGESZEILEN ist kein Fehler, sondern ein Betrieb ohne
 * Kassenblatt für diesen Monat (Lauf 182: einer von sechs) — leerer Monat.
 * Geworfen wird nur, wenn die Monatszeile trotzdem Umsatz nennt.
 */
export function kassenblattTageLesen(
  html: string, erwartet: { monat: number; jahr: number },
): KassenblattMonat {
  const tabelle = tabellen(html).find(t => /Nettoums(ä|&auml;)tze/.test(t))
  if (!tabelle) throw new ParseFehler('Kassenblatt: keine Tabelle mit "Nettoumsätze" gefunden')

  const monat = Number(gewaehlt(tabelle, 'monat'))
  const jahr = Number(gewaehlt(tabelle, 'jahr'))
  if (monat !== erwartet.monat || jahr !== erwartet.jahr) {
    throw new ParseFehler(
      `Kassenblatt: angefragt ${erwartet.monat}/${erwartet.jahr}, LINA zeigt ${monat}/${jahr}. `
      + `Der Monatsparameter wurde nicht angenommen — die Werte gehören zu einem anderen Monat.`)
  }

  const alle = zeilen(tabelle)
  // Kopfzeile 1: Spaltengruppen mit colspan. Die Umsatzspalten stehen unter
  // „Nettoumsätze"; davor stehen zwei Spalten (Kassenbuch, Datum).
  const kopf1 = [...(alle[0] ?? '').matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/gi)]
  let start = 0
  let breite = 0
  for (const m of kopf1) {
    const span = Number(m[1].match(/colspan="(\d+)"/)?.[1] ?? 1)
    if (/Nettoums/.test(text(m[2]))) { breite = span; break }
    start += span
  }
  if (breite < 1) throw new ParseFehler('Kassenblatt: Spaltengruppe "Nettoumsätze" nicht gefunden')

  const kopf2 = zellen(alle[1] ?? '')
  const namen = kopf2.slice(start, start + breite)
  if (!/^Gesamt\b/.test(namen[0] ?? '')) {
    throw new ParseFehler(`Kassenblatt: erste Umsatzspalte ist "${namen[0]}", erwartet "Gesamt"`)
  }
  const gruppen = namen.slice(1)

  const tage: KassenblattTag[] = []
  const abweichendeTage: KassenblattMonat['abweichende_tage'] = []
  let summe: number | null = null
  const summenzeile = `${MONATSNAMEN[monat - 1]} ${jahr}`
  const mm = String(monat).padStart(2, '0')

  for (const z of alle.slice(2)) {
    const c = zellen(z)
    const tag = (c[1] ?? '').match(/^\S+, (\d{2})\.(\d{2})\.$/)
    if (tag) {
      if (tag[2] !== mm) {
        throw new ParseFehler(`Kassenblatt: Tag ${tag[1]}.${tag[2]}. in der Tabelle für ${summenzeile}`)
      }
      const werte = c.slice(start, start + breite).map(betragVorKlammer)
      if (werte.length !== breite || werte.some(w => w === null)) {
        throw new ParseFehler(`Kassenblatt: ${tag[1]}.${mm}. ohne lesbare Umsatzzellen (${c.slice(start, start + breite).join(' | ')})`)
      }
      const [netto, ...rest] = werte as number[]
      const datum = `${jahr}-${mm}-${tag[1]}`
      const teile = Math.round(rest.reduce((a, b) => a + b, 0) * 100) / 100
      if (gruppen.length > 0 && Math.abs(netto - teile) > 0.01 * gruppen.length + 0.001) {
        abweichendeTage.push({ datum, netto, gruppen_summe: teile })
      }
      tage.push({
        datum,
        netto,
        gruppen: gruppen.map((name, i) => ({ name, netto: rest[i] })),
      })
      continue
    }
    if (c[0] === summenzeile) summe = betragVorKlammer(c[1] ?? '')
  }

  if (tage.length === 0) {
    if (summe === null || summe === 0) {
      return { monat: `${jahr}-${mm}-01`, gruppen, tage: [], summe: 0, abweichende_tage: [] }
    }
    throw new ParseFehler(`Kassenblatt: keine Tageszeilen für ${summenzeile}, Monatszeile nennt ${summe}`)
  }
  if (summe === null) throw new ParseFehler(`Kassenblatt: Summenzeile "${summenzeile}" fehlt`)
  const tagessumme = tage.reduce((a, t) => a + t.netto, 0)
  if (Math.abs(tagessumme - summe) > 0.01 * tage.length + 0.001) {
    throw new ParseFehler(
      `Kassenblatt: Summe der Tage ${tagessumme.toFixed(2)} ≠ Monatssumme ${summe} (${summenzeile})`)
  }

  return { monat: `${jahr}-${mm}-01`, gruppen, tage, summe, abweichende_tage: abweichendeTage }
}

export type KassenblattJahreswert = { monat: string; netto: number }

/**
 * „Die letzten Jahre" lesen (`/intranet/report/jahresuebersicht/laden/<hash>/admin/1/`):
 * Nettoumsatz je Monat, alle Jahre seit Beginn in EINEM Aufruf.
 *
 * Wozu: der Importer entscheidet daran, welche Monate er tageweise holen muss
 * — ein Aufruf je Betrieb statt einer je Betrieb und Monat. Eine leere Zelle
 * heißt „kein Umsatz erfasst" und wird ausgelassen, nicht als 0 geschrieben.
 *
 * DIE FILTERAUSWAHL WIRD GEPRÜFT. Das Formular darüber (Umsatzgruppe,
 * Umsatzart) wird per POST gesetzt; ob LINA die Wahl in der Sitzung behält,
 * ist nicht gemessen. Stünde dort „Getränke" oder „Tagesschnitt", wären die
 * Zahlen plausibel und falsch. Deshalb muss beides auf „Gesamtumsatz" stehen.
 */
export function kassenblattJahreLesen(html: string): KassenblattJahreswert[] {
  for (const name of ['show', 'show_ges']) {
    const w = gewaehlt(html, name)
    if (w !== '0') {
      throw new ParseFehler(
        `Jahresübersicht: Filter "${name}" steht auf "${w}", erwartet "0" (Gesamtumsatz). `
        + `Die Werte wären dann keine Gesamtumsätze je Monat.`)
    }
  }

  const tabelle = tabellen(html).find(t => {
    const k = zellen(zeilen(t)[0] ?? '')
    return k.length > 1 && k.slice(1).every(s => /^\d{4}$/.test(s))
  })
  if (!tabelle) throw new ParseFehler('Jahresübersicht: keine Tabelle mit Jahreskopfzeile gefunden')

  const alle = zeilen(tabelle)
  const jahre = zellen(alle[0]).slice(1).map(Number)
  const werte: KassenblattJahreswert[] = []
  const jeJahr = new Map<number, number>()
  let monateGefunden = 0
  let gesamt: (number | null)[] | null = null

  for (const z of alle.slice(1)) {
    const c = zellen(z)
    const i = MONATSNAMEN.findIndex(n => c[0] === `${n}:`)
    if (i >= 0) {
      if (c.length !== jahre.length + 1) {
        throw new ParseFehler(`Jahresübersicht: Zeile ${c[0]} hat ${c.length - 1} Werte für ${jahre.length} Jahre`)
      }
      monateGefunden++
      c.slice(1).forEach((zelle, j) => {
        const n = betragVorKlammer(zelle)
        if (zelle !== '' && n === null) {
          throw new ParseFehler(`Jahresübersicht: unlesbare Zelle "${zelle}" (${c[0]} ${jahre[j]})`)
        }
        if (n === null) return
        werte.push({ monat: `${jahre[j]}-${String(i + 1).padStart(2, '0')}-01`, netto: n })
        jeJahr.set(jahre[j], (jeJahr.get(jahre[j]) ?? 0) + n)
      })
    } else if (c[0] === 'Gesamt:') {
      gesamt = c.slice(1).map(betragVorKlammer)
    }
  }

  if (monateGefunden !== 12) throw new ParseFehler(`Jahresübersicht: ${monateGefunden} Monatszeilen statt 12`)
  if (!gesamt) throw new ParseFehler('Jahresübersicht: Zeile "Gesamt:" fehlt')
  jahre.forEach((j, k) => {
    const soll = gesamt![k] ?? 0
    const ist = jeJahr.get(j) ?? 0
    if (Math.abs(soll - ist) > 0.12) {
      throw new ParseFehler(`Jahresübersicht: ${j} Summe der Monate ${ist.toFixed(2)} ≠ Gesamt ${soll}`)
    }
  })
  return werte
}
