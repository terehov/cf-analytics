-- =====================================================================
-- 0161 Zwei Befunde aus der ersten Statusmeldung (21.11.2026)
--
--   A. Die Bon-Art ist seit dem Geschaeftstag 18.10.2026 leer — LINA hat
--      „Rechnung/Butschrift" in „Rechnung/Gutschrift" umbenannt.
--      Reparatur aus raw, im selben Zug der Code (src/lina/feld_alias.ts).
--   B. Der TPAPI-Rohabzug holt nur noch Tage ab 2018 (Entscheidung Eugene,
--      21.11.2026: „Wir brauchen nur Daten bis 2018, max. 2020 waere auch
--      okay").
--
-- ---------------------------------------------------------------------
-- A. BON-ART
--
-- SYMPTOM. core.bon (Bericht 96) und core.tischtransfer_bon (113) tragen ab
-- dem Geschaeftstag 18.10.2026 bei JEDEM Bon art = NULL: am 21.11. je 223.097
-- Zeilen bei 55 Betrieben, davor keine einzige. Die Bon-Sichten aus 0117
-- zaehlen nur art = 'Rechnung' (bons, bons_brutto, bon_median, artikel …) und
-- standen fuer diese Wochen auf null — eine plausible Null, kein Fehler.
--
-- URSACHE. LINA hat den Tippfehler in der Spaltenueberschrift berichtigt; die
-- Rohantworten seit dem 09.11. (219 je Bericht) fuehren „Rechnung/Gutschrift".
-- Der Lader las den alten Namen und bekam undefined. sync.schema_abweichung
-- hat jede Antwort gemeldet (438 Zeilen, „Spalte fehlt: Rechnung/Butschrift"),
-- gelesen wurde es erst in der Statusmeldung vom 21.11.
--
-- REPARATUR. core ist aus raw neu aufbaubar (Regel 4): die Art wird aus der
-- Rohantwort gelesen, auf die raw_id der Zeile zeigt, unter BEIDEN Namen.
-- Die Zuordnung Zeile ↔ Rohzeile rechnet die Schluessel des Laders nach:
--   core.bon             laufnummer = n-te Zeile mit gueltigem Datum JE TAG
--                        (bons() in src/transform/betriebsbericht.ts)
--   core.tischtransfer_bon zeile    = n-te Zeile der Antwort, gezaehlt ueber
--                        ALLE Bloecke, Summenzeilen mitgezaehlt (nachPlan())
-- Zur Sicherheit muss zusaetzlich die Rechnungsnummer uebereinstimmen; eine
-- Zeile, bei der sie es nicht tut, bleibt NULL und wird gezaehlt. Bleibt mehr
-- als 1 % offen, bricht die Migration ab — dann stimmt die Nachrechnung nicht,
-- und eine halbe Reparatur waere schlimmer als keine.
--
-- Danach werden die 438 Abweichungen quittiert: sie sind behoben, und eine
-- Warnung, die nach der Behebung stehen bleibt, liest niemand mehr (0071).
--
-- ---------------------------------------------------------------------
-- B. TPAPI AB 2018
--
-- Bis hierhin holte der Rohabzug jeden Tag, den LINAs listdays fuehrt — bei
-- einzelnen Betrieben bis Juli 2014. Am 21.11. lagen 3.989 Journaltage
-- (4,8 GB roh) vor 2018, und der Rest des Rueckstands war fast nur noch
-- 2014–2017. Ausgewertet wird ab 2018 (HISTORIE_AB, dieselbe Grenze wie der
-- LINA-Backfill). mart.tpapi_historie_ab() ist die eine Stelle, an der die
-- Grenze steht; die beiden Arbeitslisten (mart.tpapi_rueckstand_tag,
-- mart.personal_rueckstand) und die Zaehlung in mart.tpapi_rueckstand lesen
-- sie. Der Importer nimmt seine Arbeit aus diesen Sichten
-- (src/tpapi/rohabzug.ts, src/tpapi/nachlauf.ts) und braucht keine Aenderung.
--
-- Was schon geholt ist, bleibt: raw ist append-only (Regel 4). core.kassenjournal
-- haelt ohnehin nur 24 Monate (TPAPI_CORE_MONATE).
--
-- Spalten aller drei Sichten unveraendert — CREATE OR REPLACE haelt die
-- abhaengigen Sichten und die Rechte.
-- =====================================================================


-- ---------------------------------------------------------------------
-- A1. Art aus raw nachtragen — core.bon (96)
-- ---------------------------------------------------------------------

CREATE TEMP TABLE bonart_roh ON COMMIT DROP AS
WITH betroffen AS (
    SELECT DISTINCT raw_id FROM core.bon WHERE art IS NULL AND raw_id IS NOT NULL
    UNION
    SELECT DISTINCT raw_id FROM core.tischtransfer_bon WHERE art IS NULL AND raw_id IS NOT NULL
),
zeilen AS (
    SELECT r.id AS raw_id, blk.ord AS block, z.key::int AS nr, z.value AS zeile
      FROM betroffen x
      JOIN raw.api_antwort r ON r.id = x.raw_id
     CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(r.payload -> 'table') = 'array' THEN r.payload -> 'table'
                  ELSE '[]'::jsonb END) WITH ORDINALITY AS blk(b, ord)
     CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(blk.b) = 'object' THEN blk.b ELSE '{}'::jsonb END) AS z
     WHERE z.key ~ '^\d+$'
),
werte AS (
    -- roh(): eine Zelle {value: …} oder der Wert selbst
    SELECT raw_id, block, nr,
           CASE WHEN jsonb_typeof(zeile -> 'Datum') = 'object' THEN zeile -> 'Datum' ->> 'value'
                ELSE zeile ->> 'Datum' END AS datum_roh,
           CASE WHEN jsonb_typeof(zeile -> 'Rechnungsnummer') = 'object' THEN zeile -> 'Rechnungsnummer' ->> 'value'
                ELSE zeile ->> 'Rechnungsnummer' END AS nummer_roh,
           coalesce(
             CASE WHEN jsonb_typeof(zeile -> 'Rechnung/Gutschrift') = 'object'
                  THEN zeile -> 'Rechnung/Gutschrift' ->> 'value' ELSE zeile ->> 'Rechnung/Gutschrift' END,
             CASE WHEN jsonb_typeof(zeile -> 'Rechnung/Butschrift') = 'object'
                  THEN zeile -> 'Rechnung/Butschrift' ->> 'value' ELSE zeile ->> 'Rechnung/Butschrift' END
           ) AS art_roh
      FROM zeilen
)
SELECT raw_id, block, nr,
       -- linaEpochAlsDatum(): Sekunden > 0, Berliner Kalendertag
       CASE WHEN datum_roh ~ '^\d+(\.\d+)?$' AND datum_roh::numeric > 0
            THEN (to_timestamp(datum_roh::numeric) AT TIME ZONE core.geschaefts_zeitzone())::date END AS tag,
       CASE WHEN nummer_roh ~ '^-?\d+$' THEN nummer_roh::bigint END AS rechnungsnummer,
       -- text() und Eigenheit 1: leer oder die eigene Ueberschrift ist keine Angabe
       CASE WHEN btrim(art_roh) IN ('', 'Rechnung/Gutschrift', 'Rechnung/Butschrift') THEN NULL
            ELSE btrim(art_roh) END AS art,
       row_number() OVER (PARTITION BY raw_id ORDER BY block, nr) AS zeile_gesamt
  FROM werte;

