/**
 * Reine Transformationen: FoodNotify-Antwort → Zeilen für core.
 *
 * Dieselbe Regel wie bei src/transform/index.ts: keine Datenbank, kein
 * Netz, keine Uhr — nur Antwort rein, Zeilen raus. Die Feldnamen stammen
 * aus der Erhebung vom 27.07.2026 (docs/foodnotify-api-inventar.md §4);
 * fehlende Felder werden zu null, nie zu einem Wurf. Was die echte Antwort
 * anders macht, fällt über die Leere-200er-Regel und die Zeilenzahlen auf —
 * und raw behält ohnehin alles.
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

/**
 * EIN STATUS IST EIN OBJEKT, KEINE ZEICHENKETTE.
 *
 * `shopOrderStatus` kommt als `{"name": "canceled"}`. Die erste Fassung
 * las ihn mit `alsText`, und `String({name:'canceled'})` ergibt
 * `[object Object]` — in ALLEN 44.271 Bestellungen, seit dem ersten Lauf.
 * Gemessen am 04.08.2026 im Rohbestand: 26.703 imported, 15.893 pending,
 * 1.561 canceled, 41 accepted, 15 finished. Nichts davon war in `core`
 * zu sehen; die 1.561 Stornos (2,49 Mio EUR) zaehlten im Einkaufsvolumen
 * mit wie jede andere Bestellung.
 *
 * Lautlos war es aus demselben Grund wie beim `amount`-Fehler weiter
 * unten: die Attrappe bildete das Feld als Zeichenkette nach, weil es im
 * Inventar so notiert war. Der Test war gruen, der Bestand falsch.
 * `mock.ts` traegt jetzt die echte Form.
 *
 * Ein Objekt OHNE `name` ergibt `null`, nicht `[object Object]`: eine
 * fehlende Angabe faellt beim Nachzaehlen auf, eine erfundene nicht.
 * Zeichenketten bleiben erlaubt — sollte FoodNotify je flach liefern.
 */
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

/** Nur das Datum. */
const alsDatum = (x: unknown): string | null => {
  const z = alsZeit(x)
  return z ? z.slice(0, 10) : null
}

/**
 * bar | kueche | sonstige aus dem Kostenstellennamen — als VORSCHLAG.
 *
 * Gemessen an Aposto: 26 von 27 Namen beginnen oder enden mit Bar/Küche,
 * der Testbetrieb nicht. Deshalb bleibt art_bestaetigt false, bis ein
 * Mensch draufgesehen hat (Plan A1: „manuell bestätigt").
 */
export function artAbleiten(name: string): 'bar' | 'kueche' | 'sonstige' {
  const n = name.trim().toLowerCase()
  if (/^bar\b/.test(n) || /\bbar$/.test(n)) return 'bar'
  if (/^k(ü|ue)che\b/.test(n) || /\bk(ü|ue)che$/.test(n)) return 'kueche'
  return 'sonstige'
}

export type KostenstelleZeile = {
  erpId: number
  kostenstelleId: number
  restaurantId: number | null
  name: string
  restaurantName: string | null
  art: 'bar' | 'kueche' | 'sonstige'
}

/** /api/erp/all — die drei Schlüsselebenen im Zusammenhang. */
export function kostenstellen(daten: unknown): KostenstelleZeile[] {
  const inhalt = alsListe(auspacken(daten).daten)
  return inhalt.flatMap(e => {
    const o = alsObjekt(e); if (!o) return []
    const ks = alsObjekt(o.costCenter); if (!ks) return []
    const erpId = alsZahl(o.id); const ksId = alsZahl(ks.id)
    if (erpId === null || ksId === null) return []
    const name = alsText(ks.name) ?? ''
    return [{
      erpId, kostenstelleId: ksId,
      restaurantId: alsZahl(alsObjekt(ks.restaurant)?.id),
      // NICHT trimmen: der Rohwert ist der Beleg (Kommentar an core.kostenstelle).
      name,
      restaurantName: alsText(alsObjekt(ks.restaurant)?.name),
      art: artAbleiten(name),
    }]
  })
}

export type PosStandortZeile = {
  kostenstelleId: number
  connectionId: number | null
  kassensystem: string | null
}

