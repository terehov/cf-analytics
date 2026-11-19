/**
 * fn-probe: Erlaubtliste, reine Auswertungen und der Lauf gegen eine EIGENE kleine
 * Attrappe (nicht src/foodnotify/mock.ts) — nie gegen das echte FoodNotify.
 *
 * `config` kann von einer früheren Testdatei geladen sein; wie in rezepte_probe.test.ts
 * wird DAS Objekt umgestellt und zurückgesetzt und vor jedem Lauf geprüft.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ERLAUBTE_MUSTER, aufrufplan, anbindungenWaehlen, artikelAuswerten, ausgabeVerzeichnis, feldpfade, foodWasteKostenanalyseAuswerten,
  fuellgrad, gemeldeteSeitengroesse, istTestName, kostenstellenWaehlen, kuerzen, letzteMonate, letzteTage, linkTargetsAuswerten, pfadErlaubt, pluForm, rezeptVerkaufAuswerten,
  rezeptlisteAuswerten, standorteAuswerten, verkaeufeAuswerten, warenstammAuswerten,
  aeltesterVerkaufAuswerten, freigabeOptionenPruefen, positionenAuswerten, tagAus, termineAuswerten,
  tiefeKosten, verkaufsTiefeAuswerten, warenkorbAuswerten, warenkorbListeAuswerten, wochentag,
} from './fn_probe'

// Die 14 GETs mit Wirkung aus docs/foodnotify-api-inventar-intern-2026-11.md §6, mit Beispiel-IDs.
const GETS_MIT_WIRKUNG = [
  '/app/lang', '/app/switch-design-mode', '/api/security_logout', '/api/erp/last-used/7984',
  '/api/pos/connection/unlink/2052', '/api/pos/product/unlink/all/2052', '/api/pos/sync/reload/2052',
  '/api/pos/ikentoo/businessData/2052/5', '/api/7984/sales/43027622/finish',
  '/api/menucreator/5/generate-embedded-url', '/shops/private/cancel-import',
  '/shops/private/5/edited_file/upload', '/shops/private/5/product/7/image/remove',
  '/shops/private/5/product/7/image/remove/3',
]

describe('Erlaubtliste', () => {
  test('keiner der 14 GETs mit Wirkung kommt durch — auch nicht mit angehängter Query', () => {
    expect(GETS_MIT_WIRKUNG.length).toBe(14)
    for (const p of GETS_MIT_WIRKUNG) {
      expect(pfadErlaubt(p).ok).toBe(false)
      expect(pfadErlaubt(`${p}?erpId=1`).ok).toBe(false)
    }
  })

  test('kein erlaubtes Muster kann einen dieser Pfade treffen (auch ohne Sperrliste)', () => {
    for (const p of GETS_MIT_WIRKUNG) for (const m of ERLAUBTE_MUSTER) expect(m.re.test(p)).toBe(false)
    const quelle = ERLAUBTE_MUSTER.map(m => m.re.source).join(' ')
    for (const wort of ['last-used', 'sync', 'reload', 'export', 'unlink', 'generate-embedded-url', 'finish', 'logout']) {
      expect(quelle.includes(wort)).toBe(false)
    }
  })

  test('Tableau-Ticket und Nachbarpfade sind gesperrt oder nicht erlaubt', () => {
    for (const p of ['/api/analytics', '/api/v2/analytics', '/api/pos/sync/locations', '/api/pos/mapping/2052/jobs/active',
      '/api/erp/food-waste', '/api/recipes?page=2', '/api/recipes/123', '/api/recipes/123/ingredients',
      '/api/7984/sales/43027622', '/api/7984/shop-order/1/change', '/api/7984/sales/../x', '/api/pos/mapping/x/articles',
      '/api/analytics/reports/cost-analysis/ingredients/by-product', '//evil/api/erp/all', 'api/erp/all']) {
      expect(pfadErlaubt(p).ok).toBe(false)
    }
  })

  test('die elf gemessenen, die zwei Seitengrößen-Pfade und die fünf Pfade vom 19.11.2026 sind erlaubt', () => {
    const ok = ['/api/erp/all', '/api/pos/locations', '/api/pos/mapping/2052/articles', '/api/pos/mapping/2052/link-targets',
      '/api/recipes?page=1', '/api/7984/products', '/api/7984/sales', '/api/7984/sales/43027622/recipe-sale',
      '/api/analytics/reports/cost-analysis/ingredients/food-waste', '/api/erp/food-waste?erpId=7984&limit=5&page=1',
      '/api/erp/food-waste-alpha/totals?erpId=7984',
      '/api/11035/products?page=1&page_size=100', '/api/11035/products?page=1&page_size=1000',
      '/api/7984/sales?page=1&page_size=1000&order_by=timeSold&order_direction=DESC',
      '/api/7984/sales?page=1&page_size=1&order_by=timeSold&order_direction=ASC',
      '/api/7984/sales/43077976/recipe-sale?page=1&page_size=100',
      '/api/carts/all?page=1&limit=50', '/api/carts/active?page=1&limit=50']
    expect(ok.length).toBe(ERLAUBTE_MUSTER.length)
    for (const p of ok) expect(pfadErlaubt(p).ok).toBe(true)
  })

  test('Seitengröße: nur zwei feste Varianten — kein anderer Wert, keine weiteren Parameter, keine andere Seite', () => {
    for (const p of ['/api/11035/products?page=1&page_size=500', '/api/11035/products?page=1&page_size=10000',
      '/api/11035/products?page=1&page_size=100&order_by=id', '/api/11035/products?page=2&page_size=100',
      '/api/11035/products?page_size=100', '/api/11035/products?page=1&page_size=100x', '/api/11035/products?page=1&page_size=-1',
      '/api/11035/products?page=1&perPage=100', '/api/11035/products?page=1&limit=100',
      '/api/11035/products?stocktakingVisibility=visible', '/api/11035/products/5', '/api/x/products?page=1&page_size=100']) {
      expect(pfadErlaubt(p).ok).toBe(false)
    }
  })

  test('Der Warenkorb-Detail-GET ist gesperrt (er schreibt, gemessen 19.11.2026) — in jeder Schreibweise', () => {
    for (const p of ['/api/shop/567/cart/draft/28093', '/api/shop/567/cart/active/1', '/api/shop/567/cart/faulty/1',
      '/api/shop/567/cart/draft/28093?x=1', '/api/shop/567/cart/DRAFT/28093', '/api/shop/8014/cart/draft/123/']) {
      const r = pfadErlaubt(p)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.grund).toContain('Sperrliste')
    }
    for (const m of ERLAUBTE_MUSTER) expect(m.re.test('/api/shop/567/cart/draft/28093')).toBe(false)
  })

  test('Verkaufstiefe und Warenkorb-Liste: nur die festen Varianten, kein anderer Wert, keine Schreib- oder Nachbarpfade', () => {
    for (const p of [
      '/api/7984/sales?page=1&page_size=500&order_by=timeSold&order_direction=DESC',
      '/api/7984/sales?page=2&page_size=1000&order_by=timeSold&order_direction=DESC',
      '/api/7984/sales?page=1&page_size=1000&order_by=timeSold&order_direction=ASC',
      '/api/7984/sales?page=1&page_size=1&order_by=timeSold&order_direction=DESC',
      '/api/7984/sales?page=1&page_size=1000&order_by=id&order_direction=DESC',
      '/api/7984/sales?page=1&page_size=1000&order_by=timeSold&order_direction=DESC&from=2026-11-01',
      '/api/7984/sales?status=finish', '/api/7984/sales/43077976', '/api/7984/sales/43077976/finish',
      '/api/7984/sales/43077976/recipe-sale?page=2&page_size=100', '/api/7984/sales/43077976/recipe-sale?page=1&page_size=1000',
      '/api/7984/recipe-sale/5', '/api/7984/recipe-sale/paginate',
      '/api/carts/draft?page=1&limit=50', '/api/carts/all?page=1&limit=500', '/api/carts/all?page=2&limit=50', '/api/carts/count', '/api/carts/all',
      '/api/shop/8014/cart/draft', '/api/shop/8014/cart/draft/123/x',
      '/api/shop/8014/info', '/api/shop/cart/add', '/api/shop/setCostCenter', '/api/cart/123/product/details', '/api/shop/x/cart/draft/1',
      '/shops/8014/cart/draft/123',
    ]) expect(pfadErlaubt(p).ok).toBe(false)
  })

  test('Aufrufplan im Standardfall: 16 Aufrufe', () => {
    expect(aufrufplan().reduce((s, p) => s + p.anzahl, 0)).toBe(16)
  })

  test('Aufrufplan mit --nur, festen IDs und Seitengrößen: Grundaufrufe für die Namen + link-targets + Warenstamm = 6 Aufrufe', () => {
    const plan = aufrufplan(3, 2, { nur: ['link-targets', 'warenstamm'], anbindung: 2052, erp: 7984, seitengroessen: true })
    expect(plan.reduce((s, p) => s + p.anzahl, 0)).toBe(6)
    // Seit 19.11.2026 auch bei festen IDs: die Zusammenfassung nennt den Namen (Testrestaurant-Fehler).
    expect(plan.map(p => p.vorlage)).toEqual(['/api/erp/all', '/api/pos/locations',
      '/api/pos/mapping/{connectionId}/link-targets', '/api/{erpId}/products', '/api/{erpId}/products?page=1&page_size={100|1000}'])
    // warenkorb und verkaeufe-tiefe laufen nie ohne --nur
    expect(aufrufplan().some(p => /carts|cart\/|page_size=1000&order_by/.test(p.vorlage))).toBe(false)
    expect(aufrufplan(3, 2, { nur: ['warenkorb'] }).map(p => [p.vorlage, p.anzahl])).toEqual([['/api/carts/{all|active}?page=1&limit=50', 1]])
    expect(aufrufplan(3, 2, { nur: ['verkaeufe-tiefe'], erpsAnzahl: 3 }).reduce((s, p) => s + p.anzahl, 0)).toBe(1 + 3 * 4)
    // ohne feste IDs: erp/all und locations kommen dazu
    expect(aufrufplan(3, 2, { nur: ['warenstamm'] }).map(p => p.vorlage)).toEqual(['/api/erp/all', '/api/pos/locations', '/api/{erpId}/products'])
  })

  test('Ausgabeverzeichnis trägt die Uhrzeit; gleiche Minute bekommt ein Suffix, nie dasselbe Verzeichnis', () => {
    const t = new Date('2026-11-19T13:07:42Z')
    expect(ausgabeVerzeichnis('belege', t, () => false)).toBe('belege/fn-probe-2026-11-19-1307')
    const da = new Set(['belege/fn-probe-2026-11-19-1307', 'belege/fn-probe-2026-11-19-1307-2'])
    expect(ausgabeVerzeichnis('belege', t, p => da.has(p))).toBe('belege/fn-probe-2026-11-19-1307-3')
  })
})

describe('Auswertungen', () => {
  test('feldpfade: eine Ebene Objektfelder', () => {
    expect(feldpfade([{ a: 1, b: { c: 1 } }, { d: [] }])).toEqual(['a', 'b', 'b.c', 'd'])
    // Personenfelder erscheinen nicht einmal als Name.
    expect(feldpfade([{ id: 1, createdByUser: { firstName: 'x' }, staffName: 'y', n: { lastName: 'z', ok: 1 } }])).toEqual(['id', 'n', 'n.ok'])
  })

  test('pluForm gibt nur die Form, nie den Wert', () => {
    expect(pluForm('1234')).toBe('9999')
    expect(pluForm('A12b')).toBe('A99A')
  })

  test('Testkostenstellen: „test" im Kostenstellen- oder Restaurantnamen, ohne Groß/Klein', () => {
    expect(istTestName('AAA Testrestaurant Wilma Wunder Bar')).toBe(true)
    expect(istTestName('Bar', 'CF GASTRO TESTBETRIEB')).toBe(true)
    expect(istTestName('Bar Ballplatz', 'Wilma Wunder Mainz')).toBe(false)
    expect(istTestName(null, undefined)).toBe(false)
    const st = [{ kostenstelleId: 1, connectionId: 10, kassensystem: 'amadeus' }, { kostenstelleId: 2, connectionId: 20, kassensystem: 'amadeus' }]
    const namen = new Map([[1, { kostenstelle: 'AAA Testrestaurant Bar', restaurant: 'AAA Testrestaurant' }],
                           [2, { kostenstelle: 'Bar Ballplatz', restaurant: 'Wilma Wunder Mainz' }]])
    const a = standorteAuswerten(st, namen)
    expect(a.anbindungen.map(x => [x.connectionId, x.test, x.namen])).toEqual([
      [10, true, ['AAA Testrestaurant — AAA Testrestaurant Bar']], [20, false, ['Wilma Wunder Mainz — Bar Ballplatz']]])
    expect(anbindungenWaehlen(a, 3).map(x => x.connectionId)).toEqual([20])
    const ks = [{ erpId: 11035, kostenstelleId: 1, name: 'AAA Testrestaurant Bar', restaurantName: 'AAA Testrestaurant' },
                { erpId: 7984, kostenstelleId: 2, name: 'Bar Ballplatz', restaurantName: 'Wilma Wunder Mainz' }]
    expect(kostenstellenWaehlen(ks, st, 2)).toEqual([7984])
  })

  test('Anbindungen und Kostenstellen: amadeus zuerst', () => {
    const st = [
      { kostenstelleId: 1, connectionId: 10, kassensystem: 'vectron' },
      { kostenstelleId: 2, connectionId: 20, kassensystem: 'amadeus' },
      { kostenstelleId: 3, connectionId: 20, kassensystem: 'amadeus' },
      { kostenstelleId: 4, connectionId: null, kassensystem: null },
    ]
    const a = standorteAuswerten(st)
    expect(a).toMatchObject({ standorte: 4, ohneAnbindung: 1, nachKassensystem: { vectron: 1, amadeus: 1 } })
    expect(a.anbindungen.find(x => x.connectionId === 20)!.kostenstellen).toBe(2)
    expect(anbindungenWaehlen(a, 1).map(x => x.connectionId)).toEqual([20])
    const ks = [1, 2, 3, 4].map(i => ({ erpId: 100 + i, kostenstelleId: i }))
    expect(kostenstellenWaehlen(ks, st, 2)).toEqual([102, 103])
  })

  test('Artikel: Anteil mit Rezept, PLU-Formen', () => {
    const r = artikelAuswerten({ items: [
      { plu: '1001', recipeId: 5, isIgnored: false, price: '1' },
      { plu: '1002', recipeId: null, isIgnored: false },
      { plu: '1002', recipeId: null, isIgnored: true },
      { plu: '', recipeId: 7, isIgnored: false },
    ], ingestIssues: [{}] })
    expect(r).toMatchObject({
      artikel: 4, mitRezept: 2, mitRezeptPct: 50, ignoriert: 1, mitRezeptOhneIgnorierte: 2, pluLeer: 1,
      pluNurZiffern: 3, pluVerschieden: 2, pluDoppelteWerte: 1, pluLaengen: { '4': 3 }, ingestIssues: 1,
    })
    expect(r.pluBeispielformen).toEqual(['9999 (3×)'])
  })

  test('link-targets: CSV, Monatsverteilung, Anteil ohne Zutaten', () => {
    const jetzt = new Date('2026-11-18T12:00:00Z')
    expect(letzteMonate(jetzt, 12)[0]).toBe('2025-12')
    const r = linkTargetsAuswerten([
      { recipeId: 1, title: 'Geheim', restaurantId: 9, ingredientCount: 0, updatedAt: '2026-11-17T10:00:00+01:00' },
      { recipeId: 2, title: 'x', restaurantId: 9, ingredientCount: 3, updatedAt: '2026-10-01T10:00:00+01:00' },
      { recipeId: 3, title: 'y', restaurantId: 8, ingredientCount: 2, updatedAt: '2022-10-19T10:00:00+01:00' },
      { recipeId: 4, title: 'z', restaurantId: 8, ingredientCount: 2 },
    ], jetzt)
    expect(r).toMatchObject({ anzahl: 4, ohneZutaten: 1, ohneZutatenPct: 25, restaurantIds: 2, aelterAlsZwoelfMonate: 1, ohneDatum: 1 })
    expect(r.updatedAtJeMonat['2026-11']).toBe(1)
    expect(r.updatedAtJeMonat['2026-10']).toBe(1)
    expect(r.csv.split('\n')[0]).toBe('id,ingredientCount,updatedAt,restaurantId')
    expect(r.csv).not.toContain('Geheim')
  })

  test('link-targets: Verteilung der Zutatenzahl, updatedAt je Tag (14) und Spanne', () => {
    const jetzt = new Date('2026-11-18T12:00:00Z')
    expect(letzteTage(jetzt, 14)[0]).toBe('2026-11-05')
    expect(letzteTage(jetzt, 14)[13]).toBe('2026-11-18')
    const r = linkTargetsAuswerten([
      { recipeId: 1, restaurantId: 9, ingredientCount: 0, updatedAt: '2026-11-18T01:00:00+01:00' },
      { recipeId: 2, restaurantId: 9, ingredientCount: 1, updatedAt: '2026-11-18T09:00:00+01:00' },
      { recipeId: 3, restaurantId: 9, ingredientCount: 5, updatedAt: '2026-11-12T09:00:00+01:00' },
      { recipeId: 4, restaurantId: 9, ingredientCount: 6, updatedAt: '2026-11-05T09:00:00+01:00' },
      { recipeId: 5, restaurantId: 9, ingredientCount: 20, updatedAt: '2026-11-04T09:00:00+01:00' },
      { recipeId: 6, restaurantId: 9, ingredientCount: 21, updatedAt: '2026-06-01T09:00:00+01:00' },
      { recipeId: 7, restaurantId: 9, ingredientCount: null },
    ], jetzt)
    expect(r.zutatenVerteilung).toEqual({ '0': 2, '1-5': 2, '6-20': 2, '>20': 1 })
    expect(r.updatedAtJeTag['2026-11-18']).toBe(2)
    expect(r.updatedAtJeTag['2026-11-05']).toBe(1)
    expect(Object.keys(r.updatedAtJeTag).length).toBe(14)
    expect(r.updatedAtLetzte14Tage).toBe(4)
    expect(r.updatedAtLetzte7Tage).toBe(3) // 18.11. (2) + 12.11. (1)
    expect(r.updatedAtMin).toBe('2026-06-01T09:00:00+01:00')
    expect(r.updatedAtMax).toBe('2026-11-18T09:00:00+01:00')
    expect(r.ohneDatum).toBe(1)
  })

  test('Rezeptliste, Warenstamm, Verkäufe, recipe-sale, Food Waste', () => {
    expect(rezeptlisteAuswerten({ data: [{ id: 1, archived: false }, { id: 2, archived: true }],
      pagination: { currentPage: 1, perPage: 25, totalItems: 60, totalPages: 3 } }))
      .toMatchObject({ totalItems: 60, totalPages: 3, archivedFeldVorhanden: 2, archiviert: 1, archiviertPct: 50 })

    const w = warenstammAuswerten({ errors: [], code: 200, isError: false, payload: {
      current_page: 1, page_count: 3, total_count: 50, data: [
        { id: 1, ingredient: { artikelId: '77' }, stock: { sumAmount: 0 } },
        { id: 2, ingredient: { artikelId: '' }, stock: { sumAmount: 2.5 } },
      ] } })
    expect(w).toMatchObject({ zeilen: 2, gesamt: 50, seitenZahl: 3, hatSeiten: true, mitIngredientArtikelId: 1,
      bestandUngleichNull: 1, bestandUngleichNullPct: 50 })
    expect(w.felder).toContain('ingredient.artikelId')
    expect(w).toMatchObject({ seitengroesseAngefragt: null, seitengroesseGemeldet: null })
    expect(w.preisfelder.pricePerUnit).toBe(0)
    expect(w.preisfelder['ingredient.artikelId']).toBe(1)
    expect(w.timeModifiedVon).toBeNull()

    const v = verkaeufeAuswerten({ errors: [], code: 200, isError: false, payload: { total_count: 9, page_count: 1, data: [
      { id: 5, saleStatus: { name: 'init' }, finishError: null, timeSold: { date: '2026-11-17 12:00:00.000000' } },
      { id: 6, saleStatus: { name: 'error' }, finishError: 'x', timeCreated: { date: '2026-11-10 08:00:00.000000' } },
    ] } })
    expect(v).toMatchObject({ zeilen: 2, gesamt: 9, saleStatus: { init: 1, error: 1 }, finishErrorGesetzt: 1,
      datumVon: '2026-11-10', datumBis: '2026-11-17', ids: [5, 6] })

    const rv = rezeptVerkaufAuswerten({ errors: [], code: 200, isError: false, payload: { total_count: 2, page_count: 1, data: [
      { id: 1, staffId: 3, staffName: 'Max Mustermann', recipe: { id: 1, recipeIngredients: [{}] } },
      { id: 2, staffId: 3, staffName: null, recipe: null },
    ] } })
    expect(rv).toMatchObject({ positionen: 2, mitRezept: 1, mitRezeptzutaten: 1 })
    expect(JSON.stringify(rv)).not.toContain('staff')

    expect(foodWasteKostenanalyseAuswerten({ data: [
      { restaurantId: 1, businessDate: '2026-11-01', totalWasteValue: 1.5 },
      { restaurantId: 2, businessDate: '2026-11-02', totalWasteValue: 2.25 },
    ] })).toMatchObject({ zeilen: 2, restaurants: 2, datumVon: '2026-11-01', datumBis: '2026-11-02', summeGesamtwert: 3.75 })
  })

  test('Warenstamm: Füllgrad der Preisfelder, timeModified-Spanne, gemeldete Seitengröße', () => {
    const roh = { errors: [], code: 200, isError: false, payload: { current_page: 1, current_page_size: 100, page_count: 8, total_count: 746, data: [
      { id: 1, pricePerUnit: 2.5, packagingQuantity: 6, packagingUnit: 'Fl', shop: { id: 3, name: 'S' }, timeModified: { date: '2026-10-01 08:00:00.000000' }, ingredient: { artikelId: '1' } },
      { id: 2, pricePerUnit: 0, packagingQuantity: null, packagingUnit: '', shop: null, timeModified: '2026-11-17T08:00:00+01:00', ingredient: null },
    ] } }
    const w = warenstammAuswerten(roh, 100)
    expect(w).toMatchObject({ seitengroesseAngefragt: 100, seitengroesseGemeldet: 100, gesamt: 746, seitenZahl: 8,
      timeModifiedVon: '2026-10-01 08:00:00.000000', timeModifiedBis: '2026-11-17T08:00:00+01:00' })
    expect(w.preisfelder).toMatchObject({ pricePerUnit: 2, packagingQuantity: 1, packagingUnit: 1, shop: 1, 'shop.id': 1, timeModified: 2, 'ingredient.artikelId': 1, unitPrice: 0 })
    expect(fuellgrad([{ a: { b: 1 } }, { a: { b: null } }, {}], ['a', 'a.b', 'c'])).toEqual({ a: 2, 'a.b': 1, c: 0 })
    expect(gemeldeteSeitengroesse({ data: [], pagination: { perPage: 800 } })).toBe(800)
    expect(gemeldeteSeitengroesse({ current_page_size: 20, data: [] })).toBe(20)
    expect(gemeldeteSeitengroesse([1])).toBeNull()
  })

  test('kuerzen: 300 Zeichen, keine Mail-Adressen', () => {
    expect(kuerzen('x'.repeat(500)).length).toBe(300)
    expect(kuerzen('Fehler für max@firma.de')).toBe('Fehler für <mail>')
  })
})

describe('Freigabepflicht der Verkaufstiefe (19.11.2026)', () => {
  test('--erps ist Pflicht, höchstens drei, nur positive Zahlen, nur mit der Frage', () => {
    expect(() => freigabeOptionenPruefen(['verkaeufe-tiefe'], {})).toThrow('--erps')
    expect(() => freigabeOptionenPruefen(['verkaeufe-tiefe'], { erps: [1, 2, 3, 4] })).toThrow('höchstens 3')
    expect(() => freigabeOptionenPruefen(['verkaeufe-tiefe'], { erps: [1, -2] })).toThrow('positive')
    expect(() => freigabeOptionenPruefen(['verkaeufe-tiefe'], { erps: [7984, 9444, 10772] })).not.toThrow()
    expect(() => freigabeOptionenPruefen(['warenstamm'], { erps: [7984] })).toThrow('gehört zur Frage verkaeufe-tiefe')
    expect(() => freigabeOptionenPruefen(['warenkorb'], {})).not.toThrow()
  })
})

describe('Auswertungen Warenkorb und Verkaufstiefe', () => {
  const liste = { isError: false, data: { carts: [
    { cartId: 1, shopId: 10, restaurantId: 5, costCenterId: 50, type: 'active', shopName: 'Lieferant A', restaurantName: 'X', costCenterName: 'Bar X', productCount: 3, cartTotal: '12.50', timeUpdated: { date: '2026-11-18 10:00:00.000000', timezone_type: 3, timezone: 'Europe/Berlin' } },
    { cartId: 2, shopId: 11, restaurantId: 5, costCenterId: 50, type: 'draft', shopName: 'Lieferant B', restaurantName: 'X', costCenterName: 'Bar X', productCount: 1, cartTotal: '5', timeUpdated: { date: '2026-11-10 09:00:00.000000' } },
    { cartId: 3, shopId: 12, restaurantId: 5, costCenterId: 50, type: 'draft', shopName: 'Lieferant C', restaurantName: 'X', costCenterName: 'Bar X', productCount: 1, cartTotal: '5', timeUpdated: { date: '2026-11-05 09:00:00.000000' }, deliveryDate: 1 },
    { cartId: 4, shopId: 13, restaurantId: 9, costCenterId: 90, type: 'draft', shopName: 'Lieferant D', restaurantName: 'AAA Testrestaurant', costCenterName: 'AAA Testrestaurant Bar', productCount: 1, cartTotal: '1', timeUpdated: { date: '2026-01-01 09:00:00.000000' } },
  ], totalPages: 1, totalResults: 4, currentPage: 1 } }

  test('Liste: Typen, Test erkannt, Vorschlag = ältester Entwurf ohne Test, Konditionsfelder', () => {
    const l = warenkorbListeAuswerten(liste)
    expect(l).toMatchObject({ anzahl: 4, gesamt: 4, seiten: 1, nachTyp: { active: 1, draft: 3 }, test: 1 })
    expect(l.vorschlag).toMatchObject({ cartId: 3, shopId: 12, type: 'draft', timeUpdated: '2026-11-05 09:00:00.000000' })
    expect(l.konditionsfelder).toEqual(['deliveryDate'])
    expect(l.eintraege.find(x => x.cartId === 4)?.test).toBe(true)
    expect(warenkorbListeAuswerten({ isError: false, data: { carts: [] } })).toMatchObject({ anzahl: 0, vorschlag: null })
  })

  test('Detail (nur Auswertung einer gespeicherten Rohantwort): Mindestbestellwert, Termine mit Wochentagen, preorderDays als Form', () => {
    const w = warenkorbAuswerten({ isError: false, data: { cart: {
      minimalOrderSum: 150, currency: 'EUR', deliveryDate: { date: '2026-11-24 00:00:00.000000' }, deliveryDateUpdated: false, note: '',
      deliveryDates: [{ date: '2026-11-24' }, { date: '2026-11-26' }, { date: '2026-11-27' }, { date: '2026-12-01' }],
      unavailableDeliveryDates: [{ date: '2026-11-25' }],
      createdByUser: { firstName: 'Erika' },
      products: [
        { id: 1, name: 'Burger', preorderDays: { passed: false, orderableUntil: { date: '2026-11-23 10:00:00.000000' }, available_from: { date: '2026-11-24 00:00:00.000000' }, desiredDeliveryDate: null } },
        { id: 2, name: 'Cola', preorderDays: null },
      ] } } })
    expect(w).toMatchObject({ gefunden: true, minimalOrderSum: 150, currency: 'EUR', deliveryDate: '2026-11-24', deliveryDateUpdated: false,
      produkte: 2, mitPreorderDays: 1, preorderPassed: 0, noteGefuellt: false })
    expect(w.liefertermine).toMatchObject({ anzahl: 4, von: '2026-11-24', bis: '2026-12-01', jeWochentag: { Di: 2, Do: 1, Fr: 1, Mo: 0 } })
    expect(w.gesperrteTermine.jeWochentag.Mi).toBe(1)
    expect(w.preorderFuellgrad).toEqual({ available_from: 1, desiredDeliveryDate: 0, orderableUntil: 1, passed: 1 })
    expect(JSON.stringify(w.preorderForm)).toContain('9999-99-99 99:99:99.999999')
    expect(JSON.stringify(w)).not.toContain('Burger')
    expect(JSON.stringify(w)).not.toContain('Erika')
    expect(w.felder).not.toContain('createdByUser')
    expect(warenkorbAuswerten({ foo: 1 }).gefunden).toBe(false)
    expect(warenkorbAuswerten({ minimalOrderSum: 5, deliveryDateUpdated: true })).toMatchObject({ deliveryDateUpdated: true })
  })

  test('tagAus, wochentag, Terminlisten: Text, PHP-Objekt, Unix-Zeit in Berliner Zeit', () => {
    expect(tagAus('2026-11-24')).toBe('2026-11-24')
    expect(tagAus({ date: '2026-11-24 00:00:00.000000' })).toBe('2026-11-24')
    expect(tagAus(1_795_561_200)).toBe('2026-11-25')            // 24.11.2026 23:00 UTC = 25.11. 00:00 Berlin
    expect(tagAus(1_795_561_200_000)).toBe('2026-11-25')
    expect(tagAus(null)).toBeNull()
    expect(wochentag('2026-11-19')).toBe('Do')
    expect(termineAuswerten([1_795_561_200, '2026-11-26']).tage).toEqual(['2026-11-25', '2026-11-26'])
  })

  const tag = (d: string, h: string, i: number, extra: Record<string, unknown> = {}) => ({
    id: i, sumPrice: 10 + i, saleStatus: { name: 'finish' }, saleType: { name: 'amadeus' }, finishError: null,
    timeSold: { date: `${d} ${h}:00:00.000000` }, timeCreated: { date: `${d} 23:50:17.000000` }, ...extra,
  })
  const jetzt = new Date('2026-11-19T10:00:00Z')

  test('Verkaufstiefe: Tage, angeschnittener Rand, heute zählt nicht, Lücke, Verzug, Schübe, Auswahl', () => {
    const daten = [
      tag('2026-11-19', '09', 1),                       // heute: unvollständig
      tag('2026-11-18', '20', 2), tag('2026-11-18', '07', 3, { sumPrice: -4 }),
      tag('2026-11-17', '12', 4, { sumPrice: 500 }),
      // 16.11. fehlt
      tag('2026-11-15', '12', 5), tag('2026-11-15', '13', 6, { saleStatus: { name: 'error' }, finishError: 'x' }),
      tag('2026-11-14', '12', 7),                       // ältester Tag der Seite: angeschnitten
    ]
    const roh = { errors: [], code: 200, isError: false, payload: { order_by: 'timeSold', order_direction: 'DESC', current_page: 1, current_page_size: 1000, page_count: 3, total_count: 2500, data: daten } }
    const t = verkaufsTiefeAuswerten(roh, jetzt)
    expect(t).toMatchObject({ zeilen: 7, gesamt: 2500, seitenZahl: 3, seitengroesseGemeldet: 1000, orderByGemeldet: 'timeSold', orderDirectionGemeldet: 'DESC',
      tageVollstaendig: 3, tageOhneVerkauf: ['2026-11-16'], finishErrorGesetzt: 1, negativ: 1, saleStatus: { finish: 6, error: 1 }, saleType: { amadeus: 7 } })
    expect(t.jeTag.map(d => [d.tag, d.vollstaendig])).toEqual([['2026-11-14', false], ['2026-11-15', true], ['2026-11-17', true], ['2026-11-18', true], ['2026-11-19', false]])
    expect(t.medianJeTag).toBe(2)
    expect(t.deckt14Tage).toBe(false)
    expect(t.verkaeufeLetzte14Tage).toBe(5)
    expect(t.anteilVor8UhrPct).toBe(14.3)
    expect(t.verzugMinuten.median).toBeGreaterThan(0)
    expect(t.anlageSchuebe.verschiedene).toBe(5)
    // Auswahl: jüngster Verkauf und größte Summe (beide finish), ohne Doppelung
    expect(t.auswahl.map(a => a.id)).toEqual([1, 4])
    // Die Seite enthält die ganze Historie: der älteste Tag ist vollständig
    const ganz = verkaufsTiefeAuswerten({ ...roh, payload: { ...roh.payload, total_count: 7 } }, jetzt)
    expect(ganz.jeTag[0]).toMatchObject({ tag: '2026-11-14', vollstaendig: true })
  })

  test('Ältester Verkauf, Positionen (Summen, Nummernfelder, keine Personen), Kostenrechnung', () => {
    const alt = aeltesterVerkaufAuswerten({ errors: [], code: 200, isError: false, payload: { current_page_size: 1, total_count: 21362, page_count: 21362,
      data: [{ id: 5, timeSold: { date: '2024-03-01 12:00:00.000000' }, timeCreated: { date: '2024-03-01 13:00:00.000000' }, saleStatus: { name: 'finish' } }] } })
    expect(alt).toMatchObject({ id: 5, timeSold: '2024-03-01 12:00:00.000000', gesamt: 21362, gemeldeteSeitengroesse: 1 })
    const p = positionenAuswerten({ errors: [], code: 200, isError: false, payload: { current_page_size: 100, page_count: 1, total_count: 3, data: [
      { id: 1, amount: 1, price: 2, sumPrice: 2.5, staffId: 3, staffName: 'Max Mustermann', voidReason: null,
        recipe: { id: 7, name: 'Cappuccino (Kasse)', price: 0, recipeIngredients: [{ id: 1, isRecipe: true, deleted: false, unresolvable: false, unitName: 'g', unitQuantity: 24 }, { id: 2, isRecipe: false, deleted: true, unresolvable: true, unitName: 'cu_7583', unitQuantity: 1 }] } },
      { id: 2, amount: -1, sumPrice: 1.5, staffId: 3, voidReason: 'x', recipe: { id: 7, name: 'Cappuccino (Kasse)', recipeIngredients: [] } },
      { id: 3, amount: 1, sumPrice: 0, recipe: { id: 8, name: 'Salat', plu: '1001', recipeIngredients: [{ id: 9, articleNumber: 'A1', unitName: 'ml' }] } },
    ] } }, 4)
    expect(p).toMatchObject({ positionen: 3, gesamt: 3, seitenZahl: 1, summePositionen: 4, abweichungZurListe: 0, rezeptIds: 2,
      zutatenJePosition: { min: 0, median: 1, max: 2 }, zutatenAufgeloest: 1, zutatenGeloescht: 1, zutatenUnaufloesbar: 1,
      mitStornogrund: 1, negativeMengen: 1, rezeptnameMitKasse: 2 })
    expect(p.nummernFelder).toEqual(['recipe.plu', 'zutat.articleNumber'])
    expect(JSON.stringify(p)).not.toContain('staff')
    expect(JSON.stringify(p)).not.toContain('Mustermann')
    expect(JSON.stringify(p)).not.toContain('Cappuccino')
    // 150 Verkäufe je Tag: 1 Listenaufruf + 150 Positionen; 35 Kostenstellen; Rückblick 54.750 Verkäufe
    const t = { ...verkaufsTiefeAuswerten({ errors: [], code: 200, isError: false, payload: { total_count: 1, data: [] } }, jetzt), medianJeTag: 150, gesamt: 21362 }
    const k = tiefeKosten(t, alt, jetzt, 2)
    expect(k).toMatchObject({ verkaeufeJeTag: 150, aufrufeJeTag: 151, aufrufeJeTag35: 5285 })
    expect(k.rueckblick12Monate).toEqual({ verkaeufe: 54750, listenaufrufe: 55, detailaufrufe: 54750, aufrufe: 54805 })
    expect(k.stundenJeTag35).toBe(2.9)
    expect(k.verkaeufeJeTagGesamt).toBe(Math.round((21362 / 993) * 10) / 10)   // 01.03.2024 bis 19.11.2026
    expect(tiefeKosten({ ...t, medianJeTag: null }, null, jetzt, 2)).toMatchObject({ aufrufeJeTag: null, rueckblick12Monate: null })
  })
})

// ---------------------------------------------------------------------------
// Lauf gegen eine eigene Attrappe
// ---------------------------------------------------------------------------

const MARKEN_ENV = ['APOSTO', 'ENCHILADA', 'DEUTSCHE_KONZEPTE', 'WILMA_WUNDER']
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } })

describe('fn-probe gegen die Attrappe', () => {
  const log: { methode: string; pfad: string }[] = []
  let anmeldungen = 0
  let modus: 'normal' | '429' | '403products' = 'normal'
  let server: ReturnType<typeof Bun.serve>
  let cfg: any
  const alt: Record<string, unknown> = {}
  let aus: string

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        const pfad = url.pathname + url.search
        log.push({ methode: req.method, pfad })
        if (url.pathname === '/api/user/auth/signin_check' && req.method === 'POST') {
          anmeldungen++
          const b = await req.json().catch(() => ({})) as any
          if (b.password !== 'geheim') return json({ message: 'no' }, { status: 401 })
          return json({ type: 'LoginSuccess' }, { headers: { 'set-cookie': 'PHPSESSID=abc; Path=/; HttpOnly' } })
        }
        if (!(req.headers.get('cookie') ?? '').includes('PHPSESSID=abc')) return json({ message: 'Unauthenticated' }, { status: 401 })
        const huelle = (payload: unknown) => json({ errors: [], code: 200, isError: false, payload })
        const flach = (data: unknown[], total: number) => huelle({ current_page: 1, page_count: 2, total_count: total, data })
        switch (url.pathname) {
          case '/api/profile': return json({ data: { id: 1 } })
          case '/api/erp/all': return huelle([
            // Steht vorn wie im Original („AAA …") und hat eine amadeus-Anbindung — die automatische
            // Auswahl muss sie trotzdem überspringen (19.11.2026).
            { id: 6999, costCenter: { id: 499, name: 'AAA Testrestaurant X Bar', restaurant: { id: 8, name: 'AAA Testrestaurant X' } } },
            { id: 7001, costCenter: { id: 501, name: 'Küche X', restaurant: { id: 9, name: 'X' } } },
            { id: 7002, costCenter: { id: 502, name: 'Bar X', restaurant: { id: 9, name: 'X' } } },
            { id: 7003, costCenter: { id: 503, name: 'Küche Y', restaurant: { id: 9, name: 'X' } } },
          ])
          case '/api/pos/locations': return huelle({ userId: 1, locations: [
            { restaurant: 'AAA Testrestaurant X', costCenter: 'AAA Testrestaurant X Bar', costCenterId: 499,
              connection: { connectionId: 2050, deviceType: { name: 'amadeus' } } },
            { restaurant: 'X', costCenter: 'Küche X', costCenterId: 501, connection: { connectionId: 2052, deviceType: { name: 'amadeus' } } },
            { restaurant: 'X', costCenter: 'Bar X', costCenterId: 502, connection: { connectionId: 2053, deviceType: { name: 'vectron' } } },
            { restaurant: 'X', costCenter: 'Küche Y', costCenterId: 503 },
          ] })
          case '/api/pos/mapping/2052/articles': return json({ location: 'a', restaurantId: 9, items: [
            { remoteProductId: 1, name: 'Burger', plu: '1001', recipeId: 5, recipeTitle: 'B', isIgnored: false },
            { remoteProductId: 2, name: 'Cola', plu: '1002', recipeId: null, recipeTitle: null, isIgnored: false },
          ], canCreateRecipes: true, ingestIssues: [] })
          case '/api/pos/mapping/2053/articles': return json({ location: 'b', restaurantId: 9, items: [
            { remoteProductId: 1, name: 'x', plu: 'A-1', recipeId: null, isIgnored: false }], ingestIssues: [] })
          case '/api/pos/mapping/2052/link-targets': return json([
            { recipeId: 5, title: 'Burger', restaurantId: 9, ingredientCount: 4, updatedAt: '2026-11-01T10:00:00+01:00' },
            { recipeId: 6, title: 'Leer', restaurantId: 9, ingredientCount: 0, updatedAt: '2026-10-01T10:00:00+01:00' }])
          case '/api/recipes': return json({ data: [{ id: 5, archived: false }, { id: 6, archived: true }],
            pagination: { currentPage: 1, perPage: 25, totalItems: 3, totalPages: 1 } })
          case '/api/7001/products':
            if (modus === '429') return json({ message: 'zu viele' }, { status: 429 })
            if (modus === '403products') return json({ message: 'Access Denied' }, { status: 403 })
            return flach([{ id: 1, ingredient: { artikelId: '12' }, stock: { sumAmount: 3 },
              createdByUser: { firstName: 'Erika', lastName: 'Musterfrau' } }], 40)
          case '/api/7002/products': return flach([{ id: 2, ingredient: { artikelId: '' }, stock: { sumAmount: 0 } }], 10)
          case '/api/carts/all':
          case '/api/carts/active': {
            return json({ isError: false, data: { carts: [
              { cartId: 1, shopId: 10, restaurantId: 9, costCenterId: 501, type: 'active', shopName: 'Lieferant A', restaurantName: 'X', costCenterName: 'Küche X', productCount: 3, cartTotal: '12.50', currency: 'EUR', timeUpdated: { date: '2026-11-18 10:00:00.000000' } },
              { cartId: 2, shopId: 11, restaurantId: 9, costCenterId: 502, type: 'draft', shopName: 'Lieferant B', restaurantName: 'X', costCenterName: 'Bar X', productCount: 1, cartTotal: '5', currency: 'EUR', timeUpdated: { date: '2026-11-10 09:00:00.000000' } },
              { cartId: 3, shopId: 12, restaurantId: 9, costCenterId: 502, type: 'draft', shopName: 'Lieferant C', restaurantName: 'X', costCenterName: 'Bar X', productCount: 2, cartTotal: '8', currency: 'EUR',
                timeUpdated: { date: '2026-11-05 09:00:00.000000' } },
              { cartId: 4, shopId: 13, restaurantId: 8, costCenterId: 499, type: 'draft', shopName: 'Lieferant D', restaurantName: 'AAA Testrestaurant X', costCenterName: 'AAA Testrestaurant X Bar', productCount: 1, cartTotal: '1', currency: 'EUR', timeUpdated: { date: '2026-01-01 09:00:00.000000' } },
            ], totalPages: 1, totalResults: 4, currentPage: 1 } })
          }
          case '/api/7001/sales': return flach([
            { id: 11, sumPrice: 10, saleStatus: { name: 'finish' }, saleType: { name: 'amadeus' }, finishError: null, timeSold: { date: '2026-11-17 10:00:00.000000' }, timeCreated: { date: '2026-11-17 23:50:17.000000' } },
            { id: 12, sumPrice: 99, saleStatus: { name: 'finish' }, saleType: { name: 'amadeus' }, finishError: 'x', timeSold: { date: '2026-11-16 10:00:00.000000' }, timeCreated: { date: '2026-11-16 23:50:17.000000' } },
            { id: 13, saleStatus: { name: 'init' }, finishError: null, timeSold: { date: '2026-11-15 10:00:00.000000' } }], 3)
          case '/api/7002/sales': return flach([], 0)
          case '/api/7001/sales/11/recipe-sale':
          case '/api/7001/sales/12/recipe-sale': return flach([
            { id: 1, staffId: 3, staffName: 'Max Mustermann', recipe: { id: 5, recipeIngredients: [{}] } }], 1)
          case '/api/analytics/reports/cost-analysis/ingredients/food-waste': return json({ data: [
            { restaurantId: 9, restaurantName: 'X', businessDate: '2026-11-01', totalWasteValue: 2 }] })
          case '/api/erp/food-waste': return json({ data: [], pagination: { currentPage: 1, perPage: 5, totalItems: 0, totalPages: 0 } })
          case '/api/erp/food-waste-alpha/totals': return json({ totalPrice: 0, totalProducts: 0, quantities: [] })
        }
        return json({ message: 'not found' }, { status: 404 })
      },
    })
    const { config } = await import('./config')
    cfg = config
    for (const k of ['FN_BASE_URL', 'FN_TAKT_MIN_MS', 'FN_TAKT_MAX_MS',
      ...MARKEN_ENV.flatMap(m => [`FN_${m}_USER`, `FN_${m}_PASSWORD`])]) { alt[k] = cfg[k]; cfg[k] = undefined }
    cfg.FN_BASE_URL = `http://localhost:${server.port}`
    cfg.FN_TAKT_MIN_MS = 0
    cfg.FN_TAKT_MAX_MS = 0
    cfg.FN_ENCHILADA_USER = 'test@aposto.eu'
    cfg.FN_ENCHILADA_PASSWORD = 'geheim'
    cfg.FN_WILMA_WUNDER_USER = 'falsch@aposto.eu'
    cfg.FN_WILMA_WUNDER_PASSWORD = 'falsches-passwort'
    aus = mkdtempSync(join(tmpdir(), 'fn-probe-'))
  })

  afterAll(() => {
    for (const [k, v] of Object.entries(alt)) cfg[k] = v
    server?.stop(true)
    rmSync(aus, { recursive: true, force: true })
  })

  const lauf = async (marken: string[], extra: Record<string, unknown> = {}) => {
    expect(cfg.FN_BASE_URL).toBe(`http://localhost:${server.port}`)   // Notbremse: nie gegen das echte FoodNotify
    log.length = 0
    const zeilen: string[] = []
    const { fnProbe } = await import('./fn_probe')
    const r = await fnProbe({ marken, aus, pauseMs: 0, jetzt: new Date('2026-11-18T12:00:00Z'), ausgabe: z => zeilen.push(z), ...extra })
    return { ...r, text: zeilen.join('\n') }
  }

  const alleDateien = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? alleDateien(join(dir, d.name)) : [join(dir, d.name)])

  test('Standardlauf: 15 GET (die Attrappe hat nur zwei Anbindungen, nicht drei), alles auf der Erlaubtliste, nur GET, keine Geheimnisse, keine Personen', async () => {
    modus = 'normal'
    const r = await lauf(['enchilada'])
    const e = r.ergebnisse[0]!
    expect(r.exitCode).toBe(0)
    // 1 erp/all + 1 locations + 2 articles + 1 link-targets + 1 recipes + 2 products + 2 sales + 2 recipe-sale + 3 food waste
    expect(e.aufrufe.length).toBe(15)
    // Die Testkostenstelle (6999, Anbindung 2050) steht vorn und hat amadeus — sie wird trotzdem übersprungen.
    expect(e.gewaehlteAnbindungen).toEqual([
      { connectionId: 2052, kassensystem: 'amadeus', name: 'X — Küche X' },
      { connectionId: 2053, kassensystem: 'vectron', name: 'X — Bar X' }])
    expect(e.gewaehlteKostenstellen).toEqual([7001, 7002])
    expect(e.kostenstellenNamen).toEqual([{ erpId: 7001, name: 'X — Küche X' }, { erpId: 7002, name: 'X — Bar X' }])
    expect(e.uebersprungenTest).toEqual([
      'Anbindung 2050 (AAA Testrestaurant X — AAA Testrestaurant X Bar)',
      'Kostenstelle 6999 (AAA Testrestaurant X — AAA Testrestaurant X Bar)'])
    const md = readFileSync(alleDateien(join(aus, 'enchilada')).find(d => d.endsWith('zusammenfassung.md'))!, 'utf8')
    expect(md).toContain('Gemessen an — Kostenstellen: 7001 (X — Küche X); 7002 (X — Bar X).')
    expect(md).toContain('Automatisch übersprungen')
    // Jede Anfrage: GET (außer der einen Anmeldung) und auf der Erlaubtliste (außer /api/profile der Anmeldung).
    for (const l of log) {
      if (l.pfad === '/api/user/auth/signin_check') { expect(l.methode).toBe('POST'); continue }
      expect(l.methode).toBe('GET')
      if (l.pfad === '/api/profile') continue
      expect(pfadErlaubt(l.pfad).ok).toBe(true)
    }
    expect(log.filter(l => l.methode === 'POST').length).toBe(1)
    // Ohne --nur liest der Standardlauf weder Warenkörbe noch die Verkaufstiefe.
    expect(log.some(l => /\/carts\/|\/cart\/|order_by=timeSold/.test(l.pfad))).toBe(false)
    expect(e.warenkorb).toBeNull()
    expect(e.verkaufsTiefe).toEqual([])
    expect(e.artikel.map(a => a.mitRezeptPct)).toEqual([50, 0])
    expect(e.linkTargets).toMatchObject({ connectionId: 2052, anzahl: 2, ohneZutaten: 1 })
    expect(e.abgleichRezeptzahl).toEqual({ totalItems: 3, linkTargets: 2, differenz: 1 })
    expect(e.rezeptliste).toMatchObject({ archiviert: 1, archivedFeldVorhanden: 2 })
    expect(e.warenstamm.map(w => w.erpId)).toEqual([7001, 7002])
    expect(e.rezeptVerkaeufe.map(x => x.verkaufId)).toEqual([11, 12])
    expect(e.foodWaste.kostenanalyse?.zeilen).toBe(1)

    const dateien = alleDateien(join(aus, 'enchilada'))
    expect(dateien.some(d => d.endsWith('zusammenfassung.md'))).toBe(true)
    expect(dateien.some(d => d.endsWith('zusammenfassung.json'))).toBe(true)
    expect(dateien.some(d => d.endsWith('link-targets.csv'))).toBe(true)
    for (const d of dateien.filter(x => /zusammenfassung|\.csv$/.test(x))) {
      const t = readFileSync(d, 'utf8')
      for (const verboten of ['geheim', 'test@aposto.eu', 'PHPSESSID', 'Mustermann', 'Musterfrau', 'Erika', 'staff', 'createdByUser', 'Burger']) {
        expect(t).not.toContain(verboten)
      }
    }
    expect(r.text).not.toContain('geheim')
    expect(r.text).not.toContain('PHPSESSID')
  })

  test('--nur, feste IDs, Seitengrößen: zwei Grundaufrufe für die Namen, dann vier GET; zweiter Lauf im eigenen Ordner', async () => {
    modus = 'normal'
    const zweiOrdner = mkdtempSync(join(tmpdir(), 'fn-probe-nur-'))
    try {
      const r = await lauf(['enchilada'], { nur: ['link-targets', 'warenstamm'], anbindung: 2052, erp: 7001, seitengroessen: true, aus: zweiOrdner })
      const e = r.ergebnisse[0]!
      expect(r.exitCode).toBe(0)
      const gets = log.filter(l => l.methode === 'GET' && l.pfad !== '/api/profile').map(l => l.pfad)
      expect(gets).toEqual(['/api/erp/all', '/api/pos/locations', '/api/pos/mapping/2052/link-targets', '/api/7001/products',
        '/api/7001/products?page=1&page_size=100', '/api/7001/products?page=1&page_size=1000'])
      // Ausdrücklich gewählt: der Name steht in der Zusammenfassung, ein Testname würde nicht gesperrt.
      expect(e.kostenstellenNamen).toEqual([{ erpId: 7001, name: 'X — Küche X' }])
      expect(e.gewaehlteAnbindungen).toEqual([{ connectionId: 2052, kassensystem: 'amadeus', name: 'X — Küche X' }])
      expect(e.uebersprungenTest).toEqual([])
      for (const g of gets) expect(pfadErlaubt(g).ok).toBe(true)
      expect(e.fragen).toEqual(['link-targets', 'warenstamm'])
      expect(e.festeAnbindung).toBe(2052)
      expect(e.warenstamm.map(w => w.seitengroesseAngefragt)).toEqual([null, 100, 1000])
      expect(e.linkTargets).toMatchObject({ anzahl: 2, updatedAtLetzte14Tage: 0 })
      expect(e.verkaeufe).toEqual([])
      expect(e.artikel).toEqual([])
      const md = readFileSync(join(zweiOrdner, 'enchilada', 'zusammenfassung.md'), 'utf8')
      expect(md).toContain('page_size angefragt')
      expect(md).toContain('Füllgrad')
      expect(md).toContain('Fragen: link-targets, warenstamm')
    } finally { rmSync(zweiOrdner, { recursive: true, force: true }) }
  })

  // --- Messungen vom 19.11.2026 ------------------------------------------------

  const gets = () => log.filter(l => l.methode === 'GET' && l.pfad !== '/api/profile').map(l => l.pfad)
  const zusammenfassungJson = (dir: string, marke = 'enchilada') =>
    JSON.parse(readFileSync(alleDateien(join(dir, marke)).find(d => d.endsWith('zusammenfassung.json'))!, 'utf8'))
  const neuerOrdner = () => mkdtempSync(join(tmpdir(), 'fn-probe-wk-'))

  test('Verkaufstiefe ohne --erps: Fehler vor dem ersten Aufruf', async () => {
    await expect(lauf(['enchilada'], { nur: ['verkaeufe-tiefe'] })).rejects.toThrow('--erps')
    expect(log.length).toBe(0)
  })

  test('Warenkorb-Liste: genau ein GET, nie ein Detail, Vorschlag und Test stehen in der Zusammenfassung', async () => {
    modus = 'normal'
    const dir = neuerOrdner()
    try {
      const r = await lauf(['enchilada'], { nur: ['warenkorb'], aus: dir })
      expect(gets()).toEqual(['/api/carts/all?page=1&limit=50'])
      expect(log.some(l => /\/cart\//.test(l.pfad))).toBe(false)
      const w = r.ergebnisse[0]!.warenkorb!
      expect(w.liste).toMatchObject({ anzahl: 4, test: 1, nachTyp: { active: 1, draft: 3 } })
      expect(w.liste?.vorschlag).toMatchObject({ shopId: 12, cartId: 3 })
      expect(r.exitCode).toBe(0)
      const md = readFileSync(join(dir, 'enchilada', 'zusammenfassung.md'), 'utf8')
      expect(md).toContain('## 7. Warenkorb-Liste')
      expect(md).toContain('Lieferant C')
      expect(md).not.toContain('PHPSESSID')
    } finally { rmSync(dir, { recursive: true, force: true }) }
    // --warenkorb-liste active holt die andere Liste
    const dir2 = neuerOrdner()
    try {
      await lauf(['enchilada'], { nur: ['warenkorb'], warenkorbListe: 'active', aus: dir2 })
      expect(gets()).toEqual(['/api/carts/active?page=1&limit=50'])
    } finally { rmSync(dir2, { recursive: true, force: true }) }
  })

  test('Verkaufstiefe: nur gewählte Kostenstellen, Testkostenstelle und Unbekannte nie, zwei Positionsabrufe, nur Erlaubtliste', async () => {
    modus = 'normal'
    const dir = neuerOrdner()
    try {
      const r = await lauf(['enchilada'], { nur: ['verkaeufe-tiefe'], erps: [7001, 6999, 7002], aus: dir })
      const e = r.ergebnisse[0]!
      expect(gets()).toEqual([
        '/api/erp/all',
        '/api/7001/sales?page=1&page_size=1000&order_by=timeSold&order_direction=DESC',
        '/api/7001/sales?page=1&page_size=1&order_by=timeSold&order_direction=ASC',
        '/api/7001/sales/11/recipe-sale?page=1&page_size=100',
        '/api/7001/sales/12/recipe-sale?page=1&page_size=100',
        '/api/7002/sales?page=1&page_size=1000&order_by=timeSold&order_direction=DESC',
        '/api/7002/sales?page=1&page_size=1&order_by=timeSold&order_direction=ASC',
      ])
      for (const g of gets()) expect(pfadErlaubt(g).ok).toBe(true)
      expect(e.verkaufsTiefe.map(t => [t.erpId, t.name])).toEqual([[7001, 'X — Küche X'], [7002, 'X — Bar X']])
      expect(e.verkaufsTiefe[0]!.positionen.map(p => p.verkaufId)).toEqual([11, 12])
      expect(e.verkaufsTiefe[0]!.liste).toMatchObject({ zeilen: 3, gesamt: 3 })
      expect(e.verkaufsTiefe[1]!.liste?.zeilen).toBe(0)
      expect(e.befunde.some(b => b.includes('6999') && b.includes('Testkostenstelle'))).toBe(true)
      // Zusammenfassung nennt die Kostenstellen mit Namen und trägt keine Personen
      const md = readFileSync(join(dir, 'enchilada', 'zusammenfassung.md'), 'utf8')
      expect(md).toContain('## 8. Verkaufstiefe')
      expect(md).toContain('7001 (X — Küche X)')
      expect(md).not.toContain('Mustermann')
      expect(md).not.toContain('staff')
      // Eine erpId, die nicht in /api/erp/all steht, wird nie gelesen (ihr Name wäre nicht prüfbar)
      const dir2 = neuerOrdner()
      try {
        const unbekannt = await lauf(['enchilada'], { nur: ['verkaeufe-tiefe'], erps: [5555], aus: dir2 })
        expect(gets()).toEqual(['/api/erp/all'])
        expect(unbekannt.ergebnisse[0]!.befunde.some(b => b.includes('5555') && b.includes('nicht in /api/erp/all'))).toBe(true)
      } finally { rmSync(dir2, { recursive: true, force: true }) }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('unbekannte Frage oder ungültige ID: Fehler vor dem ersten Aufruf', async () => {
    modus = 'normal'
    await expect(lauf(['enchilada'], { nur: ['sales' as any] })).rejects.toThrow('Unbekannte Frage')
    await expect(lauf(['enchilada'], { erp: -1 })).rejects.toThrow('--erp')
    expect(log.length).toBe(0)
  })

  test('Aufrufgrenze: hart, sauber abgebrochen, Rest steht als nicht geholt', async () => {
    modus = 'normal'
    const r = await lauf(['enchilada'], { maxAufrufe: 4 })
    const e = r.ergebnisse[0]!
    expect(e.aufrufe.length).toBe(4)
    expect(log.filter(l => l.methode === 'GET' && l.pfad !== '/api/profile').length).toBe(4)
    expect(e.abbruch).toContain('Aufrufgrenze 4')
    expect(e.nichtGeholt.length).toBeGreaterThan(5)
    expect(r.exitCode).toBe(2)
  })

  test('429: sofort Abbruch, danach kein weiterer Aufruf', async () => {
    modus = '429'
    try {
      const r = await lauf(['enchilada'])
      const e = r.ergebnisse[0]!
      expect(e.abbruch).toContain('429')
      const letzter = e.aufrufe[e.aufrufe.length - 1]!
      expect(letzter.status).toBe(429)
      expect(letzter.name).toBe('products_7001')
      expect(log.filter(l => l.methode === 'GET' && l.pfad !== '/api/profile').length).toBe(e.aufrufe.length)
      expect(e.nichtGeholt.length).toBeGreaterThan(0)
      expect(r.exitCode).toBe(2)
    } finally { modus = 'normal' }
  })

  test('403 je Pfad: festgehalten, kein Retry, der Lauf geht weiter', async () => {
    modus = '403products'
    try {
      const r = await lauf(['enchilada'])
      const e = r.ergebnisse[0]!
      expect(e.abbruch).toBeNull()
      expect(e.befunde.some(b => b.includes('products_7001') && b.includes('403'))).toBe(true)
      expect(log.filter(l => l.pfad === '/api/7001/products').length).toBe(1)
      expect(e.warenstamm.map(w => w.erpId)).toEqual([7002])
      expect(e.verkaeufe.length).toBe(2)
      expect(r.exitCode).toBe(2)
    } finally { modus = 'normal' }
  })

  test('Anmeldung scheitert: genau ein Versuch, kein GET, Passwort nirgends', async () => {
    const vorher = anmeldungen
    const r = await lauf(['wilma_wunder'])
    expect(anmeldungen - vorher).toBe(1)
    expect(log.filter(l => l.methode === 'GET').length).toBe(0)
    expect(r.ergebnisse[0]).toMatchObject({ anmeldung: 'gescheitert' })
    expect(r.exitCode).toBe(2)
    expect(r.text).not.toContain('falsches-passwort')
    expect(r.text).not.toContain('falsch@aposto.eu')
    const md = readFileSync(join(aus, 'wilma_wunder', 'zusammenfassung.md'), 'utf8')
    expect(md).not.toContain('falsches-passwort')
  })

  test('Marke ohne Zugang wird gemeldet, nicht angefragt', async () => {
    const r = await lauf(['aposto'])
    expect(r.ergebnisse[0]).toMatchObject({ anmeldung: 'kein Zugang' })
    expect(log.length).toBe(0)
  })
})
