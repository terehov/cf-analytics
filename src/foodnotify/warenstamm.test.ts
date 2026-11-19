/**
 * Warenstamm mit Listenpreis (0157) ohne Datenbank: Formprüfung, Pfadbau,
 * Register und der Schalter je Marke. Das Laden selbst steht in SQL
 * (core.warenstamm_laden) und wird in warenstamm_db.test.ts geprüft.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { warenstammStrukturFehler } from './warenstamm'
import { fnEndpunkt, WARENSTAMM_SEITENGROESSE } from './endpunkte'

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/warenstamm.json', import.meta.url), 'utf8'))
/** Die Fixture mit den Seitenfeldern, die die Attrappe je Aufruf setzt. */
const antwort = (aenderung: (a: any) => void = () => {}) => {
  const a = structuredClone(FIXTURE)
  delete a._hinweis
  const n = a.payload.data.length
  Object.assign(a.payload, { current_page: 1, current_page_size: 1000, page_count: 1, total_count: n })
  aenderung(a)
  return a
}

describe('warenstammStrukturFehler — die gemessene Form', () => {
  test('die Fixture passt, auch mit Eigenproduktion (shop null, ingredient []) und Katalogfeldern', () => {
    expect(warenstammStrukturFehler(antwort())).toBeNull()
    expect(antwort().payload.data.filter((p: any) => p.pricePerUnit).length).toBe(3)
  })

  test('unitPrice null ist erlaubt, ein neues Feld stört nicht', () => {
    expect(warenstammStrukturFehler(antwort(a => {
      a.payload.data[0].unitPrice = null
      a.payload.data[0].neuesFeld = 'x'
    }))).toBeNull()
  })

  test('ohne erp-Hülle (nur die Seite) geht es auch', () => {
    expect(warenstammStrukturFehler(antwort().payload)).toBeNull()
  })
})

describe('warenstammStrukturFehler — eine fremde Form lädt nichts', () => {
  test('umbenanntes unitPrice: sonst hiesse es „alle Preise entfallen"', () => {
    const f = warenstammStrukturFehler(antwort(a => {
      for (const p of a.payload.data) { p.price = p.unitPrice; delete p.unitPrice }
    }))
    expect(f).toContain('fn:warenstamm')
    expect(f).toContain('unitPrice')
  })

  test('data fehlt oder ist keine Liste', () => {
    expect(warenstammStrukturFehler(antwort(a => { a.payload.data = { x: 1 } }))).toContain('data')
    expect(warenstammStrukturFehler(antwort(a => { a.payload.items = a.payload.data; delete a.payload.data })))
      .toContain('data')
  })

  test('Seitenfelder fehlen: ohne sie ist „vollständig" nicht prüfbar', () => {
    expect(warenstammStrukturFehler(antwort(a => { delete a.payload.total_count }))).toContain('total_count')
    expect(warenstammStrukturFehler(antwort(a => { delete a.payload.current_page_size }))).toContain('current_page_size')
  })

  test('id keine ganze Zahl, name fehlt', () => {
    expect(warenstammStrukturFehler(antwort(a => { a.payload.data[0].id = '700001' }))).toContain('id')
    expect(warenstammStrukturFehler(antwort(a => { delete a.payload.data[1].name }))).toContain('name')
  })

  test('doppelte Produkt-id in einer Antwort', () => {
    const f = warenstammStrukturFehler(antwort(a => { a.payload.data[1].id = 700001 }))
    expect(f).toContain('700001')
    expect(f).toContain('zweimal')
  })

  test('Katalogfelder nur in der gemessenen Form: sonst hiesse es still „kein Katalogpreis"', () => {
    expect(warenstammStrukturFehler(antwort(a => { a.payload.data[0].pricePerUnit = 1.5 }))).toContain('pricePerUnit')
    expect(warenstammStrukturFehler(antwort(a => { delete a.payload.data[0].pricePerUnit.price }))).toContain('pricePerUnit')
    expect(warenstammStrukturFehler(antwort(a => { a.payload.data[0].packagingUnits = { x: 1 } }))).toContain('packagingUnits')
    expect(warenstammStrukturFehler(antwort(a => { a.payload.data[0].packagingUnit.price = 3.75 }))).toContain('packagingUnit')
  })

  test('Hüllenfehler (isError, errors) wird gemeldet', () => {
    expect(warenstammStrukturFehler({ errors: ['kaputt'], code: 500, isError: true, payload: null }))
      .toContain('Hüllenfehler')
    expect(warenstammStrukturFehler(antwort(a => { a.errors = ['Access Denied.'] }))).toContain('Hüllenfehler')
  })
})

describe('fn:warenstamm im Register', () => {
  test('Pfad: genau die gemessene Form, page_size 1000', () => {
    const e = fnEndpunkt('fn:warenstamm')
    expect(WARENSTAMM_SEITENGROESSE).toBe(1000)
    expect(e.pfad({ erpId: '11035', seite: '1' }, null)).toBe('/api/11035/products?page=1&page_size=1000')
    expect(e.pfad({ erpId: '11035', seite: '3' }, null)).toBe('/api/11035/products?page=3&page_size=1000')
  })

  test('nur Ziffern, beide Parameter Pflicht', () => {
    const e = fnEndpunkt('fn:warenstamm')
    expect(() => e.pfad({ erpId: '110 35', seite: '1' }, null)).toThrow('keine Zahlen')
    expect(() => e.pfad({ erpId: '11035', seite: 'x' }, null)).toThrow('keine Zahlen')
    expect(() => e.pfad({ seite: '1' }, null)).toThrow('erpId')
    expect(() => e.pfad({ erpId: '11035' }, null)).toThrow('seite')
  })

  test('Tagesgeschäft nach den Kassenartikeln, vor den Rezeptlisten; gewöhnliche Zeitgrenze', () => {
    const e = fnEndpunkt('fn:warenstamm')
    expect(e.prioritaet).toBeGreaterThan(fnEndpunkt('fn:pos_artikel').prioritaet)
    expect(e.prioritaet).toBeLessThan(fnEndpunkt('fn:rezepte').prioritaet)
    // 6,4 s für 1 MB gemessen — weit unter ANFRAGE_TIMEOUT_MS, kein langer Pfad.
    expect(e.zeitgrenze).toBeUndefined()
  })
})

describe('WARENSTAMM_MARKEN', () => {
  test('kommagetrennt, ohne Leerraum und Doppelte; leer heisst keine Marke', async () => {
    const { warenstammMarken } = await import('../config')
    expect(warenstammMarken({ WARENSTAMM_MARKEN: ' wilma_wunder, aposto ,,wilma_wunder' }))
      .toEqual(['wilma_wunder', 'aposto'])
    expect(warenstammMarken({ WARENSTAMM_MARKEN: '' })).toEqual([])
  })
})
