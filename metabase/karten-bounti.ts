// =====================================================================
// Bounti — Schulung und Audits.
//
// Datengrundlage: Migration 0096 (die Tabellen) und 0097 (die
// Auswertungssichten). Die Leitsicht ist mart.bounti_betrieb_stand.
//
// ---------------------------------------------------------------------
// FUENF REGELN, DIE HIER JEDE KARTE BEFOLGT
//
//   1. STAND HEUTE, KEIN STICHMONAT. Keine Karte dieser Datei liest
//      {{monat}}. "Ueberfaellig" ist eine Aussage ueber heute; in den
//      Monat der Zuweisung zurueckgerechnet stuende eine taeglich
//      steigende Zahl unter einem abgeschlossenen Monat. Der Verlauf
//      (bo_verlauf) zeigt den Monat der ZUWEISUNG und ist die einzige
//      Karte mit einer Zeitachse. Alle Ausnahmen stehen begruendet in
//      FILTER_AUSNAHME in uebernehmen.ts.
//
//   2. NUR OPERATIVE BETRIEBE. 13 der 62 zugeordneten Betriebe sind
//      geschlossen, verwaltend oder ohne Umsatz; an ihnen haengen 6330
//      Zuweisungen. Sie in den Rueckstand zu zaehlen ist derselbe Fehler,
//      den Migration 0039 fuer die Ampeln behoben hat.
//
//   3. NIE EINE QUOTE OHNE DIE DATENBASIS DANEBEN. Ein Betrieb mit einer
//      aktiven Person und 30 Zuweisungen kommt auf 0 % — richtig
//      gerechnet und trotzdem keine Aussage. Gemessen am 24.08.2026:
//      Aposto Schweinfurt, ein Kopf, 17 ueberfaellige Zuweisungen.
//
//   4. "OFFEN OHNE FRIST" IST KEIN RUECKSTAND. Es kann nie ueberfaellig
//      werden. Wer es unter "offen" mitzaehlt, haelt einen Betrieb fuer
//      saeumig, der nichts versaeumt hat — deshalb hat der Zustand vier
//      Werte und nicht zwei, und deshalb gibt es eine eigene Kachel.
//
//      ZWEI ZAHLEN, DIE MAN NICHT VERWECHSELN DARF, UND BEIM ERSTEN WURF
//      STAND HIER DIE FALSCHE: 29513 der 74683 Zuweisungen tragen
//      ueberhaupt kein Faelligkeitsdatum (39,5 %) — davon sind 21505
//      laengst abgeschlossen. Der Zustand "ohne Frist" meint die andere
//      Zahl: OFFEN und ohne Frist, in operativen Betrieben 5832 von
//      57984 (10,1 %). Eine Beschreibung, die "rund 40 %" neben eine
//      Kachel mit 5832 schreibt, ist falsch, auch wenn beide Zahlen fuer
//      sich stimmen.
//
//   5. DIE ABDECKUNG GEHOERT AUF JEDE SEITE, DIE BOUNTI-ZAHLEN ZEIGT.
//      26 der 88 Standorte haben keinen Betrieb; an ihnen haengen 592 der
//      2346 aktiven Personen und ALLE 133 Auditberichte. Jede Zahl hier
//      laesst sie aus. bo_kachel_ausserhalb sagt das auf der
//      Uebersicht, bo_abdeckung in Zahlen — und keine der beiden ist
//      Beiwerk.
//
// ---------------------------------------------------------------------
// WAS HIER BEWUSST FEHLT
//
//   * KEINE AMPEL. Weder die Erfuellungsquote noch die Auditnote wird zu
//     einem siebten Round-Table-Signal oder ersetzt die seit Juli 2026
//     leere Vor-Ort-Note. Das entscheidet der Fachbereich
//     (docs/offene-punkte.md), nicht eine Kartendefinition. Eine Ampel,
//     deren Bedeutung sich still aendert, ist schlimmer als eine graue.
//
//   * KEINE FLUKTUATION. Eintritt und Austritt stehen in LINA, nicht in
//     Bounti. Das Archivierungskennzeichen ist kein Austrittsdatum.
//     Siehe Migration 0096, Abschnitt 2.
//
//   * KEINE AUDITNOTE JE BETRIEB, DIE SO TUT, ALS GAEBE ES SIE.
//     bo_audit_betrieb ist am 24.08.2026 LEER, und das ist die Wahrheit:
//     alle 133 Berichte haengen an drei Standorten ohne Betrieb. Die
//     Karte bleibt trotzdem stehen und sagt es in ihrer Beschreibung —
//     eine weggelassene Karte sieht aus wie eine Frage, die niemand
//     gestellt hat.
// =====================================================================

