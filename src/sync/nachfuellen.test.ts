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
      expect(stand).toEqual({ lina: 0, foodnotify: 0, ladenakte: 0, wiederbelebt: 0 })
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

/**
 * ================================================================
 * WAS DER LAUF SEIT DEM 13.08.2026 VON SELBST REPARIERT
 * ================================================================
 *
 * Beides stand kurzzeitig als Handbefehl in `einreihen.ts`. Entscheidung
 * Eugene vom selben Tag: kein Befehl auf dem Server. Was fehlt, holt der
 * Lauf — und was der Lauf holt, muss ein Test begrenzen, sonst wird aus
 * "repariert sich selbst" ein Posten, der jede Nacht wiederkommt.
 */
lauf('nachfuellen — Selbstreparatur', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB!
    db = new Client({ connectionString: DB })
    await db.connect()
  })
  afterAll(async () => { await db?.end() })

  const zahl = async (sql: string, p: unknown[] = []) =>
    Number((await db.query(sql, p)).rows[0].n)

  // --- Inventurzaehlung -------------------------------------------------

  /**
   * Eine Inventur, deren Kopf mehr Positionen meldet als geladen sind —
   * genau die Lage der neun in Produktion, die bei exakt 800 abgeschnitten
   * waren (936 fehlende Positionen).
   */
  const inventurAufbauen = async (kopf: number, geladen: number) => {
    await db.query('TRUNCATE sync.warteschlange')
    await db.query('TRUNCATE core.inventurposition, core.inventur CASCADE')
    await db.query('DELETE FROM core.kostenstelle')
    const { rows: [m] } = await db.query(`
      INSERT INTO core.marke (schluessel, name) VALUES ('aposto','Aposto')
      ON CONFLICT (schluessel) DO UPDATE SET name = excluded.name RETURNING marke_key`)
    const { rows: [ks] } = await db.query(
      `INSERT INTO core.kostenstelle
         (marke_key, kostenstelle_id, restaurant_id, erp_id, name, restaurant_name, art)
       VALUES ($1, 8001, 6001, 10483, 'Küche Test', 'Testbetrieb', 'kueche')
       RETURNING kostenstelle_key`, [m.marke_key])
    const { rows: [i] } = await db.query(
      `INSERT INTO core.inventur
         (kostenstelle_key, fn_uuid, name, art, status, anzahl_positionen, erstellt_am)
       VALUES ($1, 'inv-luecke', 'Kücheninventur', 'full', 'signed', $2, '2026-07-31')
       RETURNING inventur_key`, [ks.kostenstelle_key, kopf])
    for (let n = 0; n < geladen; n++) {
      await db.query(
        `INSERT INTO core.inventurposition (inventur_key, fn_id, name) VALUES ($1,$2,$3)`,
        [i.inventur_key, `p${n}`, `Ware ${n}`])
    }
    return m.marke_key as number
  }

  test('eine unvollstaendige Zaehlung wird von selbst nachgereiht — Seite 1', async () => {
    const marke = await inventurAufbauen(5, 3)
    const { inventurpositionenNachziehen } = await import('./nachfuellen')
    expect(await inventurpositionenNachziehen(marke)).toBe(1)

    const { rows } = await db.query(
      `SELECT parameter, prioritaet, zeitraum_von::text FROM sync.warteschlange
        WHERE endpunkt = 'fn:inventurpositionen'`)
    expect(rows).toHaveLength(1)
    expect(rows[0].parameter).toEqual({ uuid: 'inv-luecke', seite: '1' })
    // Der Zeitraum ist das Anlagedatum der Inventur, nicht heute — sonst
    // zeigt der Fortschritt ueberall "heute" statt des Jahres.
    expect(rows[0].zeitraum_von).toBe('2026-07-31')
    expect(rows[0].prioritaet).toBe(94)
  })

  /**
   * DER TEIL, DER WEHTUT, WENN ER FEHLT. 349 der 358 Inventuren in
   * Produktion sind vollstaendig. Feuerte die Bedingung auch fuer sie,
   * stellte der Lauf jede Nacht 358 Posten ein statt neun.
   */
  test('eine vollstaendige Zaehlung wird NICHT nachgereiht', async () => {
    const marke = await inventurAufbauen(3, 3)
    const { inventurpositionenNachziehen } = await import('./nachfuellen')
    expect(await inventurpositionenNachziehen(marke)).toBe(0)
    expect(await zahl(
      `SELECT count(*)::int AS n FROM sync.warteschlange
        WHERE endpunkt = 'fn:inventurpositionen'`)).toBe(0)
  })

  test('solange der Posten offen ist, kommt kein zweiter dazu', async () => {
    const marke = await inventurAufbauen(5, 3)
    const { inventurpositionenNachziehen } = await import('./nachfuellen')
    await inventurpositionenNachziehen(marke)
    expect(await inventurpositionenNachziehen(marke)).toBe(0)
  })

  /**
   * Gesperrt wird gegen JEDE offene Seite derselben Inventur, nicht nur
   * gegen Seite 1. Sonst stellt der naechste Lauf eine zweite Seite 1,
   * waehrend Seite 2 noch laeuft — und Seite 1 loescht beim Laden alles,
   * was Seite 2 gerade geschrieben hat.
   */
  test('auch eine offene Folgeseite sperrt — sonst loescht Seite 1 sie weg', async () => {
    const marke = await inventurAufbauen(5, 3)
    await db.query(
      `INSERT INTO sync.warteschlange
         (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
       VALUES ('fn:inventurpositionen', current_date, current_date, 94, $1,
               '{"uuid":"inv-luecke","seite":"2"}')`, [marke])
    const { inventurpositionenNachziehen } = await import('./nachfuellen')
    expect(await inventurpositionenNachziehen(marke)).toBe(0)
  })

  // --- Aufgegebene Posten ----------------------------------------------

  /** Ein aufgegebener Posten, gestern gescheitert, Quelle antwortet heute. */
  const aufgegebenenAufbauen = async (opt: {
    wiederbelebt?: number; alterStunden?: number; quelleAntwortet?: boolean
  } = {}) => {
    await db.query('TRUNCATE sync.warteschlange')
    await db.query('DELETE FROM sync.aufgabe'); await db.query('DELETE FROM sync.lauf')
    await db.query(
      `INSERT INTO sync.warteschlange
         (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, parameter,
          versuche, erledigt_am, ergebnis, letzter_fehler, wiederbelebt)
       VALUES ('fn:bestellpositionen', current_date, current_date, 90,
               '{"erpId":"10483","orderId":"b1"}', 4,
               now() - make_interval(hours => $1), 'aufgegeben', 'HTTP 500', $2)`,
      [opt.alterStunden ?? 30, opt.wiederbelebt ?? 0])
    if (opt.quelleAntwortet !== false) {
      // sync.aufgabe.lauf_id ist ein Fremdschluessel auf sync.lauf — ohne den
      // Lauf gibt es die Aufgabe nicht. lauf_id ist GENERATED ALWAYS, die
      // Nummer kommt also von der Datenbank und nicht aus dem Test.
      const { rows: [l] } = await db.query(
        `INSERT INTO sync.lauf (ausloeser, status, beendet_am)
         VALUES ('manuell', 'ok', now() - interval '2 hours') RETURNING lauf_id`)
      await db.query(
        `INSERT INTO sync.aufgabe (lauf_id, endpunkt, versuch, status, zeilen, beendet_am)
         VALUES ($1, 'fn:bestellpositionen', 1, 'ok', 5, now() - interval '2 hours')`,
        [l.lauf_id])
    }
  }

  test('ein aufgegebener Posten kommt von selbst zurueck', async () => {
    await aufgegebenenAufbauen()
    const { aufgegebeneWiederbeleben } = await import('./nachfuellen')
    expect(await aufgegebeneWiederbeleben()).toBe(1)

    const { rows: [p] } = await db.query(
      `SELECT erledigt_am, ergebnis, versuche, wiederbelebt FROM sync.warteschlange`)
    expect(p.erledigt_am).toBeNull()
    expect(p.ergebnis).toBeNull()
    // versuche faengt neu an, wiederbelebt zaehlt die Leben.
    expect(p.versuche).toBe(0)
    expect(p.wiederbelebt).toBe(1)
  })

  /**
   * DIE OBERGRENZE IST DER GANZE PUNKT. Ohne sie kostet ein dauerhaft
   * kaputter Posten jede Nacht MAX_VERSUCHE Aufrufe und kommt nie zur
   * Ruhe — derselbe Bau wie der 403-Zweig im Worker, der seit neun Tagen
   * bei netto plus minus null steht.
   */
  test('nach drei Wiederbelebungen bleibt er liegen', async () => {
    await aufgegebenenAufbauen({ wiederbelebt: 3 })
    const { aufgegebeneWiederbeleben } = await import('./nachfuellen')
    expect(await aufgegebeneWiederbeleben()).toBe(0)
    expect(await zahl(
      `SELECT count(*)::int AS n FROM sync.warteschlange WHERE ergebnis = 'aufgegeben'`)).toBe(1)
  })

  /**
   * Ohne diese Bedingung verbraeuchte ein zweitaegiger Ausfall der
   * Gegenstelle alle drei Wiederbelebungen aller Posten — ausgerechnet
   * bevor sie wieder erreichbar ist.
   */
  test('schweigt die Quelle, ruht die Wiederbelebung', async () => {
    await aufgegebenenAufbauen({ quelleAntwortet: false })
    const { aufgegebeneWiederbeleben } = await import('./nachfuellen')
    expect(await aufgegebeneWiederbeleben()).toBe(0)
  })

  /** Fuenf Sync-Laeufe an einem Tag (12.08.2026) duerfen nicht fuenf Leben kosten. */
  test('zweimal am selben Tag zaehlt einmal', async () => {
    await aufgegebenenAufbauen({ alterStunden: 2 })
    const { aufgegebeneWiederbeleben } = await import('./nachfuellen')
    expect(await aufgegebeneWiederbeleben()).toBe(0)
  })

  test('ein offener Zwilling verhindert das Wiederbeleben', async () => {
    await aufgegebenenAufbauen()
    await db.query(
      `INSERT INTO sync.warteschlange
         (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, parameter)
       VALUES ('fn:bestellpositionen', current_date, current_date, 90,
               '{"erpId":"10483","orderId":"b1"}')`)
    const { aufgegebeneWiederbeleben } = await import('./nachfuellen')
    // Ohne diese Sperre verletzte das UPDATE den partiellen
    // Eindeutigkeitsindex warteschlange_offen_uq.
    expect(await aufgegebeneWiederbeleben()).toBe(0)
  })

  test('mart.posten_aufgegeben trennt "wird versucht" von "endgueltig"', async () => {
    await aufgegebenenAufbauen({ wiederbelebt: 3 })
    const { rows } = await db.query(
      `SELECT zustand, wiederbelebt, quelle_antwortet FROM mart.posten_aufgegeben`)
    expect(rows[0]).toMatchObject({ zustand: 'endgueltig', wiederbelebt: 3, quelle_antwortet: true })

    await aufgegebenenAufbauen({ wiederbelebt: 1 })
    const { rows: r2 } = await db.query(`SELECT zustand FROM mart.posten_aufgegeben`)
    expect(r2[0].zustand).toBe('wird erneut versucht')
  })
})

