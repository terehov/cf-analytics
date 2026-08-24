/**
 * Bounti-Attrappe für die Tests.
 *
 * Bildet die Schnittstelle so nach, wie die OpenAPI-Spezifikation sie
 * beschreibt (am 24.08.2026 von api.bounti.co gezogen) — und dazu die
 * Abweichungen, die dieser Client abfangen können muss:
 *
 *   * die Hülle {next, rows} mit Cursor-Blättern
 *   * /roles OHNE Hülle, als blankes Array
 *   * HTTP 400 auf eine zu grosse `limit` — die Spezifikation schreibt die
 *     Obergrenze nur bei einem einzigen Endpunkt aus, überall sonst ist 100
 *     eine Annahme
 *   * HTTP 429 mit Retry-After
 *   * die RateLimit-Kopfzeilen
 *   * einen Cursor, der sich nicht bewegt — die einzige Antwort, mit der
 *     eine fremde API einen unbeaufsichtigten Nachtlauf endlos drehen lässt
 *
 * NUR FÜR TESTS. Läuft nie im Container mit.
 */
export type BountiMockOptionen = {
  port?: number
  /** Wie viele Standorte die Attrappe führt. */
  standorte?: number
  /** Grösste akzeptierte Seitengrösse; darüber HTTP 400. */
  limitMax?: number
  /** So oft mit 429 antworten, bevor es normal weitergeht. */
  bremsen?: number
  /** Was RateLimit-Remaining meldet. */
  rest?: number
  /** Immer denselben Cursor zurückgeben — die Endlosschleife. */
  cursorKlemmt?: boolean
  /** Gültiges Token; alles andere bekommt HTTP 403. */
  token?: string
}

export function bountiMockStarten(opt: BountiMockOptionen = {}) {
  const anzahl = opt.standorte ?? 5
  const limitMax = opt.limitMax ?? 100
  const token = opt.token ?? 'testtoken'
  let gebremst = 0
  /** Jede Anfrage mit Pfad und Parametern — die Tests lesen daraus. */
  const aufrufe: { pfad: string; methode: string; limit: string | null; cursor: string | null }[] = []

  const server = Bun.serve({
    port: opt.port ?? 0,
    fetch(req) {
      const url = new URL(req.url)
      aufrufe.push({
        pfad: url.pathname, methode: req.method,
        limit: url.searchParams.get('limit'), cursor: url.searchParams.get('cursor'),
      })

      const kopf: Record<string, string> = {
        'content-type': 'application/json',
        'ratelimit-limit': '3000',
        'ratelimit-remaining': String(opt.rest ?? 2900),
        'ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
      }

      if (req.headers.get('authorization') !== `Bearer ${token}`) {
        return new Response(JSON.stringify({
          error: 'INVALID_API_KEY', message: 'The provided API key is not valid',
        }), { status: 403, headers: kopf })
      }

      if (gebremst < (opt.bremsen ?? 0)) {
        gebremst++
        return new Response(JSON.stringify({ error: 'RATE_LIMITED', message: 'slow down' }),
          { status: 429, headers: { ...kopf, 'retry-after': '0' } })
      }

      const limit = Number(url.searchParams.get('limit') ?? '20')
      if (limit > limitMax) {
        return new Response(JSON.stringify({
          error: 'BAD_REQUEST', message: `limit must be between 1 and ${limitMax}`,
        }), { status: 400, headers: kopf })
      }

      // /roles: blankes Array, keine Huelle -- so steht es in der Spezifikation.
      if (url.pathname === '/external/v1/roles') {
        return new Response(JSON.stringify([
          { id: 'r1', name: 'Kueche' }, { id: 'r2', name: 'Service' },
        ]), { headers: kopf })
      }

      if (url.pathname === '/external/v1/locations') {
        const ab = Number(url.searchParams.get('cursor') ?? '0')
        const rows = []
        for (let i = ab; i < Math.min(ab + limit, anzahl); i++) {
          rows.push({ id: `loc${i}`, name: `Standort ${i}` })
        }
        const weiter = ab + limit < anzahl
        const next = opt.cursorKlemmt ? '0' : (weiter ? String(ab + limit) : null)
        return new Response(JSON.stringify({ next, rows }), { headers: kopf })
      }

      return new Response(JSON.stringify({ error: 'NOT_FOUND', message: url.pathname }),
        { status: 404, headers: kopf })
    },
  })

  return {
    url: `http://localhost:${server.port}`,
    aufrufe,
    stoppen: () => server.stop(true),
  }
}
