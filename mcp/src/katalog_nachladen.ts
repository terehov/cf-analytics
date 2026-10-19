/**
 * Der Katalog im laufenden Betrieb: einmal beim Start geladen, danach
 * nachgeladen, sobald er sich in der Datenbank aendert.
 *
 * DER FALL, DER DAS NOETIG GEMACHT HAT, 19.10.2026. Migration 0132 legte vier
 * Rezeptur-Sichten an (mart.rezept_position, mart.artikel_in_rezept,
 * mart.rezept_stand, mart.rezept_zuordnung_pruefung), und in Produktion
 * standen sie korrekt in mcp.sicht, mit Koernung. Der laufende Server kannte
 * sie trotzdem nicht: `sichten_suchen("rezept")` fand nur
 * deckungsbeitrag_warengruppe, `sicht_beschreiben("mart.artikel_in_rezept")`
 * meldete „steht nicht im Katalog", und in `abfrage_ausfuehren` blieb die
 * Koernung leer. Claude antwortete Nutzern, es gebe keine Rezeptdaten — bei
 * 17.638 geladenen Rezepten.
 *
 * Die Ursache war der Satz, der bis dahin in katalog.ts stand: „Ein Neustart
 * nach einer Migration ist ohnehin faellig — Dokploy macht ihn beim Deploy."
 * Er stimmt, nur in der falschen Reihenfolge. Importer und MCP-Dienst
 * deployen aus demselben Push GLEICHZEITIG, und die Migration laeuft im
 * Importer-Container. Der MCP-Server war schneller oben, las den Katalog von
 * VOR 0132 und hielt ihn bis zum naechsten Neustart. Dieselbe Signatur wie
 * der Deploy-Fall vom 21.09.2026 beim Gesundheitsstand (gesundheit.ts,
 * nachpruefen): ein Messwert von vor der Migration, der danach weiter galt.
 *
 * DER WEG: jede Minute ein Fingerabdruck (eine Zeile, 3–4 ms, katalog_laden.ts)
 * und nur bei Aenderung das volle Nachladen. Dazu der Fehltreffer: findet ein
 * Werkzeug eine Sicht nicht, wird einmal sofort nachgesehen — gedrosselt, weil
 * ein Modell, das Sichtnamen raet, sonst bei jedem Versuch die Datenbank
 * fragte. Der Takt allein haette gereicht, um den Fall zu heilen; der
 * Fehltreffer verkuerzt die Minute fuer genau die Frage, die sie trifft.
 *
 * EIN HALTER, KEINE KOPIEN. Jedes Werkzeug holt sich `aktuellerKatalog()` zu
 * Beginn seines Aufrufs und reicht DIESEN Stand an Pruefer, Ausfuehrung und
 * Spalteninfo weiter. Ein Aufruf sieht damit einen Katalog von Anfang bis
 * Ende — nie die Sichten des neuen mit den Fallstricken des alten. Der
 * Austausch ist eine einzige Zuweisung; was ein laufender Aufruf in der Hand
 * haelt, aendert sich nicht unter ihm.
 *
 * DIE HARTE REGEL GILT AUCH HIER. Nennt ein neu geladener Katalog eine
 * Regelart, die pruefen.ts nicht umsetzt, wird er NICHT uebernommen: der alte
 * bleibt, vollstaendig und mit allen seinen Wachen. Das wird laut gemeldet
 * (Log mit stufe 'error' bei jedem Versuch, `/status` auf 503 mit dem Grund)
 * und bei jedem Takt erneut versucht. Beim Start bleibt es beim harten
 * Abbruch — dort gibt es keinen alten Katalog, auf den man zurueckfallen
 * koennte. Eine halbe Wache ist schlimmer als keine, und ein still veralteter
 * Katalog ist schlimmer als ein laut veralteter.
 */
import { leererKatalog, type Katalog } from './katalog'
import { fingerabdruckHolen, katalogBauen, katalogRohLaden, type KatalogRoh } from './katalog_laden'

/** Wie oft der Fingerabdruck geprueft wird. */
export const TAKT_MS = 60 * 1000

/**
 * Wie oft ein Fehltreffer hoechstens nachsehen laesst. Ein Modell, das
 * fuenf Sichtnamen hintereinander raet, loest damit EINE Abfrage aus, nicht
 * fuenf — und wenn sich der Katalog geaendert hat, ist er nach der ersten
 * ohnehin da.
 */
export const FEHLTREFFER_ABSTAND_MS = 30 * 1000

/**
 * Ab wann eine ausbleibende Pruefung selbst eine Stoerung ist (harte Regel
 * 10: ein Waechter, der nicht mehr wacht, sieht aus wie ein ruhiger). Zehn
 * Takte — ein kurzer Datenbankausfall ist keine Meldung wert, ein Takt, der
 * nicht mehr laeuft, schon.
 */
export const STILLSTAND_MS = 10 * TAKT_MS

/** Woher der Katalog kommt — im Betrieb die Datenbank, in Tests eine Attrappe. */
export type Katalogquelle = {
  fingerabdruck: () => Promise<string>
  laden: () => Promise<KatalogRoh>
}

