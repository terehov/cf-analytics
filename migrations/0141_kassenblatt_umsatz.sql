-- =====================================================================
-- 0141 Umsatz der Betriebe mit fremder Kasse — aus LINAs Kassenblatt
--
-- ANLASS (28.10.2026). Einige Betriebe kassieren nicht ueber LINA (Vectron,
-- ikentoo u. a.), tragen ihre Tageswerte aber von Hand in LINAs Kassenblatt
-- ein. Kein Konzernbericht liefert diese Werte: getUmsatzbericht fuehrt die
-- Betriebe mit 0,00 EUR an jedem Tag (Enchilada Bremen: 3.222 Tageszeilen,
-- alle null). mart.betrieb_status nennt sie seit 0125 `fremdkasse`.
--
-- DER WEG, im Browser erhoben (docs/lina-api-inventar-ladenakte.md §2a):
-- der Ladenakte-Bericht "Die letzten Tage" je Betrieb und Monat liefert den
-- Nettoumsatz je Tag, aufgeteilt nach den Umsatzgruppen des Betriebs.
-- Nachgemessen am 28.10.2026:
--   * bei LINA-Kassen derselbe Nettoumsatz wie getUmsatzbericht —
--     Ratskeller Ludwigsburg 95.791,39 gegen 95.791,39 EUR (09/2026),
--     Saarbruecken und Wilma Wunder Ballplatz Mainz auf den Cent;
--   * bei Enchilada Bremen gegen die BWA-Erloese 0,16 % (03/2024) und
--     0,31 % (08/2026) Abweichung;
--   * vier der sechs Fremdkassen-Betriebe liefern Werte, Aposto Wuppertal
--     (ikentoo) auch dort nicht.
--
-- ENTSCHEIDUNG EUGENE (28.10.2026): in die BESTEHENDE Tabelle, damit Round
-- Table, Datenstand und MCP die Werte ohne Umweg mitnehmen; so weit zurueck
-- wie moeglich — begrenzt auf HISTORIE_AB (2018-01-01), den Beginn der
-- Konzernhistorie. Vor 2018 haette sonst NUR eine Handvoll Betriebe Umsatz,
-- und "Umsatz der Gruppe 2015" bekaeme still eine Antwort ueber vier
-- Betriebe (docs/entscheidungen.md).
--
-- WAS DIESE DATEI TUT
--   1. core.umsatzbericht_tag.quelle ('umsatzbericht' | 'kassenblatt')
--   2. core.kassenblatt_monat — Monatswerte aus "Die letzten Jahre", die
--      Messung, an der der Importer entscheidet, was er tageweise holt
--   3. mart.umsatz_tag / mart.umsatz_tag_sparte fuehren `quelle`
--   4. sechs Pruefsichten, die LINAs KASSE meinen, lesen nur noch
--      quelle = 'umsatzbericht'
--   5. mart.kassenblatt_stand — Betrieb × Monat, was fehlt (Regel 10)
--   5a. mart.datenstand kennt den Befund 'Kassenblatt' und sagt, woher der
--       letzte Umsatz kommt (umsatz_quelle)
--   6. MCP: Koernung, zwei Fallstricke, Rechte, Leseprobe
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die Quelle einer Umsatzzeile
--
-- NICHT im Eindeutigkeitsschluessel. Je Betrieb, Tag, Sparte und
-- Verkaufsstelle gibt es genau EINEN Umsatz; zwei Zeilen fuer denselben Tag
-- verdoppelten jede Summe und jede Tageszaehlung in rund dreissig Sichten.
-- Stattdessen entscheiden die beiden Lader, wer eine bestehende Zeile
-- ueberschreiben darf (src/sync/laden.ts, src/ladenakte/laden.ts):
--
--   * ein ECHTER Wert schlaegt eine Null — LINAs taegliche 0,00 EUR fuer
--     einen Fremdkassen-Betrieb ueberschreiben das Kassenblatt nicht;
--   * bei echten Werten auf beiden Seiten gewinnt LINAs Kasse.
--
-- Ein konstanter DEFAULT legt die Spalte ohne Umschreiben der Tabelle an
-- (PostgreSQL ab 11); die CHECK-Pruefung liest die Tabelle einmal.
-- ---------------------------------------------------------------------

ALTER TABLE core.umsatzbericht_tag
    ADD COLUMN quelle text NOT NULL DEFAULT 'umsatzbericht'
        CONSTRAINT umsatzbericht_tag_quelle_chk CHECK (quelle IN ('umsatzbericht', 'kassenblatt'));

