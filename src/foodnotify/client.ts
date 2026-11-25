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
import { config, fnZugaenge, fnGrenzen, fnTokenBasis } from '../config'
import { log } from '../lib/log'
import { ohneNullzeichen, jsonOhneNullzeichen } from '../lib/text'
import { eine } from '../db/pool'
import { FnSession, FnAnmeldungFehlgeschlagen, fnSessionAbgelaufen } from './auth'
import { auspacken, fehlerAusAntwort } from './huelle'
import { fnTokenPfad, type FnEndpunkt } from './endpunkte'
import { fnStrukturFehler } from './form'
import type { Ergebnis } from '../lina/client'

/**
 * ZWEI ZUGÄNGE, EINE SPUR (0160, Entscheidung Eugene 19.11.2026).
 *
 * Einträge mit `token` im Register (Rezepte, Kassenartikel, Warenstamm)
 * gehen zuerst über das Scope-Token (Bearer gegen FN_TOKEN_BASE_URL), alles
 * andere über die Cookie-Sitzung. Derselbe Client, derselbe Takt, dasselbe
 * FN_TAGESBUDGET — der Token-Weg ist kein zweites Tempo (Regel 3); jeder
 * Aufruf, auch ein gescheiterter Token-Versuch vor dem Rückfall, wartet den
 * Takt ab und zählt gegen das Budget.
 *
 * DER RÜCKFALL BLEIBT IMMER EINGEBAUT. Eugene, 19.11.2026, wörtlich:
 * „Behalte immer den Fallback, falls es mal mit einem Token nicht klappen
 * sollte oder ein Token fehlen sollte." Je Posten wird derselbe Abruf einmal
 * über die Sitzung geholt, wenn
 *   kein_token  für die Marke kein Token in FN_API_TOKENS steht;
 *   abgewiesen  das Token mit 401 oder 403 abgewiesen wird — danach fragt
 *               der Lauf für diese Marke UND diesen Eintrag nicht mehr mit
 *               Token (kein 403 je Posten in Serie);
 *   ausfall     der Token-Weg technisch nicht klappt: Netzfehler, Zeitgrenze,
 *               429, 5xx, ein 404 mit Validierungs- oder Routentext, jeder
 *               andere Nicht-2xx-Status, eine Antwort, die kein JSON ist,
 *               ein Hüllenfehler oder eine fremde Form (`fnStrukturFehler`).
 *               Nach FN_TOKEN_AUSFAELLE_BIS_SITZUNG Ausfällen in Folge geht
 *               die ganze Marke für den Rest des Laufs auf die Sitzung —
 *               sonst kostete jeder Posten zwei Aufrufe, über Tausende Rezepte.
 * Erst wenn auch die Sitzung scheitert, greift die gewöhnliche
 * Fehlerbehandlung des Workers. KEIN Rückfall bei einem fachlichen 404 ohne
 * Validierungs- oder Routentext (Rezept gelöscht, f0fd82a): das ist eine
 * Antwort, kein Ausfall. Der nächste Lauf (ein neuer Prozess, ein neuer
 * Client) versucht das Token wieder.
 *
 * SICHTBAR (Regel 10): jedes Ergebnis trägt `zugangInfo`; der Worker schreibt
 * es nach sync.aufgabe (zugang, zugang_bevorzugt, zugang_rueckfall,
 * zugang_rueckfall_grund) und raw.api_antwort.zugang; mart.fn_zugang_stand
 * liest es.
 *
 * DER TOKENWERT erscheint nirgends: nicht im Pfad (er steht nur im Header),
 * nicht im Fehlertext (jeder Text vom Token-Weg läuft durch `ohneToken`),
 * nicht im Log.
 */
export type FnZugangArt = 'sitzung' | 'token'
/**
 * 'ressource' (0164): 403 „This endpoint does not support scope-limited
 * tokens" — gemessen (23.–25.11.2026) nur an Kostenstellen, deren
 * Warenwirtschaft verschwunden ist („No Erp Found!" über die Sitzung). Es gilt
 * der einen Ressource; das Token bleibt für den Rest der Marke. Bis dahin
 * kippte die erste solche Kostenstelle den Eintrag der ganzen Marke für den
 * Lauf auf die Sitzung, und mart.fn_zugang_stand riet „Token prüfen".
 */
export type FnRueckfall = 'kein_token' | 'abgewiesen' | 'ausfall' | 'ressource'
export type FnZugangInfo = {
  zugang: FnZugangArt
  bevorzugt: FnZugangArt
  rueckfall: FnRueckfall | null
  /** Kurz, ohne Tokenwert: „HTTP 403 — This endpoint does not support scope-limited tokens." */
  rueckfallGrund: string | null
}
export type FnErgebnis = Ergebnis & { zugangInfo: FnZugangInfo }

