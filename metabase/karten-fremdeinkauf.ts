// =====================================================================
// Fremdeinkauf und Preisvergleich — die Auswertung, die "GFGH Q2 2026.xlsx"
// von den Betrieben erfragen wollte und zu 8,7 Prozent zurueckbekam.
//
// DREI REGELN, DIE HIER JEDE KARTE BEFOLGT. Sie stehen nicht aus Ordnungs-
// liebe da, sondern weil jede von ihnen schon einmal eine falsche Zahl
// erzeugt hat (docs/befunde-datenlage.md, 12.08.2026):
//
//   1. NIE UEBER quelle SUMMIEREN. mart.fremdeinkauf fuehrt dieselbe
//      Rechnung in FoodNotify UND im Belegarchiv. Tabellen tragen die
//      Spalte "Quelle" und gruppieren danach; Diagramme und Kacheln legen
//      die Quelle fest, weil sie keine Spalte dafuer haben. Es gibt in
//      dieser Datei keine einzige Summe ueber beide Quellen.
//
//   2. IMMER wareneinkauf IS TRUE. Das Belegarchiv fuehrt ALLE
//      Eingangsrechnungen. Ohne den Filter zaehlen visa (1,6 Mio),
//      pay one (1,3 Mio), Stadtwerke und Finanzamt als Fremdeinkauf —
//      gemessen 29,8 von 126,6 Mio EUR, fast ein Viertel.
//
//   3. wareneinkauf IS NULL IST KEIN BEFUND, sondern die Arbeitsliste.
//      44 Mio EUR auf 8.292 Namen sind noch nicht eingeordnet. Sie stehen
//      auf einer EIGENEN Karte, nicht unter den Befunden und nicht
//      stillschweigend weggefiltert — eine ausgeblendete Menge dieser
//      Groesse waere eine stille Kuerzung.
//
// Warum das Belegarchiv die Leitquelle ist: Fremdeinkauf ist in FoodNotify
// per Konstruktion fast unsichtbar. Wer beim nicht freigegebenen
// Lieferanten kauft, bestellt ihn nicht ueber das Bestellsystem des
// Konzerns. Das Belegarchiv sieht die Rechnung trotzdem.
// =====================================================================

import type { Karte, Parameter } from './typen'
import { P_BETRIEB, P_MARKE, P_SPERRE } from './gemeinsam'

const BETRIEB = P_BETRIEB
const MARKE = P_MARKE
const SPERRE = P_SPERRE

/**
 * Die einzelne Ware — nur fuer den Drill-Down in die Sperren, damit man
 * nach dem Klick von 300 Zeilen auf eine Ware herunterkommt. Gleiche
 * Bauart wie in karten-fach.ts: MIT Werteliste, denn
 * "Blumenk.i.backt10,2G Tk Veg7Kg" tippt niemand fehlerfrei, und ein
 * Tippfehler ergibt in Metabase keine Fehlermeldung, sondern eine leere
 * Karte.
 */
const WARE: Parameter = {
  id: 'ware-param', name: 'ware', 'display-name': 'Ware', type: 'string/=',
  werteliste: ['mart', 'einkaufspreis_monat', 'ware'],
}

/**
 * Zwoelf Monate zurueck. Als Textbaustein und nicht als CTE, weil diese
 * Sichten schon auf Monate aggregieren — ein Feldfilter braeuchte je Karte
 * eine andere Tabelle, genau der Grund, aus dem db_einkauf keinen
 * Zeitraumfilter hat.
 */
const ZWOELF_MONATE =
  `monat >= (date_trunc('month', current_date) - interval '12 months')::date`

/**
 * Der Zustand, den eine Kachel beim Klick mitgibt.
 *
 * Die drei Werte entsprechen EXAKT den drei Zaehlkacheln oben auf
 * db_fremdeinkauf — sie duerfen sich ueberlappen ('bestätigt' ist eine
 * Teilmenge von 'ohne Freigabe'), weil ein Filter immer nur EINEN Wert
 * traegt und jeder Wert seine eigene Menge beschreibt. Wer die Kachel
 * "7,9 Mio ohne Freigabe" klickt, muss auf dem Ziel dieselben 7,9 Mio
 * wiederfinden — eine disjunkte Einteilung haette das verfehlt.
 *
 * Ungesetzt gilt 'ohne Freigabe': das ist die Zahl, um die es der Seite
 * geht. Dieselbe coalesce-Bauart wie MONAT_CTE in gemeinsam.ts.
 */
const ZUSTAND_WAHL = `CASE coalesce([[ {{zustand}}, ]] 'ohne Freigabe')
     WHEN 'bestätigt' THEN wareneinkauf IS TRUE
                       AND grund IN ('ausdruecklich gesperrt', 'fremder getraenkehaendler')
     WHEN 'ungeklärt' THEN wareneinkauf IS NULL
     ELSE einordnung = 'nicht freigegeben' AND wareneinkauf IS TRUE
   END`

