import { expect, test, describe } from 'bun:test'
import {
  AKTIVE_ENDPUNKTE, PRIORITAET, einreihPrioritaet, istMomentaufnahme, endpunkt,
} from './endpunkte'

/**
 * Die Reihenfolge, in der eingereiht wird, ist keine Geschmacksfrage.
 *
 * Beide hier geprüften Abhängigkeiten scheitern LEISE: der Posten meldet `ok`,
 * die Zieltabelle bleibt leer. Am 26.07.2026 zweimal beobachtet — einmal
 * 7.860 verlorene BWA-Zeilen, einmal eine Warengruppenzuordnung, die nichts
 * zuordnete. Beide Male lag es nur an der Einfügereihenfolge.
 */
describe('Einreihreihenfolge', () => {
  /**
   * Die Kette Tagesbericht → analyticsFilterOptions → getKennzahlen.
   *
   * Ein Tagesbericht legt die Betriebe an (über `encId`),
   * analyticsFilterOptions heftet ihnen die numerische LINA-ID an (über den
   * Namen), und erst damit findet getKennzahlen seinen Betrieb.
   */
  test('erst die Betriebe, dann ihre LINA-ID, dann die BWA', () => {
    expect(einreihPrioritaet('getUmsatzbericht'))
      .toBeLessThan(einreihPrioritaet('analyticsFilterOptions'))
    expect(einreihPrioritaet('analyticsFilterOptions'))
      .toBeLessThan(einreihPrioritaet('getKennzahlen:absolut'))
    expect(einreihPrioritaet('getKennzahlen:relativ'))
      .toBe(einreihPrioritaet('getKennzahlen:absolut'))
  })

  test('articleApi:franchise läuft nach dem Artikelverkaufsbericht', () => {
    // Es ordnet nur Artikeln zu, die der Verkaufsbericht schon angelegt hat.
    expect(einreihPrioritaet('getArtikelverkaufsbericht'))
      .toBeLessThan(einreihPrioritaet('articleApi:franchise'))
  })

  test('die Historie kommt immer zuletzt', () => {
    // Laufende Daten dürfen nie hinter dem Backfill verhungern.
    expect(PRIORITAET.historie).toBeGreaterThan(PRIORITAET.nachlauf)
    expect(PRIORITAET.nacharbeit).toBeGreaterThan(PRIORITAET.laufend)
  })

  test('keine Momentaufnahme teilt sich die Stufe mit den Tagesberichten', () => {
    for (const ep of AKTIVE_ENDPUNKTE.filter(istMomentaufnahme)) {
      expect(einreihPrioritaet(ep.key)).toBeGreaterThan(PRIORITAET.laufend)
    }
  })

  test('jeder Tagesbericht landet auf der Stufe der Tagesberichte', () => {
    for (const ep of AKTIVE_ENDPUNKTE.filter(e => e.schrittweite === 'tag')) {
      expect(einreihPrioritaet(ep.key)).toBe(PRIORITAET.laufend)
    }
  })

  test('die abhängigen Endpunkte gibt es überhaupt', () => {
    // Ein Tippfehler im Schlüssel oben würde die Prüfungen sonst wertlos machen,
    // ohne dass ein Test rot wird.
    expect(endpunkt('analyticsFilterOptions').aktiv).toBe(true)
    expect(endpunkt('articleApi:franchise').aktiv).toBe(true)
    expect(endpunkt('getKennzahlen:absolut').aktiv).toBe(true)
  })
})