/** /api/pos/locations — Kassenanbindung je Kostenstelle. */
export function posStandorte(daten: unknown): PosStandortZeile[] {
  const inhalt = alsObjekt(auspacken(daten).daten)
  return alsListe(inhalt?.locations).flatMap(e => {
    const o = alsObjekt(e); if (!o) return []
    const ksId = alsZahl(o.costCenterId)
    if (ksId === null) return []
    const verbindung = alsObjekt(o.connection)
    return [{
      kostenstelleId: ksId,
      connectionId: alsZahl(verbindung?.connectionId),
      kassensystem: alsText(alsObjekt(verbindung?.deviceType)?.name),
    }]
  })
}

export type BestellungZeile = {
  fnId: string
  bestellnummer: string | null
  bestelltAm: string | null
  status: string | null
}

export type Bestellliste = {
  aktuelleSeite: number
  gesamtSeiten: number
  gesamt: number | null
  bestellungen: BestellungZeile[]
}

/** /api/{erpId}/shop-order/paginate — eine Seite der Bestellliste. */
export function bestellliste(daten: unknown): Bestellliste {
  const a = auspacken(daten)
  const bestellungen = alsListe(a.daten).flatMap(e => {
    const o = alsObjekt(e); if (!o) return []
    const fnId = alsText(o.id)
    if (!fnId) return []
    return [{
      fnId,
      bestellnummer: alsText(o.orderNumber),
      bestelltAm: alsZeit(o.timeCreated),
      status: alsBezeichnung(o.shopOrderStatus),
    }]
  })
  return {
    aktuelleSeite: a.seiten?.aktuelleSeite ?? 1,
    gesamtSeiten: a.seiten?.gesamtSeiten ?? 1,
    gesamt: a.seiten?.gesamt ?? null,
    bestellungen,
  }
}

export type Bestellkopf = {
  bestellnummer: string | null
  status: string | null
  bestelltAm: string | null
  geliefertAm: string | null
  summe: number | null
  kommentar: string | null
  lieferant: { fnId: string; name: string } | null
  belegNummer: string | null
  belegDatum: string | null
}

/** /api/{erpId}/shop-order/{orderId} — der Kopf mit Beleg und Lieferant. */
export function bestellkopf(daten: unknown): Bestellkopf {
  const o = alsObjekt(auspacken(daten).daten) ?? {}
  const laden = alsObjekt(o.markedShop)
  const shopOrder = alsObjekt(o.markedShopOrder)
  // Die Rechnungen haengen an der Bestellung — die erste traegt den Beleg.
  const rechnung = alsObjekt(alsListe(o.shopOrderInvoices)[0])
  const lieferantId = alsText(laden?.shopId ?? laden?.id)
  return {
    bestellnummer: alsText(o.orderNumber),
    status: alsBezeichnung(o.shopOrderStatus),
    bestelltAm: alsZeit(o.timeCreated),
    geliefertAm: alsDatum(shopOrder?.deliveryDate),
    summe: alsZahl(shopOrder?.total),
    kommentar: alsText(o.comment),
    lieferant: laden && lieferantId
      ? { fnId: lieferantId, name: alsText(laden.name) ?? lieferantId }
      : null,
    belegNummer: alsText(rechnung?.invoiceNumber),
    belegDatum: alsDatum(rechnung?.invoiceDate),
  }
}