export type Nachladeergebnis = 'unveraendert' | 'neu' | 'gesperrt' | 'lesefehler'

export type Katalogsperre = {
  /** Die Meldung aus regelartenPruefen() — nennt die fehlenden Regelarten. */
  grund: string
  /** Der Fingerabdruck des abgelehnten Katalogs. */
  fingerabdruck: string
  seit: Date
  zuletzt: Date
  versuche: number
}

const DATENBANK: Katalogquelle = { fingerabdruck: fingerabdruckHolen, laden: katalogRohLaden }

let quelle: Katalogquelle = DATENBANK
let aktuell: Katalog = leererKatalog()
let geladenFingerabdruck: string | null = null
let geladenAm: Date | null = null
let geladenAnlass: string | null = null
let nachladungen = 0
let geprueftAm: Date | null = null
let sperre: Katalogsperre | null = null
let lesefehler: { fehler: string; am: Date } | null = null
let letzterFehltreffer = Number.NEGATIVE_INFINITY
let laufend: Promise<Nachladeergebnis> | null = null

const log = (stufe: 'info' | 'warn' | 'error', msg: string, felder: Record<string, unknown>) => {
  const zeile = JSON.stringify({ t: new Date().toISOString(), stufe, msg, ...felder })
  if (stufe === 'error') console.error(zeile)
  else if (stufe === 'warn') console.warn(zeile)
  else console.log(zeile)
}

const fehlerText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 500)

const kennzahlen = (k: Katalog) => ({
  sichten: k.sichten.size,
  mit_koernung: [...k.sichten.values()].filter(s => s.koernung).length,
  fallstricke: k.fallstricke.length,
})

/** Der Katalog, mit dem ein Werkzeugaufruf arbeitet — zu Beginn holen, dann durchreichen. */
export function aktuellerKatalog(): Katalog {
  return aktuell
}

/** Den neuen Katalog in Umlauf bringen und das laut sagen. */
function uebernehmen(neu: Katalog, fingerabdruck: string, anlass: string): void {
  const vorher = aktuell
  const warGesperrt = sperre
  aktuell = neu
  geladenFingerabdruck = fingerabdruck
  geladenAm = new Date()
  geladenAnlass = anlass
  nachladungen += anlass === 'start' ? 0 : 1
  sperre = null

  const neueSichten = [...neu.sichten.keys()].filter(s => !vorher.sichten.has(s))
  const entfallen = [...vorher.sichten.keys()].filter(s => !neu.sichten.has(s))
  log('info', anlass === 'start' ? 'Katalog geladen' : 'Katalog nachgeladen', {
    anlass, ...kennzahlen(neu),
    ...(anlass === 'start' ? {} : {
      vorher: kennzahlen(vorher),
      neue_sichten: neueSichten.slice(0, 20), entfallene_sichten: entfallen.slice(0, 20),
    }),
    fingerabdruck,
  })
  if (warGesperrt) {
    log('info', 'Katalogsperre aufgehoben', {
      gesperrt_seit: warGesperrt.seit.toISOString(), versuche: warGesperrt.versuche })
  }
}

/**
 * Beim Start: laden, pruefen, in Umlauf bringen. WIRFT bei einer unbekannten
 * Regelart — ohne alten Katalog gibt es nichts, worauf der Server sicher
 * zurueckfallen koennte, und dann faehrt er gar nicht erst hoch.
 *
 * Der Fingerabdruck wird VOR dem Laden geholt: aendert sich der Katalog
 * dazwischen, passt der gemerkte Abdruck nicht mehr, und der naechste Takt
 * laedt nach. Andersherum koennte eine Aenderung durchrutschen.
 */
export async function katalogErstladen(): Promise<Katalog> {
  const fingerabdruck = await quelle.fingerabdruck()
  const neu = katalogBauen(await quelle.laden())
  uebernehmen(neu, fingerabdruck, 'start')
  geprueftAm = new Date()
  return neu
}

async function nachladenEinmal(anlass: string): Promise<Nachladeergebnis> {
  let fingerabdruck: string
  let roh: KatalogRoh | null = null
  try {
    fingerabdruck = await quelle.fingerabdruck()
    geprueftAm = new Date()
    lesefehler = null
    // Unveraendert und nicht gesperrt: nichts zu tun. Bei einer Sperre wird
    // immer neu versucht — auch auf demselben Abdruck, damit die Meldung
    // nicht nach dem ersten Mal verstummt.
    if (fingerabdruck === geladenFingerabdruck && !sperre) return 'unveraendert'
    roh = await quelle.laden()
  } catch (e) {
    // Datenbank nicht erreichbar: der alte Katalog bleibt, der naechste Takt
    // versucht es wieder. Laenger als STILLSTAND_MS wird es eine Stoerung.
    lesefehler = { fehler: fehlerText(e), am: new Date() }
    log('error', 'Katalog nicht lesbar — alter Katalog bleibt', { anlass, fehler: lesefehler.fehler })
    return 'lesefehler'
  }

  let neu: Katalog
  try {
    neu = katalogBauen(roh)
  } catch (e) {
    const jetzt = new Date()
    sperre = {
      grund: fehlerText(e),
      fingerabdruck,
      seit: sperre?.seit ?? jetzt,
      zuletzt: jetzt,
      versuche: (sperre?.versuche ?? 0) + 1,
    }
    log('error', 'Neuer Katalog NICHT uebernommen — er nennt eine Regelart, die dieser Server ' +
      'nicht umsetzt. Der alte Katalog bleibt in Kraft, bis pruefen.ts sie kennt oder die Zeile ' +
      'auf aktiv = false steht.', {
      anlass, grund: sperre.grund, versuche: sperre.versuche,
      gesperrt_seit: sperre.seit.toISOString(),
      alter_katalog_seit: geladenAm?.toISOString() ?? null, ...kennzahlen(aktuell),
    })
    return 'gesperrt'
  }
  uebernehmen(neu, fingerabdruck, anlass)
  return 'neu'
}

