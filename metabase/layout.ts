// =====================================================================
// Layout — die Kachelhoehen und -positionen werden GERECHNET, nicht
// von Hand gepflegt.
//
// Der Anlass ist ein konkreter Fehler: nach dem ersten Wurf ueberlagerten
// sich im Browser Kacheln, und Texte waren abgeschnitten. Von Hand
// gepflegte y-Werte halten genau bis zur ersten Aenderung an einer Hoehe
// weiter oben — danach schiebt sich alles darunter ineinander, und weil
// Metabase das klaglos entgegennimmt, faellt es erst im Browser auf.
//
// Deshalb steht in dashboards.ts nur noch, WAS nebeneinander gehoert
// (`reihe`), und diese Datei rechnet aus, WO es landet. Eine Reihe ist
// eine waagerechte Gruppe; ihre Hoehe ist die der hoechsten Kachel darin,
// und die naechste Reihe faengt genau darunter an.
// =====================================================================

import type { Anzeige, Kachel, Reihe } from './typen'

// ---------------------------------------------------------------------
// Mindesthoehen in Rastereinheiten (eine Einheit ~ 40 Pixel).
//
// Die Werte sind nicht geraten, sondern am gerenderten Ergebnis
// abgelesen. Was jede Karte braucht, bevor der Inhalt anfaengt:
// Kartentitel eine Einheit, bei Diagrammen die Achsenbeschriftung eine
// weitere. Eine Tabelle auf vier Einheiten zeigt Kopfzeile und zwei
// Datenzeilen — technisch korrekt und praktisch unbrauchbar.
// ---------------------------------------------------------------------
export const MINDESTHOEHE: Record<Anzeige, number> = {
  scalar: 4,   // Titel + grosse Zahl, mehr steht da nicht
  row: 8,      // waagerechte Balken brauchen Platz je Kategorie
  bar: 8,
  line: 8,
  combo: 8,
  area: 8,
  pie: 8,
  scatter: 9,  // Punktwolke braucht Hoehe, sonst wird sie ein Strich
  table: 9,    // Kopfzeile + ~6 Datenzeilen, darunter lohnt keine Tabelle
  map: 12,     // Deutschland ist hoeher als breit -- flacher wird die Karte
               // zum Streifen, in dem Nord und Sued uebereinanderliegen
  pivot: 10,   // Kopfzeile + Spaltenkoepfe + genug Zeilen, dass ein Muster
               // erkennbar wird — eine Pivot auf sechs Einheiten ist ein Brett
  waterfall: 8,
}

/**
 * Mindesthoehe einer Karte. Eine Tabelle mit garantiert wenigen Zeilen
 * (`zeilen_max`) darf niedriger sein als MINDESTHOEHE.table: Titel und
 * Spaltenkoepfe brauchen zwei Einheiten, die Fusszeile eine, jede
 * Datenzeile 0,75. Am 29.09.2026 im Screenshot abgelesen: eine Datenzeile
 * ist ~36 px hoch, eine Rastereinheit aber je nach Breite verschieden --
 * ~44 px bei fester Breite, ~57 px bei voller Breite auf 1440 px. 0,75
 * deckt Einheiten ab ~48 px; bei fester Breite kann die letzte Zeile
 * knapp werden, dann scrollt die Tabelle, sie schneidet nichts ab.
 * Nie hoeher als die normale Mindesthoehe.
 */
export function mindesthoehe(anzeige: Anzeige, zeilenMax?: number): number {
  if (anzeige === 'table' && zeilenMax !== undefined) {
    return Math.min(MINDESTHOEHE.table, Math.max(4, Math.ceil(zeilenMax * 0.75) + 3))
  }
  return MINDESTHOEHE[anzeige] ?? 8
}

