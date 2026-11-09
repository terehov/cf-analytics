/**
 * Client für LINAs Third-Party-API (TPAPI) — die offizielle Schnittstelle.
 *
 * WARUM EIN EIGENER CLIENT UND NICHT `lina/client.ts`. Anderer Host
 * (`api.lina.de`), keine Sitzung, kein Anmeldeformular, keine Browserkennung:
 * ein Header `apikey` je Betrieb, sonst nichts. Der Scraper-Client ahmt einen
 * Menschen nach und kennt genau einen Zugang; dieser hier hat 41 Zugänge mit
 * einem dokumentierten Limit (100 Anfragen je Laden und 15 Minuten). Würde er
 * den Takt des Scrapers teilen, bremste der eine den anderen aus, ohne dass
 * einer von beiden das Limit des anderen kennt (Plan D2).
 *
 * WAS ER TUT, und warum gerade so:
 *
 *   * NUR GET. Die Schlüssel tragen nur Leserechte; diese Datei kennt trotzdem
 *     keine andere Methode — fehlender Code statt Konvention.
 *   * TAKT je Instanz (`TPAPI_TAKT_MS`) als Pause zwischen zwei Aufrufen, nicht
 *     als Abstand der Starts: eine langsame Antwort verlängert die Pause nicht
 *     auf null. Regel 3 gilt auch für die offizielle Schnittstelle — dort ist
 *     das Limit sogar ausgeschrieben, und es zählt womöglich Bounti und Sell &
 *     Pick am selben Laden mit (`getlimit` stand in Nürnberg am 09.11.2026
 *     schon vor unserem zweiten Aufruf auf 7).
 *   * KEIN RETRY, für keinen Ausgang. 429 heißt: dieser Laden ist für diesen
 *     Lauf fertig (D6). 401/403 heißt: der Schlüssel wird beim zweiten Mal
 *     genauso abgelehnt (Regel 7). 5xx und Netz: die nächste Nacht. Ein
 *     Wiederholen kostet Kontingent, das am selben Laden womöglich die
 *     Kasse eines anderen Anbieters braucht.
 *   * `redirect: 'manual'`. Eine Umleitung ist hier nie eine Antwort, sondern
 *     ein Zeichen, dass die Basis nicht mehr stimmt — und eine gefolgte
 *     Umleitung würde den Header `apikey` an einen anderen Host tragen.
 *
 * DIE SCHLÜSSEL STEHEN IN KEINER MELDUNG. Jede Meldung, die dieser Client
 * zurückgibt, läuft durch `sauber()`, das JEDEN konfigurierten Schlüssel
 * ersetzt — nicht nur den des gerade gefragten Betriebs: ein Server, der in
 * einer Fehlerseite den falschen Schlüssel zitiert, soll nicht ausgerechnet
 * daran vorbeikommen. Bei Nicht-200 gilt das auch für `roh` und `daten`, weil
 * sie roh gesichert werden. Bei 200 bleiben beide unverändert; sie enthalten
 * `kostUser` und gehören deshalb in keine Logzeile.
 */
import { config } from '../config'

/** Der eine Endpunkt aus Stufe 1 (Plan D1), relativ zu `/extern/`. */
export const PFAD_PERSONAL_STUNDE = 'personal/personalkostenprostunde'

export type TpapiArt = 'ok' | 'nicht_lizenziert' | 'abgewiesen' | 'gebremst' | 'fehler'

export type TpapiAntwort = {
  art: TpapiArt
  /** HTTP-Status; 0, wenn keine Antwort kam (Netz, Zeitgrenze, kein Schlüssel). */
  status: number
  /** Geparstes JSON, sonst null. Bei 200 mit `kostUser` — nie loggen. Bei Nicht-200 gesäubert. */
  daten: unknown
  /** Der Antworttext. Bei 200 mit `kostUser` — nie loggen. Bei Nicht-200 gesäubert. */
  roh: string
  /** Gesäuberte Kurzmeldung für Nicht-200, sonst null. Darf ins Log und nach `sync.tpapi_zugang`. */
  meldung: string | null
}

export type TpapiOptionen = {
  basis?: string
  /** encId → Schlüssel. Vorgabe `config.TPAPI_SCHLUESSEL`. */
  schluessel?: Record<string, string>
  taktMs?: number
  timeoutMs?: number
}

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Ersetzt jeden der Schlüssel in `text` durch `<schluessel>`.
 *
 * Längste zuerst: ist ein Schlüssel Präfix eines anderen, bliebe sonst der
 * Rest des längeren stehen. Leere Werte werden übergangen — `split('')`
 * zerlegte den Text in Zeichen.
 */
export function sauber(text: string, schluessel: Iterable<string>): string {
  let aus = text
  const liste = [...schluessel].filter(s => s.length > 0).sort((a, b) => b.length - a.length)
  for (const s of liste) aus = aus.split(s).join('<schluessel>')
  return aus
}

/** Die Fehlermeldung des Servers, sonst der Anfang des Texts. LINA schickt `{status, message}`. */
function serverMeldung(daten: unknown, roh: string): string {
  if (daten && typeof daten === 'object' && !Array.isArray(daten)) {
    const m = (daten as { message?: unknown }).message
    if (typeof m === 'string' && m.trim()) return m
  }
  return roh.replace(/\s+/g, ' ').trim().slice(0, 200)
}