/**
 * Nach so vielen Ausfällen des Token-Wegs IN FOLGE (je Marke, über alle
 * Einträge) fragt der Lauf diese Marke nur noch über die Sitzung. Drei:
 * einer kann Zufall sein, drei hintereinander sind ein Zustand — und mehr
 * hieße mehr doppelte Aufrufe gegen einen Anbieter, der gerade nicht kann.
 */
export const FN_TOKEN_AUSFAELLE_BIS_SITZUNG = 3

/** Nach so vielen 'ressource'-Abweisungen in Folge (je Marke × Eintrag) gilt der Eintrag als abgewiesen (0164). */
export const FN_TOKEN_RESSOURCE_BIS_SPERRE = 3

/** Jeden Tokenwert aus einem Text entfernen — ein Server, der den Header echot, darf ihn nicht in sync.* tragen. */
export function ohneToken(text: string, tokens: readonly string[] = Object.values(config.FN_API_TOKEN)): string {
  let t = text
  for (const g of tokens) if (g && g.length >= 6) t = t.split(g).join('<token>')
  return t
}

/** Was der Client von einer Sitzung braucht — FnSession erfüllt es, ein Test baut es nach. */
export type FnSitzungLike = {
  readonly istAngemeldet: boolean
  benutzerId: number | null
  anmelden(): Promise<void>
  header(): Record<string, string>
}

type TokenVersuch =
  | { art: 'antwort'; ergebnis: Ergebnis }
  | { art: 'abgewiesen' | 'ausfall' | 'ressource'; grund: string }

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Das 403, das einer Ressource gilt und nicht dem Token (0164, siehe FnRueckfall). */
export function istRessourcenAbweisung(text: string): boolean {
  return /does not support scope-limited tokens/i.test(text)
}

function retryAfter(header: string | null): Date | null {
  if (!header) return null
  const sekunden = Number(header.trim())
  if (Number.isFinite(sekunden) && sekunden >= 0) return new Date(Date.now() + sekunden * 1000)
  const datum = new Date(header)
  return Number.isNaN(datum.getTime()) ? null : datum
}

export class FnClient {
  private sessions = new Map<string, FnSitzungLike>()
  /** Je Marke: nach einem Anmeldefehler in diesem Prozess kein zweiter Versuch. */
  private anmeldungGescheitert = new Set<string>()
  /** `marke|endpunkt` → Grund: in diesem Lauf abgewiesen, nicht mehr mit Token fragen. */
  private tokenAbgewiesen = new Map<string, string>()
  /** 'ressource'-Abweisungen in Folge je Marke × Eintrag, ohne Token-Erfolg dazwischen (0164). */
  private tokenRessourceInFolge = new Map<string, number>()
  /** Je Marke: Ausfälle des Token-Wegs in Folge (ein Erfolg setzt zurück). */
  private tokenAusfaelle = new Map<string, number>()
  /** Je Marke: der letzte Ausfallgrund — für den Rückfallgrund, sobald die Schwelle greift. */
  private tokenLetzterAusfall = new Map<string, string>()
  private holenFn: (url: string, init: RequestInit) => Promise<Response>
  private tokens: () => Record<string, string>
  private tokenBasis: () => string
  private sitzungFabrik: (marke: string) => FnSitzungLike | null
  private grenzen: () => { taktMin: number; taktMax: number; tagesbudget: number }

  /**
   * Ohne Optionen der Betrieb: globales fetch, Tokens und Hosts aus `config`,
   * FnSession je Marke. Die Optionen gibt es für die Tests (src/foodnotify/
   * zugang.test.ts) — der Rückfall soll ohne Datenbank und ohne Netz prüfbar sein.
   */
  constructor(o: {
    fetchFn?: (url: string, init: RequestInit) => Promise<Response>
    tokens?: Record<string, string>
    tokenBasis?: string
    sitzungFabrik?: (marke: string) => FnSitzungLike | null
    /** Nur Tests: Takt und Budget statt fnGrenzen(). */
    grenzen?: () => { taktMin: number; taktMax: number; tagesbudget: number }
  } = {}) {
    this.grenzen = o.grenzen ?? (() => fnGrenzen())
    this.holenFn = o.fetchFn ?? ((url, init) => fetch(url, init))
    this.tokens = () => o.tokens ?? config.FN_API_TOKEN
    this.tokenBasis = () => o.tokenBasis ?? fnTokenBasis()
    this.sitzungFabrik = o.sitzungFabrik ?? ((marke) => {
      const zugang = fnZugaenge().find(z => z.schluessel === marke)
      return zugang ? new FnSession(zugang) : null
    })
  }
  private letzterRequest = 0
  private heute = ''
  private heuteVerbraucht = 0
  letzteWartezeitMs = 0

