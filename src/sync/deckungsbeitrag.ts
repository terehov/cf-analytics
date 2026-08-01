/**
 * Frischt mart.deckungsbeitrag_warengruppe auf — als Nachlauf jedes
 * Sync-Laufs.
 *
 * WARUM DIE SICHT MATERIALISIERT IST
 *
 * Sie aggregiert core.artikelverkauf_tag: 27,5 Mio. Zeilen in 108
 * Monatspartitionen ab Januar 2018. Als reine Sicht wurde dieses Aggregat bei
 * JEDEM Kartenaufruf neu gerechnet — auf der Seite „Warenwirtschaft" hiess das
 * am 01.08.2026 gemessen über 120 Sekunden, also einen Abbruch. Begründung und
 * Messwerte stehen in migrations/0027_deckungsbeitrag_materialisiert.sql.
 *
 * WARUM DAS HIER STEHT UND NICHT IN EINEM EIGENEN CRON-AUFTRAG
 *
 * Dieselbe Überlegung wie bei den Auswahllisten nebenan: die Grundlage ändert
 * sich genau dann, wenn ein Sync-Lauf neue Artikelverkäufe geschrieben hat.
 * Ein zweiter Zeitplan müsste eingerichtet werden, könnte auseinanderlaufen und
 * wäre eine weitere Stelle, an der etwas vergessen werden kann. Hier angehängt
 * passiert es von selbst.
 *
 * ZWEI REGELN, DIE NICHT VERHANDELBAR SIND — wie nebenan
 *
 *   1. Das hier darf einen Sync-Lauf NIEMALS scheitern lassen. Der Import ist
 *      die Arbeit, das Berichtswesen hängt daran; ein misslungener Refresh
 *      bedeutet veraltete Auswertungen, nicht verlorene Daten. Deshalb fängt
 *      diese Funktion alles und wirft nie.
 *
 *   2. Es läuft NACH dem Import. Ein Refresh vor dem Import würde den alten
 *      Stand neu schreiben — Aufwand ohne Wirkung.
 */
import { log } from '../lib/log'
import { pool, query } from '../db/pool'

/**
 * CONCURRENTLY, damit niemand während des Neuaufbaus vor einem sperrenden
 * Dashboard sitzt. Der dafür nötige eindeutige Index liegt in Migration 0027.
 *
 * Der Preis von CONCURRENTLY ist, dass es langsamer ist als ein sperrender
 * Refresh und doppelt Platz braucht. Beides ist hier ohne Bedeutung: das
 * Ergebnis sind rund 174.000 Zeilen, und der Lauf passiert einmal je Import.
 */
const REFRESH = `REFRESH MATERIALIZED VIEW CONCURRENTLY mart.deckungsbeitrag_warengruppe`

/**
 * Ein Refresh über 27,5 Mio. Zeilen darf dauern — aber nicht endlos. Ohne
 * Grenze hinge ein Sync-Lauf an einer Auswertung fest, und das wäre genau die
 * Sorte stiller Blockade, gegen die ANFRAGE_TIMEOUT_MS in src/config.ts
 * eingeführt wurde.
 */
const ZEITGRENZE_MS = 15 * 60 * 1000

export type Auffrischung = {
  status: 'aufgefrischt' | 'fehler'
  dauerS: number
  meldung?: string
}

/**
 * Frischt die Sicht auf. Wirft nie — siehe Regel 1 oben.
 */
export async function deckungsbeitragAuffrischen(): Promise<Auffrischung> {
  const t0 = Date.now()
  // Eine EIGENE Verbindung, bewusst nicht query() aus db/pool.
  //
  // Zwei Gründe, beide würden sonst still danebengehen:
  //
  //   * `SET statement_timeout` gilt je Sitzung. Über den Pool landete das SET
  //     womöglich auf einer anderen Verbindung als der REFRESH — die Grenze
  //     wäre gesetzt und wirkungslos.
  //   * query() wiederholt bei Verbindungsfehlern. Ein halb durchgelaufener
  //     REFRESH, der neu gestartet wird, ist reine Zeitverschwendung; hier ist
  //     ein Fehlschlag der bessere Ausgang, weil der nächste Sync-Lauf es
  //     ohnehin erneut versucht.
  const client = await pool.connect()
  try {
    await client.query(`SET statement_timeout = ${ZEITGRENZE_MS}`)
    await client.query(REFRESH)

    const dauerS = Math.round((Date.now() - t0) / 100) / 10

    // Auch der Zeitstempel allein ist eine Aussage: mart.deckungsbeitrag_stand
    // liest ihn, damit „wie alt sind diese Zahlen" beantwortbar bleibt.
    await query(
      `INSERT INTO sync.merker (schluessel, wert)
       VALUES ('deckungsbeitrag_refresh', jsonb_build_object('dauer_s', $1::numeric))
       ON CONFLICT (schluessel)
       DO UPDATE SET wert = EXCLUDED.wert, gesetzt_am = now()`,
      [dauerS])

    return { status: 'aufgefrischt', dauerS }
  } catch (e) {
    // Regel 1: nie werfen. Die Zahlen sind dann veraltet, nicht falsch —
    // und mart.deckungsbeitrag_stand zeigt, seit wann.
    return {
      status: 'fehler',
      dauerS: Math.round((Date.now() - t0) / 100) / 10,
      meldung: String(e),
    }
  } finally {
    // Die Zeitgrenze zurücknehmen, bevor die Verbindung zurück in den Pool
    // geht — sonst erbt sie der nächste Nutzer der Verbindung, und ein
    // langer Import bräche nach 15 Minuten ab, ohne dass jemand den
    // Zusammenhang sähe.
    try { await client.query(`SET statement_timeout = 0`) } catch { /* egal */ }
    client.release()
  }
}

/**
 * Der Aufruf für den Nachlauf: frischt auf und protokolliert, ohne je zu werfen.
 */
export async function deckungsbeitragNachlauf(): Promise<void> {
  const r = await deckungsbeitragAuffrischen()
  if (r.status === 'aufgefrischt') {
    log.info('Deckungsbeitrag aufgefrischt', { dauer_s: r.dauerS })
  } else {
    // Warnung, nicht Fehler: der Import ist gelungen, nur die Auswertung
    // hinkt. Wie weit, steht in mart.deckungsbeitrag_stand.
    log.warn('Deckungsbeitrag nicht aufgefrischt', { grund: r.meldung, dauer_s: r.dauerS })
  }
}
