/**
 * Soll-Verbrauch (0159) gegen eine echte Datenbank: synthetische Rezepte mit
 * bekannten Mengen, von Hand nachgerechnet — Unterrezept über zwei Ebenen,
 * Einheitenwechsel (g, cl, kg), Portion, baseQuantity, nicht umrechenbare
 * Einheit („Stück" eines Halbfabrikats), Zyklus, unbekanntes Unterrezept,
 * Rezept ohne Zutaten, Bar und Küche mit verschiedenen Rezepten für denselben
 * Artikel, Einkauf mit Storno, baseUnit und fremder Einheit.
 *
 * Läuft vollständig in EINER Transaktion und rollt am Ende zurück — kein
 * Rest in der Datenbank. Trotzdem nur gegen einen leeren Schema-Klon
 * (TEST_DATABASE_URL): die Datei frischt mart.artikel_monat_basis auf, und
 * auf einem Vollbestand dauert das Minuten. Die Notbremse unten bricht ab,
 * wenn core.artikelverkauf_tag mehr als 100.000 Zeilen hat.
 *
 * Übersprungen ohne TEST_DATABASE_URL. Immer die ganze Datei laufen lassen.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from 'pg'

const DB = process.env.TEST_DATABASE_URL

if (DB && process.env.DATABASE_URL && DB === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL zeigt auf dieselbe Datenbank wie DATABASE_URL — eine eigene Testdatenbank anlegen.')
}

const lauf = DB ? describe : describe.skip

/** Rezept-IDs weit ausserhalb echter FoodNotify-IDs. */
const R = { burger: 99_000_001, pommes: 99_000_002, leer: 99_000_003, wasser: 99_000_004,
            sauce: 99_000_011, teig: 99_000_012, gewuerz: 99_000_013, dip: 99_000_014 } as const
const PLU = { burger: 99_000_901, pommes: 99_000_902, wasser: 99_000_903, ohne: 99_000_904,
              leer: 99_000_905, nichtImFeed: 99_000_906 } as const

