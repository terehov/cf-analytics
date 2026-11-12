/**
 * Formprobe der Third-Party-API (TPAPI), Stufe 2 — docs/plan-tpapi-stufe2.md, §3
 *
 *   bun run tpapi-formprobe [--tag 09.11.2026] [--laden <encId>]... [--alle] [--aus datei.json]
 *
 * WOFUER: Die Werte der TPAPI-Felder sind nicht gemessen (Typ, Datumsformat, Vorzeichen,
 * Leerwert), und ohne sie lassen sich die Lader fuer Journal, Bons, Personal und Artikelstamm
 * nicht bauen. Das Skript misst je Feld ein Profil, beantwortet die Fragen, an denen das
 * Datenmodell haengt (Journal-Summen je Finanzweg, Geschaeftstagsgrenze, Schluessel zwischen
 * Journal und Bons, Tiefe des Verlaufs) und schreibt Text auf die Konsole und dieselbe
 * Information als JSON in eine Datei.
 *
 * WO ES LAEUFT: NUR im Importer-Container per `docker exec` (der Schluessel ist an die IPv4 des
 * Servers gebunden, und Regel 7a: nie aus der Agentenumgebung). Beispiel wie bei der Probe:
 *
 *   docker exec $(docker ps --format '{{.Names}}' | grep cf-analytics-sync) bun run tpapi-formprobe --tag 09.11.2026
 *   docker exec ... bun run tpapi-formprobe --alle          # zusaetzlich listdays je Schluessel
 *
 * WAS ES NIE TUT: nur GET, nur Endpunkte aus ERLAUBT (jeder Aufruf wird dagegen geprueft),
 * keine Datenbank, keine Rohantwort in Datei oder Konsole, kein Wiederholen. Nie: acceptedworkingtimes,
 * userdataperday(delta), getPersonalData, webcashregister, irgendetwas Schreibendes.
 * Datenschutz: fuer Freitext-, Personen- und Postleitzahlfelder gibt es keine Beispielwerte und
 * kein Min/Max; personalkostenprotag nur als Summen; kostUser wird nicht ausgewertet.
 *
 * AUFRUFE JE BETRIEB (Grenze dokumentiert: 100 je Laden und 15 Minuten, andere Anbieter lesen
 * mit — das Skript bricht bei 55 ab): store 1, getlimit 2, listdays 1, prostunde 1, protag 1,
 * journal 1, journaltables 1, forecast 1-2, merchandiseman 13, Alterstest 6 = 28 bis 29. Bei der
 * Auswahl der Betriebe (ohne --laden) kommt je geprueftem Schluessel ein store dazu; mit --alle
 * ein listdays je uebrigem Schluessel. Pause: mindestens eine Sekunde zwischen zwei Aufrufen,
 * also rund 35 Sekunden je Betrieb; zwei Betriebe etwa 1,5 Minuten, mit --alle bei 41
 * Schluesseln knapp eine Minute mehr.
 */
import { writeFileSync } from 'node:fs'

const BASIS = (process.env.LINA_API_BASIS ?? 'https://api.lina.de').replace(/\/$/, '')
const PAUSE_MS = 1100
const MAX_JE_BETRIEB = 55

// ---------------------------------------------------------------------------------------------
// Erlaubtliste — die einzige Stelle, an der ein Pfad entstehen darf
// ---------------------------------------------------------------------------------------------

const MERCH = [
  'recipe', 'attributes', 'meccode', 'vat', 'financetype', 'financecategory', 'pricelevel',
  'site', 'operationprofile', 'meccodegroup', 'category', 'detailcategory', 'grosscategory',
] as const

export const ERLAUBT: ReadonlySet<string> = new Set([
  'revenue/store',
  'revenue/getlimit',
  'revenue/listdays',
  'revenue/journal',
  'revenue/journaltables',
  'revenue/getforecastperday',
  'personal/personalkostenprostunde',
  'personal/personalkostenprotag',
  ...MERCH.map(m => `merchandiseman/${m}`),
])

export function pfadPruefen(pfad: string): void {
  if (!ERLAUBT.has(pfad)) throw new Error(`Pfad nicht erlaubt: ${pfad.slice(0, 80)}`)
}

/** Entfernt jeden Schluessel aus einem Text, bevor er ausgegeben wird. */
export function bereinigen(text: string, schluessel: readonly string[]): string {
  let t = text
  for (const s of schluessel) if (s) t = t.split(s).join('<schluessel>')
  return t
}

// ---------------------------------------------------------------------------------------------
// Datenschutz
// ---------------------------------------------------------------------------------------------

const GESPERRT_EXAKT = new Set(['debitor_text', 'addinfo', 'zip_code', 'kellnernr', 'masterkellnernr', 'teamnr'])

/** Felder, zu denen es keine Beispielwerte und kein Min/Max gibt. `name` ist bei merchandiseman erlaubt. */
export function feldGesperrt(name: string, merch: boolean): boolean {
  const n = name.toLowerCase()
  if (GESPERRT_EXAKT.has(n)) return true
  if (n.includes('user') || n.includes('mail') || n.includes('phone') || n.includes('birth')) return true
  if (n.includes('name') && !merch) return true
  return false
}

