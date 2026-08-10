/**
 * Haengt JEDE Yext-Ladefunktion am automatischen Lauf?
 *
 * DER FEHLER, DEN DIESER TEST FAENGT, IST PASSIERT — am 10.08.2026.
 *
 * Mit Migration `0050` kam der Analytics-Import dazu: Themen, Antwortverhalten,
 * Notenverteilung, Sichtbarkeit. `analyticsLaden` wurde in `src/yext.ts`
 * eingehaengt, dem Befehl von Hand — und nirgends sonst. Der Nachlauf, den
 * jeder Sync-Lauf ausfuehrt, kannte die Funktion nicht.
 *
 * Nachgemessen auf der Produktivdatenbank: `core.bewertung` fuehrte 174.115
 * Zeilen und wuchs taeglich, `core.bewertung_thema`, `core.bewertung_antwort`
 * und `core.bewertung_note` standen auf **null**. Nichts hat sich gemeldet.
 * Der Importer lief sauber, die Bewertungen waren aktuell, und die Haelfte des
 * neuen Imports existierte einfach nicht.
 *
 * Waere sie einmal von Hand geladen worden, waere es schlimmer gewesen: dann
 * haetten die Karten Zahlen gezeigt und diese Zahlen behalten, waehrend die
 * Bewertungen daneben weiterliefen. **Ein eingefrorener Wert sieht aus wie ein
 * gepflegter.**
 *
 * WARUM EIN STATISCHER TEST UND KEIN AUFRUFTEST. Ein Test, der `yextNachlauf`
 * wirklich ausfuehrt, braucht Datenbank, Yext-Attrappe und einen gesetzten
 * Faelligkeitsmerker — drei Dinge, die selbst ausfallen koennen, und dann sagt
 * ein grauer Test nichts ueber die Verdrahtung. Diese Pruefung liest die
 * Quelltexte und stellt eine Frage, die keine Umgebung braucht: gibt es eine
 * exportierte Ladefunktion, die der Nachlauf nicht erwaehnt?
 *
 * Wer eine neue `*Laden`- oder `*Fuellen`-Funktion exportiert, wird hier
 * gestoppt, bis sie am automatischen Lauf haengt — oder bis jemand sie
 * ausdruecklich in AUSDRUECKLICH_NUR_VON_HAND eintraegt.
 */

import { expect, test, describe } from 'bun:test'

/** Dateien, die Yext-Daten schreiben. */
const QUELLEN = ['laden.ts', 'analytics.ts']

/**
 * Ladefunktionen, die BEWUSST nicht am Nachlauf haengen.
 *
 * Leer, und das soll so bleiben. Ein Eintrag hier braucht einen fachlichen
 * Grund — "kostet zu viele Aufrufe" ist keiner, dafuer gibt es Fenstergroessen
 * und Faelligkeitsabstaende.
 */
const AUSDRUECKLICH_NUR_VON_HAND: Record<string, string> = {}

const lies = async (datei: string) =>
  await Bun.file(`${import.meta.dir}/${datei}`).text()

describe('Yext-Nachlauf', () => {
  test('jede exportierte Ladefunktion haengt am automatischen Lauf', async () => {
    const exportiert: string[] = []
    for (const datei of QUELLEN) {
      const quelle = await lies(datei)
      for (const t of quelle.matchAll(
        /export\s+async\s+function\s+([a-zA-Z0-9_]*(?:Laden|Fuellen))\b/g)) {
        exportiert.push(t[1]!)
      }
    }

    // Die Vorbedingung: findet die Suche ueberhaupt etwas? Ohne diese Zeile
    // waere der Test gruen, sobald jemand die Dateien umbenennt.
    expect(exportiert.length).toBeGreaterThanOrEqual(4)

    const nachlauf = await lies('nachlauf.ts')
    const fehlt = exportiert.filter(
      f => !AUSDRUECKLICH_NUR_VON_HAND[f] && !new RegExp(`\\b${f}\\b`).test(nachlauf))

    expect(fehlt).toEqual([])
  })

  test('der Nachlauf wird vom Sync-Lauf aufgerufen', async () => {
    // Die zweite Haelfte derselben Kette. Eine Ladefunktion kann am Nachlauf
    // haengen und trotzdem nie laufen, wenn der Nachlauf selbst aus sync.ts
    // herausfaellt -- genau so stand LINA am 02.08.2026 acht Tage still.
    const sync = await Bun.file(`${import.meta.dir}/../sync.ts`).text()
    expect(sync).toContain('yextNachlauf')
    expect(sync).toMatch(/await\s+yextNachlauf\(\)/)
  })

  test('der Analytics-Aufruf steht in einem eigenen try', async () => {
    // analytics.ts faengt Fehler ausdruecklich NICHT je Betrieb ab: alle
    // Betriebe stecken in einem Aufruf, ein Teilergebnis gibt es nicht. Ohne
    // eigenes try risse ein Fehler dort den Merker mit, und der naechste Lauf
    // holte die rund 400 Stand-Aufrufe erneut, die gerade erfolgreich waren.
    const nachlauf = await lies('nachlauf.ts')
    const ab = nachlauf.indexOf('analyticsLaden({')
    expect(ab).toBeGreaterThan(0)
    // Zwischen laufMerken und dem Aufruf muss ein try stehen.
    const davor = nachlauf.slice(nachlauf.indexOf('laufMerken('), ab)
    expect(davor).toContain('try {')
  })
})
