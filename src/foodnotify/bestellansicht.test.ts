/**
 * Die Bestellansicht (0135) — der Ersatzweg, wenn /change mit HTTP 500 scheitert.
 *
 * Die Vorlage ist SYNTHETISCH: das Markup ist Zeichen für Zeichen von einer
 * echten Antwort abgelesen (19.10.2026), Artikel und Preise sind erfunden.
 * Echte Antworten liegen nicht im Repository.
 *
 * Gemessen wurde vorher, gegen die echte Schnittstelle: an Bestellung 450
 * (53 Positionen) liefern Ansicht und /change dieselbe Artikelnummer, Menge,
 * Gebindegröße und Summe in 53 von 53 Zeilen. Der Gleichheitstest unten hält
 * genau diese Zuordnung fest.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { bestellansichtLesen, deZahl } from './bestellansicht'
import { bestellpositionen } from './transform'
import { ParseFehler } from '../ladenakte/html'

const HTML = readFileSync(new URL('./fixtures/bestellansicht_synthetisch.html', import.meta.url), 'utf8')

describe('bestellansichtLesen', () => {
  const a = bestellansichtLesen(HTML)

  test('liest jede Zeile, mit Nummer der Oberfläche und Gruppe', () => {
    expect(a.ansichtNr).toBe('777001')
    expect(a.positionen.map(p => p.produktId)).toEqual(['1001', '1002', '1003', '1004'])
    expect(a.positionen.map(p => p.gruppe)).toEqual(['Bar 19%', 'Bar 19%', 'Küche TK 7%', 'Küche TK 7%'])
  })

  test('Menge und Gebinde aus „N KÜRZEL (M x …)"', () => {
    const t = a.positionen.find(p => p.produktId === '1003')!
    expect(t).toMatchObject({ lieferantenNr: '500076', menge: 2, gebindeMenge: 200, gebindeEinheit: 'KAR',
                              preis: 18.572, summe: 37.144 })
    const z = a.positionen.find(p => p.produktId === '1004')!
    expect(z).toMatchObject({ menge: 3, gebindeMenge: 1, gebindeEinheit: 'EIM', summe: 46.53 })
  })

  test('der Name kommt ohne die versteckte ArtNr.-Zeile', () => {
    expect(a.positionen[0].name).toBe('Beispielgin 40% 0,7L Flasche 0,7L:flasche 0,7L')
  })

  test('die Gesamtsumme der Seite wird gelesen, aber nicht gegen die Zeilen gehalten — sie ist brutto mit Pfand', () => {
    expect(a.gesamtsumme).toBe(186.02)
    expect(a.positionen.reduce((s, p) => s + p.summe, 0)).toBeCloseTo(163.254, 3)
  })

  test('Ansicht und /change ergeben dieselben Positionen (Artikelnummer, Menge, Gebinde, Summe)', () => {
    // Dieselben vier Artikel in der Form, die /change liefert.
    const change = { errors: [], payload: a.positionen.map((p, i) => ({
      id: 9000 + i, sumPrice: p.summe, amount: 0, adjustedQuantity: p.menge,
      totalUnitQuantity: p.menge * p.gebindeMenge,
      shopOrderMappingProduct: { name: p.name, packagingQuantity: p.gebindeMenge, unitQuantity: 1,
                                 unit: { name: 'Stück' }, concreteProduct: { id: 5000 + i, name: p.name } },
      shopOrderProduct: { product: { id: Number(p.produktId), ingredient: { artikelId: p.lieferantenNr } } },
    })) }
    const api = bestellpositionen(change)
    expect(api.map(p => [p.lieferantenNr, p.menge, p.gebindeMenge, p.summePreis]))
      .toEqual(a.positionen.map(p => [p.lieferantenNr, p.menge, p.gebindeMenge, p.summe]))
  })
})

describe('bestellansichtLesen wirft, statt Halbes zu liefern', () => {
  test('die Fehlerseite („Diese Bestellung ist nicht vorhanden") hat keine Tabelle', () => {
    const fehler = '<html><body><h1>Ein Fehler ist aufgetreten</h1><p>Diese Bestellung ist nicht vorhanden</p></body></html>'
    expect(() => bestellansichtLesen(fehler)).toThrow(ParseFehler)
  })

  test('eine Tabelle ohne Positionszeile', () => {
    expect(() => bestellansichtLesen('<table class="order-products"><tr><th></th></tr></table>')).toThrow(/ohne eine einzige Position/)
  })

  test('eine Produkt-ID zweimal', () => {
    const doppelt = HTML.replace('value="1002"', 'value="1001"')
    expect(() => bestellansichtLesen(doppelt)).toThrow(/zweimal/)
  })

  test('eine Mengenzelle mit unbekanntem Muster', () => {
    const anders = HTML.replace(/\(1\s*x/, '(eins x')
    expect(() => bestellansichtLesen(anders)).toThrow(/unbekanntes Muster/)
  })

  test('eine Zeile ohne Summe', () => {
    const ohne = HTML.replace('<span class="total">28,67</span>', '')
    expect(() => bestellansichtLesen(ohne)).toThrow(/Pflichtzelle/)
  })
})

describe('deZahl', () => {
  test('Komma ist Dezimal, Punkt ist Tausender', () => {
    expect(deZahl('14,335')).toBe(14.335)
    expect(deZahl('1.587,37')).toBe(1587.37)
    expect(deZahl(' € 3 ')).toBe(3)
  })
  test('kein Zahltext wirft', () => {
    expect(() => deZahl('drei')).toThrow(ParseFehler)
  })
})
