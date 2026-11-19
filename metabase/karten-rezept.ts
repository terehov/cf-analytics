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
// SOLL-VERBRAUCH (0159, Abschnitt am Ende, Karten sv_*). Verkauf × Rezept:
// wie viel einer Ware ein Betrieb laut Rezept verbraucht haben muesste. Drei
// weitere Regeln gelten nur dort:
//
//   4. JEDE SOLL-ZAHL HAT IHRE ABDECKUNG DANEBEN. Das Soll umfasst nur
//      Artikel mit zugeordnetem UND umrechenbarem Rezept — eine
//      Untergrenze (Fallstrick soll_verbrauch_untergrenze). Kachel, Balken
//      und Tabellen zeigen sie; keine Karte teilt einen Soll-Wert durch den
//      Gesamtumsatz (das waere eine Wareneinsatzquote aus dem falschen
//      Nenner).
//
//   5. EINKAUF IST NICHT VERBRAUCH. Die Soll-Ist-Tabelle stellt nebeneinander,
//      sie urteilt nicht: keine Spalte „Schwund", keine Farbe fuer „zu viel"
//      (Fallstrick soll_ist_kein_schwund).
//
//   6. DERSELBE FESTE ZEITRAUM WIE OBEN: die letzten drei vollen Monate
//      (Regel 3), summiert. Ein waehlbarer Monat ging nicht: uebernehmen.ts
//      verlangt, dass ein Seitenfilter auf alle Karten wirkt, und die
//      rz_*-Karten rechnen fest — sieben Ausnahmen haetten genau die Pruefung
//      ausgehoehlt, die halb antwortende Seiten verhindert. Fuer Soll gegen
//      Einkauf sind drei Monate ohnehin richtiger als einer: das Lager
//      verschiebt Einkauf und Verbrauch gegeneinander. Einzelne Monate und
//      Tage beantwortet der MCP-Zugang (mart.soll_verbrauch_monat/_tag).
//
// MARKE: die Sichten fuehren den FoodNotify-Schluessel ('wilma_wunder'). Der
// Filter traegt das Round-Table-Hauptkonzept; verbunden wird ueber den
// Betriebsschluessel in mart.konzept_zuordnung, nie ueber einen Namen.
// =====================================================================

import type { Karte } from './typen'
import { P_ARTIKEL, P_BETRIEB, P_MARKE, P_REZEPT } from './gemeinsam'

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

/** Die letzten drei vollen Monate, auf der Monatsspalte (Regel 6). */
const DREI_MONATE = `monat >= (date_trunc('month', current_date) - interval '3 months')::date
   AND monat < date_trunc('month', current_date)::date`

