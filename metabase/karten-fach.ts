// =====================================================================
// Fach-Dashboards — die Berichte aus "Umsetzung Berichte (1).xlsx"
//
// Dort steht je Bericht ein Status Live zwischen 0 und 1. Aufgenommen sind
// hier die, deren Datenbasis in LINA vorhanden ist; was dort rot ist, weil
// LINA es nicht hergibt (Zeiterfassung, Storno, Holding-Ebene), fehlt auch
// hier und steht in docs/kennzahlen-mapping.md Teil C.
//
// Reihenfolge der Dashboards:
//   Umsatz — Entwicklung      Umsatzentwicklung, Bon, Gast
//   Umsatz — Struktur         Sparte, Verkaufsstelle, Tageszeit, Zeitzone
//   Personal                  Personalkosten und Effektivitaet, auch je Bereich
//   Warenwirtschaft           Artikel, Deckungsbeitrag, Einkaufspreise
//   BWA                       Kennzahlen und Buchungsstand
//   Datenqualitaet und Import Betriebszustand
// =====================================================================

import type { Karte } from './typen'
import { MONAT_CTE, MONAT_CTE_UMSATZ, MONAT_CTE_BWA, P_MONAT, P_BETRIEB, P_ZEITRAUM } from './gemeinsam'

// Der Monat ist bewusst kein Pflichtfeld — siehe gemeinsam.ts.
const ZEITRAUM = P_ZEITRAUM
const MONAT = P_MONAT
const BETRIEB = P_BETRIEB

