/**
 * Frischt mart.konzept_zuordnung_basis auf — als ERSTER Nachlauf in Phase B.
 *
 * WARUM DIE SICHT MATERIALISIERT IST
 *
 * Nicht wegen ihrer Groesse: 141 Zeilen. Sondern wegen der Statistik. Der
 * Hauptkonzept-Join in mart.konzept_zuordnung stand auf einem Ausdruck
 * (COALESCE ueber zwei Quellen), und fuer einen Ausdruck hat Postgres keine
 * Spaltenstatistik. Jeder Markenfilter wurde deshalb auf EINEN Betrieb
 * geschaetzt statt auf 22, und 50 Sichten bekamen dafuer verschachtelte
 * Schleifen mit einer Indexsuche je Tageszeile. Messwerte und Begruendung in
 * migrations/0144_konzept_zuordnung_materialisiert.sql.
 *
 * WARUM ALS ERSTER NACHLAUF
 *
 * Alles in Phase B rechnet auf der Achse Betrieb → Marke: der Round Table,
 * die Einkaufssichten, die Auswahlliste „Marke". Liefe dieser Refresh
 * dahinter, truegen sie einen Betrieb, den Phase A gerade angelegt hat, eine
 * Nacht lang unter „(nicht zugeordnet)". Phase A selbst liest die Sicht nicht.
 *
 * ANALYZE NACH DEM REFRESH, und das ist hier kein Detail: REFRESH schreibt
 * keine Statistik, und die Statistik ist der ganze Zweck. Ohne sie schaetzt
 * der Planer die 141 Zeilen aus einem Standardwert — und zwar genau wieder
 * so falsch wie vorher.
 *
 * Dieselben zwei Regeln wie bei deckungsbeitrag.ts nebenan: wirft nie, laeuft
 * nach dem Import.
 */
import { log } from '../lib/log'
import { pool, query } from '../db/pool'
import { sichtAuffrischen } from './auffrischen'

const SICHT = 'mart.konzept_zuordnung_basis'

/** 141 Zeilen; die Grenze ist ein Notnagel gegen eine haengende Sperre. */
const ZEITGRENZE_MS = 2 * 60 * 1000

export type Auffrischung = {
  status: 'aufgefrischt' | 'fehler'
  dauerS: number
  meldung?: string
}

/** Frischt auf und schreibt die Statistik. Wirft nie. */
export async function konzeptZuordnungAuffrischen(): Promise<Auffrischung> {
  const t0 = Date.now()
  // Eigene Verbindung — SET statement_timeout gilt je Sitzung (deckungsbeitrag.ts).
  const client = await pool.connect()
  try {
    await client.query(`SET statement_timeout = ${ZEITGRENZE_MS}`)
    await sichtAuffrischen(client, SICHT)
    await client.query(`ANALYZE ${SICHT}`)

    const dauerS = Math.round((Date.now() - t0) / 100) / 10
    await query(
      `INSERT INTO sync.merker (schluessel, wert)
       VALUES ('konzept_zuordnung_refresh', jsonb_build_object('dauer_s', $1::numeric))
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

/** Der Aufruf fuer den Nachlauf: frischt auf und protokolliert, ohne je zu werfen. */
export async function konzeptZuordnungNachlauf(): Promise<void> {
  const r = await konzeptZuordnungAuffrischen()
  if (r.status === 'aufgefrischt') {
    log.info('Konzeptzuordnung aufgefrischt', { dauer_s: r.dauerS })
  } else {
    // ERROR, nicht WARN — siehe pflichtartikel_sichten.ts (10.09.2026).
    log.error('Konzeptzuordnung nicht aufgefrischt', { grund: r.meldung, dauer_s: r.dauerS })
  }
}
