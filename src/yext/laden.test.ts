/**
 * Die Monatsfenster des Yext-Importers.
 *
 * Warum das eine eigene Testdatei wert ist: `monate()` bestimmt, welcher
 * Stichtag an `maxPublisherDate` geht — und ein Stichtag, der einen Tag
 * danebenliegt, faellt nicht auf. Er liefert eine plausible Zahl, nur eben die
 * eines anderen Zeitraums. Genau die Sorte Fehler, die in einer Kennzahl ein
 * Jahr lang unentdeckt mitlaeuft.
 */
import { expect, test, describe } from 'bun:test'
import { monate } from './laden'

describe('Monatsfenster', () => {
  const heute = new Date('2026-08-03T12:00:00Z')

  test('der juengste Monat steht vorn', () => {
    const m = monate(3, heute)
    expect(m.map(x => x.erster)).toEqual(['2026-08-01', '2026-07-01', '2026-06-01'])
  })

  test('abgeschlossene Monate enden am Monatsletzten', () => {
    const m = monate(3, heute)
    expect(m[1]!.stichtag).toBe('2026-07-31')
    expect(m[2]!.stichtag).toBe('2026-06-30')
  })

  test('der laufende Monat endet HEUTE, nicht am Monatsletzten', () => {
    // Sonst stuende im Round Table den ganzen August ein Stand, der erst am
    // 31. gilt — mit lauter Nullen, bis der Monat vorbei ist.
    expect(monate(1, heute)[0]!.stichtag).toBe('2026-08-03')
  })

  test('der Jahreswechsel bricht die Reihe nicht', () => {
    const m = monate(3, new Date('2026-01-15T00:00:00Z'))
    expect(m.map(x => x.erster)).toEqual(['2026-01-01', '2025-12-01', '2025-11-01'])
    expect(m[1]!.stichtag).toBe('2025-12-31')
  })

  test('Februar im Schaltjahr hat 29 Tage', () => {
    expect(monate(1, new Date('2028-02-29T10:00:00Z'))[0]!.stichtag).toBe('2028-02-29')
    expect(monate(2, new Date('2028-03-05T10:00:00Z'))[1]!.stichtag).toBe('2028-02-29')
  })

  test('Februar ohne Schaltjahr hat 28', () => {
    expect(monate(2, new Date('2026-03-05T10:00:00Z'))[1]!.stichtag).toBe('2026-02-28')
  })

  test('25 Monate reichen zwei Jahre zurueck plus den Ankermonat', () => {
    // 24 berichtete Monate brauchen 25 geladene: der aelteste hat keinen
    // Vormonat und traegt deshalb keinen Monatswert, nur den Anker.
    const m = monate(25, heute)
    expect(m).toHaveLength(25)
    expect(m.at(-1)!.erster).toBe('2024-08-01')
  })

  test('ein Stichtag ist nie in der Zukunft', () => {
    for (const m of monate(25, heute)) {
      expect(m.stichtag <= '2026-08-03').toBe(true)
    }
  })
})
