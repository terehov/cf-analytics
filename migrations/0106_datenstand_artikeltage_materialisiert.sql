-- =====================================================================
-- 0106 — Der Datenstand zaehlt die Artikeltage nicht mehr bei jedem Aufruf
--
-- ANLASS: am 15.09.2026 lief das Werkzeug `datenstand` des MCP-Zugangs aus
-- ChatGPT in die Zeitgrenze der Leserolle (20 s). Dieselbe Sicht haengt an
-- JEDER Antwort des Zugangs (Datenstand-Anhang in mcp/src/ausfuehren.ts) —
-- jede Frage wartete also bis zu 20 Sekunden auf eine Nebenauskunft, und die
-- Dashboards mit mart.datenstand zahlten denselben Preis.
--
-- GEMESSEN lokal (Stand 08.08.2026, 27 Mio Artikelzeilen in 108 Partitionen):
-- die Werkzeugabfrage ueber mart.datenstand 10,3 s, davon 10,0 s in der einen
-- LATERAL-Unterabfrage count(DISTINCT geschaeftstag) je Betrieb. Der
-- Primaerschluessel der Partitionen beginnt mit geschaeftstag, nicht mit
-- betrieb_key — jede der 141 Unterabfragen liest alle 108 Partitionen. Ohne
-- die Artikelspalten braucht dieselbe Sicht 0,3 s. Ein GROUP BY ueber die
-- ganze Tabelle kostet 7,3 s und ergibt 79 Zeilen: das gehoert in den
-- Nachtlauf, nicht in jeden Aufruf.
--
-- WAS MATERIALISIERT WIRD UND WAS NICHT. Nur die Artikeltage — sie aendern
-- sich ohnehin nur mit dem Import. Alles, was an current_date haengt
-- (umsatz_alter_tage, bwa_verzug_monate, der Befund "Umsatz veraltet"),
-- bleibt LIVE in der Sicht: sie ist dafuer da, einen ausgefallenen Lauf zu
-- bemerken. Ganz materialisiert, froere nach einer ausgefallenen Nacht genau
-- die Warnung ein, die ihn melden soll.
--
-- SPALTEN UND BEFUND BLEIBEN GLEICH. coalesce(…, 0) ist dabei tragend: die
-- Unterabfrage gab fuer einen Betrieb ohne Artikelzeilen count = 0 zurueck,
-- der LEFT JOIN gibt NULL — ohne coalesce fiele "keine Artikeldaten" still
-- weg.
--
-- Aufgefrischt im Round-Table-Nachlauf (src/sync/round_table.ts), neben
-- mart.artikel_monat_basis, die ebenfalls nur artikelverkauf liest. Eine
-- Datenbank aus einem reinen Schema-Abzug hat die Sicht unbefuellt, bis der
-- erste Nachlauf sie fuellt (sync/auffrischen.ts) — wie die anderen dreizehn.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die Artikeltage je Betrieb
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mart.artikeltage_basis AS
SELECT betrieb_key,
       count(DISTINCT geschaeftstag)::int AS artikeltage,
       max(geschaeftstag)                 AS letzter_artikeltag
  FROM core.artikelverkauf_tag
 GROUP BY betrieb_key;

-- Eindeutig, damit REFRESH ... CONCURRENTLY geht.
CREATE UNIQUE INDEX artikeltage_basis_betrieb_key ON mart.artikeltage_basis (betrieb_key);

COMMENT ON MATERIALIZED VIEW mart.artikeltage_basis IS
'Artikeltage je Betrieb: an wie vielen Geschaeftstagen Artikelverkaeufe vorliegen, und der
letzte davon. Zwischenstufe von mart.datenstand, naechtlich im Round-Table-Nachlauf
aufgefrischt (Migration 0106). Betriebe ohne Artikelzeilen fehlen hier; mart.datenstand
fuehrt sie mit 0.

Koernung: eine Zeile je Betrieb mit Artikelverkaeufen';


-- ---------------------------------------------------------------------
-- 2. mart.datenstand liest sie, statt jedes Mal zu zaehlen
--    (Definition aus 0067; geaendert ist nur die Artikel-Unterabfrage)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.datenstand AS
SELECT b.name          AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       b.aktiv,
       b.hat_bwa,
       (b.lina_betrieb_id IS NOT NULL) AS bwa_bruecke,
       u.erster_tag,
       u.letzter_tag,
       u.tage                          AS umsatztage,
       (current_date - u.letzter_tag)  AS umsatz_alter_tage,
       k.letzter_gebuchter_monat       AS bwa_monat,
       CASE WHEN k.letzter_gebuchter_monat IS NOT NULL
            THEN (date_part('year',  age(date_trunc('month', current_date)::date,
                                          k.letzter_gebuchter_monat)) * 12
                + date_part('month', age(date_trunc('month', current_date)::date,
                                          k.letzter_gebuchter_monat)))::int
       END                             AS bwa_verzug_monate,
       coalesce(a.artikeltage, 0)      AS artikeltage,
       a.letzter_artikeltag,
       p.letzter_personaltag,
       CASE WHEN u.letzter_tag IS NULL                       THEN 'kein Umsatz geladen'
            -- > 8, nicht > 3: LINA fuellt die juengsten 5-6 Tage nach,
            -- ein "veraltet" unterhalb dessen ist Bauart, kein Befund.
            WHEN current_date - u.letzter_tag > 8             THEN 'Umsatz veraltet'
            WHEN k.letzter_gebuchter_monat IS NULL            THEN 'keine BWA gebucht'
            WHEN coalesce(a.artikeltage, 0) = 0               THEN 'keine Artikeldaten'
            ELSE 'vollstaendig'
       END                             AS befund,
       b.betrieb_key
  FROM core.betrieb b
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = b.betrieb_key
  LEFT JOIN LATERAL (
        SELECT min(geschaeftstag) AS erster_tag, max(geschaeftstag) AS letzter_tag,
               count(*)::int      AS tage
          FROM core.umsatzbericht_tag t
         WHERE t.betrieb_key = b.betrieb_key
           AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL
  ) u ON true
  LEFT JOIN LATERAL (
        SELECT max(monat) AS letzter_gebuchter_monat
          FROM mart.kennzahlen_aktuell ka
         WHERE ka.betrieb_key = b.betrieb_key
           AND ka.wert_absolut IS NOT NULL AND ka.wert_absolut <> 0
  ) k ON true
  LEFT JOIN mart.artikeltage_basis a ON a.betrieb_key = b.betrieb_key
  LEFT JOIN LATERAL (
        SELECT max(zeitraum_bis) AS letzter_personaltag
          FROM core.personalkosten pk
         WHERE pk.betrieb_key = b.betrieb_key
  ) p ON true;


