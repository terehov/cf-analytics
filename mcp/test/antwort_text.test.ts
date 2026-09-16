/**
 * Die Daten als Text — fuer Hosts, deren Modell structuredContent nicht sieht
 * (Claude, 16.09.2026). Ohne Datenbank.
 */
import { describe, expect, test } from 'bun:test'
import { alsTabelle, datenAlsTextErgaenzen, strukturAlsText, wirtAus } from '../src/antwort_text'

const extraMit = (userAgent?: string) =>
  ({ http: { req: { headers: new Headers(userAgent ? { 'user-agent': userAgent } : {}) } } }) as any

const ERGEBNIS = {
  spalten: ['Betrieb', 'Marke', 'Umsatz netto'],
  zeilen: [
    { Betrieb: 'Enchilada Köln', Marke: 'Enchilada', 'Umsatz netto': 182345.67 },
    { Betrieb: 'Aposto Bruchsal', Marke: 'Aposto', 'Umsatz netto': null },
  ],
  zeilen_gesamt: 2,
  koernung: [{ sicht: 'mart.kennzahlen_aktuell', koernung: 'Betrieb und Monat' }],
  hinweise: [],
  datenstand: { umsatz_bis: '2026-09-14', bwa_bis: '2026-08-01', betriebe: 141, umsatz_veraltet: 0, bwa_im_rueckstand: 3 },
  spalten_info: [
    { spalte: 'Betrieb', rolle: 'merkmal', verschieden: 2, beispiele: ['Enchilada Köln'] },
    { spalte: 'Umsatz netto', rolle: 'kennzahl', einheit: 'euro', verschieden: 1, spanne: [182345.67, 182345.67] },
  ],
  darstellung: 'Zwei Betriebe: Balken nebeneinander.',
}

describe('Der Wirt am User-Agent', () => {
  test('ChatGPT wird erkannt, alles andere nicht', () => {
    expect(wirtAus(extraMit('openai-mcp/1.0'))).toBe('openai')
    expect(wirtAus(extraMit('ChatGPT-User/1.0'))).toBe('openai')
    expect(wirtAus(extraMit('claude-user'))).toBe('andere')
    expect(wirtAus(extraMit('node'))).toBe('andere')
    expect(wirtAus(extraMit())).toBe('andere')
    expect(wirtAus(undefined)).toBe('andere')
  })
})

describe('Die Tabelle', () => {
  test('gleichfoermige Objekte werden Kopfzeile plus eine Zeile je Eintrag', () => {
    expect(alsTabelle(ERGEBNIS.zeilen)).toBe(
      'Betrieb | Marke | Umsatz netto\n' +
      'Enchilada Köln | Enchilada | 182345.67\n' +
      'Aposto Bruchsal | Aposto | ')
  })
  test('unterschiedliche Schluessel werden vereinigt, fehlende Zellen bleiben leer', () => {
    expect(alsTabelle([{ a: 1 }, { b: 2 }])).toBe('a | b\n1 | \n | 2')
  })
  test('Zahlen bleiben roh — zum Rechnen, nicht zum Vorlesen', () => {
    expect(alsTabelle([{ n: 1234567.5 }])).toBe('n\n1234567.5')
  })
  test('Trenner und Zeilenumbrueche in Zellen werden entschaerft', () => {
    expect(alsTabelle([{ t: 'a | b\nc' }])).toBe('t\na ¦ b c')
  })
  test('verschachtelte Werte in Zellen werden JSON', () => {
    expect(alsTabelle([{ spanne: [1, 2], o: { x: 1 } }])).toBe('spanne | o\n[1,2] | {"x":1}')
  })
  test('keine Tabelle fuer Listen von Zahlen, Texten, gemischten oder leeren Listen', () => {
    expect(alsTabelle([1, 2])).toBeNull()
    expect(alsTabelle(['a'])).toBeNull()
    expect(alsTabelle([{ a: 1 }, 2])).toBeNull()
    expect(alsTabelle([])).toBeNull()
    expect(alsTabelle('x')).toBeNull()
  })
})

