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
  antwortStufe2?: (pfad: string, encId: string, businessdate: string | null) => unknown
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

function journalZeilen(businessdate: string, n = 5): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => {
    const z: Record<string, unknown> = Object.fromEntries(JOURNAL_FELDER.map(f => [f, 0]))
    z.ID = 1000 + i; z.datum = `${businessdate} 1${i}:00:00`; z.art = i % 2 ? 'Z' : 'V'
    z.artnr = 300200 + i; z.zahl = 1; z.balance = i % 2 ? -12.5 : 12.5; z.finanzweg = i % 2 ? 20 : 1
    z.kellnernr = 7; z.addinfo = 'Freitext vom Gast'; z.tisch = 12
    return z
  })
}

function tischZeilen(n = 3): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => {
    const z: Record<string, unknown> = Object.fromEntries(JOURNALTABLES_FELDER.map(f => [f, 0]))
    z.tableheader_id = 500 + i; z.table_number = 10 + i; z.number_adults = 2 + i; z.number_kids = i % 2
    z.debitor_text = 'Firma Muster'; z.zip_code = '80331'
    return z
  })
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
        const eigen = opt.antwortStufe2?.(pfad, encId, businessdate)
        if (eigen !== undefined) return antworte(json(200, eigen))
        if (pfad === 'revenue/listdays') {
          const tage = opt.tage?.[encId] ?? Array.from({ length: opt.listdaysTage ?? 10 }, (_, i) => {
            const d = new Date(Date.now() - (i + 1) * 86_400_000)
            return d.toISOString().slice(0, 10)
          })
          return antworte(json(200, tage.map(t => ({ businessdate: epochFuerTag(t, opt.listdaysUtc) }))))
        }
        if (pfad === 'revenue/journal') return antworte(json(200, journalZeilen(businessdate!)))
        if (pfad === 'revenue/journaltables') return antworte(json(200, tischZeilen()))
        if (pfad === 'personal/personalkostenprotag') {
          return antworte(json(200, opt.leer?.includes(encId) ? [] : protagZeilen(businessdate!)))
        }
        if (pfad === 'revenue/getforecastperday') return antworte(json(200, []))
        if (pfad.startsWith('merchandiseman/') && !pfad.slice(15).includes('/')) {
          return antworte(json(200, [
            { id: 1, number: 10, name: `${pfad.slice(15)} eins` },
            { id: 2, number: 20, name: `${pfad.slice(15)} zwei` },
          ]))
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
