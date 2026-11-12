/**
 * TPAPI Stufe 2, Schritt 2b: die roh gesicherten Antworten nach `core` (Plan
 * `docs/plan-tpapi-stufe2.md` §5 und §8; Migration `0153`).
 *
 * WAS HIER GELADEN WIRD
 *
 *   tpapi:journal              → core.kassenjournal + core.kassenjournal_finanzweg_tag
 *   tpapi:journaltables        → core.kassenbon
 *   tpapi:personalkostenprotag → core.personalkosten_tag (der Rohsatz ist schon die Summe, S5)
 *   tpapi:getforecastperday    → core.umsatzprognose_tag und, seit 0154, der Verlauf
 *                                core.umsatzprognose_beobachtung (je Abzug, in der Reihenfolge der Abrufe)
 *   tpapi:recipe               → core.tpapi_artikel        ┐
 *   tpapi:financetype          → core.tpapi_finanzweg      │ jeweils der JÜNGSTE Abzug
 *   tpapi:financecategory      → core.tpapi_finanzkategorie│ je Betrieb und Liste
 *   die übrigen zehn Listen    → core.tpapi_stammliste     ┘
 *
 * ÜBER `core_stand`, NICHT ÜBER EINE ZWEITE LISTE. Jeder Endpunkt hat eine
 * Laderversion (`LADERSTAND`); geladen wird, was `core_stand IS DISTINCT FROM`
 * dieser Version ist. Ändert sich ein Lader, erhöht man die Zahl, und der
 * Bestand lädt sich von selbst neu — aus `raw`, ohne einen einzigen Aufruf
 * (Regel 4, Plan S1). Die Version und der Horizont stehen zusätzlich in
 * `sync.tpapi_core_lader`, damit `mart.tpapi_core_stand` dieselbe Grenze
 * zieht wie dieser Lader.
 *
 * DIREKT IN SQL. Ein Journal hat 1–2 MB und 1.000–2.500 Zeilen; die zerlegt
 * PostgreSQL selbst (`jsonb_array_elements`), statt sie durch JavaScript zu
 * ziehen. Je Betrieb und Tag EINE Transaktion, idempotent: der Tag wird
 * gelöscht und neu geschrieben, Journal und Finanzwegsummen im selben Zug.
 *
 * DER ROHSATZ WIRD GESPERRT, NICHT NUR GELESEN. Die Abrufzeile wird mit
 * `FOR UPDATE` gelesen: holt Phase C denselben Tag gerade neu, wartet das
 * Schreiben des neuen Rohsatzes, bis dieser Lader fertig ist, und setzt
 * `core_stand` danach zurück. Ein Lader, der einen alten Rohsatz lädt und
 * den neuen als geladen markiert, ist damit ausgeschlossen.
 *
 * FEHLER JE TAG. Scheitert ein Tag, rollt seine Transaktion zurück, die
 * Meldung steht in `ladefehler`, der Lauf geht weiter. Nach drei Versuchen
 * mit derselben Laderversion versucht der Lader diesen Rohsatz nicht mehr
 * (`ladefehler endgueltig` in `mart.tpapi_core_stand`, Prüfzeile) — bis ein
 * neuer Rohsatz kommt oder ein neuer Lader. Ein Lauf versucht jeden Rohsatz
 * höchstens einmal (`ladefehler_am`). Wie `0136`: nicht endlos, aber sichtbar.
 *
 * WO ES LÄUFT. Phase A: `tpapiCoreTagesgeschaeft()` nach dem Rohabzug (in
 * `tpapiNachlauf()`), für die Fenstertage, den Artikelstamm und die Prognose —
 * die Fenstertage stehen damit vor Phase B in `core`. Phase C:
 * `tpapiCoreNachladen()` neben dem TPAPI-Nachladen, für den Bestand, neueste
 * zuerst, mit `TPAPI_CORE_JE_LAUF` und der Zeitgrenze `NACHLADEN_BIS`.
 *
 * NICHT INS LOG: kein Inhalt einer Antwort. Fehlermeldungen von PostgreSQL
 * können einen Feldwert zitieren („invalid input syntax for type integer:
 * …"); sie werden gekürzt und stehen nur in `ladefehler` — gecastet werden
 * nur Zahlenfelder, nie Freitext (`addinfo`, `debitor_text`).
 */
import type pg from 'pg'
import { config } from '../config'
import { log } from '../lib/log'
import { inTransaktion, query } from '../db/pool'
import { nachladenVorbei } from '../sync/worker'

/** Laderversion je Endpunkt — erhöhen, wenn sich ein Lader ändert. */
export const LADERSTAND: Readonly<Record<string, number>> = {
  'tpapi:journal': 1,
  'tpapi:journaltables': 1,
  'tpapi:personalkostenprotag': 1,
  /*
   * 2 seit 0154: der Lader schreibt zusätzlich den Verlauf
   * (core.umsatzprognose_beobachtung). Die Erhöhung lädt jeden gesicherten
   * Abzug noch einmal, chronologisch je Betrieb, aus raw — kein Aufruf.
   */
  'tpapi:getforecastperday': 2,
  'tpapi:recipe': 1,
  'tpapi:financetype': 1,
  'tpapi:financecategory': 1,
  'tpapi:attributes': 1,
  'tpapi:meccode': 1,
  'tpapi:vat': 1,
  'tpapi:pricelevel': 1,
  'tpapi:site': 1,
  'tpapi:operationprofile': 1,
  'tpapi:meccodegroup': 1,
  'tpapi:category': 1,
  'tpapi:detailcategory': 1,
  'tpapi:grosscategory': 1,
}

/** Die Tagesendpunkte, die dieser Lader kennt. */
export const TAGESENDPUNKTE = ['tpapi:journal', 'tpapi:journaltables', 'tpapi:personalkostenprotag'] as const
/** Journal und Bons haben einen Horizont (TPAPI_CORE_MONATE), alles andere nicht. */
const MIT_HORIZONT = new Set(['tpapi:journal', 'tpapi:journaltables'])
const PROGNOSE = 'tpapi:getforecastperday'
const ARTIKELSTAMM = Object.keys(LADERSTAND).filter(e =>
  !(TAGESENDPUNKTE as readonly string[]).includes(e) && e !== PROGNOSE)

/** So oft scheitert ein Rohsatz mit derselben Laderversion, bevor er liegen bleibt. */
export const HOECHSTENS_VERSUCHE = 3

/**
 * Phase A lädt die Tagesrohsätze der letzten sieben Tage: das Fenster des
 * Rohabzugs (3 Tage) plus Reserve für eine ausgefallene Nacht. Alles Ältere
 * ist Bestand und gehört Phase C.
 */
const FENSTER_PHASE_A_TAGE = 7

/** Felder des Journals mit eigener Spalte — alles andere mit Wert geht nach `zusatz`. */
const JOURNAL_SPALTEN = [
  'ID', 'datum', 'refdate', 'art', 'artnr', 'preis', 'zahl', 'tisch', 'ust', 'vat_id', 'kellnernr',
  'finanzweg', 'buchungsnr', 'tableheader_id', 'am_id', 'balance', 'terminal', 'masterkellnernr',
  'teamnr', 'zcount', 'parentid', 'site', 'situation', 'sortorder', 'addinfo', 'rabatt_id',
  'pricelevel_id', 'operationprofile_id', 'cancellationreason', 'captivesupplyreason',
]
/** Felder der Bons mit eigener Spalte. */
const BON_SPALTEN = [
  'tableheader_id', 'old_id', 'table_type', 'table_number', 'refdate', 'documentdate',
  'accounting_type', 'debitor_id', 'parent_id', 'archiveparent_id', 'debitor_text', 'reservation_id',
  'zcount', 'number_adults', 'number_kids', 'number_infants', 'renum', 'vat1sum', 'vat2sum', 'vat3sum',
  'finanzweg', 'zahl', 'kellnernr', 'is_archive', 'zip_code',
]
const ARTIKEL_SPALTEN = [
  'id', 'number', 'name', 'active', 'function', 'detailcategory', 'meccode', 'fixedwe',
  'quantitycontrol', 'currentquantity', 'productUse',
  // nicht nach core (S11: 31 MB je Betrieb), und die PHP-Reste der Antwort:
  'prices', 'attributes', '0', '1',
]

