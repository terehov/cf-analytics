/**
 * TPAPI Stufe 2 ohne Datenbank: das Endpunktregister, die Verdichtung von
 * `personalkostenprotag`, die Zeitzone von `listdays` und die gleitende
 * Grenze des Clients (gegen die Attrappe).
 *
 * Alle Clients bekommen Basis und Schlüssel AUSDRÜCKLICH — `bun test` lädt
 * die `.env` mit den echten Schlüsseln (Regel 7a), siehe client.test.ts.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  aktiveStammendpunkte, aktiveTagesendpunkte, ENDPUNKT_LISTDAYS, prognoseEndpunkt, stundeEndpunkt,
  TPAPI_ENDPUNKTE, VERBOTENE_PFADE,
} from './endpunkte'
import { ENDPUNKT_PERSONAL_STUNDE } from './laden'
import { LADERSTAND, TAGESENDPUNKTE } from './core_laden'
import { FormFehler } from './form'
import { geschaeftstageAusListdays, geschaeftstagAusEpoch, protagVerdichten } from './verdichtung'
import { epochFuerTag, protagZeilen, tpapiMockStarten } from './mock'
import { TpapiClient } from './client'

describe('Endpunktregister', () => {
  test('nur lesende Pfade — kein schreibender, kein personenbezogener ohne Auftrag (Regel 1, S4)', () => {
    const verboten = TPAPI_ENDPUNKTE.filter(e => VERBOTENE_PFADE.some(r => r.test(e.pfad)))
    expect(verboten.map(e => e.pfad)).toEqual([])
    // Und die Gegenprobe: die Liste der Verbote greift auch.
    expect(VERBOTENE_PFADE.some(r => r.test('personal/saveShift'))).toBe(true)
    expect(VERBOTENE_PFADE.some(r => r.test('personal/userdataperday'))).toBe(true)
    expect(VERBOTENE_PFADE.some(r => r.test('merchandiseman/recipe/42'))).toBe(true)
  })

  test('die Endpunkte aus Plan S3: listdays, drei Tagesendpunkte, Prognose (an seit 0153), dreizehn Artikellisten', () => {
    expect(ENDPUNKT_LISTDAYS.pfad).toBe('revenue/listdays')
    expect(aktiveTagesendpunkte().map(e => e.pfad).sort()).toEqual(
      ['personal/personalkostenprotag', 'revenue/journal', 'revenue/journaltables'])
    expect(aktiveStammendpunkte()).toHaveLength(13)
    expect(aktiveStammendpunkte().every(e => e.modul === 'artikel' && e.pfad.startsWith('merchandiseman/'))).toBe(true)
    // Die Prognose ist ein Bereichsabruf, kein Stamm: sonst holte der Wochenabzug sie ohne from/to.
    expect(prognoseEndpunkt()).toMatchObject({ pfad: 'revenue/getforecastperday', art: 'bereich', modul: 'revenue' })
  })

  /**
   * Personal je Stunde steht seit 0153 im Register (Plan S3) — als Art
   * `stunde`, damit weder das Dreitagesfenster noch die VALUES-Listen aus 0151
   * ihn erfassen; geladen wird er mit dem Lader aus Stufe 1 und unter dessen
   * raw-Namen.
   */
  test('Personal je Stunde: im Register, aber nicht im Fenster und nicht in den Rueckstandssichten aus 0151', () => {
    const st = stundeEndpunkt()!
    expect(st).toMatchObject({ pfad: 'personal/personalkostenprostunde', art: 'stunde', modul: 'personal', fensterTage: 0 })
    expect(st.endpunkt).toBe(ENDPUNKT_PERSONAL_STUNDE)
    expect(aktiveTagesendpunkte()).not.toContain(st)
    expect(aktiveStammendpunkte()).not.toContain(st)
  })

  /** Der Lader raw → core (0153) kennt jeden Endpunkt, der nach core soll — und nur die. */
  test('der Lader hat fuer jeden Tages-, Stamm- und Bereichsendpunkt einen Laderstand', () => {
    const erwartet = [...aktiveTagesendpunkte(), ...aktiveStammendpunkte(), prognoseEndpunkt()!]
      .map(e => e.endpunkt).sort()
    expect(Object.keys(LADERSTAND).sort()).toEqual(erwartet)
    expect([...TAGESENDPUNKTE].sort() as string[]).toEqual(aktiveTagesendpunkte().map(e => e.endpunkt).sort())
    // Und die Startbelegung in 0153 nennt dieselben Endpunkte.
    const sql = readFileSync(join(import.meta.dir, '..', '..', 'migrations', '0153_tpapi_core.sql'), 'utf8')
    const block = /FROM unnest\(ARRAY\[([\s\S]*?)\]\) AS e/.exec(sql)![1]!
    const seed = [...block.matchAll(/'(tpapi:[a-z]+)'/g)].map(m => m[1]).sort()
    expect(seed).toEqual(erwartet)
  })

  test('raw-Namen eindeutig, Muster tpapi:<name>; Fenster 3 Tage; nur protag wird verdichtet', () => {
    const namen = TPAPI_ENDPUNKTE.map(e => e.endpunkt)
    expect(new Set(namen).size).toBe(namen.length)
    expect(namen.every(n => /^tpapi:[a-z]+$/.test(n))).toBe(true)
    // Den Namen aus Stufe 1 trägt nur der Eintrag der Art `stunde` (0153) —
    // derselbe Endpunkt, derselbe Lader, kein zweiter Rohname.
    expect(TPAPI_ENDPUNKTE.filter(e => e.endpunkt === 'tpapi:personalkostenprostunde').map(e => e.art)).toEqual(['stunde'])
    for (const e of aktiveTagesendpunkte()) expect(e.fensterTage).toBe(3)
    expect(TPAPI_ENDPUNKTE.filter(e => e.verdichten).map(e => e.name)).toEqual(['personalkostenprotag'])
  })

  /**
   * Die Sichten aus 0151 tragen die Endpunktliste fest (VALUES) — eine Sicht
   * kann das Register nicht lesen. Kommt ein Tagesendpunkt dazu oder fällt
   * einer weg, muss eine Migration die Sichten nachziehen; sonst holt das
   * Nachladen einen Endpunkt nie (oder fragt einen, den es nicht mehr gibt).
   */
  test('die Endpunktliste in mart.tpapi_rueckstand(_tag) ist die des Registers', () => {
    const sql = readFileSync(join(import.meta.dir, '..', '..', 'migrations', '0151_tpapi_rohabzug.sql'), 'utf8')
    const bloecke = [...sql.matchAll(/WITH ep\(endpunkt, modul\) AS \(\s*VALUES([\s\S]*?)\n\),/g)]
    expect(bloecke).toHaveLength(2)
    const erwartet = aktiveTagesendpunkte().map(e => `${e.endpunkt}|${e.modul}`).sort()
    for (const b of bloecke) {
      const paare = [...b[1]!.matchAll(/\('([^']+)',\s*'([^']+)'\)/g)].map(m => `${m[1]}|${m[2]}`).sort()
      expect(paare).toEqual(erwartet)
    }
  })
})

