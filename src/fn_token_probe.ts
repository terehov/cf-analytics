/**
 * FoodNotify-Token-Probe (fn-token-probe): misst, was das Scope-Token je Marke
 * trägt — STRENG LESEND, je Marke höchstens 16 GET, je Pfad EIN Aufruf.
 *
 *   bun run fn-token-probe --dry-run                Erlaubtliste und Aufrufplan, KEIN Netz
 *   bun run fn-token-probe --marke enchilada        eine Marke
 *   bun run fn-token-probe                          alle Marken mit Token (FN_API_TOKENS)
 *   bun run fn-token-probe --max-aufrufe 10         Grenze SENKEN (nie über 16)
 *   bun run fn-token-probe --vergleich              Sitzung gegen Token, dieselben Abrufe, je Marke
 *                                                   höchstens 14 GET (Abschnitt „--vergleich" unten)
 *
 * ANLASS (19.11.2026): Gemessen war bisher nur Wilma Wunder (18.11.2026,
 * docs/foodnotify-api-inventar-offiziell.md, „Messung mit Token" und „Was das
 * für den Importer heißt"). Auf dieser Messung baut der Umbau „Rezepte über
 * Token statt Sitzung" auf — deshalb muss sie je Marke und je Registereintrag
 * eindeutig sagen: trägt / trägt nicht / nicht gemessen.
 *
 * ABLAUF je Marke:
 *   1. SITZUNG (my.foodnotify.com) nur für das, was das Token nicht aufzählen
 *      kann: die Benutzer-ID (/api/profile, holt FnSession.anmelden() selbst)
 *      und die Kassenanbindungen (/api/pos/locations). /api/erp/all NUR als
 *      Rückfall, wenn das Token die Kostenstellen nicht liefert — sonst wählt
 *      die Probe die Kostenstelle aus der Token-Antwort /api/erp/core/{userId}/erps
 *      (Namen stehen dort mit; damit bleiben es 16 statt 17 Aufrufe).
 *   2. TOKEN (api3.foodnotify.com), je ein GET in der Form des Registers
 *      (`src/foodnotify/endpunkte.ts`, die Pfade werden mit dessen Funktionen
 *      gebaut): Betriebe, Kostenstellen über die Benutzer-ID, Rezeptliste über
 *      recipe-viewer und /api/recipes, link-targets, Rezeptkopf/-zutaten/-meta,
 *      Bestellliste/-kopf/-positionen, Inventuren, Warenstamm, Kassenartikel.
 *      link-targets steht VOR dem Rezeptkopf: daraus wird ein Rezept MIT Zutaten
 *      gewählt (am 18.11.2026 war das gemessene Rezept leer).
 *
 * GRENZEN, IM CODE UND NICHT NUR HIER:
 *   * Zwei Erlaubtlisten, eine je Host (`ERLAUBT_SITZUNG`, `ERLAUBT_TOKEN`),
 *     vollständig verankert, dazu die Sperrliste aus fn_probe.ts (die 15 GETs
 *     mit Wirkung) plus `cart`. Ein Pfad außerhalb wirft VOR dem Absenden.
 *     Nur GET; die einzige andere Methode ist der Anmeldeversuch von FnSession.
 *   * Höchstens `MAX_AUFRUFE` (16) GET je Marke, die Benutzer-ID der Anmeldung
 *     mitgezählt; `--max-aufrufe` kann die Grenze nur senken.
 *   * Mindestens `PAUSE_MS` (1,2 s) zwischen zwei Aufrufen, über beide Hosts.
 *   * Kein Retry bei 4xx. 401 oder 429 brechen die Marke ab. Bei Zeitüberschreitung
 *     oder Netzfehler höchstens EIN zweiter Versuch, und nur für die Kassenartikel
 *     (19–39 s gemessen, Zeitgrenze 180 s) — wenn die Grenze ihn noch zulässt.
 *   * Anmeldung: EIN Versuch je Marke. Scheitert er, wird die Marke abgebrochen
 *     (AGENTS.md Regel 7).
 *   * TOKEN UND PASSWORT ERSCHEINEN NIRGENDS: jeder Text, der in eine Datei,
 *     die Konsole oder die Zusammenfassung geht, läuft durch `schwaerzen()`,
 *     und `zusammenfassungSchreiben` prüft vor dem Schreiben, dass kein
 *     Geheimnis darin steht (sonst wirft es).
 *   * Testkostenstellen und -anbindungen („test" im Namen) werden übersprungen
 *     (docs/fehlerkatalog.md 19.11.2026: „AAA Testrestaurant").
 *   * Rohantworten nur nach belege/fn-token-probe-<UTC-datum>-<HHMM>/<marke>/
 *     (git-ignoriert, sonst Abbruch vor dem ersten Aufruf). Keine Datenbank.
 *
 * EXIT-CODE: 0 jeder Pfad gemessen; 2 etwas ist nicht gemessen (Anmeldung,
 * Abbruch, Grenze, fehlende ID); 3 Zielverzeichnis nicht git-ignoriert; 64 Aufruffehler.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config, fnGrenzen, fnZugaenge, type FnZugang } from './config'
import { FnAnmeldungFehlgeschlagen, FnSession } from './foodnotify/auth'
import { fnEndpunkt } from './foodnotify/endpunkte'
import { auspacken } from './foodnotify/huelle'
import { kostenstellen, posStandorte, type KostenstelleZeile } from './foodnotify/transform'
import {
  GESPERRTE_TEILE, MARKEN, anbindungenWaehlen, artikelAuswerten, feldpfade, istTestName, kuerzen,
  linkTargetsAuswerten, rezeptlisteAuswerten, standortNamen, standorteAuswerten, warenstammAuswerten,
  type Pruefung,
} from './fn_probe'
import { gitIgnoriert } from './rezepte_probe'

export const TOKEN_BASIS = 'https://api3.foodnotify.com'
export const PAUSE_MS = 1_200
/** Harte Obergrenze je Marke, Benutzer-ID der Anmeldung mitgezählt. `--max-aufrufe` kann sie nur senken. */
export const MAX_AUFRUFE = 16
/** Kassenartikel: 19–39 s gemessen (19.11.2026), einer von drei Aufrufen brach ab. */
export const ZEITGRENZE_KASSENARTIKEL_MS = 180_000
/** Alles andere; link-targets ist ~3 MB und braucht ~11 s. */
export const ZEITGRENZE_MS = 120_000

// ---------------------------------------------------------------------------
// Erlaubtlisten und Sperrliste
// ---------------------------------------------------------------------------

export type Host = 'sitzung' | 'token'

/** Sitzung (my.foodnotify.com): nur die IDs, die das Token nicht aufzählen kann. */
export const ERLAUBT_SITZUNG: { name: string; re: RegExp }[] = [
  { name: 'profil', re: /^\/api\/profile$/ },
  { name: 'pos_standorte', re: /^\/api\/pos\/locations$/ },
  { name: 'kostenstellen', re: /^\/api\/erp\/all$/ },
]

/**
 * Token (api3.foodnotify.com). Die Formen mit Query sind GENAU die des
 * Registers (`fnEndpunkt(...).pfad(...)`); ein Test hält beide zusammen.
 */
export const ERLAUBT_TOKEN: { name: string; re: RegExp }[] = [
  { name: 'betriebe', re: /^\/api\/core\/business\/\d+\/restaurants$/ },
  { name: 'erps', re: /^\/api\/erp\/core\/\d+\/erps$/ },
  { name: 'recipe_viewer', re: /^\/api\/recipe-viewer\/recipes\?page=1$/ },
  { name: 'rezepte', re: /^\/api\/recipes\?page=1$/ },
  { name: 'link_targets', re: /^\/api\/pos\/mapping\/\d+\/link-targets$/ },
  { name: 'rezept', re: /^\/api\/recipes\/\d+$/ },
  { name: 'rezept_zutaten', re: /^\/api\/recipes\/\d+\/ingredients$/ },
  { name: 'rezept_meta', re: /^\/api\/recipes\/\d+\/meta$/ },
  { name: 'bestellungen', re: /^\/api\/\d+\/shop-order\/paginate\?page=1&page_size=25&order_by=timeCreated&order_direction=ASC$/ },
  { name: 'bestellung', re: /^\/api\/\d+\/shop-order\/\d+$/ },
  { name: 'bestellpositionen', re: /^\/api\/\d+\/shop-order\/\d+\/change\?order_by=name$/ },
  { name: 'inventuren', re: /^\/api\/erp\/stocktakings\?page=1&order_by=timeCreated&order_direction=ASC&erpIds%5B%5D=\d+$/ },
  { name: 'warenstamm', re: /^\/api\/\d+\/products\?page=1&page_size=1000$/ },
  { name: 'pos_artikel', re: /^\/api\/pos\/mapping\/\d+\/articles$/ },
]

/** Sperrliste aus fn_probe.ts (15 GETs mit Wirkung, sync/export/reload …) plus jeder Warenkorbpfad. */
export const GESPERRT: RegExp[] = [...GESPERRTE_TEILE, /cart/i]

export function pfadErlaubtFuer(host: Host, pfad: string): Pruefung {
  if (!pfad.startsWith('/')) return { ok: false, grund: 'Pfad beginnt nicht mit /' }
  for (const s of GESPERRT) if (s.test(pfad)) return { ok: false, grund: `Sperrliste: ${s}` }
  const liste = host === 'sitzung' ? ERLAUBT_SITZUNG : ERLAUBT_TOKEN
  const t = liste.find(m => m.re.test(pfad))
  return t ? { ok: true, muster: t.name } : { ok: false, grund: `nicht auf der Erlaubtliste (${host})` }
}

// ---------------------------------------------------------------------------
// Die Token-Pfade — feste Reihenfolge, je Marke dieselbe
// ---------------------------------------------------------------------------

export type TokenPfad = { key: string; register: string; vorlage: string }

