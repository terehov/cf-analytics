/**
 * Zeiträume in die Warteschlange stellen.
 *
 *   bun run einreihen --taeglich
 *       Reiht die laufenden Daten beider Systeme ein: LINAs letzte
 *       NACHZUEGLER_TAGE Geschäftstage samt Jahresberichten und
 *       Momentaufnahmen, und FoodNotifys jeweils letzte Bestellseite.
 *
 *       BRAUCHT MAN IN DER REGEL NICHT MEHR: seit dem 02.08.2026 macht
 *       `bun run sync` genau das zu Beginn jedes Laufs selbst
 *       (src/sync/nachfuellen.ts). Der Befehl bleibt für den Fall, dass
 *       man nur füllen und nicht abarbeiten will — etwa um vor einem
 *       Lauf zu sehen, was anstünde.
 *
 *   bun run einreihen --historie --von 2018-01-01 --bis 2026-07-24
 *       Reiht LINAs Historie rückwärts ein (Priorität 90). Einmalig.
 *
 *   bun run einreihen --foodnotify
 *       Startet den FoodNotify-Backfill. Einmalig.
 *
 * Die beiden Backfills bleiben ausdrücklich Handarbeit: sie stellen
 * Zehntausende Posten ein, und das soll eine Entscheidung sein, kein
 * Nebeneffekt eines Neustarts.
 */
import { query, eine, pool } from './db/pool'
import { log } from './lib/log'
import { AKTIVE_ENDPUNKTE, istMomentaufnahme } from './lina/endpunkte'
import { geschaeftstag } from './lib/time'
import { linaNachfuellen, foodnotifyNachfuellen } from './sync/nachfuellen'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}


if (process.argv.includes('--taeglich')) {
  // Dieselben Funktionen, die `bun run sync` als Vorlauf ausführt — eine
  // zweite Kopie derselben Einreihlogik wäre die Sorte Verdopplung, bei
  // der eine Seite irgendwann still hinter der anderen zurückbleibt.
  const lina = await linaNachfuellen()
  const fn = await foodnotifyNachfuellen()
  log.info('täglich eingereiht', {
    lina, foodnotify: fn,
    hinweis: 'bun run sync macht das seit dem 02.08.2026 von selbst',
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
    const r = await eine<{ n: number }>(
      `SELECT sync.historie_einreihen($1, $2::date, $3::date, $4) AS n`,
      [ep.key, von, bis, ep.schrittweite])
    log.info('historie eingereiht', { endpunkt: ep.key, schrittweite: ep.schrittweite, posten: Number(r!.n) })
    gesamt += Number(r!.n)
  }
  log.info('historie gesamt', { von, bis, posten: gesamt })
}

/**
 *   bun run einreihen --foodnotify
 *       Reiht je konfigurierter Marke (FN_*_USER/_PASSWORD gesetzt) die vier
 *       Organisationsposten ein (A1: Profil, Betriebe, Kostenstellen,
 *       POS-Standorte). ALLES WEITERE STEUERT SICH SELBST: die Kostenstellen
 *       reihen die erste Bestellseite je erpId ein, jede Seite ihre Köpfe,
 *       Positionen und die Folgeseite (src/foodnotify/laden.ts).
 *
 *       Idempotent über NOT EXISTS gegen ALLE Posten — ein zweiter Aufruf
 *       reiht nichts erneut ein, was schon lief. Wer die Momentaufnahmen
 *       bewusst aktualisieren will (neue Kostenstelle, neue Kasse), löscht
 *       die alten fn:-Posten oder wartet auf den späteren Abgleichslauf.
 */
if (process.argv.includes('--foodnotify')) {
  const { fnZugaenge } = await import('./config')
  const zugaenge = fnZugaenge()
  if (zugaenge.length === 0) {
    log.error('keine FoodNotify-Marke konfiguriert — FN_*_USER/_PASSWORD setzen (.env.example)')
  }
  const heute = geschaeftstag(new Date())
  let gesamt = 0
  for (const z of zugaenge) {
    const marke = await eine<{ marke_key: number }>(
      `SELECT marke_key FROM core.marke WHERE schluessel = $1`, [z.schluessel])
    if (!marke) {
      log.error('marke fehlt in core.marke — Migration 0030 angewendet?', { marke: z.schluessel })
      continue
    }
    let n = 0
    const { fnEndpunkt } = await import('./foodnotify/endpunkte')
    for (const ep of ['fn:profil', 'fn:betriebe', 'fn:kostenstellen', 'fn:pos_standorte']) {
      const r = await query(
        `INSERT INTO sync.warteschlange
           (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
         SELECT $1, $2::date, $2::date, $4, $3, '{}'::jsonb
          WHERE NOT EXISTS (
                SELECT 1 FROM sync.warteschlange w
                 WHERE w.endpunkt = $1 AND w.marke_key = $3 AND w.parameter = '{}'::jsonb)
         RETURNING posten_id`,
        [ep, heute, marke.marke_key, fnEndpunkt(ep).prioritaet])
      n += r.length
    }
    log.info('foodnotify eingereiht', { marke: z.schluessel, posten: n })
    gesamt += n
  }
  log.info('foodnotify gesamt', {
    marken: zugaenge.map(z => z.schluessel), posten: gesamt,
    hinweis: 'der Bestellungs-Backfill folgt von selbst aus fn:kostenstellen',
  })
}

await pool.end()
