-- =====================================================================
-- 0111 — Die Wettersicht wird materialisiert. Nicht wegen eines Fehlers,
--        sondern wegen eines Sockels, den JEDE Wetterabfrage bezahlt hat.
--
-- BEFUND VOM 21.09.2026, in Produktion nachgemessen. mart.wetter_tag
-- gruppiert bei JEDER Abfrage alle 3,42 Mio. Zeilen von
-- manual.wetter_stunde (48 Gitterpunkte, 2018 bis heute) nach
-- core.geschaeftstag(zeitpunkt). Der Gruppenschluessel ist ein
-- FUNKTIONSWERT, und daran haengt alles:
--
--   * Es gibt keinen Index, der darauf passt (ein Ausdrucksindex auf
--     geschaeftstag() existiert nicht und wurde in 0110 ausdruecklich
--     geprueft).
--   * Ein Datumsfilter kommt NICHT vor die Aggregation. Wer einen
--     einzelnen Tag will, laesst trotzdem alle 3,42 Mio. Zeilen
--     verdichten und wirft danach 99,97 % des Ergebnisses weg.
--
-- GEMESSEN IN PRODUKTION, 21.09.2026:
--
--   mart.vergleichstag_basis, ein Jahr                     0,08 s
--   mart.wetter_tag, EIN Tag                               4,5  s
--   mart.betrieb_wetter_tag, EIN Tag                       7,4  s
--   mart.betrieb_wetter_tag, ein Jahr                      7,4  s
--
-- Die letzten zwei Zeilen sind die Aussage: ein Tag kostet genauso viel
-- wie ein Jahr, weil der Filter nichts einspart. Und 0,08 s gegen 7,4 s
-- sagt, wo der Sockel sitzt — nicht im Vergleichstag, sondern im Wetter.
--
-- WAS DAS GEKOSTET HAT. Jede Abfrage auf mart.vergleichstag, die eine
-- Wetterspalte anfasst, zahlt den Sockel mit; eine Jahresauswertung lief
-- am 21.09.2026 in die 20-s-Grenze der Leserolle mcp_leser und kam als
-- SQLSTATE 57014 zurueck. Im Gesundheitslauf des MCP-Servers (0110)
-- stehen die drei Wettersichten als "unklar": in 5 s keine Zeile. Sie
-- sind nicht defekt, sie sind zu langsam — und mart.sicht_unklar hat
-- genau das gemeldet, eine Nacht nachdem 0110 sie lesbar gemacht hat.
--
-- WARUM DAS HIER EINFACHER IST ALS BEI 0084. Der Vergleichstag war nicht
-- materialisierbar, ohne ihn vorher von LATERAL auf Fensterfunktionen
-- umzubauen; deshalb steht in 0084 eine Gegenprobe auf Wertgleichheit.
-- Hier wird NICHTS umgebaut. Die Abfrage bleibt Zeichen fuer Zeichen die
-- aus 0087; sie wandert nur von der Sicht in eine Tabelle. Wertgleichheit
-- ist damit keine Behauptung, die zu beweisen waere — die Stichprobe in
-- src/wetter/wetter_tag.test.ts prueft sie trotzdem gegen eine direkte
-- Aggregation ueber manual.wetter_stunde, weil der naechste Eingriff in
-- diese Datei genau das brechen kann.
--
-- NACHGEMESSEN AUF EINEM KLON AM 21.09.2026 (lina_0111, Stand 0110,
-- 657.334 Stundenwerte, 48 Gitterpunkte — ein Fuenftel des
-- Produktionsbestands), als Rolle mcp_leser, drei Laeufe:
--
--                                              vorher         nachher
--   mart.wetter_tag, EIN Tag                183–187 ms      0,3–0,4 ms
--   mart.betrieb_wetter_tag, EIN Tag        187–201 ms      0,4–0,8 ms
--   mart.vergleichstag, ein Jahr mit Wetter 300–315 ms    209–213   ms
--   mart.wetter_effekt_gruppe, ganz           1.673   ms    700     ms
--   mart.wettertag_lage, ein Jahr             2.881   ms     93     ms
--
--   REFRESH MATERIALIZED VIEW                 1,8–2,2 s
--   REFRESH ... CONCURRENTLY                  2,1–2,7 s
--
-- DER ERSTE CONCURRENTLY-REFRESH NACH DER MIGRATION BRAUCHTE 15,2 s, die
-- vier danach 2,1 bis 2,7 s. Wer ihn einmal messen will, messe ihn zweimal;
-- fuer den Nachtlauf ist die zweite Zahl die richtige.
--
-- ZWEI ZAHLEN, DIE MAN NICHT UEBERSEHEN SOLLTE:
--
--   * mart.vergleichstag faellt nur um ein Drittel, nicht auf Null. Was
--     uebrig bleibt, ist NICHT die Aggregation — mart.vergleichstag_basis
--     allein liefert dasselbe Jahr (48.504 Zeilen) in 1 bis 2 ms. Es ist der
--     LEFT JOIN auf mart.betrieb_wetter_tag ueber die gerundeten Koordinaten.
--     Das ist eine andere Baustelle und wird hier nicht angefasst.
--   * Der Klon traegt ein Fuenftel der Produktionszeilen; in Produktion ist
--     der Sockel entsprechend groesser und der Refresh laenger. Was NICHT
--     mitwaechst, ist die Abfrage danach: sie liest einen Index auf
--     geschaeftstag.
--
-- WER FRISCHT AUF: wetterNachlauf() in src/wetter/nachlauf.ts, am Ende
-- und in derselben Funktion. Grund steht dort — nur dieser Nachlauf
-- schreibt manual.wetter_stunde, also gehoert der Refresh hinter seinen
-- Schreibvorgang und nicht an eine dritte Stelle im Ablauf.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die Materialisierung
--
-- WOERTLICH DIE ABFRAGE AUS 0087, ohne eine einzige Aenderung: dieselben
-- zwei CTEs, dieselbe Fensterdefinition, dieselben 28 Spalten in
-- derselben Reihenfolge. Das ist Absicht und keine Bequemlichkeit — eine
-- "aufgeraeumte" Fassung waere eine zweite Wahrheit, und die Huelle
-- darunter darf nur dann per CREATE OR REPLACE ersetzt werden, wenn die
-- Spaltenliste Typ fuer Typ dieselbe bleibt.
--
-- core.geschaeftstag() BLEIBT DER GRUPPENSCHLUESSEL und bleibt SECURITY
-- DEFINER (0110). Hier kostet der Aufruf nichts mehr, was jemanden
-- interessieren muesste: er laeuft einmal je Refresh und nicht mehr einmal
-- je Abfrage.
--
-- MIT DATEN, nicht WITH NO DATA. Eine unbefuellte Materialisierung
-- beantwortet jedes SELECT mit PG 55000, und an ihr haengen sechs
-- Sichten — mart.wetter_tag, mart.betrieb_wetter_tag, mart.vergleichstag,
-- mart.wettertag_lage, mart.wetter_effekt und mart.wetter_effekt_gruppe.
-- Sie waeren vom Deploy bis zum ersten Nachtlauf alle sechs unlesbar,
-- und der Gesundheitslauf aus 0110 haette recht damit, sie als defekt zu
-- melden.
--
-- KEIN DROP DAVOR, anders als in 0084. Dort war die Huelle noch keine
-- Huelle; hier haengen sechs Sichten an dem Namen, und ein DROP ...
-- CASCADE wuerde sie beim zweiten Lauf still mitnehmen. Ein zweiter Lauf
-- soll deshalb laut scheitern — der Runner spielt eine angewendete
-- Migration ohnehin nicht erneut ein (public.schema_migration).
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mart.wetter_tag_basis AS
WITH stunde AS (
  SELECT w.breite, w.laenge,
         core.geschaeftstag(w.zeitpunkt) AS geschaeftstag,
         extract(hour FROM w.zeitpunkt AT TIME ZONE 'Europe/Berlin')::int AS stunde,
         w.temperatur, w.niederschlag, w.sonnenschein, w.wind,
         w.bewoelkung, w.zustand, w.distanz_m
    FROM manual.wetter_stunde w
), tag AS (
  SELECT breite, laenge, geschaeftstag,
         count(*)::int                                    AS stunden_ganztags,
         count(*) FILTER (WHERE stunde >= 8)::int         AS stunden_fenster,
         min(distanz_m)                                   AS distanz_m,
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
   GROUP BY breite, laenge, geschaeftstag
)
-- RANGE und nicht ROWS, wie in 0087: bei einer Luecke in der Reihe ginge
-- ROWS 28 ZEILEN zurueck und damit weiter als 28 Tage — still und ohne
-- Fehlermeldung.
SELECT t.*,
       round(avg(t.fenster_temp_max)  OVER w, 1) AS temp_norm,
       round(t.fenster_temp_max - avg(t.fenster_temp_max) OVER w, 1) AS temp_abweichung,
       round(avg(t.fenster_sonne_pct) OVER w, 1) AS sonne_norm,
       round(t.fenster_sonne_pct - avg(t.fenster_sonne_pct) OVER w, 1) AS sonne_abweichung_pp,
       count(*) OVER w AS norm_tage
  FROM tag t