export type BestellpositionZeile = {
  fnId: string | null
  wareFnId: string | null
  wareName: string | null
  name: string
  menge: number | null
  gebindeMenge: number | null
  einheit: string | null
  gesamtMenge: number | null
  einzelpreis: number | null
  summePreis: number | null
  neuerPreis: number | null
  preisAbweichend: boolean
  ersetzt: boolean
  /**
   * Der Preis je Basiseinheit (Liter, Kilo, Stück) — die Zahl, um die es
   * bei der ganzen Anbindung geht. Steht hier und nicht erst in der
   * Mart-Sicht, damit auch `core` sie trägt und jede spätere Auswertung
   * dieselbe Zahl sieht.
   *
   * `null`, wenn sie nicht verlässlich zu bilden ist — siehe
   * `mengeUnstimmig` unten. Eine fehlende Zahl ist besser als eine
   * erfundene.
   */
  preisJeEinheit: number | null
  /**
   * FoodNotify meldet die Gebindegröße derselben Ware uneinheitlich.
   *
   * Gemessen am 03.08.2026 an 310.761 Positionen: `totalUnitQuantity`
   * entspricht in 310.032 Fällen `menge × packagingQuantity ×
   * unitQuantity`. Bei 2.116 von 20.750 Waren steht `packagingQuantity`
   * aber mal auf 50 und mal auf 1 — derselbe Kaffee, dieselbe Bestellung.
   * Steht dort 1, ist `totalUnitQuantity` um den Faktor des Gebindes zu
   * klein, und der Preis je Einheit wird entsprechend zu groß: 48.400 €/kg
   * statt 48,40 €/kg.
   *
   * Ist das erkennbar, wird die Menge aus `menge × pack × unitQuantity`
   * REKONSTRUIERT. Bleibt es unstimmig, steht hier `true` und
   * `preisJeEinheit` auf `null`.
   */
  mengeUnstimmig: boolean
  /**
   * Warennummer des LIEFERANTEN (`ingredient.artikelId`).
   *
   * Der Rückfall, wenn FoodNotify keine `concreteProduct.id` liefert: das
   * betrifft 55.408 Positionen (18 %), von denen 55.232 diese Nummer
   * tragen. Es ist dieselbe Nummer, über die Stufe 0.1 den Warenstamm
   * verknüpft hat — ohne sie bliebe fast jede fünfte Position ohne Ware.
   */
  lieferantenNr: string | null
}

/**
 * NULL IST NULL, AUCH WENN 4,44e-16 DASTEHT.
 *
 * FoodNotify rechnet `adjustedQuantity` offenbar als Differenz zweier
 * Fliesskommazahlen. Kommt dabei glatt null heraus, steht in der Antwort
 * nicht 0, sondern der Rest der Rundung: 4,4408920985006262e-16.
 *
 * Das ist keine Menge, und in JavaScript ist es auch keine Null — es ist
 * `truthy`, rutscht also durch jede `menge &&`-Pruefung. Danach wird durch
 * ein Zehnbilliardstel geteilt: `156,44 / 4,44e-16` = 3,5 · 10^17. In
 * `numeric(14,6)` passt das nicht, Postgres bricht die GANZE Bestellung ab
 * („numeric field overflow"), und der Posten landet im Backoff. Am
 * 03.08.2026 hingen vier Bestellungen mit bis zu neun Versuchen daran.
 *
 * Die Grenze ist 1e-6: darunter liegt keine Bestellmenge, die jemand
 * aufgibt, und genau so weit rundet der Rest dieser Datei ohnehin.
 */
const MENGE_MIN = 1e-6
const nullFalls0 = (v: number | null) =>
  v !== null && Math.abs(v) >= MENGE_MIN ? v : null

/**
 * Ein Quotient, der in die Spalte passt — oder gar keiner.
 *
 * Zweite Verteidigungslinie hinter `nullFalls0`. Der Nenner ist nicht die
 * einzige Art, wie eine Zahl zu gross werden kann (ein einzelner Cent auf
 * ein Milligramm ist rechnerisch korrekt und trotzdem kein Preis), und ein
 * Ueberlauf reisst nicht die Position mit, sondern die ganze Bestellung
 * samt Kopf: es ist EINE Transaktion.
 *
 * `numeric(14,6)` traegt acht Vorkommastellen. Passt es nicht, bleibt das
 * Feld leer — eine fehlende Zahl ist besser als ein abgebrochener Import,
 * und die Position steht mit ihrer Menge weiterhin da.
 */
const PREIS_MAX = 1e8
const jeEinheit = (zaehler: number | null, nenner: number | null): number | null => {
  if (zaehler === null || nenner === null || nenner === 0) return null
  const wert = Math.round((zaehler / nenner) * 1e6) / 1e6
  return Number.isFinite(wert) && Math.abs(wert) < PREIS_MAX ? wert : null
}

