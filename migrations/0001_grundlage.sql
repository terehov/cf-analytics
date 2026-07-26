-- =====================================================================
-- Concept Family Analytics — Grundlage
-- Quelle: LINA TeamCloud (app.lina.de), siehe docs/lina-api-inventar.md
-- Zielplattform: PostgreSQL 18
--
-- NAMENSKONVENTION
--   Fachbegriffe kommen aus LINA und bleiben deutsch: Betrieb, Konzept,
--   Umsatz, Wareneinsatz, BWA, Ampel, Hauptsparte, Verkaufsstelle. Wo LINA
--   einen Bericht so nennt, heisst die Tabelle auch so (umsatzbericht_tag,
--   personalkosten, kennzahlen_monat). Damit ist die Zuordnung zwischen
--   Endpunkt und Tabelle ohne Uebersetzungsschritt lesbar - und genau da
--   entstehen sonst die Fehler.
--
--   Englisch bleiben ausschliesslich die Schichtnamen (raw, core, part,
--   manual, sync, mart). Das sind Architekturbegriffe, keine LINA-Begriffe.
--
-- WEITERE KONVENTIONEN
--   * Prozentwerte IMMER als Prozentzahl (23.64), NIE als Bruch (0.2364).
--     Das Excel speichert Brueche, LINA liefert Prozent - hier gilt Prozent.
--   * Geldbetraege numeric(14,2), niemals float.
--   * Zeitpunkte timestamptz (intern UTC). Geschaeftsdaten als date, ohne
--     Zeitzone - Begruendung weiter unten in dieser Datei.
--
-- REIHENFOLGE DER MIGRATIONEN
--   0001 Grundlage      Schemata, Zeitbehandlung, Partitionsverwaltung
--   0002 Stammdaten     Dimensionen und ihre monatliche Historie
--   0003 Bewegungsdaten raw-Layer und die Faktentabellen
--   0004 Bewertung      manuelle Eingaben und das Ampelregelwerk
--   0005 Sync           Betriebszustand des Importers
--   0006 Mart           die Sichten, mit denen Metabase arbeitet
-- =====================================================================


-- ---------------------------------------------------------------------
-- Schichten
--
-- Die Aufteilung hat einen sehr praktischen Grund: Metabase zeigt alles an,
-- was es findet. Wer dort 150 Tabellen sieht, findet die fuenf richtigen
-- nicht mehr. Deshalb steht in `core` nur, was fachlich etwas bedeutet, und
-- alles Technische liegt woanders - insbesondere die Partitionen.
-- ---------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS part;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS manual;
CREATE SCHEMA IF NOT EXISTS ampel;
CREATE SCHEMA IF NOT EXISTS sync;
CREATE SCHEMA IF NOT EXISTS mart;

COMMENT ON SCHEMA raw    IS 'Unveraenderte API-Antworten aus LINA. Append-only, niemals UPDATE/DELETE. Versicherung gegen Schemaaenderungen: bei Bedarf wird von hier neu transformiert. In Metabase ausblenden.';
COMMENT ON SCHEMA part   IS 'NUR PARTITIONSKINDER. Hier steht kein einziger eigenstaendiger Fakt - jede Tabelle ist ein Monatsstueck einer Tabelle aus core oder raw und wird ueber die Elterntabelle dort abgefragt. In Metabase ausblenden.';
COMMENT ON SCHEMA core   IS 'Stammdaten und Bewegungsdaten, aus raw abgeleitet. Darf jederzeit neu aufgebaut werden. Tabellen heissen wie die LINA-Berichte, aus denen sie stammen.';
COMMENT ON SCHEMA manual IS 'Daten ohne Quelle in LINA: OM-Einschaetzung, Ursachen, Massnahmen, Online-Bewertungen (YEXT).';
COMMENT ON SCHEMA ampel  IS 'Ampel-Regelwerke. Bewusst datengetrieben, damit globale und betriebsindividuelle Schwellen umschaltbar sind.';
COMMENT ON SCHEMA sync   IS 'Betriebszustand des Importers. Bewusst flach und lesbar, damit man ihn in Postico direkt pruefen kann. In Metabase ausblenden.';
COMMENT ON SCHEMA mart   IS 'Die Auswertungsschicht. HIER faengt jede Metabase-Frage an - die Sichten bringen die Namen schon mit, sodass niemand core-Tabellen von Hand verbinden muss.';


