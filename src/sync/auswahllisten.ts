/**
 * Hält die Auswahllisten der Metabase-Filter aktuell — als Nachlauf jedes
 * Sync-Laufs.
 *
 * WARUM DAS HIER STEHT UND NICHT IN EINEM EIGENEN CRON-AUFTRAG
 *
 * Die Filter „Betrieb" und „Marke" in Metabase sind feste Wertelisten.
 * Technisch unvermeidbar: die Karten sind natives SQL, ihre Filter hängen an
 * einer Variablen statt an einer Spalte, und dort bietet Metabase kein
 * Feld-Dropdown an (siehe docs/dashboards.md).
 *
 * Fest heißt: eine Momentaufnahme. Kommt ein Betrieb dazu, fehlt er in der
 * Auswahl — und niemandem fällt es auf, denn das Dashboard sieht vollständig
 * richtig aus. Es fehlt nur eine Zeile im Dropdown, und niemand vermisst, was
 * er nicht sieht.
 *
 * Ein eigener Cron-Auftrag wäre sauberer getrennt, aber er müsste eingerichtet
 * werden, und bis dahin liefe es nicht. Der Sync-Lauf läuft ohnehin — hier
 * angehängt passiert es von selbst, ohne Zutun und ohne zweiten Zeitplan.
 *
 * DER PREIS, BEWUSST BEZAHLT: Der Importer weiß damit von Metabase, was er
 * eigentlich nicht müsste. Abgefedert durch die zwei Regeln unten.
 *
 * ZWEI REGELN, DIE NICHT VERHANDELBAR SIND
 *
 *   1. Das hier darf einen Sync-Lauf NIEMALS scheitern lassen. Metabase ist
 *      für den Import ohne Bedeutung; ein abgestürztes, abgeschaltetes oder
 *      noch gar nicht eingerichtetes Metabase ist kein Importproblem. Deshalb
 *      fängt diese Funktion alles und wirft nie.
 *
 *   2. Es läuft NACH dem Import, nicht davor. Die Daten sind wichtiger, und
 *      der Abgleich braucht den frischen Bestand.
 */
import { Pool } from 'pg'
import { config } from '../config'
import { log } from '../lib/log'
import { query } from '../db/pool'

/**
 * Welcher Filter seine Werte woher bekommt. Schlüssel ist der `slug` des
 * Dashboard-Filters; gleicher Slug heißt überall gleiche Liste — es wäre ein
 * Fehler, wenn „Betrieb" auf zwei Seiten Verschiedenes anböte.
 */
const LISTEN: Record<string, string> = {
  betrieb: `SELECT DISTINCT betrieb AS w FROM mart.betrieb
             WHERE betrieb IS NOT NULL AND betrieb <> '' ORDER BY 1`,
  marke: `SELECT DISTINCT hauptkonzept AS w FROM mart.konzept_zuordnung
           WHERE hauptkonzept IS NOT NULL AND hauptkonzept <> '' ORDER BY 1`,
  // Derselbe Inhalt unter dem Slug der Round-Table-Übersicht.
  konzept: `SELECT DISTINCT hauptkonzept AS w FROM mart.konzept_zuordnung
             WHERE hauptkonzept IS NOT NULL AND hauptkonzept <> '' ORDER BY 1`,
}

/**
 * Ausnahmen je Dashboard: gleicher Slug, andere Grundgesamtheit.
 *
 * Das Einkauf-Dashboard filtert auf die FoodNotify-Mandanten — Marke im
 * Sinne der Warenwirtschaft, nicht das Round-Table-Hauptkonzept. Acht der
 * zwölf Konzern-Marken haben dort grundsätzlich keine Daten; eine
 * Auswahlliste, deren Mehrheit leere Karten liefert, ist eine Falle, die
 * wie fehlende Daten aussieht. Erkannt wird die Seite am [key:...] in der
 * Beschreibung — dasselbe Kennzeichen, über das der Provisionierer seine
 * Dashboards wiederfindet.
 */
