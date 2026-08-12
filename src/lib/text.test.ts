/**
 * Die zwei Wege, auf denen ein NUL in eine Antwort kommt.
 *
 * Dieser Test existiert, weil der erste Anlauf am 12.08.2026 den falschen der
 * beiden behandelt hat und niemandem aufgefallen waere: im ganzen Repository
 * kam kein einziges NUL vor, also war jede Fassung „gruen". Gepruefte
 * Eigenschaft ist deshalb nicht „die Funktion tut etwas", sondern „nach ihr
 * kann PostgreSQL den Wert annehmen".
 */
import { describe, expect, test } from 'bun:test'
import { ohneNullzeichen, jsonOhneNullzeichen } from './text'

const NUL = String.fromCharCode(0)

/** So kommt es vom Server: sechs gewoehnliche ASCII-Zeichen, kein NUL im Text. */
const ALS_ESCAPE = '{"name":"Rechnung\\u0000.pdf","betrag":"12,50"}'

describe('ohneNullzeichen — das rohe Byte', () => {
  test('entfernt es und laesst alles andere in Ruhe', () => {
    expect(ohneNullzeichen(`a${NUL}b`, 'test')).toBe('ab')
    expect(ohneNullzeichen('äöü — ganz ohne', 'test')).toBe('äöü — ganz ohne')
  })

  test('ruehrt andere Steuerzeichen NICHT an', () => {
    // Zeilenumbruch und Tabulator sind in PostgreSQL zulaessig. Was hier mehr
    // wegputzt als noetig, verfaelscht Daten in einem append-only Layer.
    const roh = 'Zeile1\nZeile2\tSpalte'
    expect(ohneNullzeichen(roh, 'test')).toBe(roh)
  })

  test('ist blind fuer die Escape-Folge — genau das war der Fehler', () => {
    expect(ohneNullzeichen(ALS_ESCAPE, 'test')).toBe(ALS_ESCAPE)
  })
})

describe('jsonOhneNullzeichen — die Escape-Folge', () => {
  test('das NUL ist nach dem Lesen weg', () => {
    const d = jsonOhneNullzeichen(ALS_ESCAPE, 'test') as { name: string; betrag: string }
    expect(d.name).toBe('Rechnung.pdf')
    expect(d.name.includes(NUL)).toBe(false)
    expect(d.betrag).toBe('12,50')      // der Rest bleibt unangetastet
  })

  /**
   * Die eigentliche Zusicherung. `raw.api_antwort.payload` ist jsonb, und dorthin
   * geht das Ergebnis von JSON.stringify — steht darin noch ein `\u0000`, lehnt
   * PostgreSQL die ganze Transaktion ab und der Belegordner ist verloren.
   */
  test('was danach serialisiert wird, traegt kein \\u0000 mehr', () => {
    const d = jsonOhneNullzeichen(ALS_ESCAPE, 'test')
    expect(JSON.stringify(d)).not.toContain('\\u0000')
  })

  test('auch tief verschachtelt und in Feldern einer Liste', () => {
    const roh = JSON.stringify({
      data: [
        { id: 1, datei: `a${NUL}.pdf` },
        { id: 2, tief: { tiefer: [`x${NUL}`, 'sauber'] } },
      ],
    })
    const d = jsonOhneNullzeichen(roh, 'test') as any
    expect(JSON.stringify(d)).not.toContain('\\u0000')
    expect(d.data[0].datei).toBe('a.pdf')
    expect(d.data[1].tief.tiefer).toEqual(['x', 'sauber'])
  })

  test('ohne NUL kommt genau dasselbe heraus wie bei JSON.parse', () => {
    const roh = '{"a":[1,2,{"b":"c"}],"d":null,"e":true}'
    expect(jsonOhneNullzeichen(roh, 'test')).toEqual(JSON.parse(roh))
  })

  test('kaputtes JSON wirft weiterhin — der Aufrufer faengt das', () => {
    expect(() => jsonOhneNullzeichen('{kein json', 'test')).toThrow()
  })

  /**
   * Ein doppelt maskierter Backslash sieht der Erkennung zum Verwechseln
   * aehnlich, ist aber der Text `\u0000` und kein NUL. Er muss unveraendert
   * durchkommen — sonst verfaelscht die Reinigung Nutzdaten.
   */
  test('ein literaler Text "\\u0000" bleibt stehen', () => {
    const roh = '{"hinweis":"\\\\u0000 ist die Escape-Folge"}'
    const d = jsonOhneNullzeichen(roh, 'test') as { hinweis: string }
    expect(d.hinweis).toBe('\\u0000 ist die Escape-Folge')
    expect(d.hinweis.includes(NUL)).toBe(false)
  })
})

describe('die Kette, wie sie im Client laeuft', () => {
  /**
   * Der Ablauf aus src/lina/client.ts: erst der Rohtext, dann das Lesen. Beide
   * Wege muessen gemeinsam dichthalten, denn welcher der beiden greift, weiss
   * man vorher nicht.
   */
  test('Escape-Folge: ohneNullzeichen greift nicht, jsonOhneNullzeichen schon', () => {
    const nachRohtext = ohneNullzeichen(ALS_ESCAPE, 'test')
    const daten = jsonOhneNullzeichen(nachRohtext, 'test')
    expect(JSON.stringify(daten)).not.toContain('\\u0000')
  })

  test('rohes Byte: ohneNullzeichen rettet das Lesen, das sonst scheitert', () => {
    const mitRohemNul = `{"name":"Rechnung${NUL}.pdf"}`
    // Ohne Bereinigung ist die Antwort gar kein gueltiges JSON.
    expect(() => JSON.parse(mitRohemNul)).toThrow()
    const daten = jsonOhneNullzeichen(ohneNullzeichen(mitRohemNul, 'test'), 'test') as { name: string }
    expect(daten.name).toBe('Rechnung.pdf')
  })
})
