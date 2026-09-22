// =====================================================================
// Artikelaktion — eine Aktion, die ueber eine LISTE VON ARTIKELNUMMERN
// definiert ist, je Betrieb ausgewertet.
//
// Anlass (10.09.2026): Marketing von Wilma Wunder fragt nach der
// Auswertung des "Gluecksrads" (August 2026) je Standort und schickt
// dafuer eine Excel mit 51 Artikelnummern. Im Kassensystem ist das
// Gluecksrad KEINE Aktion (mart.aktion kennt es nicht) — die Aktion
// existiert nur als Liste von Artikeln plus Zeitraum. Genau das bildet
// dieses Dashboard ab, und zwar allgemein: wer die naechste Aktion
// auswerten will, fuegt die Nummern oben ein und setzt den Zeitraum.
//
// DREI ENTSCHEIDUNGEN, die man den Karten nicht ansieht:
//
//   1. Die Nummern kommen als FREITEXT, nicht als Auswahlliste. 51
//      Nummern aus einem Dropdown zu klicken macht niemand; aus einer
//      Excel-Spalte kopiert man sie in einem Zug. Getrennt wird an allem,
//      was keine Ziffer ist — Komma, Leerzeichen, Zeilenumbruch, alles
//      geht. Der Preis: eine vertippte Nummer trifft still nichts.
//      Deshalb die Pruefkarte am Ende (aa_liste_pruefung), die jede
//      Nummer ohne Treffer nennt. Regel 10 in Kartenform.
//
//   2. Gerechnet wird auf core.artikelverkauf_tag statt auf
//      mart.artikelverkauf. Die Tagessicht traegt sieben LEFT JOINs fuer
//      Warengruppen und Wareneinsatz, die hier niemand braucht; gebraucht
//      werden umsatz_brutto und verkaufspreis, die mart.artikel_monat
//      nicht fuehrt. Und core.betrieb statt mart.betrieb: die Sicht
//      rechnet ueber mart.betrieb_status den letzten Umsatztag JEDES
//      Betriebs ueber die ganze Umsatztabelle nach. Die Zeitraumgrenzen
//      stehen als faltbarer Ausdruck in jeder WHERE-Klausel — warum das
//      den Unterschied zwischen 8,4 s und 0,6 s macht, steht an VON/BIS.
//
//   3. Die Grundgesamtheit sind die Betriebe, die im Aktionszeitraum
//      mindestens EINEN Artikel der Liste verkauft haben. Nicht "alle
//      Betriebe der Marke": die Artikelnummern sind je Konzept vergeben,
//      und der Markenfilter ist optional. Ein Betrieb, der die Artikel
//      gar nicht fuehrt, wuerde sonst mit 0 % Anteil in der Tabelle
//      stehen und die Vergleiche verduennen.
//
// DER NACHLASS ist die eigentliche Aktionsspur. Beim Gluecksrad stieg er
// auf die Aktionsartikel von 3,7 % (Juli) auf 6,5 % (August), waehrend
// er beim uebrigen Sortiment stehen blieb — die Menge dagegen stieg kaum
// staerker als der Gesamtumsatz. Gerechnet als
//     1 - umsatz_brutto / (menge * verkaufspreis)
// brutto gegen brutto, weil verkaufspreis der Kartenpreis inkl. MwSt.
// ist (nachgemessen: brutto_je_stueck liegt nahe am verkaufspreis,
// netto_je_stueck rund 7 % darunter). Er enthaelt ALLE Rabatte, nicht
// nur die der Aktion; deshalb stehen der Zeitraum davor und das uebrige
// Sortiment immer daneben.
//
// ZWEI VERGLEICHSZEITRAEUME, beide gerechnet, keiner gewaehlt:
//   davor    gleich lang, unmittelbar vor dem Aktionszeitraum
//   Vorjahr  dieselben Daten ein Jahr frueher
// Der Vorjahresvergleich ist nie eine gleiche Basis (neue Betriebe,
// neue Artikel) — das sagt der Kopftext der Seite.
// =====================================================================

import type { Karte } from './typen'
import { P_ARTIKELNUMMERN, P_VON, P_BIS, P_MARKE, P_BETRIEB, P_FINANZWEG } from './gemeinsam'

