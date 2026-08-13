/**
 * Die Betriebszuordnung FoodNotify ↔ LINA (Migration 0034).
 *
 * Warum dieser Test existiert: eine FALSCHE Zuordnung ist schlimmer als
 * gar keine. Sie rechnet den Wareneinsatz eines Betriebs gegen den Umsatz
 * eines anderen — und niemand sieht es der Kennzahl an. Ein NULL-Wert
 * meldet sich; eine stille Fehlzuordnung nicht.
 *
 * Geprüft werden deshalb die drei gemessenen Fallen (02.08.2026), nicht
 * die Trefferquote: eine Quote steigt auch, wenn man falscher wird.
 *
 * Übersprungen ohne TEST_DATABASE_URL, wie die übrigen DB-Tests.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from 'pg'

const DB = process.env.TEST_DATABASE_URL
const lauf = DB ? describe : describe.skip

let db: Client

lauf('core.name_norm — Namen vergleichbar machen', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
  })
  afterAll(async () => { await db?.end() })

  const norm = async (s: string): Promise<string> =>
    (await db.query('SELECT core.name_norm($1) AS n', [s])).rows[0].n

  test('LINA schreibt den Betriebszustand in den Namen — er darf nicht mitvergleichen', async () => {
    expect(await norm('GESCHLOSSEN Enchilada Dresden GmbH')).toBe('enchilada dresden')
    expect(await norm('INSOLVENT - Aposto Muenster GmbH')).toBe('aposto muenster')
  })

  test('Umlaute fallen zusammen: FoodNotify schreibt ü, LINA ue', async () => {
    expect(await norm('Aposto Münster')).toBe(await norm('Aposto Muenster'))
  })

  test('GESTAPELTE Rechtsformen verschwinden vollständig', async () => {
    /**
     * Der Fall, an dem ein einzelner Durchlauf scheiterte: hier stehen
     * ZWEI Rechtsform-Wörter hintereinander. Blieb "gaststattenbetriebs"
     * stehen, verlor der aktive Betrieb (0.4) gegen die stillgelegte
     * Gesellschaft "GESCHLOSSEN Alte Post Aachen GmbH" (0.8) — der
     * Automat hätte die falsche, längst geschlossene Firma vorgeschlagen.
     */
    expect(await norm('Alte Post Aachen Gaststättenbetriebs GmbH')).toBe('alte post aachen')
    expect(await norm('GESCHLOSSEN Alte Post Aachen GmbH')).toBe('alte post aachen')
  })

  /**
   * DER APOSTROPH — derselbe Fehler wie bei den Umlauten, ein Zeichen weiter.
   *
   * Bis zum 13.08.2026 übersetzte `name_norm` die Zeichen ´ ` ' in
   * LEERZEICHEN statt sie zu entfernen, und das typografische ’ kannte sie
   * gar nicht. Aus „Lehner´s" wurde „lehner s" statt „lehners" — gegen LINAs
   * „Lehners Wirtshaus Rastatt GmbH" ergab das 0.83 statt Gleichheit, also
   * `unsicher` statt `exakt`, also keine Zuordnung.
   *
   * In Produktion gemessen: 59 exakte Treffer vorher, 60 nachher, 0 verloren,
   * keine neue Kollision. Genau ein Betrieb hing daran.
   */
  test('Apostrophe verschwinden, statt zu Leerzeichen zu werden', async () => {
    // Der gemessene Fall, Zeichen für Zeichen wie in den beiden Systemen.
    expect(await norm('Lehner´s Wirtshaus Rastatt GmbH'))
      .toBe(await norm('Lehners Wirtshaus Rastatt GmbH'))

    // Alle fünf Varianten, die in freien Namensfeldern vorkommen — der
    // typografische Apostroph ist der, den ein Mac von selbst einsetzt.
    for (const zeichen of ['´', '`', "'", '’', '‘']) {
      expect(await norm(`Lehner${zeichen}s Wirtshaus`)).toBe('lehners wirtshaus')
    }

    // Die Gegenprobe: ein Bindestrich ist KEIN Apostroph und trennt weiter.
    // Ohne sie würde eine zu gierige Zeichenliste hier unbemerkt Wörter
    // zusammenziehen.
    expect(await norm('Aposto Wuppertal - Alter Papierfabrik'))
      .toBe('aposto wuppertal - alter papierfabrik')
  })
})

/**
 * Die Testlage: genau die Namen, an denen der Automat gemessen gescheitert
 * ist. Sie werden hier angelegt, statt sie im Produktivbestand vorauszusetzen
 * — sonst prüft der Test, ob heute zufällig die richtigen Daten dastehen.
 */