const ZUSTAND: Parameter = {
  id: 'zustand-param', name: 'zustand', 'display-name': 'Zustand', type: 'string/=',
  festeWerte: ['ohne Freigabe', 'bestätigt', 'ungeklärt'],
}

/**
 * Der einzelne Lieferant (Dachname). OHNE Werteliste, wie F_INVENTUR und
 * F_BESTELLUNG: der Filter wird geklickt, nicht getippt — eine
 * Auswahlliste mit tausenden OCR-Namen waere keine Hilfe.
 */
const LIEFERANT: Parameter = {
  id: 'lieferant-param', name: 'lieferant', 'display-name': 'Lieferant', type: 'string/=',
}

export const karten: Karte[] = [

  // -------------------------------------------------------------------
  // Die drei Kacheln oben: wie gross ist es, wie viel ist ungeklaert,
  // wie viele Betriebe betrifft es.
  // -------------------------------------------------------------------
  {
    /*
     * DIESE KACHEL IST KEIN BEFUND, UND SIE HAT ES EINE ZEIT LANG SO
     * AUSGESEHEN.
     *
     * Gemeldet am 12.08.2026: "7.930.024 hoert sich viel zu viel an."
     * Nachgesehen — die Zahl stimmt, aber sie misst zum groessten Teil eine
     * leere Pflegetabelle:
     *
     *   26 Lieferanten tragen die Summe, ALLE mit dem Grund "steht nicht
     *   auf der Liste". Kein einziger ist gesperrt.
     *
     *   6,92 der 7,93 Mio EUR entfallen auf 48 Betriebe, fuer die
     *   ueberhaupt kein GFGH hinterlegt ist. Von 57 operativen Betrieben
     *   haben 13 einen Eintrag in manual.gfgh_betrieb.
     *
     *   Die Freigabeliste hat FUENF Eintraege: CF Gastro, Chefs Culinar,
     *   Distra, J.J. Darboven, Layer-Chemie.
     *
     *   Der Rest sind der Reihe nach: ein konzernweiter Lieferant mit 53
     *   von 57 Betrieben (1,89 Mio), regionale Brauereien und
     *   Getraenkefachgrosshaendler (zusammen rund 4,3 Mio), dazu Metzger
     *   und Obsthaendler. Also genau die Lieferanten, die ein
     *   Gastronomiebetrieb hat — nur eben nicht eingetragen.
     *
     * Deshalb heisst die Kachel jetzt, was sie zaehlt, und der Befund
     * steht in der Kachel daneben (fe_bestaetigt). Die Zahl bleibt
     * unveraendert; niemand darf eine Freigabe erfinden, indem er die
     * Auswertung anders rechnet.
     */
    schluessel: 'fe_summe',
    name: 'Einkauf ohne Freigabe, 12 Monate',
    beschreibung:
      'Wareneinkauf bei Lieferanten, die weder auf der Konzernfreigabe stehen noch der hinterlegte GFGH ihres Betriebs sind — aus dem Belegarchiv, also aus den Rechnungen selbst. Nur operative Betriebe. NICHT als Verstoß lesen: gemessen am 12.08.2026 entfielen 6,92 von 7,93 Mio € auf 48 Betriebe, für die überhaupt kein GFGH hinterlegt ist, und die Freigabeliste hatte fünf Einträge. Die Zahl ist damit vor allem ein Pflegestand — der bestätigte Fremdeinkauf steht in der Kachel daneben. Nicht enthalten: Strom, Leasing, Kartengebühren, Konzerninnenumsatz und alles andere, was kein Wareneinkauf ist, sowie Lieferanten, die noch niemand eingeordnet hat.',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    // coalesce: ein Betrieb ohne Fremdeinkauf zeigt 0, keine leere Kachel
    // — leer liest sich als "kaputt", nicht als "nichts".
    sql: `
SELECT round(coalesce(sum(netto), 0)) AS "Fremdeinkauf netto (12 Monate)"
  FROM mart.fremdeinkauf
 WHERE quelle = 'belegarchiv'
   AND wareneinkauf IS TRUE
   AND einordnung = 'nicht freigegeben'
   AND operativ
   AND ${ZWOELF_MONATE}
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]`,
  },

  {
    schluessel: 'fe_ungeklaert',
    name: 'Noch nicht eingeordnet',
    beschreibung:
      'Einkaufsvolumen bei Lieferanten, bei denen niemand entschieden hat, ob es überhaupt Wareneinkauf ist. Das ist keine Fehlermenge und kein Befund, sondern die Arbeitsliste: solange sie groß ist, ist die Fremdeinkaufszahl daneben eine Untergrenze. Gepflegt wird in manual.lieferant_art.',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT round(coalesce(sum(netto), 0)) AS "Ungeklärtes Volumen (12 Monate)"
  FROM mart.fremdeinkauf
 WHERE quelle = 'belegarchiv'
   AND wareneinkauf IS NULL
   AND operativ
   AND ${ZWOELF_MONATE}
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]`,
  },

  {
    schluessel: 'fe_betriebe_betroffen',
    name: 'Betriebe ohne Freigabe des Lieferanten',
    beschreibung:
      'Wie viele operative Betriebe in den letzten zwölf Monaten mindestens einmal bei einem Lieferanten ohne Freigabe eingekauft haben. Steht die Zahl nahe an der Gesamtzahl der Betriebe, ist es kein Verhalten einzelner Betriebe, sondern eine Lücke in der Freigabeliste.',
    anzeige: 'scalar',
    // Auch der Betriebsfilter: mit gewaehltem Betrieb steht hier 1 oder 0.
    // Vorher war die Kachel die einzige der Reihe, die nicht reagierte —
    // sie zeigte 48 neben drei gefilterten Nachbarn, als waeren die 48
    // eine Aussage ueber den gewaehlten Betrieb.
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT count(DISTINCT betrieb_key) AS "Betriebe ohne Freigabe"
  FROM mart.fremdeinkauf
 WHERE quelle = 'belegarchiv'
   AND wareneinkauf IS TRUE
   AND einordnung = 'nicht freigegeben'
   AND operativ
   AND ${ZWOELF_MONATE}
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]`,
  },

  {
    /*
     * DER EIGENTLICHE BEFUND, und er ist heute klein.
     *
     * Zwei Gruende gelten als Befund, weil jemand etwas ENTSCHIEDEN hat:
     *
     *   ausdruecklich gesperrt      — steht mit freigegeben = false in
     *                                 manual.lieferant_freigabe.
     *   fremder getraenkehaendler   — der Betrieb hat einen GFGH hinterlegt
     *                                 und kauft bei einem anderen.
     *
     * Alles andere heisst "steht nicht auf der Liste" und ist eine
     * Aussage ueber die Liste, nicht ueber den Einkauf. Solange die
     * Freigabeliste fuenf Eintraege hat, ist diese Kachel die einzige,
     * die man weitergeben kann.
     */
    schluessel: 'fe_bestaetigt',
    name: 'Bestätigter Fremdeinkauf',
    beschreibung:
      'Der Teil, bei dem jemand tatsächlich entschieden hat: ausdrücklich gesperrte Lieferanten, und Betriebe mit hinterlegtem GFGH, die woanders kaufen. Nur das ist ein Befund. Die Kachel links zählt zusätzlich alle Lieferanten, über die noch nie jemand entschieden hat — das ist ein Pflegestand, kein Verstoß.',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT round(coalesce(sum(netto), 0)) AS "Bestätigt (12 Monate)"
  FROM mart.fremdeinkauf
 WHERE quelle = 'belegarchiv'
   AND wareneinkauf IS TRUE
   AND grund IN ('ausdruecklich gesperrt', 'fremder getraenkehaendler')
   AND operativ
   AND ${ZWOELF_MONATE}
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]`,
  },

  {
    /*
     * Der Pflegestand als eigene Karte, nicht als Fussnote. Er ist die
     * Erklaerung fuer die Groesse der Zahl oben, und ohne ihn liest sich
     * jede Zeile dieser Seite als Vorwurf.
     */
    schluessel: 'fe_pflegestand',
    name: 'Woran die Zahl oben hängt',
    beschreibung:
      'Der Stand der drei Listen, aus denen die Einordnung kommt. Jede Lücke hier vergrößert die Zahl oben, ohne dass im Einkauf irgendetwas passiert wäre. Umgekehrt: wer eine Zeile pflegt, verkleinert sie — deshalb ist die Auswertung eine Arbeitsliste und kein Bericht.',
    anzeige: 'table',
    sql: `
