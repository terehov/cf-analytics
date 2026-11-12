import { describe, expect, test } from 'bun:test'
import {
  bereinigen, datumLesarten, ddmmyyyyBerlin, erkenneMuster, feldGesperrt, feldProfil, journalAuswerten,
  pfadPruefen, profilAlle, protagSummen, tischeAuswerten, zeitLesen, type Zeile,
} from './tpapi_formprobe'

describe('Erlaubtliste', () => {
  test('lesende Pfade gehen durch', () => {
    for (const p of ['revenue/journal', 'personal/personalkostenprostunde', 'merchandiseman/recipe', 'revenue/getforecastperday'])
      expect(() => pfadPruefen(p)).not.toThrow()
  })
  test('nicht erlaubte Pfade werden abgelehnt', () => {
    for (const p of ['personal/acceptedworkingtimes', 'personal/userdataperday', 'personal/getPersonalData',
      'webcashregister/command', 'personal/saveShift', 'merchandiseman/recipe/id/1865', 'revenue/journal/../x', ''])
      expect(() => pfadPruefen(p)).toThrow()
  })
})

describe('Schluessel in Texten', () => {
  test('wird entfernt', () => {
    const t = bereinigen('Fehler bei apikey=GEHEIM123 und nochmal GEHEIM123, auch ANDERER', ['GEHEIM123', 'ANDERER'])
    expect(t).not.toContain('GEHEIM123')
    expect(t).not.toContain('ANDERER')
    expect(t).toContain('<schluessel>')
  })
})

describe('Datenschutz', () => {
  const zeilen: Zeile[] = [
    { debitor_text: 'Mueller GmbH', addinfo: 'Geburtstag', zip_code: '95444', kellnernr: '17', masterkellnernr: '3', teamnr: '2',
      userId: '4711', mail_adresse: 'a@b.de', phone: '0921', birthday: '1990-01-01', name: 'Anna', betrag: '12.50' },
    { debitor_text: 'Schmidt', addinfo: '', zip_code: '95445', kellnernr: '18', masterkellnernr: '4', teamnr: '2',
      userId: '4712', mail_adresse: 'c@d.de', phone: '0922', birthday: '1991-02-02', name: 'Bernd', betrag: '3.00' },
  ]
  test('gesperrte Felder liefern nie Beispiele oder Min/Max', () => {
    for (const f of ['debitor_text', 'addinfo', 'zip_code', 'kellnernr', 'masterkellnernr', 'teamnr', 'userId', 'mail_adresse', 'phone', 'birthday', 'name']) {
      const p = feldProfil(zeilen, f)
      expect(p.gesperrt).toBe(true)
      expect(p.beispiele).toBeUndefined()
      expect(p.min).toBeUndefined()
      expect(p.max).toBeUndefined()
      expect(JSON.stringify(p)).not.toMatch(/Mueller|Schmidt|95444|a@b\.de|Anna|0921/)
    }
  })
  test('Typ, Fuellgrad, Laenge und Muster bleiben', () => {
    const p = feldProfil(zeilen, 'addinfo')
    expect(p.anteilLeer).toBe(0.5)
    expect(p.laengeMax).toBe(10)
    expect(p.typen.string).toBe(2)
    expect(feldProfil(zeilen, 'zip_code').muster).toBe('nur Ziffern')
  })
  test('name ist bei merchandiseman erlaubt, user/mail dort weiter nicht', () => {
    expect(feldGesperrt('name', true)).toBe(false)
    expect(feldGesperrt('name', false)).toBe(true)
    expect(feldGesperrt('username', true)).toBe(true)
    const p = feldProfil([{ name: 'Cola' }, { name: 'Bier' }], 'name', true)
    expect(p.beispiele?.length).toBe(2)
  })
  test('ungesperrte Felder bekommen Profil', () => {
    const p = feldProfil(zeilen, 'betrag')
    expect(p.min).toBe(3)
    expect(p.max).toBe(12.5)
    expect(p.nachkomma).toBe(true)
    expect(p.muster).toBe('Dezimalzahl mit Punkt')
    expect(profilAlle(zeilen).length).toBe(12)
  })
  test('personalkostenprotag: nur Summen', () => {
    const rows = [{ brutto: '100.50', lohnkosten: 120, h_brutto: '8.0' }, { brutto: '50.25', lohnkosten: 60, h_brutto: '4.0' }]
    const s = protagSummen(rows)
    expect(s.zeilen).toBe(2)
    expect(s.felder.find(f => f.feld === 'brutto')!.summe).toBe(150.75)
    expect(s.felder.find(f => f.feld === 'lohnkosten')!.summe).toBe(180)
    const j = JSON.stringify(s)
    expect(j).not.toContain('100.50')
    expect(j).not.toContain('beispiele')
    expect(Object.keys(s.felder[0]!)).not.toContain('min')
  })
})

