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

/** Der Name einer Funktion: `sum(...)` → `sum`. */
export function funktionsname(fc: Knoten | undefined): string | null {
  const teile = (fc?.funcname ?? []).map((f: Knoten) => f?.String?.sval).filter(Boolean)
  return teile.length ? teile[teile.length - 1].toLowerCase() : null
}

export type Zerlegung = {
  /** Angesprochene Sichten, voll qualifiziert (`mart.umsatz_tag`). */
  sichten: Set<string>
  /** Namen von CTEs — sie sehen wie Relationen aus, sind aber keine. */
  ctes: Set<string>
  /** Jede irgendwo verwendete Spalte. */
  spalten: Set<string>
  /** Spalten im GROUP BY. */
  gruppiert: Set<string>
  /** Spalten, die mit `=` gegen etwas gehalten werden. */
  gleichheit: Set<string>
  /** Spalten in einem Bereichsvergleich (`>=`, `<`, BETWEEN). */
  bereich: Set<string>
  /** Spalten, die blank als Wahrheitswert stehen (`WHERE vergleichbar`). */
  wahrheitswert: Set<string>
  /** Aggregate als [Funktion, Spalte] — `sum(u.umsatz)` → ['sum','umsatz']. */
  aggregate: [string, string | null][]
  /** Spalten, die mit 100 multipliziert oder geteilt werden. */
  mal_hundert: Set<string>
  /** Spalten, ueber die verbunden wird (ON/USING). */
  verbunden: Set<string>
  /** Mehr als eine Anweisung, oder etwas anderes als SELECT. */
  nur_select: boolean
  anweisungen: number
}

const AGGREGATE = new Set(['sum', 'avg', 'min', 'max', 'count', 'stddev', 'variance'])

/**
 * Die Abfrage einmal auseinandernehmen. Alles, was die Regeln brauchen,
 * entsteht hier in einem Durchlauf.
 */
export function zerlegen(sql: string): Zerlegung {
  const baum = parseSync(sql)
  const z: Zerlegung = {
    sichten: new Set(), ctes: new Set(), spalten: new Set(), gruppiert: new Set(),
    gleichheit: new Set(), bereich: new Set(), wahrheitswert: new Set(),
    aggregate: [], mal_hundert: new Set(), verbunden: new Set(),
    nur_select: true, anweisungen: (baum.stmts ?? []).length,
  }

  for (const s of baum.stmts ?? []) {
    // Nur SELECT. Alles andere faellt spaetestens an der Leserolle, aber
    // eine verstaendliche Meldung ist besser als "permission denied".
    if (!s.stmt?.SelectStmt) z.nur_select = false
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

      case 'FuncCall': {
        const f = funktionsname(k)
        if (f && AGGREGATE.has(f)) {
          const erstes = (k.args ?? [])[0]
          z.aggregate.push([f, spaltenname(erstes?.ColumnRef)])
        }
        break
      }

      case 'A_Expr': {
        const op = (k.name ?? []).map((x: Knoten) => x?.String?.sval).filter(Boolean).join('')
        const links = spaltenname(k.lexpr?.ColumnRef)
        const rechts = spaltenname(k.rexpr?.ColumnRef)

        if (op === '=') {
          if (links) z.gleichheit.add(links)
          if (rechts) z.gleichheit.add(rechts)
          // Spalte gegen Spalte: das ist eine Verbindung, keine Auswahl.
          if (links && rechts) { z.verbunden.add(links); z.verbunden.add(rechts) }
        } else if (['>', '>=', '<', '<='].includes(op)) {
          if (links) z.bereich.add(links)
          if (rechts) z.bereich.add(rechts)
        } else if (op === '*' || op === '/') {
          const hundert = (e: Knoten | undefined) =>
            e?.A_Const?.ival?.ival === 100 || e?.A_Const?.fval?.fval === '100'
          if (hundert(k.rexpr) && links) z.mal_hundert.add(links)
          if (hundert(k.lexpr) && rechts) z.mal_hundert.add(rechts)
          // Auch `100 * (a - b) / b`: dann steckt die Spalte tiefer.
          if (hundert(k.lexpr) || hundert(k.rexpr)) {
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
        for (const g of k.groupClause ?? []) {
          const n = spaltenname(g?.ColumnRef)
          if (n) z.gruppiert.add(n)
        }
        // Eine Spalte, die blank im WHERE steht, ist ein Wahrheitswert:
        // `WHERE vergleichbar` ist dasselbe wie `WHERE vergleichbar = true`.
        for (const w of [k.whereClause]) {
          const n = spaltenname(w?.ColumnRef)
          if (n) z.wahrheitswert.add(n)
          for (const arg of w?.BoolExpr?.args ?? []) {
            const m = spaltenname(arg?.ColumnRef)
            if (m) z.wahrheitswert.add(m)
          }
        }
        break
    }
  }

  // CTE-Namen sind keine Sichten.
  for (const c of z.ctes) z.sichten.delete(c)
  return z
}