WITH zeitraum AS (
  SELECT * FROM mart.fremdeinkauf
   WHERE quelle = 'belegarchiv' AND operativ AND ${ZWOELF_MONATE}
), lieferanten AS (
  SELECT lieferant,
         bool_or(wareneinkauf IS TRUE)  AS ist_ware,
         bool_or(wareneinkauf IS NULL)  AS unbekannt
    FROM zeitraum GROUP BY lieferant
)
SELECT 'Lieferanten eingeordnet (Ware oder nicht)' AS "Grundlage",
       (SELECT count(*) FROM lieferanten WHERE NOT unbekannt) AS "gepflegt",
       (SELECT count(*) FROM lieferanten WHERE unbekannt)     AS "offen",
       'manual.lieferant_art'                                 AS "Tabelle",
       'Offene zählen gar nicht mit — die Zahl oben ist eine Untergrenze.' AS "Wirkung"
UNION ALL
SELECT 'Lieferanten mit Konzernfreigabe',
       (SELECT count(*) FROM manual.lieferant_freigabe WHERE freigegeben),
       (SELECT count(*) FROM lieferanten WHERE ist_ware)
         - (SELECT count(*) FROM manual.lieferant_freigabe WHERE freigegeben),
       'manual.lieferant_freigabe',
       'Wer fehlt, zählt als nicht freigegeben — auch die Brauerei mit Vertrag.'
