-- =====================================================================
-- 0124 mart.artikelverkauf und mart.datenstand rechnen nicht mehr alles
--      für jeden Betrieb neu — und pg_stat_statements zählt mit
--
-- ANLASS (28.09.2026). Nach dem Serverwechsel auf CX43 die Frage, ob die
-- Dashboards und MCP-Antworten schneller werden können. Gemessen in
-- mcp.zugriff über 30 Tage: die zwölf langsamsten Abfragen standen alle
-- an der 20-s-Grenze, elf davon auf mart.artikelverkauf. Mehr Speicher
-- hat daran nichts geändert, weil es kein Speicherproblem war.
--
-- 1. mart.artikelverkauf
--
--    EXPLAIN ANALYZE der Preisabfrage „Enchilada, Getränke, 01.–07.09.“
--    (mcp.zugriff 615): 26,7 s. Davon 22 × 1,0 s in einer WindowAgg über
--    alle 591.665 Zeilen von core.artikel_stand — die Sicht
--    core.artikel_stand_zeitraum rechnet ihre Gültigkeitszeiträume mit
--    lead(), und der Planer schätzte „1 Betrieb“ statt 22 und stellte sie
--    deshalb auf die Innenseite einer Nested Loop. Jeder Betrieb rechnete
--    die ganze Stammhistorie neu.
--
--    Der Ansatz eines Tages ist der jüngste Stand, dessen Monat nicht nach
--    dem Tag liegt. Genau das fragt jetzt ein LATERAL mit LIMIT 1 über den
--    Primärschlüssel (artikel_key, monat) ab — ein Indexsprung je Zeile,
--    keine Fensterfunktion. Die Warengruppe genauso, mit der Regel aus
--    0002: vor dem ältesten Stand gilt der älteste (rückwirkend bis
--    -infinity), und erfasst_ab ist der Monat der gewählten Zeile.
--
--    Nachgemessen in Produktion, 28.09.2026 (vor der Migration, dieselbe
--    Abfrage über die neue Definition als Unterabfrage):
--
--      Preisabfrage (mcp.zugriff 615)     26,7 s  →  0,27 s   EXCEPT ALL: 0
--      August 2026, alle Betriebe          4,7 s  →  3,6 s    Summen gleich
--      Jahr 2025, alle Betriebe           33,9 s  → 30,3 s    Summen gleich
--
--    Der Vollscan wird also nicht langsamer — wichtig für die beiden
--    Materialisierungen darüber (mart.artikel_monat_basis und
--    mart.deckungsbeitrag_warengruppe, 27,7 Mio. Zeilen).
--
--    core.artikel_stand_zeitraum und core.artikel_warengruppe_zeitraum
--    bleiben stehen; sie sind für Handabfragen weiter richtig, nur als
--    Join unter einer großen Sicht zu teuer (Kommentar ergänzt).
--
-- 2. mart.datenstand
--
--    Das MCP-Werkzeug `datenstand` brauchte im Median 2,8 s, und
--    datenstandHolen() hängt dieselbe Sicht an jede Abfrageantwort.
--    Von 2,07 s gingen 1,73 s in den letzten gebuchten BWA-Monat: je
--    Betrieb alle ~17.000 Zeilen aus core.kennzahlen_monat durch
--    mart.kennzahlen_aktuell gruppiert (2,4 Mio. Puffer), um am Ende
--    max(monat) zu nehmen. Weitere 0,31 s waren JIT-Übersetzung, weil die
--    Schätzkosten über jit_above_cost lagen.
--
--    Jetzt: vom jüngsten Monat mit einem von null verschiedenen Wert
--    rückwärts, und der erste Monat, in dem der JÜNGSTE Abruf einer
--    Kennzahl einen solchen Wert trägt, ist es — dieselbe Bedingung wie in
--    kennzahlen_aktuell (letzter Nicht-NULL-Wert je Kennzahl, auf
--    numeric(14,2) gerundet, ungleich 0). Den Sprung zum nächsten
--    Kandidatenmonat macht ein Teilindex über die 444.154 von 2,4 Mio.
--    Zeilen mit Wert; Betriebe ganz ohne BWA kosten damit einen
--    Indexzugriff statt aller ihrer Zeilen.
--
--    Ohne den Teilindex war die Rückwärtssuche in Produktion 1,0 s schnell
--    — die 36 Betriebe ohne gebuchte BWA gingen jeden Monat einzeln durch.
--    Mit ihm lokal 0,4 ms statt 14 ms (kleinerer Bestand); Ergebnis in
--    beiden Richtungen zeilengleich, in Produktion ohne Index ebenso.
--
-- 3. pg_stat_statements
--
--    Welche Metabase-Karte langsam ist, wussten wir bisher nur aus
--    Einzelmessungen. Die Erweiterung zählt je Abfrageform Aufrufe, Zeit,
--    Puffer und JIT-Anteil. Sie braucht shared_preload_libraries (per
--    ALTER SYSTEM gesetzt, wirksam nach dem Neustart — docs/entscheidungen.md,
--    28.09.2026); vorher legt diese Migration nur die Objekte an, und die
--    Sicht meldet beim Lesen, dass die Bibliothek fehlt. Das ist kein
--    Fehler der Migration.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. mart.artikelverkauf (Definition aus 0039; geändert sind nur die
--    beiden Stand-Joins)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.artikelverkauf AS
SELECT av.geschaeftstag,
       date_trunc('month', av.geschaeftstag)::date AS monat,
       b.betrieb_key,
       b.name AS betrieb,
       coalesce(b.stadt, st.ort) AS stadt,
       kz.hauptkonzept AS konzept,
       a.artikel_key,
       a.artikelnummer,
       coalesce(az.name, a.name) AS artikel,
       g.name  AS grosskategorie,
       mg.name AS warengruppe,
       d.name  AS detailkategorie,
       aw.artikel_key IS NOT NULL AND av.geschaeftstag < aw.erfasst_ab AS warengruppe_geschaetzt,
       av.menge,
       av.umsatz_netto,
       av.umsatz_brutto,
       av.verkaufspreis,
       nullif(az.fixer_we, 0) AS fixer_we,
       round(av.menge * nullif(az.fixer_we, 0), 2) AS wareneinsatz_theoretisch,
       round(av.umsatz_netto - av.menge * nullif(az.fixer_we, 0), 2) AS deckungsbeitrag
  FROM core.artikelverkauf_tag av
  JOIN core.betrieb b ON b.betrieb_key = av.betrieb_key
  JOIN core.artikel a ON a.artikel_key = av.artikel_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = av.betrieb_key
  LEFT JOIN manual.betrieb_standort st ON st.betrieb_key = av.betrieb_key
  -- Der Stand, der an diesem Tag galt: der jüngste, der nicht danach liegt.
  -- Gleichbedeutend mit dem Bereichsjoin auf core.artikel_stand_zeitraum.
  LEFT JOIN LATERAL (
        SELECT s.name, s.fixer_we
          FROM core.artikel_stand s
         WHERE s.artikel_key = av.artikel_key
           AND s.monat <= av.geschaeftstag
         ORDER BY s.monat DESC
         LIMIT 1
  ) az ON true
  -- Die Warengruppe genauso — nur dass vor dem ältesten Stand der älteste
  -- gilt (core.artikel_warengruppe_zeitraum: gilt_ab = -infinity).
  LEFT JOIN LATERAL (
        SELECT w.artikel_key, w.monat AS erfasst_ab,
               w.gross_key, w.mec_key, w.detail_key
          FROM core.artikel_warengruppe_stand w
         WHERE w.artikel_key = av.artikel_key
         ORDER BY (w.monat <= av.geschaeftstag) DESC,
                  CASE WHEN w.monat <= av.geschaeftstag THEN w.monat END DESC,
                  w.monat
         LIMIT 1
  ) aw ON true
  LEFT JOIN core.warengruppe g  ON g.warengruppe_key  = aw.gross_key
  LEFT JOIN core.warengruppe mg ON mg.warengruppe_key = aw.mec_key
  LEFT JOIN core.warengruppe d  ON d.warengruppe_key  = aw.detail_key;