export const TOKEN_PFADE: TokenPfad[] = [
  { key: 'betriebe', register: 'fn:betriebe', vorlage: '/api/core/business/{userId}/restaurants' },
  { key: 'erps', register: 'fn:kostenstellen (Ersatz für /api/erp/all)', vorlage: '/api/erp/core/{userId}/erps' },
  { key: 'recipe_viewer', register: 'fn:rezepte (Ersatz)', vorlage: '/api/recipe-viewer/recipes?page=1' },
  { key: 'rezepte', register: 'fn:rezepte', vorlage: '/api/recipes?page=1' },
  { key: 'link_targets', register: '— (nicht im Register)', vorlage: '/api/pos/mapping/{connectionId}/link-targets' },
  { key: 'rezept', register: 'fn:rezept', vorlage: '/api/recipes/{id}' },
  { key: 'rezept_zutaten', register: 'fn:rezept_zutaten', vorlage: '/api/recipes/{id}/ingredients' },
  { key: 'rezept_meta', register: 'fn:rezept_meta', vorlage: '/api/recipes/{id}/meta' },
  { key: 'bestellungen', register: 'fn:bestellungen', vorlage: '/api/{erpId}/shop-order/paginate?page=1&page_size=25&order_by=timeCreated&order_direction=ASC' },
  { key: 'bestellung', register: 'fn:bestellung', vorlage: '/api/{erpId}/shop-order/{orderId}' },
  { key: 'bestellpositionen', register: 'fn:bestellpositionen', vorlage: '/api/{erpId}/shop-order/{orderId}/change?order_by=name' },
  { key: 'inventuren', register: 'fn:inventuren', vorlage: '/api/erp/stocktakings?page=1&order_by=timeCreated&order_direction=ASC&erpIds%5B%5D={erpId}' },
  { key: 'warenstamm', register: 'fn:warenstamm', vorlage: '/api/{erpId}/products?page=1&page_size=1000' },
  { key: 'pos_artikel', register: 'fn:pos_artikel', vorlage: '/api/pos/mapping/{connectionId}/articles' },
]

/** Die Pfade in Registerform — aus dem Register gebaut, nicht abgeschrieben. */
export const registerPfad = {
  betriebe: (userId: number) => fnEndpunkt('fn:betriebe').pfad({}, userId),
  rezepte: () => fnEndpunkt('fn:rezepte').pfad({ seite: '1' }, null),
  rezept: (id: number) => fnEndpunkt('fn:rezept').pfad({ rezeptId: String(id) }, null),
  rezeptZutaten: (id: number) => fnEndpunkt('fn:rezept_zutaten').pfad({ rezeptId: String(id) }, null),
  rezeptMeta: (id: number) => fnEndpunkt('fn:rezept_meta').pfad({ rezeptId: String(id) }, null),
  bestellungen: (erpId: number) => fnEndpunkt('fn:bestellungen').pfad({ erpId: String(erpId), seite: '1' }, null),
  bestellung: (erpId: number, orderId: number) => fnEndpunkt('fn:bestellung').pfad({ erpId: String(erpId), orderId: String(orderId) }, null),
  bestellpositionen: (erpId: number, orderId: number) =>
    fnEndpunkt('fn:bestellpositionen').pfad({ erpId: String(erpId), orderId: String(orderId) }, null),
  inventuren: (erpId: number) => fnEndpunkt('fn:inventuren').pfad({ erpIds: String(erpId), seite: '1' }, null),
  warenstamm: (erpId: number) => fnEndpunkt('fn:warenstamm').pfad({ erpId: String(erpId), seite: '1' }, null),
  posArtikel: (connectionId: number) => fnEndpunkt('fn:pos_artikel').pfad({ connectionId: String(connectionId) }, null),
}

// ---------------------------------------------------------------------------
// Geheimnisse — nie in Ausgabe, Datei, Fehlertext
// ---------------------------------------------------------------------------

/** Ersetzt jedes Geheimnis (Token, Passwort) im Text. Kurze Werte (< 6 Zeichen) gelten nicht als Geheimnis. */
export function schwaerzen(text: string, geheim: readonly string[]): string {
  let t = text
  for (const g of geheim) if (g && g.length >= 6) t = t.split(g).join('<geschwärzt>')
  return t
}

/** Wirft, wenn ein Geheimnis im Text steht — die letzte Sicherung vor dem Schreiben. */
export function geheimnisPruefen(text: string, geheim: readonly string[], wo: string): void {
  for (const g of geheim) {
    if (g && g.length >= 6 && text.includes(g)) throw new Error(`fn-token-probe: ein Geheimnis stünde in ${wo} — nichts geschrieben`)
  }
}

// ---------------------------------------------------------------------------
// Formen und Auswertungen — Typen, Zählungen, Feldnamen; keine Werte
// ---------------------------------------------------------------------------

const istObjekt = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x)
const liste = (x: unknown): any[] => (Array.isArray(x) ? x : [])
const zahl = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

/**
 * Form einer Antwort nur als Typen: Listen mit Länge und Form des ersten
 * Elements, höchstens 40 Schlüssel je Objekt, drei Ebenen. Personenfelder
 * (`createdByUser` …) fallen ganz heraus — die Auswahl der Schlüssel macht
 * `feldpfade` aus fn_probe.ts.
 */
export function typForm(x: unknown, tiefe = 0): string {
  if (x === null || x === undefined) return 'null'
  if (typeof x === 'boolean') return 'bool'
  if (typeof x === 'number') return Number.isInteger(x) ? 'int' : 'num'
  if (typeof x === 'string') return 'text'
  if (Array.isArray(x)) return x.length === 0 ? '[0]' : `[${x.length}×${typForm(x[0], tiefe + 1)}]`
  if (istObjekt(x)) {
    if (tiefe >= 3) return '{…}'
    const erlaubt = new Set(feldpfade([x]).filter(k => !k.includes('.')))
    const keys = Object.keys(x).filter(k => erlaubt.has(k))
    const teile = keys.slice(0, 40).map(k => `${k}: ${typForm(x[k], tiefe + 1)}`)
    if (keys.length > 40) teile.push(`… ${keys.length - 40} weitere`)
    return `{${teile.join(', ')}}`
  }
  return '?'
}

/** Die Meldung einer Fehlerantwort: `message`/`error`/`detail`/`errors`, sonst der gekürzte Text. */
export function fehlermeldung(text: string): string {
  try {
    const j = JSON.parse(text)
    if (istObjekt(j)) {
      for (const k of ['message', 'error', 'detail', 'title']) {
        if (typeof j[k] === 'string' && j[k].trim()) return kuerzen(j[k], 200)
        if (istObjekt(j[k]) && typeof j[k].message === 'string') return kuerzen(j[k].message, 200)
      }
      if (Array.isArray(j.errors) && j.errors.length) return kuerzen(j.errors.map((e: unknown) => (typeof e === 'string' ? e : JSON.stringify(e))).join('; '), 200)
    }
  } catch { /* kein JSON */ }
  return kuerzen(text, 200)
}

export type ZutatenAuswertung = { anzahl: number; mitArtikelId: number; kinds: Record<string, number>; felder: string[] }

/** /api/recipes/{id}/ingredients: `{data: [{id, kind, …, artikelId, …}]}`. */
export function zutatenAuswerten(roh: unknown): ZutatenAuswertung {
  const z = liste(auspacken(roh).daten).filter(istObjekt)
  const kinds: Record<string, number> = {}
  for (const r of z) { const k = String(r.kind ?? '(ohne)'); kinds[k] = (kinds[k] ?? 0) + 1 }
  return {
    anzahl: z.length,
    mitArtikelId: z.filter(r => r.artikelId !== null && r.artikelId !== undefined && String(r.artikelId).trim() !== '').length,
    kinds, felder: feldpfade(z),
  }
}

export type ListenAuswertung = {
  zeilen: number
  gesamt: number | null
  seiten: number | null
  /** Was die erp-Hülle über ihre Seitengröße und Sortierung sagt (nur bei der Bestellliste). */
  seitengroesse: number | null
  sortierung: string | null
  huelle: 'payload' | 'pagination' | 'flach' | 'data' | 'nackt' | 'andere'
  felder: string[]
}

function huelleVon(roh: unknown): ListenAuswertung['huelle'] {
  if (Array.isArray(roh)) return 'nackt'
  if (!istObjekt(roh)) return 'andere'
  if ('payload' in roh) return 'payload'
  if ('pagination' in roh) return 'pagination'
  if ('total_count' in roh || 'page_count' in roh) return 'flach'
  if ('data' in roh) return 'data'
  return 'andere'
}

export function listeAuswerten(roh: unknown): ListenAuswertung {
  const a = auspacken(roh)
  const zeilen = liste(a.daten).filter(istObjekt)
  const p = istObjekt(roh) && istObjekt(roh.payload) ? roh.payload : istObjekt(roh) ? roh : {}
  return {
    zeilen: zeilen.length, gesamt: a.seiten?.gesamt ?? null, seiten: a.seiten?.gesamtSeiten ?? null,
    seitengroesse: zahl(p.current_page_size),
    sortierung: typeof p.order_by === 'string' ? `${p.order_by} ${String(p.order_direction ?? '')}`.trim() : null,
    huelle: huelleVon(roh), felder: feldpfade(zeilen),
  }
}

/** Felder eines Einzelobjekts (Rezeptkopf, Meta, Bestellkopf) — oberste Ebene und eine darunter. */
export const objektFelder = (roh: unknown): string[] => {
  const d = auspacken(roh).daten
  return istObjekt(d) ? feldpfade([d]) : []
}

/**
 * Rezeptwahl: ein Rezept MIT Zutaten (am 18.11.2026 war das gemessene Rezept
 * leer). Erst: auf Seite 1 der Rezeptliste, nicht archiviert, in link-targets
 * mit ingredientCount > 0. Dann: der erste link-target mit Zutaten. Dann: das
 * erste nicht archivierte der Seite 1. Dann: das erste überhaupt.
 */
