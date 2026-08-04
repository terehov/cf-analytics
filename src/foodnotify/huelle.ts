/**
 * FoodNotifys Antworthüllen — und wie man sie sicher auspackt.
 *
 * Dieselben Endpunkte liefern je Marke und Endpunkt VIER verschiedene
 * Formen (gemessen, siehe docs/foodnotify-api-inventar.md §1 und §8b):
 *
 *     {errors, payload: …, code, isError}                    /api/erp/*
 *     {data: …, pagination: {currentPage, totalPages, …}}    /api/recipes
 *     {order_by, …, current_page, page_count, data: …}       /api/{erpId}/*
 *     nacktes Array ohne Hülle                                cost-analysis
 *
 * Und sie schachteln: `payload` kann wiederum `{data: …}` enthalten. Genau
 * daran ist die Erhebung am 27.07.2026 einmal gescheitert — das erste
 * Auspacken griff bei Wilma Wunder die falsche Ebene und meldete null
 * Inventuren statt 275. **Der Fehler war lautlos**: kein Statuscode, keine
 * Ausnahme, nur ein leeres Ergebnis, das aussah wie „keine Daten".
 *
 * Deshalb zwei Regeln:
 *
 *   1. `payload` und `data` werden REKURSIV aufgelöst — aber nur, wo die
 *      Hülle als Hülle erkennbar ist. Ein fachliches Objekt, das zufällig
 *      ein Feld `data` trägt, wird nicht zerlegt (siehe `istNurDataHuelle`).
 *   2. Ein leeres Ergebnis ist kein Normalzustand, sondern verdächtig —
 *      `istLeer()` stellt das fest, und der Aufrufer (Worker, Stufe 1.4)
 *      meldet es nach `sync.schema_abweichung`, sobald dieselbe Kombination
 *      schon einmal Daten geliefert hat. Anders als bei LINA, wo HTTP 500
 *      mit leerem Body ein Normalzustand ist.
 */

export type Seiten = {
  /** 1-basiert, wie FoodNotify sie liefert. */
  aktuelleSeite: number
  gesamtSeiten: number
  /** Zeilen insgesamt über alle Seiten, falls die Hülle es sagt. */
  gesamt: number | null
}

export type Ausgepackt = {
  /** Der fachliche Inhalt, von allen Hüllen befreit. */
  daten: unknown
  /** Aus `pagination` bzw. den flachen Zählfeldern, sonst null. */
  seiten: Seiten | null
  /**
   * Aus `isError`/`errors` der payload-Hülle. Ein gesetzter Fehler heißt:
   * `daten` ist nicht zu trauen, auch wenn HTTP 200 kam.
   */
  fehler: string | null
}

const istObjekt = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

/**
 * Die erp-Hülle: `payload` plus mindestens ein Verwaltungsfeld. Nur `payload`
 * allein reicht bewusst nicht — ein fachliches Objekt könnte so heißen.
 */
const istPayloadHuelle = (x: Record<string, unknown>): boolean =>
  'payload' in x && ('isError' in x || 'errors' in x || 'code' in x)

/** Die recipes-Hülle: `data` neben `pagination`. */
const istPaginationHuelle = (x: Record<string, unknown>): boolean =>
  'data' in x && istObjekt(x.pagination)

/** Die flache erpId-Hülle: `data` neben Seitenzählern auf derselben Ebene. */
const istFlacheHuelle = (x: Record<string, unknown>): boolean =>
  'data' in x && ('total_count' in x || 'page_count' in x || 'current_page' in x)

/**
 * Die Minimalhülle `{data: …}` — nur als Hülle gewertet, wenn `data` der
 * EINZIGE Schlüssel ist. Sobald daneben fachliche Felder stehen, ist es kein
 * Umschlag mehr, sondern Inhalt.
 */
const istNurDataHuelle = (x: Record<string, unknown>): boolean =>
  'data' in x && Object.keys(x).length === 1

const zahl = (x: unknown): number | null => {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

/**
 * Packt eine FoodNotify-Antwort vollständig aus.
 *
 * Die Tiefenbegrenzung ist ein Wächter, keine erwartete Größe: gemessen sind
 * höchstens zwei Ebenen (payload → data). Acht heißt „hier stimmt etwas
 * Grundsätzliches nicht", und dann ist Stehenbleiben ehrlicher als Raten.
 */
export function auspacken(antwort: unknown): Ausgepackt {
  let daten = antwort
  let seiten: Seiten | null = null
  let fehler: string | null = null

  for (let tiefe = 0; tiefe < 8; tiefe++) {
    if (!istObjekt(daten)) break

    if (istPayloadHuelle(daten)) {
      const fehlerliste = Array.isArray(daten.errors) ? daten.errors : []
      if (daten.isError === true || fehlerliste.length > 0) {
        // Der Fehlertext der Hülle, nicht ein eigener: die Antwort soll
        // nachvollziehbar bleiben, wenn sie in sync.schema_abweichung landet.
        fehler = fehlerliste.length > 0
          ? fehlerliste.map(e => (typeof e === 'string' ? e : JSON.stringify(e))).join('; ')
          : `isError=true (code ${String(daten.code ?? '?')})`
      }
      daten = daten.payload
      continue
    }

    if (istPaginationHuelle(daten)) {
      const p = daten.pagination as Record<string, unknown>
      seiten = {
        aktuelleSeite: zahl(p.currentPage) ?? 1,
        gesamtSeiten: zahl(p.totalPages) ?? 1,
        gesamt: zahl(p.totalItems),
      }
      daten = daten.data
      continue
    }

    if (istFlacheHuelle(daten)) {
      seiten = {
        aktuelleSeite: zahl(daten.current_page) ?? 1,
        gesamtSeiten: zahl(daten.page_count) ?? 1,
        gesamt: zahl(daten.total_count),
      }
      daten = daten.data
      continue
    }

    if (istNurDataHuelle(daten)) {
      daten = daten.data
      continue
    }

    break
  }

  return { daten, seiten, fehler }
}

/**
 * Ist das ausgepackte Ergebnis leer?
 *
 * Für den Aufrufer ist das die Vorstufe zu „verdächtig": eine 200er-Antwort
 * mit leerem Inhalt gehört nach `sync.schema_abweichung`, sobald dieselbe
 * Kombination schon einmal Daten geliefert hat — still als „keine Daten"
 * quittiert wäre sie genau der lautlose Fehler von Wilma Wunder.
 */
export function istLeer(daten: unknown): boolean {
  if (daten === null || daten === undefined) return true
  if (Array.isArray(daten)) return daten.length === 0
  if (istObjekt(daten)) return Object.keys(daten).length === 0
  return false
}
