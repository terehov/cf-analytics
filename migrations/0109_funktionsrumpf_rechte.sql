-- =====================================================================
-- 0109 — Ein Funktionsrumpf erbt die Rechte des AUFRUFERS, eine Sicht die
--        des EIGENTUEMERS. Drei Sichten sind daran gescheitert.
--
-- BEFUND VOM 20.09.2026, 30 Minuten nach dem Deploy von 0107/0108, gegen
-- Produktion gemessen:
--
--   SELECT bereich_name, konzept, betriebe_operativ FROM mart.ampel_schwelle;
--   ERROR:  permission denied for schema core
--   CONTEXT: SQL function "hauptkonzept" during inlining
--
-- Betroffen waren mart.ampel_schwelle, mart.ampel_bereich und
-- mart.round_table_unvollstaendig — also die drei Sichten, die 0107 an
-- ampel.konzept_je_betrieb gehaengt hat. Fuer Metabase lief alles, fuer
-- `mcp_leser` keine davon: ChatGPT und Claude bekamen auf jede Frage nach
-- den Ampeln je Bereich einen Fehler.
--
-- DIE REGEL, die dahintersteckt, und die dieses Schema an zwei Stellen
-- verletzt hat:
--
--   EINE SICHT greift auf ihre Tabellen mit den Rechten ihres
--   EIGENTUEMERS zu. Deshalb liest `mcp_leser` mart.konzept_zuordnung,
--   obwohl darunter core.betrieb_konzept liegt, das ihm 0105 ausdruecklich
--   entzieht.
--
--   EIN FUNKTIONSRUMPF greift mit den Rechten des AUFRUFERS zu — auch
--   wenn die Funktion aus einer Sicht heraus gerufen wird. Der Umweg
--   ueber eine Funktion hebt den Schutz der Sicht also auf, und zwar
--   lautlos: lokal als Eigentuemer getestet laeuft alles.
--
-- WARUM DER TEST DAS NICHT GEFANGEN HAT: `SELECT count(*) FROM <sicht>`
-- wertet die Spaltenausdruecke der Sicht gar nicht aus. Die Funktion wurde
-- also nie gerufen, und die Probe war gruen. Erst eine Abfrage, die die
-- Spalte wirklich liest, faellt um.
--
-- WARUM DIE FEHLERMELDUNG IRREFUEHRT: der MCP-Server haengt an jede
-- Antwort den Datenstand. Diese zweite Abfrage laeuft auf derselben,
-- bereits abgebrochenen Verbindung und meldet "current transaction is
-- aborted" — die echte Ursache steht dann nirgends mehr. Das ist aelter
-- als 0107 und in docs/fehlerkatalog.md festgehalten.
--
-- EIN ZWEITER FALL, schon vor 0107 vorhanden und hier mitbehoben:
-- mart.quelle_zulauf. Sie ruft mart.quelle_messen(), und die liest `sync`.
-- Die Sicht steht im MCP-Katalog, war fuer die Leserolle aber seit jeher
-- unlesbar — die Zulaufpruefung, ausgerechnet.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die Konzeptaufloesung wandert in die SICHT
--
-- Dieselbe Regel wie in mart.konzept_zuordnung, nur als Schluessel. Was
-- vorher im Rumpf von ampel.hauptkonzept() stand, steht jetzt in der
-- Sicht selbst — damit greift der Zugriff auf core mit den Rechten des
-- Eigentuemers, wie bei jeder anderen mart-Sicht auch.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW ampel.konzept_je_betrieb AS
SELECT b.betrieb_key,
       coalesce(m.konzept_key,
                CASE WHEN z.anzahl = 1 THEN z.einziges END) AS konzept_key
  FROM core.betrieb b
  LEFT JOIN manual.betrieb_hauptkonzept m ON m.betrieb_key = b.betrieb_key
  -- count() + min() statt eines Joins: genau ein Konzept zaehlt, mehrere
  -- bleiben NULL und fallen damit auf den Rueckfall des Regelwerks.
  LEFT JOIN LATERAL (
        SELECT count(*) AS anzahl, min(bk.konzept_key) AS einziges
          FROM core.betrieb_konzept bk
         WHERE bk.betrieb_key = b.betrieb_key) z ON true;