-- =====================================================================
-- Zeitbehandlung — die eine bewusste Abweichung von der LINA-Welt
--
-- LINA liefert Datumswerte als DD.MM.YYYY ohne Zeitzone und Zeitpunkte als
-- Unix-Epoch in Berliner Zeit. Wir uebernehmen die Fachbegriffe von LINA,
-- aber NICHT dessen implizite Zeitzonenannahme: Container und Datenbank
-- laufen in UTC, umgerechnet wird ausschliesslich beim Uebertragen.
--
-- 'Europe/Berlin' steht damit an genau zwei Stellen: hier und in
-- src/lib/time.ts. Die Umgebungszeitzone ist bewusst nicht tragend - sonst
-- verschiebt ein vergessenes TZ still die Tagesgrenze, und das faellt nicht
-- auf, es produziert nur falsche Zahlen.
--
-- Zwei Arten von Zeit, die nicht vermischt werden duerfen:
--
--   ZEITPUNKT       abgerufen_am, LINAs from/to als Unix-Epoch
--                   -> timestamptz, intern UTC. Nichts anzunehmen.
--
--   GESCHAEFTSDATUM geschaeftstag, monat, LINAs DD.MM.YYYY-Parameter
--                   -> date. Ein zeitzonenloses Etikett fuer einen Berliner
--                      Abrechnungszeitraum. "1. Juni" im Round Table nach UTC
--                      umzurechnen waere ein Kategorienfehler - der Wert hat
--                      keine Uhrzeit.
-- =====================================================================

CREATE OR REPLACE FUNCTION core.geschaefts_zeitzone() RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 'Europe/Berlin'::text $$;

COMMENT ON FUNCTION core.geschaefts_zeitzone IS
'Die Geschaeftszeitzone von Concept Family. Einzige Quelle der Wahrheit in der Datenbank.
Verifiziert an LINA: getReport lieferte from=1780264800 = 2026-06-01 00:00 Europe/Berlin (CEST).';


-- Der Geschaeftstag laeuft 08:00 bis 07:59 des Folgetags. Belegt durch das
-- hours-Array des Zeitzonenberichts: 8,9,...,23,0,...,7.
CREATE OR REPLACE FUNCTION core.geschaeftstag(p_zeitpunkt timestamptz)
RETURNS date LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT ((p_zeitpunkt AT TIME ZONE core.geschaefts_zeitzone()) - interval '8 hours')::date
$$;

COMMENT ON FUNCTION core.geschaeftstag IS
'Ordnet einen Zeitpunkt dem Geschaeftstag zu. 02.06. um 03:00 Berliner Zeit gehoert fachlich
zum 01.06. Sommerzeitsicher, weil AT TIME ZONE die Umstellung kennt.';


CREATE OR REPLACE FUNCTION core.geschaeftstag_grenzen(p_tag date)
RETURNS TABLE (von timestamptz, bis timestamptz)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT ((p_tag     + time '08:00') AT TIME ZONE core.geschaefts_zeitzone()),
           ((p_tag + 1 + time '08:00') AT TIME ZONE core.geschaefts_zeitzone())
$$;


-- Stunde 0-23 aus dem Zeitzonenbericht auf den Geschaeftstag abbilden.
CREATE OR REPLACE FUNCTION core.geschaeftstag_fuer_stunde(p_kalendertag date, p_stunde smallint)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN p_stunde < 8 THEN p_kalendertag - 1 ELSE p_kalendertag END
$$;


-- Die Datenbank selbst trifft keine Annahme.
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone TO ''UTC''', current_database());
END $$;


-- =====================================================================
-- Partitionsverwaltung
--
-- WARUM EIN EIGENES SCHEMA
--
-- Postgres legt Partitionskinder standardmaessig neben der Elterntabelle
-- ab. Bei monatlicher Partitionierung ueber acht Jahre Historie sind das
-- rund hundert Tabellen, die alle `artikelverkauf_tag_2023_07` heissen und
-- fachlich nichts bedeuten - man fragt sie nie direkt ab, sondern immer
-- ueber die Elterntabelle.
--
-- In Postico ist das laestig, in Metabase ist es ein echtes Problem: dort
-- steht dann eine Liste aus hundert namensgleichen Tabellen, und die fuenf,
-- um die es geht, gehen darin unter. Deshalb liegen ALLE Kinder in `part`,
-- die Elterntabellen bleiben in `core` bzw. `raw`.
--
-- In Metabase unter Admin > Datenbanken > Schemata einzig `core`, `manual`,
-- `ampel` und `mart` synchronisieren - `part`, `raw` und `sync` aussen vor
-- lassen. Siehe docs/metabase.md.
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
        -- Das Kind landet in `part`, nicht neben der Elterntabelle.
        EXECUTE format('CREATE TABLE part.%I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
                       v_name, p_tabelle::text, v_von, v_bis);
        -- BRIN gleich mit autosummarize: ohne das bleiben frisch angehaengte
        -- Bloecke bis zum naechsten VACUUM unsummiert - also genau die Zeilen,
        -- die eine Round-Table-Auswertung am haeufigsten liest.
        EXECUTE format('CREATE INDEX ON part.%I USING brin (%I) WITH (autosummarize = on)',
                       v_name, v_datumsspalte);
    END IF;
END $$;

COMMENT ON FUNCTION core.partition_anlegen IS
'Legt bei Bedarf die Monatspartition an - im Schema `part`, nicht neben der Elterntabelle -,
inklusive BRIN-Index mit autosummarize. Der Importer ruft das vor dem Schreiben auf, so gibt
es keinen Wartungsjob, den man vergessen kann.
Hinweis: Storage-Parameter lassen sich NICHT auf dem partitionierten Index setzen
("This operation is not supported for partitioned indexes"), nur je Kindindex.';
