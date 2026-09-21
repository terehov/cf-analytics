-- =====================================================================
-- 0110 — Derselbe Fehler wie in 0109, eine Schicht tiefer: nicht die
--        Funktion IN mart war das Problem, sondern die aus `core`, die
--        eine mart-Sicht ruft. Elf Sichten waren unlesbar, darunter jede
--        Wettersicht und der Vergleichstag.
--
-- BEFUND VOM 21.09.2026 aus einer Analysesitzung. Jede Abfrage auf
-- mart.wetter_tag, mart.betrieb_wetter_tag, mart.vergleichstag oder
-- mart.wetter_effekt_gruppe kam in Claude als
--
--   "current transaction is aborted, commands ignored until end of
--    transaction block"
--
-- zurueck — also als Folgemeldung, nie als Ursache. Der echte Fehler,
-- nachgemessen als `mcp_leser` in psql (SET ROLE mcp_leser):
--
--   SELECT geschaeftstag, count(*) FROM mart.wetter_tag
--    WHERE geschaeftstag = DATE '2026-08-15' GROUP BY 1;
--   ERROR:  permission denied for schema core
--   LINE 2: SELECT ((p_zeitpunkt AT TIME ZONE core.geschaefts_zeitzo...
--   CONTEXT: SQL function "geschaeftstag" during inlining
--
-- DIE REGEL IST DIESELBE WIE IN 0109 und steht dort ausfuehrlich: eine
-- SICHT liest mit den Rechten ihres EIGENTUEMERS, ein FUNKTIONSRUMPF mit
-- denen des AUFRUFERS. 0109 hat daraus eine Pruefsicht gemacht —
-- mart.leserolle_pruefung — und die meldete am 21.09. nichts, obwohl elf
-- Sichten lagen. Warum: sie sucht nur unter den Funktionen IN `ampel` und
-- `mart`. core.geschaeftstag() steht in `core`, also im gesperrten Schema
-- selbst, und fiel damit durch das Raster. Der Rumpf greift auf
-- core.geschaefts_zeitzone() zu, und schon der NAME braucht USAGE auf
-- `core`, das 0105 der Leserolle ausdruecklich entzieht.
--
-- VOLLSTAENDIGE MESSUNG, als mcp_leser gegen einen Klon auf dem Stand
-- 0109, SELECT * ... LIMIT 1 gegen jede der 200 Sichten in
-- mart/manual/ampel (count(*) taugt dafuer nicht, siehe 0109):
--
--   core.geschaeftstag() — permission denied for schema core       8 Sichten
--     mart.wetter_tag, mart.betrieb_wetter_tag, mart.vergleichstag,
--     mart.wetter_effekt, mart.wetter_effekt_gruppe, mart.wettertag_lage,
--     mart.pruefung_kalender, mart.pruefung_uebersicht
--   sync.sperre_aktiv() — permission denied for schema sync         1 Sicht
--     mart.import_gesamt
--   kein SELECT-Recht                                              2 Sichten
--     ampel.schwelle_je_betrieb, mart.leserolle_pruefung — beide von 0105
--     bzw. 0109 angelegt, beide ohne Recht fuer die Leserolle
--
-- Zwei davon wiegen schwer ueber ihre eigene Zeile hinaus:
-- mart.pruefung_uebersicht ist die Pruefliste selbst, und
-- mart.leserolle_pruefung ist die Wache aus 0109. Die Wache stand hinter
-- einer Tuer, die sie selbst haette aufmachen sollen.
--
-- WAS DIESE MIGRATION TUT
--
--   1. core.geschaeftstag() wird SECURITY DEFINER. Damit laeuft der Rumpf
--      mit den Rechten des Eigentuemers und `core` ist ihm zugaenglich.
--   2. mart.import_gesamt liest die Zugangssperre selbst, statt
--      sync.sperre_aktiv() zu rufen — Rezept 1 aus 0109.
--   3. mart.leserolle_pruefung sucht ab jetzt in JEDEM Schema und ueber
--      pg_depend: welche Funktion haengt an einer lesbaren Sicht.
--   4. Eine zweite Luecke bekommt ihre eigene Wache: mart-Sichten, auf
--      die mcp_leser gar kein SELECT hat (mart.sicht_ohne_leserecht).
--   5. Und weil beide Wachen nur das Offensichtliche finden: der
--      MCP-Server probiert jede Sicht periodisch WIRKLICH aus und legt
--      das Ergebnis in mcp.sicht_gesundheit ab. Was dort nicht laeuft,
--      steht in mart.sicht_defekt und wird dem Modell in
--      abfrage_pruefen und sichten_suchen als Befund mitgegeben; was
--      ohne Urteil blieb (Zeitueberlauf), in mart.sicht_unklar als Warnung.
--
-- WARUM SECURITY DEFINER UND NICHT USAGE AUF `core`. USAGE waere eine
-- Zeile und oeffnete der Leserolle jede Funktion in `core`. Die Regel aus
-- 0105 — in den gesperrten Schemata wird nichts pauschal vergeben — gilt
-- weiter.
--
-- WARUM SECURITY DEFINER UND NICHT DIE ZEITZONE ALS LITERAL IM RUMPF. Der
-- Literalweg haelt das Inlining, verteilt 'Europe/Berlin' aber auf eine
-- vierte Stelle; core.geschaefts_zeitzone() gibt es genau deshalb.
--
-- WAS SECURITY DEFINER KOSTET, nachgemessen am 21.09.2026 gegen einen
-- Klon mit 657.334 Stundenwerten:
--
--   SELECT geschaeftstag, count(*) FROM mart.wetter_tag
--    WHERE geschaeftstag = DATE '2026-08-15' GROUP BY 1;
--   SECURITY INVOKER (Ausdruck wird eingesetzt)    170–203 ms
--   SECURITY DEFINER (Funktionsaufruf je Zeile)    180–199 ms
--
-- Also nichts. Eine SECURITY-DEFINER-Funktion wird nicht mehr in die
-- Abfrage eingesetzt — im Plan steht danach core.geschaeftstag(zeitpunkt)
-- statt des Ausdrucks —, aber die Kosten dieser Abfrage liegen im Seq
-- Scan und im Hash Aggregate ueber 657.334 Zeilen, nicht im Aufruf. Zum
-- Vergleich, was Inlining ueberhaupt wert ist: 4,5 Mio. Aufrufe ohne
-- jede Arbeit daneben (generate_series) brauchen 1,26 s eingesetzt und
-- 3,23 s als Aufruf. Ein Index haengt an keiner Stelle daran: geprueft,
-- es gibt keinen Ausdrucksindex auf geschaeftstag(), und die vier
-- Wettersichten lesen manual.wetter_stunde ohnehin vollstaendig.
--
-- DER GRUND, WARUM DER NUTZER NIE DIE URSACHE SAH, liegt nicht in der
-- Datenbank, sondern in mcp/src/ausfuehren.ts: `zeilenSchaetzen` setzt ein
-- EXPLAIN vor jede Abfrage und verschluckt dessen Fehler. Das EXPLAIN
-- bricht die Transaktion ab, die eigentliche Abfrage laeuft dann in die
-- abgebrochene Transaktion, und 25P02 ist alles, was zurueckkommt — bei
-- einer defekten Sicht genauso wie bei einem Tippfehler in einem
-- Spaltennamen. Behoben im selben Zug (SAVEPOINT um das EXPLAIN,
-- SQLSTATE und Meldung in der Antwort); Hergang in docs/fehlerkatalog.md.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. core.geschaeftstag() — acht Sichten haengen an dieser einen Zeile
--
-- Der Rumpf bleibt unveraendert; nur wessen Rechte er benutzt, aendert
-- sich. Fluechtigkeit (STABLE) und PARALLEL SAFE bleiben ebenfalls, damit
-- die Funktion dort weiter einsetzbar ist, wo sie heute steht.
-- ---------------------------------------------------------------------

ALTER FUNCTION core.geschaeftstag(timestamptz)
  SECURITY DEFINER SET search_path = pg_catalog, public;

COMMENT ON FUNCTION core.geschaeftstag(timestamptz) IS
'Der Geschaeftstag eines Zeitpunkts: Berliner Ortszeit minus acht Stunden. Ein Verkauf um
03:00 gehoert zum Vortag.

SEIT 0110 SECURITY DEFINER mit festem search_path. Der Rumpf ruft core.geschaefts_zeitzone(),
und schon dieser NAME braucht USAGE auf dem Schema core — das 0105 der Leserolle entzieht.
Ein Funktionsrumpf erbt die Rechte des AUFRUFERS, auch wenn er aus einer Sicht heraus
gerufen wird: damit waren mart.wetter_tag, mart.betrieb_wetter_tag, mart.vergleichstag,
mart.wetter_effekt, mart.wetter_effekt_gruppe, mart.wettertag_lage, mart.pruefung_kalender
und mart.pruefung_uebersicht fuer mcp_leser unlesbar, waehrend Metabase sie anstandslos
zeigte (Befund 21.09.2026).

KOSTET NICHTS MESSBARES, aber sie wird nicht mehr in die Abfrage eingesetzt: im Plan steht
jetzt der Aufruf statt des Ausdrucks. Nachgemessen 21.09.2026 an mart.wetter_tag ueber
657.334 Stundenwerte — 180–199 ms statt 170–203 ms. Wer hier eine Bedingung der Form
geschaeftstag(spalte) = ... auf eine grosse Tabelle setzt, sollte vorher in den Plan sehen.';


-- ---------------------------------------------------------------------
-- 2. mart.import_gesamt liest die Sperre selbst
--
-- Rezept 1 aus 0109 (die Aufloesung in die SICHT ziehen) statt Rezept 2
-- (SECURITY DEFINER): sync.sperre_aktiv() gibt eine GANZE Zeile aus
-- sync.zugangssperre zurueck — mit Endpunkt, HTTP-Status und lauf_id —,
-- und die Sicht braucht davon drei Spalten. Eine SECURITY-DEFINER-Huelle
-- haette der Leserolle den Rest mitgereicht.
--
-- Die Funktion selbst bleibt unangetastet: der Importer ruft sie, und
-- dort ist sie am richtigen Platz.
--
-- Nur der Zweig `sperre` ist neu, der Rest ist die Fassung aus 0039.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.import_gesamt AS
WITH w AS (
    SELECT count(*) AS posten,
           count(*) FILTER (WHERE erledigt_am IS NOT NULL) AS erledigt,
           count(*) FILTER (WHERE erledigt_am IS NULL) AS offen,
           count(*) FILTER (WHERE ergebnis = 'aufgegeben') AS aufgegeben,
           count(*) FILTER (WHERE erledigt_am IS NULL AND prioritaet <= 10) AS offen_laufend,
           count(*) FILTER (WHERE erledigt_am IS NULL AND prioritaet >= 90) AS offen_historie,
           min(zeitraum_von) FILTER (WHERE ergebnis = 'ok') AS reicht_zurueck_bis,
           least(max(zeitraum_bis) FILTER (WHERE ergebnis = 'ok'), current_date) AS geladen_bis
      FROM sync.warteschlange
), takt AS (
    SELECT count(*) AS pro_stunde
      FROM sync.aufgabe
     WHERE beendet_am > now() - interval '1 hour'
       AND status IN ('ok', 'keine_daten')
), sperre AS (
    -- Wortgleich mit sync.sperre_aktiv(), aber IN der Sicht: damit greift
    -- der Zugriff auf `sync` mit den Rechten des Eigentuemers. Ueber die
    -- Funktion war diese Sicht fuer mcp_leser unlesbar (0110).
    SELECT art, pausiert_bis, hinweis
      FROM sync.zugangssperre
     WHERE aufgehoben_am IS NULL
       AND pausiert_bis > now()
     ORDER BY pausiert_bis DESC
     LIMIT 1
)
SELECT w.posten AS posten_gesamt,
       w.erledigt,
       w.offen,
       w.offen_laufend,
       w.offen_historie,
       w.aufgegeben,
       round(100.0 * w.erledigt::numeric / nullif(w.posten, 0)::numeric, 1) AS prozent,
       w.reicht_zurueck_bis,
       w.geladen_bis,
       t.pro_stunde AS tempo_pro_stunde,
       CASE WHEN t.pro_stunde > 0 THEN round(w.offen::numeric / t.pro_stunde::numeric, 1) END AS reststunden,
       CASE WHEN t.pro_stunde > 0
            THEN now() + (w.offen::numeric / t.pro_stunde::numeric)::double precision * interval '1 hour'
       END AS fertig_etwa,
       s.art AS sperre_art,
       s.pausiert_bis AS sperre_bis,
       s.hinweis AS sperre_hinweis
  FROM w
 CROSS JOIN takt t
  LEFT JOIN sperre s ON true;


-- ---------------------------------------------------------------------
-- 3. Die Wache aus 0109 sieht jetzt auch in die gesperrten Schemata
--
-- Vorher: jede Funktion IN `ampel` oder `mart`, deren Rumpf ein
-- gesperrtes Schema nennt. Das findet den Fall aus 0109 und nicht den aus
-- 0110 — core.geschaeftstag() steht im gesperrten Schema selbst.
--
-- Jetzt zwei Wege zusammen:
--
--   a) wie bisher jede Funktion in `ampel`/`mart` — auch eine, die noch
--      keine Sicht ruft. Die Falle soll auffallen, bevor sie zuschnappt.
--   b) JEDE Funktion, an der eine Sicht in mart/manual/ampel haengt,
--      gleich in welchem Schema sie steht. Ueber pg_depend, nicht ueber
--      eine Textsuche im Sichtkoerper: der Umschreibregel der Sicht ist
--      ein Alias gleichgueltig.
--
-- Die Spalte `sichten` sagt, was jeweils daran haengt — die Liste, mit
-- der man nach einem Befund sofort nachmessen kann. Sie steht am ENDE,
-- weil CREATE OR REPLACE VIEW die vorhandenen Spalten in ihrer
-- Reihenfolge behalten muss (mart.pruefung_uebersicht haengt an dieser
-- Sicht, ein DROP waere ein CASCADE auf die Pruefliste).
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.leserolle_pruefung AS
WITH funktion AS (
    -- Nur SQL und PL/pgSQL: nur dort ist prosrc ueberhaupt Quelltext. Bei
    -- einer C-Funktion steht dort der Symbolname, und eine Textsuche
    -- darin ergibt nichts als Fehlalarme.
    SELECT p.oid,
           n.nspname || '.' || p.proname AS funktion,
           n.nspname AS schema,
           p.prosrc,
           p.prosecdef
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l  ON l.oid = p.prolang
     WHERE l.lanname IN ('sql', 'plpgsql')
), nutzung AS (
    -- Welche Funktion haengt an welcher lesbaren Sicht. pg_rewrite ist die
    -- Umschreibregel der Sicht, pg_depend ihre Abhaengigkeiten.
    SELECT DISTINCT d.refobjid AS funktion_oid,
           dn.nspname || '.' || dc.relname AS sicht
      FROM pg_depend d
      JOIN pg_rewrite r    ON r.oid = d.objid
      JOIN pg_class dc     ON dc.oid = r.ev_class
      JOIN pg_namespace dn ON dn.oid = dc.relnamespace
     WHERE d.classid    = 'pg_rewrite'::regclass
       AND d.refclassid = 'pg_proc'::regclass
       AND dn.nspname IN ('mart', 'manual', 'ampel')
)
SELECT f.funktion,
       (SELECT string_agg(DISTINCT m[1], ', ' ORDER BY m[1])
          FROM regexp_matches(f.prosrc, '\y(core|raw|part|sync)\.', 'g') m) AS greift_auf,
       'Rumpf greift in ein gesperrtes Schema und ist nicht SECURITY DEFINER — '
       'jede Sicht, die diese Funktion ruft, ist fuer mcp_leser unlesbar' AS befund,
       (SELECT string_agg(DISTINCT u.sicht, ', ' ORDER BY u.sicht)
          FROM nutzung u WHERE u.funktion_oid = f.oid) AS sichten
  FROM funktion f
 WHERE NOT f.prosecdef
   AND f.prosrc ~ '\y(core|raw|part|sync)\.'
   AND (f.schema IN ('ampel', 'mart')
        OR EXISTS (SELECT 1 FROM nutzung u WHERE u.funktion_oid = f.oid))
 ORDER BY 1;

