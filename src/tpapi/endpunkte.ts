/**
 * Das Endpunktregister der TPAPI-Stufe 2 (Plan `docs/plan-tpapi-stufe2.md`,
 * S3) — ein neuer lesender Endpunkt ist ein Eintrag hier, wie bei
 * `src/lina/endpunkte.ts`.
 *
 * REINE DATEI. Kein `config`, kein Pool: das Register wird von Tests ohne
 * Datenbank gelesen (Wächter unten in `endpunkte.test.ts`), und ein Import
 * von `config` lädt die `.env` mit den echten Schlüsseln.
 *
 * NUR LESENDE PFADE (Regel 1). Der Client kennt ohnehin nur GET; trotzdem
 * steht hier kein einziger der schreibenden Pfade aus
 * docs/lina-third-party-api.md (`saveShift`, `addUserCert`,
 * `registerWebhook`, `PUT/POST merchandiseman/recipe/...`, Webkasse) — und
 * `endpunkte.test.ts` bricht ab, wenn einer dazukommt.
 *
 * BEWUSST NICHT HIER (Plan S4): `personal/acceptedworkingtimes`,
 * `userdataperday`, `userdataperdaydelta`, `getPersonalData` — Zeilen je
 * Person mit Arbeitszeiten und Stundenlohn, ohne Auftrag. `raw` ist
 * append-only; was dort einmal steht, bleibt. Und `personalkostenprostunde`
 * nicht: das ist Stufe 1 (`nachlauf.ts`, eigener Rückstand mit 365 Tagen).
 * Findet die Formprobe dort ältere Tage, bekommt er dieselbe Arbeitsliste
 * (S3) — als Eintrag hier, nicht als zweiter Weg.
 */
import { protagVerdichten } from './verdichtung'

/** Module der TPAPI = Buchungen im Marktplatz = Zeilen je Betrieb in `sync.tpapi_zugang`. */
export type TpapiModul = 'personal' | 'revenue' | 'artikel'

/**
 *   tage   die Arbeitsliste (`listdays`), einmal je Betrieb und Nacht
 *   tag    je Betrieb und Geschäftstag (`businessdate=`) → `core.tpapi_abruf`
 *   stamm  tagfreie Liste, je Betrieb als Momentaufnahme → `core.tpapi_stammabzug`
 */
export type TpapiAbrufArt = 'tage' | 'tag' | 'stamm'

export type TpapiEndpunkt = {
  /** Kurzname = letztes Pfadstück; `raw.api_antwort.endpunkt` ist `tpapi:<name>`. */
  name: string
  /** Relativ zu `/extern/`. */
  pfad: string
  modul: TpapiModul
  art: TpapiAbrufArt
  /**
   * Nur `tag`: wie viele zurückliegende Kalendertage Phase A jede Nacht neu
   * holt (Plan S7: 3). 0 für `tage` und `stamm`.
   */
  fensterTage: number
  /**
   * Läuft VOR `raw`: was zurückkommt, ist das, was gespeichert und gehasht
   * wird. Wirft `FormFehler` (dann geht nur die Meldung nach `raw`, nie die
   * Antwort). Nur für Antworten mit Personenbezug.
   */
  verdichten?: (daten: unknown) => unknown
  /** `false` = steht im Register, wird aber nicht gefragt (Begründung in `bemerkung`). */
  aktiv: boolean
  /** `raw.api_antwort.endpunkt`, `core.tpapi_abruf.endpunkt`, `core.tpapi_stammabzug.endpunkt`. */
  endpunkt: string
  bemerkung?: string
}

/** Fenster der Tagesendpunkte in Phase A (Plan S7). */
const FENSTER_TAGE = 3

function eintrag(e: Omit<TpapiEndpunkt, 'endpunkt' | 'name'> & { name?: string }): TpapiEndpunkt {
  const name = e.name ?? e.pfad.split('/').at(-1)!
  return { ...e, name, endpunkt: `tpapi:${name}` }
}

/**
 * Die dreizehn lesenden Listen der Article Data API (docs/lina-third-party-api.md,
 * Tabelle „Endpunkte"). Gemessen ist nur `grosscategory` (62–68 Zeilen
 * `id, number, name`); die übrigen zwölf sind nach Postman aufgenommen und
 * werden roh gesichert, bis die Formprobe sie ansieht (S11).
 */
