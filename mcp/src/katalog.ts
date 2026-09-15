/**
 * Der semantische Katalog, wie der Server ihn im Speicher haelt.
 *
 * Einmal beim Start gelesen und danach im Speicher: der Katalog aendert sich
 * nur mit einer Migration, und eine Abfrage je Pruefung waere ein Umlauf zur
 * Datenbank fuer etwas, das seit Stunden gleich ist. Ein Neustart nach einer
 * Migration ist ohnehin faellig — Dokploy macht ihn beim Deploy.
 */

export type Regel = 'summe' | 'median' | 'mittel' | 'letzter_stand' | 'nicht_aggregieren'
export type Schwere = 'sperre' | 'warnung'

export type Kennzahl = { spalte: string; regel: Regel; einheit: string | null; hinweis: string | null }

export type Sicht = {
  sicht: string
  koernung: string | null
  thema: string | null
  summen_erlaubt: boolean | null
  kommentar: string | null
  /** Alle Spalten der Sicht — damit eine aggregierte Spalte ihrer Quelle zugeordnet werden kann. */
  spalten: string[]
  achsen: string[]
  kennzahlen: Kennzahl[]
}

export type Fallstrick = {
  schluessel: string
  art: string
  schwere: Schwere
  sicht: string | null
  parameter: Record<string, any>
  hinweis: string
  berichtigung: string | null
  quelle: string | null
}

export type Achse = {
  achse: string
  bezeichnung: string
  art: string
  ziel_sicht: string | null
  ziel_spalte: string | null
  anzeige_spalte: string | null
  hinweis: string | null
}

export type Katalog = {
  sichten: Map<string, Sicht>
  achsen: Map<string, Achse>
  fallstricke: Fallstrick[]
  /** Spalte → strengste Aggregationsregel, ueber alle Sichten hinweg. */
  kennzahlRegel: Map<string, { regel: Regel; sicht: string; hinweis: string | null }>
}

/** Ein leerer Katalog — fuer Tests, die ihre Lage selbst bauen. */
export function leererKatalog(): Katalog {
  return { sichten: new Map(), achsen: new Map(), fallstricke: [], kennzahlRegel: new Map() }
}

/**
 * Die Aggregationsregeln flach nach Spaltenname, damit der Pruefer eine
 * `sum(pek_gesamt)` auch dann erkennt, wenn die Sicht hinter einem Alias oder
 * einer CTE steht.
 *
 * Bei Namensgleichheit ueber mehrere Sichten gewinnt die STRENGERE Regel.
 * Eine Spalte `wert_prozent`, die in einer Sicht summierbar waere und in
 * einer anderen nicht, muss als nicht summierbar behandelt werden — sonst
 * entscheidet der Zufall der Reihenfolge darueber, ob gewarnt wird.
 */
const STRENGE: Record<Regel, number> = {
  summe: 0, letzter_stand: 1, mittel: 2, median: 3, nicht_aggregieren: 4,
}

export function kennzahlenFlachlegen(sichten: Iterable<Sicht>): Katalog['kennzahlRegel'] {
  const flach: Katalog['kennzahlRegel'] = new Map()
  for (const s of sichten) {
    for (const k of s.kennzahlen ?? []) {
      const da = flach.get(k.spalte)
      if (!da || STRENGE[k.regel] > STRENGE[da.regel]) {
        flach.set(k.spalte, { regel: k.regel, sicht: s.sicht, hinweis: k.hinweis })
      }
    }
  }
  return flach
}
