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
  warengruppeAusText, artikelWarengruppen, feinsparten, lieferanten,
  waren, einheiten, bestellungen, inventurtermine, betriebeMitLinaId,
  konzepte, betriebKonzepte, aktionsbericht,
} from './index'
import { PersonalkostenSchema, AktionsberichtSchema } from '../lina/schemas'

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

  /**
   * Der Befund vom 27.07.2026: vier Tage im Oktober 2018 brachen den Import
   * ab, weil LINA in `bills`/`guests` Werte zwischen 3,0 und 3,9 Milliarden
   * lieferte — im Muster einer ID, nicht einer Anzahl.
   *
   * Wichtig ist hier BEIDES: der Wert darf nicht durchrutschen (sonst
   * verdirbt er jeden Durchschnitt), und der Umsatz desselben Betriebs muss
   * erhalten bleiben (sonst kostet ein kaputtes Feld den ganzen Tag).
   */
  test('eine Anzahl jenseits von int4 wird verworfen, nicht gespeichert', () => {
    const kaputt = { stores: [{
      encId: 'abc', name: 'Test',
      umsatzNetto: 1234.5, umsatzBrutto: 1469.06,
      bills: 3010725105, guests: 42, avgTicket: 30.1, avgGuest: 29.4,
    }] }
    const [zeile] = umsatzbericht(kaputt, '2018-10-10')

    expect(zeile!.rechnungen).toBeNull()
    expect(zeile!.verworfen).toEqual([{ feld: 'bills', wert: 3010725105 }])

    // Der Rest der Zeile ist unberührt — nur das eine Feld fehlt.
    expect(zeile!.gaeste).toBe(42)
    expect(zeile!.umsatzNetto).toBe(1234.5)
  })

  test('gültige Anzahlen bis an die int4-Grenze bleiben erhalten', () => {
    const grenze = { stores: [{ encId: 'a', bills: 2147483647, guests: 0 }] }
    const [zeile] = umsatzbericht(grenze, '2026-06-15')
    expect(zeile!.rechnungen).toBe(2147483647)
    expect(zeile!.gaeste).toBe(0)
    expect(zeile!.verworfen).toBeUndefined()
  })

  test('Nachkommastellen und negative Werte sind ebenfalls keine Anzahl', () => {
    const krumm = { stores: [{ encId: 'a', bills: 12.5, guests: -3 }] }
    const [zeile] = umsatzbericht(krumm, '2026-06-15')
    expect(zeile!.rechnungen).toBeNull()
    expect(zeile!.gaeste).toBeNull()
    expect(zeile!.verworfen).toHaveLength(2)
  })

  test('fehlende Anzahlen erzeugen keinen Befund', () => {
    const leer = { stores: [{ encId: 'a', umsatzNetto: 100 }] }
    const [zeile] = umsatzbericht(leer, '2026-06-15')
    expect(zeile!.rechnungen).toBeNull()
    expect(zeile!.verworfen).toBeUndefined()
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
    // Gruppen liefert, ist offen — siehe den Kommentar an core.betrieb_konzept in migrations/0002_stammdaten.sql.
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

  /**
   * Der echte Fall vom 14.10.2022: eine Zelle von 12.821 trug
   * `menge = 2147483649` (2^31+1) bei Umsatz und Preis null. Der ganze
   * Tagesposten brach daran ab mit „numeric field overflow".
   */
  test('verwirft unmögliche Mengen, statt an ihnen zu scheitern', () => {
    const kaputt = {
      ...daten,
      rows: daten.rows.map((r: any, i: number) =>
        i === 0 ? { ...r, counts: { ...r.counts, 8826: 2147483649 } } : r),
    }
    const { zeilen } = artikelverkauf(kaputt, '2026-06-15')
    const z = zeilen.find(x => x.artikelnummer === 8826)!
    expect(z.menge).toBeNull()
    expect(z.verworfen).toEqual([{ feld: 'counts.8826', wert: 2147483649 }])
  })

  test('behält den Rest des Tages, wenn eine Menge unmöglich ist', () => {
    const { zeilen: sauber } = artikelverkauf(daten, '2026-06-15')
    const kaputt = {
      ...daten,
      rows: daten.rows.map((r: any, i: number) =>
        i === 0 ? { ...r, counts: { ...r.counts, 8826: 2147483649 } } : r),
    }
    const { zeilen } = artikelverkauf(kaputt, '2026-06-15')
    // Eine kaputte Zelle darf nicht die guten mitnehmen.
    expect(zeilen.length).toBe(sauber.length + 1)
    expect(zeilen.find(x => x.artikelnummer === 450003)!.menge).toBe(128)
  })

  test('lässt plausible Mengen unangetastet und meldet nichts', () => {
    const { zeilen } = artikelverkauf(daten, '2026-06-15')
    expect(zeilen.every(z => z.verworfen === undefined)).toBe(true)
  })
})

