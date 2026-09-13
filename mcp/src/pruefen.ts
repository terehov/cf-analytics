/**
 * Die Pruefung vor dem Lauf.
 *
 * DER GRUND, WARUM ES DIESE DATEI GIBT. Von den Fehlern, die dieses Projekt
 * gemacht hat, hat sich fast keiner gemeldet: kein Stacktrace, kein roter
 * Test, nur eine Zahl, die plausibel aussieht und falsch ist
 * (docs/fehlerkatalog.md). Ein Sprachmodell, das SQL schreibt, trifft
 * dieselben Fallen schneller und oefter — und niemand prueft nach.
 *
 * Der dbt-Benchmark vom April 2026 misst denselben Unterschied an anderer
 * Stelle: mit semantischer Schicht steigt die Trefferquote von 90,0 % auf
 * 98,2 % (Sonnet 4.6) und von 84,1 % auf 100 % (GPT-5.3) — und wichtiger als
 * die Prozentpunkte ist die Art des Scheiterns. Ohne Schicht ist ein Fehler
 * eine selbstbewusst falsche Zahl, mit ihr eine Verweigerung. 81,2 % der
 * Text-to-SQL-Fehler liegen auf Schema- und Bedeutungsebene, nicht in der
 * Syntax — also genau dort, wo dieser Pruefer sitzt.
 *
 * ZWEI ARTEN VON REGELN:
 *
 *   fest        stehen hier im Code, weil sie nicht von Daten abhaengen:
 *               nur SELECT, nur erlaubte Schemata, keine Summe ueber einen
 *               Median, keine Aggregation ueber eine Sicht ohne Koernung.
 *   aus `mcp.fallstrick`   alles Fachliche. Eine neue Warnung ist eine
 *               Migration, kein Deploy (datenmodell.md, Entscheidung 5).
 *
 * EINE REGELART OHNE UMSETZUNG LAESST DEN SERVER NICHT STARTEN. Sonst
 * koennte eine Migration eine Wache eintragen, die nicht wacht — genau die
 * Sorte stiller Ausfall, gegen die harte Regel 10 geschrieben wurde.
 */
import { zerlegen, type Zerlegung } from './ast'
import type { Fallstrick, Katalog, Schwere } from './katalog'

export type Befund = {
  schluessel: string
  schwere: Schwere
  hinweis: string
  berichtigung?: string | null
  quelle?: string | null
}

export type Pruefergebnis = {
  erlaubt: boolean
  befunde: Befund[]
  sichten: string[]
  koernung: { sicht: string; koernung: string | null }[]
}

/** Die Schemata, die der Server ueberhaupt anfassen darf. */
export const ERLAUBTE_SCHEMATA = new Set(['mart', 'manual', 'ampel', 'mcp'])

// ---------------------------------------------------------------------
// Die Regelarten aus mcp.fallstrick
//
// Jede bekommt die Zerlegung, den Fallstrick und den Katalog und sagt, ob
// sie zutrifft. Sie entscheidet NICHT ueber die Schwere — die steht in den
// Daten, damit dieselbe Regelart einmal sperren und einmal warnen kann.
// ---------------------------------------------------------------------
type RegelImpl = (z: Zerlegung, f: Fallstrick, k: Katalog) => boolean

const betrifftSicht = (z: Zerlegung, f: Fallstrick) =>
  f.sicht === null || z.sichten.has(f.sicht)

