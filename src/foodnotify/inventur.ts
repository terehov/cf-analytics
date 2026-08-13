/**
 * Inventuren (B1, Stufe 4 aus docs/plan-foodnotify.md) — reine Transformation.
 *
 * Eigene Datei statt eines Anbaus an transform.ts: eine zweite Session
 * arbeitet zeitgleich an transform.ts, mock.ts und transform.test.ts
 * (Bestellungen/Statuskorrektur). Diese Datei fasst nichts davon an.
 *
 * DESHALB DUPLIZIERT, NICHT IMPORTIERT: die kleinen Hilfsfunktionen unten
 * (alsObjekt, alsListe, alsZahl, alsText, alsBezeichnung, alsZeit) sind
 * dieselbe Familie wie in transform.ts, dort aber nicht exportiert. Sie
 * sind rein, kurz und stabil — die Duplikation kostet wenig und vermeidet
 * einen Merge-Konflikt in einer Datei, die gerade in Arbeit ist. Wer diese
 * Datei später aufräumt: beide Sätze zusammenführen und aus transform.ts
 * exportieren, sobald der Bestellungs-Umbau steht.
 *
 * Dieselbe Lehre wie bei core.bestellung.status (0043) gilt hier von
 * Anfang an: FoodNotify liefert Enums und Bezeichnungen gern als Objekt
 * ({"name": "signed"}), nicht als Zeichenkette. `String(obj)` ergäbe
 * "[object Object]" — deshalb läuft auch `art` (aus `type`) vorsorglich
 * durch `alsBezeichnung`, obwohl das für dieses Feld nie gemessen wurde:
 * die billigere Annahme ist, dass FoodNotify hier genauso inkonsistent
 * ist wie beim Bestellstatus, nicht dass es diesmal anders liefert.
 */
import { auspacken } from './huelle'

const alsObjekt = (x: unknown): Record<string, any> | null =>
  typeof x === 'object' && x !== null && !Array.isArray(x) ? x as Record<string, any> : null

const alsListe = (x: unknown): any[] => (Array.isArray(x) ? x : [])

const alsZahl = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

const alsText = (x: unknown): string | null =>
  x === null || x === undefined ? null : String(x)

/** Ein Objekt {name: "…"} wird zur Zeichenkette, kein [object Object]. */
const alsBezeichnung = (x: unknown): string | null => {
  const o = alsObjekt(x)
  return o ? alsText(o.name) : alsText(x)
}

