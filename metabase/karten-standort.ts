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
import { MONAT_CTE, P_MONAT, P_MARKE, P_BETRIEB, P_AMPEL, P_INTENSITAET } from './gemeinsam'

const MONAT = P_MONAT
const MARKE = P_MARKE
const BETRIEB = P_BETRIEB
const AMPEL = P_AMPEL
const INTENSITAET = P_INTENSITAET

/**
 * Die Farbe des Punkts: INTENSITAET, nicht Gesamtampel.
 *
 * Warum nicht die Ampel: `gesamt` ist ein logisches ODER ueber sechs
 * Kennzahlen -- eine einzige rote genuegt. Im Juni 2026 sind damit 43 von
 * 48 Standorten rot, und eine Karte, auf der fast alles dieselbe Farbe
 * hat, traegt keine Information.
 *
 * `intensitaet` ZAEHLT stattdessen und trennt die 43 in 19 "Sofort
 * eskalieren" und 24 "Sofort handeln". Das ist der Unterschied, auf den es
 * ankommt.
 *
 * NICHT GEMITTELT, und zwar mit Absicht. Das abgeloeste Excel
 * (examples/JULI_Round_Table_Ampelsystem.xlsx, Blatt 00_Dashboard) hat
 * ebenfalls gezaehlt statt gemittelt. Zwei der sechs Kennzahlen --
 * Online-Bewertung und OM-Score -- haben bei uns ueberhaupt keine Daten
 * (nachgemessen Juni 2026: beide 0 rote). Ein Mittelwert waere
 * stillschweigend einer ueber vier statt sechs und wuerde sich
 * verschieben, sobald die Bewertungen dazukommen -- ohne dass sich an der
 * Lage etwas geaendert haette.
 *
 * Die Reihenfolge ist Handlungsdruck, damit die Legende oben mit dem
 * beginnt, was brennt.
 */
const INTENSITAET_TEXT = `
       CASE s.intensitaet
         WHEN 'Sofort eskalieren' THEN '1 — Sofort eskalieren'
         WHEN 'Sofort handeln'    THEN '2 — Sofort handeln'
         WHEN 'Nachforschung'     THEN '3 — Nachforschung'
         WHEN 'Beobachten/OK'     THEN '4 — Beobachten/OK'
         ELSE                          '5 — Keine Bewertung'
       END`

/** Das Emoji zur Intensitaet -- steht im Punktnamen, weil Metabases
 *  Punktkarte nach Zahlen faerbt und nicht nach Kategorien. */
const INTENSITAET_EMOJI = `
       CASE s.intensitaet
         WHEN 'Sofort eskalieren' THEN '🟥'
         WHEN 'Sofort handeln'    THEN '🔴'
         WHEN 'Nachforschung'     THEN '🟠'
         WHEN 'Beobachten/OK'     THEN '🟢'
         ELSE                          '⚪'
       END`

/**
 * Der Kartenausschnitt.
 *
 * Ohne diese drei Angaben waehlt Metabase den Ausschnitt selbst und trifft
 * daneben: nachgemessen am 27.07.2026 lagen 2 der 48 Marker ausserhalb des
 * sichtbaren Bereichs. Man sieht 46 Punkte, die Karte sieht vollstaendig
 * aus, und die beiden fehlenden faellt niemandem auf.
 *
 * Die Werte sind aus den Daten gerechnet, nicht geschaetzt -- Mitte der
 * Umschliessenden aller Standorte in manual.betrieb_standort:
 *   Breite  47,72 bis 53,08  ->  Mitte 50,40
 *   Laenge   6,78 bis 13,74  ->  Mitte 10,26
 * Zoom 6 zeigt Deutschland ganz; nachgemessen liegen damit 48 von 48
 * Markern im Bild.
 *
 * Sie muessen nachgezogen werden, wenn Standorte ausserhalb dieses
 * Rahmens dazukommen -- ein Betrieb in Hamburg oder Wien verschiebt die
 * Mitte. Die Pruefung dafuer steht in `bun run metabase/kartenausschnitt.ts`.
 */
const AUSSCHNITT = {
  'map.center_latitude': 50.4018,
  'map.center_longitude': 10.2562,
  'map.zoom': 6,
}

