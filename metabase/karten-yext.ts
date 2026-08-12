// =====================================================================
// Yext Analytics — woran es liegt, wer geantwortet hat, wer uns findet
//
// Die Karten aus Migration 0050. Sie beantworten die Frage, die
// karten-bewertung.ts offenlaesst: DASS ein Betrieb abrutscht, sagt die Note
// dort -- WORAN es liegt, steht hier.
//
// DREI EIGENSCHAFTEN DER DATEN, DIE JEDE KARTE HIER BETREFFEN:
//
//   1. THEMEN ERST AB APRIL 2026. Wer einen aelteren Monat waehlt,
//      bekommt eine leere Karte. Leer liest sich als "keine Probleme",
//      und das waere der teuerste Irrtum auf dieser Seite. Deshalb sagt
//      jede Themenkarte ueber mart.bewertung_thema_start selbst, ab wann
//      sie etwas weiss -- keine Karte bleibt kommentarlos leer.
//
//   2. MEHRFACHVERGABE. Eine Bewertung traegt mehrere Themen. Die
//      Anteile ergeben zusammen ueber 100 Prozent, und das ist richtig.
//      Kein Kreisdiagramm auf dieser Seite: ein Tortenstueck behauptet
//      einen Anteil an einem Ganzen, den es hier nicht gibt.
//
//   3. DIE SICHTBARKEITSZAHLEN HINKEN. Bewertungen sind bis gestern
//      vollstaendig, Impressionen bis zu einer Woche aelter
//      (core.yext_datenstand). Der laufende Monat ist dort immer ein
//      Teilmonat -- yx_datenstand macht das sichtbar, statt es in eine
//      Fussnote zu schreiben, die niemand liest.
//
// WARUM DIE NOTE UND NICHT YEXTS SENTIMENT. Yext liefert zu jedem
// Stichwort einen Stimmungswert. Fuer unsere Daten steht er bei 4.362 von
// 5.119 Stichworten auf exakt 0 -- darunter essen, bedienung, personal.
// Dieselben Themen trennt die NOTE von 2,50 bis 4,35. Deshalb rechnet
// hier alles auf der Note (docs/yext-analytics-inventar.md §5).
// =====================================================================

import type { Karte } from './typen'
import { MONAT_CTE, P_MONAT, P_BETRIEB, P_MARKE, P_ZEITRAUM } from './gemeinsam'

const MONAT = P_MONAT
const BETRIEB = P_BETRIEB
const MARKE = P_MARKE
const ZEITRAUM = P_ZEITRAUM

/**
 * Die fuenf Themen in der Reihenfolge, in der sie gelesen werden sollen:
 * erst was der Betrieb traegt, dann was es herunterzieht.
 *
 * Die Namen sind Yexts eigene, englisch und unuebersetzt -- eine
 * Uebersetzungstabelle waere eine zweite Wahrheit, die beim naechsten
 * neuen Label veraltet. Die Beschriftung passiert hier, einmal.
 */
/**
 * Der Praefix ist ein Parameter, weil nicht jede Karte einen Alias
 * benutzen DARF: wo ein Feldfilter ({{zeitraum}}) auf die Tabelle zeigt,
 * baut Metabase die Klausel auf den vollen Tabellennamen und die Karte
 * scheitert, sobald jemand den Filter setzt. Genau das steht in
 * docs/fehlerkatalog.md unter "Ein Feldfilter auf eine Tabelle mit Alias",
 * und uebernehmen.ts prueft es -- die Verlaufskarten unten laufen deshalb
 * ohne Alias.
 */
const themaDeutsch = (q = 't.') => `
    CASE ${q}thema
        WHEN 'Food'                   THEN 'Küche'
        WHEN 'Service and Staff'      THEN 'Service & Personal'
        WHEN 'Speed of Service'       THEN 'Wartezeit'
        WHEN 'Order'                  THEN 'Bestellung'
        WHEN 'Restaurant Cleanliness' THEN 'Sauberkeit'
        ELSE ${q}thema
    END`

const THEMA_DEUTSCH = themaDeutsch()

/** Nur die lueckenlose Reihe ab April 2026 -- ohne die vier handvergebenen
 *  Alt-Labels, die sonst als eigene "Themen" in jeder Liste stehen. */
