/**
 * Ausfuehrung von Ende zu Ende — gegen eine echte Datenbank, als `mcp_leser`.
 *
 * WARUM DAS NICHT MIT DEM IMPORTER-ZUGANG GEPRUEFT WERDEN DARF. Die Haelfte
 * dessen, was hier geprueft wird, IST die Rolle: dass `core` gesperrt ist,
 * dass nur `mcp.zugriff` beschrieben werden kann, dass das Protokoll trotz
 * `default_transaction_read_only` durchkommt. Als Eigentuemer der Datenbank
 * wuerde jeder dieser Tests gruen und nichts davon bewiesen.
 *
 *   MCP_DATABASE_URL=postgresql://mcp_leser:...@host/lina bun test
 *
 * Ohne die Variable uebersprungen, wie die uebrigen Datenbanktests.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { parserBereitstellen } from '../src/ast'
import { abfrageAusfuehren, Abfragefehler, Gesperrt, probeplanen } from '../src/ausfuehren'
import { abfragen, pool } from '../src/db'
import { defekteSichten, gesundheitPruefen, standSetzen, unklareSichten } from '../src/gesundheit'
import { katalogLaden } from '../src/katalog_laden'
import type { Katalog } from '../src/katalog'

const DB = process.env.MCP_DATABASE_URL
const lauf = DB ? describe : describe.skip

let katalog: Katalog
const nutzer = { subject: 'test|1', anzeige: 'Testlauf', client: 'bun-test' }

lauf('Ausfuehrung', () => {
  beforeAll(async () => {
    await parserBereitstellen()
    katalog = await katalogLaden()
  })
  // Den Pool NICHT schliessen: mehrere Testdateien teilen sich denselben,
  // und wer ihn zuerst zumacht, laesst die anderen ins Leere laufen. Der
  // Prozess raeumt ihn am Ende ohnehin ab.
  afterAll(async () => {
    await pool.query(`DELETE FROM mcp.zugriff WHERE subject = 'test|1'`).catch(() => {})
  })

  test('eine richtige Abfrage laeuft und wird protokolliert', async () => {
    const e = await abfrageAusfuehren(
      `SELECT count(*)::int AS n FROM mart.betrieb`, katalog, nutzer)
    expect(e.zeilen).toHaveLength(1)
    expect(e.spalten).toEqual(['n'])
    expect(e.protokoll_id).toBeGreaterThan(0)

    const [zeile] = await abfragen(
      `SELECT werkzeug, gesperrt, zeilen FROM mcp.zugriff WHERE zugriff_id = $1`,
      [e.protokoll_id])
    expect(zeile.werkzeug).toBe('abfrage_ausfuehren')
    expect(zeile.gesperrt).toBe(false)
    expect(zeile.zeilen).toBe(1)
  })

  /**
   * Die gesperrte Abfrage ist der interessantere Protokolleintrag: sie sagt,
   * welche Falle wie oft zuschnappt, und das ist die Anforderungsliste fuer
   * die naechsten mart-Sichten.
   */
  test('eine gesperrte Abfrage laeuft NICHT, steht aber im Protokoll', async () => {
    const vorher = await abfragen<{ n: number }>(
      `SELECT count(*)::int AS n FROM mcp.zugriff WHERE gesperrt AND subject = 'test|1'`)

    await expect(abfrageAusfuehren(
      `SELECT stadt, count(*) FROM mart.betrieb GROUP BY stadt`, katalog, nutzer))
      .rejects.toBeInstanceOf(Gesperrt)

    const nachher = await abfragen<{ n: number }>(
      `SELECT count(*)::int AS n FROM mcp.zugriff WHERE gesperrt AND subject = 'test|1'`)
    expect(nachher[0]!.n).toBe(vorher[0]!.n + 1)
  })

  test('die Rolle kommt nicht an core — unabhaengig vom Pruefer', async () => {
    // Der Pruefer sperrt das schon, aber DIESER Test geht an ihm vorbei und
    // fragt die Datenbank direkt. Genau darum geht es: die Rechte sind die
    // Sperre, der Pruefer ist die lesbare Meldung davor.
    await expect(abfragen(`SELECT 1 FROM core.betrieb LIMIT 1`)).rejects.toThrow(/permission denied/i)
  })

  /**
   * BEFUND 20.09.2026, eine halbe Stunde nach dem Deploy von 0107.
   *
   * Eine SICHT greift auf ihre Tabellen mit den Rechten ihres EIGENTUEMERS
   * zu, ein FUNKTIONSRUMPF mit denen des AUFRUFERS -- auch aus einer Sicht
   * heraus. 0107 hatte die Konzeptaufloesung in ampel.hauptkonzept() gelegt,
   * und damit waren drei mart-Sichten fuer diese Rolle unlesbar, waehrend
   * Metabase sie anstandslos zeigte.
   *
   * WARUM DIE PROBE VORHER GRUEN WAR: `SELECT count(*) FROM <sicht>` wertet
   * die Spaltenausdruecke der Sicht gar nicht aus -- die Funktion wurde nie
   * gerufen. Deshalb hier `SELECT *` mit LIMIT und nicht count(*).
   */
  test('die Auswertungssichten sind fuer die Leserolle wirklich lesbar', async () => {
    for (const sicht of ['mart.ampel_schwelle', 'mart.ampel_bereich',
                         'mart.round_table_unvollstaendig', 'mart.quelle_zulauf']) {
      await abfragen(`SELECT * FROM ${sicht} LIMIT 1`)
    }
  })

  /**
   * BEFUND 21.09.2026, die Fortsetzung desselben Fehlers eine Schicht tiefer.
   *
   * Jede Abfrage auf eine Wettersicht oder den Vergleichstag antwortete
   * "current transaction is aborted". Die Ursache: mart.wetter_tag ruft
   * core.geschaeftstag(), deren Rumpf core.geschaefts_zeitzone() nennt — und
   * schon dieser NAME braucht USAGE auf dem gesperrten Schema core. Elf
   * Sichten lagen, darunter die Pruefliste selbst und die Wache aus 0109.
   * Behoben in Migration 0110.
   *
   * WARUM DIESE LISTE NAMENTLICH UND NICHT NUR ALS REGEL: die Regel unten
   * findet die Ursache, diese Liste findet den Rueckfall. Beides, weil die
   * Regel eine Textsuche ist und die keine Vollstaendigkeit beweist.
   */
  // 30 s statt der 5 s von bun, und der Grund ist gemessen: gegen einen Klon
  // mit vollen Daten und KALTEM Cache brauchen diese dreizehn Sichten zusammen
  // mehr als fuenf Sekunden — mart.wettertag_lage allein las 657.334
  // Stundenwerte von der Platte. Warm sind es Millisekunden. Ein Test, der am
  // Kaltstart scheitert, wird abgeschaltet statt gelesen.
  test('die Wettersichten und der Vergleichstag sind lesbar', async () => {
    for (const sicht of ['mart.wetter_tag', 'mart.betrieb_wetter_tag', 'mart.vergleichstag',
                         'mart.wetter_effekt', 'mart.wetter_effekt_gruppe', 'mart.wettertag_lage',
                         'mart.import_gesamt', 'mart.pruefung_kalender',
                         'mart.pruefung_uebersicht', 'ampel.schwelle_je_betrieb',
                         'mart.leserolle_pruefung', 'mart.sicht_defekt',
                         'mart.sicht_ohne_leserecht', 'mart.sicht_unklar']) {
      await abfragen(`SELECT * FROM ${sicht} LIMIT 1`)
    }
  }, 30_000)

  /** Und derselbe Befund als Regel statt als Liste: mart.leserolle_pruefung
   *  findet jede Funktion, die den Schutz ihrer Sicht aufhebt — seit 0110 in
   *  JEDEM Schema und nicht nur in ampel/mart. */
  test('kein Funktionsrumpf hebt den Schutz seiner Sicht auf', async () => {
    const offen = await abfragen<{ funktion: string; greift_auf: string; sichten: string }>(
      `SELECT funktion, greift_auf, sichten FROM mart.leserolle_pruefung`)
    expect(offen).toEqual([])
  })

  /** Die zweite Luecke vom 21.09.2026: eine Sicht, auf die die Leserolle gar
   *  kein SELECT hat. Zwei gab es, angelegt von 0105 und 0109. */
  test('jede Sicht der Auswertungsschicht ist fuer die Leserolle lesbar', async () => {
    const ohne = await abfragen<{ sicht: string; eigentuemer: string }>(
      `SELECT sicht, eigentuemer FROM mart.sicht_ohne_leserecht`)
    expect(ohne).toEqual([])
  })

  test('schreiben geht nur ins Protokoll, sonst nirgends', async () => {
    await expect(abfragen(`DELETE FROM manual.massnahme WHERE false`))
      .rejects.toThrow(/permission denied|read-only/i)
  })

  /**
   * REVIEW 13.09.2026. Vorher: set_config in einer Abfrage, und die naechste
   * Abfrage auf derselben Pool-Verbindung lief ohne Zeitgrenze. Der Pruefer
   * sperrt set_config jetzt — aber dieser Test umgeht den Pruefer bewusst
   * und fragt die Datenbank direkt: haelt der ZWEITE Riegel, die
   * Transaktion mit ROLLBACK, auch allein?
   */
  test('eine Sitzungseinstellung ueberlebt die Abfrage nicht', async () => {
    const c = await pool.connect()
    try {
      await c.query('BEGIN READ ONLY')
      await c.query(`SET LOCAL statement_timeout = '20s'`)
      await c.query(`SELECT set_config('statement_timeout', '0', false)`)
      await c.query('ROLLBACK')
      const [{ statement_timeout }] = (await c.query('SHOW statement_timeout')).rows
      expect(statement_timeout).toBe('20s')   // die Rolleneinstellung, nicht 0
    } finally { c.release() }
  })

  test('pg_sleep und SELECT INTO kommen nicht bis zur Datenbank', async () => {
    await expect(abfrageAusfuehren(`SELECT pg_sleep(30)`, katalog, nutzer)).rejects.toBeInstanceOf(Gesperrt)
    await expect(abfrageAusfuehren(`SELECT * INTO x FROM mart.betrieb`, katalog, nutzer)).rejects.toBeInstanceOf(Gesperrt)
  })

  test('die Abfrage laeuft READ ONLY — auch ohne den Pruefer', async () => {
    const c = await pool.connect()
    try {
      await c.query('BEGIN READ ONLY')
      await expect(c.query(`CREATE TEMP TABLE t AS SELECT 1`)).rejects.toThrow(/read-only/i)
      await c.query('ROLLBACK')
    } finally { c.release() }
  })

  /**
   * DER FEHLER, DER JEDEN ANDEREN FEHLER VERDECKT HAT — Befund 21.09.2026.
   *
   * `zeilenSchaetzen` setzt ein EXPLAIN vor jede Abfrage. Scheitert das, ist in
   * Postgres die ganze TRANSAKTION abgebrochen, nicht nur das Statement; das
   * leere catch liess sie so zurueck, die eigentliche Abfrage lief hinein und
   * bekam 25P02 — "current transaction is aborted". Damit sah JEDER Fehler
   * gleich aus: der Tippfehler wie die defekte Sicht.
   *
   * Zwei Dinge muessen also gelten, und beide stehen hier:
   *   1. die Meldung ist die ECHTE (42703 und der Spaltenname), nicht 25P02
   *   2. die naechste Abfrage laeuft — ohne einen Aufruf, der nur aufraeumt
   */
  test('ein SQL-Fehler nennt die Ursache und nicht die Folgemeldung', async () => {
    const fehler = await abfrageAusfuehren(
      `SELECT gibtsnicht FROM mart.betrieb`, katalog, nutzer)
      .then(() => null, (e: unknown) => e)

    expect(fehler).toBeInstanceOf(Abfragefehler)
    const f = fehler as Abfragefehler
    expect(f.sqlstate).toBe('42703')                       // undefined_column
    expect(f.message).toContain('gibtsnicht')
    // Die Folgemeldung darf gar nicht mehr vorkommen.
    expect(f.sqlstate).not.toBe('25P02')
    expect(f.message).not.toContain('current transaction is aborted')
  })

  test('nach einem SQL-Fehler laeuft die naechste Abfrage sofort', async () => {
    await expect(abfrageAusfuehren(`SELECT * FROM mart.betrieb WHERE gibtsnicht = 1`,
      katalog, nutzer)).rejects.toBeInstanceOf(Abfragefehler)

    // KEIN Aufruf dazwischen, der die Verbindung wieder gerade biegt: genau
    // das musste der Nutzer am 21.09.2026 tun, und es kostete ihn je Fehler
    // zwei Aufrufe.
    const e = await abfrageAusfuehren(`SELECT count(*)::int AS n FROM mart.betrieb`,
      katalog, nutzer)
    expect(e.zeilen).toHaveLength(1)
  })

  /** Und dasselbe fuer den Fall, der den Befund ausgeloest hat: eine Abfrage,
   *  die an einer Sicht scheitert, gefolgt von einer gueltigen. */
  test('mehrere Fehler hintereinander vergiften die Verbindung nicht', async () => {
    for (const sql of [`SELECT quatsch FROM mart.betrieb`,
                       `SELECT * FROM mart.gibtsnicht LIMIT 1`,
                       `SELECT 1/0 AS x FROM mart.betrieb LIMIT 1`]) {
      await expect(abfrageAusfuehren(sql, katalog, nutzer)).rejects.toBeInstanceOf(Abfragefehler)
    }
    const e = await abfrageAusfuehren(`SELECT count(*)::int AS n FROM mart.betrieb`,
      katalog, nutzer)
    expect(e.zeilen_gesamt).toBe(1)
  })

  /** Der Fehler steht im Protokoll — mit SQLSTATE, damit hinterher jemand
   *  sagen kann, WARUM eine Zahl fehlt (vorher stand dort nur 25P02). */
  test('der echte Fehler landet in mcp.zugriff', async () => {
    await abfrageAusfuehren(`SELECT auchnicht FROM mart.betrieb`, katalog, nutzer).catch(() => {})
    const [zeile] = await abfragen<{ fehler: string }>(
      `SELECT fehler FROM mcp.zugriff
        WHERE subject = 'test|1' AND fehler IS NOT NULL
        ORDER BY zugriff_id DESC LIMIT 1`)
    expect(zeile.fehler).toContain('42703')
    expect(zeile.fehler).toContain('auchnicht')
  })

  /**
   * DIE PRUEFUNG FRAGT JETZT AUCH POSTGRES. Vorher war sie rein
   * katalogbasiert und meldete "Laeuft" fuer SQL, das nicht laufen kann.
   * EXPLAIN ohne ANALYZE fuehrt nichts aus — es plant, und beim Planen faellt
   * genau das auf.
   */
  test('probeplanen erkennt eine Abfrage, die nicht laufen kann', async () => {
    const schlecht = await probeplanen(`SELECT gibtsnicht FROM mart.betrieb`)
    expect(schlecht.laeuft).toBe(false)
    expect(schlecht.sqlstate).toBe('42703')
    expect(schlecht.meldung).toContain('gibtsnicht')

    const gut = await probeplanen(`SELECT count(*) FROM mart.betrieb`)
    expect(gut.laeuft).toBe(true)
    expect(gut.geschaetzte_zeilen).toBeGreaterThan(0)
  })

  /**
   * DER DEPLOY-FALL VOM 21.09.2026 ABENDS, nachgestellt. Der erste
   * Gesundheitslauf lief vor der Migration, hielt acht Sichten als defekt im
   * Speicher, und nach der Migration sperrte der Pruefer eine Stunde lang
   * gesunde Sichten — auf einem Messwert, den mart.sicht_defekt laengst nicht
   * mehr deckte. Hier: ein erfundener Defekt an einer gesunden Sicht, frisch
   * datiert. Die Abfrage muss trotzdem laufen, und der Eintrag muss danach
   * weg sein — die Nachprobe hat ihn widerlegt.
   */
  test('ein veralteter Defekt im Speicher sperrt nicht — die Nachprobe widerlegt ihn', async () => {
    const erfunden = { sqlstate: '42501', meldung: 'Postgres SQLSTATE 42501: permission denied (erfunden)', geprueft_am: new Date() }
    standSetzen([['mart.betrieb', erfunden], ['mart.umsatz_tag', erfunden]], new Date())

    const e = await abfrageAusfuehren(`SELECT count(*)::int AS n FROM mart.betrieb`, katalog, nutzer)
    expect(e.zeilen).toHaveLength(1)
    expect(e.hinweise.find(h => h.schluessel.startsWith('sicht_defekt'))).toBeUndefined()
    expect(defekteSichten().has('mart.betrieb')).toBe(false)
    // Was die Abfrage nicht beruehrt, wird auch nicht probiert: der zweite
    // Eintrag bleibt, bis ihn jemand braucht oder der naechste Lauf kommt.
    expect(defekteSichten().has('mart.umsatz_tag')).toBe(true)

    standSetzen([], null)
  })

  /** Und die Warnung ohne Urteil verschwindet genauso, sobald die Sicht antwortet. */
  test('eine veraltete Warnung ohne Urteil verschwindet nach der Nachprobe', async () => {
    standSetzen([], new Date(), [['mart.betrieb', {
      sqlstate: '57014', meldung: 'Postgres SQLSTATE 57014: statement timeout (erfunden)', geprueft_am: new Date() }]])
    const e = await abfrageAusfuehren(`SELECT count(*)::int AS n FROM mart.betrieb`, katalog, nutzer)
    expect(e.hinweise.find(h => h.schluessel.startsWith('sicht_unklar'))).toBeUndefined()
    expect(unklareSichten().has('mart.betrieb')).toBe(false)
    standSetzen([], null)
  })

  /**
   * DER GESUNDHEITSLAUF, gegen die echte Schicht und mit der echten Rolle.
   * Als Eigentuemer getestet laeuft alles (0109) — deshalb ist dieser Test
   * nur dann etwas wert, wenn MCP_DATABASE_URL auf mcp_leser zeigt.
   */
  // 90 s: 236 Relationen, warm 1,3 s, kalt gemessen 24,3 s — und das Budget des
  // Laufs selbst liegt bei 120 s. Der Test soll am Budget scheitern, wenn etwas
  // klemmt, nicht an bun.
  test('der Gesundheitslauf probiert jede Sicht aus und findet keine defekte', async () => {
    const e = await gesundheitPruefen()
    expect(e.geprueft).toBeGreaterThan(100)
    expect(e.abgelegt).toBe(true)
    if (e.defekt > 0) {
      const defekt = [...defekteSichten().entries()]
        .map(([s, d]) => `${s}: ${d.sqlstate} ${d.meldung.split('\n')[0]}`)
      throw new Error(`${e.defekt} Sichten laufen nicht:\n${defekt.join('\n')}`)
    }
    // Die Momentaufnahme liegt in der Datenbank, nicht nur im Speicher —
    // sonst sieht sie niemand im Dashboard.
    const [stand] = await abfragen<{ n: number; am: string; unklar: number }>(
      `SELECT count(*)::int AS n, max(geprueft_am)::text AS am,
              (SELECT count(*)::int FROM mart.sicht_unklar) AS unklar
         FROM mcp.sicht_gesundheit`)
    expect(stand.n).toBe(e.geprueft)
    expect(stand.am).not.toBeNull()
    // Was ohne Urteil blieb, steht in der Sicht — und stimmt mit dem Lauf ueberein.
    expect(stand.unklar).toBe(e.ohne_urteil)
  }, 90_000)

  test('der Befund-Anhang traegt Koernung und Datenstand', async () => {
    const e = await abfrageAusfuehren(`
      SELECT betrieb_key, sum(umsatz_netto) AS umsatz
        FROM mart.umsatz_tag
       WHERE geschaeftstag >= '2026-01-01'
       GROUP BY betrieb_key`, katalog, nutzer)
    expect(e.koernung.find(k => k.sicht === 'mart.umsatz_tag')?.koernung)
      .toContain('Betrieb und Geschaeftstag')
    // Leere Datenbank: kein Datenstand. Mit Daten muss er da sein.
    if (e.zeilen.length > 0) expect(e.datenstand).not.toBeNull()
  })

  /**
   * 0121: Am 24.09.2026 sagte der Hinweis fuer 92 "vollstaendig bis 09/2026",
   * geladen war bis zum 16.09. Ein Tagesbericht nennt jetzt den Tag, und jeder
   * Satz den Stand der Materialisierung — sie wird nur in Phase B und nach
   * Phase C aufgefrischt und kann einen halben Tag alt sein.
   */
  test('eine Kassen-Antwort traegt den Ladestand — auf den Tag und mit Stand', async () => {
    const e = await abfrageAusfuehren(`
      SELECT monat, sum(menge) AS menge
        FROM mart.artikel_nachlass_monat
       WHERE monat >= '2026-01-01'
       GROUP BY monat`, katalog, nutzer)
    const h = e.hinweise.find(x => x.schluessel === 'ladestand_getReport_92')
    expect(h).toBeDefined()
    expect(h!.hinweis).toMatch(/^Bericht 92/)
    expect(h!.hinweis).toMatch(
      /vollstaendig vom \d\d\.\d\d\.\d{4} bis \d\d\.\d\d\.\d{4}|kein Tag lueckenlos geladen|fuer keinen Monat geladen/)
    expect(h!.hinweis).not.toMatch(/vollstaendig bis \d\d\/\d{4}/)
    expect(h!.hinweis).toMatch(/Stand: \d\d\.\d\d\.\d{4} \d\d:\d\d Uhr/)
  })
})
