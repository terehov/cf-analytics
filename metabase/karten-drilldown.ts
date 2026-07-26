// =====================================================================
// Die Drill-Down-Kette: Marke → Filiale → Betrieb
//
// Drei Ebenen, jede eine Zeile pro Einheit der jeweiligen Stufe, jede mit
// denselben sechs Metriken und denselben Ampeln. Wer auf einer Ebene eine
// rote Zahl sieht, klickt sie an und steht eine Ebene tiefer vor
// derselben Frage in feinerer Aufloesung.
//
// Die Ampeln sind auf jeder Ebene die des Round Table — sie werden NICHT
// neu erfunden. Auf Markenebene werden sie gezaehlt, nicht gemittelt: der
// Mittelwert zweier Ampeln ist keine Ampel.
//
// Die Prozentwerte auf Markenebene sind MEDIANE, nicht Mittelwerte. Bei
// 141 Betrieben reicht ein einzelner Ausreisser — ein Neubau im
// Anlaufjahr, ein Betrieb im Umbau — um einen Mittelwert so zu verziehen,
// dass die halbe Marke unterdurchschnittlich aussieht.
// =====================================================================

import type { Karte } from './typen'
import { MONAT_CTE, MONAT_CTE_UMSATZ, ZEITRAUM_CTE, P_MONAT, P_MARKE, P_BETRIEB } from './gemeinsam'

