-- =====================================================================
-- 0090 — 2018 und 2019 sind entschieden, nicht offen
--
-- `mart.feiertag_jahresluecke` (aus `0087`) meldete zwei Jahre ohne
-- Feiertage: 2018 mit 11.442 und 2019 mit 14.268 Umsatztagen. Die
-- Ursache steht in befunde-datenlage.md — der reparierte Kalender-
-- Nachlauf holt ab 2020, die alten Zeilen der Vorgaengerquelle sind weg.
--
-- ENTSCHIEDEN AM 20.08.2026 (Eugene): die beiden Jahre werden NICHT
-- nachgezogen. Sie liegen weit vor dem Auswertungszeitraum der
-- Effektsichten (rollierend, heute ab 2023) und aendern an keiner Zahl
-- etwas, die jemand liest.
--
-- WAS SICH DARAUS FUER DIE PRUEFZEILE ERGIBT — und das ist der eigentliche
-- Grund fuer diese Migration: eine Zeile, die dauerhaft auf 2 steht,
-- liest nach zwei Wochen niemand mehr. Das ist die 0071-Hygiene, und sie
-- ist hier wichtiger als die Vollstaendigkeit.
--
-- Die Pruefung fragt deshalb ab jetzt nur noch die Jahre, die der
-- Kalender ueberhaupt ABDECKEN WILL: ab dem ersten Jahr in
-- manual.feiertag. 2018 und 2019 fallen damit heraus, ohne dass jemand
-- eine Jahreszahl verdrahtet — zieht die Quelle spaeter weitere Jahre
-- nach, wandert die Grenze von selbst mit.
--
-- SICHTBAR BLEIBEN SIE TROTZDEM (Regel 10). Die Sicht listet sie weiter,
-- jetzt mit einer Spalte `zustand`, die den Unterschied benennt:
-- 'vor Kalenderbeginn' ist entschieden, 'Luecke' ist ein Befund.
-- =====================================================================


CREATE OR REPLACE VIEW mart.feiertag_jahresluecke AS
WITH jahr AS (
  SELECT extract(year FROM geschaeftstag)::int AS jahr,
         count(*) FILTER (WHERE umsatz_netto > 0) AS umsatztage
    FROM mart.umsatz_tag GROUP BY 1
), reichweite AS (
  SELECT extract(year FROM min(datum))::int AS ab_jahr FROM manual.feiertag
)
SELECT j.jahr,
       j.umsatztage,
       count(DISTINCT f.datum)::int   AS feiertage,
       count(DISTINCT f.kuerzel)::int AS laender,
       CASE WHEN j.jahr < r.ab_jahr THEN 'vor Kalenderbeginn'
            ELSE 'Luecke' END         AS zustand
  FROM jahr j
  CROSS JOIN reichweite r
  LEFT JOIN manual.feiertag f ON extract(year FROM f.datum)::int = j.jahr
 WHERE j.umsatztage > 0
 GROUP BY j.jahr, j.umsatztage, r.ab_jahr
HAVING count(DISTINCT f.datum) < 9
 ORDER BY j.jahr;

COMMENT ON VIEW mart.feiertag_jahresluecke IS
'Kalenderjahre mit Umsatz, aber weniger als neun Feiertagsterminen — neun ist die Zahl '
'der bundesweiten. zustand = "vor Kalenderbeginn" ist entschieden und zaehlt nicht als '
'Befund: die Quelle liefert erst ab ihrem ersten Jahr, und 2018/2019 werden bewusst '
'nicht nachgezogen (20.08.2026, Eugene). zustand = "Luecke" ist einer — dort behauptet '
'der Kalender, das Jahr abzudecken, und tut es nicht. Ohne Feiertage landet ein Neujahr '
'im Vergleichsvorrat und laesst den Folgemittwoch glaenzen.';


-- Die Pruefzeile zaehlt nur noch die echten Luecken. Der Rest der Sicht
-- ist unveraendert der Stand nach 0087.
CREATE OR REPLACE VIEW mart.pruefung_kalender AS
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
UNION ALL
-- ERWARTUNG: 0. 'vor Kalenderbeginn' zaehlt nicht mit — das ist
-- entschieden und keine offene Baustelle.
SELECT 'Feiertag: Jahr mit Umsatz, aber ohne Feiertage'::text,
       (SELECT count(DISTINCT extract(year FROM geschaeftstag))::int FROM mart.umsatz_tag),
       count(*) FILTER (WHERE zustand = 'Luecke')::int,
       'mart.feiertag_jahresluecke'::text
  FROM mart.feiertag_jahresluecke;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0090', to_jsonb(
        '2018 und 2019 stehen ohne Feiertage da, seit der reparierte Nachlauf erst '
        'ab 2020 holt. Entschieden am 20.08.2026: sie werden nicht nachgezogen — '
        'sie liegen weit vor dem Auswertungszeitraum. Die Pruefzeile zaehlt '
        'deshalb nur noch Jahre, die der Kalender abzudecken BEHAUPTET; eine Zeile, '
        'die dauerhaft auf 2 steht, liest niemand mehr. Sichtbar bleiben sie in '
        'mart.feiertag_jahresluecke mit zustand = "vor Kalenderbeginn".'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
