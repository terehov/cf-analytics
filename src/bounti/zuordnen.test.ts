/**
 * Der Namensabgleich Bounti-Standort → Betrieb.
 *
 * WARUM DAS EINE EIGENE TESTDATEI WERT IST: eine falsche Zuordnung ist der
 * teuerste Fehler dieser Anbindung und zugleich der leiseste. Sie trägt die
 * Schulungs-, Personal- und Auditzahlen eines Standorts in einen FREMDEN
 * Betrieb — die Zahlen sind vollständig, plausibel und stehen am falschen
 * Haus. Nichts daran sieht nach Fehler aus.
 *
 * Deshalb steht neben jeder Zusicherung, dass er trifft, eine, dass er
 * NICHT rät.
 */
import { expect, test, describe } from 'bun:test'
import { zuordnungRechnen, VON_HAND, type Betrieb } from './zuordnen'

/**
 * Die Tests rechnen OHNE die Handliste.
 *
 * Sie stand hier zuerst implizit drin — und ist damit rot geworden, als am
 * 24.08.2026 die ersten elf Entscheidungen eingetragen wurden: die Tests
 * prüften Gesamtzahlen („ein Standort, einer offen"), und jede neue
 * `null`-Zeile in `VON_HAND` erhöht die Zahl der offenen. Ein Test, der aus
 * einem fremden Grund ausschlägt, wird abgeschaltet — deshalb bekommt
 * `zuordnungRechnen()` die Liste seit heute als Parameter.
 */
const OHNE_HAND: Record<string, number | null> = {}

const betriebe: Betrieb[] = [
  { betrieb_key: 1,   name: 'Enchilada Leipzig GmbH' },
  { betrieb_key: 2,   name: 'Aposto Mainz GmbH' },
  { betrieb_key: 3,   name: 'Aposto Mainz Ballplatz GmbH' },
  { betrieb_key: 4,   name: 'Park Cafe München GmbH' },
  { betrieb_key: 5,   name: 'COYACAN GmbH' },
]

describe('Namensabgleich', () => {
  test('die Rechtsform in LINA verhindert den Treffer nicht', () => {
    // Der Regelfall: LINA fuehrt "GmbH" mit, die Fachsysteme nicht.
    const r = zuordnungRechnen([{ id: 'l1', name: 'Enchilada Leipzig' }], betriebe, new Set(), new Map(), OHNE_HAND)
    expect(r.treffer).toHaveLength(1)
    expect(r.treffer[0]!.betriebKey).toBe(1)
  })

  test('Akzente werden gefaltet, nicht geloescht', () => {
    // Ohne Faltung wird aus "Park Café" die Form "parkcaf" -- das 'e' fehlt,
    // und der Betrieb wird nie getroffen. Am 03.08.2026 bei Yext passiert.
    const r = zuordnungRechnen([{ id: 'l4', name: 'Park Café München' }], betriebe, new Set(), new Map(), OHNE_HAND)
    expect(r.treffer[0]?.betriebKey).toBe(4)
  })

  test('zwei passende Betriebe heissen OFFEN, nicht "der erste"', () => {
    // "Aposto Mainz" passt auf zwei Haeuser. Welches gemeint ist, weiss der
    // Name nicht -- und ein geratener Treffer waere unsichtbar falsch.
    const r = zuordnungRechnen([{ id: 'l2', name: 'Aposto Mainz' }], betriebe, new Set(), new Map(), OHNE_HAND)
    expect(r.treffer).toHaveLength(0)
    expect(r.mehrdeutig).toHaveLength(1)
    expect(r.mehrdeutig[0]!.kandidaten).toHaveLength(2)
    expect(r.offene_namen.map(o => o.id)).toContain('l2')
  })

  test('ein Name ohne Entsprechung bleibt offen', () => {
    const r = zuordnungRechnen([{ id: 'lx', name: 'Schulungsraum Zentrale' }], betriebe, new Set(), new Map(), OHNE_HAND)
    expect(r.treffer).toHaveLength(0)
    expect(r.offen).toBe(1)
  })

  test('ein bereits belegter Betrieb wird nicht ein zweites Mal vergeben', () => {
    // manual.betrieb_fremd_id schluesselt auf (betrieb_key, system): ein
    // zweiter Treffer wuerde den ersten still ueberschreiben.
    const r = zuordnungRechnen([{ id: 'l1', name: 'Enchilada Leipzig' }], betriebe, new Set([1]), new Map(), OHNE_HAND)
    expect(r.treffer).toHaveLength(0)
    expect(r.offen).toBe(1)
  })

  test('zwei Standorte greifen nicht denselben Betrieb', () => {
    const r = zuordnungRechnen([
      { id: 'a', name: 'Enchilada Leipzig' },
      { id: 'b', name: 'Enchilada Leipzig' },
    ], betriebe, new Set(), new Map(), OHNE_HAND)
    expect(r.treffer).toHaveLength(1)
    expect(r.offen).toBe(1)
  })

  test('ein leerer Name traegt nichts und trifft nichts', () => {
    const r = zuordnungRechnen([{ id: 'l0', name: '   ' }], betriebe, new Set(), new Map(), OHNE_HAND)
    expect(r.treffer).toHaveLength(0)
    expect(r.offen).toBe(1)
  })

  test('die Zaehlung stimmt mit den Listen ueberein', () => {
    const r = zuordnungRechnen([
      { id: 'l1', name: 'Enchilada Leipzig' },
      { id: 'l2', name: 'Aposto Mainz' },
      { id: 'lx', name: 'Schulungsraum' },
    ], betriebe, new Set(), new Map(), OHNE_HAND)
    expect(r.standorte).toBe(3)
    expect(r.zugeordnet).toBe(r.treffer.length)
    expect(r.offen).toBe(r.offene_namen.length)
    expect(r.zugeordnet + r.offen).toBe(3)
  })
})