/**
 * /api/{erpId}/shop-order/{orderId}/change — die Positionen.
 *
 * ZUR MENGE: `adjustedQuantity`, NICHT `amount`.
 *
 * Am 02.08.2026 an 13.126 echten Positionen gemessen: `amount` ist
 * AUSNAHMSLOS 0, `adjustedQuantity` ausnahmslos gesetzt. Die erste Fassung
 * las `amount` — dadurch blieb der Stückpreis in allen Positionen `NULL`
 * (Division durch 0 wird abgefangen), und die Mengenspalte stand auf null.
 * Aufgefallen ist es erst beim Nachzählen im Bestand, nicht beim Testen:
 * die Attrappe bildete `amount` nach, weil das Feld im Inventar so notiert
 * war. `amount` bleibt als Rückfall stehen — sollte FoodNotify es eines
 * Tages füllen, ist es die genauere Angabe.
 *
 * ZUR ERSETZUNG: `isSubstituted` ist in allen 13.155 Positionen `null`,
 * das Feld trägt nichts. Ersatz erkennt man an `status`: 'not arrived'
 * heißt nicht geliefert. Die Spalte heißt deshalb weiterhin `ersetzt`,
 * meint aber das, was messbar ist.
 */
export function bestellpositionen(daten: unknown): BestellpositionZeile[] {
  return alsListe(auspacken(daten).daten).flatMap(e => {
    const o = alsObjekt(e); if (!o) return []
    const zuordnung = alsObjekt(o.shopOrderMappingProduct)
    const ware = alsObjekt(zuordnung?.concreteProduct)
    const name = alsText(zuordnung?.name) ?? alsText(ware?.name)
    if (!name) return []
    // adjustedQuantity zuerst — amount ist im Echtbestand immer 0.
    const menge = nullFalls0(alsZahl(o.adjustedQuantity)) ?? alsZahl(o.amount)
    const summe = alsZahl(o.sumPrice)
    const gebinde = alsZahl(zuordnung?.packagingQuantity)
    const inhalt = alsZahl(zuordnung?.unitQuantity)
    const gemeldet = alsZahl(o.totalUnitQuantity)

    /**
     * DIE GESAMTMENGE PRÜFEN, NICHT ÜBERNEHMEN.
     *
     * Erwartet wird `menge × Gebinde × Inhalt`. Stimmt die gemeldete Zahl
     * damit überein, ist sie belastbar. Weicht sie ab, gilt die gerechnete
     * — sie stützt sich auf drei Felder statt auf eines, und in 310.032
     * von 310.761 Fällen sind sich beide einig.
     *
     * Lässt sich nichts rechnen (Gebinde oder Inhalt fehlen), bleibt die
     * gemeldete Zahl stehen, aber der Preis je Einheit wird verweigert:
     * ohne zweite Quelle ist nicht zu unterscheiden, ob 0,00035 kg eine
     * Kaffeeportion oder ein Datenfehler ist.
     */
    const gerechnet = menge !== null && gebinde !== null && inhalt !== null
      ? Math.round(menge * gebinde * inhalt * 1e6) / 1e6
      : null
    const stimmtUeberein = gerechnet !== null && gemeldet !== null
      && Math.abs(gerechnet - gemeldet) < 0.001
    const gesamtMenge = gerechnet !== null && gerechnet > 0 ? gerechnet : gemeldet
    const mengeUnstimmig = gerechnet === null
      ? gemeldet === null || gemeldet <= 0
      : !stimmtUeberein && (gemeldet === null || gemeldet <= 0)

    return [{
      fnId: alsText(o.id),
      wareFnId: alsText(ware?.id),
      wareName: alsText(ware?.name),
      name,
      menge,
      gebindeMenge: gebinde,
      einheit: alsText(alsObjekt(zuordnung?.unit)?.name),
      gesamtMenge,
      // Der Stueckpreis steht nicht in der Antwort — er ist Summe je Menge.
      einzelpreis: jeEinheit(summe, menge),
      // Der Preis je Basiseinheit: nur, wenn die Menge belastbar ist.
      preisJeEinheit: !mengeUnstimmig && gesamtMenge && gesamtMenge > 0
        ? jeEinheit(summe, gesamtMenge) : null,
      mengeUnstimmig,
      lieferantenNr: alsText(
        alsObjekt(alsObjekt(alsObjekt(o.shopOrderProduct)?.product)?.ingredient)?.artikelId),
      summePreis: summe,
      neuerPreis: alsZahl(o.newPrice),
      preisAbweichend: o.isNotEqualSumPrice === true,
      ersetzt: o.isSubstituted === true || o.status === 'not arrived',
    }]
  })
}
