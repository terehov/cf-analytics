/**
 * Formen der TPAPI-Stufe 2, die VOR `raw` gelesen werden müssen — reine
 * Funktionen, ohne Datenbank, ohne Konfiguration (aus demselben Grund wie
 * `form.ts`: ein Test, der nur die Rundung prüft, soll nicht die `.env`
 * laden).
 *
 * Zwei Antworten werden hier gelesen, bevor irgendetwas gespeichert wird:
 *
 *   1. `personal/personalkostenprotag` — eine Zeile JE PERSON. Die Zeilen
 *      kommen nirgends an, nur ihre Summe (Plan S5).
 *   2. `revenue/listdays` — die Arbeitsliste (Plan S2). Gespeichert wird sie
 *      unverändert; gelesen werden muss sie trotzdem, weil aus ihr
 *      `core.tpapi_geschaeftstag` entsteht.
 */
import { epochIstBerlinerMitternacht, linaEpochAlsDatum } from '../lib/time'
import { FormFehler } from './form'

// ---------------------------------------------------------------------------
// 1. personalkostenprotag
// ---------------------------------------------------------------------------

/**
 * Die sechs Felder, gemessen am 07.11.2026 (Aposto Aalen, 19 Zeilen ohne
 * Namen). Reihenfolge wie in der Antwort.
 */
export const PROTAG_FELDER = ['h_brutto', 'h_zuschl_25', 'h_zuschl_40', 'h_zuschl_50', 'brutto', 'lohnkosten'] as const
export type ProtagFeld = typeof PROTAG_FELDER[number]

/**
 * Was von `personalkostenprotag` nach `raw` geht: EIN Objekt je Betrieb und
 * Tag. Stunden auf zwei Stellen, Beträge auf Cent.
 *
 * `unbekannte_felder` steht nur da, wenn eine Zeile ein Feld trägt, das nicht
 * zu den sechs gehört — mit dem NAMEN, nie mit dem Wert. Liefert LINA künftig
 * etwa eine Personalnummer mit, soll das sichtbar werden (der Hash ändert
 * sich, `mart.tpapi_abruf_stand` zählt die Änderung), ohne dass sie in einer
 * append-only-Tabelle landet. Dieselbe Haltung wie `ohnePersonenbezug()` in
 * `form.ts`, nur strenger: dort bleibt alles außer `*User`, hier bleibt nur
 * die Summe.
 */
export type ProtagSumme = {
  /** Zahl der Zeilen = Personen mit Arbeitszeit an diesem Tag laut LINA. */
  personen: number
} & Record<ProtagFeld, number> & { unbekannte_felder?: string[] }

/** Ganze Hundertstel — summierbar ohne Gleitkommarauschen (wie `form.ts`). */
function hundertstel(x: number): number {
  return Math.round(x * 100)
}

/**
 * Ein Feldwert als Zahl, tolerant: Zahl, Zahl als Text (auch mit Komma als
 * Dezimalzeichen — PHP mit deutscher Locale schreibt so), leer = null.
 *
 * Die Meldung nennt Zeile und Feld, NIE den Wert: sie geht nach `raw`
 * (`payload_text`, `ladefehler`), ins Log und nach `sync.tpapi_zugang` — und
 * ein Wert aus dieser Antwort ist ein Lohn einer Person.
 */
function protagZahl(wert: unknown, zeile: number, feld: string): number | null {
  if (wert === null || wert === undefined) return null
  if (typeof wert === 'number') {
    if (!Number.isFinite(wert)) throw new FormFehler(`Zeile ${zeile}: ${feld} ist keine endliche Zahl`)
    return wert
  }
  if (typeof wert === 'string') {
    const t = wert.trim()
    if (t === '') return null
    const norm = /^-?\d+,\d+$/.test(t) ? t.replace(',', '.') : t
    const n = Number(norm)
    if (!Number.isFinite(n)) throw new FormFehler(`Zeile ${zeile}: ${feld} ist keine Zahl`)
    return n
  }
  throw new FormFehler(`Zeile ${zeile}: ${feld} hat den Typ ${Array.isArray(wert) ? 'Liste' : typeof wert}`)
}

/**
 * Die Liste je Person → die Summe je Betrieb und Tag. Wirft `FormFehler`, wenn
 * die Antwort nicht die gemessene Form hat; die Meldung trägt keinen Wert.
 *
 * Angenommen werden:
 *   * eine Liste von Objekten (gemessen),
 *   * `[]` und `{}` als leerer Tag (PHP macht aus einem leeren Array `[]`,
 *     siehe `form.ts`),
 *   * ein Objekt, dessen Werte die Zeilen sind (ein PHP-Array mit Lücken in
 *     den Schlüsseln kommt so an — nicht gemessen, kostet aber nichts).
 *
 * Gerundet wird JEDER Einzelwert, die Summe aus den gerundeten Werten — damit
 * eine spätere Gegenprobe nicht an einem Cent hängt, der einmal vor und
 * einmal nach dem Summieren gerundet wurde (`form.ts`, `stundenAusAntwort`).
 */
