/**
 * Die Spannen des Kalender-Nachzugs.
 *
 * WARUM DIESE DATEI EXISTIERT. Vom 14. bis zum 20.08.2026 hat der Nachzug
 * jede Nacht zwanzig Aufrufe gemacht und keine einzige Zeile geschrieben. Er
 * baute aus `KALENDER_VORLAUF_JAHRE=3` eine Anfrage über 1460 Tage; die
 * Schnittstelle beantwortet höchstens 1095 und weist den Rest mit HTTP 400 ab.
 * Gemerkt hat es niemand: der Bestand reichte noch bis Ende 2027, und
 * `mart.pflege_stand` sagt bis 180 Tage vor Schluss `ok`.
 *
 * Ein Test, der „läuft durch" prüft, hätte das nicht gefunden — der Lauf lief
 * ja durch. Geprüft wird deshalb die eine Eigenschaft, an der es lag: **keine
 * Anfrage darf die Grenze der Schnittstelle überschreiten**, bei keinem
 * erlaubten Vorlauf und an keinem Stichtag.
 */
import { beforeAll, describe, expect, test } from 'bun:test'

let k: typeof import('./kalender')

beforeAll(async () => {
  // config wird beim Import geprüft und braucht einen Wert — benutzt wird er
  // hier nicht, keine dieser Prüfungen fasst die Datenbank an.
  process.env.DATABASE_URL ??= 'postgres://ungenutzt/ungenutzt'
  process.env.LOG_LEVEL ??= 'error'
  k = await import('./kalender')
})

const tage = (von: string, bis: string) =>
  (Date.parse(bis) - Date.parse(von)) / 86_400_000

describe('spannen', () => {
  const heute = new Date('2026-08-20T12:00:00Z')

  test('vom laufenden Jahr bis zum Vorlauf, ganze Jahre', () => {
    expect(k.spannen(3, heute)).toEqual([
      { jahr: 2026, von: '2026-01-01', bis: '2026-12-31' },
      { jahr: 2027, von: '2027-01-01', bis: '2027-12-31' },
      { jahr: 2028, von: '2028-01-01', bis: '2028-12-31' },
      { jahr: 2029, von: '2029-01-01', bis: '2029-12-31' },
    ])
  })

  /**
   * Das laufende Jahr beginnt am 1. Januar und nicht heute. Sonst fielen im
   * August die Sommerferien aus dem Abruf — sie haben im Juli begonnen, und
   * `validFrom` schneidet nach Beginn ab, nicht nach Ende.
   */
  test('das laufende Jahr beginnt am 1. Januar, nicht heute', () => {
    expect(k.spannen(1, heute)[0]!.von).toBe('2026-01-01')
  })

  /** DER TEST, DER DEN FEHLER GEFUNDEN HÄTTE. */
  test('keine Spanne überschreitet die Grenze der Schnittstelle', () => {
    for (const vorlauf of [1, 2, 3, 5, 10]) {
      for (const s of k.spannen(vorlauf, heute)) {
        // Vorlauf und Jahr stehen mit in der Erwartung, damit ein Fehlschlag
        // sagt, WELCHE Anfrage zu weit greift.
        expect({ vorlauf, jahr: s.jahr, zuWeit: tage(s.von, s.bis) > k.MAX_SPANNE_TAGE })
          .toEqual({ vorlauf, jahr: s.jahr, zuWeit: false })
      }
    }
  })

  test('auch ein Schaltjahr bleibt unter der Grenze', () => {
    const [s] = k.spannen(0, new Date('2028-03-01T00:00:00Z'))
    expect(s).toEqual({ jahr: 2028, von: '2028-01-01', bis: '2028-12-31' })
    expect(tage(s!.von, s!.bis)).toBe(365)
  })

  test('die Reihe ist lückenlos — kein Jahr fällt zwischen zwei Anfragen', () => {
    const s = k.spannen(4, heute)
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.jahr).toBe(s[i - 1]!.jahr + 1)
      expect(tage(s[i - 1]!.bis, s[i]!.von)).toBe(1)
    }
  })

  test('Vorlauf 0 ist eine Spanne, nicht keine', () => {
    expect(k.spannen(0, heute)).toHaveLength(1)
  })

  test('der Jahreswechsel wird nach UTC gezogen', () => {
    // 31.12. 23:00 UTC ist in Berlin schon der 1.1. — maßgeblich ist UTC,
    // wie überall sonst im Importer auch.
    expect(k.spannen(0, new Date('2026-12-31T23:00:00Z'))[0]!.jahr).toBe(2026)
    expect(k.spannen(0, new Date('2027-01-01T00:00:00Z'))[0]!.jahr).toBe(2027)
  })
})

