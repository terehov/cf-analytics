/**
 * fn-token-probe: Erlaubt-/Sperrliste, Registerform, Aufrufgrenze, Schwärzung
 * und der Lauf gegen eine EIGENE kleine Attrappe (eingeschobenes fetch, nachgebaute
 * Sitzung) — nie gegen das echte FoodNotify, kein Netz.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FnZugang } from './config'
import {
  ERLAUBT_SITZUNG, ERLAUBT_TOKEN, MAX_AUFRUFE, TOKEN_BASIS, TOKEN_PFADE, ausgabeVerzeichnis, fehlermeldung, fnTokenProbe,
  geheimnisPruefen, grenzePruefen, kostenstelleWaehlen, pfadErlaubtFuer, registerPfad, rezeptWaehlen, schwaerzen, trockenlauf,
  typForm, zutatenAuswerten, type SitzungLike,
} from './fn_token_probe'

// Die 15 GETs mit Wirkung (docs/foodnotify-api-inventar-intern-2026-11.md §6), mit Beispiel-IDs.
const GETS_MIT_WIRKUNG = [
  '/app/lang', '/app/switch-design-mode', '/api/security_logout', '/api/erp/last-used/7984',
  '/api/pos/connection/unlink/2052', '/api/pos/product/unlink/all/2052', '/api/pos/sync/reload/2052',
  '/api/pos/ikentoo/businessData/2052/5', '/api/7984/sales/43027622/finish',
  '/api/menucreator/5/generate-embedded-url', '/shops/private/cancel-import',
  '/shops/private/5/edited_file/upload', '/shops/private/5/product/7/image/remove',
  '/shops/private/5/product/7/image/remove/3', '/api/shop/12/cart/draft/345',
]

const TOKEN = 'tok_GEHEIM_abcdef0123456789'
const TOKEN2 = 'tok_ANDERE_MARKE_9876543210'
const PASSWORT = 'pw-Sehr-Geheim-42'

describe('Erlaubt- und Sperrliste', () => {
  test('keiner der 15 GETs mit Wirkung kommt durch, auf keinem Host, auch nicht mit Query', () => {
    expect(GETS_MIT_WIRKUNG.length).toBe(15)
    for (const p of GETS_MIT_WIRKUNG) for (const h of ['sitzung', 'token'] as const) {
      expect(pfadErlaubtFuer(h, p).ok).toBe(false)
      expect(pfadErlaubtFuer(h, `${p}?page=1`).ok).toBe(false)
    }
  })

  test('kein erlaubtes Muster trifft einen GET mit Wirkung oder einen Warenkorb-/sync-/export-Pfad', () => {
    const weitere = ['/api/carts/all?page=1&limit=50', '/api/pos/export/without_reload/1', '/api/pos/sync/locations', '/api/shop/shoppingList/1']
    for (const p of [...GETS_MIT_WIRKUNG, ...weitere]) {
      for (const m of [...ERLAUBT_SITZUNG, ...ERLAUBT_TOKEN]) expect(m.re.test(p)).toBe(false)
      expect(pfadErlaubtFuer('token', p).ok).toBe(false)
    }
  })

  test('jede Registerform liegt auf der Token-Erlaubtliste, unter dem erwarteten Namen', () => {
    const faelle: [string, string][] = [
      [registerPfad.betriebe(10616), 'betriebe'],
      [registerPfad.rezepte(), 'rezepte'],
      [registerPfad.rezept(5), 'rezept'],
      [registerPfad.rezeptZutaten(5), 'rezept_zutaten'],
      [registerPfad.rezeptMeta(5), 'rezept_meta'],
      [registerPfad.bestellungen(7984), 'bestellungen'],
      [registerPfad.bestellung(7984, 77), 'bestellung'],
      [registerPfad.bestellpositionen(7984, 77), 'bestellpositionen'],
      [registerPfad.inventuren(7984), 'inventuren'],
      [registerPfad.warenstamm(7984), 'warenstamm'],
      [registerPfad.posArtikel(2052), 'pos_artikel'],
      ['/api/erp/core/10616/erps', 'erps'],
      ['/api/recipe-viewer/recipes?page=1', 'recipe_viewer'],
      ['/api/pos/mapping/2052/link-targets', 'link_targets'],
    ]
    for (const [p, name] of faelle) expect(pfadErlaubtFuer('token', p)).toEqual({ ok: true, muster: name })
    // Die Registerform selbst, damit eine Änderung im Register hier auffällt.
    expect(registerPfad.bestellungen(7984)).toBe('/api/7984/shop-order/paginate?page=1&page_size=25&order_by=timeCreated&order_direction=ASC')
    expect(registerPfad.inventuren(7984)).toBe('/api/erp/stocktakings?page=1&order_by=timeCreated&order_direction=ASC&erpIds%5B%5D=7984')
    expect(registerPfad.warenstamm(7984)).toBe('/api/7984/products?page=1&page_size=1000')
  })

  test('die Hosts sind getrennt: Sitzungspfade nicht über das Token und umgekehrt', () => {
    expect(pfadErlaubtFuer('sitzung', '/api/pos/locations').ok).toBe(true)
    expect(pfadErlaubtFuer('token', '/api/pos/locations').ok).toBe(false)
    expect(pfadErlaubtFuer('token', '/api/erp/all').ok).toBe(false)
    expect(pfadErlaubtFuer('sitzung', '/api/recipes/5').ok).toBe(false)
  })

  test('Abwandlungen fallen durch (andere Query, angehängter Pfad, Text statt Zahl)', () => {
    for (const p of [
      '/api/recipes?page=2', '/api/recipes/batch', '/api/recipes/5/ingredients?page=2', '/api/7984/products',
      '/api/7984/products?page=1&page_size=5', '/api/7984/shop-order/paginate?page=1&page_size=5&order_by=timeCreated&order_direction=DESC',
      '/api/pos/mapping/2052/articles/1', '/api/recipe-viewer/recipes?page=1&x=1',
    ]) expect(pfadErlaubtFuer('token', p).ok).toBe(false)
  })
})

describe('Grenze und Geheimnisse', () => {
  test('die Grenze lässt sich senken, nie erhöhen', () => {
    expect(grenzePruefen(undefined)).toBe(16)
    expect(MAX_AUFRUFE).toBe(16)
    expect(grenzePruefen(5)).toBe(5)
    expect(() => grenzePruefen(17)).toThrow()
    expect(() => grenzePruefen(-1)).toThrow()
    expect(() => grenzePruefen(1.5)).toThrow()
  })

  test('schwaerzen ersetzt jedes Geheimnis, geheimnisPruefen wirft', () => {
    const t = `x ${TOKEN} y ${PASSWORT}`
    const s = schwaerzen(t, [TOKEN, PASSWORT])
    expect(s).not.toContain(TOKEN)
    expect(s).not.toContain(PASSWORT)
    expect(() => geheimnisPruefen(t, [TOKEN], 'test')).toThrow()
    // Die Fehlermeldung nennt das Geheimnis selbst nicht.
    try { geheimnisPruefen(t, [TOKEN], 'test') } catch (x) { expect(String((x as Error).message)).not.toContain(TOKEN) }
    expect(() => geheimnisPruefen(s, [TOKEN, PASSWORT], 'test')).not.toThrow()
  })
})

describe('Auswertungen', () => {
  test('typForm: nur Typen, Listenlänge, keine Werte, keine Personenfelder', () => {
    const f = typForm({ data: [{ id: 7, name: 'Wilma Bar', preis: 1.5, createdByUser: { firstName: 'Anna' } }, {}], pagination: { totalItems: 2 } })
    expect(f).toBe('{data: [2×{id: int, name: text, preis: num}], pagination: {totalItems: int}}')
    expect(f).not.toContain('Wilma')
    expect(f).not.toContain('Anna')
  })

  test('fehlermeldung liest message, sonst den gekürzten Text', () => {
    expect(fehlermeldung('{"message":"This endpoint does not support scope-limited tokens."}')).toBe('This endpoint does not support scope-limited tokens.')
    expect(fehlermeldung('{"error":{"message":"Access Denied."}}')).toBe('Access Denied.')
    expect(fehlermeldung('<html>  nope </html>')).toBe('<html> nope </html>')
  })

  test('zutatenAuswerten zählt artikelId und kind', () => {
    const z = zutatenAuswerten({ data: [{ kind: 'ingredient', artikelId: '12' }, { kind: 'sub_recipe', artikelId: null }, { kind: 'ingredient', artikelId: ' ' }] })
    expect(z).toMatchObject({ anzahl: 3, mitArtikelId: 1, kinds: { ingredient: 2, sub_recipe: 1 } })
  })

  test('rezeptWaehlen nimmt ein nicht archiviertes Rezept mit Zutaten, sonst die Rückfälle', () => {
    const s1 = { data: [{ id: 1, archived: false }, { id: 2, archived: true }, { id: 3, archived: false }], pagination: { totalItems: 3 } }
    const lt = [{ recipeId: 1, ingredientCount: 0 }, { recipeId: 2, ingredientCount: 4 }, { recipeId: 3, ingredientCount: 2 }]
    expect(rezeptWaehlen(s1, lt)?.id).toBe(3)
    expect(rezeptWaehlen(null, lt)?.id).toBe(2)
    expect(rezeptWaehlen(s1, null)?.id).toBe(1)
    expect(rezeptWaehlen(null, null)).toBeNull()
  })

  test('kostenstelleWaehlen überspringt „test" und nimmt die an der Anbindung', () => {
    const ks = [
      { erpId: 11035, kostenstelleId: 1, restaurantId: 1, name: 'Küche', restaurantName: 'AAA Testrestaurant', art: 'kueche' as const },
      { erpId: 7000, kostenstelleId: 2, restaurantId: 2, name: 'Küche', restaurantName: 'Wilma Köln', art: 'kueche' as const },
      { erpId: 7984, kostenstelleId: 3, restaurantId: 3, name: 'Bar Ballplatz', restaurantName: 'Wilma Mainz', art: 'bar' as const },
    ]
    expect(kostenstelleWaehlen(ks, new Set([3]), new Map())?.erpId).toBe(7984)
    expect(kostenstelleWaehlen(ks, new Set([1]), new Map())?.erpId).toBe(7000)
  })

  test('ausgabeVerzeichnis: UTC-Datum und Minute, Kollision mit Zähler', () => {
    const j = new Date('2026-11-19T19:05:00Z')
    expect(ausgabeVerzeichnis('belege', j, () => false)).toBe(join('belege', 'fn-token-probe-2026-11-19-1905'))
    const da = new Set([join('belege', 'fn-token-probe-2026-11-19-1905')])
    expect(ausgabeVerzeichnis('belege', j, p => da.has(p))).toBe(join('belege', 'fn-token-probe-2026-11-19-1905-2'))
  })

  test('--dry-run: kein Netz, kein Token- oder Passwortwert in der Ausgabe', () => {
    const z = trockenlauf(['aposto', 'wilma_wunder'], 16, { wilma_wunder: TOKEN }, ['wilma_wunder']).join('\n')
    expect(z).toContain('wilma_wunder (Token, Sitzung)')
    expect(z).toContain('aposto (KEIN Token, KEINE Sitzung)')
    expect(z).toContain('= 16 GET im Regelfall')
    expect(z).not.toContain(TOKEN)
    expect(z).toContain('Nichts wurde aufgerufen.')
  })
})

// ---------------------------------------------------------------------------
// Der Lauf gegen die Attrappe
// ---------------------------------------------------------------------------

const verzeichnisse: string[] = []
afterAll(() => { for (const v of verzeichnisse) rmSync(v, { recursive: true, force: true }) })

type Fall = { status?: number; body: unknown; wirf?: string }

/**
 * Antworten je Pfad (ohne Basis). Jede Antwort, die einen Fehlertext hat, ECHOT das
 * Token und das Passwort — damit der Test zeigt, dass nichts davon durchkommt.
 */
