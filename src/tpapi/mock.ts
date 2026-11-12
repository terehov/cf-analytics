/**
 * TPAPI-Attrappe für die Tests.
 *
 * Bildet `personalkostenprostunde` so nach, wie es am 07. und 09.11.2026 im
 * Importer-Container gemessen wurde (`docs/plan-tpapi.md` §1) — und dazu die
 * Antworten, die der Nachlauf unterscheiden können muss:
 *
 *   * 200 mit `eff`, `kost` UND `kostUser` — das dritte Feld muss mitkommen,
 *     sonst kann kein Test zeigen, dass es nicht in `raw` landet
 *   * Gleitkommarauschen in `kost` (`161.42000000000002`), wie gemessen
 *   * 401 bei einem unbekannten Schlüssel
 *   * 403 `Module 'Personal' not licensed`
 *   * 429, einmal je Betrieb
 *   * ein leerer Tag (`{eff: {}, kost: {}, kostUser: {}}`)
 *   * 500 mit einer HTML-Seite
 *
 * Jeder Aufruf landet mit Pfad, `apikey`, `businessdate` und Zeitpunkt in
 * `aufrufe` — die Tests lesen daraus Header, Takt und Reihenfolge.
 *
 * SEIT 0151 (Stufe 2) auch die übrigen lesenden Endpunkte, mit den
 * Feldnamen aus docs/plan-tpapi-stufe2.md §1: `revenue/listdays`
 * (Unix-Sekunden auf Berliner Mitternacht — ANNAHME, nicht gemessen; mit
 * `listdaysUtc` auf Mitternacht UTC), `revenue/journal` (37 Felder),
 * `revenue/journaltables` (27 Felder), `personal/personalkostenprotag` (eine
 * Zeile JE PERSON, Werte teils als Zahl-Text — genau die Zeilen, die nie nach
 * `raw` dürfen), die dreizehn `merchandiseman/*` (`id, number, name`) und
 * `revenue/getforecastperday`. Module je Betrieb über `module`: wer ein Modul
 * nicht hat, bekommt 403 „Module '…' not licensed" wie Ratskeller
 * Saarbrücken (gemessen 09.11.2026).
 *
 * SEIT 0153 (Schritt 2b) in der Form der Formprobe vom 12.11.2026: Journal
 * mit Saldo null und den gemessenen Typen (`journalZeilen`), Bons mit EMPTY
 * (`tischZeilen`), die Prognose für from/to (`prognoseZeilen`), der
 * Artikelstamm mit den Feldern der Formprobe (`stammZeilen`).
 *
 * NUR FÜR TESTS. Läuft nie im Container mit.
 */
export type TpapiMockOptionen = {
  port?: number
  /** encId → Schlüssel. Jeder andere Schlüssel bekommt 401. */
  schluessel: Record<string, string>
  /** Betriebe ohne gebuchte Team Data API: 403 not licensed. */
  nichtLizenziert?: string[]
  /** So viele Aufrufe insgesamt zuerst mit 429 beantworten. */
  bremsen?: number
  /** Diese Betriebe bekommen auf ihren ERSTEN Aufruf 429. */
  bremsenFuer?: string[]
  /** Diese Betriebe liefern jeden Tag leer. */
  leer?: string[]
  /** Diese Betriebe bekommen 500 mit HTML. */
  serverfehlerFuer?: string[]
  /** Eigene Antwort je Aufruf; gewinnt vor der Vorgabe, nicht vor 401/403/429/500. Nur personalkostenprostunde. */
  antwort?: (encId: string, businessdate: string, nr: number) => unknown
  /**
   * Gebuchte Module je Betrieb (Stufe 2). Fehlt ein Betrieb hier, hat er alle
   * drei. Nicht gebucht → 403 „Module '…' not licensed".
   */
  module?: Record<string, Array<'personal' | 'revenue' | 'artikel'>>
  /** Geschäftstage (YYYY-MM-DD) je Betrieb für `listdays`; Vorgabe: die letzten `listdaysTage` Tage bis gestern. */
  tage?: Record<string, string[]>
  /** Vorgabe-Tiefe von `listdays` in Tagen (Standard 10). */
  listdaysTage?: number
  /** `listdays` auf Mitternacht UTC statt auf Berliner Mitternacht. */
  listdaysUtc?: boolean
  /** Ab dem n-ten Aufruf (1-basiert, alle Pfade) bekommt dieser Betrieb 429. */
  bremsenAb?: Record<string, number>
  /** 500 mit HTML für genau diese Aufrufe (Stufe 2) — ein „kaputter Tag". */
  serverfehlerWenn?: (pfad: string, encId: string, businessdate: string | null) => boolean
  /** Eigene Antwort für Stufe-2-Pfade (relativ zu /extern/); undefined = Vorgabe. */
  antwortStufe2?: (pfad: string, encId: string, businessdate: string | null, parameter: URLSearchParams) => unknown
}

