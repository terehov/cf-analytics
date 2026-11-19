/**
 * Kassenartikel → Rezept (0155) ohne Datenbank: Transformation, Formprüfung,
 * Pfadbau, Zeitgrenze und der Schalter je Marke. Der Weg durch Worker, raw und
 * core steht in pos_artikel_db.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { posArtikel, posArtikelStrukturFehler } from './pos_artikel'
import { fnEndpunkt } from './endpunkte'

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/pos_artikel.json', import.meta.url), 'utf8'))
const antwort = (aenderung: (a: any) => void = () => {}) => {
  const a = structuredClone(FIXTURE)
  delete a._hinweis
  aenderung(a)
  return a
}

describe('posArtikel — die gemessene Form', () => {
  test('alle Felder werden übernommen, Preis und MwSt als Zahl', () => {
    const r = posArtikel(antwort())
    expect(r.standort).toBe('Testbetrieb Gera — Küche Test')
    expect(r.restaurantId).toBe(10436)
    expect(r.kannRezepteAnlegen).toBe(true)
    expect(r.ingestHinweise).toBe(1)
    expect(r.artikel).toHaveLength(5)
    expect(r.artikel[0]).toEqual({
      remoteId: 900001, plu: '1100001', externeId: '901', name: 'Testartikel mit Rezept',
      rezeptFnId: 1032008, rezeptTitel: 'Testrezept A', preis: 12.5, mwst: 19,
      istIgnoriert: false, wirdSynchronisiert: true, abwesendSeit: null,
      nameDoppelt: false, nameWeichtAb: false,
    })
    expect(r.artikel[2]!.istIgnoriert).toBe(true)
    expect(r.artikel[3]!.abwesendSeit).toBe('2026-10-30T13:04:57.000Z')
    expect(r.artikel[4]!.nameWeichtAb).toBe(true)
  })

  test('fehlende Kennzeichen werden null bzw. false, ein neues Feld stört nicht', () => {
    const r = posArtikel(antwort(a => {
      delete a.items[0].isIgnored
      delete a.items[0].hasLinkNameMismatch
      delete a.ingestIssues
      a.items[0].neuesFeld = 'x'
    }))
    expect(r.artikel[0]!.istIgnoriert).toBe(false)
    expect(r.artikel[0]!.nameWeichtAb).toBeNull()
    expect(r.ingestHinweise).toBe(0)
  })

  test('eine leere PLU ist keine PLU', () => {
    expect(posArtikel(antwort(a => { a.items[1].plu = '  ' })).artikel[1]!.plu).toBeNull()
  })

  test('die Minimalhülle {data: …} wird ausgepackt', () => {
    expect(posArtikelStrukturFehler({ data: antwort() })).toBeNull()
    expect(posArtikel({ data: antwort() }).artikel).toHaveLength(5)
  })
})

describe('posArtikelStrukturFehler — eine fremde Form lädt nichts', () => {
  test('die gemessene Form ist in Ordnung', () => {
    expect(posArtikelStrukturFehler(antwort())).toBeNull()
  })

  test('umbenannte recipeId: sonst hiesse es „kein Artikel hat ein Rezept"', () => {
    const f = posArtikelStrukturFehler(antwort(a => {
      for (const i of a.items) { i.recipe_id = i.recipeId; delete i.recipeId }
    }))
    expect(f).toContain('fn:pos_artikel')
    expect(f).toContain('recipeId')
    expect(() => posArtikel(antwort(a => { delete a.items[0].recipeId }))).toThrow('recipeId')
  })

  test('items ist keine Liste oder fehlt', () => {
    expect(posArtikelStrukturFehler(antwort(a => { a.items = { x: 1 } }))).toContain('items')
    expect(posArtikelStrukturFehler([])).toContain('Liste')
    expect(posArtikelStrukturFehler({ articles: [] })).toContain('articles')
  })

  test('remoteProductId keine ganze Zahl', () => {
    expect(posArtikelStrukturFehler(antwort(a => { a.items[0].remoteProductId = '900001' }))).toContain('remoteProductId')
  })

  test('doppelte remoteProductId in einer Antwort', () => {
    const f = posArtikelStrukturFehler(antwort(a => { a.items[1].remoteProductId = 900001 }))
    expect(f).toContain('900001')
    expect(f).toContain('zweimal')
  })

  test('Hüllenfehler (isError) wird gemeldet', () => {
    expect(posArtikelStrukturFehler({ errors: ['kaputt'], code: 500, isError: true, payload: null }))
      .toContain('Hüllenfehler')
  })
})

describe('fn:pos_artikel im Register', () => {
  test('Pfad aus der connectionId, nur Ziffern', () => {
    const e = fnEndpunkt('fn:pos_artikel')
    expect(e.pfad({ connectionId: '2052' }, null)).toBe('/api/pos/mapping/2052/articles')
    expect(() => e.pfad({ connectionId: '20 52' }, null)).toThrow('keine Zahl')
    expect(() => e.pfad({}, null)).toThrow('connectionId')
  })

  test('langer Zeitgrenzen-Pfad, Tagesgeschäft vor den Rezeptlisten', () => {
    const e = fnEndpunkt('fn:pos_artikel')
    expect(e.zeitgrenze).toBe('lang')
    expect(e.prioritaet).toBeLessThan(fnEndpunkt('fn:rezepte').prioritaet)
    expect(e.prioritaet).toBeGreaterThan(fnEndpunkt('fn:pos_standorte').prioritaet)
  })

  test('die Zeitgrenze: der größere der beiden Werte, nur für lange Pfade', async () => {
    const { fnZeitgrenzeMs } = await import('./client')
    const c = { ANFRAGE_TIMEOUT_MS: 60_000, FN_ZEITGRENZE_LANG_MS: 180_000 } as any
    expect(fnZeitgrenzeMs({ zeitgrenze: 'lang' }, c)).toBe(180_000)
    expect(fnZeitgrenzeMs({}, c)).toBe(60_000)
    // Ein erhöhtes ANFRAGE_TIMEOUT_MS verkürzt den langen Pfad nicht.
    expect(fnZeitgrenzeMs({ zeitgrenze: 'lang' }, { ...c, ANFRAGE_TIMEOUT_MS: 300_000 })).toBe(300_000)
  })
})

describe('POS_ARTIKEL_MARKEN', () => {
  test('kommagetrennt, ohne Leerraum und Doppelte; leer heisst keine Marke', async () => {
    const { posArtikelMarken } = await import('../config')
    expect(posArtikelMarken({ POS_ARTIKEL_MARKEN: ' wilma_wunder, aposto ,,wilma_wunder' }))
      .toEqual(['wilma_wunder', 'aposto'])
    expect(posArtikelMarken({ POS_ARTIKEL_MARKEN: '' })).toEqual([])
  })
})