COMMENT ON VIEW mart.leserolle_pruefung IS
'Funktionen, deren Rumpf in ein fuer mcp_leser gesperrtes Schema greift, und die Sichten,
die daran haengen. ERWARTUNG: LEER.

Eine Sicht greift auf ihre Tabellen mit den Rechten ihres EIGENTUEMERS zu, ein
Funktionsrumpf mit denen des AUFRUFERS — auch aus einer Sicht heraus. Wer den Zugriff auf
core/raw/part/sync in eine Funktion verlegt, hebt damit den Schutz der Sicht auf, und zwar
lautlos: als Eigentuemer getestet laeuft alles.

Zwei Wege heraus, beide vorgefuehrt: die Aufloesung in die SICHT ziehen
(ampel.konzept_je_betrieb in 0109, der Zweig `sperre` in mart.import_gesamt in 0110), oder —
wenn das an dynamischem SQL oder an einer vielfach benutzten Funktion scheitert — SECURITY
DEFINER mit festem search_path (mart.quelle_messen in 0109, core.geschaeftstag in 0110).

SEIT 0110 IN JEDEM SCHEMA. Bis dahin sah sie nur unter den Funktionen in ampel und mart
nach und meldete am 21.09.2026 nichts, obwohl elf Sichten lagen: core.geschaeftstag() steht
im gesperrten Schema selbst. Gefunden wird jetzt (a) jede Funktion in ampel/mart und (b)
jede Funktion beliebigen Schemas, an der eine Sicht in mart/manual/ampel haengt — letzteres
ueber pg_depend, dem ein Alias gleichgueltig ist.

