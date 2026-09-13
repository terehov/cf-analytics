-- =====================================================================
-- Schema `mcp` — der semantische Katalog für den Zugang aus Claude,
-- ChatGPT und Copilot.  Plan: docs/plan-skybridge.md
--
-- WARUM EIN EIGENES SCHEMA UND KEINE TABELLEN IN `manual`.
-- `manual` ist fachliche Pflege — Maßnahmen, Ursachen, Standorte. Was hier
-- liegt, ist Wissen ÜBER das Schema, kein Fachdatum. Derselbe Schnitt wie
-- `sync`: Betriebszustand eines Dienstes gehört nicht zwischen die Zahlen,
-- über die er Auskunft gibt. Der Name ist englisch wie `raw`, `core`,
-- `mart` — ein Schichtname, kein LINA-Begriff (AGENTS.md, Namenskonvention).
--
-- WARUM ALS DATEN UND NICHT ALS CODE.
-- Dieselbe Begründung wie bei den Ampelregelwerken (datenmodell.md,
-- Entscheidung 5): eine neue Regel ist eine Migration, kein Deploy, und sie
-- steht neben den Daten, auf die sie sich bezieht. Wer in Postico sieht,
-- dass `mart.fremdeinkauf` eine Doppelzählung erlaubt, trägt die Warnung
-- dort ein, wo er gerade steht.
--
-- WAS HIER NICHT LIEGT: die Prädikate selbst. `mcp.fallstrick.art` benennt
-- eine Regelart, die der Server implementiert; die Parameter stehen daneben.
-- Eine Regelart ohne Umsetzung lässt den Server NICHT STARTEN (statt sie
-- still zu ignorieren) — eine Wache, die nicht wacht, ist schlimmer als
-- keine (harte Regel 10).
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS mcp;

COMMENT ON SCHEMA mcp IS
'Semantischer Katalog fuer den MCP-Zugang (Claude, ChatGPT, Copilot): Koernung,
Achsen, Kennzahlregeln, Fallstricke, Zugriffsprotokoll. Wissen UEBER das Schema,
keine Fachdaten. Siehe docs/plan-skybridge.md.';

-- ---------------------------------------------------------------------
-- Achsen — worueber gruppiert und verbunden wird
--
-- Zwei Sorten in einer Tabelle, unterschieden durch `ziel_sicht`:
--
--   mit `ziel_sicht`   eine echte Dimension (betrieb_key -> mart.betrieb).
--                      NUR DIESE verdrahtet metabase/beziehungen.ts als
--                      Fremdschluessel. Ein FK ohne Ziel waere ein Sprung
--                      ins Leere.
--   ohne `ziel_sicht`  eine Gruppierungsachse ohne Dimensionssicht
--                      (monat, geschaeftstag, konzept). Fuer den MCP-Server
--                      trotzdem wichtig: sie sagt, worueber zwei Sichten
--                      zusammenfinden.
--
-- `beziehungen.ts` liest seine ACHSEN seit dieser Migration VON HIER, statt
-- sie als Konstante zu fuehren. Sonst gaebe es zwei Wahrheiten ueber
-- dieselbe Beziehung, und die Metabase-Verdrahtung und der MCP-Server
-- koennten auseinanderlaufen, ohne dass es jemand merkt.
-- ---------------------------------------------------------------------
CREATE TABLE mcp.achse (
  achse           text PRIMARY KEY,
  bezeichnung     text NOT NULL,
  art             text NOT NULL,
  ziel_sicht      text,
  ziel_spalte     text,
  anzeige_spalte  text,
  hinweis         text,
  CONSTRAINT achse_ziel_vollstaendig CHECK (
    (ziel_sicht IS NULL AND ziel_spalte IS NULL AND anzeige_spalte IS NULL)
    OR (ziel_sicht IS NOT NULL AND ziel_spalte IS NOT NULL AND anzeige_spalte IS NOT NULL))
);