const PARAMETER = [P_ARTIKELNUMMERN, P_VON, P_BIS, P_MARKE, P_BETRIEB]

/**
 * Der gemeinsame Unterbau aller Karten dieser Seite.
 *
 * `zeitraum` leitet aus Von/Bis (Rueckfall: der letzte abgeschlossene
 * Monat) die beiden Vergleichszeitraeume ab, `liste` zerlegt den Freitext in Nummern,
 * `betriebe` bestimmt die Grundgesamtheit, und `verkauf` holt jede
 * Verkaufszeile dieser Betriebe in den drei Zeitraeumen — MIT den
 * Artikeln, die nicht auf der Liste stehen, denn "Anteil am Umsatz"
 * und "Nachlass uebriges Sortiment" brauchen den Rest.
 *
 * Der Markenfilter greift auf das Hauptkonzept, der Betriebsfilter auf
 * den Namen — dieselben Spalten wie ueberall sonst.
 */
/**
 * Die Zeitraumgrenzen — als AUSDRUCK, der in jede WHERE-Klausel kopiert
 * wird, nicht als Unterabfrage auf die CTE. Das ist ein Messwert, keine
 * Stilfrage: mit `(SELECT von FROM zeitraum)` brauchte jede Karte 8,4 s,
 * mit Literalen 0,6 s (10.09.2026, dieselbe Abfrage). Der Unterschied
 * ist, WANN Postgres die Monatspartitionen wegschneidet. Eine
 * Unterabfrage ist zur Planzeit unbekannt; der Plan enthaelt dann alle
 * rund hundert Partitionen mit je vier Scan-Knoten, und jeder parallele
 * Worker initialisiert diese 1.700 Knoten, bevor er die drei liest, die
 * er braucht — das sind die fuenf Sekunden Anlaufzeit im EXPLAIN.
 * `coalesce('2026-08-01'::date, …)` dagegen faltet der Planer zu einer
 * Konstanten, sobald Metabase den Filterwert eingesetzt hat, und der
 * Plan kennt nur noch die drei Partitionen.
 *
 * Ohne gesetzten Filter (current_date-Rueckfall) bleibt es beim
 * langsamen Weg — deshalb tragen Von und Bis auf dem Dashboard eine
 * feste Vorgabe (dashboards.ts).
 */
const VON = `coalesce([[ {{von}}::date, ]] date_trunc('month', current_date - interval '1 month')::date)`
const BIS = `coalesce([[ {{bis}}::date, ]] (date_trunc('month', current_date)::date - 1))`
const VOR_VON = `(${VON} - (${BIS} - ${VON} + 1))`
const VOR_BIS = `(${VON} - 1)`
const VJ_VON = `(${VON} - interval '1 year')::date`
const VJ_BIS = `(${BIS} - interval '1 year')::date`

const AKTION_CTE = `
WITH zeitraum AS (
    SELECT ${VON}                          AS von,
           ${BIS}                          AS bis,
           (${BIS} - ${VON} + 1)           AS tage,
           ${VOR_VON}                      AS vor_von,
           ${VOR_BIS}                      AS vor_bis,
           ${VJ_VON}                       AS vj_von,
           ${VJ_BIS}                       AS vj_bis
), liste AS (
    SELECT DISTINCT t::bigint AS artikelnummer
      FROM regexp_split_to_table(coalesce([[ {{artikelnummern}}, ]] ''), '[^0-9]+') AS t
     WHERE t <> ''
), aktionsartikel AS (
    SELECT a.artikel_key, a.artikelnummer, a.name AS artikel
      FROM core.artikel a
      JOIN liste l ON l.artikelnummer = a.artikelnummer
), betriebe AS (
    SELECT DISTINCT av.betrieb_key
      FROM core.artikelverkauf_tag av
      JOIN aktionsartikel aa ON aa.artikel_key = av.artikel_key
     WHERE av.geschaeftstag BETWEEN ${VON} AND ${BIS}
), verkauf AS (
    SELECT CASE WHEN av.geschaeftstag BETWEEN ${VON} AND ${BIS}         THEN 'aktion'
                WHEN av.geschaeftstag BETWEEN ${VOR_VON} AND ${VOR_BIS} THEN 'davor'
                ELSE 'vorjahr' END                 AS periode,
           av.geschaeftstag,
           av.betrieb_key,
           b.name                                 AS betrieb,
           kz.hauptkonzept                        AS marke,
           av.artikel_key,
           aa.artikelnummer,
           aa.artikel,
           (aa.artikel_key IS NOT NULL)           AS ist_aktion,
           av.menge,
           av.umsatz_netto,
           av.umsatz_brutto,
           av.menge * av.verkaufspreis            AS listwert
      FROM core.artikelverkauf_tag av
      JOIN betriebe bt                    ON bt.betrieb_key = av.betrieb_key
      JOIN core.betrieb b                 ON b.betrieb_key  = av.betrieb_key
      LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = av.betrieb_key
      LEFT JOIN aktionsartikel aa         ON aa.artikel_key = av.artikel_key
     WHERE (   av.geschaeftstag BETWEEN ${VON} AND ${BIS}
            OR av.geschaeftstag BETWEEN ${VOR_VON} AND ${VOR_BIS}
            OR av.geschaeftstag BETWEEN ${VJ_VON} AND ${VJ_BIS})
       [[AND kz.hauptkonzept = {{marke}}]]
       [[AND b.name = {{betrieb}}]]
)`