describe('Der ganze structuredContent als Text', () => {
  test('Listen als Tabellen, Texte roh, der Rest als JSON — alles vorhanden', () => {
    const text = strukturAlsText(ERGEBNIS)
    expect(text).toContain('spalten: ["Betrieb","Marke","Umsatz netto"]')
    expect(text).toContain('zeilen (2):\nBetrieb | Marke | Umsatz netto\nEnchilada Köln | Enchilada | 182345.67\nAposto Bruchsal | Aposto | ')
    expect(text).toContain('zeilen_gesamt: 2')
    expect(text).toContain('koernung (1):\nsicht | koernung\nmart.kennzahlen_aktuell | Betrieb und Monat')
    expect(text).toContain('hinweise: []')
    expect(text).toContain('datenstand: {"umsatz_bis":"2026-09-14","bwa_bis":"2026-08-01","betriebe":141,"umsatz_veraltet":0,"bwa_im_rueckstand":3}')
    expect(text).toContain('spalten_info (2):\nspalte | rolle | verschieden | beispiele | einheit | spanne\n')
    expect(text).toContain('darstellung: Zwei Betriebe: Balken nebeneinander.')
  })
  test('ist deutlich kleiner als JSON, weil die Spaltennamen nur einmal stehen', () => {
    const zeilen = Array.from({ length: 50 }, (_, i) => ({
      Betrieb: `Betrieb ${i}`, Marke: 'Enchilada', '●': '🔴', 'Umsatz %': i / 10, '◐ Umsatz': '🟢', 'Personal %': 30 + i, 'Priorität': i,
    }))
    const text = strukturAlsText({ spalten: Object.keys(zeilen[0]!), zeilen, zeilen_gesamt: 50 })
    expect(text.length).toBeLessThan(JSON.stringify({ zeilen }).length * 0.5)
  })
  test('der Treffer von betriebe_suchen traegt den betrieb_key', () => {
    const text = strukturAlsText({ treffer: [
      { betrieb_key: 17, betrieb: 'Aposto Bruchsal', konzept: 'Aposto', umsatz_bis: '2026-09-14', bwa_bis: '2026-08-01', befund: 'vollstaendig' },
    ] })
    expect(text).toBe('treffer (1):\nbetrieb_key | betrieb | konzept | umsatz_bis | bwa_bis | befund\n' +
                      '17 | Aposto Bruchsal | Aposto | 2026-09-14 | 2026-08-01 | vollstaendig')
  })
  test('Nicht-Objekte werden nicht zerlegt', () => {
    expect(strukturAlsText('x')).toBe('x')
    expect(strukturAlsText(3)).toBe('3')
    expect(strukturAlsText(null)).toBe('null')
  })
})

describe('Die Middleware', () => {
  const antwort = () => ({
    content: [{ type: 'text', text: '1 Treffer.' }],
    structuredContent: { treffer: [{ betrieb_key: 17, betrieb: 'Aposto Bruchsal' }] },
    _meta: { viewUUID: 'x' },
  })

  test('fuer Claude wird der structuredContent als zweiter Textblock angehaengt, sonst bleibt alles gleich', async () => {
    const vorher = antwort()
    const e = await datenAlsTextErgaenzen({ method: 'tools/call', params: {} }, extraMit('claude-user'), async () => vorher) as any
    expect(e.content).toHaveLength(2)
    expect(e.content[0]).toEqual({ type: 'text', text: '1 Treffer.' })
    expect(e.content[1]).toEqual({ type: 'text', text: 'treffer (1):\nbetrieb_key | betrieb\n17 | Aposto Bruchsal' })
    expect(e.structuredContent).toBe(vorher.structuredContent)
    expect(e._meta).toBe(vorher._meta)
    // Die Antwort des Handlers selbst bleibt unveraendert (kein Nebeneffekt).
    expect(vorher.content).toHaveLength(1)
  })

  test('ohne User-Agent (unbekannter Host) ebenfalls', async () => {
    const e = await datenAlsTextErgaenzen({ method: 'tools/call', params: {} }, extraMit(), async () => antwort()) as any
    expect(e.content).toHaveLength(2)
  })

  test('fuer ChatGPT NICHT — das Modell liest structuredContent, doppelt waere doppelt so teuer', async () => {
    const a = antwort()
    const e = await datenAlsTextErgaenzen({ method: 'tools/call', params: {} }, extraMit('openai-mcp/1.0'), async () => a)
    expect(e).toBe(a)
  })

  test('Fehlerantworten und Antworten ohne structuredContent bleiben unangetastet', async () => {
    const fehler = { isError: true, content: [{ type: 'text', text: 'kaputt' }], structuredContent: { x: 1 } }
    expect(await datenAlsTextErgaenzen({ method: 'tools/call', params: {} }, extraMit('claude-user'), async () => fehler)).toBe(fehler)
    const ohne = { content: [{ type: 'text', text: 'nur Text' }] }
    expect(await datenAlsTextErgaenzen({ method: 'tools/call', params: {} }, extraMit('claude-user'), async () => ohne)).toBe(ohne)
    const leer = { content: [], structuredContent: {} }
    expect(await datenAlsTextErgaenzen({ method: 'tools/call', params: {} }, extraMit('claude-user'), async () => leer)).toBe(leer)
  })

  test('ein Text-content (nicht normalisiert) wird zur Liste mit beiden Bloecken', async () => {
    const e = await datenAlsTextErgaenzen({ method: 'tools/call', params: {} }, extraMit('claude-user'),
      async () => ({ content: '3 Zeilen.', structuredContent: { zeilen: [{ a: 1 }] } })) as any
    expect(e.content).toEqual([{ type: 'text', text: '3 Zeilen.' }, { type: 'text', text: 'zeilen (1):\na\n1' }])
  })
})
