-- =====================================================================
-- 0086 — Wetter je Betrieb und Geschaeftstag (Plan Kalender/Wetter, Phase 3)
--
-- QUELLE: Bright Sky auf DWD-Messdaten (api.brightsky.dev), Entscheidung
-- E1 vom 20.08.2026. Open-Meteo waere bequemer, aber sein kostenloser
-- Zugang ist ausdruecklich auf NICHT-GEWERBLICHE Nutzung beschraenkt.
-- DWD-Daten sind unter GeoNutzV auch gewerblich frei — mit
-- Namensnennung, die ins Dashboard gehoert. Begruendung in
-- docs/entscheidungen.md.
--
-- AM 20.08.2026 NACHGEMESSEN, ein Aufruf, ein Gitterpunkt, ein Jahr:
--
--   8.737 Stundenwerte fuer 2025, 5,1 MB, naechste Station 5,2 km
--   temperatur, niederschlag, bewoelkung, wind, zustand   100,0 % belegt
--   sonnenschein                                           94,6 % belegt
--
-- Zwei Eigenheiten der Schnittstelle, die Geld kosten, wenn man sie
-- uebersieht:
--
--   1. `last_date` liefert nur die Stunde 00:00 DIESES Tages, nicht den
--      ganzen Tag. Ein Aufruf mit date=2025-01-01&last_date=2025-12-31
--      bringt 8.737 statt 8.760 Werte — die letzten 23 Stunden fehlen.
--      Der Abruf setzt `last_date` deshalb auf den FOLGETAG.
--   2. `sunshine` ist in 5,4 % der Stunden NULL. Der Sonnenanteil wird
--      deshalb gegen die Zahl der BELEGTEN Stunden gerechnet, nicht gegen
--      24 — sonst sieht ein Tag mit Messluecke truebe aus.
--
-- WARUM STUENDLICH UND NICHT GLEICH DER TAGESWERT. 48 Gitterpunkte x
-- 3.144 Tage x 24 h sind rund 3,6 Mio Zeilen — neben 27,7 Mio
-- Artikelzeilen nichts. Dafuer ist "wie war das Wetter zur Mittagszeit"
-- spaeter ohne neuen Abruf beantwortbar. Ein Gewitter um 4 Uhr raeumt
-- keine Terrasse; ein Tagesmaximum weiss das nicht.
--
-- DER SCHLUESSEL IST DIE GERUNDETE KOORDINATE, keine eigene Orts-ID:
-- zwei Nachkommastellen sind rund 1,1 km und damit weit unter dem
-- Stationsabstand. 48 Gitterpunkte fuer 60 Betriebe, keine
-- ID-Verwaltung, und zwei Betriebe an derselben Adresse bekommen
-- bauartbedingt dasselbe Wetter.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die Gitterpunkte
--
-- Abgeleitet und nicht gepflegt: wer einen Standort nachtraegt, bekommt
-- seinen Gitterpunkt ohne Codeeingriff. Genau die Eigenschaft, die der
-- Plan fuer die Standortluecke verlangt.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.wetter_ort AS
SELECT round(s.breitengrad, 2) AS breite,
       round(s.laengengrad, 2) AS laenge,
       count(*)::int           AS betriebe,
       string_agg(b.name, ', ' ORDER BY b.name) AS betriebsnamen
  FROM manual.betrieb_standort s
  JOIN core.betrieb b ON b.betrieb_key = s.betrieb_key
 WHERE s.breitengrad IS NOT NULL
 GROUP BY 1, 2;

COMMENT ON VIEW mart.wetter_ort IS
'Die Gitterpunkte, fuer die Wetter geholt wird — auf zwei Nachkommastellen gerundete '
'Koordinaten aus manual.betrieb_standort (rund 1,1 km, weit unter dem Stationsabstand). '
'Abgeleitet, nicht gepflegt: ein nachgetragener Standort bringt seinen Gitterpunkt mit. '
'Am 20.08.2026 sind es 48 Punkte fuer 60 Betriebe; 81 Betriebe haben keine Koordinate '
'und bekommen bauartbedingt kein Wetter (mart.kalender_fehlend).';


