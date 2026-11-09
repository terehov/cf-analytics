/**
 * Die Antwort von `personalkostenprostunde` in Zeilen — reine Funktionen,
 * ohne Datenbank, ohne Konfiguration.
 *
 * WARUM EINE EIGENE DATEI. `laden.ts` zieht den Pool und damit `config` beim
 * Import; ein Test, der nur die Rundung prüfen will, hätte damit die `.env`
 * und ihre `DATABASE_URL` geladen, bevor ein Datenbanktest im selben Prozess
 * auf die Testdatenbank umstellen kann (Notiz „e2e-Test mit -t trifft
 * Produktiv-DB"). Hier hängt nichts dran.
 *
 * WAS DIE QUELLE LIEFERT (gemessen 07./09.11.2026, `docs/plan-tpapi.md` §1):
 *
 *   { "eff":  { "8": 6, "9": 12, … },          Personen in der Stunde
 *     "kost": { "8": 65.18, "9": 161.42000000000002, … },   Lohnkosten EUR
 *     "kostUser": { … } }                      je Person — wird NIE gespeichert
 *
 * Stundenschlüssel 0–23 als Text, fehlende Stunden FEHLEN (sie sind nicht 0).
 * Der Schlüssel ist LINAs Stunde im Geschäftstag `businessdate`; die Stunden
 * 0–7 gehören zum selben Geschäftstag wie die 8 (KORREKTUR 11). Hier wird
 * nichts umgerechnet — die Gegenprobe `mart.personal_stunde_pruefung` misst,
 * ob das stimmt.
 */

/** Eine Stunde, wie sie nach `core.personalkosten_stunde` geht. Zahlen als Text für numeric. */
export type StundenZeile = {
  stunde: number
  /** `eff[stunde]`, auf zwei Stellen; NULL, wenn die Stunde nur in `kost` steht. */
  personen: string | null
  /** `kost[stunde]`, auf Cent; NULL, wenn die Stunde nur in `eff` steht. */
  personalkosten: string | null
}

export type Tagesform = {
  stunden: StundenZeile[]
  /** Σ personen, zwei Stellen. "0.00" bei einem leeren Tag. */
  personenstunden: string
  /** Σ personalkosten in EUR, zwei Stellen. "0.00" bei einem leeren Tag. */
  personalkosten: string
  leer: boolean
}

/** Eine Antwort, deren Form nicht zur gemessenen passt. Der Lader sichert sie roh und lädt nichts. */
export class FormFehler extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'FormFehler'
  }
}

/*
 * Obergrenzen gegen numeric(6,2) und numeric(10,2). Ein Wert darüber würde in
 * der Transaktion als `numeric field overflow` scheitern und den Rohsatz mit
 * zurückrollen — genau so verschwanden bei den Kassen-Fehleingaben (0136) 27
 * Nächte lang Antworten, die man hätte ansehen wollen. Vorher geprüft, bleibt
 * die Antwort in `raw` und der Tag als Formfehler sichtbar.
 */
const PERSONEN_MAX = 9_999.99
const KOSTEN_MAX = 99_999_999.99

/** Auf `stellen` Nachkommastellen, als ganze Zahl in Hundertsteln — summierbar ohne Gleitkommarauschen. */
function hundertstel(x: number): number {
  return Math.round(x * 100)
}

function alsText(h: number): string {
  return (h / 100).toFixed(2)
}

function zahl(wert: unknown, was: string): number | null {
  if (wert === null || wert === undefined) return null
  const n = typeof wert === 'number' ? wert
    : typeof wert === 'string' && wert.trim() !== '' ? Number(wert)
    : Number.NaN
  if (!Number.isFinite(n)) throw new FormFehler(`${was}: keine Zahl`)
  return n
}

/**
 * `eff` oder `kost` als Zuordnung Stunde → Wert.
 *
 * Leer ist: fehlt, `null`, `{}` — und `[]`. Das letzte ist kein Gedankenspiel:
 * LINA ist PHP, und `json_encode` macht aus einem leeren Array `[]`, nicht
 * `{}`. Aus demselben Grund wird ein NICHT leeres Array als Liste mit der
 * Stunde als Index gelesen: ein PHP-Array mit den Schlüsseln 0, 1, 2 … ohne
 * Lücke kommt als JSON-Liste an. Gemessen ist das nicht; es kostet aber
 * nichts, und ohne es wäre ein durchgehend besetzter Tag ein Formfehler.
 */
