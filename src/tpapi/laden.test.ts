/**
 * Der TPAPI-Lader — zwei Teile.
 *
 * TEIL 1, ohne Datenbank: die Zerlegung der Antwort (`form.ts`). Alles davon
 * ist von der Sorte, die keinen Fehler wirft, sondern eine falsche Zahl
 * liefert: ein nicht gerundetes `161.42000000000002`, eine fehlende Seite
 * als 0 statt NULL, ein leerer Tag, der als Formfehler endet und deshalb
 * jede Nacht neu geholt wird.
 *
 * TEIL 2, nur mit TEST_DATABASE_URL (Stand ≥ 0149, eine EIGENE Testdatenbank,
 * nie die, auf die DATABASE_URL zeigt): `raw` ohne `kostUser`, ein erneuter
 * Abruf ersetzt den Tag vollständig, die Abrufzeile zählt hoch. Immer die
 * ganze Datei einzeln laufen lassen — die Notbremse sitzt im beforeAll:
 *
 *   TEST_DATABASE_URL=postgresql://localhost/<klon> bun test src/tpapi/laden.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { FormFehler, ohnePersonenbezug, stundenAusAntwort } from './form'
import { vorgabeAntwort } from './mock'
import type { TpapiAntwort } from './client'

describe('stundenAusAntwort', () => {
  test('rundet auf Cent — das gemessene Rauschen 161.42000000000002 wird 161.42', () => {
    const f = stundenAusAntwort({ eff: { '9': 12 }, kost: { '9': 161.42000000000002 } })
    expect(f.stunden).toEqual([{ stunde: 9, personen: '12.00', personalkosten: '161.42' }])
    expect(f.personalkosten).toBe('161.42')
    expect(f.leer).toBe(false)
  })

  test('kaufmännisch auf zwei Stellen, Summe aus den gerundeten Einzelwerten', () => {
    const f = stundenAusAntwort({
      eff: { '10': 1, '11': 1, '12': 1 },
      kost: { '10': 0.105, '11': 0.104, '12': 10.999 },
    })
    expect(f.stunden.map(s => s.personalkosten)).toEqual(['0.11', '0.10', '11.00'])
    // 0.11 + 0.10 + 11.00 — nicht round(0.105 + 0.104 + 10.999) = 11.21
    expect(f.personalkosten).toBe('11.21')
    expect(f.personenstunden).toBe('3.00')
  })

  test('Stunde nur in kost oder nur in eff: die andere Seite ist NULL, nicht 0', () => {
    const f = stundenAusAntwort({ eff: { '3': 2 }, kost: { '2': 20.5 } })
    expect(f.stunden).toEqual([
      { stunde: 2, personen: null, personalkosten: '20.50' },
      { stunde: 3, personen: '2.00', personalkosten: null },
    ])
    expect(f.personenstunden).toBe('2.00')
    expect(f.personalkosten).toBe('20.50')
  })

  test('fehlende Stunden fehlen — es entstehen keine Nullzeilen', () => {
    const f = stundenAusAntwort({ eff: { '8': 6, '23': 1 }, kost: { '8': 65.18, '23': 9 } })
    expect(f.stunden.map(s => s.stunde)).toEqual([8, 23])
  })

  test('die Nachtstunden bleiben am Tag — sortiert nach Uhrzeit, nichts umgerechnet', () => {
    const f = stundenAusAntwort({ eff: { '1': 2, '0': 3, '22': 4 }, kost: { '1': 1, '0': 1, '22': 1 } })
    expect(f.stunden.map(s => s.stunde)).toEqual([0, 1, 22])
  })

  test('leer in jeder Form, die PHP liefern kann', () => {
    for (const d of [
      { eff: {}, kost: {}, kostUser: {} },
      { eff: [], kost: [], kostUser: [] },
      {},
      { eff: null, kost: null },
      [],
    ]) {
      const f = stundenAusAntwort(d)
      expect(f).toEqual({ stunden: [], personenstunden: '0.00', personalkosten: '0.00', leer: true })
    }
  })

  test('eine Liste mit Stunde als Index (PHP-Array ohne Lücke ab 0)', () => {
    const f = stundenAusAntwort({ eff: [1, 2], kost: [10, 20.004] })
    expect(f.stunden).toEqual([
      { stunde: 0, personen: '1.00', personalkosten: '10.00' },
      { stunde: 1, personen: '2.00', personalkosten: '20.00' },
    ])
  })

  test('Zahlen als Text werden gelesen, null-Werte übergangen', () => {
    const f = stundenAusAntwort({ eff: { '9': '4', '10': null }, kost: { '9': '50.5' } })
    expect(f.stunden).toEqual([{ stunde: 9, personen: '4.00', personalkosten: '50.50' }])
  })

  test('die Vorgabe der Attrappe: 15 Stunden, darunter 0 und 1 Uhr', () => {
    const f = stundenAusAntwort(vorgabeAntwort('03.11.2026'))
    expect(f.stunden).toHaveLength(15)
    expect(f.stunden.find(s => s.stunde === 9)?.personalkosten).toBe('161.42')
  })

  test('was nicht passt, ist ein FormFehler — und nennt keinen Wert', () => {
    const faelle: unknown[] = [
      null, 'text', [1],
      { eff: 'x' },
      { eff: { '24': 1 } },
      { eff: { abc: 1 } },
      { kost: { '9': 'viel' } },
      { eff: { '9': 12_345 } },           // sprengt numeric(6,2)
      { kost: { '9': 1e9 } },             // sprengt numeric(10,2)
    ]
    for (const d of faelle) expect(() => stundenAusAntwort(d)).toThrow(FormFehler)
  })
})

describe('ohnePersonenbezug', () => {
  test('kostUser fällt heraus, eff und kost bleiben', () => {
    expect(ohnePersonenbezug(vorgabeAntwort('03.11.2026'))).toEqual({
      eff: vorgabeAntwort('03.11.2026').eff, kost: vorgabeAntwort('03.11.2026').kost,
    })
  })

  test('auch ein künftiges Feld je Person (…User), aber kein neues Feld auf Betriebsebene', () => {
    expect(ohnePersonenbezug({ eff: {}, effUser: { x: 1 }, kostUser: {}, summe: 3 }))
      .toEqual({ eff: {}, summe: 3 })
  })

  test('Fehlerantworten und Listen bleiben, wie sie sind', () => {
    const f = { status: 'error', message: "Module 'Personal' not licensed" }
    expect(ohnePersonenbezug(f)).toEqual(f)
    expect(ohnePersonenbezug([])).toEqual([])
    expect(ohnePersonenbezug(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Teil 2: mit Datenbank
// ---------------------------------------------------------------------------

const DB = process.env.TEST_DATABASE_URL
if (DB && process.env.DATABASE_URL && DB === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL zeigt auf dieselbe Datenbank wie DATABASE_URL — '
    + 'eine eigene Testdatenbank anlegen.')
}
const mitDb = DB ? describe : describe.skip

mitDb('tagLaden (mit Datenbank)', () => {
  const ENC = 'e1'.repeat(20)
  const TAG = '2026-11-03'
  let db: import('pg').Client
  let tagLaden: typeof import('./laden').tagLaden
  let betriebKey: number

  const ok = (daten: unknown): TpapiAntwort =>
    ({ art: 'ok', status: 200, daten, roh: JSON.stringify(daten), meldung: null })

  const kern = async () => {
    const { rows } = await db.query(
      `SELECT stunde, personen::text, personalkosten::text, raw_id::text
         FROM core.personalkosten_stunde WHERE betrieb_key = $1 AND geschaeftstag = $2 ORDER BY stunde`,
      [betriebKey, TAG])
    return rows
  }
  const abruf = async () => (await db.query(
    `SELECT stunden, personenstunden::text, personalkosten::text, raw_id::text, abrufe
       FROM core.personalkosten_stunde_abruf WHERE betrieb_key = $1 AND geschaeftstag = $2`,
    [betriebKey, TAG])).rows[0]
  const roh = async (id: string) => (await db.query(
    `SELECT quelle, endpunkt, betrieb_enc_id, zeitraum_von::text, zeitraum_bis::text, parameter,
            http_status, payload, payload_text, payload_hash, payload_bytes
       FROM raw.api_antwort WHERE id = $1`, [id])).rows[0]

  beforeAll(async () => {
    process.env.DATABASE_URL = DB!
    process.env.LOG_LEVEL ??= 'error'
    const { config } = await import('../config')
    if (config.DATABASE_URL !== DB) {
      throw new Error('config wurde vorher mit einer anderen DATABASE_URL geladen — '
        + 'diese Datei einzeln starten: bun test src/tpapi/laden.test.ts')
    }
    tagLaden = (await import('./laden')).tagLaden
    const { Client } = await import('pg')
    db = new Client({ connectionString: DB })
    await db.connect()
    const { rows: [b] } = await db.query(
      `INSERT INTO core.betrieb (enc_id, name) VALUES ($1, 'Test TPAPI Lader')
       ON CONFLICT (enc_id) DO UPDATE SET name = excluded.name RETURNING betrieb_key`, [ENC])
    betriebKey = Number(b.betrieb_key)
    await db.query(`DELETE FROM core.personalkosten_stunde WHERE betrieb_key = $1`, [betriebKey])
    await db.query(`DELETE FROM core.personalkosten_stunde_abruf WHERE betrieb_key = $1`, [betriebKey])
  })

  afterAll(async () => {
    if (db) {
      await db.query(`DELETE FROM core.personalkosten_stunde WHERE betrieb_key = $1`, [betriebKey])
      await db.query(`DELETE FROM core.personalkosten_stunde_abruf WHERE betrieb_key = $1`, [betriebKey])
      await db.end()
    }
    const { pool } = await import('../db/pool')
    await pool.end()
  })

  test('200: raw OHNE kostUser, core je Stunde auf Cent, Abrufzeile mit abrufe = 1', async () => {
    const r = await tagLaden(ok(vorgabeAntwort('03.11.2026')), betriebKey, ENC, TAG, null)
    expect(r.ergebnis).toBe('geladen')
    expect(r.stunden).toBe(15)

    const x = await roh(r.rawId!)
    expect(x).toMatchObject({
      quelle: 'tpapi', endpunkt: 'tpapi:personalkostenprostunde', betrieb_enc_id: ENC,
      zeitraum_von: TAG, zeitraum_bis: TAG, parameter: { businessdate: '03.11.2026' },
      http_status: 200, payload_text: null,
    })
    expect(Object.keys(x.payload).sort()).toEqual(['eff', 'kost'])
    expect(JSON.stringify(x.payload)).not.toContain('ma1000')
    expect(x.payload_hash).toMatch(/^[0-9a-f]{64}$/)

    const k = await kern()
    expect(k).toHaveLength(15)
    expect(k.find(s => s.stunde === 9)).toMatchObject({ personen: '12.00', personalkosten: '161.42' })
    expect(k.every(s => s.raw_id === r.rawId)).toBe(true)
    expect(await abruf()).toMatchObject({ stunden: 15, abrufe: 1, raw_id: r.rawId })
  })

  test('ein erneuter Abruf ersetzt den Tag VOLLSTÄNDIG — keine Stunde aus dem Vorabruf bleibt', async () => {
    const r = await tagLaden(ok({ eff: { '10': 3 }, kost: { '10': 40.1 }, kostUser: { '10': { ma1: 40.1 } } }),
      betriebKey, ENC, TAG, null)
    expect(r.ergebnis).toBe('geladen')
    expect(await kern()).toEqual([{ stunde: 10, personen: '3.00', personalkosten: '40.10', raw_id: r.rawId }])
    expect(await abruf()).toEqual({
      stunden: 1, personenstunden: '3.00', personalkosten: '40.10', raw_id: r.rawId, abrufe: 2,
    })
  })

  test('ein leerer Tag leert core und wird als geholt vermerkt (D5)', async () => {
    const r = await tagLaden(ok({ eff: {}, kost: {}, kostUser: {} }), betriebKey, ENC, TAG, null)
    expect(r.ergebnis).toBe('leer')
    expect(await kern()).toEqual([])
    expect(await abruf()).toMatchObject({ stunden: 0, personenstunden: '0.00', personalkosten: '0.00', abrufe: 3 })
  })

  test('403: nur raw, core und Abrufzeile unberührt', async () => {
    const f = { status: 'error', message: "Module 'Personal' not licensed" }
    const r = await tagLaden({ art: 'nicht_lizenziert', status: 403, daten: f, roh: JSON.stringify(f),
      meldung: "HTTP 403 — Module 'Personal' not licensed" }, betriebKey, ENC, TAG, null)
    expect(r.ergebnis).toBe('nur_raw')
    expect((await roh(r.rawId!))).toMatchObject({ http_status: 403, payload: f })
    expect(await abruf()).toMatchObject({ abrufe: 3, stunden: 0 })
  })

  test('500 mit HTML: raw mit der Meldung als Text', async () => {
    const r = await tagLaden({ art: 'fehler', status: 500, daten: null, roh: '<html>boom</html>',
      meldung: 'HTTP 500 — <html>boom</html>' }, betriebKey, ENC, TAG, null)
    expect(r.ergebnis).toBe('nur_raw')
    expect(await roh(r.rawId!)).toMatchObject({ payload: null, payload_text: 'HTTP 500 — <html>boom</html>' })
  })

  test('200 in unbekannter Form: der Rohsatz bleibt, der Tag wird nicht angefasst', async () => {
    await tagLaden(ok({ eff: { '11': 2 }, kost: { '11': 20 } }), betriebKey, ENC, TAG, null)
    const r = await tagLaden(ok({ eff: { '99': 1 } }), betriebKey, ENC, TAG, null)
    expect(r.ergebnis).toBe('formfehler')
    expect(r.meldung).toContain('0–23')
    expect(await roh(r.rawId!)).toMatchObject({ http_status: 200, payload: { eff: { '99': 1 } } })
    expect((await kern()).map(s => s.stunde)).toEqual([11])
  })

  test('ohne Antwort (Netz): nichts geschrieben', async () => {
    const r = await tagLaden({ art: 'fehler', status: 0, daten: null, roh: '', meldung: 'Netzfehler' },
      betriebKey, ENC, TAG, null)
    expect(r).toEqual({ rawId: null, ergebnis: 'ohne_antwort', stunden: 0 })
  })
})
