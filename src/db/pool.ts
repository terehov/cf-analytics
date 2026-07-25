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

export type Werte = readonly unknown[]

export async function query<T = any>(text: string, werte: Werte = []): Promise<T[]> {
  const r = await pool.query(text, werte as unknown[])
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
  const client = await pool.connect()
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
