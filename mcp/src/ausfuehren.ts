/**
 * Abfragen ausfuehren — mit Grenzen, Befund-Anhang und Protokoll.
 *
 * DIE DREI DINGE, DIE HIER PASSIEREN UND SONST NIRGENDS:
 *
 *   1. GRENZEN VOR DEM LAUF. `EXPLAIN` schaetzt, wie viele Zeilen gelesen
 *      wuerden. Eine Abfrage, die quer durch acht Jahre Artikelverkauf
 *      geht (20 Mio. Zeilen im Jahr), wird abgewiesen, bevor sie die
 *      Maschine beschaeftigt — nicht nach zwanzig Sekunden Zeitueberlauf.
 *
 *   2. DER BEFUND-ANHANG. Jede Antwort traegt die Fallstricke der beruehrten
 *      Sichten UND den Datenstand der betroffenen Betriebe bei sich. Nicht
 *      als Hoffnung, dass das Modell den Tabellenkommentar gelesen hat,
 *      sondern als Feld neben den Daten. Das ist harte Regel 10, angewandt
 *      auf Auswertungen: die stille Falle muss im Ergebnis sichtbar werden,
 *      nicht in einem Dokument, das niemand liest.
 *
 *   3. DAS PROTOKOLL. Eine Zahl, die im Round Table landet, muss
 *      rekonstruierbar sein — die Chat-Antwort ist kein Beleg, die Zeile in
 *      mcp.zugriff ist einer. Und: ein Dienst ohne Zulauf ist ein Fehler,
 *      kein Normalzustand.
 */
import type pg from 'pg'
import { pool } from './db'
import type { Katalog } from './katalog'
import { pruefen, type Befund, type Pruefergebnis } from './pruefen'
import { darstellungshinweis, spaltenBeschreiben, type SpalteInfo } from './spalten_info'

/** Was das Modell sieht. Mehr sprengt den Kontext, bevor es etwas beantwortet. */
export const ZEILEN_FUER_MODELL = 500
/** Was die Ansicht bekommt. Eine Tabelle darf blaettern, ein Modell nicht. */
export const ZEILEN_FUER_ANSICHT = 5_000
/** Geschaetzte gelesene Zeilen, ab denen abgewiesen wird. */
export const ZEILEN_SCHAETZUNG_GRENZE = 5_000_000
/** Zeichen je Zelle fuer das Modell. Ein Belegtext von 40 kB sprengt den Kontext genauso wie 40.000 Zeilen. */
export const ZELLE_MAX = 2_000

export type Nutzer = { subject: string | null; anzeige: string | null; client: string | null }

export type Datenstand = {
  umsatz_bis: string | null
  bwa_bis: string | null
  betriebe: number
  umsatz_veraltet: number
  bwa_im_rueckstand: number
}

export type Ergebnis = {
  zeilen: Record<string, unknown>[]
  spalten: string[]
  zeilen_gesamt: number
  abgeschnitten: boolean
  koernung: { sicht: string; koernung: string | null }[]
  hinweise: Befund[]
  datenstand: Datenstand | null
  dauer_ms: number
  protokoll_id: number | null
  /** Alles ueber ZEILEN_FUER_MODELL hinaus — nur fuer die Ansicht. */
  weitere: Record<string, unknown>[]
  /** Je Spalte: Rolle, Einheit, Wertevielfalt — damit das Modell die Form waehlen kann. */
  spalten_info: SpalteInfo[]
  /** Der Satz, der dem Modell die Darstellung ueberlaesst — samt der Fallen dabei. */
  darstellung: string
}

export class Gesperrt extends Error {
  constructor(readonly pruefung: Pruefergebnis) {
    super(gesperrtText(pruefung))
    this.name = 'Gesperrt'
  }
}

