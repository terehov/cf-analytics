/**
 * Zeigt, was ein Yext-Schluessel sieht -- gegliedert nach Ordnern.
 *
 *     bun run yext:pruefen
 *
 * Liest nur. Kein Schreibzugriff, keine Aenderung an der Datenbank.
 *
 * WARUM DIE ORDNER DIE HAUPTSACHE SIND. Am 03.08.2026 gegen das echte Konto
 * gemessen: 115 Entitaeten, und zwar ALLE unter derselben accountId
 * (1559219539920412896). Die Bitte aus docs/yext-anbindung.md §1, den Zugang
 * technisch auf die Concept Family zu begrenzen, ist also NICHT umgesetzt --
 * der Schluessel sieht auch Gimme Gelato, Pommes Freunde, my Indigo und die
 * Soulkitchen Gruppe, alles Kunden der Family & Friends Marketing.
 *
 * Getrennt wird ausschliesslich ueber den Ordnerbaum, und der ist deshalb das,
 * was dieses Skript ausgibt. Ein Ordnername ist aber eine Beschriftung, keine
 * Zusage: WAS UNS GEHOERT, ENTSCHEIDET manual.betrieb_fremd_id (system =
 * 'yext'). Das Skript beschriftet, es urteilt nicht.
 *
 * Eine fruehere Fassung hat genau das verwechselt und alles Unzugeordnete als
 * "fremde Standorte" ausgegeben. Darunter waren Besitos Wuerzburg, drei
 * Lehners-Wirtshaeuser und die Ratskeller -- allesamt unsere, nur eben nie
 * zugeordnet, weil die Zuordnung aus einem CSV-Export mit 48 Zeilen stammte.
 * Nicht zugeordnet heisst nicht fremd.
 *
 * Am Ende ein einzelner Reviews-Aufruf: klaert Frage 3 aus
 * docs/yext-anbindung.md -- ob Bewertungen im Vertrag enthalten sind.
 */
import { config } from './config'
import { query, pool } from './db/pool'
import { entitaetenHolen, ordnerHolen, yextHolen, yextKonfiguriert } from './yext/client'

if (!yextKonfiguriert()) {
  console.error(
    'YEXT_API_KEY ist nicht gesetzt.\n\n' +
    'Der Schluessel gehoert in die .env (NICHT in .env.example, die wird committet):\n' +
    "  YEXT_API_KEY='...'\n\n" +
    'Der Block in .env.example nennt die drei optionalen Zeilen dazu ' +
    '(Konto, Instanz, Version).')
  process.exit(1)
}

console.log(`Yext-Zugang pruefen\n  Instanz  ${config.YEXT_BASE_URL}\n` +
  `  Konto    ${config.YEXT_ACCOUNT_ID}\n  Version  ${config.YEXT_API_VERSION}\n`)

let entitaeten, ordner
try {
  entitaeten = await entitaetenHolen()
  ordner = await ordnerHolen()
} catch (e) {
  console.error(`ENTITAETEN: kein Zugriff — ${(e as Error).message}\n`)
  console.error(
    'Erster Verdacht bei 401: die falsche Instanz. Deutsche Konten liegen\n' +
    'haeufig in der EU — dann YEXT_BASE_URL=https://api.eu.yext.com setzen.\n' +
    'Bei 403 sind es die Berechtigungen der App (docs/yext-anbindung.md §2.2).')
  await pool.end()
  process.exit(1)
}

const konten = new Set(entitaeten.map(e => e.meta?.accountId ?? '?'))
console.log(`ENTITAETEN: ${entitaeten.length} in ${konten.size} Konto${konten.size === 1 ? '' : 'en'} (${[...konten].join(', ')})`)
if (konten.size === 1) {
  console.log(
    '  Ein einziges Konto: der Zugang ist NICHT technisch auf uns begrenzt\n' +
    '  (docs/yext-anbindung.md §1). Es trennt nur der Ordnerbaum — und der ist\n' +
    '  eine Beschriftung, keine Grenze. Der Import filtert deshalb ueber\n' +
    '  manual.betrieb_fremd_id.')
}

/** Vollstaendiger Pfad eines Ordners, damit Unterordner lesbar bleiben. */
const nachId = new Map(ordner.map(o => [String(o.id), o]))
function pfad(id?: string): string {
  const teile: string[] = []
  let cur = nachId.get(String(id))
  for (let i = 0; cur && i < 10; i++) {
    teile.unshift(cur.name ?? String(cur.id))
    cur = cur.parentId && cur.parentId !== '0' ? nachId.get(String(cur.parentId)) : undefined
  }
  return teile.join(' / ') || `Ordner ${id ?? '?'}`
}

