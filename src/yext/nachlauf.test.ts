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

/**
 * NICHTS MEHR AUF ZURUF (Migration `0078`, Plan 5.2/5.3).
 *
 * Die Tests oben fragen, ob eine Ladefunktion am automatischen Lauf hängt.
 * Diese hier fragen das Nächste: hängt auch das daran, was bisher **nur** als
 * Handbefehl existierte — der Vollabgleich über 25 Monate und der
 * Zuordnungsabgleich. Beide liefen zuletzt am 03.08.2026, und beides sah man
 * den Daten nicht an.
 */
describe('Yext ohne Handbefehl', () => {
  test('der Vollabgleich haengt am naechtlichen Lauf, nicht an "bun run yext --voll"', async () => {
    const nachlauf = await lies('nachlauf.ts')
    // Das volle Fenster muss im Nachlauf stehen, nicht nur im Skript.
    expect(nachlauf).toContain('VOLL_MONATE')
    expect(nachlauf).toMatch(/VOLL_MONATE\s*=\s*25/)
    // Und er muss sich merken, wann er zuletzt lief — sonst liefe er jede Nacht.
    expect(nachlauf).toContain('yext_letzter_vollabgleich')
  })

  test('der Zuordnungsabgleich haengt am naechtlichen Lauf', async () => {
    const nachlauf = await lies('nachlauf.ts')
    expect(nachlauf).toContain('zuordnungAbgleichen')
    expect(nachlauf).toMatch(/zuordnungAbgleichen\(\{\s*schreiben:\s*true\s*\}\)/)
  })

  /**
   * Und die Gegenprobe zum Skript: `src/yext_zuordnen.ts` darf keine zweite
   * Kopie der Zuordnungslogik mehr sein. Es ruft denselben Abgleich auf und
   * druckt ihn aus — sonst laufen beide Seiten irgendwann auseinander, und
   * die Vorschau zeigt etwas anderes als der Lauf schreibt.
   */
  test('das Vorschau-Skript rechnet nicht selbst', async () => {
    const skript = await Bun.file(`${import.meta.dir}/../yext_zuordnen.ts`).text()
    expect(skript).toContain('zuordnungAbgleichen')
    /*
     * Keine eigene Heuristik mehr. Geprueft wird auf die DEFINITIONEN, nicht
     * auf die Namen: der Kommentarkopf verweist zu Recht auf `VON_HAND` in
     * zuordnen.ts, und ein Test, der einen Verweis verbietet, verbietet die
     * Erklaerung.
     */
    expect(skript).not.toMatch(/const\s+VON_HAND/)
    expect(skript).not.toContain('entitaetenHolen')
    expect(skript).not.toMatch(/INSERT INTO manual\./)
  })

  /**
   * PUNKT 5.3: der Nachlauf muss VOR dem Round-Table-Refresh stehen.
   *
   * `mart.round_table_monat` ist seit Migration `0039` materialisiert. Lief
   * Yext dahinter, trug die Ampel die Note vom Vortag — genau das war bis zum
   * 14.08.2026 bei zwei Betrieben der Fall. Ein Nachlauf, der hinter seinem
   * eigenen Leser steht, ist einen Tag alt, ohne dass es jemandem auffällt.
   */
  test('yextNachlauf steht VOR roundTableNachlauf', async () => {
    const sync = await Bun.file(`${import.meta.dir}/../sync.ts`).text()
    const yext = sync.indexOf('await yextNachlauf()')
    const rt = sync.indexOf('await roundTableNachlauf()')
    expect(yext).toBeGreaterThan(0)
    expect(rt).toBeGreaterThan(0)
    expect(yext).toBeLessThan(rt)
  })

  /**
   * DER TIPPFEHLER MIT VIER MONATEN WIRKUNG, und der Test, der ihn künftig
   * findet.
   *
   * `core.betrieb_sichtbarkeit.eintraege_live` war in ALLEN 1.497 Zeilen
   * NULL, während die neun übrigen Metriken derselben Antwort gefüllt waren:
   * angefordert wurde `POWERLISTINGS_LIVE`, gelesen `LISTINGS_LIVE`. `zahl()`
   * liefert für eine unbekannte Metrik null statt zu werfen — richtig so,
   * denn Yext lässt Metriken für einzelne Betriebe weg. Genau diese Nachsicht
   * hat den Tippfehler getragen.
   *
   * Der Test vergleicht deshalb, was ANGEFORDERT wird, mit dem, was GELESEN
   * wird. Ein Name, der nur auf einer der beiden Seiten steht, ist der Fehler.
   */
  test('jede gelesene Metrik wird auch angefordert', async () => {
    const quelle = await lies('analytics.ts')

    /*
     * Angefordert: alle GROSSBUCHSTABEN-Zeichenketten aus BEIDEN Listen von
     * `bericht([Metriken], [Dimensionen], ...)`. Beide zaehlen, weil beide in
     * der Antwortzeile stehen und beide mit `text()`/`zahl()` gelesen werden
     * — RATINGS und AWAITING_RESPONSE sind Dimensionen, TOTAL_LISTINGS_-
     * IMPRESSIONS ist eine Metrik, und der Tippfehler kann in beiden stecken.
     */
    const angefordert = new Set<string>()
    for (const m of quelle.matchAll(/bericht\(\s*(\[[\s\S]*?\])\s*,\s*(\[[\s\S]*?\])/g)) {
      for (const teil of [m[1]!, m[2]!]) {
        for (const t of teil.matchAll(/'([A-Z][A-Z0-9_]{3,})'/g)) angefordert.add(t[1]!)
      }
    }
    // Gelesen: jedes zahl(z, 'X') und text(z, 'X').
    const gelesen = new Set<string>()
    for (const t of quelle.matchAll(/\b(?:zahl|text)\(\s*\w+\s*,\s*'([A-Z][A-Z0-9_]{3,})'/g)) {
      gelesen.add(t[1]!)
    }

    // Vorbedingung: findet die Suche ueberhaupt etwas?
    expect(angefordert.size).toBeGreaterThan(10)
    expect(gelesen.size).toBeGreaterThan(10)

    const nurGelesen = [...gelesen].filter(m => !angefordert.has(m)).sort()
    expect(nurGelesen).toEqual([])
  })
})
