/**
 * Die Belege EINES Betriebs für EIN Jahr ziehen — als Ordner zum Durchsehen.
 *
 * Der Unterschied zu `src/belege.ts`: dort entsteht ein Testkorpus, gestreut
 * über alle Betriebe und sortiert nach Belegart/Betrieb. Hier will jemand die
 * Rechnungen und Lieferscheine eines Hauses vollständig vor sich haben, und
 * die Ablage folgt dem, wonach man sucht:
 *
 *   <ziel>/rechnungen/            Eingangsrechnungen und Avise (typ 1)
 *   <ziel>/rechnungen/digital/    … davon die mit eingebetteter E-Rechnung
 *   <ziel>/lieferscheine/         Lieferscheine (typ 3970)
 *   <ziel>/lieferscheine/digital/
 *   <ziel>/manifest.jsonl         Kopfdaten je Beleg (Lieferant, Netto, …)
 *
 * „DIGITAL" IST GEMESSEN, NICHT GERATEN. Ob ein Beleg eine E-Rechnung trägt,
 * steht erst nach dem Laden fest (siehe `erechnungXml`). Ein digitaler Beleg
 * liegt deshalb NUR in `digital/` — als PDF und daneben das herausgelöste
 * XML — und nicht zusätzlich im Elternordner. Jeder Beleg liegt genau einmal.
 *
 * LEERE ORDNER SIND EIN BEFUND. Beide Ordner werden angelegt, auch wenn eine
 * Belegart für den Betrieb nichts führt (COYACAN GmbH hat am 14.09.2026 in
 * keinem Jahr einen einzigen Lieferschein). Ein fehlender Ordner sähe aus wie
 * ein vergessener.
 *
 * Wie bei `src/belege.ts`: selbst starten (AGENTS.md Regel 7a), fortsetzbar,
 * Auswahl aus der Produktion über Metabase, Dateien von LINA.
 *
 *   bun run src/belege_betrieb.ts 1025 2026 belege/coyacan             # Vorschau
 *   bun run src/belege_betrieb.ts 1025 2026 belege/coyacan --ziehen    # Abzug
 *
 *   TAKT_MIN_MS=0 TAKT_MAX_MS=0          # beaufsichtigt ohne Pause, weiter strikt nacheinander
 */
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { config } from './config'
import { ausProduktion, dateiname, ziehen, type Beleg } from './belege'

/** Belegart → Ordner. Was hier nicht steht, wird nicht ausgewählt. */
export const ORDNER: Record<string, string> = {
  '1': 'rechnungen',
  '3970': 'lieferscheine',
}

export function ordnerFuer(ziel: string, b: Beleg, digital: boolean): string {
  const ordner = ORDNER[b.typ_id]
  if (!ordner) throw new Error(`Belegart ${b.typ_id} hat keinen Ordner (lina_id ${b.lina_id})`)
  return `${ziel}/${ordner}${digital ? '/digital' : ''}`
}

/** Belegdatum vorn, damit der Ordner im Dateimanager chronologisch liegt. */
export function dateinameMitDatum(b: Beleg): string {
  return `${b.beleg_datum}__${dateiname(b)}`
}

/**
 * Betrieb und Jahr landen als Text in der Abfrage — deshalb als ganze Zahlen
 * geprüft, bevor sie dort ankommen. Metabase führt aus, was man ihm gibt.
 */
export function argumente(argv: string[]): { betrieb: number; jahr: number; ziel: string } {
  const [betrieb, jahr, ziel] = argv.filter(a => !a.startsWith('--'))
  const b = Number(betrieb), j = Number(jahr)
  if (!Number.isInteger(b) || b <= 0 || !Number.isInteger(j) || j < 2000 || j > 2100 || !ziel) {
    throw new Error('Aufruf: bun run src/belege_betrieb.ts <lina_betrieb_id> <jahr> <zielordner> [--ziehen]')
  }
  return { betrieb: b, jahr: j, ziel: resolve(ziel) }
}

export function auswahl(betrieb: number, jahr: number): string {
  return `
SELECT b.lina_id, b.encrypted_id, b.typ_id, a.name AS belegart,
       b.betrieb_key, s.lina_betrieb_id, s.name AS betrieb,
       b.beleg_datum::date::text AS beleg_datum,
       b.datei_name, b.dateiendung, b.netto, b.netto_split_roh,
       b.verkaeufer_name, b.kreditor_konto, b.sachkonto, b.zuordnung_fibu,
       b.datev_guid, b.parashift_status, b.archiviert
  FROM core.buchungsbeleg b
  JOIN core.betrieb s USING (betrieb_key)
  LEFT JOIN core.belegart a ON a.typ_id = b.typ_id
 WHERE s.lina_betrieb_id = ${betrieb}
   AND b.typ_id IN (${Object.keys(ORDNER).map(t => `'${t}'`).join(', ')})
   AND b.beleg_datum >= DATE '${jahr}-01-01'
   AND b.beleg_datum <  DATE '${jahr + 1}-01-01'
   AND b.encrypted_id IS NOT NULL
 ORDER BY b.beleg_datum, b.lina_id
`
}

if (import.meta.main) {
  const { betrieb, jahr, ziel } = argumente(process.argv.slice(2))
  const ziehenGewollt = process.argv.includes('--ziehen')
  const grenze = Number(process.env.BELEGE_MAX ?? 2000)

  const belege = await ausProduktion(auswahl(betrieb, jahr))
  const jeOrdner = new Map(Object.values(ORDNER).map(o => [o, 0]))
  for (const b of belege) jeOrdner.set(ORDNER[b.typ_id], (jeOrdner.get(ORDNER[b.typ_id]) ?? 0) + 1)
  const nimmt = Math.min(belege.length, grenze)

  console.log(`\n${belege[0]?.betrieb ?? `Betrieb ${betrieb}`}, ${jahr}: ${belege.length} Belege`)
  for (const [o, n] of jeOrdner) console.log(`  ${o.padEnd(16)} ${n}`)
  console.log(`\nDieser Lauf zieht höchstens ${nimmt} (BELEGE_MAX=${grenze}), einen nach dem anderen.`)
  console.log(`Takt ${config.TAKT_MIN_MS / 1000}–${config.TAKT_MAX_MS / 1000} s Pause je Anfrage.`)
  console.log(`Ablage: ${ziel}`)

  if (!ziehenGewollt) {
    console.log(`\nVorschau — es wurde nichts geladen. Zum Ziehen: --ziehen anhängen.\n`)
    process.exit(0)
  }

  for (const o of Object.values(ORDNER)) await mkdir(`${ziel}/${o}/digital`, { recursive: true })
  await ziehen(belege, ziel, grenze, {
    ordner: (b, digital) => ordnerFuer(ziel, b, digital),
    name: dateinameMitDatum,
  })
}
