/**
 * Zwei Zugänge (0160) gegen eine echte Datenbank und die FoodNotify-Attrappe:
 * Kassenartikel über das Token, dann Abweisung, Ausfall, kein Token und ein
 * Abbruch auf beiden Wegen — jedes Mal, was in sync.aufgabe, raw.api_antwort,
 * mart.fn_zugang_stand und mart.pruefung_uebersicht steht, und dass der
 * Tokenwert dort nirgends auftaucht.
 *
 * Übersprungen ohne TEST_DATABASE_URL. Die Datei macht TRUNCATE über
 * Warteschlange, Protokoll und raw und leert core.pos_artikel — sie braucht
 * eine EIGENE Testdatenbank (Klon), nie die, auf die DATABASE_URL zeigt.
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
const TEST_KS = [990111]
const TOKEN = 'tok_DB_TEST_wilma_0123456789abcdef'

lauf('Token und Sitzung mit Datenbank', () => {
  let db: Client
  let lina: ReturnType<typeof mockStarten>
  let fn: ReturnType<typeof fnMockStarten>
  let ksWilma: number

  const einreihenUndLaufen = async () => {
    await db.query(`DELETE FROM sync.warteschlange WHERE endpunkt = 'fn:pos_artikel'`)
    const { posArtikelNachfuellen } = await import('../sync/nachfuellen')
    expect(await posArtikelNachfuellen()).toBe(1)
    const { workerLauf } = await import('../sync/worker')
    return workerLauf('manuell')
  }
  const letzteAufgabe = async () => (await db.query(
    `SELECT status, zugang, zugang_bevorzugt, zugang_rueckfall, zugang_rueckfall_grund
       FROM sync.aufgabe WHERE endpunkt = 'fn:pos_artikel' ORDER BY aufgabe_id DESC LIMIT 1`)).rows[0]
  const stand = async () => (await db.query(
    `SELECT befund, zugang_letzter_lauf, abrufe, ueber_token, ueber_sitzung, rueckfall_letzter_lauf
       FROM mart.fn_zugang_stand WHERE marke = 'wilma_wunder' AND endpunkt = 'fn:pos_artikel'`)).rows[0]
  const pruefzeile = async () => (await db.query(
    `SELECT geprueft::int, auffaellig::int FROM mart.pruefung_uebersicht WHERE sicht = 'mart.fn_zugang_stand'`)).rows[0]

  beforeAll(async () => {
    lina = mockStarten({})
    fn = fnMockStarten()
    fn.tokenGueltig(TOKEN)
    process.env.LINA_BASE_URL = lina.url
    process.env.LINA_USER = 'testuser'
    process.env.LINA_PASSWORD = 'geheim'
    process.env.DATABASE_URL = DB!
    process.env.TAKT_MIN_MS = '0'
    process.env.TAKT_MAX_MS = '0'
    process.env.FN_TAKT_MIN_MS = '0'
    process.env.FN_TAKT_MAX_MS = '0'
    process.env.FN_BASE_URL = fn.url
    // Der Token-Host folgt der Attrappe (src/config.ts, fnTokenBasis) — nie das echte api3.
    delete process.env.FN_TOKEN_BASE_URL
    process.env.FN_API_TOKENS = JSON.stringify({ wilma_wunder: TOKEN })
    process.env.ANFRAGE_TIMEOUT_MS = '1000'
    process.env.FN_ZEITGRENZE_LANG_MS = '1500'
    process.env.POS_ARTIKEL_MARKEN = 'wilma_wunder'
    process.env.WARENSTAMM_MARKEN = 'wilma_wunder'
    for (const m of ['APOSTO', 'ENCHILADA', 'DEUTSCHE_KONZEPTE', 'WILMA_WUNDER']) {
      delete process.env[`FN_${m}_USER`]
      delete process.env[`FN_${m}_PASSWORD`]
    }
    process.env.FN_WILMA_WUNDER_USER = 'test@aposto.eu'
    process.env.FN_WILMA_WUNDER_PASSWORD = 'geheim'
    process.env.LOG_LEVEL ??= 'error'
    const { config, fnTokenBasis } = await import('../config')
    if (config.DATABASE_URL !== DB || config.FN_BASE_URL !== fn.url || fnTokenBasis() !== fn.url
        || config.FN_API_TOKEN.wilma_wunder !== TOKEN) {
      throw new Error('config wurde vorher mit einer anderen Umgebung geladen — '
        + 'diese Datei einzeln starten: bun test src/foodnotify/zugang_db.test.ts')
    }
    db = new Client({ connectionString: DB })
    await db.connect()
    await db.query(`DELETE FROM sync.zugangssperre`)
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf, sync.schema_abweichung,
                       raw.api_antwort RESTART IDENTITY CASCADE`)
    await db.query(`DELETE FROM core.pos_artikel_abruf`)
    await db.query(`DELETE FROM core.pos_artikel`)
    await db.query(`DELETE FROM core.kostenstelle WHERE kostenstelle_id = ANY($1::int[])`, [TEST_KS])
    await db.query(`UPDATE core.kostenstelle SET connection_id = NULL WHERE connection_id IS NOT NULL`)
    const { rows: [m] } = await db.query(`SELECT marke_key FROM core.marke WHERE schluessel = 'wilma_wunder'`)
    const { rows: [k] } = await db.query(
      `INSERT INTO core.kostenstelle (marke_key, kostenstelle_id, restaurant_id, erp_id, name, restaurant_name,
                                      art, connection_id, kassensystem)
       VALUES ($1, 990111, 990110, 990112, 'Küche Zugangstest', 'Testbetrieb Zugang', 'kueche', 1907, 'amadeus')
       RETURNING kostenstelle_key`, [m.marke_key])
    ksWilma = Number(k.kostenstelle_key)
    const { rows: [mv] } = await db.query(
      `SELECT ispopulated FROM pg_matviews WHERE schemaname = 'mart' AND matviewname = 'artikel_monat_basis'`)
    if (mv && !mv.ispopulated) await db.query(`REFRESH MATERIALIZED VIEW mart.artikel_monat_basis`)
  })

  afterAll(async () => {
    lina?.stop(); fn?.stop()
    if (db) {
      await db.query(`DELETE FROM core.pos_artikel_abruf WHERE kostenstelle_key = $1`, [ksWilma])
      await db.query(`DELETE FROM core.pos_artikel WHERE kostenstelle_key = $1`, [ksWilma])
      await db.query(`DELETE FROM core.kostenstelle WHERE kostenstelle_id = ANY($1::int[])`, [TEST_KS])
      await db.end()
    }
  })

  test('vor dem ersten Lauf: 24 Zeilen, alle „nie gefragt", Prüfzeile 0 von 0', async () => {
    const { rows } = await db.query(`SELECT befund, count(*)::int AS n FROM mart.fn_zugang_stand GROUP BY 1`)
    expect(rows).toEqual([{ befund: 'nie gefragt', n: 24 }])
    expect(await pruefzeile()).toEqual({ geprueft: 0, auffaellig: 0 })
  })

  test('Token: ein Aufruf mit Bearer, keine Sitzung, zugang token in sync.aufgabe und raw, befund ok', async () => {
    const r = await einreihenUndLaufen()
    expect(r.status).toBe('ok')
    expect(fn.tokenZaehler[PFAD]).toBe(1)
    expect(fn.zaehler[PFAD]).toBeUndefined()
    expect(fn.anmeldungen).toBe(0)
    expect(await letzteAufgabe()).toEqual({ status: 'ok', zugang: 'token', zugang_bevorzugt: 'token',
      zugang_rueckfall: null, zugang_rueckfall_grund: null })
    const { rows: [raw] } = await db.query(`SELECT zugang FROM raw.api_antwort WHERE endpunkt = 'fn:pos_artikel'`)
    expect(raw.zugang).toBe('token')
    const { rows: [n] } = await db.query(`SELECT count(*)::int AS n FROM core.pos_artikel WHERE kostenstelle_key = $1`, [ksWilma])
    expect(n.n).toBe(5)
    expect(await stand()).toEqual({ befund: 'ok', zugang_letzter_lauf: 'token', abrufe: 1, ueber_token: 1,
      ueber_sitzung: 0, rueckfall_letzter_lauf: null })
    expect(await pruefzeile()).toEqual({ geprueft: 1, auffaellig: 0 })
  })

  test('Rezepte über das Token: Liste über recipe-viewer, dann Kopf/Zutaten/Meta — alles zugang token, core gefüllt', async () => {
    const { rows: [m] } = await db.query(`SELECT marke_key FROM core.marke WHERE schluessel = 'wilma_wunder'`)
    const einreihen = (ep: string, parameter: Record<string, string>) => db.query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
       VALUES ($1, current_date, current_date, 40, $2, $3)`, [ep, m.marke_key, JSON.stringify(parameter)])
    const { workerLauf } = await import('../sync/worker')
    await einreihen('fn:rezepte', { seite: '1' })
    expect((await workerLauf('manuell')).status).toBe('ok')
    // Der Einzelweg: Kopf, Zutaten, Meta eines Rezepts der Seite 1.
    for (const ep of ['fn:rezept', 'fn:rezept_zutaten', 'fn:rezept_meta']) await einreihen(ep, { rezeptId: '1032008' })
    expect((await workerLauf('manuell')).status).toBe('ok')
    expect(fn.tokenZaehler['/api/recipe-viewer/recipes']).toBe(1)
    expect(fn.zaehler['/api/recipes']).toBeUndefined()
    expect(fn.tokenZaehler['/api/recipes/1032008/ingredients']).toBe(1)
    const { rows } = await db.query(
      `SELECT endpunkt, status, zugang, zugang_rueckfall FROM sync.aufgabe
        WHERE endpunkt LIKE 'fn:rezept%' ORDER BY endpunkt`)
    expect(rows).toEqual(['fn:rezept', 'fn:rezept_meta', 'fn:rezept_zutaten', 'fn:rezepte'].map(endpunkt =>
      ({ endpunkt, status: 'ok', zugang: 'token', zugang_rueckfall: null })))
    const { rows: [r] } = await db.query(
      `SELECT count(*)::int AS n, bool_and(zutaten_geholt_am IS NOT NULL) FILTER (WHERE fn_id = 1032008) AS zutaten
         FROM core.rezept WHERE marke_key = $1 AND fn_id IN (1032008, 1048034)`, [m.marke_key])
    expect(r).toEqual({ n: 2, zutaten: true })
    const { rows: st } = await db.query(
      `SELECT endpunkt, befund FROM mart.fn_zugang_stand WHERE marke = 'wilma_wunder' AND endpunkt LIKE 'fn:rezept%' ORDER BY endpunkt`)
    expect(st.every(z => z.befund === 'ok')).toBe(true)
    expect(st.length).toBe(4)
  })

  test('(b) abgewiesen: derselbe Posten über die Sitzung, Grund sichtbar, Prüfzeile auffällig', async () => {
    fn.tokenModus('abgewiesen')
    const r = await einreihenUndLaufen()
    expect(r.status).toBe('ok')
    const a = await letzteAufgabe()
    expect(a).toMatchObject({ status: 'ok', zugang: 'sitzung', zugang_bevorzugt: 'token', zugang_rueckfall: 'abgewiesen' })
    expect(a.zugang_rueckfall_grund).toContain('scope-limited')
    const { rows } = await db.query(`SELECT zugang FROM raw.api_antwort WHERE endpunkt = 'fn:pos_artikel' ORDER BY id`)
    expect(rows.map(z => z.zugang)).toEqual(['token', 'sitzung'])
    expect(await stand()).toMatchObject({ befund: 'rueckfall abgewiesen', zugang_letzter_lauf: 'sitzung',
      rueckfall_letzter_lauf: 'abgewiesen' })
    expect((await pruefzeile()).auffaellig).toBe(1)
  })

  test('(c) Ausfall (502): über die Sitzung, befund rueckfall ausfall', async () => {
    fn.tokenModus('kaputt')
    expect((await einreihenUndLaufen()).status).toBe('ok')
    expect(await letzteAufgabe()).toMatchObject({ status: 'ok', zugang: 'sitzung', zugang_rueckfall: 'ausfall' })
    expect(await stand()).toMatchObject({ befund: 'rueckfall ausfall' })
    expect((await pruefzeile()).auffaellig).toBe(1)
  })

  test('(c) fremde Form über das Token: Rückfall, und KEIN schema_abweichung-Eintrag (die Sitzung lieferte die echte Form)', async () => {
    fn.tokenModus('fremd')
    const vorher = Number((await db.query(`SELECT count(*) AS n FROM sync.schema_abweichung`)).rows[0].n)
    expect((await einreihenUndLaufen()).status).toBe('ok')
    expect(await letzteAufgabe()).toMatchObject({ status: 'ok', zugang: 'sitzung', zugang_rueckfall: 'ausfall' })
    expect((await letzteAufgabe()).zugang_rueckfall_grund).toContain('fremde Form')
    expect(Number((await db.query(`SELECT count(*) AS n FROM sync.schema_abweichung`)).rows[0].n)).toBe(vorher)
  })

  test('Abbruch auf beiden Wegen (Zeitgrenze): core bleibt, wie es war', async () => {
    fn.tokenModus('ok')
    const vorher = (await db.query(
      `SELECT count(*)::int AS n, max(zuletzt_gesehen_am) AS z FROM core.pos_artikel WHERE kostenstelle_key = $1`, [ksWilma])).rows[0]
    fn.verzoegern(PFAD, 2_500)
    try {
      await einreihenUndLaufen()
    } finally {
      fn.verzoegern(PFAD, 0)
    }
    const a = await letzteAufgabe()
    expect(a.status).toBe('fehler')
    expect(a).toMatchObject({ zugang: 'sitzung', zugang_rueckfall: 'ausfall' })
    expect(a.zugang_rueckfall_grund).toContain('Zeitgrenze')
    const nachher = (await db.query(
      `SELECT count(*)::int AS n, max(zuletzt_gesehen_am) AS z FROM core.pos_artikel WHERE kostenstelle_key = $1`, [ksWilma])).rows[0]
    expect(nachher).toEqual(vorher)
  })

  test('(a) kein Token hinterlegt: über die Sitzung, befund rueckfall kein token — Prüfzeile NICHT auffällig', async () => {
    const { config } = await import('../config')
    delete config.FN_API_TOKEN.wilma_wunder
    try {
      expect((await einreihenUndLaufen()).status).toBe('ok')
    } finally {
      config.FN_API_TOKEN.wilma_wunder = TOKEN
    }
    expect(await letzteAufgabe()).toMatchObject({ status: 'ok', zugang: 'sitzung', zugang_rueckfall: 'kein_token' })
    expect(await stand()).toMatchObject({ befund: 'rueckfall kein token', zugang_letzter_lauf: 'sitzung' })
    // Geprüft werden die gefragten Paare (Kassenartikel und die vier Rezepteinträge), auffällig ist keins.
    expect(await pruefzeile()).toEqual({ geprueft: 5, auffaellig: 0 })
  })

  test('der Tokenwert steht nirgends in sync.*, raw.api_antwort oder der Warteschlange', async () => {
    const treffer = async (sql: string) => Number((await db.query(sql, [`%${TOKEN}%`])).rows[0].n)
    expect(await treffer(`SELECT count(*) AS n FROM sync.aufgabe a WHERE a::text LIKE $1`)).toBe(0)
    expect(await treffer(`SELECT count(*) AS n FROM sync.warteschlange w WHERE w::text LIKE $1`)).toBe(0)
    expect(await treffer(`SELECT count(*) AS n FROM sync.schema_abweichung s WHERE s::text LIKE $1`)).toBe(0)
    expect(await treffer(`SELECT count(*) AS n FROM sync.lauf l WHERE l::text LIKE $1`)).toBe(0)
    expect(await treffer(`SELECT count(*) AS n FROM raw.api_antwort r WHERE r::text LIKE $1`)).toBe(0)
  })
})
