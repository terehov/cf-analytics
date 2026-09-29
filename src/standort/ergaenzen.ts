/**
 * Standorte ergänzen — Adresse aus LINA, Koordinate aus OpenStreetMap
 * (Migration 0125, 29.09.2026).
 *
 * ANLASS. `manual.betrieb_standort` hatte 60 von 141 Betrieben, alle aus
 * Yext. Sieben operative fehlten, darunter der umsatzstärkste — ohne
 * Koordinate kein Wetter, ohne PLZ kein Bundesland und damit keine
 * Feiertage. Und weil jeder Join darauf LEFT ist, fehlten sie still.
 *
 * DIE RANGFOLGE, WER SCHREIBEN DARF:
 *   1. Handpflege (`pflege/betrieb_standort.csv`, herkunft 'manuell' u. a.) —
 *      wird hier nie überschrieben.
 *   2. Yext (herkunft 'concept_family', src/yext/zuordnen.ts) — überschreibt
 *      'lina' und 'geocoding': gegen Yext geprüft stimmten 58 von 60 PLZ, die
 *      zwei Abweichungen waren Fehler in LINA.
 *   3. Diese Datei (herkunft 'geocoding' mit Koordinate, 'lina' ohne) — nur
 *      wo noch nichts steht, oder wo sie selbst geschrieben hat und LINA
 *      inzwischen eine andere Adresse meldet.
 *
 * NUR BETRIEBE IM GESCHÄFT (operativ, inaktiv, fremdkasse). Jede neue
 * Koordinate wird ein Gitterpunkt, und jeder Gitterpunkt kostet den
 * Wetter-Backfill acht Jahre. Für geschlossene Betriebe wäre das Aufwand
 * ohne Leser.
 *
 * EIN FEHLSCHLAG WIRD NICHT WIEDERHOLT. Findet Nominatim nichts, steht die
 * Adresse mit herkunft 'lina', ohne Koordinate und genauigkeit 'unbekannt'
 * da — die PLZ bringt trotzdem das Bundesland, falls es bekannt ist. Erneut
 * versucht wird erst, wenn LINA eine andere Adresse meldet. Sichtbar ist der
 * Fall in `mart.luecke_monat` („Betrieb ohne Koordinate").
 *
 * WIRFT NIE — ein fehlender Standort ist eine leere Spalte, kein Grund, den
 * Lauf scheitern zu lassen.
 */
import { config } from '../config'
import { log } from '../lib/log'
import { query } from '../db/pool'
import { adressenAusRawLaden } from './adresse'

export type Anschrift = { strasse: string | null; plz: string; ort: string | null }

export type Treffer = {
  breite: number
  laenge: number
  genauigkeit: 'adresse' | 'strasse' | 'ort'
  /** Bundesland, wie Nominatim es nennt ("Baden-Württemberg"). */
  bundesland: string | null
}

export interface Geocoder {
  suche(a: Anschrift): Promise<Treffer | null>
}

/** Die Länderkürzel, wie sie in manual.plz_bundesland stehen. */
export const LAENDER: Record<string, string> = {
  'Baden-Württemberg': 'BW', 'Bayern': 'BY', 'Berlin': 'BE', 'Brandenburg': 'BB',
  'Bremen': 'HB', 'Hamburg': 'HH', 'Hessen': 'HE', 'Mecklenburg-Vorpommern': 'MV',
  'Niedersachsen': 'NI', 'Nordrhein-Westfalen': 'NW', 'Rheinland-Pfalz': 'RP',
  'Saarland': 'SL', 'Sachsen': 'SN', 'Sachsen-Anhalt': 'ST',
  'Schleswig-Holstein': 'SH', 'Thüringen': 'TH',
}

const warte = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * OpenStreetMap/Nominatim. Nutzungsregeln (operations.osmfoundation.org/
 * policies/nominatim): höchstens eine Anfrage je Sekunde, eine erkennbare
 * Anwendungskennung, Namensnennung „© OpenStreetMap-Mitwirkende" (ODbL) —
 * die steht in der notiz jeder Zeile und in docs/datenherkunft.md.
 *
 * Zwei Versuche: strukturiert mit Straße, sonst nur PLZ und Ort. Der zweite
 * ist für das Wetter gut genug (das Gitter rundet auf 0,01°, rund 1 km) und
 * für das Bundesland ohnehin.
 */
export class Nominatim implements Geocoder {
  private letzte = 0

  constructor(
    private readonly basis = config.NOMINATIM_URL,
    private readonly pauseMs = 1100,
    private readonly timeoutMs = 20_000,
  ) {}

  private async frage(p: Record<string, string>): Promise<Treffer | null> {
    const seit = Date.now() - this.letzte
    if (seit < this.pauseMs) await warte(this.pauseMs - seit)
    this.letzte = Date.now()

    const url = new URL('/search', this.basis)
    for (const [k, v] of Object.entries(p)) url.searchParams.set(k, v)
    url.searchParams.set('countrycodes', 'de')
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('limit', '1')
    const antwort = await fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        'accept': 'application/json',
        'accept-language': 'de',
        'user-agent': 'concept-family-analytics/1.0 (Betriebsstandorte, einmal je Adresse)',
      },
    })
    if (!antwort.ok) throw new Error(`Nominatim ${antwort.status}`)
    const r = await antwort.json() as {
      lat: string; lon: string
      address?: { house_number?: string; road?: string; state?: string }
    }[]
    const t = r[0]
    if (!t) return null
    return {
      breite: Number(t.lat),
      laenge: Number(t.lon),
      genauigkeit: t.address?.house_number ? 'adresse' : t.address?.road ? 'strasse' : 'ort',
      bundesland: t.address?.state ?? null,
    }
  }

  async suche(a: Anschrift): Promise<Treffer | null> {
    if (a.strasse) {
      const t = await this.frage({ street: a.strasse, postalcode: a.plz, city: a.ort ?? '' })
      if (t) return t
    }
    const t = await this.frage({ postalcode: a.plz, city: a.ort ?? '' })
    return t ? { ...t, genauigkeit: 'ort' } : null
  }
}

