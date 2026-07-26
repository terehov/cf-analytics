// =====================================================================
// Round Table — die vier Dashboards, die JULI_Round_Table_Ampelsystem.xlsx
// ersetzen.
//
// Ein Blatt je Dashboard:
//   00_Dashboard    -> "Round Table — Übersicht"
//   Eingabe         -> darin die grosse Betriebstabelle
//   Trend_2Monate   -> "Round Table — Trend und Ampelhistorie"
//   Ursachenanalyse -> "Round Table — Ursachen und Maßnahmen"
//   Massnahmen      -> ebendort
//   Ampelhistorie   -> faellt weg, die Historie steht ohnehin im Mart
//
// Alle Karten sind SQL-Karten gegen mart. Der Grund ist nicht Bequemlich-
// keit: der Abfrage-Editor kann die Monatsauswahl nicht als Parameter an
// eine Sicht durchreichen, ohne dass jede Karte ihren eigenen Filter
// mitbringt, und die Ampelfarben brauchen eine feste Spaltenreihenfolge.
// =====================================================================

import type { Karte } from './typen'
import { MONAT_CTE, MONAT_CTE_WECHSEL, P_MONAT, P_MARKE } from './gemeinsam'

// Der Monatsfilter, den sich alle Karten eines Dashboards teilen.
// Er ist bewusst NICHT als Pflichtfeld gesetzt: ein Pflichtparameter ohne
// Vorgabe laesst jede Karte beim ersten Oeffnen mit "You'll need to pick a
// value" scheitern. MONAT_CTE faellt stattdessen auf den juengsten Monat
// mit einem Urteil zurueck. Siehe gemeinsam.ts.
const MONAT = { monat: P_MONAT }
const KONZEPT = { konzept: P_MARKE }

