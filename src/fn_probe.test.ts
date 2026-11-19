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

  test('die elf gemessenen und die zwei Seitengrößen-Pfade sind erlaubt', () => {
    const ok = ['/api/erp/all', '/api/pos/locations', '/api/pos/mapping/2052/articles', '/api/pos/mapping/2052/link-targets',
      '/api/recipes?page=1', '/api/7984/products', '/api/7984/sales', '/api/7984/sales/43027622/recipe-sale',
      '/api/analytics/reports/cost-analysis/ingredients/food-waste', '/api/erp/food-waste?erpId=7984&limit=5&page=1',
      '/api/erp/food-waste-alpha/totals?erpId=7984',
      '/api/11035/products?page=1&page_size=100', '/api/11035/products?page=1&page_size=1000']
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

  test('Aufrufplan im Standardfall: 16 Aufrufe', () => {
    expect(aufrufplan().reduce((s, p) => s + p.anzahl, 0)).toBe(16)
  })

  test('Aufrufplan mit --nur, festen IDs und Seitengrößen: Grundaufrufe für die Namen + link-targets + Warenstamm = 6 Aufrufe', () => {
    const plan = aufrufplan(3, 2, { nur: ['link-targets', 'warenstamm'], anbindung: 2052, erp: 7984, seitengroessen: true })
    expect(plan.reduce((s, p) => s + p.anzahl, 0)).toBe(6)
    // Seit 19.11.2026 auch bei festen IDs: die Zusammenfassung nennt den Namen (Testrestaurant-Fehler).
    expect(plan.map(p => p.vorlage)).toEqual(['/api/erp/all', '/api/pos/locations',
      '/api/pos/mapping/{connectionId}/link-targets', '/api/{erpId}/products', '/api/{erpId}/products?page=1&page_size={100|1000}'])
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
          case '/api/7001/sales': return flach([
            { id: 11, saleStatus: { name: 'finished' }, finishError: null, timeSold: { date: '2026-11-17 10:00:00.000000' } },
            { id: 12, saleStatus: { name: 'init' }, finishError: 'x', timeSold: { date: '2026-11-16 10:00:00.000000' } },
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