WINDOW w AS (PARTITION BY t.breite, t.laenge ORDER BY t.geschaeftstag
             RANGE BETWEEN INTERVAL '28 days' PRECEDING AND INTERVAL '1 day' PRECEDING);


-- Der eindeutige Index ist die Voraussetzung fuer REFRESH ... CONCURRENTLY,
-- wie bei mart.vergleichstag_basis in 0084. Das Korn ist der Gruppen-
-- schluessel der Abfrage darueber, also (breite, laenge, geschaeftstag).
CREATE UNIQUE INDEX wetter_tag_basis_zeile
    ON mart.wetter_tag_basis (breite, laenge, geschaeftstag);

-- Und der Index, um den es ueberhaupt geht: der Datumsfilter, den die
-- Sicht bisher nicht verwerten konnte.
CREATE INDEX wetter_tag_basis_tag
    ON mart.wetter_tag_basis (geschaeftstag);


COMMENT ON MATERIALIZED VIEW mart.wetter_tag_basis IS
'Wetter je Gitterpunkt und GESCHAEFTSTAG, materialisiert — die Abfrage aus 0087, '
'unveraendert. Vorher gruppierte mart.wetter_tag bei JEDER Abfrage alle 3,42 Mio. '
'Stundenwerte nach core.geschaeftstag(zeitpunkt); ein Funktionswert als Gruppenschluessel '
'nimmt keinen Index an und laesst keinen Datumsfilter vor die Aggregation, deshalb kostete '
'EIN Tag genauso viel wie ein ganzes Jahr (7,4 s, gemessen 21.09.2026 in Produktion). '
'Wird vom naechtlichen Lauf aufgefrischt: wetterNachlauf() in src/wetter/nachlauf.ts, am '
'Ende und in derselben Funktion — nur sie schreibt manual.wetter_stunde. Ob das geschehen '
'ist, sagt mart.materialisierung_stand unter dem Merker wetter_tag_refresh.';

