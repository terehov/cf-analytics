/**
 * DIE GEGENPROBE ZUM UMBAU AUS MIGRATION 0084 — als Test, nicht als
 * einmalige Messung.
 *
 * `mart.vergleichstag` holte bis 0084 je Zeile ihre vier Nachbartage per
 * LATERAL. Über den ganzen Bestand war das nicht materialisierbar (nach zehn
 * Minuten abgebrochen); die Fassung mit Fensterfunktion und Kumulierung
 * braucht 35 s. Der Umbau ist nur dann keine Näherung, wenn er dieselben
 * Werte liefert — und das ist eine Behauptung, die veraltet, sobald jemand
 * die Sicht anfasst. Deshalb steht sie hier und nicht in einem Protokoll.
 *
 * WIE VERGLICHEN WIRD: die Logik aus 0051 wird wörtlich nachgebaut und gegen
 * das gestellt, was in der Materialisierung wirklich steht — nicht gegen eine
 * zweite Abschrift der neuen Logik. Sonst prüfte der Test sich selbst.
 *
 * ZUGESCHNITTEN WIRD ÜBER DIE BETRIEBE, NICHT ÜBER DEN ZEITRAUM. Der
 * Vergleichsvorrat läuft je Betrieb und Wochentag über die ganze Historie;
 * wer nur ein Jahr herausschneidet, vergleicht zwei verschiedene Rechnungen.
 * Drei Betriebe mit voller Historie sind rund 9.400 Zeilen — klein genug für
 * die LATERAL-Fassung, groß genug, um den Anfang der Historie und die
 * Ruhetage zu enthalten.
 *
 * WAS DIESER TEST GEFUNDEN HAT (20.08.2026), beides in einer Vorarbeit über
 * einen einzelnen Betrieb in 2026 unsichtbar:
 *   1. Ein Entwurf mit `WHERE vorher > 0` verlor die Zeilen am Anfang der
 *      Historie — die LATERAL-Fassung behält sie mit vergleichstage = 0.
 *   2. ferien_abweichung ist bei vergleichstage = 0 eine Zählung über die
 *      leere Menge, also 0 und nicht NULL. Das betraf 1.661 von 9.432
 *      Zeilen (17,6 %), weit überwiegend dauerhafte Ruhetage.
 */
import { describe, expect, test } from 'bun:test'
import { query } from '../db/pool'

/** Wie viele Betriebe in die Probe gehen. Drei reichen und bleiben schnell. */
const BETRIEBE = 3

/**
 * Die Logik aus migrations/0051_kalender_und_markt.sql, wörtlich — nur die
 * CTE `basis` ist auf die Probe eingeschränkt. Bewusst NICHT aufgeräumt:
 * dies ist die Referenz, und eine geglättete Referenz beweist nichts.
 */
