-- =====================================================================
-- 0112 Verkaufsstellen im Umsatzbericht — Meilenstein M0 aus
--      docs/plan-lina-vollabzug.md (22.09.2026)
--
-- DER BEFUND. core.umsatzbericht_tag.verkaufsstelle_key steht seit 0003
-- im Schema, wird von einem Dutzend mart-Sichten mitgefuehrt
-- (WHERE ... AND verkaufsstelle_key IS NULL) und war NIE gefuellt: kein
-- Registereintrag sendete den Parameter verkaufsstellen, und
-- src/sync/laden.ts schrieb fest null. kennzahlen-mapping.md Zeile 68
-- fuehrte "Umsatz pro Verkaufsstelle" trotzdem als erledigt.
--
-- WAS SICH AENDERT. Sieben neue Registereintraege
-- (getUmsatzbericht:vs_*), je Verkaufsstelle einer — dieselbe Bauart wie
-- die zehn Hauptsparten aus 0077. Ab jetzt stehen in core.umsatzbericht_tag
-- je Betrieb und Tag bis zu drei Arten Zeilen:
--
--   hauptsparte_key  verkaufsstelle_key  Bedeutung
--   NULL             NULL                Gesamtzeile (ungefiltert)
--   gesetzt          NULL                eine Hauptsparte
--   NULL             gesetzt             eine Verkaufsstelle          <- neu
--
-- Die Kombination (beide gesetzt) holt niemand.
--
-- 1. EINE SICHT HAETTE DOPPELT GEZAEHLT, UND SIE WIRD HIER REPARIERT.
--    Am 22.09.2026 alle Sichten und Materialisierungen ueber
--    core.umsatzbericht_tag geprueft (pg_views/pg_matviews, lokaler Klon
--    auf Stand 0111): alle filtern verkaufsstelle_key IS NULL, ausser
--      mart.betrieb_ohne_yext, mart.bounti_ohne_betrieb  — nur EXISTS auf
--          "hat Umsatz", eine Verkaufsstellenzeile aendert daran nichts;
--      mart.hauptsparte_abdeckung — nahm fuer den Gesamtumsatz
--          "hauptsparte_key IS NULL" und haette damit jede
--          Verkaufsstellenzeile als zweiten Gesamtumsatz mitgezaehlt.
--    Die Karte in metabase/karten-portfolio.ts filtert beide Schluessel
--    bereits. mcp/src/pruefen.ts warnt vor genau dieser Tabelle.
--
-- 2. DER PARAMETER IST UNGEPRUEFT. Laut lina-api-inventar.md §3.1 erwartet
--    verkaufsstellen die number aus analyticsFilterOptions — "aus den
--    Vue-Bundles extrahiert", nie gegen eine Antwort gemessen. Bei den
--    Hauptsparten war die naheliegende Lesart falsch, und die falsche
--    lieferte kommentarlos 0 EUR. mart.verkaufsstelle_abdeckung ist die
--    Gegenprobe: die Summe der Stellen muss den Gesamtumsatz treffen
--    (gemessen an Bericht 112 fuer Wilma Wunder Duesseldorf, August 2026:
--    Gesamtbetrieb 367.091,59 + Ausser Haus 2.749,50 = 369.841,09 = Gesamt).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. mart.hauptsparte_abdeckung: die Gesamtzeile ist die mit BEIDEN
--    Schluesseln NULL. Spaltenliste unveraendert, Kommentar bleibt.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.hauptsparte_abdeckung AS
 WITH gesamt AS (
         SELECT u.geschaeftstag,
            date_trunc('month'::text, u.geschaeftstag::timestamp with time zone)::date AS monat,
            sum(u.umsatz_netto) AS umsatz_gesamt
           FROM core.umsatzbericht_tag u
          WHERE u.hauptsparte_key IS NULL
            -- seit 0112: sonst zaehlte jede Verkaufsstellenzeile als zweiter
            -- Gesamtumsatz
            AND u.verkaufsstelle_key IS NULL
          GROUP BY u.geschaeftstag, (date_trunc('month'::text, u.geschaeftstag::timestamp with time zone)::date)
        ), je_sparte AS (
         SELECT date_trunc('month'::text, u.geschaeftstag::timestamp with time zone)::date AS monat,
            sum(u.umsatz_netto) AS umsatz_sparten,
            count(DISTINCT u.hauptsparte_key) AS sparten_mit_umsatz
           FROM core.umsatzbericht_tag u
          WHERE u.hauptsparte_key IS NOT NULL
            AND u.verkaufsstelle_key IS NULL
          GROUP BY (date_trunc('month'::text, u.geschaeftstag::timestamp with time zone)::date)
        )
 SELECT g.monat,
    round(sum(g.umsatz_gesamt), 2) AS umsatz_gesamt,
    round(COALESCE(s.umsatz_sparten, 0::numeric), 2) AS umsatz_sparten,
    round(sum(g.umsatz_gesamt) - COALESCE(s.umsatz_sparten, 0::numeric), 2) AS nicht_aufteilbar,
        CASE
            WHEN sum(g.umsatz_gesamt) > 0::numeric THEN round(100::numeric * (sum(g.umsatz_gesamt) - COALESCE(s.umsatz_sparten, 0::numeric)) / sum(g.umsatz_gesamt), 2)
            ELSE NULL::numeric
        END AS nicht_aufteilbar_pct,
    COALESCE(s.sparten_mit_umsatz, 0::bigint) AS sparten_mit_umsatz,
    ( SELECT count(*) AS count
           FROM core.hauptsparte) AS sparten_bekannt
   FROM gesamt g
     LEFT JOIN je_sparte s ON s.monat = g.monat
  GROUP BY g.monat, s.umsatz_sparten, s.sparten_mit_umsatz
  ORDER BY g.monat DESC;


