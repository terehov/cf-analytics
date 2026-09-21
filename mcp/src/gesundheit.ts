/**
 * Der Gesundheitslauf: jede Sicht der Auswertungsschicht wirklich ausprobieren.
 *
 * WARUM DAS NOETIG IST. Am 21.09.2026 hat `abfrage_pruefen` fuer SQL auf
 * mart.vergleichstag und mart.betrieb_wetter_tag "Laeuft, mit 1 Hinweis(en)"
 * gemeldet — und beide Sichten waren fuer die Leserolle unlesbar. Die
 * Pruefung liest den KATALOG: Koernung, Achsen, Fallstricke. Der Katalog
 * weiss nicht, ob eine Sicht laeuft.
 *
 * WARUM ES NICHT IN DER DATENBANK STEHEN KANN. Eine Sicht kann sich nicht
 * selbst ausprobieren, und wer es als Eigentuemer probiert, beweist nichts:
 * genau das war der Grund, warum 0107 drei Sichten kaputt ausgeliefert hat
 * (Migration 0109). Die Probe muss als `mcp_leser` laufen — und diese Rolle
 * traegt genau ein Prozess: dieser.
 *
 * WARUM `SELECT * ... LIMIT 1` UND NICHT `count(*)`. `count(*)` wertet die
 * Spaltenausdruecke der Sicht nicht aus und ruft die Funktionen darin nie.
 * Deshalb war die Probe in 0107 gruen, obwohl nichts lief. Und nicht bloss
 * `EXPLAIN`: das plant und faengt damit Rechte- und Strukturfehler, laesst
 * aber jeden Fehler durch, der erst beim Lesen entsteht.
 *
 * WAS DIESE PROBE TROTZDEM NICHT SIEHT — nachgemessen am 21.09.2026, und es
 * ist der Grund, warum sie neben den zwei Katalogwachen steht und nicht
 * anstelle von ihnen.
 *
 * Ein Fehler faellt entweder beim PLANEN oder beim LESEN auf, und das haengt
 * daran, ob Postgres die Funktion in die Abfrage einsetzt. Eine SQL-Funktion
 * mit einer SET-Klausel (proconfig) wird NICHT eingesetzt — dann laeuft ihr
 * Rumpf erst, wenn eine Zeile ihn braucht. Die Messung, dieselbe kaputte
 * Funktion in zwei Zustaenden:
 *
 *   SECURITY INVOKER, kein search_path  -> 8 Sichten defekt (Fehler beim Planen)
 *   SECURITY INVOKER, mit search_path   -> 6 Sichten defekt (Fehler beim Lesen)
 *
 * Die zwei, die verschwinden, sind mart.pruefung_kalender und
 * mart.pruefung_uebersicht: UNION-ALL-Ketten, bei denen `LIMIT 1` nach dem
 * ersten Zweig aufhoert — der Zweig mit dem Fehler wird nie gelesen. Sie
 * WAEREN kaputt, sobald jemand die ganze Liste abfragt.
 *
 * Eine leere mart.sicht_defekt heisst also: "was diese Probe erreicht, laeuft".
 * Nicht: "jede Zeile jeder Sicht laeuft".
 *
 * WAS DER LAUF KOSTET, nachgemessen am 21.09.2026 gegen einen Klon mit 236
 * Relationen in mart/manual/ampel: 855 ms fuer alle, keine einzelne ueber
 * 300 ms. Zum Vergleich EXPLAIN allein: 196 ms. Einmal je Stunde ist das
 * nichts — und die Zeitgrenze je Sicht sorgt dafuer, dass es das auch bleibt,
 * wenn eine Sicht auf Produktionsdaten laenger braucht.
 *
 * EIN LAUF, DER NICHT MEHR LAEUFT, MUSS AUFFALLEN (harte Regel 10). Deshalb
 * traegt jede Zeile ihren Zeitstempel, und mart.pruefung_uebersicht hat eine
 * Zeile, die anschlaegt, wenn die juengste Momentaufnahme aelter als 24
 * Stunden ist. Ohne die saehe ein stehengebliebener Lauf aus wie eine
 * gesunde Schicht: mart.sicht_defekt ist dann naemlich leer.
 */
