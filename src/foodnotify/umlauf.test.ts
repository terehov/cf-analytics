/**
 * Der verteilte Umlauf der Rezepte (0134, docs/entscheidungen.md 19.10.2026).
 *
 * Teil 1 läuft immer: die 16 Tage in mart.rezept_stand.ueberfaellig müssen
 * REZEPT_UMLAUF_TAGE + 2 sein — die Sicht kennt die Umgebungsvariable nicht.
 *
 * Teil 2 braucht TEST_DATABASE_URL (Stand ≥ 0134) und simuliert Nächte gegen
 * sync.rezept_umlauf_faellig — dieselbe Funktion, die rezepteNachfuellen()
 * aufruft. Nur eine TEMP-Tabelle, kein TRUNCATE, nichts Bleibendes.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'

const UMLAUF = 14

describe('Umlauf: Konstanten', () => {
  test('ueberfaellig in mart.rezept_stand = REZEPT_UMLAUF_TAGE + 2', () => {
    const sql = readFileSync(join(import.meta.dir, '../../migrations/0134_rezept_frische_und_umlauf_verteilt.sql'), 'utf8')
    const m = sql.match(/zutaten_geholt_am < \(now\(\) - '(\d+) days'::interval\)/)
    expect(m).not.toBeNull()
    // Der Standardwert aus src/config.ts — gelesen, nicht importiert (config prüft die Umgebung).
    const cfg = readFileSync(join(import.meta.dir, '../config.ts'), 'utf8')
    const d = cfg.match(/REZEPT_UMLAUF_TAGE: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.default\((\d+)\)/)
    expect(d).not.toBeNull()
    expect(Number(d![1])).toBe(UMLAUF)
    expect(Number(m![1])).toBe(UMLAUF + 2)
  })
})

const DB = process.env.TEST_DATABASE_URL
const lauf = DB ? describe : describe.skip

lauf('Umlauf: Nächte simuliert gegen sync.rezept_umlauf_faellig', () => {
  let db: Client

  beforeAll(async () => {
    db = new Client({ connectionString: DB })
    await db.connect()
    await db.query(`CREATE TEMP TABLE r (fn_id bigint PRIMARY KEY, geholt timestamptz)`)
    // 140 Rezepte, fortlaufende IDs wie bei FoodNotify, alle im selben ersten
    // Abzug gelesen — der Fall vom 15./16.10.2026.
    await db.query(
      `INSERT INTO r SELECT 1032000 + i, TIMESTAMP '2026-10-15 06:00' AT TIME ZONE 'Europe/Berlin'
         FROM generate_series(0, 139) i`)
  })
  afterAll(async () => { await db?.end() })

  /** Eine Nacht: um 05:02 nachfüllen, eine Stunde später gelesen. Liefert die Zahl der fälligen. */
  const nacht = async (tag: number) => {
    const { rows } = await db.query<{ fn_id: string }>(
      `WITH j AS (SELECT (DATE '2026-10-15' + $1::int + TIME '05:02') AT TIME ZONE 'Europe/Berlin' AS jetzt)
       UPDATE r SET geholt = j.jetzt + interval '1 hour'
         FROM j
        WHERE sync.rezept_umlauf_faellig(r.fn_id, r.geholt, j.jetzt, $2)
       RETURNING r.fn_id`, [tag, UMLAUF])
    return rows.length
  }
  /**
   * Ältester Abruf in Tagen, gemessen zum Nachfüllzeitpunkt des Tages — nach
   * der Wanduhr in Berlin: über das Ende der Sommerzeit hinweg sind 15
   * Kalendertage 15 Tage und eine Stunde.
   */
  const aeltester = async (tag: number) => {
    const { rows: [a] } = await db.query<{ tage: number }>(
      `SELECT extract(epoch FROM (DATE '2026-10-15' + $1::int + TIME '05:02')
                                 - min(geholt AT TIME ZONE 'Europe/Berlin')) / 86400.0 AS tage FROM r`, [tag])
    return Number(a.tage)
  }

  test('140 gleich alte Rezepte: je Tag 10, nach Umlauf + 1 Tagen keines älter', async () => {
    const je: number[] = []
    for (let tag = 1; tag <= UMLAUF + 1; tag++) {
      expect(await aeltester(tag)).toBeLessThanOrEqual(UMLAUF + 1)
      je.push(await nacht(tag))
    }
    // Tag 1: der Abruf ist keinen ganzen Tag alt — die Gruppe dieses Tages
    // rastet an Tag 15 ein (sein Tag UND älter als der Umlauf zugleich).
    expect(je).toEqual([0, ...Array(UMLAUF).fill(10)])
    expect(await aeltester(UMLAUF + 2)).toBeLessThan(UMLAUF)
    // Nach Tag 15: alle 140 einmal gelesen, keines älter als Umlauf + 1 Tage.
    const { rows: [n] } = await db.query(
      `SELECT count(*)::int AS n FROM r WHERE geholt > TIMESTAMPTZ '2026-10-16 00:00+02'`)
    expect(n.n).toBe(140)

    // Und es bleibt verteilt: der zweite Zyklus (über das Ende der Sommerzeit am 25.10.).
    for (let tag = UMLAUF + 2; tag <= 2 * UMLAUF + 1; tag++) {
      expect(await nacht(tag)).toBe(10)
      expect(await aeltester(tag + 1)).toBeLessThanOrEqual(UMLAUF + 1)
    }
  })

  test('eine ausgefallene Nacht wird am Folgetag nachgeholt, nicht einen Zyklus später', async () => {
    const aus = 2 * UMLAUF + 2         // diese Nacht läuft kein Sync
    const folge = aus + 1
    expect(await nacht(folge)).toBe(20) // die eigene Gruppe und die ausgefallene
    expect(await aeltester(folge + 1)).toBeLessThanOrEqual(UMLAUF + 1)
    // Danach wieder 10 je Nacht — die nachgeholte Gruppe rastet an ihrem Tag ein.
    for (let tag = folge + 1; tag <= folge + UMLAUF + 1; tag++) {
      expect(await nacht(tag)).toBe(10)
      expect(await aeltester(tag + 1)).toBeLessThanOrEqual(UMLAUF + 1)
    }
  })

  test('nie geholt ist der erste Abzug, nicht der Umlauf', async () => {
    const { rows: [f] } = await db.query(
      `SELECT sync.rezept_umlauf_faellig(1032000, NULL, now(), 14) AS f`)
    expect(f.f).toBe(false)
  })
})
