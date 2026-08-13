-- =====================================================================
-- 0069 Der Zulauf des Belegarchivs — und warum er zwei Tage lang fehlte
--
-- ANLASS (13.08.2026, alles in Produktion nachgemessen). Der naechtliche
-- Lauf meldete seit dem 06.08. jeden Tag "ok" — Lauf 88 mit 269 von 269
-- Aufgaben, null Fehler. Trotzdem bekam core.buchungsbeleg seit dem
-- 12.08. um 13:25 keinen einzigen Beleg mehr, bei einem Mittel von 331
-- am Tag ueber die 28 Tage davor.
--
-- Die Ursache war bauartbedingt und kein Ausfall. ladenakteNachfuellen()
-- reihte einen Belegordner nur ein, solange es fuer ihn KEINEN
-- Bestandssatz mit records_total > 0 gab. Das ist die Bedingung eines
-- einmaligen Abzugs. Als der Abzug fertig war, lieferte sie null Zeilen;
-- die Laeufe 85 bis 88 hatten je null la:*-Aufgaben. Ein Importer ohne
-- Arbeit sieht genauso aus wie einer, der fertig ist — derselbe Satz,
-- der seit dem 02.08.2026 im Kopf von src/sync.ts steht.
--
-- Torwaechter war manual.belegarchiv_soll: 1.048 Zeilen, gemessen_am
-- durchgehend 2026-08-11, einmal von Hand aus docs/ladenakte-bestand.csv
-- geschrieben und seither von keinem Code fortgeschrieben. Zwei
-- Nebenwirkungen desselben Torwaechters:
--
--   - 6 der 14 Belegarten (16, 3968, 3969, 3971, 3972, 3976) haben null
--     Soll-Zeilen und konnten bauartbedingt NIE geholt werden.
--   - 10 Betriebe haben keine Soll-Zeile. Heute ist keiner davon
--     operativ, aber ein neu eroeffneter Betrieb naehme denselben Weg.
--
-- ---------------------------------------------------------------------
-- WAS SICH AENDERT
--
-- Der Torwaechter ist ab sofort die MESSUNG und keine eingefrorene
-- Liste. Der taegliche Lauf zaehlt jeden Ordner (la:belegzahl, ein
-- Aufruf mit length=1) und reiht den vollen Abzug nach, wenn der
-- Zaehlstand von dem abweicht, was core.buchungsbeleg haelt.
--
-- Die Invariante dahinter ist gemessen, nicht angenommen: am 13.08.2026
-- stimmten fuer alle 621 abgezogenen Ordner count(*) aus
-- core.buchungsbeleg und records_total auf den Beleg genau ueberein —
-- kein einziger Ausreisser. Deshalb ist UNGLEICH die richtige Bedingung
-- und nicht KLEINER: sie faengt auch den abgebrochenen Abzug und den in
-- LINA geloeschten Beleg.
--
-- ---------------------------------------------------------------------
-- DREI ENTSCHEIDUNGEN, DIE HIER FESTGESCHRIEBEN WERDEN
--
-- 1. inhalt_holen STEHT IM SCHEMA, NICHT IM CODE. Ob eine Belegart
--    geholt wird, ist eine fachliche Frage — fuer die sechs nie
--    geholten steht sie als Punkt 3 in Abschnitt 4 von
--    docs/plan-datenvollstaendigkeit.md und gehoert Eugene. GEZAEHLT
--    werden sie ab sofort trotzdem: erst die Zaehlung sagt, ob dort
--    ueberhaupt etwas liegt, das die Entscheidung lohnt. Umschalten ist
--    danach ein UPDATE auf eine Zeile und keine Migration.
--
-- 2. manual.belegarchiv_soll BLEIBT STEHEN, verliert aber sein Amt. Sie
--    ist die Handzaehlung vom 11.08.2026 und die dritte Zahl in
--    mart.belegarchiv_fehlend (Soll gegen Bestand gegen Ist). Als Tor
--    ist sie abgesetzt, als Beleg bleibt sie.
--
-- 3. quelle TRENNT ZAEHLUNG VON ABZUG. Ohne diese Spalte waere
--    core.belegarchiv_bestand nach wenigen Tagen ueberwiegend voll mit
--    Zaehlungen, und niemand koennte mehr sagen, wann ein Ordner
--    zuletzt wirklich GEHOLT wurde. Die 621 vorhandenen Zeilen stammen
--    ausnahmslos aus vollen Abzuegen und bekommen deshalb 'abzug'.
--
-- ---------------------------------------------------------------------
-- DIE RECHNUNG (Tagesbudget LINA: 10.500, verbraucht bisher 82)
--
--   131 Betriebe x 14 Belegarten            1.834 Zaehlungen
--   + storeId-Token, 2 Aufrufe je Betrieb     262
--   + LINA-Tagesberichte wie bisher             82
--   + nachgereihte Abzuege (296 Paare hatten
--     in 28 Tagen ueberhaupt Zulauf)          ~ 60
--   ------------------------------------------------
--                                           ~ 2.238 von 10.500
--
-- Die Zaehlung antwortet mit einer Zeile statt mit bis zu 8,2 MB. Der
-- Erstabzug brauchte fuer 621 volle Ordner acht Stunden; 1.834
-- Zaehlungen kosten bei dem am 13.08.2026 gemessenen Takt von rund 3 s
-- je Aufruf etwa 1,7 Stunden. Das Fenster ist 0-24 Uhr.
--
-- ---------------------------------------------------------------------
-- WAS DAS AN ZEILEN KOSTET — damit es niemanden ueberrascht
--
-- Drei Tabellen wachsen ab jetzt um je 1.834 Zeilen am Tag, rund 670.000
-- im Jahr: core.belegarchiv_bestand, sync.warteschlange und sync.aufgabe.
-- Das ist gewollt und nicht Abfall — die Zeitreihe je Ordner IST der
-- Nachweis, dass jemand hingesehen hat, und Phase 4 des Plans baut den
-- Zulauf-Waechter darauf.
--
-- Die Pruefung beim Einreihen bleibt trotzdem billig: sie nennt
-- endpunkt UND zeitraum_von, trifft also den nicht-partiellen Index aus
-- 0059 und liest hoechstens die 1.834 Zeilen EINES Tages — nicht die
-- ganze Tabelle. Genau diese Rechnung ist am 12.08.2026 einmal
-- schiefgegangen (sieben Minuten Nachfuellzeit, 168.218 gelesene Zeilen
-- je Pruefung); deshalb steht sie hier.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Freigabe je Belegart
-- ---------------------------------------------------------------------

