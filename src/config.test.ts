import { describe, expect, test } from 'bun:test'
import { fnZugaenge, type Config } from './config'

/**
 * Die Paarprüfung läuft in `laden()` beim Import des Moduls — getestet wird
 * sie deshalb im Subprozess, so wie sie im Ernstfall greift: beim Start,
 * nicht mitten im Backfill.
 */
const startMit = (env: Record<string, string>) =>
  Bun.spawnSync([process.execPath, '-e', 'await import("./src/config.ts")'], {
    cwd: import.meta.dir + '/..',
    env: { ...process.env, ...env },
  })

describe('FoodNotify-Zugangsdaten', () => {
  test('ein halbes Paar bricht den Start ab und nennt die Marke', () => {
    // Das Passwort EXPLIZIT leeren: seit dem 02.08.2026 liegt in der echten
    // .env ein vollständiges Aposto-Paar, und der Subprozess erbt sie — ohne
    // das Leeren wäre das halbe Paar still vollständig und der Test grün aus
    // dem falschen Grund.
    const p = startMit({ FN_APOSTO_USER: 'admin@aposto.eu', FN_APOSTO_PASSWORD: '' })
    expect(p.exitCode).not.toBe(0)
    const meldung = String(p.stderr)
    expect(meldung).toContain('FN_APOSTO')
    // Die Meldung sagt, WAS fehlt — nicht nur, DASS etwas fehlt.
    expect(meldung).toContain('gesetzt ist nur der Benutzer')
  })

  test('ein Passwort ohne Benutzer ebenso', () => {
    // Den Benutzer EXPLIZIT leeren, aus demselben Grund wie oben: seit dem
    // 02.08.2026 steht auch für Wilma Wunder ein vollständiges Paar in der
    // echten .env, und der Subprozess erbt sie. Ohne das Leeren wäre das
    // halbe Paar still vollständig und der Test grün aus dem falschen Grund.
    const p = startMit({ FN_WILMA_WUNDER_USER: '', FN_WILMA_WUNDER_PASSWORD: 'geheim' })
    expect(p.exitCode).not.toBe(0)
    expect(String(p.stderr)).toContain('FN_WILMA_WUNDER')
  })

  test('ein vollständiges Paar startet', () => {
    const p = startMit({ FN_APOSTO_USER: 'admin@aposto.eu', FN_APOSTO_PASSWORD: 'geheim' })
    expect(p.exitCode).toBe(0)
  })

  test('gar keine FoodNotify-Variablen starten ebenfalls — LINA läuft weiter wie bisher', () => {
    const p = startMit({})
    expect(p.exitCode).toBe(0)
  })

  test('fnZugaenge liefert nur vollständige Paare, mit dem Schlüssel aus core.marke', () => {
    const c = {
      FN_APOSTO_USER: 'a@aposto.eu', FN_APOSTO_PASSWORD: 'pa',
      FN_WILMA_WUNDER_USER: 'w@ww.de', FN_WILMA_WUNDER_PASSWORD: 'pw',
    } as unknown as Config
    const z = fnZugaenge(c)
    expect(z.map(x => x.schluessel).sort()).toEqual(['aposto', 'wilma_wunder'])
    expect(z.find(x => x.schluessel === 'aposto')).toEqual(
      { schluessel: 'aposto', user: 'a@aposto.eu', password: 'pa' })
  })

  test('ohne Konfiguration ist die Liste leer, kein Fehler', () => {
    expect(fnZugaenge({} as unknown as Config)).toEqual([])
  })
})
