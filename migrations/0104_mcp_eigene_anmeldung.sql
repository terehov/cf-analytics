-- =====================================================================
-- Eigene Anmeldung statt eines fremden Identitaetsanbieters
--
-- WARUM UEBERHAUPT.  Der MCP-Zugang braucht OAuth: Claude und ChatGPT
-- melden sich nicht mit Benutzername und Passwort an, sie holen sich ein
-- Token. Der Plan sah dafuer einen fremden Anbieter vor (Entra, WorkOS,
-- Auth0). Dagegen sprach beim Bauen zweierlei:
--
--   1. ENTRA KANN ES NICHT. ChatGPT meldet sich beim Verbinden per Dynamic
--      Client Registration (RFC 7591) selbst an. Entra hat dafuer keinen
--      Endpunkt — das ist keine Einstellung, sondern eine Luecke im
--      Funktionsumfang. Man braeuchte einen Zwischenserver, der die
--      Registrierung nachreicht: ein zweites bewegliches Teil fuer eine
--      Sache, die dieser Server selbst erledigen kann.
--   2. DREI NUTZER. Ein Vertrag, ein Mandant, eine weitere Oberflaeche und
--      eine weitere Rechnung fuer Eugene, Daniel und vielleicht einen OM.
--
-- *Eugene:* keinen externen Anbieter, Passwoerter in Postgres.
--
-- WAS DAS KOSTET, ehrlich benannt: kein zweiter Faktor, keine
-- Passwortruecksetzung per Mail, keine Kopplung an den Austritt aus dem
-- Unternehmen. Wer geht, muss HIER auf aktiv = false gesetzt werden — bei
-- einem Unternehmensanbieter waere das von selbst passiert. Das ist die
-- eigentliche Einbusse, und sie gehoert in `docs/offene-punkte.md`.
--
-- WAS DAS NICHT KOSTET: die Sicherheit des Verfahrens. OAuth 2.1 mit PKCE
-- ist vollstaendig spezifiziert, und der Teil, den wir brauchen, ist klein:
-- ein Anmeldeformular, ein Code, ein Token. Alles, was hier nicht steht
-- (Zustimmungsseiten, Mandanten, Rollenverwaltung), braucht niemand.
--
-- =====================================================================
-- DIE WICHTIGSTE ENTSCHEIDUNG DIESER MIGRATION: EINE ZWEITE ROLLE
-- =====================================================================
-- `mcp_leser` fuehrt NUTZEREINGABEN als SQL aus (Werkzeug
-- `abfrage_ausfuehren`), und `mcp` steht auf der Liste der erlaubten
-- Schemata, weil der Katalog dort liegt. Laegen die Passworthashes und der
-- Signierschluessel im selben Schema mit denselben Rechten, koennte ein
-- Nutzer mit der Stufe `fragen` schlicht
--
--     SELECT passwort_hash FROM mcp.nutzer;
--     SELECT privat_jwk    FROM mcp.oauth_schluessel;
--
-- schreiben — und mit dem zweiten Ergebnis beliebige Tokens ausstellen, also
-- die Anmeldung ganz umgehen. Das waere kein Randfall: es ist genau der
-- Weg, den ein Modell beim Herumprobieren von selbst findet.
--
-- Deshalb eine zweite Rolle `mcp_anmeldung` mit einer EIGENEN Verbindung im
-- Server. `mcp_leser` bekommt auf keine dieser Tabellen ein Recht; Postgres
-- beantwortet den Versuch mit `permission denied`, unabhaengig davon, was
-- der Pruefer im Server tut. Der Pruefer meldet es zusaetzlich verstaendlich
-- — aber tragend ist die Rolle.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Nutzer
--
-- `mcp.nutzer_stufe` hiess so, als sie nur eine Stufe trug. Sie traegt jetzt
-- die Anmeldung selbst; der alte Name waere irrefuehrend. Umbenennen ist
-- hier gefahrlos: die Tabelle ist nie in Produktion gegangen.
-- ---------------------------------------------------------------------
-- Der CHECK heisst weiter `nutzer_stufe_bekannt`: einen Constraint nur des
-- Namens wegen umzubenennen ist Bewegung ohne Gewinn, und er sagt weiterhin,
-- was er prueft.
ALTER TABLE mcp.nutzer_stufe RENAME TO nutzer;

ALTER TABLE mcp.nutzer
  ADD COLUMN email          text,
  ADD COLUMN passwort_hash  text,
  ADD COLUMN aktiv          boolean     NOT NULL DEFAULT true,
  ADD COLUMN letzter_login  timestamptz,
  ADD COLUMN fehlversuche   int         NOT NULL DEFAULT 0,
  ADD COLUMN gesperrt_bis   timestamptz;

