/**
 * Rezepturen einer FoodNotify-Marke ziehen — als JSON-Ablage zum Durchsehen,
 * samt Rezeptbildern.
 *
 * KEIN Teil des nächtlichen Laufs und kein Import nach `core.rezept`. Ein
 * beaufsichtigter Einzelabzug in einen Ordner, dieselbe Bauform wie
 * `src/belege.ts`: jemand startet ihn im eigenen Terminal und sieht zu.
 *
 * REZEPTE GEHÖREN DER MARKE, NICHT DEM BETRIEB. FoodNotify pflegt sie je
 * Mandant (Inventar, Kopf: Aposto 672, Enchilada 1.846). „Die Rezepte von
 * Enchilada Köln" sind deshalb alle Enchilada-Rezepte — und das Einzige, was
 * den Betrieb davon unterscheidet, ist die Kassenzuordnung: welche Kassen-
 * artikel des Restaurants auf welches Rezept zeigen
 * (`/api/pos/mapping/{connectionId}/articles`, plan-foodnotify.md §3.3). Die
 * steht als `an_kasse` in jeder Rezeptdatei und gesammelt in `kasse.json`.
 *
 * Ablage unter <ziel>:
 *
 *   rezeptliste.json           alle Einträge der Rezeptliste, Seite für Seite zusammengesetzt
 *   kasse.json                 Kostenstellen des Restaurants, Kassenanbindungen, Artikel→Rezept
 *   nachgeholt.json            je verwiesener ID ohne Listeneintrag: geladen, nicht_gefunden, fehler
 *   rezepte/<id>__<name>.json  je Rezept: liste, kopf, zutaten, meta, schritte, an_kasse, bilder
 *   img/<id>.<endung>          das Rezeptbild (nie ein Schrittfoto); ein zweites als <id>_2
 *   img/<id>_schritt<N>_<M>.<endung>  M-tes Foto des N-ten Schritts
 *
 * Gespeichert wird der fachliche Inhalt ohne FoodNotifys Antworthülle
 * (`auspacken`) — die trägt nur Seitenzähler und Fehlerflags, und beide sind
 * hier ausgewertet. Mehrseitige Antworten stehen als eine Liste.
 *
 * NACHHOLEN, WAS DIE LISTE VERSCHLUCKT. `/api/recipes?page=N` ist über die
 * Seiten nicht stabil sortiert: 760 von 2.076 Einträgen teilen `createdAt`
 * mit dem Vorgänger, an Seitengrenzen standen am 14.09.2026 21 Einträge
 * doppelt, und 52 IDs, auf die Unterrezepte oder Kassenartikel zeigten, kamen
 * in der Liste nicht vor. Deshalb holt der Lauf jedes solche Rezept einzeln
 * über `/api/recipes/{id}` — vor der Liste und danach noch einmal, und so oft,
 * bis ein nachgeholtes Rezept auf nichts Neues mehr zeigt. Solche Dateien
 * tragen `liste: null` und `nachgeholt` (wer auf sie zeigt). HTTP 404 steht
 * als `nicht_gefunden` in `nachgeholt.json`, vermutlich gelöscht, und wird
 * nicht erneut gefragt; wer das will, löscht die Datei.
 *
 * WO DIE BILDER STEHEN, gemessen am 14.09.2026: `imagePath` in Liste und Kopf,
 * `images[].url` in den Schritten, beide relativ zu FoodNotify. `bildquellen`
 * sucht allgemeiner nach Schlüsseln wie image/photo/picture/media, und
 * gespeichert wird nur, was als `image/*` zurückkommt. Die Vorschau zeigt die
 * Fundstellen des ersten Rezepts.
 *
 * NUR LESEN, NUR DIESE PFADE. `pfadFreigegeben` lässt ausschließlich die GETs
 * durch, die dieser Abzug braucht. `/api/recipes/batch` bliebe draußen, auch
 * wenn es schneller wäre: die Methode ist ungeprüft, vermutlich POST. Bilder
 * kommen von Adressen aus den Rezeptdaten; dort gilt `bildFreigegeben`.
 *
 * FORTSETZBAR. Eine Rezeptdatei entsteht über Umbenennen — halbe Dateien gibt
 * es nicht. Sie wird geschrieben, sobald die vier Teile da sind, und ein
 * zweites Mal mit `bilder`, wenn die Bilder durch sind. Fertig ist ein Rezept
 * erst mit `bilder` und allen Bilddateien; alles andere holt der nächste
 * Start nach. Die Rezeptliste wird beim zweiten Start aus der Datei gelesen,
 * damit Dateinamen und Reihenfolge stabil bleiben.
 *
 * ANMELDUNG: genau einmal, bei abgelaufener Sitzung genau einmal neu. Läuft
 * die Sitzung direkt danach wieder ab, kämpfen zwei Clients um denselben
 * Zugang — vermutlich der Container — und der Lauf hört auf, statt im
 * Wechsel neu anzumelden (AGENTS.md Regel 7).
 *
 *   bun run src/rezepte.ts enchilada 10399 belege/coyacan/rezepte             # Vorschau: zählt und misst
 *   bun run src/rezepte.ts enchilada 10399 belege/coyacan/rezepte --ziehen    # Abzug
 */
