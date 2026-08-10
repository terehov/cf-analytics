// =====================================================================
// Bausteine, die sich mehrere Karten teilen.
// =====================================================================

import type { Parameter } from './typen'

// ---------------------------------------------------------------------
// Der Monat.
//
// Ein Pflichtparameter ohne Vorgabe laesst jede Karte beim ersten Oeffnen
// mit "You'll need to pick a value" scheitern — und ein fest eingetragener
// Vorgabemonat veraltet ab dem naechsten Monatswechsel.
//
// Deshalb dieser Ausdruck: gesetzt gewinnt der Parameter, ungesetzt der
// juengste ABGESCHLOSSENE Monat mit Urteil. Die eckigen Klammern sind
// Metabases optionaler Block — steht kein Wert an, faellt der ganze
// Abschnitt weg und coalesce bleibt mit einem Argument stehen, was
// gueltiges SQL ist.
//
// `monat <` und nicht `<=`, und das ist der ganze Punkt: der Round Table
// fuehrt auch fuer den laufenden Monat Urteile (BWA-Nachtrag), am
// 03.08.2026 fiel der Rueckfall deshalb auf einen drei Tage alten August
// — alle Seiten oeffneten mit -92 % Umsatz und 58 roten Ampeln. Zwei
// Tage gegen einen vollen Vorjahresmonat sind kein Urteil. Wer den
// laufenden Monat sehen will, waehlt ihn ausdruecklich im Filter.
// ---------------------------------------------------------------------
export const MONAT_CTE = `
WITH gewaehlt AS (
    SELECT coalesce([[ {{monat}}::date, ]]
                    (SELECT max(monat) FROM mart.round_table_monat
                      WHERE monat < date_trunc('month', current_date)::date
                        AND gesamt IS NOT NULL),
                    date_trunc('month', current_date)::date) AS monat
)`

/** Dasselbe fuer Karten, deren Datenreihe nicht am Round Table haengt.
 *  Auch hier der juengste ABGESCHLOSSENE Monat — mart.umsatz_ytd hat schon
 *  am Monatsersten eine Zeile fuer den neuen Monat, und ein Zwei-Tage-Monat
 *  gegen den Vorjahres-Vollmonat liest sich als Einbruch. */
export const MONAT_CTE_UMSATZ = `
WITH gewaehlt AS (
    SELECT coalesce([[ {{monat}}::date, ]]
                    (SELECT max(monat) FROM mart.umsatz_ytd
                      WHERE monat < date_trunc('month', current_date)::date),
                    date_trunc('month', current_date)::date) AS monat
)`

/**
 * Fuer Karten, die direkt an der BWA haengen — EBIT, Deckungsbeitrag.
 *
 * Der Rueckfall MUSS hier ein anderer sein als beim Round Table, und das
 * ist kein Schoenheitsfehler. Der Round Table traegt den juengsten
 * GEBUCHTEN BWA-Monat in spaetere Berichtsmonate nach (bwa_monat), er hat
 * fuer Juli also ein Urteil, obwohl der Steuerberater den Juli noch nicht
 * gebucht hat. Eine EBIT-Karte kann das nicht: sie zeigt den Monat selbst.
 *
 * Wer hier den Round-Table-Rueckfall nimmt, landet auf Juli und bekommt
 * eine leere Karte — nachgemessen am 26.07.2026, wo EBIT im Juni endet.
 * Eine leere Karte neben gefuellten liest sich als "kein EBIT", nicht als
 * "noch nicht gebucht", und das ist der teurere der beiden Irrtuemer.
 */
export const MONAT_CTE_BWA = `
WITH gewaehlt AS (
    SELECT coalesce([[ {{monat}}::date, ]]
                    (SELECT max(monat) FROM mart.kennzahlen_aktuell
                      WHERE wert_absolut IS NOT NULL AND wert_absolut <> 0),
                    date_trunc('month', current_date)::date) AS monat
)`

/**
 * Fuer Karten, die einen Vormonatsvergleich brauchen (Ampelwechsel).
 * Im ersten Monat der Historie gibt es keinen Wechsel, im letzten oft
 * noch keinen vollstaendigen — deshalb der juengste ABGESCHLOSSENE Monat,
 * in dem ueberhaupt ein Wechsel steht. Ohne die Obergrenze fiel der
 * Rueckfall auf den laufenden Teilmonat und meldete 25 erfundene
 * "verschlechtert" aus zwei Tagen Umsatz.
 */
export const MONAT_CTE_WECHSEL = `
WITH gewaehlt AS (
    SELECT coalesce([[ {{monat}}::date, ]]
                    (SELECT max(monat) FROM mart.round_table_trend
                      WHERE monat < date_trunc('month', current_date)::date
                        AND ampelwechsel IN ('verbessert','verschlechtert')),
                    date_trunc('month', current_date)::date) AS monat
)`

export const P_MONAT: Parameter = {
  id: 'monat-param',
  name: 'monat',
  'display-name': 'Monat',
  type: 'date/month-year',
  required: false,
}

export const P_MARKE: Parameter = {
  id: 'marke-param',
  name: 'marke',
  'display-name': 'Marke',
  type: 'text',
  required: false,
}

/**
 * Filter auf die Gesamtampel. Traegt die technischen Werte 'rot' /
 * 'orange' / 'gruen' / 'ohne', nicht die Beschriftung -- die Kacheln der
 * Round-Table-Uebersicht uebergeben sie beim Klick, damit "9 rote
 * Betriebe" zur Liste eben dieser neun fuehrt.
 */
