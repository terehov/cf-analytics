import { describe, expect, test } from 'bun:test'
import { auspacken, istLeer } from './huelle'

/**
 * Die Formen stammen aus der Erhebung vom 27.07.2026
 * (docs/foodnotify-api-inventar.md §1 und §8b) — nicht ausgedacht, gemessen.
 */
describe('auspacken', () => {
  test('erp-Hülle: {errors, payload, code, isError}', () => {
    const a = auspacken({
      code: 200, errors: [], isError: false,
      payload: [{ id: 11034, costCenter: { id: 11545 } }],
    })
    expect(a.daten).toEqual([{ id: 11034, costCenter: { id: 11545 } }])
    expect(a.fehler).toBeNull()
    expect(a.seiten).toBeNull()
  })

  test('recipes-Hülle: {data, pagination}', () => {
    const a = auspacken({
      data: [{ id: 1475907, name: '0,33l AFG Pils' }],
      pagination: { currentPage: 1, perPage: 25, totalItems: 672, totalPages: 27 },
    })
    expect(a.daten).toEqual([{ id: 1475907, name: '0,33l AFG Pils' }])
    expect(a.seiten).toEqual({ aktuelleSeite: 1, gesamtSeiten: 27, gesamt: 672 })
  })

  test('flache erpId-Hülle: Seitenzähler neben data', () => {
    const a = auspacken({
      order_by: 'timeCreated', order_direction: 'ASC',
      current_page: 3, current_page_size: 25, page_count: 464, total_count: 11578,
      data: [{ orderNumber: 'B-1' }], currency: 'EUR',
    })
    expect(a.daten).toEqual([{ orderNumber: 'B-1' }])
    expect(a.seiten).toEqual({ aktuelleSeite: 3, gesamtSeiten: 464, gesamt: 11578 })
  })

  test('nacktes Array (cost-analysis) bleibt unangetastet', () => {
    const zeilen = [{ posRecipeName: '0,25l Red Bull', quantity: 175 }]
    const a = auspacken(zeilen)
    expect(a.daten).toBe(zeilen)
    expect(a.seiten).toBeNull()
  })

  /**
   * DER WILMA-WUNDER-FALL. payload enthält wiederum {data: …} — das erste
   * Auspacken der Erhebung griff hier die falsche Ebene und meldete null
   * Inventuren statt 275. Lautlos: HTTP 200, leeres Ergebnis.
   */
  test('geschachtelt: payload → {data} wird bis zum Inhalt aufgelöst', () => {
    const a = auspacken({
      errors: [], code: 200, isError: false,
      payload: { data: [{ id: '019fba58', name: 'Inventur Bar' }] },
    })
    expect(a.daten).toEqual([{ id: '019fba58', name: 'Inventur Bar' }])
  })

  test('pos/locations: payload mit fachlichen Feldern wird NICHT weiter zerlegt', () => {
    // payload = {userId, locations} — locations ist der Inhalt, userId auch.
    // Ein Auspacker, der jedes Objekt weiter aufreißt, würde hier raten müssen.
    const a = auspacken({
      errors: [], code: 200, isError: false,
      payload: { userId: 18336, locations: [{ costCenterId: 10669 }] },
    })
    expect(a.daten).toEqual({ userId: 18336, locations: [{ costCenterId: 10669 }] })
  })

  test('fachliches Objekt mit data-Feld NEBEN anderen Feldern bleibt ganz', () => {
    const rezept = { id: 7, name: 'Pasta', data: { hinweis: 'fachlich' } }
    expect(auspacken(rezept).daten).toBe(rezept)
  })

  test('die Minimalhülle {data} allein wird ausgepackt', () => {
    const a = auspacken({ data: { id: 18336, firstName: 'Admin' } })
    expect(a.daten).toEqual({ id: 18336, firstName: 'Admin' })
  })

  test('isError=true wird zum Fehler, auch bei HTTP 200', () => {
    const a = auspacken({ errors: [], code: 500, isError: true, payload: null })
    expect(a.fehler).toContain('isError=true')
    expect(a.fehler).toContain('500')
  })

  test('errors[] wird zum Fehlertext', () => {
    const a = auspacken({
      errors: ['object not found', { feld: 'erpId' }], code: 404, isError: true, payload: null,
    })
    expect(a.fehler).toContain('object not found')
    expect(a.fehler).toContain('erpId')
  })

  test('Seiteninfo der äußeren Hülle überlebt das weitere Auspacken', () => {
    const a = auspacken({
      current_page: 2, page_count: 4, total_count: 70,
      data: { data: [{ id: 1 }] },
    })
    expect(a.daten).toEqual([{ id: 1 }])
    expect(a.seiten).toEqual({ aktuelleSeite: 2, gesamtSeiten: 4, gesamt: 70 })
  })

  test('Skalare und null gehen unverändert durch', () => {
    expect(auspacken(null).daten).toBeNull()
    expect(auspacken('text').daten).toBe('text')
    expect(auspacken(42).daten).toBe(42)
  })
})

describe('istLeer', () => {
  test('leer: null, leeres Array, leeres Objekt', () => {
    expect(istLeer(null)).toBe(true)
    expect(istLeer(undefined)).toBe(true)
    expect(istLeer([])).toBe(true)
    expect(istLeer({})).toBe(true)
  })

  test('nicht leer: Inhalt, auch falsy-Skalare', () => {
    expect(istLeer([0])).toBe(false)
    expect(istLeer({ a: null })).toBe(false)
    expect(istLeer(0)).toBe(false)
    expect(istLeer('')).toBe(false)
  })

  test('das Zusammenspiel: die lautlose leere 200er wird erkennbar', () => {
    // So sah der Wilma-Wunder-Fehler von außen aus: HTTP 200, Hülle korrekt,
    // Inhalt leer. auspacken + istLeer machen daraus ein prüfbares Signal.
    const a = auspacken({ errors: [], code: 200, isError: false, payload: { data: [] } })
    expect(a.fehler).toBeNull()
    expect(istLeer(a.daten)).toBe(true)
  })
})
