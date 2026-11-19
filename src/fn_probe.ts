/**
 * FoodNotify-Probe (fn-probe): misst vier offene Fragen aus der Inventur vom
 * 18.11.2026, STRENG LESEND, je Marke ein kleiner, fester Satz von Aufrufen.
 *
 *   bun run fn-probe --dry-run                      Erlaubtliste und Aufrufplan, KEIN Netz
 *   bun run fn-probe --marke wilma_wunder           eine Marke
 *   bun run fn-probe                                alle Marken mit FN_*-Zugang
 *   bun run fn-probe --max-anbindungen 3 --max-kostenstellen 2 --max-aufrufe 40
 *   bun run fn-probe --marke wilma_wunder --nur link-targets,warenstamm \
 *       --anbindung 2052 --erp 11035 --seitengroessen
 *       nur ausgewählte Fragen (bruecke, link-targets, rezeptliste, warenstamm,
 *       verkaeufe, foodwaste); --anbindung/--erp setzen die IDs fest und sparen
 *       /api/erp/all und /api/pos/locations; --seitengroessen fragt den Warenstamm
 *       der ersten Kostenstelle zusätzlich mit page_size=100 und page_size=1000
 *       (die einzigen zwei Varianten auf der Erlaubtliste)
 *
 * WAS ES MISST, je Marke (Fundstellen: docs/offene-punkte.md „18.11.2026 —
 * FoodNotify" Punkte 5, 6, 13, 14, 15; Formen aus
 * docs/payloads/foodnotify-2026-11/messung-sitzung-2026-11-18.csv):
 *   1. Brücke Kassenartikel → Rezept (`core.pos_artikel`, heute leer):
 *      /api/pos/locations, dann je Anbindung /api/pos/mapping/{id}/articles.
 *   2. link-targets (EIN Aufruf, ~3 MB, ~11 s): je Rezept id, ingredientCount,
 *      updatedAt, restaurantId als CSV.
 *   3. Rezeptliste Seite 1: totalItems/totalPages, `archived`, Abgleich gegen 2.
 *   4. Warenstamm /api/{erpId}/products für wenige Kostenstellen.
 *   5. Verkäufe /api/{erpId}/sales und für zwei Verkäufe .../recipe-sale.
 *   6. Food Waste: die in der Sitzungsmessung mit 200 belegten Lesepfade, genau
 *      in der dort gemessenen Parameterform.
 *
 * GRENZEN, IM CODE UND NICHT NUR HIER:
 *   * ERLAUBTLISTE (`ERLAUBTE_MUSTER`): jeder Pfad muss vor dem Absenden auf
 *     eines der Muster passen, sonst wirft `holenRoh` — und zusätzlich auf
 *     keinen Teil der Sperrliste (`GESPERRTE_TEILE`, die 14 GETs mit Wirkung
 *     aus foodnotify-api-inventar-intern-2026-11.md §6). Nur Methode GET; die
 *     einzige andere Methode ist der Anmeldeversuch von `FnSession`.
 *   * AUFRUFGRENZE je Marke (`--max-aufrufe`, 40), hart gezählt.
 *   * ANMELDUNG: ein Versuch je Marke. Scheitert er, wird die Marke übersprungen
 *     (Regel 7). Kein erneutes Anmelden bei 401 — zwei 401 in Folge brechen die
 *     Marke ab. 429 bricht sofort ab. 403/404/5xx je Pfad: festhalten, weiter,
 *     KEIN Wiederholen.
 *   * Zugangsdaten und Cookies erscheinen nie in Ausgabe, Dateien oder Log.
 *     `/api/analytics` (Tableau-Ticket) wird nicht abgerufen.
 *   * Rohantworten nur nach belege/fn-probe-<datum>-<HHMM>/<marke>/ (UTC, git-ignoriert,
 *     sonst Abbruch VOR dem ersten Aufruf). Zeit im Namen: ein zweiter Lauf am selben
 *     Tag überschreibt den ersten nicht (bei gleicher Minute folgt `-2`, `-3` …). Die Zusammenfassung enthält nur
 *     Zahlen, Feldnamen und Formen — keine Namen und keine Personenfelder.
 *   * Keine Datenbank.
 *
 * EXIT-CODE: 0 alles geholt; 2 etwas ließ sich nicht messen (Anmeldung,
 * Fehlerstatus, Abbruch, Grenze); 3 Zielverzeichnis nicht git-ignoriert.
 *
 * NUR im Terminal des Nutzers oder per docker exec im Container — nicht aus
 * der Agentenumgebung (AGENTS.md Regel 7a).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config, fnGrenzen, fnZugaenge } from './config'
import { FnAnmeldungFehlgeschlagen, FnSession } from './foodnotify/auth'
import { auspacken } from './foodnotify/huelle'
import { kostenstellen, posStandorte, type PosStandortZeile } from './foodnotify/transform'
import { gitIgnoriert } from './rezepte_probe'

export const PAUSE_MS = 1_000
export const MAX_AUFRUFE = 40
export const MAX_ANBINDUNGEN = 3
export const MAX_KOSTENSTELLEN = 2
/** link-targets ist 3 MB groß und braucht ~11 s; alle anderen Antworten sind klein. */
export const TIMEOUT_MIN_MS = 120_000
export const MARKEN = ['aposto', 'enchilada', 'deutsche_konzepte', 'wilma_wunder'] as const
/** Die einzigen Seitengrößen, die `--seitengroessen` am Warenstamm ausprobiert (fest, siehe Erlaubtliste). */
export const SEITENGROESSEN = [100, 1000] as const
/** Fragen, die `--nur` einzeln wählen kann. Ohne `--nur` laufen alle. */
export const FRAGEN = ['bruecke', 'link-targets', 'rezeptliste', 'warenstamm', 'verkaeufe', 'foodwaste'] as const
export type Frage = (typeof FRAGEN)[number]

// ---------------------------------------------------------------------------
// Erlaubtliste und Sperrliste
// ---------------------------------------------------------------------------

/**
 * Die EINZIGEN Pfade (samt Query), die diese Probe aufruft. Jedes Muster ist
 * vollständig verankert; Zahlen stehen als `\d+`, nie als Platzhalter für Text.
 * Elf sind in messung-sitzung-2026-11-18.csv mit Status 200 belegt; die zwei `page_size`-Varianten
 * am Warenstamm sind neu (19.11.2026) und stehen nur dort, bis die Messung sie belegt.
 */
export const ERLAUBTE_MUSTER: { name: string; re: RegExp }[] = [
  { name: 'kostenstellen', re: /^\/api\/erp\/all$/ },
  { name: 'pos_standorte', re: /^\/api\/pos\/locations$/ },
  { name: 'pos_artikel', re: /^\/api\/pos\/mapping\/\d+\/articles$/ },
  { name: 'link_targets', re: /^\/api\/pos\/mapping\/\d+\/link-targets$/ },
  { name: 'rezeptliste', re: /^\/api\/recipes\?page=1$/ },
  { name: 'warenstamm', re: /^\/api\/\d+\/products$/ },
  // Seitengrößen-Messung (19.11.2026): `page_size` heißt der Parameter in Panel (Produktmodul) und Brew
  // (fn-menue-durchgang.json: /api/{erpId}/products?page=&page_size=). Genau zwei feste Werte.
  { name: 'warenstamm_seite_100', re: /^\/api\/\d+\/products\?page=1&page_size=100$/ },
  { name: 'warenstamm_seite_1000', re: /^\/api\/\d+\/products\?page=1&page_size=1000$/ },
  { name: 'verkaeufe', re: /^\/api\/\d+\/sales$/ },
  { name: 'verkauf_rezepte', re: /^\/api\/\d+\/sales\/\d+\/recipe-sale$/ },
  { name: 'foodwaste_kostenanalyse', re: /^\/api\/analytics\/reports\/cost-analysis\/ingredients\/food-waste$/ },
  { name: 'foodwaste_liste', re: /^\/api\/erp\/food-waste\?erpId=\d+&limit=5&page=1$/ },
  { name: 'foodwaste_summen', re: /^\/api\/erp\/food-waste-alpha\/totals\?erpId=\d+$/ },
]

/**
 * Zweite Sicherung, unabhängig von der Erlaubtliste: Teile, die in KEINEM
 * aufgerufenen Pfad vorkommen dürfen. Sie decken die 14 GETs mit Wirkung aus
 * §6 ab (`/app/lang`, `/app/switch-design-mode`, Abmelden, `last-used`,
 * `unlink`, `sync/reload`, `businessData`, `finish`, `generate-embedded-url`,
 * Import/Upload/Bild entfernen) und alles mit sync/export/reload.
 * `/api/analytics` und `/api/v2/analytics` geben ein Tableau-Ticket heraus.
 */
export const GESPERRTE_TEILE: RegExp[] = [
  /^\/app\//, /logout/i, /last-used/i, /unlink/i, /sync/i, /reload/i, /export/i,
  /businessData/i, /\/finish(\/|\?|$)/i, /generate-embedded-url/i, /cancel-import/i,
  /upload/i, /\/remove/i, /^\/shops\//, /^\/api\/(v2\/)?analytics(\?|$)/,
]