import type { Karte } from './typen'
import { P_BETRIEB, P_MARKE } from './gemeinsam'

const BETRIEB = P_BETRIEB
const MARKE = P_MARKE

/**
 * Der Filterbaustein. Alle Auswertungssichten aus 0097 fuehren die
 * Spalten `betrieb` und `konzept` unter denselben Namen — der Baustein
 * steht deshalb einmal hier und nicht zwanzigmal einzeln.
 */
const FILTER = `
   [[AND betrieb = {{betrieb}}]]
   [[AND konzept = {{marke}}]]`

/**
 * Der Leerzustand — und warum er sein muss.
 *
 * Ohne ihn zeigt jede Zaehlkachel eine ehrliche, richtig gerechnete NULL,
 * solange Bounti nichts geliefert hat. "0 ueberfaellige Schulungen" liest
 * sich aber als "alles erledigt" und nicht als "wir wissen nichts" — und
 * das ist der teurere der beiden Irrtuemer.
 *
 * Genau der Fall trat am 24.08.2026 ein: Migration 0097 stand in
 * Produktion, BOUNTI_API_TOKEN war dort noch nicht gesetzt, und die
 * Round-Table-Uebersicht meldete null Rueckstand fuer 141 Betriebe.
 *
 * Dieselbe Bauart wie rt_kachel_massnahmen und rt_kachel_bewertung: die 0
 * gibt es erst wieder, wenn die QUELLE etwas geliefert hat und nur nichts
 * offen ist. Gelesen wird gegen mart und nicht gegen core — Metabase soll
 * nur mart sehen muessen (docs/metabase.md).
 */
const OHNE_DATEN = `(SELECT gesamt FROM mart.bounti_abdeckung
                      WHERE kennzahl = 'Standorte in Bounti') = 0`
const LEER = "'– Bounti liefert noch nichts'"

