/**
 * Gedrosselter FoodNotify-Client — EIN Client für alle vier Mandanten.
 *
 * Die Drosselung liegt an der Instanz, nicht an der Marke: vier Marken
 * heißen nicht viermal so schnell (Plan §6).
 *
 * TAKT UND BUDGET SIND VON LINA GETRENNT (seit 02.08.2026).
 *
 * Zwei verschiedene Anbieter, zwei verschiedene Verträge, zwei
 * verschiedene Risiken — eine Bremse gegenüber dem einen darf den anderen
 * nicht ausbremsen. Vorher lasen beide Clients dieselben `TAKT_*`, und
 * schlimmer: dasselbe `TAGESBUDGET`, gezählt über ALLE Zeilen in
 * `sync.aufgabe`. Ein FoodNotify-Backfill mit 36.000 Posten hätte damit
 * rechnerisch LINAs Tagesdaten gedeckelt — Daten eines Anbieters, die an
 * der Grenze eines anderen scheitern.
 *
 * Gezählt wird jetzt über `endpunkt LIKE 'fn:%'`, gesteuert über
 * `FN_TAKT_MIN_MS` / `FN_TAKT_MAX_MS` / `FN_TAGESBUDGET`. Ohne diese
 * Variablen gelten LINAs Werte: wer nichts konfiguriert, bekommt das
 * vorsichtigere Verhalten.
 *
 * Die Sitzungen sind JE MARKE getrennt — und ebenso die Sperre nach
 * einem Anmeldefehler: ein falsches Passwort bei einer Marke darf die
 * anderen drei nicht mitreißen (.env.example, FoodNotify-Abschnitt).
 */
import { config, fnZugaenge, fnGrenzen } from '../config'
import { log } from '../lib/log'
import { ohneNullzeichen, jsonOhneNullzeichen } from '../lib/text'
import { eine } from '../db/pool'
import { FnSession, FnAnmeldungFehlgeschlagen, fnSessionAbgelaufen } from './auth'
import { auspacken } from './huelle'
import type { FnEndpunkt } from './endpunkte'
import type { Ergebnis } from '../lina/client'

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

function retryAfter(header: string | null): Date | null {
  if (!header) return null
  const sekunden = Number(header.trim())
  if (Number.isFinite(sekunden) && sekunden >= 0) return new Date(Date.now() + sekunden * 1000)
  const datum = new Date(header)
  return Number.isNaN(datum.getTime()) ? null : datum
}

export class FnClient {
  private sessions = new Map<string, FnSession>()
  /** Je Marke: nach einem Anmeldefehler in diesem Prozess kein zweiter Versuch. */
  private anmeldungGescheitert = new Set<string>()
  private letzterRequest = 0
  private heute = ''
  private heuteVerbraucht = 0
  letzteWartezeitMs = 0

  get budgetUebrig() { return Math.max(0, fnGrenzen().tagesbudget - this.heuteVerbraucht) }

  /**
   * Gegenstueck zu `LinaClient.budgetVerbraucht`. Gebraucht seit die beiden
   * Anbieter in eigenen Schleifen laufen: die Schlusszeile des Laufs nennt
   * beide Verbraeuche, sonst waere nach dem Umbau die Haelfte des Laufs in
   * der Zusammenfassung unsichtbar.
   */
  get budgetVerbraucht() { return this.heuteVerbraucht }

  /**
   * Das Notfallnetz — aber NUR über FoodNotify-Aufrufe.
   *
   * `endpunkt LIKE 'fn:%'` ist der ganze Unterschied zur früheren Fassung
   * und der Grund, warum LINAs Tagesdaten von einem FoodNotify-Backfill
   * nicht mehr gedeckelt werden können. Gezählt wird über `sync.aufgabe`,
   * weil dort jeder tatsächliche Aufruf steht, laufübergreifend und
   * neustartfest: `heuteVerbraucht` läge sonst nur im Arbeitsspeicher, und
   * jeder Lauf ist ein frisch startender Prozess — der Zähler begänne
   * stündlich wieder bei null und das Budget hätte nie gegriffen.
   */
  async budgetLaden() {
    this.budgetTagWechseln()
    const r = await eine<{ n: number }>(
      `SELECT count(*)::int AS n FROM sync.aufgabe
        WHERE beendet_am >= date_trunc('day', now()) AND endpunkt LIKE 'fn:%'`)
    this.heuteVerbraucht = Number(r?.n ?? 0)
    const g = fnGrenzen()
    log.info('tagesbudget foodnotify', {
      heuteVerbraucht: this.heuteVerbraucht, uebrig: this.budgetUebrig,
      grenze: g.tagesbudget, takt: `${g.taktMin}–${g.taktMax} ms`,
      eigeneGrenzen: g.eigen,
    })
  }

  private budgetTagWechseln() {
    const tag = new Date().toISOString().slice(0, 10)
    if (tag !== this.heute) { this.heute = tag; this.heuteVerbraucht = 0 }
  }

  private naechsteWartezeit(): number {
    const { taktMin, taktMax } = fnGrenzen()
    const soll = taktMin + Math.floor(Math.random() * (taktMax - taktMin + 1))
    const seitLetztem = Date.now() - this.letzterRequest
    return Math.max(0, soll - seitLetztem)
  }

  /** Die Session der Marke — oder null, wenn keine Zugangsdaten vorliegen. */
  private session(marke: string): FnSession | null {
    const offen = this.sessions.get(marke)
    if (offen) return offen
    const zugang = fnZugaenge().find(z => z.schluessel === marke)
    if (!zugang) return null
    const s = new FnSession(zugang)
    this.sessions.set(marke, s)
    return s
  }