function attrappe(sonder: Record<string, Fall> = {}) {
  const aufrufe: { url: string; methode: string; auth: string | null }[] = []
  const echo = `Bearer ${TOKEN} / ${PASSWORT}`
  const standard: Record<string, Fall> = {
    '/api/pos/locations': { body: { locations: [
      { costCenterId: 1, costCenter: 'Küche', restaurant: 'AAA Testrestaurant', connection: { connectionId: 900, deviceType: { name: 'amadeus' } } },
      { costCenterId: 3, costCenter: 'Bar Ballplatz', restaurant: 'Wilma Mainz', connection: { connectionId: 2052, deviceType: { name: 'amadeus' } } },
    ] } },
    '/api/core/business/10616/restaurants': { body: { data: [{ id: 1, name: 'x', timezone: 'Europe/Berlin' }] } },
    '/api/erp/core/10616/erps': { body: { data: [
      { id: 11035, costCenter: { id: 1, name: 'Küche', restaurant: { id: 1, name: 'AAA Testrestaurant' } } },
      { id: 7984, costCenter: { id: 3, name: 'Bar Ballplatz', restaurant: { id: 3, name: 'Wilma Mainz' } } },
    ] } },
    '/api/recipe-viewer/recipes?page=1': { body: { data: [{ id: 41, archived: false }, { id: 42, archived: false }], pagination: { totalItems: 2, totalPages: 1, perPage: 25 } } },
    '/api/recipes?page=1': { status: 403, body: { message: `This endpoint does not support scope-limited tokens. ${echo}` } },
    '/api/pos/mapping/2052/link-targets': { body: [{ recipeId: 41, ingredientCount: 0, updatedAt: '2026-11-01' }, { recipeId: 42, ingredientCount: 3, updatedAt: '2026-11-02' }] },
    '/api/recipes/42': { body: { data: { id: 42, name: 'Burger', archived: false } } },
    '/api/recipes/42/ingredients': { body: { data: [{ kind: 'ingredient', artikelId: '500096' }, { kind: 'sub_recipe', artikelId: null }] } },
    '/api/recipes/42/meta': { body: { data: { weight: { total: 1 } } } },
    '/api/7984/shop-order/paginate?page=1&page_size=25&order_by=timeCreated&order_direction=ASC': { body: { errors: [], code: 200, isError: false,
      payload: { order_by: 'timeCreated', order_direction: 'ASC', current_page: 1, current_page_size: 25, page_count: 3, total_count: 60, data: [{ id: 555 }] } } },
    '/api/7984/shop-order/555': { body: { errors: [], code: 200, isError: false, payload: { id: 555, markedShopOrder: { total: 1 } } } },
    '/api/7984/shop-order/555/change?order_by=name': { status: 403, body: { message: `This endpoint does not support scope-limited tokens. ${echo}` } },
    '/api/erp/stocktakings?page=1&order_by=timeCreated&order_direction=ASC&erpIds%5B%5D=7984': { status: 403, body: { message: 'This endpoint does not support scope-limited tokens.' } },
    '/api/7984/products?page=1&page_size=1000': { body: { errors: [], code: 200, isError: false, payload: { current_page: 1, current_page_size: 1000, page_count: 1, total_count: 1, data: [{ id: 1, unitPrice: 2 }] } } },
    '/api/pos/mapping/2052/articles': { body: { items: [{ plu: '100', recipeId: 42 }], ingestIssues: [] } },
  }
  const faelle = { ...standard, ...sonder }
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const h = (init?.headers ?? {}) as Record<string, string>
    aufrufe.push({ url: u, methode: init?.method ?? 'GET', auth: h.authorization ?? null })
    const pfad = u.replace(TOKEN_BASIS, '').replace(/^https:\/\/[^/]+/, '')
    const f = faelle[pfad]
    if (!f) return new Response(JSON.stringify({ message: `unbekannt ${echo}` }), { status: 404 })
    if (f.wirf) throw new Error(`${f.wirf} ${echo}`)
    return new Response(JSON.stringify(f.body), { status: f.status ?? 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetchFn, aufrufe }
}

const ZUGAENGE: FnZugang[] = [
  { schluessel: 'wilma_wunder', user: 'probe@example.org', password: PASSWORT },
  { schluessel: 'enchilada', user: 'probe2@example.org', password: PASSWORT + 'x' },
]
const sitzung = (opt: { scheitert?: boolean; ohneId?: boolean } = {}) => (): SitzungLike => ({
  benutzerId: null,
  async anmelden() {
    if (opt.scheitert) throw new Error(`HTTP 401 ${PASSWORT}`)
    this.benutzerId = opt.ohneId ? null : 10616
  },
  header: () => ({ accept: 'application/json', cookie: 'PHPSESSID=abc' }),
})

async function lauf(o: { sonder?: Record<string, Fall>; marken?: string[]; maxAufrufe?: number; sitz?: Parameters<typeof sitzung>[0] } = {}) {
  const aus = mkdtempSync(join(tmpdir(), 'fn-token-probe-'))
  verzeichnisse.push(aus)
  const a = attrappe(o.sonder)
  const zeilen: string[] = []
  const r = await fnTokenProbe({
    marken: o.marken ?? ['wilma_wunder'], aus, maxAufrufe: o.maxAufrufe, tokens: { wilma_wunder: TOKEN, enchilada: TOKEN2 }, zugaenge: ZUGAENGE,
    sitzungFabrik: sitzung(o.sitz), fetchFn: a.fetchFn, pauseMs: 0, ohneTakt: true, jetzt: new Date('2026-11-19T19:00:00Z'), ausgabe: z => zeilen.push(z),
  })
  return { ...r, aus, aufrufe: a.aufrufe, zeilen }
}

/** Alle Dateien eines Ordners (rekursiv) als Text. */
function alleDateien(dir: string): string {
  return readdirSync(dir).map(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? alleDateien(p) : readFileSync(p, 'utf8')
  }).join('\n')
}