// ---------------------------------------------------------------------------------------------
// Muster und Zeit
// ---------------------------------------------------------------------------------------------

const MUSTER: Array<[string, (s: string) => boolean]> = [
  ['ISO-Datum', s => /^\d{4}-\d{2}-\d{2}$/.test(s)],
  ['Datum+Uhrzeit yyyy-mm-dd hh:mm:ss', s => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)],
  ['ISO-Zeitstempel mit T', s => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)],
  ['dd.mm.yyyy', s => /^\d{2}\.\d{2}\.\d{4}$/.test(s)],
  ['dd.mm.yyyy hh:mm', s => /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}(:\d{2})?$/.test(s)],
  ['Unix-Sekunden', s => /^\d{10}$/.test(s) && Number(s) >= 946684800 && Number(s) <= 4102444800],
  ['Unix-Millisekunden', s => /^\d{13}$/.test(s) && Number(s) >= 946684800000 && Number(s) <= 4102444800000],
  ['nur Ziffern', s => /^\d+$/.test(s)],
  ['Ganzzahl mit Vorzeichen', s => /^-\d+$/.test(s)],
  ['Dezimalzahl mit Punkt', s => /^-?\d+\.\d+$/.test(s)],
  ['Dezimalzahl mit Komma', s => /^-?\d+,\d+$/.test(s)],
]

/** Das Muster, das fuer alle (>= 95 %) Werte zutrifft; sonst 'gemischt' bzw. 'Text'. */
export function erkenneMuster(werte: readonly string[]): string {
  if (werte.length === 0) return '–'
  for (const [name, test] of MUSTER) {
    const treffer = werte.filter(test).length
    if (treffer / werte.length >= 0.95) return treffer === werte.length ? name : `${name} (${treffer}/${werte.length})`
  }
  return 'Text'
}

const BERLIN = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

