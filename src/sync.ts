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
import { auswahllistenNachlauf } from './sync/auswahllisten'
import { deckungsbeitragNachlauf } from './sync/deckungsbeitrag'
import { einkaufspreisNachlauf } from './sync/einkaufspreis'

const ausloeser = process.argv.includes('--backfill') ? 'backfill'
                : process.argv.includes('--manuell')  ? 'manuell'
                : 'zeitplan'

log.info('start', konfigZumLoggen())

// Der Pool gehört dem Prozess, nicht dem Lauf — deshalb wird er hier
// geschlossen und nicht in workerLauf. Sonst liesse sich der Worker pro
// Prozess nur genau einmal aufrufen.
try {
  const r = await workerLauf(ausloeser as any)

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

  /**
   * Dritter Nachlauf: die Einkaufspreise gegen die Verteilung derselben
   * Ware prüfen. Steht NACH dem Import, weil die Vergleichszeilen beim
   * Laden einer einzelnen Position noch fehlen — eine Fehlbuchung ist in
   * sich stimmig und nur neben ihresgleichen widerlegbar.
   * Wirft nie, siehe Kopf von sync/einkaufspreis.ts.
   */
  await einkaufspreisNachlauf()

  await pool.end().catch(() => {})
  // Exitcode 1 nur bei Abbruch - 'teilweise' ist normal (einzelne Betriebe ohne Daten).
  process.exit(r.status === 'abgebrochen' ? 1 : 0)
} catch (e) {
  log.error('lauf abgebrochen', { fehler: String(e) })
  await pool.end().catch(() => {})
  process.exit(1)
}