export type CoreErgebnis = {
  geladen: number
  zeilen: number
  leer: number
  auffaellig: number
  ladefehler: number
  /** Prognose: wie oft ein Betrieb neu aufgebaut wurde (0154, `prognoseLaden()`). */
  neuaufbau: number
}

const leer = (): CoreErgebnis => ({ geladen: 0, zeilen: 0, leer: 0, auffaellig: 0, ladefehler: 0, neuaufbau: 0 })

// ---------------------------------------------------------------------------
// Einstellung und Partitionen
// ---------------------------------------------------------------------------

/**
 * Laderstand und Horizont nach `sync.tpapi_core_lader` — zu Beginn jeder
 * Phase, damit die Sichten dieselbe Grenze ziehen wie der Lader.
 */
export async function laderEinstellen(): Promise<void> {
  const endpunkte = Object.keys(LADERSTAND)
  await query(
    `INSERT INTO sync.tpapi_core_lader (endpunkt, stand, horizont_monate, aktualisiert_am)
     SELECT e, s, h, now() FROM unnest($1::text[], $2::int[], $3::int[]) AS x(e, s, h)
     ON CONFLICT (endpunkt) DO UPDATE SET
       stand = excluded.stand, horizont_monate = excluded.horizont_monate,
       aktualisiert_am = CASE WHEN (sync.tpapi_core_lader.stand, sync.tpapi_core_lader.horizont_monate)
                                   IS DISTINCT FROM (excluded.stand, excluded.horizont_monate)
                              THEN now() ELSE sync.tpapi_core_lader.aktualisiert_am END`,
    [endpunkte, endpunkte.map(e => LADERSTAND[e]!),
     endpunkte.map(e => (MIT_HORIZONT.has(e) ? config.TPAPI_CORE_MONATE : null))])
}

/**
 * Die Monatspartition für einen Tag — AUSSERHALB der Datentransaktion und
 * einmal je Monat und Prozess (dieselbe Überlegung wie in `roh_laden.ts`:
 * eine zurückgerollte Transaktion soll keine Partition mitnehmen, die der
 * Merker schon als angelegt führt).
 */
const partitionen = new Set<string>()
async function partitionSichern(tabelle: 'core.kassenjournal' | 'core.kassenbon', tag: string): Promise<void> {
  const k = `${tabelle}:${tag.slice(0, 7)}`
  if (partitionen.has(k)) return
  await query(`SELECT core.partition_anlegen($1::regclass, $2::date)`, [tabelle, tag])
  partitionen.add(k)
}

// ---------------------------------------------------------------------------
// Der Rohsatz
// ---------------------------------------------------------------------------

type Rohsatz = { zeit: string; typ: string; leeresObjekt: boolean }

/**
 * Den Rohsatz finden. `raw.api_antwort` ist nach `abgerufen_am` partitioniert;
 * mit dem Zeitpunkt trifft die Suche genau eine Partition. Der Zeitpunkt ist
 * bekannt: Rohsatz und Abrufzeile entstehen in DERSELBEN Transaktion
 * (`roh_laden.ts`), `now()` ist dort für beide gleich. Passt er nicht (etwa ein
 * von Hand gesetzter Wert), wird über alle Partitionen gesucht.
 */
async function rohsatzFinden(c: pg.PoolClient, rawId: string, zeit: string | null): Promise<Rohsatz> {
  const sql = `SELECT abgerufen_am::text AS zeit, jsonb_typeof(payload) AS typ,
                      (payload = '{}'::jsonb) AS leer
                 FROM raw.api_antwort WHERE id = $1::bigint`
  let r = zeit ? (await c.query(`${sql} AND abgerufen_am = $2::timestamptz`, [rawId, zeit])).rows[0] : undefined
  if (!r) r = (await c.query(sql, [rawId])).rows[0]
  if (!r) throw new Error(`Rohsatz ${rawId} fehlt in raw.api_antwort`)
  if (r.typ === null) throw new Error(`Rohsatz ${rawId} hat keinen JSON-Inhalt`)
  return { zeit: r.zeit, typ: r.typ, leeresObjekt: r.leer === true }
}

/** Eine Liste erwartet: `[]` und `{}` sind leer, alles andere als eine Liste ist ein Formfehler. */
function listeErwarten(r: Rohsatz, was: string): void {
  if (r.typ === 'array' || r.leeresObjekt) return
  throw new Error(`${was}: Antwort ist keine Liste (JSON-Typ ${r.typ})`)
}

/** Die Messung eines Ladens als jsonb — nur, was auffällt; sonst null. */
function auffaellig(m: Record<string, unknown>): Record<string, unknown> | null {
  const aus: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(m)) {
    if (v === null || v === undefined) continue
    if (typeof v === 'number' && v === 0) continue
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) continue
    if (Array.isArray(v) && v.length === 0) continue
    aus[k] = v
  }
  return Object.keys(aus).length > 0 ? aus : null
}

// ---------------------------------------------------------------------------
// Die Tageslader
// ---------------------------------------------------------------------------

type TagMessung = { zeilen: number; messung: Record<string, unknown> | null }