ALTER TABLE core.belegart
    ADD COLUMN IF NOT EXISTS inhalt_holen boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN core.belegart.inhalt_holen IS
'Wird der INHALT dieses Ordners geholt, oder nur sein Zaehlstand?
Gezaehlt wird jeder Ordner taeglich (la:belegzahl). Geholt (la:belegliste) nur, wo
das hier true ist. Am 13.08.2026 sind das die acht Belegarten, die die Erhebung vom
11.08.2026 gezaehlt hat. Fuer die sechs uebrigen — 16, 3968, 3969, 3971, 3972, 3976 —
ist die Entscheidung offen (docs/plan-datenvollstaendigkeit.md, Abschnitt 4 Punkt 3).
Sie steht hier und nicht im Code, damit das Umschalten ein UPDATE ist und keine
Migration. Was dann faellig waere, zeigt mart.belegarchiv_zulauf in der Zeile
"gezaehlt, nicht freigegeben".';

-- Die acht, die am 11.08.2026 gezaehlt und danach abgezogen wurden.
-- Aus der Zaehlung abgeleitet und nicht als Liste hingeschrieben: so
-- kann keine Nummer abweichen von dem, was tatsaechlich geholt ist.
UPDATE core.belegart a
   SET inhalt_holen = true
 WHERE EXISTS (SELECT 1 FROM manual.belegarchiv_soll s WHERE s.typ_id = a.typ_id);