COMMENT ON TABLE mcp.achse IS
'Die Achsen, entlang derer gruppiert und verbunden wird. Zeilen MIT ziel_sicht sind
echte Dimensionen und werden von metabase/beziehungen.ts als Fremdschluessel
verdrahtet; Zeilen OHNE sind reine Gruppierungsachsen (monat, geschaeftstag).
Diese Tabelle ist die Quelle — beziehungen.ts liest von hier, nicht umgekehrt.';
COMMENT ON COLUMN mcp.achse.art IS
'schluessel = Fremdschluesselspalte, zeit = Datum/Monat, merkmal = Text zum Gruppieren.';
COMMENT ON COLUMN mcp.achse.anzeige_spalte IS
'Die Spalte der Zielsicht, die einen Eintrag fuer einen Menschen lesbar macht —
in Metabase die Anzeigeverknuepfung, im Chat der Name statt der Schluesselzahl.';

-- ---------------------------------------------------------------------
-- Sichten — Koernung und Einordnung
--
-- DIE KOERNUNG IST DAS WICHTIGSTE FELD DIESER MIGRATION. Gemessen am
-- 13.09.2026: von 188 Tabellenkommentaren in `mart` tragen 114 ein Warnwort,
-- aber nur 23 schreiben aus, wovon sie eine Zeile je Einheit fuehren. Genau
-- das braucht ein Modell, BEVOR es summiert — `mart.umsatz_tag` darf man
-- summieren, `mart.umsatz_tag_sparte` nur je Sparte, `mart.round_table_monat`
-- gar nicht.
--
-- `koernung IS NULL` ist deshalb kein Schoenheitsfehler, sondern eine
-- Arbeitsliste (mcp.koernung_fehlend) UND zur Laufzeit eine Warnung: wer
-- ueber eine Sicht ohne hinterlegte Koernung aggregiert, bekommt sie gesagt.
-- ---------------------------------------------------------------------
CREATE TABLE mcp.sicht (
  sicht           text PRIMARY KEY,
  koernung        text,
  thema           text,
  summen_erlaubt  boolean,
  doku            text,
  zuletzt_gesehen timestamptz NOT NULL DEFAULT now(),
  entfallen       boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE mcp.sicht IS
'Je mart-Sicht: wovon sie eine Zeile fuehrt (koernung), wozu sie gehoert (thema),
ob eine naive Summe ueber ihre Kennzahlen ueberhaupt etwas bedeutet. Gepflegt von
Hand, ergaenzt von mcp.achsen_ableiten(). Fehlende Koernung steht in
mcp.koernung_fehlend und erzeugt zur Laufzeit eine Warnung.';
COMMENT ON COLUMN mcp.sicht.koernung IS
'Ein Satz, der mit "Eine Zeile je" beginnt. Wandert mit mcp.koernung_in_kommentare()
zusaetzlich in den Tabellenkommentar — dann hat Metabase sie auch.';
COMMENT ON COLUMN mcp.sicht.summen_erlaubt IS
'false = eine Summe ueber die Kennzahlen dieser Sicht ist falsch (Prozentwerte,
Mediane, oder eine Achse fehlt im GROUP BY). NULL = nicht entschieden.';
COMMENT ON COLUMN mcp.sicht.entfallen IS
'true = die Sicht steht nicht mehr im Katalog. Zeile bleibt stehen, damit gepflegte
Koernung bei einem Umbenennen nicht lautlos verschwindet.';

CREATE TABLE mcp.sicht_achse (
  sicht    text NOT NULL REFERENCES mcp.sicht(sicht) ON DELETE CASCADE,
  achse    text NOT NULL REFERENCES mcp.achse(achse) ON DELETE CASCADE,
  spalte   text NOT NULL,
  PRIMARY KEY (sicht, achse)
);

COMMENT ON TABLE mcp.sicht_achse IS
'Welche Sicht welche Achse traegt — daraus folgt, was womit verbunden werden darf.
Wird von mcp.achsen_ableiten() aus dem Katalog gefuellt, nicht von Hand.';