/** Kassenjournal eines Betrieb-Tags. Wirft bei jedem Fehler. */
async function journalLaden(c: pg.PoolClient, b: number, tag: string, raw: Rohsatz, rawId: string): Promise<TagMessung> {
  await c.query(`DELETE FROM core.kassenjournal WHERE betrieb_key = $1 AND geschaeftstag = $2`, [b, tag])
  await c.query(`DELETE FROM core.kassenjournal_finanzweg_tag WHERE betrieb_key = $1 AND geschaeftstag = $2`, [b, tag])
  if (raw.leeresObjekt) return { zeilen: 0, messung: null }
  const r = await c.query(
    `WITH r AS (
       SELECT payload FROM raw.api_antwort WHERE id = $3::bigint AND abgerufen_am = $4::timestamptz
     ), src AS (
       SELECT (e->>'ID')::bigint                                   AS journal_id,
              to_timestamp(nullif(e->>'datum', '')::double precision) AS zeitpunkt,
              e->>'art'                                            AS art,
              nullif(e->>'artnr', '')::integer                     AS artnr,
              nullif(e->>'zahl', '')::numeric                      AS zahl,
              nullif(e->>'preis', '')::numeric                     AS preis,
              nullif(e->>'balance', '')::numeric                   AS balance,
              nullif(e->>'ust', '')::numeric                       AS ust,
              nullif(e->>'vat_id', '')::smallint                   AS vat_id,
              nullif(e->>'finanzweg', '')::integer                 AS finanzweg,
              nullif(e->>'tableheader_id', '')::bigint             AS tableheader_id,
              nullif(e->>'am_id', '')::bigint                      AS am_id,
              nullif(e->>'parentid', '')::bigint                   AS parentid,
              e->>'tisch'                                          AS tisch,
              e->>'buchungsnr'                                     AS buchungsnr,
              nullif(e->>'kellnernr', '')::integer                 AS kellnernr,
              nullif(e->>'masterkellnernr', '')::integer           AS masterkellnernr,
              nullif(e->>'teamnr', '')::integer                    AS teamnr,
              nullif(e->>'terminal', '')::integer                  AS terminal,
              nullif(e->>'zcount', '')::integer                    AS zcount,
              nullif(e->>'site', '')::integer                      AS site,
              nullif(e->>'situation', '')::smallint                AS situation,
              nullif(e->>'sortorder', '')::smallint                AS sortorder,
              nullif(e->>'rabatt_id', '')::integer                 AS rabatt_id,
              nullif(e->>'pricelevel_id', '')::integer             AS pricelevel_id,
              nullif(e->>'operationprofile_id', '')::integer       AS operationprofile_id,
              nullif(e->>'cancellationreason', '')::integer        AS cancellationreason,
              nullif(e->>'captivesupplyreason', '')::integer       AS captivesupplyreason,
              nullif(e->>'addinfo', '')                            AS addinfo,
              nullif(jsonb_strip_nulls(e - $5::text[]), '{}'::jsonb) AS zusatz,
              nullif(e->>'refdate', '')::double precision          AS refdate
         FROM r, jsonb_array_elements(r.payload) AS e
     ), ins AS (
       INSERT INTO core.kassenjournal
         (betrieb_key, geschaeftstag, journal_id, zeitpunkt, stunde, art, artnr, zahl, preis, balance,
          ust, vat_id, finanzweg, tableheader_id, am_id, parentid, tisch, buchungsnr, kellnernr,
          masterkellnernr, teamnr, terminal, zcount, site, situation, sortorder, rabatt_id,
          pricelevel_id, operationprofile_id, cancellationreason, captivesupplyreason, addinfo, zusatz)
       SELECT $1, $2::date, journal_id, zeitpunkt,
              extract(hour FROM zeitpunkt AT TIME ZONE core.geschaefts_zeitzone())::smallint,
              art, artnr, zahl, preis, balance, ust, vat_id, finanzweg, tableheader_id, am_id, parentid,
              tisch, buchungsnr, kellnernr, masterkellnernr, teamnr, terminal, zcount, site, situation,
              sortorder, rabatt_id, pricelevel_id, operationprofile_id, cancellationreason,
              captivesupplyreason, addinfo, zusatz
         FROM src
       RETURNING 1
     ), fw AS (
       INSERT INTO core.kassenjournal_finanzweg_tag
         (betrieb_key, geschaeftstag, finanzweg, zeilen, balance, netto, zeilen_artikel, menge_artikel,
          bons, rabatt_zeilen, rabatt_balance, storno_zeilen, storno_balance)
       SELECT $1, $2::date, finanzweg,
              count(*)::int,
              coalesce(sum(balance), 0),
              round(sum(balance / (1 + ust / 100)), 4),
              count(*) FILTER (WHERE artnr > 0)::int,
              sum(zahl) FILTER (WHERE artnr > 0),
              count(DISTINCT tableheader_id) FILTER (WHERE tableheader_id <> 0)::int,
              count(*) FILTER (WHERE rabatt_id <> 0)::int,
              coalesce(sum(balance) FILTER (WHERE rabatt_id <> 0), 0),
              count(*) FILTER (WHERE cancellationreason <> 0)::int,
              coalesce(sum(balance) FILTER (WHERE cancellationreason <> 0), 0)
         FROM src
        GROUP BY finanzweg
       RETURNING 1
     ), grenzen AS (
       SELECT ($2::date + time '08:00') AT TIME ZONE core.geschaefts_zeitzone()     AS beginn,
              ($2::date + 1 + time '08:00') AT TIME ZONE core.geschaefts_zeitzone() AS ende
     )
     SELECT (SELECT count(*) FROM ins)::int AS zeilen,
            (SELECT count(*) FROM fw)::int  AS finanzwege,
            count(*) FILTER (WHERE s.zeitpunkt IS NOT NULL
                               AND (s.zeitpunkt < g.beginn OR s.zeitpunkt >= g.ende))::int AS ausserhalb,
            count(*) FILTER (WHERE s.zeitpunkt IS NULL)::int AS ohne_zeitpunkt,
            count(*) FILTER (WHERE s.refdate IS NOT NULL
                               AND (to_timestamp(s.refdate) AT TIME ZONE core.geschaefts_zeitzone())::date
                                   <> $2::date)::int AS refdate_abweichend,
            coalesce(sum(s.balance), 0)::text AS saldo,
            (SELECT jsonb_object_agg(k, n) FROM (
               SELECT k, count(*)::int AS n FROM src, jsonb_object_keys(src.zusatz) AS k GROUP BY k) q) AS felder
       FROM src s CROSS JOIN grenzen g
      GROUP BY g.beginn, g.ende`,
    [b, tag, rawId, raw.zeit, JOURNAL_SPALTEN])
  const m = r.rows[0] ?? { zeilen: 0 }
  const saldo = Number(m.saldo ?? 0)
  return {
    zeilen: Number(m.zeilen ?? 0),
    messung: auffaellig({
      felder: m.felder ?? null,
      ausserhalb_geschaeftstag: Number(m.ausserhalb ?? 0),
      ohne_zeitpunkt: Number(m.ohne_zeitpunkt ?? 0),
      refdate_abweichend: Number(m.refdate_abweichend ?? 0),
      saldo: Math.abs(saldo) > 0.005 ? saldo : 0,
    }),
  }
}

/** Bons eines Betrieb-Tags. */
async function bonsLaden(c: pg.PoolClient, b: number, tag: string, raw: Rohsatz, rawId: string): Promise<TagMessung> {
  await c.query(`DELETE FROM core.kassenbon WHERE betrieb_key = $1 AND geschaeftstag = $2`, [b, tag])
  if (raw.leeresObjekt) return { zeilen: 0, messung: null }
  const r = await c.query(
    `WITH r AS (
       SELECT payload FROM raw.api_antwort WHERE id = $3::bigint AND abgerufen_am = $4::timestamptz
     ), src AS (
       SELECT (e->>'tableheader_id')::bigint                      AS tableheader_id,
              nullif(e->>'old_id', '')::bigint                    AS old_id,
              e->>'table_type'                                    AS table_type,
              e->>'table_number'                                  AS table_number,
              to_timestamp(nullif(e->>'documentdate', '')::double precision) AS dokument_zeitpunkt,
              e->>'accounting_type'                               AS accounting_type,
              nullif(e->>'debitor_id', '')::bigint                AS debitor_id,
              nullif(e->>'debitor_text', '')                      AS debitor_text,
              nullif(e->>'parent_id', '')::bigint                 AS parent_id,
              nullif(e->>'archiveparent_id', '')::bigint          AS archiveparent_id,
              nullif(e->>'reservation_id', '')::bigint            AS reservation_id,
              nullif(e->>'zcount', '')::integer                   AS zcount,
              nullif(e->>'number_adults', '')::integer            AS number_adults,
              nullif(e->>'number_kids', '')::integer              AS number_kids,
              nullif(e->>'number_infants', '')::integer           AS number_infants,
              nullif(e->>'renum', '')::bigint                     AS renum,
              nullif(e->>'vat1sum', '')::numeric                  AS vat1sum,
              nullif(e->>'vat2sum', '')::numeric                  AS vat2sum,
              nullif(e->>'vat3sum', '')::numeric                  AS vat3sum,
              nullif(e->>'finanzweg', '')::integer                AS finanzweg,
              nullif(e->>'zahl', '')::numeric                     AS zahl,
              nullif(e->>'kellnernr', '')::integer                AS kellnernr,
              nullif(e->>'is_archive', '')::smallint              AS is_archive,
              nullif(e->>'zip_code', '')                          AS zip_code,
              nullif(jsonb_strip_nulls(e - $5::text[]), '{}'::jsonb) AS zusatz,
              nullif(e->>'refdate', '')::double precision         AS refdate
         FROM r, jsonb_array_elements(r.payload) AS e
     ), ins AS (
       INSERT INTO core.kassenbon
         (betrieb_key, geschaeftstag, tableheader_id, old_id, table_type, table_number,
          dokument_zeitpunkt, stunde, accounting_type, debitor_id, debitor_text, parent_id,
          archiveparent_id, reservation_id, zcount, number_adults, number_kids, number_infants, renum,
          vat1sum, vat2sum, vat3sum, finanzweg, zahl, kellnernr, is_archive, zip_code, zusatz)
       SELECT $1, $2::date, tableheader_id, old_id, table_type, table_number, dokument_zeitpunkt,
              extract(hour FROM dokument_zeitpunkt AT TIME ZONE core.geschaefts_zeitzone())::smallint,
              accounting_type, debitor_id, debitor_text, parent_id, archiveparent_id, reservation_id,
              zcount, number_adults, number_kids, number_infants, renum, vat1sum, vat2sum, vat3sum,
              finanzweg, zahl, kellnernr, is_archive, zip_code, zusatz
         FROM src
       RETURNING 1
     ), grenzen AS (
       SELECT ($2::date + time '08:00') AT TIME ZONE core.geschaefts_zeitzone()     AS beginn,
              ($2::date + 1 + time '08:00') AT TIME ZONE core.geschaefts_zeitzone() AS ende
     )
     SELECT (SELECT count(*) FROM ins)::int AS zeilen,
            count(*) FILTER (WHERE s.dokument_zeitpunkt IS NOT NULL
                               AND (s.dokument_zeitpunkt < g.beginn OR s.dokument_zeitpunkt >= g.ende))::int AS ausserhalb,
            count(*) FILTER (WHERE s.refdate IS NOT NULL
                               AND (to_timestamp(s.refdate) AT TIME ZONE core.geschaefts_zeitzone())::date
                                   <> $2::date)::int AS refdate_abweichend,
            (SELECT jsonb_object_agg(k, n) FROM (
               SELECT k, count(*)::int AS n FROM src, jsonb_object_keys(src.zusatz) AS k GROUP BY k) q) AS felder
       FROM src s CROSS JOIN grenzen g
      GROUP BY g.beginn, g.ende`,
    [b, tag, rawId, raw.zeit, BON_SPALTEN])
  const m = r.rows[0] ?? { zeilen: 0 }
  return {
    zeilen: Number(m.zeilen ?? 0),
    messung: auffaellig({
      felder: m.felder ?? null,
      ausserhalb_geschaeftstag: Number(m.ausserhalb ?? 0),
      refdate_abweichend: Number(m.refdate_abweichend ?? 0),
    }),
  }
}

