// =====================================================================
// Haelt die Auswahllisten der Filter aktuell.
//
// DAS PROBLEM. Die Filter "Betrieb" und "Marke" sind feste Wertelisten.
// Sie muessen fest sein: die Karten sind natives SQL, ihre Filter haengen
// an einer Variablen statt an einer Spalte, und dort bietet Metabase kein
// Feld-Dropdown an (siehe docs/dashboards.md).
//
// Fest heisst aber auch: eine Momentaufnahme. Kommt ein Betrieb dazu,
// steht er nicht in der Liste -- und niemand merkt es, denn das Dashboard
// sieht unveraendert richtig aus. Der neue Betrieb fehlt einfach.
//
// WARUM NICHT IM IMPORTER. Der Importer haette dafuer Metabase-Zugang
// gebraucht. Zwei Systeme, die nichts voneinander wissen muessen, waeren
// aneinander gebunden, und ein Metabase-Ausfall koennte einen Importlauf
// scheitern lassen. Die Trennung ist die gleiche wie bei /health und
// /status: der Import liefert Daten, das Berichtswesen liest sie.
//
// WARUM KEIN API-SCHLUESSEL. Die Listen stehen in Metabases eigener
// Datenbank, auf die wir ohnehin Zugriff haben. Ein zusaetzlicher
// Schluessel waere ein zusaetzliches Geheimnis, das verwaltet, verteilt
// und irgendwann gedreht werden muss -- fuer eine Aufgabe, die ein
// UPDATE erledigt.
//
// Deshalb: ein eigenes Skript, das NUR die Listen anfasst. Es baut keine
// Dashboards, aendert kein Layout und braucht keinen Browser.
//
//   bun run metabase/auswahllisten.ts          zeigt, was sich aendern wuerde
//   bun run metabase/auswahllisten.ts --setzen schreibt es
//
// Taeglich per Cron aufrufen (siehe docs/dashboards.md). Faellt es aus,
// meldet /status es als Warnung -- die Liste veraltet dann still, und
// genau davor schuetzt die Meldung.
// =====================================================================

import { SQL } from 'bun'

const DATEN = process.env.DATENBANK_URL ?? 'postgresql://postgres@localhost/lina'
const META = process.env.METABASE_DB_URL ?? 'postgresql://postgres@localhost/lina_metabase'

/**
 * Welcher Filter seine Werte woher bekommt.
 *
 * Der Schluessel ist der `slug` des Dashboard-Filters. Alle Dashboards mit
 * gleichem Slug bekommen dieselbe Liste — es waere ein Fehler, wenn
 * "Betrieb" auf zwei Seiten Verschiedenes anboete.
 */
const LISTEN: Record<string, string> = {
  betrieb: `SELECT DISTINCT betrieb FROM mart.betrieb
             WHERE betrieb IS NOT NULL AND betrieb <> '' ORDER BY 1`,
  marke: `SELECT DISTINCT hauptkonzept FROM mart.konzept_zuordnung
           WHERE hauptkonzept IS NOT NULL AND hauptkonzept <> '' ORDER BY 1`,
  // "konzept" ist der Slug derselben Sache auf der Round-Table-Uebersicht.
  konzept: `SELECT DISTINCT hauptkonzept FROM mart.konzept_zuordnung
             WHERE hauptkonzept IS NOT NULL AND hauptkonzept <> '' ORDER BY 1`,
}

type Aenderung = {
  dashboard: string
  slug: string
  vorher: number
  nachher: number
  neu: string[]
  entfallen: string[]
}

