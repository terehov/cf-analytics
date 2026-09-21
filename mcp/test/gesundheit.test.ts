/**
 * Eine defekte Sicht darf nicht als „laeuft" durchgehen — ohne Datenbank pruefbar.
 *
 * BEFUND 21.09.2026: `abfrage_pruefen` hat fuer SQL auf mart.vergleichstag und
 * mart.betrieb_wetter_tag "Laeuft, mit 1 Hinweis(en)" gemeldet, und beide
 * Sichten waren fuer die Leserolle unlesbar. Die Pruefung war rein
 * katalogbasiert: sie kennt Koernung, Achsen und Fallstricke — also die
 * BEDEUTUNG — und nicht den ZUSTAND.
 *
 * Hier wird geprueft, dass der Zustand ankommt, wenn er bekannt ist. Dass er
 * ueberhaupt gemessen wird, prueft ausfuehren.test.ts gegen die echte
 * Datenbank; die Momentaufnahme kommt hier von Hand.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { parserBereitstellen } from '../src/ast'
import { katalogAusJson } from '../src/katalog_laden'
import { pruefen, type Sichtlage } from '../src/pruefen'
import abzug from './katalog.json'

const katalog = katalogAusJson(abzug as any)

beforeAll(async () => { await parserBereitstellen() })

const lage = (frisch: boolean): Sichtlage => ({
  frisch,
  defekt: new Map([
    ['mart.vergleichstag', {
      sqlstate: '42501',
      meldung: 'Postgres SQLSTATE 42501: permission denied for schema core\n' +
               'Zusammenhang: SQL function "geschaeftstag" during inlining',
    }],
  ]),
  unklar: new Map([
    ['mart.artikelverkauf', {
      sqlstate: '57014',
      meldung: 'Postgres SQLSTATE 57014: canceling statement due to statement timeout',
    }],
  ]),
})

const SQL = `SELECT betrieb, geschaeftstag, umsatz_netto, umsatz_vergleich
               FROM mart.vergleichstag
              WHERE geschaeftstag = DATE '2026-08-15' LIMIT 5`

describe('Der Befund sicht_defekt', () => {

  test('eine frisch gemessene defekte Sicht wird GESPERRT, nicht "laeuft" gemeldet', () => {
    const e = pruefen(SQL, katalog, lage(true))
    expect(e.erlaubt).toBe(false)
    const b = e.befunde.find(x => x.schluessel === 'sicht_defekt_mart.vergleichstag')
    expect(b).toBeDefined()
    expect(b!.schwere).toBe('sperre')
    // Die Postgres-Meldung gehoert in den Befund: ohne sie weiss das Modell
    // nicht, ob es an ihm oder am Server liegt.
    expect(b!.hinweis).toContain('permission denied for schema core')
    expect(b!.berichtigung).toContain('mart.sicht_defekt')
  })

  /**
   * EINE ALTE MESSUNG SPERRT NICHT. Eine Sicht, die vor sechs Stunden lag,
   * kann inzwischen behoben sein — dann waere eine Sperre auf einem alten
   * Messwert genau die Sorte stiller Fehlfunktion, gegen die dieser Pruefer
   * geschrieben ist. Der Hinweis bleibt, als Warnung.
   */
  test('eine alte Messung warnt, sperrt aber nicht', () => {
    const e = pruefen(SQL, katalog, lage(false))
    expect(e.erlaubt).toBe(true)
    const b = e.befunde.find(x => x.schluessel === 'sicht_defekt_mart.vergleichstag')
    expect(b!.schwere).toBe('warnung')
    expect(b!.hinweis).toContain('kann behoben sein')
  })

  /**
   * OHNE URTEIL IST KEIN DEFEKT. Eine Sicht, die in der Probe in fuenf
   * Sekunden keine Zeile lieferte, wird gewarnt und nicht gesperrt — sie
   * laeuft vielleicht, nur nicht ohne engen Zeitraum. Vor dem 21.09.2026
   * (abends) zaehlte sie still als gesund.
   */
  test('eine Probe ohne Urteil warnt, sperrt aber nicht', () => {
    const e = pruefen(`SELECT count(*) FROM mart.artikelverkauf`, katalog, lage(true))
    const b = e.befunde.find(x => x.schluessel === 'sicht_unklar_mart.artikelverkauf')
    expect(b).toBeDefined()
    expect(b!.schwere).toBe('warnung')
    expect(b!.hinweis).toContain('statement timeout')
    expect(e.befunde.filter(x => x.schwere === 'sperre' && x.schluessel.startsWith('sicht_'))).toEqual([])
  })

  test('eine gesunde Sicht bekommt keinen Befund', () => {
    const e = pruefen(`SELECT count(*) FROM mart.betrieb`, katalog, lage(true))
    expect(e.befunde.map(b => b.schluessel).filter(s => s.startsWith('sicht_'))).toEqual([])
  })

  /**
   * OHNE MOMENTAUFNAHME AENDERT SICH NICHTS. Der Pruefer laeuft auch ohne
   * Gesundheitslauf — in fallen.test.ts tut er das hundertfach —, und dort
   * darf keine Sicht als defekt gelten, bloss weil nichts gemessen wurde.
   */
  test('ohne Momentaufnahme bleibt die Pruefung, was sie war', () => {
    const ohne = pruefen(SQL, katalog)
    expect(ohne.befunde.map(b => b.schluessel).filter(s => s.startsWith('sicht_defekt'))).toEqual([])
  })
})
