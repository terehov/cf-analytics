// =====================================================================
// Karten fuer ⑫ Feiertage, Ferien, Wetter.
//
// DIE VIER REGELN, die jede Karte hier befolgt — sie stehen ausfuehrlich
// in docs/metabase.md und hier kurz, weil man sie beim Bauen der
// naechsten Karte braucht:
//
// 1. IMMER auf vergleichstage = 4 filtern. Das erledigt schon
//    mart.kalendertag_lage; wer eine Karte direkt auf
//    mart.vergleichstag_basis baut, muss es selbst tun.
//
// 2. DER NULLPUNKT LIEGT BEI -3,5 %, NICHT BEI 0. Ein einzelner Tag wird
//    gegen den MITTELWERT von vier Tagen gestellt, und bei rechtsschiefen
//    Tagesumsaetzen liegt der darueber. Jede Karte rechnet deshalb den
//    gewoehnlichen Tag UNTER DENSELBEN FILTERN mit und zeigt die
//    Differenz. Wer die rohen Prozente gegen null liest, haelt die halbe
//    Gruppe fuer schwach.
//
// 3. EIN MEDIAN LAESST SICH NICHT WEITER VERDICHTEN. Der Median einer
//    Marke ist nicht der Median der Betriebs-Mediane. Deshalb rechnet
//    hier JEDE Karte auf der TAGESEBENE (mart.kalendertag_lage,
//    mart.wettertag_lage) mit percentile_cont — und keine auf der
//    fertigen Sicht mart.kalendereffekt. Die ist der Drill-Down auf
//    Betriebsebene, nicht die Zwischenstufe.
//
// 4. DIE DREI EFFEKTE WERDEN NICHT ADDIERT. Ein Feiertag im Sommer ist
//    auch ein warmer Tag. Sie stehen nebeneinander, in eigenen Reitern,
//    und keine Karte summiert ueber Kategorien.
//
// ZUR ABDECKUNG, und das gehoert in jede Beschreibung: der Kalender deckt
// seit Migration 0084 alle Betriebe (die ohne gepflegten Standort ueber
// die bundesweiten Feiertage), das WETTER nur die mit Koordinate. Eine
// Wetterkachel zeigt also weniger Betriebe als die Feiertagskachel
// daneben. Welche fehlen: mart.kalender_fehlend. KEINE festen Zahlen in
// die Kartentexte — sie veralten still, und Eugene pflegt die Standorte
// nach.
//
// NAMENSNENNUNG: DWD-Daten sind unter GeoNutzV frei, aber nicht anonym.
// Der Satz steht in den Beschreibungen der drei Wetterkarten und in
// src/wetter/quelle.ts als HERKUNFT.
// =====================================================================
import type { Karte } from './typen'
import { P_BETRIEB, P_MARKE, P_ZEITRAUM } from './gemeinsam'

/** Woher die Fachbereichs-Beschreibung ihre Vorsicht nimmt. */
const NICHT_ADDIEREN =
  'Feiertag, Ferien und Wetter stehen nebeneinander und dürfen nicht zusammengezählt '
  + 'werden — ein Feiertag im Sommer ist auch ein warmer Tag.'

const NULLPUNKT =
  'Verglichen wird gegen einen gewöhnlichen Tag, nicht gegen null: ein einzelner Tag '
  + 'liegt fast immer etwas unter dem Durchschnitt seiner vier Vorgänger, ohne dass '
  + 'etwas schiefgelaufen wäre.'

const DWD = 'Wetterdaten: Deutscher Wetterdienst (DWD), bezogen über Bright Sky.'

const WETTER_ABDECKUNG =
  'Wetter gibt es nur für Betriebe mit hinterlegter Koordinate — das sind weniger als '
  + 'die Feiertagskacheln nebenan zeigen. Wer fehlt, steht in der Datenqualität.';

/**
 * Der gefilterte Tagesbestand plus der Nullpunkt, als Textbaustein.
 *
 * Beides in EINER CTE-Kette, damit der gewoehnliche Tag unter denselben
 * Filtern gerechnet wird wie die Kacheln daneben. Ein fest verdrahteter
 * Basiswert waere bei jedem Betriebsfilter falsch.
 */
