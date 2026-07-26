-- =====================================================================
-- 0007 Mart, zweiter Teil — was die Dashboards brauchten und nicht fand
--
-- Beim Nachbauen der Excel-Blaetter in Metabase blieben sieben Fragen
-- uebrig, die sich aus 0006 nicht ohne einen Join in core beantworten
-- liessen. Nach dem Grundsatz aus docs/metabase.md ist das jedes Mal eine
-- Luecke in mart und keine gespeicherte SQL-Frage in Metabase — deshalb
-- stehen sie hier.
--
-- Reihenfolge der Blaetter aus JULI_Round_Table_Ampelsystem.xlsx:
--   Eingabe G/H/I   -> mart.umsatz_ytd
--   Eingabe F..T    -> mart.ampel_bereich   (Langformat, das Arbeitspferd)
--   Trend_2Monate   -> mart.round_table_trend
--   Ursachenanalyse -> mart.ursachen_analyse
--   Massnahmen      -> mart.massnahme
-- Dazu zwei, die kein Excel-Pendant haben, aber in
-- "Umsetzung Berichte" auf Prio 1 stehen bzw. beim aktuellen Importstand
-- die erste Frage jedes Morgens sind:
--   mart.personalkosten
--   mart.datenstand
-- =====================================================================


-- =====================================================================
-- Ampeln im Langformat
--
-- mart.round_table_monat hat sechs Ampelspalten nebeneinander. Das liest
-- sich als Tabelle gut und ist fuer jede Auswertung ueber Bereiche hinweg
-- unbrauchbar: "wie viele Betriebe stehen je Bereich auf rot" waere sechs
-- getrennte Fragen, die man danach von Hand nebeneinanderlegt.
--
-- Hier steht dieselbe Information als eine Zeile je Betrieb, Monat und
-- Bereich. Damit werden aus dem Excel-Block "Rot-Treiber nach Bereich"
-- (00_Dashboard A10:F11) ein einziges Balkendiagramm und aus dem Blatt
-- Ampelhistorie eine Gruppierung.
--
-- Der Wert steht mit dabei, weil ohne ihn jede Ampel eine Behauptung ohne
-- Beleg ist — wer rot sieht, will wissen, wie weit daneben.
-- =====================================================================

CREATE VIEW mart.ampel_bereich AS
WITH lang AS (
    SELECT r.monat, r.betrieb_key, r.betrieb, r.stadt, r.konzept, r.bwa_monat,
           r.gesamt, r.intensitaet, r.prioritaet, r.massnahme,
           b.*
      FROM mart.round_table_monat r
      CROSS JOIN LATERAL (
          VALUES ('umsatz',    'Umsatz',            1, r.umsatz_pct,             r.ampel_umsatz),
                 ('personal',  'Personal',          2, r.personalkosten_ogf_pct, r.ampel_personal),
                 ('we_bar',    'WE Bar',            3, r.we_bar_pct,             r.ampel_we_bar),
                 ('we_kueche', 'WE Küche',          4, r.we_kueche_pct,          r.ampel_we_kueche),
                 ('bewertung', 'Online-Bewertung',  5, r.online_bewertung,       r.ampel_bewertung),
                 ('om',        'OM vor Ort',        6, r.om_score::numeric,      r.ampel_om)
      ) AS b(bereich, bereich_name, reihenfolge, wert, ampel)
)
SELECT l.monat, l.betrieb_key, l.betrieb, l.stadt, l.konzept, l.bwa_monat,
       l.bereich, l.bereich_name, l.reihenfolge,
       l.wert,
       l.ampel,
       be.emoji,
       coalesce(be.emoji || ' ' || be.bezeichnung, '– keine Daten') AS ampel_text,
       l.gesamt, l.intensitaet, l.prioritaet, l.massnahme,
       u.ursache_code,
       uk.bezeichnung AS ursache,
       u.notiz        AS ursache_notiz
  FROM lang l
  LEFT JOIN ampel.beschriftung be ON be.status = l.ampel
  LEFT JOIN manual.ursache u      ON u.betrieb_key = l.betrieb_key
                                 AND u.monat       = l.monat
                                 AND u.bereich     = l.bereich
  LEFT JOIN manual.ursache_katalog uk ON uk.ursache_code = u.ursache_code;

