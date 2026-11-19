/**
 * Fallenfragen zu Preisen, Lieferkonditionen und der Kasse-Rezept-Bruecke
 * (Migrationen 0155–0158).
 *
 * Dasselbe Muster wie fallen.test.ts: jede Frage ist eine, die ein
 * Sprachmodell natuerlich stellt und die in diesen Daten eine plausibel
 * aussehende falsche Zahl ergibt — gesperrt oder gewarnt. Und die richtige
 * Fassung derselben Frage muss durchkommen, sonst ist der Pruefer kein
 * Schutz, sondern ein kaputter Dienst.
 *
 * Laeuft ohne Datenbank gegen test/katalog.json. Fehlt dort eine der neuen
 * Sichten, scheitern diese Tests an „Sicht unbekannt" statt am Fallstrick —
 * dann ist die Abzugsdatei veraltet, nicht der Pruefer kaputt.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { parserBereitstellen, zerlegen } from '../src/ast'
import { katalogAusJson } from '../src/katalog_laden'
import { pruefen, type Befund } from '../src/pruefen'
import { alleKarten, berichteSuchen, uebersetzen } from '../src/berichte'
import abzug from './katalog.json'

const katalog = katalogAusJson(abzug as any)

beforeAll(async () => { await parserBereitstellen() })

const schluessel = (b: Befund[]) => b.map(x => x.schluessel)
const pruefe = (sql: string) => {
  const e = pruefen(sql, katalog)
  return { ...e, schluessel: schluessel(e.befunde) }
}
const befund = (e: ReturnType<typeof pruefe>, s: string) => e.befunde.find(b => b.schluessel === s)

describe('Die neuen Sichten stehen im Katalog', () => {
  test('alle neun mart-Sichten aus 0155–0157 sind bekannt und haben eine Koernung', () => {
    for (const s of ['mart.pos_artikel_rezept', 'mart.pos_artikel_abdeckung', 'mart.pos_artikel_abdeckung_betrieb',
                     'mart.lieferkondition_beobachtet', 'mart.listenpreis_aktuell', 'mart.listenpreis_aenderung',
                     'mart.warenstamm_stand', 'mart.einkaufspreis_artikel_monat',
                     'mart.einkaufspreis_artikel_monat_basis']) {
      expect({ s, koernung: !!katalog.sichten.get(s)?.koernung }).toEqual({ s, koernung: true })
    }
  })
})

describe('Listen- und Katalogpreis (0157)', () => {

  test('1. „Was zahlen wir fuer Ware X?" aus dem Listenpreis — gewarnt: kein bezahlter Preis, je kg/l', () => {
    const e = pruefe(`
      SELECT ware, lieferant, listenpreis
        FROM mart.listenpreis_aktuell
       WHERE ware ILIKE '%zucker%' ORDER BY listenpreis DESC`)
    expect(e.erlaubt).toBe(true)
    expect(e.schluessel).toContain('listenpreis_ist_nicht_bezahlt')
    expect(befund(e, 'listenpreis_ist_nicht_bezahlt')!.berichtigung).toContain('mart.einkaufspreis_artikel_monat')
  })

  test('1b. Ein mittlerer Listenpreis ueber Waren ist gesperrt — Preise je kg/l verschiedener Waren', () => {
    const e = pruefe(`SELECT lieferant, avg(listenpreis) FROM mart.listenpreis_aktuell GROUP BY lieferant`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_avg_listenpreis')
  })

  test('2. „Wie stark sind die Einkaufspreise gestiegen?" aus den Listenpreisaenderungen — gewarnt', () => {
    const e = pruefe(`
      SELECT ware, preis_alt, preis_neu, aenderung_pct
        FROM mart.listenpreis_aenderung
       WHERE preisart = 'listenpreis' AND vergleichbar
       ORDER BY aenderung_pct DESC`)
    expect(e.erlaubt).toBe(true)
    // Die Reihe beginnt spaet, und es ist kein bezahlter Preis — beides im selben Hinweis.
    expect(e.schluessel).toContain('listenpreis_reihe_beginnt_spaet')
    expect(befund(e, 'listenpreis_reihe_beginnt_spaet')!.hinweis).toContain('KEINE bezahlten')
    // Mit beiden Filtern kommen die beiden Strukturwarnungen NICHT.
    expect(e.schluessel).not.toContain('listenpreis_aenderung_preisart')
    expect(e.schluessel).not.toContain('listenpreis_aenderung_vergleichbar')
  })

  test('3. Preisaenderungen je Betrieb zaehlen, ohne preisart — doppelt gezaehlt, gewarnt', () => {
    const e = pruefe(`
      SELECT betrieb, count(*) AS aenderungen
        FROM mart.listenpreis_aenderung
       WHERE vergleichbar AND gueltig_ab >= '2026-11-01'
       GROUP BY betrieb`)
    expect(e.schluessel).toContain('listenpreis_aenderung_preisart')
    expect(befund(e, 'listenpreis_aenderung_preisart')!.schwere).toBe('warnung')
  })

  test('4. „Preissenkung um 100 %" bei Preis 0 — selbst gerechnet, gewarnt: kein Preis ist keine Senkung', () => {
    const e = pruefe(`
      SELECT ware, 100.0 * (preis_neu - preis_alt) / preis_alt AS senkung
        FROM mart.listenpreis_aenderung
       WHERE preisart = 'katalogpreis'
       ORDER BY senkung`)
    expect(e.schluessel).toContain('listenpreis_aenderung_vergleichbar')
    const b = befund(e, 'listenpreis_aenderung_vergleichbar')!
    expect(b.hinweis).toContain('-100 %')
    expect(b.berichtigung).toContain('kein Preis mehr')
  })

  test('4b. Richtig gefragt: je Preisart, nur vergleichbare, Prozent aus der Sicht — keine Strukturwarnung', () => {
    const e = pruefe(`
      SELECT preisart, count(*) AS aenderungen
        FROM mart.listenpreis_aenderung
       WHERE preisart = 'listenpreis' AND vergleichbar AND gueltig_ab >= '2026-11-01'
       GROUP BY preisart`)
    expect(e.erlaubt).toBe(true)
    expect(e.schluessel).not.toContain('listenpreis_aenderung_preisart')
    expect(e.schluessel).not.toContain('listenpreis_aenderung_vergleichbar')
  })

  test('4c. Ein Mittel ueber aenderung_pct ist gesperrt — Prozente verschiedener Waren mitteln nicht', () => {
    const e = pruefe(`
      SELECT avg(aenderung_pct) FROM mart.listenpreis_aenderung
       WHERE preisart = 'listenpreis' AND vergleichbar`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_avg_aenderung_pct')
  })
})

describe('Bezahlte Preise je Artikelnummer (0157)', () => {

  test('5. Durchschnittliche Teuerung ueber alle Waren — gesperrt, und der Vergleich reicht unterschiedlich weit', () => {
    const e = pruefe(`
      SELECT marke, avg(veraenderung_pct) FROM mart.einkaufspreis_artikel_monat
       WHERE monat = '2026-07-01' GROUP BY marke`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_avg_veraenderung_pct')
    expect(e.schluessel).toContain('einkaufspreis_artikel_vergleich_letzte_bestellung')
  })

  test('6. Teuerung aus der Zwischenstufe — ohne Gebindekennzeichen, gewarnt', () => {
    const e = pruefe(`
      SELECT lieferanten_nr, monat, preis_je_gebinde, vorher_preis
        FROM mart.einkaufspreis_artikel_monat_basis
       WHERE monat = '2026-07-01'`)
    expect(e.erlaubt).toBe(true)
    expect(e.schluessel).toContain('einkaufspreis_artikel_basis_zwischenstufe')
    expect(befund(e, 'einkaufspreis_artikel_basis_zwischenstufe')!.berichtigung)
      .toContain('mart.einkaufspreis_artikel_monat')
  })

  test('6b. Ausgaben je Marke summieren kommt durch — ausgaben ist eine echte Summe', () => {
    const e = pruefe(`
      SELECT marke, sum(ausgaben) FROM mart.einkaufspreis_artikel_monat
       WHERE monat >= '2026-01-01' GROUP BY marke`)
    expect(e.erlaubt).toBe(true)
  })
})

describe('Lieferkonditionen beobachtet (0156)', () => {

  test('7. „Mindestbestellwert je Lieferant" aus dem kleinsten Bestellwert — gewarnt, zweifach', () => {
    const e = pruefe(`
      SELECT lieferant, min(bestellwert_min_netto) AS mindestbestellwert
        FROM mart.lieferkondition_beobachtet
       GROUP BY lieferant`)
    // min() ist kein Mittel und keine Summe — gesperrt ist es nicht. Aber es ist
    // nicht der Mindestbestellwert, und duenne Zeilen sind dabei.
    expect(e.schluessel).toContain('lieferkondition_beobachtet_nicht_vereinbart')
    expect(befund(e, 'lieferkondition_beobachtet_nicht_vereinbart')!.hinweis).toContain('Mindestbestellwert')
    expect(e.schluessel).toContain('lieferkondition_nur_belastbar')
  })

  test('7b. Ein mittlerer Bestellwert ueber Betriebe ist gesperrt — ein Median mittelt nicht', () => {
    const e = pruefe(`
      SELECT lieferant, avg(bestellwert_median_netto) FROM mart.lieferkondition_beobachtet
       WHERE belastbar GROUP BY lieferant`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_avg_bestellwert_median_netto')
  })

  test('7c. Ein mittlerer Vorlauf ist gesperrt', () => {
    const e = pruefe(`SELECT avg(vorlauf_typisch_tage) FROM mart.lieferkondition_beobachtet WHERE belastbar`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_avg_vorlauf_typisch_tage')
  })

  test('8. Richtig gefragt: belastbare Zeilen eines Betriebs — keine Warnung zur Datenbasis', () => {
    const e = pruefe(`
      SELECT lieferant, bereich, liefertage_ueblich, vorlauf_typisch_tage, bestellwert_median_netto, bestellungen
        FROM mart.lieferkondition_beobachtet
       WHERE belastbar AND betrieb_key = 123`)
    expect(e.erlaubt).toBe(true)
    expect(e.schluessel).not.toContain('lieferkondition_nur_belastbar')
    // „beobachtet, nicht vereinbart" bleibt — die Deutung gilt immer.
    expect(e.schluessel).toContain('lieferkondition_beobachtet_nicht_vereinbart')
  })
})

describe('Kassenartikel → Rezept (0155)', () => {

  test('9. Artikelabdeckung je Betrieb aus den Anbindungen summiert — gesperrt: Bar und Kueche zaehlen doppelt', () => {
    const e = pruefe(`
      SELECT betrieb, 100.0 * sum(artikel_mit_rezept) / sum(artikel_gesamt) AS abdeckung
        FROM mart.pos_artikel_abdeckung
       GROUP BY betrieb`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_sum_artikel_mit_rezept')
    expect(e.schluessel).toContain('aggregat_sum_artikel_gesamt')
    expect(befund(e, 'aggregat_sum_artikel_mit_rezept')!.hinweis).toContain('mart.pos_artikel_rezept')
  })

  test('9b. Der Umsatz je Betrieb aus den Anbindungen summiert — gesperrt, er steht in beiden Zeilen', () => {
    const e = pruefe(`
      SELECT betrieb, sum(umsatz_betrieb_3m) FROM mart.pos_artikel_abdeckung GROUP BY betrieb`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_sum_umsatz_betrieb_3m')
    expect(e.schluessel).toContain('pos_artikel_umsatz_betriebswert')
  })

  test('10. Mittlere Rezeptabdeckung der Marke aus den Betriebsprozenten — gesperrt', () => {
    const e = pruefe(`
      SELECT marke, avg(umsatz_rezept_pct) FROM mart.pos_artikel_abdeckung_betrieb GROUP BY marke`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_avg_umsatz_rezept_pct')
  })

  test('10b. Richtig: aus den Euro-Summen — kommt durch, mit dem Hinweis „kein Wareneinsatz"', () => {
    const e = pruefe(`
      SELECT round(100.0 * sum(umsatz_mit_rezept_3m) / sum(umsatz_netto_3m), 1) AS umsatz_mit_rezept_pct
        FROM mart.pos_artikel_abdeckung_betrieb
       WHERE marke_aktiv AND anbindungen_geladen > 0`)
    expect(e.erlaubt).toBe(true)
    expect(e.schluessel).toContain('pos_artikel_kein_wareneinsatz')
  })

  test('10c. Artikel je Betrieb ueber mehrere Betriebe summiert — gesperrt', () => {
    const e = pruefe(`SELECT sum(artikel_verkauft_mit_rezept) FROM mart.pos_artikel_abdeckung_betrieb`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_sum_artikel_verkauft_mit_rezept')
  })

  test('11. Welches Rezept steckt hinter Artikel X — kommt durch, mit dem Hinweis auf zwei Anbindungen', () => {
    const e = pruefe(`
      SELECT betrieb, kostenstelle, kassenartikel, rezept, hat_rezept
        FROM mart.pos_artikel_rezept
       WHERE artikel_key = 4711 AND betrieb_key = 123`)
    expect(e.erlaubt).toBe(true)
    expect(e.schluessel).toContain('pos_artikel_zwei_anbindungen')
  })
})

describe('Die Karten als Berichte', () => {
  const NEU = alleKarten.filter(k =>
    /^(ap_|lp_|rz_)/.test(k.schluessel)
    || ['ar_rezept', 'wa_lieferkondition', 'wa_kachel_artikelpreis', 'im_pos_artikel', 'im_warenstamm']
         .includes(k.schluessel))

  test('alle 22 neuen Karten sind da', () => {
    expect(NEU.length).toBe(22)
  })

  test('sie lesen nur mart — der Chat fuehrt sie als mcp_leser aus', () => {
    for (const k of NEU) {
      const z = zerlegen(uebersetzen(k, {}).sql)
      const fremd = [...z.sichten].filter(s => !s.startsWith('mart.'))
      expect({ karte: k.schluessel, fremd }).toEqual({ karte: k.schluessel, fremd: [] })
    }
  })

  test('der Lieferantenfilter der Listenpreise trifft auch ueber den Schluessel — zwei Platzhalter, zwei Werte', () => {
    const { sql, parameter } = uebersetzen(alleKarten.find(k => k.schluessel === 'lp_aktuell')!,
      { lieferant: 'Distra Aposto', artikelnummer: '263' })
    expect(parameter).toEqual(['Distra Aposto', 'Distra Aposto', '263'])
    expect(sql).toContain('lieferant_key IN')
    expect(sql).not.toContain('Distra')
  })

  test('die Lieferkonditionen zeigen ohne Datenbasis nur belastbare, mit „alle" alles', () => {
    const k = alleKarten.find(k => k.schluessel === 'wa_lieferkondition')!
    expect(uebersetzen(k, {}).sql).toMatch(/WHERE \(belastbar\s*\)/)
    const mit = uebersetzen(k, { datenbasis: 'alle' })
    expect(mit.sql).toMatch(/belastbar OR \$1 = 'alle'/)
    expect(mit.parameter).toEqual(['alle'])
  })

  test('sie werden mit den Woertern des Fachbereichs gefunden', () => {
    for (const [wort, karte] of [['listenpreis', 'lp_aktuell'], ['katalog', 'lp_katalog_abweichung'],
                                  ['artikelnummer', 'ap_veraenderung'], ['teurer', 'ap_veraenderung'],
                                  ['rezept', 'rz_betrieb_tabelle'], ['rezeptur', 'rz_ohne_rezept'],
                                  ['geliefert', 'wa_lieferkondition'], ['warenstamm', 'im_warenstamm'],
                                  ['kassenartikel', 'im_pos_artikel']] as const) {
      expect({ wort, gefunden: berichteSuchen(wort, 50).some(b => b.schluessel === karte) })
        .toEqual({ wort, gefunden: true })
    }
  })
})