export const REGELARTEN: Record<string, RegelImpl> = {
  /** Eine Spalte, die in den echten Daten ueberall NULL ist. */
  spalte_immer_null: (z, f) =>
    betrifftSicht(z, f) && z.spalten.has(f.parameter.spalte),

  /**
   * Eine Sicht, die ohne einen bestimmten Filter doppelt zaehlt oder
   * Unvergleichbares vergleicht. Ein blanker Wahrheitswert (`WHERE
   * vergleichbar`) zaehlt wie ein Gleichheitsfilter — sonst meldete die
   * Regel die richtige Abfrage als falsch.
   */
  filter_noetig: (z, f) => {
    if (!betrifftSicht(z, f)) return false
    const s = f.parameter.spalte
    if (f.parameter.wert !== undefined) {
      // Ein bestimmter Wert wird verlangt: `vergleichbar = true` oder blank
      // `WHERE vergleichbar`. `= false` und `NOT vergleichbar` sind das
      // Gegenteil und zaehlen nicht (Review 13.09.2026).
      const werte = z.gleichheitWerte.get(s)
      const positiv = werte?.has(f.parameter.wert) || z.wahrheitswert.has(s)
      return !positiv
    }
    return !z.gleichheit.has(s) && !z.wahrheitswert.has(s) && !z.bereich.has(s)
  },

  /** Verbindung ueber einen Anzeigenamen statt ueber den Schluessel. */
  join_ueber_name: (z, f) =>
    betrifftSicht(z, f) && z.verbunden.has(f.parameter.spalte),

  /**
   * Ein Mittelwert oder eine Zaehlung ueber Betriebe, ohne die Betriebe
   * ohne laufendes Geschaeft auszunehmen. Heuristik, deshalb Warnung: wer
   * mart.betrieb_status heranzieht oder auf den Status filtert, hat sich
   * offensichtlich Gedanken gemacht.
   */
  nenner_unvollstaendig: (z, f, k) => {
    if (!betrifftSicht(z, f)) return false
    const mittelt = z.aggregate.some(([fn]) => fn === 'avg' || fn === 'count')
    if (!mittelt) return false
    const ueberBetriebe = [...z.sichten].some(s => k.sichten.get(s)?.achsen.includes('betrieb_key'))
    if (!ueberBetriebe) return false
    const beruecksichtigt = z.sichten.has('mart.betrieb_status')
      || z.spalten.has('status') || z.spalten.has('laeuft') || z.spalten.has('hat_geschaeft')
    return !beruecksichtigt
  },

  /** Ein Prozentwert, der noch einmal mit 100 verrechnet wird. */
  prozent_skaliert: (z, f, k) => {
    if (!betrifftSicht(z, f)) return false
    for (const s of z.mal_hundert) {
      if (istProzentspalte(s, k)) return true
      if (/_pct$|^prozent|_prozent$/.test(s)) return true
    }
    return false
  },

  /** Eine grosse Tabelle ohne Einschraenkung auf einen Zeitraum. */
  zeitraum_noetig: (z, f) => {
    if (!betrifftSicht(z, f)) return false
    const s = f.parameter.spalte
    return !z.bereich.has(s) && !z.gleichheit.has(s)
  },

  /** Eine Achse, die nur fuer einen Teil der Betriebe gepflegt ist. */
  abdeckung_luecke: (z, f) =>
    z.spalten.has(f.parameter.achse) || z.gruppiert.has(f.parameter.achse),

  /** Eine Gruppierung ueber die falsche von zwei aehnlichen Spalten. */
  gruppierung_falsch: (z, f) =>
    betrifftSicht(z, f) && z.gruppiert.has(f.parameter.spalte),

  /**
   * Kein Strukturfehler, sondern eine Deutungsfalle: die Zahl stimmt, aber
   * sie bedeutet nicht, wonach sie aussieht. Trifft zu, sobald die Sicht
   * ueberhaupt vorkommt.
   */
  deutung: (z, f) => betrifftSicht(z, f),
}

function istProzentspalte(spalte: string, k: Katalog): boolean {
  for (const s of k.sichten.values()) {
    for (const kz of s.kennzahlen ?? []) {
      if (kz.spalte === spalte && kz.einheit === 'prozentzahl') return true
    }
  }
  return false
}

/**
 * Beim Start pruefen, dass jede Regelart in den Daten auch umgesetzt ist.
 * Wirft, wenn nicht — ein Server, dessen Wachen halb fehlen, soll gar nicht
 * erst laufen.
 */
export function regelartenPruefen(fallstricke: Fallstrick[]): void {
  const unbekannt = [...new Set(fallstricke.map(f => f.art))].filter(a => !(a in REGELARTEN))
  if (unbekannt.length) {
    throw new Error(
      `mcp.fallstrick nennt Regelarten, die dieser Server nicht umsetzt: ${unbekannt.join(', ')}. ` +
      `Entweder fehlt die Umsetzung in mcp/src/pruefen.ts, oder die Zeile gehoert auf aktiv = false. ` +
      `Ein Start mit halben Wachen waere schlimmer als keiner.`)
  }
}

// ---------------------------------------------------------------------
// Die Pruefung
// ---------------------------------------------------------------------

