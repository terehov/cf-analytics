// =====================================================================
// Vergleichsgruppen: der Betrieb gegen seine Marke, der Betrieb gegen
// seine Stadt.
//
// Beide Seiten beantworten dieselbe Frage mit verschiedenem Massstab:
// LIEGT ES AM HAUS ODER AN ETWAS, DAS ALLE TRIFFT?
//
//   Marke — gleiches Konzept, gleiche Karte, gleiche Preise, verteilt
//           ueber ganz Deutschland. Faengt ab, was am Konzept liegt.
//   Stadt — gleiches Einzugsgebiet, gleiches Wetter, gleiche Feiertage,
//           verschiedene Konzepte. Faengt ab, was am Standort liegt.
//
// Deshalb zwei Seiten und nicht eine mit Umschalter: erst wer beide
// nebeneinander liest, kann die dritte Aussage treffen — faellt ein
// Betrieb gegenueber seiner Marke UND gegenueber seiner Stadt ab, liegt
// es am Betrieb.
//
// ---------------------------------------------------------------------
// EIN MUSTER, DAS SICH DURCH ALLE KARTEN ZIEHT: `bezug`
//
// Die Vergleichsgruppe wird aus dem GEWAEHLTEN BETRIEB abgeleitet, nicht
// von Hand eingestellt. Ein zweiter Filter "Marke" oder "Stadt" neben dem
// Betriebsfilter waere die naheliegende Alternative und ist die
// schlechtere: zwei Filter, die dieselbe Menge einschraenken, koennen
// einander widersprechen ("Betrieb = Aposto Mainz" und "Marke =
// Enchilada"), und das Ergebnis ist eine leere Seite ohne Fehlermeldung —
// nicht zu unterscheiden von einem Betrieb ohne Geschaeft.
//
// Zwei Auspraegungen, je nachdem was ohne Auswahl sinnvoll ist:
//
//   WHERE 1 = 1 [[AND betrieb = {{betrieb}}]]   -> ohne Auswahl ALLE
//   WHERE false [[OR  betrieb = {{betrieb}}]]   -> ohne Auswahl KEINE
//
// Die zweite steht in den Diagrammen: ohne Auswahl waeren dort 49 Linien
// uebereinander. Sie zeigen dann stattdessen die Gruppen selbst (Marken
// bzw. Staedte), und mit Auswahl die einzelnen Betriebe. Tabellen
// benutzen die erste und stehen ohne Auswahl vollstaendig da.
// =====================================================================

import type { Karte } from './typen'
import { MONAT_CTE, MONAT_CTE_UMSATZ, P_MONAT, P_BETRIEB } from './gemeinsam'

/**
 * Aus "besser"/"schlechter"/"gleich" wird ein Zeichen mit Wort.
 *
 * Das Wort allein waere zu leise, das Zeichen allein zweideutig: ein ▲
 * neben einer Personalquote heisst hier "besser", nicht "hoeher" — und
 * bei Personal und Wareneinsatz ist das gegenlaeufig. Beides zusammen
 * laesst sich nicht falsch lesen, auch nicht in einem CSV-Export.
 *
 * Die Richtung steckt bereits in der Sicht (mart.*_vergleich.vergleich),
 * abgeleitet aus ampel.regel. Hier wird nur beschriftet.
 */
const VERGLEICH = (spalte: string) => `
       CASE ${spalte} WHEN 'besser'     THEN '▲ besser'
                      WHEN 'schlechter' THEN '▼ schlechter'
                      WHEN 'gleich'     THEN '▬ gleich'
       END`

/**
 * "3 von 14" statt "3". Ein Rang ohne die Gruppengroesse ist keine
 * Aussage: Platz drei ist unter vierzehn gut und unter dreien der letzte.
 * Ohne Rang (stillgelegter Betrieb, fehlender Wert) ein Gedankenstrich —
 * eine leere Zelle liest sich als Datenfehler.
 */
const RANG = (rang: string, von: string) =>
  `coalesce(${rang}::text || ' von ' || ${von}::text, '—')`

/** Der Betrieb, auf den die Seite gerade zeigt. Ohne Auswahl markiert
 *  die Spalte niemanden — `false` bleibt stehen, wenn der Block faellt. */
const MARKIERUNG = `CASE WHEN false [[OR r.betrieb = {{betrieb}}]] THEN '◀' ELSE '' END`

