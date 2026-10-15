/**
 * Rezepturen (0132) ohne Datenbank: Pfadbau, Transformation, Attrappe.
 * Die Fixtures sind echte Enchilada-Antworten (src/foodnotify/fixtures/rezepte.json).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fnEndpunkt, REZEPT_DETAIL_ENDPUNKTE } from './endpunkte'
import { rezeptliste, rezeptKopf, rezeptZutaten, rezeptMeta, rezeptStrukturFehler } from './rezept'

const FIX = JSON.parse(readFileSync(new URL('./fixtures/rezepte.json', import.meta.url), 'utf8')).rezepte

describe('Rezept-Endpunkte', () => {
  test('Liste: Seite aus dem Posten, sonst nichts — perPage wirkt bei FoodNotify nicht', () => {
    expect(fnEndpunkt('fn:rezepte').pfad({ seite: '3' }, null)).toBe('/api/recipes?page=3')
    expect(() => fnEndpunkt('fn:rezepte').pfad({}, null)).toThrow('"seite"')
  })

  test('Kopf, Zutaten, Meta bauen ihren Pfad aus der Rezept-ID', () => {
    expect(fnEndpunkt('fn:rezept').pfad({ rezeptId: '983835' }, null)).toBe('/api/recipes/983835')
    expect(fnEndpunkt('fn:rezept_zutaten').pfad({ rezeptId: '983835' }, null))
      .toBe('/api/recipes/983835/ingredients')
    expect(fnEndpunkt('fn:rezept_meta').pfad({ rezeptId: '983835' }, null)).toBe('/api/recipes/983835/meta')
  })

  test('eine Rezept-ID, die keine Zahl ist, wirft — kein /api/recipes/batch aus Versehen', () => {
    expect(() => fnEndpunkt('fn:rezept').pfad({ rezeptId: 'batch' }, null)).toThrow('keine Zahl')
    expect(() => fnEndpunkt('fn:rezept_zutaten').pfad({}, null)).toThrow('"rezeptId"')
  })

  test('die Listenseiten zählen nicht gegen REZEPTE_JE_LAUF', () => {
    expect([...REZEPT_DETAIL_ENDPUNKTE]).toEqual(['fn:rezept', 'fn:rezept_zutaten', 'fn:rezept_meta'])
  })
})

describe('Transformation', () => {
  test('Liste: {data, pagination} → Köpfe und Seitenzahl', () => {
    const r = rezeptliste({
      data: [FIX['1032008'].kopf, FIX['1048034'].kopf],
      pagination: { currentPage: 1, totalPages: 84, perPage: 25, totalItems: 2076 },
    })
    expect(r.seiten).toEqual({ aktuelleSeite: 1, gesamtSeiten: 84, gesamt: 2076 })
    expect(r.rezepte.map(x => x.fnId)).toEqual([1032008, 1048034])
    expect(r.rezepte[0]!.name).toBe('amarga muerte')
    expect(r.rezepte[0]!.erstelltAm).toBe('2023-06-23T12:30:38.000Z')
  })

  test('Kopf: doppelte Gruppen werden einmal geführt (983835 nennt "20. Basisartikel Bar" zweimal)', () => {
    const k = rezeptKopf({ data: FIX['983835'].kopf })!
    expect(k.fnId).toBe(983835)
    expect(k.gruppen).toEqual(['20. Basisartikel Bar'])
  })

  test('Zutaten: alle drei Arten, Lieferanten-Artikelnummer als Text, Unterrezept als Verweis', () => {
    const z = rezeptZutaten({ data: FIX['1032008'].zutaten })
    expect(z.map(x => x.art)).toEqual(['ingredient', 'ingredient', 'ingredient', 'sub_recipe', 'product_group'])
    expect(z[0]).toMatchObject({
      position: 1, artikelnummer: '714', menge: 3, einheit: 'cl',
      lieferantFnId: 6421, lieferantName: 'DISTRA Enchilada_Coyacan', subRezeptFnId: null,
    })
    // Das Unterrezept trägt keine Artikelnummer und keinen Lieferanten.
    expect(z[3]).toMatchObject({ art: 'sub_recipe', artikelnummer: null, lieferantFnId: null, subRezeptFnId: 983835 })
    // product_group trägt beides — fachlich wie eine Ware.
    expect(z[4]).toMatchObject({ art: 'product_group', artikelnummer: '14762710', lieferantFnId: 747 })
  })

  test('Zutaten über zwei Seiten werfen statt still abzuschneiden', () => {
    expect(() => rezeptZutaten({
      data: FIX['1032008'].zutaten, pagination: { currentPage: 1, totalPages: 2 },
    })).toThrow('2 Seiten')
  })

  test('eine leere Artikelnummer ist keine Artikelnummer', () => {
    const [z] = rezeptZutaten([{ id: 1, kind: 'ingredient', name: 'Freitext', artikelId: '  ', quantity: 1 }])
    expect(z!.artikelnummer).toBeNull()
  })

  test('Meta: Gewicht und der ungedeutete Verlust, roh', () => {
    expect(rezeptMeta({ data: FIX['983835'].meta })).toEqual({
      gewichtGesamt: 20000, gewichtPerson: 20000, portion: 20, portionEinheit: 'l', verlustRoh: 0,
    })
  })
})

/**
 * Review 15.10.2026: eine unbekannte Hülle ergab still [] bzw. null — der Lader
 * hätte die Zutaten gelöscht und zutaten_geholt_am gestempelt. Die gemessene
 * Form ist Pflicht; alles andere wirft bzw. wird als Befund gemeldet.
 */
