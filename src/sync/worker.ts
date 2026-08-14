/**
 * Der Worker: eine Schlange, ein Tempo, kein Unterschied zwischen laufendem
 * Sync und Backfill.
 *
 * Er läuft, bis eines davon eintritt:
 *   * Die Schlange ist leer.
 *   * Das Arbeitsfenster endet.
 *   * Das Tagesbudget ist aufgebraucht.
 *   * Zu viele Fehler in Folge — dann bricht er ab, statt stur weiterzulaufen.
 *
 * Jeder Posten wird einzeln quittiert. Ein Absturz mitten im Lauf kostet
 * höchstens den einen Posten; alles andere steht in der Datenbank.
 */
import pg from 'pg'
import { query, eine, pool } from '../db/pool'
import { config, fnGrenzen } from '../config'
import { log } from '../lib/log'
import { LinaClient, strukturPruefen } from '../lina/client'
import { endpunkt } from '../lina/endpunkte'
import { FnClient } from '../foodnotify/client'
import { fnEndpunkt } from '../foodnotify/endpunkte'
import { fnLaden } from '../foodnotify/laden'
import { laden } from './laden'
import { alsIsoDatum } from '../lib/time'

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Exponentiell mit Jitter — nie im festen Takt nachfassen. */
function wiedervorlage(versuche: number): string {
  const basisMin = Math.min(6 * 60, 5 * 2 ** (versuche - 1))
  const jitter = 0.5 + Math.random()
  return `${Math.round(basisMin * jitter)} minutes`
}

/**
 * `sync.fortschritt` fortschreiben — je Endpunkt und Betrieb.
 *
 * DIE TABELLE HATTE VIER LESER UND KEINEN SCHREIBER. Sie steht seit Migration
 * `0005` da; am 14.08.2026 in Produktion nachgezaehlt: **0 Zeilen**. Gelesen
 * wird sie von `src/health.ts` (`pausierteKombinationen`), `mart.sync_status`
 * und zwei Sichten aus `0019`/`0039`. Der Gesundheitsbericht meldete daraus
 * strukturbedingt fuer immer „null pausierte Endpunkte" — die gefaehrlichste
 * Sorte Pruefung, weil sie nie ausschlaegt und deshalb nie hinterfragt wird.
 *
 * WARUM FUELLEN UND NICHT ENTFERNEN (Plan 3.4 liess beides offen): drei der
 * vier Spalten beantworten Fragen, die tatsaechlich jemand stellt — wo steht
 * welcher Endpunkt, welcher Betrieb haengt seit wann. Nur `pausiert_bis`
 * hatte keine Entsprechung mehr, weil die Selbstdrosselung inzwischen als
 * `faellig_ab` am POSTEN sitzt und nicht als Pause an der Kombination.
 * Deshalb steht hier genau das drin: die Wiedervorlage, die der Worker gerade
 * gesetzt hat.
 *
 * WIRFT NIE. Der Fortschritt ist eine Beobachtung ueber die Arbeit, nicht die
 * Arbeit. Ein Fehler beim Notieren darf den Posten nicht mitnehmen, der
 * gerade sauber geladen wurde.
 */
async function standSchreiben(
  endpunkt: string,
  betriebEncId: string | null,
  zeitraumBis: string | null,
  erfolg: boolean,
  wiedervorlageIn: string | null,
): Promise<void> {
  await query(
    `INSERT INTO sync.fortschritt
       (endpunkt, betrieb_enc_id, letzter_zeitraum, letzter_erfolg_am,
        fehler_in_folge, pausiert_bis)
     VALUES ($1, coalesce($2, ''), CASE WHEN $4 THEN $3::date END,
             CASE WHEN $4 THEN now() END,
             CASE WHEN $4 THEN 0 ELSE 1 END,
             CASE WHEN $5::text IS NULL THEN NULL ELSE now() + $5::interval END)
     ON CONFLICT (endpunkt, betrieb_enc_id) DO UPDATE
        -- greatest() ignoriert NULL: der Historienlauf arbeitet rueckwaerts
        -- und darf den erreichten Stand nicht zurueckdrehen.
        SET letzter_zeitraum  = greatest(excluded.letzter_zeitraum,
                                         fortschritt.letzter_zeitraum),
            letzter_erfolg_am = coalesce(excluded.letzter_erfolg_am,
                                         fortschritt.letzter_erfolg_am),
            fehler_in_folge   = CASE WHEN $4 THEN 0
                                     ELSE fortschritt.fehler_in_folge + 1 END,
            pausiert_bis      = excluded.pausiert_bis`,
    [endpunkt, betriebEncId, zeitraumBis, erfolg, wiedervorlageIn],
  ).catch(e => log.warn('fortschritt nicht fortgeschrieben — der Posten bleibt davon unberuehrt',
                        { endpunkt, fehler: String(e).slice(0, 200) }))
}

/**
 * Schlüssel der Advisory-Sperre. Frei gewählt, muss nur stabil sein.
 * (`sync.worker` als Zahl gelesen — irgendein fester Wert tut es.)
 */
const SPERRE = 8_142_026

/**
 * Genau ein Worker gleichzeitig, prozessübergreifend.
 *
 * Ohne diese Sperre ist die Drosselung wirkungslos, sobald die Schlange länger
 * ist als ein Lauf: Dokploy startet `bun run sync` stündlich, ein Backfill-Lauf
 * dauert aber bis zum Tagesbudget — also viele Stunden. Die Läufe würden sich
 * stapeln. `FOR UPDATE SKIP LOCKED` in der Warteschlange verhindert nur, dass
 * zwei denselben Posten greifen; parallel arbeiten dürften sie trotzdem, und
 * das Tagesbudget zählt jeder Prozess für sich im Speicher. Zehn Worker wären
 * zehnfaches Tempo und zehnfaches Budget.
 *
 * Vor dem 25.07.2026 hat das Arbeitsfenster diesen Fall zufällig gedeckelt.
 * Seit es entfallen ist, braucht es die Sperre explizit.
 *
 * `pg_try_advisory_lock` ist an die Verbindung gebunden, nicht an eine
 * Transaktion — die Verbindung muss also den ganzen Lauf über offen bleiben.
 * Sie fällt beim Verbindungsende von selbst weg, ein Absturz blockiert nichts.
 *
 * **Bewusst eine eigene Verbindung statt einer aus `pool`.** `pool.end()` am
 * Ende des Laufs wartet auf alle ausgecheckten Verbindungen — eine dauerhaft
 * gehaltene aus dem Pool lässt jeden Lauf am Ende hängen. Genau das ist beim
 * ersten Versuch passiert (60 s Timeout im Ende-zu-Ende-Test, 25.07.2026).
 */
