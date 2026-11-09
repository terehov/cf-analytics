/**
 * `LINA_API_SCHLUESSEL` beim Start — ohne Datenbank, ohne Netz.
 *
 * Geprüft wird die reine Funktion, nicht der Start im Subprozess: der
 * Subprozess erbte die `.env` mit den echten Schlüsseln, und eine
 * Fehlermeldung des Tests stünde dann womöglich mit Inhalt im Testprotokoll.
 *
 * DIE EINE REGEL, die über allen anderen steht: keine Meldung enthält einen
 * Wert. Deshalb prüft jeder Fehlerfall zusätzlich, dass der Schlüssel NICHT
 * in der Meldung steht.
 */
import { describe, expect, test } from 'bun:test'
import { konfigZumLoggen, config, tpapiSchluesselParsen } from '../config'

const ENC = '0123456789abcdef0123456789abcdef01234567'
const WERT = 'GeHeImEr-ScHlUeSsEl-0815'

/** Die Meldung des geworfenen Fehlers — und dass sie den Wert nicht trägt. */
function meldung(roh: string): string {
  try {
    tpapiSchluesselParsen(roh)
  } catch (e) {
    const m = String((e as Error).message)
    expect(m).not.toContain(WERT)
    expect(m).not.toContain('GeHeIm')
    return m
  }
  throw new Error('kein Fehler geworfen')
}

describe('tpapiSchluesselParsen', () => {
  test('ungesetzt oder leer: nicht eingerichtet, kein Fehler', () => {
    expect(tpapiSchluesselParsen(undefined)).toEqual({})
    expect(tpapiSchluesselParsen('')).toEqual({})
    expect(tpapiSchluesselParsen('   ')).toEqual({})
  })

  test('ein- und mehrzeiliges JSON', () => {
    expect(tpapiSchluesselParsen(`{"${ENC}":"${WERT}"}`)).toEqual({ [ENC]: WERT })
    expect(tpapiSchluesselParsen(`{\n  "${ENC}": "${WERT}"\n}\n`)).toEqual({ [ENC]: WERT })
  })

  test('ungültiges JSON bricht ab — ohne das Stück zu zitieren, an dem JSON.parse scheitert', () => {
    expect(meldung(`{"${ENC}":"${WERT}`)).toContain('kein gültiges JSON')
    expect(meldung(`{${WERT}}`)).toContain('kein gültiges JSON')
  })

  test('kein Objekt', () => {
    expect(meldung(`["${WERT}"]`)).toContain('kein Objekt')
    expect(meldung(`"${WERT}"`)).toContain('kein Objekt')
  })

  test('vertauschtes Paar: der Schlüssel des Eintrags ist keine encId', () => {
    // Genau der Fall, in dem eine naive Meldung den Wert ausgäbe.
    expect(meldung(`{"${WERT}":"${ENC}"}`)).toContain('keine encId')
  })

  test('encId in Großbuchstaben trifft keinen Betrieb — Abbruch', () => {
    expect(meldung(`{"${ENC.toUpperCase()}":"${WERT}"}`)).toContain('keine encId')
  })

  test('leerer Wert, kein Text, Leerraum am Rand', () => {
    expect(meldung(`{"${ENC}":""}`)).toContain('leer')
    expect(meldung(`{"${ENC}":42}`)).toContain('kein Text')
    expect(meldung(`{"${ENC}":" ${WERT}"}`)).toContain('Leerraum')
  })
})

describe('konfigZumLoggen', () => {
  test('nennt die Anzahl, nie einen Wert und keine encId', () => {
    const c = { ...config, TPAPI_SCHLUESSEL: { [ENC]: WERT } }
    const text = JSON.stringify(konfigZumLoggen(c))
    expect(konfigZumLoggen(c).tpapi).toBe('1 Schluessel')
    expect(text).not.toContain(WERT)
    expect(text).not.toContain(ENC)
    expect(konfigZumLoggen({ ...config, TPAPI_SCHLUESSEL: {} }).tpapi).toBe('nicht konfiguriert')
  })

  test('der Rohtext steht nicht im Konfigurationsobjekt', () => {
    expect('LINA_API_SCHLUESSEL' in config).toBe(false)
  })
})