export type Pruefung = { ok: true; muster: string } | { ok: false; grund: string }

export function pfadErlaubt(pfad: string): Pruefung {
  if (!pfad.startsWith('/')) return { ok: false, grund: 'Pfad beginnt nicht mit /' }
  for (const s of GESPERRTE_TEILE) {
    if (s.test(pfad)) return { ok: false, grund: `Sperrliste: ${s}` }
  }
  const treffer = ERLAUBTE_MUSTER.find(m => m.re.test(pfad))
  return treffer ? { ok: true, muster: treffer.name } : { ok: false, grund: 'nicht auf der Erlaubtliste' }
}

// ---------------------------------------------------------------------------
// Reine Auswertungen — nur Zahlen, Feldnamen, Formen
// ---------------------------------------------------------------------------

const istObjekt = (x: unknown): x is Record<string, any> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const liste = (x: unknown): any[] => (Array.isArray(x) ? x : [])
const zahl = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}
/** Prozentzahl (23.6), nie Bruch — AGENTS.md Regel 6. */
export const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null)
const gefuellt = (x: unknown): boolean => x !== null && x !== undefined && String(x).trim() !== ''

/** Felder, die Personen tragen — ihre Namen kommen nicht einmal als Feldname in die Zusammenfassung. */
const PERSONENFELD = /(created|updated)by|staff|signer|e-?mail|first_?name|last_?name|^user(\.|$)/i

/**
 * Feldnamen der Zeilen: oberste Ebene plus eine Ebene Objektfelder (`stock.sumAmount`),
 * ohne Personenfelder (`createdByUser`, `staffName` …).
 */
export function feldpfade(zeilen: unknown[]): string[] {
  const s = new Set<string>()
  for (const z of zeilen) {
    if (!istObjekt(z)) continue
    for (const [k, v] of Object.entries(z)) {
      if (PERSONENFELD.test(k)) continue
      s.add(k)
      if (istObjekt(v)) for (const k2 of Object.keys(v)) if (!PERSONENFELD.test(k2)) s.add(`${k}.${k2}`)
    }
  }
  return [...s].sort()
}

/** PLU als Form: Ziffern → 9, Buchstaben → A, Rest bleibt. Nie der Wert selbst. */
export const pluForm = (plu: string): string => plu.replace(/\d/g, '9').replace(/[A-Za-zÄÖÜäöüß]/g, 'A')

const hoechstens = <T>(x: T[], n: number) => x.slice(0, n)

export type StandortAuswertung = {
  standorte: number
  ohneAnbindung: number
  anbindungen: { connectionId: number; kassensystem: string | null; kostenstellen: number }[]
  nachKassensystem: Record<string, number>
}

/** /api/pos/locations → Anbindungen. Ein connectionId kann mehrere Kostenstellen tragen. */
export function standorteAuswerten(zeilen: PosStandortZeile[]): StandortAuswertung {
  const je = new Map<number, { connectionId: number; kassensystem: string | null; kostenstellen: number }>()
  let ohne = 0
  for (const z of zeilen) {
    if (z.connectionId === null) { ohne++; continue }
    const a = je.get(z.connectionId) ?? { connectionId: z.connectionId, kassensystem: z.kassensystem, kostenstellen: 0 }
    a.kostenstellen++
    je.set(z.connectionId, a)
  }
  const anbindungen = [...je.values()]
  const nachKassensystem: Record<string, number> = {}
  for (const a of anbindungen) nachKassensystem[a.kassensystem ?? '(ohne Angabe)'] = (nachKassensystem[a.kassensystem ?? '(ohne Angabe)'] ?? 0) + 1
  return { standorte: zeilen.length, ohneAnbindung: ohne, anbindungen, nachKassensystem }
}

/** Welche Anbindungen gelesen werden: amadeus zuerst (nur dort trägt die PLU-Brücke), dann der Rest. */
export function anbindungenWaehlen(a: StandortAuswertung, max: number): StandortAuswertung['anbindungen'] {
  const amadeus = a.anbindungen.filter(x => x.kassensystem === 'amadeus')
  const rest = a.anbindungen.filter(x => x.kassensystem !== 'amadeus')
  return hoechstens([...amadeus, ...rest], Math.max(max, 0))
}

/** Welche Kostenstellen gelesen werden: zuerst die mit amadeus-Anbindung, dann der Rest in Quellreihenfolge. */
export function kostenstellenWaehlen(
  ks: { erpId: number; kostenstelleId: number }[], standorte: PosStandortZeile[], max: number,
): number[] {
  const amadeus = new Set(standorte.filter(s => s.kassensystem === 'amadeus').map(s => s.kostenstelleId))
  const ids = [...new Set(ks.map(k => k.erpId))]
  const mitAmadeus = ids.filter(id => ks.some(k => k.erpId === id && amadeus.has(k.kostenstelleId)))
  const rest = ids.filter(id => !mitAmadeus.includes(id))
  return hoechstens([...mitAmadeus, ...rest], Math.max(max, 0))
}

export type ArtikelAuswertung = {
  artikel: number
  mitRezept: number
  mitRezeptPct: number | null
  ignoriert: number
  nichtIgnoriert: number
  mitRezeptOhneIgnorierte: number
  mitRezeptOhneIgnoriertePct: number | null
  felder: string[]
  pluLeer: number
  pluNurZiffern: number
  pluVerschieden: number
  pluDoppelteWerte: number
  pluLaengen: Record<string, number>
  pluBeispielformen: string[]
  ingestIssues: number
}

/** /api/pos/mapping/{id}/articles: `{location, restaurantId, items[], canCreateRecipes, ingestIssues[]}`. */
export function artikelAuswerten(roh: unknown): ArtikelAuswertung {
  const o = istObjekt(roh) ? roh : {}
  const items = liste(o.items).filter(istObjekt)
  const mitRezept = items.filter(i => gefuellt(i.recipeId)).length
  const ignoriert = items.filter(i => i.isIgnored === true)
  const nichtIgn = items.filter(i => i.isIgnored !== true)
  const mitRezeptOhne = nichtIgn.filter(i => gefuellt(i.recipeId)).length
  const plus = items.map(i => (gefuellt(i.plu) ? String(i.plu).trim() : ''))
  const gesetzt = plus.filter(p => p !== '')
  const zaehl = new Map<string, number>()
  for (const p of gesetzt) zaehl.set(p, (zaehl.get(p) ?? 0) + 1)
  const laengen: Record<string, number> = {}
  for (const p of gesetzt) laengen[String(p.length)] = (laengen[String(p.length)] ?? 0) + 1
  const formen = new Map<string, number>()
  for (const p of gesetzt) formen.set(pluForm(p), (formen.get(pluForm(p)) ?? 0) + 1)
  const beispiel = [...formen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, n]) => `${f} (${n}×)`)
  return {
    artikel: items.length,
    mitRezept, mitRezeptPct: pct(mitRezept, items.length),
    ignoriert: ignoriert.length, nichtIgnoriert: nichtIgn.length,
    mitRezeptOhneIgnorierte: mitRezeptOhne, mitRezeptOhneIgnoriertePct: pct(mitRezeptOhne, nichtIgn.length),
    felder: feldpfade(items),
    pluLeer: plus.length - gesetzt.length,
    pluNurZiffern: gesetzt.filter(p => /^\d+$/.test(p)).length,
    pluVerschieden: zaehl.size,
    pluDoppelteWerte: [...zaehl.values()].filter(n => n > 1).length,
    pluLaengen: laengen, pluBeispielformen: beispiel,
    ingestIssues: liste(o.ingestIssues).length,
  }
}

export type LinkTargetsAuswertung = {
  anzahl: number
  ohneZutaten: number
  ohneZutatenPct: number | null
  /** Rezepte nach `ingredientCount`: 0, 1–5, 6–20, > 20 (fehlend zählt als 0). */
  zutatenVerteilung: { '0': number; '1-5': number; '6-20': number; '>20': number }
  restaurantIds: number
  updatedAtJeMonat: Record<string, number>
  /** Je Kalendertag der letzten 14 (Datumsteil von `updatedAt`, so wie FoodNotify ihn schreibt), älteste zuerst. */
  updatedAtJeTag: Record<string, number>
  updatedAtLetzte14Tage: number
  updatedAtLetzte7Tage: number
  updatedAtMin: string | null
  updatedAtMax: string | null
  aelterAlsZwoelfMonate: number
  ohneDatum: number
  felder: string[]
  csv: string
}

/** Die letzten n Kalendermonate bis einschließlich `jetzt`, als 'YYYY-MM', älteste zuerst. */
export function letzteMonate(jetzt: Date, n: number): string[] {
  const m: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth() - i, 1))
    m.push(d.toISOString().slice(0, 7))
  }
  return m
}

