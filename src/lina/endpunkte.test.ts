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

/**
 * Meilenstein M0 (Migration 0112): die sieben Verkaufsstellen.
 *
 * Die Spalte `verkaufsstelle_key` war seit 0003 da und nie gefuellt. Der Test
 * haelt fest, was die Reparatur ausmacht — und was an ihr ungeprueft ist.
 */
describe('Verkaufsstellen im Umsatzbericht (M0)', () => {
  const vs = AKTIVE_ENDPUNKTE.filter(e => e.key.startsWith('getUmsatzbericht:vs_'))

  test('sieben Endpunkte, je Verkaufsstelle aus dem Seed von 0002 einer', () => {
    const nummern = vs.map(e => e.parameter('2026-08-15', '2026-08-15').verkaufsstellen)
    expect(nummern.sort()).toEqual(['0', '1', '2', '51', '52', '53', '56'])
  })

  test('jeder sendet NUR den Verkaufsstellenfilter, keinen Spartenfilter', () => {
    // Eine Kombination aus beiden ergaebe Zeilen, die keine Sicht erwartet
    // (hauptsparte_key UND verkaufsstelle_key gesetzt).
    for (const e of vs) {
      const p = e.parameter('2026-08-15', '2026-08-15')
      expect(p.hauptsparten).toBeUndefined()
      expect(p.report).toBe('intranet-umsatz')
      expect(p.von).toBe('15.08.2026')
    }
  })

  test('sie sind Konzern-Tagesberichte und laufen damit im Nachzuegler-Fenster mit', () => {
    for (const e of vs) {
      expect(e.ebene).toBe('konzern')
      expect(e.schrittweite).toBe('tag')
      expect(einreihPrioritaet(e.key)).toBe(PRIORITAET.laufend)
    }
  })
})
