/**
 * Der Wetter-Nachlauf — Plan Kalender/Wetter, Phase 3.
 *
 * ZWEI DINGE, EINE STELLE:
 *   1. ein ROLLIERENDES FENSTER: die letzten 14 Tage werden jede Nacht neu
 *      geholt, nicht nur die neuen. DWD-Stationen melden nach und korrigieren;
 *      ein einmal geholter Tag ist nicht endgültig. 48 Aufrufe.
 *   2. ein BACKFILL MIT OBERGRENZE, kein Handbefehl — die Entscheidung vom
 *      14.08.2026. `WETTER_BACKFILL_JE_LAUF` (Vorgabe 60) arbeitet die 432
 *      Ortsjahre in gut sieben Nächten ab, neueste zuerst.
 *
 *   3. DER REFRESH VON `mart.wetter_tag_basis`, seit dem 21.09.2026 (Migration
 *      0111). Er steht hier und nicht in einem der Sammel-Nachläufe, weil
 *      diese Funktion die EINZIGE ist, die `manual.wetter_stunde` schreibt —
 *      der Refresh gehört hinter ihren Schreibvorgang, nicht an eine dritte
 *      Stelle im Ablauf.
 *
 * DAS WETTER IST NICHT MEHR LIVE, seit dem 21.09.2026. Hier stand vorher, es
 * sei es: die Wetterspalten sitzen in der dünnen Hülle `mart.vergleichstag`
 * über der Materialisierung, und `mart.wetter_tag` war eine gewöhnliche Sicht.
 * Das stimmte und war teuer. `mart.wetter_tag` gruppierte bei JEDER Abfrage
 * alle 3,42 Mio. Zeilen von `manual.wetter_stunde` nach
 * `core.geschaeftstag(zeitpunkt)`; ein Funktionswert als Gruppenschlüssel nimmt
 * keinen Index an und lässt keinen Datumsfilter vor die Aggregation. Gemessen
 * in Produktion am 21.09.2026: `mart.betrieb_wetter_tag` braucht für EINEN Tag
 * 7,4 s und für ein ganzes Jahr ebenfalls 7,4 s, während
 * `mart.vergleichstag_basis` ein Jahr in 0,08 s liefert. Eine Jahresauswertung
 * mit Wetterspalten lief damit in die 20-s-Grenze der Leserolle. Seit 0111
 * liegt die Verdichtung in `mart.wetter_tag_basis`, und der Preis dafür steht
 * in dieser Datei: die Wetterzahlen sind so frisch wie der letzte Lauf.
 *
 * REIHENFOLGE: weiterhin keine — und das bleibt wahr.
 * `mart.vergleichstag_basis` liest ausschließlich `mart.betrieb_kalender` und
 * `mart.umsatz_tag`, kein Wetter; `vergleichstagNachlauf()` in Phase B ist
 * also nach wie vor unabhängig von dieser Funktion. Und `mart.wetter_rueckstand`,
 * die Arbeitsliste des Backfills, liest `manual.wetter_stunde` DIREKT und nicht
 * über die Materialisierung — sie sagt dem nächsten Lauf die Wahrheit, auch
 * wenn ein Refresh misslingt.
 *
 * WIRFT NIE. Ein fehlender Wetterwert ist eine leere Spalte, kein verlorener
 * Umsatz — und ganz sicher kein Grund, einen Importlauf scheitern zu lassen.
 * Für den Refresh gilt dasselbe: ein misslungener Refresh bedeutet veraltete
 * Wetterzahlen, nicht verlorene Daten. Sichtbar bleibt er trotzdem, über
 * `mart.materialisierung_stand` unter dem Merker `wetter_tag_refresh` (0091)
 * und als `log.error`.
 *
 * WAS SICHTBAR BLEIBT (Regel 10): `mart.wetter_rueckstand` führt eine Zahl,
 * die von Nacht zu Nacht FALLEN muss. Ein abgebrochener Backfill sieht sonst
 * genauso aus wie ein fertiger.
 */