import type pg from 'pg'
import { pool } from './db'
import { istSichtDefekt, pgFehlerText, sqlstateVon } from './pg_fehler'
import type { Sichtlage } from './pruefen'

/** Wie lange eine einzelne Probe hoechstens laufen darf. */
export const PROBE_ZEITGRENZE = '5s'

/**
 * Wie lange der ganze Lauf hoechstens dauern darf.
 *
 * ZWEI GRENZEN UND NICHT EINE, weil die erste sich am 21.09.2026 einmal nicht
 * an ihr Wort gehalten hat: der erste Lauf gegen einen frisch gefuellten Klon
 * brauchte 24,3 s, davon 23,5 s allein fuer mart.wettertag_lage — obwohl
 * `SET LOCAL statement_timeout = '5s'` gesetzt war und in der Gegenprobe
 * nachweislich greift (dieselbe Sicht mit 100 ms Grenze: nach 103 ms
 * abgebrochen, SQLSTATE 57014; pg_sleep(5) mit 2 s Grenze: nach 2.009 ms).
 * Warm gelaufen sind es 1,3 s fuer alle 236 Sichten, kalt also das
 * Achtzehnfache. Woran der eine Lauf vorbeikam, ist NICHT geklaert — deshalb
 * steht hier eine zweite Grenze, die nicht in Postgres haengt, sondern in
 * dieser Schleife.
 *
 * 120 s bei 1,3 s im Normalfall: reichlich Luft fuer einen kalten Lauf nach
 * dem Deploy und weit von einer Minute Stillstand entfernt.
 */
export const LAUF_BUDGET_MS = 120_000

/** Wie oft der Lauf wiederholt wird. */
export const TAKT_MS = 60 * 60 * 1000

/** Wie bald nach einem Lauf, dessen Ablegen scheiterte, der naechste kommt. */
export const WIEDERHOLUNG_MS = 5 * 60 * 1000

/**
 * Wie alt eine Momentaufnahme sein darf, damit auf ihr Grund eine Abfrage
 * ABGEWIESEN wird. Danach bleibt der Befund, wird aber nur noch eine Warnung:
 * eine reparierte Sicht darf nicht an einem alten Messwert haengen bleiben.
 */
export const VERTRAUENSFRIST_MS = 6 * 60 * 60 * 1000

export type Befundzeile = {
  sicht: string
  laeuft: boolean
  sqlstate: string | null
  meldung: string | null
  dauer_ms: number
}

export type Defekt = { sqlstate: string | null; meldung: string; geprueft_am: Date }

/**
 * Der Stand im Speicher. Der Pruefer fragt ihn bei jeder Abfrage, und ein
 * Umlauf zur Datenbank je Pruefung waere ein Umlauf fuer etwas, das sich
 * hoechstens stuendlich aendert — dieselbe Begruendung wie beim Katalog.
 */
let stand: Map<string, Defekt> = new Map()
/**
 * Proben OHNE Urteil — Zeitueberlauf oder ein Fehler, der nicht von Postgres
 * kam. Getrennt von `stand`, weil sie etwas anderes bedeuten: nicht "kaputt",
 * sondern "nicht bewiesen". Vor dem 21.09.2026 (abends) zaehlten sie still als
 * gesund; jetzt sind sie eine Warnung fuer das Modell und eine Zeile in
 * mart.sicht_unklar.
 */
let unklar: Map<string, Defekt> = new Map()
let gemessenAm: Date | null = null

/** Die defekten Sichten, wie sie zuletzt gemessen wurden. */
export function defekteSichten(): ReadonlyMap<string, Defekt> {
  return stand
}

/** Die Sichten, deren Probe zuletzt ohne Urteil blieb. */
export function unklareSichten(): ReadonlyMap<string, Defekt> {
  return unklar
}

