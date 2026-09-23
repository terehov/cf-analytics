/**
 * Betriebsberichte nach core schreiben — innerhalb der Transaktion von `laden()`,
 * NACH der Rohablage in `raw.api_antwort`.
 *
 * WARUM EIN EIGENER LADER UND KEIN `case` IM GROSSEN SWITCH. Die Konzernberichte
 * tragen alle 141 Betriebe in einer Antwort und legen sie über `betriebeSichern()`
 * an. Ein Betriebsbericht trägt keinen einzigen Betriebsbezug — wer er ist, steht
 * nur im Posten (`betrieb_enc_id`). Und statt eines Laders je Bericht gibt es hier
 * vier eigene (92, 88, 96, 97, Stufe A) und einen Spaltenplan je Stufe-B-Bericht.
 *
 * ERSETZEN STATT ANHÄNGEN. Jeder Abruf ersetzt, was für diesen Betrieb im
 * abgerufenen Zeitraum steht (DELETE im Zeitraum, dann INSERT). Die Zeilen der
 * Betriebsberichte haben keine stabile Kennung — `Rechnungsnummer` ist bei neun
 * Bons eines Tages 0, der Rabattbericht führt denselben Artikel zweimal (+3,50 und
 * −3,50) —, also ist der Schlüssel die laufende Nummer in der Antwort, und die ist
 * nur innerhalb EINES Abrufs eindeutig. raw bleibt append-only (Regel 4); core
 * ist daraus jederzeit neu aufbaubar.
 *
 * JEDER ABRUF HINTERLÄSST EINE ZEILE IN `core.betriebsbericht_abruf` mit LINAs
 * eigenen Summen (`nBillsGesamt`, `balanceSumBrutto`). Das ist die Gegenprobe aus
 * Plan 5.3: sie müssen den Konzern-Umsatzbericht desselben Betriebs und Zeitraums
 * treffen. Die Größe einer Antwort ist KEIN Beleg für Inhalt — der falsche Endpunkt
 * lieferte zwei Monate lang byte-gleiche 65.830 Byte voller Nullen.
 */
import type { PoolClient } from 'pg'
import * as bt from '../transform/betriebsbericht'
import { betriebsbericht } from '../lina/betriebsberichte'
import { log } from '../lib/log'
import { config } from '../config'
import { geschaeftstag } from '../lib/time'

type Kontext = {
  key: string
  von: string
  bis: string
  daten: unknown
  betriebEncId: string | null
  rawId: string
  /** Geschäftstag des Abrufs — nur für Tests; sonst der heutige. */
  heute?: string
}

/**
 * Ist ein Abruf VORLÄUFIG? (0120, 23.09.2026)
 *
 * Ja, wenn sein Zeitraum zum Zeitpunkt des Abrufs noch nicht reif war: das
 * Ende liegt weniger als BETRIEBSBERICHT_REIFE_TAGE vor dem Geschäftstag des
 * Abrufs. LINA füllt einen Tag erst nach fünf bis sieben Tagen vollständig
 * (0101) — die Zahlen der letzten Tage eines solchen Abrufs sind nicht
 * endgültig. Der reguläre Erstabruf holt nie vor der Reife (bis <= heute −
 * Reife) und ist deshalb nie vorläufig; vorläufig ist, was der Zweig
 * „laufender Monat" holt (97 bis zum Vortag).
 *
 * Ein vorläufiger Abruf zählt nicht in der Gegenprobe (`befund =
 * 'vorlaeufig'`), macht den Monat im Ladestand zu „teilweise" und wird von
 * `betriebsberichteNachfuellen()` nachgezogen, bis er endgültig ist.
 */
export function abrufVorlaeufig(bis: string, heute: string,
  reife: number = config.BETRIEBSBERICHT_REIFE_TAGE): boolean {
  const grenze = new Date(`${heute}T00:00:00Z`)
  grenze.setUTCDate(grenze.getUTCDate() - reife)
  return bis > grenze.toISOString().slice(0, 10)
}

