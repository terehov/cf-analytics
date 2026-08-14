// =====================================================================
// Karten fuer die Standortkarte.
//
// DIE FALLE, DIE ALLES ANDERE UEBERSCHATTET: mart.standort hat eine Zeile
// je Betrieb UND MONAT. Am 03.08.2026 sind das 6.240 Zeilen fuer 60
// Standorte, ueber 104 Monate. Ohne Monatsfilter landet jeder Standort
// hundertfach auf derselben Koordinate -- die Karte sieht dann richtig
// aus, weil die Punkte uebereinanderliegen, und jede Summe daneben ist es
// nicht. Deshalb traegt JEDE Karte hier den Monatsfilter.
//
// ZWEITE FALLE: nicht jeder Standort hat eine Ampel. Standorte ohne
// Bewertung (BWA fehlt) bleiben sichtbar, mit weissem Punkt -- eine
// fehlende Bewertung ist eine Aussage, kein Grund zum Ausblenden. Wer sie
// herausfiltert, sieht nur die bewerteten Standorte und haelt das fuer
// alle.
//
// DRITTE FALLE, seit dem Review vom 03.08.2026 behandelt: nicht jeder
// Standort mit Koordinaten ist im gewaehlten Monat OPERATIV.
// mart.round_table_monat.operativ (Migration 0039) heisst: Umsatz im
// Monat, und weder Test- noch Verwaltungsgesellschaft. Im Juli 2026 sind
// 11 von 60 Standorten nicht operativ -- geschlossene, inaktive und
// umsatzlose Betriebe, die trotzdem eine (nachgetragene) rote Ampel trugen.
// Ein GESCHLOSSEN-Betrieb darf nicht als "Sofort eskalieren" gluehen: auf
// den Karten erscheint es neutral (schwarzer Punkt, "Nicht operativ"),
// aus Listen und Zaehlungen faellt es heraus.
//
// VIERTE EINSCHRAENKUNG, die in die Beschreibung gehoert: nur ein Teil
// der 141 gefuehrten Betriebe hat ueberhaupt Koordinaten (60 am
// 03.08.2026). Welche fehlen, steht in mart.standort_fehlend -- KEINE
// festen Zahlen dazu in Kartentexte schreiben, die veralten; die
// Fehlend-Karte zeigt die Ist-Zahl selbst.
// =====================================================================

import type { Karte } from './typen'
import { MONAT_CTE, P_MONAT, P_MARKE, P_BETRIEB, P_AMPEL, P_INTENSITAET } from './gemeinsam'

const MONAT = P_MONAT
const MARKE = P_MARKE
const BETRIEB = P_BETRIEB
const AMPEL = P_AMPEL
const INTENSITAET = P_INTENSITAET

/**
 * Die Farbe des Punkts: INTENSITAET, nicht Gesamtampel.
 *
 * Warum nicht die Ampel: `gesamt` ist ein logisches ODER ueber sechs
 * Kennzahlen -- eine einzige rote genuegt. Im Juni 2026 sind damit 43 von
 * 48 Standorten rot, und eine Karte, auf der fast alles dieselbe Farbe
 * hat, traegt keine Information.
 *
 * `intensitaet` ZAEHLT stattdessen und trennt die 43 in 19 "Sofort
 * eskalieren" und 24 "Sofort handeln". Das ist der Unterschied, auf den es
 * ankommt.
 *
 * NICHT GEMITTELT, und zwar mit Absicht. Das abgeloeste Excel
 * (examples/JULI_Round_Table_Ampelsystem.xlsx, Blatt 00_Dashboard) hat
 * ebenfalls gezaehlt statt gemittelt. Zwei der sechs Kennzahlen --
 * Online-Bewertung und OM-Score -- haben bei uns ueberhaupt keine Daten
 * (nachgemessen Juni 2026: beide 0 rote). Ein Mittelwert waere
 * stillschweigend einer ueber vier statt sechs und wuerde sich
 * verschieben, sobald die Bewertungen dazukommen -- ohne dass sich an der
 * Lage etwas geaendert haette.
 *
 * Die Reihenfolge ist Handlungsdruck, damit die Legende oben mit dem
 * beginnt, was brennt.
 *
 * NICHT OPERATIV schlaegt alles: ein Betrieb ohne Umsatz im Monat (oder eine
 * Verwaltungs-/Testgesellschaft) traegt zwar oft noch eine nachgetragene
 * Intensitaet aus alten BWA-Werten, aber die ist kein Handlungsdruck --
 * niemand eskaliert einen geschlossenen Betrieb. Es bleibt als neutraler
 * Punkt sichtbar, damit die Karte nicht heimlich schrumpft.
 *
 * Die Fragmente setzen die Aliase `s` (mart.standort) UND `r`
 * (mart.round_table_monat, liefert operativ) im Sichtbereich voraus.
 */
