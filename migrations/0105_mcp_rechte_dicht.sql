-- =====================================================================
-- Die Leserolle bleibt dicht — auch nach dem naechsten Aufruf
--
-- BEFUND BEIM REVIEW, 13.09.2026, nachgemessen:
--
--   SELECT mcp.rechte_auffrischen();
--   -- als mcp_leser danach:
--   SELECT count(*) FROM mcp.oauth_schluessel;   --> 1
--
-- `rechte_auffrischen()` aus Migration 0102 vergibt `SELECT ON ALL TABLES IN
-- SCHEMA mcp` — pauschal, weil es damals nur den Katalog gab. Seit 0104
-- liegen im selben Schema die Passworthashes und der Signierschluessel, und
-- 0104 entzieht sie der Leserolle wieder. Aber `rechte_auffrischen()` ist
-- laut Kommentar und README „idempotent, nach jeder Migration aufrufbar" —
-- und genau dieser Aufruf haette den Entzug rueckgaengig gemacht. Eine
-- Migration spaeter, ein Routineaufruf, und `mcp_leser` liest den
-- Signierschluessel: der Nutzer mit Stufe `fragen` stellt sich Tokens aus.
--
-- Zweiter Befund, dieselbe Wurzel: `ALTER DEFAULT PRIVILEGES ... IN SCHEMA
-- mcp GRANT SELECT ON TABLES TO mcp_leser` (ebenfalls 0102) macht JEDE neue
-- Tabelle in `mcp` fuer die Leserolle lesbar, bevor irgendjemand entscheidet,
-- ob sie das darf. Gemessen: `CREATE TABLE mcp._probe(x int)` — sofort
-- lesbar.
--
-- DIE REGEL, die beide Befunde beheben: IN `mcp` WIRD NICHTS PAUSCHAL
-- VERGEBEN. Jede Tabelle gehoert ausdruecklich einer der beiden Rollen —
-- Katalog dem Leser, Anmeldung der Anmeldung —, und was keiner zugeordnet
-- ist, sieht keiner. Das ist der Grundsatz „sichtbar statt still" aus Regel
-- 10, angewandt auf Rechte: eine neue Tabelle, die niemand lesen kann, faellt
-- sofort auf. Eine, die jeder lesen kann, faellt nie auf.
-- =====================================================================

-- 1. Die Standardvergabe fuer `mcp` zuruecknehmen. Fuer mart/manual/ampel
--    bleibt sie: dort sind neue Sichten genau das, was der Leser sehen soll.
DO $$
BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA mcp REVOKE SELECT ON TABLES FROM mcp_leser',
    current_user);
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  RAISE WARNING 'Standardrechte in mcp konnten nicht zurueckgenommen werden — von Hand pruefen';
END $$;

-- 2. `rechte_auffrischen()` neu, mit NAMENTLICHER Vergabe im Schema mcp.
CREATE OR REPLACE FUNCTION mcp.rechte_auffrischen()
RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
    EXECUTE 'CREATE ROLE mcp_leser NOLOGIN';
  END IF;

  EXECUTE 'ALTER ROLE mcp_leser SET default_transaction_read_only = on';
  EXECUTE 'ALTER ROLE mcp_leser SET statement_timeout = ''20s''';
  EXECUTE 'ALTER ROLE mcp_leser SET idle_in_transaction_session_timeout = ''30s''';
  EXECUTE 'ALTER ROLE mcp_leser SET work_mem = ''32MB''';
  EXECUTE 'ALTER ROLE mcp_leser SET search_path = mart, manual, ampel, mcp';

  EXECUTE 'REVOKE ALL ON SCHEMA public FROM mcp_leser';
  EXECUTE 'REVOKE ALL ON SCHEMA raw, part, core, sync FROM mcp_leser';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA raw, part, core, sync FROM mcp_leser';

  -- Die Auswertungsschichten: pauschal, das ist ihr Zweck.
  EXECUTE 'GRANT USAGE ON SCHEMA mart, manual, ampel, mcp TO mcp_leser';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA mart, manual, ampel TO mcp_leser';
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA mart, manual, ampel '
    'GRANT SELECT ON TABLES TO mcp_leser', current_user);

  -- Das Schema mcp: ERST ALLES ENTZIEHEN, DANN NAMENTLICH VERGEBEN. Der
  -- Entzug zuerst, damit ein frueherer pauschaler Grant nicht stehen bleibt.
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA mcp FROM mcp_leser';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA mcp FROM mcp_leser';
  EXECUTE 'GRANT SELECT ON
             mcp.sicht, mcp.achse, mcp.sicht_achse, mcp.kennzahl, mcp.fallstrick,
             mcp.sicht_katalog, mcp.koernung_fehlend, mcp.einrichtung_offen, mcp.zugriff
           TO mcp_leser';
  EXECUTE 'GRANT INSERT ON mcp.zugriff TO mcp_leser';
  EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE mcp.zugriff_zugriff_id_seq TO mcp_leser';

  DELETE FROM mcp.einrichtung_offen WHERE punkt = 'mcp_leser';

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser' AND rolcanlogin) THEN
    INSERT INTO mcp.einrichtung_offen (punkt, meldung, behebung) VALUES (
      'mcp_leser_passwort',
      'Die Leserolle mcp_leser hat keine Anmeldung — der MCP-Server kann sich nicht verbinden.',
      'Einmal von Hand: ALTER ROLE mcp_leser LOGIN PASSWORD ''...''; danach MCP_DATABASE_URL setzen. '
      'Das Passwort gehoert NICHT ins Repository (harte Regel 2).')
    ON CONFLICT (punkt) DO NOTHING;
  ELSE
    DELETE FROM mcp.einrichtung_offen WHERE punkt = 'mcp_leser_passwort';
  END IF;

  RETURN 'mcp_leser eingerichtet';
