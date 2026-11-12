-- =====================================================================
-- 0151 TPAPI Stufe 2, Schritt 2a — alles Lesende holen und roh sichern
--
-- ANLASS (12.11.2026). Eugene: "alles laden, was uns fehlt, so weit zurueck
-- wie moeglich, fuer so viele Betriebe wie moeglich". Plan und
-- Entscheidungen S1-S11: docs/plan-tpapi-stufe2.md; die Quelle und ihre
-- Messungen: docs/lina-third-party-api.md.
--
-- ZWEI SCHRITTE (S1). Die Feldwerte von Journal, Bons und Artikelstamm sind
-- nicht gemessen — nur ihre Namen. Deshalb holt 2a die Antworten und sichert
-- sie ROH (raw.api_antwort plus eine Abrufzeile); 2b baut core daraus, auch
-- fuer Tage, die laengst geholt sind. Bei Betrieben mit einem Jahr Tiefe
-- faellt jeden Tag einer hinten aus listdays heraus: was nicht roh gesichert
-- ist, waehrend die Lader entstehen, ist weg. Regel 4 wird hier der normale
-- Weg, nicht der Notfall.
--
-- WAS DIESE MIGRATION ANLEGT
--   1. core.tpapi_geschaeftstag  — die Arbeitsliste aus revenue/listdays (S2)
--   2. core.tpapi_abruf          — je Betrieb, Endpunkt und Geschaeftstag: was
--                                   geholt ist, mit Hash, Bytes, Rohsatz
--   3. core.tpapi_stammabzug     — die tagfreien Listen (Artikelstamm, S11)
--   4. sync.quelle misst an einer Tabelle auch NUR EINEN TEIL davon
--      (filter_spalte/filter_werte) — sonst saehe der Zulauf von Journal und
--      Personalkosten je Tag wie EINE Quelle aus (Regel 10)
--   5. vier Sichten in mart: Rueckstand je Tag und verdichtet, Abrufstand,
--      Zugang je Modul
--   6. zwei Zeilen in mart.pruefung_uebersicht, beide koennen auf null gehen
--   7. MCP-Katalog: Koernung, Rechte, Leseprobe — keine neue Regelart
--
-- Der Importer (src/tpapi/endpunkte.ts, rohabzug.ts, roh_laden.ts), die
-- Registereintraege tpapi:* (src/sync/quellen.ts) und die Konfiguration
-- (TPAPI_GRENZE_*, TPAPI_NACHLADEN_JE_LAUF, TPAPI_STAMM_TAGE) stehen im
-- selben Commit.
--
-- WAS NICHT HIER IST: kein core.kassenjournal, kein core.kassenbon, kein
-- Artikelstamm in core (Schritt 2b, nach der Formprobe). core_stand bleibt
-- deshalb ueberall NULL — und die Pruefzeile "Rohsaetze ohne core aelter als
-- 48 h" aus Plan §4 kommt erst mit 2b: heute stuende sie dauerhaft auf
-- "alles", und eine Zeile, die nie auf null gehen kann, liest niemand (0071).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die Arbeitsliste: revenue/listdays
--
-- Einmal je Betrieb und Nacht geholt. Jeder Tag der Antwort bekommt
-- gesehen_am = now() der Transaktion — "steht in der juengsten Liste" ist
-- damit eine Gleichheit (gesehen_am = max(gesehen_am) je Betrieb). Ein Tag,
-- der hinten aus der Liste faellt, bleibt stehen (geloescht wird nichts),
-- aber er faellt aus dem Rueckstand.
-- ---------------------------------------------------------------------

CREATE TABLE core.tpapi_geschaeftstag (
    betrieb_key    integer      NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag  date         NOT NULL,
    erstmals_am    timestamptz  NOT NULL DEFAULT now(),
    gesehen_am     timestamptz  NOT NULL DEFAULT now(),
    raw_id         bigint,
    PRIMARY KEY (betrieb_key, geschaeftstag)
);