CREATE TEMP TABLE bonart_ergebnis (tabelle text, offen_vorher bigint, repariert bigint, offen_nachher bigint)
    ON COMMIT DROP;

WITH vorher AS (SELECT count(*) AS n FROM core.bon WHERE art IS NULL),
je_tag AS (
    SELECT raw_id, tag, rechnungsnummer, art,
           row_number() OVER (PARTITION BY raw_id, tag ORDER BY block, nr) AS laufnummer
      FROM bonart_roh
     WHERE tag IS NOT NULL
),
upd AS (
    UPDATE core.bon b
       SET art = j.art
      FROM je_tag j
     WHERE b.art IS NULL
       AND b.raw_id = j.raw_id
       AND b.geschaeftstag = j.tag
       AND b.laufnummer = j.laufnummer
       AND b.rechnungsnummer IS NOT DISTINCT FROM j.rechnungsnummer
       AND j.art IS NOT NULL
    RETURNING 1
)
INSERT INTO bonart_ergebnis
SELECT 'core.bon', (SELECT n FROM vorher), (SELECT count(*) FROM upd), NULL;


-- ---------------------------------------------------------------------
-- A2. Art aus raw nachtragen — core.tischtransfer_bon (113)
-- ---------------------------------------------------------------------

WITH vorher AS (SELECT count(*) AS n FROM core.tischtransfer_bon WHERE art IS NULL),
upd AS (
    UPDATE core.tischtransfer_bon t
       SET art = r.art
      FROM bonart_roh r
     WHERE t.art IS NULL
       AND t.raw_id = r.raw_id
       AND t.zeile = r.zeile_gesamt
       AND t.geschaeftstag = r.tag
       AND t.rechnungsnummer IS NOT DISTINCT FROM r.rechnungsnummer
       AND r.art IS NOT NULL
    RETURNING 1
)
INSERT INTO bonart_ergebnis
SELECT 'core.tischtransfer_bon', (SELECT n FROM vorher), (SELECT count(*) FROM upd), NULL;

