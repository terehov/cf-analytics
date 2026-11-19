// =====================================================================
// Einkaufspreise je Artikelnummer, Listen- und Katalogpreis,
// beobachtete Lieferkonditionen (Migrationen 0156 und 0157).
//
// Drei Preise, und die Karten halten sie auseinander:
//
//   BEZAHLT      mart.einkaufspreis_artikel_monat — echte Belegpreise je
//                Lieferant + Lieferanten-Artikelnummer, JE GEBINDE (Karton,
//                Sack), Vergleich mit dem letzten Monat MIT Bestellung.
//   LISTENPREIS  mart.listenpreis_aktuell / _aenderung, preisart
//                'listenpreis' — FoodNotifys Warenstamm, JE KG/L, folgt nach
//                der Messung vom 19.11.2026 dem Preis der letzten Bestellung.
//   KATALOGPREIS dieselben Sichten, preisart 'katalogpreis' — der heutige
//                Preis im Lieferantenkatalog, je kg/l, nur bestellbare Waren.
//
// Bezahlt (je Gebinde) und Liste (je kg/l) stehen deshalb auf GETRENNTEN
// Reitern und nie in einer Spalte nebeneinander (docs/metabase.md, „Welche
// Preissicht wofuer"). Wer beide in eine Zeile schreibt, vergleicht einen
// Karton mit einem Kilo.
//
// DIE LISTENPREIS-REIHE BEGINNT MIT DEM ERSTEN ABZUG. FoodNotify fuehrt
// keine Preishistorie; vor dem ersten naechtlichen Abzug gibt es keine
// Aenderung, auch wenn es eine gab. Jede Karte auf dem Reiter sagt das,
// und die Kachel „Beobachtet seit" steht links oben: eine leere
// Aenderungsliste heisst in der ersten Woche „noch nichts beobachtet",
// nicht „keine Preisaenderung".
//
// Die Lieferkonditionen (0156) stehen NICHT hier, sondern auf db_einkauf
// bei den Lieferanten: sie gelten je Betrieb und Lieferant, und db_einkauf
// hat den Betriebsfilter, den diese Seite bewusst nicht hat (die bezahlten
// Preise gelten je Marke, ein Betriebsfilter waere auf dem ersten Reiter
// auf jeder Karte taub).
// =====================================================================

import type { Karte, Parameter } from './typen'
import { P_BETRIEB, P_MARKE } from './gemeinsam'

const MARKE = P_MARKE
const BETRIEB = P_BETRIEB

/** Der Lieferant, wie er in den Bestellungen heisst (je Marke ein eigener Name). */
export const P_LIEFERANT_EINKAUF: Parameter = {
  id: 'lieferant-einkauf-param', name: 'lieferant', 'display-name': 'Lieferant', type: 'text',
  required: false,
}
/** Die Lieferanten-Artikelnummer — genau, keine Teilsuche (Nummern tippt man nicht halb). */
export const P_ARTIKELNUMMER: Parameter = {
  id: 'artikelnummer-param', name: 'artikelnummer', 'display-name': 'Artikelnummer', type: 'text',
  required: false,
}
/**
 * Ein Teil des Warennamens. Teilsuche statt Auswahlliste: die Bestellungen
 * und der Warenstamm schreiben dieselbe Ware verschieden („Karton 12x1l"
 * gegen „Karton 12X1L"), eine exakte Liste aus der einen Quelle traefe die
 * andere still nicht.
 */
export const P_WARE_TEXT: Parameter = {
  id: 'ware-text-param', name: 'ware_text', 'display-name': 'Ware enthält', type: 'text',
  required: false,
}
/** Nur belastbare Lieferkonditionen (Vorgabe) oder alle. */
export const P_DATENBASIS: Parameter = {
  id: 'datenbasis-param', name: 'datenbasis', 'display-name': 'Datenbasis', type: 'text',
  required: false,
}

const PROZENT = { suffix: ' %' }
const EURO = { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 }
const EURO2 = { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 2 }
const EURO4 = { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 4 }

/**
 * Filter der bezahlten Reihe. `ware` ist der JUENGSTE Name der ganzen Reihe
 * und steht auf jeder ihrer Zeilen gleich — die Teilsuche trifft also immer
 * die ganze Reihe, nie einzelne Monate.
 */
const FILTER_BEZAHLT = `
     [[AND marke = {{marke}}]]
     [[AND lieferant = {{lieferant}}]]
     [[AND lieferanten_nr = {{artikelnummer}}]]
     [[AND ware ILIKE '%' || {{ware_text}} || '%']]`

