/**
 * Die Ablehnung, die vom 18.09. bis 05.10.2026 alle Analytics stilllegte.
 *
 * Yext antwortete auf den Bericht mit allen 60 Betrieben im Filter:
 *   HTTP 400 — 5063 FATAL_ERROR Validation error: The entityId "A_03" does not exist
 * `analyticsLaden()` klammert die genannte ID aus und fragt neu. Diese Tests
 * sichern, dass genau dieser Fehler erkannt wird — und kein anderer: ein 400
 * aus anderem Grund oder ein 401 darf NICHT zum stillen Ausklammern fuehren.
 */
import { describe, expect, test } from 'bun:test'
import { unbekannteEntitaet } from './analytics'
import { YextFehler } from './client'

describe('unbekannteEntitaet', () => {
  test('erkennt die echte Meldung vom 05.10.2026', () => {
    const e = new YextFehler(
      'HTTP 400 — 5063 FATAL_ERROR Validation error: The entityId "A_03" does not exist', 400, true)
    expect(unbekannteEntitaet(e)).toBe('A_03')
  })

  test('ein anderer 400 bleibt ein Fehler', () => {
    const e = new YextFehler('HTTP 400 — Validation error: metric FOO is unknown', 400, true)
    expect(unbekannteEntitaet(e)).toBeNull()
  })

  test('dieselbe Meldung mit anderem Status wird nicht ausgeklammert', () => {
    const e = new YextFehler('The entityId "A_03" does not exist', 401, true)
    expect(unbekannteEntitaet(e)).toBeNull()
  })

  test('ein gewoehnlicher Fehler ist keine Ablehnung', () => {
    expect(unbekannteEntitaet(new Error('The entityId "A_03" does not exist'))).toBeNull()
  })
})
