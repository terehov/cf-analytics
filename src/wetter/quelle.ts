/**
 * Der Wetterabruf, hinter einer Schnittstelle.
 *
 * QUELLE: Bright Sky auf DWD-Messdaten (api.brightsky.dev). Entscheidung E1
 * vom 20.08.2026, Begründung in docs/entscheidungen.md — kurz: Open-Meteos
 * kostenloser Zugang ist ausdrücklich nicht-gewerblich, DWD-Daten sind unter
 * GeoNutzV auch gewerblich frei. Die Namensnennung gehört ins Dashboard.
 *
 * WARUM DIESE DATEI EINE SCHNITTSTELLE IST und keine Vorratsabstraktion: das
 * Lizenzrisiko ist der Grund. Wechselt die Quelle — Open-Meteo mit Tarif, DWD
 * direkt —, ist es diese eine Datei. Alles darüber rechnet auf `Stundenwert`.
 *
 * ZWEI EIGENHEITEN DER SCHNITTSTELLE, am 20.08.2026 nachgemessen:
 *
 *   1. `last_date` liefert nur die Stunde 00:00 DIESES Tages. Ein Aufruf über
 *      2025-01-01 bis 2025-12-31 bringt 8.737 statt 8.760 Werten — die letzten
 *      23 Stunden fehlen. `hole()` setzt deshalb intern den Folgetag ein.
 *      Ohne diese Korrektur fehlte in jedem Jahr der Silvesterabend, und das
 *      ausgerechnet an einem Tag, an dem die Gastronomie arbeitet.
 *   2. `sunshine` ist in 5,4 % der Stunden NULL. Bleibt NULL und wird nicht zu
 *      0 gemacht: eine Messlücke ist keine Bewölkung.
 */
import { log } from '../lib/log'

const BASIS = 'https://api.brightsky.dev/weather'

/** Ein Gitterpunkt: auf zwei Nachkommastellen gerundete Koordinate. */
export type Ort = { breite: number; laenge: number }

export type Stundenwert = {
  zeitpunkt: string          // ISO 8601 mit Zeitzone, wie geliefert
  temperatur: number | null
  niederschlag: number | null
  sonnenschein: number | null
  wind: number | null
  bewoelkung: number | null
  luftfeuchte: number | null
  zustand: string | null
  stationId: number | null
  distanzM: number | null
}

export type Abruf = {
  ort: Ort
  werte: Stundenwert[]
  /** Für die Protokollierung: welche Station trug den Hauptteil. */
  distanzM: number | null
}

/** Die Schnittstelle, gegen die alles darüber gebaut ist. */
export interface Wetterquelle {
  hole(ort: Ort, von: string, bis: string): Promise<Abruf>
  readonly name: string
}

function tagPlusEins(datum: string): string {
  const d = new Date(`${datum}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Zahl oder null — Bright Sky liefert für fehlende Messwerte `null`, und ein
 * `Number(null)` wäre 0. Genau die Sorte stiller Verfälschung, die dieses
 * Projekt schon zweimal Tage gekostet hat.
 */
function zahl(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export class BrightSky implements Wetterquelle {
  readonly name = 'brightsky'

  constructor(
    private readonly basis = BASIS,
    /**
     * DREI MINUTEN, und das ist gemessen, nicht grosszügig geraten.
     *
     * Am 20.08.2026 lief ein Backfill über 96 Ortsjahre: 66 gingen durch, 30
     * scheiterten — alle in den Jahren 2024 und älter. Nachgestellt braucht ein
     * Aufruf für 2024 **108 Sekunden**, während die jüngsten Jahre in wenigen
     * Sekunden kommen. Bright Skys Archiv wird für alte Jahrgänge spürbar
     * langsamer; das Zeitlimit von 60 s war die Ursache, nicht die Quelle.
     *
     * Ein gescheitertes Ortsjahr ist dabei kein Verlust: `mart.wetter_rueckstand`
     * führt es weiter als `fehlt`, und die nächste Nacht holt es erneut. Genau
     * dafür ist der Rückstand eine Zahl, die fallen muss.
     */
    private readonly timeoutMs = 180_000,
  ) {}

  async hole(ort: Ort, von: string, bis: string): Promise<Abruf> {
    const url = new URL(this.basis)
    url.searchParams.set('lat', String(ort.breite))
    url.searchParams.set('lon', String(ort.laenge))
    url.searchParams.set('date', von)
    // Siehe Kopf, Eigenheit 1: last_date ist die Stunde 00:00 dieses Tages.
    url.searchParams.set('last_date', tagPlusEins(bis))

    const steuer = AbortSignal.timeout(this.timeoutMs)
    const antwort = await fetch(url, { signal: steuer, headers: { accept: 'application/json' } })
    if (!antwort.ok) {
      throw new Error(`Bright Sky ${antwort.status} für ${ort.breite},${ort.laenge} ${von}..${bis}`)
    }
    const roh = await antwort.json() as {
      weather?: unknown[]
      sources?: { id: number; distance: number }[]
    }

    // source_id -> Abstand. Bright Sky fällt je FELD auf andere Stationen
    // zurück; hier zählt die Hauptstation der Zeile.
    const abstand = new Map<number, number>()
    for (const q of roh.sources ?? []) abstand.set(q.id, q.distance)

    const werte: Stundenwert[] = []
    for (const z of (roh.weather ?? []) as Record<string, unknown>[]) {
      const quelle = zahl(z.source_id)
      werte.push({
        zeitpunkt:    String(z.timestamp),
        temperatur:   zahl(z.temperature),
        niederschlag: zahl(z.precipitation),
        sonnenschein: zahl(z.sunshine),
        wind:         zahl(z.wind_speed),
        bewoelkung:   zahl(z.cloud_cover),
        luftfeuchte:  zahl(z.relative_humidity),
        zustand:      typeof z.condition === 'string' ? z.condition : null,
        stationId:    quelle,
        distanzM:     quelle !== null ? Math.round(abstand.get(quelle) ?? NaN) || null : null,
      })
    }

    const distanzen = (roh.sources ?? []).map(q => q.distance).filter(Number.isFinite)
    return {
      ort,
      werte,
      distanzM: distanzen.length ? Math.round(Math.min(...distanzen)) : null,
    }
  }
}

/**
 * Die Namensnennung, die GeoNutzV verlangt. Steht hier und nicht nur im
 * Dashboard, damit sie beim Quellenwechsel mitgeändert wird.
 */
export const HERKUNFT = 'Wetterdaten: Deutscher Wetterdienst (DWD), bezogen über Bright Sky'

export function protokolliereHerkunft(): void {
  log.info('wetterquelle', { herkunft: HERKUNFT })
}
