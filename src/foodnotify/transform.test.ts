import { describe, expect, test } from 'bun:test'
import {
  artAbleiten, kostenstellen, posStandorte, bestellliste, bestellkopf, bestellpositionen,
} from './transform'

describe('artAbleiten', () => {
  test('Bar und Küche vorn oder hinten, mit und ohne Umlaut', () => {
    expect(artAbleiten('Bar Aposto Gera ')).toBe('bar')
    expect(artAbleiten('Küche Aposto Aschaffenburg ')).toBe('kueche')
    expect(artAbleiten('Kueche Aposto Aalen')).toBe('kueche')
    expect(artAbleiten('Aposto Aachen - Alte Post Bar')).toBe('bar')
  })
  test('der Testbetrieb bleibt sonstige — die Ableitung ist ein Vorschlag', () => {
    expect(artAbleiten('AAA Testbetrieb Aposto')).toBe('sonstige')
    // "Barbara" beginnt mit "Bar", ist aber keins — die Wortgrenze schützt.
    expect(artAbleiten('Barbara GmbH')).toBe('sonstige')
  })
})

describe('kostenstellen (/api/erp/all)', () => {
  const antwort = {
    errors: [], code: 200, isError: false,
    payload: [
      { id: 10483, costCenter: { id: 10920, name: 'Küche Aposto Gera ',
        restaurant: { id: 10436, name: 'Aposto Gera' } } },
      { id: null, costCenter: { id: 99, name: 'kaputt' } }, // ohne erpId: raus
    ],
  }
  test('liest die drei Schlüsselebenen und leitet die Art ab', () => {
    const ks = kostenstellen(antwort)
    expect(ks).toHaveLength(1)
    expect(ks[0]).toEqual({
      erpId: 10483, kostenstelleId: 10920, restaurantId: 10436,
      name: 'Küche Aposto Gera ', restaurantName: 'Aposto Gera', art: 'kueche',
    })
  })
  test('der Name bleibt UNGETRIMMT — der Rohwert ist der Beleg', () => {
    expect(kostenstellen(antwort)[0]!.name.endsWith(' ')).toBe(true)
  })
})

describe('posStandorte (/api/pos/locations)', () => {
  test('Kostenstellen mit und ohne Kasse', () => {
    const s = posStandorte({
      errors: [], code: 200, isError: false,
      payload: { userId: 18336, locations: [
        { costCenterId: 10920, connection: { connectionId: 1907, deviceType: { name: 'amadeus' } } },
        { costCenterId: 10669 },
      ] },
    })
    expect(s).toEqual([
      { kostenstelleId: 10920, connectionId: 1907, kassensystem: 'amadeus' },
      { kostenstelleId: 10669, connectionId: null, kassensystem: null },
    ])
  })
})

describe('bestellliste (paginate)', () => {
  test('Seitenzähler und Bestellungen aus der flachen Hülle', () => {
    const s = bestellliste({
      order_by: 'timeCreated', current_page: 3, page_count: 464, total_count: 11578,
      data: [{ id: 'b1', orderNumber: 'A-100', timeCreated: '2021-10-15T09:00:00+00:00',
               shopOrderStatus: { name: 'imported' } }],
    })
    expect(s.aktuelleSeite).toBe(3)
    expect(s.gesamtSeiten).toBe(464)
    expect(s.gesamt).toBe(11578)
    expect(s.bestellungen[0]).toEqual({
      fnId: 'b1', bestellnummer: 'A-100',
      bestelltAm: '2021-10-15T09:00:00.000Z', status: 'imported',
    })
  })
  test('Storno wird als storno erkannt, nicht als [object Object]', () => {
    const s = bestellliste({ current_page: 1, page_count: 1, total_count: 1, data: [
      { id: 'b9', orderNumber: 'A-9', shopOrderStatus: { name: 'canceled' } }] })
    expect(s.bestellungen[0].status).toBe('canceled')
  })
  test('leere Seite: null Bestellungen, eine Seite', () => {
    const s = bestellliste({ current_page: 1, page_count: 0, total_count: 0, data: [] })
    expect(s.bestellungen).toEqual([])
  })
})