export function rezeptWaehlen(seite1: unknown | null, linkTargets: unknown | null): { id: number; grund: string } | null {
  const rows = seite1 === null ? [] : liste(auspacken(seite1).daten).filter(istObjekt)
  const lt = linkTargets === null ? [] : (Array.isArray(linkTargets) ? linkTargets : liste(auspacken(linkTargets).daten)).filter(istObjekt)
  const mitZutaten = new Set(lt.filter(r => (zahl(r.ingredientCount) ?? 0) > 0).map(r => zahl(r.recipeId ?? r.id)).filter((n): n is number => n !== null))
  const nichtArchiviert = rows.filter(r => r.archived !== true)
  const id = (r: Record<string, any>) => zahl(r.id)
  const a = nichtArchiviert.find(r => { const i = id(r); return i !== null && mitZutaten.has(i) })
  if (a) return { id: id(a)!, grund: 'Seite 1, nicht archiviert, laut link-targets mit Zutaten' }
  const b = lt.find(r => (zahl(r.ingredientCount) ?? 0) > 0 && zahl(r.recipeId ?? r.id) !== null)
  if (b) return { id: zahl(b.recipeId ?? b.id)!, grund: 'aus link-targets, mit Zutaten (Archivstand unbekannt)' }
  const c = nichtArchiviert.find(r => id(r) !== null)
  if (c) return { id: id(c)!, grund: 'Seite 1, nicht archiviert (Zutatenzahl unbekannt)' }
  const d = rows.find(r => id(r) !== null)
  if (d) return { id: id(d)!, grund: 'Seite 1, erstes Rezept (archiviert)' }
  return null
}

/**
 * Kostenstellenwahl: eine echte (kein „test"), bevorzugt an der gewählten
 * Kassenanbindung — dann zeigen Warenstamm und Kassenartikel auf denselben Betrieb.
 */
export function kostenstelleWaehlen(
  ks: KostenstelleZeile[], ksAnDerAnbindung: Set<number>, namen: Map<number, { kostenstelle: string | null; restaurant: string | null }>,
): KostenstelleZeile | null {
  const echt = ks.filter(k => {
    const n = namen.get(k.kostenstelleId)
    return !istTestName(k.name, k.restaurantName, n?.kostenstelle, n?.restaurant)
  })
  return echt.find(k => ksAnDerAnbindung.has(k.kostenstelleId)) ?? echt[0] ?? null
}

// ---------------------------------------------------------------------------
// Der Lauf
// ---------------------------------------------------------------------------

export type Urteil = 'trägt' | 'trägt nicht' | 'unklar' | 'nicht gemessen'

export type Aufruf = {
  nr: number
  host: Host
  key: string
  pfad: string
  versuch: number
  status: number | null
  dauerMs: number | null
  bytes: number | null
  meldung: string | null
}

export type PfadErgebnis = TokenPfad & {
  urteil: Urteil
  status: number | null
  meldung: string | null
  dauerMs: number | null
  bytes: number | null
  /** Die gemessene Form (nur Typen), bei 2xx. */
  form: string | null
  /** Zählwerte und Feldnamen, je Pfad verschieden. */
  auswertung: unknown
}

export type MarkenErgebnis = {
  marke: string
  gestartet: string
  anmeldung: 'ok' | 'gescheitert' | 'kein Zugang' | 'kein Token' | 'nicht versucht'
  abbruch: string | null
  aufrufGrenze: number
  aufrufe: Aufruf[]
  sitzung: { key: string; pfad: string; urteil: Urteil; status: number | null; meldung: string | null }[]
  pfade: PfadErgebnis[]
  anbindung: { connectionId: number; kassensystem: string | null; name: string | null } | null
  kostenstelle: { erpId: number; name: string; quelle: 'token' | 'sitzung' } | null
  rezept: { id: number; grund: string } | null
  orderId: number | null
  uebersprungenTest: string[]
  befunde: string[]
}

/** Was die Probe von einer Sitzung braucht — FnSession erfüllt es, ein Test kann es nachbauen. */
export type SitzungLike = { anmelden(): Promise<void>; benutzerId: number | null; header(): Record<string, string> }

export type ProbeOptionen = {
  marken?: string[]
  aus: string
  maxAufrufe?: number
  /** Nur für Tests; sonst config.FN_API_TOKEN und fnZugaenge(). */
  tokens?: Record<string, string>
  zugaenge?: FnZugang[]
  sitzungFabrik?: (z: FnZugang) => SitzungLike
  fetchFn?: typeof fetch
  /** Nur für Tests kleiner als PAUSE_MS. */
  pauseMs?: number
  /** Nur für Tests: Takt aus fnGrenzen() übergehen. */
  ohneTakt?: boolean
  jetzt?: Date
  ausgabe?: (zeile: string) => void
}

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

export function grenzePruefen(max: number | undefined): number {
  const g = max ?? MAX_AUFRUFE
  if (!Number.isInteger(g) || g < 0) throw new Error('--max-aufrufe braucht eine ganze Zahl ≥ 0')
  if (g > MAX_AUFRUFE) throw new Error(`--max-aufrufe höchstens ${MAX_AUFRUFE} (harte Grenze je Marke)`)
  return g
}

