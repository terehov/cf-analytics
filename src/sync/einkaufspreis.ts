/**
 * Prüft die Einkaufspreise gegen die Verteilung derselben Ware — als
 * Nachlauf jedes Sync-Laufs.
 *
 * WARUM DAS NICHT BEIM LADEN PASSIEREN KANN
 *
 * Beim Laden einer einzelnen Position ist nur diese Position bekannt. Die
 * Zeile "Idee Entkoffeiniert 50 Pouches à 7G, 16,94 € auf 0,00035 kg" ist
 * IN SICH stimmig: 1 × 1 × 0,00035 = 0,00035. Die Rechnung geht auf, die
 * Stammdaten sind falsch. Widerlegbar wird sie erst NEBEN den 37,91 €/kg
 * derselben Ware unter einer anderen Warennummer — und die kommt im
 * Backfill vielleicht erst Stunden später.
 *
 * Deshalb hier: nach dem Lauf, über alles, was inzwischen da ist.
 *
 * WAS GEPRÜFT WIRD
 *
 * `core.gebinde_vereinheitlichen()` setzt die Gesamtmenge auf die
 * häufigste Gebindeangabe derselben Ware um (Migration 0040).
 * `core.preis_ausreisser_markieren()` entzieht den Preis je Einheit dort,
 * wo er den Median derselben Ware um mehr als das Zwanzigfache über- oder
 * unterschreitet.
 *
 * Beide sind idempotent: ein zweiter Lauf ohne neue Daten ändert nichts.
 *
 * WIRFT NIE. Dieselbe Regel wie bei den Nachbarn: ein Fehler in der
 * Nachbereitung darf einen erfolgreichen Import nicht als gescheitert
 * dastehen lassen. Die Preise sind dann eben bis zum nächsten Lauf
 * ungeprüft — die Positionen selbst stehen vollständig in `core`.
 */

import { eine } from '../db/pool'
import { log } from '../lib/log'

export async function einkaufspreisNachlauf(): Promise<void> {
  try {
    const g = await eine<{ n: number }>(
      `SELECT core.gebinde_vereinheitlichen() AS n`)
    const a = await eine<{ n: number }>(
      `SELECT core.preis_ausreisser_markieren() AS n`)

    const vereinheitlicht = Number(g?.n ?? 0)
    const markiert = Number(a?.n ?? 0)

    // Nur melden, wenn etwas passiert ist — sonst steht in jedem Log
    // eine Zeile, die nichts sagt.
    if (vereinheitlicht > 0 || markiert > 0) {
      log.info('einkaufspreise geprüft', {
        gebindeVereinheitlicht: vereinheitlicht,
        ausreisserMarkiert: markiert,
        hinweis: 'die markierten Positionen stehen in mart.einkauf_pruefung',
      })
    }
  } catch (e) {
    log.error('einkaufspreis-nachlauf gescheitert — der Import bleibt gültig',
      { fehler: String(e).slice(0, 300) })
  }
}
