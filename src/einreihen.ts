/**
 * Zeiträume in die Warteschlange stellen.
 *
 *   bun run einreihen --taeglich
 *       Reiht den gestrigen Geschäftstag für alle aktiven Endpunkte ein
 *       (Priorität 10). Läuft täglich per Schedule Job.
 *
 *   bun run einreihen --historie --von 2018-01-01 --bis 2026-07-24
 *       Reiht die Historie rückwärts ein (Priorität 90). Einmalig.
 *       Der Worker arbeitet sie ab, wann immer laufende Daten ihn in Ruhe lassen.
 */
import { query, eine, pool } from './db/pool'
import { log } from './lib/log'
import { AKTIVE_ENDPUNKTE, istMomentaufnahme } from './lina/endpunkte'
import { geschaeftstag } from './lib/time'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

if (process.argv.includes('--taeglich')) {
  // Gestern bezogen auf den Geschäftstag, nicht den Kalendertag.
  const gestern = geschaeftstag(new Date(Date.now() - 24 * 3600 * 1000))
  let n = 0
  for (const ep of AKTIVE_ENDPUNKTE) {
    if (ep.schrittweite !== 'tag') continue
    const r = await query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
       VALUES ($1, $2, $2, 10) ON CONFLICT DO NOTHING RETURNING posten_id`, [ep.key, gestern])
    n += r.length
  }
  // Kennzahlen laufen jahresweise und werden erneut geholt, weil die BWA
  // rückwirkend nachgebucht wird. Append-only fängt das ab.
  const jahr = gestern.slice(0, 4)
  for (const ep of AKTIVE_ENDPUNKTE.filter(e => e.schrittweite === 'jahr')) {
    const r = await query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
       VALUES ($1, $2, $3, 10) ON CONFLICT DO NOTHING RETURNING posten_id`,
      [ep.key, `${jahr}-01-01`, `${jahr}-12-31`])
    n += r.length
  }
  // Stammdaten-Momentaufnahmen: einmal je Kalendermonat, auf den Monatsersten
  // gesetzt. Der Eindeutigkeitsindex der Warteschlange sorgt dafür, dass der
  // tägliche Lauf sie ab dem zweiten Tag des Monats stillschweigend überspringt
  // — deshalb genügt es, sie hier mitlaufen zu lassen, ohne eigenen Zeitplan.
  const monatsErster = `${gestern.slice(0, 7)}-01`
  let m = 0
  for (const ep of AKTIVE_ENDPUNKTE.filter(istMomentaufnahme)) {
    const r = await query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
       VALUES ($1, $2, $2, 10) ON CONFLICT DO NOTHING RETURNING posten_id`,
      [ep.key, monatsErster])
    m += r.length
  }
  if (m > 0) log.info('momentaufnahmen eingereiht', { monat: monatsErster, posten: m })

  log.info('täglich eingereiht', { geschaeftstag: gestern, posten: n + m })
}

if (process.argv.includes('--historie')) {
  const von = arg('von') ?? '2018-01-01'
  const bis = arg('bis') ?? geschaeftstag(new Date(Date.now() - 24 * 3600 * 1000))
  let gesamt = 0
  for (const ep of AKTIVE_ENDPUNKTE) {
    // Momentaufnahmen haben keine Vergangenheit. LINA überschreibt Stammdaten,
    // ein Aufruf liefert immer den heutigen Stand — 100 Backfill-Posten dafür
    // würden 100-mal dasselbe holen und die Historie trotzdem nicht herstellen.
    if (istMomentaufnahme(ep)) {
      log.info('historie übersprungen — Momentaufnahme ohne Vergangenheit', { endpunkt: ep.key })
      continue
    }
    const r = await eine<{ n: number }>(
      `SELECT sync.historie_einreihen($1, $2::date, $3::date, $4) AS n`,
      [ep.key, von, bis, ep.schrittweite])
    log.info('historie eingereiht', { endpunkt: ep.key, schrittweite: ep.schrittweite, posten: Number(r!.n) })
    gesamt += Number(r!.n)
  }
  log.info('historie gesamt', { von, bis, posten: gesamt })
}

await pool.end()