  async holen(ep: FnEndpunkt, marke: string, parameter: Record<string, string>): Promise<Ergebnis> {
    this.budgetTagWechseln()
    if (this.budgetUebrig === 0) {
      return { art: 'fehler', status: null, fehler: 'Tagesbudget aufgebraucht', dauerMs: 0, wiederholbar: true }
    }
    if (this.anmeldungGescheitert.has(marke)) {
      return {
        art: 'gesperrt', sperrArt: 'anmeldung', status: null, wartenBis: null, dauerMs: 0,
        fehler: `Anmeldung ${marke} ist in diesem Lauf bereits gescheitert — kein weiterer Versuch`,
      }
    }
    const session = this.session(marke)
    if (!session) {
      // Kein Konfigurationsfehler des Postens, sondern der Umgebung — der
      // Posten bleibt liegen, bis jemand die Zugangsdaten setzt.
      return {
        art: 'fehler', status: null, dauerMs: 0, wiederholbar: true,
        fehler: `Keine Zugangsdaten für Marke "${marke}" (FN_*_USER/_PASSWORD fehlen)`,
      }
    }

    const warten = this.naechsteWartezeit()
    this.letzteWartezeitMs = warten
    if (warten > 0) await schlaf(warten)

    if (!session.istAngemeldet) {
      try {
        await session.anmelden()
      } catch (e) {
        if (e instanceof FnAnmeldungFehlgeschlagen) {
          this.anmeldungGescheitert.add(marke)
          return { art: 'gesperrt', sperrArt: 'anmeldung', status: null, wartenBis: null, dauerMs: 0, fehler: e.message }
        }
        throw e
      }
    }

    const start = Date.now()
    try {
      let pfad: string
      try {
        pfad = ep.pfad(parameter, session.benutzerId)
      } catch (e) {
        // Ein Posten ohne Pflichtparameter ist ein Einreihungsfehler, kein
        // HTTP-Fehler — nicht wiederholbar, denn er scheitert auch beim
        // zehnten Mal.
        return { art: 'fehler', status: null, fehler: String(e), dauerMs: 0, wiederholbar: false }
      }

      let res = await this.request(pfad, session)
      // Session abgelaufen: genau einmal neu anmelden und wiederholen.
      if (fnSessionAbgelaufen(res)) {
        log.info('foodnotify-session abgelaufen, melde neu an', { marke, endpunkt: ep.key })
        await session.anmelden()
        res = await this.request(pfad, session)
      }
      const text = ohneNullzeichen(await res.text(), ep.key)

      this.letzterRequest = Date.now()
      this.heuteVerbraucht++
      const dauerMs = Date.now() - start

      if (res.status === 429 || res.status === 403) {
        return {
          art: 'gesperrt',
          sperrArt: res.status === 429 ? 'http_429' : 'http_403',
          status: res.status, dauerMs,
          wartenBis: retryAfter(res.headers.get('retry-after')),
          fehler: `HTTP ${res.status}${res.headers.get('retry-after') ? ` (Retry-After: ${res.headers.get('retry-after')})` : ''}`,
        }
      }
      if (!res.ok) {
        return {
          art: 'fehler', status: res.status, dauerMs,
          fehler: `HTTP ${res.status}`,
          wiederholbar: res.status >= 500,
        }
      }

      let daten: unknown
      try {
        daten = jsonOhneNullzeichen(text, ep.key)
      } catch {
        return {
          art: 'fehler', status: res.status, dauerMs,
          fehler: `Antwort ist kein JSON (${text.length} Bytes, beginnt mit "${text.slice(0, 40)}")`,
          wiederholbar: false,
        }
      }

      /**
       * Der Hüllenfehler: HTTP 200, aber isError=true oder errors[] gefüllt.
       * FoodNotify meldet Fehler auch SO (Inventar §1) — wer nur den
       * Statuscode prüft, lädt Fehlermeldungen als Daten. Die Antwort geht
       * trotzdem nicht verloren: der Fehlertext trägt die Hüllenmeldung.
       */
      const huelle = auspacken(daten)
      if (huelle.fehler) {
        return {
          art: 'fehler', status: res.status, dauerMs,
          fehler: `Hüllenfehler bei HTTP ${res.status}: ${huelle.fehler.slice(0, 500)}`,
          wiederholbar: false,
        }
      }

      // Roh zurückgeben, nicht ausgepackt: raw.api_antwort ist die
      // Versicherung und bekommt die Antwort, wie sie kam. Ausgepackt wird
      // beim Laden (src/foodnotify/laden.ts).
      const bytes = new TextEncoder().encode(text).length
      const hash = Bun.SHA256.hash(text, 'hex')
      // FoodNotify liefert ausschliesslich JSON — die Form ist hier fest.
      return { art: 'ok', daten, form: 'json', status: res.status, bytes, hash, dauerMs }

    } catch (e) {
      this.letzterRequest = Date.now()
      const dauerMs = Date.now() - start
      if (e instanceof FnAnmeldungFehlgeschlagen) {
        this.anmeldungGescheitert.add(e.marke)
        return { art: 'gesperrt', sperrArt: 'anmeldung', status: null, fehler: e.message, wartenBis: null, dauerMs }
      }
      return { art: 'fehler', status: null, fehler: String(e), dauerMs, wiederholbar: true }
    }
  }

  private request(pfad: string, session: FnSession) {
    return fetch(`${config.FN_BASE_URL}${pfad}`, {
      headers: session.header(),
      redirect: 'manual',
      signal: AbortSignal.timeout(config.ANFRAGE_TIMEOUT_MS),
    })
  }
}
