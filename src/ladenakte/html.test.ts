/**
 * Tests des Ladenakte-Parsers — gegen ECHTE Antworten, nicht gegen Nachbauten.
 *
 * Warum das hier betont wird: dieses Projekt hat zweimal grüne Tests gehabt,
 * während im Bestand Unsinn stand, weil die Attrappe sauberer war als das
 * Original (`shopOrderStatus` als flache Zeichenkette statt `{name}`;
 * `amount: 10` statt `amount: 0`). Die vier Fixtures unter
 * `src/transform/fixtures/` sind am 11.08.2026 unverändert aus LINA geholt.
 *
 * Eine Ausnahme gibt es: die negativen Fälle weiter unten sind handgeschrieben.
 * Kaputtes Markup lässt sich nicht abrufen — man muss es bauen.
 */
import { describe, expect, test } from 'bun:test'
import {
  bwaLongtermLesen, stammdatenLesen, deutscheZahl, monatsspalte, tabellen,
  ParseFehler, BWA_ZEILEN_ERWARTET,
} from './html'

const lies = (name: string) => Bun.file(`src/transform/fixtures/${name}`).text()

const KLEIN = await lies('bwa_longterm_klein.html')   // Schlager Cafe Düsseldorf
const LEER = await lies('bwa_longterm_leer.html')     // CONCEPT FAMILY Franchise AG
const STAMM = await lies('ladenakte_stammdaten.html') // Enchilada Karlsruhe

describe('deutscheZahl', () => {
  test('deutsches Format mit Tausenderpunkt und Komma', () => {
    expect(deutscheZahl('1.234,56')).toBe(1234.56)
    expect(deutscheZahl('-181.415,85')).toBe(-181415.85)
    expect(deutscheZahl('0,00')).toBe(0)
    expect(deutscheZahl('632')).toBe(632)
  })

  /**
   * Der Unterschied zwischen „steht nicht drin" und „ist null" ist bei
   * Geldbeträgen der ganze Punkt: ein Betrieb ohne gebuchte Miete ist etwas
   * anderes als einer mit Miete 0. Wer hier 0 zurückgibt, erzeugt genau die
   * plausible falsche Zahl, an der dieses Projekt schon vorbeigelaufen ist.
   */
  test('leer und unlesbar ergeben null, nicht 0', () => {
    expect(deutscheZahl('')).toBeNull()
    expect(deutscheZahl('   ')).toBeNull()
    expect(deutscheZahl('-')).toBeNull()          // LINAs Platzhalter, z. B. downloadedOn
    expect(deutscheZahl('abc')).toBeNull()
    expect(deutscheZahl('1.234.56')).toBeNull()   // kein Dezimalkomma: nicht raten
  })
})

describe('monatsspalte', () => {
  test('zweistelliges Jahr wird zu 20xx', () => {
    expect(monatsspalte('01/25')).toBe('2025-01-01')
    expect(monatsspalte('06/09')).toBe('2009-06-01')   // früheste gemessene Spalte
    expect(monatsspalte('12/26')).toBe('2026-12-01')
  })
  test('Unsinn wirft', () => {
    expect(() => monatsspalte('13/25')).toThrow(ParseFehler)
    expect(() => monatsspalte('Januar')).toThrow(ParseFehler)
  })
})

describe('tabellen', () => {
  test('findet alle Tabellen des Stammdatenblatts', () => {
    expect(tabellen(STAMM).length).toBe(7)
  })
  test('verschachtelte Tabellen bleiben eine', () => {
    const h = '<table><tr><td><table><tr><td>innen</td></tr></table></td></tr></table>'
    const t = tabellen(h)
    expect(t.length).toBe(1)
    expect(t[0]).toBe(h)
  })
  test('unbalanciertes Markup wirft, statt die Hälfte zu liefern', () => {
    expect(() => tabellen('<table><tr><td>x</td></tr>')).toThrow(ParseFehler)
  })
})

