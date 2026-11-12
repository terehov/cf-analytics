/**
 * Der Speicherwächter (Migration 0152): wie viel ist frei, wie schnell wächst
 * es, wann ist es voll.
 *
 * ANLASS (12.11.2026). Der Server hat EINE Platte (Hetzner CX43, 150 GB), auf
 * der Postgres, Docker-Images, Build-Cache und Logs liegen. Der TPAPI-Rohabzug
 * (0151) legt in zwei Wochen geschätzt 12–45 GB dazu, Schritt 2b noch einmal
 * so viel. Hochskalieren heißt bei Hetzner: Server aus, umziehen, an — das
 * will man planen und nicht unter Druck tun, wenn PostgreSQL schon anhält.
 *
 * DREI TEILE, EINE WAHRHEIT:
 *   speicherMessen()      schreibt je Lauf eine Zeile in sync.speicher_messung
 *   mart.speicher_stand   rechnet daraus Verbrauch, Prognose und den befund
 *                         (SQL, nicht hier — Metabase, MCP, /status und die
 *                         Nachricht lesen dieselbe Zeile)
 *   speicherPruefung()    übersetzt den befund in eine Prüfung für /status
 *                         und damit für die Nachricht nach dem Lauf
 *
 * DIE ANNAHME ZUR PLATTE — und wann sie nicht mehr gilt.
 * Gemessen wird mit statfs im IMPORTER-Container, Pfad `SPEICHER_PFAD`
 * (Vorgabe `/`). Das Overlay-Dateisystem des Containers liegt unter
 * /var/lib/docker auf der Host-Platte, und das Postgres-Volume (Dokploy,
 * Managed Database) ebenfalls: im `df -h` des Hosts zeigen alle
 * `overlay`-Einträge dieselben 150G/46G/99G wie `/dev/sda1` (12.11.2026).
 * statfs('/') im Container sieht damit dieselbe Platte wie die Datenbank.
 * DAS IST EINE ANNAHME, bis es im Container nachgemessen ist
 * (`docker exec <importer> df -h /` gegen `df -h /` auf dem Host).
 * Sie bricht, sobald die Datenbank auf einem eigenen Volume (Hetzner Volume,
 * eigener Mount) oder einem eigenen Server liegt: dann misst dies die falsche
 * Platte und meldet womöglich „ok", während die Datenbankplatte vollläuft.
 * Den häufigsten Fall merkt der Wächter selbst: ist die Datenbank größer als
 * der belegte Teil der gemessenen Platte, heißt der befund `falsche platte`.
 * Liegt die Datenbank auf einer anderen, GRÖSSEREN Platte und die gemessene
 * ist zufällig voller als die Datenbank groß, merkt er es nicht — dann muss
 * `SPEICHER_PFAD` auf einen Mount der Datenbankplatte zeigen.
 *
 * WARUM AM LAUFENDE, nicht in Phase B: Phase C schreibt den TPAPI-Rückstand
 * und die Konzern-Historie, also gerade das, was wächst. Am Ende gemessen
 * zählt die Nacht vollständig, und die Nachricht direkt danach trägt eine
 * Messung von vor einer Minute statt von vor zwanzig Stunden. Auch ein
 * abgebrochener Lauf misst (sync.ts) — sonst stünde der Wächter nach zwei
 * Abbrüchen auf „keine messung", obwohl nur der Import scheiterte.
 *
 * WIRFT NIE. Eine Messung, die scheitert, darf keinen Lauf scheitern lassen;
 * sie landet als Fehler im Log, und am nächsten Tag zeigt der befund
 * „keine messung", wenn es dabei bleibt (Regel 10: das steht in der
 * Datenbank, nicht nur im Log).
 */
import { promises as fs } from 'node:fs'
import type { PoolClient } from 'pg'
import { config } from '../config'
import { eine, pool } from '../db/pool'
import { log } from '../lib/log'
import type { Pruefung } from '../status'

// --- Messen -------------------------------------------------------------------

export type Platte = { gesamt: number; belegt: number; frei: number }

/** Die Felder von statfs, die wir brauchen — als Typ, damit Tests eine Attrappe geben können. */
export type StatfsErgebnis = { bsize: number; frsize?: number; blocks: number; bfree: number; bavail: number }
export type Statfs = (pfad: string) => Promise<StatfsErgebnis>

