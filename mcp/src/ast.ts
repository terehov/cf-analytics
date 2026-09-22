/**
 * Der Syntaxbaum, so weit der Pruefer ihn braucht.
 *
 * WARUM EIN ECHTER PARSER UND KEINE REGULAEREN AUSDRUECKE.
 * Die Fallen, um die es geht, haengen an der STRUKTUR der Abfrage, nicht an
 * ihrem Text: „gruppiert nach stadt", „verbindet ueber den Namen statt ueber
 * den Schluessel", „summiert eine Spalte, die ein Median ist". Ein
 * Textabgleich beantwortet keine davon — er findet `stadt` auch im Wort
 * `hauptstadt` und uebersieht es hinter einem Alias.
 *
 * `libpg-query` ist der Parser von PostgreSQL selbst, als WASM gebaut. Er
 * versteht genau das, was die Datenbank versteht; es gibt keine zweite
 * Grammatik, die auseinanderlaufen koennte.
 *
 * WAS DER REVIEW VOM 13.09.2026 HIER GEAENDERT HAT, jeweils mit der Abfrage,
 * die vorher durchkam:
 *   - `BETWEEN` zaehlte nicht als Bereich  → falscher Alarm „ohne Zeitraum"
 *   - `* 100.0` und `* 100::numeric` wurden nicht erkannt
 *   - `SELECT pek_gesamt AS pek` und aussen `sum(pek)` waesch den Namen
 *   - `NOT vergleichbar` galt als gesetzter Filter
 *   - `vergleichbar = false` galt als gesetzter Filter
 *   - `SELECT ... INTO neu` war ein SELECT
 *   - `set_config(...)` war eine Funktion wie jede andere
 */
import { loadModule, parseSync } from 'libpg-query'

let geladen = false

/** Einmal beim Start. Danach ist parsen synchron. */
export async function parserBereitstellen() {
  if (!geladen) { await loadModule(); geladen = true }
}

export type Knoten = Record<string, any>

/**
 * Alle Knoten des Baums, Tiefe zuerst, als [Typ, Inhalt].
 *
 * Der Baum ist durchgehend `{ Knotentyp: { ...felder } }`; Listen sind
 * gewoehnliche Arrays. Ein einziger Durchlauf reicht damit fuer alle Regeln,
 * statt je Regel neu zu suchen.
 */
export function* knoten(n: unknown): Generator<[string, Knoten]> {
  if (n === null || typeof n !== 'object') return
  if (Array.isArray(n)) { for (const k of n) yield* knoten(k); return }
  for (const [typ, inhalt] of Object.entries(n as Knoten)) {
    if (inhalt && typeof inhalt === 'object' && !Array.isArray(inhalt)) {
      yield [typ, inhalt as Knoten]
    }
    yield* knoten(inhalt)
  }
}

/** Der letzte Teil einer Spaltenangabe: `u.umsatz_netto` → `umsatz_netto`. */
export function spaltenname(ref: Knoten | undefined): string | null {
  const felder = ref?.fields
  if (!Array.isArray(felder)) return null
  const teile = felder.map((f: Knoten) => f?.String?.sval).filter(Boolean)
  return teile.length ? teile[teile.length - 1] : null
}

/** Der Name einer Funktion: `sum(...)` → `sum`, `pg_catalog.set_config` → `set_config`. */
export function funktionsname(fc: Knoten | undefined): string | null {
  const teile = (fc?.funcname ?? []).map((f: Knoten) => f?.String?.sval).filter(Boolean)
  return teile.length ? teile[teile.length - 1].toLowerCase() : null
}

/**
 * Eine Konstante lesen — auch hinter einem Typecast.
 *
 * `100`, `100.0` und `100::numeric` sind dieselbe Zahl; der Baum sieht fuer
 * jede anders aus. Wer nur `ival` liest, uebersieht zwei von dreien.
 */
export function konstante(n: Knoten | undefined): string | number | boolean | null {
  if (!n) return null
  if (n.TypeCast) return konstante(n.TypeCast.arg)
  const c = n.A_Const
  if (!c) return null
  if (c.ival) return c.ival.ival ?? 0
  if (c.fval) return Number(c.fval.fval)
  if (c.sval) return c.sval.sval
  if (c.boolval) return Boolean(c.boolval.boolval)
  return null
}

