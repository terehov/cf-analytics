-- =====================================================================
-- 0087 — Was das Wetter am Umsatz bewegt (Plan Kalender/Wetter, Phase 4)
--
-- WARUM DAS TROTZ SAISONKONFUNDIERUNG TRAEGT. Heisse Tage sind
-- Sommertage, und Sommer ist Ferien und Terrassenzeit. Ein roher
-- Zusammenhang zwischen Temperatur und Umsatz misst deshalb vor allem
-- die Jahreszeit. Der Vergleichstag nimmt genau das heraus — verglichen
-- wird gegen dieselben vier Wochentage zwei bis vier Wochen zuvor, also
-- gegen aehnliche Saison. Uebrig bleibt das WETTER GEGENUEBER DEM, WAS IN
-- DIESEN WOCHEN NORMAL WAR. Das ist die Aussage, die ein Betriebsleiter
-- meint, wenn er sagt, das Wetter sei schuld.
--
-- DIE SONNENKLASSE AUS DEM PLAN MISST ABER GENAU DIE JAHRESZEIT, und das
-- ist am 20.08.2026 nachgemessen worden. Der Vorschlag lautete
-- "trueb < 25 % Sonnenanteil". Ueber 4.735 Tage an 48 Orten:
--
--   Monat     1     2     3     4     5     6     7     8     9    10    11    12
--   trueb  71,2  65,5  44,7  27,6  33,5  19,6  42,2  22,1  54,7  66,9  63,0  68,0 %
--
-- Im Januar ist fast jeder Tag "trueb", im Juni jeder fuenfte. Der Grund
-- ist kein Wetter, sondern das Fenster: von 08 bis 24 Uhr sind im Winter
-- acht der sechzehn Stunden dunkel. Eine Klasse, die im Januar 71 % der
-- Tage einsammelt, heisst nicht "trueb", sie heisst "Winter".
--
-- DESHALB IST DIE SONNENKLASSE RELATIV: Sonnenanteil des Tages minus dem,
-- was an diesem Ort in den 28 Tagen davor ueblich war. Dieselbe
-- Konstruktion wie beim Vergleichstag, aus demselben Grund. Temperatur
-- und Niederschlag bleiben absolut — dort ist die Klassengrenze fachlich
-- lesbar ("ueber 28 Grad"), und die Verteilung traegt sie:
--
--   Temperatur  < 5 C  15,1 % | 5-15  30,2 % | 15-22  24,1 % | 22-28  16,6 % | > 28  14,0 %
--   Niederschlag  trocken 66,0 % | leicht 16,2 % | Regen 17,8 %
--
-- Beide Vorschlaege aus dem Plan bleiben damit stehen — nachgemessen und
-- nicht mehr geraten (Entscheidung E3).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Das Wetter gegen den eigenen Normalzustand
--
-- Ein nachlaufender 28-Tage-Schnitt je Ort. RANGE und nicht ROWS: bei
-- einer Luecke in der Reihe wuerde ROWS 28 ZEILEN zurueckgehen und damit
-- weiter als 28 Tage — still und ohne Fehlermeldung.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.wetter_tag AS
WITH stunde AS (
  SELECT w.breite, w.laenge,
         core.geschaeftstag(w.zeitpunkt) AS geschaeftstag,
         extract(hour FROM w.zeitpunkt AT TIME ZONE 'Europe/Berlin')::int AS stunde,
         w.temperatur, w.niederschlag, w.sonnenschein, w.wind,
         w.bewoelkung, w.zustand, w.distanz_m
    FROM manual.wetter_stunde w
), tag AS (
  SELECT breite, laenge, geschaeftstag,
         count(*)::int                                    AS stunden_ganztags,
         count(*) FILTER (WHERE stunde >= 8)::int         AS stunden_fenster,
         min(distanz_m)                                   AS distanz_m,
         round(max(temperatur)   FILTER (WHERE stunde >= 8), 1) AS fenster_temp_max,
         round(min(temperatur)   FILTER (WHERE stunde >= 8), 1) AS fenster_temp_min,
         round(avg(temperatur)   FILTER (WHERE stunde >= 8), 1) AS fenster_temp_schnitt,
         round(sum(niederschlag) FILTER (WHERE stunde >= 8), 2) AS fenster_niederschlag,
         round(max(wind)         FILTER (WHERE stunde >= 8), 1) AS fenster_wind_max,
         round(avg(bewoelkung)   FILTER (WHERE stunde >= 8), 0) AS fenster_bewoelkung,
         round(100.0 * sum(sonnenschein) FILTER (WHERE stunde >= 8)
               / nullif(60.0 * count(sonnenschein) FILTER (WHERE stunde >= 8), 0), 1)
                                                                AS fenster_sonne_pct,
         count(sonnenschein) FILTER (WHERE stunde >= 8)::int    AS fenster_sonne_stunden,
         mode() WITHIN GROUP (ORDER BY zustand) FILTER (WHERE stunde >= 8)
                                                                AS fenster_zustand,
         round(max(temperatur), 1)   AS tag_temp_max,
         round(min(temperatur), 1)   AS tag_temp_min,
         round(avg(temperatur), 1)   AS tag_temp_schnitt,
         round(sum(niederschlag), 2) AS tag_niederschlag,
         round(max(wind), 1)         AS tag_wind_max,
         round(avg(bewoelkung), 0)   AS tag_bewoelkung,
         round(100.0 * sum(sonnenschein) / nullif(60.0 * count(sonnenschein), 0), 1)
                                     AS tag_sonne_pct,
         mode() WITHIN GROUP (ORDER BY zustand) AS tag_zustand
    FROM stunde
   GROUP BY breite, laenge, geschaeftstag
)
SELECT t.*,
       round(avg(t.fenster_temp_max)  OVER w, 1) AS temp_norm,
       round(t.fenster_temp_max - avg(t.fenster_temp_max) OVER w, 1) AS temp_abweichung,
       round(avg(t.fenster_sonne_pct) OVER w, 1) AS sonne_norm,
       round(t.fenster_sonne_pct - avg(t.fenster_sonne_pct) OVER w, 1) AS sonne_abweichung_pp,
       count(*) OVER w AS norm_tage
  FROM tag t