/**
 * Wie hoch muss eine Textkachel sein, damit nichts abgeschnitten wird?
 *
 * Gerechnet fuer VOLLE BREITE (Standard seit 29.09.2026). Am 05.10.2026
 * nachkalibriert, weil die alte Rechnung (95 Zeichen je Zeile, 1,5
 * Textzeilen je Einheit -- beides fuer feste Breite und ~40-px-Einheiten)
 * jeden Beschreibungsblock zwei- bis dreimal zu hoch machte: der Kopf von
 * ① Round Table stand auf sechs Einheiten, der Text fuellte zwei.
 *
 * Abgelesen bei voller Breite auf 1.440 px: rund 175 Zeichen je volle
 * Zeile, eine Einheit ~57 px, eine Textzeile ~24 px. Gerechnet wird mit
 * Reserve fuer schmalere Bildschirme (1.280 px): 150 Zeichen je Zeile,
 * 2,2 Textzeilen je Einheit, dazu gut eine halbe Einheit Innenabstand.
 * Auf breiten Bildschirmen bleibt Luft -- die Einheit waechst dort mit,
 * der Text nicht --, auf schmalen wird nichts abgeschnitten.
 */
export function textHoehe(text: string, breite: number): number {
  const zeichenProZeile = Math.max(20, Math.round((breite / 24) * 150))
  let zeilen = 0
  for (const abschnitt of text.split('\n')) {
    if (!abschnitt.trim()) { zeilen += 0.4; continue }
    const umbrueche = Math.max(1, Math.ceil(abschnitt.length / zeichenProZeile))
    // Ueberschriften und Blockzitate sind hoeher als Fliesstext
    const faktor = abschnitt.startsWith('# ') ? 1.8
      : abschnitt.startsWith('#') ? 1.5
      : abschnitt.startsWith('>') ? 1.2 : 1
    zeilen += umbrueche * faktor
  }
  return Math.max(1, Math.ceil(zeilen / 2.2 + 0.6))
}

/**
 * Rechnet Reihen in Kacheln mit x/y/breite/hoehe um.
 *
 * Die Breite verteilt sich gleichmaessig auf die Elemente einer Reihe,
 * sofern keines eine eigene `breite` mitbringt; der Rest einer nicht
 * aufgehenden Division geht an die erste Kachel, damit die Reihe die
 * vollen 24 Spalten fuellt statt eine Luecke am Rand zu lassen.
 */
export function auslegen(
  reihen: Reihe[],
  typVon: (kartenSchluessel: string) => Anzeige | undefined,
  zeilenVon: (kartenSchluessel: string) => number | undefined = () => undefined,
): Kachel[] {
  const kacheln: Kachel[] = []
  let y = 0

  for (const reihe of reihen) {
    const teile = reihe.teile
    if (teile.length === 0) continue

    // Breiten festlegen
    const eigene = teile.reduce((s, t) => s + (t.breite ?? 0), 0)
    const ohne = teile.filter(t => t.breite === undefined).length
    const rest = 24 - eigene
    const grund = ohne > 0 ? Math.floor(rest / ohne) : 0
    let zusatz = ohne > 0 ? rest - grund * ohne : 0

    // Hoehe der Reihe: die hoechste Anforderung darin
    let hoehe = reihe.hoehe ?? 0
    for (const t of teile) {
      const b = t.breite ?? grund
      const noetig = t.text !== undefined
        ? textHoehe(t.text, b)
        : mindesthoehe(typVon(t.karte!) ?? 'bar', zeilenVon(t.karte!))
      hoehe = Math.max(hoehe, t.hoehe ?? noetig)
    }

    let x = 0
    for (const t of teile) {
      let b = t.breite ?? grund
      if (t.breite === undefined && zusatz > 0) { b += 1; zusatz -= 1 }
      kacheln.push({
        karte: t.karte ?? '',
        text: t.text,
        klick: t.klick,
        x, y, breite: b, hoehe,
      })
      x += b
    }
    y += hoehe
  }
  return kacheln
}
