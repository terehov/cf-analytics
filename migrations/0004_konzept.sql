-- =====================================================================
-- Konzeptebene (Marken) als eigene Auswertungsdimension
--
-- Die Dimension selbst gibt es seit 0000: core.konzept und
-- core.betrieb_konzept. Was fehlte, war die Auswertungsseite - bisher
-- tauchten die Konzepte nur als Textspalte in mart.betrieb auf.
--
-- Der Knackpunkt ist die n:m-Zuordnung: ein Betriebsschluessel kann in
-- mehreren Konzepten haengen (Karlsruhe in fuenf). Wuerde man Markenschnitte
-- ueber core.betrieb_konzept bilden, zaehlte derselbe Betrieb in fuenf
-- Markenschnitten mit und verzoege jeden davon. Deshalb:
--
--   * Markenschnitte laufen ueber das HAUPTKONZEPT - eine saubere 1:1-Sicht.
--   * Betriebe mit genau einem Konzept bekommen es automatisch.
--   * Betriebe mit mehreren bleiben unzugeordnet, bis jemand entscheidet.
--     Sie verschwinden nicht, sondern erscheinen als "(nicht zugeordnet)".
--
-- Nicht raten, sondern die Luecke sichtbar lassen. mart.konzept_zuordnung
-- zeigt genau, wo noch eine Entscheidung fehlt.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Manuelle Aufloesung der Mehrfachzuordnung
-- ---------------------------------------------------------------------

CREATE TABLE manual.betrieb_hauptkonzept (
    betrieb_key   integer PRIMARY KEY REFERENCES core.betrieb(betrieb_key),
    konzept_key   integer NOT NULL REFERENCES core.konzept(konzept_key),
    begruendung   text,
    gepflegt_am   timestamptz NOT NULL DEFAULT now(),
    gepflegt_von  text
);

COMMENT ON TABLE manual.betrieb_hauptkonzept IS
'Welche Marke gilt fuer einen Betrieb, der in LINA in mehreren Konzepten haengt.
Nur fuer die Mehrdeutigen noetig - wer genau ein Konzept hat, wird automatisch zugeordnet.
Diese Tabelle gewinnt immer, auch gegen eine eindeutige LINA-Zuordnung: wenn LINA falsch
gruppiert, ist das hier die Stelle zum Geradeziehen.';

COMMENT ON COLUMN manual.betrieb_hauptkonzept.begruendung IS
'Warum diese Marke. In einem Jahr weiss es sonst niemand mehr.';


-- ---------------------------------------------------------------------
-- Aufgeloeste Zuordnung
-- ---------------------------------------------------------------------

CREATE VIEW mart.konzept_zuordnung AS
WITH zaehlung AS (
    SELECT bk.betrieb_key,
           count(*)::int                              AS anzahl_konzepte,
           min(bk.konzept_key)                        AS einziges_konzept,
           string_agg(k.name, ', ' ORDER BY k.name)   AS konzepte
      FROM core.betrieb_konzept bk
      JOIN core.konzept k ON k.konzept_key = bk.konzept_key
     GROUP BY bk.betrieb_key
)
SELECT b.betrieb_key,
       b.name  AS betrieb,
       b.stadt,
       b.aktiv,
       coalesce(z.anzahl_konzepte, 0) AS anzahl_konzepte,
       z.konzepte,
       kh.name AS hauptkonzept,
       CASE WHEN m.betrieb_key IS NOT NULL          THEN 'manuell gesetzt'
            WHEN z.anzahl_konzepte = 1              THEN 'aus LINA eindeutig'
            WHEN coalesce(z.anzahl_konzepte, 0) = 0 THEN 'LINA kennt kein Konzept'
            ELSE 'mehrdeutig - Entscheidung fehlt'
       END AS herkunft
  FROM core.betrieb b
  LEFT JOIN zaehlung z                      ON z.betrieb_key = b.betrieb_key
  LEFT JOIN manual.betrieb_hauptkonzept m   ON m.betrieb_key = b.betrieb_key
  LEFT JOIN core.konzept kh
         ON kh.konzept_key = coalesce(m.konzept_key,
                                      CASE WHEN z.anzahl_konzepte = 1
                                           THEN z.einziges_konzept END);

COMMENT ON VIEW mart.konzept_zuordnung IS
'Welche Marke gilt fuer welchen Betrieb - und woher das kommt. Die Zeilen mit
herkunft = ''mehrdeutig - Entscheidung fehlt'' sind die Arbeitsliste: solange sie offen sind,
laufen diese Betriebe in allen Markenauswertungen unter "(nicht zugeordnet)".
Erste Frage vor jedem Markenvergleich: SELECT * FROM mart.konzept_zuordnung WHERE hauptkonzept IS NULL;';


