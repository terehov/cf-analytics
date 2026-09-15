/**
 * Die 285 Karten des BI-Tools als Berichte — die eigentliche Abloesung.
 *
 * „BI-Tool" meint die Auswertungsoberflaeche des Unternehmens, heute
 * Metabase. Wo der Produktname unten faellt, geht es um sein konkretes
 * Platzhalterformat — das muss hier genauso behandelt werden wie dort,
 * sonst zeigt derselbe Bericht zwei verschiedene Zahlen.
 *
 * WARUM EIN WERKZEUG UND NICHT 285. Jede Werkzeugbeschreibung kostet ein
 * Modell 300–600 Token, bevor die erste Frage gestellt ist; Cursor kappt bei
 * 40 Werkzeugen, Copilot bei 128, Claude Desktop um 100, und die Qualitaet
 * sinkt messbar ab etwa 50. 285 Werkzeuge waeren also nicht nur teuer,
 * sondern schlechter. Stattdessen: `berichte_suchen` findet den Schluessel,
 * `bericht_ausfuehren` fuehrt ihn aus.
 *
 * WAS HIER NICHT PASSIERT: SQL entsteht nicht. Die Abfrage ist die der
 * Karte, gebaut und geprueft von denen, die das Schema kennen, und seit
 * Migration 0000 gegen die Excel-Zeile "Enchilada Bayreuth" verifiziert.
 * Deshalb laeuft ein Bericht auch NICHT durch den Fallstrick-Pruefer — er
 * wuerde eine bewusste Entscheidung als Falle melden (mart.personalkosten
 * OHNE Plausibilitaetsfilter gibt es in keiner Karte, aber `stadt` steht in
 * mancher Ausgabespalte, weil die Karte sie als leer AUSWEIST).
 *
 * DIE UEBERSETZUNG. Das BI-Tool kennt zwei Platzhalter (Metabase-Syntax):
 *
 *   {{name}}      ein Wert. Wird zu $1, $2, … — als Parameter, nicht als
 *                 Text eingesetzt. Ein Betriebsname mit Apostroph (und die
 *                 gibt es, siehe migrations/0073) waere sonst ein
 *                 Syntaxfehler, im schlimmeren Fall mehr.
 *   [[ ... ]]     ein optionaler Block. Steht fuer KEINEN der Platzhalter
 *                 darin ein Wert an, faellt der ganze Block weg. Genau so
 *                 macht es das BI-Tool.
 *
 * Dazu die Feldfilter (`template_tag_dimension`): dort baut das BI-Tool die
 * ganze Klausel selbst, aus TABELLE.SPALTE — nicht schemaqualifiziert.
 * Deshalb hier genauso. Dass die Tabelle im Karten-SQL nicht unter einem
 * Alias stehen darf, prueft uebernehmen.ts statisch; das ist dieselbe
 * Bedingung, unter der die Karte auch im BI-Tool laeuft
 * (docs/fehlerkatalog.md, "Ein Feldfilter auf eine Tabelle mit Alias").
 */
import type { Karte, Parameter } from '../../metabase/typen'
import { alleKarten, karteFinden } from '../../metabase/karten'

export { alleKarten, karteFinden }

export type Bericht = {
  schluessel: string
  name: string
  beschreibung: string
  anzeige: string
  parameter: { name: string; bezeichnung: string; typ: string; pflicht: boolean; werte?: string[] }[]
}

/** Was das Modell ueber einen Bericht erfaehrt, ohne sein SQL zu sehen. */
export function berichtBeschreiben(k: Karte): Bericht {
  return {
    schluessel: k.schluessel,
    name: k.name,
    beschreibung: k.beschreibung,
    anzeige: k.anzeige,
    parameter: (k.parameter ?? []).map((p: Parameter) => ({
      name: p.name,
      bezeichnung: p['display-name'],
      typ: p.type,
      pflicht: p.required === true,
      werte: p.festeWerte,
    })),
  }
}

const TAG = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g
const BLOCK = /\[\[([\s\S]*?)\]\]/g

const gesetzt = (v: unknown) =>
  v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)

/**
 * Ein Zeitraum kommt als `{von, bis}` oder als `"von~bis"` — Metabases
 * eigene Schreibweise fuer date/range. Beides wird akzeptiert, weil das
 * Modell die eine aus der Karte und die andere aus der Gewohnheit kennt.
 */
