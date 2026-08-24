/**
 * Die zwei Umrechnungen des Bounti-Laders — beide ohne Datenbank prüfbar,
 * beide von der Sorte, die im Betrieb keinen Fehler wirft, sondern eine
 * falsche Zahl liefert.
 *
 *   `alsProzent`      Bounti liefert die Kursnote als BRUCH ("0.8 is 80%"),
 *                     die Auditnote danebenals PROZENTZAHL (85). Wer das
 *                     verwechselt, bekommt eine Erfüllungsquote von 0,8 %
 *                     oder von 8.000 % — die erste sieht nur schlecht aus,
 *                     nicht falsch (AGENTS.md Regel 6).
 *
 * (Der frühere zweite Fall, `monatserster`, ist mit der Momentaufnahme des
 * Personalstands entfallen — siehe migrations/0096_bounti.sql, Abschnitt 2.)
 */
import { expect, test, describe } from 'bun:test'
import { alsProzent } from './laden'

describe('alsProzent', () => {
  test('der dokumentierte Fall: 0.8 wird zu 80', () => {
    expect(alsProzent(0.8)).toBe(80)
  })

  test('die Raender', () => {
    expect(alsProzent(0)).toBe(0)
    expect(alsProzent(1)).toBe(100)
  })

  test('zwei Nachkommastellen bleiben erhalten', () => {
    expect(alsProzent(0.6667)).toBe(66.67)
  })

  test('fehlt die Note, bleibt sie leer — 0 waere eine Aussage', () => {
    // Ein Pfad hat keine Abschlusspruefung. Eine 0 dort hiesse "durchgefallen".
    expect(alsProzent(null)).toBeNull()
    expect(alsProzent(undefined)).toBeNull()
  })

  test('ein Wert ueber 1 wird NICHT noch einmal mit 100 multipliziert', () => {
    // Wechselt Bounti die Skala, waere das die stille Katastrophe: aus 85
    // wuerden 8.500 -- und die Spalte laesst nur 0 bis 100 zu, der Import
    // schluege also fehl, statt falsch zu rechnen. Beides ist schlechter
    // als: erkennen, melden, uebernehmen.
    expect(alsProzent(85)).toBe(85)
  })

  test('Unbrauchbares wird verworfen, nicht gekappt', () => {
    // Eine gekappte Zahl sieht gueltig aus.
    expect(alsProzent(101)).toBeNull()
    expect(alsProzent(-1)).toBeNull()
    expect(alsProzent(Number.NaN)).toBeNull()
  })
})
