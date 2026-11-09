/**
 * `tpapiNachlauf()` gegen die Attrappe und eine eigene Testdatenbank.
 *
 * Übersprungen ohne TEST_DATABASE_URL. Braucht Stand ≥ 0149 und eine EIGENE
 * Testdatenbank (Schema-Klon), nie die, auf die DATABASE_URL zeigt: die Datei
 * leert `sync.tpapi_zugang` und den Merker `tpapi_personal`. Immer die ganze
 * Datei einzeln laufen lassen — die Notbremsen sitzen im beforeAll:
 *
 *   TEST_DATABASE_URL=postgresql://localhost/<klon> bun test src/tpapi/nachlauf.test.ts
 *
 * DIE ZWEITE NOTBREMSE ist hier wichtiger als die erste. `bun test` lädt die
 * `.env`, und dort stehen die echten Schlüssel samt `api.lina.de`. Läuft der
 * Nachlauf mit dieser Konfiguration, spricht er aus der Agentenumgebung mit
 * dem echten LINA (Regel 7a) — deshalb bricht die Datei ab, wenn Basis oder
 * Schlüssel nicht die der Attrappe sind.
 *
 * WAS GEPRÜFT WIRD (Plan §8, Abnahme):
 *   * Fenster und Backfill, Tag außen und Betrieb innen
 *   * 429 beendet genau den einen Betrieb, nicht den Dienst
 *   * 403 „not licensed" setzt `nicht_lizenziert` und hält den Betrieb
 *     sieben Tage draußen; der Lauf bleibt dabei `ok`
 *   * leere Tage werden vermerkt, der Rückstand fällt
 *   * die Obergrenze je Betrieb greift, ohne einen Zustand zu setzen
 *   * kein Schlüssel im Log, in `sync.tpapi_zugang` oder in `raw`
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { tpapiMockStarten } from './mock'

const DB = process.env.TEST_DATABASE_URL
if (DB && process.env.DATABASE_URL && DB === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL zeigt auf dieselbe Datenbank wie DATABASE_URL — '
    + 'eine eigene Testdatenbank anlegen.')
}
const mitDb = DB ? describe : describe.skip

const A = 'a1'.repeat(20)   // liefert
const B = 'b2'.repeat(20)   // Personal nicht gebucht
const C = 'c3'.repeat(20)   // wird beim ersten Aufruf gebremst
const D = 'd4'.repeat(20)   // plant keine Schichten in LINA: jeder Tag leer
const E = 'e5'.repeat(20)   // Serverfehler
const F = 'f6'.repeat(20)   // Schlüssel ohne Betrieb in core.betrieb
const SCHLUESSEL: Record<string, string> = {
  [A]: 'tpapi-test-schluessel-aaaaaaaaaaaa',
  [B]: 'tpapi-test-schluessel-bbbbbbbbbbbb',
  [C]: 'tpapi-test-schluessel-cccccccccccc',
  [D]: 'tpapi-test-schluessel-dddddddddddd',
  [E]: 'tpapi-test-schluessel-eeeeeeeeeeee',
  [F]: 'tpapi-test-schluessel-ffffffffffff',
}
const BETRIEBE = [A, B, C, D, E]

mitDb('tpapiNachlauf (mit Datenbank und Attrappe)', () => {
  let db: import('pg').Client
  let cfg: any
  let nachlauf: typeof import('./nachlauf').tpapiNachlauf
  let mock: ReturnType<typeof tpapiMockStarten>
  const logs: string[] = []
  /** Beginn dieses Testlaufs nach der Uhr der Datenbank — raw ist append-only und wird nicht geleert. */
  let beginn: Date
  let loesen: (() => void) | undefined

  const zugang = async () => {
    const { rows } = await db.query(
      `SELECT z.enc_id, z.zustand, z.schluessel_vorhanden, z.letzter_http, z.letzter_fehler,
              z.zuletzt_erfolg_am IS NOT NULL AS erfolg
         FROM sync.tpapi_zugang z WHERE z.enc_id = ANY($1) ORDER BY z.enc_id`, [BETRIEBE])
    return Object.fromEntries(rows.map(r => [r.enc_id, r]))
  }
  const rueckstand = async (enc?: string) => (await db.query(
    `SELECT count(*)::int AS n FROM mart.personal_rueckstand
      WHERE enc_id = ANY($1)`, [enc ? [enc] : BETRIEBE])).rows[0].n as number
  const merker = async () => (await db.query(
    `SELECT wert FROM sync.merker WHERE schluessel = 'tpapi_personal'`)).rows[0]?.wert
  const keinSchluesselIn = (text: string) => {
    for (const s of Object.values(SCHLUESSEL)) expect(text).not.toContain(s)
  }

  beforeAll(async () => {
    mock = tpapiMockStarten({
      schluessel: SCHLUESSEL, nichtLizenziert: [B], bremsenFuer: [C], leer: [D], serverfehlerFuer: [E],
    })
    process.env.DATABASE_URL = DB!
    process.env.LINA_API_BASIS = mock.url
    process.env.LINA_API_SCHLUESSEL = JSON.stringify(SCHLUESSEL)
    process.env.LOG_LEVEL ??= 'error'
    const { config } = await import('../config')
    if (config.DATABASE_URL !== DB) {
      throw new Error('config wurde vorher mit einer anderen DATABASE_URL geladen — '
        + 'diese Datei einzeln starten: bun test src/tpapi/nachlauf.test.ts')
    }
    // Regel 7a: nie gegen api.lina.de, nie mit den Schlüsseln aus der .env.
    if (config.LINA_API_BASIS !== mock.url
        || JSON.stringify(config.TPAPI_SCHLUESSEL) !== JSON.stringify(SCHLUESSEL)) {
      throw new Error('config zeigt nicht auf die TPAPI-Attrappe — Abbruch, bevor ein echter Schluessel '
        + 'benutzt wird. Diese Datei einzeln starten.')
    }
    cfg = config
    cfg.TPAPI_TAKT_MS = 0
    cfg.TPAPI_FENSTER_TAGE = 3
    cfg.TPAPI_BACKFILL_JE_LAUF = 10
    cfg.TPAPI_HISTORIE_TAGE = 365
    cfg.TPAPI_AUFRUFE_JE_BETRIEB = 80

    const { log } = await import('../lib/log')
    // Alles abfangen, auch debug, und nichts auf die Konsole.
    ;(log.settings as any).minLevel = 0
    ;(log.settings as any).type = 'hidden'
    loesen = log.attachTransport(o => { logs.push(JSON.stringify(o)) })

    nachlauf = (await import('./nachlauf')).tpapiNachlauf
    const { Client } = await import('pg')
    db = new Client({ connectionString: DB })
    await db.connect()
    beginn = (await db.query(`SELECT now() AS t`)).rows[0].t
    for (const [i, enc] of BETRIEBE.entries()) {
      await db.query(
        `INSERT INTO core.betrieb (enc_id, name) VALUES ($1, $2)
         ON CONFLICT (enc_id) DO UPDATE SET name = excluded.name`, [enc, `Test TPAPI ${'ABCDE'[i]}`])
    }
    await db.query(`DELETE FROM core.betrieb WHERE enc_id = $1`, [F]).catch(() => {})
    await db.query(`DELETE FROM sync.tpapi_zugang`)
    await db.query(`DELETE FROM sync.merker WHERE schluessel = 'tpapi_personal'`)
    for (const t of ['core.personalkosten_stunde', 'core.personalkosten_stunde_abruf']) {
      await db.query(`DELETE FROM ${t} WHERE betrieb_key IN
                        (SELECT betrieb_key FROM core.betrieb WHERE enc_id = ANY($1))`, [BETRIEBE])
    }
  })

  afterAll(async () => {
    loesen?.()
    mock?.stoppen()
    await db?.end()
    const { pool } = await import('../db/pool')
    await pool.end()
  })

  test('erster Lauf: Fenster, Backfill, 429 und 403 je Betrieb, leere Tage vermerkt', async () => {
    // Vor dem Lauf gibt es keine Zugangszeilen — der Rückstand ist leer.
    expect(await rueckstand()).toBe(0)

    const ergebnis = await nachlauf()
    expect(ergebnis).toBe('teilweise')   // C gebremst, E fehler, F ohne Betrieb

    /*
     * Die Aufrufe: Fenster 3 Tage × Betriebe, Tag außen. Am ersten Tag alle
     * fünf, danach nur noch A und D — B, C und E sind nach ihrem ersten
     * Aufruf für diesen Lauf aus. Dann 10 Backfill-Tage für A und D.
     */
    const reihe = mock.aufrufe.map(a => `${a.businessdate}:${a.encId}`)
    expect(mock.aufrufe).toHaveLength(5 + 2 + 2 + 10)
    const tage = [...new Set(mock.aufrufe.map(a => a.businessdate))]
    // Tag außen: die ersten fünf Aufrufe tragen denselben Tag.
    expect(new Set(mock.aufrufe.slice(0, 5).map(a => a.businessdate)).size).toBe(1)
    expect(new Set(mock.aufrufe.slice(0, 5).map(a => a.encId))).toEqual(new Set(BETRIEBE))
    expect(tage).toHaveLength(3 + 5)
    // Jeder Betrieb, der aus ist, wurde genau einmal gefragt.
    for (const enc of [B, C, E]) expect(reihe.filter(r => r.endsWith(`:${enc}`))).toHaveLength(1)
    // F hat keinen Betrieb und wird nie gefragt.
    expect(mock.aufrufe.some(a => a.encId === F)).toBe(false)
    // Backfill neueste zuerst: die Tage sinken.
    const backfillTage = mock.aufrufe.slice(9).map(a => a.businessdate!.split('.').reverse().join('-'))
    expect([...backfillTage].sort().reverse()).toEqual(backfillTage)

    const z = await zugang()
    expect(z[A]).toMatchObject({ zustand: 'ok', erfolg: true, letzter_http: 200, letzter_fehler: null })
    expect(z[B]).toMatchObject({ zustand: 'nicht_lizenziert', erfolg: false, letzter_http: 403 })
    expect(z[B].letzter_fehler).toContain('not licensed')
    expect(z[C]).toMatchObject({ zustand: 'gebremst', letzter_http: 429 })
    expect(z[D]).toMatchObject({ zustand: 'ok', erfolg: true })
    expect(z[E]).toMatchObject({ zustand: 'fehler', letzter_http: 500 })
    expect(Object.values(z).every((r: any) => r.schluessel_vorhanden)).toBe(true)

    expect(await merker()).toMatchObject({
      ok: true, betriebe: 5, abrufe: 19, geladen: 8, leer: 8, ohne_betrieb: 1,
    })
    expect((await merker()).fehler).toContain('1 gebremst')

    // Leere Tage zählen als geholt (D5): D hat dieselbe Zahl Abrufzeilen wie A.
    const { rows: abrufe } = await db.query(
      `SELECT b.enc_id, count(*)::int AS n, sum(a.stunden)::int AS stunden
         FROM core.personalkosten_stunde_abruf a JOIN core.betrieb b USING (betrieb_key)
        WHERE b.enc_id = ANY($1) GROUP BY 1 ORDER BY 1`, [BETRIEBE])
    expect(abrufe).toEqual([
      { enc_id: A, n: 8, stunden: 8 * 15 },
      { enc_id: D, n: 8, stunden: 0 },
    ])

    // Der Rückstand: B fällt als nicht lizenziert heraus, A und D um je 8.
    expect(await rueckstand(A)).toBe(365 - 8)
    expect(await rueckstand(D)).toBe(365 - 8)
    expect(await rueckstand(B)).toBe(0)
    expect(await rueckstand(C)).toBe(365)
  })

  test('raw: jede Antwort gesichert, auch 403/429/500 — keine einzige mit kostUser', async () => {
    const { rows } = await db.query(
      `SELECT http_status, payload, payload_text FROM raw.api_antwort
        WHERE quelle = 'tpapi' AND betrieb_enc_id = ANY($1) AND abgerufen_am >= $2`, [BETRIEBE, beginn])
    expect(rows.length).toBe(19)
    expect(rows.filter(r => r.http_status === 403)).toHaveLength(1)
    expect(rows.filter(r => r.http_status === 429)).toHaveLength(1)
    expect(rows.filter(r => r.http_status === 500)).toHaveLength(1)
    for (const r of rows) {
      const text = JSON.stringify(r.payload) + (r.payload_text ?? '')
      expect(text).not.toContain('kostUser')
      expect(text).not.toContain('ma1000')
      keinSchluesselIn(text)
    }
  })

  test('zweiter Lauf: B bleibt sieben Tage draußen, C ist wieder da — und der Lauf ist ok', async () => {
    mock.stoppen()
    mock = tpapiMockStarten({ schluessel: SCHLUESSEL, nichtLizenziert: [B], leer: [D] })
    cfg.LINA_API_BASIS = mock.url
    // Ohne F: kein Schlüssel ohne Betrieb mehr.
    const { [F]: _, ...ohneF } = SCHLUESSEL
    cfg.TPAPI_SCHLUESSEL = ohneF
    const vorher = await rueckstand()

    expect(await nachlauf()).toBe('ok')
    expect(mock.aufrufe.some(a => a.encId === B)).toBe(false)
    const z = await zugang()
    expect(z[C]).toMatchObject({ zustand: 'ok', erfolg: true })
    expect(z[E]).toMatchObject({ zustand: 'ok', letzter_fehler: null })
    expect(z[B].zustand).toBe('nicht_lizenziert')
    // Fenster 3 Tage × 4 Betriebe, davon für A und D schon geholt (zählen trotzdem: Fenster
    // fragt neu), dazu 10 Backfill-Tage. Der Rückstand fällt um die neuen Tage.
    expect(mock.aufrufe).toHaveLength(12 + 10)
    expect(await rueckstand()).toBe(vorher - (3 + 3) - 10)
    expect(await merker()).toMatchObject({ ok: true, betriebe: 4, abrufe: 22, ohne_betrieb: 0, fehler: null })
  })

  test('das Fenster holt schon geholte Tage neu: abrufe zählt hoch', async () => {
    const { rows: [r] } = await db.query(
      `SELECT max(a.abrufe)::int AS hoechstens FROM core.personalkosten_stunde_abruf a
         JOIN core.betrieb b USING (betrieb_key) WHERE b.enc_id = $1`, [A])
    expect(r.hoechstens).toBe(2)
  })

  test('die Obergrenze je Betrieb beendet den Betrieb, ohne einen Zustand zu setzen', async () => {
    mock.aufrufe.length = 0
    cfg.TPAPI_AUFRUFE_JE_BETRIEB = 2
    try {
      expect(await nachlauf()).toBe('ok')
    } finally {
      cfg.TPAPI_AUFRUFE_JE_BETRIEB = 80
    }
    // A, C, D, E je zwei Aufrufe — der dritte Fenstertag und der Backfill fallen weg.
    expect(mock.aufrufe).toHaveLength(4 * 2)
    const z = await zugang()
    for (const enc of [A, C, D, E]) expect(z[enc].zustand).toBe('ok')
  })

  test('429 bei allen: der Dienst endet teilweise, der Merker sagt ok = false', async () => {
    mock.stoppen()
    mock = tpapiMockStarten({ schluessel: SCHLUESSEL, bremsen: 1000 })
    cfg.LINA_API_BASIS = mock.url
    expect(await nachlauf()).toBe('teilweise')
    // Je Betrieb genau EIN Aufruf — kein Retry, kein Weiterfragen.
    expect(mock.aufrufe).toHaveLength(4)
    expect(await merker()).toMatchObject({ ok: false, abrufe: 4, geladen: 0 })
    const z = await zugang()
    for (const enc of [A, C, D, E]) expect(z[enc]).toMatchObject({ zustand: 'gebremst', letzter_http: 429 })
  })

  test('ein weggefallener Schlüssel setzt ohne_schluessel, der Betrieb verlässt den Rückstand', async () => {
    mock.stoppen()
    mock = tpapiMockStarten({ schluessel: SCHLUESSEL, nichtLizenziert: [B], leer: [D] })
    cfg.LINA_API_BASIS = mock.url
    const { [A]: _a, [F]: _f, ...ohneA } = SCHLUESSEL
    cfg.TPAPI_SCHLUESSEL = ohneA
    await nachlauf()
    expect(mock.aufrufe.some(a => a.encId === A)).toBe(false)
    expect((await zugang())[A]).toMatchObject({ zustand: 'ohne_schluessel', schluessel_vorhanden: false })
    expect(await rueckstand(A)).toBe(0)

    // Kommt er wieder, ist er wieder dabei.
    cfg.TPAPI_SCHLUESSEL = { ...ohneA, [A]: SCHLUESSEL[A] }
    mock.aufrufe.length = 0
    await nachlauf()
    expect(mock.aufrufe.some(a => a.encId === A)).toBe(true)
    expect((await zugang())[A]).toMatchObject({ zustand: 'ok', schluessel_vorhanden: true })
  })

  test('ohne Schlüssel: uebersprungen, kein Aufruf, alle Zugänge ohne_schluessel', async () => {
    mock.aufrufe.length = 0
    cfg.TPAPI_SCHLUESSEL = {}
    expect(await nachlauf()).toBe('uebersprungen')
    expect(mock.aufrufe).toHaveLength(0)
    const z = await zugang()
    for (const enc of BETRIEBE) expect(z[enc]).toMatchObject({ zustand: 'ohne_schluessel', schluessel_vorhanden: false })
    cfg.TPAPI_SCHLUESSEL = SCHLUESSEL
  })

  test('kein Schlüssel im Log und in sync.tpapi_zugang', async () => {
    expect(logs.length).toBeGreaterThan(0)
    // Die Abschlusszeile mit der Sicht steht im Log.
    expect(logs.some(l => l.includes('tpapi personal geholt') && l.includes('mart.tpapi_zugang'))).toBe(true)
    keinSchluesselIn(logs.join('\n'))
    const { rows } = await db.query(`SELECT coalesce(string_agg(letzter_fehler, ' '), '') AS t FROM sync.tpapi_zugang`)
    keinSchluesselIn(rows[0].t)
  })
})
