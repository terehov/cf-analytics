-- =====================================================================
-- 0162 Fehltage im TPAPI-Nachladen und Yext A_03
--
-- A. FEHLTAGE (Auftrag Eugene, 21.11.2026: „die Tage, die bei LINA nicht
--    geladen werden konnten — werden diese nachgeladen? Wenn nicht, bitte tun.")
--
-- BEFUND. Nach 0161 bleiben 528 Tage Personal (je Tag und je Stunde) bei drei
-- Betrieben offen, an denen LINA mit HTTP 500 antwortet: Gastronomie
-- Wilsdruffer Strasse 391 (2018-11 bis 2019-11), Enchilada Freiburg 136,
-- Aposto Gera 1. Nachgeladen wurden sie praktisch NICHT: das Nachladen geht
-- neueste zuerst, und drei Fehler in Folge schalten das Modul fuer den Lauf
-- ab. Jede Nacht kamen dieselben drei juengsten Tage dran, scheiterten, und
-- kein aelterer Tag wurde je gefragt. mart.tpapi_rueckstand stand auf
-- `stockt` — sichtbar, aber nichts im Importer konnte es loesen.
--
-- UMBAU (src/tpapi/rohabzug.ts, `zaehltAlsFehltag()`):
--   1. sync.tpapi_fehltag haelt je Betrieb, Endpunkt und Tag fest, wie oft
--      und in wie vielen Naechten LINA im Nachladen mit 5xx antwortete.
--   2. Bekannte Fehltage kommen ans ENDE der Arbeitsliste.
--   3. Hat das Modul in diesem Lauf schon geliefert, schaltet ein 5xx an einem
--      Tag es nicht mehr nach drei in Folge ab — es ist ein Tag, den LINA nicht
--      hat, kein Ausfall. Bremse: TPAPI_FEHLTAGE_JE_LAUF (200) je Betrieb und
--      Modul. So wird jeder dieser Tage jede Nacht einmal gefragt.
--   4. Nach drei Naechten mit Fehler (mart.tpapi_fehltag_naechte()) ist ein Tag
--      aufgegeben: er faellt aus den Arbeitslisten und dem Rueckstand und steht
--      in mart.tpapi_fehltag und als tage_aufgegeben in mart.tpapi_rueckstand.
--      Liefert LINA einen Fehltag spaeter doch, wird er geholt und aus der
--      Liste geloescht (sync, nicht raw — Regel 4 gilt nicht).
--
-- Ein aufgegebener Tag wird nicht mehr gefragt. Wer ihn erneut versuchen will:
--   DELETE FROM sync.tpapi_fehltag WHERE ...;
-- dann steht er wieder in der Arbeitsliste.
--
-- B. YEXT A_03 (Auftrag Eugene, 21.11.2026). Aposto Augsburg ist geschlossen,
--    Yext hat die Entitaet A_03 geloescht; die Zuordnung liess jede Statusmeldung
--    seit 0130 „Yext kennt zugeordnete Entitaeten nicht mehr: A_03" melden.
-- =====================================================================


-- ---------------------------------------------------------------------
-- A1. Die Liste der Fehltage
-- ---------------------------------------------------------------------

CREATE TABLE sync.tpapi_fehltag (
    betrieb_key       integer     NOT NULL REFERENCES core.betrieb(betrieb_key),
    endpunkt          text        NOT NULL CHECK (endpunkt LIKE 'tpapi:%'),
    geschaeftstag     date        NOT NULL,
    versuche          integer     NOT NULL DEFAULT 1 CHECK (versuche > 0),
    naechte           integer     NOT NULL DEFAULT 1 CHECK (naechte > 0),
    letzte_nacht      date        NOT NULL,
    erster_fehler_am  timestamptz NOT NULL DEFAULT now(),
    letzter_fehler_am timestamptz NOT NULL DEFAULT now(),
    letzter_http      integer     NOT NULL,
    meldung           text,
    PRIMARY KEY (betrieb_key, endpunkt, geschaeftstag)
);

COMMENT ON TABLE sync.tpapi_fehltag IS
'TPAPI-Tage, an denen LINA im Nachladen mit 5xx antwortete, waehrend dasselbe Modul im selben
Lauf geliefert hat (0162) — ein Tag, den LINA nicht hat, kein Ausfall. versuche zaehlt Aufrufe,
naechte die Kalendertage (Berlin) mit mindestens einem Fehlversuch. Ab
mart.tpapi_fehltag_naechte() Naechten ist der Tag aufgegeben und faellt aus den Arbeitslisten.
Ein spaeter Erfolg loescht die Zeile. Lesbar ueber mart.tpapi_fehltag.';


-- ---------------------------------------------------------------------
-- A2. Ab wann ein Tag aufgegeben ist — an einer Stelle
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mart.tpapi_fehltag_naechte()
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$ SELECT 3 $$;

COMMENT ON FUNCTION mart.tpapi_fehltag_naechte() IS
'Nach so vielen Naechten mit Fehler (HTTP 5xx im Nachladen) ist ein TPAPI-Tag aufgegeben (0162).
Drei wie bei den Null- und Lochtagen (0100, 0101): eine Nacht kann ein Ausfall sein, drei nicht.';


-- ---------------------------------------------------------------------
-- A3. Arbeitslisten und Rueckstand ohne aufgegebene Tage
--     (Rumpf wie 0161, Spalten unveraendert; tpapi_rueckstand eine Spalte am Ende)
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
                      AND x.geschaeftstag = ar.geschaeftstag)
   AND NOT EXISTS (SELECT 1
                     FROM sync.tpapi_fehltag f
                    WHERE f.betrieb_key = ar.betrieb_key
                      AND f.endpunkt = ar.endpunkt
                      AND f.geschaeftstag = ar.geschaeftstag
                      AND f.naechte >= mart.tpapi_fehltag_naechte());

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
),
aufgegeben AS (
    SELECT f.betrieb_key, f.endpunkt, count(*)::int AS n
      FROM sync.tpapi_fehltag f
     WHERE f.naechte >= mart.tpapi_fehltag_naechte()
       AND f.geschaeftstag >= mart.tpapi_historie_ab()
     GROUP BY f.betrieb_key, f.endpunkt
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
             OR gh.letzter_nachladen < now() - interval '48 hours')) AS stockt,
       coalesce(ag.n, 0)                              AS tage_aufgegeben
  FROM paar p
  JOIN core.betrieb b      ON b.betrieb_key = p.betrieb_key
  LEFT JOIN liste_tage lt  ON lt.betrieb_key = p.betrieb_key
  LEFT JOIN geholt gh      ON gh.betrieb_key = p.betrieb_key AND gh.endpunkt = p.endpunkt
  LEFT JOIN fehlend f      ON f.betrieb_key = p.betrieb_key AND f.endpunkt = p.endpunkt
  LEFT JOIN aufgegeben ag  ON ag.betrieb_key = p.betrieb_key AND ag.endpunkt = p.endpunkt;

