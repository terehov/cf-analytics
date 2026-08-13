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
import { ohneNullzeichen, jsonOhneNullzeichen } from '../lib/text'
import { eine } from '../db/pool'
import { LinaSession, sessionAbgelaufen, AnmeldungFehlgeschlagen } from './auth'
import { schemaFuer } from './schemas'
import type { Endpunkt } from './endpunkte'
import { belegToken, bwaHash, stammPfad, KeinBelegarchiv } from '../ladenakte/token'

export type Ergebnis =
  /**
   * `form` sagt, was in `daten` steht: bei `json` das geparste Objekt, bei
   * `html` der unveränderte Rohtext als `string`. Der Diskriminator steht hier,
   * damit der Lader nicht raten muss — `typeof daten === 'string'` wäre
   * mehrdeutig, sobald ein JSON-Endpunkt einmal einen Skalar liefert.
   */
  | { art: 'ok'; daten: unknown; form: 'json' | 'html'; status: number; bytes: number; hash: string; dauerMs: number }
  /**
   * Kein Fehler, sondern ein Normalzustand: LINA antwortet mit HTTP 500 und
   * leerem Body, wenn ein Betrieb für diesen Bericht keine Daten hat.
   * Ein Retry darauf läuft in eine Endlosschleife.
   */
  | { art: 'keine_daten'; status: number; dauerMs: number }
  /**
   * LINA hat den Zugang verweigert — kein Fehler dieses Postens, sondern
   * einer des Zugangs. Getrennt behandelt, weil die richtige Antwort darauf
   * die einzige ist, die der Importer bisher nicht kannte: aufhören.
   * Siehe migrations/0009_zugangssperre.sql.
   */
  | {
      art: 'gesperrt'
      sperrArt: 'http_429' | 'http_403' | 'challenge' | 'anmeldung'
      status: number | null
      fehler: string
      /** Aus dem Retry-After-Header, falls LINA einen mitschickt. */
      wartenBis: Date | null
      dauerMs: number
    }
  | { art: 'fehler'; status: number | null; fehler: string; dauerMs: number; wiederholbar: boolean }

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * `Retry-After` kommt entweder als Sekundenzahl oder als HTTP-Datum.
 * Beides wird gelesen; alles andere ergibt null, dann gilt die eigene Basisdauer.
 */
function retryAfter(header: string | null): Date | null {
  if (!header) return null
  const sekunden = Number(header.trim())
  if (Number.isFinite(sekunden) && sekunden >= 0) return new Date(Date.now() + sekunden * 1000)
  const datum = new Date(header)
  return Number.isNaN(datum.getTime()) ? null : datum
}

/**
 * Sieht die Antwort nach einer Abwehrseite aus?
 *
 * Bewusst eng gefasst: eine Fehlklassifikation legt den Importer für Stunden
 * lahm. Ein abgelaufener Session-Redirect ist KEINE Sperre — den behandelt
 * `sessionAbgelaufen()` und meldet sich einmal neu an.
 */
function nachAbwehrseiteAussehend(text: string, form: 'json' | 'html' = 'json'): boolean {
  const anfang = text.slice(0, 2000)
  /**
   * Bei HTML-Endpunkten fallen die deutschsprachigen und die generischen
   * englischen Stichwörter weg.
   *
   * Grund: „Zugriff verweigert" und „access denied" sind in einer deutschen
   * Fachanwendung gewöhnlicher Seitentext — eine Rechteverwaltung, eine
   * Fehlermeldung neben einem gesperrten Feld, ein Hinweis im Belegarchiv.
   * Bei JSON kommen sie praktisch nur von einer Abwehrseite, bei HTML sind
   * sie ein Alltagswort. Ein Fehlalarm hier beendet nicht den Posten, sondern
   * den ganzen Lauf — die teuerste mögliche Fehlklassifikation.
   *
   * Was bleibt, sind Zeichenketten, die kein Fachtext enthält. Der echte
   * Abwehrfall verliert dadurch wenig: 403 und 429 werden vorher am Status
   * erkannt, und Cloudflare nennt sich in seinen Seiten selbst beim Namen.
   */
  if (form === 'html') return /captcha|cloudflare|attention required|too many requests/i.test(anfang)
  return /captcha|cloudflare|attention required|access denied|zugriff verweigert|too many requests/i
    .test(anfang)
}

export class LinaClient {
  private session = new LinaSession()
  private letzterRequest = 0
  private heute = ''
  private heuteVerbraucht = 0
  /** Einmal gescheiterte Anmeldung heißt: in diesem Prozess kein zweiter Versuch. */
  private anmeldungGescheitert = false
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

