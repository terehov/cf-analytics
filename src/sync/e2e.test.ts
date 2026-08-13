/**
 * Ende-zu-Ende: Warteschlange → Client → Transformation → core → Round Table.
 *
 * Läuft gegen die LINA-Attrappe (echte Fixtures aus Phase 1) und eine echte
 * Postgres-Datenbank. Beweist, dass die Kette hält — inklusive der beiden
 * Eigenheiten, die uns sonst still kaputtgehen würden: Sessionablauf mitten
 * im Lauf und "HTTP 500 mit leerem Body heißt keine Daten, nicht Fehler".
 *
 * Übersprungen, wenn keine TEST_DATABASE_URL gesetzt ist.
 */
import { expect, test, describe, beforeAll, beforeEach, afterAll } from 'bun:test'
import { Client } from 'pg'
import { mockStarten } from '../lina/mock'
import { fnMockStarten } from '../foodnotify/mock'

/**
 * Die FoodNotify-Attrappe lebt auf Dateiebene: ihre URL muss VOR dem ersten
 * config-Import in der Umgebung stehen (config friert beim Laden ein), und
 * die FoodNotify-Suite weiter unten braucht denselben Server.
 */
let fnMock: ReturnType<typeof fnMockStarten>

const DB = process.env.TEST_DATABASE_URL

/**
 * Notbremse: dieser Test macht `TRUNCATE` über `core`, `raw` und `sync`.
 *
 * Zeigt TEST_DATABASE_URL auf dieselbe Datenbank wie DATABASE_URL, löscht ein
 * einziger Testlauf den kompletten Importbestand. Genau das ist am 25.07.2026
 * passiert und hat die Daten des ersten echten LINA-Laufs gekostet.
 *
 * Lieber lautstark abbrechen als stillschweigend löschen.
 */
if (DB && process.env.DATABASE_URL && DB === process.env.DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL zeigt auf dieselbe Datenbank wie DATABASE_URL. ' +
    'Dieser Test macht TRUNCATE über core, raw und sync — das würde den ' +
    'echten Importbestand löschen. Bitte eine separate Testdatenbank anlegen: ' +
    'createdb lina_test && TEST_DATABASE_URL=postgresql://postgres@localhost/lina_test')
}

const lauf = DB ? describe : describe.skip

lauf('Ende-zu-Ende', () => {
  let mock: ReturnType<typeof mockStarten>
  let db: Client

  beforeAll(async () => {
    mock = mockStarten({ sessionAblaufNach: 3, keineDatenFuer: ['getAktionsbericht'] })
    process.env.LINA_BASE_URL = mock.url
    process.env.LINA_USER = 'testuser'
    process.env.LINA_PASSWORD = 'geheim'
    process.env.DATABASE_URL = DB!
    process.env.TAKT_MIN_MS = '0'
    process.env.TAKT_MAX_MS = '0'
    process.env.FENSTER_VON_STUNDE = '0'
    process.env.FENSTER_BIS_STUNDE = '24'
    process.env.LOG_LEVEL ??= 'error'
    /**
     * FoodNotify-Attrappe: zwei Marken, zwei Verhalten. Aposto meldet sich
     * an, „Enchilada" läuft auf den 2FA-Benutzer — der Fall, der abbrechen
     * muss, ohne die anderen mitzureißen. `leerAb` lässt die Bestellseite
     * ab dem zweiten Aufruf leer antworten (Leere-200er-Regel).
     */
    fnMock = fnMockStarten({ leerAb: { '/api/10483/shop-order/paginate': 4 } })
    process.env.FN_BASE_URL = fnMock.url
    process.env.FN_APOSTO_USER = 'test@aposto.eu'
    process.env.FN_APOSTO_PASSWORD = 'geheim'
    process.env.FN_ENCHILADA_USER = 'zfa@aposto.eu'
    process.env.FN_ENCHILADA_PASSWORD = 'geheim'
    /**
     * Zweite Notbremse, und die wichtigere.
     *
     * `bun test` teilt die Modulregistrierung über Testdateien hinweg: `config`
     * wird EINMAL geladen und friert dabei die Umgebung der zuerst gelaufenen
     * Datei ein. Im Gesamtlauf ist das die `.env` — `config.DATABASE_URL` zeigt
     * dann auf die ECHTE Datenbank, während dieser Test gegen TEST_DATABASE_URL
     * prüft. Die Folge: hier wird die Testdatenbank trunkiert, der Worker
     * schreibt seine Attrappen-Daten aber in die Produktivdatenbank. Der
     * Namensvergleich oben greift nicht, weil die URLs ja verschieden sind.
     * Am 25.07.2026 genau so beobachtet.
     *
     * Deshalb prüfen, wohin der Worker TATSÄCHLICH schreibt.
     */
    const { config } = await import('../config')
    if (config.DATABASE_URL !== DB) {
      throw new Error(
        'Der Worker würde nach "' + config.DATABASE_URL + '" schreiben, geprüft ' +
        'wird aber "' + DB + '". Ursache: config wurde von einer früher ' +
        'gelaufenen Testdatei mit der .env eingefroren. Diesen Test einzeln ' +
        'starten: bun test src/sync/e2e.test.ts')
    }

    db = new Client({ connectionString: DB })
    await db.connect()
    // Wiederholbar: der Test prüft absolute Zahlen, also vorher leeren.
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf, sync.schema_abweichung,
                       raw.api_antwort, core.umsatzbericht_tag, core.zeitzonenbericht_stunde,
                       core.zeitzonenbericht_zone, core.artikelverkauf_tag, core.personalkosten,
                       core.schwellenwert_betrieb, core.kennzahlen_monat,
                       core.artikel, core.betrieb RESTART IDENTITY CASCADE`)
  })

  afterAll(async () => { mock.stop(); await db.end() })

  test('holt, transformiert und schreibt nach core', async () => {
    const { workerLauf } = await import('./worker')

    await db.query(`
      INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet) VALUES
        ('getUmsatzbericht',          '2026-06-15','2026-06-15', 10),
        ('getUmsatzbericht:speisen',  '2026-06-15','2026-06-15', 10),
        ('getPersonalkosten',         '2026-06-15','2026-06-15', 10),
        ('getZeitzonenbericht',       '2026-06-15','2026-06-15', 10),
        ('getArtikelverkaufsbericht', '2026-06-15','2026-06-15', 10),
        ('getAktionsbericht',         '2026-06-15','2026-06-15', 10)
      ON CONFLICT DO NOTHING`)

    const r = await workerLauf('manuell')

    expect(r.ok).toBe(5)
    // getAktionsbericht liefert 500 mit leerem Body — das ist KEIN Fehler.
    expect(r.keineDaten).toBe(1)
    expect(r.fehler).toBe(0)

    const { rows: [{ n: betriebe }] } = await db.query(`SELECT count(*)::int AS n FROM core.betrieb`)
    expect(betriebe).toBeGreaterThan(0)

    const { rows: [{ n: umsatz }] } = await db.query(`SELECT count(*)::int AS n FROM core.umsatzbericht_tag`)
    expect(umsatz).toBeGreaterThan(0)

    const { rows: [{ n: stunden }] } = await db.query(`SELECT count(*)::int AS n FROM core.zeitzonenbericht_stunde`)
    expect(stunden).toBeGreaterThan(0)

    // Geschäftstag 08:00–07:59: die Stunden 0–7 liegen auf dem Vortag.
    const { rows: [{ n: vortag }] } = await db.query(`
      SELECT count(*)::int AS n FROM core.zeitzonenbericht_stunde
       WHERE stunde < 8 AND geschaeftstag = '2026-06-14'`)
    expect(vortag).toBeGreaterThan(0)

    const { rows: [{ n: artikel }] } = await db.query(`SELECT count(*)::int AS n FROM core.artikelverkauf_tag`)
    expect(artikel).toBeGreaterThan(0)

    // Betriebsindividuelle Schwellen aus pekThreshold
    const { rows: [{ n: schwellen }] } = await db.query(`SELECT count(*)::int AS n FROM core.schwellenwert_betrieb`)
    expect(schwellen).toBeGreaterThan(0)
  }, 60_000)

  /**
   * `sync.fortschritt` hatte vier Leser und keinen Schreiber (Plan 3.4).
   *
   * Die Tabelle steht seit Migration `0005` da. Am 14.08.2026 in Produktion
   * nachgezaehlt: **0 Zeilen** — und `src/health.ts` meldete daraus
   * strukturbedingt fuer immer „null pausierte Endpunkte". Eine Pruefung, die
   * nie ausschlagen kann, ist schlimmer als keine: sie beruhigt.
   *
   * Der Test steht hier und nicht bei den Sichten, weil nur ein echter Lauf
   * beweist, dass der Schreiber tatsaechlich laeuft. Eine Zusicherung ueber
   * die Tabellenform haette den alten Zustand genauso bestanden.
   */
  test('sync.fortschritt wird vom Lauf fortgeschrieben', async () => {
    /*
     * Die sechs Endpunkte des ersten Laufs, namentlich. Eine Gesamtzahl
     * waere von der Reihenfolge der Testdateien abhaengig — der Bestand
     * dieser sechs ist es nicht.
     *
     * getAktionsbericht ist dabei: `keine_daten` ist ein gelungener Aufruf
     * ohne Inhalt (AGENTS.md) und schiebt den Stand vor. Sonst saehe ein
     * geschlossener Betrieb aus wie einer, den wir nicht erreichen.
     */
    const { rows } = await db.query(
      `SELECT endpunkt, letzter_zeitraum, letzter_erfolg_am IS NOT NULL AS hatte_erfolg
         FROM sync.fortschritt
        WHERE endpunkt IN ('getUmsatzbericht','getUmsatzbericht:speisen','getPersonalkosten',
                           'getZeitzonenbericht','getArtikelverkaufsbericht','getAktionsbericht')
        ORDER BY endpunkt`)
    expect(rows).toHaveLength(6)
    expect(rows.every(r => r.hatte_erfolg)).toBe(true)
    expect(rows.every(r => r.letzter_zeitraum !== null)).toBe(true)
  })

  test('der Sessionablauf mitten im Lauf wird abgefangen', async () => {
    // sessionAblaufNach: 3 — der Mock hat mitten im Lauf abgelaufen und der
    // Client musste sich neu anmelden. Wären die Aufrufe danach fehlgeschlagen,
    // stünde oben fehler > 0.
    const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM sync.aufgabe WHERE status = 'fehler'`)
    expect(n).toBe(0)
  })

  test('jeder Aufruf liegt im Raw-Layer', async () => {
    const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM raw.api_antwort`)
    expect(n).toBe(5)
    const { rows: [{ n: mitHash }] } = await db.query(`
      SELECT count(*)::int AS n FROM raw.api_antwort WHERE payload_hash <> '' AND payload_bytes > 0`)
    expect(mitHash).toBe(5)
  })

  test('der Artikelstand wird als Historie fortgeschrieben', async () => {
    // core.artikel überschreibt fixer_we bei jedem Lauf. Ohne diese Historie
    // würde jede Rückrechnung auf vergangene Monate mit der heutigen
    // Kalkulation laufen — plausibel aussehend und still falsch.
    const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM core.artikel_stand`)
    expect(n).toBeGreaterThan(0)
    const { rows: [{ n: monate }] } = await db.query(
      `SELECT count(DISTINCT monat)::int AS n FROM core.artikel_stand`)
    expect(monate).toBe(1)
  })

  test('die Prüfsichten sind abfragbar', async () => {
    // Inhaltlich lässt sich hier nichts prüfen: die Fixtures sind anonymisiert,
    // Umsatzbericht und Artikelbericht stammen aus verschiedenen Beispielen und
    // widersprechen sich zwangsläufig. Geprüft wird, dass die Sichten laufen —
    // ein Tippfehler im SQL fällt sonst erst in Postico auf.
    // Seit Migration 0029 ohne die Wareneinsatzpruefung: sie hat nie
    // ausgeloest, weil ihr Filter auf IS NOT NULL prueft und fixer_we nie
    // NULL ist, sondern 0.
    // Seit Migration 0069 kommen vier Zulaufpruefungen dazu — der Befund vom
    // 13.08.2026: eine Quelle ohne Zulauf ist ein Fehler, kein Normalzustand,
    // und der Lauf hat sie zweimal als "ok" gemeldet.
    const { rows } = await db.query(
      `SELECT pruefung FROM mart.pruefung_uebersicht ORDER BY pruefung`)
    expect(rows.map(r => r.pruefung)).toEqual([
      /**
       * Seit 0071 die fuenfte Zulaufpruefung, und die einzige, deren
       * Erwartung KONSTANZ ist statt null: Betriebe, deren Ladenakte gar
       * kein Belegarchiv fuehrt. Sie steht hier, weil diese Paare sonst in
       * der 36-h-Zeile fuer immer rot stuenden — und eine Kachel, die nie
       * auf null geht, liest niemand mehr.
       */
      'Belegarchiv: Betrieb ohne Belegarchiv',
      'Belegarchiv: Ordner ohne den faelligen Abzug',
      'Belegarchiv: seit ueber 36 h nicht gezaehlt',
      /**
       * Seit 0072. Gezählt wird NUR das rollierende Fenster, nicht der
       * Altbestand — der arbeitet sich über mehrere Nächte ab und stünde
       * hier sonst zweimal mit fünfstelligen Zahlen. Wie weit er ist, sagt
       * `mart.bestelldetail_stand.nie_aufgefrischt`.
       */
      'Bestellung: Details im Fenster aelter als 48 h',
      'Bestellung: Kopf ohne eine einzige Position',
      'Bon: avgTicket vs. Umsatz/Rechnungen',
      /**
       * Seit 0073. Testbetriebe und Kostenstellen ohne Bestellungen zählen
       * NICHT mit — sonst stünde die Zeile dauerhaft rot, und sie soll eine
       * Entscheidungsliste sein, keine Tapete.
       */
      /**
       * Beide seit 0075, und beide bewusst NICHT „offene Seiten" bzw.
       * „403 gesehen": gezaehlt wird nur, was einen ganzen Lauf ueberlebt
       * hat, und nur ein 403 auf einem EIGENEN Betrieb. Am 14.08.2026 um
       * 00:16 standen sonst alle 251 Monatszeilen der Ladestandskarte auf
       * „… laedt" — waehrend der Lauf sie gerade abarbeitete.
       */
      'Einkauf: 403 auf einem EIGENEN Betrieb',
      'Einkauf: Bestellseiten aus einem frueheren Lauf offen',
      'Einkauf: Kostenstelle ohne Betrieb, mit Bestellungen',
      'Inventur: Zaehlung abgeschnitten',
      /**
       * Seit 0074 — und die einzige Zeile, die etwas über unser eigenes
       * Hinsehen sagt statt über die Daten: kommen am Rand des
       * Nachzügler-Fensters noch Änderungen an, ist es zu kurz.
       */
      'Nachzuegler: Aenderungen am Rand des Fensters',
      'Umsatz: Artikelsumme vs. Umsatzbericht',
      // Seit 0070 ausdruecklich nur die ENDGUELTIGEN: ein aufgegebener Posten,
      // den der Lauf noch dreimal zurueckholt, ist Betrieb und kein Befund.
      'Warteschlange: endgueltig aufgegeben',
      /**
       * Beide seit 0076 — die Zeilen, die alle anderen abdecken. Sie stehen
       * am Ende der alphabetischen Liste und ganz oben auf dem Dashboard:
       * jede Pruefung darueber setzt voraus, dass etwas SCHIEFGEHT. Der
       * teuerste Fehler dieses Projekts hat nichts davon getan.
       *
       * Zwei Zeilen und nicht eine, weil es zwei Ausfallarten sind: „die
       * Quelle liefert nichts" ist ein Befund, „wir fragen nicht mehr" ist
       * ein Baufehler.
       */
      'Zulauf: Quelle ohne Zulauf in ihrer Kadenz',
      'Zulauf: Quelle wird nicht mehr abgefragt',
    ])
  })

  /**
   * Der Waechter, der 0029 ausgeloest hat.
   *
   * `abdeckung_pct` filterte auf `fixer_we IS NOT NULL`. LINA liefert
   * aber 0.0000 statt NULL — gemessen an core.artikel_stand: 591.464
   * Zeilen, davon 0 mit NULL. Der Filter griff nie, die Spalte stand
   * ausnahmslos auf 100, und 2.590 von 5.364 Betriebsmonaten wiesen
   * eine Luecke in voller Hoehe des BWA-Wareneinsatzes aus, ohne dass
   * es jemandem auffiel.
   *
   * Geprueft wird die Ursache, nicht das Symptom: solange fixer_we
   * niemals NULL ist, darf kein Filter auf IS NOT NULL eine Abdeckung
   * behaupten.
   */
  test('fixer_we ist nie NULL — Abdeckung darf nicht auf IS NOT NULL filtern', async () => {
    const { rows: [{ ist_null }] } = await db.query(`
      SELECT count(*) FILTER (WHERE fixer_we IS NULL)::int AS ist_null
        FROM core.artikel_stand`)
    expect(ist_null).toBe(0)

    const { rows: [{ def }] } = await db.query(
      `SELECT pg_get_viewdef('mart.deckungsbeitrag_warengruppe'::regclass, true) AS def`)
    expect(def).not.toContain('fixer_we IS NOT NULL')
  })

  test('die Drosselung ist im Nachhinein prüfbar', async () => {
    const { rows: [{ n }] } = await db.query(`
      SELECT count(*)::int AS n FROM sync.aufgabe WHERE wartezeit_ms IS NOT NULL`)
    expect(n).toBeGreaterThan(0)
  })

  test('die Warteschlange ist sauber quittiert', async () => {
    const { rows: [{ n: offen }] } = await db.query(`
      SELECT count(*)::int AS n FROM sync.warteschlange WHERE erledigt_am IS NULL`)
    expect(offen).toBe(0)
    const { rows: [{ n: haengend }] } = await db.query(`
      SELECT count(*)::int AS n FROM sync.warteschlange WHERE in_arbeit_seit IS NOT NULL`)
    expect(haengend).toBe(0)
  })
})

/**
 * Stammdaten-Momentaufnahmen durch die ganze Kette.
 *
 * Eigener Durchlauf, weil sie sich grundsätzlich anders verhalten als
 * Berichte: kein Zeitraum, monatlich statt täglich, kein Backfill.
 */
