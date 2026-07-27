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
import { geschaeftstagFuerStunde, ausLinaEpoch, linaEpochAlsDatum } from '../lib/time'

/** Prozentwerte immer als Prozentzahl. LINAs diff ist bereits Prozent. */
const z = (v: unknown): number | null =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v)

/** Obergrenze von int4 — die Breite der Anzahl-Spalten in core. */
const INT4_MAX = 2_147_483_647

/**
 * Anzahlen (Rechnungen, Gäste). Alles, was keine Anzahl sein KANN, wird zu
 * null — nicht zu einer Zahl, die zufällig in die Spalte passt.
 *
 * Anlass, 27.07.2026: Vier Tage im Oktober 2018 brachen den Import ab mit
 * `value "3010725105" is out of range for type integer`. Die vier Werte
 * lagen alle zwischen 3,0 und 3,9 Milliarden — also im oberen Bereich von
 * uint32 und damit im Muster einer ID, nicht einer Anzahl. Ein Betrieb hat
 * an einem Tag keine drei Milliarden Gäste.
 *
 * Die naheliegende Reparatur wäre gewesen, die Spalten auf bigint zu
 * verbreitern. Das wäre falsch: Der Wert passte danach zwar, würde aber als
 * Gästezahl gelten und jeden Durchschnitt in mart über den Haufen werfen —
 * still, und rückwirkend nicht mehr erkennbar. Ein zu schmaler Datentyp war
 * hier nicht das Problem, sondern der einzige Grund, warum es überhaupt
 * aufgefallen ist.
 *
 * Deshalb: unplausibel → null, und der verworfene Wert wandert in
 * `verworfen`, damit er in sync.schema_abweichung landet statt zu
 * verschwinden. Der Umsatz des Tages bleibt erhalten; nur die Anzahl fehlt.
 */
const anzahl = (v: unknown): { wert: number | null; verworfen: number | null } => {
  const n = z(v)
  if (n === null) return { wert: null, verworfen: null }
  if (!Number.isInteger(n) || n < 0 || n > INT4_MAX) return { wert: null, verworfen: n }
  return { wert: n, verworfen: null }
}

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
  /**
   * Werte, die als Anzahl unmöglich sind und deshalb NICHT übernommen
   * wurden. Leer im Normalfall; sonst Futter für sync.schema_abweichung.
   */
  verworfen?: { feld: string; wert: number }[]
}