WINDOW w AS (PARTITION BY t.breite, t.laenge ORDER BY t.geschaeftstag
             RANGE BETWEEN INTERVAL '28 days' PRECEDING AND INTERVAL '1 day' PRECEDING);

COMMENT ON VIEW mart.wetter_tag IS
'Wetter je Gitterpunkt und GESCHAEFTSTAG — und der beginnt um 08:00 Berliner Zeit, nicht '
'um Mitternacht. Zwei Saetze: fenster_* sind die ersten 16 Stunden (08-24, Entscheidung '
'E2, deckt 99,5 % des Umsatzes), tag_* ist der volle Geschaeftstag. Dazu seit 0087 die '
'RELATIVEN Spalten: temp_abweichung und sonne_abweichung_pp messen gegen den Schnitt der '
'letzten 28 Tage AN DIESEM ORT — dieselbe Konstruktion wie beim Vergleichstag, weil ein '
'absoluter Sonnenanteil im Fenster 08-24 vor allem die Jahreszeit misst.';

COMMENT ON COLUMN mart.wetter_tag.sonne_abweichung_pp IS
'Sonnenanteil des Tages minus dem Schnitt der letzten 28 Tage an diesem Ort, in '
'Prozentpunkten. DIE ZAHL, AUF DIE ES ANKOMMT: der absolute Anteil (fenster_sonne_pct) '
'liegt im Januar bauartbedingt niedrig, weil acht der sechzehn Fensterstunden dunkel '
'sind — nachgemessen am 20.08.2026 waeren 71,2 % der Januartage "trueb" gegen 19,6 % im '
'Juni. Das ist Winter, nicht Wetter.';