describe('Aktionsbericht', () => {
  const daten = fixture('getAktionsbericht')

  test('liest die Aktionen samt Laufzeit', () => {
    const { aktionen } = aktionsbericht(daten, '2026-06-15')
    expect(aktionen).toHaveLength(3)
    const sommer = aktionen.find(a => a.linaId === 8)!
    expect(sommer.name).toBe('Mexican Summer')
    // Unix-Sekunden über die Berliner Wanduhr — in UTC wäre es der 31.05.
    expect(sommer.gueltigVon).toBe('2026-06-01')
    expect(sommer.gueltigBis).toBe('2026-07-31')
  })

  test('unbefristete Aktionen haben keine Laufzeit, sind aber gültig', () => {
    const { aktionen } = aktionsbericht(daten, '2026-06-15')
    const sekt = aktionen.find(a => a.linaId === 4)!
    expect(sekt.gueltigVon).toBeNull()
    expect(sekt.gueltigBis).toBeNull()
  })

  /**
   * Eine Zelle ist ein OBJEKT, keine Zahl.
   *
   * Die erste Fassung nahm eine blosse Zahl an — gebaut gegen den einzigen
   * Tag im Bestand, an dem alle 423 Zellen auf null standen. `Number({…})`
   * ist `NaN`, also hätte die Transformation für JEDEN gefüllten Tag null
   * Zeilen geschrieben und dabei `ok` gemeldet.
   */
  test('liest revenue und percent aus der Zelle', () => {
    const { zeilen } = aktionsbericht(daten, '2026-06-15')
    const z = zeilen.find(x => x.encId === 'ENCID_002' && x.linaAktionId === 8)!
    expect(z.umsatzNetto).toBe(2405.6)
    expect(z.anteilPct).toBe(1.06)
    expect(z.geschaeftstag).toBe('2026-06-15')
  })

  test('eine blosse Zahl bleibt lesbar, dann ohne Anteil', () => {
    const { zeilen } = aktionsbericht(daten, '2026-06-15')
    const z = zeilen.find(x => x.encId === 'ENCID_002' && x.linaAktionId === 4)!
    expect(z.umsatzNetto).toBe(19.9)
    expect(z.anteilPct).toBeNull()
  })

  test('verwirft leere und auf null stehende Zellen', () => {
    // Am 25.07.2026 waren ALLE 423 Zellen null; über 27 Tage gemessen sind es
    // 946 gefüllte von 15.510. Wer die leeren mitschreibt, sammelt
    // Hunderttausende Zeilen Nichts im Jahr.
    const { zeilen } = aktionsbericht(daten, '2026-06-15')
    expect(zeilen).toHaveLength(3)
    expect(zeilen.every(z => (z.umsatzNetto ?? z.umsatzBrutto) !== 0)).toBe(true)
    expect(zeilen.some(z => z.encId === 'ENCID_001')).toBe(false)
  })

  test('folgt dem brutto-Feld der ANTWORT, nicht unserem Anfrageparameter', () => {
    const { zeilen } = aktionsbericht({ ...daten, brutto: true }, '2026-06-15')
    expect(zeilen[0].umsatzBrutto).toBe(128.4)
    expect(zeilen[0].umsatzNetto).toBeNull()
  })

  test('die Strukturprüfung kennt die Objektform', () => {
    // Sie hat den Irrtum gemeldet, als er passierte — 26 Einträge in
    // sync.schema_abweichung. Ab jetzt soll sie schweigen.
    expect(AktionsberichtSchema.safeParse(daten).success).toBe(true)
  })

  test('eine Antwort ohne einen einzigen Umsatz ist kein Fehler', () => {
    // Der gemessene Normalfall: Aktionen stehen da, Zellen sind leer.
    const leer = {
      ...daten,
      rows: daten.rows.map((r: any) => ({ ...r, cells: { '4': null, '6': null, '8': null } })),
    }
    const { aktionen, zeilen } = aktionsbericht(leer, '2026-06-15')
    expect(aktionen).toHaveLength(3)
    expect(zeilen).toHaveLength(0)
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
      () => aktionsbericht({}, '2026-06-15'),
      () => aktionsbericht(null, '2026-06-15'),
      () => aktionsbericht({ rows: [{ encId: 'X' }] }, '2026-06-15'),
    ]) {
      expect(fn).not.toThrow()
    }
  })
})