const LAUFEND = 'AND t.laufend'

export const karten: Karte[] = [
  // -------------------------------------------------------------------
  // Kacheln — was auf die Uebersichtsseiten geht
  // -------------------------------------------------------------------
  {
    schluessel: 'yx_kachel_schwaechstes_thema',
    name: 'Schwächstes Thema',
    beschreibung:
      'Das Thema mit der schlechtesten Durchschnittsnote im gewählten Monat, über die '
      + 'operativen Betriebe. Antwortet auf „woran liegt es“, bevor jemand die Einzelbewertungen liest.',
    anzeige: 'scalar',
    parameter: [MONAT, MARKE, BETRIEB],
    // Mengengewichtet: ein Betrieb mit zwei Nennungen darf nicht so schwer
    // waehlen wie eines mit achtzig. Die Reihenfolge entscheidet die
    // Note, nicht die Haeufigkeit -- gesucht ist das schlechteste Thema,
    // nicht das lauteste.
    sql: `${MONAT_CTE}
SELECT coalesce(
         (SELECT ${THEMA_DEUTSCH} || ' · ' || to_char(
                     round(sum(t.anzahl * t.schnitt) / nullif(sum(t.anzahl), 0), 2), 'FM0.00')
            FROM mart.bewertung_thema t
            CROSS JOIN gewaehlt g
           WHERE t.monat = g.monat AND t.operativ AND t.schnitt IS NOT NULL ${LAUFEND}
             [[AND t.konzept = {{marke}}]]
             [[AND t.betrieb = {{betrieb}}]]
           GROUP BY t.thema
           ORDER BY sum(t.anzahl * t.schnitt) / nullif(sum(t.anzahl), 0)
           LIMIT 1),
         '– keine Themen in diesem Monat') AS "Schwächstes Thema"`,
  },
  {
    schluessel: 'yx_kachel_antwortquote',
    name: 'Antwortquote',
    beschreibung:
      'Anteil der Bewertungen des Monats, die eine Antwort bekommen haben — über die gewählten '
      + 'Betriebe. Einzelne Betriebe antworten gar nicht; im Konzernschnitt fällt das nicht auf.',
    anzeige: 'scalar',
    parameter: [MONAT, MARKE, BETRIEB],
    // Gewichtet ueber die Bewertungen, nicht als Mittel der Quoten: ein
    // Betrieb mit drei Bewertungen und 0 Prozent zoege den Schnitt sonst
    // genauso weit wie eines mit 200.
    sql: `${MONAT_CTE}
SELECT coalesce(to_char(round(
         100.0 * sum(a.quote * a.bewertungen) / nullif(sum(a.bewertungen), 0), 1), 'FM990.0') || ' %',
         '– keine Daten') AS "Antwortquote"
  FROM mart.bewertung_antwort a
  CROSS JOIN gewaehlt g
 WHERE a.monat = g.monat AND a.operativ AND a.quote IS NOT NULL
   [[AND a.konzept = {{marke}}]]
   [[AND a.betrieb = {{betrieb}}]]`,
  },
  {
    schluessel: 'yx_kachel_offen',
    name: 'Offene 1–2-Sterne-Kritiken',
    beschreibung:
      'Bewertungen mit einem oder zwei Sternen aus dem gewählten Monat, die noch keine Antwort '
      + 'haben. Eine Arbeitsliste, keine Kennzahl — die Zahl sinkt, sobald jemand antwortet.',
    anzeige: 'scalar',
    parameter: [MONAT, MARKE, BETRIEB],
    sql: `${MONAT_CTE}
SELECT coalesce(sum(a.offen_schlecht), 0) AS "Offen, 1–2 Sterne"
  FROM mart.bewertung_antwort a
  CROSS JOIN gewaehlt g
 WHERE a.monat = g.monat AND a.operativ
   [[AND a.konzept = {{marke}}]]
   [[AND a.betrieb = {{betrieb}}]]`,
  },
  {
    schluessel: 'yx_kachel_anteil_schlecht',
    name: 'Anteil 1–2 Sterne',
    beschreibung:
      'Wie viel Prozent der Bewertungen des Monats bei einem oder zwei Sternen lagen. '
      + 'Reagiert deutlich früher als der Bewertungsstand, in dem tausende Altbewertungen stecken.',
    anzeige: 'scalar',
    parameter: [MONAT, MARKE, BETRIEB],
    sql: `${MONAT_CTE}
SELECT coalesce(to_char(round(
         100.0 * sum(n.schlecht) / nullif(sum(n.bewertungen), 0), 1), 'FM990.0') || ' %',
         '– keine Daten') AS "Anteil 1–2 Sterne"
  FROM mart.bewertung_note n
  CROSS JOIN gewaehlt g
 WHERE n.monat = g.monat AND n.operativ
   [[AND n.konzept = {{marke}}]]
   [[AND n.betrieb = {{betrieb}}]]`,
  },

  // -------------------------------------------------------------------
  // Die Klusterung
  // -------------------------------------------------------------------
  {
    schluessel: 'yx_themen',
    name: 'Themen im Monat',
    beschreibung:
      'Yexts eigene Klusterung der Bewertungstexte: wie oft ein Thema angesprochen wurde und '
      + 'mit welcher Durchschnittsnote. Die Note ist die Aussage — „Bestellung 2,1“ heißt, dass '
      + 'wer über die Bestellung schrieb, im Schnitt 2,1 Sterne vergab.',
    anzeige: 'bar',
    parameter: [MONAT, MARKE, BETRIEB],
    sql: `${MONAT_CTE}
SELECT ${THEMA_DEUTSCH}                                                     AS "Thema",
       round(sum(t.anzahl * t.schnitt) / nullif(sum(t.anzahl), 0), 2)       AS "Ø Note",
       sum(t.anzahl)::integer                                               AS "Nennungen"
  FROM mart.bewertung_thema t
  CROSS JOIN gewaehlt g
 WHERE t.monat = g.monat AND t.operativ AND t.schnitt IS NOT NULL ${LAUFEND}
   [[AND t.konzept = {{marke}}]]
   [[AND t.betrieb = {{betrieb}}]]
 GROUP BY t.thema
 ORDER BY 2`,
    // Note als Balken, Nennungen als Linie: die beiden haben verschiedene
    // Groessenordnungen (2,1 gegen 558), auf einer Achse waere die Note
    // ein Strich am Boden.
    visualisierung: {
      'graph.dimensions': ['Thema'],
      'graph.metrics': ['Ø Note', 'Nennungen'],
      series_settings: { Nennungen: { display: 'line', axis: 'right' } },
      'graph.x_axis.title_text': 'Thema',
      'graph.y_axis.title_text': 'Ø Note',
    },
  },
  {
    schluessel: 'yx_themen_verlauf',
    name: 'Themen im Verlauf',
    beschreibung:
      'Wie sich die Note je Thema über die Monate entwickelt. Ein Thema, das kippt, ist hier '
      + 'sichtbar, lange bevor der Bewertungsstand darauf reagiert. Beginnt im April 2026 — '
      + 'davor hat Yext nicht klassifiziert, der Anstieg dort ist der Beginn der Erhebung.',
    anzeige: 'line',
    parameter: [MARKE, BETRIEB, ZEITRAUM],
    // Ohne Alias: {{zeitraum}} ist ein Feldfilter auf mart.bewertung_thema.
    sql: `
SELECT monat                                                    AS "Monat",
       ${themaDeutsch('')}                                       AS "Thema",
       round(sum(anzahl * schnitt) / nullif(sum(anzahl), 0), 2)  AS "Ø Note"
  FROM mart.bewertung_thema
 WHERE operativ AND schnitt IS NOT NULL AND laufend
   [[AND konzept = {{marke}}]]
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY monat, thema
 ORDER BY 1, 2`,
    template_tag_dimension: { zeitraum: ['mart', 'bewertung_thema', 'monat'] },
    visualisierung: {
      'graph.dimensions': ['Monat', 'Thema'],
      'graph.metrics': ['Ø Note'],
      'graph.y_axis.title_text': 'Ø Note',
    },
  },
  {
    schluessel: 'yx_themen_betrieb',
    name: 'Themenprofil je Betrieb',
    beschreibung:
      'Für jeden Betrieb die Note je Thema — schwächstes Thema zuerst. Die Spalte **Schwachpunkt** '
      + 'nennt das Thema, das am weitesten unter dem eigenen Schnitt des Betriebs liegt. '
      + 'Ein Klick auf den Namen öffnet den Betrieb.',
    anzeige: 'table',
    parameter: [MONAT, MARKE, BETRIEB],
    // Fuenf feste Spalten statt einer Pivot-Tabelle: die Themen sind seit
    // April 2026 stabil, und eine Tabelle mit festen Spalten laesst sich
    // je Spalte sortieren -- genau das will man hier. Kaeme ein sechstes
    // Thema dazu, faellt es NICHT hier auf, sondern in
    // yx_themen_unbekannt; das ist der Zweck jener Karte.
    // MONAT_CTE bringt sein eigenes WITH mit -- hier also anhaengen und
    // nicht ein zweites aufmachen.
    sql: `${MONAT_CTE}
, j AS (
    SELECT t.betrieb_key, t.betrieb, t.konzept, t.thema, t.anzahl, t.schnitt, t.abstand
      FROM mart.bewertung_thema t
      CROSS JOIN gewaehlt g
     WHERE t.monat = g.monat AND t.operativ ${LAUFEND}
       [[AND t.konzept = {{marke}}]]
       [[AND t.betrieb = {{betrieb}}]]
)
SELECT j.betrieb                                                       AS "Betrieb",
       j.konzept                                                       AS "Marke",
       max(j.schnitt) FILTER (WHERE j.thema = 'Food')                  AS "Küche",
       max(j.schnitt) FILTER (WHERE j.thema = 'Service and Staff')     AS "Service",
       max(j.schnitt) FILTER (WHERE j.thema = 'Speed of Service')      AS "Wartezeit",
       max(j.schnitt) FILTER (WHERE j.thema = 'Order')                 AS "Bestellung",
       max(j.schnitt) FILTER (WHERE j.thema = 'Restaurant Cleanliness') AS "Sauberkeit",
       sum(j.anzahl)::integer                                          AS "Nennungen",
       -- Der Schwachpunkt ist der groesste ABSTAND nach unten, nicht die
       -- kleinste Note: ein Betrieb mit lauter Vieren hat kein Problem mit
       -- der Wartezeit, nur weil sie bei 3,9 liegt.
       (array_agg(${THEMA_DEUTSCH.replace(/t\.thema/g, 'j.thema')}
                  ORDER BY j.abstand NULLS LAST))[1]                   AS "Schwachpunkt"
  FROM j
 GROUP BY j.betrieb_key, j.betrieb, j.konzept
 ORDER BY min(j.abstand) NULLS LAST, j.betrieb`,
  },
  {
    schluessel: 'yx_themen_ausreisser',
    name: 'Wo ein Thema am weitesten abfällt',
    beschreibung:
      'Die einzelnen Betrieb-und-Thema-Kombinationen mit dem größten Abstand nach unten zum '
      + 'eigenen Schnitt des Betriebs. Das ist die Arbeitsliste: nicht „welcher Betrieb ist schlecht“, '
      + 'sondern „welcher Betrieb ist wobei schlecht“.',
    anzeige: 'table',
    parameter: [MONAT, MARKE, BETRIEB],
    // Mindestens drei Nennungen: bei einer einzigen ist der "Abstand"
    // die Meinung eines Gastes, und die steht oben in der Rangliste,
    // wo sie nicht hingehoert.
    sql: `${MONAT_CTE}
SELECT t.betrieb                       AS "Betrieb",
       t.konzept                       AS "Marke",
       ${THEMA_DEUTSCH}                AS "Thema",
       t.schnitt                       AS "Ø Note",
       t.anzahl                        AS "Nennungen",
       t.anteil                        AS "Anteil %",
       t.abstand                       AS "Abstand zum Betrieb"
  FROM mart.bewertung_thema t
  CROSS JOIN gewaehlt g
 WHERE t.monat = g.monat AND t.operativ AND t.abstand IS NOT NULL
   AND t.anzahl >= 3 ${LAUFEND}
   [[AND t.konzept = {{marke}}]]
   [[AND t.betrieb = {{betrieb}}]]
 ORDER BY t.abstand
 LIMIT 40`,
  },
  {
    schluessel: 'yx_themen_unbekannt',
    name: 'Unbekannte Themen',
    beschreibung:
      'Themen, die Yext liefert und die diese Dashboards nicht kennen. **Sollte leer sein.** '
      + 'Steht hier etwas, hat jemand im Yext-Konto ein Label ergänzt — die Themenkarten zeigen '
      + 'es dann nicht, und das fiele sonst niemandem auf.',
    anzeige: 'table',
    parameter: [MONAT, MARKE],
    // Der Waechter zu yx_themen_betrieb. Die fuenf Spalten dort sind
    // fest; diese Karte ist der Preis dafuer, und ohne sie waere ein
    // sechstes Thema unsichtbar.
    //
    // NUR die laufende Reihe. Vor April 2026 stehen vier von Hand
    // vergebene Alt-Labels ("5", "5 Sterne AR") mit je einer Nennung.
    // Sie sind bekannt, erklaert und gezaehlt (yx_themen_stand,
    // "Einzelfaelle davor") -- stuenden sie hier, meldete die Karte auf
    // Dauer Alarm, und ein Waechter, der immer piept, wird abgeschaltet.
    sql: `
SELECT t.thema                          AS "Thema laut Yext",
       min(t.monat)                     AS "erstmals",
       max(t.monat)                     AS "zuletzt",
       sum(t.anzahl)::integer           AS "Nennungen",
       count(DISTINCT t.betrieb_key)::integer AS "Betriebe"
  FROM mart.bewertung_thema t
 WHERE t.thema NOT IN ('Food', 'Service and Staff', 'Speed of Service',
                       'Order', 'Restaurant Cleanliness')
   AND t.laufend
   [[AND t.konzept = {{marke}}]]
 GROUP BY t.thema
 ORDER BY 4 DESC`,
  },
  {
    schluessel: 'yx_themen_stand',
    name: 'Seit wann es Themen gibt',
    beschreibung:
      'Der Zeitraum, den die Klusterung abdeckt. Yext klassifiziert erst seit April 2026 — '
      + 'ein Vorjahresvergleich ist deshalb bis April 2027 nicht möglich, und eine leere '
      + 'Themenkarte in einem älteren Monat ist kein Fehler.',
    anzeige: 'table',
    parameter: [],
    sql: `
SELECT to_char(ab_monat, 'MM/YYYY')     AS "Themen ab",
       to_char(bis_monat, 'MM/YYYY')    AS "bis",
       themen                           AS "Themen",
       betriebe                         AS "Betriebe",
       CASE WHEN zu_kurz_fuer_vorjahr
            THEN 'nein — die Reihe ist kürzer als ein Jahr'
            ELSE 'ja' END               AS "Vorjahresvergleich möglich",
       zeilen_davor                     AS "Einzelfälle davor"
  FROM mart.bewertung_thema_start`,
  },

  // -------------------------------------------------------------------
  // Antwortverhalten
  // -------------------------------------------------------------------
  {
    schluessel: 'yx_antwort_rangliste',
    name: 'Antwortverhalten je Betrieb',
    beschreibung:
      'Wer auf Bewertungen antwortet und wie schnell — schlechteste Quote zuerst. '
      + '**Offen 1–2★** ist die Arbeitsliste. Die Reaktionszeit zählt ab der Bewertung; '
      + 'wo nicht geantwortet wurde, steht sie leer und nicht auf null.',
    anzeige: 'table',
    parameter: [MONAT, MARKE, BETRIEB],
    sql: `${MONAT_CTE}
SELECT a.betrieb                        AS "Betrieb",
       a.konzept                        AS "Marke",
       a.bewertungen                    AS "Bewertungen",
       a.quote_prozent                  AS "Antwortquote %",
       a.reaktion_stunden               AS "Reaktion (Std.)",
       a.offen                          AS "Offen",
       a.offen_schlecht                 AS "Offen 1–2★"
  FROM mart.bewertung_antwort a
  CROSS JOIN gewaehlt g
 WHERE a.monat = g.monat AND a.operativ AND a.bewertungen > 0
   [[AND a.konzept = {{marke}}]]
   [[AND a.betrieb = {{betrieb}}]]
 ORDER BY a.quote NULLS FIRST, a.bewertungen DESC`,
  },
  {
    schluessel: 'yx_antwort_verlauf',
    name: 'Antwortquote im Verlauf',
    beschreibung:
      'Antwortquote und Reaktionszeit über die Monate. Beide zusammen, weil eine hohe Quote '
      + 'wenig wert ist, wenn die Antwort vier Wochen braucht.',
    anzeige: 'line',
    parameter: [MARKE, BETRIEB, ZEITRAUM],
    // Ohne Alias: {{zeitraum}} ist ein Feldfilter auf mart.bewertung_antwort.
    sql: `
SELECT monat                                                          AS "Monat",
       round(100.0 * sum(quote * bewertungen)
             / nullif(sum(bewertungen), 0), 1)                        AS "Antwortquote %",
       round(sum(reaktion_stunden * antworten)
             / nullif(sum(antworten) FILTER (WHERE reaktion_stunden IS NOT NULL), 0), 1)
                                                                      AS "Reaktion (Std.)"
  FROM mart.bewertung_antwort
 WHERE operativ
   [[AND konzept = {{marke}}]]
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY monat
 ORDER BY 1`,
    template_tag_dimension: { zeitraum: ['mart', 'bewertung_antwort', 'monat'] },
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Antwortquote %', 'Reaktion (Std.)'],
      series_settings: { 'Reaktion (Std.)': { axis: 'right' } },
    },
  },

  // -------------------------------------------------------------------
  // Notenverteilung
  // -------------------------------------------------------------------
  {
    schluessel: 'yx_note_verteilung',
    name: 'Notenverteilung im Verlauf',
    beschreibung:
      'Wie viele 1-, 2-, … 5-Sterne-Bewertungen je Monat eingingen. Der Anteil der schlechten '
      + 'reagiert früher als der Schnitt: drei wütende Bewertungen bewegen einen Stand aus '
      + 'tausenden Stimmen kaum, diesen Balken sehr wohl.',
    anzeige: 'bar',
    parameter: [MARKE, BETRIEB, ZEITRAUM],
    // Ohne Alias: {{zeitraum}} ist ein Feldfilter auf mart.bewertung_note.
    sql: `
SELECT monat                                            AS "Monat",
       sum(schlecht)::integer                           AS "1–2 Sterne",
       sum(bewertungen - schlecht - gut)::integer       AS "3 Sterne",
       sum(gut)::integer                                AS "4–5 Sterne",
       round(100.0 * sum(schlecht) / nullif(sum(bewertungen), 0), 1) AS "Anteil 1–2★ %"
  FROM mart.bewertung_note
 WHERE operativ
   [[AND konzept = {{marke}}]]
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY monat
 ORDER BY 1`,
    template_tag_dimension: { zeitraum: ['mart', 'bewertung_note', 'monat'] },
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['1–2 Sterne', '3 Sterne', '4–5 Sterne', 'Anteil 1–2★ %'],
      'stackable.stack_type': 'stacked',
      series_settings: {
        'Anteil 1–2★ %': { display: 'line', axis: 'right' },
        '1–2 Sterne': { color: '#ED6E6E' },
        '4–5 Sterne': { color: '#84BB4C' },
      },
    },
  },
  {
    schluessel: 'yx_note_rangliste',
    name: 'Anteil schlechter Bewertungen je Betrieb',
    beschreibung:
      'Welche Betriebe im gewählten Monat den höchsten Anteil an 1- und 2-Sterne-Bewertungen '
      + 'hatten. Aussagekräftig ab etwa zehn Bewertungen — darunter steht die Prozentzahl für '
      + 'sehr wenige Stimmen, deshalb die Spalte daneben.',
    anzeige: 'table',
    parameter: [MONAT, MARKE, BETRIEB],
    sql: `${MONAT_CTE}
SELECT n.betrieb                        AS "Betrieb",
       n.konzept                        AS "Marke",
       n.bewertungen                    AS "Bewertungen",
       n.schlecht                       AS "davon 1–2★",
       n.anteil_schlecht                AS "Anteil %",
       n.schnitt                        AS "Ø des Monats"
  FROM mart.bewertung_note n
  CROSS JOIN gewaehlt g
 WHERE n.monat = g.monat AND n.operativ AND n.bewertungen > 0
   [[AND n.konzept = {{marke}}]]
   [[AND n.betrieb = {{betrieb}}]]
 ORDER BY n.anteil_schlecht DESC, n.bewertungen DESC`,
  },

  // -------------------------------------------------------------------
  // Sichtbarkeit
  // -------------------------------------------------------------------
  {
    schluessel: 'yx_sicht_kachel_impressionen',
    name: 'Impressionen',
    beschreibung:
      'Wie oft die Einträge dieser Betriebe im gewählten Monat in den Portalen ausgespielt '
      + 'wurden — über alle Portale, nicht nur Google.',
    anzeige: 'scalar',
    parameter: [MONAT, MARKE, BETRIEB],
    sql: `${MONAT_CTE}
SELECT coalesce(sum(s.impressionen_gesamt), 0) AS "Impressionen"
  FROM mart.betrieb_sichtbarkeit s
  CROSS JOIN gewaehlt g
 WHERE s.monat = g.monat AND s.operativ
   [[AND s.konzept = {{marke}}]]
   [[AND s.betrieb = {{betrieb}}]]`,
  },
  {
    schluessel: 'yx_sicht_kachel_genauigkeit',
    name: 'Ø Eintragsgenauigkeit',
    beschreibung:
      'Anteil der Portaleinträge, die mit unseren Stammdaten übereinstimmen. Unter 90 % heißt: '
      + 'Gäste finden dort Öffnungszeiten oder Telefonnummern, die nicht stimmen.',
    anzeige: 'scalar',
    parameter: [MONAT, MARKE, BETRIEB],
    sql: `${MONAT_CTE}
SELECT coalesce(to_char(round(100 * avg(s.genauigkeit), 1), 'FM990.0') || ' %', '– keine Daten')
         AS "Ø Eintragsgenauigkeit"
  FROM mart.betrieb_sichtbarkeit s
  CROSS JOIN gewaehlt g
 WHERE s.monat = g.monat AND s.operativ AND s.genauigkeit IS NOT NULL
   [[AND s.konzept = {{marke}}]]
   [[AND s.betrieb = {{betrieb}}]]`,
  },
  {
    schluessel: 'yx_sicht_trichter',
    name: 'Von der Anzeige zum Klick',
    beschreibung:
      'Der Trichter über die Monate: wie oft ein Eintrag ausgespielt wurde, wie oft danach '
      + 'gesucht, wie oft das Profil geöffnet und wie oft geklickt wurde.',
    anzeige: 'line',
    parameter: [MARKE, BETRIEB, ZEITRAUM],
    // Ohne Alias: {{zeitraum}} ist ein Feldfilter auf mart.betrieb_sichtbarkeit.
    sql: `
SELECT monat                            AS "Monat",
       sum(impressionen_gesamt)         AS "Impressionen",
       sum(suchen)                      AS "Suchen",
       sum(profilaufrufe)               AS "Profilaufrufe",
       sum(klicks)                      AS "Klicks"
  FROM mart.betrieb_sichtbarkeit
 WHERE operativ
   [[AND konzept = {{marke}}]]
   [[AND betrieb = {{betrieb}}]]
   [[AND {{zeitraum}}]]
 GROUP BY monat
 ORDER BY 1`,
    template_tag_dimension: { zeitraum: ['mart', 'betrieb_sichtbarkeit', 'monat'] },
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Impressionen', 'Suchen', 'Profilaufrufe', 'Klicks'],
      series_settings: {
        Suchen: { axis: 'right' }, Profilaufrufe: { axis: 'right' }, Klicks: { axis: 'right' },
      },
    },
  },
  {
    schluessel: 'yx_sicht_benchmark',
    name: 'Sichtbarkeit gegen vergleichbare Betriebe',
    beschreibung:
      'Yext liefert zu jedem Betrieb den Median vergleichbarer Betriebe. **Faktor** unter 1 heißt: '
      + 'dieser Betrieb wird seltener gesehen als vergleichbare. Betriebe ohne Vergleichsgruppe '
      + 'stehen nicht in der Liste — das ist eine Leerstelle bei Yext, kein guter Wert.',
    anzeige: 'table',
    parameter: [MONAT, MARKE, BETRIEB],
    sql: `${MONAT_CTE}
SELECT s.betrieb                        AS "Betrieb",
       s.konzept                        AS "Marke",
       s.impressionen_google            AS "Google-Impressionen",
       s.benchmark_google               AS "Median vergleichbarer",
       s.faktor                         AS "Faktor",
       s.genauigkeit_prozent            AS "Genauigkeit %"
  FROM mart.betrieb_sichtbarkeit s
  CROSS JOIN gewaehlt g
 WHERE s.monat = g.monat AND s.operativ AND s.faktor IS NOT NULL
   [[AND s.konzept = {{marke}}]]
   [[AND s.betrieb = {{betrieb}}]]
 ORDER BY s.faktor`,
  },
  {
    schluessel: 'yx_sicht_pflege',
    name: 'Pflegezustand der Portaleinträge',
    beschreibung:
      'Wo Einträge nicht mit unseren Stammdaten übereinstimmen, nicht ausgespielt werden oder '
      + 'Änderungsvorschläge der Portale offen liegen. Eine Arbeitsliste fürs Marketing, '
      + 'schlechteste Genauigkeit zuerst.',
    anzeige: 'table',
    parameter: [MONAT, MARKE, BETRIEB],
    sql: `${MONAT_CTE}
SELECT s.betrieb                        AS "Betrieb",
       s.konzept                        AS "Marke",
       s.genauigkeit_prozent            AS "Genauigkeit %",
       s.eintraege_live                 AS "Einträge live",
       s.eintraege_unavailable          AS "nicht ausgespielt",
       s.vorschlaege_offen              AS "offene Vorschläge"
  FROM mart.betrieb_sichtbarkeit s
  CROSS JOIN gewaehlt g
 WHERE s.monat = g.monat AND s.operativ AND s.genauigkeit IS NOT NULL
   [[AND s.konzept = {{marke}}]]
   [[AND s.betrieb = {{betrieb}}]]
 ORDER BY s.genauigkeit`,
  },

  // -------------------------------------------------------------------
  // Datenstand
  // -------------------------------------------------------------------
  {
    schluessel: 'yx_datenstand',
    name: 'Wie frisch die Yext-Zahlen sind',
    beschreibung:
      'Bis wann Yext eine Zahl als vollständig meldet. Bewertungen und Antworten sind '
      + 'tagesaktuell, die Sichtbarkeitszahlen hinken bis zu einer Woche hinterher. '
      + 'Der laufende Monat ist deshalb dort **immer** ein Teilmonat.',
    anzeige: 'table',
    parameter: [],
    // Nur die Metriken, die dieses Dashboard tatsaechlich benutzt. Yext
    // fuehrt 75; die uebrigen 65 hier aufzulisten hiesse, die Karte
    // unlesbar zu machen, um vollstaendig zu wirken.
    sql: `
SELECT CASE d.metrik
           WHEN 'NEW_REVIEWS'                 THEN 'Bewertungen'
           WHEN 'AVERAGE_RATING'              THEN 'Ø Note'
           WHEN 'RESPONSE_RATE'               THEN 'Antwortquote'
           WHEN 'LISTINGS_ACCURACY'           THEN 'Eintragsgenauigkeit'
           WHEN 'TOTAL_LISTINGS_IMPRESSIONS'  THEN 'Impressionen'
           WHEN 'GOOGLE_LISTINGS_IMPRESSIONS' THEN 'Google-Impressionen'
           WHEN 'SEARCHES'                    THEN 'Suchen'
           WHEN 'PROFILE_VIEWS'               THEN 'Profilaufrufe'
           WHEN 'CLICK_COUNT'                 THEN 'Klicks'
           ELSE d.metrik
       END                                                  AS "Zahl",
       d.vollstaendig_bis                                   AS "vollständig bis",
       (current_date - d.vollstaendig_bis)                  AS "Tage Rückstand"
  FROM core.yext_datenstand d
 WHERE d.metrik IN ('NEW_REVIEWS','AVERAGE_RATING','RESPONSE_RATE','LISTINGS_ACCURACY',
                    'TOTAL_LISTINGS_IMPRESSIONS','GOOGLE_LISTINGS_IMPRESSIONS',
                    'SEARCHES','PROFILE_VIEWS','CLICK_COUNT')
 ORDER BY d.vollstaendig_bis, 1`,
  },
]