COMMENT ON TABLE core.tpapi_geschaeftstag IS
'Die Geschaeftstage, die LINAs Third-Party-API je Betrieb fuehrt (GET /extern/revenue/listdays, 0151) —
die Arbeitsliste des TPAPI-Rohabzugs. Die Tiefe ist je Betrieb verschieden (Aposto Aalen ab 2019,
Wilma Wunder Nuernberg rund ein Jahr). Nur Betriebe mit Schluessel und gebuchter Sales Data API.
Ein Tag, der nicht mehr in der juengsten Liste steht, bleibt stehen (gesehen_am alt), wird aber
nicht mehr gefragt.';
COMMENT ON COLUMN core.tpapi_geschaeftstag.geschaeftstag IS
'Aus businessdate (Unix-Sekunden) ueber die BERLINER Wanduhr. Annahme, nicht gemessen: der Wert
liegt am Geschaeftstag selbst (Berliner Mitternacht, Mitternacht UTC oder 08:00 ergeben alle
denselben Tag; ueber UTC gerechnet verrutschte Berliner Mitternacht um einen Tag nach vorn). Der
Importer zaehlt Werte, die nicht auf Berliner Mitternacht liegen, im Log
(listdays_nicht_berliner_mitternacht) — die Formprobe misst es.';
COMMENT ON COLUMN core.tpapi_geschaeftstag.erstmals_am IS
'Wann der Tag zum ersten Mal in listdays stand.';
COMMENT ON COLUMN core.tpapi_geschaeftstag.gesehen_am IS
'Wann der Tag zuletzt in listdays stand. Gleich max(gesehen_am) des Betriebs = steht in der
juengsten Liste.';
COMMENT ON COLUMN core.tpapi_geschaeftstag.raw_id IS
'Der Rohsatz der juengsten listdays-Antwort, in der der Tag stand (raw.api_antwort.id).';


-- ---------------------------------------------------------------------
-- 2. Was je Tag geholt ist
--
-- Eine Zeile je Betrieb, Endpunkt und Geschaeftstag, die erfolgreich
-- (HTTP 200) geholt wurde — auch mit leerer Antwort (ein Ruhetag ist
-- erledigt, wie D5 in Stufe 1). Fehlversuche stehen nur in raw.api_antwort
-- und in sync.tpapi_zugang: eine Fehlerzeile hier verdraengte sonst den
-- letzten guten Rohsatz.
--
-- GLEICHER HASH, KEIN NEUER ROHSATZ. Das Dreitagesfenster (S7) holt jeden
-- Tag dreimal, ein Journal hat 1-2 MB. Bleibt der Hash gleich, zaehlt nur
-- abrufe hoch und abgerufen_am wird frisch; raw_id zeigt weiter auf den
-- vorhandenen Rohsatz. Aendert er sich: neuer Rohsatz, geaendert_am, und
-- core_stand zurueck auf NULL (2b muss neu laden).
-- ---------------------------------------------------------------------

CREATE TABLE core.tpapi_abruf (
    betrieb_key    integer      NOT NULL REFERENCES core.betrieb(betrieb_key),
    endpunkt       text         NOT NULL CHECK (endpunkt LIKE 'tpapi:%'),
    geschaeftstag  date         NOT NULL,
    http_status    integer      NOT NULL,
    zeilen         integer      NOT NULL DEFAULT 0 CHECK (zeilen >= 0),
    payload_bytes  integer      NOT NULL,
    payload_hash   text         NOT NULL,
    raw_id         bigint       NOT NULL,
    erstmals_am    timestamptz  NOT NULL DEFAULT now(),
    abgerufen_am   timestamptz  NOT NULL DEFAULT now(),
    abrufe         integer      NOT NULL DEFAULT 1 CHECK (abrufe > 0),
    geaendert_am   timestamptz,
    core_stand     integer,
    ladefehler     text,
    PRIMARY KEY (betrieb_key, endpunkt, geschaeftstag)
);

-- Fuer mart.quelle_messen() (max(abgerufen_am) je Endpunkt) und den Abrufstand.
CREATE INDEX tpapi_abruf_endpunkt_abgerufen ON core.tpapi_abruf (endpunkt, abgerufen_am DESC);