export type TpapiMockAufruf = {
  pfad: string
  methode: string
  apikey: string | null
  accept: string | null
  businessdate: string | null
  encId: string | null
  status: number
  zeit: number
}

/**
 * Die Vorgabeantwort: Mittag 11–15 Uhr, Abend 17–23 Uhr, Nacht 0–1 Uhr —
 * also auch Stunden NACH Mitternacht, die zum selben Geschäftstag gehören.
 * Werte hängen am Tag, damit zwei Tage verschieden aussehen.
 */
export function vorgabeAntwort(businessdate: string): {
  eff: Record<string, number>; kost: Record<string, number>; kostUser: Record<string, Record<string, number>>
} {
  const tag = Number(businessdate.slice(0, 2)) || 1
  const eff: Record<string, number> = {}
  const kost: Record<string, number> = {}
  const kostUser: Record<string, Record<string, number>> = {}
  for (const h of [11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 0, 1]) {
    const personen = 2 + ((h + tag) % 5)
    eff[String(h)] = personen
    kost[String(h)] = Math.round(personen * 13.37 * 100) / 100
    kostUser[String(h)] = Object.fromEntries(
      Array.from({ length: personen }, (_, i) => [`ma${1000 + i}`, 13.37]))
  }
  // Das gemessene Rauschen, wörtlich.
  eff['9'] = 12
  kost['9'] = 161.42000000000002
  kostUser['9'] = { ma1000: 80.71, ma1001: 80.71000000000002 }
  return { eff, kost, kostUser }
}

/** Die Felder des Journals, wie am 07.11.2026 gemessen (37). */
export const JOURNAL_FELDER = [
  'ID', 'datum', 'refdate', 'art', 'artnr', 'preis', 'zahl', 'tisch', 'ust', 'vat_id', 'kellnernr',
  'finanzweg', 'buchungsnr', 'tableheader_id', 'am_id', 'balance', 'terminal', 'masterkellnernr',
  'teamnr', 'zcount', 'parentid', 'site', 'situation', 'sortorder', 'addinfo', 'rabatt_id',
  'pricelevel_id', 'operationprofile_id', 'cancellationreason', 'captivesupplyreason',
  'event_number', 'menucard_id', 'price_per_unit', 'financeextendedinfo_id', 'provision_free',
  'course_price_print', 'coursedefentry_id',
] as const

/** Die Felder der Bons (27). */
export const JOURNALTABLES_FELDER = [
  'tableheader_id', 'old_id', 'table_type', 'table_number', 'refdate', 'documentdate',
  'transaction_number', 'accounting_type', 'debitor_id', 'parent_id', 'archiveparent_id',
  'debitor_text', 'reservation_id', 'zcount', 'number_adults', 'number_kids', 'number_infants',
  'renum', 'vat1sum', 'vat2sum', 'vat3sum', 'finanzweg', 'zahl', 'kellnernr', 'is_archive',
  'zip_code', 'tablearea_id',
] as const

