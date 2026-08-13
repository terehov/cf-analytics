/**
 * Die Mart-Sichten zum Einkauf (Migration 0035).
 *
 * Geprüft wird, was eine Sicht STILL falsch machen kann — nicht, ob sie
 * Zeilen liefert. Drei Dinge sind hier gefährlich:
 *
 *   1. Gebindegrößen statt Preisen vergleichen (fehlende Umrechnung),
 *   2. eine Preisreihe in Einzelpunkte zersplittern (Gruppierung über die
 *      Waren-ID statt über den Namen — 866 Sätze, nur 428 Namen),
 *   3. einen Halbjahressprung als Monatsveränderung ausweisen.
 *
 * Alle drei erzeugen Zahlen, die plausibel aussehen und falsch sind.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from 'pg'

const DB = process.env.TEST_DATABASE_URL
const lauf = DB ? describe : describe.skip

let db: Client

/**
 * Eine kleine, vollständig kontrollierte Lage: eine Ware, die unter ZWEI
 * FoodNotify-IDs geführt wird (so wie im Echtbestand), zwei Gebindegrößen
 * und eine Lücke im Monatsverlauf.
 */
async function lageAufbauen(c: Client) {
  await c.query('TRUNCATE core.bestellposition, core.bestellung')
  await c.query('DELETE FROM core.kostenstelle')
  await c.query(`DELETE FROM core.ware WHERE fn_id LIKE 'testware-%'`)
  await c.query(`DELETE FROM core.betrieb WHERE enc_id LIKE 'test-mart-%'`)

  const { rows: [m] } = await c.query(`
    INSERT INTO core.marke (schluessel, name) VALUES ('aposto','Aposto')
    ON CONFLICT (schluessel) DO UPDATE SET name = excluded.name
    RETURNING marke_key`)
  const { rows: [bt] } = await c.query(
    `INSERT INTO core.betrieb (name, enc_id) VALUES ('Testbetrieb Mart','test-mart-1')
     RETURNING betrieb_key`)
  const { rows: [k] } = await c.query(
    `INSERT INTO core.kostenstelle
       (marke_key, kostenstelle_id, restaurant_id, name, restaurant_name, art, betrieb_key)
     VALUES ($1, 8001, 6001, 'Küche Test', 'Testbetrieb Mart', 'kueche', $2)
     RETURNING kostenstelle_key`, [m.marke_key, bt.betrieb_key])

  // DIESELBE Ware unter zwei IDs — genau das Muster aus dem Echtbestand.
  const waren: number[] = []
  for (const fnId of ['testware-a', 'testware-b']) {
    const { rows: [w] } = await c.query(
      `INSERT INTO core.ware (marke_key, fn_id, name) VALUES ($1,$2,'Olivenöl 5L Kanister')
       RETURNING ware_key`, [m.marke_key, fnId])
    waren.push(w.ware_key)
  }

  /**
   * Vier Bestellungen. Preis je Liter ist überall verschieden, die
   * GEBINDEZAHL aber auch — wer nicht auf die Einheit umrechnet, bekommt
   * eine völlig andere Reihenfolge.
   *
   * Januar fehlt absichtlich zwischen Dezember und Februar: die Lücke
   * prüft, dass keine Veränderung über zwei Monate hinweg gemeldet wird.
   */
  const posten: [string, number, number, number, number][] = [
    // Monat, ware-Index, Gebinde, Gesamtmenge (Liter), Summe
    ['2025-11-10', 0, 2, 10, 50],   // 5,00 €/l
    ['2025-11-20', 1, 4, 20, 110],  // 5,50 €/l — andere Waren-ID, gleiche Ware
    ['2025-12-10', 0, 2, 10, 60],   // 6,00 €/l
    ['2026-02-10', 0, 2, 10, 90],   // 9,00 €/l — nach einer Lücke
  ]
  for (const [tag, wIdx, gebinde, gesamt, summe] of posten) {
    const { rows: [b] } = await c.query(
      `INSERT INTO core.bestellung (kostenstelle_key, fn_id, bestellt_am, summe)
       VALUES ($1, $2, $3::timestamptz, $4) RETURNING bestellung_key`,
      [k.kostenstelle_key, `test-${tag}-${wIdx}`, tag, summe])
    await c.query(
      `INSERT INTO core.bestellposition
         (bestellung_key, ware_key, name, menge, gebinde_menge, gesamt_menge,
          einheit, summe_preis, preis_je_einheit)
       VALUES ($1,$2,'Olivenöl 5L Kanister',$3,5,$4,'l',$5,
               round($5::numeric / nullif($4::numeric,0), 6))`,
      [b.bestellung_key, waren[wIdx], gebinde, gesamt, summe])
  }
}