COMMENT ON TABLE core.tpapi_abruf IS
'TPAPI-Rohabzug (0151): je Betrieb, Endpunkt (tpapi:journal, tpapi:journaltables,
tpapi:personalkostenprotag) und Geschaeftstag der letzte erfolgreiche Abruf (HTTP 200) mit Hash,
Groesse und Rohsatz in raw.api_antwort. Auch leere Antworten (zeilen = 0) — der Tag gilt als
geholt. Der Inhalt steht NUR in raw; core.kassenjournal & Co. baut Schritt 2b daraus
(core_stand). Fehlversuche stehen in raw.api_antwort und sync.tpapi_zugang, nicht hier.';
COMMENT ON COLUMN core.tpapi_abruf.endpunkt IS
'Wie raw.api_antwort.endpunkt: tpapi:<letztes Pfadstueck> (src/tpapi/endpunkte.ts).';
COMMENT ON COLUMN core.tpapi_abruf.http_status IS
'Immer 200 — nur erfolgreiche Abrufe werden vermerkt. Die Spalte steht da, damit eine spaetere
Entscheidung (etwa: 404 heisst "Tag gibt es nicht") ohne Migration vermerkt werden kann.';
COMMENT ON COLUMN core.tpapi_abruf.zeilen IS
'Zeilen der Antwort (Listenlaenge). Bei personalkostenprotag die Zahl der Personen — die Zeilen je
Person werden vor raw zur Summe verdichtet und nirgends gespeichert (Plan S5).';
COMMENT ON COLUMN core.tpapi_abruf.payload_bytes IS
'Groesse des gespeicherten JSON-Texts (Schluessel sortiert) in Bytes, vor der Kompression durch
PostgreSQL. Die Groesse des JUENGSTEN Rohsatzes, nicht die Summe aller Versionen.';
COMMENT ON COLUMN core.tpapi_abruf.payload_hash IS
'sha256 des gespeicherten JSON-Texts. Gleicher Hash beim naechsten Abruf = kein neuer Rohsatz.';
COMMENT ON COLUMN core.tpapi_abruf.raw_id IS
'Der Rohsatz mit diesem Inhalt (raw.api_antwort.id) — bei unveraendertem Hash der aeltere.';
COMMENT ON COLUMN core.tpapi_abruf.erstmals_am IS
'Erster erfolgreicher Abruf dieses Tages. Liegt der Geschaeftstag mehr als drei Tage davor, kam er
aus dem Nachladen (Phase C) und nicht aus dem Fenster — so misst mart.tpapi_rueckstand, ob das
Nachladen noch vorankommt.';
COMMENT ON COLUMN core.tpapi_abruf.abgerufen_am IS
'Letzter erfolgreicher Abruf, auch wenn sich nichts geaendert hat.';
COMMENT ON COLUMN core.tpapi_abruf.abrufe IS
'Wie oft der Tag erfolgreich geholt wurde (Fenster und Nachladen zusammen).';
COMMENT ON COLUMN core.tpapi_abruf.geaendert_am IS
'Letzter Abruf, bei dem sich der Hash gegen den vorherigen geaendert hat; NULL = nie geaendert.
Die Messung fuer das Fenster (Plan S7): aendert sich ein Kassentag nach drei Tagen noch?';
COMMENT ON COLUMN core.tpapi_abruf.core_stand IS
'Version des Laders (Schritt 2b), mit der der Rohsatz nach core kam; NULL = noch nicht geladen. Wird
bei jedem neuen Rohsatz auf NULL zurueckgesetzt.';
COMMENT ON COLUMN core.tpapi_abruf.ladefehler IS
'Fuer Schritt 2b: warum der Rohsatz nicht nach core kam. In 2a immer NULL.';


-- ---------------------------------------------------------------------
-- 3. Die tagfreien Listen (Artikelstamm; spaeter die Prognose)
--
-- Jeder erfolgreiche Abruf eine Zeile; ein neuer Rohsatz nur bei neuem Hash
-- (neu = true). So bleibt sichtbar, WANN gefragt wurde, ohne dreizehn
-- unveraenderte Listen je Betrieb und Woche zu verdoppeln.
-- ---------------------------------------------------------------------

CREATE TABLE core.tpapi_stammabzug (
    abzug_id       bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    betrieb_key    integer      NOT NULL REFERENCES core.betrieb(betrieb_key),
    endpunkt       text         NOT NULL CHECK (endpunkt LIKE 'tpapi:%'),
    abgerufen_am   timestamptz  NOT NULL DEFAULT now(),
    http_status    integer      NOT NULL,
    zeilen         integer      NOT NULL DEFAULT 0 CHECK (zeilen >= 0),
    payload_bytes  integer      NOT NULL,
    payload_hash   text         NOT NULL,
    raw_id         bigint       NOT NULL,
    neu            boolean      NOT NULL,
    core_stand     integer
);

CREATE INDEX tpapi_stammabzug_betrieb ON core.tpapi_stammabzug (betrieb_key, endpunkt, abgerufen_am DESC);
CREATE INDEX tpapi_stammabzug_endpunkt ON core.tpapi_stammabzug (endpunkt, abgerufen_am DESC);