/**
 * Der Text, den das Modell zu sehen bekommt, wenn eine Abfrage nicht laeuft.
 *
 * DIESE FUNKTION IST DER PUNKT DES GANZEN PRUEFERS. Eine Sperre, die nur
 * „nicht ausgefuehrt" sagt, ist keine Verweigerung, sondern ein Raetsel: das
 * Modell formuliert dieselbe falsche Abfrage dreimal um und gibt dann auf
 * oder — schlimmer — weicht auf etwas aus, das laeuft und falsch ist. Der
 * Unterschied zwischen einer Verweigerung und einer selbstbewusst falschen
 * Zahl entsteht erst hier, im Text.
 *
 * Deshalb: jeder Grund einzeln, und wo es eine Berichtigung gibt, die
 * Berichtigung dazu. Beim Durchprobieren gefunden — der erste Entwurf warf
 * einen Satz ohne jeden Befund.
 */
export function gesperrtText(p: Pruefergebnis): string {
  const sperren = p.befunde.filter(b => b.schwere === 'sperre')
  const warnungen = p.befunde.filter(b => b.schwere === 'warnung')

  const zeilen = ['Die Abfrage wurde NICHT ausgefuehrt. Grund:']
  for (const b of sperren) {
    zeilen.push(`\n• ${b.hinweis}`)
    if (b.berichtigung) zeilen.push(`  So geht es stattdessen: ${b.berichtigung}`)
    if (b.quelle) zeilen.push(`  (Beleg: ${b.quelle})`)
  }
  if (warnungen.length) {
    zeilen.push('\nAusserdem zu beachten, sobald die Abfrage laeuft:')
    for (const b of warnungen) zeilen.push(`• ${b.hinweis}`)
  }
  zeilen.push(
    '\nDie Abfrage bitte berichtigen und erneut stellen — NICHT bloss anders formulieren: ' +
    'die Sperre haengt an der Bedeutung, nicht am Wortlaut. sicht_beschreiben nennt die ' +
    'Koernung und die Fallstricke der beteiligten Sichten.')
  return zeilen.join('\n')
}

/**
 * Wie viele Zeilen Postgres zu lesen erwartet.
 *
 * `EXPLAIN` ohne ANALYZE fuehrt nichts aus — es kostet nur die Planung.
 * Schlaegt es fehl (etwa weil eine Spalte nicht existiert), ist das kein
 * Grund, die Abfrage zu verweigern: derselbe Fehler kommt gleich mit einer
 * besseren Meldung aus der Ausfuehrung selbst.
 */
async function zeilenSchaetzen(c: pg.PoolClient, sql: string, werte: unknown[]): Promise<number | null> {
  try {
    const r = await c.query(`EXPLAIN (FORMAT JSON) ${sql}`, werte)
    const plan = (r.rows[0] as any)?.['QUERY PLAN']?.[0]?.Plan
    return typeof plan?.['Plan Rows'] === 'number' ? plan['Plan Rows'] : null
  } catch {
    return null
  }
}

/**
 * Den Datenstand der Betriebe holen, die im Ergebnis vorkommen.
 *
 * `mart.datenstand` beantwortet, welche Zeilen ueberhaupt beurteilbar sind:
 * LINA liefert 5–6 Tage nach, und die BWA steht je Betrieb unterschiedlich
 * weit. In Metabase ist das eine Karte, die man aufrufen KANN. Hier ist es
 * kein eigener Schritt — wer die Julizahlen eines Betriebs zieht, dessen
 * BWA bei Mai steht, sieht das in derselben Antwort.
 */
async function datenstandHolen(zeilen: Record<string, unknown>[]): Promise<Datenstand | null> {
  const schluessel = [...new Set(
    zeilen.map(z => z['betrieb_key']).filter(v => v !== null && v !== undefined),
  )].slice(0, 500)

  const wo = schluessel.length ? 'WHERE betrieb_key = ANY($1)' : ''
  const werte = schluessel.length ? [schluessel] : []
  try {
    const r = await pool.query(`
      SELECT max(letzter_tag)::text                                   AS umsatz_bis,
             max(bwa_monat)::text                                     AS bwa_bis,
             count(*)::int                                            AS betriebe,
             count(*) FILTER (WHERE umsatz_alter_tage > 8)::int        AS umsatz_veraltet,
             count(*) FILTER (WHERE bwa_verzug_monate > 1)::int        AS bwa_im_rueckstand
        FROM mart.datenstand ${wo}`, werte)
    const d = r.rows[0] as Datenstand | undefined
    return d && d.betriebe > 0 ? d : null
  } catch {
    // Kein Grund, die Antwort zu verlieren. Dass der Datenstand fehlt,
    // sieht man daran, dass er fehlt.
    return null
  }
}