export async function fnTokenProbe(o: ProbeOptionen): Promise<{ ergebnisse: MarkenErgebnis[]; exitCode: number }> {
  const aus = o.ausgabe ?? ((z: string) => console.log(z))
  const grenze = grenzePruefen(o.maxAufrufe)
  const pause = Math.max(o.pauseMs ?? PAUSE_MS, 0)
  const tokens = o.tokens ?? config.FN_API_TOKEN
  const zugaenge = o.zugaenge ?? fnZugaenge()
  const holen = o.fetchFn ?? fetch
  const fabrik = o.sitzungFabrik ?? ((z: FnZugang) => new FnSession(z))
  const jetzt = o.jetzt ?? new Date()
  const marken = o.marken?.length ? o.marken : MARKEN.filter(m => tokens[m])
  const unbekannt = marken.filter(m => !(MARKEN as readonly string[]).includes(m))
  if (unbekannt.length) throw new Error(`Unbekannte Marke: ${unbekannt.join(', ')} (erlaubt: ${MARKEN.join(', ')})`)

  // Alle Geheimnisse aller Marken: ein Token der einen Marke hat auch im Ordner der anderen nichts verloren.
  const geheim = [...Object.values(tokens), ...zugaenge.map(z => z.password)].filter(Boolean)
  const sch = (t: string) => schwaerzen(t, geheim)

  const ergebnisse: MarkenErgebnis[] = []
  let letzter = 0

  for (const marke of marken) {
    const e: MarkenErgebnis = {
      marke, gestartet: new Date().toISOString(), anmeldung: 'nicht versucht', abbruch: null, aufrufGrenze: grenze,
      aufrufe: [], sitzung: [], pfade: [], anbindung: null, kostenstelle: null, rezept: null, orderId: null,
      uebersprungenTest: [], befunde: [],
    }
    ergebnisse.push(e)
    const nichtGemessen = (p: TokenPfad, grund: string) =>
      e.pfade.push({ ...p, urteil: 'nicht gemessen', status: null, meldung: grund, dauerMs: null, bytes: null, form: null, auswertung: null })
    const alleNichtGemessen = (grund: string) => { for (const p of TOKEN_PFADE) nichtGemessen(p, grund) }

    const token = tokens[marke]
    if (!token) {
      e.anmeldung = 'kein Token'
      e.befunde.push(`kein Token für ${marke} in FN_API_TOKENS — übersprungen`)
      alleNichtGemessen('kein Token')
      continue
    }
    const zugang = zugaenge.find(z => z.schluessel === marke)
    if (!zugang) {
      e.anmeldung = 'kein Zugang'
      e.befunde.push(`keine FN_*-Zugangsdaten für ${marke} — ohne Sitzung keine Benutzer-ID und keine Anbindung, Marke übersprungen`)
      alleNichtGemessen('keine Sitzung (keine Zugangsdaten)')
      continue
    }
    const verzeichnis = join(o.aus, marke)
    mkdirSync(verzeichnis, { recursive: true })

    // --- 1. Sitzung: EIN Anmeldeversuch (Regel 7); die Benutzer-ID holt anmelden() über /api/profile ---
    const sitzung = fabrik(zugang)
    try {
      await sitzung.anmelden()
      e.anmeldung = 'ok'
    } catch (x) {
      e.anmeldung = 'gescheitert'
      e.abbruch = sch(x instanceof FnAnmeldungFehlgeschlagen
        ? x.message
        : `Anmeldung ${marke}: ${kuerzen(String((x as Error)?.message ?? x), 160)} — kein weiterer Versuch (AGENTS.md Regel 7)`)
      e.befunde.push(e.abbruch)
      aus(`[${marke}] ${e.abbruch}`)
      alleNichtGemessen('Anmeldung gescheitert, Marke abgebrochen')
      continue
    }
    letzter = Date.now()
    // /api/profile lief in anmelden() — ein GET, der mitzählt. Sein Status wird dort nicht herausgereicht.
    const userId = sitzung.benutzerId
    e.aufrufe.push({ nr: 1, host: 'sitzung', key: 'profil', pfad: '/api/profile', versuch: 1,
      status: userId !== null ? 200 : null, dauerMs: null, bytes: null,
      meldung: userId !== null ? 'in der Anmeldung (FnSession.anmelden), Benutzer-ID gelesen' : 'in der Anmeldung, Benutzer-ID NICHT lesbar' })
    e.sitzung.push({ key: 'profil', pfad: '/api/profile', urteil: userId !== null ? 'trägt' : 'unklar', status: userId !== null ? 200 : null,
      meldung: userId !== null ? null : 'Benutzer-ID nicht lesbar' })

    type Antwort = { status: number; text: string; json: unknown | null }

    /**
     * EIN GET. Erlaubtliste je Host, Grenze, Takt, kein Retry bei 4xx.
     * null = nicht abgesendet (Grenze/Abbruch) oder kein Ergebnis (Netz) — Grund in `nichtGrund`.
     */
    let nichtGrund = ''
    const get = async (host: Host, key: string, pfad: string, zeitgrenze = ZEITGRENZE_MS, versuch = 1): Promise<Antwort | null> => {
      const p = pfadErlaubtFuer(host, pfad)
      if (!p.ok) throw new Error(`fn-token-probe: Pfad nicht erlaubt (${p.grund}): ${pfad}`)
      if (e.abbruch) { nichtGrund = `Abbruch: ${e.abbruch}`; return null }
      if (e.aufrufe.length >= grenze) { nichtGrund = `Aufrufgrenze ${grenze} erreicht`; return null }
      const takt = o.ohneTakt ? 0 : (() => { const { taktMin, taktMax } = fnGrenzen(); return taktMin + Math.floor(Math.random() * (taktMax - taktMin + 1)) })()
      const warten = Math.max(pause, takt) - (Date.now() - letzter)
      if (warten > 0) await schlaf(warten)

      const a: Aufruf = { nr: e.aufrufe.length + 1, host, key, pfad, versuch, status: null, dauerMs: null, bytes: null, meldung: null }
      e.aufrufe.push(a)
      const kopf: Record<string, string> = host === 'token'
        ? { accept: 'application/json', 'user-agent': config.LINA_USER_AGENT, authorization: `Bearer ${token}` }
        : sitzung.header()
      const basis = host === 'token' ? TOKEN_BASIS : config.FN_BASE_URL
      const start = Date.now()
      let text = ''
      let status = 0
      let ort = ''
      try {
        const res = await holen(`${basis}${pfad}`, { method: 'GET', headers: kopf, redirect: 'manual', signal: AbortSignal.timeout(zeitgrenze) })
        status = res.status
        ort = res.headers.get('location') ?? ''
        text = await res.text()
      } catch (x) {
        a.dauerMs = Date.now() - start
        letzter = Date.now()
        a.meldung = sch(`kein Ergebnis: ${kuerzen(String((x as Error)?.name === 'TimeoutError' ? `Zeitgrenze ${zeitgrenze / 1000} s überschritten` : (x as Error)?.message ?? x), 160)}`)
        nichtGrund = a.meldung
        return null
      }
      a.dauerMs = Date.now() - start
      letzter = Date.now()
      a.status = status
      a.bytes = new TextEncoder().encode(text).length
      text = sch(text)
      let json: unknown | null = null
      if (text.trim()) { try { json = JSON.parse(text) } catch { json = null } }
      // Rohantwort, geschwärzt, auch bei Fehlerstatus (der Fehlertext ist der Beleg).
      const datei = `${String(a.nr).padStart(2, '0')}_${host}_${key}${versuch > 1 ? `_v${versuch}` : ''}.${json !== null ? 'json' : 'txt'}`
      writeFileSync(join(verzeichnis, datei), text)
      if (status < 200 || status >= 300) a.meldung = sch(fehlermeldung(text))
      if (status === 429) {
        e.abbruch = `HTTP 429 bei ${key} — Abbruch der Marke, nichts wiederholt`
        e.befunde.push(e.abbruch)
      } else if (status === 401 || (status >= 300 && status < 400 && /login/i.test(ort))) {
        e.abbruch = `HTTP ${status} bei ${key} (${host}) — Abbruch der Marke, keine neue Anmeldung`
        e.befunde.push(e.abbruch)
      }
      return { status, text, json }
    }

    /** Ein Token-Pfad: abschicken, urteilen, auswerten. */
    const messen = async (
      p: TokenPfad, pfad: string | null, ohneGrund: string, auswerten: (json: unknown) => unknown,
      zeitgrenze = ZEITGRENZE_MS,
    ): Promise<unknown | null> => {
      if (pfad === null) { nichtGemessen(p, ohneGrund); return null }
      let r = await get('token', p.key, pfad, zeitgrenze)
      // Der EINE zweite Versuch: nur Kassenartikel, nur bei Netzfehler/Zeitgrenze, nur wenn die Grenze es zulässt.
      if (r === null && p.key === 'pos_artikel' && nichtGrund.startsWith('kein Ergebnis') && !e.abbruch && e.aufrufe.length < grenze) {
        e.befunde.push(`pos_artikel: erster Versuch ohne Ergebnis (${nichtGrund}) — ein zweiter Versuch`)
        r = await get('token', p.key, pfad, zeitgrenze, 2)
      }
      const letzte = [...e.aufrufe].reverse().find(a => a.key === p.key) ?? null
      if (r === null) {
        // Abgesendet, aber ohne Antwort → unklar; gar nicht abgesendet → nicht gemessen.
        const abgesendet = letzte !== null && letzte.pfad === pfad
        e.pfade.push({ ...p, urteil: abgesendet ? 'unklar' : 'nicht gemessen', status: null, meldung: nichtGrund,
          dauerMs: abgesendet ? letzte!.dauerMs : null, bytes: null, form: null, auswertung: null })
        return null
      }
      const huelle = r.json !== null ? auspacken(r.json).fehler : null
      let urteil: Urteil
      if (r.status >= 200 && r.status < 300 && (r.status === 204 || r.json !== null) && !huelle) urteil = 'trägt'
      else if (r.status === 401 || r.status === 403) urteil = 'trägt nicht'
      else urteil = 'unklar'
      let auswertung: unknown = null
      if (urteil === 'trägt' && r.json !== null) {
        try { auswertung = auswerten(r.json) } catch (x) { auswertung = { fehler: sch(String((x as Error).message).slice(0, 160)) } }
      }
      e.pfade.push({ ...p, urteil, status: r.status,
        meldung: huelle ? sch(`Hüllenfehler: ${kuerzen(huelle, 160)}`) : (r.status >= 300 ? letzte?.meldung ?? null : (r.json === null && r.status !== 204 ? 'Antwort ist kein JSON' : null)),
        dauerMs: letzte?.dauerMs ?? null, bytes: letzte?.bytes ?? null,
        form: urteil === 'trägt' && r.json !== null ? typForm(r.json) : null, auswertung })
      return urteil === 'trägt' ? r.json : null
    }
    const pfad = (key: string) => TOKEN_PFADE.find(t => t.key === key)!

    // --- Sitzung: Kassenanbindungen ---------------------------------------
    const stAntwort = await get('sitzung', 'pos_standorte', '/api/pos/locations')
    const stJson = stAntwort && stAntwort.status === 200 ? stAntwort.json : null
    e.sitzung.push({ key: 'pos_standorte', pfad: '/api/pos/locations', urteil: stJson ? 'trägt' : stAntwort ? 'unklar' : 'nicht gemessen',
      status: stAntwort?.status ?? null, meldung: stJson ? null : (stAntwort ? e.aufrufe[e.aufrufe.length - 1]!.meldung : nichtGrund) })
    const standorte = stJson ? posStandorte(stJson) : []
    const namen = stJson ? standortNamen(stJson) : new Map()
    const auswertungSt = stJson ? standorteAuswerten(standorte, namen) : null
    for (const a of auswertungSt?.anbindungen.filter(x => x.test) ?? []) e.uebersprungenTest.push(`Anbindung ${a.connectionId} (${a.namen.join(', ') || 'ohne Namen'})`)
    const anb = auswertungSt ? anbindungenWaehlen(auswertungSt, 1)[0] ?? null : null
    if (anb) e.anbindung = { connectionId: anb.connectionId, kassensystem: anb.kassensystem, name: anb.namen.join(', ') || null }
    else if (stJson) e.befunde.push('keine echte Kassenanbindung in /api/pos/locations — link-targets und Kassenartikel nicht messbar')
    const ksAnDerAnbindung = new Set(standorte.filter(s => anb && s.connectionId === anb.connectionId).map(s => s.kostenstelleId))

    // --- Token: Betriebe und Kostenstellen ---------------------------------
    const ohneUser = 'keine Benutzer-ID (Sitzung /api/profile)'
    await messen(pfad('betriebe'), userId !== null ? registerPfad.betriebe(userId) : null, ohneUser,
      j => ({ anzahl: liste(auspacken(j).daten).length, felder: feldpfade(liste(auspacken(j).daten)) }))
    const erpsJson = await messen(pfad('erps'), userId !== null ? `/api/erp/core/${userId}/erps` : null, ohneUser,
      j => { const k = kostenstellen(j); return { anzahl: k.length, test: k.filter(x => istTestName(x.name, x.restaurantName)).length, felder: feldpfade(liste(auspacken(j).daten)) } })
    let ks: KostenstelleZeile[] = erpsJson ? kostenstellen(erpsJson) : []
    let ksQuelle: 'token' | 'sitzung' = 'token'
    if (ks.length === 0) {
      // Rückfall: die Sitzung zählt die Kostenstellen auf (zählt mit; an der Grenze fällt dafür der letzte Pfad weg).
      const r = await get('sitzung', 'kostenstellen', '/api/erp/all')
      const j = r && r.status === 200 ? r.json : null
      e.sitzung.push({ key: 'kostenstellen', pfad: '/api/erp/all', urteil: j ? 'trägt' : r ? 'unklar' : 'nicht gemessen', status: r?.status ?? null,
        meldung: j ? 'Rückfall, weil das Token keine Kostenstellen lieferte' : (r ? e.aufrufe[e.aufrufe.length - 1]!.meldung : nichtGrund) })
      ks = j ? kostenstellen(j) : []
      ksQuelle = 'sitzung'
    }
    for (const k of ks.filter(x => istTestName(x.name, x.restaurantName, namen.get(x.kostenstelleId)?.kostenstelle, namen.get(x.kostenstelleId)?.restaurant))) {
      e.uebersprungenTest.push(`Kostenstelle ${k.erpId} (${[k.restaurantName, k.name].filter(Boolean).join(' — ')})`)
    }
    const ksWahl = kostenstelleWaehlen(ks, ksAnDerAnbindung, namen)
    if (ksWahl) {
      const n = namen.get(ksWahl.kostenstelleId)
      const name = [ksWahl.restaurantName ?? n?.restaurant, ksWahl.name || n?.kostenstelle].filter(Boolean).join(' — ') || '(ohne Namen)'
      e.kostenstelle = { erpId: ksWahl.erpId, name, quelle: ksQuelle }
    }
    const erpId = e.kostenstelle?.erpId ?? null
    const ohneErp = 'keine echte Kostenstelle gefunden'

    // --- Token: Rezepte -----------------------------------------------------
    const seite1 = await messen(pfad('recipe_viewer'), '/api/recipe-viewer/recipes?page=1', '', j => rezeptlisteAuswerten(j))
    const seite1alt = await messen(pfad('rezepte'), registerPfad.rezepte(), '', j => rezeptlisteAuswerten(j))
    const lt = await messen(pfad('link_targets'), anb ? `/api/pos/mapping/${anb.connectionId}/link-targets` : null, 'keine echte Kassenanbindung',
      j => {
        const { csv: _csv, updatedAtJeTag: _t, updatedAtJeMonat: _m, ...rest } = linkTargetsAuswerten(j, jetzt)
        return rest
      })
    e.rezept = rezeptWaehlen(seite1 ?? seite1alt, lt)
    const rid = e.rezept?.id ?? null
    const ohneRezept = 'keine Rezept-ID (weder Rezeptliste noch link-targets)'
    await messen(pfad('rezept'), rid !== null ? registerPfad.rezept(rid) : null, ohneRezept,
      j => { const d = auspacken(j).daten; return { archived: istObjekt(d) ? d.archived ?? null : null, felder: objektFelder(j) } })
    await messen(pfad('rezept_zutaten'), rid !== null ? registerPfad.rezeptZutaten(rid) : null, ohneRezept, j => zutatenAuswerten(j))
    await messen(pfad('rezept_meta'), rid !== null ? registerPfad.rezeptMeta(rid) : null, ohneRezept, j => ({ felder: objektFelder(j) }))

    // --- Token: Einkauf -----------------------------------------------------
    const bl = await messen(pfad('bestellungen'), erpId !== null ? registerPfad.bestellungen(erpId) : null, ohneErp, j => listeAuswerten(j))
    const ersteBestellung = bl ? liste(auspacken(bl).daten).filter(istObjekt).map(r => zahl(r.id)).find(n => n !== null && Number.isInteger(n)) ?? null : null
    e.orderId = ersteBestellung
    const blErgebnis = e.pfade.find(p => p.key === 'bestellungen')
    const ohneOrder = erpId === null ? ohneErp
      : bl ? 'Bestellliste leer — keine Bestellung an dieser Kostenstelle'
      : `keine Bestell-ID — Bestellliste ${blErgebnis?.urteil ?? '?'}${blErgebnis?.meldung ? ` (${blErgebnis.meldung})` : ''}`
    await messen(pfad('bestellung'), erpId !== null && ersteBestellung !== null ? registerPfad.bestellung(erpId, ersteBestellung) : null, ohneOrder,
      j => ({ felder: objektFelder(j) }))
    await messen(pfad('bestellpositionen'), erpId !== null && ersteBestellung !== null ? registerPfad.bestellpositionen(erpId, ersteBestellung) : null, ohneOrder,
      j => listeAuswerten(j))
    await messen(pfad('inventuren'), erpId !== null ? registerPfad.inventuren(erpId) : null, ohneErp, j => listeAuswerten(j))

    // --- Token: Warenstamm und Kassenartikel --------------------------------
    await messen(pfad('warenstamm'), erpId !== null ? registerPfad.warenstamm(erpId) : null, ohneErp,
      j => {
        const w = warenstammAuswerten(j, 1000)
        return { zeilen: w.zeilen, gesamt: w.gesamt, seitenZahl: w.seitenZahl, seitengroesseGemeldet: w.seitengroesseGemeldet,
          mitIngredientArtikelId: w.mitIngredientArtikelId, preisfelder: w.preisfelder, felder: w.felder }
      })
    await messen(pfad('pos_artikel'), anb ? registerPfad.posArtikel(anb.connectionId) : null, 'keine echte Kassenanbindung',
      j => {
        const a = artikelAuswerten(j)
        return { artikel: a.artikel, mitRezept: a.mitRezept, mitRezeptPct: a.mitRezeptPct, ignoriert: a.ignoriert,
          pluNurZiffern: a.pluNurZiffern, pluLeer: a.pluLeer, ingestIssues: a.ingestIssues, felder: a.felder }
      }, ZEITGRENZE_KASSENARTIKEL_MS)

    if (e.aufrufe.length > grenze) throw new Error(`fn-token-probe: Aufrufgrenze überschritten (${e.aufrufe.length} > ${grenze}) — Programmfehler`)
    konsole(aus, e)
  }

  zusammenfassungSchreiben(o.aus, ergebnisse, jetzt, geheim)
  const vollstaendig = ergebnisse.every(e => !e.abbruch && e.pfade.every(p => p.urteil !== 'nicht gemessen'))
  return { ergebnisse, exitCode: vollstaendig ? 0 : 2 }
}

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------

