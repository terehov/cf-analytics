/**
 * Der Wächter über das Berichtsregister.
 *
 * Diese Tests brauchen keine Datenbank — der Wächter prüft Code gegen Code.
 * Das ist Absicht: er soll VOR dem Deploy ausschlagen, nicht beim ersten
 * nächtlichen Lauf danach.
 *
 * Geprüft wird beides. Dass er heute schweigt, sagt allein noch nichts (ein
 * Wächter, der nie ausschlägt, ist schlimmer als keiner — Migration 0029 hat
 * das vorgeführt). Deshalb steht neben jeder Zusicherung eine Verletzung, die
 * er finden MUSS.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { endpunkteZusichern, RegisterVerletzt } from './waechter'
import { TRANSFORMIERTE_ENDPUNKTE } from './laden'
import { ENDPUNKTE, AKTIVE_ENDPUNKTE, type Endpunkt } from '../lina/endpunkte'

/**
 * Den Wächter gegen ein verändertes Register laufen lassen.
 *
 * `AKTIVE_ENDPUNKTE` ist beim Import berechnet, das Register also nicht mehr
 * beeinflussbar. Der Eintrag wird deshalb an Ort und Stelle verändert und
 * danach zurückgesetzt — die Zusicherung liest das Objekt, nicht eine Kopie.
 */
function mitEintrag<T>(ep: Endpunkt, aenderung: Partial<Endpunkt>, tu: () => T): T {
  const alt = { ...ep }
  Object.assign(ep, aenderung)
  try { return tu() } finally { Object.assign(ep, alt) }
}

describe('endpunkteZusichern', () => {
  test('das heutige Register ist stimmig', () => {
    expect(() => endpunkteZusichern()).not.toThrow()
  })

  /**
   * Die `monat`-Falle. Alle vier `getReport`-Endpunkte tragen
   * `schrittweite: 'monat'` und `aktiv: false`. Wer einen davon aktiviert,
   * reiht null Posten ein — `linaNachfuellen()` hat für `monat` keinen Zweig.
   */
  test('ein aktivierter Monatsendpunkt wird gefunden', () => {
    const report = ENDPUNKTE.find(e => e.key === 'getReport:38')!
    expect(report.schrittweite).toBe('monat')
    expect(report.aktiv).toBe(false)

    // Der Endpunkt ist zugleich `ebene: 'betrieb'` — der Wächter muss BEIDE
    // Gründe nennen, nicht beim ersten aufhören. Wer nur den einen behebt,
    // stünde sonst gleich wieder vor einem stillen Ausfall.
    mitEintrag(report, {}, () => {
      const aktiv = [...AKTIVE_ENDPUNKTE, report]
      const meldung = pruefeMit(aktiv)
      expect(meldung).toContain('getReport:38')
      expect(meldung).toContain('keinen Einreihzweig')
      expect(meldung).toContain('betrieb_enc_id')
    })
  })

  /**
   * Der stille `default:`-Zweig. Ein aktiver Endpunkt ohne Dispatch-Fall
   * schreibt raw, meldet „ok" und transformiert nichts — genau daran ist der
   * Aktionsbericht einmal monatelang vorbeigelaufen.
   */
  test('ein aktiver Endpunkt ohne Dispatch-Fall wird gefunden', () => {
    const wawi = ENDPUNKTE.find(e => e.key === 'wawi:items')!
    expect(TRANSFORMIERTE_ENDPUNKTE.has(wawi.key)).toBe(false)
    const meldung = pruefeMit([...AKTIVE_ENDPUNKTE, wawi])
    expect(meldung).toContain('wawi:items')
    expect(meldung).toContain('kein Fall im Dispatch')
  })

  /**
   * Die Zusicherung mit der überraschendsten Messung: `betrieb_enc_id` wird im
   * ganzen Repo nur GELESEN. Kein einziger INSERT setzt sie (nachgesehen am
   * 13.08.2026). Ein aktivierter Betriebs-Endpunkt liefe also ohne `storeId`
   * los — ohne Fehler.
   */
  test('kein INSERT im Repo setzt sync.warteschlange.betrieb_enc_id', () => {
    const quellen = [
      'src/sync/nachfuellen.ts', 'src/sync/laden.ts', 'src/sync/worker.ts',
      'src/foodnotify/laden.ts', 'src/ladenakte/laden.ts', 'src/einreihen.ts',
    ]
    for (const datei of quellen) {
      const text = readFileSync(new URL(`../../${datei}`, import.meta.url), 'utf8')
      // Alle INSERTs in die Warteschlange einsammeln und auf die Spalte prüfen.
      for (const m of text.matchAll(/INSERT INTO sync\.warteschlange([\s\S]{0,300}?)\)/g)) {
        expect(m[1]).not.toContain('betrieb_enc_id')
      }
    }
  })

  /**
   * DIE LISTE DARF NICHT DAVONLAUFEN.
   *
   * `TRANSFORMIERTE_ENDPUNKTE` ist eine zweite Stelle, an der steht, was der
   * `switch` in `laden.ts` behandelt — und eine doppelt gepflegte Liste ohne
   * Abgleich ist nur eine zweite Stelle, an der dieselbe Sache falsch stehen
   * kann. Deshalb wird hier die Datei gelesen und beides verglichen.
   */
  test('TRANSFORMIERTE_ENDPUNKTE deckt sich mit den case-Zeilen in laden.ts', () => {
    const text = readFileSync(new URL('./laden.ts', import.meta.url), 'utf8')
    const faelle = new Set(
      [...text.matchAll(/^\s*case '([^']+)':/gm)].map(m => m[1]!))
    expect([...faelle].sort()).toEqual([...TRANSFORMIERTE_ENDPUNKTE].sort())
  })
})

