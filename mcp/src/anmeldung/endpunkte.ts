/**
 * Der Autorisierungsserver: /authorize, /anmelden, /token, /register, /jwks.
 *
 * OAuth 2.1 mit PKCE, auf das Noetige zusammengestrichen. Was hier NICHT
 * steht, weil es niemand braucht: Zustimmungsseiten, Mandanten,
 * Rollenverwaltung, implizite Ablaeufe, Client-Geheimnisse.
 *
 * DIE FUENF DINGE, DIE DIESEN TEIL SICHER MACHEN — jede Auslassung davon
 * waere ein echtes Loch, keine Vereinfachung:
 *
 *   1. PKCE MIT S256 IST PFLICHT. Ohne Pruefwert kein Code. Ein abgefangener
 *      Code nuetzt damit niemandem, der den Verifier nicht hat.
 *   2. DIE RUECKADRESSE WIRD EXAKT VERGLICHEN, gegen die bei der
 *      Registrierung hinterlegte Liste. Kein Praefix, kein Platzhalter —
 *      sonst ist es eine offene Weiterleitung.
 *   3. CODES SIND EINMALIG UND LEBEN 60 SEKUNDEN; das Einloesen entscheidet
 *      die Datenbank, nicht eine Pruefung im Code.
 *   4. AUFFRISCHUNGSTOKENS ROTIEREN, und ein wiederverwendeter widerruft die
 *      ganze Kette.
 *   5. FEHLANMELDUNGEN WERDEN GEBREMST und protokolliert.
 *
 * Und eines, das keine Sicherheitsmassnahme ist, sondern Anstand: es gibt
 * keine Meldung, aus der hervorgeht, ob eine Mailadresse bekannt ist.
 */
import express, { type Express, type Request, type Response } from 'express'
import { anmeldungEingerichtet } from './db'
import { anmeldeseite, fehlerseite } from './seite'
import {
  formulartokenAusstellen, formulartokenPruefen, jwks, zugangstokenAusstellen,
} from './schluessel'
import {
  anmeldungGelungen, anmeldungProtokollieren, auffrischungAusstellen, auffrischungEinloesen,
  clientAnlegen, clientHolen, codeAusstellen, codeEinloesen, fehlversuchMerken, hash,
  nutzerNachEmail, tokensWiderrufen,
} from './speicher'

/** Gueltigkeit eines Zugangstokens. Kurz, weil die Auffrischung billig ist. */
export const TOKEN_SEKUNDEN = 3600

/**
 * Das Discovery-Dokument — an EINER Stelle, damit server.ts (fuer Skybridges
 * /.well-known/oauth-authorization-server) und der OpenID-Alias unten
 * dasselbe sagen.
 */
export function metadaten(basis: string) {
  return {
    issuer: basis,
    authorization_endpoint: `${basis}/authorize`,
    token_endpoint: `${basis}/token`,
    registration_endpoint: `${basis}/register`,
    jwks_uri: `${basis}/jwks`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  }
}

/**
 * Bremse je Herkunft — im Speicher, ohne Abhaengigkeit.
 *
 * REVIEW 13.09.2026: die Sperre nach Fehlversuchen haengt am KONTO. Wer
 * /anmelden mit erfundenen Adressen bombardiert, trifft kein Konto — und
 * kostet trotzdem je Versuch 120 ms argon2, mit Absicht (Zeitangleich). Ohne
 * Bremse je Herkunft ist das ein Rechenzeit-Loch mit einer Zeile Skript; und
 * /register fuellte ohne Bremse die Clienttabelle mit Muell.
 *
 * Bewusst simpel: ein Fenster je Adresse, keine Verteilung ueber Instanzen —
 * es gibt eine. Hinter Dokploys Proxy ist x-forwarded-for die echte Adresse;
 * direkt am Container waere es die des Proxys, und dann bremst die Bremse
 * alle zusammen. Das ist der schlechtere von zwei Fehlern nur, wenn man ihn
 * nicht kennt — deshalb steht er hier.
 */
class Bremse {
  private fenster = new Map<string, number[]>()
  constructor(private readonly hoechstens: number, private readonly proMs: number) {}
  zuViel(schluessel: string): number | null {
    const jetzt = Date.now()
    const liste = (this.fenster.get(schluessel) ?? []).filter(t => jetzt - t < this.proMs)
    if (liste.length >= this.hoechstens) {
      this.fenster.set(schluessel, liste)
      return Math.ceil((liste[0]! + this.proMs - jetzt) / 1000)
    }
    liste.push(jetzt)
    this.fenster.set(schluessel, liste)
    // Nicht endlos wachsen: alte Schluessel gelegentlich abraeumen.
    if (this.fenster.size > 10_000) {
      for (const [k, v] of this.fenster) if (!v.some(t => jetzt - t < this.proMs)) this.fenster.delete(k)
    }
    return null
  }
}
const anmeldeBremse = new Bremse(10, 60_000)
const registrierBremse = new Bremse(5, 60_000)