describe('abrufUrl', () => {
  test('trägt Land, Sprache und die Spanne', () => {
    const u = k.abrufUrl('PublicHolidays', 'BW', '2026-01-01', '2026-12-31')
    expect(u).toBe('https://openholidaysapi.org/PublicHolidays'
      + '?countryIsoCode=DE&languageIsoCode=DE'
      + '&validFrom=2026-01-01&validTo=2026-12-31&subdivisionCode=DE-BW')
  })

  test('das Kürzel bekommt das DE- davor, die Tabelle führt es ohne', () => {
    expect(k.abrufUrl('SchoolHolidays', 'NW', '2027-01-01', '2027-12-31'))
      .toContain('subdivisionCode=DE-NW')
  })
})

describe('einmalig', () => {
  /**
   * DER FALL, DEN DIE JAHRESSCHEIBEN ERST GESCHAFFEN HABEN. Die Schnittstelle
   * gibt jeden Zeitraum ungekürzt zurück, der die Spanne berührt — die
   * Weihnachtsferien kommen deshalb aus zwei Scheiben. Postgres bricht bei
   * zwei gleichen Schlüsseln in EINER Anweisung ab, und zwar die ganze:
   * „ON CONFLICT DO UPDATE command cannot affect row a second time". Am
   * 20.08.2026 hat genau das alle zehn Länder um ihre Ferien gebracht.
   */
  test('derselbe Zeitraum aus zwei Scheiben bleibt eine Zeile', () => {
    const roh = [
      { v: '2027-12-23', b: '2028-01-08', n: 'Weihnachtsferien' },  // Scheibe 2027
      { v: '2028-04-18', b: '2028-04-29', n: 'Osterferien' },
      { v: '2027-12-23', b: '2028-01-08', n: 'Weihnachtsferien' },  // Scheibe 2028
    ]
    expect(k.einmalig(roh, z => `${z.v}|${z.n}`)).toEqual([
      { v: '2027-12-23', b: '2028-01-08', n: 'Weihnachtsferien' },
      { v: '2028-04-18', b: '2028-04-29', n: 'Osterferien' },
    ])
  })

  test('gleicher Beginn, anderer Name — zwei Zeilen, wie im Schluessel', () => {
    // manual.schulferien hat (kuerzel, von, name) als Schluessel: ein
    // beweglicher Ferientag darf auf einem Ferienbeginn liegen.
    const roh = [
      { v: '2027-05-18', b: '2027-05-28', n: 'Pfingstferien' },
      { v: '2027-05-18', b: '2027-05-18', n: 'Schulfreier Tag' },
    ]
    expect(k.einmalig(roh, z => `${z.v}|${z.n}`)).toHaveLength(2)
  })

  test('die erste Zeile gewinnt — deshalb wird vorher sortiert', () => {
    const roh = [{ v: '2027-12-23', b: '2028-01-08' }, { v: '2027-12-23', b: '2027-12-31' }]
    expect(k.einmalig(roh, z => z.v)[0]!.b).toBe('2028-01-08')
  })

  test('eine leere Liste bleibt leer', () => {
    expect(k.einmalig([], (z: unknown) => String(z))).toEqual([])
  })
})

/**
 * DIE GEGENPROBE GEGEN DIE ECHTE SCHNITTSTELLE — nur mit `TEST_NETZ=1`.
 *
 * Die Grenze von 1095 Tagen ist eine Aussage über einen fremden Dienst; sie
 * kann sich ändern, ohne dass hier jemand etwas tut. Der Test belegt beide
 * Seiten: dass eine Jahresspanne durchgeht und dass die alte Fassung
 * tatsächlich abgewiesen worden wäre. Er hängt am Netz und läuft deshalb
 * nicht im Normalfall mit.
 */
const netz = process.env.TEST_NETZ ? describe : describe.skip

netz('gegen openholidaysapi.org', () => {
  test('eine Jahresspanne wird beantwortet', async () => {
    const [s] = k.spannen(0, new Date('2026-08-20T12:00:00Z'))
    const r = await fetch(k.abrufUrl('PublicHolidays', 'BW', s!.von, s!.bis))
    expect(r.status).toBe(200)
    expect((await r.json() as unknown[]).length).toBeGreaterThan(0)
  }, 30_000)

  test('die Spanne der alten Fassung wird abgewiesen', async () => {
    const r = await fetch(k.abrufUrl('PublicHolidays', 'BW', '2026-01-01', '2029-12-31'))
    expect(r.status).toBe(400)
    expect(await r.text()).toContain(String(k.MAX_SPANNE_TAGE))
  }, 30_000)
})
