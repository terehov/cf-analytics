/**
 * Frischt mart.round_table_monat und mart.round_table_trend auf — als
 * Nachlauf jedes Sync-Laufs.
 *
 * WARUM DIE SICHTEN MATERIALISIERT SIND
 *
 * Beide rechneten bei JEDEM Kartenaufruf drei LATERAL-Unterabfragen über
 * 141 Betriebe × 104 Monate (round_table_monat) bzw. Fensterfunktionen über
 * die 88.000 Zeilen der langen Form (round_table_trend). Auf ② Filialen und
 * ③ Betrieb hieß das am 03.08.2026 gemessen 8 bis 16 Sekunden für die
 * Kopftabelle und sieben Karten über 5 Sekunden. Als Tabellen sind es 14.664
 * bzw. 88.000 Zeilen. Begründung und Messwerte in
 * migrations/0039_betriebsstatus_und_plausibilitaet.sql.
 *
 * REIHENFOLGE: erst round_table_monat, dann round_table_trend — der Trend
 * liest über mart.ampel_bereich aus der Monats-Materialisierung. Andersherum
 * verglichen die Pfeile einen frischen Vormonat mit einem alten Monat.
 *
 * Dieselben zwei Regeln wie bei deckungsbeitrag.ts nebenan:
 *   1. Das hier darf einen Sync-Lauf NIEMALS scheitern lassen — ein
 *      misslungener Refresh bedeutet veraltete Urteile, nicht verlorene
 *      Daten. Die Funktion fängt alles und wirft nie.
 *   2. Es läuft NACH dem Import; vorher wäre es der alte Stand, neu
 *      geschrieben.
 */
import { log } from '../lib/log'
import { pool, query } from '../db/pool'

/**
 * CONCURRENTLY, damit niemand während des Neuaufbaus vor einem sperrenden
 * Dashboard sitzt. Die dafür nötigen eindeutigen Indizes liegen in
 * Migration 0039.
 */
const REFRESHES = [
  `REFRESH MATERIALIZED VIEW CONCURRENTLY mart.round_table_monat`,
  `REFRESH MATERIALIZED VIEW CONCURRENTLY mart.round_table_trend`,
]

/** Beide zusammen liegen bei Sekunden, nicht Minuten — die Grenze ist ein
 *  Notnagel gegen stille Blockaden, keine erwartete Laufzeit. */
const ZEITGRENZE_MS = 5 * 60 * 1000

export type Auffrischung = {
  status: 'aufgefrischt' | 'fehler'
  dauerS: number
  meldung?: string
}

/** Frischt beide Sichten auf. Wirft nie — Regel 1 oben. */
export async function roundTableAuffrischen(): Promise<Auffrischung> {
  const t0 = Date.now()
  // Eigene Verbindung statt query() aus db/pool — dieselben zwei Gründe wie
  // in deckungsbeitrag.ts: SET statement_timeout gilt je Sitzung, und ein
  // halb durchgelaufener REFRESH soll nicht automatisch wiederholt werden.
  const client = await pool.connect()
  try {
    await client.query(`SET statement_timeout = ${ZEITGRENZE_MS}`)
    for (const refresh of REFRESHES) await client.query(refresh)

    const dauerS = Math.round((Date.now() - t0) / 100) / 10
    await query(
      `INSERT INTO sync.merker (schluessel, wert)
       VALUES ('round_table_refresh', jsonb_build_object('dauer_s', $1::numeric))
       ON CONFLICT (schluessel)
       DO UPDATE SET wert = EXCLUDED.wert, gesetzt_am = now()`,
      [dauerS])

    return { status: 'aufgefrischt', dauerS }
  } catch (e) {
    return {
      status: 'fehler',
      dauerS: Math.round((Date.now() - t0) / 100) / 10,
      meldung: String(e),
    }
  } finally {
    try { await client.query(`SET statement_timeout = 0`) } catch { /* egal */ }
    client.release()
  }
}

/** Der Aufruf für den Nachlauf: frischt auf und protokolliert, ohne je zu werfen. */
export async function roundTableNachlauf(): Promise<void> {
  const r = await roundTableAuffrischen()
  if (r.status === 'aufgefrischt') {
    log.info('Round Table aufgefrischt', { dauer_s: r.dauerS })
  } else {
    log.warn('Round Table nicht aufgefrischt', { grund: r.meldung, dauer_s: r.dauerS })
  }
}
