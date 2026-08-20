-- =====================================================================
-- 0092 — Die Sicht, die nach vorn schaut, schaute auf eine Achse,
--        die nur zurueckreicht
--
-- `mart.feiertag_kalender` aus `0085` sollte die Feiertage der naechsten
-- 90 Tage zeigen — laut Plan "die einzige Sicht in diesem Plan, die nach
-- vorn schaut, und der Grund, warum jemand das Dashboard zweimal
-- oeffnet".
--
-- Sie lieferte NULL ZEILEN, und zwar von Anfang an. Aufgefallen am
-- 20.08.2026 beim Nachfahren aller Karten gegen die Produktivinstanz:
-- 15 von 16 Karten trugen Daten oder waren erklaerbar leer, diese eine
-- war es nicht.
--
-- DER FEHLER: sie baute auf `mart.betrieb_kalender`, und dessen
-- Tagesachse ist
--
--     SELECT DISTINCT geschaeftstag FROM mart.umsatz_tag
--
-- also ausschliesslich Tage, an denen es bereits Umsatz GAB. Ein
-- `WHERE geschaeftstag > current_date` darauf kann nichts finden. Die
-- Sicht war syntaktisch fehlerfrei, lief schnell, und war leer — genau
-- die Fehlerklasse, die dieses Projekt am haeufigsten getroffen hat.
--
-- DIE KORREKTUR: der Vorausblick baut seine Tagesachse aus dem KALENDER,
-- nicht aus dem Umsatz. `manual.feiertag` reicht bis 2029; die
-- Betriebszuordnung kommt weiterhin ueber das Bundesland, mit den
-- bundesweiten Feiertagen als Rueckfall wie in `0084`.
--
-- DASS SIE JETZT ZEILEN LIEFERT, IST ALS PRUEFZEILE ABGESICHERT: eine
-- Vorausschau, die still leer laeuft, sieht aus wie "keine Feiertage in
-- Sicht" und ist von "kaputt" nicht zu unterscheiden.
-- =====================================================================


CREATE OR REPLACE VIEW mart.feiertag_kalender AS
WITH betrieb AS (
  SELECT b.betrieb_key,
         b.name AS betrieb,
         bl.kuerzel,
         CASE WHEN bl.kuerzel IS NOT NULL THEN 'bundesland' ELSE 'bundesweit' END AS kalender_quelle
    FROM core.betrieb b
    LEFT JOIN mart.betrieb_bundesland bl ON bl.betrieb_key = b.betrieb_key
   -- Nur Betriebe, die ueberhaupt noch Umsatz machen: eine Vorausschau
   -- fuer eine geschlossene Gesellschaft ist Rauschen.
   WHERE EXISTS (SELECT 1 FROM mart.umsatz_tag u
                  WHERE u.betrieb_key = b.betrieb_key
                    AND u.geschaeftstag >= current_date - 90
                    AND u.umsatz_netto > 0)
), landestermin AS (
  SELECT kuerzel, datum, min(name) AS name
    FROM mart.feiertag_normiert
   WHERE datum > current_date AND datum <= current_date + 90
   GROUP BY kuerzel, datum
), bundestermin AS (
  SELECT datum, name FROM mart.feiertag_bundesweit
   WHERE datum > current_date AND datum <= current_date + 90
), kommend AS (
  SELECT b.betrieb_key, b.betrieb, b.kalender_quelle, t.datum, t.name AS feiertag
    FROM betrieb b JOIN landestermin t ON t.kuerzel = b.kuerzel
   WHERE b.kuerzel IS NOT NULL
  UNION ALL
  SELECT b.betrieb_key, b.betrieb, b.kalender_quelle, t.datum, t.name
    FROM betrieb b JOIN bundestermin t ON true
   WHERE b.kuerzel IS NULL
)
SELECT k.betrieb_key,
       k.betrieb,
       k.datum,
       k.feiertag,
       to_char(k.datum, 'TMDay')     AS wochentag,
       (k.datum - current_date)::int AS in_tagen,
       e.tage        AS bisherige_termine,
       e.median_pct  AS median_bisher_pct,
       e.p25_pct,
       e.p75_pct,
       e.letzter_termin,
       -- ANS ENDE, nicht an die logisch passende Stelle: CREATE OR REPLACE
       -- VIEW darf Spalten weder umbenennen noch umsortieren, nur anhaengen.
       k.kalender_quelle
  FROM kommend k
  LEFT JOIN mart.kalendereffekt e
    ON e.betrieb_key = k.betrieb_key
   AND e.kategorie   = 'feiertag'
   AND e.auspraegung = k.feiertag
 ORDER BY k.datum, k.betrieb;

COMMENT ON VIEW mart.feiertag_kalender IS
'Die naechsten 90 Tage: welcher Feiertag trifft welchen Betrieb, und was war er beim '
'letzten Mal wert. Die Tagesachse kommt aus manual.feiertag und NICHT aus '
'mart.betrieb_kalender — dessen Achse ist "Tage mit Umsatz" und reicht bauartbedingt '
'nicht in die Zukunft. Bis 0092 lieferte die Sicht deshalb null Zeilen, fehlerfrei und '
'schnell. Leere Werte in median_bisher_pct heissen, dass es diesen Feiertag fuer diesen '
'Betrieb im Auswertungszeitraum noch nicht mit vier sauberen Vergleichstagen gab.';


