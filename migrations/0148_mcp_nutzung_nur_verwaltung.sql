-- =====================================================================
-- 0148 — Wer den MCP-Zugang wie nutzt, sehen nur Eugene und Daniel
--
-- ANLASS (06.11.2026, Auswertung der MCP-Nutzung). Zwei Befunde:
--
-- 1. JEDER NUTZER KONNTE DAS ZUGRIFFSPROTOKOLL LESEN. `mcp_leser` — die Rolle,
--    unter der das SQL der Nutzer laeuft — hatte seit 0105 SELECT auf
--    mcp.zugriff (0110 hat es wiederholt), und der Pruefer liess das Schema
--    `mcp` zu. Alle 16 Konten stehen auf `fragen`. Ein
--    `SELECT anzeige, zeitpunkt, sql FROM mcp.zugriff` lieferte also jedem
--    die Namen, Uhrzeiten und Abfragen aller Kollegen. Der Plan
--    (docs/plan-skybridge.md, Abschnitt 5) sah nur das Schreiben vor; der
--    Server selbst las nie. Dazu, fuer jeden lesbar: mart.mcp_nutzung
--    (Aufrufe und Zahl der Nutzer je Tag), mart.mcp_wiederholte_fragen
--    (Beispiel-SQL anderer) und mart.mcp_anmeldung (Anmeldeversuche).
--    Benutzt hat das laut Protokoll bis heute niemand ausser Eugene.
--
-- 2. `mcp.nutzer.letzter_login` sah aus wie „zuletzt aktiv" und war es nicht:
--    alle Konten standen vor dem 31.10., aktiv waren alle bis zum 05.11. Die
--    Spalte misst die PASSWORTANMELDUNG; ein verbundener Client frischt danach
--    30 Tage nur seinen Token auf.
--
-- ENTSCHIEDEN (Eugene, 06.11.2026): Ein Nutzer sieht keine anderen Nutzer und
-- kann auch die Nutzung nicht abfragen — nicht einmal als Zahl. Eugene und
-- Daniel bekommen eine Auswertung ueber ein eigenes Werkzeug
-- (`nutzung_auswerten`), freigeschaltet ueber `mcp.nutzer.darf_nutzung`.
--
-- WAS DAFUER GEAENDERT WIRD:
--
--   * Das Protokoll gehoert ab hier der VERWALTUNGSROLLE `mcp_anmeldung`.
--     Sie schreibt es (der Server, src/ausfuehren.ts) und liest es (das
--     Werkzeug). Das ist keine neue Vertrauensstufe: diese Rolle fuehrt nie
--     Nutzereingaben als SQL aus und haelt ohnehin Passworthashes und den
--     Signierschluessel. Die Grenze, die zaehlt, ist die zwischen der Rolle
--     mit Nutzer-SQL und allen anderen.
--   * `mcp_leser` verliert JEDES Recht auf mcp.zugriff und seine Sequenz. Ein
--     reines INSERT-Recht haette nicht gereicht: `RETURNING` braucht SELECT,
--     und mit USAGE auf der Sequenz liefert `currval()` auf einer geteilten
--     Poolverbindung die letzte Protokollnummer eines anderen — also die
--     Gesamtzahl aller Aufrufe.
--   * Aus demselben Grund geht an den Client keine fortlaufende Nummer mehr,
--     sondern ein zufaelliger Beleg (`beleg`).
--   * Die drei mart.mcp_*-Sichten wandern nach `mcp`. In `mart` waeren sie bei
--     jedem kuenftigen `GRANT SELECT ON ALL TABLES IN SCHEMA mart` wieder
--     offen, und mcp.achsen_ableiten() traegt jede mart-Sicht von selbst in
--     den Katalog ein, den `sichten_suchen` durchsucht.
--   * Der Pruefer laesst in `mcp` nur noch die Katalogtabellen zu
--     (mcp/src/pruefen.ts) — die Rechte sind die Sperre, die Meldung sagt
--     dem Modell, warum, damit es nicht dreimal umformuliert.
--   * mart.mcp_rechte_pruefung kennt alle betroffenen Objekte und prueft
--     Spaltenrechte mit; /status meldet jede Zeile darin als Stoerung.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Wer die Nutzung sehen darf
-- ---------------------------------------------------------------------
ALTER TABLE mcp.nutzer
  ADD COLUMN darf_nutzung boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN mcp.nutzer.darf_nutzung IS
