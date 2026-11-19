/**
 * Kassenartikel → Rezept (0155, `fn:pos_artikel`) — reine Transformation.
 *
 * Dieselbe Regel wie rezept.ts: keine Datenbank, kein Netz, keine Uhr. Die
 * FORM wird vor dem Laden geprüft (`posArtikelStrukturFehler`) und wirft dann
 * nicht, sondern nennt den Grund: fnLaden sichert die Rohantwort, schreibt
 * sync.schema_abweichung und lässt den Posten scheitern — core bleibt
 * unberührt. Ohne diese Prüfung sähe eine umbenannte `recipeId` aus wie
 * „kein Artikel hat ein Rezept", und eine fremde Hülle wie „alle Artikel
 * fehlen seit heute".
 *
 * Die Form ist GEMESSEN (19.11.2026, Wilma Wunder, Anbindungen 2051, 2052,
 * 2055; Rohantworten in belege/fn-probe-2026-11-18/, nicht in Git):
 *
 *   {location, restaurantId, canCreateRecipes, ingestIssues[], items[]}
 *
 * Keine Hülle, keine Seiten. Je Artikel `remoteProductId` (Zahl), `name`,
 * `plu` (Zeichenkette), `externalId` (Zeichenkette), `recipeId` (Zahl oder
 * null), `recipeTitle`, `isSyncing`, `isIgnored`, `price` (Zeichenkette wie
 * "4.4"), `vat` (0, 7, 19), `absentFromFeedSince` (ISO-Zeit oder null),
 * `hasDuplicateName`, `hasLinkNameMismatch`. In allen drei Antworten
 * (2.864 Artikel) waren remoteProductId, plu und externalId je Anbindung
 * eindeutig, jede plu rein numerisch (4 bis 8 Ziffern).
 *
 * Die anderen drei Marken sind NICHT gemessen — deshalb der Schalter
 * POS_ARTIKEL_MARKEN (src/config.ts).
 */
import { z } from 'zod'
import { auspacken } from './huelle'

/**
 * Pflicht sind die Felder, deren stilles Fehlen eine falsche Zahl erzeugt:
 * die Identität (remoteProductId), die Brücke (plu), die Zuordnung
 * (recipeId — als SCHLÜSSEL Pflicht, der Wert darf null sein) und der Name.
 * Fehlt eines der Kennzeichen, wird es null bzw. false; ein neues Feld stört
 * nicht (passthrough), es bleibt in raw.
 */
const Artikel = z.object({
  remoteProductId: z.number().int(),
  name: z.string(),
  plu: z.string().nullable(),
  recipeId: z.number().int().nullable(),
  externalId: z.union([z.string(), z.number()]).nullable().optional(),
  recipeTitle: z.string().nullable().optional(),
  isSyncing: z.boolean().nullable().optional(),
  isIgnored: z.boolean().nullable().optional(),
  price: z.union([z.string(), z.number()]).nullable().optional(),
  vat: z.number().nullable().optional(),
  absentFromFeedSince: z.string().nullable().optional(),
  hasDuplicateName: z.boolean().nullable().optional(),
  hasLinkNameMismatch: z.boolean().nullable().optional(),
}).passthrough()

const Antwort = z.object({
  items: z.array(Artikel),
  location: z.string().nullable().optional(),
  restaurantId: z.number().int().nullable().optional(),
  canCreateRecipes: z.boolean().nullable().optional(),
  ingestIssues: z.array(z.unknown()).nullable().optional(),
}).passthrough()

export type PosArtikel = {
  remoteId: number
  plu: string | null
  externeId: string | null
  name: string
  rezeptFnId: number | null
  rezeptTitel: string | null
  preis: number | null
  mwst: number | null
  istIgnoriert: boolean
  wirdSynchronisiert: boolean | null
  abwesendSeit: string | null
  nameDoppelt: boolean | null
  nameWeichtAb: boolean | null
}

export type PosArtikelAntwort = {
  standort: string | null
  restaurantId: number | null
  kannRezepteAnlegen: boolean | null
  /** Anzahl der Einträge in ingestIssues (negativer Preis u. a.) — der Inhalt bleibt in raw. */
  ingestHinweise: number
  artikel: PosArtikel[]
}

const zahl = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

const zeit = (x: unknown): string | null => {
  if (x === null || x === undefined || x === '') return null
  const d = new Date(String(x))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Leere Zeichenkette ist keine PLU. */
const text = (x: unknown): string | null => {
  if (x === null || x === undefined) return null
  const t = String(x).trim()
  return t ? t : null
}

/**
 * Passt die Antwort auf die gemessene Form? Gibt den Grund zurück, sonst null.
 *
 * Geprüft wird auch, dass `remoteProductId` je Antwort eindeutig ist: der
 * Lader schreibt alle Artikel in EINEM Upsert, und ein doppelter Schlüssel
 * liesse ihn mit „ON CONFLICT … cannot affect row a second time" scheitern —
 * besser ein lesbarer Befund in sync.schema_abweichung.
 */
export function posArtikelStrukturFehler(antwort: unknown): string | null {
  const { daten, fehler } = auspacken(antwort)
  if (fehler) return `Hüllenfehler: ${fehler}`
  const r = Antwort.safeParse(daten)
  if (!r.success) {
    const form = Array.isArray(daten) ? 'Liste' : daten === null ? 'null' : typeof daten
    const schluessel = daten && typeof daten === 'object' && !Array.isArray(daten)
      ? ` mit Schlüsseln ${Object.keys(daten).slice(0, 8).join(', ')}` : ''
    const probleme = r.error.issues.slice(0, 3)
      .map(i => `${i.path.slice(0, 3).join('.') || '(Wurzel)'}: ${i.message}`).join('; ')
    return `fn:pos_artikel: Antwort passt nicht auf die gemessene Form (${form}${schluessel}) — ${probleme}`
  }
  const ids = new Set<number>()
  for (const a of r.data.items) {
    if (ids.has(a.remoteProductId)) {
      return `fn:pos_artikel: remoteProductId ${a.remoteProductId} steht zweimal in derselben Antwort`
    }
    ids.add(a.remoteProductId)
  }
  return null
}

/** Die Antwort in Zeilen für core.pos_artikel. Wirft, wenn die Form nicht stimmt. */
export function posArtikel(antwort: unknown): PosArtikelAntwort {
  const grund = posArtikelStrukturFehler(antwort)
  if (grund) throw new Error(grund)
  const d = Antwort.parse(auspacken(antwort).daten)
  return {
    standort: d.location ?? null,
    restaurantId: d.restaurantId ?? null,
    kannRezepteAnlegen: d.canCreateRecipes ?? null,
    ingestHinweise: d.ingestIssues?.length ?? 0,
    artikel: d.items.map(a => ({
      remoteId: a.remoteProductId,
      plu: text(a.plu),
      externeId: text(a.externalId),
      name: a.name,
      rezeptFnId: a.recipeId,
      rezeptTitel: a.recipeTitle ?? null,
      preis: zahl(a.price),
      mwst: zahl(a.vat),
      istIgnoriert: a.isIgnored === true,
      wirdSynchronisiert: a.isSyncing ?? null,
      abwesendSeit: zeit(a.absentFromFeedSince),
      nameDoppelt: a.hasDuplicateName ?? null,
      nameWeichtAb: a.hasLinkNameMismatch ?? null,
    })),
  }
}
