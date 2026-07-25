/**
 * Tests der Transformationslogik gegen die ECHTEN (anonymisierten) Antworten
 * aus der Phase-1-Exploration. Keine erfundenen Beispiele — die Fixtures in
 * fixtures/ sind das, was LINA am 25.07.2026 tatsächlich geliefert hat.
 *
 * Lauf: bun test src/transform/transform.test.ts
 */
import { expect, test, describe } from 'bun:test'
import {
  umsatzbericht, personalkosten, kennzahlen,
  zeitzonenbericht, vordefinierteZeitzonen, artikelverkauf,
} from './index'
import { PersonalkostenSchema } from '../lina/schemas'

const fixture = (name: string) =>
  require(`./fixtures/${name}.json`) as any

describe('umsatzbericht', () => {
  const daten = fixture('getUmsatzbericht')

  test('bildet jede Betriebszeile ab', () => {
    const zeilen = umsatzbericht(daten, '2026-06-15')
    expect(zeilen).toHaveLength(daten.stores.length)
  })

  test('übernimmt LINAs Felder unverändert', () => {
    const [, zweiter] = umsatzbericht(daten, '2026-06-15')
    expect(zweiter.umsatzNetto).toBe(436198.85)
    expect(zweiter.rechnungen).toBe(14477)
    expect(zweiter.gaeste).toBe(14977)
    // avgTicket/avgGuest kommen fertig — nicht selbst rechnen
    expect(zweiter.durchschnittsbon).toBe(30.13)
    expect(zweiter.umsatzProGast).toBe(29.12)
  })

  test('merkt sich die Hauptsparte, damit Gesamt und Sparte unterscheidbar bleiben', () => {
    expect(umsatzbericht(daten, '2026-06-15')[0].hauptspartePosId).toBeNull()
    expect(umsatzbericht(daten, '2026-06-15', 10001)[0].hauptspartePosId).toBe(10001)
  })
})