/**
 * Ordnet eine Antwort einem der fünf Ausgänge zu. Ausgelagert, damit die
 * Regel an EINER Stelle steht und ohne Netz prüfbar ist.
 *
 *   403 „Module '…' not licensed"   → nicht_lizenziert — ein Zustand des
 *                                     Betriebs, kein Fehler (D7). Ratskeller
 *                                     Saarbrücken: 403 auf `revenue/store`,
 *                                     weil nur die Team Data API gebucht ist.
 *   401/403 sonst                   → abgewiesen (Schlüssel, IP-Bindung)
 *   429                             → gebremst
 *   200 mit JSON                    → ok
 *   alles andere                    → fehler (5xx, 3xx, 404, 200 ohne JSON)
 *
 * „not licensed" wird auch bei 401 erkannt: welche der beiden Nummern LINA
 * für eine fehlende Buchung nimmt, ist an einem Endpunkt gemessen, nicht an
 * allen.
 */
export function einordnen(status: number, daten: unknown, roh: string): TpapiArt {
  if (status === 200) return daten === null ? 'fehler' : 'ok'
  if (status === 429) return 'gebremst'
  if (status === 401 || status === 403) {
    return /not licensed/i.test(serverMeldung(daten, roh)) || /not licensed/i.test(roh)
      ? 'nicht_lizenziert' : 'abgewiesen'
  }
  return 'fehler'
}

export class TpapiClient {
  private readonly basis: string
  private readonly schluessel: Record<string, string>
  private readonly taktMs: number
  private readonly timeoutMs: number
  /** Ende des letzten Aufrufs dieser Instanz (ms), 0 = noch keiner. */
  private letzterAufruf = 0
  private readonly zaehler = new Map<string, number>()

  constructor(opt: TpapiOptionen = {}) {
    // Ohne abschließenden Schrägstrich: sonst stünde `//extern/` in der URL,
    // und ob LINAs Router das zusammenfasst, weiß niemand.
    this.basis = (opt.basis ?? config.LINA_API_BASIS).replace(/\/+$/, '')
    this.schluessel = opt.schluessel ?? config.TPAPI_SCHLUESSEL
    this.taktMs = opt.taktMs ?? config.TPAPI_TAKT_MS
    // 60 s wie die Probe: der Journal-Endpunkt brauchte für 2.329 Zeilen
    // spürbar; für die Stundenkosten ist das reichlich, aber eine hängende
    // Verbindung soll den Dienst nicht die ganze Nacht halten.
    this.timeoutMs = opt.timeoutMs ?? 60_000
  }

  /** Aufrufe dieser Instanz für einen Betrieb — die Grundlage für TPAPI_AUFRUFE_JE_BETRIEB. */
  aufrufe(encId: string): number {
    return this.zaehler.get(encId) ?? 0
  }

  /** Aufrufe dieser Instanz insgesamt. */
  aufrufeGesamt(): number {
    let n = 0
    for (const v of this.zaehler.values()) n += v
    return n
  }

  /** `sauber()` mit allen Schlüsseln dieser Instanz. */
  sauber(text: string): string {
    return sauber(text, Object.values(this.schluessel))
  }

  async holen(encId: string, pfad: string, parameter: Record<string, string> = {}): Promise<TpapiAntwort> {
    const schluessel = this.schluessel[encId]
    if (!schluessel) {
      // Kein Aufruf: ohne Schlüssel gäbe es nur ein 401, und das sähe in
      // sync.tpapi_zugang aus wie ein gesperrter Schlüssel.
      return { art: 'fehler', status: 0, daten: null, roh: '', meldung: `kein Schluessel fuer ${encId}` }
    }

    const warten = this.letzterAufruf + this.taktMs - Date.now()
    if (this.letzterAufruf > 0 && warten > 0) await schlaf(warten)

    const url = new URL(`${this.basis}/extern/${pfad.replace(/^\/+/, '')}`)
    for (const [k, v] of Object.entries(parameter)) url.searchParams.set(k, v)

    this.zaehler.set(encId, this.aufrufe(encId) + 1)
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { apikey: schluessel, accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      let roh = await res.text()
      let daten: unknown = null
      try { daten = JSON.parse(roh) } catch { /* kein JSON — bleibt null */ }
      const art = einordnen(res.status, daten, roh)
      if (art === 'ok') return { art, status: res.status, daten, roh, meldung: null }
      /*
       * Jede Nicht-200-Antwort wird VOR der Rückgabe gesäubert, nicht erst
       * die Meldung: auch sie geht nach `raw.api_antwort` (Beleg für den
       * Zustand), und `raw` ist append-only. Eine Fehlerseite, die den
       * gesendeten Schlüssel zitiert, stünde dort sonst für immer.
       */
      roh = this.sauber(roh)
      try { daten = JSON.parse(roh) } catch { daten = null }
      const meldung = `HTTP ${res.status} — ${res.status === 200 ? 'Antwort ist kein JSON' : serverMeldung(daten, roh)}`
        .slice(0, 300)
      return { art, status: res.status, daten, roh, meldung }
    } catch (e) {
      // Netzfehler, Zeitgrenze. Der Text des Fehlers kann die URL tragen —
      // dort steht kein Schlüssel, aber sauber() kostet nichts.
      return {
        art: 'fehler', status: 0, daten: null, roh: '',
        meldung: this.sauber(`Netzfehler: ${String((e as Error)?.message ?? e)}`).slice(0, 300),
      }
    } finally {
      this.letzterAufruf = Date.now()
    }
  }
}
