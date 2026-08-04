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
import { MONAT_CTE, MONAT_CTE_UMSATZ, ZEITRAUM_CTE, P_MONAT, P_MARKE, P_BETRIEB, P_AMPEL, P_BEREICH, P_INTENSITAET, P_ZEITRAUM } from './gemeinsam'

// ---------------------------------------------------------------------
// Personalquoten sind nur mit Filter und Median zu gebrauchen.
//
// mart.personalkosten fuehrt Tageszeilen, und die Quoten darin haben den
// TAGESUMSATZ IM NENNER. An einem Tag mit 6,05 EUR Umsatz ergibt das
// 316.576 Prozent -- keine Anomalie, sondern die Bauart der Kennzahl.
// Ueber alle Tageswerte liegt der Median bei 383 Prozent.
//
// Der Kommentar der Sicht schreibt deshalb beides vor: Median nehmen UND
// Tage ohne nennenswerten Umsatz ausschliessen. Beides steht hier an
// einer Stelle, damit keine Karte nur die Haelfte davon befolgt.
// ---------------------------------------------------------------------
const PLAUSIBEL = 'pek_gesamt > 0 AND pek_gesamt <= 200'

const MEDIAN = (spalte: string) =>
  `round(percentile_cont(0.5) WITHIN GROUP (\n             ORDER BY ${spalte}) `
  + `FILTER (WHERE ${PLAUSIBEL})::numeric, 1)`