export const karten: Karte[] = [
  // ===================================================================
  // Umsatz — Entwicklung
  // ===================================================================
  {
    schluessel: 'um_kachel_monat',
    name: 'Umsatz laufender Monat',
    beschreibung: 'Netto-Umsatz aller Betriebe im laufenden Monat, bis zum letzten geladenen Geschäftstag.',
    anzeige: 'scalar',
    sql: `
SELECT sum(umsatz_netto) AS "Umsatz"
  FROM mart.umsatz_tag
 WHERE monat = date_trunc('month', current_date)::date`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
      },
    },
  },
  {
    schluessel: 'um_kachel_gaeste',
    name: 'Gäste laufender Monat',
    beschreibung: 'Summe der Gäste aller Betriebe im laufenden Monat.',
    anzeige: 'scalar',
    sql: `
SELECT sum(gaeste) AS "Gäste"
  FROM mart.umsatz_tag
 WHERE monat = date_trunc('month', current_date)::date`,
  },
  {
    schluessel: 'um_kachel_bon',
    name: 'Ø Bon laufender Monat',
    beschreibung:
      'Umsatz je Rechnung, aus Summen gerechnet — nicht der Mittelwert der Tages-Durchschnittsbons, der Tage unterschiedlicher Größe gleich gewichten würde.',
    anzeige: 'scalar',
    sql: `
SELECT round(sum(umsatz_netto) / nullif(sum(rechnungen), 0), 2) AS "Ø Bon"
  FROM mart.umsatz_tag
 WHERE monat = date_trunc('month', current_date)::date`,
    visualisierung: {
      column_settings: {
        '["name","Ø Bon"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 2 },
      },
    },
  },
  {
    schluessel: 'um_verlauf_tag',
    name: 'Umsatz je Tag',
    beschreibung: 'Tagesumsatz aller Betriebe. Der Wochenrhythmus ist hier das eigentliche Muster.',
    anzeige: 'line',
    parameter: [ZEITRAUM, BETRIEB],
    sql: `
SELECT geschaeftstag       AS "Geschäftstag",
       sum(umsatz_netto)   AS "Umsatz"
  FROM mart.umsatz_tag
 WHERE 1 = 1
   [[AND {{zeitraum}}]]
   [[AND betrieb = {{betrieb}}]]
 GROUP BY geschaeftstag
 ORDER BY geschaeftstag`,
    template_tag_dimension: { zeitraum: ['mart', 'umsatz_tag', 'geschaeftstag'] },
    visualisierung: {
      'graph.dimensions': ['Geschäftstag'],
      'graph.metrics': ['Umsatz'],
      'graph.y_axis.title_text': 'Umsatz netto',
    },
  },
  {
    schluessel: 'um_verlauf_monat',
    name: 'Umsatz je Monat mit Vorjahr',
    beschreibung:
      'Monatsumsatz gegen den gleichen Monat des Vorjahres, beides in Euro auf EINER Achse. Die prozentuale Veränderung steht bewusst in einer eigenen Karte daneben — zwei Y-Achsen in einem Bild erfinden eine Beziehung, die in den Daten nicht steht. Solange der Historien-Backfill läuft, ist die Vorjahresreihe leer; das ist fehlende Vergangenheit, kein Nullumsatz.',
    anzeige: 'bar',
    parameter: [BETRIEB],
    sql: `
SELECT monat                AS "Monat",
       sum(umsatz_monat)    AS "Umsatz",
       sum(umsatz_monat_vj) AS "Umsatz Vorjahr"
  FROM mart.umsatz_ytd
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
 GROUP BY monat
 ORDER BY monat`,
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Umsatz', 'Umsatz Vorjahr'],
      'graph.y_axis.title_text': 'Umsatz netto (€)',
      'graph.x_axis.title_text': '',
    },
  },
  {
    // Die zweite Haelfte der zerlegten Kombi-Karte. Als divergierende Balken
    // um die Nulllinie, weil die Frage hier eine Polaritaet ist: ueber oder
    // unter Vorjahr. Eine Linie wuerde eine Entwicklung suggerieren, wo
    // jeder Monat einen eigenen Vergleich hat.
    schluessel: 'um_verlauf_delta',
    name: 'Veränderung zum Vorjahr',
    beschreibung:
      'Prozentuale Abweichung zum gleichen Monat des Vorjahres. Balken über der Nulllinie sind Wachstum, darunter Rückgang. Bewusst getrennt vom Euro-Diagramm nebenan: Euro und Prozent auf zwei Achsen desselben Bildes lassen sich beliebig gegeneinander verschieben.',
    anzeige: 'bar',
    parameter: [BETRIEB],
    sql: `
SELECT monat AS "Monat",
       CASE WHEN sum(umsatz_monat_vj) > 0
            THEN round((sum(umsatz_monat) - sum(umsatz_monat_vj))
                       / sum(umsatz_monat_vj) * 100, 1)
       END   AS "Veränderung %"
  FROM mart.umsatz_ytd
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
 GROUP BY monat
HAVING sum(umsatz_monat_vj) > 0
 ORDER BY monat`,
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Veränderung %'],
      'graph.y_axis.title_text': 'Δ zum Vorjahr (%)',
      'graph.goal_value': 0,
      'graph.show_goal': true,
      'graph.goal_label': 'Vorjahresniveau',
    },
  },
  {
    schluessel: 'um_rangliste',
    name: 'Betriebe nach Umsatz',
    beschreibung: 'Rangliste im gewählten Monat, mit Bon und Umsatz je Gast. Die letzten Zeilen sind die interessanten.',
    anzeige: 'table',
    parameter: [MONAT],
    sql: `${MONAT_CTE_UMSATZ}
SELECT y.betrieb          AS "Betrieb",
       y.konzept          AS "Marke",
       y.umsatz_monat     AS "Umsatz",
       y.umsatz_monat_vj  AS "Vorjahr",
       y.umsatz_pct       AS "Δ %",
       y.umsatz_ytd       AS "YTD",
       y.umsatz_ytd_pct   AS "YTD Δ %",
       y.rechnungen       AS "Rechnungen",
       y.gaeste           AS "Gäste",
       y.bon_schnitt      AS "Ø Bon",
       y.umsatz_pro_gast  AS "Ø je Gast"
  FROM mart.umsatz_ytd y
  CROSS JOIN gewaehlt g
 WHERE y.monat = g.monat
 ORDER BY y.umsatz_monat DESC NULLS LAST`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Vorjahr"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","YTD"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Δ %"]': { suffix: ' %' },
        '["name","YTD Δ %"]': { suffix: ' %' },
      },
    },
  },
  {
    schluessel: 'um_wochentag',
    name: 'Umsatz nach Wochentag',
    beschreibung: 'Durchschnittlicher Tagesumsatz je Wochentag — die Grundlage für jede Frage nach Öffnungszeiten.',
    anzeige: 'bar',
    parameter: [BETRIEB],
    sql: `
SELECT to_char(geschaeftstag, 'ID')                       AS sortier,
       trim(to_char(geschaeftstag, 'TMDay'))              AS "Wochentag",
       round(avg(tagesumsatz), 2)                         AS "Ø Umsatz",
       round(avg(gaeste), 0)                              AS "Ø Gäste"
  FROM (
        SELECT geschaeftstag, sum(umsatz_netto) AS tagesumsatz, sum(gaeste) AS gaeste
          FROM mart.umsatz_tag
         WHERE 1 = 1
           [[AND betrieb = {{betrieb}}]]
         GROUP BY geschaeftstag
       ) t
 GROUP BY 1, 2
 ORDER BY 1`,
    visualisierung: {
      'graph.dimensions': ['Wochentag'],
      'graph.metrics': ['Ø Umsatz'],
      'table.columns': [
        { name: 'sortier', enabled: false },
        { name: 'Wochentag', enabled: true },
        { name: 'Ø Umsatz', enabled: true },
        { name: 'Ø Gäste', enabled: true },
      ],
    },
  },
  {
    schluessel: 'um_bon_gast',
    name: 'Durchschnittsbon und Umsatz je Gast',
    beschreibung:
      'Beide Kennzahlen kommen fertig von LINA und werden hier nur gemittelt. Sie laufen selten parallel: ein steigender Bon bei fallendem Umsatz je Gast heißt größere Tische, nicht mehr Umsatz.',
    anzeige: 'line',
    parameter: [BETRIEB],
    sql: `
SELECT monat                                                    AS "Monat",
       round(sum(umsatz_monat) / nullif(sum(rechnungen), 0), 2) AS "Ø Bon",
       round(sum(umsatz_monat) / nullif(sum(gaeste), 0), 2)     AS "Ø je Gast"
  FROM mart.umsatz_ytd
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
 GROUP BY monat
 ORDER BY monat`,
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Ø Bon', 'Ø je Gast'],
    },
  },

  // ===================================================================
  // Umsatz — Struktur
  // ===================================================================
  {
    schluessel: 'st_sparte',
    name: 'Speisen gegen Getränke',
    beschreibung:
      'Umsatz je Hauptsparte. ACHTUNG: geholt werden bisher nur Speisen und Getränke — die Summe beider ist deshalb kleiner als der Gesamtumsatz aus mart.umsatz_tag.',
    anzeige: 'bar',
    parameter: [BETRIEB],
    sql: `
SELECT monat              AS "Monat",
       hauptsparte        AS "Sparte",
       sum(umsatz_netto)  AS "Umsatz"
  FROM mart.umsatz_tag_sparte
 WHERE hauptsparte IS NOT NULL
   [[AND betrieb = {{betrieb}}]]
 GROUP BY monat, hauptsparte
 ORDER BY monat, hauptsparte`,
    visualisierung: {
      'graph.dimensions': ['Monat', 'Sparte'],
      'graph.metrics': ['Umsatz'],
      'stackable.stack_type': 'stacked',
    },
  },
  {
    schluessel: 'st_sparte_anteil',
    name: 'Spartenanteil je Betrieb',
    beschreibung: 'Wie sich der Umsatz je Betrieb auf Speisen und Getränke verteilt — der Getränkeanteil ist der Hebel für den Wareneinsatz Bar.',
    anzeige: 'table',
    parameter: [MONAT],
    sql: `${MONAT_CTE_UMSATZ}
SELECT sp.betrieb                                                          AS "Betrieb",
       sum(sp.umsatz_netto) FILTER (WHERE sp.hauptsparte = 'Speisen')      AS "Speisen",
       sum(sp.umsatz_netto) FILTER (WHERE sp.hauptsparte = 'Getränke')     AS "Getränke",
       sum(sp.umsatz_netto)                                                AS "Summe",
       round(100 * sum(sp.umsatz_netto) FILTER (WHERE sp.hauptsparte = 'Getränke')
             / nullif(sum(sp.umsatz_netto), 0), 1)                         AS "Getränkeanteil %"
  FROM mart.umsatz_tag_sparte sp
  CROSS JOIN gewaehlt g
 WHERE sp.hauptsparte IN ('Speisen','Getränke')
   AND sp.monat = g.monat
 GROUP BY sp.betrieb
 ORDER BY sum(sp.umsatz_netto) DESC`,
  },
  {
    schluessel: 'st_verkaufsstelle',
    name: 'Umsatz je Verkaufsstelle',
    beschreibung: 'Außer Haus, Delivery, To Go und die übrigen Verkaufsstellen. Prio 1 in „Umsetzung Berichte".',
    anzeige: 'bar',
    parameter: [BETRIEB],
    sql: `
SELECT verkaufsstelle     AS "Verkaufsstelle",
       sum(umsatz_netto)  AS "Umsatz"
  FROM mart.umsatz_tag_sparte
 WHERE verkaufsstelle IS NOT NULL
   [[AND betrieb = {{betrieb}}]]
 GROUP BY verkaufsstelle
 ORDER BY sum(umsatz_netto) DESC`,
    visualisierung: {
      'graph.dimensions': ['Verkaufsstelle'],
      'graph.metrics': ['Umsatz'],
    },
  },
  {
    // Die Tagesgrenze ist hier der ganze Trick: der Geschaeftstag laeuft
    // 08:00 bis 07:59, die Stunden 0 bis 7 gehoeren also ans Ende.
    schluessel: 'st_stunde',
    name: 'Tagesverlauf nach Stunde',
    beschreibung:
      'Umsatz je Stunde über alle Tage. Sortiert nach Geschäftstag-Logik: der Tag beginnt um 08:00 und endet um 07:59, die Stunden 0–7 stehen deshalb am Ende und nicht am Anfang.',
    anzeige: 'bar',
    parameter: [BETRIEB],
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
      'graph.x_axis.title_text': 'Stunde des Geschäftstags (08:00 → 07:59)',
    },
  },
  {
    schluessel: 'st_zeitzone',
    name: 'Umsatz nach Zeitzone',
    beschreibung:
      'Die vordefinierten Zeitzonen aus LINA: Frühstück, Mittagszeit, Nachmittag, Happy Hour, Abendessen, Late Night. „Late Night" läuft über Mitternacht.',
    anzeige: 'bar',
    parameter: [BETRIEB],
    sql: `
SELECT zeitzone           AS "Zeitzone",
       sum(umsatz_netto)  AS "Umsatz"
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
    schluessel: 'st_zeitzone_betrieb',
    name: 'Zeitzonen je Betrieb',
    beschreibung: 'Welcher Betrieb wovon lebt — ein Mittagsgeschäft und eine Abendgastronomie brauchen verschiedene Maßnahmen.',
    anzeige: 'table',
    parameter: [MONAT],
    sql: `${MONAT_CTE_UMSATZ}
SELECT uz.betrieb                                                  AS "Betrieb",
       round(sum(uz.umsatz_netto))                                 AS "Umsatz",
       round(100 * sum(uz.umsatz_netto) FILTER (WHERE uz.zeitzone = 'Mittagszeit')
             / nullif(sum(uz.umsatz_netto), 0), 1)                 AS "Mittag %",
       round(100 * sum(uz.umsatz_netto) FILTER (WHERE uz.zeitzone = 'Happy Hour')
             / nullif(sum(uz.umsatz_netto), 0), 1)                 AS "Happy Hour %",
       round(100 * sum(uz.umsatz_netto) FILTER (WHERE uz.zeitzone = 'Abendessen')
             / nullif(sum(uz.umsatz_netto), 0), 1)                 AS "Abend %",
       round(100 * sum(uz.umsatz_netto) FILTER (WHERE uz.zeitzone = 'Late Night')
             / nullif(sum(uz.umsatz_netto), 0), 1)                 AS "Late Night %"
  FROM mart.umsatz_zeitzone uz
  CROSS JOIN gewaehlt g
 WHERE uz.monat = g.monat
 GROUP BY uz.betrieb
 ORDER BY sum(uz.umsatz_netto) DESC`,
  },

  // ===================================================================
  // Personal
  // ===================================================================
  {
    schluessel: 'pe_quote_betrieb',
    name: 'Personalkostenquote je Betrieb',
    beschreibung:
      'Die 20 Betriebe mit der höchsten Personalkostenquote ohne Geschäftsführung — die Liste, an der man arbeitet. Bewusst gekappt: alle 69 Betriebe nebeneinander ergeben einen Balkenwald, in dem die Namen übereinanderliegen und niemand mehr etwas abliest. Die vollständige Reihe steht in der Tabelle darunter.',
    anzeige: 'row',
    parameter: [MONAT],
    sql: `${MONAT_CTE}
SELECT r.betrieb                AS "Betrieb",
       r.personalkosten_ogf_pct AS "Personal o. GF %"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.monat = g.monat
   AND r.personalkosten_ogf_pct IS NOT NULL
 ORDER BY r.personalkosten_ogf_pct DESC
 LIMIT 20`,
    visualisierung: {
      'graph.dimensions': ['Betrieb'],
      'graph.metrics': ['Personal o. GF %'],
      'graph.goal_value': 28,
      'graph.show_goal': true,
      'graph.goal_label': 'Grün bis 28 %',
      'graph.x_axis.title_text': 'Personalkosten ohne GF (%)',
    },
  },
  {
    // Die vollstaendige Reihe, die das gekappte Diagramm oben nicht zeigt.
    // Eine Tabelle, weil ab etwa sieben Klassen jede Farbskala verwischt und
    // 69 Zeilen ohnehin gelesen und nicht ueberflogen werden.
    schluessel: 'pe_quote_tabelle',
    name: 'Personalkostenquote — alle Betriebe',
    beschreibung:
      'Die vollständige Reihe zum gekappten Diagramm darüber, mit Ampel und Abstand zur 28-%-Schwelle. Positive Werte in „Δ Schwelle" sind die Überschreitung in Prozentpunkten.',
    anzeige: 'table',
    parameter: [MONAT],
    sql: `${MONAT_CTE}
SELECT r.betrieb                            AS "Betrieb",
       r.konzept                            AS "Marke",
       coalesce(ap.emoji, '⚪')              AS "●",
       r.personalkosten_ogf_pct             AS "Personal o. GF %",
       round(r.personalkosten_ogf_pct - 28, 1) AS "Δ Schwelle",
       r.bwa_monat                          AS "BWA-Stand"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
  LEFT JOIN ampel.beschriftung ap ON ap.status = r.ampel_personal
 WHERE r.monat = g.monat
   AND r.personalkosten_ogf_pct IS NOT NULL
 ORDER BY r.personalkosten_ogf_pct DESC`,
  },
  {
    schluessel: 'pe_bereich',
    name: 'Personalkosten je Bereich',
    beschreibung:
      'Quoten für Service, Bar und Küche nebeneinander. Prio 1 in „Umsetzung Berichte" — pek_* sind Prozentquoten, nicht Euro.',
    anzeige: 'table',
    parameter: [BETRIEB],
    sql: `
SELECT betrieb        AS "Betrieb",
       zeitraum_von   AS "Von",
       zeitraum_bis   AS "Bis",
       pek_gesamt     AS "Personal gesamt %",
       pek_service    AS "Service %",
       pek_bar        AS "Bar %",
       pek_kueche     AS "Küche %",
       persoog_bwa    AS "o. GF % (BWA)",
       ampel_global   AS "Ampel global",
       ampel_lina     AS "Ampel LINA"
  FROM mart.personalkosten
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
 ORDER BY zeitraum_von DESC, betrieb`,
  },
  {
    schluessel: 'pe_effektivitaet',
    name: 'Effektivität je Bereich',
    beschreibung:
      'Umsatz je Personalstunde in Euro, gesamt und je Bereich. Nicht mit der Personalkostenquote in ein Diagramm legen — das sind zwei verschiedene Einheiten.',
    anzeige: 'table',
    parameter: [BETRIEB],
    sql: `
SELECT betrieb        AS "Betrieb",
       zeitraum_von   AS "Von",
       zeitraum_bis   AS "Bis",
       eff_gesamt     AS "Effektivität gesamt",
       eff_service    AS "Service",
       eff_bar        AS "Bar",
       eff_kueche     AS "Küche"
  FROM mart.personalkosten
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
 ORDER BY zeitraum_von DESC, betrieb`,
  },
  {
    schluessel: 'pe_verlauf',
    name: 'Personalkostenquote im Verlauf',
    beschreibung: 'Die Quote über die Monate, aus der BWA. Die 28-%-Linie ist die Grün-Schwelle des Round Table.',
    anzeige: 'line',
    parameter: [BETRIEB],
    sql: `
SELECT monat                                                     AS "Monat",
       round(avg(personalkosten_ogf_pct), 2)                     AS "Ø Personal o. GF %",
       round(percentile_cont(0.5) WITHIN GROUP
             (ORDER BY personalkosten_ogf_pct)::numeric, 2)      AS "Median"
  FROM mart.round_table_monat
 WHERE personalkosten_ogf_pct IS NOT NULL
   [[AND betrieb = {{betrieb}}]]
 GROUP BY monat
 ORDER BY monat`,
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Ø Personal o. GF %', 'Median'],
      'graph.goal_value': 28,
      'graph.show_goal': true,
      'graph.goal_label': 'Grün-Schwelle',
    },
  },

  // ===================================================================
  // Warenwirtschaft
  // ===================================================================
  {
    schluessel: 'wa_renner',
    name: 'Renner — meistverkaufte Artikel',
    beschreibung:
      'Die 50 Artikel mit der höchsten Menge im gewählten Zeitraum. Immer erst den Zeitraum setzen: die Tabelle darunter ist monatlich partitioniert, ohne Zeitfilter wird die ganze Historie gelesen.',
    anzeige: 'table',
    parameter: [ZEITRAUM, BETRIEB],
    sql: `
SELECT artikel                        AS "Artikel",
       warengruppe                    AS "Warengruppe",
       sum(menge)                     AS "Menge",
       sum(umsatz_netto)              AS "Umsatz",
       round(avg(verkaufspreis), 2)   AS "Ø Preis",
       sum(deckungsbeitrag)           AS "Deckungsbeitrag",
       round(100 * sum(deckungsbeitrag) / nullif(sum(umsatz_netto), 0), 1) AS "DB %"
  FROM mart.artikelverkauf
 WHERE 1 = 1
   [[AND {{zeitraum}}]]
   [[AND betrieb = {{betrieb}}]]
 GROUP BY artikel, warengruppe
 ORDER BY sum(menge) DESC
 LIMIT 50`,
    template_tag_dimension: { zeitraum: ['mart', 'artikelverkauf', 'geschaeftstag'] },
  },
  {
    schluessel: 'wa_penner',
    name: 'Penner — Artikel mit dem geringsten Absatz',
    beschreibung:
      'Die Artikel, die verkauft wurden, aber kaum. Sortimentskandidaten. Artikel ohne einen einzigen Verkauf stehen hier nicht — die kennt der Verkaufsbericht gar nicht.',
    anzeige: 'table',
    parameter: [ZEITRAUM, BETRIEB],
    sql: `
SELECT artikel            AS "Artikel",
       warengruppe        AS "Warengruppe",
       sum(menge)         AS "Menge",
       sum(umsatz_netto)  AS "Umsatz",
       count(DISTINCT geschaeftstag) AS "Verkaufstage"
  FROM mart.artikelverkauf
 WHERE 1 = 1
   [[AND {{zeitraum}}]]
   [[AND betrieb = {{betrieb}}]]
 GROUP BY artikel, warengruppe
HAVING sum(menge) > 0
 ORDER BY sum(menge) ASC
 LIMIT 50`,
    template_tag_dimension: { zeitraum: ['mart', 'artikelverkauf', 'geschaeftstag'] },
  },
  {
    schluessel: 'wa_db_warengruppe',
    name: 'Deckungsbeitrag je Warengruppe',
    beschreibung:
      'ZUERST AUF DIE ABDECKUNG SEHEN. Sie sagt, welcher Anteil des Umsatzes überhaupt einen hinterlegten Wareneinsatzansatz hat. Bei 60 % Abdeckung ist der Deckungsbeitrag strukturell zu hoch, ohne dass man es der Zahl ansieht.',
    anzeige: 'table',
    parameter: [MONAT],
    sql: `${MONAT_CTE_UMSATZ}
SELECT d.warengruppe              AS "Warengruppe",
       sum(d.menge)               AS "Menge",
       sum(d.umsatz_netto_pos)    AS "Umsatz",
       sum(d.wareneinsatz_theoretisch) AS "WE theoretisch",
       sum(d.deckungsbeitrag)     AS "Deckungsbeitrag",
       round(100 * sum(d.deckungsbeitrag) / nullif(sum(d.umsatz_netto_pos), 0), 1) AS "DB %",
       round(avg(d.abdeckung_pct), 1) AS "Abdeckung %"
  FROM mart.deckungsbeitrag_warengruppe d
  CROSS JOIN gewaehlt g
 WHERE d.monat = g.monat
 GROUP BY d.warengruppe
 ORDER BY sum(d.umsatz_netto_pos) DESC NULLS LAST`,
  },
  {
    schluessel: 'wa_we_pruefung',
    name: 'Theoretischer Wareneinsatz gegen BWA',
    beschreibung:
      'Soll-Wareneinsatz aus der LINA-Kalkulation gegen den Ist-Wareneinsatz aus der BWA. Eine Lücke ist hier der NORMALFALL und die eigentliche Kennzahl: sie enthält Schwund, Bruch, Portionierung, Personalverzehr und Lagerbewegung. Unter 90 % Abdeckung ist der Vergleich nicht aussagekräftig.',
    anzeige: 'table',
    sql: `
SELECT betrieb            AS "Betrieb",
       monat              AS "Monat",
       we_theoretisch     AS "WE theoretisch",
       we_bwa             AS "WE laut BWA",
       luecke             AS "Lücke",
       we_theoretisch_pct AS "theoretisch %",
       we_bwa_pct         AS "BWA %",
       abdeckung_pct      AS "Abdeckung %"
  FROM mart.pruefung_wareneinsatz
 ORDER BY abdeckung_pct DESC NULLS LAST, abs(luecke) DESC NULLS LAST`,
  },
  {
    schluessel: 'wa_preise',
    name: 'Einkaufspreise im Verlauf',
    beschreibung:
      'Preis je Basiseinheit je Ware und Lieferant, mit Vormonatsvergleich. Die Reihe beginnt mit der ersten Momentaufnahme — rückwirkend gibt es nichts, weil LINA keine Preishistorie führt.',
    anzeige: 'table',
    sql: `
SELECT ware                  AS "Ware",
       lieferant             AS "Lieferant",
       monat                 AS "Monat",
       preis                 AS "Preis",
       preis_vormonat        AS "Vormonat",
       round(preis - preis_vormonat, 2) AS "Δ",
       CASE WHEN preis_vormonat > 0
            THEN round((preis - preis_vormonat) / preis_vormonat * 100, 1)
       END                   AS "Δ %",
       preis_je_basiseinheit AS "je Basiseinheit",
       basiseinheit          AS "Einheit"
  FROM mart.preisentwicklung_ware
 ORDER BY abs(coalesce(preis - preis_vormonat, 0)) DESC, ware`,
  },

  // ===================================================================
  // BWA
  // ===================================================================
  {
    schluessel: 'bwa_kennzahlen',
    name: 'BWA-Kennzahlen je Monat',
    beschreibung:
      'Umsatz, Wareneinsatz, Personalkosten und EBIT aus der BWA. Nur gebuchte Monate — ein Monat, in dem alle Werte null sind, ist nicht gebucht, sondern leer.',
    anzeige: 'line',
    parameter: [BETRIEB],
    sql: `
SELECT k.monat AS "Monat",
       round(sum(k.wert_absolut) FILTER (WHERE k.kennzahl = 'Umsatz'))                 AS "Umsatz",
       round(sum(k.wert_absolut) FILTER (WHERE k.kennzahl IN ('WE Bar','WE Küche')))   AS "Wareneinsatz",
       round(sum(k.wert_absolut) FILTER (WHERE k.kennzahl = 'Personalkosten ohne GF')) AS "Personalkosten",
       round(sum(k.wert_absolut) FILTER (WHERE k.kennzahl = 'EBIT'))                   AS "EBIT"
  FROM mart.bwa_kennzahl k
 WHERE 1 = 1
   [[AND k.betrieb = {{betrieb}}]]
 GROUP BY k.monat
HAVING count(*) FILTER (WHERE k.wert_absolut IS NOT NULL AND k.wert_absolut <> 0) > 0
 ORDER BY k.monat`,
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Umsatz', 'Wareneinsatz', 'Personalkosten', 'EBIT'],
    },
  },
  {
    schluessel: 'bwa_ebit',
    name: 'EBIT je Betrieb',
    beschreibung: 'Rendite aus der BWA. In „Umsetzung Berichte" als „Rendite" geführt, Status live 0,2 — die Datenbasis ist da.',
    anzeige: 'row',
    parameter: [MONAT],
    sql: `${MONAT_CTE_BWA}
SELECT k.betrieb                     AS "Betrieb",
       round(k.wert_absolut)         AS "EBIT",
       round(u.wert_absolut)         AS "Umsatz",
       CASE WHEN u.wert_absolut > 0
            THEN round(100 * k.wert_absolut / u.wert_absolut, 1)
       END                           AS "EBIT-Marge %"
  FROM mart.bwa_kennzahl k
  CROSS JOIN gewaehlt g
  LEFT JOIN mart.kennzahlen_aktuell u
         ON u.betrieb_key = k.betrieb_key AND u.monat = k.monat AND u.kennzahl = 'Umsatz'
 WHERE k.kennzahl = 'EBIT'
   AND k.monat = g.monat
   AND k.gebucht
 ORDER BY k.wert_absolut DESC`,
    visualisierung: {
      'graph.dimensions': ['Betrieb'],
      'graph.metrics': ['EBIT'],
      'graph.x_axis.title_text': 'EBIT (€)',
      'graph.goal_value': 0,
      'graph.show_goal': true,
      'graph.goal_label': 'Break-even',
    },
  },
  {
    schluessel: 'bwa_buchungsstand',
    name: 'Buchungsstand der BWA',
    beschreibung:
      'Bis wann ist je Betrieb gebucht? Die BWA kommt vom Steuerberater und hinkt ein bis zwei Monate nach; vier Monate Verzug sind eine Nachfrage wert. Betriebe ohne Brücke zur BWA bekommen überhaupt keine Zeile.',
    anzeige: 'table',
    sql: `
SELECT betrieb            AS "Betrieb",
       bwa_monat          AS "Gebucht bis",
       bwa_verzug_monate  AS "Verzug (Monate)",
       bwa_bruecke        AS "BWA-Brücke da?",
       letzter_tag        AS "Umsatz bis",
       befund             AS "Befund"
  FROM mart.datenstand
 ORDER BY bwa_verzug_monate DESC NULLS FIRST, betrieb`,
  },

  // ===================================================================
  // Datenqualitaet und Import
  // ===================================================================
  {
    schluessel: 'dq_pruefung',
    name: 'Gegenrechnungen',
    beschreibung:
      'LINAs Aggregate gegen unsere eigene Neuberechnung. Die Spalte „auffällig" ist eine Arbeitsliste, kein Alarm. Erste Abfrage nach jedem größeren Backfill.',
    anzeige: 'table',
    sql: `
SELECT pruefung   AS "Prüfung",
       geprueft   AS "Geprüft",
       auffaellig AS "Auffällig",
       sicht      AS "Sicht"
  FROM mart.pruefung_uebersicht`,
  },
  {
    schluessel: 'dq_backfill',
    name: 'Backfill je Endpunkt',
    beschreibung: 'Wie weit ist der Import je LINA-Endpunkt? Die Sicht, die man morgens aufmacht.',
    anzeige: 'table',
    sql: `
SELECT endpunkt          AS "Endpunkt",
       prozent           AS "Fertig %",
       erledigt          AS "Erledigt",
       offen             AS "Offen",
       geladen           AS "Geladen",
       keine_daten       AS "Keine Daten",
       aufgegeben        AS "Aufgegeben",
       aeltester_geladen AS "Ältester geladen",
       juengster_geladen AS "Jüngster geladen",
       aeltester_offener AS "Ältester offener"
  FROM mart.backfill_fortschritt
 ORDER BY prozent, endpunkt`,
  },
  {
    schluessel: 'dq_backfill_balken',
    name: 'Backfill-Fortschritt',
    beschreibung: 'Derselbe Fortschritt als Balken — auf einen Blick, was noch fehlt.',
    anzeige: 'bar',
    sql: `
SELECT endpunkt AS "Endpunkt",
       prozent  AS "Fertig %"
  FROM mart.backfill_fortschritt
 ORDER BY prozent`,
    visualisierung: {
      'graph.dimensions': ['Endpunkt'],
      'graph.metrics': ['Fertig %'],
      'graph.goal_value': 100,
      'graph.show_goal': true,
    },
  },
  {
    schluessel: 'dq_sync',
    name: 'Letzte Importläufe',
    beschreibung: 'Gesundheit der letzten Läufe, jüngster zuerst. Erste Anlaufstelle, wenn Zahlen fehlen.',
    anzeige: 'table',
    sql: `
SELECT lauf_id                 AS "Lauf",
       gestartet_am            AS "Gestartet",
       beendet_am              AS "Beendet",
       status                  AS "Status",
       ausloeser               AS "Auslöser",
       aufgaben_gesamt         AS "Aufgaben",
       aufgaben_ok             AS "OK",
       aufgaben_fehler         AS "Fehler",
       aufgaben_uebersprungen  AS "Übersprungen",
       dauer_s                 AS "Dauer (s)",
       offene_abweichungen     AS "Schema-Abweichungen",
       pausierte_kombinationen AS "Pausiert"
  FROM mart.sync_status
 LIMIT 25`,
  },
  {
    schluessel: 'dq_datenstand',
    name: 'Datenstand je Betrieb',
    beschreibung:
      'Welche Betriebe sind überhaupt beurteilbar? Ohne diese Karte sieht ein Betrieb, dessen Daten fehlen, genauso aus wie ein Betrieb, bei dem alles in Ordnung ist — der teuerste Irrtum, den dieses System anbieten kann.',
    anzeige: 'table',
    sql: `
SELECT betrieb           AS "Betrieb",
       befund            AS "Befund",
       erster_tag        AS "Umsatz ab",
       letzter_tag       AS "Umsatz bis",
       umsatztage        AS "Umsatztage",
       umsatz_alter_tage AS "Umsatz Alter (Tage)",
       bwa_monat         AS "BWA gebucht bis",
       bwa_verzug_monate AS "BWA Verzug",
       artikeltage       AS "Artikeltage",
       letzter_personaltag AS "Personal bis",
       konzept           AS "Marke"
  FROM mart.datenstand
 ORDER BY CASE befund
            WHEN 'kein Umsatz geladen' THEN 1
            WHEN 'Umsatz veraltet'     THEN 2
            WHEN 'keine BWA gebucht'   THEN 3
            WHEN 'keine Artikeldaten'  THEN 4
            ELSE 5 END, betrieb`,
  },
  {
    schluessel: 'dq_befund',
    name: 'Befunde',
    beschreibung: 'Verteilung der Befunde über alle Betriebe. „vollständig" ist das Ziel.',
    anzeige: 'row',
    sql: `
SELECT befund   AS "Befund",
       count(*) AS "Betriebe"
  FROM mart.datenstand
 GROUP BY befund
 ORDER BY count(*) DESC`,
    visualisierung: {
      'graph.dimensions': ['Befund'],
      'graph.metrics': ['Betriebe'],
      'graph.show_values': true,
    },
  },
  {
    schluessel: 'dq_ohne_bruecke',
    name: 'Betriebe ohne BWA-Brücke',
    beschreibung:
      'ERWARTUNG: leer. Jede Zeile hier ist ein Betrieb, der in keiner Kennzahlenauswertung auftaucht — ohne Fehlermeldung, weil der Importer ihn schlicht nicht zuordnen kann.',
    anzeige: 'table',
    sql: `
SELECT betrieb    AS "Betrieb",
       stadt      AS "Stadt",
       aktiv      AS "Aktiv",
       hat_bwa    AS "Hat BWA",
       zuletzt_am AS "Zuletzt gesehen"
  FROM mart.betrieb_ohne_lina_id`,
  },
  {
    schluessel: 'dq_konzept',
    name: 'Markenzuordnung',
    beschreibung:
      'Woher die Marke je Betrieb kommt. Die Zeilen mit „mehrdeutig — Entscheidung fehlt" sind die Arbeitsliste: solange sie offen sind, laufen diese Betriebe in allen Markenauswertungen unter „(nicht zugeordnet)".',
    anzeige: 'table',
    sql: `
SELECT herkunft        AS "Herkunft",
       count(*)        AS "Betriebe",
       string_agg(betrieb, ', ' ORDER BY betrieb) AS "welche"
  FROM mart.konzept_zuordnung
 GROUP BY herkunft
 ORDER BY count(*) DESC`,
  },
  {
    schluessel: 'dq_umsatz_abweichung',
    name: 'Umsatz: Artikelsumme gegen Umsatzbericht',
    beschreibung:
      'Tagesumsatz aus den Artikelzeilen neu aufaddiert gegen getUmsatzbericht. Toleranz 0,5 % — Rundungen je Artikel summieren sich, echte Aggregationsfehler liegen deutlich darüber. Erwartung: keine auffälligen Zeilen.',
    anzeige: 'table',
    sql: `
SELECT betrieb       AS "Betrieb",
       geschaeftstag AS "Geschäftstag",
       lina_netto    AS "LINA netto",
       artikel_netto AS "aus Artikeln",
       differenz     AS "Differenz",
       differenz_pct AS "Differenz %"
  FROM mart.pruefung_umsatz
 WHERE auffaellig
 ORDER BY abs(differenz_pct) DESC
 LIMIT 200`,
  },
]
