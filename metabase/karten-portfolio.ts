// =====================================================================
// Auswertungen, die im Excel fehlten — und die es bei 141 Betrieben und
// mehreren Marken eigentlich braucht.
//
// Das Excel-Ampelsystem war fuer 22 Enchilada-Betriebe gebaut. Bei dieser
// Groesse beantwortet man Portfoliofragen im Kopf. Bei 141 Betrieben und
// einem knappen Dutzend Marken geht das nicht mehr, und genau diese
// Fragen stellt hier bisher niemand:
//
//   * Wo steckt der Umsatz, und wie abhaengig sind wir von wenigen Haeusern?
//   * Welche Betriebe sind ueberhaupt beurteilbar, und welche sind
//     Karteileichen, die jede Auswertung verzerren?
//   * Wie weit streuen vergleichbare Betriebe auseinander — und was waere
//     zu holen, wenn die schwachen den Median erreichten?
//   * Welcher Wochentag und welche Tageszeit traegt das Geschaeft?
//   * Wer ist stabil, wer schwankt?
//
// Alle Karten hier setzen auf mart auf und erfinden keine neue Ampel.
// =====================================================================

import type { Karte } from './typen'
import { MONAT_CTE, MONAT_CTE_UMSATZ, P_MONAT, P_MARKE, P_BETRIEB } from './gemeinsam'