COMMENT ON COLUMN mart.wetter_tag.norm_tage IS
'Wie viele Tage den 28-Tage-Schnitt tatsaechlich trugen. Weniger als etwa 20 heisst: am '
'Anfang der Reihe oder eine Luecke im Backfill — die Abweichungsspalten sind dann '
'wackelig. mart.wetter_rueckstand sagt, ob noch etwas fehlt.';


-- ---------------------------------------------------------------------
-- 2. Wetter am Betrieb — Spalten ausgeschrieben, nicht w.*
--
-- Die Fassung aus 0086 stand auf `w.*`. Das sieht mitwachsend aus, ist es
-- aber nicht: Postgres schreibt die Spaltenliste beim Anlegen fest. Die
-- neuen Spalten aus Abschnitt 1 waeren nie angekommen, und niemand haette
-- eine Fehlermeldung gesehen.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.betrieb_wetter_tag AS
SELECT s.betrieb_key, b.name AS betrieb,
       w.breite, w.laenge, w.geschaeftstag, w.stunden_ganztags, w.stunden_fenster,
       w.distanz_m,
       w.fenster_temp_max, w.fenster_temp_min, w.fenster_temp_schnitt,
       w.fenster_niederschlag, w.fenster_wind_max, w.fenster_bewoelkung,
       w.fenster_sonne_pct, w.fenster_sonne_stunden, w.fenster_zustand,
       w.tag_temp_max, w.tag_temp_min, w.tag_temp_schnitt, w.tag_niederschlag,
       w.tag_wind_max, w.tag_bewoelkung, w.tag_sonne_pct, w.tag_zustand,
       w.temp_norm, w.temp_abweichung, w.sonne_norm, w.sonne_abweichung_pp, w.norm_tage
  FROM manual.betrieb_standort s
  JOIN core.betrieb b ON b.betrieb_key = s.betrieb_key
  JOIN mart.wetter_tag w
    ON w.breite = round(s.breitengrad, 2) AND w.laenge = round(s.laengengrad, 2)
 WHERE s.breitengrad IS NOT NULL;

COMMENT ON VIEW mart.betrieb_wetter_tag IS
'mart.wetter_tag auf den Betrieb gezogen, Spalten ausgeschrieben (ein w.* haette die '
'spaeteren Spalten nie mitgenommen). Enthaelt nur die 60 Betriebe mit gepflegter '
'Koordinate; die uebrigen 81 stehen in mart.kalender_fehlend.';


-- ---------------------------------------------------------------------
-- 3. Die Klassengrenzen als DATEN, nicht als Code
--
-- Wie das Ampel-Regelwerk im Schema ampel. Eine Grenze zu verschieben ist
-- eine Zeile in pflege/wetter_klasse.csv, keine Migration.
--
-- von ist EINSCHLIESSLICH, bis ist AUSSCHLIESSLICH, NULL ist offen. So
-- kann keine Luecke und keine Ueberlappung entstehen, ohne dass es
-- auffaellt — mart.wetter_klasse_pruefung rechnet es nach.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manual.wetter_klasse (
  kategorie    text    NOT NULL,
  klasse       text    NOT NULL,
  reihenfolge  integer NOT NULL,
  von          numeric,
  bis          numeric,
  gepflegt_am  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kategorie, klasse),
  CONSTRAINT wetter_klasse_grenzen CHECK (von IS NULL OR bis IS NULL OR von < bis),
  CONSTRAINT wetter_klasse_kategorie CHECK (kategorie IN ('temperatur', 'niederschlag', 'sonne'))
);

COMMENT ON TABLE manual.wetter_klasse IS
'Die Klassengrenzen des Wettereffekts, als Daten. von ist einschliesslich, bis ist '
'ausschliesslich, NULL ist offen. Gepflegt ueber pflege/wetter_klasse.csv — eine '
'Verschiebung braucht keine Migration. Die Startbelegung ist NACHGEMESSEN (20.08.2026, '
'4.735 Tage an 48 Orten), nicht geraten.';

