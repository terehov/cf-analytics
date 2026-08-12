// =====================================================================
// Online-Bewertungen — die Gaeste-Sicht
//
// Die sechste Kennzahl des Round Table und die einzige, die nicht aus
// unseren eigenen Systemen kommt. Seit dem 03.08.2026 laedt sie
// src/yext.ts aus der Yext-API; vorher wurde sie von Hand abgetippt.
//
// ZWEI ZAHLEN, DIE MAN NICHT VERWECHSELN DARF, und die auf diesen Karten
// deshalb ueberall zusammen stehen:
//
//   STAND   Der Schnitt ueber ALLE Bewertungen bis zum Monatsende. Das
//           ist die Zahl, die ein Gast auf Google sieht, und die, an der
//           die Ampel haengt (gruen ab 4,40, orange ab 4,00).
//   MONAT   Der Schnitt der Bewertungen, die IN diesem Monat kamen.
//           Bewegt sich viel staerker -- Enchilada Hamm hatte im Juli
//           2026 neun Stueck. Als Ampel waere das Rauschen mit Farbe, als
//           Fruehwarnung ist es das Interessantere: der Stand von 3.700
//           Bewertungen faellt nicht, wenn ein Betrieb kippt. Der Monatswert
//           schon.
//
// WOHER DIE AMPEL KOMMT. Nicht aus einer Schwelle in diesen Karten,
// sondern aus mart.round_table_monat.ampel_bewertung -- also aus
// ampel.regelwerk. Wer 4,40 hier noch einmal hinschriebe, haette beim
// naechsten Schwellenwechsel zwei Wahrheiten und keinen Hinweis darauf,
// welche gilt.
//
// PORTAL. Gerechnet wird auf GOOGLEMYBUSINESS. Facebook fuehrt
// Bewertungen ohne Sternewertung ("empfohlen / nicht empfohlen"), ein
// Schnitt ueber alle Portale mischt damit zwei Skalen
// (docs/entscheidungen.md). Die Karte "Portale nebeneinander" zeigt, was
// die Wahl ausmacht -- gespeichert ist beides.
//
// OPERATIV. Seit dem Review vom 03.08.2026 (Migration 0039) standen
// geschlossene und verwaltende Betriebe in Fruehwarnung und Rangliste --
// "GESCHLOSSEN Enchilada Dresden" als Handlungsempfehlung. Kacheln,
// Ranglisten und Marken-Schnitte filtern deshalb auf operative Betriebe:
// wo mart.round_table_monat schon am Tisch sitzt, ueber dessen
// monatsgenaues `operativ`, sonst ueber mart.betrieb_status.
// =====================================================================

import type { Karte, Parameter } from './typen'
import { MONAT_CTE, P_MONAT, P_BETRIEB, P_MARKE, P_ZEITRAUM } from './gemeinsam'

const MONAT = P_MONAT
const BETRIEB = P_BETRIEB
const MARKE = P_MARKE
const ZEITRAUM = P_ZEITRAUM

/** Das Portal, auf dem die Kennzahl rechnet. Eine Stelle, nicht sieben. */
const GOOGLE = `'GOOGLEMYBUSINESS'`

/**
 * Die Gruen-Schwelle aus dem Regelwerk, nicht als Zahl im Kartentext.
 *
 * Hier stand 4.40 hartkodiert -- beim naechsten Schwellenwechsel haette
 * die Ampel (aus ampel.regel) anders geurteilt als die Karte "Ampel
 * kippt", und niemand haette gewusst, welche Zahl gilt. Genau davor
 * warnt der Kommentar am Dateikopf; jetzt haelt er sich selbst daran.
 */
const SCHWELLE_GRUEN = `(SELECT ar.schwelle_gruen FROM ampel.regel ar
        WHERE ar.regelwerk_key = 'round_table_global' AND ar.bereich = 'bewertung')`

/**
 * Dieselbe Schwelle fuer die ZIELLINIE der Diagramme. Eine
 * Visualisierungs-Einstellung kann kein SQL lesen — der Wert steht
 * deshalb hier EINMAL als Zahl, mit der Pflicht, ampel.regel zu folgen,
 * statt zweimal anonym in goal_value-Zeilen.
 */
const GRUEN_ZIEL = 4.4
const GRUEN_ZIEL_TEXT = 'Grün ab 4,40'

/**
 * Lesbare Portalnamen. Yext liefert Publisher-Codes; "TRIPADVISORREVIEWS"
 * in einer Tabellenspalte liest sich wie ein Fehler und kostet Breite.
 * Nur die vier grossen bekommen einen Namen -- GOLOCAL und UBEREATS (371
 * bzw. 1 Zeile) bleiben Rohwert, ein Mapping fuer jede Exotenquelle
 * veraltet schneller als es nuetzt.
 */
const PORTAL_NAME = (spalte: string) => `CASE ${spalte}
         WHEN 'GOOGLEMYBUSINESS'   THEN 'Google'
         WHEN 'TRIPADVISORREVIEWS' THEN 'TripAdvisor'
         WHEN 'FACEBOOK'           THEN 'Facebook'
         WHEN 'OPENTABLE'          THEN 'OpenTable'
         ELSE ${spalte} END`

/**
 * Die Note als Filter — der Ersatz fuer zwei Karten.
 *
 * Bis zum 03.08.2026 standen "beste" und "schlechteste" als getrennte
 * Karten nebeneinander. Eugene hat das verworfen, und zu Recht: zwei
 * Listen aus demselben Topf, die sich nur in der Sortierrichtung
 * unterscheiden, sind eine Liste zu viel. Wer die schlechten sehen will,
 * stellt hier 1 oder 2 ein; wer sortieren will, klickt in Metabase auf
 * die Spaltenueberschrift.
 */
