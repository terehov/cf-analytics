/**
 * Eine materialisierte Sicht auffrischen — mit dem einen Sonderfall, an dem
 * CONCURRENTLY bauartbedingt scheitert.
 *
 * WARUM ES DIESE DATEI GIBT
 *
 * `REFRESH MATERIALIZED VIEW CONCURRENTLY` braucht einen alten Stand, gegen
 * den es abgleicht. Eine Sicht, die noch nie befüllt wurde, hat keinen, und
 * Postgres bricht ab (mit SQLSTATE 0A000, siehe unten — hier stand bis zum
 * 21.09.2026 der falsche Code). Das ist kein Randfall: eine Datenbank, die aus
 * einem Schema-Abzug entsteht — der Ende-zu-Ende-Test, ein neues Deployment,
 * jede Wiederherstellung ohne Daten — hat AUSNAHMSLOS unbefüllte
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

/**
 * ZWEI SQLSTATES, und das ist die Berichtigung vom 21.09.2026.
 *
 * Hier stand bis dahin nur `55000`, und der greift NICHT. Es sind zwei
 * verschiedene Meldungen, und nur die zweite steckt in dieser Funktion —
 * nachgemessen auf PostgreSQL 18.4, derselben Hauptversion wie in Produktion
 * (docs/architektur.md):
 *
 *   SELECT * FROM <unbefuellte Sicht>
 *     55000  materialized view "..." has not been populated
 *   REFRESH MATERIALIZED VIEW CONCURRENTLY <unbefuellte Sicht>
 *     0A000  CONCURRENTLY cannot be used when the materialized view is
 *            not populated
 *
 * Das 55000 aus dem Kopf dieser Datei ist also richtig beschrieben und am
 * falschen Ort abgefangen: der Fallback hat seit dem 20.08.2026 nie
 * gegriffen, weil `REFRESH` 0A000 wirft. Gefallen ist es nicht auf, weil
 * genau das passiert, was diese Datei verhindern soll — die Nachläufe fangen
 * jeden Fehler und der Refresh ist danach still gescheitert.
 *
 * Beide bleiben stehen: 0A000 ist der Fall, der hier auftritt, und 55000
 * kostet nichts und deckt eine Postgres-Version, die anders entscheidet.
 * Alles andere fliegt weiter — ein Zeitüberlauf oder ein Unique-Verstoß am
 * CONCURRENTLY-Index ist kein „nie befüllt" und darf nicht in einem
 * sperrenden Vollaufbau enden.
 */
const NIE_BEFUELLT = new Set(['0A000', '55000'])

/**
 * Frischt eine Sicht auf und sagt, ob es nebenläufig ging.
 *
 * Wirft weiter, wenn es etwas anderes als „nie befüllt" war — die Nachläufe
 * darüber entscheiden, was daraus folgt, nicht diese Funktion.
 */
export async function sichtAuffrischen(client: PoolClient, sicht: string): Promise<boolean> {
  try {
    await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${sicht}`)
    return true
  } catch (e: any) {
    if (!NIE_BEFUELLT.has(String(e?.code))) throw e
    log.info('Sicht war nie befuellt — einmal ohne CONCURRENTLY', { sicht, sqlstate: e?.code })
    await client.query(`REFRESH MATERIALIZED VIEW ${sicht}`)
    return false
  }
}
