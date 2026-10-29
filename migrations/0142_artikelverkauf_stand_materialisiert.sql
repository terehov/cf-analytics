-- =====================================================================
-- 0142 — mart.artikelverkauf schlaegt den Artikelstand nicht mehr je
--        Tageszeile nach.
--
-- ANLASS: Seit dem 26.10.2026 fragen acht MCP-Konten, und die einzigen
-- Abfragen ueber 12 s (drei davon in der 20-s-Grenze, 57014) lasen alle
-- mart.artikelverkauf ueber viele Monate — Wareneinsatz je Artikel fuer
-- eine Marke, Wochenvergleiche Juni–Oktober 2025 gegen 2026, Wochentage.
-- Der Server war dabei zu 96 % frei (sar, 28.10.2026 08:50 UTC). Es war
-- nicht die Maschine, sondern der Plan.
--
-- GEMESSEN in Produktion am 29.10.2026, EXPLAIN ANALYZE fuer "Enchilada
-- ohne Betrieb 39, 08.07.2025–26.10.2026" (1.321.455 Tageszeilen):
--   Lesen der Tageszeilen (alle Partitionen)       2,4 s
--   LATERAL Artikelstand (Name, fixer_we)          8,0 s
--   LATERAL Warengruppenstand                      9,9 s
--   gesamt                                        22,3 s
-- Zwei Indexsuchen je Tageszeile, 13,9 Mio. Puffer. 0124 hatte die
-- lead()-Sichten durch diese LATERALs ersetzt (26,7 s → 0,27 s fuer EINEN
-- Betrieb) — fuer eine ganze Marke ueber ein Jahr reicht das nicht.
--
-- WARUM JE ARTIKEL UND MONAT: beide Standtabellen fuehren nur Monatsanfaenge
-- (core.artikel_stand 591.749 Zeilen, core.artikel_warengruppe_stand
-- 27.066, keine einzige mit einem anderen Tag — nachgezaehlt 29.10.2026).
-- "s.monat <= geschaeftstag" ist damit fuer jeden Tag eines Monats gleich
-- "s.monat <= Monatsanfang". Was die LATERALs je Tag suchen, ist je
-- (Artikel, Monat) eine feste Zeile: 611.423 Paare statt 28,6 Mio. Tage.
--
-- WAS MATERIALISIERT IST UND WAS NICHT
--   * Materialisiert ist NUR die Zuordnung Artikel × Monat → Stand. Die
--     Tageszeilen bleiben live; was der Importer heute schreibt, steht
--     sofort in der Sicht.
--   * Der LAUFENDE Monat steht nicht in der Materialisierung. In ihm kommen
--     taeglich neue Artikel und neue Staende an; er wird weiter live
--     nachgeschlagen (ein Monat kostet wenig).
--   * Fehlt ein Paar (neuer Artikel, Monatswechsel vor dem naechsten
--     Refresh), greifen die alten LATERALs — als Rueckfall, gesperrt ueber
--     "sm.artikel_key IS NULL". Die Sicht liefert damit in JEDEM Fall
--     dieselben Zahlen wie vorher; die Materialisierung entscheidet nur,
--     wie schnell.
--   * Was veralten kann: ein Stand fuer einen VERGANGENEN Monat, den das
--     Nachladen (Phase C) nach dem Refresh einfuegt (src/sync/laden.ts
--     schreibt den Stand mit dem Monat des geladenen Tages). Bis zum
--     naechsten Refresh traegt der Monat dann den vorherigen Namen bzw.
--     fixer_we. Aufgefrischt wird im Round-Table-Nachlauf nach Phase B
--     UND nach Phase C — dieselbe Frist wie mart.artikel_monat_basis.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die Zuordnung je Artikel und Monat
--
-- Die beiden Unterabfragen sind woertlich die aus mart.artikelverkauf
-- (0124), mit dem Monatsanfang an Stelle des Tages.
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mart.artikel_stand_monat_basis AS
WITH paar AS (
  SELECT DISTINCT av.artikel_key,
         date_trunc('month', av.geschaeftstag)::date AS monat
    FROM core.artikelverkauf_tag av
   WHERE av.geschaeftstag < date_trunc('month', current_date)::date
)
SELECT p.artikel_key,
       p.monat,
       az.name,
       az.fixer_we,
       (aw.artikel_key IS NOT NULL) AS warengruppe_vorhanden,
       aw.erfasst_ab,
       aw.gross_key,
       aw.mec_key,
       aw.detail_key
  FROM paar p
  LEFT JOIN LATERAL (
        SELECT s.name, s.fixer_we
          FROM core.artikel_stand s
         WHERE s.artikel_key = p.artikel_key AND s.monat <= p.monat
         ORDER BY s.monat DESC
         LIMIT 1) az ON true
  LEFT JOIN LATERAL (
        SELECT w.artikel_key, w.monat AS erfasst_ab,
               w.gross_key, w.mec_key, w.detail_key
          FROM core.artikel_warengruppe_stand w
         WHERE w.artikel_key = p.artikel_key
         ORDER BY (w.monat <= p.monat) DESC,
                  CASE WHEN w.monat <= p.monat THEN w.monat END DESC,
                  w.monat
         LIMIT 1) aw ON true;