COMMENT ON COLUMN manual.wetter_klasse.kategorie IS
'temperatur und niederschlag messen ABSOLUT (Maximum bzw. Summe im Fenster 08-24), sonne '
'misst RELATIV gegen die letzten 28 Tage am selben Ort. Der Unterschied ist gemessen und '
'kein Geschmack: ein absoluter Sonnenanteil im Fenster 08-24 sortiert im Januar 71 % der '
'Tage als "trueb" ein und im Juni 20 % — das ist die Jahreszeit.';

INSERT INTO manual.wetter_klasse (kategorie, klasse, reihenfolge, von, bis) VALUES
  ('temperatur',   'unter 5 Grad',      1, NULL,   5),
  ('temperatur',   '5 bis 15 Grad',     2,    5,  15),
  ('temperatur',   '15 bis 22 Grad',    3,   15,  22),
  ('temperatur',   '22 bis 28 Grad',    4,   22,  28),
  ('temperatur',   'ueber 28 Grad',     5,   28, NULL),
  ('niederschlag', 'trocken',           1, NULL, 0.05),
  ('niederschlag', 'leicht bis 2 mm',   2, 0.05,    2),
  ('niederschlag', 'Regen ueber 2 mm',  3,    2, NULL),
  ('sonne',        'deutlich trueber',  1, NULL,  -20),
  ('sonne',        'etwas trueber',     2,  -20,   -5),
  ('sonne',        'wie ueblich',       3,   -5,    5),
  ('sonne',        'etwas sonniger',    4,    5,   20),
  ('sonne',        'deutlich sonniger', 5,   20, NULL)
ON CONFLICT (kategorie, klasse) DO NOTHING;


-- ---------------------------------------------------------------------
-- 4. Die Waechterzeile zu den Klassen (Regel 10)
--
-- Eine Klassengrenze, die jemand in pflege/ verschiebt, kann eine Luecke
-- oder eine Ueberlappung hinterlassen. Beides faellt sonst erst auf,
-- wenn eine Kachel Tage verliert oder doppelt zaehlt — und das sieht wie
-- ein Ergebnis aus.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.wetter_klasse_pruefung AS
WITH sortiert AS (
  SELECT kategorie, klasse, reihenfolge, von, bis,
         lag(bis)  OVER (PARTITION BY kategorie ORDER BY reihenfolge) AS vorher_bis,
         lag(klasse) OVER (PARTITION BY kategorie ORDER BY reihenfolge) AS vorher_klasse
    FROM manual.wetter_klasse
)
SELECT kategorie, klasse, vorher_klasse, vorher_bis, von,
       CASE WHEN vorher_bis IS NULL AND von IS NOT NULL THEN 'erste Klasse ist nicht offen'
            WHEN vorher_bis IS NULL                     THEN NULL
            WHEN von IS NULL                            THEN 'Klasse ohne Untergrenze mittendrin'
            WHEN von > vorher_bis                       THEN 'Luecke'
            WHEN von < vorher_bis                       THEN 'Ueberlappung'
       END AS befund
  FROM sortiert
 WHERE CASE WHEN vorher_bis IS NULL AND von IS NOT NULL THEN true
            WHEN vorher_bis IS NULL                     THEN false
            WHEN von IS NULL                            THEN true
            ELSE von <> vorher_bis END;

COMMENT ON VIEW mart.wetter_klasse_pruefung IS
'Luecken und Ueberlappungen in manual.wetter_klasse. ERWARTUNG: leer. Wer eine Grenze in '
'pflege/wetter_klasse.csv verschiebt und die Nachbarklasse vergisst, verliert Tage oder '
'zaehlt sie doppelt — und beides sieht wie ein Ergebnis aus.';