export function pruefen(sql: string, katalog: Katalog): Pruefergebnis {
  const befunde: Befund[] = []
  const sperre = (schluessel: string, hinweis: string, berichtigung?: string) =>
    befunde.push({ schluessel, schwere: 'sperre', hinweis, berichtigung })

  let z: Zerlegung
  try {
    z = zerlegen(sql)
  } catch (e) {
    return {
      erlaubt: false,
      befunde: [{
        schluessel: 'syntaxfehler', schwere: 'sperre',
        hinweis: `Die Abfrage ist kein gueltiges PostgreSQL: ${String((e as Error)?.message ?? e)}`,
      }],
      sichten: [], koernung: [],
    }
  }

  // --- feste Regeln -------------------------------------------------

  /**
   * Relationen OHNE Schema auf den Katalog abbilden.
   *
   * REVIEW 13.09.2026: `SELECT betrieb, sum(netto) FROM fremdeinkauf GROUP BY
   * betrieb` lief durch — die Regel fuer mart.fremdeinkauf sah nur
   * `fremdeinkauf` und erkannte ihre Sicht nicht; die Rolle hat mart im
   * search_path, also lief die Abfrage und zaehlte doppelt. Dieselbe Luecke
   * oeffnete `pg_stat_activity` und alles andere aus pg_catalog, das ohne
   * Schema erreichbar ist.
   *
   * Deshalb: ein Name ohne Schema wird zu `mart.<name>`, wenn es die Sicht im
   * Katalog gibt — und ist sonst gesperrt. Nicht geraten, nicht durchgelassen.
   */
  for (const s of [...z.sichten]) {
    if (s.includes('.')) continue
    const kandidat = `mart.${s}`
    z.sichten.delete(s)
    if (katalog.sichten.has(kandidat)) {
      z.sichten.add(kandidat)
    } else {
      z.sichten.add(s)
      sperre('sicht_ohne_schema',
        `"${s}" steht ohne Schema und ist keine bekannte mart-Sicht. Ohne Schema koennte das ` +
        `alles Moegliche sein — auch eine Systemtabelle.`,
        'Sichten immer mit Schema schreiben: mart.<name>. sichten_suchen findet den Namen.')
    }
  }

  /**
   * Funktionen, die nichts mit Auswerten zu tun haben.
   *
   * REVIEW 13.09.2026: `SELECT set_config('statement_timeout','0',false)` lief
   * durch den Pruefer — und die Einstellung ueberlebt in der Sitzung, die der
   * Pool an die naechste Abfrage weitergibt (gemessen: SHOW ergab danach 0).
   * Damit waere die Zeitgrenze der Rolle mit einer Zeile ausgehebelt gewesen.
   * `pg_sleep` haelt eine Verbindung fest, Advisory Locks halten andere fest,
   * die Dateifunktionen lesen den Server.
   *
   * Der zweite Riegel dagegen ist die Transaktion in ausfuehren.ts (ROLLBACK
   * nimmt set_config zurueck); dieser hier ist der erste, mit Meldung.
   */
  const VERBOTENE_FUNKTIONEN = new Set([
    'set_config', 'pg_sleep', 'pg_sleep_for', 'pg_sleep_until',
    'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf',
    'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file',
    'lo_import', 'lo_export', 'lo_get', 'lo_put', 'lo_unlink',
    'dblink', 'dblink_connect', 'dblink_exec', 'pg_notify',
    'pg_advisory_lock', 'pg_advisory_lock_shared', 'pg_advisory_xact_lock',
    'pg_advisory_xact_lock_shared', 'pg_try_advisory_lock', 'pg_try_advisory_xact_lock',
    'pg_try_advisory_lock_shared', 'pg_try_advisory_xact_lock_shared',
    'pg_export_snapshot', 'brin_summarize_new_values', 'query_to_xml',
  ])
  for (const f of z.funktionen) {
    if (VERBOTENE_FUNKTIONEN.has(f)) {
      sperre(`funktion_${f}`,
        `${f}() ist hier gesperrt: die Funktion wertet nichts aus, sie veraendert die Sitzung, ` +
        `haelt Verbindungen fest oder liest den Server.`)
    }
  }

  if (z.select_into) {
    sperre('select_into',
      'SELECT ... INTO legt eine Tabelle an. Der Zugang ist lesend; die Rolle wuerde es ' +
      'ohnehin verweigern, aber diese Meldung ist verstaendlicher.',
      'Das INTO weglassen.')
  }

  if (z.anweisungen !== 1) {
    sperre('eine_anweisung',
      `Genau eine Anweisung je Aufruf, gezaehlt wurden ${z.anweisungen}. Mehrere Anweisungen ` +
      `hintereinander sind der klassische Weg, an einer Pruefung vorbeizukommen.`)
  }
  if (!z.nur_select) {
    sperre('nur_select',
      'Nur SELECT und WITH. Der Zugang ist lesend — schreibend kaeme er ohnehin nicht durch die ' +
      'Leserolle, aber diese Meldung ist verstaendlicher als "permission denied".')
  }

  /**
   * Die Anmeldetabellen sind auch innerhalb von `mcp` tabu.
   *
   * Tragend ist der Rechteentzug in Migration 0102 — `mcp_leser` bekommt auf
   * diese Tabellen gar kein SELECT, Postgres antwortet mit „permission
   * denied". Diese Regel hier ersetzt das nicht, sie erklaert es: eine
   * verstaendliche Meldung ist besser als ein Rechtefehler, den das Modell
   * fuer einen Tippfehler haelt und dreimal umformuliert.
   */
  const ANMELDETABELLEN = new Set([
    'mcp.nutzer', 'mcp.oauth_client', 'mcp.oauth_code', 'mcp.oauth_token',
    'mcp.oauth_schluessel', 'mcp.anmeldung_protokoll',
  ])
  for (const s of z.sichten) {
    if (ANMELDETABELLEN.has(s)) {
      sperre('anmeldedaten',
        `${s} gehoert zur Anmeldung und ist fuer Abfragen gesperrt — dort liegen Passworthashes ` +
        `und der Signierschluessel. Die Leserolle hat darauf ohnehin kein Recht; diese Meldung ` +
        `sagt nur, warum.`,
        'Wer wissen will, wer den Zugang benutzt, nimmt mart.mcp_nutzung oder mart.mcp_anmeldung.')
    }
  }

  for (const s of z.sichten) {
    const schema = s.includes('.') ? s.split('.')[0] : null
    if (schema === null) {
      // Ohne Schema: kann nur eine erlaubte Sicht sein (search_path), sonst
      // faellt es an der Rolle. Nicht hier entscheiden.
      continue
    }
    if (!ERLAUBTE_SCHEMATA.has(schema)) {
      sperre('schema_gesperrt',
        `Das Schema "${schema}" ist fuer diesen Zugang gesperrt. Sichtbar sind ${[...ERLAUBTE_SCHEMATA].join(', ')}. ` +
        `In "mart" sind die Fallen ausgeraeumt, die "core" und "raw" still stellen — dort fuehrt ` +
        `core.umsatzbericht_tag zum Beispiel Gesamt- UND Hauptspartenzeilen in derselben Tabelle, ` +
        `eine Summe darueber ergibt den doppelten Umsatz.`,
        'Die passende mart-Sicht ueber sichten_suchen finden. Fehlt sie dort, ist das eine Luecke ' +
        'in mart — dann gehoert eine Sicht gebaut, keine Abfrage auf core.')
    }
  }

  // Aggregat ueber eine Spalte, die keine Aggregation vertraegt.
  for (const [fn, spalte] of z.aggregate) {
    if (!spalte) continue
    const regel = katalog.kennzahlRegel.get(spalte)
    if (!regel) continue
    const summierend = fn === 'sum' || fn === 'avg'
    if (!summierend) continue
    if (regel.regel === 'summe') continue
    if (regel.regel === 'mittel' && fn === 'avg') continue
    befunde.push({
      schluessel: `aggregat_${fn}_${spalte}`,
      schwere: 'sperre',
      hinweis:
        `${fn}(${spalte}) ist nicht zulaessig: die Spalte ist in ${regel.sicht} als "${regel.regel}" ` +
        `hinterlegt.` + (regel.hinweis ? ` ${regel.hinweis}` : ''),
      berichtigung: regel.regel === 'median'
        ? `Stattdessen den Median nehmen: percentile_cont(0.5) WITHIN GROUP (ORDER BY ${spalte}).`
        : regel.regel === 'letzter_stand'
        ? `Stattdessen die juengste Zeile nehmen (ORDER BY ... DESC LIMIT 1 oder DISTINCT ON).`
        : `Diese Spalte gar nicht zusammenfassen — sie je Zeile ausgeben.`,
    })
  }

  /**
   * Welche Sicht traegt diese Spalte?
   *
   * OHNE DIESE ZUORDNUNG UEBERSPERRT DER PRUEFER. Eine Abfrage, die
   * mart.nachbarschaft nur als Dimension danebenstellt, um an den Ort zu
   * kommen, summiert nicht AUS ihr — sie summiert aus mart.umsatz_tag.
   * Ohne Spaltenzuordnung schlug die Regel trotzdem an und sperrte genau
   * den Weg, den die Berichtigung der stadt-Regel vorschlaegt. Ein Pruefer,
   * der den richtigen Weg verbietet, ist kein Schutz.
   *
   * Mehrdeutig (die Spalte steht in mehreren beteiligten Sichten) heisst:
   * keine Zuordnung. Dann greift die Spaltenregel aus mcp.kennzahl, die
   * ohnehin die praezisere ist.
   */
  const quelleVon = (spalte: string): string | null => {
    const treffer = [...z.sichten].filter(s => katalog.sichten.get(s)?.spalten?.includes(spalte))
    return treffer.length === 1 ? treffer[0] : null
  }

  const koernung: Pruefergebnis['koernung'] = []
  for (const s of z.sichten) {
    const eintrag = katalog.sichten.get(s)
    if (!eintrag) continue
    koernung.push({ sicht: s, koernung: eintrag.koernung })

    // Aggregiert wird AUS dieser Sicht, wenn eine ihrer Spalten aggregiert wird.
    const aggregateDaraus = z.aggregate.filter(([, sp]) => sp && quelleVon(sp) === s)
    if (!aggregateDaraus.length) continue

    if (eintrag.koernung === null) {
      befunde.push({
        schluessel: `koernung_unbekannt_${s}`,
        schwere: 'warnung',
        hinweis:
          `Fuer ${s} ist nicht hinterlegt, wovon sie eine Zeile fuehrt. Eine Summe oder Zaehlung ` +
          `darueber kann deshalb nicht geprueft werden — sie koennte doppelt zaehlen, ohne dass ` +
          `es auffaellt.`,
        berichtigung: `Die Koernung gehoert nach mcp.sicht (Arbeitsliste: mcp.koernung_fehlend).`,
      })
    }

    /**
     * Die Sicht traegt keine summierbaren Kennzahlen — aber nur fuer
     * Spalten, fuer die KEINE eigene Regel hinterlegt ist. Sonst
     * widerspraechen sich die beiden Ebenen: mart.round_table_monat ist als
     * Ganzes nicht summierbar, sein umsatz_ist aber ausdruecklich doch
     * ("die einzige echte Summe dieser Sicht"). Die Spaltenregel ist die
     * praezisere und gewinnt; dieser Befund faengt den Rest.
     */
    if (eintrag.summen_erlaubt === false) {
      const ohneEigeneRegel = aggregateDaraus
        .filter(([fn]) => fn === 'sum' || fn === 'avg')
        .filter(([, sp]) => sp && !katalog.kennzahlRegel.has(sp))
        .map(([fn, sp]) => `${fn}(${sp})`)
      if (ohneEigeneRegel.length) {
        befunde.push({
          schluessel: `summe_ungeprueft_${s}`,
          schwere: 'warnung',
          hinweis:
            `${ohneEigeneRegel.join(', ')}: fuer ${s} ist hinterlegt, dass eine naive Summe ueber ` +
            `ihre Kennzahlen keine sinnvolle Zahl ergibt — sie fuehrt ` +
            `${eintrag.koernung ?? 'eine nicht hinterlegte Koernung'}, und ihre Werte sind ` +
            `Prozentwerte, Mediane oder Staende. Fuer diese Spalte ist keine eigene Regel hinterlegt.`,
          berichtigung: `Die Kennzahl aus der passenden Grundsicht rechnen, oder einzelne Zeilen ausgeben.`,
        })
      }
    }
  }

  // --- Regeln aus mcp.fallstrick ------------------------------------
  for (const f of katalog.fallstricke) {
    const impl = REGELARTEN[f.art]
    if (!impl) continue          // regelartenPruefen() hat beim Start gewarnt
    let trifft = false
    try { trifft = impl(z, f, katalog) } catch { trifft = false }
    if (!trifft) continue
    befunde.push({
      schluessel: f.schluessel, schwere: f.schwere, hinweis: f.hinweis,
      berichtigung: f.berichtigung, quelle: f.quelle,
    })
  }

  return {
    erlaubt: !befunde.some(b => b.schwere === 'sperre'),
    befunde,
    sichten: [...z.sichten],
    koernung,
  }
}