/**
 * Ins Protokoll schreiben.
 *
 * WARUM HIER EINE SCHREIBENDE TRANSAKTION AUSDRUECKLICH ANGEFORDERT WIRD.
 * Die Rolle `mcp_leser` traegt `default_transaction_read_only = on`, damit
 * der Abfrageweg unter keinen Umstaenden schreibt. Das gilt auch fuer
 * diesen INSERT — deshalb wird die eine Transaktion, die schreiben DARF,
 * ausdruecklich umgestellt. Gefaehrlich ist das nicht: die Rolle hat
 * ueberhaupt nur auf mcp.zugriff ein INSERT-Recht, auf alles andere in
 * mart, manual und ampel nur SELECT. Die Rechte sind die Sperre, das
 * Lesezeichen ist der zweite Riegel — und der wird genau hier und nirgends
 * sonst gehoben.
 *
 * Scheitert das Protokoll, scheitert die Antwort NICHT: eine Auswertung
 * wegen eines fehlgeschlagenen Protokolleintrags zu verweigern waere die
 * falsche Reihenfolge. Aber es wird laut geloggt, denn ein Protokoll mit
 * Luecken ist kein Protokoll.
 */
async function protokollieren(e: {
  nutzer: Nutzer; werkzeug: string; parameter?: unknown; sql?: string | null
  sichten?: string[]; hinweise?: Befund[]; gesperrt?: boolean
  zeilen?: number | null; dauer_ms?: number | null; fehler?: string | null
}): Promise<number | null> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query('SET TRANSACTION READ WRITE')
    const r = await c.query(
      `INSERT INTO mcp.zugriff (subject, anzeige, client, werkzeug, parameter, sql,
                                sichten, hinweise, gesperrt, zeilen, dauer_ms, fehler)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING zugriff_id`,
      [e.nutzer.subject, e.nutzer.anzeige, e.nutzer.client, e.werkzeug,
       e.parameter ? JSON.stringify(e.parameter) : null, e.sql ?? null,
       e.sichten ?? null, e.hinweise ? JSON.stringify(e.hinweise) : null,
       e.gesperrt ?? false, e.zeilen ?? null, e.dauer_ms ?? null,
       e.fehler ? e.fehler.slice(0, 2000) : null])
    await c.query('COMMIT')
    return Number((r.rows[0] as any).zugriff_id)
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {})
    console.error(JSON.stringify({ t: new Date().toISOString(), stufe: 'error',
      msg: 'Protokolleintrag fehlgeschlagen — mcp.zugriff hat eine Luecke',
      werkzeug: e.werkzeug, fehler: String((err as Error)?.message ?? err).slice(0, 300) }))
    return null
  } finally {
    c.release()
  }
}

/**
 * Eine bereits geprueft-sichere Abfrage ausfuehren und einpacken.
 *
 * IN EINER EIGENEN TRANSAKTION, DIE ZURUECKGEROLLT WIRD — auch bei Erfolg.
 * REVIEW 13.09.2026: `set_config('statement_timeout','0',false)` in einer
 * Abfrage ueberlebte in der Sitzung, und der Pool reicht dieselbe Sitzung an
 * die naechste Abfrage weiter. Der Pruefer sperrt set_config seither, aber
 * eine Sperre im Pruefer ist eine Liste, und Listen haben Luecken. Die
 * Transaktion hat keine: Postgres nimmt bei ROLLBACK jede Einstellung
 * zurueck, die in der Transaktion gesetzt wurde — set_config eingeschlossen.
 *
 * `BEGIN READ ONLY` und `SET LOCAL statement_timeout` dazu: die Rolle setzt
 * beides ohnehin, aber hier steht es an der Abfrage selbst und haengt an
 * keiner Rolleneinstellung, die jemand spaeter aendert. `EXPLAIN` laeuft in
 * derselben Transaktion, damit auch er unter der Grenze steht.
 */