-- ---------------------------------------------------------------------
-- 5. Jeder Tag in seiner Wetterlage
--
-- Parallel zu mart.kalendertag_lage: eine Zeile je Tag und Kategorie.
-- Dieselben Filter, damit die Zahlen nebeneinander lesbar sind — vier
-- saubere Vergleichstage, derselbe rollierende Zeitraum.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.wettertag_lage AS
SELECT v.betrieb_key, v.betrieb, v.geschaeftstag, v.abweichung_pct,
       w.fenster_temp_max, w.fenster_niederschlag, w.sonne_abweichung_pp,
       k.kategorie, k.klasse, k.reihenfolge
  FROM mart.vergleichstag_basis v
  JOIN mart.betrieb_wetter_tag w
    ON w.betrieb_key = v.betrieb_key AND w.geschaeftstag = v.geschaeftstag
  CROSS JOIN LATERAL (VALUES
        ('temperatur',   w.fenster_temp_max),
        ('niederschlag', w.fenster_niederschlag),
        ('sonne',        w.sonne_abweichung_pp)
       ) AS m(kategorie, wert)
  JOIN manual.wetter_klasse k
    ON k.kategorie = m.kategorie
   AND (k.von IS NULL OR m.wert >= k.von)
   AND (k.bis IS NULL OR m.wert <  k.bis)
 WHERE v.vergleichstage = 4
   AND v.abweichung_pct IS NOT NULL
   AND m.wert IS NOT NULL
   AND w.stunden_fenster = 16
   AND v.geschaeftstag >= (SELECT von FROM mart.kalender_zeitraum);

COMMENT ON VIEW mart.wettertag_lage IS
'Jeder auswertbare Tag in seinen drei Wetterlagen. Dieselben Filter wie '
'mart.kalendertag_lage — vier saubere Vergleichstage, derselbe rollierende Zeitraum —, '
'damit Kalender- und Wetterzahlen nebeneinander lesbar sind. stunden_fenster = 16 '
'schliesst Tage mit Messluecken aus: ein halber Tag ist kein Wettertag.';


-- ---------------------------------------------------------------------
-- 6. Der Wettereffekt
--
-- Dieselbe Bauart wie mart.kalendereffekt, dieselben Fallstricke,
-- derselbe Nullpunkt. UND DERSELBE HINWEIS: nicht addieren. Ein Feiertag
-- im Sommer ist auch ein warmer Tag; wer Feiertags- und Wettereffekt
-- zusammenzaehlt, zaehlt denselben Euro zweimal.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.wetter_effekt AS
WITH basiswert AS (
  SELECT betrieb_key,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct) AS basis_pct
    FROM mart.kalendertag_lage
   WHERE kategorie = 'brueckentag' AND auspraegung = 'gewoehnlicher Tag'
   GROUP BY betrieb_key
), roh AS (
  SELECT betrieb_key, betrieb, kategorie, klasse, reihenfolge,
         count(*)::int                                                AS tage,
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY abweichung_pct) AS median_pct,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY abweichung_pct) AS p25_pct,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY abweichung_pct) AS p75_pct,
         max(geschaeftstag)                                           AS letzter_termin
    FROM mart.wettertag_lage
   GROUP BY betrieb_key, betrieb, kategorie, klasse, reihenfolge
)
SELECT r.betrieb_key, r.betrieb, r.kategorie, r.klasse, r.reihenfolge, r.tage,
       round(r.median_pct::numeric, 1) AS median_pct,
       round(r.p25_pct::numeric, 1)    AS p25_pct,
       round(r.p75_pct::numeric, 1)    AS p75_pct,
       round(b.basis_pct::numeric, 1)  AS basis_pct,
       round((r.median_pct - b.basis_pct)::numeric, 1) AS median_gegen_basis_pp,
       r.letzter_termin
  FROM roh r LEFT JOIN basiswert b ON b.betrieb_key = r.betrieb_key;

