/**
 * Die Daten auch als TEXT — fuer Hosts, deren Modell `structuredContent`
 * nicht zu sehen bekommt.
 *
 * ANLASS 16.09.2026, Claude-Connector: die Werkzeuge liefen sauber, aber
 * Claude las nur die Kopfzeile („57 Betriebe", „1 Zeilen in 12 ms"). Die
 * Zeilen selbst — und bei betriebe_suchen der betrieb_key — standen nur in
 * `structuredContent`, und Claudes Client reicht dem Modell davon nichts
 * weiter: es sieht die Textbloecke, die Ansicht bekommt das Ganze. Claude
 * konnte also Abfragen ausloesen und der Nutzer sah das Ergebnis im
 * Widget, aber das Modell konnte weder rechnen noch einordnen. Genau das
 * empfiehlt die MCP-Spezifikation ohnehin: wer structuredContent liefert,
 * SOLL denselben Inhalt auch als Text mitgeben.
 *
 * NICHT FUER CHATGPT. Dessen Modell liest structuredContent (Apps SDK);
 * derselbe Inhalt zweimal wuerde jede Antwort im Umfang verdoppeln — der
 * Round Table liegt heute schon bei ~6.800 geschaetzten Tokens. Der Host
 * wird am User-Agent erkannt, so wie Skybridge es fuer die Ansichten tut
 * (skybridge/dist/server/host.js): openai/chatgpt → nichts anhaengen,
 * alles andere (Claude, Copilot, Unbekanntes) → anhaengen.
 *
 * KOMPAKT, NICHT JSON. Ein Feld `zeilen` mit 57 Objekten wiederholt in JSON
 * 57-mal dieselben zwanzig Spaltennamen — beim Round Table sind das zwei
 * Drittel des Umfangs. Deshalb werden Listen gleichfoermiger Objekte als
 * Tabelle geschrieben (Kopfzeile, dann eine Zeile je Eintrag, Zellen mit
 * „ | " getrennt); alles andere bleibt JSON. Zahlen bleiben Zahlen
 * (182345.67, nicht 182.345,67): das Modell soll damit RECHNEN, nicht sie
 * vorlesen. Leere Zellen sind leer, nicht „null".
 *
 * ALS MIDDLEWARE, wie das Zugriffsprotokoll (zugriff_protokoll.ts): eine
 * Stelle fuer alle zehn Werkzeuge, statt zehn Stellen, von denen die
 * elfte vergessen wird.
 */

export type Wirt = 'openai' | 'andere'

/** Woher der Aufruf kommt — nur die eine Unterscheidung, die hier zaehlt. */
export function wirtAus(extra: any): Wirt {
  const ua = String(extra?.http?.req?.headers?.get?.('user-agent') ?? '').toLowerCase()
  return ua.includes('openai') || ua.includes('chatgpt') ? 'openai' : 'andere'
}

const istObjekt = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** Eine Zelle: leer statt null, Zahlen roh, Trenner und Zeilenumbrueche entschaerft. */
function zelle(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.replace(/\|/g, '¦').replace(/\s*\n\s*/g, ' ')
}

/** Liste gleichfoermiger Objekte als Tabelle — sonst null. */
export function alsTabelle(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0 || !v.every(istObjekt)) return null
  const spalten: string[] = []
  for (const zeile of v) for (const k of Object.keys(zeile)) if (!spalten.includes(k)) spalten.push(k)
  if (spalten.length === 0) return null
  const kopf = spalten.join(' | ')
  const zeilen = v.map(zeile => spalten.map(s => zelle(zeile[s])).join(' | '))
  return [kopf, ...zeilen].join('\n')
}

/** Der ganze structuredContent als kompakter Text. */
export function strukturAlsText(wert: unknown): string {
  if (!istObjekt(wert)) return typeof wert === 'string' ? wert : JSON.stringify(wert) ?? ''
  const teile: string[] = []
  for (const [k, v] of Object.entries(wert)) {
    if (v === undefined) continue
    const tabelle = alsTabelle(v)
    if (tabelle) teile.push(`${k} (${(v as unknown[]).length}):\n${tabelle}`)
    else if (typeof v === 'string') teile.push(`${k}: ${v}`)
    else teile.push(`${k}: ${JSON.stringify(v)}`)
  }
  return teile.join('\n')
}

type Anfrage = { method: string; params: Record<string, unknown> }

/**
 * Middleware fuer tools/call: haengt den structuredContent als Textblock an —
 * ausser fuer ChatGPT, bei Fehlern und wenn es nichts anzuhaengen gibt.
 */
export async function datenAlsTextErgaenzen<T>(
  _request: Anfrage, extra: any, next: () => Promise<T>,
): Promise<T> {
  const ergebnis = await next()
  const r = ergebnis as any
  if (!istObjekt(r) || r.isError) return ergebnis
  // Eine Sperre (server.ts, abfrage_ausfuehren) traegt ihren ganzen Befund
  // schon als Text; die leere Ergebnisform noch einmal anzuhaengen hilft
  // niemandem.
  if ((r._meta as { gesperrt?: unknown } | undefined)?.gesperrt === true) return ergebnis
  const sc = r.structuredContent
  if (!istObjekt(sc) || Object.keys(sc).length === 0) return ergebnis
  if (wirtAus(extra) === 'openai') return ergebnis

  const bisher = Array.isArray(r.content) ? r.content
    : r.content === undefined ? []
    : typeof r.content === 'string' ? [{ type: 'text', text: r.content }]
    : [r.content]
  return { ...r, content: [...bisher, { type: 'text', text: strukturAlsText(sc) }] } as T
}