export async function listenPruefen(setzen: boolean): Promise<Aenderung[]> {
  const daten = new SQL(DATEN)
  const meta = new SQL(META)
  const aenderungen: Aenderung[] = []

  try {
    // 1. Sollwerte aus der Fachdatenbank holen.
    const soll: Record<string, string[]> = {}
    for (const [slug, sql] of Object.entries(LISTEN)) {
      const zeilen = await daten.unsafe(sql)
      soll[slug] = zeilen.map((z: Record<string, unknown>) => String(Object.values(z)[0]))
    }

    // 2. Ist-Zustand aus Metabase lesen.
    const dashboards = await meta`
      SELECT id, name, parameters::text AS parameters
        FROM report_dashboard
       WHERE archived = false AND parameters IS NOT NULL`

    for (const d of dashboards) {
      let parameter: Record<string, unknown>[]
      try { parameter = JSON.parse(d.parameters) } catch { continue }
      if (!Array.isArray(parameter)) continue

      let geaendert = false
      for (const p of parameter) {
        const slug = String(p.slug ?? '')
        const neueWerte = soll[slug]
        // Nur Filter anfassen, die schon als feste Liste eingerichtet sind.
        // Ein Datumsfilter oder ein bewusst freies Textfeld bleibt unberuehrt.
        if (!neueWerte || p.values_source_type !== 'static-list') continue

        const cfg = (p.values_source_config ?? {}) as { values?: string[] }
        const alt = cfg.values ?? []
        const neu = neueWerte.filter(w => !alt.includes(w))
        const weg = alt.filter(w => !neueWerte.includes(w))
        if (neu.length === 0 && weg.length === 0) continue

        aenderungen.push({
          dashboard: d.name, slug, vorher: alt.length, nachher: neueWerte.length,
          neu, entfallen: weg,
        })
        p.values_source_config = { ...cfg, values: neueWerte }
        geaendert = true
      }

      if (geaendert && setzen) {
        await meta`UPDATE report_dashboard
                      SET parameters = ${JSON.stringify(parameter)}
                    WHERE id = ${d.id}`
      }
    }

    // Hinterlegen, womit gerade abgeglichen wurde. /status vergleicht diese
    // Zahl mit dem Bestand und meldet, wenn die Listen zurueckfallen -- ohne
    // den Merker koennte der Cron-Auftrag monatelang tot sein, ohne dass es
    // auffaellt. Auch dann schreiben, wenn sich nichts geaendert hat: der
    // Zeitstempel ist die eigentliche Aussage.
    if (setzen) {
      // to_jsonb(...::text) statt ${objekt}::jsonb: der Treiber reicht einen
      // JSON-String als STRING-Literal weiter, und ::jsonb macht daraus einen
      // JSON-String statt eines Objekts. wert->>'anzahl_betriebe' liefert dann
      // NULL, /status meldet "noch nie abgeglichen" -- und zwar fuer immer,
      // ohne dass irgendetwas fehlschlaegt. Einmal passiert am 26.07.2026.
      await daten`
        INSERT INTO sync.merker (schluessel, wert)
        VALUES ('metabase_auswahllisten',
                jsonb_build_object('anzahl_betriebe', ${soll.betrieb?.length ?? 0}::int,
                                   'anzahl_marken',   ${soll.marke?.length ?? 0}::int))
        ON CONFLICT (schluessel)
        DO UPDATE SET wert = EXCLUDED.wert, gesetzt_am = now()`
    }
  } finally {
    await daten.end()
    await meta.end()
  }

  return aenderungen
}

if (import.meta.main) {
  const setzen = process.argv.includes('--setzen')
  const aenderungen = await listenPruefen(setzen)

  if (aenderungen.length === 0) {
    console.log('Auswahllisten sind aktuell — nichts zu tun.')
    process.exit(0)
  }

  for (const a of aenderungen) {
    console.log(`${a.dashboard} · ${a.slug}: ${a.vorher} → ${a.nachher}`)
    for (const n of a.neu) console.log(`    + ${n}`)
    for (const e of a.entfallen) console.log(`    - ${e}`)
  }

  if (setzen) {
    console.log(`\n${aenderungen.length} Filter aktualisiert.`)
    console.log('Metabase zeigt die neuen Werte sofort; ein Neustart ist nicht noetig.')
  } else {
    console.log('\nNichts geschrieben. Mit --setzen uebernehmen.')
    process.exit(1)   // damit ein Cron-Lauf ohne --setzen als "es gibt was zu tun" auffaellt
  }
}
