/**
 * Erster Kontakt mit LINAs Third-Party-API (TPAPI), 07.11.2026
 *
 *   bun run tpapi-probe [--tag 01.11.2026] [--laden <encId>]   # --laden: Schluessel aus LINA_API_SCHLUESSEL
 *
 * Zweck und Hintergrund: docs/lina-third-party-api.md. Der Schlüssel ist an die
 * IPv4 des Hetzner-Servers gebunden — die Probe laeuft deshalb NUR dort, per
 * `docker exec` im Importer-Container. Vom Notebook aus wird sie abgewiesen.
 *
 * NUR GET, KEINE DATENBANK, NICHTS GESPEICHERT. Rund zehn Aufrufe, weit unter dem
 * dokumentierten Limit (100 je Laden und 15 Minuten). Kein Wiederholen: ein
 * abgewiesener Schluessel wird durch Wiederholen nicht gueltiger.
 *
 * Der Schluessel kommt aus LINA_API_KEY und wird nie ausgegeben. Personenbezogenes
 * (kostUser, Namen) wird nicht ausgegeben — nur Zaehlungen und Summen je Stunde.
 *
 * WAS DIE PROBE BEANTWORTEN SOLL:
 *   1. Ueber welche Adresse geht der Server raus (IPv4 oder IPv6)?
 *   2. Welchen Laden sieht ein Franchise-Schluessel, und waehlt `laden=` einen Betrieb?
 *   3. Teilen sich Schnittstellen das Limit (getlimit vor und nach der Probe)?
 *   4. Personal je Stunde: Personen und Kosten fuer den Tag.
 *   5. Journal: Zeilen, Felder, Summe — gegen getUmsatzbericht desselben Tages.
 *   6. BWA ohne gebuchte BWA Data API: Fehler oder Daten?
 */

const BASIS = (process.env.LINA_API_BASIS ?? 'https://api.lina.de').replace(/\/$/, '')

function argument(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}

const TAG = argument('--tag') ?? '01.11.2026' // ein Sonntag
const LADEN = argument('--laden')

// Mit --laden: der Schluessel dieses Betriebs aus LINA_API_SCHLUESSEL ({ "<encId>": "<Schluessel>" },
// erzeugt von `bun run tpapi-schluessel`). Ein Schluessel gilt nur fuer seinen eigenen Betrieb —
// ein Parameter `laden=` waehlt nichts aus (gemessen 07.11.2026). Ohne --laden: LINA_API_KEY.
function schluesselFuer(laden: string | undefined): string | undefined {
  if (!laden) return process.env.LINA_API_KEY
  try {
    return (JSON.parse(process.env.LINA_API_SCHLUESSEL ?? '{}') as Record<string, string>)[laden]
  } catch {
    return undefined
  }
}
const SCHLUESSEL = schluesselFuer(LADEN)

/** Entfernt den Schluessel aus jedem Text, bevor er ausgegeben wird. */
function sauber(text: string): string {
  return SCHLUESSEL ? text.split(SCHLUESSEL).join('<schluessel>') : text
}

type Antwort = { status: number; daten: unknown; roh: string }

async function holen(pfad: string, parameter: Record<string, string> = {}): Promise<Antwort> {
  const url = new URL(`${BASIS}/extern/${pfad}`)
  for (const [k, v] of Object.entries(parameter)) url.searchParams.set(k, v)
  const res = await fetch(url, {
    headers: { apikey: SCHLUESSEL!, accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  })
  const roh = await res.text()
  let daten: unknown = null
  try { daten = JSON.parse(roh) } catch { /* kein JSON — roh ausgeben */ }
  return { status: res.status, daten, roh }
}

function form(daten: unknown): string {
  if (Array.isArray(daten)) {
    const erstes = daten[0]
    const felder = erstes && typeof erstes === 'object' ? Object.keys(erstes).join(', ') : typeof erstes
    return `Liste mit ${daten.length} Eintraegen; Felder: ${felder}`
  }
  if (daten && typeof daten === 'object') return `Objekt; Schluessel: ${Object.keys(daten).join(', ')}`
  return String(daten)
}

function zeile(nr: string, titel: string, a: Antwort, zusatz = '') {
  console.log(`${nr} ${titel}: HTTP ${a.status}${zusatz ? ` — ${zusatz}` : ''}`)
  if (a.status !== 200 || a.daten === null) console.log(`   ${sauber(a.roh.slice(0, 400)).replace(/\s+/g, ' ')}`)
}

async function ausgangsadresse() {
  for (const [art, url] of [['IPv4', 'https://api.ipify.org'], ['bevorzugt', 'https://api64.ipify.org']] as const) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      console.log(`   Ausgang ${art}: ${(await r.text()).trim()}`)
    } catch (e) {
      console.log(`   Ausgang ${art}: nicht ermittelbar (${String(e).slice(0, 80)})`)
    }
  }
}

