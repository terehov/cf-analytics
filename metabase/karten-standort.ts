// =====================================================================
// Karten fuer die Standortkarte.
//
// DIE FALLE, DIE ALLES ANDERE UEBERSCHATTET: mart.standort hat eine Zeile
// je Betrieb UND MONAT. Am 27.07.2026 sind das 4.635 Zeilen fuer 45
// Standorte, ueber 103 Monate. Ohne Monatsfilter landet jeder Standort
// hundertfach auf derselben Koordinate -- die Karte sieht dann richtig
// aus, weil die Punkte uebereinanderliegen, und jede Summe daneben ist es
// nicht. Deshalb traegt JEDE Karte hier den Monatsfilter.
//
// ZWEITE FALLE: nicht jeder Standort hat eine Ampel. Am 27.07.2026 sind
// 3 von 45 ohne Bewertung, weil die BWA fehlt. Die bleiben sichtbar, mit
// weissem Punkt -- eine fehlende Bewertung ist eine Aussage, kein Grund
// zum Ausblenden. Wer sie herausfiltert, sieht 42 bewertete Standorte und
// haelt das fuer alle.
//
// DRITTE EINSCHRAENKUNG, die in die Beschreibung gehoert: nur 45 der 141
// gefuehrten Betriebe haben ueberhaupt Koordinaten. Welche fehlen, steht
// in mart.standort_fehlend (96 Stueck).
// =====================================================================

import type { Karte } from './typen'
import { MONAT_CTE, P_MONAT, P_MARKE } from './gemeinsam'

const MONAT = P_MONAT
const MARKE = P_MARKE

/**
 * Die Ampel als lesbarer Text.
 *
 * Bewusst mit Emoji davor: Metabases Punktkarte faerbt nach einer ZAHL,
 * nicht nach einer Kategorie -- alle Punkte sind gleich gross und gleich
 * gefaerbt (im Browser nachgemessen: 45 Marker, eine Farbe). Das Emoji ist
 * damit der einzige Weg, die Bewertung am Punkt selbst zu zeigen.
 */
const AMPEL_TEXT = `
       CASE s.ampel
         WHEN 'rot'    THEN '🔴 Sofort handeln'
         WHEN 'orange' THEN '🟠 Im Auge behalten'
         WHEN 'gruen'  THEN '🟢 Passt'
         ELSE               '⚪ Keine Bewertung'
       END`

