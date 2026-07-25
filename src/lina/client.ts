/**
 * Gedrosselter LINA-Client.
 *
 * Die Drosselung ist hier keine Höflichkeit, sondern das, was die Integration
 * am Leben hält: Es gibt keinen offiziellen Zugang, keine dokumentierten
 * Limits und keine Rate-Limit-Header, an denen man sich orientieren könnte
 * (in Phase 1 geprüft — es gibt schlicht keine). Also gilt ein selbst
 * gesetztes, konservatives Tempo.
 *
 * Bewusst tagsüber statt nachts: ein einzelner Client um drei Uhr früh ist im
 * Log ein Ausreißer, dieselben Anfragen im Tagesverkehr von 141 Betrieben
 * fallen nicht auf.
 */
import { config } from '../config'
import { stundeInGeschaeftszeitzone } from '../lib/time'
import { log } from '../lib/log'
import { LinaSession, sessionAbgelaufen, AnmeldungFehlgeschlagen } from './auth'
import { schemaFuer } from './schemas'
import type { Endpunkt } from './endpunkte'

export type Ergebnis =
  | { art: 'ok'; daten: unknown; status: number; bytes: number; hash: string; dauerMs: number }
  /**
   * Kein Fehler, sondern ein Normalzustand: LINA antwortet mit HTTP 500 und
   * leerem Body, wenn ein Betrieb für diesen Bericht keine Daten hat.
   * Ein Retry darauf läuft in eine Endlosschleife.
   */
  | { art: 'keine_daten'; status: number; dauerMs: number }
  | { art: 'fehler'; status: number | null; fehler: string; dauerMs: number; wiederholbar: boolean }

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

export class LinaClient {
  private session = new LinaSession()
  private letzterRequest = 0
  private heute = ''
  private heuteVerbraucht = 0
  /** Wartezeit vor dem letzten Request — wird zur Prüfbarkeit mitgeschrieben. */
  letzteWartezeitMs = 0

  get budgetVerbraucht() { return this.heuteVerbraucht }
  get budgetUebrig() { return Math.max(0, config.TAGESBUDGET - this.heuteVerbraucht) }

  /**
   * Sind wir im Arbeitsfenster? Ortszeit, weil das Fenster fachlich gemeint ist:
   * bewusst tagsüber, damit die Aufrufe im normalen Verkehr untergehen.
   */
  imFenster(jetzt = new Date()): boolean {
    const stunde = stundeInGeschaeftszeitzone(jetzt)
    return stunde >= config.FENSTER_VON_STUNDE && stunde < config.FENSTER_BIS_STUNDE
  }


  private budgetTagWechseln() {
    const tag = new Date().toISOString().slice(0, 10)
    if (tag !== this.heute) { this.heute = tag; this.heuteVerbraucht = 0 }
  }

  /** Zufällige Pause im konfigurierten Takt — kein fester Rhythmus. */
  private naechsteWartezeit(): number {
    const spanne = config.TAKT_MAX_MS - config.TAKT_MIN_MS
    const soll = config.TAKT_MIN_MS + Math.floor(Math.random() * (spanne + 1))
    const seitLetztem = Date.now() - this.letzterRequest
    return Math.max(0, soll - seitLetztem)
  }

  async holen(ep: Endpunkt, parameter: Record<string, string>): Promise<Ergebnis> {
    this.budgetTagWechseln()
    if (this.budgetUebrig === 0) {
      return { art: 'fehler', status: null, fehler: 'Tagesbudget aufgebraucht', dauerMs: 0, wiederholbar: true }
    }

    const warten = this.naechsteWartezeit()
    this.letzteWartezeitMs = warten
    if (warten > 0) await schlaf(warten)

    if (!this.session.istAngemeldet) await this.session.anmelden()

    const start = Date.now()
    try {
      let res = await this.request(ep, parameter)
      let text = await res.text()

      // Session abgelaufen: genau einmal neu anmelden und wiederholen.
      if (sessionAbgelaufen(res, text)) {
        log.info('session abgelaufen, melde neu an', { endpunkt: ep.key })
        await this.session.anmelden()
        res = await this.request(ep, parameter)
        text = await res.text()
      }

      this.letzterRequest = Date.now()
      this.heuteVerbraucht++
      const dauerMs = Date.now() - start

      // Der dokumentierte Sonderfall aus Phase 1.
      if (res.status >= 500 && text.trim() === '') {
        return { art: 'keine_daten', status: res.status, dauerMs }
      }
      if (!res.ok) {
        return {
          art: 'fehler', status: res.status, dauerMs,
          fehler: `HTTP ${res.status}`,
          wiederholbar: res.status === 429 || res.status >= 500,
        }
      }

      let daten: unknown
      try {
        daten = JSON.parse(text)
      } catch {
        return {
          art: 'fehler', status: res.status, dauerMs,
          fehler: `Antwort ist kein JSON (${text.length} Bytes, beginnt mit "${text.slice(0, 40)}")`,
          wiederholbar: false,
        }
      }

      const bytes = new TextEncoder().encode(text).length
      const hash = Bun.SHA256.hash(text, 'hex')
      return { art: 'ok', daten, status: res.status, bytes, hash, dauerMs }

    } catch (e) {
      this.letzterRequest = Date.now()
      const dauerMs = Date.now() - start
      // Falsche Zugangsdaten NICHT wiederholen — der schnellste Weg zur Kontosperre.
      if (e instanceof AnmeldungFehlgeschlagen) {
        return { art: 'fehler', status: null, fehler: e.message, dauerMs, wiederholbar: false }
      }
      return { art: 'fehler', status: null, fehler: String(e), dauerMs, wiederholbar: true }
    }
  }

  private request(ep: Endpunkt, parameter: Record<string, string>) {
    const url = `${config.LINA_BASE_URL}${ep.pfad}?${new URLSearchParams(parameter)}`
    return fetch(url, {
      headers: this.session.header({ referer: `${config.LINA_BASE_URL}${ep.pfad.split('/').slice(0, 3).join('/')}` }),
      redirect: 'manual',
      // Ohne Zeitlimit wartet fetch unbegrenzt und hängt den ganzen Worker auf.
      // Begründung ausführlich bei ANFRAGE_TIMEOUT_MS in src/config.ts.
      signal: AbortSignal.timeout(config.ANFRAGE_TIMEOUT_MS),
    })
  }
}

/**
 * Prüft die Antwortstruktur. Gibt die Abweichung zurück statt zu werfen —
 * die Daten landen trotzdem im Raw-Layer, aus dem sich später neu
 * transformieren lässt. Verworfen wird nichts.
 */
export type Abweichung = { endpunkt: string }
export type AbweichungDetail = { probleme: { pfad: string; problem: string }[] }

export function strukturPruefen(key: string, daten: unknown):
  { ok: true } | { ok: false; erwartet: Abweichung; tatsaechlich: AbweichungDetail } {
  const schema = schemaFuer(key)
  if (!schema) return { ok: true }
  const r = schema.safeParse(daten)
  if (r.success) return { ok: true }
  return {
    ok: false,
    erwartet: { endpunkt: key },
    tatsaechlich: {
      probleme: r.error.issues.slice(0, 10).map(i => ({ pfad: i.path.join('.'), problem: i.message })),
    },
  }
}