function konsole(aus: (z: string) => void, e: MarkenErgebnis) {
  aus(`[${e.marke}] ${e.aufrufe.length} GET (Grenze ${e.aufrufGrenze}); Anbindung ${e.anbindung ? `${e.anbindung.connectionId} ${e.anbindung.name ?? ''}` : '—'}; `
    + `Kostenstelle ${e.kostenstelle ? `${e.kostenstelle.erpId} ${e.kostenstelle.name}` : '—'}`)
  for (const p of e.pfade) aus(`  ${p.key.padEnd(18)} ${p.urteil.padEnd(14)} ${p.status ?? '—'} ${p.meldung ?? ''}`.trimEnd())
  if (e.abbruch) aus(`  ABBRUCH: ${e.abbruch}`)
}

/** Kurzform einer Zelle der Matrix: „200", „403 scope-limited", „— keine ID". */
export function zelle(p: PfadErgebnis | undefined): string {
  if (!p) return '—'
  if (p.urteil === 'trägt') return `**${p.status}** trägt`
  if (p.urteil === 'nicht gemessen') return `nicht gemessen (${p.meldung ?? '?'})`
  const m = p.meldung ?? ''
  const kurz = /scope-limited/i.test(m) ? '„scope-limited"' : /access denied/i.test(m) ? '„Access Denied"' : m ? `„${kuerzen(m, 60)}"` : ''
  return `${p.status ?? '—'} ${p.urteil}${kurz ? ` ${kurz}` : ''}`
}

const esc = (s: unknown) => String(s ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function zusammenfassungMarkdown(es: MarkenErgebnis[], jetzt: Date): string {
  const z: string[] = []
  z.push(`# fn-token-probe ${jetzt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, '')
  z.push('Scope-Token gegen `https://api3.foodnotify.com`, nur GET, je Pfad ein Aufruf. Sitzung (`my.foodnotify.com`) nur für Benutzer-ID und Kassenanbindungen. Werte: nur Zählungen, Feldnamen, Typen, IDs und Namen von Kostenstelle und Anbindung.', '')
  z.push('## Matrix Marke × Pfad (Token)', '')
  z.push(`| Pfad | Register | ${es.map(e => e.marke).join(' | ')} |`)
  z.push(`|---|---|${es.map(() => '---').join('|')}|`)
  for (const t of TOKEN_PFADE) z.push(`| \`${esc(t.vorlage)}\` | ${esc(t.register)} | ${es.map(e => esc(zelle(e.pfade.find(p => p.key === t.key)))).join(' | ')} |`)
  z.push('', '## Je Marke', '')
  for (const e of es) {
    z.push(`### ${e.marke}`, '')
    z.push(`* Beginn ${e.gestartet}, Anmeldung ${e.anmeldung}, ${e.aufrufe.length} GET von höchstens ${e.aufrufGrenze}${e.abbruch ? `, **Abbruch:** ${esc(e.abbruch)}` : ''}`)
    z.push(`* Anbindung: ${e.anbindung ? `${e.anbindung.connectionId} (${esc(e.anbindung.kassensystem)}) — ${esc(e.anbindung.name)}` : '—'}`)
    z.push(`* Kostenstelle: ${e.kostenstelle ? `erpId ${e.kostenstelle.erpId} — ${esc(e.kostenstelle.name)} (gewählt aus ${e.kostenstelle.quelle === 'token' ? 'Token `/api/erp/core/{userId}/erps`' : 'Sitzung `/api/erp/all`'})` : '—'}`)
    z.push(`* Rezept: ${e.rezept ? `${e.rezept.id} (${esc(e.rezept.grund)})` : '—'}; Bestellung: ${e.orderId ?? '—'}`)
    if (e.uebersprungenTest.length) z.push(`* Übersprungen (Test): ${esc(e.uebersprungenTest.join('; '))}`)
    z.push(`* Sitzung: ${e.sitzung.map(s => `\`${s.pfad}\` ${s.urteil}${s.status ? ` (${s.status})` : ''}${s.meldung ? ` — ${esc(s.meldung)}` : ''}`).join('; ') || '—'}`)
    for (const b of e.befunde) z.push(`* Befund: ${esc(b)}`)
    z.push('', '| # | Host | Pfad | Status | Dauer | Bytes | Meldung |', '|---|---|---|---|---|---|---|')
    for (const a of e.aufrufe) {
      z.push(`| ${a.nr} | ${a.host} | \`${esc(a.pfad)}\`${a.versuch > 1 ? ' (2. Versuch)' : ''} | ${a.status ?? '—'} | ${a.dauerMs !== null ? `${(a.dauerMs / 1000).toFixed(1)} s` : '—'} | ${a.bytes ?? '—'} | ${esc(a.meldung ?? '')} |`)
    }
    z.push('')
    for (const p of e.pfade.filter(p => p.urteil === 'trägt')) {
      z.push(`**${p.key}** — Form: \`${esc(p.form)}\``, '')
      if (p.auswertung) z.push('```json', JSON.stringify(p.auswertung, null, 1), '```', '')
    }
  }
  return z.join('\n') + '\n'
}

function zusammenfassungSchreiben(verzeichnis: string, es: MarkenErgebnis[], jetzt: Date, geheim: readonly string[]) {
  mkdirSync(verzeichnis, { recursive: true })
  const md = zusammenfassungMarkdown(es, jetzt)
  const matrix = Object.fromEntries(TOKEN_PFADE.map(t => [t.key, Object.fromEntries(es.map(e => {
    const p = e.pfade.find(x => x.key === t.key)
    return [e.marke, p ? { urteil: p.urteil, status: p.status, meldung: p.meldung } : null]
  }))]))
  const json = JSON.stringify({ gemessen: jetzt.toISOString(), pfade: TOKEN_PFADE, matrix, marken: es }, null, 1)
  geheimnisPruefen(md, geheim, 'zusammenfassung.md')
  geheimnisPruefen(json, geheim, 'zusammenfassung.json')
  writeFileSync(join(verzeichnis, 'zusammenfassung.md'), md)
  writeFileSync(join(verzeichnis, 'zusammenfassung.json'), json)
}