/** Die letzten n Kalendertage (UTC) bis einschließlich `jetzt`, als 'YYYY-MM-DD', älteste zuerst. */
export function letzteTage(jetzt: Date, n: number): string[] {
  const t: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    t.push(new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate() - i)).toISOString().slice(0, 10))
  }
  return t
}

/**
 * /api/pos/mapping/{id}/link-targets: nacktes Array `[{recipeId, title,
 * restaurantId, imagePath, restaurantName, ingredientCount, updatedAt}]`.
 * Titel und Restaurantname kommen NICHT in die CSV — nur, was zum Abgleich nötig ist.
 */
export function linkTargetsAuswerten(roh: unknown, jetzt: Date): LinkTargetsAuswertung {
  const rows = (Array.isArray(roh) ? roh : liste(auspacken(roh).daten)).filter(istObjekt)
  const monate = letzteMonate(jetzt, 12)
  const tage = letzteTage(jetzt, 14)
  const jeMonat: Record<string, number> = Object.fromEntries(monate.map(m => [m, 0]))
  const jeTag: Record<string, number> = Object.fromEntries(tage.map(t => [t, 0]))
  const verteilung = { '0': 0, '1-5': 0, '6-20': 0, '>20': 0 }
  let aelter = 0, ohneDatum = 0, ohneZutaten = 0
  let min: { ms: number; s: string } | null = null
  let max: { ms: number; s: string } | null = null
  const restaurants = new Set<string>()
  const zeilen = ['id,ingredientCount,updatedAt,restaurantId']
  for (const r of rows) {
    const id = r.recipeId ?? r.id
    const n = zahl(r.ingredientCount)
    if (n === null || n === 0) ohneZutaten++
    if (n === null || n <= 0) verteilung['0']++
    else if (n <= 5) verteilung['1-5']++
    else if (n <= 20) verteilung['6-20']++
    else verteilung['>20']++
    if (gefuellt(r.restaurantId)) restaurants.add(String(r.restaurantId))
    const ts = gefuellt(r.updatedAt) ? String(r.updatedAt) : ''
    const monat = /^\d{4}-\d{2}/.test(ts) ? ts.slice(0, 7) : ''
    if (!monat) ohneDatum++
    else if (monat in jeMonat) jeMonat[monat] = (jeMonat[monat] ?? 0) + 1
    else if (monat < monate[0]!) aelter++
    const tag = /^\d{4}-\d{2}-\d{2}/.test(ts) ? ts.slice(0, 10) : ''
    if (tag && tag in jeTag) jeTag[tag] = (jeTag[tag] ?? 0) + 1
    const ms = ts ? Date.parse(ts) : NaN
    if (Number.isFinite(ms)) {
      if (!min || ms < min.ms) min = { ms, s: ts }
      if (!max || ms > max.ms) max = { ms, s: ts }
    }
    zeilen.push([id, r.ingredientCount, ts, r.restaurantId].map(v => csvFeld(v)).join(','))
  }
  const summe = (ts: string[]) => ts.reduce((a, t) => a + (jeTag[t] ?? 0), 0)
  return {
    anzahl: rows.length, ohneZutaten, ohneZutatenPct: pct(ohneZutaten, rows.length),
    zutatenVerteilung: verteilung,
    restaurantIds: restaurants.size, updatedAtJeMonat: jeMonat,
    updatedAtJeTag: jeTag, updatedAtLetzte14Tage: summe(tage), updatedAtLetzte7Tage: summe(tage.slice(-7)),
    updatedAtMin: min?.s ?? null, updatedAtMax: max?.s ?? null,
    aelterAlsZwoelfMonate: aelter, ohneDatum, felder: feldpfade(rows),
    csv: zeilen.join('\n') + '\n',
  }
}

const csvFeld = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export type RezeptlisteAuswertung = {
  eintraegeSeite1: number
  totalItems: number | null
  totalPages: number | null
  perPage: number | null
  archivedFeldVorhanden: number
  archiviert: number
  archiviertPct: number | null
  felder: string[]
}

/** /api/recipes?page=1: `{data[], pagination{currentPage, perPage, totalItems, totalPages}}`. */
export function rezeptlisteAuswerten(roh: unknown): RezeptlisteAuswertung {
  const eintraege = liste(auspacken(roh).daten).filter(istObjekt)
  const p = istObjekt(roh) && istObjekt(roh.pagination) ? roh.pagination : {}
  const mitFeld = eintraege.filter(e => typeof e.archived === 'boolean')
  const archiviert = mitFeld.filter(e => e.archived === true).length
  return {
    eintraegeSeite1: eintraege.length,
    totalItems: zahl(p.totalItems), totalPages: zahl(p.totalPages), perPage: zahl(p.perPage),
    archivedFeldVorhanden: mitFeld.length, archiviert, archiviertPct: pct(archiviert, mitFeld.length),
    felder: feldpfade(eintraege),
  }
}

/** Preis- und Verpackungsfelder, deren Füllgrad die Warenstamm-Messung ausweist (auch bei 0, damit ein Fehlen sichtbar ist). */
export const PREISFELDER = [
  'pricePerUnit', 'unitPrice', 'packagingQuantity', 'packagingUnit', 'packagingUnits', 'preferredShopUnit',
  'baseUnitQuantity', 'baseUnitUnit', 'unit', 'unitQuantity', 'timeModified', 'shop', 'shop.id', 'ingredient.artikelId',
] as const

const feldWert = (z: unknown, pfad: string): unknown =>
  pfad.split('.').reduce<unknown>((x, k) => (istObjekt(x) ? x[k] : undefined), z)

/** Je Feldpfad: bei wie vielen Zeilen er gefüllt ist (nicht null, nicht leer). Nur Zählungen. */
export function fuellgrad(zeilen: unknown[], pfade: readonly string[]): Record<string, number> {
  const r: Record<string, number> = {}
  for (const p of pfade) r[p] = zeilen.filter(z => gefuellt(feldWert(z, p))).length
  return r
}

/** `{date: '2026-11-18 10:00:00.000000'}` (PHP) oder ISO-Text → ganzer Text, sonst null. */
const zeitText = (x: unknown): string | null => {
  const s = istObjekt(x) ? x.date : x
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null
}

/** Was die Antwort über ihre eigene Seitengröße sagt: `current_page_size` (flach/payload) oder `pagination.perPage`. */
export function gemeldeteSeitengroesse(roh: unknown): number | null {
  let x: unknown = roh
  for (let i = 0; i < 4 && istObjekt(x); i++) {
    if ('current_page_size' in x) return zahl(x.current_page_size)
    if (istObjekt(x.pagination)) return zahl(x.pagination.perPage)
    if (!('payload' in x)) break
    x = x.payload
  }
  return null
}

export type WarenstammAuswertung = {
  zeilen: number
  gesamt: number | null
  seitenZahl: number | null
  hatSeiten: boolean | null
  /** Mit `page_size=N` angefragt; null = Standard (kein Parameter). */
  seitengroesseAngefragt: number | null
  /** Was die Antwort über sich sagt (`current_page_size`); null = nicht genannt. */
  seitengroesseGemeldet: number | null
  felder: string[]
  mitIngredientArtikelId: number
  mitIngredientArtikelIdPct: number | null
  mitBestandsdatensatz: number
  bestandUngleichNull: number
  bestandUngleichNullPct: number | null
  /** Füllgrad (Zeilen mit Wert) der Preis- und Verpackungsfelder, siehe `PREISFELDER`. */
  preisfelder: Record<string, number>
  timeModifiedVon: string | null
  timeModifiedBis: string | null
}

/** /api/{erpId}/products: `{errors, payload:{page_count, total_count, data[]}, code, isError}`. */
export function warenstammAuswerten(roh: unknown, angefragt: number | null = null): WarenstammAuswertung {
  const a = auspacken(roh)
  const zeilen = liste(a.daten).filter(istObjekt)
  const mitId = zeilen.filter(z => gefuellt(z.ingredient?.artikelId)).length
  const mitStock = zeilen.filter(z => istObjekt(z.stock))
  const bestand = mitStock.filter(z => { const n = zahl(z.stock.sumAmount); return n !== null && n !== 0 }).length
  const zeiten = zeilen.map(z => zeitText(z.timeModified)).filter((t): t is string => t !== null).sort()
  return {
    zeilen: zeilen.length, gesamt: a.seiten?.gesamt ?? null, seitenZahl: a.seiten?.gesamtSeiten ?? null,
    hatSeiten: a.seiten ? a.seiten.gesamtSeiten > 1 : null,
    seitengroesseAngefragt: angefragt, seitengroesseGemeldet: gemeldeteSeitengroesse(roh),
    felder: feldpfade(zeilen),
    mitIngredientArtikelId: mitId, mitIngredientArtikelIdPct: pct(mitId, zeilen.length),
    mitBestandsdatensatz: mitStock.length,
    bestandUngleichNull: bestand, bestandUngleichNullPct: pct(bestand, zeilen.length),
    preisfelder: fuellgrad(zeilen, PREISFELDER),
    timeModifiedVon: zeiten[0] ?? null, timeModifiedBis: zeiten[zeiten.length - 1] ?? null,
  }
}

