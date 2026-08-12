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

export const karten: Karte[] = [

  // -------------------------------------------------------------------
  // Die drei Kacheln oben: wie gross ist es, wie viel ist ungeklaert,
  // wie viele Haeuser betrifft es.
  // -------------------------------------------------------------------
  {
    schluessel: 'fe_summe',
    name: 'Fremdeinkauf, letzte 12 Monate',
    beschreibung:
      'Wareneinkauf bei Lieferanten, die weder auf der Konzernfreigabe stehen noch der hinterlegte GFGH ihres Hauses sind — aus dem Belegarchiv, also aus den Rechnungen selbst. Nur operative Betriebe. Nicht enthalten: Strom, Leasing, Kartengebühren, Konzerninnenumsatz und alles andere, was kein Wareneinkauf ist. Ebenfalls nicht enthalten sind Lieferanten, die noch niemand eingeordnet hat — die stehen in der Arbeitsliste weiter unten.',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT round(sum(netto)) AS "Fremdeinkauf netto (12 Monate)"
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
SELECT round(sum(netto)) AS "Ungeklärtes Volumen (12 Monate)"
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
    name: 'Betriebe mit Fremdeinkauf',
    beschreibung:
      'Wie viele operative Betriebe in den letzten zwölf Monaten mindestens einmal bei einem nicht freigegebenen Lieferanten Ware gekauft haben.',
    anzeige: 'scalar',
    parameter: [MARKE],
    sql: `
SELECT count(DISTINCT betrieb_key) AS "Betriebe mit Fremdeinkauf"
  FROM mart.fremdeinkauf
 WHERE quelle = 'belegarchiv'
   AND wareneinkauf IS TRUE
   AND einordnung = 'nicht freigegeben'
   AND operativ
   AND ${ZWOELF_MONATE}
   [[AND konzept = {{marke}}]]`,
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
    name: 'Fremdeinkauf, letzte 12 Monate',
    beschreibung:
      'Wareneinkauf bei nicht freigegebenen Lieferanten, aus dem Belegarchiv. Klick öffnet die vollständige Auswertung mit Lieferanten, Betrieben und der Arbeitsliste.',
    anzeige: 'scalar',
    parameter: [BETRIEB],
    sql: `
SELECT round(sum(netto)) AS "Fremdeinkauf netto (12 Monate)"
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
      'Je Betrieb: wie viel Wareneinkauf insgesamt, wie viel davon bei nicht freigegebenen Lieferanten, und der Anteil. Der Anteil ist die aussagekräftigere Spalte — ein großes Haus mit 5 % hat ein kleineres Problem als ein kleines mit 50 %. Quelle getrennt, weil dieselbe Rechnung sonst doppelt zählt.',
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
       max(gfgh_des_betriebs)       AS "GFGH des Hauses"
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
    name: 'Wo ein Haus mehr zahlt als der Konzern',
    beschreibung:
      'Je Ware, Einheit, Betrieb und Monat: der Preis je Basiseinheit gegen den Median der anderen Häuser. NUR vergleichbare Zeilen — drei operative Häuser mit derselben Ware im selben Monat, einheitliche Gebinde, keine widersprüchliche Menge, Spreizung unter Faktor 3. Belastbar ist das im einstelligen bis niedrig zweistelligen Prozentbereich; wer eine dreistellige Abweichung weitergibt, prüft sie vorher am Beleg. FoodNotify, nicht Belegarchiv — nur dort stehen Artikel.',
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
       betriebe_operativ          AS "Häuser im Vergleich"
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
      'Was ein Haus in zwölf Monaten mehr gezahlt hat als der Konzernmedian, über alle vergleichbaren Waren summiert. Eine Obergrenze für das Verhandlungspotenzial, keine Einsparzusage: der Median ist ein erreichter Preis, kein zugesagter. Häuser mit negativer Summe kaufen günstiger ein als der Median — von denen lernt man.',
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
      'Die vier Sperren, jede mit ihrer Menge. Sie stehen hier, weil eine ausgeschlossene Ware, die nirgends auftaucht, eine stille Kürzung wäre. „zu wenige Häuser" ist der Normalfall und harmlos. „Gebinde uneinheitlich" und „Menge widersprüchlich" heißen, dass die Häuser dieselbe Ware verschieden buchen — das ist ein Datenpflegethema, kein Preisthema. „Spreizung über Faktor 3" fängt, was die anderen drei durchlassen.',
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
  // in den einzelnen Haeusern.
  //
  // Beide filtern auf operativ und zwoelf Monate wie die Zaehlkarte
  // darueber — sonst zaehlt die Uebersicht 4.000 Zeilen und die Liste
  // zeigt 6.000, und niemand findet den Grund.
  // -------------------------------------------------------------------
  {
    schluessel: 'sp_waren',
    name: 'Waren hinter dieser Sperre',
    beschreibung:
      'Je Ware, Einheit und Monat: warum der Vergleich gesperrt ist und wie weit die Häuser auseinanderliegen. Der Faktor ist der schlechteste durch den besten Preis je Basiseinheit — ab 3 greift die stumpfe Sperre. Die beiden Gebindepreis-Spalten daneben sind die Gegenprobe: laufen sie zusammen, während die Basiseinheit spreizt, ist es eine Mengenbuchung und kein Preisunterschied.',
    anzeige: 'table',
    parameter: [SPERRE, MARKE, WARE],
    sql: `
SELECT monat                              AS "Monat",
       ware                               AS "Ware",
       einheit                            AS "Einheit",
       max(sperre)                        AS "Sperre",
       max(betriebe_operativ)             AS "Häuser operativ",
       max(betriebe_gesamt)               AS "Häuser gesamt",
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
    name: 'Die einzelnen Häuser',
    beschreibung:
      'Eine Zeile je Haus, Ware und Monat — die Positionen, aus denen die Sperre entstanden ist. „Gebinde typisch" ist die häufigste Gebindegröße dieses Hauses in diesem Monat; stehen dort verschiedene Zahlen, buchen die Häuser dieselbe Lieferung verschieden, und das ist der häufigste Grund für eine Sperre. Nach Ware und Preis sortiert, damit die Ausreißer nebeneinander stehen.',
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
]
