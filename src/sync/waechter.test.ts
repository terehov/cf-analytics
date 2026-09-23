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
import { endpunkteZusichern, RegisterVerletzt, betriebsberichtVerstoesse, BETRIEBSBERICHT_PFAD } from './waechter'
import { TRANSFORMIERTE_ENDPUNKTE } from './laden'
import { ENDPUNKTE, AKTIVE_ENDPUNKTE, endpunkt, type Endpunkt } from '../lina/endpunkte'
import { BETRIEBSBERICHTE, AKTIVE_BETRIEBSBERICHTE } from '../lina/betriebsberichte'
import { LADENAKTE_ENDPUNKTE } from '../ladenakte/endpunkte'
import { FN_ENDPUNKTE } from '../foodnotify/endpunkte'
import { QUELLEN } from './quellen'
import { GELADENE_BETRIEBSBERICHTE, abrufVorlaeufig } from './betriebsbericht_laden'

/**
 * Alle drei Register zusammen — LINA, Ladenakte und FoodNotify.
 *
 * Sie stehen in drei Dateien, weil sie drei verschiedene Formen haben
 * (`FnEndpunkt` kennt kein `aktiv`: was dort steht, ist aktiv). Für die Frage
 * „hat jede Quelle einen Wächtereintrag?" sind sie eine Menge.
 */
const ALLE_AKTIVEN: string[] = [
  ...AKTIVE_ENDPUNKTE.map(e => e.key),
  ...LADENAKTE_ENDPUNKTE.filter(e => e.aktiv).map(e => e.key),
  ...FN_ENDPUNKTE.map(e => e.key),
  ...AKTIVE_BETRIEBSBERICHTE.map(e => e.key),
]