ACHTUNG, die Pruefung ist eine Textsuche im Rumpf. Sie findet keinen Zugriff ueber
dynamisches SQL, keinen ueber eine zweite Funktion dazwischen und keinen ueber einen Alias.
Eine leere Liste heisst "nichts Offensichtliches", nicht "bewiesen sauber" — bewiesen wird
es erst dadurch, dass jede Sicht wirklich gelesen wird (mart.sicht_defekt).

Koernung: eine Zeile je Funktion, die in ein gesperrtes Schema greift.';


-- ---------------------------------------------------------------------
-- 4. Die zweite Luecke: eine Sicht, auf die die Leserolle kein Recht hat
--
-- 0105 vergibt SELECT auf alles in mart/manual/ampel und setzt dazu die
-- Standardrechte, damit eine NEUE Sicht das Recht mitbringt. Beides haengt
-- an der Rolle, die die Migration ausfuehrt: die Standardvergabe gilt FOR
-- ROLE <current_user>. Wer eine Migration einmal mit einem anderen Zugang
-- einspielt, legt Sichten an, die niemand lesen darf — gemessen am
-- 21.09.2026 an ampel.schwelle_je_betrieb und mart.leserolle_pruefung.
--
-- has_table_privilege mit der Rollen-OID aus einer Unterabfrage, nicht mit
-- dem Namen: auf einer Datenbank ohne mcp_leser (frische Entwicklung) ist
-- das NULL und die Sicht leer, statt dass die Abfrage mit
-- "role does not exist" abbricht.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.sicht_ohne_leserecht AS
SELECT n.nspname || '.' || c.relname          AS sicht,
       pg_get_userbyid(c.relowner)            AS eigentuemer,
       'mcp_leser hat kein SELECT — die Sicht ist fuer ChatGPT und Claude unsichtbar, '
       'obwohl sie in der Auswertungsschicht steht' AS befund
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('mart', 'manual', 'ampel')
   AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
   AND NOT has_table_privilege((SELECT oid FROM pg_roles WHERE rolname = 'mcp_leser'),
                               c.oid, 'SELECT')
 ORDER BY 1;

