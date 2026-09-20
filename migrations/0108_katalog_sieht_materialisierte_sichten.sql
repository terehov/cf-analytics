-- =====================================================================
-- 0108 — Der Katalog sah vierzehn Sichten nicht an, die wichtigsten
--
-- BEFUND VOM 20.09.2026, in Produktion nachgemessen:
--
--   SELECT count(*) FROM mcp.sicht_achse WHERE sicht = 'mart.round_table_monat';
--   --> 0
--
-- Null Achsen fuer die meistgenutzte Sicht des ganzen Hauses. Dasselbe fuer
-- `round_table_trend`, `deckungsbeitrag_warengruppe`, `vergleichstag_basis`
-- und zehn weitere — genau die vierzehn MATERIALISIERTEN Sichten, und nur
-- die.
--
-- URSACHE: `mcp.achsen_ableiten()` und `mcp.sicht_katalog` lesen die Spalten
-- aus `information_schema.columns`. Dort stehen materialisierte Sichten
-- nicht. Der SQL-Standard kennt sie nicht, also fuehrt PostgreSQL sie im
-- information_schema auch nicht — lautlos, ohne Fehler, mit einer leeren
-- Menge als Antwort.
--
-- Die Sichtenliste selbst war nie betroffen: sie zieht `pg_matviews`
-- ausdruecklich mit dazu (0102). Nur die SPALTEN nicht. Eine Sicht stand
-- also im Katalog, mit Koernung, mit Fallstricken — und ohne eine einzige
-- Spalte.
--
-- WAS DAS IM BETRIEB BEDEUTET, drei Dinge:
--
--   achsen_zeigen        schlaegt fuer diese vierzehn keinen einzigen Join
--                        vor. Wer ueber ChatGPT fragt, wie sich der Round
--                        Table mit dem Wetter verbinden laesst, bekommt:
--                        gar nicht.
--   sicht_beschreiben    nennt keine Spalte. Das Modell raet sie aus dem
--                        Namen — und raet auf materialisierten Sichten
--                        genauso gut wie auf allen anderen, nur ohne Netz.
--   summe_ungeprueft     kann auf ihnen NIE anschlagen. Der Kommentar an
--                        mcp.sicht_katalog sagt es selbst: "Die
--                        Spaltenliste traegt die Pruefung". Ohne sie laeuft
--                        SELECT sum(om_score) FROM mart.round_table_monat
--                        ungewarnt durch — eine Summe ueber Schulnoten.
--
-- DIE BEHEBUNG: `pg_attribute` statt `information_schema.columns`. Der
-- Systemkatalog kennt jede Relationsart; `relkind IN ('r','v','m','p','f')`
-- nennt sie ausdruecklich, damit der naechste Relationstyp nicht wieder
-- still herausfaellt.
--
-- Dieselbe Aenderung steht in `mcp/src/katalog_export.ts` — dort las
-- dieselbe Abfrage aus demselben Grund dieselbe Luecke.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die Ableitung
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mcp.achsen_ableiten()
RETURNS TABLE (neue_sichten int, entfallene_sichten int, zuordnungen int)
LANGUAGE plpgsql AS $$
DECLARE
  v_neu int; v_weg int; v_zuo int;
