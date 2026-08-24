/**
 * Jede Karten-Abfrage einmal wirklich ausführen.
 *
 * Der Fehler, den dieser Test fängt, hat eine Geschichte: eine Karte wird
 * angelegt, sieht gut aus, und fällt erst um, wenn jemand einen FILTER
 * setzt — denn ohne Wert fällt der optionale Block `[[...]]` weg und die
 * Abfrage läuft. Am 28.07.2026 passierte genau das viermal an einem
 * Nachmittag (docs/fehlerkatalog.md, „Ein Feldfilter auf eine Tabelle mit
 * Alias").
 *
 * `uebernehmen.ts` prüft die Aliasfalle bereits statisch. Dieser Test geht
 * weiter und lässt Postgres selbst urteilen — über jede Karte, einmal ohne
 * und einmal MIT gesetzten Filtern. Was hier grün ist, kann in Metabase
 * noch falsch AUSSEHEN, aber nicht mehr abstürzen.
 *
 * Läuft gegen die ECHTE Datenbank (DATABASE_URL), weil er die Sichten
 * prüft, nicht die Daten: `EXPLAIN` genügt, es wird nichts gelesen und
 * nichts geschrieben.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from 'pg'
import { karten as kartenFach } from './karten-fach'
import { karten as kartenRoundTable } from './karten-round-table'
import { karten as kartenDrilldown } from './karten-drilldown'
import { karten as kartenPortfolio } from './karten-portfolio'
import { karten as kartenImport } from './karten-import'
import { karten as kartenStandort } from './karten-standort'
import { karten as kartenBewertung } from './karten-bewertung'
import { karten as kartenYext } from './karten-yext'
import { karten as kartenAktionen } from './karten-aktionen'
import { karten as kartenVergleich } from './karten-vergleich'
import { karten as kartenFremdeinkauf } from './karten-fremdeinkauf'
import { karten as kartenPflichtartikel } from './karten-pflichtartikel'
import { karten as kartenKalender } from './karten-kalender'
import { karten as kartenBounti } from './karten-bounti'
import type { Karte } from './typen'

const DB = process.env.DATABASE_URL
const lauf = DB ? describe : describe.skip

const alleKarten: Karte[] = [
  ...kartenRoundTable, ...kartenFach, ...kartenDrilldown,
  ...kartenPortfolio, ...kartenImport, ...kartenStandort, ...kartenBewertung,
  ...kartenAktionen, ...kartenVergleich, ...kartenFremdeinkauf, ...kartenPflichtartikel, ...kartenYext,
  ...kartenKalender, ...kartenBounti,
]

let db: Client

/**
 * Metabases Platzhalter durch etwas ersetzen, das Postgres versteht.
 *
 * `mitFiltern = false` bildet den Normalfall ab: kein Filter gesetzt, die
 * optionalen Blöcke fallen weg. `true` ist der gefährliche Fall — jeder
 * Block bleibt stehen und muss gültiges SQL ergeben.
 */
function fuerPostgres(sql: string, karte: Karte, mitFiltern: boolean): string {
  if (!mitFiltern) {
    // [[...]] entfernen, wie Metabase es ohne Filterwert tut.
    return sql.replace(/\[\[[^\]]*\]\]/g, '')
  }

  /**
   * Der Ersatzwert muss zum TYP des Parameters passen, sonst scheitert
   * die Abfrage an der Attrappe statt am Fehler: Postgres wirft bei
   * `datum = '__test__'` einen Syntaxfehler, der nichts über die Karte
   * aussagt. Die Typen stehen in der Parameterliste der Karte selbst.
   */
  const typen = new Map(karte.parameter?.map(p => [p.name, p.type]) ?? [])
  const ersatz = (name: string): string => {
    const t = typen.get(name) ?? 'text'
    if (t.startsWith('date')) return `'2026-01-01'`
    if (t === 'number' || t.startsWith('number/')) return '1'
    return `'__test__'`
  }

  return sql
    .replace(/\[\[(.*?)\]\]/gs, '$1')
    // Feldfilter (dimension) baut Metabase selbst zu einer Klausel
    // zusammen — hier steht ersatzweise etwas immer Wahres, denn geprüft
    // wird der RAHMEN um den Filter, nicht der Filter.
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name: string) =>
      karte.template_tag_dimension?.[name] ? 'true' : ersatz(name))
}

lauf('Karten-SQL', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
  })
  afterAll(async () => { await db?.end() })

  test('alle Karten haben einen eindeutigen Schlüssel', () => {
    const gesehen = new Map<string, number>()
    for (const k of alleKarten) gesehen.set(k.schluessel, (gesehen.get(k.schluessel) ?? 0) + 1)
    const doppelt = [...gesehen].filter(([, n]) => n > 1).map(([s]) => s)
    expect(doppelt).toEqual([])
  })

  /**
   * EXPLAIN statt Ausführung: Postgres prüft Syntax, Tabellen, Spalten und
   * Typen vollständig, liest aber keine Zeile. Eine Karte mit LIMIT 500
   * über vier Jahre Bestellhistorie würde den Test sonst ausbremsen.
   */
  const pruefen = async (k: Karte, mitFiltern: boolean) => {
    const sql = fuerPostgres(k.sql, k, mitFiltern)
    try {
      await db.query(`EXPLAIN ${sql}`)
    } catch (e) {
      const grund = e instanceof Error ? e.message : String(e)
      throw new Error(
        `Karte "${k.schluessel}" (${k.name}) ${mitFiltern ? 'MIT' : 'ohne'} Filter: ${grund}`)
    }
  }

  for (const k of alleKarten) {
    test(`${k.schluessel} läuft ohne gesetzten Filter`, async () => {
      await pruefen(k, false)
    })
  }

  for (const k of alleKarten.filter(k => /\[\[/.test(k.sql))) {
    test(`${k.schluessel} läuft auch MIT gesetztem Filter`, async () => {
      // Der Fall, der sich sonst erst beim Benutzer zeigt.
      await pruefen(k, true)
    })
  }
})