export const karten: Karte[] = [
  // ===================================================================
  // EBENE 1 — Marken
  // ===================================================================
  {
    schluessel: 'dd_marken_tabelle',
    name: 'Marken im Überblick',
    beschreibung:
      'Eine Zeile je Marke mit allen sechs Round-Table-Metriken und der Ampelverteilung. Ein Klick auf eine Zeile öffnet die Filialen dieser Marke. Die Prozentwerte sind MEDIANE — ein einzelner Ausreißer soll den Maßstab einer ganzen Marke nicht verziehen.',
    anzeige: 'table',
    parameter: [P_MONAT],
    sql: `${MONAT_CTE}
SELECT r.konzept                                                          AS "Marke",
       count(*)::int                                                      AS "Betriebe",
       round(sum(r.umsatz_ist), 0)                                        AS "Umsatz",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.umsatz_pct)::numeric, 1)             AS "Umsatz % (Median)",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.personalkosten_ogf_pct)::numeric, 1) AS "Personal %",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.we_bar_pct)::numeric, 1)             AS "WE Bar %",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.we_kueche_pct)::numeric, 1)          AS "WE Küche %",
       round(avg(r.online_bewertung), 2)                                  AS "Ø Bewertung",
       count(*) FILTER (WHERE r.gesamt = 'rot')::int                      AS "🔴",
       count(*) FILTER (WHERE r.gesamt = 'orange')::int                   AS "🟠",
       count(*) FILTER (WHERE r.gesamt = 'gruen')::int                    AS "🟢",
       count(*) FILTER (WHERE r.gesamt IS NULL)::int                      AS "ohne Urteil",
       count(*) FILTER (WHERE r.massnahme = 'Ja')::int                    AS "Maßnahme fällig"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.monat = g.monat
 GROUP BY r.konzept
 ORDER BY count(*) FILTER (WHERE r.gesamt = 'rot') DESC, sum(r.umsatz_ist) DESC NULLS LAST`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Personal %"]': { suffix: ' %' },
        '["name","WE Bar %"]': { suffix: ' %' },
        '["name","WE Küche %"]': { suffix: ' %' },
      },
    },
  },
  {
    schluessel: 'dd_marken_ampeln',
    name: 'Ampeln je Marke',
    beschreibung: 'Wie sich die Gesamtampel innerhalb jeder Marke verteilt. Ein Klick auf einen Balken öffnet die Filialen.',
    anzeige: 'bar',
    parameter: [P_MONAT],
    sql: `${MONAT_CTE}
SELECT r.konzept                                       AS "Marke",
       count(*) FILTER (WHERE r.gesamt = 'rot')        AS "Rot",
       count(*) FILTER (WHERE r.gesamt = 'orange')     AS "Orange",
       count(*) FILTER (WHERE r.gesamt = 'gruen')      AS "Grün",
       count(*) FILTER (WHERE r.gesamt IS NULL)        AS "Ohne Urteil"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.monat = g.monat
 GROUP BY r.konzept
 ORDER BY count(*) FILTER (WHERE r.gesamt = 'rot') DESC`,
    visualisierung: {
      'graph.dimensions': ['Marke'],
      'graph.metrics': ['Rot', 'Orange', 'Grün', 'Ohne Urteil'],
      'stackable.stack_type': 'stacked',
      'graph.show_values': true,
      series_settings: {
        Rot: { color: '#ED6E6E' }, Orange: { color: '#F9CF48' },
        'Grün': { color: '#84BB4C' }, 'Ohne Urteil': { color: '#C7CFD4' },
      },
    },
  },
  {
    schluessel: 'dd_marken_verlauf',
    name: 'Umsatz je Marke im Verlauf',
    beschreibung: 'Monatsumsatz je Marke über die geladene Historie.',
    anzeige: 'line',
    sql: `
SELECT monat                        AS "Monat",
       coalesce(konzept, '(nicht zugeordnet)') AS "Marke",
       sum(umsatz_monat)            AS "Umsatz"
  FROM mart.umsatz_ytd
 GROUP BY monat, konzept
 ORDER BY monat`,
    visualisierung: {
      'graph.dimensions': ['Monat', 'Marke'],
      'graph.metrics': ['Umsatz'],
    },
  },

  // ===================================================================
  // EBENE 2 — Filialen
  // ===================================================================
  {
    schluessel: 'dd_filialen_tabelle',
    name: 'Filialen im Vergleich',
    beschreibung:
      'Alle Betriebe der gewählten Marke über sämtliche Metriken, jede mit ihrer Ampel. Ein Klick auf eine Zeile öffnet das Betriebsblatt. Sortiert nach Handlungsdruck.',
    anzeige: 'table',
    parameter: [P_MONAT, P_MARKE],
    sql: `${MONAT_CTE}
SELECT r.betrieb                                            AS "Betrieb",
       r.konzept                                            AS "Marke",
       r.stadt                                              AS "Stadt",
       coalesce(ag.emoji, '⚪')                              AS "●",
       r.intensitaet                                        AS "Intensität",
       r.umsatz_ist                                         AS "Umsatz",
       r.umsatz_pct                                         AS "Umsatz %",
       coalesce(au.emoji, '⚪')                              AS "◐ Umsatz",
       r.personalkosten_ogf_pct                             AS "Personal %",
       coalesce(ap.emoji, '⚪')                              AS "◐ Personal",
       r.we_bar_pct                                         AS "WE Bar %",
       coalesce(ab.emoji, '⚪')                              AS "◐ WE Bar",
       r.we_kueche_pct                                      AS "WE Küche %",
       coalesce(ak.emoji, '⚪')                              AS "◐ WE Küche",
       r.online_bewertung                                   AS "Bewertung",
       coalesce(ao.emoji, '⚪')                              AS "◐ Bewertung",
       r.om_score                                           AS "OM",
       coalesce(am.emoji, '⚪')                              AS "◐ OM",
       r.prioritaet                                         AS "Priorität",
       r.bwa_monat                                          AS "BWA-Stand"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
  LEFT JOIN ampel.beschriftung au ON au.status = r.ampel_umsatz
  LEFT JOIN ampel.beschriftung ap ON ap.status = r.ampel_personal
  LEFT JOIN ampel.beschriftung ab ON ab.status = r.ampel_we_bar
  LEFT JOIN ampel.beschriftung ak ON ak.status = r.ampel_we_kueche
  LEFT JOIN ampel.beschriftung ao ON ao.status = r.ampel_bewertung
  LEFT JOIN ampel.beschriftung am ON am.status = r.ampel_om
  LEFT JOIN ampel.beschriftung ag ON ag.status = r.gesamt
 WHERE r.monat = g.monat
   [[AND r.konzept = {{marke}}]]
 ORDER BY CASE r.gesamt WHEN 'rot' THEN 1 WHEN 'orange' THEN 2 WHEN 'gruen' THEN 3 ELSE 4 END,
          CASE r.intensitaet WHEN 'Sofort eskalieren' THEN 1 WHEN 'Sofort handeln' THEN 2
                             WHEN 'Nachforschung' THEN 3 ELSE 4 END,
          r.betrieb`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Umsatz %"]': { suffix: ' %' },
        '["name","Personal %"]': { suffix: ' %' },
        '["name","WE Bar %"]': { suffix: ' %' },
        '["name","WE Küche %"]': { suffix: ' %' },
      },
    },
  },
  {
    schluessel: 'dd_filialen_rangliste',
    name: 'Filialen nach Personalkostenquote',
    beschreibung:
      'Die Metrik mit den meisten roten Ampeln, als Rangliste. Die 28-%-Linie ist die Grün-Schwelle des Round Table. Klick auf einen Balken öffnet das Betriebsblatt.',
    anzeige: 'bar',
    parameter: [P_MONAT, P_MARKE],
    sql: `${MONAT_CTE}
SELECT r.betrieb                AS "Betrieb",
       r.personalkosten_ogf_pct AS "Personal o. GF %"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.monat = g.monat
   AND r.personalkosten_ogf_pct IS NOT NULL
   [[AND r.konzept = {{marke}}]]
 ORDER BY r.personalkosten_ogf_pct DESC`,
    visualisierung: {
      'graph.dimensions': ['Betrieb'],
      'graph.metrics': ['Personal o. GF %'],
      'graph.goal_value': 28,
      'graph.show_goal': true,
      'graph.goal_label': 'Grün bis 28 %',
    },
  },
  {
    schluessel: 'dd_filialen_streuung',
    name: 'Umsatz gegen Personalkostenquote',
    beschreibung:
      'Jeder Punkt ein Betrieb. Rechts unten steht, was man sich wünscht: viel Umsatz bei niedriger Quote. Links oben die Betriebe, bei denen beides nicht stimmt.',
    anzeige: 'scatter',
    parameter: [P_MONAT, P_MARKE],
    sql: `${MONAT_CTE}
SELECT r.umsatz_ist             AS "Umsatz",
       r.personalkosten_ogf_pct AS "Personal o. GF %",
       r.betrieb                AS "Betrieb"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.monat = g.monat
   AND r.personalkosten_ogf_pct IS NOT NULL
   AND r.umsatz_ist > 0
   [[AND r.konzept = {{marke}}]]`,
    visualisierung: {
      'graph.dimensions': ['Umsatz'],
      'graph.metrics': ['Personal o. GF %'],
    },
  },
  {
    schluessel: 'dd_filialen_metrikvergleich',
    name: 'Alle Metriken nebeneinander',
    beschreibung:
      'Dieselben Betriebe, aber nach Bereich gruppiert statt nach Betrieb — so sieht man, welche Metrik in dieser Marke insgesamt klemmt und welche nur bei einzelnen.',
    anzeige: 'bar',
    parameter: [P_MONAT, P_MARKE],
    sql: `${MONAT_CTE}
SELECT a.bereich_name                             AS "Bereich",
       count(*) FILTER (WHERE a.ampel = 'rot')    AS "Rot",
       count(*) FILTER (WHERE a.ampel = 'orange') AS "Orange",
       count(*) FILTER (WHERE a.ampel = 'gruen')  AS "Grün",
       count(*) FILTER (WHERE a.ampel IS NULL)    AS "Keine Daten"
  FROM mart.ampel_bereich a
  CROSS JOIN gewaehlt g
 WHERE a.monat = g.monat
   [[AND a.konzept = {{marke}}]]
 GROUP BY a.bereich_name, a.reihenfolge
 ORDER BY a.reihenfolge`,
    visualisierung: {
      'graph.dimensions': ['Bereich'],
      'graph.metrics': ['Rot', 'Orange', 'Grün', 'Keine Daten'],
      'stackable.stack_type': 'stacked',
      'graph.show_values': true,
      series_settings: {
        Rot: { color: '#ED6E6E' }, Orange: { color: '#F9CF48' },
        'Grün': { color: '#84BB4C' }, 'Keine Daten': { color: '#C7CFD4' },
      },
    },
  },

  // ===================================================================
  // EBENE 3 — Betriebsblatt
  // ===================================================================
  {
    schluessel: 'dd_betrieb_kopf',
    name: 'Betrieb — Kennzahlen des Monats',
    beschreibung: 'Alle sechs Round-Table-Metriken des gewählten Betriebs mit Ampel, Wert und Vormonatsveränderung.',
    anzeige: 'table',
    parameter: [P_MONAT, P_BETRIEB],
    sql: `${MONAT_CTE}
SELECT t.bereich_name                    AS "Bereich",
       coalesce(be.emoji, '⚪')           AS "●",
       t.wert                            AS "Aktuell",
       t.wert_vormonat                   AS "Vormonat",
       t.veraenderung                    AS "Veränderung",
       t.trend                           AS "Trend",
       t.ampelwechsel                    AS "Ampelwechsel",
       ab.ursache                        AS "Ursache"
  FROM mart.round_table_trend t
  CROSS JOIN gewaehlt g
  LEFT JOIN ampel.beschriftung be ON be.status = t.ampel
  LEFT JOIN mart.ampel_bereich ab ON ab.betrieb_key = t.betrieb_key
                                 AND ab.monat = t.monat AND ab.bereich = t.bereich
 WHERE t.monat = g.monat
   [[AND t.betrieb = {{betrieb}}]]
 ORDER BY t.reihenfolge`,
  },
  {
    schluessel: 'dd_betrieb_umsatz_kachel',
    name: 'Betrieb — Umsatz im Monat',
    beschreibung: 'Netto-Monatsumsatz des gewählten Betriebs.',
    anzeige: 'scalar',
    parameter: [P_MONAT, P_BETRIEB],
    sql: `${MONAT_CTE_UMSATZ}
SELECT sum(y.umsatz_monat) AS "Umsatz"
  FROM mart.umsatz_ytd y
  CROSS JOIN gewaehlt g
 WHERE y.monat = g.monat
   [[AND y.betrieb = {{betrieb}}]]`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
      },
    },
  },
  {
    schluessel: 'dd_betrieb_bon_kachel',
    name: 'Betrieb — Ø Bon',
    beschreibung: 'Umsatz je Rechnung im gewählten Monat.',
    anzeige: 'scalar',
    parameter: [P_MONAT, P_BETRIEB],
    sql: `${MONAT_CTE_UMSATZ}
SELECT round(sum(y.umsatz_monat) / nullif(sum(y.rechnungen), 0), 2) AS "Ø Bon"
  FROM mart.umsatz_ytd y
  CROSS JOIN gewaehlt g
 WHERE y.monat = g.monat
   [[AND y.betrieb = {{betrieb}}]]`,
  },
  {
    schluessel: 'dd_betrieb_gaeste_kachel',
    name: 'Betrieb — Gäste',
    beschreibung: 'Gäste im gewählten Monat.',
    anzeige: 'scalar',
    parameter: [P_MONAT, P_BETRIEB],
    sql: `${MONAT_CTE_UMSATZ}
SELECT sum(y.gaeste) AS "Gäste"
  FROM mart.umsatz_ytd y
  CROSS JOIN gewaehlt g
 WHERE y.monat = g.monat
   [[AND y.betrieb = {{betrieb}}]]`,
  },
  {
    schluessel: 'dd_betrieb_ytd_kachel',
    name: 'Betrieb — Umsatz YTD',
    beschreibung: 'Jahresumsatz bis einschließlich des gewählten Monats.',
    anzeige: 'scalar',
    parameter: [P_MONAT, P_BETRIEB],
    sql: `${MONAT_CTE_UMSATZ}
SELECT sum(y.umsatz_ytd) AS "Umsatz YTD"
  FROM mart.umsatz_ytd y
  CROSS JOIN gewaehlt g
 WHERE y.monat = g.monat
   [[AND y.betrieb = {{betrieb}}]]`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz YTD"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
      },
    },
  },
  {
    schluessel: 'dd_betrieb_verlauf',
    name: 'Betrieb — Umsatz je Tag',
    beschreibung: 'Tagesumsatz des gewählten Betriebs über die geladene Historie.',
    anzeige: 'line',
    parameter: [P_BETRIEB],
    sql: `
SELECT geschaeftstag     AS "Geschäftstag",
       sum(umsatz_netto) AS "Umsatz",
       sum(gaeste)       AS "Gäste"
  FROM mart.umsatz_tag
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
 GROUP BY geschaeftstag
 ORDER BY geschaeftstag`,
    visualisierung: {
      'graph.dimensions': ['Geschäftstag'],
      'graph.metrics': ['Umsatz'],
    },
  },
  {
    schluessel: 'dd_betrieb_ampelverlauf',
    name: 'Betrieb — Ampelverlauf je Bereich',
    beschreibung:
      'Wie sich die einzelnen Metriken dieses Betriebs über die Monate entwickelt haben. Die Reihe bricht ab, wo keine Daten vorliegen — eine Lücke ist eine Lücke, keine Null.',
    anzeige: 'line',
    parameter: [P_BETRIEB],
    sql: `
SELECT monat        AS "Monat",
       bereich_name AS "Bereich",
       wert         AS "Wert"
  FROM mart.ampel_bereich
 WHERE wert IS NOT NULL
   AND bereich IN ('personal','we_bar','we_kueche')
   [[AND betrieb = {{betrieb}}]]
 ORDER BY monat, reihenfolge`,
    visualisierung: {
      'graph.dimensions': ['Monat', 'Bereich'],
      'graph.metrics': ['Wert'],
      'graph.y_axis.title_text': 'Prozent',
    },
  },
  {
    schluessel: 'dd_betrieb_sparte',
    name: 'Betrieb — Speisen und Getränke',
    beschreibung: 'Spartenumsatz des gewählten Betriebs im Zeitverlauf.',
    anzeige: 'bar',
    parameter: [P_BETRIEB],
    sql: `
SELECT monat             AS "Monat",
       hauptsparte       AS "Sparte",
       sum(umsatz_netto) AS "Umsatz"
  FROM mart.umsatz_tag_sparte
 WHERE hauptsparte IS NOT NULL
   [[AND betrieb = {{betrieb}}]]
 GROUP BY monat, hauptsparte
 ORDER BY monat`,
    visualisierung: {
      'graph.dimensions': ['Monat', 'Sparte'],
      'graph.metrics': ['Umsatz'],
      'stackable.stack_type': 'stacked',
    },
  },
  {
    schluessel: 'dd_betrieb_zeitzone',
    name: 'Betrieb — Zeitzonen',
    beschreibung: 'Wovon dieser Betrieb lebt: Frühstück, Mittag, Happy Hour, Abend, Late Night.',
    anzeige: 'bar',
    parameter: [P_BETRIEB],
    sql: `
SELECT zeitzone          AS "Zeitzone",
       sum(umsatz_netto) AS "Umsatz"
  FROM mart.umsatz_zeitzone
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
 GROUP BY zeitzone, minute_von
 ORDER BY minute_von`,
    visualisierung: {
      'graph.dimensions': ['Zeitzone'],
      'graph.metrics': ['Umsatz'],
    },
  },
  {
    schluessel: 'dd_betrieb_stunde',
    name: 'Betrieb — Tagesverlauf',
    beschreibung:
      'Umsatz je Stunde. Sortiert nach Geschäftstag-Logik: der Tag beginnt um 08:00, die Stunden 0–7 stehen deshalb am Ende.',
    anzeige: 'bar',
    parameter: [P_BETRIEB],
    sql: `
SELECT lpad(stunde::text, 2, '0') || ':00' AS "Stunde",
       sum(umsatz_netto)                   AS "Umsatz"
  FROM mart.umsatz_stunde
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
 GROUP BY stunde
 ORDER BY ((stunde + 16) % 24)`,
    visualisierung: {
      'graph.dimensions': ['Stunde'],
      'graph.metrics': ['Umsatz'],
    },
  },
  {
    schluessel: 'dd_betrieb_personal',
    name: 'Betrieb — Personal je Bereich',
    beschreibung: 'Personalkostenquoten und Effektivitäten für Service, Bar und Küche.',
    anzeige: 'table',
    parameter: [P_BETRIEB],
    sql: `
SELECT zeitraum_von AS "Von",
       zeitraum_bis AS "Bis",
       pek_gesamt   AS "Personal %",
       pek_service  AS "Service %",
       pek_bar      AS "Bar %",
       pek_kueche   AS "Küche %",
       eff_gesamt   AS "Effektivität",
       eff_service  AS "Eff. Service",
       eff_bar      AS "Eff. Bar",
       eff_kueche   AS "Eff. Küche",
       persoog_bwa  AS "o. GF % (BWA)"
  FROM mart.personalkosten
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
 ORDER BY zeitraum_von DESC`,
  },
  {
    schluessel: 'dd_betrieb_artikel',
    name: 'Betrieb — Meistverkaufte Artikel',
    beschreibung:
      'Die 30 stärksten Artikel dieses Betriebs im gewählten Monat, mit Deckungsbeitrag. Leer, solange der Artikel-Backfill läuft.',
    anzeige: 'table',
    parameter: [P_MONAT, P_BETRIEB],
    sql: `${MONAT_CTE_UMSATZ}
SELECT av.artikel                 AS "Artikel",
       av.warengruppe             AS "Warengruppe",
       sum(av.menge)              AS "Menge",
       sum(av.umsatz_netto)       AS "Umsatz",
       sum(av.deckungsbeitrag)    AS "Deckungsbeitrag",
       round(100 * sum(av.deckungsbeitrag) / nullif(sum(av.umsatz_netto), 0), 1) AS "DB %"
  FROM mart.artikelverkauf av
  CROSS JOIN gewaehlt g
 WHERE av.monat = g.monat
   [[AND av.betrieb = {{betrieb}}]]
 GROUP BY av.artikel, av.warengruppe
 ORDER BY sum(av.menge) DESC
 LIMIT 30`,
  },
  {
    schluessel: 'dd_betrieb_bwa',
    name: 'Betrieb — BWA im Verlauf',
    beschreibung: 'Umsatz, Wareneinsatz, Personalkosten und EBIT aus der Buchhaltung. Nur gebuchte Monate.',
    anzeige: 'line',
    parameter: [P_BETRIEB],
    sql: `
SELECT k.monat AS "Monat",
       round(sum(k.wert_absolut) FILTER (WHERE k.kennzahl = 'Umsatz'))                 AS "Umsatz",
       round(sum(k.wert_absolut) FILTER (WHERE k.kennzahl IN ('WE Bar','WE Küche')))   AS "Wareneinsatz",
       round(sum(k.wert_absolut) FILTER (WHERE k.kennzahl = 'Personalkosten ohne GF')) AS "Personalkosten",
       round(sum(k.wert_absolut) FILTER (WHERE k.kennzahl = 'EBIT'))                   AS "EBIT"
  FROM mart.kennzahlen_aktuell k
  JOIN core.betrieb b ON b.betrieb_key = k.betrieb_key
 WHERE 1 = 1
   [[AND b.name = {{betrieb}}]]
 GROUP BY k.monat
HAVING count(*) FILTER (WHERE k.wert_absolut IS NOT NULL AND k.wert_absolut <> 0) > 0
 ORDER BY k.monat`,
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Umsatz', 'Wareneinsatz', 'Personalkosten', 'EBIT'],
    },
  },
  {
    schluessel: 'dd_betrieb_massnahmen',
    name: 'Betrieb — Maßnahmen',
    beschreibung: 'Was für diesen Betrieb offen ist. Wird von Hand in manual.massnahme gepflegt.',
    anzeige: 'table',
    parameter: [P_BETRIEB],
    sql: `
SELECT CASE WHEN ueberfaellig THEN '⚠' ELSE '' END AS "!",
       monat          AS "Monat",
       bereich        AS "Bereich",
       ursache        AS "Ursache",
       massnahme      AS "Maßnahme",
       verantwortlich AS "Verantwortlich",
       faellig_am     AS "Fällig",
       status         AS "Status",
       prioritaet     AS "Priorität",
       fortschritt    AS "Fortschritt %"
  FROM mart.massnahme
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
 ORDER BY ist_offen DESC, faellig_am NULLS LAST`,
  },
  {
    schluessel: 'dd_betrieb_datenstand',
    name: 'Betrieb — Datenstand',
    beschreibung:
      'Woher die Zahlen dieses Blatts kommen und wie alt sie sind. Vor jeder Schlussfolgerung die erste Karte, auf die man sieht.',
    anzeige: 'table',
    parameter: [P_BETRIEB],
    sql: `
SELECT befund              AS "Befund",
       erster_tag          AS "Umsatz ab",
       letzter_tag         AS "Umsatz bis",
       umsatz_alter_tage   AS "Alter (Tage)",
       bwa_monat           AS "BWA gebucht bis",
       bwa_verzug_monate   AS "BWA Verzug (Monate)",
       artikeltage         AS "Artikeltage",
       letzter_personaltag AS "Personal bis",
       bwa_bruecke         AS "BWA-Brücke"
  FROM mart.datenstand
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]`,
  },

  // ===================================================================
  // Zeitraumvergleich
  //
  // Zwei frei waehlbare Zeitraeume nebeneinander. Vorbelegt mit
  // "laufender Monat bis heute" gegen "derselbe Ausschnitt des Vormonats"
  // — ein Vergleich ganzer Monate waere schief, solange der laufende noch
  // nicht zu Ende ist.
  // ===================================================================
  {
    schluessel: 'vg_zeit_betrieb',
    name: 'Zeitraumvergleich je Betrieb',
    beschreibung:
      'Zwei frei wählbare Zeiträume nebeneinander. Vorbelegt ist der laufende Monat bis heute gegen denselben Ausschnitt des Vormonats — ein Vergleich ganzer Monate wäre schief, solange der laufende noch läuft. Die Tage-Spalten sagen, ob die Zeiträume überhaupt gleich lang sind.',
    anzeige: 'table',
    parameter: [
      { id: 'von-a-param', name: 'von_a', 'display-name': 'Zeitraum A von', type: 'date/single' },
      { id: 'bis-a-param', name: 'bis_a', 'display-name': 'Zeitraum A bis', type: 'date/single' },
      { id: 'von-b-param', name: 'von_b', 'display-name': 'Zeitraum B von', type: 'date/single' },
      { id: 'bis-b-param', name: 'bis_b', 'display-name': 'Zeitraum B bis', type: 'date/single' },
      P_MARKE,
    ],
    sql: `${ZEITRAUM_CTE}
SELECT u.betrieb                                                        AS "Betrieb",
       u.konzept                                                        AS "Marke",
       round(sum(u.umsatz_netto) FILTER (WHERE u.geschaeftstag BETWEEN z.a_von AND z.a_bis), 0) AS "Umsatz A",
       round(sum(u.umsatz_netto) FILTER (WHERE u.geschaeftstag BETWEEN z.b_von AND z.b_bis), 0) AS "Umsatz B",
       round(sum(u.umsatz_netto) FILTER (WHERE u.geschaeftstag BETWEEN z.a_von AND z.a_bis)
           - sum(u.umsatz_netto) FILTER (WHERE u.geschaeftstag BETWEEN z.b_von AND z.b_bis), 0) AS "Δ",
       CASE WHEN sum(u.umsatz_netto) FILTER (WHERE u.geschaeftstag BETWEEN z.b_von AND z.b_bis) > 0
            THEN round(100 * (sum(u.umsatz_netto) FILTER (WHERE u.geschaeftstag BETWEEN z.a_von AND z.a_bis)
                            - sum(u.umsatz_netto) FILTER (WHERE u.geschaeftstag BETWEEN z.b_von AND z.b_bis))
                       / sum(u.umsatz_netto) FILTER (WHERE u.geschaeftstag BETWEEN z.b_von AND z.b_bis), 1)
       END                                                              AS "Δ %",
       count(*) FILTER (WHERE u.geschaeftstag BETWEEN z.a_von AND z.a_bis) AS "Tage A",
       count(*) FILTER (WHERE u.geschaeftstag BETWEEN z.b_von AND z.b_bis) AS "Tage B",
       sum(u.gaeste) FILTER (WHERE u.geschaeftstag BETWEEN z.a_von AND z.a_bis) AS "Gäste A",
       sum(u.gaeste) FILTER (WHERE u.geschaeftstag BETWEEN z.b_von AND z.b_bis) AS "Gäste B",
       round(sum(u.umsatz_netto) FILTER (WHERE u.geschaeftstag BETWEEN z.a_von AND z.a_bis)
             / nullif(sum(u.rechnungen) FILTER (WHERE u.geschaeftstag BETWEEN z.a_von AND z.a_bis), 0), 2) AS "Ø Bon A",
       round(sum(u.umsatz_netto) FILTER (WHERE u.geschaeftstag BETWEEN z.b_von AND z.b_bis)
             / nullif(sum(u.rechnungen) FILTER (WHERE u.geschaeftstag BETWEEN z.b_von AND z.b_bis), 0), 2) AS "Ø Bon B"
  FROM mart.umsatz_tag u, z
 WHERE (u.geschaeftstag BETWEEN z.a_von AND z.a_bis
     OR u.geschaeftstag BETWEEN z.b_von AND z.b_bis)
   [[AND u.konzept = {{marke}}]]
 GROUP BY u.betrieb, u.konzept
HAVING sum(u.umsatz_netto) > 0
 ORDER BY 5`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz A"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Umsatz B"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Δ"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Δ %"]': { suffix: ' %' },
      },
    },
  },
  {
    schluessel: 'vg_zeit_summe',
    name: 'Zeitraumvergleich gesamt',
    beschreibung: 'Beide Zeiträume als Summe über alle Betriebe, mit Tageszahl zur Einordnung.',
    anzeige: 'table',
    parameter: [
      { id: 'von-a-param', name: 'von_a', 'display-name': 'Zeitraum A von', type: 'date/single' },
      { id: 'bis-a-param', name: 'bis_a', 'display-name': 'Zeitraum A bis', type: 'date/single' },
      { id: 'von-b-param', name: 'von_b', 'display-name': 'Zeitraum B von', type: 'date/single' },
      { id: 'bis-b-param', name: 'bis_b', 'display-name': 'Zeitraum B bis', type: 'date/single' },
      P_MARKE,
    ],
    sql: `${ZEITRAUM_CTE}
SELECT s.zeitraum                                       AS "Zeitraum",
       s.von                                            AS "Von",
       s.bis                                            AS "Bis",
       (s.bis - s.von + 1)                              AS "Kalendertage",
       round(sum(u.umsatz_netto), 0)                    AS "Umsatz",
       sum(u.gaeste)                                    AS "Gäste",
       sum(u.rechnungen)                                AS "Rechnungen",
       round(sum(u.umsatz_netto) / nullif(sum(u.rechnungen), 0), 2) AS "Ø Bon",
       round(sum(u.umsatz_netto) / nullif(sum(u.gaeste), 0), 2)     AS "Ø je Gast",
       count(DISTINCT u.betrieb)                        AS "Betriebe"
  FROM z
  CROSS JOIN LATERAL (VALUES ('A — Zeitraum A', z.a_von, z.a_bis),
                             ('B — Zeitraum B', z.b_von, z.b_bis)) AS s(zeitraum, von, bis)
  JOIN mart.umsatz_tag u ON u.geschaeftstag BETWEEN s.von AND s.bis
 WHERE 1 = 1
   [[AND u.konzept = {{marke}}]]
 GROUP BY s.zeitraum, s.von, s.bis
 ORDER BY s.zeitraum`,
  },
  {
    schluessel: 'vg_zeit_verlauf',
    name: 'Beide Zeiträume im Tagesverlauf',
    beschreibung:
      'Die zwei Zeiträume auf eine gemeinsame Achse gelegt: Tag 1 gegen Tag 1, Tag 2 gegen Tag 2. Damit sind auch unterschiedlich lange Zeiträume vergleichbar.',
    anzeige: 'line',
    parameter: [
      { id: 'von-a-param', name: 'von_a', 'display-name': 'Zeitraum A von', type: 'date/single' },
      { id: 'bis-a-param', name: 'bis_a', 'display-name': 'Zeitraum A bis', type: 'date/single' },
      { id: 'von-b-param', name: 'von_b', 'display-name': 'Zeitraum B von', type: 'date/single' },
      { id: 'bis-b-param', name: 'bis_b', 'display-name': 'Zeitraum B bis', type: 'date/single' },
      P_MARKE,
    ],
    sql: `${ZEITRAUM_CTE}
SELECT (u.geschaeftstag - s.von + 1)   AS "Tag im Zeitraum",
       s.zeitraum                      AS "Zeitraum",
       round(sum(u.umsatz_netto), 0)   AS "Umsatz"
  FROM z
  CROSS JOIN LATERAL (VALUES ('A', z.a_von, z.a_bis),
                             ('B', z.b_von, z.b_bis)) AS s(zeitraum, von, bis)
  JOIN mart.umsatz_tag u ON u.geschaeftstag BETWEEN s.von AND s.bis
 WHERE 1 = 1
   [[AND u.konzept = {{marke}}]]
 GROUP BY 1, 2
 ORDER BY 1, 2`,
    visualisierung: {
      'graph.dimensions': ['Tag im Zeitraum', 'Zeitraum'],
      'graph.metrics': ['Umsatz'],
    },
  },

  // ===================================================================
  // Standortvergleich
  //
  // Bis zu vier Betriebe nebeneinander. Vier, weil eine Tabelle mit acht
  // Spalten je Betrieb ab da unlesbar wird — wer mehr vergleichen will,
  // nimmt die Filialtabelle auf Ebene 2.
  // ===================================================================
  {
    schluessel: 'vg_ort_metriken',
    name: 'Standorte über alle Metriken',
    beschreibung:
      'Die gewählten Betriebe nebeneinander, eine Zeile je Metrik. Ohne Auswahl stehen hier alle Betriebe mit einem Urteil — in den Filter oben so viele eintragen, wie man vergleichen will.',
    anzeige: 'table',
    parameter: [P_MONAT, P_BETRIEB, P_MARKE],
    sql: `${MONAT_CTE}
SELECT a.bereich_name                        AS "Metrik",
       a.betrieb                             AS "Betrieb",
       a.wert                                AS "Wert",
       coalesce(be.emoji, '⚪')               AS "●",
       t.wert_vormonat                       AS "Vormonat",
       t.trend                               AS "Trend",
       round(a.wert - med.median, 2)         AS "Δ zum Median aller"
  FROM mart.ampel_bereich a
  CROSS JOIN gewaehlt g
  LEFT JOIN ampel.beschriftung be ON be.status = a.ampel
  LEFT JOIN mart.round_table_trend t ON t.betrieb_key = a.betrieb_key
                                    AND t.monat = a.monat AND t.bereich = a.bereich
  LEFT JOIN LATERAL (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x.wert)::numeric AS median
          FROM mart.ampel_bereich x
         WHERE x.monat = a.monat AND x.bereich = a.bereich AND x.wert IS NOT NULL
  ) med ON true
 WHERE a.monat = g.monat
   AND a.wert IS NOT NULL
   [[AND a.betrieb = {{betrieb}}]]
   [[AND a.konzept = {{marke}}]]
 ORDER BY a.reihenfolge, a.betrieb`,
  },
  {
    schluessel: 'vg_ort_umsatz',
    name: 'Standorte — Umsatzverlauf nebeneinander',
    beschreibung: 'Monatsumsatz der gewählten Betriebe auf einer Achse.',
    anzeige: 'line',
    parameter: [P_BETRIEB, P_MARKE],
    sql: `
SELECT monat        AS "Monat",
       betrieb      AS "Betrieb",
       umsatz_monat AS "Umsatz"
  FROM mart.umsatz_ytd
 WHERE umsatz_monat > 0
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]
 ORDER BY monat`,
    visualisierung: {
      'graph.dimensions': ['Monat', 'Betrieb'],
      'graph.metrics': ['Umsatz'],
    },
  },
  {
    schluessel: 'vg_ort_profil',
    name: 'Standorte — Umsatzprofil über den Tag',
    beschreibung:
      'Der Tagesverlauf der gewählten Betriebe als Anteil am eigenen Tagesumsatz. In Prozent, damit ein großer und ein kleiner Betrieb vergleichbar bleiben.',
    anzeige: 'line',
    parameter: [P_BETRIEB, P_MARKE],
    sql: `
SELECT lpad(s.stunde::text, 2, '0') || ':00'                       AS "Stunde",
       s.betrieb                                                   AS "Betrieb",
       round(100 * sum(s.umsatz_netto) / nullif(t.gesamt, 0), 2)    AS "Anteil %"
  FROM mart.umsatz_stunde s
  JOIN LATERAL (
        SELECT sum(x.umsatz_netto) AS gesamt
          FROM mart.umsatz_stunde x WHERE x.betrieb_key = s.betrieb_key
  ) t ON true
 WHERE 1 = 1
   [[AND s.betrieb = {{betrieb}}]]
   [[AND s.konzept = {{marke}}]]
 GROUP BY s.stunde, s.betrieb, t.gesamt
 ORDER BY ((s.stunde + 16) % 24)`,
    visualisierung: {
      'graph.dimensions': ['Stunde', 'Betrieb'],
      'graph.metrics': ['Anteil %'],
    },
  },
  {
    schluessel: 'vg_ort_sparte',
    name: 'Standorte — Speisen- und Getränkeanteil',
    beschreibung:
      'Der Getränkeanteil je Betrieb. Er ist der Hebel für den Wareneinsatz Bar und erklärt oft, warum zwei Betriebe derselben Marke unterschiedliche Quoten haben.',
    anzeige: 'bar',
    parameter: [P_MONAT, P_BETRIEB, P_MARKE],
    sql: `${MONAT_CTE_UMSATZ}
SELECT sp.betrieb                                                     AS "Betrieb",
       round(sum(sp.umsatz_netto) FILTER (WHERE sp.hauptsparte = 'Speisen'), 0)  AS "Speisen",
       round(sum(sp.umsatz_netto) FILTER (WHERE sp.hauptsparte = 'Getränke'), 0) AS "Getränke"
  FROM mart.umsatz_tag_sparte sp
  CROSS JOIN gewaehlt g
 WHERE sp.monat = g.monat
   AND sp.hauptsparte IN ('Speisen','Getränke')
   [[AND sp.betrieb = {{betrieb}}]]
   [[AND sp.konzept = {{marke}}]]
 GROUP BY sp.betrieb
 ORDER BY sum(sp.umsatz_netto) DESC`,
    visualisierung: {
      'graph.dimensions': ['Betrieb'],
      'graph.metrics': ['Speisen', 'Getränke'],
      'stackable.stack_type': 'stacked',
    },
  },
]