export const P_AMPEL: Parameter = {
  id: 'ampel-param',
  name: 'ampel',
  'display-name': 'Bewertung',
  type: 'text',
  required: false,
}

/**
 * Der Bereich einer Einzelampel: Umsatz, Personal, WE Bar, WE Kueche,
 * Online-Bewertung, OM vor Ort.
 *
 * Zusammen mit P_AMPEL beschreibt er genau EIN Segment eines gestapelten
 * Balkens. "Personal / rot" ist eine Aussage ueber 19 Betriebe, und wer
 * den Balken anklickt, will diese 19 sehen -- nicht dasselbe Diagramm
 * noch einmal in gross.
 */
export const P_BEREICH: Parameter = {
  id: 'bereich-param',
  name: 'bereich',
  'display-name': 'Bereich',
  type: 'text',
  required: false,
}

/**
 * Der Handlungsbedarf: "Sofort eskalieren", "Sofort handeln",
 * "Nachforschung", "Beobachten/OK". Anders als die Gesamtampel zaehlt er
 * die roten Bereiche, statt sie nur zu odern -- deshalb trennt er die 43
 * roten Betriebe in 19 zum Eskalieren und 24 zum Handeln.
 */
export const P_INTENSITAET: Parameter = {
  id: 'intensitaet-param',
  name: 'intensitaet',
  'display-name': 'Handlungsbedarf',
  type: 'text',
  required: false,
}

export const P_BETRIEB: Parameter = {
  id: 'betrieb-param',
  name: 'betrieb',
  'display-name': 'Betrieb',
  type: 'text',
  required: false,
}

export const P_ZEITRAUM: Parameter = {
  id: 'zeitraum-param',
  name: 'zeitraum',
  'display-name': 'Zeitraum',
  type: 'date/range',
  required: false,
}

/**
 * Eine einzelne Inventur, angesteuert ueber ihren Schluessel.
 *
 * Bewusst der SCHLUESSEL und nicht Betrieb+Datum: an einem Tag zaehlen Bar
 * und Kueche getrennt (zwei Kostenstellen, zwei Inventuren), und beide
 * traegen denselben Betrieb und dasselbe Datum. Ein Klick muesste sonst
 * raten, welche der beiden gemeint war.
 *
 * `type: 'text'` trotz Zahlenwert — wie alle Parameter hier: Metabase
 * reicht Klickwerte als Zeichenkette durch, die Karte castet selbst.
 */
export const P_INVENTUR: Parameter = {
  id: 'inventur-param',
  name: 'inventur',
  'display-name': 'Inventur',
  type: 'text',
  required: false,
}

// Zwei Zeitraeume fuer den Vergleich. Bewusst Textparameter mit
// Datumsangabe statt Feldfilter: ein Feldfilter kann nur EINEN Zeitraum
// einschraenken, hier brauchen beide Seiten ihren eigenen.
export const P_VON_A: Parameter = {
  id: 'von-a-param', name: 'von_a', 'display-name': 'Zeitraum A von', type: 'date/single', required: false,
}
export const P_BIS_A: Parameter = {
  id: 'bis-a-param', name: 'bis_a', 'display-name': 'Zeitraum A bis', type: 'date/single', required: false,
}
export const P_VON_B: Parameter = {
  id: 'von-b-param', name: 'von_b', 'display-name': 'Zeitraum B von', type: 'date/single', required: false,
}
export const P_BIS_B: Parameter = {
  id: 'bis-b-param', name: 'bis_b', 'display-name': 'Zeitraum B bis', type: 'date/single', required: false,
}

/**
 * Zwei Zeitraeume mit Vorgabe: A sind die letzten sieben abgeschlossenen
 * Tage, B ist DASSELBE Fenster vier Wochen frueher.
 *
 * Bis zum 03.08.2026 stand hier "laufender Monat gegen denselben
 * Ausschnitt des Vormonats". Am Monatsdritten hiess das: Sa/So/Mo gegen
 * Mi/Do/Fr — bei einem Samstag/Montag-Verhaeltnis von 2,5:1 im
 * Tagesumsatz war der Wochentagsmix der dominante Treiber des Deltas,
 * nicht das Geschaeft. Dazu fehlte der letzte Tag von A noch komplett
 * (LINA fuellt 5–6 Tage nach).
 *
 * 28 Tage zurueck heisst: Montag gegen Montag, Samstag gegen Samstag.
 * a_bis = gestern, weil der heutige Geschaeftstag noch laeuft. Die
 * juengsten Tage sind trotzdem systematisch etwas zu niedrig — das sagt
 * die Textkachel auf ④ dazu.
 */
export const ZEITRAUM_CTE = `
WITH z AS (
    SELECT coalesce([[ {{von_a}}::date, ]] (current_date - 7))                            AS a_von,
           coalesce([[ {{bis_a}}::date, ]] (current_date - 1))                            AS a_bis,
           coalesce([[ {{von_b}}::date, ]] (current_date - 35))                           AS b_von,
           coalesce([[ {{bis_b}}::date, ]] (current_date - 29))                           AS b_bis
)`

/**
 * Deutsche Wochentagsnamen, unabhaengig von der Server-Locale.
 *
 * to_char(..., 'TMDay') haengt an lc_time, und die stand auf Englisch —
 * "Monday" mitten in deutschen Dashboards. Verwendung:
 *   ${WOCHENTAGE}[extract(isodow FROM geschaeftstag)::int]
 * isodow ist 1 = Montag ... 7 = Sonntag, passend zur Reihenfolge hier.
 */
export const WOCHENTAGE =
  `(ARRAY['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'])`
