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
import { pool } from './db'
import type { Katalog } from './katalog'
import { pruefen, type Befund, type Pruefergebnis } from './pruefen'

/** Was das Modell sieht. Mehr sprengt den Kontext, bevor es etwas beantwortet. */
export const ZEILEN_FUER_MODELL = 500
/** Was die Ansicht bekommt. Eine Tabelle darf blaettern, ein Modell nicht. */
export const ZEILEN_FUER_ANSICHT = 5_000
/** Geschaetzte gelesene Zeilen, ab denen abgewiesen wird. */
export const ZEILEN_SCHAETZUNG_GRENZE = 5_000_000

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
}

export class Gesperrt extends Error {
  constructor(readonly pruefung: Pruefergebnis) {
    super('Die Abfrage wurde nicht ausgefuehrt.')
  }
}

/**
 * Wie viele Zeilen Postgres zu lesen erwartet.
 *
 * `EXPLAIN` ohne ANALYZE fuehrt nichts aus — es kostet nur die Planung.
 * Schlaegt es fehl (etwa weil eine Spalte nicht existiert), ist das kein
 * Grund, die Abfrage zu verweigern: derselbe Fehler kommt gleich mit einer
 * besseren Meldung aus der Ausfuehrung selbst.
 */
async function zeilenSchaetzen(sql: string, werte: unknown[]): Promise<number | null> {
  try {
    const r = await pool.query(`EXPLAIN (FORMAT JSON) ${sql}`, werte)
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

/** Eine bereits geprueft-sichere Abfrage ausfuehren und einpacken. */
async function laufenLassen(
  sql: string, werte: unknown[], pruefung: Pruefergebnis, nutzer: Nutzer,
  werkzeug: string, parameter: unknown,
): Promise<Ergebnis> {
  const start = Date.now()
  let r
  try {
    r = await pool.query({ text: sql, values: werte, rowMode: 'array' as never })
  } catch (e) {
    const meldung = String((e as Error)?.message ?? e)
    await protokollieren({ nutzer, werkzeug, parameter, sql, sichten: pruefung.sichten,
      dauer_ms: Date.now() - start, fehler: meldung })
    throw e
  }
  const dauer = Date.now() - start

  const spalten = (r.fields ?? []).map(f => f.name)
  const alle = (r.rows as unknown as unknown[][]).map(zeile => {
    const o: Record<string, unknown> = {}
    spalten.forEach((s, i) => { o[s] = zeile[i] })
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

  const protokoll_id = await protokollieren({
    nutzer, werkzeug, parameter, sql, sichten: pruefung.sichten, hinweise,
    zeilen: alle.length, dauer_ms: dauer,
  })

  return {
    zeilen, weitere, spalten,
    zeilen_gesamt: alle.length,
    abgeschnitten: alle.length > ZEILEN_FUER_MODELL,
    koernung: pruefung.koernung,
    hinweise, datenstand, dauer_ms: dauer, protokoll_id,
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

  const geschaetzt = await zeilenSchaetzen(sql, [])
  if (geschaetzt !== null && geschaetzt > ZEILEN_SCHAETZUNG_GRENZE) {
    const befund: Befund = {
      schluessel: 'zu_gross', schwere: 'sperre',
      hinweis:
        `Postgres schaetzt ${geschaetzt.toLocaleString('de-DE')} zu lesende Zeilen — die Grenze ` +
        `liegt bei ${ZEILEN_SCHAETZUNG_GRENZE.toLocaleString('de-DE')}. Der Server teilt sich die ` +
        `Maschine mit dem naechtlichen Import.`,
      berichtigung: 'Den Zeitraum eingrenzen oder im SQL zusammenfassen statt Einzelzeilen zu ziehen.',
    }
    const mit = { ...pruefung, erlaubt: false, befunde: [...pruefung.befunde, befund] }
    await protokollieren({ nutzer, werkzeug: 'abfrage_ausfuehren', sql,
      sichten: pruefung.sichten, hinweise: mit.befunde, gesperrt: true })
    throw new Gesperrt(mit)
  }

  return laufenLassen(sql, [], pruefung, nutzer, 'abfrage_ausfuehren', { sql })
}

/**
 * Einen Bericht ausfuehren.
 *
 * OHNE FALLSTRICK-PRUEFUNG, und das ist Absicht: die Abfrage stammt nicht
 * von einem Modell, sondern aus metabase/karten-*.ts — gebaut von denen,
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
  return laufenLassen(sql, werte, pruefung, nutzer, `bericht:${schluessel}`, parameter)
}

export { protokollieren }
