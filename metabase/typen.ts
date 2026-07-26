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

/**
 * Eine fertig ausgelegte Kachel. Wird von layout.ts GERECHNET, nicht von
 * Hand geschrieben — von Hand gepflegte y-Werte halten nur bis zur ersten
 * Hoehenaenderung weiter oben.
 */
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

/** Ein Element innerhalb einer Reihe. Entweder Karte oder Text. */
export type Teil = {
  karte?: string
  text?: string
  /** Rastereinheiten. Fehlt sie, teilt sich der Platz gleichmaessig auf. */
  breite?: number
  /** Nur setzen, wenn mehr als das Mindestmass noetig ist. */
  hoehe?: number
  klick?: Klick[]
}

/**
 * Eine waagerechte Gruppe. Alle Teile stehen nebeneinander, die naechste
 * Reihe faengt genau darunter an. Das ist das einzige, was in
 * dashboards.ts von Hand gepflegt wird.
 */
export type Reihe = {
  teile: Teil[]
  /** Untergrenze fuer die ganze Reihe; sonst gilt das Maximum der Teile. */
  hoehe?: number
}

export type Dashboard = {
  schluessel: string
  name: string
  beschreibung: string
  sammlung: string
  /** Waagerechte Gruppen von oben nach unten. layout.ts rechnet daraus x/y. */
  reihen: Reihe[]
  /** Dashboard-weite Filter. Werden auf alle Karten verdrahtet, die einen
   *  gleichnamigen Parameter haben. */
  filter?: Parameter[]
}