import { mkdir, readdir, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import { config, fnZugaenge } from './config'
import { log } from './lib/log'
import { FnAnmeldungFehlgeschlagen, FnSession, fnSessionAbgelaufen } from './foodnotify/auth'
import { auspacken } from './foodnotify/huelle'

/** Pause vor jeder Anfrage — beaufsichtigt, auf Wunsch eine Sekunde. */
export const PAUSE_MS = 1_000

/** Ab so vielen Fehlschlägen hintereinander stimmt etwas Grundsätzliches nicht. */
const SERIE_BIS_ABBRUCH = 10

const schlaf = (ms: number) => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

/**
 * Eine Rezept-ID ist eine Zahl oder eine UUID. Ein beliebiges Wort ließe
 * `/api/recipes/batch` als „Rezept batch" durch.
 */
const ID = '(\\d+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'
const istId = (id: string) => new RegExp(`^${ID}$`).test(id)

const FREIGEGEBEN = [
  /^\/api\/recipes\?page=\d+$/,
  new RegExp(`^/api/recipes/${ID}(/(ingredients|meta|steps))?(\\?page=\\d+)?$`),
  /^\/api\/pos\/locations$/,
  /^\/api\/pos\/mapping\/\d+\/articles(\?page=\d+)?$/,
]

export function pfadFreigegeben(pfad: string): void {
  if (!FREIGEGEBEN.some(r => r.test(pfad))) throw new Error(`Pfad nicht freigegeben: ${pfad}`)
}

/**
 * Bildadressen stammen aus den Rezeptdaten, nicht aus diesem Code — eine
 * Liste erlaubter Pfade gibt es dafür nicht. Was bleibt: nur http(s), und auf
 * FoodNotify selbst nichts, was nach Löschen oder Konto aussieht. Bei LINA
 * geschieht Löschen per GET; dass FoodNotify das nicht tut, ist nicht geprüft.
 */
const BILD_VERBOTEN = /\/(delete|remove|destroy|logout|signout|auth|user|users|subusers)(\/|$)/i

export function bildFreigegeben(url: URL, eigen: boolean): void {
  if (!/^https?:$/.test(url.protocol)) throw new Error(`Bildquelle ohne http(s): ${url.href.slice(0, 80)}`)
  if (eigen && BILD_VERBOTEN.test(url.pathname)) throw new Error(`Bildpfad nicht freigegeben: ${url.pathname}`)
}

/** Sperre, Anmeldekampf — eine Aussage über den Zugang, nicht über ein Rezept. */
export class Abbruch extends Error {
  constructor(meldung: string) { super(meldung); this.name = 'Abbruch' }
}

/** Ein HTTP-Fehler mit Status — `nachholen` muss 404 von anderen unterscheiden. */
export class HttpFehler extends Error {
  constructor(readonly status: number, pfad: string) {
    super(`HTTP ${status} bei ${pfad}`)
    this.name = 'HttpFehler'
  }
}

/**
 * `sperrt403 = false` für Einzelabrufe, bei denen ein 403 dem einen Objekt
 * gelten kann — ein Bild, ein verwiesenes Rezept, das womöglich einer anderen
 * Marke gehört. Beendete es den Lauf, bräche jeder neue Start an derselben
 * Stelle wieder ab. Eine echte Sperre des Zugangs fängt die Fehlerserie.
 */
export type Leser = { json(pfad: string, sperrt403?: boolean): Promise<unknown> }

export class FnLeser implements Leser {
  private letzter = 0
  private readonly heimat: string
  anfragen = 0
  dauerMs = 0

  constructor(
    private readonly session: FnSession,
    private readonly pause = PAUSE_MS,
    private readonly basis = config.FN_BASE_URL,
  ) {
    this.heimat = new URL(basis).origin
  }

  async json(pfad: string, sperrt403 = true): Promise<unknown> {
    pfadFreigegeben(pfad)
    const { res, bytes } = await this.holen(new URL(pfad, this.basis), 'application/json', false, sperrt403)
    if (!res.ok) throw new HttpFehler(res.status, pfad)

    const text = Buffer.from(bytes).toString('utf8')
    let roh: unknown
    try { roh = JSON.parse(text) } catch {
      throw new Error(`keine JSON-Antwort bei ${pfad} (${text.length} Bytes)`)
    }
    const { fehler } = auspacken(roh)
    if (fehler) throw new Error(`Hüllenfehler bei ${pfad}: ${fehler.slice(0, 300)}`)
    return roh
  }

  /**
   * Ein Bild laden. Eine Login- oder Fehlerseite mit HTTP 200 ist kein Bild —
   * als `.jpg` gespeichert fiele sie erst beim Öffnen auf.
   */
  async bild(quelle: string): Promise<{ bytes: Uint8Array; typ: string }> {
    const url = new URL(quelle, this.basis)
    bildFreigegeben(url, url.origin === this.heimat)
    const { res, bytes } = await this.holen(url, 'image/avif,image/webp,image/*,*/*;q=0.8', true, false)
    if (!res.ok) throw new HttpFehler(res.status, url.pathname)
    const typ = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!typ.startsWith('image/')) {
      throw new Error(`kein Bild (${typ || 'ohne Typ'}, ${bytes.length} Bytes) bei ${url.pathname}`)
    }
    return { bytes, typ }
  }

  /**
   * Pause, Neuanmeldung, Sperre — für JSON und Bilder gleich. Nur Antworten
   * von FoodNotify selbst sagen etwas über den Zugang; ein 403 eines fremden
   * Bildspeichers heißt „dieses Bild nicht".
   */
  private async holen(url: URL, accept: string, weiterleiten: boolean, sperrt403: boolean) {
    const warten = this.pause - (Date.now() - this.letzter)
    if (warten > 0) await schlaf(warten)

    const start = Date.now()
    try {
      let { res, eigen } = await this.folgen(url, accept, weiterleiten)
      if (eigen && fnSessionAbgelaufen(res)) {
        log.info('rezepte: sitzung abgelaufen, melde einmal neu an', { pfad: url.pathname })
        await this.session.anmelden()
        ;({ res, eigen } = await this.folgen(url, accept, weiterleiten))
        if (eigen && fnSessionAbgelaufen(res)) {
          throw new Abbruch('Sitzung direkt nach der Neuanmeldung wieder abgelaufen — '
            + 'nutzt gerade ein zweiter Client (der Container?) denselben Zugang?')
        }
      }
      if (eigen && (res.status === 429 || (res.status === 403 && sperrt403))) {
        throw new Abbruch(`FoodNotify hat gesperrt (HTTP ${res.status}) bei ${url.pathname} — `
          + 'fertige Rezepte liegen im Ziel und werden beim nächsten Start übersprungen')
      }
      return { res, bytes: new Uint8Array(await res.arrayBuffer()) }
    } finally {
      this.letzter = Date.now()
      this.dauerMs += this.letzter - start
      this.anfragen++
    }
  }

  /**
   * Weiterleitungen selbst verfolgen, und nur bei Bildern. Das Session-Cookie
   * steht als eigener Header in der Anfrage; `redirect: 'follow'` nähme es zu
   * einem fremden Bildspeicher mit. Hier geht es nur an FoodNotify.
   *
   * Eine Weiterleitung von FoodNotify auf die Login-Seite ist kein Weg,
   * sondern die Antwort — die erkennt `fnSessionAbgelaufen`.
   */
  private async folgen(url: URL, accept: string, weiterleiten: boolean) {
    let ziel = url
    for (let schritt = 0; schritt < 5; schritt++) {
      const eigen = ziel.origin === this.heimat
      const headers: Record<string, string> = eigen
        ? { ...this.session.header(), accept }
        : { accept, 'user-agent': config.LINA_USER_AGENT }
      const res = await fetch(ziel, {
        headers, redirect: 'manual', signal: AbortSignal.timeout(config.ANFRAGE_TIMEOUT_MS),
      })
      const ort = res.headers.get('location')
      const umleitung = res.status >= 300 && res.status < 400 && ort
      if (!weiterleiten || !umleitung || (eigen && /login/i.test(ort))) return { res, eigen }

      await res.arrayBuffer().catch(() => {})
      ziel = new URL(ort, ziel)
      bildFreigegeben(ziel, ziel.origin === this.heimat)
    }
    throw new Error(`zu viele Weiterleitungen ab ${url.pathname}`)
  }
}

