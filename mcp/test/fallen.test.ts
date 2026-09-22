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

  /**
   * Claude, 16.09.2026: avg(umsatz_pct) stand im SELECT und im ORDER BY, und
   * der Nutzer las denselben Befund zweimal. Der Grund zaehlt, nicht die Zahl
   * der Fundstellen.
   */
  test('Derselbe Befund steht nur einmal, auch wenn das Aggregat zweimal vorkommt', () => {
    const e = pruefen(
      `SELECT konzept, avg(umsatz_pct) FROM mart.umsatz_ytd GROUP BY konzept ORDER BY avg(umsatz_pct) DESC`,
      katalog)
    expect(e.erlaubt).toBe(false)
    expect(e.befunde.filter(b => b.schluessel === 'aggregat_avg_umsatz_pct')).toHaveLength(1)
    const text = gesperrtText(e)
    expect(text.split('avg(umsatz_pct) ist nicht zulaessig')).toHaveLength(2)
  })
})

/**
 * DIE ELF UMGEHUNGEN AUS DEM REVIEW VOM 13.09.2026.
 *
 * Jede dieser Abfragen kam durch den Pruefer, bevor er ueberarbeitet wurde —
 * gemessen, nicht vermutet. Sie stehen hier, damit keine davon zurueckkommt.
 * Die Sperre im Pruefer ist jeweils der ERSTE Riegel; wo es einen zweiten
 * gibt (Rolle, Transaktion), nennt der Kommentar ihn.
 */