describe('fn-token-probe gegen die Attrappe', () => {
  test('Regelfall: 16 GET, nur GET, Token nur gegen api3, Matrix vollständig', async () => {
    const r = await lauf()
    const e = r.ergebnisse[0]!
    expect(e.aufrufe.length).toBe(16)
    // 15 über fetch (das Profil läuft in der Anmeldung) — und nur GET.
    expect(r.aufrufe.length).toBe(15)
    expect(r.aufrufe.every(a => a.methode === 'GET')).toBe(true)
    for (const a of r.aufrufe) {
      if (a.auth) expect(a.url.startsWith(`${TOKEN_BASIS}/`)).toBe(true)
      else expect(a.url.startsWith(TOKEN_BASIS)).toBe(false)
    }
    expect(e.pfade.map(p => p.key)).toEqual(TOKEN_PFADE.map(t => t.key))
    expect(e.pfade.every(p => p.urteil !== 'nicht gemessen')).toBe(true)
    const u = Object.fromEntries(e.pfade.map(p => [p.key, p.urteil]))
    expect(u).toMatchObject({ rezepte: 'trägt nicht', bestellpositionen: 'trägt nicht', inventuren: 'trägt nicht', rezept_zutaten: 'trägt', pos_artikel: 'trägt' })
    // Testkostenstelle und -anbindung übersprungen, Namen genannt.
    expect(e.anbindung?.connectionId).toBe(2052)
    expect(e.kostenstelle).toMatchObject({ erpId: 7984, quelle: 'token' })
    expect(e.kostenstelle?.name).toContain('Bar Ballplatz')
    expect(e.uebersprungenTest.join(' ')).toContain('Testrestaurant')
    expect(e.rezept?.id).toBe(42)
    expect(e.orderId).toBe(555)
    expect(r.exitCode).toBe(0)
    const md = readFileSync(join(r.aus, 'zusammenfassung.md'), 'utf8')
    expect(md).toContain('| Pfad | Register | wilma_wunder |')
    expect(md).toContain('„scope-limited"')
  })

  test('kein Token- und kein Passwortwert in Zusammenfassung, Rohdateien, Konsole — auch wenn der Server sie echot', async () => {
    const r = await lauf({ marken: ['wilma_wunder', 'enchilada'] })
    const alles = `${alleDateien(r.aus)}\n${r.zeilen.join('\n')}\n${JSON.stringify(r.ergebnisse)}`
    for (const g of [TOKEN, TOKEN2, PASSWORT, PASSWORT + 'x']) expect(alles).not.toContain(g)
    expect(alles).toContain('<geschwärzt>')
    // Jede Marke mit ihrem eigenen Token.
    const auth = new Set(r.aufrufe.map(a => a.auth).filter(Boolean))
    expect(auth).toEqual(new Set([`Bearer ${TOKEN}`, `Bearer ${TOKEN2}`]))
  })

  test('Fehlertext einer Netzausnahme wird geschwärzt; Kassenartikel bekommen genau einen zweiten Versuch, wenn die Grenze es erlaubt', async () => {
    const r = await lauf({ maxAufrufe: 16, sonder: {
      '/api/7984/shop-order/paginate?page=1&page_size=25&order_by=timeCreated&order_direction=ASC': { body: { errors: [], code: 200, isError: false, payload: { total_count: 0, data: [] } } },
      '/api/pos/mapping/2052/articles': { body: null, wirf: 'TimeoutError' },
    } })
    const e = r.ergebnisse[0]!
    // Keine Bestellung → Kopf und Positionen nicht gemessen (2 frei) → Platz für den zweiten Versuch.
    expect(e.pfade.find(p => p.key === 'bestellung')?.urteil).toBe('nicht gemessen')
    const artikel = e.aufrufe.filter(a => a.key === 'pos_artikel')
    expect(artikel.length).toBe(2)
    expect(e.pfade.find(p => p.key === 'pos_artikel')?.urteil).toBe('unklar')
    expect(JSON.stringify(e)).not.toContain(TOKEN)
    expect(JSON.stringify(e)).not.toContain(PASSWORT)
    expect(r.exitCode).toBe(2)
  })

  test('kein zweiter Versuch bei 4xx, und keiner für andere Pfade bei Netzfehler', async () => {
    const r = await lauf({ sonder: {
      '/api/pos/mapping/2052/articles': { status: 500, body: { message: 'kaputt' } },
      '/api/7984/products?page=1&page_size=1000': { body: null, wirf: 'ECONNRESET' },
    } })
    const e = r.ergebnisse[0]!
    expect(e.aufrufe.filter(a => a.key === 'pos_artikel').length).toBe(1)
    expect(e.aufrufe.filter(a => a.key === 'warenstamm').length).toBe(1)
  })

  test('die Grenze hält: mit 6 Aufrufen bleibt der Rest „nicht gemessen", nichts darüber hinaus', async () => {
    const r = await lauf({ maxAufrufe: 6 })
    const e = r.ergebnisse[0]!
    expect(e.aufrufe.length).toBe(6)
    expect(r.aufrufe.length).toBe(5)
    expect(e.pfade.filter(p => p.urteil === 'nicht gemessen').every(p => /Aufrufgrenze 6/.test(p.meldung ?? ''))).toBe(true)
    expect(r.exitCode).toBe(2)
  })

  test('401 oder 429 brechen die Marke ab — danach geht nichts mehr hinaus', async () => {
    for (const status of [401, 429]) {
      const r = await lauf({ sonder: { '/api/recipe-viewer/recipes?page=1': { status, body: { message: 'nein' } } } })
      const e = r.ergebnisse[0]!
      expect(e.abbruch).toContain(String(status))
      const nr = e.aufrufe.findIndex(a => a.key === 'recipe_viewer')
      expect(e.aufrufe.length).toBe(nr + 1)
      expect(e.pfade.find(p => p.key === 'pos_artikel')?.urteil).toBe('nicht gemessen')
    }
  })

  test('Anmeldung scheitert: kein zweiter Versuch, kein GET, Passwort nicht in der Meldung', async () => {
    const r = await lauf({ sitz: { scheitert: true } })
    const e = r.ergebnisse[0]!
    expect(e.anmeldung).toBe('gescheitert')
    expect(r.aufrufe.length).toBe(0)
    expect(e.abbruch).not.toContain(PASSWORT)
    expect(e.pfade.every(p => p.urteil === 'nicht gemessen')).toBe(true)
  })

  test('Token liefert keine Kostenstellen: Rückfall auf die Sitzung /api/erp/all, an der Grenze fällt der letzte Pfad', async () => {
    const r = await lauf({ sonder: {
      '/api/erp/core/10616/erps': { status: 403, body: { message: 'This endpoint does not support scope-limited tokens.' } },
      '/api/erp/all': { body: [{ id: 7984, costCenter: { id: 3, name: 'Bar Ballplatz', restaurant: { id: 3, name: 'Wilma Mainz' } } }] },
    } })
    const e = r.ergebnisse[0]!
    expect(e.kostenstelle).toMatchObject({ erpId: 7984, quelle: 'sitzung' })
    expect(e.aufrufe.length).toBe(16)
    expect(e.pfade.find(p => p.key === 'pos_artikel')?.urteil).toBe('nicht gemessen')
  })
})
