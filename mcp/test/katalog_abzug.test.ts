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
import { nachSchluessel } from '../src/katalog_ordnung'
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

/*
 * BEIDE SEITEN WERDEN IN JAVASCRIPT SORTIERT, und das ist keine Kosmetik.
 *
 * Bis zum 20.09.2026 kam die Reihenfolge aus dem ORDER BY der Abfrage, also
 * aus der Kollation der jeweiligen Datenbank. Die ist auf macOS eine andere
 * als auf dem Linux-Server — `kalender_fehlend` vor `kalendereffekt` hier,
 * umgekehrt dort, bei identischem Inhalt. toEqual vergleicht Arrays der
 * Reihe nach: dieser Test haette gegen Produktion NIE bestehen koennen.
 * Hergang in src/katalog_ordnung.ts und docs/fehlerkatalog.md.
 */
lauf('Abzug gegen Datenbank', () => {

  test('Fallstricke stimmen ueberein', async () => {
    const jetzt = await abfragen<{ schluessel: string }>(
      `SELECT schluessel, art, schwere, sicht, hinweis
         FROM mcp.fallstrick WHERE aktiv`)
    const abgezogen = (abzug.fallstricke as any[])
      .map(f => ({ schluessel: f.schluessel, art: f.art, schwere: f.schwere,
                   sicht: f.sicht, hinweis: f.hinweis }))
    expect(nachSchluessel(jetzt, f => f.schluessel))
      .toEqual(nachSchluessel(abgezogen, f => f.schluessel))
  })

  test('die Koernung stimmt ueberein', async () => {
    const jetzt = await abfragen<{ sicht: string; koernung: string | null }>(
      `SELECT sicht, koernung FROM mcp.sicht WHERE koernung IS NOT NULL`)
    const abgezogen = (abzug.sichten as any[])
      .filter(s => s.koernung).map(s => ({ sicht: s.sicht, koernung: s.koernung }))
    expect(nachSchluessel(jetzt, s => s.sicht))
      .toEqual(nachSchluessel(abgezogen, s => s.sicht))
  })

  /*
   * DIE SICHTENLISTE SELBST — die Luecke, durch die die Drift kam.
   *
   * Geprueft wurden bisher nur Fallstricke und Koernung. `mcp.achsen_ableiten()`
   * traegt aber JEDE neue mart-Sicht selbsttaetig ein, und der naechtliche Lauf
   * ruft sie auf: die Liste waechst ohne Migration, ohne Commit, ohne dass
   * irgendetwas meldet. Am 20.09.2026 fehlten der Abzugsdatei 37 Sichten.
   */
  test('die Sichtenliste stimmt ueberein', async () => {
    const jetzt = await abfragen<{ sicht: string }>(`SELECT sicht FROM mcp.sicht`)
    expect(nachSchluessel(jetzt.map(s => s.sicht), s => s))
      .toEqual(nachSchluessel((abzug.sichten as any[]).map(s => s.sicht), s => s))
  })
})
