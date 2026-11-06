/**
 * Wer den Zugang wie nutzt, sehen nur Eugene und Daniel (0148).
 *
 * Entschieden 06.11.2026 (Eugene): ein Nutzer sieht keine anderen Nutzer und
 * kann die Nutzung auch nicht abfragen. Bis dahin lief
 * `SELECT anzeige, sql FROM mcp.zugriff` als freie Abfrage fuer jeden durch.
 *
 * Drei Riegel, je einer hier geprueft, alle ohne Datenbank:
 *   1. der Pruefer sperrt in `mcp` alles ausser dem Katalog (Positivliste),
 *   2. das Werkzeug verlangt `darf_nutzung` und ist sonst ausgeblendet,
 *   3. keine spaetere Migration gibt `mcp_leser` das Protokoll zurueck.
 * Der eigentliche Riegel — die Rechte — steht in ausfuehren.test.ts gegen
 * die echte Rolle.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parserBereitstellen } from '../src/ast'
import { NichtErlaubt, nutzungDuerfen, type Angemeldet } from '../src/auth'
import { katalogAusJson } from '../src/katalog_laden'
import { ANSICHTEN, AuswahlFehler, bindungen, GRENZE_MAX, NUTZUNG_WERKZEUG,
         nutzungAusblenden } from '../src/nutzung'
import { MCP_KATALOG, pruefen } from '../src/pruefen'
import abzug from './katalog.json'

const katalog = katalogAusJson(abzug as any)
beforeAll(async () => { await parserBereitstellen() })

describe('Der Pruefer laesst in mcp nur den Katalog zu', () => {
  const VERWALTUNG = [
    'mcp.zugriff', 'mcp.nutzung_tag', 'mcp.wiederholte_fragen', 'mcp.anmeldung_tag',
    'mcp.nutzer_aktivitaet', 'mcp.nutzer', 'mcp.oauth_schluessel', 'mcp.verbindung_stand',
    // Eine Tabelle, die es heute nicht gibt: Positivliste heisst, sie ist gesperrt,
    // bis jemand sie freigibt.
    'mcp.irgendwas_neues',
  ]
  for (const tabelle of VERWALTUNG) {
    test(`${tabelle} ist gesperrt — mit Begruendung`, () => {
      const e = pruefen(`SELECT * FROM ${tabelle}`, katalog)
      expect(e.erlaubt).toBe(false)
      const b = e.befunde.find(x => x.schluessel === 'verwaltungsdaten')
      expect(b?.hinweis).toContain('Verwaltung des Zugangs')
    })
  }

  test('auch versteckt in einer Unterabfrage oder einem Join', () => {
    for (const sql of [
      `SELECT * FROM mart.betrieb WHERE betrieb IN (SELECT anzeige FROM mcp.zugriff)`,
      `WITH x AS (SELECT * FROM mcp.zugriff) SELECT count(*) FROM x`,
      `SELECT b.betrieb FROM mart.betrieb b JOIN mcp.nutzer_aktivitaet a ON true`,
    ]) {
      expect(pruefen(sql, katalog).befunde.map(b => b.schluessel)).toContain('verwaltungsdaten')
    }
  })

  test('ohne Schema kommt man auch nicht dran', () => {
    // search_path der Leserolle enthaelt mcp; ein Name ohne Schema wird zu
    // mart.<name> oder gesperrt (pruefen.ts, sicht_ohne_schema).
    expect(pruefen(`SELECT * FROM zugriff`, katalog).erlaubt).toBe(false)
  })

  test('der Katalog bleibt lesbar', () => {
    for (const t of MCP_KATALOG) {
      const e = pruefen(`SELECT * FROM ${t} LIMIT 1`, katalog)
      expect({ t, gesperrt: e.befunde.some(b => b.schluessel === 'verwaltungsdaten') })
        .toEqual({ t, gesperrt: false })
    }
  })

  test('die alten mart.mcp_*-Sichten stehen nicht mehr im Katalog', () => {
    for (const s of ['mart.mcp_nutzung', 'mart.mcp_wiederholte_fragen', 'mart.mcp_anmeldung']) {
      expect(katalog.sichten.has(s)).toBe(false)
    }
  })
})

describe('Das Werkzeug nur mit darf_nutzung', () => {
  const konto = (darfNutzung: boolean): Angemeldet =>
    ({ subject: 'x', anzeige: 'X', stufe: 'fragen', client: null, darfNutzung })

  test('ohne Freigabe: NichtErlaubt, ohne Daten zu nennen', () => {
    expect(() => nutzungDuerfen(konto(false))).toThrow(NichtErlaubt)
  })
  test('mit Freigabe: durch', () => {
    expect(() => nutzungDuerfen(konto(true))).not.toThrow()
  })

  test('ohne Anmeldung ist es aus der Werkzeugliste verschwunden — die anderen bleiben', async () => {
    const liste = { tools: [{ name: 'datenstand' }, { name: NUTZUNG_WERKZEUG }, { name: 'round_table' }] }
    const r = await nutzungAusblenden({}, {}, async () => liste)
    expect(r.tools.map(t => t.name)).toEqual(['datenstand', 'round_table'])
  })
})

describe('Die Auswahl wird geprueft, bevor sie Abfrage wird', () => {
  test('jede Ansicht hat genau so viele Werte, wie Platzhalter darin stehen', () => {
    for (const ansicht of ANSICHTEN) {
      const { sql, werte } = bindungen({ ansicht })
      const nummern = [...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1]))
      expect({ ansicht, n: Math.max(...nummern) }).toEqual({ ansicht, n: werte.length })
    }
  })

  test('das Konto wird Wert, nicht SQL', () => {
    const { sql, werte } = bindungen({ ansicht: 'konten', konto: "x' OR 1=1 --" })
    expect(sql).not.toContain('OR 1=1')
    expect(werte).toContain("x' OR 1=1 --")
  })

  test('falsches Datum, unbekannte Ansicht und unbekanntes Raster werden abgewiesen', () => {
    expect(() => bindungen({ ansicht: 'konten', von: 'gestern' })).toThrow(AuswahlFehler)
    expect(() => bindungen({ ansicht: 'alles' as any })).toThrow(AuswahlFehler)
    expect(() => bindungen({ ansicht: 'verlauf', raster: 'jahr' as any })).toThrow(AuswahlFehler)
  })

  test('die Zeilengrenze wird geklemmt', () => {
    expect(bindungen({ ansicht: 'aufrufe', grenze: 100_000 }).werte.at(-1)).toBe(GRENZE_MAX)
    expect(bindungen({ ansicht: 'aufrufe', grenze: -5 }).werte.at(-1)).toBe(1)
  })
})

/**
 * 0110 hat die Rechte der Leserolle als ganze Liste neu vergeben, mit
 * mcp.zugriff darin. Wer diesen Block in eine kuenftige Migration kopiert,
 * oeffnet das Protokoll wieder fuer alle — mart.mcp_rechte_pruefung meldet
 * es erst nach dem Deploy. Dieser Test meldet es vorher.
 */
describe('Keine Migration nach 0148 gibt der Leserolle die Nutzung zurueck', () => {
  const ordner = join(import.meta.dir, '..', '..', 'migrations')
  const spaeter = readdirSync(ordner).filter(f => /^\d{4}_/.test(f) && f >= '0148')
  const GESCHUETZT = /mcp\.(zugriff|nutzung_tag|wiederholte_fragen|anmeldung_tag|nutzer_aktivitaet)\b/

  test('in keinem GRANT an mcp_leser steht ein geschuetztes Objekt', () => {
    const treffer: string[] = []
    for (const f of spaeter) {
      const text = readFileSync(join(ordner, f), 'utf8')
      for (const grant of text.match(/GRANT[\s\S]*?TO\s+mcp_leser/gi) ?? []) {
        if (GESCHUETZT.test(grant) || /ALL\s+TABLES\s+IN\s+SCHEMA[^;]*\bmcp\b/i.test(grant)) {
          treffer.push(`${f}: ${grant.replace(/\s+/g, ' ').slice(0, 120)}`)
        }
      }
    }
    expect(treffer).toEqual([])
  })
})