-- ---------------------------------------------------------------------
-- Kennzahlen — wie eine Spalte aggregiert werden DARF
--
-- Der haeufigste stille Fehler in diesen Daten ist eine Summe ueber etwas,
-- das keine Summe vertraegt: ein Prozentwert, ein Median, ein Stand.
-- `mart.personalkosten` fuehrt Tageszeilen, deren Quoten den TAGESUMSATZ im
-- Nenner haben — an einem Tag mit 6,05 EUR Umsatz ergibt das 316.576 Prozent.
-- Der Mittelwert darueber ist keine Personalquote, sondern Unsinn mit
-- Nachkommastellen.
-- ---------------------------------------------------------------------
CREATE TABLE mcp.kennzahl (
  sicht    text NOT NULL REFERENCES mcp.sicht(sicht) ON DELETE CASCADE,
  spalte   text NOT NULL,
  regel    text NOT NULL,
  einheit  text,
  hinweis  text,
  PRIMARY KEY (sicht, spalte),
  CONSTRAINT kennzahl_regel_bekannt CHECK (
    regel IN ('summe','median','mittel','letzter_stand','nicht_aggregieren')),
  CONSTRAINT kennzahl_einheit_bekannt CHECK (
    einheit IS NULL OR einheit IN ('euro','prozentzahl','anzahl','note','tage','text'))
);

COMMENT ON TABLE mcp.kennzahl IS
'Je Spalte: welche Aggregation sie vertraegt. summe = bedenkenlos addierbar,
median/mittel = nur so zusammenfassen, letzter_stand = juengste Zeile nehmen,
nicht_aggregieren = gar nicht. Grundlage der Sperre "sum() ueber einen Median".';
COMMENT ON COLUMN mcp.kennzahl.einheit IS
'prozentzahl heisst: der Wert IST schon Prozent (23.64), kein Bruch. Multiplizieren
mit 100 ist der haeufigste Fehler dieses Projekts (harte Regel 6).';

-- ---------------------------------------------------------------------
-- Fallstricke — die Regeln, die vor dem Lauf greifen
--
-- `art` benennt die Regelart, `parameter` traegt ihre Argumente. Die
-- Umsetzung steht im Server (mcp/src/pruefen.ts). Eine Regelart ohne
-- Umsetzung laesst den Server nicht starten; so kann eine Migration keine
-- Wache eintragen, die nicht wacht.
--
-- `schwere`:
--   sperre   die Abfrage laeuft NICHT. Der Grund und, wo moeglich, die
--            Berichtigung gehen zurueck. Das ist die Verweigerung statt der
--            selbstbewusst falschen Zahl (docs/plan-skybridge.md, Abschnitt 1).
--   warnung  die Abfrage laeuft, der Hinweis reist mit dem Ergebnis.
-- ---------------------------------------------------------------------
CREATE TABLE mcp.fallstrick (
  schluessel  text PRIMARY KEY,
  art         text NOT NULL,
  schwere     text NOT NULL,
  sicht       text,
  parameter   jsonb NOT NULL DEFAULT '{}'::jsonb,
  hinweis     text NOT NULL,
  berichtigung text,
  quelle      text,
  aktiv       boolean NOT NULL DEFAULT true,
  CONSTRAINT fallstrick_schwere CHECK (schwere IN ('sperre','warnung'))
);

COMMENT ON TABLE mcp.fallstrick IS
'Regeln, die eine Abfrage VOR dem Lauf pruefen. art benennt die Regelart (im Server
umgesetzt), parameter traegt ihre Argumente, hinweis den Satz fuer den Menschen.
sperre = laeuft nicht, warnung = laeuft mit Hinweis. quelle nennt den Beleg, meist
eine Zeile in docs/fehlerkatalog.md oder befunde-datenlage.md.';
COMMENT ON COLUMN mcp.fallstrick.berichtigung IS
'Die berichtigte Abfrage oder der fehlende Zusatz, wenn er sich angeben laesst —
ein Modell bessert damit nach, statt zu raten.';

CREATE INDEX fallstrick_sicht_idx ON mcp.fallstrick (sicht) WHERE aktiv;

-- ---------------------------------------------------------------------
-- Nutzer und Stufen
--
-- Der Server hat EIGENE Nutzer, sonst waere er keine Alternative zu
-- Metabase (docs/plan-skybridge.md, Abschnitt 7). `subject` ist der
-- OAuth-Subject-Claim des Identitaetsanbieters, nicht eine hiesige Kennung —
-- wer das Unternehmen verlaesst, verliert den Zugang beim Anbieter, und hier
-- muss niemand nachpflegen.
-- ---------------------------------------------------------------------
CREATE TABLE mcp.nutzer_stufe (
  subject     text PRIMARY KEY,
  anzeige     text,
  stufe       text NOT NULL DEFAULT 'lesen',
  angelegt_am timestamptz NOT NULL DEFAULT now(),
  notiz       text,
  CONSTRAINT nutzer_stufe_bekannt CHECK (stufe IN ('lesen','fragen','gesperrt'))
);