/** Personenzeilen von personalkostenprotag — mit Merkwerten, die ein Test in raw wiederfände. */
export function protagZeilen(businessdate: string): Array<Record<string, unknown>> {
  const tag = Number(businessdate.slice(0, 2)) || 1
  return [
    { h_brutto: 8.5, h_zuschl_25: 0, h_zuschl_40: 0, h_zuschl_50: 0, brutto: 123.45, lohnkosten: 151.17 },
    { h_brutto: '6.25', h_zuschl_25: '1.5', h_zuschl_40: 0, h_zuschl_50: 0, brutto: '98.76', lohnkosten: '120.94' },
    { h_brutto: 4, h_zuschl_25: 0, h_zuschl_40: 2, h_zuschl_50: 0.5, brutto: 77.77 + tag, lohnkosten: 95.24 },
    { h_brutto: 11.333333333333334, h_zuschl_25: 0, h_zuschl_40: 0, h_zuschl_50: 0, brutto: 211.1, lohnkosten: 258.5 },
  ]
}

/** Unix-Sekunden für einen Tag — Berliner Mitternacht (Vorgabe) oder Mitternacht UTC. */
export function epochFuerTag(iso: string, utc = false): number {
  const [y, m, d] = iso.split('-').map(Number)
  const mitternachtUtc = Date.UTC(y!, m! - 1, d!) / 1000
  if (utc) return mitternachtUtc
  // Berlin ist UTC+1 oder UTC+2: die Mitternacht dort liegt 1 bzw. 2 Stunden davor.
  for (const h of [1, 2]) {
    const t = mitternachtUtc - h * 3600
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
    }).formatToParts(new Date(t * 1000))
    const g = (x: string) => p.find(q => q.type === x)!.value
    if (`${g('year')}-${g('month')}-${g('day')}` === iso && Number(g('hour')) % 24 === 0) return t
  }
  throw new Error(`keine Berliner Mitternacht für ${iso}`)
}

/** dd.mm.yyyy → YYYY-MM-DD. */
function isoVon(bd: string): string {
  const [d, m, y] = bd.split('.')
  return `${y}-${m}-${d}`
}

/**
 * Ein Kassentag in der Form der Formprobe vom 12.11.2026: alle Zahlen als
 * JSON-Zahlen, `tisch`, `buchungsnr`, `art`, `addinfo` als Text, `ust` als
 * Text ("19.00") — so lieferte es Aposto Aalen; Wilma Wunder Nürnberg schickte
 * `ust` als Zahl, deshalb an einer Zeile auch so. `datum` Unix-Sekunden im
 * Geschäftstag (eine Zeile um 01:30 der Nacht danach), `refdate` Berliner
 * Mitternacht, die sieben leeren Felder `null`. Saldo null:
 *
 *   Boniert (1)        Cappuccino 2 × 3,70, Pizza 11,50, Spaghetti 13,90 mit einer
 *                      Beilage zu 0, Weinschorle 5,50, Nachlass "10% Glücksrad" −3,86
 *                      (rabatt_id) — Summe 34,44
 *   Sofortstorno (10)  Weinschorle −5,50 (cancellationreason 3)
 *   → Umsatz nach der Deutung 28,94 brutto
 *   Trinkgeld (2700) +2,06, Bar (20) −20,00, Girocard (48) −11,00,
 *   Tischübergabe (22/23) ∓10,00
 */
export const MOCK_UMSATZ_BRUTTO = 28.94