/** ISO-Zeitstempel oder Unix-Sekunden — FoodNotify liefert beides. */
const alsZeit = (x: unknown): string | null => {
  if (x === null || x === undefined || x === '') return null
  if (typeof x === 'number') return new Date(x * 1000).toISOString()
  const o = alsObjekt(x)
  if (o && 'timestamp' in o) return alsZeit(o.timestamp)
  const d = new Date(String(x))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export type InventurZeile = {
  fnUuid: string
  erpId: number
  name: string | null
  art: string | null
  status: string | null
  anzahlPositionen: number | null
  notiz: string | null
  erstelltAm: string | null
  geaendertAm: string | null
}

export type InventurListe = {
  aktuelleSeite: number
  gesamtSeiten: number
  gesamt: number | null
  inventuren: InventurZeile[]
}

/**
 * /api/erp/stocktakings — Inventurköpfe ALLER Kostenstellen einer Marke,
 * seitenweise. `erpId` steht bei JEDEM Kopf einzeln dabei, obwohl der
 * Aufruf selbst mehrere Kostenstellen bündelt (erpIds[]) — daraus löst
 * das Laden (src/foodnotify/laden.ts) die Kostenstelle je Zeile auf,
 * nicht aus dem Posten-Parameter.
 *
 * Ohne `id` oder `erpId` fällt die Zeile heraus: ohne `id` gibt es keinen
 * Schlüssel für die Positionen, ohne `erpId` keine Kostenstelle — beides
 * macht die Zeile nicht speicherbar, kein Grund für einen Wurf.
 */
export function inventurListe(daten: unknown): InventurListe {
  const a = auspacken(daten)
  const inventuren = alsListe(a.daten).flatMap(e => {
    const o = alsObjekt(e); if (!o) return []
    const fnUuid = alsText(o.id)
    const erpId = alsZahl(o.erpId)
    if (!fnUuid || erpId === null) return []
    return [{
      fnUuid, erpId,
      name: alsText(o.name),
      art: alsBezeichnung(o.type),
      status: alsBezeichnung(o.status),
      anzahlPositionen: alsZahl(o.totalNumberOfItems),
      notiz: alsText(o.note),
      erstelltAm: alsZeit(o.createdAt),
      geaendertAm: alsZeit(o.timeModified),
    }]
  })
  return {
    aktuelleSeite: a.seiten?.aktuelleSeite ?? 1,
    gesamtSeiten: a.seiten?.gesamtSeiten ?? 1,
    gesamt: a.seiten?.gesamt ?? null,
    inventuren,
  }
}

export type InventurpositionZeile = {
  fnId: string | null
  name: string
  shopName: string | null
  basisEinheit: string | null
  sollMenge: number | null
  gezaehlteMenge: number | null
  nachzaehlungMenge: number | null
  preisJeBasiseinheit: number | null
  /**
   * shopArticleId — eine LIEFERANTEN-Artikelnummer, dieselbe Art Schlüssel
   * wie core.zutat.ware_fn_id und core.bestellposition.lieferanten_nr.
   * Zeigt auf core.ware (quelle='lieferant'), NICHT auf core.artikel
   * (plan-foodnotify.md, Warnung um Zeile 146).
   */
  lieferantenNr: string | null
}

export type InventurpositionSeite = {
  aktuelleSeite: number
  gesamtSeiten: number
  gesamt: number | null
  positionen: InventurpositionZeile[]
}

/**
 * /api/erp/stocktakings/{uuid}/items — die Zählung. Ein Element ohne
 * `name` ist keine Position, sondern ein kaputter Datensatz.
 *
 * GIBT SEIT DEM 13.08.2026 DIE SEITENANGABE MIT ZURÜCK, und das ist der
 * eigentliche Punkt dieser Funktion. Vorher lieferte sie eine nackte Liste:
 * `auspacken()` las die `pagination` korrekt aus, und der Rückgabewert warf
 * sie weg. Damit war nirgends mehr ablesbar, dass es eine zweite Seite gibt —
 * neun Inventuren endeten bei exakt 800 Positionen, ohne Fehler, ohne Log.
 *
 * Dieselbe Form wie `inventurListe()` gleich darüber, damit das Laden beide
 * gleich behandeln kann: wer eine Seite bekommt, muss auch erfahren, die
 * wievielte von wie vielen es war.
 */
export function inventurpositionen(daten: unknown): InventurpositionSeite {
  const a = auspacken(daten)
  const positionen = alsListe(a.daten).flatMap(e => {
    const o = alsObjekt(e); if (!o) return []
    const name = alsText(o.name)
    if (!name) return []
    return [{
      fnId: alsText(o.id),
      name,
      shopName: alsText(o.shopName),
      basisEinheit: alsText(o.baseUnit),
      sollMenge: alsZahl(o.theoreticalStockLevelInBaseUnits),
      gezaehlteMenge: alsZahl(o.countedAmountInBaseUnits),
      nachzaehlungMenge: alsZahl(o.reviewAmountInBaseUnits),
      preisJeBasiseinheit: alsZahl(o.pricePerBaseUnit),
      lieferantenNr: alsText(o.shopArticleId),
    }]
  })
  return {
    aktuelleSeite: a.seiten?.aktuelleSeite ?? 1,
    gesamtSeiten: a.seiten?.gesamtSeiten ?? 1,
    gesamt: a.seiten?.gesamt ?? null,
    positionen,
  }
}
