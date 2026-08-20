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

describe('abrufplan', () => {
  const LAENDER = ['BW', 'BY']
  const plan = (o: Partial<Parameters<typeof k.abrufplan>[0]> = {}) => k.abrufplan({
    laender: LAENDER, vorhanden: new Set<string>(), boden: 2020,
    jahr: 2026, vorlauf: 3, hoechstens: 1000, ...o,
  })

  test('das laufende Jahr und der Vorlauf sind IMMER dabei', () => {
    // Auch wenn Zeilen da sind: Thueringen hat 2019 den Weltkindertag
    // bekommen, und Ferientermine werden nachgeschoben.
    const alles = new Set(Array.from({ length: 10 }, (_, i) => `BW|${2020 + i}`))
    const j = plan({ laender: ['BW'], vorhanden: alles }).map(a => a.jahr)
    expect(j).toEqual([2026, 2027, 2028, 2029])
  })

  test('die Historie kommt nur, wo sie fehlt', () => {
    const da = new Set(['BW|2020', 'BW|2021', 'BW|2022', 'BW|2023', 'BW|2024'])
    const j = plan({ laender: ['BW'], vorhanden: da }).map(a => a.jahr)
    expect(j).toEqual([2026, 2027, 2028, 2029, 2025])
  })

  test('der Boden wird nicht unterschritten', () => {
    // Vor 2020 hat die Quelle keine Feiertage. Ein Abruf dorthin kaeme
    // jeden Monat leer zurueck.
    const jahre = plan({ laender: ['BW'] }).map(a => a.jahr)
    expect(Math.min(...jahre)).toBe(2020)
  })

  test('das juengste fehlende Jahr zuerst, quer ueber die Laender', () => {
    // Sonst fuellt sich BW bis 2020 auf, waehrend BY noch bei 2025 steht.
    const historie = plan().filter(a => a.jahr < 2026)
    expect(historie.slice(0, 4).map(a => `${a.kuerzel}${a.jahr}`))
      .toEqual(['BW2025', 'BY2025', 'BW2024', 'BY2024'])
  })

  test('die Obergrenze schneidet das AELTESTE ab, nicht das laufende Jahr', () => {
    const p = plan({ hoechstens: 10 })
    expect(p).toHaveLength(10)
    // Acht Plaetze fuer laufendes Jahr + Vorlauf (zwei Laender), dann die
    // beiden juengsten Historienjahre.
    expect(p.slice(8).map(a => a.jahr)).toEqual([2025, 2025])
  })

  test('nichts zu tun ist ein leerer Plan, kein Fehler', () => {
    expect(k.abrufplan({
      laender: [], vorhanden: new Set(), boden: 2020,
      jahr: 2026, vorlauf: 3, hoechstens: 10,
    })).toEqual([])
  })

  /** DER TEST, DER DEN FEHLER VOM 14.08. GEFUNDEN HAETTE. */
  test('keine Anfrage ueberschreitet die Grenze der Schnittstelle', () => {
    for (const vorlauf of [1, 2, 3, 5, 10]) {
      for (const a of plan({ vorlauf, boden: 2016 })) {
        // Land und Jahr stehen mit in der Erwartung, damit ein Fehlschlag
        // sagt, WELCHE Anfrage zu weit greift.
        expect({ vorlauf, a: `${a.kuerzel}${a.jahr}`, zuWeit: tage(a.von, a.bis) > k.MAX_SPANNE_TAGE })
          .toEqual({ vorlauf, a: `${a.kuerzel}${a.jahr}`, zuWeit: false })
      }
    }
  })

  test('auch ein Schaltjahr bleibt unter der Grenze', () => {
    const a = plan({ laender: ['BW'], jahr: 2028, vorlauf: 0 })[0]!
    expect(a).toEqual({ kuerzel: 'BW', jahr: 2028, von: '2028-01-01', bis: '2028-12-31' })
    expect(tage(a.von, a.bis)).toBe(365)
  })

  test('ein ganzes Jahr, nicht ab heute', () => {
    // Sonst fielen im August die Sommerferien aus dem Abruf: validFrom
    // schneidet nach BEGINN, und der liegt im Juli.
    expect(plan({ laender: ['BW'] })[0]!.von).toBe('2026-01-01')
  })

  test('die Boeden stehen bei der Quelle, nicht beim Aufrufer', () => {
    // Feiertage gibt es dort ab 2020, Schulferien ab 2016 — am 20.08.2026
    // gemessen und im Kommentar von BODEN belegt.
    expect(k.BODEN.PublicHolidays).toBe(2020)
    expect(k.BODEN.SchoolHolidays).toBe(2017)
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

describe('ohneVarianten', () => {
  /**
   * MV FUEHRT ZWEI SCHULFORMEN. Sommerferien 2025: 14.07.-30.08. fuer die
   * allgemeinbildenden Schulen, 28.07.-06.09. fuer die berufsbildenden. Wer
   * beide behaelt, gibt Mecklenburg-Vorpommern acht Wochen Sommerferien statt
   * sieben — und ist_schulferien misst dann eine Schulform, die kaum jemand
   * mit Kindern in ein Restaurant bringt.
   */
  test('von zwei Schulformen bleibt die allgemeinbildende', () => {
    const raus = k.ohneVarianten([
      { v: '2025-07-28', b: '2025-09-06', n: 'Sommerferien', r: 2 },  // BBS
      { v: '2025-07-14', b: '2025-08-30', n: 'Sommerferien', r: 1 },  // ABS
    ])
    expect(raus).toEqual([{ v: '2025-07-14', b: '2025-08-30', n: 'Sommerferien', r: 1 }])
  })

  /** SH: die Inseln haben eine Woche frueher Herbstferien als das Festland. */
  test('von Land und Insel bleibt das Land', () => {
    const raus = k.ohneVarianten([
      { v: '2024-10-14', b: '2024-11-01', n: 'Herbstferien', r: 2 },  // Sylt, Foehr, ...
      { v: '2024-10-21', b: '2024-11-01', n: 'Herbstferien', r: 0 },  // das ganze Land
    ])
    expect(raus.map(z => z.v)).toEqual(['2024-10-21'])
  })

  /**
   * DER FALL, AN DEM EINE GRUPPIERUNG NACH MONAT ZERBRICHT: die beiden
   * SH-Herbstferien 2018 beginnen im September und im Oktober.
   */
  test('Varianten ueber die Monatsgrenze zaehlen als eine', () => {
    const raus = k.ohneVarianten([
      { v: '2018-09-24', b: '2018-10-19', n: 'Herbstferien', r: 2 },
      { v: '2018-10-01', b: '2018-10-19', n: 'Herbstferien', r: 0 },
    ])
    expect(raus).toHaveLength(1)
    expect(raus[0]!.v).toBe('2018-10-01')
  })

  /**
   * UND DER FALL, AN DEM EINE GRUPPIERUNG NACH NAMEN ALLEIN ZERBRICHT:
   * Weihnachtsferien kommen zweimal im Kalenderjahr vor.
   */
  test('Januar und Dezember sind zwei Ereignisse, kein Duplikat', () => {
    const raus = k.ohneVarianten([
      { v: '2026-01-01', b: '2026-01-05', n: 'Weihnachtsferien', r: 0 },
      { v: '2026-12-23', b: '2027-01-05', n: 'Weihnachtsferien', r: 0 },
    ])
    expect(raus).toHaveLength(2)
  })

  test('verschiedene Ferien duerfen sich ueberlappen', () => {
    // MV legt 2023 einen "Zusaetzlichen Ferientag" in die Pfingstferien.
    const raus = k.ohneVarianten([
      { v: '2023-05-26', b: '2023-05-30', n: 'Pfingstferien', r: 0 },
      { v: '2023-05-26', b: '2023-05-26', n: 'Zusätzlicher Ferientag', r: 0 },
    ])
    expect(raus).toHaveLength(2)
  })

  test('bei gleicher Geltung gewinnt der laengere Zeitraum', () => {
    const raus = k.ohneVarianten([
      { v: '2026-12-20', b: '2027-01-03', n: 'Weihnachtsferien', r: 0 },
      { v: '2026-12-22', b: '2027-01-03', n: 'Weihnachtsferien', r: 0 },
    ])
    expect(raus.map(z => z.v)).toEqual(['2026-12-20'])
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
    const [a] = k.abrufplan({ laender: ['BW'], vorhanden: new Set(), boden: 2020,
                              jahr: 2026, vorlauf: 0, hoechstens: 1 })
    const r = await fetch(k.abrufUrl('PublicHolidays', 'BW', a!.von, a!.bis))
    expect(r.status).toBe(200)
    expect((await r.json() as unknown[]).length).toBeGreaterThan(0)
  }, 30_000)

  test('die Laenderliste kommt auf sechzehn', async () => {
    // Sie steht nicht im Code, sondern kommt aus derselben Schnittstelle.
    const r = await fetch('https://openholidaysapi.org/Subdivisions'
      + '?countryIsoCode=DE&languageIsoCode=DE')
    const codes = (await r.json() as { code: string }[]).map(x => x.code)
    expect(codes).toHaveLength(16)
    expect(codes).toContain('DE-BW')
    expect(codes).toContain('DE-MV')
  }, 30_000)

  test('die Spanne der alten Fassung wird abgewiesen', async () => {
    const r = await fetch(k.abrufUrl('PublicHolidays', 'BW', '2026-01-01', '2029-12-31'))
    expect(r.status).toBe(400)
    expect(await r.text()).toContain(String(k.MAX_SPANNE_TAGE))
  }, 30_000)
})