// ---------------------------------------------------------------------------
// --vergleich: liefern Token und Sitzung dieselben Zeilen? (19.11.2026)
// ---------------------------------------------------------------------------
/*
 * ANLASS: Der Umbau „Rezepte, Kassenartikel und Warenstamm über das Token,
 * Sitzung als Rückfall" (Migration 0160) setzt voraus, dass beide Zugänge
 * DIESELBEN Daten liefern. Die Matrix oben misst nur Status und Form. Hier
 * wird je Marke an GENAU den Zielen der Matrixmessung vom 19.11.2026 18:51 UTC
 * (docs/payloads/foodnotify-2026-11/fn-token-probe-2026-11-19.md) jeder Abruf
 * einmal mit Sitzung (my.foodnotify.com) und einmal mit Token (api3) geholt
 * und in kanonischer Form verglichen.
 *
 * Die Ziele stehen fest im Code statt neu gewählt zu werden: dieselbe Auswahl
 * hätte vier Aufrufe mehr gekostet (Standorte, link-targets), und die
 * Grenze ist 14. Die Namen werden live gegengeprüft — die Kostenstelle über
 * die Token-Antwort /api/erp/core/{userId}/erps (Name, Testprüfung).
 *
 * AUFRUFE je Marke (höchstens 14 GET, die Anmeldung ist ein POST):
 *   1  Sitzung /api/profile (in der Anmeldung, Benutzer-ID)
 *   1  Token   /api/erp/core/{userId}/erps (Name der Kostenstelle, keine „test")
 *   2  Rezeptliste Seite 1: Sitzung /api/recipes?page=1, Token /api/recipe-viewer/recipes?page=1
 *   6  Rezept Kopf, Zutaten, Meta — je beide Zugänge
 *   2  Kassenartikel — je beide (Zeitgrenze 180 s; Abbruch = „nicht gemessen", nie „ungleich")
 *   2  Warenstamm Seite 1, page_size 1000 — je beide
 *  = 14. Kein zweiter Versuch, kein Retry bei 4xx, 401/429 brechen die Marke ab.
 */

export const MAX_AUFRUFE_VERGLEICH = 14

/** Sitzungspfade, die nur der Vergleich braucht — genau die Registerformen. */
export const ERLAUBT_SITZUNG_VERGLEICH: { name: string; re: RegExp }[] = [
  { name: 'profil', re: /^\/api\/profile$/ },
  { name: 'rezepte', re: /^\/api\/recipes\?page=1$/ },
  { name: 'rezept', re: /^\/api\/recipes\/\d+$/ },
  { name: 'rezept_zutaten', re: /^\/api\/recipes\/\d+\/ingredients$/ },
  { name: 'rezept_meta', re: /^\/api\/recipes\/\d+\/meta$/ },
  { name: 'warenstamm', re: /^\/api\/\d+\/products\?page=1&page_size=1000$/ },
  { name: 'pos_artikel', re: /^\/api\/pos\/mapping\/\d+\/articles$/ },
]

export function pfadErlaubtVergleich(host: Host, pfad: string): Pruefung {
  if (!pfad.startsWith('/')) return { ok: false, grund: 'Pfad beginnt nicht mit /' }
  for (const s of GESPERRT) if (s.test(pfad)) return { ok: false, grund: `Sperrliste: ${s}` }
  const liste = host === 'sitzung' ? ERLAUBT_SITZUNG_VERGLEICH : ERLAUBT_TOKEN
  const t = liste.find(m => m.re.test(pfad))
  return t ? { ok: true, muster: t.name } : { ok: false, grund: `nicht auf der Erlaubtliste des Vergleichs (${host})` }
}

export type VergleichsZiel = { connectionId: number; anbindung: string; erpId: number; kostenstelle: string; rezeptId: number }

/** Die Ziele der Matrixmessung vom 19.11.2026 18:51 UTC — keine mit „test" im Namen. */
export const VERGLEICH_ZIELE: Record<(typeof MARKEN)[number], VergleichsZiel> = {
  aposto: { connectionId: 2070, anbindung: 'Aposto Aalen — Küche Aposto Aalen', erpId: 10117, kostenstelle: 'Aposto Aalen — Küche', rezeptId: 1520792 },
  enchilada: { connectionId: 1095, anbindung: 'Enchilada Köln — Küche Enchilada Köln', erpId: 10059, kostenstelle: 'Enchilada Köln — Küche', rezeptId: 1521756 },
  deutsche_konzepte: { connectionId: 1729, anbindung: 'WHK Gastronomie GmbH — Würzburger Hofbräu Küche', erpId: 12011, kostenstelle: 'Würzburger Hofbräu Küche', rezeptId: 1520134 },
  wilma_wunder: { connectionId: 2052, anbindung: 'Wilma Wunder Ballplatz Mainz — Bar Ballplatz', erpId: 7984, kostenstelle: 'Bar Ballplatz', rezeptId: 1524384 },
}

/** Die Abrufpaare: Sitzungspfad gegen Tokenpfad. Nur die Rezeptliste unterscheidet sich im Pfad. */
export function vergleichsPaare(z: VergleichsZiel): { key: string; register: string; sitzung: string; token: string; zeitgrenze: number }[] {
  return [
    { key: 'rezeptliste', register: 'fn:rezepte', sitzung: registerPfad.rezepte(), token: '/api/recipe-viewer/recipes?page=1', zeitgrenze: ZEITGRENZE_MS },
    { key: 'rezept', register: 'fn:rezept', sitzung: registerPfad.rezept(z.rezeptId), token: registerPfad.rezept(z.rezeptId), zeitgrenze: ZEITGRENZE_MS },
    { key: 'rezept_zutaten', register: 'fn:rezept_zutaten', sitzung: registerPfad.rezeptZutaten(z.rezeptId), token: registerPfad.rezeptZutaten(z.rezeptId), zeitgrenze: ZEITGRENZE_MS },
    { key: 'rezept_meta', register: 'fn:rezept_meta', sitzung: registerPfad.rezeptMeta(z.rezeptId), token: registerPfad.rezeptMeta(z.rezeptId), zeitgrenze: ZEITGRENZE_MS },
    { key: 'pos_artikel', register: 'fn:pos_artikel', sitzung: registerPfad.posArtikel(z.connectionId), token: registerPfad.posArtikel(z.connectionId), zeitgrenze: ZEITGRENZE_KASSENARTIKEL_MS },
    { key: 'warenstamm', register: 'fn:warenstamm', sitzung: registerPfad.warenstamm(z.erpId), token: registerPfad.warenstamm(z.erpId), zeitgrenze: ZEITGRENZE_MS },
  ]
}

/** Schlüssel, nach denen eine Liste von Objekten als Menge gelesen wird (in dieser Reihenfolge). */
const ID_SCHLUESSEL = ['id', 'remoteProductId', 'recipeId'] as const

function idSchluessel(liste: unknown[]): string | null {
  if (liste.length === 0 || !liste.every(istObjekt)) return null
  for (const k of ID_SCHLUESSEL) {
    const ids = (liste as Record<string, unknown>[]).map(o => o[k])
    if (ids.every(i => typeof i === 'number' || (typeof i === 'string' && i !== ''))
        && new Set(ids.map(String)).size === ids.length) return k
  }
  return null
}

/** Kanonische Form: Schlüssel sortiert; `sortiert` = Listen mit eindeutiger ID nach ID geordnet. */
export function kanonisch(x: unknown, sortiert: boolean): unknown {
  if (Array.isArray(x)) {
    const k = x.map(e => kanonisch(e, sortiert))
    const id = sortiert ? idSchluessel(x) : null
    if (!id) return k
    return [...k].sort((a, b) => {
      const ia = (a as Record<string, unknown>)[id], ib = (b as Record<string, unknown>)[id]
      return typeof ia === 'number' && typeof ib === 'number' ? ia - ib : String(ia).localeCompare(String(ib))
    })
  }
  if (istObjekt(x)) return Object.fromEntries(Object.keys(x).sort().map(k => [k, kanonisch(x[k], sortiert)]))
  return x
}

export type Abweichung = { pfad: string; art: 'nur sitzung' | 'nur token' | 'wert' | 'typ'; anzahl: number }
export type VergleichsUrteil = 'gleich' | 'gleich bis auf Reihenfolge' | 'ungleich' | 'nicht gemessen'
export type Mengenabgleich = { pfad: string; schluessel: string; sitzung: number; token: number; nurSitzung: (string | number)[]; nurToken: (string | number)[]; nurSitzungAnzahl: number; nurTokenAnzahl: number }

const typVon = (x: unknown) => (x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x)

/**
 * Vergleicht zwei Antworten. Liefert NUR Feldpfade, Zählungen und IDs — nie
 * Werte. Listen von Objekten mit eindeutiger ID werden als Menge verglichen
 * (IDs nur auf einer Seite stehen in `mengen`, höchstens zehn je Seite).
 */
export function antwortenVergleichen(sitzung: unknown, token: unknown): { urteil: Exclude<VergleichsUrteil, 'nicht gemessen'>; abweichungen: Abweichung[]; mengen: Mengenabgleich[] } {
  const roh = (x: unknown) => JSON.stringify(kanonisch(x, false))
  const sort = (x: unknown) => JSON.stringify(kanonisch(x, true))
  if (roh(sitzung) === roh(token)) return { urteil: 'gleich', abweichungen: [], mengen: [] }
  if (sort(sitzung) === sort(token)) return { urteil: 'gleich bis auf Reihenfolge', abweichungen: [], mengen: [] }
  const ab = new Map<string, Abweichung>()
  const mengen: Mengenabgleich[] = []
  const merke = (pfad: string, art: Abweichung['art']) => {
    const k = `${art}|${pfad}`
    const a = ab.get(k)
    if (a) a.anzahl++
    else ab.set(k, { pfad, art, anzahl: 1 })
  }
  const lauf = (a: unknown, b: unknown, pfad: string) => {
    if (typVon(a) !== typVon(b)) { merke(pfad || '(Wurzel)', 'typ'); return }
    if (Array.isArray(a) && Array.isArray(b)) {
      const id = idSchluessel(a) ?? idSchluessel(b)
      if (id && (a.length === 0 || idSchluessel(a) === id) && (b.length === 0 || idSchluessel(b) === id)) {
        const ma = new Map((a as Record<string, unknown>[]).map(o => [String(o[id]), o]))
        const mb = new Map((b as Record<string, unknown>[]).map(o => [String(o[id]), o]))
        const nurA = [...ma.keys()].filter(k => !mb.has(k))
        const nurB = [...mb.keys()].filter(k => !ma.has(k))
        if (nurA.length || nurB.length) {
          const alsId = (s: string) => (/^\d+$/.test(s) ? Number(s) : s)
          mengen.push({ pfad: `${pfad}[]`, schluessel: id, sitzung: a.length, token: b.length,
            nurSitzung: nurA.slice(0, 10).map(alsId), nurToken: nurB.slice(0, 10).map(alsId),
            nurSitzungAnzahl: nurA.length, nurTokenAnzahl: nurB.length })
        }
        for (const [k, oa] of ma) { const ob = mb.get(k); if (ob !== undefined) lauf(oa, ob, `${pfad}[]`) }
        return
      }
      if (a.length !== b.length) merke(`${pfad}[] (Länge ${a.length} gegen ${b.length})`, 'wert')
      for (let i = 0; i < Math.min(a.length, b.length); i++) lauf(a[i], b[i], `${pfad}[]`)
      return
    }
    if (istObjekt(a) && istObjekt(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const p = pfad ? `${pfad}.${k}` : k
        if (!(k in b)) merke(p, 'nur sitzung')
        else if (!(k in a)) merke(p, 'nur token')
        else lauf(a[k], b[k], p)
      }
      return
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) merke(pfad || '(Wurzel)', 'wert')
  }
  lauf(kanonisch(sitzung, true), kanonisch(token, true), '')
  return { urteil: 'ungleich', abweichungen: [...ab.values()].sort((x, y) => x.pfad.localeCompare(y.pfad)).slice(0, 60), mengen }
}

