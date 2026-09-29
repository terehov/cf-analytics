-- =====================================================================
-- 0127 Der Lückenmonitor: je Quelle, Betrieb und Monat, was fehlt
--
-- ANLASS (29.09.2026). Sieben Monate Wetter fehlten, sieben operative
-- Betriebe hatten keinen Standort, Enchilada Aalen hatte seit 02.08.2026
-- keinen Umsatz — und keine Prüfung meldete etwas. Jede Quelle hatte eine
-- Frische-Prüfung („kam gestern etwas an?", mart.quelle_zulauf), keine eine
-- Vollständigkeits-Prüfung („fehlt irgendwo ein Tag?"). Eine Lücke in der
-- Mitte sieht aus wie Ruhe (harte Regel 10).
--
-- mart.luecke_monat führt eine Zeile je Lücke, 24 Monate zurück:
--
--   Umsatz            Tag ohne Umsatzzeile          LINA hat für den Tag nichts
--                                                   geliefert, nicht einmal 0,00
--   Umsatz            operativer Betrieb seit mehr  die Enchilada-Aalen-Signatur:
--                     als 8 Tagen ohne Umsatz       Zeilen kommen, Umsatz nicht
--   Wetter            Tag ohne Wetter               Betrieb mit Koordinate
--   Wetter            Betrieb ohne Koordinate
--   Kalender          Betrieb ohne Bundesland       keine Feiertage, keine Ferien
--   BWA               Monat ohne gebuchte BWA       ab dem ersten Monat mit
--                                                   Geschäft, bis vor drei Monaten
--   Betriebsberichte  Monat nicht vollstaendig      je Bericht, ab der Grenze aus 0126
--
-- Betrachtet werden die Betriebe im Geschäft: operativ, inaktiv, fremdkasse.
-- Geschlossene, verwaltende und Testbetriebe haben keine Lücken, sondern
-- keine Daten.
--
-- ERWARTUNG: leer bis auf den Rückstand des Betriebsbericht-Nachladens
-- (fällt Nacht für Nacht) und Monate, deren BWA die Buchhaltung noch nicht
-- gebucht hat. Jede Zeile in Umsatz oder Wetter ist ein Fehler.
-- =====================================================================

CREATE OR REPLACE VIEW mart.luecke_monat AS
WITH fenster AS (
    SELECT (date_trunc('month', current_date) - interval '23 months')::date AS von
), bs AS (
    SELECT s.betrieb_key, s.betrieb, s.status, s.letzter_umsatztag
      FROM mart.betrieb_status s
     WHERE s.status IN ('operativ', 'inaktiv', 'fremdkasse')
), lina AS (
    SELECT bs.*,
           (SELECT min(t.geschaeftstag) FROM core.umsatzbericht_tag t
             WHERE t.betrieb_key = bs.betrieb_key
               AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL
               AND t.umsatz_netto > 0) AS erster_umsatztag
      FROM bs
     WHERE bs.status IN ('operativ', 'inaktiv')
),
-- 1. Umsatz: Tag ohne Zeile. Bis heute − 7: LINA füllt die jüngsten 5–6
--    Tage nach, davor ist eine fehlende Zeile Bauart, kein Befund.
umsatz_tag AS (
    SELECT 'Umsatz'::text AS quelle, 'Tag ohne Umsatzzeile'::text AS pruefung,
           l.betrieb_key, l.betrieb, l.status,
           date_trunc('month', d)::date AS monat, count(*)::int AS fehlend, 'Tage'::text AS einheit,
           'LINA hat fuer diese Tage keine Zeile geliefert, nicht einmal 0,00 EUR. '
           || 'Nachholung: mart.umsatz_lochtag / mart.umsatztag_luecke'::text AS hinweis
      FROM lina l
     CROSS JOIN fenster f
     CROSS JOIN LATERAL generate_series(greatest(f.von, l.erster_umsatztag), current_date - 7,
                                        interval '1 day') d
     WHERE NOT EXISTS (
             SELECT 1 FROM core.umsatzbericht_tag t
              WHERE t.betrieb_key = l.betrieb_key AND t.geschaeftstag = d::date
                AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL)
     GROUP BY l.betrieb_key, l.betrieb, l.status, date_trunc('month', d)
),
-- 2. Umsatz: operativ, aber seit mehr als 8 Tagen 0,00 EUR (dieselbe
--    Schwelle wie mart.datenstand). Nach 60 Tagen wird der Betrieb
--    'inaktiv' und fällt hier heraus — bis dahin soll es jemand sehen.
umsatz_null AS (
    SELECT 'Umsatz'::text, 'operativer Betrieb seit mehr als 8 Tagen ohne Umsatz'::text,
           bs.betrieb_key, bs.betrieb, bs.status,
           date_trunc('month', current_date)::date, (current_date - bs.letzter_umsatztag)::int, 'Tage'::text,
           'Letzter Umsatz am ' || to_char(bs.letzter_umsatztag, 'DD.MM.YYYY')
           || '. LINA liefert weiter Zeilen mit 0,00 EUR — geschlossen, umgebaut, Kasse gewechselt?'
      FROM bs
     WHERE bs.status = 'operativ' AND bs.letzter_umsatztag < current_date - 8
),
-- 3. Wetter: Betrieb ohne Koordinate, und Tag ohne Wetter bis vorgestern.
wetter_ort AS (
    SELECT 'Wetter'::text, 'Betrieb ohne Koordinate'::text,
           bs.betrieb_key, bs.betrieb, bs.status,
           date_trunc('month', current_date)::date, 1, 'Betrieb'::text,
           'Kein Standort mit Koordinate, also kein Wetter. Der Nachtlauf ergaenzt ihn aus der '
           || 'LINA-Adresse (src/standort/ergaenzen.ts); sonst pflege/betrieb_standort.csv'
      FROM bs
      LEFT JOIN manual.betrieb_standort s ON s.betrieb_key = bs.betrieb_key
     WHERE s.breitengrad IS NULL
),
wetter_vorhanden AS (
    SELECT w.betrieb_key, w.geschaeftstag
      FROM mart.betrieb_wetter_tag w
     WHERE w.geschaeftstag >= (SELECT von FROM fenster)
),
wetter_tag AS (
    SELECT 'Wetter'::text, 'Tag ohne Wetter'::text,
           bs.betrieb_key, bs.betrieb, bs.status,
           date_trunc('month', d)::date, count(*)::int, 'Tage'::text,
           'Standort mit Koordinate, aber kein Wetter fuer den Tag. Arbeitsliste: mart.wetter_rueckstand'
      FROM bs
      JOIN manual.betrieb_standort s ON s.betrieb_key = bs.betrieb_key AND s.breitengrad IS NOT NULL
     CROSS JOIN fenster f
     CROSS JOIN LATERAL generate_series(f.von, current_date - 2, interval '1 day') d
      LEFT JOIN wetter_vorhanden w ON w.betrieb_key = bs.betrieb_key AND w.geschaeftstag = d::date
     WHERE w.betrieb_key IS NULL
     GROUP BY bs.betrieb_key, bs.betrieb, bs.status, date_trunc('month', d)
),
-- 4. Kalender: ohne PLZ in manual.plz_bundesland kein Bundesland, keine
--    Feiertage, keine Ferien (dieselbe Verknüpfung wie mart.kalender_fehlend).
kalender AS (
    SELECT 'Kalender'::text, 'Betrieb ohne Bundesland'::text,
           bs.betrieb_key, bs.betrieb, bs.status,
           date_trunc('month', current_date)::date, 1, 'Betrieb'::text,
           CASE WHEN s.betrieb_key IS NULL THEN 'Kein Standort gepflegt'
                WHEN s.plz IS NULL THEN 'Standort ohne PLZ'
                ELSE 'PLZ ' || s.plz || ' fehlt in manual.plz_bundesland' END
      FROM bs
      LEFT JOIN manual.betrieb_standort s ON s.betrieb_key = bs.betrieb_key
      LEFT JOIN manual.plz_bundesland p ON p.plz = s.plz
     WHERE p.plz IS NULL
),
-- 5. BWA: Monat ohne gebuchten Wert, ab dem ersten Monat mit Geschäft
--    (Umsatz oder gebuchte BWA) bis vor drei Monaten — die Buchhaltung ist
--    nie tagesaktuell, und datenstand.bwa_verzug_monate zeigt den Rest.
bwa_start AS (
    SELECT bs.*,
           least((SELECT date_trunc('month', min(t.geschaeftstag))::date
                    FROM core.umsatzbericht_tag t
                   WHERE t.betrieb_key = bs.betrieb_key
                     AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL
                     AND t.umsatz_netto > 0),
                 (SELECT min(km.monat) FROM core.kennzahlen_monat km
                   WHERE km.betrieb_key = bs.betrieb_key
                     AND km.wert_absolut::numeric(14,2) <> 0)) AS erster_monat
      FROM bs
),
bwa AS (
    SELECT 'BWA'::text, 'Monat ohne gebuchte BWA'::text,
           b.betrieb_key, b.betrieb, b.status,
           m::date, 1, 'Monat'::text,
           'Keine BWA-Kennzahl ungleich 0 fuer diesen Monat — noch nicht gebucht, oder unter '
           || 'einem anderen Mandanten'
      FROM bwa_start b
     CROSS JOIN fenster f
     CROSS JOIN LATERAL generate_series(greatest(f.von, b.erster_monat),
                                        date_trunc('month', current_date) - interval '3 months',
                                        interval '1 month') m
     WHERE b.erster_monat IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM core.kennzahlen_monat km
              WHERE km.betrieb_key = b.betrieb_key AND km.monat = m::date
                AND km.wert_absolut::numeric(14,2) <> 0)
),
-- 6. Betriebsberichte: je Bericht und Monat, ab der Grenze aus 0126, nur
--    reife Monate (dieselbe Reife wie mart.betriebsbericht_ladestand).
berichte AS (
    SELECT 'Betriebsberichte'::text, 'Monat nicht vollstaendig'::text,
           NULL::integer, 'Bericht ' || l.bericht, NULL::text,
           l.monat,
           CASE WHEN l.fensterklasse IN ('T', 'W')
                THEN greatest(l.betrieb_tage_mit_umsatz - l.betrieb_tage_abgedeckt, 0)
                ELSE greatest(l.betriebe_mit_umsatz - l.betriebe_geladen - l.betriebe_leer, 0) END,
           CASE WHEN l.fensterklasse IN ('T', 'W') THEN 'Betrieb-Tage' ELSE 'Betriebe' END,
           l.zustand || ' — Rueckstand des Nachladens faellt Nacht fuer Nacht (Rang: '
           || CASE WHEN l.bericht IN (75, 76) THEN '1' WHEN l.bericht IN (86, 92, 96, 113) THEN '2'
                   ELSE '3' END || '). Steht ein Monat mehrere Naechte unveraendert, klemmt es.'
      FROM mart.betriebsbericht_ladestand_monat l
     WHERE l.monat >= mart.betriebsbericht_historie_ab()
       AND l.zustand IN ('teilweise', 'nicht geladen')
       AND CASE WHEN l.fensterklasse IN ('T', 'W')
                THEN l.monat <= date_trunc('month', current_date - 9)::date
                ELSE (l.monat + interval '1 month')::date - 1 <= current_date - 9 END
)
SELECT * FROM umsatz_tag
UNION ALL SELECT * FROM umsatz_null
UNION ALL SELECT * FROM wetter_ort
UNION ALL SELECT * FROM wetter_tag
UNION ALL SELECT * FROM kalender
UNION ALL SELECT * FROM bwa
UNION ALL SELECT * FROM berichte;

COMMENT ON VIEW mart.luecke_monat IS
'Was fehlt, je Quelle, Betrieb und Monat, 24 Monate zurueck (0127). Eine Zeile je Luecke:
quelle, pruefung, betrieb (bei Betriebsberichten der Bericht), monat, fehlend + einheit, hinweis.
Betrachtet werden Betriebe im Geschaeft (operativ, inaktiv, fremdkasse). ERWARTUNG: leer bis auf
den Rueckstand des Betriebsbericht-Nachladens und die noch nicht gebuchte BWA der letzten Monate.
Eine Zeile unter Umsatz oder Wetter ist ein Fehler. Zusammengefasst in mart.pruefung_uebersicht
(Zeilen "Luecke: …") und in /status.';


-- ---------------------------------------------------------------------
-- Prüfübersicht: eine Zeile je Prüfung, auch wenn sie null ist — eine
-- Zeile, die bei null verschwindet, sieht aus wie eine, die es nicht gibt.
-- Angehängt wie in 0114 und 0121.
-- ---------------------------------------------------------------------
DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%luecke_monat%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        SELECT ('Luecke: ' || p.quelle || ': ' || p.pruefung || ' (24 Monate)')::text AS pruefung,
               (SELECT count(*) FROM mart.betrieb_status
                 WHERE status IN ('operativ', 'inaktiv', 'fremdkasse'))::bigint AS geprueft,
               count(l.quelle)::bigint AS auffaellig,
               'mart.luecke_monat'::text AS sicht
          FROM (VALUES ('Umsatz', 'Tag ohne Umsatzzeile', 1),
                       ('Umsatz', 'operativer Betrieb seit mehr als 8 Tagen ohne Umsatz', 2),
                       ('Wetter', 'Betrieb ohne Koordinate', 3),
                       ('Wetter', 'Tag ohne Wetter', 4),
                       ('Kalender', 'Betrieb ohne Bundesland', 5),
                       ('BWA', 'Monat ohne gebuchte BWA', 6),
                       ('Betriebsberichte', 'Monat nicht vollstaendig', 7)) p(quelle, pruefung, nr)
          LEFT JOIN mart.luecke_monat l ON l.quelle = p.quelle AND l.pruefung = p.pruefung
         GROUP BY p.quelle, p.pruefung, p.nr
        $zweig$);
END $aussen$;


-- Probe: für mcp_leser lesbar (Funktionsrumpf von betriebsbericht_historie_ab).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        SET LOCAL ROLE mcp_leser;
        PERFORM 1 FROM mart.luecke_monat LIMIT 1;
        RESET ROLE;
    END IF;
EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION '0127: mart.luecke_monat fuer mcp_leser nicht lesbar (%: %)', SQLSTATE, SQLERRM;
END $$;

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht
   SET koernung = 'Quelle × Pruefung × Betrieb (bei Betriebsberichten: Bericht) × Monat — '
                  'eine Zeile je Luecke, 24 Monate zurueck',
       thema = 'pruefung',
       summen_erlaubt = false
 WHERE sicht = 'mart.luecke_monat';

INSERT INTO mcp.kennzahl (sicht, spalte, regel, einheit, hinweis) VALUES
  ('mart.luecke_monat', 'fehlend', 'nicht_aggregieren', NULL,
   'Einheit steht in der Spalte einheit (Tage, Betrieb-Tage, Betriebe, Monat) — nie ueber Einheiten summieren.')
ON CONFLICT (sicht, spalte) DO NOTHING;