async function laufenLassen(
  sql: string, werte: unknown[], pruefung: Pruefergebnis, nutzer: Nutzer,
  werkzeug: string, parameter: unknown, schaetzen: boolean, katalog: Katalog,
): Promise<Ergebnis> {
  const start = Date.now()
  const c = await pool.connect()
  let r
  try {
    await c.query('BEGIN READ ONLY')
    await c.query(`SET LOCAL statement_timeout = '20s'`)

    if (schaetzen) {
      const geschaetzt = await zeilenSchaetzen(c, sql, werte)
      if (geschaetzt !== null && geschaetzt > ZEILEN_SCHAETZUNG_GRENZE) {
        await c.query('ROLLBACK').catch(() => {})
        const befund: Befund = {
          schluessel: 'zu_gross', schwere: 'sperre',
          hinweis:
            `Postgres schaetzt ${geschaetzt.toLocaleString('de-DE')} zu lesende Zeilen — die Grenze ` +
            `liegt bei ${ZEILEN_SCHAETZUNG_GRENZE.toLocaleString('de-DE')}. Der Server teilt sich die ` +
            `Maschine mit dem naechtlichen Import.`,
          berichtigung: 'Den Zeitraum eingrenzen oder im SQL zusammenfassen statt Einzelzeilen zu ziehen.',
        }
        const mit = { ...pruefung, erlaubt: false, befunde: [...pruefung.befunde, befund] }
        await protokollieren({ nutzer, werkzeug, sql, sichten: pruefung.sichten,
          hinweise: mit.befunde, gesperrt: true })
        throw new Gesperrt(mit)
      }
    }

    r = await c.query({ text: sql, values: werte, rowMode: 'array' as never })
    await c.query('ROLLBACK')
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    if (e instanceof Gesperrt) throw e
    const meldung = String((e as Error)?.message ?? e)
    await protokollieren({ nutzer, werkzeug, parameter, sql, sichten: pruefung.sichten,
      dauer_ms: Date.now() - start, fehler: meldung })
    throw e
  } finally {
    c.release()
  }
  const dauer = Date.now() - start

  const spalten = (r.fields ?? []).map(f => f.name)
  /**
   * ZAHLEN ALS ZAHLEN. pg liefert numeric (1700) und int8 (20) als Text,
   * damit der Importer beim Rechnen nichts verliert (src/db.ts). Ein Modell,
   * das die Daten darstellen soll, braucht das Gegenteil: "136612.46" ist
   * fuer ein Diagrammwerkzeug ein Wort, 136612.46 ist ein Wert. Der Verlust
   * jenseits von 2^53 spielt bei Eurobetraegen keine Rolle.
   */
  const numerisch = new Set((r.fields ?? []).map((f, i) => [f.dataTypeID, i] as const)
    .filter(([t]) => t === 1700 || t === 20).map(([, i]) => i))
  let gekuerzt = 0
  const alle = (r.rows as unknown as unknown[][]).map(zeile => {
    const o: Record<string, unknown> = {}
    spalten.forEach((s, i) => {
      const v = zeile[i]
      if (numerisch.has(i) && typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) o[s] = Number(v)
      else if (typeof v === 'string' && v.length > ZELLE_MAX) { gekuerzt++; o[s] = v.slice(0, ZELLE_MAX) + ' …' }
      else o[s] = v
    })
    return o
  })

  const zeilen = alle.slice(0, ZEILEN_FUER_MODELL)
  const weitere = alle.slice(ZEILEN_FUER_MODELL, ZEILEN_FUER_ANSICHT)
  const datenstand = await datenstandHolen(alle.slice(0, ZEILEN_FUER_ANSICHT))

  const hinweise = [...pruefung.befunde]
  if (alle.length > ZEILEN_FUER_MODELL) {
    hinweise.push({
      schluessel: 'abgeschnitten', schwere: 'warnung',
      hinweis:
        `${alle.length} Zeilen, gezeigt werden ${ZEILEN_FUER_MODELL}. Die Antwort ist damit ` +
        `KEINE vollstaendige Grundlage fuer eine Summe oder ein "am meisten" — was fehlt, ` +
        `steht nicht drin.`,
      berichtigung: 'Im SQL zusammenfassen (GROUP BY, sum, count) statt Einzelzeilen zu ziehen, ' +
        'oder den Zeitraum enger fassen.',
    })
  }
  if (gekuerzt > 0) {
    hinweise.push({
      schluessel: 'zellen_gekuerzt', schwere: 'warnung',
      hinweis: `${gekuerzt} Zelle(n) waren laenger als ${ZELLE_MAX} Zeichen und wurden abgeschnitten.`,
    })
  }

  const protokoll_id = await protokollieren({
    nutzer, werkzeug, parameter, sql, sichten: pruefung.sichten, hinweise,
    zeilen: alle.length, dauer_ms: dauer,
  })

  const spalten_info = spaltenBeschreiben(spalten, alle.slice(0, ZEILEN_FUER_ANSICHT), katalog, pruefung.sichten)

  return {
    zeilen, weitere, spalten,
    zeilen_gesamt: alle.length,
    abgeschnitten: alle.length > ZEILEN_FUER_MODELL,
    koernung: pruefung.koernung,
    hinweise, datenstand, dauer_ms: dauer, protokoll_id,
    spalten_info,
    darstellung: darstellungshinweis(spalten_info, alle.length),
  }
}