export function protagVerdichten(daten: unknown): ProtagSumme {
  let zeilen: unknown[]
  if (Array.isArray(daten)) zeilen = daten
  else if (daten !== null && typeof daten === 'object') zeilen = Object.values(daten as Record<string, unknown>)
  else throw new FormFehler('Antwort ist weder Liste noch Objekt')

  const summe: Record<ProtagFeld, number> = {
    h_brutto: 0, h_zuschl_25: 0, h_zuschl_40: 0, h_zuschl_50: 0, brutto: 0, lohnkosten: 0,
  }
  const unbekannt = new Set<string>()
  const bekannt = new Set<string>(PROTAG_FELDER)

  zeilen.forEach((z, i) => {
    const nr = i + 1
    if (z === null || typeof z !== 'object' || Array.isArray(z)) {
      throw new FormFehler(`Zeile ${nr} ist kein Objekt`)
    }
    for (const [feld, wert] of Object.entries(z as Record<string, unknown>)) {
      if (!bekannt.has(feld)) {
        // Nur der Name, gekürzt — ein Feldname ist keine Angabe über eine Person.
        unbekannt.add(feld.slice(0, 40))
        continue
      }
      const n = protagZahl(wert, nr, feld)
      if (n !== null) summe[feld as ProtagFeld] += hundertstel(n)
    }
  })

  const aus: ProtagSumme = { personen: zeilen.length } as ProtagSumme
  for (const f of PROTAG_FELDER) aus[f] = summe[f] / 100
  if (unbekannt.size > 0) aus.unbekannte_felder = [...unbekannt].sort()
  return aus
}

// ---------------------------------------------------------------------------
// 2. listdays
// ---------------------------------------------------------------------------

export type Geschaeftstage = {
  /** YYYY-MM-DD, aufsteigend, ohne Doppelte. */
  tage: string[]
  /**
   * Wie viele Einträge NICHT auf Berliner Mitternacht lagen. Die Umrechnung
   * stimmt trotzdem für Mitternacht UTC und jede Uhrzeit bis 22:00 UTC (siehe
   * `geschaeftstagAusEpoch`) — die Zahl ist die Messung für die Formprobe,
   * ob LINA hier dieselbe Zeitbehandlung hat wie bei `from`/`to`.
   */
  nichtBerlinerMitternacht: number
}

/**
 * Unix-Sekunden aus `listdays` → Geschäftstag als YYYY-MM-DD.
 *
 * DIE ANNAHME (nicht gemessen, Plan §3 misst sie): der Wert ist ein
 * Zeitpunkt AM Geschäftstag, und der Tag ist sein Kalendertag in Berlin.
 * Über die Berliner Wanduhr, nicht über UTC — das ist die Stelle, an der ein
 * Tag um eins verrutscht:
 *
 *   Berliner Mitternacht (so liefert LINA `from`/`to`, verifiziert 25.07.2026):
 *     08.11.2026 00:00 Berlin = 07.11.2026 23:00 UTC
 *     → UTC-Kalendertag 07.11. (FALSCH), Berliner Kalendertag 08.11. (richtig)
 *   Mitternacht UTC:
 *     08.11.2026 00:00 UTC = 08.11.2026 01:00 Berlin
 *     → beide 08.11.
 *   Beginn des Geschäftstags (08:00 Berlin):
 *     → beide 08.11.
 *
 * Die Berliner Wanduhr ist also in allen drei denkbaren Fällen richtig, UTC
 * nur in zweien. Falsch würde sie erst, wenn LINA einen Zeitpunkt am VORABEND
 * liefert (22:00 bis 23:59 Berliner Zeit des Vortags) — dann zeigte
 * `nichtBerlinerMitternacht` auf alle Einträge, und die Probe sähe es.
 *
 * `src/tpapi_probe.ts` rechnet für die Anzeige über UTC (`toISOString`); die
 * Angaben „Aalen ab 22.10.2019" in docs/lina-third-party-api.md stammen
 * daher und können um einen Tag zu früh sein, falls LINA Berliner
 * Mitternacht liefert.
 */
export function geschaeftstagAusEpoch(sekunden: number): string | null {
  return linaEpochAlsDatum(sekunden)
}

/**
 * `listdays` → Geschäftstage. Gemessen ist eine Liste von
 * `{ businessdate: <Unix-Sekunden> }`; eine blanke Zahl oder ein Zahl-Text je
 * Eintrag wird ebenfalls angenommen. Alles andere ist ein Formfehler — ohne
 * Arbeitsliste gibt es keinen Rückstand, und ein still leerer Rückstand sähe
 * aus wie „alles geholt" (Regel 10).
 */
export function geschaeftstageAusListdays(daten: unknown): Geschaeftstage {
  if (!Array.isArray(daten)) throw new FormFehler('listdays ist keine Liste')
  const tage = new Set<string>()
  let nicht = 0
  daten.forEach((e, i) => {
    const roh = e !== null && typeof e === 'object' && !Array.isArray(e)
      ? (e as Record<string, unknown>).businessdate : e
    const n = typeof roh === 'number' ? roh
      : typeof roh === 'string' && /^\d+$/.test(roh.trim()) ? Number(roh.trim())
      : Number.NaN
    if (!Number.isFinite(n) || n <= 0) throw new FormFehler(`listdays, Eintrag ${i + 1}: businessdate ist keine Unix-Zeit`)
    const tag = geschaeftstagAusEpoch(n)
    if (!tag) throw new FormFehler(`listdays, Eintrag ${i + 1}: businessdate ist keine Unix-Zeit`)
    if (!epochIstBerlinerMitternacht(n, tag)) nicht++
    tage.add(tag)
  })
  return { tage: [...tage].sort(), nichtBerlinerMitternacht: nicht }
}