-- ---------------------------------------------------------------------
-- 2. Die Stundenwerte
--
-- ZEITPUNKT IST timestamptz UND DAMIT UTC-VERANKERT, nicht Ortszeit.
-- Der Grund ist die Zeitumstellung: in der Nacht zur Winterzeit gibt es
-- 02:00 Ortszeit ZWEIMAL. Ein Schluessel auf der Ortszeit kollidiert
-- dort, ein Schluessel auf dem Zeitpunkt nicht. Geschaeftstag und Stunde
-- werden beim Lesen abgeleitet — core.geschaeftstag() macht das ohnehin
-- richtig.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manual.wetter_stunde (
  breite        numeric(5,2) NOT NULL,
  laenge        numeric(5,2) NOT NULL,
  zeitpunkt     timestamptz  NOT NULL,
  temperatur    numeric(5,1),
  niederschlag  numeric(6,2),
  sonnenschein  numeric(5,1),   -- Minuten in dieser Stunde, 0-60
  wind          numeric(6,1),
  bewoelkung    smallint,
  luftfeuchte   smallint,
  zustand       text,
  station_id    integer,
  distanz_m     integer,
  geholt_am     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (breite, laenge, zeitpunkt)
);

COMMENT ON TABLE manual.wetter_stunde IS
'Stundenwerte je Gitterpunkt, von Bright Sky auf DWD-Messdaten. zeitpunkt ist '
'UTC-verankert und nicht Ortszeit — sonst kollidierte die Nacht der Zeitumstellung, in '
'der 02:00 zweimal vorkommt. station_id und distanz_m stehen dabei, weil eine Messung '
'aus 25 km etwas anderes ist als eine aus 3 km.';

COMMENT ON COLUMN manual.wetter_stunde.sonnenschein IS
'Sonnenminuten in dieser Stunde, 0 bis 60. In 5,4 % der Stunden liefert der DWD nichts '
'(nachgemessen ueber 8.737 Stunden am 20.08.2026) — dann NULL und nicht 0, sonst sieht '
'eine Messluecke aus wie Bewoelkung.';

COMMENT ON COLUMN manual.wetter_stunde.distanz_m IS
'Abstand der DWD-Station vom Gitterpunkt. Bright Sky faellt je Feld auf die naechste '
'Station zurueck, die es misst; der Wert hier ist der der Hauptstation.';

CREATE INDEX IF NOT EXISTS wetter_stunde_zeit ON manual.wetter_stunde (zeitpunkt);


