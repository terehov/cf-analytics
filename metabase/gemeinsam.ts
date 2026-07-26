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
// juengste Monat, fuer den ueberhaupt ein Urteil vorliegt. Die eckigen
// Klammern sind Metabases optionaler Block — steht kein Wert an, faellt
// der ganze Abschnitt weg und coalesce bleibt mit einem Argument stehen,
// was gueltiges SQL ist.
// ---------------------------------------------------------------------
export const MONAT_CTE = `
WITH gewaehlt AS (
    SELECT coalesce([[ {{monat}}::date, ]]
                    (SELECT max(monat) FROM mart.round_table_monat
                      WHERE monat <= date_trunc('month', current_date)::date
                        AND gesamt IS NOT NULL),
                    date_trunc('month', current_date)::date) AS monat
)`

/** Dasselbe fuer Karten, deren Datenreihe nicht am Round Table haengt. */
export const MONAT_CTE_UMSATZ = `
WITH gewaehlt AS (
    SELECT coalesce([[ {{monat}}::date, ]]
                    (SELECT max(monat) FROM mart.umsatz_ytd),
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
 * noch keinen vollstaendigen — deshalb der juengste Monat, in dem
 * ueberhaupt ein Wechsel steht.
 */
export const MONAT_CTE_WECHSEL = `
WITH gewaehlt AS (
    SELECT coalesce([[ {{monat}}::date, ]]
                    (SELECT max(monat) FROM mart.round_table_trend
                      WHERE ampelwechsel IN ('verbessert','verschlechtert')),
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
 * Zwei Zeitraeume mit Vorgabe: A ist der laufende Monat bis heute, B
 * derselbe Ausschnitt des Vormonats. Damit zeigt das Dashboard beim
 * Oeffnen bereits einen sinnvollen Vergleich, statt leer zu bleiben.
 */
export const ZEITRAUM_CTE = `
WITH z AS (
    SELECT coalesce([[ {{von_a}}::date, ]] date_trunc('month', current_date)::date)      AS a_von,
           coalesce([[ {{bis_a}}::date, ]] current_date)                                  AS a_bis,
           coalesce([[ {{von_b}}::date, ]] (date_trunc('month', current_date) - interval '1 month')::date) AS b_von,
           coalesce([[ {{bis_b}}::date, ]] (current_date - interval '1 month')::date)     AS b_bis
)`