COMMENT ON COLUMN core.umsatzbericht_tag.quelle IS
'Woher die Zeile stammt. umsatzbericht = LINAs Konzernbericht (Kasse an LINA). kassenblatt = '
'Ladenakte-Bericht "Die letzten Tage" fuer Betriebe mit fremder Kasse (0141): Nettoumsatz von '
'Hand eingetragen, Brutto, Rechnungen, Gaeste und Bons sind NULL. Nicht im Schluessel — je Tag '
'gibt es einen Umsatz; ein echter Wert schlaegt eine Null, LINAs Kasse schlaegt das Kassenblatt.';


-- ---------------------------------------------------------------------
-- 2. Monatswerte aus "Die letzten Jahre"
--
-- Ein Aufruf je Betrieb liefert alle Monate seit Beginn. Momentaufnahme:
-- der Lader ersetzt je Betrieb alle Zeilen (wie core.bwa_position), raw
-- behaelt jeden Abruf. Eine leere Zelle wird KEINE Zeile — "nichts erfasst"
-- ist nicht dasselbe wie 0,00.
-- ---------------------------------------------------------------------

CREATE TABLE core.kassenblatt_monat (
    betrieb_key   integer       NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat         date          NOT NULL,
    umsatz_netto  numeric(14,2) NOT NULL,
    abgerufen_am  timestamptz   NOT NULL,
    raw_id        bigint,
    PRIMARY KEY (betrieb_key, monat),
    CONSTRAINT kassenblatt_monat_monatserster CHECK (monat = date_trunc('month', monat)::date)
);
COMMENT ON TABLE core.kassenblatt_monat IS
'Nettoumsatz je Betrieb und Monat aus dem Ladenakte-Bericht "Die letzten Jahre" (la:jahresumsatz, '
'0141). Fuer ALLE Betriebe geholt: bei LINA-Kassen ist es derselbe Umsatz wie getUmsatzbericht, '
'bei fremder Kasse der von Hand eingetragene. Daran entscheidet der Importer, welche Monate er '
'tageweise holt (mart.kassenblatt_stand). Momentaufnahme je Betrieb, raw behaelt jeden Abruf.';


-- ---------------------------------------------------------------------
-- 3. Die Umsatzsichten fuehren die Quelle
--
-- Angehaengt am Ende: CREATE OR REPLACE VIEW kann nur anhaengen. Beide
-- Definitionen sind seit 0006 unveraendert (nachgesehen in allen
-- Migrationen und an einem Klon auf Stand 0140).
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.umsatz_tag AS
SELECT u.geschaeftstag,
       date_trunc('month', u.geschaeftstag)::date AS monat,
       b.betrieb_key,
       b.name          AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       u.umsatz_netto, u.umsatz_brutto, u.rechnungen, u.gaeste,
       u.durchschnittsbon, u.umsatz_pro_gast,
       u.quelle
  FROM core.umsatzbericht_tag u
  JOIN core.betrieb b                 ON b.betrieb_key = u.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = u.betrieb_key
 WHERE u.hauptsparte_key IS NULL
   AND u.verkaufsstelle_key IS NULL;

CREATE OR REPLACE VIEW mart.umsatz_tag_sparte AS
SELECT u.geschaeftstag,
       date_trunc('month', u.geschaeftstag)::date AS monat,
       b.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       hs.name         AS hauptsparte,
       vs.name         AS verkaufsstelle,
       u.umsatz_netto, u.umsatz_brutto, u.rechnungen, u.gaeste,
       u.durchschnittsbon, u.umsatz_pro_gast,
       u.quelle
  FROM core.umsatzbericht_tag u
  JOIN core.betrieb b                 ON b.betrieb_key = u.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = u.betrieb_key
  LEFT JOIN core.hauptsparte hs       ON hs.hauptsparte_key = u.hauptsparte_key
  LEFT JOIN core.verkaufsstelle vs    ON vs.verkaufsstelle_key = u.verkaufsstelle_key
 WHERE u.hauptsparte_key IS NOT NULL
    OR u.verkaufsstelle_key IS NOT NULL;

COMMENT ON COLUMN mart.umsatz_tag.quelle IS
'umsatzbericht = LINAs Kasse; kassenblatt = von Hand eingetragener Tagesumsatz eines Betriebs mit '
'fremder Kasse (0141) — dann sind Brutto, Rechnungen, Gaeste und Bons NULL, nicht 0.';


