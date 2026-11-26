/**
 * Zwei Zugänge, eine Spur (0160): Token-Weg je Registereintrag, Rückfall auf
 * die Sitzung (kein Token, abgewiesen, Ausfall), kein Rückfall beim
 * fachlichen 404, keine Serie von Abweisungen, der Tokenwert nirgends.
 *
 * Ohne Datenbank, ohne Netz: FnClient mit eingeschobenem fetch und
 * nachgebauter Sitzung. Der Weg bis in sync.aufgabe / raw.api_antwort /
 * mart.fn_zugang_stand steht in zugang_db.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { FN_TOKEN_AUSFAELLE_BIS_SITZUNG, FnClient, ohneToken, type FnSitzungLike } from './client'
import { FN_ENDPUNKTE, FN_TOKEN_ENDPUNKTE, fnEndpunkt, fnTokenPfad, alsNichtGefundenVerbuchen } from './endpunkte'

const TOKEN = 'tok_TEST_wilma_0123456789abcdef'
const TOKEN_BASIS = 'https://token.attrappe'
const SITZUNG_BASIS_MUSTER = /^https?:\/\/(?!token\.attrappe)/

type Aufruf = { url: string; pfad: string; weg: 'token' | 'sitzung'; auth: string | null }
type Antwort = { status?: number; body?: unknown; text?: string; wirf?: 'timeout' | 'netz' }

/** Gültige Antworten je Eintrag — in der gemessenen Form, damit die Formprüfung durchgeht. */
const GUT: Record<string, unknown> = {
  'fn:rezepte': { data: [{ id: 1, name: 'R' }], pagination: { currentPage: 1, totalPages: 1, perPage: 25, totalItems: 1 } },
  'fn:rezept': { data: { id: 5, name: 'R' } },
  'fn:rezept_zutaten': { data: [{ id: 9, kind: 'ingredient', artikelId: '1' }] },
  'fn:rezept_meta': { data: { weight: { total: 100 } } },
  'fn:pos_artikel': JSON.parse(readFileSync(new URL('./fixtures/pos_artikel.json', import.meta.url), 'utf8')),
  'fn:warenstamm': (() => {
    // Wie die Attrappe: die Fixture trägt die Seitenangaben nicht, der Server setzt sie.
    const w = JSON.parse(readFileSync(new URL('./fixtures/warenstamm.json', import.meta.url), 'utf8'))
    const n = w.payload.data.length
    return { ...w, payload: { ...w.payload, current_page: 1, current_page_size: 1000, page_count: 1, total_count: n } }
  })(),
  'fn:bestellpositionen': { data: [] },
}
const PARAMETER: Record<string, Record<string, string>> = {
  'fn:rezepte': { seite: '3' },
  'fn:rezept': { rezeptId: '5' }, 'fn:rezept_zutaten': { rezeptId: '5' }, 'fn:rezept_meta': { rezeptId: '5' },
  'fn:pos_artikel': { connectionId: '2052' },
  'fn:warenstamm': { erpId: '7984', seite: '1' },
  'fn:bestellpositionen': { erpId: '7984', orderId: '77' },
}
const epAusPfad = (pfad: string): string => {
  if (/recipe-viewer|\/api\/recipes\?/.test(pfad)) return 'fn:rezepte'
  if (/\/ingredients$/.test(pfad)) return 'fn:rezept_zutaten'
  if (/\/meta$/.test(pfad)) return 'fn:rezept_meta'
  if (/\/api\/recipes\/\d+$/.test(pfad)) return 'fn:rezept'
  if (/\/articles$/.test(pfad)) return 'fn:pos_artikel'
  if (/\/products\?/.test(pfad)) return 'fn:warenstamm'
  if (/\/change\?/.test(pfad)) return 'fn:bestellpositionen'
  return '?'
}