const REFERENZ = `
WITH probe AS (
  SELECT betrieb_key FROM mart.vergleichstag_basis
   WHERE kalender_quelle = 'bundesland'
   GROUP BY 1 HAVING count(*) > 1500
   ORDER BY betrieb_key LIMIT ${BETRIEBE}
), basis AS (
  SELECT k.betrieb_key, k.geschaeftstag, k.wochentag_nr,
         k.ist_feiertag, k.ist_schulferien, u.umsatz_netto, u.gaeste
    FROM mart.betrieb_kalender k
    JOIN mart.umsatz_tag u
      ON u.betrieb_key = k.betrieb_key AND u.geschaeftstag = k.geschaeftstag
   WHERE k.betrieb_key IN (SELECT betrieb_key FROM probe)
), lateral_fassung AS (
  SELECT b.betrieb_key, b.geschaeftstag,
         v.tage                     AS vergleichstage,
         round(v.umsatz_schnitt, 2) AS umsatz_vergleich,
         round(v.gaeste_schnitt, 1) AS gaeste_vergleich,
         CASE WHEN v.umsatz_schnitt > 0
              THEN round(100.0 * (b.umsatz_netto - v.umsatz_schnitt) / v.umsatz_schnitt, 1)
         END                        AS abweichung_pct,
         v.ferien_abweichung,
         v.von AS vergleich_von, v.bis AS vergleich_bis
    FROM basis b
    LEFT JOIN LATERAL (
          SELECT count(*)                                  AS tage,
                 avg(r.umsatz_netto)                       AS umsatz_schnitt,
                 avg(r.gaeste) FILTER (WHERE r.gaeste > 0) AS gaeste_schnitt,
                 count(*) FILTER (WHERE r.ist_schulferien
                                    IS DISTINCT FROM b.ist_schulferien) AS ferien_abweichung,
                 min(r.geschaeftstag) AS von, max(r.geschaeftstag) AS bis
            FROM (SELECT r2.geschaeftstag, r2.umsatz_netto, r2.gaeste, r2.ist_schulferien
                    FROM basis r2
                   WHERE r2.betrieb_key  = b.betrieb_key
                     AND r2.wochentag_nr = b.wochentag_nr
                     AND r2.geschaeftstag < b.geschaeftstag
                     AND NOT r2.ist_feiertag
                     AND r2.umsatz_netto > 0
                   ORDER BY r2.geschaeftstag DESC
                   LIMIT 4) r
    ) v ON true
)
SELECT count(*)::int AS zeilen,
       count(*) FILTER (WHERE a.betrieb_key IS NULL OR b.betrieb_key IS NULL)::int AS zeile_fehlt,
       count(*) FILTER (WHERE a.vergleichstage    IS DISTINCT FROM b.vergleichstage)::int    AS ab_vergleichstage,
       count(*) FILTER (WHERE a.umsatz_vergleich  IS DISTINCT FROM b.umsatz_vergleich)::int  AS ab_umsatz_vergleich,
       count(*) FILTER (WHERE a.gaeste_vergleich  IS DISTINCT FROM b.gaeste_vergleich)::int  AS ab_gaeste_vergleich,
       count(*) FILTER (WHERE a.abweichung_pct    IS DISTINCT FROM b.abweichung_pct)::int    AS ab_abweichung_pct,
       count(*) FILTER (WHERE a.ferien_abweichung IS DISTINCT FROM b.ferien_abweichung)::int AS ab_ferien_abweichung,
       count(*) FILTER (WHERE a.vergleich_von     IS DISTINCT FROM b.vergleich_von)::int     AS ab_vergleich_von,
       count(*) FILTER (WHERE a.vergleich_bis     IS DISTINCT FROM b.vergleich_bis)::int     AS ab_vergleich_bis,
       count(*) FILTER (WHERE a.vergleichstage = 0)::int AS ohne_vergleich
  FROM lateral_fassung a
  FULL JOIN mart.vergleichstag_basis b
    ON b.betrieb_key = a.betrieb_key AND b.geschaeftstag = a.geschaeftstag
 WHERE a.betrieb_key IS NOT NULL
    OR b.betrieb_key IN (SELECT betrieb_key FROM probe)`

/**
 * Der Test braucht Daten UND eine befüllte Materialisierung. Beides fehlt in
 * einer frisch geklonten Datenbank — dort ist ein SELECT auf die Sicht PG
 * 55000 und kein Befund. Also vorher nachsehen und sonst überspringen, statt
 * einen roten Test zu hinterlassen, der nichts über den Code aussagt.
 */
async function bereit(): Promise<string | null> {
  try {
    const [r] = await query<{ befuellt: boolean; zeilen: number }>(`
      SELECT c.relispopulated AS befuellt,
             (SELECT count(*)::int FROM mart.umsatz_tag) AS zeilen
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'mart' AND c.relname = 'vergleichstag_basis'`)
    if (!r) return 'mart.vergleichstag_basis gibt es nicht (Migration 0084 nicht angewendet)'
    if (!r.befuellt) return 'mart.vergleichstag_basis ist nicht befuellt (frischer Klon)'
    if (r.zeilen === 0) return 'mart.umsatz_tag ist leer'
    return null
  } catch (e) {
    return `keine Datenbank: ${String(e).slice(0, 120)}`
  }
}