export type Zerlegung = {
  /** Angesprochene Relationen, so wie sie dastehen (`mart.umsatz_tag` oder nur `umsatz_tag`). */
  sichten: Set<string>
  /** Namen von CTEs — sie sehen wie Relationen aus, sind aber keine. */
  ctes: Set<string>
  /** Jede irgendwo verwendete Spalte. */
  spalten: Set<string>
  /** Spalten im GROUP BY. */
  gruppiert: Set<string>
  /** Spalten, die mit `=` gegen etwas gehalten werden. */
  gleichheit: Set<string>
  /** ... und gegen WELCHE Konstante. `vergleichbar = false` ist kein Filter auf true.
   *  Seit 23.09.2026 auch jede Konstante einer IN-Liste: `nummer IN (3500, 3501)`. */
  gleichheitWerte: Map<string, Set<string | number | boolean>>
  /**
   * Textkonstanten, gegen die eine Spalte verglichen wird — mit `=`, `IN`,
   * `LIKE`, `ILIKE`, `~` oder `~*`. Fuer Regeln, die am WERT haengen und
   * nicht an der Spalte: `zahlart ILIKE '%gluecksrad%'` auf den Bons fragt nach
   * etwas, das 96 gar nicht fuehrt.
   */
  textvergleich: Map<string, Set<string>>
  /** Spalten in einem Bereichsvergleich (`>=`, `<`, BETWEEN). */
  bereich: Set<string>
  /** Spalten, die POSITIV als Wahrheitswert stehen (`WHERE vergleichbar`, nicht `NOT vergleichbar`). */
  wahrheitswert: Set<string>
  /** Aggregate als [Funktion, Spalte] — durch Aliasse hindurch aufgeloest. */
  aggregate: [string, string | null][]
  /** Spalten, die mit 100 multipliziert oder geteilt werden. */
  mal_hundert: Set<string>
  /** Spalten, ueber die verbunden wird (ON/USING, oder Spalte = Spalte). */
  verbunden: Set<string>
  /** Alle aufgerufenen Funktionen, klein geschrieben. */
  funktionen: Set<string>
  /** Alias → zugrunde liegende Spalte, aus `spalte AS alias`. */
  aliasse: Map<string, string>
  /** `SELECT ... INTO` — legt eine Tabelle an. */
  select_into: boolean
  /** Etwas anderes als SELECT. */
  nur_select: boolean
  anweisungen: number
}

const AGGREGATE = new Set(['sum', 'avg', 'min', 'max', 'count', 'stddev', 'variance'])
const BEREICH_OPS = new Set(['>', '>=', '<', '<='])
const BEREICH_ARTEN = new Set(['AEXPR_BETWEEN', 'AEXPR_NOT_BETWEEN', 'AEXPR_BETWEEN_SYM', 'AEXPR_NOT_BETWEEN_SYM'])

/**
 * Spalten, die im WHERE POSITIV als Wahrheitswert stehen.
 *
 * Nur durch AND hindurch, nie durch NOT oder OR: `WHERE NOT vergleichbar`
 * ist das Gegenteil eines Filters auf vergleichbar, und `WHERE a OR
 * vergleichbar` garantiert ihn nicht.
 */
function wahrheitswerteAus(w: Knoten | undefined, ziel: Set<string>) {
  if (!w) return
  const n = spaltenname(w.ColumnRef)
  if (n) { ziel.add(n); return }
  if (w.BoolExpr?.boolop === 'AND_EXPR') {
    for (const arg of w.BoolExpr.args ?? []) wahrheitswerteAus(arg, ziel)
  }
}

/**
 * Die Abfrage einmal auseinandernehmen. Alles, was die Regeln brauchen,
 * entsteht hier in einem Durchlauf.
 */