// =======================================================================
// Stammdaten-Momentaufnahmen
// =======================================================================

describe('Warengruppen aus articleApi', () => {
  const daten = fixture('articleApi')

  test('trennt Name und LINA-ID aus "Weine (2900)"', () => {
    expect(warengruppeAusText('Warengruppe A (2900)')).toEqual({ linaId: 2900, name: 'Warengruppe A' })
  })

  test('nimmt die LETZTE Klammergruppe — Namen dürfen Klammern enthalten', () => {
    expect(warengruppeAusText('Aktion (Sommer) (26500)'))
      .toEqual({ linaId: 26500, name: 'Aktion (Sommer)' })
  })

  test('verträgt Namen mit Schrägstrich', () => {
    // "Sonstiges / Divers" ist EIN Kategoriename, keine zwei — am 25.07.2026
    // gemessen: 7 Grosskategorien, nicht 8.
    expect(warengruppeAusText('Sonstiges / Divers (5)'))
      .toEqual({ linaId: 5, name: 'Sonstiges / Divers' })
  })

  test('gibt null statt zu werfen, wenn nichts da ist', () => {
    for (const v of [null, undefined, '', '   ', 42]) expect(warengruppeAusText(v)).toBeNull()
  })

  test('ohne Klammer bleibt der Name erhalten, ID 0', () => {
    expect(warengruppeAusText('Ohne Nummer')).toEqual({ linaId: 0, name: 'Ohne Nummer' })
  })

  /**
   * Der teuerste denkbare Fehler in diesem Endpunkt: über `id` statt `artnr`
   * zu verknüpfen. Am 25.07.2026 gemessen — artnr trifft die Artikelnummern
   * des Verkaufsberichts, id trifft keine einzige (19324 vs. 300213).
   */
  test('verknüpft über artnr, nicht über id', () => {
    const r = artikelWarengruppen(daten)
    const nummern = r.map(a => a.artikelnummer)
    expect(nummern).toContain(300213)   // artnr des ersten Satzes
    expect(nummern).not.toContain(19324) // dessen id
  })

  test('liest artnr auch, wenn LINA sie als String schickt', () => {
    expect(artikelWarengruppen(daten).map(a => a.artikelnummer)).toContain(1340064)
  })

  test('Artikel ohne Zuordnung fallen nicht raus, sind aber leer', () => {
    const ohne = artikelWarengruppen(daten).find(a => a.artikelnummer === 4070029)!
    expect(ohne).toBeDefined()
    expect(ohne.gross).toBeNull()
    expect(ohne.mec).toBeNull()
    expect(ohne.detail).toBeNull()
  })
})

describe('Feinsparten', () => {
  test('liest id, number und name', () => {
    const f = feinsparten(fixture('analyticsFilterOptions'))
    expect(f.length).toBeGreaterThan(0)
    expect(f.find(x => x.linaId === 1194)).toEqual({ linaId: 1194, nummer: 1000, name: 'Feinsparte A' })
  })
})

