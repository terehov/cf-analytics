/**
 * Eine materialisierte Sicht auffrischen — mit dem einen Sonderfall, an dem
 * CONCURRENTLY bauartbedingt scheitert.
 *
 * WARUM ES DIESE DATEI GIBT
 *
 * `REFRESH MATERIALIZED VIEW CONCURRENTLY` braucht einen alten Stand, gegen
 * den es abgleicht. Eine Sicht, die noch nie befüllt wurde, hat keinen, und
 * Postgres antwortet mit PG 55000. Das ist kein Randfall: eine Datenbank, die
 * aus einem Schema-Abzug entsteht — der Ende-zu-Ende-Test, ein neues
 * Deployment, jede Wiederherstellung ohne Daten — hat AUSNAHMSLOS unbefüllte
 * Materialisierungen.
 *
 * Und weil die vier Nachläufe jeden Fehler abfangen (Regel 1 dort: ein
 * misslungener Refresh darf keinen Import scheitern lassen), hätte niemand es
 * gemerkt: Nacht für Nacht derselbe stille Fehlschlag, Karten ohne Zahlen,
 * Lauf grün. `vergleichstag.ts` hatte den Fallback seit 0084, weil genau
 * daran der Ende-zu-Ende-Test nach 0080 hängengeblieben ist — die anderen
 * drei nie. Nachgestellt am 20.08.2026 auf einem frischen Schema-Klon:
 * neun von zehn Sichten scheiterten.
 *
 * Einmal ohne CONCURRENTLY befüllen, danach greift der normale Weg. Der
 * sperrende Refresh ist beim ersten Mal zu verschmerzen: es gibt noch nichts
 * zu lesen, was er sperren könnte.
 */
import type { PoolClient } from 'pg'
import { log } from '../lib/log'

/** PG 55000 — hier immer: „die Sicht wurde nie befüllt". */
const NIE_BEFUELLT = '55000'

/**
 * Frischt eine Sicht auf und sagt, ob es nebenläufig ging.
 *
 * Wirft weiter, wenn es etwas anderes als 55000 war — die Nachläufe darüber
 * entscheiden, was daraus folgt, nicht diese Funktion.
 */
export async function sichtAuffrischen(client: PoolClient, sicht: string): Promise<boolean> {
  try {
    await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${sicht}`)
    return true
  } catch (e: any) {
    if (e?.code !== NIE_BEFUELLT) throw e
    log.info('Sicht war nie befuellt — einmal ohne CONCURRENTLY', { sicht })
    await client.query(`REFRESH MATERIALIZED VIEW ${sicht}`)
    return false
  }
}