-- ---------------------------------------------------------------------
-- 2. Zaehlung und Abzug auseinanderhalten
-- ---------------------------------------------------------------------

ALTER TABLE core.belegarchiv_bestand
    ADD COLUMN IF NOT EXISTS quelle text NOT NULL DEFAULT 'abzug';

ALTER TABLE core.belegarchiv_bestand
    DROP CONSTRAINT IF EXISTS belegarchiv_bestand_quelle_chk;
ALTER TABLE core.belegarchiv_bestand
    ADD CONSTRAINT belegarchiv_bestand_quelle_chk
    CHECK (quelle IN ('zaehlung', 'abzug'));

COMMENT ON COLUMN core.belegarchiv_bestand.quelle IS
'Woher dieser Zaehlstand stammt.
  abzug     aus einem vollen Ordnerabruf (la:belegliste, length=100000). Dabei sind
            auch die Belege selbst geschrieben worden.
  zaehlung  aus dem taeglichen Abgleich (la:belegzahl, length=1). Nur die Zahl.
Der Vorgabewert ist abzug, weil die 621 Zeilen vom 12.08.2026 ausnahmslos aus vollen
Abzuegen stammen. Ohne diese Trennung liesse sich nach wenigen Tagen nicht mehr sagen,
wann ein Ordner zuletzt wirklich geholt wurde — Zaehlungen kommen taeglich, Abzuege
nur bei Abweichung.';

-- Der Zugriffspfad von mart.belegarchiv_zulauf: je Paar die letzte
-- Zeile einer Quelle. Der Index aus 0053 laesst quelle aus und traegt
-- die Frage "letzter ABZUG" deshalb nicht.
CREATE INDEX IF NOT EXISTS belegarchiv_bestand_quelle
    ON core.belegarchiv_bestand (betrieb_key, typ_id, quelle, gemessen_am DESC);


