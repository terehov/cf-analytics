/**
 * Ein TPAPI-Schluessel je Betrieb anlegen und einsammeln (07.11.2026)
 *
 *   bun run tpapi-schluessel                    # Trockenlauf: nur lesen, Liste ausgeben
 *   bun run tpapi-schluessel --anlegen --nur <encId>   # genau einen Betrieb anlegen
 *   bun run tpapi-schluessel --anlegen          # alle, denen noch einer fehlt
 *
 * WARUM. LINAs offizielle Schnittstelle (docs/lina-third-party-api.md) gibt
 * Personal je Stunde und das Kassenjournal je Position — aber ein Schluessel gilt
 * nur fuer den Betrieb, in dessen Ladenakte er angelegt wurde. Gemessen am
 * 07.11.2026: unser erster Schluessel (Aposto Aalen) beantwortet `revenue/store`
 * mit Aalen, und `laden=`/`storeId=`/`store=` aendern daran nichts. Bounti und
 * Sell & Pick haben deshalb je Betrieb einen eigenen.
 *
 * NUR IM TERMINAL DES NUTZERS (Regel 7a): die Anmeldung laeuft ueber die
 * LINA-Oberflaeche mit LINA_USER/LINA_PASSWORD, wie im Sync.
 *
 * DAS IST EIN SCHREIBENDER LAUF GEGEN LINA (Regel 1, Ausnahme auf Entscheidung
 * Eugene, 07.11.2026). Deshalb:
 *   - ohne `--anlegen` wird nichts geschrieben;
 *   - angelegt wird nur, wo die Ladenakte noch keinen Schluessel dieses Namens
 *     fuehrt und wo im Marktplatz mindestens eine der drei Daten-APIs gebucht ist;
 *   - nach jedem Anlegen wird die Ladenakte neu gelesen und geprueft, ob der
 *     Schluessel GENAU mit Name, IP und den vier Leserechten dasteht. Weicht
 *     etwas ab oder scheitert ein Aufruf, bricht der Lauf ab. Kein Wiederholen.
 *
 * DIE SCHLUESSEL WERDEN NIE AUSGEGEBEN. Sie landen in `.lina-api-schluessel.json`
 * (Rechte 600, in .gitignore) als { "<encId>": "<Schluessel>" } — der Inhalt fuer
 * LINA_API_SCHLUESSEL in Dokploy. Gelesen werden sie aus derselben Tabelle, die
 * Eugene im Browser sieht.
 *
 * Tempo: der Client und seine Drosselung sind dieselben wie im Sync. Rund fuenf
 * Aufrufe je Betrieb; bei TAKT_MIN_MS/TAKT_MAX_MS von 4000/8000 fuer diesen
 * einen Lauf sind es etwa eine Stunde fuer alle — die Standardwerte (10–20 s)
 * brauchen rund drei.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { LinaClient } from './lina/client'
import type { Endpunkt } from './lina/endpunkte'
import { BAUM, LADENAKTE_ENDPUNKTE } from './ladenakte/endpunkte'

const NAME = 'Concept Family Analytics'
const IP = '178.104.197.120'
const OPERATOR = '2' // „Foodnotify" — ein Drittanbieter ist Pflicht, einen neutralen gibt es nicht
const SCOPES = ['merchandisemanagement_read', 'revenuejournal_read', 'personal_read', 'bwa_read']
const SCOPE_TEXTE = ['Artikelstammdaten lesen', 'Journaldaten Kasse lesen',
  'Personalstammdaten und Kosten lesen', 'BWAs und SuSas lesen']
const DATEI = '.lina-api-schluessel.json'
const DATEN_APIS = ['Sales Data API', 'Team Data API', 'Article Data API']

const argv = process.argv.slice(2)
const ANLEGEN = argv.includes('--anlegen')
const NUR = argv.includes('--nur') ? argv[argv.indexOf('--nur') + 1] : undefined

const STAMM = LADENAKTE_ENDPUNKTE.find(e => e.key === 'la:stammdaten')!

function marktplatz(encId: string): Endpunkt {
  if (!/^[0-9a-f]{40}$/.test(encId)) throw new Error(`kein Laden-Hash: ${encId}`)
  return {
    key: 'la:marktplatz', ebene: 'betrieb', schrittweite: 'momentaufnahme', form: 'html', aktiv: false,
    pfad: `/intranet/marketplace/show-transfers/storeId/${encId}`,
    zweck: 'Welche Module der Betrieb gebucht hat — nur gelesen',
    // Ohne admin=1 leitet LINA um (HTTP 302) — gemessen im ersten Trockenlauf, 07.11.2026.
    parameter: () => ({ admin: '1' }),
  }
}

type Zeile = { name: string; key: string; ip: string; scopes: string; ebene: string }

/** Die Tabelle „API-Keys" aus dem Stammdatenblatt. Spalten wie in der Oberflaeche. */
function schluesselTabelle(html: string): Zeile[] {
  const tabelle = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map(m => m[0]).find(t => /API - Key/.test(t))
  if (!tabelle) return []
  const text = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  return [...tabelle.matchAll(/<tr[\s\S]*?<\/tr>/g)]
    .map(m => [...m[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(z => text(z[1])))
    .filter(z => z.length >= 8)
    .map(z => ({ name: z[0], key: z[1], ip: z[2], scopes: z[5], ebene: z[7] }))
}

/** Der Laden-Hash, den der Knopf „API-Key erzeugen" schicken wuerde. */
function ladenHash(html: string): string | null {
  return html.match(/generateAPiKey\('([0-9a-f]{40})'\)/)?.[1] ?? null
}

/** Je Daten-API: gebucht (Ja), nicht gebucht (Nein) oder nicht gefunden (null). */
function buchungen(html: string): Record<string, boolean | null> {
  const aus: Record<string, boolean | null> = {}
  for (const api of DATEN_APIS) {
    const m = html.match(new RegExp(`${api}\\s*</td>\\s*<td[^>]*>\\s*(Ja|Nein)`))
      ?? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(new RegExp(`${api} (Ja|Nein)`))
    aus[api] = m ? m[1] === 'Ja' : null
  }
  return aus
}

function passt(z: Zeile): boolean {
  return z.ip === IP && SCOPE_TEXTE.every(s => z.scopes.includes(s))
    && !/schreiben|Webkasse|Import/.test(z.scopes)
}

async function html(client: LinaClient, ep: Endpunkt, parameter: Record<string, string>): Promise<string> {
  const r = await client.holen(ep, parameter)
  if (r.art !== 'ok') throw new Error(`${ep.key} ${JSON.stringify(parameter)}: ${r.art} — ${String((r as { fehler?: string }).fehler ?? '')}`)
  return String((r as { daten: unknown }).daten)
}

async function main(): Promise<number> {
  const client = new LinaClient()
  const gesammelt: Record<string, string> = existsSync(DATEI) ? JSON.parse(readFileSync(DATEI, 'utf8')) : {}
  const speichern = () => { writeFileSync(DATEI, JSON.stringify(gesammelt, null, 2) + '\n', { mode: 0o600 }); chmodSync(DATEI, 0o600) }

  console.log(ANLEGEN ? `ANLEGEN${NUR ? ` (nur ${NUR})` : ''}\n` : 'TROCKENLAUF — es wird nichts angelegt\n')

  // Der Baum: root → Konzepte → Betriebe (laden_<lina-id>).
  const wurzel = await client.holen(BAUM, { id: 'root' })
  if (wurzel.art !== 'ok') { console.log(`Baum nicht lesbar: ${wurzel.art}`); return 3 }
  const betriebe: { id: string; name: string; konzept: string }[] = []
  for (const k of wurzel.daten as { id: string; text: string }[]) {
    const r = await client.holen(BAUM, { id: k.id })
    if (r.art !== 'ok') { console.log(`Konzept ${k.text} nicht lesbar: ${r.art}`); return 3 }
    const kinder = Array.isArray(r.daten) ? r.daten : (r.daten as { children?: unknown[] }).children ?? []
    for (const b of kinder as { id: string; text: string }[]) {
      if (b.id?.startsWith('laden_')) betriebe.push({ id: b.id.slice(6), name: b.text, konzept: k.text })
    }
  }
  console.log(`${betriebe.length} Betriebe im Baum\n`)

  const zaehler = { vorhanden: 0, angelegt: 0, wuerde: 0, ohneBuchung: 0, unklar: 0 }
  for (const b of betriebe) {
    const stamm = await html(client, STAMM, { linaBetriebId: b.id })
    const enc = ladenHash(stamm)
    if (!enc) { console.log(`?  ${b.name}: kein Laden-Hash im Stammdatenblatt — uebersprungen`); zaehler.unklar++; continue }
    if (NUR && enc !== NUR) continue

    const eigener = schluesselTabelle(stamm).find(z => z.name === NAME)
    if (eigener) {
      gesammelt[enc] = eigener.key; speichern()
      zaehler.vorhanden++
      console.log(`✓  ${b.name}: Schluessel vorhanden${passt(eigener) ? '' : ' — ABER Rechte/IP weichen ab, bitte ansehen'}`)
      continue
    }

    let marktplatzSeite: string
    try {
      marktplatzSeite = await html(client, marktplatz(enc), { admin: '1' })
    } catch (e) {
      zaehler.unklar++
      console.log(`?  ${b.name}: Marktplatz nicht lesbar (${String(e).slice(0, 80)}) — uebersprungen`)
      continue
    }
    const gebucht = buchungen(marktplatzSeite)
    const liste = DATEN_APIS.map(a => `${a.split(' ')[0]}:${gebucht[a] === null ? '?' : gebucht[a] ? 'ja' : 'nein'}`).join(' ')
    if (!DATEN_APIS.some(a => gebucht[a])) {
      zaehler.ohneBuchung++
      console.log(`–  ${b.name} [${b.konzept}]: keine Daten-API gebucht (${liste}) — kein Schluessel`)
      continue
    }

    // Geschlossene und insolvente Betriebe bekommen keinen Schluessel, auch wenn der
    // Marktplatz noch eine Buchung fuehrt (Trockenlauf 07.11.2026: Besitos MG, Enchilada
    // Bruchsal). Jeder Schreibaufruf gegen LINA muss sich lohnen — dort laeuft nichts mehr.
    if (/geschlossen|insolvent/i.test(`${b.name} ${b.konzept}`)) {
      zaehler.ohneBuchung++
      console.log(`–  ${b.name} [${b.konzept}]: geschlossen/insolvent (${liste}) — kein Schluessel`)
      continue
    }

    if (!ANLEGEN) { zaehler.wuerde++; console.log(`+  ${b.name} [${b.konzept}]: wuerde angelegt (${liste})`); continue }

    const r = await client.apiSchluesselAnlegen(enc, { name: NAME, operator: OPERATOR, ip: IP, expires: '', scopes: SCOPES })
    let meldung = ''
    try { meldung = JSON.parse(r.text)?.message ?? '' } catch { meldung = r.text.slice(0, 120) }
    if (r.status !== 200 || !/success/i.test(r.text)) {
      console.log(`✗  ${b.name}: Anlegen gescheitert — HTTP ${r.status}, ${meldung}. Abbruch, nichts wiederholt.`)
      return 2
    }
    const neu = schluesselTabelle(await html(client, STAMM, { linaBetriebId: b.id })).find(z => z.name === NAME)
    if (!neu || !passt(neu)) {
      console.log(`✗  ${b.name}: angelegt, aber ${neu ? 'Rechte oder IP weichen ab' : 'nicht in der Liste'} — Abbruch. Bitte in der Ladenakte ansehen.`)
      return 2
    }
    gesammelt[enc] = neu.key; speichern()
    zaehler.angelegt++
    console.log(`✓  ${b.name}: angelegt (${liste})`)
  }

  console.log(`\nVorhanden ${zaehler.vorhanden}, angelegt ${zaehler.angelegt}, wuerde angelegt ${zaehler.wuerde}, `
    + `ohne Buchung ${zaehler.ohneBuchung}, unklar ${zaehler.unklar}`)
  console.log(`${Object.keys(gesammelt).length} Schluessel in ${DATEI} — Inhalt als LINA_API_SCHLUESSEL nach Dokploy, dann loeschen.`)
  return 0
}

process.exit(await main())