COMMENT ON VIEW ampel.konzept_je_betrieb IS
'Betrieb zu Hauptkonzept-Schluessel, eine Zeile je Betrieb, nach denselben Regeln wie
mart.konzept_zuordnung.hauptkonzept: Handentscheidung vor LINA-Eindeutigkeit, Mehrdeutige
bleiben NULL.

SEIT 0109 loest die SICHT auf und nicht mehr ampel.hauptkonzept(). Ein Funktionsrumpf
greift mit den Rechten des Aufrufers zu, eine Sicht mit denen ihres Eigentuemers — ueber
die Funktion war jede Sicht darauf fuer mcp_leser unlesbar (permission denied for schema
core), obwohl sie fuer Metabase lief.';


-- Die Funktion bleibt — sie steht in ampel.bewerte() und in der
-- Dokumentation —, liest aber jetzt die Sicht statt core. Damit ist ihr
-- Rumpf fuer jeden lesbar, der die Sicht lesen darf.
CREATE OR REPLACE FUNCTION ampel.hauptkonzept(p_betrieb_key integer)
RETURNS integer
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT k.konzept_key
      FROM ampel.konzept_je_betrieb k
     WHERE k.betrieb_key = p_betrieb_key;
$$;

COMMENT ON FUNCTION ampel.hauptkonzept(integer) IS
'Das Hauptkonzept eines Betriebs als Schluessel. Duenne Huelle um
ampel.konzept_je_betrieb — die Aufloesung selbst steht seit 0109 in der Sicht, weil ein
Funktionsrumpf die Rechte des Aufrufers erbt und core fuer mcp_leser gesperrt ist.';


-- ---------------------------------------------------------------------
-- 2. Dieselbe Falle in ampel.bewerte(), nur noch nicht zugeschnappt
--
-- Sie liest core.schwellenwert_betrieb. Heute faellt das niemandem auf:
-- die Stufe greift nur im Regelwerk `lina_betrieb`, und das laeuft
-- ausschliesslich ueber mart.round_table(monat, 'lina_betrieb') — eine
-- Funktion, die der MCP-Pruefer gar nicht erst zulaesst. Waere die
-- Schwellenquelle morgen im Standardregelwerk gesetzt, saehe die
-- Auswertungsschicht dieselbe Meldung wie heute frueh.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW ampel.schwelle_je_betrieb AS
SELECT betrieb_key, gueltig_ab, bereich, schwelle_gruen, schwelle_orange, schwelle_rot
  FROM core.schwellenwert_betrieb;

COMMENT ON VIEW ampel.schwelle_je_betrieb IS
'core.schwellenwert_betrieb, lesbar fuer wer die Auswertungsschicht lesen darf.
Existiert allein, damit der Rumpf von ampel.bewerte() nicht in core greift — siehe 0109.';


