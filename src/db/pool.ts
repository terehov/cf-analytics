/**
 * Datenbankzugriff über node-postgres.
 *
 * Zwei Typumwandlungen werden hier bewusst abgeschaltet, weil sie sonst still
 * Daten verfälschen:
 *
 *   DATE (OID 1082)  pg baut daraus ein Date-Objekt in ORTSZEIT. Läuft der
 *                    Container in einer Zone westlich von UTC, kippt der
 *                    Geschäftstag um einen Tag zurück. Wir wollen den
 *                    Kalendertag als Text, ohne Zeitzonenbezug — genau so ist
 *                    ein Geschäftsdatum fachlich gemeint.
 *
 *   NUMERIC (1700)   pg liefert numeric als String, damit nichts verloren geht.
 *                    Das ist richtig und bleibt so — beim Lesen von Beträgen
 *                    also bewusst Number() aufrufen, nicht implizit rechnen.
 *
 * int8/bigint bleibt ebenfalls String — dieselbe Begründung.
 */
import pg from 'pg'
import { config } from '../config'
import { log } from '../lib/log'

// DATE als 'YYYY-MM-DD' statt Date-Objekt.
pg.types.setTypeParser(1082, (v: string) => v)
// TIMESTAMPTZ bleibt Date — das ist ein echter Zeitpunkt und dort korrekt.

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 4,
  // Der Importer arbeitet lange und langsam; Verbindungen sollen nicht
  // mitten in einem Lauf wegsterben.
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 10_000,
})

/**
 * Fehler auf LEERLAUFENDEN Verbindungen abfangen.
 *
 * `pg.Pool` gibt ein `error`-Ereignis aus, wenn eine gerade unbenutzte
 * Verbindung wegbricht — Netzhänger, Neustart der Datenbank, ein
 * `pg_terminate_backend` vom Administrator. Ohne Zuhörer ist ein
 * `error`-Ereignis in Node ein **Prozessabsturz**, und zwar an einer Stelle,
 * die mit dem gerade bearbeiteten Posten nichts zu tun hat.
 *
 * Genau dieser Fall trat beim Ausfalltest am 26.07.2026 auf. Der Pool ersetzt
 * die Verbindung von selbst; hier reicht es, den Vorfall festzuhalten, statt
 * daran zu sterben.
 */
pool.on('error', (e) => {
  log.warn('Verbindung im Leerlauf weggebrochen — der Pool ersetzt sie',
    { fehler: String(e?.message ?? e).slice(0, 200) })
})

export type Werte = readonly unknown[]

/**
 * Fehler, bei denen die Anweisung den Server nachweislich NICHT erreicht hat.
 *
 * Nur solche dürfen wiederholt werden. Ein Constraint-Verstoß oder ein
 * Tippfehler im SQL muss durchschlagen — wer den wiederholt, verschleiert ihn
 * nur und macht aus einem klaren Fehler drei langsame.
 *
 * Die Liste stammt aus dem, was am 26.07.2026 tatsächlich passiert ist:
 * mitten in einem Lauf mit 16 erfolgreichen Posten kam ein
 * „Connection terminated due to connection timeout", und der ganze Lauf starb
 * daran. Bei einem Backfill über zwölf Tage wäre das ein täglicher Abbruch.
 */