/**
 * Einmal nachsehen und, wenn noetig, nachladen. Laeuft schon ein Nachladen,
 * wartet der Aufruf auf dieses — Takt und Fehltreffer fragen nie doppelt.
 */
export function katalogNachladen(anlass = 'takt'): Promise<Nachladeergebnis> {
  if (laufend) return laufend
  laufend = nachladenEinmal(anlass).finally(() => { laufend = null })
  return laufend
}

/**
 * Ein Werkzeug hat eine Sicht nicht gefunden: einmal sofort nachsehen,
 * hoechstens alle FEHLTREFFER_ABSTAND_MS. Gibt zurueck, ob danach ein
 * anderer Katalog gilt — nur dann lohnt die zweite Suche.
 */
export async function katalogFehltreffer(anlass: string, jetzt = Date.now()): Promise<boolean> {
  const vorher = aktuell
  if (laufend) {
    await laufend
    return aktuell !== vorher
  }
  if (jetzt - letzterFehltreffer < FEHLTREFFER_ABSTAND_MS) return false
  letzterFehltreffer = jetzt
  await katalogNachladen(`fehltreffer:${anlass}`)
  return aktuell !== vorher
}

/**
 * Den Katalog fuer einen Aufruf, der diese Sichten anspricht. Fehlt eine
 * davon, wird einmal nachgesehen (gedrosselt). Die Namen dienen nur als
 * Schluessel in einer Map — es geht nichts davon in SQL.
 */
export async function katalogFuer(sichten: readonly string[], anlass: string): Promise<Katalog> {
  const k = aktuell
  if (sichten.every(s => k.sichten.has(s))) return k
  await katalogFehltreffer(anlass)
  return aktuell
}

/**
 * Den Takt im Hintergrund halten. `unref()`, damit er keinen Prozess am
 * Leben haelt, der sonst fertig waere (sonst endet kein Test).
 */
export function katalogBeobachten(takt = TAKT_MS): () => void {
  const takten = setInterval(() => {
    katalogNachladen('takt').catch(e =>
      log('error', 'Katalogtakt gescheitert', { fehler: fehlerText(e) }))
  }, takt)
  takten.unref?.()
  return () => clearInterval(takten)
}

/** Was /status ueber den Katalog sagt. */
export function katalogZustand() {
  return {
    ...kennzahlen(aktuell),
    geladen_am: geladenAm?.toISOString() ?? null,
    geladen_anlass: geladenAnlass,
    nachladungen,
    geprueft_am: geprueftAm?.toISOString() ?? null,
    fingerabdruck: geladenFingerabdruck,
    gesperrt: sperre && {
      grund: sperre.grund, seit: sperre.seit.toISOString(),
      zuletzt: sperre.zuletzt.toISOString(), versuche: sperre.versuche,
    },
    lesefehler: lesefehler && { fehler: lesefehler.fehler, am: lesefehler.am.toISOString() },
  }
}

/**
 * Ist der Katalog in einem Zustand, den jemand sehen muss? null heisst nein.
 * Zwei Gruende: ein abgelehnter neuer Katalog, und ein Takt, der seit zehn
 * Minuten keinen Fingerabdruck mehr bekommen hat.
 */
export function katalogStoerung(jetzt = Date.now()): string | null {
  if (sperre) {
    return `Neuer Katalog abgelehnt seit ${sperre.seit.toISOString()}, der alte von ` +
           `${geladenAm?.toISOString() ?? '?'} gilt weiter: ${sperre.grund}`
  }
  if (geprueftAm && jetzt - geprueftAm.getTime() > STILLSTAND_MS) {
    return `Katalog seit ${geprueftAm.toISOString()} nicht mehr geprueft` +
           (lesefehler ? `: ${lesefehler.fehler}` : '')
  }
  return null
}

/** Nur fuer Tests: Quelle tauschen und den Halter in den Ausgangszustand setzen. */
export function katalogZuruecksetzen(q: Katalogquelle = DATENBANK): void {
  quelle = q
  aktuell = leererKatalog()
  geladenFingerabdruck = null
  geladenAm = null
  geladenAnlass = null
  nachladungen = 0
  geprueftAm = null
  sperre = null
  lesefehler = null
  letzterFehltreffer = Number.NEGATIVE_INFINITY
  laufend = null
}
