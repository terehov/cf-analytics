/**
 * DIE ZEHN FALLENFRAGEN.
 *
 * Die Regressionssicherung des ganzen Vorhabens (docs/plan-skybridge.md,
 * Abschnitt 6.3). Jede dieser Fragen ist eine, die ein Sprachmodell
 * natuerlich stellt und die in diesen Daten eine plausibel aussehende
 * falsche Zahl ergibt. Jede muss hier entweder gesperrt oder gewarnt werden.
 *
 * DIE ELFTE GRUPPE IST DIE WICHTIGSTE: richtige Abfragen muessen
 * durchkommen. Ein Pruefer, der alles sperrt, ist kein Schutz, sondern ein
 * kaputter Dienst — und die erste Fassung, die Daniel wegwirft.
 *
 * Laeuft ohne Datenbank: der Katalog kommt aus test/katalog.json. Dass die
 * Abzugsdatei mit den Migrationen Schritt haelt, prueft katalog_abzug.test.ts.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { parserBereitstellen } from '../src/ast'
import { katalogAusJson } from '../src/katalog_laden'
import { gesperrtText } from '../src/ausfuehren'
import { pruefen, type Befund } from '../src/pruefen'
import abzug from './katalog.json'

const katalog = katalogAusJson(abzug as any)

beforeAll(async () => { await parserBereitstellen() })

const schluessel = (b: Befund[]) => b.map(x => x.schluessel)
const gesperrt = (sql: string) => {
  const e = pruefen(sql, katalog)
  return { ...e, schluessel: schluessel(e.befunde) }
}

describe('Die zehn Fallenfragen', () => {

  test('1. Umsatz je Stadt — die Spalte ist bei allen 141 Betrieben NULL', () => {
    const e = gesperrt(`
      SELECT stadt, sum(umsatz_netto) AS umsatz
        FROM mart.umsatz_tag
       WHERE geschaeftstag >= '2026-08-01'
       GROUP BY stadt`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('stadt_immer_null')
    // Und die Berichtigung muss den Weg nennen, der funktioniert.
    expect(e.befunde.find(b => b.schluessel === 'stadt_immer_null')!.berichtigung)
      .toContain('mart.nachbarschaft')
  })

  test('2. Durchschnittliche Personalquote — Tagesnenner, Median, verduennter Nenner', () => {
    const e = gesperrt(`SELECT avg(pek_gesamt) FROM mart.personalkosten`)
    expect(e.erlaubt).toBe(false)
    // Die Sperre: avg() ueber eine Spalte, die als Median hinterlegt ist.
    expect(e.schluessel).toContain('aggregat_avg_pek_gesamt')
    // Die Warnungen: fehlender Plausibilitaetsfilter und der verduennte Nenner.
    expect(e.schluessel).toContain('personalquote_ungefiltert')
    expect(e.schluessel).toContain('nenner_ohne_geschaeft')
  })

  test('3. Fremdeinkauf je Betrieb — ohne Filter auf die Quelle wird doppelt gezaehlt', () => {
    const e = gesperrt(`
      SELECT betrieb, sum(netto) FROM mart.fremdeinkauf
       WHERE monat >= '2026-01-01' GROUP BY betrieb`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('fremdeinkauf_quelle')
  })

  test('4. Wer zahlt am meisten fuer Mozzarella — ohne vergleichbar = true', () => {
    const e = gesperrt(`
      SELECT betrieb, preis FROM mart.einkaufspreis_betrieb
       WHERE ware ILIKE '%mozzarella%' ORDER BY preis DESC`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('einkaufspreis_vergleichbar')
  })

  test('5. Personalquote von "Karlsruhe" — fuenf Betriebe heissen so', () => {
    const e = gesperrt(`
      SELECT p.pek_gesamt
        FROM mart.personalkosten p
        JOIN mart.betrieb b ON b.betrieb = p.betrieb
       WHERE b.betrieb = 'Karlsruhe'`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('join_ueber_betriebsname')
  })

  test('5b. Dieselbe Frage ueber USING (betrieb) — dieselbe Falle', () => {
    const e = gesperrt(`
      SELECT p.pek_gesamt FROM mart.personalkosten p
        JOIN mart.betrieb b USING (betrieb)`)
    expect(e.schluessel).toContain('join_ueber_betriebsname')
  })

  test('6. Umsatz und Personalkosten nebeneinander — der BWA-Versatz ist je Betrieb anders', () => {
    const e = gesperrt(`
      SELECT r.betrieb, r.umsatz_ist, r.personalkosten_ogf_pct
        FROM mart.round_table_monat r WHERE r.monat = '2026-07-01'`)
    expect(schluessel(e.befunde)).toContain('bwa_versatz')
    expect(e.befunde.find(b => b.schluessel === 'bwa_versatz')!.hinweis).toContain('bwa_monat')
  })

  test('7. Wareneinsatz aus Rezepturen — core ist gesperrt, und die Bruecke ist leer', () => {
    const e = gesperrt(`
      SELECT a.artikel, sum(r.menge)
        FROM core.artikelverkauf_tag a
        JOIN core.pos_artikel p ON p.plu = a.artikelnummer
        JOIN core.rezept r ON r.artikel_key = p.artikel_key
       GROUP BY a.artikel`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('schema_gesperrt')
  })

  test('8. Umsatz nach Bundesland — gepflegt fuer 60 von 141 Betrieben', () => {
    const e = gesperrt(`
      SELECT bl.bundesland, sum(u.umsatz_netto)
        FROM mart.umsatz_tag u
        JOIN mart.betrieb_bundesland bl USING (betrieb_key)
       WHERE u.geschaeftstag >= '2026-01-01'
       GROUP BY bl.bundesland`)
    expect(e.schluessel).toContain('bundesland_luecke')
    // Eine Warnung, keine Sperre: die Frage ist zulaessig, nur unvollstaendig.
    expect(e.befunde.find(b => b.schluessel === 'bundesland_luecke')!.schwere).toBe('warnung')
  })

  test('9. Wareneinsatzquote mal 100 — die Werte SIND schon Prozentzahlen', () => {
    const e = gesperrt(`
      SELECT betrieb, we_kueche_pct * 100 AS quote
        FROM mart.round_table_monat WHERE monat = '2026-07-01'`)
    expect(e.schluessel).toContain('prozent_skaliert')
  })

  test('10. Kumulierter Vorjahresvergleich — umsatz_pct ist nicht summierbar', () => {
    const e = gesperrt(`SELECT sum(umsatz_ytd_pct) FROM mart.umsatz_ytd`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_sum_umsatz_ytd_pct')
  })
})

describe('Richtige Abfragen kommen durch', () => {

  test('Tagesumsatz je Betrieb und Monat — die haeufigste Frage ueberhaupt', () => {
    const e = gesperrt(`
      SELECT betrieb, monat, sum(umsatz_netto) AS umsatz
        FROM mart.umsatz_tag
       WHERE geschaeftstag >= '2026-01-01'
       GROUP BY betrieb, monat
       ORDER BY monat`)
    expect(e.erlaubt).toBe(true)
    expect(e.befunde.filter(b => b.schwere === 'sperre')).toHaveLength(0)
  })

  test('Fremdeinkauf MIT Quellenfilter', () => {
    const e = gesperrt(`
      SELECT betrieb, sum(netto) FROM mart.fremdeinkauf
       WHERE quelle = 'foodnotify' AND monat >= '2026-01-01'
       GROUP BY betrieb`)
    expect(e.schluessel).not.toContain('fremdeinkauf_quelle')
  })

  test('Einkaufspreise MIT vergleichbar — auch als blanker Wahrheitswert', () => {
    expect(gesperrt(`SELECT * FROM mart.einkaufspreis_betrieb WHERE vergleichbar = true`).schluessel)
      .not.toContain('einkaufspreis_vergleichbar')
    expect(gesperrt(`SELECT * FROM mart.einkaufspreis_betrieb WHERE vergleichbar`).schluessel)
      .not.toContain('einkaufspreis_vergleichbar')
  })

  test('Personalquote richtig: Median und Plausibilitaetsfilter', () => {
    const e = gesperrt(`
      SELECT betrieb,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY pek_gesamt) AS median
        FROM mart.personalkosten
       WHERE pek_gesamt > 0 AND pek_gesamt <= 200
       GROUP BY betrieb`)
    expect(e.erlaubt).toBe(true)
    expect(e.schluessel).not.toContain('personalquote_ungefiltert')
  })

  test('Ort statt stadt — der Weg, den die Berichtigung vorschlaegt', () => {
    const e = gesperrt(`
      SELECT n.ort, sum(u.umsatz_netto)
        FROM mart.umsatz_tag u
        JOIN mart.nachbarschaft n USING (betrieb_key)
       WHERE u.geschaeftstag >= '2026-08-01'
       GROUP BY n.ort`)
    expect(e.erlaubt).toBe(true)
    expect(e.schluessel).not.toContain('stadt_immer_null')
    // Die Abdeckungsluecke bleibt trotzdem eine Warnung — sie ist echt.
    expect(e.schluessel).toContain('ort_luecke')
  })

  test('Verbindung ueber betrieb_key ist in Ordnung', () => {
    const e = gesperrt(`
      SELECT b.betrieb, sum(u.umsatz_netto)
        FROM mart.umsatz_tag u
        JOIN mart.betrieb b ON b.betrieb_key = u.betrieb_key
       WHERE u.geschaeftstag >= '2026-01-01'
       GROUP BY b.betrieb`)
    expect(e.schluessel).not.toContain('join_ueber_betriebsname')
  })
})

describe('Feste Regeln', () => {

  test('Zwei Anweisungen hintereinander sind gesperrt', () => {
    const e = gesperrt(`SELECT 1 FROM mart.betrieb; SELECT 2 FROM mart.betrieb`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('eine_anweisung')
  })

  test('Schreiben ist gesperrt — mit einer verstaendlichen Meldung', () => {
    const e = gesperrt(`DELETE FROM manual.massnahme`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('nur_select')
  })

  test('Ein Syntaxfehler kommt als Befund zurueck, nicht als Absturz', () => {
    const e = gesperrt(`SELECT FROM WHERE`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('syntaxfehler')
  })

  test('Eine CTE ist keine gesperrte Relation', () => {
    const e = gesperrt(`
      WITH tage AS (SELECT * FROM mart.umsatz_tag WHERE geschaeftstag >= '2026-01-01')
      SELECT betrieb, sum(umsatz_netto) FROM tage GROUP BY betrieb`)
    expect(e.schluessel).not.toContain('schema_gesperrt')
    expect(e.erlaubt).toBe(true)
  })

  test('core in einer CTE versteckt bleibt gesperrt', () => {
    const e = gesperrt(`
      WITH roh AS (SELECT * FROM core.umsatzbericht_tag)
      SELECT sum(umsatz) FROM roh`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('schema_gesperrt')
  })

  test('Summe ueber einen Median ist gesperrt', () => {
    const e = gesperrt(`SELECT sum(we_kueche_pct) FROM mart.round_table_monat`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_sum_we_kueche_pct')
  })

  /**
   * Die Gegenprobe zur Regel darueber: mart.round_table_monat ist ALS GANZES
   * nicht summierbar, sein umsatz_ist aber ausdruecklich doch. Die
   * Spaltenregel ist die praezisere und muss gewinnen — sonst waere die
   * eine echte Summe der Sicht gesperrt.
   */
  test('Die eine echte Summe des Round Table kommt durch', () => {
    const e = gesperrt(`
      SELECT konzept, sum(umsatz_ist) FROM mart.round_table_monat
       WHERE monat = '2026-07-01' GROUP BY konzept`)
    expect(e.erlaubt).toBe(true)
  })

  test('Eine Spalte ohne eigene Regel aus einer nicht summierbaren Sicht wird gemeldet', () => {
    const e = gesperrt(`SELECT sum(om_score) FROM mart.round_table_monat`)
    expect(e.schluessel).toContain('summe_ungeprueft_mart.round_table_monat')
    // Warnung, nicht Sperre: vielleicht weiss der Fragende etwas, was hier fehlt.
    expect(e.befunde.find(b => b.schluessel.startsWith('summe_ungeprueft'))!.schwere).toBe('warnung')
  })
})

