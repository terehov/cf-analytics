/**
 * Der Bounti-Client gegen die Attrappe.
 *
 * WAS HIER GEPRUEFT WIRD, ist ausnahmslos etwas, das im Betrieb STILL
 * schiefgehen würde:
 *
 *   * ein Seitenlauf, der nach der ersten Seite aufhört — die Zahlen sähen
 *     vollständig aus und wären es nicht
 *   * ein Cursor, der sich nicht bewegt — ein Nachtlauf, der bis zum Morgen
 *     dreht und das Stundenkontingent des Kunden verbraucht
 *   * eine abgelehnte Seitengrösse, die den ganzen Lauf mitnimmt, statt
 *     einmal kleiner zu werden
 *   * eine Wiederholung nach 403 — der schnellste Weg zu einem gesperrten
 *     Schlüssel (AGENTS.md Regel 7)
 *
 * Die Attrappen-URL wird AM config-OBJEKT gesetzt, nicht über die Umgebung.
 * `config` friert beim Laden ein, und bun test lädt alle Testdateien in
 * denselben Prozess — welche davon `../config` zuerst anfasst, hängt an der
 * Dateireihenfolge. Ein Test, der davon abhängt, besteht allein und fällt im
 * Verbund um; genau das ist hier beim Schreiben passiert.
 */
import { expect, test, describe, afterAll, beforeEach } from 'bun:test'
import { bountiMockStarten } from './mock'
import { config } from '../config'
import {
  bountiSeiten, bountiHolen, BountiFehler, BountiBudget,
  bountiZaehlerZuruecksetzen, bountiZaehler,
} from './client'

const mock = bountiMockStarten({ standorte: 12, limitMax: 100 })
const eng  = bountiMockStarten({ standorte: 12, limitMax: 20 })
const klemmt = bountiMockStarten({ standorte: 99, cursorKlemmt: true })
const bremst = bountiMockStarten({ standorte: 3, bremsen: 2 })

config.BOUNTI_BASE_URL = mock.url
config.BOUNTI_API_TOKEN = 'testtoken'
config.BOUNTI_SEITE = 5

beforeEach(() => bountiZaehlerZuruecksetzen())
afterAll(() => { mock.stoppen(); eng.stoppen(); klemmt.stoppen(); bremst.stoppen() })

describe('Seitenlauf', () => {
  test('holt ALLE Seiten, nicht nur die erste', async () => {
    const r = await bountiSeiten<{ id: string }>('/external/v1/locations')
    expect(r).toHaveLength(12)
    expect(r[0]!.id).toBe('loc0')
    expect(r.at(-1)!.id).toBe('loc11')
  })

  test('drei Aufrufe fuer 12 Zeilen bei Seitengroesse 5', async () => {
    mock.aufrufe.length = 0
    await bountiSeiten('/external/v1/locations')
    expect(mock.aufrufe).toHaveLength(3)
    expect(mock.aufrufe.every(a => a.methode === 'GET')).toBe(true)
  })

  test('ein Cursor, der sich nicht bewegt, beendet den Lauf', async () => {
    // Ohne diese Bremse dreht der Nachtlauf bis zum Morgen und raeumt das
    // Stundenkontingent leer.
    config.BOUNTI_BASE_URL = klemmt.url
    const r = await bountiSeiten<{ id: string }>('/external/v1/locations')
    config.BOUNTI_BASE_URL = mock.url
    expect(r.length).toBeLessThan(99)
    expect(bountiZaehler().aufrufe).toBeLessThan(5)
  })
})

describe('Seitengroesse', () => {
  test('nimmt Bounti die grosse Seite nicht, wird sie einmal kleiner — nicht der Lauf abgebrochen', async () => {
    config.BOUNTI_BASE_URL = eng.url
    config.BOUNTI_SEITE = 100
    bountiZaehlerZuruecksetzen()
    eng.aufrufe.length = 0
    const r = await bountiSeiten<{ id: string }>('/external/v1/locations')
    config.BOUNTI_BASE_URL = mock.url
    config.BOUNTI_SEITE = 5
    expect(r).toHaveLength(12)
    expect(eng.aufrufe[0]!.limit).toBe('100')
    expect(eng.aufrufe[1]!.limit).toBe('20')
  })
})

describe('Bremssignale', () => {
  test('429 wird wiederholt', async () => {
    config.BOUNTI_BASE_URL = bremst.url
    const r = await bountiSeiten<{ id: string }>('/external/v1/locations')
    config.BOUNTI_BASE_URL = mock.url
    expect(r).toHaveLength(3)
  })

  test('403 wird NICHT wiederholt', async () => {
    // Ein abgelehnter Schluessel wird beim zweiten Mal genauso abgelehnt.
    // Wiederholen ist der schnellste Weg zu einer Kontosperre (Regel 7).
    const alt = config.BOUNTI_API_TOKEN
    config.BOUNTI_API_TOKEN = 'falsch'
    mock.aufrufe.length = 0
    await expect(bountiHolen('/external/v1/locations')).rejects.toThrow(BountiFehler)
    expect(mock.aufrufe).toHaveLength(1)
    config.BOUNTI_API_TOKEN = alt
  })
})

describe('Aufrufbudget', () => {
  test('ist es erschoepft, endet der Lauf mit BountiBudget statt mit einem Fehler', async () => {
    // Der Unterschied traegt den ganzen Nachlauf: BountiBudget heisst
    // "fertig fuer heute", ein Fehler hiesse "kaputt".
    const alt = config.BOUNTI_AUFRUFE_MAX
    config.BOUNTI_AUFRUFE_MAX = 2
    bountiZaehlerZuruecksetzen()
    await expect(bountiSeiten('/external/v1/locations')).rejects.toThrow(BountiBudget)
    config.BOUNTI_AUFRUFE_MAX = alt
  })
})

describe('Antwortformen', () => {
  test('/roles kommt ohne Huelle — als blankes Array', async () => {
    const r = await bountiHolen<{ id: string }[]>('/external/v1/roles')
    expect(Array.isArray(r)).toBe(true)
    expect(r).toHaveLength(2)
  })
})