describe('personalkostenprotag: Verdichtung vor raw (S5)', () => {
  test('vier Personen → eine Summe, Zahl-Text und Gleitkomma gerundet', () => {
    const v = protagVerdichten(protagZeilen('03.11.2026'))
    expect(v).toEqual({
      personen: 4,
      h_brutto: 30.08,            // 8.50 + 6.25 + 4.00 + 11.33
      h_zuschl_25: 1.5,
      h_zuschl_40: 2,
      h_zuschl_50: 0.5,
      brutto: 514.08,             // 123.45 + 98.76 + 80.77 + 211.10
      lohnkosten: 625.85,         // 151.17 + 120.94 + 95.24 + 258.50
    })
  })

  test('leer: [] und {} sind ein Tag ohne Personen', () => {
    const null6 = { h_brutto: 0, h_zuschl_25: 0, h_zuschl_40: 0, h_zuschl_50: 0, brutto: 0, lohnkosten: 0 }
    expect(protagVerdichten([])).toEqual({ personen: 0, ...null6 })
    expect(protagVerdichten({})).toEqual({ personen: 0, ...null6 })
  })

  test('PHP-Objekt mit Zeilen als Werten, Komma als Dezimalzeichen, leere Werte', () => {
    const v = protagVerdichten({ 3: { h_brutto: '7,5', brutto: '' }, 7: { h_brutto: null, lohnkosten: 10 } })
    expect(v.personen).toBe(2)
    expect(v.h_brutto).toBe(7.5)
    expect(v.brutto).toBe(0)
    expect(v.lohnkosten).toBe(10)
  })

  test('ein unbekanntes Feld erscheint mit NAMEN, nie mit Wert', () => {
    const v = protagVerdichten([{ h_brutto: 1, personalnummer: 'PN-GEHEIM-4711' }])
    expect(v.unbekannte_felder).toEqual(['personalnummer'])
    expect(JSON.stringify(v)).not.toContain('GEHEIM')
  })

  test('Formfehler nennen Zeile und Feld, nie den Wert', () => {
    const fange = (d: unknown) => {
      try { protagVerdichten(d) } catch (e) {
        expect(e).toBeInstanceOf(FormFehler)
        return (e as Error).message
      }
      throw new Error('kein Formfehler')
    }
    const m1 = fange([{ brutto: 1 }, { lohnkosten: 'GEHEIM-1234,56 EUR' }])
    expect(m1).toContain('Zeile 2')
    expect(m1).toContain('lohnkosten')
    expect(m1).not.toContain('GEHEIM')
    expect(m1).not.toContain('1234')
    expect(fange([{ brutto: { betrag: 99.99 } }])).not.toContain('99.99')
    expect(fange(['GEHEIM'])).not.toContain('GEHEIM')
    expect(fange('GEHEIM')).not.toContain('GEHEIM')
    expect(fange(null)).toContain('weder Liste noch Objekt')
  })
})

