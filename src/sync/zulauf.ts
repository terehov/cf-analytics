/**
 * Der Lauf meldet nicht mehr blind „ok" (Plan Phase 4).
 *
 * DIE REGEL, UM DIE ES GEHT (AGENTS.md 10): *eine Quelle ohne Zulauf ist ein
 * Fehler, kein Normalzustand. Der Lauf darf sie nicht als „ok" melden.*
 *
 * Bis hierher konnte er nichts anderes. `sync.lauf.status` kannte genau eine
 * Frage: sind Aufgaben gescheitert? Eine Quelle, die niemand mehr abfragt,
 * erzeugt keine gescheiterte Aufgabe — sie erzeugt gar keine. Am 12.08.2026
 * standen so 269 von 269 Aufgaben auf „ok", während `core.buchungsbeleg` zwei
 * Tage lang keinen einzigen Beleg bekam.
 *
 * DAS HIER LÄUFT ALS LETZTES, nach allen Nachläufen. Vorher wäre Yext noch
 * nicht geladen, und die vier Yext-Quellen stünden in jedem Lauf als stumm da
 * — ein Alarm, der immer schlägt, ist keiner.
 *
 * WAS ES TUT UND WAS AUSDRÜCKLICH NICHT. Es setzt `sync.lauf.status` von `ok`
 * auf `teilweise` und schreibt die Namen in die Notiz. Es macht daraus **kein**
 * `fehlgeschlagen`: der Lauf hat ja getan, was er konnte, und ein Exitcode 1
 * ließe Dokploy den Container neu starten, was nichts löst. Wer hinsehen soll,
 * erfährt es über `/status`, `mart.pruefung_uebersicht` und das
 * Import-Dashboard.
 *
 * WIRFT NIE. Eine Beobachtung über die Arbeit darf die Arbeit nicht mitnehmen.
 */
import { query, eine } from '../db/pool'
import { log } from '../lib/log'

export type Stumm = {
  quelle: string
  system: string
  zustand: string
  stunden_ohne_zulauf: number | null
  wird_noch_gefragt: boolean
}

/**
 * Die stummen Quellen holen — nur die erwarteten.
 *
 * `nicht erwartet` steht bewusst in der Sicht und bewusst nicht in dieser
 * Liste: LINAs Warenwirtschaft ist Demodaten, für Rezepte gibt es keinen
 * Endpunkt. Ein Alarm ohne Handlungsmöglichkeit entwertet nur die Prüfung
 * daneben.
 */
export async function stummeQuellen(): Promise<Stumm[]> {
  return await query<Stumm>(
    `SELECT quelle, system, zustand,
            stunden_ohne_zulauf::float AS stunden_ohne_zulauf,
            wird_noch_gefragt
       FROM mart.quelle_zulauf
      WHERE erwartet AND zustand IN ('stumm','nie')
      ORDER BY wird_noch_gefragt, quelle`)
}

/**
 * Nach dem Lauf: die Quellen prüfen und das Ergebnis an den Lauf hängen.
 *
 * Gibt die Zahl der stummen Quellen zurück — 0 heißt, alles hat Zulauf.
 */
export async function zulaufPruefen(laufId: string | number | null): Promise<number> {
  try {
    const stumm = await stummeQuellen()

    if (stumm.length === 0) {
      log.info('zulauf geprueft — jede erwartete Quelle hat Zulauf')
      return 0
    }

    /**
     * Die schärfere Teilmenge zuerst nennen: eine Quelle, die nicht einmal
     * mehr ABGEFRAGT wird, ist ein Baufehler und keine Auffälligkeit in den
     * Daten. Genau das war der 12.08.2026, und genau das unterschied ihn vom
     * Yext-Fall am 10.08. (frischer Zeitstempel, leere Tabellen).
     */
    const ungefragt = stumm.filter(s => !s.wird_noch_gefragt)
    const notiz =
      `${stumm.length} Quelle(n) ohne Zulauf: ${stumm.map(s => s.quelle).join(', ')}`
      + (ungefragt.length > 0
          ? ` — davon ${ungefragt.length} gar nicht mehr abgefragt: `
            + `${ungefragt.map(s => s.quelle).join(', ')}`
          : '')

    log.warn('QUELLEN OHNE ZULAUF — der Lauf meldet nicht mehr ok', {
      quellen: stumm.map(s => ({
        quelle: s.quelle, zustand: s.zustand,
        stundenOhneZulauf: s.stunden_ohne_zulauf,
        wirdNochGefragt: s.wird_noch_gefragt,
      })),
      sicht: 'SELECT * FROM mart.quelle_zulauf WHERE zustand <> \'ok\';',
    })

    if (laufId !== null) {
      /**
       * Nur `ok` wird herabgestuft. Ein Lauf, der schon `teilweise`,
       * `abgebrochen` oder `fehlgeschlagen` ist, sagt bereits das Wichtigere
       * — den Grund überschreiben hiesse, die erste Ursache zu verlieren.
       *
       * Die Notiz kommt in beiden Fällen dazu.
       */
      await query(
        `UPDATE sync.lauf
            SET status = CASE WHEN status = 'ok' THEN 'teilweise' ELSE status END,
                notiz = concat_ws(' | ', nullif(notiz, ''), $2::text)
          WHERE lauf_id = $1`, [laufId, notiz])
    }

    return stumm.length
  } catch (e) {
    log.error('zulaufpruefung gescheitert — der Lauf bleibt davon unberuehrt',
      { fehler: String(e).slice(0, 300) })
    return 0
  }
}

/** Für `/status`: eine Zeile, die sagt, ob jemand hinsehen muss. */
export async function zulaufStand(): Promise<{
  erwartet: number; stumm: number; ungefragt: number; namen: string[]
} | null> {
  return await eine<any>(
    `SELECT count(*) FILTER (WHERE erwartet)::int AS erwartet,
            count(*) FILTER (WHERE erwartet AND zustand IN ('stumm','nie'))::int AS stumm,
            count(*) FILTER (WHERE erwartet AND NOT wird_noch_gefragt)::int AS ungefragt,
            coalesce(array_agg(quelle) FILTER (
              WHERE erwartet AND zustand IN ('stumm','nie')), '{}') AS namen
       FROM mart.quelle_zulauf`).catch(() => null)
}