async function sperreHolen(): Promise<{ frei: boolean; freigeben: () => Promise<void> }> {
  const verbindung = new pg.Client({ connectionString: config.DATABASE_URL })
  /**
   * Auch diese Verbindung kann wegbrechen — und ein `pg.Client` ohne
   * Fehler-Zuhörer reißt in Node den ganzen Prozess mit. Beim Ausfalltest am
   * 26.07.2026 war das der letzte verbliebene Stacktrace.
   *
   * Bricht sie weg, ist die Sperre weg: Postgres gibt Advisory-Sperren beim
   * Verbindungsende frei. Ein paralleler Lauf wäre damit möglich, ist aber
   * unwahrscheinlich (der Zeitplan startet stündlich) und deutlich harmloser
   * als ein Absturz mitten im Schreiben. Deshalb Warnung statt Abbruch.
   */
  verbindung.on('error', (e) => {
    log.warn('Verbindung der Laufsperre weggebrochen — die Sperre gilt nicht mehr',
      { fehler: String(e?.message ?? e).slice(0, 200) })
  })
  await verbindung.connect()
  try {
    const r = await verbindung.query('SELECT pg_try_advisory_lock($1) AS ok', [SPERRE])
    if (r.rows[0]?.ok !== true) {
      await verbindung.end()
      return { frei: false, freigeben: async () => {} }
    }
    // Kein explizites Unlock nötig: das Verbindungsende gibt die Sperre frei.
    return { frei: true, freigeben: () => verbindung.end() }
  } catch (e) {
    await verbindung.end().catch(() => {})
    throw e
  }
}

/**
 * Einen Start, der NICHT arbeitet, in sync.lauf festhalten — sofort beendet,
 * null Aufgaben, mit Notiz.
 *
 * Warum das eine Datenbankzeile sein muss und keine Logzeile: am 14.08.2026
 * fuellte der 05:00-Start die Warteschlange, uebersprang den Import (Lauf 90
 * hielt die Sperre bis zu seinem Abbruch um 08:00) und lief 15 Minuten
 * Nachlaeufe. In Dokploy sah das aus wie ein flotter, erfolgreicher Sync —
 * und genau so wurde es gelesen. Die einzige Spur war die Logzeile darueber.
 * Zum dritten Mal dieselbe Signatur (02.08., 12.08.): ein "nichts zu tun",
 * das nur im Log steht, sieht aus wie Erfolg. AGENTS.md Regel 10.
 *
 * Wer "letzter echter Lauf" meint, klammert beide Zustaende aus — so wie
 * src/status.ts (Drei-Laeufe-Fenster) und src/health.ts (veraltet-Messung).
 * mart.sync_status und mart.import_lauf zeigen sie absichtlich.
 */
async function startOhneArbeitFesthalten(
  ausloeser: 'zeitplan' | 'manuell' | 'backfill',
  status: 'uebersprungen' | 'gesperrt', notiz: string,
): Promise<void> {
  await query(
    `INSERT INTO sync.lauf (ausloeser, status, beendet_am, notiz)
     VALUES ($1, $2, now(), $3)`,
    [ausloeser, status, notiz])
}

export type LaufErgebnis = {
  laufId: string | null
  ok: number
  keineDaten: number
  fehler: number
  uebersprungen: number
  status: 'ok' | 'teilweise' | 'fehlgeschlagen' | 'abgebrochen' | 'lauf_uebersprungen' | 'gesperrt'
}

export async function workerLauf(
  ausloeser: 'zeitplan' | 'manuell' | 'backfill' = 'zeitplan',
): Promise<LaufErgebnis> {
  /**
   * Ruht der Zugang, wird gar nicht erst angefangen.
   *
   * Diese Prüfung steht bewusst VOR der Laufsperre und vor allem vor jedem
   * Netzwerkkontakt: Der Sinn einer Sperre ist, LINA in Ruhe zu lassen. Ein
   * Lauf, der sich erst anmeldet und dann feststellt, dass er pausieren soll,
   * hätte die eine Anfrage schon geschickt, die er nicht schicken darf.
   *
   * Der Zustand liegt in der Datenbank, nicht im Prozess — sonst wäre er beim
   * stündlichen Neustart wieder weg. Dieselbe Lektion wie beim Tagesbudget.
   */
  const ruht = await eine<{ art: string; pausiert_bis: Date; hinweis: string | null }>(
    `SELECT art, pausiert_bis, hinweis FROM sync.sperre_aktiv()`)
  if (ruht?.pausiert_bis) {
    log.error('zugang gesperrt — es wird kein Kontakt zu LINA aufgenommen', {
      art: ruht.art,
      pausiertBis: ruht.pausiert_bis,
      hinweis: ruht.hinweis,
      freigeben: "erst im Browser prüfen, dann SELECT sync.sperre_aufheben('name');",
    })
    await startOhneArbeitFesthalten(ausloeser, 'gesperrt',
      `zugang gesperrt (${ruht.art}) — pausiert bis ${ruht.pausiert_bis.toISOString()}`)
    return { laufId: null, ok: 0, keineDaten: 0, fehler: 0, uebersprungen: 0, status: 'gesperrt' }
  }

  const sperre = await sperreHolen()
  if (!sperre.frei) {
    // Kein Fehler, sondern der Normalfall bei einem stündlichen Zeitplan und
    // einem noch laufenden Backfill. Exitcode bleibt 0.
    log.info('lauf übersprungen — es läuft bereits einer', { ausloeser })
    const blockierer = await eine<{ lauf_id: string }>(
      `SELECT lauf_id FROM sync.lauf WHERE status = 'laeuft'
        ORDER BY lauf_id DESC LIMIT 1`)
    await startOhneArbeitFesthalten(ausloeser, 'uebersprungen',
      blockierer
        ? `Lauf ${blockierer.lauf_id} läuft noch — dieser Start hat nichts importiert`
        : 'Laufsperre belegt, aber kein Lauf im Zustand laeuft — dieser Start hat nichts importiert')
    return { laufId: null, ok: 0, keineDaten: 0, fehler: 0, uebersprungen: 0,
             status: 'lauf_uebersprungen' }
  }
  try {
    return await workerLaufIntern(ausloeser)
  } finally {
    // `workerLaufIntern` schließt am Ende den Pool. Dann ist die Sperre über
    // das Verbindungsende ohnehin schon weg, und der explizite Unlock schlägt
    // fehl — das ist erwartet und kein Grund, den Lauf als Fehler zu melden.
    await sperre.freigeben().catch(() => {})
  }
}

/** Signale, die im Container und auf der Konsole ein Ende bedeuten. */
const ENDESIGNALE = ['SIGINT', 'SIGTERM'] as const

/**
 * Wie lange nach dem Signal auf den sauberen Ausstieg gewartet wird, bevor der
 * Lauf notfalls von aussen geschlossen wird.
 *
 * Bewusst kurz: Docker schickt beim Stoppen SIGTERM und danach binnen zehn
 * Sekunden SIGKILL. Was bis dahin nicht geschrieben ist, ist verloren.
 */
const ABSCHLUSSFRIST_MS = 5_000

