/**
 * Die Formprüfung einer FoodNotify-Antwort, an EINER Stelle (0160).
 *
 * Gebraucht an zwei Orten, die nicht auseinanderlaufen dürfen:
 *   * im Lader (`fnLaden`): eine fremde Form wird roh gesichert, in
 *     sync.schema_abweichung gemeldet, und der Posten scheitert — core bleibt
 *     unberührt (seit 0132/0155/0157);
 *   * im Client auf dem Token-Weg (`FnClient`): eine Token-Antwort in fremder
 *     Form ist ein AUSFALL des Token-Wegs und löst den Rückfall auf die
 *     Sitzung aus (Vorgabe Eugene, 19.11.2026: „Behalte immer den Fallback,
 *     falls es mal mit einem Token nicht klappen sollte"). Erst wenn auch die
 *     Sitzung eine fremde Form liefert, meldet der Lader.
 *
 * null = die Form ist die gemessene (oder für diesen Eintrag gibt es keine Prüfung).
 */
import { rezeptStrukturFehler } from './rezept'
import { posArtikelStrukturFehler } from './pos_artikel'
import { warenstammStrukturFehler } from './warenstamm'

export function fnStrukturFehler(epKey: string, daten: unknown): string | null {
  if (epKey.startsWith('fn:rezept')) return rezeptStrukturFehler(epKey, daten)
  // Kassenartikel (0155): eine fremde Form sähe sonst aus wie „kein Artikel
  // hat ein Rezept" oder „alle Artikel fehlen seit heute".
  if (epKey === 'fn:pos_artikel') return posArtikelStrukturFehler(daten)
  // Warenstamm (0157): ein umbenanntes unitPrice sähe sonst aus wie „alle
  // Preise entfallen", eine fremde Hülle wie „das Sortiment ist gestrichen".
  if (epKey === 'fn:warenstamm') return warenstammStrukturFehler(daten)
  return null
}
