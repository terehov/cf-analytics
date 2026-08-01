-- ---------------------------------------------------------------------
-- 0026 Umsatzvergleich: derselbe verschwundene Nenner, andere Quelle
--
-- ANLASS: Nach 0025 waren die BWA-Quoten in der Ampel sauber -- und 141
-- Zeilen standen weiterhin ueber 1.000 %, alle im Bereich `umsatz`.
--
-- Der Grund: `umsatz_pct` kommt NICHT aus der BWA. Es ist der Vorjahres-
-- vergleich, den mart.round_table_basis selbst rechnet:
--
--     (umsatz_ist - umsatz_vj) / umsatz_vj * 100
--
-- Der Filter aus 0025 sitzt in mart.kennzahlen_aktuell und kann diesen Wert
-- deshalb gar nicht sehen. Gleiche Krankheit, anderer Weg ins Dashboard.
--
-- Nachgesehen (01.08.2026):
--
--     Park Cafe Muenchen  04/2022   225.047,23 EUR gegen 31,09 EUR  =  723.757 %
--     Zenz Wirtshaus      05/2022   135.442,57 EUR gegen 23,95 EUR  =  565.422 %
--
-- Das Vorjahr ist der Lockdown: im Fruehjahr 2021 waren die Haeuser zu und
-- buchten zweistellige Euro-Betraege. Das Wachstum ist echt, die Prozentzahl
-- ist es nicht -- sie misst nur, wie nah die Basis an null lag. Ein
-- Restaurant ist nicht um 723.757 % besser geworden.
--
-- Dieselbe Grenze wie in 0025 (1.000 %) und aus demselben Grund. Bewusst
-- KEINE zweite, eigene Schwelle: zwei Zahlen fuer denselben Gedanken sind
-- eine Zahl zu viel, und die zweite wird beim naechsten Mal vergessen.
-- Betroffen sind 141 von 4.657 Zeilen mit Vorjahresvergleich.
--
-- umsatz_ist und umsatz_vj bleiben unangetastet: die Euro-Betraege sind
-- richtig und stehen weiter nebeneinander. Nur die Prozentzahl, die sie ins
-- Verhaeltnis setzt, wird NULL -- die Ampel zeigt dann grau statt eines
-- Wachstums, das keines ist.
-- ---------------------------------------------------------------------

-- Die Schwelle steht ab hier an EINER Stelle. mart.bwa_prozent_plausibel
-- aus 0025 ruft sie nur noch auf, damit es nicht zwei Zahlen gibt, die
-- dasselbe meinen und irgendwann auseinanderlaufen.
CREATE OR REPLACE FUNCTION mart.prozent_plausibel(p_wert numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p_wert IS NULL OR abs(p_wert) > 1000 THEN NULL ELSE p_wert END
$$;

CREATE OR REPLACE FUNCTION mart.bwa_prozent_plausibel(p_wert numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT mart.prozent_plausibel(p_wert)
$$;

-- Postgres laesst den Typ einer Spalte nicht aendern, solange eine Sicht
-- darauf zeigt. Gleiche Mechanik wie in 0024: Baum aus dem Katalog holen,
-- tiefensortiert abraeumen, rueckwaerts wortgleich wiederherstellen.
DO $$
DECLARE
    v_sichten text[];
    v_def     text[] := '{}';
    v_komm    text[] := '{}';
    v_rechte  text[] := '{}';
    v_name    text;
    v_neu     text;
    i         int;
BEGIN
    WITH RECURSIVE deps AS (
        SELECT ('mart.round_table_basis'::text COLLATE "C") AS v, 0 AS tiefe
        UNION
        SELECT (n.nspname || '.' || c.relname COLLATE "C"), deps.tiefe + 1
          FROM deps
          JOIN pg_depend  d ON d.refobjid = deps.v::regclass
          JOIN pg_rewrite r ON r.oid = d.objid
          JOIN pg_class   c ON c.oid = r.ev_class
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('v', 'm')
           AND (n.nspname || '.' || c.relname COLLATE "C") <> deps.v
           AND deps.tiefe < 10
    )
    SELECT array_agg(v ORDER BY tiefe DESC, v) INTO v_sichten FROM deps;

    FOREACH v_name IN ARRAY v_sichten LOOP
        v_def  := v_def  || pg_get_viewdef(v_name::regclass, true);
        v_komm := v_komm || coalesce(obj_description(v_name::regclass, 'pg_class'), '');
        v_rechte := v_rechte || coalesce(
            (SELECT string_agg(format('GRANT %s ON %s TO %I',
                                      a.privilege_type, v_name, a.grantee), '; ')
               FROM information_schema.role_table_grants a
              WHERE a.table_schema || '.' || a.table_name = v_name
                AND a.grantee <> current_user), '');
        EXECUTE format('DROP VIEW %s', v_name);
    END LOOP;

    FOR i IN REVERSE array_length(v_sichten, 1) .. 1 LOOP
        v_neu := v_def[i];
        -- Nur die Wurzel wird angefasst; alles darueber liest sie ohnehin.
        IF v_sichten[i] = 'mart.round_table_basis' THEN
            v_neu := replace(
                v_neu,
                'WHEN v.umsatz > 0::numeric THEN round((u.umsatz - v.umsatz) / v.umsatz * 100::numeric, 2)',
                'WHEN v.umsatz > 0::numeric THEN mart.prozent_plausibel('
                || 'round((u.umsatz - v.umsatz) / v.umsatz * 100::numeric, 2))');
            IF v_neu = v_def[i] THEN
                RAISE EXCEPTION
                  'mart.round_table_basis sieht anders aus als erwartet -- '
                  'die Umsatzvergleichsformel wurde nicht gefunden. 0026 pruefen.';
            END IF;
        END IF;
        EXECUTE format('CREATE VIEW %s AS %s', v_sichten[i], v_neu);
        IF v_komm[i] <> '' THEN
            EXECUTE format('COMMENT ON VIEW %s IS %L', v_sichten[i], v_komm[i]);
        END IF;
        IF v_rechte[i] <> '' THEN EXECUTE v_rechte[i]; END IF;
    END LOOP;
END $$;

COMMENT ON FUNCTION mart.prozent_plausibel IS
'Allgemeine Plausibilitaetsgrenze fuer Prozentwerte in mart: ueber 1.000 Prozent wird NULL.
Gemeinsame Schwelle fuer BWA-Quoten (mart.bwa_prozent_plausibel, siehe 0025) und den
Umsatz-Vorjahresvergleich (siehe 0026) -- beide scheitern am selben verschwundenen Nenner.';

-- Nachweis, dass wirklich nichts Unplausibles mehr in der Ampel steht.
-- Lieber hier laut scheitern als im Round Table leise gruen leuchten.
DO $$
DECLARE v_n int; v_max numeric;
BEGIN
    SELECT count(*), max(abs(wert)) INTO v_n, v_max
      FROM mart.ampel_bereich WHERE abs(wert) > 1000;
    IF v_n > 0 THEN
        RAISE EXCEPTION
          'mart.ampel_bereich enthaelt weiterhin % Zeile(n) ueber 1.000 %% (max %)',
          v_n, v_max;
    END IF;
END $$;