export const LISTEN_JE_DASHBOARD: Record<string, Record<string, string>> = {
  db_einkauf: {
    marke: `SELECT DISTINCT marke AS w FROM mart.einkauf_ladestand
             WHERE marke IS NOT NULL ORDER BY 1`,
  },
}

/**
 * Der Monat, der beim Öffnen eines Dashboards voreingestellt ist.
 *
 * WARUM DAS HIER STEHT UND NICHT FEST IM DASHBOARD
 *
 * Ein Dashboard ohne Vorgabe zeigt trotzdem Zahlen — MONAT_CTE fällt auf den
 * jüngsten Monat mit einem Urteil zurück. Das ist richtig gerechnet, aber es
 * ist unsichtbar: der Filter steht leer, und niemand weiß, welcher Monat da
 * eigentlich beantwortet wird. Gemeldet am 27.07.2026.
 *
 * Der naheliegende Weg wäre Metabases relative Vorgabe `thismonth` gewesen.
 * Nachgemessen und verworfen: bei einer SQL-Variablen kommt das Wort
 * unverändert an, und `'thismonth'::date` scheitert — im Browser meldeten
 * daraufhin ALLE Kacheln „There was a problem displaying this chart".
 * Metabase speichert den Wert klaglos; gewirkt hat er nie. Relative Vorgaben
 * funktionieren nur bei Feldfiltern, die an einer echten Spalte hängen.
 *
 * Bleibt der feste Wert — und der veraltet am ersten Tag des nächsten Monats
 * stillschweigend. Deshalb wird er hier bei jedem Sync-Lauf neu gesetzt, aus
 * denselben Daten, die auch die Karten lesen. Was von selbst aktuell bleibt,
 * kann nicht vergessen werden.
 */
const VORGABE_MONAT = `
  SELECT to_char(max(monat), 'YYYY-MM') AS w
    FROM mart.round_table_monat
   WHERE monat <= date_trunc('month', current_date)::date
     AND gesamt IS NOT NULL`

/**
 * Derselbe Wert für Seiten, die an der BWA hängen — und der ist ein anderer.
 *
 * Der Round Table trägt den jüngsten gebuchten BWA-Monat in spätere
 * Berichtsmonate nach; er hat für Juli ein Urteil, obwohl der Steuerberater
 * den Juli noch nicht gebucht hat. Eine EBIT-Karte kann das nicht, sie zeigt
 * den Monat selbst.
 *
 * Der erste Wurf setzte überall denselben Monat und machte damit genau den
 * Fehler, vor dem der Kommentar an MONAT_CTE_BWA warnt: „EBIT je Betrieb" war
 * leer, obwohl 23 Betriebe gebuchte Juni-Zahlen haben — und das neben einer
 * Verlaufskarte, die bis Juni Zahlen zeigte. Gemeldet am 27.07.2026.
 */
const VORGABE_MONAT_BWA = `
  SELECT to_char(max(monat), 'YYYY-MM') AS w
    FROM mart.kennzahlen_aktuell
   WHERE wert_absolut IS NOT NULL AND wert_absolut <> 0`

/**
 * Welche Dashboards die BWA-Vorgabe brauchen, erkannt an ihren Karten.
 *
 * Nicht am Namen: eine gepflegte Namensliste wäre beim nächsten Umbau still
 * veraltet, und der Fehler sähe aus wie fehlende Daten. Stattdessen die Frage,
 * ob ALLE Monatskarten der Seite den BWA-Rückfall benutzen — erkennbar am
 * Verweis auf `kennzahlen_aktuell` mit `wert_absolut <> 0`.
 */
const BWA_DASHBOARDS = `
  SELECT d.id
    FROM report_dashboard d
   WHERE d.archived = false
     AND EXISTS (
           SELECT 1 FROM report_dashboardcard dc
             JOIN report_card c ON c.id = dc.card_id
            WHERE dc.dashboard_id = d.id
              AND c.dataset_query::text LIKE '%{{monat}}%')
     AND NOT EXISTS (
           SELECT 1 FROM report_dashboardcard dc
             JOIN report_card c ON c.id = dc.card_id
            WHERE dc.dashboard_id = d.id
              AND c.dataset_query::text LIKE '%{{monat}}%'
              AND c.dataset_query::text NOT LIKE '%wert_absolut <> 0%')`