/** Personalkosten je Tag: der Rohsatz ist schon die Summe (S5). */
async function personalTagLaden(c: pg.PoolClient, b: number, tag: string, raw: Rohsatz, rawId: string): Promise<TagMessung> {
  if (raw.typ !== 'object') throw new Error(`personalkostenprotag: Rohsatz ist kein Objekt (JSON-Typ ${raw.typ})`)
  const r = await c.query(
    `INSERT INTO core.personalkosten_tag
       (betrieb_key, geschaeftstag, personen, h_brutto, h_zuschl_25, h_zuschl_40, h_zuschl_50,
        brutto, lohnkosten, unbekannte_felder, raw_id, geladen_am)
     SELECT $1, $2::date,
            coalesce(nullif(p->>'personen', '')::integer, 0),
            nullif(p->>'h_brutto', '')::numeric, nullif(p->>'h_zuschl_25', '')::numeric,
            nullif(p->>'h_zuschl_40', '')::numeric, nullif(p->>'h_zuschl_50', '')::numeric,
            nullif(p->>'brutto', '')::numeric, nullif(p->>'lohnkosten', '')::numeric,
            CASE WHEN jsonb_typeof(p->'unbekannte_felder') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p->'unbekannte_felder')) END,
            $3::bigint, now()
       FROM (SELECT payload AS p FROM raw.api_antwort
              WHERE id = $3::bigint AND abgerufen_am = $4::timestamptz) x
     ON CONFLICT (betrieb_key, geschaeftstag) DO UPDATE SET
       personen = excluded.personen, h_brutto = excluded.h_brutto,
       h_zuschl_25 = excluded.h_zuschl_25, h_zuschl_40 = excluded.h_zuschl_40,
       h_zuschl_50 = excluded.h_zuschl_50, brutto = excluded.brutto,
       lohnkosten = excluded.lohnkosten, unbekannte_felder = excluded.unbekannte_felder,
       raw_id = excluded.raw_id, geladen_am = now()
     RETURNING personen, unbekannte_felder`,
    [b, tag, rawId, raw.zeit])
  const z = r.rows[0]
  return {
    zeilen: z ? 1 : 0,
    messung: auffaellig({ unbekannte_felder: z?.unbekannte_felder ?? null }),
  }
}

type Tag = { betriebKey: number; endpunkt: string; tag: string }

/**
 * EINEN Rohsatz eines Tagesendpunkts nach core. Gibt `true` bei Erfolg; ein
 * Fehler steht danach in `ladefehler`. Wirft nur, wenn selbst das Vermerken
 * des Fehlers scheitert.
 */
async function tagLadenCore(t: Tag, e: CoreErgebnis): Promise<boolean> {
  const stand = LADERSTAND[t.endpunkt]!
  try {
    if (t.endpunkt === 'tpapi:journal') await partitionSichern('core.kassenjournal', t.tag)
    if (t.endpunkt === 'tpapi:journaltables') await partitionSichern('core.kassenbon', t.tag)
    const m = await inTransaktion(async c => {
      const a = (await c.query<{ raw_id: string; zeit: string | null; core_stand: number | null }>(
        `SELECT raw_id::text AS raw_id, coalesce(geaendert_am, erstmals_am)::text AS zeit, core_stand
           FROM core.tpapi_abruf
          WHERE betrieb_key = $1 AND endpunkt = $2 AND geschaeftstag = $3
          FOR UPDATE`, [t.betriebKey, t.endpunkt, t.tag])).rows[0]
      // Inzwischen geladen (oder verschwunden): nichts zu tun.
      if (!a || a.core_stand === stand) return null
      const raw = await rohsatzFinden(c, a.raw_id, a.zeit)
      let ergebnis: TagMessung
      if (t.endpunkt === 'tpapi:journal') {
        listeErwarten(raw, 'journal')
        ergebnis = await journalLaden(c, t.betriebKey, t.tag, raw, a.raw_id)
      } else if (t.endpunkt === 'tpapi:journaltables') {
        listeErwarten(raw, 'journaltables')
        ergebnis = await bonsLaden(c, t.betriebKey, t.tag, raw, a.raw_id)
      } else {
        ergebnis = await personalTagLaden(c, t.betriebKey, t.tag, raw, a.raw_id)
      }
      await c.query(
        `UPDATE core.tpapi_abruf SET
           core_stand = $4, core_geladen_am = now(), core_zeilen = $5, core_auffaellig = $6::jsonb,
           ladefehler = NULL, ladeversuche = 0, ladefehler_stand = NULL, ladefehler_am = NULL
         WHERE betrieb_key = $1 AND endpunkt = $2 AND geschaeftstag = $3`,
        [t.betriebKey, t.endpunkt, t.tag, stand, ergebnis.zeilen,
         ergebnis.messung ? JSON.stringify(ergebnis.messung) : null])
      return ergebnis
    })
    if (m) {
      e.geladen++
      e.zeilen += m.zeilen
      if (m.zeilen === 0) e.leer++
      if (m.messung) e.auffaellig++
    }
    return true
  } catch (err) {
    e.ladefehler++
    const meldung = String((err as Error)?.message ?? err).replace(/\s+/g, ' ').slice(0, 300)
    await query(
      `UPDATE core.tpapi_abruf SET
         ladefehler = $4,
         ladeversuche = CASE WHEN ladefehler_stand = $5 THEN least(ladeversuche + 1, 32767) ELSE 1 END,
         ladefehler_stand = $5,
         ladefehler_am = now()
       WHERE betrieb_key = $1 AND endpunkt = $2 AND geschaeftstag = $3`,
      [t.betriebKey, t.endpunkt, t.tag, meldung, stand])
    log.warn('tpapi core: Tag nicht geladen', {
      betrieb_key: t.betriebKey, endpunkt: t.endpunkt, tag: t.tag, fehler: meldung,
      sicht: 'mart.tpapi_core_stand',
    })
    return false
  }
}

/**
 * Die nächsten offenen Tagesrohsätze, neueste zuerst. `ab`: nur Tage ab hier
 * (Phase A: das Fenster); `seit`: nichts, was in diesem Lauf schon scheiterte.
 */
async function offeneTage(n: number, seit: string, ab: string | null): Promise<Tag[]> {
  const r = await query<{ betrieb_key: number; endpunkt: string; tag: string }>(
    `SELECT a.betrieb_key, a.endpunkt, a.geschaeftstag::text AS tag
       FROM core.tpapi_abruf a
       JOIN sync.tpapi_core_lader l ON l.endpunkt = a.endpunkt
      WHERE a.endpunkt = ANY($5::text[])
        AND a.core_stand IS DISTINCT FROM l.stand
        AND NOT (a.ladefehler IS NOT NULL AND a.ladeversuche >= $2 AND a.ladefehler_stand = l.stand)
        AND (a.ladefehler_am IS NULL OR a.ladefehler_am < $3::timestamptz)
        AND (mart.tpapi_core_ab(l.horizont_monate) IS NULL
             OR a.geschaeftstag >= mart.tpapi_core_ab(l.horizont_monate))
        AND ($4::date IS NULL OR a.geschaeftstag >= $4::date)
      ORDER BY a.geschaeftstag DESC, a.betrieb_key, a.endpunkt
      LIMIT $1`,
    [n, HOECHSTENS_VERSUCHE, seit, ab, [...TAGESENDPUNKTE]])
  return r.map(z => ({ betriebKey: Number(z.betrieb_key), endpunkt: z.endpunkt, tag: z.tag }))
}

// ---------------------------------------------------------------------------
// Artikelstamm und Prognose (core.tpapi_stammabzug)
// ---------------------------------------------------------------------------