export const karten: Karte[] = [
  // ===================================================================
  // Portfolio — wo steckt der Umsatz
  // ===================================================================
  {
    // Nachgemessen am 26.07.2026: 20 Prozent der Betriebe machen 70
    // Prozent des Umsatzes. Das ist die Zahl, die entscheidet, wie viel
    // ein Prozentpunkt Verbesserung bei einem kleinen Haus ueberhaupt
    // wert ist -- und wie weh ein Ausfall oben tut.
    schluessel: 'pf_konzentration',
    name: 'Umsatzkonzentration',
    beschreibung:
      'Wie stark hängt der Gesamtumsatz an wenigen Häusern? Die Betriebe nach Umsatz sortiert, dazu der kumulierte Anteil. Am 26.07.2026 kamen 70 % des Umsatzes aus dem stärksten Fünftel — jede Störung dort wiegt entsprechend schwerer als eine Verbesserung im langen Schwanz.',
    anzeige: 'table',
    parameter: [P_MARKE],
    sql: `
WITH je_betrieb AS (
    SELECT betrieb, konzept, sum(umsatz_netto) AS umsatz
      FROM mart.umsatz_tag
     WHERE 1 = 1
       [[AND konzept = {{marke}}]]
     GROUP BY betrieb, konzept
    HAVING sum(umsatz_netto) > 0
)
SELECT row_number() OVER (ORDER BY umsatz DESC)                          AS "Rang",
       betrieb                                                           AS "Betrieb",
       konzept                                                           AS "Marke",
       round(umsatz)                                                     AS "Umsatz",
       round(100 * umsatz / sum(umsatz) OVER (), 2)                      AS "Anteil %",
       round(100 * sum(umsatz) OVER (ORDER BY umsatz DESC)
             / sum(umsatz) OVER (), 1)                                   AS "kumuliert %"
  FROM je_betrieb
 ORDER BY umsatz DESC`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
      },
    },
  },
  {
    schluessel: 'pf_konzentration_kurve',
    name: 'Konzentrationskurve',
    beschreibung:
      'Derselbe Zusammenhang als Kurve: wie viel Prozent des Umsatzes die stärksten x Prozent der Betriebe tragen. Je steiler der Anstieg links, desto abhängiger ist die Gruppe von wenigen Häusern. Eine Diagonale wäre Gleichverteilung.',
    anzeige: 'line',
    parameter: [P_MARKE],
    sql: `
WITH je_betrieb AS (
    SELECT betrieb, sum(umsatz_netto) AS umsatz
      FROM mart.umsatz_tag
     WHERE 1 = 1
       [[AND konzept = {{marke}}]]
     GROUP BY betrieb
    HAVING sum(umsatz_netto) > 0
),
rang AS (
    SELECT umsatz,
           row_number() OVER (ORDER BY umsatz DESC)          AS r,
           count(*) OVER ()                                  AS n,
           sum(umsatz) OVER (ORDER BY umsatz DESC)           AS kum,
           sum(umsatz) OVER ()                               AS gesamt
      FROM je_betrieb
)
SELECT round(100.0 * r / n)                AS "Betriebe (%)",
       round(100.0 * kum / gesamt, 1)      AS "Umsatz kumuliert (%)"
  FROM rang
 ORDER BY r`,
    visualisierung: {
      'graph.dimensions': ['Betriebe (%)'],
      'graph.metrics': ['Umsatz kumuliert (%)'],
      'graph.x_axis.title_text': 'Betriebe, nach Umsatz sortiert (%)',
      'graph.y_axis.title_text': 'Umsatz kumuliert (%)',
    },
  },
  {
    // Der Anlass ist ein echter Fund: "Enchilada Bremen" stand mit 1109
    // Prozent Personalquote bei 0 Euro Umsatz in der Auswertung. Ein
    // Mittelwert ueber diese Gruppe ist wertlos, und die Ampel meldet
    // eine Katastrophe, wo in Wahrheit gar kein Betrieb laeuft.
    schluessel: 'pf_karteileichen',
    name: 'Betriebe ohne laufendes Geschäft',
    beschreibung:
      'Betriebe, die in der Struktur stehen und täglich Umsatzberichte liefern — aber durchgehend 0 €. Am 26.07.2026 waren das 79 von 141; nur 62 Betriebe machen überhaupt Umsatz. Das ist keine Datenlücke: die Berichte kommen an, sie sind leer. Beteiligungsgesellschaften, geschlossene oder noch nicht eröffnete Häuser, Testeinträge. Sie verzerren jeden Mittelwert und erzeugen absurde Quoten — „Enchilada Bremen" stand mit 1109 % Personalkosten bei 0 € Umsatz in der Ampel. Diese Liste ist die Arbeitsvorlage, um sie auf inaktiv zu setzen; bis dahin ist bei jeder Auswertung mitzudenken, dass 56 % der Zeilen leer sind.',
    anzeige: 'table',
    sql: `
SELECT d.betrieb                       AS "Betrieb",
       d.konzept                       AS "Marke",
       d.aktiv                         AS "Als aktiv geführt",
       coalesce(u.umsatz, 0)           AS "Umsatz gesamt",
       d.umsatztage                    AS "Tage mit Bericht",
       d.letzter_tag                   AS "Letzter Umsatztag",
       d.bwa_monat                     AS "BWA gebucht bis",
       r.personalkosten_ogf_pct        AS "Personal % (unsinnig)",
       d.befund                        AS "Befund"
  FROM mart.datenstand d
  LEFT JOIN LATERAL (
        SELECT sum(umsatz_netto) AS umsatz
          FROM mart.umsatz_tag t WHERE t.betrieb_key = d.betrieb_key
  ) u ON true
  LEFT JOIN LATERAL (
        SELECT max(personalkosten_ogf_pct) AS personalkosten_ogf_pct
          FROM mart.round_table_monat x WHERE x.betrieb_key = d.betrieb_key
  ) r ON true
 WHERE coalesce(u.umsatz, 0) = 0
 ORDER BY r.personalkosten_ogf_pct DESC NULLS LAST, d.betrieb`,
  },

  {
    // Diese Kachel ist der Grund, warum die Karteileichen-Liste weiter
    // unten ueberhaupt ein eigenes Thema ist: 79 von 141 klingt nach
    // einem Randfall, 56 Prozent nicht mehr.
    schluessel: 'pf_kachel_aktiv',
    name: 'Betriebe mit Umsatz',
    beschreibung:
      'Wie viele der geführten Betriebe machen überhaupt Umsatz. Der Rest liefert täglich Berichte über 0 € und verzerrt jeden Durchschnitt.',
    anzeige: 'scalar',
    sql: `
SELECT count(*) FILTER (WHERE u.umsatz > 0)::text || ' von ' || count(*)::text
         AS "Betriebe mit Umsatz"
  FROM mart.datenstand d
  LEFT JOIN LATERAL (
        SELECT sum(umsatz_netto) AS umsatz
          FROM mart.umsatz_tag t WHERE t.betrieb_key = d.betrieb_key
  ) u ON true`,
  },

  // ===================================================================
  // Streuung — was waere zu holen
  // ===================================================================
  {
    // Die Frage, die ein Round Table eigentlich stellen sollte: nicht
    // "wer ist rot", sondern "was kostet uns der Abstand".
    schluessel: 'pf_potenzial',
    name: 'Potenzial bis zum Median',
    beschreibung:
      'Was wäre rechnerisch zu holen, wenn jeder Betrieb über dem Median seine Personalkostenquote nur auf den Median senkte? Kein Ziel und keine Prognose — eine Größenordnung, die sagt, wo sich Arbeit lohnt. Betriebe ohne Umsatz sind ausgeschlossen, sonst dominiert der Unsinn die Liste.',
    anzeige: 'table',
    parameter: [P_MONAT, P_MARKE],
    sql: `${MONAT_CTE}
WITH basis AS (
    SELECT r.betrieb, r.konzept, r.umsatz_ist, r.personalkosten_ogf_pct
      FROM mart.round_table_monat r
      CROSS JOIN gewaehlt g
     WHERE r.monat = g.monat
       AND r.personalkosten_ogf_pct IS NOT NULL
       AND r.umsatz_ist > 0
       [[AND r.konzept = {{marke}}]]
),
mitte AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY personalkosten_ogf_pct)::numeric AS median
      FROM basis
)
SELECT b.betrieb                                                   AS "Betrieb",
       b.konzept                                                   AS "Marke",
       round(b.umsatz_ist)                                         AS "Umsatz",
       b.personalkosten_ogf_pct                                    AS "Personal %",
       round(m.median, 1)                                          AS "Median",
       round(b.personalkosten_ogf_pct - m.median, 1)               AS "Δ Punkte",
       round(b.umsatz_ist * (b.personalkosten_ogf_pct - m.median) / 100) AS "€ bis Median"
  FROM basis b
  CROSS JOIN mitte m
 WHERE b.personalkosten_ogf_pct > m.median
 ORDER BY b.umsatz_ist * (b.personalkosten_ogf_pct - m.median) DESC`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","€ bis Median"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
      },
    },
  },
  {
    schluessel: 'pf_streuung',
    name: 'Streuung der Personalquote',
    beschreibung:
      'Wie weit vergleichbare Betriebe auseinanderliegen. Eine enge Verteilung heißt, die Quote ist strukturell bedingt; eine breite heißt, sie ist beeinflussbar — und dann lohnt die Frage, was die unteren anders machen. Die Klassenbreite ist bewusst grob: bei mehr als etwa sieben Klassen verwischen benachbarte ohnehin.',
    anzeige: 'bar',
    parameter: [P_MONAT, P_MARKE],
    sql: `${MONAT_CTE}
WITH klassen AS (
    SELECT CASE
             WHEN r.personalkosten_ogf_pct < 26 THEN '1 — unter 26 %'
             WHEN r.personalkosten_ogf_pct < 29 THEN '2 — 26 bis 29 %'
             WHEN r.personalkosten_ogf_pct < 32 THEN '3 — 29 bis 32 %'
             WHEN r.personalkosten_ogf_pct < 36 THEN '4 — 32 bis 36 %'
             WHEN r.personalkosten_ogf_pct < 42 THEN '5 — 36 bis 42 %'
             ELSE                                    '6 — über 42 %'
           END AS klasse
      FROM mart.round_table_monat r
      CROSS JOIN gewaehlt g
     WHERE r.monat = g.monat
       AND r.personalkosten_ogf_pct IS NOT NULL
       AND r.umsatz_ist > 0
       [[AND r.konzept = {{marke}}]]
)
SELECT klasse   AS "Personalkostenquote",
       count(*) AS "Betriebe"
  FROM klassen
 GROUP BY klasse
 ORDER BY klasse`,
    visualisierung: {
      'graph.dimensions': ['Personalkostenquote'],
      'graph.metrics': ['Betriebe'],
      'graph.show_values': true,
      'graph.y_axis.title_text': 'Betriebe',
    },
  },

  // ===================================================================
  // Muster im Geschaeft
  // ===================================================================
  {
    // Nachgemessen: Samstag traegt im Schnitt 546.000 Euro, Montag
    // 207.000. Wer Oeffnungszeiten oder Dienstplaene diskutiert, faengt
    // bei diesem Verhaeltnis an.
    schluessel: 'pf_wochentag',
    name: 'Umsatz nach Wochentag',
    beschreibung:
      'Der durchschnittliche Tagesumsatz je Wochentag. Am 26.07.2026 stand Samstag bei rund dem Zweieinhalbfachen des Montags — die Grundlage für jede Diskussion über Öffnungszeiten, Dienstpläne und Ruhetage.',
    anzeige: 'bar',
    parameter: [P_BETRIEB, P_MARKE],
    sql: `
SELECT trim(to_char(t.geschaeftstag, 'TMDay'))  AS "Wochentag",
       round(avg(t.umsatz))                     AS "Ø Umsatz",
       round(avg(t.gaeste))                     AS "Ø Gäste"
  FROM (
        SELECT geschaeftstag,
               sum(umsatz_netto) AS umsatz,
               sum(gaeste)       AS gaeste
          FROM mart.umsatz_tag
         WHERE 1 = 1
           [[AND betrieb = {{betrieb}}]]
           [[AND konzept = {{marke}}]]
         GROUP BY geschaeftstag
       ) t
 GROUP BY trim(to_char(t.geschaeftstag, 'TMDay')), to_char(t.geschaeftstag, 'ID')
 ORDER BY to_char(t.geschaeftstag, 'ID')`,
    visualisierung: {
      'graph.dimensions': ['Wochentag'],
      'graph.metrics': ['Ø Umsatz'],
      'graph.y_axis.title_text': 'Ø Tagesumsatz (€)',
    },
  },
  {
    schluessel: 'pf_wochentag_marke',
    name: 'Wochenprofil je Marke',
    beschreibung:
      'Derselbe Wochenrhythmus, aber je Marke und in Prozent der eigenen Woche. Dadurch vergleichbar, egal wie groß die Marke ist. Ein Mittagskonzept und eine Abendgastronomie haben hier sichtbar verschiedene Kurven — und brauchen verschiedene Maßnahmen.',
    anzeige: 'line',
    sql: `
WITH je_tag AS (
    SELECT coalesce(konzept, '(nicht zugeordnet)') AS konzept,
           to_char(geschaeftstag, 'ID')            AS tag_nr,
           trim(to_char(geschaeftstag, 'TMDay'))   AS tag,
           sum(umsatz_netto)                       AS umsatz
      FROM mart.umsatz_tag
     GROUP BY 1, 2, 3
)
SELECT tag      AS "Wochentag",
       konzept  AS "Marke",
       round(100 * umsatz / sum(umsatz) OVER (PARTITION BY konzept), 1) AS "Anteil an der Woche (%)"
  FROM je_tag
 ORDER BY tag_nr`,
    visualisierung: {
      'graph.dimensions': ['Wochentag', 'Marke'],
      'graph.metrics': ['Anteil an der Woche (%)'],
      'graph.y_axis.title_text': 'Anteil an der Woche (%)',
    },
  },
  {
    // Stabilitaet ist im Excel gar nicht vorgekommen, ist aber die
    // Kennzahl, die einen strukturell schwachen Betrieb von einem
    // unterscheidet, der nur einen schlechten Monat hatte.
    schluessel: 'pf_stabilitaet',
    name: 'Wie stabil läuft ein Betrieb',
    beschreibung:
      'Schwankung des Tagesumsatzes, gemessen als Variationskoeffizient (Standardabweichung geteilt durch Mittelwert). Ein niedriger Wert heißt planbares Geschäft, ein hoher heißt Abhängigkeit von Wochenenden, Events oder Wetter — und macht Personalplanung teuer. Bewusst relativ, damit große und kleine Häuser vergleichbar bleiben.',
    anzeige: 'table',
    parameter: [P_MARKE],
    sql: `
SELECT betrieb                                              AS "Betrieb",
       konzept                                              AS "Marke",
       count(*)                                             AS "Tage",
       round(avg(umsatz_netto))                             AS "Ø Tagesumsatz",
       round(stddev_samp(umsatz_netto))                     AS "Streuung",
       round(100 * stddev_samp(umsatz_netto)
             / nullif(avg(umsatz_netto), 0), 1)             AS "Schwankung %",
       round(min(umsatz_netto))                             AS "Schwächster Tag",
       round(max(umsatz_netto))                             AS "Stärkster Tag"
  FROM mart.umsatz_tag
 WHERE umsatz_netto > 0
   [[AND konzept = {{marke}}]]
 GROUP BY betrieb, konzept
HAVING count(*) >= 30
 ORDER BY 100 * stddev_samp(umsatz_netto) / nullif(avg(umsatz_netto), 0) DESC`,
    visualisierung: {
      column_settings: {
        '["name","Ø Tagesumsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
      },
    },
  },
  {
    schluessel: 'pf_gaeste_bon',
    name: 'Kommen mehr Gäste oder geben sie mehr aus?',
    beschreibung:
      'Umsatzveränderung zerlegt in ihre beiden Ursachen: mehr Gäste oder höherer Umsatz je Gast. Die Unterscheidung entscheidet über die Maßnahme — Frequenz ist ein Marketing- und Standortthema, der Bon ein Karten-, Preis- und Verkaufsthema. Im Excel war beides in einer Zahl vermischt.',
    anzeige: 'table',
    parameter: [P_MARKE],
    sql: `
WITH je_monat AS (
    SELECT betrieb, konzept, monat,
           sum(umsatz_netto) AS umsatz,
           sum(gaeste)       AS gaeste
      FROM mart.umsatz_tag
     WHERE 1 = 1
       [[AND konzept = {{marke}}]]
     GROUP BY betrieb, konzept, monat
    HAVING sum(gaeste) > 0
),
mit_vormonat AS (
    SELECT j.*,
           lag(umsatz) OVER w AS umsatz_vor,
           lag(gaeste) OVER w AS gaeste_vor
      FROM je_monat j
    WINDOW w AS (PARTITION BY betrieb ORDER BY monat)
)
SELECT betrieb                                                        AS "Betrieb",
       monat                                                          AS "Monat",
       round(umsatz)                                                  AS "Umsatz",
       round(100 * (umsatz - umsatz_vor) / nullif(umsatz_vor, 0), 1)  AS "Umsatz Δ %",
       gaeste                                                         AS "Gäste",
       round(100 * (gaeste - gaeste_vor) / nullif(gaeste_vor, 0), 1)  AS "Gäste Δ %",
       round(umsatz / gaeste, 2)                                      AS "Ø je Gast",
       round(100 * ((umsatz / gaeste) - (umsatz_vor / nullif(gaeste_vor, 0)))
             / nullif(umsatz_vor / nullif(gaeste_vor, 0), 0), 1)      AS "Ø je Gast Δ %",
       CASE
         WHEN umsatz_vor IS NULL                                     THEN NULL
         WHEN gaeste > gaeste_vor AND umsatz / gaeste > umsatz_vor / nullif(gaeste_vor, 0)
              THEN 'beides gestiegen'
         WHEN gaeste > gaeste_vor                                     THEN 'mehr Gäste'
         WHEN umsatz / gaeste > umsatz_vor / nullif(gaeste_vor, 0)    THEN 'höherer Bon'
         ELSE                                                              'beides gefallen'
       END                                                            AS "Treiber"
  FROM mit_vormonat
 WHERE umsatz_vor IS NOT NULL
 ORDER BY monat DESC, umsatz DESC`,
  },

  // ===================================================================
  // Marken nebeneinander
  // ===================================================================
  {
    schluessel: 'pf_marken_matrix',
    name: 'Marken über alle Metriken',
    beschreibung:
      'Jede Marke in jeder Metrik, als Median, mit dem Abstand zum Gesamtmedian. So sieht man, ob eine Marke durchgehend schwächer ist oder nur in einer Disziplin — und ob ein auffälliger Betrieb Ausreißer ist oder Symptom seiner Marke. Vorsicht beim Vorzeichen: bei Umsatz ist mehr besser, bei den Quoten weniger.',
    anzeige: 'table',
    parameter: [P_MONAT],
    sql: `${MONAT_CTE}
WITH werte AS (
    SELECT a.konzept, a.bereich_name, a.reihenfolge, a.wert
      FROM mart.ampel_bereich a
      CROSS JOIN gewaehlt g
     WHERE a.monat = g.monat AND a.wert IS NOT NULL
),
je_marke AS (
    SELECT konzept, bereich_name, reihenfolge,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY wert)::numeric AS median,
           count(*)::int AS n
      FROM werte GROUP BY 1, 2, 3
),
gesamt AS (
    SELECT bereich_name,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY wert)::numeric AS median
      FROM werte GROUP BY 1
)
SELECT m.bereich_name                       AS "Metrik",
       m.konzept                            AS "Marke",
       m.n                                  AS "Betriebe",
       round(m.median, 1)                   AS "Median",
       round(a.median, 1)                   AS "Gesamt",
       round(m.median - a.median, 1)        AS "Δ"
  FROM je_marke m
  JOIN gesamt a ON a.bereich_name = m.bereich_name
 ORDER BY m.reihenfolge, m.median`,
  },
  {
    schluessel: 'pf_marken_umsatzanteil',
    name: 'Umsatzanteil je Marke',
    beschreibung:
      'Wie sich der Gesamtumsatz auf die Marken verteilt, Monat für Monat. Zeigt Verschiebungen im Portfolio, die in den Einzelbetrieben untergehen.',
    anzeige: 'bar',
    sql: `
SELECT monat                                   AS "Monat",
       coalesce(konzept, '(nicht zugeordnet)') AS "Marke",
       round(sum(umsatz_netto))                AS "Umsatz"
  FROM mart.umsatz_tag
 GROUP BY monat, konzept
 ORDER BY monat`,
    visualisierung: {
      'graph.dimensions': ['Monat', 'Marke'],
      'graph.metrics': ['Umsatz'],
      'stackable.stack_type': 'normalized',
      'graph.y_axis.title_text': 'Anteil am Gesamtumsatz',
    },
  },
]
