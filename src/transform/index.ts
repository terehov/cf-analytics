/**
 * Transformationen raw → core.
 *
 * Bewusst reine Funktionen: JSON rein, Zeilen raus. Kein Datenbankzugriff,
 * keine Uhr, kein Zufall. Genau deshalb sind sie testbar — die Tests laufen
 * gegen die echten (anonymisierten) Antworten aus Phase 1.
 *
 * Der Raw-Layer bleibt die Wahrheit. Stellt sich eine Transformation als
 * falsch heraus, wird sie korrigiert und alles neu aufgebaut, ohne dass ein
 * einziger Aufruf gegen LINA nötig wäre.
 */
import { geschaeftstagFuerStunde } from '../lib/time'

/** Prozentwerte immer als Prozentzahl. LINAs diff ist bereits Prozent. */
const z = (v: unknown): number | null =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v)

export type UmsatzZeile = {
  encId: string
  geschaeftstag: string
  hauptspartePosId: number | null
  umsatzNetto: number | null
  umsatzBrutto: number | null
  rechnungen: number | null
  gaeste: number | null
  durchschnittsbon: number | null
  umsatzProGast: number | null
}

export function umsatzbericht(
  daten: any, geschaeftstag: string, hauptspartePosId: number | null = null,
): UmsatzZeile[] {
  return (daten?.stores ?? []).map((s: any) => ({
    encId: s.encId,
    geschaeftstag,
    hauptspartePosId,
    umsatzNetto: z(s.umsatzNetto),
    umsatzBrutto: z(s.umsatzBrutto),
    rechnungen: z(s.bills),
    gaeste: z(s.guests),
    durchschnittsbon: z(s.avgTicket),
    umsatzProGast: z(s.avgGuest),
  }))
}

export type PersonalkostenZeile = {
  encId: string
  zeitraumVon: string
  zeitraumBis: string
  effService: number | null; effBar: number | null; effKueche: number | null; effGesamt: number | null
  pekService: number | null; pekBar: number | null; pekKueche: number | null; pekGesamt: number | null
  persoogBwa: number | null
}

export type SchwellenwertZeile = {
  encId: string
  gueltigAb: string
  bereich: string
  gruen: number | null
  orange: number | null
  rot: number | null
}

export function personalkosten(daten: any, von: string, bis: string): {
  kosten: PersonalkostenZeile[]
  schwellen: SchwellenwertZeile[]
} {
  const kosten: PersonalkostenZeile[] = []
  const schwellen: SchwellenwertZeile[] = []

  for (const s of daten?.stores ?? []) {
    kosten.push({
      encId: s.encId, zeitraumVon: von, zeitraumBis: bis,
      effService: z(s.effService), effBar: z(s.effBar), effKueche: z(s.effKueche), effGesamt: z(s.effGesamt),
      pekService: z(s.pekService), pekBar: z(s.pekBar), pekKueche: z(s.pekKueche), pekGesamt: z(s.pekGesamt),
      persoogBwa: z(s.persoogBwa),
    })

    // pekThreshold ist [grün, orange, rot] — als Strings, LINA liefert hier Text.
    const t = s.pekThreshold
    if (Array.isArray(t) && t.length >= 2) {
      schwellen.push({
        encId: s.encId, gueltigAb: von, bereich: 'personal',
        gruen: z(t[0]), orange: z(t[1]), rot: z(t[2] ?? null),
      })
    }
  }
  return { kosten, schwellen }
}

const MONATE = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'] as const

export type KennzahlZeile = {
  linaBetriebId: string
  betriebName: string
  monat: string
  kennzahl: string
  wert: number | null
}

/**
 * getKennzahlen ist dreistufig: Konzept > Betrieb > 5 feste Kennzahlen.
 *
 * Dedupliziert über den Betriebsschlüssel. Erwartung ist, dass jeder Betrieb
 * genau einmal vorkommt — der Name "Karlsruhe" taucht zwar in fünf
 * Konzeptgruppen auf, aber das sind fünf verschiedene Restaurants mit fünf
 * verschiedenen Schlüsseln. Die Deduplizierung ist trotzdem drin: träte
 * derselbe Schlüssel doch zweimal auf, vervielfachten sich die Werte still,
 * und das fiele erst am fertigen Round Table auf.
 */