UPDATE bonart_ergebnis SET offen_nachher = (SELECT count(*) FROM core.bon WHERE art IS NULL)
 WHERE tabelle = 'core.bon';
UPDATE bonart_ergebnis SET offen_nachher = (SELECT count(*) FROM core.tischtransfer_bon WHERE art IS NULL)
 WHERE tabelle = 'core.tischtransfer_bon';

DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT * FROM bonart_ergebnis LOOP
        RAISE NOTICE '0161 %: % Bons ohne Art vorher, % repariert, % offen', r.tabelle,
            r.offen_vorher, r.repariert, r.offen_nachher;
        IF r.offen_vorher > 0 AND r.offen_nachher > r.offen_vorher * 0.01 THEN
            RAISE EXCEPTION '0161 %: nach der Reparatur sind noch % von % Bons ohne Art (mehr als 1 %%) — '
                'die Nachrechnung der Zeilenschluessel trifft nicht, nichts wird geschrieben',
                r.tabelle, r.offen_nachher, r.offen_vorher;
        END IF;
    END LOOP;
END $$;


-- ---------------------------------------------------------------------
-- A3. Die Abweichungen der Umbenennung quittieren
-- ---------------------------------------------------------------------

UPDATE sync.schema_abweichung
   SET quittiert_am = now()
 WHERE quittiert_am IS NULL
   AND endpunkt IN ('getReport:96', 'getReport:113')
   AND tatsaechlich::text LIKE '%Spalte fehlt: Rechnung/Butschrift%';


-- ---------------------------------------------------------------------
-- B1. Die Grenze — an einer Stelle
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mart.tpapi_historie_ab()
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$ SELECT DATE '2018-01-01' $$;

COMMENT ON FUNCTION mart.tpapi_historie_ab() IS
'Erster Geschaeftstag, den der TPAPI-Rohabzug nachlaedt (0161, Entscheidung Eugene 21.11.2026:
Daten ab 2018 reichen, 2020 waere auch genug). Gelesen von mart.tpapi_rueckstand_tag,
mart.tpapi_rueckstand und mart.personal_rueckstand — also auch vom Importer, der seine Arbeit aus
diesen Sichten nimmt. Wer die Grenze aendert, aendert sie hier und nur hier. Gleicher Wert wie
HISTORIE_AB (LINA-Backfill, src/config.ts). Schon geholte aeltere Tage bleiben in raw.';