/**
 * Seitenzahl einer Antwort. `auspacken` erkennt die recipes- und die flache
 * Hülle; `{items, pagination}` — die vermutete Form des POS-Mappings — ist
 * dort bewusst keine Hülle und wird hier nachgesehen. Ohne Angabe: eine Seite.
 */
export function gesamtSeiten(roh: unknown): number {
  const h = auspacken(roh)
  if (h.seiten) return h.seiten.gesamtSeiten
  const d = h.daten as any
  const n = Number(d?.pagination?.totalPages ?? d?.totalPages ?? d?.page_count)
  return Number.isInteger(n) && n > 0 ? n : 1
}

/** Die Zeilen einer Listenantwort, gleich in welcher der bekannten Formen. */
export function zeilen(roh: unknown): any[] {
  const d = auspacken(roh).daten as any
  if (Array.isArray(d)) return d
  for (const k of ['items', 'data', 'locations']) if (Array.isArray(d?.[k])) return d[k]
  return []
}

/** Einen Pfad vollständig lesen — einseitig als Inhalt, mehrseitig als eine Liste. */
export async function alleSeiten(leser: Leser, pfad: string, sperrt403 = true): Promise<unknown> {
  const erste = await leser.json(pfad, sperrt403)
  const n = gesamtSeiten(erste)
  if (n <= 1) return auspacken(erste).daten
  const alle = [...zeilen(erste)]
  for (let s = 2; s <= n; s++) alle.push(...zeilen(await leser.json(`${pfad}?page=${s}`, sperrt403)))
  return alle
}

// ---------------------------------------------------------------------------
// Bilder finden
// ---------------------------------------------------------------------------