const P_NOTE: Parameter = {
  id: 'note-param',
  name: 'note',
  'display-name': 'Sterne',
  type: 'text',
  required: false,
  festeWerte: ['1', '2', '3', '4', '5'],
}

/**
 * Die Rueckmeldungen im Wortlaut — EINE Liste, neueste zuerst.
 *
 * WARUM NICHT ZWEI KARTEN. Bis zum 03.08.2026 standen "beste" und
 * "schlechteste" nebeneinander. Eugene: "macht keinen Sinn ... wenn man
 * sie anders sortiert, sind sie sowieso die gleichen." Stimmt — eine
 * Tabelle, die Metabase ohnehin auf Klick sortiert, braucht keine zweite
 * mit umgedrehtem ORDER BY. Was sie braucht, ist ein Filter fuer die
 * Note und eine sinnvolle Voreinstellung.
 *
 * DIE VOREINSTELLUNG IST "NEUESTE ZUERST", nicht "schlechteste zuerst".
 * Die Frage am Betriebsblatt ist nicht "was war je das Schlimmste",
 * sondern "was kam zuletzt rein" — eine Kritik von 2024 ist erledigt
 * oder chronisch, in beiden Faellen sagt der letzte Monat mehr.
 *
 * 24 MONATE FEST, kein Zeitraumfilter. Geschriebene Rueckmeldungen sind
 * selten: Enchilada Bremen bekam im Mai 2026 eine einzige Bewertung, und
 * die ohne Text. Der Dreimonatsfilter des Dashboards liess damit genau
 * eine Zeile uebrig — eine Karte, die aussieht, als fehlten die Daten,
 * obwohl zwoelf brauchbare Rueckmeldungen aus dem Oktober danebenliegen.
 */
const EINZEL_SQL = `
SELECT mart.bewertung_einzel.datum                    AS "Datum",
       repeat('★', mart.bewertung_einzel.rating::int)  AS "Sterne",
       mart.bewertung_einzel.autor                     AS "Gast",
       mart.bewertung_einzel.inhalt                    AS "Bewertung",
       ${PORTAL_NAME('mart.bewertung_einzel.publisher')}
                                                       AS "Portal",
       mart.bewertung_einzel.url                       AS "Quelle"
  FROM mart.bewertung_einzel
 WHERE mart.bewertung_einzel.publiziert_am >= now() - interval '24 months'
   [[AND mart.bewertung_einzel.betrieb = {{betrieb}}]]
   [[AND mart.bewertung_einzel.konzept = {{marke}}]]
   -- Als TEXT verglichen, nicht mit ::numeric-Cast auf den Parameter.
   -- Metabase reicht Filterwerte als Zeichenkette durch; ein Cast auf
   -- der Parameterseite scheitert bei allem, was keine Zahl ist -- und
   -- der Kartentest setzt genau so einen Wert ein.
   [[AND round(mart.bewertung_einzel.rating)::int::text = {{note}}]]
 ORDER BY mart.bewertung_einzel.publiziert_am DESC
 LIMIT 200`

/**
 * Damit man die Bewertungen LESEN kann, ohne waagerecht zu scrollen.
 *
 * Drei Dinge zusammen, einzeln reicht keines:
 *
 *   1. `text_wrapping` auf der Textspalte. Ohne das schneidet Metabase
 *      mitten im Satz ab, und ein halber Satz ist kein halbes Argument,
 *      sondern keins.
 *   2. Feste Spaltenbreiten. Der Umbruch allein half nichts, solange die
 *      Tabelle insgesamt breiter war als die Kachel -- dann bricht der
 *      Text zwar um, steht aber teilweise ausserhalb des Sichtbaren.
 *      Die Summe (990 px) bleibt unter der Breite einer Kachel ueber
 *      volle 24 Rastereinheiten.
 *   3. Weniger Spalten. "Note" stand doppelt neben "Sterne" und ist
 *      raus -- gefiltert wird ueber den Sterne-Filter im Dashboardkopf,
 *      nicht ueber eine Spalte.
 *
 * DAS PORTAL STEHT WIEDER DRIN, schmal, neben der Quelle. Es war am
 * 03.08.2026 als Breitenfresser gestrichen worden ("79 % ist eh Google")
 * -- aber Stand, Tendenz und Ampel rechnen NUR auf Google, waehrend
 * diese Liste alle Portale mischt (im 24-Monats-Fenster ist jede sechste
 * Zeile OpenTable oder TripAdvisor). Ohne die Spalte haelt man eine
 * OpenTable-Kritik fuer eine, die den Google-Stand bewegt. Die Breite
 * kommt aus der Bewertungsspalte (535 -> 500): der Text verliert eine
 * Handbreit, die Zeile gewinnt ihre Herkunft.
 *
 * Der Link statt der nackten URL gehoert dazu: eine Google-Adresse ist
 * 90 Zeichen lang und draengt die Spalte weg, in der der Text steht.
 */
const EINZEL_ANZEIGE = {
  // Datum 135, weil "February 7, 2026" bei 110 abbricht -- ein
  // abgeschnittenes Datum ist beim Sortieren nach Zeit das eine
  // Feld, das man lesen koennen muss. Summe 1.045 px, bleibt unter der
  // Breite einer Kachel ueber volle 24 Rastereinheiten (1.048 px).
  'table.column_widths': [135, 90, 150, 500, 90, 80],
  column_settings: {
    '["name","Bewertung"]': { text_wrapping: true },
    '["name","Quelle"]': { view_as: 'link', link_text: 'Original' },
  },
}

