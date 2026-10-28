/**
 * Die ZWEITE Datenbankverbindung — die der Anmeldung.
 *
 * WARUM ES SIE GIBT, und warum das keine Umstaendlichkeit ist:
 * `mcp_leser` fuehrt Nutzereingaben als SQL aus (Werkzeug
 * `abfrage_ausfuehren`), und `mcp` steht auf der Liste der erlaubten
 * Schemata, weil der Katalog dort liegt. Laegen Passworthashes und
 * Signierschluessel unter derselben Rolle, waere
 *
 *     SELECT privat_jwk FROM mcp.oauth_schluessel
 *
 * eine gueltige Abfrage — und wer sie stellt, kann sich fortan beliebige
 * Tokens selbst ausstellen. Das ist kein Randfall, sondern der erste Weg,
 * den ein Modell beim Herumprobieren findet.
 *
 * Deshalb: eigene Rolle, eigene Verbindung. `mcp_anmeldung` sieht die
 * Anmeldetabellen und sonst nichts; `mcp_leser` sieht sie nicht. Postgres
 * setzt das durch, nicht dieser Code (Migration 0104).
 */
import pg from 'pg'

const url = process.env.MCP_AUTH_DATABASE_URL

export const anmeldungPool = new pg.Pool({
  connectionString: url,
  // Drei Nutzer, eine Anmeldung alle paar Stunden. Zwei Verbindungen sind
  // hier keine Sparsamkeit, sondern die ehrliche Groesse.
  max: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'mcp-anmeldung',
})

anmeldungPool.on('error', (e) => {
  console.error(JSON.stringify({ t: new Date().toISOString(), stufe: 'warn',
    msg: 'Anmeldeverbindung im Leerlauf weggebrochen',
    fehler: String(e?.message ?? e).slice(0, 200) }))
})

export async function anmeldungAbfragen<T = any>(
  sql: string, werte: readonly unknown[] = [],
): Promise<T[]> {
  const r = await anmeldungPool.query(sql, werte as unknown[])
  return r.rows as T[]
}

export function anmeldungEingerichtet(): boolean {
  return Boolean(url)
}

export type Abfrager = <T = any>(sql: string, werte?: readonly unknown[]) => Promise<T[]>

/**
 * Mehrere Abfragen in EINER Transaktion, auf einer Verbindung.
 *
 * Gebraucht fuer die Verbindungsgrenze (0139): zaehlen und ausstellen
 * muessen zusammen geschehen, sonst kommen zwei gleichzeitige Anmeldungen
 * beide unter der Grenze durch. Die Sperre ist die Nutzerzeile (FOR UPDATE),
 * die der Aufrufer als erstes liest.
 */
export async function anmeldungTransaktion<T>(arbeit: (q: Abfrager) => Promise<T>): Promise<T> {
  const verbindung = await anmeldungPool.connect()
  try {
    await verbindung.query('BEGIN')
    const q: Abfrager = async (sql, werte = []) =>
      (await verbindung.query(sql, werte as unknown[])).rows
    const ergebnis = await arbeit(q)
    await verbindung.query('COMMIT')
    return ergebnis
  } catch (e) {
    await verbindung.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    verbindung.release()
  }
}