COMMENT ON VIEW mart.sicht_ohne_leserecht IS
'Tabellen und Sichten in mart/manual/ampel, auf die mcp_leser kein SELECT hat.
ERWARTUNG: LEER.

Der Rechteentzug ist hier kein Schutz, sondern ein Versehen: die Auswertungsschicht ist
genau das, was diese Rolle sehen soll. Entsteht, wenn eine Migration mit einem anderen
Zugang eingespielt wird als dem, fuer den 0105 die Standardrechte gesetzt hat — die
Standardvergabe gilt FOR ROLE <current_user>. Behebung: SELECT mcp.rechte_auffrischen();

Leer auch auf einer Datenbank ohne die Rolle mcp_leser, absichtlich: has_table_privilege
bekommt die Rollen-OID aus einer Unterabfrage und liefert dann NULL.

Koernung: eine Zeile je Tabelle oder Sicht ohne Leserecht.';


-- ---------------------------------------------------------------------
-- 5. Und weil beide Wachen nur das Offensichtliche finden:
--    jede Sicht wird wirklich ausprobiert
--
-- Beide Sichten oben lesen den KATALOG. Sie finden, was man aus
-- pg_proc und pg_class ablesen kann — und das ist nicht alles: eine Sicht
-- kann auch an einer fehlenden Spalte, einer geloeschten Basistabelle oder
-- einem Ausdruck scheitern, der erst zur Laufzeit faellt. Am 21.09.2026
-- hat abfrage_pruefen genau darum "Laeuft, mit 1 Hinweis(en)" fuer SQL
-- gemeldet, das auf zwei defekten Sichten stand: die Pruefung ist rein
-- katalogbasiert.
--
-- Der Beweis ist der Versuch. Und der muss als mcp_leser laufen, sonst
-- beweist er nichts (0109: als Eigentuemer getestet laeuft alles) — also
-- im MCP-Server, der genau diese Rolle traegt, und nicht in einer
-- Sicht hier. Diese Tabelle ist die Ablage dafuer.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mcp.sicht_gesundheit (
  sicht       text        PRIMARY KEY,
  geprueft_am timestamptz NOT NULL DEFAULT now(),
  laeuft      boolean     NOT NULL,
  sqlstate    text,
  meldung     text,
  dauer_ms    integer
);

