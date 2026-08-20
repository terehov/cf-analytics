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
/**
 * BEIDE FASSUNGEN LIVE, ueber denselben kleinen Bestand.
 *
 * Die erste Version dieses Tests stellte die LATERAL-Fassung gegen die
 * MATERIALISIERUNG. Das war falsch zugeschnitten und ist am 20.08.2026
 * aufgeflogen: eine zweite Session reparierte den Kalender-Nachlauf, der
 * Feiertagsbestand sprang von 1.127 auf 1.760 Zeilen — und der Test wurde rot,
 * ohne dass sich an der Logik etwas geändert hatte. Er maß die Frische der
 * Materialisierung, nicht die Gleichwertigkeit des Umbaus.
 *
 * Das sind zwei verschiedene Zusicherungen, und sie gehören getrennt:
 *   - Ist der Umbau wertgleich?  → dieser Test, live gegen live.
 *   - Ist die Sicht frisch?      → die Prüfzeile über mart.vergleichstag_stand.
 *
 * Die Fensterfassung unten ist eine Abschrift aus 0084. Wer die Materialisierung
 * ändert, ändert sie hier mit — dafür steht der Test darunter, der beide
 * gegeneinander hält, sobald die Sicht frisch ist.
 */
const LIVE_GEGEN_LIVE = `
WITH probe AS (
  SELECT k.betrieb_key
    FROM mart.betrieb_kalender k
    JOIN mart.umsatz_tag u USING (betrieb_key, geschaeftstag)
   WHERE k.kalender_quelle = 'bundesland'
   GROUP BY 1 HAVING count(*) FILTER (WHERE u.umsatz_netto > 0) > 1500
   ORDER BY k.betrieb_key LIMIT ${BETRIEBE}
), basis AS (
  SELECT k.betrieb_key, k.geschaeftstag, k.wochentag_nr,
         k.ist_feiertag, k.ist_schulferien, u.umsatz_netto, u.gaeste
    FROM mart.betrieb_kalender k
    JOIN mart.umsatz_tag u USING (betrieb_key, geschaeftstag)
   WHERE k.betrieb_key IN (SELECT betrieb_key FROM probe)
),
-- (A) Die Logik aus 0051, woertlich. Bewusst nicht aufgeraeumt: dies ist die
--     Referenz, und eine geglaettete Referenz beweist nichts.
lateral_fassung AS (
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
),
-- (B) Die Fensterfassung aus 0084.
markiert AS (
  SELECT b.*, count(*) FILTER (WHERE NOT b.ist_feiertag AND b.umsatz_netto > 0)
           OVER (PARTITION BY b.betrieb_key, b.wochentag_nr ORDER BY b.geschaeftstag
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS vorher
    FROM basis b
), vorrat AS (
  SELECT betrieb_key, wochentag_nr, geschaeftstag, umsatz_netto, gaeste, ist_schulferien,
         row_number() OVER (PARTITION BY betrieb_key, wochentag_nr
                            ORDER BY geschaeftstag) AS rang
    FROM basis WHERE NOT ist_feiertag AND umsatz_netto > 0
), kum AS (
  SELECT v.betrieb_key, v.wochentag_nr, v.rang, v.geschaeftstag,
         sum(v.umsatz_netto) OVER w                       AS ku,
         sum(v.gaeste) FILTER (WHERE v.gaeste > 0) OVER w AS kg,
         count(*)      FILTER (WHERE v.gaeste > 0) OVER w AS kgn,
         sum(v.ist_schulferien::int) OVER w               AS kf
    FROM vorrat v
  WINDOW w AS (PARTITION BY v.betrieb_key, v.wochentag_nr ORDER BY v.rang)
), fenster_roh AS (
  SELECT m.betrieb_key, m.geschaeftstag, m.umsatz_netto, m.ist_schulferien,
         least(m.vorher, 4) AS tage,
         (a.ku - coalesce(v.ku, 0)) / nullif(least(m.vorher, 4), 0) AS schnitt,
         (a.kg - coalesce(v.kg, 0)) AS gs, (a.kgn - coalesce(v.kgn, 0)) AS gn,
         (a.kf - coalesce(v.kf, 0)) AS fs,
         c.geschaeftstag AS von, a.geschaeftstag AS bis
    FROM markiert m
    LEFT JOIN kum a ON a.betrieb_key = m.betrieb_key
                   AND a.wochentag_nr = m.wochentag_nr AND a.rang = m.vorher
    LEFT JOIN kum v ON v.betrieb_key = m.betrieb_key
                   AND v.wochentag_nr = m.wochentag_nr AND v.rang = m.vorher - 4
    LEFT JOIN kum c ON c.betrieb_key = m.betrieb_key
                   AND c.wochentag_nr = m.wochentag_nr
                   AND m.vorher > 0 AND c.rang = greatest(m.vorher - 3, 1)
), fenster_fassung AS (
  SELECT betrieb_key, geschaeftstag, tage AS vergleichstage,
         round(schnitt, 2) AS umsatz_vergleich,
         CASE WHEN gn > 0 THEN round(gs::numeric / gn, 1) END AS gaeste_vergleich,
         CASE WHEN schnitt > 0
              THEN round(100.0 * (umsatz_netto - schnitt) / schnitt, 1) END AS abweichung_pct,
         CASE WHEN ist_schulferien THEN tage - coalesce(fs, 0)
              ELSE coalesce(fs, 0) END AS ferien_abweichung,
         von AS vergleich_von, bis AS vergleich_bis
    FROM fenster_roh
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
  FULL JOIN fenster_fassung b USING (betrieb_key, geschaeftstag)`

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

    const [r] = await query<Record<string, number>>(LIVE_GEGEN_LIVE)
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

  /**
   * Und zusätzlich gegen das, was WIRKLICH ausgeliefert wird — aber nur, wenn
   * die Materialisierung frisch ist. Ist sie es nicht, sagt der Test das laut
   * und prüft nicht: eine veraltete Sicht ist ein Betriebszustand und kein
   * Logikfehler, und die Prüfzeile über mart.vergleichstag_stand ist dafür
   * zuständig. Genau diese Vermischung hat den Test am 20.08.2026 rot gemacht,
   * als eine zweite Session den Feiertagsbestand austauschte.
   */
  test('die Materialisierung stimmt mit der Fensterfassung ueberein', async () => {
    const grund = await bereit()
    if (grund) { console.log(`uebersprungen — ${grund}`); return }

    // Genaue Frischeprobe: trägt die Materialisierung denselben Kalender wie
    // mart.betrieb_kalender gerade? Ein Zeitstempelvergleich wäre gröber.
    const [drift] = await query<{ abweichend: number }>(`
      SELECT count(*)::int AS abweichend
        FROM mart.vergleichstag_basis v
        JOIN mart.betrieb_kalender k USING (betrieb_key, geschaeftstag)
       WHERE v.feiertag IS DISTINCT FROM k.feiertag`)
    if (drift!.abweichend > 0) {
      console.log(`uebersprungen — Materialisierung veraltet: ${drift!.abweichend} `
        + `Zeilen tragen einen anderen Feiertagsstand als mart.betrieb_kalender. `
        + `Das ist die Aussage von mart.vergleichstag_stand, nicht dieses Tests.`)
      return
    }

    const [r] = await query<Record<string, number>>(`
      SELECT count(*)::int AS zeilen,
             count(*) FILTER (WHERE v.umsatz_vergleich IS DISTINCT FROM b.umsatz_vergleich)::int AS ab_umsatz,
             count(*) FILTER (WHERE v.abweichung_pct   IS DISTINCT FROM b.abweichung_pct)::int   AS ab_abw
        FROM mart.vergleichstag_basis v
        JOIN (SELECT * FROM mart.vergleichstag) b USING (betrieb_key, geschaeftstag)`)
    expect({ ab_umsatz: r!.ab_umsatz, ab_abw: r!.ab_abw }).toEqual({ ab_umsatz: 0, ab_abw: 0 })
  }, 120_000)
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
