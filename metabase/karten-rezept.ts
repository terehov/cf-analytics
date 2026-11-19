// =====================================================================
// Rezepturen — welche Kassenartikel ein Rezept tragen (Migration 0155).
//
// Die Bruecke Kasse → Rezept: je Kassenanbindung (Bar, Kueche) fuehrt
// FoodNotify die Kassenartikel und das zugeordnete Rezept. Verbunden mit
// dem LINA-Artikelverkauf ergibt das die Leitzahl dieser Seite: welcher
// Anteil des Artikelumsatzes auf Artikel mit Rezept faellt.
//
// DREI REGELN, DIE JEDE KARTE HIER BEFOLGT
//
//   1. DIE ZAHL IST EINE REICHWEITE, KEIN WARENEINSATZ. Sie sagt, wie weit
//      eine Rezeptkalkulation reichen koennte — nicht, was die Ware gekostet
//      hat, und nicht, ob das Rezept stimmt (Fallstrick
//      pos_artikel_kein_wareneinsatz). Das steht in jeder Beschreibung, in
//      der die Prozentzahl vorkommt.
//
//   2. JE BETRIEB, NICHT JE ANBINDUNG. Ein Betrieb hat oft zwei Anbindungen,
//      und ihre Artikellisten ueberschneiden sich. Ein Artikel gilt als „mit
//      Rezept", wenn er in IRGENDEINER Anbindung des Betriebs eins traegt —
//      so rechnet mart.pos_artikel_abdeckung_betrieb. Die Anbindungssicht
//      steht nur auf der Importseite (Zustand), wo die Anbindung die Sache ist.
//
//   3. DER ZEITRAUM IST FEST: die letzten drei VOLLEN Monate, gerechnet in
//      der Sicht. Kein Zeitraumfilter, aus demselben Grund wie bei den
//      Pflichtartikeln: ein freier Filter darueber koennte nur einen
//      laufenden Monat dazumischen, der die Wochentage ungleich gewichtet.
//
// WARUM EINE EIGENE SEITE und kein Abschnitt auf db_ware: dort heisst
// „Abdeckung" bereits etwas anderes (der Anteil mit LINA-Wareneinsatzwert,
// fixer_we — AGENTS.md Regel 5). Zwei verschiedene Abdeckungen auf einer
// Seite wuerden verwechselt. Und db_ware filtert ueber einen Zeitraum, den
// keine dieser Karten lesen kann (Regel 3) — die Seite antwortete halb.
//
// MARKE: die Sichten fuehren den FoodNotify-Schluessel ('wilma_wunder'). Der
// Filter traegt das Round-Table-Hauptkonzept; verbunden wird ueber den
// Betriebsschluessel in mart.konzept_zuordnung, nie ueber einen Namen.
// =====================================================================

import type { Karte } from './typen'
import { P_ARTIKEL, P_BETRIEB, P_MARKE } from './gemeinsam'

const MARKE = P_MARKE
const BETRIEB = P_BETRIEB

const PROZENT = { suffix: ' %' }
const EURO = { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 }

/** Marke und Betrieb, fuer jede Sicht mit betrieb_key und betrieb. */
const FILTER = (alias = '') => `
   [[AND ${alias}betrieb = {{betrieb}}]]
   [[AND ${alias}betrieb_key IN (SELECT betrieb_key FROM mart.konzept_zuordnung
                                 WHERE hauptkonzept = {{marke}})]]`

/**
 * Ausgewertet ist ein Betrieb, dessen Marke geholt wird UND von dem
 * mindestens eine Anbindung geladen ist. Alle anderen haben keine
 * Prozentzahl — nicht null Prozent.
 */
const AUSGEWERTET = `marke_aktiv AND anbindungen_geladen > 0`

