-- =====================================================================
-- 0155 Kassenartikel -> Rezept aus FoodNotify (core.pos_artikel befuellt)
--
-- ANLASS (Entscheidung Eugene, 19.11.2026). core.pos_artikel steht seit
-- 0030 im Schema und war leer: kein INSERT im Repo, kein Endpunkt. AGENTS.md
-- beschrieb die Bruecke LINA-Artikel -> FoodNotify-Rezept, als bestuende
-- sie. Die Leseprobe vom 19.11.2026 (docs/payloads/foodnotify-2026-11/
-- fn-probe-2026-11-19.md, Abschnitt 1) hat den Weg gemessen:
--
--   GET /api/pos/mapping/{connectionId}/articles (Cookie-Sitzung)
--   -> {location, restaurantId, canCreateRecipes, ingestIssues[], items[]}
--
-- Wilma Wunder: 32 Kassenanbindungen, alle amadeus. Drei abgerufen: 895,
-- 798 und 1.171 Artikel, davon 49,4 / 57,6 / 35,0 % mit Rezept. 19 bis 39 s
-- je Antwort, einer von drei Aufrufen brach ab.
--
-- WAS DIESE MIGRATION ANLEGT
--   1. core.pos_artikel umgebaut: ZUSTAND statt Monatsmomentaufnahme,
--      Schluessel (Kostenstelle, remote_id), alle Kennzeichen, fehlt_seit
--   2. core.pos_artikel_abruf     — letzter erfolgreicher Abruf je Anbindung
--   3. mart.pos_artikel_rezept    — Kassenartikel <-> Rezept, Zeilenebene
--   4. mart.pos_artikel_abdeckung — je Anbindung: Artikel, Rezeptanteil,
--                                   Umsatzabdeckung, Zustand (Regel 10)
--   5. mart.pos_artikel_abdeckung_betrieb — die Umsatzabdeckung je Betrieb
--   6. eine Zeile in mart.pruefung_uebersicht
--   7. sync.quelle: fn:pos_artikel und core:pos_artikel erwartet
--   8. MCP-Katalog, Fallstricke, Rechte, Leseprobe als mcp_leser
--
-- Der Importer (Registereintrag fn:pos_artikel, Lader, Einreihweg, Schalter
-- POS_ARTIKEL_MARKEN — vorerst nur wilma_wunder) steht im selben Commit.
-- GEBAUT GEGEN DIE ATTRAPPE, in Produktion noch nicht gelaufen.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. core.pos_artikel: Zustand statt Monatsmomentaufnahme
--
-- 0030 legte die Tabelle als Monatsmomentaufnahme an (PK kostenstelle,
-- monat, plu), damit "welches Rezept stand im Maerz hinter einem Artikel"
-- beantwortbar bleibt. Die Frage bleibt beantwortbar — aus raw: jede Antwort
-- je Anbindung und Tag steht in raw.api_antwort (append-only, Regel 4), und
-- core ist daraus neu aufbaubar. Eine Monatskopie in core haette jede Nacht
-- ~1.000 Zeilen je Anbindung dupliziert, um eine Frage zu beantworten, die
-- bisher niemand gestellt hat. Dafuer fuehrt die Zeile geaendert_am (letzte
-- fachliche Aenderung) und fehlt_seit (nicht mehr geliefert).
--
-- SCHLUESSEL remote_id (remoteProductId), NICHT plu. Begruendung in
-- docs/entscheidungen.md (19.11.2026): remoteProductId ist FoodNotifys
-- eigene Kennung des Kassenartikels, an der die Rezeptzuordnung haengt. Die
-- PLU vergibt die Kasse; wird ein Artikel an der Kasse umnummeriert, bliebe
-- bei einem PLU-Schluessel eine Leiche mit Rezept stehen und ein neuer
-- Artikel ohne. Bei anderen Kassensystemen ist die PLU zudem nicht
-- zugesichert. Gemessen 19.11.2026: in 2.864 Artikeln dreier Anbindungen
-- waren remoteProductId UND plu je Anbindung eindeutig — die Wahl kostet
-- heute also nichts; doppelte PLU faengt die Abdeckungssicht ab (EXISTS
-- statt Join).
--
-- Die Tabelle ist leer (in Produktion am 14.08.2026 und 19.11.2026
-- nachgezaehlt, kein Schreiber im Repo). Die Migration bricht ab, falls
-- doch Zeilen darin stehen — ALTER statt DROP, 0030 bleibt unveraendert.
-- ---------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM core.pos_artikel) THEN
        RAISE EXCEPTION '0155: core.pos_artikel ist nicht leer — der Umbau auf (kostenstelle_key, remote_id) '
                        'verwirft die Monatsspalte. Erst klaeren, wer dort geschrieben hat.';
    END IF;
END $$;

ALTER TABLE core.pos_artikel DROP CONSTRAINT pos_artikel_pkey;
DROP INDEX IF EXISTS core.pos_artikel_rezept;
DROP INDEX IF EXISTS core.pos_artikel_plu;
ALTER TABLE core.pos_artikel DROP COLUMN monat;
-- rezept_key entfaellt: das Rezept kommt oft erst NACH der Zuordnung in
-- core.rezept an (Tagesgeschaeft gegen Nachladen), ein beim Laden
-- aufgeloester Schluessel waere dann still NULL geblieben. Aufgeloest wird
-- in den Sichten ueber (marke_key, rezept_fn_id).
ALTER TABLE core.pos_artikel DROP COLUMN rezept_key;
ALTER TABLE core.pos_artikel ALTER COLUMN remote_id SET NOT NULL;
ALTER TABLE core.pos_artikel ALTER COLUMN plu DROP NOT NULL;
ALTER TABLE core.pos_artikel RENAME COLUMN ignoriert TO ist_ignoriert;
ALTER TABLE core.pos_artikel RENAME COLUMN geladen_am TO zuletzt_gesehen_am;
ALTER TABLE core.pos_artikel
    ADD COLUMN plu_zahl            bigint GENERATED ALWAYS AS
                                   (CASE WHEN plu ~ '^[0-9]{1,18}$' THEN plu::bigint END) STORED,
    ADD COLUMN externe_id          text,
    ADD COLUMN rezept_fn_id        integer,
    ADD COLUMN rezept_titel        text,
    ADD COLUMN wird_synchronisiert boolean,
    ADD COLUMN abwesend_seit       timestamptz,
    ADD COLUMN name_doppelt        boolean,
    ADD COLUMN name_weicht_ab      boolean,
    ADD COLUMN fehlt_seit          timestamptz,
    ADD COLUMN erstmals_am         timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN geaendert_am        timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN raw_id              bigint;