-- ---------------------------------------------------------------------
-- B2. Arbeitsliste des Rohabzugs — wie 0151, mit Grenze
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.tpapi_rueckstand_tag AS
WITH ep(endpunkt, modul) AS (
    VALUES ('tpapi:journal',              'revenue'),
           ('tpapi:journaltables',        'revenue'),
           ('tpapi:personalkostenprotag', 'personal')
),
liste AS (
    SELECT g.betrieb_key, max(g.gesehen_am) AS liste_am
      FROM core.tpapi_geschaeftstag g
     GROUP BY g.betrieb_key
),
zugang AS (
    SELECT z.betrieb_key, z.enc_id, z.modul, z.zustand, l.liste_am
      FROM sync.tpapi_zugang z
      LEFT JOIN liste l ON l.betrieb_key = z.betrieb_key
     WHERE z.schluessel_vorhanden
       AND z.zustand <> 'nicht_lizenziert'
),
arbeit AS (
    SELECT a.betrieb_key, a.enc_id, ep.endpunkt, ep.modul, a.zustand, g.geschaeftstag,
           'listdays'::text AS arbeitsliste
      FROM zugang a
      JOIN ep ON ep.modul = a.modul
      JOIN core.tpapi_geschaeftstag g
        ON g.betrieb_key = a.betrieb_key
       AND g.gesehen_am = a.liste_am
       AND g.geschaeftstag < current_date
       AND g.geschaeftstag >= mart.tpapi_historie_ab()
    UNION ALL
    SELECT a.betrieb_key, a.enc_id, ep.endpunkt, ep.modul, a.zustand, d.tag::date,
           'horizont 365'::text
      FROM zugang a
      JOIN ep ON ep.modul = a.modul
      CROSS JOIN LATERAL generate_series(current_date - 365, current_date - 1, interval '1 day') AS d(tag)
     WHERE a.liste_am IS NULL
       AND a.modul = 'personal'
)
SELECT ar.betrieb_key,
       ar.enc_id,
       b.name            AS betrieb,
       ar.endpunkt,
       ar.modul,
       ar.geschaeftstag,
       ar.arbeitsliste,
       ar.zustand        AS zugang_zustand
  FROM arbeit ar
  JOIN core.betrieb b ON b.betrieb_key = ar.betrieb_key
 WHERE NOT EXISTS (SELECT 1
                     FROM core.tpapi_abruf x
                    WHERE x.betrieb_key = ar.betrieb_key
                      AND x.endpunkt = ar.endpunkt
                      AND x.geschaeftstag = ar.geschaeftstag);

COMMENT ON VIEW mart.tpapi_rueckstand_tag IS
'Arbeitsliste des TPAPI-Nachladens (0151, Grenze seit 0161): je Betrieb mit Schluessel,
Tagesendpunkt (Journal, Bons, Personalkosten je Tag) und Geschaeftstag, der laut LINAs listdays
existiert, nicht vor mart.tpapi_historie_ab() (2018-01-01) liegt und noch nie erfolgreich geholt
wurde. Phase C holt daraus die neuesten Tage zuerst. Die Zeilenzahl MUSS fallen und 0 erreichen;
die verdichtete Zahl je Betrieb steht in mart.tpapi_rueckstand. Betriebe ohne Sales Data API haben
keine listdays — fuer Personalkosten je Tag gelten dort die letzten 365 Tage (arbeitsliste =
horizont 365). Nicht lizenzierte Module fehlen hier und stehen in mart.tpapi_zugang_modul.';


