// =====================================================================
// Aktionen — was Sonderangebote und Feinsparten am Umsatz ausmachen
//
// Quelle ist LINAs getAktionsbericht (docs/datenherkunft.md): eine
// Kreuztabelle Betriebe x Aktionen, je Tag eine Zelle mit Umsatz und
// Anteil am Netto-Tagesumsatz. Daraus rechnet mart.aktionsumsatz_monat
// den Monatsanteil selbst — den gibt LINA nicht her.
//
// DER VORBEHALT, DER UEBER ALLEM STEHT: nur 34 Betriebe erfassen
// ueberhaupt Aktionen, 19 davon Enchilada, 14 Wilma Wunder, einer
// Deutsche Konzepte. Das ist KEINE Konzernsicht. Jede Zahl auf diesen
// Karten ist eine Aussage ueber die mitmachenden Haeuser — und ein
// Betrieb, der hier fehlt, faehrt vielleicht dieselbe Aktion und tippt
// sie nur nicht ein. Der Satz steht deshalb in jeder Beschreibung, nicht
// nur einmal im Dashboardkopf: Karten werden einzeln kopiert und
// verschickt, und dann reist der Vorbehalt mit.
//
// ZWEI LAUFZEITEN, DIE MAN NICHT VERWECHSELN DARF (mart.aktion):
//
//   GEPLANT      gueltig_von/gueltig_bis aus LINAs Stammdaten. Meistens
//                NULL — dann laeuft die Aktion unbefristet.
//   TATSAECHLICH erster_umsatztag/letzter_umsatztag, gemessen an den
//                gebuchten Zellen. Die interessante Differenz: die
//                "Sarti Aktion" laeuft seit 2018 ohne Enddatum weiter,
//                und "Happy Hour Enchilada KG3" war ein Jahr lang
//                geplant und hat nie einen Euro gesehen.
//
// Die Aktion "Test" wird NICHT herausgefiltert. Sie hat 47.500 € Umsatz
// in einem Monat auf einem einzigen Betrieb — wer so etwas ausblendet,
// versteckt einen Erfassungsfehler, statt ihn zur Sprache zu bringen.
// Der Steckbrief unten macht solche Faelle sichtbar.
// =====================================================================

import type { Karte } from './typen'
import { MONAT_CTE, P_MONAT, P_MARKE, P_BETRIEB } from './gemeinsam'

const MONAT = P_MONAT
const MARKE = P_MARKE
const BETRIEB = P_BETRIEB