/** Spaltenpläne der Stufe B — je Bericht eine Tabelle, die Felder aus der Vermessung vom 22.09.2026. */
const GELD = 'zahl' as const
export const SPALTENPLAENE: Record<string, bt.Spaltenplan> = {
  'getReport:39': {
    tabelle: 'core.storno_artikel_monat', zeit: 'monat',
    spalten: [
      { feld: 'Artikelnummer', spalte: 'artikelnummer', typ: 'ganz' },
      { feld: 'Artikel', spalte: 'artikel_name', typ: 'text' },
      { feld: 'Stornotyp', spalte: 'stornotyp', typ: 'text' },
      { feld: 'Stornogrund', spalte: 'stornogrund', typ: 'text' },
      { feld: 'Anzahl', spalte: 'anzahl', typ: 'zahl' },
      { feld: 'Umsatz_Brutto', spalte: 'umsatz_brutto', typ: GELD },
      { feld: 'Umsatz_Netto', spalte: 'umsatz_netto', typ: GELD },
    ],
  },
  'getReport:90': {
    tabelle: 'core.monatsaufstellung_tag', zeit: { feld: 'Datum' },
    spalten: [
      { feld: 'Anzahl', spalte: 'anzahl', typ: 'zahl' },
      { feld: 'Brutto', spalte: 'brutto', typ: GELD },
      { feld: 'Netto', spalte: 'netto', typ: GELD },
      { feld: 'Ust', spalte: 'ust', typ: GELD },
    ],
    rest: 'steuersaetze',
  },
  'getReport:108': {
    tabelle: 'core.verkaufszahlen_tag', zeit: { feld: 'Datum' },
    spalten: [
      { feld: 'Betrieb', spalte: 'betrieb_name_lina', typ: 'text' },
      { feld: 'Brutto', spalte: 'brutto', typ: GELD },
      { feld: 'Anzahl_Artikel', spalte: 'anzahl_artikel', typ: 'zahl' },
      { feld: 'Anzahl_Zahlungen', spalte: 'anzahl_zahlungen', typ: 'ganz' },
      { feld: 'Anzahl_Rechnungen', spalte: 'anzahl_rechnungen', typ: 'ganz' },
    ],
  },
  'getReport:99': {
    tabelle: 'core.unbar_zahlung_monat', zeit: 'monat',
    spalten: [
      { feld: 'Betriebsstelle', spalte: 'betriebsstelle', typ: 'text' },
      { feld: 'Finanzweg', spalte: 'finanzweg', typ: 'text' },
      { feld: 'Saldo', spalte: 'saldo', typ: GELD },
      { feld: 'Anzahl', spalte: 'anzahl', typ: 'zahl' },
    ],
    verdichten: { schluessel: ['betriebsstelle', 'finanzweg'], summen: ['saldo', 'anzahl'], anzahl_spalte: 'zahlungen' },
  },
  'getReport:60': {
    tabelle: 'core.kellner_umsatz_monat', zeit: 'monat',
    spalten: [
      { feld: 'Kellnernummer', spalte: 'kellnernummer', typ: 'ganz' },
      { feld: 'Kellner', spalte: 'kellner_name', typ: 'text' },
      { feld: 'Brutto', spalte: 'brutto', typ: GELD },
      { feld: 'Netto', spalte: 'netto', typ: GELD },
      { feld: 'Anzahl_Artikel', spalte: 'anzahl_artikel', typ: 'zahl' },
      { feld: 'Trinkgeld', spalte: 'trinkgeld', typ: GELD },
    ],
  },
  'getReport:61': {
    tabelle: 'core.kellner_umsatz_tag', zeit: 'monat',
    kopf: { feld: 'Tag', wenn: 'leer', kontext_spalte: 'kellner_block', kontext: 'nummer' },
    spalten: [
      { feld: 'Tag', spalte: 'geschaeftstag', typ: 'datum' },
      { feld: 'Brutto', spalte: 'brutto', typ: GELD },
      { feld: 'Netto', spalte: 'netto', typ: GELD },
      { feld: 'Anzahl_Artikel', spalte: 'anzahl_artikel', typ: 'zahl' },
      { feld: 'Trinkgeld', spalte: 'trinkgeld', typ: GELD },
    ],
  },
  'getReport:53': {
    tabelle: 'core.kellner_artikel_monat', zeit: 'monat',
    kopf: { feld: 'Artikelnummer', wenn: 'leer', kontext_spalte: 'kellner_block', kontext: 'nummer' },
    spalten: [
      { feld: 'Artikelnummer', spalte: 'artikelnummer', typ: 'ganz' },
      { feld: 'Artikelname', spalte: 'artikel_name', typ: 'text' },
      { feld: 'Brutto', spalte: 'brutto', typ: GELD },
      { feld: 'Netto', spalte: 'netto', typ: GELD },
      { feld: 'Anzahl_Artikel', spalte: 'anzahl_artikel', typ: 'zahl' },
    ],
  },
  'getReport:57': {
    tabelle: 'core.gutschrift_kellner', zeit: 'monat',
    spalten: [
      { feld: 'Kellnernummer', spalte: 'kellnernummer', typ: 'ganz' },
      { feld: 'Kellner', spalte: 'kellner_name', typ: 'text' },
      { feld: 'Datum', spalte: 'geschaeftstag', typ: 'datum' },
      { feld: 'Gutschriftnummer', spalte: 'gutschriftnummer', typ: 'ganz' },
      { feld: 'Rechnungsnummer', spalte: 'rechnungsnummer', typ: 'ganz' },
      { feld: 'Anzahl_Artikel', spalte: 'anzahl_artikel', typ: 'zahl' },
      { feld: 'Brutto', spalte: 'brutto', typ: GELD },
    ],
  },
  'getReport:68': {
    tabelle: 'core.betriebsstelle_umsatz_monat', zeit: 'monat',
    spalten: [
      { feld: 'Betriebsstelle', spalte: 'betriebsstelle', typ: 'text' },
      { feld: 'Umsatz_Brutto', spalte: 'umsatz_brutto', typ: GELD },
      { feld: 'Umsatz_Netto', spalte: 'umsatz_netto', typ: GELD },
      { feld: 'Anzahl_Artikel', spalte: 'anzahl_artikel', typ: 'zahl' },
      { feld: 'Anzahl_Gäste', spalte: 'anzahl_gaeste', typ: 'zahl' },
      { feld: 'Pro_Kopf_Netto', spalte: 'pro_kopf_netto', typ: GELD },
    ],
  },
  'getReport:69': {
    tabelle: 'core.betriebsstelle_hauptsparte_monat', zeit: 'monat',
    spalten: [
      { feld: 'Betriebsstelle', spalte: 'betriebsstelle', typ: 'text' },
      { feld: 'Hauptsparte', spalte: 'hauptsparte', typ: 'text' },
      { feld: 'Umsatz_Brutto', spalte: 'umsatz_brutto', typ: GELD },
      { feld: 'Umsatz_Netto', spalte: 'umsatz_netto', typ: GELD },
      { feld: 'Anzahl_Artikel', spalte: 'anzahl_artikel', typ: 'zahl' },
    ],
  },
  'getReport:112': {
    tabelle: 'core.verkaufsstelle_umsatz_monat', zeit: 'monat',
    spalten: [
      { feld: 'Verkaufsstelle', spalte: 'verkaufsstelle', typ: 'text' },
      { feld: 'Umsatz_Brutto', spalte: 'umsatz_brutto', typ: GELD },
      { feld: 'Umsatz_Netto', spalte: 'umsatz_netto', typ: GELD },
      { feld: 'Anzahl', spalte: 'anzahl', typ: 'zahl' },
      { feld: 'Anzahl_Gäste', spalte: 'anzahl_gaeste', typ: 'zahl' },
      { feld: 'Pro_Kopf_Netto', spalte: 'pro_kopf_netto', typ: GELD },
    ],
  },
  'getReport:71': {
    tabelle: 'core.verkaufsstelle_hauptsparte_monat', zeit: 'monat',
    spalten: [
      { feld: 'Verkaufsstelle', spalte: 'verkaufsstelle', typ: 'text' },
      { feld: 'Hauptsparte', spalte: 'hauptsparte', typ: 'text' },
      { feld: 'Anzahl', spalte: 'anzahl', typ: 'zahl' },
      { feld: 'Umsatz_Brutto', spalte: 'umsatz_brutto', typ: GELD },
      { feld: 'Umsatz_Netto', spalte: 'umsatz_netto', typ: GELD },
    ],
  },
  'getReport:75': {
    tabelle: 'core.zeitzone_feinsparte_monat', zeit: 'monat',
    kopf: { feld: 'Zeitzone', wenn: 'kein_muster', muster: /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/,
            kontext_spalte: 'feinsparte', kontext: 'text' },
    spalten: [
      { feld: 'Zeitzone', spalte: 'zeitzone', typ: 'text' },
      { feld: 'Brutto', spalte: 'brutto', typ: GELD },
      { feld: 'Netto', spalte: 'netto', typ: GELD },
      { feld: 'Durchschnitt_pro_Tag', spalte: 'durchschnitt_pro_tag', typ: GELD },
    ],
  },
  'getReport:76': {
    tabelle: 'core.zeitzone_hauptsparte_monat', zeit: 'monat',
    kopf: { feld: 'Zeitzone', wenn: 'kein_muster', muster: /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/,
            kontext_spalte: 'hauptsparte', kontext: 'text' },
    spalten: [
      { feld: 'Zeitzone', spalte: 'zeitzone', typ: 'text' },
      { feld: 'Brutto', spalte: 'brutto', typ: GELD },
      { feld: 'Netto', spalte: 'netto', typ: GELD },
      { feld: 'Durchschnitt_pro_Tag', spalte: 'durchschnitt_pro_tag', typ: GELD },
    ],
  },
  'getReport:86': {
    tabelle: 'core.debitor_bon', zeit: { feld: 'Datum' },
    spalten: [
      { feld: 'Rechnungsnummer', spalte: 'rechnungsnummer', typ: 'ganz' },
      { feld: 'Rechnung/Gutschrift', spalte: 'art', typ: 'text' },
      { feld: 'Anzahl_Artikel', spalte: 'anzahl_artikel', typ: 'ganz' },
      { feld: 'Finanzwege', spalte: 'finanzwege', typ: 'liste' },
      { feld: 'Brutto', spalte: 'brutto', typ: GELD },
      { feld: 'Debitor', spalte: 'debitor', typ: 'text' },
      { feld: 'Debitor_-_Anschrift', spalte: 'debitor_anschrift', typ: 'text' },
    ],
  },
  'getReport:113': {
    tabelle: 'core.tischtransfer_bon', zeit: { feld: 'Datum' },
    spalten: [
      { feld: 'Rechnungsnummer', spalte: 'rechnungsnummer', typ: 'ganz' },
      { feld: 'TischId', spalte: 'tisch_id', typ: 'ganz' },
      { feld: 'Rechnung/Butschrift', spalte: 'art', typ: 'text' },
      { feld: 'Anzahl_Artikel', spalte: 'anzahl_artikel', typ: 'ganz' },
      { feld: 'Finanzwege', spalte: 'finanzwege', typ: 'liste' },
      { feld: 'Brutto', spalte: 'brutto', typ: GELD },
      { feld: 'Status', spalte: 'status', typ: 'text' },
      { feld: 'Versuche', spalte: 'versuche', typ: 'text' },
      { feld: 'Antwort', spalte: 'antwort', typ: 'text' },
    ],
  },
}