-- ---------------------------------------------------------------------
-- 3. mart.belegarchiv_zulauf — damit Stillstand nicht wie Erfolg aussieht
--
-- Die Regel aus AGENTS.md: eine Quelle ohne Zulauf ist ein Fehler, kein
-- Normalzustand. Ein Zweig, der "nichts zu tun" bedeutet, muss sichtbar
-- sein — genau daran hat dieses Projekt zweimal Tage verloren.
--
-- Diese Sicht ist die Sichtbarkeit fuer das Belegarchiv. Sie fuehrt
-- JEDES Paar aus Betrieb und Belegart, auch die nie gezaehlten, und
-- benennt seinen Zustand in einem Wort.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.belegarchiv_zulauf AS
WITH zaehlung AS (
  SELECT DISTINCT ON (betrieb_key, typ_id)
         betrieb_key, typ_id, records_total, gemessen_am
    FROM core.belegarchiv_bestand
   WHERE quelle = 'zaehlung'
   ORDER BY betrieb_key, typ_id, gemessen_am DESC
), abzug AS (
  SELECT DISTINCT ON (betrieb_key, typ_id)
         betrieb_key, typ_id, records_total, gemessen_am
    FROM core.belegarchiv_bestand
   WHERE quelle = 'abzug'
   ORDER BY betrieb_key, typ_id, gemessen_am DESC
), gehalten AS (
  SELECT betrieb_key, typ_id, count(*) AS ist,
         max(hochgeladen_am) AS letzter_beleg
    FROM core.buchungsbeleg
   GROUP BY betrieb_key, typ_id
)
SELECT b.betrieb_key,
       b.lina_betrieb_id,
       b.name                                    AS betrieb,
       stt.status                                AS betrieb_status,
       (stt.status = 'operativ')                 AS operativ,
       a.typ_id,
       a.name                                    AS ordner,
       a.inhalt_holen,
       z.records_total                           AS gezaehlt,
       z.gemessen_am                             AS zuletzt_gezaehlt,
       -- Auf integer geholt: count(*) ist bigint, und bigint kommt bei
       -- node-postgres als ZEICHENKETTE an (Genauigkeitsverlust in JS waere
       -- die Alternative). Eine Ordnergroesse passt millionenfach in int.
       g_.ist::int                               AS gehalten,
       v.gemessen_am                             AS zuletzt_abgezogen,
       g_.letzter_beleg,
       (coalesce(z.records_total, 0) - coalesce(g_.ist, 0))::int AS differenz,
       CASE
         WHEN z.gemessen_am IS NULL
           THEN 'nie gezaehlt'
         WHEN coalesce(z.records_total, 0) = coalesce(g_.ist, 0)
           THEN 'vollstaendig'
         WHEN NOT a.inhalt_holen
           THEN 'gezaehlt, nicht freigegeben'
         WHEN EXISTS (SELECT 1 FROM sync.warteschlange w
                       WHERE w.endpunkt = 'la:belegliste'
                         AND w.erledigt_am IS NULL
                         AND w.parameter->>'linaBetriebId' = b.lina_betrieb_id::text
                         AND w.parameter->>'typeId' = a.typ_id)
           THEN 'abzug eingereiht'
         ELSE 'abzug fehlt'
       END                                       AS zustand
  FROM core.betrieb b
  CROSS JOIN core.belegart a
  LEFT JOIN mart.betrieb_status stt ON stt.betrieb_key = b.betrieb_key
  LEFT JOIN zaehlung z ON z.betrieb_key = b.betrieb_key AND z.typ_id = a.typ_id
  LEFT JOIN abzug    v ON v.betrieb_key = b.betrieb_key AND v.typ_id = a.typ_id
  LEFT JOIN gehalten g_ ON g_.betrieb_key = b.betrieb_key AND g_.typ_id = a.typ_id
 WHERE b.lina_betrieb_id IS NOT NULL
   AND a.zweig = 'fibu';

COMMENT ON VIEW mart.belegarchiv_zulauf IS
'Bekommt das Belegarchiv noch Zulauf? Eine Zeile je Betrieb und Ordner, 1.834
insgesamt. Die Arbeitsliste steht in zustand:

  vollstaendig                 LINAs Zaehlung und unser Bestand stimmen ueberein.
  abzug eingereiht             Abweichung erkannt, der Abzug steht in der Schlange.
  abzug fehlt                  Abweichung erkannt, aber kein offener Posten. Das ist
                               der Befund, auf den man sehen will — er heisst, dass
                               das Nachreihen nicht greift.
  gezaehlt, nicht freigegeben  Dort liegen Belege, aber core.belegart.inhalt_holen
                               ist false. Betrifft die sechs nie geholten Belegarten
                               und ist die Entscheidungsgrundlage fuer Punkt 3 in
                               docs/plan-datenvollstaendigkeit.md Abschnitt 4.
  nie gezaehlt                 Noch keine Zaehlung. Vor dem ersten Lauf mit
                               la:belegzahl gilt das fuer alle 1.834 Zeilen.

WARUM ES DIESE SICHT GIBT: zwischen dem 12. und dem 13.08.2026 stand das Belegarchiv
still, waehrend der Lauf 269 von 269 Aufgaben als ok meldete. Ein Log-WARN haette das
nicht geaendert, weil niemand Logs liest. differenz und zustand stehen deshalb in der
Datenbank, wo auch die Zahlen stehen.

differenz rechnet Zaehlstand minus Bestand. NEGATIV heisst, wir halten mehr als LINA
zaehlt — moeglich, wenn dort ein Beleg geloescht wurde. Auch das loest einen Abzug aus,
weil die Bedingung auf UNGLEICH prueft und nicht auf KLEINER.';


