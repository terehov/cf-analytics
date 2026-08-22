/**
 * Frischt die materialisierten Pflichtartikelsichten auf — als Nachlauf
 * jedes Sync-Laufs (Migration `0094`).
 *
 * WAS SIE BEANTWORTEN. Welcher Anteil des Einkaufs eines Betriebs läuft an
 * der Pflichtartikelliste seines Konzepts vorbei. Die Leitzahl ist
 * `mart.pflichtartikel_betrieb.abseits_pct`, gerechnet auf die Ausgaben.
 *
 * REIHENFOLGE, UND ZWAR ZWEIFACH GEBUNDEN:
 *
 *   1. NACH `pflegeNachlauf()`. Die Listen selbst kommen aus `pflege/`
 *      (`pflichtartikel_liste.csv`, `pflichtartikel.csv`,
 *      `pflichtartikel_alias.csv`). Liefe der Refresh davor, trüge die
 *      Auswertung bis zum nächsten Lauf den Listenstand von gestern —
 *      und eine gerade bestätigte Nachfolgenummer wirkte einen Tag lang
 *      nicht. Dieselbe Falle, die `yextNachlauf()` bis zum 14.08.2026
 *      hatte und `vergleichstagNachlauf()` seit `0084` vermeidet.
 *
 *   2. NACH dem Import. Vorher wäre es der alte Stand, neu geschrieben.
 *
 * UNTEREINANDER SIND SIE NICHT UNABHÄNGIG — anders als die drei in
 * `einkauf_sichten.ts`. `pflichtartikel_einkauf_basis` und
 * `pflichtartikel_artikel_basis` lesen beide
 * `pflichtartikel_klassifikation_basis`. Die Reihenfolge im Feld unten ist
 * deshalb bindend und keine Geschmacksfrage: wird die Klassifikation nach
 * den beiden anderen aufgefrischt, stehen sie einen Lauf lang auf der
 * vorherigen Einteilung.
 *
 * Dieselben zwei Regeln wie in `round_table.ts` und `einkauf_sichten.ts`:
 *   1. Das hier darf einen Sync-Lauf NIEMALS scheitern lassen — ein
 *      misslungener Refresh bedeutet einen alten Stand in den Karten,
 *      nicht verlorene Daten. Die Funktion fängt alles und wirft nie.
 *   2. Und weil sie alles fängt, ist der Merker die einzige Spur: er
 *      steht in `mart.materialisierung_stand`, und die Prüfzeile dort
 *      meldet einen Refresh, der älter ist als der letzte Lauf. Ohne
 *      diesen Eintrag wäre ein dauerhaft scheiternder Refresh von einem
 *      gelungenen nicht zu unterscheiden (die Lehre aus `0091`).
 */
import { log } from '../lib/log'
import { pool, query } from '../db/pool'
import { sichtAuffrischen } from './auffrischen'

/**
 * CONCURRENTLY, damit niemand während des Neuaufbaus vor einer sperrenden
 * Seite sitzt. Die dafür nötigen eindeutigen Indizes liegen in Migration
 * `0094`. Der eine Fall, in dem CONCURRENTLY bauartbedingt nicht geht —
 * eine nie befüllte Sicht —, steckt in `sync/auffrischen.ts`.
 *
 * REIHENFOLGE BINDEND: die Klassifikation zuerst, die beiden anderen
 * lesen sie.
 */
const SICHTEN = [
  'mart.pflichtartikel_klassifikation_basis',
  'mart.pflichtartikel_einkauf_basis',
  'mart.pflichtartikel_artikel_basis',
]

/** Notnagel gegen stille Blockaden, keine erwartete Laufzeit. */
const ZEITGRENZE_MS = 10 * 60 * 1000

export type Auffrischung = {
  status: 'aufgefrischt' | 'fehler'
  dauerS: number
  meldung?: string
}

/** Frischt alle drei auf. Wirft nie — Regel 1 oben. */
export async function pflichtartikelSichtenAuffrischen(): Promise<Auffrischung> {
  const t0 = Date.now()
  // Eigene Verbindung statt query() aus db/pool — dieselben zwei Gründe wie
  // in einkauf_sichten.ts: SET statement_timeout gilt je Sitzung, und ein
  // halb durchgelaufener REFRESH soll nicht automatisch wiederholt werden.
  const client = await pool.connect()
  try {
    await client.query(`SET statement_timeout = ${ZEITGRENZE_MS}`)
    for (const sicht of SICHTEN) await sichtAuffrischen(client, sicht)

    const dauerS = Math.round((Date.now() - t0) / 100) / 10
    await query(
      `INSERT INTO sync.merker (schluessel, wert)
       VALUES ('pflichtartikel_refresh', jsonb_build_object('dauer_s', $1::numeric))
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
export async function pflichtartikelSichtenNachlauf(): Promise<void> {
  const r = await pflichtartikelSichtenAuffrischen()
  if (r.status === 'aufgefrischt') {
    log.info('Pflichtartikelsichten aufgefrischt', { dauer_s: r.dauerS })
  } else {
    log.warn('Pflichtartikelsichten nicht aufgefrischt', { grund: r.meldung, dauer_s: r.dauerS })
  }
}