COMMENT ON TABLE mcp.nutzer_stufe IS
'Wer was darf. lesen = Berichte, Katalog, Datenstand. fragen = zusaetzlich freies SQL.
gesperrt = nichts. Wer hier fehlt, bekommt "lesen" NICHT geschenkt — der Server
verlangt einen Eintrag (siehe mcp/src/auth.ts).';

-- ---------------------------------------------------------------------
-- Protokoll
--
-- Zwei Gruende, beide aus diesem Repository. Erstens: eine Zahl, die im
-- Round Table landet, muss rekonstruierbar sein — eine Chat-Antwort ist kein
-- Beleg, diese Zeile ist einer. Zweitens harte Regel 10: ein Dienst ohne
-- Zulauf ist ein Fehler, kein Normalzustand. Wird der Server nicht benutzt,
-- muss man das SEHEN (mart.mcp_nutzung, /status), nicht ahnen.
--
-- Und der Rueckkanal: wiederholte freie Abfragen und haeufige Sperren sind
-- die Anforderungsliste fuer die naechsten mart-Sichten und Karten.
-- ---------------------------------------------------------------------
CREATE TABLE mcp.zugriff (
  zugriff_id   bigserial PRIMARY KEY,
  zeitpunkt    timestamptz NOT NULL DEFAULT now(),
  subject      text,
  anzeige      text,
  client       text,
  werkzeug     text NOT NULL,
  parameter    jsonb,
  sql          text,
  sichten      text[],
  hinweise     jsonb,
  gesperrt     boolean NOT NULL DEFAULT false,
  zeilen       integer,
  dauer_ms     integer,
  fehler       text
);

COMMENT ON TABLE mcp.zugriff IS
'Jede Anfrage an den MCP-Server: wer, womit, welches SQL, welche Hinweise, wie viele
Zeilen, wie lange. Gesperrte Abfragen stehen MIT drin (gesperrt = true) — sie sind
der interessantere Teil: sie sagen, welche Falle wie oft zuschnappt.';

CREATE INDEX zugriff_zeitpunkt_idx ON mcp.zugriff (zeitpunkt DESC);
CREATE INDEX zugriff_werkzeug_idx  ON mcp.zugriff (werkzeug, zeitpunkt DESC);

-- ---------------------------------------------------------------------
-- Einrichtung, die noch aussteht
--
-- Die Leserolle braucht Rechte, die eine Migration nicht ueberall hat. Statt
-- den ganzen Migrationslauf daran scheitern zu lassen (und damit den
-- Containerstart), wird der Fehlstand HIER festgehalten und von /status
-- gemeldet. Regel 10: sichtbar statt still.
-- ---------------------------------------------------------------------
CREATE TABLE mcp.einrichtung_offen (
  punkt       text PRIMARY KEY,
  seit        timestamptz NOT NULL DEFAULT now(),
  meldung     text NOT NULL,
  behebung    text NOT NULL
);

COMMENT ON TABLE mcp.einrichtung_offen IS
'Was beim Migrieren nicht eingerichtet werden konnte und von Hand nachgeholt werden
muss — meist die Leserolle. Erwartung: leer. /status meldet jede Zeile.';

-- =====================================================================
-- mcp.achsen_ableiten() — den Katalog nachfuehren
--
-- Traegt neue mart-Sichten in mcp.sicht ein (ohne Koernung, damit sie in der
-- Arbeitsliste auftauchen) und leitet mcp.sicht_achse aus dem Katalog ab.
--
-- Die Ableitung stuetzt sich auf die Konvention, die im ganzen Schema gilt:
-- EIN SCHLUESSEL HEISST IN QUELLE UND ZIEL GLEICH. metabase/beziehungen.ts
-- nutzt sie seit dem 26.07.2026 fuer dieselbe Aufgabe. Wo eine Sicht eine
-- Achsenspalte fuehrt, traegt sie die Achse.
--
-- NACH JEDER MIGRATION, DIE EINE mart-SICHT ANLEGT ODER UMBENENNT, einmal
-- aufrufen. Der naechtliche Lauf tut das von selbst (src/sync/nachlauf).
-- =====================================================================
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
    SELECT 'mart.' || c.table_name AS sicht, c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'mart'
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
Umbenennen ueberleben.';

