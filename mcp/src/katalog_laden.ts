/**
 * Den Katalog aus der Datenbank holen — beim Start und danach immer dann,
 * wenn sich sein Fingerabdruck aendert (katalog_nachladen.ts).
 */
import { abfragen } from './db'
import { kennzahlenFlachlegen, type Achse, type Fallstrick, type Katalog, type Sicht } from './katalog'
import { regelartenPruefen } from './pruefen'

/** Der Katalog, wie er aus der Datenbank kommt — noch nicht geprueft. */
export type KatalogRoh = { sichten: Sicht[]; achsen: Achse[]; fallstricke: Fallstrick[] }

/** Die drei Abfragen, ohne Pruefung und ohne Aufbau. */
export async function katalogRohLaden(): Promise<KatalogRoh> {
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
  return { sichten, achsen, fallstricke }
}

/**
 * Aus den Rohdaten den Katalog bauen — und vorher pruefen, dass jede
 * Regelart in mcp.fallstrick umgesetzt ist. Wirft sonst: ein Katalog mit
 * halben Wachen kommt nicht in Umlauf, weder beim Start noch beim
 * Nachladen.
 */
export function katalogBauen(roh: KatalogRoh): Katalog {
  regelartenPruefen(roh.fallstricke)
  return {
    sichten: new Map(roh.sichten.map(s => [s.sicht, s])),
    achsen: new Map(roh.achsen.map(a => [a.achse, a])),
    fallstricke: roh.fallstricke,
    kennzahlRegel: kennzahlenFlachlegen(roh.sichten),
  }
}

export async function katalogLaden(): Promise<Katalog> {
  // Bevor irgendetwas laeuft: jede Regelart in den Daten muss umgesetzt sein.
  return katalogBauen(await katalogRohLaden())
}

/** Denselben Katalog aus einer JSON-Datei — fuer Tests ohne Datenbank. */
export function katalogAusJson(roh: KatalogRoh): Katalog {
  return katalogBauen(roh)
}

/**
 * Der Fingerabdruck des Katalogs — eine Zeile statt 200.
 *
 * UEBER GENAU DIE RELATIONEN, DIE katalogRohLaden() LIEST, und dort ueber
 * die ganze Zeile: mcp.sicht_katalog traegt Koernung, Kommentar, Spalten
 * (aus pg_attribute), Achsen, Kennzahlen und Fallstricke je Sicht — eine
 * neue mart-Sicht, eine geaenderte Koernung oder eine neue Spalte aendern
 * ihn also alle. Ein Fingerabdruck ueber etwas anderes als das Geladene
 * (etwa nur mcp.sicht) haette eine Spaltenaenderung ohne Katalogzeile
 * verpasst.
 *
 * Gemessen am 19.10.2026 gegen zwei lokale Klone (199 und 245 Sichten):
 * 30–35 ms kalt, 3–4 ms warm. Der volle Katalog waeren 170–220 kB je Abruf.
 */
export const FINGERABDRUCK_SQL = `
  SELECT md5(concat_ws('|',
           (SELECT json_agg(k ORDER BY k.sicht)::text      FROM mcp.sicht_katalog k),
           (SELECT json_agg(a ORDER BY a.achse)::text      FROM mcp.achse a),
           (SELECT json_agg(f ORDER BY f.schluessel)::text FROM mcp.fallstrick f WHERE f.aktiv)
         )) AS fingerabdruck`

export async function fingerabdruckHolen(): Promise<string> {
  const [z] = await abfragen<{ fingerabdruck: string }>(FINGERABDRUCK_SQL)
  return z!.fingerabdruck
}