/** Verdichtung je Betrieb und Zeitraum — von zwei Karten gebraucht. */
const JE_BETRIEB_CTE = `
, je_betrieb AS (
    SELECT betrieb_key, betrieb, marke, periode,
           count(DISTINCT geschaeftstag)                     AS tage,
           sum(menge)         FILTER (WHERE ist_aktion)      AS menge,
           sum(umsatz_netto)  FILTER (WHERE ist_aktion)      AS netto,
           sum(umsatz_netto)                                 AS netto_gesamt,
           sum(umsatz_brutto) FILTER (WHERE ist_aktion)      AS brutto,
           sum(listwert)      FILTER (WHERE ist_aktion)      AS listwert
      FROM verkauf
     GROUP BY betrieb_key, betrieb, marke, periode
)`

const PROZENT = { suffix: ' %' }
const EURO = { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 }

export const karten: Karte[] = [
  // -------------------------------------------------------------------
  // Kopf: die drei Zeitraeume untereinander. Eine Tabelle statt vier
  // Kacheln, weil jede Kachel dieselbe Grundmenge noch einmal laese —
  // und weil der Zeitraum DAVOR und das VORJAHR als eigene Zeilen die
  // Aktionszeile erst lesbar machen.
  // -------------------------------------------------------------------
  {
    schluessel: 'aa_kopf',
    name: 'Die Aktion in Zahlen',
    beschreibung:
      'Der Aktionszeitraum, derselbe Zeitraum unmittelbar davor und derselbe Zeitraum im '
      + 'Vorjahr — je eine Zeile. **Menge** und **Netto** zählen nur die Artikel der Liste; '
      + '**Anteil am Umsatz** setzt sie ins Verhältnis zum gesamten Nettoumsatz derselben Betriebe.\n\n'
      + '**Nachlass** ist der Abstand zwischen hinterlegtem Verkaufspreis und tatsächlich '
      + 'bezahltem Preis, brutto. Er enthält alle Rabatte, nicht nur die der Aktion — deshalb '
      + 'steht der Nachlass auf das übrige Sortiment daneben: Steigt nur der Wert der '
      + 'Aktionsartikel, ist es die Aktion.\n\n'
      + '**Tage ohne Daten** über null heißt: für einzelne Tage liegen keine Artikelverkäufe vor. '
      + 'Ein Vergleich gegen einen lückenhaften Zeitraum überzeichnet den Zuwachs.',
    anzeige: 'table',
    parameter: PARAMETER,
    sql: AKTION_CTE + `
, perioden AS (
    SELECT 'aktion'  AS periode, 1 AS reihenfolge, von,     bis,     tage FROM zeitraum
    UNION ALL
    SELECT 'davor',              2,                vor_von, vor_bis, tage FROM zeitraum
    UNION ALL
    SELECT 'vorjahr',            3,                vj_von,  vj_bis,  tage FROM zeitraum
), summe AS (
    SELECT periode,
           count(DISTINCT geschaeftstag)                     AS tage_mit_daten,
           count(DISTINCT betrieb_key)                       AS betriebe,
           sum(menge)         FILTER (WHERE ist_aktion)      AS menge,
           sum(umsatz_netto)  FILTER (WHERE ist_aktion)      AS netto,
           sum(umsatz_netto)                                 AS netto_gesamt,
           sum(umsatz_brutto) FILTER (WHERE ist_aktion)      AS brutto,
           sum(listwert)      FILTER (WHERE ist_aktion)      AS listwert,
           sum(umsatz_brutto) FILTER (WHERE NOT ist_aktion)  AS brutto_rest,
           sum(listwert)      FILTER (WHERE NOT ist_aktion)  AS listwert_rest
      FROM verkauf
     GROUP BY periode
)
SELECT CASE p.periode WHEN 'aktion' THEN 'Aktionszeitraum'
                      WHEN 'davor'  THEN 'Zeitraum davor'
                      ELSE 'Vorjahr' END                                    AS "Zeitraum",
       p.von                                                                AS "Von",
       p.bis                                                                AS "Bis",
       p.tage - coalesce(s.tage_mit_daten, 0)                              AS "Tage ohne Daten",
       coalesce(s.betriebe, 0)                                              AS "Betriebe",
       s.menge                                                              AS "Menge",
       round(s.netto)                                                       AS "Netto",
       round(100.0 * s.netto / nullif(s.netto_gesamt, 0), 1)               AS "Anteil am Umsatz %",
       round(100 * (1 - s.brutto / nullif(s.listwert, 0)), 1)              AS "Nachlass %",
       round(100 * (1 - s.brutto_rest / nullif(s.listwert_rest, 0)), 1)    AS "Nachlass übriges Sortiment %"
  FROM perioden p
  LEFT JOIN summe s ON s.periode = p.periode
 ORDER BY p.reihenfolge`,
    visualisierung: {
      column_settings: {
        '["name","Netto"]': EURO,
        '["name","Anteil am Umsatz %"]': PROZENT,
        '["name","Nachlass %"]': PROZENT,
        '["name","Nachlass übriges Sortiment %"]': PROZENT,
      },
    },
  },

  // -------------------------------------------------------------------
  // Je Betrieb — die Tabelle, um die es geht.
  // -------------------------------------------------------------------
  {
    schluessel: 'aa_betrieb',
    name: 'Aktionsartikel je Betrieb',
    beschreibung:
      'Jeder Betrieb, der im Aktionszeitraum mindestens einen Artikel der Liste verkauft hat. '
      + '**Menge** und **Netto** zählen nur die Artikel der Liste. „vs. davor" vergleicht mit dem '
      + 'gleich langen Zeitraum unmittelbar vor der Aktion, „vs. Vorjahr" mit denselben Tagen ein '
      + 'Jahr früher — leer, wenn es den Betrieb damals noch nicht gab.\n\n'
      + '**Nachlass** ist der eingeräumte Preisabschlag auf die Aktionsartikel, brutto; daneben '
      + 'derselbe Wert für den Zeitraum davor. Ein Betrieb, bei dem der Nachlass nicht steigt, '
      + 'hat die Aktion womöglich nicht gefahren.\n\n'
      + '**Tage mit Daten** unter der Länge des Zeitraums heißt Lücke, nicht Ruhetag. '
      + 'Sortiert nach Netto. Ein Klick auf den Betrieb öffnet das Betriebsblatt.',
    anzeige: 'table',
    parameter: PARAMETER,
    sql: AKTION_CTE + JE_BETRIEB_CTE + `
SELECT a.betrieb                                                          AS "Betrieb",
       a.marke                                                            AS "Marke",
       a.tage                                                             AS "Tage mit Daten",
       a.menge                                                            AS "Menge",
       round(100.0 * (a.menge - v.menge) / nullif(v.menge, 0), 1)        AS "Menge vs. davor %",
       round(100.0 * (a.menge - j.menge) / nullif(j.menge, 0), 1)        AS "Menge vs. Vorjahr %",
       round(a.netto)                                                     AS "Netto",
       round(100.0 * (a.netto - v.netto) / nullif(v.netto, 0), 1)        AS "Netto vs. davor %",
       round(100.0 * a.netto / nullif(a.netto_gesamt, 0), 1)             AS "Anteil am Umsatz %",
       round(100 * (1 - a.brutto / nullif(a.listwert, 0)), 1)            AS "Nachlass %",
       round(100 * (1 - v.brutto / nullif(v.listwert, 0)), 1)            AS "Nachlass davor %"
  FROM je_betrieb a
  LEFT JOIN je_betrieb v ON v.betrieb_key = a.betrieb_key AND v.periode = 'davor'
  LEFT JOIN je_betrieb j ON j.betrieb_key = a.betrieb_key AND j.periode = 'vorjahr'
 WHERE a.periode = 'aktion'
 ORDER BY a.netto DESC NULLS LAST, a.betrieb`,
    visualisierung: {
      column_settings: {
        '["name","Netto"]': EURO,
        '["name","Menge vs. davor %"]': PROZENT,
        '["name","Menge vs. Vorjahr %"]': PROZENT,
        '["name","Netto vs. davor %"]': PROZENT,
        '["name","Anteil am Umsatz %"]': PROZENT,
        '["name","Nachlass %"]': PROZENT,
        '["name","Nachlass davor %"]': PROZENT,
      },
    },
  },

  // -------------------------------------------------------------------
  // Der Nachlass je Woche, Aktionsartikel gegen uebriges Sortiment.
  // Ueber den Zeitraum DAVOR und den Aktionszeitraum: der Knick am
  // Aktionsbeginn ist die Aussage, und den sieht man nur mit Vorlauf.
  // Kein Vorjahr im Bild — es laege ein Jahr entfernt auf der Achse.
  // -------------------------------------------------------------------
  {
    schluessel: 'aa_verlauf_nachlass',
    name: 'Nachlass je Woche',
    beschreibung:
      'Der eingeräumte Preisabschlag je Woche, brutto: eine Linie für die Artikel der Liste, '
      + 'eine für das übrige Sortiment derselben Betriebe. Gezeichnet ab dem Zeitraum vor der '
      + 'Aktion, damit der Anstieg zum Aktionsbeginn sichtbar wird.\n\n'
      + 'Läuft nur die Linie der Aktionsartikel nach oben, ist es die Aktion. Laufen beide, hat '
      + 'sich etwas anderes geändert. Die erste und die letzte Woche können angeschnitten sein.',
    anzeige: 'line',
    parameter: PARAMETER,
    sql: AKTION_CTE + `
SELECT date_trunc('week', geschaeftstag)::date                             AS "Woche",
       CASE WHEN ist_aktion THEN 'Aktionsartikel' ELSE 'übriges Sortiment' END AS "Reihe",
       round(100 * (1 - sum(umsatz_brutto) / nullif(sum(listwert), 0)), 1)  AS "Nachlass %"
  FROM verkauf
 WHERE periode IN ('davor', 'aktion')
 GROUP BY 1, 2
 ORDER BY 1, 2`,
    visualisierung: {
      'graph.dimensions': ['Woche', 'Reihe'],
      'graph.metrics': ['Nachlass %'],
      'graph.y_axis.title_text': 'Nachlass brutto (%)',
      'graph.x_axis.title_text': '',
    },
  },

  // -------------------------------------------------------------------
  // Die Menge je Woche. Balken, nicht Linie: eine Woche ist eine Summe,
  // kein Messpunkt auf einer Kurve.
  // -------------------------------------------------------------------
  {
    schluessel: 'aa_verlauf_menge',
    name: 'Verkaufte Aktionsartikel je Woche',
    beschreibung:
      'Wie viele Artikel der Liste je Woche verkauft wurden, ab dem Zeitraum vor der Aktion. '
      + 'Ein Sprung zum Aktionsbeginn ist ein Mengeneffekt; bleibt die Menge flach und steigt '
      + 'nur der Nachlass daneben, hat die Aktion den Preis bewegt, nicht die Nachfrage.\n\n'
      + 'Die erste und die letzte Woche können angeschnitten sein.',
    anzeige: 'bar',
    parameter: PARAMETER,
    sql: AKTION_CTE + `
SELECT date_trunc('week', geschaeftstag)::date   AS "Woche",
       sum(menge)                                AS "Menge"
  FROM verkauf
 WHERE periode IN ('davor', 'aktion')
   AND ist_aktion
 GROUP BY 1
 ORDER BY 1`,
    visualisierung: {
      'graph.dimensions': ['Woche'],
      'graph.metrics': ['Menge'],
      'graph.y_axis.title_text': 'Stück',
      'graph.x_axis.title_text': '',
    },
  },

  // -------------------------------------------------------------------
  // Je Artikel. Der Klick fuehrt auf den Artikel-Drill-Down.
  // -------------------------------------------------------------------
  {
    schluessel: 'aa_artikel',
    name: 'Die Artikel der Liste',
    beschreibung:
      'Jeder Artikel der Liste im Aktionszeitraum, mit dem Namen aus dem Kassensystem — '
      + 'stimmt er nicht mit der eigenen Liste überein, ist die Nummer vertauscht. '
      + '**Betriebe** zählt, wie viele ihn im Zeitraum verkauft haben. „vs. davor" und '
      + '„vs. Vorjahr" wie in der Betriebstabelle; leer bei Artikeln, die es damals nicht gab.\n\n'
      + 'Sortiert nach Menge. Ein Klick auf den Artikel öffnet seinen Verlauf.',
    anzeige: 'table',
    parameter: PARAMETER,
    sql: AKTION_CTE + `
, je_artikel AS (
    SELECT artikel_key, artikelnummer, artikel, periode,
           count(DISTINCT betrieb_key)  AS betriebe,
           sum(menge)                   AS menge,
           sum(umsatz_netto)            AS netto,
           sum(umsatz_brutto)           AS brutto,
           sum(listwert)                AS listwert
      FROM verkauf
     WHERE ist_aktion
     GROUP BY artikel_key, artikelnummer, artikel, periode
)
SELECT a.artikelnummer                                                    AS "Artikelnummer",
       a.artikel                                                          AS "Artikel",
       a.betriebe                                                         AS "Betriebe",
       a.menge                                                            AS "Menge",
       round(100.0 * (a.menge - v.menge) / nullif(v.menge, 0), 1)        AS "Menge vs. davor %",
       round(100.0 * (a.menge - j.menge) / nullif(j.menge, 0), 1)        AS "Menge vs. Vorjahr %",
       round(a.netto)                                                     AS "Netto",
       round(100 * (1 - a.brutto / nullif(a.listwert, 0)), 1)            AS "Nachlass %",
       round(100 * (1 - v.brutto / nullif(v.listwert, 0)), 1)            AS "Nachlass davor %"
  FROM je_artikel a
  LEFT JOIN je_artikel v ON v.artikel_key = a.artikel_key AND v.periode = 'davor'
  LEFT JOIN je_artikel j ON j.artikel_key = a.artikel_key AND j.periode = 'vorjahr'
 WHERE a.periode = 'aktion'
 ORDER BY a.menge DESC NULLS LAST, a.artikelnummer`,
    visualisierung: {
      column_settings: {
        '["name","Netto"]': EURO,
        '["name","Menge vs. davor %"]': PROZENT,
        '["name","Menge vs. Vorjahr %"]': PROZENT,
        '["name","Nachlass %"]': PROZENT,
        '["name","Nachlass davor %"]': PROZENT,
      },
    },
  },

  // -------------------------------------------------------------------
  // Die Pruefkarte. Eine Nummer, die nichts trifft, macht sonst keinen
  // Laut — die Tabelle oben ist dann einfach eine Zeile kuerzer, und
  // niemand vermisst, was er nicht sieht.
  // -------------------------------------------------------------------
  {
    schluessel: 'aa_liste_pruefung',
    name: 'Nummern ohne Treffer',
    beschreibung:
      'Jede Nummer aus dem Filter, die entweder im Kassensystem unbekannt ist oder im '
      + 'Aktionszeitraum bei den gewählten Betrieben nicht verkauft wurde. '
      + '**Leer ist das Ziel**: dann sind alle Nummern bekannt und in den Zahlen oben enthalten.\n\n'
      + 'Eine unbekannte Nummer ist meist ein Tippfehler oder eine Nummer aus einem anderen '
      + 'Konzept; ein Artikel ohne Verkauf kann ausgelistet sein oder nur in Betrieben laufen, '
      + 'die der Filter ausschließt.',
    anzeige: 'table',
    parameter: PARAMETER,
    sql: AKTION_CTE + `
SELECT l.artikelnummer                                              AS "Artikelnummer",
       aa.artikel                                                   AS "Artikel",
       CASE WHEN aa.artikel_key IS NULL THEN 'im Kassensystem unbekannt'
            ELSE 'kein Verkauf im Aktionszeitraum' END              AS "Befund"
  FROM liste l
  LEFT JOIN aktionsartikel aa ON aa.artikelnummer = l.artikelnummer
 WHERE aa.artikel_key IS NULL
    OR NOT EXISTS (SELECT 1 FROM verkauf v
                    WHERE v.periode = 'aktion' AND v.ist_aktion
                      AND v.artikel_key = aa.artikel_key)
 ORDER BY 3, 1`,
  },

  // -------------------------------------------------------------------
  // Der gemessene Nachlass (Plan 6.2, seit 0117). Die Karten darueber
  // leiten den Nachlass aus dem Preis ab (1 - bezahlt / Kartenpreis) und
  // erfassen damit ALLE Rabatte. Diese hier liest den Rabattbericht der
  // Kasse: je Nachlass-Kassentaste die Artikel auf den Bons. Beide bleiben
  // nebeneinander stehen — die Differenz ist selbst eine Aussage.
  //
  // NUR mart (karten-kasse.ts, Regel 1): diese Karte laeuft auch im Chat.
  // Die Liste schraenkt NICHT ein, sondern markiert: der Rabattbericht
  // kennt nur Artikelnamen, und ein Name, der keiner Nummer zugeordnet
  // werden konnte, fiele bei einem Filter still heraus.
  // -------------------------------------------------------------------
  {
    schluessel: 'aa_nachlass',
    name: 'Nachlass je Stufe und Artikel',
    beschreibung:
      'Wie viele Stück je Artikel auf Bons mit dem gewählten Nachlass standen — z. B. Glücksrad '
      + 'mit 10, 25 und 50 % —, über alle gewählten Betriebe. Das ist die Zahl aus dem '
      + 'Rabattbericht der Kasse, keine Ableitung aus Preisen. Der Nachlass gilt für den ganzen Bon: '
      + 'die Stückzahl ist die Menge auf Nachlass-Bons, nicht die verkaufte Menge.\n\n'
      + '**Auf der Liste** sagt, ob der Artikel zu den Nummern oben gehört; „nicht zuordenbar" heißt, '
      + 'der Kassenname ließ sich keiner Nummer eindeutig zuordnen. Je Betrieb steht dieselbe Zahl '
      + 'auf der Seite „Nachlässe — je Betrieb".',
    anzeige: 'table',
    parameter: [P_FINANZWEG, ...PARAMETER],
    sql: `
WITH liste AS (
    SELECT DISTINCT t::bigint AS artikelnummer
      FROM regexp_split_to_table(coalesce([[ {{artikelnummern}}, ]] ''), '[^0-9]+') AS t
     WHERE t <> ''
)
SELECT n.artikel                                                   AS "Artikel",
       max(n.artikelnummer)                                        AS "Artikelnummer",
       CASE WHEN max(n.artikelnummer) IS NULL THEN 'nicht zuordenbar'
            WHEN max(n.artikelnummer) IN (SELECT artikelnummer FROM liste) THEN 'ja'
            ELSE 'nein' END                                        AS "Auf der Liste",
       n.aktion                                                    AS "Nachlass",
       n.prozentsatz                                               AS "Stufe %",
       sum(n.menge)                                                AS "Stück auf Nachlass-Bons",
       round(sum(n.nachlass_brutto), 2)                            AS "Nachlass",
       count(DISTINCT n.betrieb_key)                               AS "Betriebe"
  FROM mart.artikel_nachlass_tag n
 WHERE n.geschaeftstag >= ${VON}
   AND n.geschaeftstag <= ${BIS}
   AND n.zeitraum_bis  <= ${BIS}
   [[AND (n.aktion = {{finanzweg}} OR n.finanzweg_name = {{finanzweg}})]]
   [[AND n.marke = {{marke}}]]
   [[AND n.betrieb = {{betrieb}}]]
 GROUP BY n.artikel, n.aktion, n.prozentsatz
 ORDER BY sum(n.menge) DESC, n.artikel, n.prozentsatz`,
    visualisierung: {
      column_settings: {
        '["name","Nachlass"]': EURO,
        '["name","Stufe %"]': PROZENT,
      },
    },
  },
]