const BILDSCHLUESSEL = /(image|img|photo|picture|bild|foto|media|thumb)/i
/** Unterfelder eines Bildobjekts, etwa `image: {url}` oder `images: ["…"]`. */
const BILDUNTERFELD = /^(\d+|url|uri|src|href|path|link|original|full|large|medium|small|thumb|thumbnail|preview)$/i
const VORSCHAU = /(thumb|small|preview|klein|mini)/i

export type Bildquelle = { fundstelle: string; url: string }

/**
 * Bildadressen in den Teilen eines Rezepts, mit der Stelle, an der sie stehen.
 *
 * Vorschaubilder zählen nur, wenn es sonst keins gibt — ein Rezept mit Bild
 * und Thumbnail soll ein Bild haben, nicht zwei Größen desselben.
 * Zutaten und Meta werden bewusst nicht durchsucht: ein Warenfoto einer Zutat
 * ist kein Rezeptbild.
 */
export function bildquellen(teile: Record<string, unknown>): Bildquelle[] {
  const gross: Bildquelle[] = []
  const klein: Bildquelle[] = []
  const gesehen = new Set<string>()

  const gehen = (x: unknown, pfad: string, imBild: boolean, tiefe: number) => {
    if (tiefe > 8 || x === null || typeof x !== 'object') return
    for (const [k, v] of Object.entries(x)) {
      const hier = Array.isArray(x) ? `${pfad}[${k}]` : `${pfad}.${k}`
      const bild = BILDSCHLUESSEL.test(k) || (imBild && BILDUNTERFELD.test(k))
      if (typeof v !== 'string') { gehen(v, hier, bild, tiefe + 1); continue }
      const w = v.trim()
      if (!bild || !/^(https?:\/\/|\/)/i.test(w) || gesehen.has(w)) continue
      gesehen.add(w)
      ;(VORSCHAU.test(hier) ? klein : gross).push({ fundstelle: hier, url: w })
    }
  }
  for (const [teil, inhalt] of Object.entries(teile)) gehen(inhalt, teil, false, 0)
  return gross.length > 0 ? gross : klein
}

const ENDUNGEN: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'image/heic': 'heic', 'image/tiff': 'tif', 'image/bmp': 'bmp',
}

/**
 * Dateiname eines Bildes ohne Endung.
 *
 * Das Rezeptbild heißt wie das Rezept; ein zweites (Liste und Kopf zeigen
 * bei fünf Rezepten verschiedene) zählt ab 2. Schrittfotos tragen den
 * Schritt im Namen — sonst wäre `<id>.jpg` bei einem Rezept ohne `imagePath`
 * das erste Schrittfoto, und niemand sähe es dem Namen an.
 *
 * `hauptNr` zählt nur Bilder außerhalb der Schritte.
 */
export function bildBasis(id: string, fundstelle: string, hauptNr: number): string {
  const schritt = fundstelle.match(/^schritte\[(\d+)\](?:\.images\[(\d+)\])?/)
  if (schritt) return `${id}_schritt${Number(schritt[1]) + 1}_${Number(schritt[2] ?? 0) + 1}`
  return hauptNr === 0 ? id : `${id}_${hauptNr + 1}`
}

/** Endung aus dem Content-Type, sonst aus der Adresse, sonst `bin`. */
export function bildEndung(typ: string, url: string): string {
  if (ENDUNGEN[typ]) return ENDUNGEN[typ]!
  const m = new URL(url, 'https://x.invalid').pathname.match(/\.([a-z0-9]{2,5})$/i)
  return m ? m[1]!.toLowerCase() : 'bin'
}

// ---------------------------------------------------------------------------
// Ablegen
// ---------------------------------------------------------------------------

export function rezeptName(r: any): string | null {
  return r?.name ?? r?.title ?? null
}

