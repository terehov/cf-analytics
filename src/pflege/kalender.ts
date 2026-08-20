/**
 * Feiertage und Schulferien nachziehen — ohne Handbefehl.
 *
 * DER BEFUND. `manual.feiertag` reicht bis zum 26.12.2027, `manual.schulferien`
 * bis zum 11.01.2028. Beide sind einmal befüllt worden und werden von keinem
 * Code fortgeschrieben. Das reicht noch anderthalb Jahre — und genau das ist
 * die gefährliche Sorte Frist: sie läuft irgendwann aus, und wer dann auf die
 * Umsatzentwicklung sieht, vergleicht einen Feiertag mit einem Werktag, ohne
 * dass irgendetwas rot wird.
 *
 * DIE QUELLE IST DIESELBE WIE VORHER. `manual.feiertag.quelle` nennt zwei:
 * `openholidaysapi.org` und `feiertage-api.de`. Genommen wird die erste — sie
 * liefert **beides** (Feiertage und Schulferien) über denselben Weg, ist frei,
 * braucht keinen Schlüssel und keine Anmeldung, und stellt die Jahre weit im
 * Voraus bereit (am 14.08.2026 nachgesehen: 2029 vollständig).
 *
 * WARUM JAHR FÜR JAHR UND NICHT IN EINEM ZUG — nachgetragen am 20.08.2026.
 * Die erste Fassung holte die ganze Reichweite mit einem Aufruf je Land und
 * Endpunkt: `validFrom=2026-01-01&validTo=2029-12-31`. Die Schnittstelle
 * beantwortet das nicht, sie weist es ab:
 *
 *     HTTP 400 — "The maximum date range is 1095 days."
 *
 * Bei `KALENDER_VORLAUF_JAHRE=3` sind es 1460 Tage. Damit scheiterten **alle
 * zwanzig** Aufrufe jeder Nacht, seit `0079` läuft; geschrieben wurde nie eine
 * Zeile. Aufgefallen ist es nicht, weil der Bestand noch bis Ende 2027 reicht
 * und `mart.pflege_stand` deshalb `ok` sagt — die Prüfzeile hätte erst im
 * Februar 2027 angeschlagen.
 *
 * Die Spanne auf zwei Jahre zu kürzen träfe die Grenze auf den Tag genau
 * (1095) und fiele beim nächsten Schaltjahr wieder um. Deshalb eine Anfrage je
 * Kalenderjahr: höchstens 366 Tage, unabhängig vom eingestellten Vorlauf.
 *
 * WAS NICHT ÜBERSCHRIEBEN WIRD. Die vorhandenen Zeilen tragen zwei
 * Schreibweisen desselben Tages („1. Weihnachtsfeiertag" gegen „1.
 * Weihnachtstag", „Neujahr" gegen „Neujahrstag") — die Spur der zwei Quellen.
 * Der Primärschlüssel enthält den Namen, ein Upsert legt also im Zweifel eine
 * zweite Zeile an statt die erste zu ändern. Das ist hier richtig: eine
 * Umbenennung des Bestands wäre eine Korrektur an Daten, die seit 2018 in
 * Auswertungen stecken, und sie wäre nicht umkehrbar.
 *
 * ALLE SECHZEHN BUNDESLÄNDER, nicht nur die zehn mit Betrieben — entschieden
 * am 20.08.2026. Die Liste stand vorher in der Datenbank (`SELECT DISTINCT
 * kuerzel`), was zwei Nachteile hatte: ein neues Land wäre erst nachgezogen
 * worden, NACHDEM jemand seine Feiertage von Hand eingetragen hätte, und leere
 * Tabellen hätten den Nachzug ganz abgeschaltet. Sie kommt jetzt aus
 * `/Subdivisions` derselben Schnittstelle — 16 Länder, eine Anfrage, keine
 * Liste im Code, die veralten kann.
 *
 * WIE WEIT ZURÜCK. Zwei verschiedene Böden, und der Grund liegt in der Quelle:
 * Schulferien reichen dort bis 2016, Feiertage erst bis 2020 (am 20.08.2026
 * nachgemessen: `PublicHolidays` für 2016 bis 2019 liefert null Einträge, für
 * 2020 zwölf). Ein Boden weiter unten wäre nicht Ehrgeiz, sondern eine
 * Anfrage, die jeden Monat leer zurückkommt.
 *
 * Der Nachzug holt deshalb NICHT nur die kommenden Jahre, sondern auch jedes
 * Jahr der Historie, das noch keine Zeile hat — so füllt sich ein neues Land
 * von selbst bis zum Boden auf, ohne Handbefehl und ohne Migration. Die
 * Obergrenze dafür ist `KALENDER_ABRUFE_MAX`, kein Schalter.
 */
