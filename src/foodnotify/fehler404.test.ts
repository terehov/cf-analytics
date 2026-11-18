/**
 * HTTP 404 von FoodNotify: echtes „gibt es nicht" gegen Validierungs-404
 * (18.11.2026, docs/foodnotify-interna-aus-fehlermeldungen.md §4).
 *
 * Gegen die Attrappe, ohne Datenbank: FnClient.holen() fasst die Datenbank nur
 * in budgetLaden() an, und das ruft dieser Test nicht. Den Worker-Pfad bis
 * core.rezept.fehlt_seit prüft rezept_db.test.ts (nur mit TEST_DATABASE_URL).
 *
 * `config` kann von einer früheren Testdatei mit der .env geladen sein — wie in
 * src/rezepte_probe.test.ts wird DAS Objekt auf die Attrappe umgestellt und
 * danach zurückgesetzt, und vor jedem Abruf geprüft, dass es auf die Attrappe
 * zeigt. Nie gegen das echte FoodNotify.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { fnMockStarten } from './mock'

const MARKEN = ['APOSTO', 'ENCHILADA', 'DEUTSCHE_KONZEPTE', 'WILMA_WUNDER']

describe('FoodNotify 404: Datensatz fehlt oder Anfrage falsch', () => {
  let mock: ReturnType<typeof fnMockStarten>
  let cfg: any
  const alt: Record<string, unknown> = {}

  beforeAll(async () => {
    mock = fnMockStarten()
    const { config } = await import('../config')
    cfg = config
    for (const k of ['FN_BASE_URL', 'FN_TAKT_MIN_MS', 'FN_TAKT_MAX_MS', 'FN_TAGESBUDGET',
                     ...MARKEN.flatMap(m => [`FN_${m}_USER`, `FN_${m}_PASSWORD`])]) {
      alt[k] = cfg[k]
      cfg[k] = undefined
    }
    cfg.FN_BASE_URL = mock.url
    cfg.FN_TAKT_MIN_MS = 0
    cfg.FN_TAKT_MAX_MS = 0
    cfg.FN_TAGESBUDGET = 1000
    cfg.FN_ENCHILADA_USER = 'test@aposto.eu'
    cfg.FN_ENCHILADA_PASSWORD = 'geheim'
  })

  afterAll(() => {
    for (const [k, v] of Object.entries(alt)) cfg[k] = v
    mock?.stop()
  })

  const holen = async (key: string, parameter: Record<string, string>) => {
    expect(cfg.FN_BASE_URL).toBe(mock.url)   // Notbremse: nie gegen das echte FoodNotify
    const { FnClient } = await import('./client')
    const { fnEndpunkt } = await import('./endpunkte')
    return new FnClient().holen(fnEndpunkt(key), 'enchilada', parameter)
  }

  test('echtes 404 (unbekanntes Rezept): Text mitgelesen, kein Anfragefehler, wird nicht_gefunden', async () => {
    const { alsNichtGefundenVerbuchen } = await import('./endpunkte')
    const res = await holen('fn:rezept_zutaten', { rezeptId: '999998' })
    expect(res.art).toBe('fehler')
    if (res.art !== 'fehler') return
    expect(res.status).toBe(404)
    expect(res.fehler).toBe('HTTP 404 — not found')
    expect(res.anfrageFehler).toBeUndefined()
    expect(res.wiederholbar).toBe(false)
    expect(alsNichtGefundenVerbuchen('fn:rezept_zutaten', res)).toBe(true)
  })

  test('Validierungs-404 auf ein vorhandenes Rezept: Fehler der Anfrage, NICHT nicht_gefunden', async () => {
    const { alsNichtGefundenVerbuchen } = await import('./endpunkte')
    mock.validierungsfehler('/api/recipes/1032008/ingredients')
    try {
      const res = await holen('fn:rezept_zutaten', { rezeptId: '1032008' })
      expect(res.art).toBe('fehler')
      if (res.art !== 'fehler') return
      expect(res.status).toBe(404)
      expect(res.anfrageFehler).toBe('validierung')
      // Der Text landet über den Worker in letzter_fehler und mart.posten_aufgegeben.
      expect(res.fehler).toStartWith('HTTP 404 (Validierung')
      expect(res.fehler).toContain('Dieser Wert sollte nicht leer sein.')
      expect(res.wiederholbar).toBe(false)
      expect(alsNichtGefundenVerbuchen('fn:rezept_zutaten', res)).toBe(false)
    } finally {
      mock.validierungsfehler('/api/recipes/1032008/ingredients', false)
    }
    // Zurückgenommen: dasselbe Rezept kommt wieder.
    const ok = await holen('fn:rezept_zutaten', { rezeptId: '1032008' })
    expect(ok.art).toBe('ok')
  })

  test('HTTP 500 mit leerem Fehlerkörper bleibt genau „HTTP 500" (nachfuellen.ts sucht LIKE \'HTTP 500%\')', async () => {
    mock.kaputtMachen('/api/10483/shop-order/b1/change')
    try {
      const res = await holen('fn:bestellpositionen', { erpId: '10483', orderId: 'b1' })
      expect(res.art).toBe('fehler')
      if (res.art !== 'fehler') return
      expect(res.fehler).toBe('HTTP 500')
      expect(res.wiederholbar).toBe(true)
      expect(res.anfrageFehler).toBeUndefined()
    } finally {
      mock.reparieren('/api/10483/shop-order/b1/change')
    }
  })

  test('Hüllenfehler „object not found" mit HTTP 200 wird nicht zu nicht_gefunden', async () => {
    const { alsNichtGefundenVerbuchen } = await import('./endpunkte')
    const res = await holen('fn:bestellungen', { erpId: '999', seite: '1' })
    expect(res.art).toBe('fehler')
    if (res.art !== 'fehler') return
    expect(res.status).toBe(200)
    expect(res.fehler).toContain('object not found')
    expect(alsNichtGefundenVerbuchen('fn:bestellungen', res)).toBe(false)
  })
})
