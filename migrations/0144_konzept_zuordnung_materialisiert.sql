-- =====================================================================
-- 0144 — Betrieb → Marke als Tabelle mit Statistik.
--
-- ANLASS (29.10.2026, beim Nachmessen von 0142/0143 in Produktion): Jede
-- Abfrage mit `konzept = 'Enchilada'` laeuft ueber mart.konzept_zuordnung,
-- und dort steht der Hauptkonzept-Join auf einem Ausdruck:
--
--   kh.konzept_key = COALESCE(m.konzept_key, CASE WHEN z.anzahl_konzepte = 1
--                                                 THEN z.einziges_konzept END)
--
-- Fuer einen Ausdruck hat Postgres keine Spaltenstatistik. Der Planer schaetzt
-- den Markenfilter deshalb auf EINEN Betrieb (tatsaechlich 22) und die
-- Tageszeilen von mart.artikelverkauf auf 19.539 statt 1.489.542 — und waehlt
-- ueberall verschachtelte Schleifen mit einer Indexsuche je Zeile, wo ein
-- Hash-Join richtig waere. Das traf 50 Sichten, die auf konzept_zuordnung
-- joinen, und blieb nach 0143 der Rest der Laufzeit (7,6 s fuer 1,3 Mio.
-- Zeilen). Entscheidung Eugene: bauen, weil oft nach Marke gefiltert wird.
--
-- WAS SICH AENDERT: mart.konzept_zuordnung bleibt eine Sicht mit denselben
-- acht Spalten — kein Abnehmer muss angefasst werden —, liest aber aus
-- mart.konzept_zuordnung_basis, einer Materialisierung mit 141 Zeilen und
-- echter Statistik auf `hauptkonzept`. Wer `konzept = 'Enchilada'` sagt,
-- bekommt ab hier 22 geschaetzt.
--
-- DER PREIS, ehrlich genannt: Betriebe, Konzepte und die Hauptkonzept-
-- Entscheidung (manual.betrieb_hauptkonzept) kommen erst mit dem naechsten
-- Refresh in den Sichten an. Er laeuft als ERSTER Nachlauf in Phase B
-- (src/sync/konzept_zuordnung.ts), vor allem, was auf betrieb_key rechnet.
-- Ein neuer Betrieb aus Phase A ist damit in derselben Nacht drin; eine
-- Entscheidung in Postico wird bis zum naechsten Lauf nicht gesehen — oder
-- sofort mit `REFRESH MATERIALIZED VIEW CONCURRENTLY mart.konzept_zuordnung_basis`.
-- Phase A liest die Sicht nicht (laden.ts nennt sie nur im Kommentar).
-- =====================================================================

CREATE MATERIALIZED VIEW mart.konzept_zuordnung_basis AS
WITH zaehlung AS (
  SELECT bk.betrieb_key,
         count(*)::integer                              AS anzahl_konzepte,
         min(bk.konzept_key)                            AS einziges_konzept,
         string_agg(k.name, ', ' ORDER BY k.name)       AS konzepte
    FROM core.betrieb_konzept bk
    JOIN core.konzept k ON k.konzept_key = bk.konzept_key
   GROUP BY bk.betrieb_key
)
SELECT b.betrieb_key,
       b.name                               AS betrieb,
       b.stadt,
       b.aktiv,
       COALESCE(z.anzahl_konzepte, 0)       AS anzahl_konzepte,
       z.konzepte,
       kh.name                              AS hauptkonzept,
       CASE WHEN m.betrieb_key IS NOT NULL           THEN 'manuell gesetzt'
            WHEN z.anzahl_konzepte = 1               THEN 'aus LINA eindeutig'
            WHEN COALESCE(z.anzahl_konzepte, 0) = 0  THEN 'LINA kennt kein Konzept'
            ELSE 'mehrdeutig - Entscheidung fehlt'
       END                                  AS herkunft
  FROM core.betrieb b
  LEFT JOIN zaehlung z ON z.betrieb_key = b.betrieb_key
  LEFT JOIN manual.betrieb_hauptkonzept m ON m.betrieb_key = b.betrieb_key
  LEFT JOIN core.konzept kh
         ON kh.konzept_key = COALESCE(m.konzept_key,
                                      CASE WHEN z.anzahl_konzepte = 1 THEN z.einziges_konzept END);

