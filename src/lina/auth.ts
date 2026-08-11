/**
 * Anmeldung bei LINA und Sessionpflege.
 *
 * LINA kennt keine API-Schlüssel und kein OAuth — es gibt nur den Formular-
 * Login und danach ein httpOnly-Sessioncookie.
 *
 * Der Ablauf ist aus `/js/common/login.js` und der Loginseite rekonstruiert
 * und weicht in drei Punkten von dem ab, was das sichtbare Formular vermuten
 * lässt:
 *
 *   1. Das Formular hat kein action-Attribut, gepostet wird aber nicht auf
 *      `/login`, sondern auf **`/common/index/dologin`**.
 *   2. Das Passwort geht als **MD5-Hex** raus (`hex_md5(password)`), nicht im
 *      Klartext und nicht als SHA-256. Im LINA-Code steht eine auskommentierte
 *      Zeile, die SHA-256 vorbereitet — falls das umgestellt wird, reicht
 *      `LINA_PASSWORD_HASH=sha256`.
 *   3. Zusätzlich wird ein **`secret`** gesendet: 64 Hex-Zeichen, die als
 *      `window.secret` in der Loginseite stehen und je Aufruf neu vergeben
 *      werden. Die Seite muss deshalb vor jeder Anmeldung geholt werden.
 *
 * Grundsätze:
 *   * Zugangsdaten und Cookies bleiben ausschließlich im Speicher. Nichts auf
 *     Platte, nichts in die Datenbank, nichts ins Log.
 *   * Es wird nicht vorsorglich neu angemeldet, sondern erst, wenn ein Aufruf
 *     erkennbar abgelaufen ist. Eine Anmeldung pro Tag fällt nicht auf,
 *     Anmeldungen im Minutentakt schon.
 *   * Schlägt die Anmeldung fehl, wird nicht in einer Schleife wiederholt.
 *     Falsche Zugangsdaten mehrfach zu senden ist der schnellste Weg zu einer
 *     Kontosperre.
 */
import { createHash } from 'node:crypto'
import { config } from '../config'
import { log } from '../lib/log'

const LOGIN_SEITE = '/login'
const LOGIN_ZIEL = '/common/index/dologin'
const PROBE = '/common/api/account'

/**
 * Erkennt an der Antwort, ob die Session abgelaufen ist.
 *
 * `form` ist die erwartete Antwortform des Endpunkts (Vorgabe `json`, so
 * verhalten sich alle Endpunkte von vor dem 11.08.2026).
 *
 * WARUM DIE HTML-HEURISTIK BEI HTML-ENDPUNKTEN ENGER SEIN MUSS. Die Zeile
 * unten sagt sinngemäß „HTML mit einem Passwortfeld ist die Loginseite". Für
 * Endpunkte, die JSON liefern sollen, stimmt das: kommt dort HTML mit einem
 * Passwortfeld an, ist man ausgeloggt. Für Endpunkte, die absichtlich HTML
 * liefern, stimmt es nicht — das Stammdatenblatt der Ladenakte trägt Formulare,
 * und ein einzelnes `name="password"` irgendwo auf der Seite würde eine
 * Neuanmeldung samt Wiederholung auslösen. Bei einem Zugang, den es genau
 * einmal gibt und der sich sperren lässt (harte Regel 7), ist eine grundlos
 * ausgelöste Anmeldung kein Schönheitsfehler.
 *
 * Deshalb für HTML-Endpunkte die Signatur der Loginseite selbst statt eines
 * beliebigen Passwortfelds: sie postet auf `/common/index/dologin` und trägt
 * `window.secret`. Beides steht auf keiner Fachseite. Status und Weiterleitung
 * bleiben für beide Formen die verlässlichen Signale und werden zuerst geprüft.
 */
export function sessionAbgelaufen(
  res: Response, koerper: string, form: 'json' | 'html' = 'json',
): boolean {
  if (res.status === 401 || res.status === 403) return true
  // LINA leitet auf die Loginseite um, statt einen Statuscode zu setzen.
  if (res.status >= 300 && res.status < 400) {
    if ((res.headers.get('location') ?? '').includes('/login')) return true
  }
  if (res.redirected && new URL(res.url).pathname.startsWith('/login')) return true
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('text/html')) return false
  if (form === 'html') return /dologin|window\.secret/i.test(koerper)
  if (/login-username|name="password"/i.test(koerper)) return true
  return false
}

