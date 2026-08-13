-- Ladenakte-Erstlauf pruefen. Rein lesend, gegen die Datenbank des Containers.
--
--   psql "$DATABASE_URL" -f docs/ladenakte-lauf-pruefen.sql
--
-- Erwartung nach einem vollstaendigen Lauf: 621 Belegordner, 131 BWA-Historien,
-- 131 Stammdatenblaetter, rund 593.314 Belege.

\echo '== 1. Laeuft gerade etwas? =='
SELECT lauf_id, ausloeser, gestartet_am, beendet_am,
       coalesce(beendet_am, now()) - gestartet_am AS dauer, status, notiz
  FROM sync.lauf ORDER BY gestartet_am DESC LIMIT 3;

\echo ''
\echo '== 2. Warteschlange: was ist offen, was erledigt? =='
SELECT endpunkt,
       count(*) FILTER (WHERE erledigt_am IS NULL)     AS offen,
       count(*) FILTER (WHERE erledigt_am IS NOT NULL) AS erledigt,
       count(*) FILTER (WHERE letzter_fehler IS NOT NULL) AS mit_fehler
  FROM sync.warteschlange WHERE endpunkt LIKE 'la:%'
 GROUP BY endpunkt ORDER BY endpunkt;

\echo ''
\echo '== 3. Fehler im Klartext — hier steht die Ursache =='
SELECT endpunkt, parameter->>'linaBetriebId' AS betrieb, parameter->>'typeId' AS ordner,
       versuche, left(letzter_fehler, 200) AS fehler
  FROM sync.warteschlange
 WHERE endpunkt LIKE 'la:%' AND letzter_fehler IS NOT NULL
 ORDER BY versuche DESC LIMIT 10;

\echo ''
\echo '== 4. Was ist tatsaechlich angekommen? (nie status=ok glauben) =='
SELECT 'buchungsbeleg'        AS tabelle, count(*) AS zeilen FROM core.buchungsbeleg
UNION ALL SELECT 'davon mit Lieferant',  count(*) FROM core.buchungsbeleg WHERE verkaeufer_name IS NOT NULL
UNION ALL SELECT 'davon mit Sachkonto',  count(*) FROM core.buchungsbeleg WHERE sachkonto IS NOT NULL
UNION ALL SELECT 'davon Bar/Kueche',     count(*) FROM core.buchungsbeleg WHERE zuordnung_fibu IN (1,2)
UNION ALL SELECT 'buchungsbeleg_steuer', count(*) FROM core.buchungsbeleg_steuer
UNION ALL SELECT 'bwa_position',         count(*) FROM core.bwa_position
UNION ALL SELECT 'davon mit Betrag',     count(*) FROM core.bwa_position WHERE betrag IS NOT NULL
UNION ALL SELECT 'bwa_plan',             count(*) FROM core.bwa_plan
UNION ALL SELECT 'betrieb_kapazitaet',   count(*) FROM core.betrieb_kapazitaet
UNION ALL SELECT 'tagesbudget',          count(*) FROM core.tagesbudget;

\echo ''
\echo '== 5. Soll gegen Ist je Belegart =='
-- SEIT 13.08.2026 UEBER DIE JEWEILS LETZTE MESSUNG, nicht ueber alle.
-- core.belegarchiv_bestand ist eine Zeitreihe und bekommt seit der taeglichen
-- Zaehlung (la:belegzahl, Migration 0069) 1.834 Zeilen am Tag. Ein sum() ueber
-- alle Zeilen zaehlte denselben Ordner nach einer Woche siebenmal — und das
-- Ergebnis saehe nicht falsch aus, sondern nur gross.
WITH letzte AS (
  SELECT DISTINCT ON (betrieb_key, typ_id) betrieb_key, typ_id, records_total
    FROM core.belegarchiv_bestand
   ORDER BY betrieb_key, typ_id, gemessen_am DESC)
SELECT s.typ_id, a.name, a.inhalt_holen,
       sum(s.soll_anzahl)                              AS soll,
       coalesce(sum(v.records_total), 0)               AS gezaehlt,
       count(*) FILTER (WHERE v.betrieb_key IS NULL AND s.soll_anzahl > 0) AS betriebe_offen
  FROM manual.belegarchiv_soll s
  JOIN core.belegart a ON a.typ_id = s.typ_id
  LEFT JOIN core.betrieb b ON b.lina_betrieb_id = s.lina_betrieb_id
  LEFT JOIN letzte v ON v.betrieb_key = b.betrieb_key AND v.typ_id = s.typ_id
 GROUP BY s.typ_id, a.name, a.inhalt_holen ORDER BY soll DESC;

\echo ''
\echo '== 5b. Bekommt das Belegarchiv noch Zulauf? (Migration 0069) =='
SELECT zustand, count(*) AS ordner, sum(differenz) FILTER (WHERE differenz > 0) AS fehlende_belege
  FROM mart.belegarchiv_zulauf GROUP BY zustand ORDER BY ordner DESC;

\echo ''
\echo '== 5c. Belege je Tag — zwei leere Tage in Folge sind ein Befund =='
SELECT hochgeladen_am::date AS tag, count(*) AS belege
  FROM core.buchungsbeleg
 WHERE hochgeladen_am >= current_date - 14
 GROUP BY 1 ORDER BY 1;

\echo ''
\echo '== 6. Tagesbudget — bleibt fuer die Tagesdaten genug uebrig? =='
SELECT count(*) FILTER (WHERE endpunkt LIKE 'la:%')     AS ladenakte,
       count(*) FILTER (WHERE endpunkt NOT LIKE 'la:%'
                          AND endpunkt NOT LIKE 'fn:%') AS uebriges_lina,
       count(*) FILTER (WHERE endpunkt NOT LIKE 'fn:%') AS lina_gesamt
  FROM sync.aufgabe WHERE beendet_am >= date_trunc('day', now());

\echo ''
\echo '== 7. Rohdaten: wie viel Platz hat der Lauf gekostet? =='
SELECT count(*) AS antworten,
       pg_size_pretty(sum(payload_bytes)) AS bytes_roh,
       pg_size_pretty(pg_total_relation_size('raw.api_antwort')) AS tabelle_gesamt
  FROM raw.api_antwort WHERE endpunkt LIKE 'la:%';

\echo ''
\echo '== 8. Zwei Selbstpruefungen. Erwartung: beide leer =='
SELECT * FROM mart.belegarchiv_pruefung LIMIT 10;
SELECT * FROM mart.bwa_pruefung LIMIT 10;
