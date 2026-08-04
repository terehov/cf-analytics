/**
 * FoodNotify-Attrappe für den Ende-zu-Ende-Test.
 *
 * Bildet das gemessene Verhalten nach, nicht ein ideales API
 * (docs/foodnotify-api-inventar.md, Login-Protokoll aus dem brew-Chunk):
 *   * JSON-Login auf `/api/user/auth/signin_check` mit
 *     `{email, password, rememberMe}`; Antwort `{type: "LoginSuccess"}`
 *     bei Erfolg, HTTP 401 bei falschen Zugangsdaten
 *   * auf Wunsch `LoginChallenge` — der 2FA-Fall, der abbrechen MUSS
 *   * Session als HttpOnly-Cookie, kein Token im Body
 *   * die payload-Hülle der /api/erp/*-Endpunkte, GESCHACHTELT wie bei
 *     Wilma Wunder (payload → data) — genau die Form, an der das erste
 *     Auspacken gescheitert ist
 *   * Fehler AUCH mit HTTP 200 und isError=true
 *
 * Nur für Tests. Läuft nie im Container mit.
 */

export type FnMockOptionen = {
  port?: number
  /**
   * Pfad → ab dem wievielten Aufruf die Antwort leer wird (200, Hülle
   * korrekt, null Zeilen). Für den Test der Leere-200er-Regel: erst Daten,
   * dann Stille — lautlos wie im Original.
   */
  leerAb?: Record<string, number>
}

/**
 * Zwei Benutzer, zwei Verhalten:
 *   test@aposto.eu / geheim  →  LoginSuccess
 *   zfa@aposto.eu  / geheim  →  LoginChallenge (2FA — muss ohne Retry abbrechen)
 */