/** Wanduhr in Berlin als "UTC-Millisekunden" (Komponenten stehen in den UTC-Feldern). */
export function berlinWand(ms: number): number {
  const p = Object.fromEntries(BERLIN.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
}

export function wandText(wandMs: number): string {
  return new Date(wandMs).toISOString().replace('T', ' ').slice(0, 19)
}

/** Berlin-Datum als dd.mm.yyyy fuer Unix-Sekunden. */
export function ddmmyyyyBerlin(sekunden: number): string {
  const d = new Date(berlinWand(sekunden * 1000))
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`
}

/** Beide Lesarten eines businessdate (Unix-Sekunden): UTC-Datum und Berlin-Datum. */
export function datumLesarten(sekunden: number): { roh: number; utc: string; berlin: string } {
  return {
    roh: sekunden,
    utc: new Date(sekunden * 1000).toISOString().slice(0, 10),
    berlin: wandText(berlinWand(sekunden * 1000)).slice(0, 10),
  }
}

/** Liest einen Zeitwert in Berlin-Wanduhrzeit (Millisekunden, UTC-Felder); null, wenn nicht erkennbar. */
export function zeitLesen(wert: unknown): { wandMs: number; art: string } | null {
  if (wert === null || wert === undefined || wert === '') return null
  const s = String(wert).trim()
  if (/^\d{10}$/.test(s)) return { wandMs: berlinWand(Number(s) * 1000), art: 'Unix-Sekunden' }
  if (/^\d{13}$/.test(s)) return { wandMs: berlinWand(Number(s)), art: 'Unix-Millisekunden' }
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s)
  if (m) {
    if (m[7]) return { wandMs: berlinWand(Date.parse(s)), art: 'ISO mit Zeitzone (nach Berlin umgerechnet)' }
    return { wandMs: Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)), art: 'ISO ohne Zeitzone (als Wanduhr gelesen)' }
  }
  m = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (m) return { wandMs: Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)), art: 'dd.mm.yyyy (als Wanduhr gelesen)' }
  return null
}

// ---------------------------------------------------------------------------------------------
// Feldprofile
// ---------------------------------------------------------------------------------------------

export type Zeile = Record<string, unknown>

export type Feldprofil = {
  feld: string
  gesperrt: boolean
  typen: Record<string, number>
  anteilLeer: number
  verschieden: number
  /** nur bei numerisch lesbaren Werten und nicht gesperrt */
  min?: number
  max?: number
  nachkomma?: boolean
  negativ?: boolean
  laengeMin?: number
  laengeMax?: number
  muster: string
  beispiele?: string[]
}

function jsTyp(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return 'fehlend'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

const istLeer = (v: unknown) => v === null || v === undefined || v === ''

export function zahlLesen(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim())) return Number(v.trim().replace(',', '.'))
  return null
}

function kurz(v: unknown): string {
  const t = typeof v === 'string' ? v : JSON.stringify(v)
  return t.length > 60 ? `${t.slice(0, 57)}...` : t
}

function skalarText(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

export function feldNamen(zeilen: readonly Zeile[]): string[] {
  const s = new Set<string>()
  for (const z of zeilen) if (z && typeof z === 'object') for (const k of Object.keys(z)) s.add(k)
  return [...s]
}

export function feldProfil(zeilen: readonly Zeile[], feld: string, merch = false): Feldprofil {
  const gesperrt = feldGesperrt(feld, merch)
  const typen: Record<string, number> = {}
  const haeufig = new Map<string, number>()
  const skalare: string[] = []
  const strLaengen: number[] = []
  const zahlen: number[] = []
  let leer = 0
  let nachkomma = false
  let negativ = false
  let alleZahlLesbar = true
  let nichtLeer = 0
  for (const z of zeilen) {
    const v = z?.[feld]
    typen[jsTyp(v)] = (typen[jsTyp(v)] ?? 0) + 1
    if (istLeer(v)) { leer++; continue }
    nichtLeer++
    const key = typeof v === 'string' ? v : JSON.stringify(v)
    haeufig.set(key, (haeufig.get(key) ?? 0) + 1)
    const t = skalarText(v)
    if (t !== null) skalare.push(t)
    if (typeof v === 'string') strLaengen.push(v.length)
    const n = zahlLesen(v)
    if (n === null) alleZahlLesbar = false
    else {
      zahlen.push(n)
      if (!Number.isInteger(n)) nachkomma = true
      if (n < 0) negativ = true
    }
  }
  const p: Feldprofil = {
    feld,
    gesperrt,
    typen,
    anteilLeer: zeilen.length ? leer / zeilen.length : 0,
    verschieden: haeufig.size,
    muster: erkenneMuster(skalare),
  }
  if (strLaengen.length) {
    p.laengeMin = strLaengen.reduce((a, b) => Math.min(a, b), Infinity)
    p.laengeMax = strLaengen.reduce((a, b) => Math.max(a, b), 0)
  }
  if (!gesperrt) {
    if (nichtLeer > 0 && alleZahlLesbar && zahlen.length) {
      p.min = zahlen.reduce((a, b) => Math.min(a, b), Infinity)
      p.max = zahlen.reduce((a, b) => Math.max(a, b), -Infinity)
      p.nachkomma = nachkomma
      p.negativ = negativ
    }
    p.beispiele = [...haeufig].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => kurz(k))
  }
  return p
}

export function profilAlle(zeilen: readonly Zeile[], merch = false): Feldprofil[] {
  return feldNamen(zeilen).map(f => feldProfil(zeilen, f, merch))
}

/** personalkostenprotag: nur Typen, Muster, Fuellgrad und Summen — keine Zeilenwerte. */
export type ProtagFeld = { feld: string; typen: Record<string, number>; muster: string; leer: number; summe: number | null }
export function protagSummen(zeilen: readonly Zeile[]): { zeilen: number; felder: ProtagFeld[] } {
  const felder = feldNamen(zeilen).map(feld => {
    const typen: Record<string, number> = {}
    const skalare: string[] = []
    let leer = 0
    let summe = 0
    let alleZahl = true
    for (const z of zeilen) {
      const v = z?.[feld]
      typen[jsTyp(v)] = (typen[jsTyp(v)] ?? 0) + 1
      if (istLeer(v)) { leer++; continue }
      const t = skalarText(v)
      if (t !== null) skalare.push(t)
      const n = zahlLesen(v)
      if (n === null) alleZahl = false
      else summe += n
    }
    return { feld, typen, muster: erkenneMuster(skalare), leer, summe: alleZahl ? Math.round(summe * 100) / 100 : null }
  })
  return { zeilen: zeilen.length, felder }
}

// ---------------------------------------------------------------------------------------------
// Journal und Bons
// ---------------------------------------------------------------------------------------------

function verteilung(zeilen: readonly Zeile[], feld: string, max = 15): Array<[string, number]> {
  const m = new Map<string, number>()
  for (const z of zeilen) {
    const v = z?.[feld]
    const k = v === null || v === undefined ? '(fehlt)' : String(v)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, max)
}

const ungleichNull = (v: unknown) => {
  if (istLeer(v)) return false
  const n = zahlLesen(v)
  return n === null ? true : n !== 0
}

const cent = (x: number) => Math.round(x * 100) / 100

function zeitSpanne(zeilen: readonly Zeile[], feld: string) {
  let min: { wandMs: number; roh: unknown } | null = null
  let max: { wandMs: number; roh: unknown } | null = null
  let nichtLesbar = 0
  const arten = new Set<string>()
  for (const z of zeilen) {
    const t = zeitLesen(z?.[feld])
    if (!t) { nichtLesbar++; continue }
    arten.add(t.art)
    if (!min || t.wandMs < min.wandMs) min = { wandMs: t.wandMs, roh: z[feld] }
    if (!max || t.wandMs > max.wandMs) max = { wandMs: t.wandMs, roh: z[feld] }
  }
  return {
    frueheste: min ? { roh: String(min.roh), berlin: wandText(min.wandMs) } : null,
    spaeteste: max ? { roh: String(max.roh), berlin: wandText(max.wandMs) } : null,
    nichtLesbar,
    arten: [...arten],
  }
}

/** tagDdMmYyyy: der abgefragte Geschaeftstag; er laeuft von 08:00 bis 07:59 des Folgetags. */
export function journalAuswerten(zeilen: readonly Zeile[], tagDdMmYyyy: string) {
  let summe = 0
  const jeWeg = new Map<string, { zeilen: number; summe: number }>()
  for (const z of zeilen) {
    const b = zahlLesen(z.balance) ?? 0
    summe += b
    const k = String(z.finanzweg ?? '(fehlt)')
    const e = jeWeg.get(k) ?? { zeilen: 0, summe: 0 }
    e.zeilen++
    e.summe += b
    jeWeg.set(k, e)
  }
  const ids = new Set(zeilen.map(z => String(z.ID)))
  const artnrs = zeilen.map(z => z.artnr).filter(v => !istLeer(v) && String(v) !== '0')
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(tagDdMmYyyy)
  let ausserhalb: number | null = null
  let datumNichtLesbar = 0
  if (m) {
    const von = Date.UTC(+m[3], +m[2] - 1, +m[1], 8)
    const bis = von + 24 * 3600 * 1000
    ausserhalb = 0
    for (const z of zeilen) {
      const t = zeitLesen(z.datum)
      if (!t) { datumNichtLesbar++; continue }
      if (t.wandMs < von || t.wandMs >= bis) ausserhalb++
    }
  }
  return {
    zeilen: zeilen.length,
    summeBalance: cent(summe),
    jeFinanzweg: Object.fromEntries([...jeWeg].sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([k, v]) => [k, { zeilen: v.zeilen, summeBalance: cent(v.summe) }])),
    verteilung: Object.fromEntries(['situation', 'am_id', 'site', 'terminal', 'ust', 'vat_id'].map(f => [f, verteilung(zeilen, f)])),
    rabattIdUngleichNull: zeilen.filter(z => ungleichNull(z.rabatt_id)).length,
    cancellationreasonUngleichNull: zeilen.filter(z => ungleichNull(z.cancellationreason)).length,
    parentidUngleichNull: zeilen.filter(z => ungleichNull(z.parentid)).length,
    preisNullBalanceUngleichNull: zeilen.filter(z => (zahlLesen(z.preis) ?? NaN) === 0 && (zahlLesen(z.balance) ?? 0) !== 0).length,
    idEindeutig: ids.size === zeilen.length,
    idVerschieden: ids.size,
    datum: zeitSpanne(zeilen, 'datum'),
    refdate: zeitSpanne(zeilen, 'refdate'),
    datumAusserhalbGeschaeftstag: ausserhalb,
    datumNichtLesbar,
    artnrGefuellt: artnrs.length,
    artnrVerschieden: new Set(artnrs.map(String)).size,
  }
}

export function tischeAuswerten(tische: readonly Zeile[], journal: readonly Zeile[]) {
  const summe = (f: string) => cent(tische.reduce((a, z) => a + (zahlLesen(z[f]) ?? 0), 0))
  const idsT = tische.map(z => String(z.tableheader_id))
  const setT = new Set(idsT)
  const setJ = new Set(journal.map(z => String(z.tableheader_id)))
  let tImJ = 0
  for (const i of setT) if (setJ.has(i)) tImJ++
  let jInT = 0
  for (const i of setJ) if (setT.has(i)) jInT++
  return {
    zeilen: tische.length,
    tableheaderIdEindeutig: setT.size === tische.length,
    tableheaderIdVerschieden: setT.size,
    bonsAusJournalInTables: { vonJournal: setJ.size, gefunden: jInT },
    bonsAusTablesImJournal: { vonTables: setT.size, gefunden: tImJ },
    summeAdults: summe('number_adults'),
    summeKids: summe('number_kids'),
    summeInfants: summe('number_infants'),
    verteilung: Object.fromEntries(['accounting_type', 'table_type', 'is_archive'].map(f => [f, verteilung(tische, f)])),
    debitorId: { gefuellt: tische.filter(z => !istLeer(z.debitor_id)).length, ungleichNull: tische.filter(z => ungleichNull(z.debitor_id)).length },
    reservationId: { gefuellt: tische.filter(z => !istLeer(z.reservation_id)).length, ungleichNull: tische.filter(z => ungleichNull(z.reservation_id)).length },
  }
}

// ---------------------------------------------------------------------------------------------
// Aufrufe
// ---------------------------------------------------------------------------------------------

type Antwort = { status: number; daten: unknown; roh: string; bytes: number; ms: number }
class BetriebAbbruch extends Error {}

function argumente(name: string): string[] {
  const r: string[] = []
  for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === name && process.argv[i + 1]) r.push(process.argv[i + 1]!)
  return r
}

function schluesselLesen(): Record<string, string> {
  try {
    const j = JSON.parse(process.env.LINA_API_SCHLUESSEL ?? '{}')
    return j && typeof j === 'object' ? j as Record<string, string> : {}
  } catch {
    return {}
  }
}

let letzterAufruf = 0
async function pause() {
  const warten = letzterAufruf + PAUSE_MS - Date.now()
  if (warten > 0) await new Promise(r => setTimeout(r, warten))
  letzterAufruf = Date.now()
}

class Betrieb {
  aufrufe = 0
  beendet: string | null = null
  constructor(readonly encId: string, readonly schluessel: string, readonly alleSchluessel: readonly string[]) {}

  sauber(t: string) { return bereinigen(t, this.alleSchluessel) }

  async get(pfad: string, parameter: Record<string, string> = {}): Promise<Antwort> {
    pfadPruefen(pfad)
    if (this.beendet) throw new BetriebAbbruch(this.beendet)
    if (this.aufrufe >= MAX_JE_BETRIEB) {
      this.beendet = `Aufrufgrenze ${MAX_JE_BETRIEB} je Betrieb erreicht`
      throw new BetriebAbbruch(this.beendet)
    }
    await pause()
    this.aufrufe++
    const url = new URL(`${BASIS}/extern/${pfad}`)
    for (const [k, v] of Object.entries(parameter)) url.searchParams.set(k, v)
    const t0 = Date.now()
    let a: Antwort
    try {
      const res = await fetch(url, {
        headers: { apikey: this.schluessel, accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(60_000),
      })
      const roh = await res.text()
      let daten: unknown = null
      try { daten = JSON.parse(roh) } catch { /* kein JSON */ }
      a = { status: res.status, daten, roh, bytes: Buffer.byteLength(roh), ms: Date.now() - t0 }
    } catch (e) {
      a = { status: 0, daten: null, roh: this.sauber(String(e)), bytes: 0, ms: Date.now() - t0 }
    }
    const nichtGebucht = /not licensed/i.test(a.roh)
    if (a.status === 429) this.beendet = 'HTTP 429 (Limit) — Betrieb beendet'
    else if ((a.status === 401 || a.status === 403) && !nichtGebucht) this.beendet = `HTTP ${a.status} (abgewiesen) — Betrieb beendet, nicht wiederholt`
    return a
  }
}

const liste = (d: unknown): Zeile[] | null => Array.isArray(d) ? d as Zeile[] : null

type Kopf = { pfad: string; parameter?: Record<string, string>; status: number; zeilen: number | null; bytes: number; ms: number; hinweis?: string }
function kopf(pfad: string, a: Antwort, a2: Record<string, string> | undefined, betrieb: Betrieb): Kopf {
  const l = liste(a.daten)
  const k: Kopf = { pfad, parameter: a2, status: a.status, zeilen: l ? l.length : null, bytes: a.bytes, ms: a.ms }
  if (a.status !== 200) k.hinweis = betrieb.sauber(a.roh.slice(0, 200)).replace(/\s+/g, ' ')
  return k
}

function kopfZeile(k: Kopf): string {
  return `${k.pfad}${k.parameter ? ` ${Object.entries(k.parameter).map(([a, b]) => `${a}=${b}`).join('&')}` : ''}: HTTP ${k.status}`
    + `${k.zeilen !== null ? `, ${k.zeilen} Zeilen` : ''}, ${k.bytes} Bytes, ${k.ms} ms${k.hinweis ? ` — ${k.hinweis}` : ''}`
}

function profilZeile(p: Feldprofil): string {
  const typ = Object.entries(p.typen).map(([t, n]) => `${t}:${n}`).join('/')
  const teile = [
    p.feld.padEnd(26), typ.padEnd(18), `leer ${(p.anteilLeer * 100).toFixed(0)}%`.padEnd(9),
    `versch ${p.verschieden}`.padEnd(12),
  ]
  if (p.min !== undefined) teile.push(`${p.min}..${p.max}${p.nachkomma ? ' Nachk.' : ''}${p.negativ ? ' neg.' : ''}`.padEnd(22))
  else teile.push(''.padEnd(22))
  if (p.laengeMin !== undefined) teile.push(`Len ${p.laengeMin}-${p.laengeMax}`.padEnd(11))
  else teile.push(''.padEnd(11))
  teile.push(p.muster)
  if (p.gesperrt) teile.push('[gesperrt]')
  else if (p.beispiele?.length) teile.push(`z.B. ${p.beispiele.join(' | ')}`)
  return `   ${teile.join('  ')}`
}

function druckeProfile(profile: Feldprofil[]) {
  for (const p of profile) console.log(profilZeile(p))
}

// ---------------------------------------------------------------------------------------------
// Messung je Betrieb
// ---------------------------------------------------------------------------------------------

function tagVorTagen(tage: number): string {
  return ddmmyyyyBerlin(Math.floor(Date.now() / 1000) - tage * 86400)
}

async function listdaysLesen(b: Betrieb) {
  const a = await b.get('revenue/listdays')
  const k = kopf('revenue/listdays', a, undefined, b)
  const l = liste(a.daten)
  if (!l) return { kopf: k, tage: [] as number[], lesarten: null as null | Array<ReturnType<typeof datumLesarten>> }
  const tage = l.map(x => zahlLesen(x.businessdate)).filter((x): x is number => x !== null).sort((x, y) => x - y)
  const [a3, e3] = [tage.slice(0, 3), tage.slice(-3)]
  return { kopf: k, tage, lesarten: [...a3, ...e3].map(datumLesarten), felder: profilAlle(l) }
}

async function betriebMessen(b: Betrieb, tag: string, vorab?: Awaited<ReturnType<typeof listdaysLesen>>) {
  const aus: Record<string, unknown> = { encId: b.encId }
  const koepfe: Kopf[] = []
  console.log(`\n${'='.repeat(100)}\nBetrieb ${b.encId}, Tag ${tag}\n${'='.repeat(100)}`)
  try {
    const store = await b.get('revenue/store')
    koepfe.push(kopf('revenue/store', store, undefined, b))
    console.log(kopfZeile(koepfe.at(-1)!))
    const lim1 = await b.get('revenue/getlimit')
    aus.getlimitVorher = lim1.daten
    console.log(`revenue/getlimit vorher: HTTP ${lim1.status} ${b.sauber(JSON.stringify(lim1.daten))}`)

    const ld = vorab ?? await listdaysLesen(b)
    koepfe.push(ld.kopf)
    console.log(kopfZeile(ld.kopf))
    const tage = ld.tage
    aus.listdays = { tage: tage.length, aeltester: tage[0] ? datumLesarten(tage[0]) : null, juengster: tage.at(-1) ? datumLesarten(tage.at(-1)!) : null, lesarten: ld.lesarten }
    if (ld.lesarten) {
      console.log('   businessdate — Rohwert | UTC-Datum | Berlin-Datum (erste und letzte drei):')
      for (const x of ld.lesarten) console.log(`   ${x.roh} | ${x.utc} | ${x.berlin}${x.utc !== x.berlin ? '   <- verschieden' : ''}`)
      console.log('   Umrechnung fuer Abfragen: Unix-Sekunden -> Datum in Europe/Berlin (dd.mm.yyyy).')
    }

    // Personal
    const stunde = await b.get('personal/personalkostenprostunde', { businessdate: tag })
    koepfe.push(kopf('personal/personalkostenprostunde', stunde, { businessdate: tag }, b))
    console.log(kopfZeile(koepfe.at(-1)!))
    const sd = stunde.daten as { eff?: Record<string, unknown>; kost?: Record<string, unknown> } | null
    if (sd && typeof sd === 'object' && !Array.isArray(sd)) {
      aus.prostunde = {
        schluessel: Object.keys(sd),
        kostUserVorhanden: 'kostUser' in sd,
        stundenEff: sd.eff ? Object.keys(sd.eff).length : 0,
        stundenKost: sd.kost ? Object.keys(sd.kost).length : 0,
        effTypen: sd.eff ? [...new Set(Object.values(sd.eff).map(jsTyp))] : [],
        kostTypen: sd.kost ? [...new Set(Object.values(sd.kost).map(jsTyp))] : [],
      }
      console.log(`   Schluessel: ${Object.keys(sd).join(', ')} (kostUser vorhanden: ${'kostUser' in sd}, nicht ausgewertet); Stunden eff ${(aus.prostunde as { stundenEff: number }).stundenEff}, kost ${(aus.prostunde as { stundenKost: number }).stundenKost}`)
    }

    const protag = await b.get('personal/personalkostenprotag', { businessdate: tag })
    koepfe.push(kopf('personal/personalkostenprotag', protag, { businessdate: tag }, b))
    console.log(kopfZeile(koepfe.at(-1)!))
    const pl = liste(protag.daten)
    if (pl) {
      const s = protagSummen(pl)
      aus.protag = s
      console.log(`   nur Summen (${s.zeilen} Zeilen):`)
      for (const f of s.felder) console.log(`   ${f.feld.padEnd(14)} ${Object.keys(f.typen).join('/')}  ${f.muster}  leer ${f.leer}  Summe ${f.summe}`)
    }

    // Umsatz
    const jr = await b.get('revenue/journal', { businessdate: tag })
    koepfe.push(kopf('revenue/journal', jr, { businessdate: tag }, b))
    console.log(kopfZeile(koepfe.at(-1)!))
    const jl = liste(jr.daten) ?? []
    if (jl.length) {
      aus.journalFelder = profilAlle(jl)
      druckeProfile(aus.journalFelder as Feldprofil[])
      const ja = journalAuswerten(jl, tag)
      aus.journal = ja
      console.log(`   Summe balance ${ja.summeBalance}; ID eindeutig: ${ja.idEindeutig} (${ja.idVerschieden}/${ja.zeilen}); artnr gefuellt ${ja.artnrGefuellt}, verschieden ${ja.artnrVerschieden}`)
      console.log(`   je finanzweg: ${Object.entries(ja.jeFinanzweg).map(([k, v]) => `${k}: ${v.zeilen}z ${v.summeBalance}`).join(' | ')}`)
      for (const [f, v] of Object.entries(ja.verteilung)) console.log(`   ${f}: ${v.map(([k, n]) => `${k}=${n}`).join(' ')}`)
      console.log(`   rabatt_id<>0: ${ja.rabattIdUngleichNull}, cancellationreason<>0: ${ja.cancellationreasonUngleichNull}, parentid<>0: ${ja.parentidUngleichNull}, preis=0 und balance<>0: ${ja.preisNullBalanceUngleichNull}`)
      console.log(`   datum: ${JSON.stringify(ja.datum.frueheste)} bis ${JSON.stringify(ja.datum.spaeteste)} (${ja.datum.arten.join(', ')}); ausserhalb 08:00-07:59: ${ja.datumAusserhalbGeschaeftstag}`)
      console.log(`   refdate: ${JSON.stringify(ja.refdate.frueheste)} bis ${JSON.stringify(ja.refdate.spaeteste)}`)
    }

    const jt = await b.get('revenue/journaltables', { businessdate: tag })
    koepfe.push(kopf('revenue/journaltables', jt, { businessdate: tag }, b))
    console.log(kopfZeile(koepfe.at(-1)!))
    const tl = liste(jt.daten) ?? []
    if (tl.length) {
      aus.tablesFelder = profilAlle(tl)
      druckeProfile(aus.tablesFelder as Feldprofil[])
      const ta = tischeAuswerten(tl, jl)
      aus.tables = ta
      console.log(`   tableheader_id eindeutig: ${ta.tableheaderIdEindeutig}; Journal-Bons in tables ${ta.bonsAusJournalInTables.gefunden}/${ta.bonsAusJournalInTables.vonJournal}, tables-Bons im Journal ${ta.bonsAusTablesImJournal.gefunden}/${ta.bonsAusTablesImJournal.vonTables}`)
      console.log(`   Summen: adults ${ta.summeAdults}, kids ${ta.summeKids}, infants ${ta.summeInfants}; debitor_id gefuellt ${ta.debitorId.gefuellt} (<>0: ${ta.debitorId.ungleichNull}), reservation_id gefuellt ${ta.reservationId.gefuellt} (<>0: ${ta.reservationId.ungleichNull})`)
      for (const [f, v] of Object.entries(ta.verteilung)) console.log(`   ${f}: ${v.map(([k, n]) => `${k}=${n}`).join(' ')}`)
    }

    // Forecast: die Doku nennt eine Schreibweise (dd.mm.yyyy); die zweite ist eine Vermutung
    const von = tagVorTagen(7)
    const bis = tagVorTagen(1)
    const varianten: Array<{ name: string; p: Record<string, string> }> = [
      { name: 'dd.mm.yyyy (Postman-Doku)', p: { from: von, to: bis } },
      { name: 'yyyy-mm-dd (NICHT in der Doku, Vermutung)', p: { from: von.split('.').reverse().join('-'), to: bis.split('.').reverse().join('-') } },
    ]
    const fc: Array<Record<string, unknown>> = []
    for (const v of varianten) {
      const a = await b.get('revenue/getforecastperday', v.p)
      const k = kopf('revenue/getforecastperday', a, v.p, b)
      koepfe.push(k)
      console.log(`${kopfZeile(k)}  [${v.name}]`)
      const l = liste(a.daten)
      const eintrag: Record<string, unknown> = { variante: v.name, kopf: k }
      if (a.status === 200 && l && l.length) {
        eintrag.felder = profilAlle(l)
        druckeProfile(eintrag.felder as Feldprofil[])
        fc.push(eintrag)
        break
      }
      if (a.status === 200 && a.daten && !l) eintrag.schluessel = Object.keys(a.daten as object)
      fc.push(eintrag)
    }
    aus.forecast = fc

    // Artikelstamm und Stammlisten
    const merch: Array<Record<string, unknown>> = []
    for (const m of MERCH) {
      const a = await b.get(`merchandiseman/${m}`)
      const k = kopf(`merchandiseman/${m}`, a, undefined, b)
      koepfe.push(k)
      console.log(kopfZeile(k))
      const l = liste(a.daten)
      const e: Record<string, unknown> = { liste: m, kopf: k }
      if (l && l.length && typeof l[0] === 'object') {
        e.felder = profilAlle(l, true)
        druckeProfile(e.felder as Feldprofil[])
      }
      merch.push(e)
    }
    aus.merchandiseman = merch

    // Alterstest
    const alter: Array<Record<string, unknown>> = []
    const kandidaten: Array<{ name: string; tag: string }> = []
    if (tage[0]) kandidaten.push({ name: 'aeltester Tag aus listdays (Berlin-Lesart)', tag: ddmmyyyyBerlin(tage[0]) })
    kandidaten.push({ name: 'vor 400 Tagen', tag: tagVorTagen(400) })
    console.log('\n   Alterstest:')
    for (const c of kandidaten) {
      const e: Record<string, unknown> = { name: c.name, tag: c.tag }
      const s = await b.get('personal/personalkostenprostunde', { businessdate: c.tag })
      const sx = s.daten as { eff?: Record<string, unknown> } | null
      e.prostunde = { status: s.status, stunden: sx?.eff ? Object.keys(sx.eff).length : null }
      const p = await b.get('personal/personalkostenprotag', { businessdate: c.tag })
      e.protag = { status: p.status, zeilen: liste(p.daten)?.length ?? null }
      const j = await b.get('revenue/journal', { businessdate: c.tag })
      e.journal = { status: j.status, zeilen: liste(j.daten)?.length ?? null }
      alter.push(e)
      console.log(`   ${c.name} ${c.tag}: prostunde HTTP ${s.status} (${(e.prostunde as { stunden: number | null }).stunden ?? '–'} Stunden), protag HTTP ${p.status} (${(e.protag as { zeilen: number | null }).zeilen ?? '–'} Zeilen), journal HTTP ${j.status} (${(e.journal as { zeilen: number | null }).zeilen ?? '–'} Zeilen)`)
    }
    aus.alterstest = alter

    const lim2 = await b.get('revenue/getlimit')
    aus.getlimitNachher = lim2.daten
    console.log(`\nrevenue/getlimit nachher: HTTP ${lim2.status} ${b.sauber(JSON.stringify(lim2.daten))}`)
  } catch (e) {
    if (!(e instanceof BetriebAbbruch)) throw new Error(b.sauber(String(e)))
    aus.abbruch = e.message
    console.log(`\n!! Betrieb beendet: ${e.message}`)
  }
  aus.kopfzeilen = koepfe
  aus.aufrufe = b.aufrufe
  console.log(`\nAufrufe fuer ${b.encId}: ${b.aufrufe}`)
  return aus
}

async function main(): Promise<number> {
  const alle = schluesselLesen()
  const schluessel = Object.values(alle)
  if (schluessel.length === 0) {
    console.log('LINA_API_SCHLUESSEL fehlt oder ist kein gueltiges JSON. Er gehoert in die Umgebung des Containers, nicht in den Aufruf.')
    return 3
  }
  const tag = argumente('--tag')[0] ?? tagVorTagen(3)
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(tag)) { console.log('--tag erwartet dd.mm.yyyy'); return 3 }
  const aus = argumente('--aus')[0] ?? 'tpapi-formprobe.json'
  const alleFlag = process.argv.includes('--alle')
  let laden = argumente('--laden')
  for (const l of laden) if (!alle[l]) { console.log(`Kein Schluessel fuer ${l} in LINA_API_SCHLUESSEL.`); return 3 }

  console.log(`TPAPI-Formprobe — Basis ${BASIS}, Tag ${tag}, ${schluessel.length} Schluessel, Ausgabe ${aus}`)
  const ergebnis: Record<string, unknown> = { erzeugt: new Date().toISOString(), basis: BASIS, tag, schluesselAnzahl: schluessel.length }
  const betriebe = new Map<string, Betrieb>()
  const betrieb = (id: string) => {
    let b = betriebe.get(id)
    if (!b) { b = new Betrieb(id, alle[id]!, schluessel); betriebe.set(id, b) }
    return b
  }

  // Auswahl: die ersten zwei Schluessel, fuer die revenue/store 200 liefert
  if (laden.length === 0) {
    console.log('\nAuswahl der Betriebe (revenue/store je Schluessel, bis zwei antworten):')
    for (const id of Object.keys(alle)) {
      if (laden.length >= 2) break
      try {
        const a = await betrieb(id).get('revenue/store')
        console.log(`   ${id}: HTTP ${a.status}`)
        if (a.status === 200) laden.push(id)
      } catch (e) {
        console.log(`   ${id}: ${e instanceof BetriebAbbruch ? e.message : betrieb(id).sauber(String(e))}`)
      }
    }
    if (laden.length === 0) { console.log('Kein Schluessel mit Zugriff auf revenue/store.'); return 2 }
  }

  const messungen: unknown[] = []
  for (const id of laden) messungen.push(await betriebMessen(betrieb(id), tag))
  ergebnis.betriebe = messungen

  if (alleFlag) {
    console.log(`\n${'='.repeat(100)}\n--alle: revenue/listdays je Schluessel\n${'='.repeat(100)}`)
    const zeilen: Array<Record<string, unknown>> = []
    let summe = 0
    for (const id of Object.keys(alle)) {
      const b = betrieb(id)
      try {
        const ld = await listdaysLesen(b)
        const z = {
          encId: id, status: ld.kopf.status, tage: ld.tage.length,
          aeltester: ld.tage[0] ? datumLesarten(ld.tage[0]).berlin : null,
          juengster: ld.tage.at(-1) ? datumLesarten(ld.tage.at(-1)!).berlin : null,
          hinweis: ld.kopf.hinweis,
        }
        summe += ld.tage.length
        zeilen.push(z)
        console.log(`${id}: HTTP ${z.status}, ${z.tage} Tage, ${z.aeltester ?? '–'} bis ${z.juengster ?? '–'}${z.hinweis ? ` — ${z.hinweis}` : ''}`)
      } catch (e) {
        const t = e instanceof BetriebAbbruch ? e.message : b.sauber(String(e))
        zeilen.push({ encId: id, abbruch: t })
        console.log(`${id}: ${t}`)
      }
    }
    ergebnis.alle = { betriebe: zeilen, summeTage: summe }
    console.log(`\nSumme der Tage ueber alle Betriebe: ${summe} (Rueckstandsrechnung)`)
  }

  const letzter = betriebe.get(laden[0]!)!
  ergebnis.aufrufeJeBetrieb = Object.fromEntries([...betriebe].map(([id, b]) => [id, b.aufrufe]))
  console.log('\nAufrufe je Betrieb:')
  for (const [id, b] of betriebe) console.log(`   ${id}: ${b.aufrufe}${b.beendet ? ` (${b.beendet})` : ''}`)
  if (!letzter.beendet) {
    try {
      const l = await letzter.get('revenue/getlimit')
      ergebnis.getlimitAmEnde = l.daten
      console.log(`revenue/getlimit am Ende (${laden[0]}): HTTP ${l.status} ${letzter.sauber(JSON.stringify(l.daten))}`)
    } catch { /* Grenze erreicht — nicht noetig */ }
  }

  const text = bereinigen(JSON.stringify(ergebnis, null, 2), schluessel)
  writeFileSync(aus, text)
  console.log(`\nJSON geschrieben: ${aus}`)
  return 0
}

if (import.meta.main) process.exit(await main())