/**
 * Die Sicherheitsrichtlinie der Anmeldeseite.
 *
 * `form-action` GILT AUCH FUER DIE WEITERLEITUNG NACH DEM ABSENDEN. Das
 * Formular geht an /anmelden (self), die Antwort ist ein 302 zur Rueckadresse
 * des Clients. Stand dort nur 'self', brach Chrome genau diesen Schritt ab —
 * "Refused to load https://chatgpt.com/connector/oauth/…" —, obwohl Passwort
 * und Code schon stimmten. Gefunden am 15.09.2026 beim ersten Verbinden aus
 * ChatGPT; der Test mit fetch sah es nie, weil fetch keine CSP kennt.
 *
 * Aufgenommen wird nur die HERKUNFT der einen Rueckadresse, die vorher exakt
 * gegen die Registrierung geprueft wurde — kein Pfad, kein Platzhalter, und
 * nur http(s).
 */
export function sicherheitsrichtlinie(rueckadresse?: string): string {
  let ziel = ''
  if (rueckadresse) {
    try {
      const u = new URL(rueckadresse)
      if (u.protocol === 'https:' || u.protocol === 'http:') ziel = ` ${u.origin}`
    } catch { /* keine gueltige Adresse: dann bleibt es bei 'self' */ }
  }
  return `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${ziel}`
}

const html = (a: Response, code: number, inhalt: string, rueckadresse?: string) =>
  a.status(code)
   .set('Content-Type', 'text/html; charset=utf-8')
   // Die Anmeldeseite gehoert in kein fremdes Fenster und in keinen Cache.
   .set('Cache-Control', 'no-store')
   .set('X-Frame-Options', 'DENY')
   .set('Content-Security-Policy', sicherheitsrichtlinie(rueckadresse))
   .send(inhalt)

