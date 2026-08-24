/**
 * Die zwei Wächter, die am 24.08.2026 in der Vorab-Prüfung gefehlt haben.
 *
 * Beide Fehler hatten dieselbe Signatur — die gefährlichste, die dieses
 * Projekt kennt: **der Lauf meldet „fertig" und hat Schaden angerichtet.**
 *
 *   1. Eine leere Standortliste ließ das Aufräumen ohne Gegenstück laufen
 *      und löschte damit SÄMTLICHE Mitarbeiter-Standort-Zuordnungen. Danach
 *      ist jede Betriebszahl leer, und im Log steht „bounti-nachlauf fertig".
 *   2. Eine doppelte Zeile aus dem Seitenlauf ließ den ganzen Sammel-INSERT
 *      scheitern (SQLSTATE 21000) — nicht die doppelte Zeile fällt aus,
 *      sondern alle.
 *
 * Neben jeder Zusicherung steht deshalb die Verletzung, die sie finden MUSS.
 */
import { expect, test, describe, afterAll } from 'bun:test'
import { bountiMockStarten } from './mock'
import { config } from '../config'
import { ohneDoppel, stammdatenLaden } from './laden'
import { bountiZaehlerZuruecksetzen } from './client'

describe('ohneDoppel', () => {
  test('behaelt den ERSTEN Treffer und wirft den zweiten weg', () => {
    const r = ohneDoppel([{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'a', n: 3 }], x => x.id)
    expect(r).toHaveLength(2)
    expect(r[0]!.n).toBe(1)
  })

  test('ohne Doppel bleibt die Reihenfolge unveraendert', () => {
    const ein = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(ohneDoppel(ein, x => x.id).map(x => x.id)).toEqual(['a', 'b', 'c'])
  })

  test('die leere Liste bleibt leer', () => {
    expect(ohneDoppel([], (x: { id: string }) => x.id)).toEqual([])
  })

  /**
   * Der Fall, der den Fehler ausloest: Bountis Cursor zeigt auf die ID des
   * ersten Elements der naechsten Seite. Verschiebt sich das Fenster
   * waehrend des Blaetterns, erscheint eine Zeile auf zwei Seiten.
   */
  test('das verschobene Seitenfenster liefert eine Zeile zweimal', () => {
    const seite1 = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]
    const seite2 = [{ id: 'm3' }, { id: 'm4' }]   // m3 erneut
    expect(ohneDoppel([...seite1, ...seite2], x => x.id).map(x => x.id))
      .toEqual(['m1', 'm2', 'm3', 'm4'])
  })
})

describe('Leere Standortliste', () => {
  /**
   * KEINE DATENBANK NOETIG, und das ist der Punkt: der Abbruch muss VOR dem
   * ersten Schreibzugriff stehen. Erreicht der Lauf die Datenbank, ist es
   * bereits zu spaet — das Aufraeumen haengt an derselben Anweisungsfolge.
   */
  const leer = bountiMockStarten({ standorte: 0, token: 'testtoken' })
  afterAll(() => leer.stoppen())

  test('bricht ab, statt die vorhandenen Zuordnungen zu loeschen', async () => {
    const [altUrl, altToken] = [config.BOUNTI_BASE_URL, config.BOUNTI_API_TOKEN]
    config.BOUNTI_BASE_URL = leer.url
    config.BOUNTI_API_TOKEN = 'testtoken'
    bountiZaehlerZuruecksetzen()
    try {
      await expect(stammdatenLaden()).rejects.toThrow(/keine Standorte/)
    } finally {
      config.BOUNTI_BASE_URL = altUrl
      config.BOUNTI_API_TOKEN = altToken
    }
  })
})
