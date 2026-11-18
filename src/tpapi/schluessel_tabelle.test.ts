/**
 * Die API-Key-Tabelle der Ladenakte gegen das Fixture — ohne Netz, ohne Datenbank.
 * Woran es haengt: geloescht wird nur, was sell&pick als Drittanbieter traegt UND so
 * heisst, und nie ein anderer Schluessel (Bounti, unser eigener).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { anbieterNorm, schluesselTabelle, sellPickUrteil, type SchluesselZeile } from './schluessel_tabelle'

const html = readFileSync(join(import.meta.dir, '../transform/fixtures/ladenakte_stammdaten.html'), 'utf8')

describe('schluesselTabelle', () => {
  const zeilen = schluesselTabelle(html)

  test('liest beide Zeilen des Fixtures mit Drittanbieter und Kennung', () => {
    expect(zeilen.map(z => z.name)).toEqual(['Sell & Pick', 'Bounti'])
    expect(zeilen.map(z => z.drittanbieter)).toEqual(['sell&pick', 'Bounti'])
    expect(zeilen[0].id).toBe('73246318d5ee0622b2de975b537135b187678336')
    expect(zeilen[1].id).toBe('0e368cdf5c349004db24f3f2c98db4c252419acd')
    expect(zeilen[0].ebene).toBe('Franchise')
  })

  test('nur der Schluessel von Sell & Pick steht zum Loeschen', () => {
    expect(zeilen.map(sellPickUrteil)).toEqual(['loeschen', null])
  })
})

describe('sellPickUrteil', () => {
  const zeile = (name: string, drittanbieter: string): SchluesselZeile =>
    ({ name, key: 'x', ip: '0.0.0.0', drittanbieter, scopes: '', erzeugtVon: '', ebene: 'Franchise', id: null })

  test('Name UND Drittanbieter muessen passen', () => {
    expect(sellPickUrteil(zeile('Sell & Pick', 'sell&pick'))).toBe('loeschen')
    expect(sellPickUrteil(zeile('Sell&Pick', 'sell&pick'))).toBe('loeschen')
    // Trockenlauf 17.11.2026: fremde Schluessel, die sell&pick nur als Pflichtauswahl tragen
    expect(sellPickUrteil(zeile('Kaoix', 'sell&pick'))).toBe('ansehen')
    expect(sellPickUrteil(zeile('TestRosi', 'sell&pick'))).toBe('ansehen')
    expect(sellPickUrteil(zeile('Sell & Pick', 'Foodnotify'))).toBe('ansehen')
    expect(sellPickUrteil(zeile('Concept Family Analytics', 'Foodnotify'))).toBeNull()
    expect(sellPickUrteil(zeile('Bounti', 'Bounti'))).toBeNull()
  })

  test('Schreibweisen', () => {
    for (const s of ['sell&pick', 'Sell & Pick', 'Sell &amp; Pick', 'SELL&PICK']) expect(anbieterNorm(s.replace('&amp;', '&'))).toBe('sellpick')
  })
})