-- ---------------------------------------------------------------------
-- 3. Verdichtung auf den Geschaeftstag — ZWEI Saetze
--
-- DER GESCHAEFTSTAG BEGINNT UM 08:00 BERLINER ZEIT, nicht um
-- Mitternacht: core.geschaeftstag() zieht acht Stunden ab. Wer hier
-- naiv auf den Kalendertag verdichtet, verschiebt das Wetter um acht
-- Stunden gegen den Umsatz — und zwar so, dass es niemandem auffaellt.
--
-- FENSTER 08-24 (Entscheidung E2 vom 20.08.2026, Eugene): die ersten 16
-- Stunden des Geschaeftstags. Deckt 99,5 % des Umsatzes 2026, gemessen
-- ueber core.zeitzonenbericht_stunde. Draussen bleiben die Stunden 0 bis
-- 7 des Folgemorgens — 0,5 % des Umsatzes und die Nachttiefstwerte.
--
-- GANZTAGS ist der VOLLE Geschaeftstag, also 08:00 bis 08:00. Beide
-- Saetze werden gespeichert, damit die Wahl des Fensters ueberpruefbar
-- bleibt statt verdrahtet zu sein. Sie unterscheiden sich vor allem im
-- Temperatur-MINIMUM: die Nacht liegt nur im Ganztagssatz.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.wetter_tag AS
WITH stunde AS (
  SELECT w.breite, w.laenge,
         core.geschaeftstag(w.zeitpunkt) AS geschaeftstag,
         extract(hour FROM w.zeitpunkt AT TIME ZONE 'Europe/Berlin')::int AS stunde,
         w.temperatur, w.niederschlag, w.sonnenschein, w.wind,
         w.bewoelkung, w.zustand, w.distanz_m
    FROM manual.wetter_stunde w
)
SELECT breite, laenge, geschaeftstag,
       count(*)::int                                    AS stunden_ganztags,
       count(*) FILTER (WHERE stunde >= 8)::int         AS stunden_fenster,
       min(distanz_m)                                   AS distanz_m,

       -- Fenster 08-24
       round(max(temperatur)   FILTER (WHERE stunde >= 8), 1) AS fenster_temp_max,
       round(min(temperatur)   FILTER (WHERE stunde >= 8), 1) AS fenster_temp_min,
       round(avg(temperatur)   FILTER (WHERE stunde >= 8), 1) AS fenster_temp_schnitt,
       round(sum(niederschlag) FILTER (WHERE stunde >= 8), 2) AS fenster_niederschlag,
       round(max(wind)         FILTER (WHERE stunde >= 8), 1) AS fenster_wind_max,
       round(avg(bewoelkung)   FILTER (WHERE stunde >= 8), 0) AS fenster_bewoelkung,
       -- Gegen die BELEGTEN Stunden, nicht gegen 16: eine Messluecke ist
       -- keine Bewoelkung.
       round(100.0 * sum(sonnenschein) FILTER (WHERE stunde >= 8)
             / nullif(60.0 * count(sonnenschein) FILTER (WHERE stunde >= 8), 0), 1)
                                                              AS fenster_sonne_pct,
       count(sonnenschein) FILTER (WHERE stunde >= 8)::int    AS fenster_sonne_stunden,
       mode() WITHIN GROUP (ORDER BY zustand) FILTER (WHERE stunde >= 8)
                                                              AS fenster_zustand,

       -- Voller Geschaeftstag 08:00-08:00
       round(max(temperatur), 1)   AS tag_temp_max,
       round(min(temperatur), 1)   AS tag_temp_min,
       round(avg(temperatur), 1)   AS tag_temp_schnitt,
       round(sum(niederschlag), 2) AS tag_niederschlag,
       round(max(wind), 1)         AS tag_wind_max,
       round(avg(bewoelkung), 0)   AS tag_bewoelkung,
       round(100.0 * sum(sonnenschein) / nullif(60.0 * count(sonnenschein), 0), 1)
                                   AS tag_sonne_pct,
       mode() WITHIN GROUP (ORDER BY zustand) AS tag_zustand
  FROM stunde
 GROUP BY breite, laenge, geschaeftstag;

COMMENT ON VIEW mart.wetter_tag IS
'Wetter je Gitterpunkt und GESCHAEFTSTAG — und der beginnt um 08:00 Berliner Zeit, nicht '
'um Mitternacht. Zwei Saetze: fenster_* sind die ersten 16 Stunden (08-24, Entscheidung '
'E2, deckt 99,5 % des Umsatzes), tag_* ist der volle Geschaeftstag von 08:00 bis 08:00. '
'Beide, damit die Wahl des Fensters ueberpruefbar bleibt; sie unterscheiden sich vor '
'allem im Temperatur-Minimum, weil die Nacht nur im Ganztagssatz liegt. '
'stunden_fenster < 16 heisst: die Reihe hat Luecken.';


-- ---------------------------------------------------------------------
-- 4. Wetter am Betrieb
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.betrieb_wetter_tag AS
SELECT s.betrieb_key, b.name AS betrieb, w.*
  FROM manual.betrieb_standort s
  JOIN core.betrieb b ON b.betrieb_key = s.betrieb_key
  JOIN mart.wetter_tag w
    ON w.breite = round(s.breitengrad, 2) AND w.laenge = round(s.laengengrad, 2)
 WHERE s.breitengrad IS NOT NULL;

COMMENT ON VIEW mart.betrieb_wetter_tag IS
'mart.wetter_tag auf den Betrieb gezogen. Enthaelt nur die 60 Betriebe mit gepflegter '
'Koordinate — die uebrigen 81 stehen in mart.kalender_fehlend und bekommen bauartbedingt '
'kein Wetter.';


