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
