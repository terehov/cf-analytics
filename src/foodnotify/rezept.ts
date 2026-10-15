/**
 * Rezepturen (0132, docs/plan-rezepturen.md) — reine Transformation.
 *
 * Dieselbe Regel wie transform.ts und inventur.ts: keine Datenbank, kein Netz,
 * keine Uhr. Fehlende FELDER werden zu null, nie zu einem Wurf. Eine fehlende
 * oder fremde FORM dagegen wirft (`rezeptStrukturFehler`): ein leeres Ergebnis
 * aus einer unbekannten Hülle sähe aus wie ein Rezept ohne Zutaten.
 *
 * Die Feldnamen stammen aus dem Enchilada-Abzug vom 14./15.09.2026
 * (src/rezepte.ts, 2.111 Rezepte, 7.452 Zutatenzeilen). Die Hülle der Liste
 * ist gemessen ({data, pagination}); die von Kopf, Zutaten und Meta nicht —
 * der Abzug hat sie ausgepackt gespeichert. `auspacken` erkennt die vier
 * bekannten Hüllen. ~~Eine unbekannte fiele über die Leere-200er-Regel in
 * fnLaden auf~~ — FALSCH (Review 15.10.2026): `zeilenZaehlen` zählt ein
 * unbekanntes Objekt als eine Zeile, die Leere-Regel greift dann nicht, und der
 * Lader hätte die Zutaten gelöscht und `zutaten_geholt_am` gestempelt.
 * Deshalb prüft `rezeptStrukturFehler` die gemessene Form, bevor geladen wird.
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
  /** archived — seit der Probe vom 15.10.2026 bekannt; null = Feld fehlt. */
  archiviert: boolean | null
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
    archiviert: typeof o.archived === 'boolean' ? o.archived : null,
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

/**
 * Passt die Antwort auf die gemessene Form? Gibt den Grund zurück, sonst null.
 *
 *   fn:rezepte          ausgepackt eine Liste (gemessen: {data, pagination})
 *   fn:rezept           ausgepackt ein Objekt mit ganzzahliger id
 *   fn:rezept_zutaten   ausgepackt eine Liste — die einzige gemessene Form
 *                       (2.111 von 2.111 Dateien des Einzelabzugs)
 *   fn:rezept_meta      ausgepackt ein Objekt mit einem Objekt `weight`
 *                       (2.111 von 2.111)
 *
 * fnLaden ruft das VOR dem Laden auf: bei einem Befund wird die Rohantwort
 * gesichert, eine Zeile in sync.schema_abweichung geschrieben und der Posten
 * als Fehler gemeldet — core bleibt unberührt.
 */
export function rezeptStrukturFehler(endpunkt: string, antwort: unknown): string | null {
  const { daten, fehler } = auspacken(antwort)
  if (fehler) return `Hüllenfehler: ${fehler}`
  const form = Array.isArray(daten) ? 'Liste' : daten === null ? 'null' : typeof daten
  switch (endpunkt) {
    case 'fn:rezepte':
    case 'fn:rezept_zutaten':
      return Array.isArray(daten) ? null
        : `${endpunkt}: erwartet eine Liste, bekommen ${form}`
          + (alsObjekt(daten) ? ` mit Schlüsseln ${Object.keys(daten as object).slice(0, 8).join(', ')}` : '')
    case 'fn:rezept':
      return alsId(alsObjekt(daten)?.id) !== null ? null
        : `fn:rezept: erwartet ein Objekt mit id, bekommen ${form}`
    case 'fn:rezept_meta':
      return alsObjekt(alsObjekt(daten)?.weight) ? null
        : `fn:rezept_meta: erwartet ein Objekt mit weight, bekommen ${form}`
          + (alsObjekt(daten) ? ` mit Schlüsseln ${Object.keys(daten as object).slice(0, 8).join(', ')}` : '')
    default:
      return null
  }
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
  /** baseQuantity/baseUnit — meist null (Probe 15.10.2026: 2 Stück Oreo → 22 g). */
  basisMenge: number | null
  basisEinheit: string | null
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
  if (!Array.isArray(daten)) throw new Error(rezeptStrukturFehler('fn:rezept_zutaten', antwort)!)
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
      basisMenge: alsZahl(z.baseQuantity),
      basisEinheit: alsText(z.baseUnit),
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
  const w = alsObjekt(alsObjekt(daten)?.weight)
  if (!w) throw new Error(rezeptStrukturFehler('fn:rezept_meta', antwort)!)
  return {
    gewichtGesamt: alsZahl(w.total),
    gewichtPerson: alsZahl(w.perPerson),
    portion: alsZahl(w.portionSize),
    portionEinheit: alsText(w.portionSizeUnit),
    verlustRoh: alsZahl(w.loss),
  }
}