export const karten: Karte[] = [
  // ===================================================================
  // EBENE 1 — Marken
  // ===================================================================
  {
    schluessel: 'dd_marken_tabelle',
    name: 'Marken im Überblick',
    beschreibung:
      'Eine Zeile je Marke mit allen sechs Kennzahlen und der Ampelverteilung. Ein Klick auf eine Zeile öffnet die Filialen dieser Marke. Die Prozentwerte sind Mediane, also der mittlere Betrieb der Marke — ein einzelner Ausreißer verzieht so nicht das Bild der ganzen Marke.',
    anzeige: 'table',
    parameter: [P_MONAT, P_MARKE],
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
   [[AND r.konzept = {{marke}}]]
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
    beschreibung: 'Wie sich die Gesamtampel innerhalb jeder Marke verteilt. Ein Klick auf einen Balken öffnet die Filialen dieser Marke.',
    anzeige: 'bar',
    parameter: [P_MONAT, P_MARKE],
    sql: `${MONAT_CTE}
SELECT r.konzept                                       AS "Marke",
       count(*) FILTER (WHERE r.gesamt = 'rot')        AS "Rot",
       count(*) FILTER (WHERE r.gesamt = 'orange')     AS "Orange",
       count(*) FILTER (WHERE r.gesamt = 'gruen')      AS "Grün",
       count(*) FILTER (WHERE r.gesamt IS NULL)        AS "Ohne Urteil"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.monat = g.monat
   [[AND r.konzept = {{marke}}]]
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
    parameter: [P_MARKE],
    sql: `
SELECT monat                        AS "Monat",
       coalesce(konzept, '(nicht zugeordnet)') AS "Marke",
       sum(umsatz_monat)            AS "Umsatz"
  FROM mart.umsatz_ytd
 WHERE 1 = 1
   [[AND konzept = {{marke}}]]
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
      'Alle Betriebe der gewählten Marke über sämtliche Kennzahlen, jede mit ihrer Ampel. Sortiert nach Handlungsdruck. Ein Klick auf eine Zeile öffnet die Detailseite des Betriebs.',
    anzeige: 'table',
    parameter: [P_MONAT, P_MARKE, P_AMPEL, P_INTENSITAET],
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
   -- Nur operative Betriebe: geschlossene, verwaltende und Test-Betriebe
   -- stellten ein Drittel der roten Ampeln und begruben die eigentliche
   -- Arbeitsliste. Die Zaehlkacheln auf ① zaehlen dieselbe Menge.
   AND r.operativ
   [[AND r.konzept = {{marke}}]]
   -- 'ohne' steht fuer "keine Ampel berechenbar" (NULL). Ohne diesen Fall
   -- fuehrte die Kachel "Ohne Urteil" auf eine leere Liste.
   [[AND coalesce(r.gesamt, 'ohne') = {{ampel}}]]
   [[AND r.intensitaet = {{intensitaet}}]]
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
    // Das Ziel jedes Klicks auf ein Balkensegment.
    //
    // Ein gestapelter Balken traegt ZWEI Angaben: die Achse sagt den
    // Bereich (Personal), die Farbe die Ampel (rot). Zusammen sind das
    // 19 Betriebe -- und genau die will sehen, wer darauf klickt.
    //
    // Deshalb eine eigene Karte statt der grossen Filialtabelle: die
    // filtert auf die GESAMTAMPEL. "Personal rot" und "gesamt rot" sind
    // aber verschiedene Mengen, denn die Gesamtampel ist ein Oder ueber
    // alle sechs Bereiche. Wer das verwechselt, landet bei 43 statt 19
    // Betrieben und haelt die Liste fuer die des Balkens.
    //
    // mart.ampel_bereich hat eine Zeile je Betrieb UND Bereich -- also
    // genau die Koernung, die ein Balkensegment meint.
    schluessel: 'dd_filialen_bereich',
    name: 'Betriebe hinter dem Balken',
    beschreibung:
      'Die Betriebe eines einzelnen Balkensegments — etwa alle mit grüner Umsatzampel. '
      + 'Ohne Auswahl stehen hier alle Bereiche untereinander.\n\n'
      + 'Nicht zu verwechseln mit der Gesamtampel: „Personal rot" ist etwas anderes als '
      + '„insgesamt rot", weil die Gesamtampel ein Oder über alle sechs Bereiche ist.',
    anzeige: 'table',
    parameter: [P_MONAT, P_MARKE, P_AMPEL, P_BEREICH, P_INTENSITAET],
    sql: `${MONAT_CTE}
SELECT a.bereich_name        AS "Bereich",
       coalesce(a.emoji, '⚪') AS "●",
       a.betrieb             AS "Betrieb",
       a.konzept             AS "Marke",
       a.stadt               AS "Stadt",
       a.wert                AS "Wert",
       a.ampel_text          AS "Bewertung",
       a.gesamt              AS "Gesamtampel",
       a.intensitaet         AS "Handlungsbedarf",
       a.ursache             AS "Ursache",
       a.massnahme           AS "Maßnahme"
  FROM mart.ampel_bereich a
  CROSS JOIN gewaehlt g
 WHERE a.monat = g.monat
   AND a.operativ
   [[AND a.konzept = {{marke}}]]
   [[AND a.bereich_name = {{bereich}}]]
   -- 'ohne' steht fuer NULL: fuer diesen Bereich liess sich keine Ampel
   -- rechnen. Das ist eine Aussage und kein Grund zum Ausblenden -- bei
   -- Online-Bewertung und OM ist es derzeit sogar der Normalfall.
   [[AND coalesce(a.ampel, 'ohne') = {{ampel}}]]
   [[AND a.intensitaet = {{intensitaet}}]]
 ORDER BY a.reihenfolge,
          CASE a.ampel WHEN 'rot' THEN 1 WHEN 'orange' THEN 2
                       WHEN 'gruen' THEN 3 ELSE 4 END,
          a.wert DESC NULLS LAST,
          a.betrieb`,
    visualisierung: {
      column_settings: {
        '["name","Wert"]': { decimals: 1 },
      },
    },
  },

  {
    schluessel: 'dd_filialen_rangliste',
    name: 'Filialen nach Personalkostenquote',
    beschreibung:
      'Die 20 Betriebe mit der höchsten Personalkostenquote — die Kennzahl mit den meisten roten Ampeln. Ein Klick auf einen Balken öffnet die Detailseite des Betriebs; die vollständige Liste steht in der Tabelle oben.',
    anzeige: 'row',
    parameter: [P_MONAT, P_MARKE, P_AMPEL, P_INTENSITAET],
    sql: `${MONAT_CTE}
SELECT r.betrieb                AS "Betrieb",
       r.personalkosten_ogf_pct AS "Personal o. GF %"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.monat = g.monat
   AND r.personalkosten_ogf_pct IS NOT NULL
   AND r.operativ
   [[AND r.konzept = {{marke}}]]
   [[AND coalesce(r.gesamt, 'ohne') = {{ampel}}]]
   [[AND r.intensitaet = {{intensitaet}}]]
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
    schluessel: 'dd_filialen_streuung',
    name: 'Umsatz gegen Personalkostenquote',
    beschreibung:
      'Jeder Punkt ist ein Betrieb. Rechts unten steht der Wunschfall: viel Umsatz bei niedriger Personalkostenquote. Links oben stehen die Betriebe, bei denen beides nicht stimmt.',
    anzeige: 'scatter',
    parameter: [P_MONAT, P_MARKE, P_AMPEL, P_INTENSITAET],
    sql: `${MONAT_CTE}
SELECT r.umsatz_ist             AS "Umsatz",
       r.personalkosten_ogf_pct AS "Personal o. GF %",
       r.betrieb                AS "Betrieb"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
 WHERE r.monat = g.monat
   AND r.personalkosten_ogf_pct IS NOT NULL
   AND r.operativ
   [[AND r.konzept = {{marke}}]]
   [[AND coalesce(r.gesamt, 'ohne') = {{ampel}}]]
   [[AND r.intensitaet = {{intensitaet}}]]`,
    visualisierung: {
      'graph.dimensions': ['Umsatz'],
      'graph.metrics': ['Personal o. GF %'],
    },
  },
  {
    schluessel: 'dd_filialen_metrikvergleich',
    name: 'Alle Kennzahlen nebeneinander',
    beschreibung:
      'Dieselben Betriebe, aber nach Bereich sortiert statt nach Betrieb. So wird sichtbar, welche Kennzahl in dieser Marke durchgehend klemmt und welche nur bei einzelnen Häusern.',
    anzeige: 'bar',
    parameter: [P_MONAT, P_MARKE],
    // Langform statt Breitform, damit der Klick auf ein Segment beide
    // Angaben mitgeben kann: Bereich UND Bewertung. Steht die Ampel im
    // Spaltennamen, laesst sie sich nicht uebergeben -- siehe rt_treiber.
    sql: `${MONAT_CTE}
SELECT a.bereich_name                       AS "Bereich",
       coalesce(b.bezeichnung, 'Keine Daten') AS "Bewertung",
       count(*)                             AS "Betriebe",
       coalesce(a.ampel, 'ohne')            AS "Ampelwert"
  FROM mart.ampel_bereich a
  CROSS JOIN gewaehlt g
  LEFT JOIN ampel.beschriftung b ON b.status = a.ampel
 WHERE a.monat = g.monat
   AND a.operativ
   [[AND a.konzept = {{marke}}]]
 GROUP BY a.bereich_name, a.reihenfolge, b.bezeichnung, a.ampel
 ORDER BY a.reihenfolge`,
    visualisierung: {
      'graph.dimensions': ['Bereich', 'Bewertung'],
      'graph.metrics': ['Betriebe'],
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
    beschreibung:
      'Alle sechs Kennzahlen mit Ampel, Wert und Veränderung zum Vormonat.\n\n'
      + 'Ohne gewählten Betrieb stehen hier **alle** Betriebe untereinander, nach '
      + 'Handlungsdruck sortiert — die Spalte „Betrieb" sagt jeweils, um welchen es geht.',
    anzeige: 'table',
    parameter: [P_MONAT, P_BETRIEB, P_MARKE],
    // DIE BETRIEBSSPALTE IST NICHT SCHMUECKEND.
    //
    // Die Karte ist fuer EINEN Betrieb gedacht -- sechs Zeilen, je eine
    // Kennzahl. Ohne Betriebsfilter liefert dieselbe Abfrage aber 846
    // Zeilen: 141 Betriebe mal sechs Bereiche, unaggregiert und ohne
    // Kennung. Man sieht dann sechsmal "Umsatz" untereinander mit
    // verschiedenen Werten und haelt es fuer die Kennzahlen eines Hauses.
    // Gemeldet am 28.07.2026.
    //
    // Die Spalte "Betrieb" beantwortet genau diese Frage. Bei gewaehltem
    // Betrieb steht in allen sechs Zeilen dasselbe -- redundant, aber
    // harmlos; die Alternative waere eine zweite fast gleiche Karte.
    //
    // Die Sortierung nach Handlungsdruck ist der zweite Teil: ohne sie
    // stuenden 846 Zeilen in beliebiger Reihenfolge da. So stehen die
    // Betriebe oben, bei denen etwas zu tun ist.
    sql: `${MONAT_CTE}
SELECT t.betrieb                         AS "Betrieb",
       t.bereich_name                    AS "Bereich",
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
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = t.betrieb_key
 WHERE t.monat = g.monat
   -- Ohne Betriebsfilter nur operative Betriebe -- die 846-Zeilen-Sicht
   -- soll die Flotte zeigen, nicht die Karteileichen. Ein ausdruecklich
   -- gewaehlter Betrieb bleibt sichtbar, auch wenn er geschlossen ist.
   AND (t.operativ [[ OR t.betrieb = {{betrieb}} ]])
   [[AND t.betrieb = {{betrieb}}]]
   [[AND kz.hauptkonzept = {{marke}}]]
 ORDER BY CASE ab.gesamt WHEN 'rot' THEN 1 WHEN 'orange' THEN 2
                         WHEN 'gruen' THEN 3 ELSE 4 END,
          t.betrieb,
          t.reihenfolge`,
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
    beschreibung:
      'Tagesumsatz des gewählten Betriebs. Die kräftige Linie ist das **Mittel der letzten '
      + 'sieben Tage** — sie nimmt den Wochenrhythmus heraus, damit die Entwicklung sichtbar '
      + 'wird. Die blasse Linie dahinter sind die einzelnen Tage.\n\n'
      + 'Ohne gesetzten Zeitraum werden die letzten 90 Tage gezeigt; ein selbst '
      + 'gewählter Zeitraum wird bis zu einem Jahr vollständig gezeichnet.',
    anzeige: 'line',
    parameter: [P_BETRIEB, P_ZEITRAUM],
    // WARUM GEGLAETTET WIRD.
    //
    // Gemeldet am 27.07.2026: "die gelben Linien schiessen nur so hin und
    // her". Nachgemessen: die Karte zeichnete 3.124 Tage seit 2018 in eine
    // Kachel von rund 500 Pixeln -- sechs Punkte je Pixel. Dazu der
    // Wochenrhythmus, der bei Aposto Augsburg zwischen 0 und 18.852 EUR
    // springt. Was dabei entsteht, ist ein gefuelltes Band, kein Verlauf.
    //
    // Zwei Aenderungen, beide noetig:
    //   1. Der Zeitraumfilter greift jetzt (vorher gab es hier gar keinen)
    //      und zeigt ohne Angabe die letzten 90 Tage.
    //   2. Ein gleitendes Mittel ueber sieben Tage nimmt den
    //      Wochenrhythmus heraus. Genau sieben, damit jeder Wochentag
    //      einmal vorkommt -- bei fuenf oder zehn bliebe ein Rest davon
    //      stehen und saehe aus wie ein Trend.
    //
    // Die Rohwerte bleiben als zweite Reihe sichtbar. Wer einen einzelnen
    // Ausreissertag sucht, findet ihn weiterhin; die geglaettete Linie
    // beantwortet nur die andere Frage.
    sql: `
WITH tage AS (
    SELECT geschaeftstag,
           sum(umsatz_netto) AS umsatz
      FROM mart.umsatz_tag
     WHERE 1 = 1
       [[AND betrieb = {{betrieb}}]]
       [[AND {{zeitraum}}]]
     GROUP BY geschaeftstag
)
SELECT geschaeftstag AS "Geschäftstag",
       round(avg(umsatz) OVER (ORDER BY geschaeftstag
                               ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)) AS "Mittel 7 Tage",
       round(umsatz)                                                      AS "Einzelne Tage"
  FROM tage
 -- Ohne gesetzten Zeitraum die letzten 90 Tage: 3.124 Punkte sind in
 -- einer Dashboardkachel nicht darstellbar, und die Frage "wie lief der
 -- Betrieb zuletzt" braucht sie auch nicht.
 --
 -- Die Eingrenzung steht NUR in der CTE oben. Ein zweites {{zeitraum}}
 -- stand hier bis zum 28.07.2026 in einer Unterabfrage ueber "tage" --
 -- Metabase baut daraus aber "umsatz_tag.geschaeftstag", und diese
 -- Tabelle ist an der Stelle nicht mehr in Reichweite. Ergebnis:
 -- "missing FROM-clause entry for table umsatz_tag", sobald jemand
 -- wirklich einen Zeitraum setzte. Ohne gesetzten Filter fiel der
 -- optionale Block weg, und der Fehler blieb unsichtbar.
 --
 -- Der 90-Tage-Rueckfall gilt dem KEIN-FILTER-Fall (gesamte Historie,
 -- 3.100+ Punkte). Bis zum 03.08.2026 kappte er auch ausdruecklich
 -- gesetzte Zeitraeume: wer sechs Monate einstellte, sah kommentarlos
 -- die letzten 90 Tage davon -- und die Karte sah aus, als haette sie
 -- den Filter befolgt. Die Grenze liegt jetzt bei einem Jahr: alles
 -- darunter war eine bewusste Wahl und wird vollstaendig gezeichnet.
 WHERE geschaeftstag >= (SELECT max(geschaeftstag) - 89 FROM tage)
    OR (SELECT max(geschaeftstag) - min(geschaeftstag) FROM tage) <= 366
 ORDER BY geschaeftstag`,
    template_tag_dimension: { zeitraum: ['mart', 'umsatz_tag', 'geschaeftstag'] },
    visualisierung: {
      'graph.dimensions': ['Geschäftstag'],
      'graph.metrics': ['Mittel 7 Tage', 'Einzelne Tage'],
      'graph.y_axis.title_text': 'Umsatz netto',
      'graph.x_axis.title_text': '',
      series_settings: {
        'Mittel 7 Tage': { color: '#509EE3', 'line.width': 3 },
        // Die Rohtage treten bewusst zurueck: sie sind der Beleg, nicht
        // die Aussage.
        'Einzelne Tage': { color: '#C7CFD4', 'line.width': 1, 'line.style': 'dotted' },
      },
    },
  },
  {
    schluessel: 'dd_betrieb_ampelverlauf',
    name: 'Betrieb — Ampelverlauf je Bereich',
    beschreibung:
      'Wie sich die Quoten über die Monate entwickelt haben. Wo die Linie abbricht, fehlen '
      + 'die Daten — das ist eine Lücke, kein Nullwert.\n\n'
      + 'Ohne gewählten Betrieb ist es der **mittlere Betrieb** je Monat, nicht die Summe: '
      + 'ein Median über Quoten, damit die Linie eine Quote bleibt.',
    anzeige: 'line',
    parameter: [P_BETRIEB, P_ZEITRAUM],
    // AGGREGIERT, weil sonst 91 Betriebe uebereinanderliegen.
    //
    // Ohne Betriebsfilter lieferte die Karte 10.746 Punkte aus 91
    // Betrieben -- fuer dieselbe Monat/Bereich-Kombination also viele
    // Werte, die Metabase zu einem unlesbaren Knaeuel verbindet. Nichts
    // daran sagt, dass mehrere Haeuser drinstecken.
    //
    // Der Median statt der Summe, weil es PROZENTWERTE sind: die Summe
    // zweier Personalquoten ist keine Personalquote. Bei einem gewaehlten
    // Betrieb aendert der Median nichts -- ein Wert je Gruppe bleibt er
    // selbst.
    sql: `
SELECT monat        AS "Monat",
       bereich_name AS "Bereich",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY wert)::numeric, 1) AS "Wert"
  FROM mart.ampel_bereich
 WHERE wert IS NOT NULL
   AND bereich IN ('personal','we_bar','we_kueche')
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY monat, bereich_name, reihenfolge
 ORDER BY monat, reihenfolge`,
    template_tag_dimension: { zeitraum: ['mart', 'ampel_bereich', 'monat'] },
    visualisierung: {
      'graph.dimensions': ['Monat', 'Bereich'],
      'graph.metrics': ['Wert'],
      'graph.y_axis.title_text': 'Prozent',
    },
  },
  {
    schluessel: 'dd_betrieb_sparte',
    name: 'Betrieb — Speisen und Getränke',
    beschreibung: 'Spartenumsatz des gewählten Betriebs im gewählten Zeitraum.',
    anzeige: 'bar',
    parameter: [P_BETRIEB, P_ZEITRAUM],
    sql: `