describe('bwaLongtermLesen — echter Betrieb mit Werten', () => {
  const b = bwaLongtermLesen(KLEIN)

  test('Monatsspalten stehen wie in LINA', () => {
    expect(b.monate.length).toBe(20)
    expect(b.monate[0]).toBe('01/25')
    expect(b.monate.at(-1)).toBe('08/26')
  })

  test('77 nummerierte Zeilen, 26 Gliederungszeilen übersprungen', () => {
    expect(b.zeilen.length).toBe(BWA_ZEILEN_ERWARTET)
    expect(new Set(b.zeilen.map(z => z.zeileId)).size).toBe(BWA_ZEILEN_ERWARTET)
  })

  test('die Zeilennummer trägt die Bedeutung, nicht die Beschriftung', () => {
    const z82 = b.zeilen.find(z => z.zeileId === 82)!
    expect(z82.bezeichnung).toBe('Erlöse Getränke')
    expect(z82.ebene).toBe(1)
    expect(z82.werte[0]).toBe(15020.68)
    expect(z82.werte.length).toBe(b.monate.length)
  })

  test('Summenzeilen sind nicht eingerückt', () => {
    expect(b.zeilen.find(z => z.zeileId === 85)!.bezeichnung).toBe('Gesamtleistung')
    expect(b.zeilen.find(z => z.zeileId === 85)!.ebene).toBeNull()
  })

  test('negative Beträge kommen als negative Zahlen an', () => {
    const negativ = b.zeilen.flatMap(z => z.werte).filter(w => w !== null && w < 0)
    expect(negativ.length).toBeGreaterThan(0)
  })

  test('jede Zeile hat so viele Werte wie es Monate gibt', () => {
    for (const z of b.zeilen) expect(z.werte.length).toBe(b.monate.length)
  })

  test('zellenMitWert zählt, was tatsächlich gebucht ist', () => {
    expect(b.zellenMitWert).toBe(847)
  })
})

describe('bwaLongtermLesen — Struktur ohne Werte', () => {
  /**
   * Die CONCEPT FAMILY Franchise AG liefert eine vollständige BWA-Tabelle mit
   * 80 Monatsspalten und keinem einzigen Wert. Das ist der Normalfall für eine
   * Holdinggesellschaft — und die Falle, an der ein Importer „ok" meldet und
   * 6.160 Nullzeilen schreibt.
   *
   * Der Parser darf hier NICHT scheitern (es ist kein Fehler), aber er muss
   * den Unterschied sichtbar machen. Dafür ist `zellenMitWert` da.
   */
  const b = bwaLongtermLesen(LEER)

  test('Struktur wird vollständig gelesen', () => {
    expect(b.monate.length).toBe(80)
    expect(b.zeilen.length).toBe(BWA_ZEILEN_ERWARTET)
  })

  test('und trägt nachweislich keinen einzigen Wert', () => {
    expect(b.zellenMitWert).toBe(0)
  })

  test('„Tabelle da" heisst also nicht „Daten da"', () => {
    expect(b.zeilen.length).toBeGreaterThan(0)
    expect(b.zellenMitWert).toBe(0)
  })
})

describe('die Zeilennummern sind betriebsübergreifend stabil', () => {
  /**
   * Darauf beruht der ganze Entwurf: `bwa_zeile_id` ist eine Dimension, kein
   * betriebsinterner Zähler. Zwei sehr verschiedene Betriebe — 20 gegen 80
   * Monatsspalten, mit Werten gegen ohne — tragen dieselben 77 Nummern.
   */
  test('gleiche Nummern in gleicher Reihenfolge', () => {
    const a = bwaLongtermLesen(KLEIN).zeilen.map(z => z.zeileId)
    const c = bwaLongtermLesen(LEER).zeilen.map(z => z.zeileId)
    expect(a).toEqual(c)
    expect(Math.min(...a)).toBe(82)
    expect(Math.max(...a)).toBe(162)
  })

  test('und die Beschriftungen stimmen überein', () => {
    const a = new Map(bwaLongtermLesen(KLEIN).zeilen.map(z => [z.zeileId, z.bezeichnung]))
    for (const z of bwaLongtermLesen(LEER).zeilen) expect(a.get(z.zeileId)).toBe(z.bezeichnung)
  })
})

describe('stammdatenLesen', () => {
  const s = stammdatenLesen(STAMM)

  test('Kapazität je Bereich — macht Umsatz je Sitzplatz rechenbar', () => {
    expect(s.kapazitaet.length).toBe(5)
    expect(s.kapazitaet[0]).toEqual({ bereich: 'Gesamt', plaetze: 632, tische: 0, flaecheQm: 339 })
    expect(s.kapazitaet.map(k => k.bereich)).toContain('Biergarten 1')
  })

  /**
   * „Umsatz 19%" ist kein Bereich, sondern eine gepflegte Merkwürdigkeit. Der
   * Parser darf sie nicht wegwerfen und nicht daran scheitern — deshalb steht
   * auf `bereich` kein CHECK und keine Werteliste.
   */
  test('ungepflegte Bereichsnamen bleiben erhalten, statt zu scheitern', () => {
    expect(s.kapazitaet.map(k => k.bereich)).toContain('Umsatz 19%')
  })

  test('Plan-BWA trägt dieselben 77 Zeilennummern wie die Ist-BWA', () => {
    expect(s.planBwa.length).toBe(BWA_ZEILEN_ERWARTET)
    const plan = s.planBwa.map(z => z.zeileId)
    const ist = bwaLongtermLesen(KLEIN).zeilen.map(z => z.zeileId)
    expect(plan).toEqual(ist)
  })

  test('Plan-Monate sind Monatserste', () => {
    const z82 = s.planBwa.find(z => z.zeileId === 82)!
    expect(z82.werte.length).toBe(12)
    expect(z82.werte[0].monat).toBe('2025-01-01')
    expect(z82.werte[0].betrag).toBe(90000)
  })

  test('Tagesbudget: ein Eintrag je Tag des Jahres, mit Plan-Stunden', () => {
    expect(s.tagesbudget.length).toBe(365)
    expect(s.tagesbudget[0].datum).toBe('2025-01-01')
    expect(s.tagesbudget.at(-1)!.datum).toBe('2025-12-31')
    expect(s.tagesbudget[0].stundenService).toBe(32)
  })
})