describe('Umgehungen aus dem Review', () => {

  test('U1 Sicht ohne Schema — die Regel fuer mart.fremdeinkauf sah sie nicht', () => {
    const e = gesperrt(`SELECT betrieb, sum(netto) FROM fremdeinkauf GROUP BY betrieb`)
    expect(e.erlaubt).toBe(false)
    // Normiert auf mart.fremdeinkauf, und DANN greift die Quellenregel.
    expect(e.schluessel).toContain('fremdeinkauf_quelle')
  })

  test('U1b Systemtabelle ohne Schema ist gesperrt', () => {
    const e = gesperrt(`SELECT query FROM pg_stat_activity`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('sicht_ohne_schema')
  })

  test('U2 Alias-Waesche: sum(pek) ueber pek_gesamt AS pek', () => {
    const e = gesperrt(`SELECT sum(x.pek) FROM (SELECT pek_gesamt AS pek FROM mart.personalkosten) x`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_sum_pek_gesamt')
  })

  test('U3 set_config und pg_sleep sind gesperrt (zweiter Riegel: ROLLBACK)', () => {
    expect(gesperrt(`SELECT set_config('statement_timeout','0',false)`).schluessel)
      .toContain('funktion_set_config')
    expect(gesperrt(`SELECT pg_sleep(60)`).schluessel).toContain('funktion_pg_sleep')
    // Auch schemaqualifiziert.
    expect(gesperrt(`SELECT pg_catalog.pg_sleep(60)`).schluessel).toContain('funktion_pg_sleep')
  })

  test('U4 BETWEEN ist ein Zeitraum — kein falscher Alarm mehr', () => {
    const e = gesperrt(`SELECT sum(umsatz_netto) FROM mart.umsatz_tag
                         WHERE geschaeftstag BETWEEN '2026-01-01' AND '2026-01-31'`)
    expect(e.erlaubt).toBe(true)
    expect(e.schluessel).not.toContain('umsatz_tag_ohne_zeitraum')
  })

  test('U5 vergleichbar = false und NOT vergleichbar sind KEIN Filter auf true', () => {
    expect(gesperrt(`SELECT * FROM mart.einkaufspreis_betrieb WHERE vergleichbar = false`).schluessel)
      .toContain('einkaufspreis_vergleichbar')
    expect(gesperrt(`SELECT * FROM mart.einkaufspreis_betrieb WHERE NOT vergleichbar`).schluessel)
      .toContain('einkaufspreis_vergleichbar')
    // Und die richtigen Schreibweisen bleiben richtig.
    expect(gesperrt(`SELECT * FROM mart.einkaufspreis_betrieb WHERE vergleichbar = true`).schluessel)
      .not.toContain('einkaufspreis_vergleichbar')
    expect(gesperrt(`SELECT * FROM mart.einkaufspreis_betrieb WHERE vergleichbar AND ware = 'x'`).schluessel)
      .not.toContain('einkaufspreis_vergleichbar')
  })

  test('U6 mal 100.0 und mal 100::numeric werden erkannt', () => {
    expect(gesperrt(`SELECT we_bar_pct * 100.0 FROM mart.round_table_monat`).schluessel)
      .toContain('prozent_skaliert')
    expect(gesperrt(`SELECT we_bar_pct * 100::numeric FROM mart.round_table_monat`).schluessel)
      .toContain('prozent_skaliert')
    expect(gesperrt(`SELECT 100 * we_bar_pct FROM mart.round_table_monat`).schluessel)
      .toContain('prozent_skaliert')
  })

  test('U7 SELECT INTO ist gesperrt (zweiter Riegel: READ ONLY)', () => {
    const e = gesperrt(`SELECT * INTO neu FROM mart.betrieb`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('select_into')
  })

  test('Unqualifiziert, aber bekannt: mart wird ergaenzt und die Abfrage laeuft', () => {
    const e = gesperrt(`SELECT betrieb, sum(umsatz_netto) FROM umsatz_tag
                         WHERE geschaeftstag >= '2026-01-01' GROUP BY betrieb`)
    expect(e.erlaubt).toBe(true)
    expect(e.sichten).toContain('mart.umsatz_tag')
  })
})

/**
 * DIE FALLEN DER BETRIEBSBERICHTE (Migrationen 0117/0118, 23.09.2026).
 *
 * Jede dieser Fragen ist eine, die zum Gluecksrad wirklich gestellt wurde oder
 * gestellt werden wird. Die Zahlen, die dahinter stehen, sind am Klon
 * nachgerechnet (docs/metabase.md, Abschnitt zu 0117): 10 %: 149, 25 %: 1.413,
 * 50 %: 7.335 Artikel auf Nachlass-Bons, August 2026, 14 Wilma-Wunder-Betriebe.
 */
describe('Betriebsberichte: Nachlass, Finanzwege, Bons', () => {

  test('88/97: core.finanzweg_tag ist gesperrt — dort stuende jede Zahl zweimal', () => {
    const e = gesperrt(`
      SELECT finanzweg_name, sum(umsatz) FROM core.finanzweg_tag
       WHERE geschaeftstag >= '2026-08-01' GROUP BY 1`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('schema_gesperrt')
  })

  test('88/97: die Pruefsicht mit beiden Zahlen nebeneinander ist gegen sum() gesperrt', () => {
    const e = gesperrt(`
      SELECT betrieb, sum(umsatz_88) + sum(umsatz_97) AS nachlass
        FROM mart.finanzweg_88_97_abgleich
       WHERE geschaeftstag >= '2026-08-01' GROUP BY betrieb`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_sum_umsatz_88')
    expect(e.schluessel).toContain('aggregat_sum_umsatz_97')
    // Und sagt, wo die Summe steht.
    expect(e.befunde.find(b => b.schluessel === 'aggregat_sum_umsatz_88')!.hinweis)
      .toContain('mart.finanzweg_tag')
  })

  test('88/97: die Summe ueber mart.finanzweg_monat kommt durch — dort ist je Tag eine Quelle', () => {
    const e = gesperrt(`
      SELECT betrieb, aktion, prozentsatz, sum(betrag) AS nachlass, sum(anzahl_vorgaenge)
        FROM mart.finanzweg_monat
       WHERE monat = '2026-08-01' AND art = 'nachlass'
       GROUP BY 1, 2, 3`)
    expect(e.erlaubt).toBe(true)
  })

  test('Gluecksrad ueber eine Nummernliste ist gesperrt — 3168 fehlte', () => {
    const e = gesperrt(`
      SELECT betrieb, finanzweg_nummer, sum(menge)
        FROM mart.artikel_nachlass_monat
       WHERE monat = '2026-08-01' AND finanzweg_nummer IN (3500, 3501, 3502)
       GROUP BY 1, 2`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('nachlass_nummernliste_monat')
    expect(e.befunde.find(b => b.schluessel === 'nachlass_nummernliste_monat')!.berichtigung)
      .toContain('aktion')
  })

  test('Auch eine einzelne Nummer mit = ist gesperrt, ein Verbinden ueber die Nummer nicht', () => {
    expect(gesperrt(`SELECT sum(menge) FROM mart.artikel_nachlass_tag
                      WHERE geschaeftstag >= '2026-08-01' AND finanzweg_nummer = 3501`).erlaubt).toBe(false)
    const verbunden = gesperrt(`
      SELECT f.aktion, sum(n.menge) FROM mart.artikel_nachlass_monat n
        JOIN mart.finanzweg f ON f.finanzweg_nummer = n.finanzweg_nummer
       WHERE n.monat = '2026-08-01' GROUP BY 1`)
    expect(verbunden.schluessel).not.toContain('nachlass_nummernliste_monat')
  })

  test('Gluecksrad richtig: ueber aktion und prozentsatz — kommt durch, mit der Deutung', () => {
    const e = gesperrt(`
      SELECT prozentsatz, sum(menge) AS stueck,
             sum(menge) FILTER (WHERE artikel = 'Durchstarter') AS durchstarter
        FROM mart.artikel_nachlass_monat
       WHERE aktion = 'Glücksrad' AND monat = '2026-08-01' AND marke = 'Wilma Wunder'
       GROUP BY prozentsatz`)
    expect(e.erlaubt).toBe(true)
    // Die Zahl stimmt — sie bedeutet aber Artikel auf Nachlass-Bons, nicht Verkauf.
    const d = e.befunde.find(b => b.schluessel === 'nachlass_menge_deutung_monat')!
    expect(d.schwere).toBe('warnung')
    expect(d.hinweis).toContain('NICHT die Verkaufsmenge')
  })

  test('Ein exakter Finanzwegname wird gewarnt — die zwei 25-%-Wege unterscheiden sich am Apostroph', () => {
    const e = gesperrt(`
      SELECT sum(menge) FROM mart.artikel_nachlass_monat
       WHERE monat = '2026-08-01' AND finanzweg_name = '25% Glücksrad'`)
    expect(e.schluessel).toContain('finanzweg_name_exakt')
    expect(e.befunde.find(b => b.schluessel === 'finanzweg_name_exakt')!.schwere).toBe('warnung')
  })

  test('Rabattbericht und Artikelverkauf ueber den Kassennamen verbunden — gewarnt, artikel_key nicht', () => {
    const name = gesperrt(`
      SELECT n.artikel, sum(n.menge), sum(a.menge)
        FROM mart.artikel_nachlass_monat n
        JOIN mart.artikel_monat a ON a.artikel = n.artikel AND a.monat = n.monat
       WHERE n.monat = '2026-08-01' GROUP BY 1`)
    expect(name.schluessel).toContain('nachlass_join_artikelname')
    const schluessel = gesperrt(`
      SELECT n.artikel, sum(n.menge)
        FROM mart.artikel_nachlass_monat n
        JOIN mart.artikel_monat a ON a.artikel_key = n.artikel_key AND a.monat = n.monat
       WHERE n.monat = '2026-08-01' GROUP BY 1`)
    expect(schluessel.schluessel).not.toContain('nachlass_join_artikelname')
  })

  test('92 gegen 88/97 in einer Summe: Artikel und Vorgaenge — gewarnt', () => {
    const e = gesperrt(`
      SELECT n.betrieb, sum(n.menge) + sum(f.anzahl_vorgaenge)
        FROM mart.artikel_nachlass_monat n
        JOIN mart.finanzweg_monat f ON f.betrieb_key = n.betrieb_key AND f.monat = n.monat
       WHERE n.monat = '2026-08-01' GROUP BY 1`)
    expect(e.schluessel).toContain('artikel_gegen_vorgaenge')
  })

  /**
   * GRUPPENKOEPFE IM RABATTBERICHT. Die Kopfzeilen eines Finanzweg-Blocks sind
   * die Summe der Artikelzeilen darunter; mitgezaehlt verdoppeln sie jede Zahl.
   * Sie stehen nicht in core (der Lader laedt sie nicht) und nicht in mart —
   * und namenlose Zeilen (28 von 8.533 im August 2026) laesst die Sicht weg,
   * weil die Gluecksrad-Zahl sie nicht zaehlt. Das prueft der Katalog: es gibt
   * in den Nachlass-Sichten keine Spalte, ueber die ein Kopf hereinkaeme, und
   * die richtige Abfrage braucht keinen Filter darauf.
   */
  test('Gruppenkoepfe (92): keine Kopf-Spalte in mart, und der Weg an mart vorbei ist gesperrt', () => {
    for (const s of ['mart.artikel_nachlass_tag', 'mart.artikel_nachlass_monat']) {
      const spalten = katalog.sichten.get(s)!.spalten
      expect(spalten).toContain('artikel')
      // Weder Kopfmarke noch Gruppennummer noch Zeilennummer der Antwort.
      for (const x of ['ist_kopf', 'gruppe', 'zeile']) expect(spalten).not.toContain(x)
    }
    const roh = gesperrt(`
      SELECT finanzweg_name, sum(anzahl) FROM core.rabatt_artikel_tag
       WHERE geschaeftstag = '2026-08-01' GROUP BY 1`)
    expect(roh.erlaubt).toBe(false)
    expect(roh.schluessel).toContain('schema_gesperrt')
    // Dasselbe fuer die Blockberichte mit Kopfzeilen (53, 61, 75, 76).
    for (const s of ['mart.kellner_artikel_monat', 'mart.kellner_umsatz_tag',
                     'mart.zeitzone_feinsparte_monat', 'mart.zeitzone_hauptsparte_monat']) {
      expect(katalog.sichten.get(s)!.spalten).not.toContain('ist_kopf')
    }
  })

  test('Gluecksrad in den Bons zu suchen ist gesperrt — 96 fuehrt keine Nachlaesse', () => {
    const e = gesperrt(`
      SELECT betrieb, sum(bons_mit_zahlart) FROM mart.bon_zahlart_tag
       WHERE geschaeftstag BETWEEN '2026-08-01' AND '2026-08-31'
         AND zahlart ILIKE '%glücksrad%'
       GROUP BY 1`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('bon_ohne_nachlass')
    // Eine echte Zahlart kommt durch.
    const ok = gesperrt(`
      SELECT betrieb, sum(bons_mit_zahlart) FROM mart.bon_zahlart_tag
       WHERE geschaeftstag BETWEEN '2026-08-01' AND '2026-08-31' AND zahlart = 'EC-Karte'
       GROUP BY 1`)
    expect(ok.schluessel).not.toContain('bon_ohne_nachlass')
  })

  test('Ein Durchschnittsbon ueber Tage gemittelt ist gesperrt, aus den Summen gerechnet nicht', () => {
    const falsch = gesperrt(`
      SELECT betrieb, avg(bon_durchschnitt) FROM mart.bon_tag
       WHERE geschaeftstag BETWEEN '2026-08-01' AND '2026-08-31' GROUP BY 1`)
    expect(falsch.erlaubt).toBe(false)
    expect(falsch.schluessel).toContain('aggregat_avg_bon_durchschnitt')
    const richtig = gesperrt(`
      SELECT betrieb, sum(bons_brutto) / nullif(sum(bons), 0) AS bon
        FROM mart.bon_tag
       WHERE geschaeftstag BETWEEN '2026-08-01' AND '2026-08-31' GROUP BY 1`)
    expect(richtig.erlaubt).toBe(true)
  })

  test('Haupt- und Feinsparten der Zeitzonen zusammen summiert: gewarnt', () => {
    const e = gesperrt(`
      SELECT sum(h.umsatz_netto) + sum(f.umsatz_netto)
        FROM mart.zeitzone_hauptsparte_monat h
        JOIN mart.zeitzone_feinsparte_monat f USING (betrieb_key, monat)
       WHERE h.monat = '2026-08-01'`)
    expect(e.schluessel).toContain('zeitzone_ebenen_mischen')
  })
})
