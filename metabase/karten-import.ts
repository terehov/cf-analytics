// =====================================================================
// Karten fuer die Importueberwachung.
//
// Zielgruppe ist hier ausdruecklich NICHT der Fachbereich, sondern wer
// wissen will, ob der Datenimport laeuft und woran es liegt, wenn nicht.
// Deshalb duerfen hier Endpunktnamen und technische Begriffe stehen --
// sie sind die Sache selbst, nicht ihre Verpackung.
//
// Aufbau der Seite, von oben nach unten in der Reihenfolge, in der man
// fragt:
//   1. Laeuft es ueberhaupt?      Sperre, Fortschritt, Tempo, Restzeit
//   2. Woran haengt es?           Fehlermuster, letzte Laeufe
//   3. Was macht er gerade?       Warteschlange, Puls
//   4. Wie vollstaendig ist es?   je Bericht, je Betrieb
// =====================================================================

import type { Karte } from './typen'

export const karten: Karte[] = [
  // ===================================================================
  // 1. Laeuft es?
  // ===================================================================
  {
    schluessel: 'im_ampel',
    name: 'Zugang',
    beschreibung:
      'Steht hier etwas anderes als „frei", ruht der Import vollständig. Die Sperre läuft von selbst ab — der Importer kommt ohne Zutun zurück.',
    anzeige: 'scalar',
    sql: `
SELECT CASE WHEN sperre_art IS NULL THEN 'frei'
            ELSE 'gesperrt: ' || sperre_art
       END AS "Zugang"
  FROM mart.import_gesamt`,
  },
  {
    schluessel: 'im_prozent',
    name: 'Fortschritt',
    beschreibung: 'Anteil der abgearbeiteten Posten an allen eingereihten.',
    anzeige: 'scalar',
    sql: `SELECT prozent AS "Fortschritt" FROM mart.import_gesamt`,
    visualisierung: {
      column_settings: { '["name","Fortschritt"]': { suffix: ' %' } },
    },
  },
  {
    schluessel: 'im_tempo',
    name: 'Tempo',
    beschreibung:
      'Erfolgreich geladene Posten in der letzten Stunde. Null heißt: es läuft gerade nichts — entweder ruht der Zugang, das Tagesbudget ist aufgebraucht, oder es startet gerade kein Lauf.',
    anzeige: 'scalar',
    sql: `SELECT coalesce(tempo_pro_stunde, 0) AS "Posten/Stunde" FROM mart.import_gesamt`,
  },
  {
    schluessel: 'im_restzeit',
    name: 'Voraussichtlich fertig',
    beschreibung:
      'Hochgerechnet aus dem Tempo der letzten Stunde. Eine Größenordnung, keine Zusage — das Tempo hängt am Tagesbudget und an LINAs Antwortzeiten. Leer, solange nichts läuft.',
    anzeige: 'scalar',
    sql: `
SELECT CASE WHEN reststunden IS NULL THEN '—'
            WHEN reststunden < 48   THEN round(reststunden)::text || ' Std'
            ELSE round(reststunden / 24)::text || ' Tage'
       END AS "Restzeit"
  FROM mart.import_gesamt`,
  },
  {
    schluessel: 'im_kopf',
    name: 'Stand des Imports',
    beschreibung:
      'Die Gesamtzahlen auf einen Blick: wie viel erledigt, wie viel offen, wie weit die Daten zurückreichen und bis wann sie geladen sind.',
    anzeige: 'table',
    sql: `
SELECT posten_gesamt        AS "Posten gesamt",
       erledigt             AS "erledigt",
       offen                AS "offen",
       offen_laufend        AS "davon laufender Betrieb",
       offen_historie       AS "davon Historie",
       aufgegeben           AS "aufgegeben",
       reicht_zurueck_bis   AS "Daten ab",
       geladen_bis          AS "Daten bis",
       tempo_pro_stunde     AS "Posten/Std",
       fertig_etwa          AS "fertig etwa"
  FROM mart.import_gesamt`,
  },
  {
    schluessel: 'im_sperre',
    name: 'Warum der Zugang ruht',
    beschreibung:
      'Nur belegt, wenn der Import gesperrt ist. Der Hinweis ist LINAs eigene Meldung, keine Vermutung von uns. Sperren laufen von selbst ab.',
    anzeige: 'table',
    sql: `
SELECT art            AS "Art",
       erkannt_am     AS "erkannt am",
       pausiert_bis   AS "Pause bis",
       stunden_noch   AS "Stunden noch",
       http_status    AS "HTTP",
       endpunkt       AS "Endpunkt",
       hinweis        AS "Hinweis"
  FROM mart.import_sperre
 WHERE aktiv`,
  },

  // ===================================================================
  // 2. Woran haengt es?
  // ===================================================================
  {
    schluessel: 'im_fehler',
    name: 'Fehlermuster (24 Stunden)',
    beschreibung:
      'Gleichartige Fehler zusammengefasst, häufigste zuerst. Zeitstempel und lange Zahlen sind im Text ersetzt, damit dieselbe Ursache eine Zeile ergibt und nicht hundert. „keine Daten" steht hier nicht — das ist kein Fehler.',
    anzeige: 'table',
    sql: `
SELECT endpunkt      AS "Bericht",
       fehler        AS "Fehler",
       faelle        AS "Fälle",
       betriebe      AS "Betriebe",
       http_status   AS "HTTP",
       zuerst        AS "zuerst",
       zuletzt       AS "zuletzt"
  FROM mart.import_fehler`,
  },
  {
    schluessel: 'im_laeufe',
    name: 'Die letzten Läufe',
    beschreibung:
      '„abgebrochen" mit einer Notiz über SIGTERM ist der Normalfall bei einem Lauf mit Zeitfrist — der nächste macht dort weiter, wo dieser aufhörte. Der Zustand liegt in der Datenbank, nicht im Prozess. „verwaist" heißt: der Prozess ist ohne Abmeldung verschwunden (Absturz, SIGKILL) — die Zeile ist Protokollrest, kein laufender Import.',
    anzeige: 'table',
    sql: `
-- 'verwaist' vergibt die Karte selbst, nicht die Sicht: die kann nur
-- sehen, dass niemand den Lauf beendet hat, und zeigt 'laeuft'. Am
-- 03.08.2026 standen so drei "laufende" Laeufe nebeneinander, von
-- denen zwei laengst tot waren. Woran man den Toten erkennt: ein
-- SPAETER gestarteter Lauf ist schon fertig (der Importer laeuft
-- einzeln, zwei echte Laeufe zugleich gibt es nicht), oder der Start
-- liegt ueber sechs Stunden zurueck -- so lange laeuft keiner.
SELECT l.lauf_id              AS "Lauf",
       l.gestartet_am         AS "gestartet",
       l.dauer                AS "Dauer",
       l.ausloeser            AS "Auslöser",
       CASE WHEN l.status = 'laeuft'
             AND l.beendet_am IS NULL
             AND (EXISTS (SELECT 1
                            FROM mart.import_lauf s
                           WHERE s.gestartet_am > l.gestartet_am
                             AND s.beendet_am IS NOT NULL)
                  OR l.gestartet_am < now() - interval '6 hours')
            THEN 'verwaist'
            ELSE l.status
       END                    AS "Status",
       l.aufgaben_gesamt      AS "Posten",
       l.aufgaben_ok          AS "ok",
       l.aufgaben_fehler      AS "Fehler",
       l.posten_pro_minute    AS "Posten/Min",
       l.notiz                AS "Notiz"
  FROM mart.import_lauf l
 ORDER BY l.gestartet_am DESC
 LIMIT 25`,
  },
  {
    schluessel: 'im_schema',
    name: 'Strukturänderungen bei LINA',
    beschreibung:
      'Wenn LINA das Format einer Antwort ändert, steht es hier. Erwartung: leer. Eine Zeile heißt, dass ein Bericht anders aussieht als erwartet — dann stimmen die Daten dieses Berichts möglicherweise nicht mehr.',
    anzeige: 'table',
    sql: `
SELECT endpunkt      AS "Bericht",
       erkannt_am    AS "erkannt am",
       erwartet      AS "erwartet",
       tatsaechlich  AS "tatsächlich"
  FROM mart.import_strukturaenderung
 WHERE offen`,
  },

  // ===================================================================
  // 3. Was macht er gerade?
  // ===================================================================
  {
    schluessel: 'im_puls',
    name: 'Puls — Posten je Stunde',
    beschreibung:
      'Die Kurve der letzten drei Tage. Eine Lücke ist eine Pause, ein Absacken ohne Fehler meistens das Tagesbudget. Bricht sie ganz ab, läuft kein Import mehr.',
    anzeige: 'bar',
    sql: `
SELECT stunde        AS "Stunde",
       geladen       AS "geladen",
       keine_daten   AS "keine Daten",
       fehler        AS "Fehler"
  FROM mart.import_puls`,
    visualisierung: {
      'graph.dimensions': ['Stunde'],
      'graph.metrics': ['geladen', 'keine Daten', 'Fehler'],
      'stackable.stack_type': 'stack',
      'graph.y_axis.title_text': 'Posten',
      'graph.x_axis.title_text': '',
    },
  },
  {
    schluessel: 'im_wartezeit',
    name: 'Antwortzeit und Drosselung',
    beschreibung:
      'Wie lange LINA je Abruf braucht (Antwortzeit) und wie lange wir freiwillig warten (Drosselung). Die Drosselung soll da sein — sie hält die Integration am Leben. Steigt die Antwortzeit stark, bremst LINA.',
    anzeige: 'line',
    sql: `
SELECT stunde         AS "Stunde",
       dauer_ms       AS "Antwortzeit (ms)",
       wartezeit_ms   AS "Drosselung (ms)"
  FROM mart.import_puls`,
    visualisierung: {
      'graph.dimensions': ['Stunde'],
      'graph.metrics': ['Antwortzeit (ms)', 'Drosselung (ms)'],
      'graph.y_axis.title_text': 'Millisekunden',
      'graph.x_axis.title_text': '',
    },
  },
  {
    schluessel: 'im_naechste',
    name: 'Was als Nächstes drankommt',
    beschreibung:
      'Die offene Warteschlange in genau der Reihenfolge, in der sie abgearbeitet wird. Zeile 1 ist der nächste Posten. „laufend" geht immer vor „Historie" — deshalb kann die Historie stillstehen, ohne dass etwas kaputt ist. FoodNotify-Posten (fn:*) hängen an keiner LINA-Betriebsnummer — bei ihnen steht die Kostenstelle bzw. Bestellung aus den Auftragsparametern.',
    anzeige: 'table',
    sql: `
-- FoodNotify-Posten (fn:*) fuehren keinen Betrieb -- die Spalte der
-- Sicht bleibt dort leer, und fuenfzig leere Zellen lesen sich wie
-- ein Datenfehler. Was den Posten tatsaechlich benennt, steht in den
-- Parametern der Warteschlange: Kostenstelle (erpId), Bestellung
-- (orderId), Seite. Daraus wird hier eine lesbare Bezeichnung gebaut;
-- LINA-Posten zeigen unveraendert den Betrieb.
SELECT n.position           AS "#",
       n.endpunkt           AS "Bericht",
       coalesce(
         n.betrieb,
         nullif(concat_ws(', ',
           'Kostenstelle ' || (w.parameter ->> 'erpId'),
           'Bestellung '   || (w.parameter ->> 'orderId'),
           'Seite '        || (w.parameter ->> 'seite')), ''),
         n.endpunkt)        AS "Betrieb",
       n.zeitraum_von       AS "von",
       n.zeitraum_bis       AS "bis",
       n.art                AS "Art",
       n.faellig_ab         AS "fällig ab",
       n.versuche           AS "Versuche",
       n.laeuft_gerade      AS "läuft gerade"
  FROM mart.import_naechste n
  LEFT JOIN sync.warteschlange w USING (posten_id)
 ORDER BY n.position
 LIMIT 50`,
  },

  // ===================================================================
  // 4. Wie vollstaendig ist es?
  // ===================================================================
  {
    schluessel: 'im_bericht',
    name: 'Je Bericht',
    beschreibung:
      'Die wichtigste Spalte ist „Tage alt": wie alt die jüngsten Daten dieses Berichts sind. Bei täglichen Berichten sind ein bis zwei Tage normal. „wartet" heißt nicht kaputt — der laufende Betrieb hat Vorrang vor der Historie.',
    anzeige: 'table',
    sql: `
SELECT endpunkt              AS "Bericht",
       zustand               AS "Zustand",
       prozent               AS "%",
       offen                 AS "offen",
       geladen               AS "geladen",
       keine_daten           AS "keine Daten",
       aufgegeben            AS "aufgegeben",
       reicht_zurueck_bis    AS "Daten ab",
       geladen_bis           AS "Daten bis",
       tage_alt              AS "Tage alt",
       stunden_seit_erfolg   AS "Std seit Erfolg",
       fehler_24h            AS "Fehler 24h",
       dauer_ms_schnitt      AS "Ø ms"
  FROM mart.import_bericht`,
    visualisierung: {
      column_settings: { '["name","%"]': { suffix: ' %' } },
    },
  },
  {
    schluessel: 'im_bericht_balken',
    name: 'Fortschritt je Bericht',
    beschreibung: 'Dieselben Zahlen als Balken — auf einen Blick, wo noch am meisten fehlt.',
    anzeige: 'row',
    sql: `
SELECT endpunkt   AS "Bericht",
       offen      AS "offen"
  FROM mart.import_bericht
 WHERE offen > 0
 ORDER BY offen DESC`,
    visualisierung: {
      'graph.dimensions': ['Bericht'],
      'graph.metrics': ['offen'],
      'graph.x_axis.title_text': 'offene Posten',
    },
  },
  {
    schluessel: 'im_betrieb',
    name: 'Je Betrieb',
    beschreibung:
      'Wem noch etwas fehlt. „aufgegeben" ist die Spalte, die eine echte Lücke anzeigt — dort wurde nach mehreren Versuchen abgebrochen. „keine Daten" dagegen ist normal für Betriebe, die einen Bericht nicht führen.',
    anzeige: 'table',
    sql: `
SELECT betrieb              AS "Betrieb",
       prozent              AS "%",
       erledigt             AS "erledigt",
       offen                AS "offen",
       keine_daten          AS "keine Daten",
       aufgegeben           AS "aufgegeben",
       -- "Daten ab"/"Daten bis" standen hier als durchgehend leere
       -- Spalten: die Sicht fuellt sie fuer keinen einzigen Betrieb
       -- (0 von 141 am 03.08.2026). Eine leere Datumsspalte liest
       -- sich als Datenluecke des Betriebs, nicht als Luecke der
       -- Sicht -- weg damit, bis die Sicht sie wirklich liefert.
       berichte_pausiert    AS "Berichte pausiert"
  FROM mart.import_betrieb
 LIMIT 200`,
    visualisierung: {
      column_settings: { '["name","%"]': { suffix: ' %' } },
    },
  },
  {
    schluessel: 'im_reichweite',
    name: 'Wie weit die Daten zurückreichen',
    beschreibung:
      'Je Bericht der älteste geladene Tag. Zeigt, wie tief die Historie schon ist — und wo der Backfill noch arbeitet.',
    anzeige: 'row',
    sql: `
SELECT endpunkt                                    AS "Bericht",
       (current_date - reicht_zurueck_bis)         AS "Tage Historie"
  FROM mart.import_bericht
 WHERE reicht_zurueck_bis IS NOT NULL
 ORDER BY (current_date - reicht_zurueck_bis) DESC`,
    visualisierung: {
      'graph.dimensions': ['Bericht'],
      'graph.metrics': ['Tage Historie'],
      'graph.x_axis.title_text': 'Tage zurück',
    },
  },
  {
    schluessel: 'im_foodnotify',
    name: 'FoodNotify — Stand je Endpunkt',
    beschreibung:
      'Der Einkaufs-Import (fn:*) neben dem LINA-Import — er war auf dieser Seite vorher unsichtbar, obwohl über tausend Posten offen standen. Besonderheit bei fn:bestellungen: die Posten sind Seiten je Kostenstelle, chronologisch aufsteigend abgearbeitet — solange der Backfill läuft, fehlen die JÜNGSTEN Monate zuerst, und die Einkaufszahlen der letzten Monate sind noch unvollständig.',
    anzeige: 'table',
    sql: `
-- Dieselbe Sicht wie "Je Bericht", auf fn:* gefiltert. Eine eigene
-- Karte statt einer Zeile zwischen zwanzig get*-Endpunkten, weil der
-- FoodNotify-Backfill eine eigene Erklaerung braucht -- ohne sie
-- liest sich "1.673 offen" wie ein Fehler und nicht wie ein Plan.
SELECT endpunkt            AS "Endpunkt",
       zustand             AS "Zustand",
       prozent             AS "%",
       offen               AS "offen",
       geladen             AS "geladen",
       keine_daten         AS "keine Daten",
       aufgegeben          AS "aufgegeben",
       reicht_zurueck_bis  AS "Daten ab",
       geladen_bis         AS "Daten bis",
       fehler_24h          AS "Fehler 24h"
  FROM mart.import_bericht
 WHERE endpunkt LIKE 'fn:%'
 ORDER BY offen DESC, endpunkt`,
    visualisierung: {
      column_settings: { '["name","%"]': { suffix: ' %' } },
    },
  },
  {
    schluessel: 'im_yext',
    name: 'Bewertungsimport — letzter Lauf',
    beschreibung:
      'Der Yext-Abruf der Online-Bewertungen läuft getrennt vom LINA-Import, einmal täglich. „Std her" sollte unter etwa 28 Stunden liegen — täglicher Lauf plus Puffer. Steht dort mehr, ist der Bewertungsimport hängen geblieben, und die Bewertungsseiten altern stillschweigend weiter.',
    anzeige: 'table',
    sql: `
-- Zwei Quellen, weil keine allein die Frage beantwortet: sync.merker
-- weiss, WANN der letzte Yext-Lauf lief und ob er Fehler hatte;
-- mart.bewertung_ladestand weiss, WAS danach in der Datenbank liegt.
-- LEFT JOIN statt CROSS JOIN: fehlt der Merker (noch nie gelaufen),
-- sollen die Ladestandzeilen trotzdem erscheinen -- mit leerem Lauf.
WITH lauf AS (
  SELECT (wert ->> 'beendet_am')::timestamptz AS beendet_am,
         (wert ->> 'fehler')::int             AS fehler
    FROM sync.merker
   WHERE schluessel = 'yext_letzter_lauf'
)
SELECT s.quelle                                  AS "Quelle",
       s.publisher                               AS "Publisher",
       s.betriebe                                AS "Betriebe",
       s.bewertungen_aktuell                     AS "Bewertungen",
       s.schnitt_aktuell                         AS "Ø Sterne",
       s.von                                     AS "von",
       s.bis                                     AS "bis",
       to_char(l.beendet_am, 'DD.MM. HH24:MI')   AS "letzter Lauf",
       round(extract(epoch FROM now() - l.beendet_am) / 3600, 1)
                                                 AS "Std her",
       l.fehler                                  AS "Fehler"
  FROM mart.bewertung_ladestand s
  LEFT JOIN lauf l ON true
 ORDER BY s.publisher`,
  },

  // ===================================================================
  // 5. Datenqualitaet -- Karten fuer "Datenqualitaet und Import"
  //
  // Diese dq_*-Karten liegen NICHT auf der Importseite, sondern auf
  // db_datenqualitaet. Sie stehen trotzdem in dieser Datei: sie lesen
  // dieselben Quellen wie die Importkarten und sind mit ihnen im
  // Review vom 03.08.2026 zusammen entstanden.
  // ===================================================================
  {
    schluessel: 'dq_lochtage',
    name: 'Tage mit Datenloch',
    beschreibung:
      'Tage der letzten 120 Tage, an denen deutlich weniger Betriebe Umsatz melden als im 28-Tage-Schnitt davor. Die jüngsten etwa sechs Tage füllt LINA von selbst nach — dort ist eine Zeile normal. Ältere Zeilen sind echte Löcher: diese Tage fehlen in jeder Auswertung und gehören neu eingereiht. Anlassfall: der 22.07.2026 mit 0 von ~54 erwarteten Betrieben.',
    anzeige: 'table',
    sql: `
SELECT geschaeftstag        AS "Geschäftstag",
       wochentag            AS "Wochentag",
       betriebe_mit_umsatz  AS "Betriebe mit Umsatz",
       betriebe_erwartet    AS "erwartet",
       umsatz               AS "Umsatz",
       befund               AS "Befund"
  FROM mart.umsatz_lochtag
 ORDER BY geschaeftstag DESC`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
      },
    },
  },
  {
    schluessel: 'dq_gaeste',
    name: 'Gästezahlen — wem sie fehlen',
    beschreibung:
      'Betriebe, die in den letzten zwölf Monaten an weniger als 80 % ihrer Umsatztage Gästezahlen melden. Für diese Betriebe gibt es kein „Umsatz je Gast" — auf den Kennzahlseiten fehlen sie stillschweigend. Die umsatzstärksten stehen oben: dort lohnt es zuerst, die Gästezählung an der Kasse zu klären.',
    anzeige: 'table',
    sql: `
SELECT betrieb           AS "Betrieb",
       status            AS "Status",
       umsatztage        AS "Umsatztage",
       tage_mit_gaesten  AS "Tage mit Gästen",
       abdeckung_pct     AS "Abdeckung %",
       umsatz_12m        AS "Umsatz 12M"
  FROM mart.gaeste_abdeckung
 WHERE abdeckung_pct < 80
 ORDER BY umsatz_12m DESC NULLS LAST`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz 12M"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
      },
    },
  },
  {
    schluessel: 'dq_zuordnung_offen',
    name: 'FoodNotify-Restaurants ohne Betrieb',
    beschreibung:
      'Erwartung: leer. Jede Zeile ist ein FoodNotify-Restaurant, dessen Bestellungen in keiner Betriebsauswertung ankommen, weil die Zuordnung zum Betrieb fehlt — stillschweigend, ohne Fehlermeldung. „Vorschlag" ist der ähnlichste Betriebsname samt Ähnlichkeitsmaß: bestätigen oder verwerfen, eingetragen wird in manual.betrieb_zuordnung.',
    anzeige: 'table',
    sql: `
SELECT fn_name        AS "Restaurant (FoodNotify)",
       marke          AS "Marke",
       grund          AS "Grund",
       vorschlag_name AS "Vorschlag",
       trgm           AS "Ähnlichkeit",
       kostenstellen  AS "Kostenstellen",
       bestellungen   AS "Bestellungen"
  FROM manual.betrieb_zuordnung_offen
 ORDER BY bestellungen DESC NULLS LAST`,
  },
  {
    schluessel: 'dq_unplausibel',
    name: 'Unplausible BWA-Quoten',
    beschreibung:
      'BWA-Prozentwerte jenseits von ±150 % vom Umsatz — als Quote unmöglich, meist ein Buchungs- oder Übertragungsfehler beim Steuerberater. Seit dem 03.08.2026 tragen diese Werte KEINE Ampel mehr; diese Liste ist die Arbeitsliste, mit der man beim Steuerberater anruft. Gezeigt: aktive Betriebe, jüngste 24 Monate, größte Ausreißer zuerst.',
    anzeige: 'table',
    sql: `
-- DISTINCT ON: die Sicht fuehrt je Abruf eine Zeile, derselbe Fall
-- steht daher mehrfach darin (107 Zeilen, 62 eindeutige Faelle am
-- 03.08.2026). Interessant ist nur der juengste Stand je Fall.
-- wert_absolut/umsatz_absolut fuellt die Sicht derzeit nie (0 von
-- 875 Zeilen) -- als Spalten waeren sie leere Versprechen, siehe
-- die Begruendung bei "Je Betrieb".
SELECT betrieb      AS "Betrieb",
       monat        AS "Monat",
       kennzahl     AS "Kennzahl",
       wert_prozent AS "Wert"
  FROM (
    SELECT DISTINCT ON (betrieb_key, monat, kennzahl)
           betrieb, monat, kennzahl, wert_prozent
      FROM mart.bwa_prozent_unplausibel
     WHERE aktiv
       AND monat >= date_trunc('month', current_date) - interval '24 months'
     ORDER BY betrieb_key, monat, kennzahl, abgerufen_am DESC NULLS LAST
  ) juengster_stand
 ORDER BY abs(wert_prozent) DESC
 LIMIT 200`,
    visualisierung: {
      column_settings: { '["name","Wert"]': { suffix: ' %' } },
    },
  },
]
