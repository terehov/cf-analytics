/**
 * Einstiegspunkt für einen Sync-Lauf.
 *
 * Wird von Dokploy per Schedule Job aufgerufen (`bun run sync`) — als eigener
 * Prozess im laufenden Container. Startet frisch, arbeitet, beendet sich.
 * Der Zustand liegt in der Datenbank, nicht im Prozess.
 */
import { config, konfigZumLoggen } from './config'
import { log } from './lib/log'
import { pool } from './db/pool'
import { workerOeffnen } from './sync/worker'
import { nachfuellen } from './sync/nachfuellen'
import { auswahllistenNachlauf } from './sync/auswahllisten'
import { deckungsbeitragNachlauf } from './sync/deckungsbeitrag'
import { roundTableNachlauf } from './sync/round_table'
import { vergleichstagNachlauf } from './sync/vergleichstag'
import { wetterNachlauf } from './wetter/nachlauf'
import { einkaufspreisNachlauf } from './sync/einkaufspreis'
import { einkaufSichtenNachlauf } from './sync/einkauf_sichten'
import { pflichtartikelSichtenNachlauf } from './sync/pflichtartikel_sichten'
import { zuordnungNachlauf } from './sync/zuordnung'
import { yextNachlauf } from './yext/nachlauf'
import { bountiNachlauf } from './bounti/nachlauf'
import { zulaufPruefen } from './sync/zulauf'
import { pflegeNachlauf } from './pflege/nachlauf'

const ausloeser = process.argv.includes('--backfill') ? 'backfill'
                : process.argv.includes('--manuell')  ? 'manuell'
                : 'zeitplan'

log.info('start', konfigZumLoggen())