-- ---------------------------------------------------------------------
-- 3. Sichtbar machen (0091): ohne Eintrag hier meldet /status die Sicht
--    als "ohne Refresh". Definition aus 0094, eine Zeile mehr.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.materialisierung_stand AS
WITH letzter_lauf AS (
  SELECT max(beendet_am) AS beendet_am
    FROM sync.lauf
   WHERE status IN ('ok', 'teilweise')
), vorhanden AS (
  SELECT (schemaname || '.' || matviewname)::text AS sicht
    FROM pg_matviews
   WHERE schemaname = 'mart'
), zuordnung(sicht, schluessel, nachlauf) AS (
  VALUES
    ('mart.deckungsbeitrag_warengruppe'::text, 'deckungsbeitrag_refresh'::text, 'src/sync/deckungsbeitrag.ts'::text),
    ('mart.round_table_monat',                 'round_table_refresh',           'src/sync/round_table.ts'),
    ('mart.round_table_trend',                 'round_table_refresh',           'src/sync/round_table.ts'),
    ('mart.artikel_monat_basis',               'round_table_refresh',           'src/sync/round_table.ts'),
    -- 0106: die Artikeltage fuer mart.datenstand.
    ('mart.artikeltage_basis',                 'round_table_refresh',           'src/sync/round_table.ts'),
    ('mart.vergleichstag_basis',               'vergleichstag_refresh',         'src/sync/vergleichstag.ts'),
    ('mart.einkauf_kreditor_monat',            'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkaufspreis_monat_basis',         'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkaufspreis_betrieb_basis',       'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkauf_betrieb_monat_basis',       'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkauf_pruefung_basis',            'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    -- 0094: die Pflichtartikelauswertung. Eigener Merker, weil sie NACH
    -- der Handpflege laufen muss — die Listen kommen aus pflege/.
    ('mart.pflichtartikel_klassifikation_basis', 'pflichtartikel_refresh',      'src/sync/pflichtartikel_sichten.ts'),
    ('mart.pflichtartikel_einkauf_basis',        'pflichtartikel_refresh',      'src/sync/pflichtartikel_sichten.ts'),
    ('mart.pflichtartikel_artikel_basis',        'pflichtartikel_refresh',      'src/sync/pflichtartikel_sichten.ts')
)
SELECT coalesce(v.sicht, z.sicht)      AS sicht,
       z.schluessel,
       z.nachlauf,
       m.gesetzt_am                    AS zuletzt_aufgefrischt,
       (m.wert ->> 'dauer_s')::numeric AS dauer_s,
       l.beendet_am                    AS letzter_lauf,
       CASE WHEN z.sicht IS NULL      THEN 'ohne Refresh'
            WHEN v.sicht IS NULL      THEN 'Sicht fehlt'
            WHEN m.gesetzt_am IS NULL THEN 'nie aufgefrischt'
            WHEN l.beendet_am IS NULL THEN 'kein Lauf'
            WHEN m.gesetzt_am < l.beendet_am - INTERVAL '1 hour' THEN 'veraltet'
            ELSE 'aktuell' END         AS zustand
  FROM vorhanden v
  FULL JOIN zuordnung z ON z.sicht = v.sicht
  CROSS JOIN letzter_lauf l
  LEFT JOIN sync.merker m ON m.schluessel = z.schluessel;


-- ---------------------------------------------------------------------
-- 4. Der MCP-Katalog (0102): die neue Sicht mit Koernung, damit sie nicht
--    in mcp.koernung_fehlend steht, und die Achsen nachgefuehrt.
-- ---------------------------------------------------------------------
INSERT INTO mcp.sicht (sicht, koernung, thema, summen_erlaubt) VALUES
  ('mart.artikeltage_basis', 'Betrieb mit Artikelverkaeufen (Zwischenstufe von mart.datenstand)', 'betrieb', false)
ON CONFLICT (sicht) DO UPDATE
   SET koernung = EXCLUDED.koernung, thema = EXCLUDED.thema, summen_erlaubt = EXCLUDED.summen_erlaubt;

SELECT mcp.achsen_ableiten();
