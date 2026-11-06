-- =====================================================================
-- 0148 — Wann ein MCP-Konto zuletzt etwas getan hat
--
-- ANLASS (06.11.2026, Auswertung der MCP-Nutzung): `mcp.nutzer.letzter_login`
-- stand bei allen 15 aktiven Konten vor dem 31.10.2026, obwohl alle bis zum
-- 05.11. Abfragen gestellt hatten — Daniel Gantenberg zuletzt am 19.10.
-- angemeldet, aber an diesem Morgen noch aktiv. Die Spalte ist nicht falsch,
-- sie misst etwas anderes: die PASSWORTANMELDUNG (`src/anmeldung/speicher.ts`).
-- Ein verbundener Client frischt danach 30 Tage lang nur seinen Token auf, und
-- das ist keine Anmeldung. Wer `bun run nutzer liste` liest, um zu sehen, wer
-- den Zugang noch benutzt, haette ruhende Konten gesehen, die keine waren —
-- und umgekehrt ein nie benutztes Konto nicht von einem fleissigen
-- unterscheiden koennen, solange beide einmal angemeldet waren.
--
-- WARUM EINE SICHT UND KEIN RECHT AUF mcp.zugriff. Die Aktivitaet steht nur im
-- Zugriffsprotokoll, und das gehoert keiner der beiden Rollen zum Lesen: es
-- fuehrt das SQL ALLER Nutzer im Wortlaut. `mcp_anmeldung` bekommt deshalb nur
-- diese Verdichtung — je Konto Zeitpunkte und Zahlen, keine Abfrage, kein
-- Parameter. Die Sicht laeuft mit den Rechten ihres Eigentuemers; dasselbe
-- Muster wie mcp.verbindung_stand aus 0139.
--
-- `letzter_login` bleibt, wie er ist: wann zuletzt jemand das Passwort
-- eingegeben hat, ist fuer die Sicherheit eine eigene Frage (ein Konto, das
-- sich ploetzlich neu anmeldet, obwohl seine Verbindung lebt).
-- =====================================================================

COMMENT ON COLUMN mcp.nutzer.letzter_login IS
'Letzte gelungene PASSWORTANMELDUNG. Kein Aktivitaetsmass: ein verbundener Client frischt
danach bis zu 30 Tage nur seinen Token auf, ohne dass sich diese Spalte bewegt. Wann ein
Konto zuletzt etwas abgefragt hat, steht in mcp.nutzer_aktivitaet.zuletzt_aktiv (0148).';

CREATE VIEW mcp.nutzer_aktivitaet AS
SELECT n.subject,
       n.email,
       n.anzeige,
       max(z.zeitpunkt)                                                  AS zuletzt_aktiv,
       min(z.zeitpunkt)                                                  AS erstmals_aktiv,
       count(z.zugriff_id)::int                                          AS aufrufe,
       count(z.zugriff_id) FILTER (WHERE z.zeitpunkt > now() - interval '30 days')::int
                                                                         AS aufrufe_30_tage,
       count(DISTINCT (z.zeitpunkt AT TIME ZONE 'Europe/Berlin')::date)
             FILTER (WHERE z.zeitpunkt > now() - interval '30 days')::int
                                                                         AS aktive_tage_30
  FROM mcp.nutzer n
  LEFT JOIN mcp.zugriff z ON z.subject = n.subject
 GROUP BY n.subject, n.email, n.anzeige;

COMMENT ON VIEW mcp.nutzer_aktivitaet IS
'Aktivitaet je MCP-Konto aus dem Zugriffsprotokoll: zuletzt_aktiv ist der letzte
Werkzeugaufruf, gleich welcher. zuletzt_aktiv NULL heisst: das Konto hat den Zugang nie
benutzt — auch wenn letzter_login gesetzt ist. aktive_tage_30 zaehlt deutsche
Kalendertage. Nur fuer die Anmeldung lesbar, nicht fuer mcp_leser: die Sicht nennt
Mailadressen. Das Protokoll selbst bleibt der Anmeldung verschlossen.

Koernung: eine Zeile je Konto, auch fuer gesperrte und inaktive.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_anmeldung') THEN
    EXECUTE 'GRANT SELECT ON mcp.nutzer_aktivitaet TO mcp_anmeldung';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
    EXECUTE 'REVOKE ALL ON mcp.nutzer_aktivitaet FROM mcp_leser';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'Rechte auf mcp.nutzer_aktivitaet nicht gesetzt — als Administrator: GRANT SELECT ON mcp.nutzer_aktivitaet TO mcp_anmeldung';
END $$;

-- Die Rechtepruefung aus 0105/0139 kennt die neue Sicht.
CREATE OR REPLACE VIEW mart.mcp_rechte_pruefung AS
SELECT t.tabelle,
       has_table_privilege('mcp_leser', t.tabelle, 'SELECT')      AS leser_darf,
       has_table_privilege('mcp_anmeldung', t.tabelle, 'SELECT')  AS anmeldung_darf,
       t.erwartung
  FROM (VALUES
    ('mcp.oauth_schluessel',    'nur_anmeldung'),
    ('mcp.nutzer',              'nur_anmeldung'),
    ('mcp.oauth_token',         'nur_anmeldung'),
    ('mcp.oauth_code',          'nur_anmeldung'),
    ('mcp.verbindung_stand',    'nur_anmeldung'),
    ('mcp.nutzer_aktivitaet',   'nur_anmeldung'),
    ('mcp.sicht_katalog',       'nur_leser'),
    ('mcp.zugriff',             'nur_leser')
  ) AS t(tabelle, erwartung)
 WHERE (t.erwartung = 'nur_anmeldung' AND has_table_privilege('mcp_leser', t.tabelle, 'SELECT'))
    OR (t.erwartung = 'nur_leser'     AND has_table_privilege('mcp_anmeldung', t.tabelle, 'SELECT'));