describe('Lieferanten — Datenminimierung', () => {
  const daten = fixture('wawiSuppliers')

  test('liefert genau fünf Felder', () => {
    const l = lieferanten(daten)
    expect(Object.keys(l[0]).sort())
      .toEqual(['aktiv', 'liefertage', 'linaId', 'mindestbestellwert', 'name'])
  })

  /**
   * Der eigentliche Test. Die Fixture enthält die heiklen Felder ABSICHTLICH
   * mit Platzhaltern — Steuer-, Bank- und Kontaktdaten von 540
   * Geschäftspartnern, die in keiner geplanten Auswertung vorkommen.
   * Ein `...rest` in der Transformation hätte hier genau den gegenteiligen
   * Effekt, deshalb wird es hier festgenagelt.
   */
  test('reicht Steuer-, Bank- und Kontaktdaten NICHT durch', () => {
    const rohFelder = new Set(Object.keys(daten[0]))
    const ergebnisFelder = new Set(lieferanten(daten).flatMap(l => Object.keys(l)))
    for (const feld of ['ustid', 'hrb', 'kreditor', 'gegenkonto', 'gegenkonto7', 'gegenkonto0',
                        'tel', 'Fax', 'email', 'strasse', 'plz', 'ort', 'hnr', 'kdnr',
                        'partner', 'netz', 're_def', 'id_general', 'api', 'einzelp',
                        'global_discount_kontos', 'dh_supplier_id']) {
      expect(rohFelder).toContain(feld)          // in der Antwort vorhanden …
      expect(ergebnisFelder).not.toContain(feld) // … und im Ergebnis nicht
    }
    // Auf Feldnamen prüfen, nicht auf Teilketten: "tel" steckt sonst in
    // "mindestbestellwert" und der Test wird zum Fehlalarm.
    expect(JSON.stringify(lieferanten(daten))).not.toContain('XXXX')
  })

  test('ein Lieferant ohne Namen wird zu null, nicht zu Leerstring', () => {
    expect(lieferanten(daten).find(l => l.linaId === 31)!.name).toBeNull()
  })
})

describe('Waren und Einkaufspreise', () => {
  const daten = fixture('wawiItems')

  test('trennt Waren und Preise — eine Ware kann mehrere Lieferantenpreise haben', () => {
    const { waren: w, preise } = waren(daten)
    expect(w).toHaveLength(3)
    expect(preise.filter(p => p.wareLinaId === 1)).toHaveLength(2)
  })

  /**
   * PHPs json_encode macht aus einem leeren Array `[]` und erst aus einem
   * gefüllten assoziativen Array `{}`. Am 25.07.2026: 594 Waren mit Objekt,
   * 304 mit `[]`, kein einziger gefüllter Array-Fall. Ohne diesen Zweig
   * meldete jede Momentaufnahme eine Schemaabweichung.
   */
  test('verträgt prices als Objekt UND als leeres Array', () => {
    const { preise } = waren(daten)
    expect(preise.filter(p => p.wareLinaId === 2)).toHaveLength(0)  // prices: []
    expect(preise.filter(p => p.wareLinaId === 1).length).toBeGreaterThan(0) // prices: {}
  })

  test('rechnet updated aus Unix-Sekunden um, 0 heißt "nie"', () => {
    const { preise } = waren(daten)
    const p = preise.find(x => x.linaPreisId === 249)!
    expect(p.geaendertAm).toBeInstanceOf(Date)
    expect(p.geaendertAm!.toISOString()).toBe('2013-02-25T23:00:00.000Z')
    expect(preise.find(x => x.linaPreisId === 251)!.geaendertAm).toBeNull()
  })

  test('behält die Umrechnung auf die Basiseinheit', () => {
    // Ohne base_unit_mult sind Preise verschiedener Gebindegrößen nicht
    // vergleichbar: 5,20 je Liter gegen 58,80 je 12er-Kiste.
    const p = waren(daten).preise.find(x => x.linaPreisId === 250)!
    expect(p.basisFaktor).toBe(12)
    expect(p.menge).toBe(12)
    expect(p.preis).toBe(58.8)
  })
})

