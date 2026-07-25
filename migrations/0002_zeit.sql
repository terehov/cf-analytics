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


-- ---------------------------------------------------------------------
-- Waechter: stimmt LINAs Zeitzonenannahme noch?
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.pruefe_lina_epoch(p_epoch bigint, p_erwarteter_tag date)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_ist date;
BEGIN
    v_ist := (to_timestamp(p_epoch) AT TIME ZONE core.geschaefts_zeitzone())::date;
    IF v_ist <> p_erwarteter_tag THEN
        INSERT INTO sync.schema_abweichung (endpunkt, erwartet, tatsaechlich)
        VALUES ('zeitzonen-pruefung',
                jsonb_build_object('erwarteter_tag', p_erwarteter_tag, 'zeitzone', core.geschaefts_zeitzone()),
                jsonb_build_object('epoch', p_epoch, 'aufgeloester_tag', v_ist));
        RETURN false;
    END IF;
    RETURN true;
END $$;

COMMENT ON FUNCTION core.pruefe_lina_epoch IS
'Prueft LINAs from/to-Epoch gegen den erwarteten Geschaeftstag. Schlaegt sie fehl, landet das in
sync.schema_abweichung - ein stiller Zeitzonenwechsel bei LINA faellt damit sofort auf, statt
Monate spaeter in falschen Tagesumsaetzen.';


-- Die Datenbank selbst trifft keine Annahme.
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone TO ''UTC''', current_database());
END $$;