COMMENT ON COLUMN mart.wetter_tag_basis.sonne_abweichung_pp IS
'Sonnenanteil des Tages minus dem Schnitt der letzten 28 Tage an diesem Ort, in '
'Prozentpunkten. DIE ZAHL, AUF DIE ES ANKOMMT: der absolute Anteil (fenster_sonne_pct) '
'liegt im Januar bauartbedingt niedrig, weil acht der sechzehn Fensterstunden dunkel '
'sind — nachgemessen am 20.08.2026 waeren 71,2 % der Januartage "trueb" gegen 19,6 % im '
'Juni. Das ist Winter, nicht Wetter.';

COMMENT ON COLUMN mart.wetter_tag_basis.norm_tage IS
'Wie viele Tage den 28-Tage-Schnitt tatsaechlich trugen. Weniger als etwa 20 heisst: am '
'Anfang der Reihe oder eine Luecke im Backfill — die Abweichungsspalten sind dann '
'wackelig. mart.wetter_rueckstand sagt, ob noch etwas fehlt.';

COMMENT ON COLUMN mart.wetter_tag_basis.stunden_fenster IS
'Wie viele der sechzehn Fensterstunden (08-24) wirklich gemessen wurden. Unter 16 heisst: '
'die Reihe hat Luecken, und alle fenster_*-Werte stehen auf weniger Messungen als sonst.';