export function kennzahlen(daten: any, jahr: number): KennzahlZeile[] {
  const gesehen = new Set<string>()
  const raus: KennzahlZeile[] = []

  for (const gruppe of daten?.groups ?? []) {
    for (const betrieb of gruppe.children ?? []) {
      if (gesehen.has(betrieb.key)) continue
      gesehen.add(betrieb.key)

      for (const kz of betrieb.children ?? []) {
        const name = kz?.data?.name
        if (!name) continue
        MONATE.forEach((m, i) => {
          const wert = z(kz.data[m])
          if (wert === null) return
          raus.push({
            linaBetriebId: betrieb.key,
            betriebName: betrieb.data?.name ?? '',
            monat: `${jahr}-${String(i + 1).padStart(2, '0')}-01`,
            kennzahl: name,
            wert,
          })
        })
      }
    }
  }
  return raus
}

export type StundeZeile = { encId: string; geschaeftstag: string; stunde: number; umsatzNetto: number | null }

/**
 * Der Geschäftstag läuft 08:00–07:59. Die Stunden 0–7 gehören fachlich zum
 * Vortag — genau das sagt LINAs hours-Array [8,9,…,23,0,…,7] aus.
 */
export function zeitzonenbericht(daten: any, kalendertag: string): StundeZeile[] {
  const raus: StundeZeile[] = []
  for (const s of daten?.stores ?? []) {
    for (const [stundeStr, wert] of Object.entries(s.hours ?? {})) {
      const stunde = Number(stundeStr)
      raus.push({
        encId: s.encId,
        geschaeftstag: geschaeftstagFuerStunde(kalendertag, stunde),
        stunde,
        umsatzNetto: z(wert),
      })
    }
  }
  return raus
}

export type ZoneZeile = { encId: string; geschaeftstag: string; linaZoneId: number; umsatzNetto: number | null }

export function vordefinierteZeitzonen(daten: any, geschaeftstag: string): ZoneZeile[] {
  const raus: ZoneZeile[] = []
  for (const s of daten?.stores ?? []) {
    for (const [zoneStr, wert] of Object.entries(s.values ?? {})) {
      raus.push({ encId: s.encId, geschaeftstag, linaZoneId: Number(zoneStr), umsatzNetto: z(wert) })
    }
  }
  return raus
}

export type ArtikelStamm = { artikelnummer: number; name: string; fixerWe: number | null }
export type ArtikelverkaufZeile = {
  encId: string; geschaeftstag: string; artikelnummer: number
  menge: number | null; umsatzNetto: number | null; umsatzBrutto: number | null; verkaufspreis: number | null
}

/**
 * Die größte Antwort (~2 MB). counts/netto/brutto/prices sind Maps
 * artikelnummer → Wert. Artikel ohne Verkauf werden übersprungen — sonst
 * entstünden 141 × 6.451 Zeilen pro Tag statt der tatsächlich verkauften.
 */
export function artikelverkauf(daten: any, geschaeftstag: string): {
  stamm: ArtikelStamm[]
  zeilen: ArtikelverkaufZeile[]
} {
  const stamm: ArtikelStamm[] = (daten?.columns ?? []).map((c: any) => ({
    artikelnummer: Number(c.artnr), name: String(c.name ?? ''), fixerWe: z(c.fixed_we),
  }))

  const zeilen: ArtikelverkaufZeile[] = []
  for (const r of daten?.rows ?? []) {
    const counts = r.counts ?? {}
    for (const [nr, menge] of Object.entries(counts)) {
      const m = z(menge)
      if (m === null || m === 0) continue
      zeilen.push({
        encId: r.encId,
        geschaeftstag,
        artikelnummer: Number(nr),
        menge: m,
        umsatzNetto: z(r.netto?.[nr]),
        umsatzBrutto: z(r.brutto?.[nr]),
        verkaufspreis: z(r.prices?.[nr]),
      })
    }
  }
  return { stamm, zeilen }
}

/** Betriebsstammdaten fallen bei jedem Umsatzbericht mit ab. */
export function betriebeAus(daten: any): { encId: string; name: string }[] {
  return (daten?.stores ?? daten?.rows ?? []).map((s: any) => ({ encId: s.encId, name: s.name }))
}
