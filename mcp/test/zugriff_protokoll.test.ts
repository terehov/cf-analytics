/**
 * Die Middleware fuer gescheiterte Aufrufe — gegen eine echte Datenbank als
 * `mcp_leser`, aus denselben Gruenden wie ausfuehren.test.ts. Ohne
 * MCP_DATABASE_URL uebersprungen.
 *
 * DER FEHLER WIRD SO HINTERLEGT, WIE SKYBRIDGE ES TUT: unter dem Symbol
 * `skybridge.toolError` auf `extra` (skybridge/dist/server/middleware.js,
 * captureToolError — nicht exportiert). Der Weg ist nicht oeffentlich, der
 * Leser (getToolError) schon. Deshalb prueft der erste Test zuerst, dass
 * Skybridges eigener Leser den so hinterlegten Fehler findet: aendert
 * Skybridge die Ablage, faellt dieser Test — und nicht erst irgendwann
 * /status mit "0 Aufrufe" nach einem Timeout.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { getToolError } from 'skybridge/server'
import { alsProtokolliert, Gesperrt, istProtokolliert } from '../src/ausfuehren'
import { abfragen, pool } from '../src/db'
import { gescheiterteAufrufeProtokollieren } from '../src/zugriff_protokoll'

const DB = process.env.MCP_DATABASE_URL
const lauf = DB ? describe : describe.skip

const CLIENT = 'bun-test-middleware'
const TOOL_ERROR = Symbol.for('skybridge.toolError')

const anfrage = (name: string, args?: Record<string, unknown>) =>
  ({ method: 'tools/call', params: { name, arguments: args } })

const extraMit = (token: Record<string, unknown> | null) =>
  ({ http: { authInfo: { clientId: CLIENT, ...(token ? { extra: token } : {}) } } }) as any

/** Wie das SDK: der Handler wirft, Skybridge legt den Fehler ab, next() loest normal auf. */
const scheiterndMit = (extra: any, fehler: unknown, antwort: unknown = { isError: true, content: [] }) =>
  async () => { extra[TOOL_ERROR] = fehler; return antwort }

const anzahl = async (where: string, werte: unknown[] = []) =>
  (await abfragen<{ n: number }>(`SELECT count(*)::int AS n FROM mcp.zugriff WHERE ${where}`, werte))[0]!.n

const sperre = () => new Gesperrt({
  erlaubt: false, sichten: ['mart.betrieb'], koernung: [],
  befunde: [{ schluessel: 'test', schwere: 'sperre', hinweis: 'Ein Testbefund.' }],
})

describe('Markierung schon protokollierter Ausnahmen', () => {
  test('eine Gesperrt gilt immer als protokolliert', () => {
    expect(istProtokolliert(sperre())).toBe(true)
  })
  test('ein markierter Fehler gilt als protokolliert, ein frischer nicht', () => {
    expect(istProtokolliert(new Error('frisch'))).toBe(false)
    expect(istProtokolliert(alsProtokolliert(new Error('eingetragen')))).toBe(true)
  })
  test('die Markierung gibt denselben Fehler zurueck — damit `throw alsProtokolliert(e)` geht', () => {
    const e = new Error('x')
    expect(alsProtokolliert(e)).toBe(e)
  })
  test('Nicht-Objekte werfen nicht und gelten nicht als protokolliert', () => {
    expect(alsProtokolliert('text')).toBe('text')
    expect(istProtokolliert('text')).toBe(false)
    expect(istProtokolliert(null)).toBe(false)
    expect(istProtokolliert(undefined)).toBe(false)
  })
})

