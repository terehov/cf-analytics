/**
 * Ein TPAPI-Schluessel je Betrieb anlegen und einsammeln (07.11.2026)
 *
 *   bun run tpapi-schluessel                    # Trockenlauf: nur lesen, Liste ausgeben
 *   bun run tpapi-schluessel --anlegen --nur <encId>   # genau einen Betrieb anlegen
 *   bun run tpapi-schluessel --anlegen          # alle, denen noch einer fehlt
 *   bun run tpapi-schluessel --sellpick         # Trockenlauf: wo liegt ein Schluessel von Sell & Pick
 *   bun run tpapi-schluessel --sellpick --loeschen --nur <encId>   # genau einen Betrieb
 *   bun run tpapi-schluessel --sellpick --loeschen                 # alle
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
 * SELL & PICK ENTFERNEN (`--sellpick`, Entscheidung Eugene nach dem Gespraech mit
 * Daniel, 13.11.2026). Sell & Pick wird nicht mehr genutzt, sein Schluessel liegt
 * aber noch in den Ladenakten und liest vermutlich weiter gegen dasselbe Limit
 * (Formprobe 12.11.: Zaehler 50 von 100 vor unserem ersten Aufruf). Der zweite und
 * letzte schreibende Weg gegen LINA (Regel 1):
 *   - ohne `--loeschen` wird nichts geschrieben, nur aufgelistet;
 *   - geloescht wird NUR, was in der Spalte Drittanbieter „sell&pick" traegt UND
 *     „Sell & Pick" heisst. Passt nur eines von beiden, wird der Schluessel gemeldet
 *     und nicht angefasst (Trockenlauf 17.11.2026: „Kaoix" bei COYACAN, von Daniel
 *     angelegt, liegt unter sell&pick — der Drittanbieter ist nur eine Pflichtauswahl);
 *   - nach jedem Loeschen wird die Ladenakte neu gelesen: der Schluessel muss weg
 *     sein und alle anderen muessen noch dastehen. Sonst Abbruch, kein Wiederholen;
 *   - LOESCHEN IST ENDGUELTIG. LINA zeigt den Schluessel danach nicht mehr; wer
 *     Sell & Pick wieder anbindet, legt einen neuen an.
 * Der Modus legt nichts an und sammelt nichts ein.
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
import { schluesselTabelle, sellPickUrteil, type SchluesselZeile } from './tpapi/schluessel_tabelle'

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
const SELLPICK = argv.includes('--sellpick')
const LOESCHEN = argv.includes('--loeschen')
if (ANLEGEN && SELLPICK) { console.log('--anlegen und --sellpick nicht zusammen.'); process.exit(1) }
if (LOESCHEN && !SELLPICK) { console.log('--loeschen gibt es nur zusammen mit --sellpick.'); process.exit(1) }
if (NUR !== undefined && !/^[0-9a-f]{40}$/.test(NUR)) { console.log('--nur braucht einen Laden-Hash (40 hex).'); process.exit(1) }

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

function passt(z: SchluesselZeile): boolean {
  return z.ip === IP && SCOPE_TEXTE.every(s => z.scopes.includes(s))
    && !/schreiben|Webkasse|Import/.test(z.scopes)
}

async function html(client: LinaClient, ep: Endpunkt, parameter: Record<string, string>): Promise<string> {
  const r = await client.holen(ep, parameter)
  if (r.art !== 'ok') throw new Error(`${ep.key} ${JSON.stringify(parameter)}: ${r.art} — ${String((r as { fehler?: string }).fehler ?? '')}`)
  return String((r as { daten: unknown }).daten)
}

type Betrieb = { id: string; name: string; konzept: string }

/** Der Baum: root → Konzepte → Betriebe (laden_<lina-id>). null, wenn er nicht lesbar ist. */
async function betriebeLesen(client: LinaClient): Promise<Betrieb[] | null> {
  const wurzel = await client.holen(BAUM, { id: 'root' })
  if (wurzel.art !== 'ok') { console.log(`Baum nicht lesbar: ${wurzel.art}`); return null }
  const betriebe: Betrieb[] = []
  for (const k of wurzel.daten as { id: string; text: string }[]) {
    const r = await client.holen(BAUM, { id: k.id })
    if (r.art !== 'ok') { console.log(`Konzept ${k.text} nicht lesbar: ${r.art}`); return null }
    const kinder = Array.isArray(r.daten) ? r.daten : (r.daten as { children?: unknown[] }).children ?? []
    for (const b of kinder as { id: string; text: string }[]) {
      if (b.id?.startsWith('laden_')) betriebe.push({ id: b.id.slice(6), name: b.text, konzept: k.text })
    }
  }
  return betriebe
}