export function fnMockStarten(opt: FnMockOptionen = {}) {
  let anmeldungen = 0
  const zaehler: Record<string, number> = {}
  const sessions = new Set<string>()

  const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), {
      ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })

  const server = Bun.serve({
    port: opt.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url)
      const pfad = url.pathname
      zaehler[pfad] = (zaehler[pfad] ?? 0) + 1

      if (pfad === '/api/user/auth/signin_check' && req.method === 'POST') {
        anmeldungen++
        const body = await req.json().catch(() => ({})) as Record<string, unknown>
        if (body.password !== 'geheim'
            || (body.email !== 'test@aposto.eu' && body.email !== 'zfa@aposto.eu')) {
          return json({ message: 'Invalid credentials.' }, { status: 401 })
        }
        if (body.email === 'zfa@aposto.eu') {
          // 2FA: erst die Challenge, KEIN Session-Cookie.
          return json({ type: 'LoginChallenge', availableMethods: ['email'] })
        }
        const sitzung = `fnsess-${anmeldungen}`
        sessions.add(sitzung)
        return json({ type: 'LoginSuccess' }, {
          headers: { 'set-cookie': `PHPSESSID=${sitzung}; Path=/; HttpOnly` },
        })
      }

      // Alles andere braucht die Sitzung.
      const cookie = req.headers.get('cookie') ?? ''
      const angemeldet = [...sessions].some(s => cookie.includes(s))
      if (!angemeldet) return json({ message: 'Unauthenticated' }, { status: 401 })

      const abWann = opt.leerAb?.[pfad]
      if (abWann !== undefined && zaehler[pfad]! >= abWann) {
        // HTTP 200, Hülle korrekt, null Zeilen — lautlos wie im Original.
        return json({ errors: [], code: 200, isError: false, payload: { data: [] } })
      }

      switch (pfad) {
        case '/api/profile':
          return json({ data: { id: 18336, firstName: 'Admin', lastName: 'Aposto',
                                email: 'test@aposto.eu', emailVerified: true } })
        case '/api/core/business/18336/restaurants':
          return json({ data: [
            { id: 10426, name: 'Aposto Aalen', timezone: 'Europe/Vienna' },
            { id: 10436, name: 'Aposto Gera', timezone: 'Europe/Vienna' },
          ] })
        case '/api/erp/all':
          // Die payload-Hülle — mit Verwaltungsfeldern, wie gemessen.
          return json({ errors: [], code: 200, isError: false, payload: [
            { id: 10483, costCenter: { id: 10920, name: 'Küche Aposto Gera ',
              restaurant: { id: 10436, name: 'Aposto Gera' } } },
            { id: 10484, costCenter: { id: 10921, name: 'Bar Aposto Gera ',
              restaurant: { id: 10436, name: 'Aposto Gera' } } },
          ] })
        case '/api/pos/locations':
          return json({ errors: [], code: 200, isError: false, payload: {
            userId: 18336,
            locations: [
              { restaurant: 'Aposto Gera', restaurantId: 10436,
                costCenter: 'Küche Aposto Gera ', costCenterId: 10920,
                connection: { connectionId: 1907, deviceType: { name: 'amadeus', matchingStrategy: 'plu' } } },
              { restaurant: 'Aposto Aalen', restaurantId: 10426,
                costCenter: 'Küche Aposto Aalen', costCenterId: 10669 },
            ],
          } })
        case '/api/10483/shop-order/paginate': {
          // Drei Seiten, chronologisch aufsteigend: vorne die alten
          // Bestellungen, hinten die neueste — der e2e-Test beweist damit,
          // dass der Backfill die LETZTEN Seiten zuerst abarbeitet (3 vor 2).
          // Die Liste traegt denselben Status wie der Kopf, in derselben
          // Objektform — hier fehlte er ganz, obwohl `bestellliste()` ihn
          // liest und schreibt. Ein Feld, das die Attrappe nicht kennt,
          // kann kein Test pruefen.
          const seite = Number(url.searchParams.get('page') ?? 1)
          const seiten: Record<number, unknown[]> = {
            1: [
              { id: 'b1', orderNumber: 'A-100', timeCreated: '2021-10-15T09:00:00+00:00',
                shopOrderStatus: { name: 'imported' } },
              { id: 'b2', orderNumber: 'A-101', timeCreated: '2021-10-16T09:00:00+00:00',
                shopOrderStatus: { name: 'canceled' } },
            ],
            2: [{ id: 'b3', orderNumber: 'A-102', timeCreated: '2024-05-01T09:00:00+00:00',
                  shopOrderStatus: { name: 'imported' } }],
            3: [{ id: 'b4', orderNumber: 'A-103', timeCreated: '2026-07-30T09:00:00+00:00',
                  shopOrderStatus: { name: 'pending' } }],
          }
          return json({
            order_by: 'timeCreated', order_direction: 'ASC',
            current_page: seite,
            current_page_size: 25, page_count: 3, total_count: 4, currency: 'EUR',
            data: seiten[seite] ?? [],
          })
        }
        case '/api/10484/shop-order/paginate':
          // Die Bar bestellt nicht über FoodNotify — leer VON ANFANG AN.
          // Das ist der legitime Leerfall: keine Abweichung, ergebnis ok.
          return json({
            order_by: 'timeCreated', order_direction: 'ASC',
            current_page: 1, current_page_size: 25, page_count: 0, total_count: 0,
            currency: 'EUR', data: [],
          })
        /**
         * DER STATUS IST EIN OBJEKT: `{"name": "imported"}`.
         *
         * Hier stand bis zum 04.08.2026 `shopOrderStatus: 'delivered'` —
         * eine flache Zeichenkette und ein Wort, das FoodNotify gar nicht
         * kennt. Das Vokabular ist `imported | pending | canceled |
         * accepted | finished` (gemessen an 44.271 Bestellkoepfen im
         * Rohbestand). Weil die Attrappe eine Zeichenkette lieferte, war
         * `String(status)` hier harmlos und im Echtbestand
         * `[object Object]` — in jeder Zeile, ueber alle vier Marken.
         *
         * b2 ist deshalb STORNIERT: der Fall, um den es fachlich geht,
         * muss durch die ganze Kette laufen, nicht nur durch den Parser.
         */
        case '/api/10483/shop-order/b1':
          // Kopf wie im Inventar §4: Lieferant, Liefertermin, Rechnung dran.
          return json({ data: {
            id: 'b1', orderNumber: 'A-100', shopOrderStatus: { name: 'imported' },
            timeCreated: '2021-10-15T09:00:00+00:00', comment: null,
            markedShop: { shopId: 6316, name: 'Distra Aposto' },
            markedShopOrder: { total: 214.5, deliveryDate: { timestamp: 1634428800 }, orderId: 'b1' },
            shopOrderInvoices: [{ invoiceNumber: 'RE-2021-4711', invoiceDate: '2021-10-18' }],
          } })
        case '/api/10483/shop-order/b2':
          return json({ data: {
            id: 'b2', orderNumber: 'A-101', shopOrderStatus: { name: 'canceled' },
            timeCreated: '2021-10-16T09:00:00+00:00', comment: 'Eilbestellung',
            markedShop: { shopId: 6316, name: 'Distra Aposto' },
            markedShopOrder: { total: 68.4, deliveryDate: null, orderId: 'b2' },
            shopOrderInvoices: [],
          } })
        /**
         * Die Positionen tragen `amount: 0` und die echte Menge in
         * `adjustedQuantity` — so, wie FoodNotify sie am 02.08.2026 an
         * 13.126 echten Positionen ausnahmslos geliefert hat.
         *
         * Vorher stand hier `amount: 10`, weil das Feld im Inventar so
         * notiert war. Der Test war deshalb gruen, waehrend im Bestand
         * JEDER Stueckpreis auf NULL stand. Eine Attrappe, die ein
         * plausibleres Schema nachbildet als das echte, prueft nichts.
         */
        case '/api/10483/shop-order/b1/change':
          return json({ data: [
            { id: 9001, sumPrice: 190.5, amount: 0, adjustedQuantity: 10, newPrice: null,
              isNotEqualSumPrice: false, isSubstituted: false, totalUnitQuantity: 60,
              shopOrderMappingProduct: {
                name: 'Prosecco Spumante Zardetto 0,75L', packagingQuantity: 6,
                unitQuantity: 0.75, unit: { id: 1, name: 'l' },
                concreteProduct: { id: 200027, name: 'Prosecco Spumante Zardetto 0,75L', unit: 'l', unitQuantity: 0.75 },
              } },
            { id: 9002, sumPrice: 24, amount: 0, adjustedQuantity: 2, newPrice: 12.5,
              isNotEqualSumPrice: true, isSubstituted: false, totalUnitQuantity: 20,
              shopOrderMappingProduct: {
                name: 'Zwiebeln Rot Sack 10Kg', packagingQuantity: 10,
                unitQuantity: 1, unit: { id: 2, name: 'kg' },
                concreteProduct: { id: 15790513, name: 'Zwiebeln Rot Sack 10Kg', unit: 'kg', unitQuantity: 1 },
              } },
          ] })
        case '/api/10483/shop-order/b3':
          return json({ data: {
            id: 'b3', orderNumber: 'A-102', shopOrderStatus: { name: 'imported' },
            timeCreated: '2024-05-01T09:00:00+00:00', comment: null,
            markedShop: { shopId: 6316, name: 'Distra Aposto' },
            markedShopOrder: { total: 31.2, deliveryDate: null, orderId: 'b3' },
            shopOrderInvoices: [],
          } })
        case '/api/10483/shop-order/b4':
          return json({ data: {
            id: 'b4', orderNumber: 'A-103', shopOrderStatus: { name: 'pending' },
            timeCreated: '2026-07-30T09:00:00+00:00', comment: null,
            markedShop: { shopId: 6316, name: 'Distra Aposto' },
            markedShopOrder: { total: 45.9, deliveryDate: null, orderId: 'b4' },
            shopOrderInvoices: [],
          } })
        case '/api/10483/shop-order/b4/change':
          return json({ data: [
            { id: 9005, sumPrice: 45.9, amount: 0, adjustedQuantity: 3, newPrice: null,
              isNotEqualSumPrice: false, isSubstituted: false, totalUnitQuantity: 9,
              shopOrderMappingProduct: {
                name: 'Limoncello 0,7L', packagingQuantity: 3, unitQuantity: 0.7,
                unit: { id: 1, name: 'l' },
                concreteProduct: { id: 450063, name: 'Limoncello 0,7L', unit: 'l', unitQuantity: 0.7 },
              } },
          ] })
        case '/api/10483/shop-order/b3/change':
          return json({ data: [
            { id: 9004, sumPrice: 31.2, amount: 0, adjustedQuantity: 12, newPrice: null,
              isNotEqualSumPrice: false, isSubstituted: false, totalUnitQuantity: 12,
              shopOrderMappingProduct: {
                name: 'Holunderbluetensirup 0,7L', packagingQuantity: 6, unitQuantity: 0.7,
                unit: { id: 1, name: 'l' },
                concreteProduct: { id: 9085, name: 'Holunderbluetensirup 0,7L', unit: 'l', unitQuantity: 0.7 },
              } },
          ] })
        case '/api/10483/shop-order/b2/change':
          return json({ data: [
            { id: 9003, sumPrice: 68.4, amount: 0, adjustedQuantity: 4, newPrice: null,
              isNotEqualSumPrice: false, isSubstituted: true, totalUnitQuantity: 16,
              shopOrderMappingProduct: {
                name: 'Auberginen Kg', packagingQuantity: 4, unitQuantity: 1,
                unit: { id: 2, name: 'kg' },
                concreteProduct: { id: 12700510, name: 'Auberginen Kg', unit: 'kg', unitQuantity: 1 },
              } },
          ] })
        case '/api/999/shop-order/paginate':
          // Fremde erpId: FoodNotify meldet das mit 200 und isError=true.
          return json({ errors: ['object not found'], code: 404, isError: true, payload: null })

        /**
         * B1 · Inventuren — EIN Aufruf für BEIDE Aposto-Gera-Kostenstellen
         * zugleich (erpIds[]=10483&erpIds[]=10484), nicht einer je
         * Kostenstelle. Zwei Seiten, damit derselbe Test wie bei
         * Bestellungen möglich ist: Seite 1 reiht Seite 2 rückwärts ein.
         *
         * DIE HÜLLE IST HIER NICHT GEMESSEN, NUR ABGELEITET: /api/erp/* nutzt
         * sonst {code,errors,isError,payload}, und genau an DIESEM Endpunkt
         * (Wilma Wunder, 275 Inventuren) ist die Exploration einmal auf eine
         * geschachtelte payload→data-Form hereingefallen (Inventar §1, §8b).
         * Diese Attrappe bildet payload→{data,pagination} nach — die
         * plausibelste Lesart, keine Messung. src/foodnotify/endpunkte.ts
         * trägt denselben Vorbehalt im `hinweis`-Feld.
         */
        case '/api/erp/stocktakings': {
          const seite = Number(url.searchParams.get('page') ?? 1)
          const seiten: Record<number, unknown[]> = {
            1: [
              { id: 'inv-1', erpId: 10483, name: 'Kücheninventur Juli', type: 'full',
                createdAt: '2026-07-01T08:00:00+00:00', timeModified: '2026-07-01T10:00:00+00:00',
                status: { name: 'signed' }, totalNumberOfItems: 2, note: null },
            ],
            2: [
              { id: 'inv-2', erpId: 10484, name: 'Barinventur August', type: 'full',
                createdAt: '2026-08-01T08:00:00+00:00', timeModified: null,
                status: { name: 'counting' }, totalNumberOfItems: 1, note: 'Nachzählung offen' },
            ],
          }
          return json({ errors: [], code: 200, isError: false, payload: {
            data: seiten[seite] ?? [],
            pagination: { currentPage: seite, totalPages: 2, totalItems: 2 },
          } })
        }
        case '/api/erp/stocktakings/inv-1/items':
          // Wie im Inventar §4 belegt: Sollbestand, gezählte Menge, Preis je
          // Basiseinheit. Eine Position ohne shopArticleId (item-2) prüft den
          // Rückfall auf ware_key = NULL.
          return json({ errors: [], code: 200, isError: false, payload: [
            { id: 'item-1', name: 'Granini Orangensaft Mw 6X1,00',
              shopArticleId: 'L-9001', shopName: 'HFS Getränke', baseUnit: 'ml',
              theoreticalStockLevelInBaseUnits: 29612.59, countedAmountInBaseUnits: 6000,
              reviewAmountInBaseUnits: 6000, pricePerBaseUnit: 0.0025533 },
            { id: 'item-2', name: 'Zwiebeln Rot Sack 10Kg',
              shopArticleId: null, shopName: null, baseUnit: 'kg',
              theoreticalStockLevelInBaseUnits: 12, countedAmountInBaseUnits: 10.5,
              reviewAmountInBaseUnits: null, pricePerBaseUnit: 2.4 },
          ] })
        case '/api/erp/stocktakings/inv-2/items':
          return json({ errors: [], code: 200, isError: false, payload: [
            { id: 'item-3', name: 'Prosecco Spumante Zardetto 0,75L',
              shopArticleId: 'L-9002', shopName: 'Distra Aposto', baseUnit: 'l',
              theoreticalStockLevelInBaseUnits: 8.25, countedAmountInBaseUnits: 6,
              reviewAmountInBaseUnits: null, pricePerBaseUnit: 8.9 },
          ] })
      }
      return json({ message: 'not found' }, { status: 404 })
    },
  })

  return {
    url: `http://localhost:${server.port}`,
    zaehler,
    get anmeldungen() { return anmeldungen },
    stop: () => server.stop(true),
  }
}
