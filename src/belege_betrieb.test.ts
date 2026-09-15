/**
 * Tests für den Abzug eines Betriebs.
 *
 * Geprüft wird, was ohne LINA prüfbar ist: dass jeder Beleg genau einen Ort
 * hat, und dass nichts Ungeprüftes in die Abfrage an die Produktion gelangt.
 */
import { describe, expect, test } from 'bun:test'
import { nurLesend, type Beleg } from './belege'
import { argumente, auswahl, dateinameMitDatum, ordnerFuer } from './belege_betrieb'

const rechnung = {
  lina_id: 14118, encrypted_id: 'x', typ_id: '1', lina_betrieb_id: 1025,
  beleg_datum: '2026-01-04', datei_name: 'rech-text502059291S509128942',
} as unknown as Beleg

describe('Ablage', () => {
  test('Rechnung und Lieferschein bekommen je ihren Ordner', () => {
    expect(ordnerFuer('/z', rechnung, false)).toBe('/z/rechnungen')
    expect(ordnerFuer('/z', { ...rechnung, typ_id: '3970' } as Beleg, false)).toBe('/z/lieferscheine')
  })

  test('eine E-Rechnung liegt im Unterordner digital', () => {
    expect(ordnerFuer('/z', rechnung, true)).toBe('/z/rechnungen/digital')
  })

  /*
   * Eine Belegart ohne Ordner darf nicht still irgendwo landen — etwa in
   * „/z/undefined". Die Auswahl fragt nur typ 1 und 3970 ab; kommt trotzdem
   * etwas anderes an, stimmt die Abfrage nicht.
   */
  test('eine fremde Belegart bricht ab', () => {
    expect(() => ordnerFuer('/z', { ...rechnung, typ_id: '5' } as Beleg, false)).toThrow()
  })

  test('Dateiname beginnt mit dem Belegdatum', () => {
    expect(dateinameMitDatum(rechnung)).toBe('2026-01-04__14118__rech-text502059291S509128942.pdf')
  })
})

describe('Aufruf', () => {
  test('liest Betrieb, Jahr und Ziel', () => {
    const a = argumente(['1025', '2026', '/tmp/coyacan', '--ziehen'])
    expect(a).toEqual({ betrieb: 1025, jahr: 2026, ziel: '/tmp/coyacan' })
  })

  test('lässt nichts außer ganzen Zahlen in die Abfrage', () => {
    expect(() => argumente(['1025 OR 1=1', '2026', '/tmp/x'])).toThrow()
    expect(() => argumente(['1025', "2026' --", '/tmp/x'])).toThrow()
    expect(() => argumente(['1025', '2026'])).toThrow()
  })

  test('die Auswahl ist lesend und endet am Jahreswechsel', () => {
    const sql = auswahl(1025, 2026)
    expect(() => nurLesend(sql)).not.toThrow()
    expect(sql).toContain("DATE '2026-01-01'")
    expect(sql).toContain("DATE '2027-01-01'")
    expect(sql).toContain("IN ('1', '3970')")
  })
})