COMMENT ON TABLE mcp.sicht_gesundheit IS
'Was beim letzten Gesundheitslauf des MCP-Servers wirklich gelesen werden konnte — eine
Zeile je Sicht in mart/manual/ampel, geschrieben von mcp.gesundheit_melden().

WARUM NICHT ALS SICHT, sondern als Momentaufnahme: die Probe ist ein SELECT * ... LIMIT 1
gegen jede Sicht, und sie muss als mcp_leser laufen. Als Eigentuemer laeuft alles (0109),
und eine Sicht kann sich nicht selbst ausprobieren. Der MCP-Server hat die richtige Rolle,
also probiert er.

sqlstate und meldung tragen den ECHTEN Postgres-Fehler, nicht die Folgemeldung. Genau daran
ist die Sitzung vom 21.09.2026 gescheitert: zurueck kam nur 25P02.';

COMMENT ON COLUMN mcp.sicht_gesundheit.geprueft_am IS
'Wann diese Zeile entstanden ist. Alle Zeilen eines Laufs tragen denselben Zeitstempel —
ein alter Zeitstempel heisst, dass der Gesundheitslauf nicht mehr laeuft, und das ist ein
Befund fuer sich (mart.pruefung_uebersicht).';


-- Den Satz melden — ganz oder nicht.
--
-- SECURITY DEFINER, weil die Leserolle in `mcp` nur mcp.zugriff beschreiben
-- darf und das so bleiben soll (0105: in `mcp` wird nichts pauschal
-- vergeben). Die Funktion nimmt nichts entgegen als eine Liste von
-- Sichtnamen mit Befund, schreibt in genau eine Tabelle und gibt eine Zahl
-- zurueck. Fester search_path, wie es sich fuer SECURITY DEFINER gehoert.
--
-- GANZER SATZ ODER KEINER: wer nur die defekten Sichten meldete, liesse eine
-- reparierte Sicht auf ewig als defekt stehen. Deshalb DELETE und neu, in
-- einer Transaktion.
--
-- ACHTUNG, DIE TRANSAKTION MUSS SCHREIBEN DUERFEN. mcp_leser traegt
-- default_transaction_read_only = on, und SECURITY DEFINER hilft dagegen
-- nicht: read-only ist eine Eigenschaft der Transaktion, kein Recht. Der
-- Aufrufer stellt sie um (SET TRANSACTION READ WRITE), genau wie beim
-- Protokoll in mcp.zugriff.
CREATE OR REPLACE FUNCTION mcp.gesundheit_melden(p_befunde jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    v_zahl integer;
BEGIN
    IF p_befunde IS NULL OR jsonb_typeof(p_befunde) <> 'array' THEN
        RAISE EXCEPTION 'mcp.gesundheit_melden erwartet ein JSON-Array, bekam %',
            coalesce(jsonb_typeof(p_befunde), 'NULL');
    END IF;

    DELETE FROM mcp.sicht_gesundheit;

    INSERT INTO mcp.sicht_gesundheit (sicht, geprueft_am, laeuft, sqlstate, meldung, dauer_ms)
    SELECT e.sicht, now(), e.laeuft,
           left(e.sqlstate, 10), left(e.meldung, 500), e.dauer_ms
      FROM jsonb_to_recordset(p_befunde)
        AS e(sicht text, laeuft boolean, sqlstate text, meldung text, dauer_ms integer)
     WHERE e.sicht IS NOT NULL AND e.laeuft IS NOT NULL;
    -- Kein ON CONFLICT: die Tabelle ist gerade geleert, und ein doppelter
    -- Sichtname im Array waere ein Fehler des Aufrufers, der als Verstoss
    -- gegen den Primaerschluessel auch so heissen soll. (Ein ON CONFLICT
    -- hilft hier ohnehin nicht — bei einer Dublette innerhalb EINES INSERT
    -- bricht Postgres mit "cannot affect row a second time" ab.)

    GET DIAGNOSTICS v_zahl = ROW_COUNT;
    RETURN v_zahl;
END $$;

COMMENT ON FUNCTION mcp.gesundheit_melden(jsonb) IS
'Nimmt die Momentaufnahme eines Gesundheitslaufs auf: ein JSON-Array mit sicht, laeuft,
sqlstate, meldung, dauer_ms. Ersetzt den ganzen Satz, damit eine reparierte Sicht nicht als
defekt stehen bleibt. Gibt die Zahl der aufgenommenen Zeilen zurueck.

SECURITY DEFINER, damit die Leserolle in `mcp` weiter nur mcp.zugriff beschreiben darf.
Die Transaktion des Aufrufers muss trotzdem READ WRITE sein — read-only ist keine Frage
der Rechte.';

REVOKE ALL ON FUNCTION mcp.gesundheit_melden(jsonb) FROM PUBLIC;


-- Was nicht laeuft, in der Auswertungsschicht — damit es im Dashboard und
-- in der Pruefliste ankommt und nicht nur im Server.
CREATE OR REPLACE VIEW mart.sicht_defekt AS
SELECT g.sicht,
       g.sqlstate,
       g.meldung,
       g.geprueft_am
  FROM mcp.sicht_gesundheit g
 WHERE NOT g.laeuft
 ORDER BY g.sicht;

COMMENT ON VIEW mart.sicht_defekt IS
'Die Sichten, die beim letzten Gesundheitslauf des MCP-Servers NICHT gelesen werden konnten
— mit dem echten Postgres-Fehler daneben (SQLSTATE und Meldung). ERWARTUNG: LEER.

Anders als mart.leserolle_pruefung und mart.sicht_ohne_leserecht liest diese Sicht keinen
Katalog: sie zeigt, was ein SELECT * ... LIMIT 1 als mcp_leser wirklich ergeben hat. Damit
faellt auch eine Sicht auf, die an einer fehlenden Spalte oder einem Ausdruck scheitert und
in keinem Rechteraster auftaucht.

Der MCP-Server gibt diese Liste dem Modell mit: abfrage_pruefen und sichten_suchen melden
eine beruehrte defekte Sicht als Befund `sicht_defekt`, statt "Laeuft" zu sagen. Am
21.09.2026 hat abfrage_pruefen genau das noch mit "Laeuft, mit 1 Hinweis(en)" quittiert.

LEER HEISST NICHT ZWANGSLAEUFIG GESUND: leer ist sie auch, wenn der Gesundheitslauf gar
nicht mehr laeuft. Ob er laeuft, sagt geprueft_am — und die Pruefliste sieht darauf.

Koernung: eine Zeile je Sicht, die nicht gelesen werden konnte.';


-- Und die Proben OHNE Urteil: die Sicht ist nicht nachweislich kaputt, aber
-- auch nicht nachweislich lesbar. Zwei Faelle, beide keine Defekte:
--
--   57014  Zeitueberlauf — in 5 s kam keine einzige Zeile. Fuer eine Sicht,
--          die mit 20 s Grenze abgefragt wird, ist das eine Warnung wert:
--          wer sie ohne engen Zeitraum fragt, laeuft in dieselbe Grenze.
--   ohne   SQLSTATE — ein Fehler, der nicht von Postgres kam (Verbindung,
--          Client). Sagt nichts ueber die Sicht, darf aber nicht als
--          "laeuft" durchgehen, ohne dass es jemand sieht.
--
-- Erkennbar an meldung IS NOT NULL bei laeuft = true: eine gesunde Probe
-- traegt keine Meldung.
CREATE OR REPLACE VIEW mart.sicht_unklar AS
SELECT g.sicht,
       g.sqlstate,
       g.meldung,
       g.dauer_ms,
       g.geprueft_am
  FROM mcp.sicht_gesundheit g
 WHERE g.laeuft
   AND g.meldung IS NOT NULL
 ORDER BY g.sicht;

COMMENT ON VIEW mart.sicht_unklar IS
'Die Sichten, bei denen der Gesundheitslauf KEIN Urteil hatte: nicht nachweislich kaputt
(sonst stuenden sie in mart.sicht_defekt), aber auch nicht nachweislich lesbar. ERWARTUNG:
LEER.

Meist sqlstate 57014 — in fuenf Sekunden kam als mcp_leser keine einzige Zeile. Das ist kein
Defekt, aber eine Sicht, die mit der 20-Sekunden-Grenze abgefragt wird und in der Probe schon
an fuenf scheitert, laeuft ohne engen Zeitraum in dieselbe Grenze; der MCP-Server gibt das
dem Modell als Warnung mit. Ohne sqlstate: der Fehler kam nicht von Postgres (Verbindung,
Client) und sagt nichts ueber die Sicht — steht hier, damit er nicht still als "laeuft" zaehlt.

Koernung: eine Zeile je Sicht, deren Probe ohne Urteil blieb.';


-- ---------------------------------------------------------------------
-- 6. Die Rechte nachziehen — und die neue Tabelle namentlich eintragen
--
-- In `mcp` wird nichts pauschal vergeben (0105). Die Katalogtabellen
-- stehen dort namentlich, und mcp.sicht_gesundheit gehoert jetzt dazu:
-- lesen darf die Leserolle, schreiben nur ueber mcp.gesundheit_melden().
-- ---------------------------------------------------------------------

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
             mcp.sicht_katalog, mcp.koernung_fehlend, mcp.einrichtung_offen, mcp.zugriff,
             mcp.sicht_gesundheit
           TO mcp_leser';
  EXECUTE 'GRANT INSERT ON mcp.zugriff TO mcp_leser';
  EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE mcp.zugriff_zugriff_id_seq TO mcp_leser';
  -- Schreiben auf mcp.sicht_gesundheit NUR ueber diese Funktion (0110).
  EXECUTE 'GRANT EXECUTE ON FUNCTION mcp.gesundheit_melden(jsonb) TO mcp_leser';

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
Idempotent. Wer eine Katalogtabelle ergaenzt, traegt sie hier ein.

AM ENDE JEDER MIGRATION AUFRUFEN, DIE EINE SICHT IN mart/manual/ampel ANLEGT. Die
Standardvergabe darueber gilt FOR ROLE <current_user> und traegt nicht, wenn eine Migration
mit einem anderen Zugang eingespielt wird — am 21.09.2026 waren ampel.schwelle_je_betrieb
und mart.leserolle_pruefung genau deshalb fuer die Leserolle unsichtbar. Die Gegenprobe ist
mart.sicht_ohne_leserecht.';

SELECT mcp.rechte_auffrischen();


-- ---------------------------------------------------------------------
-- 7. Drei Pruefzeilen. Angehaengt, nicht abgeschrieben — dasselbe
--    Verfahren wie in 0109: die Sicht ist eine UNION-Kette, und eine
--    Kopie davon in dieser Datei waere beim naechsten Zweig eine zweite
--    Wahrheit.
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;

    -- Idempotent: ein zweiter Lauf haengt die Zweige nicht noch einmal an.
    IF v_def LIKE '%sicht_ohne_leserecht%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        SELECT 'Leserolle: Sicht ohne SELECT-Recht'::text AS pruefung,
               (SELECT count(*) FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname IN ('mart','manual','ampel')
                   AND c.relkind IN ('r','v','m','p','f'))::bigint AS geprueft,
               (SELECT count(*) FROM mart.sicht_ohne_leserecht)::bigint AS auffaellig,
               'mart.sicht_ohne_leserecht'::text AS sicht
        UNION ALL
        SELECT 'Leserolle: Sicht laesst sich nicht lesen (wirklich probiert)'::text,
               (SELECT count(*) FROM mcp.sicht_gesundheit)::bigint,
               (SELECT count(*) FROM mart.sicht_defekt)::bigint,
               'mart.sicht_defekt'::text
        UNION ALL
        -- ERWARTUNG: 0. Eine Probe ohne Urteil ist meist ein Zeitueberlauf —
        -- die Sicht liefert als mcp_leser in 5 s keine Zeile und laeuft
        -- damit im Alltag in die 20-s-Grenze.
        SELECT 'Leserolle: Probe ohne Urteil (Zeitueberlauf oder Verbindung)'::text,
               (SELECT count(*) FROM mcp.sicht_gesundheit)::bigint,
               (SELECT count(*) FROM mart.sicht_unklar)::bigint,
               'mart.sicht_unklar'::text
        UNION ALL
        -- ERWARTUNG: 0. Eine leere oder alte Momentaufnahme heisst, dass der
        -- Gesundheitslauf nicht mehr laeuft — und dann sieht eine defekte
        -- Sicht aus wie eine gesunde. Genau die Signatur aus harter Regel 10.
        SELECT 'Leserolle: Gesundheitslauf aelter als 24 Stunden'::text,
               1::bigint,
               (CASE WHEN coalesce((SELECT max(geprueft_am) FROM mcp.sicht_gesundheit),
                                   '-infinity'::timestamptz) < now() - interval '24 hours'
                     THEN 1 ELSE 0 END)::bigint,
               'mcp.sicht_gesundheit'::text
        $zweig$);