lauf('Stammdaten-Momentaufnahmen', () => {
  let mock: ReturnType<typeof mockStarten>
  let db: Client
  const MONAT = '2026-07-01'

  beforeAll(async () => {
    // Auf DEMSELBEN Port wie der erste Durchlauf: `config` wird beim ersten
    // Import eingefroren, `config.LINA_BASE_URL` zeigt also weiterhin auf den
    // Port von oben. Eine Umgebungsvariable hier hilft nicht mehr — das ist
    // dieselbe Falle, die im Kopf dieser Datei beschrieben ist.
    const { config } = await import('../config')
    mock = mockStarten({ port: Number(new URL(config.LINA_BASE_URL).port) })
    db = new Client({ connectionString: DB })
    await db.connect()
    // Die WAWI-Tabellen sind seit Migration 0030 gelöscht (Demodaten,
    // AGENTS.md Regel 5) — hier bleibt nur die Sortimentshierarchie.
    await db.query(`TRUNCATE core.artikel_warengruppe_stand, core.warengruppe, core.feinsparte
                    RESTART IDENTITY CASCADE`)
    // Ein Artikel, damit articleApi etwas zum Verknuepfen hat.
    await db.query(`INSERT INTO core.artikel (artikelnummer, name) VALUES (300213, 'Artikel A')
                    ON CONFLICT (artikelnummer) DO NOTHING`)
    await db.query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet) VALUES
         ('analyticsFilterOptions',  $1,$1, 10),
         ('articleApi:franchise',    $1,$1, 10)
       ON CONFLICT DO NOTHING`, [MONAT])

    const { workerLauf } = await import('./worker')
    await workerLauf('manuell')
  })

  afterAll(async () => { mock.stop(); await db.end() })

  test('alle sieben Momentaufnahmen laufen fehlerfrei durch', async () => {
    const { rows: [{ n }] } = await db.query(
      `SELECT count(*)::int AS n FROM sync.aufgabe WHERE status = 'fehler'`)
    expect(n).toBe(0)
  })

  test('Warengruppen landen dreistufig getrennt', async () => {
    const { rows } = await db.query(
      `SELECT ebene::text AS ebene, count(*)::int AS n FROM core.warengruppe GROUP BY 1 ORDER BY 1`)
    expect(rows.map(r => r.ebene).sort()).toEqual(['detail', 'gross', 'mec'])
  })

  /** Der teuerste denkbare Fehler: ueber id statt artnr verknuepfen. */
  test('die Zuordnung haengt an der Artikelnummer, nicht an articleApi.id', async () => {
    const { rows } = await db.query(
      `SELECT a.artikelnummer::bigint AS nr, g.name AS gross
         FROM core.artikel_warengruppe_stand s
         JOIN core.artikel a ON a.artikel_key = s.artikel_key
         LEFT JOIN core.warengruppe g ON g.warengruppe_key = s.gross_key`)
    const nummern = rows.map(r => Number(r.nr))
    // artnr des ersten Fixture-Satzes …
    expect(nummern).toContain(300213)
    expect(rows.find(r => Number(r.nr) === 300213)!.gross).toBe('Getränke')
    // … und dessen id darf NIRGENDS als Artikelnummer auftauchen.
    expect(nummern).not.toContain(19324)
    // Zugeordnet wird nur, was core.artikel kennt — articleApi hat 9.132
    // Artikel, verkauft wird davon ein Bruchteil.
    const { rows: [{ n: bekannt }] } = await db.query(
      `SELECT count(*)::int AS n FROM core.artikel`)
    expect(rows.length).toBeLessThanOrEqual(Number(bekannt))
  })

  /**
   * Datenminimierung, in der Datenbank nachgewiesen: core.lieferant darf
   * ueberhaupt keine Spalte fuer Steuer-, Bank- oder Kontaktdaten haben.
   *
   * Die Tabelle ist seit Migration 0030 eine andere (FoodNotify statt LINA),
   * die Regel ist dieselbe. Genau deshalb steht der Test hier weiter: er
   * prueft eine Zusicherung, nicht eine Implementierung.
   */
  test('core.lieferant hat keine Spalte fuer heikle Felder', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'core' AND table_name = 'lieferant'`)
    const spalten = rows.map(r => r.column_name)
    for (const heikel of ['ustid', 'hrb', 'kreditor', 'gegenkonto', 'tel', 'email',
                          'strasse', 'plz', 'ort', 'kdnr', 'fax']) {
      expect(spalten).not.toContain(heikel)
    }
    expect(spalten).toContain('name')
  })

  /**
   * Die Tests zu Einkaufspreisen, Inventurterminen und
   * mart.preisentwicklung_ware sind am 01.08.2026 entfallen (Migration
   * 0030): sie prueften LINAs Warenwirtschaft, und die ist Demodaten.
   *
   * Ihre Nachfolger gehoeren zu Stufe 1.5 und 1.7 und pruefen dann
   * core.bestellposition — echte Belegpreise mit Datum.
   */
  test('die Mart-Sichten sind abfragbar', async () => {
    await db.query(`SELECT * FROM mart.deckungsbeitrag_warengruppe LIMIT 1`)
  })

  /**
   * Migration 0030 legt die vier Mandanten an. Ohne sie haengt jede
   * FoodNotify-Tabelle an einem Fremdschluessel ins Leere — und der
   * Schluessel traegt zugleich den Namen der Umgebungsvariablen
   * (aposto -> FN_APOSTO_USER), ist also nicht frei umbenennbar.
   */
  test('die vier FoodNotify-Marken stehen bereit', async () => {
    const { rows } = await db.query(
      `SELECT schluessel FROM core.marke ORDER BY schluessel`)
    expect(rows.map(r => r.schluessel)).toEqual(
      ['aposto', 'deutsche_konzepte', 'enchilada', 'wilma_wunder'])
  })

  /**
   * Die Stände werden über ZEITRÄUME aufgelöst, nicht über Monatsgleichheit.
   *
   * Der Verkauf liegt im Juni, die Momentaufnahmen im Juli — genau die
   * Konstellation, in der ein `... AND stand.monat = date_trunc('month', tag)`
   * still NULL liefert und wie "kein Ansatz hinterlegt" aussieht. Beide
   * Auflösungen laufen hier gegen dieselbe Zeile und müssen sich
   * unterschiedlich verhalten:
   *
   *   fixer_we    NICHT rückwirkend. Ein Preis von heute auf gestern
   *               angewandt ergibt eine konkret falsche Zahl.
   *   Warengruppe SEHR WOHL rückwirkend, aber als Annahme gekennzeichnet.
   *               Sonst hätte die gesamte Historie keine Warengruppe.
   */
  test('Stände werden über Zeiträume aufgelöst, die Warengruppe rückwirkend', async () => {
    const { rows } = await db.query(`
      SELECT geschaeftstag, warengruppe, warengruppe_geschaetzt,
             fixer_we, wareneinsatz_theoretisch
        FROM mart.artikelverkauf`)
    expect(rows.length).toBeGreaterThan(0)
    const z = rows[0]

    // Verkauf im Juni, Momentaufnahme im Juli — die Ausgangslage des Tests.
    expect(String(z.geschaeftstag) < MONAT).toBe(true)

    // Warengruppe da, aber ehrlich als Annahme markiert.
    expect(z.warengruppe).not.toBeNull()
    expect(z.warengruppe_geschaetzt).toBe(true)

    // Der Ansatz kommt aus core.artikel_stand des Verkaufsmonats.
    expect(Number(z.fixer_we)).toBeGreaterThan(0)
    expect(Number(z.wareneinsatz_theoretisch)).toBeGreaterThan(0)
  })

  /**
   * Der Takt: eine Momentaufnahme je Monat, nicht je Tag.
   *
   * Die erste Fassung verliess sich auf `ON CONFLICT DO NOTHING`. Das ist
   * falsch, weil der Eindeutigkeitsindex der Warteschlange PARTIELL ist
   * (`WHERE erledigt_am IS NULL`): ein erledigter Posten blockiert nichts.
   * Der taegliche Lauf haette am Folgetag denselben Monatsersten neu
   * eingereiht — 7 Endpunkte × 30 Tage statt 7 Aufrufe im Monat.
   *
   * Der Fehler zeigt sich NUR an einem bereits erledigten Posten. Genau
   * deshalb steht er hier.
   */
  test('eine Momentaufnahme wird je Monat nur einmal eingereiht — auch nach Erledigung', async () => {
    const einreihen = (monat: string) => db.query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
       SELECT $1, $2::date, $2::date, 10
        WHERE NOT EXISTS (
              SELECT 1 FROM sync.warteschlange
               WHERE endpunkt = $1 AND zeitraum_von = $2::date)
       RETURNING posten_id`, ['probe:takt', monat])

    await db.query(`DELETE FROM sync.warteschlange WHERE endpunkt = 'probe:takt'`)
    try {
      expect((await einreihen('2026-07-01')).rowCount).toBe(1)   // erster Tag
      expect((await einreihen('2026-07-01')).rowCount).toBe(0)   // noch offen
      await db.query(`UPDATE sync.warteschlange SET erledigt_am = now()
                       WHERE endpunkt = 'probe:takt'`)
      expect((await einreihen('2026-07-01')).rowCount).toBe(0)   // <- hier war der Fehler
      expect((await einreihen('2026-08-01')).rowCount).toBe(1)   // neuer Monat, neue Aufnahme
    } finally {
      await db.query(`DELETE FROM sync.warteschlange WHERE endpunkt = 'probe:takt'`)
    }
  })
})

/**
 * Ein Datenbankausfall mitten im Lauf darf den Lauf nicht töten.
 *
 * Am 26.07.2026 starb ein Lauf nach 16 erfolgreichen Posten an einem
 * „Connection terminated due to connection timeout". Für einen Backfill über
 * 23.000 Posten und rund zwölf Tage wäre das ein täglicher Abbruch — und der
 * Grund, warum der Import nicht unbeaufsichtigt laufen konnte.
 */
lauf('Robustheit gegen Datenbankausfälle', () => {
  let mock: ReturnType<typeof mockStarten>
  let db: Client

  beforeAll(async () => {
    const { config } = await import('../config')
    mock = mockStarten({ port: Number(new URL(config.LINA_BASE_URL).port) })
    db = new Client({ connectionString: DB })
    await db.connect()
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf RESTART IDENTITY CASCADE`)
    for (let i = 1; i <= 5; i++) {
      await db.query(
        `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
         VALUES ('getUmsatzbericht', $1::date, $1::date, 10)`,
        [`2026-06-0${i}`])
    }
  })

  afterAll(async () => { mock.stop(); await db.end() })

  test('ein Lauf übersteht abgerissene Verbindungen und arbeitet alles ab', async () => {
    const { pool } = await import('../db/pool')
    const { workerLauf } = await import('./worker')

    // Pool aufwärmen, damit ueberhaupt Verbindungen zum Abreissen da sind …
    await pool.query('SELECT 1')
    // … und sie dann abschiessen. Genau das Ereignis von damals: die
    // zwischengespeicherten Verbindungen sind tot, der naechste Zugriff
    // laeuft ins Leere und muss sich selbst erholen.
    // Die eigene Verbindung bleibt verschont, sonst prueft der Test nichts mehr.
    await db.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()`)

    const r = await workerLauf('manuell')

    expect(r.status).not.toBe('fehlgeschlagen')
    const { rows: [{ n: offen }] } = await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange WHERE erledigt_am IS NULL`)
    expect(offen).toBe(0)
    // Kein Posten darf reserviert zurueckbleiben — sonst haengt er bis zur
    // Stundengrenze von haengende_posten_freigeben().
    const { rows: [{ n: haengend }] } = await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange WHERE in_arbeit_seit IS NOT NULL`)
    expect(haengend).toBe(0)
  }, 60_000)
})

/**
 * Die Sperre gegen parallele Worker.
 *
 * Seit das Arbeitsfenster entfallen ist (25.07.2026), läuft ein Backfill-Lauf
 * bis zum Tagesbudget — also viele Stunden. Der stündliche Zeitplan würde ohne
 * Sperre Lauf um Lauf danebenstarten. `FOR UPDATE SKIP LOCKED` verhindert nur
 * doppelte Posten, nicht doppeltes Tempo, und das Tagesbudget zählt jeder
 * Prozess für sich im Speicher. Zehn Worker wären zehnfaches Tempo.
 */
lauf('Sperre gegen parallele Worker', () => {
  /** Muss mit SPERRE in worker.ts übereinstimmen. */
  const SPERRE = 8_142_026
  const nimm = async (c: Client) =>
    (await c.query('SELECT pg_try_advisory_lock($1) AS ok', [SPERRE])).rows[0].ok

  test('ein zweiter Worker wird abgewiesen, solange der erste läuft', async () => {
    const a = new Client({ connectionString: DB }), b = new Client({ connectionString: DB })
    await a.connect(); await b.connect()
    try {
      expect(await nimm(a)).toBe(true)
      expect(await nimm(b)).toBe(false)          // <- darauf kommt es an
      await a.query('SELECT pg_advisory_unlock($1)', [SPERRE])
      expect(await nimm(b)).toBe(true)           // nach Freigabe wieder frei
      await b.query('SELECT pg_advisory_unlock($1)', [SPERRE])
    } finally { await a.end(); await b.end() }
  })

  test('ein Absturz blockiert die Sperre nicht dauerhaft', async () => {
    const c = new Client({ connectionString: DB })
    await c.connect()
    expect(await nimm(c)).toBe(true)
    await c.end()                                 // Verbindung weg, ohne Unlock

    const d = new Client({ connectionString: DB })
    await d.connect()
    try {
      // Advisory-Sperren hängen an der Verbindung — ein toter Worker gibt sie
      // von selbst frei. Mit Wiederholung, weil Postgres den Backend-Prozess
      // asynchron abräumt; ohne das wäre der Test sporadisch rot.
      let frei = false
      for (let versuch = 0; versuch < 40 && !frei; versuch++) {
        frei = await nimm(d)
        if (!frei) await new Promise(r => setTimeout(r, 50))
      }
      expect(frei).toBe(true)
      await d.query('SELECT pg_advisory_unlock($1)', [SPERRE])
    } finally { await d.end() }
  })
})

/**
 * Die beiden Fallen der BWA-Sichten.
 *
 * Beide sind am 26.07.2026 im ersten echten Lauf aufgefallen und beide waren
 * in den Fixtures unsichtbar — sie brauchen genau die Konstellation, die LINA
 * mit echten Daten liefert. Deshalb wird sie hier von Hand hergestellt.
 */
lauf('BWA-Sichten', () => {
  let db: Client
  const B = 'ENCID_BWA_PRUEFUNG'

  /** Euro und Prozent kommen aus zwei Aufrufen, 35 s auseinander. */
  const bwa = async (monat: string, werte: [string, number, number][], versatzSek: number) => {
    for (const [modus, spalte] of [['absolut', 'wert_absolut'], ['relativ', 'wert_prozent']] as const) {
      for (const [kennzahl, abs, pct] of werte) {
        await db.query(
          `INSERT INTO core.kennzahlen_monat (betrieb_key, monat, kennzahl, ${spalte}, abgerufen_am)
           SELECT betrieb_key, $2::date, $3, $4, now() + ($5 || ' seconds')::interval
             FROM core.betrieb WHERE enc_id = $1`,
          [B, monat, kennzahl, modus === 'absolut' ? abs : pct,
           versatzSek + (modus === 'relativ' ? 35 : 0)])
      }
    }
  }

  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
    await db.query(`DELETE FROM core.kennzahlen_monat
                     WHERE betrieb_key IN (SELECT betrieb_key FROM core.betrieb WHERE enc_id = $1)`, [B])
    await db.query(`DELETE FROM core.betrieb WHERE enc_id = $1`, [B])
    await db.query(
      `INSERT INTO core.betrieb (enc_id, lina_betrieb_id, name, aktiv, hat_bwa)
       VALUES ($1, 999999, 'Prüfbetrieb BWA', true, true)`, [B])

    // Mai ist gebucht.
    await bwa('2026-05-01', [
      ['Umsatz',                 92030.31, 100.00],
      ['Personalkosten ohne GF', 22812.56,  24.79],
      ['WE Bar',                 11994.34,  23.64],
      ['WE Küche',               12755.92,  31.08],
    ], 0)
    // Dezember liefert LINA mit, ist aber nicht gebucht: alles 0,00 — nicht NULL.
    await bwa('2026-12-01', [
      ['Umsatz',                 0, 0],
      ['Personalkosten ohne GF', 0, 0],
      ['WE Bar',                 0, 0],
      ['WE Küche',               0, 0],
    ], 100)
  })

  afterAll(async () => {
    await db.query(`DELETE FROM core.kennzahlen_monat
                     WHERE betrieb_key IN (SELECT betrieb_key FROM core.betrieb WHERE enc_id = $1)`, [B])
    await db.query(`DELETE FROM core.betrieb WHERE enc_id = $1`, [B])
    await db.end()
  })

  /**
   * Euro und Prozent dürfen sich nicht gegenseitig verdrängen.
   *
   * `DISTINCT ON (…) ORDER BY abgerufen_am DESC` behielt nur die später
   * geholte Zeile. Gemessen: 7.860 Zeilen mit Prozent, NULL mit Euro —
   * und damit war mart.pruefung_wareneinsatz still wirkungslos.
   */
  test('kennzahlen_aktuell führt Euro und Prozent zusammen', async () => {
    const { rows } = await db.query(
      `SELECT wert_absolut, wert_prozent FROM mart.kennzahlen_aktuell k
         JOIN core.betrieb b USING (betrieb_key)
        WHERE b.enc_id = $1 AND k.monat = '2026-05-01' AND k.kennzahl = 'WE Bar'`, [B])
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].wert_absolut)).toBeCloseTo(11994.34, 2)
    expect(Number(rows[0].wert_prozent)).toBeCloseTo(23.64, 2)
  })

  /**
   * Ein Monat aus lauter Nullen existiert nicht.
   *
   * LINA liefert immer das ganze Jahr, auch Monate, die es noch gar nicht
   * gab — als 0,00, nicht als NULL. Stünden sie im Round Table, wäre der
   * Dezember eine vollwertige Zeile mit dem BWA-Stand vom Mai und ohne
   * Umsatz. Niemand sieht der Zeile an, dass sie in der Zukunft liegt.
   */
  test('ein Monat aus lauter Nullen erscheint gar nicht erst', async () => {
    const { rows } = await db.query(
      `SELECT monat FROM mart.round_table_basis WHERE monat = '2026-12-01'`)
    expect(rows).toEqual([])
  })

  /**
   * Und im Monat, den es gibt, gilt der jüngste WIRKLICH gebuchte Stand.
   *
   * Ohne die Prüfung auf „irgendein Wert ungleich null" hätte der Dezember
   * als jüngster Stand gewonnen. 0 % Personalkosten ist „niedriger ist
   * besser" und damit grün — gemessen: September bis Dezember 2026 standen
   * für alle 131 Betriebe auf grün.
   */
  test('es gilt der jüngste wirklich gebuchte Stand, nicht der jüngste überhaupt', async () => {
    const { rows } = await db.query(
      `SELECT bwa_monat, personalkosten_ogf_pct, ampel_personal, ampel_we_kueche, gesamt
         FROM mart.round_table_monat
        WHERE betrieb = 'Prüfbetrieb BWA' AND monat = '2026-06-01'`)
    expect(rows).toHaveLength(1)
    expect(String(rows[0].bwa_monat)).toBe('2026-05-01')
    expect(Number(rows[0].personalkosten_ogf_pct)).toBeCloseTo(24.79, 2)
    // Mai-Werte, nicht Dezember-Nullen: 24,79 % ist grün, 31,08 % ist rot.
    expect(rows[0].ampel_personal).toBe('gruen')
    expect(rows[0].ampel_we_kueche).toBe('rot')
    expect(rows[0].gesamt).toBe('rot')
  })

  /**
   * Sicht und Funktion müssen dieselben Zahlen liefern.
   *
   * `mart.konzept_schnitt_monat` gibt es, weil Metabase tabellenwertige
   * Funktionen im Abfrage-Editor nicht benutzen kann. Damit steht dieselbe
   * Regel — Median statt Mittelwert, Umsatz als echte Summe — an zwei
   * Stellen, und genau das ist der Grund für diesen Test: wer die eine
   * ändert und die andere vergisst, bekommt zwei Wahrheiten über dieselbe
   * Marke, ohne dass irgendetwas rot wird.
   */
  test('Markenschnitt: Sicht und Funktion sind sich einig', async () => {
    const { rows } = await db.query(`
      WITH monate AS (SELECT DISTINCT monat FROM mart.konzept_schnitt_monat)
      SELECT count(*)::int AS verglichen,
             count(*) FILTER (WHERE
                  f.betriebe               IS DISTINCT FROM s.betriebe
               OR f.umsatz_ist             IS DISTINCT FROM s.umsatz_ist
               OR f.umsatz_pct             IS DISTINCT FROM s.umsatz_pct
               OR f.personalkosten_ogf_pct IS DISTINCT FROM s.personalkosten_ogf_pct
               OR f.we_bar_pct             IS DISTINCT FROM s.we_bar_pct
               OR f.we_kueche_pct          IS DISTINCT FROM s.we_kueche_pct
               OR f.ampeln_rot             IS DISTINCT FROM s.ampeln_rot
               OR f.ampeln_orange          IS DISTINCT FROM s.ampeln_orange
               OR f.ampeln_gruen           IS DISTINCT FROM s.ampeln_gruen
               OR f.massnahme_faellig      IS DISTINCT FROM s.massnahme_faellig
             )::int AS abweichungen
        FROM monate m
        CROSS JOIN LATERAL mart.konzept_schnitt(m.monat) f
        FULL JOIN mart.konzept_schnitt_monat s
               ON s.monat = m.monat AND s.konzept = f.konzept`)
    expect(Number(rows[0].verglichen)).toBeGreaterThan(0)
    expect(Number(rows[0].abweichungen)).toBe(0)
  })
})

/**
 * Zwei Dinge, die geholt wurden und nirgends ankamen — beide am 26.07.2026
 * bei der Bestandsaufnahme gefunden, beide hier durch die ganze Kette geprüft:
 *
 *   getAktionsbericht      wurde geholt und fiel im `switch` in den
 *                          default-Zweig. Posten `ok`, `zeilen: 0`, alles nur
 *                          im Raw-Layer.
 *   core.bwa_buchungsstand stand seit 0003 im Schema, mit einem Kommentar, der
 *                          genau erklärt wozu — und kein Ladepfad schrieb je
 *                          hinein.
 *
 * Beide Fehler sahen im Betrieb nach nichts aus. Genau deshalb ein Test, der
 * die geschriebenen Zeilen zählt und sich nicht auf `status = ok` verlässt.
 */
lauf('Aktionsbericht und BWA-Buchungsstand', () => {
  let mock: ReturnType<typeof mockStarten>
  let db: Client
  const TAG = '2026-06-15'

  beforeAll(async () => {
    const { config } = await import('../config')
    mock = mockStarten({ port: Number(new URL(config.LINA_BASE_URL).port) })
    db = new Client({ connectionString: DB })
    await db.connect()
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf,
                       core.aktionsumsatz_tag, core.aktion, core.bwa_buchungsstand,
                       core.kennzahlen_monat, core.umsatzbericht_tag
                     RESTART IDENTITY CASCADE`)

    // getKennzahlen kennt Betriebe nur über eine numerische LINA-ID. Ohne
    // Brücke fällt jede BWA-Zeile durch den Filter — der Ausfall vom
    // 26.07.2026. Der Fixture-Betrieb heisst dort 4210.
    await db.query(
      `INSERT INTO core.betrieb (enc_id, lina_betrieb_id, name, aktiv, hat_bwa)
       VALUES ('ENCID_BWA_STAND', 4210, 'Prüfbetrieb Buchungsstand', true, true)
       ON CONFLICT (enc_id) DO UPDATE SET lina_betrieb_id = EXCLUDED.lina_betrieb_id`)

    await db.query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet) VALUES
         ('getUmsatzbericht',     $1::date, $1::date, 10),
         ('getAktionsbericht',    $1::date, $1::date, 10),
         ('getKennzahlen:absolut','2026-01-01','2026-12-31', 10)
       ON CONFLICT DO NOTHING`, [TAG])

    const { workerLauf } = await import('./worker')
    await workerLauf('manuell')
  })

  afterAll(async () => { mock.stop(); await db.end() })

  test('alle drei Posten laufen fehlerfrei durch', async () => {
    const { rows: [{ n }] } = await db.query(
      `SELECT count(*)::int AS n FROM sync.aufgabe WHERE status = 'fehler'`)
    expect(n).toBe(0)
  })

  test('die Aktionen landen als Dimension, samt Laufzeit', async () => {
    const { rows } = await db.query(
      `SELECT lina_id, name, gueltig_von, gueltig_bis FROM core.aktion ORDER BY lina_id`)
    expect(rows).toHaveLength(3)
    const sommer = rows.find(r => Number(r.lina_id) === 8)!
    expect(sommer.name).toBe('Mexican Summer')
    // Unix-Sekunden über die Berliner Wanduhr — in UTC wäre es der 31.05.
    expect(String(sommer.gueltig_von).slice(0, 10)).toBe('2026-06-01')
    // Zwei der drei Aktionen laufen unbefristet — das ist kein Fehlen.
    expect(rows.find(r => Number(r.lina_id) === 4)!.gueltig_von).toBeNull()
  })

  /**
   * Der Kern des Befunds: vorher stand hier 0.
   *
   * Geprüft wird die ZEILENZAHL, nicht der Postenstatus. Der Posten meldete
   * auch vorher `ok` — das war ja das Problem.
   */
  test('die Aktionsumsätze landen in core, leere Zellen nicht', async () => {
    const { rows: [{ n }] } = await db.query(
      `SELECT count(*)::int AS n FROM core.aktionsumsatz_tag`)
    // 3 Betriebe × 3 Aktionen = 9 Zellen, davon 3 mit Umsatz.
    expect(n).toBe(3)
    const { rows: [{ n: leer }] } = await db.query(
      `SELECT count(*)::int AS n FROM core.aktionsumsatz_tag
        WHERE coalesce(umsatz_netto, umsatz_brutto, 0) = 0`)
    expect(leer).toBe(0)
  })

  /**
   * Eine Zelle ist ein Objekt `{revenue, percent}`, keine Zahl. Die erste
   * Fassung nahm eine Zahl an und hätte für jeden gefüllten Tag null Zeilen
   * geschrieben — bei Status `ok`.
   */
  test('der Tagesanteil kommt von LINA, nicht aus eigener Rechnung', async () => {
    const { rows } = await db.query(
      `SELECT anteil_pct FROM mart.aktionsumsatz
        WHERE betrieb = 'Betrieb 03' AND aktion = 'Mexican Summer'`)
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].anteil_pct)).toBeCloseTo(1.06, 2)
  })

  test('mart.aktionsumsatz_monat setzt den Umsatz ins Verhältnis', async () => {
    const { rows } = await db.query(
      `SELECT aktion, umsatz_netto, umsatz_betrieb_gesamt, anteil_pct
         FROM mart.aktionsumsatz_monat
        WHERE betrieb = 'Betrieb 03' AND aktion = 'Mexican Summer'`)
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].umsatz_netto)).toBeCloseTo(2405.60, 2)
    // Der Nenner kommt aus dem Umsatzbericht, nicht aus der Summe der Aktionen:
    // 2405,60 von 226.434,23 = 1,06 %.
    expect(Number(rows[0].umsatz_betrieb_gesamt)).toBeCloseTo(226434.23, 2)
    expect(Number(rows[0].anteil_pct)).toBeCloseTo(1.06, 2)
  })

  test('mart.aktion trennt hinterlegte von tatsächlicher Laufzeit', async () => {
    const { rows } = await db.query(
      `SELECT aktion, unbefristet, erster_umsatztag FROM mart.aktion WHERE lina_id = 4`)
    expect(rows[0].unbefristet).toBe(true)
    expect(String(rows[0].erster_umsatztag).slice(0, 10)).toBe(TAG)
  })

  /**
   * Der Buchungsstand entsteht beim Laden, nicht per Hand.
   *
   * Der Fixture-Betrieb hat Mai auf 0,00 und Juni auf 68.433,72. Gebucht ist
   * damit Juni — „gebucht" heisst wert_absolut IS NOT NULL AND <> 0, wortgleich
   * mit mart.round_table_basis.
   */
  test('getKennzahlen schreibt den Buchungsstand mit', async () => {
    const { rows } = await db.query(
      `SELECT s.letzter_monat FROM core.bwa_buchungsstand s
         JOIN core.betrieb b USING (betrieb_key) WHERE b.lina_betrieb_id = 4210`)
    expect(rows).toHaveLength(1)
    expect(String(rows[0].letzter_monat).slice(0, 10)).toBe('2026-06-01')
  })

  /**
   * Und er sinkt nicht wieder.
   *
   * `getKennzahlen:relativ` füllt NUR wert_prozent. Ohne `greatest` würde der
   * relative Abruf den eben gesetzten Stand auf NULL zurücksetzen — und aus
   * einem Betrieb mit gebuchter BWA würde einer, der nie eine hatte.
   */
  test('ein relativer Abruf setzt den Stand nicht zurück', async () => {
    await db.query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
       VALUES ('getKennzahlen:relativ','2026-01-01','2026-12-31', 10)`)
    const { workerLauf } = await import('./worker')
    await workerLauf('manuell')

    const { rows } = await db.query(
      `SELECT s.letzter_monat FROM core.bwa_buchungsstand s
         JOIN core.betrieb b USING (betrieb_key) WHERE b.lina_betrieb_id = 4210`)
    expect(String(rows[0].letzter_monat).slice(0, 10)).toBe('2026-06-01')
  }, 60_000)

  /**
   * Die drei Zustände, die die Tabelle überhaupt erst rechtfertigen.
   *
   * Ohne sie hiesse „keine BWA für Juni" für alle dasselbe. Am 26.07.2026
   * hatten 72 von 141 Betrieben NIE eine BWA — ein Alarm auf die Null-Quote
   * ginge jeden Monat los und wäre jedes Mal falsch.
   */
  test('mart.bwa_rueckstand unterscheidet nie gebucht, ungeprüft und aktuell', async () => {
    // So sieht ein Betrieb aus, dessen BWA-Zeilen alle auf 0,00 stehen: der
    // Ladepfad schreibt ihn mit letzter_monat = NULL.
    await db.query(
      `INSERT INTO core.betrieb (enc_id, lina_betrieb_id, name, aktiv)
       VALUES ('ENCID_OHNE_BWA', 999998, 'Prüfbetrieb ohne BWA', true)
       ON CONFLICT (enc_id) DO NOTHING`)
    await db.query(
      `INSERT INTO core.bwa_buchungsstand (betrieb_key, letzter_monat)
       SELECT betrieb_key, NULL FROM core.betrieb WHERE enc_id = 'ENCID_OHNE_BWA'
       ON CONFLICT (betrieb_key) DO NOTHING`)

    const { rows } = await db.query(
      `SELECT betrieb, lage, rueckstand_monate, auffaellig FROM mart.bwa_rueckstand
        WHERE betrieb IN ('Prüfbetrieb Buchungsstand', 'Prüfbetrieb ohne BWA', 'Betrieb 03')`)
    const lage = Object.fromEntries(rows.map(r => [r.betrieb, r]))

    expect(lage['Prüfbetrieb Buchungsstand'].lage).toBe('aktuell')
    expect(lage['Prüfbetrieb Buchungsstand'].rueckstand_monate).toBe(0)
    // Nie gebucht ist KEIN Befund — genau dafür gibt es die Tabelle.
    expect(lage['Prüfbetrieb ohne BWA'].lage).toBe('nie gebucht')
    expect(lage['Prüfbetrieb ohne BWA'].auffaellig).toBe(false)
    // Wer nie in einem getKennzahlen-Posten vorkam, ist ungeprüft — ein
    // dritter Zustand, den ein NULL nicht ausdrücken könnte.
    expect(lage['Betrieb 03'].lage).toBe('ungeprueft')
  })
})

