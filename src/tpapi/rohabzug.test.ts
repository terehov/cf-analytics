/**
 * TPAPI Stufe 2 (0151): der Rohabzug in Phase A und das Nachladen in Phase C,
 * gegen die Attrappe und eine eigene Testdatenbank.
 *
 * Übersprungen ohne TEST_DATABASE_URL. Braucht Stand ≥ 0151 und eine EIGENE
 * Testdatenbank (Schema-Klon), nie die, auf die DATABASE_URL zeigt: die Datei
 * leert `sync.tpapi_zugang`, die Merker `tpapi_*` und die TPAPI-Tabellen ihrer
 * Testbetriebe. Immer die ganze Datei einzeln laufen lassen — die Notbremsen
 * sitzen im beforeAll:
 *
 *   TEST_DATABASE_URL=postgresql://localhost/<klon> bun test src/tpapi/rohabzug.test.ts
 *
 * Wie in nachlauf.test.ts ist die ZWEITE Notbremse die wichtigere: die `.env`
 * trägt die echten Schlüssel samt `api.lina.de` (Regel 7a).
 *
 * WAS GEPRÜFT WIRD (Plan §7, Abnahme 2a):
 *   * Phase A: listdays → Arbeitsliste, Dreitagesfenster Tag außen, Artikelstamm
 *   * personalkostenprotag kommt verdichtet nach raw — keine Personenzeile
 *   * gleicher Hash → kein zweiter Rohsatz; neuer Hash → geaendert_am, core_stand NULL
 *   * 403 je Modul: ein Betrieb nur mit Team Data — revenue aus, personal läuft
 *   * Phase C: neueste zuerst, Tag außen/Betrieb innen, Obergrenze, Zeitgrenze
 *   * die gleitende Grenze: übersprungen statt gewartet, geteilt mit Stufe 1
 *   * 429: Betrieb für den ganzen Lauf aus, auch in Phase C
 *   * ein kaputter Tag hält nichts an; drei Fehler in Folge schalten das Modul ab
 *   * mart.quelle_zulauf misst je Endpunktgruppe (Filter in sync.quelle)
 *   * kein Schlüssel in Log, raw oder sync.tpapi_zugang
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { tpapiMockStarten, type TpapiMockOptionen } from './mock'

const DB = process.env.TEST_DATABASE_URL
if (DB && process.env.DATABASE_URL && DB === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL zeigt auf dieselbe Datenbank wie DATABASE_URL — '
    + 'eine eigene Testdatenbank anlegen.')
}
const mitDb = DB ? describe : describe.skip

const A = '1a'.repeat(20)   // alle drei Module
const S = '2b'.repeat(20)   // nur Team Data (wie Ratskeller Saarbrücken)
const G = '3c'.repeat(20)   // kommt später dazu — für die gleitende Grenze
const H = '4d'.repeat(20)   // wird gebremst
const K = '5e'.repeat(20)   // ein kaputter Journaltag
const L = '6f'.repeat(20)   // Journal und Bons dauerhaft 500
const SCHLUESSEL: Record<string, string> = {
  [A]: 'rohabzug-test-schluessel-aaaaaaaa',
  [S]: 'rohabzug-test-schluessel-ssssssss',
  [G]: 'rohabzug-test-schluessel-gggggggg',
  [H]: 'rohabzug-test-schluessel-hhhhhhhh',
  [K]: 'rohabzug-test-schluessel-kkkkkkkk',
  [L]: 'rohabzug-test-schluessel-llllllll',
}
const BETRIEBE = [A, S, G, H, K, L]
const nur = (...enc: string[]) => Object.fromEntries(enc.map(e => [e, SCHLUESSEL[e]!]))

mitDb('TPAPI-Rohabzug (mit Datenbank und Attrappe)', () => {
  let db: import('pg').Client
  let cfg: any
  let nachlauf: typeof import('./nachlauf').tpapiNachlauf
  let nachladen: typeof import('./rohabzug').tpapiNachladen
  let TpapiClient: typeof import('./client').TpapiClient
  let mock: ReturnType<typeof tpapiMockStarten>
  const logs: string[] = []
  let beginn: Date
  let loesen: (() => void) | undefined
  /** Die letzten sechs Kalendertage bis gestern, nach der Uhr der Datenbank, neueste zuerst. */
  let tage6: string[] = []

  const starte = (o: Partial<TpapiMockOptionen> = {}) => {
    mock?.stoppen()
    mock = tpapiMockStarten({
      schluessel: SCHLUESSEL, module: { [S]: ['personal'] },
      tage: { [A]: tage6, [G]: tage6, [H]: tage6, [K]: tage6, [L]: tage6 },
      ...o,
    })
    cfg.LINA_API_BASIS = mock.url
  }
  /** Nur die Aufrufe der Stufe 2 (ohne personalkostenprostunde). */
  const stufe2 = () => mock.aufrufe.filter(a => a.pfad !== '/extern/personal/personalkostenprostunde')
  const von = (enc: string) => stufe2().filter(a => a.encId === enc)
  const iso = (bd: string | null) => bd ? bd.split('.').reverse().join('-') : null
  const client = (o: Record<string, number> = {}) => new TpapiClient({
    basis: mock.url, schluessel: cfg.TPAPI_SCHLUESSEL, taktMs: 0, timeoutMs: 5_000, ...o,
  })
  const zugang = async (enc: string) => Object.fromEntries((await db.query(
    `SELECT modul, zustand, letzter_http, letzter_fehler, zuletzt_erfolg_am IS NOT NULL AS erfolg
       FROM sync.tpapi_zugang WHERE enc_id = $1`, [enc])).rows.map(r => [r.modul, r]))
  const rueckstand = async (enc: string, endpunkt: string) => (await db.query(
    `SELECT r.* FROM mart.tpapi_rueckstand r WHERE r.enc_id = $1 AND r.endpunkt = $2`, [enc, endpunkt])).rows[0]
  const keinSchluesselIn = (text: string) => {
    for (const s of Object.values(SCHLUESSEL)) expect(text).not.toContain(s)
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = DB!
    process.env.LINA_API_BASIS = 'http://localhost:9'
    process.env.LINA_API_SCHLUESSEL = JSON.stringify(SCHLUESSEL)
    process.env.LOG_LEVEL ??= 'error'
    const { config } = await import('../config')
    if (config.DATABASE_URL !== DB) {
      throw new Error('config wurde vorher mit einer anderen DATABASE_URL geladen — '
        + 'diese Datei einzeln starten: bun test src/tpapi/rohabzug.test.ts')
    }
    // Regel 7a: nie gegen api.lina.de, nie mit den Schlüsseln aus der .env.
    if (config.LINA_API_BASIS !== 'http://localhost:9'
        || JSON.stringify(config.TPAPI_SCHLUESSEL) !== JSON.stringify(SCHLUESSEL)) {
      throw new Error('config zeigt nicht auf die TPAPI-Attrappe — Abbruch, bevor ein echter Schluessel '
        + 'benutzt wird. Diese Datei einzeln starten.')
    }
    cfg = config
    cfg.TPAPI_TAKT_MS = 0
    cfg.TPAPI_FENSTER_TAGE = 1        // Stufe 1 klein halten: ein Tag je Betrieb
    cfg.TPAPI_BACKFILL_JE_LAUF = 0
    cfg.TPAPI_AUFRUFE_JE_BETRIEB = 80
    cfg.TPAPI_GRENZE_JE_BETRIEB = 60
    cfg.TPAPI_GRENZE_MINUTEN = 15
    cfg.TPAPI_STAMM_TAGE = 7
    cfg.TPAPI_NACHLADEN_JE_LAUF = 10_000

    const { log } = await import('../lib/log')
    ;(log.settings as any).minLevel = 0
    ;(log.settings as any).type = 'hidden'
    loesen = log.attachTransport(o => { logs.push(JSON.stringify(o)) })

    nachlauf = (await import('./nachlauf')).tpapiNachlauf
    nachladen = (await import('./rohabzug')).tpapiNachladen
    TpapiClient = (await import('./client')).TpapiClient
    const { Client } = await import('pg')
    db = new Client({ connectionString: DB })
    await db.connect()
    beginn = (await db.query(`SELECT now() AS t`)).rows[0].t
    tage6 = (await db.query(
      `SELECT (current_date - g)::text AS t FROM generate_series(1, 6) g ORDER BY g`)).rows.map(r => r.t)

    for (const [i, enc] of BETRIEBE.entries()) {
      await db.query(
        `INSERT INTO core.betrieb (enc_id, name) VALUES ($1, $2)
         ON CONFLICT (enc_id) DO UPDATE SET name = excluded.name`, [enc, `Test Rohabzug ${'ASGHKL'[i]}`])
    }
    await db.query(`DELETE FROM sync.tpapi_zugang`)
    await db.query(`DELETE FROM sync.merker WHERE schluessel LIKE 'tpapi%'`)
    for (const t of ['core.tpapi_abruf', 'core.tpapi_stammabzug', 'core.tpapi_geschaeftstag',
                     'core.personalkosten_stunde', 'core.personalkosten_stunde_abruf']) {
      await db.query(`DELETE FROM ${t} WHERE betrieb_key IN
                        (SELECT betrieb_key FROM core.betrieb WHERE enc_id = ANY($1))`, [BETRIEBE])
    }
  })

  afterAll(async () => {
    loesen?.()
    mock?.stoppen()
    await db?.end()
    const { pool } = await import('../db/pool')
    await pool.end()
  })

  test('Phase A: listdays, Fenster Tag außen, Artikelstamm — und ein Betrieb nur mit Team Data', async () => {
    cfg.TPAPI_SCHLUESSEL = nur(A, S)
    starte()
    expect(await nachlauf()).toBe('ok')   // „not licensed" macht nicht teilweise (D7)

    // A: listdays + 3 Tage × 3 Endpunkte + 13 Listen.
    expect(von(A)).toHaveLength(1 + 9 + 13)
    // S: listdays (403 Revenue), dann nur Personalkosten je Tag, Artikel einmal (403).
    expect(von(S).map(a => a.pfad.replace('/extern/', ''))).toEqual([
      'revenue/listdays',
      'personal/personalkostenprotag', 'personal/personalkostenprotag', 'personal/personalkostenprotag',
      'merchandiseman/recipe',
    ])
    expect(von(S).filter(a => a.status === 403)).toHaveLength(2)

    // Tag außen: die Tage des Fensters fallen über alle Betriebe hinweg nie wieder an.
    const fensterTage = stufe2().filter(a => a.businessdate).map(a => iso(a.businessdate)!)
    expect([...fensterTage].sort().reverse()).toEqual(fensterTage)
    expect(new Set(fensterTage)).toEqual(new Set(tage6.slice(0, 3)))

    const { rows: [n] } = await db.query(
      `SELECT (SELECT count(*) FROM core.tpapi_geschaeftstag g JOIN core.betrieb b USING (betrieb_key) WHERE b.enc_id = $1)::int AS liste_a,
              (SELECT count(*) FROM core.tpapi_geschaeftstag g JOIN core.betrieb b USING (betrieb_key) WHERE b.enc_id = $2)::int AS liste_s,
              (SELECT count(*) FROM core.tpapi_abruf x JOIN core.betrieb b USING (betrieb_key) WHERE b.enc_id = $1)::int AS abruf_a,
              (SELECT count(*) FROM core.tpapi_abruf x JOIN core.betrieb b USING (betrieb_key) WHERE b.enc_id = $2)::int AS abruf_s,
              (SELECT count(*) FROM core.tpapi_stammabzug x JOIN core.betrieb b USING (betrieb_key) WHERE b.enc_id = $1 AND x.neu)::int AS stamm_a`,
      [A, S])
    expect(n).toEqual({ liste_a: 6, liste_s: 0, abruf_a: 9, abruf_s: 3, stamm_a: 13 })

    const za = await zugang(A)
    for (const m of ['personal', 'revenue', 'artikel']) expect(za[m]).toMatchObject({ zustand: 'ok', erfolg: true })
    const zs = await zugang(S)
    expect(zs.personal).toMatchObject({ zustand: 'ok', erfolg: true })
    expect(zs.revenue).toMatchObject({ zustand: 'nicht_lizenziert', letzter_http: 403 })
    expect(zs.revenue.letzter_fehler).toContain('not licensed')
    expect(zs.artikel.zustand).toBe('nicht_lizenziert')

    // Die Merker je Endpunktgruppe.
    const { rows: merker } = await db.query(
      `SELECT schluessel, wert FROM sync.merker WHERE schluessel IN ('tpapi_revenue','tpapi_personal_tag','tpapi_artikel')
        ORDER BY 1`)
    expect(merker.map(m => [m.schluessel, m.wert.ok, m.wert.phase])).toEqual([
      ['tpapi_artikel', true, 'tagesgeschaeft'],
      ['tpapi_personal_tag', true, 'tagesgeschaeft'],
      ['tpapi_revenue', true, 'tagesgeschaeft'],
    ])

    // Der Rückstand: A hat 6 Tage in der Liste, 3 im Fenster geholt. S hat keine
    // Liste — Personalkosten je Tag über den Horizont, Journal gar nicht.
    expect(await rueckstand(A, 'tpapi:journal')).toMatchObject({
      arbeitsliste: 'listdays', tage_liste: 6, tage_geholt: 3, tage_fehlend: 3, stockt: false,
    })
    expect(await rueckstand(S, 'tpapi:personalkostenprotag')).toMatchObject({
      arbeitsliste: 'horizont 365', tage_liste: 365, tage_geholt: 3, tage_fehlend: 362,
    })
    expect(await rueckstand(S, 'tpapi:journal')).toBeUndefined()
  })

  test('personalkostenprotag kommt nur als Summe nach raw — keine Zeile je Person', async () => {
    const { rows } = await db.query(
      `SELECT jsonb_typeof(payload) AS typ, payload, payload_text FROM raw.api_antwort
        WHERE quelle = 'tpapi' AND endpunkt = 'tpapi:personalkostenprotag' AND abgerufen_am >= $1`, [beginn])
    expect(rows.length).toBe(6)
    for (const r of rows) {
      expect(r.typ).toBe('object')
      expect(Object.keys(r.payload).sort()).toEqual(
        ['brutto', 'h_brutto', 'h_zuschl_25', 'h_zuschl_40', 'h_zuschl_50', 'lohnkosten', 'personen'])
      expect(r.payload.personen).toBe(4)
    }
    // Kein Einzelwert einer Person in irgendeinem TPAPI-Rohsatz dieses Laufs.
    const { rows: [alle] } = await db.query(
      `SELECT string_agg(coalesce(payload::text, '') || coalesce(payload_text, ''), ' ') AS t
         FROM raw.api_antwort WHERE quelle = 'tpapi' AND abgerufen_am >= $1`, [beginn])
    for (const einzel of ['123.45', '98.76', '151.17', '258.5', '11.333']) expect(alle.t).not.toContain(einzel)
    // Und auch nicht im Log.
    for (const einzel of ['123.45', '98.76', '151.17']) expect(logs.join('\n')).not.toContain(einzel)
  })

  test('mart.quelle_zulauf misst jede Endpunktgruppe für sich', async () => {
    const { quellenSpiegeln } = await import('../sync/quellen')
    expect(await quellenSpiegeln()).toBeGreaterThan(0)
    const { rows } = await db.query(
      `SELECT quelle, zustand, wird_noch_gefragt FROM mart.quelle_zulauf WHERE system = 'tpapi' ORDER BY quelle`)
    const z = Object.fromEntries(rows.map(r => [r.quelle, r.zustand]))
    expect(z).toMatchObject({
      'tpapi:listdays': 'ok', 'tpapi:journal': 'ok', 'tpapi:journaltables': 'ok',
      'tpapi:personalkostenprotag': 'ok', 'tpapi:artikelstamm': 'ok', 'tpapi:getforecastperday': 'nicht erwartet',
    })
    // Der Filter wirkt: ohne Journalzeilen wäre das Journal stumm, obwohl die
    // Tabelle dank der Personalkosten frisch ist.
    const { rows: [f] } = await db.query(
      `SELECT filter_spalte, filter_werte FROM sync.quelle WHERE quelle = 'tpapi:journal'`)
    expect(f).toEqual({ filter_spalte: 'endpunkt', filter_werte: ['tpapi:journal'] })
  })

  test('gleicher Inhalt: kein zweiter Rohsatz; neuer Inhalt: geaendert_am, core_stand zurück auf NULL', async () => {
    const rohJournal = async () => Number((await db.query(
      `SELECT count(*) FROM raw.api_antwort WHERE endpunkt = 'tpapi:journal' AND betrieb_enc_id = $1
          AND abgerufen_am >= $2`, [A, beginn])).rows[0].count)
    expect(await rohJournal()).toBe(3)

    starte()
    expect(await nachlauf()).toBe('ok')
    // Zweite Nacht: Artikelstamm nicht fällig, S' Module „not licensed" sieben Tage nicht gefragt.
    expect(von(A)).toHaveLength(1 + 9)
    expect(von(S).map(a => a.pfad)).toEqual(Array(3).fill('/extern/personal/personalkostenprotag'))
    expect(await rohJournal()).toBe(3)
    const { rows } = await db.query(
      `SELECT abrufe, geaendert_am FROM core.tpapi_abruf x JOIN core.betrieb b USING (betrieb_key)
        WHERE b.enc_id = $1`, [A])
    expect(rows.every(r => r.abrufe === 2 && r.geaendert_am === null)).toBe(true)

    // Ein Tag ändert sich (nachträglich gebuchter Storno) — und 2b hatte ihn schon geladen.
    const gestern = tage6[0]!
    await db.query(
      `UPDATE core.tpapi_abruf x SET core_stand = 1 FROM core.betrieb b
        WHERE b.betrieb_key = x.betrieb_key AND b.enc_id = $1 AND x.endpunkt = 'tpapi:journal'
          AND x.geschaeftstag = $2`, [A, gestern])
    starte({
      antwortStufe2: (pfad, enc, bd) => pfad === 'revenue/journal' && enc === A && iso(bd) === gestern
        ? [{ ID: 1, balance: 12.5, art: 'S' }] : undefined,
    })
    await nachlauf()
    expect(await rohJournal()).toBe(4)
    const { rows: [t] } = await db.query(
      `SELECT abrufe, geaendert_am IS NOT NULL AS geaendert, core_stand, zeilen
         FROM core.tpapi_abruf x JOIN core.betrieb b USING (betrieb_key)
        WHERE b.enc_id = $1 AND x.endpunkt = 'tpapi:journal' AND x.geschaeftstag = $2`, [A, gestern])
    expect(t).toEqual({ abrufe: 3, geaendert: true, core_stand: null, zeilen: 1 })
    const { rows: [stand] } = await db.query(
      `SELECT eintraege, geaendert FROM mart.tpapi_abruf_stand WHERE endpunkt = 'tpapi:journal'`)
    expect(stand.geaendert).toBe(1)
  })

  test('Phase C: neueste Tage zuerst, Tag außen/Betrieb innen, Obergrenze — S nur mit Personal', async () => {
    starte()
    cfg.TPAPI_NACHLADEN_JE_LAUF = 20
    const vorherS = (await rueckstand(S, 'tpapi:personalkostenprotag')).tage_fehlend
    expect(await nachladen({ client: client() })).toBe('ok')
    expect(stufe2()).toHaveLength(20)
    const folge = stufe2().map(a => iso(a.businessdate)!)
    expect([...folge].sort().reverse()).toEqual(folge)
    // Die ersten drei Tage: je A dreimal, dann S — Betrieb innen.
    expect(stufe2().slice(0, 4).map(a => a.encId)).toEqual([A, A, A, S])
    expect(new Set(folge.slice(0, 12))).toEqual(new Set(tage6.slice(3, 6)))
    // S fragt nie das Journal — nicht lizenziert.
    expect(von(S).every(a => a.pfad === '/extern/personal/personalkostenprotag')).toBe(true)
    expect((await rueckstand(A, 'tpapi:journal')).tage_fehlend).toBe(0)
    expect((await rueckstand(S, 'tpapi:personalkostenprotag')).tage_fehlend).toBe(vorherS - 3 - 8)
    // Ein Tag aus dem Nachladen zählt als Fortschritt.
    expect((await rueckstand(S, 'tpapi:personalkostenprotag')).letzter_nachladen).not.toBeNull()
  })

  test('die gleitende Grenze: ein Betrieb an der Grenze wird übersprungen, nicht abgewartet', async () => {
    // G kommt dazu: Phase A holt sein Fenster, sein Rückstand sind drei Tage × drei Endpunkte.
    cfg.TPAPI_SCHLUESSEL = nur(A, S, G)
    starte()
    await nachlauf()
    expect((await rueckstand(G, 'tpapi:journal')).tage_fehlend).toBe(3)

    starte()
    cfg.TPAPI_NACHLADEN_JE_LAUF = 12   // G: 9 Aufträge, danach S: 3 ältere Tage
    const fensterMs = 1_000
    const t0 = Date.now()
    expect(await nachladen({ client: client({ grenzeJeBetrieb: 2, grenzeFensterMs: fensterMs }) })).toBe('ok')
    expect(stufe2()).toHaveLength(12)
    // Nie mehr als zwei Aufrufe je Betrieb in einem Fenster.
    for (const enc of [G, S]) {
      const z = von(enc).map(a => a.zeit)
      for (let i = 0; i < z.length; i++) {
        expect(z.filter(t => t >= z[i]! && t < z[i]! + fensterMs - 20).length).toBeLessThanOrEqual(2)
      }
    }
    // Übersprungen statt gewartet: S kommt dran, bevor G seinen dritten Aufruf hat.
    const reihe = stufe2().map(a => a.encId)
    expect(reihe.indexOf(S)).toBeLessThan(reihe.lastIndexOf(G))
    expect(reihe.slice(0, 4)).toEqual([G, G, S, S])
    // Und es wurde gewartet, als beide an der Grenze standen — aber nicht ewig.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(fensterMs * 2)
    expect(Date.now() - t0).toBeLessThan(15_000)
  })

  test('Stufe 1 und Stufe 2 teilen sich die gleitende Grenze', async () => {
    starte()
    const fensterMs = 800
    await nachlauf({ client: client({ grenzeJeBetrieb: 5, grenzeFensterMs: fensterMs }) })
    for (const enc of [A, G]) {
      // Alle Aufrufe dieses Betriebs, Stufe 1 eingeschlossen.
      const z = mock.aufrufe.filter(a => a.encId === enc).map(a => a.zeit)
      expect(z.length).toBeGreaterThan(5)
      for (let i = 0; i < z.length; i++) {
        expect(z.filter(t => t >= z[i]! && t < z[i]! + fensterMs - 20).length).toBeLessThanOrEqual(5)
      }
    }
  })

  test('429: der Betrieb ist für den ganzen Lauf aus — in Phase A und danach in Phase C', async () => {
    cfg.TPAPI_SCHLUESSEL = nur(A, H)
    // H: Stufe 1 (1), listdays (2), der erste Journalaufruf (3) bekommt 429.
    starte({ bremsenAb: { [H]: 3 } })
    expect(await nachlauf()).toBe('teilweise')
    expect(mock.aufrufe.filter(a => a.encId === H)).toHaveLength(3)
    expect((await zugang(H)).revenue).toMatchObject({ zustand: 'gebremst', letzter_http: 429 })
    const { rows: [m] } = await db.query(`SELECT wert FROM sync.merker WHERE schluessel = 'tpapi_revenue'`)
    expect(m.wert.fehler).toContain('1 gebremst')

    // Phase C übernimmt den Client aus Phase A (laufClient) — H bleibt draußen,
    // obwohl sein Rückstand der jüngste ist.
    expect((await rueckstand(H, 'tpapi:journal')).tage_fehlend).toBe(6)
    mock.aufrufe.length = 0
    cfg.TPAPI_NACHLADEN_JE_LAUF = 5
    expect(await nachladen()).toBe('ok')
    expect(mock.aufrufe.some(a => a.encId === H)).toBe(false)
  })

  test('ein kaputter Tag hält nichts an; drei Fehler in Folge schalten nur dieses Modul ab', async () => {
    cfg.TPAPI_SCHLUESSEL = nur(K, L)
    const kaputt = tage6[1]!
    starte({
      serverfehlerWenn: (pfad, enc, bd) =>
        (enc === K && pfad === 'revenue/journal' && iso(bd) === kaputt)
        || (enc === L && pfad.startsWith('revenue/journal')),
    })
    expect(await nachlauf()).toBe('teilweise')   // wegen L

    // K: ein 500, danach geht es weiter — alle 3 Tage Bons, 2 von 3 Tagen Journal.
    const k = von(K).filter(a => a.businessdate)
    expect(k).toHaveLength(9)
    const { rows: [kz] } = await db.query(
      `SELECT count(*) FILTER (WHERE endpunkt = 'tpapi:journal')::int AS journal,
              count(*) FILTER (WHERE endpunkt = 'tpapi:journaltables')::int AS bons
         FROM core.tpapi_abruf x JOIN core.betrieb b USING (betrieb_key) WHERE b.enc_id = $1`, [K])
    expect(kz).toEqual({ journal: 2, bons: 3 })
    const { rows: [kr] } = await db.query(
      `SELECT juengster_tag_fehlend::text AS t FROM mart.tpapi_rueckstand WHERE enc_id = $1 AND endpunkt = 'tpapi:journal'`, [K])
    expect(kr.t).toBe(kaputt)

    // L: Journal 1, Bons 2, Journal 3 → revenue aus. Personal und Artikel laufen weiter.
    const lRevenue = von(L).filter(a => a.pfad.startsWith('/extern/revenue/journal'))
    expect(lRevenue).toHaveLength(3)
    expect(von(L).filter(a => a.pfad === '/extern/personal/personalkostenprotag')).toHaveLength(3)
    expect(von(L).filter(a => a.pfad.startsWith('/extern/merchandiseman/'))).toHaveLength(13)
    const zl = await zugang(L)
    expect(zl.revenue).toMatchObject({ zustand: 'fehler', letzter_http: 500 })
    expect(zl.personal.zustand).toBe('ok')
  })

  test('Zeitgrenze und Obergrenze 0', async () => {
    // Weiter mit K und L aus dem Test davor — ihr Rückstand ist da, der Zugang gespiegelt.
    starte()
    cfg.TPAPI_NACHLADEN_JE_LAUF = 50
    expect(await nachladen({ client: client(), ende: () => (stufe2().length >= 2 ? 'Test-Ende' : null) }))
      .toBe('ok')
    expect(stufe2()).toHaveLength(2)

    mock.aufrufe.length = 0
    cfg.TPAPI_NACHLADEN_JE_LAUF = 0
    expect(await nachladen({ client: client() })).toBe('uebersprungen')
    expect(mock.aufrufe).toHaveLength(0)
    cfg.TPAPI_NACHLADEN_JE_LAUF = 10_000
  })

  test('ohne Schlüssel: Module ohne_schluessel, kein Aufruf, kein Nachladen', async () => {
    starte()
    cfg.TPAPI_SCHLUESSEL = {}
    expect(await nachlauf()).toBe('uebersprungen')
    expect(await nachladen({ client: client() })).toBe('uebersprungen')
    expect(mock.aufrufe).toHaveLength(0)
    const z = await zugang(A)
    for (const m of ['personal', 'revenue', 'artikel']) expect(z[m].zustand).toBe('ohne_schluessel')
    expect(await rueckstand(A, 'tpapi:journal')).toBeUndefined()
    cfg.TPAPI_SCHLUESSEL = SCHLUESSEL
  })

  test('kein Schlüssel im Log, in raw und in sync.tpapi_zugang', async () => {
    expect(logs.some(l => l.includes('tpapi rohabzug tagesgeschaeft'))).toBe(true)
    expect(logs.some(l => l.includes('tpapi rohabzug nachladen'))).toBe(true)
    keinSchluesselIn(logs.join('\n'))
    const { rows: [r] } = await db.query(
      `SELECT string_agg(coalesce(payload::text, '') || coalesce(payload_text, '') || coalesce(ladefehler, ''), ' ') AS t
         FROM raw.api_antwort WHERE quelle = 'tpapi' AND abgerufen_am >= $1`, [beginn])
    keinSchluesselIn(r.t)
    const { rows: [z] } = await db.query(`SELECT coalesce(string_agg(letzter_fehler, ' '), '') AS t FROM sync.tpapi_zugang`)
    keinSchluesselIn(z.t)
  })
})
