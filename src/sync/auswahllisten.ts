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

    // Kurze Zeitgrenzen: läuft Metabase nicht, soll das hier nicht hängen.
    meta = new Pool({
      connectionString: url,
      max: 1,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
    })

    const dashboards = await meta.query<{ id: number; name: string; parameters: string }>(
      `SELECT id, name, parameters::text AS parameters
         FROM report_dashboard
        WHERE archived = false AND parameters IS NOT NULL`)

    let geaendert = 0
    const neuGesamt = new Set<string>()

    for (const d of dashboards.rows) {
      let parameter: Record<string, unknown>[]
      try { parameter = JSON.parse(d.parameters) } catch { continue }
      if (!Array.isArray(parameter)) continue

      let dirty = false
      for (const p of parameter) {
        const neueWerte = soll[String(p.slug ?? '')]
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
