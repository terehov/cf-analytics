-- =====================================================================
-- 0139 — Wie viele Verbindungen ein MCP-Konto gleichzeitig haben darf
--
-- ANLASS (28.10.2026, Eugene): bei einzelnen Konten soll sichergestellt
-- sein, dass der Zugang nicht weitergegeben wird. Ein Konto, das auf drei
-- fremden Rechnern verbunden ist, sieht heute genauso aus wie eines auf
-- Laptop und Handy.
--
-- WAS EINE VERBINDUNG IST. Jede gelungene Anmeldung beginnt eine Kette von
-- Auffrischungstokens; jede Auffrischung ersetzt den lebenden Token der
-- Kette durch einen neuen (Rotation, 0104). Eine Kette ist also ein
-- verbundener Client — ChatGPT im Browser, Claude auf dem Handy, VS Code —,
-- und je Kette lebt genau ein Token. Bisher war die Kette nur ueber
-- `ersetzt_durch` verknuepft; `kette_id` macht sie zaehlbar und trennbar.
--
-- ENTSCHIEDEN: ABLEHNEN, NICHT VERDRAENGEN (Eugene, 28.10.2026). Ist die
-- Grenze erreicht, scheitert die neue Anmeldung sofort mit einer Meldung;
-- die bestehenden bleiben. JEDE LEBENDE KETTE ZAEHLT, bis sie ablaeuft (30
-- Tage nach der letzten Auffrischung) oder WIR sie trennen (`bun run nutzer
-- trennen`). Ein Platz wird nie von selbst frei — freigegeben wird er von
-- uns. Der Preis ist bekannt: wer einen Connector entfernt und neu anlegt,
-- hinterlaesst eine Kette, die der Client nicht widerruft, und steht dann
-- vor der Grenze, bis jemand trennt. Verworfene und vertagte Wege
-- (verdraengen, ruhende Ketten nicht zaehlen, Erkennung ueber Netze) stehen
-- in docs/entscheidungen.md.
--
-- WAS DAS NICHT KANN: wer seinen ganzen ChatGPT- oder Claude-Zugang
-- weitergibt, benutzt dieselbe Kette. Das sieht keine Grenze.
-- =====================================================================

ALTER TABLE mcp.nutzer
  ADD COLUMN max_verbindungen int CHECK (max_verbindungen IS NULL OR max_verbindungen >= 1);

COMMENT ON COLUMN mcp.nutzer.max_verbindungen IS
'Hoechstzahl gleichzeitig aktiver Verbindungen (Tokenketten) dieses Kontos. NULL = keine
Grenze. Ist sie erreicht, wird eine neue Anmeldung ABGELEHNT (nicht die aelteste
verdraengt) und als grund = ''verbindungslimit'' protokolliert. Es zaehlt jede lebende
Kette; frei wird ein Platz nur durch Ablauf oder `bun run nutzer trennen`. Setzen mit
`bun run nutzer limit <email> <n|aus>`.';

ALTER TABLE mcp.oauth_token
  ADD COLUMN kette_id       uuid,
  ADD COLUMN verbunden_seit timestamptz;

COMMENT ON COLUMN mcp.oauth_token.kette_id IS
'Die Verbindung, zu der dieser Token gehoert. Bei der Anmeldung neu vergeben, bei jeder
Rotation weitergereicht. Steht auch im Zugangstoken (Claim kette), damit eine getrennte
Verbindung sofort nichts mehr darf und nicht erst nach Ablauf der Stunde.';
COMMENT ON COLUMN mcp.oauth_token.verbunden_seit IS
'Zeitpunkt der Anmeldung, die diese Kette begonnen hat. Fuer Ketten vor 0139 aus dem
aeltesten noch vorhandenen Glied nachgetragen — anmeldung_aufraeumen() loescht Glieder
7 Tage nach Ablauf, dort ist es also eine Untergrenze.';