-- Eindeutig fuer REFRESH CONCURRENTLY, und zugleich der Schluessel, ueber
-- den die Sicht joint.
CREATE UNIQUE INDEX artikel_stand_monat_basis_zeile
    ON mart.artikel_stand_monat_basis (artikel_key, monat);

COMMENT ON MATERIALIZED VIEW mart.artikel_stand_monat_basis IS
'Artikelstand (Name, fixer_we) und Warengruppenstand je Artikel und Monat — die
Zwischenstufe von mart.artikelverkauf (Migration 0142). Fuehrt nur Monate VOR dem
laufenden; den laufenden schlaegt die Sicht live nach. Aufgefrischt im
Round-Table-Nachlauf (src/sync/round_table.ts). NICHT direkt abfragen —
mart.artikelverkauf ist die Schnittstelle.';


-- ---------------------------------------------------------------------
-- 2. Die Sicht: Spalten, Reihenfolge und Typen unveraendert
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.artikelverkauf AS
SELECT av.geschaeftstag,
       date_trunc('month', av.geschaeftstag::timestamp with time zone)::date AS monat,
       b.betrieb_key,
       b.name AS betrieb,
       COALESCE(b.stadt, st.ort) AS stadt,
       kz.hauptkonzept AS konzept,
       a.artikel_key,
       a.artikelnummer,
       COALESCE(sm.name, az.name, a.name) AS artikel,
       g.name AS grosskategorie,
       mg.name AS warengruppe,
       d.name AS detailkategorie,
       COALESCE(sm.warengruppe_vorhanden, aw.artikel_key IS NOT NULL)
         AND av.geschaeftstag < COALESCE(sm.erfasst_ab, aw.erfasst_ab) AS warengruppe_geschaetzt,
       av.menge,
       av.umsatz_netto,
       av.umsatz_brutto,
       av.verkaufspreis,
       NULLIF(COALESCE(sm.fixer_we, az.fixer_we), 0::numeric) AS fixer_we,
       round(av.menge * NULLIF(COALESCE(sm.fixer_we, az.fixer_we), 0::numeric), 2) AS wareneinsatz_theoretisch,
       round(av.umsatz_netto - av.menge * NULLIF(COALESCE(sm.fixer_we, az.fixer_we), 0::numeric), 2) AS deckungsbeitrag
  FROM core.artikelverkauf_tag av
  JOIN core.betrieb b ON b.betrieb_key = av.betrieb_key
  JOIN core.artikel a ON a.artikel_key = av.artikel_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = av.betrieb_key
  LEFT JOIN manual.betrieb_standort st ON st.betrieb_key = av.betrieb_key
  LEFT JOIN mart.artikel_stand_monat_basis sm
         ON sm.artikel_key = av.artikel_key
        AND sm.monat = date_trunc('month', av.geschaeftstag::timestamp with time zone)::date
  -- Rueckfall fuer Paare ohne Zeile (laufender Monat, neuer Artikel). Die
  -- Bedingung auf sm haengt nur an der aeusseren Zeile; Postgres prueft sie
  -- als One-Time Filter VOR der Indexsuche — mit Treffer kostet der Zweig nichts.
  LEFT JOIN LATERAL (
        SELECT s.name, s.fixer_we
          FROM core.artikel_stand s
         WHERE sm.artikel_key IS NULL
           AND s.artikel_key = av.artikel_key AND s.monat <= av.geschaeftstag
         ORDER BY s.monat DESC
         LIMIT 1) az ON true
  LEFT JOIN LATERAL (
        SELECT w.artikel_key, w.monat AS erfasst_ab,
               w.gross_key, w.mec_key, w.detail_key
          FROM core.artikel_warengruppe_stand w
         WHERE sm.artikel_key IS NULL
           AND w.artikel_key = av.artikel_key
         ORDER BY (w.monat <= av.geschaeftstag) DESC,
                  CASE WHEN w.monat <= av.geschaeftstag THEN w.monat END DESC,
                  w.monat
         LIMIT 1) aw ON true
  LEFT JOIN core.warengruppe g  ON g.warengruppe_key  = COALESCE(sm.gross_key,  aw.gross_key)
  LEFT JOIN core.warengruppe mg ON mg.warengruppe_key = COALESCE(sm.mec_key,    aw.mec_key)
  LEFT JOIN core.warengruppe d  ON d.warengruppe_key  = COALESCE(sm.detail_key, aw.detail_key);