describe('Antwortform', () => {
  test('gemessene Formen gehen durch, in jeder bekannten Hülle', () => {
    expect(rezeptStrukturFehler('fn:rezept_zutaten', FIX['1032008'].zutaten)).toBeNull()
    expect(rezeptStrukturFehler('fn:rezept_zutaten', { data: FIX['1032008'].zutaten })).toBeNull()
    expect(rezeptStrukturFehler('fn:rezept_zutaten', { data: [] })).toBeNull()
    expect(rezeptStrukturFehler('fn:rezept_meta', { data: FIX['983835'].meta })).toBeNull()
    expect(rezeptStrukturFehler('fn:rezept', { data: FIX['983835'].kopf })).toBeNull()
    expect(rezeptStrukturFehler('fn:rezepte', { data: [], pagination: { totalPages: 1 } })).toBeNull()
  })

  test('eine fremde Hülle ist ein Befund, keine leere Antwort', () => {
    expect(rezeptStrukturFehler('fn:rezept_zutaten', { ingredients: FIX['1032008'].zutaten }))
      .toContain('erwartet eine Liste, bekommen object mit Schlüsseln ingredients')
    expect(rezeptStrukturFehler('fn:rezept_meta', { meta: FIX['983835'].meta }))
      .toContain('erwartet ein Objekt mit weight')
    expect(rezeptStrukturFehler('fn:rezept', { data: { name: 'ohne id' } })).toContain('mit id')
    expect(rezeptStrukturFehler('fn:rezept_zutaten', { errors: ['kaputt'], isError: true, code: 500, payload: null }))
      .toContain('Hüllenfehler')
  })

  test('die Transformationen werfen selbst, statt [] oder null zu liefern', () => {
    expect(() => rezeptZutaten({ ingredients: FIX['1032008'].zutaten })).toThrow('erwartet eine Liste')
    expect(() => rezeptMeta({ meta: FIX['983835'].meta })).toThrow('weight')
  })
})

describe('Attrappe', () => {
  test('zwei Listenseiten, drei Rezepte nur über Verweis, unbekannte ID 404', async () => {
    const { fnMockStarten } = await import('./mock')
    const m = fnMockStarten()
    try {
      const anmelden = await fetch(`${m.url}/api/user/auth/signin_check`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'test@aposto.eu', password: 'geheim' }),
      })
      const cookie = anmelden.headers.get('set-cookie')!.split(';')[0]!
      const holen = (p: string) => fetch(`${m.url}${p}`, { headers: { cookie } })
      const s1 = rezeptliste(await (await holen('/api/recipes?page=1')).json())
      const s2 = rezeptliste(await (await holen('/api/recipes?page=2')).json())
      expect(s1.seiten.gesamtSeiten).toBe(2)
      expect([...s1.rezepte, ...s2.rezepte].map(r => r.fnId)).toEqual([1032008, 1048034, 1030679])
      expect(rezeptKopf(await (await holen('/api/recipes/983835')).json())!.name).toBe('Sweet & Sour Mix 20 L')
      expect((await holen('/api/recipes/1')).status).toBe(404)
    } finally { m.stop() }
  })
})