-- ---------------------------------------------------------------------
-- B3. Rueckstand verdichtet — wie 0151, die Liste ab der Grenze gezaehlt
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.tpapi_rueckstand AS
WITH ep(endpunkt, modul) AS (
    VALUES ('tpapi:journal',              'revenue'),
           ('tpapi:journaltables',        'revenue'),
           ('tpapi:personalkostenprotag', 'personal')
),
liste AS (
    SELECT g.betrieb_key, max(g.gesehen_am) AS liste_am, min(g.erstmals_am) AS bekannt_seit
      FROM core.tpapi_geschaeftstag g
     GROUP BY g.betrieb_key
),
liste_tage AS (
    SELECT g.betrieb_key, count(*)::int AS n, min(g.geschaeftstag) AS aeltester
      FROM core.tpapi_geschaeftstag g
      JOIN liste l ON l.betrieb_key = g.betrieb_key AND g.gesehen_am = l.liste_am
     WHERE g.geschaeftstag < current_date
       AND g.geschaeftstag >= mart.tpapi_historie_ab()
     GROUP BY g.betrieb_key
),
paar AS (
    SELECT z.betrieb_key, z.enc_id, z.zustand, ep.endpunkt, ep.modul, l.liste_am, l.bekannt_seit
      FROM sync.tpapi_zugang z
      JOIN ep ON ep.modul = z.modul
      LEFT JOIN liste l ON l.betrieb_key = z.betrieb_key
     WHERE z.schluessel_vorhanden
       AND z.zustand <> 'nicht_lizenziert'
),
geholt AS (
    SELECT a.betrieb_key, a.endpunkt,
           count(*)::int          AS n,
           min(a.geschaeftstag)   AS aeltester,
           max(a.abgerufen_am)    AS letzter,
           min(a.erstmals_am)     AS erster,
           max(a.erstmals_am) FILTER (
               WHERE a.geschaeftstag < (a.erstmals_am AT TIME ZONE core.geschaefts_zeitzone())::date - 3
           )                      AS letzter_nachladen
      FROM core.tpapi_abruf a
     WHERE a.geschaeftstag >= mart.tpapi_historie_ab()
     GROUP BY a.betrieb_key, a.endpunkt
),
fehlend AS (
    SELECT r.betrieb_key, r.endpunkt, count(*)::int AS n, max(r.geschaeftstag) AS juengster
      FROM mart.tpapi_rueckstand_tag r
     GROUP BY r.betrieb_key, r.endpunkt
)
SELECT p.betrieb_key,
       b.name                                         AS betrieb,
       p.enc_id,
       p.endpunkt,
       p.modul,
       p.zustand                                      AS zugang_zustand,
       CASE WHEN p.liste_am IS NOT NULL THEN 'listdays'
            WHEN p.modul = 'personal'   THEN 'horizont 365'
            ELSE 'keine liste' END                    AS arbeitsliste,
       CASE WHEN p.liste_am IS NOT NULL THEN coalesce(lt.n, 0)
            WHEN p.modul = 'personal'   THEN 365
            ELSE 0 END                                AS tage_liste,
       coalesce(gh.n, 0)                              AS tage_geholt,
       coalesce(f.n, 0)                               AS tage_fehlend,
       lt.aeltester                                   AS aeltester_tag_liste,
       gh.aeltester                                   AS aeltester_tag_geholt,
       f.juengster                                    AS juengster_tag_fehlend,
       gh.letzter                                     AS letzter_abruf,
       gh.letzter_nachladen                           AS letzter_nachladen,
       coalesce(p.bekannt_seit, gh.erster)            AS bekannt_seit,
       (coalesce(f.n, 0) > 0
        AND coalesce(p.bekannt_seit, gh.erster) < now() - interval '48 hours'
        AND (gh.letzter_nachladen IS NULL
             OR gh.letzter_nachladen < now() - interval '48 hours')) AS stockt
  FROM paar p
  JOIN core.betrieb b      ON b.betrieb_key = p.betrieb_key
  LEFT JOIN liste_tage lt  ON lt.betrieb_key = p.betrieb_key
  LEFT JOIN geholt gh      ON gh.betrieb_key = p.betrieb_key AND gh.endpunkt = p.endpunkt
  LEFT JOIN fehlend f      ON f.betrieb_key = p.betrieb_key AND f.endpunkt = p.endpunkt;