describe('bestellkopf (/{orderId})', () => {
  test('Lieferant, Liefertermin als Unix-Sekunden, Beleg aus der Rechnung', () => {
    const k = bestellkopf({ data: {
      id: 'b1', orderNumber: 'A-100', shopOrderStatus: { name: 'imported' },
      timeCreated: '2021-10-15T09:00:00+00:00', comment: null,
      markedShop: { shopId: 6316, name: 'Distra Aposto' },
      markedShopOrder: { total: 214.5, deliveryDate: { timestamp: 1634428800 } },
      shopOrderInvoices: [{ invoiceNumber: 'RE-2021-4711', invoiceDate: '2021-10-18' }],
    } })
    expect(k.lieferant).toEqual({ fnId: '6316', name: 'Distra Aposto' })
    expect(k.geliefertAm).toBe('2021-10-17')
    expect(k.summe).toBe(214.5)
    expect(k.belegNummer).toBe('RE-2021-4711')
    expect(k.belegDatum).toBe('2021-10-18')
  })
  test('ohne Rechnung und ohne Liefertermin: null, kein Wurf', () => {
    const k = bestellkopf({ data: { id: 'b2', markedShopOrder: { total: 68.4, deliveryDate: null } } })
    expect(k.belegNummer).toBeNull()
    expect(k.geliefertAm).toBeNull()
    expect(k.lieferant).toBeNull()
  })

  /**
   * Der Status ist ein Objekt — `String()` darauf ergab `[object Object]`
   * in allen 44.271 Bestellungen und versteckte 1.561 Stornos im
   * Einkaufsvolumen. Alle fuenf gemessenen Werte, plus die beiden
   * Randfaelle, in denen NICHTS besser ist als eine erfundene Angabe.
   */
  describe('shopOrderStatus ist ein Objekt', () => {
    const status = (x: unknown) => bestellkopf({ data: { id: 'b', shopOrderStatus: x } }).status

    test.each(['imported', 'pending', 'canceled', 'accepted', 'finished'])(
      '%s wird aus {name} gelesen', wert => {
        expect(status({ name: wert })).toBe(wert)
      })

    test('nie [object Object] — auch nicht bei unbekannter Form', () => {
      expect(status({ id: 7 })).toBeNull()
      expect(status({ name: null })).toBeNull()
      expect(status(undefined)).toBeNull()
    })

    test('eine flache Zeichenkette bleibt erlaubt', () => {
      expect(status('canceled')).toBe('canceled')
    })
  })
})

describe('bestellpositionen (/change)', () => {
  /**
   * Die Antwort trägt das ECHTE Feldschema: `amount: 0`, die Menge in
   * `adjustedQuantity`. So liefert FoodNotify sie — am 02.08.2026 an
   * 13.126 Positionen ohne eine einzige Ausnahme gemessen.
   */
  const antwort = { data: [
    { id: 9002, sumPrice: 24, amount: 0, adjustedQuantity: 2, newPrice: 12.5,
      isNotEqualSumPrice: true, isSubstituted: null, status: 'arrived',
      totalUnitQuantity: 20,
      shopOrderMappingProduct: {
        name: 'Zwiebeln Rot Sack 10Kg', packagingQuantity: 10, unitQuantity: 1,
        unit: { id: 2, name: 'kg' },
        concreteProduct: { id: 15790513, name: 'Zwiebeln Rot Sack 10Kg', unit: 'kg', unitQuantity: 1 },
      } },
  ] }
  test('Preis, Gebinde, Ware und die Abweichungsflagge', () => {
    const p = bestellpositionen(antwort)
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({
      fnId: '9002', wareFnId: '15790513', name: 'Zwiebeln Rot Sack 10Kg',
      menge: 2, gebindeMenge: 10, einheit: 'kg', gesamtMenge: 20,
      summePreis: 24, neuerPreis: 12.5, preisAbweichend: true, ersetzt: false,
    })
  })
  test('die Menge kommt aus adjustedQuantity — amount ist im Echtbestand IMMER 0', () => {
    /**
     * Der Fehler, den dieser Test festhält: die erste Fassung las
     * `amount`. Weil das Feld überall 0 ist, blieb der Stückpreis in
     * ALLEN 13.027 Positionen NULL — Division durch 0 wird abgefangen,
     * also fiel nichts um, es fehlte nur alles. Grün getestet war es
     * trotzdem, weil die Attrappe `amount` füllte.
     */
    expect(bestellpositionen(antwort)[0]!.menge).toBe(2)
  })
  test('der Stückpreis ist Summe je Menge — er steht nicht in der Antwort', () => {
    expect(bestellpositionen(antwort)[0]!.einzelpreis).toBe(12)
  })
  test('amount gilt weiterhin, falls FoodNotify es eines Tages füllt', () => {
    // Rückfall: die genauere Angabe gewinnt, wenn sie da ist.
    const mitAmount = { data: [{ ...antwort.data[0], adjustedQuantity: 0, amount: 4 }] }
    expect(bestellpositionen(mitAmount)[0]!.menge).toBe(4)
    expect(bestellpositionen(mitAmount)[0]!.einzelpreis).toBe(6)
  })
  test('4,44e-16 ist keine Menge — sonst sprengt der Stückpreis die Spalte', () => {
    /**
     * Der echte Fall vom 03.08.2026, Bestellung 493306 bei Wilma Wunder:
     * `adjustedQuantity` stand auf 4.4408920985006262e-16 — FoodNotifys
     * Fliesskomma-Rest einer Differenz, die glatt null ergeben sollte.
     *
     * In JavaScript ist der Wert `truthy`, rutschte also durch die
     * `menge &&`-Pruefung. 156,44 / 4,44e-16 = 3,5 · 10^17, und
     * `numeric(14,6)` bricht ab — nicht die Position, sondern die GANZE
     * Bestellung samt Kopf, denn es ist eine Transaktion. Vier Bestellungen
     * hingen mit bis zu neun Versuchen im Backoff.
     *
     * Erwartung: die Menge faellt auf `amount` zurueck (also 0, wie
     * FoodNotify es meldet), der Stueckpreis bleibt leer — und
     * `totalUnitQuantity` traegt den Preis je Einheit weiterhin, denn
     * diese Zahl ist heil.
     */
    const rest = { data: [{ ...antwort.data[0],
      adjustedQuantity: 4.4408920985006262e-16, amount: 0,
      sumPrice: 156.439992, totalUnitQuantity: 31.2 }] }
    const p = bestellpositionen(rest)[0]!
    expect(p.menge).toBe(0)
    expect(p.einzelpreis).toBeNull()
    expect(p.gesamtMenge).toBe(31.2)
    expect(p.preisJeEinheit).toBe(5.014102)
  })
  test('ein Stückpreis, der nicht in numeric(14,6) passt, bleibt leer', () => {
    // Zweite Verteidigungslinie: ein Cent auf ein Milligramm ist rechnerisch
    // richtig und trotzdem kein Preis. Leer statt Abbruch.
    const winzig = { data: [{ ...antwort.data[0], adjustedQuantity: 0.000001, sumPrice: 500 }] }
    expect(bestellpositionen(winzig)[0]!.einzelpreis).toBeNull()
  })
  test('„nicht geliefert" gilt als ersetzt — isSubstituted trägt nichts', () => {
    /**
     * `isSubstituted` ist in allen 13.155 gemessenen Positionen `null`.
     * Was tatsächlich unterscheidet, ist `status`.
     */
    const fehlt = { data: [{ ...antwort.data[0], status: 'not arrived' }] }
    expect(bestellpositionen(fehlt)[0]!.ersetzt).toBe(true)
  })
})

