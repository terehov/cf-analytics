/**
 * Kostenstellen ohne Warenwirtschaft (0164): die Erkennung der Hülle und das
 * 403, das einer Ressource gilt. Ohne Datenbank — der Weg in
 * core.kostenstelle und sync.warteschlange ist SQL in erp_fehlt.ts.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { istErpFehlt } from './erp_fehlt'
import { istRessourcenAbweisung, istRessourcenFehler } from './client'

describe('istErpFehlt', () => {
  test('die gemessene Meldung, so wie der Client sie weiterreicht', () => {
    expect(istErpFehlt('Hüllenfehler bei HTTP 200: No Erp Found!')).toBe(true)
    expect(istErpFehlt('no erp found')).toBe(true)
  })
  test('andere Fehler nicht', () => {
    expect(istErpFehlt('HTTP 500 — NonUniqueResultException: More than one result was found')).toBe(false)
    expect(istErpFehlt('HTTP 403')).toBe(false)
    expect(istErpFehlt(null)).toBe(false)
    expect(istErpFehlt(undefined)).toBe(false)
  })
})

describe('istRessourcenAbweisung', () => {
  test('das 403 vom Token-Weg an einer Kostenstelle ohne Warenwirtschaft', () => {
    expect(istRessourcenAbweisung('{"message":"This endpoint does not support scope-limited tokens."}')).toBe(true)
  })
  test('ein gewöhnliches 403 bleibt eine Abweisung', () => {
    expect(istRessourcenAbweisung('{"message":"Access Denied."}')).toBe(false)
    expect(istRessourcenAbweisung('{"message":"Invalid JWT Token"}')).toBe(false)
  })
})

describe('istRessourcenFehler', () => {
  test('403 scope-limited und 500 NonUniqueResultException gelten der Ressource', () => {
    expect(istRessourcenFehler(403, 'This endpoint does not support scope-limited tokens.')).toBe(true)
    expect(istRessourcenFehler(500, '{"message":"NonUniqueResultException: More than one result"}')).toBe(true)
  })
  test('jeder andere 5xx bleibt ein Ausfall, jedes andere 403 eine Abweisung', () => {
    expect(istRessourcenFehler(500, 'Internal Server Error')).toBe(false)
    expect(istRessourcenFehler(502, 'NonUniqueResultException')).toBe(false)
    expect(istRessourcenFehler(403, 'Access Denied.')).toBe(false)
  })
})

describe('Einreihweg', () => {
  const quelle = readFileSync(new URL('../sync/nachfuellen.ts', import.meta.url), 'utf8')
  test('Bestellungen, Warenstamm und Inventuren lassen markierte Kostenstellen aus', () => {
    // Zwei mit Probe je FN_ERP_FEHLT_PROBE_TAGE, Inventuren (Sammelaufruf) ganz.
    expect(quelle.match(/erp_fehlt_zuletzt < now\(\) - make_interval\(days => \$\d::int\)/g)?.length).toBe(2)
    expect(quelle).toContain('AND k.erp_fehlt_seit IS NULL) AS erp_ids')
  })
})
