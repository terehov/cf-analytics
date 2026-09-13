/**
 * Die Abzugsdatei gegen die echte Datenbank halten.
 *
 * WARUM DAS EIN EIGENER TEST IST. Die zehn Fallenfragen laufen gegen
 * test/katalog.json, damit sie ohne Datenbank pruefbar sind. Damit haengt
 * die Regressionssicherung des ganzen Vorhabens an einer Datei, die
 * veralten kann — und eine veraltete Abzugsdatei faellt nirgends auf: die
 * Tests bleiben gruen, waehrend die Regel, die sie prueft, in der Datenbank
 * laengst anders lautet. Genau die Sorte stiller Ausfall, gegen die harte
 * Regel 10 geschrieben ist.
 *
 * Deshalb: sobald MCP_DATABASE_URL gesetzt ist, wird verglichen.
 *
 *   bun run katalog:abzug    schreibt sie neu
 */
import { describe, expect, test } from 'bun:test'
import { abfragen } from '../src/db'
import { REGELARTEN } from '../src/pruefen'
import abzug from './katalog.json'

const DB = process.env.MCP_DATABASE_URL
const lauf = DB ? describe : describe.skip

describe('Die Abzugsdatei selbst', () => {
  test('jede Regelart darin ist im Pruefer umgesetzt', () => {
    const unbekannt = [...new Set(abzug.fallstricke.map((f: any) => f.art))]
      .filter(a => !(a in REGELARTEN))
    expect(unbekannt).toEqual([])
  })

  test('jeder Fallstrick traegt einen Hinweis und einen Beleg', () => {
    for (const f of abzug.fallstricke as any[]) {
      expect(f.hinweis.length).toBeGreaterThan(40)
      // `quelle` nennt, WARUM die Regel da ist. Ohne den Beleg entfernt sie
      // irgendwann jemand, weil sie ihm im Weg steht.
      expect(f.quelle).toBeTruthy()
    }
  })

  test('die Sichten mit den meisten Achsen haben eine Koernung', () => {
    // Die achsenreichsten werden am haeufigsten verbunden und richten den
    // groessten Schaden an, wenn ihre Koernung fehlt.
    const ohne = (abzug.sichten as any[])
      .filter(s => (s.achsen?.length ?? 0) >= 3 && !s.koernung)
      .map(s => s.sicht)
    expect(ohne).toEqual([])
  })
})

lauf('Abzug gegen Datenbank', () => {

  test('Fallstricke stimmen ueberein', async () => {
    const jetzt = await abfragen(`SELECT schluessel, art, schwere, sicht, hinweis
                                    FROM mcp.fallstrick WHERE aktiv ORDER BY schluessel`)
    const abgezogen = (abzug.fallstricke as any[])
      .map(f => ({ schluessel: f.schluessel, art: f.art, schwere: f.schwere,
                   sicht: f.sicht, hinweis: f.hinweis }))
    expect(jetzt).toEqual(abgezogen)
  })

  test('die Koernung stimmt ueberein', async () => {
    const jetzt = await abfragen<{ sicht: string; koernung: string | null }>(
      `SELECT sicht, koernung FROM mcp.sicht WHERE koernung IS NOT NULL ORDER BY sicht`)
    const abgezogen = (abzug.sichten as any[])
      .filter(s => s.koernung).map(s => ({ sicht: s.sicht, koernung: s.koernung }))
    expect(jetzt).toEqual(abgezogen)
  })
})