/**
 * Platte wie `df`: Size = blocks, Used = blocks − bfree, Avail = bavail.
 * `frei` ist bavail, nicht bfree: die Root-Reserve (ext4: 5 %) kann PostgreSQL
 * nicht benutzen, und auf genau diesen Platz kommt es an.
 * Die Blockzahlen stehen in frsize-Einheiten; wo frsize fehlt, gilt bsize.
 */
export async function platteMessen(pfad: string, statfs: Statfs = fs.statfs as unknown as Statfs)
  : Promise<{ platte: Platte | null; fehler: string | null }> {
  try {
    const s = await statfs(pfad)
    const block = Number(s.frsize || s.bsize)
    const gesamt = Number(s.blocks) * block
    const platte = {
      gesamt,
      belegt: (Number(s.blocks) - Number(s.bfree)) * block,
      frei: Number(s.bavail) * block,
    }
    if (!(gesamt > 0) || ![platte.belegt, platte.frei].every(n => Number.isFinite(n) && n >= 0)) {
      return { platte: null, fehler: `statfs(${pfad}) lieferte unplausible Werte: ${JSON.stringify(s)}` }
    }
    return { platte, fehler: null }
  } catch (e) {
    return { platte: null, fehler: `statfs(${pfad}): ${String(e).slice(0, 200)}` }
  }
}

/** Großzügig: über ein paar tausend Partitionen braucht das Zählen Sekunden, nicht Minuten. */
const ZEITGRENZE_MS = 2 * 60 * 1000

export type Messung = {
  status: 'gemessen' | 'ohne_platte' | 'fehler'
  meldung?: string
}

/**
 * Misst Platte und Datenbank und schreibt EINE Zeile. Wirft nie.
 * `ohne_platte` = statfs scheiterte, die Datenbankgrößen stehen trotzdem da.
 */
/** Was speicherMessen von einer Verbindung braucht — der Test reicht seinen eigenen Client herein. */
export type Abfrager = { query: (sql: string, werte?: unknown[]) => Promise<{ rows: any[] }> }