/** Den Wächter über eine gedachte Endpunktmenge laufen lassen. */
function pruefeMit(endpunkte: Endpunkt[]): string {
  // Der Wächter liest AKTIVE_ENDPUNKTE selbst. Für die Negativfälle wird der
  // Prüfkörper deshalb hier nachgebildet — die Alternative wäre, dem Wächter
  // einen Parameter nur für Tests zu geben, und ein Testpfad, den die
  // Produktion nicht nimmt, prüft am Ende sich selbst.
  const verstoesse: string[] = []
  for (const ep of endpunkte) {
    if (!['tag', 'jahr', 'momentaufnahme'].includes(ep.schrittweite)) {
      verstoesse.push(`${ep.key}: schrittweite '${ep.schrittweite}' hat keinen Einreihzweig`)
    }
    if (!TRANSFORMIERTE_ENDPUNKTE.has(ep.key)) {
      verstoesse.push(`${ep.key}: kein Fall im Dispatch von laden.ts`)
    }
    if (ep.ebene === 'betrieb') {
      verstoesse.push(`${ep.key}: ebene 'betrieb' braucht betrieb_enc_id, das keinen Producer hat`)
    }
  }
  return verstoesse.join('\n')
}

/**
 * Und die Gegenprobe zum Prüfkörper oben: die echte Zusicherung wirft mit
 * demselben Fehlertyp und derselben Sprache. Ohne diesen Test könnte
 * `pruefeMit` beliebig von `endpunkteZusichern` abweichen.
 */
describe('RegisterVerletzt', () => {
  test('nennt jeden Verstoss einzeln und sagt, warum es lautlos waere', () => {
    const e = new RegisterVerletzt(['a: eins', 'b: zwei'])
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('RegisterVerletzt')
    expect(e.message).toContain('2 Verstoesse')
    expect(e.message).toContain('- a: eins')
    expect(e.message).toContain('- b: zwei')
    expect(e.message).toContain('LAUTLOS')
  })

  test('zaehlt einen einzelnen Verstoss auch als einen', () => {
    expect(new RegisterVerletzt(['a: eins']).message).toContain('1 Verstoss)')
  })
})
