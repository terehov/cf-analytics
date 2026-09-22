/**
 * Die Uebersetzung der Karten in ausfuehrbares SQL.
 *
 * Der Fehler, den diese Tests fangen, ist derselbe, den
 * metabase/karten.test.ts fuer Metabase faengt: eine Karte, die ohne Filter
 * laeuft und mit gesetztem Filter umfaellt. Hier kommt hinzu, dass Werte
 * PARAMETER werden muessen und nicht Text — ein Betriebsname mit Apostroph
 * waere sonst ein Syntaxfehler.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { parserBereitstellen, zerlegen } from '../src/ast'
import { alleKarten, berichteSuchen, BerichtFehler, karteFinden, uebersetzen } from '../src/berichte'

beforeAll(async () => { await parserBereitstellen() })

describe('Berichte', () => {

  test('alle 285 Karten stehen zur Verfuegung und haben eindeutige Schluessel', () => {
    expect(alleKarten.length).toBeGreaterThanOrEqual(280)
    const schluessel = alleKarten.map(k => k.schluessel)
    expect(new Set(schluessel).size).toBe(schluessel.length)
  })

  /**
   * DIE WICHTIGSTE PRUEFUNG DIESER DATEI. Jede Karte, einmal ohne Werte und
   * einmal mit allen gesetzt, muss gueltiges PostgreSQL ergeben. Geprueft
   * wird mit dem Parser von PostgreSQL selbst — ohne Datenbank, damit der
   * Test ueberall laeuft.
   */
  const werteFuer = (k: ReturnType<typeof karteFinden>) => {
    const w: Record<string, unknown> = {}
    for (const p of k!.parameter ?? []) {
      if (p.festeWerte?.length) w[p.name] = p.festeWerte[0]
      else if (p.type === 'date/range') w[p.name] = { von: '2026-01-01', bis: '2026-03-31' }
      else if (p.type.startsWith('date')) w[p.name] = '2026-01-01'
      else w[p.name] = 'Testwert'
    }
    return w
  }

  for (const karte of alleKarten) {
    test(`${karte.schluessel} ergibt gueltiges SQL — ohne und mit Werten`, () => {
      for (const werte of [{}, werteFuer(karte)]) {
        const { sql } = uebersetzen(karte, werte)
        expect(() => zerlegen(sql)).not.toThrow()
      }
    })
  }

  test('Werte werden Parameter, nicht Text — ein Apostroph bleibt harmlos', () => {
    const karte = alleKarten.find(k => k.parameter?.some(p => p.name === 'betrieb'))!
    const { sql, parameter } = uebersetzen(karte, { betrieb: "L'Osteria" })
    expect(sql).not.toContain("L'Osteria")
    expect(parameter).toContain("L'Osteria")
  })

  test('Ein optionaler Block faellt ohne Wert weg und bleibt mit Wert stehen', () => {
    const karte = alleKarten.find(k => /\[\[[^\]]*\{\{\s*betrieb\s*\}\}/.test(k.sql))!
    expect(uebersetzen(karte, {}).sql).not.toMatch(/a\.betrieb\s*=\s*\$/)
    expect(uebersetzen(karte, { betrieb: 'Bayreuth' }).sql).toMatch(/\$\d/)
  })

  test('Ein unbekannter Parameter wird abgewiesen, nicht stillschweigend verworfen', () => {
    const karte = alleKarten[0]!
    expect(() => uebersetzen(karte, { gibtesnicht: 'x' })).toThrow(BerichtFehler)
  })

  test('Ein Feldfilter ohne Wert wird zu true, mit Wert zu einer Klausel', () => {
    const karte = alleKarten.find(k => k.template_tag_dimension)!
    const [tag, ziel] = Object.entries(karte.template_tag_dimension!)[0]!
    expect(uebersetzen(karte, {}).sql).toContain('true')
    const mit = uebersetzen(karte, { [tag]: { von: '2026-01-01', bis: '2026-02-01' } })
    expect(mit.sql).toContain(`${ziel[1]}.${ziel[2]} BETWEEN`)
    // Steht derselbe Filter mehrfach im SQL, bekommt jede Stelle ihre eigenen
    // Platzhalter — gleichwertig und einfacher als eine Wiederverwendung.
    expect(mit.parameter.length % 2).toBe(0)
    expect(new Set(mit.parameter)).toEqual(new Set(['2026-01-01', '2026-02-01']))
  })

  /**
   * Die Kassenkarten (0117) muessen im Chat auffindbar sein, mit dem Wort, das
   * der Fachbereich benutzt — auch mit Umlaut, auch ohne. Und sie duerfen nur
   * mart lesen: der MCP-Zugang fuehrt sie als mcp_leser aus, core ist dort
   * gesperrt (die Artikelaktion-Karten aa_kopf … lesen core und laufen im Chat
   * nicht — offene-punkte.md).
   */
  test('Die Kassenberichte werden gefunden — mit und ohne Umlaut', () => {
    for (const wort of ['glücksrad', 'gluecksrad', 'nachlass', 'nachlässe']) {
      const treffer = berichteSuchen(wort).map(b => b.schluessel)
      expect({ wort, treffer: treffer.includes('ka_nachlass_betrieb') || treffer.includes('ka_nachlass_artikel') })
        .toEqual({ wort, treffer: true })
    }
    for (const [wort, karte] of [['zahlart', 'ka_zahlart_betrieb'], ['storno', 'ka_storno_grund'],
                                  ['kellner', 'ka_kellner'], ['bon', 'ka_bon_betrieb'],
                                  ['betriebsstelle', 'ka_stellen'], ['zeitzone', 'ka_zeitzone_sparte'],
                                  ['geladen', 'ka_ladestand']] as const) {
      expect({ wort, gefunden: berichteSuchen(wort, 50).some(b => b.schluessel === karte) })
        .toEqual({ wort, gefunden: true })
    }
  })

  test('Die Kassenberichte lesen nur mart', () => {
    const kasse = alleKarten.filter(k => k.schluessel.startsWith('ka_') || k.schluessel === 'aa_nachlass')
    expect(kasse.length).toBeGreaterThanOrEqual(14)
    for (const k of kasse) {
      const z = zerlegen(uebersetzen(k, {}).sql)
      const fremd = [...z.sichten].filter(s => !s.startsWith('mart.'))
      expect({ karte: k.schluessel, fremd }).toEqual({ karte: k.schluessel, fremd: [] })
    }
  })

  test('Der Gluecksrad-Bericht nimmt Nachlass, Zeitraum und Marke als Parameter', () => {
    const { sql, parameter } = uebersetzen(karteFinden('ka_nachlass_betrieb')!,
      { finanzweg: 'Glücksrad', von: '2026-08-01', bis: '2026-08-31', marke: 'Wilma Wunder' })
    expect(parameter).toContain('Glücksrad')
    expect(parameter).toContain('Wilma Wunder')
    expect(sql).not.toContain('Glücksrad')
    expect(sql).toContain('mart.artikel_nachlass_tag')
  })

  test('Suche findet den Round Table ueber das Wort im Namen', () => {
    const treffer = berichteSuchen('round table')
    expect(treffer.length).toBeGreaterThan(0)
    expect(treffer[0]!.name.toLowerCase()).toContain('round table')
  })
})