const INTENSITAET_TEXT = `
       CASE
         WHEN NOT r.operativ THEN            '6 — Nicht operativ'
         ELSE CASE s.intensitaet
           WHEN 'Sofort eskalieren' THEN '1 — Sofort eskalieren'
           WHEN 'Sofort handeln'    THEN '2 — Sofort handeln'
           WHEN 'Nachforschung'     THEN '3 — Nachforschung'
           WHEN 'Beobachten/OK'     THEN '4 — Beobachten/OK'
           ELSE                          '5 — Keine Bewertung'
         END
       END`

/** Das Emoji zur Intensitaet -- steht im Punktnamen, weil Metabases
 *  Punktkarte nach Zahlen faerbt und nicht nach Kategorien.
 *  ⚫ = nicht operativ (bewusst dunkler als ⚪ "keine Bewertung": das eine
 *  Betrieb laeuft nicht, dem anderen fehlt nur die BWA). */
const INTENSITAET_EMOJI = `
       CASE
         WHEN NOT r.operativ THEN '⚫'
         ELSE CASE s.intensitaet
           WHEN 'Sofort eskalieren' THEN '🟥'
           WHEN 'Sofort handeln'    THEN '🔴'
           WHEN 'Nachforschung'     THEN '🟠'
           WHEN 'Beobachten/OK'     THEN '🟢'
           ELSE                          '⚪'
         END
       END`

/**
 * Der Kartenausschnitt.
 *
 * Ohne diese drei Angaben waehlt Metabase den Ausschnitt selbst und trifft
 * daneben: nachgemessen am 27.07.2026 lagen 2 der 48 Marker ausserhalb des
 * sichtbaren Bereichs. Man sieht 46 Punkte, die Karte sieht vollstaendig
 * aus, und die beiden fehlenden faellt niemandem auf.
 *
 * Die Werte sind aus den Daten gerechnet, nicht geschaetzt -- Mitte der
 * Umschliessenden aller Standorte in manual.betrieb_standort:
 *   Breite  47,72 bis 53,08  ->  Mitte 50,40
 *   Laenge   6,78 bis 13,74  ->  Mitte 10,26
 * Zoom 6 zeigt Deutschland ganz; nachgemessen liegen damit 48 von 48
 * Markern im Bild.
 *
 * Sie muessen nachgezogen werden, wenn Standorte ausserhalb dieses
 * Rahmens dazukommen -- ein Betrieb in Hamburg oder Wien verschiebt die
 * Mitte. Die Pruefung dafuer steht in `bun run metabase/kartenausschnitt.ts`.
 */
const AUSSCHNITT = {
  'map.center_latitude': 50.4018,
  'map.center_longitude': 10.2562,
  'map.zoom': 6,
}

/** Sortierung nach Handlungsdruck, in mehreren Karten gebraucht.
 *  Nicht operative Betriebe ganz ans Ende -- sie sind kein Druck. */
