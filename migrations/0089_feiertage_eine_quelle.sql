-- =====================================================================
-- 0089 Eine Quelle fuer die Feiertage — und alle sechzehn Laender
--
-- ANLASS (20.08.2026). manual.feiertag trug zwei Quellen: 2018 und 2019
-- von feiertage-api.de, ab 2020 von openholidaysapi.org. 0051 hat das so
-- angelegt, weil openholidays bei den Feiertagen nicht vor 2020 zurueck-
-- reicht — am 20.08.2026 nachgemessen und unveraendert wahr:
--
--   Jahr   PublicHolidays DE-BW   SchoolHolidays DE-BW
--   2016                      0                      8
--   2018                      0                      6
--   2019                      0                      6
--   2020                     12                      6
--
-- Der Bruch hat drei Folgen gehabt, und alle drei standen in den Daten:
--
--   1. ZWEI SCHREIBWEISEN desselben Tages (Neujahrstag/Neujahr, 1. und
--      2. Weihnachtstag/-feiertag, Augsburger Friedensfest/Friedensfest).
--      0084 hat dafuer manual.feiertag_alias gebaut.
--
--   2. VIER TAGE, DIE KEINE LANDESWEITEN FEIERTAGE SIND. feiertage-api.de
--      markiert sie selbst, im Feld hinweis — wer 0051 befuellt hat, hat
--      das Feld nicht gelesen:
--
--        BW  Reformationstag   "... haben Schueler schulfrei ..."
--        BY  Buss- und Bettag  "... entfaellt im gesamten Bundesland ..."
--        SN  Fronleichnam      "... kein gesetzlicher Feiertag ausser in
--                               folgenden katholisch gepraegten Gemeinden"
--        TH  Fronleichnam      "... ausser im Landkreis Eichsfeld ..."
--
--      Macht 76 Betriebstage, die als Feiertag galten und damit aus dem
--      Vergleichsvorrat fielen.
--
--   3. EINE REIHE, DIE MITTEN IM BESTAND BRICHT: dieselben vier Laender
--      haben diese Tage 2018 und 2019, ab 2020 nicht mehr.
--
-- ENTSCHIEDEN VON EUGENE AM 20.08.2026: eine Quelle, nicht zwei. Die 231
-- Zeilen von feiertage-api.de gehen raus.
--
-- WAS DAS KOSTET, UND ES STEHT HIER, WEIL ES NICHT VERSCHWINDEN DARF:
-- 2018 und 2019 haben danach KEINE Feiertage. mart.vergleichstag nimmt
-- fuer diese zwei Jahre jeden Feiertag als gewoehnlichen Vergleichstag in
-- den Vorrat — ein Neujahr zieht dort den Schnitt der vier Vergleichs-
-- Mittwoche nach unten. Betroffen ist nur die Historie: mart.kalender_-
-- zeitraum (0085) beginnt rollierend drei volle Jahre vor heute, also am
-- 01.01.2023, und laesst 2018/2019 ohnehin draussen.
--
-- Damit "kein Feiertag" nicht wie "nachgesehen, keiner" aussieht, sagt
-- mart.kalender_abdeckung, ab wann ein Land ueberhaupt Termine hat, und
-- der Spaltenkommentar an mart.betrieb_kalender.ist_feiertag nennt die
-- Grenze.
--
-- ALLE SECHZEHN LAENDER. Die Tabelle trug zehn — die, in denen Betriebe
-- stehen. Der Nachzug holt seit heute die Laenderliste aus /Subdivisions
-- derselben Schnittstelle und fuellt fehlende Jahre bis zum Boden auf.
-- Diese Migration traegt die Daten NICHT ein: sie kommen aus dem Netz,
-- und eine Migration, die am Netz haengt, ist keine.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die zweite Quelle geht raus
-- ---------------------------------------------------------------------
DELETE FROM manual.feiertag WHERE quelle = 'feiertage-api.de';

