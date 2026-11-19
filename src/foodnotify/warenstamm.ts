/**
 * Warenstamm mit Listenpreis (0157, `fn:warenstamm`) — die Formprüfung.
 *
 * Anders als bei pos_artikel.ts gibt es hier KEINE Transformation in
 * TypeScript: geladen wird in SQL (`core.warenstamm_laden()`, Migration
 * 0157), damit Nachtlauf und Neuaufbau aus raw dieselbe Funktion sind
 * (Regel 4) — der Verlauf des Listenpreises entsteht erst aus der
 * Reihenfolge der Antworten, und zwei Fassungen dieser Logik liefen
 * auseinander. Hier steht nur, was VOR dem Laden geprüft wird: eine fremde
 * Form lädt nichts, sondern scheitert sichtbar (Rohantwort gesichert,
 * sync.schema_abweichung, Posten nicht erledigt). Ohne diese Prüfung sähe ein
 * umbenanntes `unitPrice` aus wie „alle Preise entfallen", und eine fremde
 * Hülle wie „das ganze Sortiment ist gestrichen".
 *
 * Die Form ist GEMESSEN (19.11.2026, Wilma Wunder). Massgeblich ist die echte
 * Kostenstelle 7984 (Bar Ballplatz Mainz, belege/fn-probe-2026-11-19-0729/);
 * ~~erpId 11035 und 12066~~ sind „AAA Testrestaurant Wilma Wunder" ohne
 * angebundenen Lieferantenkatalog (belege/fn-probe-2026-11-19-0612/,
 * belege/fn-probe-2026-11-18/) — alle nicht in Git:
 *
 *   {errors, code, isError, payload: {order_by, order_direction, current_page,
 *    current_page_size, page_count, total_count, currency, data[]}}
 *
 * Je Produkt u. a. `id` (Zahl, je Antwort eindeutig), `name`, `unitPrice`
 * (Zahl, Preis JE EINHEIT), `unit {id, name}`, `unitQuantity`,
 * `packagingQuantity`, `artikelId` (Text), `shop {id, name}` (bei
 * Eigenproduktion null, dann `recipeProduct.recipe`), `stock {sumAmount,
 * sumPrice, …}`, `isOrderable`, `isAvailable`, `showInStocktaking`,
 * `timeModified {date, timezone_type, timezone}`. Bei Waren mit
 * Lieferantenkatalog (7984: die 110 mit `isOrderable`) dazu `productForShow`,
 * `pricePerUnit {quantity, unit, price}` (109), `packagingUnit {name, label,
 * quantity, price {amount, currency}}` und `packagingUnits[]`; sonst null.
 * ~~`pricePerUnit`, `packagingUnit`, `packagingUnits` sind IMMER null~~ — das
 * galt im Testrestaurant. `baseUnitQuantity`, `baseUnitUnit` sind in beiden
 * gemessenen Kostenstellen immer null.
 *
 * Die Prüfung in SQL (`core.warenstamm_laden`) wiederholt die Untergrenze
 * davon für den Neuaufbau und prüft zusätzlich, was nur mit Bestand geht:
 * Zeilenzahl gegen total_count/current_page_size (nie still abschneiden) und
 * „0 Produkte, obwohl gestern welche da waren".
 */
import { z } from 'zod'
import { auspacken } from './huelle'

/**
 * Pflicht sind die Felder, deren stilles Fehlen eine falsche Zahl erzeugt:
 * die Identität (id), der Name, der Preis (unitPrice als SCHLÜSSEL Pflicht,
 * der Wert darf null sein). Die übrigen dürfen fehlen oder null sein — dann
 * bleibt die Spalte leer; ein neues Feld stört nicht (passthrough), es bleibt
 * in raw.
 *
 * Die Katalogfelder dürfen fehlen, aber wenn sie da sind, nur in der
 * gemessenen Form: ein `pricePerUnit`, das plötzlich eine Zahl wäre, läse der
 * Lader sonst still als „kein Katalogpreis".
 */
const Objekt = z.object({}).passthrough()
const Geld = Objekt.extend({ amount: z.number().nullable().optional() })
const Gebinde = Objekt.extend({
  quantity: z.number().nullable().optional(),
  price: Geld.nullable().optional(),
})
const Produkt = z.object({
  id: z.number().int().nonnegative(),
  name: z.string(),
  unitPrice: z.number().nullable(),
  unit: Objekt.extend({ name: z.string().nullable().optional() }).nullable().optional(),
  unitQuantity: z.number().nullable().optional(),
  packagingQuantity: z.number().nullable().optional(),
  artikelId: z.union([z.string(), z.number()]).nullable().optional(),
  shop: Objekt.extend({ id: z.union([z.number(), z.string()]) }).nullable().optional(),
  stock: Objekt.nullable().optional(),
  pricePerUnit: Objekt.extend({ price: z.number().nullable() }).nullable().optional(),
  packagingUnit: Gebinde.nullable().optional(),
  packagingUnits: z.array(Gebinde).nullable().optional(),
}).passthrough()

const Seite = z.object({
  current_page: z.number().int().min(1),
  current_page_size: z.number().int().min(1),
  page_count: z.number().int().min(0),
  total_count: z.number().int().min(0),
  data: z.array(Produkt),
}).passthrough()

/** Die innere Seite: payload der erp-Hülle, sonst die Antwort selbst. */
function innere(antwort: unknown): unknown {
  if (antwort && typeof antwort === 'object' && !Array.isArray(antwort)
      && 'payload' in antwort && ('isError' in antwort || 'errors' in antwort || 'code' in antwort)) {
    return (antwort as Record<string, unknown>).payload
  }
  return antwort
}

/**
 * Passt die Antwort auf die gemessene Form? Gibt den Grund zurück, sonst null.
 *
 * Geprüft wird auch, dass `id` je Antwort eindeutig ist: der Lader schreibt
 * alle Produkte in EINEM Upsert, und ein doppelter Schlüssel liesse ihn mit
 * „ON CONFLICT … cannot affect row a second time" scheitern.
 */
export function warenstammStrukturFehler(antwort: unknown): string | null {
  const { fehler } = auspacken(antwort)
  if (fehler) return `Hüllenfehler: ${fehler}`
  const daten = innere(antwort)
  const r = Seite.safeParse(daten)
  if (!r.success) {
    const form = Array.isArray(daten) ? 'Liste' : daten === null ? 'null' : typeof daten
    const schluessel = daten && typeof daten === 'object' && !Array.isArray(daten)
      ? ` mit Schlüsseln ${Object.keys(daten).slice(0, 8).join(', ')}` : ''
    const probleme = r.error.issues.slice(0, 3)
      .map(i => `${i.path.slice(0, 3).join('.') || '(Wurzel)'}: ${i.message}`).join('; ')
    return `fn:warenstamm: Antwort passt nicht auf die gemessene Form (${form}${schluessel}) — ${probleme}`
  }
  const ids = new Set<number>()
  for (const p of r.data.data) {
    if (ids.has(p.id)) return `fn:warenstamm: Produkt-id ${p.id} steht zweimal in derselben Antwort`
    ids.add(p.id)
  }
  return null
}