-- ---------------------------------------------------------------------
-- 4. mart.inventur_abgeschnitten — die zweite lautlose Luecke
--
-- /api/erp/stocktakings/{uuid}/items ist paginiert (perPage 800) und
-- sagt das auch. Der Pfadbau kannte bis zum 13.08.2026 keinen
-- page-Parameter: geholt wurde immer Seite 1. Gemessen in Produktion —
-- keine der 358 Inventuren hat mehr als 800 Positionen, das Maximum ist
-- exakt 800, neun stossen an und es fehlen zusammen 936 Positionen.
--
-- Der Kopf weiss es besser als die Zeilen: core.inventur.anzahl_positionen
-- kommt aus totalNumberOfItems der Liste und geht bis 1.426. Genau diese
-- Differenz macht die Sicht sichtbar — sie ist zugleich die Gegenprobe
-- dafuer, dass die Paginierung wirkt.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.inventur_abgeschnitten AS
SELECT i.inventur_key,
       m.name                AS marke,
       ks.name               AS kostenstelle,
       i.fn_uuid,
       i.name,
       i.status,
       i.erstellt_am::date   AS erstellt,
       i.anzahl_positionen   AS kopf_sagt,
       p.geladen,
       i.anzahl_positionen - p.geladen AS fehlend,
       (p.geladen % 800 = 0 AND p.geladen > 0) AS endet_auf_seitengrenze
  FROM core.inventur i
  JOIN core.kostenstelle ks USING (kostenstelle_key)
  JOIN core.marke m USING (marke_key)
  JOIN LATERAL (SELECT count(*) AS geladen
                  FROM core.inventurposition ip
                 WHERE ip.inventur_key = i.inventur_key) p ON true
 WHERE i.anzahl_positionen IS NOT NULL
   AND i.anzahl_positionen > p.geladen
 ORDER BY (i.anzahl_positionen - p.geladen) DESC;

COMMENT ON VIEW mart.inventur_abgeschnitten IS
'Inventuren, deren Kopf mehr Positionen meldet, als geladen sind. ERWARTUNG: leer.

Am 13.08.2026 standen hier neun Zeilen mit zusammen 936 fehlenden Positionen, alle
bei geladen = 800 — der Seitengrenze von /api/erp/stocktakings/{uuid}/items. Der
Fehler war lautlos: HTTP 200, kein Fehler, kein Log, nur eine Inventur, die genau
bei 800 endet. Betroffen waren die groessten Inventuren, also die mit dem hoechsten
Warenwert; mart.inventur_schwund rechnete fuer sie einen zu kleinen Bestand.

endet_auf_seitengrenze trennt die beiden Ursachen: true heisst abgeschnittene
Paginierung, false heisst, dass FoodNotify im Kopf etwas anderes zaehlt als in den
Zeilen (etwa geloeschte Positionen). Nur das erste ist ein Fehler bei uns.

Eine Zeile mit einer FEHLENDEN Zaehlung ist etwas anderes als eine fehlende Position:
28,7 Prozent aller Inventurpositionen tragen keine gezaehlte Menge. Das steht in
core.inventurposition.gezaehlt_menge und ist hier nicht gemeint.';


-- ---------------------------------------------------------------------
-- 5. Die beiden neuen Befunde in die erste Abfrage nach einem Backfill
--
-- mart.pruefung_uebersicht ist die Gewohnheit, die es schon gibt
-- (AGENTS.md: "Nach jedem groesseren Backfill zuerst"). Ein Waechter,
-- der eine eigene Gewohnheit braucht, entsteht nie.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS
SELECT 'Umsatz: Artikelsumme vs. Umsatzbericht' AS pruefung,
       count(*)                                  AS geprueft,
       count(*) FILTER (WHERE auffaellig)        AS auffaellig,
       'mart.pruefung_umsatz'                    AS sicht
  FROM mart.pruefung_umsatz
UNION ALL
SELECT 'Bon: avgTicket vs. Umsatz/Rechnungen',
       count(*), count(*) FILTER (WHERE auffaellig), 'mart.pruefung_bon'
  FROM mart.pruefung_bon
