/**
 * Die Stundenermittlung fürs Arbeitsfenster.
 *
 * Hier saß ein Bug, den erst der Ende-zu-Ende-Test sichtbar gemacht hat: die
 * deutsche Locale formatiert eine reine Stundenausgabe als "22 Uhr", Number()
 * darauf ist NaN — das Fenster war damit dauerhaft geschlossen und der
 * Importer lief nie. Deshalb ein eigener Test dafür.
 */
import { expect, test, describe } from 'bun:test'
import { stundeInGeschaeftszeitzone } from './time'

describe('Stunde in der Geschäftszeitzone', () => {
  test('rechnet in Berliner Zeit, nicht in UTC', () => {
    expect(stundeInGeschaeftszeitzone(new Date('2026-06-15T20:00:00Z'))).toBe(22) // Sommerzeit +2
    expect(stundeInGeschaeftszeitzone(new Date('2026-01-15T20:00:00Z'))).toBe(21) // Winterzeit +1
    expect(stundeInGeschaeftszeitzone(new Date('2026-06-15T03:00:00Z'))).toBe(5)
  })

  test('Mitternacht ist 0, nicht 24', () => {
    expect(stundeInGeschaeftszeitzone(new Date('2026-06-14T22:00:00Z'))).toBe(0)
  })

  test('die deutsche Locale wäre hier die Falle gewesen', () => {
    const deutsch = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false,
    }).format(new Date('2026-06-15T20:00:00Z'))
    expect(deutsch).toContain('Uhr')
    expect(Number(deutsch)).toBeNaN()
  })

  test('Fensterlogik: die Grenzen wirken wie erwartet', () => {
    const imFenster = (stunde: number, von: number, bis: number) => stunde >= von && stunde < bis
    expect(imFenster(22, 7, 23)).toBe(true)
    expect(imFenster(5,  7, 23)).toBe(false)
    expect(imFenster(7,  7, 23)).toBe(true)   // Untergrenze inklusive
    expect(imFenster(23, 7, 23)).toBe(false)  // Obergrenze exklusiv
  })

  /**
   * Seit 25.07.2026 ist 0–24 die Voreinstellung: durchgehend. Die Grenzen
   * dürfen dabei keine Lücke lassen — insbesondere nicht um Mitternacht, wo
   * die Stunde von 23 auf 0 springt.
   */
  test('0–24 ist zu jeder Stunde offen, auch um Mitternacht', () => {
    const imFenster = (stunde: number, von: number, bis: number) => stunde >= von && stunde < bis
    for (let stunde = 0; stunde < 24; stunde++) {
      expect(imFenster(stunde, 0, 24)).toBe(true)
    }
  })
})