COMMENT ON TABLE manual.feiertag IS
'Gesetzliche Feiertage je Bundesland, ab 2020, ausschliesslich aus openholidaysapi.org. '
'2018 und 2019 lagen bis zum 20.08.2026 aus feiertage-api.de darin und sind mit 0089 '
'entfallen (siehe Migration): die Quelle fuehrte vier nicht landesweite Tage als '
'Feiertage und schrieb vier weitere anders. VOR 2020 STEHT HIER NICHTS — das ist eine '
'Luecke, keine Aussage. Wer bis 2018 auswertet, liest mart.kalender_abdeckung dazu. '
'Fortgeschrieben von src/pflege/kalender.ts im naechtlichen Lauf, fuer alle 16 Laender.';

COMMENT ON COLUMN mart.betrieb_kalender.ist_feiertag IS
'false heisst "kein Feiertag" — VOR 2020 aber "unbekannt": manual.feiertag beginnt dort, '
'weil openholidaysapi.org nicht weiter zurueckreicht. Die Grenze je Land steht in '
'mart.kalender_abdeckung.';


-- ---------------------------------------------------------------------
-- 2. Was ein Land traegt — und was ihm fehlt
--
-- Die fehlenden Jahre werden gegen den Bestand gerechnet und nicht gegen
-- eine Jahreszahl im Text: kommt ein Land neu dazu, steht seine Luecke
-- hier, bis der Nachtlauf sie geschlossen hat. Niemand muss die Sicht
-- anfassen, wenn sich der Bestand bewegt.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.kalender_abdeckung AS
WITH grenzen AS (
  -- DER BODEN STEHT ALS ZAHL DA UND WIRD NICHT AUS DEM BESTAND GERATEN.
  -- Er ist eine Eigenschaft der QUELLE (openholidaysapi.org fuehrt
  -- Feiertage ab 2020, Schulferien ab 2016) und steht als BODEN auch in
  -- src/pflege/kalender.ts; wer das eine aendert, aendert das andere mit.
  --
  -- Aus dem Bestand gerechnet stand hier zuerst 2016 als Ferienboden, und
  -- prompt meldete die Sicht fuer zehn Laender das Jahr 2016 als Luecke:
  -- die Weihnachtsferien 2016/17 beginnen im Dezember 2016 und kommen
  -- deshalb schon in der Scheibe 2017 mit. Ein Randjahr, das nur aus
  -- ueberhaengenden Zeitraeumen besteht, ist kein Jahr — und eine Luecke,
  -- die es nie gab, ist das Letzte, was in dieser Sicht stehen darf.
  SELECT 2020                                                            AS f_ab,
         (SELECT max(extract(year FROM datum))::int FROM manual.feiertag) AS f_bis,
         2017                                                            AS s_ab,
         (SELECT max(extract(year FROM von))::int FROM manual.schulferien) AS s_bis
), land AS (
  SELECT kuerzel FROM manual.feiertag
   UNION
  SELECT kuerzel FROM manual.schulferien
), betrieb AS (
  SELECT kuerzel, count(*)::int AS betriebe
    FROM mart.betrieb_bundesland GROUP BY 1
)
SELECT l.kuerzel,
       max(pb.bundesland)                  AS bundesland,
       coalesce(b.betriebe, 0)             AS betriebe,
       count(DISTINCT f.datum)::int        AS feiertage,
       min(f.datum)                        AS feiertag_von,
       max(f.datum)                        AS feiertag_bis,
       (SELECT array_agg(j ORDER BY j)
          FROM generate_series(g.f_ab, g.f_bis) j
         WHERE NOT EXISTS (SELECT 1 FROM manual.feiertag x
                            WHERE x.kuerzel = l.kuerzel
                              AND extract(year FROM x.datum)::int = j))
                                           AS feiertagsjahre_ohne_zeile,
       count(DISTINCT s.von)::int          AS ferienzeitraeume,
       min(s.von)                          AS ferien_von,
       max(s.bis)                          AS ferien_bis,
       (SELECT array_agg(j ORDER BY j)
          FROM generate_series(g.s_ab, g.s_bis) j
         WHERE NOT EXISTS (SELECT 1 FROM manual.schulferien x
                            WHERE x.kuerzel = l.kuerzel
                              AND extract(year FROM x.von)::int = j))
                                           AS ferienjahre_ohne_zeile,
       -- Zwei GLEICHNAMIGE Ferienzeitraeume desselben Landes, die sich
       -- ueberschneiden. Normalerweise null: die Quelle fuehrt Varianten (MV
       -- nach Schulform ABS/BBS, SH fuer die Inseln), und der Nachzug nimmt
       -- davon die landesweite. Steht eine Zahl hier, ist eine neue
       -- Variantenart aufgetaucht, und ist_schulferien wird zu weit.
       --
       -- Auf den Namen eingeschraenkt, weil sich VERSCHIEDENE Ferien
       -- rechtmaessig ueberlappen: MV legt 2023 und 2029 einen
       -- "Zusaetzlichen Ferientag" in die Pfingstferien. Ohne diese
       -- Einschraenkung stuende dort dauerhaft eine 2, und eine Pruefzeile,
       -- die immer etwas meldet, meldet nichts.
       (SELECT count(*)::int FROM manual.schulferien a
          JOIN manual.schulferien b
            ON b.kuerzel = a.kuerzel AND b.name = a.name AND b.von > a.von
           AND a.bis >= b.von
         WHERE a.kuerzel = l.kuerzel)      AS ferien_ueberlappungen
  FROM land l
  CROSS JOIN grenzen g
  LEFT JOIN manual.feiertag    f  ON f.kuerzel  = l.kuerzel
  LEFT JOIN manual.schulferien s  ON s.kuerzel  = l.kuerzel
  LEFT JOIN betrieb            b  ON b.kuerzel  = l.kuerzel
  LEFT JOIN manual.plz_bundesland pb ON pb.kuerzel = l.kuerzel
 GROUP BY l.kuerzel, b.betriebe, g.f_ab, g.f_bis, g.s_ab, g.s_bis
 ORDER BY l.kuerzel;