export function journalZeilen(businessdate: string): Array<Record<string, unknown>> {
  const mitternacht = epochFuerTag(isoVon(businessdate))
  const zeilen: Array<Partial<Record<string, unknown>>> = [
    { art: 'Cappuccino', artnr: 300200, zahl: 2, balance: 7.4, ust: '19.00', vat_id: 1, finanzweg: 1, h: 11.2, bon: 1 },
    { art: 'Pizza Margherita', artnr: 300201, zahl: 1, balance: 11.5, ust: '7.00', vat_id: 2, finanzweg: 1, h: 12.5, bon: 1 },
    { art: 'Spaghetti', artnr: 300202, zahl: 1, balance: 13.9, ust: 19, vat_id: 1, finanzweg: 1, h: 19.25, bon: 2 },
    { art: 'Extra Parmesan', artnr: 300203, zahl: 1, balance: 0, ust: '19.00', vat_id: 1, finanzweg: 1, h: 19.26, bon: 2, beilage: true },
    { art: 'Weinschorle', artnr: 300204, zahl: 1, balance: 5.5, ust: '19.00', vat_id: 1, finanzweg: 1, h: 22.5, bon: 3 },
    { art: '10% Glücksrad', artnr: 0, zahl: 1, balance: -3.86, ust: '19.00', vat_id: 1, finanzweg: 1, h: 22.6, bon: 3, rabatt_id: 3086 },
    { art: 'Weinschorle', artnr: 300204, zahl: -1, balance: -5.5, ust: '19.00', vat_id: 1, finanzweg: 10, h: 25.5, bon: 3, cancellationreason: 3 },
    { art: 'TIP_', artnr: -4, zahl: 1, balance: 2.06, ust: '0.00', vat_id: 0, finanzweg: 2700, h: 22.7, bon: 3 },
    { art: 'Bar gegeben', artnr: 0, zahl: 1, balance: -20, ust: '0.00', vat_id: 0, finanzweg: 20, h: 13, bon: 1 },
    { art: 'Girocard', artnr: 0, zahl: 1, balance: -11, ust: '0.00', vat_id: 0, finanzweg: 48, h: 25.5, bon: 3 },
    { art: 'Tischuebergabe', artnr: 0, zahl: 1, balance: -10, ust: '0.00', vat_id: 0, finanzweg: 22, h: 20, bon: 2 },
    { art: 'Tischuebernahme', artnr: 0, zahl: 1, balance: 10, ust: '0.00', vat_id: 0, finanzweg: 23, h: 20, bon: 2 },
  ]
  return zeilen.map((z, i) => {
    const e: Record<string, unknown> = Object.fromEntries(JOURNAL_FELDER.map(f => [f, 0]))
    for (const f of ['event_number', 'menucard_id', 'price_per_unit', 'financeextendedinfo_id',
                     'provision_free', 'course_price_print', 'coursedefentry_id']) e[f] = null
    e.ID = 185733426 + i
    e.am_id = 5161145 + i
    e.datum = mitternacht + Math.round((z.h as number) * 3600)
    e.refdate = mitternacht
    e.art = z.art; e.artnr = z.artnr; e.zahl = z.zahl; e.balance = z.balance; e.preis = z.balance
    e.ust = z.ust; e.vat_id = z.vat_id; e.finanzweg = z.finanzweg
    e.tisch = String(10 + (z.bon as number)); e.buchungsnr = '1'
    e.tableheader_id = 772797 + (z.bon as number)
    e.kellnernr = 7; e.masterkellnernr = 7; e.teamnr = 1; e.terminal = 25; e.zcount = 2572
    e.parentid = z.beilage ? 5161145 + 2 : 0
    e.situation = 0; e.sortorder = 0; e.site = 0
    e.rabatt_id = z.rabatt_id ?? 0
    e.cancellationreason = z.cancellationreason ?? 0
    e.pricelevel_id = 1; e.operationprofile_id = 2
    e.captivesupplyreason = i % 3 === 0 ? null : 0
    e.addinfo = i === 2 ? 'Freitext vom Gast' : ''
    return e
  })
}