describe('Die Handliste', () => {
  test('eine Entscheidung von Hand schlaegt den Namensabgleich', () => {
    // "Enchilada Leipzig" traefe ueber den Namen [1]. Die Handliste sagt [5],
    // und die gewinnt -- sonst waere jede Korrektur eines Fehltreffers
    // wirkungslos.
    const r = zuordnungRechnen(
      [{ id: 'l1', name: 'Enchilada Leipzig' }], betriebe, new Set(), new Map(), { l1: 5 })
    expect(r.treffer).toHaveLength(1)
    expect(r.treffer[0]!.betriebKey).toBe(5)
    expect(r.treffer[0]!.art).toBe('von Hand')
  })

  test('null heisst AUSDRUECKLICH OFFEN, nicht "nicht eingetragen"', () => {
    // Der Unterschied traegt die ganze Liste: ohne den Eintrag wuerde der
    // Automat den Standort dem naechstbesten Namen zuweisen.
    const r = zuordnungRechnen(
      [{ id: 'l1', name: 'Enchilada Leipzig' }], betriebe, new Set(), new Map(), { l1: null })
    expect(r.treffer).toHaveLength(0)
    expect(r.offen).toBe(1)
    expect(r.offene_namen[0]!.id).toBe('l1')
  })

  test('die echte Handliste zeigt auf keinen Standort zweimal', () => {
    // Zwei Standorte auf denselben Betrieb waeren ein stiller Ueberschreiber:
    // manual.betrieb_fremd_id schluesselt auf (betrieb_key, system).
    const keys = Object.values(VON_HAND).filter((v): v is number => v !== null)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('Zweiter Lauf', () => {
  /**
   * DER FEHLER, DEN DAS NACHFAHREN GEFUNDEN HAT (24.08.2026): erster Lauf
   * 62 zugeordnet, zweiter Lauf 7. Der Schutz gegen Doppelvergabe hielt beim
   * zweiten Mal den EIGENEN Eintrag des Standorts für fremdbelegt.
   *
   * Der Schaden wäre keine falsche Zuordnung, sondern eine falsche Meldung —
   * „offen: 81", wo nichts offen ist. Eine Zahl, die grundlos Alarm schlägt,
   * wird abgeschaltet und nimmt die echten Fälle mit.
   */
  test('eine bereits geschriebene Zuordnung bleibt ein Treffer', () => {
    const standorte = [{ id: 'l1', name: 'Enchilada Leipzig' }]
    const bestehend = new Map([['l1', 1]])
    const belegt = new Set([1])          // derselbe Betrieb, aus derselben Zeile
    const r = zuordnungRechnen(standorte, betriebe, belegt, bestehend, OHNE_HAND)
    expect(r.zugeordnet).toBe(1)
    expect(r.offen).toBe(0)
    expect(r.treffer[0]!.art).toBe('bereits zugeordnet')
  })

  test('ohne die bestehende Zuordnung faellt derselbe Standort auf offen', () => {
    // Die Verletzung, die der Waechter finden MUSS -- das ist der Zustand
    // von vor der Korrektur.
    const r = zuordnungRechnen(
      [{ id: 'l1', name: 'Enchilada Leipzig' }], betriebe, new Set([1]), new Map(), OHNE_HAND)
    expect(r.zugeordnet).toBe(0)
    expect(r.offen).toBe(1)
  })

  test('eine bestehende Zuordnung auf einen unbekannten Betrieb wird nicht erfunden', () => {
    // betrieb_key 999 gibt es nicht (geloescht, inaktiv). Dann ist der
    // Standort offen und nicht still falsch zugeordnet.
    const r = zuordnungRechnen(
      [{ id: 'lx', name: 'Irgendwas' }], betriebe, new Set(), new Map([['lx', 999]]), OHNE_HAND)
    expect(r.zugeordnet).toBe(0)
    expect(r.offen).toBe(1)
  })
})
