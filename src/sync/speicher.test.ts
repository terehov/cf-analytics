/**
 * Der Speicherwächter (0152): Messung, Prognose, Stufen, Nachricht.
 *
 * Drei Teile:
 *   1. ohne Datenbank — platteMessen() gegen eine statfs-Attrappe,
 *      speicherPruefung() je befund, die Zeile in der Nachricht nach dem Lauf
 *   2. die Prognose in mart.speicher_stand an synthetischen Messreihen —
 *      braucht TEST_DATABASE_URL; jeder Fall in EINER Transaktion, die die
 *      Tabelle leert, Reihen einsetzt, liest und ZURÜCKROLLT
 *   3. speicherMessen() gegen die Testdatenbank — schreibt wirklich, aber
 *      über einen eigenen Client auf TEST_DATABASE_URL (opt.db), NIE über den
 *      Pool: der hängt an DATABASE_URL, und ein Test, der still in die lokale
 *      Arbeitsdatenbank schreibt, ist am 12.11.2026 schon einmal passiert.
 *      Seine Zeilen tragen lauf_id = -152 und werden danach entfernt.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from 'pg'
import { platteMessen, speicherMessen, speicherPruefung, type SpeicherStand } from './speicher'
import { nachrichtBauen, type LaufKopf } from '../meldung'
import type { Statusbericht } from '../status'

const G = 1024 ** 3

// --- 1. Ohne Datenbank -----------------------------------------------------------

describe('platteMessen', () => {
  test('rechnet wie df: Size = blocks, Used = blocks − bfree, Avail = bavail', async () => {
    const r = await platteMessen('/', async () => ({ bsize: 4096, frsize: 4096, blocks: 1000, bfree: 300, bavail: 250 }))
    expect(r.fehler).toBeNull()
    expect(r.platte).toEqual({ gesamt: 4096_000, belegt: 700 * 4096, frei: 250 * 4096 })
  })

  test('ohne frsize gilt bsize', async () => {
    const r = await platteMessen('/', async () => ({ bsize: 1024, blocks: 10, bfree: 5, bavail: 5 }))
    expect(r.platte?.gesamt).toBe(10_240)
  })

  test('wirft nicht, wenn statfs scheitert — es meldet den Grund', async () => {
    const r = await platteMessen('/gibt/es/nicht', async () => { throw new Error('ENOENT') })
    expect(r.platte).toBeNull()
    expect(r.fehler).toContain('ENOENT')
    expect(r.fehler).toContain('/gibt/es/nicht')
  })

  test('unplausible Werte sind ein Fehler, keine Zahl', async () => {
    const r = await platteMessen('/', async () => ({ bsize: 4096, blocks: 0, bfree: 0, bavail: 0 }))
    expect(r.platte).toBeNull()
    expect(r.fehler).toContain('unplausible')
  })
})

/** Ein Stand, wie mart.speicher_stand ihn liefert (numeric als Text). */
function stand(teil: Partial<SpeicherStand>): SpeicherStand {
  return {
    befund: 'ok', befund_text: 'Text aus der Sicht', messungen: 10, alter_stunden: '0.5',
    frei_gb: '99.0', frei_pct: '68.3', db_gb: '38.40', raw_gb: '12.10',
    verbrauch_prognose_gb_tag: '0.40', db_wachstum_7t_gb_tag: '0.35',
    tage_bis_voll: 211, datum_voll: '2027-06-11', tage_bis_warnschwelle: 156, datum_warnschwelle: '2027-04-17',
    warnschwelle_pct: '25.0', voll_pct: '10.0',
    ...teil,
  }
}

const BEOBACHTEN = stand({
  befund: 'beobachten', frei_gb: '72.4', frei_pct: '49.9', verbrauch_prognose_gb_tag: '0.85',
  tage_bis_warnschwelle: 42, datum_warnschwelle: '2026-12-24', tage_bis_voll: 68, datum_voll: '2027-01-19',
})
const HOCHSKALIEREN = stand({
  befund: 'hochskalieren', frei_gb: '41.2', frei_pct: '28.4', verbrauch_prognose_gb_tag: '1.12',
  tage_bis_warnschwelle: 4, datum_warnschwelle: '2026-11-16', tage_bis_voll: 23, datum_voll: '2026-12-05',
})

