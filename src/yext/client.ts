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
import { ohneNullzeichen, jsonOhneNullzeichen } from '../lib/text'

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
export async function yextHolen<T>(
  pfad: string, params: Record<string, string> = {}, koerper?: unknown,
): Promise<T> {
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
          // Der Analytics-Bericht ist ein POST, obwohl er nur liest --
          // die Abfrage passt nicht in eine URL. Kein Schreibzugriff.
          method: koerper === undefined ? 'GET' : 'POST',
          headers: {
            accept: 'application/json',
            ...(koerper === undefined ? {} : { 'content-type': 'application/json' }),
            ...(w === 'bearer' ? { authorization: `Bearer ${key}` } : {}),
          },
          body: koerper === undefined ? undefined : JSON.stringify(koerper),
          signal: AbortSignal.timeout(config.ANFRAGE_TIMEOUT_MS),
        })
      } catch (e) {
        // Netzfehler und Zeitlimit sind wiederholbar.
        letzter = new YextFehler(`Netzfehler: ${String((e as Error).message).slice(0, 200)}`, 0, false)
        if (versuch < config.MAX_VERSUCHE) { await schlaf(1000 * versuch); continue }
        break
      }

      /**
       * NUL raus, bevor irgendetwas davon in die Datenbank geht.
       *
       * Von hier gehen Gaestetexte ungefiltert nach `core.bewertung` und als
       * jsonb nach `sync.merker`. Eine Google-Rezension ist der wahrschein-
       * lichste NUL-Traeger im ganzen Projekt — Text, den Fremde tippen und
       * durch fremde Systeme schicken. Ein einziges NUL laesst den
       * Sammel-INSERT eines Betriebs scheitern, und der Lader meldet das nur
       * als WARN. Siehe src/lib/text.ts zu den zwei Wegen.
       */
      const text = ohneNullzeichen(await antwort.text(), `yext${pfad}`)
      let json: Huelle<T> | null = null
      try {
        json = jsonOhneNullzeichen(text, `yext${pfad}`) as Huelle<T>
      } catch { /* bei 5xx kann HTML kommen */ }

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

// =====================================================================
// Analytics — POST /analytics/reports
//
// EIN AUFRUF LIEFERT ALLE BETRIEBE UEBER ALLE MONATE. Das ist der ganze
// Unterschied zu den Staenden oben: dort ist ein Aufruf eine Zahl fuer
// einen Betrieb, einen Monat und ein Portal (3.300 Aufrufe fuer den
// Backfill), hier sind es 790 Zeilen in einem Aufruf. Deshalb wird hier
// nicht gestueckelt und nicht inkrementell geladen -- es lohnt nicht.
//
// Grenzen der API, gemessen am 10.08.2026: hoechstens 10 Metriken und 10
// Dimensionen je Bericht, davon nur EINE Zeit- und EINE Ortsdimension.
// Kein limit, kein offset, keine Sortierung -- die Antwort kommt ganz.
// =====================================================================

/**
 * Wie die Metrik in der ANTWORT heisst.
 *
 * Yext gibt Spalten unter Anzeigenamen zurueck, nicht unter den
 * Metriknamen der Anfrage -- und zwar uneinheitlich: NEW_REVIEWS wird zu
 * "Reviews", LISTINGS_ACCURACY bleibt LISTINGS_ACCURACY, und
 * GOOGLE_LISTINGS_IMPRESSIONS kommt als "LISTINGS_IMPRESSIONS" zurueck.
 *
 * Diese Tabelle ist deshalb kein Komfort, sondern die Stelle, an der ein
 * stiller Fehler laut wird: `berichtZeilen` wirft, wenn eine angefragte
 * Metrik nicht unter dem erwarteten Namen ankommt. Ohne das haette eine
 * Umbenennung bei Yext lautlos NULL-Spalten erzeugt.
 */