ALTER TABLE core.pos_artikel ADD PRIMARY KEY (kostenstelle_key, remote_id);

CREATE INDEX pos_artikel_plu_zahl ON core.pos_artikel (kostenstelle_key, plu_zahl);
CREATE INDEX pos_artikel_rezept   ON core.pos_artikel (rezept_fn_id) WHERE rezept_fn_id IS NOT NULL;

COMMENT ON TABLE core.pos_artikel IS
'Kassenartikel je Kassenanbindung mit FoodNotifys Rezeptzuordnung, aus
/api/pos/mapping/{connectionId}/articles (fn:pos_artikel, seit 0155). Eine
Zeile je Kostenstelle und remoteProductId, der ZUSTAND der letzten
erfolgreichen Antwort; der Verlauf steht in raw.api_antwort (jede Antwort),
core ist daraus neu aufbaubar.

DIE EINZIGE STELLE, AN DER LINA UND FOODNOTIFY FACHLICH ZUSAMMENTREFFEN.
Der Join ist plu_zahl = core.artikel.artikelnummer, UND ER GILT NUR, WO
core.kostenstelle.kassensystem = ''amadeus'' — siehe Kommentar dort.

Vorerst nur Wilma Wunder (POS_ARTIKEL_MARKEN). Ein Abbruch des Abrufs aendert
nichts; ein Artikel, der in einer erfolgreichen Antwort nicht mehr steht,
bekommt fehlt_seit und bleibt stehen. Auswertung: mart.pos_artikel_rezept,
mart.pos_artikel_abdeckung.';
COMMENT ON COLUMN core.pos_artikel.remote_id IS
'remoteProductId — FoodNotifys Kennung des Kassenartikels, je Anbindung eindeutig. Schluessel statt plu,
weil die Rezeptzuordnung an diesem Datensatz haengt und eine PLU an der Kasse umnummeriert werden kann
(docs/entscheidungen.md, 19.11.2026).';
COMMENT ON COLUMN core.pos_artikel.plu IS
'Die Kassenartikelnummer, wie FoodNotify sie liefert (Zeichenkette). Bei amadeus dieselbe Nummer wie
core.artikel.artikelnummer (Aposto Gera 01.08.2026: 99,7 % Namensgleichheit gegen 0,3 % Zufall).
Bei anderen Kassensystemen ein fremder Nummernkreis — dort NIE gegen core.artikel joinen.';
COMMENT ON COLUMN core.pos_artikel.plu_zahl IS
'plu als Zahl, wenn sie nur aus Ziffern besteht (Wilma Wunder 19.11.2026: alle, 4 bis 8 Stellen), sonst
NULL. Fuer den Join gegen core.artikel.artikelnummer — nur bei kassensystem = ''amadeus''.';
COMMENT ON COLUMN core.pos_artikel.externe_id IS
'externalId — die Kennung des Artikels im Kassensystem selbst (bei amadeus die posId aus ingestIssues).';
COMMENT ON COLUMN core.pos_artikel.rezept_fn_id IS
'recipeId — das zugeordnete Rezept (core.rezept.fn_id derselben Marke). NULL heisst: kein Rezept. Das ist
bei 40 bis 65 % der Kassenartikel der Fall (Wilma Wunder 19.11.2026) und eine Pflegefrage, kein
technischer Fehler. Aufloesen ueber (marke_key, rezept_fn_id), nie ueber den Titel.';
COMMENT ON COLUMN core.pos_artikel.rezept_titel IS
'recipeTitle, wie FoodNotify ihn zur Zuordnung liefert. Rezeptnamen sind nicht eindeutig.';
COMMENT ON COLUMN core.pos_artikel.ist_ignoriert IS
'isIgnored — FoodNotify verbucht den Artikel nicht. Zaehlt in den Sichten nicht als "mit Rezept",
auch wenn ein Rezept zugeordnet ist. Gemessen 19.11.2026: 0 von 2.864.';
COMMENT ON COLUMN core.pos_artikel.wird_synchronisiert IS
'isSyncing — von FoodNotify geliefert, Bedeutung nicht gemessen (bei Artikeln mit Rezept meist true).';
COMMENT ON COLUMN core.pos_artikel.abwesend_seit IS
'absentFromFeedSince — seit wann die KASSE den Artikel nicht mehr meldet (2052: 36 von 895). Nicht
dasselbe wie fehlt_seit: der Artikel steht dann weiter in FoodNotifys Antwort.';
COMMENT ON COLUMN core.pos_artikel.name_doppelt IS 'hasDuplicateName, von FoodNotify geliefert.';
COMMENT ON COLUMN core.pos_artikel.name_weicht_ab IS
'hasLinkNameMismatch — Artikel- und Rezeptname laufen auseinander; FoodNotifys eigenes Kennzeichen fuer
eine moeglicherweise falsche Zuordnung (2052: 6 von 895).';
COMMENT ON COLUMN core.pos_artikel.fehlt_seit IS
'Seit wann der Artikel in einer ERFOLGREICHEN Antwort nicht mehr steht. Nicht geloescht: seine
Rezeptzuordnung war richtig und erklaert aeltere Verkaeufe. Steht er wieder in der Antwort, wird
fehlt_seit geleert. Ein abgebrochener Abruf setzt es nie.';
COMMENT ON COLUMN core.pos_artikel.zuletzt_gesehen_am IS
'Zeitpunkt der letzten erfolgreichen Antwort, die den Artikel nannte (= raw.api_antwort.abgerufen_am).
Daran misst sync.quelle (core:pos_artikel) den Zulauf.';
COMMENT ON COLUMN core.pos_artikel.geaendert_am IS
'Letzte fachliche Aenderung (PLU, Name, Rezept, Preis, MwSt, ignoriert, abwesend, Namensabweichung,
fehlt/wieder da). Wann ein Rezept zugeordnet wurde, steht hier nur fuer die LETZTE Aenderung; den
Verlauf liefert raw.';
COMMENT ON COLUMN core.pos_artikel.raw_id IS 'raw.api_antwort.id der Antwort, aus der die Zeile zuletzt geladen wurde.';
COMMENT ON COLUMN core.pos_artikel.preis IS 'price — Verkaufspreis laut Kasse (Zeichenkette "4.4" in der Antwort).';
COMMENT ON COLUMN core.pos_artikel.mwst IS 'vat — Mehrwertsteuersatz in Prozent (0, 7, 19).';


