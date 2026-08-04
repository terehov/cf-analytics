/**
 * FoodNotify-Anmeldung. Ein Objekt je Mandant — vier Marken, vier Konten,
 * vier getrennte Sitzungen.
 *
 * Das Protokoll, am 02.08.2026 aus dem Login-Chunk der /brew/-SPA gelesen
 * (brew-assets/login-*.js), nicht geraten:
 *
 *     POST /api/user/auth/signin_check
 *     {"email": …, "password": …, "rememberMe": false}
 *
 *     Antwort: {type: "LoginSuccess" | "LoginChallenge" | "LoginSetup"}
 *
 * `LoginChallenge` heißt: 2FA ist aktiv, ein Code wird verlangt
 * (`/api/user/auth/2fa/check`). `LoginSetup` heißt: das Konto soll 2FA erst
 * einrichten. Beides kann ein Importer nicht beantworten — er bricht ab und
 * sagt, was zu tun ist. KEIN zweiter Versuch: Regel 7 aus AGENTS.md gilt
 * hier verschärft, denn es gibt vier Konten und keinen Support-Draht.
 *
 * Die Sitzung hängt danach an einem **HttpOnly-Cookie** — gemessen am
 * 01.08.2026: kein Token im localStorage, `/api/profile` antwortet trotzdem.
 * Das Inventar (§1) vermutete JWT; das stimmt so nicht. Für uns ist das die
 * gute Nachricht: dasselbe Muster wie bei LINA, ein Cookie-Jar reicht.
 */
import { config } from '../config'
import type { FnZugang } from '../config'
import { log } from '../lib/log'
import { auspacken } from './huelle'

export class FnAnmeldungFehlgeschlagen extends Error {
  constructor(meldung: string, public readonly marke: string) {
    super(meldung)
    this.name = 'FnAnmeldungFehlgeschlagen'
  }
}

export class FnSession {
  private cookies = new Map<string, string>()
  /**
   * Aus /api/profile direkt nach der Anmeldung. `fn:betriebe` braucht sie im
   * Pfad (/api/core/business/{userId}/restaurants) — sie ist eine Eigenschaft
   * der Sitzung, kein Posten-Parameter.
   */
  benutzerId: number | null = null

  constructor(readonly zugang: FnZugang) {}

  get istAngemeldet(): boolean {
    return this.cookies.size > 0
  }

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  cookiesUebernehmen(res: Response) {
    const roh = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
    for (const zeile of roh) {
      const paar = zeile.split(';')[0] ?? ''
      const idx = paar.indexOf('=')
      if (idx > 0) this.cookies.set(paar.slice(0, idx).trim(), paar.slice(idx + 1).trim())
    }
  }

  /**
   * Header für API-Aufrufe. Die Browserkennung ist dieselbe wie bei LINA —
   * sie heißt in der Konfiguration nur historisch `LINA_USER_AGENT`; gemeint
   * ist die eine Kennung des einen Clients.
   */
  header(): Record<string, string> {
    return {
      accept: 'application/json',
      'user-agent': config.LINA_USER_AGENT,
      cookie: this.cookieHeader(),
    }
  }

  async anmelden(): Promise<void> {
    this.cookies.clear()
    this.benutzerId = null
    const marke = this.zugang.schluessel

    const res = await fetch(`${config.FN_BASE_URL}/api/user/auth/signin_check`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': config.LINA_USER_AGENT,
      },
      body: JSON.stringify({
        email: this.zugang.user,
        password: this.zugang.password,
        rememberMe: false,
      }),
      signal: AbortSignal.timeout(config.ANFRAGE_TIMEOUT_MS),
    })
    this.cookiesUebernehmen(res)

    const text = await res.text()
    if (!res.ok) {
      // 401 = falsche Zugangsdaten. Die Meldung nennt die Marke, denn bei
      // vier Konten ist "Anmeldung fehlgeschlagen" allein keine Diagnose.
      throw new FnAnmeldungFehlgeschlagen(
        `Anmeldung ${marke}: HTTP ${res.status} — kein weiterer Versuch (AGENTS.md Regel 7)`, marke)
    }

    let typ = ''
    try {
      const antwort = auspacken(JSON.parse(text))
      typ = String((antwort.daten as Record<string, unknown> | null)?.type ?? '')
    } catch {
      throw new FnAnmeldungFehlgeschlagen(
        `Anmeldung ${marke}: Antwort ist kein JSON (beginnt mit "${text.slice(0, 60)}")`, marke)
    }

    if (typ === 'LoginChallenge' || typ === 'LoginSetup') {
      // 2FA. Absehbar war das: das Inventar (§1) nennt E-Mail, TOTP und
      // Trusted Devices. Die Antwort darauf ist ein eigener Zugang ohne 2FA
      // oder ein lesender Subuser — keine Wiederholung mit demselben Konto.
      throw new FnAnmeldungFehlgeschlagen(
        `Anmeldung ${marke}: das Konto verlangt 2FA (${typ}). ` +
        `Automatisiertes Anmelden braucht einen Zugang ohne 2FA — ` +
        `einen lesenden Subuser anlegen (/api/subusers zeigt, dass FoodNotify das kann).`, marke)
    }
    if (typ !== 'LoginSuccess') {
      throw new FnAnmeldungFehlgeschlagen(
        `Anmeldung ${marke}: unerwarteter Antworttyp "${typ}"`, marke)
    }
    if (!this.istAngemeldet) {
      throw new FnAnmeldungFehlgeschlagen(
        `Anmeldung ${marke}: LoginSuccess, aber kein Session-Cookie in der Antwort`, marke)
    }

    /**
     * Benutzer-ID gleich mitnehmen. Ein zweiter Aufruf direkt nach dem Login
     * ist unauffällig — auch der Browser lädt nach der Anmeldung sofort das
     * Profil. Scheitert er, bleibt die Sitzung nutzbar; nur `fn:betriebe`
     * braucht die ID und meldet dann selbst, dass sie fehlt.
     */
    try {
      const profil = await fetch(`${config.FN_BASE_URL}/api/profile`, {
        headers: this.header(),
        signal: AbortSignal.timeout(config.ANFRAGE_TIMEOUT_MS),
      })
      const p = auspacken(await profil.json())
      const id = Number((p.daten as Record<string, unknown> | null)?.id)
      this.benutzerId = Number.isFinite(id) ? id : null
    } catch (e) {
      log.warn('profil nach anmeldung nicht lesbar', { marke, fehler: String(e).slice(0, 200) })
    }

    log.info('foodnotify angemeldet', { marke, benutzerId: this.benutzerId })
  }
}

/**
 * Abgelaufene Sitzung erkennen. FoodNotify antwortet auf API-Aufrufe ohne
 * gültige Sitzung mit 401 (JSON) oder leitet auf die Login-Seite um.
 */
export function fnSessionAbgelaufen(res: Response): boolean {
  if (res.status === 401) return true
  const ort = res.headers.get('location') ?? ''
  return res.status >= 300 && res.status < 400 && /login/i.test(ort)
}