/** Berichte mit eigenem Lader (Stufe A). */
const EIGENE_LADER = ['getReport:92', 'getReport:88', 'getReport:96', 'getReport:97'] as const

/**
 * Welche Betriebsberichte einen Ladeweg haben. Der Wächter
 * (`src/sync/waechter.ts`) prüft jeden aktiven Betriebsbericht dagegen — ein
 * Bericht ohne Ladeweg schriebe raw, meldete „ok" und transformierte nichts.
 */
export const GELADENE_BETRIEBSBERICHTE: ReadonlySet<string> =
  new Set([...EIGENE_LADER, ...Object.keys(SPALTENPLAENE)])

/** Partitionierte Tabellen: vor dem Schreiben die Monate anlegen, die betroffen sind. */
const PARTITIONIERT = new Set([
  'core.rabatt_artikel_tag', 'core.finanzweg_tag', 'core.bon', 'core.kellner_artikel_monat',
])

const SQL_TYP: Record<bt.Spaltentyp, string> = {
  text: 'text', ganz: 'bigint', zahl: 'numeric', datum: 'date', liste: 'text[]',
}

/** Monatserste zwischen zwei ISO-Daten (inklusive). */
function monate(von: string, bis: string): string[] {
  const out: string[] = []
  const d = new Date(`${von.slice(0, 7)}-01T00:00:00Z`)
  const ende = new Date(`${bis.slice(0, 7)}-01T00:00:00Z`)
  while (d <= ende) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  return out
}