COMMENT ON TABLE core.tpapi_stammabzug IS
'TPAPI-Rohabzug der tagfreien Listen (0151): die dreizehn Listen des Artikelstamms
(merchandiseman/*) je Betrieb, woechentlich (TPAPI_STAMM_TAGE). Eine Zeile je erfolgreichem Abruf;
der Inhalt steht in raw.api_antwort (raw_id). Kein core-Artikelstamm vor der Formprobe (Plan S11).';
COMMENT ON COLUMN core.tpapi_stammabzug.neu IS
'true = der Hash unterschied sich vom vorherigen Abzug derselben Liste, es kam ein neuer Rohsatz;
false = unveraendert, raw_id zeigt auf den vorhandenen.';
COMMENT ON COLUMN core.tpapi_stammabzug.zeilen IS
'Laenge der gelieferten Liste.';
COMMENT ON COLUMN core.tpapi_stammabzug.core_stand IS
'Fuer Schritt 2b; NULL = nicht nach core geladen.';


-- ---------------------------------------------------------------------
-- 3b. sync.tpapi_zugang: alle drei Module sind jetzt in Gebrauch
--
-- Der CHECK auf modul (personal, revenue, artikel) steht seit 0149; nur der
-- Kommentar sagte noch "fuer Stufe 2 vorgesehen".
-- ---------------------------------------------------------------------

COMMENT ON COLUMN sync.tpapi_zugang.modul IS
'personal (Team Data API: personalkostenprostunde seit 0149, personalkostenprotag seit 0151) |
revenue (Sales Data API: listdays, journal, journaltables, seit 0151) | artikel (Article Data API:
merchandiseman/*, seit 0151). Ein "not licensed" schaltet nur das eine Modul ab (Plan Stufe 2 S9).';


-- ---------------------------------------------------------------------
-- 4. Das Quellenregister misst an einem TEIL einer Tabelle
--
-- Drei Endpunkte schreiben in core.tpapi_abruf. Gemessen an der ganzen
-- Tabelle saehe "Journal liefert seit Tagen nichts" aus wie "ok", solange
-- die Personalkosten je Tag weiterlaufen — genau die Signatur von Regel 10.
-- Statt einer Bedingung als Text (dynamisches SQL in einer SECURITY-DEFINER-
-- Funktion) eine Spalte und eine Werteliste: der Bezeichner geht durch
-- format('%I'), die Werte als Parameter.
-- ---------------------------------------------------------------------

ALTER TABLE sync.quelle ADD COLUMN IF NOT EXISTS filter_spalte text;
ALTER TABLE sync.quelle ADD COLUMN IF NOT EXISTS filter_werte  text[];
ALTER TABLE sync.quelle DROP CONSTRAINT IF EXISTS quelle_filter_vollstaendig;
ALTER TABLE sync.quelle ADD CONSTRAINT quelle_filter_vollstaendig
  CHECK ((filter_spalte IS NULL) = (filter_werte IS NULL)
         AND (filter_spalte IS NULL OR tabelle IS NOT NULL));

COMMENT ON COLUMN sync.quelle.filter_spalte IS
'Nur mit tabelle: gemessen wird nur an den Zeilen, deren filter_spalte in filter_werte steht (0151) —
etwa core.tpapi_abruf mit endpunkt = tpapi:journal.';
COMMENT ON COLUMN sync.quelle.filter_werte IS
'Die zulaessigen Werte von filter_spalte.';

-- Rumpf wie 0076, nur der Tabellenzweig kennt den Filter. SECURITY DEFINER und
-- search_path wie 0109 — CREATE OR REPLACE setzt beides sonst zurueck.
CREATE OR REPLACE FUNCTION mart.quelle_messen()
RETURNS TABLE (quelle text, zuletzt_gefragt timestamptz, zuletzt_zulauf timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    r record;
    g timestamptz;
    z timestamptz;
BEGIN
    FOR r IN SELECT * FROM sync.quelle ORDER BY quelle LOOP
        IF r.endpunkt IS NOT NULL THEN
            SELECT max(a.beendet_am) FILTER (WHERE a.status IN ('ok','keine_daten')),
                   max(a.beendet_am) FILTER (WHERE a.status = 'ok' AND coalesce(a.zeilen,0) > 0)
              INTO g, z
              FROM sync.aufgabe a
             WHERE a.endpunkt = r.endpunkt;
        ELSIF r.filter_spalte IS NULL THEN
            EXECUTE format('SELECT max(%I) FROM %I.%I', r.zeitspalte, r.schema_name, r.tabelle)
              INTO z;
            g := z;
        ELSE
            EXECUTE format('SELECT max(%I) FROM %I.%I WHERE %I = ANY($1)',
                           r.zeitspalte, r.schema_name, r.tabelle, r.filter_spalte)
              INTO z USING r.filter_werte;
            g := z;
        END IF;
        quelle := r.quelle; zuletzt_gefragt := g; zuletzt_zulauf := z;
        RETURN NEXT;
    END LOOP;
END $$;

COMMENT ON FUNCTION mart.quelle_messen() IS
'Misst je Zeile in sync.quelle, wann zuletzt gefragt und wann zuletzt Zulauf
entstanden ist. Ueber sync.aufgabe, wo der Importer selbst protokolliert hat,
sonst direkt an der Zieltabelle (Yext-Nachlauf schreibt keine Aufgabe) — seit
0151 auf Wunsch nur an den Zeilen mit filter_spalte = ANY(filter_werte).

SEIT 0109 SECURITY DEFINER: der Rumpf liest `sync`, und ein Funktionsrumpf erbt die Rechte
des Aufrufers. mart.quelle_zulauf war dadurch fuer mcp_leser unlesbar — die Zulaufpruefung
also genau fuer die Schnittstelle, die sie am noetigsten hat. Aufloesen wie bei
ampel.hauptkonzept() geht hier nicht: der zweite Zweig baut die Abfrage dynamisch.';


-- ---------------------------------------------------------------------
-- 5a. Der Rueckstand je Tag — die Arbeitsliste von Phase C
--
-- Je Betrieb, Tagesendpunkt und Geschaeftstag, der laut Arbeitsliste geholt
-- werden soll und noch keine Abrufzeile hat. Der Importer liest GENAU diese
-- Sicht (src/tpapi/rohabzug.ts, tpapiNachladen) — was nachgeladen wird und
-- was als Rueckstand zaehlt, ist dieselbe Zahl.
--
-- DIE ENDPUNKTLISTE steht hier fest (VALUES), weil eine Sicht das Register
-- in src/tpapi/endpunkte.ts nicht lesen kann — wie die 365 in
-- mart.personal_rueckstand. src/tpapi/endpunkte.test.ts prueft, dass die
-- Liste hier und die aktiven Tagesendpunkte dort dieselben sind.
--
-- DIE ARBEITSLISTE: die juengste listdays-Antwort des Betriebs (nur Tage vor
-- heute). Ein Betrieb OHNE listdays — Team Data ohne Sales Data, etwa
-- Ratskeller Saarbruecken: revenue/listdays antwortet 403 — bekommt fuer
-- personalkostenprotag den Horizont aus Stufe 1, 365 Tage bis gestern.
-- Abweichung vom Wortlaut von S2, Begruendung in Plan §8.
--
-- Nicht lizenzierte Module stehen nicht darin (die Zahl ginge nie auf null,
-- 0071); sie stehen in mart.tpapi_zugang_modul.
-- ---------------------------------------------------------------------

CREATE VIEW mart.tpapi_rueckstand_tag AS
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
'Arbeitsliste des TPAPI-Nachladens (0151): je Betrieb mit Schluessel, Tagesendpunkt (Journal, Bons,
Personalkosten je Tag) und Geschaeftstag, der laut LINAs listdays existiert und noch nie
erfolgreich geholt wurde. Phase C holt daraus die neuesten Tage zuerst. Die Zeilenzahl MUSS fallen
und 0 erreichen; die verdichtete Zahl je Betrieb steht in mart.tpapi_rueckstand. Betriebe ohne
Sales Data API haben keine listdays — fuer Personalkosten je Tag gelten dort die letzten 365 Tage
(arbeitsliste = horizont 365). Nicht lizenzierte Module fehlen hier und stehen in
mart.tpapi_zugang_modul.';
COMMENT ON COLUMN mart.tpapi_rueckstand_tag.endpunkt IS
'tpapi:journal (Kassenjournal je Position) | tpapi:journaltables (je Bon) |
tpapi:personalkostenprotag (Personalkosten je Tag, als Summe).';
COMMENT ON COLUMN mart.tpapi_rueckstand_tag.modul IS
'Gebuchtes Modul, an dem der Endpunkt haengt: revenue (Sales Data) oder personal (Team Data).';
COMMENT ON COLUMN mart.tpapi_rueckstand_tag.arbeitsliste IS
'listdays (die Tage, die LINA fuer den Betrieb fuehrt) | horizont 365 (Betrieb ohne listdays:
die letzten 365 Tage, nur fuer Personalkosten je Tag).';
COMMENT ON COLUMN mart.tpapi_rueckstand_tag.zugang_zustand IS
'Ausgang des letzten Aufrufs fuer dieses Modul (sync.tpapi_zugang.zustand) — gebremst oder fehler
erklaeren, warum ein Betrieb hier stehen bleibt.';


-- ---------------------------------------------------------------------
-- 5b. Der Rueckstand verdichtet — die Zahl, die fallen muss
--
-- Je Betrieb und Tagesendpunkt, auch wenn nichts fehlt (dann tage_fehlend =
-- 0): wer fertig ist, soll als fertig dastehen und nicht verschwinden.
--
-- "stockt" ist die Pruefung aus Plan §4 ("Rueckstand faellt nicht mehr"),
-- ohne Verlaufstabelle: es fehlt etwas, die Arbeitsliste ist seit mehr als
-- 48 Stunden bekannt, und in den letzten 48 Stunden kam kein einziger Tag
-- aus dem NACHLADEN hinzu. Nachladen heisst: der Geschaeftstag lag beim
-- ersten Abruf mehr als drei Tage zurueck (das Fenster von Phase A,
-- src/tpapi/endpunkte.ts) — sonst verdeckte das Fenster einen stehenden
-- Rueckstand, weil jede Nacht ein neuer gestriger Tag dazukommt.
-- ---------------------------------------------------------------------

CREATE VIEW mart.tpapi_rueckstand AS
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
'TPAPI-Rohabzug je Betrieb und Tagesendpunkt (0151): wie viele Geschaeftstage LINA fuehrt
(tage_liste), wie viele geholt sind und wie viele fehlen — die Zahl, die Nacht fuer Nacht FALLEN
muss. stockt = es fehlt etwas, und seit 48 Stunden kam kein Tag aus dem Nachladen dazu (Pruefzeile
in mart.pruefung_uebersicht). Ein Betrieb, der fehlt, hat keinen Schluessel oder das Modul nicht
gebucht — siehe mart.tpapi_zugang_modul. Geholt heisst roh gesichert; ob ein Tag schon in den
Auswertungen steht, sagt mart.tpapi_abruf_stand (in_core).';
COMMENT ON COLUMN mart.tpapi_rueckstand.arbeitsliste IS
'listdays | horizont 365 (Personalkosten je Tag bei Betrieben ohne listdays) | keine liste (Sales
Data gebucht, aber listdays noch nie erfolgreich — dann steht auch nichts im Rueckstand; der
Zugang je Modul zeigt warum).';
COMMENT ON COLUMN mart.tpapi_rueckstand.tage_liste IS
'Geschaeftstage vor heute in der juengsten listdays-Antwort (bzw. 365).';
COMMENT ON COLUMN mart.tpapi_rueckstand.tage_geholt IS
'Tage mit erfolgreichem Abruf — alle, auch solche, die nicht mehr in listdays stehen.';
COMMENT ON COLUMN mart.tpapi_rueckstand.tage_fehlend IS
'Tage der Arbeitsliste ohne erfolgreichen Abruf = Zeilen in mart.tpapi_rueckstand_tag.';
COMMENT ON COLUMN mart.tpapi_rueckstand.letzter_nachladen IS
'Juengster erster Abruf eines Tages, der dabei mehr als drei Tage zurueck lag (also aus dem
Nachladen, nicht aus dem Fenster).';
COMMENT ON COLUMN mart.tpapi_rueckstand.bekannt_seit IS
'Seit wann die Arbeitsliste bekannt ist (erster listdays-Eintrag, sonst erster Abruf).';
COMMENT ON COLUMN mart.tpapi_rueckstand.stockt IS
'true = tage_fehlend > 0, die Arbeitsliste ist aelter als 48 h, und seit 48 h kam kein Tag aus dem
Nachladen dazu. Das Nachladen laeuft nicht (TPAPI_NACHLADEN_JE_LAUF = 0, Zeitgrenze, 429) oder
haengt an einem Tag, den LINA nicht liefert.';


-- ---------------------------------------------------------------------
-- 5c. Der Abrufstand je Endpunkt — wie viel liegt roh, wie viel in core
-- ---------------------------------------------------------------------

CREATE VIEW mart.tpapi_abruf_stand AS
SELECT 'tag'::text                                              AS art,
       a.endpunkt,
       count(DISTINCT a.betrieb_key)::int                       AS betriebe,
       count(*)::int                                            AS eintraege,
       count(*) FILTER (WHERE a.core_stand IS NOT NULL)::int    AS in_core,
       count(*) FILTER (WHERE a.geaendert_am IS NOT NULL)::int  AS geaendert,
       sum(a.abrufe)::bigint                                    AS abrufe,
       sum(a.payload_bytes)::bigint                             AS bytes,
       sum(a.zeilen)::bigint                                    AS zeilen,
       count(*) FILTER (WHERE a.zeilen = 0)::int                AS leer,
       min(a.geschaeftstag)                                     AS aeltester_tag,
       max(a.geschaeftstag)                                     AS juengster_tag,
       max(a.abgerufen_am)                                      AS letzter_abruf,
       count(*) FILTER (WHERE a.ladefehler IS NOT NULL)::int    AS ladefehler
  FROM core.tpapi_abruf a
 GROUP BY a.endpunkt
UNION ALL
SELECT 'stamm'::text,
       s.endpunkt,
       count(DISTINCT s.betrieb_key)::int,
       count(*)::int,
       count(*) FILTER (WHERE s.core_stand IS NOT NULL)::int,
       count(*) FILTER (WHERE s.neu)::int,
       count(*)::bigint,
       sum(s.payload_bytes) FILTER (WHERE s.neu)::bigint,
       sum(s.zeilen)::bigint,
       count(*) FILTER (WHERE s.zeilen = 0)::int,
       NULL::date,
       NULL::date,
       max(s.abgerufen_am),
       0
  FROM core.tpapi_stammabzug s
 GROUP BY s.endpunkt;

COMMENT ON VIEW mart.tpapi_abruf_stand IS
'TPAPI-Rohabzug je Endpunkt (0151): wie viel liegt roh gesichert, wie viel davon ist schon in den
Auswertungen (in_core — erst ab Schritt 2b), wie oft hat sich ein Tag nach dem ersten Abruf noch
geaendert. art = tag (Journal, Bons, Personalkosten je Tag: eine Zeile je Betrieb und Tag) | stamm
(Artikelstamm: eine Zeile je Abzug). Fuer stamm zaehlt eintraege die Abzuege, geaendert die mit
neuem Inhalt, bytes nur die neuen Rohsaetze.';
COMMENT ON COLUMN mart.tpapi_abruf_stand.eintraege IS
'tag: geholte Betrieb-Tage; stamm: Abzuege.';
COMMENT ON COLUMN mart.tpapi_abruf_stand.in_core IS
'Davon in core geladen (core_stand gesetzt). In Schritt 2a immer 0.';
COMMENT ON COLUMN mart.tpapi_abruf_stand.geaendert IS
'tag: Betrieb-Tage, deren Inhalt sich nach dem ersten Abruf noch geaendert hat (Messung fuer das
Dreitagesfenster); stamm: Abzuege mit neuem Inhalt.';
COMMENT ON COLUMN mart.tpapi_abruf_stand.bytes IS
'Groesse der gespeicherten JSON-Texte in Bytes, vor der Kompression — tag: der juengste Rohsatz je
Tag, stamm: alle neuen Rohsaetze. Nicht der Plattenplatz von raw.api_antwort.';
COMMENT ON COLUMN mart.tpapi_abruf_stand.leer IS
'Eintraege mit leerer Antwort (Ruhetag, keine Schicht, leere Liste).';


-- ---------------------------------------------------------------------
-- 5d. Der Zugang je Modul — alle Betriebe, alle drei Module
--
-- WARUM EINE EIGENE SICHT und nicht mart.tpapi_zugang erweitert. Dort ist
-- befund der des Personalmoduls (mit "Schluessel ohne Schichten", 0150),
-- und Karten und Pruefzeilen lesen ihn so. Spalten fuer zwei weitere Module
-- daneben machten aus einem befund drei, einer davon ohne Namen; und
-- CREATE OR REPLACE haette den ganzen Rumpf aus 0150 wiederholen muessen.
-- Hier eine Zeile je Betrieb und Modul, mit eigener Erfolgsschwelle:
-- personal und revenue werden jede Nacht gefragt (48 h), der Artikelstamm
-- einmal die Woche (192 h = TPAPI_STAMM_TAGE + ein Tag).
-- ---------------------------------------------------------------------

CREATE VIEW mart.tpapi_zugang_modul AS
SELECT bs.betrieb_key,
       bs.betrieb,
       bs.konzept,
       bs.status,
       m.modul,
       coalesce(z.schluessel_vorhanden, false)      AS schluessel,
       z.zustand,
       z.zuletzt_gefragt_am                         AS zuletzt_gefragt,
       z.zuletzt_erfolg_am                          AS zuletzt_erfolg,
       z.letzter_http,
       z.letzter_fehler,
       m.erfolg_binnen_stunden,
       CASE WHEN coalesce(z.schluessel_vorhanden, false) THEN
                CASE WHEN z.zustand = 'nicht_lizenziert' THEN 'nicht lizenziert'
                     WHEN z.zustand = 'abgewiesen'       THEN 'abgewiesen'
                     WHEN z.zustand = 'gebremst'         THEN 'gebremst'
                     WHEN z.zuletzt_erfolg_am IS NULL
                       OR z.zuletzt_erfolg_am < now() - make_interval(hours => m.erfolg_binnen_stunden)
                                                         THEN 'Schluessel ohne Zulauf'
                     ELSE 'ok' END
            WHEN bs.status = 'operativ'                  THEN 'operativ ohne Schluessel'
            ELSE 'nicht operativ' END               AS befund
  FROM mart.betrieb_status bs
  CROSS JOIN (VALUES ('personal', 48), ('revenue', 48), ('artikel', 192)) AS m(modul, erfolg_binnen_stunden)
  LEFT JOIN sync.tpapi_zugang z
         ON z.betrieb_key = bs.betrieb_key
        AND z.modul = m.modul;

COMMENT ON VIEW mart.tpapi_zugang_modul IS
'TPAPI-Zugang je Betrieb und Modul, alle Betriebe (0151): personal (Team Data API: Personal je
Stunde und je Tag) | revenue (Sales Data API: Journal, Bons, listdays) | artikel (Article Data API:
Artikelstamm). Ein Betrieb kann ein Modul gebucht haben und ein anderes nicht. befund: ok |
Schluessel ohne Zulauf (kein Erfolg binnen erfolg_binnen_stunden) | nicht lizenziert (Modul nicht
gebucht — ein Zustand, kein Fehler) | abgewiesen | gebremst | operativ ohne Schluessel | nicht
operativ. Fuer das Personalmodul fuehrt mart.tpapi_zugang den genaueren befund (mit "Schluessel
ohne Schichten").';
COMMENT ON COLUMN mart.tpapi_zugang_modul.modul IS
'personal | revenue | artikel — die drei Daten-APIs im Marktplatz des Betriebs.';
COMMENT ON COLUMN mart.tpapi_zugang_modul.erfolg_binnen_stunden IS
'Binnen wie vieler Stunden ein erfolgreicher Abruf erwartet wird: 48 fuer die naechtlichen Module,
192 fuer den woechentlichen Artikelstamm.';
COMMENT ON COLUMN mart.tpapi_zugang_modul.zustand IS
'Ausgang des letzten Aufrufs in diesem Modul (sync.tpapi_zugang.zustand); NULL ohne Schluessel.';


-- ---------------------------------------------------------------------
-- 6. Pruefuebersicht: zwei Zeilen, beide koennen auf null gehen
--
-- Zeile 1 geht auf null, wenn das Nachladen vorankommt (oder alles geholt
-- ist). Zeile 2, wenn jedes gebuchte Modul mit Schluessel binnen seiner
-- Schwelle eine Antwort bekam. Das Personalmodul steht dort nicht: dafuer
-- gibt es seit 0149 "TPAPI: Schluessel ohne Zulauf (48 h)".
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%tpapi_rueckstand%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        SELECT 'TPAPI: Rohabzug-Rueckstand faellt nicht (48 h)'::text AS pruefung,
               count(*) FILTER (WHERE r.tage_fehlend > 0)::bigint AS geprueft,
               count(*) FILTER (WHERE r.stockt)::bigint           AS auffaellig,
               'mart.tpapi_rueckstand'::text AS sicht
          FROM mart.tpapi_rueckstand r
        $zweig$,
        $zweig$
        SELECT 'TPAPI: Modul Umsatz/Artikel mit Schluessel ohne Zulauf'::text AS pruefung,
               count(*) FILTER (WHERE t.schluessel AND t.modul IN ('revenue', 'artikel'))::bigint AS geprueft,
               count(*) FILTER (WHERE t.modul IN ('revenue', 'artikel')
                                  AND t.befund = 'Schluessel ohne Zulauf')::bigint             AS auffaellig,
               'mart.tpapi_zugang_modul'::text AS sicht
          FROM mart.tpapi_zugang_modul t
        $zweig$);

    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def NOT LIKE '%Rohabzug-Rueckstand faellt nicht%'
       OR v_def NOT LIKE '%Modul Umsatz/Artikel mit Schluessel ohne Zulauf%' THEN
        RAISE EXCEPTION '0151: mart.pruefung_uebersicht traegt nach dem Umbau nicht die erwarteten Zeilen';
    END IF;
END $aussen$;


-- ---------------------------------------------------------------------
-- 7. MCP-Katalog: Koernung, Rechte, Leseprobe
--
-- Keine neuen Fallstricke: die Sichten sind Import-Sichten ohne fachliche
-- Zahl. Die Fallen der Kassendaten (Journal ist eine Buchungsliste mit Saldo
-- null, debitor_text/addinfo/zip_code nie nach mart) kommen mit 2b.
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.tpapi_rueckstand_tag',
     'Betrieb × TPAPI-Tagesendpunkt × fehlender Geschaeftstag — Arbeitsliste des Nachladens, muss auf 0 fallen',
     'import', false),
    ('mart.tpapi_rueckstand',
     'Betrieb × TPAPI-Tagesendpunkt — Tage laut listdays, geholt, fehlend, stockt',
     'import', false),
    ('mart.tpapi_abruf_stand',
     'TPAPI-Endpunkt — roh gesicherte Tage bzw. Abzuege, davon in core, geaendert, Bytes',
     'import', false),
    ('mart.tpapi_zugang_modul',
     'Betrieb (alle) × TPAPI-Modul (personal, revenue, artikel) — Schluessel, letzter Aufruf, befund',
     'import', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

SELECT mcp.rechte_auffrischen();

-- Die Gegenprobe als Leserolle (Pflicht seit 0110): SELECT * … LIMIT 1, nicht
-- count(*) — der wertet die Spaltenausdruecke nicht aus.
DO $probe$
DECLARE
    v_abfrage text;
    v_liegen  text[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0151 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0151 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_abfrage IN ARRAY ARRAY[
        'SELECT * FROM mart.tpapi_rueckstand_tag LIMIT 1',
        'SELECT * FROM mart.tpapi_rueckstand LIMIT 1',
        'SELECT * FROM mart.tpapi_abruf_stand LIMIT 1',
        'SELECT * FROM mart.tpapi_zugang_modul LIMIT 1',
        'SELECT * FROM mart.quelle_zulauf LIMIT 1',
        'SELECT * FROM mart.pruefung_uebersicht WHERE sicht IN (''mart.tpapi_rueckstand'', ''mart.tpapi_zugang_modul'')']
    LOOP
        BEGIN
            EXECUTE v_abfrage;
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_abfrage, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0151 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
