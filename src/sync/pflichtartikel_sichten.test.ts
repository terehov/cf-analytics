/**
 * Das Korn der Pflichtartikel-Klassifikation ist (konzept, gueltig_von, nr, nm)
 * — und zwei Schreibweisen desselben Artikels duerfen es nicht sprengen.
 *
 * Der Fall (gemessen 10.09.2026 in Produktion): "Rapsöl 10L" und "Rapsoel 10L"
 * tragen dieselbe Lieferantennummer und denselben normalisierten Namen. Bis
 * Migration `0100` fuehrte das CTE `ist` den Rohnamen im DISTINCT, die Sicht
 * bekam zwei Zeilen fuer einen Artikel, und `REFRESH MATERIALIZED VIEW
 * CONCURRENTLY` scheiterte sechzehn Naechte lang am Unique-Index — sichtbar
 * nur als `veraltet` in mart.materialisierung_stand und als log.warn.
 *
 * Braucht TEST_DATABASE_URL mit angewandter `0100`; ohne wird uebersprungen.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from 'pg'

const DB = process.env.TEST_DATABASE_URL
const lauf = DB ? describe : describe.skip

lauf('Pflichtartikel-Klassifikation — Umlaut-Varianten sind EIN Artikel', () => {
  let db: Client
  let betrieb: number
  let kostenstelle: number
  let bestellung: number
  const KONZEPT = 'Enchilada'
  const NR = '11426738'
  // Ein eigenes Fenster in der Vergangenheit, das keine echte Liste beruehrt.
  const VON = '2019-01-01', BIS = '2019-12-31', BESTELLT = '2019-06-15'

  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
    const { rows: [m] } = await db.query(
      `SELECT marke_key FROM core.marke WHERE name = $1`, [KONZEPT])
    const { rows: [b] } = await db.query(
      `INSERT INTO core.betrieb (enc_id, name) VALUES ('test-korn', 'Test Korn GmbH')
       ON CONFLICT (enc_id) DO UPDATE SET name = excluded.name RETURNING betrieb_key`)
    betrieb = b.betrieb_key
    const { rows: [k] } = await db.query(
      `INSERT INTO core.kostenstelle (marke_key, kostenstelle_id, restaurant_id, name, restaurant_name, betrieb_key)
       VALUES ($1, '999999901', '999999902', 'Test Korn Kueche', 'Test Korn', $2)
       RETURNING kostenstelle_key`, [m.marke_key, betrieb])
    kostenstelle = k.kostenstelle_key
    await db.query(
      `INSERT INTO manual.pflichtartikel_liste (konzept, bereich, gueltig_von, gueltig_bis, name)
       VALUES ($1, 'kueche', $2, $3, 'Testliste Korn')
       ON CONFLICT DO NOTHING`, [KONZEPT, VON, BIS])
    const { rows: [o] } = await db.query(
      `INSERT INTO core.bestellung (kostenstelle_key, fn_id, bestellt_am, status)
       VALUES ($1, 'test-korn-1', $2, 'imported') RETURNING bestellung_key`, [kostenstelle, BESTELLT])
    bestellung = o.bestellung_key
    for (const name of ['Rapsöl 10L', 'Rapsoel 10L']) {
      await db.query(
        `INSERT INTO core.bestellposition (bestellung_key, name, lieferanten_nr, menge, summe_preis)
         VALUES ($1, $2, $3, 1, 10)`, [bestellung, name, NR])
    }
  })

  afterAll(async () => {
    await db.query(`DELETE FROM core.bestellung WHERE bestellung_key = $1`, [bestellung])
    await db.query(`DELETE FROM core.kostenstelle WHERE kostenstelle_key = $1`, [kostenstelle])
    await db.query(`DELETE FROM core.betrieb WHERE betrieb_key = $1`, [betrieb])
    await db.query(
      `DELETE FROM manual.pflichtartikel_liste WHERE konzept = $1 AND gueltig_von = $2`, [KONZEPT, VON])
    await db.query(`REFRESH MATERIALIZED VIEW mart.pflichtartikel_klassifikation_basis`)
    await db?.end()
  })

  test('der CONCURRENTLY-Refresh laeuft durch und liefert EINE Zeile fuer die Nummer', async () => {
    // Erst einmal befuellen (eine nie befuellte Sicht kann nicht CONCURRENTLY),
    // dann so, wie der Nachlauf es nachts tut.
    await db.query(`REFRESH MATERIALIZED VIEW mart.pflichtartikel_klassifikation_basis`)
    await expect(
      db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY mart.pflichtartikel_klassifikation_basis`),
    ).resolves.toBeDefined()

    const { rows } = await db.query(
      `SELECT nr, nm, name_roh, zustand FROM mart.pflichtartikel_klassifikation_basis
        WHERE konzept = $1 AND gueltig_von = $2 AND nr = $3`, [KONZEPT, VON, NR])
    expect(rows).toHaveLength(1)
    expect(rows[0].nm).toBe('rapsoel 10l')
    expect(['Rapsöl 10L', 'Rapsoel 10L']).toContain(rows[0].name_roh)
  })

  test('das Korn ist ueber die ganze Sicht eindeutig', async () => {
    const { rows: [r] } = await db.query(
      `SELECT count(*)::int AS zeilen,
              count(DISTINCT (konzept, gueltig_von, nr, nm))::int AS koerner
         FROM mart.pflichtartikel_klassifikation_basis`)
    expect(r.zeilen).toBe(r.koerner)
  })
})