-- =====================================================================
-- mcp.koernung_in_kommentare() — die Koernung dorthin bringen, wo sie
-- auch Metabase nuetzt
--
-- Die Koernung wird hier gepflegt, gehoert aber genauso in den
-- Tabellenkommentar: Metabase zeigt ihn als Beschreibung an, Postico
-- daneben, und jeder Agent im Repository liest ihn ohnehin. Von Hand waere
-- das 165-mal denselben Kommentar neu schreiben — COMMENT ON ersetzt
-- vollstaendig, ein Anhaengen gibt es nicht.
--
-- Deshalb haengt diese Funktion den Satz an den bestehenden Kommentar an,
-- einmal, und erkennt an der Marke "Koernung:", dass sie schon dort war.
-- Idempotent; ein zweiter Lauf aendert nichts.
-- =====================================================================
CREATE OR REPLACE FUNCTION mcp.koernung_in_kommentare()
RETURNS TABLE (sicht text, gesetzt boolean)
LANGUAGE plpgsql AS $$
DECLARE
  r record; alt text; neu text; art text;
BEGIN
  FOR r IN
    SELECT s.sicht, s.koernung
      FROM mcp.sicht s
     WHERE s.koernung IS NOT NULL AND NOT s.entfallen
     ORDER BY s.sicht
  LOOP
    SELECT CASE WHEN c.relkind = 'm' THEN 'MATERIALIZED VIEW'
                WHEN c.relkind = 'v' THEN 'VIEW' ELSE 'TABLE' END,
           obj_description(c.oid, 'pg_class')
      INTO art, alt
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = split_part(r.sicht, '.', 1)
       AND c.relname = split_part(r.sicht, '.', 2);

    IF art IS NULL THEN CONTINUE; END IF;
    IF alt IS NOT NULL AND alt LIKE '%Koernung:%' THEN
      sicht := r.sicht; gesetzt := false; RETURN NEXT; CONTINUE;
    END IF;

    neu := coalesce(nullif(alt, '') || E'\n\n', '') || 'Koernung: ' || r.koernung;
    EXECUTE format('COMMENT ON %s %s IS %L', art, r.sicht, neu);
    sicht := r.sicht; gesetzt := true; RETURN NEXT;
  END LOOP;
END $$;

COMMENT ON FUNCTION mcp.koernung_in_kommentare() IS
'Haengt die gepflegte Koernung an den Tabellenkommentar an, damit Metabase und Postico
sie ebenfalls zeigen. Idempotent (erkennt die Marke "Koernung:"). Nach jeder Pflege
von mcp.sicht.koernung aufrufen.';