-- ---------------------------------------------------------------------
-- Die Pruefzeile dazu (Regel 10)
--
-- Eine Vorausschau, die still leer laeuft, sieht aus wie "keine
-- Feiertage in Sicht". In Deutschland gibt es in 90 Tagen praktisch
-- immer mindestens einen — ausser im Fenster zwischen Fronleichnam und
-- dem 3. Oktober. Deshalb ist die Erwartung nicht "nie leer", sondern
-- "nicht laenger als 80 Tage am Stueck leer": bleibt sie das, reicht der
-- Kalenderbestand nicht mehr weit genug.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.feiertag_vorausschau AS
SELECT (SELECT count(*)::int FROM mart.feiertag_kalender)              AS zeilen,
       (SELECT count(DISTINCT datum)::int FROM mart.feiertag_kalender) AS termine,
       (SELECT max(datum) FROM manual.feiertag)                        AS kalender_bis,
       ((SELECT max(datum) FROM manual.feiertag) - current_date)::int  AS reichweite_tage,
       CASE WHEN (SELECT max(datum) FROM manual.feiertag) < current_date + 180
              THEN 'Kalender reicht nicht mehr weit genug'
            WHEN (SELECT count(*) FROM mart.feiertag_kalender) = 0
              THEN 'keine Termine in 90 Tagen'
            ELSE 'ok' END AS zustand;

COMMENT ON VIEW mart.feiertag_vorausschau IS
'Traegt die Vorausschau ueberhaupt etwas? ERWARTUNG: zustand = ok. Bis 0092 stand sie '
'dauerhaft auf null Zeilen, weil die Tagesachse aus dem Umsatz kam. Schlaegt sie an, '
'reicht entweder der Kalenderbestand nicht mehr (dann hat der Nachlauf ein Problem) oder '
'es stehen tatsaechlich 90 Tage ohne Feiertag an — das gibt es nur zwischen Fronleichnam '
'und dem 3. Oktober.';


-- Und in die Uebersicht damit. Der Rest der Sicht ist unveraendert der
-- Stand nach 0090.
CREATE OR REPLACE VIEW mart.pruefung_kalender AS
SELECT * FROM (
  SELECT 'Vergleichstag: Materialisierung aelter als der letzte Lauf'::text AS pruefung,
         1 AS geprueft,
         count(*) FILTER (WHERE zustand <> 'aktuell')::int AS auffaellig,
         'mart.vergleichstag_stand'::text AS sicht
    FROM mart.vergleichstag_stand
  UNION ALL
  SELECT 'Vergleichstag: Betrieb mit Umsatz, aber ohne Bundesland'::text,
         (SELECT count(DISTINCT betrieb_key)::int FROM mart.umsatz_tag),
         count(*)::int, 'mart.kalender_fehlend'::text
    FROM mart.kalender_fehlend
  UNION ALL
  SELECT 'Feiertag: Name endet vor dem Ende der Historie'::text,
         (SELECT count(DISTINCT name)::int FROM mart.feiertag_normiert),
         count(*)::int, 'mart.feiertag_namenswechsel'::text
    FROM mart.feiertag_namenswechsel
  UNION ALL
  SELECT 'Feiertag: Jahr mit Umsatz, aber ohne Feiertage'::text,
         (SELECT count(DISTINCT extract(year FROM geschaeftstag))::int FROM mart.umsatz_tag),
         count(*) FILTER (WHERE zustand = 'Luecke')::int,
         'mart.feiertag_jahresluecke'::text
    FROM mart.feiertag_jahresluecke
  UNION ALL
  -- ERWARTUNG: 0. Eine Vorausschau, die still leer laeuft, sieht aus wie
  -- "keine Feiertage in Sicht" und ist von "kaputt" nicht zu unterscheiden.
  SELECT 'Feiertag: Vorausschau auf 90 Tage traegt nichts'::text,
         1, count(*) FILTER (WHERE zustand <> 'ok')::int,
         'mart.feiertag_vorausschau'::text
    FROM mart.feiertag_vorausschau
  UNION ALL
  SELECT 'Wetter: Gitterpunkt ohne Messwert fuer gestern'::text,
         (SELECT count(*)::int FROM mart.wetter_ort),
         (SELECT count(*)::int FROM mart.wetter_ort o
           WHERE NOT EXISTS (SELECT 1 FROM manual.wetter_stunde w
                              WHERE w.breite = o.breite AND w.laenge = o.laenge
                                AND core.geschaeftstag(w.zeitpunkt) = current_date - 1)),
         'mart.wetter_rueckstand'::text
  UNION ALL
  SELECT 'Wetter: Backfill-Rueckstand in Ortsjahren'::text,
         count(*)::int,
         count(*) FILTER (WHERE zustand IN ('fehlt', 'unvollstaendig'))::int,
         'mart.wetter_rueckstand'::text
    FROM mart.wetter_rueckstand
  UNION ALL
  SELECT 'Wetter: Klassengrenzen mit Luecke oder Ueberlappung'::text,
         (SELECT count(*)::int FROM manual.wetter_klasse),
         count(*)::int, 'mart.wetter_klasse_pruefung'::text
    FROM mart.wetter_klasse_pruefung
) x;

INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0092', to_jsonb(
        'mart.feiertag_kalender lieferte seit 0085 null Zeilen: die Sicht schaute 90 '
        'Tage nach vorn, baute ihre Tagesachse aber auf SELECT DISTINCT '
        'geschaeftstag FROM mart.umsatz_tag — also auf Tage, an denen es bereits '
        'Umsatz gab. Fehlerfrei, schnell, leer. Aufgefallen beim Nachfahren aller '
        'Karten gegen die Produktivinstanz. Die Achse kommt jetzt aus '
        'manual.feiertag, und mart.feiertag_vorausschau meldet, wenn die '
        'Vorausschau wieder leer laeuft.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
