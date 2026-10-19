/**
 * Die Bestellansicht der FoodNotify-Oberfläche lesen — der Ersatzweg für
 * Bestellungen, deren Positionsabruf scheitert (Migration `0135`).
 *
 * WARUM ES DIESEN WEG GIBT. Seit dem 31.08.2026 antwortet
 * `/api/10262/shop-order/{id}/change` (Bar Enchilada Augsburg) für jede
 * Bestellung, die den Artikel „Pickled Onions Gelb 3Kg Eimer" enthält, mit
 * HTTP 500 `NonUniqueResultException`. Die Oberfläche zeigt dieselben
 * Bestellungen vollständig an. Melden lässt sich der Fehler nicht, ohne die
 * Nutzung der internen Schnittstelle offenzulegen (Eugene, 19.10.2026) —
 * also liest der Importer in diesem Fall die Seite, die ein Mensch auch sähe.
 * Hergang: docs/foodnotify-http500.md, Nachtrag 19.10.2026.
 *
 * WAS DIE SEITE HERGIBT — gemessen an Bestellung 450 (API 634611, Oberfläche
 * 642118), 53 Positionen nebeneinander: Lieferanten-Artikelnummer, Menge,
 * Gebinde und Summe stimmen in 53 von 53 überein. Es fehlen der Inhalt je
 * Gebindestück (`unitQuantity`, z. B. 0,0324 kg je Tortilla) und die
 * Basiseinheit — damit auch Gesamtmenge und Preis je Kilo. Die ergänzt der
 * Lader aus früheren Schnittstellen-Positionen, nicht dieser Parser.
 *
 * WARUM KEINE BIBLIOTHEK UND WARUM SO STRENG — dieselbe Begründung wie in
 * src/ladenakte/html.ts: das Markup ist serverseitig gerendert und flach, und
 * ein Parser, der bei geändertem Markup still eine leere Liste liefert, wäre
 * genau der Fehler, aus dem die Geschichte dieses Projekts besteht. Jede
 * Unsicherheit wirft. Die Gegenprobe auf Vollständigkeit ist die Artikelzahl
 * des Bestellkopfs aus der Schnittstelle — sie macht der Lader, weil nur er
 * den Kopf kennt.
 */
import { ParseFehler } from '../ladenakte/html'

export type AnsichtPosition = {
  /** FoodNotifys Marktartikel (`products[]` der Zeile) — nicht die Ware im Warenstamm. */
  produktId: string
  name: string
  /** Lieferanten-Artikelnummer, dieselbe wie `core.bestellposition.lieferanten_nr`. */
  lieferantenNr: string | null
  /** Bestellte Gebinde. */
  menge: number
  /** Stück je Gebinde („200 x STÜ / KAR" → 200). */
  gebindeMenge: number
  /** Kürzel des Gebindes (KAR, FLA, EIM) — NICHT die Basiseinheit der Schnittstelle. */
  gebindeEinheit: string | null
  /** Preis je Gebinde laut Seite. */
  preis: number | null
  summe: number
  /** Die Zwischenüberschrift der Seite (z. B. „Bar 19%") — die Warengruppe des Lieferanten. */
  gruppe: string | null
}

export type Bestellansicht = {
  ansichtNr: string | null
  positionen: AnsichtPosition[]
  /** Brutto laut Seite, mit Pfand und Lieferkosten — keine Prüfsumme für die Zeilen. */
  gesamtsumme: number | null
}

/** HTML-Text einer Zelle: Tags weg, Entities, Leerraum zusammengezogen. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Deutsche Zahl: „1.587,37" und „14,335" — ein Punkt ist hier immer ein Tausendertrenner. */
export function deZahl(roh: string): number {
  const s = roh.replace(/[€\s]/g, '')
  if (!/^-?[\d.]*\d(,\d+)?$/.test(s)) throw new ParseFehler(`Bestellansicht: "${roh}" ist keine Zahl`)
  return Number(s.replace(/\./g, '').replace(',', '.'))
}

function zelle(zeile: string, klasse: string): string | null {
  const m = zeile.match(new RegExp(`<td class="[^"]*\\b${klasse}\\b[^"]*">([\\s\\S]*?)</td>`))
  return m ? m[1] : null
}

