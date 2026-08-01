-- ---------------------------------------------------------------------
-- 0024 BWA: die Prozentspalte war zu schmal
--
-- ANLASS: Lauf 19 (31.07.2026) scheiterte an drei Jahren am Stueck --
-- getKennzahlen:relativ fuer 2019, 2020 und 2021, jedes Mal
-- „numeric field overflow". Nachgemessen an den echten Antworten:
--
--   2019  EBIT      7.296.817,65 %   Aposto Muenchen (GESCHLOSSEN), Dez
--   2021  EBIT      5.507.000    %
--   2020  EBIT      1.565.200    %
--
-- `wert_prozent numeric(8,2)` fasst 999.999,99. Betroffen sind 1 bis 2
-- Zeilen von 7.860 je Jahr -- aber eine genuegt, um den ganzen Jahresposten
-- abzubrechen.
--
-- DAS IST KEIN DEFEKT IN DEN DATEN, sondern die Bauart der Kennzahl --
-- dieselbe wie bei den Personalkosten in 0010. Eine BWA-Quote hat den Umsatz
-- im Nenner, und der geht bei geschlossenen Betrieben gegen null. Ein Haus,
-- das im Dezember 2022 dicht macht, bucht weiter Restkosten auf einen Umsatz
-- von ein paar Euro: das Ergebnis sind Millionen Prozent. 2020 und 2021 sind
-- Coronajahre, in denen das kein Einzelfall war. Nicht zufaellig fehlten
-- genau diese drei Jahre und lief 2018 durch.
--
-- Der Unterschied zum Artikelverkauf desselben Laufs, der ebenfalls an
-- „numeric field overflow" scheiterte: dort stand `menge = 2147483649`
-- (2^31+1) bei Umsatz null -- ein Ueberlauf, kein Messwert. Der gehoert
-- verworfen, nicht gespeichert, und wird in src/transform/index.ts (`menge`)
-- abgefangen. Gleiche Fehlermeldung, gegenteilige Antwort: hier ist die
-- Spalte zu schmal, dort war der Wert falsch.
--
-- WARUM ES MEHR KOSTET, ALS ES AUSSIEHT: `laden()` schreibt Rohantwort und
-- core in EINER Transaktion. Scheitert das Schreiben, rollt der Raw-Layer mit
-- zurueck -- die Versicherung greift ausgerechnet dann nicht, wenn man sie
-- braucht. Genau deshalb war zu den drei Jahren nichts mehr nachzusehen; die
-- Zahlen oben mussten neu bei LINA geholt werden.
--
-- Die Breite: numeric(14,2) fasst 10^12 Prozent. Grosszuegig mit Absicht --
-- der Nenner kann beliebig klein werden, und eine zweite Runde derselben
-- Migration ist teurer als vier ungenutzte Stellen.
-- ---------------------------------------------------------------------

-- Postgres aendert den Typ einer Spalte nicht, solange eine Sicht darauf
-- zeigt -- und an `wert_prozent` haengen zwoelf, ueber vier Ebenen bis hinauf
-- zu mart.round_table_trend.
--
-- Anders als 0010 wird die Liste NICHT von Hand gefuehrt. Eine hier
-- eingefrorene Aufzaehlung ist beim naechsten neuen Dashboard still
-- unvollstaendig, und das faellt erst auf, wenn diese Migration auf einer
-- frischen Datenbank eine Sicht verschluckt. Stattdessen wird der Abhaengig-
-- keitsbaum im Katalog erfragt, in Tiefenreihenfolge abgeraeumt und
-- rueckwaerts wortgleich wiederhergestellt -- samt Kommentar und Rechten.
DO $$
DECLARE
    v_sichten text[];
    v_def     text[] := '{}';
    v_komm    text[] := '{}';
    v_rechte  text[] := '{}';
    v_name    text;
    i         int;
