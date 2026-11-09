/**
 * Der TPAPI-Client gegen die Attrappe — ohne Datenbank.
 *
 * WAS HIER GEPRÜFT WIRD, ist ausnahmslos etwas, das im Betrieb STILL
 * schiefginge:
 *
 *   * ein falscher Header — LINA antwortet dann 401, und das sähe aus wie ein
 *     gesperrter Schlüssel
 *   * ein Takt, der nicht greift — bei 41 Läden und dokumentierten 100
 *     Anfragen je 15 Minuten der schnellste Weg in 429, für uns UND für die
 *     anderen Anbieter am selben Laden (Regel 3)
 *   * „not licensed" als Abweisung gelesen — dann stünde ein Betrieb ohne
 *     Buchung als Rechteproblem da und würde jede Nacht neu gefragt
 *   * ein Retry nach 401/403/429 (Regel 7)
 *   * ein Schlüssel in einer Meldung — Meldungen gehen ins Log, nach
 *     `sync.tpapi_zugang` und nach `raw`
 *
 * Alle Clients bekommen Basis und Schlüssel AUSDRÜCKLICH. `bun test` lädt die
 * `.env`, und dort stehen die echten Schlüssel — ein Client mit Vorgaben
 * spräche mit `api.lina.de` (Regel 7a).
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { tpapiMockStarten } from './mock'
import { einordnen, PFAD_PERSONAL_STUNDE, sauber, TpapiClient } from './client'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const SCHLUESSEL = { [A]: 'schluessel-aaaa-1111', [B]: 'schluessel-bbbb-2222', [C]: 'schluessel-cccc-3333' }

const mock = tpapiMockStarten({
  schluessel: SCHLUESSEL, nichtLizenziert: [B], bremsenFuer: [C],
})
afterAll(() => mock.stoppen())

const neu = (taktMs = 0, schluessel: Record<string, string> = SCHLUESSEL) =>
  new TpapiClient({ basis: mock.url + '/', schluessel, taktMs, timeoutMs: 5_000 })

describe('Aufruf', () => {
  test('Header apikey und accept, Pfad unter /extern/, businessdate als Parameter, nur GET', async () => {
    mock.aufrufe.length = 0
    const a = await neu().holen(A, PFAD_PERSONAL_STUNDE, { businessdate: '01.11.2026' })
    expect(a.art).toBe('ok')
    expect(a.status).toBe(200)
    expect(a.meldung).toBeNull()
    const x = mock.aufrufe[0]!
    // Basis mit abschließendem Schrägstrich übergeben — kein `//extern/`.
    expect(x.pfad).toBe('/extern/personal/personalkostenprostunde')
    expect(x.apikey).toBe(SCHLUESSEL[A])
    expect(x.accept).toBe('application/json')
    expect(x.businessdate).toBe('01.11.2026')
    expect(x.methode).toBe('GET')
  })

  test('die Antwort kommt mit kostUser zurück — entfernt wird erst vor raw', async () => {
    const a = await neu().holen(A, PFAD_PERSONAL_STUNDE, { businessdate: '02.11.2026' })
    const d = a.daten as Record<string, unknown>
    expect(Object.keys(d).sort()).toEqual(['eff', 'kost', 'kostUser'])
    expect(a.roh).toContain('161.42000000000002')
  })

  test('ohne Schlüssel für die encId: kein Aufruf, Ausgang fehler', async () => {
    mock.aufrufe.length = 0
    const a = await neu().holen('d'.repeat(40), PFAD_PERSONAL_STUNDE, { businessdate: '01.11.2026' })
    expect(a.art).toBe('fehler')
    expect(a.status).toBe(0)
    expect(mock.aufrufe).toHaveLength(0)
  })

  test('Zähler je Betrieb und gesamt', async () => {
    const c = neu()
    await c.holen(A, PFAD_PERSONAL_STUNDE, { businessdate: '01.11.2026' })
    await c.holen(A, PFAD_PERSONAL_STUNDE, { businessdate: '02.11.2026' })
    await c.holen(B, PFAD_PERSONAL_STUNDE, { businessdate: '01.11.2026' })
    expect(c.aufrufe(A)).toBe(2)
    expect(c.aufrufe(B)).toBe(1)
    expect(c.aufrufe(C)).toBe(0)
    expect(c.aufrufeGesamt()).toBe(3)
  })
})

describe('Takt', () => {
  test('mindestens taktMs zwischen zwei Aufrufen derselben Instanz', async () => {
    mock.aufrufe.length = 0
    const c = neu(150)
    const t0 = Date.now()
    for (const tag of ['01.11.2026', '02.11.2026', '03.11.2026']) {
      await c.holen(A, PFAD_PERSONAL_STUNDE, { businessdate: tag })
    }
    const z = mock.aufrufe.map(a => a.zeit)
    expect(z).toHaveLength(3)
    // Ein paar Millisekunden Spiel für die Uhr des Servers.
    expect(z[1]! - z[0]!).toBeGreaterThanOrEqual(140)
    expect(z[2]! - z[1]!).toBeGreaterThanOrEqual(140)
    // Der ERSTE Aufruf wartet nicht.
    expect(z[0]! - t0).toBeLessThan(100)
  })

  test('auch über Betriebe hinweg — der Takt gehört der Instanz, nicht dem Laden', async () => {
    mock.aufrufe.length = 0
    const c = neu(150)
    await c.holen(A, PFAD_PERSONAL_STUNDE, { businessdate: '01.11.2026' })
    await c.holen(B, PFAD_PERSONAL_STUNDE, { businessdate: '01.11.2026' })
    const z = mock.aufrufe.map(a => a.zeit)
    expect(z[1]! - z[0]!).toBeGreaterThanOrEqual(140)
  })
})

describe('Einordnung', () => {
  test('403 not licensed ist nicht_lizenziert, kein abgewiesen', async () => {
    const a = await neu().holen(B, PFAD_PERSONAL_STUNDE, { businessdate: '01.11.2026' })
    expect(a.art).toBe('nicht_lizenziert')
    expect(a.status).toBe(403)
    expect(a.meldung).toContain('not licensed')
  })

  test('unbekannter Schlüssel: 401 → abgewiesen, und ohne Wiederholung', async () => {
    mock.aufrufe.length = 0
    const fremd = { [A]: 'ganz-anderer-schluessel-9999' }
    const a = await neu(0, fremd).holen(A, PFAD_PERSONAL_STUNDE, { businessdate: '01.11.2026' })
    expect(a.art).toBe('abgewiesen')
    expect(a.status).toBe(401)
    expect(mock.aufrufe).toHaveLength(1)
  })

  test('429 → gebremst, ohne Wiederholung; der nächste Aufruf ist wieder normal', async () => {
    mock.aufrufe.length = 0
    const c = neu()
    const a = await c.holen(C, PFAD_PERSONAL_STUNDE, { businessdate: '01.11.2026' })
    expect(a.art).toBe('gebremst')
    expect(mock.aufrufe).toHaveLength(1)
    expect((await c.holen(C, PFAD_PERSONAL_STUNDE, { businessdate: '01.11.2026' })).art).toBe('ok')
  })

  test('500 mit HTML → fehler, daten null', async () => {
    const m = tpapiMockStarten({ schluessel: SCHLUESSEL, serverfehlerFuer: [A] })
    try {
      const a = await new TpapiClient({ basis: m.url, schluessel: SCHLUESSEL, taktMs: 0 })
        .holen(A, PFAD_PERSONAL_STUNDE, { businessdate: '01.11.2026' })
      expect(a.art).toBe('fehler')
      expect(a.status).toBe(500)
      expect(a.daten).toBeNull()
      expect(a.meldung).toContain('HTTP 500')
    } finally { m.stoppen() }
  })

  test('Netzfehler → fehler mit Status 0', async () => {
    // Port 9 (discard) ist lokal zu — die Verbindung scheitert sofort.
    const a = await new TpapiClient({ basis: 'http://127.0.0.1:9', schluessel: SCHLUESSEL, taktMs: 0, timeoutMs: 2_000 })
      .holen(A, PFAD_PERSONAL_STUNDE, { businessdate: '01.11.2026' })
    expect(a.art).toBe('fehler')
    expect(a.status).toBe(0)
    expect(a.meldung).toContain('Netzfehler')
  })

  test('die Regel als Tabelle', () => {
    const lic = { status: 'error', message: "Module 'Revenue' not licensed" }
    expect(einordnen(200, { eff: {} }, '{}')).toBe('ok')
    expect(einordnen(200, null, '<html>')).toBe('fehler')
    expect(einordnen(403, lic, JSON.stringify(lic))).toBe('nicht_lizenziert')
    // Welche Nummer LINA für eine fehlende Buchung nimmt, ist an einem Endpunkt gemessen.
    expect(einordnen(401, lic, JSON.stringify(lic))).toBe('nicht_lizenziert')
    expect(einordnen(403, { message: 'Forbidden' }, '')).toBe('abgewiesen')
    expect(einordnen(429, null, '')).toBe('gebremst')
    expect(einordnen(302, null, '')).toBe('fehler')
    expect(einordnen(404, null, '')).toBe('fehler')
    expect(einordnen(502, null, '')).toBe('fehler')
  })
})

describe('sauber()', () => {
  test('ersetzt jeden Schlüssel, auch mehrfach', () => {
    const t = `x ${SCHLUESSEL[A]} y ${SCHLUESSEL[B]} z ${SCHLUESSEL[A]}`
    const s = sauber(t, Object.values(SCHLUESSEL))
    expect(s).toBe('x <schluessel> y <schluessel> z <schluessel>')
  })

  test('längster zuerst — ein Präfix lässt keinen Rest stehen', () => {
    expect(sauber('k=abc123456', ['abc', 'abc123456'])).toBe('k=<schluessel>')
  })

  test('leere Werte zerlegen den Text nicht', () => {
    expect(sauber('abc', ['', 'x'])).toBe('abc')
  })

  test('eine Fehlerseite, die den Schlüssel zitiert, kommt gesäubert zurück — roh, daten und meldung', async () => {
    const zitiert = Bun.serve({
      port: 0,
      fetch: req => new Response(
        JSON.stringify({ status: 'error', message: `key ${req.headers.get('apikey')} is blocked` }),
        { status: 403, headers: { 'content-type': 'application/json' } }),
    })
    try {
      const a = await new TpapiClient({ basis: `http://localhost:${zitiert.port}`, schluessel: SCHLUESSEL, taktMs: 0 })
        .holen(A, PFAD_PERSONAL_STUNDE, { businessdate: '01.11.2026' })
      expect(a.art).toBe('abgewiesen')
      for (const text of [a.roh, JSON.stringify(a.daten), a.meldung ?? '']) {
        expect(text).not.toContain(SCHLUESSEL[A])
        expect(text).toContain('<schluessel>')
      }
    } finally { zitiert.stop(true) }
  })
})