-- ---------------------------------------------------------------------
-- 2. core.pos_artikel_abruf — der letzte erfolgreiche Abruf je Anbindung
--
-- Ohne diese Zeile waere "seit wann kam nichts mehr" nur ueber
-- max(zuletzt_gesehen_am) zu lesen — und eine Anbindung, die erfolgreich
-- null Artikel liefert, saehe aus wie eine, die nie gefragt wurde.
-- ---------------------------------------------------------------------

CREATE TABLE core.pos_artikel_abruf (
    kostenstelle_key     integer PRIMARY KEY REFERENCES core.kostenstelle(kostenstelle_key),
    connection_id        integer     NOT NULL,
    abgerufen_am         timestamptz NOT NULL,
    artikel              integer     NOT NULL,
    standort             text,
    restaurant_id        integer,
    kann_rezepte_anlegen boolean,
    ingest_hinweise      integer     NOT NULL DEFAULT 0,
    raw_id               bigint
);
COMMENT ON TABLE core.pos_artikel_abruf IS
'Der letzte ERFOLGREICHE Abruf von fn:pos_artikel je Kassenanbindung (0155): wann, wie viele Artikel,
Standortname und restaurantId laut Antwort, Anzahl ingestIssues. Ein abgebrochener Abruf aendert die
Zeile nicht — veraltet abgerufen_am, zeigt mart.pos_artikel_abdeckung den Zustand "veraltet".';
COMMENT ON COLUMN core.pos_artikel_abruf.ingest_hinweise IS
'Laenge von ingestIssues[] — FoodNotifys Warnungen beim Einlesen der Kasse (gemessen: negativer Preis bei
Rabatt- und Pfandartikeln, "imported_with_warning"). Der Inhalt steht in raw.';


-- ---------------------------------------------------------------------
-- 3. mart.pos_artikel_rezept — Kassenartikel <-> Rezept, Zeilenebene
-- ---------------------------------------------------------------------

CREATE VIEW mart.pos_artikel_rezept AS
SELECT m.schluessel                                          AS marke,
       ks.betrieb_key,
       b.name                                                AS betrieb,
       ks.kostenstelle_id,
       ks.name                                               AS kostenstelle,
       ks.art                                                AS kostenstelle_art,
       ks.connection_id,
       ks.kassensystem,
       (ks.kassensystem = 'amadeus')                         AS plu_bruecke,
       pa.remote_id,
       pa.plu,
       a.artikel_key,
       a.artikelnummer,
       a.name                                                AS lina_artikel,
       pa.name                                               AS kassenartikel,
       pa.preis,
       pa.mwst,
       (pa.rezept_fn_id IS NOT NULL AND NOT pa.ist_ignoriert) AS hat_rezept,
       pa.rezept_fn_id,
       pa.rezept_titel,
       r.name                                                AS rezept,
       r.archiviert                                          AS rezept_archiviert,
       r.fehlt_seit                                          AS rezept_fehlt_seit,
       r.zutaten_geholt_am                                   AS rezept_zutaten_geholt_am,
       pa.ist_ignoriert,
       pa.abwesend_seit,
       pa.name_weicht_ab,
       pa.name_doppelt,
       pa.wird_synchronisiert,
       pa.fehlt_seit,
       pa.erstmals_am,
       pa.geaendert_am,
       pa.zuletzt_gesehen_am
  FROM core.pos_artikel pa
  JOIN core.kostenstelle ks ON ks.kostenstelle_key = pa.kostenstelle_key
  JOIN core.marke m         ON m.marke_key = ks.marke_key
  LEFT JOIN core.betrieb b  ON b.betrieb_key = ks.betrieb_key
  -- Die PLU-Bruecke NUR bei amadeus: bei anderen Kassen ist die PLU ein
  -- fremder Nummernkreis und traefe still falsche Artikel.
  LEFT JOIN core.artikel a  ON ks.kassensystem = 'amadeus' AND a.artikelnummer = pa.plu_zahl
  LEFT JOIN core.rezept r   ON r.marke_key = ks.marke_key AND r.fn_id = pa.rezept_fn_id;

COMMENT ON VIEW mart.pos_artikel_rezept IS
'Welches Rezept steckt hinter Kassenartikel X? Eine Zeile je Kassenanbindung (Kostenstelle) und
Kassenartikel, mit FoodNotifys Rezeptzuordnung (0155). Ein Betrieb hat oft ZWEI Anbindungen (Bar und
Kueche). Ihre Artikellisten ueberschneiden sich, sind aber nicht gleich (gemessen 19.11.2026: die Bar
Ballplatz fuehrt Speisenrezepte, die Kueche Duesseldorf keinen Kaffee) — derselbe Artikel kann zweimal
stehen, mit gleichem, anderem oder keinem Rezept. Nach betrieb_key und artikel_key fragen, nicht ueber Anbindungen summieren.
artikelnummer und artikel_key (LINA, Kassenartikel) nur bei kassensystem amadeus, sonst NULL — nicht die
Lieferanten-Artikelnummer aus den Rezeptzutaten. hat_rezept: Rezept zugeordnet und nicht ignoriert.
fehlt_seit gesetzt: in der letzten Antwort nicht mehr enthalten (fuer den aktuellen Stand auf fehlt_seit
IS NULL filtern). Vorerst nur Wilma Wunder; Stand je Anbindung: mart.pos_artikel_abdeckung.';
COMMENT ON COLUMN mart.pos_artikel_rezept.artikelnummer IS
'LINA-Artikelnummer (Kasse) = plu, nur bei kassensystem amadeus. NICHT die Lieferanten-Artikelnummer der
Rezeptzutaten (mart.rezept_position.artikelnummer).';
COMMENT ON COLUMN mart.pos_artikel_rezept.rezept IS
'Name des Rezepts aus core.rezept — NULL, solange das Rezept dort noch nicht geladen ist (dann steht
rezept_titel trotzdem da). Rezeptnamen sind nicht eindeutig: nach rezept_fn_id gruppieren.';
COMMENT ON COLUMN mart.pos_artikel_rezept.hat_rezept IS
'Rezept zugeordnet (rezept_fn_id) und der Artikel nicht ignoriert.';


