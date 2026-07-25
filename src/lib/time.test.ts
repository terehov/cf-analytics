/**
 * Kreuzprobe: die TS-Helfer müssen dieselben Ergebnisse liefern wie
 * core.geschaeftstag() / core.pruefe_lina_epoch() in der Datenbank.
 *
 * Läuft absichtlich auch mit falsch gesetzter Umgebungs-TZ durch — genau das
 * ist der Punkt der Umstellung auf explizite Umrechnung.
 */
import { expect, test, describe } from 'bun:test'
import {
  geschaeftstag, geschaeftstagFuerStunde, zuLinaDatum,
  epochIstBerlinerMitternacht, alsIsoDatum, GESCHAEFTS_ZEITZONE,
} from './time'

describe('Geschäftstag', () => {
  test('ist auf Europe/Berlin festgelegt', () => {
    expect(GESCHAEFTS_ZEITZONE).toBe('Europe/Berlin')
  })

  test('03:00 Berliner Sommerzeit gehört zum Vortag', () => {
    // SQL-Gegenstück: core.geschaeftstag('2026-06-02 01:00:00+00') = 2026-06-01
    expect(geschaeftstag(new Date('2026-06-02T01:00:00Z'))).toBe('2026-06-01')
  })

  test('03:00 Berliner Winterzeit ebenso — die Zeitumstellung ändert nichts', () => {
    expect(geschaeftstag(new Date('2026-01-15T02:00:00Z'))).toBe('2026-01-14')
  })

  test('die Tagesgrenze liegt bei 08:00, nicht bei Mitternacht', () => {
    expect(geschaeftstag(new Date('2026-06-01T05:59:00Z'))).toBe('2026-05-31') // 07:59 Berlin
    expect(geschaeftstag(new Date('2026-06-01T07:00:00Z'))).toBe('2026-06-01') // 09:00 Berlin
  })

  test('Stunden aus dem Zeitzonenbericht landen auf dem richtigen Tag', () => {
    expect(geschaeftstagFuerStunde('2026-06-02', 3)).toBe('2026-06-01')
    expect(geschaeftstagFuerStunde('2026-06-02', 7)).toBe('2026-06-01')
    expect(geschaeftstagFuerStunde('2026-06-02', 8)).toBe('2026-06-02')
    expect(geschaeftstagFuerStunde('2026-06-02', 14)).toBe('2026-06-02')
  })
})

describe('LINA-Datumsformate', () => {
  test('Konzern-Endpunkte wollen führende Nullen, Betriebs-Reports nicht', () => {
    expect(zuLinaDatum('2026-06-01')).toBe('01.06.2026')
    expect(zuLinaDatum('2026-06-01', 'short')).toBe('1.6.2026')
  })

  test('verträgt Date-Objekte — manche Treiber liefern date-Spalten so zurück', () => {
    const d = new Date('2026-06-01T00:00:00.000Z')
    expect(alsIsoDatum(d)).toBe('2026-06-01')
    expect(zuLinaDatum(d)).toBe('01.06.2026')
    expect(zuLinaDatum(d, 'short')).toBe('1.6.2026')
  })

  test('alsIsoDatum normalisiert auch Strings mit Zeitanteil', () => {
    expect(alsIsoDatum('2026-06-15')).toBe('2026-06-15')
    expect(alsIsoDatum('2026-06-15T00:00:00.000Z')).toBe('2026-06-15')
  })
})

describe('LINA-Epoch-Wächter', () => {
  test('erkennt die in Phase 1 verifizierte Berliner Mitternacht', () => {
    // getReport lieferte from=1780264800 für den 01.06.2026.
    expect(epochIstBerlinerMitternacht(1780264800, '2026-06-01')).toBe(true)
  })

  test('schlägt an, wenn der Tag nicht passt', () => {
    expect(epochIstBerlinerMitternacht(1780264800, '2026-06-02')).toBe(false)
  })
})

describe('Unabhängigkeit von der Umgebungszeitzone', () => {
  test('die Umrechnung hängt nicht an process.env.TZ', () => {
    const alt = process.env.TZ
    try {
      process.env.TZ = 'America/New_York'
      expect(geschaeftstag(new Date('2026-06-02T01:00:00Z'))).toBe('2026-06-01')
      process.env.TZ = 'Asia/Tokyo'
      expect(geschaeftstag(new Date('2026-06-02T01:00:00Z'))).toBe('2026-06-01')
    } finally {
      if (alt === undefined) delete process.env.TZ
      else process.env.TZ = alt
    }
  })
})
