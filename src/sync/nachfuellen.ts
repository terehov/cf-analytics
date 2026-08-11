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

export type NachfuellStand = { lina: number; foodnotify: number; ladenakte: number }

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

    n += await inventurenNachfuellen(marke.marke_key, heute)
  }

  return n
}

/**
 * Die jeweils letzte Inventurseite einer Marke.
 *
 * WARUM JE MARKE UND NICHT JE KOSTENSTELLE: `fn:inventuren` bündelt alle
 * Kostenstellen in EINEM Aufruf (`erpIds[]`, siehe endpunkte.ts) — es gibt
 * hier also gar keine Seitenzahl je Kostenstelle, sondern nur eine je
 * Marke. Das ist der Grund, warum sich `foodnotifyNachfuellen()` oben nicht
 * einfach wiederverwenden ließ.
 *
 * WARUM DIE LETZTE SEITE: dieselbe Mechanik wie bei den Bestellungen. Die
 * Abfrage sortiert aufsteigend nach `timeCreated`, neue Inventuren landen
 * deshalb am Ende. Wer nur Seite 1 nachzöge, bekäme für immer dieselben
 * ältesten Zählungen.
 *
 * DIE SEITENZAHL STEHT WOANDERS ALS BEI DEN BESTELLUNGEN. `/api/erp/*`
 * liefert die erp-Hülle `{code, errors, isError, payload: {data,
 * pagination}}`, die Seitenzahl also unter `payload.pagination.totalPages`
 * — nicht unter dem flachen `page_count`, das `/api/{erpId}/*` verwendet
 * (huelle.ts unterscheidet beide Formen). Ein Griff an die falsche Stelle
 * liefert hier NULL und keinen Fehler: der Abgleich liefe dann still ins
 * Leere, genau wie das erste Auspacken bei Wilma Wunder 275 Inventuren
 * übersah.
 *
 * `coalesce(…, 1)`: solange keine Antwort mit Seitenangabe vorliegt, ist
 * Seite 1 die richtige Wahl — sie ist bei einer einseitigen Liste zugleich
 * die letzte, und bei noch nie geholten Marken der Einstieg.
 *
 * DIE MARKE STEHT IM PARAMETER-JSON, nicht in einer eigenen Spalte:
 * `raw.api_antwort` hat kein `marke_key` (die Tabelle stammt aus der
 * LINA-Zeit, wo es nur einen Mandanten gab). Der Worker legt sie als
 * `parameter->>'markeKey'` ab.
 *
 * Priorität 20 wie bei den Bestellungen: vor dem Backfill (94/95), hinter
 * LINAs Tagesdaten (10).
 */
export async function inventurenNachfuellen(
  markeKey: number, heute: string,
): Promise<number> {
  const stand = await eine<{ letzte_seite: number; erp_ids: string | null }>(
    `SELECT coalesce((
              SELECT (s.payload->'payload'->'pagination'->>'totalPages')::int
                FROM raw.api_antwort s
               WHERE s.endpunkt = 'fn:inventuren'
                 -- Die Spalte casten, NICHT den Parameter: $1 wird unten
                 -- als integer gegen k.marke_key verwendet, und Postgres
                 -- legt den Typ eines Parameters für die ganze Abfrage
                 -- fest. Ein $1::text hier hiesse "integer = text" dort.
                 AND (s.parameter->>'markeKey')::int = $1
                 AND s.payload->'payload'->'pagination'->>'totalPages' IS NOT NULL
               ORDER BY s.abgerufen_am DESC
               LIMIT 1), 1) AS letzte_seite,
            (SELECT string_agg(k.erp_id::text, ',' ORDER BY k.erp_id)
               FROM core.kostenstelle k
              WHERE k.marke_key = $1 AND k.erp_id IS NOT NULL) AS erp_ids`,
    [markeKey])

  // Ohne Kostenstellen gäbe es keine erpIds — der Pfadbau würfe beim
  // Abarbeiten. Dann ist der Bestellungs-Backfill dieser Marke ohnehin
  // noch nicht gelaufen.
  if (!stand?.erp_ids) return 0

  const parameter = JSON.stringify({
    erpIds: stand.erp_ids,
    seite: String(Math.max(1, stand.letzte_seite)),
  })

  const r = await query(
    `INSERT INTO sync.warteschlange
       (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, marke_key, parameter)
     SELECT 'fn:inventuren', $1::date, $1::date, 20, $2, $3::jsonb
      WHERE NOT EXISTS (
            SELECT 1 FROM sync.warteschlange w
             WHERE w.endpunkt = 'fn:inventuren' AND w.marke_key = $2
               AND w.parameter = $3::jsonb AND w.erledigt_am IS NULL)
     RETURNING posten_id`,
    [heute, markeKey, parameter])

  return r.length
}

/**
 * Beides nachfüllen. Wirft NIE — ein Fehler beim Nachfüllen darf den
 * Lauf nicht verhindern: die Warteschlange enthält in aller Regel noch
 * Arbeit, und die soll getan werden. Gemeldet wird er trotzdem.
 */