describe('speicherPruefung — je befund eine Stufe', () => {
  test('ok → ok, knapp, mit Datum', () => {
    const p = speicherPruefung(stand({}))
    expect(p.stufe).toBe('ok')
    expect(p.name).toBe('speicher')
    expect(p.meldung).toBe('99 GB frei (68,3 %), Verbrauch 0,4 GB/Tag — voll frühestens am 11.06.2027')
    expect(p.naechster_schritt).toBeUndefined()
  })

  test('ok ohne Wachstum: kein Datum, keine Division', () => {
    const p = speicherPruefung(stand({ verbrauch_prognose_gb_tag: '0.00', tage_bis_voll: null, datum_voll: null }))
    expect(p.stufe).toBe('ok')
    expect(p.meldung).toBe('99 GB frei (68,3 %), kein Wachstum')
  })

  test('beobachten → warnung, mit Termin', () => {
    const p = speicherPruefung(BEOBACHTEN)
    expect(p.stufe).toBe('warnung')
    expect(p.meldung).toContain('72,4 GB frei (49,9 %)')
    expect(p.meldung).toContain('0,85 GB/Tag')
    expect(p.meldung).toContain('24.12.2026')
    expect(p.naechster_schritt).toContain('vor dem 24.12.2026')
  })

  test('hochskalieren → stoerung, mit Frist', () => {
    const p = speicherPruefung(HOCHSKALIEREN)
    expect(p.stufe).toBe('stoerung')
    expect(p.naechster_schritt).toContain('Server hochskalieren bis spätestens 05.12.2026')
  })

  test('hochskalieren ohne Wachstum (nur unter 25 %): keine erfundene Frist', () => {
    const p = speicherPruefung(stand({ befund: 'hochskalieren', frei_gb: '30', frei_pct: '20.7',
      verbrauch_prognose_gb_tag: null, tage_bis_voll: null, datum_voll: null }))
    expect(p.stufe).toBe('stoerung')
    expect(p.meldung).toContain('unter der Warnschwelle von 25 %')
    expect(p.naechster_schritt).toContain('in den nächsten Wochen')
  })

  test('dringend → stoerung, JETZT', () => {
    const p = speicherPruefung(stand({ befund: 'dringend', frei_gb: '12', frei_pct: '8.3', tage_bis_voll: 0 }))
    expect(p.stufe).toBe('stoerung')
    expect(p.naechster_schritt).toContain('JETZT')
    expect(p.naechster_schritt).toContain('nie mit --volumes')
  })

  test('falsche platte → stoerung', () => {
    const p = speicherPruefung(stand({ befund: 'falsche platte', befund_text: 'Die Datenbank (60 GB) ist größer …' }))
    expect(p.stufe).toBe('stoerung')
    expect(p.naechster_schritt).toContain('SPEICHER_PFAD')
  })

  test('keine messung, noch nie gemessen → warnung (endet mit dem nächsten Lauf von selbst)', () => {
    const p = speicherPruefung(stand({ befund: 'keine messung', messungen: 0 }))
    expect(p.stufe).toBe('warnung')
  })

  test('keine messung, letzte zu alt → stoerung (Regel 10)', () => {
    const p = speicherPruefung(stand({ befund: 'keine messung', messungen: 30, alter_stunden: '50' }))
    expect(p.stufe).toBe('stoerung')
  })

  test('keine Zeile aus der Sicht → stoerung', () => {
    expect(speicherPruefung(null).stufe).toBe('stoerung')
  })
})

