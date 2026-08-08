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
 *   bun run einreihen --foodnotify-inventuren
 *       Startet den Inventur-Backfill (B1, Stufe 4). Eigener Schalter,
 *       nicht Teil von --foodnotify: lohnend fast nur bei Wilma Wunder
 *       (275 Stück), bei den anderen drei Marken kaum. Einmalig.
 *
 * Die drei Backfills bleiben ausdrücklich Handarbeit: sie stellen
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

/**
 *   bun run einreihen --foodnotify-inventuren
 *       Reiht je konfigurierter Marke EINEN fn:inventuren-Posten (Seite 1)
 *       ein — mit den erpIds ALLER aktuell in core.kostenstelle bekannten
 *       Kostenstellen dieser Marke. erpIds[] ist ein Array-Parameter, der
 *       alle Kostenstellen in einem Aufruf bündelt (anders als
 *       fn:bestellungen, das je Kostenstelle läuft, plan-foodnotify.md §4
 *       B1). ALLES WEITERE STEUERT SICH SELBST: weitere Seiten und die
 *       Positionen je Inventur folgen aus dem Laden (src/foodnotify/laden.ts).
 *
 *       EIGENER SCHALTER, nicht Teil von --foodnotify: Inventuren lohnen
 *       praktisch nur bei Wilma Wunder (275 Stück, docs/plan-foodnotify.md
 *       Stufe 4) — bei Aposto und Deutsche Konzepte gibt es sie kaum (19
 *       bzw. 9, davon 5 storniert). Wer sie für alle vier Marken trotzdem
 *       holen will, kann es — es soll aber eine bewusste Entscheidung
 *       bleiben, kein Nebeneffekt des A1-Durchstichs.
 *
 *       SEIT 05.08.2026 BRAUCHT MAN DIESEN SCHALTER NICHT MEHR ZWINGEND:
 *       `sync/nachfuellen.ts` zieht die jeweils letzte Inventurseite je
 *       Marke bei jedem Lauf selbst nach (inventurenNachfuellen). Solange
 *       noch nie Inventuren geholt wurden, IST die letzte Seite die erste
 *       — der laufende Abgleich stößt damit dieselbe Kette an wie dieser
 *       Schalter. Er bleibt für den Fall, dass man den Durchstich sofort
 *       und ohne auf den nächsten Sync-Lauf zu warten haben will.
 *
 *       Setzt core.kostenstelle voraus (aus --foodnotify bzw. dem
 *       laufenden Abgleich) — ohne Kostenstellen bliebe die erpIds-Liste
 *       leer.
 *
 *       Idempotent: ein zweiter Aufruf reiht keinen zweiten Seite-1-Posten
 *       ein. Das heißt auch: kommen später neue Kostenstellen dazu, nimmt
 *       ein erneuter Aufruf sie NICHT automatisch mit — dafür den alten
 *       fn:inventuren-Posten der Marke von Hand löschen.
 */
if (process.argv.includes('--foodnotify-inventuren')) {
  const { fnZugaenge } = await import('./config')
  const { fnEndpunkt } = await import('./foodnotify/endpunkte')
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
    const kostenstellen = await query<{ erp_id: number }>(
      `SELECT erp_id FROM core.kostenstelle WHERE marke_key = $1 AND erp_id IS NOT NULL`,
      [marke.marke_key])
    if (kostenstellen.length === 0) {
      log.warn('keine Kostenstellen für diese Marke — erst --foodnotify laufen lassen', { marke: z.schluessel })
      continue
    }
    const erpIds = kostenstellen.map(r => String(r.erp_id)).join(',')
    const r = await query(
      `INSERT INTO sync.warteschlange
         (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
       SELECT 'fn:inventuren', $1::date, $1::date, $3, $2, $4::jsonb
        WHERE NOT EXISTS (
              SELECT 1 FROM sync.warteschlange w
               WHERE w.endpunkt = 'fn:inventuren' AND w.marke_key = $2
                 AND w.parameter->>'seite' = '1')
       RETURNING posten_id`,
      [heute, marke.marke_key, fnEndpunkt('fn:inventuren').prioritaet,
       JSON.stringify({ erpIds, seite: '1' })])
    log.info('inventuren eingereiht', { marke: z.schluessel, kostenstellen: kostenstellen.length, posten: r.length })
    gesamt += r.length
  }
  log.info('foodnotify-inventuren gesamt', {
    marken: zugaenge.map(z => z.schluessel), posten: gesamt,
    hinweis: 'weitere Seiten und Positionen folgen von selbst aus fn:inventuren',
  })
}

await pool.end()