/**
 * Die Zeitzone von `listdays`. ANNAHME (nicht gemessen): der Wert ist ein
 * Zeitpunkt AM Geschäftstag; der Tag ist sein Berliner Kalendertag. Geprüft
 * wird, dass Berliner Mitternacht UND Mitternacht UTC denselben Tag ergeben —
 * über UTC gerechnet wäre Berliner Mitternacht ein Tag zu früh.
 */
describe('listdays: Unix-Sekunden → Geschäftstag', () => {
  test('Mitternacht UTC → derselbe Tag', () => {
    expect(geschaeftstagAusEpoch(Date.UTC(2026, 10, 8) / 1000)).toBe('2026-11-08')
    expect(geschaeftstagAusEpoch(Date.UTC(2026, 6, 15) / 1000)).toBe('2026-07-15')
  })

  test('Berliner Mitternacht → derselbe Tag, nicht der Vortag (Winter und Sommer)', () => {
    // 08.11.2026 00:00 MEZ = 07.11.2026 23:00 UTC
    const winter = Date.UTC(2026, 10, 7, 23) / 1000
    expect(new Date(winter * 1000).toISOString().slice(0, 10)).toBe('2026-11-07')   // so rechnete UTC
    expect(geschaeftstagAusEpoch(winter)).toBe('2026-11-08')
    // 15.07.2026 00:00 MESZ = 14.07.2026 22:00 UTC
    expect(geschaeftstagAusEpoch(Date.UTC(2026, 6, 14, 22) / 1000)).toBe('2026-07-15')
  })

  test('an den Umstellungstagen', () => {
    for (const tag of ['2026-03-29', '2026-03-30', '2026-10-25', '2026-10-26']) {
      expect(geschaeftstagAusEpoch(epochFuerTag(tag))).toBe(tag)
      expect(geschaeftstagAusEpoch(epochFuerTag(tag, true))).toBe(tag)
    }
  })

  test('Liste: Objekte, Zahlen, Zahl-Text; Doppelte fallen weg; Mitternacht wird gezählt', () => {
    const r = geschaeftstageAusListdays([
      { businessdate: epochFuerTag('2026-11-08') },
      { businessdate: String(epochFuerTag('2026-11-07')) },
      epochFuerTag('2026-11-06', true),
      { businessdate: epochFuerTag('2026-11-08') },
    ])
    expect(r.tage).toEqual(['2026-11-06', '2026-11-07', '2026-11-08'])
    expect(r.nichtBerlinerMitternacht).toBe(1)   // der UTC-Wert
  })

  test('alles andere ist ein Formfehler — ein still leerer Rückstand sähe aus wie „alles geholt"', () => {
    expect(() => geschaeftstageAusListdays({ tage: [] })).toThrow(FormFehler)
    expect(() => geschaeftstageAusListdays([{ businessdate: 'gestern' }])).toThrow(FormFehler)
    expect(() => geschaeftstageAusListdays([{ datum: 1 }])).toThrow(FormFehler)
    expect(geschaeftstageAusListdays([]).tage).toEqual([])
  })
})