async function partitionen(c: PoolClient, tabelle: string, von: string, bis: string) {
  if (!PARTITIONIERT.has(tabelle)) return
  for (const m of monate(von, bis)) {
    await c.query(`SELECT core.partition_anlegen($1::regclass, $2::date)`, [tabelle, m])
  }
}

/**
 * Zeilen über jsonb_to_recordset schreiben — eine Rundreise je Antwort, auch
 * bei den 2.658 Bons einer Woche. `spalten` nennt Name und SQL-Typ.
 */
async function einfuegen(
  c: PoolClient, tabelle: string, feste: Record<string, unknown>,
  spalten: [string, string][], zeilen: Record<string, unknown>[],
): Promise<number> {
  if (zeilen.length === 0) return 0
  const fest = Object.keys(feste)
  const namen = [...fest, ...spalten.map(s => s[0])]
  const werte = fest.map((_, i) => `$${i + 2}`)
  const r = await c.query(
    `INSERT INTO ${tabelle} (${namen.join(', ')})
     SELECT ${[...werte, ...spalten.map(s => `x.${s[0]}`)].join(', ')}
       FROM jsonb_to_recordset($1::jsonb) AS x(${spalten.map(s => `${s[0]} ${s[1]}`).join(', ')})`,
    [JSON.stringify(zeilen), ...fest.map(k => feste[k])])
  return r.rowCount ?? 0
}

async function abweichungMelden(c: PoolClient, key: string, erwartet: unknown, tatsaechlich: unknown) {
  await c.query(
    `INSERT INTO sync.schema_abweichung (endpunkt, erwartet, tatsaechlich) VALUES ($1, $2, $3)`,
    [key, JSON.stringify(erwartet), JSON.stringify(tatsaechlich)])
}

/**
 * Finanzwegnummern an den Rabattzeilen nachtragen.
 *
 * 92 kennt nur den NAMEN des Finanzwegs. Die Nummer steht in 88 bzw. 97
 * desselben Betriebs und Zeitraums — dort sind Name und Nummer ein Paar. Weil
 * die Berichte in beliebiger Reihenfolge ankommen, ruft BEIDE Seiten diese
 * Funktion auf: wer zuletzt kommt, trägt nach. Aufgelöst wird nur ein Name, der
 * im Zeitraum genau EINE Nummer hat (zwei „25 % Glücksrad" unterscheiden sich
 * am Apostroph, sind also zwei Namen — gemessen 22.09.2026).
 */
async function rabattNummernAufloesen(c: PoolClient, betriebKey: number, von: string, bis: string) {
  await c.query(
    `UPDATE core.rabatt_artikel_tag r
        SET finanzweg_nummer = f.nummer
       FROM (SELECT finanzweg_name, min(finanzweg_nummer) AS nummer,
                    count(DISTINCT finanzweg_nummer) AS nummern
               FROM core.finanzweg_tag
              WHERE betrieb_key = $1 AND geschaeftstag BETWEEN $2::date AND $3::date
              GROUP BY finanzweg_name) f
      WHERE r.betrieb_key = $1 AND r.geschaeftstag BETWEEN $2::date AND $3::date
        AND r.finanzweg_nummer IS NULL
        AND f.nummern = 1 AND f.finanzweg_name = r.finanzweg_name`,
    [betriebKey, von, bis])
}