describe('personalkosten', () => {
  const daten = fixture('getPersonalkosten')

  test('trennt Kennzahlen und betriebsindividuelle Schwellen', () => {
    const { kosten, schwellen } = personalkosten(daten, '2026-06-01', '2026-06-30')
    expect(kosten).toHaveLength(2)
    expect(schwellen).toHaveLength(2)
  })

  test('persoogBwa ist die Excel-Spalte "Personalkosten o. GF %"', () => {
    const { kosten } = personalkosten(daten, '2026-06-01', '2026-06-30')
    expect(kosten[0].persoogBwa).toBe(34.97)
    expect(kosten[1].persoogBwa).toBe(38.27)
  })

  test('pekThreshold wird als [grün, orange, rot] gelesen — LINA liefert Strings', () => {
    const { schwellen } = personalkosten(daten, '2026-06-01', '2026-06-30')
    expect(schwellen[0]).toMatchObject({ bereich: 'personal', gruen: 29, orange: 35, rot: 50 })
    // zweiter Betrieb hat ANDERE Schwellen — genau darum ist das Regelwerk umschaltbar
    expect(schwellen[1]).toMatchObject({ gruen: 30, orange: 34 })
  })

  /**
   * Der erste echte Lauf am 25.07.2026 zeigte: LINA liefert die Schwellen mal
   * als String, mal als Zahl — je Betrieb unterschiedlich. Die Exploration sah
   * nur Strings, weil sie nur 2 von 141 Betrieben umfasste; der Schemawächter
   * schlug deshalb sofort an. Beides muss dasselbe ergeben, sonst hängt der
   * Ampelwert davon ab, in welchem Format LINA gerade antwortet.
   */
  test('mischt LINA Strings und Zahlen, kommt dasselbe heraus', () => {
    const s = (d: unknown) => personalkosten(d, '2026-06-01', '2026-06-30').schwellen[0]
    const erwartet = { gruen: 29, orange: 35, rot: 50 }
    expect(s({ stores: [{ encId: 'a', pekThreshold: ['29', '35', '50'] }] })).toMatchObject(erwartet)
    expect(s({ stores: [{ encId: 'a', pekThreshold: [29, 35, 50] }] })).toMatchObject(erwartet)
    expect(s({ stores: [{ encId: 'a', pekThreshold: ['29', 35, '50'] }] })).toMatchObject(erwartet)
  })

  /**
   * Passend dazu das Schema: Es muss beide Formen durchlassen, sonst meldet
   * JEDER Backfill-Posten eine Abweichung und die eine echte geht unter.
   */
  test('das Schema akzeptiert Schwellen als String UND als Zahl', () => {
    const bau = (t: unknown[]) => ({
      timeframe: '2026-06', stores: [{
        name: 'Test', encId: 'a',
        effService: 0, effBar: 0, effKueche: 0, effGesamt: 0,
        pekService: 0, pekBar: 0, pekKueche: 0, pekGesamt: 0,
        pekThreshold: t, thresholds: { '-1': t }, persoogBwa: 0,
      }],
    })
    expect(PersonalkostenSchema.safeParse(bau(['29', '35', '50'])).success).toBe(true)
    expect(PersonalkostenSchema.safeParse(bau([29, 35, 50])).success).toBe(true)
    expect(PersonalkostenSchema.safeParse(bau(['29', 35, '50'])).success).toBe(true)
  })

  /**
   * Der erste echte Lauf am 25.07.2026 zeigte: LINA liefert die Schwellen mal
   * als String, mal als Zahl — je Betrieb unterschiedlich. Die Exploration sah
   * nur Strings, weil sie nur 2 von 141 Betrieben umfasste; der Schemawächter
   * schlug deshalb sofort an.
   *
   * Beides muss dasselbe ergeben, sonst hängt der Ampelwert davon ab, in
   * welchem Format LINA gerade antwortet.
   */
  test('mischt LINA Strings und Zahlen, kommt dasselbe heraus', () => {
    const s = (d: unknown) => personalkosten(d, '2026-06-01', '2026-06-30').schwellen[0]
    const erwartet = { gruen: 29, orange: 35, rot: 50 }
    expect(s({ stores: [{ encId: 'a', pekThreshold: ['29', '35', '50'] }] })).toMatchObject(erwartet)
    expect(s({ stores: [{ encId: 'a', pekThreshold: [29, 35, 50] }] })).toMatchObject(erwartet)
    expect(s({ stores: [{ encId: 'a', pekThreshold: ['29', 35, '50'] }] })).toMatchObject(erwartet)
  })

  /**
   * Passend dazu das Schema in src/lina/schemas.ts: Es muss beide Formen
   * durchlassen, sonst meldet JEDER Backfill-Posten eine Abweichung und die
   * eine echte geht im Rauschen unter.
   */
  test('das Schema akzeptiert Schwellen als String UND als Zahl', () => {
    const bau = (t: unknown[]) => ({
      timeframe: '2026-06', stores: [{
        name: 'Test', encId: 'a',
        effService: 0, effBar: 0, effKueche: 0, effGesamt: 0,
        pekService: 0, pekBar: 0, pekKueche: 0, pekGesamt: 0,
        pekThreshold: t, thresholds: { '-1': t }, persoogBwa: 0,
      }],
    })
    expect(PersonalkostenSchema.safeParse(bau(['29', '35', '50'])).success).toBe(true)
    expect(PersonalkostenSchema.safeParse(bau([29, 35, 50])).success).toBe(true)
    expect(PersonalkostenSchema.safeParse(bau(['29', 35, '50'])).success).toBe(true)
  })
})

describe('kennzahlen', () => {
  const daten = fixture('getKennzahlen')

  test('löst die drei Ebenen auf und liefert nur belegte Monate', () => {
    const zeilen = kennzahlen(daten, 2026)
    expect(zeilen.length).toBeGreaterThan(0)
    expect(zeilen.every(z => z.wert !== null)).toBe(true)
  })

  test('liest die fünf festen Kennzahlen wortwörtlich wie LINA', () => {
    const namen = new Set(kennzahlen(daten, 2026).map(z => z.kennzahl))
    expect(namen).toContain('Umsatz')
    expect(namen).toContain('EBIT')
    expect(namen).toContain('WE Bar')
    expect(namen).toContain('WE Küche')
    expect(namen).toContain('Personalkosten ohne GF')
  })

  test('Juniwerte stimmen mit der Antwort überein', () => {
    const juni = kennzahlen(daten, 2026).filter(z => z.monat === '2026-06-01')
    const map = Object.fromEntries(juni.map(z => [z.kennzahl, z.wert]))
    expect(map['Umsatz']).toBe(68433.72)
    expect(map['WE Bar']).toBe(4954.27)
    expect(map['WE Küche']).toBe(12057.28)
    expect(map['Personalkosten ohne GF']).toBe(27362.87)
  })

  test('dedupliziert Betriebe, die in mehreren Konzepten hängen', () => {
    // Künstlich doppelte Gruppe: prüft die Schutzfunktion, nicht einen
    // beobachteten Fall. Ob LINA denselben Betriebsschlüssel je in zwei
    // Gruppen liefert, ist offen — siehe migrations/0005_konzept_korrektur.sql.
    const doppelt = { groups: [ daten.groups[0], daten.groups[0] ] }
    expect(kennzahlen(doppelt, 2026)).toHaveLength(kennzahlen(daten, 2026).length)
  })
})