COMMENT ON COLUMN mart.tpapi_rueckstand.tage_aufgegeben IS
'Tage ab 2018, die LINA in drei Naechten nicht geliefert hat (HTTP 5xx) und die deshalb nicht
mehr im Rueckstand stehen (0162). Einzeln in mart.tpapi_fehltag.';

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
                      AND a.geschaeftstag = t.geschaeftstag)
   AND NOT EXISTS (SELECT 1
                     FROM sync.tpapi_fehltag f
                    WHERE f.betrieb_key = t.betrieb_key
                      AND f.endpunkt = 'tpapi:personalkostenprostunde'
                      AND f.geschaeftstag = t.geschaeftstag
                      AND f.naechte >= mart.tpapi_fehltag_naechte());

-- ---------------------------------------------------------------------
-- A4. Die Pruefsicht
-- ---------------------------------------------------------------------

CREATE VIEW mart.tpapi_fehltag AS
SELECT f.betrieb_key,
       b.name                                           AS betrieb,
       f.endpunkt,
       f.geschaeftstag,
       CASE WHEN f.naechte >= mart.tpapi_fehltag_naechte() THEN 'aufgegeben'
            ELSE 'wird erneut versucht' END             AS zustand,
       f.versuche,
       f.naechte,
       f.letzter_http,
       f.meldung,
       f.erster_fehler_am,
       f.letzter_fehler_am,
       (f.geschaeftstag < mart.tpapi_historie_ab())     AS vor_historie
  FROM sync.tpapi_fehltag f
  JOIN core.betrieb b ON b.betrieb_key = f.betrieb_key;

COMMENT ON VIEW mart.tpapi_fehltag IS
'TPAPI-Tage, die LINA im Nachladen nicht liefert (HTTP 5xx, waehrend das Modul sonst antwortet;
0162). zustand: wird erneut versucht (jede Nacht einmal, am Ende der Arbeitsliste) | aufgegeben
(nach mart.tpapi_fehltag_naechte() Naechten — faellt aus dem Rueckstand, hier bleibt er stehen).
Zaehlen je Betrieb und Endpunkt; eine Summe ueber Endpunkte zaehlt denselben Tag mehrfach.
Erneut versuchen: die Zeile in sync.tpapi_fehltag loeschen.';


-- ---------------------------------------------------------------------
-- B. Yext A_03 (Aposto Augsburg, geschlossen) aus der Zuordnung
-- ---------------------------------------------------------------------

DELETE FROM manual.betrieb_fremd_id WHERE system = 'yext' AND fremd_id = 'A_03';