  get budgetUebrig() { return Math.max(0, this.grenzen().tagesbudget - this.heuteVerbraucht) }

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
   * bei jedem Prozessstart wieder bei null und das Budget hätte nie gegriffen.
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
    const { taktMin, taktMax } = this.grenzen()
    const soll = taktMin + Math.floor(Math.random() * (taktMax - taktMin + 1))
    const seitLetztem = Date.now() - this.letzterRequest
    return Math.max(0, soll - seitLetztem)
  }

  /** Die Session der Marke — oder null, wenn keine Zugangsdaten vorliegen. */
  private session(marke: string): FnSitzungLike | null {
    const offen = this.sessions.get(marke)
    if (offen) return offen
    const s = this.sitzungFabrik(marke)
    if (!s) return null
    this.sessions.set(marke, s)
    return s
  }

  /**
   * Ein Posten: über das Token, wo das Register es bevorzugt, mit der
   * Sitzung als Rückfall (Regel oben am Modul); sonst über die Sitzung.
   */
  async holen(ep: FnEndpunkt, marke: string, parameter: Record<string, string>): Promise<FnErgebnis> {
    this.budgetTagWechseln()
    if (this.budgetUebrig === 0) {
      return { art: 'fehler', status: null, fehler: 'Tagesbudget aufgebraucht', dauerMs: 0, wiederholbar: true,
               zugangInfo: { zugang: ep.token ? 'token' : 'sitzung', bevorzugt: ep.token ? 'token' : 'sitzung', rueckfall: null, rueckfallGrund: null } }
    }
    if (!ep.token) {
      const r = await this.sitzungHolen(ep, marke, parameter)
      return { ...r, zugangInfo: { zugang: 'sitzung', bevorzugt: 'sitzung', rueckfall: null, rueckfallGrund: null } }
    }

    let rueckfall: FnRueckfall
    let grund: string
    const token = this.tokens()[marke]
    const sperrSchluessel = `${marke}|${ep.key}`
    const ausfaelle = this.tokenAusfaelle.get(marke) ?? 0
    if (!token) {
      rueckfall = 'kein_token'
      grund = `kein Token für ${marke} in FN_API_TOKENS`
    } else if (this.tokenAbgewiesen.has(sperrSchluessel)) {
      rueckfall = 'abgewiesen'
      grund = `in diesem Lauf schon abgewiesen: ${this.tokenAbgewiesen.get(sperrSchluessel)}`
    } else if (ausfaelle >= FN_TOKEN_AUSFAELLE_BIS_SITZUNG) {
      rueckfall = 'ausfall'
      grund = `${ausfaelle} Ausfälle in Folge in diesem Lauf, Marke läuft über die Sitzung; zuletzt: ${this.tokenLetzterAusfall.get(marke) ?? '?'}`
    } else {
      const v = await this.tokenHolen(ep, token, parameter)
      if (v.art === 'antwort') {
        this.tokenAusfaelle.set(marke, 0)
        this.tokenRessourceInFolge.delete(sperrSchluessel)
        return { ...v.ergebnis, zugangInfo: { zugang: 'token', bevorzugt: 'token', rueckfall: null, rueckfallGrund: null } }
      }
      rueckfall = v.art
      grund = v.grund
      if (v.art === 'abgewiesen') {
        this.tokenAbgewiesen.set(sperrSchluessel, v.grund)
      } else if (v.art === 'ressource') {
        /*
         * Einzeln gilt es der Ressource (eine Kostenstelle ohne
         * Warenwirtschaft zwischen lauter lebenden). Dieselbe Meldung kommt
         * aber auch, wenn ein Endpunkt das Token GAR NICHT trägt (19.11.2026:
         * Bestellpositionen, Inventuren) — dann wäre jeder Posten ein 403
         * plus Sitzung. Drei in Folge ohne Token-Erfolg dazwischen sind
         * deshalb keine Ressource mehr, sondern der Eintrag: gesperrt wie
         * 'abgewiesen'.
         */
        const n = (this.tokenRessourceInFolge.get(sperrSchluessel) ?? 0) + 1
        this.tokenRessourceInFolge.set(sperrSchluessel, n)
        if (n >= FN_TOKEN_RESSOURCE_BIS_SPERRE) {
          rueckfall = 'abgewiesen'
          grund = `${n} Abweisungen in Folge ohne Token-Erfolg — Eintrag der Marke gesperrt; zuletzt: ${v.grund}`
          this.tokenAbgewiesen.set(sperrSchluessel, grund)
        }
      } else {
        this.tokenAusfaelle.set(marke, ausfaelle + 1)
        this.tokenLetzterAusfall.set(marke, v.grund)
      }
      log.warn('foodnotify-token: rückfall auf die sitzung', { marke, endpunkt: ep.key, rueckfall, grund })
      if (this.budgetUebrig === 0) {
        return { art: 'fehler', status: null, fehler: 'Tagesbudget aufgebraucht', dauerMs: 0, wiederholbar: true,
                 zugangInfo: { zugang: 'token', bevorzugt: 'token', rueckfall, rueckfallGrund: grund } }
      }
    }
    const r = await this.sitzungHolen(ep, marke, parameter)
    return { ...r, zugangInfo: { zugang: 'sitzung', bevorzugt: 'token', rueckfall, rueckfallGrund: grund.slice(0, 500) } }
  }

  /**
   * EIN Aufruf über das Token. Nie ein zweiter Versuch hier: ein Ausfall geht
   * zur Sitzung, nicht noch einmal zum Token.
   */
  private async tokenHolen(ep: FnEndpunkt, token: string, parameter: Record<string, string>): Promise<TokenVersuch> {
    let pfad: string
    try {
      pfad = fnTokenPfad(ep, parameter)
    } catch (e) {
      // Einreihungsfehler: scheitert auch über die Sitzung — dort mit der
      // gewöhnlichen Meldung. Kein Aufruf, kein Rückfallgrund außer diesem.
      return { art: 'ausfall', grund: this.ohneToken(`Pfad nicht baubar: ${String(e).slice(0, 200)}`) }
    }
    const warten = this.naechsteWartezeit()
    this.letzteWartezeitMs = warten
    if (warten > 0) await schlaf(warten)
    const start = Date.now()
    let res: Response
    let text: string
    try {
      res = await this.holenFn(`${this.tokenBasis()}${pfad}`, {
        headers: { accept: 'application/json', 'user-agent': config.LINA_USER_AGENT, authorization: `Bearer ${token}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(fnZeitgrenzeMs(ep)),
      })
      text = ohneNullzeichen(await res.text(), ep.key)
    } catch (e) {
      this.letzterRequest = Date.now()
      this.heuteVerbraucht++
      const zeit = (e as Error)?.name === 'TimeoutError'
      return { art: 'ausfall', grund: this.ohneToken(zeit ? `Zeitgrenze ${fnZeitgrenzeMs(ep) / 1000} s` : `Netzfehler: ${String(e).slice(0, 200)}`) }
    }
    this.letzterRequest = Date.now()
    this.heuteVerbraucht++
    const dauerMs = Date.now() - start

    if (!res.ok) {
      const { meldung, anfrageFehler } = fehlerAusAntwort(text)
      const kurz = this.ohneToken(`HTTP ${res.status}${meldung ? ` — ${meldung}` : ''}`).slice(0, 300)
      if (res.status === 403 && istRessourcenAbweisung(text)) return { art: 'ressource', grund: kurz }
      if (res.status === 401 || res.status === 403) return { art: 'abgewiesen', grund: kurz }
      /*
       * Der fachliche 404: das Rezept (die Kostenstelle, die Anbindung) gibt
       * es nicht. Eine Antwort, kein Ausfall — dieselbe Form wie auf dem
       * Sitzungsweg, damit alsNichtGefundenVerbuchen() gleich entscheidet.
       */
      if (res.status === 404 && !anfrageFehler) {
        return { art: 'antwort', ergebnis: { art: 'fehler', status: 404, dauerMs, wiederholbar: false,
          fehler: this.ohneToken(`HTTP 404${meldung ? ` — ${meldung}` : ''}`) } }
      }
      return { art: 'ausfall', grund: anfrageFehler ? `${kurz} (${anfrageFehler})` : kurz }
    }
    let daten: unknown
    try {
      daten = jsonOhneNullzeichen(text, ep.key)
    } catch {
      return { art: 'ausfall', grund: `HTTP ${res.status}, Antwort ist kein JSON (${text.length} Bytes)` }
    }
    const huelle = auspacken(daten)
    if (huelle.fehler) return { art: 'ausfall', grund: this.ohneToken(`Hüllenfehler bei HTTP ${res.status}: ${huelle.fehler.slice(0, 200)}`) }
    const form = fnStrukturFehler(ep.key, daten)
    if (form) return { art: 'ausfall', grund: this.ohneToken(`fremde Form: ${form.slice(0, 200)}`) }
    const bytes = new TextEncoder().encode(text).length
    return { art: 'antwort', ergebnis: { art: 'ok', daten, form: 'json', status: res.status, bytes,
      hash: Bun.SHA256.hash(text, 'hex'), dauerMs } }
  }

  private ohneToken(text: string): string { return ohneToken(text, Object.values(this.tokens())) }

  /** Der Sitzungsweg — unverändert seit vor 0160, jetzt nur unter eigenem Namen. */
  private async sitzungHolen(ep: FnEndpunkt, marke: string, parameter: Record<string, string>): Promise<Ergebnis> {
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

      let res = await this.request(pfad, session, ep)
      // Session abgelaufen: genau einmal neu anmelden und wiederholen.
      if (fnSessionAbgelaufen(res)) {
        log.info('foodnotify-session abgelaufen, melde neu an', { marke, endpunkt: ep.key })
        await session.anmelden()
        res = await this.request(pfad, session, ep)
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
      /**
       * DER ANTWORTTEXT WIRD MITGELESEN (18.11.2026). Bis dahin stand hier
       * nur `HTTP ${status}` — und damit war ausgerechnet der Text verloren,
       * der ein Validierungs-404 („Dieser Wert sollte nicht leer sein.") von
       * einem echten „gibt es nicht" unterscheidet. Das Präfix „HTTP NNN"
       * bleibt unverändert: nachfuellen.ts und 0135 suchen mit
       * `LIKE 'HTTP 500%'`, und ein leerer Fehlerkörper ergibt weiter genau
       * „HTTP 500". Bei der HTML-Bestellansicht wird nichts gelesen — eine
       * Fehlerseite der Oberfläche ist Navigation, keine Meldung.
       */
      if (!res.ok) {
        const { meldung, anfrageFehler } = ep.form === 'html'
          ? { meldung: '', anfrageFehler: null }
          : fehlerAusAntwort(text)
        const art = anfrageFehler === 'validierung' ? ' (Validierung: die Anfrage stimmt nicht, kein fehlender Datensatz)'
          : anfrageFehler === 'route' ? ' (keine Route: der Pfad fehlt, kein fehlender Datensatz)'
          : ''
        return {
          art: 'fehler', status: res.status, dauerMs,
          fehler: `HTTP ${res.status}${art}${meldung ? ` — ${meldung}` : ''}`,
          wiederholbar: res.status >= 500,
          ...(anfrageFehler ? { anfrageFehler } : {}),
        }
      }

      /**
       * Eine Seite der Oberflaeche (0135): der Text geht unveraendert durch.
       * Eine Fehlerseite kaeme hier mit 200 nur dann an, wenn FoodNotify sie
       * so ausliefert — gemessen kam sie mit 500 ("Diese Bestellung ist nicht
       * vorhanden"), und was der Parser nicht als Bestellung erkennt, wirft
       * beim Laden.
       */
      if (ep.form === 'html') {
        const bytes = new TextEncoder().encode(text).length
        return { art: 'ok', daten: text, form: 'html', status: res.status, bytes,
                 hash: Bun.SHA256.hash(text, 'hex'), dauerMs }
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
      // Alles ausser fn:bestellansicht ist JSON.
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

  private request(pfad: string, session: FnSitzungLike, ep: FnEndpunkt) {
    return this.holenFn(`${config.FN_BASE_URL}${pfad}`, {
      headers: session.header(),
      redirect: 'manual',
      signal: AbortSignal.timeout(fnZeitgrenzeMs(ep)),
    })
  }
}

/**
 * Die Zeitgrenze eines Aufrufs. Ein gemessen langsamer Pfad (`zeitgrenze:
 * 'lang'`, seit 0155 fn:pos_artikel) bekommt FN_ZEITGRENZE_LANG_MS — der
 * größere der beiden Werte, damit ein erhöhtes ANFRAGE_TIMEOUT_MS nicht
 * ausgerechnet den langsamen Pfad verkürzt. Ein Abbruch ist ein
 * wiederholbarer Fehler: keine Rohantwort, core bleibt unberührt.
 */
export function fnZeitgrenzeMs(ep: Pick<FnEndpunkt, 'zeitgrenze'>, c: typeof config = config): number {
  return ep.zeitgrenze === 'lang'
    ? Math.max(c.ANFRAGE_TIMEOUT_MS, c.FN_ZEITGRENZE_LANG_MS)
    : c.ANFRAGE_TIMEOUT_MS
}
