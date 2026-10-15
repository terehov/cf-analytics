/**
 * Rezepturen (0132) gegen eine echte Datenbank und die FoodNotify-Attrappe:
 * Nachfüllen → Worker → raw → core → mart, Idempotenz, Umlauf, Obergrenze,
 * Zyklusschutz und die Regel-10-Prüfung je Marke.
 *
 * Übersprungen ohne TEST_DATABASE_URL. Die Datei macht TRUNCATE über die
 * Warteschlange, raw und die Rezepttabellen — sie braucht eine EIGENE
 * Testdatenbank (Schema-Klon, siehe docs/offene-punkte.md), nie die, auf die
 * DATABASE_URL zeigt. Immer die ganze Datei laufen lassen, nie mit -t (die
 * Notbremse sitzt im ersten beforeAll).
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

lauf('Rezepturen mit Datenbank', () => {
  let db: Client
  let lina: ReturnType<typeof mockStarten>
  let fn: ReturnType<typeof fnMockStarten>
  let cfg: any
  let enchilada: number

  const zaehlen = async () => {
    const { rows: [r] } = await db.query(
      `SELECT (SELECT count(*)::int FROM core.rezept)  AS rezepte,
              (SELECT count(*)::int FROM core.zutat)   AS zutaten,
              (SELECT count(*)::int FROM core.rezept WHERE in_liste) AS in_liste,
              (SELECT count(*)::int FROM core.rezept WHERE zutaten_geholt_am IS NOT NULL) AS mit_zutaten,
              (SELECT count(*)::int FROM core.rezept WHERE meta_geholt_am IS NOT NULL) AS mit_meta,
              (SELECT count(*)::int FROM core.zutat WHERE sub_rezept_fn_id IS NOT NULL
                                                      AND sub_rezept_key IS NULL) AS verweis_ohne_key`)
    return r
  }

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
    // NUR Enchilada, und nur mit dem Attrappen-Benutzer. Die echten Zugaenge
    // aus der .env werden entfernt, BEVOR config geladen wird.
    for (const m of ['APOSTO', 'ENCHILADA', 'DEUTSCHE_KONZEPTE', 'WILMA_WUNDER']) {
      delete process.env[`FN_${m}_USER`]
      delete process.env[`FN_${m}_PASSWORD`]
    }
    process.env.FN_ENCHILADA_USER = 'test@aposto.eu'
    process.env.FN_ENCHILADA_PASSWORD = 'geheim'
    process.env.HISTORIE_JE_LAUF = '0'
    process.env.NULLTAGE_JE_LAUF = '0'
    process.env.LOCHTAGE_JE_LAUF = '0'
    process.env.NACHLESE_JE_LAUF = '0'
    process.env.LOG_LEVEL ??= 'error'
    const { config } = await import('../config')
    if (config.DATABASE_URL !== DB || config.FN_BASE_URL !== fn.url) {
      throw new Error('config wurde vorher mit einer anderen Umgebung geladen — '
        + 'diese Datei einzeln starten: bun test src/foodnotify/rezept_db.test.ts')
    }
    cfg = config
    db = new Client({ connectionString: DB })
    await db.connect()
    await db.query(`DELETE FROM sync.zugangssperre`)
    await db.query(`DELETE FROM core.bestellposition WHERE bestellung_key IN
                      (SELECT bestellung_key FROM core.bestellung WHERE fn_id = 'rz-test')`)
    await db.query(`DELETE FROM core.bestellung WHERE fn_id = 'rz-test'`)
    await db.query(`DELETE FROM core.kostenstelle WHERE kostenstelle_id = 990001`)
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf, sync.schema_abweichung,
                       raw.api_antwort, core.zutat, core.rezept RESTART IDENTITY CASCADE`)
    const { rows: [m] } = await db.query(`SELECT marke_key FROM core.marke WHERE schluessel = 'enchilada'`)
    enchilada = Number(m.marke_key)
  })

  afterAll(async () => { lina?.stop(); fn?.stop(); await db?.end() })

  test('Nachfüllen + Worker: Tagesgeschäft in Phase A, volle Runde und erster Abzug in Phase C', async () => {
    const { rezepteNachfuellen } = await import('../sync/nachfuellen')
    const stand = await rezepteNachfuellen()
    expect(stand).toMatchObject({ listen: 1, volleRunde: 1, neu: 0, verweise: 0, umlauf: 0, nachladen: true })

    const { workerOeffnen } = await import('../sync/worker')
    const s = await workerOeffnen('manuell')
    const a = await s.tagesgeschaeft()
    /*
     * Phase A: Seite 1 (Tagesgeschäft), Zutaten+Meta der zwei neuen Rezepte,
     * dann über die Verweise drei Köpfe mit Zutaten+Meta = 1 + 4 + 9 = 14.
     * Seite 2 NICHT: die Marke kannte vorher kein Rezept, das Tagesgeschäft
     * blättert dann nicht weiter — den ersten Abzug macht Phase C.
     */
    expect(a.posten).toBe(14)
    const { rows: tg2 } = await db.query(
      `SELECT 1 FROM sync.warteschlange WHERE endpunkt = 'fn:rezepte' AND parameter = '{"seite": "2"}'`)
    expect(tg2).toHaveLength(0)
    await s.ableitungenFertig()
    // Phase C: volle Runde Seite 1 und 2, das neue Rezept 1030679 mit Zutaten+Meta = 4.
    const c = await s.nachladen()
    expect(c.posten).toBe(4)
    const r = await s.abschliessen()
    expect(r.status).toBe('ok')
    expect(r.ok).toBe(18)

    const { rows: weg } = await db.query(
      `SELECT parameter->>'rezeptId' AS id, nachladen FROM sync.warteschlange
        WHERE endpunkt = 'fn:rezept_zutaten' ORDER BY 1`)
    expect(weg).toEqual([
      { id: '1030679', nachladen: true }, { id: '1032008', nachladen: false },
      { id: '1048034', nachladen: false }, { id: '1048035', nachladen: false },
      { id: '983835', nachladen: false }, { id: '984827', nachladen: false },
    ])

    expect(await zaehlen()).toEqual({
      rezepte: 6, zutaten: 17, in_liste: 3, mit_zutaten: 6, mit_meta: 6, verweis_ohne_key: 0,
    })

    // Jede Antwort im Raw-Layer, mit Marke im Parameter.
    const { rows: [raw] } = await db.query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE quelle = 'foodnotify' AND (parameter->>'markeKey')::int = $1)::int AS ok
         FROM raw.api_antwort WHERE endpunkt LIKE 'fn:rezept%'`, [enchilada])
    expect(raw).toEqual({ n: 18, ok: 18 })

    // archived, baseQuantity/baseUnit und der Listenstand (Probe 15.10.2026).
    const { rows: [ar] } = await db.query(
      `SELECT count(*) FILTER (WHERE archiviert)::int AS ja, count(*) FILTER (WHERE NOT archiviert)::int AS nein
         FROM core.rezept`)
    expect(ar).toEqual({ ja: 3, nein: 3 })
    const { rows: [basis] } = await db.query(
      `SELECT basis_menge::float AS m, basis_einheit AS e FROM core.zutat WHERE basis_menge IS NOT NULL`)
    expect(basis).toEqual({ m: 7.5, e: 'g' })
    const { rows: [ls] } = await db.query(
      `SELECT rezepte_gesamt, seiten, seite1_am IS NOT NULL AS s1, volle_runde_am IS NOT NULL AS voll
         FROM core.rezept_liste_stand WHERE marke_key = $1`, [enchilada])
    expect(ls).toEqual({ rezepte_gesamt: 3, seiten: 2, s1: true, voll: true })

    // Die drei nur über Verweis erreichbaren Rezepte stehen als in_liste = false.
    const { rows: verweis } = await db.query(
      `SELECT fn_id FROM core.rezept WHERE NOT in_liste ORDER BY fn_id`)
    expect(verweis.map(v => v.fn_id)).toEqual([983835, 984827, 1048035])

    // Meta roh übernommen.
    const { rows: [meta] } = await db.query(
      `SELECT gewicht_gesamt::float AS g, portion::float AS p, portion_einheit AS e, verlust_roh::float AS v
         FROM core.rezept WHERE fn_id = 983835`)
    expect(meta).toEqual({ g: 20000, p: 20, e: 'l', v: 0 })

    const { rows: abw } = await db.query(`SELECT 1 FROM sync.schema_abweichung`)
    expect(abw).toHaveLength(0)
  })

  /**
   * Abnahme 3 aus docs/plan-rezepturen.md, an der echten Enchilada-Nummer:
   * 200004 (Sweet & Sour Mix Box, Distra) steht DIREKT in zwei Halbfabrikaten
   * und kommt über sie in drei weitere Rezepte — eines davon über zwei Stufen.
   */
  test('artikel_in_rezept: 200004 auf Ebene 1, 2 und 3, Menge je Ebene, nicht multipliziert', async () => {
    const { rows } = await db.query(
      `SELECT rezept, marke, menge::float AS menge, einheit, ebene, via_rezept, via_menge::float AS via_menge,
              via_einheit, direkt_rezept, pfad
         FROM mart.artikel_in_rezept WHERE artikelnummer = '200004'
        ORDER BY ebene, rezept_fn_id`)
    expect(rows).toEqual([
      { rezept: 'Sweet & Sour Mix 20 L', marke: 'Enchilada', menge: 20, einheit: 'LT', ebene: 1,
        via_rezept: null, via_menge: null, via_einheit: null, direkt_rezept: 'Sweet & Sour Mix 20 L',
        pfad: 'Sweet & Sour Mix 20 L' },
      { rezept: 'Sweet & Sour Mix 20 L', marke: 'Enchilada', menge: 20, einheit: 'LT', ebene: 1,
        via_rezept: null, via_menge: null, via_einheit: null, direkt_rezept: 'Sweet & Sour Mix 20 L',
        pfad: 'Sweet & Sour Mix 20 L' },
      { rezept: 'amarga muerte', marke: 'Enchilada', menge: 20, einheit: 'LT', ebene: 2,
        via_rezept: 'Sweet & Sour Mix 20 L', via_menge: 2, via_einheit: 'cl',
        direkt_rezept: 'Sweet & Sour Mix 20 L', pfad: 'amarga muerte → Sweet & Sour Mix 20 L' },
      expect.objectContaining({ rezept: 'Popcorn Shot Basisartikel', ebene: 2,
        via_rezept: 'Sweet & Sour Mix 20 L', menge: 20, einheit: 'LT' }),
      expect.objectContaining({ rezept: '2cl Popcorn Shot', ebene: 3,
        via_rezept: 'Popcorn Shot Basisartikel', menge: 20, einheit: 'LT',
        pfad: '2cl Popcorn Shot → Popcorn Shot Basisartikel → Sweet & Sour Mix 20 L' }),
    ])
  })

  test('zweimal laden → identische Zeilenzahlen; core aus raw neu aufbaubar', async () => {
    const vorher = await zaehlen()
    const { rows: [inhalt1] } = await db.query(
      `SELECT md5(string_agg(concat_ws('|', r.fn_id, z.position, z.art, z.artikelnummer, z.menge, z.einheit,
                                      z.sub_rezept_fn_id, z.lieferant_fn_id), ',' ORDER BY r.fn_id, z.position)) AS h
         FROM core.zutat z JOIN core.rezept r USING (rezept_key)`)

    // a) Alle Rohantworten noch einmal durch den Lader — ohne vorher zu leeren.
    const { fnLaden } = await import('./laden')
    const { fnEndpunkt } = await import('./endpunkte')
    const { rows: [l] } = await db.query(`SELECT lauf_id::text FROM sync.lauf ORDER BY lauf_id DESC LIMIT 1`)
    const laufId: string = l.lauf_id
    const nochmal = async () => {
      // Je Endpunkt und Parameter die ERSTE Antwort — der Nachspiel-Lauf hängt
      // selbst neue Rohzeilen an (raw ist append-only).
      const { rows: roh } = await db.query(
        `SELECT DISTINCT ON (endpunkt, parameter::text)
                endpunkt, parameter, payload, http_status, payload_hash, payload_bytes,
                zeitraum_von::text AS von
           FROM raw.api_antwort WHERE endpunkt LIKE 'fn:rezept%'
          ORDER BY endpunkt, parameter::text, abgerufen_am`)
      // 3 Listenseiten (Tagesgeschäft 1, volle Runde 1 und 2) + 3 Köpfe + 6 × 2.
      expect(roh).toHaveLength(18)
      // Erst die Köpfe (Liste, Einzelkopf), dann Zutaten und Meta — dieselbe
      // Reihenfolge, in der der Worker sie geholt hat.
      const rang = (e: string) => (e === 'fn:rezepte' ? 0 : e === 'fn:rezept' ? 1 : 2)
      roh.sort((a, b) => rang(a.endpunkt) - rang(b.endpunkt))
      for (const a of roh) {
        const { markeKey, ...parameter } = a.parameter
        await fnLaden({
          ep: fnEndpunkt(a.endpunkt), markeKey: Number(markeKey), von: a.von, bis: a.von,
          parameter, daten: a.payload, httpStatus: a.http_status, bytes: a.payload_bytes,
          hash: a.payload_hash, laufId: laufId,
        })
      }
    }
    await nochmal()
    expect(await zaehlen()).toEqual(vorher)

    // b) core leeren und aus raw neu aufbauen (Regel 4).
    await db.query(`TRUNCATE core.zutat, core.rezept RESTART IDENTITY CASCADE`)
    await nochmal()
    expect(await zaehlen()).toEqual(vorher)
    const { rows: [inhalt2] } = await db.query(
      `SELECT md5(string_agg(concat_ws('|', r.fn_id, z.position, z.art, z.artikelnummer, z.menge, z.einheit,
                                      z.sub_rezept_fn_id, z.lieferant_fn_id), ',' ORDER BY r.fn_id, z.position)) AS h
         FROM core.zutat z JOIN core.rezept r USING (rezept_key)`)
    expect(inhalt2.h).toBe(inhalt1.h)

    // Das Nachspielen reiht beim Laden Folgeposten ein (neue Rezepte ohne
    // Zutaten) — im echten Betrieb richtig, hier Rauschen für die Tests danach.
    await db.query(`DELETE FROM sync.warteschlange WHERE erledigt_am IS NULL`)
  })

  test('zweites Nachfüllen am selben Tag reiht nichts ein; der Umlauf greift erst nach REZEPT_UMLAUF_TAGE', async () => {
    const { rezepteNachfuellen } = await import('../sync/nachfuellen')
    // raw wurde im Test davor zweimal nachgespielt — die Warteschlange ist unberührt.
    expect(await rezepteNachfuellen()).toMatchObject({ gesamt: 0 })

    // Zwei Rezepte altern über den Umlauf: eines aus der Liste, eines nur über Verweis.
    await db.query(
      `UPDATE core.rezept SET zutaten_geholt_am = now() - interval '15 days'
        WHERE fn_id IN (1032008, 983835)`)
    await db.query(
      `UPDATE sync.warteschlange SET erstellt_am = now() - interval '15 days'
        WHERE parameter->>'rezeptId' IN ('1032008', '983835')`)

    // Trockenlauf: zählt, schreibt nichts.
    const vorher = await db.query(`SELECT count(*)::int AS n FROM sync.warteschlange`)
    const trocken = await rezepteNachfuellen(true)
    // 1032008: Zutaten + Meta; 983835 (nur über Verweis): Kopf + Zutaten + Meta.
    expect(trocken).toMatchObject({ umlauf: 5, neu: 0, verweise: 0 })
    const nachher = await db.query(`SELECT count(*)::int AS n FROM sync.warteschlange`)
    expect(nachher.rows[0].n).toBe(vorher.rows[0].n)

    // Und wirklich: im Nachladen, nicht im Tagesgeschäft.
    const echt = await rezepteNachfuellen()
    expect(echt).toMatchObject({ umlauf: 5, neu: 0, listen: 0, volleRunde: 0 })
    const { rows: nl } = await db.query(
      `SELECT DISTINCT nachladen FROM sync.warteschlange WHERE erledigt_am IS NULL`)
    expect(nl).toEqual([{ nachladen: true }])

    // Der Notschalter: REZEPTE_NACHLADEN = 0 reiht nur noch das Tagesgeschäft ein.
    await db.query(`DELETE FROM sync.warteschlange WHERE erledigt_am IS NULL`)
    const alt = cfg.REZEPTE_NACHLADEN
    try {
      cfg.REZEPTE_NACHLADEN = 0
      expect(await rezepteNachfuellen()).toMatchObject({ gesamt: 0, nachladen: false })
    } finally { cfg.REZEPTE_NACHLADEN = alt }
    await db.query(`UPDATE core.rezept SET zutaten_geholt_am = now() WHERE fn_id IN (1032008, 983835)`)
  })

  test('das Tagesgeschäft blättert weiter, solange eine Seite neue Rezepte trägt', async () => {
    // 1048034 (Seite 1) verschwindet aus core — am nächsten Tag ist es "neu".
    await db.query(`DELETE FROM core.rezept WHERE fn_id = 1048034`)
    const { rows: [m] } = await db.query(`SELECT coalesce(max(posten_id), 0)::int AS n FROM sync.warteschlange`)
    await db.query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
       VALUES ('fn:rezepte', current_date, current_date, 40, $1, '{"seite": "1"}')`, [enchilada])
    const { workerOeffnen } = await import('../sync/worker')
    const s = await workerOeffnen('manuell')
    await s.tagesgeschaeft()
    await s.ableitungenFertig()
    await s.nachladen()
    await s.abschliessen()
    // Seite 1 trug ein neues Rezept → Seite 2 im Tagesgeschäft; Seite 2 nur Bekanntes → Schluss.
    const { rows } = await db.query(
      `SELECT parameter->>'seite' AS seite, nachladen, ergebnis FROM sync.warteschlange
        WHERE endpunkt = 'fn:rezepte' AND NOT parameter ? 'runde' AND posten_id > $1
        ORDER BY posten_id`, [m.n])
    expect(rows).toEqual([
      { seite: '1', nachladen: false, ergebnis: 'ok' }, { seite: '2', nachladen: false, ergebnis: 'ok' },
    ])
    const { rows: [z] } = await db.query(
      `SELECT zutaten_geholt_am IS NOT NULL AS da FROM core.rezept WHERE fn_id = 1048034`)
    expect(z.da).toBe(true)
  })

  test('mart: Ladestand je Marke, Zuordnung in Prozentzahlen, Prüfzeilen vorhanden', async () => {
    const { rows: [st] } = await db.query(
      `SELECT rezepte, in_liste, nur_ueber_verweis, ohne_zutaten, zutatenzeilen
         FROM mart.rezept_stand WHERE marke_key = $1`, [enchilada])
    expect(st).toEqual({ rezepte: 6, in_liste: 3, nur_ueber_verweis: 3, ohne_zutaten: 0, zutatenzeilen: 17 })

    const { rows: zu } = await db.query(
      `SELECT zuordnung, positionen, zuordnung_anteil_pct::float AS pct
         FROM mart.rezept_zuordnung_pruefung WHERE marke_key = $1 ORDER BY zuordnung`, [enchilada])
    // Ohne Bestellungen im Testbestand ist jede Nummer "ohne Einkauf".
    expect(zu.map(z => z.zuordnung)).toEqual(['nummer ohne einkauf', 'unterrezept'])
    expect(zu.find(z => z.zuordnung === 'unterrezept')).toMatchObject({ positionen: 3 })
    // Prozentzahl, nicht Bruch: 3 von 17 = 17.65, und die Summe ist 100.
    expect(zu.find(z => z.zuordnung === 'unterrezept')!.pct).toBe(17.65)
    expect(Math.round(zu.reduce((s, z) => s + z.pct, 0))).toBe(100)

    const { rows: pr } = await db.query(
      `SELECT pruefung FROM mart.pruefung_uebersicht WHERE pruefung LIKE 'Rezepte:%' ORDER BY 1`)
    expect(pr).toHaveLength(2)
  })

  test('eine eingekaufte Nummer wird als eingekauft erkannt — je Marke', async () => {
    const { rows: [ks] } = await db.query(
      `INSERT INTO core.kostenstelle (marke_key, kostenstelle_id, restaurant_id, erp_id, name, restaurant_name)
       VALUES ($1, 990001, 990001, 990001, 'Testküche', 'Testbetrieb') RETURNING kostenstelle_key`, [enchilada])
    const { rows: [b] } = await db.query(
      `INSERT INTO core.bestellung (kostenstelle_key, fn_id) VALUES ($1, 'rz-test') RETURNING bestellung_key`,
      [ks.kostenstelle_key])
    await db.query(
      `INSERT INTO core.bestellposition (bestellung_key, name, lieferanten_nr) VALUES ($1, 'S&S Box', '200004')`,
      [b.bestellung_key])
    const { rows } = await db.query(
      `SELECT DISTINCT zuordnung FROM mart.rezept_position WHERE artikelnummer = '200004'`)
    expect(rows.map(r => r.zuordnung)).toEqual(['eingekauft'])
    // Dieselbe Nummer in einer anderen Marke zählt nicht.
    await db.query(`UPDATE core.kostenstelle SET marke_key = $1 WHERE kostenstelle_key = $2`,
      [enchilada === 1 ? 2 : 1, ks.kostenstelle_key])
    const { rows: fremd } = await db.query(
      `SELECT DISTINCT zuordnung FROM mart.rezept_position WHERE artikelnummer = '200004'`)
    expect(fremd.map(r => r.zuordnung)).toEqual(['nummer ohne einkauf'])
    await db.query(`DELETE FROM core.bestellposition WHERE bestellung_key = $1`, [b.bestellung_key])
    await db.query(`DELETE FROM core.bestellung WHERE bestellung_key = $1`, [b.bestellung_key])
    await db.query(`DELETE FROM core.kostenstelle WHERE kostenstelle_key = $1`, [ks.kostenstelle_key])
  })

  test('eine unbekannte Antwortform: raw gesichert, schema_abweichung, core unberührt, Posten scheitert', async () => {
    const { fnLaden } = await import('./laden')
    const { fnEndpunkt } = await import('./endpunkte')
    const { rows: [l] } = await db.query(`SELECT lauf_id::text FROM sync.lauf ORDER BY lauf_id DESC LIMIT 1`)
    const vorher = await zaehlen()
    const { rows: [st0] } = await db.query(
      `SELECT zutaten_geholt_am::text AS t FROM core.rezept WHERE fn_id = 1032008`)
    const { rows: [raw0] } = await db.query(`SELECT count(*)::int AS n FROM raw.api_antwort`)
    const laden = (ep: string, daten: unknown) => fnLaden({
      ep: fnEndpunkt(ep), markeKey: enchilada, von: '2026-10-15', bis: '2026-10-15',
      parameter: { rezeptId: '1032008' }, daten, httpStatus: 200, bytes: 1, hash: 'h', laufId: l.lauf_id,
    })
    await expect(laden('fn:rezept_zutaten', { ingredients: [{ id: 1, kind: 'ingredient' }] }))
      .rejects.toThrow('Antwortform unbekannt')
    await expect(laden('fn:rezept_meta', { meta: { weight: { total: 1 } } }))
      .rejects.toThrow('Antwortform unbekannt')

    expect(await zaehlen()).toEqual(vorher)
    const { rows: [st1] } = await db.query(
      `SELECT zutaten_geholt_am::text AS t FROM core.rezept WHERE fn_id = 1032008`)
    expect(st1.t).toBe(st0.t)
    const { rows: [raw1] } = await db.query(`SELECT count(*)::int AS n FROM raw.api_antwort`)
    expect(raw1.n).toBe(raw0.n + 2)
    const { rows: abw } = await db.query(
      `SELECT endpunkt FROM sync.schema_abweichung WHERE endpunkt LIKE 'fn:rezept%' ORDER BY 1`)
    expect(abw.map(a => a.endpunkt)).toEqual(['fn:rezept_meta', 'fn:rezept_zutaten'])
    await db.query(`DELETE FROM sync.schema_abweichung`)
  })

  /**
   * Review 15.10.2026: 404 war 'aufgegeben', wurde dreimal wiederbelebt und
   * stand fuer immer in mart.posten_aufgegeben. Jetzt 'nicht_gefunden' und
   * fehlt_seit am Rezept; ein spaeterer Erfolg setzt es zurueck.
   */
  test('404 auf einen Rezeptabruf: nicht_gefunden, fehlt_seit, nicht wiederbelebbar, Erfolg setzt zurück', async () => {
    await db.query(
      `INSERT INTO core.rezept (marke_key, fn_id, name, in_liste, zutaten_geholt_am)
       VALUES ($1, 999998, 'Geloescht', true, now() - interval '20 days')`, [enchilada])
    await db.query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
       VALUES ('fn:rezept_zutaten', current_date, current_date, 41, $1, '{"rezeptId": "999998"}'),
              ('fn:rezept',         current_date, current_date, 41, $1, '{"rezeptId": "999997"}')`,
      [enchilada])
    const { workerLauf } = await import('../sync/worker')
    const r = await workerLauf('manuell')
    expect(r.status).toBe('ok')

    const { rows: w } = await db.query(
      `SELECT endpunkt, ergebnis FROM sync.warteschlange
        WHERE parameter->>'rezeptId' IN ('999998', '999997') ORDER BY endpunkt`)
    expect(w).toEqual([
      { endpunkt: 'fn:rezept', ergebnis: 'nicht_gefunden' },
      { endpunkt: 'fn:rezept_zutaten', ergebnis: 'nicht_gefunden' },
    ])
    const { rows: [rz] } = await db.query(
      `SELECT fehlt_seit IS NOT NULL AS fehlt FROM core.rezept WHERE fn_id = 999998`)
    expect(rz.fehlt).toBe(true)
    const { rows: [st] } = await db.query(
      `SELECT nicht_gefunden FROM mart.rezept_stand WHERE marke_key = $1`, [enchilada])
    expect(st.nicht_gefunden).toBe(1)
    const { rows: auf } = await db.query(
      `SELECT 1 FROM mart.posten_aufgegeben WHERE endpunkt LIKE 'fn:rezept%'`)
    expect(auf).toHaveLength(0)
    const { aufgegebeneWiederbeleben } = await import('../sync/nachfuellen')
    await aufgegebeneWiederbeleben()
    const { rows: [offen] } = await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange
        WHERE parameter->>'rezeptId' IN ('999998', '999997') AND erledigt_am IS NULL`)
    expect(offen.n).toBe(0)

    // Ein spaeterer Erfolg (das Rezept steht wieder in der Liste) setzt fehlt_seit zurueck.
    const { fnLaden } = await import('./laden')
    const { fnEndpunkt } = await import('./endpunkte')
    const { rows: [l] } = await db.query(`SELECT lauf_id::text FROM sync.lauf ORDER BY lauf_id DESC LIMIT 1`)
    await fnLaden({
      ep: fnEndpunkt('fn:rezepte'), markeKey: enchilada, von: '2026-10-15', bis: '2026-10-15',
      parameter: { seite: 'test' }, daten: { data: [{ id: 999998, name: 'Wieder da' }] },
      httpStatus: 200, bytes: 1, hash: 'h', laufId: l.lauf_id,
    })
    const { rows: [rz2] } = await db.query(`SELECT fehlt_seit FROM core.rezept WHERE fn_id = 999998`)
    expect(rz2.fehlt_seit).toBeNull()
    await db.query(`DELETE FROM sync.warteschlange WHERE parameter->>'rezeptId' IN ('999998', '999997')`)
    await db.query(`DELETE FROM core.rezept WHERE fn_id = 999998`)
  })

  test('ein Zyklus zwischen Rezepten terminiert', async () => {
    const { rows: [a] } = await db.query(
      `INSERT INTO core.rezept (marke_key, fn_id, name) VALUES ($1, 1, 'Zyklus A') RETURNING rezept_key`, [enchilada])
    const { rows: [b] } = await db.query(
      `INSERT INTO core.rezept (marke_key, fn_id, name) VALUES ($1, 2, 'Zyklus B') RETURNING rezept_key`, [enchilada])
    await db.query(
      `INSERT INTO core.zutat (rezept_key, position, art, name, sub_rezept_fn_id) VALUES
         ($1, 1, 'sub_recipe', 'B', 2), ($2, 1, 'sub_recipe', 'A', 1)`, [a.rezept_key, b.rezept_key])
    await db.query(
      `INSERT INTO core.zutat (rezept_key, position, art, name, artikelnummer) VALUES ($1, 2, 'ingredient', 'X', 'zyklus-x')`,
      [a.rezept_key])
    const { rows } = await db.query(
      `SELECT rezept, ebene FROM mart.artikel_in_rezept WHERE artikelnummer = 'zyklus-x' ORDER BY ebene`)
    // X steht in A (1), über A in B (2) — und B → A wird nicht noch einmal betreten.
    expect(rows).toEqual([{ rezept: 'Zyklus A', ebene: 1 }, { rezept: 'Zyklus B', ebene: 2 }])
    await db.query(`DELETE FROM core.rezept WHERE rezept_key IN ($1, $2)`, [a.rezept_key, b.rezept_key])
  })

  /**
   * Regel 10: eine Marke, deren Rezeptliste nicht mehr kommt, muss in einer
   * Prüfzeile stehen — nicht nur im Log. mart.quelle_zulauf sähe es nicht,
   * solange eine andere Marke weiter liefert.
   */
  test('Regel 10: Marke mit FoodNotify-Zulauf, aber veralteter Rezeptliste, wird auffällig', async () => {
    const zeile = async () => (await db.query(
      `SELECT auffaellig::int AS n FROM mart.pruefung_uebersicht
        WHERE pruefung LIKE 'Rezepte: Marke mit FoodNotify-Zulauf%'`)).rows[0].n
    // Zulauf der Marke überhaupt: ein fn:profil-Abruf in den letzten sieben Tagen.
    const { rows: [l] } = await db.query(`SELECT lauf_id FROM sync.lauf ORDER BY lauf_id LIMIT 1`)
    await db.query(
      `INSERT INTO sync.aufgabe (lauf_id, endpunkt, status, marke_key, parameter)
       VALUES ($1, 'fn:profil', 'ok', $2, '{}')`, [l.lauf_id, enchilada])
    expect(await zeile()).toBe(0)

    // Zutaten abgerufen, aber keine einzige Zeile da: 'zutaten leer' (Review 15.10.2026).
    await db.query('BEGIN')
    try {
      await db.query(`DELETE FROM core.zutat`)
      const { rows: [leer] } = await db.query(
        `SELECT zustand FROM mart.rezept_stand WHERE marke_key = $1`, [enchilada])
      expect(leer.zustand).toBe('zutaten leer')
      expect(await zeile()).toBe(1)
    } finally { await db.query('ROLLBACK') }

    await db.query(
      `UPDATE core.rezept_liste_stand SET seite1_am = now() - interval '48 hours' WHERE marke_key = $1`, [enchilada])
    const { rows: [st] } = await db.query(
      `SELECT zustand FROM mart.rezept_stand WHERE marke_key = $1`, [enchilada])
    expect(st.zustand).toBe('liste veraltet')
    expect(await zeile()).toBe(1)
  })

  test('Praxislauf: nur Rezeptposten, nur localhost, über dieselben Lader', async () => {
    const { datenbankPruefen, rezeptePraxis } = await import('../rezepte_praxis')
    expect(() => datenbankPruefen('postgresql://db.example.com/lina')).toThrow('nicht auf localhost')
    expect(() => datenbankPruefen(undefined)).toThrow('--datenbank fehlt')
    expect(() => datenbankPruefen('postgresql://localhost/x?host=10.0.0.1')).toThrow('host=')
    expect(datenbankPruefen('postgresql://127.0.0.1/x')).toBe('postgresql://127.0.0.1/x')
    // Eine fremde URL bricht ab, bevor irgendetwas passiert.
    await expect(rezeptePraxis({ datenbank: 'postgresql://localhost/gibts_nicht_123' }))
      .rejects.toThrow('weicht von --datenbank ab')

    await db.query(`TRUNCATE sync.warteschlange, core.zutat, core.rezept, core.rezept_liste_stand RESTART IDENTITY CASCADE`)
    // Fremde Posten in der Schlange — sie müssen liegen bleiben.
    await db.query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter) VALUES
         ('getUmsatzbericht', current_date, current_date, 10, NULL, '{}'),
         ('fn:kostenstellen', current_date, current_date, 5, $1, '{}')`, [enchilada])
    const zeilen: string[] = []
    const e = await rezeptePraxis({ datenbank: DB!, marken: ['enchilada'], maxRezepte: 2, ausgabe: z => zeilen.push(z) })
    expect(e.grund).toBe('--max-rezepte 2 erreicht')
    expect(e.zutatenGeladen).toBe(2)
    expect(e.fehler).toBe(0)
    const zweiter = await rezeptePraxis({ datenbank: DB!, marken: ['enchilada'], ausgabe: z => zeilen.push(z) })
    expect(zweiter.grund).toBe('Schlange der Rezeptposten leer')
    expect(await zaehlen()).toMatchObject({ rezepte: 6, zutaten: 17, mit_zutaten: 6 })
    const { rows: fremd } = await db.query(
      `SELECT endpunkt FROM sync.warteschlange WHERE endpunkt NOT LIKE 'fn:rezept%' AND erledigt_am IS NULL ORDER BY 1`)
    expect(fremd.map(f => f.endpunkt)).toEqual(['fn:kostenstellen', 'getUmsatzbericht'])
    const { rows: [l] } = await db.query(`SELECT status, notiz FROM sync.lauf WHERE lauf_id = $1`, [zweiter.laufId])
    expect(l.status).toBe('ok')
    expect(l.notiz).toContain('Praxislauf Rezepturen')
  })
})
