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
  test('analyticsFilterOptions läuft vor den Tagesberichten', () => {
    // Sonst findet keine Zeile aus getKennzahlen ihren Betrieb.
    expect(einreihPrioritaet('analyticsFilterOptions')).toBeLessThan(PRIORITAET.laufend)
  })

  test('articleApi:franchise läuft nach den Tagesberichten', () => {
    // Es ordnet nur Artikeln zu, die der Verkaufsbericht schon angelegt hat.
    expect(einreihPrioritaet('articleApi:franchise')).toBeGreaterThan(PRIORITAET.laufend)
  })

  test('die Historie kommt immer zuletzt', () => {
    // Laufende Daten dürfen nie hinter dem Backfill verhungern.
    expect(PRIORITAET.historie).toBeGreaterThan(PRIORITAET.nachlauf)
    expect(PRIORITAET.nacharbeit).toBeGreaterThan(PRIORITAET.laufend)
  })

  test('jede Momentaufnahme bekommt eine Priorität außerhalb der Tagesberichte', () => {
    for (const ep of AKTIVE_ENDPUNKTE.filter(istMomentaufnahme)) {
      expect(einreihPrioritaet(ep.key)).not.toBe(PRIORITAET.laufend)
    }
  })

  test('die beiden abhängigen Endpunkte gibt es überhaupt', () => {
    // Ein Tippfehler im Schlüssel oben würde die Prüfungen sonst wertlos machen,
    // ohne dass ein Test rot wird.
    expect(endpunkt('analyticsFilterOptions').aktiv).toBe(true)
    expect(endpunkt('articleApi:franchise').aktiv).toBe(true)
  })
})