-- ---------------------------------------------------------------------
-- 3. Sichtbar, wenn der Refresh ausbleibt (0091: jede Materialisierung
--    braucht eine Zeile in mart.materialisierung_stand)
--
-- Angehaengt wie in 0117, nicht abgeschrieben.
-- ---------------------------------------------------------------------
DO $aussen$
DECLARE
    v_def  text;
    v_neu  text;
BEGIN
    SELECT pg_get_viewdef('mart.materialisierung_stand'::regclass, true) INTO v_def;
    IF v_def LIKE '%artikel_stand_monat_basis%' THEN RETURN; END IF;
    v_neu := regexp_replace(v_def,
        '(''mart\.artikeltage_basis''::text\s*,\s*''round_table_refresh''::text\s*,\s*''src/sync/round_table\.ts''::text\s*\))',
        '\1, (''mart.artikel_stand_monat_basis''::text, ''round_table_refresh''::text, '
        '''src/sync/round_table.ts''::text)');
    IF v_neu = v_def THEN
        RAISE EXCEPTION '0142: Verankerung in mart.materialisierung_stand nicht gefunden — die Sicht '
                        'wurde umgebaut. mart.artikel_stand_monat_basis von Hand eintragen.';
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW mart.materialisierung_stand AS ' || v_neu;
END $aussen$;


-- ---------------------------------------------------------------------
-- 4. Rechte und Katalog
--
-- GRANT SELECT ON ALL TABLES (in rechte_auffrischen) deckt
-- Materialisierungen mit ab. Koernung von Hand, damit die Sicht nicht in
-- mcp.koernung_fehlend steht.
-- ---------------------------------------------------------------------
SELECT mcp.rechte_auffrischen();
SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht SET
    koernung = 'Artikel und Monat (Zwischenstufe von mart.artikelverkauf, ohne den laufenden Monat)',
    thema    = 'umsatz',
    summen_erlaubt = false
 WHERE sicht = 'mart.artikel_stand_monat_basis';

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();


-- ---------------------------------------------------------------------
-- 5. Gegenprobe als Leserolle (Vorbild 0111)
-- ---------------------------------------------------------------------
DO $probe$
DECLARE
    v_sicht  text;
    v_liegen text[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0142 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0142 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_sicht IN ARRAY ARRAY[
        'mart.artikelverkauf', 'mart.artikel_stand_monat_basis']
    LOOP
        BEGIN
            EXECUTE format('SELECT * FROM %s LIMIT 1', v_sicht);
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_sicht, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0142 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