COMMENT ON VIEW mart.kalender_abdeckung IS
'Je Bundesland: was an Feiertagen und Schulferien da ist, ab wann, und welche Jahre '
'innerhalb des Bestands KEINE Zeile haben. Die Sicht existiert, weil eine leere '
'Feiertagsliste zwei Dinge heissen kann — "an diesen Tagen wurde gearbeitet" oder "wir '
'wissen es nicht". Vor 2020 ist es immer das zweite. betriebe sagt, ob an einem Land '
'ueberhaupt etwas haengt: die sechs ohne Betrieb werden mitgefuehrt, damit ein neuer '
'Standort nicht auf seinen Kalender warten muss.';

COMMENT ON COLUMN mart.kalender_abdeckung.feiertagsjahre_ohne_zeile IS
'Jahre zwischen dem Boden der Quelle (2020) und dem juengsten Feiertag im Bestand, in '
'denen dieses Land keine Zeile hat. Normalerweise leer. Ein neu aufgenommenes Land steht hier, '
'bis der naechtliche Nachzug seine Historie aufgefuellt hat (KALENDER_ABRUFE_MAX '
'begrenzt, wie schnell das geht).';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0089', to_jsonb(
        'Feiertage kommen nur noch aus openholidaysapi.org; die 231 Zeilen von '
        'feiertage-api.de (2018/2019) sind geloescht. Grund: vier nicht landesweite '
        'Tage als Feiertage gefuehrt (BW Reformationstag, BY Buss- und Bettag, SN '
        'und TH Fronleichnam, zusammen 76 Betriebstage) und vier weitere anders '
        'geschrieben. Preis: 2018 und 2019 haben keine Feiertage mehr — '
        'mart.kalender_zeitraum beginnt ohnehin erst 2023. Der Nachzug holt ab '
        'jetzt alle 16 Bundeslaender und fuellt fehlende Jahre bis 2020 '
        '(Feiertage) bzw. 2017 (Ferien) selbst auf.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