-- ---------------------------------------------------------------------
-- 2. Die Gegenprobe zum ungeprueften Parameter
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.verkaufsstelle_abdeckung AS
WITH gesamt AS (
    SELECT date_trunc('month', u.geschaeftstag)::date AS monat,
           u.betrieb_key, u.geschaeftstag, u.umsatz_netto
      FROM core.umsatzbericht_tag u
     WHERE u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
), je_stelle AS (
    SELECT date_trunc('month', u.geschaeftstag)::date AS monat,
           u.betrieb_key, u.geschaeftstag,
           sum(u.umsatz_netto)                  AS umsatz_stellen,
           count(DISTINCT u.verkaufsstelle_key) AS stellen
      FROM core.umsatzbericht_tag u
     WHERE u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NOT NULL
     GROUP BY 1, 2, 3
)
-- Nur Tage, fuer die ueberhaupt Verkaufsstellenzeilen geholt wurden: vor dem
-- Backfill ist "keine Stellenzeile" kein Befund, sondern noch nicht geholt.
SELECT s.monat,
       count(DISTINCT s.geschaeftstag)          AS tage_mit_stellen,
       count(*)                                 AS betrieb_tage,
       round(sum(g.umsatz_netto), 2)            AS umsatz_gesamt,
       round(sum(s.umsatz_stellen), 2)          AS umsatz_stellen,
       CASE WHEN sum(g.umsatz_netto) <> 0
            THEN round(100 * sum(s.umsatz_stellen) / sum(g.umsatz_netto), 2) END
                                                AS abdeckung_pct,
       max(s.stellen)                           AS stellen_mit_umsatz_max,
       CASE
         WHEN sum(g.umsatz_netto) IS NULL OR sum(g.umsatz_netto) = 0 THEN 'kein Gesamtumsatz'
         WHEN sum(s.umsatz_stellen) = 0 THEN 'Filter liefert 0 EUR — Parameterformat pruefen'
         WHEN sum(s.umsatz_stellen) > 1.5 * sum(g.umsatz_netto)
              THEN 'Summe weit ueber Gesamt — LINA ignoriert den Filter'
         WHEN abs(sum(s.umsatz_stellen) - sum(g.umsatz_netto)) <= 0.01 * abs(sum(g.umsatz_netto))
              THEN 'ok'
         ELSE 'weicht ab'
       END                                      AS zustand
  FROM je_stelle s
  LEFT JOIN gesamt g USING (monat, betrieb_key, geschaeftstag)
 GROUP BY s.monat
 ORDER BY s.monat DESC;

COMMENT ON VIEW mart.verkaufsstelle_abdeckung IS
'Koernung: ein Monat. Trifft die Summe der Verkaufsstellen den Gesamtumsatz?

Der Parameter verkaufsstellen des Umsatzberichts ist UNGEPRUEFT (seit 0112 geholt,
Format laut Vue-Bundle die number aus analyticsFilterOptions). Bei den Hauptsparten
lieferte das falsche Format kommentarlos 0 EUR. Diese Sicht faengt beide Fehlbilder:
abdeckung_pct = 0 heisst falsches Format, deutlich ueber 100 heisst, LINA ignoriert den
Filter und jede Stelle traegt den Gesamtumsatz.

ERWARTUNG: zustand = ok, abdeckung_pct nahe 100. Gemessen an Bericht 112 (Wilma Wunder
Duesseldorf, August 2026): Gesamtbetrieb 367.091,59 + Ausser Haus 2.749,50 = 369.841,09 EUR
brutto = Gesamtumsatz. Gezaehlt werden nur Tage, fuer die Stellenzeilen geholt wurden.';


-- ---------------------------------------------------------------------
-- 3. Pruefzeile — angehaengt, nicht abgeschrieben (Verfahren wie 0109/0110)
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%verkaufsstelle_abdeckung%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        -- ERWARTUNG: 0. Ein Monat, in dem die Summe der Verkaufsstellen den
        -- Gesamtumsatz nicht trifft, heisst meist: der Parameter wirkt nicht so,
        -- wie das Register annimmt (0112, ungeprueft).
        SELECT 'Verkaufsstellen: Summe trifft den Gesamtumsatz nicht (Monate)'::text AS pruefung,
               (SELECT count(*) FROM mart.verkaufsstelle_abdeckung)::bigint AS geprueft,
               (SELECT count(*) FROM mart.verkaufsstelle_abdeckung
                 WHERE zustand NOT IN ('ok', 'kein Gesamtumsatz'))::bigint AS auffaellig,
               'mart.verkaufsstelle_abdeckung'::text AS sicht
        $zweig$);
END $aussen$;


-- ---------------------------------------------------------------------
-- 4. Katalog und Leserolle (Pflicht seit 0110 fuer jede neue mart-Sicht)
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht SET
    koernung = 'ein Monat — Summe der Verkaufsstellen gegen den Gesamtumsatz; ERWARTUNG: zustand ok',
    thema    = 'import'
 WHERE sicht = 'mart.verkaufsstelle_abdeckung';

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

SELECT mcp.rechte_auffrischen();