export const karten: Karte[] = [
  // -------------------------------------------------------------------
  // Kacheln
  // -------------------------------------------------------------------
  {
    schluessel: 'bw_kachel_schnitt',
    name: 'Ø Bewertung',
    beschreibung:
      'Durchschnittlicher Bewertungsstand über die gewählten Betriebe im gewählten Monat, '
      + 'gewichtet mit der Zahl der Bewertungen — also der Schnitt, den ein Gast über alle '
      + 'Bewertungen der Gruppe sähe, nicht der Mittelwert der Betriebs-Schnitte.',
    anzeige: 'scalar',
    parameter: [MONAT, MARKE, BETRIEB],
    // Nur operative Betriebe (heutiger Status): geschlossene Betriebe
    // sammeln weiter Bewertungen, aber ihr Schnitt ist keine Aussage
    // ueber die Flotte, die heute am Tisch besprochen wird.
    //
    // GEWICHTET mit anzahl_stand: ungewichtet zog ein kleiner Betrieb
    // mit 40 Bewertungen den Schnitt so stark wie einer mit 4.000 —
    // die Nachbarkachel gewichtet ausdruecklich, und zwei Kacheln mit
    // zwei Rechenwegen lasen sich als Widerspruch.
    sql: `${MONAT_CTE}
SELECT coalesce(to_char(round(sum(v.schnitt_stand * v.anzahl_stand)
                              / nullif(sum(v.anzahl_stand), 0), 2), 'FM0.00'), '– keine Daten')
         AS "Ø Bewertung"
  FROM mart.bewertung_verlauf v
  CROSS JOIN gewaehlt g
  JOIN mart.betrieb_status bs
    ON bs.betrieb_key = v.betrieb_key AND bs.status = 'operativ'
 WHERE v.monat = g.monat
   AND v.publisher = ${GOOGLE}
   AND v.schnitt_stand IS NOT NULL
   [[AND v.konzept = {{marke}}]]
   [[AND v.betrieb = {{betrieb}}]]`,
  },
  {
    schluessel: 'bw_kachel_neue',
    name: 'Neue Bewertungen im Monat',
    beschreibung:
      'Wie viele Bewertungen im gewählten Monat dazugekommen sind. Sagt, wie belastbar der '
      + 'Monatswert daneben ist — bei drei Bewertungen ist ein Ausreißer eine halbe Note.',
    anzeige: 'scalar',
    parameter: [MONAT, MARKE, BETRIEB],
    sql: `${MONAT_CTE}
SELECT coalesce(sum(v.anzahl_monat), 0) AS "Neue Bewertungen"
  FROM mart.bewertung_verlauf v
  CROSS JOIN gewaehlt g
  JOIN mart.betrieb_status bs
    ON bs.betrieb_key = v.betrieb_key AND bs.status = 'operativ'
 WHERE v.monat = g.monat
   AND v.publisher = ${GOOGLE}
   [[AND v.konzept = {{marke}}]]
   [[AND v.betrieb = {{betrieb}}]]`,
  },
  {
    schluessel: 'bw_kachel_monatswert',
    name: 'Ø der neuen Bewertungen',
    beschreibung:
      'Wie die Bewertungen ausfielen, die **in diesem Monat** kamen — nicht der Stand. '
      + 'Liegt dieser Wert dauerhaft unter dem Stand, sinkt der Stand irgendwann nach.',
    anzeige: 'scalar',
    parameter: [MONAT, MARKE, BETRIEB],
    // Gewichtet mit der Anzahl, nicht als Mittel der Mittel: ein Betrieb
    // mit einer einzigen Bewertung waehlte sonst genauso schwer wie einer
    // mit vierzig.
    sql: `${MONAT_CTE}
SELECT coalesce(to_char(
         round(sum(v.schnitt_monat * v.anzahl_monat) / nullif(sum(v.anzahl_monat), 0), 2),
         'FM0.00'), '– keine neuen')
         AS "Ø der neuen Bewertungen"
  FROM mart.bewertung_verlauf v
  CROSS JOIN gewaehlt g
  JOIN mart.betrieb_status bs
    ON bs.betrieb_key = v.betrieb_key AND bs.status = 'operativ'
 WHERE v.monat = g.monat
   AND v.publisher = ${GOOGLE}
   AND v.schnitt_monat IS NOT NULL
   [[AND v.konzept = {{marke}}]]
   [[AND v.betrieb = {{betrieb}}]]`,
  },

  // -------------------------------------------------------------------
  // Rangliste — der Einstieg
  // -------------------------------------------------------------------
  {
    schluessel: 'bw_rangliste',
    name: 'Bewertungen je Betrieb',
    beschreibung:
      'Alle Betriebe nach Bewertungsstand, schlechteste zuerst. Die Ampel stammt aus dem '
      + 'Regelwerk (grün ab 4,40, orange ab 4,00), nicht aus dieser Karte. '
      + 'Ein Klick auf den Namen öffnet den Betrieb.',
    anzeige: 'table',
    parameter: [MONAT, MARKE, BETRIEB],
    // Die Ampel kommt aus mart.round_table_monat und damit aus
    // ampel.regelwerk. Die Bewegungsspalten kommen aus dem Verlauf --
    // beide Seiten sind ueber (betrieb_key, monat) dieselbe Zeile.
    //
    // r.operativ (monatsgenau, Migration 0039) statt LEFT-JOIN-Toleranz:
    // "GESCHLOSSEN Enchilada Dresden" stand hier als schlechtester
    // Betrieb der Gruppe. Ein Betrieb, der im gewaehlten Monat Umsatz hatte
    // und heute zu ist, bleibt in seiner Historie drin -- die damalige
    // Flotte soll die damalige bleiben.
    sql: `${MONAT_CTE}
SELECT v.betrieb                                  AS "Betrieb",
       v.konzept                                  AS "Marke",
       v.stadt                                    AS "Stadt",
       coalesce(ab.emoji, '⚪')                    AS "●",
       v.schnitt_stand                            AS "Stand",
       v.anzahl_stand                             AS "Bewertungen",
       v.anzahl_monat                             AS "Neu im Monat",
       v.schnitt_monat                            AS "Ø neu",
       CASE WHEN v.schnitt_monat IS NULL THEN NULL
            ELSE round(v.schnitt_monat - v.schnitt_stand, 2) END
                                                  AS "Abstand zum Stand"
  FROM mart.bewertung_verlauf v
  CROSS JOIN gewaehlt g
  LEFT JOIN mart.round_table_monat r
         ON r.betrieb_key = v.betrieb_key AND r.monat = v.monat
  LEFT JOIN ampel.beschriftung ab ON ab.status = r.ampel_bewertung
 WHERE v.monat = g.monat
   AND v.publisher = ${GOOGLE}
   AND v.schnitt_stand IS NOT NULL
   AND r.operativ
   [[AND v.konzept = {{marke}}]]
   [[AND v.betrieb = {{betrieb}}]]
 ORDER BY v.schnitt_stand, v.betrieb`,
  },

  // -------------------------------------------------------------------
  // Fruehwarnung
  //
  // Die einzige Karte, die etwas zeigt, das der Round Table NICHT zeigen
  // kann. Bei 3.700 Bewertungen bewegt ein schlechter Monat den Stand um
  // Hundertstel -- die Ampel bleibt gruen, waehrend der Betrieb kippt.
  // Deshalb der Abstand zwischen Monatswert und Stand.
  // -------------------------------------------------------------------
  {
    schluessel: 'bw_bewegung',
    name: 'Wo die neuen Bewertungen schlechter sind als der Stand',
    beschreibung:
      'Betriebe, deren Bewertungen **in diesem Monat** deutlich unter ihrem eigenen Stand liegen. '
      + 'Das ist die Frühwarnung, die die Ampel nicht geben kann: bei mehreren tausend '
      + 'Bewertungen bewegt ein schlechter Monat den Stand nur um Hundertstel — die Ampel '
      + 'bleibt grün, während sich vor Ort etwas ändert.\n\n'
      + 'Mindestens drei neue Bewertungen, sonst ist es Zufall.',
    anzeige: 'table',
    parameter: [MONAT, MARKE],
    sql: `${MONAT_CTE}
SELECT v.betrieb                                  AS "Betrieb",
       v.konzept                                  AS "Marke",
       coalesce(ab.emoji, '⚪')                    AS "● heute",
       v.schnitt_stand                            AS "Stand",
       v.schnitt_monat                            AS "Ø neu",
       round(v.schnitt_monat - v.schnitt_stand, 2) AS "Abstand",
       v.anzahl_monat                             AS "Neu im Monat"
  FROM mart.bewertung_verlauf v
  CROSS JOIN gewaehlt g
  LEFT JOIN mart.round_table_monat r
         ON r.betrieb_key = v.betrieb_key AND r.monat = v.monat
  LEFT JOIN ampel.beschriftung ab ON ab.status = r.ampel_bewertung
 WHERE v.monat = g.monat
   AND v.publisher = ${GOOGLE}
   AND v.schnitt_monat IS NOT NULL
   -- Unter drei Stimmen ist der Monatswert kein Signal. Bei einer
   -- einzigen Bewertung steht hier sonst jeder Betrieb, bei dem ein Gast
   -- einen schlechten Abend hatte.
   AND v.anzahl_monat >= 3
   AND v.schnitt_monat < v.schnitt_stand
   -- Nur operative Betriebe (monatsgenau): eine Fruehwarnung fuer einen
   -- geschlossenen Betrieb ist keine -- dort kippt nichts mehr.
   AND r.operativ
   [[AND v.konzept = {{marke}}]]
 ORDER BY v.schnitt_monat - v.schnitt_stand
 LIMIT 25`,
  },

  {
    schluessel: 'bw_anteil_schlecht',
    name: 'Wo sich schlechte Bewertungen häufen',
    beschreibung:
      'Je Betrieb: der Anteil der **1–2★-Bewertungen** in den letzten 90 Tagen, verglichen '
      + 'mit dem eigenen Anteil in den zwölf Monaten davor. Sortiert nach dem Anstieg.\n\n'
      + 'Das schärfere Frühwarnsignal neben dem Mittelwert: ein Ø von 4,0 kann „viele '
      + 'zufriedene Gäste" heißen oder „jeder vierte vergibt einen Stern" — erst der Anteil '
      + 'unterscheidet das. Mindestens zehn Bewertungen im 90-Tage-Fenster, nur Google, '
      + 'nur operative Betriebe.',
    anzeige: 'table',
    parameter: [MARKE],
    /**
     * WARUM 90 TAGE ROLLIEREND UND KEIN MONATSFILTER. Ein Kalendermonat
     * hat fuer viele Betriebe zu wenige Bewertungen (Enchilada Hamm: neun
     * im Juli 2026) -- die Quote eines Monats waere Wuerfeln. 90 Tage
     * heben auch kleine Betriebe ueber die Zehnerschwelle, und eine
     * Fruehwarnung fragt ohnehin "was passiert GERADE", nicht "was war
     * im gewaehlten Berichtsmonat".
     *
     * WARUM ANTEIL UND NICHT MITTELWERT. bw_bewegung vergleicht
     * Mittelwerte -- dort verschwindet eine Welle schlechter Bewertungen,
     * wenn gleichzeitig genug Fuenfer kommen. Der 1-2-Sterne-Anteil
     * zaehlt jede einzelne: Aposto Bamberg stand am 03.08.2026 bei 40 %
     * (davor 9 %) und war im Mittelwert unauffaelliger als hier.
     *
     * Das Vergleichsfenster sind die zwoelf Monate VOR dem 90-Tage-
     * Fenster -- der eigene Normalzustand, nicht der Gruppenschnitt: ein
     * Betrieb mit chronisch 20 % soll nicht jede Woche als "neu kippend"
     * gemeldet werden, eines, das von 5 auf 15 springt, sehr wohl.
     */
    sql: `
WITH fenster AS (
    SELECT b.betrieb_key,
           count(*) FILTER (WHERE b.publiziert_am >= now() - interval '90 days')                     AS n_90,
           count(*) FILTER (WHERE b.publiziert_am >= now() - interval '90 days' AND b.rating <= 2)   AS schlecht_90,
           count(*) FILTER (WHERE b.publiziert_am <  now() - interval '90 days')                     AS n_davor,
           count(*) FILTER (WHERE b.publiziert_am <  now() - interval '90 days' AND b.rating <= 2)   AS schlecht_davor
      FROM core.bewertung b
     WHERE b.publisher = ${GOOGLE}
       AND b.rating IS NOT NULL
       AND b.publiziert_am >= now() - interval '90 days' - interval '12 months'
     GROUP BY b.betrieb_key
)
SELECT bs.betrieb                                                    AS "Betrieb",
       bs.konzept                                                    AS "Marke",
       round(100.0 * f.schlecht_90 / f.n_90, 1)                      AS "1–2★ % (90 Tage)",
       round(100.0 * f.schlecht_davor / nullif(f.n_davor, 0), 1)     AS "1–2★ % (12 Monate davor)",
       round(100.0 * f.schlecht_90 / f.n_90
             - 100.0 * f.schlecht_davor / nullif(f.n_davor, 0), 1)   AS "Δ Punkte",
       f.n_90                                                        AS "n (90 Tage)"
  FROM fenster f
  JOIN mart.betrieb_status bs
    ON bs.betrieb_key = f.betrieb_key AND bs.status = 'operativ'
 WHERE f.n_90 >= 10
   [[AND bs.konzept = {{marke}}]]
 ORDER BY round(100.0 * f.schlecht_90 / f.n_90
                - 100.0 * f.schlecht_davor / nullif(f.n_davor, 0), 1) DESC NULLS LAST`,
  },

  // -------------------------------------------------------------------
  // Verlauf — steht auch auf ③ Betrieb
  // -------------------------------------------------------------------
  {
    schluessel: 'bw_verlauf',
    name: 'Bewertung im Verlauf',
    beschreibung:
      'Werden die Bewertungen besser oder schlechter?\n\n'
      + 'Der **Stand** ist der Schnitt über alle Bewertungen — er bewegt sich träge, weil '
      + 'tausende Stimmen darin stecken, und daran hängt die Ampel. Die **Tendenz** ist der '
      + 'gleitende Schnitt der neuen Bewertungen über sechs Monate: sie läuft dem Stand '
      + 'voraus. Fällt sie unter den Stand, sinkt der Stand irgendwann nach.\n\n'
      + 'Die **Balken** sagen, wie viele neue Bewertungen hinter jedem Monat stehen — '
      + 'drei Bewertungen bewegen die Tendenz so sichtbar wie dreihundert, erst die '
      + 'Balkenhöhe sagt, was davon Signal ist.',
    anzeige: 'combo',
    parameter: [BETRIEB, MARKE],
    /**
     * WARUM GLEITEND UND NICHT DER ROHE MONATSWERT.
     *
     * Der Monatswert beantwortet die Frage "werden sie besser oder
     * schlechter" nicht, er verstellt sie: Enchilada Hamm hatte im Juli
     * 2026 neun Bewertungen, Enchilada Bremen im Mai genau eine. Eine
     * Kurve aus solchen Punkten springt zwischen 1 und 5 und zeigt jede
     * Laune einzelner Gaeste als Trendwende.
     *
     * Sechs Monate, gewichtet mit der Anzahl -- nicht Mittel der Mittel,
     * sonst zaehlt ein Monat mit einer Bewertung so schwer wie einer mit
     * vierzig. Das ist lang genug, dass auch ein kleiner Betrieb auf eine
     * belastbare Zahl kommt, und kurz genug, dass eine echte
     * Verschlechterung binnen eines halben Jahres sichtbar wird.
     *
     * Der rohe Monatswert bleibt in mart.bewertung_verlauf und in der
     * Fruehwarnungs-Karte -- dort ist er richtig, weil er dort gegen den
     * Stand gestellt und auf mindestens drei Stimmen begrenzt wird.
     *
     * DIE ANZAHL STEHT SEIT DEM 03.08.2026 ALS BALKEN DARUNTER. Eine
     * Tendenzkurve ohne die Zahl dahinter ist nicht einschaetzbar --
     * ob ein Knick drei Gaeste sind oder dreihundert, entscheidet, ob
     * man ihn ernst nimmt. Zweite Y-Achse, weil Stueckzahlen (hunderte)
     * und Sterne (3 bis 5) sonst dieselbe Skala teilen muessten und die
     * Kurven zu Strichen am oberen Rand wuerden.
     */
    sql: `
WITH je_monat AS (
    SELECT monat,
           sum(anzahl_monat) FILTER (WHERE schnitt_monat IS NOT NULL) AS n,
           sum(schnitt_monat * anzahl_monat)                          AS summe,
           sum(anzahl_monat)                                          AS neue,
           avg(schnitt_stand)                                         AS stand
      FROM mart.bewertung_verlauf
     WHERE publisher = ${GOOGLE}
       AND schnitt_stand IS NOT NULL
       [[AND betrieb = {{betrieb}}]]
       [[AND konzept = {{marke}}]]
     GROUP BY monat
)
SELECT monat                       AS "Monat",
       round(stand, 2)             AS "Stand",
       round(sum(summe) OVER w / nullif(sum(n) OVER w, 0), 2)
                                   AS "Tendenz (6 Monate)",
       coalesce(neue, 0)           AS "Neue im Monat"
  FROM je_monat
WINDOW w AS (ORDER BY monat ROWS BETWEEN 5 PRECEDING AND CURRENT ROW)
 ORDER BY monat`,
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Stand', 'Tendenz (6 Monate)', 'Neue im Monat'],
      // Die Skala NICHT bei null beginnen: zwischen 3,8 und 4,6
      // entscheidet sich alles, und auf einer Achse von 0 bis 5 ist das
      // ein waagerechter Strich. Gilt fuer die LINKE Achse (Sterne);
      // die rechte (Stueckzahlen) skaliert Metabase selbst ab null.
      'graph.y_axis.auto_range': false,
      'graph.y_axis.min': 3,
      'graph.y_axis.max': 5,
      'graph.show_goal': true,
      'graph.goal_value': GRUEN_ZIEL,
      'graph.goal_label': GRUEN_ZIEL_TEXT,
      series_settings: {
        Stand: { display: 'line' },
        'Tendenz (6 Monate)': { display: 'line' },
        // Grau und gedeckt: die Balken sind Kontext, nicht Kennzahl --
        // die Farbe soll bei den Kurven bleiben.
        'Neue im Monat': { display: 'bar', axis: 'right', color: '#C7CFD4' },
      },
    },
  },

  {
    schluessel: 'bw_marke',
    name: 'Bewertung je Marke',
    beschreibung:
      'Durchschnittlicher Stand je Marke im gewählten Monat, mit der Zahl der Betriebe, '
      + 'die dahintersteht. Ein Klick führt auf die Betriebe der Marke.',
    anzeige: 'bar',
    parameter: [MONAT],
    // Nur operative Betriebe: vor dem 03.08.2026 zogen geschlossene
    // Betriebe den Markenschnitt -- eine Marke sah schlecht aus wegen
    // Bewertungen an Standorten, die es nicht mehr gibt.
    sql: `${MONAT_CTE}
SELECT coalesce(v.konzept, '(ohne Marke)') AS "Marke",
       round(avg(v.schnitt_stand), 2)      AS "Ø Stand",
       count(*)                            AS "Betriebe"
  FROM mart.bewertung_verlauf v
  CROSS JOIN gewaehlt g
  JOIN mart.betrieb_status bs
    ON bs.betrieb_key = v.betrieb_key AND bs.status = 'operativ'
 WHERE v.monat = g.monat
   AND v.publisher = ${GOOGLE}
   AND v.schnitt_stand IS NOT NULL
 GROUP BY 1
 ORDER BY 2 DESC`,
    visualisierung: {
      'graph.dimensions': ['Marke'],
      'graph.metrics': ['Ø Stand'],
      'graph.y_axis.auto_range': false,
      'graph.y_axis.min': 3,
      'graph.y_axis.max': 5,
      'graph.show_goal': true,
      'graph.goal_value': GRUEN_ZIEL,
      'graph.goal_label': GRUEN_ZIEL_TEXT,
    },
  },

  // -------------------------------------------------------------------
  // Portale — die Entscheidung sichtbar machen
  // -------------------------------------------------------------------
  {
    schluessel: 'bw_portale',
    name: 'Google gegen alle Portale',
    beschreibung:
      'Was die Portalwahl ausmacht. Die Kennzahl rechnet auf **Google**, weil Facebook '
      + 'Bewertungen ohne Sternewertung führt („empfohlen / nicht empfohlen") und ein '
      + 'Schnitt über alle Portale zwei Skalen mischt.\n\n'
      + 'Gespeichert ist beides — diese Karte zeigt, wo die Wahl über die Ampel entscheidet. '
      + 'Die Grün-Schwelle kommt aus dem Regelwerk, nicht aus dieser Karte.',
    anzeige: 'table',
    parameter: [MONAT, MARKE],
    // Die Schwelle stand hier zweimal als 4.40 im SQL -- exakt die "zwei
    // Wahrheiten", vor denen der Dateikopf warnt. Jetzt liest die Karte
    // dieselbe Zeile aus ampel.regel wie die Ampelrechnung selbst.
    sql: `${MONAT_CTE}
SELECT v.betrieb                                        AS "Betrieb",
       v.konzept                                        AS "Marke",
       max(v.schnitt_stand) FILTER (WHERE v.publisher = ${GOOGLE})  AS "Google",
       max(v.anzahl_stand)  FILTER (WHERE v.publisher = ${GOOGLE})  AS "Google Anzahl",
       max(v.schnitt_stand) FILTER (WHERE v.publisher = 'ALLE')     AS "Alle Portale",
       max(v.anzahl_stand)  FILTER (WHERE v.publisher = 'ALLE')     AS "Alle Anzahl",
       round(max(v.schnitt_stand) FILTER (WHERE v.publisher = 'ALLE')
             - max(v.schnitt_stand) FILTER (WHERE v.publisher = ${GOOGLE}), 2)
                                                        AS "Unterschied",
       -- Die eigentliche Frage: kippt die Ampel, wenn man das Portal
       -- wechselt? Alles andere ist eine Nachkommastelle.
       CASE WHEN (max(v.schnitt_stand) FILTER (WHERE v.publisher = ${GOOGLE})
                    >= ${SCHWELLE_GRUEN})
               <> (max(v.schnitt_stand) FILTER (WHERE v.publisher = 'ALLE')
                    >= ${SCHWELLE_GRUEN})
            THEN 'ja' ELSE '' END                       AS "Ampel kippt"
  FROM mart.bewertung_verlauf v
  CROSS JOIN gewaehlt g
  -- Nur operative: die Frage "kippt die Ampel bei Portalwechsel" stellt
  -- sich nur fuer Betriebe, die eine Ampel haben. Vorher standen 10 von
  -- 60 Zeilen fuer geschlossene und Testbetriebe.
  JOIN mart.betrieb_status bs
    ON bs.betrieb_key = v.betrieb_key AND bs.status = 'operativ'
 WHERE v.monat = g.monat
   AND v.schnitt_stand IS NOT NULL
   [[AND v.konzept = {{marke}}]]
 GROUP BY v.betrieb, v.konzept
 HAVING max(v.schnitt_stand) FILTER (WHERE v.publisher = ${GOOGLE}) IS NOT NULL
 ORDER BY abs(coalesce(max(v.schnitt_stand) FILTER (WHERE v.publisher = 'ALLE')
                       - max(v.schnitt_stand) FILTER (WHERE v.publisher = ${GOOGLE}), 0)) DESC`,
  },

  {
    schluessel: 'bw_portalvergleich',
    name: 'Je Portal (12 Monate)',
    beschreibung:
      'Alle Bewertungen der letzten zwölf Monate, je Portal: wie viele, und wie streng '
      + 'bewertet wird. TripAdvisor liegt rund **0,9 Sterne unter Google** — derselbe '
      + 'Betrieb, andere Gäste, andere Note. Facebook führt gar keine Sterne '
      + '(„empfohlen / nicht empfohlen").\n\n'
      + 'Deshalb rechnet die Kennzahl auf **einem** Portal statt über alle: ein Schnitt '
      + 'über Portale vergliche Maßstäbe, nicht Betriebe.',
    anzeige: 'table',
    parameter: [MARKE],
    // Zwoelf Monate rollierend statt Monatsfilter: die Aussage dieser
    // Karte ist der MASSSTAB der Portale, und der aendert sich nicht mit
    // dem Berichtsmonat -- ein Monatsfenster machte die kleinen Portale
    // (TripAdvisor: ~26 Zeilen je Monat) nur zufaellig.
    //
    // "Ohne Sterne" steht als eigene Spalte, weil es das Argument IST:
    // Facebooks Zeilen haben alle keine Wertung -- ein Portal, dessen
    // Schnitt leer bleibt, mischt man nicht in eine Sterne-Kennzahl.
    sql: `
SELECT ${PORTAL_NAME('b.publisher')}       AS "Portal",
       count(*)                            AS "Bewertungen",
       count(*) - count(b.rating)          AS "ohne Sterne",
       round(avg(b.rating), 2)             AS "Ø Sterne"
  FROM core.bewertung b
  JOIN mart.betrieb_status bs ON bs.betrieb_key = b.betrieb_key
 WHERE b.publiziert_am >= now() - interval '12 months'
   [[AND bs.konzept = {{marke}}]]
 GROUP BY b.publisher
 ORDER BY count(*) DESC`,
  },

  // -------------------------------------------------------------------
  // Technik
  // -------------------------------------------------------------------
  {
    schluessel: 'bw_ladestand',
    name: 'Bewertungen — Ladestand',
    // Hier stand "fehlt der Betrieb hier, fehlt ihm die Zuordnung" --
    // aber diese Karte ist ein Aggregat je Portal, ein einzelner Betrieb
    // KANN hier gar nicht fehlen. Wer nach der grauen Ampel suchte,
    // suchte auf der falschen Karte. Die Betriebsfrage beantwortet
    // bw_fehlend; hier steht nur noch, was sie beantworten kann.
    beschreibung:
      'Was der Yext-Importer zuletzt geholt hat, **je Portal aufsummiert** — wie viele '
      + 'Betriebe liefern, wie weit die Historie reicht, wann zuletzt geladen wurde.\n\n'
      + 'Ob ein **einzelner** Betrieb fehlt, kann diese Karte nicht zeigen. Dafür steht '
      + 'daneben „Betriebe ohne Bewertungsdaten" — dort fehlt die Zuordnung in '
      + 'manual.betrieb_fremd_id.',
    anzeige: 'table',
    parameter: [],
    sql: `
SELECT quelle              AS "Quelle",
       publisher           AS "Portal",
       betriebe            AS "Betriebe",
       von                 AS "Ab Monat",
       bis                 AS "Bis Monat",
       bewertungen_aktuell AS "Bewertungen",
       schnitt_aktuell     AS "Ø Stand",
       zuletzt_geladen     AS "Zuletzt geladen"
  FROM mart.bewertung_ladestand
 ORDER BY publisher`,
  },

  // -------------------------------------------------------------------
  // Was Gaeste geschrieben haben — auf ③ Betrieb
  //
  // Die Karte, wegen derer core.bewertung ueberhaupt existiert. Eine
  // Zahl sagt, DASS ein Betrieb abrutscht; erst der Text sagt, woran es
  // liegt (migrations/0037_bewertung_einzeln.sql).
  //
  // Die Spalte "Gast" traegt den Namen, unter dem die Bewertung
  // oeffentlich beim Portal steht (Migration 0038). Sie ist nicht Zierde:
  // wer auf eine Kritik antworten will, muss wissen an wen -- und
  // dieselbe Person, die dreimal im Monat einen Stern vergibt, ist etwas
  // anderes als drei enttaeuschte Gaeste.
  // -------------------------------------------------------------------
  {
    // Wer hier steht, hat eine GRAUE Bewertungsampel — und bisher stand
    // das nirgends. Acht operative Betriebe ohne Yext-Zuordnung, darunter
    // eines mit 1,5 Mio. EUR Umsatz seit Juni. Die Liste ist eine
    // Arbeitsvorlage: Zuordnung in manual.betrieb_fremd_id nachtragen,
    // dann laedt der naechste Lauf die Bewertungen von selbst.
    schluessel: 'bw_fehlend',
    name: 'Betriebe ohne Bewertungsdaten',
    beschreibung:
      'Operative Betriebe, für die keine Yext-Zuordnung hinterlegt ist — ihre Bewertungsampel bleibt grau, egal wie die Gäste urteilen. Die mit Umsatz stehen oben: dort lohnt das Nachtragen zuerst. Erwartung: diese Liste wird leer.',
    anzeige: 'table',
    sql: `
SELECT betrieb                    AS "Betrieb",
       konzept                    AS "Marke",
       round(umsatz_60_tage)      AS "Umsatz (60 Tage)",
       letzter_umsatztag          AS "Letzter Umsatztag"
  FROM mart.bewertung_fehlend`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz (60 Tage)"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
      },
    },
  },
  {
    schluessel: 'bw_einzel',
    name: 'Rückmeldungen im Wortlaut',
    beschreibung:
      'Alle Bewertungen **mit Text** aus den letzten 24 Monaten, **neueste zuerst**. '
      + 'Über **Sterne** oben lässt sich auf eine Note eingrenzen — 1 und 2 sind die '
      + 'Liste, mit der man arbeitet. Jede Spaltenüberschrift sortiert.\n\n'
      + 'Reine Sternewertungen ohne Wort sind ausgelassen; sie beantworten die Frage '
      + '„was schreiben die Gäste" nicht. **Quelle** führt zum Original beim Portal.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE, P_NOTE],
    sql: EINZEL_SQL,
    visualisierung: EINZEL_ANZEIGE,
  },

  // -------------------------------------------------------------------
  // Der Kritiken-Drill-Down (dd_kritiken) hinter der Kachel "Offene
  // 1-2-Sterne-Kritiken".
  //
  // WAS ER ZEIGEN KANN UND WAS NICHT: Yext liefert je Betrieb und Monat
  // nur die ZAEHLER (offen, offen_schlecht) — welche einzelne Bewertung
  // beantwortet ist, steht in keiner geladenen Tabelle. Die Seite zeigt
  // deshalb ehrlich zwei Stufen: je Betrieb die Zaehler (deren Summe
  // exakt die Kachel ist), und darunter ALLE 1-2-Sterne-Texte des
  // Monats als Arbeitsmaterial — beantwortete einschliesslich.
  // -------------------------------------------------------------------
  {
    schluessel: 'kr_betriebe',
    name: 'Offene Kritiken je Betrieb',
    beschreibung:
      'Die Kachel, aufgeteilt auf Betriebe: 1–2-Sterne-Bewertungen des Monats ohne Antwort, daneben alles Offene und das Antwortverhalten. Die Summe der ersten Spalte ist exakt die Kachelzahl. Ein Klick auf den Namen öffnet das Betriebsblatt.',
    anzeige: 'table',
    parameter: [MONAT, MARKE, BETRIEB],
    sql: `${MONAT_CTE}
SELECT a.betrieb              AS "Betrieb",
       a.konzept              AS "Marke",
       a.offen_schlecht       AS "Offen 1–2★",
       a.offen                AS "Offen gesamt",
       a.bewertungen          AS "Bewertungen im Monat",
       a.quote_prozent        AS "Antwortquote %",
       a.reaktion_tage        AS "Reaktion (Tage)"
  FROM mart.bewertung_antwort a
  CROSS JOIN gewaehlt g
 WHERE a.monat = g.monat AND a.operativ
   AND (a.offen_schlecht > 0 OR a.offen > 0)
   [[AND a.konzept = {{marke}}]]
   [[AND a.betrieb = {{betrieb}}]]
 ORDER BY a.offen_schlecht DESC NULLS LAST, a.offen DESC NULLS LAST`,
    visualisierung: {
      column_settings: {
        '["name","Antwortquote %"]': { suffix: ' %' },
      },
    },
  },

  {
    schluessel: 'kr_wortlaut',
    name: '1–2 Sterne im Wortlaut',
    beschreibung:
      'Alle 1–2-Sterne-Bewertungen des gewählten Monats mit Text — auch die schon beantworteten: welche einzelne offen ist, führt Yext nur als Zähler (Tabelle oben). **Quelle** führt zum Original beim Portal, dort steht auch die Antwort. Ein Klick auf den Betrieb öffnet das Betriebsblatt.',
    anzeige: 'table',
    parameter: [MONAT, MARKE, BETRIEB],
    sql: `${MONAT_CTE}
SELECT e.datum                          AS "Datum",
       e.betrieb                        AS "Betrieb",
       repeat('★', e.rating::int)       AS "Sterne",
       e.autor                          AS "Gast",
       e.inhalt                         AS "Bewertung",
       ${PORTAL_NAME('e.publisher')}    AS "Portal",
       e.url                            AS "Quelle"
  FROM mart.bewertung_einzel e
  CROSS JOIN gewaehlt g
 WHERE e.monat = g.monat
   AND e.rating <= 2
   [[AND e.konzept = {{marke}}]]
   [[AND e.betrieb = {{betrieb}}]]
 ORDER BY e.publiziert_am DESC
 LIMIT 300`,
    // Dieselbe Lese-Einrichtung wie bw_einzel: Umbruch und feste Breiten,
    // damit der Text lesbar ist statt abgeschnitten. Eine Spalte mehr
    // (Betrieb), deshalb eigene Breiten. Summe 1.020 px < 1.048.
    visualisierung: {
      'table.column_widths': [110, 150, 90, 130, 370, 90, 80],
      column_settings: {
        '["name","Bewertung"]': { text_wrapping: true },
        '["name","Quelle"]': { view_as: 'link', link_text: 'Original' },
      },
    },
  },
]