async function lageAufbauen(c: Client) {
  /**
   * Die Testlage ist die EINZIGE Lage: andere Kostenstellen (etwa aus dem
   * e2e-Lauf in derselben Datenbank) würden sonst mit in die Vorschläge
   * geraten und die Zählungen verfälschen. Reihenfolge wegen der
   * Fremdschlüssel: Positionen, Bestellungen, dann Kostenstellen.
   */
  await c.query('TRUNCATE manual.betrieb_zuordnung')
  await c.query('TRUNCATE core.bestellposition, core.bestellung')
  await c.query('DELETE FROM core.kostenstelle')
  await c.query(`DELETE FROM core.betrieb WHERE enc_id LIKE 'test-enc-%'`)

  const { rows: [marke] } = await c.query(`
    INSERT INTO core.marke (schluessel, name) VALUES ('aposto','Aposto')
    ON CONFLICT (schluessel) DO UPDATE SET name = excluded.name
    RETURNING marke_key`)

  // betrieb_key und marke_key sind GENERATED ALWAYS — die Schlüssel kommen
  // aus der Datenbank zurück, sie werden nicht vorgegeben.
  const betriebKey: Record<string, number> = {}
  for (const name of [
    'Alte Post Aachen Gaststättenbetriebs GmbH',
    'GESCHLOSSEN Alte Post Aachen GmbH',
    'Aposto Wuppertal GmbH',
    'Aposto Wuppertal - Alter Papierfabrik',
    'Aposto Gera GmbH',
  ]) {
    const { rows: [b] } = await c.query(
      `INSERT INTO core.betrieb (name, enc_id) VALUES ($1,$2) RETURNING betrieb_key`,
      [name, `test-enc-${name.slice(0, 20)}`])
    betriebKey[name] = b.betrieb_key
  }

  const ks: [number, number, string][] = [
    [9001, 7001, 'Aposto Aachen - Alte Post'],
    [9002, 7002, 'Aposto Wuppertal'],
    [9003, 7003, 'Aposto Wuppertal II'],
    [9004, 7004, 'Aposto Gera'],
    [9005, 7005, 'AAA Testbetrieb Aposto'],
  ]
  for (const [ksId, restId, name] of ks) {
    await c.query(
      `INSERT INTO core.kostenstelle
         (marke_key, kostenstelle_id, restaurant_id, name, restaurant_name, art)
       VALUES ($1,$2,$3,$4,$4,'kueche')
       ON CONFLICT (marke_key, kostenstelle_id) DO UPDATE SET
         restaurant_id = excluded.restaurant_id,
         restaurant_name = excluded.restaurant_name,
         betrieb_key = NULL`,
      [marke.marke_key, ksId, restId, name])
  }
  await c.query('SELECT manual.betrieb_vorschlaege_berechnen()')
  return betriebKey
}

lauf('Vorschläge — die drei gemessenen Fallen', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
    await lageAufbauen(db)
  })
  afterAll(async () => { await db?.end() })

  /** Bewertet ein Namenspaar so, wie es die Vorschlagsfunktion tut. */
  const punkte = async (fn: string, li: string): Promise<number> => {
    const { rows: [r] } = await db.query(`
      WITH n AS (SELECT core.name_norm($1) AS a, core.name_norm($2) AS b)
      SELECT (similarity(a, b) + 2 * coalesce(
                (SELECT count(*)::numeric FROM (
                   SELECT unnest(string_to_array(a,' '))
                   INTERSECT SELECT unnest(string_to_array(b,' '))) x)
              / nullif((SELECT count(*)::numeric FROM (
                   SELECT unnest(string_to_array(a,' '))
                   UNION SELECT unnest(string_to_array(b,' '))) y), 0), 0)) / 3
             AS p FROM n`, [fn, li])
    return Number(r.p)
  }

  test('Enchilada Halle gewinnt gegen Enchilada Hamm — Trigramm allein läge falsch', async () => {
    /**
     * DIE zentrale Messung: nach reiner Trigramm-Ähnlichkeit ist "Hamm"
     * (0.63) ÄHNLICHER als der richtige Treffer "Halle" (0.53). Erst die
     * doppelt gewichtete Wortüberschneibung dreht es um — gemeinsame ganze
     * Wörter wiegen bei Ortsnamen schwerer als Buchstabenfolgen.
     */
    const richtig = await punkte('Enchilada Halle', 'GESCHLOSSEN Enchilada Halle Gaststättenbetriebs Gm')
    const falsch = await punkte('Enchilada Halle', 'Enchilada Hamm')
    expect(richtig).toBeGreaterThan(falsch)
  })

  test('der aktive Betrieb schlägt den stillgelegten bei gleichem Namen', async () => {
    const { rows: [r] } = await db.query(`
      SELECT vorschlag_key, grund FROM manual.betrieb_zuordnung
       WHERE fn_name = 'Aposto Aachen - Alte Post'`)
    // Nicht 71 ("GESCHLOSSEN Alte Post Aachen GmbH").
    if (r?.vorschlag_key !== null && r?.vorschlag_key !== undefined) {
      const { rows: [b] } = await db.query(
        'SELECT name FROM core.betrieb WHERE betrieb_key = $1', [r.vorschlag_key])
      expect(b.name).not.toMatch(/^(GESCHLOSSEN|INSOLVENT)/i)
    }
  })

  test('kein LINA-Betrieb wird zweimal automatisch vergeben', async () => {
    /**
     * "Aposto Wuppertal II" trifft namentlich am besten auf denselben
     * Betrieb wie "Aposto Wuppertal" — daneben steht aber der
     * Zweitstandort "Alter Papierfabrik". Kein Ähnlichkeitsmaß bemerkt
     * das: es vergleicht Paare, nicht die Gesamtverteilung. Solche Fälle
     * müssen 'unsicher' werden, nicht automatisch gesetzt.
     */
    const { rows } = await db.query(`
      SELECT vorschlag_key, count(*)::int AS n
        FROM manual.betrieb_zuordnung
       WHERE vorschlag_key IS NOT NULL AND grund IN ('exakt','variante')
       GROUP BY 1 HAVING count(*) > 1`)
    expect(rows).toEqual([])
  })

  test('Testbetriebe werden nie zugeordnet, auch bei gutem Namenstreffer', async () => {
    const { rows } = await db.query(`
      SELECT fn_name FROM manual.betrieb_zuordnung
       WHERE fn_name ~* '(^|\\s)(aaa|test)' AND NOT ohne_gegenstueck`)
    expect(rows).toEqual([])
  })
})

