import { describe, expect, test } from 'bun:test'
import { FN_ENDPUNKTE, fnEndpunkt, istFnEndpunkt } from './endpunkte'

describe('das FoodNotify-Register', () => {
  test('alle Keys tragen das fn:-Präfix — daran erkennt der Worker den Mandantenpfad', () => {
    for (const e of FN_ENDPUNKTE) expect(e.key.startsWith('fn:')).toBe(true)
  })

  test('kein Key kollidiert mit einem LINA-Endpunkt', async () => {
    const { ENDPUNKTE } = await import('../lina/endpunkte')
    const lina = new Set(ENDPUNKTE.map((e: { key: string }) => e.key))
    for (const e of FN_ENDPUNKTE) expect(lina.has(e.key)).toBe(false)
  })

  test('unbekannter Key wirft, wie beim LINA-Pendant', () => {
    expect(() => fnEndpunkt('fn:gibtsnicht')).toThrow('fn:gibtsnicht')
  })

  test('istFnEndpunkt trennt die Welten', () => {
    expect(istFnEndpunkt('fn:bestellungen')).toBe(true)
    expect(istFnEndpunkt('getUmsatzbericht')).toBe(false)
  })
})

describe('Pfadbau', () => {
  test('fn:betriebe braucht die Benutzer-ID aus der Session', () => {
    const e = fnEndpunkt('fn:betriebe')
    expect(e.pfad({}, 18336)).toBe('/api/core/business/18336/restaurants')
    expect(() => e.pfad({}, null)).toThrow('Benutzer-ID')
  })

  test('fn:bestellungen: chronologisch AUFSTEIGEND, Seite aus dem Posten', () => {
    const p = fnEndpunkt('fn:bestellungen').pfad({ erpId: '10483', seite: '3' }, null)
    expect(p).toContain('/api/10483/shop-order/paginate?')
    expect(p).toContain('order_direction=ASC')
    expect(p).toContain('page=3')
  })

  test('fehlender Pflichtparameter wirft mit dem Namen — ein Einreihungsfehler, kein HTTP-Fehler', () => {
    expect(() => fnEndpunkt('fn:bestellungen').pfad({ seite: '1' }, null)).toThrow('"erpId"')
    expect(() => fnEndpunkt('fn:bestellpositionen').pfad({ erpId: '1' }, null)).toThrow('"orderId"')
  })

  test('fn:bestellpositionen baut den change-Pfad', () => {
    expect(fnEndpunkt('fn:bestellpositionen').pfad({ erpId: '10483', orderId: '777' }, null))
      .toBe('/api/10483/shop-order/777/change?order_by=name')
  })

  test('fn:inventuren bündelt mehrere erpIds als Array-Parameter', () => {
    const p = fnEndpunkt('fn:inventuren').pfad({ erpIds: '10483,10484', seite: '2' }, null)
    expect(p.startsWith('/api/erp/stocktakings?')).toBe(true)
    expect(p).toContain('page=2')
    // URLSearchParams kodiert die eckigen Klammern — das ist Absicht (Symfony-Backend).
    expect(p).toContain('erpIds%5B%5D=10483')
    expect(p).toContain('erpIds%5B%5D=10484')
  })

  test('fn:inventuren ohne erpIds im Posten wirft', () => {
    expect(() => fnEndpunkt('fn:inventuren').pfad({ seite: '1' }, null)).toThrow('"erpIds"')
  })

  test('fn:inventuren mit leerer erpIds-Liste wirft ebenfalls', () => {
    expect(() => fnEndpunkt('fn:inventuren').pfad({ erpIds: '', seite: '1' }, null)).toThrow('erpIds')
  })

  test('fn:inventurpositionen baut den items-Pfad aus uuid und Seite', () => {
    expect(fnEndpunkt('fn:inventurpositionen').pfad({ uuid: 'inv-1', seite: '1' }, null))
      .toBe('/api/erp/stocktakings/inv-1/items?page=1')
    expect(fnEndpunkt('fn:inventurpositionen').pfad({ uuid: 'inv-1', seite: '2' }, null))
      .toBe('/api/erp/stocktakings/inv-1/items?page=2')
  })

  /**
   * Der Fehler, der bis zum 13.08.2026 lief: der Pfad kannte keinen
   * page-Parameter, /api/erp/stocktakings/{uuid}/items lieferte deshalb
   * immer nur die erste Seite von perPage 800. Neun Inventuren in
   * Produktion endeten bei exakt 800, zusammen fehlten 936 Positionen —
   * HTTP 200, kein Fehler, kein Log.
   *
   * Der Posten OHNE Seite muss werfen und darf nicht auf 1 zurückfallen:
   * ein stiller Vorgabewert waere genau der alte Zustand, nur mit einem
   * Parameter davor. Ein Posten ohne Seite ist ein Einreihungsfehler.
   */
  test('fn:inventurpositionen ohne Seite wirft — kein stiller Rückfall auf Seite 1', () => {
    expect(() => fnEndpunkt('fn:inventurpositionen').pfad({ uuid: 'inv-1' }, null))
      .toThrow('"seite"')
  })

  test('fn:inventurpositionen ohne uuid wirft', () => {
    expect(() => fnEndpunkt('fn:inventurpositionen').pfad({ seite: '1' }, null))
      .toThrow('"uuid"')
  })
})