BEGIN
  -- 1. Neue Sichten aufnehmen, bekannte als gesehen markieren.
  WITH katalog AS (
    SELECT 'mart.' || table_name AS sicht
      FROM information_schema.tables
     WHERE table_schema = 'mart'
       AND table_type IN ('VIEW','BASE TABLE')
    UNION
    SELECT 'mart.' || matviewname FROM pg_matviews WHERE schemaname = 'mart'
  ), eingefuegt AS (
    INSERT INTO mcp.sicht (sicht)
    SELECT sicht FROM katalog
    ON CONFLICT (sicht) DO UPDATE
       SET zuletzt_gesehen = now(), entfallen = false
    RETURNING (xmax = 0) AS ist_neu
  )
  SELECT count(*) FILTER (WHERE ist_neu)::int INTO v_neu FROM eingefuegt;

  -- 2. Verschwundene markieren statt loeschen: gepflegte Koernung soll ein
  --    Umbenennen ueberleben, damit sie nicht lautlos neu erarbeitet wird.
  WITH katalog AS (
    SELECT 'mart.' || table_name AS sicht
      FROM information_schema.tables WHERE table_schema = 'mart'
    UNION
    SELECT 'mart.' || matviewname FROM pg_matviews WHERE schemaname = 'mart'
  ), markiert AS (
    UPDATE mcp.sicht s SET entfallen = true
     WHERE NOT s.entfallen AND NOT EXISTS (SELECT 1 FROM katalog k WHERE k.sicht = s.sicht)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_weg FROM markiert;

  -- 3. Zuordnung Sicht x Achse neu ableiten. Vollstaendig ersetzen: eine
  --    Spalte, die aus einer Sicht verschwindet, muss auch hier verschwinden,
  --    sonst schlaegt der Server einen Join vor, den es nicht mehr gibt.
  DELETE FROM mcp.sicht_achse;
  WITH spalten AS (
    /*
     * AB 0108 AUS pg_attribute. Die Vorgaengerfassung las
     * information_schema.columns und uebersah damit jede materialisierte
     * Sicht — vierzehn Stueck, darunter mart.round_table_monat. Die
     * relkind-Liste ist ausdrücklich ausgeschrieben, damit der naechste
     * Relationstyp auffaellt statt still herauszufallen.
     */
    SELECT 'mart.' || c.relname AS sicht, a.attname AS column_name
      FROM pg_attribute a
      JOIN pg_class c     ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'mart'
       AND c.relkind IN ('r','v','m','p','f')
       AND a.attnum > 0
       AND NOT a.attisdropped
  ), zugeordnet AS (
    INSERT INTO mcp.sicht_achse (sicht, achse, spalte)
    SELECT s.sicht, a.achse, s.column_name
      FROM spalten s
      JOIN mcp.achse a ON a.achse = s.column_name
      JOIN mcp.sicht v ON v.sicht = s.sicht
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_zuo FROM zugeordnet;

  RETURN QUERY SELECT v_neu, v_weg, v_zuo;
END $$;

COMMENT ON FUNCTION mcp.achsen_ableiten() IS
'Fuehrt mcp.sicht und mcp.sicht_achse dem Katalog nach. Nach jeder Migration, die eine
mart-Sicht anlegt oder umbenennt, aufrufen — der naechtliche Lauf tut es von selbst.
Entfallene Sichten werden markiert, nicht geloescht: gepflegte Koernung soll ein
Umbenennen ueberleben.

SEIT 0108 aus pg_attribute statt information_schema.columns: dort stehen materialisierte
Sichten nicht, und deshalb hatten vierzehn von ihnen — darunter mart.round_table_monat —
seit dem Aufbau des Katalogs KEINE EINZIGE ACHSE.';


-- ---------------------------------------------------------------------
-- 2. Der Katalog, wie der Server ihn liest
--
-- Nur die eine LATERAL-Unterabfrage aendert sich; alles andere steht wie in
-- 0102, damit der Unterschied lesbar bleibt.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mcp.sicht_katalog AS
SELECT s.sicht,
       s.koernung,
       s.thema,
       s.summen_erlaubt,
       s.doku,
       obj_description(c.oid, 'pg_class')                       AS kommentar,
       coalesce(sp.spalten, ARRAY[]::text[])                    AS spalten,
       coalesce(a.achsen, ARRAY[]::text[])                      AS achsen,
       coalesce(k.kennzahlen, '[]'::jsonb)                      AS kennzahlen,
       coalesce(f.fallstricke, '[]'::jsonb)                     AS fallstricke
  FROM mcp.sicht s
  LEFT JOIN pg_class c ON c.relname = split_part(s.sicht, '.', 2)
       AND c.relnamespace = 'mart'::regnamespace
  LEFT JOIN LATERAL (
        -- Seit 0108 aus pg_attribute, siehe Kopf dieser Migration.
        SELECT array_agg(att.attname::text ORDER BY att.attnum) AS spalten
          FROM pg_attribute att
         WHERE att.attrelid = c.oid
           AND att.attnum > 0
           AND NOT att.attisdropped) sp ON true
  LEFT JOIN LATERAL (
        SELECT array_agg(sa.achse ORDER BY sa.achse) AS achsen
          FROM mcp.sicht_achse sa WHERE sa.sicht = s.sicht) a ON true
  LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('spalte', kz.spalte, 'regel', kz.regel,
                 'einheit', kz.einheit, 'hinweis', kz.hinweis) ORDER BY kz.spalte) AS kennzahlen
          FROM mcp.kennzahl kz WHERE kz.sicht = s.sicht) k ON true
  LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('schluessel', fs.schluessel, 'schwere', fs.schwere,
                 'hinweis', fs.hinweis, 'berichtigung', fs.berichtigung) ORDER BY fs.schluessel) AS fallstricke
          FROM mcp.fallstrick fs WHERE fs.sicht = s.sicht AND fs.aktiv) f ON true
 WHERE NOT s.entfallen;