export async function speicherMessen(laufId: string | null,
  opt: { pfad?: string; statfs?: Statfs; db?: Abfrager } = {}): Promise<Messung> {
  const pfad = opt.pfad ?? config.SPEICHER_PFAD
  const { platte, fehler } = await platteMessen(pfad, opt.statfs)

  /*
   * Eigene Verbindung aus dem Pool — SET statement_timeout gilt je Sitzung
   * (deckungsbeitrag.ts). Mit opt.db (nur Tests) die gereichte Verbindung:
   * so schreibt ein Test in TEST_DATABASE_URL und nie über den Pool in die
   * Arbeitsdatenbank aus DATABASE_URL.
   */
  let eigen: PoolClient | undefined
  try {
    const client: Abfrager = opt.db ?? (eigen = await pool.connect())
    await client.query(`SET statement_timeout = ${ZEITGRENZE_MS}`)

    /*
     * Alles in EINER Abfrage, damit alle Zahlen vom selben Augenblick sind.
     *
     * je_schema: Tabellen und materialisierte Sichten (relkind r, m) mit
     * pg_total_relation_size — das schließt Indizes und TOAST ein, deshalb
     * zählen Indizes (i) und TOAST-Tabellen (t) nicht noch einmal. Ein
     * partitioniertes Elternteil (p) hat selbst keinen Platz; seine
     * Partitionen liegen physisch im Schema `part`, zählen hier aber beim
     * Schema der ELTERNTABELLE — sonst stünde raw bei null und `part` als
     * größter Posten da, und niemand wüsste, wem er gehört.
     *
     * raw: raw.api_antwort über pg_partition_tree — die Elterntabelle liefert
     * 0, die Partitionen den Rest. to_regclass, damit eine Datenbank ohne die
     * Tabelle 0 meldet statt zu scheitern.
     *
     * groesste: Partitionen über pg_partition_root zur Elterntabelle
     * zusammengefasst, sonst stünden zehn Monatsscheiben derselben Tabelle da.
     */
    const r = await client.query(`
      WITH rel AS (
        SELECT c.oid, coalesce(pg_partition_root(c.oid), c.oid) AS wurzel,
               pg_total_relation_size(c.oid) AS bytes
          FROM pg_class c
         WHERE c.relkind IN ('r', 'm')
      ),
      schema_summe AS (
        SELECT wn.nspname, sum(rel.bytes)::bigint AS bytes
          FROM rel
          JOIN pg_class w      ON w.oid = rel.wurzel
          JOIN pg_namespace wn ON wn.oid = w.relnamespace
         GROUP BY wn.nspname
      ),
      gross AS (
        SELECT wn.nspname || '.' || w.relname AS relation,
               sum(rel.bytes)::bigint AS bytes, count(*)::int AS teile
          FROM rel
          JOIN pg_class w      ON w.oid = rel.wurzel
          JOIN pg_namespace wn ON wn.oid = w.relnamespace
         WHERE wn.nspname NOT IN ('pg_catalog', 'information_schema')
         GROUP BY 1
         ORDER BY 2 DESC
         LIMIT 10
      )
      SELECT pg_database_size(current_database())::bigint AS db_bytes,
             CASE WHEN to_regclass('raw.api_antwort') IS NULL THEN 0
                  ELSE (SELECT coalesce(sum(pg_total_relation_size(t.relid)), 0)::bigint
                          FROM pg_partition_tree(to_regclass('raw.api_antwort')) t)
             END AS raw_bytes,
             (SELECT coalesce(jsonb_object_agg(nspname, bytes), '{}'::jsonb) FROM schema_summe) AS je_schema,
             (SELECT coalesce(jsonb_agg(jsonb_build_object('relation', relation, 'bytes', bytes, 'teile', teile)
                                        ORDER BY bytes DESC), '[]'::jsonb) FROM gross) AS groesste`)
    const g = r.rows[0]

    await client.query(
      `INSERT INTO sync.speicher_messung
         (lauf_id, pfad, platte_gesamt, platte_belegt, platte_frei, platte_fehler,
          db_bytes, raw_bytes, je_schema, groesste)
       VALUES ($1::bigint, $2, $3::bigint, $4::bigint, $5::bigint, $6, $7::bigint, $8::bigint, $9::jsonb, $10::jsonb)`,
      [laufId, pfad,
       platte ? Math.round(platte.gesamt) : null,
       platte ? Math.round(platte.belegt) : null,
       platte ? Math.round(platte.frei) : null,
       fehler, g.db_bytes, g.raw_bytes, JSON.stringify(g.je_schema), JSON.stringify(g.groesste)])

    return platte ? { status: 'gemessen' } : { status: 'ohne_platte', meldung: fehler ?? undefined }
  } catch (e) {
    return { status: 'fehler', meldung: String(e).slice(0, 300) }
  } finally {
    const client = opt.db ?? eigen
    if (client) {
      try { await client.query(`SET statement_timeout = 0`) } catch { /* egal */ }
    }
    eigen?.release()
  }
}

/** Der Aufruf am Laufende: misst und protokolliert, ohne je zu werfen. */
export async function speicherNachlauf(laufId: string | null): Promise<void> {
  try {
    const m = await speicherMessen(laufId)
    if (m.status === 'gemessen') {
      const s = await speicherStand()
      log.info('speicher gemessen', {
        befund: s?.befund, frei_gb: s?.frei_gb, frei_pct: s?.frei_pct,
        verbrauch_gb_tag: s?.verbrauch_prognose_gb_tag, datum_voll: s?.datum_voll,
      })
    } else if (m.status === 'ohne_platte') {
      log.error('speicher: platte nicht messbar, nur die datenbank gemessen', { grund: m.meldung })
    } else {
      // ERROR, nicht WARN — dieselbe Begründung wie in pflichtartikel_sichten.ts.
      log.error('speicher nicht gemessen', { grund: m.meldung })
    }
  } catch (e) {
    log.error('speicher-nachlauf hat geworfen — der lauf geht weiter', { fehler: String(e).slice(0, 300) })
  }
}

// --- Lesen und bewerten -------------------------------------------------------

export type SpeicherBefund = 'ok' | 'beobachten' | 'hochskalieren' | 'dringend' | 'keine messung' | 'falsche platte'

