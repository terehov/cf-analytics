/**
 * Kassenartikel → Rezept (0155) gegen eine echte Datenbank und die
 * FoodNotify-Attrappe: Nachfüllen → Worker → raw → core → mart, der Schalter
 * je Marke, „fehlt seit", Abbruch ≠ leer, Formfehler und Zulauf (Regel 10).
 *
 * Übersprungen ohne TEST_DATABASE_URL. Die Datei macht TRUNCATE über
 * Warteschlange und raw, leert core.pos_artikel und nimmt allen übrigen
 * Kostenstellen die connection_id — sie braucht eine EIGENE Testdatenbank
 * (Klon, siehe docs/offene-punkte.md), nie die, auf die DATABASE_URL zeigt.
 * Immer die ganze Datei laufen lassen, nie mit -t (die Notbremse sitzt im
 * ersten beforeAll).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from 'pg'
import { mockStarten } from '../lina/mock'
import { fnMockStarten } from './mock'

const DB = process.env.TEST_DATABASE_URL

if (DB && process.env.DATABASE_URL && DB === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL zeigt auf dieselbe Datenbank wie DATABASE_URL — '
    + 'diese Datei macht TRUNCATE. Eine eigene Testdatenbank anlegen.')
}

const lauf = DB ? describe : describe.skip
const PFAD = '/api/pos/mapping/1907/articles'
const TEST_KS = [990101, 990201]

lauf('Kassenartikel mit Datenbank', () => {
  let db: Client
  let lina: ReturnType<typeof mockStarten>
  let fn: ReturnType<typeof fnMockStarten>
  let wilma: number
  let aposto: number
  let ksWilma: number

  /** Den Posten für heute neu einreihen — der Einreihweg sperrt sonst gegen den Tag. */
  const neuEinreihen = async () => {
    await db.query(`DELETE FROM sync.warteschlange WHERE endpunkt = 'fn:pos_artikel'`)
    const { posArtikelNachfuellen } = await import('../sync/nachfuellen')
    return posArtikelNachfuellen()
  }
  const lauf = async () => {
    const { workerLauf } = await import('../sync/worker')
    return workerLauf('manuell')
  }
  const bestand = async () => (await db.query(
    `SELECT remote_id::int AS id, fehlt_seit IS NOT NULL AS fehlt, zuletzt_gesehen_am, geaendert_am
       FROM core.pos_artikel WHERE kostenstelle_key = $1 ORDER BY remote_id`, [ksWilma])).rows

  beforeAll(async () => {
    lina = mockStarten({})
    fn = fnMockStarten()
    process.env.LINA_BASE_URL = lina.url
    process.env.LINA_USER = 'testuser'
    process.env.LINA_PASSWORD = 'geheim'
    process.env.DATABASE_URL = DB!
    process.env.TAKT_MIN_MS = '0'
    process.env.TAKT_MAX_MS = '0'
    process.env.FN_TAKT_MIN_MS = '0'
    process.env.FN_TAKT_MAX_MS = '0'
    process.env.FN_BASE_URL = fn.url
    // Token-Weg (0160) aus: Bun lädt die .env auch hier, mit den echten Tokens. Ohne
    // Token läuft alles über die Sitzung (Rückfall kein_token) — wie vor 0160.
    delete process.env.FN_API_TOKENS
    delete process.env.FN_TOKEN_BASE_URL
    // Kurze Zeitgrenzen, damit der Abbruch im Test Sekunden statt Minuten dauert:
    // gewöhnliche Pfade 1 s, der lange Pfad 1,5 s.
    process.env.ANFRAGE_TIMEOUT_MS = '1000'
    process.env.FN_ZEITGRENZE_LANG_MS = '1500'
    delete process.env.POS_ARTIKEL_MARKEN   // die Vorgabe: nur wilma_wunder
    // Wilma Wunder UND Aposto mit Attrappen-Zugang: Aposto hat Zugangsdaten und
    // eine Anbindung, steht aber nicht im Schalter — der Test des Schalters.
    for (const m of ['APOSTO', 'ENCHILADA', 'DEUTSCHE_KONZEPTE', 'WILMA_WUNDER']) {
      delete process.env[`FN_${m}_USER`]
      delete process.env[`FN_${m}_PASSWORD`]
    }
    process.env.FN_WILMA_WUNDER_USER = 'test@aposto.eu'
    process.env.FN_WILMA_WUNDER_PASSWORD = 'geheim'
    process.env.FN_APOSTO_USER = 'test@aposto.eu'
    process.env.FN_APOSTO_PASSWORD = 'geheim'
    process.env.LOG_LEVEL ??= 'error'
    const { config } = await import('../config')
    if (config.DATABASE_URL !== DB || config.FN_BASE_URL !== fn.url || config.FN_ZEITGRENZE_LANG_MS !== 1500) {
      throw new Error('config wurde vorher mit einer anderen Umgebung geladen — '
        + 'diese Datei einzeln starten: bun test src/foodnotify/pos_artikel_db.test.ts')
    }
    db = new Client({ connectionString: DB })
    await db.connect()
    await db.query(`DELETE FROM sync.zugangssperre`)
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf, sync.schema_abweichung,
                       raw.api_antwort RESTART IDENTITY CASCADE`)
    await db.query(`DELETE FROM core.pos_artikel_abruf`)
    await db.query(`DELETE FROM core.pos_artikel`)
    await db.query(`DELETE FROM core.kostenstelle WHERE kostenstelle_id = ANY($1::int[])`, [TEST_KS])
    // Nur die Test-Anbindungen sollen eingereiht werden.
    await db.query(`UPDATE core.kostenstelle SET connection_id = NULL WHERE connection_id IS NOT NULL`)
    const marke = async (s: string) => Number((await db.query(
      `SELECT marke_key FROM core.marke WHERE schluessel = $1`, [s])).rows[0].marke_key)
    wilma = await marke('wilma_wunder')
    aposto = await marke('aposto')
    const { rows: [k] } = await db.query(
      `INSERT INTO core.kostenstelle (marke_key, kostenstelle_id, restaurant_id, erp_id, name, restaurant_name,
                                      art, connection_id, kassensystem)
       VALUES ($1, 990101, 990100, 990102, 'Küche Test', 'Testbetrieb', 'kueche', 1907, 'amadeus')
       RETURNING kostenstelle_key`, [wilma])
    ksWilma = Number(k.kostenstelle_key)
    await db.query(
      `INSERT INTO core.kostenstelle (marke_key, kostenstelle_id, restaurant_id, erp_id, name, restaurant_name,
                                      art, connection_id, kassensystem)
       VALUES ($1, 990201, 990200, 990202, 'Küche Test Aposto', 'Testbetrieb Aposto', 'kueche', 1907, 'amadeus')`,
      [aposto])
    // Die Abdeckungssicht liest mart.artikel_monat_basis; auf einem Schema-Klon ist sie leer.
    const { rows: [mv] } = await db.query(
      `SELECT ispopulated FROM pg_matviews WHERE schemaname = 'mart' AND matviewname = 'artikel_monat_basis'`)
    if (mv && !mv.ispopulated) await db.query(`REFRESH MATERIALIZED VIEW mart.artikel_monat_basis`)
  })

  afterAll(async () => {
    lina?.stop(); fn?.stop()
    if (db) {
      await db.query(`DELETE FROM core.pos_artikel_abruf WHERE kostenstelle_key IN
                        (SELECT kostenstelle_key FROM core.kostenstelle WHERE kostenstelle_id = ANY($1::int[]))`, [TEST_KS])
      await db.query(`DELETE FROM core.pos_artikel WHERE kostenstelle_key IN
                        (SELECT kostenstelle_key FROM core.kostenstelle WHERE kostenstelle_id = ANY($1::int[]))`, [TEST_KS])
      await db.query(`DELETE FROM core.kostenstelle WHERE kostenstelle_id = ANY($1::int[])`, [TEST_KS])
      await db.end()
    }
  })

  test('Nachfüllen: nur die Marken aus POS_ARTIKEL_MARKEN, ein Posten je Anbindung und Tag', async () => {
    const { posArtikelNachfuellen } = await import('../sync/nachfuellen')
    expect(await posArtikelNachfuellen()).toBe(1)
    expect(await posArtikelNachfuellen()).toBe(0)   // derselbe Tag: gesperrt
    const { rows } = await db.query(
      `SELECT marke_key, parameter, nachladen, prioritaet FROM sync.warteschlange WHERE endpunkt = 'fn:pos_artikel'`)
    expect(rows).toEqual([{ marke_key: wilma, parameter: { connectionId: '1907' }, nachladen: false, prioritaet: 30 }])
    // Aposto hat Zugangsdaten und eine Anbindung, steht aber nicht im Schalter.
    const { rows: [m] } = await db.query(`SELECT wert FROM sync.merker WHERE schluessel = 'pos_artikel_marken'`)
    expect(m.wert).toEqual({ marken: ['wilma_wunder'] })
  })

  test('Worker: raw, core, Abruf und die Sichten', async () => {
    const r = await lauf()
    expect(r.status).toBe('ok')

    const { rows: [raw] } = await db.query(
      `SELECT count(*)::int AS n, min(parameter->>'connectionId') AS conn, min((parameter->>'markeKey')::int) AS marke
         FROM raw.api_antwort WHERE endpunkt = 'fn:pos_artikel'`)
    expect(raw).toEqual({ n: 1, conn: '1907', marke: wilma })

    const { rows } = await db.query(
      `SELECT remote_id::int AS id, plu, plu_zahl::int AS plu_zahl, rezept_fn_id, ist_ignoriert,
              abwesend_seit IS NOT NULL AS abwesend, name_weicht_ab, name_doppelt, preis::float AS preis,
              mwst::float AS mwst, fehlt_seit, raw_id IS NOT NULL AS mit_raw
         FROM core.pos_artikel WHERE kostenstelle_key = $1 ORDER BY remote_id`, [ksWilma])
    expect(rows).toHaveLength(5)
    expect(rows[0]).toEqual({ id: 900001, plu: '1100001', plu_zahl: 1100001, rezept_fn_id: 1032008,
      ist_ignoriert: false, abwesend: false, name_weicht_ab: false, name_doppelt: false, preis: 12.5,
      mwst: 19, fehlt_seit: null, mit_raw: true })
    expect(rows.map(z => z.ist_ignoriert)).toEqual([false, false, true, false, false])
    expect(rows.map(z => z.abwesend)).toEqual([false, false, false, true, false])
    expect(rows.map(z => z.name_weicht_ab)).toEqual([false, false, false, false, true])

    const { rows: [ab] } = await db.query(
      `SELECT connection_id, artikel, ingest_hinweise, standort, restaurant_id, kann_rezepte_anlegen
         FROM core.pos_artikel_abruf WHERE kostenstelle_key = $1`, [ksWilma])
    expect(ab).toEqual({ connection_id: 1907, artikel: 5, ingest_hinweise: 1,
      standort: 'Testbetrieb Gera — Küche Test', restaurant_id: 10436, kann_rezepte_anlegen: true })

    // Zeilenebene: hat_rezept zählt den ignorierten Artikel nicht.
    const { rows: zr } = await db.query(
      `SELECT remote_id::int AS id, hat_rezept, marke FROM mart.pos_artikel_rezept
        WHERE connection_id = 1907 ORDER BY remote_id`)
    expect(zr.map(z => z.hat_rezept)).toEqual([true, false, false, false, true])
    expect(new Set(zr.map(z => z.marke))).toEqual(new Set(['wilma_wunder']))

    // Je Anbindung: die Test-Kostenstelle hat keinen Betrieb, Aposto ist abgeschaltet.
    const { rows: abd } = await db.query(
      `SELECT marke, zustand, artikel_gesamt, artikel_mit_rezept, rezept_anteil_pct::float AS pct,
              artikel_ignoriert, artikel_abwesend, name_weicht_ab, nicht_mehr_geliefert, umsatz_betrieb_3m
         FROM mart.pos_artikel_abdeckung WHERE connection_id = 1907 ORDER BY marke`)
    expect(abd).toEqual([
      { marke: 'aposto', zustand: 'marke nicht aktiv', artikel_gesamt: 0, artikel_mit_rezept: 0, pct: null,
        artikel_ignoriert: 0, artikel_abwesend: 0, name_weicht_ab: 0, nicht_mehr_geliefert: 0, umsatz_betrieb_3m: null },
      { marke: 'wilma_wunder', zustand: 'ohne betrieb', artikel_gesamt: 5, artikel_mit_rezept: 2, pct: 40,
        artikel_ignoriert: 1, artikel_abwesend: 1, name_weicht_ab: 1, nicht_mehr_geliefert: 0, umsatz_betrieb_3m: null },
    ])

    const { rows: [pz] } = await db.query(
      `SELECT geprueft::int, auffaellig::int FROM mart.pruefung_uebersicht WHERE sicht = 'mart.pos_artikel_abdeckung'`)
    expect(pz).toEqual({ geprueft: 1, auffaellig: 0 })
  })

  test('Regel 10: beide Registereinträge erwartet und mit Zulauf', async () => {
    const { quellenSpiegeln } = await import('../sync/quellen')
    await quellenSpiegeln()
    const { rows } = await db.query(
      `SELECT quelle, erwartet, zustand FROM mart.quelle_zulauf
        WHERE quelle IN ('fn:pos_artikel', 'core:pos_artikel') ORDER BY quelle`)
    expect(rows).toEqual([
      { quelle: 'core:pos_artikel', erwartet: true, zustand: 'ok' },
      { quelle: 'fn:pos_artikel', erwartet: true, zustand: 'ok' },
    ])
  })

  test('fehlt seit: nicht gelöscht, und wieder da, wenn er zurückkommt', async () => {
    const vorher = await bestand()
    fn.posArtikelOhne([900002])
    await neuEinreihen()
    expect((await lauf()).status).toBe('ok')
    const mitte = await bestand()
    expect(mitte).toHaveLength(5)
    expect(mitte.map(z => z.fehlt)).toEqual([false, true, false, false, false])
    // Die übrigen rücken nach, der fehlende nicht.
    expect(mitte[0]!.zuletzt_gesehen_am.getTime()).toBeGreaterThan(vorher[0]!.zuletzt_gesehen_am.getTime())
    expect(mitte[1]!.zuletzt_gesehen_am.getTime()).toBe(vorher[1]!.zuletzt_gesehen_am.getTime())
    expect(mitte[1]!.geaendert_am.getTime()).toBeGreaterThan(vorher[1]!.geaendert_am.getTime())
    // Unveränderte Artikel behalten ihr geaendert_am.
    expect(mitte[0]!.geaendert_am.getTime()).toBe(vorher[0]!.geaendert_am.getTime())
    const { rows: [abd] } = await db.query(
      `SELECT artikel_gesamt, nicht_mehr_geliefert FROM mart.pos_artikel_abdeckung
        WHERE connection_id = 1907 AND marke = 'wilma_wunder'`)
    expect(abd).toEqual({ artikel_gesamt: 4, nicht_mehr_geliefert: 1 })

    fn.posArtikelOhne([])
    await neuEinreihen()
    expect((await lauf()).status).toBe('ok')
    expect((await bestand()).map(z => z.fehlt)).toEqual([false, false, false, false, false])
  })

  test('Abbruch ist nie „keine Artikel": Zeitgrenze und HTTP 500 ändern nichts', async () => {
    const vorher = await bestand()
    const { rows: [abVorher] } = await db.query(
      `SELECT abgerufen_am FROM core.pos_artikel_abruf WHERE kostenstelle_key = $1`, [ksWilma])
    const rawVorher = Number((await db.query(
      `SELECT count(*) AS n FROM raw.api_antwort WHERE endpunkt = 'fn:pos_artikel'`)).rows[0].n)

    // 3 s Antwortzeit gegen 1,5 s Zeitgrenze des langen Pfads.
    fn.verzoegern(PFAD, 3000)
    await neuEinreihen()
    await lauf()
    const { rows: [w] } = await db.query(
      `SELECT erledigt_am, letzter_fehler FROM sync.warteschlange WHERE endpunkt = 'fn:pos_artikel'`)
    expect(w.erledigt_am).toBeNull()                 // Wiedervorlage, kein „erledigt, leer"
    expect(String(w.letzter_fehler)).toMatch(/time|abort/i)

    // HTTP 500 mit Fehlerkörper, wie im Original.
    fn.verzoegern(PFAD, 0)
    fn.kaputtMachen(PFAD)
    await neuEinreihen()
    await lauf()
    fn.reparieren(PFAD)
    const { rows: [w2] } = await db.query(
      `SELECT erledigt_am, letzter_fehler FROM sync.warteschlange WHERE endpunkt = 'fn:pos_artikel'`)
    expect(String(w2.letzter_fehler)).toContain('HTTP 500')

    expect(await bestand()).toEqual(vorher)
    const { rows: [abNachher] } = await db.query(
      `SELECT abgerufen_am FROM core.pos_artikel_abruf WHERE kostenstelle_key = $1`, [ksWilma])
    expect(abNachher.abgerufen_am.getTime()).toBe(abVorher.abgerufen_am.getTime())
    expect(Number((await db.query(
      `SELECT count(*) AS n FROM raw.api_antwort WHERE endpunkt = 'fn:pos_artikel'`)).rows[0].n)).toBe(rawVorher)

    // 1,2 s liegen über ANFRAGE_TIMEOUT_MS (1 s), aber unter der langen Grenze: das geht durch.
    fn.verzoegern(PFAD, 1200)
    await neuEinreihen()
    expect((await lauf()).status).toBe('ok')
    fn.verzoegern(PFAD, 0)
    const { rows: [abSpaeter] } = await db.query(
      `SELECT abgerufen_am FROM core.pos_artikel_abruf WHERE kostenstelle_key = $1`, [ksWilma])
    expect(abSpaeter.abgerufen_am.getTime()).toBeGreaterThan(abVorher.abgerufen_am.getTime())
  }, 30_000)

  test('fremde Form und leere Antwort: Rohantwort gesichert, Befund geschrieben, core unberührt', async () => {
    const vorher = (await bestand()).map(z => ({ id: z.id, fehlt: z.fehlt }))
    await db.query(`DELETE FROM sync.schema_abweichung`)

    fn.posArtikelForm('fremd')
    await neuEinreihen()
    await lauf()
    fn.posArtikelForm('leer')
    await neuEinreihen()
    await lauf()
    fn.posArtikelForm('echt')

    const { rows: abw } = await db.query(
      `SELECT tatsaechlich->'probleme'->0->>'problem' AS problem FROM sync.schema_abweichung
        WHERE endpunkt = 'fn:pos_artikel' ORDER BY 1`)
    expect(abw).toHaveLength(2)
    expect(abw.some(a => /recipeId/.test(a.problem))).toBe(true)
    expect(abw.some(a => /0 Artikel/.test(a.problem))).toBe(true)
    // Beide Antworten stehen in raw (Regel 4), core zeigt den alten Stand.
    const { rows: [raw] } = await db.query(
      `SELECT count(*)::int AS n FROM raw.api_antwort
        WHERE endpunkt = 'fn:pos_artikel' AND abgerufen_am > now() - interval '1 minute'`)
    expect(raw.n).toBeGreaterThanOrEqual(2)
    expect((await bestand()).map(z => ({ id: z.id, fehlt: z.fehlt }))).toEqual(vorher)
    const { rows: [w] } = await db.query(
      `SELECT erledigt_am, ergebnis FROM sync.warteschlange WHERE endpunkt = 'fn:pos_artikel'`)
    expect(w.ergebnis).not.toBe('ok')
  })
})