describe('zeitzonenbericht', () => {
  const daten = fixture('getZeitzonenbericht')

  test('Stunden ab 8 gehören zum Kalendertag', () => {
    const zeilen = zeitzonenbericht(daten, '2026-06-15')
    expect(zeilen.find(z => z.stunde === 14)!.geschaeftstag).toBe('2026-06-15')
  })

  test('Stunden vor 8 gehören zum Vortag — Geschäftstag 08:00–07:59', () => {
    const zeilen = zeitzonenbericht(daten, '2026-06-15')
    expect(zeilen.find(z => z.stunde === 3)!.geschaeftstag).toBe('2026-06-14')
    expect(zeilen.find(z => z.stunde === 7)!.geschaeftstag).toBe('2026-06-14')
    expect(zeilen.find(z => z.stunde === 8)!.geschaeftstag).toBe('2026-06-15')
  })

  test('liefert alle 24 Stunden je Betrieb', () => {
    expect(zeitzonenbericht(daten, '2026-06-15')).toHaveLength(24 * daten.stores.length)
  })
})

describe('vordefinierte Zeitzonen', () => {
  test('bildet Zone auf Umsatz ab', () => {
    const daten = fixture('getVordefinierteZeitzonenBericht')
    const zeilen = vordefinierteZeitzonen(daten, '2026-06-15')
    expect(zeilen).toHaveLength(6 * daten.stores.length)
    expect(zeilen.map(z => z.linaZoneId).sort()).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('artikelverkauf', () => {
  const daten = fixture('getArtikelverkaufsbericht')

  test('zieht den Artikelstamm inklusive fixed_we', () => {
    const { stamm } = artikelverkauf(daten, '2026-06-15')
    const aperol = stamm.find(a => a.artikelnummer === 450003)!
    expect(aperol.name).toBe('Aperol Spritz')
    // Basis für den theoretischen Wareneinsatz — macht die Rezepturauflösung entbehrlich
    expect(aperol.fixerWe).toBe(0.83)
  })

  test('überspringt Artikel ohne Verkauf', () => {
    // Sonst entstünden 141 × 6.451 Zeilen pro Tag statt der tatsächlich verkauften.
    const { zeilen } = artikelverkauf(daten, '2026-06-15')
    expect(zeilen.every(z => z.menge !== null && z.menge !== 0)).toBe(true)
  })

  test('verbindet Menge, Umsatz und Preis über die Artikelnummer', () => {
    const { zeilen } = artikelverkauf(daten, '2026-06-15')
    const z = zeilen.find(x => x.artikelnummer === 450003)!
    expect(z.menge).toBe(128)
    expect(z.umsatzNetto).toBe(812.48)
    expect(z.verkaufspreis).toBe(7.55)
  })

  test('verträgt fehlende Teilmaps', () => {
    const ohnePreise = { ...daten, rows: daten.rows.map((r: any) => ({ ...r, prices: undefined })) }
    const { zeilen } = artikelverkauf(ohnePreise, '2026-06-15')
    expect(zeilen[0].verkaufspreis).toBeNull()
    expect(zeilen[0].menge).toBe(128)
  })
})

describe('Robustheit', () => {
  test('leere und kaputte Antworten werfen nicht', () => {
    for (const fn of [
      () => umsatzbericht({}, '2026-06-15'),
      () => umsatzbericht(null, '2026-06-15'),
      () => zeitzonenbericht({ stores: [] }, '2026-06-15'),
      () => artikelverkauf({}, '2026-06-15'),
      () => kennzahlen({}, 2026),
    ]) {
      expect(fn).not.toThrow()
    }
  })
})