COMMENT ON VIEW mart.ampel_bereich IS
'Die sechs Ampeln des Round Table im Langformat: eine Zeile je Betrieb, Monat und Bereich,
mit dem zugrunde liegenden Wert und der erfassten Ursache.
Fuer alles, was ueber Bereiche hinweg zaehlt oder gruppiert — "Rot-Treiber nach Bereich",
Ampelhistorie, Ursachenzuordnung. Fuer die klassische Round-Table-Tabelle bleibt
mart.round_table_monat die richtige Sicht.
ACHTUNG: eine Summe ueber wert ist sinnlos, die Spalte mischt Prozente mit Schulnoten.
ampel IS NULL heisst "keine Daten", nicht "in Ordnung" — Betriebe ohne BWA sehen sonst
aus wie unauffaellige Betriebe.';


-- =====================================================================
-- Umsatz kumuliert — Spalten G, H, I des Blatts Eingabe
--
-- Im Excel drei Eingabespalten, die jemand Monat fuer Monat aus einem
-- zweiten LINA-Aufruf abgetippt hat. Hier faellt das weg: der Umsatz je
-- Tag liegt ohnehin da, das Jahr bis zum Berichtsmonat ist eine
-- Fensterfunktion.
--
-- Der Vorjahresvergleich ist bewusst NICHT "die letzten zwoelf Monate",
-- sondern Jahresbeginn bis zum gleichen Monat des Vorjahres — genau so
-- rechnet das Excel, und ein Wechsel der Definition mitten im Umstieg
-- waere die Sorte Abweichung, die man erst ein Quartal spaeter bemerkt.
-- =====================================================================

CREATE VIEW mart.umsatz_ytd AS
WITH monat AS (
    SELECT betrieb_key,
           date_trunc('month', geschaeftstag)::date AS monat,
           sum(umsatz_netto)                        AS umsatz,
           sum(rechnungen)                          AS rechnungen,
           sum(gaeste)                              AS gaeste
      FROM core.umsatzbericht_tag
     WHERE hauptsparte_key IS NULL AND verkaufsstelle_key IS NULL
     GROUP BY 1, 2
),
kumuliert AS (
    SELECT betrieb_key, monat, umsatz, rechnungen, gaeste,
           sum(umsatz) OVER (PARTITION BY betrieb_key, date_trunc('year', monat)
                             ORDER BY monat)        AS umsatz_ytd
      FROM monat
)
SELECT b.name          AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       k.monat,
       k.umsatz        AS umsatz_monat,
       v.umsatz        AS umsatz_monat_vj,
       CASE WHEN v.umsatz > 0
            THEN round((k.umsatz - v.umsatz) / v.umsatz * 100, 2)
       END             AS umsatz_pct,
       k.umsatz_ytd,
       v.umsatz_ytd    AS umsatz_ytd_vj,
       CASE WHEN v.umsatz_ytd > 0
            THEN round((k.umsatz_ytd - v.umsatz_ytd) / v.umsatz_ytd * 100, 2)
       END             AS umsatz_ytd_pct,
       k.rechnungen,
       k.gaeste,
       CASE WHEN k.rechnungen > 0 THEN round(k.umsatz / k.rechnungen, 2) END AS bon_schnitt,
       CASE WHEN k.gaeste     > 0 THEN round(k.umsatz / k.gaeste,     2) END AS umsatz_pro_gast,
       k.betrieb_key
  FROM kumuliert k
  JOIN core.betrieb b                 ON b.betrieb_key  = k.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = k.betrieb_key
  LEFT JOIN kumuliert v               ON v.betrieb_key  = k.betrieb_key
                                     AND v.monat = (k.monat - interval '1 year')::date;

COMMENT ON VIEW mart.umsatz_ytd IS
'Monats- und Jahresumsatz je Betrieb mit Vorjahresvergleich — die Spalten G, H und I des
Excel-Blatts Eingabe, die dort jeden Monat von Hand nachgetragen wurden.
umsatz_ytd laeuft vom 1. Januar bis zum Berichtsmonat einschliesslich, der Vergleich gegen
denselben Ausschnitt des Vorjahres. Prozentwerte sind Prozentzahlen (10.60), nicht Brueche —
im Excel stand dort ein Bruch (0.106).
SOLANGE DER HISTORIEN-BACKFILL LAEUFT sind alle *_vj-Spalten leer. Das ist kein Fehler,
sondern fehlende Vergangenheit; mart.backfill_fortschritt sagt, wie weit er ist.';