-- Die Anmeldung laeuft ueber die Mailadresse, gross/klein egal. Ein
-- funktionaler Index statt `citext`: die Erweiterung waere eine
-- Abhaengigkeit mehr in einer verwalteten Datenbank, und `lower()` tut
-- dasselbe.
CREATE UNIQUE INDEX nutzer_email_idx ON mcp.nutzer (lower(email)) WHERE email IS NOT NULL;

COMMENT ON TABLE mcp.nutzer IS
'Wer den MCP-Zugang benutzen darf, und womit er sich anmeldet. Passwoerter als
argon2id-Hash (Bun.password), nie im Klartext. stufe: lesen = Berichte und Katalog,
fragen = zusaetzlich freies SQL, gesperrt = nichts. WER GEHT, WIRD HIER auf aktiv = false
GESETZT — es gibt keinen Unternehmensanbieter, der das von selbst tut.

Koernung: eine Zeile je Nutzer.';
COMMENT ON COLUMN mcp.nutzer.passwort_hash IS
'argon2id, erzeugt mit Bun.password.hash(). Nie loggen, nie ausgeben, nie in einen
Fehlertext schreiben.';
COMMENT ON COLUMN mcp.nutzer.gesperrt_bis IS
'Zeitsperre nach wiederholten Fehlversuchen. Harte Regel 7 sinngemaess: wiederholte
Fehlanmeldungen werden gebremst, nicht gezaehlt und durchgewinkt.';

-- ---------------------------------------------------------------------
-- Angemeldete Clients (Dynamic Client Registration, RFC 7591)
--
-- ChatGPT und Claude registrieren sich beim ersten Verbinden selbst. Das
-- ist der Grund, warum dieser Server seine eigene Anmeldung mitbringt: die
-- Registrierung ist hier drei Zeilen, bei Entra gar nicht vorgesehen.
--
-- Offen registrierbar, aber folgenlos: ein registrierter Client kann NICHTS,
-- solange sich kein Mensch mit gueltigem Passwort daran anmeldet. Die
-- Registrierung vergibt nur einen Namen, keinen Zugang.
-- ---------------------------------------------------------------------
CREATE TABLE mcp.oauth_client (
  client_id      text PRIMARY KEY,
  client_name    text,
  redirect_uris  text[] NOT NULL,
  angelegt_am    timestamptz NOT NULL DEFAULT now(),
  letzte_nutzung timestamptz
);

COMMENT ON TABLE mcp.oauth_client IS
'Clients, die sich selbst registriert haben (RFC 7591) — in der Praxis ChatGPT, Claude
und VS Code. Eine Registrierung vergibt nur eine Kennung; Zugang entsteht erst, wenn sich
ein Mensch mit Passwort daran anmeldet.

Koernung: eine Zeile je registriertem Client.';

-- ---------------------------------------------------------------------
-- Autorisierungscodes
--
-- Kurzlebig, einmalig, an Client, Rueckadresse und PKCE-Pruefwert gebunden.
-- Gespeichert wird der HASH, nicht der Code: ein Datenbankabzug soll keine
-- gueltigen Codes enthalten. Bei 60 Sekunden Lebensdauer ist das fast
-- theoretisch — aber „fast" ist bei Zugangsdaten kein Argument.
-- ---------------------------------------------------------------------
CREATE TABLE mcp.oauth_code (
  code_hash      text PRIMARY KEY,
  client_id      text NOT NULL,
  subject        text NOT NULL,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  scope          text,
  resource       text,
  laeuft_ab      timestamptz NOT NULL,
  eingeloest_am  timestamptz
);

CREATE INDEX oauth_code_laeuft_ab_idx ON mcp.oauth_code (laeuft_ab);

COMMENT ON TABLE mcp.oauth_code IS
'Autorisierungscodes, als SHA-256-Hash. Einmalig einloesbar (eingeloest_am), 60 Sekunden
gueltig, gebunden an client_id, redirect_uri und den PKCE-Pruefwert.

Koernung: eine Zeile je ausgestelltem Code.';