const datumTeil = (x: unknown): string | null => {
  const s = istObjekt(x) ? x.date : x
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

export type VerkaeufeAuswertung = {
  zeilen: number
  gesamt: number | null
  seitenZahl: number | null
  saleStatus: Record<string, number>
  finishErrorGesetzt: number
  finishErrorPct: number | null
  datumVon: string | null
  datumBis: string | null
  felder: string[]
  ids: number[]
}

/** /api/{erpId}/sales: flache Hülle; `data[]` mit id, sumPrice, saleStatus{name}, finishError, timeSold. */
export function verkaeufeAuswerten(roh: unknown): VerkaeufeAuswertung {
  const a = auspacken(roh)
  const zeilen = liste(a.daten).filter(istObjekt)
  const status: Record<string, number> = {}
  const daten: string[] = []
  for (const z of zeilen) {
    const s = istObjekt(z.saleStatus) ? String(z.saleStatus.name ?? '(ohne)') : String(z.saleStatus ?? '(ohne)')
    status[s] = (status[s] ?? 0) + 1
    const d = datumTeil(z.timeSold) ?? datumTeil(z.timeCreated)
    if (d) daten.push(d)
  }
  daten.sort()
  const fehler = zeilen.filter(z => z.finishError !== null && z.finishError !== undefined).length
  return {
    zeilen: zeilen.length, gesamt: a.seiten?.gesamt ?? null, seitenZahl: a.seiten?.gesamtSeiten ?? null,
    saleStatus: status, finishErrorGesetzt: fehler, finishErrorPct: pct(fehler, zeilen.length),
    datumVon: daten[0] ?? null, datumBis: daten[daten.length - 1] ?? null,
    felder: feldpfade(zeilen),
    ids: zeilen.map(z => zahl(z.id)).filter((n): n is number => n !== null && Number.isInteger(n)),
  }
}

export type RezeptVerkaufAuswertung = {
  positionen: number
  gesamt: number | null
  mitRezept: number
  mitRezeptPct: number | null
  mitRezeptzutaten: number
  felder: string[]
}

/** .../sales/{id}/recipe-sale: Positionen mit `recipe{id, name, price, recipeIngredients[]}`. Kein staffName/staffId. */
export function rezeptVerkaufAuswerten(roh: unknown): RezeptVerkaufAuswertung {
  const a = auspacken(roh)
  const zeilen = liste(a.daten).filter(istObjekt)
  const mit = zeilen.filter(z => istObjekt(z.recipe)).length
  const felder = feldpfade(zeilen)
  return {
    positionen: zeilen.length, gesamt: a.seiten?.gesamt ?? null,
    mitRezept: mit, mitRezeptPct: pct(mit, zeilen.length),
    mitRezeptzutaten: zeilen.filter(z => liste(z.recipe?.recipeIngredients).length > 0).length,
    felder,
  }
}

export type FoodWasteKostenanalyse = {
  zeilen: number
  felder: string[]
  restaurants: number
  datumVon: string | null
  datumBis: string | null
  summeGesamtwert: number | null
}

/** cost-analysis/ingredients/food-waste: `{data[{restaurantId, businessDate, …Value}]}`. */
export function foodWasteKostenanalyseAuswerten(roh: unknown): FoodWasteKostenanalyse {
  const zeilen = (Array.isArray(roh) ? roh : liste(auspacken(roh).daten)).filter(istObjekt)
  const tage = zeilen.map(z => datumTeil(z.businessDate)).filter((d): d is string => d !== null).sort()
  const werte = zeilen.map(z => zahl(z.totalWasteValue)).filter((n): n is number => n !== null)
  return {
    zeilen: zeilen.length, felder: feldpfade(zeilen),
    restaurants: new Set(zeilen.map(z => z.restaurantId).filter(gefuellt).map(String)).size,
    datumVon: tage[0] ?? null, datumBis: tage[tage.length - 1] ?? null,
    summeGesamtwert: werte.length ? Math.round(werte.reduce((a, b) => a + b, 0) * 100) / 100 : null,
  }
}

export type FoodWasteListe = { zeilen: number; totalItems: number | null; totalPages: number | null; felder: string[] }

/** /api/erp/food-waste?erpId=…&limit=5&page=1: `{data[], pagination}`. */
export function foodWasteListeAuswerten(roh: unknown): FoodWasteListe {
  const a = auspacken(roh)
  const zeilen = liste(a.daten).filter(istObjekt)
  return { zeilen: zeilen.length, totalItems: a.seiten?.gesamt ?? null, totalPages: a.seiten?.gesamtSeiten ?? null, felder: feldpfade(zeilen) }
}

export type FoodWasteSummen = { felder: string[]; totalPrice: number | null; totalProducts: number | null; mengenzeilen: number }

/** /api/erp/food-waste-alpha/totals?erpId=…: `{totalPrice, totalProducts, quantities[]}`. */
export function foodWasteSummenAuswerten(roh: unknown): FoodWasteSummen {
  const d = auspacken(roh).daten
  const o = istObjekt(d) ? d : {}
  return {
    felder: Object.keys(o).sort(), totalPrice: zahl(o.totalPrice), totalProducts: zahl(o.totalProducts),
    mengenzeilen: liste(o.quantities).length,
  }
}

// ---------------------------------------------------------------------------
// Der Lauf
// ---------------------------------------------------------------------------

export type AufrufProtokoll = {
  nr: number
  name: string
  pfad: string
  status: number | null
  bytes: number | null
  dauerMs: number | null
  hinweis: string | null
}

export type MarkenErgebnis = {
  marke: string
  datum: string
  /** Beginn des Laufs (UTC, ISO) — der Ordnername trägt nur Datum und Minute. */
  gestartet: string
  /** Welche Fragen liefen (`--nur`); alle, wenn nicht eingeschränkt. */
  fragen: Frage[]
  /** Festgesetzte IDs (`--anbindung`, `--erp`); null = aus /api/pos/locations bzw. /api/erp/all gewählt. */
  festeAnbindung: number | null
  festeKostenstelle: number | null
  anmeldung: 'ok' | 'gescheitert' | 'kein Zugang' | 'nicht versucht'
  abbruch: string | null
  aufrufGrenze: number
  aufrufe: AufrufProtokoll[]
  nichtGeholt: string[]
  befunde: string[]
  standorte: StandortAuswertung | null
  gewaehlteAnbindungen: { connectionId: number; kassensystem: string | null }[]
  gewaehlteKostenstellen: number[]
  artikel: ({ connectionId: number; kassensystem: string | null } & ArtikelAuswertung)[]
  linkTargets: ({ connectionId: number } & Omit<LinkTargetsAuswertung, 'csv'>) | null
  rezeptliste: RezeptlisteAuswertung | null
  abgleichRezeptzahl: { totalItems: number | null; linkTargets: number | null; differenz: number | null } | null
  warenstamm: ({ erpId: number; bytes: number | null; dauerMs: number | null } & WarenstammAuswertung)[]
  verkaeufe: ({ erpId: number } & VerkaeufeAuswertung)[]
  rezeptVerkaeufe: ({ erpId: number; verkaufId: number } & RezeptVerkaufAuswertung)[]
  foodWaste: {
    kostenanalyse: FoodWasteKostenanalyse | null
    liste: ({ erpId: number } & FoodWasteListe) | null
    summen: ({ erpId: number } & FoodWasteSummen) | null
  }
}

export type ProbeOptionen = {
  marken?: string[]
  aus: string
  maxAnbindungen?: number
  maxKostenstellen?: number
  maxAufrufe?: number
  /** Nur diese Fragen; leer/fehlt = alle. */
  nur?: Frage[]
  /** Anbindung fest vorgeben: spart /api/pos/locations, wenn auch keine Kostenstelle zu wählen ist. */
  anbindung?: number
  /** Kostenstelle (erpId) fest vorgeben: spart /api/erp/all. */
  erp?: number
  /** Warenstamm der ersten Kostenstelle zusätzlich mit page_size=100 und page_size=1000. */
  seitengroessen?: boolean
  /** Nur für Tests kleiner als PAUSE_MS. */
  pauseMs?: number
  jetzt?: Date
  ausgabe?: (zeile: string) => void
}

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Ein Antworttext, gekürzt für die Zusammenfassung, ohne Mail-Adressen. */
export const kuerzen = (text: string, n = 300): string =>
  text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<mail>').replace(/\s+/g, ' ').trim().slice(0, n)

function leeresErgebnis(marke: string, jetzt: Date, grenze: number, fragen: Frage[], anb: number | null, erp: number | null): MarkenErgebnis {
  return {
    marke, datum: jetzt.toISOString().slice(0, 10), gestartet: jetzt.toISOString(), fragen,
    festeAnbindung: anb, festeKostenstelle: erp, anmeldung: 'nicht versucht', abbruch: null, aufrufGrenze: grenze, aufrufe: [], nichtGeholt: [], befunde: [],
    standorte: null, gewaehlteAnbindungen: [], gewaehlteKostenstellen: [], artikel: [], linkTargets: null,
    rezeptliste: null, abgleichRezeptzahl: null, warenstamm: [], verkaeufe: [], rezeptVerkaeufe: [],
    foodWaste: { kostenanalyse: null, liste: null, summen: null },
  }
}

export async function fnProbe(o: ProbeOptionen): Promise<{ ergebnisse: MarkenErgebnis[]; exitCode: number }> {
  const aus = o.ausgabe ?? ((z: string) => console.log(z))
  const pause = Math.max(o.pauseMs ?? PAUSE_MS, 0)
  const grenze = o.maxAufrufe ?? MAX_AUFRUFE
  const maxAnb = o.maxAnbindungen ?? MAX_ANBINDUNGEN
  const maxKs = o.maxKostenstellen ?? MAX_KOSTENSTELLEN
  const jetzt = o.jetzt ?? new Date()
  const zugaenge = fnZugaenge()
  const marken = o.marken?.length ? o.marken : [...MARKEN]
  const fragen: Frage[] = o.nur?.length ? [...new Set(o.nur)] : [...FRAGEN]
  const falscheFragen = fragen.filter(f => !(FRAGEN as readonly string[]).includes(f))
  if (falscheFragen.length) throw new Error(`Unbekannte Frage: ${falscheFragen.join(', ')} (erlaubt: ${FRAGEN.join(', ')})`)
  for (const [n, v] of [['anbindung', o.anbindung], ['erp', o.erp]] as const) {
    if (v !== undefined && (!Number.isInteger(v) || v <= 0)) throw new Error(`--${n} braucht eine positive ganze Zahl`)
  }
  const will = (f: Frage) => fragen.includes(f)
  const unbekannt = marken.filter(m => !(MARKEN as readonly string[]).includes(m))
  if (unbekannt.length) throw new Error(`Unbekannte Marke: ${unbekannt.join(', ')} (erlaubt: ${MARKEN.join(', ')})`)

  const ergebnisse: MarkenErgebnis[] = []
  let letzter = 0

  for (const marke of marken) {
    const e = leeresErgebnis(marke, jetzt, grenze, fragen, o.anbindung ?? null, o.erp ?? null)
    ergebnisse.push(e)
    const zugang = zugaenge.find(z => z.schluessel === marke)
    if (!zugang) {
      e.anmeldung = 'kein Zugang'
      e.befunde.push(`keine FN_*-Zugangsdaten für ${marke} — übersprungen`)
      continue
    }
    const verzeichnis = join(o.aus, marke)
    mkdirSync(verzeichnis, { recursive: true })

    // Ein Anmeldeversuch, nie ein zweiter (Regel 7). Die Meldung nennt Marke und Status, nie Zugangsdaten.
    const session = new FnSession(zugang)
    try {
      await session.anmelden()
      e.anmeldung = 'ok'
    } catch (x) {
      e.anmeldung = 'gescheitert'
      e.abbruch = x instanceof FnAnmeldungFehlgeschlagen
        ? x.message
        : `Anmeldung ${marke}: ${kuerzen(String((x as Error)?.message ?? x), 120)} — kein weiterer Versuch (AGENTS.md Regel 7)`
      e.befunde.push(e.abbruch)
      aus(`[${marke}] ${e.abbruch}`)
      zusammenfassungSchreiben(verzeichnis, e)
      continue
    }

    let folge401 = 0

    /**
     * EIN GET. Pfad durch die Erlaubtliste, Zähler, Takt, kein Retry.
     * Rückgabe: die JSON-Antwort (roh, nicht ausgepackt) oder null (Grund steht in e.befunde).
     */
    const holenRoh = async (name: string, pfad: string): Promise<unknown | null> => {
      const p = pfadErlaubt(pfad)
      if (!p.ok) throw new Error(`fn-probe: Pfad nicht erlaubt (${p.grund}): ${pfad}`)
      if (e.abbruch || e.aufrufe.length >= grenze) {
        // Nach einem Abbruch oder an der Grenze wird nichts mehr abgesendet — aber gesagt, was fehlt.
        e.abbruch ??= `Aufrufgrenze ${grenze} erreicht`
        e.nichtGeholt.push(`${name} ${pfad}`)
        return null
      }
      const { taktMin, taktMax } = fnGrenzen()
      const soll = Math.max(pause, taktMin + Math.floor(Math.random() * (taktMax - taktMin + 1)))
      const warten = soll - (Date.now() - letzter)
      if (warten > 0) await schlaf(warten)

      const nr = e.aufrufe.length + 1
      const eintrag: AufrufProtokoll = { nr, name, pfad, status: null, bytes: null, dauerMs: null, hinweis: null }
      e.aufrufe.push(eintrag)
      const start = Date.now()
      let text = ''
      try {
        const res = await fetch(`${config.FN_BASE_URL}${pfad}`, {
          method: 'GET',
          headers: session.header(),
          redirect: 'manual',
          signal: AbortSignal.timeout(Math.max(config.ANFRAGE_TIMEOUT_MS, TIMEOUT_MIN_MS)),
        })
        text = await res.text()
        eintrag.status = res.status
        eintrag.bytes = new TextEncoder().encode(text).length
        eintrag.dauerMs = Date.now() - start
        letzter = Date.now()

        if (res.status === 429) {
          eintrag.hinweis = 'HTTP 429 — Abbruch der Marke'
          e.abbruch = `HTTP 429 bei ${name} — Abbruch der Marke, nichts wiederholt`
          e.befunde.push(e.abbruch)
          return null
        }
        const ort = res.headers.get('location') ?? ''
        if (res.status === 401 || (res.status >= 300 && res.status < 400 && /login/i.test(ort))) {
          folge401++
          eintrag.hinweis = `Sitzung nicht akzeptiert (HTTP ${res.status}) — nicht neu angemeldet: ${kuerzen(text)}`
          e.befunde.push(`${name}: ${eintrag.hinweis}`)
          if (folge401 >= 2) e.abbruch = 'zweimal in Folge 401 — Marke abgebrochen, kein neuer Anmeldeversuch'
          return null
        }
        folge401 = 0
        if (!res.ok) {
          eintrag.hinweis = kuerzen(text)
          e.befunde.push(`${name}: HTTP ${res.status} ${eintrag.hinweis}`.trim())
          return null
        }
      } catch (x) {
        eintrag.dauerMs = Date.now() - start
        letzter = Date.now()
        eintrag.hinweis = `kein Ergebnis: ${kuerzen(String((x as Error)?.message ?? x), 120)}`
        e.befunde.push(`${name}: ${eintrag.hinweis}`)
        return null
      }

      let json: unknown
      try { json = JSON.parse(text) } catch {
        eintrag.hinweis = `Antwort ist kein JSON (${eintrag.bytes} Bytes)`
        e.befunde.push(`${name}: ${eintrag.hinweis}`)
        return null
      }
      const huelle = auspacken(json)
      if (huelle.fehler) {
        eintrag.hinweis = `Hüllenfehler: ${kuerzen(huelle.fehler, 200)}`
        e.befunde.push(`${name}: ${eintrag.hinweis}`)
        return null
      }
      // Rohantwort unverändert, wie sie kam.
      writeFileSync(join(verzeichnis, `${String(nr).padStart(2, '0')}_${name}.json`), text)
      return json
    }

    // --- Grundlage: Kostenstellen und Anbindungen -------------------------
    // Feste IDs (--anbindung/--erp) ersetzen den jeweiligen Grundaufruf; ohne sie wie bisher.
    const braucheAnbindung = (will('bruecke') || will('link-targets')) && o.anbindung === undefined
    const braucheKs = (will('warenstamm') || will('verkaeufe') || will('foodwaste')) && o.erp === undefined
    const ksRoh = braucheKs ? await holenRoh('erp_all', '/api/erp/all') : null
    const ks = ksRoh === null ? [] : kostenstellen(ksRoh)
    const stRoh = braucheAnbindung || braucheKs ? await holenRoh('pos_standorte', '/api/pos/locations') : null
    const standorte = stRoh === null ? [] : posStandorte(stRoh)
    if (stRoh !== null) e.standorte = standorteAuswerten(standorte)
    const anbindungen = o.anbindung !== undefined
      ? [{ connectionId: o.anbindung, kassensystem: null as string | null, kostenstellen: 0 }]
      : e.standorte ? anbindungenWaehlen(e.standorte, maxAnb) : []
    e.gewaehlteAnbindungen = anbindungen.map(a => ({ connectionId: a.connectionId, kassensystem: a.kassensystem }))
    const erpIds = o.erp !== undefined ? [o.erp] : kostenstellenWaehlen(ks, standorte, maxKs)
    e.gewaehlteKostenstellen = erpIds
    if (stRoh !== null && braucheAnbindung && anbindungen.length === 0) e.befunde.push('keine Kassenanbindung in /api/pos/locations — Brücke und link-targets nicht messbar')
    if (ksRoh !== null && erpIds.length === 0) e.befunde.push('keine Kostenstelle in /api/erp/all — Warenstamm, Verkäufe, Food Waste nicht messbar')

    // --- 1. Brücke Kassenartikel → Rezept ---------------------------------
    if (will('bruecke')) {
      for (const a of anbindungen) {
        const roh = await holenRoh(`articles_${a.connectionId}`, `/api/pos/mapping/${a.connectionId}/articles`)
        if (roh !== null) e.artikel.push({ connectionId: a.connectionId, kassensystem: a.kassensystem, ...artikelAuswerten(roh) })
      }
    }

    // --- 2. link-targets (ein Aufruf, 3 MB) -------------------------------
    const lt = anbindungen[0]
    let ltAnzahl: number | null = null
    if (lt && will('link-targets')) {
      const roh = await holenRoh(`link_targets_${lt.connectionId}`, `/api/pos/mapping/${lt.connectionId}/link-targets`)
      if (roh !== null) {
        const { csv, ...rest } = linkTargetsAuswerten(roh, jetzt)
        writeFileSync(join(verzeichnis, 'link-targets.csv'), csv)
        e.linkTargets = { connectionId: lt.connectionId, ...rest }
        ltAnzahl = rest.anzahl
      }
    }

    // --- 3. Rezeptliste Seite 1 und Abgleich ------------------------------
    if (will('rezeptliste')) {
      const rl = await holenRoh('rezeptliste_seite1', '/api/recipes?page=1')
      if (rl !== null) {
        e.rezeptliste = rezeptlisteAuswerten(rl)
        const total = e.rezeptliste.totalItems
        e.abgleichRezeptzahl = { totalItems: total, linkTargets: ltAnzahl,
          differenz: total !== null && ltAnzahl !== null ? total - ltAnzahl : null }
      }
    }

    // --- 4. Warenstamm ----------------------------------------------------
    if (will('warenstamm')) {
      for (const erpId of erpIds) {
        const roh = await holenRoh(`products_${erpId}`, `/api/${erpId}/products`)
        if (roh !== null) {
          const l = e.aufrufe[e.aufrufe.length - 1]!
          e.warenstamm.push({ erpId, bytes: l.bytes, dauerMs: l.dauerMs, ...warenstammAuswerten(roh) })
        }
      }
      // Seitengröße: nur die erste Kostenstelle, nur die zwei festen Werte.
      const erp1 = erpIds[0]
      if (o.seitengroessen && erp1 !== undefined) {
        for (const groesse of SEITENGROESSEN) {
          const roh = await holenRoh(`products_${erp1}_page_size_${groesse}`, `/api/${erp1}/products?page=1&page_size=${groesse}`)
          if (roh !== null) {
            const l = e.aufrufe[e.aufrufe.length - 1]!
            e.warenstamm.push({ erpId: erp1, bytes: l.bytes, dauerMs: l.dauerMs, ...warenstammAuswerten(roh, groesse) })
          }
        }
      }
    }

    // --- 5. Verkäufe ------------------------------------------------------
    if (will('verkaeufe')) {
      for (const erpId of erpIds) {
        const roh = await holenRoh(`sales_${erpId}`, `/api/${erpId}/sales`)
        if (roh !== null) e.verkaeufe.push({ erpId, ...verkaeufeAuswerten(roh) })
      }
      // Für höchstens zwei Verkäufe zusammen: die ersten zwei der ersten Kostenstelle mit Verkäufen.
      const mitVerkauf = e.verkaeufe.find(v => v.ids.length > 0)
      for (const id of mitVerkauf ? mitVerkauf.ids.slice(0, 2) : []) {
        const roh = await holenRoh(`recipe_sale_${mitVerkauf!.erpId}_${id}`, `/api/${mitVerkauf!.erpId}/sales/${id}/recipe-sale`)
        if (roh !== null) e.rezeptVerkaeufe.push({ erpId: mitVerkauf!.erpId, verkaufId: id, ...rezeptVerkaufAuswerten(roh) })
      }
    }

    // --- 6. Food Waste: nur die in der Sitzungsmessung mit 200 belegten Pfade ---
    if (will('foodwaste')) {
      const fwk = await holenRoh('food_waste_kostenanalyse', '/api/analytics/reports/cost-analysis/ingredients/food-waste')
      if (fwk !== null) e.foodWaste.kostenanalyse = foodWasteKostenanalyseAuswerten(fwk)
      const erp0 = erpIds[0]
      if (erp0 !== undefined) {
        const fwl = await holenRoh(`food_waste_liste_${erp0}`, `/api/erp/food-waste?erpId=${erp0}&limit=5&page=1`)
        if (fwl !== null) e.foodWaste.liste = { erpId: erp0, ...foodWasteListeAuswerten(fwl) }
        const fws = await holenRoh(`food_waste_summen_${erp0}`, `/api/erp/food-waste-alpha/totals?erpId=${erp0}`)
        if (fws !== null) e.foodWaste.summen = { erpId: erp0, ...foodWasteSummenAuswerten(fws) }
      }
    }

    zusammenfassungSchreiben(verzeichnis, e)
    konsole(aus, e)
  }

  const ungemessen = ergebnisse.some(e => e.anmeldung !== 'ok' || e.abbruch !== null || e.befunde.length > 0)
  aus(`\nRohantworten und Zusammenfassungen: ${o.aus}`)
  return { ergebnisse, exitCode: ungemessen ? 2 : 0 }
}

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------

function konsole(aus: (z: string) => void, e: MarkenErgebnis) {
  const a = e.artikel[0]
  aus(`[${e.marke}] ${e.aufrufe.length}/${e.aufrufGrenze} Aufrufe${e.abbruch ? ` — ABBRUCH: ${e.abbruch}` : ''}`)
  if (e.standorte) aus(`  Anbindungen: ${e.standorte.anbindungen.length} (${Object.entries(e.standorte.nachKassensystem).map(([k, n]) => `${k} ${n}`).join(', ') || '—'}), Standorte ohne Anbindung: ${e.standorte.ohneAnbindung}`)
  for (const x of e.artikel) aus(`  Artikel ${x.connectionId} (${x.kassensystem ?? '?'}): ${x.artikel}, mit Rezept ${x.mitRezept} (${x.mitRezeptPct ?? '—'} %), PLU-Formen ${x.pluBeispielformen.join(', ') || '—'}`)
  if (!a && e.standorte) aus('  Artikel: keine gelesen')
  if (e.linkTargets) aus(`  link-targets: ${e.linkTargets.anzahl} Rezepte, ohne Zutaten ${e.linkTargets.ohneZutaten} (${e.linkTargets.ohneZutatenPct ?? '—'} %), ${e.linkTargets.restaurantIds} restaurantId, ingredientCount ${JSON.stringify(e.linkTargets.zutatenVerteilung)}, updatedAt in 14 Tagen ${e.linkTargets.updatedAtLetzte14Tage}, in 7 Tagen ${e.linkTargets.updatedAtLetzte7Tage}`)
  if (e.rezeptliste) aus(`  Rezeptliste: totalItems ${e.rezeptliste.totalItems ?? '—'}, ${e.rezeptliste.totalPages ?? '—'} Seiten, archiviert auf Seite 1: ${e.rezeptliste.archiviert}/${e.rezeptliste.archivedFeldVorhanden}; Differenz zu link-targets: ${e.abgleichRezeptzahl?.differenz ?? '—'}`)
  for (const w of e.warenstamm) aus(`  Warenstamm ${w.erpId} (page_size ${w.seitengroesseAngefragt ?? 'Standard'}, gemeldet ${w.seitengroesseGemeldet ?? '—'}): ${w.zeilen} Zeilen (gesamt ${w.gesamt ?? '—'}, ${w.seitenZahl ?? '—'} Seiten), mit artikelId ${w.mitIngredientArtikelIdPct ?? '—'} %, Bestand ≠ 0 ${w.bestandUngleichNullPct ?? '—'} %, ${w.bytes ?? '—'} B in ${w.dauerMs ?? '—'} ms`)
  for (const v of e.verkaeufe) aus(`  Verkäufe ${v.erpId}: ${v.zeilen} (gesamt ${v.gesamt ?? '—'}), Status ${JSON.stringify(v.saleStatus)}, finishError ${v.finishErrorGesetzt}, ${v.datumVon ?? '—'} bis ${v.datumBis ?? '—'}`)
  for (const r of e.rezeptVerkaeufe) aus(`  recipe-sale ${r.erpId}/${r.verkaufId}: ${r.positionen} Positionen, mit Rezept ${r.mitRezept}`)
  if (e.foodWaste.kostenanalyse) aus(`  Food Waste (Kostenanalyse): ${e.foodWaste.kostenanalyse.zeilen} Zeilen, ${e.foodWaste.kostenanalyse.datumVon ?? '—'} bis ${e.foodWaste.kostenanalyse.datumBis ?? '—'}`)
  for (const b of e.befunde) aus(`  Befund: ${b}`)
  for (const n of e.nichtGeholt) aus(`  Nicht geholt: ${n}`)
}

const zahlOderStrich = (x: unknown) => (x === null || x === undefined ? '—' : String(x))

export function zusammenfassungMarkdown(e: MarkenErgebnis): string {
  const z: string[] = []
  const t = (kopf: string[], zeilen: unknown[][]) => {
    z.push(`| ${kopf.join(' | ')} |`, `|${kopf.map(() => '---').join('|')}|`)
    for (const r of zeilen) z.push(`| ${r.map(zahlOderStrich).join(' | ')} |`)
    z.push('')
  }
  z.push(`# fn-probe ${e.marke} — ${e.gestartet.slice(0, 16).replace('T', ' ')} UTC`, '',
    `Anmeldung: ${e.anmeldung}. Aufrufe: ${e.aufrufe.length} von höchstens ${e.aufrufGrenze}. ${e.abbruch ? `**Abbruch:** ${e.abbruch}` : ''}`, '',
    `Fragen: ${e.fragen.join(', ')}. Feste IDs: Anbindung ${zahlOderStrich(e.festeAnbindung)}, Kostenstelle ${zahlOderStrich(e.festeKostenstelle)}.`, '',
    'Nur Zahlen, Feldnamen und Formen. Prozentwerte sind Prozentzahlen.', '')
  z.push('## Aufrufe', '')
  t(['Nr', 'Name', 'Pfad', 'Status', 'Bytes', 'ms', 'Hinweis'], e.aufrufe.map(a => [a.nr, a.name, `\`${a.pfad}\``, a.status, a.bytes, a.dauerMs, a.hinweis]))
  if (e.nichtGeholt.length) z.push('## Nicht geholt', '', ...e.nichtGeholt.map(n => `* ${n}`), '')
  if (e.befunde.length) z.push('## Befunde', '', ...e.befunde.map(b => `* ${b}`), '')

  z.push('## 1. Brücke Kassenartikel → Rezept', '')
  if (e.standorte) {
    z.push(`Standorte in /api/pos/locations: ${e.standorte.standorte}, ohne Anbindung: ${e.standorte.ohneAnbindung}, Anbindungen: ${e.standorte.anbindungen.length}. `
      + `Nach Kassensystem (je Anbindung): ${Object.entries(e.standorte.nachKassensystem).map(([k, n]) => `${k} ${n}`).join(', ') || '—'}. `
      + 'Nur `amadeus` trägt die PLU-Brücke.', '')
  }
  t(['Anbindung', 'Kassensystem', 'Artikel', 'mit Rezept', '% mit Rezept', 'ohne ignorierte: Anteil %', 'ignoriert', 'PLU leer', 'PLU nur Ziffern', 'PLU verschieden', 'PLU doppelt', 'Längen', 'Formen', 'ingestIssues'],
    e.artikel.map(a => [a.connectionId, a.kassensystem, a.artikel, a.mitRezept, a.mitRezeptPct, a.mitRezeptOhneIgnoriertePct, a.ignoriert,
      a.pluLeer, a.pluNurZiffern, a.pluVerschieden, a.pluDoppelteWerte, JSON.stringify(a.pluLaengen), a.pluBeispielformen.join(', '), a.ingestIssues]))
  for (const a of e.artikel) z.push(`Felder ${a.connectionId}: ${a.felder.join(', ')}`, '')

  z.push('## 2. link-targets', '')
  if (e.linkTargets) {
    const l = e.linkTargets
    z.push(`Anbindung ${l.connectionId}: ${l.anzahl} Rezepte, ohne Zutaten ${l.ohneZutaten} (${zahlOderStrich(l.ohneZutatenPct)} %), verschiedene restaurantId: ${l.restaurantIds}, `
      + `updatedAt älter als zwölf Monate: ${l.aelterAlsZwoelfMonate}, ohne Datum: ${l.ohneDatum}. Felder: ${l.felder.join(', ')}. CSV: \`link-targets.csv\`.`, '')
    z.push(`\`ingredientCount\`: 0 → ${l.zutatenVerteilung['0']}, 1–5 → ${l.zutatenVerteilung['1-5']}, 6–20 → ${l.zutatenVerteilung['6-20']}, über 20 → ${l.zutatenVerteilung['>20']}. `
      + `\`updatedAt\` frühestens ${zahlOderStrich(l.updatedAtMin)}, spätestens ${zahlOderStrich(l.updatedAtMax)}. `
      + `Mit \`updatedAt\` in den letzten 14 Tagen: **${l.updatedAtLetzte14Tage}** (letzte 7 Tage: ${l.updatedAtLetzte7Tage}). Datumsteil wie geliefert, Tage gezählt bis heute (UTC).`, '')
    t(['Monat', 'Rezepte (updatedAt)'], Object.entries(l.updatedAtJeMonat))
    t(['Tag', 'Rezepte (updatedAt)'], Object.entries(l.updatedAtJeTag))
  } else z.push('nicht geholt', '')

  z.push('## 3. Rezeptliste Seite 1', '')
  if (e.rezeptliste) {
    const r = e.rezeptliste
    z.push(`Einträge auf Seite 1: ${r.eintraegeSeite1}, totalItems ${zahlOderStrich(r.totalItems)}, totalPages ${zahlOderStrich(r.totalPages)}, perPage ${zahlOderStrich(r.perPage)}. `
      + `\`archived\` vorhanden bei ${r.archivedFeldVorhanden} von ${r.eintraegeSeite1}, archiviert ${r.archiviert} (${zahlOderStrich(r.archiviertPct)} %). Felder: ${r.felder.join(', ')}.`, '')
    if (e.abgleichRezeptzahl) z.push(`Abgleich: totalItems ${zahlOderStrich(e.abgleichRezeptzahl.totalItems)} − Zeilen link-targets ${zahlOderStrich(e.abgleichRezeptzahl.linkTargets)} = ${zahlOderStrich(e.abgleichRezeptzahl.differenz)}.`, '')
  } else z.push('nicht geholt', '')

  z.push('## 4. Warenstamm', '')
  t(['erpId', 'page_size angefragt', 'gemeldet', 'Zeilen', 'gesamt', 'Seiten', 'Bytes', 'ms', 'ingredient.artikelId %', 'Bestand ≠ 0 %', 'Bestandsdatensatz', 'timeModified von', 'bis'],
    e.warenstamm.map(w => [w.erpId, w.seitengroesseAngefragt ?? 'Standard', w.seitengroesseGemeldet, w.zeilen, w.gesamt, w.seitenZahl, w.bytes, w.dauerMs,
      w.mitIngredientArtikelIdPct, w.bestandUngleichNullPct, w.mitBestandsdatensatz, w.timeModifiedVon, w.timeModifiedBis]))
  for (const w of e.warenstamm) {
    const titel = `${w.erpId}, page_size ${w.seitengroesseAngefragt ?? 'Standard'}`
    z.push(`Füllgrad Preis- und Verpackungsfelder (${titel}; Zeilen mit Wert von ${w.zeilen}):`, '')
    t(['Feld', 'gefüllt', '%'], Object.entries(w.preisfelder).map(([k, n]) => [k, n, pct(n, w.zeilen)]))
    z.push(`Felder (${titel}): ${w.felder.join(', ')}`, '')
  }

  z.push('## 5. Verkäufe', '')
  t(['erpId', 'Zeilen', 'gesamt', 'Seiten', 'saleStatus', 'finishError ≠ null', '%', 'von', 'bis'],
    e.verkaeufe.map(v => [v.erpId, v.zeilen, v.gesamt, v.seitenZahl, JSON.stringify(v.saleStatus), v.finishErrorGesetzt, v.finishErrorPct, v.datumVon, v.datumBis]))
  for (const v of e.verkaeufe) z.push(`Felder ${v.erpId}: ${v.felder.join(', ')}`, '')
  t(['erpId', 'Verkauf', 'Positionen', 'gesamt', 'mit Rezept', '%', 'mit Rezeptzutaten'],
    e.rezeptVerkaeufe.map(r => [r.erpId, r.verkaufId, r.positionen, r.gesamt, r.mitRezept, r.mitRezeptPct, r.mitRezeptzutaten]))
  if (e.rezeptVerkaeufe[0]) z.push(`Felder recipe-sale: ${e.rezeptVerkaeufe[0].felder.join(', ')}`, '')

  z.push('## 6. Food Waste', '')
  const fw = e.foodWaste
  if (fw.kostenanalyse) z.push(`Kostenanalyse (\`cost-analysis/ingredients/food-waste\`, ohne Parameter): ${fw.kostenanalyse.zeilen} Zeilen, ${fw.kostenanalyse.restaurants} restaurantId, ${zahlOderStrich(fw.kostenanalyse.datumVon)} bis ${zahlOderStrich(fw.kostenanalyse.datumBis)}, Summe totalWasteValue ${zahlOderStrich(fw.kostenanalyse.summeGesamtwert)}. Felder: ${fw.kostenanalyse.felder.join(', ')}.`, '')
  if (fw.liste) z.push(`Liste (\`erp/food-waste?erpId=${fw.liste.erpId}&limit=5&page=1\`): ${fw.liste.zeilen} Zeilen, totalItems ${zahlOderStrich(fw.liste.totalItems)}. Felder: ${fw.liste.felder.join(', ') || '—'}.`, '')
  if (fw.summen) z.push(`Summen (\`erp/food-waste-alpha/totals?erpId=${fw.summen.erpId}\`): totalPrice ${zahlOderStrich(fw.summen.totalPrice)}, totalProducts ${zahlOderStrich(fw.summen.totalProducts)}, Mengenzeilen ${fw.summen.mengenzeilen}. Felder: ${fw.summen.felder.join(', ')}.`, '')
  if (!fw.kostenanalyse && !fw.liste && !fw.summen) z.push('nicht geholt', '')
  return z.join('\n')
}

function zusammenfassungSchreiben(verzeichnis: string, e: MarkenErgebnis) {
  writeFileSync(join(verzeichnis, 'zusammenfassung.json'), JSON.stringify(e, null, 1))
  writeFileSync(join(verzeichnis, 'zusammenfassung.md'), zusammenfassungMarkdown(e))
}

// ---------------------------------------------------------------------------
// Aufrufplan ohne Netz
// ---------------------------------------------------------------------------

export type PlanOptionen = {
  nur?: Frage[]
  anbindung?: number
  erp?: number
  seitengroessen?: boolean
}

/**
 * Der Plan je Marke als Vorlagen — die konkreten IDs kennt erst die Antwort.
 * Standardfall: 1+1+3+1+1+2+2+2+3 = 16. Mit `--nur`/`--anbindung`/`--erp`/`--seitengroessen` entsprechend weniger oder mehr.
 */
export function aufrufplan(
  maxAnbindungen = MAX_ANBINDUNGEN, maxKostenstellen = MAX_KOSTENSTELLEN, opt: PlanOptionen = {},
): { vorlage: string; anzahl: number }[] {
  const fragen: Frage[] = opt.nur?.length ? opt.nur : [...FRAGEN]
  const will = (f: Frage) => fragen.includes(f)
  const anbFest = opt.anbindung !== undefined
  const ksFest = opt.erp !== undefined
  const brauchtAnb = (will('bruecke') || will('link-targets')) && !anbFest
  const brauchtKs = (will('warenstamm') || will('verkaeufe') || will('foodwaste')) && !ksFest
  const anb = anbFest ? 1 : maxAnbindungen
  const ks = ksFest ? 1 : maxKostenstellen
  const plan: { vorlage: string; anzahl: number }[] = [
    { vorlage: '/api/erp/all', anzahl: brauchtKs ? 1 : 0 },
    { vorlage: '/api/pos/locations', anzahl: brauchtAnb || brauchtKs ? 1 : 0 },
    { vorlage: '/api/pos/mapping/{connectionId}/articles', anzahl: will('bruecke') ? anb : 0 },
    { vorlage: '/api/pos/mapping/{connectionId}/link-targets', anzahl: will('link-targets') && anb > 0 ? 1 : 0 },
    { vorlage: '/api/recipes?page=1', anzahl: will('rezeptliste') ? 1 : 0 },
    { vorlage: '/api/{erpId}/products', anzahl: will('warenstamm') ? ks : 0 },
    { vorlage: '/api/{erpId}/products?page=1&page_size={100|1000}', anzahl: will('warenstamm') && opt.seitengroessen && ks > 0 ? SEITENGROESSEN.length : 0 },
    { vorlage: '/api/{erpId}/sales', anzahl: will('verkaeufe') ? ks : 0 },
    { vorlage: '/api/{erpId}/sales/{id}/recipe-sale', anzahl: will('verkaeufe') ? 2 : 0 },
    { vorlage: '/api/analytics/reports/cost-analysis/ingredients/food-waste', anzahl: will('foodwaste') ? 1 : 0 },
    { vorlage: '/api/erp/food-waste?erpId={erpId}&limit=5&page=1', anzahl: will('foodwaste') && ks > 0 ? 1 : 0 },
    { vorlage: '/api/erp/food-waste-alpha/totals?erpId={erpId}', anzahl: will('foodwaste') && ks > 0 ? 1 : 0 },
  ]
  return plan.filter(p => p.anzahl > 0)
}

/** `fn-probe-<UTC-Datum>-<HHMM>`, bei Kollision `-2`, `-3` … — ein zweiter Lauf überschreibt den ersten nie. */
export function ausgabeVerzeichnis(basis: string, jetzt: Date, existiert: (p: string) => boolean = existsSync): string {
  const iso = jetzt.toISOString()
  const name = `fn-probe-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`
  let ziel = join(basis, name)
  for (let n = 2; existiert(ziel); n++) ziel = join(basis, `${name}-${n}`)
  return ziel
}

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
  const zahlArg = (n: string, std: number) => {
    const v = arg(n)
    if (v === undefined) return std
    const x = Number(v)
    if (!Number.isInteger(x) || x < 0) { console.error(`--${n} braucht eine ganze Zahl ≥ 0`); process.exit(64) }
    return x
  }
  const idArg = (n: string): number | undefined => {
    const v = arg(n)
    if (v === undefined) return undefined
    const x = Number(v)
    if (!Number.isInteger(x) || x <= 0) { console.error(`--${n} braucht eine positive ganze Zahl`); process.exit(64) }
    return x
  }
  const marke = arg('marke')
  const maxAnbindungen = zahlArg('max-anbindungen', MAX_ANBINDUNGEN)
  const maxKostenstellen = zahlArg('max-kostenstellen', MAX_KOSTENSTELLEN)
  const maxAufrufe = zahlArg('max-aufrufe', MAX_AUFRUFE)
  const nurText = arg('nur')
  const nur = nurText ? nurText.split(',').map(x => x.trim()).filter(Boolean) : undefined
  const falsch = (nur ?? []).filter(f => !(FRAGEN as readonly string[]).includes(f))
  if (falsch.length) { console.error(`Unbekannte Frage: ${falsch.join(', ')} (erlaubt: ${FRAGEN.join(', ')})`); process.exit(64) }
  const opt: PlanOptionen = {
    nur: nur as Frage[] | undefined, anbindung: idArg('anbindung'), erp: idArg('erp'),
    seitengroessen: process.argv.includes('--seitengroessen'),
  }

  if (process.argv.includes('--dry-run')) {
    // Kein Netz, keine Anmeldung: nur die Muster, der Plan und wer überhaupt einen Zugang hat.
    const plan = aufrufplan(maxAnbindungen, maxKostenstellen, opt)
    console.log('Erlaubtliste (nur GET, vollständig verankert):')
    for (const m of ERLAUBTE_MUSTER) console.log(`  ${m.name.padEnd(24)} ${m.re}`)
    console.log('\nSperrliste (darf in keinem Pfad vorkommen):')
    for (const s of GESPERRTE_TEILE) console.log(`  ${s}`)
    console.log(`\nFragen: ${(opt.nur ?? [...FRAGEN]).join(', ')}; feste Anbindung ${opt.anbindung ?? '—'}, feste Kostenstelle ${opt.erp ?? '—'}, Seitengrößen ${opt.seitengroessen ? SEITENGROESSEN.join('/') : 'aus'}`)
    console.log(`Aufrufplan je Marke (höchstens ${maxAufrufe}; ohne Anmeldung und /api/profile):`)
    for (const p of plan) console.log(`  ${String(p.anzahl).padStart(2)}×  ${p.vorlage}`)
    console.log(`  = ${plan.reduce((s, p) => s + p.anzahl, 0)} Aufrufe`)
    const zug = fnZugaenge().map(z => z.schluessel)
    const ziel = marke ? [marke] : [...MARKEN]
    console.log(`\nMarken: ${ziel.map(m => `${m} (${zug.includes(m) ? 'Zugang' : 'KEIN Zugang'})`).join(', ')}`)
    console.log(`Takt: ${fnGrenzen().taktMin}–${fnGrenzen().taktMax} ms, mindestens ${PAUSE_MS} ms Abstand. Nichts wurde aufgerufen.`)
    process.exit(0)
  }

  const jetzt = new Date()
  const ziel = resolve(arg('aus') ?? ausgabeVerzeichnis('belege', jetzt))
  if (!gitIgnoriert(ziel)) {
    console.error(`Abbruch vor dem ersten Aufruf: ${ziel} ist nicht von git ignoriert. `
      + 'Rohantworten gehören nicht ins Repository — ein Verzeichnis unter belege/ wählen.')
    process.exit(3)
  }
  const { exitCode } = await fnProbe({
    marken: marke ? [marke] : undefined, aus: ziel, maxAnbindungen, maxKostenstellen, maxAufrufe, jetzt, ...opt,
  })
  process.exit(exitCode)
}