/** soll_zustand in Worten fuer den Fachbereich. */
const ZUSTAND_TEXT = (spalte: string) => `CASE ${spalte}
         WHEN 'vollstaendig'         THEN 'vollständig'
         WHEN 'teilweise'            THEN 'teilweise (Teil der Zutaten ohne Menge)'
         WHEN 'nicht umrechenbar'    THEN 'nein — Mengen nicht umrechenbar'
         WHEN 'rezept ohne zutaten'  THEN 'nein — Rezept ohne Zutaten'
         WHEN 'rezept nicht geladen' THEN 'nein — Rezept noch nicht geladen'
         ELSE 'nein — kein Rezept' END`

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

  // -------------------------------------------------------------------
  // Soll-Verbrauch (0159): Verkauf × Rezept, die letzten drei vollen Monate
  // -------------------------------------------------------------------
  {
    /*
     * Aus den Euro-Summen, nie als Mittel der Betriebsprozente
     * (abdeckung_umsatz_pct nicht_aggregieren). Nur Betriebe mit
     * zustand = 'ok': bei nicht geladener Kassenzuordnung waere 0 % keine
     * Aussage ueber die Rezepte.
     */
    schluessel: 'sv_abdeckung',
    name: 'Verkauf im Soll-Verbrauch',
    beschreibung:
      'Welcher Anteil des Artikelumsatzes der letzten drei vollen Monate in den Soll-Verbrauch eingeht: Artikel, deren Rezept zugeordnet ist und sich vollständig in Mengen umrechnen lässt. Nur dieser Teil des Verkaufs steckt in den Soll-Mengen darunter — **sie sind deshalb eine Untergrenze, nie der ganze Verbrauch.**',
    anzeige: 'scalar',
    parameter: [MARKE, BETRIEB],
    sql: `
SELECT round(100.0 * sum(umsatz_vollstaendig) / nullif(sum(umsatz_netto), 0), 1) AS "Verkauf im Soll-Verbrauch (%)"
  FROM mart.soll_verbrauch_abdeckung
 WHERE zustand = 'ok'
   AND ${DREI_MONATE}${FILTER()}`,
    visualisierung: { suffix: ' %' },
  },

  {
    schluessel: 'sv_betriebe',
    name: 'Betriebe mit Soll-Verbrauch',
    beschreibung:
      'Betriebe, deren Kassenzuordnung aus FoodNotify geladen ist, von allen Betrieben mit angebundener Kasse und Verkauf in den letzten drei vollen Monaten. Die übrigen haben keinen Soll-Verbrauch — nicht null.',
    anzeige: 'scalar',
    parameter: [MARKE, BETRIEB],
    sql: `
SELECT count(DISTINCT betrieb_key) FILTER (WHERE zustand = 'ok') || ' von ' || count(DISTINCT betrieb_key) AS "Betriebe"
  FROM mart.soll_verbrauch_abdeckung
 WHERE ${DREI_MONATE}${FILTER()}`,
  },

  {
    /*
     * Gestapelter Balken mit Anteilen, die je Betrieb 100 ergeben: die Frage
     * ist die Zusammensetzung ("wie viel geht ein, woran scheitert der
     * Rest"), nicht die Groesse — deshalb Prozent statt Euro, und row statt
     * bar wegen der langen Betriebsnamen. Die Anteile rechnet die Abfrage
     * selbst aus den Euro-Summen, statt Metabases normalized-Stapel: so
     * stehen dieselben Zahlen im Tooltip wie in der Tabelle darunter.
     * Gekappt auf 20, die niedrigste Abdeckung oben (docs/dashboards.md).
     */
    schluessel: 'sv_abdeckung_balken',
    name: 'Was in den Soll-Verbrauch eingeht — je Betrieb',
    beschreibung:
      'Je Betrieb, wie sich der Artikelumsatz der letzten drei vollen Monate aufteilt: „vollständig" geht ganz in den Soll-Verbrauch ein, „teilweise" nur mit den Zutaten, deren Menge sich umrechnen lässt, „Rezept ohne Menge" gar nicht (Einheiten wie „Portionierer" oder „Stück" eines Halbfabrikats, Rezept ohne Zutaten), „kein Rezept" ebenfalls nicht. Die niedrigste Abdeckung oben, höchstens 20 Betriebe; alle stehen in der Tabelle darunter.',
    anzeige: 'row',
    parameter: [MARKE, BETRIEB],
    sql: `
WITH a AS (
    SELECT betrieb_key, betrieb,
           sum(umsatz_netto)        AS umsatz_netto,
           sum(umsatz_vollstaendig) AS vollstaendig,
           sum(umsatz_teilweise)    AS teilweise,
           sum(umsatz_nicht_umrechenbar + umsatz_rezept_ohne_zutaten + umsatz_rezept_nicht_geladen) AS ohne_menge,
           sum(umsatz_kein_rezept)  AS kein_rezept
      FROM mart.soll_verbrauch_abdeckung
     WHERE zustand = 'ok'
       AND ${DREI_MONATE}${FILTER()}
     GROUP BY betrieb_key, betrieb
), auswahl AS (
    SELECT betrieb_key, vollstaendig / nullif(umsatz_netto, 0) AS anteil
      FROM a ORDER BY 2 NULLS LAST, betrieb_key LIMIT 20
)
SELECT a.betrieb                                            AS "Betrieb",
       t.teil                                               AS "Anteil",
       round(100.0 * t.umsatz / nullif(a.umsatz_netto, 0), 1) AS "Umsatz %"
  FROM a
  JOIN auswahl w USING (betrieb_key)
 CROSS JOIN LATERAL (VALUES
        (1, 'vollständig',       a.vollstaendig),
        (2, 'teilweise',         a.teilweise),
        (3, 'Rezept ohne Menge', a.ohne_menge),
        (4, 'kein Rezept',       a.kein_rezept)) AS t(folge, teil, umsatz)
 ORDER BY w.anteil NULLS LAST, a.betrieb, t.folge`,
    visualisierung: {
      'graph.dimensions': ['Betrieb', 'Anteil'],
      'graph.metrics': ['Umsatz %'],
      'stackable.stack_type': 'stacked',
      'graph.y_axis.max': 100,
      'graph.x_axis.title_text': '',
      'graph.y_axis.title_text': 'Anteil am Artikelumsatz (%)',
      series_settings: {
        'vollständig': { color: '#84BB4C' }, teilweise: { color: '#F9CF48' },
        'Rezept ohne Menge': { color: '#F2A86F' }, 'kein Rezept': { color: '#C7CFD4' },
      },
    },
  },

  {
    /*
     * Alle Betriebe mit amadeus-Kasse, auch nicht ausgewertete — mit dem
     * Stand in Worten (wie rz_betrieb_tabelle). Prozente aus den Summen der
     * drei Monate neu gerechnet, nie gemittelt. "nicht in FoodNotify" ist der
     * Teil von "kein Rezept", der keine Pflegeluecke ist, sondern eine
     * fehlende Anbindung.
     */
    schluessel: 'sv_abdeckung_tabelle',
    name: 'Abdeckung des Soll-Verbrauchs je Betrieb',
    beschreibung:
      'Alle Betriebe mit angebundener Kasse, über die letzten drei vollen Monate. „Abdeckung" ist der Anteil des Artikelumsatzes, der vollständig in den Soll-Verbrauch eingeht; „mit Rezept" der Anteil mit zugeordnetem Rezept, ob umrechenbar oder nicht. „davon nicht in FoodNotify" ist Umsatz, dessen Artikel FoodNotify in diesem Betrieb gar nicht kennt — meist fehlt eine Kassenanbindung, kein Rezept. „Bar/Küche verschieden" zählt Artikel, denen Bar und Küche verschiedene Rezepte zuordnen; gerechnet wird mit dem zuletzt gepflegten. Ohne geladene Kassenzuordnung steht keine Zahl da, nicht null Prozent. Prozentwerte nicht über Betriebe mitteln.',
    anzeige: 'table',
    parameter: [MARKE, BETRIEB],
    sql: `
SELECT a.betrieb                                  AS "Betrieb",
       CASE max(a.zustand) WHEN 'ok' THEN 'ausgewertet'
            WHEN 'marke nicht aktiv' THEN 'Marke noch nicht geholt'
            WHEN 'bruecke nicht geladen' THEN 'Kassenzuordnung noch nicht geladen'
            ELSE 'Kassenzuordnung teilweise geladen' END AS "Stand",
       CASE WHEN bool_and(a.abdeckung_umsatz_pct IS NOT NULL) THEN
         round(100.0 * sum(a.umsatz_vollstaendig) / nullif(sum(a.umsatz_netto), 0), 1) END AS "Abdeckung %",
       CASE WHEN bool_and(a.abdeckung_menge_pct IS NOT NULL) THEN
         round(100.0 * sum(a.menge_vollstaendig) / nullif(sum(a.menge_verkauft), 0), 1) END AS "Abdeckung Menge %",
       CASE WHEN bool_and(a.rezept_umsatz_pct IS NOT NULL) THEN
         round(100.0 * sum(a.umsatz_netto - a.umsatz_kein_rezept) / nullif(sum(a.umsatz_netto), 0), 1) END AS "mit Rezept %",
       round(sum(a.umsatz_netto))                 AS "Artikelumsatz",
       round(sum(a.umsatz_vollstaendig))          AS "vollständig",
       round(sum(a.umsatz_teilweise))             AS "teilweise",
       round(sum(a.umsatz_nicht_umrechenbar + a.umsatz_rezept_ohne_zutaten + a.umsatz_rezept_nicht_geladen)) AS "Rezept ohne Menge",
       round(sum(a.umsatz_kein_rezept))           AS "kein Rezept",
       round(sum(a.umsatz_nicht_im_feed))         AS "davon nicht in FoodNotify",
       max(a.artikel_rezept_uneindeutig)          AS "Bar/Küche verschieden",
       max(a.aeltester_abruf_am)::date            AS "Zuordnung geladen am"
  FROM mart.soll_verbrauch_abdeckung a
 WHERE ${DREI_MONATE.replace(/monat/g, 'a.monat')}${FILTER('a.')}
 GROUP BY a.betrieb_key, a.betrieb
 ORDER BY (max(a.zustand) = 'ok') DESC, 3 NULLS LAST, a.betrieb`,
    visualisierung: {
      column_settings: {
        '["name","Abdeckung %"]': PROZENT,
        '["name","Abdeckung Menge %"]': PROZENT,
        '["name","mit Rezept %"]': PROZENT,
        '["name","Artikelumsatz"]': EURO,
        '["name","vollständig"]': EURO,
        '["name","teilweise"]': EURO,
        '["name","Rezept ohne Menge"]': EURO,
        '["name","kein Rezept"]': EURO,
        '["name","davon nicht in FoodNotify"]': EURO,
      },
    },
  },

  {
    /*
     * TABELLE, KEIN BALKEN: die Mengen stehen in kg, l und Rezepteinheiten
     * ("Stück", "FL") — eine gemeinsame Achse gaebe es nur fuer den Wert,
     * und der ist FoodNotifys Kalkulation, nicht bezahlt. Sortiert nach dem
     * Wert, weil kg Salz und kg Fleisch nicht gleich wichtig sind. Gruppiert
     * ueber Artikelnummer UND Einheit (soll_menge nur je Ware und Einheit
     * summieren); Freitextzutaten ohne Nummer je Name.
     */
    schluessel: 'sv_waren',
    name: 'Größte Waren im Soll-Verbrauch',
    beschreibung:
      'Die Waren mit dem höchsten Soll-Verbrauch der letzten drei vollen Monate, über die gewählten Betriebe: verkaufte Portionen mal Menge laut Rezept, über alle Rezepte, in denen die Ware steckt. „Wert laut Kalkulation" ist FoodNotifys eigene Rezeptkalkulation, kein bezahlter Preis. Eine **Untergrenze**: nur Artikel mit umrechenbarem Rezept zählen (Abdeckung in der Kachel oben); ⚠ heißt, die Ware steckt zusätzlich in Rezeptzeilen ohne Menge. Mengen in kg und l, sonst in der Einheit des Rezepts.',
    anzeige: 'table',
    parameter: [MARKE, BETRIEB],
    sql: `
SELECT min(ware)                                              AS "Ware",
       artikelnummer                                          AS "Artikelnummer",
       einheit                                                AS "Einheit",
       round(sum(soll_menge), 2)                              AS "Soll-Menge",
       round(sum(soll_wert_fn_eur))                           AS "Wert laut Kalkulation",
       count(DISTINCT betrieb_key)                            AS "Betriebe",
       CASE WHEN bool_or(soll_unvollstaendig) THEN '⚠ teils ohne Menge' END AS "Hinweis"
  FROM mart.soll_verbrauch_monat
 WHERE abdeckung_zustand = 'ok'
   AND ${DREI_MONATE}${FILTER()}
 GROUP BY artikelnummer, CASE WHEN artikelnummer IS NULL THEN ware END, einheit
 ORDER BY sum(soll_wert_fn_eur) DESC NULLS LAST, sum(soll_menge) DESC NULLS LAST
 LIMIT 100`,
    visualisierung: {
      column_settings: { '["name","Wert laut Kalkulation"]': EURO },
    },
  },

  {
    /*
     * Nebeneinander, kein Urteil (Regel 5): keine Differenzspalte, keine
     * Farbe. Ueber drei Monate summiert — vergleichbar heisst: in jedem
     * Monat passten die Einheiten (ein Monat ohne Bestellung zaehlt als
     * null, nicht als unvergleichbar), und mindestens einmal wurde bestellt.
     * "Vergleich" nennt sonst den haeufigsten Grund. Die Abdeckung des
     * Betriebs (aus den Summen der drei Monate) steht in jeder Zeile — sie
     * erklaert, warum "eingekauft / Soll" meist weit ueber 100 liegt.
     */
    schluessel: 'sv_soll_ist',
    name: 'Soll laut Rezept und Einkauf — je Ware',
    beschreibung:
      'Je Betrieb und Ware, über die letzten drei vollen Monate: wie viel laut Rezept mindestens verbraucht wurde und wie viel bestellt wurde. **Das ist kein Schwund.** Einkauf ist nicht Verbrauch — das Lager fehlt —, und das Soll umfasst nur den abgedeckten Teil des Verkaufs: liegt die Abdeckung des Betriebs bei 30 %, ist ein Einkauf vom Dreifachen des Solls nichts Auffälliges. „eingekauft / Soll" steht nur, wo die Mengen vergleichbar sind; sonst sagt „Vergleich", warum nicht. „Soll-Wert" ist die Soll-Menge zum bezahlten Preis je kg/l („Preis aus": eigene Bestellungen im Monat, sonst die der Marke über zwölf Monate).',
    anzeige: 'table',
    parameter: [MARKE, BETRIEB],
    sql: `
WITH abdeckung AS (
    SELECT betrieb_key,
           round(100.0 * sum(umsatz_vollstaendig) / nullif(sum(umsatz_netto), 0), 1) AS abdeckung_pct
      FROM mart.soll_verbrauch_abdeckung
     WHERE zustand = 'ok'
       AND ${DREI_MONATE}${FILTER()}
     GROUP BY betrieb_key
), zeile AS (
    SELECT betrieb_key, betrieb, artikelnummer, einheit,
           min(ware)                                                       AS ware,
           sum(soll_menge)                                                 AS soll,
           sum(eingekauft_menge)                                           AS eingekauft,
           bool_and(vergleich IN ('vergleichbar', 'kein einkauf im monat'))
             AND bool_or(vergleichbar)                                     AS vergleichbar,
           mode() WITHIN GROUP (ORDER BY vergleich)
             FILTER (WHERE vergleich NOT IN ('vergleichbar', 'kein einkauf im monat')) AS grund,
           sum(soll_wert_eur)                                              AS soll_wert,
           mode() WITHIN GROUP (ORDER BY preis_quelle)                     AS preis_quelle
      FROM mart.soll_ist_monat
     WHERE abdeckung_zustand = 'ok'
       AND ${DREI_MONATE}${FILTER()}
     GROUP BY betrieb_key, betrieb, artikelnummer, einheit
)
SELECT z.betrieb                                        AS "Betrieb",
       z.ware                                           AS "Ware",
       z.artikelnummer                                  AS "Artikelnummer",
       z.einheit                                        AS "Einheit",
       round(z.soll, 2)                                 AS "Soll laut Rezept",
       round(z.eingekauft, 2)                           AS "eingekauft",
       CASE WHEN z.vergleichbar THEN round(100.0 * coalesce(z.eingekauft, 0) / nullif(z.soll, 0), 1) END
                                                        AS "eingekauft / Soll %",
       CASE WHEN z.vergleichbar THEN 'vergleichbar'
            ELSE CASE coalesce(z.grund, 'kein einkauf im monat')
                   WHEN 'soll nicht in kg oder l'      THEN 'Rezept nicht in kg/l'
                   WHEN 'soll unvollstaendig'          THEN 'Rezept teils ohne Menge'
                   WHEN 'soll null'                    THEN 'Soll null'
                   WHEN 'kein einkauf im monat'        THEN 'nicht bestellt'
                   WHEN 'einkauf in anderer einheit'   THEN 'bestellt in anderer Einheit'
                   ELSE 'Bestellungen teils ohne Menge' END END AS "Vergleich",
       round(z.soll_wert)                               AS "Soll-Wert",
       CASE z.preis_quelle
         WHEN 'bezahlt, betrieb im monat' THEN 'eigene Bestellungen'
         WHEN 'bezahlt, marke 12 monate'  THEN 'Marke, zwölf Monate'
         ELSE '—' END                                   AS "Preis aus",
       a.abdeckung_pct                                  AS "Abdeckung des Betriebs %"
  FROM zeile z
  JOIN abdeckung a ON a.betrieb_key = z.betrieb_key
 ORDER BY z.soll_wert DESC NULLS LAST, z.betrieb, z.ware
 LIMIT 500`,
    visualisierung: {
      column_settings: {
        '["name","eingekauft / Soll %"]': PROZENT,
        '["name","Soll-Wert"]': EURO,
        '["name","Abdeckung des Betriebs %"]': PROZENT,
      },
    },
  },

  {
    /*
     * Die Quelle des Drill-downs: Klick auf "Rezept-Nr." setzt den Filter
     * Rezept-Nr. dieser Seite, und die Stueckliste darunter zeigt das
     * Rezept. Ohne "kein rezept" — diese Artikel stehen in der Arbeitsliste
     * oben (rz_ohne_rezept). Der Zustand ist ein heutiger (Rezept und
     * Zuordnung), deshalb max() ueber die drei Monate.
     */
    schluessel: 'sv_artikel',
    name: 'Verkaufte Artikel mit Rezept — geht es ein?',
    beschreibung:
      'Verkaufte Artikel der letzten drei vollen Monate mit zugeordnetem Rezept, nach Umsatz: ob und wie das Rezept in den Soll-Verbrauch eingeht. „teilweise" und „nein" heißen fast immer, dass eine Menge im Rezept in einer Einheit steht, die sich nicht in Gramm oder Liter umrechnen lässt (etwa „Portionierer" oder „Stück" eines Halbfabrikats). Klick auf die Rezept-Nr. zeigt darunter, woraus eine Portion besteht und welche Zeile keine Menge hat. Rezept und Zuordnung sind der heutige Stand in FoodNotify.',
    anzeige: 'table',
    parameter: [MARKE, BETRIEB],
    sql: `
SELECT max(artikel)                                     AS "Artikel",
       betrieb                                          AS "Betrieb",
       rezept                                           AS "Rezept",
       rezept_fn_id::text                               AS "Rezept-Nr.",
       ${ZUSTAND_TEXT('max(soll_zustand)')}             AS "im Soll-Verbrauch",
       round(sum(menge_verkauft))                       AS "verkauft",
       round(sum(umsatz_netto))                         AS "Umsatz",
       CASE WHEN bool_or(rezept_uneindeutig) THEN 'Bar und Küche ordnen verschieden zu' END AS "Hinweis"
  FROM mart.soll_artikel_monat
 WHERE soll_zustand <> 'kein rezept'
   AND ${DREI_MONATE}${FILTER()}
 GROUP BY betrieb_key, betrieb, artikel_key, rezept, rezept_fn_id
 ORDER BY sum(umsatz_netto) DESC NULLS LAST, 1
 LIMIT 300`,
    visualisierung: {
      column_settings: { '["name","Umsatz"]': EURO },
    },
  },

  {
    /*
     * Das bisher als "nicht gebaut" vermerkte Zutaten-Drill-down. Ohne
     * gewaehltes Rezept bewusst leer (coalesce auf ''), statt 100.000
     * Zeilen aller Rezepte: die Beschreibung sagt, wie man es fuellt.
     * Rezept-IDs sind ueber alle Marken eine Folge (Enchilada, Wilma
     * Wunder, Aposto, Deutsche Konzepte greifen ineinander), die Nummer
     * allein genuegt. Marke und Betrieb wirken auch hier: nur Rezepte, die
     * eine Kasse dieser Betriebe fuehrt (die Seitenfilter sollen auf jede
     * Karte wirken, uebernehmen.ts).
     */
    schluessel: 'sv_stueckliste',
    name: 'Woraus eine Portion besteht',
    beschreibung:
      'Das in der Tabelle darüber angeklickte Rezept (Filter „Rezept-Nr."), aufgelöst bis zur eingekauften Ware: je Zeile der Weg über die Halbfabrikate, die Menge im Rezept und die Menge für **eine verkaufte Portion** (in kg oder l, sonst in der Einheit des Rezepts). Steht unter „ohne Menge, weil" etwas, lässt sich diese Zeile nicht umrechnen — sie fehlt im Soll-Verbrauch, die Ursache steht dort. „Kalkulation je Portion" ist FoodNotifys eigener Wert. Ohne gewähltes Rezept bleibt die Tabelle leer.',
    anzeige: 'table',
    parameter: [P_REZEPT, MARKE, BETRIEB],
    sql: `
SELECT pfad                                             AS "Weg",
       coalesce(ware, '—')                              AS "Ware",
       artikelnummer                                    AS "Artikelnummer",
       menge_im_rezept                                  AS "Menge im Rezept",
       einheit                                          AS "Einheit",
       round(menge_je_portion, 4)                       AS "je Portion",
       einheit_soll                                     AS "Einheit je Portion",
       round(kosten_je_portion, 3)                      AS "Kalkulation je Portion",
       CASE WHEN NOT belastbar THEN grund END           AS "ohne Menge, weil"
  FROM mart.rezept_stueckliste
 WHERE rezept_fn_id::text = coalesce([[ {{rezept}}, ]] '')
   [[AND rezept_key IN (SELECT rezept_key FROM mart.soll_rezept_zuordnung WHERE betrieb = {{betrieb}})]]
   [[AND rezept_key IN (SELECT rezept_key FROM mart.soll_rezept_zuordnung
                         WHERE betrieb_key IN (SELECT betrieb_key FROM mart.konzept_zuordnung
                                                WHERE hauptkonzept = {{marke}}))]]
 ORDER BY weg`,
    visualisierung: {
      column_settings: { '["name","Kalkulation je Portion"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 3 } },
    },
  },
]