function zeitraumTeile(wert: unknown): [string, string] | null {
  if (typeof wert === 'string' && wert.includes('~')) {
    const [von, bis] = wert.split('~')
    return von && bis ? [von, bis] : null
  }
  if (wert && typeof wert === 'object') {
    const o = wert as Record<string, string>
    if (o.von && o.bis) return [o.von, o.bis]
  }
  return null
}

/** Mit Namen, damit der Eintrag in mcp.zugriff "BerichtFehler: …" heisst und nicht "Error: …". */
export class BerichtFehler extends Error {
  constructor(meldung: string) { super(meldung); this.name = 'BerichtFehler' }
}

/**
 * Karte + Werte → ausfuehrbares SQL mit Parametern.
 */
export function uebersetzen(
  karte: Karte, werte: Record<string, unknown>,
): { sql: string; parameter: unknown[] } {
  const bekannt = new Set((karte.parameter ?? []).map(p => p.name))
  for (const name of Object.keys(werte)) {
    if (!bekannt.has(name) && gesetzt(werte[name])) {
      throw new BerichtFehler(
        `Der Bericht "${karte.schluessel}" kennt keinen Parameter "${name}". ` +
        `Bekannt sind: ${[...bekannt].join(', ') || '(keine)'}.`)
    }
  }
  for (const p of karte.parameter ?? []) {
    if (p.required && !gesetzt(werte[p.name])) {
      throw new BerichtFehler(
        `Der Bericht "${karte.schluessel}" braucht den Parameter "${p.name}" (${p['display-name']}).`)
    }
    const feste = p.festeWerte
    if (feste && gesetzt(werte[p.name]) && !feste.includes(String(werte[p.name]))) {
      throw new BerichtFehler(
        `"${werte[p.name]}" ist kein gueltiger Wert fuer "${p.name}". ` +
        `Moeglich sind: ${feste.join(', ')}.`)
    }
  }

  const parameter: unknown[] = []
  const platz = (v: unknown) => { parameter.push(v); return `$${parameter.length}` }

  /** Einen Platzhalter ersetzen — Feldfilter bauen eine ganze Klausel. */
  const ersetzen = (name: string): string => {
    const dimension = karte.template_tag_dimension?.[name]
    const wert = werte[name]

    if (dimension) {
      const [, tabelle, spalte] = dimension
      if (!gesetzt(wert)) return 'true'         // wie Metabase ohne Filterwert
      const spanne = zeitraumTeile(wert)
      if (spanne) {
        return `${tabelle}.${spalte} BETWEEN ${platz(spanne[0])}::date AND ${platz(spanne[1])}::date`
      }
      return `${tabelle}.${spalte} = ${platz(wert)}`
    }

    if (!gesetzt(wert)) {
      // Ausserhalb eines optionalen Blocks ist ein fehlender Wert NULL —
      // genau das tut Metabase, und die gemeinsamen CTE-Bausteine rechnen
      // damit (coalesce({{monat}}::date, …)).
      return platz(null)
    }
    return platz(wert)
  }

  const sql = karte.sql
    // Erst die optionalen Bloecke: ein Block ueberlebt nur, wenn JEDER
    // Platzhalter darin einen Wert hat.
    .replace(BLOCK, (_alles, inhalt: string) => {
      const tags = [...inhalt.matchAll(TAG)].map(m => m[1]!)
      return tags.every(t => gesetzt(werte[t])) ? inhalt : ''
    })
    .replace(TAG, (_alles, name: string) => ersetzen(name))

  return { sql, parameter }
}

/**
 * Volltextsuche ueber Name, Beschreibung und Schluessel.
 *
 * Bewusst einfach: 285 Karten sind keine Datenmenge, und ein Modell sucht
 * mit den Woertern, die in der Frage stehen. Treffer im Namen wiegen
 * schwerer als solche in der Beschreibung.
 */
export function berichteSuchen(stichwort: string, grenze = 25): Bericht[] {
  const worte = stichwort.toLowerCase().split(/\s+/).filter(Boolean)
  if (!worte.length) return alleKarten.slice(0, grenze).map(berichtBeschreiben)

  const bewerten = (k: Karte): number => {
    const name = k.name.toLowerCase()
    const rest = `${k.schluessel} ${k.beschreibung}`.toLowerCase()
    let punkte = 0
    for (const w of worte) {
      if (name.includes(w)) punkte += 3
      else if (rest.includes(w)) punkte += 1
    }
    return punkte
  }

  return alleKarten
    .map(k => [k, bewerten(k)] as const)
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, grenze)
    .map(([k]) => berichtBeschreiben(k))
}