import { query, eine } from '../db/pool'
import { config } from '../config'
import { log } from '../lib/log'

const BASIS = 'https://openholidaysapi.org'

/**
 * Die Obergrenze der Schnittstelle für EINE Anfrage, in Tagen. Gemessen am
 * 20.08.2026 gegen `PublicHolidays` und `SchoolHolidays`: 1095 Tage gehen
 * durch, 1096 werden mit HTTP 400 abgewiesen. Die Zahl steht hier, damit der
 * Test sie prüfen kann — nicht, weil irgendwo bis an sie herangegangen wird.
 */
export const MAX_SPANNE_TAGE = 1095

export type Spanne = { jahr: number; von: string; bis: string }
export type Auftrag = Spanne & { kuerzel: string }

/**
 * Das erste Jahr, das die Quelle je Endpunkt kennt. Nachgemessen am
 * 20.08.2026 gegen DE-BW:
 *
 *   Jahr   PublicHolidays   SchoolHolidays
 *   2016              0                 8
 *   2019              0                 6
 *   2020             12                 6
 *
 * Feiertage vor 2020 gibt es dort nicht — 2018 und 2019 kamen bis zum
 * 20.08.2026 aus feiertage-api.de und sind mit `0086` entfallen. Der Boden für
 * die Ferien liegt ein Jahr unter dem Beginn der Umsatzhistorie, weil die
 * Weihnachtsferien über den Jahreswechsel laufen: die Ferienlage des 02.01.2018
 * steht in einem Zeitraum, der am 21.12.2017 beginnt.
 */
export const BODEN = { PublicHolidays: 2020, SchoolHolidays: 2017 } as const
export type Endpunkt = keyof typeof BODEN

/**
 * Was dieser Lauf abzurufen hat — je Land und Jahr eine Anfrage.
 *
 * ZWEI SORTEN, UND DIE REIHENFOLGE IST DIE AUSSAGE:
 *
 *   1. Das laufende Jahr und der Vorlauf. IMMER, auch wenn schon Zeilen da
 *      sind — ein Land kann einen Feiertag einführen (Thüringen hat 2019 den
 *      Weltkindertag bekommen), und Ferientermine werden nachgeschoben.
 *   2. Jedes Jahr der Historie OHNE eine einzige Zeile, das jüngste zuerst.
 *      Ein Jahr, das schon Zeilen hat, wird nicht erneut geholt: die
 *      Vergangenheit ändert sich nicht mehr, und 16 Länder mal neun Jahre
 *      wären jede Nacht 144 Anfragen für nichts.
 *
 * DIE OBERGRENZE SCHNEIDET HINTEN AB, nicht vorn. Was wegfällt, ist damit
 * immer das Älteste — und der nächste Lauf holt es nach, weil es weiter
 * fehlt. Ein Rückstand baut sich ab, ohne dass jemand etwas startet.
 */