/** Sortierung nach Handlungsdruck, in mehreren Karten gebraucht. */
const NACH_DRUCK = `
          CASE s.intensitaet
            WHEN 'Sofort eskalieren' THEN 1
            WHEN 'Sofort handeln'    THEN 2
            WHEN 'Nachforschung'     THEN 3
            WHEN 'Beobachten/OK'     THEN 4
            ELSE                          5 END`

export const karten: Karte[] = [
  {
    schluessel: 'so_karte',
    name: 'Standorte auf der Karte',
    beschreibung:
      'Ein Punkt je Standort, eingefärbt nach **Handlungsbedarf**. Ein Klick öffnet die '
      + 'Detailseite des Betriebs.\n\n'
      + '🟥 Sofort eskalieren (2+ Kennzahlen rot) · 🔴 Sofort handeln (1 rot) · '
      + '🟠 Nachforschung (2+ orange) · 🟢 Beobachten/OK · ⚪ keine Bewertung möglich\n\n'
      + '**Warum nicht nach der Gesamtampel?** Die ist ein Oder über sechs Kennzahlen — eine '
      + 'einzige rote genügt. Im Juni 2026 wären damit 43 von 48 Standorten rot, und eine '
      + 'Karte, auf der fast alles gleich aussieht, sagt nichts. Der Handlungsbedarf zählt '
      + 'stattdessen und trennt diese 43 in 19 zum Eskalieren und 24 zum Handeln.\n\n'
      + '**Die hohe Rot-Quote ist kein Datenfehler.** Die Personalquote liegt real bei '
      + '35–45 % gegen eine Schwelle von 28/32 %, die im Excel-Blatt „Regeln" ausdrücklich '
      + 'als „Default, bei Bedarf Werte anpassen" steht — anders als der Wareneinsatz, der '
      + 'dort „Fix nach Vorgabe" heißt. Einordnung in `docs/befunde-datenlage.md`.\n\n'
      + 'Antippen zeigt die sechs Einzelampeln — ohne sie sieht man nur, **dass** es rot ist, '
      + 'nicht **woran** es liegt. Die Grafik daneben beantwortet dieselbe Frage für alle '
      + 'Standorte auf einmal.\n\n'
      + 'Zu sehen sind nur Standorte mit hinterlegten Koordinaten; welche fehlen, steht '
      + 'ganz unten.',
    anzeige: 'map',
    parameter: [MONAT, MARKE],
    // WARUM DIE AMPEL IM TEXT STEHT UND NICHT IN DER PUNKTFARBE.
    //
    // Nachgemessen am 27.07.2026 in Metabase v0.63.1.6, nachdem gemeldet
    // wurde "die Marker sind alle blau": Die Punktkarte kennt genau drei
    // Ausprägungen, und KEINE davon nimmt eine Farbdimension entgegen.
    //   markers  zeichnet jeden Punkt als <img src="pin.png"> -- eine
    //            statische Bilddatei, 48-mal dieselbe.
    //   tiles    rendert serverseitig; die Kacheln wurden Pixel fuer Pixel
    //            ausgezaehlt und enthalten zwei Farben, weiss und
    //            rgb(76,157,230). Ebenfalls keine Dimension.
    //   grid     verdichtet zu Flaechen und verliert den Standort.
    //
    // Statt die Ampel stillschweigend zu verlieren, steht sie als Emoji
    // VORNE in jeder Spalte, die im Tooltip auftaucht. Damit ist sie beim
    // Antippen sichtbar -- und in der Tabelle darunter, die dieselben
    // Standorte nach Handlungsdruck sortiert, ohnehin.
    //
    // Nicht uebernommen wurde `map.metric_column`: die Einstellung stand
    // gesetzt, wirkte aber nie. Sie ist ausgeblendet, solange pin_type
    // nicht heat oder grid ist -- gespeichert heisst bei Metabase nicht
    // gewirkt. Siehe docs/fehlerkatalog.md.
    sql: `${MONAT_CTE}
SELECT ${INTENSITAET_EMOJI} || ' ' || s.betrieb AS "Standort",
       s.konzept                        AS "Marke",
       s.breitengrad::float             AS "Breitengrad",
       s.laengengrad::float             AS "Längengrad",${INTENSITAET_TEXT} AS "Handlungsbedarf",
       round(s.umsatz)                  AS "Umsatz",
       -- Die sechs Einzelampeln. Ohne sie sieht man auf der Karte 43-mal
       -- dieselbe Farbe und weiss nicht, WORAN es liegt. '–' heisst
       -- "nicht bewertbar", nicht "in Ordnung" -- bei Bewertung und OM ist
       -- das derzeit der Normalfall, weil dafuer noch keine Daten kommen.
       coalesce(au.emoji, '–')  AS "Umsatz ●",
       coalesce(ap.emoji, '–')  AS "Personal ●",
       coalesce(ab.emoji, '–')  AS "WE Bar ●",
       coalesce(ak.emoji, '–')  AS "WE Küche ●",
       coalesce(aw.emoji, '–')  AS "Bewertung ●",
       coalesce(ao.emoji, '–')  AS "OM vor Ort ●",
       s.ort                            AS "Ort",
       s.betrieb                        AS "Betrieb"
  FROM mart.standort s
  CROSS JOIN gewaehlt g
  LEFT JOIN mart.round_table_monat r
         ON r.betrieb_key = s.betrieb_key AND r.monat = s.monat
  LEFT JOIN ampel.beschriftung au ON au.status = r.ampel_umsatz
  LEFT JOIN ampel.beschriftung ap ON ap.status = r.ampel_personal
  LEFT JOIN ampel.beschriftung ab ON ab.status = r.ampel_we_bar
  LEFT JOIN ampel.beschriftung ak ON ak.status = r.ampel_we_kueche
  LEFT JOIN ampel.beschriftung aw ON aw.status = r.ampel_bewertung
  LEFT JOIN ampel.beschriftung ao ON ao.status = r.ampel_om
 WHERE s.monat = g.monat
   AND s.breitengrad IS NOT NULL
   [[AND s.konzept = {{marke}}]]
 ORDER BY${NACH_DRUCK},
          s.betrieb`,
    visualisierung: {
      ...AUSSCHNITT,
      'map.type': 'pin',
      'map.latitude_column': 'Breitengrad',
      'map.longitude_column': 'Längengrad',
      'map.pin_type': 'markers',
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
    // Das Excel hatte genau diesen Block (00_Dashboard, Zeilen 9-11). Er
    // beantwortet die Frage, die die Karte aufwirft: dort sieht man, DASS
    // fast alles rot ist -- hier, WORAN es liegt.
    schluessel: 'so_rot_treiber',
    name: 'Rot-Treiber nach Bereich',
    beschreibung:
      'Je Kennzahl die Anzahl der Standorte mit roter Ampel. Beantwortet die Frage, die '
      + 'die Karte aufwirft: dort sieht man, dass fast alles rot ist — hier, woran es liegt.\n\n'
      + 'Im Juni 2026 trägt **Personal** den Befund fast allein (38 von 48 Standorten), '
      + 'gefolgt von Umsatz (17). Wareneinsatz Küche (7) und Bar (1) fallen kaum ins Gewicht.\n\n'
      + '**Bewertung und OM vor Ort stehen auf 0** — nicht weil dort alles in Ordnung wäre, '
      + 'sondern weil dafür noch keine Daten geliefert werden. Genau deshalb wird hier '
      + 'gezählt und nicht gemittelt: ein Schnitt wäre stillschweigend einer über vier '
      + 'statt sechs Kennzahlen.',
    anzeige: 'row',
    parameter: [MONAT, MARKE],
    sql: `${MONAT_CTE},
-- Einmal lesen, dann die sechs Ampelspalten in Zeilen kippen. Die
-- Alternative waeren sechs UNION-Zweige, die alle dieselbe Verknuepfung
-- wiederholen -- gleiches Ergebnis, sechsfache Pflege.
mit_ampel AS (
    SELECT r.*
      FROM mart.round_table_monat r
      JOIN mart.standort s ON s.betrieb_key = r.betrieb_key AND s.monat = r.monat
      CROSS JOIN gewaehlt g
     WHERE r.monat = g.monat
       AND s.breitengrad IS NOT NULL
       [[AND s.konzept = {{marke}}]]
)
SELECT b.bereich AS "Bereich",
       count(*) FILTER (WHERE b.ampel = 'rot') AS "Standorte mit roter Ampel",
       -- Fuer den Klick: diese Karte zaehlt ausschliesslich rote, der Wert
       -- ist also immer derselbe. Er steht trotzdem als Spalte da, weil
       -- Metabase nur Spalten uebergeben kann, keine festen Werte.
       'rot'::text AS "Ampelwert"
  FROM mit_ampel m
  CROSS JOIN LATERAL (VALUES
        ('Personal',         m.ampel_personal,  1),
        ('Umsatz',           m.ampel_umsatz,    2),
        ('WE Küche',         m.ampel_we_kueche, 3),
        ('WE Bar',           m.ampel_we_bar,    4),
        ('Online-Bewertung', m.ampel_bewertung, 5),
        ('OM vor Ort',       m.ampel_om,        6)
       ) AS b(bereich, ampel, sortier)
 GROUP BY b.bereich, b.sortier
 ORDER BY b.sortier`,
    visualisierung: {
      'graph.dimensions': ['Bereich'],
      'graph.metrics': ['Standorte mit roter Ampel'],
      'graph.x_axis.title_text': 'Standorte mit roter Ampel',
      'graph.y_axis.title_text': '',
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
    // Dieselbe Karte, klein und mitwandernd.
    //
    // Sie steht oben auf den Seiten, auf denen man ARBEITET -- Round Table,
    // Filialen, Betrieb -- und nicht auf einer eigenen. Der Zweck ist die
    // raeumliche Einordnung im Vorbeigehen: wer die Marke einschraenkt,
    // sieht deren Haeuser; wer einen Betrieb waehlt, sieht diesen einen.
    //
    // Deshalb kennt sie alle drei Filter. Der Betriebsfilter ist der
    // Grund, warum das nicht dieselbe Karte wie `so_karte` sein kann: dort
    // gibt es ihn nicht, und ein Filter, den nur eine von mehreren Karten
    // liest, faellt in der Filterpruefung als "taub" durch.
    schluessel: 'so_karte_klein',
    name: 'Wo liegt das',
    beschreibung:
      'Dieselben Standorte wie auf der Standortkarte, nur kompakt. Folgt den Filtern '
      + 'der Seite: ohne Auswahl alle Häuser, mit Marke deren Häuser, mit Betrieb dieser eine.\n\n'
      + '🟥 eskalieren · 🔴 handeln · 🟠 nachforschen · 🟢 ok · ⚪ keine Bewertung. '
      + 'Nur Standorte mit hinterlegter Adresse.',
    anzeige: 'map',
    parameter: [MONAT, MARKE, BETRIEB, AMPEL, INTENSITAET],
    sql: `${MONAT_CTE}
SELECT ${INTENSITAET_EMOJI} || ' ' || s.betrieb AS "Standort",
       s.konzept                        AS "Marke",
       s.breitengrad::float             AS "Breitengrad",
       s.laengengrad::float             AS "Längengrad",${INTENSITAET_TEXT} AS "Handlungsbedarf",
       round(s.umsatz)                  AS "Umsatz",
       s.ort                            AS "Ort",
       s.betrieb                        AS "Betrieb"
  FROM mart.standort s
  CROSS JOIN gewaehlt g
 WHERE s.monat = g.monat
   AND s.breitengrad IS NOT NULL
   [[AND s.konzept = {{marke}}]]
   [[AND s.betrieb = {{betrieb}}]]
   -- 'ohne' steht fuer NULL; das laesst sich nicht als Gleichheit
   -- schreiben, deshalb der Umweg ueber coalesce.
   [[AND coalesce(s.ampel, 'ohne') = {{ampel}}]]
   [[AND s.intensitaet = {{intensitaet}}]]
 ORDER BY${NACH_DRUCK},
          s.betrieb`,
    visualisierung: {
      ...AUSSCHNITT,
      'map.type': 'pin',
      'map.latitude_column': 'Breitengrad',
      'map.longitude_column': 'Längengrad',
      'map.pin_type': 'markers',
      'map.tooltip_column': 'Standort',
      column_settings: {
        '["name","Umsatz"]': {
          number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0,
        },
      },
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