export const karten: Karte[] = [
  // ===================================================================
  // AUF ③ BETRIEB — beide Maßstäbe neben den übrigen Kennzahlen
  //
  // Angefragt am 10.08.2026: "dass man automatisch gegen andere Betriebe
  // der Stadt performt, zusaetzlich zu den anderen Kennzahlen, und gegen
  // die Marke im Durchschnitt -- alles auf einem Dashboard".
  //
  // Die beiden Karten hier sind die VERDICHTETE Fassung von ⑨ und ⑩:
  // beide Maßstaebe nebeneinander in einer Tabelle, statt auf zwei
  // Seiten. Sie ersetzen die Detailseiten nicht -- dort stehen die
  // Nachbarhaeuser einzeln --, aber sie beantworten die Frage, wegen der
  // man sie sonst aufgemacht haette, ohne das Betriebsblatt zu verlassen.
  //
  // WARUM NICHT IN dd_betrieb_kopf HINEIN: die Karte fuehrt bereits neun
  // Spalten (Wert, Vormonat, Veraenderung, Trend, Ampelwechsel, Ursache).
  // Vier weitere ergaeben dreizehn, und wer waagerecht scrollen muss, um
  // die dritte Spalte zu sehen, vergleicht sie nicht mehr mit der ersten
  // -- genau dafuer ist eine Tabelle aber da. Zwei Karten untereinander,
  // in DERSELBEN Zeilenreihenfolge: oben "wie hat es sich entwickelt",
  // darunter "wie steht es gegen die anderen".
  // ===================================================================
  {
    schluessel: 'dd_betrieb_vergleich',
    name: 'Betrieb — gegen Marke und Stadt',
    beschreibung:
      'Dieselben sechs Kennzahlen wie darüber, aber gegen zwei Maßstäbe: den mittleren Betrieb der **eigenen Marke** und den mittleren Betrieb der **eigenen Stadt**. Die Marke fängt ab, was am Konzept liegt, die Stadt das, was am Standort liegt — Wetter, Baustellen, Feiertage. Steht ein Betrieb gegen beide schlecht da, liegt es am Betrieb.\n\n**Der Rang ist die Aussage, nicht der Abstand.** „16 von 17“ ist eindeutig; ein Abstand von +5,8 wäre es nicht, denn bei Personal und Wareneinsatz ist weniger besser.\n\nDie Stadtspalten bleiben leer, wenn für den Betrieb kein Ort hinterlegt ist oder er dort allein steht.\n\n**Die vier Vergleichsspalten sind anklickbar.** „Marke (Median)“ und „Rang Marke“ öffnen alle Betriebe der Marke, „Stadt (Median)“ und „Rang Stadt“ alle Betriebe am Ort — Betrieb und Monat wandern mit. Die übrigen Spalten führen bewusst nirgendwohin: sie beschreiben dieser Betrieb, nicht eine Vergleichsgruppe.',
    anzeige: 'table',
    parameter: [P_MONAT, P_BETRIEB],
    sql: `${MONAT_CTE}
SELECT m.betrieb                                  AS "Betrieb",
       m.bereich_name                             AS "Kennzahl",
       coalesce(m.emoji, '⚪')                     AS "●",
       m.wert                                     AS "Wert",
       m.marke_median                             AS "Marke (Median)",
       ${RANG('m.rang', 'm.marke_haeuser')}       AS "Rang Marke",
       s.ort_median                               AS "Stadt (Median)",
       ${RANG('s.rang', 's.ort_haeuser')}         AS "Rang Stadt"
  FROM mart.marke_vergleich m
  CROSS JOIN gewaehlt g
  -- LEFT JOIN, nicht JOIN: sieben laufende Betriebe haben keine
  -- Ortsangabe, und fuer die muss die Zeile trotzdem stehen -- mit
  -- leeren Stadtspalten. Ein INNER JOIN liesse sie ganz verschwinden,
  -- und die Seite saehe aus, als gaebe es die Kennzahl nicht.
  LEFT JOIN mart.stadt_vergleich s ON s.betrieb_key = m.betrieb_key
                                  AND s.monat       = m.monat
                                  AND s.bereich     = m.bereich
 WHERE m.monat = g.monat
   AND m.wert IS NOT NULL
   AND (m.operativ [[ OR m.betrieb = {{betrieb}} ]])
   [[AND m.betrieb = {{betrieb}}]]
 ORDER BY m.betrieb, m.reihenfolge`,
  },
  {
    schluessel: 'dd_betrieb_vergleich_verlauf',
    name: 'Betrieb — Umsatzentwicklung gegen Marke und Stadt',
    beschreibung:
      'Die Umsatzveränderung gegenüber dem jeweiligen Vorjahresmonat über zwei Jahre: dieser Betrieb, seine Marke und seine Stadt in einem Bild. Laufen alle drei Linien gemeinsam nach unten, ist der Rückgang keine Aussage über dieser Betrieb.\n\nOhne gewählten Betrieb stehen hier die Marken — drei Linien je Betrieb wären bei 56 Betrieben keine Kurve mehr.',
    anzeige: 'line',
    parameter: [P_MONAT, P_BETRIEB],
    // Festes 24-Monats-Fenster am Monatsfilter statt des Zeitraumfilters
    // der Seite: die Karte liest DREI Tabellen (Betrieb, Marke, Stadt), und
    // ein Metabase-Feldfilter baut seine Klausel aus dem Tabellennamen --
    // er koennte nur einen der drei Aeste einschraenken und die Linien
    // waeren still verschieden lang. Zwei Jahre, weil ein
    // Vorjahresvergleich mindestens einen vollen Saisonzyklus braucht.
    sql: `${MONAT_CTE_UMSATZ}
, bezug AS (
    SELECT DISTINCT y.betrieb,
           coalesce(y.konzept, '(nicht zugeordnet)') AS konzept,
           n.ort
      FROM mart.umsatz_ytd y
      LEFT JOIN mart.nachbarschaft n ON n.betrieb_key = y.betrieb_key
     WHERE false [[OR y.betrieb = {{betrieb}}]]
)
SELECT x."Monat", x."Reihe", x."Umsatz % ggü. Vorjahr"
  FROM (
        SELECT y.monat                              AS "Monat",
               y.betrieb                            AS "Reihe",
               y.umsatz_pct                         AS "Umsatz % ggü. Vorjahr",
               1                                    AS sortierung
          FROM mart.umsatz_ytd y
          CROSS JOIN gewaehlt g
         WHERE y.monat >  (g.monat - INTERVAL '24 months')
           AND y.monat <=  g.monat
           AND y.betrieb IN (SELECT betrieb FROM bezug)
        UNION ALL
        SELECT k.monat,
               coalesce(k.konzept, '(nicht zugeordnet)') || ' — Marke (Median)',
               k.umsatz_pct,
               2
          FROM mart.konzept_schnitt_monat k
          CROSS JOIN gewaehlt g
         WHERE k.monat >  (g.monat - INTERVAL '24 months')
           AND k.monat <=  g.monat
           AND (coalesce(k.konzept, '(nicht zugeordnet)') IN (SELECT konzept FROM bezug)
                OR NOT EXISTS (SELECT 1 FROM bezug))
        UNION ALL
        SELECT s.monat,
               s.ort || ' — Stadt (Median)',
               s.umsatz_pct,
               3
          FROM mart.stadt_schnitt_monat s
          CROSS JOIN gewaehlt g
         WHERE s.monat >  (g.monat - INTERVAL '24 months')
           AND s.monat <=  g.monat
           AND s.ort IN (SELECT ort FROM bezug)
  ) x
 ORDER BY x.sortierung, x."Monat"`,
    visualisierung: {
      'graph.dimensions': ['Monat', 'Reihe'],
      'graph.metrics': ['Umsatz % ggü. Vorjahr'],
      'graph.y_axis.title_text': '% gegenüber Vorjahresmonat',
    },
  },

  // ===================================================================
  // ⑨ BETRIEB GEGEN MARKE
  // ===================================================================
  {
    schluessel: 'vm_kopf',
    name: 'Der Betrieb und seine Marke',
    beschreibung:
      'Die Kopfzeile des Vergleichs: wie sich der Umsatz des Betriebs gegenüber dem Vorjahr entwickelt hat, wie sich die Marke im selben Monat entwickelt hat, und der Abstand dazwischen. Ohne Auswahl oben stehen hier alle Betriebe, die am weitesten unter ihrer eigenen Marke liegen, zuerst.\n\nDer Markenwert ist der mittlere Betrieb der Marke, nicht der Mittelwert — ein einzelner Ausreißer verzieht so nicht den Maßstab. Betriebe ohne laufenden Umsatz zählen im Maßstab nicht mit.',
    anzeige: 'table',
    parameter: [P_MONAT, P_BETRIEB],
    sql: `${MONAT_CTE}
SELECT v.betrieb                                  AS "Betrieb",
       coalesce(v.konzept, '(nicht zugeordnet)')  AS "Marke",
       round(r.umsatz_ist, 0)                     AS "Umsatz",
       v.wert                                     AS "Umsatz % ggü. Vorjahr",
       v.marke_median                             AS "Marke % (Median)",
       v.abweichung                               AS "Δ zur Marke",
       ${VERGLEICH('v.vergleich')}                AS "Stellung",
       ${RANG('v.rang', 'v.marke_haeuser')}       AS "Rang in der Marke",
       coalesce(be.emoji, '⚪')                    AS "Gesamtampel"
  FROM mart.marke_vergleich v
  CROSS JOIN gewaehlt g
  JOIN mart.round_table_monat r     ON r.betrieb_key = v.betrieb_key
                                   AND r.monat       = v.monat
  LEFT JOIN ampel.beschriftung be   ON be.status     = r.gesamt
 WHERE v.monat = g.monat
   AND v.bereich = 'umsatz'
   AND (v.operativ [[ OR v.betrieb = {{betrieb}} ]])
   [[AND v.betrieb = {{betrieb}}]]
 ORDER BY v.abweichung NULLS LAST`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Umsatz % ggü. Vorjahr"]': { suffix: ' %' },
        '["name","Marke % (Median)"]': { suffix: ' %' },
        '["name","Δ zur Marke"]': { suffix: ' pp' },
      },
    },
  },
  {
    schluessel: 'vm_kennzahlen',
    name: 'Alle Kennzahlen gegen die Marke',
    beschreibung:
      'Jede der sechs bewerteten Kennzahlen gegen den Schnitt der eigenen Marke. „Stellung“ sagt besser oder schlechter — nicht höher oder niedriger: bei Personal und Wareneinsatz ist weniger besser, ein Vorzeichen allein wäre hier zweideutig.\n\nDer Abstand steht in Prozentpunkten, bei der Online-Bewertung in Sternen. Der Rang zählt nur Betriebe mit laufendem Umsatz. Kennzahlen, für die der Betrieb keinen Wert hat, stehen nicht in der Liste — vergleichen ließe sich daran nichts.',
    anzeige: 'table',
    parameter: [P_MONAT, P_BETRIEB],
    sql: `${MONAT_CTE}
SELECT v.bereich_name                             AS "Kennzahl",
       v.betrieb                                  AS "Betrieb",
       coalesce(v.konzept, '(nicht zugeordnet)')  AS "Marke",
       v.wert                                     AS "Wert",
       coalesce(v.emoji, '⚪')                     AS "●",
       v.marke_median                             AS "Marke (Median)",
       v.abweichung                               AS "Δ",
       ${VERGLEICH('v.vergleich')}                AS "Stellung",
       ${RANG('v.rang', 'v.marke_haeuser')}       AS "Rang in der Marke"
  FROM mart.marke_vergleich v
  CROSS JOIN gewaehlt g
 WHERE v.monat = g.monat
   AND v.wert IS NOT NULL
   AND (v.operativ [[ OR v.betrieb = {{betrieb}} ]])
   [[AND v.betrieb = {{betrieb}}]]
 ORDER BY v.reihenfolge, v.abweichung NULLS LAST`,
  },
  {
    schluessel: 'vm_verlauf',
    name: 'Umsatzentwicklung: Betrieb gegen Marke',
    beschreibung:
      'Die Umsatzveränderung gegenüber dem jeweiligen Vorjahresmonat, über die letzten zwei Jahre bis zum gewählten Monat. Läuft die Markenlinie mit nach unten, ist es kein Problem dieses Betriebs.\n\nOhne Auswahl oben stehen hier die Marken selbst — 22 Betriebe gleichzeitig wären keine lesbare Kurve.',
    anzeige: 'line',
    parameter: [P_MONAT, P_BETRIEB],
    // Zwei Jahre statt der ganzen Historie, und das Fenster haengt am
    // Monatsfilter. Sonst braeuchte die Karte einen zweiten Zeitfilter --
    // und der koennte hier gar nicht wirken: ein Metabase-Feldfilter baut
    // seine Klausel aus dem TABELLENNAMEN, und diese Karte liest zwei
    // verschiedene Tabellen (Betrieb und Marke). Er wuerde nur einen der
    // beiden Aeste einschraenken, und die Linien haetten still
    // verschiedene Laengen.
    sql: `${MONAT_CTE_UMSATZ}
, bezug AS (
    SELECT DISTINCT y.betrieb,
           coalesce(y.konzept, '(nicht zugeordnet)') AS konzept
      FROM mart.umsatz_ytd y
     WHERE false [[OR y.betrieb = {{betrieb}}]]
)
SELECT x."Monat", x."Reihe", x."Umsatz % ggü. Vorjahr"
  FROM (
        SELECT y.monat                              AS "Monat",
               y.betrieb                            AS "Reihe",
               y.umsatz_pct                         AS "Umsatz % ggü. Vorjahr",
               1                                    AS sortierung
          FROM mart.umsatz_ytd y
          CROSS JOIN gewaehlt g
         WHERE y.monat >  (g.monat - INTERVAL '24 months')
           AND y.monat <=  g.monat
           AND y.betrieb IN (SELECT betrieb FROM bezug)
        UNION ALL
        SELECT k.monat,
               coalesce(k.konzept, '(nicht zugeordnet)') || ' — Marke (Median)',
               k.umsatz_pct,
               2
          FROM mart.konzept_schnitt_monat k
          CROSS JOIN gewaehlt g
         WHERE k.monat >  (g.monat - INTERVAL '24 months')
           AND k.monat <=  g.monat
           AND (coalesce(k.konzept, '(nicht zugeordnet)') IN (SELECT konzept FROM bezug)
                OR NOT EXISTS (SELECT 1 FROM bezug))
  ) x
 ORDER BY x.sortierung, x."Monat"`,
    visualisierung: {
      'graph.dimensions': ['Monat', 'Reihe'],
      'graph.metrics': ['Umsatz % ggü. Vorjahr'],
      'graph.y_axis.title_text': '% gegenüber Vorjahresmonat',
    },
  },
  {
    schluessel: 'vm_haeuser',
    name: 'Alle Betriebe der Marke',
    beschreibung:
      'Die Betriebe derselben Marke im gewählten Monat, der stärkste zuerst. Zeigt auf einen Blick, ob ein Rückgang die ganze Marke betrifft oder ein einzelner Betrieb. Ein ◀ markiert den oben gewählten Betrieb.\n\nBetriebe ohne laufenden Umsatz stehen nicht in der Liste — sie würden mit −100 % jede Zeile daneben verzerren.',
    anzeige: 'table',
    parameter: [P_MONAT, P_BETRIEB],
    sql: `${MONAT_CTE}
, bezug AS (
    SELECT DISTINCT coalesce(r.konzept, '(nicht zugeordnet)') AS konzept
      FROM mart.round_table_monat r
      CROSS JOIN gewaehlt g
     WHERE r.monat = g.monat
       [[AND r.betrieb = {{betrieb}}]]
)
SELECT ${MARKIERUNG}                              AS "◀",
       coalesce(r.konzept, '(nicht zugeordnet)')  AS "Marke",
       r.betrieb                                  AS "Betrieb",
       round(r.umsatz_ist, 0)                     AS "Umsatz",
       r.umsatz_pct                               AS "Umsatz % ggü. Vorjahr",
       r.personalkosten_ogf_pct                   AS "Personal o. GF %",
       r.we_bar_pct                               AS "WE Bar %",
       r.we_kueche_pct                            AS "WE Küche %",
       coalesce(be.emoji, '⚪')                    AS "Gesamt"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
  LEFT JOIN ampel.beschriftung be ON be.status = r.gesamt
 WHERE r.monat = g.monat
   AND r.operativ
   AND coalesce(r.konzept, '(nicht zugeordnet)') IN (SELECT konzept FROM bezug)
 ORDER BY coalesce(r.konzept, '(nicht zugeordnet)'), r.umsatz_ist DESC NULLS LAST`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Umsatz % ggü. Vorjahr"]': { suffix: ' %' },
        '["name","Personal o. GF %"]': { suffix: ' %' },
        '["name","WE Bar %"]': { suffix: ' %' },
        '["name","WE Küche %"]': { suffix: ' %' },
      },
    },
  },

  // ===================================================================
  // ⑩ BETRIEB GEGEN DIE STADT
  //
  // Die Karten hier zeigen bewusst die VERAENDERUNG in den Vordergrund
  // und die absoluten Quoten dahinter. Die Betriebe einer Stadt gehoeren
  // verschiedenen Marken -- in Karlsruhe stehen Aposto, Enchilada,
  // Lehners und Wilma Wunder nebeneinander. Eine Personalquote von 45
  // gegen 40 Prozent ist zwischen zwei Konzepten keine Aussage; die
  // Veraenderung gegenueber dem Vorjahr ist eine, denn die traegt jedes
  // Betrieb in seiner eigenen Einheit.
  // ===================================================================
  {
    schluessel: 'vs_kopf',
    name: 'Der Betrieb und seine Stadt',
    beschreibung:
      'Wo der Betrieb steht, wie viele Betriebe der Gruppe dort sonst noch stehen und wie sich die Stadt insgesamt entwickelt hat. Steht hier „(keine Stadt hinterlegt)“, bleiben die Karten darunter leer — der Betrieb fehlt dann in der Standortliste, und wer noch fehlt, steht ganz unten auf dieser Seite.\n\n„Betriebe mit Umsatz“ sind die, die im gewählten Monat Geschäft gemacht haben; „geführt“ zählt auch stillgelegte mit.',
    anzeige: 'table',
    parameter: [P_MONAT, P_BETRIEB],
    // Bewusst OHNE den operativ-Filter und mit LEFT JOIN auf die
    // Nachbarschaft: wer ein stillgelegter Betrieb oder eines ohne
    // Ortsangabe waehlt, muss eine Zeile bekommen, die das sagt. Eine
    // leere Seite liest sich als "keine Daten", nicht als "kein
    // Standort hinterlegt" -- und das ist der teurere der beiden
    // Irrtuemer, weil er nach einem Fehler aussieht.
    sql: `${MONAT_CTE}
SELECT r.betrieb                                              AS "Betrieb",
       coalesce(r.konzept, '(nicht zugeordnet)')              AS "Marke",
       coalesce(n.ort, '(keine Stadt hinterlegt)')            AS "Stadt",
       coalesce(s.haeuser, 0)                                 AS "Betriebe mit Umsatz",
       coalesce(n.haeuser_am_ort, 0)                          AS "davon geführt",
       s.marken_namen                                         AS "Marken am Ort",
       round(r.umsatz_ist, 0)                                 AS "Umsatz",
       r.umsatz_pct                                           AS "Umsatz % ggü. Vorjahr",
       s.umsatz_pct                                           AS "Stadt % (Median)",
       r.status                                               AS "Zustand"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
  LEFT JOIN mart.nachbarschaft n         ON n.betrieb_key = r.betrieb_key
  LEFT JOIN mart.stadt_schnitt_monat s   ON s.monat       = r.monat
                                        AND s.ort         = n.ort
 WHERE r.monat = g.monat
   AND (r.operativ [[ OR r.betrieb = {{betrieb}} ]])
   [[AND r.betrieb = {{betrieb}}]]
 ORDER BY coalesce(n.haeuser_am_ort, 0) DESC, n.ort NULLS LAST, r.umsatz_ist DESC NULLS LAST`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Umsatz % ggü. Vorjahr"]': { suffix: ' %' },
        '["name","Stadt % (Median)"]': { suffix: ' %' },
      },
    },
  },
  {
    schluessel: 'vs_umsatz_pct',
    name: 'Umsatzveränderung der Nachbarbetriebe',
    beschreibung:
      'Die Umsatzveränderung gegenüber dem Vorjahresmonat, ein Balken je Betrieb der Stadt. Die Karte, wegen der es diese Seite gibt: zeigen alle Balken nach unten, war es die Stadt — steht einer allein im Minus, war es der Betrieb.\n\nOhne Auswahl oben stehen hier die Städte selbst, jede als mittlerer Betrieb.',
    anzeige: 'row',
    parameter: [P_MONAT, P_BETRIEB],
    sql: `${MONAT_CTE}
, bezug AS (
    SELECT DISTINCT ort FROM mart.nachbarschaft
     WHERE false [[OR betrieb = {{betrieb}}]]
)
SELECT x."Betrieb", x."Umsatz % ggü. Vorjahr"
  FROM (
        SELECT CASE WHEN false [[OR r.betrieb = {{betrieb}}]] THEN '◀ ' ELSE '' END
                 || r.betrieb                     AS "Betrieb",
               r.umsatz_pct                       AS "Umsatz % ggü. Vorjahr"
          FROM mart.round_table_monat r
          CROSS JOIN gewaehlt g
          JOIN mart.nachbarschaft n ON n.betrieb_key = r.betrieb_key
         WHERE r.monat = g.monat
           AND r.operativ
           AND n.ort IN (SELECT ort FROM bezug)
        UNION ALL
        SELECT s.ort || ' (' || s.haeuser::text || ' Betriebe)',
               s.umsatz_pct
          FROM mart.stadt_schnitt_monat s
          CROSS JOIN gewaehlt g
         WHERE s.monat = g.monat
           AND NOT EXISTS (SELECT 1 FROM bezug)
  ) x
 ORDER BY x."Umsatz % ggü. Vorjahr" DESC NULLS LAST`,
    visualisierung: {
      'graph.dimensions': ['Betrieb'],
      'graph.metrics': ['Umsatz % ggü. Vorjahr'],
      'graph.x_axis.title_text': '% gegenüber Vorjahresmonat',
      'graph.show_values': true,
    },
  },
  {
    schluessel: 'vs_haeuser',
    name: 'Die Betriebe der Stadt nebeneinander',
    beschreibung:
      'Alle Betriebe am selben Ort mit ihren Kennzahlen. Ein ◀ markiert den oben gewählten Betrieb; ohne Auswahl stehen hier alle Städte mit mehr als einem Betrieb.\n\nDie **Veränderung** ist zwischen den Betrieben vergleichbar, die **absoluten Quoten** nur bedingt: die Betriebe gehören verschiedenen Marken mit verschiedenen Karten, Preisen und Personalstrukturen. Für den Vergleich innerhalb einer Marke ist die Seite „⑨ Betrieb gegen Marke“ da.',
    anzeige: 'table',
    parameter: [P_MONAT, P_BETRIEB],
    sql: `${MONAT_CTE}
, bezug AS (
    SELECT DISTINCT ort FROM mart.nachbarschaft
     WHERE 1 = 1 [[AND betrieb = {{betrieb}}]]
)
SELECT ${MARKIERUNG}                              AS "◀",
       n.ort                                      AS "Stadt",
       r.betrieb                                  AS "Betrieb",
       coalesce(r.konzept, '(nicht zugeordnet)')  AS "Marke",
       round(r.umsatz_ist, 0)                     AS "Umsatz",
       r.umsatz_pct                               AS "Umsatz % ggü. Vorjahr",
       r.personalkosten_ogf_pct                   AS "Personal o. GF %",
       r.we_bar_pct                               AS "WE Bar %",
       r.we_kueche_pct                            AS "WE Küche %",
       coalesce(be.emoji, '⚪')                    AS "Gesamt"
  FROM mart.round_table_monat r
  CROSS JOIN gewaehlt g
  JOIN mart.nachbarschaft n       ON n.betrieb_key = r.betrieb_key
  LEFT JOIN ampel.beschriftung be ON be.status     = r.gesamt
 WHERE r.monat = g.monat
   AND r.operativ
   AND n.haeuser_am_ort > 1
   AND n.ort IN (SELECT ort FROM bezug)
 ORDER BY n.ort, r.umsatz_ist DESC NULLS LAST`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
        '["name","Umsatz % ggü. Vorjahr"]': { suffix: ' %' },
        '["name","Personal o. GF %"]': { suffix: ' %' },
        '["name","WE Bar %"]': { suffix: ' %' },
        '["name","WE Küche %"]': { suffix: ' %' },
      },
    },
  },
  {
    schluessel: 'vs_verlauf',
    name: 'Umsatzentwicklung der Nachbarbetriebe',
    beschreibung:
      'Dieselbe Frage über die Zeit: die Umsatzveränderung gegenüber dem jeweiligen Vorjahresmonat, eine Linie je Betrieb der Stadt, zwei Jahre bis zum gewählten Monat. Ein gemeinsamer Knick ist ein Stadtereignis — eine Baustelle, ein Umbau am Platz, eine ausgefallene Veranstaltung. Ein einzelner ist ein Betriebsereignis.\n\nOhne Auswahl oben stehen hier die Städte selbst.',
    anzeige: 'line',
    parameter: [P_MONAT, P_BETRIEB],
    sql: `${MONAT_CTE_UMSATZ}
, bezug AS (
    SELECT DISTINCT ort FROM mart.nachbarschaft
     WHERE false [[OR betrieb = {{betrieb}}]]
)
SELECT x."Monat", x."Betrieb", x."Umsatz % ggü. Vorjahr"
  FROM (
        SELECT y.monat                            AS "Monat",
               y.betrieb                          AS "Betrieb",
               y.umsatz_pct                       AS "Umsatz % ggü. Vorjahr",
               1                                  AS sortierung
          FROM mart.umsatz_ytd y
          CROSS JOIN gewaehlt g
          JOIN mart.nachbarschaft n ON n.betrieb_key = y.betrieb_key
         WHERE y.monat >  (g.monat - INTERVAL '24 months')
           AND y.monat <=  g.monat
           AND n.ort IN (SELECT ort FROM bezug)
        UNION ALL
        SELECT s.monat,
               s.ort || ' — Stadt (Median)',
               s.umsatz_pct,
               2
          FROM mart.stadt_schnitt_monat s
          CROSS JOIN gewaehlt g
         WHERE s.monat >  (g.monat - INTERVAL '24 months')
           AND s.monat <=  g.monat
           AND NOT EXISTS (SELECT 1 FROM bezug)
  ) x
 ORDER BY x.sortierung, x."Monat"`,
    visualisierung: {
      'graph.dimensions': ['Monat', 'Betrieb'],
      'graph.metrics': ['Umsatz % ggü. Vorjahr'],
      'graph.y_axis.title_text': '% gegenüber Vorjahresmonat',
    },
  },
  {
    schluessel: 'vs_kennzahlen',
    name: 'Alle Kennzahlen gegen die Stadt',
    beschreibung:
      'Jede der sechs bewerteten Kennzahlen gegen den mittleren Wert der eigenen Stadt. „Stellung“ sagt besser oder schlechter, nicht höher oder niedriger.\n\n**Bei den Quoten mit Vorsicht zu lesen** — die Betriebe einer Stadt gehören verschiedenen Marken, und ein Wareneinsatz von 24 % ist zwischen einem mexikanischen und einem bürgerlichen Konzept keine gemeinsame Messlatte. Belastbar ist die Zeile „Umsatz“: sie misst die Veränderung, die jeder Betrieb in seiner eigenen Einheit trägt.\n\nBleiben Vergleichswert und Rang leer, hat am Ort kein zweiter Betrieb diese Kennzahl erfasst. Kennzahlen, für die der Betrieb selbst keinen Wert hat, stehen nicht in der Liste.',
    anzeige: 'table',
    parameter: [P_MONAT, P_BETRIEB],
    sql: `${MONAT_CTE}
SELECT v.bereich_name                             AS "Kennzahl",
       v.ort                                      AS "Stadt",
       v.betrieb                                  AS "Betrieb",
       coalesce(v.konzept, '(nicht zugeordnet)')  AS "Marke",
       v.wert                                     AS "Wert",
       coalesce(v.emoji, '⚪')                     AS "●",
       v.ort_median                               AS "Stadt (Median)",
       v.abweichung                               AS "Δ",
       ${VERGLEICH('v.vergleich')}                AS "Stellung",
       ${RANG('v.rang', 'v.ort_haeuser')}         AS "Rang am Ort"
  FROM mart.stadt_vergleich v
  CROSS JOIN gewaehlt g
 WHERE v.monat = g.monat
   AND v.wert IS NOT NULL
   -- haeuser_am_ort und NICHT ort_haeuser: die Frage ist "gibt es an
   -- diesem Ort ueberhaupt ein zweiter Betrieb", nicht "hat das zweite Betrieb
   -- auch diese Kennzahl". Filterte man nach ort_haeuser, verschwaende
   -- genau die Zeile, deren Nachbar den Wert nicht erfasst hat -- und das
   -- liest sich als fehlende Kennzahl im eigenen Betrieb.
   AND v.haeuser_am_ort > 1
   AND (v.operativ [[ OR v.betrieb = {{betrieb}} ]])
   [[AND v.betrieb = {{betrieb}}]]
 ORDER BY v.ort, v.reihenfolge, v.abweichung NULLS LAST`,
  },
  {
    schluessel: 'vs_fehlend',
    name: 'Wer im Stadtvergleich fehlt',
    beschreibung:
      'Betriebe ohne hinterlegten Ort. Sie tauchen in keiner Stadt auf — auch nicht in einer, in der sie tatsächlich stehen. Solange hier ein Betrieb mit laufendem Umsatz steht, ist mindestens eine Vergleichsgruppe unvollständig, ohne dass es dort auffiele.\n\nDie Ortsangaben werden von Hand gepflegt; das Kassensystem liefert für Betriebe keine Adresse. Erwartung: für Betriebe mit laufendem Umsatz leer.',
    anzeige: 'table',
    parameter: [P_BETRIEB],
    sql: `
SELECT betrieb                     AS "Betrieb",
       coalesce(konzept, '(nicht zugeordnet)') AS "Marke",
       status                      AS "Zustand",
       letzter_monat               AS "letzter Monat mit Umsatz",
       round(umsatz_letzter_monat, 0) AS "Umsatz in dem Monat"
  FROM mart.nachbarschaft_fehlend
 WHERE 1 = 1
   [[AND betrieb = {{betrieb}}]]
 ORDER BY (status = 'operativ') DESC, umsatz_letzter_monat DESC NULLS LAST`,
    visualisierung: {
      column_settings: {
        '["name","Umsatz in dem Monat"]': { number_style: 'currency', currency: 'EUR', currency_style: 'symbol', decimals: 0 },
      },
    },
  },
]