/**
 * Der Takt der Momentaufnahmen — Punkt 2.9 des Plans.
 *
 * `analyticsFilterOptions` ist die EINZIGE Quelle für
 * `core.betrieb.lina_betrieb_id`, und daran hängt alles Betriebsbezogene:
 * die BWA über `getKennzahlen` und seit Migration 0069 die tägliche Zählung
 * des Belegarchivs. Im Monatstakt wartete ein neu eröffneter Betrieb bis zu
 * vier Wochen auf seine erste Zählung — derselbe Fall, den 0069 für die
 * Ordner gelöst hat, eine Ebene höher.
 */
lauf('Takt der Momentaufnahmen', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB!
    db = new Client({ connectionString: DB })
    await db.connect()
  })
  afterAll(async () => { await db?.end() })
  beforeEach(async () => { await db.query('TRUNCATE sync.warteschlange') })

  const zeitraeume = async (endpunkt: string): Promise<string[]> => {
    const { rows } = await db.query(
      `SELECT zeitraum_von::text AS d FROM sync.warteschlange
        WHERE endpunkt = $1 ORDER BY zeitraum_von`, [endpunkt])
    return rows.map(r => r.d)
  }

  test('analyticsFilterOptions läuft wöchentlich, auf den Montag gesetzt', async () => {
    const { linaNachfuellen } = await import('./nachfuellen')
    const { endpunkt } = await import('../lina/endpunkte')
    expect(endpunkt('analyticsFilterOptions').takt).toBe('woche')

    await linaNachfuellen()
    const [tag] = await zeitraeume('analyticsFilterOptions')
    expect(tag).toBeDefined()

    /**
     * Der Zeitraum IST der Takt: ein Montag, nicht der Monatserste. Geprüft
     * über die Datenbank statt über eine zweite Wochenrechnung in
     * JavaScript — die wäre genau die zweite Stelle, an der dasselbe falsch
     * stehen kann.
     */
    const { rows: [w] } = await db.query(
      `SELECT extract(isodow FROM $1::date)::int AS wochentag,
              ($1::date = date_trunc('week', $1::date)::date) AS ist_wochenanfang`, [tag])
    expect(w.wochentag).toBe(1)
    expect(w.ist_wochenanfang).toBe(true)

    // Und zweimal nachfüllen legt in derselben Woche nichts Zweites an.
    await linaNachfuellen()
    expect(await zeitraeume('analyticsFilterOptions')).toEqual([tag!])
  })

  test('die übrigen Momentaufnahmen bleiben monatlich', async () => {
    const { linaNachfuellen } = await import('./nachfuellen')
    const { AKTIVE_ENDPUNKTE, istMomentaufnahme } = await import('../lina/endpunkte')
    await linaNachfuellen()

    for (const ep of AKTIVE_ENDPUNKTE.filter(istMomentaufnahme)) {
      if (ep.takt === 'woche') continue
      const [tag] = await zeitraeume(ep.key)
      // Der Monatserste — der Takt hängt am Zeitraum, nicht am Ergebnis.
      expect(tag?.slice(8)).toBe('01')
    }
  })
})

