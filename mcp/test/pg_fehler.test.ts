/**
 * Der echte Postgres-Fehler muss beim Modell ankommen — ohne Datenbank pruefbar.
 *
 * WAS HIER ABGESICHERT WIRD, ist der Befund vom 21.09.2026: `abfrage_ausfuehren`
 * gab auf JEDEN Fehler dieselbe Meldung zurueck, "current transaction is
 * aborted" (SQLSTATE 25P02). Damit war ein Tippfehler in einem Spaltennamen
 * von einer defekten Sicht nicht zu unterscheiden, und ein Modell konnte nur
 * eines tun: dieselbe Abfrage noch einmal anders formulieren.
 *
 * Die Gegenprobe gegen die echte Datenbank steht in ausfuehren.test.ts; hier
 * geht es um die Form der Meldung, und die braucht keine Verbindung.
 */
import { describe, expect, test } from 'bun:test'
import { istSichtDefekt, pgFehlerText, sqlstateVon, TRANSAKTION_ABGEBROCHEN,
         ZEITUEBERLAUF } from '../src/pg_fehler'

/** Ein Fehler, wie `pg` ihn wirft — mit allem, was daran haengt. */
const pgFehler = (f: Record<string, string>) => Object.assign(new Error(f.message), f)

describe('Die Postgres-Meldung', () => {

  test('SQLSTATE, Meldung, Hinweis und Zusammenhang stehen alle darin', () => {
    const text = pgFehlerText(pgFehler({
      code: '42501',
      message: 'permission denied for schema core',
      where: 'SQL function "geschaeftstag" during inlining',
    }))
    expect(text).toContain('42501')
    expect(text).toContain('permission denied for schema core')
    // Ohne diese Zeile war am 21.09.2026 nicht zu sehen, dass der Fehler aus
    // einem Funktionsrumpf kommt und nicht aus der Sicht selbst.
    expect(text).toContain('SQL function "geschaeftstag" during inlining')
  })

  test('Postgres eigener Vorschlag geht nicht verloren', () => {
    const text = pgFehlerText(pgFehler({
      code: '42703', message: 'column "umsaz_netto" does not exist',
      hint: 'Perhaps you meant to reference the column "umsatz_tag.umsatz_netto".',
      position: '8',
    }))
    expect(text).toContain('umsatz_tag.umsatz_netto')
    expect(text).toContain('Zeichen 8')
  })

  /**
   * Die Deutung ist der Unterschied zwischen einer Meldung und einer
   * brauchbaren Meldung: 42501 heisst hier etwas Bestimmtes, und das steht in
   * keiner Postgres-Zeile.
   */
  test('ein Rechteproblem sagt ausdruecklich, dass Umformulieren nicht hilft', () => {
    const text = pgFehlerText(pgFehler({ code: '42501', message: 'permission denied' })).toLowerCase()
    expect(text).toContain('umformulieren hilft nicht')
    expect(text).toContain('mart.sicht_defekt')
  })

  test('die Folgemeldung wird als Folgemeldung benannt, nicht als Ursache', () => {
    const text = pgFehlerText(pgFehler({
      code: TRANSAKTION_ABGEBROCHEN,
      message: 'current transaction is aborted, commands ignored until end of transaction block',
    }))
    expect(text).toContain('FOLGEMELDUNG')
    expect(text.toLowerCase()).toContain('serverfehler')
  })

  test('ohne SQLSTATE bleibt die Meldung trotzdem lesbar', () => {
    expect(pgFehlerText(new Error('Verbindung weg'))).toBe('Postgres: Verbindung weg')
    expect(sqlstateVon(new Error('x'))).toBeNull()
  })
})

describe('Was ein Defekt der Sicht ist und was nicht', () => {

  test('Rechte, fehlende Spalte und fehlende Sicht sind Defekte', () => {
    for (const code of ['42501', '42703', '42P01', '42883', '22012']) {
      expect(istSichtDefekt(pgFehler({ code, message: 'x' }))).toBe(true)
    }
  })

  /**
   * EIN ZEITUEBERLAUF IST KEIN DEFEKT. Sonst stuende nach einer langsamen
   * Nacht die halbe Auswertungsschicht in mart.sicht_defekt, der Pruefer
   * wiese gueltige Abfragen ab, und der Befund waere nichts mehr wert.
   */
  test('Zeitueberlauf, Ressourcen und Verbindungsabbruch sind keine Defekte', () => {
    for (const code of [ZEITUEBERLAUF, '53200', '57P01', '08006', '58030']) {
      expect(istSichtDefekt(pgFehler({ code, message: 'x' }))).toBe(false)
    }
  })

  test('die Folgemeldung ist kein Defekt — sie sagt nichts ueber die Sicht', () => {
    expect(istSichtDefekt(pgFehler({ code: TRANSAKTION_ABGEBROCHEN, message: 'x' }))).toBe(false)
  })
})