  /**
   * Das Tagesbudget aus der Datenbank holen, statt bei null anzufangen.
   *
   * `heuteVerbraucht` lag nur im Arbeitsspeicher — und jeder Lauf ist ein
   * frisch startender Prozess (`docker exec … bun run sync`, stündlich). Der
   * Zähler begann also stündlich wieder bei null, und `TAGESBUDGET` hat in
   * Produktion nie gegriffen. Ausgerechnet die Bremse, die als Notfallnetz
   * gegen einen Fehler im Tempo gedacht war, war die einzige ohne Wirkung.
   *
   * Bei 20–40 s Takt fiel das nicht auf: der Takt selbst hielt bei rund 2.880
   * Aufrufen am Tag, das Budget wurde nie erreicht. Sobald jemand den Takt
   * senkt — und genau dafür ist er einstellbar — ist es die einzige Grenze,
   * die noch bliebe.
   *
   * Gezählt wird über `sync.aufgabe`, weil dort jeder tatsächliche Aufruf
   * steht, laufübergreifend und neustartfest. Bewusst großzügig gezählt:
   * lieber einen übersprungenen Posten zu viel als einen Aufruf zu wenig.
   *
   * NUR LINA-AUFRUFE (`endpunkt NOT LIKE 'fn:%'`, seit 02.08.2026). Vorher
   * zählte diese Abfrage alle Zeilen, FoodNotify eingeschlossen — ein
   * Backfill dort mit 36.000 Posten hätte LINAs Tagesdaten am eigenen
   * Budget scheitern lassen. Zwei Anbieter, zwei Töpfe: eine Grenze soll
   * das System schützen, gegen das sie gilt, und kein anderes.
   */
  async budgetLaden() {
    this.budgetTagWechseln()
    const r = await eine<{ n: number }>(
      `SELECT count(*)::int AS n FROM sync.aufgabe
        WHERE beendet_am >= date_trunc('day', now()) AND endpunkt NOT LIKE 'fn:%'`)
    this.heuteVerbraucht = Number(r?.n ?? 0)
    log.info('tagesbudget', {
      heuteVerbraucht: this.heuteVerbraucht, uebrig: this.budgetUebrig, grenze: config.TAGESBUDGET,
    })
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

    /**
     * Nach einem Anmeldefehler wird in diesem Prozess nichts mehr versucht.
     *
     * Ohne diese Sperre lief genau das, was harte Regel 6 verbietet: `holen()`
     * fing `AnmeldungFehlgeschlagen` als gewöhnlichen Fehler ab, beim nächsten
     * Posten war die Session immer noch nicht angemeldet, also wurde erneut
     * angemeldet — bis zu zehnmal in Folge, und der stündliche Zeitplan
     * wiederholte das. Bei einem Konto, das sich sperren lässt, und genau
     * einem Zugang ist das der teuerste Fehler, den dieser Code machen kann.
     */
    if (this.anmeldungGescheitert) {
      return {
        art: 'gesperrt', sperrArt: 'anmeldung', status: null, wartenBis: null, dauerMs: 0,
        fehler: 'Anmeldung ist in diesem Lauf bereits gescheitert — kein weiterer Versuch',
      }
    }

    const warten = this.naechsteWartezeit()
    this.letzteWartezeitMs = warten
    if (warten > 0) await schlaf(warten)

    if (!this.session.istAngemeldet) {
      try {
        await this.session.anmelden()
      } catch (e) {
        if (e instanceof AnmeldungFehlgeschlagen) {
          this.anmeldungGescheitert = true
          return {
            art: 'gesperrt', sperrArt: 'anmeldung', status: null, wartenBis: null, dauerMs: 0,
            fehler: e.message,
          }
        }
        throw e
      }
    }

    const form = ep.form ?? 'json'
    const start = Date.now()
    try {
      /**
       * Gesalzene Zugriffsmerkmale auflösen, falls der Endpunkt welche braucht.
       *
       * Das kostet ein bis zwei zusätzliche Aufrufe, die durch dieselbe
       * Drosselung und dasselbe Tagesbudget laufen wie alles andere — sie gehen
       * über `this.holen()`. Ein eigener Posten wäre falsch: der Wert überlebt
       * den Weg durch die Warteschlange nicht.
       */
      let pfad = ep.pfad
      if (ep.braucht) {
        /**
         * „Der Betrieb hat gar kein Belegarchiv" ist eine ANTWORT und kein
         * Fehler — sonst käme jeder seiner vierzehn Ordner viermal wieder und
         * landete auf `aufgegeben`, jede Nacht aufs Neue. Behandelt wie LINAs
         * HTTP 500 mit leerem Rumpf: `keine_daten`, kein Retry. Begründung
         * ausführlich bei `KeinBelegarchiv` in src/ladenakte/token.ts.
         */
        try {
          const aufgeloest = await this.aufloesen(ep, parameter)
          parameter = aufgeloest.parameter
          pfad = aufgeloest.pfad
        } catch (e) {
          if (e instanceof KeinBelegarchiv) {
            return { art: 'keine_daten', status: 200, dauerMs: Date.now() - start }
          }
          throw e
        }
      }

      let res = await this.request(ep, parameter, pfad)
      let text = ohneNullzeichen(await res.text(), ep.key)

      // Session abgelaufen: genau einmal neu anmelden und wiederholen.
      if (sessionAbgelaufen(res, text, form)) {
        log.info('session abgelaufen, melde neu an', { endpunkt: ep.key })
        await this.session.anmelden()
        res = await this.request(ep, parameter, pfad)
        text = ohneNullzeichen(await res.text(), ep.key)
      }

      this.letzterRequest = Date.now()
      this.heuteVerbraucht++
      const dauerMs = Date.now() - start

      // Der dokumentierte Sonderfall aus Phase 1.
      if (res.status >= 500 && text.trim() === '') {
        return { art: 'keine_daten', status: res.status, dauerMs }
      }

      /**
       * Sperre erkennen, bevor irgendetwas als Postenfehler durchgeht.
       *
       * 429 heißt „zu schnell", 403 heißt „nicht mehr". Beides ist eine
       * Aussage über den Zugang, nicht über diesen Zeitraum — den Posten
       * deshalb als aufgegeben zu quittieren wäre schlicht falsch, und ihn
       * gleich darauf mit dem nächsten Posten erneut zu versuchen erst recht.
       */
      if (res.status === 429 || res.status === 403) {
        return {
          art: 'gesperrt',
          sperrArt: res.status === 429 ? 'http_429' : 'http_403',
          status: res.status, dauerMs,
          wartenBis: retryAfter(res.headers.get('retry-after')),
          fehler: `HTTP ${res.status}${res.headers.get('retry-after') ? ` (Retry-After: ${res.headers.get('retry-after')})` : ''}`,
        }
      }
      if (nachAbwehrseiteAussehend(text, form)) {
        return {
          art: 'gesperrt', sperrArt: 'challenge', status: res.status, dauerMs,
          wartenBis: retryAfter(res.headers.get('retry-after')),
          fehler: `Abwehrseite statt Daten (HTTP ${res.status}, ${text.length} Bytes, beginnt mit "${text.slice(0, 60)}")`,
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
      if (form === 'html') {
        // Rohtext durchreichen. Geprüft wird nicht das HTML, sondern das
        // Ergebnis des Parsers — HTML gegen ein Schema zu halten sagt nichts.
        daten = text
      } else {
        try {
          // Nicht JSON.parse: die NUL, an denen der erste Ladenakte-Lauf
          // gescheitert ist, stecken als Escape-Folge im Text und entstehen
          // erst beim Parsen. Siehe src/lib/text.ts.
          daten = jsonOhneNullzeichen(text, ep.key)
        } catch {
          return {
            art: 'fehler', status: res.status, dauerMs,
            fehler: `Antwort ist kein JSON (${text.length} Bytes, beginnt mit "${text.slice(0, 40)}")`,
            wiederholbar: false,
          }
        }
      }

      const bytes = new TextEncoder().encode(text).length
      const hash = Bun.SHA256.hash(text, 'hex')
      return { art: 'ok', daten, form, status: res.status, bytes, hash, dauerMs }

    } catch (e) {
      this.letzterRequest = Date.now()
      const dauerMs = Date.now() - start
      // Falsche Zugangsdaten NICHT wiederholen — der schnellste Weg zur
      // Kontosperre. Kann hier noch aus der Neuanmeldung nach Sessionablauf
      // kommen; ab jetzt ruht der Zugang.
      if (e instanceof AnmeldungFehlgeschlagen) {
        this.anmeldungGescheitert = true
        return {
          art: 'gesperrt', sperrArt: 'anmeldung', status: null,
          fehler: e.message, wartenBis: null, dauerMs,
        }
      }
      return { art: 'fehler', status: null, fehler: String(e), dauerMs, wiederholbar: true }
    }
  }

  /**
   * Gesalzene Zugriffsmerkmale beschaffen. Gibt Parameter und Pfad zurück,
   * weil das Stammdatenblatt seinen Wert im PFAD trägt und nicht in der Query.
   *
   * Nur der Betrieb kommt von aussen (`linaBetriebId`); alles andere holt
   * `token.ts` und merkt es sich für die Dauer eines Betriebs.
   */
  private async aufloesen(ep: Endpunkt, parameter: Record<string, string>):
    Promise<{ parameter: Record<string, string>; pfad: string }> {
    const id = parameter.linaBetriebId
    if (!id) throw new Error(`${ep.key}: linaBetriebId fehlt im Posten — ohne Betrieb kein Token`)

    // Der Ordnungsschlüssel gehört in den Posten, nicht in die Anfrage.
    const { linaBetriebId: _weg, ...rest } = parameter

    if (ep.braucht === 'beleg_token') {
      return { parameter: { ...rest, storeId: await belegToken(this, id) }, pfad: ep.pfad }
    }
    if (ep.braucht === 'bwa_hash') {
      return { parameter: { ...rest, laden: await bwaHash(this, id) }, pfad: ep.pfad }
    }
    if (ep.braucht === 'stamm_pfad') {
      return { parameter: rest, pfad: await stammPfad(this, id) }
    }
    throw new Error(`${ep.key}: unbekanntes braucht "${ep.braucht}"`)
  }

  private request(ep: Endpunkt, parameter: Record<string, string>, pfad = ep.pfad) {
    const url = `${config.LINA_BASE_URL}${pfad}?${new URLSearchParams(parameter)}`
    return fetch(url, {
      headers: this.session.header({ referer: `${config.LINA_BASE_URL}${pfad.split('/').slice(0, 3).join('/')}` }),
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