lauf('mart.einkaufspreis_monat', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
    await lageAufbauen(db)
  })
  afterAll(async () => { await db?.end() })

  test('gleichnamige Ware unter zwei IDs bildet EINE Preisreihe', async () => {
    /**
     * Der Kern: nach ware_key gruppiert entstünden hier zwei Reihen mit je
     * einem Punkt — eine Preisentwicklung wäre nicht darstellbar. FoodNotify
     * vergibt je Betrieb und Lieferant eigene IDs; im Echtbestand tragen
     * 866 Warensätze nur 428 verschiedene Namen.
     */
    const { rows } = await db.query(`
      SELECT bestellungen FROM mart.einkaufspreis_monat
       WHERE ware = 'Olivenöl 5L Kanister' AND monat = '2025-11-01'`)
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].bestellungen)).toBe(2)
  })

  test('führend ist der Preis JE GEBINDE — er braucht nur Summe und Menge', async () => {
    /**
     * Die Umstellung vom 03.08.2026 (Migration 0041). Der Preis je
     * Basiseinheit hing an FoodNotifys `unitQuantity` — und die schwankt
     * für dieselbe Ware zwischen 0,00035 und 50, also um Faktor 140.000.
     * In der Karte standen dadurch 48.400 €/kg für Kaffee.
     *
     * Der Gebindepreis braucht nur zwei Zahlen, die sauber in der Antwort
     * stehen: 50 € auf 2 Kanister und 110 € auf 4 — Median aus 25,00 und
     * 27,50.
     */
    const { rows: [r] } = await db.query(`
      SELECT preis_je_gebinde AS p, gebinde, menge FROM mart.einkaufspreis_monat
       WHERE ware = 'Olivenöl 5L Kanister' AND monat = '2025-11-01'`)
    expect(Number(r.p)).toBe(26.25)
    expect(Number(r.gebinde)).toBe(6)
    // Die Gesamtmenge bleibt als Summe erhalten.
    expect(Number(r.menge)).toBe(30)
  })

  test('der Preis je Einheit steht daneben, wo er belastbar ist', async () => {
    // Hier ist er es: 50 € auf 10 Liter, 110 € auf 20 — Median 5,25 €/l.
    const { rows: [r] } = await db.query(`
      SELECT preis_je_einheit_median AS p FROM mart.einkaufspreis_monat
       WHERE ware = 'Olivenöl 5L Kanister' AND monat = '2025-11-01'`)
    expect(Number(r.p)).toBe(5.25)
  })

  test('ein Preis, der den üblichen um mehr als das Zwanzigfache übersteigt, fliegt raus', async () => {
    /**
     * Echte Falschbuchungen im Quellsystem: 1.002.250 € für eine Packung
     * Falthandtücher, gemessen am 03.08.2026. Sie stehen so in FoodNotify
     * — wir lesen sie richtig, aber als Preis auszuweisen wäre falsch.
     *
     * Sie verschwinden nicht: `mart.einkauf_pruefung` zeigt sie mit Grund.
     */
    const { rows: [k] } = await db.query('SELECT kostenstelle_key FROM core.kostenstelle LIMIT 1')
    const { rows: [w] } = await db.query(
      `SELECT ware_key FROM core.ware WHERE fn_id = 'testware-a'`)
    await db.query('BEGIN')
    try {
      // Vier weitere Belege, damit der Median überhaupt greift (ab 4).
      for (let i = 0; i < 4; i++) {
        const { rows: [b] } = await db.query(
          `INSERT INTO core.bestellung (kostenstelle_key, fn_id, bestellt_am)
           VALUES ($1, $2, '2025-11-15') RETURNING bestellung_key`,
          [k.kostenstelle_key, `normal-${i}`])
        await db.query(
          `INSERT INTO core.bestellposition
             (bestellung_key, ware_key, name, menge, gebinde_menge, gesamt_menge,
              einheit, summe_preis, preis_je_einheit)
           VALUES ($1,$2,'Olivenöl 5L Kanister',2,5,10,'l',50,5)`,
          [b.bestellung_key, w.ware_key])
      }
      const { rows: [bx] } = await db.query(
        `INSERT INTO core.bestellung (kostenstelle_key, fn_id, bestellt_am)
         VALUES ($1, 'fehlbuchung', '2025-11-16') RETURNING bestellung_key`,
        [k.kostenstelle_key])
      // 100.000 € für einen Kanister — das Zwanzigfache ist längst überschritten.
      await db.query(
        `INSERT INTO core.bestellposition
           (bestellung_key, ware_key, name, menge, gebinde_menge, gesamt_menge,
            einheit, summe_preis)
         VALUES ($1,$2,'Olivenöl 5L Kanister',1,5,5,'l',100000)`,
        [bx.bestellung_key, w.ware_key])

      const { rows: [r] } = await db.query(`
        SELECT preis_max FROM mart.einkaufspreis_monat
         WHERE ware = 'Olivenöl 5L Kanister' AND monat = '2025-11-01'`)
      expect(Number(r.preis_max)).toBeLessThan(1000)

      // Und sie steht in der Prüfliste, statt still zu fehlen.
      const { rows: p } = await db.query(`
        SELECT grund FROM mart.einkauf_pruefung WHERE summe_preis = 100000`)
      expect(p).toHaveLength(1)
      expect(p[0].grund).toContain('ueber dem Ueblichen')
    } finally {
      await db.query('ROLLBACK')
    }
  })

  test('Positionen ohne Menge oder Preis fallen raus statt durch Null zu teilen', async () => {
    const { rows: [b] } = await db.query(
      `SELECT bestellung_key FROM core.bestellung LIMIT 1`)
    const { rows: [w] } = await db.query(
      `SELECT ware_key FROM core.ware WHERE fn_id = 'testware-a'`)
    await db.query('BEGIN')
    try {
      await db.query(
        `INSERT INTO core.bestellposition
           (bestellung_key, ware_key, name, gesamt_menge, einheit, summe_preis)
         VALUES ($1,$2,'Olivenöl 5L Kanister',0,'l',40)`,
        [b.bestellung_key, w.ware_key])
      // Kein Division-durch-Null-Fehler, und die Zeile zaehlt nicht mit.
      const { rows } = await db.query(`
        SELECT bestellungen FROM mart.einkaufspreis_monat
         WHERE ware = 'Olivenöl 5L Kanister' AND monat = '2025-11-01'`)
      expect(Number(rows[0].bestellungen)).toBe(2)
    } finally {
      await db.query('ROLLBACK')
    }
  })
})