const herkunft = (r: Request) =>
  (r.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? r.ip ?? null

export function anmeldungMontieren(app: Express, o: { aussteller: string; publikum: string }) {
  const { aussteller, publikum } = o

  /**
   * Formulardaten lesen koennen.
   *
   * Skybridge legt von sich aus nur `express.json()` an — das Token- und
   * Registrierungsformat von OAuth ist JSON, das ANMELDEFORMULAR aber
   * schickt `application/x-www-form-urlencoded`, wie jedes HTML-Formular.
   * Ohne diese Zeile ist `req.body` dort leer, und die Anmeldung scheitert
   * mit „E-Mail oder Passwort stimmt nicht" — bei richtigem Passwort.
   * Gefunden beim Schreiben des Tests, nicht im Betrieb.
   *
   * Auch `/token` wird von manchen Clients formularkodiert geschickt; RFC
   * 6749 schreibt das sogar vor. Beides muss also gehen.
   */
  app.use(express.urlencoded({ extended: false }))

  // --- Dynamic Client Registration (RFC 7591) ------------------------
  //
  // DER GRUND, WARUM DIESER SERVER SEINE EIGENE ANMELDUNG HAT. ChatGPT und
  // Claude melden sich beim Verbinden selbst an; Entra kann das nicht, hier
  // sind es zwanzig Zeilen.
  //
  // Offen, aber folgenlos: eine Registrierung vergibt nur eine Kennung. Wer
  // sie hat, kann genau eines — ein Anmeldeformular anzeigen lassen. Zugang
  // entsteht erst, wenn ein Mensch dort ein gueltiges Passwort eingibt.
  app.post('/register', async (anfrage, antwort) => {
    const warte = registrierBremse.zuViel(herkunft(anfrage) ?? '?')
    if (warte !== null) {
      return antwort.status(429).set('Retry-After', String(warte))
        .json({ error: 'too_many_requests', error_description: `Zu viele Registrierungen. In ${warte} s erneut.` })
    }
    const koerper = anfrage.body ?? {}
    const uris: unknown = koerper.redirect_uris
    if (!Array.isArray(uris) || uris.length === 0 || !uris.every(u => typeof u === 'string')) {
      return antwort.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'redirect_uris fehlt oder ist keine Liste von Zeichenketten.',
      })
    }
    for (const u of uris as string[]) {
      // https, oder localhost fuer die Einrichtung am Entwicklungsrechner.
      let geparst: URL
      try { geparst = new URL(u) } catch {
        return antwort.status(400).json({ error: 'invalid_redirect_uri',
          error_description: `Keine gueltige Adresse: ${u}` })
      }
      const erlaubt = geparst.protocol === 'https:'
        || geparst.hostname === 'localhost' || geparst.hostname === '127.0.0.1'
      if (!erlaubt) {
        return antwort.status(400).json({ error: 'invalid_redirect_uri',
          error_description: 'Rueckadressen muessen https sein (ausser localhost).' })
      }
    }
    const client = await clientAnlegen(
      typeof koerper.client_name === 'string' ? koerper.client_name : null, uris as string[])

    antwort.status(201).json({
      client_id: client.client_id,
      client_name: client.client_name ?? undefined,
      redirect_uris: client.redirect_uris,
      // Oeffentlicher Client: kein Geheimnis, dafuer PKCE. Ein Geheimnis in
      // einer Anwendung, die auf fremden Rechnern laeuft, waere keines.
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(Date.now() / 1000),
    })
  })

  // Manche Clients suchen zuerst das OpenID-Dokument. Dieselben Angaben,
  // anderer Pfad — Skybridge bedient nur den OAuth-Pfad.
  app.get('/.well-known/openid-configuration', (_anfrage, antwort) => {
    antwort.set('Access-Control-Allow-Origin', '*').json(metadaten(aussteller))
  })

  // --- Der oeffentliche Schluessel -----------------------------------
  app.get('/jwks', async (_anfrage, antwort) => {
    antwort.set('Cache-Control', 'public, max-age=3600').json(await jwks())
  })

  // --- Anmeldeformular anzeigen --------------------------------------
  app.get('/authorize', async (anfrage, antwort) => {
    const q = anfrage.query as Record<string, string | undefined>

    const abbruch = (titel: string, text: string) =>
      html(antwort, 400, fehlerseite(titel, text))

    if (q.response_type !== 'code') {
      return abbruch('Nicht unterstuetzt', 'Dieser Zugang kennt nur response_type=code.')
    }
    if (q.code_challenge_method !== 'S256' || !q.code_challenge) {
      // Ohne PKCE gar nicht erst anfangen. Das ist die Bedingung, unter der
      // ein oeffentlicher Client ohne Geheimnis ueberhaupt vertretbar ist.
      return abbruch('PKCE fehlt',
        'Es wird PKCE mit code_challenge_method=S256 verlangt. Ohne das wird kein Code ausgegeben.')
    }
    if (!q.client_id || !q.redirect_uri) {
      return abbruch('Unvollstaendig', 'client_id und redirect_uri werden gebraucht.')
    }

    const client = await clientHolen(q.client_id)
    if (!client) {
      return abbruch('Unbekannter Client',
        'Diese Anwendung ist hier nicht angemeldet. In ChatGPT oder Claude den Connector neu anlegen.')
    }
    // EXAKT, nicht mit Praefix: alles andere ist eine offene Weiterleitung.
    if (!client.redirect_uris.includes(q.redirect_uri)) {
      return abbruch('Rueckadresse stimmt nicht',
        'Die angegebene redirect_uri wurde fuer diese Anwendung nicht hinterlegt.')
    }

    const formulartoken = await formulartokenAusstellen({
      client_id: q.client_id, redirect_uri: q.redirect_uri,
      code_challenge: q.code_challenge, state: q.state,
      scope: q.scope, resource: q.resource,
    }, aussteller)

    // Die Rueckadresse ist oben exakt gegen die Registrierung geprueft — nur
    // deshalb darf ihre Herkunft in die Sicherheitsrichtlinie.
    return html(antwort, 200, anmeldeseite({
      formulartoken, clientName: client.client_name,
    }), q.redirect_uri)
  })

  // --- Anmeldung entgegennehmen --------------------------------------
  app.post('/anmelden', async (anfrage, antwort) => {
    const warte = anmeldeBremse.zuViel(herkunft(anfrage) ?? '?')
    if (warte !== null) {
      await anmeldungProtokollieren({ erfolg: false, grund: 'bremse', herkunft: herkunft(anfrage) })
      return html(antwort, 429, fehlerseite('Zu viele Versuche',
        `Von dieser Adresse kamen zu viele Anmeldeversuche. Bitte in ${warte} Sekunden erneut.`))
    }
    const koerper = anfrage.body ?? {}
    const email = typeof koerper.email === 'string' ? koerper.email.trim() : ''
    const passwort = typeof koerper.passwort === 'string' ? koerper.passwort : ''

    let anliegen: Record<string, string>
    try {
      anliegen = await formulartokenPruefen(String(koerper.anfrage ?? ''), aussteller)
    } catch {
      // Abgelaufen oder manipuliert. Beides endet hier, und beides bekommt
      // dieselbe Antwort.
      return html(antwort, 400, fehlerseite('Abgelaufen',
        'Das Anmeldefenster ist abgelaufen. Bitte in ChatGPT oder Claude erneut verbinden.'))
    }

    const nochmal = async (grund: string) => {
      const formulartoken = await formulartokenAusstellen({
        client_id: anliegen.client_id, redirect_uri: anliegen.redirect_uri,
        code_challenge: anliegen.code_challenge, state: anliegen.state,
        scope: anliegen.scope, resource: anliegen.resource,
      }, aussteller)
      const client = await clientHolen(anliegen.client_id!)
      // Auch das zweite Absenden endet mit der Weiterleitung. Die Rueckadresse
      // stammt aus dem signierten Formulartoken, geprueft bei /authorize.
      return html(antwort, 401, anmeldeseite({
        formulartoken, clientName: client?.client_name ?? null, fehler: grund, email,
      }), anliegen.redirect_uri)
    }

    const nutzer = await nutzerNachEmail(email)

    /**
     * IMMER EINEN HASH PRUEFEN, auch wenn es das Konto nicht gibt.
     *
     * Sonst antwortet der Server bei unbekannter Adresse messbar schneller
     * als bei bekannter — und schon ist er ein Verzeichnis der gueltigen
     * Konten. Der Vergleichswert ist ein fester Hash, dessen Passwort
     * niemand kennt.
     *
     * NACHGEMESSEN am 13.09.2026, weil eine Attrappe, die schon beim Parsen
     * scheitert, gar nichts kostet und damit nichts angleicht: die Pruefung
     * gegen diesen Hash braucht 128,6 ms, gegen einen echten 120,6 ms
     * (je fuenf Durchlaeufe). Der Unterschied verschwindet im Rauschen des
     * Netzwegs — das ist der Zweck.
     */
    const LEERLAUF = '$argon2id$v=19$m=65536,t=2,p=1'
      + '$c29tZS1maXhlZC1zYWx0LXZhbHVl$0000000000000000000000000000000000000000000'
    if (!nutzer || !nutzer.passwort_hash) {
      await Bun.password.verify(passwort, LEERLAUF).catch(() => false)
      await anmeldungProtokollieren({ email, erfolg: false, grund: 'unbekannt',
        herkunft: herkunft(anfrage) })
      return nochmal('E-Mail oder Passwort stimmt nicht.')
    }

    if (!nutzer.aktiv || nutzer.stufe === 'gesperrt') {
      await anmeldungProtokollieren({ email, subject: nutzer.subject, erfolg: false,
        grund: 'inaktiv', herkunft: herkunft(anfrage) })
      return nochmal('Dieses Konto ist stillgelegt.')
    }

    if (nutzer.gesperrt_bis && new Date(nutzer.gesperrt_bis) > new Date()) {
      await anmeldungProtokollieren({ email, subject: nutzer.subject, erfolg: false,
        grund: 'zeitsperre', herkunft: herkunft(anfrage) })
      return nochmal('Zu viele Fehlversuche. Bitte in ein paar Minuten erneut versuchen.')
    }

    const stimmt = await Bun.password.verify(passwort, nutzer.passwort_hash).catch(() => false)
    if (!stimmt) {
      const dauer = await fehlversuchMerken(nutzer.subject)
      await anmeldungProtokollieren({ email, subject: nutzer.subject, erfolg: false,
        grund: 'passwort', herkunft: herkunft(anfrage) })
      return nochmal(dauer > 0
        ? 'Zu viele Fehlversuche. Bitte in ein paar Minuten erneut versuchen.'
        : 'E-Mail oder Passwort stimmt nicht.')
    }

    await anmeldungGelungen(nutzer.subject)
    await anmeldungProtokollieren({ email, subject: nutzer.subject, erfolg: true,
      herkunft: herkunft(anfrage) })

    const code = await codeAusstellen({
      clientId: anliegen.client_id!, subject: nutzer.subject,
      redirectUri: anliegen.redirect_uri!, codeChallenge: anliegen.code_challenge!,
      scope: anliegen.scope, resource: anliegen.resource,
    })

    const ziel = new URL(anliegen.redirect_uri!)
    ziel.searchParams.set('code', code)
    if (anliegen.state) ziel.searchParams.set('state', anliegen.state)
    return antwort.set('Cache-Control', 'no-store').redirect(302, ziel.toString())
  })

  // --- Tokens ---------------------------------------------------------
  app.post('/token', async (anfrage, antwort) => {
    const k = anfrage.body ?? {}
    antwort.set('Cache-Control', 'no-store')

    const fehler = (code: string, text: string, status = 400) =>
      antwort.status(status).json({ error: code, error_description: text })

    if (k.grant_type === 'authorization_code') {
      if (!k.code || !k.client_id || !k.redirect_uri || !k.code_verifier) {
        return fehler('invalid_request', 'code, client_id, redirect_uri und code_verifier noetig.')
      }
      const eingeloest = await codeEinloesen(String(k.code), String(k.client_id), String(k.redirect_uri))
      if (!eingeloest) {
        return fehler('invalid_grant', 'Der Code ist unbekannt, abgelaufen oder schon benutzt.')
      }

      /**
       * Die PKCE-Probe: SHA-256 des Verifiers, base64url, gegen den bei der
       * Autorisierung hinterlegten Pruefwert. Stimmt das nicht, hat jemand
       * anders den Code — und bekommt kein Token.
       */
      const roh = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(k.code_verifier)))
      const geprueft = Buffer.from(roh).toString('base64url')
      if (geprueft !== eingeloest.code_challenge) {
        return fehler('invalid_grant', 'code_verifier passt nicht zur code_challenge.')
      }

      const nutzer = await nutzerNachSubjectSicher(eingeloest.subject)
      if (!nutzer) return fehler('invalid_grant', 'Das Konto ist nicht mehr aktiv.')

      const zugang = await zugangstokenAusstellen({
        subject: nutzer.subject, clientId: String(k.client_id), stufe: nutzer.stufe,
        anzeige: nutzer.anzeige, aussteller, publikum, gueltigSekunden: TOKEN_SEKUNDEN,
      })
      const auffrischung = await auffrischungAusstellen(String(k.client_id), nutzer.subject)

      return antwort.json({
        access_token: zugang, token_type: 'Bearer', expires_in: TOKEN_SEKUNDEN,
        refresh_token: auffrischung, scope: eingeloest.scope ?? undefined,
      })
    }

    if (k.grant_type === 'refresh_token') {
      if (!k.refresh_token || !k.client_id) {
        return fehler('invalid_request', 'refresh_token und client_id noetig.')
      }
      const e = await auffrischungEinloesen(String(k.refresh_token), String(k.client_id))
      if ('fehler' in e && e.fehler) {
        if (e.fehler === 'wiederverwendet') {
          await anmeldungProtokollieren({ subject: e.subject, erfolg: false,
            grund: 'token_wiederverwendet', herkunft: herkunft(anfrage) })
        }
        return fehler('invalid_grant', 'Der Auffrischungstoken ist ungueltig. Neu anmelden.')
      }
      const nutzer = await nutzerNachSubjectSicher(e.subject!)
      if (!nutzer) {
        await tokensWiderrufen(e.subject!)
        return fehler('invalid_grant', 'Das Konto ist nicht mehr aktiv.')
      }
      const zugang = await zugangstokenAusstellen({
        subject: nutzer.subject, clientId: String(k.client_id), stufe: nutzer.stufe,
        anzeige: nutzer.anzeige, aussteller, publikum, gueltigSekunden: TOKEN_SEKUNDEN,
      })
      return antwort.json({
        access_token: zugang, token_type: 'Bearer', expires_in: TOKEN_SEKUNDEN,
        refresh_token: e.neu,
      })
    }

    return fehler('unsupported_grant_type',
      'Nur authorization_code und refresh_token.')
  })

  if (!anmeldungEingerichtet()) {
    console.warn(JSON.stringify({ t: new Date().toISOString(), stufe: 'warn',
      msg: 'MCP_AUTH_DATABASE_URL fehlt — die Anmeldung kann keine Tokens ausstellen' }))
  }
}

/** Nur aktive Konten; die Stufe kommt IMMER frisch aus der Datenbank. */
async function nutzerNachSubjectSicher(subject: string) {
  const { nutzerNachSubject } = await import('./speicher')
  const n = await nutzerNachSubject(subject)
  return n && n.aktiv && n.stufe !== 'gesperrt' ? n : null
}
