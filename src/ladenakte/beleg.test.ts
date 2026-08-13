/**
 * Das Belegdatum, das nicht sein kann (Migration `0077`, Plan 5.4).
 *
 * DER BEFUND. Am 14.08.2026 in Produktion: 13 von 605.835 Belegen tragen ein
 * Belegdatum mehr als ein Jahr NACH ihrem eigenen Hochladedatum, vier davon auf
 * **2038-01-19**. `max(monat)` stand damit in vier Mart-Sichten auf Januar
 * 2038, und 20 Lieferanten führten ein Zukunftsdatum als „letzter Beleg".
 *
 * Diese Tests brauchen keine Datenbank: die Regel ist eine Rechnung auf zwei
 * Werten derselben Zeile, und sie soll vor dem Deploy ausschlagen.
 */
import { describe, expect, test } from 'bun:test'
import { belegDatum } from './laden'

const upload = (iso: string) => new Date(`${iso}T12:00:00Z`)

describe('belegDatum', () => {
  test('ein normales Belegdatum geht unveraendert durch', () => {
    expect(belegDatum('15.06.2026', upload('2026-06-20')))
      .toEqual({ datum: '2026-06-15', unglaubhaft: null })
  })

  /**
   * Der eigentliche Fall. Alle vier 2038er-Belege sind 2025 hochgeladen
   * worden — der Abstand ist dreizehn Jahre, kein Grenzfall.
   */
  test('2038 auf einem Upload von 2025 wird verworfen und bleibt lesbar', () => {
    expect(belegDatum('19.01.2038', upload('2025-02-05')))
      .toEqual({ datum: null, unglaubhaft: '2038-01-19' })
  })

  /**
   * DIE GRENZE IST BEWUSST WEIT. Voraus-, Dauer- und Wartungsrechnungen
   * datieren regulär in die Zukunft; gemessen liegen 39 Belege mehr als
   * dreissig Tage voraus, aber nur 13 mehr als ein Jahr. Wer hier enger
   * filtert, verwirft echte Belege.
   */
  test('ein halbes Jahr voraus ist eine Vorausrechnung und bleibt', () => {
    expect(belegDatum('01.10.2026', upload('2026-05-12')))
      .toEqual({ datum: '2026-10-01', unglaubhaft: null })
  })

  test('elf Monate voraus bleiben, dreizehn nicht', () => {
    expect(belegDatum('01.05.2027', upload('2026-06-01')).datum).toBe('2027-05-01')
    expect(belegDatum('01.07.2027', upload('2026-06-01')).datum).toBeNull()
  })

  /**
   * RUECKWAERTS WIRD NICHT GEFILTERT. 6.802 Belege datieren mehr als zehn
   * Jahre vor ihrem Upload — nachgereichte Altbelege, keine Fehler. Sie
   * stoeren auch nichts, weil max(monat) nach oben misst.
   */
  test('ein elf Jahre alter Beleg ist ein Nachtrag, kein Fehler', () => {
    expect(belegDatum('09.06.2015', upload('2026-04-22')))
      .toEqual({ datum: '2015-06-09', unglaubhaft: null })
  })

  /**
   * Ohne Hochladedatum gibt es keine Bezugsgroesse. Dann wird NICHT geraten —
   * eine feste Jahresschranke waere genau die Sorte Regel, die still veraltet.
   */
  test('ohne Hochladedatum wird nicht geurteilt', () => {
    expect(belegDatum('19.01.2038', null))
      .toEqual({ datum: '2038-01-19', unglaubhaft: null })
  })

  test('was kein Datum ist, bleibt NULL und nicht heute', () => {
    expect(belegDatum('', upload('2026-06-01'))).toEqual({ datum: null, unglaubhaft: null })
    expect(belegDatum('-', upload('2026-06-01'))).toEqual({ datum: null, unglaubhaft: null })
    expect(belegDatum(undefined, upload('2026-06-01'))).toEqual({ datum: null, unglaubhaft: null })
  })
})