export function abrufplan(o: {
  laender: string[]
  vorhanden: ReadonlySet<string>   // "BW|2021"
  boden: number
  jahr: number
  vorlauf: number
  hoechstens: number
}): Auftrag[] {
  const spanne = (kuerzel: string, jahr: number): Auftrag =>
    ({ kuerzel, jahr, von: `${jahr}-01-01`, bis: `${jahr}-12-31` })

  const jetzt: Auftrag[] = []
  const historie: Auftrag[] = []
  for (const kuerzel of o.laender) {
    for (let j = o.jahr; j <= o.jahr + o.vorlauf; j++) jetzt.push(spanne(kuerzel, j))
    for (let j = o.jahr - 1; j >= o.boden; j--) {
      if (!o.vorhanden.has(`${kuerzel}|${j}`)) historie.push(spanne(kuerzel, j))
    }
  }
  // Das jüngste fehlende Jahr zuerst, quer über alle Länder — sonst füllt
  // sich Baden-Württemberg bis 2020 auf, während Sachsen noch bei 2025 steht.
  historie.sort((a, b) => b.jahr - a.jahr)
  return [...jetzt, ...historie].slice(0, o.hoechstens)
}

/** Die Adresse eines Abrufs. Ausgelagert, damit der Test sie sehen kann. */
export function abrufUrl(pfad: string, land: string, von: string, bis: string): string {
  return `${BASIS}/${pfad}?countryIsoCode=DE&languageIsoCode=DE`
       + `&validFrom=${von}&validTo=${bis}&subdivisionCode=DE-${land}`
}

type Eintrag = {
  startDate: string
  endDate: string
  name: { language: string; text: string }[]
  /** Schulform, nur in MV besetzt: DE-MV-ABS (allgemeinbildend), -BBS (berufsbildend). */
  groups?: { code: string }[]
  /** Regionale Einschränkung im Klartext, z. B. „Inseln Sylt, Föhr, Amrum …". */
  comment?: { language: string; text: string }[]
}

/**
 * Wie weit ein Ferieneintrag gilt: 0 = im ganzen Land, 2 = für einen Teil.
 *
 * ZWEI LÄNDER FÜHREN VARIANTEN, und sie tun es auf zwei verschiedene Arten
 * (am 20.08.2026 über alle 16 Länder und vier Jahre nachgesehen — nur diese
 * beiden):
 *
 *   MV  zwei Schulformen mit eigenen Terminen. Sommerferien 2025:
 *       14.07.–30.08. für die allgemeinbildenden (ABS), 28.07.–06.09. für die
 *       berufsbildenden (BBS). Steht in `groups`.
 *   SH  eine Inselvariante. Herbstferien 2024: ab 14.10. für Sylt, Föhr,
 *       Amrum, Helgoland und die Halligen, ab 21.10. für das übrige Land.
 *       Steht im Klartext in `comment`.
 *
 * Genommen wird die weiteste: ein Betrieb hängt an einem Bundesland, nicht an
 * einer Schulform und nicht an einer Insel. Die engere Variante fällt weg,
 * sonst zählt ein Land Ferien, sobald IRGENDEINE Teilmenge frei hat — in MV
 * wären das 2025 acht Wochen Sommer statt sieben.
 */
const reichweite = (e: Eintrag): number => {
  const g = (e.groups ?? []).map(x => x.code)
  if (g.length === 0 && !e.comment?.length) return 0
  return g.some(c => c.endsWith('-ABS')) ? 1 : 2
}

/**
 * Von mehreren Varianten desselben Ferienzeitraums bleibt die weiteste.
 *
 * ÜBER DIE ÜBERSCHNEIDUNG UND NICHT ÜBER DEN MONAT: die beiden SH-Herbstferien
 * 2018 beginnen am 24.09. und am 01.10. — nach Monaten gruppiert wären sie
 * zwei Ereignisse, nach Namen allein fielen die Weihnachtsferien im Januar mit
 * denen im Dezember zusammen. Was zusammengehört, überlappt sich; das ist die
 * einzige Regel, die in beiden Fällen stimmt.
 */