/** Die Spalten von mart.speicher_stand, die /status und die Nachricht brauchen. numeric kommt als Text. */
export type SpeicherStand = {
  befund: SpeicherBefund
  befund_text: string
  messungen: number
  alter_stunden: string | number | null
  frei_gb: string | number | null
  frei_pct: string | number | null
  db_gb: string | number | null
  raw_gb: string | number | null
  verbrauch_prognose_gb_tag: string | number | null
  db_wachstum_7t_gb_tag: string | number | null
  tage_bis_voll: number | null
  datum_voll: string | null
  tage_bis_warnschwelle: number | null
  datum_warnschwelle: string | null
  warnschwelle_pct: string | number
  voll_pct: string | number
}

export async function speicherStand(): Promise<SpeicherStand | null> {
  return await eine<SpeicherStand>(
    `SELECT befund, befund_text, messungen, alter_stunden, frei_gb, frei_pct, db_gb, raw_gb,
            verbrauch_prognose_gb_tag, db_wachstum_7t_gb_tag, tage_bis_voll, datum_voll::text,
            tage_bis_warnschwelle, datum_warnschwelle::text, warnschwelle_pct, voll_pct
       FROM mart.speicher_stand`)
}

const de = (n: string | number | null | undefined, stellen = 1) =>
  n === null || n === undefined
    ? '?'
    : new Intl.NumberFormat('de-DE', { maximumFractionDigits: stellen }).format(Number(n))

/** 'YYYY-MM-DD' → 'TT.MM.JJJJ', ohne Zeitzonenumweg. */
const datum = (d: string | null) => {
  if (!d) return null
  const [j, m, t] = d.slice(0, 10).split('-')
  return `${t}.${m}.${j}`
}

const SQL_STAND = 'SELECT * FROM mart.speicher_stand;'
const SQL_LAUF = 'SELECT lauf_id, status FROM sync.lauf ORDER BY lauf_id DESC LIMIT 1;'

/**
 * Der befund als Prüfung für /status — und damit für die Nachricht nach dem
 * Lauf, die nur formatiert, was /status sagt (src/meldung.ts). Rein, getestet
 * in speicher.test.ts.
 *
 * DIE ZUORDNUNG DER STUFEN. In /status heißt `stoerung` 503: „ein Mensch
 * sieht nach, niemand startet neu"; `warnung` bleibt 200: „wissen sollte man
 * es, wecken soll es niemanden" (health.ts).
 *
 *   ok             → ok
 *   beobachten     → warnung   ein Termin, kein Alarm: die Warnschwelle liegt
 *                              noch Wochen weg, aber das Hochskalieren sollte
 *                              jetzt in den Kalender
 *   hochskalieren  → stoerung  jemand muss handeln, binnen Wochen, und ein
 *                              Umzug braucht ein Wartungsfenster
 *   dringend       → stoerung
 *   falsche platte → stoerung  der Wächter ist blind; ein blinder Wächter, der
 *                              „ok" sagt, ist schlimmer als keiner
 *   keine messung  → stoerung, wenn die letzte Messung ALT ist (dann misst
 *                    etwas nicht mehr — Regel 10), warnung, wenn es noch NIE
 *                    eine gab: nach dem Deploy dauert es bis zum Ende des
 *                    nächsten Laufs, und das sind bis zu 24 Stunden mit 503
 *                    für einen Zustand, der von selbst endet. Dasselbe Muster
 *                    wie „Yext-Nachlauf ist noch nie gelaufen" (warnung).
 */