function stundenwerte(feld: unknown, name: string): Map<number, number> {
  const aus = new Map<number, number>()
  if (feld === null || feld === undefined) return aus
  const paare: [string, unknown][] = Array.isArray(feld)
    ? feld.map((v, i) => [String(i), v])
    : typeof feld === 'object' ? Object.entries(feld as Record<string, unknown>)
    : (() => { throw new FormFehler(`${name} ist weder Objekt noch Liste`) })()
  for (const [schluessel, wert] of paare) {
    if (!/^\d{1,2}$/.test(schluessel) || Number(schluessel) > 23) {
      throw new FormFehler(`${name}: Stundenschluessel "${schluessel.slice(0, 10)}" liegt nicht in 0–23`)
    }
    const n = zahl(wert, `${name}[${schluessel}]`)
    if (n === null) continue
    aus.set(Number(schluessel), n)
  }
  return aus
}

/**
 * Antwort → Zeilen und Tagessummen. Wirft `FormFehler`, wenn die Antwort
 * nicht die gemessene Form hat.
 *
 * Eine Stunde, die nur in `kost` steht, bekommt `personen = NULL`, und
 * umgekehrt — nicht 0. Die fehlende Seite ist unbekannt, nicht null.
 *
 * Gerundet wird JEDER Einzelwert auf Hundertstel, und die Summe aus den
 * gerundeten Werten gebildet. Damit ist die Tagessumme in der Abrufzeile
 * exakt die Summe der Stundenzeilen — eine Gegenprobe, die um einen Cent
 * abweicht, weil einmal vor und einmal nach dem Summieren gerundet wurde,
 * kostet sonst eine Stunde Suche.
 */
export function stundenAusAntwort(daten: unknown): Tagesform {
  if (daten === null || typeof daten !== 'object') {
    throw new FormFehler('Antwort ist kein Objekt')
  }
  // Ein Tag ohne jede Schicht kann auch als blankes `[]` kommen (PHP, s. o.).
  if (Array.isArray(daten)) {
    if (daten.length === 0) return { stunden: [], personenstunden: '0.00', personalkosten: '0.00', leer: true }
    throw new FormFehler('Antwort ist eine nicht leere Liste')
  }
  const d = daten as Record<string, unknown>
  const eff = stundenwerte(d.eff, 'eff')
  const kost = stundenwerte(d.kost, 'kost')

  const stunden: StundenZeile[] = []
  let summePersonen = 0
  let summeKosten = 0
  for (let h = 0; h < 24; h++) {
    const p = eff.get(h)
    const k = kost.get(h)
    if (p === undefined && k === undefined) continue
    if (p !== undefined && Math.abs(p) > PERSONEN_MAX) throw new FormFehler(`eff[${h}] ausserhalb des Wertebereichs`)
    if (k !== undefined && Math.abs(k) > KOSTEN_MAX) throw new FormFehler(`kost[${h}] ausserhalb des Wertebereichs`)
    const ph = p === undefined ? null : hundertstel(p)
    const kh = k === undefined ? null : hundertstel(k)
    if (ph !== null) summePersonen += ph
    if (kh !== null) summeKosten += kh
    stunden.push({
      stunde: h,
      personen: ph === null ? null : alsText(ph),
      personalkosten: kh === null ? null : alsText(kh),
    })
  }
  return {
    stunden,
    personenstunden: alsText(summePersonen),
    personalkosten: alsText(summeKosten),
    leer: stunden.length === 0,
  }
}

/**
 * Was von der Antwort nach `raw.api_antwort` darf: alles außer den
 * Zuordnungen JE PERSON.
 *
 * `kostUser` sind Lohnkosten je Mitarbeiter — personenbezogen, und `raw` ist
 * append-only (Regel 4): was hineinkommt, bleibt für immer. Vorbild ist das
 * Stammdatenblatt, dessen Schlüsseltabelle vor `raw` entfernt wird
 * (`src/ladenakte/laden.ts`).
 *
 * Entfernt wird jedes Feld, dessen Name auf `User` endet, nicht nur
 * `kostUser`: liefert LINA künftig ein `effUser` daneben, soll es nicht still
 * in einer Tabelle landen, aus der man es nie wieder löschen darf. Alles
 * andere bleibt — ein neues Feld auf Betriebsebene ist sofort in `raw` statt
 * verloren, dieselbe Haltung wie bei den Zusatzfeldern der Belege.
 */
export function ohnePersonenbezug(daten: unknown): unknown {
  if (daten === null || typeof daten !== 'object' || Array.isArray(daten)) return daten
  const aus: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(daten as Record<string, unknown>)) {
    if (/user$/i.test(k)) continue
    aus[k] = v
  }
  return aus
}
