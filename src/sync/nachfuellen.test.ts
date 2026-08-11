/**
 * Das selbsttätige Nachfüllen der Warteschlange.
 *
 * Diese Funktion läuft ab dem 02.08.2026 zu Beginn JEDES Sync-Laufs, nicht
 * mehr einmal täglich. Das verschiebt das Risiko: was vorher einmal am Tag
 * zu viel eingereiht wurde, wird jetzt bei jedem Lauf zu viel eingereiht.
 *
 * Geprüft wird deshalb vor allem, was NICHT nachwachsen darf:
 *
 *   * Momentaufnahmen (Stammdaten) — eine je Monat, nicht eine je Lauf.
 *     Der partielle Eindeutigkeitsindex (`WHERE erledigt_am IS NULL`)
 *     schützt hier NICHT: ein erledigter Posten blockiert nichts.
 *   * FoodNotifys letzte Bestellseite — eine offene je Kostenstelle.
 *
 * Und was sehr wohl nachwachsen SOLL: die Nachzügler-Tage. LINAs Berichte
 * füllen sich über Tage nach; ein erledigter Tag muss erneut geholt
 * werden, sonst stehen einmal gelesene Nullen für immer.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from 'pg'

const DB = process.env.TEST_DATABASE_URL
const lauf = DB ? describe : describe.skip

let db: Client

/** Offene Posten eines Endpunkts zählen. */
const offen = async (endpunkt: string): Promise<number> => {
  const { rows: [r] } = await db.query(
    `SELECT count(*)::int AS n FROM sync.warteschlange
      WHERE endpunkt = $1 AND erledigt_am IS NULL`, [endpunkt])
  return r.n
}

lauf('nachfuellen — was nicht nachwachsen darf', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB!
    db = new Client({ connectionString: DB })
    await db.connect()
  })
  afterAll(async () => { await db?.end() })

  beforeEach(async () => {
    await db.query('TRUNCATE sync.warteschlange')
  })

  test('zweimal nachfüllen legt nichts doppelt an', async () => {
    const { linaNachfuellen } = await import('./nachfuellen')
    const erst = await linaNachfuellen()
    const zweit = await linaNachfuellen()
    expect(erst).toBeGreaterThan(0)
    // Alles noch offen — nichts darf ein zweites Mal entstehen.
    expect(zweit).toBe(0)
  })

  test('eine ERLEDIGTE Momentaufnahme wird NICHT erneut eingereiht', async () => {
    /**
     * Der Kern. Der Eindeutigkeitsindex ist partiell und greift nur bei
     * offenen Posten. Würde hier nur auf `ON CONFLICT DO NOTHING` vertraut,
     * liefe die „monatliche" Momentaufnahme bei JEDEM Lauf — bei einem
     * Takt von Minuten also hunderte Male im Monat.
     */
    const { linaNachfuellen } = await import('./nachfuellen')
    await linaNachfuellen()

    const { istMomentaufnahme, AKTIVE_ENDPUNKTE } = await import('../lina/endpunkte')
    const moment = AKTIVE_ENDPUNKTE.find(istMomentaufnahme)
    if (!moment) return

    const vorher = await offen(moment.key)
    expect(vorher).toBe(1)

    // Als erledigt markieren — so, wie der Worker es täte.
    await db.query(
      `UPDATE sync.warteschlange SET erledigt_am = now() WHERE endpunkt = $1`, [moment.key])

    await linaNachfuellen()
    expect(await offen(moment.key)).toBe(0)
  })

  test('ein ERLEDIGTER Nachzügler-Tag wird sehr wohl erneut eingereiht', async () => {
    /**
     * Die Gegenprobe — und der Grund, warum die beiden Fälle
     * unterschiedlich behandelt werden MÜSSEN.
     *
     * LINAs Konzernberichte füllen sich über mehrere Tage nach. Ein Tag,
     * der zu früh geholt wurde, steht auf null. Bliebe er erledigt, wäre
     * diese Null endgültig — und eine falsche Null ist schlimmer als eine
     * Lücke, weil man sie nicht sieht.
     */
    const { linaNachfuellen } = await import('./nachfuellen')
    const { AKTIVE_ENDPUNKTE } = await import('../lina/endpunkte')
    const tages = AKTIVE_ENDPUNKTE.find(e => e.schrittweite === 'tag')
    if (!tages) return

    await linaNachfuellen()
    const vorher = await offen(tages.key)
    expect(vorher).toBeGreaterThan(0)

    await db.query(
      `UPDATE sync.warteschlange SET erledigt_am = now() WHERE endpunkt = $1`, [tages.key])
    expect(await offen(tages.key)).toBe(0)

    await linaNachfuellen()
    // Alle Tage des Fensters kommen zurück.
    expect(await offen(tages.key)).toBe(vorher)
  })

  test('ein Fehler beim Nachfüllen bricht den Lauf nicht ab', async () => {
    /**
     * `nachfuellen()` wirft nie: die Warteschlange enthält in aller Regel
     * noch Arbeit, und die soll getan werden, auch wenn das Auffüllen
     * scheitert.
     *
     * Der Fehler wird über eine gesperrte Tabelle erzeugt, NICHT über
     * `ALTER TABLE ... RENAME`. Die erste Fassung benannte
     * `sync.warteschlange` um und zurück — schlug der Test aber in der
     * Mitte fehl, blieb die Tabelle umbenannt und JEDE weitere Suite
     * scheiterte an „relation does not exist". Genau das ist am
     * 02.08.2026 passiert. Ein Test, der bei Misserfolg die Umgebung
     * kaputt hinterlässt, kostet mehr, als er prüft.
     *
     * Eine Sperre in einer eigenen Transaktion ist harmlos: sie endet
     * mit dem ROLLBACK, gleich wie der Test ausgeht.
     */
    const { nachfuellen } = await import('./nachfuellen')
    const { AKTIVE_ENDPUNKTE } = await import('../lina/endpunkte')

    /**
     * Der Fehler wird über eine verletzte Bedingung erzeugt: eine
     * Prüfregel, die jedes INSERT in die Warteschlange zurückweist.
     * Sie wird am Ende wieder entfernt — und selbst wenn das misslingt,
     * bleibt nur eine Regel zurück, keine fehlende Tabelle.
     */
    await db.query(`
      ALTER TABLE sync.warteschlange
        ADD CONSTRAINT test_nichts_geht CHECK (endpunkt = '__unmoeglich__') NOT VALID`)
    try {
      const stand = await nachfuellen()
      expect(stand).toEqual({ lina: 0, foodnotify: 0, ladenakte: 0 })
      // Und die Warteschlange ist unverändert leer geblieben.
      expect(await offen(AKTIVE_ENDPUNKTE[0]!.key)).toBe(0)
    } finally {
      await db.query('ALTER TABLE sync.warteschlange DROP CONSTRAINT test_nichts_geht')
    }
  })
})