export function umsatzbericht(
  daten: any, geschaeftstag: string, hauptspartePosId: number | null = null,
): UmsatzZeile[] {
  return (daten?.stores ?? []).map((s: any) => {
    const rechnungen = anzahl(s.bills)
    const gaeste = anzahl(s.guests)
    const verworfen: { feld: string; wert: number }[] = []
    if (rechnungen.verworfen !== null) verworfen.push({ feld: 'bills', wert: rechnungen.verworfen })
    if (gaeste.verworfen !== null) verworfen.push({ feld: 'guests', wert: gaeste.verworfen })

    return {
      encId: s.encId,
      geschaeftstag,
      hauptspartePosId,
      umsatzNetto: z(s.umsatzNetto),
      umsatzBrutto: z(s.umsatzBrutto),
      rechnungen: rechnungen.wert,
      gaeste: gaeste.wert,
      durchschnittsbon: z(s.avgTicket),
      umsatzProGast: z(s.avgGuest),
      ...(verworfen.length ? { verworfen } : {}),
    }
  })
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
/**
 * Die Marken selbst, aus `analyticsFilterOptions.gruppen`.
 *
 * LINA nennt sie im Filter „Konzepte" und in der API `gruppen` — 14 Stück.
 * Es muss also nichts aus Betriebsnamen geraten werden.
 */
export function konzepte(daten: any): { linaGruppenId: number; name: string }[] {
  const raus = new Map<number, string>()
  for (const g of daten?.gruppen ?? []) {
    const id = Number(g?.id)
    const name = String(g?.name ?? '').trim()
    // `> 0`, nicht `isFinite`: Number(null) ist 0 und damit endlich — dieselbe
    // Falle wie bei betriebeMitLinaId.
    if (id > 0 && name) raus.set(id, name)
  }
  return [...raus].map(([linaGruppenId, name]) => ({ linaGruppenId, name }))
}

/**
 * Welcher Betrieb zu welcher Marke gehört — aus `getKennzahlen`.
 *
 * Das ist der einzige Endpunkt, der die Zuordnung überhaupt hergibt: er
 * liefert dreistufig Konzept → Betrieb → Kennzahl. `analyticsFilterOptions`
 * kennt die Marken, aber nicht, wer dazugehört.
 *
 * Verbunden wird über Zahlen, nicht über Namen. Der Gruppenschlüssel heißt
 * dort `group_4`, und die 4 ist dieselbe `id`, die `analyticsFilterOptions`
 * meldet — am 26.07.2026 für alle 14 Gruppen gegengeprüft. Der Kindschlüssel
 * ist die numerische LINA-Betriebs-ID, also `core.betrieb.lina_betrieb_id`.
 *
 * Nachgemessen an der echten Antwort: 131 Zuordnungen auf 131 Betriebe,
 * **keiner in mehreren Gruppen**. Damit ist die seit `datenmodell.md`
 * offene Frage beantwortet — die Zuordnung ist faktisch 1:n. Die n:m-Tabelle
 * bleibt trotzdem: sie kostet nichts, und eine 1:n-Spalte, die einen echten
 * Mehrfachfall nicht abbilden kann, kostet eine Migration unter Zeitdruck.
 */
export function betriebKonzepte(daten: any): { linaGruppenId: number; linaBetriebId: number }[] {
  const raus: { linaGruppenId: number; linaBetriebId: number }[] = []
  const gesehen = new Set<string>()

  for (const gruppe of daten?.groups ?? []) {
    // 'group_4' -> 4. Passt das Muster nicht, wird die Gruppe übersprungen
    // statt geraten: eine falsche Markenzuordnung fährt in jeder Auswertung
    // mit, ohne sich zu zeigen.
    const treffer = /^group_(\d+)$/.exec(String(gruppe?.key ?? ''))
    if (!treffer) continue
    const linaGruppenId = Number(treffer[1])

    for (const betrieb of gruppe.children ?? []) {
      const linaBetriebId = Number(betrieb?.key)
      if (!(linaBetriebId > 0)) continue
      const schluessel = `${linaGruppenId}:${linaBetriebId}`
      if (gesehen.has(schluessel)) continue
      gesehen.add(schluessel)
      raus.push({ linaGruppenId, linaBetriebId })
    }
  }
  return raus
}

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

export type AktionStamm = {
  linaId: number; name: string; gueltigVon: string | null; gueltigBis: string | null
}
export type AktionsumsatzZeile = {
  encId: string; geschaeftstag: string; linaAktionId: number
  umsatzNetto: number | null; umsatzBrutto: number | null; anteilPct: number | null
}

/**
 * Der Aktionsbericht ist eine Kreuztabelle: Betriebe in den Zeilen, Aktionen
 * in den Spalten. Der Schlüssel einer Zelle ist die `id` aus `aktionen`.
 *
 * **Der Wert einer Zelle ist ein OBJEKT, keine Zahl:**
 *
 *     "cells": {"12": {"revenue": 798.15, "percent": 8.73}}
 *
 * Die erste Fassung nahm eine blosse Zahl an — gebaut gegen den einzigen Tag
 * im Bestand, an dem alle 423 Zellen auf `null` standen. Aus einer leeren
 * Antwort lässt sich die Struktur der gefüllten nicht ablesen. `Number({…})`
 * ist `NaN`, also wäre jede Zelle verworfen worden: null Zeilen bei Status
 * `ok`, genau der Ausfall, den diese Transformation beheben sollte.
 *
 * `percent` ist der Anteil am Netto-**Tages**umsatz des Betriebs. Nachgemessen
 * über alle 946 gefüllten Zellen gegen `core.umsatzbericht_tag`: 0 Abweichungen.
 * Übernommen wird trotzdem LINAs Wert — wer selbst rechnet, weicht irgendwann
 * in einem Randfall ab und merkt es nicht.
 *
 * Leere Zellen fallen weg, wie beim Artikelverkauf. Über 27 Tage gemessen:
 * 15.510 Zellen, davon 946 gefüllt.
 *
 * Netto oder brutto entscheidet `daten.brutto` — das Feld IN DER ANTWORT, nicht
 * unser Anfrageparameter. Wir fragen zwar immer mit `brutto=0`, aber wer sich
 * dabei auf die eigene Anfrage verlässt statt auf die Antwort, beschriftet
 * irgendwann Bruttowerte als netto, und das sieht man einer Zahl nicht an.
 */
export function aktionsbericht(daten: any, geschaeftstag: string): {
  aktionen: AktionStamm[]
  zeilen: AktionsumsatzZeile[]
} {
  const aktionen: AktionStamm[] = (daten?.aktionen ?? [])
    .map((a: any) => ({
      linaId: Number(a?.id),
      name: String(a?.name ?? ''),
      gueltigVon: linaEpochAlsDatum(a?.dateFrom),
      gueltigBis: linaEpochAlsDatum(a?.dateTo),
    }))
    // Dieselbe Prüfung wie bei betriebeMitLinaId: Number(null) ist 0 und damit
    // endlich. Eine Aktion 0 gibt es nicht, sie würde nur einen Namen belegen.
    .filter((a: AktionStamm) => Number.isFinite(a.linaId) && a.linaId > 0 && a.name !== '')

  const brutto = daten?.brutto === true
  const zeilen: AktionsumsatzZeile[] = []
  for (const r of daten?.rows ?? []) {
    for (const [idStr, zelle] of Object.entries(r?.cells ?? {})) {
      // Beobachtet ist nur die Objektform. Eine blosse Zahl wird trotzdem
      // angenommen — sie kostet eine Zeile und verhindert, dass eine
      // vereinfachte Antwort wieder still zu null Zeilen führt.
      const objekt = zelle !== null && typeof zelle === 'object'
      const w = z(objekt ? (zelle as any).revenue : zelle)
      if (w === null || w === 0) continue
      zeilen.push({
        encId: r.encId,
        geschaeftstag,
        linaAktionId: Number(idStr),
        umsatzNetto: brutto ? null : w,
        umsatzBrutto: brutto ? w : null,
        anteilPct: objekt ? z((zelle as any).percent) : null,
      })
    }
  }
  return { aktionen, zeilen }
}

/** Betriebsstammdaten fallen bei jedem Umsatzbericht mit ab. */
export function betriebeAus(daten: any): { encId: string; name: string }[] {
  return (daten?.stores ?? daten?.rows ?? []).map((s: any) => ({ encId: s.encId, name: s.name }))
}

// =======================================================================
// Stammdaten-Momentaufnahmen
//
// LINA ueberschreibt Stammdaten. Diese Funktionen erzeugen deshalb Zeilen
// fuer die *_stand-Tabellen, die je Monat fortgeschrieben werden -- nicht
// fuer eine Tabelle, die den letzten Stand haelt.
// =======================================================================

/**
 * LINA verpackt Warengruppen als "Weine (2900)": Name und ID in einem String.
 *
 * Getrennt gespeichert, sonst ist weder ein Join noch eine Umbenennung
 * moeglich — heisst die Gruppe naechstes Jahr "Weine & Sekt", waere sie sonst
 * eine andere Gruppe.
 *
 * Klammern koennen auch im Namen vorkommen ("Aktion (Sommer) (26500)"),
 * deshalb wird die LETZTE Klammergruppe genommen, nicht die erste.
 */
export function warengruppeAusText(v: unknown): { linaId: number; name: string } | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  const m = /^(.*)\((\d+)\)\s*$/.exec(t)
  if (!m) return { linaId: 0, name: t }
  const name = m[1].trim()
  return { linaId: Number(m[2]), name: name || t }
}

