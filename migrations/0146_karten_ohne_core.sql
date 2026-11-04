-- =====================================================================
-- 0146 — Jede Karte laeuft auch im Chat: keine Karte liest mehr core oder sync
-- =====================================================================
--
-- DER BEFUND (04.11.2026). Der MCP-Zugang fuehrt jede Metabase-Karte als
-- Bericht aus, aber als mcp_leser — und der sieht nur mart, manual, ampel
-- (Regel aus docs/plan-skybridge.md). Am 01.11.2026 scheiterte
-- bericht:yx_datenstand mit „permission denied for schema core". Ein
-- Durchgang ueber alle 328 Karten mit SQL fand 13, die core oder sync
-- direkt lesen:
--
--   yx_datenstand                    core.yext_datenstand
--   bw_anteil_schlecht, bw_portalvergleich   core.bewertung
--   pf_stillgelegt                   core.umsatzbericht_tag
--   im_naechste                      sync.warteschlange (nur fuer parameter)
--   im_yext                          sync.merker
--   imf_faelle                       sync.aufgabe
--   aa_kopf, aa_betrieb, aa_verlauf_nachlass, aa_verlauf_menge, aa_artikel,
--   aa_liste_pruefung                core.artikel, core.artikelverkauf_tag, core.betrieb
--
-- In Metabase liefen sie alle, im Chat keine. Fuer pf_stillgelegt reicht
-- mart.umsatz_tag, fuer den Betriebsnamen der Artikelaktion
-- mart.konzept_zuordnung (141 von 141 Betrieben, Name identisch, seit 0144
-- eine Tabelle mit Statistik). Fuer den Rest legt diese Migration schlanke
-- Sichten an: reine Projektionen ohne weitere Joins, damit der Planer die
-- Filter der Karten bis auf die Tabelle durchreicht und die Laufzeit der
-- Karten bleibt, wie sie war (die Artikelaktion liest bewusst NICHT
-- mart.artikelverkauf — dessen Joins kosteten 8,4 statt 0,6 s, siehe
-- metabase/karten-artikelaktion.ts).
--
-- Was kuenftig verhindert, dass es wieder passiert: metabase/karten.test.ts
-- prueft, dass keine Karte ein Schema ausserhalb von mart, manual, ampel
-- liest (Ausnahmen nur mit Begruendung im Test).
--
-- DAZU, aus derselben Pruefung: manual.betrieb_ohne_regelbetrieb. KUZ —
-- Wilma Wunder Ballplatz Mainz ist eine Veranstaltungshalle, in der Wilma
-- Ballplatz catert (Daniel, 04.11.2026): ohne Veranstaltung kein Umsatz.
-- mart.luecke_monat meldete sie als „operativer Betrieb seit mehr als 8
-- Tagen ohne Umsatz" — richtig gemessen, aber kein Fehler.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Yext: Datenstand je Metrik und der letzte Lauf
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.yext_datenstand AS
SELECT d.metrik,
       d.vollstaendig_bis,
       (current_date - d.vollstaendig_bis) AS tage_rueckstand,
       d.geladen_am
  FROM core.yext_datenstand d;

COMMENT ON VIEW mart.yext_datenstand IS
'Bis wann Yext eine Metrik als vollstaendig meldet (GET /analytics/catalog), eine Zeile je Metrik.
Bewertungen und Antworten sind meist bis gestern vollstaendig, Sichtbarkeitsmetriken hinken bis zu
einer Woche hinterher. Der laufende Monat ist dort IMMER ein Teilmonat — nicht gegen einen
Vollmonat halten. Spiegel von core.yext_datenstand (0146).';

CREATE OR REPLACE VIEW mart.yext_lauf AS
SELECT (m.wert ->> 'beendet_am')::timestamptz AS beendet_am,
       (m.wert ->> 'fehler')::int             AS fehler,
       (m.wert ->> 'betriebe')::int           AS betriebe,
       (m.wert ->> 'zeilen')::int             AS zeilen,
       (m.wert ->> 'aufrufe')::int            AS aufrufe
  FROM sync.merker m
 WHERE m.schluessel = 'yext_letzter_lauf';

COMMENT ON VIEW mart.yext_lauf IS
'Der letzte Lauf des Yext-Imports (Bewertungen): wann er endete und wie viele Fehler er hatte.
Hoechstens eine Zeile; keine Zeile heisst, Yext ist noch nie gelaufen. Was danach in der
Datenbank liegt, steht in mart.bewertung_ladestand (0146).';


