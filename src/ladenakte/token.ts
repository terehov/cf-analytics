/**
 * Gesalzene Zugriffsmerkmale der Ladenakte auflösen.
 *
 * LINA vergibt für Belegarchiv, BWA und Stammdatenblatt je Anfrage neue,
 * gesalzene Werte. Sie können deshalb nicht im Warteschlangenposten stehen —
 * sonst laufen alle Posten nach dem ersten Lauf ins Leere.
 *
 * Aufgelöst wird kurz vor dem Aufruf, über denselben gedrosselten Client.
 * Das ist dieselbe Bauform wie die Neuanmeldung bei abgelaufener Sitzung:
 * ein zusätzlicher Aufruf innerhalb von `holen()`, kein eigener Posten.
 *
 * Gemessen am 11.08.2026: ein Token galt nach 172 s noch und deckt alle 14
 * Belegarten desselben Betriebs ab. Die Obergrenze ist unbekannt, deshalb
 * ist die Haltbarkeit hier bewusst kürzer angesetzt, und der Client holt bei
 * einer unbrauchbaren Antwort einmal neu.
 */
import type { Endpunkt } from '../lina/endpunkte'
import { BAUM, ORDNERSEITE, pfadPruefen } from './endpunkte'

/** Nur der Teil des Clients, den wir hier brauchen — bricht den Importzyklus. */
export type Holer = {
  holen(ep: Endpunkt, parameter: Record<string, string>): Promise<
    { art: 'ok'; daten: unknown } | { art: string; [k: string]: unknown }>
}

/**
 * Gemessen sind 172 s. Die Hälfte davon als Haltbarkeit: ein Betrieb braucht
 * bei 4–6 s Takt rund 60–90 s für alle seine Ordner, das passt hinein.
 */
export const HALTBARKEIT_MS = 90_000

/**
 * „Dieser Betrieb hat gar kein Belegarchiv" — eine ANTWORT, kein Fehler.
 *
 * Der Unterschied entscheidet über 560 Anfragen am Tag. Seit der tägliche
 * Abgleich jeden Betrieb zählt (13.08.2026), werden 141 Betriebe angefragt;
 * die Vollzählung vom 11.08.2026 kannte nur 131. Für die zehn übrigen — drei
 * geschlossen, sechs ohne Geschäft, einer Test, alle mit null Belegen — ist
 * offen, ob der Baumknoten `belegarchiv_<id>` überhaupt Ordner führt.
 *
 * Liefe das als gewöhnlicher Fehler, käme jeder der 140 Posten viermal wieder
 * und landete danach auf `aufgegeben` — jede Nacht aufs Neue, weil die Zählung
 * am nächsten Tag frische Posten stellt. Als `keine_daten` ist es das, was es
 * ist: gefragt, nichts da, kein Retry. Dieselbe Behandlung wie LINAs HTTP 500
 * mit leerem Rumpf (AGENTS.md, „Wo man nachschaut").
 */
export class KeinBelegarchiv extends Error {
  constructor(linaBetriebId: string) {
    super(`Betrieb ${linaBetriebId} hat im Belegarchiv keinen einzigen Ordner`)
    this.name = 'KeinBelegarchiv'
  }
}

/**
 * `wert === null` merkt sich die NEGATIVE Antwort — sonst fragen alle vierzehn
 * Belegarten desselben Betriebs nacheinander denselben Baumknoten ab und
 * bekommen vierzehnmal dieselbe Absage. Mit dem Merker sind es zwei Anfragen
 * je Betrieb und Tag statt achtundzwanzig.
 */
type Eintrag = { wert: string | null; geholtAm: number }
const cache = new Map<string, Eintrag>()

/** Für Tests und für den Laufbeginn. */
export function cacheLeeren(): void { cache.clear() }
export function cacheGroesse(): number { return cache.size }

/** `undefined` = nichts gemerkt, `null` = gemerkt, dass es nichts gibt. */
function ausCache(schluessel: string, jetzt: number): string | null | undefined {
  const e = cache.get(schluessel)
  if (!e) return undefined
  if (jetzt - e.geholtAm > HALTBARKEIT_MS) { cache.delete(schluessel); return undefined }
  return e.wert
}

async function baumknoten(h: Holer, id: string): Promise<any> {
  const r = await h.holen(BAUM, { id })
  if (r.art !== 'ok') throw new Error(`Baumknoten ${id}: ${r.art} — ${String((r as any).fehler ?? '')}`)
  return (r as { daten: unknown }).daten
}

