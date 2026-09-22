// =====================================================================
// Kasse — die Betriebsberichte aus LINA als Karten (Migration 0117).
//
// WOFUER. Bis zum 22.09.2026 war die Frage "Wie viele Stueck je Artikel
// liefen im August ueber die Gluecksrad-Finanzwege, je Betrieb?" nur per
// Auftrag beantwortbar. Diese Karten sind zugleich BI-Karte UND MCP-Bericht
// (bericht_ausfuehren) — eine Karte, die nur in der Metabase-Oberflaeche
// existiert, ist fuer den MCP-Zugang unsichtbar (plan-lina-vollabzug.md 6.3).
//
// DREI REGELN, DIE MAN DEN KARTEN NICHT ANSIEHT:
//
//   1. NUR mart. Der MCP-Zugang fuehrt jede Karte als mcp_leser aus, und die
//      Rolle sieht core nicht. Eine Karte auf core laeuft in Metabase und
//      scheitert im Chat mit "permission denied" (die Artikelaktion-Karten
//      aa_kopf … aa_liste_pruefung lesen core und laufen dort deshalb nicht).
//
//   2. DER ZEITRAUM ALS FALTBARER AUSDRUCK. Von/Bis stehen als coalesce(…)
//      direkt in der WHERE-Klausel, nie als Unterabfrage auf eine CTE —
//      dieselbe Messung wie in karten-artikelaktion.ts (8,4 s gegen 0,6 s):
//      nur ein Ausdruck, den der Planer zu einer Konstanten faltet, schneidet
//      die Monatspartitionen weg.
//
//   3. AKTIONEN UEBER aktion UND prozentsatz, NIE UEBER EINE NUMMER. Die
//      25-%-Stufe des Gluecksrads lief ueber zwei Finanzwege (3501 und 3168).
//      Der Filter "Nachlass" trifft den Aktionsnamen ohne Prozentzahl ODER
//      den vollen Finanzwegnamen.
//
// Der Rabattbericht zaehlt Artikel auf Bons mit Nachlass, nicht verkaufte
// Artikel — das steht in jeder Beschreibung, weil es die Stelle ist, an der
// eine richtige Zahl falsch gelesen wird.
// =====================================================================

import type { Karte } from './typen'
import { P_VON, P_BIS, P_MARKE, P_BETRIEB, P_FINANZWEG, P_ARTIKEL_TEXT } from './gemeinsam'

const VON = `coalesce([[ {{von}}::date, ]] date_trunc('month', current_date - interval '1 month')::date)`
const BIS = `coalesce([[ {{bis}}::date, ]] (date_trunc('month', current_date)::date - 1))`
/** Monatssichten: jeder Monat, der den Zeitraum beruehrt. */
const MONAT_VON = `date_trunc('month', ${VON})::date`

const EURO = { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 }
const EURO2 = { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 2 }
const PROZENT = { suffix: ' %' }

const P_ZEIT = [P_VON, P_BIS, P_MARKE, P_BETRIEB]
const P_NACHLASS = [P_FINANZWEG, P_VON, P_BIS, P_MARKE, P_BETRIEB]

/**
 * Die Tageszeilen des Rabattberichts im Zeitraum. Eine Zeile zaehlt, wenn ihr
 * ABRUFZEITRAUM ganz im gewaehlten Zeitraum liegt (im Betrieb ist er ein Tag;
 * ein Monatsabruf zaehlt fuer den ganzen Monat). geschaeftstag <= BIS steht
 * zusaetzlich da, damit Postgres nur die betroffenen Monate liest.
 */
const NACHLASS_WHERE = `
 WHERE n.geschaeftstag >= ${VON}
   AND n.geschaeftstag <= ${BIS}
   AND n.zeitraum_bis  <= ${BIS}
   [[AND (n.aktion = {{finanzweg}} OR n.finanzweg_name = {{finanzweg}})]]
   [[AND n.marke = {{marke}}]]
   [[AND n.betrieb = {{betrieb}}]]`