-- =====================================================================
-- Trend — Blatt Trend_2Monate
--
-- Im Excel musste man die zwei Vormonate von Hand eintragen ("Trage die
-- zwei Vormonate ein"), und die Trendaussage war eine Formel gegen die
-- Nachbarspalte. Hier ist beides eine Fensterfunktion.
--
-- Die Richtung haengt am Bereich: bei Umsatz und den beiden Noten ist mehr
-- besser, bei Personal- und Wareneinsatzquoten weniger. Deshalb wird die
-- Vergleichsrichtung aus ampel.regel gezogen und nicht hier hartkodiert —
-- sonst haette eine geaenderte Regel zwei Wahrheiten.
-- =====================================================================

CREATE VIEW mart.round_table_trend AS
WITH reihe AS (
    SELECT a.monat, a.betrieb_key, a.betrieb, a.stadt, a.konzept,
           a.bereich, a.bereich_name, a.reihenfolge, a.wert, a.ampel,
           lag(a.wert, 1) OVER w AS wert_vormonat,
           lag(a.wert, 2) OVER w AS wert_vorvormonat,
           lag(a.ampel, 1) OVER w AS ampel_vormonat
      FROM mart.ampel_bereich a
    WINDOW w AS (PARTITION BY a.betrieb_key, a.bereich ORDER BY a.monat)
),
richtung AS (
    SELECT DISTINCT bereich, richtung
      FROM ampel.regel
     WHERE regelwerk_key = (SELECT regelwerk_key FROM ampel.regelwerk WHERE ist_standard LIMIT 1)
)
SELECT r.monat, r.betrieb_key, r.betrieb, r.stadt, r.konzept,
       r.bereich, r.bereich_name, r.reihenfolge,
       r.wert_vorvormonat, r.wert_vormonat, r.wert,
       round(r.wert - r.wert_vormonat, 2) AS veraenderung,
       CASE
         WHEN r.wert IS NULL OR r.wert_vormonat IS NULL THEN NULL
         WHEN g.richtung = 'niedriger_ist_besser'
              THEN CASE WHEN r.wert <= r.wert_vormonat THEN '↗ besser/gleich' ELSE '↘ schlechter' END
              ELSE CASE WHEN r.wert >= r.wert_vormonat THEN '↗ besser/gleich' ELSE '↘ schlechter' END
       END AS trend,
       r.ampel, r.ampel_vormonat,
       CASE
         WHEN r.ampel IS NULL OR r.ampel_vormonat IS NULL THEN NULL
         WHEN r.ampel = r.ampel_vormonat                  THEN 'unveraendert'
         WHEN r.ampel = 'rot'                             THEN 'verschlechtert'
         WHEN r.ampel_vormonat = 'rot'                    THEN 'verbessert'
         WHEN r.ampel = 'gruen'                           THEN 'verbessert'
         ELSE 'verschlechtert'
       END AS ampelwechsel
  FROM reihe r
  LEFT JOIN richtung g ON g.bereich = r.bereich;

COMMENT ON VIEW mart.round_table_trend IS
'Drei-Monats-Blick je Betrieb und Bereich — das Excel-Blatt Trend_2Monate, ohne das
Nachtragen der Vormonate von Hand.
trend uebernimmt die Excel-Beschriftung (↗ besser/gleich, ↘ schlechter) und kennt die
Richtung des Bereichs: bei Personal- und Wareneinsatzquoten ist ein kleinerer Wert besser.
ampelwechsel ist die schaerfere Frage — sie zeigt, wer die Farbe gewechselt hat, und ist
die Liste, mit der ein Round Table anfangen sollte.
Fuer den ersten Monat der Historie sind beide Spalten leer; es gibt keinen Vormonat.';


-- =====================================================================
-- Ursachenanalyse — Blatt Ursachenanalyse
--
-- Im Excel ein Block aus 21 x 4 COUNTIFS gegen die Dropdown-Spalten U..X.
-- Gezaehlt wurde dort nur, wenn die Ampel rot ODER orange war; eine Ursache
-- an einer gruenen Ampel fiel stillschweigend heraus. Das ist hier
-- uebernommen, aber sichtbar: faelle_gesamt zaehlt alle erfassten Ursachen,
-- faelle nur die auffaelligen.
--
-- Die Prioritaetsregel ist die des Blatts (>=3 Hoch, =2 Mittel, sonst
-- Niedrig) und bezieht sich auf die auffaelligen Faelle.
-- =====================================================================

CREATE VIEW mart.ursachen_analyse AS
SELECT a.monat,
       uk.ursache_code,
       uk.bezeichnung AS ursache,
       uk.reihenfolge,
       count(*) FILTER (WHERE a.ampel IN ('rot','orange'))::int              AS faelle,
       count(*)::int                                                         AS faelle_gesamt,
       count(*) FILTER (WHERE a.ampel = 'rot')::int                          AS rot,
       count(*) FILTER (WHERE a.ampel = 'orange')::int                       AS orange,
       count(*) FILTER (WHERE a.bereich = 'umsatz'    AND a.ampel IN ('rot','orange'))::int AS umsatz,
       count(*) FILTER (WHERE a.bereich = 'personal'  AND a.ampel IN ('rot','orange'))::int AS personal,
       count(*) FILTER (WHERE a.bereich = 'we_bar'    AND a.ampel IN ('rot','orange'))::int AS we_bar,
       count(*) FILTER (WHERE a.bereich = 'we_kueche' AND a.ampel IN ('rot','orange'))::int AS we_kueche,
       CASE WHEN count(*) FILTER (WHERE a.ampel IN ('rot','orange')) >= 3 THEN 'Hoch'
            WHEN count(*) FILTER (WHERE a.ampel IN ('rot','orange')) =  2 THEN 'Mittel'
            WHEN count(*) FILTER (WHERE a.ampel IN ('rot','orange')) >  0 THEN 'Niedrig'
       END AS prioritaet,
       string_agg(DISTINCT a.betrieb, ', ' ORDER BY a.betrieb)
           FILTER (WHERE a.ampel IN ('rot','orange'))                        AS betriebe
  FROM mart.ampel_bereich a
  JOIN manual.ursache_katalog uk ON uk.ursache_code = a.ursache_code
 GROUP BY a.monat, uk.ursache_code, uk.bezeichnung, uk.reihenfolge;

COMMENT ON VIEW mart.ursachen_analyse IS
'Wie oft welche Ursache hinter einer roten oder orangen Ampel steht — das Excel-Blatt
Ursachenanalyse, je Monat statt nur fuer den jeweils aktuellen.
faelle zaehlt wie im Excel nur rote und orange Ampeln, faelle_gesamt auch die gruenen —
die Differenz sind Ursachen, die jemand erfasst hat, obwohl die Kennzahl in Ordnung war.
prioritaet folgt der Excel-Regel: ab 3 Faellen Hoch, bei 2 Mittel.
LEER, SOLANGE NIEMAND URSACHEN ERFASST. manual.ursache wird von Hand gepflegt, LINA kennt
keine Ursachen. Eine leere Sicht heisst hier "nicht erfasst", nicht "keine Probleme".';


-- =====================================================================
-- Massnahmen — Blatt Massnahmen
--
-- Die Tabelle darunter ist die einzige, in die im laufenden Betrieb
-- geschrieben wird. Diese Sicht haengt nur die Namen dran und rechnet aus,
-- was ueberfaellig ist — im Excel war das eine Spalte, die niemand pflegte.
-- =====================================================================

CREATE VIEW mart.massnahme AS
SELECT m.massnahme_id,
       m.monat,
       b.name          AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       m.bereich,
       uk.bezeichnung  AS ursache,
       m.massnahme,
       m.verantwortlich,
       m.faellig_am,
       m.status,
       m.prioritaet,
       m.fortschritt,
       m.notizen,
       (m.status IN ('Offen','In Arbeit','Eskalieren','Wartet auf Rückmeldung')) AS ist_offen,
       (m.faellig_am < current_date
        AND m.status <> 'Erledigt')                                              AS ueberfaellig,
       (m.faellig_am - current_date)                                             AS tage_bis_faellig,
       m.erstellt_am,
       m.geaendert_am,
       m.betrieb_key
  FROM manual.massnahme m
  JOIN core.betrieb b                 ON b.betrieb_key  = m.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = m.betrieb_key
  LEFT JOIN manual.ursache_katalog uk ON uk.ursache_code = m.ursache_code;

COMMENT ON VIEW mart.massnahme IS
'Massnahmen-Tracking mit Betriebsnamen und Faelligkeit — das Excel-Blatt Massnahmen.
ist_offen fasst die vier nicht-erledigten Zustaende zusammen, so wie das Excel-Dashboard
sie zaehlte (Offen + In Arbeit + Eskalieren), plus "Wartet auf Rueckmeldung", das dort
schlicht vergessen wurde.
ueberfaellig und tage_bis_faellig beziehen sich auf HEUTE und aendern sich damit taeglich —
fuer eine Auswertung zum Stichtag stattdessen faellig_am direkt vergleichen.
Geschrieben wird in manual.massnahme; Metabase liest hier nur.';


-- =====================================================================
-- Personalkosten und Effektivitaet
--
-- In "Umsetzung Berichte" stehen "Personalkosten/Effektivitaet" und
-- "... pro Bereich" auf Prio 1 mit Status live=1, in mart gab es dazu
-- bisher nichts.
--
-- Zwei Dinge, die man der Rohtabelle nicht ansieht:
--   * Der Posten traegt zeitraum_von/zeitraum_bis, nicht einen Tag. Fuer
--     Tagesposten sind beide gleich; ein Monatsposten aus dem Backfill
--     deckt einen ganzen Monat ab. Wer ueber Zeitraeume summiert, zaehlt
--     doppelt — deshalb weist die Sicht tage aus und aggregiert nicht.
--   * eff_* ist Umsatz je Personalstunde, pek_* eine Quote in Prozent.
--     Beide heissen im LINA-Bericht nebeneinander "Effektivitaet".
-- =====================================================================

CREATE VIEW mart.personalkosten AS
SELECT b.name          AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       p.zeitraum_von,
       p.zeitraum_bis,
       date_trunc('month', p.zeitraum_von)::date            AS monat,
       (p.zeitraum_bis - p.zeitraum_von + 1)                AS tage,
       p.pek_gesamt, p.pek_service, p.pek_bar, p.pek_kueche,
       p.eff_gesamt, p.eff_service, p.eff_bar, p.eff_kueche,
       p.persoog_bwa,
       s.schwelle_gruen  AS schwelle_gruen_lina,
       s.schwelle_orange AS schwelle_orange_lina,
       ampel.bewerte(p.persoog_bwa, 'personal', 'round_table_global')            AS ampel_global,
       ampel.bewerte(p.persoog_bwa, 'personal', 'lina_betrieb', p.betrieb_key,
                     p.zeitraum_von)                                             AS ampel_lina,
       p.betrieb_key
  FROM core.personalkosten p
  JOIN core.betrieb b                 ON b.betrieb_key  = p.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = p.betrieb_key
  LEFT JOIN LATERAL (
        SELECT sw.schwelle_gruen, sw.schwelle_orange
          FROM core.schwellenwert_betrieb sw
         WHERE sw.betrieb_key = p.betrieb_key
           AND sw.bereich     = 'personal'
           AND sw.gueltig_ab <= p.zeitraum_von
         ORDER BY sw.gueltig_ab DESC
         LIMIT 1
  ) s ON true;

COMMENT ON VIEW mart.personalkosten IS
'Personalkostenquoten und Effektivitaeten je Betrieb und Zeitraum, gesamt und je Bereich
(Service, Bar, Kueche) — die Berichte "Personalkosten/Effektivitaet" und "... pro Bereich".

pek_* sind Quoten in Prozent, eff_* ist Umsatz je Personalstunde in Euro. Beide heissen im
LINA-Bericht "Effektivitaet"; wer sie in ein Diagramm legt, bekommt zwei Achsen.

NICHT UEBER ZEITRAEUME SUMMIEREN. Ein Posten deckt zeitraum_von bis zeitraum_bis ab, und die
Zeitraeume koennen sich zwischen Tages- und Monatsabruf ueberlappen. Fuer einen Monatswert
den Posten mit dem passenden Zeitraum nehmen, nicht die Tage addieren — Quoten und
Stundenwerte sind ohnehin nicht additiv.

persoog_bwa ist die Groesse, auf der die Round-Table-Ampel Personal beruht.
schwelle_*_lina sind die betriebsindividuellen Schwellen aus LINA und meist ANDERE als die
28/32 des Excel-Regelblatts; ampel_global und ampel_lina zeigen den Unterschied nebeneinander.';


-- =====================================================================
-- Datenstand
--
-- Beim aktuellen Importstand die wichtigste Sicht ueberhaupt. Jede Zahl in
-- jedem Dashboard ist so alt wie ihre Quelle, und die Quellen sind
-- unterschiedlich alt: der Umsatzbericht kommt taeglich, die BWA haengt
-- ein bis zwei Monate zurueck, der Artikelverkauf wird gerade erst
-- nachgeladen.
--
-- Ohne diese Sicht sieht ein Betrieb, dessen Daten fehlen, genauso aus wie
-- ein Betrieb, bei dem alles in Ordnung ist. Das ist der teuerste Irrtum,
-- den dieses System anbieten kann.
-- =====================================================================

CREATE VIEW mart.datenstand AS
SELECT b.name          AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       b.aktiv,
       b.hat_bwa,
       (b.lina_betrieb_id IS NOT NULL) AS bwa_bruecke,
       u.erster_tag,
       u.letzter_tag,
       u.tage                          AS umsatztage,
       (current_date - u.letzter_tag)  AS umsatz_alter_tage,
       k.letzter_gebuchter_monat       AS bwa_monat,
       CASE WHEN k.letzter_gebuchter_monat IS NOT NULL
            THEN (date_part('year',  age(date_trunc('month', current_date)::date,
                                          k.letzter_gebuchter_monat)) * 12
                + date_part('month', age(date_trunc('month', current_date)::date,
                                          k.letzter_gebuchter_monat)))::int
       END                             AS bwa_verzug_monate,
       a.artikeltage,
       a.letzter_artikeltag,
       p.letzter_personaltag,
       CASE WHEN u.letzter_tag IS NULL                       THEN 'kein Umsatz geladen'
            WHEN current_date - u.letzter_tag > 3             THEN 'Umsatz veraltet'
            WHEN k.letzter_gebuchter_monat IS NULL            THEN 'keine BWA gebucht'
            WHEN a.artikeltage = 0                            THEN 'keine Artikeldaten'
            ELSE 'vollstaendig'
       END                             AS befund,
       b.betrieb_key
  FROM core.betrieb b
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = b.betrieb_key
  LEFT JOIN LATERAL (
        SELECT min(geschaeftstag) AS erster_tag, max(geschaeftstag) AS letzter_tag,
               count(*)::int      AS tage
          FROM core.umsatzbericht_tag t
         WHERE t.betrieb_key = b.betrieb_key
           AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL
  ) u ON true
  LEFT JOIN LATERAL (
        SELECT max(monat) AS letzter_gebuchter_monat
          FROM mart.kennzahlen_aktuell ka
         WHERE ka.betrieb_key = b.betrieb_key
           AND ka.wert_absolut IS NOT NULL AND ka.wert_absolut <> 0
  ) k ON true
  LEFT JOIN LATERAL (
        SELECT count(DISTINCT geschaeftstag)::int AS artikeltage,
               max(geschaeftstag)                 AS letzter_artikeltag
          FROM core.artikelverkauf_tag av
         WHERE av.betrieb_key = b.betrieb_key
  ) a ON true
  LEFT JOIN LATERAL (
        SELECT max(zeitraum_bis) AS letzter_personaltag
          FROM core.personalkosten pk
         WHERE pk.betrieb_key = b.betrieb_key
  ) p ON true;

COMMENT ON VIEW mart.datenstand IS
'Je Betrieb: bis wann Umsatz geladen ist, bis wann die BWA gebucht ist, ob Artikeldaten und
Personalkosten da sind. Die Sicht, die vor jedem Round Table beantwortet, welche Zeilen
ueberhaupt beurteilbar sind.
befund ist die Kurzfassung und in dieser Reihenfolge zu lesen: ohne Umsatz ist alles andere
egal. bwa_verzug_monate ist der Abstand zwischen heutigem Monat und juengstem GEBUCHTEN
BWA-Monat — zwei ist normal, vier ist eine Nachfrage beim Steuerberater wert.
Ein Betrieb ohne bwa_bruecke bekommt ueberhaupt keine BWA-Zeile; die Arbeitsliste dazu ist
mart.betrieb_ohne_lina_id.';