describe('Einheiten, Bestellungen, Inventur', () => {
  test('Einheiten mit Faktor und Basiskennzeichen', () => {
    const e = einheiten(fixture('wawiUnits'))
    expect(e).toHaveLength(3)
    expect(e.find(x => x.linaId === 2)).toMatchObject({ name: 'Kiste', faktor: 12, istBasis: false })
    expect(e.find(x => x.linaId === 1)!.istBasis).toBe(true)
  })

  test('Bestellungen inklusive Positionen', () => {
    const b = bestellungen(fixture('wawiOrders'))
    expect(b).toHaveLength(2)
    expect(b[0].posten).toHaveLength(2)
    expect(b[0].summe).toBe(165.15)
    expect(b[0].geliefert).toBe(false)
    expect(b[1].bestelltAm).toBeNull()   // 0 heißt "nie"
  })

  /**
   * Inventurtermine sind als TAG gemeint. 1486551600 ist in Berlin der
   * 08.02.2017, in UTC aber noch der 07.02. Wer hier UTC nimmt, verschiebt
   * jeden Termin vor 01:00 Ortszeit um einen Tag.
   */
  test('Inventurtermine über die Berliner Wanduhr, nicht über UTC', () => {
    const i = inventurtermine(fixture('wawiInventory'))
    expect(i).toHaveLength(2)
    expect(i[0]).toEqual({ datum: '2017-02-08', bearbeitbar: true })
  })

  /**
   * LINA liefert denselben Stichtag mehrfach: am 25.07.2026 waren es 11 Sätze
   * auf nur 4 verschiedene Tage — teils zu unterschiedlichen Uhrzeiten
   * desselben Tages, teils mit widersprüchlichem isEditable.
   *
   * Ohne Zusammenfassung scheitert der INSERT mit „ON CONFLICT DO UPDATE
   * command cannot affect row a second time". Genau daran ist der erste
   * Ladeversuch gescheitert — die Testsuite hätte es nicht gefunden, der
   * Lauf gegen die echten Daten schon.
   */
  test('fasst mehrfach gelieferte Stichtage je Tag zusammen', () => {
    const roh = {
      data: [
        { date: 1486551600, isEditable: true },   // 08.02.2017
        { date: 1486551600, isEditable: false },  // derselbe Tag, widersprüchlich
        { date: 1486551600, isEditable: false },
        { date: 1429166941, isEditable: false },  // 16.04.2015, zwei Uhrzeiten
        { date: 1429135200, isEditable: false },
      ],
    }
    const i = inventurtermine(roh)
    expect(i).toHaveLength(2)
    // „bearbeitbar, wenn irgendeiner es sagt" — ein Stichtag, an dem noch
    // gebucht werden kann, ist offen.
    expect(i.find(x => x.datum === '2017-02-08')!.bearbeitbar).toBe(true)
    expect(i.find(x => x.datum === '2015-04-16')!.bearbeitbar).toBe(false)
  })
})

describe('Betriebs-IDs — die Brücke zur BWA', () => {
  /**
   * Am 26.07.2026 fielen alle 7.860 Kennzahlenzeilen still durch den Filter,
   * weil core.betrieb.lina_betrieb_id nirgends gefüllt wurde. Der Posten
   * meldete `ok`, core.kennzahlen_monat blieb leer — und die BWA ist die
   * Grundlage des Round Table.
   */
  test('liest id und name aus analyticsFilterOptions.betriebe', () => {
    const r = betriebeMitLinaId({
      betriebe: [
        { id: 4469, name: 'A Testladen Concept Family' },
        { id: 1, name: 'Enchilada Bayreuth GmbH' },
      ],
    })
    expect(r).toEqual([
      { linaId: 4469, name: 'A Testladen Concept Family' },
      { linaId: 1, name: 'Enchilada Bayreuth GmbH' },
    ])
  })

  test('überspringt Sätze ohne brauchbare ID oder ohne Namen', () => {
    expect(betriebeMitLinaId({ betriebe: [
      { id: null, name: 'ohne ID' }, { id: 5, name: '' }, { id: 7, name: 'gut' },
    ] })).toEqual([{ linaId: 7, name: 'gut' }])
  })

  test('verträgt eine Antwort ohne betriebe', () => {
    expect(betriebeMitLinaId({})).toEqual([])
    expect(betriebeMitLinaId(null)).toEqual([])
  })
})

