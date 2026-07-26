// Typen fuer die Dashboard-Provisionierung.
//
// Absichtlich duenn: das hier beschreibt, was WIR angeben, nicht was
// Metabase am Ende speichert. Die Uebersetzung in Metabases eigene
// Struktur (dataset_query, template-tags, dashcards) macht provisionieren.ts.

export type Anzeige =
  | 'table' | 'scalar' | 'bar' | 'row' | 'line' | 'combo' | 'pie' | 'area'

export type Parameter = {
  id: string
  name: string
  'display-name': string
  type: string
  required?: boolean
  default?: unknown
  dimension?: unknown
}

export type Karte = {
  /** Stabiler Schluessel. Wird in der Beschreibung hinterlegt, damit ein
   *  zweiter Lauf dieselbe Karte wiederfindet statt eine Kopie anzulegen. */
  schluessel: string
  name: string
  beschreibung: string
  anzeige: Anzeige
  sql: string
  parameter?: Parameter[]
  visualisierung?: Record<string, unknown>
  /** Fuer Feldfilter (date/range): auf welches Feld sie zeigen.
   *  [schema, tabelle, spalte] — wird beim Provisionieren aufgeloest. */
  template_tag_dimension?: Record<string, [string, string, string]>
}

/**
 * Was beim Klick passiert.
 *
 * Ohne `spalte` gilt es fuer die ganze Karte (Balken, Kacheln), mit
 * `spalte` nur fuer diese eine Tabellenspalte. Bei Tabellen ist das die
 * bessere Wahl: eine ganze Zeile klickbar zu machen heisst, dass auch ein
 * versehentlicher Klick auf eine Zahl wegnavigiert.
 *
 * `uebergabe` bildet Parameter des ZIELS auf Spalten der QUELLE ab.
 */
export type Klick = {
  /** Schluessel des Ziel-Dashboards. */
  ziel: string
  /** Nur diese Spalte ist klickbar. Fehlt sie, gilt die ganze Karte. */
  spalte?: string
  /** { ziel-parameter-slug: quell-spaltenname } */
  uebergabe: Record<string, string>
}

export type Kachel = {
  karte: string
  x: number
  y: number
  breite: number
  hoehe: number
  /** Ueberschrift statt Karte. */
  text?: string
  /** Ein oder mehrere Klickziele. */
  klick?: Klick[]
}

export type Dashboard = {
  schluessel: string
  name: string
  beschreibung: string
  sammlung: string
  kacheln: Kachel[]
  /** Dashboard-weite Filter. Werden auf alle Karten verdrahtet, die einen
   *  gleichnamigen Parameter haben. */
  filter?: Parameter[]
}
