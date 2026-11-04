/**
 * Keine Karte liest ein Schema, das der Chat nicht sieht.
 *
 * Der MCP-Zugang führt jede Karte als Bericht aus — als `mcp_leser`, und der
 * sieht nur `mart`, `manual`, `ampel` (`mcp/src/pruefen.ts`, ERLAUBTE_SCHEMATA).
 * In Metabase läuft eine Karte auf `core` oder `sync` trotzdem, also fällt es
 * dort niemandem auf. Am 04.11.2026 waren es 13 von 328 Karten, gefunden erst,
 * als `bericht:yx_datenstand` im Chat mit „permission denied for schema core"
 * scheiterte (behoben mit Migration 0146, docs/fehlerkatalog.md).
 *
 * Statisch, ohne Datenbank: Kommentare und Zeichenketten werden entfernt, dann
 * jeder schemaqualifizierte Name gesucht. Was eine Karte braucht und nicht in
 * `mart` steht, bekommt dort eine schlanke Sicht.
 */
import { expect, test } from 'bun:test'
import { alleKarten } from './karten'

const SICHTBAR = new Set(['mart', 'manual', 'ampel'])

function ohneKommentarUndText(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^']|'')*'/g, "''")
}

test('keine Karte liest core, sync, raw oder einen Systemkatalog', () => {
  const verstoesse: string[] = []
  for (const k of alleKarten) {
    if (!k.sql) continue
    const sql = ohneKommentarUndText(k.sql)
    const schemata = new Set<string>()
    for (const m of sql.matchAll(/\b([a-z_][a-z0-9_]*)\.[a-z_"][a-z0-9_"]*/gi)) {
      const s = m[1].toLowerCase()
      if (['core', 'sync', 'raw', 'part', 'public', 'pg_catalog', 'information_schema'].includes(s)) schemata.add(s)
    }
    if (/\bpg_[a-z_]+\b/.test(sql)) schemata.add('pg_*')
    const fremd = [...schemata].filter(s => !SICHTBAR.has(s))
    if (fremd.length) verstoesse.push(`${k.schluessel}: ${fremd.join(', ')}`)
  }
  expect(verstoesse).toEqual([])
})
