/**
 * Fallenfragen zum Soll-Verbrauch (Migration 0159): Verkauf × Rezept.
 *
 * Dasselbe Muster wie fallen_preise_rezepte.test.ts: jede Frage ist eine, die
 * ein Sprachmodell natuerlich stellt und die hier eine plausibel aussehende
 * falsche Aussage ergibt — der Soll-Verbrauch als ganzer Verbrauch, die
 * Differenz zum Einkauf als Schwund, ein Mittel ueber Betriebsprozente. Die
 * richtige Fassung derselben Frage muss durchkommen.
 *
 * Laeuft ohne Datenbank gegen test/katalog.json.
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

describe('Die Sichten aus 0159 stehen im Katalog', () => {
  test('alle acht mart-Sichten sind bekannt und haben eine Koernung', () => {
    for (const s of ['mart.rezept_stueckliste', 'mart.rezept_stueckliste_basis', 'mart.soll_rezept_zuordnung',
                     'mart.soll_artikel_monat', 'mart.soll_verbrauch_abdeckung', 'mart.soll_verbrauch_monat',
                     'mart.soll_verbrauch_tag', 'mart.soll_ist_monat']) {
      expect({ s, koernung: !!katalog.sichten.get(s)?.koernung }).toEqual({ s, koernung: true })
    }
  })
})

describe('Soll-Verbrauch', () => {

  test('1. „Wie viel Hack hat der Betrieb im Juli verbraucht?" — kommt durch, mit dem Hinweis auf die Abdeckung', () => {
    const e = pruefe(`
      SELECT ware, einheit, soll_menge
        FROM mart.soll_verbrauch_monat
       WHERE betrieb_key = 123 AND monat = '2026-07-01' AND ware ILIKE '%hack%'`)
    expect(e.erlaubt).toBe(true)
    expect(e.schluessel).toContain('soll_verbrauch_untergrenze')
    const b = befund(e, 'soll_verbrauch_untergrenze')!
    expect(b.hinweis).toContain('Untergrenze')
    expect(b.berichtigung).toContain('abdeckung_umsatz_pct')
  })

  test('2. Mittlere Abdeckung der Marke aus den Betriebsprozenten — gesperrt; aus den Euro-Summen — erlaubt', () => {
    const falsch = pruefe(`
      SELECT marke, avg(abdeckung_umsatz_pct) FROM mart.soll_verbrauch_abdeckung
       WHERE monat = '2026-07-01' AND zustand = 'ok' GROUP BY marke`)
    expect(falsch.erlaubt).toBe(false)
    expect(falsch.schluessel).toContain('aggregat_avg_abdeckung_umsatz_pct')

    const richtig = pruefe(`
      SELECT marke, round(100.0 * sum(umsatz_vollstaendig) / sum(umsatz_netto), 1) AS abdeckung_pct
        FROM mart.soll_verbrauch_abdeckung
       WHERE monat = '2026-07-01' AND zustand = 'ok' GROUP BY marke`)
    expect(richtig.erlaubt).toBe(true)
  })

  test('3. „Wie viel Schwund hat Betrieb X?" als Einkauf minus Soll — gewarnt: kein Schwund, und nicht vergleichbar gefiltert', () => {
    const e = pruefe(`
      SELECT ware, eingekauft_menge - soll_menge AS schwund
        FROM mart.soll_ist_monat
       WHERE betrieb_key = 123 AND monat = '2026-07-01'
       ORDER BY schwund DESC`)
    expect(e.erlaubt).toBe(true)
    expect(e.schluessel).toContain('soll_ist_kein_schwund')
    expect(e.schluessel).toContain('soll_ist_vergleichbar')
    expect(befund(e, 'soll_ist_kein_schwund')!.hinweis).toContain('KEIN')
  })

  test('3b. Richtig gefragt: nur vergleichbare Zeilen — die Strukturwarnung entfaellt, der Schwund-Hinweis bleibt', () => {
    const e = pruefe(`
      SELECT ware, einheit, soll_menge, eingekauft_menge, einkauf_zu_soll_pct, abdeckung_umsatz_pct
        FROM mart.soll_ist_monat
       WHERE betrieb_key = 123 AND monat = '2026-07-01' AND vergleichbar`)
    expect(e.erlaubt).toBe(true)
    expect(e.schluessel).not.toContain('soll_ist_vergleichbar')
    expect(e.schluessel).toContain('soll_ist_kein_schwund')
  })

  test('3c. Ein Mittel ueber einkauf_zu_soll_pct ist gesperrt', () => {
    const e = pruefe(`SELECT avg(einkauf_zu_soll_pct) FROM mart.soll_ist_monat WHERE vergleichbar`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_avg_einkauf_zu_soll_pct')
  })

  test('4. „Wie viel Ware steckt in einer Portion?" als Summe ueber die Stueckliste — gesperrt (Einheiten gemischt)', () => {
    const e = pruefe(`
      SELECT rezept, sum(menge_je_portion) FROM mart.rezept_stueckliste
       WHERE rezept_fn_id = 984982 GROUP BY rezept`)
    expect(e.erlaubt).toBe(false)
    expect(e.schluessel).toContain('aggregat_sum_menge_je_portion')
    expect(e.schluessel).toContain('rezept_stueckliste_belastbar')
  })

  test('4b. Richtig: die Stueckliste Zeile fuer Zeile, nur belastbare — keine Strukturwarnung', () => {
    const e = pruefe(`
      SELECT pfad, ware, menge_je_portion, einheit_soll
        FROM mart.rezept_stueckliste
       WHERE rezept_fn_id = 984982 AND belastbar
       ORDER BY weg`)
    expect(e.erlaubt).toBe(true)
    expect(e.schluessel).not.toContain('rezept_stueckliste_belastbar')
  })

  test('5. Der Tages-Soll ohne Zeitraum — gewarnt', () => {
    const e = pruefe(`SELECT betrieb, sum(soll_menge) FROM mart.soll_verbrauch_tag WHERE artikelnummer = '300120' GROUP BY betrieb`)
    expect(e.schluessel).toContain('soll_verbrauch_tag_zeitraum')
    const mit = pruefe(`
      SELECT betrieb, sum(soll_menge) FROM mart.soll_verbrauch_tag
       WHERE artikelnummer = '300120' AND geschaeftstag BETWEEN '2026-07-01' AND '2026-07-31' GROUP BY betrieb`)
    expect(mit.schluessel).not.toContain('soll_verbrauch_tag_zeitraum')
    expect(mit.schluessel).toContain('soll_verbrauch_tag_untergrenze')
  })

  test('6. Der Hinweis aus 0155 verweist jetzt auf den Soll-Verbrauch', () => {
    const e = pruefe(`
      SELECT round(100.0 * sum(umsatz_mit_rezept_3m) / sum(umsatz_netto_3m), 1)
        FROM mart.pos_artikel_abdeckung_betrieb WHERE marke_aktiv AND anbindungen_geladen > 0`)
    expect(befund(e, 'pos_artikel_kein_wareneinsatz')!.hinweis).toContain('mart.soll_verbrauch_monat')
  })
})

describe('Die Karten als Berichte', () => {
  const NEU = alleKarten.filter(k => k.schluessel.startsWith('sv_'))

  test('alle acht sv_-Karten sind da', () => {
    expect(NEU.length).toBe(8)
  })

  test('sie lesen nur mart — der Chat fuehrt sie als mcp_leser aus', () => {
    for (const k of NEU) {
      const z = zerlegen(uebersetzen(k, {}).sql)
      const fremd = [...z.sichten].filter(s => !s.startsWith('mart.'))
      expect({ karte: k.schluessel, fremd }).toEqual({ karte: k.schluessel, fremd: [] })
    }
  })

  test('die Stueckliste ist ohne Rezept-Nr. leer und mit Rezept-Nr. ein Parameter', () => {
    const k = alleKarten.find(k => k.schluessel === 'sv_stueckliste')!
    expect(uebersetzen(k, {}).sql).toMatch(/coalesce\(\s*''\)/)
    const mit = uebersetzen(k, { rezept: '984982' })
    expect(mit.parameter).toEqual(['984982'])
  })

  test('sie werden mit den Woertern des Fachbereichs gefunden', () => {
    for (const [wort, karte] of [['soll-verbrauch', 'sv_abdeckung'], ['stückliste', 'sv_stueckliste'],
                                  ['einkauf', 'sv_soll_ist']] as const) {
      expect({ wort, gefunden: berichteSuchen(wort, 50).some(b => b.schluessel === karte) })
        .toEqual({ wort, gefunden: true })
    }
  })
})