export const karten: Karte[] = [
  // -------------------------------------------------------------------
  // Kacheln des Blatts 00_Dashboard (Zeile 5)
  // -------------------------------------------------------------------
  {
    schluessel: 'rt_kachel_rot',
    name: 'Rote Betriebe',
    beschreibung:
      'Betriebe mit mindestens einer roten Ampel im gewählten Monat.',
    anzeige: 'scalar',
    parameter: [MONAT.monat],
    sql: `${MONAT_CTE}
SELECT count(*) AS "Rote Betriebe"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.gesamt = 'rot'
   AND r.monat = g.monat`,
    visualisierung: {
      'scalar.field': 'Rote Betriebe',
      column_settings: {
        '["name","Rote Betriebe"]': { view_as: null },
      },
    },
  },
  {
    schluessel: 'rt_kachel_orange',
    name: 'Orange Betriebe',
    beschreibung: 'Betriebe ohne rote, aber mit mindestens einer orangen Ampel.',
    anzeige: 'scalar',
    parameter: [MONAT.monat],
    sql: `${MONAT_CTE}
SELECT count(*) AS "Orange Betriebe"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.gesamt = 'orange'
   AND r.monat = g.monat`,
  },
  {
    schluessel: 'rt_kachel_gruen',
    name: 'Grüne Betriebe',
    beschreibung: 'Betriebe, bei denen alle bewerteten Ampeln grün sind.',
    anzeige: 'scalar',
    parameter: [MONAT.monat],
    sql: `${MONAT_CTE}
SELECT count(*) AS "Grüne Betriebe"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.gesamt = 'gruen'
   AND r.monat = g.monat`,
  },
  {
    // Diese Kachel hat im Excel kein Pendant, und genau das war das Problem:
    // dort sah ein Betrieb ohne BWA aus wie ein Betrieb ohne Befund.
    schluessel: 'rt_kachel_ohne_urteil',
    name: 'Ohne Urteil',
    beschreibung:
      'Betriebe, für die im gewählten Monat keine einzige Ampel berechnet werden konnte — meist weil die Zahlen vom Steuerberater noch fehlen. Diese Betriebe sind nicht unauffällig, sie sind unbeurteilt.',
    anzeige: 'scalar',
    parameter: [MONAT.monat],
    sql: `${MONAT_CTE}
SELECT count(*) AS "Ohne Urteil"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.gesamt IS NULL
   AND r.monat = g.monat`,
  },
  {
    schluessel: 'rt_kachel_massnahmen',
    name: 'Offene Maßnahmen',
    beschreibung:
      'Maßnahmen im Status Offen, In Arbeit, Eskalieren oder Wartet auf Rückmeldung.',
    anzeige: 'scalar',
    parameter: [MONAT.monat],
    sql: `${MONAT_CTE}
SELECT count(*) AS "Offene Maßnahmen"
  FROM mart.massnahme m
  CROSS JOIN gewaehlt g
 WHERE m.ist_offen
   AND m.monat <= g.monat`,
  },
  {
    schluessel: 'rt_kachel_bewertung',
    name: 'Ø Online-Bewertung',
    beschreibung:
      'Durchschnitt der Online-Bewertungen im gewählten Monat. Zeigt „– nicht erfasst", solange keine Bewertungen eingespielt sind.',
    anzeige: 'scalar',
    parameter: [MONAT.monat],
    sql: `${MONAT_CTE}
SELECT coalesce(to_char(round(avg(r.online_bewertung), 2), 'FM0.00'), '– nicht erfasst')
         AS "Ø Online-Bewertung"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.monat = g.monat`,
  },

  // -------------------------------------------------------------------
  // Rot-Treiber nach Bereich — 00_Dashboard!A9:F11
  //
  // Im Excel sechs COUNTIF nebeneinander. Hier eine Gruppierung, weil
  // mart.ampel_bereich die Ampeln im Langformat fuehrt.
  // -------------------------------------------------------------------
  {
    schluessel: 'rt_treiber',
    name: 'Ampeln nach Bereich',
    beschreibung:
      'Wie viele Betriebe je Bereich auf rot, orange oder grün stehen — und für wie viele die Daten fehlen. Zeigt, woran die roten Ampeln insgesamt hängen.',
    anzeige: 'bar',
    parameter: [MONAT.monat],
    sql: `${MONAT_CTE}
SELECT a.bereich_name                                   AS "Bereich",
       count(*) FILTER (WHERE a.ampel = 'rot')        AS "Rot",
       count(*) FILTER (WHERE a.ampel = 'orange')     AS "Orange",
       count(*) FILTER (WHERE a.ampel = 'gruen')      AS "Grün",
       count(*) FILTER (WHERE a.ampel IS NULL)        AS "Keine Daten"
  FROM mart.ampel_bereich a
  CROSS JOIN gewaehlt g
 WHERE a.monat = g.monat
 GROUP BY a.bereich_name, a.reihenfolge
 ORDER BY a.reihenfolge`,
    visualisierung: {
      'graph.dimensions': ['Bereich'],
      'graph.metrics': ['Rot', 'Orange', 'Grün', 'Keine Daten'],
      'stackable.stack_type': 'stacked',
      'graph.x_axis.title_text': 'Bereich',
      'graph.y_axis.title_text': 'Betriebe',
      'graph.show_values': true,
      'series_settings': {
        Rot: { color: '#ED6E6E' },
        Orange: { color: '#F9CF48' },
        'Grün': { color: '#84BB4C' },
        'Keine Daten': { color: '#C7CFD4' },
      },
    },
  },
  {
    schluessel: 'rt_intensitaet',
    name: 'Eskalationsstufen',
    beschreibung:
      'Wie dringend gehandelt werden muss: Sofort eskalieren (2 oder mehr rote Ampeln), Sofort handeln (eine rote), Nachforschung (2 oder mehr orange), Beobachten beziehungsweise in Ordnung.',
    anzeige: 'row',
    parameter: [MONAT.monat],
    sql: `${MONAT_CTE}
SELECT r.intensitaet AS "Intensität",
       count(*)      AS "Betriebe"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.monat = g.monat
   AND r.intensitaet IS NOT NULL
 GROUP BY r.intensitaet
 ORDER BY CASE r.intensitaet
            WHEN 'Sofort eskalieren' THEN 1
            WHEN 'Sofort handeln'    THEN 2
            WHEN 'Nachforschung'     THEN 3
            ELSE 4 END`,
    visualisierung: {
      'graph.dimensions': ['Intensität'],
      'graph.metrics': ['Betriebe'],
      'graph.show_values': true,
    },
  },

  // -------------------------------------------------------------------
  // Die grosse Tabelle — Blatt Eingabe, Spalten A bis AE
  //
  // Die Ampeln kommen als Emoji-Text, damit die Tabelle ohne bedingte
  // Formatierung lesbar ist und auch in einem Export oder einer
  // Abo-Mail funktioniert. Das ist genau die Darstellung des Excels.
  // -------------------------------------------------------------------
  {
    schluessel: 'rt_tabelle',
    name: 'Round Table — Betriebstabelle',
    beschreibung:
      'Eine Zeile je Betrieb mit allem, was für den Round Table zählt: Umsatz mit Vorjahr und Jahressumme, Personal- und Wareneinsatzquoten, Bewertung, Vor-Ort-Score, alle sechs Ampeln, Gesamturteil und Priorität. Sortiert nach Handlungsdruck — oben steht, was zuerst besprochen gehört.',
    anzeige: 'table',
    parameter: [MONAT.monat, KONZEPT.konzept],
    sql: `${MONAT_CTE}
SELECT r.betrieb                                            AS "Betrieb",
       r.stadt                                              AS "Stadt",
       r.konzept                                            AS "Marke",
       r.umsatz_ist                                         AS "Umsatz Ist",
       r.umsatz_vj                                          AS "Umsatz VJ",
       r.umsatz_pct                                         AS "Umsatz %",
       y.umsatz_ytd                                         AS "Umsatz YTD",
       y.umsatz_ytd_vj                                      AS "Umsatz YTD VJ",
       y.umsatz_ytd_pct                                     AS "Umsatz kum. %",
       coalesce(au.emoji, '–')                              AS "Ampel Umsatz",
       r.personalkosten_ogf_pct                             AS "Personal o. GF %",
       coalesce(ap.emoji, '–')                              AS "Ampel Personal",
       r.we_bar_pct                                         AS "WE Bar %",
       coalesce(ab.emoji, '–')                              AS "Ampel WE Bar",
       r.we_kueche_pct                                      AS "WE Küche %",
       coalesce(ak.emoji, '–')                              AS "Ampel WE Küche",
       r.online_bewertung                                   AS "Online-Bewertung",
       coalesce(ao.emoji, '–')                              AS "Ampel Bewertung",
       r.om_score                                           AS "OM Score",
       coalesce(am.emoji, '–')                              AS "Ampel OM",
       coalesce(ag.emoji || ' ' || ag.bezeichnung, '– kein Urteil') AS "Gesamtstatus",
       r.intensitaet                                        AS "Intensität",
       r.massnahme                                          AS "Maßnahme?",
       r.prioritaet                                         AS "Priorität",
       r.bwa_monat                                          AS "BWA-Stand",
       u.ursachen                                           AS "Rot-/Orange-Ursachen"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
  LEFT JOIN mart.umsatz_ytd y  ON y.betrieb_key = r.betrieb_key AND y.monat = r.monat
  LEFT JOIN ampel.beschriftung au ON au.status = r.ampel_umsatz
  LEFT JOIN ampel.beschriftung ap ON ap.status = r.ampel_personal
  LEFT JOIN ampel.beschriftung ab ON ab.status = r.ampel_we_bar
  LEFT JOIN ampel.beschriftung ak ON ak.status = r.ampel_we_kueche
  LEFT JOIN ampel.beschriftung ao ON ao.status = r.ampel_bewertung
  LEFT JOIN ampel.beschriftung am ON am.status = r.ampel_om
  LEFT JOIN ampel.beschriftung ag ON ag.status = r.gesamt
  LEFT JOIN LATERAL (
        SELECT string_agg(DISTINCT a.bereich_name || ': ' || a.ursache, ', ') AS ursachen
          FROM mart.ampel_bereich a
         WHERE a.betrieb_key = r.betrieb_key
           AND a.monat       = r.monat
           AND a.ampel IN ('rot','orange')
           AND a.ursache IS NOT NULL
  ) u ON true
 WHERE r.monat = g.monat
   [[AND r.konzept = {{konzept}}]]
 ORDER BY CASE r.gesamt WHEN 'rot' THEN 1 WHEN 'orange' THEN 2 WHEN 'gruen' THEN 3 ELSE 4 END,
          CASE r.intensitaet
            WHEN 'Sofort eskalieren' THEN 1 WHEN 'Sofort handeln' THEN 2
            WHEN 'Nachforschung'     THEN 3 ELSE 4 END,
          r.betrieb`,
    visualisierung: {
      'table.pivot': false,
      column_settings: {
        '["name","Umsatz Ist"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Umsatz VJ"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Umsatz YTD"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Umsatz YTD VJ"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Umsatz %"]': { suffix: ' %', decimals: 1 },
        '["name","Umsatz kum. %"]': { suffix: ' %', decimals: 1 },
        '["name","Personal o. GF %"]': { suffix: ' %', decimals: 1 },
        '["name","WE Bar %"]': { suffix: ' %', decimals: 1 },
        '["name","WE Küche %"]': { suffix: ' %', decimals: 1 },
      },
    },
  },

  // -------------------------------------------------------------------
  // Blatt Trend_2Monate
  // -------------------------------------------------------------------
  {
    schluessel: 'rt_ampelwechsel',
    name: 'Wer hat die Farbe gewechselt',
    beschreibung:
      'Betriebe, deren Ampel sich gegenüber dem Vormonat verändert hat. Verschlechterungen zuerst — hier fängt ein Round Table an.',
    anzeige: 'table',
    parameter: [MONAT.monat],
    sql: `${MONAT_CTE_WECHSEL}
SELECT t.betrieb                          AS "Betrieb",
       t.stadt                            AS "Stadt",
       t.bereich_name                     AS "Bereich",
       t.wert_vormonat                    AS "Vormonat",
       t.wert                             AS "Aktuell",
       t.veraenderung                     AS "Veränderung",
       t.trend                            AS "Trend",
       coalesce(av.emoji, '–') || ' → ' || coalesce(an.emoji, '–') AS "Ampel",
       t.ampelwechsel                     AS "Wechsel"
  FROM mart.round_table_trend t
  CROSS JOIN gewaehlt g
  LEFT JOIN ampel.beschriftung av ON av.status = t.ampel_vormonat
  LEFT JOIN ampel.beschriftung an ON an.status = t.ampel
 WHERE t.monat = g.monat
   AND t.ampelwechsel IN ('verschlechtert','verbessert')
 ORDER BY CASE t.ampelwechsel WHEN 'verschlechtert' THEN 1 ELSE 2 END,
          t.reihenfolge, t.betrieb`,
  },
  {
    schluessel: 'rt_trend_tabelle',
    name: 'Drei-Monats-Trend je Betrieb',
    beschreibung:
      'Die letzten drei Monate je Betrieb und Bereich nebeneinander: ↗ besser oder gleich, ↘ schlechter. Die Vormonate stehen automatisch da und müssen nicht mehr eingetragen werden.',
    anzeige: 'table',
    parameter: [MONAT.monat],
    sql: `${MONAT_CTE}
SELECT betrieb            AS "Betrieb",
       stadt              AS "Stadt",
       bereich_name       AS "Bereich",
       wert_vorvormonat   AS "vorletzter Monat",
       wert_vormonat      AS "Vormonat",
       wert               AS "Aktuell",
       veraenderung       AS "Veränderung",
       trend              AS "Trend"
  FROM mart.round_table_trend t
  CROSS JOIN gewaehlt g
 WHERE t.monat = g.monat
   AND t.wert IS NOT NULL
 ORDER BY t.betrieb, t.reihenfolge`,
  },
  {
    schluessel: 'rt_historie',
    name: 'Ampelhistorie',
    beschreibung:
      'Wie sich die Gesamtampel über die Monate verteilt hat. Die Historie schreibt sich von selbst fort.',
    anzeige: 'bar',
    sql: `
SELECT monat                                        AS "Monat",
       count(*) FILTER (WHERE gesamt = 'rot')       AS "Rot",
       count(*) FILTER (WHERE gesamt = 'orange')    AS "Orange",
       count(*) FILTER (WHERE gesamt = 'gruen')     AS "Grün",
       count(*) FILTER (WHERE gesamt IS NULL)       AS "Kein Urteil"
  FROM mart.round_table_monat
 GROUP BY monat
 ORDER BY monat`,
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Rot', 'Orange', 'Grün', 'Kein Urteil'],
      'stackable.stack_type': 'stacked',
      'graph.y_axis.title_text': 'Betriebe',
      series_settings: {
        Rot: { color: '#ED6E6E' },
        Orange: { color: '#F9CF48' },
        'Grün': { color: '#84BB4C' },
        'Kein Urteil': { color: '#C7CFD4' },
      },
    },
  },
  {
    schluessel: 'rt_historie_bereich',
    name: 'Ampelhistorie je Bereich',
    beschreibung: 'Wie viele rote Ampeln je Bereich über die Monate zusammenkamen — zeigt, ob ein Problem neu ist oder mitläuft.',
    anzeige: 'line',
    sql: `
SELECT monat                                  AS "Monat",
       bereich_name                           AS "Bereich",
       count(*) FILTER (WHERE ampel = 'rot')  AS "Rote Ampeln"
  FROM mart.ampel_bereich
 GROUP BY monat, bereich_name, reihenfolge
 ORDER BY monat, reihenfolge`,
    visualisierung: {
      'graph.dimensions': ['Monat', 'Bereich'],
      'graph.metrics': ['Rote Ampeln'],
    },
  },

  // -------------------------------------------------------------------
  // Blatt Ursachenanalyse und Massnahmen
  // -------------------------------------------------------------------
  {
    schluessel: 'rt_ursachen',
    name: 'Ursachen je Bereich',
    beschreibung:
      'Wie oft welche Ursache hinter einer roten oder orangen Ampel steht, aufgeteilt nach Bereich. Ab drei Fällen gilt die Priorität als hoch, bei zwei als mittel.',
    anzeige: 'table',
    parameter: [MONAT.monat],
    sql: `${MONAT_CTE}
SELECT ursache      AS "Ursache",
       umsatz       AS "Umsatz",
       personal     AS "Personal",
       we_bar       AS "WE Bar",
       we_kueche    AS "WE Küche",
       faelle       AS "Gesamt",
       prioritaet   AS "Priorität",
       betriebe     AS "Betriebe"
  FROM mart.ursachen_analyse u
  CROSS JOIN gewaehlt g
 WHERE u.monat = g.monat
 ORDER BY u.faelle DESC, u.reihenfolge`,
  },
  {
    schluessel: 'rt_ursachen_verlauf',
    name: 'Ursachen im Zeitverlauf',
    beschreibung: 'Welche Ursachen über die Monate hinweg häufiger werden. Eine Ursache, die jeden Monat wiederkommt, ist ein anderes Problem als eine einmalige.',
    anzeige: 'bar',
    sql: `
SELECT monat    AS "Monat",
       ursache  AS "Ursache",
       faelle   AS "Fälle"
  FROM mart.ursachen_analyse
 WHERE faelle > 0
 ORDER BY monat, faelle DESC`,
    visualisierung: {
      'graph.dimensions': ['Monat', 'Ursache'],
      'graph.metrics': ['Fälle'],
      'stackable.stack_type': 'stacked',
    },
  },
  {
    schluessel: 'rt_massnahmen_offen',
    name: 'Offene Maßnahmen',
    beschreibung:
      'Alle Maßnahmen, die noch nicht erledigt sind. Überfällige zuerst.',
    anzeige: 'table',
    sql: `
SELECT CASE WHEN ueberfaellig THEN '⚠ überfällig' ELSE '' END AS "!",
       betrieb          AS "Betrieb",
       monat            AS "Monat",
       bereich          AS "Bereich",
       ursache          AS "Ursache",
       massnahme        AS "Maßnahme",
       verantwortlich   AS "Verantwortlich",
       faellig_am       AS "Fällig",
       tage_bis_faellig AS "Tage",
       status           AS "Status",
       prioritaet       AS "Priorität",
       fortschritt      AS "Fortschritt %",
       notizen          AS "Notizen"
  FROM mart.massnahme
 WHERE ist_offen
 ORDER BY ueberfaellig DESC,
          CASE prioritaet WHEN 'Hoch' THEN 1 WHEN 'Mittel' THEN 2 ELSE 3 END,
          faellig_am NULLS LAST`,
  },
  {
    schluessel: 'rt_massnahmen_status',
    name: 'Maßnahmen nach Status',
    beschreibung: 'Wie sich alle Maßnahmen auf die Status verteilen.',
    anzeige: 'row',
    sql: `
SELECT status   AS "Status",
       count(*) AS "Maßnahmen"
  FROM mart.massnahme
 GROUP BY status
 ORDER BY count(*) DESC`,
    visualisierung: {
      'graph.dimensions': ['Status'],
      'graph.metrics': ['Maßnahmen'],
      'graph.show_values': true,
    },
  },

  // -------------------------------------------------------------------
  // Markenschnitt — im Excel nicht vorhanden, weil dort nur ein Konzept
  // gepflegt wurde (22 Enchilada-Betriebe). Bei 141 Betrieben ist die
  // Frage "schwaechelt der Betrieb oder seine ganze Marke" die erste,
  // die vor jeder Massnahme steht.
  // -------------------------------------------------------------------
  {
    schluessel: 'rt_marke',
    name: 'Marken im Kennzahlenvergleich',
    beschreibung:
      'Eine Zeile je Marke: Umsatzsumme, mittlere Quoten und Ampelverteilung. Die Prozentwerte sind Mediane, also der mittlere Betrieb der Marke — ein einzelner Ausreißer verzieht so nicht das Bild der ganzen Marke.',
    anzeige: 'table',
    parameter: [MONAT.monat],
    sql: `${MONAT_CTE}
SELECT konzept                AS "Marke",
       betriebe               AS "Betriebe",
       umsatz_ist             AS "Umsatz",
       umsatz_pct             AS "Umsatz % (Median)",
       personalkosten_ogf_pct AS "Personal % (Median)",
       we_bar_pct             AS "WE Bar % (Median)",
       we_kueche_pct          AS "WE Küche % (Median)",
       ampeln_rot             AS "Rot",
       ampeln_orange          AS "Orange",
       ampeln_gruen           AS "Grün",
       massnahme_faellig      AS "Maßnahme fällig"
  FROM gewaehlt g, LATERAL mart.konzept_schnitt(g.monat)
 ORDER BY umsatz_ist DESC NULLS LAST`,
  },
  {
    schluessel: 'rt_marke_abweichung',
    name: 'Betrieb gegen Marke und Gesamt',
    beschreibung:
      'Je Kennzahl der Abstand zum Mittelfeld aller Betriebe und zum Mittelfeld der eigenen Marke. So ist unterscheidbar, ob ein einzelner Betrieb schwächelt oder seine ganze Marke — im zweiten Fall läuft eine Maßnahme beim einzelnen Betrieb ins Leere. Achtung beim Vorzeichen: beim Umsatz ist mehr besser, bei den Quoten weniger.',
    anzeige: 'table',
    parameter: [MONAT.monat],
    sql: `${MONAT_CTE}
SELECT betrieb                AS "Betrieb",
       konzept                AS "Marke",
       umsatz_pct             AS "Umsatz %",
       umsatz_abw_marke       AS "Δ Marke",
       umsatz_abw_gesamt      AS "Δ Gesamt",
       personalkosten_ogf_pct AS "Personal %",
       personal_abw_marke     AS "Δ Marke ",
       personal_abw_gesamt    AS "Δ Gesamt ",
       we_kueche_pct          AS "WE Küche %",
       we_kueche_abw_marke    AS "Δ Marke  ",
       we_kueche_abw_gesamt   AS "Δ Gesamt  ",
       gesamt                 AS "Status",
       prioritaet             AS "Priorität"
  FROM gewaehlt g, LATERAL mart.round_table_marke(g.monat)
 WHERE gesamt IS NOT NULL
 ORDER BY konzept, betrieb`,
  },
  {
    schluessel: 'rt_regelwerk_vergleich',
    name: 'Vergleich der Schwellenwerte',
    beschreibung:
      'Betriebe, bei denen die einheitlichen Round-Table-Schwellen (28/32 %) zu einem anderen Urteil führen als die betriebsindividuellen Schwellen aus LINA. Nur diese Fälle sind strittig — bei allen übrigen erübrigt sich die Diskussion.',
    anzeige: 'table',
    parameter: [MONAT.monat],
    sql: `${MONAT_CTE}
SELECT betrieb                AS "Betrieb",
       stadt                  AS "Stadt",
       personalkosten_ogf_pct AS "Personal %",
       ampel_personal_global  AS "Ampel global",
       ampel_personal_betrieb AS "Ampel LINA",
       gesamt_global          AS "Gesamt global",
       gesamt_betrieb         AS "Gesamt LINA",
       abweichung             AS "Unterschied"
  FROM gewaehlt g, LATERAL mart.round_table_vergleich(g.monat)
 WHERE weicht_ab
 ORDER BY betrieb`,
  },
]