export const karten: Karte[] = [
  // -------------------------------------------------------------------
  // Uebersicht — der Einstieg
  // -------------------------------------------------------------------
  {
    schluessel: 'ak_uebersicht',
    name: 'Aktionen der letzten zwölf Monate',
    beschreibung:
      'Jede Aktion mit Umsatz in den letzten zwölf Monaten: wie viele Betriebe sie fahren, '
      + 'was sie einspielt und welchen Anteil sie am Umsatz der teilnehmenden Betriebe hat. '
      + '**Ø Anteil** ist der ungewichtete Schnitt über die Betriebsmonate — wie stark die '
      + 'Aktion das Geschäft eines mitmachenden Hauses prägt, nicht ihr Anteil an der Summe.\n\n'
      + '**Nur 34 Betriebe (überwiegend Enchilada) erfassen Aktionen** — die Zahlen '
      + 'beschreiben diese Häuser, nicht die Gruppe.',
    anzeige: 'table',
    parameter: [MARKE, BETRIEB],
    // Zwoelf Monate EINSCHLIESSLICH des laufenden. Der laufende Monat ist
    // unvollstaendig (LINA fuellt 5-6 Tage nach), aber die Frage dieser
    // Karte ist "welche Aktionen laufen", und eine Aktion, die gestern
    // Umsatz hatte, gehoert in die Liste — auch wenn ihr Monat erst zwei
    // Tage alt ist. "Letzter Monat" sagt dazu, wie frisch die Zahl ist.
    //
    // Der Anteil UNGEWICHTET als avg(anteil_pct): gewichtet nach Umsatz
    // bestimmten die grossen Haeuser den Schnitt, und die Frage "wie
    // stark haengt ein teilnehmender Betrieb an der Aktion" bekaeme die
    // Antwort auf eine andere Frage. Feinsparten 2025 steht so bei rund
    // 43 % — die Zahl aus dem Review.
    sql: `
SELECT a.aktion                       AS "Aktion",
       count(DISTINCT a.betrieb_key)  AS "Betriebe",
       sum(a.umsatz_netto)            AS "Umsatz",
       round(avg(a.anteil_pct), 1)    AS "Ø Anteil %",
       count(DISTINCT a.monat)        AS "Monate mit Umsatz",
       max(a.monat)                   AS "Letzter Monat"
  FROM mart.aktionsumsatz_monat a
 WHERE a.monat >= date_trunc('month', current_date)::date - interval '11 months'
   [[AND a.konzept = {{marke}}]]
   [[AND a.betrieb = {{betrieb}}]]
 GROUP BY a.aktion
 ORDER BY sum(a.umsatz_netto) DESC`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Ø Anteil %"]': { suffix: ' %' },
      },
    },
  },

  // -------------------------------------------------------------------
  // Verlauf — wann eine Aktion traegt
  // -------------------------------------------------------------------
  {
    schluessel: 'ak_verlauf',
    name: 'Aktionsumsatz je Monat',
    beschreibung:
      'Umsatz je Aktion und Monat über die letzten 24 Monate, eine Linie je Aktion. '
      + 'Man sieht, wann eine Aktion anläuft, trägt und ausläuft — der letzte Punkt ist der '
      + 'laufende, noch unvollständige Monat.\n\n'
      + '**Nur 34 Betriebe (überwiegend Enchilada) erfassen Aktionen** — die Kurven '
      + 'beschreiben diese Häuser, nicht die Gruppe.',
    anzeige: 'line',
    parameter: [MARKE, BETRIEB],
    // Kein Monatsfilter: ein Verlauf beantwortet "seit wann und wie
    // lange", und ein Stichmonat wuerde ihn auf einen Punkt eindampfen.
    // 24 Monate, damit die Jahresaktionen (Feinsparten 2025, Happy Hour)
    // einmal komplett zu sehen sind — bei 12 begaenne die groesste Aktion
    // mitten im Bild.
    sql: `
SELECT a.monat              AS "Monat",
       a.aktion             AS "Aktion",
       sum(a.umsatz_netto)  AS "Umsatz"
  FROM mart.aktionsumsatz_monat a
 WHERE a.monat >= date_trunc('month', current_date)::date - interval '23 months'
   [[AND a.konzept = {{marke}}]]
   [[AND a.betrieb = {{betrieb}}]]
 GROUP BY a.monat, a.aktion
 ORDER BY a.monat, a.aktion`,
    visualisierung: {
      'graph.dimensions': ['Monat', 'Aktion'],
      'graph.metrics': ['Umsatz'],
      'graph.y_axis.title_text': 'Aktionsumsatz netto (€)',
      'graph.x_axis.title_text': '',
    },
  },

  // -------------------------------------------------------------------
  // Betrieb x Aktion im Stichmonat
  // -------------------------------------------------------------------
  {
    schluessel: 'ak_betrieb',
    name: 'Aktionen je Betrieb im Monat',
    beschreibung:
      'Wer fährt welche Aktion im gewählten Monat — und wie viel des eigenen Geschäfts '
      + 'daran hängt. **Anteil %** ist der Anteil am Gesamtumsatz des Betriebs in diesem '
      + 'Monat; die höchsten Anteile stehen oben, denn die Abhängigkeit ist die Nachricht, '
      + 'nicht die Summe. Ein Klick auf den Namen öffnet den Betrieb.\n\n'
      + '**Nur 34 Betriebe (überwiegend Enchilada) erfassen Aktionen** — wer hier fehlt, '
      + 'fährt vielleicht dieselbe Aktion und bucht sie nur nicht.',
    anzeige: 'table',
    parameter: [MONAT, MARKE, BETRIEB],
    // Nach Anteil sortiert, nicht nach Umsatz: 4.000 € Happy Hour in
    // einem grossen Haus sind Beiwerk, 2 % sind es auch — aber ein Haus,
    // dessen Monat zu 40 % an einer Aktion haengt, hat eine andere Frage
    // zu beantworten, wenn die Aktion endet.
    sql: `${MONAT_CTE}
SELECT a.betrieb          AS "Betrieb",
       a.konzept          AS "Marke",
       a.aktion           AS "Aktion",
       a.umsatz_netto     AS "Umsatz",
       a.anteil_pct       AS "Anteil %",
       a.tage_mit_umsatz  AS "Tage mit Umsatz"
  FROM mart.aktionsumsatz_monat a
  CROSS JOIN gewaehlt g
 WHERE a.monat = g.monat
   [[AND a.konzept = {{marke}}]]
   [[AND a.betrieb = {{betrieb}}]]
 ORDER BY a.anteil_pct DESC NULLS LAST, a.umsatz_netto DESC`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Anteil %"]': { suffix: ' %' },
      },
    },
  },

  // -------------------------------------------------------------------
  // Steckbrief — geplant gegen tatsaechlich
  //
  // Die einzige Karte hier ohne Umsatzfrage. Sie beantwortet die
  // Verwaltungsfrage dahinter: welche Aktionen laufen STILL weiter
  // (unbefristet, seit Jahren), welche liefen nach ihrem geplanten Ende
  // noch, und welche haben nie einen Euro gesehen. Das sind die drei
  // Faelle, die im Umsatzbild unsichtbar bleiben — eine Aktion ohne
  // Umsatz hat dort schlicht keine Zeile.
  // -------------------------------------------------------------------
  {
    schluessel: 'ak_steckbrief',
    name: 'Aktionen — geplant und tatsächlich',
    beschreibung:
      'Alle in LINA angelegten Aktionen: geplante Gültigkeit gegen tatsächliche Laufzeit '
      + '(erster und letzter Tag mit Umsatz). „—" bei der Gültigkeit heißt unbefristet. '
      + '**Auffällig** markiert, was das Umsatzbild nicht zeigt: Aktionen, die nie Umsatz '
      + 'sahen, und unbefristete, die still weiterlaufen.\n\n'
      + '**Betriebe** zählt über die gesamte Historie — und nur die 34 Betriebe '
      + '(überwiegend Enchilada), die Aktionen überhaupt erfassen.',
    anzeige: 'table',
    parameter: [],
    // DD.MM.YYYY als Text, nicht als date-Spalte: die Gedankenstriche
    // fuer "unbefristet" brauchen eine Textspalte, und ein Datum neben
    // einem "—" soll gleich aussehen, nicht einmal "August 2, 2026" und
    // einmal Strich.
    //
    // Sortiert nach erstem Umsatztag, neueste zuerst, NULLS FIRST: die
    // Aktion, die nie lief, ist der dringendste Fall und steht oben.
    sql: `
SELECT a.aktion                                                  AS "Aktion",
       coalesce(to_char(a.gueltig_von, 'DD.MM.YYYY'), '—')       AS "Geplant von",
       coalesce(to_char(a.gueltig_bis, 'DD.MM.YYYY'), '—')       AS "Geplant bis",
       coalesce(to_char(a.erster_umsatztag, 'DD.MM.YYYY'), '—')  AS "Erster Umsatz",
       coalesce(to_char(a.letzter_umsatztag, 'DD.MM.YYYY'), '—') AS "Letzter Umsatz",
       coalesce(u.betriebe, 0)                                   AS "Betriebe",
       CASE
         WHEN a.erster_umsatztag IS NULL
              THEN 'nie Umsatz erfasst'
         WHEN a.gueltig_bis IS NULL
              AND a.letzter_umsatztag >= date_trunc('month', current_date)::date - interval '1 month'
              THEN 'unbefristet, läuft'
         WHEN a.gueltig_bis IS NOT NULL AND a.letzter_umsatztag > a.gueltig_bis
              THEN 'lief nach geplantem Ende weiter'
         ELSE ''
       END                                                       AS "Auffällig"
  FROM mart.aktion a
  LEFT JOIN (SELECT aktion_key, count(DISTINCT betrieb_key) AS betriebe
               FROM mart.aktionsumsatz_monat
              GROUP BY aktion_key) u USING (aktion_key)
 ORDER BY a.erster_umsatztag DESC NULLS FIRST`,
  },
]