lauf('nachfuellen — FoodNotifys laufender Abgleich', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB!
    process.env.FN_APOSTO_USER = 'test@aposto.eu'
    process.env.FN_APOSTO_PASSWORD = 'geheim'
    db = new Client({ connectionString: DB })
    await db.connect()
  })
  afterAll(async () => { await db?.end() })

  /**
   * Die Lage: eine Kostenstelle, für die der Backfill bereits eine
   * Bestellseite geholt hat — nur dann ist die Seitenzahl bekannt.
   */
  const lageAufbauen = async (seitenzahl: number) => {
    await db.query('TRUNCATE sync.warteschlange')
    await db.query('TRUNCATE core.bestellposition, core.bestellung')
    await db.query('DELETE FROM core.kostenstelle')
    await db.query(`DELETE FROM raw.api_antwort WHERE endpunkt = 'fn:bestellungen'`)

    const { rows: [m] } = await db.query(`
      INSERT INTO core.marke (schluessel, name) VALUES ('aposto','Aposto')
      ON CONFLICT (schluessel) DO UPDATE SET name = excluded.name RETURNING marke_key`)
    await db.query(
      `INSERT INTO core.kostenstelle
         (marke_key, kostenstelle_id, restaurant_id, erp_id, name, restaurant_name, art)
       VALUES ($1, 8001, 6001, 10483, 'Küche Test', 'Testbetrieb', 'kueche')`,
      [m.marke_key])

    await db.query(`SELECT core.partition_anlegen('raw.api_antwort', current_date)`)
    // Die Seitenzahl kommt AUS DER ANTWORT — mit Hülle, wie raw sie speichert.
    await db.query(
      `INSERT INTO raw.api_antwort
         (quelle, endpunkt, parameter, http_status, payload, payload_hash, payload_bytes)
       VALUES ('foodnotify', 'fn:bestellungen', $1::jsonb, 200, $2::jsonb, 'x', 1)`,
      [JSON.stringify({ erpId: '10483', seite: '1', markeKey: m.marke_key }),
       JSON.stringify({ payload: { page_count: seitenzahl, total_count: seitenzahl * 25, data: [] } })])
    return m.marke_key
  }

  test('holt die LETZTE Seite — dort stehen die neuesten Bestellungen', async () => {
    await lageAufbauen(76)
    const { foodnotifyNachfuellen } = await import('./nachfuellen')
    await foodnotifyNachfuellen()

    const { rows } = await db.query(`
      SELECT parameter->>'seite' AS seite, prioritaet FROM sync.warteschlange
       WHERE endpunkt = 'fn:bestellungen' AND erledigt_am IS NULL`)
    expect(rows).toHaveLength(1)
    expect(rows[0].seite).toBe('76')
    // VOR dem Backfill (89/90), HINTER LINAs Tagesdaten (10).
    expect(rows[0].prioritaet).toBe(20)
  })

  test('die Seitenzahl wächst mit — sie wird nicht gespeichert', async () => {
    await lageAufbauen(76)
    const { foodnotifyNachfuellen } = await import('./nachfuellen')
    await foodnotifyNachfuellen()
    await db.query(`UPDATE sync.warteschlange SET erledigt_am = now()
                     WHERE endpunkt = 'fn:bestellungen'`)

    // Neue Bestellungen: der Server meldet jetzt 77 Seiten.
    const { rows: [m] } = await db.query(`SELECT marke_key FROM core.marke WHERE schluessel='aposto'`)
    await db.query(
      `INSERT INTO raw.api_antwort
         (quelle, endpunkt, parameter, http_status, payload, payload_hash, payload_bytes)
       VALUES ('foodnotify', 'fn:bestellungen', $1::jsonb, 200, $2::jsonb, 'y', 1)`,
      [JSON.stringify({ erpId: '10483', seite: '76', markeKey: m.marke_key }),
       JSON.stringify({ payload: { page_count: 77, total_count: 1925, data: [] } })])

    await foodnotifyNachfuellen()
    const { rows } = await db.query(`
      SELECT parameter->>'seite' AS seite FROM sync.warteschlange
       WHERE endpunkt = 'fn:bestellungen' AND erledigt_am IS NULL`)
    expect(rows.map(r => r.seite)).toEqual(['77'])
  })

  test('solange ein Posten offen ist, kommt kein zweiter dazu', async () => {
    await lageAufbauen(76)
    const { foodnotifyNachfuellen } = await import('./nachfuellen')
    await foodnotifyNachfuellen()
    const zweit = await foodnotifyNachfuellen()
    expect(zweit).toBe(0)
  })

  test('eine Kostenstelle ohne bekannte Seitenzahl wird übersprungen', async () => {
    /**
     * Solange der Backfill die erste Seite nicht geholt hat, ist die
     * Seitenzahl unbekannt — und der Backfill deckt diese Kostenstelle
     * ohnehin gerade selbst ab. Raten wäre hier ein erfundener Abruf.
     */
    await lageAufbauen(76)
    await db.query(`DELETE FROM raw.api_antwort WHERE endpunkt = 'fn:bestellungen'`)
    await db.query('TRUNCATE sync.warteschlange')
    const { foodnotifyNachfuellen } = await import('./nachfuellen')
    await foodnotifyNachfuellen()
    expect(await offen('fn:bestellungen')).toBe(0)
  })
})

