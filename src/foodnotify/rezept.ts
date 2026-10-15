/**
 * Rezepturen (0132, docs/plan-rezepturen.md) — reine Transformation.
 *
 * Dieselbe Regel wie transform.ts und inventur.ts: keine Datenbank, kein Netz,
 * keine Uhr. Fehlende Felder werden zu null, nie zu einem Wurf — mit EINER
 * Ausnahme: eine zweite Seite bei den Zutaten wirft (unten, `rezeptZutaten`).
 *
 * Die Feldnamen stammen aus dem Enchilada-Abzug vom 14./15.09.2026
 * (src/rezepte.ts, 2.111 Rezepte, 7.452 Zutatenzeilen). Die Hülle der Liste
 * ist gemessen ({data, pagination}); die von Kopf, Zutaten und Meta nicht —
 * der Abzug hat sie ausgepackt gespeichert. `auspacken` erkennt jede der vier
 * bekannten Formen, und eine unbekannte fiele über die Leere-200er-Regel in
 * fnLaden auf.
 *
 * Die kleinen Helfer sind aus inventur.ts dupliziert, aus demselben Grund, der
 * dort steht: sie sind in transform.ts nicht exportiert.
 */
import { auspacken, type Seiten } from './huelle'

const alsObjekt = (x: unknown): Record<string, any> | null =>
  typeof x === 'object' && x !== null && !Array.isArray(x) ? x as Record<string, any> : null

const alsListe = (x: unknown): any[] => (Array.isArray(x) ? x : [])

const alsZahl = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

/** Eine Rezept-ID: nur ganze Zahlen. Alles andere ist kein Rezept, sondern ein Fehler im Bestand. */
const alsId = (x: unknown): number | null => {
  const n = alsZahl(x)
  return n !== null && Number.isInteger(n) ? n : null
}

const alsText = (x: unknown): string | null =>
  x === null || x === undefined ? null : String(x)

/** Leere Zeichenkette ist keine Artikelnummer. */
const alsNummer = (x: unknown): string | null => {
  const t = alsText(x)?.trim()
  return t ? t : null
}

/** Ein Objekt {name: "…"} wird zur Zeichenkette, kein [object Object]. */
const alsBezeichnung = (x: unknown): string | null => {
  const o = alsObjekt(x)
  return o ? alsText(o.name) : alsText(x)
}

const alsZeit = (x: unknown): string | null => {
  if (x === null || x === undefined || x === '') return null
  const d = new Date(String(x))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export type RezeptKopf = {
  fnId: number
  name: string
  erstelltAm: string | null
  /** groups[].name, ohne Doppelte (983835 fuehrt "20. Basisartikel Bar" zweimal). */
  gruppen: string[]
}

function kopfAusObjekt(o: Record<string, any> | null): RezeptKopf | null {
  if (!o) return null
  const fnId = alsId(o.id)
  if (fnId === null) return null
  const gruppen = [...new Set(alsListe(o.groups).map(alsBezeichnung).filter((g): g is string => !!g))]
  return {
    fnId,
    name: alsText(o.name) ?? '',
    erstelltAm: alsZeit(o.createdAt),
    gruppen,
  }
}

/** Eine Seite von /api/recipes?page=N. */
export function rezeptliste(antwort: unknown): { rezepte: RezeptKopf[]; seiten: Seiten } {
  const { daten, seiten } = auspacken(antwort)
  const rezepte = alsListe(daten).map(e => kopfAusObjekt(alsObjekt(e))).filter((r): r is RezeptKopf => !!r)
  return { rezepte, seiten: seiten ?? { aktuelleSeite: 1, gesamtSeiten: 1, gesamt: null } }
}

/** /api/recipes/{id} — dieselbe Form wie ein Listeneintrag. */
export function rezeptKopf(antwort: unknown): RezeptKopf | null {
  const { daten } = auspacken(antwort)
  return kopfAusObjekt(alsObjekt(daten))
}

export type Zutat = {
  fnId: number | null
  /** 1-basiert, in der Reihenfolge der Antwort — FoodNotify liefert keine eigene Position. */
  position: number
  art: string
  name: string
  /** artikelId: die LIEFERANTEN-Artikelnummer. */
  artikelnummer: string | null
  lieferantFnId: number | null
  lieferantName: string | null
  subRezeptFnId: number | null
  menge: number | null
  einheit: string | null
  kosten: number | null
  gruppe: string | null
}

/**
 * /api/recipes/{id}/ingredients.
 *
 * EINE ZWEITE SEITE WIRFT. Gemessen sind höchstens 13 Zutaten je Rezept bei
 * 25 je Seite — eine Seite reicht. Käme doch einmal eine zweite, schnitte ein
 * stiller Durchlauf das Rezept ab, und es sähe aus wie ein kurzes Rezept
 * (dieselbe Form wie die 800er-Inventuren vom 13.08.2026). Ein Wurf landet
 * dagegen in sync.warteschlange.letzter_fehler und in mart.posten_aufgegeben.
 */
export function rezeptZutaten(antwort: unknown): Zutat[] {
  const { daten, seiten } = auspacken(antwort)
  if (seiten && seiten.gesamtSeiten > 1) {
    throw new Error(`Zutaten über ${seiten.gesamtSeiten} Seiten — der Lader holt nur eine. `
      + 'Paging für /ingredients nachrüsten, bevor dieses Rezept geladen wird.')
  }
  return alsListe(daten).map((roh, i): Zutat => {
    const z = alsObjekt(roh) ?? {}
    const lieferant = alsObjekt(z.supplier)
    return {
      fnId: alsId(z.id),
      position: i + 1,
      // Kein Rückfall: ein unbekannter kind-Wert soll am CHECK scheitern.
      art: alsText(z.kind) ?? '',
      name: alsText(z.name) ?? '',
      artikelnummer: alsNummer(z.artikelId),
      lieferantFnId: alsId(lieferant?.id),
      lieferantName: alsText(lieferant?.name),
      subRezeptFnId: alsId(z.subRecipeId),
      menge: alsZahl(z.quantity),
      einheit: alsText(z.unit),
      kosten: alsZahl(z.cost),
      gruppe: alsBezeichnung(z.group),
    }
  })
}

export type RezeptMeta = {
  gewichtGesamt: number | null
  gewichtPerson: number | null
  portion: number | null
  portionEinheit: string | null
  verlustRoh: number | null
}

/** /api/recipes/{id}/meta — nur das Gewicht; Allergene und Nährwerte bleiben in raw. */
export function rezeptMeta(antwort: unknown): RezeptMeta {
  const { daten } = auspacken(antwort)
  const w = alsObjekt(alsObjekt(daten)?.weight) ?? {}
  return {
    gewichtGesamt: alsZahl(w.total),
    gewichtPerson: alsZahl(w.perPerson),
    portion: alsZahl(w.portionSize),
    portionEinheit: alsText(w.portionSizeUnit),
    verlustRoh: alsZahl(w.loss),
  }
}