/** Wann zuletzt gemessen wurde — null heisst: noch nie, oder Tabelle leer. */
export function gesundheitGemessenAm(): Date | null {
  return gemessenAm
}

/** Ist die Momentaufnahme frisch genug, um darauf eine Abfrage abzuweisen? */
export function standIstFrisch(jetzt = Date.now()): boolean {
  return gemessenAm !== null && jetzt - gemessenAm.getTime() < VERTRAUENSFRIST_MS
}

/** Nur fuer Tests: den Stand von Hand setzen. */
export function standSetzen(zeilen: Iterable<[string, Defekt]>, am: Date | null,
                            ohneUrteil: Iterable<[string, Defekt]> = []): void {
  stand = new Map(zeilen)
  unklar = new Map(ohneUrteil)
  gemessenAm = am
}

/** Was der Pruefer von diesem Lauf braucht — in seiner Form (pruefen.ts). */
export function sichtlage(): Sichtlage {
  return { defekt: stand, unklar, frisch: standIstFrisch() }
}

/** Aus den Befundzeilen eines Laufs die zwei Karten bauen. */
function einteilen(zeilen: Befundzeile[], am: Date): void {
  const als = (z: Befundzeile): [string, Defekt] =>
    [z.sicht, { sqlstate: z.sqlstate, meldung: z.meldung ?? '', geprueft_am: am }]
  stand  = new Map(zeilen.filter(z => !z.laeuft).map(als))
  // laeuft, aber mit Meldung: die Probe hatte kein Urteil.
  unklar = new Map(zeilen.filter(z => z.laeuft && z.meldung !== null).map(als))
  gemessenAm = am
}

/**
 * Welche Relationen geprueft werden.
 *
 * AUS pg_catalog UND NICHT AUS DEM KATALOG. `mcp.sicht_katalog` fuehrt 199
 * mart-Sichten; die Rolle kommt aber auch an `manual` und `ampel`, und der
 * Pruefer laesst beide zu. Wer nur den Katalog probiert, laesst genau die
 * Sichten aus, die niemand im Blick hat — ampel.schwelle_je_betrieb war am
 * 21.09.2026 eine davon.
 *
 * Nur, was die Rolle ueberhaupt lesen darf: was ihr verwehrt ist, ist kein
 * Defekt der Sicht, sondern ein fehlendes Recht — und das findet
 * mart.sicht_ohne_leserecht mit einer Zeile statt mit 236 Abfragen.
 */
const SICHTEN_SQL = `
  SELECT n.nspname || '.' || c.relname AS sicht
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('mart', 'manual', 'ampel')
     AND c.relkind IN ('r', 'v', 'm', 'p')
     AND pg_catalog.has_table_privilege(c.oid, 'SELECT')
   ORDER BY 1`

/**
 * Einmal alles durchprobieren und melden.
 *
 * EINE TRANSAKTION MIT SAVEPOINTS, nicht 236 Transaktionen: der Savepoint
 * ist genau das Werkzeug, das ein gescheitertes Statement zurueckrollt, ohne
 * die Transaktion zu verlieren. Ohne ihn waere nach der ersten defekten
 * Sicht jede weitere "current transaction is aborted" — derselbe Fehler, der
 * diesen Lauf ueberhaupt noetig gemacht hat.
 *
 * READ ONLY und SET LOCAL, damit auch dieser Weg die Grenzen traegt, die
 * jede Abfrage traegt. Die Meldung wird danach in einer EIGENEN, schreibenden
 * Transaktion abgelegt.
 */
