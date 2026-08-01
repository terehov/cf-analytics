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
import { expect, test, describe, beforeAll, afterAll } from 'bun:test'
import { Client } from 'pg'
import { mockStarten } from '../lina/mock'

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
    const { rows } = await db.query(`SELECT * FROM mart.pruefung_uebersicht`)
    expect(rows).toHaveLength(3)
    await db.query(`SELECT * FROM mart.pruefung_wareneinsatz LIMIT 1`)
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
    await db.query(`TRUNCATE core.artikel_warengruppe_stand, core.warengruppe, core.feinsparte,
                       core.einkaufspreis_stand, core.ware_stand, core.ware,
                       core.bestellposten, core.bestellung, core.lieferant, core.einheit,
                       core.inventurtermin RESTART IDENTITY CASCADE`)
    // Ein Artikel, damit articleApi etwas zum Verknuepfen hat.
    await db.query(`INSERT INTO core.artikel (artikelnummer, name) VALUES (300213, 'Artikel A')
                    ON CONFLICT (artikelnummer) DO NOTHING`)
    await db.query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet) VALUES
         ('analyticsFilterOptions',  $1,$1, 10),
         ('wawi:units',              $1,$1, 10),
         ('wawi:suppliers',          $1,$1, 10),
         ('wawi:items',              $1,$1, 10),
         ('wawi:orders',             $1,$1, 10),
         ('wawi:inventory',          $1,$1, 10),
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

  test('Einkaufspreise je Ware und Lieferant, mit Umrechnung auf die Basiseinheit', async () => {
    const { rows: [{ n }] } = await db.query(
      `SELECT count(*)::int AS n FROM core.einkaufspreis_stand WHERE monat = $1`, [MONAT])
    expect(n).toBeGreaterThan(0)
    // Ware 1 hat zwei Lieferantenpreise -- deshalb eine eigene Tabelle.
    const { rows: [{ n: mehrfach }] } = await db.query(`
      SELECT count(*)::int AS n FROM (
        SELECT ware_key FROM core.einkaufspreis_stand GROUP BY 1 HAVING count(*) > 1) x`)
    expect(mehrfach).toBeGreaterThan(0)
  })

  test('Inventurtermine sind je Tag eindeutig', async () => {
    const { rows: [{ n, tage }] } = await db.query(
      `SELECT count(*)::int AS n, count(DISTINCT datum)::int AS tage FROM core.inventurtermin`)
    expect(n).toBe(tage)
  })

  test('die neuen Mart-Sichten sind abfragbar', async () => {
    await db.query(`SELECT * FROM mart.preisentwicklung_ware LIMIT 1`)
    await db.query(`SELECT * FROM mart.deckungsbeitrag_warengruppe LIMIT 1`)
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
    const { rows: [p] } = await db.query(
      `SELECT ergebnis, erledigt_am, in_arbeit_seit, versuche, letzter_fehler
         FROM sync.warteschlange ORDER BY posten_id LIMIT 1`)
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

    const vorher = process.env.METABASE_DB_URL
    try {
      // Adresse, an der garantiert nichts antwortet.
      process.env.METABASE_DB_URL = 'postgresql://postgres@127.0.0.1:9/nirgendwo'

      const r = await auswahllistenAbgleichen()
      expect(r.status).toBe('fehler')
      expect(r.geaendert).toBe(0)

      // Und der Nachlauf, wie sync.ts ihn aufruft: protokolliert, wirft nicht.
      await auswahllistenNachlauf()
    } finally {
      if (vorher === undefined) delete process.env.METABASE_DB_URL
      else process.env.METABASE_DB_URL = vorher
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