describe('Muster und Zeit', () => {
  test('Mustererkennung', () => {
    expect(erkenneMuster(['2026-11-09'])).toBe('ISO-Datum')
    expect(erkenneMuster(['2026-11-09 18:30:00'])).toBe('Datum+Uhrzeit yyyy-mm-dd hh:mm:ss')
    expect(erkenneMuster(['09.11.2026'])).toBe('dd.mm.yyyy')
    expect(erkenneMuster(['1379628000'])).toBe('Unix-Sekunden')
    expect(erkenneMuster(['1379628000000'])).toBe('Unix-Millisekunden')
    expect(erkenneMuster(['12', '7'])).toBe('nur Ziffern')
    expect(erkenneMuster(['1,50', '2,00'])).toBe('Dezimalzahl mit Komma')
    expect(erkenneMuster(['1.50', '-2.00'])).toBe('Dezimalzahl mit Punkt')
    expect(erkenneMuster(['abc'])).toBe('Text')
  })
  test('businessdate: UTC- und Berlin-Lesart unterscheiden sich um einen Tag', () => {
    // 1379628000 = 2013-09-19 22:00 UTC = 20.09.2013 00:00 Berlin (MESZ)
    const l = datumLesarten(1379628000)
    expect(l.utc).toBe('2013-09-19')
    expect(l.berlin).toBe('2013-09-20')
    expect(ddmmyyyyBerlin(1379628000)).toBe('20.09.2013')
  })
  test('Zeitwerte', () => {
    expect(zeitLesen('2026-11-09 07:59:00')!.art).toContain('ohne Zeitzone')
    expect(zeitLesen('1379628000')!.art).toBe('Unix-Sekunden')
    expect(zeitLesen('Quatsch')).toBeNull()
  })
})

describe('Journal und Bons', () => {
  const j: Zeile[] = [
    { ID: '1', datum: '2026-11-09 12:00:00', refdate: '2026-11-09', artnr: '100', preis: '5.00', balance: '5.00', finanzweg: '1', situation: '1', tableheader_id: 'a', rabatt_id: '0', cancellationreason: '0', parentid: '0' },
    { ID: '2', datum: '2026-11-10 07:30:00', refdate: '2026-11-09', artnr: '100', preis: '0', balance: '-2.50', finanzweg: '2', situation: '1', tableheader_id: 'a', rabatt_id: '7', cancellationreason: '0', parentid: '1' },
    { ID: '3', datum: '2026-11-10 08:00:00', refdate: '2026-11-09', artnr: '', preis: '0', balance: '0', finanzweg: '2', situation: '2', tableheader_id: 'b', rabatt_id: '0', cancellationreason: '3', parentid: '0' },
  ]
  test('Auswertung', () => {
    const a = journalAuswerten(j, '09.11.2026')
    expect(a.summeBalance).toBe(2.5)
    expect(a.jeFinanzweg['2']).toEqual({ zeilen: 2, summeBalance: -2.5 })
    expect(a.rabattIdUngleichNull).toBe(1)
    expect(a.cancellationreasonUngleichNull).toBe(1)
    expect(a.parentidUngleichNull).toBe(1)
    expect(a.preisNullBalanceUngleichNull).toBe(1)
    expect(a.idEindeutig).toBe(true)
    expect(a.datumAusserhalbGeschaeftstag).toBe(1) // 10.11. 08:00 ist schon der naechste Tag
    expect(a.artnrGefuellt).toBe(2)
    expect(a.artnrVerschieden).toBe(1)
  })
  test('Bons gegen Journal', () => {
    const t = tischeAuswerten([
      { tableheader_id: 'a', number_adults: '2', number_kids: 1, number_infants: 0, accounting_type: '1', debitor_id: '0', reservation_id: null },
      { tableheader_id: 'c', number_adults: '3', number_kids: 0, number_infants: 1, accounting_type: '1', debitor_id: '5', reservation_id: '' },
    ], j)
    expect(t.tableheaderIdEindeutig).toBe(true)
    expect(t.bonsAusJournalInTables).toEqual({ vonJournal: 2, gefunden: 1 })
    expect(t.bonsAusTablesImJournal).toEqual({ vonTables: 2, gefunden: 1 })
    expect(t.summeAdults).toBe(5)
    expect(t.debitorId).toEqual({ gefuellt: 2, ungleichNull: 1 })
    expect(t.reservationId.gefuellt).toBe(0)
  })
})
