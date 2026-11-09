// =====================================================================
// Karten fuer "Personal je Stunde" (Migration 0149, Plan docs/plan-tpapi.md).
//
// Quelle ist LINAs Personalplanung ueber die offizielle Schnittstelle
// (TPAPI): wie viele Personen standen in welcher Stunde im Dienst, zu
// welchen Lohnkosten. Das ist NICHT die Personalquote der BWA und nicht
// die Effektivitaet aus dem Kassenbericht — die Dashboard-Seite sagt es.
//
// DIE FALLEN, DIE MAN DEN KARTEN NICHT ANSIEHT:
//
//   1. GESCHAEFTSTAG 08:00 BIS 07:59. Die Stunden 0 bis 7 stehen am ENDE
//      des Tages. Sortiert wird deshalb nach (stunde + 16) % 24, nie nach
//      der Uhrzeit.
//
//   2. EINE FEHLENDE STUNDE IST NICHT NULL PERSONEN, sondern "keine
//      Schicht eingeplant" — die Personalplanung fuehrt nur besetzte
//      Stunden. Die Verlaufskarten teilen deshalb durch die Zahl der
//      Betrieb-Tage mit Abrufzeile (stunden_geliefert > 0) und fuellen die
//      Stunden ohne Zeile mit 0. Ein Tag, an dem LINA gar nichts liefert
//      (stunden_geliefert = 0), zaehlt im Nenner NICHT mit: dort fuehrt
//      der Betrieb keine Schichten, das heisst nicht "niemand da".
//
//   3. NUR BETRIEBE MIT SCHLUESSEL. Wer fehlt, steht in im_tpapi_zugang
//      mit Grund.
//
//   4. QUOTEN AUS SUMMEN. Personalkostenquote und Umsatz je Personen-
//      stunde werden aus sum()/sum() gerechnet, nie als avg() der Quote.
//
//   5. NUR mart. Der MCP-Zugang fuehrt jede Karte als mcp_leser aus
//      (karten_schema.test.ts wacht darueber).
//
// MONAT OHNE WERT: der juengste Monat, fuer den es Personaltage gibt —
// nicht der des Round Table, denn die Personaldaten reichen nur rund ein
// Jahr zurueck.
// =====================================================================

import type { Karte } from './typen'
import { P_BETRIEB, P_MARKE, P_MONAT } from './gemeinsam'

const EURO = { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 }
const EURO2 = { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 2 }
const PROZENT = { suffix: ' %' }

/** Gewaehlter Monat, sonst der juengste mit Personaltagen. */
const MONAT_PERSONAL = `
WITH m AS (
    SELECT coalesce([[ {{monat}}::date, ]]
                    (SELECT max(monat) FROM mart.personal_tag)) AS monat
)`

/** Die Betrieb-Tage, ueber die gemittelt wird: gewaehlter Monat, mit Abrufzeile
 *  und mindestens einer gelieferten Stunde (Fall 2 im Kopf der Datei). */
const TAGE = `${MONAT_PERSONAL}, tage AS (
    SELECT t.betrieb_key, t.geschaeftstag, t.wochentag_nr
      FROM mart.personal_tag t
      JOIN m ON t.monat = m.monat
     WHERE t.stunden_geliefert > 0
       [[AND t.konzept = {{marke}}]]
       [[AND t.betrieb = {{betrieb}}]]
)`