END $aussen$;


-- ---------------------------------------------------------------------
-- 8. Der Katalog nimmt die neuen Sichten auf
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht SET
    koernung = 'eine Sicht, die sich nicht lesen laesst — ERWARTUNG: keine Zeile',
    thema    = 'import'
 WHERE sicht = 'mart.sicht_defekt';

UPDATE mcp.sicht SET
    koernung = 'eine Tabelle oder Sicht ohne Leserecht — ERWARTUNG: keine Zeile',
    thema    = 'import'
 WHERE sicht = 'mart.sicht_ohne_leserecht';

UPDATE mcp.sicht SET
    koernung = 'eine Sicht, deren Probe ohne Urteil blieb — ERWARTUNG: keine Zeile',
    thema    = 'import'
 WHERE sicht = 'mart.sicht_unklar';

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();


-- ---------------------------------------------------------------------
-- 9. Die Gegenprobe im selben Zug. Bricht ab, wenn eine der elf Sichten
--    noch liegt — eine Migration, die ihre Wirkung nicht nachweist, ist
--    ein guter Vorsatz.
--
--    SET ROLE, damit wirklich die Leserolle liest: als Eigentuemer laeuft
--    alles (0109). SELECT * mit LIMIT und nicht count(*), weil count(*)
--    die Spaltenausdruecke der Sicht nicht auswertet und die Funktion
--    darin nie ruft.
-- ---------------------------------------------------------------------