type Abzug = { abzugId: string; betriebKey: number; endpunkt: string; rawId: string; abgerufen: string }

async function abzugFehler(a: Abzug, err: unknown, e: CoreErgebnis): Promise<void> {
  e.ladefehler++
  const meldung = String((err as Error)?.message ?? err).replace(/\s+/g, ' ').slice(0, 300)
  const stand = LADERSTAND[a.endpunkt]!
  await query(
    `UPDATE core.tpapi_stammabzug SET
       ladefehler = $2,
       ladeversuche = CASE WHEN ladefehler_stand = $3 THEN least(ladeversuche + 1, 32767) ELSE 1 END,
       ladefehler_stand = $3,
       ladefehler_am = now()
     WHERE abzug_id = $1`, [a.abzugId, meldung, stand])
  log.warn('tpapi core: Abzug nicht geladen', {
    betrieb_key: a.betriebKey, endpunkt: a.endpunkt, abzug_id: a.abzugId, fehler: meldung,
    sicht: 'mart.tpapi_core_stand',
  })
}

/**
 * Wann der Rohsatz eines Abzugs geschrieben wurde: beim Abzug mit `neu`, der
 * ihn angelegt hat (gleiche Transaktion, gleiches `now()`). Ein unveränderter
 * Abzug zeigt auf einen älteren Rohsatz.
 */
async function abzugRohzeit(c: pg.PoolClient, rawId: string, betriebKey: number, endpunkt: string): Promise<string | null> {
  const r = await c.query<{ zeit: string }>(
    `SELECT abgerufen_am::text AS zeit FROM core.tpapi_stammabzug
      WHERE raw_id = $1::bigint AND betrieb_key = $2 AND endpunkt = $3 AND neu
      ORDER BY abzug_id LIMIT 1`, [rawId, betriebKey, endpunkt])
  return r.rows[0]?.zeit ?? null
}

/** Die Namen der Warengruppen am Artikel nachziehen (detailcategory → category → grosscategory). */
async function artikelGruppenNachziehen(c: pg.PoolClient, betriebKey: number): Promise<void> {
  await c.query(
    `UPDATE core.tpapi_artikel a
        SET warengruppe = x.wg, kategorie = x.kat, hauptgruppe = x.hg
       FROM (SELECT a2.betrieb_key, a2.artikel_id, d.name AS wg, k.name AS kat, g.name AS hg
               FROM core.tpapi_artikel a2
               LEFT JOIN LATERAL (
                     SELECT s.name, s.rest FROM core.tpapi_stammliste s
                      WHERE s.betrieb_key = a2.betrieb_key AND s.liste = 'detailcategory'
                        AND s.id = a2.detailcategory
                      ORDER BY s.pos LIMIT 1) d ON true
               LEFT JOIN LATERAL (
                     SELECT s.name, s.rest FROM core.tpapi_stammliste s
                      WHERE s.betrieb_key = a2.betrieb_key AND s.liste = 'category'
                        AND s.id = nullif(d.rest->>'category', '')::integer
                      ORDER BY s.pos LIMIT 1) k ON true
               LEFT JOIN LATERAL (
                     SELECT s.name FROM core.tpapi_stammliste s
                      WHERE s.betrieb_key = a2.betrieb_key AND s.liste = 'grosscategory'
                        AND s.id = nullif(k.rest->>'grosscategory', '')::integer
                      ORDER BY s.pos LIMIT 1) g ON true
              WHERE a2.betrieb_key = $1) x
      WHERE a.betrieb_key = x.betrieb_key AND a.artikel_id = x.artikel_id
        AND (a.warengruppe, a.kategorie, a.hauptgruppe) IS DISTINCT FROM (x.wg, x.kat, x.hg)`,
    [betriebKey])
}

/** Eine Liste des Artikelstamms in ihre Tabelle. Gibt die Zahl der Zeilen zurück. */
async function stammListeLaden(c: pg.PoolClient, a: Abzug, rawZeit: string): Promise<number> {
  const liste = a.endpunkt.replace(/^tpapi:/, '')
  const p = [a.betriebKey, a.rawId, rawZeit, a.abzugId, a.abgerufen]
  const quelle = `FROM raw.api_antwort r, jsonb_array_elements(
                    CASE WHEN jsonb_typeof(r.payload) = 'array' THEN r.payload ELSE '[]'::jsonb END)
                    WITH ORDINALITY AS x(e, pos)
                  WHERE r.id = $2::bigint AND r.abgerufen_am = $3::timestamptz`
  if (liste === 'recipe') {
    await c.query(`DELETE FROM core.tpapi_artikel WHERE betrieb_key = $1`, [a.betriebKey])
    const r = await c.query(
      `INSERT INTO core.tpapi_artikel
         (betrieb_key, artikel_id, artikelnummer, name, aktiv, funktion, detailcategory, meccode,
          fixedwe, quantitycontrol, currentquantity, productuse, zusatz, abzug_id, stand_am)
       SELECT $1, (e->>'id')::integer, (e->>'number')::bigint, e->>'name',
              nullif(e->>'active', '')::boolean, e->>'function',
              nullif(e->>'detailcategory', '')::integer, nullif(e->>'meccode', '')::integer,
              nullif(e->>'fixedwe', '')::numeric, e->>'quantitycontrol',
              nullif(e->>'currentquantity', '')::numeric, nullif(e->>'productUse', '')::integer,
              nullif(jsonb_strip_nulls(e - $6::text[]), '{}'::jsonb), $4::bigint, $5::timestamptz
       ${quelle}`, [...p, ARTIKEL_SPALTEN])
    return r.rowCount ?? 0
  }
  if (liste === 'financetype') {
    await c.query(`DELETE FROM core.tpapi_finanzweg WHERE betrieb_key = $1`, [a.betriebKey])
    const r = await c.query(
      `INSERT INTO core.tpapi_finanzweg
         (betrieb_key, finanzweg_id, nummer, name, aktiv, kategorie_id, ist_trinkgeld, zusatz,
          abzug_id, stand_am)
       SELECT $1, (e->>'id')::integer, (e->>'number')::integer, e->>'name',
              nullif(e->>'active', '')::boolean, nullif(e->>'fin_category', '')::integer,
              nullif(e->>'is_tipp', '')::boolean,
              nullif(jsonb_strip_nulls(e - ARRAY['id','number','name','active','fin_category','is_tipp']), '{}'::jsonb),
              $4::bigint, $5::timestamptz
       ${quelle}`, p)
    return r.rowCount ?? 0
  }
  if (liste === 'financecategory') {
    await c.query(`DELETE FROM core.tpapi_finanzkategorie WHERE betrieb_key = $1`, [a.betriebKey])
    const r = await c.query(
      `INSERT INTO core.tpapi_finanzkategorie
         (betrieb_key, kategorie_id, nummer, name, aktiv, typ, abzug_id, stand_am)
       SELECT $1, (e->>'id')::integer, nullif(e->>'number', '')::integer, e->>'name',
              nullif(e->>'active', '')::boolean, e->>'type', $4::bigint, $5::timestamptz
       ${quelle}`, p)
    return r.rowCount ?? 0
  }
  await c.query(`DELETE FROM core.tpapi_stammliste WHERE betrieb_key = $1 AND liste = $2`, [a.betriebKey, liste])
  const r = await c.query(
    `INSERT INTO core.tpapi_stammliste (betrieb_key, liste, pos, id, nummer, name, aktiv, rest, abzug_id, stand_am)
     SELECT $1, $6, pos::integer,
            nullif(coalesce(e->>'id', e->>'attributeId'), '')::integer,
            nullif(e->>'number', '')::bigint,
            coalesce(e->>'name', e->>'attributeName'),
            e->>'active',
            nullif(jsonb_strip_nulls(e - ARRAY['id','number','name','active','attributeId','attributeName']), '{}'::jsonb),
            $4::bigint, $5::timestamptz
     ${quelle}`, [...p, liste])
  return r.rowCount ?? 0
}

/**
 * Der Artikelstamm: je Betrieb und Liste mit offenem Abzug wird der JÜNGSTE
 * Abzug geladen; ältere offene Abzüge derselben Liste gehen darin auf und
 * bekommen den Laderstand mit (core hält nur den jüngsten Stand).
 */