COMMENT ON VIEW core.artikel_stand_zeitraum IS
'core.artikel_stand als Gueltigkeitszeitraeume. gilt_bis ist EXKLUSIV und NULL fuer den
jeweils juengsten Stand. Join-Muster:
    JOIN core.artikel_stand_zeitraum z
      ON z.artikel_key = av.artikel_key
     AND av.geschaeftstag >= z.gilt_ab
     AND (z.gilt_bis IS NULL OR av.geschaeftstag < z.gilt_bis)
Nie ueber monat = date_trunc(...) verknuepfen: die Stand-Tabelle hat nur bei Aenderung
eine Zeile.
UNTER EINER GROSSEN SICHT NICHT JOINEN (0124): lead() rechnet alle 591.665 Zeilen, und
wenn der Planer die Sicht auf die Innenseite einer Nested Loop stellt, je aussere Zeile
einmal (mart.artikelverkauf: 26,7 s). Dort stattdessen LATERAL ... WHERE monat <= tag
ORDER BY monat DESC LIMIT 1 ueber den Primaerschluessel.';


-- ---------------------------------------------------------------------
-- 2. mart.datenstand (Definition aus 0106; geändert ist nur der
--    BWA-Monat)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS kennzahlen_monat_gebucht_idx
    ON core.kennzahlen_monat (betrieb_key, monat)
 WHERE wert_absolut::numeric(14,2) <> 0;

