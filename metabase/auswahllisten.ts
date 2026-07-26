// =====================================================================
// Die Auswahllisten der Filter von Hand abgleichen.
//
// IM NORMALFALL BRAUCHT MAN DAS NICHT. Der Abgleich haengt am Sync-Lauf
// (src/sync.ts ruft ihn als Nachlauf auf) und passiert damit von selbst,
// sobald der Importer laeuft. Ein neuer Betrieb steht spaetestens nach dem
// naechsten Lauf im Filter.
//
// Dieses Skript ist fuer die Faelle daneben:
//   - nachsehen, ob die Listen stimmen, ohne einen Import abzuwarten
//   - nach einem Umbau an den Dashboards sofort nachziehen
//   - eine Metabase-Instanz einrichten, in der noch nie ein Sync lief
//
//   bun run metabase/auswahllisten.ts          zeigt nur an
//   bun run metabase/auswahllisten.ts --setzen schreibt
//
// Die Arbeit macht src/sync/auswahllisten.ts -- bewusst dieselbe Funktion,
// die auch im Nachlauf laeuft. Zwei Umsetzungen desselben Abgleichs waeren
// zwei Gelegenheiten, dass eine davon still etwas anderes tut.
// =====================================================================

import { auswahllistenAbgleichen } from '../src/sync/auswahllisten'

const setzen = process.argv.includes('--setzen')

if (!setzen) {
  // Ohne --setzen nur nachsehen: derselbe Abgleich gegen eine Kopie, die
  // niemand liest. Einfacher waere ein Trockenlauf-Schalter in der Funktion
  // gewesen -- aber ein Schalter, der ueber Schreiben oder Nichtschreiben
  // entscheidet, ist genau die Sorte Fehler, die man erst bemerkt, wenn
  // etwas ueberschrieben wurde. Deshalb liest dieser Zweig nur.
  const { Pool } = await import('pg')
  const { config } = await import('../src/config')
  const url = process.env.METABASE_DB_URL
    ?? (() => { const u = new URL(config.DATABASE_URL); u.pathname = '/lina_metabase'; return u.toString() })()

  const daten = new Pool({ connectionString: config.DATABASE_URL, max: 1 })
  const meta = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5_000 })

  const soll: Record<string, string[]> = {}
  for (const [slug, sql] of [
    ['betrieb', `SELECT DISTINCT betrieb AS w FROM mart.betrieb
                  WHERE betrieb IS NOT NULL AND betrieb <> '' ORDER BY 1`],
    ['marke', `SELECT DISTINCT hauptkonzept AS w FROM mart.konzept_zuordnung
                WHERE hauptkonzept IS NOT NULL AND hauptkonzept <> '' ORDER BY 1`],
  ] as const) {
    soll[slug] = (await daten.query(sql)).rows.map((z: { w: string }) => String(z.w))
  }
  soll.konzept = soll.marke!

  const d = await meta.query<{ name: string; parameters: string }>(
    `SELECT name, parameters::text AS parameters
       FROM report_dashboard WHERE archived = false AND parameters IS NOT NULL`)

  let offen = 0
  for (const row of d.rows) {
    let ps: Record<string, unknown>[]
    try { ps = JSON.parse(row.parameters) } catch { continue }
    if (!Array.isArray(ps)) continue
    for (const p of ps) {
      const neueWerte = soll[String(p.slug ?? '')]
      if (!neueWerte || p.values_source_type !== 'static-list') continue
      const alt = ((p.values_source_config ?? {}) as { values?: string[] }).values ?? []
      const neu = neueWerte.filter(w => !alt.includes(w))
      const weg = alt.filter(w => !neueWerte.includes(w))
      if (neu.length === 0 && weg.length === 0) continue
      offen++
      console.log(`${row.name} · ${p.slug}: ${alt.length} → ${neueWerte.length}`)
      for (const w of neu) console.log(`    + ${w}`)
      for (const w of weg) console.log(`    - ${w}`)
    }
  }

  await daten.end().catch(() => {})
  await meta.end().catch(() => {})

  if (offen === 0) {
    console.log('Auswahllisten sind aktuell — nichts zu tun.')
    process.exit(0)
  }
  console.log(`\n${offen} Filter wären zu aktualisieren. Mit --setzen übernehmen.`)
  console.log('(Passiert sonst beim nächsten Sync-Lauf von selbst.)')
  process.exit(1)
}

const r = await auswahllistenAbgleichen()

switch (r.status) {
  case 'aktuell':
    console.log('Auswahllisten sind aktuell — nichts zu tun.')
    break
  case 'aktualisiert':
    console.log(`${r.geaendert} Dashboard(s) aktualisiert.`)
    for (const w of r.neu) console.log(`    + ${w}`)
    console.log('Metabase zeigt die neuen Werte sofort; ein Neustart ist nicht nötig.')
    break
  case 'uebersprungen':
    console.log(`Übersprungen: ${r.meldung}`)
    break
  case 'fehler':
    console.error(`Nicht abgeglichen: ${r.meldung}`)
    process.exit(1)
}
process.exit(0)
