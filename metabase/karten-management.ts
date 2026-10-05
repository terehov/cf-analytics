// =====================================================================
// Management — das zentrale Dashboard nach Daniels Konzept (29.09.2026).
//
// Anlass: die Round-Table-Seiten waren zu kompliziert. Diese Seite zeigt
// auf EINEM Blatt, was die Geschaeftsfuehrung braucht — Umsatz, Rendite,
// Personal, Wareneinsatz, Gaeste, Schulung — und darunter die fuenf
// Handlungsfelder, die am dringendsten sind.
//
// ZWEI EBENEN MIT DENSELBEN KARTEN. Ohne Betriebsfilter zeigt jede Karte
// die operativen Betriebe insgesamt (bzw. die der gewaehlten Marke), mit
// Filter den einen Betrieb. Deshalb zaehlen die Ampelspalten ("🔴 3 · 🟠 1
// · 🟢 12") statt eine Farbe zu zeigen: fuer einen Betrieb steht dort eine
// 1, fuer die Gruppe die Verteilung — Ampeln werden gezaehlt, nie
// gemittelt.
//
// Die Ampeln kommen fertig aus der Datenbank (mart.round_table_monat,
// mart.ampel_bereich, mart.bounti_quote_betrieb). Keine Karte rechnet
// eine Schwelle nach: das Regelwerk steht in ampel.regel und ampel.soll,
// und eine zweite Rechnung hier waere eine zweite Wahrheit.
// =====================================================================

import type { Karte } from './typen'
import { MONAT_CTE, P_MONAT, P_MARKE, P_BETRIEB } from './gemeinsam'
import { themaDeutsch } from './karten-yext'

const FILTER = [P_MONAT, P_MARKE, P_BETRIEB]
const BOUNTI_FILTER = [P_MARKE, P_BETRIEB]

/** Die operative Auswahl: gewaehlter Monat, Marke, Betrieb. Alias r. */
const AUSWAHL = `
   r.monat = g.monat
   AND r.operativ
   [[AND r.betrieb = {{betrieb}}]]
   [[AND r.konzept = {{marke}}]]`

const EURO = { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 }

/** Zahl mit Dezimalkomma. to_char folgt lc_numeric, und das steht auf C (0107). */
const zahl = (x: string, muster = 'FM999990.0') => `replace(to_char(${x}, '${muster}'), '.', ',')`
/** Mit Vorzeichen, fuer Abweichungen. */
const vz = (x: string, muster = 'FM999990.0') =>
  `CASE WHEN ${x} > 0 THEN '+' ELSE '' END || ${zahl(x, muster)}`

/**
 * Ampeln einer Auswahl als Verteilung. `spalte` ist eine Ampelspalte mit
 * 'rot' / 'orange' / 'gruen' / NULL.
 */
const verteilung = (spalte: string) => `
       nullif(concat_ws(' · ',
           CASE WHEN count(*) FILTER (WHERE ${spalte} = 'rot')    > 0 THEN '🔴 ' || count(*) FILTER (WHERE ${spalte} = 'rot')    END,
           CASE WHEN count(*) FILTER (WHERE ${spalte} = 'orange') > 0 THEN '🟠 ' || count(*) FILTER (WHERE ${spalte} = 'orange') END,
           CASE WHEN count(*) FILTER (WHERE ${spalte} = 'gruen')  > 0 THEN '🟢 ' || count(*) FILTER (WHERE ${spalte} = 'gruen')  END,
           CASE WHEN count(*) FILTER (WHERE ${spalte} IS NULL)    > 0 THEN '⚪ ' || count(*) FILTER (WHERE ${spalte} IS NULL)    END),
         '')`

/** Emoji einer einzelnen Ampel. */
const emoji = (spalte: string) =>
  `coalesce((SELECT b.emoji FROM ampel.beschriftung b WHERE b.status = ${spalte}), '⚪')`