const LAGE = `
WITH lage AS (
    SELECT l.*
      FROM mart.kalendertag_lage l
      LEFT JOIN mart.konzept_zuordnung z USING (betrieb_key)
     WHERE 1 = 1
       [[AND l.betrieb = {{betrieb}}]]
       [[AND z.hauptkonzept = {{marke}}]]
       [[AND {{zeitraum}}]]
), basis AS (
    -- ::numeric ist Pflicht, nicht Kosmetik. percentile_cont liefert
    -- double precision; ohne den Cast zieht die Subtraktion den bereits
    -- gecasteten Median wieder dorthin zurueck, und round(double, int)
    -- gibt es in Postgres nicht. Von metabase/karten.test.ts gefangen.
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct)::numeric AS wert
      FROM lage
     WHERE kategorie = 'brueckentag' AND auspraegung = 'gewoehnlicher Tag'
)`

const WETTERLAGE = `
WITH lage AS (
    SELECT w.*
      FROM mart.wettertag_lage w
      LEFT JOIN mart.konzept_zuordnung z USING (betrieb_key)
     WHERE 1 = 1
       [[AND w.betrieb = {{betrieb}}]]
       [[AND z.hauptkonzept = {{marke}}]]
       [[AND {{zeitraum}}]]
), basis AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct)::numeric AS wert
      FROM mart.kalendertag_lage l
      LEFT JOIN mart.konzept_zuordnung z USING (betrieb_key)
     WHERE l.kategorie = 'brueckentag' AND l.auspraegung = 'gewoehnlicher Tag'
       [[AND l.betrieb = {{betrieb}}]]
       [[AND z.hauptkonzept = {{marke}}]]
       [[AND {{zeitraum}}]]
)`

const DIM_KALENDER: Record<string, [string, string, string]> =
  { zeitraum: ['mart', 'kalendertag_lage', 'geschaeftstag'] }
const DIM_WETTER: Record<string, [string, string, string]> =
  { zeitraum: ['mart', 'wettertag_lage', 'geschaeftstag'] }