export const karten: Karte[] = [
  {
    schluessel: 'so_karte',
    name: 'Standorte auf der Karte',
    beschreibung:
      'Ein Punkt je Standort. Ein Klick auf einen Punkt öffnet die Detailseite des Betriebs.\n\n'
      + '**Die Ampel steht im Namen des Punkts** (🔴 🟠 🟢 ⚪), nicht in seiner Farbe — '
      + 'Metabase färbt Kartenpunkte nur nach Zahlen, nicht nach Kategorien. Antippen zeigt '
      + 'Bewertung, Umsatz und Handlungsbedarf; die Tabelle darunter listet dieselben '
      + 'Standorte nach Handlungsdruck sortiert.\n\n'
      + '⚪ sind Betriebe ohne Bewertung — meist fehlen die Zahlen vom Steuerberater. Sie '
      + 'stehen bewusst mit auf der Karte: eine fehlende Bewertung ist eine Aussage, kein '
      + 'Grund zum Ausblenden.\n\n'
      + 'Achtung: Zu sehen sind nur Standorte mit hinterlegten Koordinaten. Welche fehlen, '
      + 'zeigt „Standorte ohne Koordinaten" ganz unten.',
    anzeige: 'map',
    parameter: [MONAT, MARKE],
    // WARUM DIE AMPEL IM TEXT STEHT UND NICHT IN DER PUNKTFARBE:
    // Metabases Punktkarte faerbt nach einer ZAHL, nicht nach einer
    // Kategorie -- `map.pin_type: markers` zeichnet alle Punkte gleich.
    // Im Browser nachgemessen: 45 Marker, eine einzige Farbe.
    //
    // Statt die Ampel stillschweigend zu verlieren, steht sie als Emoji
    // VORNE in jeder Spalte, die im Tooltip auftaucht. Damit ist sie beim
    // Antippen sofort sichtbar -- und in der Tabelle darunter, die
    // dieselben Standorte nach Handlungsdruck sortiert, ohnehin.
    sql: `${MONAT_CTE}
SELECT coalesce(s.ampel_emoji, '⚪') || ' ' || s.betrieb AS "Standort",
       s.konzept                        AS "Marke",
       s.breitengrad::float             AS "Breitengrad",
       s.laengengrad::float             AS "Längengrad",${AMPEL_TEXT} AS "Bewertung",
       round(s.umsatz)                  AS "Umsatz",
       s.intensitaet                    AS "Handlungsbedarf",
       s.ort                            AS "Ort",
       s.betrieb                        AS "Betrieb"
  FROM mart.standort s
  CROSS JOIN gewaehlt g
 WHERE s.monat = g.monat
   AND s.breitengrad IS NOT NULL
   [[AND s.konzept = {{marke}}]]
 ORDER BY CASE s.ampel WHEN 'rot' THEN 1 WHEN 'orange' THEN 2
                       WHEN 'gruen' THEN 3 ELSE 4 END,
          s.betrieb`,
    visualisierung: {
      'map.type': 'pin',
      'map.latitude_column': 'Breitengrad',
      'map.longitude_column': 'Längengrad',
      'map.pin_type': 'markers',
      // Was im Tooltip steht, wenn man einen Punkt antippt.
      'map.metric_column': 'Umsatz',
      // Titel der Sprechblase: enthaelt bereits das Ampel-Emoji.
      'map.tooltip_column': 'Standort',
      column_settings: {
        '["name","Umsatz"]': {
          number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0,
        },
      },
    },
  },

  {
    schluessel: 'so_tabelle',
    name: 'Standorte im Überblick',
    beschreibung:
      'Dieselben Standorte als Liste, sortiert nach Handlungsdruck. Ein Klick auf den '
      + 'Betriebsnamen öffnet die Detailseite.',
    anzeige: 'table',
    parameter: [MONAT, MARKE],
    sql: `${MONAT_CTE}
SELECT coalesce(s.ampel_emoji, '⚪')     AS "●",
       s.betrieb                        AS "Betrieb",
       s.konzept                        AS "Marke",
       s.ort                            AS "Ort",
       s.plz                            AS "PLZ",
       s.strasse                        AS "Straße",
       round(s.umsatz)                  AS "Umsatz",
       s.personalkosten_ogf_pct         AS "Personal %",
       s.we_bar_pct                     AS "WE Bar %",
       s.we_kueche_pct                  AS "WE Küche %",
       s.intensitaet                    AS "Handlungsbedarf",
       s.prioritaet                     AS "Priorität",
       s.genauigkeit                    AS "Genauigkeit"
  FROM mart.standort s
  CROSS JOIN gewaehlt g
 WHERE s.monat = g.monat
   AND s.breitengrad IS NOT NULL
   [[AND s.konzept = {{marke}}]]
 ORDER BY CASE s.ampel WHEN 'rot' THEN 1 WHEN 'orange' THEN 2
                       WHEN 'gruen' THEN 3 ELSE 4 END,
          s.umsatz DESC NULLS LAST`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': {
          number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0,
        },
        '["name","Personal %"]': { suffix: ' %' },
        '["name","WE Bar %"]': { suffix: ' %' },
        '["name","WE Küche %"]': { suffix: ' %' },
      },
    },
  },

  {
    schluessel: 'so_verteilung',
    name: 'Standorte je Marke',
    beschreibung:
      'Wie sich die Standorte mit Koordinaten auf die Marken verteilen, aufgeteilt nach '
      + 'Bewertung. Zeigt auf einen Blick, welche Marke wie viele Häuser im roten Bereich hat.',
    anzeige: 'bar',
    parameter: [MONAT, MARKE],
    sql: `${MONAT_CTE}
SELECT coalesce(s.konzept, '(nicht zugeordnet)') AS "Marke",
       count(*) FILTER (WHERE s.ampel = 'rot')    AS "Sofort handeln",
       count(*) FILTER (WHERE s.ampel = 'orange') AS "Im Auge behalten",
       count(*) FILTER (WHERE s.ampel = 'gruen')  AS "Passt",
       count(*) FILTER (WHERE s.ampel IS NULL)    AS "Keine Bewertung"
  FROM mart.standort s
  CROSS JOIN gewaehlt g
 WHERE s.monat = g.monat
   AND s.breitengrad IS NOT NULL
   [[AND s.konzept = {{marke}}]]
 GROUP BY coalesce(s.konzept, '(nicht zugeordnet)')
 ORDER BY count(*) DESC`,
    visualisierung: {
      'graph.dimensions': ['Marke'],
      'graph.metrics': ['Sofort handeln', 'Im Auge behalten', 'Passt', 'Keine Bewertung'],
      'stackable.stack_type': 'stack',
      'graph.y_axis.title_text': 'Standorte',
      'graph.x_axis.title_text': '',
    },
  },

  {
    schluessel: 'so_fehlend',
    name: 'Standorte ohne Koordinaten',
    beschreibung:
      'Betriebe, die auf der Karte fehlen, weil keine Adresse hinterlegt ist. '
      + 'Am 27.07.2026 sind das 96 von 141 — die Karte zeigt also einen Ausschnitt, '
      + 'nicht das Ganze. Diese Liste ist die Arbeitsvorlage, um die Adressen nachzutragen.',
    anzeige: 'table',
    sql: `
SELECT betrieb                                       AS "Betrieb",
       konzept                                       AS "Marke",
       CASE WHEN aktiv THEN 'ja' ELSE 'nein' END     AS "Als aktiv geführt",
       CASE WHEN macht_umsatz THEN 'ja' ELSE 'nein' END AS "Macht Umsatz",
       round(umsatz_gesamt)                          AS "Umsatz gesamt"
  FROM mart.standort_fehlend
 ORDER BY macht_umsatz DESC, umsatz_gesamt DESC NULLS LAST, betrieb`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz gesamt"]': {
          number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0,
        },
      },
    },
  },
]
