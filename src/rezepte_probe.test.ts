/**
 * Rezept-Probe gegen die FoodNotify-Attrappe — nie gegen das echte FoodNotify.
 *
 * `config` kann von einer früheren Testdatei mit der .env geladen sein. Die
 * Probe liest Basisadresse und Zugänge zur Laufzeit aus dem config-Objekt;
 * deshalb wird DAS Objekt auf die Attrappe umgestellt (und zurückgesetzt), und
 * vor jedem Lauf geprüft, dass es wirklich auf die Attrappe zeigt.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fnMockStarten } from './foodnotify/mock'

const MARKEN = ['APOSTO', 'ENCHILADA', 'DEUTSCHE_KONZEPTE', 'WILMA_WUNDER']

describe('Rezept-Probe gegen die Attrappe', () => {
  let mock: ReturnType<typeof fnMockStarten>
  let cfg: any
  const alt: Record<string, unknown> = {}
  let aus: string

  beforeAll(async () => {
    mock = fnMockStarten()
    const { config } = await import('./config')
    cfg = config
    for (const k of ['FN_BASE_URL', 'FN_TAKT_MIN_MS', 'FN_TAKT_MAX_MS',
                     ...MARKEN.flatMap(m => [`FN_${m}_USER`, `FN_${m}_PASSWORD`])]) {
      alt[k] = cfg[k]
      cfg[k] = undefined
    }
    cfg.FN_BASE_URL = mock.url
    cfg.FN_TAKT_MIN_MS = 0
    cfg.FN_TAKT_MAX_MS = 0
    cfg.FN_ENCHILADA_USER = 'test@aposto.eu'
    cfg.FN_ENCHILADA_PASSWORD = 'geheim'
    // Wilma Wunder mit dem 2FA-Benutzer: die Anmeldung scheitert — genau einmal.
    cfg.FN_WILMA_WUNDER_USER = 'zfa@aposto.eu'
    cfg.FN_WILMA_WUNDER_PASSWORD = 'geheim'
    aus = mkdtempSync(join(tmpdir(), 'rezepte-probe-'))
  })

  afterAll(() => {
    for (const [k, v] of Object.entries(alt)) cfg[k] = v
    mock?.stop()
    rmSync(aus, { recursive: true, force: true })
  })

  const lauf = async (marken: string[], artikel?: string) => {
    expect(cfg.FN_BASE_URL).toBe(mock.url)   // Notbremse: nie gegen das echte FoodNotify
    const zeilen: string[] = []
    const { rezepteProbe } = await import('./rezepte_probe')
    const r = await rezepteProbe({ marken, artikel, aus, pauseMs: 0, ausgabe: z => zeilen.push(z) })
    return { ...r, text: zeilen.join('\n') }
  }

  test('grün: Form überall ok, Unterrezept über den Einzelkopf, 200004 gefunden, keine Vollsuche', async () => {
    const r = await lauf(['enchilada'], '200004')
    expect(r.exitCode).toBe(0)
    const [e] = r.ergebnisse
    expect(e).toMatchObject({
      marke: 'enchilada', anmeldung: 'ok', rezepteGesamt: 3, listenseiten: 2,
      form: { liste: 'ok', kopf: 'ok', zutaten: 'ok', meta: 'ok' },
      felder: { fehlend: [], neu: [] },
    })
    // Liste + A (Kopf, Zutaten, Meta) + B = Unterrezept 983835 (Kopf, Zutaten, Meta).
    expect(e!.aufrufe).toBe(7)
    expect(e!.geprueft.map(g => g.id)).toEqual([1032008, 983835])
    expect(e!.artikelGefunden).toEqual([{ rezept: 'Sweet & Sour Mix 20 L', menge: 20, einheit: 'LT' }])
    expect(r.text).toContain('KEINE vollständige Suche')
    expect(r.text).toContain('| enchilada | ok | 3 | 2 | ok | ok | ok | ok | wie gemessen | 7 |')
    // Rohantworten liegen im Verzeichnis, nicht in der Datenbank.
    expect(readdirSync(join(aus, 'enchilada')).length).toBe(7)
  })

  test('Anmeldung scheitert: genau ein Versuch, Marke übersprungen, Exit 2', async () => {
    const vorher = mock.anmeldungen
    const r = await lauf(['wilma_wunder'])
    expect(mock.anmeldungen - vorher).toBe(1)
    expect(r.ergebnisse[0]).toMatchObject({ anmeldung: 'gescheitert', aufrufe: 1 })
    expect(r.exitCode).toBe(2)
    expect(r.text).not.toContain('zfa@aposto.eu')
    expect(r.text).not.toContain('geheim')
  })

  test('Marke ohne Zugang wird gemeldet, nicht angefragt', async () => {
    const r = await lauf(['aposto'])
    expect(r.ergebnisse[0]).toMatchObject({ anmeldung: 'kein Zugang', aufrufe: 0 })
  })

  test('rot: fremde Hülle bei /ingredients — Form abweichend, Schlüssel gezeigt, Exit 1', async () => {
    mock.rezeptHuelleFremd(true)
    try {
      const r = await lauf(['enchilada'])
      expect(r.exitCode).toBe(1)
      expect(r.ergebnisse[0]!.form.zutaten).toBe('abweichend')
      expect(r.ergebnisse[0]!.form.liste).toBe('ok')
      expect(r.text).toContain('FORM WEICHT AB')
      expect(r.text).toContain('{ingredients}')
    } finally { mock.rezeptHuelleFremd(false) }
  })
})