export function speicherPruefung(s: SpeicherStand | null): Pruefung {
  const name = 'speicher'
  if (!s) {
    return { name, stufe: 'stoerung', meldung: 'mart.speicher_stand liefert keine Zeile',
             naechster_schritt: 'Die Sicht liefert immer genau eine Zeile — ist Migration 0152 angewendet?' }
  }
  const werte: Record<string, unknown> = {
    befund: s.befund, freiGb: num(s.frei_gb), freiPct: num(s.frei_pct), dbGb: num(s.db_gb),
    rawGb: num(s.raw_gb), verbrauchGbTag: num(s.verbrauch_prognose_gb_tag),
    tageBisVoll: s.tage_bis_voll, datumVoll: s.datum_voll,
    tageBisWarnschwelle: s.tage_bis_warnschwelle, datumWarnschwelle: s.datum_warnschwelle,
    messungen: s.messungen, alterStunden: num(s.alter_stunden),
  }
  const frei = `${de(s.frei_gb)} GB frei (${de(s.frei_pct)} %)`
  const v = num(s.verbrauch_prognose_gb_tag)
  const verbrauch = v === null ? 'Verbrauch noch nicht messbar'
                  : v <= 0 ? 'kein Wachstum'
                  : `Verbrauch ${de(v, 2)} GB/Tag`
  const voll = datum(s.datum_voll)
  const warn = datum(s.datum_warnschwelle)
  const vollPct = de(s.voll_pct, 0)
  const warnPct = de(s.warnschwelle_pct, 0)

  switch (s.befund) {
    case 'ok':
      return { name, stufe: 'ok', werte,
               meldung: `${frei}, ${verbrauch}` + (voll ? ` — voll frühestens am ${voll}` : '') }
    case 'beobachten':
      return {
        name, stufe: 'warnung', werte,
        meldung: `${frei}, ${verbrauch} — die Warnschwelle (${warnPct} % frei) ist voraussichtlich am ${warn ?? '?'} erreicht`
               + (voll ? `, voll (${vollPct} % frei) am ${voll}` : ''),
        naechster_schritt:
          `Noch nichts zu tun, aber das Hochskalieren jetzt einplanen: der größere Server sollte vor dem ${warn ?? '?'} stehen. `
          + `Was wächst: ${SQL_STAND}`,
      }
    case 'hochskalieren':
      return {
        name, stufe: 'stoerung', werte,
        meldung: `Nur noch ${frei}, ${verbrauch}`
               + (voll ? ` — voll (${vollPct} % frei) voraussichtlich am ${voll}` : ` — unter der Warnschwelle von ${warnPct} %`),
        naechster_schritt:
          `Server hochskalieren${voll ? ` bis spätestens ${voll}` : ' in den nächsten Wochen'} — in Hetzner einen Typ mit größerer Platte wählen `
          + `(Server aus, umziehen, an). Vorher prüfen, dass kein Lauf aktiv ist: ${SQL_LAUF} Was wächst: ${SQL_STAND}`,
      }
    case 'dringend':
      return {
        name, stufe: 'stoerung', werte,
        meldung: `Nur noch ${frei}, ${verbrauch}`
               + (voll ? ` — voll (${vollPct} % frei) voraussichtlich am ${voll}` : ` — unter ${vollPct} % frei, die Platte gilt als voll`),
        naechster_schritt:
          'Server JETZT hochskalieren — ab hier fehlt PostgreSQL die Luft für VACUUM, Refresh und WAL, und läuft die Platte '
          + 'wirklich voll, hält die Datenbank an. Bis dahin Platz schaffen: auf dem Host alte Images und Build-Cache '
          + 'entfernen (docker image prune, docker builder prune — nie mit --volumes, dort liegt die Datenbank). '
          + `Vorher prüfen, dass kein Lauf aktiv ist: ${SQL_LAUF} Was wächst: ${SQL_STAND}`,
      }
    case 'falsche platte':
      return {
        name, stufe: 'stoerung', werte, meldung: s.befund_text,
        naechster_schritt:
          'Die Datenbank liegt offenbar nicht mehr auf der Platte, die der Importer misst (eigenes Volume oder eigener Server). '
          + 'SPEICHER_PFAD auf einen Mount der Datenbankplatte setzen. Bis dahin ist der Speicherwächter blind.',
      }
    case 'keine messung':
    default: {
      const nie = Number(s.messungen ?? 0) === 0
      return {
        name, stufe: nie ? 'warnung' : 'stoerung', werte, meldung: s.befund_text,
        naechster_schritt: nie
          ? 'Erwartet direkt nach dem Deploy — der nächste Nachtlauf misst am Ende zum ersten Mal. Bleibt es dabei, im Log nach "speicher nicht gemessen" suchen.'
          : 'Läuft der Nachtlauf noch (siehe Prüfung „Läufe")? Läuft er, im Log nach "speicher" suchen — '
            + `misst er nur die Platte nicht, steht der Grund in platte_fehler: ${SQL_STAND}`,
      }
    }
  }
}

function num(x: string | number | null | undefined): number | null {
  return x === null || x === undefined ? null : Number(x)
}
