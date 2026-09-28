/**
 * Das Nachladen (Phase C) hat eine Frist — Anlass Lauf 135 (24.09.2026), der
 * bis zum nächsten Mittag nachlud und den 05:02-Lauf verdrängte. Seit dem
 * 28.09.2026 liegt die Frist in der Nacht darauf (NACHLADEN_BIS = 04:30),
 * und die Bedingung ist dieselbe geblieben: vor dem nächsten Lauf Schluss.
 */
import { describe, expect, test } from 'bun:test'
import { nachladenVorbei } from './worker'

// Alle Zeitpunkte in UTC geschrieben; Europe/Berlin ist im September UTC+2.
const beginn = new Date('2026-09-23T06:20:00Z') // Phase C beginnt 08:20 Ortszeit

describe('nachladenVorbei', () => {
  test('am Abend und über Mitternacht: weiter', () => {
    expect(nachladenVorbei(new Date('2026-09-23T20:59:00Z'), beginn, '04:30')).toBe(false) // 22:59
    expect(nachladenVorbei(new Date('2026-09-23T21:30:00Z'), beginn, '04:30')).toBe(false) // 23:30
    expect(nachladenVorbei(new Date('2026-09-23T22:30:00Z'), beginn, '04:30')).toBe(false) // 00:30 am 24.
  })

  test('um 02:00, wenn das UTC-Budget frisch wird, läuft es weiter — die Frist ist die Uhrzeit', () => {
    expect(nachladenVorbei(new Date('2026-09-24T00:00:00Z'), beginn, '04:30')).toBe(false) // 02:00 am 24.
    expect(nachladenVorbei(new Date('2026-09-24T02:29:00Z'), beginn, '04:30')).toBe(false) // 04:29
  })

  test('ab 04:30 am Folgetag: Schluss, vor dem 05:02-Lauf', () => {
    expect(nachladenVorbei(new Date('2026-09-24T02:30:00Z'), beginn, '04:30')).toBe(true) // 04:30
    expect(nachladenVorbei(new Date('2026-09-24T03:02:00Z'), beginn, '04:30')).toBe(true) // 05:02
    // Genau der Fall aus Lauf 135: der nächste Mittag.
    expect(nachladenVorbei(new Date('2026-09-24T10:03:00Z'), beginn, '04:30')).toBe(true)
  })

  test('ein Handlauf, der nach Mitternacht beginnt, endet am selben Morgen', () => {
    const nachts = new Date('2026-09-24T01:00:00Z') // 03:00 Ortszeit
    expect(nachladenVorbei(new Date('2026-09-24T02:00:00Z'), nachts, '04:30')).toBe(false) // 04:00
    expect(nachladenVorbei(new Date('2026-09-24T02:30:00Z'), nachts, '04:30')).toBe(true)  // 04:30
  })

  test('eine Frist am selben Abend verhält sich wie vorher (23:00)', () => {
    expect(nachladenVorbei(new Date('2026-09-23T20:59:00Z'), beginn, '23:00')).toBe(false) // 22:59
    expect(nachladenVorbei(new Date('2026-09-23T21:00:00Z'), beginn, '23:00')).toBe(true)  // 23:00
    expect(nachladenVorbei(new Date('2026-09-23T22:30:00Z'), beginn, '23:00')).toBe(true)  // 00:30
  })

  test('Zeitumstellung Ende Oktober: 04:30 ist Ortszeit, nicht UTC', () => {
    // 25.10.2026: um 03:00 MESZ wird es 02:00 MEZ. 04:30 MEZ = 03:30 UTC.
    const oktober = new Date('2026-10-24T06:20:00Z') // 08:20 MESZ
    expect(nachladenVorbei(new Date('2026-10-25T03:29:00Z'), oktober, '04:30')).toBe(false) // 04:29 MEZ
    expect(nachladenVorbei(new Date('2026-10-25T03:30:00Z'), oktober, '04:30')).toBe(true)  // 04:30 MEZ
  })
})
