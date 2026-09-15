/**
 * Das Dockerfile muss `pflege/` ins Image kopieren.
 *
 * Der Anlass (10.09.2026): `pflegeNachlauf()` las in Produktion nie eine
 * Datei — nicht, weil der Code falsch war, sondern weil der Ordner im
 * Container nicht existierte. `COPY src` und `COPY migrations` standen im
 * Dockerfile, `COPY pflege` nicht; `pflegeEinlesen()` kehrte auf `debug`
 * still zurueck, `sync.pflege_import` blieb leer, und der Round Table
 * fuehrte alle 56 operativen Betriebe mit fehlender OM-Note.
 *
 * Derselbe Pruefstil wie `sync/phasen.test.ts`: die Datei wird gelesen, nicht
 * gebaut. Ein Test, der ein Image baut, laeuft nirgends von selbst.
 */
import { describe, expect, test } from 'bun:test'

const dockerfile = await Bun.file(`${import.meta.dir}/../../Dockerfile`).text()
const zeilen = dockerfile.split('\n').filter(z => !z.trimStart().startsWith('#'))

describe('Dockerfile — was der Container braucht', () => {
  test('kopiert pflege/ ins Image', () => {
    expect(zeilen.some(z => /^COPY\s+pflege\s+\.\/pflege\b/.test(z))).toBe(true)
  })

  test('gibt pflege/ dieselben Leserechte wie src/ und migrations/', () => {
    const chmod = zeilen.find(z => /^RUN\s+chmod\s+-R\s+a\+rX\b/.test(z))
    expect(chmod).toBeDefined()
    for (const pfad of ['./src', './migrations', './pflege']) {
      expect(chmod!).toContain(pfad)
    }
  })

  test('COPY pflege steht VOR dem chmod, sonst greift er ins Leere', () => {
    const copy = zeilen.findIndex(z => /^COPY\s+pflege\b/.test(z))
    const chmod = zeilen.findIndex(z => /^RUN\s+chmod\s+-R\s+a\+rX\b/.test(z))
    expect(copy).toBeGreaterThan(-1)
    expect(copy).toBeLessThan(chmod)
  })
})
