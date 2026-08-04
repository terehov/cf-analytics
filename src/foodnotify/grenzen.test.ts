/**
 * Takt und Tagesbudget je ANBIETER, nicht für den Importer als Ganzes.
 *
 * LINA und FoodNotify sind zwei Firmen, zwei Verträge, zwei Risiken. Bis
 * zum 02.08.2026 teilten sie sich beides:
 *
 *   * denselben Takt (`TAKT_MIN_MS`/`TAKT_MAX_MS`) — eine Drosselung
 *     gegenüber dem einen bremste den anderen mit,
 *   * dasselbe `TAGESBUDGET`, gezählt über ALLE Zeilen in `sync.aufgabe`.
 *     Ein FoodNotify-Backfill mit 36.000 Posten hätte LINAs Tagesdaten
 *     an einer Grenze scheitern lassen, die gar nicht für sie gilt.
 *
 * Geprüft wird deshalb die Trennung selbst — und der Rückfall: wer nichts
 * konfiguriert, muss weiterhin das vorsichtigere LINA-Verhalten bekommen.
 */

import { describe, expect, test } from 'bun:test'
import { fnGrenzen, type Config } from '../config'

const c = (o: Record<string, unknown>) => ({
  TAKT_MIN_MS: 10_000, TAKT_MAX_MS: 20_000, TAGESBUDGET: 6_000, ...o,
} as unknown as Config)

describe('fnGrenzen — die geltenden FoodNotify-Werte', () => {
  test('ohne eigene Variablen gelten LINAs Werte', () => {
    // Wer nichts setzt, bekommt das vorsichtigere Verhalten — nicht das
    // schnellere. Ein Standardwert darf nie riskanter sein als der Rückfall.
    expect(fnGrenzen(c({}))).toEqual({
      taktMin: 10_000, taktMax: 20_000, tagesbudget: 6_000, eigen: false,
    })
  })

  test('eigene Werte gewinnen', () => {
    const g = fnGrenzen(c({ FN_TAKT_MIN_MS: 3_000, FN_TAKT_MAX_MS: 6_000, FN_TAGESBUDGET: 40_000 }))
    expect(g).toEqual({ taktMin: 3_000, taktMax: 6_000, tagesbudget: 40_000, eigen: true })
  })

  test('einzeln gesetzte Werte mischen sich mit den geerbten', () => {
    // Nur das Budget angehoben, Takt bleibt LINAs — ein häufiger Fall beim
    // beaufsichtigten Backfill.
    const g = fnGrenzen(c({ FN_TAGESBUDGET: 40_000 }))
    expect(g.tagesbudget).toBe(40_000)
    expect(g.taktMin).toBe(10_000)
    expect(g.eigen).toBe(true)
  })

  test('`eigen` meldet ehrlich, ob überhaupt etwas gesetzt ist', () => {
    // Diese Angabe steht im Startprotokoll. Behauptete sie eigene Grenzen,
    // wo keine sind, läse man aus dem Log ein Tempo heraus, das nicht gilt.
    expect(fnGrenzen(c({})).eigen).toBe(false)
    expect(fnGrenzen(c({ FN_TAKT_MIN_MS: 3_000 })).eigen).toBe(true)
  })
})

describe('Startprüfung', () => {
  const startMit = (env: Record<string, string>) =>
    Bun.spawnSync([process.execPath, '-e', 'await import("./src/config.ts")'], {
      cwd: import.meta.dir + '/../..',
      env: { ...process.env, ...env },
    })

  test('FN_TAKT_MIN_MS größer als FN_TAKT_MAX_MS bricht den Start ab', () => {
    const p = startMit({ FN_TAKT_MIN_MS: '9000', FN_TAKT_MAX_MS: '3000' })
    expect(p.exitCode).not.toBe(0)
    const meldung = String(p.stderr)
    expect(meldung).toContain('FN_TAKT_MIN_MS')
    // Die Meldung nennt die WERTE — sonst sucht man in vier Variablen.
    expect(meldung).toContain('9000')
  })

  test('ein einzeln gesetztes FN_TAKT_MIN_MS wird gegen LINAs Höchstwert geprüft', () => {
    /**
     * Der stille Fall: nur der Mindesttakt gesetzt, und zwar größer als
     * der geerbte Höchstwert. Ohne Prüfung auf den EFFEKTIVEN Werten
     * liefe FoodNotify mit einer Spanne, die es nicht gibt.
     */
    const p = startMit({ TAKT_MAX_MS: '5000', TAKT_MIN_MS: '1000', FN_TAKT_MIN_MS: '9000' })
    expect(p.exitCode).not.toBe(0)
    expect(String(p.stderr)).toContain('FN_TAKT_MIN_MS')
  })

  test('gültige eigene Werte starten', () => {
    const p = startMit({ FN_TAKT_MIN_MS: '3000', FN_TAKT_MAX_MS: '6000', FN_TAGESBUDGET: '40000' })
    expect(p.exitCode).toBe(0)
  })

  test('gar keine FN_-Grenzen starten ebenfalls', () => {
    const p = startMit({})
    expect(p.exitCode).toBe(0)
  })
})