-- ---------------------------------------------------------------------
-- 2. Die alte Sicht bleibt, als duenne Huelle
--
-- Dieselben 28 Spaltennamen in derselben Reihenfolge mit denselben Typen —
-- das verlangt CREATE OR REPLACE VIEW, und daran haengen die sechs
-- Sichten darueber. Nachgesehen wurde vorher und nachher mit
-- \d mart.wetter_tag auf dem Klon; nichts angehaengt, nichts umsortiert.
--
-- Die Sichten darueber bleiben WOERTLICH, wie sie sind: keine von ihnen
-- weiss, dass unter mart.wetter_tag jetzt eine Tabelle liegt. Geprueft
-- ueber pg_depend, es sind genau sechs — mart.betrieb_wetter_tag, und
-- darauf mart.vergleichstag und mart.wettertag_lage, und darauf
-- mart.wetter_effekt und mart.wetter_effekt_gruppe.
--
-- mart.wetter_rueckstand ist NICHT dabei und das ist wichtig: die
-- Arbeitsliste des Backfills liest manual.wetter_stunde direkt. Sie sagt
-- dem Nachlauf also weiter die Wahrheit, auch wenn die Materialisierung
-- noch den Stand von gestern traegt.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.wetter_tag AS
SELECT breite,
       laenge,
       geschaeftstag,
       stunden_ganztags,
       stunden_fenster,
       distanz_m,
       fenster_temp_max,
       fenster_temp_min,
       fenster_temp_schnitt,
       fenster_niederschlag,
       fenster_wind_max,
       fenster_bewoelkung,
       fenster_sonne_pct,
       fenster_sonne_stunden,
       fenster_zustand,
       tag_temp_max,
       tag_temp_min,
       tag_temp_schnitt,
       tag_niederschlag,
       tag_wind_max,
       tag_bewoelkung,
       tag_sonne_pct,
       tag_zustand,
       temp_norm,
       temp_abweichung,
       sonne_norm,
       sonne_abweichung_pp,
       norm_tage
  FROM mart.wetter_tag_basis;

COMMENT ON VIEW mart.wetter_tag IS
'Wetter je Gitterpunkt und GESCHAEFTSTAG — und der beginnt um 08:00 Berliner Zeit, nicht '
'um Mitternacht. Zwei Saetze: fenster_* sind die ersten 16 Stunden (08-24, Entscheidung '
'E2, deckt 99,5 % des Umsatzes), tag_* ist der volle Geschaeftstag. Dazu die RELATIVEN '
'Spalten aus 0087: temp_abweichung und sonne_abweichung_pp messen gegen den Schnitt der '
'letzten 28 Tage AN DIESEM ORT, weil ein absoluter Sonnenanteil im Fenster 08-24 vor '
'allem die Jahreszeit misst. SEIT 0111 eine duenne Huelle ueber '
'mart.wetter_tag_basis: bis dahin verdichtete diese Sicht bei jeder Abfrage alle 3,42 '
'Mio. Stundenwerte, und ein einzelner Tag kostete so viel wie ein ganzes Jahr (7,4 s). '
'Der Preis dafuer: die Zahlen sind so frisch wie der letzte Refresh, nicht mehr live — '
'mart.materialisierung_stand sagt, wann das war.';


-- ---------------------------------------------------------------------
-- 3. Sichtbar machen (0091): ohne Eintrag hier meldet /status die neue
--    Sicht als "ohne Refresh", und die Pruefzeile
--    "Materialisierung: Sicht ohne Refresh im Nachlauf" springt von 0
--    auf 1. Definition aus 0106, eine Zeile mehr.
--
--    EIGENER MERKER, kein Anhaengen an einen bestehenden: der Refresh
--    laeuft in wetterNachlauf() und damit in Phase A, waehrend
--    vergleichstag_refresh in Phase B laeuft. Ein gemeinsamer Merker
--    wuerde zwei verschiedene Zeitpunkte als einen ausgeben.
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
    ('mart.pflichtartikel_artikel_basis',        'pflichtartikel_refresh',      'src/sync/pflichtartikel_sichten.ts'),
    -- 0111: das Wetter. Steht im Wetter-Nachlauf selbst, nicht in einem
    -- der vier Sammel-Nachlaeufe — nur er schreibt manual.wetter_stunde.
    ('mart.wetter_tag_basis',                    'wetter_tag_refresh',          'src/wetter/nachlauf.ts')
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
-- 4. Die Leserolle bekommt ihr SELECT-Recht
--
-- GRANT SELECT ON ALL TABLES deckt Materialisierungen mit ab. Der Aufruf
-- steht hier trotzdem, weil die Standardvergabe FOR ROLE <current_user>
-- gilt und nicht traegt, wenn eine Migration mit einem anderen Zugang
-- eingespielt wird — die Lehre vom 21.09.2026 (0110).
-- ---------------------------------------------------------------------
SELECT mcp.rechte_auffrischen();


-- ---------------------------------------------------------------------
-- 5. Der Katalog nimmt die neue Sicht auf
--
-- achsen_ableiten() traegt sie ein und leitet ihre Achsen ab; seit 0108
-- sieht es dafuer auch materialisierte Sichten (pg_attribute statt
-- information_schema). Koernung und Thema von Hand, damit sie nicht in
-- mcp.koernung_fehlend landet, und koernung_in_kommentare() bringt den
-- Satz zusaetzlich in den Tabellenkommentar — dort liest ihn Metabase.
-- ---------------------------------------------------------------------
SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht SET
    koernung = 'Gitterpunkt und Tag — die materialisierte Fassung von mart.wetter_tag',
    thema    = 'wetter',
    summen_erlaubt = false
 WHERE sicht = 'mart.wetter_tag_basis';

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();