describe('die Speicherzeile in der Nachricht nach dem Lauf', () => {
  const lauf: LaufKopf = {
    laufId: '201', status: 'ok',
    gestartetAm: new Date('2026-11-20T04:02:00Z'), beendetAm: new Date('2026-11-21T03:30:00Z'),
    ableitungenBis: new Date('2026-11-20T05:40:00Z'), aufgabenOk: 9120, aufgabenFehler: 0,
  }
  const bericht = (s: SpeicherStand): Statusbericht => {
    const p = speicherPruefung(s)
    return { status: p.stufe, geprueft_am: '2026-11-21T03:31:00Z',
             pruefungen: [{ name: 'zugang', stufe: 'ok', meldung: 'Zugang frei' }, p] }
  }

  test('ok: nur der Name in der Zeile ohne Befund', () => {
    const t = nachrichtBauen({ lauf, bericht: bericht(stand({})), vorher: [] })
    expect(t).toContain('✅ LINA-Zugang · Speicherplatz')
    expect(t).not.toContain('| Bereich |')
  })

  test('beobachten: Zeile mit frei, Verbrauch und Datum, dazu der Schritt', () => {
    const t = nachrichtBauen({ lauf, bericht: bericht(BEOBACHTEN), vorher: [] })
    console.log('--- Beispiel beobachten ---\n' + t)
    expect(t).toContain('| ⚠️ 🆕 | **Speicherplatz** | 72,4 GB frei (49,9 %), Verbrauch 0,85 GB/Tag')
    expect(t).toContain('- **Speicherplatz:** Noch nichts zu tun')
    expect(t).toContain('`SELECT * FROM mart.speicher_stand;`')
  })

  test('hochskalieren: Störung im Titel, Frist im Schritt', () => {
    const t = nachrichtBauen({ lauf, bericht: bericht(HOCHSKALIEREN), vorher: ['speicher:stoerung'] })
    console.log('--- Beispiel hochskalieren ---\n' + t)
    expect(t).toContain('Störung, bitte ansehen')
    expect(t).toContain('| 🔴 | **Speicherplatz** | Nur noch 41,2 GB frei (28,4 %)')
    expect(t).toContain('Server hochskalieren bis spätestens 05.12.2026')
  })
})

// --- 2. Die Prognose in mart.speicher_stand --------------------------------------

const DB = process.env.TEST_DATABASE_URL
const mitDb = DB ? describe : describe.skip

/** Eine Messung, Werte in GB (1024^3). Root-Reserve 5 GB wie auf ext4. */
type Reihe = { vorStunden: number; frei: number; belegt?: number; db?: number; raw?: number; ohnePlatte?: boolean }

