/**
 * Datenbankzugriff des MCP-Servers.
 *
 * EIGENE VERBINDUNG, EIGENE ROLLE. `MCP_DATABASE_URL` zeigt auf `mcp_leser`
 * und nicht auf den Importer-Zugang. Die Rolle traegt die Grenzen
 * (default_transaction_read_only, statement_timeout, nur mart/manual/ampel/mcp);
 * der Pruefer davor ist die erste Huerde mit einer lesbaren Meldung, nicht
 * die einzige. Ein SQL-Filter im Code allein waere eine Liste von
 * Umgehungen, die man nicht kennt — CTE, Funktion, search_path,
 * Kommentartrick. Postgres hat die Pruefung eingebaut und sie ist
 * vollstaendig.
 *
 * Die Typumwandlungen sind dieselben wie im Importer (src/db/pool.ts) und
 * aus demselben Grund: `DATE` als Text, damit ein Geschaeftstag nicht in der
 * Ortszeit des Containers um einen Tag kippt, und `numeric` bleibt Text,
 * damit beim Runden nichts verloren geht.
 */
import pg from 'pg'

pg.types.setTypeParser(1082, (v: string) => v)   // DATE → 'YYYY-MM-DD'

export const pool = new pg.Pool({
  connectionString: process.env.MCP_DATABASE_URL,
  /**
   * Klein gehalten: der Server teilt sich die Maschine mit dem Importer, und
   * jede Abfrage hier ist eine, die jemand im Chat ausgeloest hat. Zwei je
   * Nutzer mal eine Handvoll Nutzer — mehr als acht gleichzeitige Abfragen
   * waeren keine Last, die dieser Dienst erzeugen darf.
   */
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'mcp',
})

pool.on('error', (e) => {
  console.error(JSON.stringify({ t: new Date().toISOString(), stufe: 'warn',
    msg: 'Verbindung im Leerlauf weggebrochen', fehler: String(e?.message ?? e).slice(0, 200) }))
})

export async function abfragen<T = any>(sql: string, werte: readonly unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, werte as unknown[])
  return r.rows as T[]
}

/**
 * Den Pool schliessen — hoechstens einmal.
 *
 * `pg` wirft beim zweiten `end()` ("Called end on pool more than once"), und
 * danach wirft jede weitere Abfrage. Im Betrieb faellt das nie auf: der
 * Prozess endet ohnehin. In den Tests schon — zwei Dateien, die sich
 * denselben Pool teilen und beide aufraeumen wollen, lassen die zweite
 * scheitern, und der Fehler liest sich wie ein Datenbankproblem statt wie
 * ein Aufraeumfehler.
 */
let beendet = false
export async function poolBeenden(): Promise<void> {
  if (beendet) return
  beendet = true
  await pool.end()
}