DO $probe$
DECLARE
    v_sicht  text;
    v_liegen text[] := '{}';
BEGIN
    -- Ohne die Rolle oder ohne Mitgliedschaft darin laesst sich die Probe
    -- nicht fahren. Dann eine WARNUNG statt eines Abbruchs: eine Migration,
    -- die an ihrer eigenen Gegenprobe scheitert, weil der einspielende
    -- Zugang kein Mitglied der Leserolle ist, waere ein Deploy-Blocker aus
    -- dem falschen Grund. Die Gegenprobe fuehrt dann der Gesundheitslauf des
    -- Servers (mart.sicht_defekt).
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0110 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0110 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_sicht IN ARRAY ARRAY[
        'mart.wetter_tag', 'mart.betrieb_wetter_tag', 'mart.vergleichstag',
        'mart.wetter_effekt', 'mart.wetter_effekt_gruppe', 'mart.wettertag_lage',
        'mart.pruefung_kalender', 'mart.pruefung_uebersicht', 'mart.import_gesamt',
        'ampel.schwelle_je_betrieb', 'mart.leserolle_pruefung',
        'mart.sicht_defekt', 'mart.sicht_ohne_leserecht', 'mart.sicht_unklar']
    LOOP
        BEGIN
            EXECUTE format('SELECT * FROM %s LIMIT 1', v_sicht);
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_sicht, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0110 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0110', to_jsonb(
        'Dieselbe Falle wie 0109, eine Schicht tiefer: nicht die Funktion IN mart, sondern '
        'die aus core, die eine mart-Sicht ruft. core.geschaeftstag() greift im Rumpf auf '
        'core.geschaefts_zeitzone() zu, und ein Funktionsrumpf erbt die Rechte des '
        'Aufrufers — damit waren acht Sichten fuer mcp_leser unlesbar, darunter jede '
        'Wettersicht, mart.vergleichstag und die Pruefliste selbst. Dazu '
        'mart.import_gesamt ueber sync.sperre_aktiv() und zwei Sichten ohne SELECT-Recht. '
        'Behoben: core.geschaeftstag() ist SECURITY DEFINER (kostet nichts Messbares, '
        'nachgemessen ueber 657.334 Stundenwerte), mart.import_gesamt liest die Sperre '
        'selbst, und mcp.rechte_auffrischen() laeuft am Ende jeder Migration mit einer '
        'neuen Sicht. mart.leserolle_pruefung sieht jetzt in JEDES Schema, '
        'mart.sicht_ohne_leserecht findet fehlende Rechte, und mart.sicht_defekt zeigt, '
        'was der Gesundheitslauf des MCP-Servers wirklich nicht lesen konnte. '
        'Pruefzeilen: SELECT * FROM mart.leserolle_pruefung; SELECT * FROM '
        'mart.sicht_ohne_leserecht; SELECT * FROM mart.sicht_defekt; alle drei erwartet '
        'leer.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