// --- Abgleich gegen unsere Zuordnung ---------------------------------------
// Ueber die IDs, nicht ueber die Namen: Yext und LINA benennen dieselben
// Betriebe verschieden, das ist der Grund fuer manual.betrieb_fremd_id.
let zuordnung = new Map<string, { betrieb_key: number; name: string }>()
try {
  const rows = await query<{ betrieb_key: number; fremd_id: string; name: string }>(
    `SELECT f.betrieb_key, f.fremd_id, b.name
       FROM manual.betrieb_fremd_id f
       JOIN core.betrieb b USING (betrieb_key)
      WHERE f.system = 'yext'`)
  zuordnung = new Map(rows.map(r => [r.fremd_id, { betrieb_key: r.betrieb_key, name: r.name }]))
} catch (e) {
  console.log(`\nAbgleich mit manual.betrieb_fremd_id nicht moeglich — ${(e as Error).message}`)
  console.log('Die Ordneruebersicht unten gilt trotzdem; nur die Zuordnung fehlt.')
}

const gruppen = new Map<string, typeof entitaeten>()
for (const e of entitaeten) {
  const k = String(e.meta?.folderId ?? '?')
  gruppen.set(k, [...(gruppen.get(k) ?? []), e])
}

// Ordner mit mindestens einer Zuordnung zuerst — das sind unsere. Ordner ganz
// ohne Zuordnung stehen unten und brauchen eine Entscheidung, keine Vermutung.
const bewertet = [...gruppen].map(([fid, liste]) => ({
  fid, liste, pfad: pfad(fid),
  zugeordnet: liste.filter(e => zuordnung.has(e.meta?.id ?? '')).length,
})).sort((a, b) => b.zugeordnet - a.zugeordnet || a.pfad.localeCompare(b.pfad))

let offen = 0
for (const g of bewertet) {
  const kennung = g.zugeordnet > 0
    ? `${g.zugeordnet}/${g.liste.length} zugeordnet`
    : `${g.liste.length} Entitaeten, KEINE zugeordnet`
  console.log(`\n### ${g.pfad}  (${kennung})`)
  for (const e of g.liste.sort((a, b) => String(a.meta?.id).localeCompare(String(b.meta?.id)))) {
    const id = String(e.meta?.id ?? '?')
    const b = zuordnung.get(id)
    if (!b) offen++
    console.log(`  ${id.padEnd(20)} ${String(e.name ?? '').slice(0, 40).padEnd(40)} ` +
      `${String(e.address?.city ?? '').padEnd(16)} ${b ? `[${b.betrieb_key}] ${b.name}` : '—'}`)
  }
}

const sichtbar = new Set(entitaeten.map(e => e.meta?.id ?? ''))
const fehlend = [...zuordnung].filter(([id]) => !sichtbar.has(id))
console.log(`\nZUSAMMEN: ${entitaeten.length} Entitaeten, ${zuordnung.size - fehlend.length} davon zugeordnet, ${offen} ohne Zuordnung`)
if (fehlend.length) {
  console.log(`\nZUGEORDNET, ABER NICHT SICHTBAR (${fehlend.length}) — der Schluessel liefert sie nicht:`)
  for (const [id, b] of fehlend) console.log(`  ${id.padEnd(20)} [${b.betrieb_key}] ${b.name}`)
}
if (offen) {
  console.log(
    '\nOhne Zuordnung heisst NICHT fremd. Wer dazugehoert und noch fehlt, gehoert\n' +
    'nach VON_HAND in src/yext_zuordnen.ts — der Importer laedt ausschliesslich\n' +
    'zugeordnete Betriebe.')
}

// --- Reviews: ein einzelner Aufruf ------------------------------------------
// Frage 3 aus docs/yext-anbindung.md: ist der Reviews-Zugriff im Vertrag
// enthalten? Ein 403 hier bei funktionierendem Entities-Zugriff beantwortet
// das eindeutiger als jede Rueckfrage beim Support.
try {
  const r = await yextHolen<{ count?: number; averageRating?: number }>('/reviews', { limit: '1' })
  console.log(`\nREVIEWS: Zugriff vorhanden — ${r.count ?? 0} Bewertungen im Konto, Schnitt ${r.averageRating?.toFixed(2) ?? '—'}`)
  console.log('  Die Zahl gilt fuer das GANZE Konto, fremde Kunden eingeschlossen.')
  console.log('  Der Import schraenkt ueber entityIds ein und zieht nie alles.')
} catch (e) {
  console.log(`\nREVIEWS: kein Zugriff — ${(e as Error).message}`)
  console.log('Bei 403 fehlt der App das Leserecht auf Reviews, oder der Vertrag\ndeckt es nicht ab (Frage 3 in docs/yext-anbindung.md).')
}

await pool.end()