describe('Client: gleitende Grenze je Betrieb (S8)', () => {
  const A = 'a'.repeat(40)
  const B = 'b'.repeat(40)
  const C = 'c'.repeat(40)
  const SCHLUESSEL = { [A]: 'grenze-schluessel-aaaa', [B]: 'grenze-schluessel-bbbb', [C]: 'grenze-schluessel-cccc' }
  const mock = tpapiMockStarten({ schluessel: SCHLUESSEL, bremsenFuer: [C] })
  afterAll(() => mock.stoppen())
  const neu = (grenze: number, fensterMs: number) => new TpapiClient({
    basis: mock.url, schluessel: SCHLUESSEL, taktMs: 0, timeoutMs: 5_000,
    grenzeJeBetrieb: grenze, grenzeFensterMs: fensterMs,
  })

  test('freiIn: frei bis zur Grenze, dann die Zeit bis zum ersten Platz — je Betrieb', async () => {
    const c = neu(3, 60_000)
    expect(c.freiIn(A)).toBe(0)
    for (let i = 0; i < 3; i++) await c.holen(A, 'merchandiseman/vat')
    const w = c.freiIn(A)
    expect(w).toBeGreaterThan(59_000)
    expect(w).toBeLessThanOrEqual(60_000)
    // Ein anderer Betrieb ist davon unberührt.
    expect(c.freiIn(B)).toBe(0)
  })

  test('holen() wartet als letzte Sicherung, statt die Grenze zu reißen', async () => {
    mock.aufrufe.length = 0
    const c = neu(2, 400)
    const t0 = Date.now()
    for (let i = 0; i < 3; i++) await c.holen(B, 'merchandiseman/vat')
    const zeiten = mock.aufrufe.filter(a => a.encId === B).map(a => a.zeit)
    expect(zeiten).toHaveLength(3)
    expect(zeiten[2]! - zeiten[0]!).toBeGreaterThanOrEqual(390)
    expect(Date.now() - t0).toBeLessThan(3_000)
  })

  test('429 merkt sich der Client für den Lauf — gefragt wird trotzdem nicht erneut von selbst', async () => {
    mock.aufrufe.length = 0
    const c = neu(60, 900_000)
    expect(c.gebremst(C)).toBe(false)
    const a = await c.holen(C, 'merchandiseman/vat')
    expect(a.art).toBe('gebremst')
    expect(c.gebremst(C)).toBe(true)
    expect(c.gebremst(A)).toBe(false)
    expect(mock.aufrufe).toHaveLength(1)
  })
})
