/**
 * TPAPI Stufe 2, Schritt 2b (0153): der Lader raw → core, die mart-Sichten
 * und der Abgleich — gegen die Attrappe und eine eigene Testdatenbank.
 *
 * Übersprungen ohne TEST_DATABASE_URL. Braucht Stand ≥ 0153 und eine EIGENE
 * Testdatenbank (Schema-Klon), nie die, auf die DATABASE_URL zeigt: die Datei
 * leert `sync.tpapi_zugang`, die Merker `tpapi*` und die TPAPI-Tabellen ihrer
 * Testbetriebe und schreibt Testzeilen in core.umsatzbericht_tag,
 * core.finanzweg(_tag) und core.bon. Immer die ganze Datei einzeln:
 *
 *   TEST_DATABASE_URL=postgresql://localhost/<klon> bun test src/tpapi/core_laden.test.ts
 *
 * Die zweite Notbremse ist die wichtigere: die `.env` trägt die echten
 * Schlüssel samt `api.lina.de` (Regel 7a).
 *
 * WAS GEPRÜFT WIRD (Plan §5, §8):
 *   * Phase A: Fenstertage, Artikelstamm und Prognose stehen nach tpapiNachlauf in core
 *   * Journal: Typen der Formprobe (ust als Text UND als Zahl), Nacht am richtigen Tag,
 *     Finanzwegsummen im selben Zug, Saldo null, nichts auffällig
 *   * mart ohne addinfo, debitor_text, zip_code; lesbar für mcp_leser
 *   * Phase C: Bestand neueste zuerst; vor dem Horizont bleibt roh ("ausserhalb horizont")
 *   * Abgleich: Deutung gegen Umsatzbericht, Finanzwege gegen 97, Bons gegen 96, Nachlass
 *   * Kassen-Fehleingabe sichtbar
 *   * Ladefehler: drei Versuche, dann endgültig; ein neuer Rohsatz versucht es wieder
 *   * Laderstand: ein alter core_stand wartet und wird neu geladen
 *   * Prognose: Vorabwert, Änderung gezählt, Historie monatsweise
 *   * Personal je Stunde: Phase C bis zur Tiefe von listdays
 *   * kein Schlüssel im Log
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { journalZeilen, MOCK_UMSATZ_BRUTTO, prognoseZeilen, tpapiMockStarten, type TpapiMockOptionen } from './mock'

const DB = process.env.TEST_DATABASE_URL
if (DB && process.env.DATABASE_URL && DB === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL zeigt auf dieselbe Datenbank wie DATABASE_URL — '
    + 'eine eigene Testdatenbank anlegen.')
}
const mitDb = DB ? describe : describe.skip

const P = '7a'.repeat(20)   // alle Module, tiefe listdays
const F = '8b'.repeat(20)   // ein Tag mit Kassen-Fehleingabe
const X = '9c'.repeat(20)   // ein Journal, das sich nicht laden lässt
const SCHLUESSEL: Record<string, string> = {
  [P]: 'core-test-schluessel-pppppppppp',
  [F]: 'core-test-schluessel-ffffffffff',
  [X]: 'core-test-schluessel-xxxxxxxxxx',
}
const BETRIEBE = [P, F, X]

mitDb('TPAPI-Lader raw → core (mit Datenbank und Attrappe)', () => {
  let db: import('pg').Client
  let cfg: any
  let nachlauf: typeof import('./nachlauf').tpapiNachlauf
  let nachladen: typeof import('./rohabzug').tpapiNachladen
  let coreA: typeof import('./core_laden').tpapiCoreTagesgeschaeft
  let coreC: typeof import('./core_laden').tpapiCoreNachladen
  let TpapiClient: typeof import('./client').TpapiClient
  let mock: ReturnType<typeof tpapiMockStarten>
  const logs: string[] = []
  let loesen: (() => void) | undefined
  /** d[n] = current_date - n (Uhr der Datenbank). */
  const d: string[] = []
  const finanzwegeEingefuegt: number[] = []
  let ueberschreiben: TpapiMockOptionen['antwortStufe2'] | undefined

  const alsBd = (iso: string) => iso.split('-').reverse().join('.')
  const starte = (o: Partial<TpapiMockOptionen> = {}) => {
    mock?.stoppen()
    mock = tpapiMockStarten({
      schluessel: SCHLUESSEL,
      tage: {
        [P]: [1, 2, 3, 4, 5, 6, 10, 11, 12, 70, 400].map(n => d[n]!),
        [F]: [d[2]!], [X]: [d[1]!],
      },
      antwortStufe2: (pfad, enc, bd, par) => ueberschreiben?.(pfad, enc, bd, par),
      ...o,
    })
    cfg.LINA_API_BASIS = mock.url
  }
  const client = (grenzeJeBetrieb = 90) => new TpapiClient({
    basis: mock.url, schluessel: cfg.TPAPI_SCHLUESSEL, taktMs: 0, timeoutMs: 5_000, grenzeJeBetrieb,
  })
  const bk = async (enc: string) => Number((await db.query(`SELECT betrieb_key FROM core.betrieb WHERE enc_id = $1`, [enc])).rows[0].betrieb_key)
  const abruf = async (enc: string, endpunkt: string, tag: string) => (await db.query(
    `SELECT x.* FROM core.tpapi_abruf x JOIN core.betrieb b USING (betrieb_key)
      WHERE b.enc_id = $1 AND x.endpunkt = $2 AND x.geschaeftstag = $3`, [enc, endpunkt, tag])).rows[0]
  const stand = async (endpunkt: string) => (await db.query(
    `SELECT * FROM mart.tpapi_core_stand WHERE endpunkt = $1`, [endpunkt])).rows[0]

  beforeAll(async () => {
    process.env.DATABASE_URL = DB!
    process.env.LINA_API_BASIS = 'http://localhost:9'
    process.env.LINA_API_SCHLUESSEL = JSON.stringify(SCHLUESSEL)
    process.env.LOG_LEVEL ??= 'error'
    const { config } = await import('../config')
    if (config.DATABASE_URL !== DB) {
      throw new Error('config wurde vorher mit einer anderen DATABASE_URL geladen — '
        + 'diese Datei einzeln starten: bun test src/tpapi/core_laden.test.ts')
    }
    if (config.LINA_API_BASIS !== 'http://localhost:9'
        || JSON.stringify(config.TPAPI_SCHLUESSEL) !== JSON.stringify(SCHLUESSEL)) {
      throw new Error('config zeigt nicht auf die TPAPI-Attrappe — Abbruch, bevor ein echter Schluessel '
        + 'benutzt wird. Diese Datei einzeln starten.')
    }
    cfg = config
    cfg.TPAPI_TAKT_MS = 0
    cfg.TPAPI_FENSTER_TAGE = 1
    cfg.TPAPI_BACKFILL_JE_LAUF = 0
    cfg.TPAPI_GRENZE_JE_BETRIEB = 90
    cfg.TPAPI_NACHLADEN_JE_LAUF = 10_000
    cfg.TPAPI_STUNDE_NACHLADEN = 0
    cfg.TPAPI_CORE_MONATE = 24
    cfg.TPAPI_CORE_JE_LAUF = 150_000

    const { log } = await import('../lib/log')
    ;(log.settings as any).minLevel = 0
    ;(log.settings as any).type = 'hidden'
    loesen = log.attachTransport(o => { logs.push(JSON.stringify(o)) })

    nachlauf = (await import('./nachlauf')).tpapiNachlauf
    nachladen = (await import('./rohabzug')).tpapiNachladen
    const kern = await import('./core_laden')
    coreA = kern.tpapiCoreTagesgeschaeft
    coreC = kern.tpapiCoreNachladen
    TpapiClient = (await import('./client')).TpapiClient
    const { Client } = await import('pg')
    db = new Client({ connectionString: DB })
    await db.connect()
    for (const n of Array.from({ length: 401 }, (_, i) => i)) d[n] = ''
    const { rows } = await db.query(
      `SELECT g, (current_date - g)::text AS t FROM generate_series(0, 400) g`)
    for (const r of rows) d[Number(r.g)] = r.t

    for (const [i, enc] of BETRIEBE.entries()) {
      await db.query(
        `INSERT INTO core.betrieb (enc_id, name) VALUES ($1, $2)
         ON CONFLICT (enc_id) DO UPDATE SET name = excluded.name`, [enc, `Test Core ${'PFX'[i]}`])
    }
    await db.query(`DELETE FROM sync.tpapi_zugang`)
    await db.query(`DELETE FROM sync.merker WHERE schluessel LIKE 'tpapi%'`)
    // Die Zaehlsichten (mart.tpapi_core_stand, Pruefzeilen) zaehlen ueber alle
    // Betriebe — deshalb die TPAPI-Tabellen GANZ leeren, nicht nur die eigenen
    // Betriebe (auf einem Klon gibt es dort sonst nur Reste anderer Testdateien).
    for (const t of ['core.tpapi_abruf', 'core.tpapi_stammabzug', 'core.tpapi_geschaeftstag',
                     'core.kassenjournal', 'core.kassenjournal_finanzweg_tag', 'core.kassenbon',
                     'core.personalkosten_tag', 'core.umsatzprognose_tag', 'core.tpapi_artikel',
                     'core.tpapi_finanzweg', 'core.tpapi_finanzkategorie', 'core.tpapi_stammliste']) {
      await db.query(`DELETE FROM ${t}`)
    }
    for (const t of ['core.personalkosten_stunde', 'core.personalkosten_stunde_abruf',
                     'core.umsatzbericht_tag', 'core.finanzweg_tag', 'core.bon']) {
      await db.query(`DELETE FROM ${t} WHERE betrieb_key IN
                        (SELECT betrieb_key FROM core.betrieb WHERE enc_id = ANY($1))`, [BETRIEBE])
    }
  })

  afterAll(async () => {
    loesen?.()
    mock?.stoppen()
    if (finanzwegeEingefuegt.length) {
      await db.query(`DELETE FROM core.finanzweg WHERE nummer = ANY($1)`, [finanzwegeEingefuegt])
    }
    await db?.end()
    const { pool } = await import('../db/pool')
    await pool.end()
  })

  test('Phase A: Fenstertage, Artikelstamm und Prognose stehen nach tpapiNachlauf in core', async () => {
    cfg.TPAPI_SCHLUESSEL = { [P]: SCHLUESSEL[P] }
    starte()
    expect(await nachlauf()).toBe('ok')
    const b = await bk(P)

    // Drei Fenstertage × 12 Journalzeilen, Tag aus der Abrufzeile.
    const { rows: [j] } = await db.query(
      `SELECT count(*)::int AS n, count(DISTINCT geschaeftstag)::int AS tage,
              array_agg(DISTINCT ust ORDER BY ust) AS ust,
              count(*) FILTER (WHERE zusatz IS NOT NULL)::int AS mit_zusatz,
              sum(balance)::float AS saldo
         FROM core.kassenjournal WHERE betrieb_key = $1`, [b])
    expect(j).toEqual({ n: 36, tage: 3, ust: [0, 7, 19], mit_zusatz: 0, saldo: 0 })

    // Die Girocardzahlung um 01:30 der Nacht gehört zum Vortag, Stunde 1.
    const { rows: [nacht] } = await db.query(
      `SELECT geschaeftstag::text AS tag, stunde,
              (zeitpunkt AT TIME ZONE 'Europe/Berlin')::date::text AS kalendertag
         FROM core.kassenjournal WHERE betrieb_key = $1 AND geschaeftstag = $2 AND finanzweg = 48`, [b, d[1]])
    expect(nacht).toEqual({ tag: d[1], stunde: 1, kalendertag: d[0] })

    // Die Finanzwegsummen im selben Zug.
    const { rows: fw } = await db.query(
      `SELECT finanzweg, zeilen, balance::float AS balance, zeilen_artikel, bons, rabatt_zeilen,
              rabatt_balance::float AS rabatt, storno_zeilen
         FROM core.kassenjournal_finanzweg_tag WHERE betrieb_key = $1 AND geschaeftstag = $2
        ORDER BY finanzweg`, [b, d[1]])
    expect(fw.find(f => f.finanzweg === 1)).toEqual(
      { finanzweg: 1, zeilen: 6, balance: 34.44, zeilen_artikel: 5, bons: 3, rabatt_zeilen: 1, rabatt: -3.86, storno_zeilen: 0 })
    expect(fw.find(f => f.finanzweg === 10)).toMatchObject({ zeilen: 1, balance: -5.5, storno_zeilen: 1 })
    expect(fw.map(f => f.finanzweg)).toEqual([1, 10, 20, 22, 23, 48, 2700])

    // Bons: vier, einer ohne Buchung; Debitorentext liegt in core.
    const { rows: [bon] } = await db.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE accounting_type = 'EMPTY')::int AS leer,
              count(debitor_text)::int AS debitor, count(zip_code)::int AS plz, max(stunde) AS spaet
         FROM core.kassenbon WHERE betrieb_key = $1 AND geschaeftstag = $2`, [b, d[1]])
    expect(bon).toEqual({ n: 4, leer: 1, debitor: 1, plz: 1, spaet: 22 })

    // Personalkosten je Tag: die Summe aus dem verdichteten Rohsatz.
    const { rows: [pk] } = await db.query(
      `SELECT personen, h_brutto::float AS h, lohnkosten::float AS lk FROM core.personalkosten_tag
        WHERE betrieb_key = $1 AND geschaeftstag = $2`, [b, d[1]])
    expect(pk).toEqual({ personen: 4, h: 30.08, lk: 625.85 })

    // Nichts auffällig, alles in core.
    for (const ep of ['tpapi:journal', 'tpapi:journaltables', 'tpapi:personalkostenprotag']) {
      const a = await abruf(P, ep, d[1]!)
      expect(a).toMatchObject({ core_stand: 1, ladefehler: null, core_auffaellig: null })
      expect(await stand(ep)).toMatchObject({ in_core: 3, wartend: 0, ladefehler: 0 })
    }

    // Artikelstamm, mit den Warengruppennamen am Artikel (die doppelte id 2 in
    // grosscategory: der erste Eintrag gilt).
    const { rows: art } = await db.query(
      `SELECT artikelnummer::int AS nr, warengruppe, kategorie, hauptgruppe, fixedwe::float AS we, aktiv, zusatz
         FROM core.tpapi_artikel WHERE betrieb_key = $1 ORDER BY artikelnummer`, [b])
    expect(art).toHaveLength(6)
    expect(art[0]).toEqual({ nr: 300200, warengruppe: 'Heissgetraenke', kategorie: 'Getraenke warm',
                             hauptgruppe: 'Getränke', we: 0.57, aktiv: true, zusatz: null })
    expect(art[1]!.hauptgruppe).toBe('Speisen')
    const { rows: [st] } = await db.query(
      `SELECT (SELECT count(*) FROM core.tpapi_finanzweg WHERE betrieb_key = $1)::int AS fw,
              (SELECT count(*) FROM core.tpapi_finanzkategorie WHERE betrieb_key = $1)::int AS kat,
              (SELECT count(*) FROM core.tpapi_stammliste WHERE betrieb_key = $1 AND liste = 'grosscategory')::int AS gross,
              (SELECT count(DISTINCT liste) FROM core.tpapi_stammliste WHERE betrieb_key = $1)::int AS listen,
              (SELECT ist_trinkgeld FROM core.tpapi_finanzweg WHERE betrieb_key = $1 AND nummer = 2700) AS tip`, [b])
    expect(st).toEqual({ fw: 8, kat: 6, gross: 4, listen: 10, tip: true })

    // Prognose: Fenster ab Monatserstem bzw. vor sieben Tagen bis in 14 Tagen;
    // für die Tage ab morgen gibt es einen Vorabwert, für gestern nicht.
    const { rows: [pr] } = await db.query(
      `SELECT count(*)::int AS tage, max(geschaeftstag) - current_date AS voraus,
              count(*) FILTER (WHERE geschaeftstag > current_date AND vorab_netto IS NOT NULL)::int AS vorab,
              count(*) FILTER (WHERE geschaeftstag < current_date AND vorab_netto IS NOT NULL)::int AS vorab_alt
         FROM core.umsatzprognose_tag WHERE betrieb_key = $1`, [b])
    expect(pr.voraus).toBe(14)
    expect(pr.vorab).toBe(14)
    expect(pr.vorab_alt).toBe(0)

    const { rows: [lader] } = await db.query(`SELECT stand, horizont_monate FROM sync.tpapi_core_lader WHERE endpunkt = 'tpapi:journal'`)
    expect(lader).toEqual({ stand: 1, horizont_monate: 24 })
    const { rows: [m] } = await db.query(`SELECT wert FROM sync.merker WHERE schluessel = 'tpapi_core'`)
    expect(m.wert).toMatchObject({ ok: true, phase: 'tagesgeschaeft', ladefehler: 0 })
  })

  test('mart: Deutung an einer Stelle, kein Freitext, lesbar fuer mcp_leser', async () => {
    const { rows: [u] } = await db.query(
      `SELECT sum(betrag_brutto)::float AS saldo,
              sum(betrag_brutto) FILTER (WHERE zeilenart = 'umsatz')::float AS umsatz,
              count(*) FILTER (WHERE ist_zusatz)::int AS zusatz,
              count(DISTINCT geschaeftstag)::int AS tage,
              bool_or(tag_fehleingabe) AS fe
         FROM mart.kassenjournal_position WHERE enc_id = $1 AND geschaeftstag = $2`, [P, d[1]])
    expect(u).toEqual({ saldo: 0, umsatz: MOCK_UMSATZ_BRUTTO, zusatz: 1, tage: 1, fe: false })
    const { rows: arten } = await db.query(
      `SELECT zeilenart, count(*)::int AS n FROM mart.kassenjournal_position
        WHERE enc_id = $1 AND geschaeftstag = $2 GROUP BY 1 ORDER BY 1`, [P, d[1]])
    // core.finanzweg ist auf dem Klon leer: Bar und Girocard kennt die Deutung
    // dann nicht — sie stehen als "unbekannt" da, nicht still als Zahlung.
    expect(Object.fromEntries(arten.map(a => [a.zeilenart, a.n]))).toEqual(
      { statistik: 2, trinkgeld: 1, umsatz: 7, unbekannt: 2 })

    const spalten = async (sicht: string) => (await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'mart' AND table_name = $1`,
      [sicht])).rows.map(r => r.column_name)
    expect(await spalten('kassenjournal_position')).not.toContain('addinfo')
    for (const s of ['debitor_text', 'zip_code']) expect(await spalten('kassenbon')).not.toContain(s)
    const { rows: [bon] } = await db.query(
      `SELECT count(*) FILTER (WHERE abrechnung = 'BILL')::int AS bons, sum(gaeste) FILTER (WHERE abrechnung = 'BILL')::int AS gaeste
         FROM mart.kassenbon WHERE enc_id = $1 AND geschaeftstag = $2`, [P, d[1]])
    expect(bon).toEqual({ bons: 3, gaeste: 7 })

    const { rows: [pt] } = await db.query(
      `SELECT arbeitsstunden::float AS h, kopfzahl_stunden::float AS k, tag_leer FROM mart.personalkosten_tag
        WHERE enc_id = $1 AND geschaeftstag = $2`, [P, d[1]])
    // Stufe 1 hat d[1] im Fenster geholt: Kopfzahlstunden daneben.
    expect(pt.h).toBe(30.08)
    expect(pt.k).toBeGreaterThan(0)
    expect(pt.tag_leer).toBe(false)

    await db.query(`SET ROLE mcp_leser`)
    try {
      for (const sicht of ['kassenjournal_position', 'kassenbon', 'personalkosten_tag', 'umsatzprognose_tag',
                           'kassenartikel', 'kassenjournal_umsatz_abgleich', 'tpapi_core_stand']) {
        const { rows } = await db.query(`SELECT * FROM mart.${sicht} LIMIT 1`)
        expect(rows.length).toBe(1)
      }
      await expect(db.query(`SELECT debitor_text FROM core.kassenbon LIMIT 1`)).rejects.toThrow(/permission denied/)
    } finally {
      await db.query(`RESET ROLE`)
    }
  })

  test('Phase C: der Bestand kommt nach core; vor dem Horizont bleibt er roh', async () => {
    cfg.TPAPI_CORE_MONATE = 1
    starte()
    expect(await nachladen({ client: client() })).toBe('ok')
    // Die TPAPI-Spur hat geholt, der Lader läuft danach ohne Spur.
    expect(await coreC({ ende: () => null })).toBe('ok')
    for (const n of [4, 10, 12]) expect((await abruf(P, 'tpapi:journal', d[n]!)).core_stand).toBe(1)
    // d[70] und d[400] liegen vor dem Horizont: roh gesichert, nicht in core.
    for (const n of [70, 400]) {
      const a = await abruf(P, 'tpapi:journal', d[n]!)
      expect(a.raw_id).not.toBeNull()
      expect(a.core_stand).toBeNull()
    }
    const b = await bk(P)
    const { rows: [n70] } = await db.query(
      `SELECT count(*)::int AS n FROM core.kassenjournal WHERE betrieb_key = $1 AND geschaeftstag = $2`, [b, d[70]])
    expect(n70.n).toBe(0)
    // Personalkosten je Tag haben keinen Horizont.
    expect((await abruf(P, 'tpapi:personalkostenprotag', d[400]!)).core_stand).toBe(1)
    const s = await stand('tpapi:journal')
    expect(s).toMatchObject({ ausserhalb_horizont: 2, wartend: 0, ladefehler: 0 })
    expect(Number(s.bytes_ausserhalb_horizont)).toBeGreaterThan(0)
    // Die Prüfzeile zählt sie nicht als Rückstand.
    const { rows: [pz] } = await db.query(
      `SELECT auffaellig FROM mart.pruefung_uebersicht WHERE pruefung LIKE 'TPAPI: Rohsaetze im Horizont ohne core%'`)
    expect(Number(pz.auffaellig)).toBe(0)

    // Horizont 0 = alles: jetzt kommen sie.
    cfg.TPAPI_CORE_MONATE = 0
    expect(await coreC({ ende: () => null })).toBe('ok')
    expect((await abruf(P, 'tpapi:journal', d[400]!)).core_stand).toBe(1)
    expect(await stand('tpapi:journal')).toMatchObject({ ausserhalb_horizont: 0, horizont_ab: null })
    cfg.TPAPI_CORE_MONATE = 24
  })

  test('Abgleich: Deutung gegen Umsatzbericht, Finanzwege gegen 97, Bons gegen 96, Nachlass', async () => {
    const b = await bk(P)
    // Umsatzbericht: d10 trifft die Deutung, d11 trifft nur "Boniert", d12 fehlt.
    await db.query(
      `INSERT INTO core.umsatzbericht_tag (betrieb_key, geschaeftstag, umsatz_netto, umsatz_brutto, rechnungen, gaeste, quelle)
       VALUES ($1, $2, 25.00, $4, 3, 7, 'umsatzbericht'), ($1, $3, 30.00, 34.44, 3, 6, 'umsatzbericht')`,
      [b, d[10], d[11], MOCK_UMSATZ_BRUTTO])
    // Bericht 97 fuer d10 — mit dem Nachlass als eigenem Finanzweg (so fuehrt 97 ihn).
    await db.query(`SELECT core.partition_anlegen('core.finanzweg_tag'::regclass, $1::date)`, [d[10]])
    await db.query(`SELECT core.partition_anlegen('core.bon'::regclass, $1::date)`, [d[10]])
    for (const [nr, name, gruppe] of [[20, 'Bar', 'Bargeld'], [48, 'Girocard', 'Unbar']] as const) {
      const r = await db.query(
        `INSERT INTO core.finanzweg (nummer, name, finanzgruppe, art, erstmals_gesehen, zuletzt_gesehen)
         VALUES ($1, $2, $3, 'zahlart', current_date, current_date) ON CONFLICT (nummer) DO NOTHING RETURNING nummer`,
        [nr, name, gruppe])
      if (r.rowCount) finanzwegeEingefuegt.push(nr)
    }
    await db.query(
      `INSERT INTO core.finanzweg_tag (geschaeftstag, zeitraum_bis, betrieb_key, bericht, finanzweg_nummer,
                                       finanzweg_name, finanzgruppe, umsatz, anzahl)
       SELECT $2::date, $2::date, $1, 97, nr, name, gruppe, betrag, 1
         FROM (VALUES (1, 'Boniert', 'Umsatz', 34.44), (10, 'Sofortstorno', 'Umsatz', -5.50),
                      (20, 'Bar', 'Bargeld', -20.00), (48, 'Girocard', 'Unbar', -11.00),
                      (2700, 'Trinkgeld', 'Auslagen', 2.06), (22, 'Tischübergabe', 'Statistik', -10.00),
                      (23, 'Tischübernahme', 'Statistik', 10.00), (3500, '10% Glücksrad', 'Rabatt', -3.86))
              AS v(nr, name, gruppe, betrag)`, [b, d[10]])
    await db.query(
      `INSERT INTO core.bon (geschaeftstag, betrieb_key, laufnummer, art, brutto)
       SELECT $2::date, $1, g, 'Rechnung', 10 FROM generate_series(1, 3) g`, [b, d[10]])

    const { rows: u } = await db.query(
      `SELECT geschaeftstag::text AS tag, befund, journal_umsatz_brutto::float AS j,
              differenz_brutto::float AS diff, trifft_nur_boniert, journal_saldo::float AS saldo, vorlaeufig
         FROM mart.kassenjournal_umsatz_abgleich WHERE enc_id = $1 AND geschaeftstag IN ($2, $3, $4)
        ORDER BY geschaeftstag DESC`, [P, d[10], d[11], d[12]])
    expect(u).toEqual([
      { tag: d[10], befund: 'trifft', j: MOCK_UMSATZ_BRUTTO, diff: 0, trifft_nur_boniert: false, saldo: 0, vorlaeufig: false },
      { tag: d[11], befund: 'weicht ab', j: MOCK_UMSATZ_BRUTTO, diff: -5.5, trifft_nur_boniert: true, saldo: 0, vorlaeufig: false },
      { tag: d[12], befund: 'ohne umsatzbericht', j: MOCK_UMSATZ_BRUTTO, diff: null, trifft_nur_boniert: false, saldo: 0, vorlaeufig: false },
    ])

    const { rows: f } = await db.query(
      `SELECT befund, count(*)::int AS n FROM mart.kassenjournal_finanzweg_abgleich
        WHERE enc_id = $1 AND geschaeftstag = $2 GROUP BY 1 ORDER BY 1`, [P, d[10]])
    expect(Object.fromEntries(f.map(x => [x.befund, x.n]))).toEqual({ 'nachlass an der position': 1, trifft: 7 })

    const { rows: [k] } = await db.query(
      `SELECT befund_bons, befund_gaeste, kasse_bons, kasse_gaeste, journal_bons FROM mart.kassenbon_abgleich
        WHERE enc_id = $1 AND geschaeftstag = $2`, [P, d[10]])
    expect(k).toEqual({ befund_bons: 'trifft', befund_gaeste: 'trifft', kasse_bons: 3, kasse_gaeste: 7, journal_bons: 3 })

    const { rows: [n] } = await db.query(
      `SELECT befund, journal_nachlass_zeilen, journal_nachlass_betrag::float AS j FROM mart.kassenjournal_nachlass_abgleich
        WHERE enc_id = $1 AND geschaeftstag = $2`, [P, d[10]])
    expect(n).toEqual({ befund: 'trifft 97', journal_nachlass_zeilen: 1, j: -3.86 })

    // Die Monatssicht: zwei vergleichbare Tage, einer trifft, der Kandidat "nur Boniert" auch einer.
    const { rows: [m] } = await db.query(
      `SELECT sum(tage_vergleichbar)::int AS v, sum(tage_trifft)::int AS t,
              sum(round(kandidat_nur_boniert_pct * tage_vergleichbar / 100))::int AS boniert,
              sum(finanzwege_trifft)::int AS fw
         FROM mart.kassenjournal_abgleich_monat
        WHERE enc_id = $1 AND monat IN (date_trunc('month', $2::date)::date, date_trunc('month', $3::date)::date,
                                        date_trunc('month', $4::date)::date)`, [P, d[10], d[11], d[12]])
    expect(m).toEqual({ v: 2, t: 1, boniert: 1, fw: 7 })

    // Und die Stammpruefung: Finanzweg 20 trifft ueber die Nummer.
    const { rows: [fs] } = await db.query(
      `SELECT befund, name_kasse_nummer, name_bericht_97 FROM mart.kassenjournal_finanzweg_stamm
        WHERE enc_id = $1 AND finanzweg = 20`, [P])
    expect(fs).toEqual({ befund: 'nummer trifft', name_kasse_nummer: 'Bar', name_bericht_97: 'Bar' })
    const { rows: [sp] } = await db.query(
      `SELECT sum(positionen_mit_artnr)::int AS n, sum(im_kassenstamm)::int AS im
         FROM mart.kassenjournal_stamm_pruefung WHERE enc_id = $1 AND monat = date_trunc('month', $2::date)::date`, [P, d[10]])
    expect(sp.n).toBeGreaterThan(0)
    expect(sp.im).toBe(sp.n)
  })

  test('Kassen-Fehleingabe: der Tag ist sichtbar, keine Summe laeuft still durch', async () => {
    cfg.TPAPI_SCHLUESSEL = { [F]: SCHLUESSEL[F] }
    ueberschreiben = (pfad, enc, bd) => {
      if (pfad !== 'revenue/journal' || enc !== F) return undefined
      const z = journalZeilen(bd!)
      const bar = { ...z[8]!, ID: 999001, balance: -5_000_000, preis: -5_000_000 }
      const tip = { ...z[7]!, ID: 999002, balance: 5_000_000, preis: 5_000_000 }
      return [...z, bar, tip]
    }
    starte()
    await nachlauf()
    ueberschreiben = undefined
    const { rows: fe } = await db.query(
      `SELECT regel, finanzweg, betrag::float AS betrag FROM mart.kassenjournal_fehleingabe
        WHERE betrieb_key = (SELECT betrieb_key FROM core.betrieb WHERE enc_id = $1) AND geschaeftstag = $2
        ORDER BY finanzweg`, [F, d[2]])
    expect(fe).toEqual([
      { regel: 'journal: betrag absurd', finanzweg: 20, betrag: -5_000_020 },
      { regel: 'journal: betrag absurd', finanzweg: 2700, betrag: 5_000_002.06 },
    ])
    const { rows: [u] } = await db.query(
      `SELECT befund, journal_umsatz_brutto::float AS j FROM mart.kassenjournal_umsatz_abgleich
        WHERE enc_id = $1 AND geschaeftstag = $2`, [F, d[2]])
    expect(u).toEqual({ befund: 'fehleingabe', j: MOCK_UMSATZ_BRUTTO })
    const { rows: [p] } = await db.query(
      `SELECT bool_and(tag_fehleingabe) AS fe FROM mart.kassenjournal_position WHERE enc_id = $1 AND geschaeftstag = $2`, [F, d[2]])
    expect(p.fe).toBe(true)
  })

  test('Ladefehler: drei Versuche, dann endgueltig — sichtbar; ein neuer Rohsatz versucht es wieder', async () => {
    cfg.TPAPI_SCHLUESSEL = { [X]: SCHLUESSEL[X] }
    ueberschreiben = (pfad, enc, bd) => {
      if (pfad !== 'revenue/journal' || enc !== X) return undefined
      const z = journalZeilen(bd!)
      delete (z[3] as any).finanzweg   // eine Zeile ohne Finanzweg laesst sich nicht deuten
      return z
    }
    starte()
    expect(await nachlauf()).toBe('teilweise')
    let a = await abruf(X, 'tpapi:journal', d[1]!)
    expect(a).toMatchObject({ core_stand: null, ladeversuche: 1, ladefehler_stand: 1 })
    expect(a.ladefehler).toContain('finanzweg')
    expect(await coreA()).toBe('teilweise')
    expect(await coreA()).toBe('teilweise')
    a = await abruf(X, 'tpapi:journal', d[1]!)
    expect(a.ladeversuche).toBe(3)
    // Alle drei Fenstertage von X tragen die kaputte Zeile.
    expect(await stand('tpapi:journal')).toMatchObject({ ladefehler: 0, ladefehler_endgueltig: 3 })
    // Ein vierter Lauf versucht es nicht mehr.
    const am = a.ladefehler_am
    expect(await coreA()).toBe('ok')
    a = await abruf(X, 'tpapi:journal', d[1]!)
    expect(a.ladeversuche).toBe(3)
    expect(a.ladefehler_am).toEqual(am)
    const { rows: [pz] } = await db.query(
      `SELECT auffaellig FROM mart.pruefung_uebersicht WHERE pruefung = 'TPAPI: Ladefehler raw -> core'`)
    expect(Number(pz.auffaellig)).toBe(3)
    // Und fuer mcp_leser lesbar, mit Grund — ohne core.
    await db.query(`SET ROLE mcp_leser`)
    try {
      const { rows: bf } = await db.query(
        `SELECT befund, ladefehler, ladeversuche FROM mart.tpapi_core_befund WHERE enc_id = $1 AND endpunkt = 'tpapi:journal'`, [X])
      expect(bf).toHaveLength(3)
      expect(bf.every(r => r.befund === 'ladefehler endgueltig' && r.ladeversuche === 3 && /finanzweg/.test(r.ladefehler))).toBe(true)
    } finally {
      await db.query(`RESET ROLE`)
    }

    // LINA liefert den Tag neu (anderer Inhalt) — der Lader versucht es wieder, und es gelingt.
    ueberschreiben = undefined
    starte()
    expect(await nachlauf()).toBe('ok')
    a = await abruf(X, 'tpapi:journal', d[1]!)
    expect(a).toMatchObject({ core_stand: 1, ladefehler: null, ladeversuche: 0 })
    expect(await stand('tpapi:journal')).toMatchObject({ ladefehler_endgueltig: 0 })
  })

  test('Laderstand: ein alter core_stand wartet und wird neu geladen; in_core zaehlt nur den aktuellen', async () => {
    const vorher = (await db.query(`SELECT in_core FROM mart.tpapi_abruf_stand WHERE endpunkt = 'tpapi:journal'`)).rows[0].in_core
    await db.query(
      `UPDATE core.tpapi_abruf x SET core_stand = 0 FROM core.betrieb b
        WHERE b.betrieb_key = x.betrieb_key AND b.enc_id = $1 AND x.endpunkt = 'tpapi:journal' AND x.geschaeftstag = $2`,
      [P, d[1]])
    expect((await db.query(`SELECT in_core FROM mart.tpapi_abruf_stand WHERE endpunkt = 'tpapi:journal'`)).rows[0].in_core)
      .toBe(vorher - 1)
    expect((await stand('tpapi:journal')).wartend).toBe(1)
    expect(await coreA()).toBe('ok')
    expect((await abruf(P, 'tpapi:journal', d[1]!)).core_stand).toBe(1)
    expect((await stand('tpapi:journal')).wartend).toBe(0)
  })

  test('Prognose: der Vorabwert bleibt sichtbar, eine Aenderung wird gezaehlt, die Historie kommt monatsweise', async () => {
    cfg.TPAPI_SCHLUESSEL = { [P]: SCHLUESSEL[P] }
    const b = await bk(P)
    const morgen = d[0] === '' ? '' : (await db.query(`SELECT (current_date + 1)::text AS t`)).rows[0].t
    const { rows: [alt] } = await db.query(
      `SELECT prognose_netto::float AS p FROM core.umsatzprognose_tag WHERE betrieb_key = $1 AND geschaeftstag = $2`, [b, morgen])
    ueberschreiben = (pfad, enc, _bd, par) => pfad === 'revenue/getforecastperday' && enc === P
      ? prognoseZeilen(par.get('from')!, par.get('to')!).map(z => ({ ...z, forecast: (z.forecast as number) + 100 }))
      : undefined
    starte()
    await nachlauf()
    ueberschreiben = undefined
    const { rows: [neu] } = await db.query(
      `SELECT prognose_netto::float AS p, vorab_netto::float AS v, erste_prognose_netto::float AS e, aenderungen
         FROM core.umsatzprognose_tag WHERE betrieb_key = $1 AND geschaeftstag = $2`, [b, morgen])
    expect(neu).toEqual({ p: alt.p + 100, v: alt.p + 100, e: alt.p, aenderungen: 1 })

    // Die Monate der Historie: Phase C hat sie geholt (Test "Phase C"), der Lader geladen.
    const { rows: [r] } = await db.query(
      `SELECT count(*)::int AS n FROM mart.umsatzprognose_rueckstand WHERE enc_id = $1`, [P])
    expect(r.n).toBe(0)
    const { rows: [h] } = await db.query(
      `SELECT count(*)::int AS tage, bool_and(prognose_grundlage = 'nachtraeglich') AS nachtraeglich,
              count(DISTINCT s.abzug_id)::int AS abzuege
         FROM mart.umsatzprognose_tag p
         JOIN core.tpapi_stammabzug s ON s.betrieb_key = p.betrieb_key AND s.endpunkt = 'tpapi:getforecastperday'
                                     AND p.geschaeftstag BETWEEN s.von AND s.bis
                                     AND s.von = date_trunc('month', $2::date)::date
        WHERE p.enc_id = $1 AND p.monat = date_trunc('month', $2::date)::date`, [P, d[400]])
    expect(h.tage).toBeGreaterThanOrEqual(28)
    expect(h.nachtraeglich).toBe(true)
    expect(h.abzuege).toBe(1)
  })

  test('Personal je Stunde: Phase C holt bis zur Tiefe von listdays, ohne kostUser', async () => {
    cfg.TPAPI_SCHLUESSEL = { [P]: SCHLUESSEL[P] }
    const { rows: [vor] } = await db.query(
      `SELECT count(*) FILTER (WHERE arbeitsliste = 'listdays')::int AS tief, count(*)::int AS alle
         FROM mart.personal_rueckstand WHERE enc_id = $1`, [P])
    expect(vor.tief).toBe(1)          // d[400], weiter zurueck als die 365 Tage
    expect(vor.alle).toBeGreaterThan(300)
    cfg.TPAPI_STUNDE_NACHLADEN = 1
    starte()
    // Ein Betrieb mit ~370 Aufrufen: die gleitende Grenze hier aus dem Weg (sie hat eigene Tests).
    expect(await nachladen({ client: client(100_000) })).toBe('ok')
    cfg.TPAPI_STUNDE_NACHLADEN = 0
    const stunde = mock.aufrufe.filter(a => a.pfad === '/extern/personal/personalkostenprostunde')
    expect(stunde.length).toBe(vor.alle)
    expect(stunde.some(a => a.businessdate === alsBd(d[400]!))).toBe(true)
    // Neueste zuerst.
    const iso = stunde.map(a => a.businessdate!.split('.').reverse().join('-'))
    expect([...iso].sort().reverse()).toEqual(iso)
    const { rows: [nach] } = await db.query(`SELECT count(*)::int AS n FROM mart.personal_rueckstand WHERE enc_id = $1`, [P])
    expect(nach.n).toBe(0)
    const { rows: [m] } = await db.query(`SELECT wert FROM sync.merker WHERE schluessel = 'tpapi_personal'`)
    expect(m.wert).toMatchObject({ ok: true, phase: 'nachladen' })
    const { rows: [raw] } = await db.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE payload::text LIKE '%kostUser%')::int AS mit
         FROM raw.api_antwort WHERE endpunkt = 'tpapi:personalkostenprostunde' AND betrieb_enc_id = $1`, [P])
    expect(raw.n).toBeGreaterThan(300)
    expect(raw.mit).toBe(0)
  }, 120_000)

  test('Zulauf in core je Zieltabelle, und kein Schluessel im Log', async () => {
    const { quellenSpiegeln } = await import('../sync/quellen')
    expect(await quellenSpiegeln()).toBeGreaterThan(0)
    const { rows } = await db.query(
      `SELECT quelle, zustand FROM mart.quelle_zulauf WHERE quelle LIKE 'tpapi:core_%' ORDER BY quelle`)
    expect(Object.fromEntries(rows.map(r => [r.quelle, r.zustand]))).toEqual({
      'tpapi:core_artikelstamm': 'ok', 'tpapi:core_bons': 'ok', 'tpapi:core_journal': 'ok',
      'tpapi:core_personal_tag': 'ok', 'tpapi:core_prognose': 'ok',
    })
    expect(logs.some(l => l.includes('tpapi core tagesgeschaeft'))).toBe(true)
    expect(logs.some(l => l.includes('tpapi core nachladen'))).toBe(true)
    for (const s of Object.values(SCHLUESSEL)) expect(logs.join('\n')).not.toContain(s)
    const { rows: [l] } = await db.query(
      `SELECT string_agg(coalesce(ladefehler, ''), ' ') AS t FROM core.tpapi_abruf`)
    for (const s of Object.values(SCHLUESSEL)) expect(l.t ?? '').not.toContain(s)
  })
})