-- ---------------------------------------------------------------------
-- 4. Pruefsichten, die LINAs KASSE meinen
--
-- Sechs Sichten schliessen aus "der Betrieb hat an diesem Tag Umsatz", dass
-- LINAs Kasse lief — und erwarten deshalb Betriebsberichte, Verkaufsstellen,
-- Gaestezahlen oder einen vollen Konzernbericht. Fuer einen Kassenblatt-Tag
-- ist das falsch: sie meldeten jeden solchen Tag als Luecke, die kein Abruf
-- je schliessen kann. Am Klon mit simulierten Bremen-Tagen nachgemessen
-- (28.10.2026): mart.gaeste_abdeckung fuehrte Bremen mit 70 Umsatztagen und
-- 0,0 % Gaesten, und die Pruefzeile "Betrieb-Tage mit Umsatz ohne Bericht"
-- zaehlte 60 geprueft bei 0 auffaellig — der Nenner waren Kassenblatt-Tage,
-- fuer die es keinen Bericht geben kann.
--
-- mart.pruefung_uebersicht steht hier im ersten Durchgang, obwohl sie unten
-- mit der materialisierten Sicht faellt und wieder aufersteht: die Aufnahme
-- in _kb_abh liest die Definition NACH diesem Durchgang, also mit Filter.
--
-- Die Definitionen kommen AUS DER ZIELDATENBANK, nicht aus einer Abschrift
-- (dasselbe Vorgehen wie 0129, Abschnitt 9): die Migrationsdateien geben den
-- Stand einer Bank nicht zuverlaessig wieder. Eingesetzt wird nur der
-- Filter, und zwar an einer Textstelle, deren Anzahl feststeht. Stimmt sie
-- nicht, bricht die Migration ab — eine Ersetzung, die still ins Leere geht,
-- wuerde die Pruefsicht unveraendert lassen und das Gegenteil behaupten.
-- ---------------------------------------------------------------------

