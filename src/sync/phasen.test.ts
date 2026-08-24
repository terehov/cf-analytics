/**
 * Die zwei Phasen von sync.ts — und dass die Grenze zwischen ihnen hält.
 *
 * ANLASS (24.08.2026). Bis dahin war sync.ts eine Kette von `await`s: erst
 * der Import, dann Yext, Handpflege, Bounti, dann alles Materialisierte.
 * Nachgemessen an Lauf 101 stand die FoodNotify-Spur nach zwei Stunden still,
 * während Yext und Bounti weitere acht Stunden warteten, um dann zwanzig
 * Minuten zu arbeiten. Seitdem gilt die Faustregel: **alle separaten Dienste
 * parallelisieren.**
 *
 * DIESER TEST SCHÜTZT DIE BEIDEN ZUSAGEN, DIE DABEI TEUER WERDEN KÖNNTEN:
 *
 *   1. **Kein Dienst fällt heraus.** Genau so stand LINA am 02.08.2026 acht
 *      Tage still: das Einreihen war ein zweiter Zeitplan, fiel aus, und der
 *      Sync-Lauf meldete weiter „ok". Ein Dienst, der aus sync.ts
 *      verschwindet, hinterlässt keine Fehlermeldung — er hinterlässt gar
 *      nichts. Für Yext gab es diesen Wächter seit dem 14.08.2026, für
 *      Wetter, Handpflege und Bounti nicht.
 *
 *   2. **Phase A ist vollständig abgewartet, bevor Phase B beginnt.** Das ist
 *      die Bedingung, an der die ganze Parallelisierung hängt: Yext und die
 *      Handpflege schreiben Round-Table-Kennzahlen, und
 *      `mart.round_table_monat` ist seit Migration 0039 materialisiert. Liefe
 *      der Refresh los, während die beiden noch schreiben, trüge die Ampel
 *      die Note vom Vortag — derselbe Fehler wie am 14.08.2026, nur diesmal
 *      als Wettlauf statt als Reihenfolge, also nicht einmal verlässlich
 *      reproduzierbar.
 *
 * Geprüft wird am QUELLTEXT und nicht am Verhalten. Das ist grob, aber es ist
 * die einzige Ebene, auf der „ein Aufruf fehlt" überhaupt sichtbar ist: ein
 * Verhaltenstest ohne den Aufruf ist grün, weil nichts passiert.
 */

import { describe, expect, test } from 'bun:test'

const sync = await Bun.file(`${import.meta.dir}/../sync.ts`).text()

/** Der Punkt, an dem Phase A vollständig eingesammelt ist. */
const SAMMELPUNKT = 'await Promise.allSettled(dienste'

/** Die Dienste, die nebeneinander laufen. Name in der Liste → Funktion. */
const DIENSTE: Array<[string, string]> = [
  ['yext', 'yextNachlauf'],
  ['bounti', 'bountiNachlauf'],
  ['wetter', 'wetterNachlauf'],
  ['handpflege', 'pflegeNachlauf'],
]

/**
 * Phase B: alles, was auf dem rechnet, was Phase A geladen hat. Jede dieser
 * Funktionen MUSS hinter dem Sammelpunkt stehen.
 */
const PHASE_B = [
  'zuordnungNachlauf',
  'deckungsbeitragNachlauf',
  'roundTableNachlauf',
  'auswahllistenNachlauf',
  'vergleichstagNachlauf',
  'einkaufspreisNachlauf',
  'einkaufSichtenNachlauf',
  'pflichtartikelSichtenNachlauf',
  'zulaufPruefen',
]

describe('sync.ts — Phase A und Phase B', () => {
  test('der Sammelpunkt existiert', () => {
    // Ohne ihn gäbe es keine Grenze, und alle Prüfungen darunter wären
    // wertlos — deshalb zuerst und einzeln.
    expect(sync.indexOf(SAMMELPUNKT)).toBeGreaterThan(0)
  })

  test('alle vier Dienste stehen in der Liste der Phase A', () => {
    const fehlt = DIENSTE.filter(([name, fn]) =>
      !new RegExp(`\\['${name}',\\s*${fn}\\(\\)\\]`).test(sync))
    expect(fehlt.map(([n]) => n)).toEqual([])
  })

  test('der Import läuft neben den Diensten, nicht davor', () => {
    const start = sync.indexOf('const importP = workerLauf(')
    expect(start).toBeGreaterThan(0)
    // Gestartet VOR dem Sammelpunkt — sonst wäre er wieder in Reihe.
    expect(start).toBeLessThan(sync.indexOf(SAMMELPUNKT))
    /*
     * Und sein Fehler wird sofort aufgefangen. Ohne diesen `then` wäre eine
     * Ablehnung des Imports eine unbehandelte Zusage, solange wir noch auf
     * die Dienste warten — Bun beendet den Prozess dann mitten im Lauf, und
     * `sync.lauf` bliebe für immer offen.
     */
    const auffangen = sync.indexOf('const importErgebnis = importP.then(')
    expect(auffangen).toBeGreaterThan(start)
    expect(auffangen).toBeLessThan(sync.indexOf(SAMMELPUNKT))
  })

  test('der Import wirft weiterhin den Lauf ab, nur später', () => {
    // Die Fehlersemantik darf sich durch die Parallelisierung NICHT ändern:
    // scheitert der Import, scheitert der Lauf.
    expect(sync).toContain("if (imp.status === 'abgelehnt') throw imp.grund")
  })

  test('jede Ableitung steht hinter dem Sammelpunkt', () => {
    const grenze = sync.indexOf(SAMMELPUNKT)
    const davor = PHASE_B.filter(fn => {
      const i = sync.indexOf(`await ${fn}(`)
      return i > 0 && i < grenze
    })
    expect(davor).toEqual([])
  })

  test('jede Ableitung wird überhaupt aufgerufen', () => {
    // Dieselbe Falle wie bei den Diensten, nur auf der anderen Seite der
    // Grenze: ein Refresh, der herausfällt, lässt eine materialisierte Sicht
    // einfrieren — und eine eingefrorene Sicht sieht aus wie eine gepflegte.
    const fehlt = PHASE_B.filter(fn => !sync.includes(`await ${fn}(`))
    expect(fehlt).toEqual([])
  })
})