export const karten: Karte[] = [
  {
    schluessel: 'pers_stunde_verlauf',
    name: 'Besetzung und Umsatz je Stunde',
    beschreibung:
      'Wie viele Personen stehen in welcher Stunde im Dienst (Balken) und was kommt in dieser '
      + 'Stunde herein (Linie) — jeweils der Durchschnitt je Betrieb und Tag im gewählten Monat. '
      + 'Gerechnet wird über die Tage, für die die Personalplanung Schichten führt.\n\n'
      + '**Der Geschäftstag läuft von 08 bis 07 Uhr**, die Nachtstunden stehen deshalb rechts. '
      + 'Eine Stunde ohne eingeplante Person fehlt in der Personalplanung und ist **null Personen**, '
      + 'nicht „unbekannt"; ein Tag, an dem der Betrieb gar keine Schichten führt, zählt nicht mit. '
      + 'Es gibt nur Betriebe mit Anbindung an die Personalplanung — wer fehlt, steht in der '
      + 'Importüberwachung. Ohne Betriebsfilter ist es der Durchschnitt über die gewählten Betriebe.',
    anzeige: 'combo',
    parameter: [P_MONAT, P_MARKE, P_BETRIEB],
    sql: `${TAGE},
n AS (SELECT count(*) AS tage FROM tage),
p AS (
    SELECT s.stunde, sum(s.personen) AS personen
      FROM mart.personal_stunde s
      JOIN tage USING (betrieb_key, geschaeftstag)
     GROUP BY s.stunde
), u AS (
    SELECT s.stunde, sum(s.umsatz_netto) AS umsatz
      FROM mart.umsatz_stunde s
      JOIN tage USING (betrieb_key, geschaeftstag)
     GROUP BY s.stunde
)
SELECT lpad(h::text, 2, '0') || ' Uhr'                              AS "Stunde",
       round(coalesce(p.personen, 0) / nullif(n.tage, 0), 2)        AS "Ø Personen",
       round(coalesce(u.umsatz, 0) / nullif(n.tage, 0), 2)          AS "Ø Umsatz netto"
  FROM generate_series(0, 23) h
  CROSS JOIN n
  LEFT JOIN p ON p.stunde = h
  LEFT JOIN u ON u.stunde = h
 ORDER BY (h + 16) % 24`,
    visualisierung: {
      'graph.dimensions': ['Stunde'],
      'graph.metrics': ['Ø Personen', 'Ø Umsatz netto'],
      series_settings: {
        'Ø Personen': { display: 'bar' },
        'Ø Umsatz netto': { display: 'line', axis: 'right' },
      },
      'graph.x_axis.title_text': '',
      column_settings: { '["name","Ø Umsatz netto"]': EURO },
    },
  },

  {
    schluessel: 'pers_wochentag_stunde',
    name: 'Besetzung — Stunde × Wochentag',
    beschreibung:
      'Durchschnittliche Zahl der Personen im Dienst je Stunde und Wochentag im gewählten Monat, '
      + 'je Betrieb und Tag — je dunkler grün, desto mehr Leute. Antwort auf „wie viele stehen '
      + 'sonntags ab 18 Uhr".\n\n'
      + '**Zeilen in Geschäftstagsreihenfolge (08 bis 07 Uhr).** Eine leere Zelle heißt: in dieser '
      + 'Stunde war an diesem Wochentag niemand eingeplant, nicht „keine Daten". Es zählen nur Tage, '
      + 'für die die Personalplanung Schichten führt, und nur Betriebe mit Anbindung.',
    anzeige: 'table',
    parameter: [P_MONAT, P_MARKE, P_BETRIEB],
    sql: `${TAGE},
tage_dow AS (
    SELECT wochentag_nr, count(*) AS tage FROM tage GROUP BY 1
), p AS (
    SELECT s.stunde, s.wochentag_nr, sum(s.personen) AS personen
      FROM mart.personal_stunde s
      JOIN tage USING (betrieb_key, geschaeftstag)
     GROUP BY 1, 2
)
SELECT lpad(h::text, 2, '0') || ':00'                               AS "Stunde",
       round(max(p.personen) FILTER (WHERE p.wochentag_nr = 1) / nullif(max(d.tage) FILTER (WHERE d.wochentag_nr = 1), 0), 2) AS "Mo",
       round(max(p.personen) FILTER (WHERE p.wochentag_nr = 2) / nullif(max(d.tage) FILTER (WHERE d.wochentag_nr = 2), 0), 2) AS "Di",
       round(max(p.personen) FILTER (WHERE p.wochentag_nr = 3) / nullif(max(d.tage) FILTER (WHERE d.wochentag_nr = 3), 0), 2) AS "Mi",
       round(max(p.personen) FILTER (WHERE p.wochentag_nr = 4) / nullif(max(d.tage) FILTER (WHERE d.wochentag_nr = 4), 0), 2) AS "Do",
       round(max(p.personen) FILTER (WHERE p.wochentag_nr = 5) / nullif(max(d.tage) FILTER (WHERE d.wochentag_nr = 5), 0), 2) AS "Fr",
       round(max(p.personen) FILTER (WHERE p.wochentag_nr = 6) / nullif(max(d.tage) FILTER (WHERE d.wochentag_nr = 6), 0), 2) AS "Sa",
       round(max(p.personen) FILTER (WHERE p.wochentag_nr = 7) / nullif(max(d.tage) FILTER (WHERE d.wochentag_nr = 7), 0), 2) AS "So"
  FROM generate_series(0, 23) h
  LEFT JOIN p ON p.stunde = h
  LEFT JOIN tage_dow d ON d.wochentag_nr = p.wochentag_nr
 GROUP BY h
 ORDER BY (h + 16) % 24`,
    visualisierung: {
      'table.column_formatting': [{
        columns: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], type: 'range',
        colors: ['#FFFFFF', '#3E8A5F'], min_type: null, max_type: null,
      }],
    },
  },

  {
    schluessel: 'pers_zeitfenster',
    name: 'Personal je Zeitfenster',
    beschreibung:
      'Wie das Personal über den Tag verteilt ist, im gewählten Monat: **Personenstunden je Tag** '
      + '(Summe über alle Personen im Fenster, je Betrieb und Tag), Lohnkosten, Nettoumsatz, '
      + 'Umsatz je Personenstunde und Personalkostenquote.\n\n'
      + 'Quote und Umsatz je Personenstunde sind aus den **Summen** gerechnet, nicht aus '
      + 'Tageswerten gemittelt. Die Lohnkosten stammen aus der Personalplanung und sind nicht die '
      + 'Personalkosten der BWA — die Quote hier ist deshalb nicht mit der Quote auf den '
      + 'Reitern daneben vergleichbar. Fenster über Mitternacht gehören zum Geschäftstag, an dem '
      + 'der Abend begann. Nur Betriebe mit Anbindung, nur Tage mit Schichten.',
    anzeige: 'table',
    parameter: [P_MONAT, P_MARKE, P_BETRIEB],
    // Der Nenner sind die Betrieb-Tage MIT Schichten (wie bei den anderen
    // Karten), nicht die Fenster mit Besetzung: ein selten besetztes Fenster
    // (Late Night) saehe sonst voll aus, weil nur seine besetzten Naechte
    // zaehlten — und sein Umsatz fehlte an allen anderen.
    sql: `${TAGE}
SELECT f.fenster                                                  AS "Zeitfenster",
       round(sum(coalesce(f.personenstunden, 0)) / nullif(count(*), 0), 1) AS "Ø Personenstunden je Tag",
       round(sum(coalesce(f.personalkosten, 0)))                  AS "Lohnkosten",
       round(sum(f.umsatz_netto))                                 AS "Umsatz netto",
       round(sum(f.umsatz_netto) / nullif(sum(f.personenstunden), 0), 2) AS "Umsatz je Personenstunde",
       round(sum(f.personalkosten) / nullif(sum(f.umsatz_netto), 0) * 100, 1) AS "Personalkostenquote %"
  FROM mart.personal_zeitfenster f
  JOIN tage USING (betrieb_key, geschaeftstag)
 GROUP BY f.fenster, f.reihenfolge
 ORDER BY f.reihenfolge`,
    zeilen_max: 8,
    visualisierung: {
      column_settings: {
        '["name","Lohnkosten"]': EURO,
        '["name","Umsatz netto"]': EURO,
        '["name","Umsatz je Personenstunde"]': EURO2,
        '["name","Personalkostenquote %"]': PROZENT,
      },
    },
  },

  {
    schluessel: 'pers_tag_verlauf',
    name: 'Personenstunden und Umsatz je Personenstunde — je Tag',
    beschreibung:
      'Je Geschäftstag des gewählten Monats: wie viele Personenstunden gearbeitet wurden (Balken) '
      + 'und was jede einbrachte (Linie, netto). Ohne Betriebsfilter sind alle gewählten Betriebe '
      + 'zusammengezählt; der Umsatz je Personenstunde ist aus den Tagessummen gerechnet.\n\n'
      + 'Ein Tag fehlt, wenn die Personalplanung für ihn keine Schichten führt — das heißt nicht, '
      + 'dass niemand gearbeitet hat. Die Lohnkosten sind die der Personalplanung, nicht die der BWA.',
    anzeige: 'combo',
    parameter: [P_MONAT, P_MARKE, P_BETRIEB],
    sql: `${MONAT_PERSONAL}
SELECT t.geschaeftstag                                            AS "Tag",
       round(sum(t.personenstunden), 1)                           AS "Personenstunden",
       round(sum(t.umsatz_netto) / nullif(sum(t.personenstunden), 0), 2) AS "Umsatz je Personenstunde"
  FROM mart.personal_tag t
  JOIN m ON t.monat = m.monat
 WHERE t.stunden_geliefert > 0
   [[AND t.konzept = {{marke}}]]
   [[AND t.betrieb = {{betrieb}}]]
 GROUP BY t.geschaeftstag
 ORDER BY t.geschaeftstag`,
    visualisierung: {
      'graph.dimensions': ['Tag'],
      'graph.metrics': ['Personenstunden', 'Umsatz je Personenstunde'],
      series_settings: {
        'Personenstunden': { display: 'bar' },
        'Umsatz je Personenstunde': { display: 'line', axis: 'right' },
      },
      'graph.x_axis.title_text': '',
      column_settings: { '["name","Umsatz je Personenstunde"]': EURO2 },
    },
  },

  // -------------------------------------------------------------------
  // Importueberwachung: wer hat Zugang, stimmen die Nachtstunden
  // -------------------------------------------------------------------
  {
    schluessel: 'im_tpapi_zugang',
    name: 'Personalplanung: Zugang je Betrieb',
    beschreibung:
      'Alle Betriebe mit dem Stand ihrer Anbindung an die Personalplanung; Auffälliges steht oben. '
      + '**Nicht lizenziert** heißt: das Modul ist für den Betrieb bei LINA nicht gebucht — ein '
      + 'Zustand, kein Fehler, und nichts, was der Import beheben kann. **Operativ ohne Schlüssel**: '
      + 'ein laufender Betrieb, für den es keine Personaldaten gibt. **Schlüssel ohne Zulauf**: seit '
      + 'zwei Tagen keine erfolgreiche Antwort. **Abgewiesen** und **gebremst** zeigen, dass LINA den '
      + 'Schlüssel ablehnt bzw. das Anfragelimit erreicht ist. „Nicht operativ" ist ohne Schlüssel '
      + 'in Ordnung.\n\n'
      + '**Rückstand (Tage)** ist, was von den letzten 365 Tagen noch fehlt; die Zahl muss von Nacht '
      + 'zu Nacht fallen. Wer hier nicht in Ordnung ist, fehlt in allen Karten zur Besetzung.',
    anzeige: 'table',
    sql: `
SELECT z.betrieb                                    AS "Betrieb",
       z.konzept                                    AS "Marke",
       z.status                                     AS "Status",
       z.befund                                     AS "Befund",
       CASE WHEN z.schluessel THEN 'ja' ELSE 'nein' END AS "Schlüssel",
       z.zuletzt_erfolg                             AS "Letzter Erfolg",
       z.tage_geladen                               AS "Tage geladen",
       z.aeltester_tag                              AS "Ältester Tag",
       z.juengster_tag                              AS "Jüngster Tag",
       z.rueckstand_tage                            AS "Rückstand (Tage)",
       z.letzter_fehler                             AS "Letzter Fehler"
  FROM mart.tpapi_zugang z
 ORDER BY (z.befund NOT IN ('ok', 'nicht operativ')) DESC, z.betrieb`,
  },

  {
    // Bis 0150 listete die Karte jeden Tag mit "weicht ab" — nach dem ersten
    // echten Lauf waren das 852 von 949, weil die TPAPI Kopfzahlen je Stunde
    // liefert und die Summe immer ueber LINAs Effektivitaet liegt. Eine
    // Liste, die immer voll ist, liest niemand. Jetzt eine Zeile je Betrieb
    // mit dem Faktor und seiner Streuung: der Faktor darf hoch sein, aber
    // er soll je Betrieb ruhig bleiben.
    schluessel: 'im_personal_pruefung',
    name: 'Personalplanung gegen Effektivität — je Betrieb',
    beschreibung:
      'Wie weit die Personalplanung über den Stunden liegt, die sich aus LINAs Effektivität '
      + '(Umsatz je Personalstunde) zurückrechnen lassen — je Betrieb über die letzten 60 Tage. '
      + 'Die Planung zählt **Köpfe je Stunde**: wer eine Viertelstunde da ist, zählt voll. Deshalb '
      + 'liegt sie **immer darüber**, meist um ein Viertel; das ist kein Fehler.\n\n'
      + 'Worauf zu achten ist: ein Betrieb, dessen Aufschlag **stark schwankt** (Spanne), oder der '
      + 'an vielen Tagen mit Umsatz **keine Schichten** liefert — dort plant jemand nicht oder nicht '
      + 'mehr in LINA. Die Lohnkosten sind die der Planung, nicht die der BWA.',
    anzeige: 'table',
    sql: `
SELECT p.betrieb                                                   AS "Betrieb",
       p.konzept                                                   AS "Marke",
       count(*) FILTER (WHERE p.befund_stunden IN ('ok', 'weicht ab'))  AS "Tage verglichen",
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY p.abweichung_stunden_pct)::numeric, 1)
                                                                   AS "Aufschlag Median %",
       round((percentile_cont(0.75) WITHIN GROUP (ORDER BY p.abweichung_stunden_pct)
            - percentile_cont(0.25) WITHIN GROUP (ORDER BY p.abweichung_stunden_pct))::numeric, 1)
                                                                   AS "Spanne %",
       count(*) FILTER (WHERE p.befund_stunden = 'leer' AND p.umsatz_netto > 0)
                                                                   AS "Tage ohne Schichten trotz Umsatz",
       count(*) FILTER (WHERE p.befund_stunden = 'ohne vergleich')  AS "Tage ohne Vergleichswert"
  FROM mart.personal_stunde_pruefung p
 WHERE p.geschaeftstag >= current_date - 60
 GROUP BY p.betrieb, p.konzept
 ORDER BY "Tage ohne Schichten trotz Umsatz" DESC, "Spanne %" DESC NULLS LAST, p.betrieb`,
    zeilen_max: 60,
    visualisierung: {
      column_settings: {
        '["name","Aufschlag Median %"]': PROZENT,
        '["name","Spanne %"]': PROZENT,
      },
    },
  },
]