export type ArtikelWarengruppe = {
  artikelnummer: number
  gross: { linaId: number; name: string } | null
  mec: { linaId: number; name: string } | null
  detail: { linaId: number; name: string } | null
}

/**
 * Sortimentshierarchie je Artikel aus /wawi/rezept/articleApi.
 *
 * Verknuepft wird ueber `artnr`, NICHT ueber `id` — am 25.07.2026 gemessen:
 * artnr trifft die Artikelnummern des Verkaufsberichts, id trifft keine
 * einzige (id 19324 vs. artnr 300213, verschiedene Zahlenraeume).
 */
export function artikelWarengruppen(daten: any): ArtikelWarengruppe[] {
  const raus: ArtikelWarengruppe[] = []
  for (const a of daten?.articles ?? []) {
    const nr = z(a?.artnr)
    if (nr === null || nr === 0) continue
    raus.push({
      artikelnummer: nr,
      gross: warengruppeAusText(a.grosscat),
      mec: warengruppeAusText(a.mec),
      detail: warengruppeAusText(a.detailcat),
    })
  }
  return raus
}

/** Feinsparten aus analyticsFilterOptions — die dritte Sortimentsdimension. */
export function feinsparten(daten: any): { linaId: number; nummer: number | null; name: string }[] {
  return (daten?.feinsparten ?? [])
    .filter((f: any) => f && f.name)
    .map((f: any) => ({ linaId: Number(f.id), nummer: z(f.number), name: String(f.name) }))
    .filter((f: any) => Number.isFinite(f.linaId))
}