COMMENT ON VIEW mart.tpapi_rueckstand IS
'TPAPI-Rohabzug je Betrieb und Tagesendpunkt (0151, ab 0161 nur Tage ab mart.tpapi_historie_ab(),
2018-01-01): wie viele Geschaeftstage LINA in diesem Zeitraum fuehrt (tage_liste), wie viele geholt
sind und wie viele fehlen — die Zahl, die Nacht fuer Nacht FALLEN muss. Aeltere Tage, die vor 0161
geholt wurden, liegen weiter in raw und zaehlen hier nicht. stockt = es fehlt etwas, und seit 48
Stunden kam kein Tag aus dem Nachladen dazu (Pruefzeile in mart.pruefung_uebersicht). Ein Betrieb,
der fehlt, hat keinen Schluessel oder das Modul nicht gebucht — siehe mart.tpapi_zugang_modul.
Geholt heisst roh gesichert; ob ein Tag schon in den Auswertungen steht, sagt
mart.tpapi_abruf_stand (in_core).';


-- ---------------------------------------------------------------------
-- B4. Personal je Stunde — wie 0153, listdays ab der Grenze
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.personal_rueckstand AS
WITH liste AS (
    SELECT g.betrieb_key, max(g.gesehen_am) AS liste_am
      FROM core.tpapi_geschaeftstag g
     GROUP BY g.betrieb_key
), zugang AS (
    SELECT z.betrieb_key, z.enc_id, z.zustand, l.liste_am
      FROM sync.tpapi_zugang z
      LEFT JOIN liste l ON l.betrieb_key = z.betrieb_key
     WHERE z.modul = 'personal'
       AND z.schluessel_vorhanden
       AND z.zustand <> 'nicht_lizenziert'
), tage AS (
    SELECT a.betrieb_key, a.enc_id, a.zustand, t.geschaeftstag
      FROM zugang a
      CROSS JOIN LATERAL (
            SELECT g.geschaeftstag
              FROM core.tpapi_geschaeftstag g
             WHERE g.betrieb_key = a.betrieb_key
               AND g.gesehen_am = a.liste_am
               AND g.geschaeftstag < current_date
               AND g.geschaeftstag >= mart.tpapi_historie_ab()
            UNION
            SELECT d.tag::date
              FROM generate_series(current_date - 365, current_date - 1, interval '1 day') AS d(tag)
           ) t
)
SELECT t.betrieb_key,
       t.enc_id,
       b.name              AS betrieb,
       t.geschaeftstag,
       t.zustand           AS zugang_zustand,
       CASE WHEN t.geschaeftstag >= current_date - 365 THEN 'horizont 365'
            ELSE 'listdays' END AS arbeitsliste
  FROM tage t
  JOIN core.betrieb b ON b.betrieb_key = t.betrieb_key
 WHERE NOT EXISTS (SELECT 1
                     FROM core.personalkosten_stunde_abruf a
                    WHERE a.betrieb_key = t.betrieb_key
                      AND a.geschaeftstag = t.geschaeftstag);

COMMENT ON VIEW mart.personal_rueckstand IS
'Arbeitsliste fuer Personal je Stunde (0149, seit 0153 mit der Tiefe von listdays, seit 0161 nicht
vor mart.tpapi_historie_ab(), 2018-01-01): je Betrieb mit Schluessel die Geschaeftstage, die noch
nie erfolgreich geholt wurden — die letzten 365 Tage und dazu jeder aeltere Tag ab 2018, den LINAs
listdays fuer den Betrieb fuehrt. Ein leerer Tag zaehlt als erledigt. Phase A holt davon die
letzten 365 Tage (feste Grenze je Betrieb), Phase C den Rest unter TPAPI_NACHLADEN_JE_LAUF. Die
Zeilenzahl MUSS von Nacht zu Nacht fallen und 0 erreichen. Betriebe, deren Modul nicht lizenziert
ist, fehlen hier — sie stehen in mart.tpapi_zugang.';