const NACH_DRUCK = `
          CASE
            WHEN NOT r.operativ THEN 6
            ELSE CASE s.intensitaet
              WHEN 'Sofort eskalieren' THEN 1
              WHEN 'Sofort handeln'    THEN 2
              WHEN 'Nachforschung'     THEN 3
              WHEN 'Beobachten/OK'     THEN 4
              ELSE                          5 END
          END`

export const karten: Karte[] = [
  {
    schluessel: 'so_karte',
    name: 'Standorte auf der Karte',
    beschreibung:
      'Ein Punkt je Standort, eingefärbt nach **Handlungsbedarf**. Ein Klick öffnet die '
      + 'Detailseite des Betriebs.\n\n'
      + '🟥 Sofort eskalieren (2+ Kennzahlen rot) · 🔴 Sofort handeln (1 rot) · '
      + '🟠 Nachforschung (2+ orange) · 🟢 Beobachten/OK · ⚪ keine Bewertung möglich · '
      + '⚫ nicht operativ (kein Umsatz im Monat — geschlossen, inaktiv oder verwaltend)\n\n'
      + '**Nicht operative Betriebe glühen hier absichtlich nicht rot.** Ein geschlossener Betrieb '
      + 'trägt oft noch eine nachgetragene Ampel aus alten BWA-Werten; das ist kein '
      + 'Handlungsbedarf. Es bleibt als schwarzer Punkt sichtbar, damit die Karte nicht '
      + 'heimlich schrumpft — die Spalte „Status" im Tooltip sagt, warum.\n\n'
      + '**Warum nicht nach der Gesamtampel?** Die ist ein Oder über sechs Kennzahlen — eine '
      + 'einzige rote genügt. Im Juni 2026 wären damit 43 von 48 Standorten rot, und eine '
      + 'Karte, auf der fast alles gleich aussieht, sagt nichts. Der Handlungsbedarf zählt '
      + 'stattdessen und trennt diese 43 in 19 zum Eskalieren und 24 zum Handeln.\n\n'
      + '**Die hohe Rot-Quote ist kein Datenfehler.** Die Personalquote liegt real bei '
      + '35–45 % gegen eine Schwelle von 28/32 %, die im Excel-Blatt „Regeln" ausdrücklich '
      + 'als „Default, bei Bedarf Werte anpassen" steht — anders als der Wareneinsatz, der '
      + 'dort „Fix nach Vorgabe" heißt. Einordnung in `docs/befunde-datenlage.md`.\n\n'
      + 'Antippen zeigt die sechs Einzelampeln — ohne sie sieht man nur, **dass** es rot ist, '
      + 'nicht **woran** es liegt. Die Grafik daneben beantwortet dieselbe Frage für alle '
      + 'Standorte auf einmal.\n\n'
      + 'Zu sehen sind nur Standorte mit hinterlegten Koordinaten; welche fehlen, steht '
      + 'ganz unten.',
    anzeige: 'map',
    parameter: [MONAT, MARKE],
    // WARUM DIE AMPEL IM TEXT STEHT UND NICHT IN DER PUNKTFARBE.
    //
    // Nachgemessen am 27.07.2026 in Metabase v0.63.1.6, nachdem gemeldet
    // wurde "die Marker sind alle blau": Die Punktkarte kennt genau drei
    // Ausprägungen, und KEINE davon nimmt eine Farbdimension entgegen.
    //   markers  zeichnet jeden Punkt als <img src="pin.png"> -- eine
    //            statische Bilddatei, 48-mal dieselbe.
    //   tiles    rendert serverseitig; die Kacheln wurden Pixel fuer Pixel
    //            ausgezaehlt und enthalten zwei Farben, weiss und
    //            rgb(76,157,230). Ebenfalls keine Dimension.
    //   grid     verdichtet zu Flaechen und verliert den Standort.
    //
    // Statt die Ampel stillschweigend zu verlieren, steht sie als Emoji
    // VORNE in jeder Spalte, die im Tooltip auftaucht. Damit ist sie beim
    // Antippen sichtbar -- und in der Tabelle darunter, die dieselben
    // Standorte nach Handlungsdruck sortiert, ohnehin.
    //
    // Nicht uebernommen wurde `map.metric_column`: die Einstellung stand
    // gesetzt, wirkte aber nie. Sie ist ausgeblendet, solange pin_type
    // nicht heat oder grid ist -- gespeichert heisst bei Metabase nicht
    // gewirkt. Siehe docs/fehlerkatalog.md.
    sql: `${MONAT_CTE}
SELECT ${INTENSITAET_EMOJI} || ' ' || s.betrieb AS "Standort",
       s.konzept                        AS "Marke",
       s.breitengrad::float             AS "Breitengrad",
       s.laengengrad::float             AS "Längengrad",${INTENSITAET_TEXT} AS "Handlungsbedarf",
       round(s.umsatz)                  AS "Umsatz",
       -- Die sechs Einzelampeln. Ohne sie sieht man auf der Karte 43-mal
       -- dieselbe Farbe und weiss nicht, WORAN es liegt. '–' heisst
       -- "nicht bewertbar", nicht "in Ordnung" -- bei Bewertung und OM ist
       -- das derzeit der Normalfall, weil dafuer noch keine Daten kommen.
       coalesce(au.emoji, '–')  AS "Umsatz ●",
       coalesce(ap.emoji, '–')  AS "Personal ●",
       coalesce(ab.emoji, '–')  AS "WE Bar ●",
       coalesce(ak.emoji, '–')  AS "WE Küche ●",
       coalesce(aw.emoji, '–')  AS "Bewertung ●",
       coalesce(ao.emoji, '–')  AS "OM vor Ort ●",
       -- Warum ein Punkt schwarz ist: der heutige Betriebsstatus aus
       -- mart.betrieb_status (via round_table_monat). 'ohne_geschaeft'
       -- lesbar gemacht; die uebrigen Werte sind selbsterklaerend.
       CASE WHEN r.status = 'ohne_geschaeft' THEN 'ohne Geschäft'
            ELSE r.status END    AS "Status",
       s.ort                            AS "Ort",
       s.betrieb                        AS "Betrieb"
  FROM mart.standort s
  CROSS JOIN gewaehlt g
  LEFT JOIN mart.round_table_monat r
         ON r.betrieb_key = s.betrieb_key AND r.monat = s.monat
  LEFT JOIN ampel.beschriftung au ON au.status = r.ampel_umsatz
  LEFT JOIN ampel.beschriftung ap ON ap.status = r.ampel_personal
  LEFT JOIN ampel.beschriftung ab ON ab.status = r.ampel_we_bar
  LEFT JOIN ampel.beschriftung ak ON ak.status = r.ampel_we_kueche
  LEFT JOIN ampel.beschriftung aw ON aw.status = r.ampel_bewertung
  LEFT JOIN ampel.beschriftung ao ON ao.status = r.ampel_om
 WHERE s.monat = g.monat
   AND s.breitengrad IS NOT NULL
   [[AND s.konzept = {{marke}}]]
 ORDER BY${NACH_DRUCK},
          s.betrieb`,
    visualisierung: {
      ...AUSSCHNITT,
      'map.type': 'pin',
      'map.latitude_column': 'Breitengrad',
      'map.longitude_column': 'Längengrad',
      'map.pin_type': 'markers',
      // Titel der Sprechblase: enthaelt bereits das Ampel-Emoji.
      'map.tooltip_column': 'Standort',
      column_settings: {
        '["name","Umsatz"]': {
          number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0,
        },
      },
    },
  },

  {
    // Das Excel hatte genau diesen Block (00_Dashboard, Zeilen 9-11). Er
    // beantwortet die Frage, die die Karte aufwirft: dort sieht man, DASS
    // fast alles rot ist -- hier, WORAN es liegt.
    schluessel: 'so_rot_treiber',
    name: 'Rot-Treiber nach Bereich',
    beschreibung:
      'Je Kennzahl die Anzahl der **operativen** Standorte mit roter Ampel. Beantwortet die '
      + 'Frage, die die Karte aufwirft: dort sieht man, dass fast alles rot ist — hier, '
      + 'woran es liegt. Typisch trägt **Personal** den Befund fast allein, gefolgt vom '
      + 'Umsatz; die Wareneinsätze fallen kaum ins Gewicht.\n\n'
      + 'Nicht operative Betriebe (geschlossen, inaktiv, ohne Umsatz im Monat) zählen nicht '
      + 'mit — ihre nachgetragenen roten Ampeln sind kein Befund, an dem jemand arbeiten '
      + 'könnte.\n\n'
      + '**Ein niedriger Balken heißt nicht Entwarnung**: OM vor Ort liefert noch gar keine '
      + 'Daten, die Online-Bewertung erst seit der Yext-Anbindung. Genau deshalb wird hier '
      + 'gezählt und nicht gemittelt: ein Schnitt wäre stillschweigend einer über die '
      + 'Kennzahlen mit Daten statt über alle sechs.',
    anzeige: 'row',
    parameter: [MONAT, MARKE],
    sql: `${MONAT_CTE},
-- Einmal lesen, dann die sechs Ampelspalten in Zeilen kippen. Die
-- Alternative waeren sechs UNION-Zweige, die alle dieselbe Verknuepfung
-- wiederholen -- gleiches Ergebnis, sechsfache Pflege.
mit_ampel AS (
    SELECT r.*
      FROM mart.round_table_monat r
      JOIN mart.standort s ON s.betrieb_key = r.betrieb_key AND s.monat = r.monat
      CROSS JOIN gewaehlt g
     WHERE r.monat = g.monat
       AND s.breitengrad IS NOT NULL
       -- Nur operative Betriebe. Ohne diese Zeile zaehlen geschlossene
       -- Betriebe mit nachgetragenen Ampeln mit: nachgemessen Juli 2026
       -- stuende Personal auf 46 statt 42, Umsatz auf 25 statt 21.
       AND r.operativ
       [[AND s.konzept = {{marke}}]]
)
SELECT b.bereich AS "Bereich",
       count(*) FILTER (WHERE b.ampel = 'rot') AS "Standorte mit roter Ampel",
       -- Fuer den Klick: diese Karte zaehlt ausschliesslich rote, der Wert
       -- ist also immer derselbe. Er steht trotzdem als Spalte da, weil
       -- Metabase nur Spalten uebergeben kann, keine festen Werte.
       'rot'::text AS "Ampelwert"
  FROM mit_ampel m
  CROSS JOIN LATERAL (VALUES
        ('Personal',         m.ampel_personal,  1),
        ('Umsatz',           m.ampel_umsatz,    2),
        ('WE Küche',         m.ampel_we_kueche, 3),
        ('WE Bar',           m.ampel_we_bar,    4),
        ('Online-Bewertung', m.ampel_bewertung, 5),
        ('OM vor Ort',       m.ampel_om,        6)
       ) AS b(bereich, ampel, sortier)
 GROUP BY b.bereich, b.sortier
 ORDER BY b.sortier`,
    visualisierung: {
      'graph.dimensions': ['Bereich'],
      'graph.metrics': ['Standorte mit roter Ampel'],
      'graph.x_axis.title_text': 'Standorte mit roter Ampel',
      'graph.y_axis.title_text': '',
    },
  },

  {
    schluessel: 'so_tabelle',
    name: 'Standorte im Überblick',
    beschreibung:
      'Dieselben Standorte als Liste, sortiert nach Handlungsdruck. Ein Klick auf den '
      + 'Betriebsnamen öffnet die Detailseite.\n\n'
      + '**Nur operative Betriebe** — geschlossene, inaktive und umsatzlose stehen nicht in '
      + 'einer Arbeitsliste. Auf der Karte darüber bleiben sie als schwarze Punkte sichtbar.',
    anzeige: 'table',
    parameter: [MONAT, MARKE],
    // Der JOIN auf round_table_monat ist verlustfrei: mart.standort baut
    // selbst darauf auf, jede Standortzeile mit Monat hat ihre r-Zeile.
    sql: `${MONAT_CTE}
SELECT coalesce(s.ampel_emoji, '⚪')     AS "●",
       s.betrieb                        AS "Betrieb",
       s.konzept                        AS "Marke",
       s.ort                            AS "Ort",
       s.plz                            AS "PLZ",
       s.strasse                        AS "Straße",
       round(s.umsatz)                  AS "Umsatz",
       s.personalkosten_ogf_pct         AS "Personal %",
       s.we_bar_pct                     AS "WE Bar %",
       s.we_kueche_pct                  AS "WE Küche %",
       s.intensitaet                    AS "Handlungsbedarf",
       s.prioritaet                     AS "Priorität",
       s.genauigkeit                    AS "Genauigkeit"
  FROM mart.standort s
  CROSS JOIN gewaehlt g
  JOIN mart.round_table_monat r
       ON r.betrieb_key = s.betrieb_key AND r.monat = s.monat
 WHERE s.monat = g.monat
   AND s.breitengrad IS NOT NULL
   -- Eine Liste, nach der gearbeitet wird: geschlossene Betriebe mit
   -- nachgetragener roter Ampel gehoeren nicht hinein (Review 03.08.2026).
   AND r.operativ
   [[AND s.konzept = {{marke}}]]
 -- Erst der Handlungsbedarf, dann die Ampel: die Beschreibung verspricht
 -- "sortiert nach Handlungsdruck", und der steht in s.intensitaet — ein
 -- Rot mit zwei roten Bereichen ("Sofort eskalieren") gehoert ueber ein
 -- Rot mit einem ("Sofort handeln"). Vorher galten beide gleich.
 ORDER BY CASE s.intensitaet WHEN 'Sofort eskalieren' THEN 1
                             WHEN 'Sofort handeln'    THEN 2
                             WHEN 'Nachforschung'     THEN 3 ELSE 4 END,
          CASE s.ampel WHEN 'rot' THEN 1 WHEN 'orange' THEN 2
                       WHEN 'unvollstaendig' THEN 3 WHEN 'gruen' THEN 4 ELSE 5 END,
          s.umsatz DESC NULLS LAST`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': {
          number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0,
        },
        '["name","Personal %"]': { suffix: ' %' },
        '["name","WE Bar %"]': { suffix: ' %' },
        '["name","WE Küche %"]': { suffix: ' %' },
      },
    },
  },

  {
    schluessel: 'so_verteilung',
    name: 'Standorte je Marke',
    beschreibung:
      'Wie sich die Standorte mit Koordinaten auf die Marken verteilen, aufgeteilt nach '
      + '**Handlungsbedarf** — denselben Kategorien wie die Punktfarben der Karte. Zeigt auf '
      + 'einen Blick, welche Marke wie viele Betriebe im Feuer hat.\n\n'
      + '„Nicht operativ" steht als eigenes Segment dabei: geschlossene und umsatzlose '
      + 'Betriebe zählen nicht als Handlungsbedarf, sollen aber auch nicht stillschweigend '
      + 'aus der Summe verschwinden.',
    anzeige: 'bar',
    parameter: [MONAT, MARKE],
    // BIS 03.08.2026 gruppierte diese Karte nach der GESAMTAMPEL und
    // beschriftete die Segmente mit Intensitaets-Vokabular ("Sofort
    // handeln" fuer ampel = rot). Die Ampel ist aber ein ODER ueber sechs
    // Kennzahlen -- im Juli 2026 waren damit 56 von 60 Standorten in einer
    // Klasse (55 rot + 1 nicht zuordenbar), und der Stapel trug keine
    // Information. `intensitaet` ZAEHLT stattdessen (Begruendung oben bei
    // INTENSITAET_TEXT) und trennt echt: 23 eskalieren / 24 handeln.
    sql: `${MONAT_CTE}
SELECT coalesce(s.konzept, '(nicht zugeordnet)') AS "Marke",
       count(*) FILTER (WHERE r.operativ AND s.intensitaet = 'Sofort eskalieren') AS "Sofort eskalieren",
       count(*) FILTER (WHERE r.operativ AND s.intensitaet = 'Sofort handeln')    AS "Sofort handeln",
       count(*) FILTER (WHERE r.operativ AND s.intensitaet = 'Nachforschung')     AS "Nachforschung",
       count(*) FILTER (WHERE r.operativ AND s.intensitaet = 'Beobachten/OK')     AS "Beobachten/OK",
       count(*) FILTER (WHERE r.operativ AND s.intensitaet IS NULL)               AS "Keine Bewertung",
       count(*) FILTER (WHERE NOT r.operativ)                                     AS "Nicht operativ"
  FROM mart.standort s
  CROSS JOIN gewaehlt g
  JOIN mart.round_table_monat r
       ON r.betrieb_key = s.betrieb_key AND r.monat = s.monat
 WHERE s.monat = g.monat
   AND s.breitengrad IS NOT NULL
   [[AND s.konzept = {{marke}}]]
 GROUP BY coalesce(s.konzept, '(nicht zugeordnet)')
 ORDER BY count(*) DESC`,
    visualisierung: {
      'graph.dimensions': ['Marke'],
      'graph.metrics': [
        'Sofort eskalieren', 'Sofort handeln', 'Nachforschung',
        'Beobachten/OK', 'Keine Bewertung', 'Nicht operativ',
      ],
      'stackable.stack_type': 'stack',
      'graph.y_axis.title_text': 'Standorte',
      'graph.x_axis.title_text': '',
    },
  },

  {
    // Dieselbe Karte, klein und mitwandernd.
    //
    // Sie steht oben auf den Seiten, auf denen man ARBEITET -- Round Table,
    // Filialen, Betrieb -- und nicht auf einer eigenen. Der Zweck ist die
    // raeumliche Einordnung im Vorbeigehen: wer die Marke einschraenkt,
    // sieht deren Betriebe; wer einen Betrieb waehlt, sieht diesen einen.
    //
    // Deshalb kennt sie alle drei Filter. Der Betriebsfilter ist der
    // Grund, warum das nicht dieselbe Karte wie `so_karte` sein kann: dort
    // gibt es ihn nicht, und ein Filter, den nur eine von mehreren Karten
    // liest, faellt in der Filterpruefung als "taub" durch.
    schluessel: 'so_karte_klein',
    name: 'Wo liegt das',
    beschreibung:
      'Dieselben Standorte wie auf der Standortkarte, nur kompakt. Folgt den Filtern '
      + 'der Seite: ohne Auswahl alle Betriebe, mit Marke deren Betriebe, mit Betrieb dieser eine.\n\n'
      + '🟥 eskalieren · 🔴 handeln · 🟠 nachforschen · 🟢 ok · ⚪ keine Bewertung · '
      + '⚫ nicht operativ. Nur Standorte mit hinterlegter Adresse.',
    anzeige: 'map',
    parameter: [MONAT, MARKE, BETRIEB, AMPEL, INTENSITAET],
    sql: `${MONAT_CTE}
SELECT ${INTENSITAET_EMOJI} || ' ' || s.betrieb AS "Standort",
       s.konzept                        AS "Marke",
       s.breitengrad::float             AS "Breitengrad",
       s.laengengrad::float             AS "Längengrad",${INTENSITAET_TEXT} AS "Handlungsbedarf",
       round(s.umsatz)                  AS "Umsatz",
       s.ort                            AS "Ort",
       s.betrieb                        AS "Betrieb"
  FROM mart.standort s
  CROSS JOIN gewaehlt g
  -- Liefert operativ fuer Punktfarbe und Filter; verlustfrei, weil
  -- mart.standort selbst auf round_table_monat aufbaut.
  JOIN mart.round_table_monat r
       ON r.betrieb_key = s.betrieb_key AND r.monat = s.monat
 WHERE s.monat = g.monat
   AND s.breitengrad IS NOT NULL
   -- KEIN pauschales "AND r.operativ": nicht operative Betriebe bleiben
   -- als schwarze Punkte stehen, und ein per Betriebsfilter GEWAEHLTES
   -- Betrieb muss sichtbar bleiben, auch wenn es geschlossen ist.
   [[AND s.konzept = {{marke}}]]
   [[AND s.betrieb = {{betrieb}}]]
   -- 'ohne' steht fuer NULL; das laesst sich nicht als Gleichheit
   -- schreiben, deshalb der Umweg ueber coalesce. Sobald nach Bewertung
   -- oder Handlungsbedarf GEFILTERT wird, fliegen nicht operative Betriebe
   -- heraus: wer "rot" oder "Sofort eskalieren" waehlt, sucht Arbeit,
   -- keine Karteileichen mit nachgetragener Ampel.
   [[AND coalesce(s.ampel, 'ohne') = {{ampel}} AND r.operativ]]
   [[AND s.intensitaet = {{intensitaet}} AND r.operativ]]
 ORDER BY${NACH_DRUCK},
          s.betrieb`,
    visualisierung: {
      ...AUSSCHNITT,
      'map.type': 'pin',
      'map.latitude_column': 'Breitengrad',
      'map.longitude_column': 'Längengrad',
      'map.pin_type': 'markers',
      'map.tooltip_column': 'Standort',
      column_settings: {
        '["name","Umsatz"]': {
          number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0,
        },
      },
    },
  },

  {
    schluessel: 'so_fehlend',
    name: 'Standorte ohne Koordinaten',
    beschreibung:
      'Laufende Betriebe, die auf der Karte fehlen, weil keine Adresse hinterlegt ist — '
      + 'die Karte zeigt also einen Ausschnitt, nicht das Ganze. Diese Liste ist die '
      + 'Arbeitsvorlage, um die Adressen nachzutragen; wie viele es sind, zeigt sie selbst.\n\n'
      + 'Geschlossene, verwaltende und Test-Gesellschaften stehen absichtlich nicht darin: '
      + 'eine Adresse für einen Betrieb nachzutragen, der nie wieder auf der Karte gebraucht '
      + 'wird, ist verlorene Arbeit.',
    anzeige: 'table',
    // Keine feste Anzahl mehr im Text: "96 von 141" stimmte am 27.07.2026
    // und drei Tage spaeter nicht mehr -- die Karte zeigt die Ist-Zahl.
    //
    // mart.standort_fehlend fuehrt selbst keinen Status, deshalb der Join
    // auf mart.betrieb_status (heutiger Zustand, Migration 0039).
    // 'operativ' heisst dort: Umsatz in den letzten 60 Tagen, kein
    // Test-/Verwaltungskonstrukt. Die Spalten "Als aktiv gefuehrt" und
    // "Macht Umsatz" der alten Fassung sind unter diesem Filter immer
    // 'ja' und deshalb gestrichen.
    sql: `
SELECT f.betrieb                                     AS "Betrieb",
       f.konzept                                     AS "Marke",
       -- Konstant 'operativ', solange der Filter unten steht -- die
       -- Spalte macht das Auswahlkriterium in der Karte selbst sichtbar,
       -- statt es nur in der Beschreibung zu behaupten.
       bs.status                                     AS "Status",
       bs.letzter_umsatztag                          AS "Letzter Umsatztag",
       round(f.umsatz_gesamt)                        AS "Umsatz gesamt"
  FROM mart.standort_fehlend f
  JOIN mart.betrieb_status bs ON bs.betrieb_key = f.betrieb_key
 WHERE bs.status = 'operativ'
 ORDER BY f.umsatz_gesamt DESC NULLS LAST, f.betrieb`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz gesamt"]': {
          number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0,
        },
      },
    },
  },
]