-- ---------------------------------------------------------------------
-- Auffrischungstokens
--
-- Rotierend: bei jeder Einloesung wird der alte widerrufen und ein neuer
-- ausgegeben. Taucht ein bereits eingeloester wieder auf, ist er
-- abhandengekommen — dann wird die ganze Kette widerrufen, statt beide
-- weiterlaufen zu lassen.
-- ---------------------------------------------------------------------
CREATE TABLE mcp.oauth_token (
  token_hash     text PRIMARY KEY,
  client_id      text NOT NULL,
  subject        text NOT NULL,
  angelegt_am    timestamptz NOT NULL DEFAULT now(),
  laeuft_ab      timestamptz NOT NULL,
  widerrufen_am  timestamptz,
  ersetzt_durch  text
);

CREATE INDEX oauth_token_subject_idx ON mcp.oauth_token (subject) WHERE widerrufen_am IS NULL;

COMMENT ON TABLE mcp.oauth_token IS
'Auffrischungstokens als SHA-256-Hash, rotierend. Wird ein schon eingeloester Token erneut
vorgelegt, gilt er als abhandengekommen und die ganze Kette wird widerrufen.

Koernung: eine Zeile je ausgestelltem Auffrischungstoken.';

-- ---------------------------------------------------------------------
-- Der Signierschluessel
--
-- Ein RSA-Schluesselpaar, erzeugt beim ersten Start. In der Datenbank, nicht
-- in einer Umgebungsvariablen: ein Neustart soll nicht jedes ausgegebene
-- Token entwerten, und eine Rotation soll kein Deploy brauchen.
--
-- DASS DER PRIVATE TEIL HIER LIEGT, IST VERTRETBAR — aber nur wegen der
-- zweiten Rolle oben. Er ist fuer `mcp_leser` unsichtbar und damit auch fuer
-- jedes SQL, das ein Nutzer schreibt. Ohne diese Trennung waere die Tabelle
-- ein Generalschluessel neben dem Schloss.
-- ---------------------------------------------------------------------
CREATE TABLE mcp.oauth_schluessel (
  kid              text PRIMARY KEY,
  privat_jwk       jsonb NOT NULL,
  oeffentlich_jwk  jsonb NOT NULL,
  angelegt_am      timestamptz NOT NULL DEFAULT now(),
  aktiv            boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE mcp.oauth_schluessel IS
'Das Schluesselpaar, mit dem Zugangstokens signiert werden (RS256). Beim ersten Start
erzeugt. Nur fuer die Rolle mcp_anmeldung lesbar — NICHT fuer mcp_leser, unter der die
Abfragen der Nutzer laufen.

Koernung: eine Zeile je Schluessel; genau einer ist aktiv.';

-- ---------------------------------------------------------------------
-- Anmeldeprotokoll
--
-- Regel 10, auf die Anmeldung angewandt: eine Fehlanmeldung, die niemand
-- sieht, ist ein Einbruchsversuch, den niemand sieht. Gelungene stehen
-- ebenfalls drin — sonst laesst sich „war das er?" nicht beantworten.
-- Ohne Passwort, versteht sich, und ohne Token.
-- ---------------------------------------------------------------------
CREATE TABLE mcp.anmeldung_protokoll (
  id          bigserial PRIMARY KEY,
  zeitpunkt   timestamptz NOT NULL DEFAULT now(),
  email       text,
  subject     text,
  erfolg      boolean NOT NULL,
  grund       text,
  herkunft    text
);

CREATE INDEX anmeldung_protokoll_zeit_idx ON mcp.anmeldung_protokoll (zeitpunkt DESC);

COMMENT ON TABLE mcp.anmeldung_protokoll IS
'Jeder Anmeldeversuch am MCP-Zugang, gelungen wie gescheitert. Ohne Passwort und ohne
Token. Grundlage der Pruefzeile in /status.

Koernung: eine Zeile je Anmeldeversuch.';

-- =====================================================================
-- Die Rollen
-- =====================================================================
CREATE OR REPLACE FUNCTION mcp.rechte_anmeldung_auffrischen()
RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_anmeldung') THEN
    EXECUTE 'CREATE ROLE mcp_anmeldung NOLOGIN';
  END IF;

  EXECUTE 'ALTER ROLE mcp_anmeldung SET statement_timeout = ''10s''';
  EXECUTE 'ALTER ROLE mcp_anmeldung SET search_path = mcp';

  -- Die Anmeldung sieht die AUSWERTUNGSDATEN nicht. Sie hat mit ihnen
  -- nichts zu tun, und was eine Rolle nicht sehen kann, kann sie auch
  -- nicht verlieren.
  EXECUTE 'REVOKE ALL ON SCHEMA public, raw, part, core, sync, mart, manual, ampel FROM mcp_anmeldung';
  EXECUTE 'GRANT USAGE ON SCHEMA mcp TO mcp_anmeldung';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON
             mcp.nutzer, mcp.oauth_client, mcp.oauth_code, mcp.oauth_token,
             mcp.oauth_schluessel, mcp.anmeldung_protokoll
           TO mcp_anmeldung';
  EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE mcp.anmeldung_protokoll_id_seq TO mcp_anmeldung';

  -- UND DAS UMGEKEHRTE, das eigentlich Tragende: der Leser kommt an keine
  -- dieser Tabellen. `mcp_leser` fuehrt Nutzereingaben als SQL aus; ohne
  -- diesen Entzug liesse sich der Passworthash oder der Signierschluessel
  -- einfach abfragen.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
    EXECUTE 'REVOKE ALL ON
               mcp.nutzer, mcp.oauth_client, mcp.oauth_code, mcp.oauth_token,
               mcp.oauth_schluessel, mcp.anmeldung_protokoll
             FROM mcp_leser';
  END IF;

  DELETE FROM mcp.einrichtung_offen WHERE punkt = 'mcp_anmeldung';

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_anmeldung' AND rolcanlogin) THEN
    INSERT INTO mcp.einrichtung_offen (punkt, meldung, behebung) VALUES (
      'mcp_anmeldung_passwort',
      'Die Anmelderolle mcp_anmeldung hat keine Anmeldung — der MCP-Server kann keine Tokens ausstellen.',
      'Einmal von Hand: ALTER ROLE mcp_anmeldung LOGIN PASSWORD ''...''; danach '
      'MCP_AUTH_DATABASE_URL setzen. Das Passwort gehoert NICHT ins Repository (harte Regel 2).')
    ON CONFLICT (punkt) DO NOTHING;
  ELSE
    DELETE FROM mcp.einrichtung_offen WHERE punkt = 'mcp_anmeldung_passwort';
  END IF;

  RETURN 'mcp_anmeldung eingerichtet';
END $$;

COMMENT ON FUNCTION mcp.rechte_anmeldung_auffrischen() IS
'Legt die Anmelderolle an und trennt sie von der Leserolle: mcp_anmeldung sieht nur die
Anmeldetabellen, mcp_leser sieht sie NICHT. Idempotent, nach jeder Migration aufrufbar.';

DO $$
BEGIN
  PERFORM mcp.rechte_anmeldung_auffrischen();
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO mcp.einrichtung_offen (punkt, meldung, behebung) VALUES (
    'mcp_anmeldung',
    'Die Anmelderolle mcp_anmeldung konnte nicht angelegt werden.',
    'Als Datenbankadministrator einmal: SELECT mcp.rechte_anmeldung_auffrischen();')
  ON CONFLICT (punkt) DO NOTHING;
  RAISE WARNING 'mcp_anmeldung nicht angelegt — steht in mcp.einrichtung_offen';
END $$;

-- Aufraeumen: abgelaufene Codes und Tokens. Ruft der naechtliche Lauf mit.
CREATE OR REPLACE FUNCTION mcp.anmeldung_aufraeumen()
RETURNS TABLE (codes int, tokens int)
LANGUAGE plpgsql AS $$
DECLARE c int; t int;
BEGIN
  DELETE FROM mcp.oauth_code WHERE laeuft_ab < now() - interval '1 day';
  GET DIAGNOSTICS c = ROW_COUNT;
  DELETE FROM mcp.oauth_token WHERE laeuft_ab < now() - interval '7 days';
  GET DIAGNOSTICS t = ROW_COUNT;
  RETURN QUERY SELECT c, t;
END $$;

COMMENT ON FUNCTION mcp.anmeldung_aufraeumen() IS
'Loescht abgelaufene Codes und Auffrischungstokens. Gefahrlos jederzeit aufrufbar.';

-- Was /status liest.
CREATE VIEW mart.mcp_anmeldung AS
SELECT date_trunc('day', p.zeitpunkt)::date          AS tag,
       count(*)::int                                 AS versuche,
       count(*) FILTER (WHERE p.erfolg)::int         AS gelungen,
       count(*) FILTER (WHERE NOT p.erfolg)::int     AS gescheitert,
       count(DISTINCT p.email) FILTER (WHERE NOT p.erfolg)::int AS konten_mit_fehlversuch
  FROM mcp.anmeldung_protokoll p
 GROUP BY 1
 ORDER BY 1 DESC;

COMMENT ON VIEW mart.mcp_anmeldung IS
'Anmeldeversuche am MCP-Zugang je Tag. Eine Haeufung gescheiterter Versuche auf mehreren
Konten ist das Muster, das man sehen will, bevor es jemand anders sieht.

Koernung: eine Zeile je Tag.';