/**
 * Die Markenebene — bis zum 26.07.2026 gar nicht geladen.
 *
 * Schema, Mart-Sichten und das Marken-Dashboard waren vollständig gebaut,
 * aber kein Ladepfad füllte `core.konzept` oder `core.betrieb_konzept`.
 * Ergebnis in der echten Datenbank: 141 Betriebe, 0 Konzepte, alles unter
 * „(nicht zugeordnet)" — und das Marken-Dashboard ist der Einstieg der
 * ganzen Drill-Down-Kette.
 */
describe('Markenebene', () => {
  test('konzepte liest die Marken aus analyticsFilterOptions', () => {
    expect(konzepte({ gruppen: [
      { id: 1, name: 'Enchilada' }, { id: 4, name: 'Aposto' },
    ] })).toEqual([
      { linaGruppenId: 1, name: 'Enchilada' },
      { linaGruppenId: 4, name: 'Aposto' },
    ])
  })

  test('konzepte überspringt Sätze ohne ID oder Namen', () => {
    // Number(null) ist 0 und damit endlich — dieselbe Falle wie bei den
    // Betriebs-IDs, deshalb wird auf > 0 geprüft.
    expect(konzepte({ gruppen: [
      { id: null, name: 'ohne ID' }, { id: 0, name: 'Null' },
      { id: 3, name: '  ' }, { id: 6, name: 'Sonstige' },
    ] })).toEqual([{ linaGruppenId: 6, name: 'Sonstige' }])
    expect(konzepte({})).toEqual([])
    expect(konzepte(null)).toEqual([])
  })

  /**
   * Verbunden wird über Zahlen, nicht über Namen: `group_4` trägt dieselbe
   * `id`, die `analyticsFilterOptions` als 4 meldet. Am 26.07.2026 für alle
   * 14 Gruppen gegen die echte Antwort geprüft.
   */
  test('betriebKonzepte löst den Gruppenschlüssel auf', () => {
    expect(betriebKonzepte({ groups: [
      { key: 'group_4', children: [{ key: '4210' }, { key: 4211 }] },
      { key: 'group_1', children: [{ key: '17' }] },
    ] })).toEqual([
      { linaGruppenId: 4, linaBetriebId: 4210 },
      { linaGruppenId: 4, linaBetriebId: 4211 },
      { linaGruppenId: 1, linaBetriebId: 17 },
    ])
  })

  test('betriebKonzepte rät nicht, wenn der Schlüssel anders aussieht', () => {
    // Eine falsche Markenzuordnung fährt in jeder Auswertung mit, ohne sich
    // zu zeigen. Lieber keine Zuordnung als eine geratene.
    expect(betriebKonzepte({ groups: [
      { key: 'gruppe_4', children: [{ key: '1' }] },
      { key: 'group_x', children: [{ key: '2' }] },
      { key: null, children: [{ key: '3' }] },
    ] })).toEqual([])
  })

  test('betriebKonzepte überspringt Kinder ohne brauchbare ID und Dubletten', () => {
    expect(betriebKonzepte({ groups: [
      { key: 'group_2', children: [{ key: null }, { key: '0' }, { key: '9' }, { key: '9' }] },
    ] })).toEqual([{ linaGruppenId: 2, linaBetriebId: 9 }])
    expect(betriebKonzepte({})).toEqual([])
    expect(betriebKonzepte(null)).toEqual([])
  })

  test('verträgt eine Gruppe ganz ohne Kinder', () => {
    // Real: „Lehners" und „Burrito Company" haben 0 Kinder.
    expect(betriebKonzepte({ groups: [{ key: 'group_3' }, { key: 'group_78', children: [] }] }))
      .toEqual([])
  })
})