export type EinheitZeile = {
  linaId: number; name: string; abkuerzung: string | null
  parentLinaId: number | null; faktor: number | null; istBasis: boolean
}

export function einheiten(daten: any): EinheitZeile[] {
  return (Array.isArray(daten) ? daten : []).map((e: any) => ({
    linaId: Number(e.ID),
    name: String(e.name ?? ''),
    abkuerzung: e.abk ? String(e.abk) : null,
    parentLinaId: z(e.parent),
    faktor: z(e.factor),
    istBasis: e.baseUnit === true,
  })).filter(e => Number.isFinite(e.linaId))
}

export type LieferantZeile = {
  linaId: number; name: string | null; aktiv: boolean | null
  mindestbestellwert: number | null; liefertage: string | null
}

/**
 * Lieferanten — DATENMINIMIERUNG.
 *
 * Die Antwort hat 28 Felder, darunter ustid, hrb, kreditor, gegenkonto*,
 * tel, Fax, email, ort, strasse, hnr, plz, kdnr. Das sind Steuer-, Bank- und
 * Kontaktdaten von 540 Geschaeftspartnern, die fuer keine geplante Auswertung
 * gebraucht werden.
 *
 * Diese Funktion ist die Stelle, an der das durchgesetzt wird: Sie liest
 * fuenf Felder namentlich und reicht NICHTS durch, was sie nicht kennt. Kein
 * Spread, kein Restobjekt — ein `...rest` haette hier genau den gegenteiligen
 * Effekt. Wer eine Spalte ergaenzt, tut das bewusst und begruendet es.
 */
export function lieferanten(daten: any): LieferantZeile[] {
  return (Array.isArray(daten) ? daten : []).map((s: any) => ({
    linaId: Number(s.ID),
    name: s.name ? String(s.name) : null,
    aktiv: s.aktiv === undefined || s.aktiv === null ? null : Boolean(Number(s.aktiv)),
    mindestbestellwert: z(s.min_order_value),
    liefertage: s.dow ? String(s.dow) : null,
  })).filter(s => Number.isFinite(s.linaId))
}

export type WareZeile = {
  linaId: number; name: string; nummer: string | null
  gruppeLinaId: number | null; gruppeName: string | null
  einheitLinaId: number | null; hauptlieferantLinaId: number | null
  listenpreis: number | null; gebinde: number | null; gebindeEinheit: string | null
}

export type EinkaufspreisZeile = {
  wareLinaId: number; linaPreisId: number
  lieferantLinaId: number | null; einheitLinaId: number | null
  lieferantenArtnr: string | null; bestellart: string | null
  preis: number | null; menge: number | null; gebindeMenge: number | null
  basisFaktor: number | null; aktiv: boolean | null; geaendertAm: Date | null
}

