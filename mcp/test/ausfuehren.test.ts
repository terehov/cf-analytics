/**
 * Ausfuehrung von Ende zu Ende — gegen eine echte Datenbank, als `mcp_leser`.
 *
 * WARUM DAS NICHT MIT DEM IMPORTER-ZUGANG GEPRUEFT WERDEN DARF. Die Haelfte
 * dessen, was hier geprueft wird, IST die Rolle: dass `core` gesperrt ist,
 * dass nur `mcp.zugriff` beschrieben werden kann, dass das Protokoll trotz
 * `default_transaction_read_only` durchkommt. Als Eigentuemer der Datenbank
 * wuerde jeder dieser Tests gruen und nichts davon bewiesen.
 *
 *   MCP_DATABASE_URL=postgresql://mcp_leser:...@host/lina bun test
 *
 * Ohne die Variable uebersprungen, wie die uebrigen Datenbanktests.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { parserBereitstellen } from '../src/ast'
import { abfrageAusfuehren, Gesperrt } from '../src/ausfuehren'
import { abfragen, pool } from '../src/db'
import { katalogLaden } from '../src/katalog_laden'
import type { Katalog } from '../src/katalog'

const DB = process.env.MCP_DATABASE_URL
const lauf = DB ? describe : describe.skip

let katalog: Katalog
const nutzer = { subject: 'test|1', anzeige: 'Testlauf', client: 'bun-test' }

lauf('Ausfuehrung', () => {
  beforeAll(async () => {
    await parserBereitstellen()
    katalog = await katalogLaden()
  })
  // Den Pool NICHT schliessen: mehrere Testdateien teilen sich denselben,
  // und wer ihn zuerst zumacht, laesst die anderen ins Leere laufen. Der
  // Prozess raeumt ihn am Ende ohnehin ab.
  afterAll(async () => {
    await pool.query(`DELETE FROM mcp.zugriff WHERE subject = 'test|1'`).catch(() => {})
  })

  test('eine richtige Abfrage laeuft und wird protokolliert', async () => {
    const e = await abfrageAusfuehren(
      `SELECT count(*)::int AS n FROM mart.betrieb`, katalog, nutzer)
    expect(e.zeilen).toHaveLength(1)
    expect(e.spalten).toEqual(['n'])
    expect(e.protokoll_id).toBeGreaterThan(0)

    const [zeile] = await abfragen(
      `SELECT werkzeug, gesperrt, zeilen FROM mcp.zugriff WHERE zugriff_id = $1`,
      [e.protokoll_id])
    expect(zeile.werkzeug).toBe('abfrage_ausfuehren')
    expect(zeile.gesperrt).toBe(false)
    expect(zeile.zeilen).toBe(1)
  })

  /**
   * Die gesperrte Abfrage ist der interessantere Protokolleintrag: sie sagt,
   * welche Falle wie oft zuschnappt, und das ist die Anforderungsliste fuer
   * die naechsten mart-Sichten.
   */
  test('eine gesperrte Abfrage laeuft NICHT, steht aber im Protokoll', async () => {
    const vorher = await abfragen<{ n: number }>(
      `SELECT count(*)::int AS n FROM mcp.zugriff WHERE gesperrt AND subject = 'test|1'`)

    await expect(abfrageAusfuehren(
      `SELECT stadt, count(*) FROM mart.betrieb GROUP BY stadt`, katalog, nutzer))
      .rejects.toBeInstanceOf(Gesperrt)

    const nachher = await abfragen<{ n: number }>(
      `SELECT count(*)::int AS n FROM mcp.zugriff WHERE gesperrt AND subject = 'test|1'`)
    expect(nachher[0]!.n).toBe(vorher[0]!.n + 1)
  })

  test('die Rolle kommt nicht an core — unabhaengig vom Pruefer', async () => {
    // Der Pruefer sperrt das schon, aber DIESER Test geht an ihm vorbei und
    // fragt die Datenbank direkt. Genau darum geht es: die Rechte sind die
    // Sperre, der Pruefer ist die lesbare Meldung davor.
    await expect(abfragen(`SELECT 1 FROM core.betrieb LIMIT 1`)).rejects.toThrow(/permission denied/i)
  })

  test('schreiben geht nur ins Protokoll, sonst nirgends', async () => {
    await expect(abfragen(`DELETE FROM manual.massnahme WHERE false`))
      .rejects.toThrow(/permission denied|read-only/i)
  })

  test('der Befund-Anhang traegt Koernung und Datenstand', async () => {
    const e = await abfrageAusfuehren(`
      SELECT betrieb_key, sum(umsatz_netto) AS umsatz
        FROM mart.umsatz_tag
       WHERE geschaeftstag >= '2026-01-01'
       GROUP BY betrieb_key`, katalog, nutzer)
    expect(e.koernung.find(k => k.sicht === 'mart.umsatz_tag')?.koernung)
      .toContain('Betrieb und Geschaeftstag')
    // Leere Datenbank: kein Datenstand. Mit Daten muss er da sein.
    if (e.zeilen.length > 0) expect(e.datenstand).not.toBeNull()
  })
})