export async function gesundheitPruefen(): Promise<{
  geprueft: number; defekt: number; ohne_urteil: number; dauer_ms: number
  /** Ist die Momentaufnahme in der Datenbank angekommen? Nein heisst: mart.sicht_defekt ist veraltet. */
  abgelegt: boolean
}> {
  const start = Date.now()
  const zeilen: Befundzeile[] = []
  const c = await pool.connect()
  try {
    await c.query('BEGIN READ ONLY')
    await c.query(`SET LOCAL statement_timeout = '${PROBE_ZEITGRENZE}'`)
    const sichten = (await c.query<{ sicht: string }>(SICHTEN_SQL)).rows

    for (const { sicht } of sichten) {
      /**
       * Das Budget VOR der naechsten Probe pruefen, nicht nach ihr. Was
       * uebrig bleibt, wird nicht gemeldet und verschwindet damit aus
       * mcp.sicht_gesundheit — sichtbar daran, dass `geprueft` faellt, und
       * darum wird es auch laut geloggt. Lieber eine erkennbar
       * unvollstaendige Momentaufnahme als ein Lauf, der nicht endet.
       */
      if (Date.now() - start > LAUF_BUDGET_MS) {
        console.error(JSON.stringify({ t: new Date().toISOString(), stufe: 'error',
          msg: 'Gesundheitslauf abgebrochen — Budget erschoepft, Rest nicht geprueft',
          budget_ms: LAUF_BUDGET_MS, geprueft: zeilen.length, offen: sichten.length - zeilen.length,
          zuletzt: sicht }))
        break
      }
      zeilen.push(await probieren(c, sicht))
    }
    await c.query('ROLLBACK')
  } finally {
    c.release()
  }

  const abgelegt = await melden(zeilen)
  einteilen(zeilen, new Date())

  const defekt = stand.size
  const dauer_ms = Date.now() - start
  console.log(JSON.stringify({ t: new Date().toISOString(),
    stufe: defekt ? 'warn' : unklar.size ? 'warn' : 'info',
    msg: 'Gesundheitslauf', geprueft: zeilen.length, defekt, ohne_urteil: unklar.size, dauer_ms,
    sichten: [...stand.keys()].slice(0, 20), unklar: [...unklar.keys()].slice(0, 20) }))
  return { geprueft: zeilen.length, defekt, ohne_urteil: unklar.size, dauer_ms, abgelegt }
}

/**
 * EINE Sicht probieren — innerhalb einer laufenden Transaktion, hinter einem
 * Savepoint. Der Savepoint ist der Grund, warum ein Fehler hier nicht die
 * naechste Probe mitreisst (siehe gesundheitPruefen).
 */
async function probieren(c: pg.PoolClient, sicht: string): Promise<Befundzeile> {
  const t = Date.now()
  await c.query('SAVEPOINT probe')
  try {
    await c.query(`SELECT * FROM ${sicht} LIMIT 1`)
    await c.query('RELEASE SAVEPOINT probe')
    return { sicht, laeuft: true, sqlstate: null, meldung: null, dauer_ms: Date.now() - t }
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT probe')
    await c.query('RELEASE SAVEPOINT probe')
    return {
      sicht,
      laeuft: !istSichtDefekt(e),
      sqlstate: sqlstateVon(e),
      meldung: pgFehlerText(e),
      dauer_ms: Date.now() - t,
    }
  }
}

/**
 * Verdaechtige Sichten JETZT nachprobieren — bevor der Pruefer auf einen
 * Messwert hin sperrt.
 *
 * DER FALL, DER DAS NOETIG GEMACHT HAT, 21.09.2026 abends, erster Deploy
 * dieses Laufs: Dokploy startet den MCP-Server und den Importer aus demselben
 * Push, und die Migration laeuft im Importer. Der erste Gesundheitslauf kam
 * VOR 0110 — acht Sichten defekt, mcp.gesundheit_melden() gab es noch nicht,
 * das Ablegen scheiterte, der Stand blieb im Speicher. Dann lief die
 * Migration, die Sichten waren gesund, und der Pruefer sperrte trotzdem: bis
 * zum naechsten Stundenlauf, auf einem Messwert von vor der Migration. In
 * Claude stand "mart.vergleichstag ist DEFEKT", waehrend mart.sicht_defekt
 * leer war.
 *
 * Ein Messwert ist also ein Anlass zu pruefen, kein Urteil. Sperren darf
 * nur, was JETZT nicht laeuft. Der Preis ist eine Probe je verdaechtiger
 * Sicht — und die faellt nur an, wenn ueberhaupt ein Verdacht besteht, also
 * praktisch nie.
 *
 * NUR SICHTEN, DIE SCHON IM STAND STEHEN. Die Namen kommen aus dem
 * Syntaxbaum der Nutzerabfrage; in ein `SELECT * FROM ${name}` darf davon
 * nichts, was nicht vorher aus pg_catalog kam. Der Filter ueber `stand`
 * und `unklar` stellt genau das sicher.
 *
 * Nur der Speicher wird berichtigt, nicht die Tabelle: mcp.gesundheit_melden
 * ersetzt den ganzen Satz, und einen halben zu schreiben waere die Luege
 * von der anderen Seite. mart.sicht_defekt hinkt damit hoechstens einen
 * Stundenlauf hinterher — der Pruefer nicht.
 */