-- ---------------------------------------------------------------------
-- 4. mart.pos_artikel_abdeckung — je Anbindung
--
-- UMSATZABDECKUNG. Grundlage ist mart.artikel_monat_basis (materialisiert,
-- Artikel x Betrieb x Monat, Index auf monat und betrieb_key), nicht die
-- Tagestabelle: drei Monate ueber 30 Anbindungen sind dort einige tausend
-- Zeilen statt Millionen Tageszeilen. Die drei letzten VOLLEN Monate — ein
-- laufender Monat mischte Wochentage ungleich. "Mit Rezept" ueber EXISTS,
-- damit eine doppelte PLU den Umsatz nicht doppelt zaehlt.
-- ---------------------------------------------------------------------

CREATE VIEW mart.pos_artikel_abdeckung AS
WITH zeitraum AS (
    SELECT (date_trunc('month', current_date) - interval '3 months')::date AS von,
           (date_trunc('month', current_date) - interval '1 day')::date    AS bis
),
aktiv AS (
    -- Der wirksame Schalter POS_ARTIKEL_MARKEN, vom Einreihweg je Lauf gemeldet.
    SELECT wert->'marken' AS marken FROM sync.merker WHERE schluessel = 'pos_artikel_marken'
),
anbindung AS (
    SELECT ks.kostenstelle_key, ks.marke_key, m.schluessel AS marke, ks.betrieb_key, b.name AS betrieb,
           ks.kostenstelle_id, ks.name AS kostenstelle, ks.art AS kostenstelle_art,
           ks.connection_id, ks.kassensystem,
           coalesce((SELECT a.marken ? m.schluessel FROM aktiv a), false) AS marke_aktiv
      FROM core.kostenstelle ks
      JOIN core.marke m        ON m.marke_key = ks.marke_key
      LEFT JOIN core.betrieb b ON b.betrieb_key = ks.betrieb_key
     WHERE ks.connection_id IS NOT NULL
),
artikel AS (
    SELECT pa.kostenstelle_key,
           count(*) FILTER (WHERE pa.fehlt_seit IS NULL)                                          AS artikel_gesamt,
           count(*) FILTER (WHERE pa.fehlt_seit IS NULL AND pa.rezept_fn_id IS NOT NULL
                              AND NOT pa.ist_ignoriert)                                          AS artikel_mit_rezept,
           count(*) FILTER (WHERE pa.fehlt_seit IS NULL AND pa.ist_ignoriert)                     AS artikel_ignoriert,
           count(*) FILTER (WHERE pa.fehlt_seit IS NULL AND pa.abwesend_seit IS NOT NULL)         AS artikel_abwesend,
           count(*) FILTER (WHERE pa.fehlt_seit IS NULL AND pa.name_weicht_ab)                    AS name_weicht_ab,
           count(*) FILTER (WHERE pa.fehlt_seit IS NOT NULL)                                      AS nicht_mehr_geliefert,
           count(*) FILTER (WHERE pa.fehlt_seit IS NULL)
             - count(DISTINCT pa.plu) FILTER (WHERE pa.fehlt_seit IS NULL AND pa.plu IS NOT NULL)
             - count(*) FILTER (WHERE pa.fehlt_seit IS NULL AND pa.plu IS NULL)                   AS plu_doppelt,
           max(pa.geaendert_am)                                                                  AS zuletzt_geaendert_am
      FROM core.pos_artikel pa
     GROUP BY pa.kostenstelle_key
),
umsatz AS (
    -- Artikelumsatz je Betrieb und LINA-Artikelnummer, nur Betriebe mit amadeus-Anbindung.
    SELECT am.betrieb_key, la.artikelnummer, sum(am.umsatz_netto) AS umsatz_netto
      FROM mart.artikel_monat_basis am
      JOIN core.artikel la ON la.artikel_key = am.artikel_key
     CROSS JOIN zeitraum z
     WHERE am.monat BETWEEN z.von AND z.bis
       AND am.betrieb_key IN (SELECT k.betrieb_key FROM core.kostenstelle k
                               WHERE k.kassensystem = 'amadeus' AND k.connection_id IS NOT NULL)
     GROUP BY am.betrieb_key, la.artikelnummer
),
anbindung_umsatz AS (
    SELECT an.kostenstelle_key,
           sum(u.umsatz_netto)                              AS umsatz_betrieb_3m,
           sum(u.umsatz_netto) FILTER (WHERE p.im_feed)     AS umsatz_im_feed_3m,
           sum(u.umsatz_netto) FILTER (WHERE p.hat_rezept)  AS umsatz_mit_rezept_3m
      FROM anbindung an
      JOIN umsatz u ON u.betrieb_key = an.betrieb_key
      LEFT JOIN LATERAL (
            SELECT true AS im_feed,
                   bool_or(pa.rezept_fn_id IS NOT NULL AND NOT pa.ist_ignoriert) AS hat_rezept
              FROM core.pos_artikel pa
             WHERE pa.kostenstelle_key = an.kostenstelle_key
               AND pa.plu_zahl = u.artikelnummer
               -- auch nicht mehr gelieferte Artikel: im Zeitraum verkauft, Zuordnung galt damals
            HAVING count(*) > 0) p ON true
     WHERE an.kassensystem = 'amadeus'
     GROUP BY an.kostenstelle_key
)
SELECT an.marke,
       an.betrieb_key,
       an.betrieb,
       an.kostenstelle_id,
       an.kostenstelle,
       an.kostenstelle_art,
       an.connection_id,
       an.kassensystem,
       (an.kassensystem = 'amadeus')                                    AS plu_bruecke,
       an.marke_aktiv,
       CASE
         WHEN NOT an.marke_aktiv                                    THEN 'marke nicht aktiv'
         WHEN ab.kostenstelle_key IS NULL                           THEN 'nie geladen'
         WHEN ab.abgerufen_am < now() - interval '36 hours'         THEN 'veraltet'
         WHEN coalesce(ar.artikel_gesamt, 0) = 0                    THEN 'leer'
         WHEN an.kassensystem IS DISTINCT FROM 'amadeus'            THEN 'ohne plu-bruecke'
         WHEN an.betrieb_key IS NULL                                THEN 'ohne betrieb'
         ELSE 'ok'
       END                                                              AS zustand,
       ab.abgerufen_am                                                  AS letzter_abruf_am,
       ab.standort,
       ab.ingest_hinweise,
       coalesce(ar.artikel_gesamt, 0)::int                              AS artikel_gesamt,
       coalesce(ar.artikel_mit_rezept, 0)::int                          AS artikel_mit_rezept,
       round(100.0 * ar.artikel_mit_rezept / nullif(ar.artikel_gesamt, 0), 1) AS rezept_anteil_pct,
       coalesce(ar.artikel_ignoriert, 0)::int                           AS artikel_ignoriert,
       coalesce(ar.artikel_abwesend, 0)::int                            AS artikel_abwesend,
       coalesce(ar.name_weicht_ab, 0)::int                              AS name_weicht_ab,
       coalesce(ar.nicht_mehr_geliefert, 0)::int                        AS nicht_mehr_geliefert,
       coalesce(ar.plu_doppelt, 0)::int                                 AS plu_doppelt,
       ar.zuletzt_geaendert_am,
       (SELECT von FROM zeitraum)                                       AS umsatz_von,
       (SELECT bis FROM zeitraum)                                       AS umsatz_bis,
       au.umsatz_betrieb_3m,
       au.umsatz_im_feed_3m,
       au.umsatz_mit_rezept_3m,
       round(100.0 * au.umsatz_im_feed_3m / nullif(au.umsatz_betrieb_3m, 0), 1)    AS umsatz_im_feed_pct,
       round(100.0 * au.umsatz_mit_rezept_3m / nullif(au.umsatz_betrieb_3m, 0), 1) AS umsatz_rezept_pct
  FROM anbindung an
  LEFT JOIN core.pos_artikel_abruf ab ON ab.kostenstelle_key = an.kostenstelle_key
  LEFT JOIN artikel ar               ON ar.kostenstelle_key = an.kostenstelle_key
  LEFT JOIN anbindung_umsatz au      ON au.kostenstelle_key = an.kostenstelle_key;