-- ---------------------------------------------------------------------
-- mart.round_table um Betriebsschluessel und Marke erweitern
--
-- Die Spalten kommen ans ENDE, damit die Excel-Reihenfolge des Blattes
-- "Eingabe" vorne unveraendert bleibt. betrieb_key wird gebraucht, weil sonst
-- jede weiterfuehrende Auswertung ueber den Betriebsnamen joinen muesste.
-- Der Rumpf ist Wort fuer Wort der aus 0001, nur um zwei Ausgabespalten
-- ergaenzt - DROP ist noetig, weil sich die Rueckgabestruktur aendert.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS mart.round_table(date, text);

CREATE FUNCTION mart.round_table(
    p_monat     date,
    p_regelwerk text DEFAULT NULL
)
RETURNS TABLE (
    betrieb                 text,
    stadt                   text,
    bwa_monat               date,
    umsatz_ist              numeric,
    umsatz_vj               numeric,
    umsatz_pct              numeric,
    personalkosten_ogf_pct  numeric,
    we_bar_pct              numeric,
    we_kueche_pct           numeric,
    online_bewertung        numeric,
    om_score                smallint,
    ampel_umsatz            text,
    ampel_personal          text,
    ampel_we_bar            text,
    ampel_we_kueche         text,
    ampel_bewertung         text,
    ampel_om                text,
    gesamt                  text,
    intensitaet             text,
    massnahme               text,
    prioritaet              text,
    betrieb_key             integer,
    konzept                 text
)
LANGUAGE sql STABLE AS $$
WITH grenzen AS (
    SELECT date_trunc('month', p_monat)::date AS m_von,
           (date_trunc('month', p_monat) + interval '1 month - 1 day')::date AS m_bis
),
umsatz AS (   -- POS: quasi live
    SELECT u.betrieb_key, sum(u.umsatz_netto) AS umsatz_ist
      FROM core.umsatzbericht_tag u, grenzen g
     WHERE u.geschaeftstag BETWEEN g.m_von AND g.m_bis
       AND u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
     GROUP BY u.betrieb_key
),
umsatz_vj AS (
    SELECT u.betrieb_key, sum(u.umsatz_netto) AS umsatz_vj
      FROM core.umsatzbericht_tag u, grenzen g
     WHERE u.geschaeftstag BETWEEN (g.m_von - interval '1 year')::date
                               AND (g.m_bis - interval '1 year')::date
       AND u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
     GROUP BY u.betrieb_key
),
bwa_stand AS (  -- juengster gebuchter BWA-Monat je Betrieb, hoechstens der Berichtsmonat
    SELECT k.betrieb_key, max(k.monat) AS bwa_monat
      FROM mart.kennzahlen_aktuell k, grenzen g
     WHERE k.monat <= g.m_von
       AND k.wert_prozent IS NOT NULL
     GROUP BY k.betrieb_key
),
bwa AS (
    SELECT s.betrieb_key, s.bwa_monat,
           max(k.wert_prozent) FILTER (WHERE k.kennzahl = 'Personalkosten ohne GF') AS personalkosten_ogf_pct,
           max(k.wert_prozent) FILTER (WHERE k.kennzahl = 'WE Bar')                 AS we_bar_pct,
           max(k.wert_prozent) FILTER (WHERE k.kennzahl = 'WE Küche')               AS we_kueche_pct
      FROM bwa_stand s
      JOIN mart.kennzahlen_aktuell k
        ON k.betrieb_key = s.betrieb_key AND k.monat = s.bwa_monat
     GROUP BY s.betrieb_key, s.bwa_monat
),
basis AS (
    SELECT b.betrieb_key, b.name AS betrieb, b.stadt,
           bwa.bwa_monat,
           u.umsatz_ist,
           v.umsatz_vj,
           CASE WHEN v.umsatz_vj > 0
                THEN round((u.umsatz_ist - v.umsatz_vj) / v.umsatz_vj * 100, 2)
           END AS umsatz_pct,
           bwa.personalkosten_ogf_pct, bwa.we_bar_pct, bwa.we_kueche_pct,
           ob.bewertung AS online_bewertung,
           om.om_score,
           z.hauptkonzept AS konzept
      FROM core.betrieb b
      LEFT JOIN umsatz    u   ON u.betrieb_key   = b.betrieb_key
      LEFT JOIN umsatz_vj v   ON v.betrieb_key   = b.betrieb_key
      LEFT JOIN bwa           ON bwa.betrieb_key = b.betrieb_key
      LEFT JOIN mart.konzept_zuordnung z ON z.betrieb_key = b.betrieb_key
      LEFT JOIN manual.online_bewertung ob
             ON ob.betrieb_key = b.betrieb_key
            AND ob.monat = (SELECT m_von FROM grenzen)
      LEFT JOIN manual.om_einschaetzung om
             ON om.betrieb_key = b.betrieb_key
            AND om.monat = (SELECT m_von FROM grenzen)
     WHERE b.aktiv
),
bewertet AS (
    SELECT b.*,
           ampel.bewerte(b.umsatz_pct,             'umsatz',    p_regelwerk, b.betrieb_key, b.bwa_monat) AS a_umsatz,
           ampel.bewerte(b.personalkosten_ogf_pct, 'personal',  p_regelwerk, b.betrieb_key, b.bwa_monat) AS a_personal,
           ampel.bewerte(b.we_bar_pct,             'we_bar',    p_regelwerk, b.betrieb_key, b.bwa_monat) AS a_we_bar,
           ampel.bewerte(b.we_kueche_pct,          'we_kueche', p_regelwerk, b.betrieb_key, b.bwa_monat) AS a_we_kueche,
           ampel.bewerte(b.online_bewertung,       'bewertung', p_regelwerk, b.betrieb_key, b.bwa_monat) AS a_bewertung,
           ampel.bewerte(b.om_score,               'om',        p_regelwerk, b.betrieb_key, b.bwa_monat) AS a_om
      FROM basis b
)
SELECT betrieb, stadt, bwa_monat,
       umsatz_ist, umsatz_vj, umsatz_pct,
       personalkosten_ogf_pct, we_bar_pct, we_kueche_pct, online_bewertung, om_score,
       a_umsatz, a_personal, a_we_bar, a_we_kueche, a_bewertung, a_om,
       ampel.gesamt(st)      AS gesamt,
       ampel.intensitaet(st) AS intensitaet,
       CASE WHEN ampel.gesamt(st) = 'rot'
              OR ampel.intensitaet(st) = 'Nachforschung' THEN 'Ja' ELSE 'Nein' END AS massnahme,
       CASE WHEN ampel.gesamt(st) = 'rot'                 THEN 'Hoch'
            WHEN ampel.intensitaet(st) = 'Nachforschung'  THEN 'Mittel'
            ELSE 'Niedrig' END AS prioritaet,
       betrieb_key,
       konzept
  FROM bewertet,
       LATERAL (SELECT ARRAY[a_umsatz,a_personal,a_we_bar,a_we_kueche,a_bewertung,a_om]) AS x(st)
 ORDER BY betrieb;