CREATE OR REPLACE FUNCTION ampel.bewerte(
    p_wert          numeric,
    p_bereich       text,
    p_regelwerk     text    DEFAULT NULL,
    p_betrieb_key   integer DEFAULT NULL,
    p_stichtag      date    DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r           ampel.regel%ROWTYPE;
    rk          ampel.regel_konzept%ROWTYPE;
    v_regelwerk text;
    v_gruen     numeric;
    v_orange    numeric;
BEGIN
    IF p_wert IS NULL THEN RETURN NULL; END IF;

    v_regelwerk := COALESCE(p_regelwerk,
                            (SELECT regelwerk_key FROM ampel.regelwerk WHERE ist_standard LIMIT 1));

    SELECT * INTO r FROM ampel.regel
     WHERE regelwerk_key = v_regelwerk AND bereich = p_bereich;
    IF NOT FOUND THEN RETURN NULL; END IF;

    -- Stufe 1: was LINA fuer diesen einen Betrieb fuehrt.
    -- Ueber ampel.schwelle_je_betrieb und nicht direkt auf core: siehe 0109.
    IF r.schwellenquelle = 'lina_betrieb' THEN
        SELECT s.schwelle_gruen, s.schwelle_orange INTO v_gruen, v_orange
          FROM ampel.schwelle_je_betrieb s
         WHERE s.betrieb_key = p_betrieb_key
           AND s.bereich     = p_bereich
           AND (p_stichtag IS NULL OR s.gueltig_ab <= p_stichtag)
         ORDER BY s.gueltig_ab DESC
         LIMIT 1;
    END IF;

    -- Stufe 2: der Satz der Marke.
    IF v_gruen IS NULL
       AND EXISTS (SELECT 1 FROM ampel.regel_konzept x
                    WHERE x.regelwerk_key = v_regelwerk AND x.bereich = p_bereich) THEN
        SELECT * INTO rk FROM ampel.regel_konzept x
         WHERE x.regelwerk_key = v_regelwerk
           AND x.bereich       = p_bereich
           AND x.konzept_key   = ampel.hauptkonzept(p_betrieb_key);
        IF FOUND THEN
            IF rk.ohne_urteil THEN RETURN NULL; END IF;
            v_gruen  := rk.schwelle_gruen;
            v_orange := rk.schwelle_orange;
        END IF;
    END IF;

    -- Stufe 3: der Rueckfall des Regelwerks.
    v_gruen  := COALESCE(v_gruen,  r.schwelle_gruen);
    v_orange := COALESCE(v_orange, r.schwelle_orange);
    IF v_gruen IS NULL OR v_orange IS NULL THEN RETURN NULL; END IF;

    IF r.richtung = 'niedriger_ist_besser' THEN
        IF p_wert <= v_gruen  THEN RETURN 'gruen';  END IF;
        IF p_wert <= v_orange THEN RETURN 'orange'; END IF;
        RETURN 'rot';
    ELSE
        IF p_wert >= v_gruen  THEN RETURN 'gruen';  END IF;
        IF p_wert >= v_orange THEN RETURN 'orange'; END IF;
        RETURN 'rot';
    END IF;
END $$;


-- ---------------------------------------------------------------------
-- 3. mart.quelle_zulauf — derselbe Fehler, aelter als 0107
--
-- mart.quelle_messen() laeuft nicht ohne Zugriff auf `sync`, und anders
-- als oben laesst sie sich nicht in eine Sicht aufloesen: ihr zweiter
-- Zweig baut die Abfrage aus schema_name/tabelle/zeitspalte der Zeile
-- zusammen. Deshalb hier SECURITY DEFINER — mit festem search_path, wie
-- es sich fuer eine solche Funktion gehoert.
--
-- Vertretbar, weil sie nichts entgegennimmt, nur liest und drei
-- Zeitstempel zurueckgibt. Die Bezeichner des dynamischen Zweigs stammen
-- aus sync.quelle, in die nur der Importer schreibt, und gehen durch
-- format('%I').
-- ---------------------------------------------------------------------

ALTER FUNCTION mart.quelle_messen() SECURITY DEFINER SET search_path = pg_catalog, public;

COMMENT ON FUNCTION mart.quelle_messen() IS
'Misst je Zeile in sync.quelle, wann zuletzt gefragt und wann zuletzt Zulauf
entstanden ist. Ueber sync.aufgabe, wo der Importer selbst protokolliert hat,
sonst direkt an der Zieltabelle (Yext-Nachlauf schreibt keine Aufgabe).

SEIT 0109 SECURITY DEFINER: der Rumpf liest `sync`, und ein Funktionsrumpf erbt die Rechte
des Aufrufers. mart.quelle_zulauf war dadurch fuer mcp_leser unlesbar — die Zulaufpruefung
also genau fuer die Schnittstelle, die sie am noetigsten hat. Aufloesen wie bei
ampel.hauptkonzept() geht hier nicht: der zweite Zweig baut die Abfrage dynamisch.';


-- ---------------------------------------------------------------------
-- 4. Damit es nicht wieder still passiert
--
-- Eine Pruefzeile statt eines guten Vorsatzes. Sie findet den naechsten
-- Fall, bevor ihn jemand in ChatGPT findet.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.leserolle_pruefung AS
SELECT n.nspname || '.' || p.proname AS funktion,
       (SELECT string_agg(DISTINCT m[1], ', ' ORDER BY m[1])
          FROM regexp_matches(p.prosrc, '\y(core|raw|part|sync)\.', 'g') m) AS greift_auf,
       'Rumpf greift in ein gesperrtes Schema und ist nicht SECURITY DEFINER — '
       'jede Sicht, die diese Funktion ruft, ist fuer mcp_leser unlesbar' AS befund
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname IN ('ampel', 'mart')
   AND NOT p.prosecdef
   AND p.prosrc ~ '\y(core|raw|part|sync)\.'
 ORDER BY 1;

COMMENT ON VIEW mart.leserolle_pruefung IS
'Funktionen in ampel und mart, deren Rumpf in ein fuer mcp_leser gesperrtes Schema greift.
ERWARTUNG: LEER.

Eine Sicht greift auf ihre Tabellen mit den Rechten ihres EIGENTUEMERS zu, ein
Funktionsrumpf mit denen des AUFRUFERS — auch aus einer Sicht heraus. Wer den Zugriff auf
core/sync in eine Funktion verlegt, hebt damit den Schutz der Sicht auf, und zwar lautlos:
als Eigentuemer getestet laeuft alles.

Zwei Wege heraus, beide in 0109 vorgefuehrt: die Aufloesung in die SICHT ziehen
(ampel.konzept_je_betrieb), oder — wenn das an dynamischem SQL scheitert — SECURITY
DEFINER mit festem search_path (mart.quelle_messen).

ACHTUNG, die Pruefung ist eine Textsuche im Rumpf. Sie findet keinen Zugriff ueber
dynamisches SQL und keinen ueber einen Alias. Eine leere Zeile heisst "nichts Offensichtliches",
nicht "bewiesen sauber".

Koernung: eine Zeile je Funktion, die in ein gesperrtes Schema greift.';


-- In die Pruefuebersicht, damit sie jemand sieht.
--
-- Angehaengt statt abgeschrieben: die Sicht ist eine UNION-Kette aus
-- zwanzig Zweigen, und eine Kopie davon in dieser Datei waere beim
-- naechsten neuen Zweig eine zweite Wahrheit. Dasselbe Verfahren wie in
-- 0010, das die Sichten um core.personalkosten herum gerettet hat.
DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;

    -- Idempotent: ein zweiter Lauf haengt den Zweig nicht noch einmal an.
    IF v_def LIKE '%leserolle_pruefung%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        SELECT 'Leserolle: Funktionsrumpf greift in ein gesperrtes Schema'::text AS pruefung,
               (SELECT count(*) FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname IN ('ampel','mart'))::bigint AS geprueft,
               (SELECT count(*) FROM mart.leserolle_pruefung)::bigint AS auffaellig,
               'mart.leserolle_pruefung'::text AS sicht
        $zweig$);