export async function nachpruefen(sichten: readonly string[]): Promise<void> {
  const verdaechtig = sichten.filter(s => stand.has(s) || unklar.has(s))
  if (!verdaechtig.length) return

  const c = await pool.connect()
  try {
    await c.query('BEGIN READ ONLY')
    await c.query(`SET LOCAL statement_timeout = '${PROBE_ZEITGRENZE}'`)
    for (const sicht of verdaechtig) {
      const z = await probieren(c, sicht)
      const eintrag: Defekt = { sqlstate: z.sqlstate, meldung: z.meldung ?? '', geprueft_am: new Date() }
      stand.delete(sicht)
      unklar.delete(sicht)
      if (!z.laeuft) stand.set(sicht, eintrag)
      else if (z.meldung !== null) unklar.set(sicht, eintrag)
    }
    await c.query('ROLLBACK')
  } catch (e) {
    // Die Nachprobe selbst scheitert (Verbindung weg): dann bleibt der alte
    // Stand — lieber einmal zu viel gesperrt als eine Sperre, die verschwindet,
    // weil die Pruefung nicht stattfand.
    await c.query('ROLLBACK').catch(() => {})
    console.error(JSON.stringify({ t: new Date().toISOString(), stufe: 'error',
      msg: 'Nachprobe gescheitert — alter Stand bleibt', sichten: verdaechtig,
      fehler: String((e as Error)?.message ?? e).slice(0, 300) }))
  } finally {
    c.release()
  }
  console.log(JSON.stringify({ t: new Date().toISOString(), stufe: 'info',
    msg: 'Nachprobe', sichten: verdaechtig,
    noch_defekt: verdaechtig.filter(s => stand.has(s)),
    noch_unklar: verdaechtig.filter(s => unklar.has(s)) }))
}

/**
 * Die Momentaufnahme ablegen.
 *
 * READ WRITE ausdruecklich angefordert, wie beim Protokoll in mcp.zugriff und
 * aus demselben Grund: die Rolle traegt default_transaction_read_only, und
 * `mcp.gesundheit_melden` ist SECURITY DEFINER — das gibt ihr die RECHTE des
 * Eigentuemers, aber read-only ist eine Eigenschaft der Transaktion und kein
 * Recht.
 *
 * Scheitert das Ablegen, scheitert der Lauf NICHT: der Stand im Speicher ist
 * gesetzt, und der Server arbeitet damit weiter. Geloggt wird es laut — eine
 * Momentaufnahme, die nicht in der Datenbank landet, fehlt in
 * mart.sicht_defekt und damit im Dashboard. Und der Lauf wird frueher
 * wiederholt (gesundheitBeobachten): beim ersten Deploy am 21.09.2026 gab
 * es die Funktion schlicht noch nicht, weil die Migration im anderen
 * Container eine Minute spaeter kam.
 */
async function melden(zeilen: Befundzeile[]): Promise<boolean> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query('SET TRANSACTION READ WRITE')
    await c.query('SELECT mcp.gesundheit_melden($1::jsonb)', [JSON.stringify(zeilen)])
    await c.query('COMMIT')
    return true
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error(JSON.stringify({ t: new Date().toISOString(), stufe: 'error',
      msg: 'Gesundheitslauf konnte nicht abgelegt werden — mart.sicht_defekt ist veraltet',
      fehler: String((e as Error)?.message ?? e).slice(0, 300) }))
    return false
  } finally {
    c.release()
  }
}