UNION ALL
SELECT 'Betriebe mit hinterlegtem GFGH',
       (SELECT count(*) FROM manual.gfgh_betrieb),
       (SELECT count(DISTINCT betrieb_key) FROM zeitraum)
         - (SELECT count(*) FROM manual.gfgh_betrieb),
       'manual.gfgh_betrieb',
       'Ohne Eintrag zählt die Getränkelieferung des Betriebs als Fremdeinkauf.'`,
  },

  {
    /*
     * NUR fuer die Verweise von db_einkauf und dd_betrieb aus, und BEWUSST
     * ohne Marken-Parameter.
     *
     * db_einkauf filtert nach dem FOODNOTIFY-MANDANTEN (F_MARKE_EINKAUF,
     * vier Werte aus mart.einkauf_ladestand), diese Sichten nach dem
     * Round-Table-Konzept. Beide Filter heissen `marke`, und
     * uebernehmen.ts verdrahtet nach Namen — fe_summe stuende dort also
     * mit "aposto" gegen konzept und zeigte dauerhaft eine leere Kachel,
     * ohne Fehlermeldung. Genau der Fehler, vor dem F_MARKE_EINKAUF selbst
     * schon einmal geschuetzt hat.
     */
    schluessel: 'fe_kachel_verweis',
    name: 'Einkauf ohne Freigabe, 12 Monate',
    beschreibung:
      'Wareneinkauf bei Lieferanten ohne Freigabe, aus dem Belegarchiv. Überwiegend Lieferanten, über die noch nie jemand entschieden hat — kein Verstoß, sondern ein Pflegestand. Klick öffnet die vollständige Auswertung mit Lieferanten, Betrieben und der Arbeitsliste.',
    anzeige: 'scalar',
    parameter: [BETRIEB],
    sql: `