describe('bestellpositionen — die Gebindeangabe prüfen, nicht glauben', () => {
  /**
   * FoodNotify meldet fuer DIESELBE Ware ("Idee Entkoffeiniert 50 Pouches
   * a 7G") `unitQuantity` als 0,00035, 0,007, 0,35 und 50 — Faktor
   * 140.000. Der Preis je Gebinde bleibt dabei stabil (13,03 bis 16,94 €
   * ueber 178 Bestellungen). Nicht der Preis ist unklar, sondern die
   * Angabe, wie viel in einem Gebinde steckt.
   */
  const basis = {
    id: 1, sumPrice: 100, amount: 0, adjustedQuantity: 2, newPrice: null,
    isNotEqualSumPrice: false, isSubstituted: null, status: 'arrived',
    shopOrderMappingProduct: {
      name: 'Testware', packagingQuantity: 5, unitQuantity: 2,
      unit: { id: 2, name: 'kg' },
      concreteProduct: { id: 42, name: 'Testware' },
    },
  }

  test('die gerechnete Menge gewinnt gegen eine widersprüchliche Meldung', () => {
    // 2 x 5 x 2 = 20, gemeldet wird Unsinn. Die Rechnung stuetzt sich auf
    // drei Felder, die Meldung auf eines.
    const p = bestellpositionen({ data: [{ ...basis, totalUnitQuantity: 0.002 }] })[0]!
    expect(p.gesamtMenge).toBe(20)
    expect(p.preisJeEinheit).toBe(5)
    expect(p.mengeUnstimmig).toBe(false)
  })

  test('stimmen beide überein, bleibt alles wie gemeldet', () => {
    const p = bestellpositionen({ data: [{ ...basis, totalUnitQuantity: 20 }] })[0]!
    expect(p.gesamtMenge).toBe(20)
    expect(p.preisJeEinheit).toBe(5)
  })

  test('ohne Gebindeangabe wird kein Preis je Einheit erfunden', () => {
    /**
     * Fehlen Gebinde oder Inhalt, ist nicht zu unterscheiden, ob 0,00035 kg
     * eine Kaffeeportion oder ein Datenfehler ist. Dann lieber keine Zahl:
     * eine fehlende faellt auf, eine falsche nicht.
     */
    const ohne = {
      ...basis,
      shopOrderMappingProduct: { ...basis.shopOrderMappingProduct,
        packagingQuantity: null, unitQuantity: null },
      totalUnitQuantity: null,
    }
    const p = bestellpositionen({ data: [ohne] })[0]!
    expect(p.mengeUnstimmig).toBe(true)
    expect(p.preisJeEinheit).toBeNull()
  })

  test('die Lieferantennummer wird mitgeführt — sie rettet 18 % der Positionen', () => {
    /**
     * FoodNotify liefert bei 55.408 von 310.761 Positionen keine
     * `concreteProduct.id`. 55.232 davon tragen `ingredient.artikelId` —
     * dieselbe Nummer, ueber die schon Stufe 0.1 den Warenstamm verknuepft
     * hat. Ohne diesen Rueckfall blieben sie ohne Ware.
     */
    const mitLieferant = {
      ...basis, totalUnitQuantity: 20,
      shopOrderProduct: { product: { ingredient: { artikelId: 'S520701' } } },
    }
    expect(bestellpositionen({ data: [mitLieferant] })[0]!.lieferantenNr).toBe('S520701')
  })
})