export const karten: Karte[] = [

  // -------------------------------------------------------------------
  // Drei Kacheln: wie viel Umsatz mit Rezept, wie viel unbekannt, wie viele Betriebe
  // -------------------------------------------------------------------
  {
    /*
     * Aus den EURO-SUMMEN gerechnet, nie als Mittel der Betriebsprozente
     * (mcp.kennzahl: umsatz_rezept_pct nicht_aggregieren). Ein kleiner
     * Betrieb mit 90 % wiegt sonst so viel wie ein grosser mit 40 %.
     */
    schluessel: 'rz_umsatz_rezept',
    name: 'Umsatz mit Rezept',
    beschreibung:
      'Welcher Anteil des Artikelumsatzes der letzten drei vollen Monate auf Kassenartikel fällt, denen in FoodNotify ein Rezept zugeordnet ist — über alle ausgewerteten Betriebe zusammen, mit gewähltem Betrieb für diesen. Das ist die Reichweite einer Rezeptkalkulation, **kein Wareneinsatz**: ob das Rezept stimmt und was die Ware gekostet hat, sagt die Zahl nicht.',
    anzeige: 'scalar',
    parameter: [MARKE, BETRIEB],
    sql: `
SELECT round(100.0 * sum(umsatz_mit_rezept_3m) / nullif(sum(umsatz_netto_3m), 0), 1) AS "Umsatz mit Rezept (%)"
  FROM mart.pos_artikel_abdeckung_betrieb
 WHERE ${AUSGEWERTET}${FILTER()}`,
    visualisierung: { suffix: ' %' },
  },

  {
    /*
     * Die Gegenprobe der Bruecke als Zahl: welcher Umsatz hat in FoodNotify
     * gar keinen Kassenartikel mit dieser Nummer. Klein heisst, die PLU-
     * Bruecke traegt; gross heisst, entweder fehlt eine Anbindung (Kaffee an
     * der Bar, nur die Kueche geladen) oder der Nummernkreis passt nicht —
     * dann ist die Zahl links nicht zu glauben.
     */
    schluessel: 'rz_umsatz_unbekannt',
    name: 'Umsatz, den FoodNotify nicht kennt',
    beschreibung:
      'Der Anteil des Artikelumsatzes, dessen Artikelnummer in keiner Kassenanbindung von FoodNotify auftaucht. Er sollte klein sein. Ist er groß, fehlt meist eine Anbindung des Betriebs (etwa die Bar, wenn nur die Küche geladen ist) — dann ist auch der Anteil „mit Rezept" daneben zu niedrig, ohne dass ein Rezept fehlt.',
    anzeige: 'scalar',
    parameter: [MARKE, BETRIEB],
    sql: `
SELECT round(100.0 - 100.0 * sum(umsatz_im_feed_3m) / nullif(sum(umsatz_netto_3m), 0), 1) AS "nicht in FoodNotify (%)"
  FROM mart.pos_artikel_abdeckung_betrieb
 WHERE ${AUSGEWERTET}${FILTER()}`,
    visualisierung: { suffix: ' %' },
  },

  {
    schluessel: 'rz_betriebe',
    name: 'Betriebe ausgewertet',
    beschreibung:
      'Betriebe, deren Kassenartikel aus FoodNotify geladen sind, von allen Betrieben mit angebundener Kasse. Noch nicht jede Marke wird geholt; solche Betriebe stehen in der Tabelle unten mit „Marke noch nicht geholt" — dort gibt es keine Zahl, nicht null Prozent.',
    anzeige: 'scalar',
    parameter: [MARKE, BETRIEB],
    sql: `
SELECT count(*) FILTER (WHERE ${AUSGEWERTET}) || ' von ' || count(*) AS "Betriebe"
  FROM mart.pos_artikel_abdeckung_betrieb
 WHERE true${FILTER()}`,
  },

  // -------------------------------------------------------------------
  // Je Betrieb: Bild und Tabelle
  // -------------------------------------------------------------------
  {
    /*
     * row statt bar: Betriebsnamen sind lang. Gekappt auf 20 und nur
     * ausgewertete Betriebe (Visualisierungsregeln, docs/dashboards.md) —
     * die vollstaendige Liste mit allen Betrieben steht als Tabelle darunter.
     * Aufsteigend sortiert: oben steht, wo die meiste Pflegearbeit liegt.
     */
    schluessel: 'rz_betrieb_balken',
    name: 'Umsatzanteil mit Rezept je Betrieb',
    beschreibung:
      'Je Betrieb der Anteil des Artikelumsatzes der letzten drei vollen Monate, dessen Kassenartikel ein Rezept trägt — die niedrigsten oben, dort lohnt die Pflege am meisten. Höchstens 20 Betriebe; alle stehen in der Tabelle darunter. Eine Reichweite, kein Wareneinsatz.',
    anzeige: 'row',
    parameter: [MARKE, BETRIEB],
    sql: `
SELECT betrieb            AS "Betrieb",
       umsatz_rezept_pct  AS "Umsatz mit Rezept %"
  FROM mart.pos_artikel_abdeckung_betrieb
 WHERE ${AUSGEWERTET}
   AND umsatz_rezept_pct IS NOT NULL${FILTER()}
 ORDER BY umsatz_rezept_pct, betrieb
 LIMIT 20`,
    visualisierung: {
      'graph.dimensions': ['Betrieb'],
      'graph.metrics': ['Umsatz mit Rezept %'],
      'graph.y_axis.max': 100,
      'graph.x_axis.title_text': '',
      'graph.y_axis.title_text': 'Umsatz mit Rezept (%)',
    },
  },

  {
    /*
     * ALLE Betriebe mit angebundener Kasse, auch die nicht ausgewerteten —
     * mit einem Stand in Worten statt einer leeren Zahl. Eine Zeile ohne
     * Prozent ohne Begruendung liest sich als „null Prozent".
     */
    schluessel: 'rz_betrieb_tabelle',
    name: 'Rezeptabdeckung je Betrieb',
    beschreibung:
      'Alle Betriebe mit angebundener Kasse. „Umsatz mit Rezept" ist der Anteil des Artikelumsatzes, dessen Kassenartikel in Bar oder Küche ein Rezept trägt; „in FoodNotify" der Anteil, dessen Artikel FoodNotify überhaupt kennt — liegt er weit unter den anderen Betrieben, fehlt eine Anbindung, und der erste Wert ist zu niedrig. „Stand" sagt, warum ein Betrieb keine Zahl hat. Zeitraum sind die letzten drei vollen Monate (Spalten „von" und „bis"). Prozentwerte nicht über Betriebe mitteln: die Kachel oben rechnet aus den Euro-Summen.',
    anzeige: 'table',
    parameter: [MARKE, BETRIEB],
    sql: `
SELECT a.betrieb                                     AS "Betrieb",
       k.hauptkonzept                                AS "Marke",
       CASE WHEN NOT a.marke_aktiv THEN 'Marke noch nicht geholt'
            WHEN a.anbindungen_geladen = 0 THEN 'noch nicht geladen'
            WHEN a.anbindungen_geladen < a.anbindungen
              THEN a.anbindungen_geladen || ' von ' || a.anbindungen || ' Anbindungen geladen'
            ELSE 'vollständig' END                   AS "Stand",
       a.umsatz_rezept_pct                           AS "Umsatz mit Rezept %",
       a.umsatz_im_feed_pct                          AS "in FoodNotify %",
       round(a.umsatz_netto_3m)                      AS "Artikelumsatz",
       round(a.umsatz_mit_rezept_3m)                 AS "davon mit Rezept",
       a.artikel_verkauft                            AS "Artikel verkauft",
       a.artikel_verkauft_mit_rezept                 AS "davon mit Rezept (Anzahl)",
       a.umsatz_von                                  AS "von",
       a.umsatz_bis                                  AS "bis",
       a.aeltester_abruf_am::date                    AS "geladen am"
  FROM mart.pos_artikel_abdeckung_betrieb a
  LEFT JOIN mart.konzept_zuordnung k ON k.betrieb_key = a.betrieb_key
 WHERE true${FILTER('a.')}
 ORDER BY (a.marke_aktiv AND a.anbindungen_geladen > 0) DESC, a.umsatz_rezept_pct NULLS LAST, a.betrieb`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz mit Rezept %"]': PROZENT,
        '["name","in FoodNotify %"]': PROZENT,
        '["name","Artikelumsatz"]': EURO,
        '["name","davon mit Rezept"]': EURO,
      },
    },
  },

  // -------------------------------------------------------------------
  // Die Arbeitsliste und die Namensabweichungen
  // -------------------------------------------------------------------
  {
    /*
     * DIE ARBEITSLISTE FUER DEN FACHBEREICH. Eine Zeile je LINA-Artikel,
     * nicht je Betrieb: Rezepte gelten je Marke, angelegt wird ein Rezept
     * also einmal — zugeordnet aber je Kassenanbindung. Deshalb die beiden
     * Betriebszahlen und „Rezept anderswo": steht dort ein Rezept, gibt es
     * es schon, und es fehlt nur die Zuordnung in dieser Anbindung — die
     * billigste Arbeit auf der Seite.
     *
     * Derselbe Zeitraum und dieselbe Logik wie die Sicht (letzte drei volle
     * Monate, auch inzwischen gestrichene Kassenartikel zaehlen mit ihrer
     * damaligen Zuordnung), damit die Euro-Summe hier die Luecke in der
     * Tabelle oben erklaert. Nur ausgewertete Betriebe.
     *
     * Der Artikelname kommt aus dem Artikelverkauf, damit der Klick auf
     * dd_artikel dort genau diesen Namen findet.
     */
    schluessel: 'rz_ohne_rezept',
    name: 'Artikel ohne Rezept — nach Umsatz',
    beschreibung:
      'Die Arbeitsliste für die Rezepturpflege: verkaufte Artikel der letzten drei vollen Monate, die in mindestens einem ausgewerteten Betrieb kein Rezept tragen, nach dem Umsatz, der dort ohne Rezept läuft — oben lohnt die Pflege am meisten. „nicht in FoodNotify" heißt: FoodNotify kennt den Artikel in diesem Betrieb gar nicht — meist ist die zweite Anbindung (Bar oder Küche) noch nicht geladen, oder der Artikel stand nur auf einer Karte, die vor dem ersten Abruf schon gestrichen war. „ohne Rezept" heißt: FoodNotify kennt ihn, es ist nur keins zugeordnet. Steht unter „Rezept anderswo" ein Name, gibt es das Rezept schon in einem anderen Betrieb — dann fehlt nur die Zuordnung. Klick auf den Artikel öffnet ihn im Detail, mit dem Rezept je Betrieb.',
    anzeige: 'table',
    parameter: [MARKE, BETRIEB],
    sql: `
WITH z AS (
    SELECT (date_trunc('month', current_date) - interval '3 months')::date AS von,
           (date_trunc('month', current_date) - interval '1 day')::date    AS bis
), betriebe AS (
    SELECT betrieb_key
      FROM mart.pos_artikel_abdeckung_betrieb
     WHERE ${AUSGEWERTET}${FILTER()}
), umsatz AS (
    SELECT am.artikel_key, am.betrieb_key, max(am.artikel) AS artikel, sum(am.umsatz_netto) AS umsatz
      FROM mart.artikel_monat am
     CROSS JOIN z
     WHERE am.monat BETWEEN z.von AND z.bis
       AND am.artikel_key IS NOT NULL
       AND am.betrieb_key IN (SELECT betrieb_key FROM betriebe)
     GROUP BY am.artikel_key, am.betrieb_key
), kasse AS (
    SELECT betrieb_key, artikel_key, bool_or(hat_rezept) AS hat_rezept
      FROM mart.pos_artikel_rezept
     WHERE artikel_key IS NOT NULL
     GROUP BY betrieb_key, artikel_key
), anderswo AS (
    SELECT artikel_key, count(DISTINCT betrieb_key) AS betriebe, min(coalesce(rezept, rezept_titel)) AS rezept
      FROM mart.pos_artikel_rezept
     WHERE hat_rezept AND fehlt_seit IS NULL
     GROUP BY artikel_key
)
SELECT max(u.artikel)                                                     AS "Artikel",
       s.artikelnummer                                                    AS "Artikelnummer",
       round(sum(u.umsatz) FILTER (WHERE NOT coalesce(k.hat_rezept, false))) AS "Umsatz ohne Rezept",
       count(*) FILTER (WHERE k.artikel_key IS NOT NULL AND NOT k.hat_rezept) AS "Betriebe ohne Rezept",
       count(*) FILTER (WHERE k.artikel_key IS NULL)                      AS "Betriebe: nicht in FoodNotify",
       coalesce(a.betriebe, 0)                                            AS "Betriebe mit Rezept",
       a.rezept                                                           AS "Rezept anderswo"
  FROM umsatz u
  LEFT JOIN kasse k ON k.betrieb_key = u.betrieb_key AND k.artikel_key = u.artikel_key
  LEFT JOIN anderswo a ON a.artikel_key = u.artikel_key
  LEFT JOIN mart.artikel_stamm s ON s.artikel_key = u.artikel_key
 GROUP BY u.artikel_key, s.artikelnummer, a.betriebe, a.rezept
HAVING sum(u.umsatz) FILTER (WHERE NOT coalesce(k.hat_rezept, false)) > 0
 ORDER BY 3 DESC
 LIMIT 300`,
    visualisierung: {
      column_settings: { '["name","Umsatz ohne Rezept"]': EURO },
    },
  },

  {
    /*
     * FoodNotifys eigenes Kennzeichen hasLinkNameMismatch: Artikel- und
     * Rezeptname laufen auseinander. Kein Fehler, sondern ein Verdacht auf
     * eine falsche Zuordnung — und eine falsche Zuordnung ist schlimmer als
     * keine, weil sie in der Kachel oben als „mit Rezept" zaehlt.
     */
    schluessel: 'rz_name_weicht_ab',
    name: 'Rezept passt nicht zum Namen?',
    beschreibung:
      'Kassenartikel, bei denen FoodNotify selbst meldet, dass Artikel- und Rezeptname auseinanderlaufen — ein Hinweis auf eine falsche Zuordnung. Eine falsche Zuordnung zählt oben als „mit Rezept" und ist deshalb teurer als eine fehlende. Nur Artikel, die FoodNotify noch führt.',
    anzeige: 'table',
    parameter: [MARKE, BETRIEB],
    sql: `
SELECT betrieb                                  AS "Betrieb",
       kostenstelle                             AS "Anbindung",
       kassenartikel                            AS "Kassenartikel",
       plu                                      AS "PLU",
       coalesce(rezept, rezept_titel)           AS "zugeordnetes Rezept",
       rezept_fn_id                             AS "Rezept-Nr.",
       geaendert_am::date                       AS "zuletzt geändert"
  FROM mart.pos_artikel_rezept
 WHERE name_weicht_ab
   AND fehlt_seit IS NULL${FILTER()}
 ORDER BY betrieb, kostenstelle, kassenartikel
 LIMIT 500`,
  },

  // -------------------------------------------------------------------
  // Auf dd_artikel: welches Rezept steckt hinter diesem Artikel?
  // -------------------------------------------------------------------
  {
    /*
     * Der Drill-Down „welches Rezept steckt hinter Kassenartikel X". Je
     * Betrieb UND Anbindung eine Zeile: Bar und Kueche koennen demselben
     * Artikel verschiedene Rezepte zuordnen (Fallstrick
     * pos_artikel_zwei_anbindungen) — genau das soll hier sichtbar sein,
     * nicht zusammengefasst.
     *
     * Der Artikel kommt als NAME aus dem Artikelverkauf (F_ARTIKEL). Die
     * Bruecke laeuft ueber artikel_key: Kassenartikel mit diesem Namen in
     * mart.artikel_monat (Index auf artikel), nicht ueber den Kassennamen in
     * FoodNotify — der ist dort oft anders geschrieben.
     */
    schluessel: 'ar_rezept',
    name: 'Rezept hinter diesem Artikel',
    beschreibung:
      'Je Betrieb und Kassenanbindung (Bar, Küche): welches Rezept FoodNotify diesem Kassenartikel zuordnet. Bar und Küche können verschiedene Rezepte zuordnen oder nur eine von beiden — beides steht hier nebeneinander. „kein Rezept" ist eine Pflegelücke, kein technischer Fehler. „nicht mehr geführt" heißt: FoodNotify kennt den Artikel in dieser Anbindung nicht mehr; die Zuordnung galt für ältere Verkäufe. Noch nicht jede Marke wird geholt. Ohne gewählten Artikel stehen hier die zuletzt geänderten Zuordnungen.',
    anzeige: 'table',
    parameter: [P_ARTIKEL, MARKE, BETRIEB],
    sql: `
SELECT betrieb                                         AS "Betrieb",
       kostenstelle                                    AS "Anbindung",
       kassenartikel                                   AS "Kassenartikel",
       plu                                             AS "PLU",
       CASE WHEN hat_rezept THEN coalesce(rezept, rezept_titel)
            WHEN ist_ignoriert THEN '— wird nicht verbucht'
            ELSE '— kein Rezept' END                   AS "Rezept",
       rezept_fn_id                                    AS "Rezept-Nr.",
       concat_ws(', ',
         CASE WHEN name_weicht_ab THEN 'Name weicht ab' END,
         CASE WHEN fehlt_seit IS NOT NULL THEN 'nicht mehr geführt' END,
         CASE WHEN rezept_archiviert THEN 'Rezept archiviert' END) AS "Hinweis",
       rezept_zutaten_geholt_am::date                  AS "Zutaten gelesen am",
       geaendert_am::date                              AS "Zuordnung geändert"
  FROM mart.pos_artikel_rezept
 WHERE artikel_key IS NOT NULL
   [[AND artikel_key IN (SELECT artikel_key FROM mart.artikel_monat WHERE artikel = {{artikel}})]]${FILTER()}
 ORDER BY geaendert_am DESC, betrieb, kostenstelle
 LIMIT 300`,
  },
]