/**
 * Was passiert, wenn LINA dichtmacht.
 *
 * Der einzige Fall, den man nicht abwarten kann, sondern bauen muss — und der
 * teuerste, wenn er falsch behandelt wird: es gibt genau einen Zugang, und
 * eine Kontosperre wäre nicht rückgängig zu machen.
 *
 * Geprüft wird deshalb nicht nur, dass der Lauf endet, sondern vor allem, wie
 * oft danach noch angeklopft wird. Die richtige Antwort ist: kein einziges Mal.
 */
lauf('Zugangssperre', () => {
  let db: Client
  let port: number

  const frisch = async () => {
    await db.query(`DELETE FROM sync.zugangssperre`)
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf RESTART IDENTITY CASCADE`)
    for (let i = 1; i <= 5; i++) {
      await db.query(
        `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
         VALUES ('getUmsatzbericht', $1::date, $1::date, 10)`, [`2026-06-0${i}`])
    }
  }

  beforeAll(async () => {
    const { config } = await import('../config')
    port = Number(new URL(config.LINA_BASE_URL).port)
    db = new Client({ connectionString: DB })
    await db.connect()
  })

  afterAll(async () => {
    // Nicht liegen lassen: eine aktive Sperre würde jeden weiteren Lauf
    // stilllegen — auch die anderer Testdateien.
    await db.query(`DELETE FROM sync.zugangssperre`)
    await db.end()
  })

  test('HTTP 429: ein einziger Versuch, dann Ruhe', async () => {
    await frisch()
    const mock = mockStarten({ port, sperreAb: 1, sperreArt: 429 })
    try {
      const { workerLauf } = await import('./worker')
      const r = await workerLauf('manuell')
      expect(r.status).toBe('abgebrochen')
      // Der Punkt der ganzen Übung: NICHT zehnmal nachfassen.
      expect(mock.gesperrteAufrufe).toBe(1)
    } finally { mock.stop() }

    const { rows: [s] } = await db.query(
      `SELECT art, http_status, aktiv FROM mart.zugangssperre LIMIT 1`)
    expect(s.art).toBe('http_429')
    expect(s.http_status).toBe(429)
    expect(s.aktiv).toBe(true)
  }, 30_000)

  /**
   * Der Posten ist in Ordnung, der Zugang nicht. Ihn als „aufgegeben" zu
   * quittieren wäre eine Falschaussage über die Daten — und nach vier Sperren
   * wäre er dauerhaft weg, ohne je an LINA gescheitert zu sein.
   */
  test('der Posten wird weder aufgegeben noch mit einem Versuch belastet', async () => {
    // Den Posten holen, den der Worker ANGEFASST hat -- nicht den mit der
    // kleinsten posten_id. Bei gleicher Prioritaet nimmt der Worker nicht
    // den zuerst eingereihten, und der Test stand deshalb dauerhaft auf
    // rot: er las Posten 1, bearbeitet wurde Posten 5. Die Reihenfolge ist
    // Sache des Workers; der Test soll die Zusicherung pruefen, nicht die
    // Reihenfolge mitraten.
    const { rows: [p] } = await db.query(
      `SELECT ergebnis, erledigt_am, in_arbeit_seit, versuche, letzter_fehler
         FROM sync.warteschlange
        WHERE letzter_fehler IS NOT NULL
        ORDER BY posten_id LIMIT 1`)
    expect(p).toBeDefined()
    expect(p.ergebnis).toBeNull()
    expect(p.erledigt_am).toBeNull()
    expect(p.in_arbeit_seit).toBeNull()
    expect(Number(p.versuche)).toBe(0)
    expect(String(p.letzter_fehler)).toContain('429')

    const { rows: [{ n: offen }] } = await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange WHERE erledigt_am IS NULL`)
    expect(offen).toBe(5)
  })

  test('der nächste Lauf nimmt gar keinen Kontakt auf', async () => {
    const mock = mockStarten({ port })
    try {
      const { workerLauf } = await import('./worker')
      const r = await workerLauf('zeitplan')
      expect(r.status).toBe('gesperrt')
      // Kein Datenaufruf UND keine Anmeldung. Auch das Anmelden ist Kontakt.
      expect(mock.anmeldungen).toBe(0)
      expect(Object.keys(mock.zaehler)).toHaveLength(0)
    } finally { mock.stop() }
  }, 30_000)

  /**
   * Die Sperre ist kein Endzustand, auf den jemand reagieren MUSS.
   *
   * Eugene: „soll es nicht auf eine Freigabe warten, sondern einfach im
   * Zeitintervall von einem Tag neu versuchen". Genau das wird hier geprüft:
   * eine abgelaufene Sperre lässt den Importer von selbst weiterarbeiten,
   * ohne dass jemand etwas aufhebt.
   */
  test('eine abgelaufene Sperre gibt den Weg von selbst frei', async () => {
    await db.query(`UPDATE sync.zugangssperre SET pausiert_bis = now() - interval '1 minute'
                     WHERE aufgehoben_am IS NULL`)
    const mock = mockStarten({ port })
    try {
      const { workerLauf } = await import('./worker')
      const r = await workerLauf('zeitplan')
      expect(r.status).not.toBe('gesperrt')
      expect(mock.anmeldungen).toBe(1)
    } finally { mock.stop() }
  }, 60_000)

  test('der Statusbericht meldet die Sperre, solange sie läuft', async () => {
    await db.query(`DELETE FROM sync.zugangssperre`)
    const { statusErheben } = await import('../status')

    const vorher = await statusErheben()
    expect(vorher.pruefungen.find(x => x.name === 'zugang')!.stufe).toBe('ok')

    // Eine gewöhnliche Sperre: wissenswert, aber niemand muss nachts raus.
    await db.query(`SELECT sync.sperre_setzen('http_429', 24, 429, 'probe', 'Test')`)
    const gesperrt = await statusErheben()
    const z = gesperrt.pruefungen.find(x => x.name === 'zugang')!
    expect(z.stufe).toBe('warnung')
    expect(z.meldung).toContain('ruht')
    expect(z.naechster_schritt).toContain('läuft von selbst ab')
    // Kein zweiter Alarm für dieselbe Ursache: der Stillstand ist erklärt.
    expect(gesperrt.pruefungen.find(x => x.name === 'fortschritt')!.stufe).toBe('ok')

    // Der Anmeldefall wiegt schwerer — es gibt genau einen Zugang.
    await db.query(`DELETE FROM sync.zugangssperre`)
    await db.query(`SELECT sync.sperre_setzen('anmeldung', 48, NULL, 'probe', 'Test')`)
    const schwer = await statusErheben()
    expect(schwer.pruefungen.find(x => x.name === 'zugang')!.stufe).toBe('stoerung')
    expect(schwer.status).toBe('stoerung')

    await db.query(`DELETE FROM sync.zugangssperre`)
  })

  /**
   * Der Nachlauf hängt am Sync-Lauf. Damit hängt das Berichtswesen am Import —
   * erlaubt, solange es NIE in die andere Richtung wirkt: ein abgestürztes,
   * abgeschaltetes oder nie eingerichtetes Metabase ist kein Importproblem.
   *
   * Das ist die Zusicherung, auf der die ganze Konstruktion steht. Ohne sie
   * hätte ein Metabase-Ausfall den Datenimport mitgerissen.
   */
  test('ein kaputtes Metabase lässt den Sync-Lauf unberührt', async () => {
    const { auswahllistenAbgleichen, auswahllistenNachlauf } =
      await import('./auswahllisten')

    // Seit dem Umzug nach Hetzner läuft der Abgleich über Metabases HTTP-API
    // statt über dessen Datenbank — die Zusicherung ist dieselbe geblieben,
    // nur die Adresse, an der garantiert nichts antwortet, ist eine andere.
    const vorher = {
      url: process.env.METABASE_URL,
      user: process.env.METABASE_USER,
      pass: process.env.METABASE_PASSWORD,
    }
    try {
      process.env.METABASE_URL = 'http://127.0.0.1:9'
      process.env.METABASE_USER = 'niemand'
      process.env.METABASE_PASSWORD = 'nichts'

      const r = await auswahllistenAbgleichen()
      expect(r.status).toBe('fehler')
      expect(r.geaendert).toBe(0)

      // Und der Nachlauf, wie sync.ts ihn aufruft: protokolliert, wirft nicht.
      await auswahllistenNachlauf()
    } finally {
      for (const [k, v] of Object.entries(
        { METABASE_URL: vorher.url, METABASE_USER: vorher.user, METABASE_PASSWORD: vorher.pass })) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  }, 30_000)

  /**
   * Dieselbe Zusicherung für den zweiten Nachlauf: der Refresh von
   * mart.deckungsbeitrag_warengruppe (Migration 0027) hängt genauso am
   * Sync-Lauf wie der Listenabgleich darüber — und darf ihn genauso wenig
   * scheitern lassen. Ein misslungener Refresh bedeutet veraltete
   * Auswertungen, nicht verlorene Daten.
   *
   * Geprüft wird zusätzlich, dass die Zeitgrenze zurückgenommen wird. Bliebe
   * sie an der Verbindung hängen, erbte sie der nächste Nutzer aus dem Pool
   * und ein langer Import bräche nach 15 Minuten ab — mit einem Fehler, dessen
   * Ursache nirgends sichtbar wäre.
   */
  test('ein misslungener Refresh lässt den Sync-Lauf unberührt', async () => {
    const { deckungsbeitragAuffrischen, deckungsbeitragNachlauf } =
      await import('./deckungsbeitrag')
    const { query } = await import('../db/pool')

    // Die Sicht wegnehmen, auf die der Refresh zielt — damit scheitert er
    // garantiert, ohne dass an der Datenbank sonst etwas fehlt.
    await query(`ALTER MATERIALIZED VIEW mart.deckungsbeitrag_warengruppe
                 RENAME TO deckungsbeitrag_warengruppe_test`)
    try {
      const r = await deckungsbeitragAuffrischen()
      expect(r.status).toBe('fehler')

      // Und der Nachlauf, wie sync.ts ihn aufruft: protokolliert, wirft nicht.
      await deckungsbeitragNachlauf()

      // Die Zeitgrenze darf nicht an der Verbindung hängengeblieben sein.
      const [t] = await query<{ statement_timeout: string }>(`SHOW statement_timeout`)
      expect(t.statement_timeout).toBe('0')
    } finally {
      await query(`ALTER MATERIALIZED VIEW mart.deckungsbeitrag_warengruppe_test
                   RENAME TO deckungsbeitrag_warengruppe`)
    }
  }, 30_000)

  /**
   * Die Auswahllisten der Dashboard-Filter sind Momentaufnahmen. Veralten sie,
   * fehlt ein Betrieb im Dropdown — und das Dashboard sieht dabei vollständig
   * richtig aus. Genau deshalb muss /status es melden.
   */
  test('der Statusbericht meldet veraltete Auswahllisten', async () => {
    const { statusErheben } = await import('../status')
    const anzahl = await db.query(
      `SELECT count(*)::int AS n FROM mart.betrieb WHERE betrieb IS NOT NULL AND betrieb <> ''`)
    const betriebe = Number(anzahl.rows[0].n)

    // Ohne Merker: noch nie abgeglichen. Kein Alarm, aber ein Hinweis —
    // beim ersten Aufsetzen ist das der Normalzustand.
    await db.query(`DELETE FROM sync.merker WHERE schluessel = 'metabase_auswahllisten'`)
    const ohne = await statusErheben()
    const o = ohne.pruefungen.find(x => x.name === 'dashboard_filter')!
    expect(o.stufe).toBe('ok')
    expect(o.naechster_schritt).toContain('auswahllisten')

    // Stand deckt sich mit dem Bestand: alles in Ordnung.
    await db.query(
      `INSERT INTO sync.merker (schluessel, wert)
       VALUES ('metabase_auswahllisten', jsonb_build_object('anzahl_betriebe', $1::int))`,
      [betriebe])
    const gleich = await statusErheben()
    expect(gleich.pruefungen.find(x => x.name === 'dashboard_filter')!.stufe).toBe('ok')

    // Der Fall, um den es geht: drei Betriebe sind dazugekommen, der
    // Abgleich lief seither nicht.
    await db.query(
      `UPDATE sync.merker SET wert = jsonb_build_object('anzahl_betriebe', $1::int)
        WHERE schluessel = 'metabase_auswahllisten'`, [betriebe - 3])
    const veraltet = await statusErheben()
    const v = veraltet.pruefungen.find(x => x.name === 'dashboard_filter')!
    expect(v.stufe).toBe('warnung')
    expect(v.meldung).toContain('3 Betrieb')
    expect(v.naechster_schritt).toContain('--setzen')

    await db.query(`DELETE FROM sync.merker WHERE schluessel = 'metabase_auswahllisten'`)
  })

  /** Das Aufheben von Hand bleibt — als Abkürzung, nicht als Bedingung. */
  test('von Hand aufheben kürzt die Wartezeit ab', async () => {
    await frisch()
    await db.query(`SELECT sync.sperre_setzen('http_403', 24, 403, 'probe', 'Test')`)

    const gesperrt = mockStarten({ port })
    try {
      const { workerLauf } = await import('./worker')
      expect((await workerLauf('zeitplan')).status).toBe('gesperrt')
    } finally { gesperrt.stop() }

    await db.query(`SELECT sync.sperre_aufheben('test')`)

    const frei = mockStarten({ port })
    try {
      const { workerLauf } = await import('./worker')
      const r = await workerLauf('manuell')
      expect(r.status).not.toBe('gesperrt')
      expect(r.ok).toBe(5)
    } finally { frei.stop() }
  }, 60_000)

  /**
   * Der schwerste Fall. Vorher lief hier genau das, was harte Regel 6
   * verbietet: `holen()` fing den Anmeldefehler als gewöhnlichen Fehler ab,
   * beim nächsten Posten war die Session immer noch nicht angemeldet, also
   * wurde erneut angemeldet — bis zu zehnmal in Folge, stündlich wiederholt.
   */
  test('Anmeldefehler: genau EIN Versuch, niemals eine Schleife', async () => {
    await frisch()
    const mock = mockStarten({ port, sperreAb: 1, sperreArt: 'anmeldung' })
    try {
      const { workerLauf } = await import('./worker')
      const r = await workerLauf('manuell')
      expect(r.status).toBe('abgebrochen')
      expect(mock.anmeldungen).toBe(1)          // <- darauf kommt es an
    } finally { mock.stop() }

    const { rows: [s] } = await db.query(
      `SELECT art, aktiv, pausiert_bis > now() + interval '12 hours' AS lange
         FROM mart.zugangssperre LIMIT 1`)
    expect(s.art).toBe('anmeldung')
    expect(s.aktiv).toBe(true)
    // Deutlich länger als eine gewöhnliche Sperre: hier hilft kein Abwarten,
    // sondern nur ein Mensch, der im Browser nachsieht.
    expect(s.lange).toBe(true)
  }, 30_000)

  test('HTML-Abwehrseite statt Daten wird als Sperre erkannt', async () => {
    await frisch()
    const mock = mockStarten({ port, sperreAb: 1, sperreArt: 'challenge' })
    try {
      const { workerLauf } = await import('./worker')
      expect((await workerLauf('manuell')).status).toBe('abgebrochen')
      expect(mock.gesperrteAufrufe).toBe(1)
    } finally { mock.stop() }
    const { rows: [s] } = await db.query(`SELECT art FROM mart.zugangssperre LIMIT 1`)
    expect(s.art).toBe('challenge')
  }, 30_000)

  test('ein Retry-After, das länger ist als die eigene Pause, gewinnt', async () => {
    await frisch()
    // Acht Stunden — mehr als die Basisdauer von sechs.
    const mock = mockStarten({ port, sperreAb: 1, sperreArt: 429, retryAfter: 8 * 3600 })
    try {
      const { workerLauf } = await import('./worker')
      await workerLauf('manuell')
    } finally { mock.stop() }
    const { rows: [s] } = await db.query(
      `SELECT pausiert_bis > now() + interval '7 hours' AS beachtet FROM mart.zugangssperre LIMIT 1`)
    expect(s.beachtet).toBe(true)
  }, 30_000)
})

