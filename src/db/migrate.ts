/** Wendet die SQL-Migrationen der Reihe nach an. Bewusst simpel: nummerierte
 *  Dateien, eine Tabelle mit dem Stand. Kein Tool, das man erst verstehen muss. */
import { Client } from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const client = new Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
const dir = join(import.meta.dir, '../../migrations')

await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migration (
  filename text PRIMARY KEY, angewendet_am timestamptz NOT NULL DEFAULT now())`)

const dateien = (await readdir(dir)).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()
const erledigt = new Set(
  (await client.query('SELECT filename FROM public.schema_migration')).rows.map(r => r.filename))

for (const f of dateien) {
  if (erledigt.has(f)) { console.log(`  skip  ${f}`); continue }
  console.log(`  apply ${f}`)
  try {
    await client.query('BEGIN')
    await client.query(await readFile(join(dir, f), 'utf8'))
    await client.query('INSERT INTO public.schema_migration (filename) VALUES ($1)', [f])
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(`Migration ${f} fehlgeschlagen:`, e)
    process.exit(1)
  }
}
console.log('Migrationen aktuell.')
await client.end()
