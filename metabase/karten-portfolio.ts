// =====================================================================
// Auswertungen, die im Excel fehlten — und die es bei 141 Betrieben und
// mehreren Marken eigentlich braucht.
//
// Das Excel-Ampelsystem war fuer 22 Enchilada-Betriebe gebaut. Bei dieser
// Groesse beantwortet man Portfoliofragen im Kopf. Bei 141 Betrieben und
// einem knappen Dutzend Marken geht das nicht mehr, und genau diese
// Fragen stellt hier bisher niemand:
//
//   * Wo steckt der Umsatz, und wie abhaengig sind wir von wenigen Betrieben?
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
import { MONAT_CTE, P_MONAT, P_MARKE, P_BETRIEB, WOCHENTAGE } from './gemeinsam'

export const karten: Karte[] = [
  // ===================================================================
  // Portfolio — wo steckt der Umsatz
  // ===================================================================
  {
    // Nachgemessen am 26.07.2026: 20 Prozent der Betriebe machen 70
    // Prozent des Umsatzes. Das ist die Zahl, die entscheidet, wie viel
    // ein Prozentpunkt Verbesserung bei einem kleinen Betrieb ueberhaupt
    // wert ist -- und wie weh ein Ausfall oben tut.
    //
    // Seit dem Review vom 03.08.2026 rollierende 12 Monate statt der
    // gesamten Historie: ueber 8,5 Jahre gerechnet stand auf Rang 8 ein
    // seit Januar geschlossener Betrieb. Die Frage der Karte ist "wovon
    // haengt die Gruppe HEUTE ab", nicht "wer hat je am meisten
    // umgesetzt". Geschlossene Betriebe bleiben absichtlich drin, solange
    // sie im Fenster Umsatz hatten -- ihr Anteil war real, und ihn
    // wegzulassen wuerde die kumulierten Prozente schoenen. Die Spalte
    // "Letzter Umsatztag" macht sie stattdessen kenntlich.
    schluessel: 'pf_konzentration',
    name: 'Umsatzkonzentration (12 Monate)',
    beschreibung:
      'Wie stark hängt der Gesamtumsatz an wenigen Betrieben? Die Betriebe nach Umsatz der letzten zwölf Monate sortiert, dazu der aufsummierte Anteil. Je mehr Umsatz auf die ersten Zeilen entfällt, desto schwerer wiegt dort eine Störung — und desto weniger bringt eine Verbesserung ganz unten. Ein „Letzter Umsatztag" weit in der Vergangenheit heißt: dieser Betrieb meldet nicht mehr, sein Anteil im Fenster ist Auslauf.',
    anzeige: 'table',
    parameter: [P_MARKE],
    sql: `
WITH je_betrieb AS (
    SELECT t.betrieb, t.konzept, s.letzter_umsatztag,
           sum(t.umsatz_netto) AS umsatz
      FROM mart.umsatz_tag t
      JOIN mart.betrieb_status s ON s.betrieb_key = t.betrieb_key
     WHERE t.geschaeftstag >= current_date - interval '12 months'
       [[AND t.konzept = {{marke}}]]
     GROUP BY t.betrieb, t.konzept, s.letzter_umsatztag
    HAVING sum(t.umsatz_netto) > 0
)
SELECT row_number() OVER (ORDER BY umsatz DESC)                          AS "Rang",
       betrieb                                                           AS "Betrieb",
       konzept                                                           AS "Marke",
       round(umsatz)                                                     AS "Umsatz",
       round(100 * umsatz / sum(umsatz) OVER (), 2)                      AS "Anteil %",
       round(100 * sum(umsatz) OVER (ORDER BY umsatz DESC)
             / sum(umsatz) OVER (), 1)                                   AS "kumuliert %",
       letzter_umsatztag                                                 AS "Letzter Umsatztag"
  FROM je_betrieb
 ORDER BY umsatz DESC`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
      },
    },
  },
  {
    // Dasselbe 12-Monats-Fenster wie in der Tabelle daneben. Zwei Karten,
    // die "denselben Zusammenhang" zeigen, aber ueber verschiedene
    // Zeitraeume rechnen, widersprechen sich in den Zahlen.
    schluessel: 'pf_konzentration_kurve',
    name: 'Konzentrationskurve (12 Monate)',
    beschreibung:
      'Derselbe Zusammenhang als Kurve, ebenfalls über die letzten zwölf Monate: wie viel Prozent des Umsatzes die stärksten Betriebe tragen. Je steiler die Kurve links ansteigt, desto abhängiger ist die Gruppe von wenigen Betrieben. Eine gerade Linie würde heißen, alle Betriebe tragen gleich viel bei.',
    anzeige: 'line',
    parameter: [P_MARKE],
    sql: `
WITH je_betrieb AS (
    SELECT betrieb, sum(umsatz_netto) AS umsatz
      FROM mart.umsatz_tag
     WHERE geschaeftstag >= current_date - interval '12 months'
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
      'Betriebe, die täglich Umsatzberichte liefern — aber durchgehend 0 €. Das ist keine Datenlücke: die Berichte kommen an, sie sind leer. Dahinter stehen Beteiligungsgesellschaften, geschlossene oder noch nicht eröffnete Betriebe und Testeinträge. Solche Betriebe verzerren jeden Durchschnitt und erzeugen unsinnige Quoten — etwa über 1000 % Personalkosten bei 0 € Umsatz. Diese Liste ist die Vorlage, um sie auf inaktiv zu setzen.',
    anzeige: 'table',
    parameter: [P_MARKE],
    sql: `
SELECT d.betrieb                       AS "Betrieb",
       d.konzept                       AS "Marke",
       s.status                        AS "Status",
       d.aktiv                         AS "Als aktiv geführt",
       coalesce(u.umsatz, 0)           AS "Umsatz gesamt",
       d.umsatztage                    AS "Tage mit Bericht",
       d.letzter_tag                   AS "Letzter Umsatztag",
       d.bwa_monat                     AS "BWA gebucht bis",
       r.personalkosten_ogf_pct        AS "Personal % (unsinnig)",
       d.befund                        AS "Befund"
  FROM mart.datenstand d
  -- Der abgeleitete Status aus mart.betrieb_status sagt, WARUM ein Betrieb
  -- ohne Umsatz gefuehrt wird: verwaltend, geschlossen, ohne_geschaeft
  -- oder test. Das unterscheidet die Vorlage zum Stilllegen von der
  -- Beteiligungsgesellschaft, die nie Umsatz melden wird.
  LEFT JOIN mart.betrieb_status s ON s.betrieb_key = d.betrieb_key
  LEFT JOIN LATERAL (
        SELECT sum(umsatz_netto) AS umsatz
          FROM mart.umsatz_tag t WHERE t.betrieb_key = d.betrieb_key
  ) u ON true
  LEFT JOIN LATERAL (
        SELECT max(personalkosten_ogf_pct) AS personalkosten_ogf_pct
          FROM mart.round_table_monat x WHERE x.betrieb_key = d.betrieb_key
  ) r ON true
 WHERE coalesce(u.umsatz, 0) = 0
   [[AND d.konzept = {{marke}}]]
 ORDER BY r.personalkosten_ogf_pct DESC NULLS LAST, d.betrieb`,
  },

  {
    // Anlass aus dem Review vom 03.08.2026: Rang 8 der Umsatzkonzentration
    // war ein seit Januar geschlossener Betrieb -- niemand hatte eine Liste,
    // WELCHE Betriebe aufgehoert haben zu melden und was das kostet.
    // Park Cafe Muenchen: letzter Umsatztag 12.01.2026, davor 3,1 Mio im
    // Jahr. Die Karteileichen-Liste daneben zeigt Betriebe OHNE JEDEN
    // Umsatz; diese hier zeigt die, die einmal liefen und verstummt sind.
    //
    // Test- und Verwaltungsgesellschaften sind ausgenommen: eine
    // Franchise-AG ohne Umsatz seit 2021 ist kein Ausfall, sondern ihr
    // Normalzustand.
    schluessel: 'pf_stillgelegt',
    name: 'Betriebe ohne Umsatz seit 90 Tagen',
    beschreibung:
      'Betriebe, die einmal Umsatz gemeldet haben und seit über 90 Tagen keinen mehr — mit dem letzten Umsatztag und dem Volumen der zwölf Monate davor. Sortiert nach diesem Volumen: die teuersten Ausfälle stehen oben. Test- und Verwaltungsgesellschaften sind ausgenommen; Betriebe, die nie Umsatz gemeldet haben, stehen in der Liste darüber.',
    anzeige: 'table',
    parameter: [P_MARKE],
    sql: `
SELECT s.betrieb                            AS "Betrieb",
       s.konzept                            AS "Marke",
       s.status                             AS "Status",
       s.letzter_umsatztag                  AS "Letzter Umsatztag",
       (current_date - s.letzter_umsatztag) AS "Tage ohne Umsatz",
       round(v.umsatz)                      AS "Umsatz 12 Monate davor"
  FROM mart.betrieb_status s
  -- Das Volumen der zwoelf Monate VOR dem letzten Umsatztag, nicht vor
  -- heute: bei einem 2023 geschlossenen Betrieb laege das Kalenderjahr vor
  -- heute komplett nach der Schliessung und ergaebe 0 -- der Ausfall
  -- saehe kostenlos aus. Direkt auf core.umsatzbericht_tag, weil
  -- mart.umsatz_tag je nach Sicht bereits gefiltert sein kann; die
  -- NULL-Schluessel waehlen die Gesamtzeile je Tag (wie in
  -- mart.betrieb_status selbst), sonst zaehlten Sparten doppelt.
  LEFT JOIN LATERAL (
        SELECT sum(u.umsatz_netto) AS umsatz
          FROM core.umsatzbericht_tag u
         WHERE u.betrieb_key = s.betrieb_key
           AND u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
           AND u.geschaeftstag >  s.letzter_umsatztag - interval '12 months'
           AND u.geschaeftstag <= s.letzter_umsatztag
  ) v ON true
 WHERE s.letzter_umsatztag < current_date - 90
   AND s.status NOT IN ('test', 'verwaltend')
   [[AND s.konzept = {{marke}}]]
 ORDER BY v.umsatz DESC NULLS LAST`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz 12 Monate davor"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
      },
    },
  },

  {
    // Diese Kachel ist der Grund, warum die Karteileichen-Liste weiter
    // unten ueberhaupt ein eigenes Thema ist -- und sie hat selbst eine
    // Korrektur hinter sich: "79 von 141" zaehlte jeden Betrieb, der
    // IRGENDWANN in 8,5 Jahren Umsatz hatte, auch die 2022 geschlossenen.
    // Mit Umsatz in den letzten 12 Monaten sind es 62 (Stand 03.08.2026).
    // Die Kachel sagt jetzt genau das, was sie zaehlt.
    schluessel: 'pf_kachel_aktiv',
    name: 'Betriebe mit Umsatz (12 Monate)',
    beschreibung:
      'Wie viele der geführten Betriebe hatten in den letzten zwölf Monaten Umsatz. Der Rest ist geschlossen, verwaltend oder liefert leere Berichte — und verzerrt jeden Durchschnitt, in den er hineingerät.',
    anzeige: 'scalar',
    parameter: [P_MARKE],
    sql: `
SELECT count(*) FILTER (WHERE letzter_umsatztag >= current_date - interval '12 months')::text
         || ' von ' || count(*)::text
         AS "Betriebe mit Umsatz in den letzten 12 Monaten"
  FROM mart.betrieb_status
 WHERE 1 = 1
   [[AND konzept = {{marke}}]]`,
  },

  // ===================================================================
  // Streuung — was waere zu holen
  // ===================================================================
  {
    // Die Frage, die ein Round Table eigentlich stellen sollte: nicht
    // "wer ist rot", sondern "was kostet uns der Abstand".
    schluessel: 'pf_potenzial',
    name: 'Potenzial bis zum Mittelfeld',
    beschreibung:
      'Was wäre rechnerisch zu holen, wenn jeder überdurchschnittliche Betrieb seine Personalkostenquote auf das Mittelfeld senken würde? Das ist kein Ziel und keine Prognose, sondern eine Größenordnung: sie zeigt, wo sich Arbeit am meisten lohnt. Nur operative Betriebe — geschlossene, verwaltende und Testbetriebe sind ausgenommen.',
    anzeige: 'table',
    parameter: [P_MONAT, P_MARKE],
    sql: `${MONAT_CTE},
basis AS (
    SELECT r.betrieb, r.konzept, r.umsatz_ist, r.personalkosten_ogf_pct
      FROM mart.round_table_monat r
      CROSS JOIN gewaehlt g
     WHERE r.monat = g.monat
       AND r.personalkosten_ogf_pct IS NOT NULL
       -- operativ = Umsatz im Monat UND weder Test noch Verwaltung. Das
       -- ersetzt das fruehere umsatz_ist > 0 und ist strenger: "€ bis
       -- Median" auf Basis geschlossener oder verwaltender Betriebe ist
       -- keine Groessenordnung, sondern Rauschen (Review 03.08.2026).
       AND r.operativ
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
      'Wie weit vergleichbare Betriebe auseinanderliegen. Liegen alle eng beieinander, ist die Quote durch das Geschäft vorgegeben und kaum zu ändern. Streuen sie weit, ist sie beeinflussbar — dann lohnt die Frage, was die günstigen Betriebe anders machen. Nur operative Betriebe.',
    anzeige: 'bar',
    parameter: [P_MONAT, P_MARKE],
    sql: `${MONAT_CTE},
klassen AS (
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
       -- Wie beim Potenzial: nur operative Betriebe. Eine Quote aus einem
       -- geschlossenen Betrieb verbreitert die Verteilung, ohne dass es ein
       -- Betrieb gaebe, an dem man etwas aendern koennte.
       AND r.operativ
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
    // Nachgemessen am 03.08.2026 ueber die letzten 12 Monate: Samstag
    // traegt im Schnitt 558.000 Euro, Montag 212.000. Wer Oeffnungszeiten
    // oder Dienstplaene diskutiert, faengt bei diesem Verhaeltnis an.
    //
    // 12 Monate statt der gesamten Historie: ueber 8,5 Jahre inklusive
    // Corona-Schliessungen gemittelt sagt der Wochenrhythmus nichts ueber
    // heute. Nulltage (umsatz_netto = 0) fliegen aus dem Schnitt -- ein
    // Ruhetag ist kein Umsatz von 0, sondern kein Geschaeftstag. Die
    // Spalte "Tage" zeigt, auf wie vielen Tagen der Schnitt steht.
    schluessel: 'pf_wochentag',
    name: 'Umsatz nach Wochentag (12 Monate)',
    beschreibung:
      'Der durchschnittliche Tagesumsatz je Wochentag über die letzten zwölf Monate; Tage ohne Umsatz (Ruhetage, Schließungen) zählen nicht in den Schnitt. Das Verhältnis zwischen starken und schwachen Tagen ist die Grundlage für jede Diskussion über Öffnungszeiten, Dienstpläne und Ruhetage.',
    anzeige: 'bar',
    parameter: [P_BETRIEB, P_MARKE],
    sql: `
SELECT ${WOCHENTAGE}[extract(isodow FROM t.geschaeftstag)::int]  AS "Wochentag",
       count(*)                                 AS "Tage",
       round(avg(t.umsatz))                     AS "Ø Umsatz",
       round(avg(t.gaeste))                     AS "Ø Gäste"
  FROM (
        SELECT geschaeftstag,
               sum(umsatz_netto) AS umsatz,
               sum(gaeste)       AS gaeste
          FROM mart.umsatz_tag
         WHERE umsatz_netto <> 0
           AND geschaeftstag >= current_date - interval '12 months'
           [[AND betrieb = {{betrieb}}]]
           [[AND konzept = {{marke}}]]
         GROUP BY geschaeftstag
       ) t
 GROUP BY extract(isodow FROM t.geschaeftstag)
 ORDER BY extract(isodow FROM t.geschaeftstag)`,
    visualisierung: {
      'graph.dimensions': ['Wochentag'],
      'graph.metrics': ['Ø Umsatz'],
      'graph.y_axis.title_text': 'Ø Tagesumsatz (€)',
    },
  },
  {
    // Dasselbe 12-Monats-Fenster wie die Karte daneben -- ein Profil aus
    // 8,5 Jahren beschreibt keine Marke von heute. Die Nulltage-Klausel
    // aendert an den Wochensummen nichts (0 addiert sich nicht), haelt
    // aber reine Melde-Karteileichen aus der Gruppierung.
    schluessel: 'pf_wochentag_marke',
    name: 'Wochenprofil je Marke (12 Monate)',
    beschreibung:
      'Derselbe Wochenrhythmus je Marke über die letzten zwölf Monate, jeweils in Prozent der eigenen Woche — dadurch vergleichbar, egal wie groß die Marke ist. Ein Mittagskonzept und eine Abendgastronomie zeigen hier sichtbar verschiedene Kurven und brauchen verschiedene Maßnahmen.',
    anzeige: 'line',
    parameter: [P_MARKE],
    sql: `
WITH je_tag AS (
    SELECT coalesce(konzept, '(nicht zugeordnet)') AS konzept,
           extract(isodow FROM geschaeftstag)::int AS tag_nr,
           sum(umsatz_netto)                       AS umsatz
      FROM mart.umsatz_tag
     WHERE umsatz_netto <> 0
       AND geschaeftstag >= current_date - interval '12 months'
       [[AND konzept = {{marke}}]]
     GROUP BY 1, 2
)
-- nullif: Marken, deren Betriebe durchgehend 0 EUR melden, haben eine
-- Wochensumme von 0 und wuerden die Division sprengen. Sie erscheinen
-- dann ohne Linie statt die ganze Karte scheitern zu lassen.
SELECT ${WOCHENTAGE}[tag_nr] AS "Wochentag",
       konzept  AS "Marke",
       round(100 * umsatz / nullif(sum(umsatz) OVER (PARTITION BY konzept), 0), 1)
                AS "Anteil an der Woche (%)"
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
    //
    // Review 03.08.2026: Die Rangliste fuehrte "A Testladen Concept
    // Family" an (117 % Schwankung, 1.935 EUR Gesamtumsatz) -- ein
    // Testeintrag, kein Betrieb. Deshalb nur noch operative Betriebe
    // (mart.betrieb_status). Und nur die letzten 12 Monate: eine
    // Schwankung, die Corona-Schliessungen von 2020 einrechnet, sagt
    // nichts ueber die Planbarkeit von heute.
    schluessel: 'pf_stabilitaet',
    name: 'Wie stabil läuft ein Betrieb (12 Monate)',
    beschreibung:
      'Wie stark der Tagesumsatz der letzten zwölf Monate schwankt, gemessen im Verhältnis zum eigenen Durchschnitt. Ein niedriger Wert heißt planbares Geschäft; ein hoher heißt Abhängigkeit von Wochenenden, Veranstaltungen oder Wetter — und macht die Personalplanung teuer. Der Bezug auf den eigenen Durchschnitt macht große und kleine Betriebe vergleichbar. Nur operative Betriebe mit mindestens 30 Umsatztagen.',
    anzeige: 'table',
    parameter: [P_MARKE],
    sql: `
SELECT t.betrieb                                            AS "Betrieb",
       t.konzept                                            AS "Marke",
       count(*)                                             AS "Tage",
       round(avg(t.umsatz_netto))                           AS "Ø Tagesumsatz",
       round(stddev_samp(t.umsatz_netto))                   AS "Streuung",
       round(100 * stddev_samp(t.umsatz_netto)
             / nullif(avg(t.umsatz_netto), 0), 1)           AS "Schwankung %",
       round(min(t.umsatz_netto))                           AS "Schwächster Tag",
       round(max(t.umsatz_netto))                           AS "Stärkster Tag"
  FROM mart.umsatz_tag t
  JOIN mart.betrieb_status s ON s.betrieb_key = t.betrieb_key
 WHERE t.umsatz_netto > 0
   AND t.geschaeftstag >= current_date - interval '12 months'
   AND s.status = 'operativ'
   [[AND t.konzept = {{marke}}]]
 GROUP BY t.betrieb, t.konzept
HAVING count(*) >= 30
 ORDER BY 100 * stddev_samp(t.umsatz_netto) / nullif(avg(t.umsatz_netto), 0) DESC`,
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
      'Woher eine Umsatzveränderung kommt: von mehr Gästen oder von höherem Umsatz je Gast. Die Unterscheidung entscheidet über die Maßnahme — mehr Gäste sind ein Marketing- und Standortthema, ein höherer Bon ein Karten-, Preis- und Verkaufsthema. Letzte zwölf abgeschlossene Monate, nur operative Betriebe. „Ø je Gast" rechnet nur über Tage, die auch eine Gästezahl tragen, und bleibt leer, wenn das weniger als 80 % der Umsatztage sind — wie auf der Umsatzseite.',
    anzeige: 'table',
    /*
     * VIER KORREKTUREN am 12.08.2026, jede fuer einen gemessenen Fehler:
     *
     * 1. "Ø je Gast" teilte den Umsatz ALLER Tage durch die Gaeste der
     *    GEZAEHLTEN Tage. Wilma Wunder Viernheim 06/2026: 2.962 EUR je
     *    Gast, weil an 30 Umsatztagen nur ein einziger eine Gaestezahl
     *    trug. Zaehler und Nenner kommen jetzt aus denselben Tagen, und
     *    unter 80 % Abdeckung bleibt die Spalte leer (dieselbe Regel,
     *    die db_umsatz im Kopftext zusagt).
     *
     * 2. lag() verglich ueber Luecken hinweg: fehlte ein Monat, stand
     *    "Vormonat" fuer einen Sprung von zwei oder mehr. Jetzt zaehlt
     *    ein Delta nur gegen den unmittelbaren Vormonat.
     *
     * 3. Ohne Statusfilter standen Testlaeden und geschlossene Betriebe
     *    in der Liste ("A Testladen Concept Family", 2024/2025).
     *
     * 4. Ohne Zeitfenster rechnete die Karte seit 2018 inklusive
     *    Corona-Monaten — als einzige der Seite.
     */
    parameter: [P_BETRIEB, P_MARKE],
    sql: `
WITH je_monat AS (
    SELECT u.betrieb, u.konzept, u.monat,
           sum(u.umsatz_netto) AS umsatz,
           sum(u.gaeste)       AS gaeste,
           sum(u.umsatz_netto) FILTER (WHERE u.gaeste > 0) AS umsatz_gezaehlt,
           count(*) FILTER (WHERE u.gaeste > 0)::numeric
             / nullif(count(*) FILTER (WHERE u.umsatz_netto > 0), 0) AS abdeckung
      FROM mart.umsatz_tag u
      JOIN mart.betrieb_status st USING (betrieb_key)
     WHERE st.status = 'operativ'
       AND u.monat >= (date_trunc('month', current_date) - interval '13 months')::date
       AND u.monat <  date_trunc('month', current_date)::date
       [[AND u.konzept = {{marke}}]]
       [[AND u.betrieb = {{betrieb}}]]
     GROUP BY u.betrieb, u.konzept, u.monat
    HAVING sum(u.gaeste) > 0
),
mit_vormonat AS (
    SELECT j.*,
           lag(monat)  OVER w AS monat_vor,
           lag(umsatz) OVER w AS umsatz_vor,
           lag(gaeste) OVER w AS gaeste_vor,
           CASE WHEN abdeckung >= 0.8
                THEN umsatz_gezaehlt / nullif(gaeste, 0) END AS je_gast,
           lag(CASE WHEN abdeckung >= 0.8
                    THEN umsatz_gezaehlt / nullif(gaeste, 0) END) OVER w AS je_gast_vor
      FROM je_monat j
    WINDOW w AS (PARTITION BY betrieb ORDER BY monat)
)
SELECT betrieb                                                        AS "Betrieb",
       monat                                                          AS "Monat",
       round(umsatz)                                                  AS "Umsatz",
       round(100 * (umsatz - umsatz_vor) / nullif(umsatz_vor, 0), 1)  AS "Umsatz Δ %",
       gaeste                                                         AS "Gäste",
       round(100 * (gaeste - gaeste_vor) / nullif(gaeste_vor, 0), 1)  AS "Gäste Δ %",
       round(je_gast, 2)                                              AS "Ø je Gast",
       round(100 * (je_gast - je_gast_vor)
             / nullif(je_gast_vor, 0), 1)                             AS "Ø je Gast Δ %",
       CASE
         WHEN je_gast IS NULL OR je_gast_vor IS NULL                  THEN NULL
         WHEN gaeste > gaeste_vor AND je_gast > je_gast_vor           THEN 'beides gestiegen'
         WHEN gaeste > gaeste_vor                                     THEN 'mehr Gäste'
         WHEN je_gast > je_gast_vor                                   THEN 'höherer Bon'
         WHEN gaeste = gaeste_vor AND je_gast = je_gast_vor           THEN 'unverändert'
         ELSE                                                              'beides gefallen'
       END                                                            AS "Treiber"
  FROM mit_vormonat
 WHERE umsatz_vor IS NOT NULL
   AND monat_vor = (monat - interval '1 month')::date
   AND monat >= (date_trunc('month', current_date) - interval '12 months')::date
 ORDER BY monat DESC, umsatz DESC`,
  },

  // ===================================================================
  // Marken nebeneinander
  // ===================================================================
  {
    schluessel: 'pf_marken_matrix',
    name: 'Marken über alle Kennzahlen',
    beschreibung:
      'Jede Marke in jeder Kennzahl, jeweils der mittlere Betrieb, mit dem Abstand zum Gesamtmittelfeld. So wird sichtbar, ob eine Marke durchgehend schwächer ist oder nur in einer Disziplin — und ob ein auffälliger Betrieb ein Einzelfall ist oder typisch für seine Marke. Achtung beim Vorzeichen: beim Umsatz ist mehr besser, bei den Quoten weniger.',
    anzeige: 'table',
    parameter: [P_MONAT, P_MARKE],
    sql: `${MONAT_CTE},
werte AS (
    -- Nur operative Betriebe: ohne den Filter zogen im Juli 2026 die
    -- Werte von 61 nicht operativen Zeilen die Marken-Mediane schief.
    SELECT a.konzept, a.bereich_name, a.reihenfolge, a.wert
      FROM mart.ampel_bereich a
      CROSS JOIN gewaehlt g
     WHERE a.monat = g.monat AND a.wert IS NOT NULL
       AND a.operativ
       [[AND a.konzept = {{marke}}]]
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
      'Wie sich der Gesamtumsatz Monat für Monat auf die Marken verteilt. Zeigt Verschiebungen zwischen den Marken, die man dem einzelnen Betrieb nicht ansieht.',
    anzeige: 'bar',
    parameter: [P_MARKE],
    sql: `
SELECT monat                                   AS "Monat",
       coalesce(konzept, '(nicht zugeordnet)') AS "Marke",
       round(sum(umsatz_netto))                AS "Umsatz"
  FROM mart.umsatz_tag
 -- Ohne den laufenden Monat: angebrochen verschiebt er die Anteile im
 -- juengsten Balken — die normalized-Darstellung versteckt, dass ihm
 -- Tage fehlen.
 WHERE monat < date_trunc('month', current_date)::date
   [[AND konzept = {{marke}}]]
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
