/**
 * Frischt die materialisierten Einkaufssichten auf — als Nachlauf jedes
 * Sync-Laufs.
 *
 * WARUM DIE SICHTEN MATERIALISIERT SIND
 *
 * mart.fremdeinkauf war eine Sicht, und jede ihrer zwölf Karten las damit
 * 394.575 Buchungsbelege und 66.926 Bestellungen von vorn, normierte dabei
 * jeden Kreditorennamen über zwei regexp_replace und aggregierte das
 * Ergebnis. Am 12.08.2026 standen deshalb siebzehn Abfragen gleichzeitig auf
 * der Produktionsdatenbank, die ältesten neun Minuten alt und noch nicht
 * fertig — die Karten EINER Seite. Dieselbe Rechnung bei
 * mart.einkaufspreis_monat und mart.einkaufspreis_betrieb über 876.611
 * Bestellpositionen. Begründung und Messwerte in
 * migrations/0063_einkaufssichten_materialisiert.sql.
 *
 * REIHENFOLGE: NACH einkaufspreisNachlauf(). Dort läuft
 * core.gebinde_vereinheitlichen() und schreibt preis_je_einheit und
 * menge_unstimmig neu — beides steckt in mart.einkaufspreis_betrieb_basis.
 * Andersherum stünde bis zum nächsten Lauf der Stand VOR der Korrektur in
 * den Karten, und die Preisausreißer, die der Nachlauf gerade entzogen hat,
 * wären weiter zu sehen.
 *
 * Untereinander sind die drei unabhängig: einkauf_kreditor_monat liest
 * Belege und Bestellungen, die beiden Preissichten die Positionen. Keine
 * liest eine andere.
 *
 * Dieselben zwei Regeln wie bei round_table.ts nebenan:
 *   1. Das hier darf einen Sync-Lauf NIEMALS scheitern lassen — ein
 *      misslungener Refresh bedeutet einen alten Stand in den Karten,
 *      nicht verlorene Daten. Die Funktion fängt alles und wirft nie.
 *   2. Es läuft NACH dem Import; vorher wäre es der alte Stand, neu
 *      geschrieben.
 */
import { log } from '../lib/log'
import { pool, query } from '../db/pool'

/**
 * CONCURRENTLY, damit niemand während des Neuaufbaus vor einem sperrenden
 * Dashboard sitzt — der Grund, aus dem diese Datei überhaupt existiert,
 * wäre sonst zur Refresh-Zeit wieder da. Die dafür nötigen eindeutigen
 * Indizes liegen in Migration 0063.
 */
const REFRESHES = [
  `REFRESH MATERIALIZED VIEW CONCURRENTLY mart.einkauf_kreditor_monat`,
  `REFRESH MATERIALIZED VIEW CONCURRENTLY mart.einkaufspreis_monat_basis`,
  `REFRESH MATERIALIZED VIEW CONCURRENTLY mart.einkaufspreis_betrieb_basis`,
  // Migration 0064, nachgezogen nach der Messung an der fertigen Seite:
  // diese beiden trugen die restlichen 5,8 s von Dashboard 16 fast allein.
  `REFRESH MATERIALIZED VIEW CONCURRENTLY mart.einkauf_betrieb_monat_basis`,
  `REFRESH MATERIALIZED VIEW CONCURRENTLY mart.einkauf_pruefung_basis`,
]

/** Notnagel gegen stille Blockaden, keine erwartete Laufzeit. */
const ZEITGRENZE_MS = 10 * 60 * 1000

export type Auffrischung = {
  status: 'aufgefrischt' | 'fehler'
  dauerS: number
  meldung?: string
}

/** Frischt alle drei auf. Wirft nie — Regel 1 oben. */
export async function einkaufSichtenAuffrischen(): Promise<Auffrischung> {
  const t0 = Date.now()
  // Eigene Verbindung statt query() aus db/pool — dieselben zwei Gründe wie
  // in round_table.ts: SET statement_timeout gilt je Sitzung, und ein halb
  // durchgelaufener REFRESH soll nicht automatisch wiederholt werden.
  const client = await pool.connect()
  try {
    await client.query(`SET statement_timeout = ${ZEITGRENZE_MS}`)
    for (const refresh of REFRESHES) await client.query(refresh)

    const dauerS = Math.round((Date.now() - t0) / 100) / 10
    await query(
      `INSERT INTO sync.merker (schluessel, wert)
       VALUES ('einkauf_sichten_refresh', jsonb_build_object('dauer_s', $1::numeric))
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
export async function einkaufSichtenNachlauf(): Promise<void> {
  const r = await einkaufSichtenAuffrischen()
  if (r.status === 'aufgefrischt') {
    log.info('Einkaufssichten aufgefrischt', { dauer_s: r.dauerS })
  } else {
    log.warn('Einkaufssichten nicht aufgefrischt', { grund: r.meldung, dauer_s: r.dauerS })
  }
}
