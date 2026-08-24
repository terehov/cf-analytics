/**
 * Bounti External API v1 — lesender Zugriff.
 *
 * NUR GET. Diese Datei kennt keine andere Methode, und das ist keine
 * Konvention, sondern fehlender Code. Von den 29 Pfaden der Schnittstelle
 * schreiben 22: sie legen Mitarbeitende an, archivieren und loeschen sie,
 * weisen Kurse zu, aendern Firmeneinstellungen und verschicken Push-
 * Nachrichten an alle Mitarbeitenden (POST /notifications). Das ist das
 * Schulungssystem im laufenden Betrieb — ein versehentlicher Schreibzugriff
 * waere hier nicht eine falsche Zahl, sondern eine Nachricht auf hundert
 * Telefonen.
 *
 * DER RHYTHMUS. Bounti nennt sein Limit selbst: 3.000 Anfragen je Stunde,
 * dazu vier Kopfzeilen in jeder Antwort (RateLimit-Limit, -Policy,
 * -Remaining, -Reset). Damit ist es der erste Dienst in diesem Projekt, der
 * seinen eigenen Stand mitliefert — und deshalb wird hier nicht geraten,
 * sondern gelesen:
 *
 *   * Kein kuenstlicher Grundtakt wie bei LINA. Dort wird ein Mensch
 *     nachgeahmt und es gibt genau einen Zugang; hier gibt es einen
 *     dokumentierten Schluessel mit einem ausgeschriebenen Limit.
 *   * Aber seriell, nie parallel — dieselbe Bremse wie bei Yext.
 *   * Faellt RateLimit-Remaining unter BOUNTI_RESERVE, hoert der Lauf von
 *     selbst auf (BountiBudget). Nicht abgearbeitete Lerneinheiten bleiben
 *     im Rueckstand stehen und sind in mart.bounti_zuweisung_stand sichtbar.
 *     Ein Lauf, der ins Limit rennt, verliert die naechste Stunde fuer alle
 *     anderen mit.
 *
 * WAS HIER NICHT PASSIERT: eine Wiederholung nach 401/403. Ein abgelehnter
 * Schluessel wird beim zweiten Mal genauso abgelehnt (AGENTS.md Regel 7).
 */
import { config } from '../config'
import { log } from '../lib/log'
import { ohneNullzeichen, jsonOhneNullzeichen } from '../lib/text'

export class BountiFehler extends Error {
  constructor(msg: string, readonly status: number, readonly endgueltig: boolean) {
    super(msg)
    this.name = 'BountiFehler'
  }
}

/**
 * Kein Fehler im eigentlichen Sinn, sondern das Ende der Arbeit fuer heute:
 * das Aufrufbudget dieses Laufs ist aufgebraucht oder Bounti meldet zu wenig
 * Rest. Die Lader fangen das ab und beenden geordnet — was fehlt, holt die
 * naechste Nacht.
 */
export class BountiBudget extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'BountiBudget'
  }
}

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Aufrufe dieses Prozesses. Der Lauf ist ein eigener Prozess (siehe sync.ts). */
let aufrufe = 0
/** Was Bounti zuletzt als Rest gemeldet hat. null = noch nichts gesehen. */
let restZuletzt: number | null = null
/** Hat Bounti gemeldet, dass das Stundenkontingent knapp wird? */
let knapp = false
/** Wie oft hat Bounti diesen Prozess mit 429 abgewiesen? */
let gesperrt = 0

export function bountiZaehler(): { aufrufe: number; rest: number | null } {
  return { aufrufe, rest: restZuletzt }
}

/** Nur fuer Tests: den Zaehler zuruecksetzen. */
export function bountiZaehlerZuruecksetzen(): void {
  aufrufe = 0
  restZuletzt = null
  seitengroesse = null
  knapp = false
  gesperrt = 0
}

/**
 * Die Seitengroesse, einmal ermittelt und dann behalten.
 *
 * Die Spezifikation nennt die Voreinstellung 20 und schreibt eine Obergrenze
 * NUR bei den Audit-Zeitplaenen aus ("1-100"). Ob 100 ueberall geht, steht
 * nirgends. Deshalb dasselbe Vorgehen wie bei Yext mit den zwei Auth-Wegen:
 * der erste Aufruf probiert den grossen Wert; lehnt Bounti ihn mit 400 ab,
 * faellt der Client dauerhaft auf 20 zurueck und sagt es einmal im Log.
 *
 * Ein fest verdrahteter kleiner Wert waere die teurere Variante: bei 2.000
 * Mitarbeitenden sind das 100 Aufrufe statt 20, jede Nacht.
 */
let seitengroesse: number | null = null

export function bountiKonfiguriert(): boolean {
  return Boolean(config.BOUNTI_API_TOKEN)
}

