/**
 * Frischt mart.vergleichstag_basis auf — als Nachlauf jedes Sync-Laufs.
 *
 * WARUM DIE SICHT MATERIALISIERT IST
 *
 * mart.vergleichstag lag seit Migration 0051 in der Datenbank und wurde von
 * keiner einzigen Karte gelesen. Der Grund stand im Kommentar der Sicht
 * selbst: sie rechnete je Zeile vier Nachbartage nach und war nur mit Filter
 * benutzbar — eine Kachel über alle Betriebe gab es damit nie.
 *
 * Nachgemessen am 20.08.2026 über 188.640 Zeilen: die LATERAL-Fassung wurde
 * nach zehn Minuten abgebrochen, der Umbau auf Fensterfunktion und
 * Kumulierung braucht 33,1 s kalt und 35,2 s warm. Begründung und die
 * Gegenprobe stehen in migrations/0084_vergleichstag_materialisiert.sql,
 * abgesichert ist sie in vergleichstag.test.ts.
 *
 * REIHENFOLGE: NACH pflegeNachlauf(). Der schreibt die Feiertage, aus denen
 * diese Sicht liest — andersherum trüge die Materialisierung den
 * Kalenderstand vom Vortag. Dieselbe Falle, die yextNachlauf() bis zum
 * 14.08.2026 hatte.
 *
 * Dieselben zwei Regeln wie bei round_table.ts nebenan:
 *   1. Das hier darf einen Sync-Lauf NIEMALS scheitern lassen — ein
 *      misslungener Refresh bedeutet einen veralteten Vergleichstag, nicht
 *      verlorene Daten. Die Funktion fängt alles und wirft nie.
 *   2. Es läuft NACH dem Import; vorher wäre es der alte Stand, neu
 *      geschrieben.
 */
import { log } from '../lib/log'
import { pool, query } from '../db/pool'
import { sichtAuffrischen } from './auffrischen'

/**
 * CONCURRENTLY, damit niemand während des Neuaufbaus vor einem sperrenden
 * Dashboard sitzt. Der dafür nötige eindeutige Index liegt in Migration 0084.
 */
const SICHT = 'mart.vergleichstag_basis'

/**
 * Gemessen 35 s über 188.640 Zeilen; bei geschlossener Standortlücke etwa
 * das 2,4-Fache der Zeilen. Die Grenze ist ein Notnagel gegen stille
 * Blockaden, keine erwartete Laufzeit.
 */
const ZEITGRENZE_MS = 10 * 60 * 1000

/**
 * Der Sonderfall „nie befüllt" (PG 55000) steckt seit dem 20.08.2026 in
 * sync/auffrischen.ts — er stand hier zuerst, weil genau daran der
 * Ende-zu-Ende-Test nach 0080 hängengeblieben ist, und fehlte den drei
 * Nachläufen nebenan. Jetzt teilen sich alle vier einen Weg.
 */

export type Auffrischung = {
  status: 'aufgefrischt' | 'fehler'
  dauerS: number
  nebenlaeufig?: boolean
  meldung?: string
}

/** Frischt die Sicht auf. Wirft nie — Regel 1 oben. */
export async function vergleichstagAuffrischen(): Promise<Auffrischung> {
  const t0 = Date.now()
  // Eigene Verbindung statt query() aus db/pool — dieselben zwei Gründe wie
  // in round_table.ts: SET statement_timeout gilt je Sitzung, und ein halb
  // durchgelaufener REFRESH soll nicht automatisch wiederholt werden.
  const client = await pool.connect()
  let nebenlaeufig = true
  try {
    await client.query(`SET statement_timeout = ${ZEITGRENZE_MS}`)
    nebenlaeufig = await sichtAuffrischen(client, SICHT)

    const dauerS = Math.round((Date.now() - t0) / 100) / 10
    await query(
      `INSERT INTO sync.merker (schluessel, wert)
       VALUES ('vergleichstag_refresh',
               jsonb_build_object('dauer_s', $1::numeric, 'nebenlaeufig', $2::boolean))
       ON CONFLICT (schluessel)
       DO UPDATE SET wert = EXCLUDED.wert, gesetzt_am = now()`,
      [dauerS, nebenlaeufig])

    return { status: 'aufgefrischt', dauerS, nebenlaeufig }
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
export async function vergleichstagNachlauf(): Promise<void> {
  const r = await vergleichstagAuffrischen()
  if (r.status === 'aufgefrischt') {
    log.info('Vergleichstag aufgefrischt', { dauer_s: r.dauerS, nebenlaeufig: r.nebenlaeufig })
  } else {
    log.warn('Vergleichstag nicht aufgefrischt', { grund: r.meldung, dauer_s: r.dauerS })
  }
}