-- ---------------------------------------------------------------------
-- 5. Der Vergleichstag bekommt seine Wetterspalten
--
-- Nur die duenne Huelle wird ersetzt; die Materialisierung darunter
-- bleibt unangetastet. Angehaengt und nicht eingeschoben, damit
-- CREATE OR REPLACE durchgeht.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.vergleichstag AS
SELECT v.betrieb_key, v.betrieb, v.geschaeftstag, v.wochentag, v.feiertag, v.ist_schulferien,
       v.umsatz_netto, v.gaeste, v.vergleichstage, v.umsatz_vergleich, v.gaeste_vergleich,
       v.abweichung_pct, v.ferien_abweichung, v.vergleich_von, v.vergleich_bis,
       v.monat, v.wochentag_nr, v.bundesland_kuerzel, v.bundesland, v.kalender_quelle,
       v.ist_feiertag, v.schulferien, v.vortag_feiertag, v.folgetag_feiertag,
       w.fenster_temp_max     AS temp_max,
       w.fenster_temp_min     AS temp_min,
       w.fenster_niederschlag AS niederschlag,
       w.fenster_sonne_pct    AS sonne_pct,
       w.fenster_bewoelkung   AS bewoelkung,
       w.fenster_zustand      AS wetter_zustand,
       w.distanz_m            AS wetter_distanz_m
  FROM mart.vergleichstag_basis v
  LEFT JOIN mart.betrieb_wetter_tag w
    ON w.betrieb_key = v.betrieb_key AND w.geschaeftstag = v.geschaeftstag;

COMMENT ON VIEW mart.vergleichstag IS
'Duenne Huelle ueber mart.vergleichstag_basis, seit 0086 mit den Wetterspalten aus dem '
'Fenster 08-24. LEFT JOIN, weil 81 Betriebe keine Koordinate haben und der Backfill '
'nachts laeuft: leere Wetterspalten sind der Normalfall und kein Fehler. Wer auf Wetter '
'auswertet, filtert auf temp_max IS NOT NULL.';


-- ---------------------------------------------------------------------
-- 6. Der Rueckstand des Backfills — sichtbar, nicht im Log (Regel 10)
--
-- Eine Nachfuellung, die nachts von selbst laeuft, braucht eine Zahl,
-- die FAELLT. Ohne sie sieht ein abgebrochener Backfill genauso aus wie
-- ein fertiger.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.wetter_rueckstand AS
WITH jahre AS (
  SELECT generate_series(
           extract(year FROM (SELECT min(geschaeftstag) FROM mart.umsatz_tag))::int,
           extract(year FROM current_date)::int) AS jahr
), soll AS (
  SELECT o.breite, o.laenge, j.jahr FROM mart.wetter_ort o CROSS JOIN jahre j
), ist AS (
  SELECT breite, laenge,
         extract(year FROM zeitpunkt AT TIME ZONE 'Europe/Berlin')::int AS jahr,
         count(*)::int AS stunden
    FROM manual.wetter_stunde
   GROUP BY 1, 2, 3
)
SELECT s.breite, s.laenge, s.jahr,
       coalesce(i.stunden, 0) AS stunden,
       CASE WHEN i.stunden IS NULL                      THEN 'fehlt'
            WHEN s.jahr = extract(year FROM current_date)::int THEN 'laufendes Jahr'
            WHEN i.stunden < 8000                       THEN 'unvollstaendig'
            ELSE 'vollstaendig' END AS zustand
  FROM soll s LEFT JOIN ist i
    ON i.breite = s.breite AND i.laenge = s.laenge AND i.jahr = s.jahr;

COMMENT ON VIEW mart.wetter_rueckstand IS
'Eine Zeile je Gitterpunkt und Jahr — die Arbeitsliste des Wetter-Backfills. Die Zahl der '
'Zeilen mit zustand = fehlt MUSS von Nacht zu Nacht fallen und 0 erreichen; tut sie das '
'nicht, laeuft der Nachlauf nicht mehr. Unter 8.000 Stunden heisst unvollstaendig — ein '
'volles Jahr sind rund 8.760.';