export const karten: Karte[] = [
  // -------------------------------------------------------------------
  // Reiter 1 — Feiertage
  // -------------------------------------------------------------------
  {
    schluessel: 'kw_kachel_bester_feiertag',
    name: 'Bester Feiertag',
    beschreibung:
      'Der Feiertag, an dem der Umsatz am deutlichsten über einem gewöhnlichen Tag lag. '
      + 'Gezählt werden nur Feiertage mit mindestens 20 sauber vergleichbaren Tagen — '
      + 'ein Feiertag, den drei Betriebe einmal erlebt haben, ist keine Aussage. '
      + NULLPUNKT,
    anzeige: 'scalar',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    sql: `${LAGE}
SELECT auspraegung || ': ' ||
       to_char(round(percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct)::numeric
                     - (SELECT wert FROM basis), 1), 'FM999D0') || ' Punkte'
         AS "Bester Feiertag"
  FROM lage
 WHERE kategorie = 'feiertag'
 GROUP BY auspraegung
HAVING count(*) >= 20
 ORDER BY percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct) DESC
 LIMIT 1`,
    template_tag_dimension: DIM_KALENDER,
  },
  {
    schluessel: 'kw_kachel_schlechtester',
    name: 'Schwächster Feiertag',
    beschreibung:
      'Das Gegenstück: der Feiertag, an dem am deutlichsten weniger hereinkommt als an '
      + 'einem gewöhnlichen Tag. Dieselbe Mindestzahl von 20 vergleichbaren Tagen. '
      + NULLPUNKT,
    anzeige: 'scalar',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    sql: `${LAGE}
SELECT auspraegung || ': ' ||
       to_char(round(percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct)::numeric
                     - (SELECT wert FROM basis), 1), 'FM999D0') || ' Punkte'
         AS "Schwächster Feiertag"
  FROM lage
 WHERE kategorie = 'feiertag'
 GROUP BY auspraegung
HAVING count(*) >= 20
 ORDER BY percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct) ASC
 LIMIT 1`,
    template_tag_dimension: DIM_KALENDER,
  },
  {
    schluessel: 'kw_feiertag_tabelle',
    name: 'Feiertage im Vergleich',
    beschreibung:
      'Jeder Feiertag mit seiner typischen Wirkung auf den Tagesumsatz, gemessen gegen '
      + 'die letzten vier gleichen Wochentage ohne Feiertag. Die mittlere Spalte ist die '
      + 'Zahl, auf die es ankommt. Das untere und obere Viertel daneben zeigen, wie weit '
      + 'die Betriebe auseinanderliegen — steht dort eine große Spanne, gilt der Mittelwert '
      + 'für keinen einzelnen Betrieb. ' + NICHT_ADDIEREN,
    anzeige: 'table',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    sql: `${LAGE}
SELECT auspraegung                                              AS "Feiertag",
       count(*)                                                 AS "Tage",
       count(DISTINCT betrieb_key)                              AS "Betriebe",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct)::numeric
             - (SELECT wert FROM basis), 1)                     AS "Gegen normalen Tag (Punkte)",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct)::numeric, 1)
                                                                AS "Abweichung %",
       round(percentile_cont(0.25) WITHIN GROUP (ORDER BY abweichung_pct)::numeric, 1)
                                                                AS "Unteres Viertel %",
       round(percentile_cont(0.75) WITHIN GROUP (ORDER BY abweichung_pct)::numeric, 1)
                                                                AS "Oberes Viertel %",
       max(geschaeftstag)                                       AS "Zuletzt"
  FROM lage
 WHERE kategorie = 'feiertag'
 GROUP BY auspraegung
 ORDER BY 4 DESC`,
    template_tag_dimension: DIM_KALENDER,
    visualisierung: {
      'table.column_formatting': [{
        columns: ['Gegen normalen Tag (Punkte)'], type: 'range',
        colors: ['#C64444', '#FFFFFF', '#3E8A5F'], min_type: 'custom', max_type: 'custom',
        min_value: -70, max_value: 70,
      }],
    },
  },
  {
    schluessel: 'kw_feiertag_marke',
    name: 'Feiertage nach Marke',
    beschreibung:
      'Derselbe Feiertagseffekt, aufgeteilt nach Marke — dieselbe Rechnung, aber je Marke '
      + 'auf Tagesebene neu gebildet und nicht aus den Betriebswerten gemittelt. Zeigt die '
      + 'sechs Feiertage mit der stärksten Wirkung.',
    anzeige: 'bar',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    sql: `
WITH lage AS (
    SELECT l.*, coalesce(z.hauptkonzept, 'ohne Marke') AS marke
      FROM mart.kalendertag_lage l
      LEFT JOIN mart.konzept_zuordnung z USING (betrieb_key)
     WHERE l.kategorie = 'feiertag'
       [[AND l.betrieb = {{betrieb}}]]
       [[AND z.hauptkonzept = {{marke}}]]
       [[AND {{zeitraum}}]]
), stark AS (
    SELECT auspraegung
      FROM lage GROUP BY auspraegung HAVING count(*) >= 20
     ORDER BY abs(percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct)) DESC
     LIMIT 6
)
SELECT l.auspraegung AS "Feiertag",
       l.marke       AS "Marke",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY l.abweichung_pct)::numeric, 1)
         AS "Abweichung %"
  FROM lage l JOIN stark s USING (auspraegung)
 GROUP BY 1, 2
HAVING count(*) >= 10
 ORDER BY 1, 2`,
    template_tag_dimension: DIM_KALENDER,
    visualisierung: {
      'graph.dimensions': ['Feiertag', 'Marke'],
      'graph.metrics': ['Abweichung %'],
      'graph.y_axis.title_text': 'Abweichung gegen Vergleichstage (%)',
    },
  },
  {
    schluessel: 'kw_naechste_feiertage',
    name: 'Was als Nächstes kommt',
    beschreibung:
      'Die Feiertage der nächsten 90 Tage, jeweils mit dem, was sie diesem Betrieb beim '
      + 'letzten Mal gebracht haben. Die einzige Kachel hier, die nach vorn schaut — '
      + 'gedacht für die Personal- und Warenplanung. Eine leere Spalte rechts heißt: '
      + 'diesen Feiertag gab es für diesen Betrieb noch nicht oft genug, um daraus etwas '
      + 'abzuleiten — nicht, dass er wirkungslos wäre.',
    anzeige: 'table',
    parameter: [P_BETRIEB, P_MARKE],
    sql: `
SELECT f.datum              AS "Datum",
       f.wochentag          AS "Wochentag",
       f.feiertag           AS "Feiertag",
       f.betrieb            AS "Betrieb",
       f.in_tagen           AS "In Tagen",
       f.bisherige_termine  AS "Bisher erlebt",
       f.median_bisher_pct  AS "Beim letzten Mal (%)"
  FROM mart.feiertag_kalender f
  LEFT JOIN mart.konzept_zuordnung z USING (betrieb_key)
 WHERE 1 = 1
   [[AND f.betrieb = {{betrieb}}]]
   [[AND z.hauptkonzept = {{marke}}]]
 ORDER BY f.datum, f.betrieb
 LIMIT 500`,
  },

  // -------------------------------------------------------------------
  // Reiter 2 — Ferien & Wochentage
  // -------------------------------------------------------------------
  {
    schluessel: 'kw_ferien_lage',
    name: 'Schulferien',
    beschreibung:
      'Was passiert, wenn ein Tag in den Ferien liegt und seine Vergleichstage nicht — '
      + 'oder umgekehrt. Über die ganze Gruppe gemittelt ist der Effekt klein; '
      + 'interessant wird er je Betrieb, weil ein Stadtbetrieb im Pendlergeschäft und ein '
      + 'Ausflugslokal hier mit umgekehrten Vorzeichen liegen. '
      + '„Gemischt" heißt: ein bis drei der vier Vergleichstage lagen anders.',
    anzeige: 'bar',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    sql: `${LAGE}
SELECT auspraegung AS "Ferienlage",
       count(*)    AS "Tage",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct)::numeric
             - (SELECT wert FROM basis), 1) AS "Gegen normalen Tag (Punkte)"
  FROM lage
 WHERE kategorie = 'ferienlage'
 GROUP BY auspraegung
 ORDER BY 3 DESC`,
    template_tag_dimension: DIM_KALENDER,
    visualisierung: {
      'graph.dimensions': ['Ferienlage'],
      'graph.metrics': ['Gegen normalen Tag (Punkte)'],
      'graph.y_axis.title_text': 'Punkte gegen einen normalen Tag',
    },
  },
  {
    schluessel: 'kw_ferien_bundesland',
    name: 'Ferien nach Bundesland',
    beschreibung:
      'Dieselbe Frage je Bundesland — Ferientermine sind Ländersache, und ein Betrieb in '
      + 'Bayern erlebt sie sechs Wochen versetzt zu einem in Bremen. Betriebe ohne '
      + 'hinterlegten Standort fehlen hier: ohne Bundesland gibt es keine Ferienangabe.',
    anzeige: 'bar',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    sql: `${LAGE}
SELECT coalesce(bundesland, 'ohne Standort') AS "Bundesland",
       count(*)                              AS "Tage",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct)::numeric
             - (SELECT wert FROM basis), 1)  AS "Gegen normalen Tag (Punkte)"
  FROM lage
 WHERE kategorie = 'ferienlage'
   AND auspraegung = 'Tag in den Ferien, Vergleichstage nicht'
 GROUP BY 1
HAVING count(*) >= 30
 ORDER BY 3 DESC`,
    template_tag_dimension: DIM_KALENDER,
    visualisierung: {
      'graph.dimensions': ['Bundesland'],
      'graph.metrics': ['Gegen normalen Tag (Punkte)'],
      'graph.y_axis.title_text': 'Punkte gegen einen normalen Tag',
    },
  },
  {
    schluessel: 'kw_wochentag',
    name: 'Wochentage — der Maßstab',
    beschreibung:
      'Diese Kachel misst absichtlich fast nichts, und genau das ist ihr Zweck. Jeder Tag '
      + 'wird ohnehin schon gegen dieselben vier Wochentage verglichen — der '
      + 'Wochentagseffekt ist damit bereits herausgerechnet. Die Balken zeigen also, wie '
      + 'ein Nicht-Effekt in diesen Kacheln aussieht. Wer daneben einen Feiertag mit '
      + 'sechzig Punkten sieht, weiß, dass die Zahl etwas bedeutet. '
      + 'Was hier NICHT steht: welcher Wochentag stark ist — das steht im Umsatzdashboard.',
    anzeige: 'row',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    sql: `${LAGE}
SELECT auspraegung AS "Wochentag",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct)::numeric
             - (SELECT wert FROM basis), 1) AS "Gegen normalen Tag (Punkte)"
  FROM lage
 WHERE kategorie = 'wochentag'
 GROUP BY auspraegung
 ORDER BY 2 DESC`,
    template_tag_dimension: DIM_KALENDER,
    visualisierung: {
      'graph.dimensions': ['Wochentag'],
      'graph.metrics': ['Gegen normalen Tag (Punkte)'],
    },
  },
  {
    schluessel: 'kw_brueckentag',
    name: 'Der Abend davor, der Tag danach',
    beschreibung:
      'Der Tag VOR einem Feiertag ist ein eigenes Geschäft — gemessen bringt er mehr als '
      + 'die Hälfte der Feiertage selbst. Der Tag danach kostet. Die Zeile „gewöhnlicher '
      + 'Tag" ist der Nullpunkt, gegen den alle anderen Kacheln dieses Dashboards gelesen '
      + 'werden: sie steht per Definition auf null.',
    anzeige: 'bar',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    sql: `${LAGE}
SELECT auspraegung AS "Lage",
       count(*)    AS "Tage",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct)::numeric
             - (SELECT wert FROM basis), 1) AS "Gegen normalen Tag (Punkte)"
  FROM lage
 WHERE kategorie = 'brueckentag'
 GROUP BY auspraegung
 ORDER BY 3 DESC`,
    template_tag_dimension: DIM_KALENDER,
    visualisierung: {
      'graph.dimensions': ['Lage'],
      'graph.metrics': ['Gegen normalen Tag (Punkte)'],
      'graph.y_axis.title_text': 'Punkte gegen einen normalen Tag',
    },
  },

  // -------------------------------------------------------------------
  // Reiter 3 — Wetter
  // -------------------------------------------------------------------
  {
    schluessel: 'kw_temperatur',
    name: 'Temperatur',
    beschreibung:
      'Höchsttemperatur zwischen 8 und 24 Uhr, gegen den Umsatz. Der Zusammenhang ist '
      + 'kein Anstieg: die besten Tage liegen zwischen 22 und 28 Grad, darüber fällt der '
      + 'Umsatz wieder — Hitze kostet. Weil jeder Tag gegen dieselben vier Wochentage '
      + 'kurz zuvor gemessen wird, steckt hier nicht die Jahreszeit drin, sondern das '
      + 'Wetter gegenüber dem, was in diesen Wochen normal war. '
      + WETTER_ABDECKUNG + ' ' + DWD,
    anzeige: 'bar',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    sql: `${WETTERLAGE}
SELECT klasse   AS "Temperatur",
       count(*) AS "Tage",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct)::numeric
             - (SELECT wert FROM basis), 1) AS "Gegen normalen Tag (Punkte)"
  FROM lage
 WHERE kategorie = 'temperatur'
 GROUP BY klasse, reihenfolge
 ORDER BY reihenfolge`,
    template_tag_dimension: DIM_WETTER,
    visualisierung: {
      'graph.dimensions': ['Temperatur'],
      'graph.metrics': ['Gegen normalen Tag (Punkte)'],
      'graph.y_axis.title_text': 'Punkte gegen einen normalen Tag',
    },
  },
  {
    schluessel: 'kw_regen',
    name: 'Niederschlag',
    beschreibung:
      'Regenmenge zwischen 8 und 24 Uhr. „Trocken" heißt: keine messbare Menge. '
      + WETTER_ABDECKUNG + ' ' + DWD,
    anzeige: 'bar',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    sql: `${WETTERLAGE}
SELECT klasse   AS "Niederschlag",
       count(*) AS "Tage",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct)::numeric
             - (SELECT wert FROM basis), 1) AS "Gegen normalen Tag (Punkte)"
  FROM lage
 WHERE kategorie = 'niederschlag'
 GROUP BY klasse, reihenfolge
 ORDER BY reihenfolge`,
    template_tag_dimension: DIM_WETTER,
    visualisierung: {
      'graph.dimensions': ['Niederschlag'],
      'graph.metrics': ['Gegen normalen Tag (Punkte)'],
      'graph.y_axis.title_text': 'Punkte gegen einen normalen Tag',
    },
  },
  {
    schluessel: 'kw_sonne',
    name: 'Sonne — mehr oder weniger als üblich',
    beschreibung:
      'Sonnenschein im Vergleich zu den letzten vier Wochen am selben Ort, nicht als '
      + 'absoluter Wert. Das ist Absicht: im Winter ist zwischen 8 und 24 Uhr die Hälfte '
      + 'der Zeit dunkel, ein absoluter Sonnenanteil würde dort schlicht den Januar '
      + 'messen. Die beiden äußeren Balken sind belastbar, die drei mittleren liegen im '
      + 'Rauschen. ' + WETTER_ABDECKUNG + ' ' + DWD,
    anzeige: 'bar',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    sql: `${WETTERLAGE}
SELECT klasse   AS "Sonne",
       count(*) AS "Tage",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct)::numeric
             - (SELECT wert FROM basis), 1) AS "Gegen normalen Tag (Punkte)"
  FROM lage
 WHERE kategorie = 'sonne'
 GROUP BY klasse, reihenfolge
 ORDER BY reihenfolge`,
    template_tag_dimension: DIM_WETTER,
    visualisierung: {
      'graph.dimensions': ['Sonne'],
      'graph.metrics': ['Gegen normalen Tag (Punkte)'],
      'graph.y_axis.title_text': 'Punkte gegen einen normalen Tag',
    },
  },
  {
    schluessel: 'kw_streuung',
    name: 'Jeder einzelne Tag',
    beschreibung:
      'Ein Punkt je Betrieb und Tag: Höchsttemperatur gegen die Umsatzabweichung. Die '
      + 'Kachel darüber zeigt den typischen Fall, diese hier die Streuung dahinter — und '
      + 'die ist groß. Wer aus einem einzelnen warmen Tag etwas ableiten will, sieht hier, '
      + 'warum das nicht geht. Auf die letzten 3.000 Tage begrenzt, damit die Kachel lädt. '
      + DWD,
    anzeige: 'scatter',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    sql: `
SELECT round(w.fenster_temp_max, 1) AS "Temperatur °C",
       round(w.abweichung_pct, 1)   AS "Abweichung %",
       w.betrieb                    AS "Betrieb"
  FROM mart.wettertag_lage w
  LEFT JOIN mart.konzept_zuordnung z USING (betrieb_key)
 WHERE w.kategorie = 'temperatur'
   [[AND w.betrieb = {{betrieb}}]]
   [[AND z.hauptkonzept = {{marke}}]]
   [[AND {{zeitraum}}]]
 ORDER BY w.geschaeftstag DESC
 LIMIT 3000`,
    template_tag_dimension: DIM_WETTER,
    visualisierung: {
      'graph.dimensions': ['Temperatur °C'],
      'graph.metrics': ['Abweichung %'],
      'graph.x_axis.title_text': 'Höchsttemperatur 8–24 Uhr (°C)',
      'graph.y_axis.title_text': 'Abweichung gegen Vergleichstage (%)',
    },
  },

  // -------------------------------------------------------------------
  // Reiter 4 — Tagesliste. Das Ziel jedes Klicks von oben.
  // -------------------------------------------------------------------
  {
    schluessel: 'kw_tagesliste',
    name: 'Tagesliste',
    beschreibung:
      'Jeder einzelne Tag mit allem, was ihn erklärt: Wochentag, Feiertag, Ferienlage, '
      + 'Wetter, Umsatz und der Vergleichswert aus den letzten vier gleichen Wochentagen. '
      + 'Steht bei „Vergleichstage" eine Null, gab es keinen vergleichbaren Vortag — meist '
      + 'ein Ruhetag. Leere Wetterspalten heißen: für diesen Betrieb ist keine Koordinate '
      + 'hinterlegt, oder der Wetterabruf ist für diesen Tag noch nicht durch.',
    anzeige: 'table',
    parameter: [P_BETRIEB, P_MARKE, P_ZEITRAUM],
    sql: `
SELECT v.geschaeftstag     AS "Tag",
       v.betrieb           AS "Betrieb",
       v.wochentag         AS "Wochentag",
       v.feiertag          AS "Feiertag",
       v.schulferien       AS "Schulferien",
       CASE WHEN v.vortag_feiertag   THEN 'nach Feiertag'
            WHEN v.folgetag_feiertag THEN 'vor Feiertag' END AS "Brückenlage",
       v.temp_max          AS "Temperatur °C",
       v.niederschlag      AS "Regen mm",
       v.sonne_pct         AS "Sonne %",
       round(v.umsatz_netto)     AS "Umsatz €",
       round(v.umsatz_vergleich) AS "Vergleich €",
       v.abweichung_pct    AS "Abweichung %",
       v.vergleichstage    AS "Vergleichstage"
  FROM mart.vergleichstag v
  LEFT JOIN mart.konzept_zuordnung z USING (betrieb_key)
 WHERE 1 = 1
   [[AND v.betrieb = {{betrieb}}]]
   [[AND z.hauptkonzept = {{marke}}]]
   [[AND {{zeitraum}}]]
 ORDER BY v.geschaeftstag DESC, v.betrieb
 LIMIT 2000`,
    template_tag_dimension: { zeitraum: ['mart', 'vergleichstag_basis', 'geschaeftstag'] },
    visualisierung: {
      'table.column_formatting': [{
        columns: ['Abweichung %'], type: 'range',
        colors: ['#C64444', '#FFFFFF', '#3E8A5F'], min_type: 'custom', max_type: 'custom',
        min_value: -50, max_value: 50,
      }],
    },
  },

  // -------------------------------------------------------------------
  // Zwei Karten fuer bestehende Dashboards
  // -------------------------------------------------------------------
  {
    schluessel: 'kw_kachel_feiertagseffekt',
    name: 'Spannweite der Feiertage',
    beschreibung:
      'Wie weit der beste und der schwächste Feiertag auseinanderliegen. Ein Betrieb, der '
      + 'Christi Himmelfahrt mit einem gewöhnlichen Donnerstag vergleicht, sieht ein '
      + 'Wunder; an Neujahr sieht er eine Katastrophe. Beides ist der Kalender. Klick '
      + 'führt zur vollständigen Auswertung.',
    anzeige: 'scalar',
    parameter: [P_BETRIEB, P_MARKE],
    sql: `
WITH je_feiertag AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY l.abweichung_pct) AS m
      FROM mart.kalendertag_lage l
      LEFT JOIN mart.konzept_zuordnung z USING (betrieb_key)
     WHERE l.kategorie = 'feiertag'
       [[AND l.betrieb = {{betrieb}}]]
       [[AND z.hauptkonzept = {{marke}}]]
     GROUP BY l.auspraegung
    HAVING count(*) >= 20
)
SELECT round(max(m)::numeric - min(m)::numeric, 0) AS "Spannweite in Punkten"
  FROM je_feiertag`,
  },
  {
    schluessel: 'kw_ohne_kalender',
    name: 'Betriebe ohne Kalender und Wetter',
    beschreibung:
      'Betriebe mit laufendem Umsatz, für die kein Standort hinterlegt ist. Sie bekommen '
      + 'die bundesweiten Feiertage, aber keine Schulferien und kein Wetter — jede '
      + 'Wetterkachel zeigt also weniger als die ganze Gruppe. Sortiert nach Umsatz, damit '
      + 'der teuerste Fall oben steht. Erledigt sich durch Nachtragen der Adresse; die '
      + 'Auswertungen wachsen dann von selbst mit.',
    anzeige: 'table',
    sql: `
SELECT betrieb                  AS "Betrieb",
       grund                    AS "Was fehlt",
       letzter_umsatztag        AS "Zuletzt Umsatz",
       round(umsatz_2026)       AS "Umsatz 2026 €"
  FROM mart.kalender_fehlend
 ORDER BY umsatz_2026 DESC NULLS LAST`,
  },
]
