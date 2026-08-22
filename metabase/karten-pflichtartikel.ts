// =====================================================================
// Pflichtartikel — haelt sich der Betrieb an die Sortimentsvorgabe?
//
// Datengrundlage: Migration 0094. Die Listen kommen vom Fachbereich
// (zwei PDF, zwei XLSX), die Bestellungen aus FoodNotify.
//
// DIE LEITZAHL IST NICHT DIE ERFUELLUNG, SONDERN DER ANTEIL DANEBEN.
// Gefragt war: "welche Betriebe bestellen abseits der Pflichtartikel".
// Deshalb steht ueberall `abseits_pct` vorn — der Anteil der AUSGABEN,
// der auf Artikel entfaellt, die auf keiner Liste des Konzepts stehen.
// Die umgekehrte Lesart (welcher Pflichtartikel fehlt) steht auf dem
// Reiter "Abdeckung" und ist die Nebenfrage, nicht die Hauptfrage.
//
// ---------------------------------------------------------------------
// DREI REGELN, DIE HIER JEDE KARTE BEFOLGT
//
//   1. NIE `abseits_pct` OHNE `datenbasis` ZEIGEN. Ein Betrieb mit drei
//      Bestellungen kommt rechnerisch auf 90 % — richtig gerechnet und
//      trotzdem keine Aussage. Jede Tabelle traegt die Spalte, jede
//      Rangkarte filtert auf 'belastbar' und sagt das in ihrer
//      Beschreibung.
//
//   2. `namensgleich` IST KEIN BEFUND, sondern die Unschaerfe der
//      Messung: ein Artikel, dessen Name auf der Liste steht und dessen
//      Nummer nicht. Er zaehlt weder als erfuellt noch als abseits und
//      hat eine eigene Karte. Solange die Zahl gross ist, ist
//      `abseits_pct` eine OBERGRENZE — das steht in den Beschreibungen,
//      nicht nur hier.
//
//   3. KEIN ZEITRAUMFILTER. Der Zeitraum ist die Laufzeit der Liste und
//      wird in 0094 geschnitten: die Wilma-Wunder-Sommerkarte laeuft vom
//      13.04. bis 04.10.2026, und eine Januarbestellung dagegen zu
//      pruefen misst die Karte statt den Betrieb. Ein freier
//      Zeitraumfilter darueber koennte diesen Schnitt nur aufweichen.
//
// ---------------------------------------------------------------------
// WAS DIE ZAHLEN NICHT SAGEN, UND WARUM DAS IN DEN BESCHREIBUNGEN STEHT
//
// Die Listen fuehren kein Reinigungsmittel, keine Verpackung, keinen
// Kaffee und keine Weine ausser den genannten. Am 22.08.2026 standen bei
// Wilma Wunder Kaffee (J. Hornig ueber Darboven) und Fassbier
// (Augustiner, Bueble) ganz oben im "abseits"-Topf. Das ist kein
// Verstoss, sondern eine Luecke der Liste — und wer die Quote ohne diese
// Einordnung weitergibt, erzeugt eine Diskussion ueber das falsche Thema.
// =====================================================================

import type { Karte, Parameter } from './typen'
import { P_BETRIEB, P_MARKE } from './gemeinsam'

const BETRIEB = P_BETRIEB
const MARKE = P_MARKE

/**
 * Der Lieferant. OHNE Werteliste, wie auf db_fremdeinkauf: der Filter
 * wird aus einer Tabelle heraus geklickt, nicht getippt.
 */
const LIEFERANT: Parameter = {
  id: 'pa-lieferant-param', name: 'lieferant', 'display-name': 'Lieferant', type: 'string/=',
}

/**
 * Der Betriebsfilter der Auswertungssichten heisst dort `betrieb`, der
 * Markenfilter `konzept`. Beide Bausteine stehen hier einmal, damit sie
 * nicht in fuenfzehn Karten einzeln driften.
 */
const FILTER = `
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]`