/** Den Finanzweg-Stamm fortschreiben — es gibt keine andere Quelle (Plan 4.1). */
async function finanzwegStamm(c: PoolClient, zeilen: bt.FinanzwegZeile[], tagErsatz: string) {
  if (zeilen.length === 0) return
  const je = new Map<string, bt.FinanzwegZeile & { tag: string }>()
  for (const z of zeilen) {
    const tag = z.geschaeftstag ?? tagErsatz
    je.set(`${z.nummer}|${z.name}|${z.gruppe}|${tag.slice(0, 7)}`, { ...z, tag })
  }
  const liste = [...je.values()].map(z => ({
    nummer: z.nummer, name: z.name, finanzgruppe: z.gruppe, tag: z.tag,
    art: bt.finanzwegArt(z.gruppe), prozentsatz: bt.prozentAusName(z.name),
  }))
  await c.query(
    `INSERT INTO core.finanzweg AS f
       (nummer, name, finanzgruppe, art, prozentsatz, erstmals_gesehen, zuletzt_gesehen)
     SELECT DISTINCT ON (x.nummer) x.nummer, x.name, x.finanzgruppe, x.art, x.prozentsatz, x.tag, x.tag
       FROM jsonb_to_recordset($1::jsonb)
            AS x(nummer int, name text, finanzgruppe text, art text, prozentsatz numeric, tag date)
      ORDER BY x.nummer, x.tag DESC
     ON CONFLICT (nummer) DO UPDATE SET
       -- Der Name des JUENGSTEN Datenstands gewinnt, nicht der des letzten
       -- Abrufs: der Backfill laeuft rueckwaerts und brächte sonst alte Namen.
       name         = CASE WHEN excluded.zuletzt_gesehen >= f.zuletzt_gesehen THEN excluded.name ELSE f.name END,
       finanzgruppe = CASE WHEN excluded.zuletzt_gesehen >= f.zuletzt_gesehen THEN excluded.finanzgruppe ELSE f.finanzgruppe END,
       art          = CASE WHEN excluded.zuletzt_gesehen >= f.zuletzt_gesehen THEN excluded.art ELSE f.art END,
       prozentsatz  = CASE WHEN excluded.zuletzt_gesehen >= f.zuletzt_gesehen THEN excluded.prozentsatz ELSE f.prozentsatz END,
       erstmals_gesehen = least(f.erstmals_gesehen, excluded.erstmals_gesehen),
       zuletzt_gesehen  = greatest(f.zuletzt_gesehen, excluded.zuletzt_gesehen)`,
    [JSON.stringify(liste)])
  await c.query(
    `INSERT INTO core.finanzweg_stand (nummer, monat, name, finanzgruppe)
     SELECT DISTINCT x.nummer, date_trunc('month', x.tag)::date, x.name, coalesce(x.finanzgruppe, '')
       FROM jsonb_to_recordset($1::jsonb) AS x(nummer int, name text, finanzgruppe text, tag date)
     ON CONFLICT DO NOTHING`,
    [JSON.stringify(liste)])
}

/** Finanzwegzeilen schreiben (88 oder 97). Doppelte Nummern je Tag werden summiert und gemeldet. */
async function finanzwegeSchreiben(
  c: PoolClient, key: string, bericht: number, betriebKey: number, von: string, bis: string,
  zeilen: bt.FinanzwegZeile[], rawId: string,
): Promise<number> {
  await partitionen(c, 'core.finanzweg_tag', von, bis)
  await c.query(
    `DELETE FROM core.finanzweg_tag
      WHERE betrieb_key = $1 AND bericht = $2 AND geschaeftstag BETWEEN $3::date AND $4::date`,
    [betriebKey, bericht, von, bis])
  const je = new Map<string, Record<string, unknown>>()
  let doppelt = 0
  for (const z of zeilen) {
    const tag = z.geschaeftstag ?? von
    const zb = z.geschaeftstag ?? bis
    const k = `${tag}|${zb}|${z.nummer}`
    const alt = je.get(k)
    if (alt) {
      doppelt++
      alt.umsatz = Number(alt.umsatz ?? 0) + (z.umsatz ?? 0)
      alt.anzahl = Number(alt.anzahl ?? 0) + (z.anzahl ?? 0)
      continue
    }
    je.set(k, {
      geschaeftstag: tag, zeitraum_bis: zb, finanzweg_nummer: z.nummer, finanzweg_name: z.name,
      finanzgruppe: z.gruppe, abschnitt: z.abschnitt, umsatz: z.umsatz, anzahl: z.anzahl,
    })
  }
  if (doppelt > 0) {
    await abweichungMelden(c, key, { hinweis: 'eine Finanzwegnummer je Tag und Antwort' },
      { betrieb_key: betriebKey, von, bis, doppelt, raw_id: rawId })
  }
  const n = await einfuegen(c, 'core.finanzweg_tag',
    { betrieb_key: betriebKey, bericht, raw_id: rawId },
    [['geschaeftstag', 'date'], ['zeitraum_bis', 'date'], ['finanzweg_nummer', 'integer'],
     ['finanzweg_name', 'text'], ['finanzgruppe', 'text'], ['abschnitt', 'text'],
     ['umsatz', 'numeric'], ['anzahl', 'numeric']],
    [...je.values()])
  await finanzwegStamm(c, zeilen, von)
  await rabattNummernAufloesen(c, betriebKey, von, bis)
  return n
}

