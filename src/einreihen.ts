/**
 * Zeiträume in die Warteschlange stellen.
 *
 *   bun run einreihen --taeglich
 *       Reiht die letzten NACHZUEGLER_TAGE Geschäftstage ein (Priorität 10),
 *       nicht nur gestern: LINAs Konzernberichte füllen sich über mehrere
 *       Tage, und ein zu früh geholter Tag bliebe sonst für immer auf null.
 *       Dazu die Jahresberichte und die monatlichen Momentaufnahmen.
 *       Läuft täglich per Schedule Job.
 *
 *   bun run einreihen --historie --von 2018-01-01 --bis 2026-07-24
 *       Reiht die Historie rückwärts ein (Priorität 90). Einmalig.
 *       Der Worker arbeitet sie ab, wann immer laufende Daten ihn in Ruhe lassen.
 */
import { query, eine, pool } from './db/pool'
import { config } from './config'
import { log } from './lib/log'
import { AKTIVE_ENDPUNKTE, istMomentaufnahme, einreihPrioritaet, historieSchrittweite } from './lina/endpunkte'
import { geschaeftstag } from './lib/time'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}


if (process.argv.includes('--taeglich')) {
  // Gestern bezogen auf den Geschäftstag, nicht den Kalendertag.
  const gestern = geschaeftstag(new Date(Date.now() - 24 * 3600 * 1000))

  /**
   * Ein gleitendes Fenster statt eines einzelnen Tages.
   *
   * LINAs Konzernberichte füllen sich über mehrere Tage — am 26.07.2026
   * gemessen: die letzten vier Tage komplett leer, der fünfte zu einem
   * Sechstel, erst ab dem siebten plausibel vollständig. Wer nur „gestern"
   * holt, schreibt Nullen fest, und weil der Posten danach erledigt ist,
   * bleiben sie für immer stehen. Zahlen dieser Sorte sind schlimmer als
   * fehlende: eine Lücke sieht man, eine Null nicht.
   *
   * `ON CONFLICT DO NOTHING` ist hier GENAU RICHTIG — und zwar aus demselben
   * Grund, aus dem es in `sync.historie_einreihen()` genau falsch war. Der
   * Eindeutigkeitsindex ist partiell (`WHERE erledigt_am IS NULL`), er
   * blockiert also nur noch OFFENE Posten. Für den Backfill hiess das: alles
   * Erledigte wird erneut geholt, ein teurer Fehler. Für das Nachlauffenster
   * heisst dasselbe: derselbe Tag wird nicht doppelt eingereiht, solange er
   * noch aussteht, aber sehr wohl erneut, wenn er fertig ist. Genau das soll
   * er. Die Zieltabellen sind Upserts, der zweite Abruf korrigiert den ersten.
   */
  const tage: string[] = []
  for (let i = 1; i <= config.NACHZUEGLER_TAGE; i++) {
    tage.push(geschaeftstag(new Date(Date.now() - i * 24 * 3600 * 1000)))
  }

  let n = 0
  for (const ep of AKTIVE_ENDPUNKTE) {
    if (ep.schrittweite !== 'tag') continue
    for (const tag of tage) {
      const r = await query(
        `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
         VALUES ($1, $2, $2, $3) ON CONFLICT DO NOTHING RETURNING posten_id`,
        [ep.key, tag, einreihPrioritaet(ep.key)])
      n += r.length
    }
  }
  // Kennzahlen laufen jahresweise und werden erneut geholt, weil die BWA
  // rückwirkend nachgebucht wird. Append-only fängt das ab.
  const jahr = gestern.slice(0, 4)
  for (const ep of AKTIVE_ENDPUNKTE.filter(e => e.schrittweite === 'jahr')) {
    const r = await query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING posten_id`,
      [ep.key, `${jahr}-01-01`, `${jahr}-12-31`, einreihPrioritaet(ep.key)])
    n += r.length
  }
  /**
   * Stammdaten-Momentaufnahmen laufen hier mit, brauchen also keinen eigenen
   * Zeitplan — aber sie dürfen NICHT täglich ziehen. Eine je Kalendermonat,
   * auf den Monatsersten gesetzt.
   *
   * `ON CONFLICT DO NOTHING` allein reicht dafür NICHT, auch wenn es so
   * aussieht: Der Eindeutigkeitsindex der Warteschlange ist partiell
   * (`WHERE erledigt_am IS NULL`). Ein ERLEDIGTER Posten blockiert also
   * nichts — der tägliche Lauf hätte am Folgetag munter denselben
   * Monatsersten neu eingereiht und die „monatliche" Momentaufnahme wäre in
   * Wahrheit täglich gelaufen: 7 Endpunkte × 30 Tage statt 7 Aufrufe.
   *
   * Die erste Fassung dieses Codes hat genau das getan und im Kommentar das
   * Gegenteil behauptet. Nachgemessen am 26.07.2026, nicht angenommen.
   *
   * Deshalb ausdrücklich gegen ALLE Posten desselben Zeitraums geprüft,
   * erledigte eingeschlossen. Für eine Momentaufnahme ist das die richtige
   * Aussage: je Zeitraum genau eine, ein für alle Mal.
   */
  const monatsErster = `${gestern.slice(0, 7)}-01`
  let m = 0
  for (const ep of AKTIVE_ENDPUNKTE.filter(istMomentaufnahme)) {
    const r = await query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
       SELECT $1, $2::date, $2::date, $3
        WHERE NOT EXISTS (
              SELECT 1 FROM sync.warteschlange
               WHERE endpunkt = $1 AND zeitraum_von = $2::date)
       RETURNING posten_id`,
      [ep.key, monatsErster, einreihPrioritaet(ep.key)])
    m += r.length
  }
  if (m > 0) log.info('momentaufnahmen eingereiht', { monat: monatsErster, posten: m })

  log.info('täglich eingereiht', {
    juengster: gestern, aeltester: tage[tage.length - 1], fenster: tage.length, posten: n + m,
  })
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
    // Die Historie darf gröber laufen als der Tagesbetrieb — siehe
    // `historieSchrittweite` im Berichtsregister.
    const schritt = historieSchrittweite(ep)
    const r = await eine<{ n: number }>(
      `SELECT sync.historie_einreihen($1, $2::date, $3::date, $4) AS n`,
      [ep.key, von, bis, schritt])
    log.info('historie eingereiht', { endpunkt: ep.key, schrittweite: schritt, posten: Number(r!.n) })
    gesamt += Number(r!.n)
  }
  log.info('historie gesamt', { von, bis, posten: gesamt })
}

await pool.end()