COMMENT ON VIEW mcp.sicht_katalog IS
'Der Katalog, wie der MCP-Server ihn liest: je mart-Sicht die Koernung, der
Tabellenkommentar, die Spaltenliste, die Achsen, die Kennzahlregeln und die Fallstricke
in einer Zeile. Die Spaltenliste traegt die Pruefung: nur mit ihr laesst sich eine
aggregierte Spalte der Sicht zuordnen, aus der sie stammt — ohne sie schlaegt eine Regel
auch dann an, wenn die Sicht nur als Dimension danebensteht.

SEIT 0108 aus pg_attribute. Davor kamen die Spalten aus information_schema.columns, das
materialisierte Sichten nicht fuehrt: fuer vierzehn Sichten — darunter
mart.round_table_monat — war die Spaltenliste leer, und damit war die Pruefung auf ihnen
blind.

Koernung: eine Zeile je mart-Sicht, die im Katalog steht.';


-- Und einmal anwenden.
SELECT mcp.achsen_ableiten();


-- ---------------------------------------------------------------------
-- 3. Zwei Koernungen, die der Abzug seit jeher verdeckt hat
--
-- `katalog_abzug.test.ts` prueft seit 0102: eine Sicht mit drei oder mehr
-- Achsen braucht eine Koernung — sie wird am haeufigsten verbunden und
-- richtet den groessten Schaden an, wenn niemand weiss, WOVON sie eine
-- Zeile fuehrt. Der Test lief gegen eine Abzugsdatei, die aus einer
-- unvollstaendigen Datenbank stammte (77 von 159 Sichten ohne Spaltenliste)
-- und beide Sichten gar nicht enthielt. Gegen den wirklichen Katalog
-- gehalten, meldet er sie sofort.
--
-- Beide sind Pruefsichten, und gerade bei denen ist die Koernung wichtig:
-- ein Modell, das `posten_ohne_zugriff` fuer eine Betriebsliste haelt,
-- zaehlt Warteschlangenposten und nennt das Ergebnis Betriebe.
-- ---------------------------------------------------------------------

UPDATE mcp.sicht SET
    koernung = 'Betrieb und Monat — Sichtbarkeit in den Portalen aus Yext',
    thema    = coalesce(thema, 'bewertung')
 WHERE sicht = 'mart.betrieb_sichtbarkeit';

UPDATE mcp.sicht SET
    koernung = 'EINEM abgelehnten Warteschlangenposten (403), nicht einem Betrieb — '
             || 'ein Betrieb kann mit vielen Posten darin stehen',
    thema    = coalesce(thema, 'import')
 WHERE sicht = 'mart.posten_ohne_zugriff';

-- Die Koernung gehoert auch in den Tabellenkommentar, damit Metabase und
-- Postico sie zeigen. Idempotent, erkennt die Marke "Koernung:".
SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0108', to_jsonb(
        'mcp.achsen_ableiten() und mcp.sicht_katalog lasen die Spalten aus '
        'information_schema.columns — dort stehen materialisierte Sichten nicht. '
        'Vierzehn Sichten, darunter mart.round_table_monat und mart.round_table_trend, '
        'hatten seit dem Aufbau des Katalogs (0102, 13.09.2026) KEINE Spalten und KEINE '
        'Achsen: achsen_zeigen schlug fuer sie keinen Join vor, sicht_beschreiben nannte '
        'keine Spalte, und die Regel summe_ungeprueft konnte auf ihnen nie anschlagen. '
        'Seit 0108 aus pg_attribute mit ausgeschriebener relkind-Liste. Dazu die Koernung '
        'fuer mart.betrieb_sichtbarkeit und mart.posten_ohne_zugriff. '
        'Pruefzeile: SELECT count(*) FROM mcp.sicht_achse WHERE sicht = '
        '''mart.round_table_monat''; — erwartet 3, davor 0.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
