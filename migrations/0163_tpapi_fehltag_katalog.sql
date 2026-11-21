-- =====================================================================
-- 0163 — MCP-Katalog zu 0161 und 0162 nachgetragen
--
-- 0161 und 0162 haben Sichten neu angelegt bzw. per COMMENT neu
-- beschrieben, aber den Katalogschritt vergessen (21.11.2026, beim
-- Katalogabzug aus Produktion bemerkt):
--   * mart.tpapi_fehltag stand nicht in mcp.sicht — keine Koernung, kein
--     Thema, im Abzug nicht vorhanden.
--   * mart.tpapi_rueckstand, mart.tpapi_rueckstand_tag und
--     mart.personal_rueckstand verloren mit dem neuen COMMENT den Anhang
--     „Koernung: …", den mcp.koernung_in_kommentare() setzt.
--
-- Keine Sicht, keine Tabelle, keine neue Regelart (AGENTS.md, mcp-Regel 1).
-- Die Leserolle durfte mart.tpapi_fehltag schon lesen (Standardrechte des
-- Schemas, in Produktion nachgesehen); rechte_auffrischen() und die
-- Gegenprobe laufen trotzdem, wie seit 0110 Pflicht.
-- =====================================================================

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.tpapi_fehltag',
     'Betrieb × TPAPI-Endpunkt × Geschaeftstag, den LINA mit HTTP 5xx verweigert — wird erneut versucht oder aufgegeben',
     'import', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

INSERT INTO mcp.kennzahl (sicht, spalte, regel, einheit, hinweis) VALUES
  ('mart.tpapi_fehltag', 'versuche', 'nicht_aggregieren', 'anzahl',
   'Fehlversuche fuer diesen einen Tag, ueber alle Naechte. Eine Summe sagt nichts; Tage je Betrieb zaehlen.'),
  ('mart.tpapi_fehltag', 'naechte', 'nicht_aggregieren', 'anzahl',
   'In wie vielen Naechten der Tag scheiterte; ab mart.tpapi_fehltag_naechte() (3) gilt er als aufgegeben.'),
  ('mart.tpapi_rueckstand', 'tage_aufgegeben', 'nicht_aggregieren', 'anzahl',
   'Tage, die LINA in drei Naechten mit HTTP 5xx verweigert hat — kein Rueckstand des Importers, sondern ein Befund ueber LINA. Je Betrieb und Endpunkt lesen.')
ON CONFLICT (sicht, spalte) DO UPDATE
   SET regel = excluded.regel, einheit = excluded.einheit, hinweis = excluded.hinweis;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

DO $pruefen$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM mcp.sicht WHERE sicht = 'mart.tpapi_fehltag' AND koernung IS NOT NULL) THEN
        RAISE EXCEPTION '0163: mart.tpapi_fehltag steht nicht mit Koernung in mcp.sicht';
    END IF;
    IF EXISTS (SELECT 1
                 FROM unnest(ARRAY['tpapi_fehltag', 'tpapi_rueckstand', 'tpapi_rueckstand_tag', 'personal_rueckstand']) AS t(relname)
                 JOIN pg_class c ON c.relname = t.relname AND c.relnamespace = 'mart'::regnamespace
                WHERE coalesce(obj_description(c.oid, 'pg_class'), '') NOT LIKE '%Koernung:%') THEN
        RAISE EXCEPTION '0163: mindestens eine der vier Sichten traegt keinen Koernungsanhang im Kommentar';
    END IF;
END $pruefen$;


-- Rechte und die Gegenprobe als Leserolle (Pflicht seit 0110)

SELECT mcp.rechte_auffrischen();

DO $probe$
DECLARE
    v_abfrage text;
    v_liegen  text[] := '{}';
    v_rechte  int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0163 ist uebersprungen';
        RETURN;
    END IF;

    SELECT count(*) INTO v_rechte FROM mart.mcp_rechte_pruefung;
    IF v_rechte > 0 THEN
        RAISE EXCEPTION '0163: mart.mcp_rechte_pruefung ist nicht leer (% Zeilen)', v_rechte;
    END IF;

    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0163 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_abfrage IN ARRAY ARRAY[
        'SELECT * FROM mart.tpapi_fehltag LIMIT 1',
        'SELECT betrieb, endpunkt, tage_fehlend, tage_aufgegeben FROM mart.tpapi_rueckstand LIMIT 1',
        'SELECT * FROM mart.personal_rueckstand LIMIT 1']
    LOOP
        BEGIN
            EXECUTE v_abfrage;
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_abfrage, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    BEGIN
        EXECUTE 'SELECT * FROM mcp.zugriff LIMIT 1';
        v_liegen := v_liegen || 'mcp.zugriff ist fuer mcp_leser lesbar'::text;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0163 hat sein Ziel nicht erreicht — fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
