/**
 * Der Anmeldeablauf gegen die LINA-Attrappe.
 *
 * Braucht keine Datenbank. Der Test existiert, weil der erste echte Lauf an
 * genau dieser Stelle scheiterte ("Login 200, Probe 302"): das sichtbare
 * Formular legt einen POST auf /login mit Klartextpasswort nahe, tatsächlich
 * geht der POST auf /common/index/dologin, das Passwort als MD5-Hex, dazu ein
 * secret aus der Loginseite. Die Attrappe lehnt jede andere Variante ab.
 */
import { expect, test, describe, beforeAll, afterAll } from 'bun:test'
import { createHash } from 'node:crypto'
import { mockStarten } from './mock'

const md5 = (s: string) => createHash('md5').update(s).digest('hex')

describe('Anmeldung', () => {
  let mock: ReturnType<typeof mockStarten>
  let auth: typeof import('./auth')

  /**
   * Die Sitzung bekommt ihren Zugang als Wert. Bewusst NICHT über
   * process.env: bun test teilt die Modulregistrierung über Testdateien
   * hinweg, die Konfiguration wird also einmal geladen und friert dabei die
   * Werte der zuerst gelaufenen Datei ein. Genau daran ist dieser Test
   * einmal gescheitert.
   */
  const sitzung = () => new auth.LinaSession({
    basis: mock.url,
    benutzer: 'testuser',
    passwort: 'geheim',
    hashverfahren: 'md5',
    system: 'a360',
  })

  beforeAll(async () => {
    mock = mockStarten({ benutzer: 'testuser', passwort: 'geheim' })
    // config wird beim Import geprüft und braucht diese beiden Werte —
    // benutzt werden sie hier nicht.
    process.env.DATABASE_URL ??= 'postgres://ungenutzt/ungenutzt'
    process.env.LINA_USER ??= 'ungenutzt'
    process.env.LINA_PASSWORD ??= 'ungenutzt'
    process.env.LOG_LEVEL ??= 'error'
    auth = await import('./auth')
  })

  afterAll(() => mock.stop())

  test('findet window.secret in der Loginseite', () => {
    const s = 'a'.repeat(64)
    expect(auth.secretAusSeite(`<script>window.secret = '${s}';</script>`)).toBe(s)
    expect(auth.secretAusSeite(`<input name="secret" value="${s}">`)).toBe(s)
    expect(auth.secretAusSeite('<html>ohne</html>')).toBeNull()
  })

  test('meldet an — MD5, secret und dologin stimmen', async () => {
    const s = sitzung()
    await s.anmelden()
    expect(s.istAngemeldet).toBe(true)
    expect(mock.anmeldungen).toBe(1)
  })

  test('gibt sich konsistent als Windows-Chrome aus', async () => {
    const s = sitzung()
    await s.anmelden()
    const h = mock.letzteHeader

    // Kennung und Client-Hints müssen dieselbe Version nennen — ein Chrome,
    // dessen sec-ch-ua einer anderen Version widerspricht, gibt es nicht.
    const version = auth.chromeHauptversion(h['user-agent'] ?? '')
    expect(h['user-agent']).toContain('Windows NT 10.0; Win64; x64')
    expect(h['sec-ch-ua']).toContain(`"Google Chrome";v="${version}"`)
    expect(h['sec-ch-ua-platform']).toBe('"Windows"')
    expect(h['sec-ch-ua-mobile']).toBe('?0')
    // Chrome schickt auf jedem Aufruf Fetch-Metadaten mit; ohne sie passt das
    // Gesamtbild nicht.
    expect(h['sec-fetch-site']).toBe('same-origin')
    expect(h['accept-language']).toContain('de-DE')
  })

  test('chromeHauptversion liest die Version aus der Kennung', () => {
    expect(auth.chromeHauptversion('... Chrome/149.0.0.0 Safari/537.36')).toBe('149')
    expect(auth.chromeHauptversion('irgendwas ohne Chrome')).toBe('149')
  })

  test('erkennt die Loginseite als abgelaufene Session', async () => {
    const res = await fetch(`${mock.url}/common/api/account`)
    const koerper = await res.text()
    expect(auth.sessionAbgelaufen(res, koerper)).toBe(true)
  })

  test('falsches Passwort scheitert und wird NICHT wiederholt', async () => {
    const vorher = mock.anmeldungen
    // Klartext statt Hash ist genau der Fehler, der beim ersten echten Lauf
    // auftrat — die Attrappe muss ihn ablehnen.
    const falsch = await fetch(`${mock.url}/common/index/dologin`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'testuser', password: 'geheim', secret: md5('x') + md5('y'), system: 'a360' }),
    })
    // Auch der Fehlerfall ist 200 mit JSON — der Statuscode sagt hier nichts.
    expect(falsch.status).toBe(200)
    expect(auth.dologinAntwortLesen(await falsch.text()).status).toBe('ERROR')
    expect(mock.anmeldungen).toBe(vorher + 1)
  })

  test('ein secret gilt nur einmal', async () => {
    const seite = await fetch(`${mock.url}/login`)
    const secret = auth.secretAusSeite(await seite.text())!
    const felder = () => new URLSearchParams({
      username: 'testuser', password: md5('geheim'), secret, system: 'a360',
    })
    const kopf = { 'content-type': 'application/x-www-form-urlencoded' }
    const lesen = async (r: Response) => auth.dologinAntwortLesen(await r.text())
    const erst = await fetch(`${mock.url}/common/index/dologin`,
      { method: 'POST', redirect: 'manual', headers: kopf, body: felder() })
    // Beide Aufrufe antworten mit 200; unterschieden wird an `status`.
    expect(erst.status).toBe(200)
    expect((await lesen(erst)).status).toBe('SUCCESS')
    const zweit = await fetch(`${mock.url}/common/index/dologin`,
      { method: 'POST', redirect: 'manual', headers: kopf, body: felder() })
    expect(zweit.status).toBe(200)
    expect((await lesen(zweit)).status).toBe('ERROR')
  })

  test('dologinAntwortLesen verträgt alles, was kein JSON-Objekt ist', () => {
    expect(auth.dologinAntwortLesen('{"status":"ERROR","message":"x"}'))
      .toEqual({ status: 'ERROR', message: 'x' })
    expect(auth.dologinAntwortLesen('<html>kaputt</html>')).toEqual({})
    expect(auth.dologinAntwortLesen('[1,2]')).toEqual({})
    expect(auth.dologinAntwortLesen('null')).toEqual({})
    expect(auth.dologinAntwortLesen('')).toEqual({})
  })

  /**
   * Der eigentliche Befund vom 25.07.2026: LINA schickt seinen Grund im Klartext
   * mit, unser Fehler warf ihn weg und nannte stattdessen nur die Antwortlänge.
   * Das hat die Ursache ("Zugangsdaten falsch") als Hash- und Systemproblem
   * getarnt. Die Meldung muss deshalb durchgereicht werden.
   */
  test('reicht LINAs eigene Fehlermeldung durch', async () => {
    const s = new auth.LinaSession({
      basis: mock.url,
      benutzer: 'testuser',
      passwort: 'falschespasswort',
      hashverfahren: 'md5',
      system: 'a360',
    })
    await expect(s.anmelden()).rejects.toThrow('Benutzername oder Passwort ist falsch!')
    expect(s.istAngemeldet).toBe(false)
  })

  /** Das Klartextpasswort darf unter keinen Umständen in der Meldung landen. */
  test('nennt das Passwort nicht in der Fehlermeldung', async () => {
    const s = new auth.LinaSession({
      basis: mock.url,
      benutzer: 'testuser',
      passwort: 'streng-geheimes-passwort',
      hashverfahren: 'md5',
      system: 'a360',
    })
    const fehler = await s.anmelden().catch((e: Error) => e)
    expect((fehler as Error).message).not.toContain('streng-geheimes-passwort')
    expect((fehler as Error).message).not.toContain(md5('streng-geheimes-passwort'))
  })
})
