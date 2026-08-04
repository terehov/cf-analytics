/**
 * Holt die Online-Bewertungen — als Nachlauf jedes Sync-Laufs, hoechstens
 * einmal am Tag.
 *
 * WARUM DAS HIER STEHT UND NICHT IN EINEM EIGENEN ZEITPLAN
 *
 * Dieselbe Ueberlegung wie bei den Auswahllisten und dem Deckungsbeitrag
 * nebenan — und diesmal eine, die schon Geld gekostet hat. Bis zum 02.08.2026
 * war das Einreihen ein zweiter Schedule Job. Er fiel aus, der Sync-Lauf lief
 * trotzdem, meldete „ok" und tat nichts: LINA stand acht Tage still, waehrend
 * der Importer fehlerfrei durchlief. **Ein Importer ohne Arbeit sieht genauso
 * aus wie einer, der fertig ist.**
 *
 * Ein eigener Zeitplan fuer Yext waere genau dieselbe Falle noch einmal.
 * Hier angehaengt passiert es von selbst, und es gibt weiterhin einen
 * Ausfallpunkt statt zwei.
 *
 * DIE DREI REGELN, WIE NEBENAN
 *
 *   1. Das hier darf einen Sync-Lauf NIEMALS scheitern lassen. Der Import aus
 *      LINA und FoodNotify ist die Arbeit; eine fehlende Bewertung bedeutet
 *      eine graue Ampel, kein verlorenes Datum. Diese Funktion faengt alles
 *      und wirft nie.
 *   2. Sie laeuft NACH dem Import.
 *   3. Sie laeuft HOECHSTENS EINMAL AM TAG. Der Sync-Lauf ist stuendlich; ein
 *      stuendlicher Yext-Lauf waere 24-mal dieselbe Antwort. Bewertungen
 *      tropfen ueber Wochen ein, kein Gast schreibt zur vollen Stunde.
 *
 * Was geholt wird, sind drei Monate (der laufende, der Vormonat und einer als
 * Reserve). Aeltere Staende sind kumuliert und aendern sich nicht mehr — dafuer
 * gibt es `bun run yext --voll`, das die ganze Reihe geradezieht.
 */
import { log } from '../lib/log'
import { query } from '../db/pool'
import { yextKonfiguriert } from './client'
import { staendeLaden, bewertungenLaden, kennzahlFuellen, laufMerken } from './laden'

/** Drei Monate: der laufende, der Vormonat (Portale liefern verzoegert), einer Reserve. */
const MONATE = 3

/** Nach so vielen Stunden ist ein neuer Lauf faellig. 20 statt 24, damit er */
/** nicht taeglich eine Stunde spaeter rutscht und irgendwann ganz ausfaellt. */
const ABSTAND_STUNDEN = 20

export async function yextNachlauf(): Promise<void> {
  try {
    if (!yextKonfiguriert()) {
      // Kein Fehler: Yext ist optional, und wer keinen Schluessel hat, soll
      // keinen Fehler im Log finden, der keiner ist.
      log.debug('yext-nachlauf uebersprungen — kein YEXT_API_KEY')
      return
    }

    const r = await query<{ faellig: boolean; zuletzt: string | null }>(
      `SELECT coalesce(
                (wert->>'beendet_am')::timestamptz < now() - ($1 || ' hours')::interval,
                true) AS faellig,
              wert->>'beendet_am' AS zuletzt
         FROM sync.merker WHERE schluessel = 'yext_letzter_lauf'`, [ABSTAND_STUNDEN])

    // Keine Zeile = noch nie gelaufen = faellig.
    const zeile = r[0]
    if (zeile && !zeile.faellig) {
      log.debug('yext-nachlauf noch nicht faellig', { zuletzt: zeile.zuletzt })
      return
    }

    const erg = await staendeLaden({ monateAnzahl: MONATE })
    const kennzahl = erg.betriebe > 0 ? await kennzahlFuellen() : 0

    // Die einzelnen Bewertungen hinterher und inkrementell: sie sind die
    // Begruendung zur Kennzahl, nicht die Kennzahl. Ein Fehler hier soll
    // den schon eingetragenen Stand nicht entwerten -- deshalb danach.
    const texte = await bewertungenLaden()
    erg.aufrufe += texte.aufrufe
    erg.fehler.push(...texte.fehler)

    await laufMerken(erg, kennzahl, 'GOOGLEMYBUSINESS')

    log.info('yext-nachlauf fertig', {
      betriebe: erg.betriebe, aufrufe: erg.aufrufe,
      kennzahlZeilen: kennzahl, fehler: erg.fehler.length,
    })
  } catch (e) {
    // Regel 1. Ein Standort ohne Antwort, ein abgelaufener Schluessel, ein
    // Netzhaenger — nichts davon darf den Import mitnehmen.
    log.warn('yext-nachlauf fehlgeschlagen — der Sync-Lauf bleibt davon unberuehrt',
      { fehler: String((e as Error).message ?? e).slice(0, 300) })
  }
}