import { config } from '../config'
import { log } from '../lib/log'
import { pool, query } from '../db/pool'
import { sichtAuffrischen } from '../sync/auffrischen'
import { BrightSky, type Ort, type Stundenwert, type Wetterquelle } from './quelle'

/**
 * Pause zwischen zwei Aufrufen. Bright Sky ist ein frei zugänglicher Dienst
 * ohne dokumentiertes Limit — dieselbe Haltung wie bei LINA (Regel 3): das
 * Tempo ist Teil der Anforderung, nicht Höflichkeit. Ein Jahr je Aufruf ist
 * ohnehin sparsam.
 */
const PAUSE_MS = 250

const warte = (ms: number) => new Promise(r => setTimeout(r, ms))

export type Ergebnis = {
  fenster: number
  backfill: number
  zeilen: number
  fehler: string[]
}

async function orte(): Promise<Ort[]> {
  const r = await query<{ breite: string; laenge: string }>(
    `SELECT breite, laenge FROM mart.wetter_ort ORDER BY breite, laenge`)
  return r.map(o => ({ breite: Number(o.breite), laenge: Number(o.laenge) }))
}

/**
 * Die offenen Ortsjahre, neueste zuerst. `unvollstaendig` kommt mit dran —
 * ein Jahr mit 3.000 Stunden ist kein geholtes Jahr, und der Nachlauf soll es
 * nicht für erledigt halten.
 */
async function offeneOrtsjahre(grenze: number): Promise<{ ort: Ort; jahr: number }[]> {
  if (grenze <= 0) return []
  const r = await query<{ breite: string; laenge: string; jahr: number }>(
    `SELECT breite, laenge, jahr FROM mart.wetter_rueckstand
      WHERE zustand IN ('fehlt', 'unvollstaendig')
      ORDER BY jahr DESC, breite, laenge
      LIMIT $1`, [grenze])
  return r.map(o => ({ ort: { breite: Number(o.breite), laenge: Number(o.laenge) }, jahr: o.jahr }))
}

/**
 * Schreibt einen Abruf weg — EIN Aufruf je Ortsjahr, nicht achtzehn.
 *
 * NACHGEMESSEN AM 20.08.2026: die erste Fassung stapelte 500 Zeilen je INSERT
 * und brauchte damit 18 Rundreisen für ein Ortsjahr — rund eine Minute. Bei 60
 * Ortsjahren je Nacht wäre der Nachlauf allein eine Stunde gelaufen, und das
 * für Daten, die in einer einzigen Antwort ankommen.
 *
 * `unnest` über zwölf Arrays macht daraus eine Anweisung. Die Zeilenzahl ist
 * bekannt und beschränkt (ein Jahr sind rund 8.760 Stunden), es gibt hier also
 * keine Größe, die davonlaufen könnte.
 *
 * ON CONFLICT, weil das rollierende Fenster dieselben Tage jede Nacht neu
 * schreibt — DWD-Stationen melden nach und korrigieren.
 */