/** Grob Mitteleuropa — dieselbe Grenze wie der CHECK auf manual.betrieb_standort. */
function plausibel(t: Treffer): boolean {
  return t.breite >= 45 && t.breite <= 56 && t.laenge >= 5 && t.laenge <= 16
}

export type Ergebnis = { kandidaten: number; mitKoordinate: number; ohne: number; laender: number; fehler: string[] }

export async function standortErgaenzen(
  geo: Geocoder = new Nominatim(),
  grenze = config.GEOCODING_JE_LAUF,
): Promise<Ergebnis> {
  const raus: Ergebnis = { kandidaten: 0, mitKoordinate: 0, ohne: 0, laender: 0, fehler: [] }
  if (grenze <= 0) return raus

  const kandidaten = await query<{
    betrieb_key: number; strasse: string | null; plz: string; ort: string | null; abgerufen_am: Date
  }>(
    `SELECT a.betrieb_key, a.strasse, a.plz, a.ort, a.abgerufen_am
       FROM core.betrieb_adresse a
       JOIN mart.betrieb_status bs ON bs.betrieb_key = a.betrieb_key
       LEFT JOIN manual.betrieb_standort s ON s.betrieb_key = a.betrieb_key
      WHERE bs.status IN ('operativ', 'inaktiv', 'fremdkasse')
        AND a.plz IS NOT NULL
        AND (s.betrieb_key IS NULL
             OR (s.herkunft IN ('lina', 'geocoding')
                 AND (s.plz IS DISTINCT FROM a.plz OR s.strasse IS DISTINCT FROM a.strasse)))
      ORDER BY a.betrieb_key
      LIMIT $1`, [grenze])
  raus.kandidaten = kandidaten.length

  for (const k of kandidaten) {
    let t: Treffer | null = null
    try {
      t = await geo.suche({ strasse: k.strasse, plz: k.plz, ort: k.ort })
    } catch (e) {
      // Ein Netzfehler ist kein "nicht gefunden": nichts schreiben, die
      // nächste Nacht versucht es erneut (die Adresse bleibt Kandidat).
      raus.fehler.push(`${k.betrieb_key}: ${String(e).slice(0, 120)}`)
      continue
    }
    const mit = t !== null && plausibel(t)
    const stand = k.abgerufen_am.toISOString().slice(0, 10)
    await query(
      `INSERT INTO manual.betrieb_standort
         (betrieb_key, strasse, plz, ort, land, breitengrad, laengengrad, herkunft, genauigkeit, notiz)
       VALUES ($1, $2, $3, $4, 'DE', $5, $6, $7, $8, $9)
       ON CONFLICT (betrieb_key) DO UPDATE SET
         strasse = EXCLUDED.strasse, plz = EXCLUDED.plz, ort = EXCLUDED.ort,
         breitengrad = EXCLUDED.breitengrad, laengengrad = EXCLUDED.laengengrad,
         herkunft = EXCLUDED.herkunft, genauigkeit = EXCLUDED.genauigkeit,
         notiz = EXCLUDED.notiz, geaendert_am = now()
       -- Nur was diese Datei selbst geschrieben hat; Yext und Handpflege gehen vor.
       WHERE betrieb_standort.herkunft IN ('lina', 'geocoding')`,
      [k.betrieb_key, k.strasse, k.plz, k.ort,
       mit ? t!.breite : null, mit ? t!.laenge : null,
       mit ? 'geocoding' : 'lina', mit ? t!.genauigkeit : 'unbekannt',
       `Adresse: LINA-Ladenakte, Stammdatenblatt vom ${stand}. `
       + (mit ? 'Koordinate: OpenStreetMap/Nominatim, © OpenStreetMap-Mitwirkende (ODbL).'
              : 'Nominatim fand keine plausible Koordinate — von Hand nachtragen.')])
    if (mit) raus.mitKoordinate++
    else raus.ohne++

    // Das Bundesland zur PLZ, falls die Tabelle sie noch nicht kennt.
    const kuerzel = t?.bundesland ? LAENDER[t.bundesland] : undefined
    if (kuerzel) {
      const r = await query(
        `INSERT INTO manual.plz_bundesland (plz, bundesland, kuerzel)
         VALUES ($1, $2, $3) ON CONFLICT (plz) DO NOTHING RETURNING plz`,
        [k.plz, t!.bundesland, kuerzel])
      raus.laender += r.length
    }
  }
  return raus
}

/** Der Aufruf im Nachtlauf (vor dem Wetter): wirft nie. */
export async function standortNachlauf(): Promise<void> {
  try {
    const a = await adressenAusRawLaden()
    const s = await standortErgaenzen()
    log.info('standorte ergaenzt', {
      adressen_gelesen: a.gelesen, adressen_geschrieben: a.geschrieben,
      kandidaten: s.kandidaten, mit_koordinate: s.mitKoordinate, ohne_koordinate: s.ohne,
      neue_plz_bundesland: s.laender, fehler: s.fehler.length, sicht: 'mart.luecke_monat',
    })
    if (s.fehler.length > 0) log.warn('geocoding teilweise', { erste: s.fehler.slice(0, 3) })
  } catch (e) {
    log.error('standorte nicht ergaenzt — der Lauf geht weiter', { fehler: String(e).slice(0, 300) })
  }
}