/** Bons des Tages: drei abgerechnete (5 Gäste), einer ohne Buchung (EMPTY). */
export function tischZeilen(businessdate = '01.01.2026'): Array<Record<string, unknown>> {
  const mitternacht = epochFuerTag(isoVon(businessdate))
  return [1, 2, 3, 4].map(bon => {
    const z: Record<string, unknown> = Object.fromEntries(JOURNALTABLES_FELDER.map(f => [f, 0]))
    z.tableheader_id = 772797 + bon; z.old_id = 772797 + bon
    z.table_type = 'STANDARD'; z.table_number = String(10 + bon)
    z.refdate = mitternacht; z.documentdate = mitternacht + Math.round((10 + bon * 3) * 3600)
    z.transaction_number = null; z.tablearea_id = null
    z.accounting_type = bon === 4 ? 'EMPTY' : 'BILL'
    z.number_adults = bon === 4 ? 0 : bon; z.number_kids = bon === 2 ? 1 : 0; z.number_infants = 0
    z.renum = bon === 4 ? 0 : 625340 + bon
    z.archiveparent_id = bon % 2 ? null : 0
    z.kellnernr = 7; z.is_archive = 1; z.zcount = 2572
    z.debitor_text = bon === 1 ? 'Firma Muster' : ''
    z.zip_code = bon === 1 ? '80331' : null
    return z
  })
}

/** Prognose je Tag von from bis to: {datum: Berliner Mitternacht, forecast: netto}. */
export function prognoseZeilen(from: string, to: string): Array<Record<string, unknown>> {
  const aus: Array<Record<string, unknown>> = []
  const ende = new Date(`${isoVon(to)}T00:00:00Z`).getTime()
  for (let t = new Date(`${isoVon(from)}T00:00:00Z`).getTime(); t <= ende; t += 86_400_000) {
    const iso = new Date(t).toISOString().slice(0, 10)
    aus.push({ datum: epochFuerTag(iso), forecast: 1000 + Number(iso.slice(8, 10)) * 10.5 + 0.24 })
  }
  return aus
}

/** Der Artikelstamm in der gemessenen Form — je Liste die Felder der Formprobe. */
export function stammZeilen(liste: string): Array<Record<string, unknown>> {
  if (liste === 'recipe') {
    return [
      ['Cappuccino', 300200, 0.57, 501], ['Pizza Margherita', 300201, 1.06, 502],
      ['Spaghetti', 300202, 1.25, 502], ['Extra Parmesan', 300203, 0.3, 502],
      ['Weinschorle', 300204, 0.83, 501], ['!!! NACHBON !!!', 9990034, 0, 503],
    ].map(([name, number, fixedwe, detail], i) => ({
      id: 15449 + i, number, name, active: i < 5, function: i < 5 ? 'MAIN' : 'INFORMATION',
      detailcategory: detail, meccode: 870, artnr1: null, artnr2: null, productUse: 0, fixedwe,
      quantitycontrol: 'N', currentquantity: 0,
      prices: [{ active: true, priceperunit: 0, pricefixed: 3.7, menucard: 1 }],
      attributes: [{ attributeType: 'allergen', attributeId: 57, attributeName: 'Gluten' }],
      0: null, 1: true,
    }))
  }
  if (liste === 'financetype') {
    return [
      [-10, -10, 'Systembuchung', 60], [1, 1, 'Boniert', 101], [8, 10, 'Sofortstorno', 101],
      [17, 20, 'Bar', 109], [21, 22, 'Tischübergabe', 116], [22, 23, 'Tischübernahme', 116],
      [40, 48, 'Girocard', 110], [2700, 2700, 'Trinkgeld', 119],
    ].map(([id, number, name, cat]) => ({
      id, number, name, description: null, active: 'Y', fin_category: cat, ec: 0, gs: 0,
      clearing_factor: 0, is_tipp: name === 'Trinkgeld' ? 'Y' : 'N', salesarticle_id: null,
    }))
  }
  if (liste === 'financecategory') {
    return [
      [101, 1, 'Umsatz', 'SALES'], [109, 3, 'Bargeld', 'CASH'], [110, 4, 'Unbar', 'NONCASH'],
      [116, 6, 'Statistik', 'STATISTIC'], [119, 7, 'Trinkgeld', 'TIP'], [60, 0, 'Keine Zuordnung', 'NONE'],
    ].map(([id, number, name, type]) => ({ id, number, name, description: 'Dummy', active: 'Y', type, fixed_number: 'N' }))
  }
  if (liste === 'detailcategory') {
    return [[501, 1, 'Heissgetraenke', 221], [502, 2, 'Hauptgerichte', 222], [503, 3, 'Infotexte_older', 223]]
      .map(([id, number, name, category]) => ({ id, number, name, description: null, active: 'Y', category, classification: null }))
  }
  if (liste === 'category') {
    return [[221, 1, 'Getraenke warm', 1], [222, 2, 'Speisen', 2], [223, 3, 'Sonstiges', 5]]
      .map(([id, number, name, grosscategory]) => ({ id, number, name, description: null, active: 'Y', grosscategory }))
  }
  if (liste === 'grosscategory') {
    // Zwei Einträge mit derselben id, wie gemessen (68 Einträge, 61 ids) — der erste gilt.
    return [{ id: 1, number: null, name: 'Getränke' }, { id: 2, number: 2, name: 'Speisen' },
            { id: 2, number: null, name: 'Speisen_older' }, { id: 5, number: null, name: 'Sonstiges / Divers' }]
  }
  if (liste === 'attributes') {
    return [{ attributeType: 'allergen', attributeId: 57, attributeName: 'Gluten', unit: null }]
  }
  return [
    { id: 1, number: 10, name: `${liste} eins` },
    { id: 2, number: 20, name: `${liste} zwei` },
  ]
}