SELECT monat             AS "Monat",
       hauptsparte       AS "Sparte",
       sum(umsatz_netto) AS "Umsatz"
  FROM mart.umsatz_tag_sparte
 WHERE hauptsparte IS NOT NULL
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY monat, hauptsparte
 ORDER BY monat`,
    template_tag_dimension: { zeitraum: ['mart', 'umsatz_tag_sparte', 'geschaeftstag'] },
    visualisierung: {
      'graph.dimensions': ['Monat', 'Sparte'],
      'graph.metrics': ['Umsatz'],
      'stackable.stack_type': 'stacked',
    },
  },
  {
    schluessel: 'dd_betrieb_zeitzone',
    name: 'Betrieb — Zeitzonen',
    beschreibung: 'Wovon dieser Betrieb lebt: Frühstück, Mittag, Happy Hour, Abend und Late Night im gewählten Zeitraum.',
    anzeige: 'bar',
    parameter: [P_BETRIEB, P_ZEITRAUM],
    sql: `
SELECT zeitzone          AS "Zeitzone",
       sum(umsatz_netto) AS "Umsatz"
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
    schluessel: 'dd_betrieb_stunde',
    name: 'Betrieb — Tagesverlauf',
    beschreibung:
      'Umsatz je Stunde im gewählten Zeitraum. Der Geschäftstag beginnt um 08:00 — die Nachtstunden stehen deshalb am Ende und nicht am Anfang.',
    anzeige: 'bar',
    parameter: [P_BETRIEB, P_ZEITRAUM],
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
    },
  },
  {
    schluessel: 'dd_betrieb_personal',
    name: 'Betrieb — Personal je Bereich',
    beschreibung:
      'Eine Zeile je Monat. Die belastbare Zahl ist **„o. GF % (BWA)“** — die '
      + 'Personalquote ohne Geschäftsführung aus den Zahlen des Steuerberaters; auf ihr '
      + 'beruht auch die Ampel im Round Table.\n\n'
      + 'Die Spalten mit „(Med.)“ sind der **Median der Tageswerte** und nur ein '
      + 'Anhaltspunkt: die Tagesquote hat den Tagesumsatz im Nenner, und der schwankt '
      + 'stärker als die Personalkosten. „Tage“ sagt, wie viele Tage des Monats '
      + 'überhaupt eine plausible Quote ergaben — steht dort eine kleine Zahl, ist der '
      + 'Median wenig wert.\n\n'
      + '„€/Std“ ist der Umsatz je geleisteter Personalstunde.',
    anzeige: 'table',
    parameter: [P_BETRIEB, P_ZEITRAUM],
    // JE MONAT, nicht je Tag -- und der Median statt des Rohwerts.
    //
    // Gemeldet am 28.07.2026: "einzeltage sind nicht so aussagekraeftig und
    // warum wird da ein zeitraum angezeigt, wenn es nur ein tag ist?"
    // Beides zutreffend, und dahinter lag ein groesserer Fehler.
    //
    // mart.personalkosten fuehrt AUSSCHLIESSLICH Tageszeilen (233.778
    // Stueck, zeitraum_bis = zeitraum_von). Die Karte zeigte sie roh --
    // 91 Zeilen fuer einen Betrieb, jede eine "Von-Bis"-Spanne ueber
    // genau einen Tag. Das allein waere Kosmetik.
    //
    // Der eigentliche Fehler steht im Kommentar der Sicht: diese Quoten
    // haben den UMSATZ IM NENNER. An einem Tag mit 6 EUR Umsatz ergibt
    // das 316.576 Prozent, und das ist keine Anomalie, sondern die
    // Bauart der Kennzahl. Ueber alle Tageswerte liegt der Median bei
    // 383 Prozent. In der Karte standen Werte wie 777 und 1.262 unter
    // der Ueberschrift "Personal %" -- neben einem BWA-Wert von 32,6.
    // Wer die vergleicht, vergleicht Unvergleichbares.
    //
    // Deshalb, wie im Sichtkommentar vorgeschrieben: Median UND
    // Ausschluss der Tage ohne nennenswerten Umsatz. Die Zahl der
    // verbliebenen Tage steht daneben -- bei Aposto Augsburg sind das
    // 7 bis 11 von 30, und diese Ehrlichkeit gehoert in die Tabelle.
    sql: `
SELECT betrieb                   AS "Betrieb",
       to_char(monat, 'MM.YYYY') AS "Monat",
       round(max(persoog_bwa), 1) AS "o. GF % (BWA)",
       count(*) FILTER (WHERE ${PLAUSIBEL})           AS "Tage",
       ${MEDIAN('pek_gesamt')}                        AS "Personal % (Med.)",
       ${MEDIAN('pek_service')}                       AS "Service % (Med.)",
       ${MEDIAN('pek_bar')}                           AS "Bar % (Med.)",
       ${MEDIAN('pek_kueche')}                        AS "Küche % (Med.)",
       round(percentile_cont(0.5) WITHIN GROUP (
             ORDER BY eff_gesamt) FILTER (WHERE eff_gesamt > 0)::numeric, 1) AS "€/Std"
  FROM mart.personalkosten
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY betrieb, monat
 ORDER BY monat DESC`,
    template_tag_dimension: { zeitraum: ['mart', 'personalkosten', 'zeitraum_von'] },
  },
  {
    schluessel: 'dd_betrieb_artikel',
    name: 'Betrieb — Umsatzstärkste Artikel',
    beschreibung:
      'Die 30 umsatzstärksten Artikel dieses Betriebs im gewählten Monat. „DB %" gilt nur für den Umsatzanteil mit hinterlegtem Wareneinsatz („WE hinterlegt %") und ist eine Umsatzgliederung, keine Margenaussage. Bleibt leer, solange die Artikeldaten noch eingelesen werden.',
    anzeige: 'table',
    parameter: [P_MONAT, P_BETRIEB],
    // ZWEI Korrekturen vom 03.08.2026:
    //   1. Der Filter liegt auf geschaeftstag statt auf der abgeleiteten
    //      monat-Spalte -- nur so greift das Partition Pruning von
    //      core.artikelverkauf_tag (1 statt 108 Partitionen; dieselbe
    //      Regel, die Commit 3597eb1 fuer die Warengruppen durchsetzte).
    //   2. "DB %" rechnet auf dem ABGEDECKTEN Umsatz: seit nullif(fixer_we)
    //      zeigte die alte Formel sonst wieder 100 % fuer Artikel ohne
    //      WE-Ansatz -- eine Margenaussage aus fixer_we, die die
    //      Projektregel ausdruecklich verbietet.
    sql: `${MONAT_CTE_UMSATZ}
SELECT av.artikel                 AS "Artikel",
       av.warengruppe             AS "Warengruppe",
       sum(av.menge)              AS "Menge",
       sum(av.umsatz_netto)       AS "Umsatz",
       sum(av.deckungsbeitrag)    AS "Deckungsbeitrag",
       round(100 * sum(av.deckungsbeitrag)
             / nullif(sum(av.umsatz_netto) FILTER (WHERE av.fixer_we IS NOT NULL), 0), 1) AS "DB %",
       round(100 * sum(av.umsatz_netto) FILTER (WHERE av.fixer_we IS NOT NULL)
             / nullif(sum(av.umsatz_netto), 0), 1)                                        AS "WE hinterlegt %"
  FROM mart.artikelverkauf av
  CROSS JOIN gewaehlt g
 WHERE av.geschaeftstag >= g.monat
   AND av.geschaeftstag < (g.monat + interval '1 month')::date
   AND av.umsatz_netto IS NOT NULL
   [[AND av.betrieb = {{betrieb}}]]
 GROUP BY av.artikel, av.warengruppe
HAVING sum(av.umsatz_netto) > 0
 ORDER BY sum(av.umsatz_netto) DESC
 LIMIT 30`,
  },
  {
    schluessel: 'dd_betrieb_bwa',
    name: 'Betrieb — BWA im Verlauf',
    beschreibung: 'Umsatz, Wareneinsatz, Personalkosten und Ergebnis aus den Zahlen des Steuerberaters. Es werden nur gebuchte Monate gezeigt.',
    anzeige: 'line',
    parameter: [P_BETRIEB, P_ZEITRAUM],
    sql: `
-- OHNE Tabellenalias, und das ist Absicht.
--
-- Metabase baut die Klausel eines Feldfilters aus dem TABELLENNAMEN:
-- "bwa_kennzahl.monat BETWEEN ...". Stand hier ein Alias (FROM
-- mart.bwa_kennzahl k), war der Name an dieser Stelle nicht mehr
-- gueltig, und Postgres antwortete mit "invalid reference to
-- FROM-clause entry for table bwa_kennzahl". Gemessen am 28.07.2026,
-- als die Karte den Zeitraumfilter bekam.
SELECT monat AS "Monat",
       round(sum(wert_absolut) FILTER (WHERE kennzahl = 'Umsatz'))                 AS "Umsatz",
       round(sum(wert_absolut) FILTER (WHERE kennzahl IN ('WE Bar','WE Küche')))   AS "Wareneinsatz",
       round(sum(wert_absolut) FILTER (WHERE kennzahl = 'Personalkosten ohne GF')) AS "Personalkosten",
       round(sum(wert_absolut) FILTER (WHERE kennzahl = 'EBIT'))                   AS "EBIT"
  FROM mart.bwa_kennzahl
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY monat
HAVING count(*) FILTER (WHERE wert_absolut IS NOT NULL AND wert_absolut <> 0) > 0
 ORDER BY monat`,
    template_tag_dimension: { zeitraum: ['mart', 'bwa_kennzahl', 'monat'] },
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Umsatz', 'Wareneinsatz', 'Personalkosten', 'EBIT'],
    },
  },
  {
    schluessel: 'dd_betrieb_massnahmen',
    name: 'Betrieb — Maßnahmen',
    beschreibung: 'Welche Maßnahmen für diesen Betrieb offen sind. Die Liste wird von Hand gepflegt — bleibt sie leer, heißt das „nichts erfasst", nicht „nichts zu tun".',
    anzeige: 'table',
    parameter: [P_BETRIEB],
    sql: `
SELECT CASE WHEN ueberfaellig THEN '⚠' ELSE '' END AS "!",
       betrieb        AS "Betrieb",
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
      'Woher die Zahlen dieser Seite stammen und wie aktuell sie sind. Der erste Blick, '
      + 'bevor man aus den Zahlen darüber etwas schließt.\n\n'
      + '„Alter“ ist der Abstand des letzten Umsatztages zu heute in Tagen, '
      + '„Verzug“ der Rückstand der BWA in Monaten.',
    anzeige: 'table',
    parameter: [P_BETRIEB],
    sql: `
-- Kurze Ueberschriften, weil bei dieser Tabelle die UEBERSCHRIFT die
-- Spalte breit macht und nicht der Wert: "BWA Verzug (Monate)" belegte
-- 166 Pixel fuer eine einstellige Zahl. Im Browser nachgemessen am
-- 28.07.2026 -- zusammen mit "Alter (Tage)" war das der Ueberstand, der
-- die Tabelle auch ueber die volle Breite noch scrollen liess.
SELECT d.betrieb                  AS "Betrieb",
       s.status                   AS "Status",
       d.befund                   AS "Befund",
       d.erster_tag               AS "Umsatz ab",
       d.letzter_tag              AS "Umsatz bis",
       d.umsatz_alter_tage        AS "Alter",
       d.bwa_monat                AS "BWA bis",
       d.bwa_verzug_monate        AS "Verzug",
       d.artikeltage              AS "Artikeltage",
       d.letzter_personaltag      AS "Personal bis",
       d.bwa_bruecke              AS "BWA-Brücke"
  FROM mart.datenstand d
  LEFT JOIN mart.betrieb_status s ON s.betrieb_key = d.betrieb_key
 WHERE 1 = 1
   [[AND d.betrieb = {{betrieb}}]]`,
  },
  {
    schluessel: 'dd_betrieb_bestellungen',
    name: 'Betrieb — Bestellungen',
    beschreibung:
      'Die Bestellungen dieses Betriebs, neueste zuerst — Datum, Lieferant, Anzahl '
      + 'Positionen und Summe. Stornierte Bestellungen bleiben in der Liste stehen, sind aber '
      + 'als solche markiert: sie wurden zurückgenommen und zählen in keiner anderen '
      + 'Auswertung mehr mit.',
    anzeige: 'table',
    parameter: [P_BETRIEB, P_ZEITRAUM],
    // OHNE ALIAS: {{zeitraum}} ist ein Feldfilter auf mart.einkauf_beleg.
    // Metabase baut daraus "einkauf_beleg.bestelldatum BETWEEN ...", und
    // unter einem Alias waere dieser Name nicht mehr gueltig -- derselbe
    // Fehler wie bei dd_betrieb_bwa (siehe Kommentar dort).
    sql: `
SELECT bestelldatum                                   AS "Datum",
       lieferdatum                                     AS "Lieferdatum",
       lieferant                                        AS "Lieferant",
       positionen                                       AS "Positionen",
       summe                                             AS "Summe",
       CASE WHEN storniert THEN 'storniert' ELSE '' END AS "Storno",
       beleg_nummer                                      AS "Beleg-Nr."
  FROM mart.einkauf_beleg
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 ORDER BY bestelldatum DESC
 LIMIT 500`,
    template_tag_dimension: { zeitraum: ['mart', 'einkauf_beleg', 'bestelldatum'] },
    visualisierung: {
      column_settings: {
        '["name","Summe"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 2 },
      },
    },
  },
  {
    schluessel: 'dd_betrieb_inventur',
    name: 'Betrieb — Inventuren',
    beschreibung:
      'Inventuren dieses Betriebs mit bewertetem Soll- und Zählbestand sowie dem daraus '
      + 'errechneten Schwund in Euro. Eine noch nicht signierte Zählung ist als solche '
      + 'gekennzeichnet — ihr Wert ist ein Zwischenstand, kein Ergebnis. Bleibt die Liste '
      + 'leer, heißt das „noch keine Inventuren erfasst": die Zählungen werden von Hand '
      + 'nachgetragen, nicht laufend importiert. Eine belastbare Schwundaussage liefert das '
      + 'derzeit praktisch nur bei Wilma Wunder — bei den übrigen Marken gibt es zu wenige '
      + 'Zählungen dafür.',
    anzeige: 'table',
    parameter: [P_BETRIEB],
    sql: `
SELECT datum                                              AS "Datum",
       art                                                 AS "Art",
       CASE WHEN storniert THEN 'storniert'
            WHEN signiert  THEN 'signiert'
            ELSE '… nicht signiert' END                    AS "Status",
       positionen_geladen                                  AS "Positionen",
       soll_bewertet                                        AS "Soll (bewertet)",
       gezaehlt_bewertet                                    AS "Gezählt (bewertet)",
       schwund_eur                                          AS "Schwund €"
  FROM mart.inventur
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
 ORDER BY datum DESC NULLS LAST`,
    visualisierung: {
      column_settings: {
        '["name","Soll (bewertet)"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 2 },
        '["name","Gezählt (bewertet)"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 2 },
        '["name","Schwund €"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 2 },
      },
    },
  },

  // ===================================================================
  // Zeitraumvergleich
  //
  // Zwei frei waehlbare Zeitraeume nebeneinander. Vorbelegt mit den
  // letzten sieben abgeschlossenen Tagen gegen DASSELBE Fenster vier
  // Wochen frueher — wochentagstreu, Montag gegen Montag. Der alte
  // Default ("laufender Monat gegen Vormonat") verglich am Monatsdritten
  // Sa/So/Mo mit Mi/Do/Fr, und der Wochentagsmix dominierte das Delta.
  // ===================================================================
  {
    schluessel: 'vg_zeit_betrieb',
    name: 'Zeitraumvergleich je Betrieb',
    beschreibung:
      'Zwei frei wählbare Zeiträume nebeneinander. Voreingestellt: die letzten sieben abgeschlossenen Tage gegen dasselbe Fenster vier Wochen früher — Montag gegen Montag, Samstag gegen Samstag. „Tage" zählt nur Tage MIT Umsatz: fehlt dem jüngsten Zeitraum ein Tag, sind die Daten noch nicht nachgeliefert.',
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
       count(*) FILTER (WHERE u.geschaeftstag BETWEEN z.a_von AND z.a_bis
                          AND u.umsatz_netto > 0) AS "Tage A",
       count(*) FILTER (WHERE u.geschaeftstag BETWEEN z.b_von AND z.b_bis
                          AND u.umsatz_netto > 0) AS "Tage B",
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
    beschreibung:
      'Beide Zeiträume als Summe über alle Betriebe. „Tage mit Daten" neben den Kalendertagen zeigt, ob der jüngste Zeitraum schon vollständig geliefert ist — LINA füllt die letzten Tage nach. „Betriebe" zählt nur Häuser mit Umsatz im Zeitraum.',
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
       count(DISTINCT u.geschaeftstag) FILTER (WHERE u.umsatz_netto > 0) AS "Tage mit Daten",
       round(sum(u.umsatz_netto), 0)                    AS "Umsatz",
       sum(u.gaeste)                                    AS "Gäste",
       sum(u.rechnungen)                                AS "Rechnungen",
       round(sum(u.umsatz_netto) / nullif(sum(u.rechnungen), 0), 2) AS "Ø Bon",
       round(sum(u.umsatz_netto) / nullif(sum(u.gaeste), 0), 2)     AS "Ø je Gast",
       count(DISTINCT u.betrieb) FILTER (WHERE u.umsatz_netto > 0)  AS "Betriebe"
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
      'Beide Zeiträume übereinandergelegt: erster Tag gegen ersten Tag, zweiter gegen zweiten. So lassen sich auch unterschiedlich lange Zeiträume vergleichen.',
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
    name: 'Standorte über alle Kennzahlen',
    beschreibung:
      'Die gewählten Betriebe nebeneinander, eine Zeile je Kennzahl. Ohne Auswahl stehen hier alle bewerteten Betriebe — oben im Filter die auswählen, die verglichen werden sollen.',
    anzeige: 'table',
    parameter: [P_MONAT, P_BETRIEB, P_MARKE],
    // Der Median wird EINMAL je Bereich gerechnet, nicht je Zeile: die
    // LATERAL-Fassung rechnete ihn fuer jede der ~800 Zeilen neu und
    // brauchte 8 Sekunden. Er laeuft absichtlich ueber ALLE operativen
    // Betriebe, unabhaengig vom Betriebs-/Markenfilter — "Δ zum Median
    // aller" verspricht genau das.
    sql: `${MONAT_CTE}
, med AS (
    SELECT x.bereich,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY x.wert)::numeric AS median
      FROM mart.ampel_bereich x, gewaehlt g
     WHERE x.monat = g.monat AND x.wert IS NOT NULL AND x.operativ
     GROUP BY x.bereich
)
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
  LEFT JOIN med ON med.bereich = a.bereich
 WHERE a.monat = g.monat
   AND a.wert IS NOT NULL
   AND (a.operativ [[ OR a.betrieb = {{betrieb}} ]])
   [[AND a.betrieb = {{betrieb}}]]
   [[AND a.konzept = {{marke}}]]
 ORDER BY a.reihenfolge, a.betrieb`,
  },
  {
    schluessel: 'vg_ort_umsatz',
    name: 'Standorte — Umsatzverlauf nebeneinander',
    beschreibung: 'Monatsumsatz der gewählten Betriebe auf einer Achse.',
    anzeige: 'line',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    sql: `