export function ohneVarianten<T extends { v: string; b: string; n: string | null; r: number }>(zeilen: T[]): T[] {
  const behalten: T[] = []
  // Weiteste Geltung zuerst, bei Gleichstand der längere Zeitraum.
  for (const z of [...zeilen].sort((a, b) => a.r - b.r || (b.b > a.b ? 1 : b.b < a.b ? -1 : 0))) {
    if (behalten.some(x => x.n === z.n && x.v <= z.b && z.v <= x.b)) continue
    behalten.push(z)
  }
  return behalten
}

/**
 * Ein Aufruf gegen die offene Schnittstelle.
 *
 * KEIN RETRY UND KEIN EIGENES TEMPO. Es sind zwei Aufrufe je Bundesland, Jahr
 * und Endpunkt, einmal im Monat — bei zehn Ländern und vier Jahren sind das
 * 80. Wer dafür eine Drosselung baut, baut sie für nichts. Ein Fehlschlag wird
 * geworfen; der Aufrufer sammelt ihn ein und der nächste Lauf versucht es
 * erneut.
 */
async function holen(pfad: string, land: string, s: Spanne): Promise<Eintrag[]> {
  const r = await fetch(abrufUrl(pfad, land, s.von, s.bis), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(config.ANFRAGE_TIMEOUT_MS),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return await r.json() as Eintrag[]
}

type Abruf = { eintraege: Eintrag[]; fehler: string | null }

/**
 * Alle Jahre eines Endpunkts für ein Land.
 *
 * EIN GESCHEITERTES JAHR HÄLT DIE ANDEREN NICHT AUF. Das ist kein Luxus: die
 * Länder veröffentlichen ihre Ferientermine unterschiedlich weit voraus, und
 * ein Land, dessen letztes Jahr noch fehlt, würde sonst nie eines seiner
 * früheren Jahre nachziehen.
 *
 * DIE FEHLER WERDEN ZU EINER MELDUNG ZUSAMMENGEZOGEN, weil der Aufrufer sie
 * zählt: `nachlauf.ts` setzt den Merker nur, wenn höchstens eine Meldung
 * ansteht. Drei Zeilen für ein einziges hakendes Land würden diese Schwelle
 * bedeutungslos machen.
 */
async function jahrweise(pfad: string, land: string, sp: Spanne[]): Promise<Abruf> {
  const eintraege: Eintrag[] = []
  const gescheitert: string[] = []
  for (const s of sp) {
    try {
      eintraege.push(...await holen(pfad, land, s))
    } catch (e) {
      gescheitert.push(`${s.jahr}: ${String((e as Error).message ?? e).slice(0, 60)}`)
    }
  }
  return {
    eintraege,
    fehler: gescheitert.length === 0 ? null
      : `${pfad} ${land} — ${gescheitert.join('; ')}`.slice(0, 200),
  }
}

/**
 * Dieselbe Zeile nur einmal — je Schlüssel gewinnt die erste.
 *
 * DER GRUND STEHT IM JAHRESWECHSEL. Die Schnittstelle liefert jeden Zeitraum,
 * der die angefragte Spanne BERÜHRT, ungekürzt zurück. Die Weihnachtsferien
 * vom 23.12.2027 bis 08.01.2028 kommen deshalb zweimal: einmal aus der Scheibe
 * 2027, einmal aus der von 2028. Beide Male identisch (am 20.08.2026 über alle
 * Länder des Bestands nachgesehen) — nur nimmt Postgres das nicht hin:
 *
 *     ON CONFLICT DO UPDATE command cannot affect row a second time
 *
 * Und es scheitert nicht die Zeile, sondern die ganze Anweisung. Ohne diesen
 * Schritt schreibt der Nachzug die Feiertage und bei den Ferien NICHTS.
 *
 * Einzeltage brauchen das nicht: ein Datum liegt in genau einer Scheibe.
 */
export function einmalig<T>(zeilen: T[], schluessel: (z: T) => string): T[] {
  const m = new Map<string, T>()
  for (const z of zeilen) {
    const s = schluessel(z)
    if (!m.has(s)) m.set(s, z)
  }
  return [...m.values()]
}

/** Der deutsche Name. Ohne ihn ist der Eintrag für uns wertlos. */
const name = (e: Eintrag): string | null =>
  e.name?.find(n => n.language === 'DE')?.text ?? e.name?.[0]?.text ?? null

export type Kalenderstand = { feiertage: number; ferien: number; fehler: string[] }

/**
 * Die sechzehn Bundesländer, aus derselben Quelle wie die Termine.
 *
 * FÄLLT DIE ANFRAGE AUS, wird der Bestand gefragt. Das ist kein zweiter Weg,
 * sondern derselbe von gestern: die Länder stehen ja schon in der Tabelle. Nur
 * wenn beides leer ist, gibt es nichts zu tun — und dann ist Raten das
 * Falscheste, was der Nachzug tun könnte.
 */
async function laender(stand: Kalenderstand): Promise<string[]> {
  try {
    const r = await fetch(`${BASIS}/Subdivisions?countryIsoCode=DE&languageIsoCode=DE`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(config.ANFRAGE_TIMEOUT_MS),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const liste = (await r.json() as { code?: string }[])
      .map(x => x.code?.replace(/^DE-/, ''))
      .filter((x): x is string => !!x && /^[A-Z]{2}$/.test(x))
    if (liste.length === 0) throw new Error('keine Subdivisions in der Antwort')
    return liste.sort()
  } catch (e) {
    stand.fehler.push(`Subdivisions: ${String((e as Error).message ?? e).slice(0, 80)}`)
    const r = await query<{ kuerzel: string }>(
      `SELECT DISTINCT kuerzel FROM manual.feiertag
        UNION
       SELECT DISTINCT kuerzel FROM manual.schulferien
        ORDER BY 1`)
    if (r.length === 0) {
      log.warn('kalender: weder Subdivisions noch Bestand — nichts nachzuziehen')
    }
    return r.map(x => x.kuerzel)
  }
}

/** Welche Land-Jahr-Paare schon Zeilen haben. Der Rest ist der Rückstand. */
async function belegt(sql: string): Promise<Set<string>> {
  const r = await query<{ kuerzel: string; jahr: number }>(sql)
  return new Set(r.map(x => `${x.kuerzel}|${x.jahr}`))
}

/** Die Aufträge eines Plans nach Land bündeln — ein INSERT je Land. */
function nachLand(plan: Auftrag[]): Map<string, Spanne[]> {
  const m = new Map<string, Spanne[]>()
  for (const a of plan) m.set(a.kuerzel, [...(m.get(a.kuerzel) ?? []), a])
  return m
}


/**
 * Feiertage und Schulferien nachziehen: den Vorlauf immer, die Historie, wo
 * sie fehlt.
 *
 * WIRFT NIE. Ein Kalender, der nicht nachgezogen werden konnte, ist kein Grund,
 * einen Importlauf zu beenden — die Fehler stehen im Rückgabewert und in
 * `mart.pflege_stand`.
 */
export async function kalenderNachziehen(): Promise<Kalenderstand> {
  const stand: Kalenderstand = { feiertage: 0, ferien: 0, fehler: [] }

  const liste = await laender(stand)
  if (liste.length === 0) return stand

  const gemeinsam = {
    laender: liste,
    jahr: new Date().getUTCFullYear(),
    vorlauf: config.KALENDER_VORLAUF_JAHRE,
    hoechstens: config.KALENDER_ABRUFE_MAX,
  }

  const planF = abrufplan({
    ...gemeinsam,
    boden: BODEN.PublicHolidays,
    vorhanden: await belegt(
      `SELECT kuerzel, extract(year FROM datum)::int AS jahr
         FROM manual.feiertag GROUP BY 1, 2`),
  })
  for (const [kuerzel, sp] of nachLand(planF)) {
    const f = await jahrweise('PublicHolidays', kuerzel, sp)
    if (f.fehler) stand.fehler.push(f.fehler)
    const zeilen = f.eintraege.map(e => ({ d: e.startDate, n: name(e) })).filter(z => z.n)
    if (zeilen.length === 0) continue
    try {
      const r = await query(
        `INSERT INTO manual.feiertag (kuerzel, datum, name, quelle)
         SELECT $1, d::date, n, 'openholidaysapi.org'
           FROM unnest($2::text[], $3::text[]) AS x(d, n)
         ON CONFLICT (kuerzel, datum, name) DO NOTHING
         RETURNING datum`,
        [kuerzel, zeilen.map(z => z.d), zeilen.map(z => z.n)])
      stand.feiertage += r.length
    } catch (e) {
      stand.fehler.push(`Feiertage ${kuerzel} schreiben: ${String((e as Error).message ?? e).slice(0, 120)}`)
    }
  }

  const planS = abrufplan({
    ...gemeinsam,
    boden: BODEN.SchoolHolidays,
    vorhanden: await belegt(
      `SELECT kuerzel, extract(year FROM von)::int AS jahr
         FROM manual.schulferien GROUP BY 1, 2`),
  })
  for (const [kuerzel, sp] of nachLand(planS)) {
    const s = await jahrweise('SchoolHolidays', kuerzel, sp)
    if (s.fehler) stand.fehler.push(s.fehler)
    const zeilen = einmalig(
      ohneVarianten(s.eintraege
        .map(e => ({ v: e.startDate, b: e.endDate, n: name(e), r: reichweite(e) }))
        .filter(z => z.n))
        // Der längste Zeitraum zuerst: sollte eine Scheibe einen Zeitraum doch
        // einmal beschneiden, gewinnt der ungekürzte.
        .sort((a, b) => b.b.localeCompare(a.b)),
      z => `${z.v}|${z.n}`)
    if (zeilen.length === 0) continue
    try {
      const r = await query(
        `INSERT INTO manual.schulferien (kuerzel, von, bis, name, quelle)
         SELECT $1, v::date, b::date, n, 'openholidaysapi.org'
           FROM unnest($2::text[], $3::text[], $4::text[]) AS x(v, b, n)
         ON CONFLICT (kuerzel, von, name) DO UPDATE SET bis = excluded.bis
           -- Nur schreiben, was sich WIRKLICH aendert. Ohne diese Zeile
           -- meldet der Lauf jeden Monat dieselben 245 Ferienzeitraeume als
           -- Arbeit, und ein Blick ins Log kann Bewegung nicht von Stillstand
           -- unterscheiden.
           WHERE manual.schulferien.bis IS DISTINCT FROM excluded.bis
         RETURNING von`,
        [kuerzel, zeilen.map(z => z.v), zeilen.map(z => z.b), zeilen.map(z => z.n)])
      stand.ferien += r.length
    } catch (e) {
      stand.fehler.push(`Schulferien ${kuerzel} schreiben: ${String((e as Error).message ?? e).slice(0, 120)}`)
    }
  }

  return stand
}

/**
 * Ist der Kalender fällig? Monatlich reicht: die Länder veröffentlichen ihre
 * Ferientermine Jahre im Voraus, und ein Feiertag verschiebt sich nicht.
 */
export async function kalenderFaellig(): Promise<boolean> {
  const r = await eine<{ faellig: boolean }>(
    `SELECT coalesce((wert->>'am')::timestamptz < now() - ($1 || ' days')::interval, true)
              AS faellig
       FROM sync.merker WHERE schluessel = 'kalender_nachgezogen'`,
    [config.KALENDER_ABSTAND_TAGE])
  return r === null || r.faellig === true
}