describe('Vergleichstag: Fensterfassung gegen die LATERAL-Fassung aus 0051', () => {
  test('null Abweichung in allen acht Spalten', async () => {
    const grund = await bereit()
    if (grund) { console.log(`uebersprungen — ${grund}`); return }

    const [r] = await query<Record<string, number>>(REFERENZ)
    expect(r).toBeDefined()

    // Erst die Voraussetzung: die Probe muss ueberhaupt etwas enthalten, und
    // sie muss die Faelle enthalten, um die es geht. Ohne das koennte ein
    // leeres Ergebnis als "null Abweichung" durchgehen.
    expect(r!.zeilen).toBeGreaterThan(1000)
    expect(r!.ohne_vergleich).toBeGreaterThan(0)

    expect({
      zeile_fehlt:          r!.zeile_fehlt,
      ab_vergleichstage:    r!.ab_vergleichstage,
      ab_umsatz_vergleich:  r!.ab_umsatz_vergleich,
      ab_gaeste_vergleich:  r!.ab_gaeste_vergleich,
      ab_abweichung_pct:    r!.ab_abweichung_pct,
      ab_ferien_abweichung: r!.ab_ferien_abweichung,
      ab_vergleich_von:     r!.ab_vergleich_von,
      ab_vergleich_bis:     r!.ab_vergleich_bis,
    }).toEqual({
      zeile_fehlt: 0, ab_vergleichstage: 0, ab_umsatz_vergleich: 0,
      ab_gaeste_vergleich: 0, ab_abweichung_pct: 0, ab_ferien_abweichung: 0,
      ab_vergleich_von: 0, ab_vergleich_bis: 0,
    })
  }, 300_000)

  /**
   * Regel 10: ein Betrieb, der montags schliesst, darf montags nicht aus der
   * Tagesliste verschwinden. Ein `WHERE vorher > 0` im Aufbau wuerde genau
   * das tun, und der Test oben allein faenge es nicht — er vergliche dann
   * zwei uebereinstimmend lueckenhafte Mengen.
   */
  test('Ruhetage bleiben drin, mit vergleichstage = 0', async () => {
    const grund = await bereit()
    if (grund) { console.log(`uebersprungen — ${grund}`); return }

    const [r] = await query<{ ohne_vergleich: number; leerer_wert: number }>(`
      SELECT count(*)::int AS ohne_vergleich,
             count(*) FILTER (WHERE umsatz_vergleich IS NULL)::int AS leerer_wert
        FROM mart.vergleichstag_basis WHERE vergleichstage = 0`)
    expect(r!.ohne_vergleich).toBeGreaterThan(0)
    // Kein Vergleich heisst leerer Vergleichswert, nicht 0,00 EUR.
    expect(r!.leerer_wert).toBe(r!.ohne_vergleich)
  }, 60_000)

  /**
   * Die Huelle mart.vergleichstag muss dieselben Zeilen zeigen wie die
   * Materialisierung darunter — sonst liest eine Karte etwas anderes als die
   * Pruefzeile daneben.
   */
  test('die duenne Sicht zeigt dieselben Zeilen', async () => {
    const grund = await bereit()
    if (grund) { console.log(`uebersprungen — ${grund}`); return }

    const [r] = await query<{ huelle: number; basis: number }>(`
      SELECT (SELECT count(*)::int FROM mart.vergleichstag)       AS huelle,
             (SELECT count(*)::int FROM mart.vergleichstag_basis) AS basis`)
    expect(r!.huelle).toBe(r!.basis)
  }, 60_000)
})

describe('Feiertagsnamen', () => {
  /**
   * Zwei Quellen schrieben vier Feiertage verschieden (feiertage-api.de bis
   * 2019, openholidaysapi.org ab 2020). Wer nach Namen gruppiert, spaltet
   * dann ausgerechnet Neujahr — den Extremwert der ganzen Auswertung — in
   * zwei Zeilen mit halber Fallzahl. manual.feiertag_alias raeumt das auf;
   * diese Pruefung schlaegt an, wenn eine fuenfte Schreibweise dazukommt.
   */
  test('kein Name endet vor dem Ende der Historie', async () => {
    const grund = await bereit()
    if (grund) { console.log(`uebersprungen — ${grund}`); return }

    const zeilen = await query<{ name: string; letzter_termin: string }>(
      `SELECT name, letzter_termin::text FROM mart.feiertag_namenswechsel`)
    expect(zeilen).toEqual([])
  }, 60_000)
})