export const karten: Karte[] = [

  // -------------------------------------------------------------------
  // Vier Kacheln: wie gross, wie hoch der Anteil, wie unscharf, wie alt.
  // -------------------------------------------------------------------
  {
    schluessel: 'pa_abseits_summe',
    name: 'Einkauf abseits der Pflichtartikelliste',
    beschreibung:
      'Wie viel Euro im Laufzeitraum der Pflichtartikelliste für Artikel ausgegeben wurde, die auf keiner Liste des Konzepts stehen. Nicht als Verstoß lesen, ohne die Artikel daneben angesehen zu haben: die Listen führen weder Reinigungsmittel noch Verpackung, Kaffee oder Wein — was dort fehlt, taucht hier zwangsläufig auf. Der Zeitraum ist die Laufzeit der Liste und nicht frei wählbar.',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    // coalesce: ein Betrieb ohne Abweichung zeigt 0 und keine leere Kachel
    // — leer liest sich als "kaputt", nicht als "nichts gefunden".
    sql: `
SELECT round(coalesce(sum(ausgaben_abseits), 0)) AS "Abseits der Liste (EUR)"
  FROM mart.pflichtartikel_betrieb
 WHERE true${FILTER}`,
  },

  {
    schluessel: 'pa_abseits_quote',
    name: 'Anteil am Einkauf',
    beschreibung:
      'Der Anteil der Ausgaben, der an der Pflichtartikelliste vorbeiläuft — die Leitzahl dieser Seite. Auf Ausgaben gerechnet und nicht auf die Artikelzahl: eine Palette Fremdbier wiegt mehr als eine Packung Zahnstocher. Ohne gewählten Betrieb ist es der Wert über alle ausgewerteten Betriebe zusammen.',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT round(100.0 * coalesce(sum(ausgaben_abseits), 0)
             / nullif(sum(ausgaben), 0), 1) AS "Abseits der Liste (%)"
  FROM mart.pflichtartikel_betrieb
 WHERE true${FILTER}`,
    visualisierung: { suffix: ' %' },
  },

  {
    /*
     * Diese Kachel ist die Ehrlichkeit der Seite.
     *
     * Sie zaehlt, was der Namensabgleich als "gleicher Name, andere
     * Nummer" gefunden hat — also Artikel, die MOEGLICHERWEISE
     * Pflichtartikel unter einer Nachfolgenummer sind. Am 22.08.2026
     * waren das 105.194 EUR allein fuer "Cheddar / Gouda Mix", der zum
     * 15.11.2025 von Distra 268 auf 500096 umgestellt wurde.
     *
     * Solange hier eine grosse Zahl steht, ist die Quote daneben eine
     * OBERGRENZE. Wer die Kachel klickt, landet auf der Arbeitsliste,
     * die genau das aufloest.
     */
    schluessel: 'pa_unschaerfe',
    name: 'Unklar: gleicher Name, andere Nummer',
    beschreibung:
      'Ausgaben für Artikel, deren Name eine Position der Pflichtartikelliste trifft, deren Artikelnummer aber abweicht. Das ist kein Befund, sondern die Unschärfe der Messung: Lieferanten vergeben Nachfolgenummern, während die Liste stehen bleibt. Diese Ausgaben zählen weder als erfüllt noch als abseits. Solange die Zahl groß ist, ist der Anteil daneben eine Obergrenze. Aufgelöst wird das in der Arbeitsliste „Nachfolgenummern".',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT round(coalesce(sum(ausgaben * namensgleich_pct / 100.0), 0))
         AS "Unklar zugeordnet (EUR)"
  FROM mart.pflichtartikel_betrieb
 WHERE true${FILTER}`,
  },

  {
    schluessel: 'pa_betriebe_ausgewertet',
    name: 'Betriebe mit belastbarer Datenbasis',
    beschreibung:
      'Wie viele Betriebe genug bestellt haben, um die Quote lesen zu können — mindestens zehn Bestellungen und mindestens 5.000 € im Laufzeitraum. Die übrigen stehen in den Tabellen weiter unten mit dem Vermerk „dünn": ihr Prozentwert ist richtig gerechnet und trotzdem keine Aussage. Betriebe ohne Pflichtartikelliste (Deutsche Konzepte) sind auf dieser Seite gar nicht enthalten.',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT count(*) FILTER (WHERE datenbasis = 'belastbar') AS "Betriebe auswertbar"
  FROM mart.pflichtartikel_betrieb
 WHERE true${FILTER}`,
  },

  // -------------------------------------------------------------------
  // Die Rangliste — die Antwort auf die gestellte Frage.
  // -------------------------------------------------------------------
  {
    /*
     * `datenbasis = 'belastbar'` ist hier eine BEDINGUNG und nicht nur
     * eine Spalte, anders als in der Tabelle darunter.
     *
     * Grund: ein Balkendiagramm laesst sich nicht mit einer Fussnote
     * lesen. Am 22.08.2026 standen ohne diesen Filter geschlossene und
     * insolvente Haeuser mit zwei Bestellungen an der Spitze — die
     * Rangliste haette auf die falschen Betriebe gezeigt. Wer die
     * duennen Faelle sehen will, findet sie vollstaendig in der Tabelle
     * darunter.
     */
    schluessel: 'pa_rangliste',
    name: 'Wer bestellt am meisten abseits der Liste',
    beschreibung:
      'Die Betriebe nach dem Anteil ihres Einkaufs, der an der Pflichtartikelliste vorbeiläuft. Nur Betriebe mit belastbarer Datenbasis (mindestens zehn Bestellungen und 5.000 € im Laufzeitraum) — sonst stünden Häuser mit zwei Bestellungen an der Spitze. Die vollständige Liste samt der dünnen Fälle steht in der Tabelle darunter.',
    anzeige: 'row',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT betrieb AS "Betrieb", abseits_pct AS "Abseits der Liste (%)"
  FROM mart.pflichtartikel_betrieb
 WHERE datenbasis = 'belastbar'${FILTER}
 ORDER BY abseits_pct DESC NULLS LAST
 LIMIT 25`,
  },

  {
    schluessel: 'pa_betrieb_tabelle',
    name: 'Betriebe im Überblick',
    beschreibung:
      'Alle ausgewerteten Betriebe mit Ausgaben, Anteil abseits der Liste und der Angabe, wie belastbar die Zahl ist. „dünn" heißt weniger als zehn Bestellungen oder weniger als 5.000 € im Laufzeitraum. Die Spalte „Unklar" nennt den Anteil, der auf Artikel mit abweichender Nummer entfällt — je höher sie ist, desto eher ist der Anteil daneben zu hoch angesetzt. Klick auf den Betrieb öffnet die Artikel dahinter.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT konzept          AS "Konzept",
       betrieb          AS "Betrieb",
       bestellungen     AS "Bestellungen",
       ausgaben         AS "Einkauf gesamt (EUR)",
       ausgaben_abseits AS "davon abseits (EUR)",
       abseits_pct      AS "Abseits (%)",
       namensgleich_pct AS "Unklar (%)",
       datenbasis       AS "Datenbasis",
       von_monat        AS "von",
       bis_monat        AS "bis"
  FROM mart.pflichtartikel_betrieb
 WHERE true${FILTER}
 ORDER BY abseits_pct DESC NULLS LAST`,
  },

  {
    schluessel: 'pa_verlauf',
    name: 'Verlauf je Monat',
    beschreibung:
      'Wie sich der Anteil abseits der Liste über die Laufzeit entwickelt. Ein Sprung nach oben ist meist keine Verhaltensänderung, sondern ein Lieferant, der eine Artikelnummer umgestellt hat — die Arbeitsliste „Nachfolgenummern" sagt, ob es das war. Randmonate sind angeschnitten: die Wilma-Wunder-Karte beginnt am 13. April und endet am 4. Oktober.',
    anzeige: 'line',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT monat AS "Monat",
       round(100.0 * sum(ausgaben) FILTER (WHERE zustand = 'abseits')
             / nullif(sum(ausgaben), 0), 1) AS "Abseits der Liste (%)"
  FROM mart.pflichtartikel_einkauf
 WHERE true${FILTER}
 GROUP BY monat
 ORDER BY monat`,
  },

  {
    schluessel: 'pa_lieferant',
    name: 'Abseits der Liste — nach Lieferant',
    beschreibung:
      'Bei welchen Lieferanten der Einkauf abseits der Liste anfällt. Das trennt die beiden Fälle, die sich sonst vermischen: ein freigegebener Lieferant mit vielen Positionen außerhalb der Liste bedeutet eine unvollständige Liste, ein unbekannter Lieferant bedeutet Einkauf außerhalb des Systems. Der zweite Fall gehört auf die Seite „Fremdeinkauf".',
    anzeige: 'row',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT coalesce(lieferant, 'ohne Lieferantenangabe') AS "Lieferant",
       round(sum(ausgaben)) AS "Abseits der Liste (EUR)"
  FROM mart.pflichtartikel_abseits
 WHERE true${FILTER}
 GROUP BY 1
 ORDER BY 2 DESC
 LIMIT 20`,
  },

  // -------------------------------------------------------------------
  // Der Drilldown: was genau wurde gekauft.
  // -------------------------------------------------------------------
  {
    schluessel: 'pa_abseits_artikel',
    name: 'Was abseits der Liste gekauft wurde',
    beschreibung:
      'Die einzelnen Artikel hinter der Quote, nach Ausgaben sortiert — die eigentliche Arbeitsliste. Hier entscheidet sich, ob eine hohe Quote ein Befund ist: stehen oben Reinigungsmittel, Verpackung oder Kaffee, fehlt der Liste eine Warengruppe. Steht dort ein Konkurrenzprodukt zu einem Pflichtartikel, ist es einer.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE, LIEFERANT],
    sql: `
SELECT betrieb           AS "Betrieb",
       artikel           AS "Artikel",
       artikelnummer     AS "Artikelnummer",
       lieferant         AS "Lieferant",
       positionen        AS "Bestellpositionen",
       ausgaben          AS "Ausgaben (EUR)",
       letzte_bestellung AS "zuletzt bestellt"
  FROM mart.pflichtartikel_abseits
 WHERE true${FILTER}
   [[AND lieferant = {{lieferant}}]]
 ORDER BY ausgaben DESC
 LIMIT 500`,
  },

  {
    /*
     * Die Einspeisung fuer pflege/pflichtartikel_alias.csv.
     *
     * Bewusst NICHT nach Betrieb gefiltert: das ist eine Frage der
     * Listenpflege und keine des einzelnen Betriebs. Ein Artikel, den
     * zwanzig Betriebe unter derselben abweichenden Nummer bestellen,
     * ist eine Nachfolgenummer und kein Verhalten.
     */
    schluessel: 'pa_verdacht',
    name: 'Nachfolgenummern — zu bestätigen',
    beschreibung:
      'Artikel, deren Name eine Position der Pflichtartikelliste trifft, deren Nummer aber abweicht. Je mehr Betriebe dieselbe abweichende Nummer bestellen, desto sicherer ist es eine Nachfolgenummer des Lieferanten und kein Verstoß. Bestätigte Fälle werden in pflege/pflichtartikel_alias.csv eingetragen; ab dem nächsten nächtlichen Lauf zählt der Artikel als Pflichtartikel und verschwindet von hier. Nicht nach Betrieb gefiltert — das ist Listenpflege, keine Betriebsfrage.',
    anzeige: 'table',
    parameter: [MARKE],
    sql: `
SELECT konzept               AS "Konzept",
       bestellter_artikel    AS "So bestellt",
       bestellte_nummer      AS "bestellte Nummer",
       bezeichnung_auf_liste AS "So auf der Liste",
       nummer_auf_liste      AS "Nummer auf der Liste",
       lieferant_auf_liste   AS "Lieferant",
       betriebe              AS "Betriebe",
       ausgaben              AS "Ausgaben (EUR)",
       letzte_bestellung     AS "zuletzt bestellt"
  FROM mart.pflichtartikel_verdacht
 WHERE true
   [[AND konzept = {{marke}}]]
 ORDER BY ausgaben DESC
 LIMIT 200`,
  },

  // -------------------------------------------------------------------
  // Die Gegenrichtung: welcher Pflichtartikel fehlt.
  // -------------------------------------------------------------------
  {
    /*
     * DIE UEBERSICHT VOR DER LISTE, UND ZWAR AUS EINEM GEMESSENEN GRUND.
     *
     * Ungefiltert stehen 4.668 fehlende Zeilen an (22.08.2026: Aposto
     * 434, Enchilada 2.136, Wilma Wunder 2.123). Die Detailtabelle
     * darunter kann das nicht zeigen — Metabase bricht native Abfragen
     * bei 2.000 Zeilen ab, und eine abgeschnittene Liste sieht aus wie
     * eine vollstaendige. Diese Karte zaehlt deshalb, statt aufzuzaehlen;
     * die Liste darunter ist fuer EINEN Betrieb gedacht.
     */
    schluessel: 'pa_abdeckung_betrieb',
    name: 'Wie viele Pflichtartikel fehlen je Betrieb',
    beschreibung:
      'Wie viele Artikel der Pflichtartikelliste ein Betrieb im Laufzeitraum nicht bezogen hat. Die Zahl ist eine Obergrenze: ein Artikel kann unter einer Nachfolgenummer gekauft worden sein, und Artikel, die kein einziger Betrieb bezieht, stehen fast immer für eine veraltete Liste — beides steht auf dem Reiter „Listenpflege". Positionen ohne Artikelnummer sind nicht enthalten.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT konzept AS "Konzept",
       betrieb AS "Betrieb",
       count(*) FILTER (WHERE NOT bezogen) AS "fehlende Pflichtartikel",
       count(*)                            AS "Pflichtartikel gesamt",
       round(100.0 * count(*) FILTER (WHERE bezogen) / nullif(count(*), 0), 1)
         AS "bezogen (%)"
  FROM mart.pflichtartikel_abdeckung
 WHERE NOT optional${FILTER}
 GROUP BY 1, 2
 ORDER BY 3 DESC`,
  },

  {
    schluessel: 'pa_abdeckung_fehlend',
    name: 'Welche Pflichtartikel fehlen',
    beschreibung:
      'Die einzelnen Artikel, die im Laufzeitraum nicht bestellt wurden. Für einen einzelnen Betrieb gedacht — ohne Betriebsfilter stehen über 4.000 Zeilen an, von denen Metabase nur die ersten 2.000 anzeigt. Drei Einschränkungen gehören dazu: Positionen ohne Artikelnummer fehlen hier (über die Nummer nicht prüfbar), ein Artikel kann unter einer Nachfolgenummer gekauft worden sein, und regionale Gerichte erscheinen nur bei den Betrieben, für die sie gelten.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT betrieb       AS "Betrieb",
       bereich       AS "Bereich",
       lieferant     AS "Lieferant",
       artikelnummer AS "Artikelnummer",
       bezeichnung   AS "Pflichtartikel",
       nur_betriebe  AS "nur für"
  FROM mart.pflichtartikel_abdeckung
 WHERE NOT bezogen
   AND NOT optional${FILTER}
 ORDER BY betrieb, bereich, lieferant, bezeichnung
 LIMIT 2000`,
  },

  {
    /*
     * DIE KARTE, DIE EINE LISTENPFLEGE VON EINEM BETRIEBSPROBLEM
     * UNTERSCHEIDET. Ein Artikel, den KEIN Betrieb bezieht, ist fast nie
     * ein Verstoss von allen gleichzeitig — er ist ausgelistet,
     * umnummeriert oder stand nie im Sortiment.
     */
    schluessel: 'pa_abdeckung_niemand',
    name: 'Pflichtartikel, die niemand bezieht',
    beschreibung:
      'Artikel, die auf der Liste stehen und von keinem einzigen Betrieb des Konzepts bestellt wurden. Das ist so gut wie nie ein Verstoß aller Betriebe gleichzeitig, sondern ein Hinweis auf die Liste selbst: ausgelistet, umnummeriert oder nie im Sortiment. Die erste Adresse, wenn eine Quote unerklärlich hoch aussieht.',
    anzeige: 'table',
    parameter: [MARKE],
    sql: `
SELECT konzept       AS "Konzept",
       bereich       AS "Bereich",
       lieferant     AS "Lieferant",
       artikelnummer AS "Artikelnummer",
       bezeichnung   AS "Pflichtartikel",
       count(*)      AS "Betriebe ohne Bezug"
  FROM mart.pflichtartikel_abdeckung
 WHERE NOT optional
   [[AND konzept = {{marke}}]]
 GROUP BY 1, 2, 3, 4, 5
HAVING count(*) FILTER (WHERE bezogen) = 0
 ORDER BY 6 DESC, 5
 LIMIT 300`,
  },

  // -------------------------------------------------------------------
  // Der Pflegestand: was die Auswertung ueber sich selbst weiss.
  // -------------------------------------------------------------------
  {
    schluessel: 'pa_nicht_pruefbar',
    name: 'Nicht über die Nummer prüfbar',
    beschreibung:
      'Positionen der Pflichtartikellisten ohne Artikelnummer — überwiegend Getränke vom regionalen Getränkefachgroßhandel, wo jeder Betrieb einen eigenen Nummernkreis hat. Für sie ist der Namensabgleich der einzige Nachweis. „kein Treffer" heißt nicht „wird nicht geführt", sondern ebenso gut, dass der Händler den Artikel anders schreibt. Erst eine nachgetragene Artikelnummer in pflege/pflichtartikel.csv macht daraus eine Messung.',
    anzeige: 'table',
    parameter: [MARKE],
    sql: `
SELECT konzept              AS "Konzept",
       bereich              AS "Bereich",
       lieferant            AS "Lieferant",
       bezeichnung          AS "Pflichtartikel",
       zustand              AS "Stand",
       betriebe_mit_treffer AS "Betriebe mit Treffer",
       ausgaben             AS "Ausgaben (EUR)"
  FROM mart.pflichtartikel_nicht_pruefbar
 WHERE true
   [[AND konzept = {{marke}}]]
 ORDER BY betriebe_mit_treffer, konzept, lieferant, bezeichnung`,
  },

  {
    schluessel: 'pa_listen',
    name: 'Die Listen und ihre Laufzeit',
    beschreibung:
      'Welche Pflichtartikelliste gerade gilt, wie lange noch und wie viele Positionen sie führt. Die Spalte „ohne Nummer" begrenzt, wie viel überhaupt geprüft werden kann. Läuft eine Liste aus, misst diese Seite ab dem Folgetag nichts mehr — die Nachfolgeliste kommt als Datei nach pflege/ und braucht keine Programmänderung.',
    anzeige: 'table',
    parameter: [MARKE],
    sql: `
SELECT konzept      AS "Konzept",
       bereich      AS "Bereich",
       liste        AS "Liste",
       gueltig_von  AS "gilt ab",
       gueltig_bis  AS "gilt bis",
       laeuft       AS "läuft",
       artikel      AS "Positionen",
       mit_nummer   AS "mit Nummer",
       ohne_nummer  AS "ohne Nummer",
       nur_regional AS "nur regional",
       lieferanten  AS "Lieferanten"
  FROM mart.pflichtartikel_stand
 WHERE true
   [[AND konzept = {{marke}}]]
 ORDER BY konzept, bereich`,
  },

  // -------------------------------------------------------------------
  // Die Kachel fuer ③ Betrieb.
  // -------------------------------------------------------------------
  {
    /*
     * Bewusst dieselbe Rechnung wie pa_abseits_quote, nicht eine
     * eigene: eine Kachel, die beim Klick auf eine andere Zahl fuehrt
     * als sie selbst zeigt, ist schlimmer als keine Kachel.
     */
    schluessel: 'pa_kachel_betrieb',
    name: 'Einkauf abseits der Pflichtartikel',
    beschreibung:
      'Der Anteil des Einkaufs, der an der Pflichtartikelliste des Konzepts vorbeiläuft. Leer, wenn für das Konzept keine Liste hinterlegt ist — das gilt derzeit für Deutsche Konzepte. Klick öffnet die Auswertung mit den Artikeln dahinter.',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT round(100.0 * coalesce(sum(ausgaben_abseits), 0)
             / nullif(sum(ausgaben), 0), 1) AS "Abseits der Pflichtartikel (%)"
  FROM mart.pflichtartikel_betrieb
 WHERE true${FILTER}`,
    visualisierung: { suffix: ' %' },
  },
]