/**
 * Die beiden Rückschaufenster — Punkte 2.1 und 2.3 des Plans.
 *
 * Beide Zahlen, mit denen der Plan sie begründen wollte, waren Artefakte
 * der Fenster selbst: die Änderungsrate der Tagesberichte bricht genau bei
 * `NACHZUEGLER_TAGE` ein, und die „Rückbuchungstiefe von sieben Monaten"
 * ist der Abstand von August zu Januar. Geprüft wird deshalb, dass die
 * Fenster tun, was sie sollen — nicht, dass eine bestimmte Zahl stimmt.
 */
lauf('Rückschaufenster', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB!
    db = new Client({ connectionString: DB })
    await db.connect()
  })
  afterAll(async () => { await db?.end() })
  beforeEach(async () => { await db.query('TRUNCATE sync.warteschlange') })

  test('das Nachzügler-Fenster gilt je Endpunkt, nicht global', async () => {
    const { linaNachfuellen } = await import('./nachfuellen')
    const { config } = await import('../config')
    const { endpunkt } = await import('../lina/endpunkte')
    await linaNachfuellen()

    const tage = async (key: string) => Number((await db.query(
      `SELECT count(DISTINCT zeitraum_von)::int AS n FROM sync.warteschlange WHERE endpunkt = $1`,
      [key])).rows[0].n)

    /**
     * Der Umsatzbericht setzt sich gemessen nach zwei Tagen und bleibt
     * deshalb auf dem globalen Fenster. Personalkosten und Artikelverkauf
     * ändern sich an JEDEM der ersten zehn Tage — sie bekommen ihr eigenes.
     */
    expect(endpunkt('getUmsatzbericht').nachzuegler_tage).toBeUndefined()
    expect(await tage('getUmsatzbericht')).toBe(config.NACHZUEGLER_TAGE)

    for (const key of ['getPersonalkosten', 'getArtikelverkaufsbericht']) {
      const eigenes = endpunkt(key).nachzuegler_tage
      expect(eigenes).toBe(21)
      expect(await tage(key)).toBe(eigenes!)
      // Die Gegenprobe: es ist wirklich MEHR als das globale Fenster.
      // Ohne sie wäre der Test grün, auch wenn beide Zahlen zufällig
      // gleich wären und die Endpunkt-Eigenschaft gar nicht gelesen würde.
      expect(eigenes!).toBeGreaterThan(config.NACHZUEGLER_TAGE)
    }
  })

  test('getKennzahlen holt das laufende Jahr UND das Vorjahr', async () => {
    const { linaNachfuellen } = await import('./nachfuellen')
    await linaNachfuellen()

    const { rows } = await db.query(
      `SELECT DISTINCT extract(year FROM zeitraum_von)::int AS jahr
         FROM sync.warteschlange WHERE endpunkt LIKE 'getKennzahlen%'
        ORDER BY jahr DESC`)
    expect(rows).toHaveLength(2)
    expect(Number(rows[0].jahr) - Number(rows[1].jahr)).toBe(1)

    /**
     * Und der Jahresposten geht über das GANZE Jahr — nicht über einen Tag.
     * Ohne diese Prüfung fiele ein vertauschtes von/bis nicht auf: LINA
     * lieferte dann eine leere BWA, und der Posten meldete „ok".
     */
    const { rows: [spanne] } = await db.query(
      `SELECT min(zeitraum_von)::text AS von, max(zeitraum_bis)::text AS bis
         FROM sync.warteschlange WHERE endpunkt LIKE 'getKennzahlen%'`)
    expect(spanne.von.slice(5)).toBe('01-01')
    expect(spanne.bis.slice(5)).toBe('12-31')
  })

  /**
   * Der eigentliche Punkt von 2.2: der Handbefehl `--historie` repariert den
   * Jahreswechsel NICHT, weil `sync.historie_einreihen()` gegen ALLE Posten
   * prüft und der erledigte Jahresposten blockiert. Der nächtliche Lauf
   * braucht ihn deshalb gar nicht — sein `ON CONFLICT DO NOTHING` läuft
   * gegen einen PARTIELLEN Index, den ein erledigter Posten nicht besetzt.
   */
  test('ein ERLEDIGTER Jahresposten blockiert den nächsten Lauf nicht', async () => {
    const { linaNachfuellen } = await import('./nachfuellen')
    await linaNachfuellen()
    const vorher = Number((await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange WHERE endpunkt LIKE 'getKennzahlen%'`
    )).rows[0].n)
    expect(vorher).toBeGreaterThan(0)

    // Solange sie offen sind, wächst nichts nach.
    await linaNachfuellen()
    expect(Number((await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange WHERE endpunkt LIKE 'getKennzahlen%'`
    )).rows[0].n)).toBe(vorher)

    // Erledigt wie vom Worker — und jetzt MUSS erneut eingereiht werden.
    await db.query(
      `UPDATE sync.warteschlange SET erledigt_am = now(), ergebnis = 'ok'
        WHERE endpunkt LIKE 'getKennzahlen%'`)
    await linaNachfuellen()
    expect(Number((await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange
        WHERE endpunkt LIKE 'getKennzahlen%' AND erledigt_am IS NULL`
    )).rows[0].n)).toBe(vorher)
  })
})