SELECT round(coalesce(sum(netto), 0)) AS "Fremdeinkauf netto (12 Monate)"
  FROM mart.fremdeinkauf
 WHERE quelle = 'belegarchiv'
   AND wareneinkauf IS TRUE
   AND einordnung = 'nicht freigegeben'
   AND operativ
   AND ${ZWOELF_MONATE}
   [[AND betrieb = {{betrieb}}]]`,
  },

  // -------------------------------------------------------------------
  // Wer und wo
  // -------------------------------------------------------------------
  {
    schluessel: 'fe_lieferant',
    name: 'Nicht freigegebene Lieferanten nach Volumen',
    beschreibung:
      'Die Rangliste, nach der die Freigabeliste abgearbeitet wird: oben steht, wo das meiste Geld hingeht. Aus dem Belegarchiv. Wer hier berechtigt steht — eine Brauerei mit Liefervertrag, ein Winzer —, gehört in manual.lieferant_freigabe eingetragen und verschwindet dann aus dieser Karte. Die Liste schrumpft, während man sie abarbeitet.',
    anzeige: 'row',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT lieferant               AS "Lieferant",
       round(sum(netto))       AS "Einkauf (12 Monate)"
  FROM mart.fremdeinkauf
 WHERE quelle = 'belegarchiv'
   AND wareneinkauf IS TRUE
   AND einordnung = 'nicht freigegeben'
   AND operativ
   AND ${ZWOELF_MONATE}
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]
 GROUP BY lieferant
 ORDER BY sum(netto) DESC
 LIMIT 25`,
    visualisierung: {
      'graph.dimensions': ['Lieferant'],
      'graph.metrics': ['Einkauf (12 Monate)'],
      'graph.x_axis.title_text': 'Einkauf netto (€), letzte 12 Monate',
    },
  },

  {
    schluessel: 'fe_lieferant_tabelle',
    name: 'Nicht freigegebene Lieferanten — vollständig',
    beschreibung:
      'Dieselbe Rangliste als Tabelle, mit beiden Quellen getrennt und dem Grund daneben. „steht nicht auf der liste" ist der Normalfall und heißt: noch niemand hat entschieden. „ausdrücklich gesperrt" heißt, jemand hat entschieden — dagegen. Nie über die Spalte Quelle summieren: dieselbe Rechnung steht in beiden Zeilen.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT quelle                        AS "Quelle",
       lieferant                     AS "Lieferant",
       grund                         AS "Grund",
       coalesce(warengruppe, '—')    AS "Warengruppe",
       count(DISTINCT betrieb_key)   AS "Betriebe",
       sum(belege)                   AS "Belege",
       round(sum(netto))             AS "Einkauf netto",
       max(monat)                    AS "Letzter Monat"
  FROM mart.fremdeinkauf
 WHERE wareneinkauf IS TRUE
   AND einordnung = 'nicht freigegeben'
   AND operativ
   AND ${ZWOELF_MONATE}
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]
 GROUP BY quelle, lieferant, grund, warengruppe
 ORDER BY sum(netto) DESC
 LIMIT 300`,
  },

  {
    schluessel: 'fe_betrieb',
    name: 'Fremdanteil je Betrieb',
    beschreibung:
      'Je Betrieb: wie viel Wareneinkauf insgesamt, wie viel davon bei nicht freigegebenen Lieferanten, und der Anteil. Der Anteil ist die aussagekräftigere Spalte — ein großer Betrieb mit 5 % hat ein kleineres Problem als ein kleiner mit 50 %. Quelle getrennt, weil dieselbe Rechnung sonst doppelt zählt.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT quelle                       AS "Quelle",
       betrieb                      AS "Betrieb",
       konzept                      AS "Marke",
       round(sum(netto))            AS "Wareneinkauf gesamt",
       round(sum(netto) FILTER (WHERE einordnung = 'nicht freigegeben'))
                                    AS "davon nicht freigegeben",
       count(DISTINCT lieferant) FILTER (WHERE einordnung = 'nicht freigegeben')
                                    AS "Lieferanten davon",
       round(100.0 * sum(netto) FILTER (WHERE einordnung = 'nicht freigegeben')
             / nullif(sum(netto), 0), 1) AS "Fremdanteil %",
       max(gfgh_des_betriebs)       AS "GFGH des Betriebs"
  FROM mart.fremdeinkauf
 WHERE wareneinkauf IS TRUE
   AND operativ
   AND ${ZWOELF_MONATE}
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]
 GROUP BY quelle, betrieb, konzept
HAVING sum(netto) > 0
 ORDER BY 7 DESC NULLS LAST, 5 DESC NULLS LAST
 LIMIT 300`,
  },

  // -------------------------------------------------------------------
  // Was NICHT mitgezaehlt wurde — beide Richtungen, damit niemand
  // raten muss, was hinter der Zahl fehlt.
  // -------------------------------------------------------------------
  {
    schluessel: 'fe_arbeitsliste',
    name: 'Arbeitsliste: Lieferanten ohne Einordnung',
    beschreibung:
      'Lieferanten, bei denen noch nicht entschieden ist, ob ihre Rechnungen überhaupt Wareneinkauf sind. Nach Volumen sortiert — oben lohnt die Entscheidung am meisten. Eintragen in manual.lieferant_art: wareneinkauf, zahlungsdienst, bank_leasing, konzern, energie, handwerk_bau, behoerde, marketing_plattform, dienstleistung oder miete. Nach unten wird die Liste schnell klein und OCR-verrauscht; „cf" steht bewusst darin, weil es CF Gastro sein kann oder Concept Family.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT quelle                      AS "Quelle",
       lieferant                   AS "Lieferant (normiert)",
       -- Konstante Spalte fuer den Klick: der Drill-Down braucht neben dem
       -- Lieferanten den Zustand, sonst zeigte er 'ohne Freigabe' und die
       -- ungeklaerten Zeilen dieses Lieferanten blieben unsichtbar.
       'ungeklärt'                 AS "Zustand",
       count(DISTINCT betrieb_key) AS "Betriebe",
       sum(belege)                 AS "Belege",
       round(sum(netto))           AS "Volumen netto",
       max(monat)                  AS "Letzter Monat"
  FROM mart.fremdeinkauf
 WHERE wareneinkauf IS NULL
   AND operativ
   AND ${ZWOELF_MONATE}
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]
 GROUP BY quelle, lieferant
 ORDER BY sum(netto) DESC
 LIMIT 300`,
  },

  {
    schluessel: 'fe_kein_wareneinkauf',
    name: 'Aussortiert: kein Wareneinkauf',
    beschreibung:
      'Was aus der Fremdeinkaufszahl herausgerechnet wurde und warum. Das Belegarchiv führt alle Eingangsrechnungen — Strom, Leasing, Finanzamt, Kartengebühren, Rechnungen zwischen Konzerngesellschaften. Gemessen am 12.08.2026 waren das 29,8 von 126,6 Mio EUR. Diese Karte steht hier, damit die Abgrenzung prüfbar ist und nicht geglaubt werden muss.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT quelle                      AS "Quelle",
       lieferant_art               AS "Art",
       count(DISTINCT lieferant)   AS "Lieferanten",
       count(DISTINCT betrieb_key) AS "Betriebe",
       round(sum(netto))           AS "Volumen netto"
  FROM mart.fremdeinkauf
 WHERE wareneinkauf IS FALSE
   AND operativ
   AND ${ZWOELF_MONATE}
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]
 GROUP BY quelle, lieferant_art
 ORDER BY sum(netto) DESC`,
  },

  {
    schluessel: 'fe_freigabestand',
    name: 'Freigabeliste: Stand der Pflege',
    beschreibung:
      'Jeder Dachlieferant mit seiner Einordnung und dem Volumen aus beiden Quellen nebeneinander — nicht addiert, sondern in zwei Spalten. „trifft nichts" heißt: der Eintrag steht in der Freigabeliste, aber unter diesem Namen wurde nie eingekauft. Meist ein Schreibweisenproblem, kein leerer Lieferant. Konzernweit, deshalb ohne Betriebsfilter.',
    anzeige: 'table',
    sql: `
SELECT dach_name                        AS "Lieferant",
       einordnung                       AS "Einordnung",
       coalesce(warengruppe, '—')       AS "Warengruppe",
       ist_gfgh                         AS "Ist GFGH",
       gfgh_fuer_betriebe               AS "GFGH für Betriebe",
       trifft_nichts                    AS "Trifft nichts",
       fn_betriebe                      AS "FN Betriebe",
       round(fn_netto_operativ)         AS "FN netto (operativ)",
       beleg_schreibweisen              AS "Schreibweisen im Belegarchiv",
       beleg_betriebe                   AS "Beleg Betriebe",
       round(beleg_netto_operativ)      AS "Beleg netto (operativ)",
       -- greatest ueberspringt NULL von selbst und liefert nur dann NULL,
       -- wenn beide Seiten leer sind. Genau das ist hier gemeint.
       greatest(fn_letzter_beleg, beleg_letzter_beleg) AS "Letzter Beleg"
  FROM mart.lieferant_freigabe_stand
 ORDER BY coalesce(beleg_netto_operativ, 0) + coalesce(fn_netto_operativ, 0) DESC
 LIMIT 300`,
  },

  // -------------------------------------------------------------------
  // Preisvergleich — die eigentliche Excel-Frage
  // -------------------------------------------------------------------
  {
    schluessel: 'ep_abweichung',
    name: 'Wo ein Betrieb mehr zahlt als der Konzern',
    beschreibung:
      'Je Ware, Einheit, Betrieb und Monat: der Preis je Basiseinheit gegen den Median der anderen Betriebe. NUR vergleichbare Zeilen — drei operative Betriebe mit derselben Ware im selben Monat, einheitliche Gebinde, keine widersprüchliche Menge, Spreizung unter Faktor 3. Belastbar ist das im einstelligen bis niedrig zweistelligen Prozentbereich; wer eine dreistellige Abweichung weitergibt, prüft sie vorher am Beleg. FoodNotify, nicht Belegarchiv — nur dort stehen Artikel.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT betrieb                    AS "Betrieb",
       konzept                    AS "Marke",
       monat                      AS "Monat",
       ware                       AS "Ware",
       einheit                    AS "Einheit",
       lieferanten                AS "Lieferant",
       round(preis, 4)            AS "Preis je Einheit",
       round(konzern_median, 4)   AS "Konzern-Median",
       round(konzern_bester, 4)   AS "Bester im Konzern",
       abweichung_pct             AS "Abweichung %",
       round(mehrkosten)          AS "Mehrkosten",
       round(preis_je_gebinde, 2) AS "Preis je Gebinde",
       betriebe_operativ          AS "Betriebe im Vergleich"
  FROM mart.einkaufspreis_betrieb
 WHERE vergleichbar
   AND operativ
   AND abweichung_pct > 0
   AND ${ZWOELF_MONATE}
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]
 ORDER BY mehrkosten DESC NULLS LAST
 LIMIT 300`,
  },

  {
    schluessel: 'ep_betrieb',
    name: 'Mehrkosten je Betrieb',
    beschreibung:
      'Was ein Betrieb in zwölf Monaten mehr gezahlt hat als der Konzernmedian, über alle vergleichbaren Waren summiert. Eine Obergrenze für das Verhandlungspotenzial, keine Einsparzusage: der Median ist ein erreichter Preis, kein zugesagter. Betriebe mit negativer Summe kaufen günstiger ein als der Median — von denen lernt man.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT betrieb                        AS "Betrieb",
       konzept                        AS "Marke",
       count(DISTINCT ware)           AS "Waren im Vergleich",
       round(sum(mehrkosten) FILTER (WHERE mehrkosten > 0)) AS "Mehrkosten",
       round(sum(mehrkosten) FILTER (WHERE mehrkosten < 0)) AS "Minderkosten",
       round(sum(mehrkosten))         AS "Saldo",
       round(sum(ausgaben))           AS "Einkauf gesamt"
  FROM mart.einkaufspreis_betrieb
 WHERE vergleichbar
   AND operativ
   AND ${ZWOELF_MONATE}
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]
 GROUP BY betrieb, konzept
 ORDER BY 6 DESC NULLS LAST
 LIMIT 300`,
  },

  {
    schluessel: 'ep_nicht_vergleichbar',
    name: 'Warum eine Ware nicht verglichen wird',
    beschreibung:
      'Die vier Sperren, jede mit ihrer Menge. Sie stehen hier, weil eine ausgeschlossene Ware, die nirgends auftaucht, eine stille Kürzung wäre. „zu wenige Betriebe" ist der Normalfall und harmlos. „Gebinde uneinheitlich" und „Menge widersprüchlich" heißen, dass die Betriebe dieselbe Ware verschieden buchen — das ist ein Datenpflegethema, kein Preisthema. „Spreizung über Faktor 3" fängt, was die anderen drei durchlassen.',
    anzeige: 'table',
    parameter: [MARKE],
    /*
     * Die Fallunterscheidung stand bis 0063 hier als CASE. Sie steht jetzt
     * als Spalte in der Sicht, weil der Drill-Down darunter dieselbe
     * Einteilung braucht — zwei Kopien einer Fallunterscheidung sind zwei
     * Kopien zum Auseinanderlaufen. Die Zahlen sind dieselben: gleiche
     * Reihenfolge der Zweige, gleiche Schwellen.
     */
    sql: `
SELECT sperre                  AS "Sperre",
       count(*)                AS "Zeilen",
       count(DISTINCT ware)    AS "Waren",
       round(sum(ausgaben))    AS "Betroffener Einkauf"
  FROM mart.einkaufspreis_betrieb
 WHERE operativ
   AND ${ZWOELF_MONATE}
   [[AND konzept = {{marke}}]]
 GROUP BY sperre
 ORDER BY 4 DESC NULLS LAST`,
  },

  // -------------------------------------------------------------------
  // Der Drill-Down in eine Sperre. Zwei Karten, weil die Frage nach dem
  // Klick zwei Stufen hat: WELCHE Waren stecken dahinter, und was steht
  // in den einzelnen Betrieben.
  //
  // Beide filtern auf operativ und zwoelf Monate wie die Zaehlkarte
  // darueber — sonst zaehlt die Uebersicht 4.000 Zeilen und die Liste
  // zeigt 6.000, und niemand findet den Grund.
  // -------------------------------------------------------------------
  {
    schluessel: 'sp_waren',
    name: 'Waren hinter dieser Sperre',
    beschreibung:
      'Je Ware, Einheit und Monat: warum der Vergleich gesperrt ist und wie weit die Betriebe auseinanderliegen. Der Faktor ist der schlechteste durch den besten Preis je Basiseinheit — ab 3 greift die stumpfe Sperre. Die beiden Gebindepreis-Spalten daneben sind die Gegenprobe: laufen sie zusammen, während die Basiseinheit spreizt, ist es eine Mengenbuchung und kein Preisunterschied.',
    anzeige: 'table',
    parameter: [SPERRE, MARKE, WARE],
    sql: `
SELECT monat                              AS "Monat",
       ware                               AS "Ware",
       einheit                            AS "Einheit",
       max(sperre)                        AS "Sperre",
       max(betriebe_operativ)             AS "Betriebe operativ",
       max(betriebe_gesamt)               AS "Betriebe gesamt",
       count(DISTINCT gebinde_typisch)    AS "Gebindegrößen",
       round(max(konzern_bester), 4)      AS "Bester je Einheit",
       round(max(konzern_schlechtester), 4) AS "Schlechtester je Einheit",
       round(max(konzern_schlechtester)
             / nullif(max(konzern_bester), 0), 1) AS "Faktor",
       round(min(preis_je_gebinde), 2)    AS "Gebindepreis min",
       round(max(preis_je_gebinde), 2)    AS "Gebindepreis max",
       round(sum(ausgaben))               AS "Einkauf"
  FROM mart.einkaufspreis_betrieb
 WHERE operativ
   AND ${ZWOELF_MONATE}
   [[AND sperre = {{sperre}}]]
   [[AND konzept = {{marke}}]]
   [[AND ware = {{ware}}]]
 GROUP BY monat, ware, einheit
 ORDER BY sum(ausgaben) DESC NULLS LAST
 LIMIT 300`,
  },

  {
    schluessel: 'sp_positionen',
    name: 'Die einzelnen Betriebe',
    beschreibung:
      'Eine Zeile je Betrieb, Ware und Monat — die Positionen, aus denen die Sperre entstanden ist. „Gebinde typisch" ist die häufigste Gebindegröße dieses Betriebs in diesem Monat; stehen dort verschiedene Zahlen, buchen die Betriebe dieselbe Lieferung verschieden, und das ist der häufigste Grund für eine Sperre. Nach Ware und Preis sortiert, damit die Ausreißer nebeneinander stehen.',
    anzeige: 'table',
    parameter: [SPERRE, MARKE, WARE],
    sql: `
SELECT monat                        AS "Monat",
       ware                         AS "Ware",
       einheit                      AS "Einheit",
       betrieb                      AS "Betrieb",
       konzept                      AS "Marke",
       gebinde_typisch              AS "Gebinde typisch",
       bestellungen                 AS "Bestellungen",
       gebinde                      AS "Gebinde",
       round(menge, 2)              AS "Menge",
       round(preis, 4)              AS "Preis je Einheit",
       round(preis_je_gebinde, 2)   AS "Preis je Gebinde",
       round(ausgaben)              AS "Ausgaben",
       lieferanten                  AS "Lieferant",
       sperre                       AS "Sperre"
  FROM mart.einkaufspreis_betrieb
 WHERE operativ
   AND ${ZWOELF_MONATE}
   [[AND sperre = {{sperre}}]]
   [[AND konzept = {{marke}}]]
   [[AND ware = {{ware}}]]
 ORDER BY ware, monat DESC, preis DESC
 LIMIT 500`,
  },

  // -------------------------------------------------------------------
  // Der Drill-Down in die Fremdeinkaufszahl selbst. Vier Karten fuer
  // dd_fremdeinkauf, dieselbe Stellung wie sp_waren/sp_positionen zur
  // Sperren-Zaehlkarte: sie zeigen, WAS hinter einer der Zaehlkacheln
  // steckt — je Monat, je Betrieb, je Posten.
  //
  // Alle vier: quelle = 'belegarchiv' fest (Kacheln haben keine
  // Quellspalte, Regel 1 oben), operativ, zwoelf Monate, und derselbe
  // Zustand wie die angeklickte Kachel (ZUSTAND_WAHL).
  //
  // Feiner als Betrieb x Lieferant x Monat geht es hier nicht: das
  // Belegarchiv fuehrt keine Positionen (Weg A der Erhebung, 0053),
  // "belege" zaehlt die Rechnungen hinter einer Zeile.
  // -------------------------------------------------------------------
  {
    schluessel: 'fd_summe',
    name: 'Netto-Summe der Auswahl',
    beschreibung:
      'Dieselbe Rechnung wie die angeklickte Kachel — steht hier eine andere Zahl als dort, ist ein Filter im Spiel. Aus dem Belegarchiv, nur operative Betriebe, letzte zwölf Monate.',
    anzeige: 'scalar',
    parameter: [ZUSTAND, LIEFERANT, BETRIEB, MARKE],
    sql: `
SELECT round(coalesce(sum(netto), 0)) AS "Netto (12 Monate)"
  FROM mart.fremdeinkauf
 WHERE quelle = 'belegarchiv'
   AND operativ
   AND ${ZWOELF_MONATE}
   AND ${ZUSTAND_WAHL}
   [[AND lieferant = {{lieferant}}]]
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]`,
  },

  {
    schluessel: 'fd_verlauf',
    name: 'Verlauf je Monat',
    beschreibung:
      'Die Summe der Kachel, auf zwölf Monatsbalken verteilt. Der jüngste Balken kann noch wachsen: das Belegarchiv füllt nach, ein dünner aktueller Monat ist Ladestand, kein Rückgang.',
    anzeige: 'bar',
    parameter: [ZUSTAND, LIEFERANT, BETRIEB, MARKE],
    sql: `
SELECT monat             AS "Monat",
       round(sum(netto)) AS "Netto"
  FROM mart.fremdeinkauf
 WHERE quelle = 'belegarchiv'
   AND operativ
   AND ${ZWOELF_MONATE}
   AND ${ZUSTAND_WAHL}
   [[AND lieferant = {{lieferant}}]]
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]
 GROUP BY monat
 ORDER BY monat`,
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Netto'],
      'graph.y_axis.title_text': 'Netto (€)',
    },
  },

  {
    schluessel: 'fd_betriebe',
    name: 'Die Betriebe dahinter',
    beschreibung:
      'Je Betrieb: bei wie vielen Lieferanten, wie viele Rechnungen, wie viel Geld. Das ist die Liste hinter der Kachel „Betriebe ohne Freigabe des Lieferanten". Ein Klick auf den Betriebsnamen öffnet das Betriebsblatt.',
    anzeige: 'table',
    parameter: [ZUSTAND, LIEFERANT, BETRIEB, MARKE],
    sql: `
SELECT betrieb                     AS "Betrieb",
       konzept                     AS "Marke",
       count(DISTINCT lieferant)   AS "Lieferanten",
       sum(belege)                 AS "Belege",
       round(sum(netto))           AS "Netto",
       max(monat)                  AS "Letzter Monat"
  FROM mart.fremdeinkauf
 WHERE quelle = 'belegarchiv'
   AND operativ
   AND ${ZWOELF_MONATE}
   AND ${ZUSTAND_WAHL}
   [[AND lieferant = {{lieferant}}]]
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]
 GROUP BY betrieb, konzept
 ORDER BY sum(netto) DESC NULLS LAST
 LIMIT 300`,
  },

  {
    schluessel: 'fd_zeilen',
    name: 'Die einzelnen Posten',
    beschreibung:
      'Eine Zeile je Betrieb, Lieferant und Monat — feiner führt das Belegarchiv den Einkauf nicht, es kennt keine Positionen. „Belege" zählt die Rechnungen hinter der Zeile. Klick auf den Lieferanten grenzt die Seite auf ihn ein, Klick auf den Betrieb öffnet das Betriebsblatt.',
    anzeige: 'table',
    parameter: [ZUSTAND, LIEFERANT, BETRIEB, MARKE],
    sql: `
SELECT monat                       AS "Monat",
       betrieb                     AS "Betrieb",
       konzept                     AS "Marke",
       lieferant                   AS "Lieferant",
       -- Anzeige-Ersetzung, solange die Sicht den alten Wortlaut fuehrt;
       -- faellt weg, sobald der Sichtwert selbst umbenannt ist.
       CASE WHEN grund = 'gfgh des hauses' THEN 'gfgh des betriebs'
            ELSE grund END         AS "Grund",
       coalesce(warengruppe, '—')  AS "Warengruppe",
       belege                      AS "Belege",
       round(netto)                AS "Netto"
  FROM mart.fremdeinkauf
 WHERE quelle = 'belegarchiv'
   AND operativ
   AND ${ZWOELF_MONATE}
   AND ${ZUSTAND_WAHL}
   [[AND lieferant = {{lieferant}}]]
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]
 ORDER BY monat DESC, netto DESC NULLS LAST
 LIMIT 500`,
  },
]