async function schreiben(ort: Ort, werte: Stundenwert[]): Promise<number> {
  if (werte.length === 0) return 0
  await query(
    `INSERT INTO manual.wetter_stunde
       (breite, laenge, zeitpunkt, temperatur, niederschlag, sonnenschein,
        wind, bewoelkung, luftfeuchte, zustand, station_id, distanz_m)
     SELECT $1, $2, z.zeitpunkt, z.temperatur, z.niederschlag, z.sonnenschein,
            z.wind, z.bewoelkung, z.luftfeuchte, z.zustand, z.station_id, z.distanz_m
       FROM unnest($3::timestamptz[], $4::numeric[], $5::numeric[], $6::numeric[],
                   $7::numeric[], $8::smallint[], $9::smallint[], $10::text[],
                   $11::integer[], $12::integer[])
         AS z(zeitpunkt, temperatur, niederschlag, sonnenschein, wind,
              bewoelkung, luftfeuchte, zustand, station_id, distanz_m)
     ON CONFLICT (breite, laenge, zeitpunkt) DO UPDATE SET
       temperatur   = excluded.temperatur,
       niederschlag = excluded.niederschlag,
       sonnenschein = excluded.sonnenschein,
       wind         = excluded.wind,
       bewoelkung   = excluded.bewoelkung,
       luftfeuchte  = excluded.luftfeuchte,
       zustand      = excluded.zustand,
       station_id   = excluded.station_id,
       distanz_m    = excluded.distanz_m,
       geholt_am    = now()`,
    [ort.breite, ort.laenge,
     werte.map(w => w.zeitpunkt),
     werte.map(w => w.temperatur),
     werte.map(w => w.niederschlag),
     werte.map(w => w.sonnenschein),
     werte.map(w => w.wind),
     werte.map(w => w.bewoelkung),
     werte.map(w => w.luftfeuchte),
     werte.map(w => w.zustand),
     werte.map(w => w.stationId),
     werte.map(w => w.distanzM)])
  return werte.length
}

function alsDatum(d: Date): string { return d.toISOString().slice(0, 10) }

export async function wetterHolen(quelle: Wetterquelle = new BrightSky()): Promise<Ergebnis> {
  const raus: Ergebnis = { fenster: 0, backfill: 0, zeilen: 0, fehler: [] }
  const punkte = await orte()
  if (punkte.length === 0) {
    // Regel 10: kein Gitterpunkt heisst nicht "nichts zu tun", sondern
    // "kein einziger Standort gepflegt". Das gehoert gemeldet.
    log.warn('kein Gitterpunkt — manual.betrieb_standort hat keine Koordinaten')
    return raus
  }

  // 1. Rollierendes Fenster: ein Aufruf je Gitterpunkt deckt alle 14 Tage.
  const bis = new Date()
  const von = new Date(bis.getTime() - config.WETTER_FENSTER_TAGE * 86_400_000)
  for (const ort of punkte) {
    try {
      const a = await quelle.hole(ort, alsDatum(von), alsDatum(bis))
      raus.zeilen += await schreiben(ort, a.werte)
      raus.fenster++
    } catch (e) {
      raus.fehler.push(`Fenster ${ort.breite},${ort.laenge}: ${String(e).slice(0, 120)}`)
    }
    await warte(PAUSE_MS)
  }

  // 2. Backfill, bis die Obergrenze erreicht ist.
  for (const { ort, jahr } of await offeneOrtsjahre(config.WETTER_BACKFILL_JE_LAUF)) {
    try {
      const a = await quelle.hole(ort, `${jahr}-01-01`, `${jahr}-12-31`)
      raus.zeilen += await schreiben(ort, a.werte)
      raus.backfill++
    } catch (e) {
      raus.fehler.push(`Backfill ${jahr} ${ort.breite},${ort.laenge}: ${String(e).slice(0, 120)}`)
    }
    await warte(PAUSE_MS)
  }

  return raus
}

/**
 * Die Materialisierung aus 0111.
 *
 * CONCURRENTLY, damit niemand während des Neuaufbaus vor einem sperrenden
 * Dashboard sitzt — und hier zusätzlich, weil diese Funktion in Phase A
 * neben drei anderen Diensten läuft (src/sync.ts): ein sperrender Refresh
 * würde jede Karte mit Wetterspalten für seine Dauer anhalten. Der dafür
 * nötige eindeutige Index auf (breite, laenge, geschaeftstag) liegt in
 * Migration 0111.
 */
const SICHT = 'mart.wetter_tag_basis'