-- ---------------------------------------------------------------------
-- 7. Das Quellenregister kennt jetzt auch Wetter
--
-- sync.quelle.system war auf fuenf Werte beschraenkt; Bright Sky ist
-- keiner davon und waere unter 'intern' schlicht falsch einsortiert.
-- ---------------------------------------------------------------------
ALTER TABLE sync.quelle DROP CONSTRAINT IF EXISTS quelle_system_check;
ALTER TABLE sync.quelle ADD CONSTRAINT quelle_system_check
  CHECK (system = ANY (ARRAY['lina', 'ladenakte', 'foodnotify', 'yext', 'intern', 'wetter']));


-- ---------------------------------------------------------------------
-- 8. Pruefzeilen — neu erzeugt, jetzt mit den zwei Wetterzeilen
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pruefung_kalender AS
SELECT 'Vergleichstag: Materialisierung aelter als der letzte Lauf'::text AS pruefung,
       1 AS geprueft,
       count(*) FILTER (WHERE zustand <> 'aktuell')::int AS auffaellig,
       'mart.vergleichstag_stand'::text AS sicht
  FROM mart.vergleichstag_stand
UNION ALL
SELECT 'Vergleichstag: Betrieb mit Umsatz, aber ohne Bundesland'::text,
       (SELECT count(DISTINCT betrieb_key)::int FROM mart.umsatz_tag),
       count(*)::int,
       'mart.kalender_fehlend'::text
  FROM mart.kalender_fehlend
UNION ALL
SELECT 'Feiertag: Name endet vor dem Ende der Historie'::text,
       (SELECT count(DISTINCT name)::int FROM mart.feiertag_normiert),
       count(*)::int,
       'mart.feiertag_namenswechsel'::text
  FROM mart.feiertag_namenswechsel
UNION ALL
-- ERWARTUNG: 0. Das rollierende Fenster holt die letzten 14 Tage jede
-- Nacht neu; fehlt gestern ein Gitterpunkt, hat der Nachlauf nicht
-- gearbeitet oder die Quelle antwortet nicht mehr.
SELECT 'Wetter: Gitterpunkt ohne Messwert fuer gestern'::text,
       (SELECT count(*)::int FROM mart.wetter_ort),
       (SELECT count(*)::int FROM mart.wetter_ort o
         WHERE NOT EXISTS (SELECT 1 FROM manual.wetter_stunde w
                            WHERE w.breite = o.breite AND w.laenge = o.laenge
                              AND core.geschaeftstag(w.zeitpunkt) = current_date - 1)),
       'mart.wetter_rueckstand'::text
UNION ALL
-- ERWARTUNG: FAELLT, erreicht 0. Eine Zahl, die stehenbleibt, ist ein
-- abgebrochener Nachlauf — und der sieht sonst aus wie ein fertiger.
SELECT 'Wetter: Backfill-Rueckstand in Ortsjahren'::text,
       count(*)::int,
       count(*) FILTER (WHERE zustand IN ('fehlt', 'unvollstaendig'))::int,
       'mart.wetter_rueckstand'::text
  FROM mart.wetter_rueckstand;

COMMENT ON VIEW mart.pruefung_kalender IS
'Die Pruefzeilen rund um Kalender, Vergleichstag und Wetter. Eigene Sicht, damit eine '
'parallel entwickelte Migration sie nicht beim Neuerzeugen von mart.pruefung_uebersicht '
'verschluckt. Erwartungen: Materialisierung 0, Betriebe ohne Bundesland konstant 9, '
'Namenswechsel 0, Gitterpunkt ohne Messwert 0, Backfill-Rueckstand faellt auf 0.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0086', to_jsonb(
        'Wetter je Gitterpunkt und Geschaeftstag, von Bright Sky auf DWD-Messdaten '
        '(GeoNutzV, gewerblich frei, Namensnennung noetig). Stuendlich gespeichert, '
        'damit die Frage nach der Mittagszeit ohne neuen Abruf beantwortbar bleibt. '
        'Zwei Verdichtungen je Tag: Fenster 08-24 (99,5 % des Umsatzes) und der '
        'volle Geschaeftstag — und der beginnt um 08:00 Berliner Zeit, nicht um '
        'Mitternacht. Ein Aufruf liefert ein volles Jahr (8.737 Stunden fuer 2025, '
        'nachgemessen); last_date muss dabei auf den Folgetag zeigen, sonst fehlen '
        'die letzten 23 Stunden.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