/**
 * Die Adresse von Metabases eigener Datenbank.
 *
 * Standardmäßig aus DATABASE_URL abgeleitet: dieselbe Postgres-Instanz,
 * Datenbank `lina_metabase`. Das ist der Aufbau, in dem das hier läuft, und
 * spart eine Umgebungsvariable, die beim Deployen vergessen werden könnte.
 * METABASE_DB_URL überschreibt es, falls Metabase doch woanders liegt.
 */
function metabaseUrl(): string | null {
  const gesetzt = process.env.METABASE_DB_URL
  if (gesetzt) return gesetzt
  try {
    const u = new URL(config.DATABASE_URL)
    u.pathname = '/lina_metabase'
    return u.toString()
  } catch {
    return null
  }
}

export type Abgleich = {
  status: 'aktuell' | 'aktualisiert' | 'uebersprungen' | 'fehler'
  geaendert: number
  neu: string[]
  meldung?: string
}

/**
 * Gleicht die Auswahllisten ab. Wirft nie — siehe Regel 1 oben.
 */
export async function auswahllistenAbgleichen(): Promise<Abgleich> {
  const url = metabaseUrl()
  if (!url) {
    return { status: 'uebersprungen', geaendert: 0, neu: [], meldung: 'keine Metabase-Datenbank ermittelbar' }
  }

  let meta: Pool | null = null
  try {
    // Sollwerte aus der Fachdatenbank — über den bestehenden Pool.
    const soll: Record<string, string[]> = {}
    for (const [slug, sql] of Object.entries(LISTEN)) {
      const zeilen = await query<{ w: string }>(sql)
      soll[slug] = zeilen.map(z => String(z.w))
    }
    // Die Dashboard-Ausnahmen gleich mit — je Dashboard-Schlüssel und Slug.
    const sollJeDashboard: Record<string, Record<string, string[]>> = {}
    for (const [schluessel, listen] of Object.entries(LISTEN_JE_DASHBOARD)) {
      sollJeDashboard[schluessel] = {}
      for (const [slug, sql] of Object.entries(listen)) {
        const zeilen = await query<{ w: string }>(sql)
        sollJeDashboard[schluessel]![slug] = zeilen.map(z => String(z.w))
      }
    }

    // Der voreingestellte Monat, im Format, das der Filter erwartet
    // (YYYY-MM). Gibt es noch kein Urteil, bleibt er leer — dann ist ein
    // leerer Filter ehrlicher als ein erfundener Monat.
    const vorgabeMonat = (await query<{ w: string | null }>(VORGABE_MONAT))[0]?.w ?? null
    const vorgabeMonatBwa = (await query<{ w: string | null }>(VORGABE_MONAT_BWA))[0]?.w ?? null

    // Kurze Zeitgrenzen: läuft Metabase nicht, soll das hier nicht hängen.
    meta = new Pool({
      connectionString: url,
      max: 1,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
    })

    const dashboards = await meta.query<{ id: number; name: string; parameters: string; description: string | null }>(
      `SELECT id, name, parameters::text AS parameters, description
         FROM report_dashboard
        WHERE archived = false AND parameters IS NOT NULL`)

    // Welche Seiten hängen ausschließlich an der BWA? Die bekommen den
    // letzten gebuchten Monat statt des letzten bewerteten.
    const bwaIds = new Set(
      (await meta.query<{ id: number }>(BWA_DASHBOARDS)).rows.map(r => r.id))

    let geaendert = 0
    const neuGesamt = new Set<string>()

    for (const d of dashboards.rows) {
      let parameter: Record<string, unknown>[]
      try { parameter = JSON.parse(d.parameters) } catch { continue }
      if (!Array.isArray(parameter)) continue

      let dirty = false
      for (const p of parameter) {
        // Der Monatsfilter: Vorgabe auf den jüngsten bewerteten Monat.
        // Nur dieser eine Slug und nur dieser eine Typ — ein Zeitraumfilter
        // (date/all-options) hat andere Vorgaben und bleibt unberührt.
        if (String(p.slug ?? '') === 'monat' && p.type === 'date/month-year') {
          const wert = bwaIds.has(d.id) ? vorgabeMonatBwa : vorgabeMonat
          if (wert && p.default !== wert) {
            p.default = wert
            dirty = true
          }
          continue
        }

        // Dashboard-Ausnahme vor der globalen Liste — das Einkauf-Dashboard
        // führt unter demselben Slug eine andere Grundgesamtheit.
        const dKey = (d.description ?? '').match(/\[key:([a-z0-9_]+)\]/)?.[1]
        const neueWerte = (dKey ? sollJeDashboard[dKey]?.[String(p.slug ?? '')] : undefined)
          ?? soll[String(p.slug ?? '')]
        // Nur anfassen, was schon als feste Liste eingerichtet ist. Ein
        // Datumsfilter oder ein bewusst freies Feld bleibt unberührt.
        if (!neueWerte || p.values_source_type !== 'static-list') continue

        const cfg = (p.values_source_config ?? {}) as { values?: string[] }
        const alt = cfg.values ?? []
        if (alt.length === neueWerte.length && neueWerte.every(w => alt.includes(w))) continue

        for (const w of neueWerte) if (!alt.includes(w)) neuGesamt.add(w)
        p.values_source_config = { ...cfg, values: neueWerte }
        dirty = true
      }

      if (dirty) {
        await meta.query(`UPDATE report_dashboard SET parameters = $1 WHERE id = $2`,
          [JSON.stringify(parameter), d.id])
        geaendert++
      }
    }

    // Auch bei „nichts geändert" schreiben: der Zeitstempel ist die Aussage,
    // an der /status erkennt, ob der Abgleich überhaupt noch läuft.
    await query(
      `INSERT INTO sync.merker (schluessel, wert)
       VALUES ('metabase_auswahllisten',
               jsonb_build_object('anzahl_betriebe', $1::int, 'anzahl_marken', $2::int))
       ON CONFLICT (schluessel)
       DO UPDATE SET wert = EXCLUDED.wert, gesetzt_am = now()`,
      [soll.betrieb?.length ?? 0, soll.marke?.length ?? 0])

    return geaendert === 0
      ? { status: 'aktuell', geaendert: 0, neu: [] }
      : { status: 'aktualisiert', geaendert, neu: [...neuGesamt] }
  } catch (e) {
    // Regel 1: nie werfen. Metabase ist für den Import ohne Bedeutung.
    return { status: 'fehler', geaendert: 0, neu: [], meldung: String(e) }
  } finally {
    if (meta) await meta.end().catch(() => {})
  }
}

/**
 * Der Aufruf für den Nachlauf: gleicht ab und protokolliert, ohne je zu werfen.
 */
export async function auswahllistenNachlauf(): Promise<void> {
  const r = await auswahllistenAbgleichen()
  if (r.status === 'aktualisiert') {
    log.info('Metabase-Auswahllisten aktualisiert', {
      dashboards: r.geaendert,
      neu: r.neu.slice(0, 10),
      weitere: Math.max(0, r.neu.length - 10),
    })
  } else if (r.status === 'fehler') {
    // Warnung, nicht Fehler: der Import ist gelungen, nur das Berichtswesen
    // hinkt. /status meldet es, sobald die Listen tatsächlich zurückfallen.
    log.warn('Metabase-Auswahllisten nicht abgeglichen', { grund: r.meldung })
  } else if (r.status === 'uebersprungen') {
    log.debug('Metabase-Auswahllisten übersprungen', { grund: r.meldung })
  }
}