SELECT monat        AS "Monat",
       betrieb      AS "Betrieb",
       umsatz_monat AS "Umsatz"
  FROM mart.umsatz_ytd
 WHERE umsatz_monat > 0
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]
   [[AND {{zeitraum}}]]
 ORDER BY monat`,
    template_tag_dimension: { zeitraum: ['mart', 'umsatz_ytd', 'monat'] },
    visualisierung: {
      'graph.dimensions': ['Monat', 'Betrieb'],
      'graph.metrics': ['Umsatz'],
    },
  },
  {
    schluessel: 'vg_ort_profil',
    name: 'Standorte — Umsatzprofil über den Tag',
    beschreibung:
      'Der Tagesverlauf der gewählten Betriebe, jeweils als Anteil am eigenen Tagesumsatz. In Prozent, damit ein großes und ein kleines Haus vergleichbar bleiben.',
    anzeige: 'line',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    // Der Nenner MUSS im selben Zeitraum stehen wie der Zaehler.
    //
    // Bis zum 28.07.2026 holte eine LATERAL-Unterabfrage den Tagesumsatz
    // ueber die GESAMTE Historie. Mit einem Zeitraumfilter waere das
    // stillschweigend falsch geworden: der Zaehler haette sich auf drei
    // Monate verkleinert, der Nenner nicht, und die Anteile haetten sich
    // statt auf 100 % auf einen Bruchteil summiert -- ohne Fehlermeldung,
    // nur mit flacheren Kurven. Ein Feldfilter laesst sich in eine
    // Unterabfrage nicht einsetzen, deshalb rechnet jetzt ein Fenster
    // ueber genau die Zeilen, die der Filter uebrig laesst.
    sql: `
