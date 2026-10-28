-- =====================================================================
-- 0140 — Verdraengen als Schalter je Konto
--
-- 0139 lehnt an der Grenze ab: die neue Anmeldung scheitert, frei gibt nur
-- `bun run nutzer trennen`. Das ist bewusst streng — und fuer manche Konten
-- zu streng, weil ein neu angelegter Connector eine alte Kette hinterlaesst,
-- die der Client nicht widerruft.
--
-- ENTSCHIEDEN (Eugene, 28.10.2026): je Konto waehlbar. `verdraengen = true`
-- heisst: an der Grenze gewinnt die neue Anmeldung, die aelteste Verbindung
-- wird getrennt — sofort, weil das Zugangstoken seine Kette traegt
-- (src/auth.ts). Standard bleibt ABLEHNEN.
--
-- Dazu oauth_token.widerruf_grund — ohne ihn haette der verdraengte Client
-- beim naechsten Auffrischen die neue Verbindung mitgerissen (siehe unten).
--
-- Was Verdraengen bedeutet, wenn jemand den Zugang weitergibt: zwei
-- Personen werfen sich gegenseitig hinaus. Das verhindert die Weitergabe
-- nicht, macht sie aber sichtbar — jede Verdraengung steht im Protokoll
-- (grund = 'verdraengt' an der gelungenen Anmeldung, mit Herkunft), und
-- mcp.verbindung_stand zaehlt sie.
-- =====================================================================

ALTER TABLE mcp.nutzer
  ADD COLUMN verdraengen boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- Warum ein Token widerrufen wurde — gefunden im Test zu dieser Migration.
--
-- Die Diebstahlserkennung aus 0104 widerruft ALLE Ketten eines Kontos, wenn
-- ein schon widerrufener Token noch einmal vorgelegt wird. Ein verdraengter
-- oder getrennter Client tut aber genau das: er weiss nichts vom Trennen und
-- frischt auf. Ohne Grund haette jede Verdraengung beim naechsten Auffrischen
-- des alten Clients auch die NEUE Verbindung gerissen — und seit 0139 jedes
-- `bun run nutzer trennen` alle uebrigen Verbindungen des Kontos.
--
-- Mit Grund: was WIR widerrufen haben (getrennt, verdraengt, konto), wird
-- beim erneuten Vorlegen schlicht abgewiesen. Die Familie faellt weiter nur
-- bei dem, was wirklich auf Diebstahl deutet: ein durch Rotation ersetzter
-- Token taucht wieder auf (widerruf_grund NULL).
-- ---------------------------------------------------------------------
ALTER TABLE mcp.oauth_token
  ADD COLUMN widerruf_grund text
    CHECK (widerruf_grund IS NULL OR widerruf_grund IN ('getrennt', 'verdraengt', 'konto', 'wiederverwendet'));

COMMENT ON COLUMN mcp.oauth_token.widerruf_grund IS
'Warum widerrufen. NULL = durch Rotation ersetzt (ersetzt_durch) oder vor 0140.
getrennt = `bun run nutzer trennen`; verdraengt = eine neue Anmeldung hat diese Verbindung
an der Grenze verdraengt; konto = Passwort neu, stillgelegt oder Konto inaktiv;
wiederverwendet = Diebstahlserkennung. Wird ein Token mit getrennt/verdraengt/konto erneut
vorgelegt, wird er nur abgewiesen; bei NULL faellt die ganze Familie (0104).';

COMMENT ON COLUMN mcp.nutzer.verdraengen IS
'Was an der Verbindungsgrenze (max_verbindungen) geschieht. false (Standard): die neue
Anmeldung wird ABGELEHNT, frei gibt nur `bun run nutzer trennen`. true: die neue Anmeldung
gewinnt, die aelteste Verbindung wird sofort getrennt; die Anmeldung steht dann mit
grund = ''verdraengt'' im Protokoll. Haeufiges Verdraengen von wechselnden Netzen ist das
Muster einer Weitergabe. Ohne Grenze wirkungslos.';

COMMENT ON COLUMN mcp.nutzer.max_verbindungen IS
'Hoechstzahl gleichzeitig aktiver Verbindungen (Tokenketten) dieses Kontos. NULL = keine
Grenze. Was an der Grenze geschieht, sagt verdraengen: false (Standard) = neue Anmeldung
ABGELEHNT, protokolliert als grund = ''verbindungslimit''; true = aelteste Verbindung
getrennt, protokolliert als grund = ''verdraengt''. Es zaehlt jede lebende Kette. Setzen
mit `bun run nutzer limit <email> <n|aus> [--verdraengen|--ablehnen]`.';

-- Angehaengt, nicht eingefuegt: CREATE OR REPLACE VIEW kann nur anhaengen.
CREATE OR REPLACE VIEW mcp.verbindung_stand AS
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
), verdraengt AS (
  SELECT subject,
         count(*)::int                    AS verdraengt_30_tage,
         count(DISTINCT herkunft)::int    AS verdraengt_netze_30_tage
    FROM mcp.anmeldung_protokoll
   WHERE grund = 'verdraengt' AND zeitpunkt > now() - interval '30 days'
   GROUP BY subject
)
SELECT n.email,
       n.anzeige,
       n.max_verbindungen,
       coalesce(l.verbindungen, 0)       AS verbindungen,
       l.zuletzt_aufgefrischt,
       coalesce(b.abgelehnt_30_tage, 0)  AS abgelehnt_30_tage,
       b.zuletzt_abgelehnt,
       n.verdraengen,
       coalesce(v.verdraengt_30_tage, 0) AS verdraengt_30_tage,
       coalesce(v.verdraengt_netze_30_tage, 0) AS verdraengt_netze_30_tage
  FROM mcp.nutzer n
  LEFT JOIN lebend l     ON l.subject = n.subject
  LEFT JOIN abgelehnt b  ON b.subject = n.subject
  LEFT JOIN verdraengt v ON v.subject = n.subject
 WHERE n.aktiv
 ORDER BY coalesce(b.abgelehnt_30_tage, 0) + coalesce(v.verdraengt_30_tage, 0) DESC, n.email;

COMMENT ON VIEW mcp.verbindung_stand IS
'Verbindungen je MCP-Konto gegen die Grenze aus mcp.nutzer.max_verbindungen, dazu was an
der Grenze in den letzten 30 Tagen geschah. abgelehnt_30_tage (Konten mit verdraengen =
false): jemand kannte das Passwort und kam nicht hinein — der Nutzer selbst nach einem
Neuverbinden (dann trennen) oder jemand, dem er es gegeben hat. verdraengt_30_tage (Konten
mit verdraengen = true): so oft hat eine neue Anmeldung eine alte Verbindung getrennt; viele
davon aus mehreren Netzen (verdraengt_netze_30_tage) sind das Muster einer Weitergabe.
Mobilfunk wechselt die Adresse — ein einzelner Wert beweist nichts. Einzelheiten in
mcp.anmeldung_protokoll. Nur fuer die Anmeldung lesbar, nicht fuer mcp_leser: die Sicht
nennt Mailadressen.

Koernung: eine Zeile je aktivem Konto.';
