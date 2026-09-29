-- =====================================================================
-- 0128 mart.datenstand rechnet nur, was gefragt wird
--
-- ANLASS (29.09.2026, gleich nach dem Deploy von 0125). Das Werkzeug
-- `datenstand` brauchte in Produktion 1,2–1,4 s statt 0,09 s nach 0124.
-- Zwei Ursachen, nacheinander gefunden:
--
--   1. JIT: 1,8 von 2,6 s. Der Join auf mart.betrieb_status (0125) hob die
--      Schätzkosten auf 2,9 Mio. — über jede JIT-Schwelle. Behoben per
--      ALTER SYSTEM SET jit = off (docs/entscheidungen.md, 29.09.2026).
--   2. Danach 1,4 s: die Umsatz-Unterabfrage aus 0125 las je Betrieb die
--      ganze Historie (~3.200 Zeilen, Bitmap Heap Scan, 9 ms × 141), um
--      min/max/count mit FILTER (umsatz_netto > 0) zu bilden — auch wenn
--      nur letzter_tag gefragt war.
--
-- JETZT: vier skalare Unterabfragen statt einer Aggregation. Erster und
-- letzter Umsatztag laufen über den Index (umsatzbericht_tag_uq) von vorn
-- bzw. hinten und hören beim ersten Tag mit Umsatz auf. Die Zahl der
-- Umsatztage zählt nur, wer die Spalte liest — eine einfache Sicht wird in
-- die Abfrage eingefaltet, und eine nicht gelesene Spalte wird nicht
-- berechnet.
--
-- Nachgemessen in Produktion, 29.09.2026, mit laufendem Import:
--   nach Befund gruppiert         1,4 s  → 0,26 s
--   Rueckstandsliste des Werkzeugs 1,39 s → 0,30 s
--   zeilengleich in beiden Richtungen (EXCEPT: 0 / 0)
-- Spalten, Reihenfolge und Typen wie in 0125.
-- =====================================================================

CREATE OR REPLACE VIEW mart.datenstand AS
SELECT b.name AS betrieb, b.stadt, kz.hauptkonzept AS konzept, b.aktiv, b.hat_bwa,
       (b.lina_betrieb_id IS NOT NULL) AS bwa_bruecke,
       u.erster_tag, u.letzter_tag, u.tage AS umsatztage,
       (current_date - u.letzter_tag) AS umsatz_alter_tage,
       k.letzter_gebuchter_monat AS bwa_monat,
       CASE WHEN k.letzter_gebuchter_monat IS NOT NULL
            THEN (date_part('year',  age(date_trunc('month', current_date)::date, k.letzter_gebuchter_monat)) * 12
                + date_part('month', age(date_trunc('month', current_date)::date, k.letzter_gebuchter_monat)))::int
       END AS bwa_verzug_monate,
       coalesce(a.artikeltage, 0) AS artikeltage, a.letzter_artikeltag, p.letzter_personaltag,
       CASE WHEN bs.status IN ('geschlossen', 'verwaltend', 'test', 'ohne_geschaeft') THEN 'kein laufender Betrieb'
            WHEN bs.status = 'fremdkasse'
                 THEN CASE WHEN k.letzter_gebuchter_monat IS NULL THEN 'keine BWA gebucht' ELSE 'fremde Kasse' END
            WHEN u.letzter_tag IS NULL THEN 'kein Umsatz geladen'
            WHEN current_date - u.letzter_tag > 8 THEN 'Umsatz veraltet'
            WHEN k.letzter_gebuchter_monat IS NULL THEN 'keine BWA gebucht'
            WHEN coalesce(a.artikeltage, 0) = 0 THEN 'keine Artikeldaten'
            ELSE 'vollstaendig' END AS befund,
       b.betrieb_key, u.letzter_geladener_tag, bs.status
  FROM core.betrieb b
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = b.betrieb_key
  LEFT JOIN mart.betrieb_status bs    ON bs.betrieb_key = b.betrieb_key
  CROSS JOIN LATERAL (
        SELECT (SELECT t.geschaeftstag FROM core.umsatzbericht_tag t
                 WHERE t.betrieb_key = b.betrieb_key AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL
                   AND t.umsatz_netto > 0 ORDER BY t.geschaeftstag LIMIT 1) AS erster_tag,
               (SELECT t.geschaeftstag FROM core.umsatzbericht_tag t
                 WHERE t.betrieb_key = b.betrieb_key AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL
                   AND t.umsatz_netto > 0 ORDER BY t.geschaeftstag DESC LIMIT 1) AS letzter_tag,
               (SELECT count(*)::int FROM core.umsatzbericht_tag t
                 WHERE t.betrieb_key = b.betrieb_key AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL
                   AND t.umsatz_netto > 0) AS tage,
               (SELECT t.geschaeftstag FROM core.umsatzbericht_tag t
                 WHERE t.betrieb_key = b.betrieb_key AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL
                 ORDER BY t.geschaeftstag DESC LIMIT 1) AS letzter_geladener_tag
  ) u
  LEFT JOIN LATERAL (
        WITH RECURSIVE kandidat(monat) AS (
              SELECT max(km.monat) FROM core.kennzahlen_monat km
               WHERE km.betrieb_key = b.betrieb_key AND km.wert_absolut::numeric(14,2) <> 0
            UNION ALL
              SELECT (SELECT max(km.monat) FROM core.kennzahlen_monat km
                       WHERE km.betrieb_key = b.betrieb_key AND km.wert_absolut::numeric(14,2) <> 0
                         AND km.monat < kandidat.monat)
                FROM kandidat WHERE kandidat.monat IS NOT NULL)
        SELECT kandidat.monat AS letzter_gebuchter_monat FROM kandidat
         WHERE kandidat.monat IS NOT NULL
           AND EXISTS (SELECT 1 FROM (SELECT DISTINCT ON (km.kennzahl) km.wert_absolut
                                        FROM core.kennzahlen_monat km
                                       WHERE km.betrieb_key = b.betrieb_key AND km.monat = kandidat.monat
                                         AND km.wert_absolut IS NOT NULL
                                       ORDER BY km.kennzahl, km.abgerufen_am DESC) juengster
                        WHERE juengster.wert_absolut::numeric(14,2) <> 0)
         LIMIT 1) k ON true
  LEFT JOIN mart.artikeltage_basis a ON a.betrieb_key = b.betrieb_key
  LEFT JOIN LATERAL (SELECT max(zeitraum_bis) AS letzter_personaltag FROM core.personalkosten pk
                      WHERE pk.betrieb_key = b.betrieb_key) p ON true
;