async function main(): Promise<number> {
  if (!SCHLUESSEL) {
    console.log(LADEN
      ? `Kein Schluessel fuer ${LADEN} in LINA_API_SCHLUESSEL (fehlt, oder kein gueltiges JSON).`
      : 'LINA_API_KEY fehlt. Der Schluessel gehoert in die Umgebung des Containers (Dokploy), nicht in den Aufruf.')
    return 3
  }
  console.log(`Basis ${BASIS}, Tag ${TAG}${LADEN ? `, laden=${LADEN}` : ''}\n`)

  console.log('0. Ausgangsadresse (gebunden ist die IPv4 des Servers):')
  await ausgangsadresse()

  const laden = await holen('revenue/store')
  zeile('1.', 'revenue/store (verbundener Laden)', laden)
  if (laden.status === 200) console.log(`   ${sauber(JSON.stringify(laden.daten)).slice(0, 600)}`)
  if (laden.status === 401 || laden.status === 403) {
    console.log('\n→ Abgewiesen. Nicht wiederholen. Pruefen: Schluessel vollstaendig, IP im Schluessel = Ausgang IPv4 oben, Recht gesetzt.')
    return 2
  }

  const limitVorher = await holen('revenue/getlimit')
  zeile('2.', 'revenue/getlimit vorher', limitVorher, JSON.stringify(limitVorher.daten))

  const tage = await holen('revenue/listdays')
  if (Array.isArray(tage.daten)) {
    const d = tage.daten as Array<{ businessdate?: number }>
    const zeiten = d.map(x => x.businessdate ?? 0).filter(Boolean).sort((a, b) => a - b)
    const iso = (s?: number) => s ? new Date(s * 1000).toISOString().slice(0, 10) : '–'
    zeile('3.', 'revenue/listdays', tage, `${d.length} Tage, ${iso(zeiten[0])} bis ${iso(zeiten.at(-1))}`)
  } else zeile('3.', 'revenue/listdays', tage, form(tage.daten))

  const stunde = await holen('personal/personalkostenprostunde', { businessdate: TAG })
  zeile('4.', 'personal/personalkostenprostunde', stunde, form(stunde.daten))
  const s = stunde.daten as { eff?: Record<string, number>; kost?: Record<string, number> } | null
  if (s?.eff) {
    const reihenfolge = [...Array(24).keys()].map(i => String((i + 8) % 24))
    for (const h of reihenfolge) {
      if (s.eff[h] === undefined && s.kost?.[h] === undefined) continue
      console.log(`   ${h.padStart(2)} Uhr  Personen ${String(s.eff[h] ?? '–').padStart(5)}  Kosten ${String(s.kost?.[h] ?? '–').padStart(8)} €`)
    }
  }

  const tag = await holen('personal/personalkostenprotag', { businessdate: TAG })
  zeile('5.', 'personal/personalkostenprotag', tag, form(tag.daten))
  if (Array.isArray(tag.daten)) console.log(`   ${JSON.stringify(tag.daten).slice(0, 400)}`)

  const journal = await holen('revenue/journal', { businessdate: TAG })
  if (Array.isArray(journal.daten)) {
    const z = journal.daten as Array<Record<string, string>>
    const summe = z.reduce((acc, r) => acc + Number(r.preis ?? 0) * Number(r.zahl ?? 0), 0)
    const finanzwege = new Map<string, number>()
    for (const r of z) finanzwege.set(r.finanzweg, (finanzwege.get(r.finanzweg) ?? 0) + 1)
    zeile('6.', 'revenue/journal', journal, form(journal.daten))
    console.log(`   Summe preis × zahl: ${summe.toFixed(2)} € brutto (gegen getUmsatzbericht desselben Tages pruefen)`)
    console.log(`   Zeilen je finanzweg: ${[...finanzwege].map(([k, v]) => `${k}:${v}`).join(' ')}`)
    console.log(`   mit rabatt_id ≠ 0: ${z.filter(r => r.rabatt_id && r.rabatt_id !== '0').length}, `
      + `mit cancellationreason ≠ 0: ${z.filter(r => r.cancellationreason && r.cancellationreason !== '0').length}`)
  } else zeile('6.', 'revenue/journal', journal, form(journal.daten))

  const tische = await holen('revenue/journaltables', { businessdate: TAG })
  if (Array.isArray(tische.daten)) {
    const t = tische.daten as Array<Record<string, string>>
    const gaeste = t.reduce((acc, r) => acc + Number(r.number_adults ?? 0) + Number(r.number_kids ?? 0), 0)
    zeile('7.', 'revenue/journaltables', tische, `${form(tische.daten)}; Gaeste gesamt ${gaeste}`)
  } else zeile('7.', 'revenue/journaltables', tische, form(tische.daten))

  const bwa = await holen('bwa/schemas')
  zeile('8.', 'bwa/schemas (BWA Data API nicht gebucht)', bwa, form(bwa.daten))

  const artikel = await holen('merchandiseman/grosscategory')
  zeile('9.', 'merchandiseman/grosscategory', artikel, form(artikel.daten))

  const limitNachher = await holen('revenue/getlimit')
  zeile('10.', 'revenue/getlimit nachher', limitNachher, JSON.stringify(limitNachher.daten))

  return 0
}

process.exit(await main())

export {}
