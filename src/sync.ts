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
import { workerLauf } from './sync/worker'
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

  const r = await workerLauf(ausloeser as any)

  /**
   * ERSTER Nachlauf, und er muss der erste sein: Kostenstelle → Betrieb.
   *
   * Alle folgenden Nachläufe rechnen auf `betrieb_key` — die Auswahllisten,
   * der Deckungsbeitrag, der Round Table, die Einkaufssichten. Liefe die
   * Zuordnung dahinter, zeigten sie bis zum nächsten Lauf den Stand von
   * gestern; ein neu zugeordneter Betrieb wäre einen Tag lang in den Zahlen
   * und nicht in den Sichten.
   *
   * Dieselbe Falle hatte `yextNachlauf()` — er lief bis zum 14.08.2026 NACH
   * dem Round-Table-Refresh und schrieb deshalb zwei Betrieben eine veraltete
   * Note in die Ampel (Punkt 5.3 des Plans). Seitdem steht er direkt darunter.
   *
   * Wirft nie, siehe Kopf von sync/zuordnung.ts.
   */
  await zuordnungNachlauf()

  /**
   * ZWEITER Nachlauf, und seit dem 14.08.2026 VOR dem Round Table (Punkt 5.3).
   *
   * Er hing bis dahin ganz am Ende, hinter dem Round-Table-Refresh — und
   * `mart.round_table_monat` ist seit Migration `0039` materialisiert. Zwei
   * Betriebe trugen deshalb dauerhaft eine Bewertungsnote aus dem VORTAG in
   * der Ampel: die Note kam an, die Sicht war schon aufgefrischt.
   *
   * Dieselbe Falle wie bei `zuordnungNachlauf()` darüber, und dieselbe
   * Antwort: was eine materialisierte Sicht liest, muss vor ihrem Refresh
   * geschrieben sein. Ein Nachlauf, der hinter seinem eigenen Leser steht,
   * ist einen Tag alt, ohne dass es jemandem auffällt.
   *
   * Anders als die übrigen hängt er nicht am Importergebnis, sondern an der
   * Uhr — er läuft höchstens einmal am Tag und prüft das selbst. Einmal im
   * Monat zieht er dabei die ganze Reihe gerade (25 Monate) und gleicht die
   * Zuordnung der Betriebe ab; beides war bis zum 14.08.2026 Handarbeit.
   *
   * Wirft nie, siehe Kopf von yext/nachlauf.ts.
   */
  await yextNachlauf()

  /**
   * DRITTER Nachlauf, und ebenfalls VOR allem Materialisierten: die
   * Handpflege. Er liest die Dateien aus `pflege/` ein und zieht einmal im
   * Monat Feiertage und Schulferien nach.
   *
   * `manual.om_einschaetzung` ist eine der sechs Round-Table-Kennzahlen, und
   * `mart.round_table_monat` ist seit Migration `0039` materialisiert — käme
   * die Pflege danach, trüge die Ampel die Note vom Vortag. Dieselbe Falle
   * wie bei Yext darüber.
   *
   * Wirft nie, siehe Kopf von pflege/nachlauf.ts.
   */
  await pflegeNachlauf()

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

  /**
   * Das Wetter. Es steht vor dem Vergleichstag, aber es MUSS nicht dort
   * stehen — die Begründung dafür war bis zum 20.08.2026 falsch.
   *
   * Behauptet wurde, die Materialisierung lese über mart.betrieb_wetter_tag
   * mit. Sie tut es nicht: mart.vergleichstag_basis liest ausschließlich
   * mart.betrieb_kalender und mart.umsatz_tag (in pg_depend nachgesehen).
   * Die Wetterspalten hängen in der dünnen Hülle mart.vergleichstag darüber,
   * seit Migration 0086 — und die ist eine gewöhnliche Sicht. Das Wetter ist
   * damit live und kann gar nicht veralten.
   *
   * Rollierendes Fenster über 14 Tage (48 Aufrufe) plus Backfill mit
   * Obergrenze (WETTER_BACKFILL_JE_LAUF, Vorgabe 60). Kein Handbefehl.
   * Wirft nie, siehe Kopf von wetter/nachlauf.ts.
   */
  await wetterNachlauf()

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
  await zulaufPruefen(r.laufId)

  await pool.end().catch(() => {})
  // Exitcode 1 nur bei Abbruch - 'teilweise' ist normal (einzelne Betriebe ohne Daten).
  process.exit(r.status === 'abgebrochen' ? 1 : 0)
} catch (e) {
  log.error('lauf abgebrochen', { fehler: String(e) })
  await pool.end().catch(() => {})
  process.exit(1)
}