$$;

COMMENT ON FUNCTION mart.round_table IS
'Ersetzt das Excel-Blatt "Eingabe". Aufruf: SELECT * FROM mart.round_table(DATE ''2026-06-01'');
Zweites Argument waehlt das Regelwerk (round_table_global | lina_betrieb), NULL = Standard.
Seit 0004 zusaetzlich betrieb_key und konzept als letzte Spalten - die Excel-Reihenfolge
vorne bleibt unveraendert.
WICHTIG: bwa_monat weist aus, aus welchem Monat Personal- und Wareneinsatzwerte stammen.
Weil die BWA vom Steuerberater importiert wird und 1-2 Monate nachhinkt, ist das oft NICHT
der Berichtsmonat - im Excel wurde derselbe Versatz stillschweigend gepflegt (Juli-Report
mit Mai-Werten, erkennbar nur an einer Kopfzeile).';


-- ---------------------------------------------------------------------
-- Markenschnitt
--
-- Median statt Mittelwert: bei 141 Betrieben reicht ein einzelner Ausreisser
-- - ein Neubau im Anlaufjahr, ein Betrieb mit Umbau - um einen Mittelwert so
-- zu verziehen, dass die halbe Marke ploetzlich "unterdurchschnittlich"
-- aussieht. Der Median haelt still.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mart.konzept_schnitt(
    p_monat     date,
    p_regelwerk text DEFAULT NULL
)
RETURNS TABLE (
    konzept                 text,
    betriebe                integer,
    umsatz_ist              numeric,
    umsatz_pct              numeric,
    personalkosten_ogf_pct  numeric,
    we_bar_pct              numeric,
    we_kueche_pct           numeric,
    ampeln_rot              integer,
    ampeln_gelb             integer,
    ampeln_gruen            integer,
    massnahme_faellig       integer
)
LANGUAGE sql STABLE AS $$
SELECT coalesce(r.konzept, '(nicht zugeordnet)')                                       AS konzept,
       count(*)::int                                                                   AS betriebe,
       round(sum(r.umsatz_ist), 2)                                                     AS umsatz_ist,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.umsatz_pct)::numeric, 2)    AS umsatz_pct,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.personalkosten_ogf_pct)::numeric, 2)
                                                                                       AS personalkosten_ogf_pct,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.we_bar_pct)::numeric, 2)    AS we_bar_pct,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.we_kueche_pct)::numeric, 2) AS we_kueche_pct,
       count(*) FILTER (WHERE r.gesamt = 'rot')::int                                   AS ampeln_rot,
       count(*) FILTER (WHERE r.gesamt = 'gelb')::int                                  AS ampeln_gelb,
       count(*) FILTER (WHERE r.gesamt = 'gruen')::int                                 AS ampeln_gruen,
       count(*) FILTER (WHERE r.massnahme = 'Ja')::int                                 AS massnahme_faellig
  FROM mart.round_table(p_monat, p_regelwerk) r
 GROUP BY 1
 ORDER BY 1;