/**
 * Waren und ihre Einkaufspreise aus /wawi/api/items.
 *
 * `prices` ist ein OBJEKT, dessen Schluessel die Preis-ID ist — ausser wenn
 * es leer ist, dann liefert PHPs json_encode ein `[]`. Am 25.07.2026
 * nachgemessen: 594 Waren mit Objekt, 304 mit leerem Array, kein einziger
 * gefuellter Array-Fall. Object.values() vertraegt beides, deshalb kein
 * Sonderzweig — aber der Grund gehoert notiert, sonst "vereinfacht" es
 * jemand zurueck.
 *
 * 299 der 898 Waren haben mehr als einen Lieferantenpreis. Deshalb zwei
 * getrennte Ergebnislisten statt eines Preisfeldes an der Ware.
 */
export function waren(daten: any): { waren: WareZeile[]; preise: EinkaufspreisZeile[] } {
  const w: WareZeile[] = []
  const preise: EinkaufspreisZeile[] = []

  for (const it of Array.isArray(daten) ? daten : []) {
    const linaId = Number(it?.id)
    if (!Number.isFinite(linaId)) continue

    w.push({
      linaId,
      name: String(it.name ?? ''),
      nummer: it.number ? String(it.number) : null,
      gruppeLinaId: z(it.groupId),
      gruppeName: it.groupName ? String(it.groupName) : null,
      einheitLinaId: z(it.unitId),
      hauptlieferantLinaId: z(it.supplierId),
      listenpreis: z(it.price),
      gebinde: z(it.ve),
      gebindeEinheit: it.ve_unit ? String(it.ve_unit) : null,
    })

    for (const p of Object.values(it.prices ?? {}) as any[]) {
      const pid = Number(p?.id)
      if (!Number.isFinite(pid)) continue
      preise.push({
        wareLinaId: linaId,
        linaPreisId: pid,
        lieferantLinaId: z(p.seller_id),
        einheitLinaId: z(p.unit_id),
        lieferantenArtnr: p.seller_sku ? String(p.seller_sku) : null,
        bestellart: p.ordertype ? String(p.ordertype) : null,
        preis: z(p.price),
        menge: z(p.qty),
        gebindeMenge: z(p.bulk_qty),
        basisFaktor: z(p.base_unit_mult),
        aktiv: p.active === undefined || p.active === null ? null : Boolean(Number(p.active)),
        // Unix-Sekunden. Nicht selbst rechnen — siehe src/lib/time.ts.
        geaendertAm: ausLinaEpoch(p.updated),
      })
    }
  }
  return { waren: w, preise }
}

export type BestellungZeile = {
  linaId: number; lieferantLinaId: number | null
  erstelltAm: Date | null; bestelltAm: Date | null; liefertermin: Date | null
  geliefert: boolean | null; status: number | null
  postenAnzahl: number | null; summe: number | null
  posten: { wareLinaId: number; einheitLinaId: number | null; wareName: string | null
            menge: number | null; einzelpreis: number | null }[]
}

export function bestellungen(daten: any): BestellungZeile[] {
  return (Array.isArray(daten) ? daten : []).map((b: any) => ({
    linaId: Number(b.bestellid),
    lieferantLinaId: z(b.lieferant),
    erstelltAm: ausLinaEpoch(b.created),
    bestelltAm: ausLinaEpoch(b.bestellt_am),
    liefertermin: ausLinaEpoch(b.liefertermin),
    geliefert: b.geliefert === undefined || b.geliefert === null ? null : Boolean(Number(b.geliefert)),
    status: z(b.status),
    postenAnzahl: z(b.articleCount),
    summe: z(b.articleSum),
    posten: (Array.isArray(b.posten) ? b.posten : [])
      .map((p: any) => ({
        wareLinaId: Number(p.ware),
        einheitLinaId: z(p.unit_id),
        wareName: p.wareName ? String(p.wareName) : null,
        menge: z(p.menge),
        einzelpreis: z(p.unitPrice),
      }))
      .filter((p: any) => Number.isFinite(p.wareLinaId)),
  })).filter(b => Number.isFinite(b.linaId))
}

