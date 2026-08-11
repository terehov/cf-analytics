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