/**
 * Der Text, den ein Modell bei einer Sperre zu sehen bekommt.
 *
 * WARUM DAS EINEN EIGENEN TEST HAT. Bis zum 13.09.2026 warf die Sperre
 * nur „Die Abfrage wurde nicht ausgefuehrt." — der Grund blieb im Objekt
 * stecken und kam nie beim Modell an. Beim Durchspielen des ganzen
 * Ablaufs gefunden: aus Sicht des Modells war die Sperre ein Raetsel, und
 * ein Raetsel beantwortet es, indem es dieselbe falsche Abfrage umformuliert.
 *
 * Damit war die Verweigerung genau das, was sie NICHT sein soll: ein
 * Hindernis statt einer Antwort. Diese Tests halten das fest.
 */
describe('Die Sperre erklaert sich', () => {

  test('Der Grund, die Berichtigung und der Beleg stehen im Text', () => {
    const e = pruefen(`SELECT stadt, count(*) FROM mart.betrieb GROUP BY stadt`, katalog)
    const text = gesperrtText(e)
    expect(text).toContain('NICHT ausgefuehrt')
    expect(text).toContain('bei ALLEN 141 Betrieben NULL')          // der Grund
    expect(text).toContain('mart.nachbarschaft.ort')                 // die Berichtigung
    expect(text).toContain('docs/metabase.md')                       // der Beleg
  })

  test('Der Text raet ausdruecklich vom blossen Umformulieren ab', () => {
    const text = gesperrtText(pruefen(`SELECT sum(we_bar_pct) FROM mart.round_table_monat`, katalog))
    expect(text).toContain('NICHT bloss anders formulieren')
    expect(text).toContain('sicht_beschreiben')
  })

  test('Warnungen stehen dabei, aber getrennt von den Sperren', () => {
    const text = gesperrtText(pruefen(
      `SELECT stadt, avg(pek_gesamt) FROM mart.personalkosten GROUP BY stadt`, katalog))
    expect(text).toContain('Grund:')
    expect(text).toContain('Ausserdem zu beachten')
  })
})