BEGIN
    -- Tiefensortiert: Blaetter zuerst weg, Wurzel zuletzt.
    WITH RECURSIVE deps AS (
        SELECT ('core.kennzahlen_monat'::text COLLATE "C") AS v, 0 AS tiefe
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
    SELECT array_agg(v ORDER BY tiefe DESC, v)
      INTO v_sichten
      FROM deps
     WHERE tiefe > 0;

    IF v_sichten IS NULL THEN v_sichten := '{}'; END IF;

    FOREACH v_name IN ARRAY v_sichten LOOP
        -- Der enge Cast wird beim Sichern mitkorrigiert. Wortgleich
        -- wiederherstellen waere hier falsch: mart.kennzahlen_aktuell
        -- schnitt wert_prozent selbst wieder auf numeric(8,2) zurecht und
        -- haette den Ueberlauf vom Schreiben ins Lesen verschoben -- der
        -- Import liefe durch, und das Dashboard zeigte den Fehler. Auf einer
        -- frisch aufgesetzten Datenbank steht der weite Cast schon in
        -- 0006_mart.sql; diese Ersetzung greift dann ins Leere.
        v_def  := v_def  || CASE WHEN v_name = 'mart.kennzahlen_aktuell'
                                 THEN replace(pg_get_viewdef(v_name::regclass, true),
                                              'numeric(8,2)', 'numeric(14,2)')
                                 ELSE pg_get_viewdef(v_name::regclass, true)
                            END;
        v_komm := v_komm || coalesce(obj_description(v_name::regclass, 'pg_class'), '');
        -- Rechte mitnehmen: metabase liest diese Sichten, und ein stiller
        -- Rechteverlust sieht im Dashboard aus wie fehlende Daten.
        v_rechte := v_rechte || coalesce(
            (SELECT string_agg(format('GRANT %s ON %s TO %I',
                                      a.privilege_type, v_name, a.grantee), '; ')
               FROM information_schema.role_table_grants a
              WHERE a.table_schema || '.' || a.table_name = v_name
                AND a.grantee <> current_user), '');
        EXECUTE format('DROP VIEW %s', v_name);
    END LOOP;

    ALTER TABLE core.kennzahlen_monat
        ALTER COLUMN wert_prozent TYPE numeric(14,2);

    -- Rueckwaerts: die Wurzel zuerst, damit ihre Nutzer sie vorfinden.
    FOR i IN REVERSE array_length(v_sichten, 1) .. 1 LOOP
        EXECUTE format('CREATE VIEW %s AS %s', v_sichten[i], v_def[i]);
        IF v_komm[i] <> '' THEN
            EXECUTE format('COMMENT ON VIEW %s IS %L', v_sichten[i], v_komm[i]);
        END IF;
        IF v_rechte[i] <> '' THEN
            EXECUTE v_rechte[i];
        END IF;
    END LOOP;
END $$;

-- Nachweis, dass die Verbreiterung wirklich durchgreift -- Spalte UND jede
-- Sicht darueber. Ein enger Cast irgendwo im Baum haette den Ueberlauf nur
-- vom Schreiben ins Lesen verschoben: der Import liefe durch, und der Fehler
-- erschiene im Dashboard. Lieber hier laut scheitern als dort leise.
DO $$
DECLARE v_eng text;
BEGIN
    IF (SELECT numeric_precision FROM information_schema.columns
         WHERE table_schema = 'core' AND table_name = 'kennzahlen_monat'
           AND column_name = 'wert_prozent') <> 14 THEN
        RAISE EXCEPTION 'core.kennzahlen_monat.wert_prozent ist nicht numeric(14,2)';
    END IF;

    SELECT string_agg(n.nspname || '.' || c.relname, ', ')
      INTO v_eng
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('v', 'm')
       AND n.nspname IN ('mart', 'core')
       AND position('numeric(8,2)' in pg_get_viewdef(c.oid, true)) > 0;

    IF v_eng IS NOT NULL THEN
        RAISE EXCEPTION 'enger Cast numeric(8,2) noch vorhanden in: %', v_eng;
    END IF;
END $$;

COMMENT ON COLUMN core.kennzahlen_monat.wert_prozent IS
'BWA-Kennzahl in Prozent (mode=relativ). 23.64 = 23,64 %.

ACHTUNG BEI DER GROESSENORDNUNG: Diese Quoten haben den Umsatz im Nenner, und der geht bei
geschlossenen Betrieben gegen null. Gemessen am 01.08.2026: EBIT bis 7.296.817,65 Prozent
(Aposto Muenchen, Dezember 2019, Betrieb geschlossen). Wer hier mittelt statt den Median zu
nehmen, bekommt Unsinn -- und wer die Spalte enger macht, verliert ganze JAHRE an einem
numeric field overflow, weil getKennzahlen jahrweise laedt.';


-- ---------------------------------------------------------------------
-- Die gescheiterten Posten zurueck in die Schlange
--
-- Sie sind an uns gescheitert, nicht an LINA. Der verbrauchte Versuch
-- gehoert deshalb zurueck, sonst zaehlt er auf MAX_VERSUCHE mit. Der
-- Artikelverkauf ist mit dabei: sein Ueberlauf ist ab jetzt in der
-- Transformation abgefangen.
-- ---------------------------------------------------------------------

UPDATE sync.warteschlange
   SET versuche = 0, faellig_ab = now(), letzter_fehler = NULL,
       erledigt_am = NULL, ergebnis = NULL
 WHERE endpunkt IN ('getKennzahlen:relativ', 'getKennzahlen:absolut',
                    'getArtikelverkaufsbericht')
   AND letzter_fehler LIKE '%numeric field overflow%';
