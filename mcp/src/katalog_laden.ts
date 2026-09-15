/**
 * Den Katalog aus der Datenbank holen — einmal beim Start.
 */
import { abfragen } from './db'
import { kennzahlenFlachlegen, type Achse, type Fallstrick, type Katalog, type Sicht } from './katalog'
import { regelartenPruefen } from './pruefen'

export async function katalogLaden(): Promise<Katalog> {
  const [sichten, achsen, fallstricke] = await Promise.all([
    abfragen<Sicht>(`SELECT sicht, koernung, thema, summen_erlaubt, kommentar, spalten, achsen,
                            kennzahlen, fallstricke
                       FROM mcp.sicht_katalog ORDER BY sicht`),
    abfragen<Achse>(`SELECT achse, bezeichnung, art, ziel_sicht, ziel_spalte, anzeige_spalte, hinweis
                       FROM mcp.achse ORDER BY achse`),
    abfragen<Fallstrick>(`SELECT schluessel, art, schwere, sicht, parameter, hinweis,
                                 berichtigung, quelle
                            FROM mcp.fallstrick WHERE aktiv ORDER BY schluessel`),
  ])

  // Bevor irgendetwas laeuft: jede Regelart in den Daten muss umgesetzt sein.
  regelartenPruefen(fallstricke)

  return {
    sichten: new Map(sichten.map(s => [s.sicht, s])),
    achsen: new Map(achsen.map(a => [a.achse, a])),
    fallstricke,
    kennzahlRegel: kennzahlenFlachlegen(sichten),
  }
}

/** Denselben Katalog aus einer JSON-Datei — fuer Tests ohne Datenbank. */
export function katalogAusJson(roh: {
  sichten: Sicht[]; achsen: Achse[]; fallstricke: Fallstrick[]
}): Katalog {
  regelartenPruefen(roh.fallstricke)
  return {
    sichten: new Map(roh.sichten.map(s => [s.sicht, s])),
    achsen: new Map(roh.achsen.map(a => [a.achse, a])),
    fallstricke: roh.fallstricke,
    kennzahlRegel: kennzahlenFlachlegen(roh.sichten),
  }
}
