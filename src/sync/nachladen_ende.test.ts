/**
 * Das Nachladen (Phase C) hat eine Frist — Anlass Lauf 135 (24.09.2026), der
 * bis zum nächsten Mittag nachlud und den 05:02-Lauf verdrängte.
 */
import { describe, expect, test } from 'bun:test'
import { nachladenVorbei } from './worker'

// Alle Zeitpunkte in UTC geschrieben; Europe/Berlin ist im September UTC+2.
describe('nachladenVorbei', () => {
  test('vor der Frist am Starttag: weiter', () => {
    expect(nachladenVorbei(new Date('2026-09-23T13:30:00Z'), '2026-09-23', 23)).toBe(false) // 15:30
    expect(nachladenVorbei(new Date('2026-09-23T20:59:00Z'), '2026-09-23', 23)).toBe(false) // 22:59
  })

  test('ab der vollen Stunde Ortszeit: Schluss', () => {
    expect(nachladenVorbei(new Date('2026-09-23T21:00:00Z'), '2026-09-23', 23)).toBe(true) // 23:00
  })

  test('nach Mitternacht Ortszeit ist immer Schluss — auch bei Frist 24', () => {
    expect(nachladenVorbei(new Date('2026-09-23T22:30:00Z'), '2026-09-23', 24)).toBe(true) // 00:30 am 24.
    // Genau der Fall aus Lauf 135: 02:00 Ortszeit, als das UTC-Budget frisch wurde.
    expect(nachladenVorbei(new Date('2026-09-24T00:00:00Z'), '2026-09-23', 24)).toBe(true)
  })

  test('Frist 24 läuft bis kurz vor Mitternacht', () => {
    expect(nachladenVorbei(new Date('2026-09-23T21:59:00Z'), '2026-09-23', 24)).toBe(false) // 23:59
  })
})