COMMENT ON VIEW mart.pos_artikel_abdeckung IS
'Je Kassenanbindung (Kostenstelle mit Kasse): wie viele Kassenartikel FoodNotify fuehrt, wie viele davon
ein Rezept tragen, und welcher Anteil des Artikelumsatz der letzten drei vollen Monate darauf entfaellt
(0155). Dazu der Zustand des Abrufs (Regel 10): ok / marke nicht aktiv (POS_ARTIKEL_MARKEN, vorerst nur
Wilma Wunder) / nie geladen / veraltet (letzter erfolgreicher Abruf aelter als 36 h) / leer / ohne
plu-bruecke (kein amadeus: Artikel gezaehlt, Umsatz NULL) / ohne betrieb (Kostenstelle keinem Betrieb
zugeordnet). Zaehlungen nur ueber Artikel der letzten Antwort (fehlt_seit IS NULL), Umsatz ueber alle je
gesehenen Artikel (ein im Zeitraum verkaufter, inzwischen gestrichener Artikel trug damals sein Rezept);
rezept_anteil_pct ist
mit_rezept / gesamt, Prozentzahl. UMSATZ: umsatz_betrieb_3m ist der ganze Artikelumsatz des BETRIEBS — bei
zwei Anbindungen (Bar, Kueche) steht er in beiden Zeilen; NICHT ueber Anbindungen summieren. Die Zahl je
Betrieb (Rezept in irgendeiner Anbindung) steht in mart.pos_artikel_abdeckung_betrieb. umsatz_im_feed_pct
ist die Gegenprobe der PLU-Bruecke (Aposto Gera 01.08.2026: 95,6 % der Artikel trafen).';
COMMENT ON COLUMN mart.pos_artikel_abdeckung.rezept_anteil_pct IS
'Artikel mit Rezept (nicht ignoriert) / Artikel der letzten Antwort, Prozentzahl (49.4, nicht 0.494). Ueber
Anbindungen nicht mitteln, sondern aus artikel_mit_rezept und artikel_gesamt neu rechnen.';
COMMENT ON COLUMN mart.pos_artikel_abdeckung.umsatz_betrieb_3m IS
'Artikelumsatz netto des Betriebs in umsatz_von bis umsatz_bis (mart.artikel_monat). Betriebswert: bei
zwei Anbindungen eines Betriebs in beiden Zeilen gleich — nicht summieren.';
COMMENT ON COLUMN mart.pos_artikel_abdeckung.umsatz_rezept_pct IS
'Anteil des Artikelumsatzes des Betriebs, dessen Kassenartikel in DIESER Anbindung ein Rezept traegt,
Prozentzahl. Fuer den Betrieb insgesamt mart.pos_artikel_abdeckung_betrieb.';
COMMENT ON COLUMN mart.pos_artikel_abdeckung.umsatz_im_feed_pct IS
'Anteil des Artikelumsatzes, dessen LINA-Artikelnummer als PLU in dieser Anbindung vorkommt — die
Gegenprobe, dass die PLU-Bruecke traegt. Unter 100 % liegt sie auch bei intakter Bruecke: Artikel, die
nur die andere Anbindung des Betriebs fuehrt (Kaffee an der Bar), und Artikel, die FoodNotify vor unserem
ersten Abruf gestrichen hat (Saisonkarte). Faellt sie weit unter die Werte der anderen Anbindungen, den
Nummernkreis pruefen, bevor man umsatz_rezept_pct glaubt.';
COMMENT ON COLUMN mart.pos_artikel_abdeckung.plu_doppelt IS
'Artikel der letzten Antwort, deren PLU in derselben Anbindung schon einmal vorkommt. Gemessen 0
(19.11.2026). Die Umsatzzahlen zaehlen trotzdem richtig (EXISTS), mart.pos_artikel_rezept zeigt beide Zeilen.';