async function stammLaden(seit: string, e: CoreErgebnis): Promise<void> {
  const offen = await query<{
    abzug_id: string; betrieb_key: number; endpunkt: string; raw_id: string; abgerufen: string
    endgueltig: boolean; schon_versucht: boolean
  }>(
    `SELECT DISTINCT ON (s.betrieb_key, s.endpunkt)
            s.abzug_id::text AS abzug_id, s.betrieb_key, s.endpunkt, s.raw_id::text AS raw_id,
            s.abgerufen_am::text AS abgerufen,
            coalesce(s.ladefehler IS NOT NULL AND s.ladeversuche >= $2
                     AND s.ladefehler_stand = l.stand, false) AS endgueltig,
            coalesce(s.ladefehler_am >= $3::timestamptz, false) AS schon_versucht
       FROM core.tpapi_stammabzug s
       JOIN sync.tpapi_core_lader l ON l.endpunkt = s.endpunkt
      WHERE s.endpunkt = ANY($1::text[])
        AND EXISTS (SELECT 1 FROM core.tpapi_stammabzug o
                     WHERE o.betrieb_key = s.betrieb_key AND o.endpunkt = s.endpunkt
                       AND o.core_stand IS DISTINCT FROM l.stand)
      ORDER BY s.betrieb_key, s.endpunkt, s.abgerufen_am DESC, s.abzug_id DESC`,
    [ARTIKELSTAMM, HOECHSTENS_VERSUCHE, seit])
  const betriebe = new Set<number>()
  for (const z of offen) {
    // Der jüngste Abzug ist endgültig gescheitert oder in diesem Lauf schon versucht.
    if (z.endgueltig || z.schon_versucht) continue
    const a: Abzug = {
      abzugId: z.abzug_id, betriebKey: Number(z.betrieb_key), endpunkt: z.endpunkt,
      rawId: z.raw_id, abgerufen: z.abgerufen,
    }
    try {
      const zeilen = await inTransaktion(async c => {
        const raw = await rohsatzFinden(c, a.rawId, await abzugRohzeit(c, a.rawId, a.betriebKey, a.endpunkt))
        listeErwarten(raw, a.endpunkt)
        const n = await stammListeLaden(c, a, raw.zeit)
        await c.query(
          `UPDATE core.tpapi_stammabzug SET core_stand = $2, core_geladen_am = now(),
                  ladefehler = NULL, ladeversuche = 0, ladefehler_stand = NULL, ladefehler_am = NULL
            WHERE abzug_id = $1::bigint`, [a.abzugId, LADERSTAND[a.endpunkt]])
        await c.query(
          `UPDATE core.tpapi_stammabzug SET core_stand = $4
            WHERE betrieb_key = $1 AND endpunkt = $2 AND abgerufen_am <= $3::timestamptz
              AND core_stand IS DISTINCT FROM $4`,
          [a.betriebKey, a.endpunkt, a.abgerufen, LADERSTAND[a.endpunkt]])
        return n
      })
      e.geladen++
      e.zeilen += zeilen
      if (zeilen === 0) e.leer++
      betriebe.add(a.betriebKey)
    } catch (err) {
      await abzugFehler(a, err, e)
    }
  }
  // Die Warengruppennamen am Artikel hängen an vier Listen — nach jedem
  // Stammladen eines Betriebs neu ziehen, gleich welche Liste neu kam.
  for (const b of betriebe) {
    try {
      await inTransaktion(c => artikelGruppenNachziehen(c, b))
    } catch (err) {
      log.warn('tpapi core: Warengruppen am Artikel nicht nachgezogen', {
        betrieb_key: b, fehler: String((err as Error)?.message ?? err).slice(0, 300),
      })
    }
  }
}

/**
 * Ein Prognoseabzug in `core`: der Tageswert (`core.umsatzprognose_tag`, drei
 * Werte nebeneinander, 0153) und der Verlauf (`core.umsatzprognose_beobachtung`,
 * seit 0154). Gibt die Messung des Abzugs zurück. Wirft bei jedem Fehler.
 *
 * DER VERLAUF NIMMT AN, DASS DER ABZUG JÜNGER IST ALS ALLES, WAS FÜR DIESEN
 * BETRIEB SCHON IN CORE STEHT — eine Zeile je Tag bei der ersten Sichtung und
 * bei jeder Wertänderung, sonst rückt nur `zuletzt_gesehen_am` nach. Ob das
 * stimmt, prüft `prognoseLaden()` vorher (`neuAufbauNoetig()`); sonst baut es
 * den Betrieb neu auf.
 */
async function prognoseAnwenden(c: pg.PoolClient, a: Abzug, rawZeit: string): Promise<{
  tage: number; nichtMitternacht: number; ausserhalbBereich: number
}> {
  const r = await c.query(
    `WITH src AS (
       SELECT (to_timestamp((e->>'datum')::double precision) AT TIME ZONE core.geschaefts_zeitzone())::date AS tag,
              (e->>'datum')::double precision                AS roh,
              nullif(e->>'forecast', '')::numeric             AS wert
         FROM raw.api_antwort r, jsonb_array_elements(
                CASE WHEN jsonb_typeof(r.payload) = 'array' THEN r.payload ELSE '[]'::jsonb END) AS e
        WHERE r.id = $2::bigint AND r.abgerufen_am = $3::timestamptz
     ), ins AS (
       INSERT INTO core.umsatzprognose_tag AS p
         (betrieb_key, geschaeftstag, prognose_netto, abgerufen_am, erste_prognose_netto,
          erstmals_am, vorab_netto, vorab_am, geaendert_am, aenderungen, abzug_id, geladen_am)
       SELECT $1, s.tag, round(s.wert, 2), $4::timestamptz, round(s.wert, 2), $4::timestamptz,
              CASE WHEN $4::timestamptz < (s.tag + time '08:00') AT TIME ZONE core.geschaefts_zeitzone()
                   THEN round(s.wert, 2) END,
              CASE WHEN $4::timestamptz < (s.tag + time '08:00') AT TIME ZONE core.geschaefts_zeitzone()
                   THEN $4::timestamptz END,
              NULL, 0, $5::bigint, now()
         FROM src s
       ON CONFLICT (betrieb_key, geschaeftstag) DO UPDATE SET
         prognose_netto = CASE WHEN excluded.abgerufen_am >= p.abgerufen_am
                               THEN excluded.prognose_netto ELSE p.prognose_netto END,
         geaendert_am   = CASE WHEN excluded.abgerufen_am > p.abgerufen_am
                                AND excluded.prognose_netto IS DISTINCT FROM p.prognose_netto
                               THEN excluded.abgerufen_am ELSE p.geaendert_am END,
         aenderungen    = p.aenderungen
                          + CASE WHEN excluded.abgerufen_am > p.abgerufen_am
                                  AND excluded.prognose_netto IS DISTINCT FROM p.prognose_netto
                                 THEN 1 ELSE 0 END,
         abzug_id       = CASE WHEN excluded.abgerufen_am >= p.abgerufen_am
                               THEN excluded.abzug_id ELSE p.abzug_id END,
         abgerufen_am   = greatest(p.abgerufen_am, excluded.abgerufen_am),
         erste_prognose_netto = CASE WHEN excluded.erstmals_am < p.erstmals_am
                                     THEN excluded.erste_prognose_netto ELSE p.erste_prognose_netto END,
         erstmals_am    = least(p.erstmals_am, excluded.erstmals_am),
         vorab_netto    = CASE WHEN excluded.vorab_am IS NOT NULL
                                AND (p.vorab_am IS NULL OR excluded.vorab_am >= p.vorab_am)
                               THEN excluded.vorab_netto ELSE p.vorab_netto END,
         vorab_am       = CASE WHEN excluded.vorab_am IS NOT NULL
                                AND (p.vorab_am IS NULL OR excluded.vorab_am >= p.vorab_am)
                               THEN excluded.vorab_am ELSE p.vorab_am END,
         geladen_am     = now()
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM ins)::int AS tage,
            count(*) FILTER (WHERE (to_timestamp(s.roh) AT TIME ZONE core.geschaefts_zeitzone())::time
                                   <> time '00:00')::int AS nicht_mitternacht,
            count(*) FILTER (WHERE s.tag < st.von OR s.tag > st.bis)::int AS ausserhalb_bereich
       FROM src s CROSS JOIN (SELECT von, bis FROM core.tpapi_stammabzug WHERE abzug_id = $5::bigint) st`,
    [a.betriebKey, a.rawId, rawZeit, a.abgerufen, a.abzugId])

  /*
   * Der Verlauf (0154). Je Tag des Abzugs: ist der Wert derselbe wie in der
   * jüngsten Zeile dieses Tages, rückt nur nach, bis wann er gesehen wurde;
   * sonst (oder beim ersten Mal) eine neue Zeile. Ein Tag, der zweimal in
   * derselben Antwort steht, zählt mit seinem letzten Eintrag. vor_beginn wird
   * beim Schreiben festgehalten: gesehen vor 08:00 Berlin des Tages.
   */
  await c.query(
    `WITH src AS (
       SELECT DISTINCT ON (q.tag) q.tag, q.wert
         FROM (SELECT (to_timestamp((e->>'datum')::double precision)
                         AT TIME ZONE core.geschaefts_zeitzone())::date AS tag,
                      round(nullif(e->>'forecast', '')::numeric, 2)      AS wert,
                      x.ord
                 FROM raw.api_antwort r, jsonb_array_elements(
                        CASE WHEN jsonb_typeof(r.payload) = 'array' THEN r.payload ELSE '[]'::jsonb END)
                        WITH ORDINALITY AS x(e, ord)
                WHERE r.id = $2::bigint AND r.abgerufen_am = $3::timestamptz) q
        ORDER BY q.tag, q.ord DESC
     ), letzte AS (
       SELECT DISTINCT ON (o.geschaeftstag) o.geschaeftstag, o.abzug_id, o.wert
         FROM core.umsatzprognose_beobachtung o
        WHERE o.betrieb_key = $1 AND o.geschaeftstag IN (SELECT tag FROM src)
        ORDER BY o.geschaeftstag, o.gesehen_ab DESC, o.abzug_id DESC
     ), gleich AS (
       -- Ein schreibender CTE laeuft auch ungelesen, genau einmal.
       UPDATE core.umsatzprognose_beobachtung o
          SET zuletzt_gesehen_am = $4::timestamptz, zuletzt_abzug_id = $5::bigint,
              sichtungen = o.sichtungen + 1, aktualisiert_am = now()
         FROM src s JOIN letzte l ON l.geschaeftstag = s.tag
        WHERE o.betrieb_key = $1 AND o.geschaeftstag = l.geschaeftstag AND o.abzug_id = l.abzug_id
          AND o.wert IS NOT DISTINCT FROM s.wert
       RETURNING 1
     )
     INSERT INTO core.umsatzprognose_beobachtung
       (betrieb_key, geschaeftstag, abzug_id, gesehen_ab, wert, zuletzt_gesehen_am, zuletzt_abzug_id,
        sichtungen, vor_beginn, geladen_am, aktualisiert_am)
     SELECT $1, s.tag, $5::bigint, $4::timestamptz, s.wert, $4::timestamptz, $5::bigint, 1,
            $4::timestamptz < (s.tag + time '08:00') AT TIME ZONE core.geschaefts_zeitzone(),
            now(), now()
       FROM src s LEFT JOIN letzte l ON l.geschaeftstag = s.tag
      WHERE l.geschaeftstag IS NULL OR l.wert IS DISTINCT FROM s.wert`,
    [a.betriebKey, a.rawId, rawZeit, a.abgerufen, a.abzugId])

  const x = r.rows[0] ?? {}
  return {
    tage: Number(x.tage ?? 0),
    nichtMitternacht: Number(x.nicht_mitternacht ?? 0),
    ausserhalbBereich: Number(x.ausserhalb_bereich ?? 0),
  }
}

