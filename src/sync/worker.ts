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
    return { laufId: null, ok: 0, keineDaten: 0, fehler: 0, uebersprungen: 0, status: 'gesperrt' }
  }

  const sperre = await sperreHolen()
  if (!sperre.frei) {
    // Kein Fehler, sondern der Normalfall bei einem stündlichen Zeitplan und
    // einem noch laufenden Backfill. Exitcode bleibt 0.
    log.info('lauf übersprungen — es läuft bereits einer', { ausloeser })
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
   */
  let erstesEnde: number | null = null
  const restschaetzung = (offen: number, n: number): string | null => {
    if (erstesEnde === null || n < 2) return null
    const jePosten = (Date.now() - erstesEnde) / (n - 1)
    const nachTempo = offen * jePosten
    const nachBudget = (offen / config.TAGESBUDGET) * 86_400_000
    return dauerLesbar(Math.max(nachTempo, nachBudget))
  }

  const fortschritt = async (endpunkt: string, von: string, zeilen: number | null, dauerMs?: number) => {
    const n = ok + keineDaten + fehler
    if (erstesEnde === null) erstesEnde = Date.now()
    if (config.FORTSCHRITT_ALLE === 0 || n % config.FORTSCHRITT_ALLE !== 0) return
    const r = await eine<{ offen: number }>(
      `SELECT count(*)::int AS offen FROM sync.warteschlange WHERE erledigt_am IS NULL`)
      .catch(() => null)
    const offen = r ? Number(r.offen) : null
    log.info('fortschritt', {
      endpunkt, von, zeilen, dauerMs,
      imLauf: n, offen,
      rest: offen ? restschaetzung(offen, n) : null,
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
      if (!posten?.posten_id) { notiz ??= 'Schlange leer'; break }
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
          `UPDATE sync.warteschlange
              SET erledigt_am = now(), in_arbeit_seit = NULL, ergebnis = 'ok', letzter_fehler = NULL
            WHERE posten_id = $1`, [posten.posten_id])
        await protokoll(laufId, epKey, posten, 'ok', res, quellClient, null, zeilen)
        log.debug('geladen', { endpunkt: epKey, von, zeilen, dauerMs: res.dauerMs })
        await fortschritt(epKey, von, zeilen, res.dauerMs)
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
      } else {
        await query(
          `UPDATE sync.warteschlange
              SET in_arbeit_seit = NULL, letzter_fehler = $1,
                  faellig_ab = now() + $2::interval
            WHERE posten_id = $3`,
          [res.fehler.slice(0, 2000), wiedervorlage(posten.versuche), posten.posten_id])
        log.warn('wiedervorlage', { endpunkt: epKey, von, versuche: posten.versuche, fehler: res.fehler })
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