const ARTIKELSTAMM = [
  'recipe', 'attributes', 'meccode', 'vat', 'financetype', 'financecategory', 'pricelevel',
  'site', 'operationprofile', 'meccodegroup', 'category', 'detailcategory', 'grosscategory',
] as const

export const TPAPI_ENDPUNKTE: readonly TpapiEndpunkt[] = [
  eintrag({
    pfad: 'revenue/listdays', modul: 'revenue', art: 'tage', fensterTage: 0, aktiv: true,
    bemerkung: 'Arbeitsliste: Liste {businessdate: Unix-Sekunden}, je Betrieb verschieden tief (Plan S2).',
  }),
  eintrag({
    pfad: 'revenue/journal', modul: 'revenue', art: 'tag', fensterTage: FENSTER_TAGE, aktiv: true,
    bemerkung: 'Kassenjournal je Position, 37 Felder, ~1–2 MB je Betrieb und Tag. Vollständig roh (S6).',
  }),
  eintrag({
    pfad: 'revenue/journaltables', modul: 'revenue', art: 'tag', fensterTage: FENSTER_TAGE, aktiv: true,
    bemerkung: 'Je Bon (Tisch), 27 Felder, mit Gästezahl. Vollständig roh (S6).',
  }),
  eintrag({
    pfad: 'personal/personalkostenprotag', modul: 'personal', art: 'tag', fensterTage: FENSTER_TAGE, aktiv: true,
    verdichten: protagVerdichten,
    bemerkung: 'Eine Zeile je Person ohne Kennung — vor raw zur Summe je Betrieb und Tag verdichtet (S5).',
  }),
  eintrag({
    pfad: 'revenue/getforecastperday', modul: 'revenue', art: 'stamm', fensterTage: 0,
    /*
     * AUS, BIS DIE FORMPROBE ES FREISCHALTET. Der Endpunkt verlangt
     * `from`/`to`, und deren Schreibweise (dd.mm.yyyy? Unix-Sekunden?) steht
     * nur in der Postman-Doku, gemessen ist sie nicht (Plan §1, §3). Ein
     * geratener Parameter brächte im besten Fall ein 400 je Betrieb und
     * Woche, im schlechtesten eine leere Liste, die als „keine Prognose"
     * gespeichert würde. Der Eintrag steht trotzdem hier, damit das Register
     * vollständig ist und `sync.quelle` ihn als „nicht erwartet" führt.
     */
    aktiv: false,
    bemerkung: 'Umsatzprognose je Tag; from/to-Schreibweise ungemessen — erst nach der Formprobe (Plan §3).',
  }),
  ...ARTIKELSTAMM.map(n => eintrag({
    pfad: `merchandiseman/${n}`, modul: 'artikel', art: 'stamm', fensterTage: 0, aktiv: true,
    bemerkung: 'Artikelstamm, Momentaufnahme je Betrieb, wöchentlich (S11).',
  })),
]

export const ENDPUNKT_LISTDAYS = TPAPI_ENDPUNKTE.find(e => e.art === 'tage')!

/** Die aktiven Tagesendpunkte — Phase-A-Fenster und Phase-C-Rückstand. */
export function aktiveTagesendpunkte(): TpapiEndpunkt[] {
  return TPAPI_ENDPUNKTE.filter(e => e.aktiv && e.art === 'tag')
}

/** Die aktiven tagfreien Listen — der wöchentliche Abzug. */
export function aktiveStammendpunkte(): TpapiEndpunkt[] {
  return TPAPI_ENDPUNKTE.filter(e => e.aktiv && e.art === 'stamm')
}

/**
 * Pfade, die nie in dieses Register dürfen — schreibend oder personenbezogen
 * ohne Auftrag (S4). Geprüft in `endpunkte.test.ts`.
 */
export const VERBOTENE_PFADE = [
  /saveShift/i, /addUserCert/i, /registerWebhook/i, /placeorder/i, /sendBooking/i, /command/i,
  /webcashregister/i, /tableStatus/i, /^personal\/(acceptedworkingtimes|userdataperday|userdataperdaydelta|getPersonalData)$/i,
  /merchandiseman\/recipe\/.+/i, /^bwa\//i,
]
