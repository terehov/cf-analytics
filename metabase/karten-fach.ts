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

import type { Karte, Parameter } from './typen'
import { MONAT_CTE, MONAT_CTE_UMSATZ, MONAT_CTE_BWA, P_MONAT, P_BETRIEB, P_ZEITRAUM, P_MARKE, WOCHENTAGE } from './gemeinsam'

// Der Monat ist bewusst kein Pflichtfeld — siehe gemeinsam.ts.
const ZEITRAUM = P_ZEITRAUM
const MONAT = P_MONAT
const BETRIEB = P_BETRIEB
const MARKE = P_MARKE

/**
 * Die einzelne Ware. Nur hier gebraucht, deshalb nicht in gemeinsam.ts.
 *
 * MIT Werteliste: es sind 9.887 Waren mit Namen wie
 * "Blumenk.i.backt10,2G Tk Veg7Kg" — die tippt niemand fehlerfrei, und ein
 * Tippfehler ergibt in Metabase kein Fehlerbild, sondern eine leere Karte.
 */
const WARE: Parameter = {
  id: 'ware-param', name: 'ware', 'display-name': 'Ware', type: 'string/=',
  werteliste: ['mart', 'einkaufspreis_monat', 'ware'],
}

export const karten: Karte[] = [
  // ===================================================================
  // Umsatz — Entwicklung
  // ===================================================================
  {
    schluessel: 'um_kachel_monat',
    name: 'Umsatz laufender Monat',
    beschreibung: 'Netto-Umsatz aller Betriebe im laufenden Monat, bis zum letzten verfügbaren Geschäftstag.',
    anzeige: 'scalar',
    parameter: [BETRIEB],
    sql: `
SELECT sum(umsatz_netto) AS "Umsatz"
  FROM mart.umsatz_tag
 WHERE monat = date_trunc('month', current_date)::date
   [[AND betrieb = {{betrieb}}]]`,
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
    parameter: [BETRIEB],
    sql: `
SELECT sum(gaeste) AS "Gäste"
  FROM mart.umsatz_tag
 WHERE monat = date_trunc('month', current_date)::date
   [[AND betrieb = {{betrieb}}]]`,
  },
  {
    schluessel: 'um_kachel_bon',
    name: 'Ø Bon laufender Monat',
    beschreibung:
      'Umsatz je Rechnung im laufenden Monat. Gerechnet als Gesamtumsatz geteilt durch Gesamtzahl der Rechnungen, damit umsatzstarke Tage stärker zählen als schwache.',
    anzeige: 'scalar',
    parameter: [BETRIEB],
    sql: `
SELECT round(sum(umsatz_netto) / nullif(sum(rechnungen), 0), 2) AS "Ø Bon"
  FROM mart.umsatz_tag
 WHERE monat = date_trunc('month', current_date)::date
   [[AND betrieb = {{betrieb}}]]`,
    visualisierung: {
      column_settings: {
        '["name","Ø Bon"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 2 },
      },
    },
  },
  {
    schluessel: 'um_verlauf_tag',
    name: 'Umsatz je Tag',
    beschreibung: 'Tagesumsatz aller Betriebe. Das auffälligste Muster ist der Wochenrhythmus.',
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
      'Monatsumsatz gegen den gleichen Monat des Vorjahres, beides in Euro. Fehlt die Vorjahreslinie, sind die alten Daten noch nicht eingelesen — das heißt nicht, dass damals kein Umsatz war.',
    anzeige: 'bar',
    parameter: [BETRIEB, ZEITRAUM],
    // Der laufende Monat bleibt draussen: zwei geladene Tage neben einem
    // vollen Vorjahresmonat lesen sich als Einbruch, und genau so einer
    // stand hier am 03.08.2026 als letzter Balken.
    sql: `
SELECT monat                AS "Monat",
       sum(umsatz_monat)    AS "Umsatz",
       sum(umsatz_monat_vj) AS "Umsatz Vorjahr"
  FROM mart.umsatz_ytd
 WHERE monat < date_trunc('month', current_date)::date
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY monat
 ORDER BY monat`,
    template_tag_dimension: { zeitraum: ['mart', 'umsatz_ytd', 'monat'] },
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
      'Veränderung zum gleichen Monat des Vorjahres in Prozent. Balken über der Nulllinie sind Wachstum, darunter Rückgang.',
    anzeige: 'bar',
    parameter: [BETRIEB, ZEITRAUM],
    // Wie beim Monatsverlauf: der angebrochene Monat gehoert nicht in den
    // Vorjahresvergleich — das HAVING unten fing ihn nicht, weil das
    // VORJAHR voll da ist. Der letzte Balken zeigte -91,6 %.
    sql: `
SELECT monat AS "Monat",
       CASE WHEN sum(umsatz_monat_vj) > 0
            THEN round((sum(umsatz_monat) - sum(umsatz_monat_vj))
                       / sum(umsatz_monat_vj) * 100, 1)
       END   AS "Veränderung %"
  FROM mart.umsatz_ytd
 WHERE monat < date_trunc('month', current_date)::date
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY monat
HAVING sum(umsatz_monat_vj) > 0
 ORDER BY monat`,
    template_tag_dimension: { zeitraum: ['mart', 'umsatz_ytd', 'monat'] },
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
    beschreibung: 'Rangliste der Betriebe im gewählten Monat, mit Durchschnittsbon und Umsatz je Gast. Die letzten Zeilen sind die interessanten.',
    anzeige: 'table',
    parameter: [MONAT, BETRIEB],
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
   [[AND y.betrieb = {{betrieb}}]]
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
    beschreibung:
      'Durchschnittlicher Tagesumsatz je Wochentag — die Grundlage für jede Frage nach Öffnungszeiten und Ruhetagen. Gezählt werden nur Tage MIT Umsatz; die Spalte „Tage" zeigt, wie viele das je Wochentag waren — ein Ruhetag fällt also nicht als 0 in den Schnitt, sondern als fehlender Tag auf.',
    anzeige: 'bar',
    parameter: [BETRIEB, ZEITRAUM],
    // Zwei Fehler in einem SQL behoben (03.08.2026): TMDay haengt an der
    // Server-Locale und lieferte "Monday"; und avg() ueber das volle
    // 141x3136-Gitter mittelte Nulltage mit — fuer ein Haus, das im Mai
    // eroeffnet hat, hiess das Ø Montag 74 EUR statt 3.677 EUR.
    sql: `
SELECT extract(isodow FROM geschaeftstag)::int                    AS sortier,
       ${WOCHENTAGE}[extract(isodow FROM geschaeftstag)::int]     AS "Wochentag",
       round(avg(tagesumsatz), 2)                                 AS "Ø Umsatz",
       round(avg(gaeste), 0)                                      AS "Ø Gäste",
       count(*)                                                   AS "Tage"
  FROM (
        SELECT geschaeftstag, sum(umsatz_netto) AS tagesumsatz, sum(gaeste) AS gaeste
          FROM mart.umsatz_tag
         WHERE umsatz_netto <> 0
           [[AND betrieb = {{betrieb}}]]
           [[AND {{zeitraum}}]]
         GROUP BY geschaeftstag
       ) t
 GROUP BY 1, 2
 ORDER BY 1`,
    template_tag_dimension: { zeitraum: ['mart', 'umsatz_tag', 'geschaeftstag'] },
    visualisierung: {
      'graph.dimensions': ['Wochentag'],
      'graph.metrics': ['Ø Umsatz'],
      'table.columns': [
        { name: 'sortier', enabled: false },
        { name: 'Wochentag', enabled: true },
        { name: 'Ø Umsatz', enabled: true },
        { name: 'Ø Gäste', enabled: true },
        { name: 'Tage', enabled: true },
      ],
    },
  },
  {
    schluessel: 'um_bon_gast',
    name: 'Durchschnittsbon und Umsatz je Gast',
    beschreibung:
      'Durchschnittsbon und Umsatz je Gast im Verlauf. Die beiden laufen selten parallel: steigt der Bon, während der Umsatz je Gast fällt, sitzen größere Gruppen am Tisch — mehr Umsatz je Rechnung, aber nicht je Person.',
    anzeige: 'line',
    parameter: [BETRIEB, ZEITRAUM],
    // "Ø je Gast" rechnet nur ueber Monate mit belastbarer Gaestezaehlung
    // (umsatz_pro_gast ist in mart.umsatz_ytd NULL, wenn weniger als 80 %
    // der Umsatztage eine Gaestezahl tragen). Ohne den Filter teilte die
    // Karte den Monatsumsatz durch die Gaeste weniger Tage — bis 390 EUR
    // je Gast bei einem realen Schnitt um 36.
    sql: `
SELECT monat                                                    AS "Monat",
       round(sum(umsatz_monat) / nullif(sum(rechnungen), 0), 2) AS "Ø Bon",
       round(sum(umsatz_monat) FILTER (WHERE umsatz_pro_gast IS NOT NULL)
             / nullif(sum(gaeste) FILTER (WHERE umsatz_pro_gast IS NOT NULL), 0), 2)
                                                                AS "Ø je Gast"
  FROM mart.umsatz_ytd
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY monat
 ORDER BY monat`,
    template_tag_dimension: { zeitraum: ['mart', 'umsatz_ytd', 'monat'] },
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
      'Umsatz nach Speisen und Getränken. Achtung: bisher werden nur diese beiden Sparten geliefert, ihre Summe ist deshalb kleiner als der Gesamtumsatz.',
    anzeige: 'bar',
    parameter: [BETRIEB, ZEITRAUM],
    sql: `
SELECT monat              AS "Monat",
       hauptsparte        AS "Sparte",
       sum(umsatz_netto)  AS "Umsatz"
  FROM mart.umsatz_tag_sparte
 WHERE hauptsparte IS NOT NULL
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY monat, hauptsparte
 ORDER BY monat, hauptsparte`,
    template_tag_dimension: { zeitraum: ['mart', 'umsatz_tag_sparte', 'geschaeftstag'] },
    visualisierung: {
      'graph.dimensions': ['Monat', 'Sparte'],
      'graph.metrics': ['Umsatz'],
      'stackable.stack_type': 'stacked',
    },
  },
  {
    schluessel: 'st_sparte_anteil',
    name: 'Spartenanteil je Betrieb',
    beschreibung: 'Wie sich der Umsatz je Betrieb auf Speisen und Getränke verteilt. Der Getränkeanteil ist der größte Hebel für den Wareneinsatz an der Bar.',
    anzeige: 'table',
    parameter: [MONAT, BETRIEB],
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
   [[AND sp.betrieb = {{betrieb}}]]
 GROUP BY sp.betrieb
 ORDER BY sum(sp.umsatz_netto) DESC`,
  },
  // ENTFALLEN AM 03.08.2026: die Karte 'st_verkaufsstelle' ("Umsatz je
  // Verkaufsstelle"). LINA liefert die Dimension schlicht nicht —
  // verkaufsstelle ist in allen 884.352 Zeilen von mart.umsatz_tag_sparte
  // NULL, die Karte konnte nie eine Zeile zeigen. Ein dauerhaft leeres
  // Diagramm neben gefuellten liest sich als "kein Ausser-Haus-Geschaeft",
  // nicht als "Daten fehlen" — und das ist der teurere Irrtum. Kommt
  // wieder, falls der Abruf die Verkaufsstellen eines Tages liefert.
  {
    // Die Tagesgrenze ist hier der ganze Trick: der Geschaeftstag laeuft
    // 08:00 bis 07:59, die Stunden 0 bis 7 gehoeren also ans Ende.
    schluessel: 'st_stunde',
    name: 'Tagesverlauf nach Stunde',
    beschreibung:
      'Umsatz je Stunde über alle Tage. Der Geschäftstag beginnt um 08:00 und endet um 07:59 des Folgetags — die Nachtstunden stehen deshalb am Ende und nicht am Anfang.',
    anzeige: 'bar',
    parameter: [BETRIEB, ZEITRAUM],
    sql: `
SELECT lpad(stunde::text, 2, '0') || ':00' AS "Stunde",
       sum(umsatz_netto)                   AS "Umsatz"
  FROM mart.umsatz_stunde
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY stunde
 ORDER BY ((stunde + 16) % 24)`,
    template_tag_dimension: { zeitraum: ['mart', 'umsatz_stunde', 'geschaeftstag'] },
    visualisierung: {
      'graph.dimensions': ['Stunde'],
      'graph.metrics': ['Umsatz'],
      'graph.x_axis.title_text': 'Stunde des Geschäftstags (08:00 → 07:59)',
    },
  },
  {
    // Das Dienstplan-Werkzeug: Wochentag und Stunde in EINER Matrix.
    // Stundenverlauf und Wochentagsbalken existierten je fuer sich; die
    // Frage "brauche ich Samstagmittag mehr Leute als Dienstagabend?"
    // beantwortet erst die Kreuzung. Bewusst eine Tabelle mit sieben
    // Spalten statt einer Pivot-Konfiguration: die Tabelle rendert
    // ueberall gleich, und sieben Wochentage sind keine dynamische
    // Dimension, die eine Pivot rechtfertigt.
    schluessel: 'st_wochenprofil',
    name: 'Wochenprofil — Stunde × Wochentag',
    beschreibung:
      'Durchschnittlicher Stundenumsatz je Wochentag, Zeilen in Geschäftstagsreihenfolge (08:00 bis 07:59). Ohne Betriebsfilter das Konzernprofil; mit Betrieb das Werkzeug für den Dienstplan. Der Schnitt läuft über alle Tage des Zeitraums — Ruhetage drücken ihn, das ist hier Absicht: geplant wird die Woche, wie sie ist.',
    anzeige: 'table',
    parameter: [BETRIEB, ZEITRAUM],
    sql: `
SELECT lpad(stunde::text, 2, '0') || ':00'                        AS "Stunde",
       round(avg(umsatz) FILTER (WHERE dow = 1))                  AS "Mo",
       round(avg(umsatz) FILTER (WHERE dow = 2))                  AS "Di",
       round(avg(umsatz) FILTER (WHERE dow = 3))                  AS "Mi",
       round(avg(umsatz) FILTER (WHERE dow = 4))                  AS "Do",
       round(avg(umsatz) FILTER (WHERE dow = 5))                  AS "Fr",
       round(avg(umsatz) FILTER (WHERE dow = 6))                  AS "Sa",
       round(avg(umsatz) FILTER (WHERE dow = 7))                  AS "So"
  FROM (
        SELECT geschaeftstag, stunde,
               extract(isodow FROM geschaeftstag)::int AS dow,
               sum(umsatz_netto)                       AS umsatz
          FROM mart.umsatz_stunde
         WHERE 1 = 1
           [[AND betrieb = {{betrieb}}]]
           [[AND {{zeitraum}}]]
         GROUP BY geschaeftstag, stunde
       ) t
 GROUP BY stunde
 ORDER BY ((stunde + 16) % 24)`,
    template_tag_dimension: { zeitraum: ['mart', 'umsatz_stunde', 'geschaeftstag'] },
  },
  {
    schluessel: 'st_zeitzone',
    name: 'Umsatz nach Zeitzone',
    beschreibung:
      'Umsatz nach Tageszeit: Frühstück, Mittagszeit, Nachmittag, Happy Hour, Abendessen und Late Night. „Late Night" läuft über Mitternacht hinaus.',
    anzeige: 'bar',
    parameter: [BETRIEB, ZEITRAUM],
    sql: `
SELECT zeitzone           AS "Zeitzone",
       sum(umsatz_netto)  AS "Umsatz"
  FROM mart.umsatz_zeitzone
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY zeitzone, minute_von
 ORDER BY minute_von`,
    template_tag_dimension: { zeitraum: ['mart', 'umsatz_zeitzone', 'geschaeftstag'] },
    visualisierung: {
      'graph.dimensions': ['Zeitzone'],
      'graph.metrics': ['Umsatz'],
    },
  },
  {
    schluessel: 'st_zeitzone_betrieb',
    name: 'Zeitzonen je Betrieb',
    beschreibung: 'Welcher Betrieb wovon lebt. Ein Mittagsgeschäft und eine Abendgastronomie brauchen verschiedene Maßnahmen.',
    anzeige: 'table',
    parameter: [MONAT, BETRIEB],
    sql: `${MONAT_CTE_UMSATZ}
SELECT uz.betrieb                                                  AS "Betrieb",
       round(sum(uz.umsatz_netto))                                 AS "Umsatz",
       round(100 * sum(uz.umsatz_netto) FILTER (WHERE uz.zeitzone = 'Frühstück')
             / nullif(sum(uz.umsatz_netto), 0), 1)                 AS "Frühstück %",
       round(100 * sum(uz.umsatz_netto) FILTER (WHERE uz.zeitzone = 'Mittagszeit')
             / nullif(sum(uz.umsatz_netto), 0), 1)                 AS "Mittag %",
       round(100 * sum(uz.umsatz_netto) FILTER (WHERE uz.zeitzone = 'Nachmittag')
             / nullif(sum(uz.umsatz_netto), 0), 1)                 AS "Nachmittag %",
       round(100 * sum(uz.umsatz_netto) FILTER (WHERE uz.zeitzone = 'Happy Hour')
             / nullif(sum(uz.umsatz_netto), 0), 1)                 AS "Happy Hour %",
       round(100 * sum(uz.umsatz_netto) FILTER (WHERE uz.zeitzone = 'Abendessen')
             / nullif(sum(uz.umsatz_netto), 0), 1)                 AS "Abend %",
       round(100 * sum(uz.umsatz_netto) FILTER (WHERE uz.zeitzone = 'Late Night')
             / nullif(sum(uz.umsatz_netto), 0), 1)                 AS "Late Night %"
  FROM mart.umsatz_zeitzone uz
  CROSS JOIN gewaehlt g
 WHERE uz.monat = g.monat
   [[AND uz.betrieb = {{betrieb}}]]
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
      'Die 20 Betriebe mit der höchsten Personalkostenquote ohne Geschäftsführung — die Größe aus '
      + 'der BWA des Steuerberaters, an der die Ampel „Personal" hängt (nicht die operativen '
      + 'Bereichsquoten aus dem Kassensystem weiter unten). Auf 20 begrenzt, damit die Namen lesbar '
      + 'bleiben — die vollständige Liste steht in der Tabelle darunter.',
    anzeige: 'row',
    parameter: [MONAT, BETRIEB],
    sql: `${MONAT_CTE}
SELECT r.betrieb                AS "Betrieb",
       r.personalkosten_ogf_pct AS "Personal o. GF %"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.monat = g.monat
   AND r.personalkosten_ogf_pct IS NOT NULL
   -- Nur operative Betriebe: die Top-4 waren geschlossene Haeuser mit bis
   -- zu 4,5 Jahre alten, fortgeschriebenen Quoten. Ein ausdruecklich
   -- gewaehlter Betrieb bleibt trotzdem sichtbar.
   AND (r.operativ [[ OR r.betrieb = {{betrieb}} ]])
   [[AND r.betrieb = {{betrieb}}]]
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
      'Alle Betriebe mit Ampel und Abstand zur 28-%-Schwelle, gerechnet auf den Personalkosten ohne '
      + 'Geschäftsführung aus der BWA. Ein positiver Wert in „Δ Schwelle" heißt: um so viele '
      + 'Prozentpunkte liegt der Betrieb über der Grenze. „BWA-Alter" sagt, wie alt die zugrunde '
      + 'liegende Buchung ist — bei mehreren Monaten ist das Urteil entsprechend alt.',
    anzeige: 'table',
    parameter: [MONAT, BETRIEB],
    sql: `${MONAT_CTE}
SELECT r.betrieb                            AS "Betrieb",
       r.konzept                            AS "Marke",
       coalesce(ap.emoji, '⚪')              AS "●",
       r.personalkosten_ogf_pct             AS "Personal o. GF %",
       round(r.personalkosten_ogf_pct - 28, 1) AS "Δ Schwelle",
       r.bwa_monat                          AS "BWA-Stand",
       r.bwa_alter_monate                   AS "BWA-Alter (Monate)"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
  LEFT JOIN ampel.beschriftung ap ON ap.status = r.ampel_personal
 WHERE r.monat = g.monat
   AND r.personalkosten_ogf_pct IS NOT NULL
   AND (r.operativ [[ OR r.betrieb = {{betrieb}} ]])
   [[AND r.betrieb = {{betrieb}}]]
 ORDER BY r.personalkosten_ogf_pct DESC`,
  },
  {
    schluessel: 'pe_bereich',
    name: 'Personalkosten je Bereich',
    beschreibung:
      'Personalkostenquoten für Service, Bar und Küche nebeneinander, in Prozent vom Umsatz. '
      + '„Personal gesamt (operativ)" ist die Summe dieser drei Bereiche aus dem Kassensystem — '
      + 'ohne Geschäftsführung und ohne Verwaltung. Die Spalte daneben, „Personal o. GF % '
      + '(BWA · Ampel)", ist eine '
      + 'ANDERE Größe: sie kommt aus der BWA des Steuerberaters, und nur an ihr hängt die Ampel im '
      + 'Round Table. Dass beide abweichen, ist normal — die eine ist der laufende Betrieb, die '
      + 'andere das gebuchte Ergebnis.',
    anzeige: 'table',
    parameter: [BETRIEB, ZEITRAUM],
    sql: `
SELECT betrieb            AS "Betrieb",
       zeitraum_von::date AS "Von",
       zeitraum_bis::date AS "Bis",
       -- Die Spaltennamen tragen die Herkunft, weil die Tabelle sonst zwei
       -- verschiedene Groessen wie zwei Fassungen derselben aussehen laesst:
       -- pek_* ist die Kasse (Service+Bar+Kueche, ohne GF und Verwaltung),
       -- persoog_bwa der Steuerberater -- und nur letztere traegt die Ampel.
       pek_gesamt         AS "Personal gesamt % (operativ)",
       pek_service        AS "Service %",
       pek_bar            AS "Bar %",
       pek_kueche         AS "Küche %",
       persoog_bwa        AS "Personal o. GF % (BWA · Ampel)",
       ampel_global       AS "Ampel global",
       ampel_lina         AS "Ampel LINA"
  FROM mart.personalkosten
 WHERE (pek_gesamt <> 0 OR eff_gesamt <> 0)
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 ORDER BY zeitraum_von DESC, betrieb`,
    template_tag_dimension: { zeitraum: ['mart', 'personalkosten', 'zeitraum_von'] },
  },
  {
    schluessel: 'pe_effektivitaet',
    name: 'Effektivität je Bereich',
    beschreibung:
      'Umsatz je geleisteter Personalstunde in Euro, gesamt und je Bereich. Sagt, was eine Arbeitsstunde einbringt — anders als die Quote, die sagt, was sie kostet.',
    anzeige: 'table',
    parameter: [BETRIEB, ZEITRAUM],
    sql: `
SELECT betrieb            AS "Betrieb",
       zeitraum_von::date AS "Von",
       zeitraum_bis::date AS "Bis",
       eff_gesamt         AS "Effektivität gesamt",
       eff_service        AS "Service",
       eff_bar            AS "Bar",
       eff_kueche         AS "Küche"
  FROM mart.personalkosten
 WHERE (pek_gesamt <> 0 OR eff_gesamt <> 0)
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 ORDER BY zeitraum_von DESC, betrieb`,
    template_tag_dimension: { zeitraum: ['mart', 'personalkosten', 'zeitraum_von'] },
  },
  {
    schluessel: 'pe_verlauf',
    name: 'Personalkostenquote im Verlauf',
    beschreibung: 'Die Personalkostenquote über die Monate, aus den Zahlen des Steuerberaters. Die Linie bei 28 % ist die Grenze, ab der die Ampel im Round Table auf Grün steht.',
    anzeige: 'line',
    parameter: [BETRIEB, ZEITRAUM],
    sql: `
SELECT monat                                                     AS "Monat",
       round(avg(personalkosten_ogf_pct), 2)                     AS "Ø Personal o. GF %",
       round(percentile_cont(0.5) WITHIN GROUP
             (ORDER BY personalkosten_ogf_pct)::numeric, 2)      AS "Median"
  FROM mart.round_table_monat
 WHERE personalkosten_ogf_pct IS NOT NULL
   -- Nur Monate, in denen die Quote WIRKLICH gebucht ist: der Nachtrag
   -- kopierte den letzten gebuchten Monat in die Folgemonate, und die
   -- Linie endete mit einem kuenstlichen Plateau, das Stabilitaet
   -- suggerierte, wo schlicht noch nichts gebucht war.
   AND bwa_alter_monate = 0
   AND operativ
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY monat
 ORDER BY monat`,
    template_tag_dimension: { zeitraum: ['mart', 'round_table_monat', 'monat'] },
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
    name: 'Umsatzstärkste Artikel',
    beschreibung:
      'Die 50 umsatzstärksten Artikel im gewählten Zeitraum. Sortiert nach Umsatz, nicht nach Stückzahl — nach Menge führten technische Zähl-PLUs wie „Fax" mit 91.000 Buchungen ohne einen Euro. „DB %" gilt nur für den Umsatzanteil MIT hinterlegtem Wareneinsatz (Spalte „WE hinterlegt %") und ist eine Umsatzgliederung, keine Margenaussage. Bitte zuerst einen Zeitraum wählen — ohne Eingrenzung wertet die Karte die gesamte Historie aus.',
    anzeige: 'table',
    parameter: [ZEITRAUM, BETRIEB, MARKE],
    // Nach dem nullif(fixer_we,0)-Fix (Migration 0039) ist deckungsbeitrag
    // NULL, wo kein WE-Ansatz hinterlegt ist. "DB %" bezieht sich deshalb
    // auf den ABGEDECKTEN Umsatz — vorher stand dort glatt 100 % fuer
    // drei Viertel der Artikel, eine Margenaussage aus dem Wert, der laut
    // Projektregel keine tragen darf.
    sql: `
SELECT artikel                        AS "Artikel",
       warengruppe                    AS "Warengruppe",
       sum(menge)                     AS "Menge",
       sum(umsatz_netto)              AS "Umsatz",
       round(avg(verkaufspreis), 2)   AS "Ø Preis",
       sum(deckungsbeitrag)           AS "Deckungsbeitrag",
       round(100 * sum(deckungsbeitrag)
             / nullif(sum(umsatz_netto) FILTER (WHERE fixer_we IS NOT NULL), 0), 1) AS "DB %",
       round(100 * sum(umsatz_netto) FILTER (WHERE fixer_we IS NOT NULL)
             / nullif(sum(umsatz_netto), 0), 1)                                     AS "WE hinterlegt %"
  FROM mart.artikelverkauf
 WHERE umsatz_netto IS NOT NULL
   [[AND {{zeitraum}}]]
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]
 GROUP BY artikel, warengruppe
HAVING sum(umsatz_netto) > 0
 ORDER BY sum(umsatz_netto) DESC
 LIMIT 50`,
    template_tag_dimension: { zeitraum: ['mart', 'artikelverkauf', 'geschaeftstag'] },
  },
  {
    schluessel: 'wa_penner',
    name: 'Artikel mit dem geringsten Absatz',
    beschreibung:
      'Artikel, die verkauft wurden, aber kaum — Kandidaten zum Streichen. Artikel ohne einen einzigen Verkauf tauchen hier nicht auf, weil der Verkaufsbericht sie nicht kennt.',
    anzeige: 'table',
    parameter: [ZEITRAUM, BETRIEB, MARKE],
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
   [[AND konzept = {{marke}}]]
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
      'Deckungsbeitrag je Warengruppe. Bitte zuerst die Spalte „Abdeckung" lesen: sie sagt, für welchen Anteil des Umsatzes überhaupt Rezepturen hinterlegt sind. Steht dort 60 %, ist der ausgewiesene Deckungsbeitrag zu günstig — man sieht es der Zahl selbst nicht an.',
    anzeige: 'table',
    parameter: [ZEITRAUM, BETRIEB, MARKE],
    // ZEITRAUM DIREKT AUF geschaeftstag -- NICHT ueber eine Unterabfrage.
    //
    // Bis zum 01.08.2026 stand hier der Filter als
    //     AND d.monat IN (SELECT DISTINCT monat FROM mart.artikelverkauf
    //                      WHERE {{zeitraum}})
    // auf mart.deckungsbeitrag_warengruppe. Das sieht richtig aus und ist
    // es rechnerisch auch -- nur wirkt der Zeitraum dann ausschliesslich
    // in der INNEREN Abfrage. Die aeussere Sicht aggregiert vorher die
    // GESAMTE Historie und filtert erst hinterher.
    //
    // Gemessen am 01.08.2026 mit der Voreinstellung "letzte 3 Monate":
    // 111 Partitionsscans auf core.artikelverkauf_tag statt der drei
    // gebrauchten, >120 s bis zum Abbruch. Genau die Falle, vor der der
    // Kommentar an mart.artikelverkauf warnt ("in Metabase immer nach
    // geschaeftstag filtern, dann greift das Partition Pruning").
    //
    // Jetzt liegt der Zeitraum auf geschaeftstag der Basissicht, und die
    // Aggregation je Warengruppe passiert hier statt in der Sicht:
    // 3 Partitionsscans, 2,4 s. Zahlen unveraendert -- gegen die alte
    // Fassung ueber alle 194 Warengruppen verglichen, Menge, Umsatz und
    // Abdeckung stimmen auf die Stelle ueberein.
    //
    // "Abdeckung %" wird dabei aus den Summen gerechnet statt als avg der
    // Monatswerte. Das ist die umsatzgewichtete und damit richtigere
    // Lesart; nachgemessen betraegt der groesste Unterschied ueber alle
    // Warengruppen 0,0 Prozentpunkte.
    //
    // Der Zeitraum arbeitet auf TAGEN, die Auswertung liegt je Monat vor:
    // ein angeschnittener Monat zaehlt jetzt nur noch mit seinen Tagen im
    // Zeitraum, nicht mehr ganz. Das ist die genauere Antwort auf die
    // gestellte Frage.
    // OHNE ALIAS, und das ist Pflicht, keine Vorliebe: {{zeitraum}} ist ein
    // Feldfilter auf mart.artikelverkauf. Metabase setzt dafuer
    // "artikelverkauf.geschaeftstag" ein -- unter einem Alias ist dieser
    // Name nicht mehr in Reichweite, und die Karte scheitert genau dann,
    // wenn jemand den Filter setzt (docs/fehlerkatalog.md).
    sql: `
SELECT mart.artikelverkauf.warengruppe                  AS "Warengruppe",
       sum(mart.artikelverkauf.menge)                   AS "Menge",
       sum(mart.artikelverkauf.umsatz_netto)            AS "Umsatz",
       sum(mart.artikelverkauf.wareneinsatz_theoretisch) AS "WE theoretisch",
       sum(mart.artikelverkauf.umsatz_netto) FILTER (WHERE mart.artikelverkauf.fixer_we IS NOT NULL)
         - sum(mart.artikelverkauf.wareneinsatz_theoretisch)
                                                        AS "Deckungsbeitrag",
       -- DB % auf dem ABGEDECKTEN Umsatz: seit nullif(fixer_we,0)
       -- (Migration 0039) ist der Wareneinsatz NULL, wo kein Ansatz
       -- hinterlegt ist. Den vollen Umsatz in den Nenner zu nehmen
       -- hiesse, fehlende Ansaetze als 100-%-Marge zu verkaufen.
       round(100 * (sum(mart.artikelverkauf.umsatz_netto) FILTER (WHERE mart.artikelverkauf.fixer_we IS NOT NULL)
                    - sum(mart.artikelverkauf.wareneinsatz_theoretisch))
             / nullif(sum(mart.artikelverkauf.umsatz_netto) FILTER (WHERE mart.artikelverkauf.fixer_we IS NOT NULL), 0), 1)
                                                        AS "DB %",
       round(100 * sum(mart.artikelverkauf.umsatz_netto) FILTER (WHERE mart.artikelverkauf.fixer_we IS NOT NULL)
             / nullif(sum(mart.artikelverkauf.umsatz_netto), 0), 1) AS "Abdeckung %"
  FROM mart.artikelverkauf
 WHERE 1 = 1
   [[ AND {{zeitraum}} ]]
   [[ AND mart.artikelverkauf.betrieb = {{betrieb}} ]]
   [[ AND mart.artikelverkauf.konzept = {{marke}} ]]
 GROUP BY mart.artikelverkauf.warengruppe
 ORDER BY sum(mart.artikelverkauf.umsatz_netto) DESC NULLS LAST`,
    template_tag_dimension: { zeitraum: ['mart', 'artikelverkauf', 'geschaeftstag'] },
  },
  // ENTFALLEN AM 01.08.2026 (Migration 0029): die Karte
  // 'wa_we_pruefung' -- "Rechnerischer gegen tatsächlichen
  // Wareneinsatz". Ihre Quelle mart.pruefung_wareneinsatz ist
  // stillgelegt.
  //
  // Zwei Gruende, beide unabhaengig voneinander ausreichend:
  //
  //   1. fixer_we stammt aus LINAs Warenwirtschaft, und die enthaelt
  //      Demodaten. Der Sollwert war nicht verantwortbar.
  //   2. Die Karte zeigte fuer 2.590 von 5.364 Betriebsmonaten eine
  //      Luecke in voller Hoehe des BWA-Wareneinsatzes -- daneben
  //      "Abdeckung 100 %". Der Waechter, der genau das haette melden
  //      sollen, prueft auf IS NOT NULL, und fixer_we ist nie NULL,
  //      sondern 0. Er hat nie ausgeloest.
  //
  // Wer die Karte vermisst: sie kommt in Stufe 2.4 auf Basis der
  // FoodNotify-Zutatenkosten zurueck, dann mit Bar/Kueche-Split.
  // Siehe docs/plan-foodnotify.md.
  // Die Karte 'wa_preise' hiess bis zum 01.08.2026 "Einkaufspreise im
  // Verlauf" und las mart.preisentwicklung_ware -- LINAs Warenwirtschaft,
  // also Demodaten (AGENTS.md Regel 5). Sie zeigte 1.111 Zeilen
  // erfundener Einkaufspreise als echte an, ohne jede Kennzeichnung.
  //
  // Ihre eigene Beschreibung war im Rueckblick der Hinweis: "Die Reihe
  // beginnt mit der ersten Erfassung -- fuer die Zeit davor gibt es keine
  // Preise, weil sie nirgends gespeichert wurden." Genau umgekehrt: bei
  // FoodNotify entsteht die Historie aus den Bestellungen selbst und
  // reicht bei Aposto bis Oktober 2021 zurueck.
  //
  // Seit dem 02.08.2026 (Stufe 1.7, Migration 0035) steht sie wieder --
  // auf core.bestellposition, mit echten Belegpreisen.
  {
    schluessel: 'wa_ladestand',
    name: 'Wie vollständig sind die Einkaufsdaten?',
    beschreibung:
      'ZUERST LESEN. „Positionen %" misst nur die Tiefe der BEREITS GELADENEN Bestellungen — fehlende Bestellungen sieht die Spalte nicht. Ob die Bestell-Liste einer Marke vollständig ist, sagt „Seiten offen": solange dort etwas steht, fehlen ganze Bestellungen, egal was die Prozentspalte behauptet. Die Seiten laufen je Kostenstelle chronologisch AUFSTEIGEND — bei unfertigen Marken fehlen also gerade die JÜNGSTEN Monate.',
    anzeige: 'table',
    parameter: [MARKE],
    // Der Vorgaenger dieser Beschreibung versprach das Gegenteil ("erst
    // bei 100 % ist er vollstaendig") und behauptete, es werde rueckwaerts
    // geladen. Beides falsch, und die Karte war ausgerechnet als
    // Vertrauensanker deklariert: Enchilada stand mit "1 Bestellung /
    // 100,0 %" da, waehrend 600 Listen-Seiten offen waren.
    sql: `
SELECT monat                AS "Monat",
       marke                AS "Marke",
       bestellungen         AS "Bestellungen",
       mit_positionen       AS "davon mit Positionen",
       positionen_pct       AS "Positionen %",
       seiten_offen         AS "Seiten offen",
       CASE WHEN liste_vollstaendig THEN '✓' ELSE '… lädt' END AS "Liste vollständig?",
       -- Die drei Spalten sagen, was NICHT im Einkaufsvolumen steht bzw.
       -- dort fraglich steht. status_unbekannt ist der Waechter: > 0
       -- heisst, ein Status kommt nicht durch den Importer — genau der
       -- Fehler, der bis zum 04.08.2026 in allen 44.271 Zeilen stand.
       nullif(storniert, 0)        AS "storniert (raus)",
       nullif(pending, 0)          AS "pending (ungeklärt)",
       nullif(status_unbekannt, 0) AS "Status unbekannt"
  FROM mart.einkauf_ladestand
 WHERE 1 = 1
   [[AND marke = {{marke}}]]
 ORDER BY monat DESC, marke`,
  },
  {
    schluessel: 'wa_preise',
    name: 'Einkaufspreise im Verlauf',
    beschreibung:
      'Was ein bestelltes Gebinde gekostet hat — ein Karton, ein Sack, eine Kiste. Gezeigt wird der Median: eine einzelne Fehlbuchung würde den Durchschnitt verzerren. Die Spalte „je Einheit" (€/kg, €/l) steht daneben, ist aber oft leer: FoodNotify pflegt die Angabe, wie viel in einem Gebinde steckt, für dieselbe Ware widersprüchlich — sie erscheint nur, wo sie belegbar war. Die Werte stammen aus echten Bestellungen, nicht aus einem Katalog. Bitte vorher „Wie vollständig sind die Einkaufsdaten?" ansehen.',
    anzeige: 'table',
    parameter: [MARKE, WARE],
    /*
     * Der FÜHRENDE Preis ist der je Gebinde (Migration 0041). Der Preis
     * je Einheit hing an FoodNotifys `unitQuantity`, und die schwankt für
     * dieselbe Ware zwischen 0,00035 und 50 — die Karte zeigte deshalb
     * 48.400 EUR/kg für Kaffee.
     *
     * DIE KARTE HIESS "IM VERLAUF" UND ZEIGTE KEINEN. Bis zum 12.08.2026
     * stand hier `ORDER BY monat DESC, ausgaben DESC LIMIT 500`. Das
     * schnitt ab, bevor ein zweiter Monat kam: gemessen deckten die 500
     * Zeilen GENAU EINEN Monat ab, mit 441 verschiedenen Waren
     * nebeneinander. Die Sicht darunter hat 9.887 Waren über 75 Monate.
     *
     * Jetzt umgekehrt: erst die Waren nach Volumen ranken, dann von den
     * grössten deren ganze Historie zeigen. Mit gesetztem Warenfilter
     * bleibt genau eine Ware übrig und man sieht ihre Reihe am Stück.
     */
    sql: `
WITH basis AS (
  SELECT * FROM mart.einkaufspreis_monat
   WHERE monat >= (date_trunc('month', current_date) - interval '24 months')::date
     [[AND marke = {{marke}}]]
     [[AND ware  = {{ware}}]]
), rang AS (
  SELECT ware, marke, sum(ausgaben) AS ausgaben_ware,
         row_number() OVER (ORDER BY sum(ausgaben) DESC) AS rang
    FROM basis GROUP BY ware, marke
)
SELECT b.ware                     AS "Ware",
       b.marke                    AS "Marke",
       b.monat                    AS "Monat",
       b.bestellungen             AS "Bestellungen",
       b.gebinde                  AS "Gebinde",
       b.ausgaben                 AS "Ausgaben",
       b.preis_je_gebinde         AS "Preis je Gebinde",
       b.gebinde_typisch          AS "Gebindegrösse",
       nullif(b.gebinde_varianten, 1) AS "verschiedene Gebinde",
       b.preis_min                AS "günstigster",
       b.preis_max                AS "teuerster",
       b.einheit                  AS "Einheit",
       b.preis_je_einheit_median  AS "je Einheit"
  FROM basis b JOIN rang r USING (ware, marke)
 WHERE r.rang <= 20
 ORDER BY r.ausgaben_ware DESC, b.ware, b.monat DESC
 LIMIT 500`,
  },

  {
    /*
     * Die Preisreihe als Bild. Bewusst getrennt von der Tabelle darüber und
     * bewusst eng: acht Waren sind das Meiste, was in einem Liniendiagramm
     * noch unterscheidbar ist — bei 441 Linien sieht man nichts.
     *
     * OHNE WARENFILTER zeigt sie die acht umsatzstärksten. Das ist eine
     * Auswahl und keine Aussage über den Konzern; wer eine bestimmte Ware
     * sucht, setzt den Filter oben.
     */
    schluessel: 'wa_preis_verlauf',
    name: 'Preisreihe einer Ware',
    beschreibung:
      'Der Gebindepreis über die Zeit, eine Linie je Ware. Ohne Warenfilter die acht umsatzstärksten der letzten zwei Jahre — das ist eine Auswahl, keine Konzernaussage. Ein Sprung auf genau das Doppelte oder die Hälfte ist fast immer ein Wechsel der Gebindegrösse und keine Teuerung; die Tabelle darüber zeigt in der Spalte „Gebindegrösse", ob sich etwas geändert hat.',
    anzeige: 'line',
    parameter: [MARKE, WARE],
    sql: `
WITH basis AS (
  SELECT * FROM mart.einkaufspreis_monat
   WHERE monat >= (date_trunc('month', current_date) - interval '24 months')::date
     [[AND marke = {{marke}}]]
     [[AND ware  = {{ware}}]]
), rang AS (
  SELECT ware, marke, sum(ausgaben) AS ausgaben_ware,
         row_number() OVER (ORDER BY sum(ausgaben) DESC) AS rang
    FROM basis GROUP BY ware, marke
)
SELECT b.monat            AS "Monat",
       b.ware             AS "Ware",
       b.preis_je_gebinde AS "Preis je Gebinde"
  FROM basis b JOIN rang r USING (ware, marke)
 WHERE r.rang <= 8
 ORDER BY b.monat`,
    visualisierung: {
      'graph.dimensions': ['Monat', 'Ware'],
      'graph.metrics': ['Preis je Gebinde'],
      'graph.x_axis.title_text': 'Monat',
      'graph.y_axis.title_text': 'Preis je Gebinde (€)',
    },
  },
  {
    schluessel: 'wa_preis_veraenderung',
    name: 'Was ist teurer geworden?',
    beschreibung:
      'Veränderung des Gebindepreises gegenüber dem VORMONAT, absteigend nach Größe des Sprungs. Waren, deren letzter Einkauf länger als einen Monat her ist, erscheinen hier nicht: ein Halbjahressprung als Monatsveränderung auszuweisen wäre eine erfundene Zahl. Seit Migration 0062 sind Gebindewechsel heraus: dieselbe Ware wird im selben Monat mit verschiedenen Gebindegrößen gebucht (Grana Padano 8,82 € bei Größe 1, 17,64 € bei Größe 2), und der Median kippte zwischen beiden — das ergab exakt +100 %. So kamen 41 von 200 Zeilen zustande, und weil nach Sprunggröße sortiert wird, standen sie alle ganz oben.',
    anzeige: 'table',
    parameter: [MARKE],
    sql: `
SELECT ware              AS "Ware",
       marke             AS "Marke",
       monat             AS "Monat",
       vormonat_preis    AS "Gebindepreis Vormonat",
       preis             AS "Gebindepreis",
       veraenderung_pct  AS "Veränderung %",
       bestellungen      AS "Bestellungen"
  FROM mart.einkaufspreis_veraenderung
 WHERE veraenderung_pct IS NOT NULL
   -- Ohne diesen Filter fuehrten +3,2-Millionen-%-Zeilen die Liste an:
   -- Einheitenwechsel und Buchungsfehler, keine Teuerung. "verdaechtig"
   -- kennzeichnet Spruenge ueber +/-100 % und die ungeklaerte Einheit
   -- baseUnit (Migration 0039); solche Zeilen gehoeren in die
   -- Einkaufspruefung, nicht in eine Preisliste.
   AND NOT verdaechtig
   AND bestellungen >= 2
   [[AND marke = {{marke}}]]
 ORDER BY abs(veraenderung_pct) DESC, ausgaben DESC
 LIMIT 200`,
  },
  {
    schluessel: 'wa_einkauf_pruefung',
    name: 'Auffällige Einkaufspositionen',
    beschreibung:
      'Positionen, die in der Preisliste fehlen oder dort auffallen — mit dem üblichen Preis derselben Ware zum Vergleich. Meist echte Falschbuchungen im Quellsystem (1.002.250 € für eine Packung Falthandtücher ist keine Preiserhöhung). Diese Liste existiert, damit die Lücke sichtbar ist, statt still zu sein.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT bestelldatum       AS "Bestelldatum",
       marke              AS "Marke",
       coalesce(betrieb, '— nicht zugeordnet —') AS "Betrieb",
       ware               AS "Ware",
       menge              AS "Menge",
       summe_preis        AS "Summe",
       preis_je_gebinde   AS "Preis je Gebinde",
       ueblich            AS "üblich",
       grund              AS "Grund",
       bestellnummer      AS "Bestellung"
  FROM mart.einkauf_pruefung
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
   [[AND marke = {{marke}}]]
 ORDER BY bestelldatum DESC NULLS LAST
 LIMIT 300`,
  },
  {
    schluessel: 'wa_einkauf_betrieb',
    name: 'Einkaufsvolumen je Betrieb',
    beschreibung:
      'Was jeder Betrieb je Monat eingekauft hat, getrennt nach Bar und Küche. Es erscheinen nur Betriebe, deren FoodNotify-Kostenstelle einem LINA-Betrieb zugeordnet ist — eine Summe ohne Betrieb ließe sich mit nichts vergleichen. „Einkauf netto" ist OHNE stornierte Bestellungen; was storniert wurde, steht in der letzten Spalte daneben statt still zu verschwinden.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    // Bis zum 04.08.2026 zaehlten hier 1.561 Stornos ueber 2,49 Mio EUR
    // mit: der Importer schrieb den Status als `[object Object]`, also
    // konnte keine Sicht ihn erkennen (Migration 0043).
    sql: `
SELECT betrieb                AS "Betrieb",
       marke                  AS "Marke",
       bereich                AS "Bereich",
       monat                  AS "Monat",
       bestellungen           AS "Bestellungen",
       positionen             AS "Positionen",
       einkauf_netto          AS "Einkauf netto",
       lieferanten            AS "Lieferanten",
       nullif(storniert_netto, 0) AS "davon storniert (nicht enthalten)"
  FROM mart.einkauf_betrieb_monat
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
   [[AND marke = {{marke}}]]
 ORDER BY monat DESC, einkauf_netto DESC
 LIMIT 500`,
  },

  {
    // Das Dashboard hiess von Anfang an "Einkauf — Preise, Lieferanten,
    // Volumen", zeigte aber keinen einzigen Lieferanten. Je MARKE, nicht
    // je Konzern: FoodNotify fuehrt denselben Lieferanten je Mandant als
    // eigenen Datensatz (4x Distra), eine naive Konzernsumme zaehlte ihn
    // vierfach getrennt und keinmal ganz.
    schluessel: 'wa_lieferant_volumen',
    name: 'Lieferanten nach Einkaufsvolumen',
    beschreibung:
      'Einkaufsvolumen je Lieferant in den letzten zwölf Monaten. Ohne Markenfilter stehen gleichnamige Lieferanten mehrfach da — je Marke ein Vertrag, das ist FoodNotifys Sicht und die des Einkäufers. Für Marken mit offenen Bestellseiten (siehe Ladestand) ist das Volumen unvollständig.',
    anzeige: 'row',
    parameter: [MARKE, BETRIEB],
    sql: `
SELECT lieferant || ' — ' || marke  AS "Lieferant",
       round(sum(summe_preis))      AS "Einkauf (12 Monate)"
  FROM mart.einkauf_position
 WHERE lieferant IS NOT NULL
   -- Stornos raus: mart.einkauf_position ist die Beweissicht und traegt sie
   -- absichtlich mit (Migration 0043). Wer summiert, filtert selbst.
   AND NOT storniert
   AND monat >= (date_trunc('month', current_date) - interval '12 months')::date
   [[AND marke = {{marke}}]]
   [[AND betrieb = {{betrieb}}]]
 GROUP BY lieferant, marke
 ORDER BY sum(summe_preis) DESC
 LIMIT 25`,
    visualisierung: {
      'graph.dimensions': ['Lieferant'],
      'graph.metrics': ['Einkauf (12 Monate)'],
      'graph.x_axis.title_text': 'Einkauf netto (€), letzte 12 Monate',
    },
  },
  {
    // Beschaffungsrisiko je Betrieb: haengt ein Haus an EINEM Lieferanten,
    // ist jede Preisverhandlung und jeder Lieferausfall ein Betriebsrisiko.
    schluessel: 'wa_lieferant_konzentration',
    name: 'Lieferantenkonzentration je Betrieb',
    beschreibung:
      'Je Betrieb: Einkaufsvolumen der letzten zwölf Monate, Zahl der Lieferanten und der Anteil des größten. Ein Anteil über 60 % heißt: dieses Haus hat faktisch einen Monopol-Lieferanten. Nur Betriebe mit zugeordneter FoodNotify-Kostenstelle; unfertig geladene Marken sind untertrieben.',
    anzeige: 'table',
    parameter: [MARKE, BETRIEB],
    sql: `
WITH je AS (
    SELECT betrieb, lieferant, sum(summe_preis) AS einkauf
      FROM mart.einkauf_position
     WHERE lieferant IS NOT NULL AND betrieb IS NOT NULL
       AND NOT storniert
       AND monat >= (date_trunc('month', current_date) - interval '12 months')::date
       [[AND marke = {{marke}}]]
       [[AND betrieb = {{betrieb}}]]
     GROUP BY betrieb, lieferant
), top1 AS (
    SELECT DISTINCT ON (betrieb) betrieb, lieferant, einkauf
      FROM je
     ORDER BY betrieb, einkauf DESC
)
SELECT je.betrieb                                       AS "Betrieb",
       round(sum(je.einkauf))                           AS "Einkauf (12 M.)",
       count(*)                                         AS "Lieferanten",
       max(t.lieferant)                                 AS "größter Lieferant",
       round(100 * max(t.einkauf) / nullif(sum(je.einkauf), 0), 1) AS "Anteil größter %"
  FROM je
  JOIN top1 t ON t.betrieb = je.betrieb
 GROUP BY je.betrieb
 ORDER BY round(100 * max(t.einkauf) / nullif(sum(je.einkauf), 0), 1) DESC NULLS LAST`,
  },
  {
    // NUR BEI WILMA WUNDER BELASTBAR: siehe migrations/0044_inventur.sql
    // und 0045_mart_inventur_und_beleg.sql. Die anderen drei Marken haben
    // zu wenige (Aposto, davon storniert bei Deutsche Konzepte fast alle),
    // um daraus eine Schwundaussage abzuleiten -- die Karte zeigt sie
    // trotzdem, mit demselben Vorbehalt wie in der Beschreibung.
    schluessel: 'wa_inventur_schwund',
    name: 'Bewerteter Schwund aus Inventuren',
    beschreibung:
      'Sollbestand gegen tatsächlich gezählten Bestand, in Euro bewertet. '
      + 'ZUERST AUF „SOLL JE GEZÄHLT" SEHEN: liegt der Wert weit über 1, ist der Prozentwert '
      + 'daneben wertlos. Der theoretische Bestand aus FoodNotify ist bei vielen Häusern '
      + 'aufgebläht — gemessen 971.750 g Pizzateig gegen 138.000 g gezählt —, weil der '
      + 'Verbrauch nicht dagegen gebucht wird. Das ist kein Schwund, sondern fehlende '
      + 'Rezepturpflege, und diese Sicht kann es nicht heilen. '
      + 'Testinventuren sind seit Migration 0062 draussen (61 von 358), und gerechnet wird '
      + 'nur über Positionen, die tatsächlich gezählt wurden — wer nur die Bar zählt, dem '
      + 'fehlt die Küche, und die zählte vorher als Schwund. Was so herausfiel, steht rechts '
      + 'daneben statt zu verschwinden. Stornierte und nicht signierte Zählungen zählen nicht '
      + 'mit. NUR BEI WILMA WUNDER überhaupt genug Fälle für eine Aussage.',
    anzeige: 'table',
    parameter: [MARKE, BETRIEB],
    sql: `
SELECT betrieb                    AS "Betrieb",
       marke                      AS "Marke",
       sum(inventuren)            AS "Inventuren",
       sum(inventuren_signiert)   AS "davon signiert",
       round(sum(soll_eur), 2)     AS "Soll (bewertet)",
       round(sum(gezaehlt_eur), 2) AS "Gezählt (bewertet)",
       round(sum(schwund_eur), 2)  AS "Schwund €",
       CASE WHEN sum(soll_eur) > 0
            THEN round(100 * sum(schwund_eur) / sum(soll_eur), 2)
       END                        AS "Schwund %",
       -- Pruefgroesse: theoretischer Bestand geteilt durch gezaehlten.
       -- Steht ABSICHTLICH neben dem Prozentwert und nicht in einer
       -- Fussnote: liegt sie weit über 1, ist die Zahl links davon wertlos,
       -- und das muss man im selben Blick sehen.
       CASE WHEN sum(gezaehlt_eur) > 0
            THEN round(sum(soll_eur) / sum(gezaehlt_eur), 2)
       END                        AS "Soll je Gezählt",
       nullif(sum(positionen_ohne_zaehlung), 0) AS "Positionen ohne Zählung",
       nullif(round(sum(soll_eur_ohne_zaehlung), 2), 0) AS "Soll ohne Zählung (raus)",
       nullif(sum(inventuren_teilbereich), 0)   AS "davon Teilbereich",
       nullif(sum(inventuren_test), 0)          AS "Tests (nicht gezählt)"
  FROM mart.inventur_schwund
 WHERE 1 = 1
   [[AND marke = {{marke}}]]
   [[AND betrieb = {{betrieb}}]]
 GROUP BY betrieb, marke
HAVING sum(inventuren_signiert) > 0
 ORDER BY sum(schwund_eur) DESC NULLS LAST`,
  },

  // ===================================================================
  // BWA
  // ===================================================================
  {
    schluessel: 'bwa_kennzahlen',
    name: 'BWA-Kennzahlen je Monat',
    beschreibung:
      'Umsatz, Wareneinsatz, Personalkosten und Ergebnis aus den Zahlen des Steuerberaters. Es werden nur gebuchte Monate gezeigt — und ohne Betriebsfilter nur Monate, in denen die MEISTEN Betriebe schon gebucht haben: im jüngsten Monat buchen erst die Schnellbucher, und deren Teilsumme läse sich als Umsatzeinbruch von −43 %.',
    anzeige: 'line',
    parameter: [BETRIEB, ZEITRAUM],
    sql: `
-- OHNE Tabellenalias: Metabase baut die Klausel eines Feldfilters aus
-- dem TABELLENNAMEN ("bwa_kennzahl.monat BETWEEN ..."). Mit einem Alias
-- ist der Name an dieser Stelle nicht mehr gueltig, und Postgres
-- antwortet mit "invalid reference to FROM-clause entry".
--
-- Der zweite WITH-Schritt schneidet Monate ab, in denen erst ein Bruchteil
-- der Betriebe gebucht hat: Juni 2026 stand mit 37 von 61 Buchern als
-- -43-%-Absturz in der Kurve. Mit Betriebsfilter greift der Schnitt nie
-- (1 von 1 ist immer 100 %).
WITH je_monat AS (
    SELECT monat,
           round(sum(wert_absolut) FILTER (WHERE kennzahl = 'Umsatz'))                 AS umsatz,
           round(sum(wert_absolut) FILTER (WHERE kennzahl IN ('WE Bar','WE Küche')))   AS wareneinsatz,
           round(sum(wert_absolut) FILTER (WHERE kennzahl = 'Personalkosten ohne GF')) AS personalkosten,
           round(sum(wert_absolut) FILTER (WHERE kennzahl = 'EBIT'))                   AS ebit,
           count(DISTINCT betrieb_key) FILTER (WHERE gebucht)                          AS betriebe
      FROM mart.bwa_kennzahl
     WHERE 1 = 1
       [[AND betrieb = {{betrieb}}]]
       [[AND {{zeitraum}}]]
     GROUP BY monat
    HAVING count(*) FILTER (WHERE wert_absolut IS NOT NULL AND wert_absolut <> 0) > 0
)
SELECT monat          AS "Monat",
       umsatz         AS "Umsatz",
       wareneinsatz   AS "Wareneinsatz",
       personalkosten AS "Personalkosten",
       ebit           AS "EBIT",
       betriebe       AS "Betriebe gebucht"
  FROM (SELECT je_monat.*, lag(betriebe) OVER (ORDER BY monat) AS betriebe_vormonat FROM je_monat) x
 WHERE betriebe_vormonat IS NULL OR betriebe >= 0.6 * betriebe_vormonat
 ORDER BY monat`,
    template_tag_dimension: { zeitraum: ['mart', 'bwa_kennzahl', 'monat'] },
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Umsatz', 'Wareneinsatz', 'Personalkosten', 'EBIT'],
    },
  },
  {
    // Der Weg vom Umsatz zum Ergebnis als Wasserfall — die BWA-Frage
    // schlechthin, bisher nur als vier getrennte Linien lesbar. Der
    // Restposten "Uebrige Kosten" ist gerechnet (EBIT minus der drei
    // benannten Bloecke), damit der Wasserfall exakt beim EBIT landet.
    schluessel: 'bwa_wasserfall',
    name: 'Vom Umsatz zum EBIT',
    beschreibung:
      'Umsatz minus Wareneinsatz, Personal und übrige Kosten — der Wasserfall endet beim EBIT des gewählten Monats. „Übrige Kosten" ist der Rest zwischen den benannten Blöcken und dem Ergebnis (Miete, Energie, GF-Gehälter, Abschreibungen). Ohne Betriebsfilter über alle Betriebe, deren Monat gebucht ist.',
    anzeige: 'waterfall',
    parameter: [MONAT, BETRIEB],
    sql: `${MONAT_CTE_BWA}
, w AS (
    SELECT sum(k.wert_absolut) FILTER (WHERE k.kennzahl = 'Umsatz')                 AS umsatz,
           sum(k.wert_absolut) FILTER (WHERE k.kennzahl = 'WE Bar')                 AS we_bar,
           sum(k.wert_absolut) FILTER (WHERE k.kennzahl = 'WE Küche')               AS we_kueche,
           sum(k.wert_absolut) FILTER (WHERE k.kennzahl = 'Personalkosten ohne GF') AS personal,
           sum(k.wert_absolut) FILTER (WHERE k.kennzahl = 'EBIT')                   AS ebit
      FROM mart.bwa_kennzahl k
     CROSS JOIN gewaehlt g
     WHERE k.monat = g.monat
       AND k.gebucht
       [[AND k.betrieb = {{betrieb}}]]
)
SELECT p."Posten", p."Betrag"
  FROM w,
       LATERAL (VALUES
         (1, 'Umsatz',             round(w.umsatz)),
         (2, 'WE Bar',             round(-coalesce(w.we_bar, 0))),
         (3, 'WE Küche',           round(-coalesce(w.we_kueche, 0))),
         (4, 'Personal o. GF',     round(-coalesce(w.personal, 0))),
         (5, 'Übrige Kosten',      round(coalesce(w.ebit, 0) - (coalesce(w.umsatz, 0)
                                        - coalesce(w.we_bar, 0) - coalesce(w.we_kueche, 0)
                                        - coalesce(w.personal, 0))))
       ) p(ord, "Posten", "Betrag")
 WHERE w.umsatz IS NOT NULL
 ORDER BY p.ord`,
    visualisierung: {
      'graph.dimensions': ['Posten'],
      'graph.metrics': ['Betrag'],
      'waterfall.show_total': true,
      'waterfall.total_label': 'EBIT',
    },
  },
  {
    schluessel: 'bwa_ebit',
    name: 'EBIT je Betrieb',
    beschreibung:
      'Die Rendite je Betrieb aus den Zahlen des Steuerberaters. Ohne Betriebsfilter erscheinen nur die Betriebe, deren gewählter Monat schon gebucht ist — am Monatsanfang sind das erst die Schnellbucher, die Liste ist dann kürzer als die Flotte.',
    anzeige: 'row',
    parameter: [MONAT, BETRIEB],
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
   [[AND k.betrieb = {{betrieb}}]]
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
      'Bis wann ist je Betrieb gebucht? Die Zahlen kommen vom Steuerberater und liegen üblicherweise ein bis zwei Monate zurück; vier Monate Verzug sind eine Nachfrage wert. Betriebe, die dem Steuerberater nicht zugeordnet sind, erscheinen hier gar nicht.',
    anzeige: 'table',
    parameter: [BETRIEB],
    // Nur Betriebe, die es noch zu buchen GIBT: 36 Zeilen "keine BWA
    // gebucht" — Testlaeden, Verwaltungs-GmbHs, Geschlossene — standen
    // ganz oben und begruben darunter die eigentliche Arbeitsliste.
    // NULLS LAST statt FIRST: wer nie gebucht hat, ist ein eigenes Thema
    // und steht am Ende, nicht vor dem groessten echten Verzug.
    sql: `
SELECT d.betrieb            AS "Betrieb",
       d.bwa_monat          AS "Gebucht bis",
       d.bwa_verzug_monate  AS "Verzug (Monate)",
       d.bwa_bruecke        AS "BWA-Brücke da?",
       d.letzter_tag        AS "Umsatz bis",
       d.befund             AS "Befund"
  FROM mart.datenstand d
  JOIN mart.betrieb_status s ON s.betrieb_key = d.betrieb_key
 WHERE s.status NOT IN ('test', 'verwaltend', 'geschlossen')
   [[AND d.betrieb = {{betrieb}}]]
 ORDER BY d.bwa_verzug_monate DESC NULLS LAST, d.betrieb`,
  },

  // ===================================================================
  // Datenqualitaet und Import
  // ===================================================================
  {
    schluessel: 'dq_pruefung',
    name: 'Nachgerechnete Zahlen',
    beschreibung:
      'Die Summen aus LINA gegen unsere eigene Nachrechnung. Die Spalte „auffällig" ist eine Arbeitsliste, kein Alarm — sie sagt, wo ein zweiter Blick lohnt.',
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
    name: 'Datenabruf je Berichtsart',
    beschreibung: 'Wie weit ist der Datenabruf je Berichtsart? Die Seite für den Blick am Morgen.',
    anzeige: 'table',
    sql: `
SELECT endpunkt          AS "Endpunkt",
       prozent           AS "Fertig %",
       erledigt          AS "Erledigt",
       offen             AS "Offen",
       geladen           AS "Geladen",
       keine_daten       AS "Keine Daten",
       aufgegeben        AS "Aufgegeben",
       -- "Ältester geladen" und Geschwister kosteten je 134 Pixel fuer
       -- ein Datum von zehn Zeichen. Was geladen und was offen ist, sagt
       -- die Gruppierung; die Ueberschrift muss es nicht wiederholen.
       aeltester_geladen AS "Geladen ab",
       juengster_geladen AS "Geladen bis",
       aeltester_offener AS "Offen ab"
  FROM mart.backfill_fortschritt
 ORDER BY prozent, endpunkt`,
  },
  {
    schluessel: 'dq_backfill_balken',
    name: 'Fortschritt des Datenabrufs',
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
    name: 'Letzte Datenabrufe',
    beschreibung:
      'Die letzten Datenabrufe, der jüngste zuerst. Erste Anlaufstelle, wenn irgendwo '
      + 'Zahlen fehlen.\n\n'
      + '„Schema“ zählt offene Schema-Abweichungen des Laufs, „Pausiert“ die '
      + 'pausierten Kombinationen aus Endpunkt und Betrieb.',
    anzeige: 'table',
    sql: `
-- Zeitstempel auf Sekunden gekuerzt: die Mikrosekunden und die
-- Zeitzone machten aus jeder der beiden Zeitspalten 29 Zeichen und
-- damit 238 Pixel. Zusammen war das ein Drittel der Tabellenbreite fuer
-- eine Genauigkeit, die bei einem Importlauf niemand braucht.
SELECT lauf_id                                     AS "Lauf",
       to_char(gestartet_am, 'DD.MM. HH24:MI:SS')  AS "Gestartet",
       to_char(beendet_am,   'DD.MM. HH24:MI:SS')  AS "Beendet",
       status                                      AS "Status",
       ausloeser                                   AS "Auslöser",
       aufgaben_gesamt                             AS "Aufgaben",
       aufgaben_ok                                 AS "OK",
       aufgaben_fehler                             AS "Fehler",
       aufgaben_uebersprungen                      AS "Übersprungen",
       dauer_s                                     AS "Dauer (s)",
       offene_abweichungen                         AS "Schema",
       pausierte_kombinationen                     AS "Pausiert"
  FROM mart.sync_status
 LIMIT 25`,
  },
  {
    schluessel: 'dq_datenstand',
    name: 'Datenstand je Betrieb',
    beschreibung:
      'Für welche Betriebe liegen überhaupt genug Daten für ein Urteil vor? Ohne diese '
      + 'Liste sieht ein Betrieb, dessen Daten fehlen, genauso aus wie einer, bei dem '
      + 'alles in Ordnung ist.\n\n'
      + '„Tage“ ist die Zahl der Tage mit Umsatz, „Alter“ der Abstand des letzten '
      + 'Umsatztages zu heute in Tagen, „Verzug“ der Rückstand der BWA in Monaten.',
    anzeige: 'table',
    sql: `
-- Kurze Ueberschriften: bei dieser Tabelle macht die UEBERSCHRIFT die
-- Spalte breit, nicht der Wert. "Umsatz Alter (Tage)" belegte 158 Pixel
-- fuer eine einstellige Zahl. Was die Kuerzel bedeuten, steht in der
-- Beschreibung der Karte.
SELECT betrieb             AS "Betrieb",
       befund              AS "Befund",
       erster_tag          AS "Umsatz ab",
       letzter_tag         AS "Umsatz bis",
       umsatztage          AS "Tage",
       umsatz_alter_tage   AS "Alter",
       bwa_monat           AS "BWA bis",
       bwa_verzug_monate   AS "Verzug",
       artikeltage         AS "Artikeltage",
       letzter_personaltag AS "Personal bis"
       -- Ohne Markenspalte: sie belegte 192 Pixel und stand fast immer
       -- schon im Betriebsnamen ("Aposto Augsburg"). Zusammen mit der
       -- Betriebsspalte war das die Haelfte der Tabelle fuer eine
       -- Angabe, die hier niemand sucht -- die Frage dieser Karte ist
       -- "reichen die Daten fuer ein Urteil", nicht "welche Marke".
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
    name: 'Datenlage je Betrieb',
    beschreibung: 'Wie die Betriebe sich auf die Befunde verteilen. „vollständig" ist das Ziel.',
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
    name: 'Betriebe ohne Zuordnung zum Steuerberater',
    beschreibung:
      'Diese Liste sollte leer sein. Jede Zeile ist ein Betrieb, der in keiner Kennzahlenauswertung auftaucht, weil er den Zahlen des Steuerberaters nicht zugeordnet werden kann — stillschweigend, ohne Fehlermeldung.',
    anzeige: 'table',
    sql: `
SELECT betrieb            AS "Betrieb",
       stadt              AS "Stadt",
       aktiv              AS "Aktiv",
       hat_bwa            AS "Hat BWA",
       -- Als Datum, nicht als Zeitstempel: '2026-07-26 00:00:00.000000
       -- +00:00' ist 62 Zeichen breit und sagt keine Sekunde mehr aus
       -- als '2026-07-26'. Vier solcher Spalten schieben eine Tabelle
       -- ueber den Rand, und dann scrollt man an den Zahlen vorbei.
       zuletzt_am::date   AS "Zuletzt gesehen"
  FROM mart.betrieb_ohne_lina_id`,
  },
  {
    schluessel: 'dq_konzept',
    name: 'Markenzuordnung',
    beschreibung:
      'Woher die Marke je Betrieb stammt. Zeilen mit „mehrdeutig — Entscheidung fehlt" sind zu klären: solange das offen ist, laufen diese Betriebe in allen Markenauswertungen unter „(nicht zugeordnet)".',
    anzeige: 'table',
    sql: `
-- Die Namen standen bis zum 28.07.2026 vollstaendig in einer Spalte:
-- string_agg ueber alle Betriebe einer Herkunft, bei "aus LINA
-- eindeutig" waren das 131 Namen und 3693 Zeichen in EINER Zelle. Keine
-- Kachelbreite macht das lesbar -- man sah den Anfang und scrollte ins
-- Nichts. Und die 131 eindeutigen sind ohnehin nicht die Frage.
--
-- Interessant ist die Gegenrichtung: WER ist offen? Deshalb je Herkunft
-- nur noch die Zahl, dazu bis zu fuenf Namen als Stichprobe.
SELECT herkunft AS "Herkunft",
       count(*) AS "Betriebe",
       left(string_agg(betrieb, ', ' ORDER BY betrieb), 120)
         || CASE WHEN count(*) > 5 THEN ' …' ELSE '' END AS "Beispiele"
  FROM mart.konzept_zuordnung
 GROUP BY herkunft
 ORDER BY count(*) DESC`,
  },
  {
    schluessel: 'dq_umsatz_abweichung',
    name: 'Artikelsumme gegen gemeldeten Umsatz',
    beschreibung:
      'Der Tagesumsatz, aus den einzelnen Artikelverkäufen neu zusammengezählt und gegen den gemeldeten Umsatz gehalten. Abweichungen bis 0,5 % sind Rundung und unbedenklich; darüber lohnt ein Blick. Erwartung: keine auffälligen Zeilen.',
    anzeige: 'table',
    sql: `
SELECT betrieb             AS "Betrieb",
       geschaeftstag::date AS "Geschäftstag",
       lina_netto          AS "LINA netto",
       artikel_netto AS "aus Artikeln",
       differenz     AS "Differenz",
       differenz_pct AS "Differenz %"
  FROM mart.pruefung_umsatz
 WHERE auffaellig
 ORDER BY abs(differenz_pct) DESC
 LIMIT 200`,
  },
]