'Darf dieses Konto die Nutzung des MCP-Zugangs auswerten (Werkzeug nutzung_auswerten)?
Nur dann sieht es das Werkzeug ueberhaupt. Alle anderen sehen weder andere Nutzer noch
Nutzungszahlen. Setzen mit `bun run nutzer nutzung <email> an|aus`. Entschieden 06.11.2026:
Eugene und Daniel.';

-- Eugene (evgenij@brain.food) und Daniel Gantenberg, nach Kennung statt nach
-- Mailadresse: die Kennung aendert sich nie. Auf einer Datenbank ohne diese
-- Konten (Testklon) aendert der Befehl nichts.
UPDATE mcp.nutzer SET darf_nutzung = true
 WHERE subject IN ('d350487f-ccfb-4115-82cf-811186abc7ce',
                   '38e914c7-1031-4b81-addf-7b8a929915c9');

COMMENT ON COLUMN mcp.nutzer.letzter_login IS
'Letzte gelungene PASSWORTANMELDUNG. Kein Aktivitaetsmass: ein verbundener Client frischt
danach bis zu 30 Tage nur seinen Token auf, ohne dass sich diese Spalte bewegt. Wann ein
Konto zuletzt etwas abgefragt hat, steht in mcp.nutzer_aktivitaet.zuletzt_aktiv (0148).';

-- ---------------------------------------------------------------------
-- Der Beleg: was der Client zum Protokolleintrag erfaehrt
-- ---------------------------------------------------------------------
ALTER TABLE mcp.zugriff
  ADD COLUMN beleg uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX zugriff_beleg_idx ON mcp.zugriff (beleg);

COMMENT ON COLUMN mcp.zugriff.beleg IS
'Zufaellige Kennung des Eintrags — das, was der Client als protokoll_id bekommt. Bis 0148
war das zugriff_id, und eine fortlaufende Nummer verraet jedem Nutzer, wie viele Aufrufe
es insgesamt gab.';

-- ---------------------------------------------------------------------
-- Die Nutzungssichten aus mart heraus
-- ---------------------------------------------------------------------
ALTER VIEW mart.mcp_nutzung SET SCHEMA mcp;
ALTER VIEW mcp.mcp_nutzung RENAME TO nutzung_tag;
ALTER VIEW mart.mcp_wiederholte_fragen SET SCHEMA mcp;
ALTER VIEW mcp.mcp_wiederholte_fragen RENAME TO wiederholte_fragen;
ALTER VIEW mart.mcp_anmeldung SET SCHEMA mcp;
ALTER VIEW mcp.mcp_anmeldung RENAME TO anmeldung_tag;

-- Raus aus dem Katalog, den sichten_suchen durchsucht. Achsen und
-- Fallstricke haengen mit ON DELETE CASCADE daran.
DELETE FROM mcp.sicht
 WHERE sicht IN ('mart.mcp_nutzung', 'mart.mcp_wiederholte_fragen', 'mart.mcp_anmeldung');

COMMENT ON VIEW mcp.nutzung_tag IS
'Nutzung des MCP-Zugangs je Tag und Werkzeug (bis 0148 mart.mcp_nutzung). Nur fuer
mcp_anmeldung lesbar: auch eine Zahl ohne Namen ist eine Nutzungsauskunft, und die gibt
es nur fuer Konten mit darf_nutzung (Werkzeug nutzung_auswerten). Bleibt die Sicht leer,
benutzt niemand den Zugang — ein Befund, kein Normalzustand (Regel 10).

Koernung: eine Zeile je Tag und Werkzeug.';

COMMENT ON VIEW mcp.wiederholte_fragen IS
'Freie Abfragen, die mehr als einmal gestellt wurden (bis 0148 mart.mcp_wiederholte_fragen)
— die Anforderungsliste fuer die naechsten mart-Sichten und Karten. Nur fuer
mcp_anmeldung lesbar: beispiel ist das SQL eines Nutzers im Wortlaut.

Koernung: eine Zeile je normalisierter Abfrage.';

COMMENT ON VIEW mcp.anmeldung_tag IS
'Anmeldeversuche am MCP-Zugang je Tag (bis 0148 mart.mcp_anmeldung). Nur fuer
mcp_anmeldung lesbar.

Koernung: eine Zeile je Tag.';

-- ---------------------------------------------------------------------
-- Aktivitaet je Konto — fuer `bun run nutzer liste` und das Werkzeug
-- ---------------------------------------------------------------------
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
Kalendertage. Nur fuer mcp_anmeldung lesbar.

Koernung: eine Zeile je Konto, auch fuer gesperrte und inaktive.';