-- ---------------------------------------------------------------------
-- 5. mart.pos_artikel_abdeckung_betrieb — die Umsatzabdeckung je Betrieb
--
-- Ein Artikel gilt als "mit Rezept", wenn er in IRGENDEINER amadeus-Anbindung
-- des Betriebs eins traegt — gemessen 19.11.2026 fuehrt die Bar-Anbindung
-- in Mainz Ballplatz auch Speisenrezepte, die Zuordnung ist also nicht
-- sauber nach Bar und Kueche getrennt.
-- ---------------------------------------------------------------------

CREATE VIEW mart.pos_artikel_abdeckung_betrieb AS
WITH zeitraum AS (
    SELECT (date_trunc('month', current_date) - interval '3 months')::date AS von,
           (date_trunc('month', current_date) - interval '1 day')::date    AS bis
),
aktiv AS (
    SELECT wert->'marken' AS marken FROM sync.merker WHERE schluessel = 'pos_artikel_marken'
),
betrieb AS (
    SELECT ks.betrieb_key,
           min(m.schluessel)                       AS marke,
           coalesce(bool_or((SELECT a.marken ? m.schluessel FROM aktiv a)), false) AS marke_aktiv,
           count(*)::int                           AS anbindungen,
           min(ab.abgerufen_am)                    AS aeltester_abruf_am,
           count(ab.kostenstelle_key)::int         AS anbindungen_geladen
      FROM core.kostenstelle ks
      JOIN core.marke m ON m.marke_key = ks.marke_key
      LEFT JOIN core.pos_artikel_abruf ab ON ab.kostenstelle_key = ks.kostenstelle_key
     WHERE ks.connection_id IS NOT NULL AND ks.kassensystem = 'amadeus' AND ks.betrieb_key IS NOT NULL
     GROUP BY ks.betrieb_key
),
umsatz AS (
    SELECT am.betrieb_key, la.artikelnummer, sum(am.umsatz_netto) AS umsatz_netto
      FROM mart.artikel_monat_basis am
      JOIN core.artikel la ON la.artikel_key = am.artikel_key
     CROSS JOIN zeitraum z
     WHERE am.monat BETWEEN z.von AND z.bis
       AND am.betrieb_key IN (SELECT betrieb_key FROM betrieb)
     GROUP BY am.betrieb_key, la.artikelnummer
),
bewertet AS (
    SELECT u.betrieb_key, u.umsatz_netto, p.im_feed, p.hat_rezept
      FROM umsatz u
      LEFT JOIN LATERAL (
            SELECT true AS im_feed,
                   bool_or(pa.rezept_fn_id IS NOT NULL AND NOT pa.ist_ignoriert) AS hat_rezept
              FROM core.kostenstelle ks
              JOIN core.pos_artikel pa ON pa.kostenstelle_key = ks.kostenstelle_key
             WHERE ks.betrieb_key = u.betrieb_key
               AND ks.kassensystem = 'amadeus'
               AND pa.plu_zahl = u.artikelnummer
               -- auch nicht mehr gelieferte Artikel: im Zeitraum verkauft, Zuordnung galt damals
            HAVING count(*) > 0) p ON true
)
SELECT b.marke,
       b.betrieb_key,
       cb.name                                                          AS betrieb,
       b.marke_aktiv,
       b.anbindungen,
       b.anbindungen_geladen,
       b.aeltester_abruf_am,
       (SELECT von FROM zeitraum)                                       AS umsatz_von,
       (SELECT bis FROM zeitraum)                                       AS umsatz_bis,
       count(bw.betrieb_key)::int                                       AS artikel_verkauft,
       (count(*) FILTER (WHERE bw.hat_rezept))::int                     AS artikel_verkauft_mit_rezept,
       sum(bw.umsatz_netto)                                             AS umsatz_netto_3m,
       sum(bw.umsatz_netto) FILTER (WHERE bw.im_feed)                   AS umsatz_im_feed_3m,
       sum(bw.umsatz_netto) FILTER (WHERE bw.hat_rezept)                AS umsatz_mit_rezept_3m,
       round(100.0 * sum(bw.umsatz_netto) FILTER (WHERE bw.im_feed)
             / nullif(sum(bw.umsatz_netto), 0), 1)                      AS umsatz_im_feed_pct,
       round(100.0 * sum(bw.umsatz_netto) FILTER (WHERE bw.hat_rezept)
             / nullif(sum(bw.umsatz_netto), 0), 1)                      AS umsatz_rezept_pct
  FROM betrieb b
  JOIN core.betrieb cb    ON cb.betrieb_key = b.betrieb_key
  LEFT JOIN bewertet bw   ON bw.betrieb_key = b.betrieb_key
 GROUP BY b.marke, b.betrieb_key, cb.name, b.marke_aktiv, b.anbindungen, b.anbindungen_geladen,
          b.aeltester_abruf_am;

