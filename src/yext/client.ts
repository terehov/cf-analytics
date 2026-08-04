/**
 * Yext Management API v2 — lesender Zugriff.
 *
 * ANDERER RHYTHMUS ALS LINA UND FOODNOTIFY, UND ZWAR MIT ABSICHT.
 *
 * LINA bekommt 10–20 Sekunden Pause, weil dort ein Mensch nachgeahmt wird und
 * es genau einen Zugang gibt. Yext ist eine dokumentierte, bezahlte API mit
 * einem ausgeschriebenen Limit von 5.000 Aufrufen je Stunde. Dort ist eine
 * kuenstliche Pause keine Vorsicht, sondern verschenkte Zeit.
 *
 * Deshalb: DIE AUFRUFE GEHEN DER REIHE NACH RAUS, OHNE WARTEZEIT DAZWISCHEN —
 * aber nie parallel. Seriell ist die Bremse. Ein Backfill ueber 24 Monate sind
 * rund 3.200 Aufrufe; bei gemessenen ~400 ms je Aufruf liegt das bei etwa 2,5
 * Aufrufen je Sekunde und damit unter dem Stundenlimit, solange nur ein Lauf
 * arbeitet. Parallelitaet wuerde genau diese Rechnung zerstoeren, und deshalb
 * gibt es hier keine.
 *
 * Was bleibt, ist die Reaktion auf ein echtes Bremssignal: bei 429 und bei
 * 5xx wird gewartet, `Retry-After` gilt als Untergrenze. Nicht vorsorglich
 * langsam, aber sofort langsam, wenn Yext es sagt.
 */
import { config } from '../config'
import { log } from '../lib/log'

export class YextFehler extends Error {
  constructor(msg: string, readonly status: number, readonly endgueltig: boolean) {
    super(msg)
    this.name = 'YextFehler'
  }
}

/** Wie Yext antwortet: Nutzlast in `response`, Fehler zusaetzlich in `meta.errors`. */
type Huelle<T> = {
  meta?: { uuid?: string; errors?: { code?: number; type?: string; message?: string }[] }
  response?: T
}

/**
 * Zwei Wege, denselben Schluessel mitzugeben: als Query-Parameter `api_key`
 * oder als `Authorization: Bearer`. Welcher gilt, haengt am Konto und steht
 * nicht im Schluessel. Der erste Aufruf probiert beides und merkt sich das
 * Ergebnis fuer den Rest des Prozesses — am 03.08.2026 trug `api_key`.
 */
let weg: 'query' | 'bearer' | null = null

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

function retryAfterMs(header: string | null): number | null {
  if (!header) return null
  const sekunden = Number(header.trim())
  if (Number.isFinite(sekunden) && sekunden >= 0) return sekunden * 1000
  const datum = new Date(header)
  return Number.isNaN(datum.getTime()) ? null : Math.max(0, datum.getTime() - Date.now())
}

export function yextKonfiguriert(): boolean {
  return Boolean(config.YEXT_API_KEY)
}

/**
 * Ein Aufruf, mit Wiederholung bei 429 und 5xx.
 *
 * 4xx ausser 429 wird NICHT wiederholt: ein falscher Parameter wird beim
 * zweiten Mal genauso falsch sein, und ein 401 heisst, dass der Schluessel
 * oder die Instanz nicht stimmt — beides Faelle fuer einen Menschen, nicht
 * fuer eine Schleife.
 */
export async function yextHolen<T>(pfad: string, params: Record<string, string> = {}): Promise<T> {
  const key = config.YEXT_API_KEY
  if (!key) throw new YextFehler('YEXT_API_KEY ist nicht gesetzt', 0, true)

  const basis = config.YEXT_BASE_URL.replace(/\/+$/, '')
  const wege: ('query' | 'bearer')[] = weg ? [weg] : ['query', 'bearer']
  let letzter: YextFehler | null = null

  for (const w of wege) {
    for (let versuch = 1; versuch <= config.MAX_VERSUCHE; versuch++) {
      const url = new URL(`${basis}/v2/accounts/${config.YEXT_ACCOUNT_ID}${pfad}`)
      url.searchParams.set('v', config.YEXT_API_VERSION)
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
      if (w === 'query') url.searchParams.set('api_key', key)

      let antwort: Response
      try {
        antwort = await fetch(url, {
          headers: {
            accept: 'application/json',
            ...(w === 'bearer' ? { authorization: `Bearer ${key}` } : {}),
          },
          signal: AbortSignal.timeout(config.ANFRAGE_TIMEOUT_MS),
        })
      } catch (e) {
        // Netzfehler und Zeitlimit sind wiederholbar.
        letzter = new YextFehler(`Netzfehler: ${String((e as Error).message).slice(0, 200)}`, 0, false)
        if (versuch < config.MAX_VERSUCHE) { await schlaf(1000 * versuch); continue }
        break
      }

      const text = await antwort.text()
      let json: Huelle<T> | null = null
      try { json = JSON.parse(text) } catch { /* bei 5xx kann HTML kommen */ }

      if (antwort.ok && json?.response !== undefined) {
        if (!weg) { weg = w; log.info('yext authentifiziert', { weg: w === 'query' ? 'api_key' : 'bearer' }) }
        return json.response
      }

      const meldungen = json?.meta?.errors
        ?.map(e => `${e.code ?? '?'} ${e.type ?? ''} ${e.message ?? ''}`.trim())
      const text_ = meldungen?.length ? meldungen.join('; ') : text.slice(0, 200)
      letzter = new YextFehler(`HTTP ${antwort.status} — ${text_}`, antwort.status,
        antwort.status !== 429 && antwort.status < 500)

      // Das einzige Bremssignal, auf das gewartet wird. Ohne Header eine
      // Sekunde je Versuch — genug, um eine Spitze abzufangen, wenig genug,
      // dass ein Backfill nicht daran stirbt.
      if (antwort.status === 429 || antwort.status >= 500) {
        const warten = retryAfterMs(antwort.headers.get('retry-after')) ?? 1000 * versuch
        log.warn('yext bremst', { status: antwort.status, wartenMs: warten, versuch })
        if (versuch < config.MAX_VERSUCHE) { await schlaf(warten); continue }
      }
      break
    }

    // 401/403 kann am Weg liegen — dann den anderen probieren, aber nur,
    // solange der Weg noch nicht feststeht.
    if (weg || !letzter || (letzter.status !== 401 && letzter.status !== 403)) break
  }

  throw letzter ?? new YextFehler('Unbekannter Fehler', 0, true)
}