SELECT "Stunde", "Betrieb",
       round(100 * stunde_umsatz / nullif(gesamt, 0), 2) AS "Anteil %"
  FROM (
    -- Ohne Tabellenalias: Metabase baut die Klausel eines Feldfilters aus
    -- dem TABELLENNAMEN ("umsatz_stunde.geschaeftstag BETWEEN ..."), und
    -- mit einem Alias ist der Name dort nicht mehr gueltig.
    SELECT lpad(stunde::text, 2, '0') || ':00' AS "Stunde",
           betrieb                             AS "Betrieb",
           ((stunde + 16) % 24)                AS sortierung,
           sum(umsatz_netto)                   AS stunde_umsatz,
           sum(sum(umsatz_netto)) OVER (PARTITION BY betrieb) AS gesamt
      FROM mart.umsatz_stunde
     WHERE 1 = 1
       [[AND betrieb = {{betrieb}}]]
       [[AND konzept = {{marke}}]]
       [[AND {{zeitraum}}]]
     GROUP BY stunde, betrieb
  ) x
 ORDER BY sortierung`,
    template_tag_dimension: { zeitraum: ['mart', 'umsatz_stunde', 'geschaeftstag'] },
    visualisierung: {
      'graph.dimensions': ['Stunde', 'Betrieb'],
      'graph.metrics': ['Anteil %'],
    },
  },
  {
    schluessel: 'vg_ort_sparte',
    name: 'Standorte — Speisen- und Getränkeanteil',
    beschreibung:
      'Speisen- und Getränkeumsatz der 25 umsatzstärksten Betriebe. Der Getränkeanteil ist der größte Hebel für den Wareneinsatz an der Bar und erklärt oft, warum zwei Häuser derselben Marke verschiedene Quoten haben. Für einen echten Vergleich oben zwei bis vier Betriebe auswählen.',
    anzeige: 'row',
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
 ORDER BY sum(sp.umsatz_netto) DESC
 LIMIT 25`,
    visualisierung: {
      'graph.dimensions': ['Betrieb'],
      'graph.metrics': ['Speisen', 'Getränke'],
      'stackable.stack_type': 'stacked',
      'graph.x_axis.title_text': 'Umsatz netto (€)',
    },
  },
]
