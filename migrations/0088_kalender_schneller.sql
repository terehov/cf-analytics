-- =====================================================================
-- 0088 — Der Kalender kippte, als er vollstaendig wurde
--
-- WAS PASSIERT IST, am 20.08.2026 im laufenden Betrieb:
--
-- Eine zweite Session reparierte den Kalender-Nachlauf — er hatte seit
-- `0079` jede Nacht alle zwanzig Aufrufe an einer Laengenbegrenzung der
-- Schnittstelle verloren und nie eine Zeile geschrieben. Danach stand
-- der Bestand richtig da:
--
--                     vorher    nachher
--   manual.feiertag    1.127      1.760   Zeilen
--   Bundeslaender         10         16
--   manual.schulferien   591      1.268   Zeilen
--
-- UND DER REFRESH VON mart.vergleichstag_basis LIEF INS ZEITLIMIT.
-- Gemessen: 40,9 s vor der Reparatur, danach Abbruch nach 1.075 s. Kein
-- Codeeingriff dazwischen — nur mehr, richtigere Daten.
--
-- DIE URSACHE STAND IM AUSFUEHRUNGSPLAN:
--
--   Merge Cond:  (p.kuerzel = ftf.kuerzel)
--   Join Filter: (ftf.datum = (u.geschaeftstag + 1))
--
-- Der Vor- und Folgetag wurden als AUSDRUCK im Join gesucht
-- (`t.geschaeftstag + 1`). Postgres nahm nur das Bundesland als
-- Verbundbedingung und pruefte das Datum als Filter — also fuer jede der
-- 443.304 Zeilen alle Feiertage dieses Landes. Bei zehn Laendern und
-- 1.127 Zeilen ging das gerade noch durch; bei sechzehn Laendern kippte
-- der Plan.
--
-- DIE KORREKTUR IST KLEIN: Vor- und Folgetag werden SPALTEN der
-- Tagesachse statt Ausdruecke im Join. Damit ist es eine Gleichheit auf
-- zwei Spalten, und Postgres darf hashen.
--
--   Kalendersicht ueber alle 141 Betriebe:  22,0 s (vorher: Zeitlimit)
--
-- Die Verbundtabellen stehen zusaetzlich auf MATERIALIZED. Sie sind klein
-- (1.760 Feiertagszeilen, 17.624 Ferientagszeilen) und werden bis zu
-- dreimal gebraucht — einmal rechnen ist hier immer richtig.
--
-- DIE LEHRE, und sie ist die teure: eine Sicht, die mit dem heutigen
-- Bestand schnell ist, ist damit nicht schnell. Dieser Plan kippte, weil
-- eine ANDERE Baustelle Daten vervollstaendigte. Ein Join auf einem
-- Ausdruck ist die Stelle, an der so etwas zuerst nachgibt.
-- =====================================================================


CREATE OR REPLACE VIEW mart.betrieb_kalender AS
WITH tag AS (
  -- Vor- und Folgetag als SPALTEN. Das ist der ganze Unterschied.
  SELECT geschaeftstag,
         geschaeftstag - 1 AS vortag,
         geschaeftstag + 1 AS folgetag
    FROM (SELECT DISTINCT geschaeftstag FROM mart.umsatz_tag) x
), betrieb AS (
  SELECT b.betrieb_key,
         b.name AS betrieb,
         bl.kuerzel,
         bl.bundesland,
         CASE WHEN bl.kuerzel IS NOT NULL THEN 'bundesland' ELSE 'bundesweit' END AS kalender_quelle
    FROM core.betrieb b
    LEFT JOIN mart.betrieb_bundesland bl ON bl.betrieb_key = b.betrieb_key
), feiertag_tag AS MATERIALIZED (
  SELECT kuerzel, datum, min(name) AS name FROM mart.feiertag_normiert GROUP BY 1, 2
), bundesweit AS MATERIALIZED (
  SELECT datum, name FROM mart.feiertag_bundesweit
), ferien_tag AS MATERIALIZED (
  SELECT s.kuerzel, d::date AS datum, min(s.name) AS name
    FROM manual.schulferien s,
         LATERAL generate_series(s.von, s.bis, INTERVAL '1 day') d
   GROUP BY 1, 2
)
SELECT b.betrieb_key,
       b.betrieb,
       b.kuerzel                                  AS bundesland_kuerzel,
       b.bundesland,
       t.geschaeftstag,
       extract(isodow FROM t.geschaeftstag)::int  AS wochentag_nr,
       to_char(t.geschaeftstag, 'TMDay')          AS wochentag,
       coalesce(ft.name, bw.name)                 AS feiertag,
       sf.name                                    AS schulferien,
       (coalesce(ft.name, bw.name) IS NOT NULL)   AS ist_feiertag,
       -- NULL und nicht false, wo es keinen Landeskalender gibt: fuer
       -- Schulferien gibt es keinen bundesweiten Ersatz.
       CASE WHEN b.kuerzel IS NOT NULL THEN (sf.name IS NOT NULL) END AS ist_schulferien,
       b.kalender_quelle,
       (coalesce(ftv.name, bwv.name) IS NOT NULL) AS vortag_feiertag,
       (coalesce(ftf.name, bwf.name) IS NOT NULL) AS folgetag_feiertag
  FROM betrieb b
  CROSS JOIN tag t
  LEFT JOIN feiertag_tag ft  ON ft.kuerzel  = b.kuerzel AND ft.datum  = t.geschaeftstag
  LEFT JOIN feiertag_tag ftv ON ftv.kuerzel = b.kuerzel AND ftv.datum = t.vortag
  LEFT JOIN feiertag_tag ftf ON ftf.kuerzel = b.kuerzel AND ftf.datum = t.folgetag
  LEFT JOIN ferien_tag   sf  ON sf.kuerzel  = b.kuerzel AND sf.datum  = t.geschaeftstag
  LEFT JOIN bundesweit   bw  ON b.kuerzel IS NULL AND bw.datum  = t.geschaeftstag
  LEFT JOIN bundesweit   bwv ON b.kuerzel IS NULL AND bwv.datum = t.vortag
  LEFT JOIN bundesweit   bwf ON b.kuerzel IS NULL AND bwf.datum = t.folgetag;

COMMENT ON VIEW mart.betrieb_kalender IS
'Je Betrieb und Geschaeftstag: Wochentag, Feiertag, Schulferien, Vor- und Folgetag. Seit '
'0084 fuer ALLE Betriebe — die ohne gepflegte PLZ bekommen die bundesweiten Feiertage und '
'keine Schulferien, sichtbar in kalender_quelle. Seit 0088 sind Vor- und Folgetag SPALTEN '
'der Tagesachse und keine Ausdruecke im Join: als Ausdruck nahm Postgres nur das '
'Bundesland als Verbundbedingung und pruefte das Datum je Zeile als Filter. Wer hier '
'einen Join auf geschaeftstag +/- 1 zurueckbaut, holt sich das Zeitlimit zurueck.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0088', to_jsonb(
        'Der Refresh von mart.vergleichstag_basis lief ins Zeitlimit, nachdem eine '
        'zweite Session den Kalender-Nachlauf repariert hatte: 10 Bundeslaender '
        'wurden 16, 1.127 Feiertagszeilen wurden 1.760 — und der Plan kippte von '
        '40,9 s auf Abbruch nach 1.075 s, ohne dass jemand Code angefasst haette. '
        'Ursache war ein Join auf einem AUSDRUCK (geschaeftstag + 1), den Postgres '
        'nur als Filter pruefen konnte. Vor- und Folgetag sind jetzt Spalten der '
        'Tagesachse: 22,0 s.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
