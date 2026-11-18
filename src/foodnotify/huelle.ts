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

// ---------------------------------------------------------------------------
// Fehlertexte einer Nicht-2xx-Antwort (18.11.2026)
// ---------------------------------------------------------------------------

/**
 * Was der Fehlertext über die ANFRAGE sagt — im Unterschied zum Datensatz.
 *
 *   'validierung'  ein Pflichtparameter fehlt oder ist ungültig
 *   'route'        für den Pfad gibt es keine Route
 *
 * WARUM DAS ZÄHLT: FoodNotifys neue Code-Generation antwortet bei einem
 * fehlenden Pflichtparameter mit HTTP **404** und „Dieser Wert sollte nicht
 * leer sein." — nicht mit 400/422 (docs/foodnotify-interna-aus-fehlermeldungen.md
 * §2 und §4). Der Worker verbucht ein 404 auf einen Rezept-Einzelabruf als
 * 'nicht_gefunden' und setzt am Rezept fehlt_seit. Ändert FoodNotify an einem
 * unserer Pfade einen Pflichtparameter, sähen ohne diese Unterscheidung alle
 * Rezepte aus wie gelöscht — HTTP-Status, Ergebnis und Lauf wären unauffällig
 * (Regel 10).
 */
export type Anfragefehler = 'validierung' | 'route'

/**
 * Die Muster. Die deutschen sind GEMESSEN (18.11.2026, Konto Wilma Wunder,
 * docs/payloads/foodnotify-2026-11/fehlermeldungen-2026-11-18.csv) — mit 404
 * auf erp/catalog/commodity-groups, erp/food-waste, erp/food-waste-alpha/totals,
 * erp/stock-transfer, erp/stock-transfer-request, recipe/ingredient-search/
 * candidates und core/business/{id}/locations/vat-defaults.
 *
 * Die englischen sind NICHT gemessen: es sind Symfonys Standardtexte derselben
 * Prüfungen. Die Sprache folgt dem Konto, nicht dem Accept-Language (interna
 * §1), und drei der vier Marken sind nicht gemessen. Ebenso nicht gemessen ist
 * der Schlüssel `violations` (Symfonys Hülle für eine Liste von Prüffehlern).
 *
 * Abwägung: Ein echtes „gibt es nicht", das hier fälschlich als Validierung
 * gilt, landet als 'aufgegeben' in mart.posten_aufgegeben — sichtbar, und
 * nach drei Wiederbelebungen endgültig. Ein Validierungsfehler, der als „gibt
 * es nicht" durchgeht, markiert still Rezepte als gelöscht. Im Zweifel also
 * lieber ein Muster mehr.
 */
const VALIDIERUNG: RegExp[] = [
  /Dieser Wert sollte/,               // gemessen: „… nicht leer sein.", „… nicht null sein.", „… vom Typ int|string sein." (422)
  /Diese Zeichenkette ist zu kurz/,   // gemessen
  /Diese Sammlung sollte/,            // gemessen
  /This value should/,                // nicht gemessen — Symfony englisch
  /This value is too short/,          // nicht gemessen — Symfony englisch
  /This collection should/,           // nicht gemessen — Symfony englisch
]

/**
 * „No route found for "GET …"" ist GEMESSEN — aber nur mit 405 („… Method Not
 * Allowed (Allow: OPTIONS)"). FoodNotify hat eine OPTIONS-Route für jeden Pfad,
 * ein entfernter Pfad kommt deshalb vermutlich als 405 zurück, und 405 ist
 * ohnehin ein Fehler. Die 404-Fassung desselben Texts ist Symfonys Standard
 * für einen Pfad ohne jede Route; mitgeprüft, damit ein abgeschalteter Pfad
 * (offene-punkte 18.11.2026, Punkt 3) nicht als „Datensatz fehlt" endet.
 */
const ROUTE = /No route found for/

/**
 * Die Felder, aus denen die Meldung gelesen wird — dieselben, aus denen die
 * Messung vom 18.11.2026 sie las (token_messen.py: message, detail, title).
 * Die genaue Hülle des Validierungs-404 ist NICHT erfasst, nur ihr Text und
 * ihre Länge (98 Bytes für „Dieser Wert sollte nicht leer sein."). Deshalb
 * prüft die Erkennung zusätzlich JEDE Zeichenkette der Antwort.
 */
const MELDUNGSFELDER = ['title', 'message', 'detail'] as const

/** Alle Zeichenketten einer JSON-Antwort, rekursiv, mit Tiefengrenze. */
function zeichenketten(x: unknown, tiefe = 0, aus: string[] = []): string[] {
  if (tiefe > 6) return aus
  if (typeof x === 'string') aus.push(x)
  else if (Array.isArray(x)) for (const e of x) zeichenketten(e, tiefe + 1, aus)
  else if (istObjekt(x)) for (const v of Object.values(x)) zeichenketten(v, tiefe + 1, aus)
  return aus
}

/**
 * Liest aus dem Rumpf einer Nicht-2xx-Antwort eine kurze Meldung und, ob sie
 * nach einem Fehler der ANFRAGE aussieht.
 *
 * `meldung` ist höchstens 300 Zeichen lang und geht nach
 * sync.warteschlange.letzter_fehler und sync.aufgabe — dorthin, wo
 * mart.posten_aufgegeben sie zeigt. Vorher stand dort nur „HTTP 404", und der
 * Text, der die Ursache nennt, war verloren.
 */
export function fehlerAusAntwort(text: string): { meldung: string; anfrageFehler: Anfragefehler | null } {
  let json: unknown = undefined
  try { json = JSON.parse(text) } catch { /* kein JSON — dann der Rohtext */ }

  let meldung = ''
  let alles: string
  let mitViolations = false
  if (json !== undefined && json !== null && typeof json === 'object') {
    const teile: string[] = []
    if (istObjekt(json)) {
      for (const f of MELDUNGSFELDER) {
        const v = json[f]
        if (typeof v === 'string' && v.trim() && !teile.includes(v.trim())) teile.push(v.trim())
      }
      for (const f of ['errors', 'violations'] as const) {
        if (Array.isArray(json[f])) {
          const s = zeichenketten(json[f]).map(z => z.trim()).filter(Boolean)
          if (s.length > 0) teile.push(s.join('; '))
        }
      }
      mitViolations = Array.isArray(json.violations) && json.violations.length > 0
    }
    meldung = teile.join(': ')
    alles = zeichenketten(json).join('\n')
  } else {
    // HTML-Fehlerseite (nginx) oder Klartext: Tags weg, Leerraum zusammen.
    meldung = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    alles = text
  }
  meldung = meldung.replace(/\s+/g, ' ').trim().slice(0, 300)

  const anfrageFehler: Anfragefehler | null =
    mitViolations || VALIDIERUNG.some(m => m.test(alles)) ? 'validierung'
    : ROUTE.test(alles) ? 'route'
    : null
  return { meldung, anfrageFehler }
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