CREATE FUNCTION pg_temp.filter_einsetzen(p_def text, p_alias text, p_erwartet integer, p_name text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_alt  text := format('(%s.verkaufsstelle_key IS NULL)', p_alias);
    v_neu  text := format('(%1$s.verkaufsstelle_key IS NULL) AND (%1$s.quelle = %2$L::text)',
                          p_alias, 'umsatzbericht');
    v_anz  integer := (length(p_def) - length(replace(p_def, v_alt, ''))) / length(v_alt);
BEGIN
    IF v_anz <> p_erwartet THEN
        RAISE EXCEPTION '0141: in % steht "%" %-mal, erwartet %-mal — Definition hat sich geaendert, '
                        'bitte von Hand pruefen', p_name, v_alt, v_anz, p_erwartet;
    END IF;
    RETURN replace(p_def, v_alt, v_neu);
END $$;

DO $$
DECLARE
    rec record;
BEGIN
    FOR rec IN SELECT * FROM (VALUES
        ('mart.umsatz_lochtag',           'umsatzbericht_tag', 1),
        ('mart.verkaufsstelle_abdeckung', 'u',                 1),
        ('mart.betriebsbericht_luecke',   'u',                 1),
        -- Gaeste zaehlt nur LINAs Kasse; das Kassenblatt kennt keine.
        ('mart.gaeste_abdeckung',         'u',                 1),
        -- Nur die Zeile "Betriebsberichte: Betrieb-Tage mit Umsatz ohne
        -- Bericht" liest die Tabelle direkt; die uebrigen gehen ueber Sichten.
        ('mart.pruefung_uebersicht',      'umsatzbericht_tag', 1)
    ) AS v(sicht, alias, anzahl)
    LOOP
        EXECUTE format('CREATE OR REPLACE VIEW %s AS %s', rec.sicht,
            pg_temp.filter_einsetzen(pg_get_viewdef(rec.sicht::regclass), rec.alias, rec.anzahl, rec.sicht));
    END LOOP;
END $$;

-- Die materialisierte Sicht laesst sich nicht ersetzen, nur neu anlegen —
-- und DROP ... CASCADE nimmt ALLES mit, was darueber steht, nicht nur die
-- direkten Abhaengigen. Nachgemessen am Klon (Stand 0140), rekursiv:
--   Tiefe 1  mart.betriebsbericht_ladestand, mart.betriebsbericht_ladestand_monat
--   Tiefe 2  mart.luecke_monat
--   Tiefe 3  mart.pruefung_uebersicht
-- Die erste Fassung dieser Datei erhob nur Tiefe 1 und loeschte die beiden
-- Pruefsichten still mit (am Klon aufgefallen, weil die Karte dq_pruefung
-- scheiterte). Deshalb jetzt rekursiv, und die erwartete Liste ist eine
-- harte Pruefung: haengt etwas Unbekanntes daran, bricht die Migration ab.
-- Wiederhergestellt wird aus der Definition IN DER ZIELDATENBANK, mit
-- Kommentaren (auch je Spalte), Rechten und Indizes — wie 0129, Abschnitt 9.

CREATE TEMP TABLE _kb_abh ON COMMIT DROP AS
WITH RECURSIVE dep AS (
    SELECT DISTINCT r.ev_class AS oid, 1 AS tiefe
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
     WHERE d.refobjid = 'mart.betriebsbericht_ladestand_basis'::regclass
       AND r.ev_class <> 'mart.betriebsbericht_ladestand_basis'::regclass
    UNION
    SELECT DISTINCT r.ev_class, dep.tiefe + 1
      FROM dep
      JOIN pg_depend d  ON d.refobjid = dep.oid
      JOIN pg_rewrite r ON r.oid = d.objid
     WHERE r.ev_class <> dep.oid
       AND dep.tiefe < 10
)
SELECT c.oid, c.relkind, n.nspname, c.relname,
       min(dep.tiefe) AS tiefe,
       pg_get_viewdef(c.oid) AS definition,
       obj_description(c.oid, 'pg_class') AS kommentar,
       pg_get_userbyid(c.relowner) AS eigentuemer
  FROM dep
  JOIN pg_class c     ON c.oid = dep.oid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 GROUP BY c.oid, c.relkind, n.nspname, c.relname;

CREATE TEMP TABLE _kb_objekt ON COMMIT DROP AS
SELECT oid, relkind, nspname, relname FROM _kb_abh
UNION ALL
SELECT c.oid, c.relkind, n.nspname, c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.oid = 'mart.betriebsbericht_ladestand_basis'::regclass;

CREATE TEMP TABLE _kb_basis ON COMMIT DROP AS
SELECT pg_get_viewdef('mart.betriebsbericht_ladestand_basis'::regclass) AS definition,
       obj_description('mart.betriebsbericht_ladestand_basis'::regclass, 'pg_class') AS kommentar;

CREATE TEMP TABLE _kb_spaltenkommentar ON COMMIT DROP AS
SELECT o.nspname, o.relname, a.attname, d.description
  FROM _kb_objekt o
  JOIN pg_description d ON d.objoid = o.oid AND d.classoid = 'pg_class'::regclass AND d.objsubid > 0
  JOIN pg_attribute a   ON a.attrelid = o.oid AND a.attnum = d.objsubid;

CREATE TEMP TABLE _kb_recht ON COMMIT DROP AS
SELECT o.nspname, o.relname, x.privilege_type, x.grantee
  FROM _kb_objekt o
  JOIN pg_class c ON c.oid = o.oid
 CROSS JOIN LATERAL aclexplode(c.relacl) x
 WHERE x.grantee <> c.relowner;

CREATE TEMP TABLE _kb_index ON COMMIT DROP AS
SELECT i.indexdef
  FROM pg_indexes i
  JOIN _kb_objekt o ON o.nspname = i.schemaname AND o.relname = i.tablename;

DO $$
DECLARE
    v_erwartet text[] := ARRAY['betriebsbericht_ladestand', 'betriebsbericht_ladestand_monat',
                               'luecke_monat', 'pruefung_uebersicht'];
    v_fremd   text;
    v_fehlt   text;
BEGIN
    SELECT string_agg(nspname || '.' || relname, ', ') INTO v_fremd
      FROM _kb_abh
     WHERE nspname <> 'mart' OR NOT relname = ANY (v_erwartet);
    IF v_fremd IS NOT NULL THEN
        RAISE EXCEPTION 'Unerwartete Abhaengigkeit von mart.betriebsbericht_ladestand_basis: %. '
                        '0141 kennt nur die vier Sichten aus dem Kopf dieses Abschnitts.', v_fremd;
    END IF;
    SELECT string_agg(e, ', ') INTO v_fehlt
      FROM unnest(v_erwartet) e
     WHERE NOT EXISTS (SELECT 1 FROM _kb_abh WHERE nspname = 'mart' AND relname = e);
    IF v_fehlt IS NOT NULL THEN
        RAISE EXCEPTION '0141: erwartete Abhaengige fehlen: % — die Zieldatenbank sieht anders '
                        'aus als der Klon, an dem gemessen wurde. Bitte von Hand pruefen.', v_fehlt;
    END IF;
END $$;

DROP MATERIALIZED VIEW mart.betriebsbericht_ladestand_basis CASCADE;

DO $$
DECLARE
    v_offen  integer;
    v_vorher integer := -1;
    rec      record;
BEGIN
    EXECUTE format('CREATE MATERIALIZED VIEW mart.betriebsbericht_ladestand_basis AS %s',
        rtrim(rtrim(pg_temp.filter_einsetzen((SELECT definition FROM _kb_basis), 'u_1', 2,
                                             'mart.betriebsbericht_ladestand_basis')), ';'));

    -- Die Abhaengigen in ihrer eigenen Definition zurueck. Wer an einer noch
    -- fehlenden Sicht haengt, kommt in der naechsten Runde dran.
    CREATE TEMP TABLE _kb_offen ON COMMIT DROP AS SELECT * FROM _kb_abh;
    LOOP
        SELECT count(*) INTO v_offen FROM _kb_offen;
        EXIT WHEN v_offen = 0;
        IF v_offen = v_vorher THEN
            RAISE EXCEPTION 'Nicht wiederherstellbar: %',
                (SELECT string_agg(nspname || '.' || relname, ', ') FROM _kb_offen);
        END IF;
        v_vorher := v_offen;
        FOR rec IN SELECT * FROM _kb_offen ORDER BY tiefe, relname LOOP
            BEGIN
                EXECUTE format('CREATE %s %I.%I AS %s',
                               CASE rec.relkind WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END,
                               rec.nspname, rec.relname, rtrim(rtrim(rec.definition), ';'));
                DELETE FROM _kb_offen WHERE oid = rec.oid;
            EXCEPTION WHEN undefined_table OR undefined_column THEN
                NULL;
            END;
        END LOOP;
    END LOOP;

    IF (SELECT kommentar FROM _kb_basis) IS NOT NULL THEN
        EXECUTE format('COMMENT ON MATERIALIZED VIEW mart.betriebsbericht_ladestand_basis IS %L',
                       (SELECT kommentar FROM _kb_basis));
    END IF;
    FOR rec IN SELECT * FROM _kb_abh WHERE kommentar IS NOT NULL LOOP
        EXECUTE format('COMMENT ON %s %I.%I IS %L',
                       CASE rec.relkind WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END,
                       rec.nspname, rec.relname, rec.kommentar);
    END LOOP;
    FOR rec IN SELECT * FROM _kb_spaltenkommentar LOOP
        EXECUTE format('COMMENT ON COLUMN %I.%I.%I IS %L',
                       rec.nspname, rec.relname, rec.attname, rec.description);
    END LOOP;
    FOR rec IN SELECT * FROM _kb_recht LOOP
        EXECUTE format('GRANT %s ON %I.%I TO %s', rec.privilege_type, rec.nspname, rec.relname,
                       CASE WHEN rec.grantee = 0 THEN 'PUBLIC'
                            ELSE quote_ident(pg_get_userbyid(rec.grantee)) END);
    END LOOP;
    FOR rec IN SELECT * FROM _kb_index LOOP
        EXECUTE rec.indexdef;
    END LOOP;

    -- Eigentuemer zurueck. Am Klon gemessen: pruefung_uebersicht gehoerte
    -- postgres und haette sonst dem migrierenden Konto gehoert. Darf das
    -- Konto den Eigentuemer nicht setzen, bleibt es bei einer Warnung — die
    -- Rechte oben sind trotzdem wiederhergestellt.
    FOR rec IN SELECT * FROM _kb_abh WHERE eigentuemer <> current_user LOOP
        BEGIN
            EXECUTE format('ALTER %s %I.%I OWNER TO %I',
                           CASE rec.relkind WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END,
                           rec.nspname, rec.relname, rec.eigentuemer);
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE WARNING '0141: Eigentuemer von %.% nicht zurueckgesetzt (war %, jetzt %)',
                          rec.nspname, rec.relname, rec.eigentuemer, current_user;
        END;
    END LOOP;
END $$;


-- ---------------------------------------------------------------------
-- 5. mart.kassenblatt_stand — was fehlt, je Betrieb und Monat
--
-- Diese Sicht ist zugleich die Einreihbedingung des Importers
-- (kassenblattNachfuellen in src/sync/nachfuellen.ts) UND die Pruefsicht.
-- Eine Bedingung an zwei Orten ist eine, die irgendwann auseinanderlaeuft —
-- am 12.08.2026 fror genau so das Belegarchiv ein (AGENTS.md Regel 10).
--
-- Zustaende:
--   lina-kasse        LINAs Konzernbericht fuehrt den Monat, und er trifft
--                     "Die letzten Jahre" (1 % / 1 EUR) — nichts zu tun
--   abweichung        beide fuehren Umsatz, sie weichen ab: Kassenwechsel im
--                     Monat oder ein Datenproblem. Wird NICHT automatisch
--                     gefuellt — Kassenblatt und Kasse mischen sich nicht.
--   geladen           Kassenblatt-Tage stehen und treffen den Monatswert
--   geladen, juenger  Kassenblatt-Tage stehen, weichen ab, sind aber NACH
--                     dem Monatswert geholt — der Monatswert ist der alte
--                     (nachgetragene Tage). Kein Neuabruf, bis ein neuer
--                     Monatswert kommt.
--   faellig           Monatswert > 0, LINA-Kasse leer, Kassenblatt fehlt oder
--                     ist aelter als der Monatswert und weicht ab
--   vor Historie      vor HISTORIE_AB (Entscheidung 28.10.2026) — wird
--                     nicht geholt
-- ---------------------------------------------------------------------

CREATE VIEW mart.kassenblatt_stand AS
WITH historie AS (
    -- Beginn der Konzernhistorie. Aus den Daten, nicht als Konstante: steht
    -- HISTORIE_AB einmal anders, zieht die Sicht mit. UEBER ALLE QUELLEN: die
    -- erste Fassung nahm nur quelle = 'umsatzbericht' — dann verschob jeder
    -- mit Kassenblatt ueberschriebene Monat die Grenze nach vorn, und der
    -- gerade geladene Monat galt als "vor Historie" (am Durchstich-Test
    -- aufgefallen). Kassenblatt-Zeilen entstehen nur ab dieser Grenze, sie
    -- koennen sie also nicht nach hinten ziehen.
    SELECT min(geschaeftstag) AS ab
      FROM core.umsatzbericht_tag
), je_monat AS (
    SELECT u.betrieb_key,
           date_trunc('month', u.geschaeftstag)::date AS monat,
           sum(u.umsatz_netto) FILTER (WHERE u.quelle = 'umsatzbericht') AS umsatz_lina,
           sum(u.umsatz_netto) FILTER (WHERE u.quelle = 'kassenblatt')   AS umsatz_kassenblatt,
           count(*)            FILTER (WHERE u.quelle = 'kassenblatt')   AS tage_kassenblatt,
           max(u.geladen_am)   FILTER (WHERE u.quelle = 'kassenblatt')   AS kassenblatt_geladen_am
      FROM core.umsatzbericht_tag u
     WHERE u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
       AND u.betrieb_key IN (SELECT betrieb_key FROM core.kassenblatt_monat)
     GROUP BY 1, 2
)
SELECT km.betrieb_key,
       b.name                                  AS betrieb,
       kz.hauptkonzept                         AS konzept,
       km.monat,
       km.umsatz_netto                         AS jahresuebersicht,
       coalesce(j.umsatz_lina, 0)              AS umsatz_lina,
       j.umsatz_kassenblatt,
       coalesce(j.tage_kassenblatt, 0)         AS tage_kassenblatt,
       km.abgerufen_am                         AS jahresuebersicht_abgerufen_am,
       j.kassenblatt_geladen_am,
       CASE
         WHEN km.monat < date_trunc('month', h.ab)::date                         THEN 'vor Historie'
         WHEN coalesce(j.umsatz_lina, 0) <> 0
              AND abs(j.umsatz_lina - km.umsatz_netto)
                  <= greatest(1, 0.01 * abs(km.umsatz_netto))                     THEN 'lina-kasse'
         WHEN coalesce(j.umsatz_lina, 0) <> 0                                     THEN 'abweichung'
         WHEN km.umsatz_netto = 0 AND coalesce(j.tage_kassenblatt, 0) = 0         THEN 'kein Umsatz'
         WHEN j.tage_kassenblatt > 0
              AND abs(j.umsatz_kassenblatt - km.umsatz_netto) <= 1                THEN 'geladen'
         WHEN j.tage_kassenblatt > 0
              AND j.kassenblatt_geladen_am > km.abgerufen_am                      THEN 'geladen, juenger'
         ELSE 'faellig'
       END                                     AS zustand
  FROM core.kassenblatt_monat km
  JOIN core.betrieb b                 ON b.betrieb_key = km.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = km.betrieb_key
  LEFT JOIN je_monat j                ON j.betrieb_key = km.betrieb_key AND j.monat = km.monat
 CROSS JOIN historie h;

COMMENT ON VIEW mart.kassenblatt_stand IS
'Betrieb x Monat: Monatswert aus "Die letzten Jahre" gegen LINAs Kasse und gegen geladene '
'Kassenblatt-Tage (0141). Zugleich die Einreihbedingung des Importers. ERWARTUNG: keine Zeile '
'"faellig", die aelter als zwei Naechte ist. "abweichung" heisst: Kasse und Kassenblatt fuehren '
'beide Umsatz und treffen sich nicht — Kassenwechsel im Monat oder ein Datenproblem, wird nicht '
'automatisch gefuellt.';

CREATE INDEX ON core.umsatzbericht_tag (betrieb_key, geschaeftstag) WHERE quelle = 'kassenblatt';


-- ---------------------------------------------------------------------
-- 5a. mart.datenstand: der Befund 'Kassenblatt' und die Umsatzquelle
--
-- Mit Kassenblatt-Tagen hat ein Fremdkassen-Betrieb Umsatz, also einen
-- letzten Umsatztag, also den Status 'operativ' — und fiel damit aus dem
-- Zweig 'fremde Kasse' (0125) in 'keine Artikeldaten', das dringendste
-- Problem eines Betriebs, bei dem es nie Artikeldaten geben kann. Am Klon
-- nachgemessen (28.10.2026, Bremen mit 70 simulierten Tagen).
--
-- Die Reihenfolge bleibt: 'Umsatz veraltet' kommt VOR 'Kassenblatt', denn
-- ein Kassenblatt, das acht Tage nicht gepflegt wurde, ist genau die
-- Meldung, die jemand lesen soll. Dazu die Spalte umsatz_quelle (angehaengt:
-- CREATE OR REPLACE VIEW kann nur anhaengen), damit eine Auswertung die
-- Betriebe ohne Bons und Gaeste ausnehmen kann, auch wo keine quelle-Spalte
-- mitlaeuft (mart.umsatz_ytd). Definition aus der Zieldatenbank, drei
-- Textstellen mit fester Anzahl — wie in Abschnitt 4.
-- ---------------------------------------------------------------------

CREATE FUNCTION pg_temp.einsetzen(p_def text, p_alt text, p_neu text, p_name text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_anz integer := (length(p_def) - length(replace(p_def, p_alt, ''))) / length(p_alt);
BEGIN
    IF v_anz <> 1 THEN
        RAISE EXCEPTION '0141: in % steht "%" %-mal, erwartet einmal — Definition hat sich geaendert, '
                        'bitte von Hand pruefen', p_name, p_alt, v_anz;
    END IF;
    RETURN replace(p_def, p_alt, p_neu);
END $$;

DO $$
DECLARE
    v_def text := pg_get_viewdef('mart.datenstand'::regclass);
BEGIN
    v_def := pg_temp.einsetzen(v_def,
        'LIMIT 1) AS letzter_geladener_tag) u',
        'LIMIT 1) AS letzter_geladener_tag, '
        || '(SELECT t.quelle FROM core.umsatzbericht_tag t '
        || ' WHERE t.betrieb_key = b.betrieb_key AND t.hauptsparte_key IS NULL '
        || '   AND t.verkaufsstelle_key IS NULL AND t.umsatz_netto > 0::numeric '
        || ' ORDER BY t.geschaeftstag DESC LIMIT 1) AS letzte_quelle) u',
        'mart.datenstand');
    v_def := pg_temp.einsetzen(v_def,
        'WHEN (COALESCE(a.artikeltage, 0) = 0) THEN ''keine Artikeldaten''::text',
        'WHEN (u.letzte_quelle = ''kassenblatt''::text) THEN ''Kassenblatt''::text '
        || 'WHEN (COALESCE(a.artikeltage, 0) = 0) THEN ''keine Artikeldaten''::text',
        'mart.datenstand');
    v_def := pg_temp.einsetzen(v_def,
        'AS rezepte_zutaten_seit',
        'AS rezepte_zutaten_seit, u.letzte_quelle AS umsatz_quelle',
        'mart.datenstand');
    EXECUTE 'CREATE OR REPLACE VIEW mart.datenstand AS ' || rtrim(rtrim(v_def), ';');

    EXECUTE format('COMMENT ON VIEW mart.datenstand IS %L',
        pg_temp.einsetzen(obj_description('mart.datenstand'::regclass, 'pg_class'),
            'keine BWA gebucht > keine Artikeldaten > vollstaendig.',
            'keine BWA gebucht > Kassenblatt (Umsatz von Hand aus LINAs Kassenblatt, fremde '
            || 'Kasse: Artikel, Bons und Gaeste kann es nicht geben, 0141) > keine Artikeldaten '
            || '> vollstaendig.',
            'Kommentar mart.datenstand'));
END $$;

COMMENT ON COLUMN mart.datenstand.umsatz_quelle IS
'Quelle des letzten Umsatztags: umsatzbericht = LINAs Kasse, kassenblatt = von Hand eingetragen '
'(fremde Kasse, 0141). Bei kassenblatt gibt es fuer den Betrieb keine Rechnungen, Gaeste, Bons und '
'Artikel — bei Gruppenwerten solcher Kennzahlen diese Betriebe ausnehmen. NULL = kein Umsatz geladen.';


-- ---------------------------------------------------------------------
-- 6. MCP-Katalog
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.kassenblatt_stand',
     'Betrieb × Monat — Monatswert aus LINAs Jahresuebersicht gegen Kasse und Kassenblatt (0141)',
     'import', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

-- Regelart spalte_verwendet ist neu in mcp/src/pruefen.ts (0141). Ohne die
-- Umsetzung dort startet der Server nicht (AGENTS.md, mcp/ Regel 1).
INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle) VALUES
  ('kassenblatt_ohne_bons', 'spalte_verwendet', 'warnung', 'mart.umsatz_tag',
   '{"spalten":["rechnungen","gaeste","durchschnittsbon","umsatz_pro_gast","umsatz_brutto"]}',
   'Betriebe mit fremder Kasse (quelle = ''kassenblatt'') melden nur den Nettoumsatz je Tag. '
   'Brutto, Rechnungen, Gaeste und Bons sind dort NULL — ein Durchschnittsbon oder eine '
   'Gaestezahl "der Gruppe" enthaelt diese Betriebe nicht, ihr Umsatz aber schon.',
   'Fuer Bon- und Gaestekennzahlen auf quelle = ''umsatzbericht'' einschraenken, damit Zaehler '
   'und Nenner dieselben Betriebe meinen.',
   '0141'),
  -- Dieselbe Falle eine Stufe hoeher: mart.umsatz_ytd summiert je Monat und
  -- fuehrt keine quelle-Spalte. Dort zeigt ein Kassenblatt-Betrieb 0 Gaeste
  -- bei vollem Umsatz (am Klon: Bremen, gaeste_abdeckung_pct 0,0).
  ('kassenblatt_ohne_bons_ytd', 'spalte_verwendet', 'warnung', 'mart.umsatz_ytd',
   '{"spalten":["rechnungen","gaeste","bon_schnitt","umsatz_pro_gast","tage_mit_gaesten","gaeste_abdeckung_pct"]}',
   'Betriebe mit fremder Kasse melden nur den Nettoumsatz (Kassenblatt, 0141). Rechnungen und '
   'Gaeste fehlen dort, bon_schnitt und umsatz_pro_gast sind NULL, gaeste_abdeckung_pct ist 0 — '
   'nicht, weil niemand gezaehlt hat, sondern weil es dort keine Kasse an LINA gibt.',
   'Diese Betriebe bei Bon- und Gaestekennzahlen ausnehmen: mart.datenstand.umsatz_quelle = '
   '''kassenblatt'' nennt sie. Der Umsatz selbst ist vollwertig.',
   '0141')
ON CONFLICT (schluessel) DO UPDATE
   SET art = excluded.art, schwere = excluded.schwere, sicht = excluded.sicht,
       parameter = excluded.parameter, hinweis = excluded.hinweis,
       berichtigung = excluded.berichtigung, quelle = excluded.quelle;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

SELECT mcp.rechte_auffrischen();

DO $probe$
DECLARE
    v_sicht  text;
    v_liegen text[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0141 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0141 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_sicht IN ARRAY ARRAY[
        'SELECT * FROM mart.kassenblatt_stand LIMIT 1',
        'SELECT befund, umsatz_quelle FROM mart.datenstand LIMIT 1',
        'SELECT * FROM mart.gaeste_abdeckung LIMIT 1',
        'SELECT quelle FROM mart.umsatz_tag WHERE geschaeftstag >= current_date - 1 LIMIT 1',
        'SELECT quelle FROM mart.umsatz_tag_sparte WHERE geschaeftstag >= current_date - 1 LIMIT 1',
        'SELECT * FROM mart.betriebsbericht_ladestand LIMIT 1',
        'SELECT * FROM mart.betriebsbericht_ladestand_monat LIMIT 1',
        'SELECT * FROM mart.luecke_monat LIMIT 1',
        'SELECT * FROM mart.pruefung_uebersicht LIMIT 1']
    LOOP
        BEGIN
            EXECUTE v_sicht;
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_sicht, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0141 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