END $aussen$;


-- Achsen und Spalten der neuen Sicht nachfuehren.
SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht SET
    koernung = 'eine Funktion, die in ein gesperrtes Schema greift — ERWARTUNG: keine Zeile',
    thema    = 'import'
 WHERE sicht = 'mart.leserolle_pruefung';

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0109', to_jsonb(
        'Ein Funktionsrumpf erbt die Rechte des AUFRUFERS, eine Sicht die des EIGENTUEMERS. '
        '0107 hat die Konzeptaufloesung in ampel.hauptkonzept() gelegt, und damit waren '
        'mart.ampel_schwelle, mart.ampel_bereich und mart.round_table_unvollstaendig fuer '
        'mcp_leser unlesbar (permission denied for schema core) — fuer Metabase lief alles. '
        'Seit 0109 loest die SICHT ampel.konzept_je_betrieb auf. Mitbehoben: ampel.bewerte() '
        'liest core.schwellenwert_betrieb jetzt ueber ampel.schwelle_je_betrieb, und '
        'mart.quelle_messen() ist SECURITY DEFINER — mart.quelle_zulauf war seit 0076 fuer '
        'die Leserolle unlesbar. Pruefzeile: SELECT * FROM mart.leserolle_pruefung; '
        'erwartet leer.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