/**
 * Die Seite /shop/{shopId}/orders/{nr} lesen.
 *
 * Wirft `ParseFehler`, wenn keine Positionszeile da ist, eine Zeile eine
 * Pflichtzelle nicht hat, eine Menge nicht dem Muster „N KÜRZEL (M x …)"
 * folgt oder eine Produkt-ID doppelt vorkommt.
 */
export function bestellansichtLesen(html: string): Bestellansicht {
  const titel = html.match(/class="order-title">\s*Bestellung#\s*(\d+)/)
  const tabelle = html.match(/<table class="order-products[\s\S]*?<\/table>/)
  if (!tabelle) throw new ParseFehler('Bestellansicht: keine Tabelle "order-products" — Seite geändert oder Fehlerseite')

  const positionen: AnsichtPosition[] = []
  const gesehen = new Set<string>()
  let gruppe: string | null = null
  for (const m of tabelle[0].matchAll(/<tr( class="([^"]*)"[^>]*)?>([\s\S]*?)<\/tr>/g)) {
    const klasse = m[2] ?? ''
    const inhalt = m[3]
    if (klasse.split(/\s+/).includes('product-category')) { gruppe = text(inhalt) || null; continue }
    if (!klasse.split(/\s+/).includes('product')) continue

    const id = inhalt.match(/name="products\[\]"\s+value="(\d+)"/)?.[1]
    const name = zelle(inhalt, 'product-name')
    const nummer = zelle(inhalt, 'product-article-no')
    const menge = zelle(inhalt, 'product-quantity')
    const summe = inhalt.match(/<span class="total">([^<]*)<\/span>/)?.[1]
    const preis = inhalt.match(/<span class="price">([^<]*)<\/span>/)?.[1]
    if (!id || name === null || menge === null || summe === undefined) {
      throw new ParseFehler(`Bestellansicht: Zeile ohne Pflichtzelle (id ${id ?? '—'}): ${text(inhalt).slice(0, 120)}`)
    }
    if (gesehen.has(id)) throw new ParseFehler(`Bestellansicht: Produkt ${id} steht zweimal auf der Seite`)
    gesehen.add(id)

    // „3 EIM (1 x EIM / Art. )" — Menge, Gebindekürzel, Stück je Gebinde.
    const mt = text(menge).match(/^([\d.,]+)\s+(\S+)\s*\(\s*([\d.,]+)\s*x\b/)
    if (!mt) throw new ParseFehler(`Bestellansicht: Menge "${text(menge)}" bei Produkt ${id} hat ein unbekanntes Muster`)

    const nameText = text(name.replace(/<p class="extra-info">[\s\S]*?<\/p>/, ''))
    const artNr = text(nummer ?? '').replace(/^#/, '').trim()
    positionen.push({
      produktId: id,
      name: nameText,
      lieferantenNr: artNr || null,
      menge: deZahl(mt[1]),
      gebindeEinheit: mt[2] || null,
      gebindeMenge: deZahl(mt[3]),
      preis: preis !== undefined ? deZahl(preis) : null,
      summe: deZahl(summe),
      gruppe,
    })
  }
  if (positionen.length === 0) throw new ParseFehler('Bestellansicht: Tabelle ohne eine einzige Position')

  // Die Gesamtsumme der Seite ist BRUTTO und enthaelt mehr als die Zeilen
  // (Pfand, Lieferkosten): an 645599 und 642118 nachgerechnet, verfehlte sie
  // Netto- wie Bruttosumme der Zeilen um 14,73 bzw. 48,08 EUR. Sie wird nur
  // mitgegeben — die Vollstaendigkeit prueft der Lader gegen die Artikelzahl
  // des Bestellkopfs (core.bestellung.artikel_anzahl).
  const gesamt = html.match(/<span class="shop-cart-total-all">([^<]*)<\/span>/)
  const gesamtsumme = gesamt ? deZahl(gesamt[1]) : null
  return { ansichtNr: titel?.[1] ?? null, positionen, gesamtsumme }
}