/** Yext deckelt bei 50 Entitaeten bzw. 100 Bewertungen je Seite. */
export async function yextSeiten<T>(
  pfad: string, feld: string, params: Record<string, string> = {}, limit = 50,
): Promise<T[]> {
  const raus: T[] = []
  let pageToken = ''
  let seiten = 0
  do {
    const r = await yextHolen<Record<string, any>>(
      pfad, { ...params, limit: String(limit), ...(pageToken ? { pageToken } : {}) })
    raus.push(...((r[feld] ?? []) as T[]))
    pageToken = r.nextPageToken ?? r.pageToken ?? ''
    seiten++
  } while (pageToken && seiten < 1000)
  return raus
}

export type YextEntitaet = {
  meta?: { id?: string; entityType?: string; accountId?: string; folderId?: string }
  name?: string
  address?: { line1?: string; city?: string; postalCode?: string; countryCode?: string }
  yextDisplayCoordinate?: { latitude?: number; longitude?: number }
  displayCoordinate?: { latitude?: number; longitude?: number }
  geocodedCoordinate?: { latitude?: number; longitude?: number }
}

export type YextOrdner = { id?: string; parentId?: string; name?: string }

export const entitaetenHolen = () => yextSeiten<YextEntitaet>('/entities', 'entities', {}, 50)
export const ordnerHolen = () => yextSeiten<YextOrdner>('/folders', 'folders', {}, 50)

/**
 * Bewertungsstand einer Entitaet zu einem Stichtag — kumuliert, nicht je Monat.
 *
 * WARUM KUMULIERT UND NICHT DIE BEWERTUNGEN DES MONATS. Die Zahl, die im
 * Round Table steht und die bisher von Hand abgetippt wurde, ist der Wert, den
 * ein Gast auf Google sieht: der Schnitt ueber ALLE Bewertungen. Der Schnitt
 * der Bewertungen eines einzelnen Monats ist eine voellig andere Groesse — bei
 * neun Bewertungen im Juli 2026 (Enchilada Hamm) schwankt er zwischen 1 und 5,
 * und eine Ampel darauf waere Rauschen mit Farbe.
 *
 * Der Monatswert geht dabei nicht verloren: er ergibt sich in
 * mart.bewertung_verlauf aus der Differenz zweier Staende. Ein Aufruf je
 * Betrieb und Monat liefert also beides.
 *
 * `limit: '1'` weil nur `count` und `averageRating` gebraucht werden. Die
 * Bewertungstexte und Autorennamen im Rumpf werden nicht ausgewertet und nicht
 * gespeichert (docs/yext-anbindung.md §3).
 */
/**
 * Eine einzelne Bewertung — nur die Felder, die wir behalten.
 *
 * `authorName` steht seit dem 03.08.2026 dabei: die Namen stehen bei
 * Google, TripAdvisor und OpenTable oeffentlich neben der Bewertung, und
 * wer auf eine Kritik antworten will, muss wissen an wen
 * (migrations/0038_bewertung_autor.sql).
 *
 * `authorEmail` und `comments` (die Antworten des Betriebs) liefert Yext
 * ebenfalls mit und stehen hier bewusst NICHT. Was nicht im Typ steht,
 * kann auch niemand versehentlich in ein INSERT schreiben.
 */
export type YextBewertung = {
  id?: number | string
  rating?: number
  content?: string
  authorName?: string
  url?: string
  publisherDate?: number
  locationId?: string
  publisherId?: string
  status?: string
}

/**
 * Alle Bewertungen einer Entitaet, seitenweise.
 *
 * 100 je Seite ist das Maximum — 250 quittiert Yext mit
 * "Invalid parameter limit" (gemessen 03.08.2026). Bei rund 174.000
 * Bewertungen im Konto sind das etwa 1.700 Aufrufe fuer den einmaligen
 * Backfill; der taegliche Lauf holt ueber `abDatum` nur den Rest.
 *
 * `status: 'LIVE'` schon in der Anfrage: quarantaenierte und entfernte
 * Bewertungen sollen gar nicht erst ueber die Leitung gehen.
 */
export async function bewertungen(
  entityId: string, abDatum?: string,
): Promise<YextBewertung[]> {
  return yextSeiten<YextBewertung>('/reviews', 'reviews', {
    entityIds: entityId,
    status: 'LIVE',
    ...(abDatum ? { minPublisherDate: abDatum } : {}),
  }, 100)
}

export async function bewertungsstand(
  entityId: string, bisDatum: string, publisher?: string,
): Promise<{ anzahl: number; schnitt: number | null }> {
  const r = await yextHolen<{ count?: number; averageRating?: number }>('/reviews', {
    entityIds: entityId,
    maxPublisherDate: bisDatum,
    limit: '1',
    ...(publisher ? { publisherIds: publisher } : {}),
  })
  const anzahl = Number(r.count ?? 0)
  return { anzahl, schnitt: anzahl > 0 && typeof r.averageRating === 'number' ? r.averageRating : null }
}
