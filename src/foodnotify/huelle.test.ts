import { describe, expect, test } from 'bun:test'
import { auspacken, istLeer, fehlerAusAntwort } from './huelle'

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

/**
 * Fehlertexte einer Nicht-2xx-Antwort (18.11.2026). Die deutschen Texte sind
 * wörtlich aus docs/payloads/foodnotify-2026-11/fehlermeldungen-2026-11-18.csv.
 */
describe('fehlerAusAntwort', () => {
  test('gemessene Validierungs-404 werden erkannt, egal in welchem Feld', () => {
    for (const text of [
      'Dieser Wert sollte nicht leer sein.',
      'Dieser Wert sollte nicht null sein.',
      'Dieser Wert sollte vom Typ int|string sein.',
      'Dieser Wert sollte nicht leer sein.\nDiese Zeichenkette ist zu kurz. Sie sollte mindestens 2 Zeichen haben.'
        + '\nDiese Sammlung sollte 1 oder mehr Elemente beinhalten.',
    ]) {
      for (const feld of ['message', 'detail', 'title']) {
        const r = fehlerAusAntwort(JSON.stringify({ [feld]: text }))
        expect(r.anfrageFehler).toBe('validierung')
        expect(r.meldung).toContain('Dieser Wert sollte')
      }
    }
    // Auch tief verschachtelt und als Klartext.
    expect(fehlerAusAntwort(JSON.stringify({ a: { b: ['Diese Sammlung sollte 1 oder mehr Elemente beinhalten.'] } }))
      .anfrageFehler).toBe('validierung')
    expect(fehlerAusAntwort('Dieser Wert sollte nicht leer sein.').anfrageFehler).toBe('validierung')
  })

  test('Symfonys englische Fassung und violations (nicht gemessen) gelten ebenfalls als Validierung', () => {
    expect(fehlerAusAntwort('{"detail":"This value should not be blank."}').anfrageFehler).toBe('validierung')
    expect(fehlerAusAntwort('{"violations":[{"propertyPath":"id","title":"x"}]}').anfrageFehler).toBe('validierung')
  })

  test('keine Route ist ein Fehler der Anfrage, nicht des Datensatzes', () => {
    const r = fehlerAusAntwort('{"message":"No route found for \\"GET https://my.foodnotify.com/api/recipes/1\\""}')
    expect(r.anfrageFehler).toBe('route')
  })

  test('echtes „gibt es nicht" bleibt ohne Befund — auch der gemessene EntityValueResolver-Text', () => {
    expect(fehlerAusAntwort('{"message":"not found"}')).toEqual({ meldung: 'not found', anfrageFehler: null })
    expect(fehlerAusAntwort(
      '{"message":"\\"PosBundle\\\\Database\\\\Entity\\\\Account\\" object not found by \\"Symfony\\\\Bridge\\\\Doctrine\\\\ArgumentResolver\\\\EntityValueResolver\\"."}',
    ).anfrageFehler).toBeNull()
    expect(fehlerAusAntwort('').anfrageFehler).toBeNull()
  })

  test('leerer Fehlerkörper ergibt keine Meldung — „HTTP 500" bleibt genau so', () => {
    expect(fehlerAusAntwort(JSON.stringify({ errors: [], code: 500, isError: true, payload: null })).meldung).toBe('')
  })

  test('Titel und Meldung zusammen, HTML ohne Tags, höchstens 300 Zeichen', () => {
    expect(fehlerAusAntwort('{"statusCode":500,"title":"NonUniqueResultException","message":"More than one result"}')
      .meldung).toBe('NonUniqueResultException: More than one result')
    expect(fehlerAusAntwort('<html><body><h1>502 Bad Gateway</h1><hr>nginx</body></html>').meldung)
      .toBe('502 Bad Gateway nginx')
    expect(fehlerAusAntwort(JSON.stringify({ message: 'x'.repeat(1000) })).meldung).toHaveLength(300)
  })
})