export function rezeptDateiname(r: any): string {
  const id = String(r?.id ?? '')
  if (!istId(id)) throw new Error(`Rezept ohne brauchbare id: ${JSON.stringify(r).slice(0, 120)}`)
  const sauber = String(rezeptName(r) ?? '').normalize('NFC')
    .replace(/[\/\\:*?"<>|\s]+/g, '_').slice(0, 100).replace(/^_+|_+$/g, '')
  return `${id}__${sauber || 'ohne_namen'}.json`
}

export type Kassenartikel = { connectionId: number; kostenstelle: string | null } & Record<string, unknown>

/** recipeId → die Kassenartikel, die darauf zeigen. Artikel ohne Rezept fallen heraus. */
export function kassenzuordnung(artikel: Kassenartikel[]): Map<string, Kassenartikel[]> {
  const m = new Map<string, Kassenartikel[]>()
  for (const a of artikel) {
    const id = a.recipeId ?? (a.recipe as any)?.id
    if (id === null || id === undefined || id === '') continue
    const liste = m.get(String(id)) ?? []
    liste.push(a)
    m.set(String(id), liste)
  }
  return m
}

/** Wer auf ein Rezept zeigt, das die Liste nicht enthielt. */
export type Verweis = { unterrezept_in: number[]; kasse: { plu: unknown; name: unknown }[] }

/**
 * IDs, auf die ein Unterrezept oder ein Kassenartikel zeigt, die aber nicht in
 * der Liste stehen — mit den Stellen, von denen der Verweis kommt.
 */
export function fehlendeVerweise(
  rezepte: Iterable<{ id: unknown; zutaten?: any[] }>, artikel: any[], inListe: Set<string>,
): Map<string, Verweis> {
  const m = new Map<string, Verweis>()
  const eintrag = (id: string) => {
    let v = m.get(id)
    if (!v) { v = { unterrezept_in: [], kasse: [] }; m.set(id, v) }
    return v
  }
  for (const r of rezepte) {
    for (const z of r.zutaten ?? []) {
      if (z?.subRecipeId === null || z?.subRecipeId === undefined) continue
      const id = String(z.subRecipeId)
      if (inListe.has(id)) continue
      const v = eintrag(id)
      if (!v.unterrezept_in.includes(Number(r.id))) v.unterrezept_in.push(Number(r.id))
    }
  }
  for (const a of artikel) {
    const id = a?.recipeId ?? a?.recipe?.id
    if (id === null || id === undefined || id === '' || inListe.has(String(id))) continue
    eintrag(String(id)).kasse.push({ plu: a.plu, name: a.name })
  }
  return m
}

export type Nachholeintrag = {
  status: 'geladen' | 'nicht_gefunden' | 'fehler'
  verweis: Verweis
  datei?: string
  fehler?: string
}

type Bildeintrag = { fundstelle: string; quelle: string; datei?: string; fehler?: string }

/** Fertig heißt: `bilder` steht in der Datei, und jede genannte Bilddatei liegt da. */
export function vollstaendig(inhalt: any, bilddateien: Set<string>): boolean {
  if (!Array.isArray(inhalt?.bilder)) return false
  return (inhalt.bilder as Bildeintrag[]).every(b => b.datei && bilddateien.has(b.datei.replace(/^img\//, '')))
}

/** Erst vollständig schreiben, dann umbenennen — eine halbe Datei gilt sonst als fertig. */
async function schreiben(pfad: string, inhalt: unknown): Promise<void> {
  const tmp = `${pfad}.tmp`
  await Bun.write(tmp, typeof inhalt === 'string' || inhalt instanceof Uint8Array
    ? inhalt : JSON.stringify(inhalt, null, 2) + '\n')
  await rename(tmp, pfad)
}

/**
 * Was auf der Platte liegt: Datei je Rezept-ID, die Unterrezept-Verweise und
 * wie viele Bilder unfertiger Rezepte noch fehlen. Nur die Verweise bleiben im
 * Speicher, nicht die Rezepte — es sind über zweitausend.
 */
async function bestandLesen(ordner: string, bilddateien: Set<string>, nachBasis: Map<string, string>) {
  const dateien = new Map<string, string>()
  const rezepte: { id: unknown; zutaten: any[] }[] = []
  let bilderOffen = 0
  for (const n of await readdir(ordner).catch(() => [] as string[])) {
    if (!n.endsWith('.json')) continue
    const r: any = await Bun.file(`${ordner}/${n}`).json()
    const id = String(r.id)
    dateien.set(id, `${ordner}/${n}`)
    rezepte.push({ id: r.id, zutaten: (r.zutaten ?? []).filter((z: any) => z?.subRecipeId != null) })
    if (vollstaendig(r, bilddateien)) continue
    let hauptNr = 0
    for (const q of bildquellen({ liste: r.liste, kopf: r.kopf, schritte: r.schritte })) {
      if (!nachBasis.has(bildBasis(id, q.fundstelle, hauptNr))) bilderOffen++
      if (!q.fundstelle.startsWith('schritte')) hauptNr++
    }
  }
  return { dateien, rezepte, bilderOffen }
}

export function argumente(argv: string[]): { marke: string; restaurant: number; ziel: string } {
  const [marke, restaurant, ziel] = argv.filter(a => !a.startsWith('--'))
  const r = Number(restaurant)
  if (!marke || !/^[a-z_]+$/.test(marke) || !Number.isInteger(r) || r <= 0 || !ziel) {
    throw new Error('Aufruf: bun run src/rezepte.ts <marke> <restaurantId> <zielordner> [--ziehen]')
  }
  return { marke, restaurant: r, ziel: resolve(ziel) }
}

function dauer(ms: number): string {
  const min = Math.round(ms / 60_000)
  return min < 90 ? `${min} min` : `${(min / 60).toFixed(1)} h`
}

async function jsonOder<T>(pfad: string, sonst: T): Promise<T> {
  return await Bun.file(pfad).exists() ? await Bun.file(pfad).json() as T : sonst
}

// ---------------------------------------------------------------------------

if (import.meta.main) {
  const { marke, restaurant, ziel } = argumente(process.argv.slice(2))
  const ziehenGewollt = process.argv.includes('--ziehen')
  const rezeptOrdner = `${ziel}/rezepte`
  const imgOrdner = `${ziel}/img`
  const listePfad = `${ziel}/rezeptliste.json`
  const protokollPfad = `${ziel}/nachgeholt.json`

  const zugang = fnZugaenge().find(z => z.schluessel === marke)
  if (!zugang) throw new Error(`Keine Zugangsdaten für Marke "${marke}" (FN_*_USER/_PASSWORD)`)
  const session = new FnSession(zugang)
  await session.anmelden()
  const leser = new FnLeser(session)

  const erste = await leser.json('/api/recipes?page=1')
  const listenSeiten = gesamtSeiten(erste)
  const rezeptzahl = auspacken(erste).seiten?.gesamt ?? zeilen(erste).length * listenSeiten

  const orte = zeilen(await leser.json('/api/pos/locations'))
    .filter(l => Number(l?.restaurantId) === restaurant)
  const anbindungen = orte.filter(l => l?.connection?.connectionId)

  /*
   * Die Probe am ersten Rezept: wo stehen Bilder? Zwei Aufrufe, die in der
   * Vorschau mehr wert sind als jede Annahme über ein Feld.
   */
  const probe = zeilen(erste)[0]
  const probeKopf = probe ? await alleSeiten(leser, `/api/recipes/${probe.id}`) : null
  const probeSchritte = probe ? await alleSeiten(leser, `/api/recipes/${probe.id}/steps`) : null
  const probeBilder = bildquellen({ liste: probe, kopf: probeKopf, schritte: probeSchritte })

  // --- Was ein früherer Lauf hinterlassen hat -----------------------------
  const bilddateien = new Set((await readdir(imgOrdner).catch(() => [] as string[])).filter(f => !f.endsWith('.tmp')))
  const nachBasis = new Map([...bilddateien].map(f => [f.replace(/\.[^.]+$/, ''), f]))
  const protokoll = await jsonOder<Record<string, Nachholeintrag>>(protokollPfad, {})
  const alteListe = await jsonOder<any[] | null>(listePfad, null)
  const alteKasse = await jsonOder<any>(`${ziel}/kasse.json`, null)
  const vorher = await bestandLesen(rezeptOrdner, bilddateien, nachBasis)
  const alteIds = new Set((alteListe ?? []).map(r => String(r.id)))
  const vorherFehlend = [...fehlendeVerweise(vorher.rezepte, alteKasse?.artikel ?? [], alteIds)]
    .filter(([id]) => !vorher.dateien.has(id) && protokoll[id]?.status !== 'nicht_gefunden')
  const listeOhneDatei = alteListe ? [...alteIds].filter(id => !vorher.dateien.has(id)).length : rezeptzahl

  const mittel = leser.dauerMs / leser.anfragen
  const jeRezept = 4 + Math.max(1, probeBilder.length)
  const offen = (alteListe ? 0 : listenSeiten - 1) + anbindungen.length
    + (listeOhneDatei + vorherFehlend.length) * jeRezept + vorher.bilderOffen

  console.log(`\nMarke ${marke}: ${rezeptzahl} Rezepte auf ${listenSeiten} Listenseiten`)
  console.log(`Restaurant ${restaurant}: ${orte[0]?.restaurant ?? '— nicht gefunden —'}`)
  for (const o of orte) {
    const c = o.connection
    console.log(`  ${String(o.costCenter ?? '').trim().padEnd(28)} `
      + (c ? `Kasse ${c.connectionId} (${c.deviceType?.name ?? '?'})` : 'keine Kassenanbindung'))
  }
  console.log(`\nBilder im ersten Rezept (${probe?.id} ${rezeptName(probe) ?? ''}):`)
  if (probeBilder.length === 0) {
    console.log(`  keins erkannt. Felder im Kopf: ${Object.keys((probeKopf as object) ?? {}).join(', ')}`)
  }
  for (const b of probeBilder) console.log(`  ${b.fundstelle} → ${b.url.slice(0, 110)}`)
  console.log(`\nIm Ziel: ${vorher.dateien.size} Rezeptdateien, ${bilddateien.size} Bilder, `
    + `noch ${vorher.bilderOffen} Bilder zu vorhandenen Rezepten offen.`)
  console.log(`Verwiesen, aber nicht in der Liste und noch ohne Datei: ${vorherFehlend.length} — werden einzeln nachgeholt`
    + ` (${Object.values(protokoll).filter(p => p.status === 'nicht_gefunden').length} früher nicht gefunden).`)
  console.log(`\nNoch ~${offen} Anfragen, je ${PAUSE_MS / 1000} s Pause + gemessen ${Math.round(mittel)} ms Antwort`
    + ` → grob ${dauer(offen * (PAUSE_MS + mittel))}. Nachgeholte Rezepte können weitere Unterrezepte mitbringen.`)
  console.log(`Ablage: ${ziel}`)

  if (orte.length === 0) {
    console.log(`\nRestaurant ${restaurant} kommt in /api/pos/locations dieser Marke nicht vor — Abbruch.\n`)
    process.exit(1)
  }
  if (!ziehenGewollt) {
    console.log(`\nVorschau — es wurde nichts gespeichert. Zum Ziehen: --ziehen anhängen.\n`)
    process.exit(0)
  }

  // --- Rezeptliste ---------------------------------------------------------
  let liste: any[]
  if (alteListe) {
    liste = alteListe
    console.log(`\nRezeptliste aus ${listePfad} (${liste.length}) — für eine frische Liste die Datei löschen.`)
  } else {
    liste = [...zeilen(erste)]
    for (let s = 2; s <= listenSeiten; s++) liste.push(...zeilen(await leser.json(`/api/recipes?page=${s}`)))
    if (liste.length !== rezeptzahl) {
      log.warn('rezepte: Liste und Zählfeld weichen ab', { liste: liste.length, gemeldet: rezeptzahl })
    }
    await schreiben(listePfad, liste)
  }
  const inListe = new Set(liste.map(r => String(r.id)))

  // --- Kassenzuordnung des Restaurants --------------------------------------
  const artikel: Kassenartikel[] = []
  for (const o of anbindungen) {
    const connectionId = Number(o.connection.connectionId)
    const inhalt = await alleSeiten(leser, `/api/pos/mapping/${connectionId}/articles`)
    const reihen = Array.isArray(inhalt) ? inhalt : zeilen(inhalt)
    if (reihen.length === 0) log.warn('rezepte: Kasse ohne erkennbare Artikel', { connectionId })
    for (const a of reihen) artikel.push({ connectionId, kostenstelle: String(o.costCenter ?? '').trim() || null, ...a })
  }
  const zuordnung = kassenzuordnung(artikel)
  await schreiben(`${ziel}/kasse.json`, { restaurantId: restaurant, standorte: orte, artikel })
  console.log(`Kasse: ${artikel.length} Artikel, ${zuordnung.size} Rezepte zugeordnet`)

  await mkdir(rezeptOrdner, { recursive: true })
  await mkdir(imgOrdner, { recursive: true })

  let geladen = 0, fertigDa = 0, bearbeitet = 0, bilderGeladen = 0, ohneBild = 0, bilderGescheitert = 0, serie = 0
  const gescheitert = new Set<string>()
  const beginn = Date.now()

  // --- Ein Rezept: Teile holen, falls nötig; dann die Bilder ------------------
  const bearbeiten = async (
    eintrag: any, datei: string,
    zusatz: { liste: unknown; kopf?: unknown; nachgeholt?: Verweis },
  ): Promise<'fertig' | 'bearbeitet' | 'fehler'> => {
    const id = String(eintrag.id)
    let inhalt: any = await Bun.file(datei).exists() ? await Bun.file(datei).json() : null
    if (inhalt && vollstaendig(inhalt, bilddateien)) return 'fertig'

    try {
      if (!inhalt) {
        const teil = (s: string) => alleSeiten(leser, `/api/recipes/${id}${s}`)
        inhalt = {
          id: eintrag.id,
          name: rezeptName(eintrag),
          ...(zusatz.nachgeholt ? { nachgeholt: zusatz.nachgeholt } : {}),
          liste: zusatz.liste,
          kopf: zusatz.kopf ?? await teil(''),
          zutaten: await teil('/ingredients'),
          meta: await teil('/meta'),
          schritte: await teil('/steps'),
          an_kasse: zuordnung.get(id) ?? [],
        }
        // Das Rezept ist gesichert, bevor das erste Bild scheitern kann.
        await schreiben(datei, inhalt)
        geladen++
        serie = 0
      }

      const quellen = bildquellen({ liste: inhalt.liste, kopf: inhalt.kopf, schritte: inhalt.schritte })
      if (quellen.length === 0) ohneBild++
      const bilder: Bildeintrag[] = []
      let hauptNr = 0
      for (const q of quellen) {
        const basis = bildBasis(id, q.fundstelle, hauptNr)
        if (!q.fundstelle.startsWith('schritte')) hauptNr++
        const da = nachBasis.get(basis)
        if (da) { bilder.push({ fundstelle: q.fundstelle, quelle: q.url, datei: `img/${da}` }); continue }
        try {
          const { bytes, typ } = await leser.bild(q.url)
          const name = `${basis}.${bildEndung(typ, q.url)}`
          await schreiben(`${imgOrdner}/${name}`, bytes)
          bilddateien.add(name)
          nachBasis.set(basis, name)
          bilder.push({ fundstelle: q.fundstelle, quelle: q.url, datei: `img/${name}` })
          bilderGeladen++
          serie = 0
        } catch (e) {
          if (e instanceof Abbruch || e instanceof FnAnmeldungFehlgeschlagen) throw e
          serie++
          bilderGescheitert++
          gescheitert.add(id)
          bilder.push({ fundstelle: q.fundstelle, quelle: q.url, fehler: String(e).slice(0, 300) })
          log.warn('rezepte: Bild übersprungen', { id, quelle: q.url.slice(0, 120), fehler: String(e).slice(0, 200), serie })
        }
      }
      await schreiben(datei, { ...inhalt, bilder })
      return 'bearbeitet'
    } catch (e) {
      if (e instanceof Abbruch || e instanceof FnAnmeldungFehlgeschlagen) throw e
      serie++
      gescheitert.add(id)
      log.warn('rezepte: Rezept übersprungen', { id, fehler: String(e).slice(0, 300), serie })
      return 'fehler'
    }
  }

  // --- Nachholen: verwiesen, aber nicht in der Liste ------------------------
  const gefragt = new Set<string>()
  const nachholen = async (wann: string) => {
    for (let runde = 1; runde <= 10; runde++) {
      const bestand = await bestandLesen(rezeptOrdner, bilddateien, nachBasis)
      const fehlend = fehlendeVerweise(bestand.rezepte, artikel, inListe)
      let neu = 0

      for (const [id, verweis] of fehlend) {
        if (serie >= SERIE_BIS_ABBRUCH) return
        if (protokoll[id]?.status === 'nicht_gefunden' || gefragt.has(id)) continue
        gefragt.add(id)

        if (!istId(id)) {
          protokoll[id] = { status: 'fehler', verweis, fehler: 'keine brauchbare Rezept-ID' }
          continue
        }

        const vorhanden = bestand.dateien.get(id)
        if (vorhanden) {
          // Aus einem früheren Lauf: Datei da, womöglich ohne Bilder.
          const alt: any = await Bun.file(vorhanden).json()
          const e = await bearbeiten(alt.kopf ?? alt, vorhanden, { liste: alt.liste ?? null, nachgeholt: verweis })
          protokoll[id] = e === 'fehler'
            ? { status: 'fehler', verweis, datei: vorhanden.slice(ziel.length + 1), fehler: 'Bilder unvollständig, siehe Log' }
            : { status: 'geladen', verweis, datei: vorhanden.slice(ziel.length + 1) }
          continue
        }

        let kopf: any
        try {
          kopf = await alleSeiten(leser, `/api/recipes/${id}`, false)
        } catch (e) {
          if (e instanceof Abbruch || e instanceof FnAnmeldungFehlgeschlagen) throw e
          if (e instanceof HttpFehler && e.status === 404) {
            protokoll[id] = { status: 'nicht_gefunden', verweis, fehler: e.message }
            serie = 0
            continue
          }
          serie++
          gescheitert.add(id)
          protokoll[id] = { status: 'fehler', verweis, fehler: String(e).slice(0, 300) }
          log.warn('rezepte: Nachholen gescheitert', { id, fehler: String(e).slice(0, 200), serie })
          continue
        }

        const eintrag = { ...kopf, id: kopf?.id ?? id }
        if (String(eintrag.id) !== id) log.warn('rezepte: nachgeholtes Rezept trägt eine andere id', { gefragt: id, bekommen: eintrag.id })
        const datei = `${rezeptOrdner}/${rezeptDateiname(eintrag)}`
        const e = await bearbeiten(eintrag, datei, { liste: null, kopf, nachgeholt: verweis })
        protokoll[id] = e === 'fehler'
          ? { status: 'fehler', verweis, fehler: 'Teile unvollständig, siehe Log' }
          : { status: 'geladen', verweis, datei: datei.slice(ziel.length + 1) }
        if (e !== 'fehler') neu++
      }

      await schreiben(protokollPfad, protokoll)
      const zahl = (s: Nachholeintrag['status']) => Object.values(protokoll).filter(p => p.status === s).length
      console.log(`Nachholen ${wann}, Runde ${runde}: ${fehlend.size} verwiesene IDs ohne Listeneintrag, ${neu} neu geladen `
        + `— insgesamt geladen ${zahl('geladen')}, nicht gefunden ${zahl('nicht_gefunden')}, Fehler ${zahl('fehler')}`)
      if (neu === 0) return
    }
  }

  // --- Ablauf ------------------------------------------------------------------
  await nachholen('vor der Liste')

  for (const [i, r] of liste.entries()) {
    if (serie >= SERIE_BIS_ABBRUCH) {
      log.error('rezepte: Abbruch — zu viele Fehlschläge hintereinander', { serie, geladen, bilderGeladen })
      break
    }
    const e = await bearbeiten(r, `${rezeptOrdner}/${rezeptDateiname(r)}`, { liste: r })
    if (e === 'fertig') { fertigDa++; continue }
    bearbeitet++
    if (bearbeitet % 25 === 0) {
      const rest = liste.length - i - 1
      const schnitt = (Date.now() - beginn) / bearbeitet
      console.log(`  ${i + 1}/${liste.length} — ${geladen} Rezepte, ${bilderGeladen} Bilder geladen, `
        + `${fertigDa} lagen fertig da, ${gescheitert.size} mit Fehler, noch ~${dauer(rest * schnitt)}`)
    }
  }

  if (serie < SERIE_BIS_ABBRUCH) await nachholen('nach der Liste')
  else log.error('rezepte: Abbruch — zu viele Fehlschläge hintereinander', { serie })

  console.log(`\n${geladen} Rezepte geladen, ${fertigDa} lagen schon fertig da.`)
  console.log(`${bilderGeladen} Bilder geladen, ${ohneBild} bearbeitete Rezepte ohne Bild, ${bilderGescheitert} Bilder gescheitert.`)
  const zahl = (s: Nachholeintrag['status']) => Object.values(protokoll).filter(p => p.status === s).length
  console.log(`Nachgeholt: ${zahl('geladen')} geladen, ${zahl('nicht_gefunden')} nicht gefunden (404), ${zahl('fehler')} mit Fehler — ${protokollPfad}`)
  if (gescheitert.size) console.log(`Mit Fehler (nächster Start holt sie nach): ${[...gescheitert].join(', ')}`)
  console.log(`${leser.anfragen} Anfragen, Ablage: ${ziel}\n`)
}
