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
  /** Eigene Antwort je Aufruf; gewinnt vor der Vorgabe, nicht vor 401/403/429/500. */
  antwort?: (encId: string, businessdate: string, nr: number) => unknown
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

export function tpapiMockStarten(opt: TpapiMockOptionen) {
  const nachSchluessel = new Map(Object.entries(opt.schluessel).map(([enc, k]) => [k, enc]))
  const gebremstFuer = new Set<string>()
  let gebremst = 0
  let nr = 0
  const aufrufe: TpapiMockAufruf[] = []

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
      if (url.pathname !== '/extern/personal/personalkostenprostunde') {
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