-- =====================================================================
-- mcp.rechte_auffrischen() — die Leserolle auf Stand bringen
--
-- WARUM DIE ROLLE UND NICHT EIN SQL-FILTER IM CODE.
-- Ein Filter, der `core` verbieten soll, ist eine Liste von Umgehungen, die
-- man nicht kennt: CTE, Funktion, search_path, Kommentartrick. Postgres hat
-- diese Pruefung eingebaut und sie ist vollstaendig. Der Parser im Server
-- kommt DAZU — fuer die Fallstricke, nicht fuer die Rechte.
--
-- WARUM KEIN PASSWORT HIER. Harte Regel 2: Zugangsdaten kommen aus
-- Umgebungsvariablen, nie aus dem Repository. Die Rolle entsteht ohne
-- Anmeldung; `ALTER ROLE mcp_leser LOGIN PASSWORD '...'` macht ein Mensch
-- einmal von Hand. Bis dahin steht der Punkt in mcp.einrichtung_offen.
-- =====================================================================
CREATE OR REPLACE FUNCTION mcp.rechte_auffrischen()
RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
    EXECUTE 'CREATE ROLE mcp_leser NOLOGIN';
  END IF;

  -- Grenzen an der Rolle, nicht an der Verbindung: wer sie umgehen will,
  -- muesste die Rolle aendern, und das steht im Protokoll der Datenbank.
  EXECUTE 'ALTER ROLE mcp_leser SET default_transaction_read_only = on';
  EXECUTE 'ALTER ROLE mcp_leser SET statement_timeout = ''20s''';
  EXECUTE 'ALTER ROLE mcp_leser SET idle_in_transaction_session_timeout = ''30s''';
  EXECUTE 'ALTER ROLE mcp_leser SET work_mem = ''32MB''';
  EXECUTE 'ALTER ROLE mcp_leser SET search_path = mart, manual, ampel, mcp';

  -- Was die Rolle NICHT sehen darf. `public` bekommt jede Rolle von Postgres
  -- mitgegeben; ohne diesen Entzug koennte dort jemand eine Bruecke bauen.
  EXECUTE 'REVOKE ALL ON SCHEMA public FROM mcp_leser';
  EXECUTE 'REVOKE ALL ON SCHEMA raw, part, core, sync FROM mcp_leser';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA raw, part, core, sync FROM mcp_leser';

  EXECUTE 'GRANT USAGE ON SCHEMA mart, manual, ampel, mcp TO mcp_leser';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA mart, manual, ampel, mcp TO mcp_leser';

  -- Das Einzige, was geschrieben wird: das eigene Protokoll. Ohne diese
  -- beiden Rechte liefe der Server, ohne Spuren zu hinterlassen — und ein
  -- Dienst ohne Protokoll ist einer, dessen Zahlen niemand nachvollziehen
  -- kann (Regel 10, und der Beleg-Grund aus dem Plan).
  EXECUTE 'GRANT INSERT ON mcp.zugriff TO mcp_leser';
  EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE mcp.zugriff_zugriff_id_seq TO mcp_leser';

  -- Neue Sichten sollen von selbst lesbar werden. Die Vorgabe haengt an dem
  -- Rollennamen, der die Objekte ANLEGT — das ist der Migrationsnutzer, also
  -- CURRENT_USER, nicht mcp_leser.
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA mart, manual, ampel, mcp '
    'GRANT SELECT ON TABLES TO mcp_leser', current_user);

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
'Legt die Leserolle mcp_leser an und setzt ihre Rechte und Grenzen. Idempotent, nach
jeder Migration aufrufbar. Das Anmeldepasswort setzt ein Mensch von Hand — bis dahin
meldet mcp.einrichtung_offen den Fehlstand und /status zeigt ihn.';

-- Einmal jetzt. Scheitert das an fehlenden Rechten, bricht NICHT der ganze
-- Migrationslauf ab (das haelt sonst den Containerstart an) — der Fehlstand
-- wird festgehalten und von /status gemeldet.
DO $$
BEGIN
  PERFORM mcp.rechte_auffrischen();
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO mcp.einrichtung_offen (punkt, meldung, behebung) VALUES (
    'mcp_leser',
    'Die Leserolle mcp_leser konnte nicht angelegt werden — der Migrationsnutzer darf keine Rollen anlegen.',
    'Als Datenbankadministrator einmal: SELECT mcp.rechte_auffrischen();')
  ON CONFLICT (punkt) DO NOTHING;
  RAISE WARNING 'mcp_leser nicht angelegt — steht in mcp.einrichtung_offen';
END $$;

-- =====================================================================
-- Sichten
-- =====================================================================

-- Der Katalog, wie der Server ihn liest: eine Zeile je Sicht, mit Achsen,
-- Kennzahlregeln und Fallstricken schon zusammengefasst. Ein Aufruf statt
-- vier — das spart bei `sicht_beschreiben` drei Umlaeufe.
CREATE VIEW mcp.sicht_katalog AS
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
        SELECT array_agg(col.column_name::text ORDER BY col.ordinal_position) AS spalten
          FROM information_schema.columns col
         WHERE col.table_schema = split_part(s.sicht, '.', 1)
           AND col.table_name   = split_part(s.sicht, '.', 2)) sp ON true
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