CREATE UNIQUE INDEX konzept_zuordnung_basis_betrieb
    ON mart.konzept_zuordnung_basis (betrieb_key);
-- Der Filter, um den es geht.
CREATE INDEX konzept_zuordnung_basis_hauptkonzept
    ON mart.konzept_zuordnung_basis (hauptkonzept);

-- Die Statistik IST der Zweck dieser Migration. REFRESH schreibt sie nicht;
-- der Nachlauf ruft ANALYZE nach jedem Refresh, hier einmal von Hand.
ANALYZE mart.konzept_zuordnung_basis;

COMMENT ON MATERIALIZED VIEW mart.konzept_zuordnung_basis IS
'Betrieb → Hauptkonzept als Tabelle (Migration 0144): dieselbe Rechnung wie
mart.konzept_zuordnung, materialisiert, damit der Planer eine Statistik auf
hauptkonzept hat — vorher schaetzte er jeden Markenfilter auf einen Betrieb.
Aufgefrischt als erster Nachlauf in Phase B (src/sync/konzept_zuordnung.ts).
NICHT direkt abfragen — mart.konzept_zuordnung ist die Schnittstelle.';


-- Dieselben acht Spalten in derselben Reihenfolge mit denselben Typen —
-- sonst scheitert CREATE OR REPLACE, und die 50 abhaengigen Sichten
-- bleiben stehen.
CREATE OR REPLACE VIEW mart.konzept_zuordnung AS
SELECT betrieb_key, betrieb, stadt, aktiv, anzahl_konzepte, konzepte,
       hauptkonzept, herkunft
  FROM mart.konzept_zuordnung_basis;


-- ---------------------------------------------------------------------
-- Sichtbar, wenn der Refresh ausbleibt (0091) — angehaengt wie in 0117/0142
-- ---------------------------------------------------------------------
DO $aussen$
DECLARE
    v_def  text;
    v_neu  text;
BEGIN
    SELECT pg_get_viewdef('mart.materialisierung_stand'::regclass, true) INTO v_def;
    IF v_def LIKE '%konzept_zuordnung_basis%' THEN RETURN; END IF;
    v_neu := regexp_replace(v_def,
        '(''mart\.artikel_stand_monat_basis''::text\s*,\s*''round_table_refresh''::text\s*,\s*''src/sync/round_table\.ts''::text\s*\))',
        '\1, (''mart.konzept_zuordnung_basis''::text, ''konzept_zuordnung_refresh''::text, '
        '''src/sync/konzept_zuordnung.ts''::text)');
    IF v_neu = v_def THEN
        RAISE EXCEPTION '0144: Verankerung in mart.materialisierung_stand nicht gefunden — die Sicht '
                        'wurde umgebaut. mart.konzept_zuordnung_basis von Hand eintragen.';
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW mart.materialisierung_stand AS ' || v_neu;
END $aussen$;


-- Rechte und Katalog
SELECT mcp.rechte_auffrischen();
SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht SET
    koernung = 'Betrieb (Zwischenstufe von mart.konzept_zuordnung, mit Statistik fuer den Planer)',
    thema    = 'stammdaten',
    summen_erlaubt = false
 WHERE sicht = 'mart.konzept_zuordnung_basis';

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();


-- Gegenprobe als Leserolle (Vorbild 0111): die Sicht, die Basis und drei
-- der Abnehmer, die ueber die Marke filtern.
DO $probe$
DECLARE
    v_sicht  text;
    v_liegen text[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0144 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0144 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_sicht IN ARRAY ARRAY[
        'mart.konzept_zuordnung', 'mart.konzept_zuordnung_basis',
        'mart.artikelverkauf', 'mart.umsatz_tag', 'mart.betrieb_status']
    LOOP
        BEGIN
            EXECUTE format('SELECT * FROM %s LIMIT 1', v_sicht);
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_sicht, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0144 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