function istTransient(e: unknown): boolean {
  const s = String((e as Error)?.message ?? e)
  return /Connection terminated/i.test(s)
      /**
       * Die Meldung des SERVERS, wenn er die Verbindung abräumt:
       * „terminating connection due to administrator command" (pg_terminate_backend),
       * „... because of crash of another server process", „... due to
       * idle-in-transaction timeout". Alle heissen dasselbe — die Verbindung
       * ist weg, die Anweisung lief nicht zu Ende, ein Commit kann es nicht
       * gegeben haben.
       *
       * Fehlte hier bis zum 26.07.2026 und fiel nur deshalb nicht auf, weil
       * der erste Zugriff eines Laufs zufällig spät genug kam: der Pool hatte
       * die tote Verbindung bis dahin schon selbst aussortiert. Sobald eine
       * Abfrage weiter nach vorn rückte, schlug der Ausfalltest zu.
       */
      || /terminating connection/i.test(s)
      || /timeout exceeded when trying to connect/i.test(s)
      || /Client has encountered a connection error/i.test(s)
      || /connection is closed/i.test(s)
      || /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE/i.test(s)
}

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Führt eine Abfrage aus und wiederholt sie bei transienten
 * Verbindungsfehlern — dreimal, mit wachsender Pause.
 *
 * Sicher, weil nur Fälle wiederholt werden, in denen die Verbindung gar nicht
 * erst zustande kam: die Anweisung hat den Server nie gesehen, es kann also
 * nichts doppelt ausgeführt werden.
 */
async function mitWiederholung<T>(fn: () => Promise<T>, was: string): Promise<T> {
  let letzter: unknown
  for (let versuch = 1; versuch <= 3; versuch++) {
    try {
      return await fn()
    } catch (e) {
      if (!istTransient(e)) throw e
      letzter = e
      if (versuch < 3) {
        const pause = 250 * 2 ** (versuch - 1)   // 250 ms, 500 ms
        log.warn('Datenbank kurz nicht erreichbar — wiederhole', {
          versuch, pause, was, fehler: String((e as Error)?.message ?? e).slice(0, 200),
        })
        await schlaf(pause)
      }
    }
  }
  throw letzter
}

export async function query<T = any>(text: string, werte: Werte = []): Promise<T[]> {
  const r = await mitWiederholung(
    () => pool.query(text, werte as unknown[]), text.trim().slice(0, 60))
  return r.rows as T[]
}

/** Genau eine Zeile erwarten (oder keine). */
export async function eine<T = any>(text: string, werte: Werte = []): Promise<T | null> {
  const rows = await query<T>(text, werte)
  return rows[0] ?? null
}

/**
 * Transaktion. Der Callback bekommt einen Client, auf dem alle Abfragen
 * laufen müssen — sonst landen sie auf einer anderen Verbindung und damit
 * außerhalb der Transaktion.
 */
export async function inTransaktion<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  // Nur das HOLEN der Verbindung wird wiederholt, nie der Transaktionsinhalt.
  // Der könnte bereits geschrieben haben, bevor er scheiterte — ein zweiter
  // Durchlauf machte daraus stillschweigend doppelte Daten.
  const client = await mitWiederholung(() => pool.connect(), 'pool.connect')
  try {
    await client.query('BEGIN')
    const r = await fn(client)
    await client.query('COMMIT')
    return r
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/**
 * Mehrzeiliges INSERT bauen.
 *
 * pg kennt keine Tagged Templates wie postgres.js, also erzeugen wir die
 * Platzhalter selbst. Spaltennamen kommen ausschließlich aus dem Code, nie
 * aus Daten — deshalb ist das Einsetzen hier unbedenklich.
 */
export function mehrzeilig(
  spalten: readonly string[],
  zeilen: readonly Record<string, unknown>[],
): { platzhalter: string; werte: unknown[] } {
  const werte: unknown[] = []
  const gruppen = zeilen.map(z => {
    const teile = spalten.map(s => { werte.push(z[s] ?? null); return `$${werte.length}` })
    return `(${teile.join(',')})`
  })
  return { platzhalter: gruppen.join(','), werte }
}

/** In Blöcken schreiben — der Artikelkatalog hat 6.451 Einträge. */
export async function inBloecken<T>(
  zeilen: readonly T[], groesse: number, fn: (block: T[]) => Promise<unknown>,
) {
  for (let i = 0; i < zeilen.length; i += groesse) await fn(zeilen.slice(i, i + groesse) as T[])
}