function aufbau(o: { tokens?: Record<string, string>; token?: (pfad: string, n: number) => Antwort | undefined; sitzung?: (pfad: string) => Antwort | undefined } = {}) {
  const aufrufe: Aufruf[] = []
  let tokenNr = 0
  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    const h = (init.headers ?? {}) as Record<string, string>
    const weg = url.startsWith(TOKEN_BASIS) ? 'token' as const : 'sitzung' as const
    const pfad = url.replace(/^https?:\/\/[^/]+/, '')
    aufrufe.push({ url, pfad, weg, auth: h.authorization ?? null })
    const a = (weg === 'token' ? o.token?.(pfad, ++tokenNr) : o.sitzung?.(pfad)) ?? { body: GUT[epAusPfad(pfad)] }
    if (a.wirf === 'timeout') { const e = new Error('Zeit'); e.name = 'TimeoutError'; throw e }
    if (a.wirf === 'netz') throw new Error(`ECONNRESET bei Bearer ${TOKEN}`)
    return new Response(a.text ?? JSON.stringify(a.body), { status: a.status ?? 200 })
  }
  let anmeldungen = 0
  const sitzung: FnSitzungLike = {
    istAngemeldet: false, benutzerId: null,
    async anmelden() { anmeldungen++; (this as { istAngemeldet: boolean }).istAngemeldet = true; this.benutzerId = 10616 },
    header: () => ({ accept: 'application/json', cookie: 'PHPSESSID=x' }),
  }
  const client = new FnClient({
    fetchFn, tokens: o.tokens ?? { wilma_wunder: TOKEN }, tokenBasis: TOKEN_BASIS,
    sitzungFabrik: () => sitzung, grenzen: () => ({ taktMin: 0, taktMax: 0, tagesbudget: 1_000 }),
  })
  return { client, aufrufe, get anmeldungen() { return anmeldungen } }
}

const holen = (c: FnClient, key: string, marke = 'wilma_wunder', p?: Record<string, string>) =>
  c.holen(fnEndpunkt(key), marke, p ?? PARAMETER[key]!)

const SCOPE = { status: 403, body: { message: `This endpoint does not support scope-limited tokens. Bearer ${TOKEN}` } }

describe('Register: wer bevorzugt das Token', () => {
  test('genau die sechs Einträge aus der Entscheidung vom 19.11.2026', () => {
    expect([...FN_TOKEN_ENDPUNKTE].sort()).toEqual(
      ['fn:pos_artikel', 'fn:rezept', 'fn:rezept_meta', 'fn:rezept_zutaten', 'fn:rezepte', 'fn:warenstamm'])
    // Alles, was Bestellungen, Inventuren oder die Benutzer-ID braucht, bleibt bei der Sitzung.
    for (const k of ['fn:profil', 'fn:betriebe', 'fn:kostenstellen', 'fn:pos_standorte', 'fn:bestellungen', 'fn:bestellung',
      'fn:bestellpositionen', 'fn:bestellansicht', 'fn:inventuren', 'fn:inventurpositionen']) {
      expect(fnEndpunkt(k).token).toBeUndefined()
    }
    expect(FN_ENDPUNKTE.length).toBe(16)
  })

  test('die Migration 0160 führt dieselbe Liste wie das Register', () => {
    const sql = readFileSync(new URL('../../migrations/0160_fn_zugang_token.sql', import.meta.url), 'utf8')
    const block = sql.match(/WITH eintrag\(endpunkt, folge\) AS \(\s*VALUES([^)]*\)[^;]*?)\n\),/)?.[1] ?? ''
    const inSql = [...block.matchAll(/'(fn:[a-z_]+)'/g)].map(m => m[1]).sort()
    expect(inSql).toEqual([...FN_TOKEN_ENDPUNKTE].sort())
  })

  test('Token-Pfad: Rezeptliste über recipe-viewer, alle anderen wie der Sitzungspfad', () => {
    expect(fnTokenPfad(fnEndpunkt('fn:rezepte'), { seite: '7' })).toBe('/api/recipe-viewer/recipes?page=7')
    expect(fnEndpunkt('fn:rezepte').pfad({ seite: '7' }, null)).toBe('/api/recipes?page=7')
    for (const k of FN_TOKEN_ENDPUNKTE.filter(k => k !== 'fn:rezepte')) {
      expect(fnTokenPfad(fnEndpunkt(k), PARAMETER[k]!)).toBe(fnEndpunkt(k).pfad(PARAMETER[k]!, null))
    }
    expect(() => fnTokenPfad(fnEndpunkt('fn:bestellpositionen'), PARAMETER['fn:bestellpositionen']!)).toThrow()
  })
})