-- ---------------------------------------------------------------------
-- Rechte
--
-- Schlaegt das fehl, ist das KEIN harmloser Fehlstand: bleibt der Entzug
-- aus, sieht jeder Nutzer weiter das Protokoll; bleibt der Grant aus, hat
-- das Protokoll Luecken. Deshalb nach mcp.einrichtung_offen — /status
-- steht dann auf 503, statt dass es eine Warnung im Migrationslog bleibt.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
    EXECUTE 'REVOKE ALL ON mcp.zugriff, mcp.nutzung_tag, mcp.wiederholte_fragen,
                           mcp.anmeldung_tag, mcp.nutzer_aktivitaet
             FROM mcp_leser';
    EXECUTE 'REVOKE ALL ON SEQUENCE mcp.zugriff_zugriff_id_seq FROM mcp_leser';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_anmeldung') THEN
    EXECUTE 'GRANT SELECT, INSERT ON mcp.zugriff TO mcp_anmeldung';
    EXECUTE 'GRANT USAGE ON SEQUENCE mcp.zugriff_zugriff_id_seq TO mcp_anmeldung';
    EXECUTE 'GRANT SELECT ON mcp.nutzung_tag, mcp.wiederholte_fragen, mcp.anmeldung_tag,
                             mcp.nutzer_aktivitaet
             TO mcp_anmeldung';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO mcp.einrichtung_offen (punkt, meldung, behebung) VALUES (
    'mcp_nutzung_rechte',
    'Die Rechte aus 0148 sind nicht gesetzt: entweder liest mcp_leser weiter das '
    'Zugriffsprotokoll, oder mcp_anmeldung kann es nicht schreiben.',
    'Als Administrator die Rechte-Bloecke aus migrations/0148_mcp_nutzung_nur_verwaltung.sql '
    'ausfuehren, danach diese Zeile loeschen. SELECT * FROM mart.mcp_rechte_pruefung muss leer sein.')
  ON CONFLICT (punkt) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------
-- Die Rechtepruefung aus 0105/0139 kennt alles, was oben geschuetzt wird.
--
-- has_any_column_privilege statt has_table_privilege: ein Spaltenrecht
-- (etwa SELECT (zugriff_id) fuer ein RETURNING) reicht fuer count(*), und
-- has_table_privilege sieht es nicht.
-- ---------------------------------------------------------------------
--
-- CASE statt AND fuer die Existenzpruefung: SQL legt die Reihenfolge der
-- Bedingungen nicht fest, und has_any_column_privilege wirft auf ein Objekt,
-- das es nicht gibt (mcp.verbindung_stand fehlt auf Klonen vor 0139).
CREATE OR REPLACE VIEW mart.mcp_rechte_pruefung AS
SELECT tabelle, leser_darf, anmeldung_darf, erwartung
  FROM (
SELECT t.tabelle,
       CASE WHEN to_regclass(t.tabelle) IS NOT NULL
            THEN has_any_column_privilege('mcp_leser', t.tabelle, 'SELECT') END      AS leser_darf,
       CASE WHEN to_regclass(t.tabelle) IS NOT NULL
            THEN has_any_column_privilege('mcp_anmeldung', t.tabelle, 'SELECT') END  AS anmeldung_darf,
       t.erwartung
  FROM (VALUES
    ('mcp.oauth_schluessel',    'nur_anmeldung'),
    ('mcp.nutzer',              'nur_anmeldung'),
    ('mcp.oauth_token',         'nur_anmeldung'),
    ('mcp.oauth_code',          'nur_anmeldung'),
    ('mcp.verbindung_stand',    'nur_anmeldung'),
    ('mcp.zugriff',             'nur_anmeldung'),
    ('mcp.nutzung_tag',         'nur_anmeldung'),
    ('mcp.wiederholte_fragen',  'nur_anmeldung'),
    ('mcp.anmeldung_tag',       'nur_anmeldung'),
    ('mcp.nutzer_aktivitaet',   'nur_anmeldung'),
    ('mcp.sicht_katalog',       'nur_leser')
  ) AS t(tabelle, erwartung)
       ) r
 WHERE (erwartung = 'nur_anmeldung' AND leser_darf)
    OR (erwartung = 'nur_leser'     AND anmeldung_darf)
UNION ALL
SELECT 'mcp.zugriff_zugriff_id_seq', true, NULL, 'nur_anmeldung'
 WHERE has_sequence_privilege('mcp_leser', 'mcp.zugriff_zugriff_id_seq', 'USAGE, SELECT, UPDATE');