/**
 * Alles, was eine Anmeldung braucht — als Wert, nicht aus der globalen
 * Konfiguration gelesen.
 *
 * Zwei Gründe: der Test kann eine Sitzung gegen die Attrappe aufbauen, ohne
 * die Prozesskonfiguration zu verbiegen; und sollte später jeder Nutzer sich
 * mit seinen eigenen LINA-Zugangsdaten anmelden (die Idee stand im Raum),
 * hängt hier nichts mehr an einem einzelnen Umgebungssatz.
 */
export type Zugang = {
  basis: string
  benutzer: string
  passwort: string
  hashverfahren: 'md5' | 'sha256' | 'plain'
  system: string
  userAgent: string
  plattform: string
  /** Zeitlimit je Anfrage. Ohne das hängt eine tote Verbindung ewig. */
  timeoutMs: number
}

export function zugangAusKonfiguration(): Zugang {
  return {
    basis: config.LINA_BASE_URL,
    benutzer: config.LINA_USER,
    passwort: config.LINA_PASSWORD,
    hashverfahren: config.LINA_PASSWORD_HASH,
    system: config.LINA_SYSTEM,
    userAgent: config.LINA_USER_AGENT,
    plattform: config.LINA_PLATTFORM,
    timeoutMs: config.ANFRAGE_TIMEOUT_MS,
  }
}

function hashen(passwort: string, verfahren: Zugang['hashverfahren']): string {
  switch (verfahren) {
    case 'md5':    return createHash('md5').update(passwort).digest('hex')
    case 'sha256': return createHash('sha256').update(passwort).digest('hex')
    default:       return passwort
  }
}