describe('Token-Weg', () => {
  test('je Registereintrag: ein Aufruf über das Token, keine Anmeldung, zugang token', async () => {
    const t = aufbau()
    for (const k of FN_TOKEN_ENDPUNKTE) {
      const r = await holen(t.client, k)
      expect(r.art).toBe('ok')
      expect(r.zugangInfo).toEqual({ zugang: 'token', bevorzugt: 'token', rueckfall: null, rueckfallGrund: null })
    }
    expect(t.aufrufe.length).toBe(6)
    expect(t.aufrufe.every(a => a.weg === 'token' && a.auth === `Bearer ${TOKEN}`)).toBe(true)
    expect(t.aufrufe.find(a => a.pfad.startsWith('/api/recipe-viewer/recipes?page=3'))).toBeDefined()
    expect(t.anmeldungen).toBe(0)
    // Der Tokenwert steht nie im Pfad.
    expect(t.aufrufe.some(a => a.url.includes(TOKEN))).toBe(false)
    expect(t.client.budgetVerbraucht).toBe(6)
  })

  test('ein Sitzungseintrag fragt nie mit Token, auch wenn eins da ist', async () => {
    const t = aufbau()
    const r = await holen(t.client, 'fn:bestellpositionen')
    expect(r.zugangInfo).toEqual({ zugang: 'sitzung', bevorzugt: 'sitzung', rueckfall: null, rueckfallGrund: null })
    expect(t.aufrufe.map(a => a.weg)).toEqual(['sitzung'])
    expect(t.aufrufe[0]!.auth).toBeNull()
  })
})