COMMENT ON VIEW mart.pos_artikel_abdeckung_betrieb IS
'Je Betrieb mit amadeus-Kassenanbindung: welcher Anteil des Artikelumsatzes der letzten drei vollen Monate
auf Kassenartikel entfaellt, die in IRGENDEINER Anbindung des Betriebs ein Rezept tragen (0155). Das ist die
Zahl, die sagt, wie weit ein Wareneinsatz aus Rezepten reichen koennte — nicht der Wareneinsatz selbst.
Prozentzahlen; ueber Betriebe nicht mitteln, sondern aus den Euro-Summen neu rechnen. umsatz_im_feed_pct ist
die Gegenprobe der PLU-Bruecke. Nur Betriebe, deren Kostenstelle einem LINA-Betrieb zugeordnet ist; ob die
Abrufe frisch sind, sagen aeltester_abruf_am, anbindungen_geladen und mart.pos_artikel_abdeckung (zustand).
marke_aktiv = false: fuer diese Marke werden Kassenartikel bewusst nicht geholt (POS_ARTIKEL_MARKEN, vorerst
nur Wilma Wunder) — die Umsatzspalten mit Rezept sind dann leer, nicht null Prozent.';
COMMENT ON COLUMN mart.pos_artikel_abdeckung_betrieb.umsatz_rezept_pct IS
'Artikelumsatz mit Rezept (in irgendeiner Anbindung des Betriebs, nicht ignoriert) / Artikelumsatz des
Betriebs, Prozentzahl. Aposto Gera 01.08.2026 zum Vergleich: 49,8 %.';
COMMENT ON COLUMN mart.pos_artikel_abdeckung_betrieb.artikel_verkauft IS
'Verschiedene LINA-Artikel mit einer Verkaufszeile im Zeitraum.';


-- ---------------------------------------------------------------------
-- 6. mart.pruefung_uebersicht — eine Zeile am Ende
--
-- Wie 0132/0153: die Definition aus der Zieldatenbank gelesen und ergaenzt.
-- Erwartung 0. Gezaehlt werden Anbindungen aktiver Marken, deren letzter
-- erfolgreicher Abruf fehlt, aelter als 36 h ist oder null Artikel brachte.
-- Abgeschaltete Marken zaehlen nicht mit (sonst stuende die Zeile dauerhaft
-- auf den drei anderen Marken und niemand laese sie mehr).
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%pos_artikel_abdeckung%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        SELECT 'FoodNotify-Kassenartikel: Anbindung einer aktiven Marke ohne frischen Abruf (36 h) oder leer'::text AS pruefung,
               count(*) FILTER (WHERE pa.marke_aktiv)::bigint                                AS geprueft,
               count(*) FILTER (WHERE pa.zustand IN ('nie geladen', 'veraltet', 'leer'))::bigint AS auffaellig,
               'mart.pos_artikel_abdeckung'::text AS sicht
          FROM mart.pos_artikel_abdeckung pa
        $zweig$);

    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def NOT LIKE '%FoodNotify-Kassenartikel: Anbindung einer aktiven Marke%' THEN
        RAISE EXCEPTION '0155: mart.pruefung_uebersicht traegt nach dem Umbau nicht die erwartete Zeile';
    END IF;
END $aussen$;


-- ---------------------------------------------------------------------
-- 7. sync.quelle — die Zulauferwartung (Regel 10)
--
-- Das Register steht in src/sync/quellen.ts und wird bei jedem Lauf
-- gespiegelt; die beiden Zeilen stehen hier zusaetzlich, damit
-- mart.quelle_zulauf schon vor dem ersten Lauf nach dem Deploy die Erwartung
-- kennt. erwartet = true entspricht POS_ARTIKEL_MARKEN = wilma_wunder
-- (Vorgabe); ist der Schalter leer, ueberschreibt der erste Lauf auf false.
-- ---------------------------------------------------------------------

INSERT INTO sync.quelle (quelle, bezeichnung, system, endpunkt, kadenz_stunden, erwartet, bemerkung)
VALUES ('fn:pos_artikel', 'Kassenartikel mit Rezeptzuordnung je Kassenanbindung', 'foodnotify',
        'fn:pos_artikel', 36, true,
        'Marken: wilma_wunder (POS_ARTIKEL_MARKEN). Je Anbindung: mart.pos_artikel_abdeckung.')
ON CONFLICT (quelle) DO UPDATE
   SET bezeichnung = excluded.bezeichnung, system = excluded.system, endpunkt = excluded.endpunkt,
       kadenz_stunden = excluded.kadenz_stunden, erwartet = excluded.erwartet, bemerkung = excluded.bemerkung;

INSERT INTO sync.quelle (quelle, bezeichnung, system, schema_name, tabelle, zeitspalte, kadenz_stunden,
                         erwartet, bemerkung)
VALUES ('core:pos_artikel', 'Bruecke LINA-Artikel → FoodNotify-Rezept', 'foodnotify',
        'core', 'pos_artikel', 'zuletzt_gesehen_am', 36, true,
        'Seit 0155 befuellt (fn:pos_artikel), gemessen an zuletzt_gesehen_am. Je Anbindung: mart.pos_artikel_abdeckung.')
ON CONFLICT (quelle) DO UPDATE
   SET bezeichnung = excluded.bezeichnung, system = excluded.system, schema_name = excluded.schema_name,
       tabelle = excluded.tabelle, zeitspalte = excluded.zeitspalte, kadenz_stunden = excluded.kadenz_stunden,
       erwartet = excluded.erwartet, bemerkung = excluded.bemerkung;


-- ---------------------------------------------------------------------
-- 8. MCP-Katalog: Koernung, Thema, Summierbarkeit, Kennzahlen, Fallstricke
--
-- Nur Regelarten, die mcp/src/pruefen.ts kennt (deutung) — eine unbekannte
-- liesse den Server nicht starten (AGENTS.md, mcp-Regel 1).
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.pos_artikel_rezept',
     'Kassenanbindung (Kostenstelle) × Kassenartikel (remote_id) — ein Betrieb hat oft zwei Anbindungen, derselbe Artikel steht dann zweimal; fuer den aktuellen Stand fehlt_seit IS NULL',
     'rezept', false),
    ('mart.pos_artikel_abdeckung',
     'eine Kassenanbindung (Kostenstelle mit Kasse) — Umsatzspalten sind Betriebswerte und stehen bei zwei Anbindungen doppelt',
     'pruefung', false),
    ('mart.pos_artikel_abdeckung_betrieb',
     'ein Betrieb mit amadeus-Kassenanbindung — Umsatzabdeckung der letzten drei vollen Monate',
     'rezept', true)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

