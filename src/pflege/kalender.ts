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

type Eintrag = {
  startDate: string
  endDate: string
  name: { language: string; text: string }[]
}

/**
 * Ein Aufruf gegen die offene Schnittstelle.
 *
 * KEIN RETRY UND KEIN EIGENES TEMPO. Es sind zwei Aufrufe je Bundesland und
 * Jahr, einmal im Monat — bei zehn Ländern und drei Jahren sind das 60. Wer
 * dafür eine Drosselung baut, baut sie für nichts. Ein Fehlschlag wird
 * geworfen; der Aufrufer sammelt ihn ein und der nächste Lauf versucht es
 * erneut.
 */
async function holen(pfad: string, land: string, von: string, bis: string): Promise<Eintrag[]> {
  const url = `${BASIS}/${pfad}?countryIsoCode=DE&languageIsoCode=DE`
            + `&validFrom=${von}&validTo=${bis}&subdivisionCode=DE-${land}`
  const r = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(config.ANFRAGE_TIMEOUT_MS),
  })
  if (!r.ok) throw new Error(`${pfad} ${land}: HTTP ${r.status}`)
  return await r.json() as Eintrag[]
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

  const jahr = new Date().getFullYear()
  const von = `${jahr}-01-01`
  const bis = `${jahr + config.KALENDER_VORLAUF_JAHRE}-12-31`

  for (const { kuerzel } of laender) {
    try {
      const f = await holen('PublicHolidays', kuerzel, von, bis)
      const zeilen = f.map(e => ({ d: e.startDate, n: name(e) })).filter(z => z.n)
      if (zeilen.length) {
        const r = await query(
          `INSERT INTO manual.feiertag (kuerzel, datum, name, quelle)
           SELECT $1, d::date, n, 'openholidaysapi.org'
             FROM unnest($2::text[], $3::text[]) AS x(d, n)
           ON CONFLICT (kuerzel, datum, name) DO NOTHING
           RETURNING datum`,
          [kuerzel, zeilen.map(z => z.d), zeilen.map(z => z.n)])
        stand.feiertage += r.length
      }
    } catch (e) {
      stand.fehler.push(`Feiertage ${kuerzel}: ${String((e as Error).message ?? e).slice(0, 120)}`)
    }

    try {
      const s = await holen('SchoolHolidays', kuerzel, von, bis)
      const zeilen = s.map(e => ({ v: e.startDate, b: e.endDate, n: name(e) })).filter(z => z.n)
      if (zeilen.length) {
        const r = await query(
          `INSERT INTO manual.schulferien (kuerzel, von, bis, name, quelle)
           SELECT $1, v::date, b::date, n, 'openholidaysapi.org'
             FROM unnest($2::text[], $3::text[], $4::text[]) AS x(v, b, n)
           ON CONFLICT (kuerzel, von, name) DO UPDATE SET bis = excluded.bis
           RETURNING von`,
          [kuerzel, zeilen.map(z => z.v), zeilen.map(z => z.b), zeilen.map(z => z.n)])
        stand.ferien += r.length
      }
    } catch (e) {
      stand.fehler.push(`Schulferien ${kuerzel}: ${String((e as Error).message ?? e).slice(0, 120)}`)
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