COMMENT ON VIEW mart.wetter_effekt IS
'Je Betrieb und Wetterklasse: wie weit weicht der Umsatz vom Durchschnitt der letzten '
'vier gleichen Wochentage ab. WAS DAS MISST: das Wetter gegenueber dem, was in DIESEN '
'Wochen normal war — der Vergleichstag nimmt die Saison heraus, ein roher Zusammenhang '
'zwischen Temperatur und Umsatz taete das nicht. NICHT WEITER AGGREGIERBAR (der Median '
'einer Marke ist nicht der Median der Betriebs-Mediane) und NICHT ADDIERBAR zum '
'Feiertagseffekt: ein Feiertag im Sommer ist auch ein warmer Tag.';

CREATE OR REPLACE VIEW mart.wetter_effekt_gruppe AS
WITH basiswert AS (
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct) AS basis_pct
    FROM mart.kalendertag_lage
   WHERE kalender_quelle = 'bundesland'
     AND kategorie = 'brueckentag' AND auspraegung = 'gewoehnlicher Tag'
), roh AS (
  SELECT kategorie, klasse, reihenfolge,
         count(*)::int                    AS tage,
         count(DISTINCT betrieb_key)::int AS betriebe,
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY abweichung_pct) AS median_pct,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY abweichung_pct) AS p25_pct,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY abweichung_pct) AS p75_pct,
         max(geschaeftstag)               AS letzter_termin
    FROM mart.wettertag_lage
   GROUP BY kategorie, klasse, reihenfolge
)
SELECT r.kategorie, r.klasse, r.reihenfolge, r.tage, r.betriebe,
       round(r.median_pct::numeric, 1) AS median_pct,
       round(r.p25_pct::numeric, 1)    AS p25_pct,
       round(r.p75_pct::numeric, 1)    AS p75_pct,
       round(b.basis_pct::numeric, 1)  AS basis_pct,
       round((r.median_pct - b.basis_pct)::numeric, 1) AS median_gegen_basis_pp,
       r.letzter_termin
  FROM roh r CROSS JOIN basiswert b;

COMMENT ON VIEW mart.wetter_effekt_gruppe IS
'Der Wettereffekt ueber alle Betriebe, auf der TAGESEBENE gerechnet und nicht als Mittel '
'der Betriebs-Mediane. Der Nullpunkt ist der gewoehnliche Tag (basis_pct), nicht die '
'Null — siehe mart.kalendereffekt.';


-- ---------------------------------------------------------------------
-- 8. Zwei Nachbesserungen am Kalender-Waechter aus 0084
--
-- BEIDE SIND AM 20.08.2026 IM ECHTEN BETRIEB AUFGEFALLEN, als eine
-- zweite Session den Kalender-Nachlauf reparierte — er hatte seit `0079`
-- jede Nacht alle zwanzig Aufrufe an einer Laengenbegrenzung verloren.
-- Der Bestand sprang dabei von 1.127 auf 1.760 Zeilen und von zwei
-- Quellen auf eine, und die Reichweite verschob sich von 2018-2027 auf
-- 2020-2029. 2018 und 2019 stehen seitdem OHNE JEDEN FEIERTAG da.
--
-- WAS DAS ANRICHTET: ohne Feiertage landet ein Neujahr im
-- VERGLEICHSVORRAT. Der Schnitt der vier Vergleichs-Mittwoche faellt, und
-- der Folgemittwoch glaenzt. Die Effektsichten trifft es nicht — sie
-- rechnen ab 2023 —, die Tagesliste fuer 2018 und 2019 schon.
--
-- Es gab dafuer keine Pruefzeile. Jetzt gibt es eine.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.feiertag_jahresluecke AS
WITH jahr AS (
  SELECT extract(year FROM geschaeftstag)::int AS jahr,
         count(*) FILTER (WHERE umsatz_netto > 0) AS umsatztage
    FROM mart.umsatz_tag GROUP BY 1
)
SELECT j.jahr, j.umsatztage,
       count(DISTINCT f.datum)::int  AS feiertage,
       count(DISTINCT f.kuerzel)::int AS laender
  FROM jahr j
  LEFT JOIN manual.feiertag f ON extract(year FROM f.datum)::int = j.jahr
 WHERE j.umsatztage > 0
 GROUP BY j.jahr, j.umsatztage
