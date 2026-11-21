/**
 * Fehltage im TPAPI-Nachladen (0162): wann ein 5xx ein Tag ist, den LINA nicht
 * hat, und wann ein Ausfall. Anlass 21.11.2026: drei Betriebe mit HTTP 500 für
 * einen ganzen Zeitraum hielten jede Nacht ihre drei jüngsten Tage fest, kein
 * älterer wurde je gefragt.
 */
import { describe, expect, test } from 'bun:test'
import { zaehltAlsFehltag } from './rohabzug'
import { stundeEndpunkt } from './endpunkte'

describe('zaehltAlsFehltag', () => {
  const basis = { phase: 'nachladen' as const, tag: '2019-03-01', status: 500, modulLebt: true }

  test('5xx an einem Tag im Nachladen, Modul hat in diesem Lauf geliefert: Fehltag', () => {
    expect(zaehltAlsFehltag(basis)).toBe(true)
    expect(zaehltAlsFehltag({ ...basis, status: 503 })).toBe(true)
  })

  test('ohne Erfolg im Lauf ist es ein möglicher Ausfall — drei in Folge wie bisher', () => {
    expect(zaehltAlsFehltag({ ...basis, modulLebt: false })).toBe(false)
  })

  test('Netzfehler (Status 0), Formfehler bei 200 und 4xx sind keine Fehltage', () => {
    expect(zaehltAlsFehltag({ ...basis, status: 0 })).toBe(false)
    expect(zaehltAlsFehltag({ ...basis, status: 200 })).toBe(false)
    expect(zaehltAlsFehltag({ ...basis, status: 404 })).toBe(false)
  })

  test('Phase A und Aufträge ohne Tag (Stamm, Prognose) bleiben beim alten Verhalten', () => {
    expect(zaehltAlsFehltag({ ...basis, phase: 'tagesgeschaeft' })).toBe(false)
    expect(zaehltAlsFehltag({ ...basis, tag: undefined })).toBe(false)
  })
})

test('0162 schließt in mart.personal_rueckstand den Endpunkt aus, unter dem das Nachladen Personal je Stunde führt', () => {
  // Der Name steht in der Migration als Literal — er muss zum Register passen.
  expect(stundeEndpunkt()?.endpunkt).toBe('tpapi:personalkostenprostunde')
})
