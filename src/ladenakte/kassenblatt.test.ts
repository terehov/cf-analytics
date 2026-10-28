/**
 * Der Kassenblatt-Parser gegen ECHTE Antworten (28.10.2026 aus LINA, nur GET,
 * gekürzt auf die Datentabelle — src/transform/fixtures/kassenblatt_*.html).
 *
 * Die Sollwerte sind keine aus dem Parser abgeschriebenen Zahlen, sondern am
 * selben Tag unabhängig gemessen: im Browser abgelesen, gegen
 * `mart.umsatz_tag` (Ludwigsburg, LINA-Kasse) und gegen die BWA (Bremen).
 */
import { describe, expect, test } from 'bun:test'
import { kassenblattTageLesen, kassenblattJahreLesen, ParseFehler } from './html'

const lies = (name: string) => Bun.file(`src/transform/fixtures/${name}`).text()

const BREMEN_08 = await lies('kassenblatt_tage_bremen_2026_08.html')
const BREMEN_10 = await lies('kassenblatt_tage_bremen_2026_10.html')
const LUDWIGSBURG_09 = await lies('kassenblatt_tage_ludwigsburg_2026_09.html')
const JAHRE_BREMEN = await lies('kassenblatt_jahre_bremen.html')
const JAHRE_LUDWIGSBURG = await lies('kassenblatt_jahre_ludwigsburg.html')

const rund = (n: number) => Math.round(n * 100) / 100

describe('kassenblattTageLesen', () => {
  test('Enchilada Bremen, August 2026 — fremde Kasse', () => {
    const m = kassenblattTageLesen(BREMEN_08, { monat: 8, jahr: 2026 })
    expect(m.monat).toBe('2026-08-01')
    expect(m.gruppen).toEqual(['Getränke', 'Essen', 'Biergartenumsatz (Getränke) inaktiv inaktiv'])
    expect(m.tage).toHaveLength(31)
    expect(m.summe).toBe(94044.61)
    expect(m.tage[0]).toEqual({
      datum: '2026-08-01', netto: 1624.45,
      gruppen: [
        { name: 'Getränke', netto: 0 }, { name: 'Essen', netto: 0 },
        { name: 'Biergartenumsatz (Getränke) inaktiv inaktiv', netto: 1624.45 },
      ],
    })
    expect(m.tage[30].datum).toBe('2026-08-31')
    expect(m.tage[30].netto).toBe(1549.98)
  })

  test('Ratskeller Ludwigsburg, September 2026 — LINA-Kasse, trifft getUmsatzbericht', () => {
    const m = kassenblattTageLesen(LUDWIGSBURG_09, { monat: 9, jahr: 2026 })
    expect(m.gruppen).toEqual(['Getränke', 'Speisen', 'Divers', 'Gutschein', 'Miete&Organisation'])
    expect(m.tage).toHaveLength(30)
    // mart.umsatz_tag am 28.10.2026: 95.791,39 €
    expect(rund(m.tage.reduce((a, t) => a + t.netto, 0))).toBe(95791.39)
    // Ein negativer Gruppenwert ist echt (Gutschein −100,00 am 02.09.)
    expect(m.tage[1].gruppen.find(g => g.name === 'Gutschein')!.netto).toBe(-100)
  })

  test('laufender Monat endet am Vortag', () => {
    const m = kassenblattTageLesen(BREMEN_10, { monat: 10, jahr: 2026 })
    expect(m.tage.at(-1)!.datum).toBe('2026-10-27')
    expect(m.summe).toBe(88220.21)
  })

  /**
   * Der wichtigste Test hier. LINA ignoriert einen Parameter, den es nicht
   * kennt, und zeigt dann den laufenden Monat — die Antwort sieht aus wie
   * jede andere.
   */
  test('ein anderer Monat als angefragt wirft', () => {
    expect(() => kassenblattTageLesen(BREMEN_10, { monat: 9, jahr: 2026 })).toThrow(ParseFehler)
    expect(() => kassenblattTageLesen(BREMEN_08, { monat: 8, jahr: 2025 })).toThrow(/2025/)
  })

  /**
   * Lauf 182 (28.10.2026): bei drei von sechs Betrieben steht an je einem Tag
   * im Gesamt ein Betrag, der in keiner angezeigten Gruppe ist. Das ist LINAs
   * Datenlage, kein Parserfehler — gemeldet, nicht geworfen, Gesamt bleibt.
   */
  test('Gesamt ≠ Summe der Gruppen wird gemeldet, nicht geworfen', () => {
    const anders = BREMEN_08.replace('<td>1.624,45</td>', '<td>1.000,00</td>')
    expect(anders).not.toBe(BREMEN_08)
    const m = kassenblattTageLesen(anders, { monat: 8, jahr: 2026 })
    expect(m.abweichende_tage).toEqual([{ datum: '2026-08-01', netto: 1624.45, gruppen_summe: 1000 }])
    expect(m.tage[0].netto).toBe(1624.45)
    expect(kassenblattTageLesen(BREMEN_08, { monat: 8, jahr: 2026 }).abweichende_tage).toEqual([])
  })

  /** Lauf 182: ein Betrieb ohne Kassenblatt liefert die Tabelle ohne Tageszeilen. */
  test('Tabelle ohne Tageszeilen ist ein leerer Monat, kein Fehler', () => {
    const ohneTage = BREMEN_10
      .replace(/<tr[^>]*>\s*<td class="text-center">\s*<\/td>\s*<td class="text-center">\s*\S+, \d{2}\.10\.[\s\S]*?<\/tr>/g, '')
      .replace('88.220,21 (', '0,00 (')
    expect(ohneTage).not.toBe(BREMEN_10)
    const m = kassenblattTageLesen(ohneTage, { monat: 10, jahr: 2026 })
    expect(m.tage).toEqual([])
    expect(m.summe).toBe(0)
    // Nennt die Monatszeile trotzdem Umsatz, fehlt etwas.
    const widerspruch = ohneTage.replace('0,00 (', '12,34 (')
    expect(() => kassenblattTageLesen(widerspruch, { monat: 10, jahr: 2026 })).toThrow(/keine Tageszeilen/)
  })

  test('fehlende Tageszeile wirft (Summe der Tage ≠ Monatssumme)', () => {
    const ohne = BREMEN_08.replace(/<tr[^>]*>\s*<td class="text-center">\s*<\/td>\s*<td class="text-center">\s*Sa, 01\.08\.[\s\S]*?<\/tr>/, '')
    expect(ohne).not.toBe(BREMEN_08)
    expect(() => kassenblattTageLesen(ohne, { monat: 8, jahr: 2026 })).toThrow(/Monatssumme/)
  })
})

