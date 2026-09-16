/**
 * Was ein Modell ueber die Spalten erfaehrt — die Grundlage, auf der es die
 * Darstellung waehlt.
 *
 * Der Server zeichnet nichts. Was er liefert, muss deshalb stimmen: eine
 * Zeitachse, die als Merkmal gilt, wird zur Kategorie; ein Prozentwert ohne
 * Einheit wird mit 100 multipliziert; ein Schluessel als Kennzahl wird
 * summiert. Jeder dieser Fehler ist ein Diagramm, das plausibel aussieht.
 */
import { describe, expect, test } from 'bun:test'
import { katalogAusJson } from '../src/katalog_laden'
import { darstellungshinweis, spaltenBeschreiben } from '../src/spalten_info'
import abzug from './katalog.json'

const katalog = katalogAusJson(abzug as any)

describe('Spaltenprofil', () => {

  test('Zeit, Merkmal, Kennzahl, Schluessel werden auseinandergehalten', () => {
    const zeilen = [
      { monat: '2026-07-01', konzept: 'Enchilada', betrieb_key: 3, umsatz_netto: 136612.46 },
      { monat: '2026-08-01', konzept: 'Aposto',    betrieb_key: 4, umsatz_netto: 98000.1 },
    ]
    const info = spaltenBeschreiben(['monat', 'konzept', 'betrieb_key', 'umsatz_netto'],
      zeilen, katalog, ['mart.umsatz_tag'])
    const rolle = Object.fromEntries(info.map(i => [i.spalte, i.rolle]))
    expect(rolle).toEqual({ monat: 'zeit', konzept: 'merkmal', betrieb_key: 'schluessel', umsatz_netto: 'kennzahl' })
    expect(info.find(i => i.spalte === 'umsatz_netto')!.einheit).toBe('euro')
    expect(info.find(i => i.spalte === 'umsatz_netto')!.spanne).toEqual([98000.1, 136612.46])
  })

  test('Ein Prozentwert bekommt seine Einheit und den Hinweis, ihn nicht zu skalieren', () => {
    const info = spaltenBeschreiben(['we_kueche_pct'], [{ we_kueche_pct: 31.08 }],
      katalog, ['mart.round_table_monat'])
    expect(info[0]!.einheit).toBe('prozentzahl')
    expect(info[0]!.hinweis).toContain('NICHT mit 100')
  })

  test('Eine Ampelspalte wird erkannt und traegt die Zaehl-statt-mitteln-Regel', () => {
    const info = spaltenBeschreiben(['gesamt'], [{ gesamt: 'rot' }, { gesamt: 'gruen' }, { gesamt: 'orange' }],
      katalog, ['mart.round_table_monat'])
    expect(info[0]!.rolle).toBe('ampel')
    expect(info[0]!.hinweis).toContain('zaehlen')
  })

  /**
   * Die fertigen Berichte (dd_filialen_tabelle) liefern die Ampeln als Emojis
   * aus ampel.beschriftung, mit ⚪ fuer "keine Ampel berechenbar" — in Spalten
   * namens "●" und "◐ Umsatz". Bis 16.09.2026 galten sie als Merkmal: dem
   * Modell fehlte die Zaehlregel, und das Ampelraster faerbte nichts.
   */
  test('Ampeln als Emojis (●, ◐ Umsatz) und "unvollstaendig" gelten ebenfalls als Ampel', () => {
    const zeilen = [
      { '●': '🔴', '◐ Umsatz': '🟢', gesamt: 'rot',            Marke: 'Enchilada' },
      { '●': '🟠', '◐ Umsatz': '⚪', gesamt: 'unvollstaendig', Marke: 'Aposto' },
      { '●': '⚪', '◐ Umsatz': '🟠', gesamt: 'orange',         Marke: 'Enchilada' },
    ]
    const info = spaltenBeschreiben(['●', '◐ Umsatz', 'gesamt', 'Marke'], zeilen, katalog, ['mart.round_table_monat'])
    const rolle = Object.fromEntries(info.map(i => [i.spalte, i.rolle]))
    expect(rolle).toEqual({ '●': 'ampel', '◐ Umsatz': 'ampel', gesamt: 'ampel', Marke: 'merkmal' })
  })

  test('Der Katalog geht vor der Datenprobe: eine Kennzahl mit Einheit bleibt es auch ohne Zeilen', () => {
    // Gefunden an einer leeren Antwort: umsatz_netto wurde als Merkmal angeboten.
    const info = spaltenBeschreiben(['monat', 'umsatz_netto'], [], katalog, ['mart.umsatz_tag'])
    expect(info.find(i => i.spalte === 'umsatz_netto')!.rolle).toBe('kennzahl')
    expect(info.find(i => i.spalte === 'monat')!.rolle).toBe('zeit')
  })

  test('numeric aus pg (Text) zaehlt als Kennzahl', () => {
    const info = spaltenBeschreiben(['umsatz'], [{ umsatz: '1234.50' }, { umsatz: '99.00' }], katalog, [])
    expect(info[0]!.rolle).toBe('kennzahl')
  })
})

describe('Der Darstellungshinweis', () => {

  test('ueberlaesst die Form dem Modell und nennt Zeitachse und Kennzahlen', () => {
    const info = spaltenBeschreiben(['monat', 'umsatz_netto'],
      [{ monat: '2026-07-01', umsatz_netto: 1 }, { monat: '2026-08-01', umsatz_netto: 2 }],
      katalog, ['mart.umsatz_tag'])
    const text = darstellungshinweis(info, 2)
    expect(text).toContain('DEINE ENTSCHEIDUNG')
    expect(text).toContain('Zeitachse: "monat"')
    expect(text).toContain('"umsatz_netto" in euro')
    expect(text).toContain('andere Form verlangen')
    // Keine Formvorgabe — der Server schlaegt nichts vor.
    expect(text).not.toMatch(/nimm (ein|eine) (Balken|Linie)/i)
  })

  test('warnt vor zwei Groessenordnungen auf einer Achse', () => {
    const info = spaltenBeschreiben(['umsatz_netto', 'gaeste'],
      [{ umsatz_netto: 500000, gaeste: 120 }], katalog, ['mart.umsatz_tag'])
    expect(darstellungshinweis(info, 1)).toContain('Faktor')
  })

  test('warnt vor zu vielen Kategorien fuer Farbserien', () => {
    const zeilen = Array.from({ length: 30 }, (_, i) => ({ betrieb: `Betrieb ${i}`, umsatz_netto: i }))
    const info = spaltenBeschreiben(['betrieb', 'umsatz_netto'], zeilen, katalog, ['mart.umsatz_tag'])
    expect(darstellungshinweis(info, 30)).toContain('30 Auspraegungen')
  })

  test('null Zeilen: nichts darstellen, das sagen', () => {
    const text = darstellungshinweis([], 0)
    expect(text).toContain('Keine Zeilen')
    expect(text).not.toContain('DEINE ENTSCHEIDUNG')
  })

  test('eine einzige Zeile: grosse Kennzahl statt Ein-Balken-Diagramm', () => {
    const info = spaltenBeschreiben(['n'], [{ n: 62 }], katalog, [])
    expect(darstellungshinweis(info, 1)).toContain('grosse Kennzahl')
  })
})