HAVING count(DISTINCT f.datum) < 9
 ORDER BY j.jahr;

COMMENT ON VIEW mart.feiertag_jahresluecke IS
'Kalenderjahre, in denen Umsatz liegt, aber weniger als neun Feiertagstermine stehen — '
'neun ist die Zahl der bundesweiten. ERWARTUNG: leer. Am 20.08.2026 standen 2018 und 2019 '
'auf null, nachdem der Kalender-Nachlauf repariert wurde und nur noch ab 2020 holt. Ohne '
'Feiertage landet ein Neujahr im Vergleichsvorrat und laesst den Folgemittwoch glaenzen.';


-- Der Namenswaechter aus 0084 hatte einen falschen Alarm: "Tag der
-- Befreiung" gab es 2020 und 2025 in Berlin, beide Male als einmaligen
-- Gedenktag. Er endet also zu Recht und ist keine Umbenennung.
--
-- ABGRENZUNG STATT AUSNAHMELISTE IM QUELLTEXT: manual.feiertag_alias wird
-- zur Liste der GEPRUEFTEN Namen. Ein Eintrag mit name_neu = name_alt
-- heisst "angesehen, keine Umbenennung". Damit steht die Entscheidung als
-- Zeile in der Datenbank und nicht als Sonderfall im SQL — und der
-- naechste einmalige Gedenktag ist eine Zeile in pflege/.
INSERT INTO manual.feiertag_alias (name_alt, name_neu, bemerkung) VALUES
  ('Tag der Befreiung', 'Tag der Befreiung',
   'Einmaliger Gedenktag in Berlin, 2020 und 2025 — keine Umbenennung, endet zu Recht')
ON CONFLICT (name_alt) DO NOTHING;

CREATE OR REPLACE VIEW mart.feiertag_namenswechsel AS
WITH reichweite AS (SELECT max(datum) AS bis FROM manual.feiertag)
SELECT f.name,
       min(f.datum) AS erster_termin,
       max(f.datum) AS letzter_termin,
       count(DISTINCT f.datum) AS termine,
       string_agg(DISTINCT f.quelle, ', ') AS quellen
  FROM mart.feiertag_normiert f, reichweite r
 WHERE NOT EXISTS (SELECT 1 FROM manual.feiertag_alias a
                    WHERE a.name_alt = f.name OR a.name_neu = f.name)
 GROUP BY f.name, r.bis
HAVING max(f.datum) < r.bis - INTERVAL '2 years'
 ORDER BY max(f.datum);

COMMENT ON VIEW mart.feiertag_namenswechsel IS
'Feiertagsnamen, die mehr als zwei Jahre vor dem Ende des Bestands aufhoeren und noch '
'NICHT in manual.feiertag_alias stehen — fast immer eine Umbenennung durch einen '
'Quellenwechsel. ERWARTUNG: leer. Wer hier auftaucht, gehoert in die Alias-Tabelle: '
'entweder als Umbenennung (name_neu zeigt auf den neuen Namen) oder als geprueft '
'(name_neu = name_alt, wie beim einmaligen Tag der Befreiung).';


-- ---------------------------------------------------------------------
-- 7. Pruefzeilen — neu erzeugt, jetzt mit der Klassenpruefung
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pruefung_kalender AS
SELECT 'Vergleichstag: Materialisierung aelter als der letzte Lauf'::text AS pruefung,
       1 AS geprueft,
       count(*) FILTER (WHERE zustand <> 'aktuell')::int AS auffaellig,
       'mart.vergleichstag_stand'::text AS sicht
  FROM mart.vergleichstag_stand