function warteAusKopfzeilen(h: Headers, versuch: number): number {
  const retry = h.get('retry-after')
  if (retry) {
    const s = Number(retry.trim())
    if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, 120_000)
  }
  // RateLimit-Reset ist laut Doku "UTC epoch seconds" — manche Dienste
  // liefern stattdessen Sekunden BIS zum Reset. Beides wird akzeptiert,
  // weil ein falsch gedeuteter Reset entweder gar nicht wartet oder bis
  // 1970 rechnet, und der zweite Fall waere ein negativer Schlaf.
  const reset = Number(h.get('ratelimit-reset') ?? '')
  if (Number.isFinite(reset) && reset > 0) {
    const ms = reset > 1_000_000_000 ? reset * 1000 - Date.now() : reset * 1000
    if (ms > 0) return Math.min(ms, 120_000)
  }
  return Math.min(1000 * versuch, 30_000)
}

/**
 * Ein lesender Aufruf.
 *
 * Wiederholt bei 429, 5xx und Netzfehlern. Nicht bei 400/401/403/404: ein
 * falscher Parameter bleibt falsch, ein abgelehnter Schluessel bleibt
 * abgelehnt.
 */
export async function bountiHolen<T>(
  pfad: string, params: Record<string, string> = {},
): Promise<T> {
  const token = config.BOUNTI_API_TOKEN
  if (!token) throw new BountiFehler('BOUNTI_API_TOKEN ist nicht gesetzt', 0, true)

  if (aufrufe >= config.BOUNTI_AUFRUFE_MAX) {
    throw new BountiBudget(
      `Aufrufbudget dieses Laufs erschoepft (${aufrufe} von ${config.BOUNTI_AUFRUFE_MAX}). `
      + `Der Rest bleibt im Rueckstand stehen und wird beim naechsten Lauf geholt.`)
  }
  // Bounti selbst hat gesagt, dass es eng wird. Siehe unten bei `knapp`.
  if (knapp) {
    throw new BountiBudget(
      `Bounti meldet weniger als ${config.BOUNTI_RESERVE} Aufrufe Rest in dieser Stunde `
      + `(zuletzt ${restZuletzt}). Der Lauf hoert auf, statt das Kontingent leerzuraeumen — `
      + `am selben Schluessel haengt moeglicherweise die App der Mitarbeitenden.`)
  }
  /*
   * Wiederholte 429 sind kein Bremssignal mehr, sondern eine Sperre.
   *
   * Ohne diese Grenze koennte ein gesperrtes Stundenfenster den Sync-Lauf
   * blockieren: MAX_VERSUCHE Versuche je Aufruf, bis zu 120 s Wartezeit je
   * Versuch, und das bei jedem der bis zu 1.200 Aufrufe. Nach der dritten
   * Sperre steht fest, dass Warten nicht hilft — der Rest gehoert in die
   * naechste Nacht.
   */
  if (gesperrt >= 3) {
    throw new BountiBudget(
      `Bounti hat ${gesperrt}-mal mit 429 abgewiesen. Das Stundenfenster ist zu, `
      + `der Rest folgt beim naechsten Lauf.`)
  }

  const basis = config.BOUNTI_BASE_URL.replace(/\/+$/, '')
  let letzter: BountiFehler | null = null

  for (let versuch = 1; versuch <= config.MAX_VERSUCHE; versuch++) {
    const url = new URL(`${basis}${pfad}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

    aufrufe++
    let antwort: Response
    try {
      antwort = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(config.ANFRAGE_TIMEOUT_MS),
      })
    } catch (e) {
      letzter = new BountiFehler(
        `Netzfehler: ${String((e as Error).message).slice(0, 200)}`, 0, false)
      if (versuch < config.MAX_VERSUCHE) { await schlaf(1000 * versuch); continue }
      break
    }

    // Was Bounti selbst ueber den Rest sagt — vor der Auswertung der
    // Antwort, denn auch ein 429 traegt die Kopfzeilen.
    const rest = Number(antwort.headers.get('ratelimit-remaining') ?? '')
    if (Number.isFinite(rest)) restZuletzt = rest

    /**
     * NUL raus, bevor etwas davon in die Datenbank geht.
     *
     * Von hier kommen Namen von Menschen, Kurstiteln und Auditfragen —
     * alles von Hand getippt, teils aus einer mobilen App. Ein einziges NUL
     * laesst den Sammel-INSERT einer ganzen Seite scheitern; siehe
     * src/lib/text.ts zu den zwei Wegen.
     */
    const text = ohneNullzeichen(await antwort.text(), `bounti${pfad}`)

    if (antwort.ok) {
      /*
       * Der Rest wird NACH einer erfolgreichen Antwort geprueft: erst das
       * Ergebnis sichern, dann entscheiden, ob noch ein Aufruf drin ist.
       *
       * UND ER WIRD DURCHGESETZT, NICHT NUR GEMELDET. Hier stand bis zum
       * 24.08.2026 ein blosses log.warn mit dem Text "der Lauf hoert hier
       * auf" — der Lauf hoerte aber nicht auf. Eine Zusicherung, die nur im
       * Kommentar steht, ist keine; und diese hier hat einen Zweck, der
       * ueber uns hinausgeht: haengt die App der Mitarbeitenden am selben
       * Schluessel, sperrt ein leergeraeumtes Kontingent sie fuer den Rest
       * der Stunde aus.
       *
       * Der Merker `knapp` sorgt dafuer, dass die Meldung einmal kommt und
       * der naechste Aufruf sauber abbricht — das gerade geholte Ergebnis
       * geht dabei nicht verloren.
       */
      if (Number.isFinite(rest) && rest >= 0 && rest < config.BOUNTI_RESERVE) {
        if (!knapp) {
          knapp = true
          log.warn('bounti-kontingent fast aufgebraucht — der Lauf hoert hier auf', {
            rest, reserve: config.BOUNTI_RESERVE, aufrufe,
            sicht: 'mart.bounti_zuweisung_stand',
          })
        }
      }
      return jsonOhneNullzeichen(text, `bounti${pfad}`) as T
    }

    // Bountis Fehler tragen selbst {error, message} — die Meldung ist
    // aussagekraeftiger als der Statuscode allein.
    let meldung = text.slice(0, 200)
    try {
      const j = JSON.parse(text) as { error?: string; message?: string }
      if (j?.error) meldung = `${j.error}${j.message ? ` — ${j.message}` : ''}`
    } catch { /* bei 5xx kann HTML kommen */ }

    letzter = new BountiFehler(`HTTP ${antwort.status} — ${meldung}`, antwort.status,
      antwort.status !== 429 && antwort.status < 500)

    if (antwort.status === 429 || antwort.status >= 500) {
      if (antwort.status === 429) gesperrt++
      const warten = warteAusKopfzeilen(antwort.headers, versuch)
      log.warn('bounti bremst', { status: antwort.status, wartenMs: warten, versuch, rest })
      if (versuch < config.MAX_VERSUCHE) { await schlaf(warten); continue }
    }
    break
  }

  throw letzter ?? new BountiFehler('Unbekannter Fehler', 0, true)
}

/** Die Huelle jeder Liste: Zeilen plus Zeiger auf die naechste Seite. */
type Seite<T> = { next: string | null; rows: T[] }

/**
 * Alle Seiten eines Listenendpunkts.
 *
 * `next` ist laut Spezifikation die ID des ERSTEN Elements der naechsten
 * Seite und wird als `cursor` zurueckgegeben. Zwei Abbruchbedingungen
 * neben dem leeren `next`:
 *
 *   * derselbe Cursor zweimal — dann dreht sich die Schleife, und eine
 *     Endlosschleife gegen eine fremde API ist der teuerste Fehler, den man
 *     nachts unbeaufsichtigt machen kann;
 *   * eine Seitenobergrenze als Rueckhalt.
 */
export async function bountiSeiten<T>(
  pfad: string, params: Record<string, string> = {},
): Promise<T[]> {
  const raus: T[] = []
  const gesehen = new Set<string>()
  let cursor = ''
  let seiten = 0

  for (;;) {
    const limit = seitengroesse ?? config.BOUNTI_SEITE
    let seite: Seite<T>
    try {
      seite = await bountiHolen<Seite<T>>(pfad, {
        ...params, limit: String(limit), ...(cursor ? { cursor } : {}),
      })
    } catch (e) {
      // Die einmalige Ruecknahme der Seitengroesse, siehe oben bei
      // `seitengroesse`. Nur beim ersten Aufruf und nur bei 400.
      if (e instanceof BountiFehler && e.status === 400 && seitengroesse === null
          && limit > 20 && /limit/i.test(e.message)) {
        log.warn('bounti nimmt die grosse Seite nicht — dauerhaft auf 20 zurueck', {
          versucht: limit, meldung: e.message.slice(0, 120),
        })
        seitengroesse = 20
        continue
      }
      throw e
    }
    if (seitengroesse === null) seitengroesse = limit

    raus.push(...(seite.rows ?? []))
    const next = seite.next ?? ''
    if (!next) break
    if (gesehen.has(next)) {
      log.warn('bounti liefert denselben Cursor erneut — Seitenlauf abgebrochen',
        { pfad, cursor: next, seiten, zeilen: raus.length })
      break
    }
    gesehen.add(next)
    cursor = next
    if (++seiten >= config.BOUNTI_SEITEN_MAX) {
      log.warn('bounti-Seitenobergrenze erreicht — der Rest fehlt', {
        pfad, seiten, zeilen: raus.length, grenze: config.BOUNTI_SEITEN_MAX,
      })
      break
    }
  }
  return raus
}

// =====================================================================
// Die sieben gelesenen Endpunkte. Die Typen tragen nur die Felder, die
// auch gespeichert werden -- was nicht im Typ steht, kann niemand
// versehentlich in ein INSERT schreiben (dieselbe Regel wie bei
// core.bewertung, wo authorEmail bewusst fehlt).
// =====================================================================

export type BStandort = { id: string; name: string }
export type BRolle = { id: string; name: string }

export type BMitarbeiter = {
  id: string
  name: string
  surname: string
  roles: { id: string; name: string }[]
  locations: { id: string; name: string }[]
  /**
   * NUR FUER DIE FELDNAMEN. Die Werte werden nirgends gespeichert; der
   * Lader zaehlt, welche Schluessel konfiguriert und wie oft sie belegt
   * sind (core.bounti_feldname). Begruendung dort.
   *
   * `email` und `phone` liefert Bounti ebenfalls und stehen hier bewusst
   * nicht.
   */
  customFields?: Record<string, unknown>
}

export type BLerneinheit = { id: string; name: string }

export type BZuweisung = {
  id: string
  employeeId: string
  createdAt: string
  dueAt: string | null
  completedAt: string | null
  /** BRUCH, nicht Prozent: Bountis Doku sagt "0.8 is 80%". Nur bei Kursen. */
  assessmentScore?: number | null
}

export type BFortschritt = {
  id: string
  name: string
  courses: { total: number; completed: number }
}

export type BAudit = {
  id: string
  name: string
  description: string | null
  type: 'EMPLOYEE_AUDIT' | 'LOCATION_AUDIT'
  createdAt: string
  updatedAt: string
}

export type BAuditbericht = {
  id: string
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  totalPoints: number
  achievedPoints: number
  /** Bereits eine PROZENTZAHL (Beispiel 85) — anders als assessmentScore. */
  achievedPercentage: number
  auditId: string
  scheduleId: string | null
  auditor: { id: string } | null
  assignedEntity:
    | { type: 'EMPLOYEE'; id: string }
    | { type: 'LOCATION'; id: string }
}

export const standorteHolen = () => bountiSeiten<BStandort>('/external/v1/locations')

/** Ohne Seitenlauf: /roles liefert ein blankes Array, keine Huelle. */
export const rollenHolen = () => bountiHolen<BRolle[]>('/external/v1/roles')

/**
 * Mitarbeitende — BEIDE Listen.
 *
 * `status` ist der Filter, nicht `isArchived`: die Spezifikation fuehrt
 * beide, und `status` hat die Voreinstellung 'active'. Ohne den zweiten
 * Aufruf saehe der Import jedes Ausscheiden als spurloses Verschwinden, und
 * die Abgangszahl bestuende nur aus der Differenz zweier Kopfzahlen — also
 * aus nichts.
 */
export const mitarbeiterHolen = (archiviert = false) =>
  bountiSeiten<BMitarbeiter>('/external/v1/employees',
    { status: archiviert ? 'archived' : 'active' })

export const kurseHolen = () => bountiSeiten<BLerneinheit>('/external/v1/courses')
export const pfadeHolen = () => bountiSeiten<BLerneinheit>('/external/v1/paths')

export const kurszuweisungenHolen = (kursId: string) =>
  bountiSeiten<BZuweisung>(`/external/v1/courses/${encodeURIComponent(kursId)}/assignments`)

export const pfadzuweisungenHolen = (pfadId: string) =>
  bountiSeiten<BZuweisung>(`/external/v1/paths/${encodeURIComponent(pfadId)}/assignments`)

/** Ein Aufruf fuer ALLE Standorte, ohne Seitenlauf und ohne Zeitraum. */
export const fortschrittHolen = async (): Promise<BFortschritt[]> =>
  (await bountiHolen<{ rows: BFortschritt[] }>('/external/v1/locations/progress')).rows ?? []

export const auditsHolen = () => bountiSeiten<BAudit>('/external/v1/audits')

/**
 * Auditberichte, inkrementell.
 *
 * Der EINZIGE Listenendpunkt der Schnittstelle mit einem Zeitfilter
 * (`after`/`before`) — deshalb ist er auch der einzige, der nicht jede
 * Nacht alles neu holt. Ohne `after` kommt der ganze Bestand.
 *
 * Der deprecated Zwilling unter /audits/{id}/schedules/{id}/reports wird
 * nicht benutzt; die Spezifikation verweist selbst hierher.
 */
export const auditberichteHolen = (ab?: string) =>
  bountiSeiten<BAuditbericht>('/external/v1/audits/reports', ab ? { after: ab } : {})