END $$;

COMMENT ON FUNCTION mcp.rechte_auffrischen() IS
'Legt die Leserolle mcp_leser an und setzt ihre Rechte. Im Schema mcp wird NAMENTLICH
vergeben, nie pauschal — die Anmeldetabellen (0104) duerfen ihr nie in die Hand fallen,
auch nicht durch einen spaeteren Aufruf dieser Funktion (Befund 13.09.2026, siehe 0105).
Idempotent. Wer eine Katalogtabelle ergaenzt, traegt sie hier ein.';

-- 3. Einmal ausfuehren, damit der Zustand stimmt — und die Gegenprobe gleich
--    mitliefern: bricht ab, wenn die Leserolle doch an die Anmeldung kommt.
SELECT mcp.rechte_auffrischen();

DO $$
BEGIN
  IF has_table_privilege('mcp_leser', 'mcp.oauth_schluessel', 'SELECT')
     OR has_table_privilege('mcp_leser', 'mcp.nutzer', 'SELECT') THEN
    RAISE EXCEPTION 'mcp_leser kann die Anmeldetabellen lesen — das darf nach 0105 nicht sein';
  END IF;
END $$;

-- 4. Eine Pruefsicht, damit /status es sieht, falls es je wieder kippt.
CREATE VIEW mart.mcp_rechte_pruefung AS
SELECT t.tabelle,
       has_table_privilege('mcp_leser', t.tabelle, 'SELECT')      AS leser_darf,
       has_table_privilege('mcp_anmeldung', t.tabelle, 'SELECT')  AS anmeldung_darf,
       t.erwartung
  FROM (VALUES
    ('mcp.oauth_schluessel',    'nur_anmeldung'),
    ('mcp.nutzer',              'nur_anmeldung'),
    ('mcp.oauth_token',         'nur_anmeldung'),
    ('mcp.oauth_code',          'nur_anmeldung'),
    ('mcp.sicht_katalog',       'nur_leser'),
    ('mcp.zugriff',             'nur_leser')
  ) AS t(tabelle, erwartung)
 WHERE (t.erwartung = 'nur_anmeldung' AND has_table_privilege('mcp_leser', t.tabelle, 'SELECT'))
    OR (t.erwartung = 'nur_leser'     AND has_table_privilege('mcp_anmeldung', t.tabelle, 'SELECT'));

COMMENT ON VIEW mart.mcp_rechte_pruefung IS
'Rechte der beiden MCP-Rollen gegen die Erwartung gehalten. ERWARTUNG: LEER. Jede Zeile
hier heisst: eine Rolle sieht etwas, das ihr nicht gehoert — bei oauth_schluessel waere das
der Generalschluessel neben dem Schloss.

Koernung: eine Zeile je Tabelle, deren Rechte von der Erwartung abweichen.';