describe('kassenblattJahreLesen', () => {
  test('Enchilada Bremen — Monatswerte seit 2009, leere Zellen ausgelassen', () => {
    const w = kassenblattJahreLesen(JAHRE_BREMEN)
    const wert = (m: string) => w.find(x => x.monat === m)?.netto
    expect(wert('2019-01-01')).toBe(57408.57)      // = „Die letzten Tage" 01/2019
    expect(wert('2026-08-01')).toBe(94044.61)      // = „Die letzten Tage" 08/2026
    expect(wert('2010-01-01')).toBe(46981.85)
    // Januar 2021 ist leer (Lockdown) — keine Zeile, nicht 0
    expect(wert('2021-01-01')).toBeUndefined()
    expect(w.every(x => Number.isFinite(x.netto))).toBe(true)
  })

  test('Ratskeller Ludwigsburg September 2026 = getUmsatzbericht', () => {
    const w = kassenblattJahreLesen(JAHRE_LUDWIGSBURG)
    expect(w.find(x => x.monat === '2026-09-01')?.netto).toBe(95791.39)
  })

  test('ein anderer Filter als Gesamtumsatz wirft', () => {
    const getraenke = JAHRE_BREMEN
      .replace(/<option value="0" selected="selected" >\s*Gesamtumsatz/, '<option value="0" > Gesamtumsatz')
      .replace('<option value="1">Getränke', '<option value="1" selected="selected">Getränke')
    expect(getraenke).not.toBe(JAHRE_BREMEN)
    expect(() => kassenblattJahreLesen(getraenke)).toThrow(/show/)
  })
})

describe('berichtPfad', () => {
  // Gekuerzt aus dem echten Baumknoten report_18 (Enchilada Bremen, 28.10.2026).
  const knoten = {
    id: 'report_18', text: 'Reports', children: [
      { id: 'report_718', text: 'Kassenblatt/ZE', a_attr: { 'data-link':
        '/intranet/report/kasse/laden/6fc0ba280cea8e72e6aa24f95e42f75b58bafd70b265688a107efbf0c76a20de845e1e163d1c66c40279/admin/1/' } },
      { id: 'report_818', text: 'Die letzten Tage', a_attr: { 'data-link':
        '/intranet/report/monatsanalyse/laden/d71e0121f0ac96704a3a241d3b8d3de30adf3c28c68e19b348f5f2c2c698ee8bf6fec932a527521a8e44/admin/1/' } },
      { id: 'report_918', text: 'Die letzten Jahre', a_attr: { 'data-link':
        '/intranet/report/jahresuebersicht/laden/fc8039839a83ab1d300c4ba46cc7bd2b528582a440db31c9e589c8aa9c990467d39b085012b8ebed0330/admin/1/' } },
    ],
  }
  const holer = (aufrufe: string[]) => ({
    async holen(_ep: unknown, p: Record<string, string>) {
      aufrufe.push(p.id)
      return { art: 'ok' as const, daten: knoten }
    },
  })

  test('findet den Bericht am exakten Namen und merkt ihn sich', async () => {
    const { berichtPfad, cacheLeeren } = await import('./token')
    cacheLeeren()
    const aufrufe: string[] = []
    const h = holer(aufrufe)
    const tage = await berichtPfad(h as any, '18', 'Die letzten Tage', 1_000)
    expect(tage).toStartWith('/intranet/report/monatsanalyse/laden/d71e')
    const jahre = await berichtPfad(h as any, '18', 'Die letzten Jahre', 1_000)
    expect(jahre).toStartWith('/intranet/report/jahresuebersicht/laden/fc80')
    await berichtPfad(h as any, '18', 'Die letzten Tage', 2_000)
    expect(aufrufe).toEqual(['report_18', 'report_18'])
  })

  test('ein fehlender Bericht wirft, statt einen Nachbarn zu nehmen', async () => {
    const { berichtPfad, cacheLeeren } = await import('./token')
    cacheLeeren()
    await expect(berichtPfad(holer([]) as any, '18', 'Die letzten', 1_000)).rejects.toThrow(/nicht im Baumknoten/)
  })
})