async function workerLaufIntern(
  ausloeser: 'zeitplan' | 'manuell' | 'backfill',
): Promise<LaufErgebnis> {
  const client = new LinaClient()
  // Das Tagesbudget gilt über Läufe hinweg, nicht je Prozess — sonst wäre es
  // beim stündlichen Zeitplan wirkungslos. Begründung in client.ts.
  await client.budgetLaden()

  /**
   * Der zweite Quellclient: FoodNotify, ein Client für alle vier Mandanten.
   * Eigener Takt (anderes Zielsystem), aber dasselbe Tagesbudget aus
   * derselben Zählung — der eine Worker bleibt die eine Bremse.
   */
  const fnClient = new FnClient()
  await fnClient.budgetLaden()
  /** marke_key → schluessel, für die Zugangswahl je Posten. Vier Zeilen. */
  const marken = new Map<number, string>(
    (await query<{ marke_key: number; schluessel: string }>(
      `SELECT marke_key, schluessel FROM core.marke`))
      .map(m => [Number(m.marke_key), m.schluessel]))

  const frei = await eine<{ n: number }>(`SELECT sync.haengende_posten_freigeben() AS n`)
  if (frei && Number(frei.n) > 0) log.warn('hängende Posten freigegeben', { anzahl: Number(frei.n) })

  const lauf = await eine<{ lauf_id: string }>(
    `INSERT INTO sync.lauf (ausloeser) VALUES ($1) RETURNING lauf_id`, [ausloeser])
  const laufId = String(lauf!.lauf_id)
  log.info('lauf gestartet', { laufId, ausloeser })

  let ok = 0, keineDaten = 0, fehler = 0, uebersprungen = 0
  let fehlerInFolge = 0
  let status: 'ok' | 'teilweise' | 'fehlgeschlagen' | 'abgebrochen' = 'ok'
  let notiz: string | null = null

  /**
   * Sauberes Herunterfahren bei Ctrl-C und beim Containerstopp.
   *
   * Ohne das bleibt der Eintrag in `sync.lauf` für immer auf `laeuft` stehen —
   * `beendet_am` wird im `finally` geschrieben, und ein Signal beendet den
   * Prozess davor. Am 25.07.2026 genau so passiert. In `mart.sync_status` sieht
   * ein abgewürgter Lauf dann aus wie einer, der noch arbeitet, und der Posten
   * bleibt bis zur Stundengrenze auf `in_arbeit_seit` hängen.
   *
   * Zwei Wege, weil einer nicht reicht:
   *   * Das Flag lässt die Schleife am nächsten Prüfpunkt sauber aussteigen —
   *     der Normalweg, alle Zähler stimmen.
   *   * Zwischen zwei Durchläufen liegt aber die Drosselpause von 20–40 s. So
   *     lange darf ein Containerstopp nicht warten, deshalb das Sicherheitsnetz
   *     nach ABSCHLUSSFRIST_MS: es schreibt den Lauf selbst fort und beendet.
   *
   * Ein zweites Signal heißt „jetzt sofort" und wird auch so behandelt.
   */
  let abbruchSignal: string | null = null
  let aktuellerPosten: string | null = null
  let abgeschlossen = false

  const laufFortschreiben = async (endStatus: typeof status, endNotiz: string | null) => {
    if (abgeschlossen) return
    abgeschlossen = true
    // Den reservierten Posten freigeben, sonst wartet er eine Stunde auf
    // sync.haengende_posten_freigeben(), obwohl niemand mehr an ihm arbeitet.
    if (aktuellerPosten) {
      await query(`UPDATE sync.warteschlange SET in_arbeit_seit = NULL WHERE posten_id = $1`,
        [aktuellerPosten]).catch(() => {})
    }
    await query(
      `UPDATE sync.lauf
          SET beendet_am = now(), status = $1, notiz = $2,
              aufgaben_gesamt = $3, aufgaben_ok = $4, aufgaben_fehler = $5,
              aufgaben_uebersprungen = $6
        WHERE lauf_id = $7`,
      [endStatus, endNotiz, ok + keineDaten + fehler, ok, fehler, uebersprungen, laufId],
    ).catch(() => {})
  }

  /**
   * Ein gesunder Lauf muss von außen als gesund erkennbar sein.
   *
   * Vorher ging jeder Erfolg nach `debug`, und zwischen zwei Posten liegen
   * 20–40 Sekunden — auf `info` war ein laufender Backfill also stundenlang
   * vollkommen still und von einem Hänger nicht zu unterscheiden. Am
   * 26.07.2026 wurde deshalb ein völlig intakter Lauf für tot gehalten und
   * abgebrochen; erst ein Neustart mit LOG_LEVEL=debug zeigte, dass er die
   * ganze Zeit gearbeitet hatte.
   *
   * Wie oft eine Zeile kommt, steuert FORTSCHRITT_ALLE: lokal jede, im
   * Container jede fünfzigste. Die Restdauer ist bewusst aus dem TATSÄCHLICH
   * gemessenen Tempo dieses Laufs gerechnet und nicht aus dem eingestellten
   * Takt — sonst zeigt sie eine Zahl an, die mit der Wirklichkeit nichts zu
   * tun hat, sobald LINA langsamer antwortet.
   */
  const dauerLesbar = (ms: number) => {
    const min = Math.round(ms / 60_000)
    if (min < 60) return `${min} min`
    const h = Math.floor(min / 60)
    if (h < 48) return `${h} h ${String(min % 60).padStart(2, '0')} min`
    return `${Math.floor(h / 24)} d ${String(h % 24).padStart(2, '0')} h`
  }

  /**
   * Ab wann die Restdauer ueberhaupt etwas aussagt — und wovon sie begrenzt ist.
   *
   * ZWEI FEHLER STECKTEN IN DER ERSTEN FASSUNG, beide am 26.07.2026 im echten
   * Lauf aufgefallen, weil die Anzeige von 14 h auf 104 h kletterte:
   *
   * 1. Sie mass ab Laufbeginn geteilt durch die Zahl der Posten. Beim ERSTEN
   *    Posten sind das Anmeldung plus ein Abruf und KEINE EINZIGE Taktpause —
   *    die liegt zwischen den Posten. 2,3 s statt 16 s je Posten, also eine um
   *    das Siebenfache zu optimistische Zahl, die dann langsam auf die
   *    Wahrheit zulief. Es sah aus, als wuerde die Arbeit mehr statt weniger.
   *    Jetzt zaehlt die Zeit erst ab dem Ende des ersten Postens, und vorher
   *    wird gar keine Schaetzung gezeigt.
   *
   * 2. Sie ignorierte das TAGESBUDGET. 23.500 Posten im gemessenen Takt sind
   *    gut vier Tage Rechenzeit — aber bei 3.000 Aufrufen am Tag dauert es
   *    knapp acht. Fuer einen Backfill ueber acht Jahre ist die Bremse der
   *    bindende Faktor, nicht das Tempo. Es gilt also der GROESSERE der
   *    beiden Werte.
   *
   * ZWEI WEITERE am 03.08.2026, aus demselben Muster: die Anzeige stand eine
   * Viertelstunde lang bei „4 h 06 min", dann endete der Lauf schlagartig mit
   * „Schlange leer". Beides stimmte — sie beschrieben nur nicht dasselbe.
   *
   * 3. `offen` zaehlte ALLE unerledigten Posten, auch die VERTAGTEN.
   *    `posten_holen` nimmt nur, was `faellig_ab <= now()` erfuellt (Migration
   *    0021). An dem Abend lagen 1.778 FoodNotify-Posten auf morgen frueh —
   *    dieser Lauf konnte sie per Definition nicht anfassen, die Schaetzung
   *    rechnete sie trotzdem mit. Sie beantwortete „wie lange braucht die
   *    Warteschlange" und nicht „wie lange laeuft DIESER Lauf noch".
   *
   * 4. Sie rechnete FoodNotify-Posten gegen LINAs Tagesbudget. Seit dem
   *    02.08.2026 hat jeder Anbieter sein eigenes (10.500 gegen 40.000) — die
   *    „4 h 06 min" waren exakt 1.795 / 10.500 × 24 h, eine Zahl ueber zwei
   *    Systeme, von denen keins so arbeitet. Jetzt gilt je Anbieter sein
   *    eigenes Budget, und es gewinnt der langsamere von beiden: sie teilen
   *    sich EINE Schleife, also wartet der eine, solange der andere bremst.
   *
   * 5. Und derselbe Fehler noch einmal, eine Ebene tiefer: EIN gemitteltes
   *    Tempo fuer beide Anbieter. Direkt nach dem Fix oben stand da wieder
   *    „4 h 05 min" — diesmal aus dem Tempo-Term, weil die ersten 50 Posten
   *    LINA waren (8 s je Posten, die Personalkosten allein 20 s) und diese
   *    Zahl auf eine Schlange angewandt wurde, die zu 98 % aus FoodNotify
   *    besteht. Dort sind es 1,2 s. Ein Sechstel der Wahrheit, mit derselben
   *    Selbstsicherheit vorgetragen.
   *
   *    Gemessen wird deshalb je Anbieter, und geschaetzt wird als Summe:
   *    LINA-Posten mal LINA-Tempo plus FoodNotify-Posten mal dessen Tempo.
   *
   *    UND WER NOCH NICHT DRANKAM, ERBT NICHTS. Der erste Anlauf lieh dem
   *    ungemessenen Anbieter das Tempo des anderen — „eine geliehene Zahl
   *    ist besser als keine". Das war falsch, und der naechste Lauf hat es
   *    sofort vorgefuehrt: elf Minuten lang standen wieder „4 h 06 min" da,
   *    weil FoodNotify (1.794 der 1.809 faelligen Posten) noch keinen
   *    einzigen Posten gemessen hatte und LINAs 8 s erbte. Eine geliehene
   *    Zahl ist eben KEINE Messung, und wo der ungemessene Anbieter die
   *    Schlange stellt, ist sie nur eine Erfindung mit Nachkommastelle.
   *    Hat ein Anbieter faellige Arbeit, aber keine eigene Messung, gibt es
   *    gar keine Schaetzung — dieselbe Entscheidung wie oben unter 1.
   *
   * Was vertagt ist, verschwindet damit aus der Schaetzung — aber nicht aus
   * dem Log: `vertagt` steht daneben. Die Zahl ist richtig, sie ist nur keine
   * Restlaufzeit. Sonst sieht ein Lauf, der 1.778 Posten auf morgen schiebt,
   * aus wie einer, der fertig ist.
   *
   * WAS DIE ZAHL NICHT KANN, UND ABSICHTLICH NICHT KANN: sie gilt fuer die
   * Schlange, WIE SIE JETZT IST. Beim FoodNotify-Backfill reiht jede geholte
   * Bestellseite ~25 Bestellungen mit je zwei Folgeposten nach — 1.724 offene
   * Seiten sind also nicht 1.724, sondern eher 88.000 Aufrufe. „59 min" ist
   * fuer den Inhalt der Schlange richtig und fuer den Backfill zu wenig.
   *
   * Das bleibt so. Die Folgeposten vorherzusagen hiesse, die Bestellungen je
   * Seite zu schaetzen und gegen bereits geladene abzuziehen — eine Modell-
   * annahme in einer Fortschrittsanzeige, also wieder eine erfundene Zahl,
   * nur mit mehr Rechenschritten davor. Wer den Gesamtumfang wissen will,
   * liest die offenen Seiten; wer wissen will, wann die Schlange leer ist,
   * liest diese Zahl.
   */
  const fnBudget = fnGrenzen().tagesbudget
  /**
   * Je Anbieter: wie viele Posten gemessen wurden und wie lange sie zusammen
   * gedauert haben. Gezaehlt wird der ABSTAND zwischen zwei Posten, nicht die
   * Antwortzeit — die Taktpause gehoert zur Dauer, sie ist der groessere Teil.
   * Der erste Posten hat keinen Vorgaenger und bleibt deshalb aussen vor.
   */
  const tempo = { lina: { n: 0, ms: 0 }, fn: { n: 0, ms: 0 } }
  let letztesEnde: number | null = null
  const jePosten = (art: 'lina' | 'fn'): number | null =>
    tempo[art].n > 0 ? tempo[art].ms / tempo[art].n : null
  const restschaetzung = (faellig: { lina: number; fn: number }): string | null => {
    const jeLina = jePosten('lina'), jeFn = jePosten('fn')
    // Arbeit ohne Messung: keine Zahl. Sie waere sonst die des anderen.
    if (faellig.lina > 0 && jeLina === null) return null
    if (faellig.fn > 0 && jeFn === null) return null
    const nachTempo = faellig.lina * (jeLina ?? 0) + faellig.fn * (jeFn ?? 0)
    const nachBudget = 86_400_000 * Math.max(
      faellig.lina / config.TAGESBUDGET,
      faellig.fn / fnBudget)
    return dauerLesbar(Math.max(nachTempo, nachBudget))
  }

  const fortschritt = async (endpunkt: string, von: string, zeilen: number | null, dauerMs?: number) => {
    const n = ok + keineDaten + fehler
    const jetzt = Date.now()
    if (letztesEnde !== null) {
      const art = endpunkt.startsWith('fn:') ? 'fn' : 'lina'
      tempo[art].n++
      tempo[art].ms += jetzt - letztesEnde
    }
    letztesEnde = jetzt
    if (config.FORTSCHRITT_ALLE === 0 || n % config.FORTSCHRITT_ALLE !== 0) return
    /**
     * `marke_key IS NULL` heisst LINA (Migration 0031) — dieselbe Weiche wie
     * unten in der Schleife. Der Faelligkeitsfilter spiegelt `posten_holen`.
     */
    const r = await eine<{ lina: number; fn: number; vertagt: number }>(
      `SELECT count(*) FILTER (WHERE marke_key IS NULL     AND faellig_ab <= now())::int AS lina,
              count(*) FILTER (WHERE marke_key IS NOT NULL AND faellig_ab <= now())::int AS fn,
              count(*) FILTER (WHERE faellig_ab > now())::int AS vertagt
         FROM sync.warteschlange WHERE erledigt_am IS NULL`)
      .catch(() => null)
    const faellig = r ? { lina: Number(r.lina), fn: Number(r.fn) } : null
    log.info('fortschritt', {
      endpunkt, von, zeilen, dauerMs,
      imLauf: n,
      offen: faellig ? faellig.lina + faellig.fn : null,
      vertagt: r ? Number(r.vertagt) : null,
      rest: faellig && faellig.lina + faellig.fn > 0 ? restschaetzung(faellig) : null,
    })
  }

  const behandler = new Map<string, () => void>()
  for (const signal of ENDESIGNALE) {
    const fn = () => {
      if (abbruchSignal) { log.warn('zweites Signal — sofortiger Abbruch', { signal }); process.exit(130) }
      abbruchSignal = signal
      log.warn('abbruch angefordert — Lauf wird geschlossen', { signal, laufId })
      const netz = setTimeout(async () => {
        await laufFortschreiben('abgebrochen', `durch ${signal} beendet (Frist abgelaufen)`)
        log.warn('lauf nach Signal geschlossen', { laufId, signal, ok, keineDaten, fehler })
        process.exit(130)
      }, ABSCHLUSSFRIST_MS)
      // Das Netz darf den Prozess nicht am Leben halten, wenn die Schleife
      // rechtzeitig von selbst herauskommt.
      netz.unref?.()
    }
    behandler.set(signal, fn)
    process.on(signal, fn)
  }

  try {
    while (true) {
      if (abbruchSignal) {
        status = 'abgebrochen'
        notiz = `durch ${abbruchSignal} beendet`
        break
      }
      if (!client.imFenster()) { notiz = 'Arbeitsfenster beendet'; break }
      /**
       * Die Budgets sind JE ANBIETER getrennt (seit 02.08.2026), also
       * bricht der Lauf erst ab, wenn BEIDE erschöpft sind.
       *
       * Vorher stand hier `||`: ein aufgebrauchtes FoodNotify-Budget
       * beendete den Lauf, und LINAs Tagesdaten blieben liegen, obwohl
       * ihr eigenes Budget unberührt war. Ein Anbieter an seiner Grenze
       * darf den anderen nicht anhalten.
       *
       * Ist nur eines leer, laufen die Posten des anderen weiter — die
       * Posten des erschöpften werden unten übersprungen und bleiben
       * offen für den nächsten Lauf.
       */
      if (client.budgetUebrig === 0 && fnClient.budgetUebrig === 0) {
        notiz = 'Tagesbudget beider Anbieter aufgebraucht'; break
      }
      if (config.MAX_POSTEN_PRO_LAUF > 0 && ok + keineDaten + fehler >= config.MAX_POSTEN_PRO_LAUF) {
        notiz = 'Postenobergrenze je Lauf erreicht'; break
      }
      if (fehlerInFolge >= config.ABBRUCH_NACH_FEHLERN) {
        status = 'abgebrochen'
        notiz = `${fehlerInFolge} Fehler in Folge — Lauf gestoppt, statt weiter gegen LINA zu laufen`
        log.error('abbruch wegen fehlerhäufung', { fehlerInFolge })
        break
      }

      /**
       * Schon das Holen des nächsten Postens kann scheitern, wenn die
       * Datenbank kurz weg ist. Das darf den Lauf nicht beenden — `query()`
       * wiederholt transiente Fehler bereits, und was danach noch übrig
       * bleibt, zählt hier als Fehler in Folge. Nach ABBRUCH_NACH_FEHLERN
       * bricht der Wächter oben ab; das ist dann auch richtig, denn ohne
       * Datenbank kann der Worker nichts Sinnvolles tun.
       */
      let posten: any
      try {
        posten = await eine<any>(`SELECT * FROM sync.posten_holen($1)`, [laufId])
      } catch (e) {
        fehlerInFolge++
        log.error('posten_holen fehlgeschlagen', { fehlerInFolge, fehler: String(e).slice(0, 300) })
        await schlaf(5_000)
        continue
      }
      /**
       * „Schlange leer" hiess bis zum 03.08.2026 auch dann so, wenn 1.778
       * Posten offen und nur vertagt waren. Der Lauf endete korrekt, die
       * Meldung log — nichts war leer, es war nur nichts faellig. Wer den
       * Unterschied nicht sieht, sucht am naechsten Tag nach verlorenen Daten.
       */
      if (!posten?.posten_id) {
        const w = await eine<{ vertagt: number; naechste: Date | null }>(
          `SELECT count(*)::int AS vertagt, min(faellig_ab) AS naechste
             FROM sync.warteschlange
            WHERE erledigt_am IS NULL AND faellig_ab > now()`).catch(() => null)
        const vertagt = w ? Number(w.vertagt) : 0
        notiz ??= vertagt > 0
          ? `nichts faellig — ${vertagt} Posten vertagt bis ${w?.naechste?.toISOString() ?? '?'}`
          : 'Schlange leer'
        break
      }
      // Merken, damit ein Signal die Reservierung wieder lösen kann.
      aktuellerPosten = String(posten.posten_id)

      /**
       * Ab hier ist alles gekapselt. Vorher war nur `laden()` geschützt, und
       * jeder andere Datenbankzugriff — die Statusschreibungen, `protokoll()`,
       * sogar der Fehlerpfad selbst — konnte den ganzen Lauf beenden. Am
       * 26.07.2026 ist genau das passiert: nach 16 erfolgreichen Posten kam
       * ein Verbindungsfehler, und der Lauf war tot. Bei einem Backfill über
       * Tage wäre das ein täglicher Abbruch.
       *
       * Ein einzelner Posten darf scheitern. Der Lauf nicht.
       */
      try {
      // postgres.js gibt date als Date zurueck - hier einmal normalisieren.
      const von = alsIsoDatum(posten.zeitraum_von)
      const bis = alsIsoDatum(posten.zeitraum_bis)
      const extra = (posten.parameter ?? {}) as Record<string, string>

      /**
       * Welches Quellsystem? marke_key entscheidet (NULL = LINA, Migration
       * 0031). Alles danach — Erfolgs-, Sperr- und Fehlerpfad — ist für
       * beide gleich; nur Abruf und Laden unterscheiden sich.
       */
      const quelle = posten.marke_key != null
        ? { art: 'fn' as const, ep: fnEndpunkt(posten.endpunkt),
            markeKey: Number(posten.marke_key),
            marke: marken.get(Number(posten.marke_key)) ?? `unbekannt_${posten.marke_key}` }
        : { art: 'lina' as const, ep: endpunkt(posten.endpunkt) }
      const epKey = quelle.ep.key
      const quellClient = quelle.art === 'fn' ? fnClient : client

      /**
       * Ist das Budget DIESES Anbieters erschöpft, wird der Posten
       * zurückgelegt — der andere Anbieter arbeitet weiter.
       *
       * Zurücklegen und nicht als Fehler zählen: das Budget ist eine
       * gewollte Grenze, kein Zwischenfall. `faellig_ab` auf morgen früh,
       * damit derselbe Posten nicht sofort wieder gezogen wird und der
       * Lauf sich in einer Schleife dreht.
       */
      if (quellClient.budgetUebrig === 0) {
        await query(
          `UPDATE sync.warteschlange
              SET in_arbeit_seit = NULL, versuche = greatest(0, versuche - 1),
                  faellig_ab = date_trunc('day', now()) + interval '1 day'
            WHERE posten_id = $1`, [posten.posten_id])
        uebersprungen++
        continue
      }

      let parameter: Record<string, string> = extra
      let res
      if (quelle.art === 'fn') {
        res = await fnClient.holen(quelle.ep, quelle.marke, extra)
      } else {
        parameter = quelle.ep.parameter(von, bis, extra)
        if (posten.betrieb_enc_id) parameter.storeId = posten.betrieb_enc_id
        res = await client.holen(quelle.ep, parameter)
      }

      // --- Erfolg -------------------------------------------------------
      if (res.art === 'ok') {
        if (quelle.art === 'lina') {
          // Die zod-Schemas gibt es nur für LINA. FoodNotifys Gegenstück ist
          // die Leere-200er-Prüfung in fnLaden — dort, weil sie die
          // Aufgabenhistorie braucht, nicht nur die Antwort.
          const pruefung = strukturPruefen(epKey, res.daten)
          if (!pruefung.ok) {
            // Nicht verwerfen: Raw behält die Daten, aber es muss auffallen.
            await query(
              `INSERT INTO sync.schema_abweichung (endpunkt, erwartet, tatsaechlich)
               VALUES ($1, $2, $3)`,
              [epKey, JSON.stringify(pruefung.erwartet), JSON.stringify(pruefung.tatsaechlich)])
            log.warn('schema weicht ab', { endpunkt: epKey, von })
          }
        }

        let zeilen = 0
        try {
          zeilen = quelle.art === 'fn'
            ? await fnLaden({
                ep: quelle.ep, markeKey: quelle.markeKey, von, bis, parameter: extra,
                daten: res.daten, httpStatus: res.status, bytes: res.bytes, hash: res.hash, laufId,
              })
            : await laden({
                ep: quelle.ep, von, bis, parameter, daten: res.daten,
                httpStatus: res.status, bytes: res.bytes, hash: res.hash,
                laufId, betriebEncId: posten.betrieb_enc_id ?? null,
              })
        } catch (e) {
          fehler++; fehlerInFolge++
          await query(
            `UPDATE sync.warteschlange
                SET in_arbeit_seit = NULL, letzter_fehler = $1,
                    faellig_ab = now() + $2::interval
              WHERE posten_id = $3`,
            [String(e).slice(0, 2000), wiedervorlage(posten.versuche), posten.posten_id])
          await protokoll(laufId, epKey, posten, 'fehler', res, quellClient, String(e))
          log.error('laden fehlgeschlagen', { endpunkt: epKey, von, fehler: String(e) })
          continue
        }

        ok++; fehlerInFolge = 0
        await query(
          // gesperrt_seit raeumt der Erfolg mit ab: ein nachgetragener
          // Anspruch soll die Frist nicht mit sich herumtragen (0075).
          `UPDATE sync.warteschlange
              SET erledigt_am = now(), in_arbeit_seit = NULL, ergebnis = 'ok',
                  letzter_fehler = NULL, gesperrt_seit = NULL
            WHERE posten_id = $1`, [posten.posten_id])
        await protokoll(laufId, epKey, posten, 'ok', res, quellClient, null, zeilen)
        log.debug('geladen', { endpunkt: epKey, von, zeilen, dauerMs: res.dauerMs })
        await fortschritt(epKey, von, zeilen, res.dauerMs)
        await standSchreiben(epKey, posten.betrieb_enc_id ?? null, bis, true, null)
        continue
      }

      // --- Kein Fehler: der Betrieb hat für diesen Bericht nichts --------
      if (res.art === 'keine_daten') {
        keineDaten++; fehlerInFolge = 0
        await query(
          `UPDATE sync.warteschlange
              SET erledigt_am = now(), in_arbeit_seit = NULL, ergebnis = 'keine_daten'
            WHERE posten_id = $1`, [posten.posten_id])
        await protokoll(laufId, epKey, posten, 'keine_daten', res, quellClient)
        // Auch hier eine Zeile: eine lange Strecke ohne Daten (geschlossener
        // Betrieb, Zeitraum vor der Eroeffnung) ist sonst wieder Stille.
        await fortschritt(epKey, von, null, res.dauerMs)
        // `keine_daten` ist ein gelungener Aufruf, kein Fehler (AGENTS.md).
        // Er schiebt den Stand vor, sonst sieht ein geschlossener Betrieb
        // in `sync.fortschritt` aus wie einer, den wir nicht erreichen.
        await standSchreiben(epKey, posten.betrieb_enc_id ?? null, bis, true, null)
        continue
      }

      /**
       * --- Zugang gesperrt: aufhören, nicht durchhalten -------------------
       *
       * Der Posten ist in Ordnung, der Zugang nicht. Deshalb wird er weder
       * aufgegeben noch mit einem verbrauchten Versuch belastet — `versuche`
       * geht zurück, sonst wäre er nach vier Sperren dauerhaft weg, ohne je
       * an LINA gescheitert zu sein.
       *
       * Und der Lauf endet hier. Ohne das liefen bis zu ABBRUCH_NACH_FEHLERN
       * weitere Anfragen gegen ein System, das gerade „nein" gesagt hat.
       */
      /**
       * --- FoodNotify gesperrt: nur die Marke ruht, der Lauf läuft weiter --
       *
       * Der globale Sperrpfad darunter legt den GANZEN Importer still — für
       * LINA richtig (es gibt nur den einen Zugang), für FoodNotify falsch:
       * ein falsches Passwort bei Aposto darf weder LINA noch die anderen
       * drei Marken anhalten.
       *
       * Stattdessen werden alle offenen Posten der Marke vertagt. Die Frist
       * ist dieselbe wie bei der globalen Sperre (48 h bei Anmeldefehlern,
       * 24 h sonst, Retry-After gewinnt) — Regel 7 bleibt gewahrt: der
       * nächste Anmeldeversuch kommt frühestens nach der Frist, nicht beim
       * nächsten Stundenlauf. Im laufenden Prozess verhindert zusätzlich
       * die Sperre je Marke im FnClient jeden weiteren Versuch.
       */
      /**
       * --- 403 sperrt eine RESSOURCE, nicht ein KONTO ---------------------
       *
       * Am 03.08.2026 gemessen: Kostenstelle 11805 antwortet dem
       * Enchilada-Zugang mit 403, dieselbe Anmeldung holt 10059 und 10064
       * unmittelbar danach fehlerfrei. FoodNotify betreibt in einem Mandanten
       * auch Betriebe, die uns nicht gehoeren — 403 heisst dort „diese
       * Kostenstelle nicht", nicht „dieser Zugang nicht".
       *
       * Behandelt wurde es trotzdem wie eine Kontosperre: 584 offene Posten
       * der Marke lagen 24 Stunden still wegen EINER Kostenstelle. Das ist
       * der teuerste Fehler dieser Art — ein einzelner fehlender Anspruch
       * legt einen ganzen Backfill lahm.
       *
       * Jetzt ruht nur der Posten. 24 Stunden statt Aufgeben, weil ein
       * Anspruch nachgetragen werden kann und ein Aufruf am Tag nichts
       * kostet. `fehlerInFolge++` ist die Gegenprobe: sagt der Zugang
       * WIRKLICH ueberall nein, stoppt der Lauf nach ABBRUCH_NACH_FEHLERN —
       * dann liegt es am Konto und nicht an einer Kostenstelle.
       *
       * 429 bleibt marken-weit: „zu schnell" gilt fuer den Zugang, nicht
       * fuer die Ressource.
       *
       * --- UND SEIT 0075 MIT EINEM ENDE -----------------------------------
       *
       * Der Zweig oben war richtig gedacht und lief trotzdem unbegrenzt:
       * `posten_holen()` zaehlt `versuche` hoch, dieser Zweig zaehlt es
       * wieder herunter, netto ±0 pro Tag. Posten 28629 (Enchilada, erpId
       * 11805, „Layer-Chemie Testbetrieb") lag vom 02.08. bis zum 14.08.2026
       * darin und stand immer noch auf `versuche = 0` — waehrend er ueber
       * `liste_vollstaendig` alle 60 Enchilada-Monatszeilen der Ladestands-
       * karte auf „unvollstaendig" faerbte.
       *
       * `gesperrt_seit` ist der Fakt, der gefehlt hat: seit wann sagt die
       * Quelle nein. Nach SPERRE_AUFGEBEN_TAGE wird der Posten geschlossen —
       * mit `kein_zugriff` und nicht mit `aufgegeben`, weil
       * `aufgegebeneWiederbeleben()` ihn sonst dreimal zurueckholte, um
       * dreimal dasselbe 403 zu bekommen.
       *
       * DIE GEGENPROBE, DAMIT KEIN KONTOPROBLEM ALS QUELLENGRENZE ENDET:
       * geschlossen wird nur, wenn derselbe Endpunkt derselben Marke in den
       * letzten 24 Stunden irgendwo ein `ok` hatte. Sagt der Zugang ueberall
       * nein, bleibt der Posten liegen und der Lauf stoppt wie gehabt nach
       * ABBRUCH_NACH_FEHLERN.
       */
      if (res.art === 'gesperrt' && res.sperrArt === 'http_403' && quelle.art === 'fn') {
        const bisWann = res.wartenBis
          ?? new Date(Date.now() + config.SPERRE_PAUSE_STUNDEN * 3_600_000)
        const stand = await eine<{ tage: number; quelle_antwortet: boolean }>(
          `UPDATE sync.warteschlange w
              SET in_arbeit_seit = NULL, versuche = greatest(0, versuche - 1),
                  letzter_fehler = $2, faellig_ab = $1::timestamptz,
                  gesperrt_seit = coalesce(w.gesperrt_seit, now())
            WHERE w.posten_id = $3
        RETURNING EXTRACT(epoch FROM (now() - w.gesperrt_seit)) / 86400 AS tage,
                  EXISTS (SELECT 1 FROM sync.aufgabe a
                           WHERE a.endpunkt = w.endpunkt
                             AND a.marke_key IS NOT DISTINCT FROM w.marke_key
                             AND a.status = 'ok'
                             AND a.beendet_am > now() - interval '24 hours')
                    AS quelle_antwortet`,
          [bisWann, res.fehler.slice(0, 2000), posten.posten_id])

        const tage = Number(stand?.tage ?? 0)
        if (tage >= config.SPERRE_AUFGEBEN_TAGE && stand?.quelle_antwortet) {
          await query(
            `UPDATE sync.warteschlange
                SET erledigt_am = now(), in_arbeit_seit = NULL, ergebnis = 'kein_zugriff',
                    letzter_fehler = $2
              WHERE posten_id = $1`,
            [posten.posten_id,
             `${res.fehler.slice(0, 1800)} — seit ${Math.floor(tage)} Tagen abgelehnt, `
             + `waehrend derselbe Endpunkt derselben Marke antwortet. Als Quellengrenze `
             + `geschlossen, siehe mart.posten_ohne_zugriff.`])
          await protokoll(laufId, epKey, posten, 'uebersprungen', res, quellClient, res.fehler)
          uebersprungen++
          // KEIN fehlerInFolge++: das hier ist eine beantwortete Frage und
          // kein Fehlschlag. Hochzaehlen hiesse, dass ein Aufraeumen den
          // Lauf abbrechen kann.
          log.warn('foodnotify 403 dauerhaft — posten als kein_zugriff geschlossen', {
            marke: quelle.marke, endpunkt: epKey, parameter: posten.parameter,
            tage: Math.floor(tage), sicht: 'mart.posten_ohne_zugriff',
          })
          continue
        }

        await protokoll(laufId, epKey, posten, 'uebersprungen', res, quellClient, res.fehler)
        uebersprungen++
        fehlerInFolge++
        log.warn('foodnotify 403 auf einer ressource — nur dieser posten ruht', {
          marke: quelle.marke, endpunkt: epKey, parameter: posten.parameter,
          fehlerInFolge, vertagtBis: bisWann, gesperrtSeitTagen: Math.floor(tage),
          schliesstNach: config.SPERRE_AUFGEBEN_TAGE,
          quelleAntwortet: stand?.quelle_antwortet ?? null,
        })
        continue
      }

      if (res.art === 'gesperrt' && quelle.art === 'fn') {
        const stunden = res.sperrArt === 'anmeldung'
          ? config.SPERRE_ANMELDUNG_STUNDEN : config.SPERRE_PAUSE_STUNDEN
        const bisWann = res.wartenBis ?? new Date(Date.now() + stunden * 3_600_000)
        await query(
          `UPDATE sync.warteschlange
              SET in_arbeit_seit = NULL,
                  faellig_ab = greatest(faellig_ab, $1::timestamptz),
                  letzter_fehler = CASE WHEN posten_id = $3 THEN $2 ELSE letzter_fehler END,
                  versuche = CASE WHEN posten_id = $3 THEN greatest(0, versuche - 1) ELSE versuche END
            WHERE marke_key = $4 AND erledigt_am IS NULL`,
          [bisWann, res.fehler.slice(0, 2000), posten.posten_id, quelle.markeKey])
        await protokoll(laufId, epKey, posten, 'uebersprungen', res, quellClient, res.fehler)
        log.error('foodnotify-marke gesperrt — ihre posten sind vertagt, der lauf läuft weiter', {
          marke: quelle.marke, art: res.sperrArt, status: res.status,
          fehler: res.fehler, vertagtBis: bisWann,
        })
        // Kein fehlerInFolge++: der Posten ist in Ordnung, der Zugang nicht.
        continue
      }

      if (res.art === 'gesperrt') {
        await query(
          `UPDATE sync.warteschlange
              SET in_arbeit_seit = NULL, versuche = greatest(0, versuche - 1),
                  letzter_fehler = $1
            WHERE posten_id = $2`, [res.fehler.slice(0, 2000), posten.posten_id])
        aktuellerPosten = null
        await protokoll(laufId, epKey, posten, 'uebersprungen', res, quellClient, res.fehler)

        const bis = await eine<{ bis: Date }>(
          `SELECT sync.sperre_setzen($1, $2, $3, $4, $5, $6, $7) AS bis`,
          [res.sperrArt,
           res.sperrArt === 'anmeldung' ? config.SPERRE_ANMELDUNG_STUNDEN : config.SPERRE_PAUSE_STUNDEN,
           res.status, epKey, res.fehler.slice(0, 2000), laufId,
           res.wartenBis ?? null])

        status = 'abgebrochen'
        notiz = `Zugang gesperrt (${res.sperrArt}) — Pause bis ${bis?.bis?.toISOString() ?? '?'}`
        log.error('ZUGANG GESPERRT — Lauf wird beendet', {
          art: res.sperrArt,
          status: res.status,
          fehler: res.fehler,
          pausiertBis: bis?.bis,
          naechsteSchritte: 'im Browser prüfen, ob der Zugang noch geht. Danach: ' +
                            "SELECT sync.sperre_aufheben('name');",
        })
        break
      }

      // --- Fehler -------------------------------------------------------
      fehler++; fehlerInFolge++
      const aufgeben = !res.wiederholbar || posten.versuche >= config.MAX_VERSUCHE
      if (aufgeben) {
        uebersprungen++
        await query(
          `UPDATE sync.warteschlange
              SET erledigt_am = now(), in_arbeit_seit = NULL, ergebnis = 'aufgegeben',
                  letzter_fehler = $1
            WHERE posten_id = $2`, [res.fehler.slice(0, 2000), posten.posten_id])
        log.error('posten aufgegeben', { endpunkt: epKey, von, versuche: posten.versuche, fehler: res.fehler })
        await standSchreiben(epKey, posten.betrieb_enc_id ?? null, null, false, null)
      } else {
        const frist = wiedervorlage(posten.versuche)
        await query(
          `UPDATE sync.warteschlange
              SET in_arbeit_seit = NULL, letzter_fehler = $1,
                  faellig_ab = now() + $2::interval
            WHERE posten_id = $3`,
          [res.fehler.slice(0, 2000), frist, posten.posten_id])
        log.warn('wiedervorlage', { endpunkt: epKey, von, versuche: posten.versuche, fehler: res.fehler })
        // Genau diese Frist ist die „Selbstdrosselung dieser Kombination",
        // die `sync.fortschritt.pausiert_bis` seit Migration 0005 meint.
        await standSchreiben(epKey, posten.betrieb_enc_id ?? null, null, false, frist)
      }
      await protokoll(laufId, epKey, posten, aufgeben ? 'uebersprungen' : 'fehler', res, quellClient, res.fehler)
      } catch (e) {
        /**
         * Das Netz unter dem Netz: hierher kommt alles, was die Zweige oben
         * nicht selbst abgefangen haben — ein Datenbankfehler beim Quittieren,
         * ein unerwarteter Zustand, ein Fehler im Fehlerpfad.
         *
         * Die Reservierung wird freigegeben, damit der Posten nicht bis zur
         * Stundengrenze von `haengende_posten_freigeben()` blockiert bleibt.
         * Auch das kann scheitern, wenn die Datenbank weg ist — dann greift
         * eben die Stundengrenze. Deshalb best effort und kein weiterer Wurf:
         * ein zweiter Fehler an dieser Stelle würde genau den Abbruch
         * auslösen, den dieser Block verhindern soll.
         */
        fehler++; fehlerInFolge++
        log.error('posten abgebrochen', {
          endpunkt: posten.endpunkt, postenId: posten.posten_id,
          fehlerInFolge, fehler: String(e).slice(0, 300),
        })
        await query(
          `UPDATE sync.warteschlange
              SET in_arbeit_seit = NULL, letzter_fehler = $1,
                  faellig_ab = now() + $2::interval
            WHERE posten_id = $3`,
          [String(e).slice(0, 2000), wiedervorlage(posten.versuche ?? 1), posten.posten_id],
        ).catch(() => log.error('konnte den Posten nicht freigeben — greift erst die Stundengrenze',
                                { postenId: posten.posten_id }))
      } finally {
        aktuellerPosten = null
      }
    }

    if (fehler > 0 && status === 'ok') status = 'teilweise'
  } catch (e) {
    // Ohne diesen Zweig wird ein abgestürzter Lauf als 'ok' verbucht: die
    // Zeile oben wird übersprungen, `status` steht noch auf seinem Anfangswert,
    // und das `finally` schreibt ihn so weg. Am 26.07.2026 stand deshalb in
    // mart.sync_status ein Lauf mit status 'ok' und aufgaben_fehler 1, obwohl
    // er an einem Datenbankfehler gestorben war.
    status = 'fehlgeschlagen'
    notiz = `Lauf abgebrochen: ${String(e).slice(0, 500)}`
    throw e
  } finally {
    // Handler wieder abmelden: workerLauf kann mehrfach im selben Prozess
    // laufen (Tests), und hängengebliebene Listener wären ein Leck.
    for (const [signal, fn] of behandler) process.off(signal, fn)
    // Derselbe idempotente Pfad wie im Signalfall — wer zuerst kommt, gewinnt,
    // der zweite Aufruf tut nichts.
    await laufFortschreiben(status, notiz)
    log.info('lauf beendet', {
      laufId, status, ok, keineDaten, fehler, uebersprungen,
      budgetVerbraucht: client.budgetVerbraucht, notiz,
    })
    // Der Pool wird hier BEWUSST nicht geschlossen. Er gehört dem Prozess,
    // nicht diesem Lauf: `pool.end()` an dieser Stelle machte workerLauf zu
    // einer Funktion, die man pro Prozess genau einmal aufrufen kann — jeder
    // zweite Aufruf scheiterte mit „Cannot use a pool after calling end".
    // Aufgefallen ist das erst, als der Ende-zu-Ende-Test einen zweiten
    // Durchlauf für die Stammdaten bekam. Geschlossen wird in src/sync.ts.
  }

  return { laufId, ok, keineDaten, fehler, uebersprungen, status }
}

async function protokoll(
  laufId: string, endpunktKey: string, posten: any,
  status: 'ok' | 'keine_daten' | 'fehler' | 'uebersprungen',
  // Nur die Wartezeit wird gebraucht — so passt jeder Quellclient.
  res: { status?: number | null; dauerMs: number }, client: { letzteWartezeitMs: number },
  fehler: string | null = null, zeilen: number | null = null,
) {
  await query(
    `INSERT INTO sync.aufgabe
       (lauf_id, endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis, versuch,
        status, http_status, zeilen, dauer_ms, wartezeit_ms, fehler, marke_key, parameter)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [laufId, endpunktKey, posten.betrieb_enc_id ?? null, posten.zeitraum_von,
     posten.zeitraum_bis, posten.versuche, status, res.status ?? null, zeilen,
     res.dauerMs, client.letzteWartezeitMs, fehler,
     // Mandant und Parameter (Migration 0032): die Kombination, über die die
     // Leere-200er-Prüfung "kam hier früher etwas?" beantwortet.
     posten.marke_key ?? null, JSON.stringify(posten.parameter ?? {})])
}