/**
 * Muss der Betrieb neu aufgebaut werden? Ja, sobald in `core` schon etwas
 * steht, das zur selben Zeit oder SPÄTER gesehen wurde als dieser Abzug —
 * dann käme der Abzug außer der Reihe, und der Verlauf („eine Zeile je
 * Änderung") wäre falsch. Das passiert in drei Fällen: nach einer neuen
 * Laderversion (der Bestand stammt vom alten Lader), wenn ein älterer Abzug
 * erst nach einem Ladefehler durchkommt, und wenn derselbe Abzug noch einmal
 * geladen wird (`>=`).
 */
async function neuAufbauNoetig(c: pg.PoolClient, a: Abzug): Promise<boolean> {
  const r = await c.query<{ neu: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM core.umsatzprognose_beobachtung
                     WHERE betrieb_key = $1 AND zuletzt_gesehen_am >= $2::timestamptz)
         OR EXISTS (SELECT 1 FROM core.umsatzprognose_tag
                     WHERE betrieb_key = $1 AND abgerufen_am >= $2::timestamptz) AS neu`,
    [a.betriebKey, a.abgerufen])
  return r.rows[0]?.neu === true
}

/**
 * Die Prognose: JEDER offene Abzug, in der Reihenfolge der Abrufe — jeder ist
 * eine Beobachtung (auch ein unveränderter: er sagt, dass der Wert zu diesem
 * Zeitpunkt noch galt). Die Regel, was überschrieben wird, steht am
 * Upsert und in `0153` (core.umsatzprognose_tag), die des Verlaufs in `0154`.
 *
 * DER NEUAUFBAU JE BETRIEB (0154). Der Verlauf hängt an der Reihenfolge. Kommt
 * ein Abzug außer der Reihe (`neuAufbauNoetig()`), werden Tageswerte und
 * Verlauf DIESES Betriebs gelöscht und aus allen Abzügen, die mit dem
 * aktuellen Laderstand geladen sind, plus diesem, chronologisch neu
 * geschrieben — in derselben Transaktion, aus `raw`, ohne einen Aufruf. Nach
 * einer neuen Laderversion trifft das den ältesten Abzug jedes Betriebs (er
 * findet nur Zeilen des alten Laders und baut mit sich allein neu auf); alle
 * weiteren hängen sich danach in der Reihe an. Dasselbe Ergebnis wie ein
 * Laden in der Reihe — `core_laden.test.ts` prüft es Zeile für Zeile.
 */
async function prognoseLaden(seit: string, e: CoreErgebnis, hoechstens: number): Promise<number> {
  const offen = await query<{ abzug_id: string; betrieb_key: number; raw_id: string; abgerufen: string }>(
    `SELECT s.abzug_id::text AS abzug_id, s.betrieb_key, s.raw_id::text AS raw_id,
            s.abgerufen_am::text AS abgerufen
       FROM core.tpapi_stammabzug s
       JOIN sync.tpapi_core_lader l ON l.endpunkt = s.endpunkt
      WHERE s.endpunkt = $1
        AND s.core_stand IS DISTINCT FROM l.stand
        AND NOT (s.ladefehler IS NOT NULL AND s.ladeversuche >= $2 AND s.ladefehler_stand = l.stand)
        AND (s.ladefehler_am IS NULL OR s.ladefehler_am < $3::timestamptz)
      ORDER BY s.abgerufen_am, s.abzug_id
      LIMIT $4`, [PROGNOSE, HOECHSTENS_VERSUCHE, seit, hoechstens])
  for (const z of offen) {
    const a: Abzug = {
      abzugId: z.abzug_id, betriebKey: Number(z.betrieb_key), endpunkt: PROGNOSE,
      rawId: z.raw_id, abgerufen: z.abgerufen,
    }
    try {
      const m = await inTransaktion(async c => {
        const raw = await rohsatzFinden(c, a.rawId, await abzugRohzeit(c, a.rawId, a.betriebKey, a.endpunkt))
        listeErwarten(raw, 'getforecastperday')
        let x: Awaited<ReturnType<typeof prognoseAnwenden>> | undefined
        if (await neuAufbauNoetig(c, a)) {
          await c.query(`DELETE FROM core.umsatzprognose_beobachtung WHERE betrieb_key = $1`, [a.betriebKey])
          await c.query(`DELETE FROM core.umsatzprognose_tag WHERE betrieb_key = $1`, [a.betriebKey])
          const reihe = await c.query<{ abzug_id: string; raw_id: string; abgerufen: string }>(
            `SELECT abzug_id::text AS abzug_id, raw_id::text AS raw_id, abgerufen_am::text AS abgerufen
               FROM core.tpapi_stammabzug
              WHERE betrieb_key = $1 AND endpunkt = $2
                AND (core_stand = $3 OR abzug_id = $4::bigint)
              ORDER BY abgerufen_am, abzug_id`,
            [a.betriebKey, PROGNOSE, LADERSTAND[PROGNOSE], a.abzugId])
          for (const w of reihe.rows) {
            if (w.abzug_id === a.abzugId) {
              x = await prognoseAnwenden(c, a, raw.zeit)
              continue
            }
            const fruehere: Abzug = {
              abzugId: w.abzug_id, betriebKey: a.betriebKey, endpunkt: PROGNOSE, rawId: w.raw_id, abgerufen: w.abgerufen,
            }
            const rw = await rohsatzFinden(c, w.raw_id, await abzugRohzeit(c, w.raw_id, a.betriebKey, PROGNOSE))
            listeErwarten(rw, 'getforecastperday')
            await prognoseAnwenden(c, fruehere, rw.zeit)
          }
          e.neuaufbau++
        }
        x ??= await prognoseAnwenden(c, a, raw.zeit)
        const messung = auffaellig({
          nicht_berliner_mitternacht: x.nichtMitternacht,
          ausserhalb_bereich: x.ausserhalbBereich,
        })
        await c.query(
          `UPDATE core.tpapi_stammabzug SET core_stand = $2, core_geladen_am = now(), core_auffaellig = $3::jsonb,
                  ladefehler = NULL, ladeversuche = 0, ladefehler_stand = NULL, ladefehler_am = NULL
            WHERE abzug_id = $1::bigint`,
          [a.abzugId, LADERSTAND[PROGNOSE], messung ? JSON.stringify(messung) : null])
        return { tage: x.tage, messung }
      })
      e.geladen++
      e.zeilen += m.tage
      if (m.tage === 0) e.leer++
      if (m.messung) e.auffaellig++
    } catch (err) {
      await abzugFehler(a, err, e)
    }
  }
  return offen.length
}

// ---------------------------------------------------------------------------
// Die beiden Einstiege
// ---------------------------------------------------------------------------

async function merkerSchreiben(phase: string, e: CoreErgebnis, extra: Record<string, unknown> = {}): Promise<void> {
  await query(
    `INSERT INTO sync.merker (schluessel, wert)
     VALUES ('tpapi_core', jsonb_build_object(
       'beendet_am', now(), 'ok', $1::boolean, 'fehler', $2::text, 'phase', $3::text,
       'geladen', $4::int, 'zeilen', $5::bigint, 'leer', $6::int, 'auffaellig', $7::int,
       'ladefehler', $8::int) || $9::jsonb)
     ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert, gesetzt_am = now()`,
    [e.ladefehler === 0, e.ladefehler > 0 ? `${e.ladefehler} Ladefehler raw -> core` : null, phase,
     e.geladen, e.zeilen, e.leer, e.auffaellig, e.ladefehler, JSON.stringify(extra)],
  ).catch(err => log.warn('merker tpapi_core nicht geschrieben', { fehler: String(err).slice(0, 200) }))
}

/** Die Uhr der Datenbank — gegen sie wird `ladefehler_am` verglichen, nicht gegen die des Prozesses. */
async function jetztInDb(): Promise<string> {
  return (await query<{ t: string }>(`SELECT now()::text AS t`))[0]!.t
}

/**
 * Phase A: der Artikelstamm, die Prognose und die Tagesrohsätze der letzten
 * sieben Tage — alles, was der Rohabzug dieser Nacht geholt hat. Ohne
 * Obergrenze: das Fenster ist durch sich selbst begrenzt (41 Betriebe × 3
 * Endpunkte × 7 Tage). Wirft nie.
 */
export async function tpapiCoreTagesgeschaeft(): Promise<'ok' | 'teilweise'> {
  const e = leer()
  try {
    const seit = await jetztInDb()
    await laderEinstellen()
    await stammLaden(seit, e)
    await prognoseLaden(seit, e, 100_000)
    const ab = (await query<{ ab: string }>(
      `SELECT (current_date - $1::int)::text AS ab`, [FENSTER_PHASE_A_TAGE]))[0]!.ab
    // Höchstens 200 Runden — das Fenster hat bei 41 Betrieben unter 1.000 Rohsätze;
    // mehr hiesse, dass etwas immer wieder als offen erscheint.
    for (let runde = 0; runde < 200; runde++) {
      const tage = await offeneTage(500, seit, ab)
      if (tage.length === 0) break
      for (const t of tage) await tagLadenCore(t, e)
    }
  } catch (err) {
    e.ladefehler++
    log.error('tpapi core (phase a) fehlgeschlagen — der Sync-Lauf geht weiter', {
      fehler: String((err as Error)?.message ?? err).slice(0, 300),
    })
  }
  await merkerSchreiben('tagesgeschaeft', e)
  log.info('tpapi core tagesgeschaeft', { ...e, sicht: 'mart.tpapi_core_stand' })
  return e.ladefehler > 0 ? 'teilweise' : 'ok'
}

export type CoreNachladenOptionen = {
  /**
   * Die TPAPI-Spur von Phase C. Solange sie läuft, bringt sie neue Rohsätze;
   * der Lader wartet dann auf Nachschub, statt sich zu beenden.
   */
  abholung?: Promise<unknown>
  /** Für Tests: eigene Zeitgrenze statt `NACHLADEN_BIS`. */
  ende?: () => string | null
  /** Für Tests: wie lange höchstens auf Nachschub gewartet wird (ms). */
  wartenMs?: number
}

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Phase C: der Bestand, neueste zuerst, höchstens `TPAPI_CORE_JE_LAUF`
 * Rohsätze, nie über `NACHLADEN_BIS` hinaus. Läuft NEBEN der TPAPI-Spur
 * (`abholung`) und lädt, was sie bringt — ein Lader hinter der Spur bekäme
 * bei 50.000 Aufrufen je Nacht keine Minute mehr. Wirft nie.
 */
export async function tpapiCoreNachladen(opt: CoreNachladenOptionen = {}): Promise<'ok' | 'teilweise' | 'uebersprungen'> {
  const e = leer()
  const beginn = new Date()
  const grenze = config.TPAPI_CORE_JE_LAUF
  if (grenze === 0) {
    log.info('tpapi core nachladen aus (TPAPI_CORE_JE_LAUF = 0)', { sicht: 'mart.tpapi_core_stand' })
    return 'uebersprungen'
  }
  let spurFertig = !opt.abholung
  opt.abholung?.then(() => { spurFertig = true }, () => { spurFertig = true })
  const ende = opt.ende ?? (() =>
    nachladenVorbei(new Date(), beginn, config.NACHLADEN_BIS)
      ? `Nachladen-Ende erreicht (${config.NACHLADEN_BIS} Uhr Ortszeit)` : null)
  let abbruch: string | null = null
  let versuche = 0
  try {
    const seit = await jetztInDb()
    await laderEinstellen()
    for (;;) {
      abbruch = ende()
      if (abbruch) break
      if (versuche >= grenze) { abbruch = `Obergrenze ${grenze} erreicht`; break }
      const vorher = e.geladen + e.ladefehler
      await stammLaden(seit, e)
      await prognoseLaden(seit, e, Math.min(500, grenze - versuche))
      versuche += e.geladen + e.ladefehler - vorher
      const tage = await offeneTage(Math.min(200, Math.max(0, grenze - versuche)), seit, null)
      for (const t of tage) {
        abbruch = ende()
        if (abbruch) break
        await tagLadenCore(t, e)
        versuche++
      }
      if (abbruch) break
      if (tage.length === 0 && e.geladen + e.ladefehler === vorher) {
        if (spurFertig) break
        await Promise.race([opt.abholung, schlaf(opt.wartenMs ?? 30_000)])
      }
    }
  } catch (err) {
    e.ladefehler++
    log.error('tpapi core (phase c) fehlgeschlagen — der Sync-Lauf geht weiter', {
      fehler: String((err as Error)?.message ?? err).slice(0, 300),
    })
  }
  let wartend: number | null = null
  try {
    const r = await query<{ n: number }>(
      `SELECT coalesce(sum(wartend), 0)::int AS n FROM mart.tpapi_core_stand`)
    wartend = r[0]?.n ?? null
  } catch { /* Beiwerk */ }
  await merkerSchreiben('nachladen', e, { abbruch, wartend_danach: wartend })
  log.info('tpapi core nachladen', { ...e, abbruch, obergrenze: grenze, wartend_danach: wartend, sicht: 'mart.tpapi_core_stand' })
  return e.ladefehler > 0 ? 'teilweise' : 'ok'
}
