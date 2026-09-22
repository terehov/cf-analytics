/**
 * Frischt die beiden materialisierten Sichten der Betriebsberichte auf
 * (Migration 0117) — in Phase B und noch einmal nach Phase C.
 *
 *   mart.finanzweg_monat_basis           Finanzwege je Betrieb und Monat (88/97)
 *   mart.betriebsbericht_ladestand_basis welcher Zeitraum je Bericht geladen ist
 *
 * WARUM MATERIALISIERT. Gemessen am 23.09.2026 auf einem Klon in
 * Produktionsgroesse (10,4 Mio. Finanzwegzeilen, 454.626 Abrufzeilen,
 * synthetisch auf den 152.782 echten Betrieb-Tagen): der Zahlungsmix einer
 * Marke ueber zwoelf Monate brauchte 2,6 s, der Ladestand 10,9 s — und den
 * haengt der MCP-Server an JEDE Antwort auf eine Kassensicht. Materialisiert:
 * 10 ms fuer den Ladestand, Refresh 32,9 s und 13,9 s nebenlaeufig.
 *
 * WARUM ZWEIMAL. Beide lesen, was die Betriebsberichte schreiben. Die
 * laufenden Berichte kommen in Phase A (danach Phase B), die Historie in
 * Phase C — ohne den zweiten Refresh stuende der Backfill einer Nacht erst
 * am naechsten Morgen im Ladestand, und der Ladestand saehe den ganzen Tag
 * einen Monat "nicht geladen", der laengst da ist. Nach Phase C nur, wenn C
 * ueberhaupt Posten bearbeitet hat (`c.posten > 0`): auch ein "keine Daten"
 * aendert den Ladestand (0117, betriebe_leer).
 *
 * Dieselben zwei Regeln wie round_table.ts und vergleichstag.ts:
 *   1. Wirft NIE. Ein misslungener Refresh heisst: veraltete Zahl, sichtbar
 *      in mart.materialisierung_stand — kein verlorener Import.
 *   2. Laeuft NACH dem Import, sonst waere es der alte Stand, neu geschrieben.
 */
import { log } from '../lib/log'
import { pool, query } from '../db/pool'
import { sichtAuffrischen } from './auffrischen'

/** Reihenfolge ohne Abhaengigkeit — beide lesen core, keine liest die andere. */
const SICHTEN = ['mart.finanzweg_monat_basis', 'mart.betriebsbericht_ladestand_basis'] as const

/** Notnagel gegen stille Blockaden, keine erwartete Laufzeit (gemessen 47 s zusammen). */
const ZEITGRENZE_MS = 15 * 60 * 1000

export type BetriebsberichtAuffrischung = {
  status: 'aufgefrischt' | 'fehler'
  dauerS: number
  meldung?: string
}

export async function betriebsberichtSichtenAuffrischen(): Promise<BetriebsberichtAuffrischung> {
  const t0 = Date.now()
  const client = await pool.connect()
  try {
    await client.query(`SET statement_timeout = ${ZEITGRENZE_MS}`)
    const nebenlaeufig: Record<string, boolean> = {}
    for (const s of SICHTEN) nebenlaeufig[s] = await sichtAuffrischen(client, s)
    const dauerS = Math.round((Date.now() - t0) / 100) / 10
    await query(
      `INSERT INTO sync.merker (schluessel, wert)
       VALUES ('betriebsbericht_sichten_refresh',
               jsonb_build_object('dauer_s', $1::numeric, 'nebenlaeufig', $2::jsonb))
       ON CONFLICT (schluessel)
       DO UPDATE SET wert = EXCLUDED.wert, gesetzt_am = now()`,
      [dauerS, JSON.stringify(nebenlaeufig)])
    return { status: 'aufgefrischt', dauerS }
  } catch (e) {
    return { status: 'fehler', dauerS: Math.round((Date.now() - t0) / 100) / 10, meldung: String(e) }
  } finally {
    try { await client.query(`SET statement_timeout = 0`) } catch { /* egal */ }
    client.release()
  }
}

/** Der Aufruf fuer den Nachlauf: frischt auf und protokolliert, ohne je zu werfen. */
export async function betriebsberichtSichtenNachlauf(): Promise<void> {
  const r = await betriebsberichtSichtenAuffrischen()
  if (r.status === 'aufgefrischt') {
    log.info('Sichten der Betriebsberichte aufgefrischt', { dauer_s: r.dauerS })
  } else {
    // ERROR, nicht WARN — siehe pflichtartikel_sichten.ts (10.09.2026).
    log.error('Sichten der Betriebsberichte nicht aufgefrischt', { grund: r.meldung, dauer_s: r.dauerS })
  }
}