/**
 * Inventurstichtage. Die Saetze liegen unter `data` (Huellenformat
 * {success, data, message, errorNum}).
 *
 * `date` ist als TAG gemeint, nicht als Zeitpunkt — deshalb ueber die
 * Berliner Wanduhr aufgeloest. 1486551600 ist dort der 08.02.2017, in UTC
 * aber noch der 07.02.
 */
export function inventurtermine(daten: any): { datum: string; bearbeitbar: boolean | null }[] {
  // Je Tag genau ein Ergebnis. LINA liefert denselben Stichtag mehrfach --
  // am 25.07.2026 waren es 11 Saetze auf nur 4 verschiedene Tage, teils
  // mit unterschiedlicher Uhrzeit (1429166941 und 1429135200 sind beide der
  // 16.04.2015), teils mit WIDERSPRUECHLICHEM isEditable (dreimal derselbe
  // Tag als true/false/false).
  //
  // Ohne diese Zusammenfassung scheitert der INSERT mit "ON CONFLICT DO
  // UPDATE command cannot affect row a second time" -- Postgres laesst
  // dieselbe Zeile nicht zweimal in EINEM Befehl anfassen.
  //
  // Zusammengefasst wird nach "bearbeitbar, wenn irgendeiner es sagt": Das
  // ist die Aussage, die fachlich zaehlt -- ein Stichtag, an dem noch
  // gebucht werden kann, ist offen, egal wie viele geschlossene Teilsaetze
  // daneben stehen.
  const jeTag = new Map<string, boolean | null>()
  for (const i of daten?.data ?? []) {
    const datum = linaEpochAlsDatum(i?.date)
    if (!datum) continue
    const b = i?.isEditable === undefined || i?.isEditable === null ? null : Boolean(i.isEditable)
    const bisher = jeTag.get(datum)
    jeTag.set(datum, bisher === true || b === true ? true : (bisher ?? b))
  }
  return [...jeTag].map(([datum, bearbeitbar]) => ({ datum, bearbeitbar }))
}

/**
 * Betriebe mit ihrer LINA-ID aus analyticsFilterOptions.
 *
 * Die fehlende Bruecke zwischen zwei Welten: Der Umsatzbericht kennt Betriebe
 * nur ueber `encId`, `getKennzahlen` nur ueber eine numerische ID. Ohne eine
 * Verbindung findet keine einzige BWA-Zeile ihren Betrieb -- am 26.07.2026
 * fielen so alle 7.860 Kennzahlenzeilen still durch den Filter, waehrend der
 * Posten `ok` meldete.
 *
 * `analyticsFilterOptions.betriebe` liefert {id, name} fuer alle 141 Betriebe
 * und benutzt DENSELBEN ID-Raum wie getKennzahlen (nachgemessen: 131 von 131
 * Schnittmenge; die 10 fehlenden sind die Einheiten ohne BWA-Zuordnung).
 *
 * Verbunden wird ueber den NAMEN, weil es nichts Besseres gibt: encId kommt in
 * dieser Antwort nicht vor. Nachgemessen sind die Namen auf beiden Seiten
 * eindeutig (141 von 141) und treffen vollstaendig. Sollte LINA je zwei
 * Betriebe gleich benennen, faellt das in mart.betrieb_ohne_lina_id auf, statt
 * still den falschen zu treffen.
 */
export function betriebeMitLinaId(daten: any): { linaId: number; name: string }[] {
  return (daten?.betriebe ?? [])
    .map((b: any) => ({ linaId: Number(b?.id), name: String(b?.name ?? '') }))
    // `> 0`, nicht `Number.isFinite`: Number(null) ist 0 und damit endlich —
    // ein Satz ohne ID rutschte sonst als Betrieb 0 durch und beanspruchte
    // einen Namen, der einem echten Betrieb gehört. LINAs Betriebs-IDs
    // beginnen bei 1 (beobachtet: 1 bis 5891).
    .filter((b: any) => Number.isFinite(b.linaId) && b.linaId > 0 && b.name !== '')
}