/** `data-link` eines Kindknotens, gesucht über den Beschriftungstext. */
function kindLink(knoten: any, treffer: RegExp, was: string): string {
  const kinder: any[] = Array.isArray(knoten) ? knoten : (knoten?.children ?? [])
  const k = kinder.find(x => treffer.test(String(x?.text ?? '')))
  const link = k?.a_attr?.['data-link']
  if (!link) {
    throw new Error(`${was} nicht im Baumknoten gefunden (${kinder.length} Kinder: `
      + `${kinder.slice(0, 6).map(x => x?.text).join(', ')})`)
  }
  return String(link)
}

/** Pfad und Query eines data-link trennen. */
function zerlegen(link: string): { pfad: string; query: Record<string, string> } {
  const u = new URL(link, 'https://lina.invalid')
  return { pfad: u.pathname, query: Object.fromEntries(u.searchParams) }
}

/**
 * `storeId` für die Belegliste eines Betriebs. Zwei Aufrufe: Baumknoten für
 * den Ordnerlink, Ordnerseite für den im HTML eingebetteten `getFilesUrl`.
 *
 * Welcher Ordner dafür geöffnet wird, ist gleichgültig — der Token kodiert
 * den Betrieb, nicht den Ordner (am 11.08.2026 über vier Belegarten geprüft).
 */
export async function belegToken(
  h: Holer, linaBetriebId: string, jetzt = Date.now(),
): Promise<string> {
  const schluessel = `beleg:${linaBetriebId}`
  const alt = ausCache(schluessel, jetzt)
  if (alt !== undefined) {
    if (alt === null) throw new KeinBelegarchiv(linaBetriebId)
    return alt
  }

  const knoten = await baumknoten(h, `belegarchiv_${linaBetriebId}`)
  const kinder: any[] = Array.isArray(knoten) ? knoten : (knoten?.children ?? [])
  if (kinder.length === 0) {
    cache.set(schluessel, { wert: null, geholtAm: jetzt })
    throw new KeinBelegarchiv(linaBetriebId)
  }
  const { pfad, query } = zerlegen(String(kinder[0]?.a_attr?.['data-link'] ?? ''))
  pfadPruefen(pfad)

  const r = await h.holen({ ...ORDNERSEITE, pfad }, query)
  if (r.art !== 'ok') throw new Error(`Ordnerseite ${linaBetriebId}: ${r.art}`)
  const html = String((r as { daten: unknown }).daten)

  const m = html.match(/getFilesUrl\s*=\s*'([^']+)'/)
  if (!m) throw new Error(`getFilesUrl fehlt in der Ordnerseite von Betrieb ${linaBetriebId}`)
  const tok = new URL(m[1], 'https://lina.invalid').searchParams.get('storeId')
  if (!tok) throw new Error(`storeId fehlt in getFilesUrl von Betrieb ${linaBetriebId}`)

  cache.set(schluessel, { wert: tok, geholtAm: jetzt })
  return tok
}

/** Der gesalzene `laden=`-Wert für /finanzen/bwa/longterm. */
export async function bwaHash(
  h: Holer, linaBetriebId: string, jetzt = Date.now(),
): Promise<string> {
  const schluessel = `bwa:${linaBetriebId}`
  const alt = ausCache(schluessel, jetzt)
  if (alt) return alt

  const knoten = await baumknoten(h, `bwa_${linaBetriebId}`)
  const link = kindLink(knoten, /Longterm/i, 'BWA-Sicht "Longterm"')
  const wert = new URL(link, 'https://lina.invalid').searchParams.get('laden')
  if (!wert) throw new Error(`laden= fehlt im Longterm-Link von Betrieb ${linaBetriebId}`)

  cache.set(schluessel, { wert, geholtAm: jetzt })
  return wert
}

/** Der vollständige Pfad des Stammdatenblatts, mit Laden-Hash. */
export async function stammPfad(
  h: Holer, linaBetriebId: string, jetzt = Date.now(),
): Promise<string> {
  const schluessel = `stamm:${linaBetriebId}`
  const alt = ausCache(schluessel, jetzt)
  if (alt) return alt

  const knoten = await baumknoten(h, `laden_${linaBetriebId}`)
  const link = kindLink(knoten, /^Stammdaten$/, 'Rubrik "Stammdaten"')
  const { pfad } = zerlegen(link)
  pfadPruefen(pfad)

  cache.set(schluessel, { wert: pfad, geholtAm: jetzt })
  return pfad
}

/** Nach einer unbrauchbaren Antwort: den gemerkten Wert wegwerfen. */
export function verwerfen(art: 'beleg' | 'bwa' | 'stamm', linaBetriebId: string): void {
  cache.delete(`${art}:${linaBetriebId}`)
}