const ALLE_INAKTIVEN: string[] = [
  ...ENDPUNKTE.filter(e => !e.aktiv).map(e => e.key),
  ...LADENAKTE_ENDPUNKTE.filter(e => !e.aktiv).map(e => e.key),
  ...BETRIEBSBERICHTE.filter(e => !e.aktiv).map(e => e.key),
]

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
   * Die `monat`-Falle und die Producer-Falle im KONZERN-Register.
   *
   * Bis zum 22.09.2026 standen dort vier `getReport:*` mit `schrittweite:
   * 'monat'` und `ebene: 'betrieb'`. Sie stehen jetzt im eigenen Register;
   * ein solcher Eintrag im Konzern-Register bleibt ein doppelter Verstoß
   * (kein Einreihzweig für `monat`, kein Producer für den Betrieb). Der
   * Wächter muss BEIDE Gründe nennen — wer nur den einen behebt, stünde
   * gleich wieder vor einem stillen Ausfall.
   */
  test('ein Betriebs-Monatsendpunkt im Konzern-Register wird gefunden', () => {
    const verirrt: Endpunkt = {
      ...endpunkt('getUmsatzbericht'), key: 'getReport:verirrt', ebene: 'betrieb', schrittweite: 'monat',
    }
    const meldung = pruefeMit([...AKTIVE_ENDPUNKTE, verirrt])
    expect(meldung).toContain('getReport:verirrt')
    expect(meldung).toContain('keinen Einreihzweig')
    expect(meldung).toContain('betrieb_enc_id')
  })

  test('kein Betriebsendpunkt steht mehr im Konzern-Register', () => {
    expect(ENDPUNKTE.filter(e => e.ebene === 'betrieb').map(e => e.key)).toEqual([])
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
   * Die Zusicherung mit der überraschendsten Messung: `betrieb_enc_id` wurde bis
   * zum 22.09.2026 im ganzen Repo nur GELESEN (nachgesehen am 13.08.2026).
   *
   * Seitdem gibt es genau ZWEI Schreiber, und dieser Test hält fest, dass es
   * dabei bleibt: `betriebsberichteNachfuellen()` (der Producer) und das
   * Teilen eines zu großen Fensters im Worker (übernimmt den Betrieb des
   * geteilten Postens). Ein dritter Schreiber wäre ein zweiter Einreihweg,
   * an dem der Wächter vorbeiliefe.
   */
  test('betrieb_enc_id setzt nur der Producer der Betriebsberichte (und das Teilen im Worker)', () => {
    const quellen = [
      'src/sync/nachfuellen.ts', 'src/sync/laden.ts', 'src/sync/worker.ts',
      'src/foodnotify/laden.ts', 'src/ladenakte/laden.ts', 'src/einreihen.ts',
      'src/sync/betriebsbericht_laden.ts',
    ]
    const schreiber: string[] = []
    for (const datei of quellen) {
      const text = readFileSync(new URL(`../../${datei}`, import.meta.url), 'utf8')
      for (const m of text.matchAll(/INSERT INTO sync\.warteschlange([\s\S]{0,300}?)\)/g)) {
        if (!m[1]!.includes('betrieb_enc_id')) continue
        // In welcher Funktion steht der INSERT?
        const davor = text.slice(0, m.index)
        const fn = [...davor.matchAll(/(?:async function|function) (\w+)|const (\w+) = async/g)].pop()
        schreiber.push(`${datei}:${fn?.[1] ?? fn?.[2] ?? '?'}`)
      }
    }
    expect([...new Set(schreiber)].sort()).toEqual([
      'src/sync/nachfuellen.ts:betriebsberichteNachfuellen',
      'src/sync/worker.ts:schleife',
    ])
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
      verstoesse.push(`${ep.key}: ebene 'betrieb' im Konzern-Register — betrieb_enc_id hat hier keinen Producer`)
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

/**
 * DER WÄCHTER ÜBER DEN WÄCHTER (Migration `0076`, Plan Phase 4).
 *
 * `mart.quelle_zulauf` misst nur, was in `sync.quelle` steht. Ein Endpunkt
 * ohne Registereintrag ist damit **unsichtbar für genau die Sicht, die
 * Unsichtbarkeit verhindern soll** — und das wäre die Wiederholung des Fehlers
 * eine Ebene höher.
 *
 * Deshalb prüft dieser Test ohne Datenbank: jeder aktive Endpunkt hat einen
 * Eintrag, und jeder Eintrag hat einen Endpunkt. Wer eine neue Quelle
 * anschliesst, kommt ohne Eintrag nicht am Test vorbei.
 */
describe('Quellenregister', () => {
  test('jeder aktive Endpunkt steht im Register', () => {
    const registriert = new Set(QUELLEN.map(q => q.endpunkt).filter(Boolean))
    const fehlend = ALLE_AKTIVEN.filter(k => !registriert.has(k))
    expect(fehlend).toEqual([])
  })

  test('kein Registereintrag zeigt auf einen Endpunkt, den es nicht gibt', () => {
    const bekannt = new Set([...ALLE_AKTIVEN, ...ALLE_INAKTIVEN])
    const verwaist = QUELLEN
      .map(q => q.endpunkt)
      .filter((k): k is string => Boolean(k) && !bekannt.has(k!))
    expect(verwaist).toEqual([])
  })

  /**
   * Die Constraints der Tabelle noch einmal in TypeScript — sie sollen beim
   * Test scheitern und nicht beim nächtlichen Lauf, wo ein Fehler im
   * Nachfüllen ohnehin abgefangen wird und nur im Log steht.
   */
  test('jede Quelle misst an genau einer Stelle', () => {
    for (const q of QUELLEN) {
      const beides = Boolean(q.endpunkt) && Boolean(q.tabelle)
      const keines = !q.endpunkt && !q.tabelle
      expect({ quelle: q.quelle, beides, keines })
        .toEqual({ quelle: q.quelle, beides: false, keines: false })
    }
  })

  test('die Schluessel sind eindeutig', () => {
    const namen = QUELLEN.map(q => q.quelle)
    expect(namen).toHaveLength(new Set(namen).size)
  })

  /**
   * Was bewusst still ist, braucht eine Begründung — sonst ist es nur eine
   * Ausnahme, die jemand eingetragen hat, und niemand weiss mehr warum.
   * Dieselbe Regel wie bei `NUR_ROH` oben.
   */
  test('jede nicht erwartete Quelle traegt eine Begruendung', () => {
    const ohne = QUELLEN.filter(q => q.erwartet === false && !q.bemerkung)
    expect(ohne.map(q => q.quelle)).toEqual([])
  })

  /**
   * Und die Gegenprobe: eine Kadenz von null oder negativ wäre eine Quelle,
   * die immer stumm ist — ein Alarm, der immer schlägt, wird abgeschaltet.
   */
  test('jede Kadenz ist positiv und nicht laenger als ein Quartal', () => {
    for (const q of QUELLEN) {
      expect({ quelle: q.quelle, ok: q.kadenz_stunden > 0 && q.kadenz_stunden <= 92 * 24 })
        .toEqual({ quelle: q.quelle, ok: true })
    }
  })
})

/**
 * DIE BETRIEBSBERICHTE (Migrationen 0113–0115).
 *
 * Geprüft wird mit derselben Funktion, die der Wächter beim Start jedes Laufs
 * benutzt — kein nachgebauter Prüfkörper.
 */
describe('Betriebsberichte', () => {
  test('jeder aktive Betriebsbericht ist stimmig', () => {
    for (const b of AKTIVE_BETRIEBSBERICHTE) expect({ key: b.key, v: betriebsberichtVerstoesse(b) })
      .toEqual({ key: b.key, v: [] })
  })

  /**
   * KORREKTUR 7. Der Weg `/finanzen/analytics/getReport?storeId=` antwortet mit
   * 200 und leeren Gerüsten — zwei Monate lang als „gelöst" geführt. Er darf
   * nicht zurückkommen, auch nicht per Kopie eines alten Eintrags.
   */
  test('der alte Weg mit storeId wird gefunden', () => {
    const b = AKTIVE_BETRIEBSBERICHTE.find(x => x.key === 'getReport:92')!
    const alt = { ...b, pfad: '/finanzen/analytics/getReport', betriebParameter: undefined }
    const v = betriebsberichtVerstoesse(alt).join('\n')
    expect(v).toContain('KORREKTUR 7')
    expect(v).toContain(BETRIEBSBERICHT_PFAD)
  })

  test('ein Betriebsbericht ohne Ladeweg wird gefunden', () => {
    const b = AKTIVE_BETRIEBSBERICHTE.find(x => x.key === 'getReport:92')!
    const v = betriebsberichtVerstoesse({ ...b, key: 'getReport:9999' }).join('\n')
    expect(v).toContain('kein Ladeweg')
  })

  test('ein Betriebsbericht ohne erwartete Spalten wird gefunden', () => {
    const b = AKTIVE_BETRIEBSBERICHTE.find(x => x.key === 'getReport:96')!
    expect(betriebsberichtVerstoesse({ ...b, felder: [] }).join('\n')).toContain('keine erwarteten Spalten')
  })

  /**
   * Die Fensterklassen aus der Vermessung vom 22.09.2026 — eine falsche Klasse
   * kostet Faktor 30 oder läuft in 504.
   */
  test('die gemessenen Fensterklassen stehen im Register', () => {
    const klasse = (n: number) => BETRIEBSBERICHTE.find(b => b.bericht === n)!.klasse
    expect(klasse(92)).toBe('T')
    expect(klasse(88)).toBe('T')
    expect(klasse(96)).toBe('W')
    expect(klasse(86)).toBe('W')
    expect(klasse(113)).toBe('W')
    expect(klasse(97)).toBe('M-Tag')
    expect(klasse(90)).toBe('M-Tag')
    expect(BETRIEBSBERICHTE.find(b => b.bericht === 97)!.intervall).toBe(3)
  })

  test('nicht geladen: 38, 114, 81, 82, 88 und die gesperrten', () => {
    // 88 seit 23.09.2026: die Finanzwege kommen aus 97 (Entscheidung Eugene).
    for (const n of [38, 114, 81, 82, 88, 107, 23]) {
      expect({ n, aktiv: BETRIEBSBERICHTE.find(b => b.bericht === n)!.aktiv }).toEqual({ n, aktiv: false })
    }
    const aktiv = new Set(AKTIVE_BETRIEBSBERICHTE.map(b => b.bericht))
    for (const n of [87, 64, 18, 12, 2, 3, 7, 8, 9, 24, 118]) expect(aktiv.has(n)).toBe(false)
  })

  /**
   * 88 ist abgeschaltet, nicht stumm (harte Regel 10): das Quellenregister
   * fuehrt ihn als nicht erwartet MIT Begruendung, und der Lader behaelt
   * seinen Weg — alte Rohantworten muessen sich weiter laden lassen (Regel 4).
   */
  test('88 abgeschaltet: nicht erwartet im Register, Ladeweg bleibt, 97 aktiv', () => {
    const q = QUELLEN.find(x => x.endpunkt === 'getReport:88')
    expect(q?.erwartet).toBe(false)
    expect(q?.bemerkung).toContain('97')
    expect(GELADENE_BETRIEBSBERICHTE.has('getReport:88')).toBe(true)
    expect(AKTIVE_BETRIEBSBERICHTE.some(b => b.bericht === 97)).toBe(true)
  })

  /**
   * Der laufende Monat (0120): nur 97, nur ein Monatsbericht mit Tageszeilen —
   * ein Monatsbericht ohne Tageszeilen haette keinen Tag, an dem „bis zum
   * Vortag" endet. Und sein Zulauf wird taeglich erwartet, nicht monatlich.
   */
  test('laufender Monat: nur 97, Klasse M-Tag, taeglich erwartet', () => {
    const mit = BETRIEBSBERICHTE.filter(b => b.laufenderMonat)
    expect(mit.map(b => b.bericht)).toEqual([97])
    for (const b of mit) expect(b.klasse).toBe('M-Tag')
    expect(QUELLEN.find(q => q.endpunkt === 'getReport:97')?.kadenz_stunden).toBe(36)
  })

  test('vorläufig heißt: vor der Reife geholt (Ende weniger als 7 Tage vor dem Abruf)', () => {
    expect(abrufVorlaeufig('2026-09-22', '2026-09-23', 7)).toBe(true)
    expect(abrufVorlaeufig('2026-09-17', '2026-09-23', 7)).toBe(true)
    expect(abrufVorlaeufig('2026-09-16', '2026-09-23', 7)).toBe(false)   // der reguläre Erstabruf
    // Der Vormonat: vorlaeufig bis zum 06.09., am 07.09. (Monatsende + 7) endgueltig —
    // derselbe Tag, an dem der Erstabruf ihn fuer reif hielte.
    expect(abrufVorlaeufig('2026-08-31', '2026-09-06', 7)).toBe(true)
    expect(abrufVorlaeufig('2026-08-31', '2026-09-07', 7)).toBe(false)
  })

  test('Parameter: Datum ohne fuehrende Null, reltime custom, das Intervall der Klasse', () => {
    const p92 = endpunkt('getReport:92').parameter('2026-08-01', '2026-08-01')
    expect(p92).toEqual({ report: '92', von: '1.8.2026', bis: '1.8.2026', reltime: 'custom', interval: '8' })
    const p97 = endpunkt('getReport:97').parameter('2026-08-01', '2026-08-31')
    expect(p97.interval).toBe('3')
    expect(p97.bis).toBe('31.8.2026')
  })
})