export function zerlegen(sql: string): Zerlegung {
  const baum = parseSync(sql)
  const z: Zerlegung = {
    sichten: new Set(), ctes: new Set(), spalten: new Set(), gruppiert: new Set(),
    gleichheit: new Set(), gleichheitWerte: new Map(), textvergleich: new Map(), bereich: new Set(),
    wahrheitswert: new Set(), aggregate: [], mal_hundert: new Set(), verbunden: new Set(),
    funktionen: new Set(), aliasse: new Map(), select_into: false,
    nur_select: true, anweisungen: (baum.stmts ?? []).length,
  }

  for (const s of baum.stmts ?? []) {
    if (!s.stmt?.SelectStmt) z.nur_select = false
  }

  const merkeText = (spalte: string, w: string | number | boolean | null) => {
    if (typeof w !== 'string') return
    if (!z.textvergleich.has(spalte)) z.textvergleich.set(spalte, new Set())
    z.textvergleich.get(spalte)!.add(w)
  }

  const merkeGleichheit = (spalte: string, gegen: Knoten | undefined) => {
    z.gleichheit.add(spalte)
    // Eine IN-Liste ist eine Liste von Gleichheiten: jede Konstante darin
    // zaehlt. Vor dem 23.09.2026 fiel `nummer IN (3500, 3501, 3502)` hier
    // durch, weil konstante() eine Liste nicht lesen kann.
    const werte = Array.isArray(gegen?.List?.items) ? gegen!.List.items as Knoten[] : [gegen]
    for (const g of werte) {
      const w = konstante(g)
      if (w === null) continue
      if (!z.gleichheitWerte.has(spalte)) z.gleichheitWerte.set(spalte, new Set())
      z.gleichheitWerte.get(spalte)!.add(w)
      merkeText(spalte, w)
    }
  }

  for (const [typ, k] of knoten(baum)) {
    switch (typ) {
      case 'CommonTableExpr':
        if (k.ctename) z.ctes.add(k.ctename)
        break

      case 'RangeVar':
        if (k.relname) z.sichten.add(k.schemaname ? `${k.schemaname}.${k.relname}` : k.relname)
        break

      case 'ColumnRef': {
        const n = spaltenname(k)
        if (n && n !== '*') z.spalten.add(n)
        break
      }

      case 'ResTarget':
        // `spalte AS alias` — merken, damit ein Aggregat ueber den Alias
        // weiter aussen der Spalte zugeordnet werden kann.
        if (k.name && k.val?.ColumnRef) {
          const n = spaltenname(k.val.ColumnRef)
          if (n) z.aliasse.set(k.name, n)
        }
        break

      case 'FuncCall': {
        const f = funktionsname(k)
        if (!f) break
        z.funktionen.add(f)
        if (AGGREGATE.has(f)) {
          const erstes = (k.args ?? [])[0]
          z.aggregate.push([f, spaltenname(erstes?.ColumnRef)])
        }
        break
      }

      case 'A_Expr': {
        const op = (k.name ?? []).map((x: Knoten) => x?.String?.sval).filter(Boolean).join('')
        const links = spaltenname(k.lexpr?.ColumnRef)
        const rechts = spaltenname(k.rexpr?.ColumnRef)

        if (BEREICH_ARTEN.has(k.kind)) {
          if (links) z.bereich.add(links)
        } else if (links && (k.kind === 'AEXPR_LIKE' || k.kind === 'AEXPR_ILIKE'
                             || op === '~' || op === '~*')) {
          merkeText(links, konstante(k.rexpr))
        } else if (op === '=') {
          if (links) merkeGleichheit(links, k.rexpr)
          if (rechts) merkeGleichheit(rechts, k.lexpr)
          // Spalte gegen Spalte: das ist eine Verbindung, keine Auswahl.
          if (links && rechts) { z.verbunden.add(links); z.verbunden.add(rechts) }
        } else if (BEREICH_OPS.has(op)) {
          if (links) z.bereich.add(links)
          if (rechts) z.bereich.add(rechts)
        } else if (op === '*' || op === '/') {
          const hundert = (e: Knoten | undefined) => konstante(e) === 100
          if (hundert(k.lexpr) || hundert(k.rexpr)) {
            // Die Spalte kann direkt stehen oder tiefer: `100 * (a - b) / b`.
            for (const [t, kk] of knoten(hundert(k.lexpr) ? k.rexpr : k.lexpr)) {
              if (t === 'ColumnRef') { const n = spaltenname(kk); if (n) z.mal_hundert.add(n) }
            }
          }
        }
        break
      }

      case 'JoinExpr':
        for (const u of k.usingClause ?? []) {
          const n = u?.String?.sval
          if (n) z.verbunden.add(n)
        }
        break

      case 'SelectStmt':
        if (k.intoClause) z.select_into = true
        for (const g of k.groupClause ?? []) {
          const n = spaltenname(g?.ColumnRef)
          if (n) z.gruppiert.add(n)
        }
        wahrheitswerteAus(k.whereClause, z.wahrheitswert)
        break
    }
  }

  // CTE-Namen sind keine Sichten.
  for (const c of z.ctes) z.sichten.delete(c)

  // Aliasse aufloesen: was ueber den Alias aggregiert oder gruppiert wird,
  // zaehlt fuer die Spalte dahinter.
  const aufloesen = (n: string | null) => (n && z.aliasse.get(n)) || n
  z.aggregate = z.aggregate.map(([f, sp]) => [f, aufloesen(sp)])
  for (const menge of [z.gruppiert, z.gleichheit, z.bereich, z.mal_hundert, z.verbunden, z.spalten]) {
    for (const n of [...menge]) { const u = z.aliasse.get(n); if (u) menge.add(u) }
  }
  for (const [alias, spalte] of z.aliasse) {
    const w = z.gleichheitWerte.get(alias)
    if (w) z.gleichheitWerte.set(spalte, new Set([...(z.gleichheitWerte.get(spalte) ?? []), ...w]))
    const t = z.textvergleich.get(alias)
    if (t) z.textvergleich.set(spalte, new Set([...(z.textvergleich.get(spalte) ?? []), ...t]))
  }

  return z
}