UNION ALL
SELECT 'Belegarchiv: Ordner ohne den faelligen Abzug',
       count(*), count(*) FILTER (WHERE zustand = 'abzug fehlt'),
       'mart.belegarchiv_zulauf'
  FROM mart.belegarchiv_zulauf
UNION ALL
SELECT 'Belegarchiv: seit ueber 36 h nicht gezaehlt',
       count(*),
       count(*) FILTER (WHERE zuletzt_gezaehlt IS NULL
                           OR zuletzt_gezaehlt < now() - interval '36 hours'),
       'mart.belegarchiv_zulauf'
  FROM mart.belegarchiv_zulauf
UNION ALL
SELECT 'Inventur: Zaehlung abgeschnitten',
       (SELECT count(*) FROM core.inventur WHERE anzahl_positionen IS NOT NULL),
       count(*), 'mart.inventur_abgeschnitten'
  FROM mart.inventur_abgeschnitten
UNION ALL
SELECT 'Bestellung: Kopf ohne eine einzige Position',
       count(*), count(*) FILTER (WHERE NOT EXISTS (
                   SELECT 1 FROM core.bestellposition p
                    WHERE p.bestellung_key = b.bestellung_key)),
       'core.bestellung'
  FROM core.bestellung b
UNION ALL
SELECT 'Warteschlange: aufgegebene Posten',
       count(*), count(*) FILTER (WHERE ergebnis = 'aufgegeben'),
       'sync.warteschlange'
  FROM sync.warteschlange;

COMMENT ON VIEW mart.pruefung_uebersicht IS
'Erste Abfrage nach jedem groesseren Backfill: SELECT * FROM mart.pruefung_uebersicht;
Die Spalte auffaellig ist eine Arbeitsliste, kein Alarm.

Am 13.08.2026 sind vier Zeilen dazugekommen, alle aus demselben Anlass: eine Quelle
ohne Zulauf ist ein Fehler und kein Normalzustand, und der Lauf hat sie zweimal als
"ok" gemeldet. Was sie beim Anlegen zeigten:

  Belegarchiv: Ordner ohne den faelligen Abzug       0 von 1.834 (vor dem ersten Lauf
                                                     mit la:belegzahl; alle Zeilen
                                                     stehen dann auf "nie gezaehlt")
  Belegarchiv: seit ueber 36 h nicht gezaehlt    1.834 von 1.834
  Inventur: Zaehlung abgeschnitten                   9 von 358, 936 Positionen
  Bestellung: Kopf ohne eine einzige Position      322 von 67.229, 686.535,93 EUR
  Warteschlange: aufgegebene Posten                275 von 168.000, alle
                                                   fn:bestellpositionen mit HTTP 500

Die Zeile "Wareneinsatz: Abdeckung unter 90 %" ist am 01.08.2026 entfallen (Migration
0029). Sie hat nie ausgeloest, weil ihr Filter auf IS NOT NULL prueft und fixer_we nie
NULL ist, sondern 0. Ein Waechter, der immer gruen zeigt, ist schlimmer als keiner.

Der Soll-Ist-Vergleich des Wareneinsatzes kommt in Stufe 2.4 auf Basis der
FoodNotify-Zutatenkosten zurueck, siehe docs/plan-foodnotify.md.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0069', to_jsonb(
        'Belegarchiv-Zulauf: core.belegart.inhalt_holen und '
        'core.belegarchiv_bestand.quelle neu, dazu mart.belegarchiv_zulauf und '
        'mart.inventur_abgeschnitten. Der Torwaechter ist ab sofort die taegliche '
        'Zaehlung (la:belegzahl) statt manual.belegarchiv_soll, das seit dem '
        '11.08.2026 kein Code fortgeschrieben hat. Anlass: zwei Tage ohne einen '
        'einzigen neuen Beleg, bei taeglich 269 von 269 Aufgaben "ok".'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
