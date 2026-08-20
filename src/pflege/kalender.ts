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
 * NUR DIE ZEHN BUNDESLÄNDER, in denen Betriebe stehen. Die Liste steht in der
 * Datenbank und nicht hier: `SELECT DISTINCT kuerzel` — kommt ein Land dazu,
 * kommt es von selbst mit.
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

/**
 * Ein Kalenderjahr je Anfrage, vom laufenden Jahr bis `vorlauf` Jahre voraus.
 *
 * Ganze Jahre und nicht „ab heute", weil die Schulferien eines Jahres als
 * Zeitraum kommen: wer am 20.08. bei `validFrom` einsteigt, verliert die
 * Sommerferien, die im Juli begonnen haben — und mit ihnen jede Angabe für
 * die Tage davor.
 */
export function spannen(vorlauf: number, heute = new Date()): Spanne[] {
  const jahr = heute.getUTCFullYear()
  const raus: Spanne[] = []
  for (let j = jahr; j <= jahr + vorlauf; j++) {
    raus.push({ jahr: j, von: `${j}-01-01`, bis: `${j}-12-31` })
  }
  return raus
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
 * 2027, einmal aus der von 2028. Beide Male identisch (am 20.08.2026 für alle
 * zehn Länder nachgesehen) — nur nimmt Postgres das nicht hin:
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
 * Feiertage und Schulferien bis `KALENDER_VORLAUF_JAHRE` Jahre voraus füllen.
 *
 * WIRFT NIE. Ein Kalender, der nicht nachgezogen werden konnte, ist kein Grund,
 * einen Importlauf zu beenden — die Fehler stehen im Rückgabewert und in
 * `mart.pflege_stand`.
 */
export async function kalenderNachziehen(): Promise<Kalenderstand> {
  const stand: Kalenderstand = { feiertage: 0, ferien: 0, fehler: [] }

  const laender = await query<{ kuerzel: string }>(
    `SELECT DISTINCT kuerzel FROM manual.feiertag
      UNION
     SELECT DISTINCT kuerzel FROM manual.schulferien
      ORDER BY 1`)
  if (laender.length === 0) {
    // Kein Bestand heisst: die Tabellen sind noch nie befuellt worden. Dann
    // gibt es auch keine Laenderliste, und Raten waere hier besonders
    // teuer — 16 Laender mal drei Jahre fuer Betriebe, die es nicht gibt.
    log.warn('kalender: keine Bundeslaender im Bestand — nichts nachzuziehen')
    return stand
  }

  const sp = spannen(config.KALENDER_VORLAUF_JAHRE)

  for (const { kuerzel } of laender) {
    const f = await jahrweise('PublicHolidays', kuerzel, sp)
    if (f.fehler) stand.fehler.push(f.fehler)
    const feiertage = f.eintraege.map(e => ({ d: e.startDate, n: name(e) })).filter(z => z.n)
    if (feiertage.length) {
      try {
        const r = await query(
          `INSERT INTO manual.feiertag (kuerzel, datum, name, quelle)
           SELECT $1, d::date, n, 'openholidaysapi.org'
             FROM unnest($2::text[], $3::text[]) AS x(d, n)
           ON CONFLICT (kuerzel, datum, name) DO NOTHING
           RETURNING datum`,
          [kuerzel, feiertage.map(z => z.d), feiertage.map(z => z.n)])
        stand.feiertage += r.length
      } catch (e) {
        stand.fehler.push(`Feiertage ${kuerzel} schreiben: ${String((e as Error).message ?? e).slice(0, 120)}`)
      }
    }

    const s = await jahrweise('SchoolHolidays', kuerzel, sp)
    if (s.fehler) stand.fehler.push(s.fehler)
    const ferien = einmalig(
      s.eintraege.map(e => ({ v: e.startDate, b: e.endDate, n: name(e) })).filter(z => z.n)
        // Der längste Zeitraum zuerst: sollte eine Scheibe einen Zeitraum doch
        // einmal beschneiden, gewinnt der ungekürzte.
        .sort((a, b) => b.b.localeCompare(a.b)),
      z => `${z.v}|${z.n}`)
    if (ferien.length) {
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
          [kuerzel, ferien.map(z => z.v), ferien.map(z => z.b), ferien.map(z => z.n)])
        stand.ferien += r.length
      } catch (e) {
        stand.fehler.push(`Schulferien ${kuerzel} schreiben: ${String((e as Error).message ?? e).slice(0, 120)}`)
      }
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