const ANTWORTNAME: Record<string, string> = {
  NEW_REVIEWS:                                  'Reviews',
  AVERAGE_RATING:                               'Average Rating',
  RESPONSE_RATE:                                'Response Rate',
  RESPONSE_COUNT:                               'Response Count',
  REVIEW_RESPONSE_TIME_REVIEW_TIMESTAMP_BASED:  'REVIEW_RESPONSE_TIME_REVIEW_TIMESTAMP_BASED',
  TOTAL_LISTINGS_IMPRESSIONS:                   'Total Listings Impressions',
  GOOGLE_LISTINGS_IMPRESSIONS:                  'LISTINGS_IMPRESSIONS',
  GOOGLE_LISTINGS_IMPRESSIONS_BENCHMARK_MEDIAN: 'GOOGLE_LISTINGS_IMPRESSIONS_BENCHMARK_MEDIAN',
  SEARCHES:                                     'Searches',
  PROFILE_VIEWS:                                'Profile Views',
  CLICK_COUNT:                                  'CLICK_COUNT',
  LISTINGS_ACCURACY:                            'LISTINGS_ACCURACY',
  // Zwei Metriken, die dasselbe zu heissen scheinen und Verschiedenes
  // zaehlen: POWERLISTINGS_LIVE ist der BESTAND ("Active Listings Live",
  // 5.291 im Konto), LISTINGS_LIVE sind die NEUZUGAENGE des Zeitraums
  // ("New Listings Live", 114). Fuer den Pflegezustand zaehlt der Bestand.
  POWERLISTINGS_LIVE:                           'Active Listings Live',
  LISTINGS_LIVE:                                'New Listings Live',
  UNAVAILABLE_REASON_COUNT:                     'UNAVAILABLE_REASON_COUNT',
  PUBLISHER_SUGGESTIONS:                        'Publisher Suggestions',
}

export type BerichtFilter = {
  entityIds?: string[]
  startDate?: string
  endDate?: string
  publishers?: string[]
  reviewLabels?: string[]
  ratings?: number[]
  awaitingResponse?: boolean
}

export type BerichtZeile = Record<string, string | number | null>

/**
 * Ein Analytics-Bericht. Gibt die Zeilen zurueck, wie Yext sie liefert --
 * Dimensionen unter ihrem eigenen Namen, Metriken unter ANTWORTNAME.
 *
 * `zahl()` und `text()` unten holen die Werte heraus, damit keine Karte
 * und kein Loader die Anzeigenamen kennen muss.
 */
export async function bericht(
  metriken: string[], dimensionen: string[], filter: BerichtFilter = {},
): Promise<BerichtZeile[]> {
  if (metriken.length > 10 || dimensionen.length > 10) {
    throw new YextFehler(
      `Yext nimmt hoechstens 10 Metriken und 10 Dimensionen je Bericht `
      + `(hier ${metriken.length} und ${dimensionen.length})`, 0, true)
  }
  const unbekannt = metriken.filter(m => !(m in ANTWORTNAME))
  if (unbekannt.length) {
    throw new YextFehler(
      `Fuer diese Metriken ist kein Antwortname hinterlegt: ${unbekannt.join(', ')}. `
      + `Ergaenze ANTWORTNAME in src/yext/client.ts`, 0, true)
  }

  const r = await yextHolen<{ data?: BerichtZeile[] }>(
    '/analytics/reports', {}, { metrics: metriken, dimensions: dimensionen, filters: filter })
  const zeilen = r.data ?? []

  // Der Selbsttest: kam jede angefragte Metrik unter dem erwarteten Namen
  // an? Eine leere Antwort ist erlaubt (Betrieb ohne Daten im Zeitraum),
  // eine gefuellte mit fehlender Spalte nicht.
  if (zeilen.length) {
    const da = new Set(zeilen.flatMap(z => Object.keys(z)))
    const fehlt = metriken.filter(m => !da.has(ANTWORTNAME[m]!))
    if (fehlt.length) {
      throw new YextFehler(
        `Yext hat ${fehlt.map(m => `${m} (erwartet als "${ANTWORTNAME[m]}")`).join(', ')} `
        + `nicht geliefert. Tatsaechliche Spalten: ${[...da].join(', ')}. `
        + `ANTWORTNAME in src/yext/client.ts anpassen.`, 0, true)
    }
  }
  return zeilen
}

/** Der Wert einer Metrik aus einer Berichtszeile. */
export const zahl = (z: BerichtZeile, metrik: string): number | null => {
  const v = z[ANTWORTNAME[metrik] ?? metrik]
  return typeof v === 'number' ? v : null
}

/** Der Wert einer Dimension aus einer Berichtszeile. */
export const text = (z: BerichtZeile, dimension: string): string | null => {
  const v = z[dimension]
  return v == null ? null : String(v)
}

/**
 * Bis wann Yext welche Metrik als vollstaendig meldet.
 *
 * Der Endpunkt, der die ganze Sondierung erst brauchbar gemacht hat: ohne
 * ihn liefert der Bericht fuer angefangene Zeitraeume Zahlen, die
 * vollstaendig aussehen. Am 10.08.2026 waren die Bewertungsmetriken bis
 * zum 09.08. vollstaendig, die Google-Suchbegriffe nur bis zum 30.06.
 */
export async function datenstand(): Promise<{ metrik: string; bis: string }[]> {
  const r = await yextHolen<{ metrics?: { id?: string; completedDate?: string }[] }>(
    '/analytics/catalog')
  return (r.metrics ?? [])
    .filter(m => m.id && m.completedDate)
    .map(m => ({ metrik: m.id!, bis: m.completedDate! }))
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