describe('das Stammdatenblatt trägt Zugangsdaten — sie dürfen nicht durchkommen', () => {
  /**
   * Tabelle 5 des Stammdatenblatts führt die vergebenen LINA-API-Schlüssel mit
   * IP-Bindung und Scopes. Der Parser liest über eine POSITIVLISTE genau drei
   * Kopfzeilen; diese Tabelle gehört nicht dazu.
   *
   * Der Test prüft die Regel, nicht ein bereinigtes Abbild: im Fixture sind die
   * Schlüsselwerte geschwärzt (harte Regel 2 — Zugangsdaten werden nicht
   * committet), die Tabelle selbst ist vollständig vorhanden. Käme sie je ins
   * Ergebnis, fiele es hier auf.
   */
  test('die Schlüsseltabelle taucht im Ergebnis nirgends auf', () => {
    const ergebnis = JSON.stringify(stammdatenLesen(STAMM))
    expect(ergebnis).not.toMatch(/API - Key/i)
    expect(ergebnis).not.toMatch(/GESCHWAERZT/)
    expect(ergebnis).not.toMatch(/Sell ?& ?Pick/i)
    expect(ergebnis).not.toMatch(/Bounti/i)
    expect(ergebnis).not.toMatch(/Scopes/i)
  })

  test('im Fixture steht die Tabelle sehr wohl — sonst prüfte der Test nichts', () => {
    expect(STAMM).toMatch(/API - Key/)
    expect(tabellen(STAMM).length).toBe(7)
  })

  test('und im Fixture steht kein echter Schlüssel mehr', () => {
    /**
     * Gezielt in der Schlüsseltabelle nachsehen, nicht im ganzen Dokument:
     * eine Suche nach „20+ Zeichen am Stück" schlägt sonst bei Wörtern wie
     * „Franchisegebergesellschaften" an und wäre damit wertlos.
     *
     * Die echten Schlüssel waren 28 Zeichen aus Buchstaben UND Ziffern.
     */
    const schluesseltabelle = tabellen(STAMM).find(t => /API - Key/.test(t))!
    expect(schluesseltabelle).toBeDefined()
    const gemischt = [...schluesseltabelle.matchAll(/>\s*([A-Za-z0-9]{20,})\s*</g)]
      .map(m => m[1])
      .filter(w => /[A-Za-z]/.test(w) && /\d/.test(w))
    expect(gemischt).toEqual([])
    expect(schluesseltabelle).toMatch(/GESCHWAERZT-SCHLUESSEL/)
  })
})

describe('der Parser scheitert laut statt still', () => {
  test('kein BWA-Markup: aussagekräftiger Fehler statt leerer Liste', () => {
    expect(() => bwaLongtermLesen('<html><body><p>nichts</p></body></html>'))
      .toThrow(/keine Tabelle mit Monatskopfzeile/)
  })

  test('geänderte Zeilenzahl wird zur Prüfung, nicht zum stillen Import', () => {
    // Nur zwei nummerierte Zeilen statt 77 — so sähe eine LINA-Umstellung aus.
    const html = `<table><tr><th></th><th>01/25</th></tr>
      <tr><td class="indent-1">A <a href="x/img/82/y">c</a></td><td align="right">1,00</td></tr>
      <tr><td class="indent-1">B <a href="x/img/83/y">c</a></td><td align="right">2,00</td></tr></table>`
    expect(() => bwaLongtermLesen(html)).toThrow(/2 nummerierte Zeilen statt 77/)
  })

  test('Zellenzahl ungleich Monatszahl wirft', () => {
    const html = `<table><tr><th></th><th>01/25</th><th>02/25</th></tr>
      <tr><td class="indent-1">A <a href="x/img/82/y">c</a></td><td align="right">1,00</td></tr></table>`
    expect(() => bwaLongtermLesen(html)).toThrow(/hat 1 Werte/)
  })

  test('fremdes HTML im Stammdatenleser wirft', () => {
    expect(() => stammdatenLesen('<table><tr><th>Etwas</th></tr></table>'))
      .toThrow(/keine der drei erwarteten Tabellen/)
  })
})