export const karten: Karte[] = [
  // -------------------------------------------------------------------
  // F1: die Gluecksrad-Frage je Betrieb
  // -------------------------------------------------------------------
  {
    schluessel: 'ka_nachlass_betrieb',
    name: 'Nachlass je Betrieb und Stufe',
    beschreibung:
      'Wie oft ein Nachlass im Zeitraum gewährt wurde, je Betrieb und Stufe (z. B. Glücksrad 10, 25 '
      + 'und 50 %). **Artikel auf Nachlass-Bons** zählt jeden Artikel auf einem Bon, auf den der '
      + 'Nachlass gebucht wurde — der Nachlass gilt für den ganzen Bon, auch für Getränke. Das ist '
      + 'nicht die Zahl der verkauften Artikel und nicht die Zahl der Nachlässe.\n\n'
      + '**Nachlass** ist der gewährte Betrag in Euro, brutto. Oben den Nachlass wählen (z. B. '
      + '„Glücksrad"), sonst stehen alle Nachlässe da. Stufen mit mehreren Kassentasten (Glücksrad '
      + '25 % hatte zwei) sind zusammengefasst.\n\n'
      + 'Ein Betrieb fehlt, wenn er im Zeitraum keinen solchen Nachlass hatte — oder wenn der '
      + 'Bericht für ihn noch nicht geladen ist (Karte „Welche Kassendaten geladen sind").',
    anzeige: 'table',
    parameter: P_NACHLASS,
    sql: `
SELECT n.betrieb                                   AS "Betrieb",
       n.marke                                     AS "Marke",
       n.aktion                                    AS "Nachlass",
       n.prozentsatz                               AS "Stufe %",
       sum(n.menge)                                AS "Artikel auf Nachlass-Bons",
       round(sum(n.nachlass_brutto), 2)            AS "Nachlass",
       count(DISTINCT n.geschaeftstag)             AS "Tage mit Nachlass",
       string_agg(DISTINCT n.finanzweg_name, ' | ') AS "Kassentasten"
  FROM mart.artikel_nachlass_tag n` + NACHLASS_WHERE + `
 GROUP BY n.betrieb, n.marke, n.aktion, n.prozentsatz
 ORDER BY n.marke, n.betrieb, n.aktion, n.prozentsatz`,
    visualisierung: {
      column_settings: {
        '["name","Nachlass"]': EURO2,
        '["name","Stufe %"]': PROZENT,
      },
    },
  },

  {
    schluessel: 'ka_nachlass_artikel',
    name: 'Nachlass je Artikel, Betrieb und Stufe',
    beschreibung:
      'Dieselbe Zählung wie „Nachlass je Betrieb und Stufe", aufgeteilt nach Artikel: wie viele '
      + 'Stück eines Artikels auf Bons mit diesem Nachlass standen — etwa wie viele „Durchstarter" '
      + 'mit 10, 25 und 50 % Glücksrad über die Theke gingen.\n\n'
      + 'Mit „Artikel enthält" lässt sich ein einzelner Artikel suchen. Die Artikelnamen kommen so '
      + 'aus der Kasse; die Artikelnummer steht da, wo der Name eindeutig einem verkauften Artikel '
      + 'zugeordnet werden konnte. Artikel auf Nachlass-Bons sind keine Verkaufsmenge.',
    anzeige: 'table',
    parameter: [...P_NACHLASS, P_ARTIKEL_TEXT],
    sql: `
SELECT n.betrieb                                   AS "Betrieb",
       n.artikel                                   AS "Artikel",
       max(n.artikelnummer)                        AS "Artikelnummer",
       n.aktion                                    AS "Nachlass",
       n.prozentsatz                               AS "Stufe %",
       sum(n.menge)                                AS "Stück auf Nachlass-Bons",
       round(sum(n.nachlass_brutto), 2)            AS "Nachlass"
  FROM mart.artikel_nachlass_tag n` + NACHLASS_WHERE + `
   [[AND n.artikel ILIKE '%' || {{artikeltext}} || '%']]
 GROUP BY n.betrieb, n.artikel, n.aktion, n.prozentsatz
 ORDER BY n.betrieb, sum(n.menge) DESC, n.artikel, n.prozentsatz`,
    visualisierung: {
      column_settings: {
        '["name","Nachlass"]': EURO2,
        '["name","Stufe %"]': PROZENT,
      },
    },
  },

  // -------------------------------------------------------------------
  // F2: was die Nachlaesse kosten — vollstaendig, aus 88/97
  // -------------------------------------------------------------------
  {
    schluessel: 'ka_nachlass_kosten',
    name: 'Was die Nachlässe kosten, je Betrieb und Monat',
    beschreibung:
      'Alle Nachlässe und Hausbons je Betrieb und Monat: wie oft sie gebucht wurden (**Vorgänge**), '
      + 'was sie gekostet haben (**Nachlass**, brutto) und welcher Anteil vom Bruttoumsatz des '
      + 'Betriebs das ist. Das ist die vollständige Summe aus dem Tagesabschluss der Kasse — sie ist '
      + 'etwas größer als die Summe über die Artikel, weil einzelne Nachlasszeilen keinen Artikel '
      + 'tragen.\n\n'
      + 'Ein Vorgang ist ein gebuchter Nachlass, nicht ein Artikel. Monate, für die der Bericht noch '
      + 'nicht geladen ist, fehlen — sie sind nicht null.',
    anzeige: 'table',
    parameter: P_NACHLASS,
    sql: `
SELECT n.monat                                     AS "Monat",
       n.betrieb                                   AS "Betrieb",
       n.marke                                     AS "Marke",
       n.finanzgruppe                              AS "Art",
       n.aktion                                    AS "Nachlass",
       n.prozentsatz                               AS "Stufe %",
       n.anzahl_vorgaenge                          AS "Vorgänge",
       round(n.nachlass_brutto, 2)                 AS "Nachlass",
       n.nachlass_anteil_pct                       AS "Anteil am Umsatz %",
       n.finanzwege                                AS "Kassentasten"
  FROM mart.nachlass_monat n
 WHERE n.monat BETWEEN ${MONAT_VON} AND ${BIS}
   [[AND (n.aktion = {{finanzweg}} OR n.finanzwege ILIKE '%' || {{finanzweg}} || '%')]]
   [[AND n.marke = {{marke}}]]
   [[AND n.betrieb = {{betrieb}}]]
 ORDER BY n.monat, n.betrieb, n.nachlass_brutto DESC`,
    visualisierung: {
      column_settings: {
        '["name","Nachlass"]': EURO2,
        '["name","Stufe %"]': PROZENT,
        '["name","Anteil am Umsatz %"]': PROZENT,
      },
    },
  },

  // -------------------------------------------------------------------
  // F3: Zahlarten
  // -------------------------------------------------------------------
  {
    schluessel: 'ka_zahlart_betrieb',
    name: 'Zahlarten je Betrieb',
    beschreibung:
      'Wie die Gäste bezahlt haben, je Betrieb im Zeitraum: Betrag und Anteil je Zahlart (Karte, '
      + 'bar, Lieferdienste, Gutscheine). Der Anteil bezieht sich auf alles, was Gäste bezahlt '
      + 'haben, einschließlich Trinkgeld.\n\n'
      + '**Trinkgeld** und **Rückgeld** stehen mit Minus da: sie stecken schon in den Beträgen der '
      + 'anderen Zahlarten. Zusammen ergeben alle Zeilen eines Betriebs seinen Bruttoumsatz.',
    anzeige: 'table',
    parameter: P_ZEIT,
    sql: `
SELECT z.betrieb                                   AS "Betrieb",
       z.marke                                     AS "Marke",
       z.zahlart                                   AS "Zahlart",
       z.finanzgruppe                              AS "Gruppe",
       round(sum(z.zahlbetrag), 2)                 AS "Betrag",
       sum(z.anzahl_vorgaenge)                     AS "Zahlungen",
       round(100 * sum(z.zahlbetrag) FILTER (WHERE z.zahlbetrag > 0)
             / nullif(sum(sum(z.zahlbetrag) FILTER (WHERE z.zahlbetrag > 0))
                      OVER (PARTITION BY z.betrieb), 0), 1) AS "Anteil %"
  FROM mart.zahlart_monat z
 WHERE z.monat BETWEEN ${MONAT_VON} AND ${BIS}
   [[AND z.marke = {{marke}}]]
   [[AND z.betrieb = {{betrieb}}]]
 GROUP BY z.betrieb, z.marke, z.zahlart, z.finanzgruppe
 ORDER BY z.betrieb, sum(z.zahlbetrag) DESC`,
    visualisierung: {
      column_settings: {
        '["name","Betrag"]': EURO,
        '["name","Anteil %"]': PROZENT,
      },
    },
  },

  {
    schluessel: 'ka_zahlart_verlauf',
    name: 'Zahlungsmix je Monat',
    beschreibung:
      'Bezahlte Beträge je Monat nach Gruppe: Karte (unbar), Bargeld, Gutscheine, Auslagen. So '
      + 'sieht man, ob der Barzahleranteil sinkt. Trinkgeld und Rückgeld sind herausgerechnet.',
    anzeige: 'bar',
    parameter: P_ZEIT,
    sql: `
SELECT z.monat                                     AS "Monat",
       z.finanzgruppe                              AS "Gruppe",
       round(sum(z.zahlbetrag))                    AS "Betrag"
  FROM mart.zahlart_monat z
 WHERE z.monat BETWEEN ${MONAT_VON} AND ${BIS}
   AND z.zahlbetrag > 0
   [[AND z.marke = {{marke}}]]
   [[AND z.betrieb = {{betrieb}}]]
 GROUP BY 1, 2
 ORDER BY 1, 2`,
    visualisierung: {
      'graph.dimensions': ['Monat', 'Gruppe'],
      'graph.metrics': ['Betrag'],
      'stackable.stack_type': 'stacked',
      'graph.x_axis.title_text': '',
      'graph.y_axis.title_text': 'Betrag (EUR)',
    },
  },

  // -------------------------------------------------------------------
  // F9: Bons
  // -------------------------------------------------------------------
  {
    schluessel: 'ka_bon_betrieb',
    name: 'Bonkennzahlen je Betrieb',
    beschreibung:
      'Wie viele Bons ein Betrieb im Zeitraum geschrieben hat, wie groß ein Bon im Schnitt war und '
      + 'wie oft Rechnungen per Gutschrift zurückgenommen wurden (**Gutschriften je 100 Rechnungen**). '
      + '**Geteilt bezahlt** ist der Anteil der Bons mit mehr als einer Zahlart.\n\n'
      + 'Das Rechnungsausgangsbuch kennt keine Uhrzeit und keine Nachlässe: „Bons mit Aktion" oder '
      + '„Durchschnittsbon mit und ohne Aktion" lassen sich daraus nicht bestimmen.',
    anzeige: 'table',
    parameter: P_ZEIT,
    sql: `
SELECT t.betrieb                                   AS "Betrieb",
       t.marke                                     AS "Marke",
       count(*)                                    AS "Tage",
       sum(t.bons)                                 AS "Bons",
       round(sum(t.bons)::numeric / nullif(count(*), 0))       AS "Bons je Tag",
       round(sum(t.bons_brutto) / nullif(sum(t.bons), 0), 2)   AS "Ø Bon",
       round(100.0 * sum(t.gutschriften) / nullif(sum(t.bons) + sum(t.stornierte_bons), 0), 2)
                                                   AS "Gutschriften je 100 Rechnungen",
       round(100.0 * sum(t.bons_geteilt_bezahlt) / nullif(sum(t.bons), 0), 1) AS "Geteilt bezahlt %",
       sum(t.debitor_bons)                         AS "Bons auf Rechnung"
  FROM mart.bon_tag t
 WHERE t.geschaeftstag >= ${VON}
   AND t.geschaeftstag <= ${BIS}
   [[AND t.marke = {{marke}}]]
   [[AND t.betrieb = {{betrieb}}]]
 GROUP BY t.betrieb, t.marke
 ORDER BY sum(t.bons) DESC`,
    visualisierung: {
      column_settings: {
        '["name","Ø Bon"]': EURO2,
        '["name","Geteilt bezahlt %"]': PROZENT,
      },
    },
  },

  {
    schluessel: 'ka_bon_tag',
    name: 'Bons und Ø Bon je Tag',
    beschreibung:
      'Die Zahl der Bons je Tag (Balken) und der durchschnittliche Bon (Linie) im Zeitraum. Ohne '
      + 'Betriebsfilter sind alle gewählten Betriebe zusammengezählt.',
    anzeige: 'combo',
    parameter: P_ZEIT,
    sql: `
SELECT t.geschaeftstag                             AS "Tag",
       sum(t.bons)                                 AS "Bons",
       round(sum(t.bons_brutto) / nullif(sum(t.bons), 0), 2) AS "Ø Bon"
  FROM mart.bon_tag t
 WHERE t.geschaeftstag >= ${VON}
   AND t.geschaeftstag <= ${BIS}
   [[AND t.marke = {{marke}}]]
   [[AND t.betrieb = {{betrieb}}]]
 GROUP BY 1
 ORDER BY 1`,
    visualisierung: {
      'graph.dimensions': ['Tag'],
      'graph.metrics': ['Bons', 'Ø Bon'],
      series_settings: { Bons: { display: 'bar' }, 'Ø Bon': { display: 'line', axis: 'right' } },
      'graph.x_axis.title_text': '',
    },
  },

  // -------------------------------------------------------------------
  // Storno mit Grund
  // -------------------------------------------------------------------
  {
    schluessel: 'ka_storno_grund',
    name: 'Storno nach Grund',
    beschreibung:
      'Was im Zeitraum storniert wurde, nach Stornotyp und Grund: Stück und Betrag (brutto, '
      + 'positiv), dazu die **Stornoquote** — storniertes Brutto je 100 Euro Bruttoumsatz. '
      + '**Sofortstorno** heißt: vor dem Bonieren zurückgenommen, **Storno**: danach.\n\n'
      + '„Keine Zuordnung" ist ein Storno ohne angegebenen Grund. Die Gründe beschreiben eher, wo '
      + 'Ware verloren geht, als warum ein Gast etwas zurückgibt.',
    anzeige: 'table',
    parameter: P_ZEIT,
    sql: `
WITH s AS (
    SELECT g.stornotyp, g.stornogrund, g.storno_menge, g.storno_brutto
      FROM mart.storno_grund_monat g
     WHERE g.monat BETWEEN ${MONAT_VON} AND ${BIS}
       [[AND g.marke = {{marke}}]]
       [[AND g.betrieb = {{betrieb}}]]
), u AS (
    -- Der Umsatz je Betrieb und Monat steht in jeder Grundzeile; einmal zaehlen.
    SELECT sum(x.umsatz) AS umsatz FROM (
        SELECT DISTINCT g.betrieb_key, g.monat, g.umsatz_brutto_monat AS umsatz
          FROM mart.storno_grund_monat g
         WHERE g.monat BETWEEN ${MONAT_VON} AND ${BIS}
           [[AND g.marke = {{marke}}]]
           [[AND g.betrieb = {{betrieb}}]]) x
)
SELECT s.stornotyp                                 AS "Typ",
       s.stornogrund                               AS "Grund",
       sum(s.storno_menge)                         AS "Stück",
       round(sum(s.storno_brutto), 2)              AS "Storniert",
       round(100 * sum(s.storno_brutto) / nullif((SELECT umsatz FROM u), 0), 2) AS "Stornoquote %"
  FROM s
 GROUP BY 1, 2
 ORDER BY sum(s.storno_brutto) DESC`,
    visualisierung: {
      column_settings: {
        '["name","Storniert"]': EURO2,
        '["name","Stornoquote %"]': PROZENT,
      },
    },
  },

  {
    schluessel: 'ka_storno_artikel',
    name: 'Meiststornierte Artikel',
    beschreibung:
      'Die Artikel mit dem meisten stornierten Betrag im Zeitraum, je Stornotyp und Grund. Ein '
      + 'Artikel, der oft sofort storniert wird, wird oft falsch boniert.',
    anzeige: 'table',
    parameter: P_ZEIT,
    sql: `
SELECT s.artikel                                   AS "Artikel",
       s.artikelnummer                             AS "Artikelnummer",
       s.stornotyp                                 AS "Typ",
       s.stornogrund                               AS "Grund",
       sum(s.storno_menge)                         AS "Stück",
       round(sum(s.storno_brutto), 2)              AS "Storniert",
       count(DISTINCT s.betrieb_key)               AS "Betriebe"
  FROM mart.storno_artikel_monat s
 WHERE s.monat BETWEEN ${MONAT_VON} AND ${BIS}
   [[AND s.marke = {{marke}}]]
   [[AND s.betrieb = {{betrieb}}]]
 GROUP BY 1, 2, 3, 4
 ORDER BY sum(s.storno_brutto) DESC
 LIMIT 200`,
    visualisierung: {
      column_settings: { '["name","Storniert"]': EURO2 },
    },
  },

  // -------------------------------------------------------------------
  // Kellner, Stellen, Zeitzonen
  // -------------------------------------------------------------------
  {
    schluessel: 'ka_kellner',
    name: 'Umsatz je Kellner',
    beschreibung:
      'Umsatz, Artikel, Trinkgeld und Gutschriften je Kellner und Monat. Die Kasse liefert keinen '
      + 'Namen, nur die **Kellnernummer** — sie gilt je Betrieb, dieselbe Nummer in zwei Betrieben '
      + 'ist nicht dieselbe Person.\n\n'
      + 'Die Summe über alle Kellner ist nicht der Umsatz des Betriebs: ein Bon kann mehreren '
      + 'Kellnern zugeschlagen sein. **Anteil** ist der Anteil am Umsatz aller Kellner des Betriebs.',
    anzeige: 'table',
    parameter: P_ZEIT,
    sql: `
SELECT k.monat                                     AS "Monat",
       k.betrieb                                   AS "Betrieb",
       k.kellner                                   AS "Kellner",
       round(k.kellner_umsatz_netto, 2)            AS "Umsatz netto",
       k.kellner_artikel                           AS "Artikel",
       round(k.trinkgeld, 2)                       AS "Trinkgeld",
       k.gutschriften                              AS "Gutschriften",
       k.kellner_anteil_pct                        AS "Anteil %"
  FROM mart.kellner_monat k
 WHERE k.monat BETWEEN ${MONAT_VON} AND ${BIS}
   [[AND k.marke = {{marke}}]]
   [[AND k.betrieb = {{betrieb}}]]
 ORDER BY k.monat, k.betrieb, k.kellner_umsatz_netto DESC`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz netto"]': EURO,
        '["name","Trinkgeld"]': EURO,
        '["name","Anteil %"]': PROZENT,
      },
    },
  },

  {
    schluessel: 'ka_stellen',
    name: 'Umsatz je Betriebsstelle und Verkaufsstelle',
    beschreibung:
      'Wo der Umsatz entsteht: je **Betriebsstelle** (Restaurant, Bar, Terrasse — die Namen vergibt '
      + 'jeder Betrieb selbst) und je **Verkaufsstelle** (im Haus, außer Haus). Beide Gliederungen '
      + 'teilen denselben Umsatz auf; innerhalb einer Gliederung ergeben die Zeilen den '
      + 'Nettoumsatz des Betriebs.',
    anzeige: 'table',
    parameter: P_ZEIT,
    sql: `
SELECT 'Betriebsstelle'                            AS "Gliederung",
       s.betrieb                                   AS "Betrieb",
       s.betriebsstelle                            AS "Stelle",
       round(sum(s.umsatz_netto), 2)               AS "Umsatz netto",
       sum(s.gaeste)                               AS "Gäste",
       round(sum(s.umsatz_netto) / nullif(sum(s.gaeste), 0), 2) AS "Netto je Gast"
  FROM mart.betriebsstelle_monat s
 WHERE s.monat BETWEEN ${MONAT_VON} AND ${BIS}
   [[AND s.marke = {{marke}}]]
   [[AND s.betrieb = {{betrieb}}]]
 GROUP BY 2, 3
UNION ALL
SELECT 'Verkaufsstelle', v.betrieb, v.verkaufsstelle,
       round(sum(v.umsatz_netto), 2), sum(v.gaeste),
       round(sum(v.umsatz_netto) / nullif(sum(v.gaeste), 0), 2)
  FROM mart.verkaufsstelle_monat v
 WHERE v.monat BETWEEN ${MONAT_VON} AND ${BIS}
   [[AND v.marke = {{marke}}]]
   [[AND v.betrieb = {{betrieb}}]]
 GROUP BY 2, 3
 ORDER BY 2, 1, 4 DESC`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz netto"]': EURO,
        '["name","Netto je Gast"]': EURO2,
      },
    },
  },

  {
    schluessel: 'ka_zeitzone_sparte',
    name: 'Umsatz je Zeitzone und Hauptsparte',
    beschreibung:
      'Wann welcher Umsatz entsteht: je vordefinierter Zeitzone der Kasse (z. B. 9–12 Uhr) und '
      + 'Hauptsparte, netto. Die Zeitzonen legt jeder Betrieb in der Kasse selbst fest.',
    anzeige: 'pivot',
    parameter: P_ZEIT,
    sql: `
SELECT z.zeitzone_beginn                           AS "Beginn",
       z.zeitzone                                  AS "Zeitzone",
       z.hauptsparte                               AS "Hauptsparte",
       round(sum(z.umsatz_netto))                  AS "Umsatz netto"
  FROM mart.zeitzone_hauptsparte_monat z
 WHERE z.monat BETWEEN ${MONAT_VON} AND ${BIS}
   [[AND z.marke = {{marke}}]]
   [[AND z.betrieb = {{betrieb}}]]
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3`,
    visualisierung: {
      'pivot_table.column_split': {
        rows: [['field', 'Zeitzone', { 'base-type': 'type/Text' }]],
        columns: [['field', 'Hauptsparte', { 'base-type': 'type/Text' }]],
        values: [['aggregation', 0]],
      },
    },
  },

  // -------------------------------------------------------------------
  // Regel 10 als Karte: was geladen ist
  // -------------------------------------------------------------------
  {
    schluessel: 'ka_ladestand',
    name: 'Welche Kassendaten geladen sind',
    beschreibung:
      'Je Bericht aus der Kasse: ab und bis wann er geladen ist. Die Kassendaten werden seit '
      + 'September 2026 Nacht für Nacht **rückwärts** nachgeladen — ein Monat, der hier noch nicht '
      + 'geladen ist, fehlt in allen Karten dieser Seite. Er ist dann **nicht null**, sondern '
      + 'unbekannt.\n\n'
      + '**Vollständig ab/bis** ist die jüngste lückenlose Strecke; **nicht geladen** zählt Monate '
      + 'mit Umsatz, für die der Bericht fehlt.',
    anzeige: 'table',
    parameter: [P_VON, P_BIS],
    sql: `
SELECT l.bericht                                   AS "Bericht",
       regexp_replace(l.bezeichnung, '^Betriebsbericht [0-9]+: ', '') AS "Inhalt",
       l.erster_monat                              AS "Geladen ab",
       l.letzter_monat                             AS "Geladen bis",
       l.vollstaendig_ab                           AS "Vollständig ab",
       l.vollstaendig_bis                          AS "Vollständig bis",
       l.monate_nicht_geladen                      AS "Monate nicht geladen",
       l.monate_teilweise                          AS "Monate teilweise",
       (SELECT count(*) FROM mart.betriebsbericht_ladestand_monat m
         WHERE m.endpunkt = l.endpunkt AND m.zustand IN ('nicht geladen', 'teilweise')
           AND m.monat BETWEEN ${MONAT_VON} AND ${BIS}) AS "Lücken im Zeitraum"
  FROM mart.betriebsbericht_ladestand l
 ORDER BY l.bericht`,
  },
]