/**
 * Der Aufbau der Schemata — das, was Metabase zu sehen bekommt.
 *
 * Bis zum 26.07.2026 legte `core.partition_anlegen()` die Monatspartitionen
 * neben der Elterntabelle ab. In `core` standen daraufhin 84 Tabellen namens
 * `artikelverkauf_tag_2023_07` und rundherum die fünf, um die es tatsächlich
 * geht. In Postico ist das lästig, in Metabase unbenutzbar.
 *
 * Die Regel ist einfach genug, um sie zu prüfen, und sie geht bei der
 * nächsten Änderung an partition_anlegen() lautlos kaputt — deshalb steht
 * sie hier und nicht nur in einem Kommentar.
 */
lauf('Aufbau der Schemata', () => {
  let db: Client
  beforeAll(async () => { db = new Client({ connectionString: DB }); await db.connect() })
  afterAll(async () => { await db.end() })

  test('in core und raw steht keine einzige Partition', async () => {
    const { rows } = await db.query(`
      SELECT n.nspname || '.' || c.relname AS tabelle
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_inherits i  ON i.inhrelid = c.oid
       WHERE n.nspname <> 'part'`)
    expect(rows.map(r => r.tabelle)).toEqual([])
  })

  test('die Elterntabellen bleiben, wo man sie sucht', async () => {
    const { rows } = await db.query(`
      SELECT count(*)::int AS n FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'p'
         AND (n.nspname, c.relname) IN (('core','artikelverkauf_tag'), ('raw','api_antwort'))`)
    expect(rows[0].n).toBe(2)
  })

  test('Metabase findet die Beziehungen des Artikelverkaufs', async () => {
    // Ohne Fremdschlüssel sind betrieb_key und artikel_key dort namenlose
    // Zahlenspalten und kein Drill-Down funktioniert.
    const { rows } = await db.query(`
      SELECT count(*)::int AS n FROM pg_constraint
       WHERE conrelid = 'core.artikelverkauf_tag'::regclass AND contype = 'f'`)
    expect(rows[0].n).toBe(2)
  })
})

/**
 * FoodNotify Ende-zu-Ende: Warteschlange → FnClient → raw, mit Mandanten.
 *
 * Läuft gegen die FoodNotify-Attrappe aus dem Kopf der Datei (deren URL in
 * config.FN_BASE_URL eingefroren ist) und beweist die vier Zusicherungen
 * von Stufe 1.4:
 *   1. Ein fn:-Posten wird mit den Zugangsdaten seiner Marke geholt und
 *      landet im Raw-Layer, das Protokoll trägt Mandant und Parameter.
 *   2. Eine leere 200er-Antwort, wo früher Daten kamen, erzeugt eine
 *      schema_abweichung — der Wilma-Wunder-Fehler bleibt nicht lautlos.
 *   3. 2FA bricht die Anmeldung ab, ohne einen zweiten Versuch.
 *   4. Eine gesperrte Marke vertagt nur die eigenen Posten; der Lauf und
 *      die anderen Mandanten laufen weiter, es entsteht KEINE globale Sperre.
 */
