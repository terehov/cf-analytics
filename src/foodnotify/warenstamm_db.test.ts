/**
 * Warenstamm mit Listenpreis (0157) gegen eine echte Datenbank und die
 * FoodNotify-Attrappe: Nachfüllen → Worker → raw → core → mart, der Schalter
 * je Marke, Preisänderung, „fehlt seit", Folgeseiten, Abbruch ≠ leer,
 * Formfehler, Zulauf (Regel 10), Neuaufbau aus raw (Regel 4) — und Teil B,
 * mart.einkaufspreis_artikel_monat.
 *
 * Übersprungen ohne TEST_DATABASE_URL. Die Datei macht TRUNCATE über
 * Warteschlange und raw, leert core.ware_stand samt Verlauf und nimmt allen
 * übrigen Kostenstellen für die Dauer des Tests die erp_id (danach zurück) —
 * sie braucht eine EIGENE Testdatenbank (Klon, siehe docs/offene-punkte.md),
 * nie die, auf die DATABASE_URL zeigt. Immer die ganze Datei laufen lassen,
 * nie mit -t (die Notbremse sitzt im ersten beforeAll).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { mockStarten } from '../lina/mock'
import { fnMockStarten } from './mock'

const DB = process.env.TEST_DATABASE_URL

if (DB && process.env.DATABASE_URL && DB === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL zeigt auf dieselbe Datenbank wie DATABASE_URL — '
    + 'diese Datei macht TRUNCATE. Eine eigene Testdatenbank anlegen.')
}

const lauf = DB ? describe : describe.skip
const PFAD = '/api/990302/products'
const TEST_KS = [990301, 990401]
const TEST_LIEFERANT = 'test-0157'

lauf('Warenstamm mit Datenbank', () => {
  let db: Client
  let lina: ReturnType<typeof mockStarten>
  let fn: ReturnType<typeof fnMockStarten>
  let wilma: number
  let ksWilma: number
  let erpVorher: Array<{ kostenstelle_key: number; erp_id: number }> = []

  /** Den Posten für heute neu einreihen — der Einreihweg sperrt sonst gegen den Tag. */
  const neuEinreihen = async () => {
    await db.query(`DELETE FROM sync.warteschlange WHERE endpunkt = 'fn:warenstamm'`)
    const { warenstammNachfuellen } = await import('../sync/nachfuellen')
    return warenstammNachfuellen()
  }
  const lauf = async () => {
    const { workerLauf } = await import('../sync/worker')
    return workerLauf('manuell')
  }
  const bestand = async () => (await db.query(
    `SELECT produkt_id, listenpreis::float AS preis, fehlt_seit IS NOT NULL AS fehlt, zuletzt_gesehen_am, geaendert_am
       FROM core.ware_stand WHERE kostenstelle_key = $1 ORDER BY produkt_id`, [ksWilma])).rows
  const verlauf = async () => (await db.query(
    `SELECT produkt_id, gesehen_ab, gueltig_ab, listenpreis::float AS preis, zuletzt_gesehen_am, sichtungen
       FROM core.listenpreis_beobachtung WHERE kostenstelle_key = $1 ORDER BY produkt_id, gesehen_ab`, [ksWilma])).rows
  const abruf = async () => (await db.query(
    `SELECT * FROM core.ware_stand_abruf WHERE kostenstelle_key = $1`, [ksWilma])).rows[0]

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
    // Kurze Zeitgrenze, damit der Abbruch im Test Sekunden statt Minuten dauert.
    process.env.ANFRAGE_TIMEOUT_MS = '1000'
    delete process.env.WARENSTAMM_MARKEN   // die Vorgabe: nur wilma_wunder
    delete process.env.POS_ARTIKEL_MARKEN
    // Wilma Wunder UND Aposto mit Attrappen-Zugang: Aposto hat Zugangsdaten und
    // eine Kostenstelle, steht aber nicht im Schalter — der Test des Schalters.
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
    if (config.DATABASE_URL !== DB || config.FN_BASE_URL !== fn.url || config.ANFRAGE_TIMEOUT_MS !== 1000) {
      throw new Error('config wurde vorher mit einer anderen Umgebung geladen — '
        + 'diese Datei einzeln starten: bun test src/foodnotify/warenstamm_db.test.ts')
    }
    db = new Client({ connectionString: DB })
    await db.connect()
    await db.query(`DELETE FROM sync.zugangssperre`)
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf, sync.schema_abweichung,
                       raw.api_antwort RESTART IDENTITY CASCADE`)
    await db.query(`DELETE FROM core.listenpreis_beobachtung`)
    await db.query(`DELETE FROM core.ware_stand`)
    await db.query(`DELETE FROM core.ware_stand_abruf`)
    await db.query(`DELETE FROM core.pos_artikel_abruf`)
    await db.query(`DELETE FROM core.pos_artikel`)
    await aufraeumen()
    // Nur die Test-Kostenstellen sollen eingereiht werden; die erp_id kommt in afterAll zurück.
    erpVorher = (await db.query(
      `SELECT kostenstelle_key, erp_id FROM core.kostenstelle WHERE erp_id IS NOT NULL`)).rows
    await db.query(`UPDATE core.kostenstelle SET erp_id = NULL WHERE erp_id IS NOT NULL`)
    const marke = async (s: string) => Number((await db.query(
      `SELECT marke_key FROM core.marke WHERE schluessel = $1`, [s])).rows[0].marke_key)
    wilma = await marke('wilma_wunder')
    const aposto = await marke('aposto')
    const { rows: [k] } = await db.query(
      `INSERT INTO core.kostenstelle (marke_key, kostenstelle_id, restaurant_id, erp_id, name, restaurant_name, art)
       VALUES ($1, 990301, 990300, 990302, 'Bar Test', 'Testbetrieb', 'bar')
       RETURNING kostenstelle_key`, [wilma])
    ksWilma = Number(k.kostenstelle_key)
    await db.query(
      `INSERT INTO core.kostenstelle (marke_key, kostenstelle_id, restaurant_id, erp_id, name, restaurant_name, art)
       VALUES ($1, 990401, 990400, 990402, 'Bar Test Aposto', 'Testbetrieb Aposto', 'bar')`, [aposto])
    // Ein Lieferant der Attrappe ist in core.lieferant bekannt (aus einer Bestellung), der andere nicht.
    await db.query(`INSERT INTO core.lieferant (marke_key, fn_id, name) VALUES ($1, '9101', 'Testlieferant Frisch')
                    ON CONFLICT (marke_key, fn_id) DO NOTHING`, [wilma])
  })

  /** Testzeilen in core entfernen — vor und nach dem Lauf. */
  async function aufraeumen() {
    const ks = `(SELECT kostenstelle_key FROM core.kostenstelle WHERE kostenstelle_id = ANY($1::int[]))`
    await db.query(`DELETE FROM core.listenpreis_beobachtung WHERE kostenstelle_key IN ${ks}`, [TEST_KS])
    await db.query(`DELETE FROM core.ware_stand WHERE kostenstelle_key IN ${ks}`, [TEST_KS])
    await db.query(`DELETE FROM core.ware_stand_abruf WHERE kostenstelle_key IN ${ks}`, [TEST_KS])
    await db.query(`DELETE FROM core.bestellposition WHERE bestellung_key IN
                      (SELECT bestellung_key FROM core.bestellung WHERE kostenstelle_key IN ${ks})`, [TEST_KS])
    await db.query(`DELETE FROM core.bestellung WHERE kostenstelle_key IN ${ks}`, [TEST_KS])
    await db.query(`DELETE FROM core.kostenstelle WHERE kostenstelle_id = ANY($1::int[])`, [TEST_KS])
    await db.query(`DELETE FROM core.lieferant WHERE fn_id IN ('9101', $1)
                      AND NOT EXISTS (SELECT 1 FROM core.bestellung b WHERE b.lieferant_key = core.lieferant.lieferant_key)`,
                   [TEST_LIEFERANT])
  }

  afterAll(async () => {
    lina?.stop(); fn?.stop()
    if (db) {
      await aufraeumen()
      for (const z of erpVorher) {
        await db.query(`UPDATE core.kostenstelle SET erp_id = $2 WHERE kostenstelle_key = $1`, [z.kostenstelle_key, z.erp_id])
      }
      await db.end()
    }
  })

  test('Nachfüllen: nur die Marken aus WARENSTAMM_MARKEN, ein Posten je Kostenstelle und Tag', async () => {
    const { warenstammNachfuellen } = await import('../sync/nachfuellen')
    expect(await warenstammNachfuellen()).toBe(1)
    expect(await warenstammNachfuellen()).toBe(0)   // derselbe Tag: gesperrt
    const { rows } = await db.query(
      `SELECT marke_key, parameter, nachladen, prioritaet FROM sync.warteschlange WHERE endpunkt = 'fn:warenstamm'`)
    expect(rows).toEqual([{ marke_key: wilma, parameter: { erpId: '990302', seite: '1' }, nachladen: false, prioritaet: 32 }])
    const { rows: [m] } = await db.query(`SELECT wert FROM sync.merker WHERE schluessel = 'warenstamm_marken'`)
    expect(m.wert).toEqual({ marken: ['wilma_wunder'] })
  })

  test('Worker: raw, core, Verlauf, Abzug und die Sichten', async () => {
    const r = await lauf()
    expect(r.status).toBe('ok')

    const { rows: [raw] } = await db.query(
      `SELECT count(*)::int AS n, min(parameter->>'erpId') AS erp, min((parameter->>'markeKey')::int) AS marke
         FROM raw.api_antwort WHERE endpunkt = 'fn:warenstamm'`)
    expect(raw).toEqual({ n: 1, erp: '990302', marke: wilma })

    const { rows } = await db.query(
      `SELECT produkt_id, fn_produkt_id, artikelnummer, name, lieferant_fn_id, lieferant_name, einheit,
              inhalt::float AS inhalt, gebinde_menge::float AS gebinde, listenpreis::float AS preis, rezept_fn_id,
              bestellbar, verfuegbar, bestand_menge::float AS bestand, bestand_wert::float AS wert,
              fn_geaendert_am, fehlt_seit, raw_id IS NOT NULL AS mit_raw
         FROM core.ware_stand WHERE kostenstelle_key = $1 ORDER BY produkt_id`, [ksWilma])
    expect(rows).toHaveLength(7)
    expect(rows[0]).toEqual({
      produkt_id: 700001, fn_produkt_id: 8800001, artikelnummer: '91001', name: 'Testzwiebel Rot Julienne (2,5 Kg)',
      lieferant_fn_id: '9101', lieferant_name: 'Testlieferant Frisch', einheit: 'kg', inhalt: 2.5, gebinde: 1,
      preis: 1.5, rezept_fn_id: null, bestellbar: true, verfuegbar: true, bestand: 2, wert: 3,
      fn_geaendert_am: new Date('2026-08-19T17:31:55Z'), fehlt_seit: null, mit_raw: true })
    // Kleinlieferant mit leerem artikelId: keine Nummer, aber Lieferant.
    expect(rows[6]).toMatchObject({ produkt_id: 700007, artikelnummer: null, lieferant_fn_id: '9103' })
    // Katalog: nur bei bestellbaren Waren; Gebindepreis wie geliefert, fehlt er, bleibt die Spalte leer.
    const { rows: kat } = await db.query(
      `SELECT produkt_id, katalogpreis::float AS kp, katalogpreis_einheit AS ke, katalog_gebinde AS kg,
              katalog_gebinde_menge::float AS km, katalog_gebinde_preis::float AS kpr,
              jsonb_array_length(katalog_gebinde_alle) AS varianten, katalog_produkt_id AS kid
         FROM core.ware_stand WHERE kostenstelle_key = $1 ORDER BY produkt_id`, [ksWilma])
    expect(kat[0]).toEqual({ produkt_id: 700001, kp: 1.5, ke: 'KG', kg: 'Sack (1)', km: 1, kpr: 3.75, varianten: 1, kid: 29000001 })
    expect(kat[1]).toMatchObject({ kp: 2.25, ke: 'L', kg: 'Karton (6)', km: 6, kpr: null })
    expect(kat[2]).toEqual({ produkt_id: 700003, kp: null, ke: null, kg: null, km: null, kpr: null, varianten: null, kid: null })
    // Eigenproduktion: ohne Lieferant und Nummer, mit Rezept; führende Null bleibt; Preis 0 bleibt 0.
    expect(rows[4]).toMatchObject({ produkt_id: 700005, artikelnummer: null, lieferant_fn_id: null,
                                    rezept_fn_id: 1032008, gebinde: null, preis: 5.3038 })
    expect(rows[5]).toMatchObject({ artikelnummer: '0305', bestand: -0.05 })
    expect(rows[3]).toMatchObject({ produkt_id: 700004, preis: 0 })

    expect((await verlauf()).map(v => v.sichtungen)).toEqual([1, 1, 1, 1, 1, 1, 1])
    const ab = await abruf()
    expect(ab).toMatchObject({ erp_id: 990302, seiten_gesamt: 1, seiten_geladen: [1], produkte_gemeldet: 7,
                               produkte_geladen: 7, produkte: 7, befund: null })
    expect(ab.vollstaendig_am).not.toBeNull()

    const { rows: la } = await db.query(
      `SELECT produkt_id, lieferant_key IS NOT NULL AS mit_lieferant, listenpreis_gebinde::float AS gebinde_preis,
              kein_preis, eigenproduktion, preis_seit IS NOT NULL AS mit_seit, preis_seit_erstem_abzug,
              kostenstellen_gleiche_ware, katalogpreis::float AS kp, katalog_abweichung_pct::float AS kab
         FROM mart.listenpreis_aktuell WHERE kostenstelle_id = 990301 ORDER BY produkt_id`)
    expect(la).toHaveLength(7)
    // Die Test-Kostenstelle hat keinen Betrieb: sie setzt keinen Massstab im Kostenstellenvergleich.
    expect(la[0]).toEqual({ produkt_id: 700001, mit_lieferant: true, gebinde_preis: 3.75, kein_preis: false,
      eigenproduktion: false, mit_seit: true, preis_seit_erstem_abzug: true, kostenstellen_gleiche_ware: 0,
      kp: 1.5, kab: 0 })
    expect(la[5]).toMatchObject({ produkt_id: 700006, kp: 12.5, kab: -3.5 })   // der Katalog ist billiger
    expect(la[1]!.mit_lieferant).toBe(false)          // 9102 hat noch keine Bestellung in core.lieferant
    expect(la[3]).toMatchObject({ kein_preis: true, gebinde_preis: null })
    expect(la[4]).toMatchObject({ eigenproduktion: true })

    const { rows: [ae] } = await db.query(
      `SELECT count(*)::int AS n FROM mart.listenpreis_aenderung WHERE kostenstelle_id = 990301`)
    expect(ae.n).toBe(0)                               // der erste Wert ist keine Änderung

    const { rows: st } = await db.query(
      `SELECT marke, zustand, produkte, ohne_preis, ohne_artikelnummer, eigenproduktion, mit_katalogpreis,
              nicht_mehr_geliefert, reihe_ab IS NOT NULL AS mit_reihe
         FROM mart.warenstamm_stand WHERE kostenstelle_id IN (990301, 990401) ORDER BY kostenstelle_id`)
    expect(st).toEqual([
      { marke: 'Wilma Wunder', zustand: 'ohne betrieb', produkte: 7, ohne_preis: 1, ohne_artikelnummer: 1,
        eigenproduktion: 1, mit_katalogpreis: 3, nicht_mehr_geliefert: 0, mit_reihe: true },
      { marke: 'Aposto', zustand: 'marke nicht aktiv', produkte: 0, ohne_preis: 0, ohne_artikelnummer: 0,
        eigenproduktion: 0, mit_katalogpreis: 0, nicht_mehr_geliefert: 0, mit_reihe: false },
    ])

    const { rows: [pz] } = await db.query(
      `SELECT geprueft::int, auffaellig::int FROM mart.pruefung_uebersicht WHERE sicht = 'mart.warenstamm_stand'`)
    expect(pz).toEqual({ geprueft: 1, auffaellig: 0 })
  })

  test('Regel 10: beide Registereinträge erwartet und mit Zulauf', async () => {
    const { quellenSpiegeln } = await import('../sync/quellen')
    await quellenSpiegeln()
    const { rows } = await db.query(
      `SELECT quelle, erwartet, zustand FROM mart.quelle_zulauf
        WHERE quelle IN ('fn:warenstamm', 'core:ware_stand') ORDER BY quelle`)
    expect(rows).toEqual([
      { quelle: 'core:ware_stand', erwartet: true, zustand: 'ok' },
      { quelle: 'fn:warenstamm', erwartet: true, zustand: 'ok' },
    ])
  })

  test('Preisänderung: neue Zeile im Verlauf, je Preisart, Prozent nur zwischen zwei echten Preisen', async () => {
    fn.warenstammPreis(700001, 1.65)   // +10 %
    fn.warenstammPreis(700004, 0.89)   // von 0: kein Prozent, „preis neu"
    fn.warenstammPreis(700002, 0)      // auf 0: keine Senkung, „kein preis mehr"
    fn.warenstammKatalogpreis(700002, null)   // fällt aus dem Katalog
    fn.warenstammKatalogpreis(700006, 12.95)  // Katalog zieht nach: +3,6 %
    await neuEinreihen()
    expect((await lauf()).status).toBe('ok')

    const v = await verlauf()
    expect(v.filter(z => z.produkt_id === 700001).map(z => z.preis)).toEqual([1.5, 1.65])
    // Unveränderte Produkte: keine neue Zeile, nur eine Sichtung mehr.
    expect(v.filter(z => z.produkt_id === 700003).map(z => z.sichtungen)).toEqual([2])
    // Nur der Katalogpreis bewegt: auch das ist ein neuer Wert.
    expect(v.filter(z => z.produkt_id === 700006).map(z => z.preis)).toEqual([12.95, 12.95])

    const { rows } = await db.query(
      `SELECT produkt_id, preisart, preis_alt::float AS alt, preis_neu::float AS neu, aenderung_pct::float AS pct, art,
              vergleichbar, auch_geaendert, gueltig_ab IS NOT NULL AS mit_tag
         FROM mart.listenpreis_aenderung WHERE kostenstelle_id = 990301 ORDER BY produkt_id, preisart`)
    expect(rows).toEqual([
      { produkt_id: 700001, preisart: 'listenpreis', alt: 1.5, neu: 1.65, pct: 10, art: 'erhoehung', vergleichbar: true, auch_geaendert: [], mit_tag: true },
      { produkt_id: 700002, preisart: 'katalogpreis', alt: 2.25, neu: null, pct: null, art: 'kein preis mehr', vergleichbar: false, auch_geaendert: [], mit_tag: true },
      { produkt_id: 700002, preisart: 'listenpreis', alt: 2.25, neu: 0, pct: null, art: 'kein preis mehr', vergleichbar: false, auch_geaendert: [], mit_tag: true },
      { produkt_id: 700004, preisart: 'listenpreis', alt: 0, neu: 0.89, pct: null, art: 'preis neu', vergleichbar: false, auch_geaendert: [], mit_tag: true },
      { produkt_id: 700006, preisart: 'katalogpreis', alt: 12.5, neu: 12.95, pct: 3.6, art: 'erhoehung', vergleichbar: true, auch_geaendert: [], mit_tag: true },
    ])
    const { rows: [st] } = await db.query(
      `SELECT preisaenderungen_30_tage, katalogaenderungen_30_tage FROM mart.warenstamm_stand WHERE kostenstelle_id = 990301`)
    expect(st).toEqual({ preisaenderungen_30_tage: 1, katalogaenderungen_30_tage: 1 })   // nur die vergleichbaren
    // geaendert_am rückt nur bei fachlicher Änderung.
    const b = await bestand()
    expect(b.find(z => z.produkt_id === 700001)!.geaendert_am.getTime())
      .toBeGreaterThan(b.find(z => z.produkt_id === 700003)!.geaendert_am.getTime())
  })

  test('fehlt seit: nicht gelöscht, und wieder da, wenn es zurückkommt', async () => {
    const vorher = await bestand()
    fn.warenstammOhne([700003])
    await neuEinreihen()
    expect((await lauf()).status).toBe('ok')
    const mitte = await bestand()
    expect(mitte).toHaveLength(7)
    expect(mitte.map(z => z.fehlt)).toEqual([false, false, true, false, false, false, false])
    expect(mitte[0]!.zuletzt_gesehen_am.getTime()).toBeGreaterThan(vorher[0]!.zuletzt_gesehen_am.getTime())
    expect(mitte[2]!.zuletzt_gesehen_am.getTime()).toBe(vorher[2]!.zuletzt_gesehen_am.getTime())
    const { rows: [st] } = await db.query(
      `SELECT produkte, nicht_mehr_geliefert FROM mart.warenstamm_stand WHERE kostenstelle_id = 990301`)
    expect(st).toEqual({ produkte: 6, nicht_mehr_geliefert: 1 })
    const { rows: [la] } = await db.query(
      `SELECT count(*)::int AS n FROM mart.listenpreis_aktuell WHERE kostenstelle_id = 990301`)
    expect(la.n).toBe(6)

    fn.warenstammOhne([])
    await neuEinreihen()
    expect((await lauf()).status).toBe('ok')
    expect((await bestand()).map(z => z.fehlt)).toEqual([false, false, false, false, false, false, false])
  })

  test('Folgeseiten: Seite 1 reiht Seite 2 ein, erst danach ist der Abzug vollständig', async () => {
    fn.warenstammSeitenMax(4)          // der Server nimmt höchstens 4 je Seite an
    fn.warenstammOhne([700006])        // steht sonst auf Seite 2 — jetzt fehlt es
    await neuEinreihen()
    expect((await lauf()).status).toBe('ok')
    fn.warenstammSeitenMax(Infinity)
    fn.warenstammOhne([])

    const { rows: posten } = await db.query(
      `SELECT parameter->>'seite' AS seite, ergebnis FROM sync.warteschlange
        WHERE endpunkt = 'fn:warenstamm' ORDER BY posten_id`)
    expect(posten).toEqual([{ seite: '1', ergebnis: 'ok' }, { seite: '2', ergebnis: 'ok' }])
    const ab = await abruf()
    expect(ab).toMatchObject({ seiten_gesamt: 2, produkte_gemeldet: 6, produkte_geladen: 6, befund: null })
    expect([...ab.seiten_geladen].sort()).toEqual([1, 2])
    expect(ab.vollstaendig_am.getTime()).toBeGreaterThanOrEqual(ab.abzug_beginn.getTime())
    expect((await bestand()).map(z => z.fehlt)).toEqual([false, false, false, false, false, true, false])
  })

  test('Abbruch ist nie „keine Produkte": Zeitgrenze und HTTP 500 ändern nichts', async () => {
    const vorher = await bestand()
    const abVorher = await abruf()
    const rawVorher = Number((await db.query(
      `SELECT count(*) AS n FROM raw.api_antwort WHERE endpunkt = 'fn:warenstamm'`)).rows[0].n)

    fn.verzoegern(PFAD, 2000)          // 2 s gegen 1 s Zeitgrenze
    await neuEinreihen()
    await lauf()
    fn.verzoegern(PFAD, 0)
    const { rows: [w] } = await db.query(
      `SELECT erledigt_am, letzter_fehler FROM sync.warteschlange WHERE endpunkt = 'fn:warenstamm'`)
    expect(w.erledigt_am).toBeNull()
    expect(String(w.letzter_fehler)).toMatch(/time|abort/i)

    fn.kaputtMachen(PFAD)
    await neuEinreihen()
    await lauf()
    fn.reparieren(PFAD)
    const { rows: [w2] } = await db.query(
      `SELECT letzter_fehler FROM sync.warteschlange WHERE endpunkt = 'fn:warenstamm'`)
    expect(String(w2.letzter_fehler)).toContain('HTTP 500')

    expect(await bestand()).toEqual(vorher)
    expect((await abruf()).letzter_abruf_am.getTime()).toBe(abVorher.letzter_abruf_am.getTime())
    expect(Number((await db.query(
      `SELECT count(*) AS n FROM raw.api_antwort WHERE endpunkt = 'fn:warenstamm'`)).rows[0].n)).toBe(rawVorher)
  }, 30_000)

  test('fremde Form, leere und gekappte Antwort: Rohantwort gesichert, Befund geschrieben, core unberührt', async () => {
    const vorher = (await bestand()).map(z => ({ id: z.produkt_id, preis: z.preis, fehlt: z.fehlt }))
    const verlaufVorher = (await verlauf()).length
    await db.query(`DELETE FROM sync.schema_abweichung`)

    for (const form of ['fremd', 'leer', 'gekappt'] as const) {
      fn.warenstammForm(form)
      await neuEinreihen()
      await lauf()
      const { rows: [w] } = await db.query(
        `SELECT ergebnis FROM sync.warteschlange WHERE endpunkt = 'fn:warenstamm'`)
      expect(w.ergebnis).not.toBe('ok')
    }
    fn.warenstammForm('echt')

    // Der Worker kann einen gescheiterten Posten im selben Lauf erneut versuchen — je Form also
    // mindestens ein Befund, nicht genau einer.
    const { rows: abw } = await db.query(
      `SELECT tatsaechlich->'probleme'->0->>'problem' AS problem FROM sync.schema_abweichung
        WHERE endpunkt = 'fn:warenstamm' ORDER BY abweichung_id`)
    expect(abw.length).toBeGreaterThanOrEqual(3)
    expect(abw.some(a => /unitPrice/.test(a.problem))).toBe(true)
    expect(abw.some(a => /0 Produkte/.test(a.problem))).toBe(true)
    expect(abw.some(a => /erwartet/.test(a.problem))).toBe(true)
    const { rows: [raw] } = await db.query(
      `SELECT count(*)::int AS n FROM raw.api_antwort
        WHERE endpunkt = 'fn:warenstamm' AND abgerufen_am > now() - interval '1 minute'`)
    expect(raw.n).toBeGreaterThanOrEqual(3)
    expect((await bestand()).map(z => ({ id: z.produkt_id, preis: z.preis, fehlt: z.fehlt }))).toEqual(vorher)
    expect((await verlauf()).length).toBe(verlaufVorher)
  })

  test('Regel 4: der Neuaufbau aus raw ergibt denselben Stand und denselben Verlauf', async () => {
    const stand = async () => (await db.query(
      `SELECT produkt_id, artikelnummer, listenpreis, inhalt, bestand_menge, erstmals_am, geaendert_am,
              zuletzt_gesehen_am, fehlt_seit, raw_id
         FROM core.ware_stand WHERE kostenstelle_key = $1 ORDER BY produkt_id`, [ksWilma])).rows
    const vorher = { stand: await stand(), verlauf: await verlauf(), abruf: await abruf() }
    const roh = Number((await db.query(
      `SELECT count(*) AS n FROM raw.api_antwort WHERE endpunkt = 'fn:warenstamm'`)).rows[0].n)
    const { rows: [r] } = await db.query(`SELECT * FROM core.warenstamm_neu_aufbauen($1)`, [ksWilma])
    // Geladen: 6 Seiten (vier Läufe mit einer Seite, einer mit zwei). Alle übrigen Rohantworten sind die
    // mit Befund (fremd, leer, gekappt — je nach Wiederholung im Lauf mehrfach); Abbrüche haben keine.
    expect(r).toEqual({ antworten: roh, geladen: 6, befunde: roh - 6, fehler: 0 })
    expect(r.befunde).toBeGreaterThanOrEqual(3)
    expect(await stand()).toEqual(vorher.stand)
    expect(await verlauf()).toEqual(vorher.verlauf)
    expect(await abruf()).toEqual(vorher.abruf)
  })

  test('Lader direkt: ein unvollständiger Abzug setzt kein fehlt_seit, dieselbe Antwort zweimal ändert nichts', async () => {
    // Seite 1 von 3 eines Abzugs von morgen, ohne 700002 — das könnte auf einer Folgeseite stehen.
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/warenstamm.json', import.meta.url), 'utf8'))
    const daten = fixture.payload.data.filter((p: { id: number }) => p.id !== 700002).slice(0, 3)
    const payload = { ...fixture, _hinweis: undefined,
      payload: { ...fixture.payload, data: daten, current_page: 1, current_page_size: 3, page_count: 3, total_count: 7 } }
    const { rows: [roh] } = await db.query(
      `INSERT INTO raw.api_antwort (quelle, endpunkt, zeitraum_von, zeitraum_bis, parameter, http_status, payload,
                                    payload_hash, payload_bytes)
       VALUES ('foodnotify', 'fn:warenstamm', current_date + 1, current_date + 1, $1, 200, $2, 'test', 1)
       RETURNING id, abgerufen_am`,
      [JSON.stringify({ erpId: '990302', seite: '1', markeKey: wilma }), JSON.stringify(payload)])
    const lade = async () => (await db.query(
      `SELECT core.warenstamm_laden(id, abgerufen_am) AS e FROM raw.api_antwort WHERE id = $1`, [roh.id])).rows[0].e
    expect(await lade()).toMatchObject({ produkte: 3, seite: 1, seiten: 3, vollstaendig: false })
    expect((await bestand()).find(z => z.produkt_id === 700002)!.fehlt).toBe(false)
    expect(await abruf()).toMatchObject({ seiten_gesamt: 3, seiten_geladen: [1], produkte_geladen: 3 })
    expect(await lade()).toEqual({ produkte: 0, uebersprungen: true })
    const { rows: [st] } = await db.query(
      `SELECT zustand FROM mart.warenstamm_stand WHERE kostenstelle_id = 990301`)
    expect(st.zustand).toBe('ohne betrieb')            // der letzte vollständige Abzug ist frisch
  })
})

lauf('Teil B: mart.einkaufspreis_artikel_monat mit Datenbank', () => {
  let db: Client
  let lieferant: number
  let ks: number

  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
    const wilma = Number((await db.query(`SELECT marke_key FROM core.marke WHERE schluessel = 'wilma_wunder'`)).rows[0].marke_key)
    await db.query(`DELETE FROM core.kostenstelle WHERE kostenstelle_id = 990501`)
    ks = Number((await db.query(
      `INSERT INTO core.kostenstelle (marke_key, kostenstelle_id, restaurant_id, name, restaurant_name, art)
       VALUES ($1, 990501, 990500, 'Küche Test B', 'Testbetrieb B', 'kueche') RETURNING kostenstelle_key`, [wilma])).rows[0].kostenstelle_key)
    lieferant = Number((await db.query(
      `INSERT INTO core.lieferant (marke_key, fn_id, name) VALUES ($1, 'test-0157', 'Testlieferant B')
       ON CONFLICT (marke_key, fn_id) DO UPDATE SET name = EXCLUDED.name RETURNING lieferant_key`, [wilma])).rows[0].lieferant_key)
    // Eine Bestellung je Zeile: Datum, Status, Name, Menge, Gebinde, Summe, Lieferantennummer.
    const positionen: Array<[string, string | null, string, number, number, number, string]> = [
      ['2019-01-10 10:00+01', 'delivered', 'Testware alt', 1, 1, 10.00, 'B-1'],
      ['2019-01-20 10:00+01', 'delivered', 'Testware alt', 2, 1, 24.00, 'B-1'],   // 12 je Gebinde
      ['2019-03-05 10:00+01', 'delivered', 'Testware neu', 1, 1, 11.55, 'B-1'],   // +5 % gegen Januar
      ['2019-03-06 10:00+01', 'canceled',  'Testware neu', 1, 1, 100.00, 'B-1'],  // Storno zählt nicht
      ['2019-04-02 10:00+02', 'delivered', 'Testware neu', 1, 2, 23.10, 'B-1'],   // Gebindewechsel
      ['2019-04-03 10:00+02', 'delivered', 'Leere Nummer', 1, 1, 5.00, ''],       // '' ist keine Nummer
    ]
    let i = 0
    for (const [am, status, name, menge, gebinde, summe, nr] of positionen) {
      const b = Number((await db.query(
        `INSERT INTO core.bestellung (kostenstelle_key, fn_id, lieferant_key, bestellt_am, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING bestellung_key`, [ks, `test-0157-${i++}`, lieferant, am, status])).rows[0].bestellung_key)
      await db.query(
        `INSERT INTO core.bestellposition (bestellung_key, name, menge, gebinde_menge, einheit, summe_preis, lieferanten_nr)
         VALUES ($1, $2, $3, $4, 'kg', $5, $6)`, [b, name, menge, gebinde, summe, nr])
    }
    await db.query(`REFRESH MATERIALIZED VIEW mart.einkaufspreis_artikel_monat_basis`)
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    await db.query(`DELETE FROM core.bestellposition WHERE bestellung_key IN
                      (SELECT bestellung_key FROM core.bestellung WHERE kostenstelle_key = $1)`, [ks])
    await db.query(`DELETE FROM core.bestellung WHERE kostenstelle_key = $1`, [ks])
    await db.query(`DELETE FROM core.kostenstelle WHERE kostenstelle_key = $1`, [ks])
    await db.query(`DELETE FROM core.lieferant WHERE lieferant_key = $1`, [lieferant])
    await db.query(`REFRESH MATERIALIZED VIEW mart.einkaufspreis_artikel_monat_basis`)
    await db.end()
  }, 60_000)

  test('eine Reihe je Lieferant und Nummer, Vergleich mit dem letzten Monat mit Bestellung', async () => {
    const { rows } = await db.query(
      `SELECT monat::text, lieferanten_nr, ware, namen::int, ware_im_monat, bestellungen::int, positionen::int, gebinde::float,
              ausgaben::float, preis_je_gebinde::float AS preis, vorher_monat::text, monate_seit_vorher,
              veraenderung_pct::float AS pct, gebinde_gewechselt, verdaechtig
         FROM mart.einkaufspreis_artikel_monat WHERE lieferant_key = $1 ORDER BY monat`, [lieferant])
    expect(rows).toEqual([
      { monat: '2019-01-01', lieferanten_nr: 'B-1', ware: 'Testware neu', namen: 2, ware_im_monat: 'Testware alt',
        bestellungen: 2, positionen: 2, gebinde: 3, ausgaben: 34, preis: 11, vorher_monat: null,
        monate_seit_vorher: null, pct: null, gebinde_gewechselt: false, verdaechtig: false },
      { monat: '2019-03-01', lieferanten_nr: 'B-1', ware: 'Testware neu', namen: 2, ware_im_monat: 'Testware neu',
        bestellungen: 1, positionen: 1, gebinde: 1, ausgaben: 11.55, preis: 11.55, vorher_monat: '2019-01-01',
        monate_seit_vorher: 2, pct: 5, gebinde_gewechselt: false, verdaechtig: false },
      { monat: '2019-04-01', lieferanten_nr: 'B-1', ware: 'Testware neu', namen: 2, ware_im_monat: 'Testware neu',
        bestellungen: 1, positionen: 1, gebinde: 1, ausgaben: 23.1, preis: 23.1, vorher_monat: '2019-03-01',
        monate_seit_vorher: 1, pct: 100, gebinde_gewechselt: true, verdaechtig: true },
    ])
  })
})
