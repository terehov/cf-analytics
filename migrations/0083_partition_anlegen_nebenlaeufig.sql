-- =====================================================================
-- 0083 partition_anlegen vertraegt zwei gleichzeitige Anrufer
--
-- ANLASS. Mit 0082 laufen LINA und FoodNotify in getrennten Schleifen
-- nebeneinander. Beide Ladepfade rufen als ERSTE Handlung ihrer
-- Transaktion `core.partition_anlegen('raw.api_antwort', ...)` — und
-- zwar mit unnest(ARRAY[current_date, current_date + 1]), also am
-- letzten Tag jedes Monats fuer die noch fehlende Folgemonatspartition.
--
-- Die Funktion prueft mit IF NOT EXISTS und legt dann an. Zwischen
-- Pruefung und CREATE liegt ein Fenster, und in genau diesem Fenster
-- steht ab 0082 zum ersten Mal ein zweiter Anrufer. Nachgestellt auf
-- PostgreSQL 18.4 mit einem pg_sleep in diesem Fenster:
--
--   [B] COMMIT
--   [A] ERROR:  relation "p_2026_10" already exists
--   [A] CONTEXT: SQL statement "CREATE TABLE part.p_2026_10 PARTITION OF ..."
--
-- Das reisst die ganze Ladetransaktion mit. Kosten waeren gering (ein
-- Posten je Schleife, einmal im Monat, danach Wiedervorlage) — aber es
-- ist ein Fehler, der nur am Monatsletzten auftritt, nur bei genau
-- gleichzeitigem Laden, und der wie ein zufaelliger Ladefehler aussieht.
-- Die Sorte, die man dreimal sucht und zweimal nicht findet.
--
-- WARUM NICHT "vor der Transaktion aufrufen". Das waere der gruendlichere
-- Weg: `CREATE TABLE ... PARTITION OF` nimmt eine AccessExclusiveLock auf
-- die ELTERNtabelle und haelt sie bis zum COMMIT — nachgemessen:
--
--   p            | AccessExclusiveLock   <- bis COMMIT
--   part.p_2026_09 | AccessExclusiveLock
--   p_pkey       | ShareUpdateExclusiveLock
--
-- Solange die eine Schleife also ihre Ladetransaktion offen hat, warten
-- die INSERTs der anderen in `raw.api_antwort`. Das ist ein Stau in der
-- Laenge EINER Ladetransaktion, einmal im Monat — hinnehmbar, und der
-- Umbau der drei Ladepfade auf einen Aufruf ausserhalb der Transaktion
-- ist eine eigene Aenderung mit eigenem Risiko. Sie steht in
-- docs/offene-punkte.md. Was hier behoben wird, ist der ABBRUCH.
--
-- ZWEI GUERTEL, weil einer nicht reicht. `CREATE TABLE IF NOT EXISTS`
-- schliesst das Fenster nicht vollstaendig — auch dort liegt zwischen
-- Katalogpruefung und Anlegen ein Moment. Der EXCEPTION-Zweig faengt,
-- was durchkommt. Beide zusammen sind die uebliche Bauform fuer
-- "anlegen, falls noch nicht da" unter Nebenlaeufigkeit.
--
-- Der Rest der Funktion ist unveraendert: derselbe Name, dasselbe
-- Zielschema `part`, derselbe BRIN-Index mit autosummarize.
-- =====================================================================

CREATE OR REPLACE FUNCTION core.partition_anlegen(p_tabelle regclass, p_monat date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_von     date := date_trunc('month', p_monat)::date;
    v_bis     date := (date_trunc('month', p_monat) + interval '1 month')::date;
    v_basis   text := split_part(p_tabelle::text, '.', 2);
    v_name    text := format('%s_%s', v_basis, to_char(v_von,'YYYY_MM'));
    v_datumsspalte text := CASE WHEN v_basis = 'api_antwort' THEN 'abgerufen_am' ELSE 'geschaeftstag' END;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE c.relname = v_name AND n.nspname = 'part') THEN
        BEGIN
            -- Das Kind landet in `part`, nicht neben der Elterntabelle.
            EXECUTE format('CREATE TABLE IF NOT EXISTS part.%I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
                           v_name, p_tabelle::text, v_von, v_bis);
            -- BRIN gleich mit autosummarize: ohne das bleiben frisch angehaengte
            -- Bloecke bis zum naechsten VACUUM unsummiert - also genau die Zeilen,
            -- die eine Round-Table-Auswertung am haeufigsten liest.
            --
            -- DER INDEX BEKOMMT JETZT SEINEN NAMEN AUSGESCHRIEBEN, und zwar
            -- exakt den, den PostgreSQL selbst vergeben haette
            -- (<tabelle>_<spalte>_idx). Ohne Namen gibt es kein IF NOT EXISTS,
            -- und dann legte der Fall "CREATE TABLE hat uebersprungen, weil
            -- die andere Schleife schneller war" einen ZWEITEN BRIN-Index auf
            -- dieselbe Spalte. Erlaubt, still, und dauerhaft doppelte
            -- Schreiblast. Alte Partitionen heissen unveraendert genauso.
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON part.%I USING brin (%I) WITH (autosummarize = on)',
                           format('%s_%s_idx', v_name, v_datumsspalte), v_name, v_datumsspalte);
        EXCEPTION
            -- Die andere Schleife war schneller. Das ist der Erfolgsfall,
            -- nur von der anderen Seite gesehen: die Partition ist da, und
            -- genau darum ging es. Kein Log, kein Fehler, weiterarbeiten.
            --
            -- Drei Klassen, weil ein Rennen an drei Stellen sichtbar wird:
            -- duplicate_table (42P07) beim CREATE TABLE, duplicate_object
            -- (42710) beim Index, unique_violation (23505) direkt auf einem
            -- Katalogindex, wenn beide im selben Augenblick schreiben.
            WHEN duplicate_table OR duplicate_object OR unique_violation THEN NULL;
        END;
    END IF;
END $$;

COMMENT ON FUNCTION core.partition_anlegen IS
'Legt bei Bedarf die Monatspartition an - im Schema `part`, nicht neben der Elterntabelle -,
inklusive BRIN-Index mit autosummarize. Der Importer ruft das vor dem Schreiben auf, so gibt
es keinen Wartungsjob, den man vergessen kann.

Seit 0082 rufen ZWEI Schleifen (LINA, FoodNotify) das gleichzeitig auf. Deshalb seit 0083
IF NOT EXISTS plus EXCEPTION-Zweig: am Monatsletzten trafen sich sonst beide im Fenster
zwischen Pruefung und CREATE, und die Verliererin brach ihre ganze Ladetransaktion ab
("relation ... already exists"). Der Fehler war nachstellbar und trat nur an einem Tag im
Monat auf.

Hinweis: Storage-Parameter lassen sich NICHT auf dem partitionierten Index setzen
("This operation is not supported for partitioned indexes"), nur je Kindindex.

BLEIBT OFFEN: CREATE TABLE ... PARTITION OF haelt eine AccessExclusiveLock auf die
ELTERNtabelle bis zum COMMIT. Solange eine Ladetransaktion offen ist, warten die INSERTs
der anderen Schleife in raw.api_antwort. Einmal im Monat, Dauer einer Ladetransaktion.
Der Aufruf gehoert eigentlich VOR die Transaktion — siehe docs/offene-punkte.md.';
