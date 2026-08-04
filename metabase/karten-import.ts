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
      '„abgebrochen" mit einer Notiz über SIGTERM ist der Normalfall bei einem Lauf mit Zeitfrist — der nächste macht dort weiter, wo dieser aufhörte. Der Zustand liegt in der Datenbank, nicht im Prozess.',
    anzeige: 'table',
    sql: `
SELECT lauf_id                AS "Lauf",
       gestartet_am           AS "gestartet",
       dauer                  AS "Dauer",
       ausloeser              AS "Auslöser",
       status                 AS "Status",
       aufgaben_gesamt        AS "Posten",
       aufgaben_ok            AS "ok",
       aufgaben_fehler        AS "Fehler",
       posten_pro_minute      AS "Posten/Min",
       notiz                  AS "Notiz"
  FROM mart.import_lauf
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
      'Die offene Warteschlange in genau der Reihenfolge, in der sie abgearbeitet wird. Zeile 1 ist der nächste Posten. „laufend" geht immer vor „Historie" — deshalb kann die Historie stillstehen, ohne dass etwas kaputt ist.',
    anzeige: 'table',
    sql: `
SELECT position           AS "#",
       endpunkt           AS "Bericht",
       betrieb            AS "Betrieb",
       zeitraum_von       AS "von",
       zeitraum_bis       AS "bis",
       art                AS "Art",
       faellig_ab         AS "fällig ab",
       versuche           AS "Versuche",
       laeuft_gerade      AS "läuft gerade"
  FROM mart.import_naechste
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
       reicht_zurueck_bis   AS "Daten ab",
       geladen_bis          AS "Daten bis",
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
]