export type PaarErgebnis = {
  key: string; register: string; sitzungPfad: string; tokenPfad: string
  urteil: VergleichsUrteil; grund: string | null
  sitzung: { status: number | null; dauerMs: number | null; bytes: number | null; zeilen: number | null; meldung: string | null }
  token: { status: number | null; dauerMs: number | null; bytes: number | null; zeilen: number | null; meldung: string | null }
  abweichungen: Abweichung[]; mengen: Mengenabgleich[]
}

export type VergleichsMarke = {
  marke: string; gestartet: string; anmeldung: MarkenErgebnis['anmeldung']; abbruch: string | null
  ziel: VergleichsZiel | null; kostenstelleLive: string | null; kostenstelleTest: boolean | null
  aufrufe: Aufruf[]; paare: PaarErgebnis[]; befunde: string[]
}

/** Zeilen einer Antwort, je Abruf: Liste aus der Hülle, Kassenartikel `items`, sonst null. */
function zeilenZahl(key: string, j: unknown): number | null {
  if (j === null || j === undefined) return null
  if (key === 'pos_artikel') return istObjekt(j) && Array.isArray(j.items) ? j.items.length : null
  const d = auspacken(j).daten
  return Array.isArray(d) ? d.length : null
}

export async function fnTokenVergleich(o: ProbeOptionen): Promise<{ ergebnisse: VergleichsMarke[]; exitCode: number }> {
  const aus = o.ausgabe ?? ((z: string) => console.log(z))
  const pause = Math.max(o.pauseMs ?? PAUSE_MS, 0)
  const tokens = o.tokens ?? config.FN_API_TOKEN
  const zugaenge = o.zugaenge ?? fnZugaenge()
  const holen = o.fetchFn ?? fetch
  const fabrik = o.sitzungFabrik ?? ((z: FnZugang) => new FnSession(z))
  const jetzt = o.jetzt ?? new Date()
  const grenze = Math.min(o.maxAufrufe ?? MAX_AUFRUFE_VERGLEICH, MAX_AUFRUFE_VERGLEICH)
  const marken = o.marken?.length ? o.marken : MARKEN.filter(m => tokens[m])
  const geheim = [...Object.values(tokens), ...zugaenge.map(z => z.password)].filter(Boolean)
  const sch = (t: string) => schwaerzen(t, geheim)
  const ergebnisse: VergleichsMarke[] = []
  let letzter = 0

  for (const marke of marken) {
    const ziel = VERGLEICH_ZIELE[marke as keyof typeof VERGLEICH_ZIELE] ?? null
    const e: VergleichsMarke = { marke, gestartet: new Date().toISOString(), anmeldung: 'nicht versucht', abbruch: null,
      ziel, kostenstelleLive: null, kostenstelleTest: null, aufrufe: [], paare: [], befunde: [] }
    ergebnisse.push(e)
    const token = tokens[marke]
    const zugang = zugaenge.find(z => z.schluessel === marke)
    if (!ziel || !token || !zugang) {
      e.anmeldung = !token ? 'kein Token' : 'kein Zugang'
      e.befunde.push(!ziel ? 'kein Vergleichsziel' : !token ? 'kein Token' : 'keine Sitzungs-Zugangsdaten')
      continue
    }
    const verzeichnis = join(o.aus, marke)
    mkdirSync(verzeichnis, { recursive: true })
    const sitzung = fabrik(zugang)
    try { await sitzung.anmelden(); e.anmeldung = 'ok' } catch (x) {
      e.anmeldung = 'gescheitert'
      e.abbruch = sch(x instanceof FnAnmeldungFehlgeschlagen ? x.message : `Anmeldung ${marke}: ${kuerzen(String((x as Error)?.message ?? x), 160)} — kein weiterer Versuch (AGENTS.md Regel 7)`)
      aus(`[${marke}] ${e.abbruch}`)
      continue
    }
    letzter = Date.now()
    e.aufrufe.push({ nr: 1, host: 'sitzung', key: 'profil', pfad: '/api/profile', versuch: 1, status: sitzung.benutzerId !== null ? 200 : null,
      dauerMs: null, bytes: null, meldung: 'in der Anmeldung (FnSession.anmelden)' })

    type Antwort = { status: number | null; json: unknown | null; meldung: string | null; dauerMs: number | null; bytes: number | null }
    const get = async (host: Host, key: string, pfad: string, zeitgrenze: number): Promise<Antwort | null> => {
      const p = pfadErlaubtVergleich(host, pfad)
      if (!p.ok) throw new Error(`fn-token-probe --vergleich: Pfad nicht erlaubt (${p.grund}): ${pfad}`)
      if (e.abbruch || e.aufrufe.length >= grenze) return null
      const takt = o.ohneTakt ? 0 : (() => { const { taktMin, taktMax } = fnGrenzen(); return taktMin + Math.floor(Math.random() * (taktMax - taktMin + 1)) })()
      const warten = Math.max(pause, takt) - (Date.now() - letzter)
      if (warten > 0) await schlaf(warten)
      const a: Aufruf = { nr: e.aufrufe.length + 1, host, key, pfad, versuch: 1, status: null, dauerMs: null, bytes: null, meldung: null }
      e.aufrufe.push(a)
      const kopf: Record<string, string> = host === 'token'
        ? { accept: 'application/json', 'user-agent': config.LINA_USER_AGENT, authorization: `Bearer ${token}` }
        : sitzung.header()
      const basis = host === 'token' ? TOKEN_BASIS : config.FN_BASE_URL
      const start = Date.now()
      let text = ''
      try {
        const res = await holen(`${basis}${pfad}`, { method: 'GET', headers: kopf, redirect: 'manual', signal: AbortSignal.timeout(zeitgrenze) })
        a.status = res.status
        text = await res.text()
      } catch (x) {
        a.dauerMs = Date.now() - start
        letzter = Date.now()
        a.meldung = sch(`kein Ergebnis: ${kuerzen(String((x as Error)?.name === 'TimeoutError' ? `Zeitgrenze ${zeitgrenze / 1000} s überschritten` : (x as Error)?.message ?? x), 160)}`)
        return { status: null, json: null, meldung: a.meldung, dauerMs: a.dauerMs, bytes: null }
      }
      a.dauerMs = Date.now() - start
      letzter = Date.now()
      a.bytes = new TextEncoder().encode(text).length
      text = sch(text)
      let json: unknown | null = null
      if (text.trim()) { try { json = JSON.parse(text) } catch { json = null } }
      writeFileSync(join(verzeichnis, `${String(a.nr).padStart(2, '0')}_${host}_${key}.${json !== null ? 'json' : 'txt'}`), text)
      if (a.status! < 200 || a.status! >= 300) a.meldung = sch(fehlermeldung(text))
      if (a.status === 429 || a.status === 401) {
        e.abbruch = `HTTP ${a.status} bei ${key} (${host}) — Abbruch der Marke, nichts wiederholt`
        e.befunde.push(e.abbruch)
      }
      return { status: a.status, json, meldung: a.meldung, dauerMs: a.dauerMs, bytes: a.bytes }
    }

    // Kostenstelle live gegenprüfen (Name, keine „test").
    if (sitzung.benutzerId !== null) {
      const r = await get('token', 'erps', `/api/erp/core/${sitzung.benutzerId}/erps`, ZEITGRENZE_MS)
      const ks = r?.status === 200 && r.json !== null ? kostenstellen(r.json).find(k => k.erpId === ziel.erpId) ?? null : null
      if (ks) {
        e.kostenstelleLive = [ks.restaurantName, ks.name].filter(Boolean).join(' — ') || '(ohne Namen)'
        e.kostenstelleTest = istTestName(ks.name, ks.restaurantName)
      } else e.befunde.push(`Kostenstelle ${ziel.erpId} nicht in der Token-Antwort /api/erp/core/{userId}/erps`)
    } else e.befunde.push('keine Benutzer-ID — Kostenstellenname nicht gegengeprüft')
    if (e.kostenstelleTest) {
      e.befunde.push(`Kostenstelle ${ziel.erpId} trägt „test" im Namen — Vergleich abgebrochen`)
      e.abbruch = 'Testkostenstelle'
    }

    for (const p of vergleichsPaare(ziel)) {
      const leer = { status: null, dauerMs: null, bytes: null, zeilen: null, meldung: null }
      const s = await get('sitzung', p.key, p.sitzung, p.zeitgrenze)
      const t = await get('token', p.key, p.token, p.zeitgrenze)
      const seite = (a: Antwort | null) => a ? { status: a.status, dauerMs: a.dauerMs, bytes: a.bytes, zeilen: zeilenZahl(p.key, a.json), meldung: a.meldung } : leer
      const erg: PaarErgebnis = { key: p.key, register: p.register, sitzungPfad: p.sitzung, tokenPfad: p.token,
        urteil: 'nicht gemessen', grund: null, sitzung: seite(s), token: seite(t), abweichungen: [], mengen: [] }
      const ok = (a: Antwort | null) => a !== null && a.status === 200 && a.json !== null && !auspacken(a.json).fehler
      if (!s || !t) erg.grund = e.abbruch ? `Abbruch: ${e.abbruch}` : `Aufrufgrenze ${grenze} erreicht`
      else if (!ok(s)) erg.grund = `Sitzung ohne verwertbare Antwort (${s.status ?? '—'}${s.meldung ? `, ${kuerzen(s.meldung, 80)}` : ''})`
      else if (!ok(t)) erg.grund = `Token ohne verwertbare Antwort (${t.status ?? '—'}${t.meldung ? `, ${kuerzen(t.meldung, 80)}` : ''})`
      else {
        const v = antwortenVergleichen(s.json, t.json)
        erg.urteil = v.urteil
        erg.abweichungen = v.abweichungen
        erg.mengen = v.mengen
      }
      e.paare.push(erg)
    }
    if (e.aufrufe.length > grenze) throw new Error(`fn-token-probe --vergleich: Aufrufgrenze überschritten (${e.aufrufe.length} > ${grenze}) — Programmfehler`)
    aus(`[${marke}] ${e.aufrufe.length} GET; Anbindung ${ziel.connectionId}; Kostenstelle ${ziel.erpId} ${e.kostenstelleLive ?? '(nicht gegengeprüft)'}; Rezept ${ziel.rezeptId}`)
    for (const p of e.paare) aus(`  ${p.key.padEnd(16)} ${p.urteil.padEnd(26)} ${p.grund ?? (p.abweichungen.length ? `${p.abweichungen.length} Feldpfade` : '')}`.trimEnd())
  }

  const md = vergleichMarkdown(ergebnisse, jetzt)
  const json = JSON.stringify({ gemessen: jetzt.toISOString(), ziele: VERGLEICH_ZIELE, marken: ergebnisse }, null, 1)
  geheimnisPruefen(md, geheim, 'vergleich.md')
  geheimnisPruefen(json, geheim, 'vergleich.json')
  mkdirSync(o.aus, { recursive: true })
  writeFileSync(join(o.aus, 'vergleich.md'), md)
  writeFileSync(join(o.aus, 'vergleich.json'), json)
  const vollstaendig = ergebnisse.every(e => !e.abbruch && e.paare.length > 0 && e.paare.every(p => p.urteil !== 'nicht gemessen'))
  return { ergebnisse, exitCode: vollstaendig ? 0 : 2 }
}