const MODUL_NAME = { personal: 'Personal', revenue: 'Revenue', artikel: 'Artikelstammdaten' } as const

export function tpapiMockStarten(opt: TpapiMockOptionen) {
  const nachSchluessel = new Map(Object.entries(opt.schluessel).map(([enc, k]) => [k, enc]))
  const gebremstFuer = new Set<string>()
  let gebremst = 0
  let nr = 0
  const aufrufe: TpapiMockAufruf[] = []
  const jeBetrieb = new Map<string, number>()

  const json = (status: number, wert: unknown) =>
    new Response(JSON.stringify(wert), { status, headers: { 'content-type': 'application/json' } })

  const server = Bun.serve({
    port: opt.port ?? 0,
    fetch(req) {
      const url = new URL(req.url)
      const apikey = req.headers.get('apikey')
      const encId = apikey ? nachSchluessel.get(apikey) ?? null : null
      const businessdate = url.searchParams.get('businessdate')
      const eintrag: TpapiMockAufruf = {
        pfad: url.pathname, methode: req.method, apikey, accept: req.headers.get('accept'),
        businessdate, encId, status: 0, zeit: Date.now(),
      }
      aufrufe.push(eintrag)
      const antworte = (r: Response) => { eintrag.status = r.status; return r }

      if (!encId) {
        return antworte(json(401, { status: 'error', message: 'Invalid API key' }))
      }
      if (opt.nichtLizenziert?.includes(encId)) {
        return antworte(json(403, { status: 'error', message: "Module 'Personal' not licensed" }))
      }
      if (gebremst < (opt.bremsen ?? 0)) {
        gebremst++
        return antworte(json(429, { status: 'error', message: 'Too Many Requests' }))
      }
      if (opt.bremsenFuer?.includes(encId) && !gebremstFuer.has(encId)) {
        gebremstFuer.add(encId)
        return antworte(json(429, { status: 'error', message: 'Too Many Requests' }))
      }
      if (opt.serverfehlerFuer?.includes(encId)) {
        return antworte(new Response('<html><body>Internal Server Error</body></html>',
          { status: 500, headers: { 'content-type': 'text/html' } }))
      }
      const pfad = url.pathname.replace(/^\/extern\//, '')
      const modul = pfad.startsWith('personal/') ? 'personal'
        : pfad.startsWith('revenue/') ? 'revenue'
        : pfad.startsWith('merchandiseman/') ? 'artikel' : null
      const n = (jeBetrieb.get(encId) ?? 0) + 1
      jeBetrieb.set(encId, n)
      if (opt.bremsenAb?.[encId] !== undefined && n >= opt.bremsenAb[encId]!) {
        return antworte(json(429, { status: 'error', message: 'API-Calls exhausted' }))
      }
      if (modul && opt.module?.[encId] && !opt.module[encId]!.includes(modul)) {
        return antworte(json(403, { status: 'error', message: `Module '${MODUL_NAME[modul]}' not licensed` }))
      }
      if (pfad !== 'personal/personalkostenprostunde') {
        const datumNoetig = ['revenue/journal', 'revenue/journaltables', 'personal/personalkostenprotag'].includes(pfad)
        if (datumNoetig && (!businessdate || !/^\d{2}\.\d{2}\.\d{4}$/.test(businessdate))) {
          return antworte(json(400, { status: 'error', message: 'businessdate missing' }))
        }
        if (opt.serverfehlerWenn?.(pfad, encId, businessdate)) {
          return antworte(new Response('<html><body>Internal Server Error</body></html>',
            { status: 500, headers: { 'content-type': 'text/html' } }))
        }
        const eigen = opt.antwortStufe2?.(pfad, encId, businessdate, url.searchParams)
        if (eigen !== undefined) return antworte(json(200, eigen))
        if (pfad === 'revenue/listdays') {
          const tage = opt.tage?.[encId] ?? Array.from({ length: opt.listdaysTage ?? 10 }, (_, i) => {
            const d = new Date(Date.now() - (i + 1) * 86_400_000)
            return d.toISOString().slice(0, 10)
          })
          return antworte(json(200, tage.map(t => ({ businessdate: epochFuerTag(t, opt.listdaysUtc) }))))
        }
        if (pfad === 'revenue/journal') return antworte(json(200, journalZeilen(businessdate!)))
        if (pfad === 'revenue/journaltables') return antworte(json(200, tischZeilen(businessdate!)))
        if (pfad === 'personal/personalkostenprotag') {
          return antworte(json(200, opt.leer?.includes(encId) ? [] : protagZeilen(businessdate!)))
        }
        if (pfad === 'revenue/getforecastperday') {
          const from = url.searchParams.get('from'), to = url.searchParams.get('to')
          if (!from || !to || !/^\d{2}\.\d{2}\.\d{4}$/.test(from) || !/^\d{2}\.\d{2}\.\d{4}$/.test(to)) {
            return antworte(json(400, { status: 'error', message: 'from/to missing' }))
          }
          return antworte(json(200, prognoseZeilen(from, to)))
        }
        if (pfad.startsWith('merchandiseman/') && !pfad.slice(15).includes('/')) {
          return antworte(json(200, stammZeilen(pfad.slice(15))))
        }
        return antworte(json(404, { status: 'error', message: 'not found' }))
      }
      if (!businessdate || !/^\d{2}\.\d{2}\.\d{4}$/.test(businessdate)) {
        return antworte(json(400, { status: 'error', message: 'businessdate missing' }))
      }
      nr++
      if (opt.antwort) return antworte(json(200, opt.antwort(encId, businessdate, nr)))
      if (opt.leer?.includes(encId)) return antworte(json(200, { eff: {}, kost: {}, kostUser: {} }))
      return antworte(json(200, vorgabeAntwort(businessdate)))
    },
  })

  return {
    url: `http://localhost:${server.port}`,
    aufrufe,
    stoppen: () => server.stop(true),
  }
}