/**
 * Filter des Warenstamms. Der Lieferant heisst dort, wie FoodNotify den Shop
 * nennt („Distra GmbH"), in den Bestellungen je Marke anders („Distra
 * Aposto"). Die Auswahlliste kommt aus den Bestellungen; deshalb trifft der
 * Filter auch ueber den Lieferantenschluessel. Ohne den zweiten Weg stuende
 * der Reiter bei jedem gewaehlten Lieferanten leer — und leer heisst auf
 * dieser Seite schon „noch nichts beobachtet".
 */
const FILTER_LISTE = `
   [[AND marke = {{marke}}]]
   [[AND (lieferant = {{lieferant}}
          OR lieferant_key IN (SELECT lieferant_key FROM mart.einkaufspreis_artikel_monat
                                WHERE lieferant = {{lieferant}}))]]
   [[AND artikelnummer = {{artikelnummer}}]]
   [[AND ware ILIKE '%' || {{ware_text}} || '%']]`

const VIER = [MARKE, P_LIEFERANT_EINKAUF, P_ARTIKELNUMMER, P_WARE_TEXT]

export const karten: Karte[] = [

  // ===================================================================
  // Reiter „Bezahlt je Artikelnummer"
  // ===================================================================
  {
    /*
     * Wie wa_preis_verlauf, aber je Lieferant + Artikelnummer statt je Name:
     * eine Ware, deren Schreibweise wechselte, bleibt EINE Linie, und zwei
     * gleichnamige Waren zweier Lieferanten werden zwei. Acht Linien, aus
     * demselben Grund wie dort — mehr unterscheidet niemand. Die Bezeichnung
     * traegt die Nummer, weil der Name allein nicht eindeutig ist.
     */
    schluessel: 'ap_verlauf',
    name: 'Preisreihe je Artikelnummer',
    beschreibung:
      'Der bezahlte Preis je Gebinde über die letzten 24 Monate, eine Linie je Ware und Artikelnummer des Lieferanten. Ohne Filter die acht Waren mit den höchsten Ausgaben — eine Auswahl, keine Aussage über den Konzern. Eine Ware, die umbenannt wurde, bleibt eine Linie; wechselt der Lieferant die Artikelnummer, beginnt eine neue. Ein Sprung auf das Doppelte oder die Hälfte ist meist ein anderes Gebinde und keine Teuerung — die Tabellen darunter sagen, wo das der Fall ist. Monate ohne Bestellung haben keinen Punkt.',
    anzeige: 'line',
    parameter: VIER,
    sql: `
WITH basis AS (
  SELECT * FROM mart.einkaufspreis_artikel_monat
   WHERE monat >= (date_trunc('month', current_date) - interval '24 months')::date${FILTER_BEZAHLT}
), rang AS (
  SELECT marke_key, lieferant_key, lieferanten_nr,
         row_number() OVER (ORDER BY sum(ausgaben) DESC) AS rang
    FROM basis GROUP BY marke_key, lieferant_key, lieferanten_nr
)
SELECT b.monat                                                       AS "Monat",
       left(b.ware, 45) || ' (' || b.lieferanten_nr || ', ' || b.marke || ')' AS "Ware",
       b.preis_je_gebinde                                            AS "Preis je Gebinde"
  FROM basis b JOIN rang r USING (marke_key, lieferant_key, lieferanten_nr)
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
    /*
     * „Groesste Preisaenderungen des letzten Monats mit Bestellung."
     *
     * JE REIHE DER JUENGSTE MONAT MIT BESTELLUNG in den letzten drei
     * Monaten, verglichen mit IHREM vorigen Monat mit Bestellung (das rechnet
     * die Sicht: vorher_monat, monate_seit_vorher). Die meisten Waren werden
     * nicht jeden Monat bestellt; ein Vergleich gegen den Kalender-Vormonat
     * haette fuer sie keine Zeile.
     *
     * SORTIERT NACH WIRKUNG IN EURO, nicht nach Prozent: (neu - alt) x
     * Gebinde im Monat. +40 % auf eine Dose Zimt ist kein Thema, +4 % auf
     * Mozzarella fuer alle Betriebe eins. Wer nach Prozent sortieren will,
     * klickt die Spalte — Metabase sortiert jede Tabellenspalte selbst.
     *
     * NOT verdaechtig: ein Gebinde- oder Einheitenwechsel ist keine
     * Teuerung, und weil nach Groesse sortiert wird, stuenden genau diese
     * Zeilen sonst oben (wa_preis_veraenderung, 0062). Sie stehen in der
     * Karte darunter, nicht verschwunden.
     */
    schluessel: 'ap_veraenderung',
    name: 'Was ist teurer geworden? — je Artikelnummer',
    beschreibung:
      'Je Ware der jüngste Monat mit Bestellung (aus den letzten drei Monaten), verglichen mit dem Monat davor, in dem sie zuletzt bestellt wurde — „Monate dazwischen" sagt, wie weit dieser Vergleich zurückreicht; bei 6 oder 12 ist es keine Monatsveränderung. Sortiert nach der Wirkung in Euro: Preisunterschied je Gebinde mal der im Monat bestellten Menge. Ein negativer Wert heißt günstiger. Gebinde- und Einheitenwechsel stehen nicht hier, sondern in „Sprünge, die keine Teuerung sein müssen". Alle Preise je bestelltem Gebinde, aus echten Bestellungen.',
    anzeige: 'table',
    parameter: VIER,
    sql: `
WITH letzte AS (
  SELECT DISTINCT ON (marke_key, lieferant_key, lieferanten_nr) *
    FROM mart.einkaufspreis_artikel_monat
   WHERE monat >= (date_trunc('month', current_date) - interval '3 months')::date${FILTER_BEZAHLT}
   ORDER BY marke_key, lieferant_key, lieferanten_nr, monat DESC
)
SELECT ware                                              AS "Ware",
       lieferant                                         AS "Lieferant",
       lieferanten_nr                                    AS "Artikelnummer",
       marke                                             AS "Marke",
       monat                                             AS "Monat",
       vorher_monat                                      AS "verglichen mit",
       monate_seit_vorher                                AS "Monate dazwischen",
       vorher_preis                                      AS "Gebindepreis vorher",
       preis_je_gebinde                                  AS "Gebindepreis",
       veraenderung_pct                                  AS "Veränderung %",
       round((preis_je_gebinde - vorher_preis) * gebinde, 2) AS "Wirkung im Monat",
       ausgaben                                          AS "Ausgaben im Monat",
       bestellungen                                      AS "Bestellungen",
       betriebe                                          AS "Betriebe",
       nullif(namen, 1)                                  AS "Schreibweisen"
  FROM letzte
 WHERE veraenderung_pct IS NOT NULL
   AND veraenderung_pct <> 0
   AND NOT verdaechtig
 ORDER BY abs((preis_je_gebinde - vorher_preis) * gebinde) DESC
 LIMIT 300`,
    visualisierung: {
      column_settings: {
        '["name","Veränderung %"]': PROZENT,
        '["name","Gebindepreis vorher"]': EURO2,
        '["name","Gebindepreis"]': EURO2,
        '["name","Wirkung im Monat"]': EURO,
        '["name","Ausgaben im Monat"]': EURO,
      },
    },
  },

  {
    /*
     * Die Gegenseite von ap_veraenderung: was dort herausfaellt, steht hier
     * mit Grund. Eine ausgeschlossene Zeile, die nirgends auftaucht, waere
     * eine stille Kuerzung (dieselbe Regel wie wa_einkauf_pruefung).
     *
     * Die Gruende sind die Bedingungen von `verdaechtig` aus 0157, einzeln
     * ausgeschrieben. `einheiten > 1` fuehrt die Sicht nicht als eigene
     * Spalte — bleibt nach allen anderen Gruenden nichts uebrig, ist es
     * dieser.
     */
    schluessel: 'ap_auffaellig',
    name: 'Sprünge, die keine Teuerung sein müssen',
    beschreibung:
      'Monate der letzten zwölf, in denen der Gebindepreis springt, aber ein anderes Gebinde, eine andere Einheit oder ein Sprung um das Doppelte die wahrscheinlichere Erklärung ist — oder in denen einzelne Positionen so weit vom Üblichen lagen, dass sie nicht mitgezählt wurden. Diese Zeilen fehlen in „Was ist teurer geworden?" absichtlich. Bevor eine davon als Preiserhöhung weitergegeben wird, die Bestellung selbst ansehen. „Schreibweisen" über 1 heißt: dieselbe Artikelnummer stand unter mehreren Namen in den Bestellungen.',
    anzeige: 'table',
    parameter: VIER,
    sql: `
SELECT ware                                  AS "Ware",
       lieferant                             AS "Lieferant",
       lieferanten_nr                        AS "Artikelnummer",
       marke                                 AS "Marke",
       monat                                 AS "Monat",
       vorher_preis                          AS "Gebindepreis vorher",
       preis_je_gebinde                      AS "Gebindepreis",
       veraenderung_pct                      AS "Veränderung %",
       coalesce(nullif(concat_ws(', ',
         CASE WHEN gebinde_gewechselt THEN 'Gebindegröße gewechselt' END,
         CASE WHEN einheit_gewechselt THEN 'Einheit gewechselt' END,
         CASE WHEN gebinde_varianten > 1 THEN gebinde_varianten || ' Gebindegrößen im Monat' END,
         CASE WHEN einheit = 'baseUnit' THEN 'Einheit unklar' END,
         CASE WHEN vorher_preis > 0 AND (preis_je_gebinde >= vorher_preis * 2
                                         OR preis_je_gebinde * 2 <= vorher_preis)
              THEN 'Sprung um Faktor 2 oder mehr' END,
         CASE WHEN ausreisser > 0 THEN ausreisser || ' Position(en) nicht gezählt' END), ''),
         'mehrere Einheiten im Monat')       AS "Warum auffällig",
       gebinde_typisch                       AS "Gebindegröße",
       einheit                               AS "Einheit",
       nullif(namen, 1)                      AS "Schreibweisen",
       ausgaben                              AS "Ausgaben im Monat"
  FROM mart.einkaufspreis_artikel_monat
 WHERE monat >= (date_trunc('month', current_date) - interval '12 months')::date
   AND (verdaechtig OR ausreisser > 0)${FILTER_BEZAHLT}
 ORDER BY monat DESC, ausgaben DESC
 LIMIT 300`,
    visualisierung: {
      column_settings: {
        '["name","Veränderung %"]': PROZENT,
        '["name","Gebindepreis vorher"]': EURO2,
        '["name","Gebindepreis"]': EURO2,
        '["name","Ausgaben im Monat"]': EURO,
      },
    },
  },

  {
    /*
     * Die Zahlen zur Linie oben — dieselbe Auswahl (Top nach Ausgaben),
     * aber 20 Reihen statt 8 und jeder Monat mit Spanne, Gebinde und Name.
     * Erst die Reihen ranken, dann ihre Monate zeigen: die Lehre aus
     * wa_preise (bis 12.08.2026 schnitt ein LIMIT nach EINEM Monat ab).
     */
    schluessel: 'ap_tabelle',
    name: 'Bezahlte Preise je Artikelnummer und Monat',
    beschreibung:
      'Die Monate der Waren mit den höchsten Ausgaben der letzten 24 Monate, mit dem mittleren, günstigsten und teuersten Gebindepreis. Mit gesetzter Artikelnummer bleibt genau diese Reihe übrig. „Name im Monat" steht nur da, wo die Ware damals anders hieß als heute. „Veränderung %" vergleicht mit dem letzten Monat mit Bestellung, nicht mit dem Kalender-Vormonat; ⚠ markiert Monate, in denen Gebinde oder Einheit wechselten.',
    anzeige: 'table',
    parameter: VIER,
    sql: `
WITH basis AS (
  SELECT * FROM mart.einkaufspreis_artikel_monat
   WHERE monat >= (date_trunc('month', current_date) - interval '24 months')::date${FILTER_BEZAHLT}
), rang AS (
  SELECT marke_key, lieferant_key, lieferanten_nr, sum(ausgaben) AS ausgaben_reihe,
         row_number() OVER (ORDER BY sum(ausgaben) DESC) AS rang
    FROM basis GROUP BY marke_key, lieferant_key, lieferanten_nr
)
SELECT b.ware                                            AS "Ware",
       b.lieferant                                       AS "Lieferant",
       b.lieferanten_nr                                  AS "Artikelnummer",
       b.marke                                           AS "Marke",
       b.monat                                           AS "Monat",
       nullif(b.ware_im_monat, b.ware)                   AS "Name im Monat",
       b.bestellungen                                    AS "Bestellungen",
       b.gebinde                                         AS "Gebinde",
       b.ausgaben                                        AS "Ausgaben",
       b.preis_je_gebinde                                AS "Preis je Gebinde",
       b.preis_min                                       AS "günstigster",
       b.preis_max                                       AS "teuerster",
       b.gebinde_typisch                                 AS "Gebindegröße",
       b.einheit                                         AS "Einheit",
       b.veraenderung_pct                                AS "Veränderung %",
       b.monate_seit_vorher                              AS "Monate dazwischen",
       CASE WHEN b.verdaechtig THEN '⚠' END              AS "Gebinde?"
  FROM basis b JOIN rang r USING (marke_key, lieferant_key, lieferanten_nr)
 WHERE r.rang <= 20
 ORDER BY r.ausgaben_reihe DESC, b.marke, b.lieferanten_nr, b.monat DESC
 LIMIT 500`,
    visualisierung: {
      column_settings: {
        '["name","Ausgaben"]': EURO,
        '["name","Preis je Gebinde"]': EURO2,
        '["name","günstigster"]': EURO2,
        '["name","teuerster"]': EURO2,
        '["name","Veränderung %"]': PROZENT,
      },
    },
  },

  // ===================================================================
  // Reiter „Liste und Katalog"
  // ===================================================================
  {
    /*
     * DER LEERZUSTAND ALS ZAHL. Die Aenderungsliste ist in den ersten Tagen
     * nach dem Deploy leer, und eine leere Tabelle liest sich als „keine
     * Preisaenderung". Diese Kachel sagt, ab wann ueberhaupt hingesehen wird
     * — und „noch kein Abzug", solange es nichts gibt.
     *
     * Nur Kostenstellen mit Betrieb: die Testkostenstellen werden mit
     * geladen (0157), setzen aber keinen Beginn.
     */
    schluessel: 'lp_reihe_seit',
    name: 'Preise beobachtet seit',
    beschreibung:
      'Der Tag, ab dem der Warenstamm jede Nacht gelesen wird. Erst ab hier kann eine Änderung von Listen- oder Katalogpreis überhaupt auffallen — FoodNotify bewahrt alte Preise nicht auf. „noch kein Abzug" heißt: es wurde noch nie gelesen, die Tabellen darunter sind deshalb leer und nicht „ohne Änderung". Noch nicht jede Marke wird gelesen; eine Marke ohne Abzug steht hier als „noch kein Abzug".',
    anzeige: 'scalar',
    parameter: [MARKE],
    sql: `
SELECT coalesce(to_char(min(reihe_ab), 'DD.MM.YYYY'), 'noch kein Abzug') AS "Beobachtet seit"
  FROM mart.warenstamm_stand
 WHERE marke_aktiv
   AND betrieb_key IS NOT NULL
   [[AND marke = {{marke}}]]`,
  },

  {
    schluessel: 'lp_aenderungen_30',
    name: 'Listenpreis-Änderungen, 30 Tage',
    beschreibung:
      'Wie oft sich in den letzten 30 Tagen ein Listenpreis geändert hat — nur reine Preisänderungen (Gebinde, Einheit, Artikelnummer und Lieferant gleich geblieben). Eine Listenpreisänderung heißt meist: es wurde zu einem neuen Preis bestellt. Eine kleine Zahl in den ersten Wochen heißt wenig — siehe „Preise beobachtet seit".',
    anzeige: 'scalar',
    parameter: VIER,
    sql: `
SELECT count(*) AS "Änderungen"
  FROM mart.listenpreis_aenderung
 WHERE preisart = 'listenpreis'
   AND vergleichbar
   AND betrieb_key IS NOT NULL
   AND gueltig_ab >= current_date - 30${FILTER_LISTE}`,
  },

  {
    schluessel: 'lp_katalog_anzahl',
    name: 'Katalog weicht vom Listenpreis ab',
    beschreibung:
      'Waren, deren heutiger Katalogpreis beim Lieferanten nicht mehr dem Listenpreis entspricht — eine Preisänderung, die noch niemand zu spüren bekommen hat, weil seitdem niemand bestellt hat. Die Waren selbst stehen in der Tabelle „Katalog bewegt, noch nicht bestellt".',
    anzeige: 'scalar',
    parameter: VIER,
    sql: `
SELECT count(*) AS "Waren"
  FROM mart.listenpreis_aktuell
 WHERE katalog_abweichung_pct <> 0
   AND betrieb_key IS NOT NULL${FILTER_LISTE}`,
  },

  {
    /*
     * Beide Preisarten in EINER Liste, mit Spalte „Preis". Die Sicht warnt
     * „immer nach preisart filtern" — fuer ZAEHLUNGEN, weil eine Aenderung
     * beider Preise zweimal dasteht. Eine Liste zaehlt nicht; sie zeigt beide
     * Zeilen nebeneinander, und genau das ist die Information (der Katalog
     * bewegt sich vor der Bestellung, der Listenpreis danach).
     *
     * Ein Wechsel auf oder von 0 ist kein Preis (0157): „kein preis mehr" /
     * „preis neu", ohne Prozent. Die Spalte Prozent bleibt dort leer — nie
     * -100 %.
     */
    schluessel: 'lp_aenderung',
    name: 'Jüngste Preisänderungen im Warenstamm',
    beschreibung:
      'Jede beobachtete Änderung von Listen- oder Katalogpreis, die jüngsten zuerst. Beide Preise gelten je kg oder Liter, nicht je Gebinde, und keiner ist ein bezahlter Preis. „Listenpreis" folgt meist der letzten Bestellung; „Katalogpreis" ist, was der Lieferant heute verlangt. Ändern sich beide, steht die Ware zweimal da. „kein Preis mehr" und „Preis neu" sind kein Preissturz und keine Verteuerung: die Ware fiel aus dem Katalog oder kam hinein. Steht unter „auch geändert" etwas, hat sich mehr als der Preis geändert, und der Prozentwert vergleicht Ungleiches. Der Tag ist der, an dem die Änderung auffiel — wann genau sie eintrat, weiß niemand. Leer heißt in den ersten Tagen: noch nichts beobachtet.',
    anzeige: 'table',
    parameter: VIER,
    sql: `
SELECT gueltig_ab                                          AS "Gesehen am",
       CASE preisart WHEN 'listenpreis' THEN 'Listenpreis' ELSE 'Katalogpreis' END AS "Preis",
       CASE art WHEN 'erhoehung' THEN 'teurer' WHEN 'senkung' THEN 'günstiger'
                WHEN 'preis neu' THEN 'Preis neu' ELSE 'kein Preis mehr' END AS "Art",
       ware                                                AS "Ware",
       lieferant                                           AS "Lieferant",
       artikelnummer                                       AS "Artikelnummer",
       betrieb                                             AS "Betrieb",
       kostenstelle                                        AS "Kostenstelle",
       preis_alt                                           AS "vorher je Einheit",
       preis_neu                                           AS "jetzt je Einheit",
       einheit                                             AS "Einheit",
       aenderung_pct                                       AS "Veränderung %",
       nullif(array_to_string(auch_geaendert, ', '), '')   AS "auch geändert",
       CASE WHEN nicht_mehr_geliefert THEN 'nicht mehr im Warenstamm' END AS "Hinweis"
  FROM mart.listenpreis_aenderung
 WHERE betrieb_key IS NOT NULL${FILTER_LISTE}
 ORDER BY gesehen_ab DESC, ware, preisart
 LIMIT 500`,
    visualisierung: {
      column_settings: {
        '["name","vorher je Einheit"]': EURO4,
        '["name","jetzt je Einheit"]': EURO4,
        '["name","Veränderung %"]': PROZENT,
      },
    },
  },

  {
    /*
     * „Preisaenderung, die noch niemand bestellt hat." Der Katalog bewegt
     * sich vor der naechsten Bestellung (7984, 19.11.2026: vier von 109
     * Katalogwaren, alle billiger als die letzte Bestellung). Fuer den
     * Einkauf die vorausschauende Liste: hier wird die naechste Bestellung
     * teurer oder billiger, bevor eine Rechnung es zeigt.
     */
    schluessel: 'lp_katalog_abweichung',
    name: 'Katalog bewegt, noch nicht bestellt',
    beschreibung:
      'Waren, bei denen der Lieferant im Katalog heute einen anderen Preis verlangt als den, zu dem zuletzt bestellt wurde (Listenpreis). Ein positiver Wert heißt: die nächste Bestellung wird teurer; ein negativer: günstiger. Beide Preise je kg oder Liter; daneben der Preis der Bestelleinheit, wie ihn der Katalog angibt. Nur bestellbare Waren haben einen Katalogpreis.',
    anzeige: 'table',
    parameter: VIER,
    sql: `
SELECT ware                          AS "Ware",
       lieferant                     AS "Lieferant",
       artikelnummer                 AS "Artikelnummer",
       betrieb                       AS "Betrieb",
       kostenstelle                  AS "Kostenstelle",
       listenpreis                   AS "Listenpreis je Einheit",
       katalogpreis                  AS "Katalogpreis je Einheit",
       einheit                       AS "Einheit",
       katalog_abweichung_pct        AS "Abweichung %",
       katalog_gebinde               AS "Bestelleinheit",
       katalog_gebinde_preis         AS "Preis Bestelleinheit",
       preis_seit                    AS "Listenpreis seit",
       CASE WHEN preis_seit_erstem_abzug THEN 'mindestens' END AS "seit?"
  FROM mart.listenpreis_aktuell
 WHERE katalog_abweichung_pct <> 0
   AND betrieb_key IS NOT NULL${FILTER_LISTE}
 ORDER BY abs(katalog_abweichung_pct) DESC, ware
 LIMIT 500`,
    visualisierung: {
      column_settings: {
        '["name","Listenpreis je Einheit"]': EURO4,
        '["name","Katalogpreis je Einheit"]': EURO4,
        '["name","Preis Bestelleinheit"]': EURO2,
        '["name","Abweichung %"]': PROZENT,
      },
    },
  },

  {
    /*
     * Der heutige Stand. Ohne Preis (0 oder leer) steht eine Ware NICHT
     * hier: 0 ist im Warenstamm „kein Preis", keine Gratisware (0157). Der
     * Gebindepreis ist GERECHNET (Listenpreis x Inhalt x Gebindemenge) und
     * haengt an FoodNotifys Inhaltsangabe — deshalb hinter dem Preis je
     * Einheit und so beschriftet.
     */
    schluessel: 'lp_aktuell',
    name: 'Listenpreis heute je Ware',
    beschreibung:
      'Was eine Ware heute laut Warenstamm kostet, je Kostenstelle — ein Betrieb hat oft zwei (Bar und Küche) mit eigenem Warenstamm. Der Listenpreis gilt je kg oder Liter und folgt meist der letzten Bestellung; er ist kein bezahlter Preis — der steht auf dem Reiter „Bezahlt je Artikelnummer". „Gebinde (gerechnet)" ist Listenpreis mal Inhalt und hängt an der Inhaltsangabe in FoodNotify; vor einem auffälligen Wert die Ware ansehen. „seit" mit „mindestens" heißt: der Preis stand schon beim ersten Lesen da, wie lange davor, weiß niemand. Waren ohne Preis stehen nicht hier.',
    anzeige: 'table',
    parameter: VIER,
    sql: `
SELECT ware                          AS "Ware",
       lieferant                     AS "Lieferant",
       artikelnummer                 AS "Artikelnummer",
       betrieb                       AS "Betrieb",
       kostenstelle                  AS "Kostenstelle",
       listenpreis                   AS "Listenpreis je Einheit",
       einheit                       AS "Einheit",
       listenpreis_gebinde           AS "Gebinde (gerechnet)",
       katalogpreis                  AS "Katalogpreis je Einheit",
       preis_seit                    AS "seit",
       CASE WHEN preis_seit_erstem_abzug THEN 'mindestens' END AS "seit?",
       CASE WHEN eigenproduktion THEN 'Eigenproduktion'
            WHEN bestellbar THEN 'bestellbar' END AS "Art"
  FROM mart.listenpreis_aktuell
 WHERE NOT kein_preis
   AND betrieb_key IS NOT NULL${FILTER_LISTE}
 ORDER BY betrieb, kostenstelle, lieferant, ware
 LIMIT 1000`,
    visualisierung: {
      column_settings: {
        '["name","Listenpreis je Einheit"]': EURO4,
        '["name","Gebinde (gerechnet)"]': EURO2,
        '["name","Katalogpreis je Einheit"]': EURO4,
      },
    },
  },

  // ===================================================================
  // Auf db_einkauf: die Verweiskachel und die Lieferkonditionen
  // ===================================================================
  {
    /*
     * Die Tuer von db_einkauf auf die neue Seite — dieselbe Bauart wie
     * fe_kachel_verweis: eine feste Groesse und ein Klick. Ohne sie faende
     * niemand die Artikelnummer-Reihe, die den Namensvergleich auf
     * db_einkauf ablosen soll.
     */
    schluessel: 'wa_kachel_artikelpreis',
    name: 'Preisreihen je Artikelnummer',
    beschreibung:
      'Wie viele Waren in den letzten drei Monaten bestellt wurden, gezählt je Lieferant und Artikelnummer statt je Name. Klick öffnet die Preisseite je Artikelnummer — dort bleibt eine umbenannte Ware eine Reihe, und dort stehen auch Listen- und Katalogpreis aus dem Warenstamm.',
    anzeige: 'scalar',
    parameter: [MARKE],
    sql: `
SELECT count(*) AS "Waren mit Preisreihe"
  FROM (SELECT DISTINCT marke_key, lieferant_key, lieferanten_nr
          FROM mart.einkaufspreis_artikel_monat
         WHERE monat >= (date_trunc('month', current_date) - interval '3 months')::date
           [[AND marke = {{marke}}]]) r`,
  },

  {
    /*
     * BEOBACHTET, NICHT VEREINBART (0156). Eine Tabelle und kein Diagramm:
     * die Antworten sind Wochentagslisten („Mo, Mi, Fr"), Uhrzeiten und
     * Tageszahlen je Betrieb und Lieferant — nichts davon wird durch eine
     * Flaeche oder Linie lesbarer, und ein Balken je Wochentag machte aus
     * einer Zeile sieben.
     *
     * NUR BELASTBARE ZEILEN ALS VORGABE (ab 10 Bestellungen). Der Filter
     * „Datenbasis" auf „alle" nimmt die duennen dazu; der optionale Block
     * `[[OR …]]` macht das ohne Unterabfrage: ohne Wert bleibt `belastbar`
     * allein stehen.
     *
     * Der kleinste beobachtete Bestellwert steht absichtlich NICHT da
     * (gemessen 1,50 bis 2,82 EUR bei den meistbestellten Paaren — er
     * zeigt die Ausnahme, nicht die Regel). Das 5-%-Quantil heisst „untere
     * 5 %", nicht „Mindestbestellwert": FoodNotify warnt bei Unterschreitung,
     * es sperrt nicht.
     */
    schluessel: 'wa_lieferkondition',
    name: 'Wann geliefert wird — beobachtet, nicht vereinbart',
    beschreibung:
      'Je Betrieb, Bereich (Bar, Küche) und Lieferant, was die Bestellungen der letzten zwölf Monate zeigen: an welchen Wochentagen geliefert wurde, wie viele Tage zwischen Bestellung und Lieferung lagen, bis wann am Vortag noch für den nächsten Tag bestellt wurde, und wie groß eine Bestellung üblicherweise ist. **Das ist beobachtetes Verhalten, nicht der Vertrag.** Ein Wochentag, der fehlt, kann trotzdem beliefert werden — es hat nur niemand für diesen Tag bestellt. „Bestellt bis" ist keine Bestellfrist, sondern die späteste Uhrzeit, zu der es noch geklappt hat. Der Bestellwert ist **kein Mindestbestellwert**: FoodNotify warnt bei kleinen Bestellungen, verhindert sie aber nicht. Die echten Konditionen kennt der Lieferant. Voreingestellt sind nur Paare mit mindestens zehn Bestellungen; „Datenbasis: alle" zeigt auch die dünnen.',
    anzeige: 'table',
    parameter: [MARKE, BETRIEB, P_DATENBASIS],
    sql: `
SELECT betrieb                                       AS "Betrieb",
       CASE WHEN betrieb IS NULL THEN fn_betrieb END AS "nicht zugeordnet",
       bereich                                       AS "Bereich",
       lieferant                                     AS "Lieferant",
       liefertage_ueblich                            AS "Liefertage meist",
       liefertage_gesehen                            AS "Liefertage gesehen",
       vorlauf_typisch_tage                          AS "Vorlauf meist (Tage)",
       vorlauf_min_tage                              AS "Vorlauf kürzester",
       to_char(bestellzeit_vortag_p95, 'HH24:MI')    AS "Bestellt bis (Vortag)",
       to_char(bestellzeit_vortag_spaetest, 'HH24:MI') AS "spätester Fall",
       bestellwert_median_netto                      AS "Bestellwert üblich",
       bestellwert_p05_netto                         AS "Bestellwert untere 5 %",
       bestellungen                                  AS "Bestellungen",
       letzte_bestellung                             AS "Letzte Bestellung",
       CASE WHEN belastbar THEN 'ja' ELSE 'dünn' END AS "belastbar"
  FROM mart.lieferkondition_beobachtet
 WHERE (belastbar [[OR {{datenbasis}} = 'alle']])
   [[AND marke = {{marke}}]]
   [[AND betrieb = {{betrieb}}]]
 ORDER BY betrieb NULLS LAST, bereich, bestellungen DESC
 LIMIT 1000`,
    visualisierung: {
      column_settings: {
        '["name","Bestellwert üblich"]': EURO,
        '["name","Bestellwert untere 5 %"]': EURO,
      },
    },
  },
]