lauf('Anwenden — offen ist besser als falsch', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
    await lageAufbauen(db)
    await db.query('SELECT manual.betrieb_zuordnung_anwenden()')
  })
  afterAll(async () => { await db?.end() })

  test('unsichere Fälle bleiben NULL statt geraten zu werden', async () => {
    const { rows } = await db.query(`
      SELECT k.restaurant_id, k.betrieb_key
        FROM core.kostenstelle k
        JOIN manual.betrieb_zuordnung z USING (restaurant_id)
       WHERE z.grund IN ('unsicher','kein_treffer','testbetrieb')
         AND z.entscheidung_key IS NULL
         AND k.betrieb_key IS NOT NULL`)
    expect(rows).toEqual([])
  })

  test('eine menschliche Entscheidung schlägt den Vorschlag immer', async () => {
    const { rows: [z] } = await db.query(`
      SELECT restaurant_id, vorschlag_key FROM manual.betrieb_zuordnung
       WHERE grund = 'exakt' AND vorschlag_key IS NOT NULL LIMIT 1`)
    if (!z) return

    const { rows: [andere] } = await db.query(
      'SELECT betrieb_key FROM core.betrieb WHERE betrieb_key <> $1 LIMIT 1', [z.vorschlag_key])

    await db.query('BEGIN')
    try {
      await db.query(
        'UPDATE manual.betrieb_zuordnung SET entscheidung_key = $2 WHERE restaurant_id = $1',
        [z.restaurant_id, andere.betrieb_key])
      await db.query('SELECT manual.betrieb_zuordnung_anwenden()')
      const { rows } = await db.query(
        'SELECT DISTINCT betrieb_key FROM core.kostenstelle WHERE restaurant_id = $1',
        [z.restaurant_id])
      expect(rows[0].betrieb_key).toBe(andere.betrieb_key)
    } finally {
      // Der Test darf den Bestand nicht verändern — er misst, er entscheidet nicht.
      await db.query('ROLLBACK')
    }
  })

  test('ein erneuter Lauf überschreibt getroffene Entscheidungen NICHT', async () => {
    const { rows: [z] } = await db.query(`
      SELECT restaurant_id FROM manual.betrieb_zuordnung LIMIT 1`)
    await db.query('BEGIN')
    try {
      await db.query(
        `UPDATE manual.betrieb_zuordnung
            SET entscheidung_key = (SELECT min(betrieb_key) FROM core.betrieb),
                notiz = 'Testnotiz'
          WHERE restaurant_id = $1`, [z.restaurant_id])
      await db.query('SELECT manual.betrieb_vorschlaege_berechnen()')
      const { rows: [nachher] } = await db.query(
        'SELECT entscheidung_key, notiz FROM manual.betrieb_zuordnung WHERE restaurant_id = $1',
        [z.restaurant_id])
      expect(nachher.entscheidung_key).not.toBeNull()
      expect(nachher.notiz).toBe('Testnotiz')
    } finally {
      await db.query('ROLLBACK')
    }
  })
})