/**
 * Gemessen 2,6 s nebenläufig über 657.334 Stundenwerte (Klon, 21.09.2026);
 * in Produktion sind es gut fünfmal so viele Zeilen. Die Grenze ist ein
 * Notnagel gegen stille Blockaden, keine erwartete Laufzeit — dieselbe Rolle
 * wie in sync/vergleichstag.ts, und dieselben zehn Minuten.
 */
const ZEITGRENZE_MS = 10 * 60 * 1000

export type Auffrischung = {
  status: 'aufgefrischt' | 'fehler'
  dauerS: number
  nebenlaeufig?: boolean
  meldung?: string
}

/**
 * Frischt `mart.wetter_tag_basis` auf. Wirft nie — siehe Kopf dieser Datei.
 *
 * Eigene Verbindung statt `query()` aus db/pool, dieselben zwei Gründe wie in
 * sync/vergleichstag.ts: `SET statement_timeout` gilt je Sitzung, und ein halb
 * durchgelaufener REFRESH soll nicht automatisch wiederholt werden.
 *
 * Den Sonderfall „nie befüllt" trägt `sichtAuffrischen()` — eine Datenbank aus
 * einem Schema-Abzug hat ausnahmslos unbefüllte Materialisierungen, und
 * CONCURRENTLY braucht einen alten Stand. Welcher SQLSTATE dabei wirklich
 * kommt, steht dort: 0A000 beim Refresh, 55000 erst beim Lesen.
 */
export async function wetterMaterialisierungAuffrischen(): Promise<Auffrischung> {
  const t0 = Date.now()
  const client = await pool.connect()
  let nebenlaeufig = true
  try {
    await client.query(`SET statement_timeout = ${ZEITGRENZE_MS}`)
    nebenlaeufig = await sichtAuffrischen(client, SICHT)

    const dauerS = Math.round((Date.now() - t0) / 100) / 10
    await query(
      `INSERT INTO sync.merker (schluessel, wert)
       VALUES ('wetter_tag_refresh',
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

/** Der Aufruf für den Nachlauf: holt und protokolliert, ohne je zu werfen. */
export async function wetterNachlauf(): Promise<void> {
  try {
    const r = await wetterHolen()
    const [stand] = await query<{ offen: number }>(
      `SELECT count(*)::int AS offen FROM mart.wetter_rueckstand
        WHERE zustand IN ('fehlt', 'unvollstaendig')`)
    log.info('wetter geholt', {
      fenster: r.fenster, backfill: r.backfill, zeilen: r.zeilen,
      fehler: r.fehler.length, offene_ortsjahre: stand?.offen,
      sicht: 'mart.wetter_rueckstand',
    })
    // Die einzelnen Fehler nur gekürzt: 48 gleichlautende Zeilen helfen
    // niemandem, die Zahl daneben schon.
    if (r.fehler.length > 0) log.warn('wetter teilweise', { erste: r.fehler.slice(0, 3) })
  } catch (e) {
    log.error('wetter nicht geholt — der Lauf geht weiter',
      { fehler: String(e).slice(0, 300) })
  }

  /*
   * AUSSERHALB des try/catch darüber, und zwar mit Absicht: die
   * Materialisierung soll auch dann nachgezogen werden, wenn Bright Sky
   * gerade nicht antwortet. Im Bestand stehen dann die Werte der Vornacht,
   * und die gehören in die Sicht — ein Abruf, der scheitert, darf nicht
   * zusätzlich den Refresh kosten.
   */
  const a = await wetterMaterialisierungAuffrischen()
  if (a.status === 'aufgefrischt') {
    log.info('Wettersicht aufgefrischt', { dauer_s: a.dauerS, nebenlaeufig: a.nebenlaeufig })
  } else {
    // ERROR, nicht WARN — siehe sync/vergleichstag.ts (10.09.2026): ein
    // Refresh, der jede Nacht scheitert, sieht bei WARN aus wie ein
    // gelungener Lauf.
    log.error('Wettersicht nicht aufgefrischt', { grund: a.meldung, dauer_s: a.dauerS })
  }
}