-- Bestehende Ketten nachtragen: Wurzel ist ein Token, auf den kein
-- ersetzt_durch zeigt; die Glieder erben ihre Kennung.
WITH RECURSIVE kette AS (
  SELECT t.token_hash, t.ersetzt_durch, gen_random_uuid() AS kette_id, t.angelegt_am AS seit
    FROM mcp.oauth_token t
   WHERE NOT EXISTS (SELECT 1 FROM mcp.oauth_token v WHERE v.ersetzt_durch = t.token_hash)
  UNION ALL
  SELECT n.token_hash, n.ersetzt_durch, k.kette_id, k.seit
    FROM kette k
    JOIN mcp.oauth_token n ON n.token_hash = k.ersetzt_durch
)
UPDATE mcp.oauth_token t
   SET kette_id = k.kette_id, verbunden_seit = k.seit
  FROM kette k
 WHERE k.token_hash = t.token_hash;

CREATE INDEX oauth_token_kette_idx ON mcp.oauth_token (kette_id) WHERE widerrufen_am IS NULL;

-- ---------------------------------------------------------------------
-- Die Pruefsicht: je Konto Grenze, aktive Verbindungen und Ablehnungen.
--
-- In `mcp`, nicht in `mart`: sie nennt Mailadressen, und `mcp_leser`
-- fuehrt Nutzereingaben als SQL aus. Sie gehoert der Anmeldung.
--
-- Eine Ablehnung heisst: jemand kannte das Passwort und kam nicht hinein.
-- Kommt sie von einem fremden Netz, ist das der Fall, fuer den die Grenze
-- gebaut ist.
-- ---------------------------------------------------------------------
CREATE VIEW mcp.verbindung_stand AS
WITH lebend AS (
  SELECT subject, count(*)::int AS verbindungen, max(angelegt_am) AS zuletzt_aufgefrischt
    FROM mcp.oauth_token
   WHERE widerrufen_am IS NULL AND laeuft_ab > now()
   GROUP BY subject
), abgelehnt AS (
  SELECT subject,
         count(*)::int                    AS abgelehnt_30_tage,
         max(zeitpunkt)                   AS zuletzt_abgelehnt
    FROM mcp.anmeldung_protokoll
   WHERE grund = 'verbindungslimit' AND zeitpunkt > now() - interval '30 days'
   GROUP BY subject
)
SELECT n.email,
       n.anzeige,
       n.max_verbindungen,
       coalesce(l.verbindungen, 0)       AS verbindungen,
       l.zuletzt_aufgefrischt,
       coalesce(b.abgelehnt_30_tage, 0)  AS abgelehnt_30_tage,
       b.zuletzt_abgelehnt
  FROM mcp.nutzer n
  LEFT JOIN lebend l    ON l.subject = n.subject
  LEFT JOIN abgelehnt b ON b.subject = n.subject
 WHERE n.aktiv
 ORDER BY coalesce(b.abgelehnt_30_tage, 0) DESC, n.email;

COMMENT ON VIEW mcp.verbindung_stand IS
'Verbindungen je MCP-Konto gegen die Grenze aus mcp.nutzer.max_verbindungen, dazu die
Ablehnungen der letzten 30 Tage. abgelehnt_30_tage > 0 heisst: jemand kannte das Passwort
und kam wegen der Grenze nicht hinein — entweder der Nutzer selbst nach einem Neuverbinden
(dann trennen) oder jemand, dem er es gegeben hat. Wer, steht in mcp.anmeldung_protokoll
(herkunft). Nur fuer die Anmeldung lesbar, nicht fuer mcp_leser: die Sicht nennt
Mailadressen.

Koernung: eine Zeile je aktivem Konto.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_anmeldung') THEN
    EXECUTE 'GRANT SELECT ON mcp.verbindung_stand TO mcp_anmeldung';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
    EXECUTE 'REVOKE ALL ON mcp.verbindung_stand FROM mcp_leser';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'Rechte auf mcp.verbindung_stand nicht gesetzt — als Administrator: GRANT SELECT ON mcp.verbindung_stand TO mcp_anmeldung';
END $$;

-- Die Rechtepruefung aus 0105 kennt die neue Sicht.
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
    ('mcp.sicht_katalog',       'nur_leser'),
    ('mcp.zugriff',             'nur_leser')
  ) AS t(tabelle, erwartung)
 WHERE (t.erwartung = 'nur_anmeldung' AND has_table_privilege('mcp_leser', t.tabelle, 'SELECT'))
    OR (t.erwartung = 'nur_leser'     AND has_table_privilege('mcp_anmeldung', t.tabelle, 'SELECT'));