/**
 * Inventuren im laufenden Abgleich (seit 05.08.2026, Anforderung Eugene —
 * docs/entscheidungen.md).
 *
 * Drei Dinge sind hier anders als bei den Bestellungen, und genau die
 * werden geprüft: EIN Posten je MARKE statt je Kostenstelle, die
 * Seitenzahl aus `payload.pagination.totalPages` statt aus dem flachen
 * `page_count`, und ein sinnvoller Einstieg, solange noch nie etwas
 * geholt wurde.
 */
lauf('nachfuellen — Inventuren', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB!
    process.env.FN_APOSTO_USER = 'test@aposto.eu'
    process.env.FN_APOSTO_PASSWORD = 'geheim'
    db = new Client({ connectionString: DB })
    await db.connect()
  })
  afterAll(async () => { await db?.end() })

  /**
   * Zwei Kostenstellen derselben Marke — der Fall, an dem sich zeigt, ob
   * je Marke oder je Kostenstelle eingereiht wird.
   */
  const lageAufbauen = async (): Promise<number> => {
    await db.query('TRUNCATE sync.warteschlange')
    await db.query('DELETE FROM core.kostenstelle')
    await db.query(`DELETE FROM raw.api_antwort WHERE endpunkt = 'fn:inventuren'`)

    const { rows: [m] } = await db.query(`
      INSERT INTO core.marke (schluessel, name) VALUES ('aposto','Aposto')
      ON CONFLICT (schluessel) DO UPDATE SET name = excluded.name RETURNING marke_key`)
    await db.query(
      `INSERT INTO core.kostenstelle
         (marke_key, kostenstelle_id, restaurant_id, erp_id, name, restaurant_name, art)
       VALUES ($1, 8001, 6001, 10483, 'Küche Test', 'Testbetrieb', 'kueche'),
              ($1, 8002, 6001, 10484, 'Bar Test',   'Testbetrieb', 'bar')`,
      [m.marke_key])
    await db.query(`SELECT core.partition_anlegen('raw.api_antwort', current_date)`)
    return m.marke_key
  }

  /** Eine Inventurantwort in der erp-Hülle ablegen, wie raw sie speichert. */
  const antwortAblegen = async (markeKey: number, seiten: number, hash: string) => {
    await db.query(
      `INSERT INTO raw.api_antwort
         (quelle, endpunkt, parameter, http_status, payload, payload_hash, payload_bytes)
       VALUES ('foodnotify', 'fn:inventuren', $1::jsonb, 200, $2::jsonb, $3, 1)`,
      [JSON.stringify({ erpIds: '10483,10484', seite: '1', markeKey }),
       // Die erp-Hülle: payload.pagination.totalPages — NICHT page_count.
       JSON.stringify({ payload: { pagination: { currentPage: 1, totalPages: seiten,
                                                 totalItems: seiten * 25 }, data: [] } }),
       hash])
  }

  test('EIN Posten je Marke, nicht einer je Kostenstelle', async () => {
    /**
     * Der Kern des Unterschieds: `fn:inventuren` bündelt alle
     * Kostenstellen über `erpIds[]`. Zwei Kostenstellen dürfen deshalb
     * nur EINEN Posten ergeben — mit beiden erpIds darin.
     */
    const markeKey = await lageAufbauen()
    const { foodnotifyNachfuellen } = await import('./nachfuellen')
    await foodnotifyNachfuellen()

    const { rows } = await db.query(`
      SELECT parameter->>'erpIds' AS erp_ids, parameter->>'seite' AS seite, prioritaet
        FROM sync.warteschlange
       WHERE endpunkt = 'fn:inventuren' AND erledigt_am IS NULL`)
    expect(rows).toHaveLength(1)
    expect(rows[0].erp_ids).toBe('10483,10484')
    expect(rows[0].prioritaet).toBe(20)
    expect(markeKey).toBeGreaterThan(0)
  })

  test('ohne bisherige Antwort ist Seite 1 der Einstieg', async () => {
    /**
     * Solange nie Inventuren geholt wurden, IST die letzte Seite die
     * erste. Das ist der Grund, warum der laufende Abgleich denselben
     * Durchstich anstößt wie der Backfill-Schalter: Seite 1 reiht beim
     * Laden alle Folgeseiten ein.
     */
    await lageAufbauen()
    const { foodnotifyNachfuellen } = await import('./nachfuellen')
    await foodnotifyNachfuellen()

    const { rows } = await db.query(`
      SELECT parameter->>'seite' AS seite FROM sync.warteschlange
       WHERE endpunkt = 'fn:inventuren' AND erledigt_am IS NULL`)
    expect(rows.map(r => r.seite)).toEqual(['1'])
  })

  test('die Seitenzahl kommt aus pagination.totalPages, nicht aus page_count', async () => {
    /**
     * Die Falle mit dem stillen Fehlschlag: `/api/erp/*` liefert die
     * erp-Hülle, `/api/{erpId}/*` die flache. Griffe der Code an die
     * falsche Stelle, käme NULL statt eines Fehlers — der Abgleich bliebe
     * für immer auf Seite 1 und holte nie die neuesten Zählungen.
     */
    const markeKey = await lageAufbauen()
    await antwortAblegen(markeKey, 12, 'inv-a')

    const { foodnotifyNachfuellen } = await import('./nachfuellen')
    await foodnotifyNachfuellen()

    const { rows } = await db.query(`
      SELECT parameter->>'seite' AS seite FROM sync.warteschlange
       WHERE endpunkt = 'fn:inventuren' AND erledigt_am IS NULL`)
    expect(rows.map(r => r.seite)).toEqual(['12'])
  })

  test('solange ein Posten offen ist, kommt kein zweiter dazu', async () => {
    await lageAufbauen()
    const { foodnotifyNachfuellen } = await import('./nachfuellen')
    await foodnotifyNachfuellen()
    const vorher = await offen('fn:inventuren')
    await foodnotifyNachfuellen()
    expect(await offen('fn:inventuren')).toBe(vorher)
  })

  test('eine Marke ohne Kostenstellen wird übersprungen', async () => {
    /**
     * Ohne erpIds würfe der Pfadbau beim Abarbeiten („erpIds im Posten
     * ist leer"). Dann ist der Bestellungs-Backfill dieser Marke ohnehin
     * noch nicht gelaufen — ein Posten wäre nur Arbeit, die scheitert.
     */
    await lageAufbauen()
    await db.query('DELETE FROM core.kostenstelle')
    await db.query('TRUNCATE sync.warteschlange')
    const { foodnotifyNachfuellen } = await import('./nachfuellen')
    await foodnotifyNachfuellen()
    expect(await offen('fn:inventuren')).toBe(0)
  })
})