export async function betriebsberichtSchreiben(c: PoolClient, k: Kontext): Promise<number> {
  const bb = betriebsbericht(k.key)
  if (!bb) throw new Error(`${k.key}: nicht im Register der Betriebsberichte`)
  if (!k.betriebEncId) {
    throw new Error(`${k.key}: Posten ohne betrieb_enc_id — ein Betriebsbericht ohne Betrieb `
      + 'liefe gegen den Sitzungsbetrieb und schriebe fremde Zahlen')
  }
  const b = await c.query(`SELECT betrieb_key FROM core.betrieb WHERE enc_id = $1`, [k.betriebEncId])
  if (!b.rows[0]) throw new Error(`${k.key}: Betrieb ${k.betriebEncId} fehlt in core.betrieb`)
  const betriebKey = Number(b.rows[0].betrieb_key)
  const h = bt.berichtEntpacken(k.daten)
  const { von, bis, rawId } = k
  let geschrieben = 0

  switch (k.key) {
    case 'getReport:92': {
      await partitionen(c, 'core.rabatt_artikel_tag', von, bis)
      await c.query(
        `DELETE FROM core.rabatt_artikel_tag
          WHERE betrieb_key = $1 AND geschaeftstag BETWEEN $2::date AND $3::date`,
        [betriebKey, von, bis])
      const { zeilen, koepfe } = bt.rabattbericht(h)
      geschrieben = await einfuegen(c, 'core.rabatt_artikel_tag',
        { betrieb_key: betriebKey, geschaeftstag: von, zeitraum_bis: bis, raw_id: rawId },
        [['zeile', 'integer'], ['gruppe', 'integer'], ['finanzweg_name', 'text'],
         ['artikel_name', 'text'], ['anzahl', 'numeric'], ['brutto', 'numeric'], ['netto', 'numeric']],
        zeilen.map(z => ({
          zeile: z.zeile, gruppe: z.gruppe, finanzweg_name: z.finanzwegName,
          artikel_name: z.artikelName, anzahl: z.anzahl, brutto: z.brutto, netto: z.netto,
        })))
      /*
       * Die Summe der Zeilen trifft den Gruppenkopf — in allen 197 Gruppen der
       * 14 Wilma-Wunder-Betriebe im August (22.09.2026). Weicht sie ab, hat
       * sich die Kopferkennung oder LINAs Aufbau geändert: dann ist eine
       * Gruppengrenze verrutscht, und Artikel landen beim falschen Finanzweg.
       */
      const schief = koepfe.filter(g =>
        (g.kopfAnzahl !== null && Math.abs(g.kopfAnzahl - g.summeAnzahl) > 0.001)
        || (g.kopfBrutto !== null && Math.abs(g.kopfBrutto - g.summeBrutto) > 0.01))
      if (schief.length > 0) {
        await abweichungMelden(c, k.key, { hinweis: 'Summe der Artikelzeilen = Gruppenkopf' },
          { betrieb_key: betriebKey, von, bis, raw_id: rawId, gruppen: schief.slice(0, 10) })
      }
      /*
       * artikel_key ueber den Namen — nur gegen Artikel, die DIESER Betrieb im
       * selben Zeitraum verkauft hat (core.artikelverkauf_tag), und nur bei
       * genau einem Treffer. Artikelnummern sind je Konzept vergeben; derselbe
       * Name kommt in mehreren Konzepten vor. core.artikel_name_norm und nicht
       * core.name_norm: die streicht am Wortende "kg" (0094).
       */
      await c.query(
        `UPDATE core.rabatt_artikel_tag r
            SET artikel_key = m.artikel_key
           FROM (SELECT core.artikel_name_norm(a.name) AS n,
                        min(a.artikel_key) AS artikel_key,
                        count(DISTINCT a.artikel_key) AS treffer
                   FROM core.artikelverkauf_tag v
                   JOIN core.artikel a USING (artikel_key)
                  WHERE v.betrieb_key = $1 AND v.geschaeftstag BETWEEN $2::date AND $3::date
                  GROUP BY 1) m
          WHERE r.betrieb_key = $1 AND r.geschaeftstag = $2::date AND r.zeitraum_bis = $3::date
            AND r.artikel_name IS NOT NULL AND m.treffer = 1
            AND core.artikel_name_norm(r.artikel_name) = m.n`,
        [betriebKey, von, bis])
      await rabattNummernAufloesen(c, betriebKey, von, bis)
      break
    }

    case 'getReport:88': {
      geschrieben = await finanzwegeSchreiben(c, k.key, 88, betriebKey, von, bis, bt.finanzwege(h), rawId)
      break
    }

    case 'getReport:97': {
      /*
       * Zwei Blockarten je Tag. Der Finanzwegblock landet in derselben Tabelle
       * wie Bericht 88 — mit bericht = 97, denn es sind dieselben Zahlen aus
       * einer zweiten Quelle (gemessen 22.09.2026: alle 34 Finanzwege über den
       * Monat auf den Cent gleich). Wer summiert, waehlt EINE Quelle.
       */
      const fw = bt.finanzwege(h, true)
      const ohneTag = fw.filter(z => z.geschaeftstag === null).length
      if (ohneTag > 0) {
        await abweichungMelden(c, k.key, { hinweis: '97 liefert je Tag einen eigenen Block (interval=3)' },
          { betrieb_key: betriebKey, von, bis, raw_id: rawId, zeilen_ohne_tag: ohneTag })
      }
      /*
       * NUR TAGE IM ANGEFRAGTEN ZEITRAUM (0120). Seit der Teilmonat jede
       * Nacht geholt wird, ersetzt ein Abruf genau von..bis (DELETE+INSERT).
       * Ein Block ausserhalb wuerde neben einem anderen Abruf stehen, den
       * kein DELETE dieses Postens trifft — also doppelt. LINA liefert so
       * etwas nicht (gemessen: 31 Tage auf 31 Tage); kaeme es doch, wird es
       * gemeldet und nicht geschrieben.
       */
      const imFenster = (tag: string | null) => tag !== null && tag >= von && tag <= bis
      const sparten = bt.tagesabschlussSparten(h)
      const draussen = fw.filter(z => z.geschaeftstag !== null && !imFenster(z.geschaeftstag)).length
        + sparten.filter(z => !imFenster(z.geschaeftstag)).length
      if (draussen > 0) {
        await abweichungMelden(c, k.key, { hinweis: '97 liefert nur Tage im angefragten Zeitraum' },
          { betrieb_key: betriebKey, von, bis, raw_id: rawId, zeilen_ausserhalb: draussen })
      }
      geschrieben += await finanzwegeSchreiben(c, k.key, 97, betriebKey, von, bis,
        fw.filter(z => imFenster(z.geschaeftstag)), rawId)
      await c.query(
        `DELETE FROM core.tagesabschluss_tag
          WHERE betrieb_key = $1 AND geschaeftstag BETWEEN $2::date AND $3::date`,
        [betriebKey, von, bis])
      geschrieben += await einfuegen(c, 'core.tagesabschluss_tag',
        { betrieb_key: betriebKey, raw_id: rawId },
        [['geschaeftstag', 'date'], ['hauptsparte', 'text'], ['steuersatz', 'text'], ['brutto', 'numeric']],
        sparten.filter(z => imFenster(z.geschaeftstag)))
      break
    }

    case 'getReport:96': {
      await partitionen(c, 'core.bon', von, bis)
      await c.query(
        `DELETE FROM core.bon WHERE betrieb_key = $1 AND geschaeftstag BETWEEN $2::date AND $3::date`,
        [betriebKey, von, bis])
      const liste = bt.bons(h, 'Rechnung/Butschrift')
      const fremd = liste.filter(z => z.geschaeftstag < von || z.geschaeftstag > bis).length
      if (fremd > 0) {
        // Ein Bon ausserhalb des angefragten Fensters haette in einem anderen
        // Posten gestanden und würde beim naechsten Abruf dort geloescht.
        throw new Error(`${k.key}: ${fremd} Bons ausserhalb von ${von}..${bis} — Datumsumrechnung pruefen`)
      }
      geschrieben = await einfuegen(c, 'core.bon',
        { betrieb_key: betriebKey, raw_id: rawId },
        [['geschaeftstag', 'date'], ['laufnummer', 'integer'], ['rechnungsnummer', 'bigint'],
         ['art', 'text'], ['anzahl_artikel', 'integer'], ['finanzwege', 'text[]'],
         ['brutto', 'numeric'], ['debitor', 'text'], ['debitor_anschrift', 'text']],
        liste.map(z => ({
          geschaeftstag: z.geschaeftstag, laufnummer: z.laufnummer, rechnungsnummer: z.rechnungsnummer,
          art: z.art, anzahl_artikel: z.anzahlArtikel, finanzwege: z.finanzwege, brutto: z.brutto,
          debitor: z.debitor, debitor_anschrift: z.debitorAnschrift,
        })))
      // Die Bons eines Fensters summieren sich zu LINAs eigener Summe
      // (15.08.2026: 519 Bons, 15.920,61 EUR = balanceSumBrutto).
      const summe = liste.reduce((s, z) => s + (z.brutto ?? 0), 0)
      if (h.balanceBrutto !== null && Math.abs(summe - h.balanceBrutto) > 0.01 * liste.length + 0.01) {
        await abweichungMelden(c, k.key, { hinweis: 'Summe der Bons = balanceSumBrutto' },
          { betrieb_key: betriebKey, von, bis, raw_id: rawId, summe, balance: h.balanceBrutto })
      }
      break
    }

    default: {
      const plan = SPALTENPLAENE[k.key]
      if (!plan) {
        throw new Error(`${k.key}: kein Ladeweg — weder eigener Lader noch Spaltenplan `
          + '(der Waechter haette das vor dem Lauf melden muessen)')
      }
      await partitionen(c, plan.tabelle, von, bis)
      const zeitspalte = plan.zeit === 'monat' ? 'monat' : 'geschaeftstag'
      await c.query(
        `DELETE FROM ${plan.tabelle}
          WHERE betrieb_key = $1 AND ${zeitspalte} BETWEEN $2::date AND $3::date`,
        [betriebKey, plan.zeit === 'monat' ? `${von.slice(0, 7)}-01` : von, bis])
      const zeilen = bt.nachPlan(h, plan)
      const spalten: [string, string][] = [['zeile', 'integer']]
      if (plan.zeit !== 'monat') spalten.push(['geschaeftstag', 'date'])
      if (plan.kopf) {
        spalten.push(['ist_kopf', 'boolean'])
        spalten.push([plan.kopf.kontext_spalte, plan.kopf.kontext === 'nummer' ? 'integer' : 'text'])
      }
      const schluessel = new Set(plan.verdichten?.schluessel ?? plan.spalten.map(s => s.spalte))
      for (const s of plan.spalten) {
        if (plan.verdichten && !schluessel.has(s.spalte) && !plan.verdichten.summen.includes(s.spalte)) continue
        spalten.push([s.spalte, SQL_TYP[s.typ]])
      }
      if (plan.verdichten) spalten.push([plan.verdichten.anzahl_spalte, 'integer'])
      if (plan.rest) spalten.push([plan.rest, 'jsonb'])
      const feste: Record<string, unknown> = { betrieb_key: betriebKey, raw_id: rawId }
      if (plan.zeit === 'monat') feste.monat = `${von.slice(0, 7)}-01`
      geschrieben = await einfuegen(c, plan.tabelle, feste, spalten, zeilen)
    }
  }

  /*
   * Die Gegenprobe-Zeile — IMMER, auch bei null Zeilen. Ein leerer Bericht
   * fuer einen Betrieb mit Umsatz ist genau der Fall, den sie finden soll.
   */
  const vorlaeufig = abrufVorlaeufig(bis, k.heute ?? geschaeftstag(new Date()))
  await c.query(
    `INSERT INTO core.betriebsbericht_abruf AS a
       (endpunkt, bericht, betrieb_key, zeitraum_von, zeitraum_bis, n_bills,
        balance_brutto, balance_netto, zeilen, hinweis, raw_id, vorlaeufig)
     VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (endpunkt, betrieb_key, zeitraum_von, zeitraum_bis) DO UPDATE SET
       n_bills = excluded.n_bills, balance_brutto = excluded.balance_brutto,
       balance_netto = excluded.balance_netto, zeilen = excluded.zeilen,
       hinweis = excluded.hinweis, raw_id = excluded.raw_id,
       abrufe = a.abrufe + 1, zuletzt_abgerufen_am = now(),
       vorlaeufig = excluded.vorlaeufig`,
    [k.key, bb.bericht, betriebKey, von, bis, h.nBills === null ? null : Math.round(h.nBills),
     h.balanceBrutto, h.balanceNetto, geschrieben, h.hinweis, rawId, vorlaeufig])

  /*
   * EIN ABRUF ERSETZT, WAS ER ENTHÄLT (0120). Der Lader hat oben die Daten
   * von..bis des Betriebs geloescht und neu geschrieben. Eine Abrufzeile,
   * deren Zeitraum ganz darin liegt, beschreibt damit Daten, die es nicht
   * mehr gibt — sie geht mit. Anlass ist der Teilmonat von 97: jede Nacht
   * 1.–Vortag, und ohne diesen Schritt stuenden nach einem Monat 30
   * ueberlappende Abrufzeilen je Betrieb da, jede mit eigener Gegenprobe.
   * So steht immer genau die juengste da, und der Vollmonat ersetzt sie.
   */
  await c.query(
    `DELETE FROM core.betriebsbericht_abruf
      WHERE endpunkt = $1 AND betrieb_key = $2
        AND zeitraum_von >= $3::date AND zeitraum_bis <= $4::date
        AND (zeitraum_von, zeitraum_bis) <> ($3::date, $4::date)`,
    [k.key, betriebKey, von, bis])
  await c.query(
    `DELETE FROM core.bericht_hinweis
      WHERE endpunkt = $1 AND betrieb_key = $2
        AND zeitraum_von >= $3::date AND zeitraum_bis <= $4::date
        AND (zeitraum_von, zeitraum_bis) <> ($3::date, $4::date)`,
    [k.key, betriebKey, von, bis])

  // LINAs `errors`: ein Datenqualitaetskanal, kein technischer Fehler (1b §1.3).
  if (h.hinweis) {
    await c.query(
      `INSERT INTO core.bericht_hinweis AS x
         (endpunkt, betrieb_key, zeitraum_von, zeitraum_bis, hinweis, raw_id)
       VALUES ($1, $2, $3::date, $4::date, $5, $6)
       ON CONFLICT (endpunkt, betrieb_key, zeitraum_von, zeitraum_bis, hinweis)
       DO UPDATE SET zuletzt_am = now(), raw_id = excluded.raw_id`,
      [k.key, betriebKey, von, bis, h.hinweis, rawId])
  }

  if (geschrieben === 0 && (h.nBills ?? 0) > 0 && bb.stufe === 'A') {
    log.warn('Betriebsbericht ohne Zeilen, obwohl LINA Rechnungen zaehlt', {
      endpunkt: k.key, betrieb: k.betriebEncId, von, bis, nBills: h.nBills,
    })
  }
  return geschrieben
}
