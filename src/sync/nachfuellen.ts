/**
 * Die Warteschlange selbst nachfüllen — der Vorlauf jedes Sync-Laufs.
 *
 * WARUM DAS HIER STEHT UND NICHT IN EINEM ZWEITEN ZEITPLAN.
 *
 * Bis zum 02.08.2026 waren Einreihen und Abarbeiten zwei getrennte
 * Befehle: `einreihen --taeglich` füllte, `sync` leerte. Beide brauchten
 * je einen Schedule Job. Fiel der erste aus, lief der zweite munter
 * weiter, meldete „ok" und tat nichts — gemessen am 02.08.2026 stand
 * LINA acht Tage still, während der Importer fehlerfrei durchlief. Ein
 * Importer, der nichts zu tun hat, sieht genauso aus wie einer, der
 * fertig ist.
 *
 * Deshalb füllt der Lauf sich jetzt selbst. Ein einziger Zeitplan
 * (`bun run sync`), ein einziger Ausfallpunkt.
 *
 * WAS HIER NICHT PASSIERT: der einmalige Historien-Backfill
 * (`einreihen --historie`, `einreihen --foodnotify`). Der wird bewusst
 * von Hand angestoßen — er stellt Zehntausende Posten ein, und das soll
 * eine Entscheidung sein, kein Nebeneffekt eines Neustarts.
 */

import { query, eine } from '../db/pool'
import { config, fnZugaenge } from '../config'
import { log } from '../lib/log'
import { AKTIVE_ENDPUNKTE, istMomentaufnahme, einreihPrioritaet } from '../lina/endpunkte'
import { geschaeftstag } from '../lib/time'

export type NachfuellStand = { lina: number; foodnotify: number }

/**
 * LINA: die letzten NACHZUEGLER_TAGE Geschäftstage, die Jahresberichte
 * des laufenden Jahres und die monatlichen Momentaufnahmen.
 */