lauf('Middleware fuer gescheiterte Aufrufe', () => {
  afterAll(async () => {
    // Best effort, wie in ausfuehren.test.ts: mcp_leser darf hier nicht
    // loeschen, der Eigentuemer schon.
    await pool.query(`DELETE FROM mcp.zugriff WHERE client = $1
                          OR (client IS NULL AND werkzeug = 'test_ohne_anmeldung')`, [CLIENT])
      .catch(() => {})
  })

  test('ein gescheiterter Aufruf ohne eigenen Eintrag steht mit Werkzeug, Nutzer und Fehler im Protokoll', async () => {
    const extra = extraMit({ sub: 'test|middleware', name: 'Middleware-Test' })
    const fehler = new Error('canceling statement due to statement timeout')
    const antwort = { isError: true, content: [{ type: 'text', text: fehler.message }] }

    const ergebnis = await gescheiterteAufrufeProtokollieren(
      anfrage('datenstand', { betrieb: 'Köln' }), extra, scheiterndMit(extra, fehler, antwort))

    // Erst der Vertrag mit Skybridge, dann das Protokoll.
    expect(getToolError(extra)).toBe(fehler)
    expect(ergebnis).toBe(antwort)

    const [zeile] = await abfragen(
      `SELECT subject, anzeige, client, werkzeug, parameter, fehler, gesperrt, sql, dauer_ms
         FROM mcp.zugriff WHERE client = $1 ORDER BY zugriff_id DESC LIMIT 1`, [CLIENT])
    expect(zeile.werkzeug).toBe('datenstand')
    expect(zeile.subject).toBe('test|middleware')
    expect(zeile.anzeige).toBe('Middleware-Test')
    expect(zeile.parameter).toEqual({ betrieb: 'Köln' })
    expect(zeile.fehler).toBe('Error: canceling statement due to statement timeout')
    expect(zeile.gesperrt).toBe(false)
    expect(zeile.sql).toBeNull()
    expect(zeile.dauer_ms).toBeGreaterThanOrEqual(0)
  })

  test('eine Sperre aus dem Abfrageweg wird NICHT ein zweites Mal eingetragen', async () => {
    const extra = extraMit({ sub: 'test|middleware' })
    const vorher = await anzahl('client = $1', [CLIENT])
    await gescheiterteAufrufeProtokollieren(
      anfrage('abfrage_ausfuehren', { sql: 'SELECT 1' }), extra, scheiterndMit(extra, sperre()))
    expect(await anzahl('client = $1', [CLIENT])).toBe(vorher)
  })

  test('ein Datenbankfehler, den der Abfrageweg schon eingetragen hat, ebenso nicht', async () => {
    const extra = extraMit({ sub: 'test|middleware' })
    const vorher = await anzahl('client = $1', [CLIENT])
    await gescheiterteAufrufeProtokollieren(
      anfrage('abfrage_ausfuehren', { sql: 'SELECT 1/0' }), extra,
      scheiterndMit(extra, alsProtokolliert(new Error('division by zero'))))
    expect(await anzahl('client = $1', [CLIENT])).toBe(vorher)
  })

  test('ein gelungener Aufruf schreibt hier nichts — das tut das Werkzeug selbst', async () => {
    const extra = extraMit({ sub: 'test|middleware' })
    const vorher = await anzahl('client = $1', [CLIENT])
    const antwort = { content: [{ type: 'text', text: '3 Zeilen.' }] }
    const ergebnis = await gescheiterteAufrufeProtokollieren(
      anfrage('betriebe_suchen', { text: 'bayreuth' }), extra, async () => antwort)
    expect(ergebnis).toBe(antwort)
    expect(getToolError(extra)).toBeUndefined()
    expect(await anzahl('client = $1', [CLIENT])).toBe(vorher)
  })

  test('ohne Anmeldung bleibt subject leer — der Aufruf steht trotzdem drin', async () => {
    const extra = {} as any
    const wo = `client IS NULL AND subject IS NULL AND werkzeug = 'test_ohne_anmeldung'`
    const vorher = await anzahl(wo)
    await gescheiterteAufrufeProtokollieren(
      anfrage('test_ohne_anmeldung'), extra,
      scheiterndMit(extra, new Error('Keine Anmeldung erkannt.')))
    expect(await anzahl(wo)).toBe(vorher + 1)
    const [zeile] = await abfragen(
      `SELECT fehler, parameter FROM mcp.zugriff WHERE ${wo} ORDER BY zugriff_id DESC LIMIT 1`)
    expect(zeile.fehler).toBe('Error: Keine Anmeldung erkannt.')
    expect(zeile.parameter).toBeNull()
  })

  test('ein geworfener Nicht-Fehler (String) wird als Text eingetragen', async () => {
    const extra = extraMit({ sub: 'test|middleware' })
    await gescheiterteAufrufeProtokollieren(
      anfrage('sichten_suchen', { stichwort: 'x' }), extra, scheiterndMit(extra, 'nur ein Text'))
    const [zeile] = await abfragen(
      `SELECT fehler, werkzeug FROM mcp.zugriff WHERE client = $1 ORDER BY zugriff_id DESC LIMIT 1`, [CLIENT])
    expect(zeile.werkzeug).toBe('sichten_suchen')
    expect(zeile.fehler).toBe('nur ein Text')
  })
})
