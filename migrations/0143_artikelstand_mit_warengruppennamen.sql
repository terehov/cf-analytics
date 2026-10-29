-- =====================================================================
-- 0143 — Die Warengruppennamen stehen in mart.artikel_stand_monat_basis.
--
-- NACHGEMESSEN in Produktion direkt nach dem Deploy von 0142 (29.10.2026):
--   WE-Quote Enchilada ohne Betrieb 39, 08.07.2025–26.10.2026   22,3 s → 11,0 s
--   Zeilen Enchilada, warengruppe = 'Taco-AF', ab 02.06.2025    18,1 s
-- Der zweite Fall zeigte den Rest des Problems. Der Planer schaetzt den
-- Markenfilter ueber mart.konzept_zuordnung auf EINEN Betrieb (tatsaechlich
-- 22) und die Tageszeilen auf 19.539 statt 1.489.542. Er waehlt deshalb ueberall
-- verschachtelte Schleifen. 'Taco-AF' steht zweimal in core.warengruppe; er
-- setzt die Warengruppe nach aussen und rechnet die ganze Innenseite zweimal
-- (loops=2, 14,7 Mio. Puffer).
--
-- Mit den Namen in der Materialisierung entfallen die drei Joins auf
-- core.warengruppe, und ein Filter auf warengruppe ist ein Spaltenvergleich
-- an der Zeile — nichts mehr, was der Planer nach aussen ziehen kann.
-- Die Schaetzung selbst repariert das nicht; sie sitzt in
-- mart.konzept_zuordnung und betrifft jede Sicht, die nach Marke filtert.
--
-- Der Rueckfall (laufender Monat, fehlendes Paar) holt die Namen ueber
-- skalare Unterabfragen, die nur laufen, wenn keine Zeile da ist (CASE).
--
-- REIHENFOLGE: neue Materialisierung unter einem Hilfsnamen, Sicht umhaengen,
-- alte loeschen, umbenennen. Die Sicht haengt am Objekt, nicht am Namen —
-- ein DROP ... CASCADE der alten haette mart.artikelverkauf und alles
-- darueber mitgerissen.
-- =====================================================================

CREATE MATERIALIZED VIEW mart.artikel_stand_monat_neu AS
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
       g.name  AS grosskategorie,
       mg.name AS warengruppe,
       d.name  AS detailkategorie
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
         LIMIT 1) aw ON true
  LEFT JOIN core.warengruppe g  ON g.warengruppe_key  = aw.gross_key
  LEFT JOIN core.warengruppe mg ON mg.warengruppe_key = aw.mec_key
  LEFT JOIN core.warengruppe d  ON d.warengruppe_key  = aw.detail_key;

CREATE UNIQUE INDEX artikel_stand_monat_neu_zeile
    ON mart.artikel_stand_monat_neu (artikel_key, monat);


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
       CASE WHEN sm.artikel_key IS NOT NULL THEN sm.grosskategorie
            ELSE (SELECT g.name FROM core.warengruppe g WHERE g.warengruppe_key = aw.gross_key)
       END AS grosskategorie,
       CASE WHEN sm.artikel_key IS NOT NULL THEN sm.warengruppe
            ELSE (SELECT mg.name FROM core.warengruppe mg WHERE mg.warengruppe_key = aw.mec_key)
       END AS warengruppe,
       CASE WHEN sm.artikel_key IS NOT NULL THEN sm.detailkategorie
            ELSE (SELECT d.name FROM core.warengruppe d WHERE d.warengruppe_key = aw.detail_key)
       END AS detailkategorie,
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
  LEFT JOIN mart.artikel_stand_monat_neu sm
         ON sm.artikel_key = av.artikel_key
        AND sm.monat = date_trunc('month', av.geschaeftstag::timestamp with time zone)::date
  -- Rueckfall wie in 0142: One-Time Filter auf sm, ohne Treffer nie ausgefuehrt.
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
         LIMIT 1) aw ON true;


DROP MATERIALIZED VIEW mart.artikel_stand_monat_basis;
ALTER MATERIALIZED VIEW mart.artikel_stand_monat_neu RENAME TO artikel_stand_monat_basis;
ALTER INDEX mart.artikel_stand_monat_neu_zeile RENAME TO artikel_stand_monat_basis_zeile;

COMMENT ON MATERIALIZED VIEW mart.artikel_stand_monat_basis IS
'Artikelstand (Name, fixer_we) und Warengruppe (mit Namen, seit 0143) je Artikel und
Monat — die Zwischenstufe von mart.artikelverkauf (Migration 0142). Fuehrt nur Monate VOR
dem laufenden; den laufenden schlaegt die Sicht live nach. Aufgefrischt im
Round-Table-Nachlauf (src/sync/round_table.ts). NICHT direkt abfragen —
mart.artikelverkauf ist die Schnittstelle.';


-- Rechte und Katalog: das DROP hat beides fuer den alten Namen geloescht
-- bzw. die Spalten veraltet. mcp.sicht behaelt die Zeile (Schluessel ist
-- der Name), achsen_ableiten() zieht die Spalten nach.
SELECT mcp.rechte_auffrischen();
SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht SET
    koernung = 'Artikel und Monat (Zwischenstufe von mart.artikelverkauf, ohne den laufenden Monat)',
    thema    = 'umsatz',
    summen_erlaubt = false
 WHERE sicht = 'mart.artikel_stand_monat_basis';

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();


-- Gegenprobe als Leserolle (Vorbild 0111)
DO $probe$
DECLARE
    v_sicht  text;
    v_liegen text[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0143 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0143 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_sicht IN ARRAY ARRAY[
        'mart.artikelverkauf', 'mart.artikel_stand_monat_basis', 'mart.artikel_monat']
    LOOP
        BEGIN
            EXECUTE format('SELECT * FROM %s LIMIT 1', v_sicht);
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_sicht, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0143 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