UNION ALL
SELECT 'Vergleichstag: Betrieb mit Umsatz, aber ohne Bundesland'::text,
       (SELECT count(DISTINCT betrieb_key)::int FROM mart.umsatz_tag),
       count(*)::int, 'mart.kalender_fehlend'::text
  FROM mart.kalender_fehlend
UNION ALL
SELECT 'Feiertag: Name endet vor dem Ende der Historie'::text,
       (SELECT count(DISTINCT name)::int FROM mart.feiertag_normiert),
       count(*)::int, 'mart.feiertag_namenswechsel'::text
  FROM mart.feiertag_namenswechsel
UNION ALL
SELECT 'Wetter: Gitterpunkt ohne Messwert fuer gestern'::text,
       (SELECT count(*)::int FROM mart.wetter_ort),
       (SELECT count(*)::int FROM mart.wetter_ort o
         WHERE NOT EXISTS (SELECT 1 FROM manual.wetter_stunde w
                            WHERE w.breite = o.breite AND w.laenge = o.laenge
                              AND core.geschaeftstag(w.zeitpunkt) = current_date - 1)),
       'mart.wetter_rueckstand'::text
UNION ALL
SELECT 'Wetter: Backfill-Rueckstand in Ortsjahren'::text,
       count(*)::int,
       count(*) FILTER (WHERE zustand IN ('fehlt', 'unvollstaendig'))::int,
       'mart.wetter_rueckstand'::text
  FROM mart.wetter_rueckstand
UNION ALL
-- ERWARTUNG: 0. Eine verschobene Grenze in pflege/ darf keine Luecke lassen.
SELECT 'Wetter: Klassengrenzen mit Luecke oder Ueberlappung'::text,
       (SELECT count(*)::int FROM manual.wetter_klasse),
       count(*)::int, 'mart.wetter_klasse_pruefung'::text
  FROM mart.wetter_klasse_pruefung
UNION ALL
-- ERWARTUNG: 0. Ein Jahr mit Umsatz und ohne Feiertage rechnet still falsch.
SELECT 'Feiertag: Jahr mit Umsatz, aber ohne Feiertage'::text,
       (SELECT count(DISTINCT extract(year FROM geschaeftstag))::int FROM mart.umsatz_tag),
       count(*)::int, 'mart.feiertag_jahresluecke'::text
  FROM mart.feiertag_jahresluecke;

COMMENT ON VIEW mart.pruefung_kalender IS
'Die Pruefzeilen rund um Kalender, Vergleichstag und Wetter. Eigene Sicht, damit eine '
'parallel entwickelte Migration sie nicht beim Neuerzeugen von mart.pruefung_uebersicht '
'verschluckt. Erwartungen: Materialisierung 0, Betriebe ohne Bundesland konstant 9, '
'Namenswechsel 0, Gitterpunkt ohne Messwert 0, Backfill-Rueckstand faellt auf 0, '
'Klassengrenzen 0.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0087', to_jsonb(
        'Wettereffekt je Betrieb und Klasse, gebaut wie der Kalendereffekt. Die '
        'Klassengrenzen stehen als Daten in manual.wetter_klasse und sind ueber '
        'pflege/wetter_klasse.csv ohne Migration aenderbar. Die Startbelegung ist '
        'nachgemessen und nicht geraten: Temperatur 15/30/24/17/14 %, '
        'Niederschlag 66/16/18 %. Die Sonnenklasse aus dem Plan war dagegen '
        'unbrauchbar — "trueb unter 25 % Anteil" traf im Januar 71,2 % der Tage '
        'und im Juni 19,6 %, weil im Fenster 08-24 im Winter acht von sechzehn '
        'Stunden dunkel sind. Sie misst jetzt RELATIV gegen die letzten 28 Tage '
        'am selben Ort.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