/**
 * Freies SQL: pruefen, schaetzen, ausfuehren.
 */
export async function abfrageAusfuehren(
  sql: string, katalog: Katalog, nutzer: Nutzer,
): Promise<Ergebnis> {
  const pruefung = pruefen(sql, katalog)

  if (!pruefung.erlaubt) {
    await protokollieren({ nutzer, werkzeug: 'abfrage_ausfuehren', sql,
      sichten: pruefung.sichten, hinweise: pruefung.befunde, gesperrt: true })
    throw new Gesperrt(pruefung)
  }

  return laufenLassen(sql, [], pruefung, nutzer, 'abfrage_ausfuehren', { sql }, true, katalog)
}

/**
 * Einen Bericht ausfuehren.
 *
 * OHNE FALLSTRICK-PRUEFUNG, und das ist Absicht: die Abfrage stammt nicht
 * von einem Modell, sondern aus den Kartendefinitionen (metabase/karten-*.ts) — gebaut von denen,
 * die das Schema kennen, statisch geprueft von uebernehmen.ts und in
 * metabase/karten.test.ts einzeln gegen Postgres gehalten. Eine Regel, die
 * hier anschluege, wuerde eine bewusste Entscheidung als Falle melden.
 *
 * Die Koernung und der Datenstand reisen trotzdem mit — sie sind kein
 * Vorwurf, sondern Einordnung.
 */
export async function berichtAusfuehren(
  schluessel: string, sql: string, werte: unknown[], sichten: string[],
  katalog: Katalog, nutzer: Nutzer, parameter: unknown,
): Promise<Ergebnis> {
  const pruefung: Pruefergebnis = {
    erlaubt: true, befunde: [], sichten,
    koernung: sichten
      .map(s => ({ sicht: s, koernung: katalog.sichten.get(s)?.koernung ?? null }))
      .filter(k => k.koernung !== null),
  }
  return laufenLassen(sql, werte, pruefung, nutzer, `bericht:${schluessel}`, parameter, false, katalog)
}

export { protokollieren }