lauf('FoodNotify Ende-zu-Ende', () => {
  let db: Client
  let aposto: number
  let enchilada: number

  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
    await db.query(`DELETE FROM sync.zugangssperre`)
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf, sync.schema_abweichung
                    RESTART IDENTITY CASCADE`)
    const { rows } = await db.query(`SELECT marke_key, schluessel FROM core.marke`)
    aposto = Number(rows.find(r => r.schluessel === 'aposto')!.marke_key)
    enchilada = Number(rows.find(r => r.schluessel === 'enchilada')!.marke_key)
  })

  afterAll(async () => { await db.end() })

  test('der Durchstich: vier A1-Posten, der Rest steuert sich selbst bis in die Positionen', async () => {
    await db.query(`TRUNCATE core.bestellposition, core.bestellung, core.ware,
                       core.lieferant, core.kostenstelle RESTART IDENTITY CASCADE`)
    // Genau das, was `bun run einreihen --foodnotify` einreiht — die vier
    // Organisationsposten. Alles Weitere entsteht beim Laden.
    await db.query(
      `INSERT INTO sync.warteschlange
         (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter) VALUES
         ('fn:profil',         current_date, current_date, 5, $1, '{}'),
         ('fn:betriebe',       current_date, current_date, 5, $1, '{}'),
         ('fn:kostenstellen',  current_date, current_date, 5, $1, '{}'),
         ('fn:pos_standorte',  current_date, current_date, 6, $1, '{}')`,
      [aposto])

    const { workerLauf } = await import('./worker')
    const r = await workerLauf('manuell')
    expect(r.status).toBe('ok')
    // 4 A1 + 4 Bestellseiten (Küche 3, Bar leer 1) + je Bestellung Kopf und
    // Positionen (4 × 2) = 16 Posten, alle in EINEM Lauf.
    expect(r.ok).toBe(16)
    // Genau eine Anmeldung für alles — die Session wird gehalten.
    expect(fnMock.anmeldungen).toBe(1)

    // Jede Antwort im Raw-Layer trägt quelle='foodnotify' — der
    // Spalten-Default ist 'lina' und griff anfangs stillschweigend.
    const { rows: [rawQuelle] } = await db.query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE quelle = 'foodnotify')::int AS fn
         FROM raw.api_antwort WHERE endpunkt LIKE 'fn:%'`)
    expect(rawQuelle.n).toBe(16)
    expect(rawQuelle.fn).toBe(rawQuelle.n)

    // Kostenstellen: Art abgeleitet, Kassenanbindung nachgetragen.
    const { rows: ks } = await db.query(
      `SELECT name, art, connection_id, kassensystem FROM core.kostenstelle ORDER BY kostenstelle_id`)
    expect(ks).toHaveLength(2)
    expect(ks[0]).toMatchObject({ name: 'Küche Aposto Gera ', art: 'kueche',
                                  connection_id: 1907, kassensystem: 'amadeus' })
    expect(ks[1]).toMatchObject({ name: 'Bar Aposto Gera ', art: 'bar',
                                  connection_id: null, kassensystem: null })

    // DIE RÜCKWÄRTS-REIHENFOLGE: Seite 1 ist der Einstieg, danach kommen
    // die Seiten von hinten — 3 (neueste Bestellungen) vor 2. Belegt über
    // die Abarbeitungsreihenfolge im Aufgabenprotokoll.
    const { rows: seitenfolge } = await db.query(
      `SELECT parameter->>'seite' AS seite FROM sync.aufgabe
        WHERE endpunkt = 'fn:bestellungen' AND parameter->>'erpId' = '10483'
        ORDER BY aufgabe_id`)
    expect(seitenfolge.map(z => z.seite)).toEqual(['1', '3', '2'])

    // Bestellungen: Kopf-Daten aus fn:bestellung, Lieferant angelegt.
    const { rows: best } = await db.query(
      `SELECT b.fn_id, b.bestellnummer, b.status, b.summe, b.beleg_nummer,
              b.geliefert_am::text AS geliefert_am, l.name AS lieferant
         FROM core.bestellung b LEFT JOIN core.lieferant l USING (lieferant_key)
        ORDER BY b.fn_id`)
    expect(best).toHaveLength(4)
    expect(best[0]).toMatchObject({
      fn_id: 'b1', bestellnummer: 'A-100', status: 'imported',
      beleg_nummer: 'RE-2021-4711', geliefert_am: '2021-10-17', lieferant: 'Distra Aposto',
    })
    expect(Number(best[0].summe)).toBe(214.5)

    /**
     * DER STATUS KOMMT ALS OBJEKT AN UND ALS WORT IN core.
     *
     * Bis zum 04.08.2026 stand hier in JEDER Zeile `[object Object]`,
     * ueber alle vier Marken und 44.271 Bestellungen — und damit zaehlten
     * 1.561 Stornos (2,49 Mio EUR) im Einkaufsvolumen mit. Die Zusicherung
     * gilt der ganzen Spalte, nicht nur b2: ein zweites Feld mit derselben
     * Form soll hier auffallen und nicht erst im Bestand.
     */
    expect(best.map(b => b.status))
      .toEqual(['imported', 'canceled', 'imported', 'pending'])
    expect(best.filter(b => String(b.status).includes('[object'))).toEqual([])

    // Positionen: echte Belegpreise, die Abweichungsflagge, die Ware verknüpft.
    const { rows: pos } = await db.query(
      `SELECT p.name, p.menge, p.einzelpreis, p.preis_abweichend, p.ersetzt, w.fn_id AS ware
         FROM core.bestellposition p LEFT JOIN core.ware w USING (ware_key) ORDER BY p.fn_id`)
    expect(pos).toHaveLength(5)
    expect(pos[1]).toMatchObject({ name: 'Zwiebeln Rot Sack 10Kg', preis_abweichend: true, ware: '15790513' })
    expect(Number(pos[1].einzelpreis)).toBe(12)
    expect(pos[2]).toMatchObject({ name: 'Auberginen Kg', ersetzt: true })

    // Die leere Bar-Seite ist ein LEGITIMER Leerfall: ok, 0 Zeilen, KEINE
    // Abweichung — sie hat ja nie Daten geliefert.
    const { rows: [bar] } = await db.query(
      `SELECT status, zeilen FROM sync.aufgabe
        WHERE endpunkt = 'fn:bestellungen' AND parameter->>'erpId' = '10484'`)
    expect(bar.status).toBe('ok')
    expect(Number(bar.zeilen)).toBe(0)
    const { rows: abw } = await db.query(`SELECT 1 FROM sync.schema_abweichung`)
    expect(abw).toHaveLength(0)

    // Detail-Posten tragen das BESTELLDATUM als Zeitraum — der Fortschritt
    // zeigt, in welchem Jahr der Backfill steckt.
    const { rows: [detail] } = await db.query(
      `SELECT zeitraum_von::text AS von FROM sync.warteschlange
        WHERE endpunkt = 'fn:bestellung' AND parameter->>'orderId' = 'b1'`)
    expect(detail.von).toBe('2021-10-15')

    // Und nichts blieb liegen.
    const { rows: [offen] } = await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange
        WHERE erledigt_am IS NULL AND marke_key IS NOT NULL`)
    expect(Number(offen.n)).toBe(0)
  })

  test('ein zweiter Durchstich reiht nichts erneut ein — NOT EXISTS gegen alle Posten', async () => {
    await db.query(
      `INSERT INTO sync.warteschlange
         (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
       SELECT 'fn:kostenstellen', current_date, current_date, 5, $1, '{}'::jsonb`,
      [aposto])
    const { workerLauf } = await import('./worker')
    const r = await workerLauf('manuell')
    expect(r.status).toBe('ok')
    // Nur der eine Kostenstellen-Posten lief; die Bestellseiten von eben
    // wurden NICHT erneut eingereiht.
    expect(r.ok).toBe(1)
    const { rows: [seiten] } = await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange WHERE endpunkt = 'fn:bestellungen'`)
    expect(Number(seiten.n)).toBe(4)
  })

  test('eine leere 200er-Antwort nach früheren Daten wird zur schema_abweichung', async () => {
    // Dieselbe Kombination noch einmal — die Attrappe antwortet jetzt leer.
    await db.query(
      `INSERT INTO sync.warteschlange
         (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter) VALUES
         ('fn:bestellungen', current_date, current_date, 90, $1, '{"erpId":"10483","seite":"1"}')`,
      [aposto])
    const { workerLauf } = await import('./worker')
    const r = await workerLauf('manuell')
    expect(r.status).toBe('ok')

    const { rows } = await db.query(
      `SELECT tatsaechlich FROM sync.schema_abweichung WHERE endpunkt = 'fn:bestellungen'`)
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows[0].tatsaechlich)).toContain('0 Zeilen')
  })

  test('2FA bricht die Anmeldung ab — kein zweiter Versuch', async () => {
    const { FnSession, FnAnmeldungFehlgeschlagen } = await import('../foodnotify/auth')
    const vorher = fnMock.anmeldungen
    const s = new FnSession({ schluessel: 'enchilada', user: 'zfa@aposto.eu', password: 'geheim' })
    expect(s.anmelden()).rejects.toThrow(FnAnmeldungFehlgeschlagen)
    await s.anmelden().catch((e: Error) => {
      expect(e.message).toContain('2FA')
      expect(e.message).toContain('Subuser')
    })
    // Zwei bewusste Aufrufe im Test — aber die Session selbst hat nie
    // nachgefasst und ist nicht angemeldet.
    expect(fnMock.anmeldungen).toBe(vorher + 2)
    expect(s.istAngemeldet).toBe(false)
  })

  test('eine gesperrte Marke vertagt nur die eigenen Posten — der Lauf läuft weiter', async () => {
    // Enchilada läuft auf den 2FA-Benutzer: die Anmeldung scheitert. Daneben
    // ein Aposto-Posten, der durchkommen muss.
    await db.query(
      `INSERT INTO sync.warteschlange
         (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter) VALUES
         ('fn:kostenstellen', current_date - 1, current_date - 1, 5, $1, '{}'),
         ('fn:profil',        current_date - 1, current_date - 1, 6, $2, '{}')`,
      [enchilada, aposto])

    const { workerLauf } = await import('./worker')
    const r = await workerLauf('manuell')

    // Kein Abbruch: der Aposto-Posten ist erledigt.
    expect(r.status).toBe('ok')
    const { rows: [apostoPosten] } = await db.query(
      `SELECT ergebnis FROM sync.warteschlange WHERE endpunkt = 'fn:profil' AND marke_key = $1`,
      [aposto])
    expect(apostoPosten.ergebnis).toBe('ok')

    // Der Enchilada-Posten ist weder aufgegeben noch verbraucht — nur vertagt,
    // um die Anmeldesperre-Frist (48 h), nicht bis zum nächsten Stundenlauf.
    const { rows: [vertagt] } = await db.query(
      `SELECT ergebnis, versuche, faellig_ab > now() + interval '24 hours' AS weit_genug
         FROM sync.warteschlange WHERE marke_key = $1`, [enchilada])
    expect(vertagt.ergebnis).toBeNull()
    expect(Number(vertagt.versuche)).toBe(0)
    expect(vertagt.weit_genug).toBe(true)

    // Und vor allem: KEINE globale Sperre — LINA und die anderen Marken
    // wären sonst mitgerissen.
    const { rows: sperren } = await db.query(`SELECT * FROM sync.zugangssperre`)
    expect(sperren).toHaveLength(0)
  })

  /**
   * B1 · Inventuren (plan-foodnotify.md Stufe 4). Anders als bei
   * Bestellungen bündelt EIN fn:inventuren-Posten ALLE Kostenstellen der
   * Marke (erpIds[]) — die Kostenstelle steckt in jeder Zeile der Antwort,
   * nicht im Posten-Parameter. Positionen folgen automatisch, wie bei
   * Bestellungen Kopf und Positionen aus der Liste folgen.
   */
  test('Inventuren: ein Aufruf für alle Kostenstellen, Positionen folgen automatisch', async () => {
    await db.query(
      `INSERT INTO sync.warteschlange
         (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
       VALUES ('fn:inventuren', current_date, current_date, 95, $1, $2::jsonb)`,
      [aposto, JSON.stringify({ erpIds: '10483,10484', seite: '1' })])

    const { workerLauf } = await import('./worker')
    const r = await workerLauf('manuell')
    expect(r.status).toBe('ok')
    /**
     * Fünf Posten in einem Lauf: Inventurliste Seite 1 und 2, dazu die
     * Zählungen — inv-1 über ZWEI Seiten, inv-2 über eine.
     *
     * Die fünfte ist die, die es bis zum 13.08.2026 nicht gab. Der Pfadbau
     * kannte keinen `page`-Parameter, also endete jede Zählung nach
     * `perPage`. In Produktion waren das 800: neun Inventuren abgeschnitten,
     * 936 Positionen fehlend, HTTP 200, kein Log.
     */
    expect(r.ok).toBe(5)

    const { rows: inventuren } = await db.query(
      `SELECT i.fn_uuid, i.name, i.art, i.status, i.anzahl_positionen, k.erp_id
         FROM core.inventur i JOIN core.kostenstelle k USING (kostenstelle_key)
        WHERE k.marke_key = $1
        ORDER BY i.fn_uuid`, [aposto])
    expect(inventuren).toHaveLength(2)
    // DER STATUS KOMMT ALS OBJEKT — dieselbe Form wie shopOrderStatus (0043),
    // hier von Anfang an über alsBezeichnung gelesen statt über String().
    expect(inventuren[0]).toMatchObject({
      fn_uuid: 'inv-1', name: 'Kücheninventur Juli', art: 'full', status: 'signed',
      anzahl_positionen: 2, erp_id: 10483,
    })
    expect(inventuren[1]).toMatchObject({
      fn_uuid: 'inv-2', name: 'Barinventur August', art: 'full', status: 'counting',
      anzahl_positionen: 1, erp_id: 10484,
    })
    expect(inventuren.some(i => String(i.status).includes('[object'))).toBe(false)

    // Die Positionen: Sollbestand, gezählte Menge, Preis je Basiseinheit —
    // und shopArticleId zeigt auf core.ware mit quelle='lieferant', NICHT
    // auf core.artikel (plan-foodnotify.md, Warnung um Zeile 146).
    const { rows: positionen } = await db.query(
      `SELECT p.name, p.soll_menge, p.gezaehlt_menge, p.preis_je_basiseinheit,
              w.fn_id AS ware, w.quelle
         FROM core.inventurposition p
         JOIN core.inventur i USING (inventur_key)
         JOIN core.kostenstelle k USING (kostenstelle_key)
         LEFT JOIN core.ware w USING (ware_key)
        WHERE k.marke_key = $1
        ORDER BY i.fn_uuid, p.name`, [aposto])
    expect(positionen).toHaveLength(3)
    const orangensaft = positionen.find(p => p.name.startsWith('Granini'))!
    expect(orangensaft).toMatchObject({ ware: 'L-9001', quelle: 'lieferant' })
    expect(Number(orangensaft.soll_menge)).toBeCloseTo(29612.59, 2)
    expect(Number(orangensaft.gezaehlt_menge)).toBe(6000)
    // Ohne shopArticleId bleibt die Ware NULL statt erfunden.
    const zwiebeln = positionen.find(p => p.name.startsWith('Zwiebeln'))!
    expect(zwiebeln.ware).toBeNull()

    /**
     * SEITE 2 DARF NICHT LÖSCHEN, WAS SEITE 1 GESCHRIEBEN HAT.
     *
     * Das Laden ersetzt die Zählung einer Inventur vollständig (DELETE, dann
     * INSERT) — richtig, solange eine Antwort der ganze Stand ist. Sobald
     * geblättert wird, ist sie das nicht mehr: ein DELETE je Seite liesse am
     * Ende nur die LETZTE Seite stehen. Bei der 817er-Inventur aus Produktion
     * wären das 17 statt 817 Positionen, und es sähe aus wie eine sehr kleine
     * Inventur. Deshalb löscht nur Seite 1.
     *
     * inv-1 hat in der Attrappe zwei Seiten zu je einer Position. Beide sind
     * hier — Granini von Seite 1, Zwiebeln von Seite 2.
     */
    expect(orangensaft).toBeDefined()
    expect(zwiebeln).toBeDefined()
    const { rows: [inv1] } = await db.query(
      `SELECT count(*)::int AS n FROM core.inventurposition p
         JOIN core.inventur i USING (inventur_key)
        WHERE i.fn_uuid = 'inv-1'`)
    expect(Number(inv1.n)).toBe(2)

    // Und der Kopf sagt dasselbe wie die Zeilen: nichts ist abgeschnitten.
    const { rows: abgeschnitten } = await db.query(
      `SELECT fn_uuid, fehlend FROM mart.inventur_abgeschnitten`)
    expect(abgeschnitten).toEqual([])

    // Nichts blieb für Aposto liegen (Enchilada steht nach dem vorigen Test
    // bewusst noch vertagt — das ist kein Leck dieses Tests).
    const { rows: [offen] } = await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange
        WHERE erledigt_am IS NULL AND marke_key = $1`, [aposto])
    expect(Number(offen.n)).toBe(0)
  })

  /**
   * DER ZWEITE REPARATURZYKLUS — der Fehler, den der erste versteckt hat.
   *
   * `inventurpositionenNachziehen()` holt eine Inventur erneut, sobald ihr
   * Kopf mehr Positionen meldet als geladen sind. Das passiert nicht einmal,
   * sondern bei JEDER Änderung in FoodNotify. Seite 1 löscht dabei den
   * ganzen Bestand und lädt neu — die Folgeseiten müssen also jedes Mal
   * mitkommen.
   *
   * Bis zum 13.08.2026 kamen sie das nicht. `folgepostenEinreihen()` sperrte
   * gegen ALLE Posten, erledigte eingeschlossen, und `sync.warteschlange`
   * wird nie aufgeräumt: der erledigte Zwilling {uuid, seite:'2'} aus dem
   * ERSTEN Zyklus blockierte den zweiten für immer. Ergebnis wäre gewesen:
   * Seite 1 schreibt 800 Positionen, Seite 2 kommt nie, die Invariante
   * bleibt ungleich — und der nächste Lauf löscht und lädt Seite 1 erneut,
   * jede Nacht.
   *
   * In Produktion am 13.08.2026 gemessen: 9 Inventuren über 800 Positionen
   * (Maximum 1.426), und für alle neun stand der erledigte Seite-2-Posten
   * schon in der Warteschlange. Der zweite Zyklus hätte exakt die 936
   * Positionen wieder verloren, die der erste zurückgeholt hat. Dass der
   * erste gut ging, lag allein am Formatwechsel von {uuid} auf {uuid, seite}
   * — ein einmaliger Zufall, kein Schutz.
   *
   * Der Test baut genau das nach: die Attrappe hat für inv-1 zwei Seiten zu
   * je einer Position, der vorige Test hat beide geholt und dabei den
   * erledigten Seite-2-Posten hinterlassen.
   */
  test('der ZWEITE Reparaturzyklus holt die Folgeseiten wieder mit', async () => {
    const { inventurpositionenNachziehen } = await import('./nachfuellen')
    const { workerLauf } = await import('./worker')

    // Vorbedingung aus dem vorigen Test: beide Seiten sind geholt, und der
    // Seite-2-Posten steht ERLEDIGT in der Schlange. Ohne ihn prüft der Test
    // nichts — deshalb hier laut statt still.
    const seite2 = async () => Number((await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange
        WHERE endpunkt = 'fn:inventurpositionen' AND marke_key = $1
          AND parameter->>'uuid' = 'inv-1' AND parameter->>'seite' = '2'`,
      [aposto])).rows[0].n)
    expect(await seite2()).toBe(1)
    const { rows: [vorbedingung] } = await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange
        WHERE endpunkt = 'fn:inventurpositionen' AND marke_key = $1
          AND parameter->>'uuid' = 'inv-1' AND erledigt_am IS NULL`, [aposto])
    expect(Number(vorbedingung.n)).toBe(0)

    /**
     * Der Auslöser, wie er in Wirklichkeit entsteht: in FoodNotify fällt eine
     * Position weg oder kommt hinzu, der Kopf sagt etwas anderes als unsere
     * Zeilen. Hier über eine gelöschte Position — Kopf 2, geladen 1.
     */
    await db.query(
      `DELETE FROM core.inventurposition WHERE inventurposition_key IN (
         SELECT ip.inventurposition_key FROM core.inventurposition ip
           JOIN core.inventur i USING (inventur_key)
          WHERE i.fn_uuid = 'inv-1' LIMIT 1)`)
    const geladen = async () => Number((await db.query(
      `SELECT count(*)::int AS n FROM core.inventurposition ip
         JOIN core.inventur i USING (inventur_key) WHERE i.fn_uuid = 'inv-1'`)).rows[0].n)
    expect(await geladen()).toBe(1)
    // Die Sicht benennt es, bevor irgendetwas nachläuft.
    expect((await db.query(
      `SELECT fehlend FROM mart.inventur_abgeschnitten WHERE fn_uuid = 'inv-1'`)).rows)
      .toHaveLength(1)

    // Zyklus zwei: nachziehen reiht Seite 1 ein, Seite 1 reiht Seite 2 nach.
    expect(await inventurpositionenNachziehen(aposto)).toBe(1)
    await workerLauf('manuell')

    /**
     * DER KERN. Ein FRISCHER Seite-2-Posten muss entstanden sein — mit der
     * alten Alle-Posten-Sperre bliebe es bei dem einen aus Zyklus 1, und der
     * Bestand stünde auf 1 statt 2.
     */
    expect(await seite2()).toBe(2)
    expect(await geladen()).toBe(2)

    // Und die Invariante steht wieder: Kopf und Zeilen sind gleich.
    expect((await db.query(
      `SELECT fn_uuid FROM mart.inventur_abgeschnitten WHERE fn_uuid = 'inv-1'`)).rows)
      .toEqual([])

    // Selbstbegrenzend: ein dritter Zyklus wird gar nicht erst eingereiht.
    expect(await inventurpositionenNachziehen(aposto)).toBe(0)
  })

  /**
   * ================================================================
   * BESTELLDETAILS ALTERN NIE NACH — Befund 2.6 vom 13.08.2026
   * ================================================================
   *
   * In Produktion gemessen: von 66.966 Bestellungen wurde JEDE GENAU EINMAL
   * im Detail geholt, keine einzige je erneut (66.966 Aufgaben, 66.966
   * verschiedene orderId, 0 mehrfach). Liefermenge, Lieferdatum, Belegnummer
   * und alle Preisstände standen damit auf dem Stand des ersten Abrufs.
   *
   * Die Ursache ist dieselbe wie bei N1: die Detailposten entstehen über
   * `folgepostenEinreihen()` mit der Sperre gegen ALLE Posten — die Sperre
   * eines EINMALIGEN Abrufs. Genau deshalb prüft der Test nicht nur, DASS
   * eingereiht wird, sondern dass es TROTZ des erledigten Zwillings
   * geschieht.
   */
  describe('Bestelldetails auffrischen', () => {
    const zahlDetail = async (endpunkt: string, orderId: string) => Number((await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange
        WHERE endpunkt = $1 AND marke_key = $2 AND parameter->>'orderId' = $3`,
      [endpunkt, aposto, orderId])).rows[0].n)

    /**
     * Die vier Bestellungen der Attrappe stammen aus 2021 und lägen damit
     * außerhalb der Nachholtiefe von zwölf Monaten. Für den Test rücken sie
     * auf heute — die Tiefe selbst prüft der Test darunter.
     */
    const heuteBestellt = () => db.query(
      `UPDATE core.bestellung SET bestellt_am = now() - interval '2 days'`)

    test('eine veraltete Bestellung wird erneut geholt — trotz erledigtem Zwilling', async () => {
      const { bestelldetailsAuffrischen } = await import('./nachfuellen')

      // Vorbedingung: der Erstabruf hat stattgefunden und liegt ERLEDIGT in
      // der Schlange. Ohne ihn prüft der Test nicht das, worum es geht.
      expect(await zahlDetail('fn:bestellung', 'b1')).toBe(1)
      const { rows: [zwilling] } = await db.query(
        `SELECT count(*)::int AS n FROM sync.warteschlange
          WHERE endpunkt = 'fn:bestellung' AND marke_key = $1
            AND parameter->>'orderId' = 'b1' AND erledigt_am IS NOT NULL`, [aposto])
      expect(Number(zwilling.n)).toBe(1)

      /**
       * Und der Stempel steht: `fn:bestellung` setzt `detail_geholt_am`, der
       * Listen-Upsert von `fn:bestellungen` ausdrücklich nicht — sonst sähe
       * eine Bestellung, deren Status aufgefrischt wurde, aus wie eine, deren
       * Liefermenge aufgefrischt wurde.
       */
      const { rows: [gestempelt] } = await db.query(
        `SELECT count(*)::int AS n FROM core.bestellung WHERE detail_geholt_am IS NOT NULL`)
      expect(Number(gestempelt.n)).toBe(4)

      await heuteBestellt()

      // Frisch geholt (unter 20 h): nichts zu tun.
      expect(await bestelldetailsAuffrischen(aposto)).toBe(0)

      // 21 Stunden später ist das Fenster wieder offen.
      await db.query(`UPDATE core.bestellung SET detail_geholt_am = now() - interval '21 hours'`)
      const eingereiht = await bestelldetailsAuffrischen(aposto)

      /**
       * DER KERN: 6 Posten = 3 nicht-finale Bestellungen mal zwei Endpunkte.
       * b2 ist `canceled` und bleibt liegen. Mit der Alle-Posten-Sperre wären
       * es 0 gewesen — jede dieser sechs Parameterkombinationen steht schon
       * erledigt in der Schlange.
       */
      expect(eingereiht).toBe(6)
      expect(await zahlDetail('fn:bestellung', 'b1')).toBe(2)
      expect(await zahlDetail('fn:bestellpositionen', 'b1')).toBe(2)
      // Der Storno wird NICHT erneut geholt — er ändert sich nicht mehr.
      expect(await zahlDetail('fn:bestellung', 'b2')).toBe(1)

      // Zweimal nachfüllen legt nichts doppelt an: der offene Zwilling sperrt.
      expect(await bestelldetailsAuffrischen(aposto)).toBe(0)

      /**
       * Und nach dem Lauf ist der Stempel frisch — das ist die Bedingung,
       * die morgen wieder greift. Ohne sie liefe das Auffrischen bei jedem
       * Lauf, nicht einmal am Tag.
       */
      const { workerLauf } = await import('./worker')
      await workerLauf('manuell')
      const { rows: [frisch] } = await db.query(
        `SELECT count(*)::int AS n FROM core.bestellung
          WHERE detail_geholt_am > now() - interval '1 hour'`)
      expect(Number(frisch.n)).toBe(3)
      expect(await bestelldetailsAuffrischen(aposto)).toBe(0)
    })

    /**
     * Die Grenze aus Entscheidung 5: zwölf Monate zurück, nicht der ganze
     * Bestand. Das ist eine Grenze und kein Rückstand — sie darf nur nicht
     * still sein, und dafür gibt es `mart.bestelldetail_stand`.
     */
    test('was älter ist als die Nachholtiefe, bleibt liegen', async () => {
      const { bestelldetailsAuffrischen } = await import('./nachfuellen')
      await db.query(
        `UPDATE core.bestellung
            SET bestellt_am = now() - interval '13 months',
                detail_geholt_am = NULL`)
      expect(await bestelldetailsAuffrischen(aposto)).toBe(0)

      // Und die Sicht zeigt deshalb auch nichts mehr an — sie führt genau
      // den Bestand, den das Auffrischen bearbeitet.
      const { rows } = await db.query(
        `SELECT nicht_final, nie_aufgefrischt FROM mart.bestelldetail_stand`)
      expect(rows).toEqual([])
    })

    /**
     * Die Prüfzeile. Ohne sie sähe ein stiller Ausfall des Auffrischens
     * wieder genauso aus wie „nichts zu tun" — der Fehler, der diesem
     * Projekt zweimal Tage gekostet hat.
     */
    test('die Prüfzeile zeigt das Fenster, nicht den Altbestand', async () => {
      const { bestelldetailsAuffrischen } = await import('./nachfuellen')
      const { workerLauf } = await import('./worker')
      await db.query(
        `UPDATE core.bestellung
            SET bestellt_am = now() - interval '2 days', detail_geholt_am = NULL`)

      const zeile = async () => (await db.query(
        `SELECT geprueft, auffaellig FROM mart.pruefung_uebersicht
          WHERE pruefung = 'Bestellung: Details im Fenster aelter als 48 h'`)).rows[0]

      // Vorher: alle drei nicht-finalen sind überfällig — genau der Zustand,
      // in dem Produktion beim Anlegen dieser Zeile stand.
      const vorher = await zeile()
      expect(Number(vorher.geprueft)).toBe(3)
      expect(Number(vorher.auffaellig)).toBe(3)

      await bestelldetailsAuffrischen(aposto)
      await workerLauf('manuell')

      /**
       * Das Bestelldatum noch einmal setzen: der Abruf schreibt es aus der
       * Antwort zurück, und die Fixtures der Attrappe stammen aus 2021 —
       * die drei Bestellungen fielen sonst aus dem Fenster, und die Zeile
       * stünde aus dem falschen Grund auf 0. In Produktion passiert das
       * nicht: dort ist `bestellt_am` das, was FoodNotify sagt, und es
       * wandert nicht.
       */
      await db.query(`UPDATE core.bestellung SET bestellt_am = now() - interval '2 days'`)

      // Nachher: 0. Das ist die Erwartung nach jedem Nachtlauf.
      const nachher = await zeile()
      expect(Number(nachher.geprueft)).toBe(3)
      expect(Number(nachher.auffaellig)).toBe(0)
    })
  })

  /**
   * Der 403-Zweig hatte kein Ende (Migration 0075, Plan 3.3 und 3.5).
   *
   * `posten_holen()` zaehlt `versuche` hoch, der 403-Zweig zaehlt es wieder
   * herunter — netto ±0 pro Tag. Posten 28629 lag deshalb vom 02.08. bis
   * zum 14.08.2026 in der Schlange und stand immer noch auf `versuche = 0`,
   * waehrend er alle 60 Enchilada-Monatszeilen der Ladestandskarte auf
   * „unvollstaendig" faerbte.
   *
   * Geprueft wird der ganze Verlauf, weil jede Stufe fuer sich falsch sein
   * kann: ruhen, den Fakt festhalten, die Gegenprobe machen, schliessen —
   * und nicht wiederbeleben.
   */
  describe('403 auf einer fremden Ressource laeuft von selbst aus', () => {
    const posten = async () => (await db.query(
      `SELECT posten_id, ergebnis, erledigt_am, gesperrt_seit, versuche
         FROM sync.warteschlange
        WHERE endpunkt = 'fn:bestellungen' AND marke_key = $1
          AND parameter->>'erpId' = '10484'
        ORDER BY posten_id DESC LIMIT 1`, [aposto])).rows[0]

    test('erst ruhen, dann schliessen — und nur, wenn die Quelle sonst antwortet', async () => {
      const { workerLauf } = await import('./worker')

      /*
       * Ausgangslage: GENAU EINE offene Bestellseite, und die auf der
       * Kostenstelle, die gleich 403 sagt. Erledigte Posten wieder zu
       * oeffnen ginge nicht — der Eindeutigkeitsindex ist partiell und
       * kollidiert, sobald dieselbe Seite zweimal geholt wurde.
       */
      await db.query(
        `DELETE FROM sync.warteschlange
          WHERE endpunkt = 'fn:bestellungen' AND erledigt_am IS NULL`)
      await db.query(
        `INSERT INTO sync.warteschlange
           (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
         VALUES ('fn:bestellungen', current_date, current_date, 10, $1,
                 '{"erpId":"10484","seite":"7"}'::jsonb)`, [aposto])

      fnMock.verbieten(10484)
      try {
        await workerLauf('manuell')

        /**
         * Erste Stufe: der Posten ruht, der Fakt steht fest. Genau EIN
         * Posten ist betroffen — die andere Kostenstelle laeuft weiter.
         * Das ist der Befund vom 03.08.2026: 403 heisst „diese
         * Kostenstelle nicht", nicht „dieser Zugang nicht".
         */
        const ruht = await posten()
        expect(ruht.ergebnis).toBeNull()
        expect(ruht.erledigt_am).toBeNull()
        expect(ruht.gesperrt_seit).not.toBeNull()

        /**
         * Zweite Stufe, die Gegenprobe: der Posten ist alt genug, ABER die
         * Quelle antwortet nirgends mehr. Dann ist es das Konto und keine
         * Ressourcengrenze — und geschlossen wird nichts.
         */
        await db.query(
          `UPDATE sync.warteschlange
              SET gesperrt_seit = now() - interval '30 days', faellig_ab = now()
            WHERE posten_id = $1`, [ruht.posten_id])
        const merker = await db.query(
          `UPDATE sync.aufgabe SET status = 'fehler'
            WHERE endpunkt = 'fn:bestellungen' AND status = 'ok' RETURNING aufgabe_id`)
        await workerLauf('manuell')
        expect((await posten()).ergebnis).toBeNull()

        /**
         * Dritte Stufe: derselbe Posten, dieselbe Frist — aber die Quelle
         * antwortet wieder. Jetzt ist die Aussage belastbar, und der Posten
         * wird geschlossen. `kein_zugriff`, nicht `aufgegeben`.
         */
        await db.query(
          `UPDATE sync.aufgabe SET status = 'ok' WHERE aufgabe_id = ANY($1)`,
          [merker.rows.map(r => r.aufgabe_id)])
        await db.query(
          `UPDATE sync.warteschlange SET faellig_ab = now() WHERE posten_id = $1`,
          [ruht.posten_id])
        await workerLauf('manuell')

        const zu = await posten()
        expect(zu.ergebnis).toBe('kein_zugriff')
        expect(zu.erledigt_am).not.toBeNull()

        /**
         * Und er bleibt zu. `aufgegebeneWiederbeleben()` fasst nur
         * `aufgegeben` an — sonst holte der naechtliche Lauf ihn dreimal
         * zurueck, um dreimal dasselbe 403 zu bekommen.
         */
        const { aufgegebeneWiederbeleben } = await import('./nachfuellen')
        await aufgegebeneWiederbeleben()
        expect((await posten()).ergebnis).toBe('kein_zugriff')

        // Sichtbar, und mit der Frage, auf die es ankommt: gehoert uns das?
        const { rows: sicht } = await db.query(
          `SELECT erp_id, eigener_betrieb FROM mart.posten_ohne_zugriff`)
        expect(sicht).toHaveLength(1)
        expect(sicht[0].erp_id).toBe('10484')
      } finally {
        fnMock.freigeben(10484)
      }
    })
  })
})

