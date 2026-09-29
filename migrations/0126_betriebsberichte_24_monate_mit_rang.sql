-- =====================================================================
-- 0126 Betriebsberichte: 24 Monate zurück, und die wichtigen zuerst
--
-- ANLASS (29.09.2026, Vorgabe Eugene). Die Historie der Betriebsberichte
-- lief bis HISTORIE_AB (2018-01-01) zurück, alle Berichte gleichrangig und
-- nur nach Datum sortiert. Gewünscht:
--
--   * nur 24 Monate zurück, nicht die ganze Historie;
--   * zuerst 75 und 76 (Zeitzonen — für die Prognose am wichtigsten),
--     dann 86, 92, 96, 113, danach die übrigen.
--
-- Gemessen am 29.09.2026 in Produktion: 5,6 s je Abruf (Median, nachts),
-- rund 7.000 Betriebsbericht-Abrufe je Nacht. Ein Monat kostet 92: 1.763
-- (Betrieb × Tag), 86/96/113: je 294 (Betrieb × Woche), jeder
-- Monatsbericht 59 (Betrieb × Monat) — zusammen rund 3.500. Vollständig
-- waren 12/2025 bis 08/2026; bis 10/2024 fehlen 14 Monate:
--   Rang 1 (75, 76)              ≈ 1.650 Abrufe  — die erste Nacht
--   Rang 2 (86, 92, 96, 113)     ≈ 37.000        — 5 bis 6 Nächte
--   Rang 3 (die übrigen 13)      ≈ 10.700        — 1 bis 2 Nächte danach
-- Bericht 88 bleibt abgeschaltet (0119).
--
-- DIE GRENZE STEHT IN DER DATENBANK, nicht in der Umgebung: der Einreihweg
-- (src/sync/nachfuellen.ts) und die Ladestand-Sicht lesen dieselbe
-- Funktion. Zwei Stellen mit derselben Zahl laufen irgendwann auseinander,
-- und dann meldet die Sicht als „nicht geladen", was der Importer gar
-- nicht holen soll. In mart, nicht in sync: die Sicht liest mcp_leser, und
-- ein Funktionsrumpf läuft mit den Rechten des Aufrufers.
--
-- DER RANG IST DIE PRIORITÄT DER POSTEN: 85, 86, 87 für die Historie
-- (nachladen = true). Laufende Tages- und Wochenberichte, der laufende
-- Monat von 97, Nachlauf und Gegenprobe bleiben bei 85 bzw. 50 — sie sind
-- Tagesgeschäft. sync.posten_holen zieht nach prioritaet, dann nach
-- zeitraum_von DESC; die Rangfolge braucht also keinen neuen Code im Worker.
-- =====================================================================

CREATE OR REPLACE FUNCTION mart.betriebsbericht_historie_ab()
RETURNS date
LANGUAGE sql STABLE
AS $$
    -- 24 Monate einschließlich des jüngsten reifen Monats (Reife 7 Tage).
    SELECT (date_trunc('month', current_date - 7) - interval '23 months')::date
$$;

COMMENT ON FUNCTION mart.betriebsbericht_historie_ab() IS
'Erster Monat, bis zu dem die Betriebsberichte zurueckgeladen werden (0126: 24 Monate).
Gelesen vom Einreihweg (betriebsberichteNachfuellen) und von mart.betriebsbericht_ladestand —
wer die Grenze aendert, aendert sie hier und nur hier.';


-- Offene Historienposten nach Rang einordnen. Nur nachladen = true: das
-- Tagesgeschäft behält seine Priorität.
UPDATE sync.warteschlange
   SET prioritaet = CASE
         WHEN endpunkt IN ('getReport:75', 'getReport:76')                                   THEN 85
         WHEN endpunkt IN ('getReport:86', 'getReport:92', 'getReport:96', 'getReport:113')  THEN 86
         ELSE 87 END
 WHERE erledigt_am IS NULL AND in_arbeit_seit IS NULL
   AND nachladen AND endpunkt LIKE 'getReport:%' AND prioritaet >= 85;


-- ---------------------------------------------------------------------
-- Die Ladestand-Übersicht zählt nur Monate ab der Grenze. Vorher stand bei
-- jedem Bericht „nicht geladen: 95 Monate mit Umsatz zwischen 01/2018 und
-- 11/2025" — richtig gemessen, aber nach dieser Entscheidung kein Rückstand.
-- mart.betriebsbericht_ladestand_monat bleibt unverändert: dort steht jeder
-- Monat, auch die älteren, mit seinem wirklichen Zustand.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    d   text := pg_get_viewdef('mart.betriebsbericht_ladestand'::regclass, true);
    muster constant text := 'FROM mart\.betriebsbericht_ladestand_monat l(\s*)\), s AS';
BEGIN
    IF d LIKE '%betriebsbericht_historie_ab%' THEN RETURN; END IF;
    IF (SELECT count(*) FROM regexp_matches(d, muster, 'g')) <> 1 THEN
        RAISE EXCEPTION '0126: mart.betriebsbericht_ladestand hat die erwartete Stelle nicht genau einmal — von Hand anpassen';
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW mart.betriebsbericht_ladestand AS '
         || regexp_replace(d, muster,
              'FROM mart.betriebsbericht_ladestand_monat l WHERE l.monat >= mart.betriebsbericht_historie_ab()\1), s AS');
END $$;


-- Probe: die Sicht ist für mcp_leser weiter lesbar (Funktionsrumpf!).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        SET LOCAL ROLE mcp_leser;
        PERFORM 1 FROM mart.betriebsbericht_ladestand LIMIT 1;
        RESET ROLE;
    END IF;
EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION '0126: mart.betriebsbericht_ladestand fuer mcp_leser nicht lesbar (%: %)', SQLSTATE, SQLERRM;
END $$;