export const karten: Karte[] = [
  // -------------------------------------------------------------------
  // Kopfzeile: sechs Zahlen
  // -------------------------------------------------------------------
  {
    schluessel: 'mg_umsatz',
    name: 'Umsatz',
    beschreibung: 'Netto-Umsatz im gewählten Monat — ein Betrieb oder alle operativen Betriebe zusammen.',
    anzeige: 'scalar',
    parameter: FILTER,
    sql: `${MONAT_CTE}
SELECT sum(r.umsatz_ist) AS "Umsatz"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE ${AUSWAHL}`,
    visualisierung: { 'scalar.field': 'Umsatz', column_settings: { '["name","Umsatz"]': EURO } },
  },
  {
    schluessel: 'mg_umsatz_vj',
    name: 'Umsatz Vorjahr',
    beschreibung: 'Derselbe Monat ein Jahr vorher, für dieselben Betriebe.',
    anzeige: 'scalar',
    parameter: FILTER,
    sql: `${MONAT_CTE}
SELECT sum(r.umsatz_vj) AS "Umsatz Vorjahr"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE ${AUSWAHL}`,
    visualisierung: { 'scalar.field': 'Umsatz Vorjahr', column_settings: { '["name","Umsatz Vorjahr"]': EURO } },
  },
  {
    // Gegen die Summe gerechnet, nicht als Mittel der Einzelwerte: ein
    // kleiner Betrieb mit +40 % soll die Gruppe nicht nach oben ziehen.
    // Nur Betriebe mit Vorjahr zaehlen im Nenner UND im Zaehler — sonst
    // waere jede Neueroeffnung ein Umsatzplus.
    schluessel: 'mg_umsatz_delta',
    name: 'Δ Vorjahr',
    beschreibung: 'Veränderung gegen den Vorjahresmonat. Grün über +2 %, gelb von −2 % bis +2 %, rot darunter. Betriebe ohne Vorjahresmonat zählen nicht mit. Bei mehreren Betrieben steht darunter, wie viele wo stehen.',
    anzeige: 'scalar',
    parameter: FILTER,
    sql: `${MONAT_CTE}
, summe AS (
    SELECT round(100 * (sum(r.umsatz_ist) FILTER (WHERE r.umsatz_vj > 0)
                        - sum(r.umsatz_vj) FILTER (WHERE r.umsatz_vj > 0))
                 / nullif(sum(r.umsatz_vj) FILTER (WHERE r.umsatz_vj > 0), 0), 1) AS pct
      FROM mart.round_table_monat r
      CROSS JOIN gewaehlt g
     WHERE ${AUSWAHL}
)
SELECT ${emoji(`ampel.urteil('umsatz', s.pct, NULL)`)} || ' ' || ${vz('s.pct')} || ' %' AS "Δ Vorjahr"
  FROM summe s`,
    visualisierung: { 'scalar.field': 'Δ Vorjahr' },
  },
  {
    // YTD, nicht der Monat (Entscheidung Daniel): ein Monat schwankt mit
    // jeder Einmalbuchung. Die Monatszahl steht im Text daneben.
    schluessel: 'mg_rendite',
    name: 'Rendite YTD',
    beschreibung: 'EBIT geteilt durch Umsatz laut BWA, von Januar bis zum letzten gebuchten Monat. Grün über 10 %, gelb 5–10 %, rot darunter. In Klammern der einzelne BWA-Monat. Die Rendite steht neben dem Gesamturteil und färbt den Betrieb nicht.',
    anzeige: 'scalar',
    parameter: FILTER,
    sql: `${MONAT_CTE}
, summe AS (
    SELECT round(100 * sum(rm.ebit_ytd) / nullif(sum(rm.umsatz_bwa_ytd), 0), 1) AS ytd,
           round(100 * sum(rm.ebit) / nullif(sum(rm.umsatz_bwa), 0), 1)         AS monat
      FROM mart.round_table_monat r
      CROSS JOIN gewaehlt g
      JOIN mart.rendite_monat rm ON rm.betrieb_key = r.betrieb_key AND rm.monat = r.bwa_monat
     WHERE ${AUSWAHL}
)
SELECT CASE WHEN s.ytd IS NULL THEN '– keine BWA'
            ELSE ${emoji(`ampel.urteil('rendite', s.ytd, NULL)`)} || ' ' || ${zahl('s.ytd')} || ' %'
                 || ' (Monat ' || ${zahl('s.monat')} || ' %)' END AS "Rendite YTD"
  FROM summe s`,
    visualisierung: { 'scalar.field': 'Rendite YTD' },
  },
  {
    // Die Ampel haengt am Google-Stand (Schnitt aller Google-Bewertungen
    // seit Beginn), wie im Round Table. Bei mehreren Betrieben der Median,
    // nicht der Mittelwert: Bewertungen sind Schulnoten.
    schluessel: 'mg_yext',
    name: 'Yext Bewertung',
    beschreibung: 'Die Google-Bewertung, wie ein Gast sie sieht: der Schnitt aller Bewertungen seit Beginn. Grün ab 4,30, gelb 4,00 bis 4,29, rot darunter. Bei mehreren Betrieben der mittlere Betrieb (Median).',
    anzeige: 'scalar',
    parameter: FILTER,
    sql: `${MONAT_CTE}
, summe AS (
    SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.online_bewertung)::numeric, 2) AS note
      FROM mart.round_table_monat r
      CROSS JOIN gewaehlt g
     WHERE ${AUSWAHL}
       AND r.online_bewertung IS NOT NULL
)
SELECT CASE WHEN s.note IS NULL THEN '– keine Bewertung'
            ELSE ${emoji(`ampel.urteil('bewertung', s.note, NULL)`)} || ' ' || ${zahl('s.note', 'FM0.00')} || ' ★' END AS "Yext Bewertung"
  FROM summe s`,
    visualisierung: { 'scalar.field': 'Yext Bewertung' },
  },
  {
    schluessel: 'mg_bounti',
    name: 'Bounti Abschlussquote',
    beschreibung: 'Anteil der zugewiesenen Schulungen, die abgeschlossen sind — Stand heute, der Monatsfilter wirkt hier nicht. Grün über 90 %, gelb 75–90 %, rot darunter. Steht neben dem Gesamturteil.',
    anzeige: 'scalar',
    parameter: BOUNTI_FILTER,
    sql: `
WITH summe AS (
    SELECT round(100.0 * sum(q.abgeschlossen) / nullif(sum(q.zuweisungen), 0), 1) AS pct
      FROM mart.bounti_quote_betrieb q
     WHERE q.operativ
       AND q.in_bounti
       [[AND q.betrieb = {{betrieb}}]]
       [[AND q.konzept = {{marke}}]]
)
SELECT CASE WHEN s.pct IS NULL THEN '– nicht in Bounti'
            ELSE ${emoji(`ampel.urteil('bounti_abschluss', s.pct, NULL)`)} || ' ' || ${zahl('s.pct')} || ' %' END
           AS "Bounti Abschlussquote"
  FROM summe s`,
    visualisierung: { 'scalar.field': 'Bounti Abschlussquote' },
  },

  // -------------------------------------------------------------------
  // Die Ampeltabelle — Daniels KPI-Tabelle, gefuellt
  // -------------------------------------------------------------------
  {
    // Aus mart.ampel_bereich, also genau die Urteile, die auch der Round
    // Table und der MCP-Zugang sehen. "Wert" und "Bezug" sind Mediane,
    // wenn mehr als ein Betrieb gewaehlt ist; die Ampelspalte zaehlt.
    schluessel: 'mg_ampeln',
    name: 'Alle Kennzahlen mit Ampel',
    beschreibung: 'Jede Kennzahl des Regelwerks mit ihrem Wert, dem Maßstab (Budget, Soll oder Vorjahr), der Abweichung und der Ampel. Bei mehreren Betrieben sind Wert und Maßstab der mittlere Betrieb (Median), und die Ampelspalte zählt, wie viele Betriebe wo stehen. Personal und Wareneinsatz stehen auf dem letzten gebuchten BWA-Monat. „Im Gesamturteil: nein" heißt: die Ampel steht daneben und färbt den Betrieb nicht.',
    anzeige: 'table',
    // Eine Zeile je Bereich aus mart.ampel_bereich (9 seit 0129).
    zeilen_max: 9,
    parameter: FILTER,
    sql: `${MONAT_CTE}
SELECT a.bereich_name                                                             AS "Kennzahl",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY a.wert)::numeric, 2)       AS "Wert",
       max(a.bezug_art)                                                           AS "Maßstab",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY a.bezugswert)::numeric, 2) AS "Maßstab-Wert",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY a.abweichung)::numeric, 2) AS "Abweichung (Pkt.)",
       ${verteilung('a.ampel')}                                                   AS "Ampeln",
       CASE WHEN bool_or(a.im_gesamturteil) THEN 'ja' ELSE 'nein' END             AS "Im Gesamturteil",
       (SELECT s.gilt FROM mart.ampel_schwelle s
         WHERE s.ist_standard AND s.bereich = a.bereich AND s.ist_rueckfall)       AS "Regel"
  FROM mart.ampel_bereich a
  CROSS JOIN gewaehlt g
 WHERE a.monat = g.monat
   AND a.operativ
   [[AND a.betrieb = {{betrieb}}]]
   [[AND a.konzept = {{marke}}]]
 GROUP BY a.bereich, a.bereich_name, a.reihenfolge
 ORDER BY a.reihenfolge`,
  },

  // -------------------------------------------------------------------
  // Umsatzentwicklung
  // -------------------------------------------------------------------
  {
    // Zwei Linien in Euro, eine Achse. Die Veraenderung in Prozent steht
    // in der Kachel oben — nicht als zweite Achse hier (dashboards.md:
    // keine zwei Y-Achsen).
    schluessel: 'mg_umsatz_verlauf',
    name: 'Umsatz gegen Vorjahr',
    beschreibung: 'Die letzten 13 Monate bis zum gewählten Monat, jeder gegen denselben Monat im Vorjahr.',
    anzeige: 'line',
    parameter: FILTER,
    sql: `${MONAT_CTE}
SELECT r.monat           AS "Monat",
       sum(r.umsatz_ist) AS "Umsatz",
       sum(r.umsatz_vj)  AS "Vorjahr"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.monat BETWEEN (g.monat - interval '12 months')::date AND g.monat
   AND r.operativ
   [[AND r.betrieb = {{betrieb}}]]
   [[AND r.konzept = {{marke}}]]
 GROUP BY r.monat
 ORDER BY r.monat`,
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Umsatz', 'Vorjahr'],
      'graph.x_axis.title_text': '',
      'graph.y_axis.title_text': 'Umsatz netto',
      column_settings: { '["name","Umsatz"]': EURO, '["name","Vorjahr"]': EURO },
      series_settings: { Vorjahr: { line: { style: 'dashed' } } },
    },
  },

  // -------------------------------------------------------------------
  // Personalkosten
  // -------------------------------------------------------------------
  {
    /*
     * Service, Kueche und Bar aus der Kasse (Monatsabruf, 0129), "ohne GF"
     * aus der BWA. Die Euro sind je Bereich Quote x eigener Nenner (Service
     * gegen Gesamtumsatz, Kueche gegen Speisen, Bar gegen Getraenke), die
     * Quote der Gruppe ist Euro durch Nenner und nicht der Mittelwert der
     * Quoten.
     *
     * Nur Betriebe, die in BEIDEN Jahren Zahlen haben — sonst waere ein
     * neuer Betrieb ein Kostenanstieg der Gruppe.
     */
    schluessel: 'mg_personal',
    name: 'Personalkosten',
    beschreibung: 'Service, Küche und Bar kommen aus der Kasse (LINA), „Ohne GF" aus der BWA. Jeder Bereich hat seinen eigenen Umsatz als Maßstab: Service den Gesamtumsatz, Küche den Speisenumsatz, Bar den Getränkeumsatz — die drei Prozentwerte ergeben deshalb zusammen nicht den Gesamtwert. Bereiche werden gegen das Vorjahr gemessen (grün bis ±0, gelb bis +1 Pkt.), „Ohne GF" gegen das Budget — solange keine Plan-BWA gepflegt ist, die Sollquote von 34 %. Gezählt werden nur Betriebe mit Zahlen in beiden Jahren.',
    anzeige: 'table',
    // Service, Kueche, Bar, Gesamt (Kasse), Ohne GF (BWA) -- fest.
    zeilen_max: 5,
    parameter: FILTER,
    sql: `${MONAT_CTE}
, auswahl AS (
    SELECT r.* FROM mart.round_table_monat r CROSS JOIN gewaehlt g WHERE ${AUSWAHL}
), kasse AS (
    SELECT b.bereich, b.nr, b.ist_eur, b.ist_nenner, b.vj_eur, b.vj_nenner, b.ampel
      FROM auswahl r
      CROSS JOIN gewaehlt g
      JOIN mart.personal_bereich_monat pm ON pm.betrieb_key = r.betrieb_key AND pm.monat = g.monat
      JOIN mart.personal_bereich_monat pv ON pv.betrieb_key = r.betrieb_key
                                         AND pv.monat = (g.monat - interval '1 year')::date
      CROSS JOIN LATERAL (VALUES
          ('Service',        1, pm.pk_service_eur, pm.umsatz_gesamt,    pv.pk_service_eur, pv.umsatz_gesamt,    r.ampel_pk_service),
          ('Küche',          2, pm.pk_kueche_eur,  pm.umsatz_speisen,   pv.pk_kueche_eur,  pv.umsatz_speisen,   r.ampel_pk_kueche),
          ('Bar',            3, pm.pk_bar_eur,     pm.umsatz_getraenke, pv.pk_bar_eur,     pv.umsatz_getraenke, r.ampel_pk_bar),
          ('Gesamt (Kasse)', 4, pm.pk_gesamt_eur,  pm.umsatz_gesamt,    pv.pk_gesamt_eur,  pv.umsatz_gesamt,    NULL::text)
      ) AS b(bereich, nr, ist_eur, ist_nenner, vj_eur, vj_nenner, ampel)
     WHERE b.ist_eur IS NOT NULL AND b.vj_eur IS NOT NULL
), bwa AS (
    SELECT 'Ohne GF (BWA)'::text AS bereich, 5 AS nr,
           ki.pk AS ist_eur, ki.umsatz AS ist_nenner, kv.pk AS vj_eur, kv.umsatz AS vj_nenner,
           r.ampel_personal AS ampel
      FROM auswahl r
      CROSS JOIN LATERAL (
          SELECT max(k.wert_absolut) FILTER (WHERE k.kennzahl = 'Personalkosten ohne GF') AS pk,
                 max(k.wert_absolut) FILTER (WHERE k.kennzahl = 'Umsatz')                 AS umsatz
            FROM mart.kennzahlen_aktuell k
           WHERE k.betrieb_key = r.betrieb_key AND k.monat = r.bwa_monat) ki
      CROSS JOIN LATERAL (
          SELECT max(k.wert_absolut) FILTER (WHERE k.kennzahl = 'Personalkosten ohne GF') AS pk,
                 max(k.wert_absolut) FILTER (WHERE k.kennzahl = 'Umsatz')                 AS umsatz
            FROM mart.kennzahlen_aktuell k
           WHERE k.betrieb_key = r.betrieb_key
             AND k.monat = (r.bwa_monat - interval '1 year')::date) kv
     WHERE coalesce(ki.pk, 0) <> 0 AND coalesce(kv.pk, 0) <> 0
), alle AS (
    SELECT * FROM kasse UNION ALL SELECT * FROM bwa
)
SELECT bereich                                                         AS "Bereich",
       round(sum(ist_eur))                                             AS "Ist €",
       round(sum(vj_eur))                                              AS "VJ €",
       round(sum(ist_eur) - sum(vj_eur))                               AS "Δ €",
       round(100 * sum(ist_eur) / nullif(sum(ist_nenner), 0), 1)       AS "Ist %",
       round(100 * sum(vj_eur) / nullif(sum(vj_nenner), 0), 1)         AS "VJ %",
       round(100 * sum(ist_eur) / nullif(sum(ist_nenner), 0)
           - 100 * sum(vj_eur) / nullif(sum(vj_nenner), 0), 1)         AS "Δ Pkt.",
       CASE WHEN nr = 5 THEN 'Budget' WHEN nr = 4 THEN '–' ELSE 'Vorjahr' END AS "Ampel gegen",
       ${verteilung('ampel')}                                          AS "Ampeln",
       count(*)                                                        AS "Betriebe"
  FROM alle
 GROUP BY bereich, nr
 ORDER BY nr`,
    visualisierung: {
      column_settings: {
        '["name","Ist €"]': EURO, '["name","VJ €"]': EURO, '["name","Δ €"]': EURO,
      },
    },
  },
  {
    // Die Frage aus Daniels Rueckmeldung: Effektivitaet pro Stunde. Kommt
    // aus LINA (eff_*), je Bereich mit dem eigenen Nenner; fuer die Gruppe
    // stundengewichtet (Umsatz durch Stunden), nicht gemittelt.
    schluessel: 'mg_effektivitaet',
    name: 'Umsatz je Personalstunde',
    beschreibung: 'Die Effektivität aus LINA: Umsatz je Arbeitsstunde im Bereich — Service gegen den Gesamtumsatz, Küche gegen Speisen, Bar gegen Getränke. Bei mehreren Betrieben Umsatz durch Stunden der Gruppe, nicht der Mittelwert der Betriebe.',
    anzeige: 'table',
    // Service, Kueche, Bar, Gesamt -- fest.
    zeilen_max: 4,
    parameter: FILTER,
    sql: `${MONAT_CTE}
SELECT b.bereich                                                                       AS "Bereich",
       round(sum(b.ist_umsatz) / nullif(sum(b.ist_stunden), 0), 1)                     AS "Ist €/Std.",
       round(sum(b.vj_umsatz)  / nullif(sum(b.vj_stunden), 0), 1)                      AS "VJ €/Std.",
       round(sum(b.ist_umsatz) / nullif(sum(b.ist_stunden), 0)
           - sum(b.vj_umsatz)  / nullif(sum(b.vj_stunden), 0), 1)                      AS "Δ €/Std.",
       round(sum(b.ist_stunden))                                                       AS "Stunden",
       round(sum(b.vj_stunden))                                                        AS "Stunden VJ"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
  JOIN mart.personal_bereich_monat pm ON pm.betrieb_key = r.betrieb_key AND pm.monat = g.monat
  JOIN mart.personal_bereich_monat pv ON pv.betrieb_key = r.betrieb_key
                                     AND pv.monat = (g.monat - interval '1 year')::date
  CROSS JOIN LATERAL (VALUES
      ('Service', 1, pm.umsatz_gesamt,    pm.stunden_service, pv.umsatz_gesamt,    pv.stunden_service),
      ('Küche',   2, pm.umsatz_speisen,   pm.stunden_kueche,  pv.umsatz_speisen,   pv.stunden_kueche),
      ('Bar',     3, pm.umsatz_getraenke, pm.stunden_bar,     pv.umsatz_getraenke, pv.stunden_bar),
      ('Gesamt',  4, pm.umsatz_gesamt,    pm.stunden_gesamt,  pv.umsatz_gesamt,    pv.stunden_gesamt)
  ) AS b(bereich, nr, ist_umsatz, ist_stunden, vj_umsatz, vj_stunden)
 WHERE ${AUSWAHL}
   AND b.ist_stunden > 0 AND b.vj_stunden > 0
 GROUP BY b.bereich, b.nr
 ORDER BY b.nr`,
  },

  // -------------------------------------------------------------------
  // Wareneinsatz
  // -------------------------------------------------------------------
  {
    schluessel: 'mg_wareneinsatz',
    name: 'Wareneinsatz',
    beschreibung: 'Tatsächlicher Wareneinsatz laut BWA gegen das Soll — im letzten gebuchten Monat und kumuliert seit Januar (YTD). „Soll (gewichtet)" ist der Wareneinsatz, der beim Soll der jeweiligen Marke erreichbar wäre, gewichtet mit den Erlösen der einzelnen Betriebe. „Abweichung €" ist der Wareneinsatz über (+) oder unter (−) diesem Soll in Euro. Bei mehreren Betrieben wird summiert, nicht gemittelt: große Betriebe zählen entsprechend mehr. Die Ampeln zählen die Betriebe im letzten gebuchten Monat — grün bis +0,5 Punkte über Soll, gelb bis +1,0, rot darüber. Getränke bei den Deutschen Konzepten ohne Soll und deshalb nicht enthalten: die Brauereibindungen machen sie untereinander unvergleichbar.',
    anzeige: 'table',
    // Kueche und Getraenke -- fest.
    zeilen_max: 2,
    parameter: FILTER,
    // SUMMEN STATT MEDIANE (05.10.2026, Eugene: "wir sehen nur den
    // optimal zu erreichenden Wareneinsatz, nicht die Abweichung zum
    // tatsaechlichen"). Vorher standen Ist, Soll und Abweichung je als
    // Median ueber die Betriebe da -- drei Mediane verschiedener Betriebe,
    // die nicht zueinander passten (Ist 22,88, Soll 24, Abweichung -0,83)
    // und keinen Euro-Betrag kannten.
    //
    // Euro aus der BWA: wert_absolut ist der Wareneinsatz in Euro, der
    // Nenner (Erloese Speisen bzw. Getraenke) wird aus Euro / Prozent
    // zurueckgerechnet. Gegenprobe Juni 2026, acht groesste Betriebe:
    // Erloese Speisen + Getraenke = 99,3 bis 100,6 % des BWA-Umsatzes.
    // Plausibilitaetsgrenze 150 % wie in mart.round_table_basis.
    //
    // Soll je Betrieb aus round_table_monat (das Soll der Marke zum
    // gewaehlten Monat), fuer alle Monate der YTD dasselbe. Betriebe ohne
    // Soll (Getraenke der Deutschen Konzepte) fallen aus Ist UND Soll
    // heraus -- sonst stuende im Ist ein Umsatz, gegen den kein Soll steht.
    sql: `${MONAT_CTE}
, auswahl AS (
    SELECT r.* FROM mart.round_table_monat r CROSS JOIN gewaehlt g WHERE ${AUSWAHL}
), bwa AS (
    SELECT x.bereich, x.nr, (k.monat = a.bwa_monat) AS ist_monat,
           k.wert_absolut                          AS we_eur,
           k.wert_absolut / (k.wert_prozent / 100) AS erloes,
           x.soll
      FROM auswahl a
      JOIN mart.kennzahlen_aktuell k
        ON k.betrieb_key = a.betrieb_key
       AND k.kennzahl IN ('WE Küche', 'WE Bar')
       AND k.monat BETWEEN date_trunc('year', a.bwa_monat)::date AND a.bwa_monat
      CROSS JOIN LATERAL (SELECT
             CASE k.kennzahl WHEN 'WE Küche' THEN 'Küche' ELSE 'Getränke' END AS bereich,
             CASE k.kennzahl WHEN 'WE Küche' THEN 1 ELSE 2 END                AS nr,
             CASE k.kennzahl WHEN 'WE Küche' THEN a.we_kueche_soll_pct
                                             ELSE a.we_bar_soll_pct END       AS soll) x
     WHERE a.bwa_monat IS NOT NULL
       AND x.soll IS NOT NULL
       AND k.wert_absolut > 0
       AND k.wert_prozent > 0 AND k.wert_prozent <= 150
), summe AS (
    SELECT bereich, nr,
           sum(we_eur)              FILTER (WHERE ist_monat) AS we_m,
           sum(erloes)              FILTER (WHERE ist_monat) AS erl_m,
           sum(erloes * soll / 100) FILTER (WHERE ist_monat) AS soll_m,
           sum(we_eur)                                       AS we_j,
           sum(erloes)                                       AS erl_j,
           sum(erloes * soll / 100)                          AS soll_j
      FROM bwa
     GROUP BY bereich, nr
), ampeln AS (
    SELECT b.bereich, ${verteilung('b.ampel')} AS ampeln
      FROM auswahl r
      CROSS JOIN LATERAL (VALUES ('Küche', r.ampel_we_kueche), ('Getränke', r.ampel_we_bar)) AS b(bereich, ampel)
     GROUP BY b.bereich
)
SELECT s.bereich                                          AS "Bereich",
       round(s.we_m / nullif(s.erl_m, 0) * 100, 2)              AS "Ist %",
       round(s.soll_m / nullif(s.erl_m, 0) * 100, 2)            AS "Soll % (gewichtet)",
       round((s.we_m - s.soll_m) / nullif(s.erl_m, 0) * 100, 2) AS "Abweichung (Pkt.)",
       round(s.we_m - s.soll_m)                                 AS "Abweichung €",
       round(s.we_j / nullif(s.erl_j, 0) * 100, 2)              AS "Ist YTD %",
       round(s.soll_j / nullif(s.erl_j, 0) * 100, 2)            AS "Soll YTD %",
       round((s.we_j - s.soll_j) / nullif(s.erl_j, 0) * 100, 2) AS "Abweichung YTD (Pkt.)",
       round(s.we_j - s.soll_j)                                 AS "Abweichung YTD €",
       a.ampeln                                                 AS "Ampeln"
  FROM summe s
  LEFT JOIN ampeln a ON a.bereich = s.bereich
 ORDER BY s.nr`,
    visualisierung: {
      column_settings: {
        '["name","Abweichung €"]': EURO,
        '["name","Abweichung YTD €"]': EURO,
      },
    },
  },

  // -------------------------------------------------------------------
  // Gaestefeedback
  // -------------------------------------------------------------------
  {
    schluessel: 'mg_yext_monat',
    name: 'Bewertungen im Monat',
    beschreibung: 'Wie viele Bewertungen im gewählten Monat kamen, über alle Portale, und ihr Schnitt. Anders als die Google-Bewertung oben zählt hier nur dieser eine Monat.',
    anzeige: 'scalar',
    parameter: FILTER,
    sql: `${MONAT_CTE}
SELECT sum(t.bewertungen) || ' Bewertungen · Ø '
       || ${zahl('round(sum(t.sterne_summe) / nullif(sum(t.bewertet), 0), 2)', 'FM0.00')} || ' ★'
           AS "Bewertungen im Monat"
  FROM mart.bewertung_tag t
  CROSS JOIN gewaehlt g
  JOIN mart.round_table_monat r ON r.betrieb_key = t.betrieb_key AND r.monat = g.monat
 WHERE t.monat = g.monat
   AND ${AUSWAHL}`,
    visualisierung: { 'scalar.field': 'Bewertungen im Monat' },
  },
  {
    /*
     * Daniel wollte eine Wortwolke. Metabase kann keine, und sie waere
     * auch nicht die bessere Form: in einer Wolke liest man die Groesse
     * eines Wortes, nicht, ob es gelobt oder beklagt wird. Die Rangliste
     * sagt beides — wie oft (Nennungen) und wie es ausfaellt (Sterne).
     *
     * Die Themen vergibt Yext selbst (KI-Klassifikation), erst ab April
     * 2026 lueckenlos. Drei Monate statt einem: in einem Monat hat ein
     * einzelner Betrieb oft nur eine Handvoll Nennungen je Thema.
     */
    schluessel: 'mg_yext_themen',
    name: 'Worüber Gäste schreiben',
    beschreibung: 'Die Themen, die Yext in den Bewertungstexten erkennt, aus den letzten drei Monaten bis zum gewählten Monat. 👍 heißt: im Schnitt besser bewertet als die Bewertungen insgesamt, 👎 schlechter. Die fünf am häufigsten genannten, das häufigste oben.',
    anzeige: 'table',
    // LIMIT 5 -- die haeufigsten fuenf reichen fuer die Uebersicht.
    zeilen_max: 5,
    parameter: FILTER,
    sql: `${MONAT_CTE}
, betriebe AS (
    SELECT r.betrieb_key FROM mart.round_table_monat r CROSS JOIN gewaehlt g WHERE ${AUSWAHL}
), themen AS (
    SELECT ${themaDeutsch('t.')} AS thema,
           sum(t.anzahl)                                              AS nennungen,
           round(sum(t.schnitt * t.anzahl) / nullif(sum(t.anzahl), 0), 2) AS sterne
      FROM mart.bewertung_thema t
      CROSS JOIN gewaehlt g
     WHERE t.laufend
       AND t.monat BETWEEN (g.monat - interval '2 months')::date AND g.monat
       AND t.betrieb_key IN (SELECT betrieb_key FROM betriebe)
     GROUP BY 1
), gesamt AS (
    SELECT sum(sterne * nennungen) / nullif(sum(nennungen), 0) AS schnitt FROM themen
)
SELECT CASE WHEN th.sterne >= ge.schnitt THEN '👍' ELSE '👎' END AS " ",
       th.thema                                                AS "Thema",
       th.nennungen                                            AS "Nennungen",
       th.sterne                                               AS "Ø Sterne"
  FROM themen th
  CROSS JOIN gesamt ge
 ORDER BY th.nennungen DESC
 LIMIT 5`,
  },

  // -------------------------------------------------------------------
  // Bounti
  // -------------------------------------------------------------------
  {
    schluessel: 'mg_bounti_gesamt',
    name: 'Schulung gesamt',
    beschreibung: 'Aus Bounti, Stand heute — der Monatsfilter wirkt hier nicht. „Teilnahme" zählt die aktiven Mitarbeitenden mit mindestens einer abgeschlossenen Schulung — Bounti kennt keinen Zustand „begonnen". Den Personalstand laut LINA holen wir noch nicht ab; bis dahin sind der Maßstab die Konten in Bounti. Ampeln nur für Betriebe mit genügend Zuweisungen.',
    anzeige: 'table',
    // Vier feste Kennzahlzeilen.
    zeilen_max: 4,
    parameter: BOUNTI_FILTER,
    sql: `
WITH q AS (
    SELECT * FROM mart.bounti_quote_betrieb q
     WHERE q.operativ AND q.in_bounti
       [[AND q.betrieb = {{betrieb}}]]
       [[AND q.konzept = {{marke}}]]
)
SELECT 'Mitarbeitende in Bounti' AS "Kennzahl",
       ${zahl('sum(koepfe_aktiv)', 'FM999990')} AS "Wert", NULL::text AS "Ampeln" FROM q
UNION ALL
SELECT 'Teilnahme (mind. 1 Abschluss)',
       ${zahl('round(100.0 * sum(koepfe_mit_abschluss) / nullif(sum(koepfe_aktiv), 0), 1)')} || ' %',
       ${verteilung('ampel_teilnahme')} FROM q
UNION ALL
SELECT 'Abschlussquote',
       ${zahl('round(100.0 * sum(abgeschlossen) / nullif(sum(zuweisungen), 0), 1)')} || ' %',
       ${verteilung('ampel_abschluss')} FROM q
UNION ALL
SELECT 'Durchschnittliche Punkte',
       ${zahl('round(sum(punkte_schnitt_pct * abgeschlossen) / nullif(sum(abgeschlossen) FILTER (WHERE punkte_schnitt_pct IS NOT NULL), 0), 1)')} || ' %',
       NULL FROM q`,
  },
  {
    schluessel: 'mg_bounti_kurse',
    name: 'Kurse',
    beschreibung: 'Die Kurse und Pfade mit den meisten Teilnehmenden, Stand heute — der Monatsfilter wirkt hier nicht. „Rang" ordnet nach Abschlussquote: 1 ist die am besten abgeschlossene. Ein Kurs, der über alle Betriebe schwach steht, ist eher ein Problem des Kurses als der Betriebe.',
    anzeige: 'table',
    parameter: BOUNTI_FILTER,
    sql: `
WITH k AS (
    SELECT l.lerneinheit,
           sum(l.koepfe)        AS teilnehmer,
           sum(l.zugewiesen)    AS zugewiesen,
           sum(l.abgeschlossen) AS abgeschlossen
      FROM mart.bounti_lerneinheit_betrieb l
     WHERE l.operativ
       [[AND l.betrieb = {{betrieb}}]]
       [[AND l.konzept = {{marke}}]]
     GROUP BY l.lerneinheit
)
SELECT lerneinheit                                                   AS "Kurs",
       teilnehmer                                                    AS "Teilnehmer",
       round(100.0 * abgeschlossen / nullif(zugewiesen, 0), 1)       AS "Abschlussquote %",
       rank() OVER (ORDER BY abgeschlossen::numeric / nullif(zugewiesen, 0) DESC NULLS LAST) AS "Rang"
  FROM k
 ORDER BY teilnehmer DESC
 LIMIT 15`,
  },

  // -------------------------------------------------------------------
  // Die fuenf Handlungsfelder
  // -------------------------------------------------------------------
  {
    /*
     * Rot vor gelb, und innerhalb derselben Farbe nach dem Abstand zur
     * Gruenschwelle, gemessen in Breiten des gelben Bandes. Damit sind
     * Personal (Band 1 Pkt.) und Umsatz (Band 4 %) vergleichbar: "zwei
     * Baender ueber gruen" ist in beiden Bereichen gleich weit weg.
     *
     * Die Schwellen kommen aus ampel.regel des Standardregelwerks, nicht
     * aus dieser Datei. Bounti (Stand heute) kommt dazu, weil Daniel es
     * ausdruecklich als Handlungsfeld genannt hat; es traegt dieselbe
     * Rechnung. Das schwaechste Yext-Thema NICHT: es hat keine Schwelle,
     * und ein Handlungsfeld ohne Massstab liesse sich nicht einordnen —
     * es steht eine Tabelle weiter oben.
     */
    schluessel: 'mg_handlungsfelder',
    name: 'Top 5 Handlungsfelder',
    beschreibung: 'Die fünf dringendsten Abweichungen im gewählten Monat: erst alles Rote, dann Gelbes, jeweils das am weitesten vom Grün entfernte zuerst. Ohne Betriebsauswahl über alle Betriebe — dann steht dabei, welcher Betrieb es ist. Ein Klick auf den Betrieb stellt die Seite auf ihn ein.',
    anzeige: 'table',
    // LIMIT 5.
    zeilen_max: 5,
    parameter: FILTER,
    sql: `${MONAT_CTE}
, regel AS (
    SELECT r.* FROM ampel.regel r
      JOIN ampel.regelwerk w ON w.regelwerk_key = r.regelwerk_key AND w.ist_standard
), kandidat AS (
    SELECT a.betrieb, a.bereich, a.ampel,
           CASE a.bereich
             WHEN 'umsatz'     THEN 'Umsatz ' || ${vz('a.wert')} || ' % ggü. Vorjahr'
             WHEN 'personal'   THEN 'Personalkosten o. GF ' || ${vz('a.abweichung')} || ' Pkt. über Budget'
             WHEN 'pk_service' THEN 'Personalkosten Service ' || ${vz('a.abweichung')} || ' Pkt. ggü. Vorjahr'
             WHEN 'pk_kueche'  THEN 'Personalkosten Küche ' || ${vz('a.abweichung')} || ' Pkt. ggü. Vorjahr'
             WHEN 'pk_bar'     THEN 'Personalkosten Bar ' || ${vz('a.abweichung')} || ' Pkt. ggü. Vorjahr'
             WHEN 'we_kueche'  THEN 'Wareneinsatz Küche ' || ${vz('a.abweichung')} || ' Pkt. über Soll'
             WHEN 'we_bar'     THEN 'Wareneinsatz Getränke ' || ${vz('a.abweichung')} || ' Pkt. über Soll'
             WHEN 'bewertung'  THEN 'Online-Bewertung nur ' || ${zahl('a.wert', 'FM0.00')} || ' ★'
             WHEN 'rendite'    THEN 'Rendite YTD nur ' || ${zahl('a.wert')} || ' %'
             ELSE a.bereich_name
           END AS text,
           (CASE WHEN rg.richtung = 'niedriger_ist_besser'
                 THEN CASE WHEN rg.bezug = 'abweichung' THEN a.abweichung ELSE a.wert END - rg.schwelle_gruen
                 ELSE rg.schwelle_gruen - CASE WHEN rg.bezug = 'abweichung' THEN a.abweichung ELSE a.wert END
            END) / nullif(abs(rg.schwelle_orange - rg.schwelle_gruen), 0) AS baender
      FROM mart.ampel_bereich a
      CROSS JOIN gewaehlt g
      JOIN regel rg ON rg.bereich = a.bereich
     WHERE a.monat = g.monat
       AND a.operativ
       AND a.ampel IN ('rot', 'orange')
       [[AND a.betrieb = {{betrieb}}]]
       [[AND a.konzept = {{marke}}]]
    UNION ALL
    SELECT q.betrieb, x.bereich, x.ampel,
           x.text,
           (rg.schwelle_gruen - x.wert) / nullif(abs(rg.schwelle_orange - rg.schwelle_gruen), 0)
      FROM mart.bounti_quote_betrieb q
      CROSS JOIN LATERAL (VALUES
          ('bounti_abschluss', q.ampel_abschluss, q.abschluss_pct,
           'Bounti Abschlussquote nur ' || ${zahl('q.abschluss_pct')} || ' %'),
          ('bounti_teilnahme', q.ampel_teilnahme, q.teilnahme_pct,
           'Bounti Teilnahme nur ' || ${zahl('q.teilnahme_pct')} || ' %')
      ) AS x(bereich, ampel, wert, text)
      JOIN regel rg ON rg.bereich = x.bereich
     WHERE q.operativ
       AND x.ampel IN ('rot', 'orange')
       [[AND q.betrieb = {{betrieb}}]]
       [[AND q.konzept = {{marke}}]]
)
SELECT row_number() OVER (ORDER BY (k.ampel = 'rot') DESC, k.baender DESC NULLS LAST) AS "Nr.",
       ${emoji('k.ampel')}                                                            AS " ",
       k.text                                                                        AS "Handlungsfeld",
       k.betrieb                                                                     AS "Betrieb"
  FROM kandidat k
 ORDER BY 1
 LIMIT 5`,
  },
]