export async function linaNachfuellen(): Promise<number> {
  const gestern = geschaeftstag(new Date(Date.now() - 24 * 3600 * 1000))

  /**
   * Ein gleitendes Fenster statt eines einzelnen Tages.
   *
   * LINAs Konzernberichte füllen sich über mehrere Tage — am 26.07.2026
   * gemessen: die letzten vier Tage komplett leer, der fünfte zu einem
   * Sechstel, erst ab dem siebten plausibel vollständig. Wer nur
   * „gestern" holt, schreibt Nullen fest, und weil der Posten danach
   * erledigt ist, bleiben sie für immer stehen. Zahlen dieser Sorte sind
   * schlimmer als fehlende: eine Lücke sieht man, eine Null nicht.
   *
   * `ON CONFLICT DO NOTHING` ist hier GENAU RICHTIG — und zwar aus
   * demselben Grund, aus dem es in `sync.historie_einreihen()` genau
   * falsch war. Der Eindeutigkeitsindex ist partiell (`WHERE erledigt_am
   * IS NULL`), er blockiert also nur noch OFFENE Posten. Derselbe Tag
   * wird nicht doppelt eingereiht, solange er aussteht, aber sehr wohl
   * erneut, wenn er fertig ist. Genau das soll er: die Zieltabellen sind
   * Upserts, der zweite Abruf korrigiert den ersten.
   */
  const tage: string[] = []
  for (let i = 1; i <= config.NACHZUEGLER_TAGE; i++) {
    tage.push(geschaeftstag(new Date(Date.now() - i * 24 * 3600 * 1000)))
  }

  let n = 0
  for (const ep of AKTIVE_ENDPUNKTE) {
    if (ep.schrittweite !== 'tag') continue
    for (const tag of tage) {
      const r = await query(
        `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
         VALUES ($1, $2, $2, $3) ON CONFLICT DO NOTHING RETURNING posten_id`,
        [ep.key, tag, einreihPrioritaet(ep.key)])
      n += r.length
    }
  }

  // Kennzahlen laufen jahresweise und werden erneut geholt, weil die BWA
  // rückwirkend nachgebucht wird. Append-only fängt das ab.
  const jahr = gestern.slice(0, 4)
  for (const ep of AKTIVE_ENDPUNKTE.filter(e => e.schrittweite === 'jahr')) {
    const r = await query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING posten_id`,
      [ep.key, `${jahr}-01-01`, `${jahr}-12-31`, einreihPrioritaet(ep.key)])
    n += r.length
  }

  /**
   * Stammdaten-Momentaufnahmen: eine je Kalendermonat, auf den
   * Monatsersten gesetzt.
   *
   * `ON CONFLICT DO NOTHING` allein reicht dafür NICHT, auch wenn es so
   * aussieht: Der Eindeutigkeitsindex ist partiell (`WHERE erledigt_am
   * IS NULL`). Ein ERLEDIGTER Posten blockiert also nichts — der Lauf
   * hätte beim nächsten Start munter denselben Monatsersten neu
   * eingereiht, und die „monatliche" Momentaufnahme wäre in Wahrheit
   * bei jedem Lauf gelaufen.
   *
   * Das wiegt jetzt schwerer als früher: Nachfüllen passiert bei JEDEM
   * Sync-Lauf, nicht mehr einmal täglich. Deshalb ausdrücklich gegen
   * ALLE Posten desselben Zeitraums geprüft, erledigte eingeschlossen.
   */
  const monatsErster = `${gestern.slice(0, 7)}-01`
  for (const ep of AKTIVE_ENDPUNKTE.filter(istMomentaufnahme)) {
    const r = await query(
      `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
       SELECT $1, $2::date, $2::date, $3
        WHERE NOT EXISTS (
              SELECT 1 FROM sync.warteschlange
               WHERE endpunkt = $1 AND zeitraum_von = $2::date)
       RETURNING posten_id`,
      [ep.key, monatsErster, einreihPrioritaet(ep.key)])
    n += r.length
  }

  return n
}

/**
 * FoodNotify: der laufende Abgleich.
 *
 * WAS HIER GEHOLT WIRD UND WARUM GENAU DAS.
 *
 * Der Backfill arbeitet die Seiten ab, die es beim Start gab. Neue
 * Bestellungen entstehen bei FoodNotify aber auf NEUEN Seiten am Ende
 * der Liste (sortiert nach timeCreated ASC) — die kennt niemand, und
 * ohne diesen Abgleich fehlten sie für immer.
 *
 * Geholt wird deshalb je Kostenstelle die LETZTE Seite: dort stehen die
 * neuesten Bestellungen. Ihr Laden reiht Köpfe und Positionen für alles
 * ein, was dort neu auftaucht — dieselbe Mechanik wie im Backfill, nur
 * am anderen Ende.
 *
 * Die Seitenzahl steht nicht fest: kommen Bestellungen dazu, wächst sie.
 * Sie wird deshalb bei jedem Lauf neu aus `gesamt` abgeleitet, nicht
 * gespeichert.
 */
export async function foodnotifyNachfuellen(): Promise<number> {
  const zugaenge = fnZugaenge()
  if (zugaenge.length === 0) return 0

  const heute = geschaeftstag(new Date())
  let n = 0

  for (const z of zugaenge) {
    const marke = await eine<{ marke_key: number }>(
      `SELECT marke_key FROM core.marke WHERE schluessel = $1`, [z.schluessel])
    if (!marke) continue

    /**
     * Die Organisationsposten (A1) einmal je Kalendermonat auffrischen:
     * neue Betriebe, neue Kostenstellen, neu angeschlossene Kassen. Sie
     * sind Momentaufnahmen — täglich wäre Verschwendung, nie wäre blind.
     *
     * Geprüft wird gegen ALLE Posten des Monats, erledigte eingeschlossen
     * (siehe die Begründung bei den LINA-Momentaufnahmen oben).
     */
    const monatsErster = `${heute.slice(0, 7)}-01`
    const { fnEndpunkt } = await import('../foodnotify/endpunkte')
    for (const ep of ['fn:betriebe', 'fn:kostenstellen', 'fn:pos_standorte']) {
      const r = await query(
        `INSERT INTO sync.warteschlange
           (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
         SELECT $1, $2::date, $2::date, $4, $3, '{}'::jsonb
          WHERE NOT EXISTS (
                SELECT 1 FROM sync.warteschlange w
                 WHERE w.endpunkt = $1 AND w.marke_key = $3
                   AND w.parameter = '{}'::jsonb
                   AND w.zeitraum_von = $2::date)
         RETURNING posten_id`,
        [ep, monatsErster, marke.marke_key, fnEndpunkt(ep).prioritaet])
      n += r.length
    }

    /**
     * Die jeweils letzte Bestellseite je Kostenstelle.
     *
     * Priorität 20: klar VOR dem Backfill (89/90), damit neue
     * Bestellungen nicht hinter 36.000 Altposten warten — und klar HINTER
     * LINAs Tagesdaten (10), die zeitkritischer sind.
     *
     * Nur Kostenstellen mit bekannter Seitenzahl: solange der Backfill
     * die erste Seite einer Kostenstelle nicht geholt hat, ist sie
     * unbekannt — und der Backfill deckt diese Kostenstelle ohnehin
     * gerade selbst ab.
     *
     * `page_count` kommt AUS DER ANTWORT, wird also nicht aus der
     * Gesamtzahl und einer angenommenen Seitengröße gerechnet. Die
     * Seitengröße ist eine Annahme über fremdes Verhalten; die
     * Seitenzahl ist eine Aussage des Servers.
     *
     * Der Pfad ist `payload->'payload'`: raw speichert die Antwort MIT
     * Hülle, und die Zählfelder stehen innerhalb der Hülle.
     */
    const seiten = await query<{ erp_id: number; letzte_seite: number }>(
      `SELECT k.erp_id, greatest(1, a.seiten) AS letzte_seite
         FROM core.kostenstelle k
         JOIN LATERAL (
              SELECT (s.payload->'payload'->>'page_count')::int AS seiten
                FROM raw.api_antwort s
               WHERE s.endpunkt = 'fn:bestellungen'
                 AND s.parameter->>'erpId' = k.erp_id::text
                 AND s.payload->'payload'->>'page_count' IS NOT NULL
               ORDER BY s.abgerufen_am DESC
               LIMIT 1) a ON true
        WHERE k.marke_key = $1 AND k.erp_id IS NOT NULL`,
      [marke.marke_key])

    for (const s of seiten) {
      const r = await query(
        `INSERT INTO sync.warteschlange
           (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
         SELECT 'fn:bestellungen', $1::date, $1::date, 20, $2, $3::jsonb
          WHERE NOT EXISTS (
                SELECT 1 FROM sync.warteschlange w
                 WHERE w.endpunkt = 'fn:bestellungen' AND w.marke_key = $2
                   AND w.parameter = $3::jsonb AND w.erledigt_am IS NULL)
         RETURNING posten_id`,
        [heute, marke.marke_key,
         JSON.stringify({ erpId: String(s.erp_id), seite: String(s.letzte_seite) })])
      n += r.length
    }
  }

  return n
}

/**
 * Beides nachfüllen. Wirft NIE — ein Fehler beim Nachfüllen darf den
 * Lauf nicht verhindern: die Warteschlange enthält in aller Regel noch
 * Arbeit, und die soll getan werden. Gemeldet wird er trotzdem.
 */
export async function nachfuellen(): Promise<NachfuellStand> {
  const stand: NachfuellStand = { lina: 0, foodnotify: 0 }

  try {
    stand.lina = await linaNachfuellen()
  } catch (e) {
    log.error('nachfüllen lina gescheitert — der Lauf geht weiter', { fehler: String(e) })
  }

  try {
    stand.foodnotify = await foodnotifyNachfuellen()
  } catch (e) {
    log.error('nachfüllen foodnotify gescheitert — der Lauf geht weiter', { fehler: String(e) })
  }

  if (stand.lina > 0 || stand.foodnotify > 0) {
    log.info('nachgefüllt', stand)
  }
  return stand
}