mitDb('mart.speicher_stand an synthetischen Messreihen', () => {
  let db: Client
  beforeAll(async () => { db = new Client({ connectionString: DB }); await db.connect() })
  afterAll(async () => { await db?.end() })

  /** Tabelle leeren, Reihe einsetzen, Stand lesen — alles zurückgerollt. */
  async function mit(reihe: Reihe[]): Promise<any> {
    await db.query('BEGIN')
    try {
      await db.query('DELETE FROM sync.speicher_messung')
      for (const r of reihe) {
        const belegt = r.belegt ?? 145 - r.frei
        await db.query(
          `INSERT INTO sync.speicher_messung
             (gemessen_am, pfad, platte_gesamt, platte_belegt, platte_frei, platte_fehler, db_bytes, raw_bytes)
           VALUES (now() - $1 * interval '1 hour', '/', $2, $3, $4, $5, $6, $7)`,
          [r.vorStunden,
           r.ohnePlatte ? null : Math.round((belegt + r.frei + 5) * G),
           r.ohnePlatte ? null : Math.round(belegt * G),
           r.ohnePlatte ? null : Math.round(r.frei * G),
           r.ohnePlatte ? 'statfs(/): ENOENT' : null,
           Math.round((r.db ?? 30) * G), Math.round((r.raw ?? 10) * G)])
      }
      const { rows } = await db.query('SELECT * FROM mart.speicher_stand')
      expect(rows.length).toBe(1)
      return rows[0]
    } finally {
      await db.query('ROLLBACK')
    }
  }

  /** Tägliche Messungen, tag 7 … 0 Tage zurück, frei(tag). */
  const taeglich = (frei: (tageZurueck: number) => number, db?: (t: number) => number) =>
    [7, 6, 5, 4, 3, 2, 1, 0].map(t => ({ vorStunden: t * 24 + 0.5, frei: frei(t), db: db?.(t) }))

  test('keine Messung: eine Zeile, keine messung, messungen 0', async () => {
    const s = await mit([])
    expect(s.befund).toBe('keine messung')
    expect(s.messungen).toBe(0)
    expect(s.befund_text).toContain('Noch keine Speichermessung')
  })

  test('gleichmäßiges Wachstum: beide Fenster gleich, Prognose stimmt', async () => {
    // 1 GB/Tag, heute 100 GB frei von 145 nutzbaren
    const s = await mit(taeglich(t => 100 + t, t => 40 - 0.8 * t))
    expect(Number(s.verbrauch_7t_gb_tag)).toBeCloseTo(1, 2)
    expect(Number(s.verbrauch_2t_gb_tag)).toBeCloseTo(1, 2)
    expect(Number(s.verbrauch_prognose_gb_tag)).toBeCloseTo(1, 2)
    expect(Number(s.db_wachstum_7t_gb_tag)).toBeCloseTo(0.8, 2)
    expect(Number(s.fenster_7t_tage)).toBeCloseTo(7, 1)
    expect(Number(s.fenster_2t_tage)).toBeCloseTo(2, 1)
    // bis voll: 100 − 14,5 = 85,5 GB → 85 Tage; bis Warnschwelle: 100 − 36,25 → 63 Tage
    expect(s.tage_bis_voll).toBe(85)
    expect(s.tage_bis_warnschwelle).toBe(63)
    expect(Number(s.voll_gb)).toBeCloseTo(14.5, 1)
    expect(s.datum_voll).not.toBeNull()
    expect(s.befund).toBe('ok')
    expect(s.befund_text).toContain('100,0 GB frei (69,0 %)')
    expect(s.befund_text).toContain('Verbrauch 1,00 GB/Tag')
  })

  test('Schub in den letzten zwei Tagen: die Prognose nimmt das 2-Tage-Fenster', async () => {
    const frei = (t: number) => (t >= 2 ? 100 - 0.2 * (7 - t) : t === 1 ? 94 : 89)
    const s = await mit(taeglich(frei))
    expect(Number(s.verbrauch_2t_gb_tag)).toBeCloseTo(5, 2)
    expect(Number(s.verbrauch_7t_gb_tag)).toBeCloseTo(11 / 7, 2)
    expect(Number(s.verbrauch_prognose_gb_tag)).toBeCloseTo(5, 2)
    // (89 − 14,5) / 5 = 14,9 Tage → hochskalieren (unter 30), obwohl 61 % frei
    expect(s.tage_bis_voll).toBe(14)
    expect(s.befund).toBe('hochskalieren')
  })

  test('kein Wachstum: kein Datum, keine Division durch null', async () => {
    const s = await mit(taeglich(() => 100))
    expect(Number(s.verbrauch_prognose_gb_tag)).toBe(0)
    expect(s.tage_bis_voll).toBeNull()
    expect(s.datum_voll).toBeNull()
    expect(s.befund).toBe('ok')
    expect(s.befund_text).toContain('kein Wachstum')
  })

  test('schrumpfende Belegung: negativer Verbrauch, kein Datum', async () => {
    const s = await mit(taeglich(t => 100 - 2 * t, t => 40 + t))
    expect(Number(s.verbrauch_prognose_gb_tag)).toBeLessThan(0)
    expect(Number(s.db_wachstum_7t_gb_tag)).toBeLessThan(0)
    expect(s.tage_bis_voll).toBeNull()
    expect(s.befund).toBe('ok')
  })

  test('eine einzige Messung: Stand ja, Verbrauch nein', async () => {
    const s = await mit([{ vorStunden: 1, frei: 99, belegt: 46, db: 38 }])
    expect(s.messungen).toBe(1)
    expect(Number(s.frei_gb)).toBe(99)
    expect(Number(s.frei_pct)).toBeCloseTo(68.3, 1)
    expect(s.verbrauch_prognose_gb_tag).toBeNull()
    expect(s.tage_bis_voll).toBeNull()
    expect(s.befund).toBe('ok')
    expect(s.befund_text).toContain('noch nicht messbar')
  })

  test('erste Woche: ohne 7 Tage alte Messung gilt die älteste ab 20 h', async () => {
    const s = await mit([{ vorStunden: 72.5, frei: 103 }, { vorStunden: 0.5, frei: 100 }])
    expect(Number(s.fenster_7t_tage)).toBeCloseTo(3, 1)
    expect(Number(s.verbrauch_7t_gb_tag)).toBeCloseTo(1, 2)
    expect(Number(s.verbrauch_2t_gb_tag)).toBeCloseTo(1, 2)
  })

  test('veraltete Messung (> 48 h): keine messung, nicht ok', async () => {
    const s = await mit([{ vorStunden: 74, frei: 100 }, { vorStunden: 50, frei: 99 }])
    expect(s.befund).toBe('keine messung')
    expect(s.befund_text).toContain('Stunden alt')
  })

  test('Platte nicht messbar: keine messung, mit Grund', async () => {
    const s = await mit([{ vorStunden: 25, frei: 100 }, { vorStunden: 1, frei: 0, ohnePlatte: true }])
    expect(s.befund).toBe('keine messung')
    expect(s.befund_text).toContain('ENOENT')
  })

  test('falsche platte: Datenbank größer als der belegte Teil', async () => {
    const s = await mit([{ vorStunden: 1, frei: 100, belegt: 45, db: 60 }])
    expect(s.befund).toBe('falsche platte')
    expect(s.befund_text).toContain('gemessen wird nicht die Platte der Datenbank')
  })

  test('beobachten: Warnschwelle in weniger als 60 Tagen', async () => {
    const s = await mit(taeglich(t => 93 + t))     // (93 − 36,25) / 1 = 56 Tage
    expect(s.tage_bis_warnschwelle).toBe(56)
    expect(s.befund).toBe('beobachten')
  })

  test('hochskalieren: unter 25 % frei, auch ohne Wachstum', async () => {
    const s = await mit(taeglich(() => 30))      // 20,7 %
    expect(s.befund).toBe('hochskalieren')
  })

  test('dringend: unter 10 % frei', async () => {
    const s = await mit(taeglich(() => 12))      // 8,3 %
    expect(s.befund).toBe('dringend')
    expect(s.tage_bis_voll).toBeNull()
  })

  test('dringend: voll in weniger als 10 Tagen, obwohl ein Drittel frei', async () => {
    const s = await mit(taeglich(t => 50 + 5 * t))   // (50 − 14,5) / 5 = 7,1 Tage
    expect(s.tage_bis_voll).toBe(7)
    expect(s.befund).toBe('dringend')
  })

  test('Prüfzeile: auffällig nur bei hochskalieren, dringend, keine messung, falsche platte', async () => {
    const zeile = async (reihe: Reihe[]) => {
      await db.query('BEGIN')
      try {
        await db.query('DELETE FROM sync.speicher_messung')
        for (const r of reihe) {
          await db.query(
            `INSERT INTO sync.speicher_messung (gemessen_am, pfad, platte_gesamt, platte_belegt, platte_frei, db_bytes, raw_bytes)
             VALUES (now() - $1 * interval '1 hour', '/', $2, $3, $4, $5, 0)`,
            [r.vorStunden, Math.round(150 * G), Math.round((145 - r.frei) * G), Math.round(r.frei * G), Math.round(30 * G)])
        }
        const { rows } = await db.query(
          `SELECT geprueft, auffaellig FROM mart.pruefung_uebersicht WHERE sicht = 'mart.speicher_stand'`)
        return rows
      } finally { await db.query('ROLLBACK') }
    }
    expect(await zeile([{ vorStunden: 1, frei: 100 }])).toEqual([{ geprueft: '1', auffaellig: '0' }])
    expect(await zeile(taeglich(t => 93 + t))).toEqual([{ geprueft: '1', auffaellig: '0' }])   // beobachten
    expect(await zeile([{ vorStunden: 1, frei: 30 }])).toEqual([{ geprueft: '1', auffaellig: '1' }])
    expect(await zeile([])).toEqual([{ geprueft: '1', auffaellig: '1' }])
  })

  test('mcp_leser liest beide Sichten, ohne sync zu sehen', async () => {
    const { rows: [m] } = await db.query(`SELECT pg_has_role(current_user, 'mcp_leser', 'MEMBER') AS ja`)
    if (!m.ja) return
    await db.query('BEGIN')
    try {
      await db.query('SET LOCAL ROLE mcp_leser')
      await db.query('SELECT * FROM mart.speicher_stand LIMIT 1')
      await db.query('SELECT * FROM mart.speicher_verlauf LIMIT 1')
      await expect(db.query('SELECT * FROM sync.speicher_messung LIMIT 1')).rejects.toThrow(/permission denied/)
    } finally { await db.query('ROLLBACK') }
  })

  test('Verlauf: Zuwachs gegen die Messung davor', async () => {
    await db.query('BEGIN')
    try {
      await db.query('DELETE FROM sync.speicher_messung')
      for (const [h, frei, dbg] of [[48, 100, 30], [24, 98, 31.5], [0, 97, 32]]) {
        await db.query(
          `INSERT INTO sync.speicher_messung (gemessen_am, pfad, platte_gesamt, platte_belegt, platte_frei, db_bytes, raw_bytes)
           VALUES (now() - $1 * interval '1 hour', '/', $2, $3, $4, $5, 0)`,
          [h, Math.round(150 * G), Math.round((145 - frei) * G), Math.round(frei * G), Math.round(dbg * G)])
      }
      const { rows } = await db.query('SELECT * FROM mart.speicher_verlauf ORDER BY gemessen_am')
      expect(rows.map(r => r.verbrauch_gb)).toEqual([null, '2.00', '1.00'])
      expect(rows.map(r => r.db_zuwachs_gb)).toEqual([null, '1.50', '0.50'])
      expect(rows.map(r => r.tage_seit_vorher)).toEqual([null, '1.00', '1.00'])
    } finally { await db.query('ROLLBACK') }
  })
})