// Der Pool gehört dem Prozess, nicht dem Lauf — deshalb wird er hier
// geschlossen und nicht in workerLauf. Sonst liesse sich der Worker pro
// Prozess nur genau einmal aufrufen.
try {
  /**
   * VORLAUF: die Warteschlange selbst nachfüllen.
   *
   * Bis zum 02.08.2026 war das ein zweiter Schedule Job
   * (`einreihen --taeglich`). Fiel er aus, lief dieser hier trotzdem,
   * meldete „ok" und tat nichts — LINA stand acht Tage still, während
   * der Importer fehlerfrei durchlief. Ein Importer ohne Arbeit sieht
   * genauso aus wie einer, der fertig ist.
   *
   * Jetzt ein Zeitplan, ein Ausfallpunkt. `nachfuellen` wirft nie: ein
   * Fehler beim Füllen darf das Leeren nicht verhindern.
   */
  await nachfuellen()

  /**
   * ══════════════════════════════════════════════════════════════════
   * PHASE A — DIE DIENSTE, PARALLEL.
   *
   * Faustregel seit dem 24.08.2026 (Eugene): **alle separaten Dienste
   * parallelisieren.** Fünf Quellen, fünf fremde Häuser, fünf eigene
   * Limits — sie konkurrieren um nichts als um die Datenbank, und die ist
   * nicht der Engpass.
   *
   * WAS VORHER WAR, UND WARUM ES GEMESSEN FALSCH WAR. Bis heute lief nur
   * die Warteschlange parallel, und auch die nur ZWEISPURIG (LINA, FN);
   * Yext, Bounti, Wetter und Handpflege hingen als `await`-Kette dahinter.
   * Nachgemessen an Lauf 101 (24.08.2026):
   *
   *   FoodNotify-Spur   05:06:52 → 07:03:52   (1 h 57)
   *   LINA-Spur         05:06:51 → 15:14:49   (10 h 08)
   *
   * Die FoodNotify-Spur war nach zwei Stunden fertig und stand danach acht
   * Stunden still, während Yext und Bounti bis 15:15 warteten, um dann
   * zwanzig Minuten zu arbeiten. Nichts daran war eine Abhängigkeit.
   *
   * WAS DAS BRINGT — und was NICHT. Der Lauf wird dadurch **nicht kürzer**:
   * die LINA-Spur trägt 10 von 10 Stunden, davon 6 h 40 allein die
   * Belegzählung (docs/importer.md). Was sich ändert, ist zweierlei:
   *
   *   1. Bewertungen, Schulungen, Wetter und Handnoten stehen um 05:30
   *      statt um 15:30 — zehn Stunden früher.
   *   2. Sie gehen nicht mehr verloren, wenn der Import abbricht. 30 der
   *      bisher 101 Läufe stehen auf `abgebrochen`; in jedem davon liefen
   *      die vier Dienste bisher GAR NICHT, weil sie hinter dem Import
   *      standen.
   *
   * WARUM DIE WARTESCHLANGE TROTZDEM ZWEISPURIG BLEIBT. LINA-Berichte und
   * Ladenakte sind DERSELBE Dienst — gleicher Host, gleiche Sitzung,
   * gleiches Tempo (AGENTS.md Regel 3). Eine dritte Spur dafür wäre nicht
   * Parallelität, sondern doppeltes Tempo gegen einen Zugang, der uns nicht
   * gehört. Die Faustregel sagt „separate Dienste", und die Ladenakte ist
   * keiner.
   *
   * DER PREIS, EHRLICH GENANNT. Yext und Bounti gleichen ihre
   * Betriebszuordnung einmal im Monat ab, und dieser Abgleich sieht künftig
   * `core.betrieb` im Stand des LAUFBEGINNS statt nach dem Import. Ein
   * Betrieb, der in dieser Nacht ZUERST auftaucht, bekäme seine Zuordnung
   * damit erst beim nächsten Monatsabgleich. Gemessen: seit Juli 2026 ist
   * kein einziger neuer Betrieb dazugekommen, und der Fall bliebe die ganze
   * Zeit sichtbar — `mart.betrieb_ohne_yext` und `mart.bounti_ohne_betrieb`
   * führen ihn, beide hängen an `mart.pruefung_uebersicht`.
   *
   * DIE VERBINDUNGEN REICHEN. Der Pool steht auf `max: 8`; jeder Zweig hier
   * greift seine Abfragen streng nacheinander ab, hält also höchstens EINE
   * Verbindung. Zwei Worker-Spuren plus vier Dienste sind sechs. Die
   * Verbindung der Laufsperre zählt nicht mit — sie liegt bewusst außerhalb
   * des Pools (siehe `sperreHolen()` in sync/worker.ts).
   * ══════════════════════════════════════════════════════════════════
   */
  /*
   * SEIT DEM 23.09.2026 NUR NOCH DAS TAGESGESCHÄFT (Migration `0116`).
   * Die Sitzung hält Client und Laufsperre bis zum Ende von Phase C; hier
   * läuft nur Phase A — die LINA-Spur zieht Posten mit `nachladen = false`,
   * die FoodNotify-Spur alles wie bisher. Das Nachladen der Historie wartet
   * auf die Ableitungen, siehe PHASE C unten.
   */
  const importP = (async () => {
    const sitzung = await workerOeffnen(ausloeser as any)
    await sitzung.tagesgeschaeft()
    return sitzung
  })()

  /*
   * Der Fehlerbehandler wird SOFORT angehängt und nicht erst beim `await`
   * weiter unten. Bricht der Import ab, während wir noch auf die Dienste
   * warten, wäre das sonst eine unbehandelte Ablehnung — und die beendet
   * den Prozess mitten im Lauf, ohne dass `sync.lauf` je geschlossen wird.
   */
  const importErgebnis = importP.then(
    wert  => ({ status: 'erfuellt'  as const, wert }),
    grund => ({ status: 'abgelehnt' as const, grund }))

  /*
   * Die vier Dienste. Alle vier versprechen in ihrem Kopf, NIE zu werfen —
   * `allSettled` prüft dieses Versprechen, statt sich darauf zu verlassen.
   * Bricht eines doch, steht es als Fehler im Log und der Lauf geht weiter;
   * lautlos verschluckt wird nichts (Regel 10).
   */
  const dienste: Array<[string, Promise<void>]> = [
    ['yext',       yextNachlauf()],
    ['bounti',     bountiNachlauf()],
    ['wetter',     wetterNachlauf()],
    ['handpflege', pflegeNachlauf()],
  ]

  const diensteAusgang = await Promise.allSettled(dienste.map(([, p]) => p))
  for (const [i, e] of diensteAusgang.entries()) {
    if (e.status === 'rejected') {
      log.error('ein Dienst hat entgegen seiner Zusage geworfen — der Lauf geht weiter', {
        dienst: dienste[i]![0], fehler: String(e.reason).slice(0, 300),
      })
    }
  }

  const imp = await importErgebnis
  /*
   * Die Fehlersemantik des Imports bleibt EXAKT wie vorher: wirft er, wirft
   * dieser Lauf. Nur eben erst, nachdem die vier Dienste zu Ende gekommen
   * sind — ihre Arbeit ist getan und soll nicht mit verworfen werden.
   */
  if (imp.status === 'abgelehnt') throw imp.grund
  const sitzung = imp.wert

  /*
   * Ab hier gehört der Lauf dieser Datei, bis `abschliessen()` ihn schließt.
   * Die Nachläufe versprechen, nie zu werfen; tut es doch einer, wird der Lauf
   * als `fehlgeschlagen` geschlossen und die Sperre frei, statt bis zum
   * nächsten Start auf `laeuft` zu stehen.
   */
  let stumm = 0
  let r
  try {
    log.info('phase a fertig — dienste gelaufen', {
      dienste: dienste.map(([name], i) =>
        `${name}: ${diensteAusgang[i]!.status === 'fulfilled' ? 'ok' : 'FEHLER'}`).join(' · '),
    })

    /**
     * ══════════════════════════════════════════════════════════════════
     * PHASE B — DIE ABLEITUNGEN, SERIELL.
     *
     * Hier ändert sich nichts, und das ist Absicht: die Reihenfolge dieser
     * Kette ist dreimal teuer erkauft worden. Die Regel dahinter ist immer
     * dieselbe — **was eine materialisierte Sicht liest, muss vor ihrem
     * Refresh geschrieben sein.** Ein Nachlauf hinter seinem eigenen Leser
     * ist einen Tag alt, ohne dass es jemandem auffällt (14.08.2026: zwei
     * Betriebe trugen dauerhaft eine Bewertungsnote aus dem Vortag).
     *
     * Yext und die Handpflege schreiben Round-Table-Kennzahlen. Dass sie
     * jetzt in Phase A stehen, erfüllt diese Bedingung strenger als vorher:
     * sie sind fertig, BEVOR Phase B überhaupt anfängt.
     * ══════════════════════════════════════════════════════════════════
     */

    /**
     * ERSTER Nachlauf der Kette: Kostenstelle → Betrieb.
     *
     * Alle folgenden rechnen auf `betrieb_key` — die Auswahllisten, der
     * Deckungsbeitrag, der Round Table, die Einkaufssichten. Liefe die
     * Zuordnung dahinter, zeigten sie bis zum nächsten Lauf den Stand von
     * gestern; ein neu zugeordneter Betrieb wäre einen Tag lang in den Zahlen
     * und nicht in den Sichten.
     *
     * Er gehört nicht in Phase A: er ist kein Dienst, sondern eine Rechnung
     * auf dem, was FoodNotify in Phase A geladen hat.
     *
     * Wirft nie, siehe Kopf von sync/zuordnung.ts.
     */
    await zuordnungNachlauf()

    // Zweiter Nachlauf, gleiche Regeln: mart.deckungsbeitrag_warengruppe ist
    // seit Migration 0027 materialisiert und muss aufgefrischt werden, sobald
    // neue Artikelverkäufe da sind. Wirft nie, siehe Kopf von
    // sync/deckungsbeitrag.ts.
    await deckungsbeitragNachlauf()

    // Gleiche Regeln: mart.round_table_monat und mart.round_table_trend sind
    // seit Migration 0039 materialisiert. Steht direkt nach dem Import-Ende,
    // damit die Urteile auf ①–③ nie älter sind als der letzte Lauf.
    // Wirft nie, siehe Kopf von sync/round_table.ts.
    await roundTableNachlauf()

    /**
     * Die Auswahllisten der Metabase-Filter — und sie stehen seit dem
     * 20.08.2026 HINTER dem Round-Table-Refresh.
     *
     * Bis dahin liefen sie vor allem Materialisierten, mit der Begründung, die
     * Filterlisten sollten nicht auf den langen Refresh warten. Der Preis
     * dafür stand in `VORGABE_MONAT`: der voreingestellte Monat der Dashboards
     * liest `max(monat)` aus `mart.round_table_monat`, und die trug zu diesem
     * Zeitpunkt noch den Stand des Vorlaufs. Der erste Monat mit einem Urteil
     * kam damit eine Nacht zu spät in den Filter.
     *
     * Dieselbe Falle wie bei `yextNachlauf()` und der Handpflege weiter oben,
     * nur andersherum: dort stand der SCHREIBER hinter der Materialisierung,
     * hier der LESER davor.
     *
     * Der Preis der neuen Reihenfolge, ehrlich genannt: stirbt der Prozess
     * zwischen Import und Refresh, bleiben die Filterlisten eine Nacht stehen.
     * Das fällt auf — die Prüfung „dashboard_filter“ in src/status.ts vergleicht
     * die Liste mit mart.betrieb. Ein stillschweigend falscher Vorgabemonat
     * fiel nicht auf.
     *
     * Wirft nie, siehe Kopf von sync/auswahllisten.ts.
     */
    await auswahllistenNachlauf()

    /*
     * HIER STAND `wetterNachlauf()` — seit dem 24.08.2026 in Phase A.
     *
     * Der Kopf von wetter/nachlauf.ts sagt es selbst: „REIHENFOLGE: keine."
     * Die frühere Begründung (die Materialisierung lese über
     * mart.betrieb_wetter_tag mit) war am 20.08.2026 in pg_depend widerlegt
     * worden: mart.vergleichstag_basis liest ausschließlich
     * mart.betrieb_kalender und mart.umsatz_tag.
     *
     * Bright Sky ist ein eigener Dienst mit eigenem Tempo und teilt sich mit
     * niemandem hier ein Limit — es gab keinen Grund, ihn neun Stunden warten
     * zu lassen.
     *
     * SEIT DEM 21.09.2026 FRISCHT DER WETTER-NACHLAUF AUCH AUF. Hier stand
     * bis dahin, die Wetterspalten seien „live" — das war richtig und teuer:
     * mart.wetter_tag gruppierte bei jeder Abfrage alle 3,42 Mio. Zeilen von
     * manual.wetter_stunde nach core.geschaeftstag(zeitpunkt), und ein
     * Funktionswert als Gruppenschlüssel nimmt keinen Index an. Gemessen in
     * Produktion am 21.09.2026: mart.betrieb_wetter_tag braucht für EINEN Tag
     * 7,4 s und für ein Jahr ebenfalls 7,4 s, mart.vergleichstag_basis für ein
     * Jahr 0,08 s. Migration 0111 legt mart.wetter_tag_basis an; aufgefrischt
     * wird am Ende von wetterNachlauf(), weil nur diese Funktion
     * manual.wetter_stunde schreibt.
     *
     * Dass der Refresh damit in Phase A neben drei anderen Diensten läuft, ist
     * der Grund für CONCURRENTLY — ein sperrender Refresh hielte jede Karte
     * mit Wetterspalten für seine Dauer an. Die Reihenfolge-Aussage oben bleibt
     * unberührt: mart.vergleichstag_basis liest kein Wetter, und die
     * Wetterspalten hängen weiter in der gewöhnlichen Sicht
     * mart.vergleichstag darüber.
     */

    /**
     * Und der Vergleichstag, aus demselben Grund: mart.vergleichstag_basis ist
     * seit Migration 0084 materialisiert. Steht NACH pflegeNachlauf() weiter
     * oben — der schreibt die Feiertage, aus denen die Sicht liest. Andersherum
     * trüge die Materialisierung den Kalenderstand vom Vortag; dieselbe Falle,
     * die yextNachlauf() bis zum 14.08.2026 hatte.
     *
     * Gemessen 35 s über 188.640 Zeilen (20.08.2026), neben den zwei Minuten
     * des Artikel-Refresh unauffällig.
     * Wirft nie, siehe Kopf von sync/vergleichstag.ts.
     */
    await vergleichstagNachlauf()

    /**
     * Dritter Nachlauf: die Einkaufspreise gegen die Verteilung derselben
     * Ware prüfen. Steht NACH dem Import, weil die Vergleichszeilen beim
     * Laden einer einzelnen Position noch fehlen — eine Fehlbuchung ist in
     * sich stimmig und nur neben ihresgleichen widerlegbar.
     * Wirft nie, siehe Kopf von sync/einkaufspreis.ts.
     */
    await einkaufspreisNachlauf()

    /**
     * Und direkt danach die Einkaufssichten auffrischen — in dieser
     * Reihenfolge, nicht davor: der Nachlauf darüber schreibt
     * preis_je_einheit und menge_unstimmig neu, und beides steckt in
     * mart.einkaufspreis_betrieb_basis. Andersherum zeigten die Karten bis
     * zum nächsten Lauf den Stand vor der Korrektur.
     * Wirft nie, siehe Kopf von sync/einkauf_sichten.ts.
     */
    await einkaufSichtenNachlauf()

    /**
     * Und die Pflichtartikelauswertung gleich hinterher (Migration `0094`):
     * welcher Anteil des Einkaufs läuft an der Sortimentsvorgabe vorbei.
     *
     * HIER UND NICHT WEITER OBEN. Die Listen selbst kommen aus `pflege/` und
     * werden von `pflegeNachlauf()` eingelesen; die Bestellpositionen, gegen
     * die geprüft wird, kommen aus dem Import darüber. Beides muss stehen —
     * ein Refresh davor trüge den Listenstand von gestern, und eine gerade
     * bestätigte Nachfolgenummer wirkte einen Lauf lang nicht.
     * Wirft nie, siehe Kopf von sync/pflichtartikel_sichten.ts.
     */
    await pflichtartikelSichtenNachlauf()

    /**
     * ZULETZT, UND ERST HIER: bekommt jede Quelle noch Zulauf?
     *
     * Die Regel aus AGENTS.md 10 — eine Quelle ohne Zulauf ist ein Fehler, kein
     * Normalzustand, und der Lauf darf sie nicht als „ok" melden. Bis hierher
     * konnte er nichts anderes: `sync.lauf.status` kannte genau eine Frage, und
     * das war „sind Aufgaben gescheitert?". Eine Quelle, die niemand mehr
     * abfragt, erzeugt keine gescheiterte Aufgabe — sie erzeugt gar keine.
     *
     * NACH allen Nachläufen, nicht davor. Die vier Yext-Quellen werden von
     * `yextNachlauf()` gefüllt; eine Prüfung davor meldete sie in jedem Lauf als
     * stumm, und ein Alarm, der immer schlägt, ist keiner.
     *
     * Wirft nie, siehe Kopf von sync/zulauf.ts.
     */
    stumm = await zulaufPruefen(sitzung.laufId)

    /*
     * ENDE VON PHASE B, GESTEMPELT: `sync.lauf.ableitungen_bis`. Ab hier zeigen
     * die Dashboards den Vortag — das ist die Zahl, auf die es morgens ankommt,
     * und `mart.sync_status` führt sie. Das Laufende (`beendet_am`) liegt im
     * Backfill viele Stunden später.
     */
    await sitzung.ableitungenFertig()

    /**
     * ══════════════════════════════════════════════════════════════════
     * PHASE C — DAS NACHLADEN (seit dem 23.09.2026, Migration `0116`).
     *
     * Eugenes Entscheidung, wörtlich: „Erst Tagesgeschäft, dann nachladen —
     * Der Lauf holt zuerst die Tagesdaten und frischt die Auswertungen morgens
     * auf. Danach lädt er die Historie bis zum Tagesbudget nach."
     *
     * WAS VORHER WAR. Die Betriebsberichte (0113) luden mit dem Budget, das
     * nach dem Tagesgeschäft übrig blieb, und zwar VERSCHRÄNKT mit den übrigen
     * LINA-Posten — richtig für LINA (E8), aber in derselben Phase A. Bei
     * ~5,3 s je Aufruf füllt eine Nacht das Tagesbudget in rund 15,5 Stunden,
     * und Phase B kam erst gegen 20:30: die Dashboards hätten den ganzen Tag
     * den Vortag gezeigt.
     *
     * WAS JETZT GILT. Nur die LINA-Spur, derselbe Client, derselbe Takt
     * (harte Regel 3), dasselbe Tagesbudget — Phase A hat es zuerst bekommen.
     * Verschränkt wird weiter (Betriebsbericht-Historie ↔ Konzern-Historie).
     * Was „Nachladen" ist, steht am Posten (`sync.warteschlange.nachladen`),
     * nicht an der Uhr.
     *
     * DANACH FRISCHEN WIR NUR AUF, WAS PHASE C BERÜHRT HAT. Gemessen über
     * pg_depend (23.09.2026): keine materialisierte Sicht liest aus einer
     * Betriebsbericht-Tabelle. Die Konzern-Historie schreibt dagegen
     * `core.umsatzbericht_tag` und `core.artikelverkauf_tag`, und daraus lesen
     * Deckungsbeitrag, Round Table (samt Artikel- und Artikeltage-Basis) und
     * Vergleichstag. Nur wenn Phase C davon etwas geladen hat, laufen diese
     * drei noch einmal — sonst kosteten sie zehn Minuten für nichts. Einkauf,
     * Pflichtartikel und Wetter lesen nichts, was Phase C schreibt; die
     * Auswahllisten hängen am jüngsten Monat, und den ändert keine Historie.
     * ══════════════════════════════════════════════════════════════════
     */
    const c = await sitzung.nachladen()
    if (c.konzernOk > 0) {
      log.info('phase c hat konzern-historie geladen — die sichten darauf werden aufgefrischt', {
        konzernOk: c.konzernOk,
      })
      await deckungsbeitragNachlauf()
      await roundTableNachlauf()
      await vergleichstagNachlauf()
    }

    r = await sitzung.abschliessen({ stummeQuellen: stumm })
  } catch (e) {
    await sitzung.abschliessen({ fehler: e }).catch(() => {})
    throw e
  }

  await pool.end().catch(() => {})
  // Exitcode 1 nur bei Abbruch - 'teilweise' ist normal (einzelne Betriebe ohne Daten).
  process.exit(r.status === 'abgebrochen' ? 1 : 0)
} catch (e) {
  log.error('lauf abgebrochen', { fehler: String(e) })
  await pool.end().catch(() => {})
  process.exit(1)
}