lauf('mart.einkaufspreis_veraenderung', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
    await lageAufbauen(db)
  })
  afterAll(async () => { await db?.end() })

  test('echter Vormonat wird verglichen', async () => {
    // November 5,25 → Dezember 6,00 = +14,3 %.
    const { rows: [r] } = await db.query(`
      SELECT veraenderung_pct FROM mart.einkaufspreis_veraenderung
       WHERE ware = 'Olivenöl 5L Kanister' AND monat = '2025-12-01'`)
    expect(Number(r.veraenderung_pct)).toBeCloseTo(14.3, 1)
  })

  test('nach einer Lücke wird KEINE Monatsveränderung erfunden', async () => {
    /**
     * Zwischen Dezember und Februar liegt ein Monat ohne Bestellung.
     * `lag()` nimmt ohne Prüfung die letzte vorhandene Zeile — der Sprung
     * 6,00 → 9,00 wäre dann als Monatsveränderung ausgewiesen, obwohl er
     * zwei Monate umfasst. Bei Waren, die nur zweimal im Jahr bestellt
     * werden, wäre das ein Halbjahressprung im Monatsbericht.
     */
    const { rows: [r] } = await db.query(`
      SELECT veraenderung_pct, vormonat FROM mart.einkaufspreis_veraenderung
       WHERE ware = 'Olivenöl 5L Kanister' AND monat = '2026-02-01'`)
    expect(r.veraenderung_pct).toBeNull()
    // Der Vormonat steht trotzdem da — nachvollziehbar, warum nicht gerechnet wurde.
    expect(r.vormonat).not.toBeNull()
  })
})

