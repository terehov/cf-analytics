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
import { einkaufspreisNachlauf } from './sync/einkaufspreis'
import { einkaufSichtenNachlauf } from './sync/einkauf_sichten'
import { zuordnungNachlauf } from './sync/zuordnung'
import { yextNachlauf } from './yext/nachlauf'
import { zulaufPruefen } from './sync/zulauf'

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
   * Dieselbe Falle wie bei `yextNachlauf()`, der bis heute NACH dem
   * Round-Table-Refresh läuft und deshalb zwei Betrieben eine veraltete Note
   * in die Ampel schreibt (Punkt 5.3 des Plans).
   *
   * Wirft nie, siehe Kopf von sync/zuordnung.ts.
   */
  await zuordnungNachlauf()

  // Nachlauf: die Auswahllisten der Metabase-Filter aktuell halten. Steht
  // bewusst NACH dem Import und kann ihn nicht scheitern lassen — die
  // Funktion wirft nie, siehe Kopf von sync/auswahllisten.ts. Hier
  // angehängt, damit ein neuer Betrieb ohne Zutun im Filter auftaucht,
  // statt auf einen eigenen Zeitplan zu warten, den jemand einrichten muss.
  await auswahllistenNachlauf()

  // Zweiter Nachlauf, gleiche Regeln: mart.deckungsbeitrag_warengruppe ist
  // seit Migration 0027 materialisiert und muss aufgefrischt werden, sobald
  // neue Artikelverkäufe da sind. Wirft nie, siehe Kopf von
  // sync/deckungsbeitrag.ts. Steht NACH den Auswahllisten, weil der Refresh
  // der längere von beiden ist — die Filterlisten sollen nicht darauf warten.
  await deckungsbeitragNachlauf()

  // Gleiche Regeln: mart.round_table_monat und mart.round_table_trend sind
  // seit Migration 0039 materialisiert. Steht direkt nach dem Import-Ende,
  // damit die Urteile auf ①–③ nie älter sind als der letzte Lauf.
  // Wirft nie, siehe Kopf von sync/round_table.ts.
  await roundTableNachlauf()

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

  // Vierter Nachlauf: die Online-Bewertungen aus Yext. Anders als die beiden
  // darüber hängt er nicht am Importergebnis, sondern an der Uhr — er läuft
  // höchstens einmal am Tag und prüft das selbst. Hier angehängt aus demselben
  // Grund wie nebenan, und aus einem eigenen: ein zweiter Zeitplan hat am
  // 02.08.2026 LINA acht Tage stillstehen lassen, ohne dass es auffiel.
  // Wirft nie, siehe Kopf von yext/nachlauf.ts.
  await yextNachlauf()

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
