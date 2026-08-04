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
})