describe('Rückfall auf die Sitzung', () => {
  test('(a) kein Token für die Marke: gleich über die Sitzung, sichtbar als kein_token', async () => {
    const t = aufbau({ tokens: { aposto: 'tok_andere_marke_123456' } })
    const r = await holen(t.client, 'fn:pos_artikel')
    expect(r.art).toBe('ok')
    expect(r.zugangInfo.zugang).toBe('sitzung')
    expect(r.zugangInfo.bevorzugt).toBe('token')
    expect(r.zugangInfo.rueckfall).toBe('kein_token')
    expect(r.zugangInfo.rueckfallGrund).toContain('FN_API_TOKENS')
    expect(t.aufrufe.map(a => a.weg)).toEqual(['sitzung'])
  })

  test('(b) 403 scope-limited an drei verschiedenen Ressourcen in Folge: danach für Marke UND Eintrag kein Token mehr', async () => {
    const t = aufbau({ token: p => (p.includes('/articles') ? SCOPE : undefined) })
    const anbindung = (id: string) => holen(t.client, 'fn:pos_artikel', 'wilma_wunder', { connectionId: id })
    // Dieselbe Ressource wiederholt sagt nichts Neues über den Eintrag (26.11.2026).
    for (let i = 0; i < 3; i++) {
      const r = await anbindung('2052')
      expect(r.art).toBe('ok')
      expect(r.zugangInfo).toMatchObject({ zugang: 'sitzung', rueckfall: 'ressource' })
      expect(r.zugangInfo.rueckfallGrund).toContain('HTTP 403')
      expect(r.zugangInfo.rueckfallGrund).toContain('scope-limited')
    }
    expect((await anbindung('2053')).zugangInfo.rueckfall).toBe('ressource')
    // Die dritte VERSCHIEDENE ohne Token-Erfolg dazwischen: der Eintrag ist es, nicht die Ressource.
    const r3 = await anbindung('2054')
    expect(r3.zugangInfo).toMatchObject({ zugang: 'sitzung', rueckfall: 'abgewiesen' })
    expect(r3.zugangInfo.rueckfallGrund).toContain('3 Ressourcen in Folge')
    for (let i = 0; i < 5; i++) {
      const r = await anbindung(String(3000 + i))
      expect(r.zugangInfo).toMatchObject({ zugang: 'sitzung', rueckfall: 'abgewiesen' })
      expect(r.zugangInfo.rueckfallGrund).toContain('schon abgewiesen')
    }
    expect(t.aufrufe.filter(a => a.weg === 'token').length).toBe(5)
    expect(t.aufrufe.filter(a => a.weg === 'sitzung').length).toBe(10)
    // Ein anderer Eintrag derselben Marke fragt weiter mit Token.
    const w = await holen(t.client, 'fn:warenstamm')
    expect(w.zugangInfo.zugang).toBe('token')
  })

  test('(b) 500 NonUniqueResultException an einer Kostenstelle: Ressource, kein Ausfall — die Marke bleibt beim Token (26.11.2026)', async () => {
    // Lauf 214: 10262 scheiterte so dreimal hintereinander, und als 'ausfall'
    // schaltete das die ganze Marke auf die Sitzung, Rezepte eingeschlossen.
    const KAPUTT = { status: 500, body: { message: 'NonUniqueResultException: More than one result was found for query although one row or none was expected.' } }
    const t = aufbau({ token: p => (p.includes('10262') ? KAPUTT : undefined),
                       sitzung: p => (p.includes('10262') ? KAPUTT : undefined) })
    for (let i = 0; i < FN_TOKEN_AUSFAELLE_BIS_SITZUNG + 2; i++) {
      const r = await holen(t.client, 'fn:warenstamm', 'wilma_wunder', { erpId: '10262', seite: '1' })
      expect(r.art).toBe('fehler')
      expect(r.zugangInfo).toMatchObject({ zugang: 'sitzung', rueckfall: 'ressource' })
    }
    // Weder der Eintrag noch die Marke sind gesperrt.
    expect((await holen(t.client, 'fn:warenstamm', 'wilma_wunder', { erpId: '7984', seite: '1' })).zugangInfo)
      .toMatchObject({ zugang: 'token', rueckfall: null })
    expect((await holen(t.client, 'fn:rezept')).zugangInfo).toMatchObject({ zugang: 'token', rueckfall: null })
  })

  test('(b) eine einzelne 403 scope-limited zwischen Erfolgen gilt der Ressource — das Token bleibt (0164)', async () => {
    // Gemessen 23.–25.11.2026: Kostenstellen ohne Warenwirtschaft antworten dem
    // Token beim Warenstamm so, alle anderen liefern. Vorher kippte die erste
    // davon den Warenstamm der ganzen Marke auf die Sitzung.
    const t = aufbau({ token: p => (p.includes('10272') ? SCOPE : undefined) })
    for (let i = 0; i < 4; i++) {
      const gut = await holen(t.client, 'fn:warenstamm', 'wilma_wunder', { erpId: '7984', seite: '1' })
      expect(gut.zugangInfo).toMatchObject({ zugang: 'token', rueckfall: null })
      const tot = await holen(t.client, 'fn:warenstamm', 'wilma_wunder', { erpId: '10272', seite: '1' })
      expect(tot.zugangInfo).toMatchObject({ zugang: 'sitzung', rueckfall: 'ressource' })
    }
    expect(t.aufrufe.filter(a => a.weg === 'token').length).toBe(8)
  })

  test('(b) 401 ebenso — und eine andere Marke ist nicht betroffen', async () => {
    const t = aufbau({ tokens: { wilma_wunder: TOKEN, aposto: 'tok_aposto_abcdef123' },
      token: (_p, n) => (n === 1 ? { status: 401, body: { message: 'Invalid JWT Token' } } : undefined) })
    const r = await holen(t.client, 'fn:rezept')
    expect(r.zugangInfo).toMatchObject({ zugang: 'sitzung', rueckfall: 'abgewiesen' })
    expect((await holen(t.client, 'fn:rezept', 'aposto')).zugangInfo.zugang).toBe('token')
  })

  test('(c) Ausfall — 5xx, 429, Zeitgrenze, Netz, kein JSON, Hüllenfehler, fremde Form: einmal über die Sitzung', async () => {
    const faelle: Antwort[] = [
      { status: 502, body: { message: 'Bad Gateway' } },
      { status: 429, body: { message: 'Too Many Requests' } },
      { wirf: 'timeout' },
      { wirf: 'netz' },
      { status: 200, text: '<html>Wartung</html>' },
      { status: 200, body: { isError: true, errors: ['kaputt'], payload: null } },
      { status: 200, body: { ganzAnders: true } },
    ]
    for (const f of faelle) {
      const t = aufbau({ token: () => f })
      const r = await holen(t.client, 'fn:pos_artikel')
      expect(r.art).toBe('ok')
      expect(r.zugangInfo).toMatchObject({ zugang: 'sitzung', bevorzugt: 'token', rueckfall: 'ausfall' })
      expect(t.aufrufe.map(a => a.weg)).toEqual(['token', 'sitzung'])
      expect(r.zugangInfo.rueckfallGrund).not.toContain(TOKEN)
      // Beide Aufrufe zählen gegen das Budget (ein Takt, ein Budget — Regel 3).
      expect(t.client.budgetVerbraucht).toBe(2)
    }
  })

  test('(c) ein 404 mit Validierungstext ist ein Ausfall, kein gelöschtes Rezept', async () => {
    const t = aufbau({ token: () => ({ status: 404, body: { statusCode: 404, title: 'Not Found', message: 'Dieser Wert sollte nicht leer sein.' } }) })
    const r = await holen(t.client, 'fn:rezept')
    expect(r.zugangInfo).toMatchObject({ zugang: 'sitzung', rueckfall: 'ausfall' })
    expect(r.art).toBe('ok')
  })

  test(`(c) nach ${FN_TOKEN_AUSFAELLE_BIS_SITZUNG} Ausfällen in Folge läuft die Marke über die Sitzung; ein Erfolg setzt zurück`, async () => {
    // Erst ein Ausfall, dann ein Erfolg (setzt zurück), dann Ausfälle bis zur Schwelle.
    const t = aufbau({ token: (_p, n) => (n === 2 ? undefined : { status: 503, body: {} }) })
    expect((await holen(t.client, 'fn:rezept')).zugangInfo.rueckfall).toBe('ausfall')
    expect((await holen(t.client, 'fn:rezept')).zugangInfo.zugang).toBe('token')
    for (let i = 0; i < FN_TOKEN_AUSFAELLE_BIS_SITZUNG; i++) {
      expect((await holen(t.client, i % 2 ? 'fn:rezept_meta' : 'fn:warenstamm')).zugangInfo.rueckfall).toBe('ausfall')
    }
    const vorher = t.aufrufe.filter(a => a.weg === 'token').length
    const r = await holen(t.client, 'fn:rezept_zutaten')
    expect(r.zugangInfo).toMatchObject({ zugang: 'sitzung', rueckfall: 'ausfall' })
    expect(r.zugangInfo.rueckfallGrund).toContain(`${FN_TOKEN_AUSFAELLE_BIS_SITZUNG} Ausfälle in Folge`)
    expect(t.aufrufe.filter(a => a.weg === 'token').length).toBe(vorher)
    // Ein neuer Client (der nächste Lauf) versucht das Token wieder.
    const neu = aufbau()
    expect((await holen(neu.client, 'fn:rezept_zutaten')).zugangInfo.zugang).toBe('token')
  })

  test('fachlicher 404 (ohne Validierungs-/Routentext): KEIN Rückfall, eine Antwort über das Token', async () => {
    const t = aufbau({ token: () => ({ status: 404, body: { message: 'not found' } }) })
    const r = await holen(t.client, 'fn:rezept')
    expect(r.art).toBe('fehler')
    expect(r.zugangInfo).toEqual({ zugang: 'token', bevorzugt: 'token', rueckfall: null, rueckfallGrund: null })
    expect(t.aufrufe.map(a => a.weg)).toEqual(['token'])
    // Der Worker verbucht ihn wie auf dem Sitzungsweg als „nicht gefunden".
    expect(alsNichtGefundenVerbuchen('fn:rezept', r as { status: number | null })).toBe(true)
  })

  test('scheitert auch die Sitzung, kommt deren Fehler zurück — mit dem Rückfallgrund daneben', async () => {
    const t = aufbau({ token: () => ({ status: 500, body: {} }), sitzung: () => ({ status: 500, body: { message: 'kaputt' } }) })
    const r = await holen(t.client, 'fn:warenstamm')
    expect(r.art).toBe('fehler')
    if (r.art === 'fehler') { expect(r.status).toBe(500); expect(r.wiederholbar).toBe(true) }
    expect(r.zugangInfo).toMatchObject({ zugang: 'sitzung', rueckfall: 'ausfall' })
    expect(r.zugangInfo.rueckfallGrund).toContain('HTTP 500')
  })
})

