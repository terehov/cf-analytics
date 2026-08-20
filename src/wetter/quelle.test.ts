/**
 * Der Wetterabruf und seine Verdichtung.
 *
 * Zwei Ebenen, weil die Fehler auf zwei Ebenen liegen: das Lesen der Antwort
 * (Attrappe, keine Datenbank) und die Verdichtung auf den Geschäftstag
 * (Datenbank, echte Zeitzonenrechnung). Die zweite ist die gefährlichere —
 * `core.geschaeftstag()` schneidet um 08:00 Berliner Zeit, und ein naiver
 * Kalendertag verschiebt das Wetter um acht Stunden gegen den Umsatz, ohne
 * dass es irgendwo auffällt.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { BrightSky } from './quelle'
import { query } from '../db/pool'

/** Ein Gitterpunkt, den es nicht gibt — damit der Test keine echten Zeilen trifft. */
const PROBE = { breite: 55.99, laenge: 5.01 }

function antwort(stunden: unknown[], quellen: unknown[] = [{ id: 7, distance: 4321.6 }]) {
  return new Response(JSON.stringify({ weather: stunden, sources: quellen }),
    { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('BrightSky: die Antwort lesen', () => {
  test('last_date zeigt auf den FOLGETAG, sonst fehlen 23 Stunden', async () => {
    let gesehen = ''
    const alt = globalThis.fetch
    globalThis.fetch = (async (u: any) => { gesehen = String(u); return antwort([]) }) as any
    try {
      await new BrightSky().hole(PROBE, '2025-01-01', '2025-12-31')
    } finally { globalThis.fetch = alt }

    // Der Befund vom 20.08.2026: `last_date` liefert nur die Stunde 00:00
    // dieses Tages. Ohne die Korrektur fehlte in jedem Jahr der
    // Silvesterabend — an dem die Gastronomie arbeitet.
    expect(gesehen).toContain('date=2025-01-01')
    expect(gesehen).toContain('last_date=2026-01-01')
  })

  test('fehlende Messwerte bleiben null und werden nicht zu 0', async () => {
    const alt = globalThis.fetch
    globalThis.fetch = (async () => antwort([{
      timestamp: '2025-06-01T12:00:00+00:00', source_id: 7,
      temperature: 21.5, precipitation: 0.0, sunshine: null,
      wind_speed: 9.3, cloud_cover: 40, relative_humidity: 55, condition: 'dry',
    }])) as any
    try {
      const a = await new BrightSky().hole(PROBE, '2025-06-01', '2025-06-01')
      expect(a.werte).toHaveLength(1)
      // sunshine ist in 5,4 % der Stunden nicht belegt. 0 hiesse "keine
      // Sonne", null heisst "nicht gemessen" — der Unterschied entscheidet
      // ueber die Sonnenklasse.
      expect(a.werte[0]!.sonnenschein).toBeNull()
      expect(a.werte[0]!.niederschlag).toBe(0)
      expect(a.werte[0]!.temperatur).toBe(21.5)
      expect(a.werte[0]!.distanzM).toBe(4322)
    } finally { globalThis.fetch = alt }
  })

  test('ein Fehlschlag wirft und wird nicht als leeres Ergebnis ausgegeben', async () => {
    const alt = globalThis.fetch
    globalThis.fetch = (async () => new Response('nope', { status: 503 })) as any
    try {
      await expect(new BrightSky().hole(PROBE, '2025-01-01', '2025-01-01')).rejects.toThrow('503')
    } finally { globalThis.fetch = alt }
  })
})

async function db(): Promise<boolean> {
  try { await query(`SELECT 1 FROM manual.wetter_stunde LIMIT 1`); return true }
  catch { return false }
}

async function saeubern() {
  try {
    await query(`DELETE FROM manual.wetter_stunde WHERE breite = $1 AND laenge = $2`,
      [PROBE.breite, PROBE.laenge])
  } catch { /* keine Datenbank */ }
}

afterAll(saeubern)

describe('mart.wetter_tag: Verdichtung auf den Geschaeftstag', () => {
  test('der Geschaeftstag beginnt um 08:00 Berliner Zeit, nicht um Mitternacht', async () => {
    if (!await db()) { console.log('uebersprungen — keine Datenbank'); return }
    await saeubern()

    // 07:00 Berlin gehoert noch zum VORTAG, 08:00 zum neuen Tag.
    await query(
      `INSERT INTO manual.wetter_stunde (breite, laenge, zeitpunkt, temperatur, niederschlag)
       VALUES ($1,$2,'2025-06-10T07:00:00+02:00', 11, 0),
              ($1,$2,'2025-06-10T08:00:00+02:00', 22, 0)`,
      [PROBE.breite, PROBE.laenge])

    const r = await query<{ geschaeftstag: string; tag_temp_max: string; stunden_fenster: number }>(
      `SELECT geschaeftstag::text, tag_temp_max::text, stunden_fenster
         FROM mart.wetter_tag WHERE breite = $1 AND laenge = $2
        ORDER BY geschaeftstag`, [PROBE.breite, PROBE.laenge])

    expect(r.map(x => x.geschaeftstag)).toEqual(['2025-06-09', '2025-06-10'])
    // Die 07:00-Zeile faellt auf den 09., liegt aber VOR Stunde 8 — sie
    // gehoert damit nicht ins Fenster 08-24.
    expect(r[0]!.stunden_fenster).toBe(0)
    expect(r[1]!.stunden_fenster).toBe(1)
  })

  test('die doppelte Stunde der Zeitumstellung kollidiert nicht', async () => {
    if (!await db()) { console.log('uebersprungen — keine Datenbank'); return }
    await saeubern()

    // In der Nacht zum 26.10.2025 gibt es 02:00 Ortszeit ZWEIMAL: einmal
    // als CEST (+02:00), einmal als CET (+01:00). Ein Schluessel auf der
    // Ortszeit kollidierte hier; auf dem Zeitpunkt nicht.
    await query(
      `INSERT INTO manual.wetter_stunde (breite, laenge, zeitpunkt, temperatur)
       VALUES ($1,$2,'2025-10-26T02:00:00+02:00', 9),
              ($1,$2,'2025-10-26T02:00:00+01:00', 8)`,
      [PROBE.breite, PROBE.laenge])

    const [r] = await query<{ n: number; geschaeftstag: string }>(
      `SELECT count(*)::int AS n, geschaeftstag::text
         FROM mart.wetter_tag WHERE breite = $1 AND laenge = $2
        GROUP BY geschaeftstag`, [PROBE.breite, PROBE.laenge])
    const [z] = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM manual.wetter_stunde
        WHERE breite = $1 AND laenge = $2`, [PROBE.breite, PROBE.laenge])

    expect(z!.n).toBe(2)                       // beide Zeilen sind da
    expect(r!.geschaeftstag).toBe('2025-10-25') // 02:00 minus 8 h ist der Vortag
  })

  test('eine Messluecke bei der Sonne sieht nicht aus wie Bewoelkung', async () => {
    if (!await db()) { console.log('uebersprungen — keine Datenbank'); return }
    await saeubern()

    // Zwei Stunden im Fenster: eine mit 60 Sonnenminuten, eine ohne Messung.
    // Gegen 2 Stunden gerechnet waeren das 50 %, gegen die BELEGTE Stunde
    // sind es 100 %. Der Unterschied entscheidet ueber die Sonnenklasse.
    await query(
      `INSERT INTO manual.wetter_stunde (breite, laenge, zeitpunkt, sonnenschein)
       VALUES ($1,$2,'2025-06-10T12:00:00+02:00', 60),
              ($1,$2,'2025-06-10T13:00:00+02:00', NULL)`,
      [PROBE.breite, PROBE.laenge])

    const [r] = await query<{ pct: string; sonne_stunden: number; stunden: number }>(
      `SELECT fenster_sonne_pct::text AS pct, fenster_sonne_stunden AS sonne_stunden,
              stunden_fenster AS stunden
         FROM mart.wetter_tag WHERE breite = $1 AND laenge = $2`,
      [PROBE.breite, PROBE.laenge])

    expect(Number(r!.pct)).toBe(100)
    expect(r!.sonne_stunden).toBe(1)   // nur eine Stunde war belegt …
    expect(r!.stunden).toBe(2)         // … von zwei im Fenster
  })
})

describe('manual.wetter_klasse: die Grenzen', () => {
  /**
   * Die Klassen stehen in `pflege/wetter_klasse.csv` und sind damit ohne
   * Migration änderbar — genau deshalb braucht es diese Prüfung. Wer eine
   * Grenze verschiebt und die Nachbarklasse vergisst, hinterlässt eine Lücke,
   * und Tage verschwinden lautlos aus den Kacheln. Das sieht wie ein Ergebnis
   * aus.
   */
  test('keine Luecke, keine Ueberlappung', async () => {
    if (!await db()) { console.log('uebersprungen — keine Datenbank'); return }
    const befunde = await query<{ kategorie: string; klasse: string; befund: string }>(
      `SELECT kategorie, klasse, befund FROM mart.wetter_klasse_pruefung`)
    expect(befunde).toEqual([])
  })

  test('jede Kategorie ist nach unten UND nach oben offen', async () => {
    if (!await db()) { console.log('uebersprungen — keine Datenbank'); return }
    // Sonst fallen Ausreisser heraus, statt in der Randklasse zu landen —
    // und ein 42-Grad-Tag ist genau der, den man sehen will.
    const r = await query<{ kategorie: string; unten: number; oben: number }>(
      `SELECT kategorie,
              count(*) FILTER (WHERE von IS NULL)::int AS unten,
              count(*) FILTER (WHERE bis IS NULL)::int AS oben
         FROM manual.wetter_klasse GROUP BY kategorie ORDER BY kategorie`)
    expect(r.length).toBeGreaterThan(0)
    for (const k of r) expect({ k: k.kategorie, unten: k.unten, oben: k.oben })
      .toEqual({ k: k.kategorie, unten: 1, oben: 1 })
  })
})