lauf('mart.einkauf_ladestand', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
    await lageAufbauen(db)
  })
  afterAll(async () => { await db?.end() })

  test('meldet, welcher Monat vollständig geladen ist', async () => {
    /**
     * Der Backfill läuft rückwärts von heute. Ohne diese Sicht sieht ein
     * dünner Monat in der Vergangenheit aus wie ein Umsatzeinbruch — es ist
     * aber der Ladestand.
     */
    await db.query('BEGIN')
    try {
      const { rows: [k] } = await db.query('SELECT kostenstelle_key FROM core.kostenstelle LIMIT 1')
      // Eine Bestellung OHNE Positionen: der halb geladene Fall.
      await db.query(
        `INSERT INTO core.bestellung (kostenstelle_key, fn_id, bestellt_am)
         VALUES ($1, 'ohne-positionen', '2025-11-25')`, [k.kostenstelle_key])
      const { rows: [r] } = await db.query(`
        SELECT bestellungen, mit_positionen, positionen_pct, ohne_positionen
          FROM mart.einkauf_ladestand WHERE monat = '2025-11-01'`)
      expect(Number(r.bestellungen)).toBe(3)
      expect(Number(r.mit_positionen)).toBe(2)
      expect(Number(r.positionen_pct)).toBeCloseTo(66.7, 1)
      // Dieselbe Aussage absolut. 66,7 % liest man weg, „1" nicht.
      expect(Number(r.ohne_positionen)).toBe(1)
    } finally {
      await db.query('ROLLBACK')
    }
  })

  /**
   * DIE DREI ZUSTAENDE (Migration 0075, Plan 3.1/3.2).
   *
   * Bis dahin hiess `liste_vollstaendig` schlicht „keine offene
   * fn:bestellungen-Seite". Am 14.08.2026 um 00:16, waehrend Lauf 90 lief,
   * standen damit **alle 251** Monatszeilen aller vier Marken auf
   * „… laedt" — nicht die 60, die der Plan erwartet hatte. Der naechtliche
   * Lauf reiht je Kostenstelle die letzte Bestellseite ein; solange die
   * abgearbeitet wird, ist „offene Seite" der Regelzustand und keine
   * Aussage.
   *
   * Die Unterscheidung ist nicht „offen oder nicht", sondern „hat ein
   * ganzer Lauf sie nicht weggearbeitet".
   */
  test('unterscheidet laufende Arbeit von Rueckstand und von fehlendem Zugriff', async () => {
    await db.query('BEGIN')
    try {
      const { rows: [k] } = await db.query(
        'SELECT kostenstelle_key, marke_key FROM core.kostenstelle LIMIT 1')
      await db.query('TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf RESTART IDENTITY CASCADE')

      // Ein Lauf, der vor einer Stunde begann und sauber endete.
      await db.query(
        `INSERT INTO sync.lauf (gestartet_am, beendet_am, ausloeser, status)
         VALUES (now() - interval '1 hour', now() - interval '30 minutes', 'zeitplan', 'ok')`)

      const seite = (erstelltVor: string, ergebnis: string | null, erpId: string) => db.query(
        `INSERT INTO sync.warteschlange
           (endpunkt, zeitraum_von, zeitraum_bis, marke_key, parameter,
            erstellt_am, erledigt_am, ergebnis)
         VALUES ('fn:bestellungen', current_date, current_date, $1, $4::jsonb,
                 now() - $2::interval, CASE WHEN $3::text IS NULL THEN NULL ELSE now() END, $3)`,
        [k.marke_key, erstelltVor, ergebnis, JSON.stringify({ erpId, seite: '1' })])

      const zustand = async () => (await db.query(
        `SELECT DISTINCT zustand, seiten_rueckstand, seiten_offen, seiten_kein_zugriff
           FROM mart.einkauf_ladestand`)).rows

      /*
       * 1. Eine Seite, die HEUTE NACHT entstanden ist. Sie ist offen, aber
       *    sie ist Arbeit — genau der Fall, der vorher alles einfaerbte.
       */
      await seite('10 minutes', null, '10483')
      let z = await zustand()
      expect(z).toHaveLength(1)
      expect(z[0].zustand).toBe('vollstaendig')
      expect(Number(z[0].seiten_offen)).toBe(1)
      expect(Number(z[0].seiten_rueckstand)).toBe(0)

      /*
       * 2. Eine Seite, die den Lauf von vorhin ueberlebt hat. Jetzt fehlen
       *    ganze Bestellungen, und die Prozentspalte sieht das nicht.
       */
      await seite('3 hours', null, '10485')
      z = await zustand()
      expect(z[0].zustand).toBe('laedt')
      expect(Number(z[0].seiten_rueckstand)).toBe(1)

      /*
       * 3. Ohne Rueckstand, aber mit einer dauerhaft verweigerten
       *    Kostenstelle: das ist kein Ladevorgang, sondern eine Grenze.
       */
      await db.query(
        `UPDATE sync.warteschlange SET erledigt_am = now(), ergebnis = 'ok'
          WHERE parameter->>'erpId' = '10485'`)
      await seite('3 hours', 'kein_zugriff', '11805')
      z = await zustand()
      expect(z[0].zustand).toBe('kein zugriff')
      expect(Number(z[0].seiten_kein_zugriff)).toBe(1)
    } finally {
      await db.query('ROLLBACK')
    }
  })
})

lauf('mart.einkauf_betrieb_monat', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
    await lageAufbauen(db)
  })
  afterAll(async () => { await db?.end() })

  test('nur zugeordnete Betriebe — eine Summe ohne Betrieb wäre nicht vergleichbar', async () => {
    await db.query('BEGIN')
    try {
      await db.query('UPDATE core.kostenstelle SET betrieb_key = NULL')
      const { rows } = await db.query('SELECT * FROM mart.einkauf_betrieb_monat')
      expect(rows).toEqual([])
    } finally {
      await db.query('ROLLBACK')
    }
  })

  test('summiert Einkauf je Betrieb, Bereich und Monat', async () => {
    const { rows: [r] } = await db.query(`
      SELECT betrieb, bereich, bestellungen, einkauf_netto
        FROM mart.einkauf_betrieb_monat WHERE monat = '2025-11-01'`)
    expect(r.betrieb).toBe('Testbetrieb Mart')
    expect(r.bereich).toBe('kueche')
    expect(Number(r.bestellungen)).toBe(2)
    expect(Number(r.einkauf_netto)).toBe(160)
  })
})