-- ---------------------------------------------------------------------
-- 6. Die Gegenprobe im selben Zug, nach dem Vorbild von 0110.
--
--    Sechs Sichten haengen an dem Namen, den diese Migration von einer
--    Sicht auf eine Tabelle umstellt. Eine davon unlesbar zu machen waere
--    ein teurer Fehler, und CREATE OR REPLACE VIEW sagt von sich aus
--    nichts darueber — es prueft die Spaltenliste, nicht die Rechte.
--
--    SET ROLE, damit wirklich die Leserolle liest: als Eigentuemer laeuft
--    alles (0109). SELECT * mit LIMIT und nicht count(*), weil count(*)
--    die Spaltenausdruecke nicht auswertet (0109) — und weil ein SELECT
--    auf eine unbefuellte Materialisierung genau hier mit PG 55000
--    auffallen soll und nicht erst im Dashboard.
-- ---------------------------------------------------------------------
DO $probe$
DECLARE
    v_sicht  text;
    v_liegen text[] := '{}';
BEGIN
    -- Ohne die Rolle oder ohne Mitgliedschaft darin laesst sich die Probe
    -- nicht fahren. Dann eine WARNUNG statt eines Abbruchs, wie in 0110:
    -- eine Migration, die an ihrer eigenen Gegenprobe scheitert, weil der
    -- einspielende Zugang kein Mitglied der Leserolle ist, waere ein
    -- Deploy-Blocker aus dem falschen Grund. Die Gegenprobe fuehrt dann
    -- der Gesundheitslauf des Servers (mart.sicht_defekt).
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0111 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0111 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_sicht IN ARRAY ARRAY[
        'mart.wetter_tag', 'mart.wetter_tag_basis', 'mart.betrieb_wetter_tag',
        'mart.vergleichstag', 'mart.wetter_effekt_gruppe', 'mart.wettertag_lage']
    LOOP
        BEGIN
            EXECUTE format('SELECT * FROM %s LIMIT 1', v_sicht);
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_sicht, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0111 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0111', to_jsonb(
        'mart.wetter_tag ist materialisiert. Sie gruppierte bei JEDER Abfrage alle '
        '3,42 Mio. Stundenwerte nach core.geschaeftstag(zeitpunkt) — ein Funktionswert '
        'als Gruppenschluessel nimmt keinen Index an und laesst keinen Datumsfilter vor '
        'die Aggregation, deshalb kostete EIN Tag genauso viel wie ein ganzes Jahr. '
        'Gemessen in Produktion am 21.09.2026: mart.wetter_tag ein Tag 4,5 s, '
        'mart.betrieb_wetter_tag ein Tag 7,4 s und ein Jahr ebenfalls 7,4 s, waehrend '
        'mart.vergleichstag_basis ein ganzes Jahr in 0,08 s liefert. Eine '
        'Jahresauswertung mit Wetterspalten lief in die 20-s-Grenze von mcp_leser '
        '(57014), und die drei Wettersichten standen im Gesundheitslauf als unklar. '
        'Jetzt liegt die Abfrage aus 0087 unveraendert in mart.wetter_tag_basis, '
        'mart.wetter_tag ist eine duenne Huelle darueber, und ein Index auf '
        'geschaeftstag traegt den Filter. Auf einem Klon mit 657.334 Stundenwerten: '
        'mart.betrieb_wetter_tag ein Tag von 190 ms auf unter 1 ms, mart.wettertag_lage '
        'ein Jahr von 2,9 s auf 93 ms, mart.wetter_effekt_gruppe von 1,7 s auf 0,7 s, '
        'Refresh 2,1 bis 2,7 s nebenlaeufig. mart.vergleichstag faellt nur von 310 auf '
        '210 ms — der Rest ist der LEFT JOIN auf die Koordinaten, nicht die '
        'Aggregation. Aufgefrischt wird am '
        'Ende von wetterNachlauf() — nur der schreibt manual.wetter_stunde. Der Preis: '
        'die Wetterzahlen sind nicht mehr live, sondern so frisch wie der letzte Lauf. '
        'Pruefzeile: SELECT * FROM mart.materialisierung_stand WHERE schluessel = '
        '''wetter_tag_refresh'';'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
