/**
 * Betriebsberichte gegen eine echte Datenbank: Lader, Gegenprobe, Einreihweg,
 * Worker mit Attrappe (Migrationen 0113–0115).
 *
 * Übersprungen ohne TEST_DATABASE_URL. Die Datei macht TRUNCATE über die
 * Warteschlange, raw, den Umsatzbericht und alle Betriebsbericht-Tabellen —
 * sie braucht eine EIGENE Testdatenbank (Schema-Klon, siehe
 * docs/offene-punkte.md), nie die, auf die DATABASE_URL zeigt. Immer die
 * ganze Datei laufen lassen, nie mit -t (die Notbremse sitzt im ersten
 * beforeAll — Notiz „e2e-Test mit -t trifft Produktiv-DB").
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from 'pg'
import { readFileSync } from 'node:fs'
import { mockStarten } from '../lina/mock'

const DB = process.env.TEST_DATABASE_URL

if (DB && process.env.DATABASE_URL && DB === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL zeigt auf dieselbe Datenbank wie DATABASE_URL — '
    + 'diese Datei macht TRUNCATE. Eine eigene Testdatenbank anlegen.')
}

const lauf = DB ? describe : describe.skip

const fixture = (name: string) => JSON.parse(readFileSync(
  new URL(`../transform/fixtures/betriebsbericht/${name}`, import.meta.url), 'utf8'))

const TABELLEN = `sync.warteschlange, sync.aufgabe, sync.lauf, sync.schema_abweichung,
  raw.api_antwort, core.umsatzbericht_tag, core.artikelverkauf_tag,
  core.betriebsbericht_abruf, core.bericht_hinweis, core.finanzweg, core.finanzweg_stand,
  core.finanzweg_tag, core.rabatt_artikel_tag, core.bon, core.tagesabschluss_tag,
  core.storno_artikel_monat, core.monatsaufstellung_tag, core.verkaufszahlen_tag,
  core.unbar_zahlung_monat, core.kellner_umsatz_monat, core.kellner_umsatz_tag,
  core.kellner_artikel_monat, core.gutschrift_kellner, core.betriebsstelle_umsatz_monat,
  core.betriebsstelle_hauptsparte_monat, core.verkaufsstelle_umsatz_monat,
  core.verkaufsstelle_hauptsparte_monat, core.zeitzone_feinsparte_monat,
  core.zeitzone_hauptsparte_monat, core.debitor_bon, core.tischtransfer_bon`

lauf('Betriebsberichte mit Datenbank', () => {
  let db: Client
  let mock: ReturnType<typeof mockStarten>
  let cfg: any
  const betrieb = new Map<string, number>()

  beforeAll(async () => {
    mock = mockStarten({ betriebsberichte: { leer: [39], zuGrossAbTagen: { 96: 3 } } })
    process.env.LINA_BASE_URL = mock.url
    process.env.LINA_USER = 'testuser'
    process.env.LINA_PASSWORD = 'geheim'
    process.env.DATABASE_URL = DB!
    process.env.TAKT_MIN_MS = '0'
    process.env.TAKT_MAX_MS = '0'
    process.env.FN_TAKT_MIN_MS = '0'
    process.env.FN_TAKT_MAX_MS = '0'
    process.env.HISTORIE_JE_LAUF = '0'
    process.env.NULLTAGE_JE_LAUF = '0'
    process.env.LOCHTAGE_JE_LAUF = '0'
    process.env.NACHLESE_JE_LAUF = '0'
    process.env.LOG_LEVEL ??= 'error'
    const { config } = await import('../config')
    if (config.DATABASE_URL !== DB) {
      throw new Error('config wurde vorher mit einer anderen DATABASE_URL geladen — '
        + 'diese Datei einzeln starten: bun test src/sync/betriebsbericht.test.ts')
    }
    cfg = config
    // Die Attrappe gilt fuer diese Datei, gleich was die .env sagt.
    cfg.LINA_BASE_URL = mock.url
    cfg.TAKT_MIN_MS = 0
    cfg.TAKT_MAX_MS = 0
    db = new Client({ connectionString: DB })
    await db.connect()
    await db.query(`TRUNCATE ${TABELLEN} RESTART IDENTITY`)
    // Testbetriebe: die 15 Wilma-Wunder-Antworten aus 92 und Duesseldorf fuer den Rest.
    const r92 = fixture('report92-wilma-2026-08.json') as { betriebe: { encId: string; name: string }[] }
    for (const b of [...r92.betriebe, { encId: 'test-duesseldorf', name: 'Test Duesseldorf' },
                     { encId: 'test-a', name: 'Test A' }, { encId: 'test-b', name: 'Test B' }]) {
      const r = await db.query(
        `INSERT INTO core.betrieb (enc_id, name) VALUES ($1, $2)
         ON CONFLICT (enc_id) DO UPDATE SET name = excluded.name RETURNING betrieb_key`,
        [b.encId, `${b.name} (Test ${b.encId})`])
      betrieb.set(b.encId, Number(r.rows[0].betrieb_key))
    }
  })

  afterAll(async () => { mock?.stop(); await db?.end() })

  const ladenMit = async (key: string, encId: string, von: string, bis: string, daten: unknown) => {
    const { laden } = await import('./laden')
    const { endpunkt } = await import('../lina/endpunkte')
    return laden({
      ep: endpunkt(key), von, bis, parameter: {}, daten, httpStatus: 200, bytes: 0,
      hash: 'test', laufId: '0', betriebEncId: encId,
    })
  }

  // -----------------------------------------------------------------------
  // Abnahme M1 durch den Lader
  // -----------------------------------------------------------------------

  test('M1: die Glücksrad-Zahlen kommen genau so aus core.rabatt_artikel_tag', async () => {
    const r92 = fixture('report92-wilma-2026-08.json') as { betriebe: { encId: string; antwort: unknown }[] }
    for (const b of r92.betriebe) {
      // Doppelt kodiert, wie LINA es liefert — der Lader packt selbst aus.
      await ladenMit('getReport:92', b.encId, '2026-08-01', '2026-08-31', JSON.stringify(b.antwort))
    }
    const { rows } = await db.query(`
      SELECT substring(finanzweg_name from '(\\d+)\\s*%')::int AS prozent,
             sum(anzahl)::int AS stueck,
             sum(anzahl) FILTER (WHERE artikel_name = 'Durchstarter')::int AS durchstarter
        FROM core.rabatt_artikel_tag
       WHERE finanzweg_name LIKE '%Glücksrad%' AND artikel_name IS NOT NULL
         AND geschaeftstag = '2026-08-01' AND zeitraum_bis = '2026-08-31'
       GROUP BY 1 ORDER BY 1`)
    expect(rows).toEqual([
      { prozent: 10, stueck: 149, durchstarter: 12 },
      { prozent: 25, stueck: 1413, durchstarter: 107 },
      { prozent: 50, stueck: 7335, durchstarter: 432 },
    ])
    const { rows: [a] } = await db.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE n_bills > 0)::int AS mit
         FROM core.betriebsbericht_abruf WHERE endpunkt = 'getReport:92'`)
    expect(a).toEqual({ n: 15, mit: 14 })
    // Die Kopfsummen stimmen: keine Strukturabweichung gemeldet.
    const { rows: [s] } = await db.query(
      `SELECT count(*)::int AS n FROM sync.schema_abweichung WHERE endpunkt = 'getReport:92'`)
    expect(s.n).toBe(0)
  })

  test('ein zweiter Abruf ersetzt den Zeitraum, statt anzuhängen', async () => {
    const r92 = fixture('report92-wilma-2026-08.json') as { betriebe: { encId: string; antwort: unknown }[] }
    const b = r92.betriebe[1]!
    const vorher = await db.query(`SELECT count(*)::int AS n FROM core.rabatt_artikel_tag`)
    await ladenMit('getReport:92', b.encId, '2026-08-01', '2026-08-31', b.antwort)
    const nachher = await db.query(`SELECT count(*)::int AS n FROM core.rabatt_artikel_tag`)
    expect(nachher.rows[0].n).toBe(vorher.rows[0].n)
    const { rows: [a] } = await db.query(
      `SELECT abrufe FROM core.betriebsbericht_abruf a JOIN core.betrieb b USING (betrieb_key)
        WHERE endpunkt = 'getReport:92' AND b.enc_id = $1`, [b.encId])
    expect(a.abrufe).toBe(2)
  })

  // -----------------------------------------------------------------------
  // Finanzwege, Stamm, Nummernauflösung, 88 gegen 97
  // -----------------------------------------------------------------------

  test('88 und 97: Stamm, Tageswerte, und 92 bekommt seine Finanzwegnummern', async () => {
    const enc = 'test-duesseldorf'
    await ladenMit('getReport:92', enc, '2026-08-01', '2026-08-31',
      (fixture('report92-wilma-2026-08.json').betriebe as any[]).find(b => b.name.includes('Düsseldorf')).antwort)
    // Vor 88/97: die Nummern sind noch unbekannt.
    const vor = await db.query(
      `SELECT count(*) FILTER (WHERE finanzweg_nummer IS NOT NULL)::int AS n FROM core.rabatt_artikel_tag
        WHERE betrieb_key = $1`, [betrieb.get(enc)])
    expect(vor.rows[0].n).toBe(0)

    await ladenMit('getReport:88', enc, '2026-08-01', '2026-08-31', fixture('report88-duesseldorf-2026-08.json').antwort)
    await ladenMit('getReport:97', enc, '2026-08-01', '2026-08-31', fixture('report97-duesseldorf-2026-08.json').antwort)

    const { rows: stamm } = await db.query(
      `SELECT nummer, name, art, prozentsatz::float AS p FROM core.finanzweg
        WHERE nummer IN (3168, 3500, 3501, 3502) ORDER BY nummer`)
    expect(stamm).toEqual([
      { nummer: 3168, name: '25% Glücksrad', art: 'nachlass', p: 25 },
      { nummer: 3500, name: '10% Glücksrad', art: 'nachlass', p: 10 },
      { nummer: 3501, name: "25% Glücksrad'", art: 'nachlass', p: 25 },
      { nummer: 3502, name: '50% Glücksrad', art: 'nachlass', p: 50 },
    ])
    // 97: je Tag ein Block, 31 Tage, und die Summe der Tage trifft 88.
    const { rows: [t] } = await db.query(
      `SELECT count(DISTINCT geschaeftstag)::int AS tage,
              round(sum(umsatz) FILTER (WHERE finanzweg_nummer = 3502), 2)::float AS u3502,
              sum(anzahl) FILTER (WHERE finanzweg_nummer = 3502)::int AS a3502
         FROM core.finanzweg_tag WHERE bericht = 97 AND betrieb_key = $1`, [betrieb.get(enc)])
    expect(t).toEqual({ tage: 31, u3502: -4281.5, a3502: 600 })
    const { rows: [sp] } = await db.query(
      `SELECT round(sum(brutto), 2)::float AS s FROM core.tagesabschluss_tag WHERE betrieb_key = $1`,
      [betrieb.get(enc)])
    expect(sp.s).toBe(369841.09)
    // Die Nummern an den Rabattzeilen, ueber den Namen — beide 25-%-Wege getrennt.
    const { rows: nr } = await db.query(
      `SELECT DISTINCT finanzweg_name, finanzweg_nummer FROM core.rabatt_artikel_tag
        WHERE betrieb_key = $1 AND finanzweg_name LIKE '%Glücksrad%' ORDER BY 2`, [betrieb.get(enc)])
    expect(nr).toEqual([
      { finanzweg_name: '25% Glücksrad', finanzweg_nummer: 3168 },
      { finanzweg_name: '10% Glücksrad', finanzweg_nummer: 3500 },
      { finanzweg_name: "25% Glücksrad'", finanzweg_nummer: 3501 },
      { finanzweg_name: '50% Glücksrad', finanzweg_nummer: 3502 },
    ])
  })

  // -----------------------------------------------------------------------
  // Die Gegenprobe
  // -----------------------------------------------------------------------

  test('Gegenprobe: ohne Umsatzbericht nichts zu prüfen, mit ihm ok — und eine Abweichung wird nachgeholt', async () => {
    const enc = 'test-duesseldorf'
    const bk = betrieb.get(enc)!
    const befund = async () => (await db.query(
      `SELECT befund, nachholen FROM mart.betriebsbericht_gegenprobe
        WHERE endpunkt = 'getReport:88' AND betrieb_key = $1`, [bk])).rows[0]
    expect((await befund()).befund).toBe('ohne Konzernzahl')

    // Der Umsatzbericht des Monats: 31 Tage, zusammen genau LINAs Summe.
    const h = fixture('report97-duesseldorf-2026-08.json').antwort
    const { berichtEntpacken, tagesabschlussSparten } = await import('../transform/betriebsbericht')
    const jeTag = new Map<string, number>()
    for (const z of tagesabschlussSparten(berichtEntpacken(h))) {
      jeTag.set(z.geschaeftstag, (jeTag.get(z.geschaeftstag) ?? 0) + z.brutto)
    }
    for (const [tag, brutto] of jeTag) {
      await db.query(
        `INSERT INTO core.umsatzbericht_tag (betrieb_key, geschaeftstag, umsatz_brutto, umsatz_netto, rechnungen)
         VALUES ($1, $2, round($3::numeric, 2), round($3::numeric / 1.12, 2), 100)`, [bk, tag, brutto])
    }
    expect(await befund()).toEqual({ befund: 'ok', nachholen: null })

    // Ein Tag fehlt im Bericht (zu früh geholt) → Abweichung. Frisch geholt
    // wartet sie eine Woche, danach ist sie fällig und wird neu eingereiht.
    await db.query(`UPDATE core.betriebsbericht_abruf SET balance_brutto = balance_brutto - 22282.34
                     WHERE endpunkt = 'getReport:88' AND betrieb_key = $1`, [bk])
    expect(await befund()).toEqual({ befund: 'abweichung', nachholen: 'wartet' })
    await db.query(`UPDATE core.betriebsbericht_abruf SET zuletzt_abgerufen_am = now() - interval '8 days'
                     WHERE endpunkt = 'getReport:88' AND betrieb_key = $1`, [bk])
    expect(await befund()).toEqual({ befund: 'abweichung', nachholen: 'faellig' })

    const { betriebsberichteNachfuellen } = await import('./nachfuellen')
    await db.query(`TRUNCATE sync.warteschlange`)
    await betriebsberichteNachfuellen('2026-09-22')
    // Nachgeholt wird genau der abgerufene Zeitraum, mit Nacharbeit-Prioritaet.
    // (Daneben reiht der Producer die Tage des Monats als Erstabruf ein — der
    // Umsatzbericht oben macht sie zu Tagen mit Umsatz.)
    const { rows: [p] } = await db.query(
      `SELECT prioritaet, zeitraum_von::text, zeitraum_bis::text FROM sync.warteschlange
        WHERE endpunkt = 'getReport:88' AND betrieb_enc_id = $1 AND zeitraum_bis = '2026-08-31'`, [enc])
    expect(p).toEqual({ prioritaet: 50, zeitraum_von: '2026-08-01', zeitraum_bis: '2026-08-31' })
    const { rows: [n] } = await db.query(
      `SELECT nachgeholt FROM core.betriebsbericht_abruf WHERE endpunkt = 'getReport:88' AND betrieb_key = $1`, [bk])
    expect(n.nachgeholt).toBe(1)
    // Dreimal nachgeholt → aufgegeben, sichtbar.
    await db.query(`UPDATE core.betriebsbericht_abruf SET nachgeholt = 3
                     WHERE endpunkt = 'getReport:88' AND betrieb_key = $1`, [bk])
    expect((await befund()).nachholen).toBe('aufgegeben')
  })

  // -----------------------------------------------------------------------
  // Der Einreihweg
  // -----------------------------------------------------------------------

  test('Einreihen: je Betrieb, nach Fensterklasse, reif, neueste zuerst, Vereinigung beider Treiber', async () => {
    const { betriebsberichteNachfuellen } = await import('./nachfuellen')
    await db.query(`TRUNCATE sync.warteschlange, core.umsatzbericht_tag, core.artikelverkauf_tag, core.betriebsbericht_abruf`)
    const a = betrieb.get('test-a')!, b = betrieb.get('test-b')!
    // Umsatz: A am 15.07. und 10./11.08., B am 11.08. — und B am 12.08. NUR im Artikelverkauf.
    for (const [bk, tag] of [[a, '2026-07-15'], [a, '2026-08-10'], [a, '2026-08-11'], [b, '2026-08-11']] as const) {
      await db.query(
        `INSERT INTO core.umsatzbericht_tag (betrieb_key, geschaeftstag, umsatz_netto, rechnungen)
         VALUES ($1, $2, 1000, 50)`, [bk, tag])
    }
    const art = await db.query(`SELECT artikel_key FROM core.artikel LIMIT 1`)
    let artikelKey = art.rows[0]?.artikel_key
    if (!artikelKey) {
      artikelKey = (await db.query(
        `INSERT INTO core.artikel (artikelnummer, name) VALUES (999999, 'Testartikel') RETURNING artikel_key`)).rows[0].artikel_key
    }
    await db.query(`SELECT core.partition_anlegen('core.artikelverkauf_tag', '2026-08-01')`)
    await db.query(
      `INSERT INTO core.artikelverkauf_tag (betrieb_key, geschaeftstag, artikel_key, menge, umsatz_netto)
       VALUES ($1, '2026-08-12', $2, 3, 30)`, [b, artikelKey])

    // Heute = 17.08.: reif ist, was vor dem 10.08. endet.
    cfg.BETRIEBSBERICHT_JE_LAUF = 100000
    await betriebsberichteNachfuellen('2026-08-17')
    const einheiten = async (key: string) => (await db.query(
      `SELECT betrieb_enc_id AS b, zeitraum_von::text AS von, zeitraum_bis::text AS bis
         FROM sync.warteschlange WHERE endpunkt = $1 ORDER BY zeitraum_von, betrieb_enc_id`, [key])).rows
    expect(await einheiten('getReport:92')).toEqual([
      { b: 'test-a', von: '2026-07-15', bis: '2026-07-15' },
      { b: 'test-a', von: '2026-08-10', bis: '2026-08-10' },
    ])
    expect(await einheiten('getReport:96')).toEqual([
      { b: 'test-a', von: '2026-07-13', bis: '2026-07-19' },
    ])
    expect(await einheiten('getReport:97')).toEqual([
      { b: 'test-a', von: '2026-07-01', bis: '2026-07-31' },
    ])

    // Eine Woche spaeter: der Rest ist reif — auch der Tag, den nur der Artikelverkauf kennt.
    await betriebsberichteNachfuellen('2026-09-22')
    expect(await einheiten('getReport:92')).toEqual([
      { b: 'test-a', von: '2026-07-15', bis: '2026-07-15' },
      { b: 'test-a', von: '2026-08-10', bis: '2026-08-10' },
      { b: 'test-a', von: '2026-08-11', bis: '2026-08-11' },
      { b: 'test-b', von: '2026-08-11', bis: '2026-08-11' },
      { b: 'test-b', von: '2026-08-12', bis: '2026-08-12' },
    ])
    expect(await einheiten('getReport:96')).toEqual([
      { b: 'test-a', von: '2026-07-13', bis: '2026-07-19' },
      { b: 'test-a', von: '2026-08-10', bis: '2026-08-16' },
      { b: 'test-b', von: '2026-08-10', bis: '2026-08-16' },
    ])
    // Nichts doppelt.
    expect(await betriebsberichteNachfuellen('2026-09-22')).toBe(0)
  })

  /**
   * Tagesgeschäft oder Nachladen (0116, Entscheidung 23.09.2026): laufend
   * sind nur Tages- und Wochenberichte, deren Zeitraum in den letzten
   * BETRIEBSBERICHT_LAUFEND_TAGE (21) endet. Liest den Stand, den der Test
   * darüber hinterlassen hat — beide Aufrufe (17.08. und 22.09.).
   */
  test('Einreihen: laufende Tages- und Wochenberichte sind Tagesgeschäft, alles andere Nachladen', async () => {
    const { rows } = await db.query(
      `SELECT endpunkt || ' ' || betrieb_enc_id || ' ' || zeitraum_von::text AS e, nachladen
         FROM sync.warteschlange
        WHERE endpunkt IN ('getReport:92', 'getReport:96', 'getReport:97')
        ORDER BY 1`)
    const n = Object.fromEntries(rows.map(r => [r.e, r.nachladen]))
    // Am 17.08. eingereiht: Grenze 27.07.
    expect(n['getReport:92 test-a 2026-08-10']).toBe(false)
    expect(n['getReport:92 test-a 2026-07-15']).toBe(true)
    expect(n['getReport:96 test-a 2026-07-13']).toBe(true)
    // Monatsberichte sind nie Tagesgeschäft.
    expect(n['getReport:97 test-a 2026-07-01']).toBe(true)
    // Am 22.09. eingereiht: Grenze 01.09. — der August ist dort schon Historie.
    expect(n['getReport:92 test-b 2026-08-12']).toBe(true)
    expect(n['getReport:96 test-b 2026-08-10']).toBe(true)
    // Und mit einem heutigen Datum, das den August laufend macht:
    await db.query(`TRUNCATE sync.warteschlange`)
    const { betriebsberichteNachfuellen } = await import('./nachfuellen')
    await betriebsberichteNachfuellen('2026-08-24')
    const { rows: l } = await db.query(
      `SELECT endpunkt, zeitraum_von::text AS von, nachladen FROM sync.warteschlange
        WHERE betrieb_enc_id = 'test-b' ORDER BY endpunkt, zeitraum_von`)
    expect(l.filter(r => r.endpunkt === 'getReport:92').every(r => r.nachladen === false)).toBe(true)
    expect(l.filter(r => r.endpunkt === 'getReport:97').every(r => r.nachladen === true)).toBe(true)
  })

  test('neueste zuerst: bei knapper Obergrenze kommt der juengste Zeitraum fuer ALLE Betriebe', async () => {
    const { betriebsberichteNachfuellen } = await import('./nachfuellen')
    await db.query(`TRUNCATE sync.warteschlange`)
    cfg.BETRIEBSBERICHT_JE_LAUF = 4
    await betriebsberichteNachfuellen('2026-09-22')
    const { rows } = await db.query(
      `SELECT DISTINCT zeitraum_von::text AS von FROM sync.warteschlange ORDER BY 1`)
    // Nur August — Juli kommt erst, wenn August fuer alle da ist.
    expect(rows.every(r => r.von >= '2026-08-01')).toBe(true)
    // Die Obergrenze zaehlt die offenen mit: ein zweiter Aufruf reiht nichts dazu.
    expect(await betriebsberichteNachfuellen('2026-09-22')).toBe(0)
  })

  test('die Notbremse: 0 reiht nichts ein', async () => {
    const { betriebsberichteNachfuellen } = await import('./nachfuellen')
    await db.query(`TRUNCATE sync.warteschlange`)
    cfg.BETRIEBSBERICHT_JE_LAUF = 0
    expect(await betriebsberichteNachfuellen('2026-09-22')).toBe(0)
    cfg.BETRIEBSBERICHT_JE_LAUF = 100000
  })

  // -----------------------------------------------------------------------
  // Der Worker gegen die Attrappe
  // -----------------------------------------------------------------------

  test('Worker: laden= statt storeId, 504 teilt das Fenster, 500-leer ist keine_daten', async () => {
    const { workerLauf } = await import('./worker')
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf`)
    cfg.BETRIEBSBERICHT_JE_LAUF = 100000
    cfg.TAGESBUDGET = 10000
    await db.query(`
      INSERT INTO sync.warteschlange (endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, prioritaet) VALUES
        ('getReport:96', 'test-duesseldorf', '2026-08-10', '2026-08-16', 85),
        ('getReport:39', 'test-duesseldorf', '2026-08-01', '2026-08-31', 85)`)
    const r = await workerLauf('manuell')
    expect(r.status).toBe('ok')

    const { rows } = await db.query(
      `SELECT endpunkt, zeitraum_von::text AS von, zeitraum_bis::text AS bis, ergebnis
         FROM sync.warteschlange ORDER BY endpunkt, zeitraum_von, zeitraum_bis`)
    // 7 Tage > 3 → 504 → 3 + 4; 4 > 3 → 504 → 2 + 2. Drei Fenster geholt, zwei geteilt.
    expect(rows).toEqual([
      { endpunkt: 'getReport:39', von: '2026-08-01', bis: '2026-08-31', ergebnis: 'keine_daten' },
      { endpunkt: 'getReport:96', von: '2026-08-10', bis: '2026-08-12', ergebnis: 'ok' },
      { endpunkt: 'getReport:96', von: '2026-08-10', bis: '2026-08-16', ergebnis: 'fenster_zu_gross' },
      { endpunkt: 'getReport:96', von: '2026-08-13', bis: '2026-08-14', ergebnis: 'ok' },
      { endpunkt: 'getReport:96', von: '2026-08-13', bis: '2026-08-16', ergebnis: 'fenster_zu_gross' },
      { endpunkt: 'getReport:96', von: '2026-08-15', bis: '2026-08-16', ergebnis: 'ok' },
    ])
    expect(mock.ladenGesehen.every(l => l === 'test-duesseldorf')).toBe(true)
    expect(mock.zaehler['falscher_weg'] ?? 0).toBe(0)
    // Die Bons stehen je Fenster am ersten Tag (die Attrappe datiert so um), 519 je Fenster.
    const { rows: [bons] } = await db.query(
      `SELECT count(*)::int AS n, count(DISTINCT geschaeftstag)::int AS tage FROM core.bon
        WHERE betrieb_key = $1`, [betrieb.get('test-duesseldorf')])
    expect(bons).toEqual({ n: 3 * 519, tage: 3 })
  })

  test('Worker: ein geteiltes Fenster aus dem Nachladen bleibt Nachladen', async () => {
    const { workerLauf } = await import('./worker')
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf`)
    cfg.TAGESBUDGET = 10000
    await db.query(`
      INSERT INTO sync.warteschlange (endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, prioritaet, nachladen)
      VALUES ('getReport:96', 'test-duesseldorf', '2026-08-10', '2026-08-16', 85, true)`)
    await workerLauf('manuell')
    const { rows } = await db.query(
      `SELECT count(*)::int AS n, bool_and(nachladen) AS alle FROM sync.warteschlange`)
    // 7 → 3 + 4 → 3 + 2 + 2: fünf Posten, alle geerbt.
    expect(rows[0]).toEqual({ n: 5, alle: true })
  })

  test('Worker: Betriebsberichte werden mit den übrigen LINA-Posten verschränkt, nicht als Block', async () => {
    const { workerLauf } = await import('./worker')
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf`)
    cfg.TAGESBUDGET = 10000
    await db.query(`
      INSERT INTO sync.warteschlange (endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, prioritaet) VALUES
        ('getReport:88', 'test-duesseldorf', '2026-08-01', '2026-08-01', 85),
        ('getReport:88', 'test-duesseldorf', '2026-08-02', '2026-08-02', 85),
        ('getReport:88', 'test-duesseldorf', '2026-08-03', '2026-08-03', 85),
        ('getUmsatzbericht', NULL, '2026-08-01', '2026-08-01', 10),
        ('getUmsatzbericht', NULL, '2026-08-02', '2026-08-02', 10),
        ('getUmsatzbericht', NULL, '2026-08-03', '2026-08-03', 10)`)
    await workerLauf('manuell')
    const { rows } = await db.query(`SELECT endpunkt FROM sync.aufgabe ORDER BY aufgabe_id`)
    const folge = rows.map(r => r.endpunkt.startsWith('getReport:') ? 'B' : 'K').join('')
    expect(folge).toBe('BKBKBK')
  })

  test('Worker: Betriebsberichte bekommen nur, was das Tagesgeschäft übrig lässt', async () => {
    const { workerLauf } = await import('./worker')
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf`)
    // Budget 5, vier uebrige Posten faellig: genau EIN Betriebsbericht passt.
    cfg.TAGESBUDGET = 5
    await db.query(`
      INSERT INTO sync.warteschlange (endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, prioritaet) VALUES
        ('getReport:88', 'test-duesseldorf', '2026-08-01', '2026-08-01', 85),
        ('getReport:88', 'test-duesseldorf', '2026-08-02', '2026-08-02', 85),
        ('getReport:88', 'test-duesseldorf', '2026-08-03', '2026-08-03', 85),
        ('getUmsatzbericht', NULL, '2026-08-01', '2026-08-01', 10),
        ('getUmsatzbericht', NULL, '2026-08-02', '2026-08-02', 10),
        ('getUmsatzbericht', NULL, '2026-08-03', '2026-08-03', 10),
        ('getUmsatzbericht', NULL, '2026-08-04', '2026-08-04', 10)`)
    await workerLauf('manuell')
    const { rows } = await db.query(
      `SELECT count(*) FILTER (WHERE endpunkt LIKE 'getReport:%')::int AS b,
              count(*) FILTER (WHERE endpunkt NOT LIKE 'getReport:%')::int AS k FROM sync.aufgabe`)
    expect(rows[0]).toEqual({ b: 1, k: 4 })
    cfg.TAGESBUDGET = 10000
  })

  test('Worker: die Notbremse 0 lässt auch eingereihte Betriebsberichte liegen — und sagt es', async () => {
    const { workerLauf } = await import('./worker')
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf`)
    cfg.BETRIEBSBERICHT_JE_LAUF = 0
    await db.query(`
      INSERT INTO sync.warteschlange (endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, prioritaet) VALUES
        ('getReport:88', 'test-duesseldorf', '2026-08-01', '2026-08-01', 85),
        ('getUmsatzbericht', NULL, '2026-08-01', '2026-08-01', 10)`)
    await workerLauf('manuell')
    const { rows } = await db.query(`SELECT endpunkt FROM sync.aufgabe`)
    expect(rows.map(r => r.endpunkt)).toEqual(['getUmsatzbericht'])
    const { rows: [l] } = await db.query(`SELECT notiz FROM sync.lauf ORDER BY lauf_id DESC LIMIT 1`)
    expect(l.notiz).toContain('Notbremse')
    cfg.BETRIEBSBERICHT_JE_LAUF = 100000
  })

  // -----------------------------------------------------------------------
  // Stufe B und M0
  // -----------------------------------------------------------------------

  test('Stufe B: jeder Spaltenplan schreibt in seine Tabelle', async () => {
    const st = fixture('stufe-b-stichproben.json') as { berichte: Record<string, { zeitraum: string; antwort: unknown }> }
    const { SPALTENPLAENE } = await import('./betriebsbericht_laden')
    for (const [key, s] of Object.entries(st.berichte)) {
      const [von, bis] = s.zeitraum === 'monat' ? ['2026-08-01', '2026-08-31'] : ['2026-08-15', '2026-08-15']
      const n = await ladenMit(key, 'test-duesseldorf', von, bis, s.antwort)
      const t = SPALTENPLAENE[key]!.tabelle
      const { rows: [c] } = await db.query(`SELECT count(*)::int AS n FROM ${t}`)
      expect({ key, n, tabelle: c.n }).toEqual({ key, n: c.n, tabelle: c.n })
      expect({ key, leer: n === 0 }).toEqual({ key, leer: false })
    }
    const { rows: [k] } = await db.query(
      `SELECT kellner_block, ist_kopf FROM core.kellner_artikel_monat ORDER BY zeile LIMIT 1`)
    expect(k).toEqual({ kellner_block: 1, ist_kopf: true })
    await ladenMit('getReport:99', 'test-duesseldorf', '2026-08-01', '2026-08-31',
      fixture('report99-duesseldorf-2026-08-gekuerzt.json').antwort)
    const { rows: [z] } = await db.query(`SELECT sum(zahlungen)::int AS n FROM core.unbar_zahlung_monat`)
    expect(z.n).toBe(320)
  })

  test('M0: eine Verkaufsstellenzeile bekommt ihren Schlüssel und ersetzt nicht die Gesamtzeile', async () => {
    await db.query(`TRUNCATE core.umsatzbericht_tag`)
    const { laden } = await import('./laden')
    const { endpunkt } = await import('../lina/endpunkte')
    const daten = JSON.parse(readFileSync(new URL('../transform/fixtures/getUmsatzbericht.json', import.meta.url), 'utf8'))
    const aufruf = (key: string, parameter: Record<string, string>) => laden({
      ep: endpunkt(key), von: '2026-06-15', bis: '2026-06-15', parameter, daten, httpStatus: 200,
      bytes: 0, hash: 'x', laufId: '0', betriebEncId: null,
    })
    await aufruf('getUmsatzbericht', {})
    await aufruf('getUmsatzbericht:vs_ausser_haus', { verkaufsstellen: '1' })
    const { rows } = await db.query(
      `SELECT v.nummer, count(*)::int AS n FROM core.umsatzbericht_tag u
         LEFT JOIN core.verkaufsstelle v USING (verkaufsstelle_key)
        GROUP BY 1 ORDER BY 1 NULLS FIRST`)
    const gesamt = rows.find(r => r.nummer === null)!.n
    expect(rows).toEqual([{ nummer: null, n: gesamt }, { nummer: 1, n: gesamt }])
  })
})