/**
 * Die Schluessel von Sell & Pick auflisten und, mit `--loeschen`, entfernen.
 * Gibt nie einen Schluessel aus — nur Name, Drittanbieter, Rechte und wer ihn angelegt hat.
 */
async function sellPickEntfernen(client: LinaClient): Promise<number> {
  console.log(LOESCHEN ? `SELL & PICK LOESCHEN${NUR ? ` (nur ${NUR})` : ''} — endgueltig\n`
    : 'TROCKENLAUF Sell & Pick — es wird nichts geloescht\n')
  const betriebe = await betriebeLesen(client)
  if (!betriebe) return 3
  console.log(`${betriebe.length} Betriebe im Baum\n`)

  const zaehler = { geloescht: 0, wuerde: 0, ohne: 0, ansehen: 0, unklar: 0 }
  for (const b of betriebe) {
    const stamm = await html(client, STAMM, { linaBetriebId: b.id })
    const enc = ladenHash(stamm)
    if (NUR && enc !== NUR) continue
    const zeilen = schluesselTabelle(stamm)
    let vorher = zeilen

    for (const z of zeilen.filter(z => sellPickUrteil(z) === 'ansehen')) {
      zaehler.ansehen++
      console.log(`?  ${b.name}: „${z.name}" (Drittanbieter ${z.drittanbieter}, Ebene ${z.ebene}, angelegt von ${z.erzeugtVon || '?'}, Rechte: ${z.scopes || '–'}) — Name und Drittanbieter passen nicht beide zu Sell & Pick, nicht angefasst`)
    }
    const treffer = zeilen.filter(z => sellPickUrteil(z) === 'loeschen')
    if (treffer.length === 0) { zaehler.ohne++; continue }

    for (const z of treffer) {
      const was = `„${z.name}" (${z.drittanbieter}, Ebene ${z.ebene}, angelegt von ${z.erzeugtVon || '?'}, Rechte: ${z.scopes || '–'})`
      if (!z.id) { zaehler.unklar++; console.log(`?  ${b.name}: ${was} — kein Loeschknopf, uebersprungen`); continue }
      if (!LOESCHEN) { zaehler.wuerde++; console.log(`-  ${b.name} [${b.konzept}]: wuerde geloescht ${was}`); continue }

      const r = await client.apiSchluesselLoeschen(z.id)
      let meldung = ''
      try { meldung = JSON.parse(r.text)?.message ?? '' } catch { meldung = r.text.slice(0, 120) }
      if (r.status !== 200 || !/success/i.test(r.text)) {
        console.log(`✗  ${b.name}: Loeschen gescheitert — HTTP ${r.status}, ${meldung}. Abbruch, nichts wiederholt.`)
        return 2
      }
      const nachher = schluesselTabelle(await html(client, STAMM, { linaBetriebId: b.id }))
      const fehlt = vorher.filter(v => v.id !== z.id && !nachher.some(n => n.id === v.id && n.name === v.name))
      if (nachher.some(n => n.id === z.id)) {
        console.log(`✗  ${b.name}: LINA meldet Erfolg, der Schluessel steht aber noch da — Abbruch. Bitte in der Ladenakte ansehen.`)
        return 2
      }
      if (fehlt.length > 0 || nachher.length !== vorher.length - 1) {
        console.log(`✗  ${b.name}: nach dem Loeschen fehlt mehr als der eine Schluessel (${fehlt.map(f => f.name).join(', ') || 'Zeilenzahl weicht ab'}) — Abbruch. Bitte in der Ladenakte ansehen.`)
        return 2
      }
      vorher = nachher
      zaehler.geloescht++
      console.log(`✓  ${b.name} [${b.konzept}]: geloescht ${was}`)
    }
  }

  console.log(`\nGeloescht ${zaehler.geloescht}, wuerde geloescht ${zaehler.wuerde}, Betriebe ohne Sell & Pick ${zaehler.ohne}, `
    + `nicht eindeutig (nicht angefasst) ${zaehler.ansehen}, unklar ${zaehler.unklar}`)
  return 0
}

async function main(): Promise<number> {
  const client = new LinaClient()
  if (SELLPICK) return sellPickEntfernen(client)
  const gesammelt: Record<string, string> = existsSync(DATEI) ? JSON.parse(readFileSync(DATEI, 'utf8')) : {}
  const speichern = () => { writeFileSync(DATEI, JSON.stringify(gesammelt, null, 2) + '\n', { mode: 0o600 }); chmodSync(DATEI, 0o600) }

  console.log(ANLEGEN ? `ANLEGEN${NUR ? ` (nur ${NUR})` : ''}\n` : 'TROCKENLAUF — es wird nichts angelegt\n')

  const betriebe = await betriebeLesen(client)
  if (!betriebe) return 3
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