-- ---------------------------------------------------------------------
-- 2. Bewertungen: ALLE, nicht nur die mit Text
-- ---------------------------------------------------------------------
-- mart.bewertung_einzel zeigt nur LIVE-Bewertungen mit Sternen UND Text —
-- die Sicht ist zum Lesen der Texte gebaut. Die beiden Karten zaehlen
-- dagegen alle Bewertungen eines Portals, auch die ohne Text und ohne
-- Sterne („ohne Sterne" ist dort eine eigene Spalte). Auf bewertung_einzel
-- umgestellt, haetten sie still weniger gezaehlt.
CREATE OR REPLACE VIEW mart.bewertung_alle AS
SELECT b.betrieb_key,
       b.quelle,
       b.publisher,
       b.status,
       b.rating,
       b.publiziert_am,
       (b.publiziert_am)::date                          AS datum,
       (date_trunc('month', b.publiziert_am))::date     AS monat,
       (coalesce(btrim(b.inhalt), '') <> '')            AS mit_text
  FROM core.bewertung b;

COMMENT ON VIEW mart.bewertung_alle IS
'Jede Bewertung, eine Zeile je Bewertung — auch ohne Text, ohne Sterne und unabhaengig vom Status.
Zum ZAEHLEN (Anteile, Portalvergleich). Zum Lesen der Texte mart.bewertung_einzel (nur LIVE, mit
Sternen und Text). rating ist NULL, wo das Portal keine Sterne vergibt — avg(rating) ignoriert diese
Zeilen, count(*) nicht. Betrieb und Marke ueber betrieb_key aus mart.betrieb_status (0146).';


-- ---------------------------------------------------------------------
-- 3. Import: die einzelnen Fehlerfaelle und die Parameter der Warteschlange
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.import_fehler_fall AS
SELECT a.beendet_am,
       a.lauf_id,
       a.endpunkt,
       a.http_status,
       a.versuch,
       a.zeitraum_von,
       a.zeitraum_bis,
       a.fehler,
       a.betrieb_enc_id
  FROM sync.aufgabe a
 WHERE a.status = 'fehler';

COMMENT ON VIEW mart.import_fehler_fall IS
'Jeder gescheiterte Abruf des Importers, eine Zeile je Versuch, ueber die ganze Historie — immer
nach beendet_am filtern. Verdichtet je Fehlerart und nur die letzten 24 Stunden: mart.import_fehler.
Ein einzelner Fehler ist kein Befund: der Worker wiederholt; erst mart.posten_aufgegeben sagt, was
endgueltig fehlt (0146).';

-- Spalten wie in 0019, parameter haengt am Ende an (CREATE OR REPLACE kann nur anhaengen).
CREATE OR REPLACE VIEW mart.import_naechste AS
SELECT w.posten_id,
       row_number() OVER (ORDER BY w.prioritaet, w.faellig_ab, w.posten_id) AS "position",
       w.endpunkt,
       b.name AS betrieb,
       w.zeitraum_von,
       w.zeitraum_bis,
       w.prioritaet,
       CASE
         WHEN w.prioritaet <= 10 THEN 'laufend'
         WHEN w.prioritaet >= 90 THEN 'Historie'
         ELSE 'normal'
       END AS art,
       w.faellig_ab,
       w.versuche,
       w.in_arbeit_seit,
       (w.in_arbeit_seit IS NOT NULL) AS laeuft_gerade,
       w.letzter_fehler,
       w.parameter
  FROM sync.warteschlange w
  LEFT JOIN core.betrieb b ON b.enc_id = w.betrieb_enc_id
 WHERE w.erledigt_am IS NULL
 ORDER BY w.prioritaet, w.faellig_ab, w.posten_id;

COMMENT ON COLUMN mart.import_naechste.parameter IS
'Die Parameter des Postens, so wie der Importer sie an die Quelle schickt. Bei FoodNotify
benennen sie den Posten (erpId = Kostenstelle, orderId = Bestellung, seite) — dort ist betrieb leer (0146).';


-- ---------------------------------------------------------------------
-- 4. Artikelverkauf je Tag, ohne Stammdaten-Joins
-- ---------------------------------------------------------------------
-- Fuer die Artikelaktion (metabase/karten-artikelaktion.ts). Absichtlich
-- NUR Projektionen: mart.artikelverkauf haengt Warengruppe, Wareneinsatz
-- und Artikelstand an jede Zeile und ist fuer eine Liste von Nummern ueber
-- drei Zeitraeume zu schwer. Hier filtert der Planer geschaeftstag und
-- artikel_key direkt auf der Tabelle.
CREATE OR REPLACE VIEW mart.artikelverkauf_tag AS
SELECT av.geschaeftstag,
       av.betrieb_key,
       av.artikel_key,
       av.menge,
       av.umsatz_netto,
       av.umsatz_brutto,
       av.verkaufspreis
  FROM core.artikelverkauf_tag av;

COMMENT ON VIEW mart.artikelverkauf_tag IS
'Verkauf je Betrieb, Geschaeftstag und Artikel, ohne Namen, Marke oder Warengruppe — die schlanke
Form von mart.artikelverkauf fuer Abfragen ueber eine Liste von Artikeln (Artikelaktion). Namen
ueber mart.artikel_stamm (artikel_key) und mart.konzept_zuordnung (betrieb_key). verkaufspreis ist
der Kartenpreis brutto; 1 - umsatz_brutto / (menge * verkaufspreis) ist der Nachlass aus ALLEN
Rabatten. Immer nach geschaeftstag filtern: die Tabelle hat ueber 100 Monatspartitionen (0146).';

CREATE OR REPLACE VIEW mart.artikel_stamm AS
SELECT a.artikel_key,
       a.artikelnummer,
       a.name AS artikel
  FROM core.artikel a;

COMMENT ON VIEW mart.artikel_stamm IS
'Die Artikel aus LINA, eine Zeile je artikel_key: Nummer und Name, wie die Kasse sie fuehrt.
Artikelnummern sind je Konzept vergeben — dieselbe Nummer kann in einer anderen Marke ein anderer
Artikel sein. Warengruppe und Stand je Monat: mart.artikelverkauf (0146).';


-- ---------------------------------------------------------------------
-- 5. Betriebe ohne Regelbetrieb (KUZ)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manual.betrieb_ohne_regelbetrieb (
  betrieb_key  integer PRIMARY KEY REFERENCES core.betrieb (betrieb_key),
  notiz        text,
  gepflegt_am  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE manual.betrieb_ohne_regelbetrieb IS
'Betriebe, die nur bei Gelegenheit Umsatz machen — etwa eine Veranstaltungshalle, die nur bei
Veranstaltungen bewirtet wird. Wochen ohne Umsatz sind dort kein Datenfehler; mart.luecke_monat
meldet sie deshalb nicht als „operativer Betrieb seit mehr als 8 Tagen ohne Umsatz". Sonst wirkt
der Eintrag nirgends: der Status in mart.betrieb_status rechnet weiter nach dem letzten Umsatztag.
Gepflegt ueber pflege/betrieb_ohne_regelbetrieb.csv (0146).';

-- Die Pruefung in mart.luecke_monat bekommt die Ausnahme. Ersetzt wird an der
-- Definition IN DER ZIELDATENBANK (wie 0141), nicht an 0127 — die Sicht ist seither
-- aus pg_get_viewdef neu entstanden. Trifft der Suchtext nicht genau einmal,
-- bricht die Migration ab, statt still nichts zu aendern.
DO $$
DECLARE
    v_def    text := pg_get_viewdef('mart.luecke_monat'::regclass);
    v_such   text := 'WHERE ((bs.status = ''operativ''::text) AND (bs.letzter_umsatztag < (CURRENT_DATE - 8)))';
    v_neu    text := 'WHERE ((bs.status = ''operativ''::text) AND (bs.letzter_umsatztag < (CURRENT_DATE - 8))'
                     ' AND (NOT (EXISTS (SELECT 1 FROM manual.betrieb_ohne_regelbetrieb r'
                     ' WHERE r.betrieb_key = bs.betrieb_key))))';
    v_anzahl int  := (length(v_def) - length(replace(v_def, v_such, ''))) / length(v_such);
BEGIN
    IF v_anzahl <> 1 THEN
        RAISE EXCEPTION '0146: die Umsatzpruefung in mart.luecke_monat steht % mal in der Definition, '
                        'erwartet 1 — die Sicht sieht anders aus als am 04.11.2026. Von Hand pruefen.', v_anzahl;
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW mart.luecke_monat AS ' || replace(v_def, v_such, v_neu);
END $$;


-- ---------------------------------------------------------------------
-- 6. MCP-Katalog: Koernung, Rechte, Leseprobe
-- ---------------------------------------------------------------------
SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.yext_datenstand',   'Yext-Metrik — bis wann sie vollstaendig ist', 'bewertung', false),
    ('mart.yext_lauf',         'eine Zeile — der letzte Yext-Lauf', 'import', false),
    ('mart.bewertung_alle',    'Bewertung (eine Zeile je Bewertung, auch ohne Text und Sterne)', 'bewertung', true),
    ('mart.import_fehler_fall','gescheiterter Abruf (eine Zeile je Versuch); nach beendet_am filtern', 'import', false),
    ('mart.artikelverkauf_tag','Betrieb × Geschaeftstag × Artikel — ohne Namen; nach geschaeftstag filtern', 'umsatz', true),
    ('mart.artikel_stamm',     'Artikel (artikel_key) — Nummer und Name aus LINA', 'stammdaten', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

SELECT mcp.rechte_auffrischen();

DO $probe$
DECLARE
    v_abfrage text;
    v_liegen  text[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0146 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0146 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_abfrage IN ARRAY ARRAY[
        'SELECT * FROM mart.yext_datenstand LIMIT 1',
        'SELECT * FROM mart.yext_lauf LIMIT 1',
        'SELECT * FROM mart.bewertung_alle WHERE publiziert_am >= now() - interval ''7 days'' LIMIT 1',
        'SELECT * FROM mart.import_fehler_fall WHERE beendet_am >= now() - interval ''7 days'' LIMIT 1',
        'SELECT * FROM mart.import_naechste LIMIT 1',
        'SELECT * FROM mart.artikelverkauf_tag WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.artikel_stamm LIMIT 1',
        'SELECT * FROM mart.luecke_monat LIMIT 1']
    LOOP
        BEGIN
            EXECUTE v_abfrage;
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_abfrage, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0146 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