$$;

COMMENT ON FUNCTION mart.konzept_schnitt IS
'Eine Zeile je Marke. Die Prozentwerte sind MEDIANE, nicht Mittelwerte - ein einzelner
Ausreisser soll den Vergleichsmassstab einer ganzen Marke nicht verziehen. umsatz_ist ist
dagegen eine echte Summe.
"(nicht zugeordnet)" sammelt die Betriebe ohne eindeutiges Hauptkonzept; wer da landet und
warum, steht in mart.konzept_zuordnung.';


-- ---------------------------------------------------------------------
-- Round Table mit doppeltem Massstab
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mart.round_table_marke(
    p_monat     date,
    p_regelwerk text DEFAULT NULL
)
RETURNS TABLE (
    betrieb                 text,
    konzept                 text,
    stadt                   text,
    bwa_monat               date,
    umsatz_pct              numeric,
    umsatz_abw_gesamt       numeric,
    umsatz_abw_marke        numeric,
    personalkosten_ogf_pct  numeric,
    personal_abw_gesamt     numeric,
    personal_abw_marke      numeric,
    we_bar_pct              numeric,
    we_bar_abw_gesamt       numeric,
    we_bar_abw_marke        numeric,
    we_kueche_pct           numeric,
    we_kueche_abw_gesamt    numeric,
    we_kueche_abw_marke     numeric,
    gesamt                  text,
    intensitaet             text,
    prioritaet              text
)
LANGUAGE sql STABLE AS $$
WITH r AS (
    SELECT * FROM mart.round_table(p_monat, p_regelwerk)
),
alle AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY umsatz_pct)             AS umsatz,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY personalkosten_ogf_pct) AS personal,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY we_bar_pct)             AS we_bar,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY we_kueche_pct)          AS we_kueche
      FROM r
),
marke AS (
    SELECT konzept,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY umsatz_pct)             AS umsatz,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY personalkosten_ogf_pct) AS personal,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY we_bar_pct)             AS we_bar,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY we_kueche_pct)          AS we_kueche
      FROM r
     GROUP BY konzept
)
SELECT r.betrieb,
       coalesce(r.konzept, '(nicht zugeordnet)'),
       r.stadt,
       r.bwa_monat,
       r.umsatz_pct,
       round((r.umsatz_pct             - a.umsatz)::numeric,   2),
       round((r.umsatz_pct             - m.umsatz)::numeric,   2),
       r.personalkosten_ogf_pct,
       round((r.personalkosten_ogf_pct - a.personal)::numeric, 2),
       round((r.personalkosten_ogf_pct - m.personal)::numeric, 2),
       r.we_bar_pct,
       round((r.we_bar_pct             - a.we_bar)::numeric,   2),
       round((r.we_bar_pct             - m.we_bar)::numeric,   2),
       r.we_kueche_pct,
       round((r.we_kueche_pct          - a.we_kueche)::numeric, 2),
       round((r.we_kueche_pct          - m.we_kueche)::numeric, 2),
       r.gesamt, r.intensitaet, r.prioritaet
  FROM r
  CROSS JOIN alle a
  LEFT JOIN marke m ON m.konzept IS NOT DISTINCT FROM r.konzept
 ORDER BY coalesce(r.konzept, 'zzz'), r.betrieb;
$$;

COMMENT ON FUNCTION mart.round_table_marke IS
'Round Table mit doppeltem Massstab: je Kennzahl die Abweichung zum Median ALLER Betriebe
und zum Median der eigenen Marke. Damit ist auf einen Blick unterscheidbar, ob ein Betrieb
schwach ist oder ob gerade seine ganze Marke schwaechelt - der Fall, in dem eine Massnahme
beim einzelnen Betrieb ins Leere laeuft.
Vorzeichen: bei Umsatz ist mehr besser, bei Personal- und Wareneinsatzquoten weniger.
Ein positiver Wert ist also nicht automatisch ein guter Wert.
Betriebe ohne eindeutiges Hauptkonzept haben keine Markenabweichung (NULL) - siehe
mart.konzept_zuordnung.';