/**
 * Ladenakte nachfuellen — Belegarchiv, BWA-Historie, Stammdatenblatt.
 *
 * EINGEREIHT WIRD NUR, WAS FEHLT. Grundlage ist `manual.belegarchiv_soll`:
 * die Vollzaehlung vom 11.08.2026, 1.048 Paare aus Betrieb und Belegart, davon
 * 621 nicht leer. Die 427 leeren werden gar nicht erst aufgerufen.
 *
 * Der Lauf ist damit selbstheilend und selbstbegrenzend: was einmal geholt ist,
 * steht in `core.belegarchiv_bestand` und wird nicht erneut eingereiht. Faellt
 * ein Posten aus, kommt er beim naechsten Lauf wieder.
 *
 * KEIN HANDBEFEHL. Der Erstabzug sind rund 1.400 Aufrufe und laeuft ueber
 * mehrere Sync-Laeufe von selbst durch — kein `einreihen --ladenakte`, das
 * jemand ausloesen muesste und dessen Ausfall niemandem auffiele. Genau daran
 * stand LINA am 02.08.2026 acht Tage still.
 *
 * `WHERE NOT EXISTS` statt `ON CONFLICT DO NOTHING`: der Eindeutigkeitsindex
 * auf der Warteschlange ist partiell (`WHERE erledigt_am IS NULL`), ein
 * Konflikt-Insert reiht also alles Erledigte erneut ein.
 */
export async function ladenakteNachfuellen(heute: string): Promise<number> {
  let n = 0

  // 1. Belegordner: je Betrieb und Belegart einer, aber nur wo Belege liegen
  //    und noch nichts abgerufen wurde.
  const belege = await query<{ lina_betrieb_id: number; typ_id: string }>(
    `SELECT s.lina_betrieb_id, s.typ_id
       FROM manual.belegarchiv_soll s
       JOIN core.betrieb b ON b.lina_betrieb_id = s.lina_betrieb_id
      WHERE s.soll_anzahl > 0
        AND NOT EXISTS (SELECT 1 FROM core.belegarchiv_bestand v
                         WHERE v.betrieb_key = b.betrieb_key AND v.typ_id = s.typ_id)
      ORDER BY s.lina_betrieb_id, s.typ_id`)

  for (const z of belege) {
    n += await einreihenWennNeu('la:belegliste', heute, PRIORITAET_LADENAKTE,
      { linaBetriebId: String(z.lina_betrieb_id), typeId: z.typ_id })
  }

  // 2. BWA-Historie und Stammdatenblatt: je Betrieb einer, hoechstens einmal
  //    im Kalendermonat. Beides sind Momentaufnahmen, die LINA ueberschreibt.
  const betriebe = await query<{ lina_betrieb_id: number }>(
    `SELECT b.lina_betrieb_id
       FROM core.betrieb b
      WHERE b.lina_betrieb_id IS NOT NULL
      ORDER BY b.lina_betrieb_id`)

  for (const key of ['la:bwa_longterm', 'la:stammdaten'] as const) {
    for (const z of betriebe) {
      const schonDiesenMonat = await eine<{ da: boolean }>(
        `SELECT EXISTS (
                  SELECT 1 FROM sync.aufgabe
                   WHERE endpunkt = $1
                     AND parameter->>'linaBetriebId' = $2
                     AND status = 'ok'
                     AND beendet_am >= date_trunc('month', current_date)) AS da`,
        [key, String(z.lina_betrieb_id)])
      if (schonDiesenMonat?.da) continue
      n += await einreihenWennNeu(key, heute, PRIORITAET_LADENAKTE,
        { linaBetriebId: String(z.lina_betrieb_id) })
    }
  }

  return n
}

/**
 * Hinter der Historie (90), vor der Nacharbeit. Die Ladenakte ist wertvoll,
 * aber nichts davon ist tagesaktuell — die Tagesdaten haben Vorrang.
 */
const PRIORITAET_LADENAKTE = 95

async function einreihenWennNeu(
  endpunkt: string, heute: string, prioritaet: number, parameter: Record<string, string>,
): Promise<number> {
  const r = await query<{ posten_id: number }>(
    `INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet, parameter)
     SELECT $1, $2::date, $2::date, $3, $4::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM sync.warteschlange w
                         WHERE w.endpunkt = $1 AND w.parameter = $4::jsonb)
     RETURNING posten_id`,
    [endpunkt, heute, prioritaet, JSON.stringify(parameter)])
  return r.length
}

export async function nachfuellen(): Promise<NachfuellStand> {
  const stand: NachfuellStand = { lina: 0, foodnotify: 0, ladenakte: 0 }

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

  try {
    stand.ladenakte = await ladenakteNachfuellen(geschaeftstag(new Date()))
  } catch (e) {
    log.error('nachfüllen ladenakte gescheitert — der Lauf geht weiter', { fehler: String(e) })
  }

  if (stand.lina > 0 || stand.foodnotify > 0 || stand.ladenakte > 0) {
    log.info('nachgefüllt', stand)
  }
  return stand
}
