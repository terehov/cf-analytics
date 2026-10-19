/**
 * Der verteilte Umlauf der Rezepte (0134, docs/entscheidungen.md 19.10.2026).
 *
 * Braucht TEST_DATABASE_URL (Stand ≥ 0134), sonst übersprungen. Jeder Block
 * läuft ZWEIMAL: unter Sitzungszeitzone UTC (so steht die Produktion, 0001)
 * und unter Europe/Berlin (so stehen lokale Klone, die per createdb -T die
 * Einstellung nicht erben). Bis zur Review-Korrektur vom 19.10.2026 rechnete
 * sync.rezept_umlauf_faellig in der Sitzungszeitzone, und unter UTC fielen
 * zwei der Simulationen durch — der Test lief nur dort, wo er grün war.
 *
 * Teil 1 simuliert Nächte gegen sync.rezept_umlauf_faellig — dieselbe
 * Funktion, die rezepteNachfuellen() aufruft. Nur eine TEMP-Tabelle.
 * Teil 2 prüft, dass mart.rezept_stand.ueberfaellig dem Umlauf folgt, den der
 * Importer nach sync.merker meldet. In EINER Transaktion, am Ende
 * zurückgerollt. Kein TRUNCATE, nichts Bleibendes.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from 'pg'

const UMLAUF = 14
const DB = process.env.TEST_DATABASE_URL
const lauf = DB ? describe : describe.skip

for (const zone of ['UTC', 'Europe/Berlin']) {
  lauf(`Umlauf: Nächte simuliert gegen sync.rezept_umlauf_faellig (Sitzung ${zone})`, () => {
    let db: Client

    beforeAll(async () => {
      db = new Client({ connectionString: DB })
      await db.connect()
      await db.query(`SET TIME ZONE '${zone}'`)
      await db.query(`CREATE TEMP TABLE r (fn_id bigint PRIMARY KEY, geholt timestamptz)`)
      // 140 Rezepte, fortlaufende IDs wie bei FoodNotify, alle im selben ersten
      // Abzug gelesen — der Fall vom 15./16.10.2026.
      await db.query(
        `INSERT INTO r SELECT 1032000 + i, TIMESTAMP '2026-10-15 06:00' AT TIME ZONE 'Europe/Berlin'
           FROM generate_series(0, 139) i`)
    })
    afterAll(async () => { await db?.end() })

    /** Eine Nacht: um 05:02 nachfüllen, eine Stunde später gelesen. Liefert die Zahl der fälligen. */
    const nacht = async (tag: number) => {
      const { rows } = await db.query<{ fn_id: string }>(
        `WITH j AS (SELECT (DATE '2026-10-15' + $1::int + TIME '05:02') AT TIME ZONE 'Europe/Berlin' AS jetzt)
         UPDATE r SET geholt = j.jetzt + interval '1 hour'
           FROM j
          WHERE sync.rezept_umlauf_faellig(r.fn_id, r.geholt, j.jetzt, $2)
         RETURNING r.fn_id`, [tag, UMLAUF])
      return rows.length
    }
    /**
     * Ältester Abruf in Tagen, gemessen zum Nachfüllzeitpunkt des Tages — nach
     * der Wanduhr in Berlin: über das Ende der Sommerzeit hinweg sind 15
     * Kalendertage 15 Tage und eine Stunde.
     */
    const aeltester = async (tag: number) => {
      const { rows: [a] } = await db.query<{ tage: number }>(
        `SELECT extract(epoch FROM (DATE '2026-10-15' + $1::int + TIME '05:02')
                                   - min(geholt AT TIME ZONE 'Europe/Berlin')) / 86400.0 AS tage FROM r`, [tag])
      return Number(a.tage)
    }

    test('140 gleich alte Rezepte: je Tag 10, nach Umlauf + 1 Tagen keines älter', async () => {
      const je: number[] = []
      for (let tag = 1; tag <= UMLAUF + 1; tag++) {
        expect(await aeltester(tag)).toBeLessThanOrEqual(UMLAUF + 1)
        je.push(await nacht(tag))
      }
      // Tag 1: der Abruf ist keinen ganzen Tag alt — die Gruppe dieses Tages
      // rastet an Tag 15 ein (sein Tag UND älter als der Umlauf zugleich).
      // Tag 14 (29.10., nach dem Ende der Sommerzeit) ist der Fall, der unter
      // UTC 20 statt 10 lieferte: 14 × 24 h zurück vom 29.10. 05:02 MEZ ist der
      // 15.10. 06:02 MESZ, und der Abzug um 06:00 MESZ lag davor — die Gruppe
      // von Tag 15 galt einen Tag zu früh als älter als der Umlauf.
      expect(je).toEqual([0, ...Array(UMLAUF).fill(10)])
      expect(await aeltester(UMLAUF + 2)).toBeLessThan(UMLAUF)
      // Nach Tag 15: alle 140 einmal gelesen, keines älter als Umlauf + 1 Tage.
      const { rows: [n] } = await db.query(
        `SELECT count(*)::int AS n FROM r WHERE geholt > TIMESTAMPTZ '2026-10-16 00:00+02'`)
      expect(n.n).toBe(140)

      // Und es bleibt verteilt: der zweite Zyklus (über das Ende der Sommerzeit am 25.10.).
      for (let tag = UMLAUF + 2; tag <= 2 * UMLAUF + 1; tag++) {
        expect(await nacht(tag)).toBe(10)
        expect(await aeltester(tag + 1)).toBeLessThanOrEqual(UMLAUF + 1)
      }
    })

    test('eine ausgefallene Nacht wird am Folgetag nachgeholt, nicht einen Zyklus später', async () => {
      const aus = 2 * UMLAUF + 2         // diese Nacht läuft kein Sync
      const folge = aus + 1
      expect(await nacht(folge)).toBe(20) // die eigene Gruppe und die ausgefallene
      expect(await aeltester(folge + 1)).toBeLessThanOrEqual(UMLAUF + 1)
      // Danach wieder 10 je Nacht — die nachgeholte Gruppe rastet an ihrem Tag ein.
      for (let tag = folge + 1; tag <= folge + UMLAUF + 1; tag++) {
        expect(await nacht(tag)).toBe(10)
        expect(await aeltester(tag + 1)).toBeLessThanOrEqual(UMLAUF + 1)
      }
    })

    test('nie geholt ist der erste Abzug, nicht der Umlauf', async () => {
      const { rows: [f] } = await db.query(
        `SELECT sync.rezept_umlauf_faellig(1032000, NULL, now(), 14) AS f`)
      expect(f.f).toBe(false)
    })
  })

  lauf(`Umlauf: ueberfaellig folgt dem gemeldeten REZEPT_UMLAUF_TAGE (Sitzung ${zone})`, () => {
    let db: Client
    let marke: number

    beforeAll(async () => {
      db = new Client({ connectionString: DB })
      await db.connect()
      await db.query(`SET TIME ZONE '${zone}'`)
      await db.query('BEGIN')
      // Eine eigene Marke, damit kein Rezept des Bestands mitzählt.
      const { rows: [m] } = await db.query<{ marke_key: number }>(
        `INSERT INTO core.marke (schluessel, name) VALUES ('umlauf_test', 'Umlauf-Test')
         RETURNING marke_key`)
      marke = Number(m.marke_key)
      await db.query(
        `INSERT INTO core.rezept (marke_key, fn_id, name, in_liste, zutaten_geholt_am)
         VALUES ($1, 1, 'zehn Tage alt', true, now() - interval '10 days')`, [marke])
    })
    afterAll(async () => {
      await db?.query('ROLLBACK')
      await db?.end()
    })

    const melden = (tage: number) => db.query(
      `INSERT INTO sync.merker (schluessel, wert) VALUES ('rezept_umlauf_tage', jsonb_build_object('tage', $1::int))
       ON CONFLICT (schluessel) DO UPDATE SET wert = EXCLUDED.wert, gesetzt_am = now()`, [tage])
    const stand = async () => {
      const { rows: [s] } = await db.query(
        `SELECT ueberfaellig, umlauf_tage, umlauf_tage_quelle, zustand
           FROM mart.rezept_stand WHERE marke_key = $1`, [marke])
      return s
    }

    test('gemeldet 7: ein zehn Tage altes Rezept ist überfällig', async () => {
      await melden(7)
      const s = await stand()
      expect(s.ueberfaellig).toBe(1)
      expect(s.umlauf_tage).toBe(7)
      expect(s.umlauf_tage_quelle).toBe('REZEPT_UMLAUF_TAGE')
    })

    test('gemeldet 28: dasselbe Rezept ist es nicht', async () => {
      await melden(28)
      const s = await stand()
      expect(s.ueberfaellig).toBe(0)
      expect(s.umlauf_tage).toBe(28)
    })

    test('nie gemeldet: Rückfall auf 14, gekennzeichnet', async () => {
      await db.query(`DELETE FROM sync.merker WHERE schluessel = 'rezept_umlauf_tage'`)
      const s = await stand()
      expect(s.umlauf_tage).toBe(14)
      expect(s.umlauf_tage_quelle).toMatch(/^rueckfall 14/)
      expect(s.ueberfaellig).toBe(0)
      await db.query(`UPDATE core.rezept SET zutaten_geholt_am = now() - interval '17 days'
                       WHERE marke_key = $1`, [marke])
      expect((await stand()).ueberfaellig).toBe(1)
    })
  })
}