export function vergleichMarkdown(es: VergleichsMarke[], jetzt: Date): string {
  const z: string[] = []
  z.push(`# fn-token-probe --vergleich ${jetzt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, '')
  z.push('Sitzung (`my.foodnotify.com`) gegen Token (`api3.foodnotify.com`), je Abruf ein GET je Zugang, kanonische JSON-Form (Schlüssel sortiert; Listen mit eindeutiger ID als Menge). Nur Feldpfade, Zählungen und IDs.', '')
  const keys = es[0]?.paare.map(p => p.key) ?? []
  z.push(`| Abruf | ${es.map(e => e.marke).join(' | ')} |`, `|---|${es.map(() => '---').join('|')}|`)
  for (const k of keys) z.push(`| ${k} | ${es.map(e => { const p = e.paare.find(x => x.key === k); return p ? esc(p.urteil + (p.grund ? ` (${p.grund})` : '')) : '—' }).join(' | ')} |`)
  for (const e of es) {
    z.push('', `## ${e.marke}`, '')
    z.push(`* Anmeldung ${e.anmeldung}, ${e.aufrufe.length} GET${e.abbruch ? `, **Abbruch:** ${esc(e.abbruch)}` : ''}`)
    if (e.ziel) {
      z.push(`* Anbindung ${e.ziel.connectionId} (${esc(e.ziel.anbindung)}, Name aus der Matrixmessung 18:51 UTC)`)
      z.push(`* Kostenstelle ${e.ziel.erpId}: live ${esc(e.kostenstelleLive ?? 'nicht gegengeprüft')}${e.kostenstelleTest === false ? ', kein „test"' : ''}`)
      z.push(`* Rezept ${e.ziel.rezeptId}`)
    }
    for (const b of e.befunde) z.push(`* Befund: ${esc(b)}`)
    z.push('', '| Abruf | Urteil | Sitzung Status/Dauer/Zeilen | Token Status/Dauer/Zeilen |', '|---|---|---|---|')
    const s = (x: PaarErgebnis['sitzung']) => `${x.status ?? '—'} / ${x.dauerMs !== null ? `${(x.dauerMs / 1000).toFixed(1)} s` : '—'} / ${x.zeilen ?? '—'}`
    for (const p of e.paare) z.push(`| ${p.key} | ${esc(p.urteil)}${p.grund ? ` — ${esc(p.grund)}` : ''} | ${s(p.sitzung)} | ${s(p.token)} |`)
    for (const p of e.paare.filter(x => x.abweichungen.length || x.mengen.length)) {
      z.push('', `**${p.key}** — abweichende Feldpfade:`, '')
      for (const a of p.abweichungen) z.push(`* \`${esc(a.pfad)}\` ${a.art} (${a.anzahl}×)`)
      for (const m of p.mengen) z.push(`* Menge \`${esc(m.pfad)}\` nach \`${m.schluessel}\`: Sitzung ${m.sitzung}, Token ${m.token}; nur Sitzung ${m.nurSitzungAnzahl} (${m.nurSitzung.join(', ')}), nur Token ${m.nurTokenAnzahl} (${m.nurToken.join(', ')})`)
    }
  }
  return z.join('\n') + '\n'
}

/** `fn-token-probe-<UTC-Datum>-<HHMM>`, bei Kollision `-2`, `-3` … */
export function ausgabeVerzeichnis(basis: string, jetzt: Date, existiert: (p: string) => boolean = existsSync): string {
  const iso = jetzt.toISOString()
  const name = `fn-token-probe-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`
  let ziel = join(basis, name)
  for (let n = 2; existiert(ziel); n++) ziel = join(basis, `${name}-${n}`)
  return ziel
}

/** Was --dry-run zeigt: kein Netz, keine Anmeldung, keine Werte. */
export function trockenlauf(marken: readonly string[], grenze: number, tokens: Record<string, string>, zugaenge: readonly string[]): string[] {
  const z: string[] = []
  z.push('Erlaubtliste Sitzung (my.foodnotify.com, nur GET):')
  for (const m of ERLAUBT_SITZUNG) z.push(`  ${m.name.padEnd(18)} ${m.re}`)
  z.push('Erlaubtliste Token (api3.foodnotify.com, nur GET):')
  for (const m of ERLAUBT_TOKEN) z.push(`  ${m.name.padEnd(18)} ${m.re}`)
  z.push('Sperrliste (darf in keinem Pfad vorkommen):')
  for (const s of GESPERRT) z.push(`  ${s}`)
  z.push(`Aufrufplan je Marke (höchstens ${grenze} GET; die Anmeldung ist ein POST und zählt nicht):`)
  z.push('   1×  Sitzung /api/profile (in der Anmeldung)', '   1×  Sitzung /api/pos/locations')
  for (const t of TOKEN_PFADE) z.push(`   1×  Token   ${t.vorlage}`)
  z.push('  (Rückfall Sitzung /api/erp/all nur, wenn das Token keine Kostenstellen liefert; zweiter Versuch nur für Kassenartikel bei Zeitgrenze/Netzfehler — beides nur innerhalb der Grenze)')
  z.push(`  = ${2 + TOKEN_PFADE.length} GET im Regelfall`)
  z.push(`Marken: ${marken.map(m => `${m} (${tokens[m] ? 'Token' : 'KEIN Token'}, ${zugaenge.includes(m) ? 'Sitzung' : 'KEINE Sitzung'})`).join(', ')}`)
  z.push(`Takt: mindestens ${PAUSE_MS} ms (bzw. FN_TAKT_*), Zeitgrenze ${ZEITGRENZE_MS / 1000} s, Kassenartikel ${ZEITGRENZE_KASSENARTIKEL_MS / 1000} s. Nichts wurde aufgerufen.`)
  return z
}

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
  const marke = arg('marke')
  let grenze: number
  try { grenze = grenzePruefen(arg('max-aufrufe') === undefined ? undefined : Number(arg('max-aufrufe'))) } catch (x) { console.error((x as Error).message); process.exit(64) }
  if (marke && !(MARKEN as readonly string[]).includes(marke)) { console.error(`Unbekannte Marke: ${marke} (erlaubt: ${MARKEN.join(', ')})`); process.exit(64) }
  const tokens = config.FN_API_TOKEN
  const ziel = marke ? [marke] : MARKEN.filter(m => tokens[m])

  if (process.argv.includes('--dry-run')) {
    for (const zeile of trockenlauf(marke ? [marke] : [...MARKEN], grenze, tokens, fnZugaenge().map(z => z.schluessel))) console.log(zeile)
    process.exit(0)
  }
  if (ziel.length === 0) { console.error('Kein Token in FN_API_TOKENS — nichts zu messen.'); process.exit(64) }

  const jetzt = new Date()
  const aus = resolve(arg('aus') ?? ausgabeVerzeichnis('belege', jetzt))
  if (!gitIgnoriert(aus)) {
    console.error(`Abbruch vor dem ersten Aufruf: ${aus} ist nicht von git ignoriert. Rohantworten gehören nicht ins Repository — ein Verzeichnis unter belege/ wählen.`)
    process.exit(3)
  }
  if (process.argv.includes('--vergleich')) {
    const { exitCode } = await fnTokenVergleich({ marken: ziel, aus, maxAufrufe: Math.min(grenze, MAX_AUFRUFE_VERGLEICH), jetzt })
    console.log(`Vergleich: ${join(aus, 'vergleich.md')}`)
    process.exit(exitCode)
  }
  const { exitCode } = await fnTokenProbe({ marken: ziel, aus, maxAufrufe: grenze, jetzt })
  console.log(`Zusammenfassung: ${join(aus, 'zusammenfassung.md')}`)
  process.exit(exitCode)
}