/** `window.secret` aus der Loginseite. 64 Hex-Zeichen, je Aufruf neu vergeben. */
export function secretAusSeite(html: string): string | null {
  const muster = [
    /window\.secret\s*=\s*['"]([0-9a-f]{16,128})['"]/i,
    /var\s+secret\s*=\s*['"]([0-9a-f]{16,128})['"]/i,
    /\bsecret\s*[:=]\s*['"]([0-9a-f]{16,128})['"]/i,
    /name=["']secret["'][^>]*value=["']([0-9a-f]{16,128})["']/i,
  ]
  for (const m of muster) {
    const t = m.exec(html)
    if (t) return t[1]
  }
  return null
}

/**
 * Hauptversion aus der Browserkennung — die Client-Hints müssen dieselbe
 * Nummer nennen. Wird die Kennung in der Konfiguration angehoben, zieht das
 * hier automatisch nach.
 */
export function chromeHauptversion(userAgent: string): string {
  return /Chrome\/(\d+)/.exec(userAgent)?.[1] ?? '149'
}

export class AnmeldungFehlgeschlagen extends Error {
  readonly name = 'AnmeldungFehlgeschlagen'
}

/**
 * Antwort von `/common/index/dologin`.
 *
 * `login.js` fordert `dataType: "json"` an und entscheidet an
 * `response.status === "SUCCESS"`; im Fehlerfall zeigt es `response.message`
 * wörtlich im Dialog an. Diese Meldung ist die verlässlichste Auskunft, die es
 * hier gibt — sie stand bis zum 25.07.2026 nicht in unserem Fehler, weshalb
 * ein schlichtes „Passwort falsch" als Hash- und Systemproblem missdeutet
 * wurde. Deshalb wird sie jetzt ausgewertet.
 */
export type DologinAntwort = {
  status?: string
  message?: string
  url?: string
}

export function dologinAntwortLesen(text: string): DologinAntwort {
  try {
    const j = JSON.parse(text)
    if (j && typeof j === 'object' && !Array.isArray(j)) return j as DologinAntwort
  } catch { /* kein JSON — dann bleibt es bei den Statuscodes */ }
  return {}
}

export class LinaSession {
  /** Cookie-Jar: nur im Speicher, bewusst nicht persistiert. */
  private cookies = new Map<string, string>()
  private angemeldetSeit: Date | null = null
  private laufendeAnmeldung: Promise<void> | null = null
  private readonly zugang: Zugang

  constructor(zugang: Partial<Zugang> = {}) {
    this.zugang = { ...zugangAusKonfiguration(), ...zugang }
  }

  get istAngemeldet() { return this.angemeldetSeit !== null }
  get seit() { return this.angemeldetSeit }

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  private cookiesUebernehmen(res: Response) {
    const roh = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
    for (const zeile of roh) {
      const [paar] = zeile.split(';')
      const idx = paar.indexOf('=')
      if (idx > 0) this.cookies.set(paar.slice(0, idx).trim(), paar.slice(idx + 1).trim())
    }
  }

  /**
   * Mehrfachaufrufe während einer laufenden Anmeldung teilen sich dieselbe
   * Promise — sonst schickt ein Worker bei Ablauf mehrere Logins hinterher.
   */
  async anmelden(): Promise<void> {
    if (this.laufendeAnmeldung) return this.laufendeAnmeldung
    this.laufendeAnmeldung = this.anmeldenIntern().finally(() => { this.laufendeAnmeldung = null })
    return this.laufendeAnmeldung
  }

  private async anmeldenIntern(): Promise<void> {
    this.cookies.clear()
    this.angemeldetSeit = null
    const { basis } = this.zugang

    // 1. Loginseite: setzt das Sessioncookie UND liefert das secret.
    //    Als Dokumentaufruf, denn genau das ist es — ein Browser käme hier
    //    ebenfalls ohne Referrer und mit sec-fetch-site: none an.
    const seite = await fetch(basis + LOGIN_SEITE, {
      redirect: 'manual',
      headers: this.browserHeader('dokument'),
      signal: AbortSignal.timeout(this.zugang.timeoutMs),
    })
    this.cookiesUebernehmen(seite)
    const html = await seite.text()

    const secret = secretAusSeite(html)
    if (!secret) {
      throw new AnmeldungFehlgeschlagen(
        `Auf ${LOGIN_SEITE} war kein "secret" zu finden (${html.length} Bytes Antwort). ` +
        `Entweder hat LINA den Loginablauf geändert, oder die Antwort war nicht die Loginseite. ` +
        `Anlaufstelle: src/lina/auth.ts, Funktion secretAusSeite().`)
    }

    // 2. Anmelden: Passwort gehasht, secret mitgeschickt.
    //    Genau diese vier Felder — `login.js` baut sein `values`-Objekt aus
    //    username, password, secret, system. `source` liest es zwar aus dem
    //    Formular, sendet es aber nicht mit; es entscheidet damit nur, wohin
    //    der Browser nach dem Erfolg springt. Wir haben es früher mitgeschickt,
    //    was keinen Schaden anrichtete, aber eine Abweichung war.
    const body = new URLSearchParams({
      username: this.zugang.benutzer,
      password: hashen(this.zugang.passwort, this.zugang.hashverfahren),
      secret,
      system: this.zugang.system,
    })

    const res = await fetch(basis + LOGIN_ZIEL, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        ...this.browserHeader('xhr'),
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        // Genau der Accept, den jQuerys `$.ajax({dataType:'json'})` erzeugt —
        // und `login.js` ist ein jQuery-Aufruf. Am 26.07.2026 gegen eine echte
        // Browser-Anmeldung mitgeschnitten; unser Wert war
        // `application/json, text/plain, */*` und damit die einzige inhaltliche
        // Abweichung, die der Vergleich noch fand.
        accept: 'application/json, text/javascript, */*; q=0.01',
        cookie: this.cookieHeader(),
        origin: basis,
        referer: basis + LOGIN_SEITE,
      },
      body,
      signal: AbortSignal.timeout(this.zugang.timeoutMs),
    })
    this.cookiesUebernehmen(res)
    const antwort = await res.text()

    // 3. Erfolg entscheidet nicht der Statuscode, sondern ob ein geschützter
    //    JSON-Endpunkt jetzt Daten liefert.
    const probe = await fetch(basis + PROBE, {
      headers: { ...this.browserHeader('xhr'), cookie: this.cookieHeader(), referer: basis + '/' },
      redirect: 'manual',
      signal: AbortSignal.timeout(this.zugang.timeoutMs),
    })
    const text = await probe.text()

    if (!probe.ok || !text.trim().startsWith('{')) {
      const gemeldet = dologinAntwortLesen(antwort)
      const lage =
        `Login ${res.status}, Probe ${probe.status}, Hashverfahren ${this.zugang.hashverfahren}, ` +
        `System "${this.zugang.system}"`

      // LINA sagt im Klartext, was es beanstandet. Wenn es das tut, ist jede
      // Prüfreihenfolge von uns nur noch Raterei daneben.
      if (gemeldet.message) {
        throw new AnmeldungFehlgeschlagen(
          `LINA lehnt die Anmeldung als "${this.zugang.benutzer}" ab: ` +
          `"${gemeldet.message}" (status ${gemeldet.status ?? '—'}, ${lage}). ` +
          `Das ist LINAs eigene Meldung, keine Vermutung von uns.`)
      }

      // Passwortschritt anerkannt, Sitzung trotzdem nicht nutzbar: dann steht
      // etwas dazwischen. `login.js` kennt genau einen solchen Fall — die
      // Zwei-Faktor-Maske, die gegen /common/index/dotwofaauth prüft.
      if (gemeldet.status === 'SUCCESS') {
        throw new AnmeldungFehlgeschlagen(
          `LINA bestätigt die Anmeldung als "${this.zugang.benutzer}" (status SUCCESS, ` +
          `Weiterleitung "${gemeldet.url ?? ''}"), aber ${PROBE} antwortet trotzdem ` +
          `mit ${probe.status}. Zugangsdaten stimmen also. Wahrscheinlichste Ursache: ` +
          `Zwei-Faktor-Authentifizierung — login.js schickt danach einen Code an ` +
          `/common/index/dotwofaauth, und das ist unbeaufsichtigt nicht bedienbar. ` +
          `Für den Dienst wird ein Zugang ohne zweiten Faktor gebraucht.`)
      }

      throw new AnmeldungFehlgeschlagen(
        `Anmeldung als "${this.zugang.benutzer}" nicht erfolgreich (${lage}, ` +
        `Antwort ${antwort.length} Bytes, kein auswertbares JSON). ` +
        `Prüfen in dieser Reihenfolge: Benutzername und Passwort; System (für ` +
        `LINA TeamCloud ist es "a360"); dann LINA_PASSWORD_HASH (md5 ist der ` +
        `beobachtete Stand, sha256 ist im LINA-Code vorbereitet).`)
    }

    this.angemeldetSeit = new Date()
    let name = '(unbekannt)'
    try {
      const acc = JSON.parse(text)
      name = `${acc?.user?.vorname ?? ''} ${acc?.user?.nachname ?? ''}`.trim() || name
    } catch { /* egal, nur fürs Log */ }
    log.info('angemeldet', { benutzer: name, system: this.zugang.system })
  }

  /**
   * Sieht aus wie ein normaler Browser, nicht wie ein Skript.
   *
   * Entscheidend ist nicht die Kennung allein, sondern dass alles zueinander
   * passt: Chrome schickt auf HTTPS immer Client-Hints und Fetch-Metadaten
   * mit. Ein Aufruf mit Chrome-Kennung, aber ohne `sec-ch-ua`, ist im Log
   * auffälliger als einer ganz ohne Kennung — die Kombination gibt es bei
   * keinem echten Browser.
   *
   * `art` unterscheidet die beiden Fälle, die Chrome selbst unterscheidet:
   * eine Seite, die man aufruft (`dokument`), und ein Hintergrundaufruf aus
   * einer laufenden Seite heraus (`xhr`).
   */
  private browserHeader(art: 'dokument' | 'xhr' = 'xhr'): Record<string, string> {
    const v = chromeHauptversion(this.zugang.userAgent)
    const gemeinsam = {
      'user-agent': this.zugang.userAgent,
      'accept-language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
      'accept-encoding': 'gzip, deflate, br, zstd',
      'sec-ch-ua': `"Chromium";v="${v}", "Google Chrome";v="${v}", "Not?A_Brand";v="24"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': `"${this.zugang.plattform}"`,
    }
    if (art === 'dokument') {
      return {
        ...gemeinsam,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,' +
                'image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'upgrade-insecure-requests': '1',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
      }
    }
    return {
      ...gemeinsam,
      accept: 'application/json, text/plain, */*',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'x-requested-with': 'XMLHttpRequest',
    }
  }

  /** Header für einen authentifizierten Aufruf. */
  header(zusatz: Record<string, string> = {}): Record<string, string> {
    return {
      ...this.browserHeader('xhr'),
      cookie: this.cookieHeader(),
      ...zusatz,
    }
  }
}