COMMENT ON INDEX core.kennzahlen_monat_gebucht_idx IS
'Monate mit einem von null verschiedenen BWA-Wert je Betrieb. Traegt die Rueckwaertssuche
nach dem letzten gebuchten Monat in mart.datenstand (0124). Die Bedingung muss woertlich
der in der Sicht entsprechen, sonst nimmt der Planer den Index nicht.';

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
  -- Der letzte gebuchte Monat: rueckwaerts ueber die Monate, die ueberhaupt
  -- einen Wert ungleich 0 haben (Teilindex), und der erste, in dem der
  -- juengste Abruf einer Kennzahl noch einen traegt. Dieselbe Regel wie
  -- max(monat) ueber mart.kennzahlen_aktuell mit wert_absolut <> 0 — nur
  -- ohne jede Kennzahl jedes Monats jedes Betriebs zu gruppieren.
  LEFT JOIN LATERAL (
        WITH RECURSIVE kandidat(monat) AS (
              SELECT max(km.monat)
                FROM core.kennzahlen_monat km
               WHERE km.betrieb_key = b.betrieb_key
                 AND km.wert_absolut::numeric(14,2) <> 0
            UNION ALL
              SELECT (SELECT max(km.monat)
                        FROM core.kennzahlen_monat km
                       WHERE km.betrieb_key = b.betrieb_key
                         AND km.wert_absolut::numeric(14,2) <> 0
                         AND km.monat < kandidat.monat)
                FROM kandidat
               WHERE kandidat.monat IS NOT NULL
        )
        SELECT kandidat.monat AS letzter_gebuchter_monat
          FROM kandidat
         WHERE kandidat.monat IS NOT NULL
           AND EXISTS (
                 SELECT 1
                   FROM (SELECT DISTINCT ON (km.kennzahl) km.wert_absolut
                           FROM core.kennzahlen_monat km
                          WHERE km.betrieb_key = b.betrieb_key
                            AND km.monat = kandidat.monat
                            AND km.wert_absolut IS NOT NULL
                          ORDER BY km.kennzahl, km.abgerufen_am DESC) juengster
                  WHERE juengster.wert_absolut::numeric(14,2) <> 0)
         LIMIT 1
  ) k ON true
  LEFT JOIN mart.artikeltage_basis a ON a.betrieb_key = b.betrieb_key
  LEFT JOIN LATERAL (
        SELECT max(zeitraum_bis) AS letzter_personaltag
          FROM core.personalkosten pk
         WHERE pk.betrieb_key = b.betrieb_key
  ) p ON true;


-- ---------------------------------------------------------------------
-- 3. pg_stat_statements — nur wo das Paket da ist (lokale Testserver
--    ohne contrib sollen an dieser Migration nicht scheitern)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_stat_statements') THEN
    CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
  ELSE
    RAISE NOTICE 'pg_stat_statements ist auf diesem Server nicht installiert — uebersprungen';
  END IF;
END $$;