/**
 * Den letzten Stand aus der Datenbank holen.
 *
 * Beim Start, damit der erste Nutzer nicht auf den ersten Lauf warten muss:
 * ein Neustart ist nach jedem Deploy faellig, und die Schicht aendert sich
 * mit Migrationen, nicht mit Neustarts. Die Zeilen koennen also von einem
 * fruehen Lauf stammen — deshalb traegt der Stand seinen Zeitstempel, und
 * der Pruefer sieht darauf.
 */
export async function standLaden(): Promise<void> {
  try {
    // Eine Abfrage statt drei: dieselbe Einteilung wie nach einem Lauf, aus
    // der abgelegten Momentaufnahme.
    const r = await pool.query<Befundzeile & { geprueft_am: Date }>(
      `SELECT sicht, laeuft, sqlstate, meldung, dauer_ms, geprueft_am FROM mcp.sicht_gesundheit`)
    const am = r.rows.reduce<Date | null>((m, z) =>
      m === null || z.geprueft_am > m ? new Date(z.geprueft_am) : m, null)
    if (am === null) { stand = new Map(); unklar = new Map(); gemessenAm = null; return }
    einteilen(r.rows, am)
  } catch (e) {
    // Vor Migration 0110 gibt es die Tabelle nicht. Kein Grund, den Server
    // nicht zu starten: dann gibt es eben keinen Befund `sicht_defekt`.
    console.warn(JSON.stringify({ t: new Date().toISOString(), stufe: 'warn',
      msg: 'Gesundheitsstand nicht lesbar — laeuft Migration 0110 schon?',
      fehler: String((e as Error)?.message ?? e).slice(0, 200) }))
  }
}

/**
 * Den Lauf im Hintergrund halten.
 *
 * NICHT IM START BLOCKIEREN: der Server soll lauschen, bevor er 236 Sichten
 * durchprobiert hat. Der erste Lauf startet deshalb nach kurzer Wartezeit,
 * und `unref()` haelt den Prozess nicht am Leben, wenn er sonst fertig waere
 * (sonst endet kein Test mehr).
 */
export function gesundheitBeobachten(takt = TAKT_MS, wiederholung = WIEDERHOLUNG_MS): () => void {
  let laeuft = false
  let nachholen: ReturnType<typeof setTimeout> | null = null
  const einmal = async () => {
    if (laeuft) return      // ein langsamer Lauf darf sich nicht selbst ueberholen
    laeuft = true
    let abgelegt = true
    try { abgelegt = (await gesundheitPruefen()).abgelegt } catch (e) {
      abgelegt = false
      console.error(JSON.stringify({ t: new Date().toISOString(), stufe: 'error',
        msg: 'Gesundheitslauf gescheitert', fehler: String((e as Error)?.message ?? e).slice(0, 300) }))
    } finally { laeuft = false }
    /**
     * Nicht abgelegt oder gescheitert: in fuenf Minuten noch einmal, nicht
     * erst in einer Stunde. Der haeufigste Grund ist ein Deploy, bei dem
     * die Migration noch nicht durch ist — und dann ist der Stand im
     * Speicher gleich doppelt falsch: er stammt von vor der Migration und
     * steht in keiner Tabelle. Hoechstens eine Wiederholung auf einmal.
     */
    if (!abgelegt && nachholen === null) {
      nachholen = setTimeout(() => { nachholen = null; void einmal() }, wiederholung)
      nachholen.unref?.()
    }
  }

  const ersterLauf = setTimeout(einmal, 10_000)
  const takten = setInterval(einmal, takt)
  ersterLauf.unref?.()
  takten.unref?.()
  return () => {
    clearTimeout(ersterLauf); clearInterval(takten)
    if (nachholen) clearTimeout(nachholen)
  }
}