describe('Der Tokenwert erscheint nirgends', () => {
  test('ein Server, der den Header echot: weder Rückfallgrund noch Fehlertext tragen das Token', async () => {
    const t = aufbau({ token: () => SCOPE })
    const r = await holen(t.client, 'fn:rezept_meta')
    expect(JSON.stringify(r)).not.toContain(TOKEN)
    expect(r.zugangInfo.rueckfallGrund).toContain('<token>')
    const n = aufbau({ token: () => ({ wirf: 'netz' }) })
    expect(JSON.stringify(await holen(n.client, 'fn:rezept_meta'))).not.toContain(TOKEN)
  })

  test('ohneToken ersetzt jedes Vorkommen, kurze Werte zählen nicht', () => {
    expect(ohneToken(`a ${TOKEN} b ${TOKEN}`, [TOKEN])).toBe('a <token> b <token>')
    expect(ohneToken('abc', ['ab'])).toBe('abc')
  })

  test('Sitzungsbasis und Tokenbasis getrennt: kein Bearer an die Sitzung', async () => {
    const t = aufbau({ token: () => SCOPE })
    await holen(t.client, 'fn:pos_artikel')
    for (const a of t.aufrufe) {
      if (a.weg === 'sitzung') { expect(a.auth).toBeNull(); expect(SITZUNG_BASIS_MUSTER.test(a.url)).toBe(true) }
      else expect(a.url.startsWith(TOKEN_BASIS)).toBe(true)
    }
  })
})