export const karten: Karte[] = [

  // ===================================================================
  // Die Kacheln — Stand heute
  // ===================================================================
  {
    schluessel: 'bo_kachel_ueberfaellig',
    name: 'Überfällige Schulungen',
    beschreibung:
      'Zuweisungen mit abgelaufener Frist, die niemand abgeschlossen hat — Stand heute, über die '
      + 'operativen Betriebe mit Bounti-Standort. Der Monatsfilter wirkt bewusst nicht: „überfällig" '
      + 'ist eine Aussage über heute und nicht über Juni. Zuweisungen OHNE Frist zählen nicht mit; '
      + 'sie stehen in der eigenen Kachel daneben.',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT CASE WHEN ${OHNE_DATEN} THEN ${LEER}
            ELSE coalesce(sum(ueberfaellig), 0)::text END AS "Überfällige Schulungen"
  FROM mart.bounti_betrieb_stand
 WHERE in_bounti AND operativ${FILTER}`,
  },

  {
    schluessel: 'bo_kachel_betroffene',
    name: 'Personen mit Rückstand',
    beschreibung:
      'Wie viele Menschen hinter der Zahl daneben stehen — von wie vielen insgesamt. Die wichtigere '
      + 'der beiden Zahlen: 1109 überfällige Zuweisungen können 53 Personen mit je 21 offenen '
      + 'Punkten sein oder drei Personen, die nie angefangen haben. Archivierte Konten zählen nicht mit.',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT CASE WHEN ${OHNE_DATEN} THEN ${LEER}
            ELSE coalesce(sum(koepfe_ueberfaellig), 0) || ' von ' || coalesce(sum(koepfe_aktiv), 0)
       END AS "Personen mit Rückstand"
  FROM mart.bounti_betrieb_stand
 WHERE in_bounti AND operativ${FILTER}`,
  },

  {
    schluessel: 'bo_kachel_erfuellung',
    name: 'Erfüllungsquote',
    beschreibung:
      'Anteil der abgeschlossenen an allen Zuweisungen, über die operativen Betriebe. Gewichtet '
      + 'über die Zuweisungen und nicht als Mittel der Betriebsquoten — sonst zählte ein Betrieb '
      + 'mit 30 Zuweisungen so schwer wie einer mit 2121.',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT CASE WHEN ${OHNE_DATEN} THEN ${LEER}
            ELSE coalesce(
         to_char(round(100.0 * sum(abgeschlossen) / nullif(sum(zuweisungen), 0), 1), 'FM990.0') || ' %',
         '– keine Zuweisung') END AS "Erfüllungsquote"
  FROM mart.bounti_betrieb_stand
 WHERE in_bounti AND operativ${FILTER}`,
  },

  {
    schluessel: 'bo_kachel_ohne_frist',
    name: 'Offen, ohne Frist',
    beschreibung:
      'Zuweisungen, die OFFEN sind und für die in Bounti kein Fälligkeitsdatum gesetzt ist. Sie '
      + 'können nie überfällig werden und sind deshalb aus jeder Rückstandszahl heraus. Je größer '
      + 'die Zahl, desto weniger misst die Erfüllungsquote: ohne Frist ist „noch nicht gemacht" '
      + 'von „zu spät" nicht zu unterscheiden.\n\n'
      + '**Nicht dasselbe wie „trägt kein Fälligkeitsdatum".** Davon gibt es konzernweit 29.513 '
      + 'von 74.683 Zuweisungen (39,5 %) — aber 21.505 davon sind längst abgeschlossen. Diese '
      + 'Kachel zählt nur die offenen: in operativen Betrieben 5.832 von 57.984 (24.08.2026).',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT CASE WHEN ${OHNE_DATEN} THEN ${LEER}
            ELSE coalesce(sum(ohne_frist), 0)::text END AS "Offen, ohne Frist"
  FROM mart.bounti_betrieb_stand
 WHERE in_bounti AND operativ${FILTER}`,
  },

  {
    schluessel: 'bo_kachel_koepfe',
    name: 'Personen in Bounti',
    beschreibung:
      'Aktive, nicht archivierte Konten an Standorten, die einem operativen Betrieb zugeordnet '
      + 'sind. Nicht die Mitarbeiterzahl des Betriebs — das ist eine LINA-Zahl. Wer an zwei '
      + 'Standorten geführt wird, zählt in beiden Betrieben.',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT CASE WHEN ${OHNE_DATEN} THEN ${LEER}
            ELSE coalesce(sum(koepfe_aktiv), 0)::text END AS "Personen in Bounti"
  FROM mart.bounti_betrieb_stand
 WHERE in_bounti AND operativ${FILTER}`,
  },

  {
    schluessel: 'bo_kachel_ergebnis',
    name: 'Ø Prüfungsergebnis',
    beschreibung:
      'Durchschnittlich erreichte Punktzahl der Abschlusstests, über alle Zuweisungen mit '
      + 'Ergebnis. Bounti liefert diesen Wert als Bruch (0,8 = 80 %); er wird beim Laden zur '
      + 'Prozentzahl gerechnet. Sagt etwas über die Qualität des Abschlusses, nicht über die Menge '
      + 'der Abschlüsse — dafür ist die Erfüllungsquote da.',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT CASE WHEN ${OHNE_DATEN} THEN ${LEER}
            ELSE coalesce(to_char(round(avg(ergebnis_pct), 1), 'FM990.0') || ' %', '– kein Ergebnis')
       END AS "Ø Prüfungsergebnis"
  FROM mart.bounti_schulung_person
 WHERE betrieb_key IS NOT NULL AND operativ AND ergebnis_pct IS NOT NULL${FILTER}`,
  },

  {
    schluessel: 'bo_kachel_audit',
    name: 'Auditberichte mit Betrieb',
    beschreibung:
      'Wie viele der geladenen Auditberichte überhaupt bei einem Betrieb ankommen. Am 24.08.2026: '
      + 'NULL von 133. Alle Berichte hängen an drei Standorten, die keinem Betrieb zugeordnet sind '
      + '(Wirtshaus am Münzplatz, Wirtshaus im Park Mönchengladbach, Würzburger Augustiner). '
      + 'Die Kachel steht hier, damit die leere Auditauswertung nicht als „es wird nicht auditiert" '
      + 'gelesen wird — es wird auditiert, nur außerhalb der Zuordnung.',
    anzeige: 'scalar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT CASE WHEN ${OHNE_DATEN} THEN ${LEER}
            ELSE coalesce(sum(auditberichte), 0) || ' von '
              || (SELECT count(*) FROM mart.bounti_auditbericht_liste)
       END AS "Auditberichte mit Betrieb"
  FROM mart.bounti_betrieb_stand
 WHERE in_bounti AND operativ${FILTER}`,
  },

  {
    schluessel: 'bo_kachel_ausserhalb',
    name: 'Personen ohne Betrieb',
    beschreibung:
      'Aktive Bounti-Konten an Standorten, die keinem Betrieb zugeordnet sind — sie fallen aus '
      + 'JEDER Zahl dieser Seite heraus. Am 24.08.2026 waren das 592 von 2346, also jede vierte '
      + 'Person. Die Kachel liest weder Marke noch Betrieb, denn genau das ist ihr Gegenstand: '
      + 'diese Standorte HABEN keinen. Die Arbeitsliste dahinter steht unter „Abdeckung".',
    anzeige: 'scalar',
    // Bewusst ohne Parameter: ein Betriebs- oder Markenfilter hätte hier
    // nichts, worauf er greifen könnte.
    sql: `
SELECT CASE WHEN gesamt = 0 THEN ${LEER}
            ELSE (gesamt - zugeordnet) || ' von ' || gesamt
       END AS "Personen ohne Betrieb"
  FROM mart.bounti_abdeckung
 WHERE kennzahl = 'Aktive Personen'`,
  },

  // ===================================================================
  // Wer hängt hinterher — die Betriebsebene
  // ===================================================================
  {
    schluessel: 'bo_betriebe',
    name: 'Schulungsstand je Betrieb',
    beschreibung:
      'Die Rangliste, sortiert nach überfälligen Schulungen JE KOPF. Die Rohzahl führt sonst '
      + 'dauerhaft die großen Häuser an: Aalen hat 1109 überfällige Zuweisungen bei 53 Personen, '
      + 'Schwetzingen 389 bei 22 — das ist derselbe Rückstand.\n\n'
      + '**Datenbasis immer mitlesen.** „dünn" heißt weniger als fünf Personen oder weniger als '
      + '20 Zuweisungen; dort ist die Quote richtig gerechnet und trotzdem keine Aussage. '
      + 'Ein Klick auf den Betrieb öffnet dessen Schulungsblatt.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT betrieb                        AS "Betrieb",
       konzept                        AS "Marke",
       koepfe_aktiv                   AS "Personen",
       koepfe_ueberfaellig            AS "davon mit Rückstand",
       ueberfaellig                   AS "Überfällig",
       ueberfaellig_je_kopf           AS "Überfällig je Kopf",
       erfuellung_pct                 AS "Erfüllung %",
       ergebnis_schnitt_pct           AS "Ø Ergebnis %",
       laengste_ueberschreitung_tage  AS "längste Überschreitung (Tage)",
       ohne_frist                     AS "ohne Frist",
       datenbasis                     AS "Datenbasis"
  FROM mart.bounti_betrieb_stand
 WHERE in_bounti AND operativ${FILTER}
 ORDER BY ueberfaellig_je_kopf DESC NULLS LAST, ueberfaellig DESC`,
  },

  {
    schluessel: 'bo_marken',
    name: 'Erfüllung je Marke',
    beschreibung:
      'Die Frage vor jeder Maßnahme: hängt dieser eine Betrieb hinterher oder seine ganze Marke? '
      + 'Gewichtet über die Zuweisungen, nur operative Betriebe mit Bounti-Standort. '
      + 'Die Zahl der Betriebe steht daneben — eine Marke mit zwei Betrieben ist kein Mittelwert.',
    anzeige: 'bar',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT coalesce(konzept, '(ohne Marke)')                                    AS "Marke",
       round(100.0 * sum(abgeschlossen) / nullif(sum(zuweisungen), 0), 1)   AS "Erfüllung %",
       count(*)                                                             AS "Betriebe"
  FROM mart.bounti_betrieb_stand
 WHERE in_bounti AND operativ AND zuweisungen > 0${FILTER}
 GROUP BY coalesce(konzept, '(ohne Marke)')
 ORDER BY 2`,
    visualisierung: {
      'graph.dimensions': ['Marke'],
      'graph.metrics': ['Erfüllung %'],
    },
  },

  {
    schluessel: 'bo_verlauf',
    name: 'Zuweisungen und Abschlüsse im Verlauf',
    beschreibung:
      'Balken: wie viel in einem Monat ZUGEWIESEN wurde. Linie: wie viel davon inzwischen '
      + 'abgeschlossen ist.\n\n'
      + '**Der Monat ist der der Zuweisung, nicht der des Abschlusses.** Andersherum verschwände '
      + 'die nie erledigte Pflichtschulung aus der Statistik — also genau der Fall, um den es geht. '
      + 'Eine alte Zuweisung, die diesen Monat abgeschlossen wird, hebt deshalb den ALTEN Monat.\n\n'
      + 'Die jüngsten Monate sind systematisch niedriger: dort ist die Frist oft noch nicht um.',
    anzeige: 'combo',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT monat                                                                AS "Monat",
       sum(zugewiesen)::int                                                 AS "Zugewiesen",
       sum(abgeschlossen)::int                                              AS "Abgeschlossen",
       round(100.0 * sum(abgeschlossen) / nullif(sum(zugewiesen), 0), 1)    AS "Erfüllung %"
  FROM mart.bounti_schulung_verlauf
 WHERE betrieb_key IS NOT NULL
   AND operativ
   AND monat >= (date_trunc('month', current_date) - interval '23 months')::date${FILTER}
 GROUP BY monat
 ORDER BY monat`,
    visualisierung: {
      'graph.dimensions': ['Monat'],
      'graph.metrics': ['Zugewiesen', 'Abgeschlossen', 'Erfüllung %'],
      series_settings: {
        Zugewiesen: { display: 'bar', color: '#C7CFD4' },
        Abgeschlossen: { display: 'bar' },
        // Rechte Achse: Stückzahlen (tausende) und Prozent (0 bis 100)
        // teilen sich sonst eine Skala, und die Quote wird zum Strich.
        'Erfüllung %': { display: 'line', axis: 'right' },
      },
    },
  },

  // ===================================================================
  // Wer muss was nachholen — Person und Lerneinheit
  // ===================================================================
  {
    schluessel: 'bo_personen',
    name: 'Wer muss nachholen',
    beschreibung:
      'Die Arbeitsliste: Personen mit mindestens einer überfälligen Zuweisung, die meisten zuerst. '
      + 'Nur aktive Konten in operativen Betrieben — ein archiviertes Konto holt nichts mehr nach '
      + '(gemessen am 24.08.2026: genau ein überfälliger Fall hing an einem archivierten Konto).\n\n'
      + 'Namen stehen hier bewusst; Kontaktdaten nicht — sie sind in keiner Tabelle dieses Projekts. '
      + 'Höchstens 500 Zeilen; wer mehr braucht, grenzt oben auf einen Betrieb ein.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT person                          AS "Person",
       betrieb                         AS "Betrieb",
       konzept                         AS "Marke",
       rollen                          AS "Rolle",
       ueberfaellig                    AS "Überfällig",
       laengste_ueberschreitung_tage   AS "längste Überschreitung (Tage)",
       aelteste_frist::date            AS "älteste Frist",
       offen                           AS "Offen",
       ohne_frist                      AS "ohne Frist",
       abgeschlossen                   AS "Abgeschlossen",
       erfuellung_pct                  AS "Erfüllung %"
  FROM mart.bounti_person_stand
 WHERE betrieb_key IS NOT NULL AND operativ AND NOT archiviert AND ueberfaellig > 0${FILTER}
 ORDER BY ueberfaellig DESC, laengste_ueberschreitung_tage DESC NULLS LAST
 LIMIT 500`,
  },

  {
    schluessel: 'bo_lerneinheiten',
    name: 'Welche Schulung liegt brach',
    beschreibung:
      'Die andere Leserichtung: nicht welcher Betrieb hinterherhängt, sondern welche Schulung nicht '
      + 'gemacht wird. Eine Lerneinheit, die über ALLE Betriebe bei 25 % steht, ist kein '
      + 'Betriebsproblem — sie ist zu lang, zu unklar oder an die falschen Personen verteilt. '
      + 'Diese Frage lässt sich in der Betriebsrangliste nicht stellen.\n\n'
      + 'Ab fünf Zuweisungen; sortiert nach überfälligen Stück.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT lerneinheit                                                          AS "Lerneinheit",
       CASE art WHEN 'kurs' THEN 'Kurs' ELSE 'Lernpfad' END                 AS "Art",
       sum(zugewiesen)::int                                                 AS "Zugewiesen",
       sum(abgeschlossen)::int                                              AS "Abgeschlossen",
       sum(ueberfaellig)::int                                               AS "Überfällig",
       sum(ohne_frist)::int                                                 AS "ohne Frist",
       round(100.0 * sum(abgeschlossen) / nullif(sum(zugewiesen), 0), 1)    AS "Erfüllung %",
       round(avg(ergebnis_schnitt_pct), 1)                                  AS "Ø Ergebnis %",
       count(DISTINCT betrieb_key)::int                                     AS "Betriebe"
  FROM mart.bounti_lerneinheit_betrieb
 WHERE betrieb_key IS NOT NULL AND operativ${FILTER}
 GROUP BY lerneinheit, art
HAVING sum(zugewiesen) >= 5
 ORDER BY sum(ueberfaellig) DESC, 7 ASC NULLS LAST
 LIMIT 200`,
  },

  {
    schluessel: 'bo_rollen',
    name: 'Personen je Rolle',
    beschreibung:
      'Wie sich die Bounti-Konten auf die Rollen verteilen — die einzige Strukturaussage, die '
      + 'Bounti ohne LINA hergibt. Eine Person mit zwei Rollen zählt in beiden Balken; die Summe '
      + 'ist deshalb größer als die Kopfzahl. „— ohne Rolle" ist keine Rolle, sondern ihr Fehlen: '
      + 'diesen Konten lässt sich keine rollenbezogene Pflichtschulung zuweisen.',
    anzeige: 'row',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT rolle                       AS "Rolle",
       sum(koepfe_aktiv)::int      AS "Personen"
  FROM mart.bounti_rolle_betrieb
 WHERE betrieb_key IS NOT NULL AND operativ${FILTER}
 GROUP BY rolle
HAVING sum(koepfe_aktiv) > 0
 ORDER BY 2 DESC`,
    visualisierung: {
      'graph.dimensions': ['Rolle'],
      'graph.metrics': ['Personen'],
    },
  },

  // ===================================================================
  // Audits
  // ===================================================================
  {
    schluessel: 'bo_audit_betrieb',
    name: 'Auditnote je Betrieb',
    beschreibung:
      '⚠️ **Diese Tabelle ist am 24.08.2026 leer, und das ist kein Fehler.** Alle 133 geladenen '
      + 'Auditberichte hängen an genau drei Standorten, die keinem Betrieb zugeordnet sind. '
      + 'Sie füllt sich in dem Moment, in dem diese Zuordnung entschieden ist — bis dahin steht '
      + 'die Auditarbeit vollständig in der Liste darunter und in „Abdeckung".\n\n'
      + 'Gezählt wird nur über ABGESCHLOSSENE Berichte: ein angefangenes Audit hat null Punkte, '
      + 'und ein Mittelwert daraus ist keine schlechte Note, sondern eine falsche.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT betrieb                                                          AS "Betrieb",
       konzept                                                          AS "Marke",
       count(*)::int                                                    AS "Berichte",
       count(*) FILTER (WHERE zustand = 'abgeschlossen')::int           AS "abgeschlossen",
       round(avg(prozent) FILTER (WHERE zustand = 'abgeschlossen'), 1)  AS "Ø Erfüllung %",
       max(erstellt_am)::date                                           AS "letzter Bericht"
  FROM mart.bounti_auditbericht_liste
 WHERE betrieb_key IS NOT NULL${FILTER}
 GROUP BY betrieb, konzept
 ORDER BY 5 ASC NULLS LAST`,
  },

  {
    schluessel: 'bo_audit_liste',
    name: 'Auditberichte',
    beschreibung:
      'Jeder geladene Auditbericht, neueste zuerst — auch die ohne Betrieb, und genau darum geht '
      + 'es. Die Spalte „Betrieb" zeigt „— kein Betrieb zugeordnet", wo die Zuordnung fehlt; am '
      + '24.08.2026 traf das auf alle 133 Berichte zu.\n\n'
      + 'Die Prozentzahl ist Bountis eigene (achievedPercentage) und bereits eine Prozentzahl. '
      + 'Viele dieser Audits sind Tagesprotokolle mit 0 oder 100 — dort ist der Wert ein Haken '
      + 'und keine Note.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT erstellt_am::date                                AS "Datum",
       audit                                            AS "Audit",
       standort                                         AS "Standort",
       coalesce(betrieb, '— kein Betrieb zugeordnet')   AS "Betrieb",
       zustand                                          AS "Zustand",
       prozent                                          AS "Erfüllung %",
       punkte_erreicht                                  AS "Punkte",
       punkte_gesamt                                    AS "von",
       auditor                                          AS "Auditor"
  FROM mart.bounti_auditbericht_liste
 WHERE true${FILTER}
 ORDER BY erstellt_am DESC
 LIMIT 500`,
  },

  // ===================================================================
  // Abdeckung und Zuordnung — die Zahlen, ohne die der Rest nicht
  // gelesen werden darf
  // ===================================================================
  {
    schluessel: 'bo_abdeckung',
    name: 'Was von Bounti bei einem Betrieb ankommt',
    beschreibung:
      'Gesamt gegen zugeordnet, je Gegenstand. **Die Zeile, die alles einordnet:** wer eine '
      + 'Erfüllungsquote je Betrieb liest, ohne diese Tabelle gesehen zu haben, hält einen '
      + 'Ausschnitt für das Ganze.\n\n'
      + 'Am 24.08.2026: 62 von 88 Standorten, 1754 von 2346 aktiven Personen, 64314 von 74683 '
      + 'Zuweisungen — und 0 von 133 Auditberichten. Die Tabelle liest weder Marke noch Betrieb; '
      + 'ihr Gegenstand ist das, was KEINEN hat.',
    anzeige: 'table',
    sql: `
SELECT kennzahl                                          AS "Gegenstand",
       gesamt                                            AS "in Bounti",
       zugeordnet                                        AS "in einer Betriebsauswertung",
       gesamt - zugeordnet                               AS "fällt heraus",
       round(100.0 * zugeordnet / nullif(gesamt, 0), 1)  AS "Abdeckung %",
       sicht                                             AS "Sicht"
  FROM mart.bounti_abdeckung`,
  },

  {
    schluessel: 'bo_standorte_offen',
    name: 'Bounti-Standorte ohne Betrieb',
    beschreibung:
      'Die Arbeitsliste der Zuordnung — nach Gewicht sortiert, nicht nach Namen. Wer sie von oben '
      + 'abarbeitet, holt zuerst die Auswertung zurück, die am meisten fehlt.\n\n'
      + '**Drei Gruppen, die man auseinanderhalten muss** (Stand 24.08.2026, '
      + 'docs/offene-punkte.md): sieben Standorte gehören zum Fremdmandanten Gimme Gelato und '
      + 'sollen KEINEN Betrieb bekommen. Neun Wirtshäuser kennt weder LINA noch FoodNotify noch '
      + 'Yext — dort ist die Frage nicht „welcher Betrieb", sondern „wem gehören sie". Bei sechs '
      + 'steht eine Entscheidung aus, dieselbe, die auch bei Yext offen ist. '
      + 'Vier Zeilen sind keine Betriebe (Test, Verwaltung).\n\n'
      + 'Die Liste ist also bei sechzehn von 26 Zeilen kein Fehler, sondern eine Feststellung.',
    anzeige: 'table',
    sql: `
SELECT standort              AS "Bounti-Standort",
       koepfe_aktiv          AS "aktive Personen",
       zuweisungen           AS "Zuweisungen",
       auditberichte         AS "Auditberichte",
       letztes_audit_am      AS "letztes Audit",
       zuerst_gesehen_am     AS "erstmals gesehen"
  FROM mart.bounti_standort_offen
 ORDER BY koepfe_aktiv DESC, auditberichte DESC, standort`,
  },

  {
    schluessel: 'bo_ohne_bounti',
    name: 'Operative Betriebe ohne Bounti-Standort',
    beschreibung:
      'Die Gegenrichtung: Betriebe, die Umsatz machen und in Bounti nicht vorkommen. Für sie ist '
      + 'jede Zahl dieser Seite leer — und eine leere Zahl liest sich als „nichts offen", nicht '
      + 'als „nicht angebunden". Genau deshalb steht die Liste hier.\n\n'
      + 'Am 24.08.2026 acht Betriebe; sechs davon haben auch bei Yext keine Zuordnung. Es ist '
      + 'dieselbe Population, und sie fällt aus JEDER externen Auswertung heraus.',
    anzeige: 'table',
    parameter: [BETRIEB, MARKE],
    sql: `
SELECT betrieb      AS "Betrieb",
       konzept      AS "Marke",
       stadt        AS "Stadt",
       status       AS "Status"
  FROM mart.bounti_betrieb_stand
 WHERE NOT in_bounti AND operativ${FILTER}
 ORDER BY konzept, betrieb`,
  },

  {
    schluessel: 'bo_mehrfach',
    name: 'Personen an mehreren Standorten',
    beschreibung:
      '**Keine Fehlerliste, sondern die Erklärung für eine Abweichung.** Jede über Personen '
      + 'aggregierte Betriebszahl zählt diese Menschen mehrfach — die Summe über alle Betriebe ist '
      + 'deshalb größer als die Kopfzahl des Unternehmens. Wer beide Zahlen nebeneinander sieht '
      + 'und die Differenz nicht erklären kann, sucht hier.',
    anzeige: 'table',
    sql: `
SELECT btrim(coalesce(vorname, '') || ' ' || coalesce(nachname, ''))  AS "Person",
       standorte                                                     AS "Standorte",
       standortnamen                                                 AS "wo"
  FROM mart.bounti_mehrfachzuordnung
 ORDER BY standorte DESC, 1`,
  },

  // ===================================================================
  // Läuft die Anbindung? — gehört auf die Datenqualitätsseite
  // ===================================================================
  {
    schluessel: 'bo_zuweisungsstand',
    name: 'Zuweisungsabgleich — Rückstand',
    beschreibung:
      'Eine Zeile je Kurs und Lernpfad. **Die Zahl, die fallen muss, ist „nie".**\n\n'
      + 'Zuweisungen lassen sich nicht inkrementell holen — der Endpunkt kennt weder `after` noch '
      + '`updatedAt`. Der Nachtlauf arbeitet deshalb je Nacht eine feste Zahl Lerneinheiten ab, '
      + 'die am längsten nicht geholten zuerst. Bleibt „nie" stehen, läuft der Nachlauf nicht mehr '
      + '— und ein eingefrorener Fortschritt sieht aus wie ein gepflegter.\n\n'
      + '„veraltet" heißt länger als 14 Tage nicht nachgezogen; bei 470 Lerneinheiten ist das der '
      + 'Normalzustand des Rotationsverfahrens und kein Befund.',
    anzeige: 'table',
    sql: `
SELECT name                                                    AS "Lerneinheit",
       CASE art WHEN 'kurs' THEN 'Kurs' ELSE 'Lernpfad' END    AS "Art",
       zustand                                                 AS "Zustand",
       zuweisungen                                             AS "Zuweisungen",
       zuweisungen_geholt_am::date                             AS "zuletzt geholt",
       tage_her                                                AS "Tage her"
  FROM mart.bounti_zuweisung_stand
 ORDER BY CASE zustand WHEN 'nie' THEN 0 WHEN 'veraltet' THEN 1 ELSE 2 END,
          tage_her DESC NULLS FIRST
 LIMIT 200`,
  },

  {
    schluessel: 'bo_gegenprobe',
    name: 'Bountis Fortschritt gegen unsere Rechnung',
    beschreibung:
      'Zwei Wege zur selben Zahl. Sie müssen nicht gleich sein: Bounti zählt je Person und Kurs '
      + 'nur die LETZTE Zuweisung, wir zählen alle. Deshalb die großzügige Schwelle — eine '
      + 'Gegenprobe, die ständig ausschlägt, liest niemand.\n\n'
      + '„keine Zuweisungen geholt" ist während des ersten Backfills normal und danach ein Befund. '
      + 'Eine große Abweichung heißt meistens, dass der Zuweisungsrückstand noch nicht abgearbeitet ist.',
    anzeige: 'table',
    parameter: [BETRIEB],
    sql: `
SELECT standort                                    AS "Standort",
       coalesce(betrieb, '— kein Betrieb')         AS "Betrieb",
       bounti_gesamt                               AS "Bounti: Kurse",
       eigene_gesamt                               AS "eigene: Zuweisungen",
       bounti_pct                                  AS "Bounti %",
       eigene_pct                                  AS "eigene %",
       zustand                                     AS "Zustand"
  FROM mart.bounti_fortschritt_gegenprobe
 WHERE true
   [[AND betrieb = {{betrieb}}]]
 ORDER BY CASE zustand WHEN 'stimmig' THEN 1 ELSE 0 END, standort`,
  },
]