lauf('Soll-Verbrauch mit Datenbank', () => {
  let db: Client
  let monat: string
  let tag: string
  let betrieb: number

  const zahl = (x: unknown) => (x === null || x === undefined ? null : Number(x))

  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
    const gross = await db.query(`SELECT count(*)::int AS n FROM (SELECT 1 FROM core.artikelverkauf_tag LIMIT 100001) x`)
    if (gross.rows[0].n > 100_000) {
      await db.end()
      throw new Error('TEST_DATABASE_URL zeigt auf einen Vollbestand — diese Datei braucht einen leeren Schema-Klon.')
    }
    await db.query('BEGIN')

    const m = await db.query(`SELECT (date_trunc('month', current_date) - interval '1 month')::date::text AS monat,
                                     ((date_trunc('month', current_date) - interval '1 month')::date + 9)::text AS tag`)
    monat = m.rows[0].monat
    tag = m.rows[0].tag
    const marke = (await db.query(`SELECT marke_key FROM core.marke WHERE schluessel = 'deutsche_konzepte'`)).rows[0].marke_key

    betrieb = (await db.query(
      `INSERT INTO core.betrieb (enc_id, name) VALUES ('soll-test-0159', 'Testbetrieb Soll') RETURNING betrieb_key`)).rows[0].betrieb_key
    const ks = async (id: number, name: string, art: string, verbindung: number) => (await db.query(
      `INSERT INTO core.kostenstelle (marke_key, kostenstelle_id, restaurant_id, name, restaurant_name, art,
                                      connection_id, kassensystem, betrieb_key)
       VALUES ($1, $2, 99000100, $3, 'Testbetrieb Soll', $4, $5, 'amadeus', $6) RETURNING kostenstelle_key`,
      [marke, id, name, art, verbindung, betrieb])).rows[0].kostenstelle_key
    const bar = await ks(99_000_101, 'Bar Test', 'bar', 99_001)
    const kueche = await ks(99_000_102, 'Küche Test', 'kueche', 99_002)
    for (const k of [bar, kueche]) {
      await db.query(`INSERT INTO core.pos_artikel_abruf (kostenstelle_key, connection_id, abgerufen_am, artikel)
                      VALUES ($1, 0, now(), 1)`, [k])
    }
    await db.query(`INSERT INTO sync.merker (schluessel, wert) VALUES ('pos_artikel_marken', '{"marken": ["deutsche_konzepte"]}')
                    ON CONFLICT (schluessel) DO UPDATE SET wert = EXCLUDED.wert`)

    // --- Rezepte -------------------------------------------------------
    const rezept = async (fn: number, name: string, gesamt: number | null, person: number | null, geholt = true) =>
      (await db.query(`INSERT INTO core.rezept (marke_key, fn_id, name, gewicht_gesamt, gewicht_person, zutaten_geholt_am)
                       VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END) RETURNING rezept_key`,
        [marke, fn, name, gesamt, person, geholt])).rows[0].rezept_key
    const zutat = async (rk: number, pos: number, art: string, name: string, nr: string | null, sub: number | null,
                         menge: number, einheit: string, kosten: number | null,
                         basis: number | null = null, basisEinheit: string | null = null) =>
      db.query(`INSERT INTO core.zutat (rezept_key, position, art, name, artikelnummer, sub_rezept_fn_id, menge, einheit,
                                        kosten, basis_menge, basis_einheit)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [rk, pos, art, name, nr, sub, menge, einheit, kosten, basis, basisEinheit])

    // Burger: eine Portion (400 = 400)
    const burger = await rezept(R.burger, 'Burger', 400, 400)
    await zutat(burger, 1, 'ingredient', 'Hack', 'A1', null, 150, 'g', 1.5)
    await zutat(burger, 2, 'sub_recipe', 'Sauce', null, R.sauce, 50, 'g', 0)
    await zutat(burger, 3, 'sub_recipe', 'Teig', null, R.teig, 2, 'Stück', 0)
    await zutat(burger, 4, 'sub_recipe', 'Verschollen', null, 99_999_999, 10, 'g', 0)
    // Sauce: 1000 g, darin Gewürzmix 100 g (von 200 g)
    const sauce = await rezept(R.sauce, 'Sauce', 1000, 1000)
    await zutat(sauce, 1, 'ingredient', 'Mayo', 'B1', null, 600, 'g', 6)
    await zutat(sauce, 2, 'ingredient', 'Ketchup', 'C1', null, 30, 'cl', 3)
    await zutat(sauce, 3, 'sub_recipe', 'Gewürzmix', null, R.gewuerz, 100, 'g', 0)
    // Gewürzmix: Paprika 0,2 kg und — Zyklus — wieder die Sauce
    const gewuerz = await rezept(R.gewuerz, 'Gewürzmix', 200, 200)
    await zutat(gewuerz, 1, 'product_group', 'Paprika (EN)', 'D1', null, 0.2, 'kg', 2)
    await zutat(gewuerz, 2, 'sub_recipe', 'Sauce', null, R.sauce, 10, 'g', 0)
    // Teig: nur über "Stück" erreichbar — nicht umrechenbar
    const teig = await rezept(R.teig, 'Teig', 800, 800)
    await zutat(teig, 1, 'ingredient', 'Mehl', 'E1', null, 500, 'g', 0.5)
    // Pommes: zwei Portionen im Rezept (600 / 300)
    const pommes = await rezept(R.pommes, 'Pommes groß', 600, 300)
    await zutat(pommes, 1, 'ingredient', 'Pommes TK', 'F1', null, 0.5, 'kg', 1)
    await zutat(pommes, 2, 'ingredient', 'Salz', 'G1', null, 2, 'Stück', 0.1, 10, 'g')
    await zutat(pommes, 3, 'sub_recipe', 'Dip', null, R.dip, 1, 'Portion', 0)
    // Dip: 100 g, Portion 50 g
    const dip = await rezept(R.dip, 'Dip', 100, 50)
    await zutat(dip, 1, 'ingredient', 'Dipsauce', 'H1', null, 80, 'g', 0.8)
    await zutat(dip, 2, 'ingredient', 'Kräuter', 'I1', null, 20, 'g', 0.4)
    // Leer: Zutaten geholt, keine da
    await rezept(R.leer, 'Leer', null, null)
    // Wasser: Freitext ohne Nummer
    const wasser = await rezept(R.wasser, 'Wasser', 300, 300)
    await zutat(wasser, 1, 'ingredient', 'Leitungswasser', null, null, 0.3, 'l', 0)

    // --- Kassenartikel und Verkauf --------------------------------------
    const artikel = async (plu: number, name: string) => (await db.query(
      `INSERT INTO core.artikel (artikelnummer, name) VALUES ($1, $2) RETURNING artikel_key`, [plu, name])).rows[0].artikel_key
    const a = {
      burger: await artikel(PLU.burger, 'Burger'), pommes: await artikel(PLU.pommes, 'Pommes'),
      wasser: await artikel(PLU.wasser, 'Wasser'), ohne: await artikel(PLU.ohne, 'Ohne Rezept'),
      leer: await artikel(PLU.leer, 'Leer'), nichtImFeed: await artikel(PLU.nichtImFeed, 'Nicht im Feed'),
    }
    const pos = (k: number, rid: number, plu: number, rezeptFn: number | null, geaendert: string) =>
      db.query(`INSERT INTO core.pos_artikel (kostenstelle_key, remote_id, plu, name, rezept_fn_id, geaendert_am)
                VALUES ($1, $2, $3::text, 'x', $4, $5::timestamptz)`, [k, rid, plu, rezeptFn, geaendert])
    await pos(kueche, 1, PLU.burger, R.burger, '2026-11-01')
    // Pommes: Küche (neuer) Pommes, Bar (älter) Wasser — die neuere gewinnt, uneindeutig
    await pos(kueche, 2, PLU.pommes, R.pommes, '2026-11-10')
    await pos(bar, 3, PLU.pommes, R.wasser, '2026-10-01')
    await pos(bar, 4, PLU.wasser, R.wasser, '2026-11-01')
    await pos(bar, 5, PLU.ohne, null, '2026-11-01')
    await pos(kueche, 6, PLU.leer, R.leer, '2026-11-01')

    await db.query(`SELECT core.partition_anlegen('core.artikelverkauf_tag', $1::date)`, [tag])
    const verkauf = (art: number, menge: number, umsatz: number) =>
      db.query(`INSERT INTO core.artikelverkauf_tag (betrieb_key, geschaeftstag, artikel_key, menge, umsatz_netto)
                VALUES ($1, $2::date, $3, $4, $5)`, [betrieb, tag, art, menge, umsatz])
    await verkauf(a.burger, 10, 100)
    await verkauf(a.pommes, 20, 80)
    await verkauf(a.wasser, 5, 10)
    await verkauf(a.ohne, 3, 30)
    await verkauf(a.leer, 2, 20)
    await verkauf(a.nichtImFeed, 1, 5)

    // --- Einkauf -------------------------------------------------------
    const lieferant = (await db.query(
      `INSERT INTO core.lieferant (marke_key, fn_id, name) VALUES ($1, 'soll-test', 'Testlieferant') RETURNING lieferant_key`,
      [marke])).rows[0].lieferant_key
    const bestellung = async (k: number, fn: string, am: string, status: string) => (await db.query(
      `INSERT INTO core.bestellung (kostenstelle_key, fn_id, lieferant_key, bestellt_am, status)
       VALUES ($1, $2, $3, $4::timestamptz, $5) RETURNING bestellung_key`, [k, fn, lieferant, am, status])).rows[0].bestellung_key
    const b1 = await bestellung(kueche, 'soll-1', `${tag} 10:00+01`, 'imported')
    const b2 = await bestellung(bar, 'soll-2', `${tag} 11:00+01`, 'imported')
    const bStorno = await bestellung(kueche, 'soll-3', `${tag} 12:00+01`, 'canceled')
    const bFrueher = await bestellung(kueche, 'soll-4', `${monat}`, 'imported')
    await db.query(`UPDATE core.bestellung SET bestellt_am = $2::date - interval '2 months' + interval '12 hours'
                     WHERE bestellung_key = $1`, [bFrueher, monat])
    const position = (b: number, nr: string, einheit: string, gesamt: number, summe: number, preis: number | null,
                      unstimmig = false) =>
      db.query(`INSERT INTO core.bestellposition (bestellung_key, name, menge, gebinde_menge, einheit, gesamt_menge,
                                                  summe_preis, preis_je_einheit, menge_unstimmig, lieferanten_nr)
                VALUES ($1, $2, 1, 1, $3, $4, $5, $6, $7, $2)`, [b, nr, einheit, gesamt, summe, preis, unstimmig])
    await position(b1, 'F1', 'kg', 4, 8, 2)            // Pommes: 4 + 4 kg zu 2 EUR/kg
    await position(b2, 'F1', 'kg', 4, 8, 2)            // ... auch über die Bar: beide Kostenstellen zählen
    await position(bStorno, 'F1', 'kg', 10, 20, 2)     // Storno zählt nicht
    await position(b1, 'A1', 'kg', 2, 20, 10)          // Hack in kg ...
    await position(b1, 'A1', 'baseUnit', 6000, 5, null) // ... und eine Position ohne belastbare Menge
    await position(b1, 'B1', 'l', 1, 4, 4)             // Mayo in l: andere Einheit als das Soll
    await position(bFrueher, 'H1', 'kg', 1, 5, 5)      // Dip: nur vor zwei Monaten, Preis der Marke

    for (const s of ['mart.artikel_stand_monat_basis', 'mart.konzept_zuordnung_basis',
                     'mart.artikel_monat_basis', 'mart.rezept_stueckliste_basis']) {
      await db.query(`REFRESH MATERIALIZED VIEW ${s}`)
    }
  }, 120_000)

  afterAll(async () => {
    if (!db) return
    try { await db.query('ROLLBACK') } finally { await db.end() }
  })

  const stueck = async (fn: number) => (await db.query(
    `SELECT artikelnummer, ware, art, einheit_soll, menge_je_portion, kosten_je_portion, belastbar, grund,
            ebene, ueber_basismenge, rezept_zeilen, rezept_zeilen_belastbar, portion_regel
       FROM mart.rezept_stueckliste WHERE rezept_fn_id = $1 ORDER BY weg`, [fn])).rows

  test('Stückliste Burger: zwei Ebenen multipliziert, Stück und Zyklus gekennzeichnet', async () => {
    const z = await stueck(R.burger)
    const nach = (w: string) => z.find(r => r.ware === w)
    expect(z.length).toBe(7)
    expect(zahl(nach('Hack')!.menge_je_portion)).toBeCloseTo(0.15, 10)          // 150 g
    expect(zahl(nach('Mayo')!.menge_je_portion)).toBeCloseTo(0.03, 10)          // 600 g × 50/1000
    expect(nach('Ketchup')!.einheit_soll).toBe('l')
    expect(zahl(nach('Ketchup')!.menge_je_portion)).toBeCloseTo(0.015, 10)      // 30 cl × 0,05
    expect(zahl(nach('Paprika (EN)')!.menge_je_portion)).toBeCloseTo(0.005, 10) // 0,2 kg × 0,05 × 100/200
    expect(nach('Paprika (EN)')!.ebene).toBe(3)
    expect(zahl(nach('Paprika (EN)')!.kosten_je_portion)).toBeCloseTo(0.05, 10) // 2 EUR × 0,025
    expect(nach('Mehl')!.belastbar).toBe(false)
    expect(nach('Mehl')!.menge_je_portion).toBeNull()
    expect(nach('Mehl')!.grund).toBe('einheit nicht umrechenbar: Stück')
    const luecken = z.filter(r => r.art === 'luecke').map(r => r.grund).sort()
    expect(luecken).toEqual(['unterrezept unbekannt', 'zyklus'])
    expect(z[0].rezept_zeilen).toBe('7')
    expect(z[0].rezept_zeilen_belastbar).toBe('4')
    expect(z[0].portion_regel).toBe('eine portion')
  })

  test('Stückliste Pommes: Teil des Rezepts, Portion des Halbfabrikats, baseQuantity', async () => {
    const z = await stueck(R.pommes)
    const nach = (w: string) => z.find(r => r.ware === w)
    expect(z.length).toBe(4)
    expect(z.every(r => r.belastbar)).toBe(true)
    expect(z[0].portion_regel).toBe('teil des rezepts')
    expect(zahl(nach('Pommes TK')!.menge_je_portion)).toBeCloseTo(0.25, 10)     // 0,5 kg × 300/600
    expect(zahl(nach('Salz')!.menge_je_portion)).toBeCloseTo(0.005, 10)         // 10 g × 0,5
    expect(nach('Salz')!.ueber_basismenge).toBe(true)
    expect(zahl(nach('Dipsauce')!.menge_je_portion)).toBeCloseTo(0.02, 10)      // 80 g × 0,5 × (1 × 50/100)
    expect(zahl(nach('Kräuter')!.menge_je_portion)).toBeCloseTo(0.005, 10)
  })

  test('Rezept ohne Zutaten ist eine Lücke, kein leeres Rezept', async () => {
    const z = await stueck(R.leer)
    expect(z.length).toBe(1)
    expect(z[0].art).toBe('luecke')
    expect(z[0].grund).toBe('rezept ohne zutaten')
  })

  test('Zuordnung: Bar und Küche mit verschiedenen Rezepten — die zuletzt geänderte gewinnt, sichtbar', async () => {
    const r = await db.query(
      `SELECT rezept_fn_id, rezept_uneindeutig, kandidaten, rezept_fn_ids FROM mart.soll_rezept_zuordnung
        WHERE betrieb_key = $1 AND artikelnummer = $2`, [betrieb, PLU.pommes])
    expect(r.rows.length).toBe(1)
    expect(r.rows[0].rezept_fn_id).toBe(R.pommes)
    expect(r.rows[0].rezept_uneindeutig).toBe(true)
    expect(r.rows[0].kandidaten).toBe(2)
  })

  test('Abdeckung je Betrieb und Monat', async () => {
    const r = (await db.query(`SELECT * FROM mart.soll_verbrauch_abdeckung WHERE betrieb_key = $1 AND monat = $2`,
      [betrieb, monat])).rows
    expect(r.length).toBe(1)
    const a = r[0]
    expect(a.zustand).toBe('ok')
    expect(zahl(a.umsatz_netto)).toBe(245)
    expect(zahl(a.umsatz_vollstaendig)).toBe(90)       // Pommes 80 + Wasser 10
    expect(zahl(a.umsatz_teilweise)).toBe(100)         // Burger
    expect(zahl(a.umsatz_rezept_ohne_zutaten)).toBe(20)
    expect(zahl(a.umsatz_kein_rezept)).toBe(35)        // ohne Rezept 30 + nicht im Feed 5
    expect(zahl(a.umsatz_nicht_im_feed)).toBe(5)
    expect(zahl(a.abdeckung_umsatz_pct)).toBe(36.7)    // 90 / 245
    expect(zahl(a.abdeckung_menge_pct)).toBe(61.0)     // 25 / 41
    expect(zahl(a.rezept_umsatz_pct)).toBe(85.7)       // 210 / 245
    expect(a.artikel_rezept_uneindeutig).toBe(1)
  })

  test('Soll-Verbrauch je Monat: Menge × Stückliste, Lücke und Untergrenze sichtbar', async () => {
    const r = (await db.query(
      `SELECT artikelnummer, ware, einheit, soll_menge, soll_wert_fn_eur, portionen_nicht_umrechenbar,
              soll_unvollstaendig, abdeckung_umsatz_pct
         FROM mart.soll_verbrauch_monat WHERE betrieb_key = $1 AND monat = $2`, [betrieb, monat])).rows
    const nach = (nr: string | null, ware?: string) =>
      r.find(x => x.artikelnummer === nr && (ware === undefined || x.ware === ware))!
    expect(zahl(nach('A1').soll_menge)).toBeCloseTo(1.5, 10)
    expect(zahl(nach('B1').soll_menge)).toBeCloseTo(0.3, 10)
    expect(zahl(nach('C1').soll_menge)).toBeCloseTo(0.15, 10)
    expect(nach('C1').einheit).toBe('l')
    expect(zahl(nach('D1').soll_menge)).toBeCloseTo(0.05, 10)
    expect(zahl(nach('F1').soll_menge)).toBeCloseTo(5, 10)
    expect(zahl(nach('G1').soll_menge)).toBeCloseTo(0.1, 10)
    expect(zahl(nach('H1').soll_menge)).toBeCloseTo(0.4, 10)
    expect(zahl(nach('I1').soll_menge)).toBeCloseTo(0.1, 10)
    expect(zahl(nach(null, 'Leitungswasser').soll_menge)).toBeCloseTo(1.5, 10)
    expect(nach('E1').soll_menge).toBeNull()
    expect(nach('E1').soll_unvollstaendig).toBe(true)
    expect(zahl(nach('E1').portionen_nicht_umrechenbar)).toBe(10)
    expect(zahl(nach('F1').soll_wert_fn_eur)).toBeCloseTo(10, 10)      // 20 × 1 EUR × 0,5
    expect(r.every(x => zahl(x.abdeckung_umsatz_pct) === 36.7)).toBe(true)
    const wert = await db.query(`SELECT soll_wert_fn_eur FROM mart.soll_artikel_monat
                                  WHERE betrieb_key = $1 AND monat = $2 AND artikel = 'Pommes'`, [betrieb, monat])
    expect(zahl(wert.rows[0].soll_wert_fn_eur)).toBeCloseTo(17, 10)    // 20 × (0,5 + 0,05 + 0,2 + 0,1)
  })

  test('Soll-Verbrauch je Tag stimmt mit dem Monat überein', async () => {
    const r = (await db.query(
      `SELECT artikelnummer, soll_menge, abdeckung_umsatz_pct FROM mart.soll_verbrauch_tag
        WHERE betrieb_key = $1 AND geschaeftstag = $2::date AND artikelnummer = 'F1'`, [betrieb, tag])).rows
    expect(r.length).toBe(1)
    expect(zahl(r[0].soll_menge)).toBeCloseTo(5, 10)
    expect(zahl(r[0].abdeckung_umsatz_pct)).toBe(36.7)
  })

  test('Soll gegen Einkauf: Storno raus, Einheiten nur, wo sie passen, Preisquelle', async () => {
    const r = (await db.query(
      `SELECT artikelnummer, eingekauft_menge, vergleich, vergleichbar, einkauf_zu_soll_pct, preis_eur_je_einheit,
              preis_quelle, soll_wert_eur, positionen
         FROM mart.soll_ist_monat WHERE betrieb_key = $1 AND monat = $2`, [betrieb, monat])).rows
    const nach = (nr: string) => r.find(x => x.artikelnummer === nr)!
    expect(zahl(nach('F1').eingekauft_menge)).toBe(8)                   // 4 + 4, ohne die 10 aus dem Storno
    expect(nach('F1').vergleichbar).toBe(true)
    expect(zahl(nach('F1').einkauf_zu_soll_pct)).toBe(160)
    expect(nach('F1').preis_quelle).toBe('bezahlt, betrieb im monat')
    expect(zahl(nach('F1').soll_wert_eur)).toBe(10)                     // 5 kg × 2 EUR
    expect(nach('A1').vergleich).toBe('einkauf teilweise ohne menge')
    expect(nach('A1').einkauf_zu_soll_pct).toBeNull()
    expect(zahl(nach('A1').soll_wert_eur)).toBe(15)                     // 1,5 kg × 10 EUR
    expect(nach('B1').vergleich).toBe('einkauf in anderer einheit')
    expect(nach('H1').vergleich).toBe('kein einkauf im monat')
    expect(nach('H1').preis_quelle).toBe('bezahlt, marke 12 monate')
    expect(zahl(nach('H1').soll_wert_eur)).toBe(2)                      // 0,4 kg × 5 EUR
    expect(nach('E1').vergleich).toBe('soll unvollstaendig')
    expect(r.some(x => x.artikelnummer === null)).toBe(false)           // Freitext hat keinen Einkauf
  })
})