/**
 * Takt und Tagesbudget gelten JE ANBIETER (seit 02.08.2026).
 *
 * LINA und FoodNotify sind zwei Firmen mit zwei Verträgen. Vorher zählten
 * beide Clients dieselbe Zahl — ALLE Zeilen aus `sync.aufgabe` — und der
 * Worker brach ab, sobald EINES der Budgets leer war. Ein FoodNotify-
 * Backfill mit 36.000 Posten hätte damit LINAs Tagesdaten an einer Grenze
 * scheitern lassen, die gar nicht für sie gilt.
 */
lauf('Getrennte Anbietergrenzen', () => {
  let db: Client
  let aposto: number

  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
    const { rows } = await db.query(`SELECT marke_key, schluessel FROM core.marke`)
    aposto = Number(rows.find(r => r.schluessel === 'aposto')!.marke_key)
  })
  afterAll(async () => { await db.end() })

  beforeEach(async () => {
    await db.query(`DELETE FROM sync.zugangssperre`)
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf RESTART IDENTITY CASCADE`)
  })

  test('das FoodNotify-Budget zählt NUR fn:-Aufrufe', async () => {
    /**
     * 50 erledigte LINA-Aufgaben von heute. Vorher hätten sie das
     * FoodNotify-Budget zu 50 belastet; jetzt lässt der Zähler sie außen vor.
     */
    const { rows: [l1] } = await db.query(
      `INSERT INTO sync.lauf (ausloeser) VALUES ('manuell') RETURNING lauf_id`)
    for (let i = 0; i < 50; i++) {
      await db.query(
        `INSERT INTO sync.aufgabe (lauf_id, endpunkt, status, beendet_am, zeilen)
         VALUES ($1, 'getUmsatzbericht', 'ok', now(), 1)`, [l1.lauf_id])
    }
    const { FnClient } = await import('../foodnotify/client')
    const { config } = await import('../config')
    const c = new FnClient()
    await c.budgetLaden()
    expect(c.budgetUebrig).toBe(config.TAGESBUDGET)
  })

  test('das LINA-Budget zählt NUR LINA-Aufrufe', async () => {
    const { rows: [l2] } = await db.query(
      `INSERT INTO sync.lauf (ausloeser) VALUES ('manuell') RETURNING lauf_id`)
    for (let i = 0; i < 50; i++) {
      await db.query(
        `INSERT INTO sync.aufgabe (lauf_id, endpunkt, status, beendet_am, zeilen, marke_key)
         VALUES ($1, 'fn:bestellungen', 'ok', now(), 1, $2)`, [l2.lauf_id, aposto])
    }
    const { LinaClient } = await import('../lina/client')
    const { config } = await import('../config')
    const c = new LinaClient()
    await c.budgetLaden()
    expect(c.budgetUebrig).toBe(config.TAGESBUDGET)
  })

  test('ein erschöpftes FoodNotify-Budget lässt LINAs Budget unberührt', async () => {
    /**
     * Die Trennung an ihrer schärfsten Stelle: das FoodNotify-Budget wird
     * VOLLSTÄNDIG aufgebraucht, und LINAs Zähler darf davon nichts
     * mitbekommen.
     *
     * Vorher lasen beide Clients dieselbe Abfrage über ALLE Zeilen in
     * `sync.aufgabe` — hier wäre auch LINA auf 0 gefallen, und der Worker
     * hätte den ganzen Lauf beendet. Genau das ist der Fall, den ein
     * FoodNotify-Backfill mit 36.000 Posten täglich ausgelöst hätte.
     *
     * Geprüft wird an den Clients statt am Worker: die Budgetgrenze ist
     * eine Eigenschaft des Zählers, und ein vollständiger Workerlauf
     * bräuchte beide Attrappen — die gehören anderen Suiten in dieser
     * Datei und werden dort gestartet und gestoppt.
     */
    const { config } = await import('../config')
    const { rows: [l] } = await db.query(
      `INSERT INTO sync.lauf (ausloeser) VALUES ('manuell') RETURNING lauf_id`)
    await db.query(
      `INSERT INTO sync.aufgabe (lauf_id, endpunkt, status, beendet_am, zeilen, marke_key)
       SELECT $1, 'fn:profil', 'ok', now(), 1, $2 FROM generate_series(1, $3)`,
      [l.lauf_id, aposto, config.TAGESBUDGET])

    const { FnClient } = await import('../foodnotify/client')
    const { LinaClient } = await import('../lina/client')
    const fn = new FnClient()
    const lina = new LinaClient()
    await fn.budgetLaden()
    await lina.budgetLaden()

    expect(fn.budgetUebrig).toBe(0)
    // Der Punkt, um den es geht.
    expect(lina.budgetUebrig).toBe(config.TAGESBUDGET)
  })
})

/**
 * Ladenakte: Belegarchiv, BWA-Historie und Stammdatenblatt durch die ganze
 * Kette — Warteschlange, Tokenaufloesung, Parser, core.
 *
 * Eigene Suite mit eigenem TRUNCATE-Umfang. Sie prueft nie `status = 'ok'`,
 * sondern immer die Zieltabelle: fast jeder Ausfall dieses Projekts hat „ok"
 * gemeldet und nichts geschrieben.
 */
lauf('e2e Ladenakte', () => {
  let mock: ReturnType<typeof mockStarten>
  let db: Client

  beforeAll(async () => {
    /**
     * Betrieb 99 hat keinen einzigen Belegordner — der Fall, den die
     * Ladenakte fuer zehn der 141 Betriebe kennt (drei geschlossene, sechs
     * ohne Geschaeft, einer Test). Er gehoert in die Attrappe und nicht in
     * einen von Hand gesetzten Datenbankzustand: nur so laeuft er durch die
     * ganze Kette bis in die Pruefsicht.
     */
    mock = mockStarten({ ohneBelegarchiv: ['99'] })
    process.env.LINA_BASE_URL = mock.url
    process.env.LINA_USER = 'testuser'
    process.env.LINA_PASSWORD = 'geheim'
    process.env.DATABASE_URL = DB!
    process.env.TAKT_MIN_MS = '0'
    process.env.TAKT_MAX_MS = '0'
    process.env.FENSTER_VON_STUNDE = '0'
    process.env.FENSTER_BIS_STUNDE = '24'
    process.env.LOG_LEVEL ??= 'error'
    const { config } = await import('../config')
    if (config.DATABASE_URL !== DB) {
      throw new Error(`Der Worker wuerde nach "${config.DATABASE_URL}" schreiben, geprueft `
        + `wird "${DB}". Diesen Test einzeln starten: bun test src/sync/e2e.test.ts`)
    }
    /**
     * `config` wird beim ERSTEN Import eingefroren — im Dateilauf ist das die
     * Attrappe der ersten Suite. Eine spaetere Suite, die ihre eigene startet,
     * bekommt einen anderen Port, waehrend der Client weiter auf den alten
     * zeigt: alle Aufrufe laufen ins Leere, und der Test meldet drei Fehler
     * statt eines Hinweises. Deshalb hier ausdruecklich nachziehen.
     */
    ;(config as { LINA_BASE_URL: string }).LINA_BASE_URL = mock.url
    db = new Client({ connectionString: DB! })
    await db.connect()
    await db.query(`TRUNCATE sync.warteschlange, sync.aufgabe, sync.lauf, raw.api_antwort,
                       core.buchungsbeleg, core.belegarchiv_bestand, core.bwa_position,
                       core.bwa_plan, core.betrieb_kapazitaet, core.tagesbudget,
                       core.betrieb RESTART IDENTITY CASCADE`)
    // Ein Betrieb mit numerischer LINA-ID — ohne die findet kein Posten sein Ziel.
    await db.query(
      `INSERT INTO core.betrieb (enc_id, name, lina_betrieb_id) VALUES ('enc-15','Enchilada Karlsruhe GmbH',15)`)

    /**
     * Die Belegarten selbst setzen, statt sich auf die Testdatenbank zu
     * verlassen: sie entsteht als Schema-Klon (`pg_dump --schema-only`), und
     * der bringt die Seed-Zeilen der Migration nicht mit. Ohne sie greift der
     * Fremdschluessel von core.belegarchiv_bestand.
     */
    const { FIBU_BELEGARTEN } = await import('../ladenakte/endpunkte')
    /**
     * `inhalt_holen` wird hier NICHT pauschal auf true gesetzt, sondern so
     * verteilt wie in Produktion: die acht am 11.08.2026 gezaehlten Belegarten
     * true, die sechs nie gezaehlten false. Nur so laesst sich der Zweig
     * pruefen, der "nichts zu tun" bedeutet — und genau der ist es, der
     * zweimal Tage gekostet hat.
     */
    const freigegeben = new Set(['1', '2', '3', '5', '3970', '3974', '3975', '3977'])
    for (const [i, b] of FIBU_BELEGARTEN.entries()) {
      await db.query(
        `INSERT INTO core.belegart (typ_id, name, zweig, hat_soll, reihenfolge, inhalt_holen)
         VALUES ($1,$2,'fibu',true,$3,$4) ON CONFLICT (typ_id) DO NOTHING`,
        [b.typId, b.name, i, freigegeben.has(b.typId)])
    }
  })

  afterAll(async () => { mock.stop(); await db.end() })

  test('holt Belege, BWA und Stammdaten und schreibt sie nach core', async () => {
    const { workerLauf } = await import('./worker')
    const { cacheLeeren } = await import('../ladenakte/token')
    cacheLeeren()

    await db.query(`
      INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, parameter) VALUES
        ('la:belegliste',   current_date, current_date, 95, '{"linaBetriebId":"15","typeId":"1"}'),
        ('la:bwa_longterm', current_date, current_date, 95, '{"linaBetriebId":"15"}'),
        ('la:stammdaten',   current_date, current_date, 95, '{"linaBetriebId":"15"}')`)

    const r = await workerLauf('manuell')
    expect(r.fehler).toBe(0)
    expect(r.ok).toBe(3)

    const zahl = async (sql: string) =>
      Number((await db.query(sql)).rows[0].n)

    // Belege: 61 echte Eingangsrechnungen der Schlager Cafe Beteiligungs AG.
    expect(await zahl(`SELECT count(*)::int AS n FROM core.buchungsbeleg`)).toBe(61)
    expect(await zahl(`SELECT records_total AS n FROM core.belegarchiv_bestand`)).toBe(61)

    /**
     * Die Felder, wegen derer das Ganze gebaut wurde — und zwar mit den
     * Luecken, die das Original hat: 27 der 61 Rechnungen tragen einen
     * Lieferanten, 20 ein Kreditorenkonto. Genau diese Mischung soll geprueft
     * werden. Ein Fixture, in dem alle Felder gefuellt waeren, pruefte die
     * Attrappe statt LINA.
     */
    expect(await zahl(
      `SELECT count(*)::int AS n FROM core.buchungsbeleg WHERE verkaeufer_name IS NOT NULL`)).toBe(27)
    expect(await zahl(
      `SELECT count(*)::int AS n FROM core.buchungsbeleg WHERE kreditor_konto IS NOT NULL`)).toBe(20)
    expect(await zahl(
      `SELECT count(*)::int AS n FROM core.buchungsbeleg WHERE datev_guid IS NOT NULL`)).toBe(58)

    // Der Wareneinsatz-Split an der Rechnung: Bar (1) und sonstiges (0).
    expect(await zahl(
      `SELECT count(DISTINCT zuordnung_fibu)::int AS n FROM core.buchungsbeleg`)).toBe(2)
    expect(await zahl(
      `SELECT count(*)::int AS n FROM core.buchungsbeleg WHERE zuordnung_fibu = 1`)).toBe(26)

    // Steueraufteilung lang: 78 Zeilen ueber die Saetze 0, 7 und 19.
    expect(await zahl(`SELECT count(*)::int AS n FROM core.buchungsbeleg_steuer`)).toBe(78)
    expect(await zahl(
      `SELECT count(DISTINCT satz)::int AS n FROM core.buchungsbeleg_steuer`)).toBe(3)

    /**
     * Leere Betraege sind NULL, nicht 0 — der Unterschied zwischen
     * "steht nicht drin" und "ist null Euro".
     */
    expect(await zahl(
      `SELECT count(*)::int AS n FROM core.buchungsbeleg WHERE netto IS NOT NULL AND netto <> 0`)).toBe(29)

    // BWA: 77 Zeilen x 20 Monate aus dem Fixture.
    expect(await zahl(`SELECT count(DISTINCT zeile_id)::int AS n FROM core.bwa_position`)).toBe(77)
    expect(await zahl(`SELECT count(DISTINCT monat)::int AS n FROM core.bwa_position`)).toBe(20)
    // Und tatsaechlich Betraege, nicht nur Zeilen.
    expect(await zahl(
      `SELECT count(*)::int AS n FROM core.bwa_position WHERE betrag IS NOT NULL AND betrag <> 0`))
      .toBe(847)

    // Stammdaten
    expect(await zahl(`SELECT count(*)::int AS n FROM core.betrieb_kapazitaet`)).toBe(5)
    expect(await zahl(
      `SELECT plaetze AS n FROM core.betrieb_kapazitaet WHERE ist_gesamt`)).toBe(632)
    expect(await zahl(`SELECT count(*)::int AS n FROM core.tagesbudget`)).toBe(365)
    expect(await zahl(`SELECT count(DISTINCT zeile_id)::int AS n FROM core.bwa_plan`)).toBe(77)

    // Plan und Ist finden ueber die Zeilennummer zusammen.
    expect(await zahl(
      `SELECT count(*)::int AS n FROM mart.bwa_plan_ist
        WHERE betrag_ist IS NOT NULL AND betrag_plan IS NOT NULL`)).toBeGreaterThan(0)
  })

  test('das Roh-HTML des Stammdatenblatts traegt keine API-Schluessel', async () => {
    const { rows } = await db.query(
      `SELECT payload_text FROM raw.api_antwort WHERE endpunkt = 'la:stammdaten'`)
    expect(rows.length).toBe(1)
    expect(rows[0].payload_text).not.toMatch(/API - Key/)
    expect(rows[0].payload_text).toMatch(/vor der Rohablage entfernt/)
    // Die Nutzdaten sind trotzdem noch da.
    expect(rows[0].payload_text).toMatch(/Tagesbudget|Stunden Service/)
  })

  test('HTML landet in payload_text, JSON in payload — nie beides', async () => {
    const { rows } = await db.query(
      `SELECT endpunkt, (payload IS NOT NULL) AS hat_json, (payload_text IS NOT NULL) AS hat_text
         FROM raw.api_antwort WHERE endpunkt LIKE 'la:%' ORDER BY endpunkt`)
    expect(rows).toEqual([
      { endpunkt: 'la:belegliste',   hat_json: true,  hat_text: false },
      { endpunkt: 'la:bwa_longterm', hat_json: false, hat_text: true },
      { endpunkt: 'la:stammdaten',   hat_json: false, hat_text: true },
    ])
  })

  test('der Token wird je Betrieb einmal geholt, nicht je Ordner', async () => {
    // Baum + Ordnerseite fuer die Belegliste, Baum fuer BWA, Baum fuer Stammdaten.
    expect(mock.zaehler['la_ordnerseite']).toBe(1)
    expect(mock.zaehler['la_baum']).toBe(3)
  })

  /**
   * Der Wiederholtakt der Momentaufnahmen.
   *
   * Am 12.08.2026 ist dieser Takt zweimal hintereinander falsch gewesen — erst
   * gar nicht (ein erledigter Posten sperrte fuer immer), dann zu oft (jeder
   * Posten mit 'keine_daten' kam in JEDER Nacht wieder). Beide Male haette ein
   * Test es gesehen, und beide Male gab es keinen. Deshalb wird hier nicht die
   * Implementierung geprueft, sondern der Takt selbst: einmal im Monat, egal wie
   * der Posten ausgegangen ist.
   */
  test('Momentaufnahmen kommen einmal im Monat — unabhaengig vom Ausgang', async () => {
    const { ladenakteNachfuellen } = await import('./nachfuellen')
    await db.query(`TRUNCATE sync.warteschlange RESTART IDENTITY`)

    const posten = async (ep: string) => Number((await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange WHERE endpunkt = $1`, [ep])).rows[0].n)

    await ladenakteNachfuellen('2026-08-12')
    expect(await posten('la:bwa_longterm')).toBe(1)
    expect(await posten('la:stammdaten')).toBe(1)

    // Derselbe Monat, drei weitere Naechte: nichts Neues, obwohl der Posten noch offen ist.
    for (const tag of ['2026-08-13', '2026-08-20', '2026-08-31']) await ladenakteNachfuellen(tag)
    expect(await posten('la:bwa_longterm')).toBe(1)

    /**
     * Jetzt der Ausgang, an dem die zweite Fassung gescheitert waere.
     * `keine_daten` ist bei LINA der dokumentierte Normalfall (HTTP 500 mit
     * leerem Rumpf), und eine Pruefung auf `status = 'ok'` haette ihn als
     * „diesen Monat noch nicht geholt" gelesen — jede Nacht neu.
     */
    await db.query(`UPDATE sync.warteschlange SET erledigt_am = now(), ergebnis = 'keine_daten'`)
    await ladenakteNachfuellen('2026-08-31')
    expect(await posten('la:bwa_longterm')).toBe(1)
    expect(await posten('la:stammdaten')).toBe(1)

    // Neuer Monat: eine frische Zeile je Endpunkt.
    await ladenakteNachfuellen('2026-09-01')
    expect(await posten('la:bwa_longterm')).toBe(2)
    expect(await posten('la:stammdaten')).toBe(2)
  })

  test('ein aufgegebener Posten sperrt den naechsten Monat nicht', async () => {
    const { ladenakteNachfuellen } = await import('./nachfuellen')
    await db.query(`TRUNCATE sync.warteschlange RESTART IDENTITY`)

    await ladenakteNachfuellen('2026-08-12')
    await db.query(`UPDATE sync.warteschlange SET erledigt_am = now(), ergebnis = 'aufgegeben'`)

    /**
     * Genau der Fall der drei Stammdatenblaetter, die an der Loeschsperre
     * gescheitert sind: vier Fehlversuche, dann 'aufgegeben'. Danach ist der
     * Pfadfehler behoben — es muss wieder einer gebaut werden, sonst fehlen die
     * drei Betriebe fuer immer, und der Lauf meldet dabei fehlerfrei.
     */
    await ladenakteNachfuellen('2026-09-01')
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange
        WHERE endpunkt = 'la:stammdaten' AND erledigt_am IS NULL`)
    expect(Number(rows[0].n)).toBe(1)
  })

  /**
   * Der erste Lauf hat seine Posten mit dem TAGESDATUM eingereiht, nicht mit dem
   * Monatsersten. Verglichen wird deshalb ueber `date_trunc('month', …)` — sonst
   * bekaeme im August jeder der 131 Betriebe eine zweite Zeile, und der naechste
   * Lauf holte 262-mal Daten, die schon da sind.
   */
  test('ein Posten mit Tagesdatum blockiert denselben Monat', async () => {
    const { ladenakteNachfuellen } = await import('./nachfuellen')
    await db.query(`TRUNCATE sync.warteschlange RESTART IDENTITY`)
    await db.query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, parameter)
       VALUES ('la:stammdaten','2026-08-11','2026-08-11',95,'{"linaBetriebId":"15"}')`)

    await ladenakteNachfuellen('2026-08-12')
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM sync.warteschlange WHERE endpunkt = 'la:stammdaten'`)
    expect(Number(rows[0].n)).toBe(1)
  })

  /**
   * ================================================================
   * DER ZULAUF DES BELEGARCHIVS — die Tests zum Befund vom 13.08.2026
   * ================================================================
   *
   * Was passiert war: `ladenakteNachfuellen()` reihte einen Ordner nur ein,
   * solange es fuer ihn keinen Bestandssatz mit records_total > 0 gab. Der
   * Abzug lief am 12.08.2026 um 13:25 fertig — danach lieferte die Bedingung
   * null Zeilen, und core.buchungsbeleg bekam zwei Tage lang keinen Beleg
   * mehr, bei einem Mittel von 331 am Tag. Die Laeufe 85 bis 88 meldeten
   * dabei 269 von 269 Aufgaben "ok".
   *
   * Kein Test haette das gesehen, weil keiner den ZWEITEN Tag geprueft hat.
   * Genau das tun die folgenden.
   */
  describe('Zulauf des Belegarchivs', () => {
    /**
     * Frischer Anfang je Test: sonst traegt der Bestand des vorigen weiter.
     * Die Attrappe wird mit zurueckgesetzt — ein Test, der Belege in LINA
     * loeschen laesst, darf den naechsten nicht mit einem halben Ordner erben.
     */
    const zuruecksetzen = async () => {
      for (const typ of ['1', '2', '3', '5', '3970', '3974', '3975', '3977']) {
        mock.belegeLoeschen(typ, 0)
      }
      await db.query(
        `TRUNCATE sync.warteschlange, core.belegarchiv_bestand, core.buchungsbeleg
         RESTART IDENTITY CASCADE`)
    }

    const zahl = async (sql: string, p: unknown[] = []) =>
      Number((await db.query(sql, p)).rows[0].n)

    test('die Zaehlung holt EINE Zeile und schreibt keinen einzigen Beleg', async () => {
      const { workerLauf } = await import('./worker')
      const { cacheLeeren } = await import('../ladenakte/token')
      await zuruecksetzen(); cacheLeeren()

      await db.query(
        `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, parameter)
         VALUES ('la:belegzahl', current_date, current_date, 95, '{"linaBetriebId":"15","typeId":"1"}')`)

      const r = await workerLauf('manuell')
      expect(r.fehler).toBe(0)

      /**
       * Der Kern: die Zaehlung SIEHT 61 Belege und SCHREIBT keinen. Wuerde
       * sie welche schreiben, waere sie ein zweiter, halber Abzug — und die
       * Vollstaendigkeitspruefung von la:belegliste (Zeilen == recordsTotal)
       * haette hier zu Recht geworfen.
       */
      expect(await zahl(
        `SELECT records_total AS n FROM core.belegarchiv_bestand WHERE quelle = 'zaehlung'`)).toBe(61)
      expect(await zahl(
        `SELECT seitengroesse AS n FROM core.belegarchiv_bestand WHERE quelle = 'zaehlung'`)).toBe(1)

      // Und der Abzug wurde nachgereiht, weil 61 <> 0 ist.
      expect(await zahl(
        `SELECT count(*)::int AS n FROM sync.warteschlange
          WHERE endpunkt = 'la:belegliste' AND parameter->>'typeId' = '1'`)).toBe(1)
      // Der Lauf hat ihn im selben Durchgang abgearbeitet (Prioritaet 93 < 95).
      expect(await zahl(`SELECT count(*)::int AS n FROM core.buchungsbeleg`)).toBe(61)
    })

    /**
     * DER EIGENTLICHE FEHLER: der ZWEITE Tag.
     *
     * Der Abzug ist durch, der Bestand stimmt — und trotzdem muss die
     * Zaehlung am naechsten Tag wieder laufen. Was sie NICHT tun darf, ist
     * den Ordner erneut ganz zu holen: 621 volle Abzuege waren im Erstabzug
     * acht Stunden.
     */
    test('am naechsten Tag wird wieder gezaehlt, aber nicht erneut abgezogen', async () => {
      const { ladenakteNachfuellen } = await import('./nachfuellen')
      const { workerLauf } = await import('./worker')
      const { cacheLeeren } = await import('../ladenakte/token')
      await zuruecksetzen(); cacheLeeren()

      // Tag 1: zaehlen, abziehen.
      await ladenakteNachfuellen('2026-08-13')
      // 14 Belegarten x 1 Betrieb — das Kreuzprodukt, nicht die Soll-Liste.
      expect(await zahl(
        `SELECT count(*)::int AS n FROM sync.warteschlange WHERE endpunkt = 'la:belegzahl'`)).toBe(14)
      await workerLauf('manuell')
      /**
       * 75 = 61 aus Ordner 1 plus je 2 aus den sieben uebrigen FREIGEGEBENEN
       * Ordnern. Die sechs nicht freigegebenen sind gezaehlt und nicht geholt
       * — genau diese Trennung macht die Zahl aussagekraeftig: waeren es 89,
       * haette die Freigabe nicht gegriffen.
       */
      expect(await zahl(`SELECT count(*)::int AS n FROM core.buchungsbeleg`)).toBe(75)
      expect(await zahl(
        `SELECT count(DISTINCT typ_id)::int AS n FROM core.buchungsbeleg`)).toBe(8)

      // Tag 2: frische Zaehlungen, KEIN zweiter Abzug — der Bestand stimmt.
      const abzuegeVorher = await zahl(
        `SELECT count(*)::int AS n FROM sync.warteschlange WHERE endpunkt = 'la:belegliste'`)
      await ladenakteNachfuellen('2026-08-14')
      expect(await zahl(
        `SELECT count(*)::int AS n FROM sync.warteschlange
          WHERE endpunkt = 'la:belegzahl' AND zeitraum_von = '2026-08-14'`)).toBe(14)
      await workerLauf('manuell')
      expect(await zahl(
        `SELECT count(*)::int AS n FROM sync.warteschlange WHERE endpunkt = 'la:belegliste'`))
        .toBe(abzuegeVorher)

      // Zweimal gezaehlt heisst zwei Messpunkte: die Zeitreihe ist der Beleg
      // dafuer, dass hier ueberhaupt jemand hingesehen hat.
      expect(await zahl(
        `SELECT count(*)::int AS n FROM core.belegarchiv_bestand
          WHERE quelle = 'zaehlung' AND typ_id = '1'`)).toBe(2)
    })

    /**
     * Der Fall, den ein blosses "ist er gewachsen?" durchliesse: unser
     * Bestand ist KLEINER geworden, LINAs Zahl steht still. So sieht ein
     * mittendrin abgebrochener Abzug aus.
     */
    test('fehlende Belege bei gleicher LINA-Zahl loesen einen Abzug aus', async () => {
      const { ladenakteNachfuellen } = await import('./nachfuellen')
      const { workerLauf } = await import('./worker')
      const { cacheLeeren } = await import('../ladenakte/token')
      await zuruecksetzen(); cacheLeeren()

      await ladenakteNachfuellen('2026-08-13')
      await workerLauf('manuell')
      expect(await zahl(`SELECT count(*)::int AS n FROM core.buchungsbeleg`)).toBe(75)

      // Ein halber Abzug: zehn Belege fehlen, LINA zaehlt weiter 61.
      await db.query(
        `DELETE FROM core.buchungsbeleg WHERE buchungsbeleg_key IN (
           SELECT buchungsbeleg_key FROM core.buchungsbeleg WHERE typ_id = '1' LIMIT 10)`)
      expect(await zahl(
        `SELECT count(*)::int AS n FROM core.buchungsbeleg WHERE typ_id = '1'`)).toBe(51)

      // Die Sicht benennt es, bevor irgendetwas nachlaeuft.
      const { rows: [vorher] } = await db.query(
        `SELECT zustand, differenz FROM mart.belegarchiv_zulauf
          WHERE typ_id = '1' AND lina_betrieb_id = 15`)
      expect(vorher).toMatchObject({ zustand: 'abzug fehlt', differenz: 10 })

      await ladenakteNachfuellen('2026-08-14')
      await workerLauf('manuell')
      expect(await zahl(
        `SELECT count(*)::int AS n FROM core.buchungsbeleg WHERE typ_id = '1'`)).toBe(61)
    })

    /**
     * Der Zweig, der "nichts zu tun" bedeutet — und der deshalb SICHTBAR sein
     * muss. Belegart 3969 (USt-Voranmeldungen) ist nicht freigegeben: gezaehlt
     * wird sie, geholt nicht. Ohne die Sicht saehe das genauso aus wie ein
     * leerer Ordner.
     */
    test('eine nicht freigegebene Belegart wird gezaehlt, aber nicht geholt', async () => {
      const { workerLauf } = await import('./worker')
      const { cacheLeeren } = await import('../ladenakte/token')
      await zuruecksetzen(); cacheLeeren()

      await db.query(
        `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, parameter)
         VALUES ('la:belegzahl', current_date, current_date, 95, '{"linaBetriebId":"15","typeId":"3969"}')`)
      const r = await workerLauf('manuell')
      expect(r.fehler).toBe(0)

      // Gezaehlt: ja. Abzug: nein. Belege: keine.
      expect(await zahl(
        `SELECT records_total AS n FROM core.belegarchiv_bestand WHERE typ_id = '3969'`)).toBe(2)
      expect(await zahl(
        `SELECT count(*)::int AS n FROM sync.warteschlange WHERE endpunkt = 'la:belegliste'`)).toBe(0)
      expect(await zahl(`SELECT count(*)::int AS n FROM core.buchungsbeleg`)).toBe(0)

      // Und genau so steht es in der Sicht — nicht nur in einem Log.
      const { rows } = await db.query(
        `SELECT zustand, differenz FROM mart.belegarchiv_zulauf
          WHERE typ_id = '3969' AND lina_betrieb_id = 15`)
      expect(rows[0]).toMatchObject({ zustand: 'gezaehlt, nicht freigegeben', differenz: 2 })
    })

    /**
     * Die Sicht ist die Sichtbarkeit. Wenn sie nicht zwischen "alles geholt"
     * und "noch nie hingesehen" unterscheiden kann, ist sie so nutzlos wie
     * der Lauf, der 269 von 269 ok meldet.
     */
    test('mart.belegarchiv_zulauf trennt vollstaendig von nie gezaehlt', async () => {
      const { workerLauf } = await import('./worker')
      const { cacheLeeren } = await import('../ladenakte/token')
      await zuruecksetzen(); cacheLeeren()

      // Vor dem ersten Lauf: alle 14 Ordner stehen auf "nie gezaehlt".
      expect(await zahl(
        `SELECT count(*)::int AS n FROM mart.belegarchiv_zulauf WHERE zustand = 'nie gezaehlt'`))
        .toBe(14)

      await db.query(
        `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, parameter)
         VALUES ('la:belegzahl', current_date, current_date, 95, '{"linaBetriebId":"15","typeId":"1"}')`)
      await workerLauf('manuell')

      const { rows } = await db.query(
        `SELECT zustand, gezaehlt, gehalten, differenz FROM mart.belegarchiv_zulauf
          WHERE typ_id = '1' AND lina_betrieb_id = 15`)
      expect(rows[0]).toMatchObject({
        zustand: 'vollstaendig', gezaehlt: 61, gehalten: 61, differenz: 0,
      })

      // Die uebrigen 13 sind weiterhin ungezaehlt — kein stiller Gruen-Anstrich.
      expect(await zahl(
        `SELECT count(*)::int AS n FROM mart.belegarchiv_zulauf WHERE zustand = 'nie gezaehlt'`))
        .toBe(13)
    })

    /**
     * ================================================================
     * SCHRUMPFENDE ORDNER — der Befund N2 vom 13.08.2026
     * ================================================================
     *
     * Die Abzugsbedingung aus 0069 prueft auf UNGLEICH und nicht auf
     * KLEINER, damit sie auch den abgebrochenen Abzug faengt. Nur konnte
     * der Abzug einen geschrumpften Ordner gar nicht reparieren:
     * belegeSchreiben() war ein reiner Upsert, in LINA geloeschte Belege
     * blieben bei uns stehen. Ab dem ersten geloeschten Beleg galt damit
     * dauerhaft gehalten > gezaehlt — und der Lauf holte den vollen
     * Ordner jede Nacht neu, bis zu 12.668 Belege, ohne dass sich je
     * etwas aenderte. Der Zustand pendelte zwischen "abzug eingereiht"
     * und "abzug fehlt", und Letzteres sagte dabei das Falsche: der Abzug
     * fehlte nicht, er war wirkungslos.
     *
     * Am 13.08.2026 in Produktion gemessen: unter 1.645 fertig gezaehlten
     * Paaren noch kein einziger Fall. Das ist eine Frage der Zeit und
     * kein Akutproblem — LINA loescht selten, aber es kommt vor.
     */
    test('ein in LINA geloeschter Beleg verschwindet auch bei uns — und der Ordner konvergiert', async () => {
      const { ladenakteNachfuellen } = await import('./nachfuellen')
      const { workerLauf } = await import('./worker')
      const { cacheLeeren } = await import('../ladenakte/token')
      await zuruecksetzen(); cacheLeeren()

      // Tag 1: voller Ordner.
      await ladenakteNachfuellen('2026-08-13')
      await workerLauf('manuell')
      expect(await zahl(
        `SELECT count(*)::int AS n FROM core.buchungsbeleg WHERE typ_id = '1'`)).toBe(61)
      const { rows: vorher } = await db.query(
        `SELECT lina_id FROM core.buchungsbeleg WHERE typ_id = '1'`)

      // In LINA verschwindet ein Beleg — Liste UND Zaehlung sagen jetzt 60.
      mock.belegeLoeschen('1', 1)

      // Tag 2: die Zaehlung erkennt die Abweichung und reiht den Abzug nach.
      await ladenakteNachfuellen('2026-08-14'); cacheLeeren()
      await workerLauf('manuell')

      /**
       * DER KERN: 60, nicht 61. Und zwar GEZIELT — genau eine lina_id ist
       * weg, der Rest steht unveraendert. Ein Abzug, der einfach alles neu
       * schreibt, saehe hier genauso aus; die Mengendifferenz zeigt, dass
       * geloescht und nicht nur neu geladen wurde.
       */
      expect(await zahl(
        `SELECT count(*)::int AS n FROM core.buchungsbeleg WHERE typ_id = '1'`)).toBe(60)
      const { rows: nachher } = await db.query(
        `SELECT lina_id FROM core.buchungsbeleg WHERE typ_id = '1'`)
      const uebrig = new Set(nachher.map(z => z.lina_id))
      const fehlend = vorher.map(z => z.lina_id).filter(id => !uebrig.has(id))
      expect(fehlend).toHaveLength(1)

      /**
       * Die Steuerzeilen haengen per ON DELETE CASCADE dran (0053). Geprueft
       * wird nicht die Zahl, sondern die Aussage: es bleibt nichts verwaist.
       */
      expect(await zahl(
        `SELECT count(*)::int AS n FROM core.buchungsbeleg_steuer s
           LEFT JOIN core.buchungsbeleg b USING (buchungsbeleg_key)
          WHERE b.buchungsbeleg_key IS NULL`)).toBe(0)

      // Der Ordner steht wieder auf gleich — das ist die Konvergenz.
      const { rows: [zulauf] } = await db.query(
        `SELECT zustand, gezaehlt, gehalten, differenz FROM mart.belegarchiv_zulauf
          WHERE typ_id = '1' AND lina_betrieb_id = 15`)
      expect(zulauf).toMatchObject({
        zustand: 'vollstaendig', gezaehlt: 60, gehalten: 60, differenz: 0,
      })

      /**
       * Tag 3 ist der eigentliche Beweis: KEIN weiterer Abzug. Ohne das
       * Loeschen stuende hier jede Nacht ein neuer, fuer immer.
       */
      const abzuegeVorher = await zahl(
        `SELECT count(*)::int AS n FROM sync.warteschlange WHERE endpunkt = 'la:belegliste'`)
      await ladenakteNachfuellen('2026-08-15'); cacheLeeren()
      await workerLauf('manuell')
      expect(await zahl(
        `SELECT count(*)::int AS n FROM sync.warteschlange WHERE endpunkt = 'la:belegliste'`))
        .toBe(abzuegeVorher)
    })

    /**
     * DIE GEGENPROBE — und der Grund, warum das Loeschen eine Schranke hat.
     *
     * Ein Ordner, aus dem in einer Nacht ein Fuenftel verschwindet, ist keine
     * Pflege mehr. Entweder raeumt LINA ihn ab, oder die Antwort war trotz
     * recordsTotal unvollstaendig — und im zweiten Fall waere unser Loeschen
     * der eigentliche Datenverlust. Dann lieber stehen lassen und werfen:
     * die Transaktion laeuft zurueck, der Posten landet nach seinen Versuchen
     * in mart.posten_aufgegeben, und ein Mensch entscheidet.
     */
    test('mehr als 5 % Schwund in einer Nacht wirft, statt zu loeschen', async () => {
      const { ladenakteNachfuellen } = await import('./nachfuellen')
      const { workerLauf } = await import('./worker')
      const { cacheLeeren } = await import('../ladenakte/token')
      await zuruecksetzen(); cacheLeeren()

      await ladenakteNachfuellen('2026-08-13')
      await workerLauf('manuell')
      expect(await zahl(
        `SELECT count(*)::int AS n FROM core.buchungsbeleg WHERE typ_id = '1'`)).toBe(61)

      // 12 von 61 sind 19,7 % — ueber beiden Schranken (5 % und 10 Stueck).
      mock.belegeLoeschen('1', 12)
      await ladenakteNachfuellen('2026-08-14'); cacheLeeren()
      const r = await workerLauf('manuell')

      // Der Abzug ist gescheitert, und er sagt auch, woran.
      expect(r.fehler).toBeGreaterThan(0)
      const { rows: [posten] } = await db.query(
        `SELECT letzter_fehler FROM sync.warteschlange
          WHERE endpunkt = 'la:belegliste' AND parameter->>'typeId' = '1'
          ORDER BY posten_id DESC LIMIT 1`)
      expect(String(posten.letzter_fehler)).toContain('nicht mehr in LINAs Liste')

      // NICHTS geloescht — die Transaktion ist zurueckgelaufen.
      expect(await zahl(
        `SELECT count(*)::int AS n FROM core.buchungsbeleg WHERE typ_id = '1'`)).toBe(61)

      // Und der Befund steht in der Sicht, nicht nur im Log: LINA zaehlt 49,
      // wir halten 61.
      const { rows: [zulauf] } = await db.query(
        `SELECT gezaehlt, gehalten, differenz FROM mart.belegarchiv_zulauf
          WHERE typ_id = '1' AND lina_betrieb_id = 15`)
      expect(zulauf).toMatchObject({ gezaehlt: 49, gehalten: 61, differenz: -12 })
    })

    /**
     * ================================================================
     * BETRIEBE OHNE BELEGARCHIV — der Befund N3 vom 13.08.2026
     * ================================================================
     *
     * Die Ladenakte kennt Betriebe, deren Baumknoten keinen einzigen Ordner
     * fuehrt. belegToken() wirft dafuer KeinBelegarchiv, der Client macht
     * daraus keine_daten — gefragt, nichts da, kein Retry. Richtig so.
     *
     * Nur bekommen sie damit NIE eine Zeile in core.belegarchiv_bestand,
     * standen also fuer immer auf "nie gezaehlt" und fuer immer in der Zeile
     * "seit ueber 36 h nicht gezaehlt". Eine Kachel, die nie auf null geht,
     * liest niemand mehr — und dann ist auch der echte Ausfall unsichtbar.
     * Das ist derselbe Verlust wie eine Kachel, die immer gruen ist, nur
     * langsamer.
     */
    test('ein Betrieb ohne Belegarchiv bekommt einen eigenen Zustand statt ewiger Roete', async () => {
      const { workerLauf } = await import('./worker')
      const { cacheLeeren } = await import('../ladenakte/token')
      await zuruecksetzen(); cacheLeeren()

      /**
       * Ein zweiter Betrieb, dessen Baumknoten leer antwortet — der Fall
       * geht durch die ganze Kette, nicht nur durch die Sicht: Attrappe →
       * belegToken → KeinBelegarchiv → keine_daten → sync.aufgabe → Sicht.
       */
      await db.query(
        `INSERT INTO core.betrieb (enc_id, name, lina_betrieb_id)
         VALUES ('enc-99','Aposto Testbetrieb ohne Ladenakte',99)
         ON CONFLICT (enc_id) DO NOTHING`)
      await db.query(
        `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, parameter)
         VALUES ('la:belegzahl', current_date, current_date, 95, '{"linaBetriebId":"99","typeId":"1"}')`)

      await workerLauf('manuell')

      // Kein Fehler, kein Retry — eine Antwort.
      const { rows: [aufgabe] } = await db.query(
        `SELECT status FROM sync.aufgabe
          WHERE endpunkt = 'la:belegzahl' AND parameter->>'linaBetriebId' = '99'
          ORDER BY aufgabe_id DESC LIMIT 1`)
      expect(aufgabe.status).toBe('keine_daten')

      // Die Sicht benennt ihn — und zwar anders als "nie gezaehlt".
      const { rows: [zulauf] } = await db.query(
        `SELECT zustand, zaehlung_status FROM mart.belegarchiv_zulauf
          WHERE lina_betrieb_id = 99 AND typ_id = '1'`)
      expect(zulauf).toMatchObject({ zustand: 'kein belegarchiv', zaehlung_status: 'keine_daten' })

      /**
       * DER PUNKT DER GANZEN UEBUNG: die 36-h-Zeile zaehlt ihn nicht mehr
       * mit, und die eigene Zeile fuehrt ihn dafuer sichtbar. Ein Zweig, der
       * "nichts zu tun" bedeutet, muss sichtbar sein (AGENTS.md Regel 10) —
       * er darf nur nicht in der Zahl stehen, die einen Ausfall meldet.
       */
      const zeile = async (name: string) => (await db.query(
        `SELECT geprueft, auffaellig FROM mart.pruefung_uebersicht WHERE pruefung = $1`,
        [name])).rows[0]
      const ohneArchiv = await zeile('Belegarchiv: Betrieb ohne Belegarchiv')
      expect(Number(ohneArchiv.auffaellig)).toBe(14)

      const gezaehlt36 = await zeile('Belegarchiv: seit ueber 36 h nicht gezaehlt')
      // Zwei Betriebe x 14 Ordner = 28, davon 14 ausgeklammert.
      expect(Number(gezaehlt36.geprueft)).toBe(14)
      expect(Number(gezaehlt36.auffaellig)).toBe(14)

      // Aufraeumen: der zweite Betrieb gehoert nicht in die folgenden Tests.
      await db.query(`DELETE FROM core.betrieb WHERE lina_betrieb_id = 99`)
    })
  })
})

/**
 * Der Wächter über den Zulauf (Migration `0076`, Plan Phase 4).
 *
 * DER KONSTRUKTIONSFEHLER, den er abfängt, hat dieses Projekt zweimal Tage
 * gekostet — und beide Male auf verschiedene Weise, weshalb die Sicht ZWEI
 * Zahlen führt und nicht eine:
 *
 *   02.08. / 12.08.2026   Es wurde nicht mehr GEFRAGT. Der Lauf meldete
 *                         269 von 269 Aufgaben „ok" und holte null Belege.
 *   10.08.2026            Es wurde gefragt, der Zeitstempel war frisch —
 *                         und `core.bewertung_thema` stand auf null Zeilen.
 *
 * Eine Zahl allein hätte beide Male beruhigt.
 */
lauf('Zulauf je Quelle', () => {
  let db: Client

  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
  })
  afterAll(async () => {
    await db.query(`DELETE FROM sync.quelle WHERE quelle LIKE 'test:%'`)
    await db.end()
  })

  /**
   * Eine vollständig kontrollierte Lage: vier Quellen, vier Zustände. Das
   * echte Register kommt aus `quellenSpiegeln()` und wird hier ausdrücklich
   * nicht verwendet — es hinge sonst am Zufall, was die Testdatenbank gerade
   * enthält, und der Test prüfte die Fixtures statt die Sicht.
   */
  async function lageAufbauen() {
    await db.query(`DELETE FROM sync.quelle`)
    await db.query(`DELETE FROM sync.aufgabe WHERE endpunkt LIKE 'test:%'`)
    await db.query(
      `INSERT INTO sync.quelle (quelle, bezeichnung, system, endpunkt, kadenz_stunden, erwartet, bemerkung)
       VALUES ('test:ok',    'Hat Zulauf',        'lina', 'test:ok',    36, true,  NULL),
              ('test:leer',  'Gefragt, nichts',   'lina', 'test:leer',  36, true,  NULL),
              ('test:stumm', 'Nicht mehr gefragt','lina', 'test:stumm', 36, true,  NULL),
              ('test:nie',   'Noch nie',          'lina', 'test:nie',   36, true,  NULL),
              ('test:egal',  'Bewusst still',     'lina', 'test:egal',  36, false, 'Demodaten')`)

    const { rows: [l] } = await db.query(
      `INSERT INTO sync.lauf (ausloeser, status) VALUES ('manuell','ok') RETURNING lauf_id`)

    const aufgabe = (endpunkt: string, vorStunden: number, zeilen: number) => db.query(
      `INSERT INTO sync.aufgabe (lauf_id, endpunkt, status, zeilen, beendet_am)
       VALUES ($1, $2, 'ok', $3, now() - ($4 || ' hours')::interval)`,
      [l.lauf_id, endpunkt, zeilen, vorStunden])

    // Frisch gefragt, frischer Zulauf.
    await aufgabe('test:ok', 1, 42)
    // Frisch gefragt — und null Zeilen. Der Yext-Fall vom 10.08.2026.
    await aufgabe('test:leer', 1, 0)
    await aufgabe('test:leer', 100, 42)
    // Zuletzt vor Tagen gefragt. Der Belegarchiv-Fall vom 12.08.2026.
    await aufgabe('test:stumm', 100, 42)
    // test:nie und test:egal bekommen gar keine Aufgabe.
    return String(l.lauf_id)
  }

  test('trennt "liefert nichts" von "wird nicht mehr gefragt"', async () => {
    await lageAufbauen()
    const { rows } = await db.query(
      `SELECT quelle, zustand, wird_noch_gefragt FROM mart.quelle_zulauf ORDER BY quelle`)
    const nach = Object.fromEntries(rows.map(r => [r.quelle, r]))

    expect(nach['test:ok'].zustand).toBe('ok')

    /**
     * DER KERN. Beide sind „stumm", und die Unterscheidung ist der ganze
     * Unterschied zwischen einem Befund und einem Baufehler:
     *   test:leer   wird noch gefragt — die Quelle liefert nichts.
     *   test:stumm  wird nicht mehr gefragt — WIR fragen nicht mehr.
     */
    expect(nach['test:leer'].zustand).toBe('stumm')
    expect(nach['test:leer'].wird_noch_gefragt).toBe(true)
    expect(nach['test:stumm'].zustand).toBe('stumm')
    expect(nach['test:stumm'].wird_noch_gefragt).toBe(false)

    // Noch nie eine Zeile — sieht aus wie ein frisch aufgesetztes System.
    expect(nach['test:nie'].zustand).toBe('nie')

    /**
     * Und was bewusst still ist, ist kein Alarm. Ohne diesen Zustand stünde
     * die Prüfzeile dauerhaft rot, und eine Zeile, die nie auf null geht,
     * liest niemand mehr — dieselbe Überlegung wie in 0070, 0071 und 0073.
     */
    expect(nach['test:egal'].zustand).toBe('nicht erwartet')
  })

  test('der Lauf meldet nicht mehr "ok", wenn eine Quelle stumm ist', async () => {
    const laufId = await lageAufbauen()
    const { zulaufPruefen } = await import('./zulauf')

    const stumm = await zulaufPruefen(laufId)
    // test:leer, test:stumm und test:nie — test:egal zaehlt nicht mit.
    expect(stumm).toBe(3)

    const { rows: [l] } = await db.query(
      `SELECT status, notiz FROM sync.lauf WHERE lauf_id = $1`, [laufId])
    expect(l.status).toBe('teilweise')
    expect(l.notiz).toContain('test:stumm')
    // Die schaerfere Teilmenge wird eigens genannt.
    expect(l.notiz).toContain('nicht mehr abgefragt')
  })

  test('ein bereits gescheiterter Lauf behaelt seinen Grund', async () => {
    const laufId = await lageAufbauen()
    await db.query(
      `UPDATE sync.lauf SET status = 'abgebrochen', notiz = 'Zugang gesperrt'
        WHERE lauf_id = $1`, [laufId])
    const { zulaufPruefen } = await import('./zulauf')
    await zulaufPruefen(laufId)

    const { rows: [l] } = await db.query(
      `SELECT status, notiz FROM sync.lauf WHERE lauf_id = $1`, [laufId])
    // Die erste Ursache ist die wichtigere und darf nicht ueberschrieben
    // werden — ein abgebrochener Lauf hat naturgemaess keinen Zulauf.
    expect(l.status).toBe('abgebrochen')
    expect(l.notiz).toContain('Zugang gesperrt')
    expect(l.notiz).toContain('ohne Zulauf')
  })

  test('alles in Ordnung heisst 0 und laesst den Lauf in Ruhe', async () => {
    const laufId = await lageAufbauen()
    await db.query(`DELETE FROM sync.quelle WHERE quelle <> 'test:ok'`)
    const { zulaufPruefen } = await import('./zulauf')
    expect(await zulaufPruefen(laufId)).toBe(0)
    const { rows: [l] } = await db.query(
      `SELECT status, notiz FROM sync.lauf WHERE lauf_id = $1`, [laufId])
    expect(l.status).toBe('ok')
    expect(l.notiz).toBeNull()
  })

  /**
   * Und der Abgleich mit dem Code-Register: `quellenSpiegeln()` ist der
   * einzige Schreiber, und er raeumt auch auf. Eine Quelle, die im Code
   * verschwindet, stuende sonst fuer immer als „stumm" in der Sicht.
   */
  test('quellenSpiegeln setzt das Register auf den Stand des Codes', async () => {
    await lageAufbauen()
    const { quellenSpiegeln, QUELLEN } = await import('./quellen')
    expect(await quellenSpiegeln()).toBe(QUELLEN.length)

    const { rows: [r] } = await db.query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE quelle LIKE 'test:%')::int AS reste
         FROM sync.quelle`)
    expect(r.n).toBe(QUELLEN.length)
    expect(r.reste).toBe(0)

    // Zweimal spiegeln legt nichts doppelt an und aendert nichts.
    expect(await quellenSpiegeln()).toBe(QUELLEN.length)
    const { rows: [n2] } = await db.query(`SELECT count(*)::int AS n FROM sync.quelle`)
    expect(n2.n).toBe(QUELLEN.length)
  })
})
