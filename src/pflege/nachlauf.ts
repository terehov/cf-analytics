/**
 * Die Handpflege als Nachlauf — Plan Phase 6.
 *
 * ZWEI DINGE, EINE STELLE:
 *   1. die Dateien aus `pflege/` einlesen (bei jedem Lauf, sie sind billig),
 *   2. Feiertage und Schulferien nachziehen (einmal im Monat, sie kosten
 *      60 fremde Aufrufe).
 *
 * WARUM VOR DEM ROUND TABLE. `manual.om_einschaetzung` ist eine der sechs
 * Kennzahlen des Round Table, und `mart.round_table_monat` ist seit Migration
 * `0039` materialisiert. Käme die Pflege danach, trüge die Ampel die Note vom
 * Vortag — genau der Fehler, den `yextNachlauf()` bis zum 14.08.2026 hatte.
 *
 * WIRFT NIE. Dieselbe Regel wie bei allen Nachläufen: eine fehlende Handnote
 * ist eine graue Ampel, kein verlorenes Datum. Der Import aus LINA und
 * FoodNotify ist die Arbeit.
 */
import { log } from '../lib/log'
import { query } from '../db/pool'
import { pflegeEinlesen } from './tabellen'
import { kalenderNachziehen, kalenderFaellig } from './kalender'

export async function pflegeNachlauf(): Promise<void> {
  try {
    const berichte = await pflegeEinlesen()
    const abgewiesen = berichte.filter(b => b.fehler)
    if (berichte.length > 0) {
      log.info('handpflege eingelesen', {
        dateien: berichte.length,
        geschrieben: berichte.reduce((s, b) => s + b.geschrieben, 0),
        abgewiesen: abgewiesen.length,
        sicht: 'mart.pflege_stand',
      })
    }
  } catch (e) {
    log.error('handpflege gescheitert — der Lauf geht weiter',
      { fehler: String(e).slice(0, 300) })
  }

  try {
    if (!await kalenderFaellig()) return
    const k = await kalenderNachziehen()
    /*
     * Der Merker wird auch bei TEILWEISEM Erfolg gesetzt: sonst liefen die
     * geglueckten Laender jede Nacht erneut, um dem einen zu folgen, das
     * nicht antwortet. Die Fehler stehen im Log und die Reichweite in
     * `mart.pflege_stand` — dort faellt ein Land auf, das zurueckbleibt.
     */
    if (k.fehler.length < 2) {
      await query(
        `INSERT INTO sync.merker (schluessel, wert)
         VALUES ('kalender_nachgezogen', jsonb_build_object('am', now()))
         ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert, gesetzt_am = now()`)
    }
    /*
     * FEHLER GEHEN ALS FEHLER RAUS. Bis zum 20.08.2026 stand hier ein
     * `log.info('kalender nachgezogen', { … fehler: [20 Eintraege] })` — und
     * genau so las es sich auch: wie ein geglueckter Lauf. Dass keine einzige
     * Zeile geschrieben wurde, weil die Schnittstelle jede Anfrage mit HTTP
     * 400 abwies, stand in einem Feld, auf das niemand sieht.
     */
    if (k.fehler.length > 0) {
      log.error('kalender nur teilweise nachgezogen', {
        feiertage: k.feiertage, ferien: k.ferien, fehler: k.fehler,
      })
    } else {
      log.info('kalender nachgezogen', { feiertage: k.feiertage, ferien: k.ferien })
    }
  } catch (e) {
    log.error('kalender nicht nachgezogen — der Lauf geht weiter',
      { fehler: String(e).slice(0, 300) })
  }
}