Koernung: eine Zeile je mart-Sicht, die im Katalog steht.';

-- Die Arbeitsliste. Erwartung: sie wird kleiner, nicht groesser.
CREATE VIEW mcp.koernung_fehlend AS
SELECT s.sicht,
       s.thema,
       obj_description(c.oid, 'pg_class') IS NOT NULL AS hat_kommentar,
       coalesce(sa.achsen, 0)                         AS achsen,
       s.zuletzt_gesehen
  FROM mcp.sicht s
  LEFT JOIN pg_class c ON c.relname = split_part(s.sicht, '.', 2)
       AND c.relnamespace = 'mart'::regnamespace
  LEFT JOIN LATERAL (SELECT count(*)::int AS achsen FROM mcp.sicht_achse x
                      WHERE x.sicht = s.sicht) sa ON true
 WHERE s.koernung IS NULL AND NOT s.entfallen
 ORDER BY coalesce(sa.achsen, 0) DESC, s.sicht;

COMMENT ON VIEW mcp.koernung_fehlend IS
'Sichten ohne hinterlegte Koernung — die Arbeitsliste. Wer ueber eine solche Sicht
aggregiert, bekommt zur Laufzeit eine Warnung statt einer Pruefung. Die achsenreichsten
zuerst: sie werden am haeufigsten verbunden und richten den groessten Schaden an.

Koernung: eine Zeile je mart-Sicht ohne gepflegte Koernung.';

-- Harte Regel 10: ein Dienst ohne Zulauf ist ein Fehler, kein Normalzustand.
CREATE VIEW mart.mcp_nutzung AS
SELECT date_trunc('day', z.zeitpunkt)::date       AS tag,
       z.werkzeug,
       count(*)::int                              AS aufrufe,
       count(DISTINCT z.subject)::int             AS nutzer,
       count(*) FILTER (WHERE z.gesperrt)::int    AS gesperrt,
       count(*) FILTER (WHERE z.fehler IS NOT NULL)::int AS fehler,
       round(avg(z.dauer_ms))::int                AS dauer_ms_schnitt,
       max(z.dauer_ms)                            AS dauer_ms_max,
       sum(z.zeilen)::bigint                      AS zeilen
  FROM mcp.zugriff z
 GROUP BY 1, 2
 ORDER BY 1 DESC, 3 DESC;

COMMENT ON VIEW mart.mcp_nutzung IS
'Nutzung des MCP-Zugangs je Tag und Werkzeug. Die Spalte gesperrt ist die
interessanteste: sie zaehlt, wie oft eine Falle zugeschnappt haette. Bleibt die Sicht
leer, benutzt niemand den Zugang — das ist ein Befund, kein Normalzustand (Regel 10).

Koernung: eine Zeile je Tag und Werkzeug.';

-- Welche freien Abfragen sich wiederholen. Das ist die Anforderungsliste
-- fuer die naechsten mart-Sichten und Metabase-Karten: was zehnmal frei
-- gefragt wird, gehoert als Bericht hinterlegt.
CREATE VIEW mart.mcp_wiederholte_fragen AS
SELECT md5(regexp_replace(lower(z.sql), '\s+', ' ', 'g'))      AS abfrage_signatur,
       min(z.sql)                                              AS beispiel,
       count(*)::int                                           AS mal,
       count(DISTINCT z.subject)::int                          AS nutzer,
       max(z.zeitpunkt)                                        AS zuletzt,
       bool_or(z.gesperrt)                                     AS je_gesperrt
  FROM mcp.zugriff z
 WHERE z.sql IS NOT NULL AND z.werkzeug = 'abfrage_ausfuehren'
 GROUP BY 1
HAVING count(*) > 1
 ORDER BY 3 DESC;

COMMENT ON VIEW mart.mcp_wiederholte_fragen IS
'Freie Abfragen, die mehr als einmal gestellt wurden — die Anforderungsliste fuer die
naechsten mart-Sichten und Karten. Was sich wiederholt, gehoert hinterlegt, damit es
nicht jedes Mal neu erfunden (und jedes Mal neu falsch) wird.

Koernung: eine Zeile je normalisierter Abfrage.';