INSERT INTO mcp.kennzahl (sicht, spalte, regel, einheit, hinweis) VALUES
  ('mart.pos_artikel_abdeckung', 'rezept_anteil_pct', 'nicht_aggregieren', 'prozentzahl',
   'Anteil je Anbindung. Ueber Anbindungen aus artikel_mit_rezept und artikel_gesamt neu rechnen.'),
  ('mart.pos_artikel_abdeckung', 'umsatz_rezept_pct', 'nicht_aggregieren', 'prozentzahl',
   'Anteil je Anbindung. Fuer den Betrieb mart.pos_artikel_abdeckung_betrieb.'),
  ('mart.pos_artikel_abdeckung', 'umsatz_im_feed_pct', 'nicht_aggregieren', 'prozentzahl', NULL),
  ('mart.pos_artikel_abdeckung', 'umsatz_betrieb_3m', 'nicht_aggregieren', 'euro',
   'Betriebswert, steht bei zwei Anbindungen eines Betriebs in beiden Zeilen.'),
  ('mart.pos_artikel_abdeckung_betrieb', 'umsatz_rezept_pct', 'nicht_aggregieren', 'prozentzahl',
   'Anteil je Betrieb. Ueber Betriebe aus umsatz_mit_rezept_3m und umsatz_netto_3m neu rechnen.'),
  ('mart.pos_artikel_abdeckung_betrieb', 'umsatz_im_feed_pct', 'nicht_aggregieren', 'prozentzahl', NULL)
ON CONFLICT (sicht, spalte) DO UPDATE
   SET regel = excluded.regel, einheit = excluded.einheit, hinweis = excluded.hinweis;

INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle) VALUES
  ('pos_artikel_zwei_anbindungen', 'deutung', 'warnung', 'mart.pos_artikel_rezept', '{}',
   'Ein Betrieb hat oft zwei Kassenanbindungen (Bar und Kueche) mit sich ueberschneidenden Artikellisten. '
   'Derselbe Kassenartikel kann zweimal stehen, mit gleichem, anderem oder keinem Rezept. Artikel mit fehlt_seit stehen '
   'nicht mehr in FoodNotifys letzter Antwort. Vorerst nur Wilma Wunder.',
   'Fuer "welches Rezept steckt hinter Artikel X" nach betrieb_key und artikel_key filtern und alle Zeilen '
   'zeigen; fuer Zaehlungen fehlt_seit IS NULL setzen und je Anbindung oder count(DISTINCT artikel_key) zaehlen.',
   '0155'),
  ('pos_artikel_umsatz_betriebswert', 'deutung', 'warnung', 'mart.pos_artikel_abdeckung', '{}',
   'umsatz_betrieb_3m ist der Artikelumsatz des ganzen Betriebs und steht bei zwei Anbindungen in beiden '
   'Zeilen. umsatz_rezept_pct gilt fuer das Rezept in DIESER Anbindung.',
   'Fuer den Betrieb mart.pos_artikel_abdeckung_betrieb nehmen; Umsatzspalten nicht ueber Anbindungen summieren.',
   '0155'),
  ('pos_artikel_kein_wareneinsatz', 'deutung', 'warnung', 'mart.pos_artikel_abdeckung_betrieb', '{}',
   'Die Abdeckung sagt, welcher Umsatzanteil ein Rezept TRAEGT — nicht, was die Ware gekostet hat, und nicht, '
   'ob das Rezept stimmt. Ein Wareneinsatz aus Rezepten ist nicht gebaut.',
   'Als Reichweite einer kuenftigen Rezeptkalkulation nennen, nicht als Wareneinsatzquote.',
   '0155')
ON CONFLICT (schluessel) DO UPDATE
   SET art = excluded.art, schwere = excluded.schwere, sicht = excluded.sicht,
       parameter = excluded.parameter, hinweis = excluded.hinweis,
       berichtigung = excluded.berichtigung, quelle = excluded.quelle;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();


-- ---------------------------------------------------------------------
-- 9. Rechte und die Gegenprobe als Leserolle (Pflicht seit 0110)
--
-- Seit 0153 vergibt mcp.rechte_auffrischen() im Schema mcp nur den Katalog
-- (docs/fehlerkatalog.md, 12.11.2026) — kein eigener GRANT-Block hier, kein
-- kopierter Rechteblock aus einer aelteren Migration. Danach muss
-- mart.mcp_rechte_pruefung leer sein, und als mcp_leser muessen die neuen
-- Sichten lesbar und mcp.zugriff unlesbar sein.
-- ---------------------------------------------------------------------

SELECT mcp.rechte_auffrischen();

DO $probe$
DECLARE
    v_abfrage text;
    v_liegen  text[] := '{}';
    v_rechte  int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0155 ist uebersprungen';
        RETURN;
    END IF;

    SELECT count(*) INTO v_rechte FROM mart.mcp_rechte_pruefung;
    IF v_rechte > 0 THEN
        RAISE EXCEPTION '0155: mart.mcp_rechte_pruefung ist nicht leer (% Zeilen)', v_rechte;
    END IF;

    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0155 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_abfrage IN ARRAY ARRAY[
        'SELECT * FROM mart.pos_artikel_rezept LIMIT 1',
        'SELECT * FROM mart.pos_artikel_abdeckung LIMIT 1',
        'SELECT * FROM mart.pos_artikel_abdeckung_betrieb LIMIT 1',
        'SELECT * FROM mart.pruefung_uebersicht WHERE sicht = ''mart.pos_artikel_abdeckung''']
    LOOP
        BEGIN
            EXECUTE v_abfrage;
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_abfrage, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    BEGIN
        EXECUTE 'SELECT * FROM mcp.zugriff LIMIT 1';
        v_liegen := v_liegen || 'mcp.zugriff ist fuer mcp_leser lesbar'::text;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0155 hat sein Ziel nicht erreicht — fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