// --- 3. Die Messung gegen die Testdatenbank ---------------------------------------

mitDb('speicherMessen gegen die Testdatenbank', () => {
  let db: Client
  beforeAll(async () => { db = new Client({ connectionString: DB }); await db.connect() })
  afterAll(async () => {
    await db?.query('DELETE FROM sync.speicher_messung WHERE lauf_id = -152')
    await db?.end()
  })

  test('schreibt eine Zeile mit Platte, Datenbank, raw, Schemata und den größten Brocken', async () => {
    const r = await speicherMessen('-152', { db })
    expect(r.status).toBe('gemessen')
    const { rows: [m] } = await db.query(
      `SELECT * FROM sync.speicher_messung WHERE lauf_id = -152 ORDER BY messung_id DESC LIMIT 1`)
    expect(m.pfad).toBe('/')
    expect(Number(m.platte_gesamt)).toBeGreaterThan(0)
    expect(Number(m.platte_frei)).toBeGreaterThan(0)
    expect(Number(m.db_bytes)).toBeGreaterThan(0)
    expect(Number(m.raw_bytes)).toBeGreaterThanOrEqual(0)
    expect(Number(m.raw_bytes)).toBeLessThanOrEqual(Number(m.db_bytes))
    expect(Object.keys(m.je_schema)).toEqual(expect.arrayContaining(['raw', 'core', 'mart', 'sync']))
    // Partitionen zählen beim Schema der Elterntabelle, nicht bei part
    expect(Object.keys(m.je_schema)).not.toContain('part')
    expect(Number(m.je_schema.raw)).toBe(Number(m.raw_bytes))
    expect(m.groesste.length).toBeGreaterThan(0)
    expect(m.groesste.length).toBeLessThanOrEqual(10)
    // Partitionen sind zusammengefasst: keine part.-Scheibe unter den Größten
    expect(m.groesste.every((g: any) => !g.relation.startsWith('part.'))).toBe(true)
    const sortiert = [...m.groesste].sort((a: any, b: any) => Number(b.bytes) - Number(a.bytes))
    expect(m.groesste).toEqual(sortiert)
  })

  test('wirft nicht, wenn statfs scheitert — die Datenbank wird trotzdem gemessen', async () => {
    const r = await speicherMessen('-152', { db, statfs: async () => { throw new Error('EACCES: kaputt') } })
    expect(r.status).toBe('ohne_platte')
    const { rows: [m] } = await db.query(
      `SELECT * FROM sync.speicher_messung WHERE lauf_id = -152 ORDER BY messung_id DESC LIMIT 1`)
    expect(m.platte_gesamt).toBeNull()
    expect(m.platte_frei).toBeNull()
    expect(m.platte_fehler).toContain('EACCES')
    expect(Number(m.db_bytes)).toBeGreaterThan(0)
  })

  test('wirft nicht bei einem unbrauchbaren Pfad', async () => {
    const r = await speicherMessen('-152', { db, pfad: '/gibt/es/sicher/nicht' })
    expect(r.status).toBe('ohne_platte')
  })
})
