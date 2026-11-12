-- =====================================================================
-- 0153 TPAPI Stufe 2, Schritt 2b — die roh gesicherten Antworten nach core
--      und mart
--
-- ANLASS (12.11.2026). Schritt 2a (0151) holt Journal, Bons, Personalkosten
-- je Tag und den Artikelstamm und sichert sie ROH. Die Formprobe vom
-- 12.11.2026 (docs/payloads/tpapi-formprobe-2026-11-12.txt) hat die Werte
-- gemessen — Typen, Zeitformat, Leerwerte. Damit lassen sich die Lader bauen.
-- Plan und Entscheidungen: docs/plan-tpapi-stufe2.md (S1-S11, §5, §8).
--
-- WAS DIESE MIGRATION ANLEGT
--   1. sync.tpapi_core_lader          — Laderstand und Horizont je Endpunkt,
--                                        vom Importer bei jedem Lauf geschrieben
--   2. Spalten an core.tpapi_abruf und core.tpapi_stammabzug (Ladefehler,
--      Versuche, Messung, von/bis fuer die Prognose)
--   3. core.kassenjournal (partitioniert), core.kassenjournal_finanzweg_tag,
--      core.kassenbon (partitioniert), core.personalkosten_tag,
--      core.umsatzprognose_tag, core.tpapi_artikel, core.tpapi_finanzweg,
--      core.tpapi_finanzkategorie, core.tpapi_stammliste
--   4. die Deutung "was ist Umsatz im Journal" an EINER Stelle:
--      mart.kassenjournal_zeilenart() — eine HYPOTHESE aus zwei Stichproben
--   5. mart-Sichten: Positionen, Bons, Personalkosten je Tag, Prognose,
--      Kassenartikel, fixedwe gegen fixer_we, sechs Abgleichsichten (S10),
--      Fehleingaben, Stammpruefung, Laderstand
--   6. mart.personal_rueckstand auf die Tiefe von listdays (Plan S3)
--   7. mart.tpapi_abruf_stand.in_core zaehlt nur den aktuellen Laderstand
--   8. drei Zeilen in mart.pruefung_uebersicht
--   9. mcp.rechte_auffrischen() ohne das Zugriffsprotokoll (0148 wurde von
--      0149-0151 still zurueckgedreht), MCP-Katalog, Fallstricke, Leseprobe
--
-- Der Lader (src/tpapi/core_laden.ts), die Prognose im Register und im
-- Rohabzug, Personal je Stunde im Nachladen und die Registereintraege
-- (src/sync/quellen.ts) stehen im selben Commit.
--
-- WAS NICHT HIER IST: keine Metabase-Karte (erst, wenn der Abgleich mit
-- echten Daten gemessen ist) und keine Materialisierung (keine Messung
-- verlangte eine, siehe Plan §8).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Laderstand und Horizont
--
-- Der Importer schreibt hier bei jedem Lauf, mit welcher Laderversion er
-- jeden Endpunkt nach core bringt und wie weit Journal und Bons zurueck
-- reichen (TPAPI_CORE_MONATE). Die Sichten lesen es, damit "wartend",
-- "in core" und "ausserhalb des Horizonts" dieselbe Zahl meinen wie der
-- Lader — eine Sicht kennt keine Umgebungsvariable. Die Startbelegung steht
-- unten; der erste Lauf ueberschreibt sie.
-- ---------------------------------------------------------------------

CREATE TABLE sync.tpapi_core_lader (
    endpunkt         text         PRIMARY KEY CHECK (endpunkt LIKE 'tpapi:%'),
    stand            integer      NOT NULL CHECK (stand > 0),
    horizont_monate  integer      CHECK (horizont_monate >= 0),
    aktualisiert_am  timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE sync.tpapi_core_lader IS
'Laderstand je TPAPI-Endpunkt (0153): stand = Version des Laders raw → core (src/tpapi/core_laden.ts),
horizont_monate = wie viele Monate vor dem laufenden Journal und Bons nach core kommen (NULL: ohne
Horizont, 0: alles). Vom Importer zu Beginn jedes Laders geschrieben. Ein Rohsatz mit core_stand =
stand ist geladen; ein anderer Wert heisst: wartet auf den Lader (auch nach einer neuen Laderversion).';

INSERT INTO sync.tpapi_core_lader (endpunkt, stand, horizont_monate)
SELECT e, 1, CASE WHEN e IN ('tpapi:journal', 'tpapi:journaltables') THEN 24 END
  FROM unnest(ARRAY['tpapi:journal', 'tpapi:journaltables', 'tpapi:personalkostenprotag',
                    'tpapi:getforecastperday', 'tpapi:recipe', 'tpapi:attributes', 'tpapi:meccode',
                    'tpapi:vat', 'tpapi:financetype', 'tpapi:financecategory', 'tpapi:pricelevel',
                    'tpapi:site', 'tpapi:operationprofile', 'tpapi:meccodegroup', 'tpapi:category',
                    'tpapi:detailcategory', 'tpapi:grosscategory']) AS e
ON CONFLICT (endpunkt) DO NOTHING;

-- Ohne Tabellenzugriff, deshalb in mart und fuer jeden aufrufbar (wie
-- mart.finanzweg_art): der Rumpf einer Funktion laeuft mit den Rechten des
-- Aufrufers, und mcp_leser darf in sync nichts.
CREATE OR REPLACE FUNCTION mart.tpapi_core_ab(p_monate integer)
RETURNS date
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN p_monate IS NULL OR p_monate = 0 THEN NULL
                ELSE date_trunc('month', current_date - make_interval(months => p_monate))::date END
$$;

COMMENT ON FUNCTION mart.tpapi_core_ab(integer) IS
'Erster Geschaeftstag, ab dem Journal und Bons nach core kommen: der Monatserste N Monate vor dem
laufenden Monat (TPAPI_CORE_MONATE, Standard 24). NULL = ohne Horizont. Lader und Sichten rechnen
damit dieselbe Grenze (0153).';


-- ---------------------------------------------------------------------
-- 2. Abruf- und Abzugszeilen: was der Lader daraus gemacht hat
-- ---------------------------------------------------------------------

ALTER TABLE core.tpapi_abruf
    ADD COLUMN IF NOT EXISTS ladeversuche     smallint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ladefehler_stand integer,
    ADD COLUMN IF NOT EXISTS ladefehler_am    timestamptz,
    ADD COLUMN IF NOT EXISTS core_geladen_am  timestamptz,
    ADD COLUMN IF NOT EXISTS core_zeilen      integer,
    ADD COLUMN IF NOT EXISTS core_auffaellig  jsonb;

CREATE INDEX IF NOT EXISTS tpapi_abruf_endpunkt_tag ON core.tpapi_abruf (endpunkt, geschaeftstag);
CREATE INDEX IF NOT EXISTS tpapi_abruf_endpunkt_core ON core.tpapi_abruf (endpunkt, core_geladen_am DESC);

COMMENT ON COLUMN core.tpapi_abruf.ladefehler IS
'Warum der Rohsatz nicht nach core kam (0153): die Meldung des Laders, gekuerzt. NULL nach einem
gelungenen Laden und bei jedem neuen Rohsatz.';
COMMENT ON COLUMN core.tpapi_abruf.ladeversuche IS
'Gescheiterte Ladeversuche mit dem Laderstand in ladefehler_stand. Ab 3 versucht der Lader diesen
Rohsatz nicht mehr (Zustand "ladefehler endgueltig" in mart.tpapi_core_stand) — bis ein neuer
Rohsatz kommt oder eine neue Laderversion. Wie 0136: nicht endlos, aber sichtbar.';
COMMENT ON COLUMN core.tpapi_abruf.ladefehler_stand IS
'Laderstand, mit dem die Versuche in ladeversuche scheiterten.';
COMMENT ON COLUMN core.tpapi_abruf.ladefehler_am IS
'Letzter gescheiterter Ladeversuch — ein Lauf versucht denselben Rohsatz nur einmal.';
COMMENT ON COLUMN core.tpapi_abruf.core_geladen_am IS
'Wann der Rohsatz zuletzt nach core kam (0153). Daran misst sync.quelle den Zulauf in core.';
COMMENT ON COLUMN core.tpapi_abruf.core_zeilen IS
'Zeilen, die der Lader in core geschrieben hat (Journal: Positionen, Bons: Bons, Personal: 1).';
COMMENT ON COLUMN core.tpapi_abruf.core_auffaellig IS
'Was der Lader beim Laden gemessen hat und nicht erwartet war, sonst NULL (0153): felder (Feldname →
Zeilen, in denen ein seit der Formprobe immer leeres oder ein unbekanntes Feld einen Wert trug),
ausserhalb_geschaeftstag (Zeitpunkt nicht zwischen 08:00 des Tages und 07:59 des Folgetags),
ohne_zeitpunkt, refdate_abweichend (refdate ist nicht der Geschaeftstag), saldo (Journal: Summe
balance ungleich null), unbekannte_felder (Personalkosten je Tag). Pruefzeile in
mart.pruefung_uebersicht.';

ALTER TABLE core.tpapi_stammabzug
    ADD COLUMN IF NOT EXISTS von              date,
    ADD COLUMN IF NOT EXISTS bis              date,
    ADD COLUMN IF NOT EXISTS ladefehler       text,
    ADD COLUMN IF NOT EXISTS ladeversuche     smallint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ladefehler_stand integer,
    ADD COLUMN IF NOT EXISTS ladefehler_am    timestamptz,
    ADD COLUMN IF NOT EXISTS core_geladen_am  timestamptz,
    ADD COLUMN IF NOT EXISTS core_auffaellig  jsonb;

CREATE INDEX IF NOT EXISTS tpapi_stammabzug_bereich
    ON core.tpapi_stammabzug (betrieb_key, endpunkt, von, bis) WHERE von IS NOT NULL;

COMMENT ON COLUMN core.tpapi_stammabzug.von IS
'Nur bei Bereichsabrufen (revenue/getforecastperday, 0153): erster Tag des Parameters from.';
COMMENT ON COLUMN core.tpapi_stammabzug.bis IS
'Nur bei Bereichsabrufen: letzter Tag des Parameters to.';
COMMENT ON COLUMN core.tpapi_stammabzug.core_stand IS
'Laderstand, mit dem der Abzug nach core kam (0153). Beim Artikelstamm haelt core nur den JUENGSTEN
Abzug je Betrieb und Liste; ein aelterer Abzug bekommt den Laderstand, sobald ein juengerer derselben
Liste geladen ist — er ist darin aufgegangen, nicht verloren (raw bleibt).';
COMMENT ON COLUMN core.tpapi_stammabzug.ladefehler IS
'Wie core.tpapi_abruf.ladefehler (0153).';
COMMENT ON COLUMN core.tpapi_stammabzug.core_auffaellig IS
'Wie core.tpapi_abruf.core_auffaellig. Prognose: nicht_berliner_mitternacht (datum liegt nicht auf
Berliner Mitternacht).';


-- ---------------------------------------------------------------------
-- 3a. Das Kassenjournal
--
-- Eine Zeile je Journalzeile, partitioniert nach Geschaeftstag (Monat, ueber
-- core.partition_anlegen — der Lader legt die Partition vor dem Schreiben
-- an). Der Geschaeftstag kommt aus der Abrufzeile (businessdate = refdate,
-- Berliner Mitternacht), NICHT aus datum: ein Zeitpunkt nach Mitternacht
-- gehoert zum Vortag. Umgerechnet wird nichts — die Formprobe fand keine
-- Zeile ausserhalb 08:00-07:59; der Lader zaehlt Abweichungen
-- (core.tpapi_abruf.core_auffaellig).
--
-- KEIN raw_id UND KEIN geladen_am JE ZEILE: beides steht je Tag in
-- core.tpapi_abruf. Bei rund 140 Mio. Zeilen fuer die ganze Historie waeren
-- das 2,2 GB fuer eine Angabe, die je Tag gleich ist.
--
-- Die sieben Felder, die in beiden Proben durchgehend null waren
-- (event_number, menucard_id, price_per_unit, financeextendedinfo_id,
-- provision_free, course_price_print, coursedefentry_id), sind keine Spalten.
-- Traegt eines einen Wert — oder kommt ein unbekanntes Feld dazu —, steht es
-- in zusatz und wird je Tag gezaehlt.
-- ---------------------------------------------------------------------

CREATE TABLE core.kassenjournal (
    betrieb_key          integer  NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag        date     NOT NULL,
    journal_id           bigint   NOT NULL,
    zeitpunkt            timestamptz,
    stunde               smallint,
    art                  text,
    artnr                integer,
    zahl                 numeric,
    preis                numeric,
    balance              numeric,
    ust                  numeric(5,2),
    vat_id               smallint,
    finanzweg            integer,
    tableheader_id       bigint,
    am_id                bigint,
    parentid             bigint,
    tisch                text,
    buchungsnr           text,
    kellnernr            integer,
    masterkellnernr      integer,
    teamnr               integer,
    terminal             integer,
    zcount               integer,
    site                 integer,
    situation            smallint,
    sortorder            smallint,
    rabatt_id            integer,
    pricelevel_id        integer,
    operationprofile_id  integer,
    cancellationreason   integer,
    captivesupplyreason  integer,
    addinfo              text,
    zusatz               jsonb,
    PRIMARY KEY (betrieb_key, geschaeftstag, journal_id)
) PARTITION BY RANGE (geschaeftstag);

COMMENT ON TABLE core.kassenjournal IS
'Koernung: eine Zeile des Kassenjournals (TPAPI revenue/journal, Feld ID) je Betrieb und Geschaeftstag
(0153). Nur Betriebe mit TPAPI-Schluessel und gebuchter Sales Data API, und nur Geschaeftstage ab
mart.tpapi_core_ab(TPAPI_CORE_MONATE) — aeltere liegen roh in raw.api_antwort (mart.tpapi_core_stand:
"ausserhalb horizont"). Der Rohsatz je Tag: core.tpapi_abruf.raw_id.

EINE BUCHUNGSLISTE MIT SALDO NULL. Verkaeufe positiv, Zahlungen negativ, Trinkgeld positiv,
Tischuebergabe hin und zurueck; die Summe von balance ueber einen Tag ist 0. Was davon Umsatz ist,
sagt mart.kassenjournal_zeilenart() — eine Hypothese, geprueft in mart.kassenjournal_abgleich_monat.

Ein erneuter Abruf mit neuem Inhalt ersetzt den Tag vollstaendig (geloescht und neu geschrieben).
addinfo ist Freitext (zu 98 % leer) und erscheint nie in mart.';
COMMENT ON COLUMN core.kassenjournal.geschaeftstag IS
'businessdate der Abfrage = refdate der Zeile (Berliner Mitternacht). Laeuft 08:00 bis 07:59 des
Folgetags; eine Position um 01:30 gehoert zum Vortag.';
COMMENT ON COLUMN core.kassenjournal.journal_id IS 'Feld ID — je Betrieb eindeutig (Formprobe: 1182 von 1182).';
COMMENT ON COLUMN core.kassenjournal.zeitpunkt IS 'Feld datum (Unix-Sekunden) als Zeitpunkt.';
COMMENT ON COLUMN core.kassenjournal.stunde IS
'Stunde von zeitpunkt auf der Berliner Uhr (0-23). 0-7 gehoeren ans ENDE des Geschaeftstags.';
COMMENT ON COLUMN core.kassenjournal.art IS
'Buchungstext der Zeile — Artikelname, Zahlart ("Bar gegeben"), Nachlass ("10% Gluecksrad"), "TIP_".';
COMMENT ON COLUMN core.kassenjournal.artnr IS
'Artikelnummer; 0 oder negativ bei Sonderzeilen (Zahlung, Trinkgeld, Systembuchung).';
COMMENT ON COLUMN core.kassenjournal.balance IS
'Betrag der Zeile, BRUTTO, mit LINAs Vorzeichen. Ohne Typgrenze: eine Kassen-Fehleingabe (0136,
-9,2 Bio. EUR) soll nicht das Laden des Tages sprengen.';
COMMENT ON COLUMN core.kassenjournal.preis IS
'Feld preis. In der Formprobe gleich balance; am 01.11.2026 war es bei vielen Zeilen 0 — fuer Betraege
balance nehmen.';
COMMENT ON COLUMN core.kassenjournal.ust IS 'Steuersatz in Prozent (19.00, 7.00, 0.00) — LINA liefert ihn mal als Text, mal als Zahl.';
COMMENT ON COLUMN core.kassenjournal.finanzweg IS
'LINAs Finanzwegnummer (1 Boniert, 10 Sofortstorno, 20 Bar, 22/23 Tischuebergabe/-uebernahme, 2700
Trinkgeld …) — dieselbe Nummer wie in Bericht 97 (core.finanzweg_tag), gemessen 07.11.2026.';
COMMENT ON COLUMN core.kassenjournal.tableheader_id IS 'Der Bon (core.kassenbon.tableheader_id).';
COMMENT ON COLUMN core.kassenjournal.parentid IS 'am_id der Zeile, zu der diese gehoert (Beilage, Zusatz); 0 = eigenstaendig.';
COMMENT ON COLUMN core.kassenjournal.kellnernr IS 'Kellnernummer — dieselbe wie in den Betriebsberichten 57/60.';
COMMENT ON COLUMN core.kassenjournal.zusatz IS
'Felder mit Wert, die keine eigene Spalte haben: die sieben seit der Formprobe immer leeren und jedes
unbekannte Feld. NULL im Normalfall; je Tag gezaehlt in core.tpapi_abruf.core_auffaellig.';


-- ---------------------------------------------------------------------
-- 3b. Das Journal je Tag und Finanzweg — vom Lader in derselben Transaktion
--
-- Die Abgleichsichten (S10) vergleichen je Betrieb und Tag. Ueber das
-- Journal selbst waeren das 1.500 Zeilen je Tag, fuer einen Monat aller
-- Betriebe 1,6 Mio.; hier sind es rund zwoelf. Keine Materialisierung, die
-- aufgefrischt werden muesste und still veralten koennte: der Lader schreibt
-- beides im selben Zug, und was im Journal steht, steht auch hier.
-- KEINE Deutung: Summen je Finanzweg, wie sie in der Kasse stehen.
-- ---------------------------------------------------------------------

CREATE TABLE core.kassenjournal_finanzweg_tag (
    betrieb_key     integer  NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag   date     NOT NULL,
    finanzweg       integer  NOT NULL,
    zeilen          integer  NOT NULL,
    balance         numeric  NOT NULL,
    netto           numeric,
    zeilen_artikel  integer  NOT NULL,
    menge_artikel   numeric,
    bons            integer  NOT NULL,
    rabatt_zeilen   integer  NOT NULL,
    rabatt_balance  numeric  NOT NULL,
    storno_zeilen   integer  NOT NULL,
    storno_balance  numeric  NOT NULL,
    PRIMARY KEY (betrieb_key, geschaeftstag, finanzweg)
);

CREATE INDEX kassenjournal_finanzweg_tag_tag ON core.kassenjournal_finanzweg_tag (geschaeftstag);

COMMENT ON TABLE core.kassenjournal_finanzweg_tag IS
'Koernung: Betrieb × Geschaeftstag × Finanzweg — Summen des Kassenjournals, vom Lader im selben Zug
geschrieben wie core.kassenjournal (0153), keine Deutung. Grundlage der Abgleichsichten (S10).
balance brutto mit LINAs Vorzeichen; netto = Summe balance / (1 + ust/100) je Zeile; zeilen_artikel
und menge_artikel nur Zeilen mit artnr > 0; bons = verschiedene tableheader_id; rabatt_* Zeilen mit
rabatt_id <> 0; storno_* Zeilen mit cancellationreason <> 0. Ein Tag ohne Journalzeilen hat hier
keine Zeile — ob er geladen ist, sagt core.tpapi_abruf.';


-- ---------------------------------------------------------------------
-- 3c. Die Bons (revenue/journaltables)
-- ---------------------------------------------------------------------

CREATE TABLE core.kassenbon (
    betrieb_key          integer  NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag        date     NOT NULL,
    tableheader_id       bigint   NOT NULL,
    old_id               bigint,
    table_type           text,
    table_number         text,
    dokument_zeitpunkt   timestamptz,
    stunde               smallint,
    accounting_type      text,
    debitor_id           bigint,
    debitor_text         text,
    parent_id            bigint,
    archiveparent_id     bigint,
    reservation_id       bigint,
    zcount               integer,
    number_adults        integer,
    number_kids          integer,
    number_infants       integer,
    renum                bigint,
    vat1sum              numeric,
    vat2sum              numeric,
    vat3sum              numeric,
    finanzweg            integer,
    zahl                 numeric,
    kellnernr            integer,
    is_archive           smallint,
    zip_code             text,
    zusatz               jsonb,
    PRIMARY KEY (betrieb_key, geschaeftstag, tableheader_id)
) PARTITION BY RANGE (geschaeftstag);

COMMENT ON TABLE core.kassenbon IS
'Koernung: ein Bon (Tisch, TPAPI revenue/journaltables, Feld tableheader_id) je Betrieb und
Geschaeftstag (0153). Gleicher Horizont wie core.kassenjournal. accounting_type BILL = abgerechnet,
EMPTY = Tisch ohne Journalzeile (26 von 190 in der Formprobe) — wer Bons zaehlt, filtert auf BILL.
Gaeste in number_adults/kids/infants. debitor_text und zip_code sind Freitext bzw. Postleitzahl von
Gaesten und erscheinen nie in mart (S6). transaction_number und tablearea_id waren in beiden Proben
null und stehen nur in zusatz, wenn sie einen Wert tragen.';
COMMENT ON COLUMN core.kassenbon.dokument_zeitpunkt IS 'Feld documentdate (Unix-Sekunden).';
COMMENT ON COLUMN core.kassenbon.stunde IS 'Stunde von dokument_zeitpunkt auf der Berliner Uhr.';
COMMENT ON COLUMN core.kassenbon.renum IS 'Rechnungsnummer; 0 bei EMPTY.';


-- ---------------------------------------------------------------------
-- 3d. Personalkosten je Tag — aus dem schon verdichteten Rohsatz (S5)
-- ---------------------------------------------------------------------

CREATE TABLE core.personalkosten_tag (
    betrieb_key        integer      NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag      date         NOT NULL,
    personen           integer      NOT NULL,
    h_brutto           numeric(10,2),
    h_zuschl_25        numeric(10,2),
    h_zuschl_40        numeric(10,2),
    h_zuschl_50        numeric(10,2),
    brutto             numeric(12,2),
    lohnkosten         numeric(12,2),
    unbekannte_felder  text[],
    raw_id             bigint,
    geladen_am         timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, geschaeftstag)
);

COMMENT ON TABLE core.personalkosten_tag IS
'Koernung: Betrieb × Geschaeftstag — LINAs Personalkosten je Tag (TPAPI personal/personalkostenprotag),
schon VOR raw zur Summe verdichtet (Plan S5): die Zeilen je Person gibt es nirgends (0153). Ohne
Horizont, so weit LINA liefert. personen = 0 heisst: LINA fuehrt an dem Tag niemanden, nicht "niemand
da". Lohnkosten der Personalplanung, NICHT die Personalkosten der BWA.';
COMMENT ON COLUMN core.personalkosten_tag.personen IS 'Zahl der Zeilen der Antwort = Personen mit Arbeitszeit laut LINA.';
COMMENT ON COLUMN core.personalkosten_tag.h_brutto IS
'Summe h_brutto: Arbeitsstunden laut Personalplanung. Deutung, nicht gemessen: Brutto-Arbeitszeit;
ob mit oder ohne Pause, ist offen.';
COMMENT ON COLUMN core.personalkosten_tag.h_zuschl_25 IS 'Summe der Stunden mit 25 % Zuschlag.';
COMMENT ON COLUMN core.personalkosten_tag.brutto IS 'Summe Bruttolohn in EUR.';
COMMENT ON COLUMN core.personalkosten_tag.lohnkosten IS 'Summe Lohnkosten in EUR (Brutto plus Arbeitgeberanteil, Deutung).';
COMMENT ON COLUMN core.personalkosten_tag.unbekannte_felder IS
'Feldnamen, die LINA zusaetzlich lieferte (nur Namen, nie Werte — Verdichtung in
src/tpapi/verdichtung.ts). NULL im Normalfall.';


-- ---------------------------------------------------------------------
-- 3e. Die Umsatzprognose je Tag (revenue/getforecastperday)
--
-- EINE PROGNOSE FUER EINEN TAG KANN SICH AENDERN. Jede Nacht fragt der
-- Importer ein Fenster um heute (Monatsanfang bzw. vor sieben Tagen bis in
-- 14 Tagen); jeder Tag steht darin bis zu ~40-mal. Entscheidung (Plan §8):
-- nichts wird still ueberschrieben, drei Werte bleiben nebeneinander —
--   erste_prognose_netto  der erste Wert, den wir je gesehen haben
--   vorab_netto           der letzte Wert, gesehen VOR Beginn des
--                         Geschaeftstags (08:00) — die Prognose, die galt,
--                         als der Tag noch bevorstand; DIE Vergleichszahl
--   prognose_netto        der juengste Wert, auch nach dem Tag gesehen
-- dazu wie oft und wann zuletzt er sich geaendert hat. Fuer Tage, die erst
-- das Nachladen holte (Monate in der Vergangenheit), gibt es keinen
-- Vorabwert: ob LINA ihre Prognose nachtraeglich anpasst, weiss niemand.
-- ---------------------------------------------------------------------

CREATE TABLE core.umsatzprognose_tag (
    betrieb_key           integer      NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag         date         NOT NULL,
    prognose_netto        numeric(12,2),
    abgerufen_am          timestamptz  NOT NULL,
    erste_prognose_netto  numeric(12,2),
    erstmals_am           timestamptz  NOT NULL,
    vorab_netto           numeric(12,2),
    vorab_am              timestamptz,
    geaendert_am          timestamptz,
    aenderungen           integer      NOT NULL DEFAULT 0,
    abzug_id              bigint,
    geladen_am            timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, geschaeftstag)
);

COMMENT ON TABLE core.umsatzprognose_tag IS
'Koernung: Betrieb × Geschaeftstag — LINAs Umsatzprognose (TPAPI revenue/getforecastperday, netto EUR)
(0153). LINAs Zahl, keine eigene. Eine Prognose kann sich aendern; nichts wird still ueberschrieben:
erste_prognose_netto (erster gesehener Wert), vorab_netto (letzter Wert VOR 08:00 des Tages — die
Vergleichszahl), prognose_netto (juengster Wert, auch nach dem Tag). Ohne Horizont.';
COMMENT ON COLUMN core.umsatzprognose_tag.abgerufen_am IS 'Wann der juengste Wert gesehen wurde (Abzug in core.tpapi_stammabzug).';
COMMENT ON COLUMN core.umsatzprognose_tag.erstmals_am IS 'Wann der Tag zum ersten Mal in einer Antwort stand.';
COMMENT ON COLUMN core.umsatzprognose_tag.vorab_netto IS
'Letzter Wert, gesehen vor Beginn des Geschaeftstags (08:00 Berlin). NULL, wenn der Tag nie vorab
gefragt wurde (etwa aus dem Nachladen der Historie).';
COMMENT ON COLUMN core.umsatzprognose_tag.geaendert_am IS 'Letzte Beobachtung mit anderem Wert als die vorherige; NULL = nie geaendert.';
COMMENT ON COLUMN core.umsatzprognose_tag.aenderungen IS 'Wie oft sich der Wert zwischen zwei Beobachtungen geaendert hat.';


-- ---------------------------------------------------------------------
-- 3f. Der Artikelstamm der Kasse — jeweils der juengste Stand je Betrieb
--
-- NICHT core.artikel. core.artikel ist der Artikel aus LINAs
-- Konzernberichten (articleApi:franchise, eine Zeile je Artikelnummer fuer
-- alle Betriebe); das hier ist der Stamm der Kasse JE BETRIEB, mit eigener
-- interner id. Verbunden werden beide nur in mart, ueber die Nummer, und nur
-- zur Messung (mart.kassenartikel_fixedwe_abgleich).
--
-- prices und attributes kommen nicht nach core: sie machen den groessten
-- Teil der 31,6 MB je Betrieb aus und stehen in raw.
-- ---------------------------------------------------------------------

CREATE TABLE core.tpapi_artikel (
    betrieb_key      integer      NOT NULL REFERENCES core.betrieb(betrieb_key),
    artikel_id       integer      NOT NULL,
    artikelnummer    bigint       NOT NULL,
    name             text,
    aktiv            boolean,
    funktion         text,
    detailcategory   integer,
    meccode          integer,
    fixedwe          numeric(12,4),
    quantitycontrol  text,
    currentquantity  numeric,
    productuse       integer,
    warengruppe      text,
    kategorie        text,
    hauptgruppe      text,
    zusatz           jsonb,
    abzug_id         bigint       NOT NULL,
    stand_am         timestamptz  NOT NULL,
    PRIMARY KEY (betrieb_key, artikel_id),
    -- Eindeutig, weil das Journal ueber die Nummer verbindet: eine doppelte
    -- Nummer verdoppelte Journalzeilen still. Lieber scheitert das Laden.
    UNIQUE (betrieb_key, artikelnummer)
);

COMMENT ON TABLE core.tpapi_artikel IS
'Koernung: Betrieb × Kassenartikel (TPAPI merchandiseman/recipe), juengster Abzug (0153). Nicht
core.artikel (Konzernberichte). artikelnummer = Feld number (verbindet mit kassenjournal.artnr —
Annahme, Trefferquote in mart.kassenjournal_stamm_pruefung). fixedwe = LINAs Wareneinsatz je
Artikel — der Kandidat fuer die Herkunft von core.artikel.fixer_we (Regel 5), gemessen in
mart.kassenartikel_fixedwe_abgleich, KEINE Margenaussage. warengruppe/kategorie/hauptgruppe sind die
Namen aus detailcategory → category → grosscategory desselben Betriebs, nach jedem Stammladen
nachgezogen (Verweis ueber id: Annahme aus den Wertebereichen der Formprobe).';
COMMENT ON COLUMN core.tpapi_artikel.artikel_id IS 'Feld id — interne Nummer der Kasse, je Betrieb verschieden.';
COMMENT ON COLUMN core.tpapi_artikel.funktion IS 'Feld function: MAIN | TENDER | COURSE_COMPILATION | INFORMATION.';
COMMENT ON COLUMN core.tpapi_artikel.fixedwe IS 'Feld fixedwe: Wareneinsatz je Artikel in EUR (0 bis 204 in der Formprobe).';
COMMENT ON COLUMN core.tpapi_artikel.zusatz IS 'Uebrige Felder mit Wert (ohne prices, attributes und die PHP-Reste "0"/"1").';

CREATE TABLE core.tpapi_finanzweg (
    betrieb_key    integer      NOT NULL REFERENCES core.betrieb(betrieb_key),
    finanzweg_id   integer      NOT NULL,
    nummer         integer      NOT NULL,
    name           text,
    aktiv          boolean,
    kategorie_id   integer,
    ist_trinkgeld  boolean,
    zusatz         jsonb,
    abzug_id       bigint       NOT NULL,
    stand_am       timestamptz  NOT NULL,
    PRIMARY KEY (betrieb_key, finanzweg_id),
    UNIQUE (betrieb_key, nummer)
);

COMMENT ON TABLE core.tpapi_finanzweg IS
'Koernung: Betrieb × Finanzweg aus dem Stamm der Kasse (TPAPI merchandiseman/financetype), juengster
Abzug (0153). nummer verbindet mit kassenjournal.finanzweg — Annahme (die Nummern von Bericht 97 sind
Nummern, keine ids), geprueft in mart.kassenjournal_finanzweg_stamm. kategorie_id = fin_category →
core.tpapi_finanzkategorie (ueber id, Annahme). Eindeutig je Nummer, damit ein Join nichts verdoppelt.';

CREATE TABLE core.tpapi_finanzkategorie (
    betrieb_key   integer      NOT NULL REFERENCES core.betrieb(betrieb_key),
    kategorie_id  integer      NOT NULL,
    nummer        integer,
    name          text,
    aktiv         boolean,
    typ           text,
    abzug_id      bigint       NOT NULL,
    stand_am      timestamptz  NOT NULL,
    PRIMARY KEY (betrieb_key, kategorie_id)
);

COMMENT ON TABLE core.tpapi_finanzkategorie IS
'Koernung: Betrieb × Finanzkategorie (TPAPI merchandiseman/financecategory), juengster Abzug (0153).
typ: SALES, NONCASH, CAPTIVE_SUPPLY, EINZWECKGUTSCHEIN, MEHRZWECKGUTSCHEIN, FORDERUNG …';

CREATE TABLE core.tpapi_stammliste (
    betrieb_key  integer      NOT NULL REFERENCES core.betrieb(betrieb_key),
    liste        text         NOT NULL,
    pos          integer      NOT NULL,
    id           integer,
    nummer       bigint,
    name         text,
    aktiv        text,
    rest         jsonb,
    abzug_id     bigint       NOT NULL,
    stand_am     timestamptz  NOT NULL,
    PRIMARY KEY (betrieb_key, liste, pos)
);

CREATE INDEX tpapi_stammliste_id ON core.tpapi_stammliste (betrieb_key, liste, id);

COMMENT ON TABLE core.tpapi_stammliste IS
'Koernung: Betrieb × Liste × Eintrag fuer die kleinen Listen des Artikelstamms (attributes, meccode,
vat, pricelevel, site, operationprofile, meccodegroup, category, detailcategory, grosscategory),
juengster Abzug (0153). Schluessel ist die Position in der Antwort, NICHT id: grosscategory fuehrte
68 Eintraege mit 61 verschiedenen ids. id/nummer/name aus den gleichnamigen Feldern (attributes:
attributeId/attributeName), alles Uebrige in rest.';


-- ---------------------------------------------------------------------
-- 4. DIE DEUTUNG: was ist Umsatz im Journal — an EINER Stelle
--
-- HYPOTHESE AUS ZWEI STICHPROBEN (Formprobe 12.11.2026, Aposto Aalen und
-- Wilma Wunder Nuernberg, 09.11.2026; erste Messung 07.11.2026, Aalen
-- 01.11.2026), NICHT GEMESSEN gegen den Umsatzbericht:
--
--   umsatz     Finanzweg 1 (Boniert: die Verkaufspositionen, 893 von 1.182
--              Zeilen, +4.624 EUR) und 10 (Sofortstorno, negativ), dazu jeder
--              Finanzweg, den Bericht 97 in der Finanzgruppe "Umsatz" fuehrt
--              (Storno nach dem Bonieren) — dieselbe Abgrenzung wie
--              mart.finanzweg_art() = 'umsatz'. Brutto, Summe balance.
--   statistik  22/23 Tischuebergabe/-uebernahme und was 97 als Statistik fuehrt
--   trinkgeld  2700 Trinkgeld
--   system     -10 Systembuchung
--   nachlass   ein Finanzweg der Gruppen Hausbon/Rabatt — im Journal bisher NIE
--              als Finanzweg gesehen: der Nachlass steht an der Position
--              (rabatt_id <> 0), also IN den Umsatzzeilen
--   zahlung    jeder andere Finanzweg, den 97 kennt (Bar, Karten, Gutschein …)
--   unbekannt  ein Finanzweg, den weder diese Liste noch core.finanzweg kennt
--
-- Was offen ist und die Abgleichsicht zeigen muss: am 01.11.2026 lag Boniert
-- (7.638,14) ueber dem Umsatzbericht (7.291,64 brutto) — Gutscheinverkauf,
-- Nachlaesse und Sofortstorno sind die Kandidaten. Deshalb fuehrt
-- mart.kassenjournal_umsatz_abgleich neben der Deutung zwei Kandidaten
-- (nur Boniert; ohne Nachlasszeilen), und mart.kassenjournal_abgleich_monat
-- sagt nach dem ersten echten Lauf, welche trifft. Aendert sich die Deutung,
-- dann hier und nirgends sonst.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mart.kassenjournal_zeilenart(p_finanzweg integer, p_finanzgruppe text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE
             WHEN p_finanzweg IN (1, 10)                                  THEN 'umsatz'
             WHEN p_finanzweg IN (22, 23)                                 THEN 'statistik'
             WHEN p_finanzweg = 2700                                      THEN 'trinkgeld'
             WHEN p_finanzweg = -10                                       THEN 'system'
             WHEN p_finanzgruppe IS NULL                                  THEN 'unbekannt'
             WHEN mart.finanzweg_art(p_finanzgruppe) = 'umsatz'           THEN 'umsatz'
             WHEN mart.finanzweg_art(p_finanzgruppe) = 'statistik'        THEN 'statistik'
             WHEN mart.finanzweg_art(p_finanzgruppe) = 'nachlass'         THEN 'nachlass'
             WHEN p_finanzgruppe ~* 'trinkgeld'                           THEN 'trinkgeld'
             ELSE 'zahlung'
           END
$$;

COMMENT ON FUNCTION mart.kassenjournal_zeilenart(integer, text) IS
'DIE Deutung der Kassenjournalzeilen (0153) — HYPOTHESE aus zwei Stichproben, nicht gegen den
Umsatzbericht gemessen: umsatz (Finanzweg 1 Boniert, 10 Sofortstorno, und was Bericht 97 in der
Finanzgruppe Umsatz fuehrt) | statistik (22/23 Tischuebergabe) | trinkgeld (2700) | system (-10) |
nachlass | zahlung | unbekannt (Finanzweg weder hier noch in core.finanzweg). Umsatz brutto eines
Tages = Summe balance der Zeilen mit zeilenart = umsatz. Ob das den Umsatzbericht trifft:
mart.kassenjournal_abgleich_monat. p_finanzgruppe ist core.finanzweg.finanzgruppe der Nummer.';


-- ---------------------------------------------------------------------
-- 5a. Kassen-Fehleingaben im Journal — eine Stelle fuer alle Sichten
--
-- Dieselbe Falle wie 0136: jemand tippt "Bar gegeben 555 Mrd." ein, die
-- Kasse bucht den Rest als Rueckgeld oder Trinkgeld. Im Journal stehen
-- dann zwei absurde Zeilen, deren Summe null ist — der Umsatz stimmt, jede
-- Summe ueber Zahlungen nicht. Zwei Quellen: das Journal selbst (ein
-- Finanzweg ausser Boniert mit mindestens 1 Mio. EUR an einem Tag — fuer
-- diese Betriebe ausgeschlossen) und die Erkennung aus 0136 an Bericht 97.
-- Kein Aggregat: die Sichten fragen je Betrieb und Tag mit EXISTS, und das
-- laeuft ueber die Primaerschluessel.
-- ---------------------------------------------------------------------

CREATE VIEW mart.kassenjournal_fehleingabe AS
SELECT f.betrieb_key,
       f.geschaeftstag,
       'journal: betrag absurd'::text  AS regel,
       f.finanzweg,
       f.balance                       AS betrag
  FROM core.kassenjournal_finanzweg_tag f
 WHERE f.finanzweg <> 1
   AND abs(f.balance) >= 1000000
UNION ALL
SELECT fe.betrieb_key,
       fe.geschaeftstag,
       'bericht 97: ' || fe.regel,
       fe.finanzweg_nummer,
       fe.betrag_lina
  FROM core.finanzweg_fehleingabe fe
 WHERE fe.bericht = 97
   AND fe.zeitraum_bis = fe.geschaeftstag;

COMMENT ON VIEW mart.kassenjournal_fehleingabe IS
'Koernung: Betrieb × Geschaeftstag × Finanzweg mit erkannter Kassen-Fehleingabe (0153, Regel wie
0136): im Journal ein Finanzweg ausser Boniert mit mindestens 1 Mio. EUR an einem Tag, oder die
Erkennung aus Bericht 97 (core.finanzweg_fehleingabe). An solchen Tagen stimmen Summen ueber
Zahlungen und Trinkgeld nicht; die Journalsichten zeigen es in tag_fehleingabe bzw. befund.
betrag mit LINAs Vorzeichen.';


-- ---------------------------------------------------------------------
-- 5b. Die Positionen
--
-- Ohne addinfo (S6). Joins nur auf Tabellen mit eindeutigem Schluessel
-- (Artikel und Finanzweg je Betrieb und Nummer, core.finanzweg je Nummer)
-- — sonst verdoppelte ein doppelter Stammeintrag Positionen still.
-- ---------------------------------------------------------------------

CREATE VIEW mart.kassenjournal_position AS
SELECT j.geschaeftstag,
       date_trunc('month', j.geschaeftstag::timestamp)::date AS monat,
       (ARRAY['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'])
           [extract(isodow FROM j.geschaeftstag)::int]  AS wochentag,
       j.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       bs.konzept                                       AS marke,
       j.zeitpunkt,
       j.stunde,
       ((j.stunde + 16) % 24)::int                      AS stunde_folge,
       j.journal_id,
       j.tableheader_id                                 AS bon_id,
       j.tisch,
       j.artnr,
       j.art                                            AS buchungstext,
       ta.name                                          AS artikel,
       ta.warengruppe,
       ta.hauptgruppe,
       j.zahl                                           AS menge,
       j.balance                                        AS betrag_brutto,
       j.ust                                            AS ust_pct,
       round(j.balance / (1 + j.ust / 100), 4)          AS betrag_netto,
       j.finanzweg,
       coalesce(tf.name, cf.name)                       AS finanzweg_name,
       mart.kassenjournal_zeilenart(j.finanzweg, cf.finanzgruppe) AS zeilenart,
       (j.parentid IS NOT NULL AND j.parentid <> 0)     AS ist_zusatz,
       j.parentid                                       AS zu_position,
       j.rabatt_id,
       j.cancellationreason                             AS stornogrund_id,
       j.kellnernr,
       j.terminal,
       j.site                                           AS site_id,
       j.situation,
       j.pricelevel_id                                  AS preisebene_id,
       j.operationprofile_id                            AS betriebsprofil_id,
       EXISTS (SELECT 1 FROM mart.kassenjournal_fehleingabe fe
                WHERE fe.betrieb_key = j.betrieb_key
                  AND fe.geschaeftstag = j.geschaeftstag) AS tag_fehleingabe,
       (bs.status = 'operativ')                         AS operativ
  FROM core.kassenjournal j
  JOIN core.betrieb b              ON b.betrieb_key = j.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = j.betrieb_key
  LEFT JOIN core.tpapi_artikel ta  ON ta.betrieb_key = j.betrieb_key
                                  AND ta.artikelnummer = j.artnr
                                  AND j.artnr > 0
  LEFT JOIN core.tpapi_finanzweg tf ON tf.betrieb_key = j.betrieb_key AND tf.nummer = j.finanzweg
  LEFT JOIN core.finanzweg cf      ON cf.nummer = j.finanzweg;

COMMENT ON VIEW mart.kassenjournal_position IS
'Koernung: eine Zeile des Kassenjournals (TPAPI) — Betrieb × Geschaeftstag × Position (0153). Nur
Betriebe mit TPAPI-Schluessel und Sales Data API (mart.tpapi_zugang_modul) und nur Geschaeftstage im
Horizont (mart.tpapi_core_stand, horizont_ab); fehlt ein Betrieb oder Monat, heisst das nicht null.

DAS JOURNAL IST EINE BUCHUNGSLISTE MIT SALDO NULL: Verkaeufe positiv, Zahlungen negativ, Trinkgeld
positiv, Tischuebergabe hin und zurueck. sum(betrag_brutto) ohne Filter ist 0. Fuer Umsatz IMMER
zeilenart = ''umsatz'' — und das ist eine HYPOTHESE (mart.kassenjournal_zeilenart), deren Treffer
gegen den Umsatzbericht mart.kassenjournal_abgleich_monat zeigt. Fuer belastbare Umsatzzahlen
mart.umsatz_tag; das Journal fuer das, was der Umsatzbericht nicht kann: Stunde × Artikel ×
Warengruppe, Bon, Kellner, Nachlass und Storno an der Position.

Der Geschaeftstag laeuft 08:00 bis 07:59, Nachtstunden gehoeren zum Vortag; nach stunde_folge
sortieren. betrag_netto = betrag_brutto / (1 + ust/100). ist_zusatz: Beilage oder Zusatz zu
zu_position. tag_fehleingabe: an diesem Tag steckt eine Kassen-Fehleingabe in Zahlungen oder
Trinkgeld (mart.kassenjournal_fehleingabe) — solche Tage aus Zahlungssummen herausnehmen.
artikel/warengruppe/hauptgruppe aus dem Kassenstamm desselben Betriebs ueber die Nummer.';
COMMENT ON COLUMN mart.kassenjournal_position.zeilenart IS
'umsatz | zahlung | trinkgeld | statistik | nachlass | system | unbekannt — die Deutung aus
mart.kassenjournal_zeilenart() (Hypothese, 0153).';
COMMENT ON COLUMN mart.kassenjournal_position.betrag_brutto IS 'balance: Betrag brutto mit LINAs Vorzeichen.';
COMMENT ON COLUMN mart.kassenjournal_position.buchungstext IS 'LINAs Text der Zeile (Artikel, Zahlart, Nachlass).';
COMMENT ON COLUMN mart.kassenjournal_position.stunde_folge IS
'Position der Stunde im Geschaeftstag (8 Uhr = 0 … 7 Uhr = 23) — danach sortieren, nicht nach stunde.';
COMMENT ON COLUMN mart.kassenjournal_position.rabatt_id IS 'Nachlass an der Position (<> 0); der Nachlass ist im Journal KEIN eigener Finanzweg.';
COMMENT ON COLUMN mart.kassenjournal_position.stornogrund_id IS 'cancellationreason; <> 0 = storniert mit Grund.';


-- ---------------------------------------------------------------------
-- 5c. Die Bons
-- ---------------------------------------------------------------------

CREATE VIEW mart.kassenbon AS
SELECT k.geschaeftstag,
       date_trunc('month', k.geschaeftstag::timestamp)::date AS monat,
       (ARRAY['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'])
           [extract(isodow FROM k.geschaeftstag)::int]  AS wochentag,
       k.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       bs.konzept                                       AS marke,
       k.tableheader_id                                 AS bon_id,
       k.table_number                                   AS tisch,
       k.table_type                                     AS tischart,
       k.accounting_type                                AS abrechnung,
       (k.accounting_type = 'EMPTY')                    AS ohne_buchung,
       k.dokument_zeitpunkt,
       k.stunde,
       ((k.stunde + 16) % 24)::int                      AS stunde_folge,
       k.number_adults                                  AS gaeste_erwachsene,
       k.number_kids                                    AS gaeste_kinder,
       k.number_infants                                 AS gaeste_kleinkinder,
       coalesce(k.number_adults, 0) + coalesce(k.number_kids, 0)
         + coalesce(k.number_infants, 0)                AS gaeste,
       k.kellnernr,
       k.renum                                          AS rechnungsnummer,
       (k.debitor_id IS NOT NULL AND k.debitor_id <> 0) AS mit_debitor,
       (k.reservation_id IS NOT NULL AND k.reservation_id <> 0) AS mit_reservierung,
       (bs.status = 'operativ')                         AS operativ
  FROM core.kassenbon k
  JOIN core.betrieb b              ON b.betrieb_key = k.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = k.betrieb_key;

COMMENT ON VIEW mart.kassenbon IS
'Koernung: ein Bon (Tisch) der Kasse (TPAPI journaltables) — Betrieb × Geschaeftstag × Bon (0153).
Gleiche Abdeckung wie mart.kassenjournal_position: nur Betriebe mit Schluessel, nur im Horizont.
abrechnung BILL = abgerechnet, EMPTY = Tisch ohne Buchung (ohne_buchung) — wer Bons oder Gaeste je
Bon zaehlt, filtert auf abrechnung = ''BILL''. gaeste = Erwachsene + Kinder + Kleinkinder (in den
Proben fast nur Erwachsene). Der Betrag eines Bons steht nicht hier: aus
mart.kassenjournal_position ueber bon_id und zeilenart = ''umsatz'' summieren. Debitorentext und
Postleitzahl stehen bewusst nicht in mart (Plan S6).';
COMMENT ON COLUMN mart.kassenbon.dokument_zeitpunkt IS 'documentdate: wann der Bon geschrieben wurde.';
COMMENT ON COLUMN mart.kassenbon.gaeste IS 'Gaeste am Tisch laut Kasse; 0 heisst nicht eingetragen, nicht unbedingt kein Gast.';


-- ---------------------------------------------------------------------
-- 5d. Personalkosten je Tag — gegen die Kopfzahlen aus Stufe 1
-- ---------------------------------------------------------------------

CREATE VIEW mart.personalkosten_tag AS
SELECT p.geschaeftstag,
       date_trunc('month', p.geschaeftstag::timestamp)::date AS monat,
       (ARRAY['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'])
           [extract(isodow FROM p.geschaeftstag)::int]  AS wochentag,
       p.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       bs.konzept                                       AS marke,
       p.personen,
       (p.personen = 0)                                 AS tag_leer,
       p.h_brutto                                       AS arbeitsstunden,
       p.h_zuschl_25                                    AS zuschlagsstunden_25,
       p.h_zuschl_40                                    AS zuschlagsstunden_40,
       p.h_zuschl_50                                    AS zuschlagsstunden_50,
       p.brutto                                         AS bruttolohn,
       p.lohnkosten,
       s.personenstunden                                AS kopfzahl_stunden,
       s.personalkosten                                 AS lohnkosten_je_stunde_summe,
       CASE WHEN p.h_brutto > 0 AND s.personenstunden IS NOT NULL
            THEN round((s.personenstunden - p.h_brutto) / p.h_brutto * 100, 2) END
                                                        AS kopfzahl_ueber_arbeitsstunden_pct,
       u.umsatz_netto,
       CASE WHEN p.h_brutto > 0 THEN round(u.umsatz_netto / p.h_brutto, 2) END
                                                        AS umsatz_je_arbeitsstunde,
       CASE WHEN u.umsatz_netto > 0 THEN round(p.lohnkosten / u.umsatz_netto * 100, 2) END
                                                        AS lohnkostenquote_pct,
       p.geladen_am,
       (bs.status = 'operativ')                         AS operativ
  FROM core.personalkosten_tag p
  JOIN core.betrieb b                         ON b.betrieb_key = p.betrieb_key
  LEFT JOIN mart.betrieb_status bs            ON bs.betrieb_key = p.betrieb_key
  LEFT JOIN core.personalkosten_stunde_abruf s ON s.betrieb_key = p.betrieb_key
                                             AND s.geschaeftstag = p.geschaeftstag
  LEFT JOIN core.umsatzbericht_tag u          ON u.betrieb_key = p.betrieb_key
                                             AND u.geschaeftstag = p.geschaeftstag
                                             AND u.hauptsparte_key IS NULL
                                             AND u.verkaufsstelle_key IS NULL;

COMMENT ON VIEW mart.personalkosten_tag IS
'Koernung: Betrieb × Geschaeftstag — Arbeitsstunden, Zuschlagsstunden, Bruttolohn und Lohnkosten aus
LINAs Personalplanung (TPAPI personalkostenprotag, Summe ueber die Personen, 0153), daneben die Summe
der stuendlichen Kopfzahlen aus Stufe 1 (kopfzahl_stunden, mart.personal_tag) und der Tagesumsatz.
kopfzahl_ueber_arbeitsstunden_pct misst endlich die Aussage aus 0150, die Kopfzahlsumme sei eine
OBERGRENZE (Median +26 % gegen LINAs Effektivitaet): sie vergleicht mit den echten Arbeitsstunden.

Nur Betriebe mit TPAPI-Schluessel und gebuchter Team Data API (mart.tpapi_zugang_modul).
tag_leer: LINA fuehrt an dem Tag niemanden — nicht "niemand da". Lohnkosten der PERSONALPLANUNG,
NICHT die Personalkosten der BWA oder des Round Table (andere Basis, anderer Zeitpunkt) — Quoten
nicht gegeneinander vergleichen. umsatz_je_arbeitsstunde und lohnkostenquote_pct ueber Tage aus den
Summen neu rechnen, nicht mitteln.';
COMMENT ON COLUMN mart.personalkosten_tag.arbeitsstunden IS
'Summe h_brutto: Arbeitsstunden laut Personalplanung (Deutung: Brutto-Arbeitszeit; ob mit Pause, ist offen).';
COMMENT ON COLUMN mart.personalkosten_tag.kopfzahl_stunden IS
'Summe der stuendlichen Kopfzahlen aus personalkostenprostunde (Stufe 1) — wer 15 Minuten in einer
Stunde arbeitet, zaehlt dort 1. NULL, wenn der Tag dort nicht geholt ist.';
COMMENT ON COLUMN mart.personalkosten_tag.kopfzahl_ueber_arbeitsstunden_pct IS
'(kopfzahl_stunden - arbeitsstunden) in Prozent der Arbeitsstunden (Prozentzahl).';
COMMENT ON COLUMN mart.personalkosten_tag.lohnkostenquote_pct IS
'Lohnkosten in Prozent des Nettoumsatzes (Prozentzahl) — nicht die Personalquote der BWA.';


-- ---------------------------------------------------------------------
-- 5e. Prognose gegen Ist
-- ---------------------------------------------------------------------

CREATE VIEW mart.umsatzprognose_tag AS
SELECT p.geschaeftstag,
       date_trunc('month', p.geschaeftstag::timestamp)::date AS monat,
       (ARRAY['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'])
           [extract(isodow FROM p.geschaeftstag)::int]  AS wochentag,
       p.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       bs.konzept                                       AS marke,
       coalesce(p.vorab_netto, p.prognose_netto)        AS prognose_netto,
       CASE WHEN p.vorab_netto IS NOT NULL THEN 'vorab' ELSE 'nachtraeglich' END AS prognose_grundlage,
       p.vorab_netto                                    AS prognose_vorab_netto,
       p.prognose_netto                                 AS prognose_juengste_netto,
       p.erste_prognose_netto,
       u.umsatz_netto                                   AS ist_netto,
       u.umsatz_netto - coalesce(p.vorab_netto, p.prognose_netto) AS abweichung_netto,
       CASE WHEN coalesce(p.vorab_netto, p.prognose_netto) > 0 AND u.umsatz_netto IS NOT NULL
            THEN round((u.umsatz_netto - coalesce(p.vorab_netto, p.prognose_netto))
                       / coalesce(p.vorab_netto, p.prognose_netto) * 100, 2) END AS abweichung_pct,
       p.aenderungen,
       p.erstmals_am,
       p.geaendert_am,
       p.abgerufen_am,
       (p.geschaeftstag - (p.erstmals_am AT TIME ZONE core.geschaefts_zeitzone())::date) AS tage_voraus_erstmals,
       (bs.status = 'operativ')                         AS operativ
  FROM core.umsatzprognose_tag p
  JOIN core.betrieb b              ON b.betrieb_key = p.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = p.betrieb_key
  LEFT JOIN mart.umsatz_tag u      ON u.betrieb_key = p.betrieb_key
                                  AND u.geschaeftstag = p.geschaeftstag;

COMMENT ON VIEW mart.umsatzprognose_tag IS
'Koernung: Betrieb × Geschaeftstag — LINAs Umsatzprognose (netto) gegen den Nettoumsatz des Tages
(mart.umsatz_tag), 0153. LINAs Zahl, keine eigene Prognose. prognose_netto ist der letzte Wert, den
LINA VOR Beginn des Tages (08:00) nannte (prognose_grundlage = vorab); fuer Tage, die erst
nachtraeglich geholt wurden, der juengste Wert (nachtraeglich) — ob LINA ihre Prognose nach dem Tag
anpasst, ist nicht gemessen, solche Zeilen also nicht als Trefferquote der Prognose lesen.
abweichung_pct: (Ist - Prognose) in Prozent der Prognose (Prozentzahl), nicht mitteln, aus Summen
neu rechnen. tage_voraus_erstmals: wie viele Tage vor dem Tag die Prognose zum ersten Mal kam (misst,
ob LINA Zukunftstage liefert). Nur Betriebe mit TPAPI-Schluessel und Sales Data API.';
COMMENT ON COLUMN mart.umsatzprognose_tag.prognose_grundlage IS
'vorab: gesehen vor 08:00 des Tages | nachtraeglich: nur nach dem Tag gesehen (Nachladen der Historie).';
COMMENT ON COLUMN mart.umsatzprognose_tag.abweichung_netto IS 'ist_netto - prognose_netto in EUR; positiv = mehr Umsatz als prognostiziert.';


-- ---------------------------------------------------------------------
-- 5f. Kassenartikel und fixedwe gegen fixer_we (Regel 5: nur Messung)
-- ---------------------------------------------------------------------

CREATE VIEW mart.kassenartikel AS
SELECT ta.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       bs.konzept                                       AS marke,
       ta.artikelnummer,
       ta.artikel_id,
       ta.name                                          AS artikel,
       ta.aktiv,
       ta.funktion,
       ta.warengruppe,
       ta.kategorie,
       ta.hauptgruppe,
       ta.fixedwe,
       ta.quantitycontrol                               AS mengenkontrolle,
       ta.stand_am,
       (bs.status = 'operativ')                         AS operativ
  FROM core.tpapi_artikel ta
  JOIN core.betrieb b              ON b.betrieb_key = ta.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = ta.betrieb_key;

COMMENT ON VIEW mart.kassenartikel IS
'Koernung: Betrieb × Kassenartikel — der Artikelstamm der Kasse je Betrieb (TPAPI recipe), juengster
Abzug (0153), mit Warengruppe, Kategorie und Hauptgruppe aus dem Stamm desselben Betriebs. Die
Artikelnummer verbindet mit mart.kassenjournal_position.artnr. fixedwe ist LINAs Wareneinsatz je
Artikel — gemessen gegen fixer_we in mart.kassenartikel_fixedwe_abgleich, KEINE Marge und kein
Wareneinsatz im Sinne der BWA (Regel 5).';

CREATE VIEW mart.kassenartikel_fixedwe_abgleich AS
SELECT ta.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       bs.konzept                                       AS marke,
       ta.artikelnummer,
       ta.name                                          AS artikel_kasse,
       ca.name                                          AS artikel_konzern,
       ta.aktiv,
       ta.fixedwe                                       AS fixedwe_kasse,
       ca.fixer_we                                      AS fixer_we_konzern,
       ta.fixedwe - ca.fixer_we                         AS differenz,
       CASE WHEN ca.artikel_key IS NULL                       THEN 'nur kasse'
            WHEN ta.fixedwe IS NULL OR ca.fixer_we IS NULL    THEN 'ohne wert'
            WHEN abs(ta.fixedwe - ca.fixer_we) <= 0.005       THEN 'gleich'
            ELSE 'abweichend' END                       AS befund,
       ta.stand_am
  FROM core.tpapi_artikel ta
  JOIN core.betrieb b              ON b.betrieb_key = ta.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = ta.betrieb_key
  LEFT JOIN core.artikel ca        ON ca.artikelnummer = ta.artikelnummer;

COMMENT ON VIEW mart.kassenartikel_fixedwe_abgleich IS
'Messsicht (0153, Regel 5): je Betrieb und Kassenartikel LINAs fixedwe aus dem Kassenstamm (TPAPI)
gegen fixer_we aus den Konzernberichten (core.artikel, ueber die Artikelnummer). Beantwortet die
offene Frage, woher fixer_we kommt: steht befund fast ueberall auf gleich, ist es dieselbe Zahl.
befund: gleich (hoechstens 0,005 EUR) | abweichend | ohne wert | nur kasse (Nummer nicht in
core.artikel). NUR MESSUNG — keine Marge, kein Wareneinsatz der BWA, nicht in Auswertungen
verwenden. fixer_we ist eine Zahl je Artikelnummer fuer alle Betriebe, fixedwe eine je Betrieb.';


-- ---------------------------------------------------------------------
-- 5g. Die Stammpruefung: Finanzweg und Artikel — stimmen die Verweise?
--
-- Zwei Annahmen der Sichten darueber sind ungemessen: kassenjournal.finanzweg
-- ist die NUMMER im Kassenstamm (nicht die id), und kassenjournal.artnr ist
-- recipe.number. Diese Sicht zeigt beides je Betrieb und Finanzweg, nach dem
-- ersten echten Lauf lesbar.
-- ---------------------------------------------------------------------

CREATE VIEW mart.kassenjournal_finanzweg_stamm AS
WITH fw AS (
    SELECT f.betrieb_key, f.finanzweg,
           sum(f.zeilen)::bigint            AS zeilen,
           sum(f.balance)                   AS balance,
           min(f.geschaeftstag)             AS erster_tag,
           max(f.geschaeftstag)             AS letzter_tag
      FROM core.kassenjournal_finanzweg_tag f
     GROUP BY f.betrieb_key, f.finanzweg
)
SELECT fw.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       fw.finanzweg,
       fw.zeilen,
       fw.balance                                       AS betrag_brutto,
       fw.erster_tag,
       fw.letzter_tag,
       tn.name                                          AS name_kasse_nummer,
       ti.name                                          AS name_kasse_id,
       cf.name                                          AS name_bericht_97,
       cf.finanzgruppe                                  AS finanzgruppe_bericht_97,
       fk.typ                                           AS kategorie_kasse,
       mart.kassenjournal_zeilenart(fw.finanzweg, cf.finanzgruppe) AS zeilenart,
       CASE WHEN tn.name IS NULL AND ti.name IS NULL              THEN 'nicht im kassenstamm'
            WHEN cf.name IS NULL                                  THEN 'nicht in bericht 97'
            WHEN lower(tn.name) = lower(cf.name)                  THEN 'nummer trifft'
            WHEN lower(ti.name) = lower(cf.name)                  THEN 'id trifft'
            ELSE 'name weicht ab' END                   AS befund
  FROM fw
  JOIN core.betrieb b              ON b.betrieb_key = fw.betrieb_key
  LEFT JOIN core.tpapi_finanzweg tn ON tn.betrieb_key = fw.betrieb_key AND tn.nummer = fw.finanzweg
  LEFT JOIN core.tpapi_finanzweg ti ON ti.betrieb_key = fw.betrieb_key AND ti.finanzweg_id = fw.finanzweg
  LEFT JOIN core.tpapi_finanzkategorie fk ON fk.betrieb_key = tn.betrieb_key AND fk.kategorie_id = tn.kategorie_id
  LEFT JOIN core.finanzweg cf      ON cf.nummer = fw.finanzweg;

COMMENT ON VIEW mart.kassenjournal_finanzweg_stamm IS
'Pruefsicht (0153): je Betrieb und Finanzweg, der im Kassenjournal vorkommt, der Name im Kassenstamm
ueber die NUMMER und ueber die id, der Name und die Finanzgruppe aus Bericht 97 (core.finanzweg) und
die Zeilenart nach der Deutung. befund: nummer trifft (die Annahme stimmt) | id trifft (der Verweis
laeuft ueber die id — dann sind finanzweg_name und Deutung zu korrigieren) | name weicht ab | nicht
in bericht 97 (Zeilenart dann aus der festen Liste oder unbekannt) | nicht im kassenstamm.';

CREATE VIEW mart.kassenjournal_stamm_pruefung AS
WITH bm AS (
    -- Betrieb × Monat aus den geladenen Journaltagen. Ein Filter auf monat
    -- landet hier (Gruppierungsspalte) und wird unten zu einem Datumsbereich
    -- auf geschaeftstag — sonst laese "WHERE monat = …" jede Partition des
    -- Journals ganz (gemessen auf dem Klon: 0,7 s bei 5 Mio. Zeilen, linear).
    SELECT DISTINCT a.betrieb_key, date_trunc('month', a.geschaeftstag::timestamp)::date AS monat
      FROM core.tpapi_abruf a
     WHERE a.endpunkt = 'tpapi:journal'
       AND a.core_stand IS NOT NULL
)
SELECT bm.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       bm.monat,
       x.positionen_mit_artnr,
       x.artikelnummern,
       x.im_kassenstamm,
       x.in_core_artikel,
       round(100.0 * x.im_kassenstamm / nullif(x.positionen_mit_artnr, 0), 2)  AS im_kassenstamm_pct,
       round(100.0 * x.in_core_artikel / nullif(x.positionen_mit_artnr, 0), 2) AS in_core_artikel_pct,
       x.zeilen_finanzweg_ohne_stamm
  FROM bm
  JOIN core.betrieb b ON b.betrieb_key = bm.betrieb_key
  CROSS JOIN LATERAL (
        SELECT count(*) FILTER (WHERE j.artnr > 0)::bigint                                  AS positionen_mit_artnr,
               count(DISTINCT j.artnr) FILTER (WHERE j.artnr > 0)::bigint                   AS artikelnummern,
               count(*) FILTER (WHERE j.artnr > 0 AND ta.artikel_id IS NOT NULL)::bigint    AS im_kassenstamm,
               count(*) FILTER (WHERE j.artnr > 0 AND ca.artikel_key IS NOT NULL)::bigint   AS in_core_artikel,
               count(*) FILTER (WHERE j.finanzweg IS NOT NULL AND tf.finanzweg_id IS NULL)::bigint AS zeilen_finanzweg_ohne_stamm
          FROM core.kassenjournal j
          LEFT JOIN core.tpapi_artikel ta  ON ta.betrieb_key = j.betrieb_key AND ta.artikelnummer = j.artnr
          LEFT JOIN core.artikel ca        ON ca.artikelnummer = j.artnr
          LEFT JOIN core.tpapi_finanzweg tf ON tf.betrieb_key = j.betrieb_key AND tf.nummer = j.finanzweg
         WHERE j.betrieb_key = bm.betrieb_key
           AND j.geschaeftstag >= bm.monat
           AND j.geschaeftstag < (bm.monat + interval '1 month')::date
       ) x;

COMMENT ON VIEW mart.kassenjournal_stamm_pruefung IS
'Pruefsicht (0153): je Betrieb und Monat, wie viele Journalpositionen mit Artikelnummer (artnr > 0)
ihren Artikel im Kassenstamm desselben Betriebs finden (recipe.number, die Annahme) und wie viele in
core.artikel (Konzernberichte). Eine niedrige im_kassenstamm_pct heisst: der Verweis laeuft anders,
oder der Stamm ist aelter als der Monat. Immer nach monat filtern — die Sicht zaehlt das Journal.';


-- ---------------------------------------------------------------------
-- 6. Der Abgleich (S10): Journal gegen die Betriebsberichte des Scrapers
--
-- Alle Sichten sind von den GELADENEN Journaltagen getrieben
-- (core.tpapi_abruf, core_stand gesetzt) und greifen je Tag ueber die
-- Primaerschluessel in die Gegenstuecke (LATERAL) — ein Datumsfilter wandert
-- so bis in die Abrufzeilen, statt dass ganze Tabellen gruppiert werden
-- (dieselbe Lehre wie 0117). Treffer heisst: hoechstens 5 Cent Unterschied.
-- vorlaeufig: die letzten sieben Tage — LINA fuellt den Umsatzbericht noch.
-- ---------------------------------------------------------------------

CREATE VIEW mart.kassenjournal_umsatz_abgleich AS
WITH t AS (
    SELECT a.betrieb_key, a.geschaeftstag, a.zeilen AS journal_zeilen
      FROM core.tpapi_abruf a
     WHERE a.endpunkt = 'tpapi:journal'
       AND a.core_stand IS NOT NULL
), v AS (
    SELECT t.betrieb_key,
           t.geschaeftstag,
           t.journal_zeilen,
           coalesce(j.umsatz_brutto, 0)               AS umsatz_brutto,
           coalesce(j.umsatz_netto, 0)                AS umsatz_netto,
           coalesce(j.boniert_brutto, 0)              AS boniert_brutto,
           coalesce(j.nachlass_brutto, 0)             AS nachlass_brutto,
           coalesce(j.saldo, 0)                       AS saldo,
           coalesce(j.zeilen_unbekannt, 0)            AS zeilen_unbekannt,
           u.umsatz_brutto                            AS ub_brutto,
           u.umsatz_netto                             AS ub_netto,
           EXISTS (SELECT 1 FROM mart.kassenjournal_fehleingabe fe
                    WHERE fe.betrieb_key = t.betrieb_key
                      AND fe.geschaeftstag = t.geschaeftstag) AS fehleingabe
      FROM t
      LEFT JOIN LATERAL (
            SELECT sum(f.balance) FILTER (WHERE z.art = 'umsatz')            AS umsatz_brutto,
                   sum(f.netto)   FILTER (WHERE z.art = 'umsatz')            AS umsatz_netto,
                   sum(f.balance) FILTER (WHERE f.finanzweg = 1)             AS boniert_brutto,
                   sum(f.rabatt_balance) FILTER (WHERE z.art = 'umsatz')     AS nachlass_brutto,
                   sum(f.balance)                                            AS saldo,
                   sum(f.zeilen)  FILTER (WHERE z.art = 'unbekannt')         AS zeilen_unbekannt
              FROM core.kassenjournal_finanzweg_tag f
              LEFT JOIN core.finanzweg cf ON cf.nummer = f.finanzweg
              CROSS JOIN LATERAL (SELECT mart.kassenjournal_zeilenart(f.finanzweg, cf.finanzgruppe) AS art) z
             WHERE f.betrieb_key = t.betrieb_key
               AND f.geschaeftstag = t.geschaeftstag
           ) j ON true
      LEFT JOIN core.umsatzbericht_tag u
             ON u.betrieb_key = t.betrieb_key
            AND u.geschaeftstag = t.geschaeftstag
            AND u.hauptsparte_key IS NULL
            AND u.verkaufsstelle_key IS NULL
            AND u.quelle = 'umsatzbericht'
)
SELECT v.geschaeftstag,
       date_trunc('month', v.geschaeftstag::timestamp)::date AS monat,
       v.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       bs.konzept                                       AS marke,
       v.journal_zeilen,
       v.umsatz_brutto                                  AS journal_umsatz_brutto,
       v.umsatz_netto                                   AS journal_umsatz_netto,
       v.ub_brutto                                      AS umsatzbericht_brutto,
       v.ub_netto                                       AS umsatzbericht_netto,
       v.umsatz_brutto - v.ub_brutto                    AS differenz_brutto,
       v.umsatz_netto - v.ub_netto                      AS differenz_netto,
       CASE WHEN v.ub_brutto <> 0
            THEN round((v.umsatz_brutto - v.ub_brutto) / v.ub_brutto * 100, 2) END AS differenz_pct,
       CASE WHEN v.fehleingabe                                         THEN 'fehleingabe'
            WHEN v.ub_brutto IS NULL                                   THEN 'ohne umsatzbericht'
            WHEN v.umsatz_brutto = 0 AND v.ub_brutto = 0               THEN 'beide leer'
            WHEN abs(v.umsatz_brutto - v.ub_brutto) <= 0.05            THEN 'trifft'
            WHEN abs(v.umsatz_brutto - v.ub_brutto) <= 0.01 * abs(v.ub_brutto) THEN 'nah'
            ELSE 'weicht ab' END                        AS befund,
       (v.ub_netto IS NOT NULL AND abs(v.umsatz_netto - v.ub_netto) <= 0.05) AS trifft_netto,
       v.boniert_brutto                                 AS kandidat_nur_boniert,
       (v.ub_brutto IS NOT NULL AND abs(v.boniert_brutto - v.ub_brutto) <= 0.05) AS trifft_nur_boniert,
       v.umsatz_brutto - v.nachlass_brutto              AS kandidat_ohne_nachlasszeilen,
       (v.ub_brutto IS NOT NULL
        AND abs(v.umsatz_brutto - v.nachlass_brutto - v.ub_brutto) <= 0.05) AS trifft_ohne_nachlasszeilen,
       v.nachlass_brutto                                AS journal_nachlass_brutto,
       v.saldo                                          AS journal_saldo,
       v.zeilen_unbekannt,
       v.fehleingabe,
       (v.geschaeftstag >= current_date - 7)            AS vorlaeufig,
       (bs.status = 'operativ')                         AS operativ
  FROM v
  JOIN core.betrieb b              ON b.betrieb_key = v.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = v.betrieb_key;

COMMENT ON VIEW mart.kassenjournal_umsatz_abgleich IS
'Abgleich (S10, 0153): je Betrieb und geladenem Journaltag der Umsatz nach der DEUTUNG
(mart.kassenjournal_zeilenart: Summe balance der Zeilen mit zeilenart = umsatz, brutto) gegen den
Umsatzbericht (core.umsatzbericht_tag, Gesamtzeile, nur LINAs Kasse — nicht das Kassenblatt). Prueft
die Deutung: nach dem ersten echten Lauf muss befund = trifft der Normalfall sein. Daneben zwei
Kandidaten, falls nicht: kandidat_nur_boniert (nur Finanzweg 1) und kandidat_ohne_nachlasszeilen
(Deutung ohne die Zeilen mit rabatt_id) mit eigenem trifft_*. befund: trifft (hoechstens 5 Cent) |
nah (hoechstens 1 %) | weicht ab | beide leer | ohne umsatzbericht | fehleingabe (Kassen-
Fehleingabe an diesem Tag, mart.kassenjournal_fehleingabe). vorlaeufig: die letzten sieben Tage, der
Umsatzbericht kann sich noch aendern. journal_saldo muss 0 sein (Buchungsliste). Verdichtet je Monat:
mart.kassenjournal_abgleich_monat.';
COMMENT ON COLUMN mart.kassenjournal_umsatz_abgleich.zeilen_unbekannt IS
'Journalzeilen, deren Finanzweg die Deutung nicht kennt (zeilenart = unbekannt) — groesser 0 heisst:
core.finanzweg fehlt die Nummer, die Umsatzsumme kann unvollstaendig sein.';

CREATE VIEW mart.kassenjournal_finanzweg_abgleich AS
WITH t AS (
    SELECT a.betrieb_key, a.geschaeftstag
      FROM core.tpapi_abruf a
     WHERE a.endpunkt = 'tpapi:journal'
       AND a.core_stand IS NOT NULL
       AND EXISTS (SELECT 1 FROM core.finanzweg_tag q
                    WHERE q.bericht = 97 AND q.betrieb_key = a.betrieb_key
                      AND q.geschaeftstag = a.geschaeftstag AND q.zeitraum_bis = q.geschaeftstag)
)
SELECT t.geschaeftstag,
       date_trunc('month', t.geschaeftstag::timestamp)::date AS monat,
       t.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       x.finanzweg,
       coalesce(x.name_97, tf.name)                     AS finanzweg_name,
       x.finanzgruppe_97,
       mart.kassenjournal_zeilenart(x.finanzweg, x.finanzgruppe_97) AS zeilenart,
       x.journal_zeilen,
       x.journal_betrag,
       x.bericht_97_betrag,
       x.journal_betrag - x.bericht_97_betrag           AS differenz,
       CASE WHEN fe.ja                                                      THEN 'fehleingabe'
            WHEN x.journal_betrag IS NULL
             AND mart.finanzweg_art(x.finanzgruppe_97) = 'nachlass'         THEN 'nachlass an der position'
            WHEN x.journal_betrag IS NULL                                   THEN 'nur bericht 97'
            WHEN x.bericht_97_betrag IS NULL                                THEN 'nur journal'
            WHEN abs(x.journal_betrag - x.bericht_97_betrag) <= 0.05        THEN 'trifft'
            ELSE 'weicht ab' END                        AS befund
  FROM t
  CROSS JOIN LATERAL (
        SELECT coalesce(f.finanzweg, q.finanzweg_nummer) AS finanzweg,
               f.zeilen                                  AS journal_zeilen,
               f.balance                                 AS journal_betrag,
               q.betrag                                  AS bericht_97_betrag,
               q.finanzweg_name                          AS name_97,
               q.finanzgruppe                            AS finanzgruppe_97
          FROM (SELECT f.finanzweg, f.zeilen, f.balance
                  FROM core.kassenjournal_finanzweg_tag f
                 WHERE f.betrieb_key = t.betrieb_key AND f.geschaeftstag = t.geschaeftstag) f
          FULL JOIN (SELECT q.finanzweg_nummer, q.finanzweg_name, q.finanzgruppe,
                            coalesce(q.umsatz, q.umsatz_ueberlauf) AS betrag
                       FROM core.finanzweg_tag q
                      WHERE q.bericht = 97 AND q.betrieb_key = t.betrieb_key
                        AND q.geschaeftstag = t.geschaeftstag
                        AND q.zeitraum_bis = q.geschaeftstag) q
            ON q.finanzweg_nummer = f.finanzweg
       ) x
  CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM mart.kassenjournal_fehleingabe fe
                                      WHERE fe.betrieb_key = t.betrieb_key
                                        AND fe.geschaeftstag = t.geschaeftstag) AS ja) fe
  JOIN core.betrieb b              ON b.betrieb_key = t.betrieb_key
  LEFT JOIN core.tpapi_finanzweg tf ON tf.betrieb_key = t.betrieb_key AND tf.nummer = x.finanzweg;

COMMENT ON VIEW mart.kassenjournal_finanzweg_abgleich IS
'Abgleich (S10, 0153): je Betrieb, Geschaeftstag und Finanzweg die Summe des Kassenjournals gegen
Bericht 97 (Tagesabschluss, core.finanzweg_tag) — nur Tage, die in beiden Quellen stehen. Am
07.11.2026 traf das fuer Aposto Aalen jeden Finanzweg auf den Cent; das soll die Regel bleiben.
Beide Betraege mit LINAs Vorzeichen (Zahlungen negativ). befund: trifft (hoechstens 5 Cent) | weicht
ab | nur journal | nur bericht 97 | nachlass an der position (ein Nachlass-Finanzweg aus 97: im
Journal steht der Nachlass an der Position, nicht als Finanzweg — kein Fehler) | fehleingabe.';

CREATE VIEW mart.kassenbon_abgleich AS
WITH t AS (
    SELECT a.betrieb_key, a.geschaeftstag
      FROM core.tpapi_abruf a
     WHERE a.endpunkt = 'tpapi:journaltables'
       AND a.core_stand IS NOT NULL
)
SELECT t.geschaeftstag,
       date_trunc('month', t.geschaeftstag::timestamp)::date AS monat,
       t.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       k.bons                                           AS kasse_bons,
       k.bons_ohne_buchung                              AS kasse_bons_ohne_buchung,
       k.gaeste                                         AS kasse_gaeste,
       jb.bons                                          AS journal_bons,
       o.rechnungen                                     AS bericht_96_rechnungen,
       o.stornierte                                     AS bericht_96_stornierte,
       u.rechnungen                                     AS umsatzbericht_rechnungen,
       u.gaeste                                         AS umsatzbericht_gaeste,
       CASE WHEN o.rechnungen IS NULL                   THEN 'ohne bericht 96'
            WHEN k.bons = o.rechnungen                  THEN 'trifft'
            WHEN k.bons = o.rechnungen + o.stornierte   THEN 'trifft mit stornierten'
            ELSE 'weicht ab' END                        AS befund_bons,
       CASE WHEN u.gaeste IS NULL                       THEN 'ohne umsatzbericht'
            WHEN k.gaeste = u.gaeste                    THEN 'trifft'
            ELSE 'weicht ab' END                        AS befund_gaeste,
       (u.rechnungen IS NOT NULL AND k.bons = u.rechnungen) AS bons_trifft_umsatzbericht,
       (t.geschaeftstag >= current_date - 7)            AS vorlaeufig
  FROM t
  CROSS JOIN LATERAL (
        SELECT count(*) FILTER (WHERE kb.accounting_type = 'BILL')::int  AS bons,
               count(*) FILTER (WHERE kb.accounting_type = 'EMPTY')::int AS bons_ohne_buchung,
               coalesce(sum(coalesce(kb.number_adults, 0) + coalesce(kb.number_kids, 0)
                            + coalesce(kb.number_infants, 0))
                        FILTER (WHERE kb.accounting_type = 'BILL'), 0)::int AS gaeste
          FROM core.kassenbon kb
         WHERE kb.betrieb_key = t.betrieb_key AND kb.geschaeftstag = t.geschaeftstag
       ) k
  LEFT JOIN LATERAL (
        SELECT f.bons FROM core.kassenjournal_finanzweg_tag f
         WHERE f.betrieb_key = t.betrieb_key AND f.geschaeftstag = t.geschaeftstag AND f.finanzweg = 1
       ) jb ON true
  LEFT JOIN LATERAL (
        SELECT nullif(count(*) FILTER (WHERE o.art = 'Rechnung'), 0)::int AS rechnungen,
               count(*) FILTER (WHERE o.art = 'Stornierte Rechnung')::int   AS stornierte
          FROM core.bon o
         WHERE o.betrieb_key = t.betrieb_key AND o.geschaeftstag = t.geschaeftstag
       ) o ON true
  LEFT JOIN core.umsatzbericht_tag u
         ON u.betrieb_key = t.betrieb_key
        AND u.geschaeftstag = t.geschaeftstag
        AND u.hauptsparte_key IS NULL
        AND u.verkaufsstelle_key IS NULL
        AND u.quelle = 'umsatzbericht'
  JOIN core.betrieb b ON b.betrieb_key = t.betrieb_key;

COMMENT ON VIEW mart.kassenbon_abgleich IS
'Abgleich (S10, 0153): je Betrieb und geladenem Bontag die abgerechneten Bons der Kasse (TPAPI
journaltables, accounting_type BILL) und ihre Gaeste gegen das Rechnungsausgangsbuch (Bericht 96,
core.bon: Rechnungen) und gegen Rechnungen und Gaeste des Umsatzberichts; dazu die Bons mit
Boniert-Zeilen im Journal. befund_bons: trifft | trifft mit stornierten (96 zaehlt stornierte
Rechnungen getrennt) | weicht ab | ohne bericht 96 (96 fuer den Tag nicht geladen oder ohne Bon).
befund_gaeste: gegen den Umsatzbericht. Was eine Abweichung bedeutet, ist offen: ob 96 jeden Bon
der Kasse fuehrt und ob der Umsatzbericht Gaeste genauso zaehlt, ist nicht gemessen.';

CREATE VIEW mart.kassenjournal_nachlass_abgleich AS
WITH t AS (
    SELECT a.betrieb_key, a.geschaeftstag
      FROM core.tpapi_abruf a
     WHERE a.endpunkt = 'tpapi:journal'
       AND a.core_stand IS NOT NULL
)
SELECT t.geschaeftstag,
       date_trunc('month', t.geschaeftstag::timestamp)::date AS monat,
       t.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       coalesce(j.zeilen, 0)                            AS journal_nachlass_zeilen,
       coalesce(j.betrag, 0)                            AS journal_nachlass_betrag,
       q.vorgaenge                                      AS bericht_97_vorgaenge,
       q.betrag                                         AS bericht_97_betrag,
       r.artikel                                        AS bericht_92_artikel,
       r.betrag                                         AS bericht_92_betrag,
       CASE WHEN q.betrag IS NULL AND r.betrag IS NULL                    THEN 'ohne gegenstueck'
            WHEN coalesce(j.betrag, 0) = 0 AND coalesce(q.betrag, 0) = 0
             AND coalesce(r.betrag, 0) = 0                                THEN 'kein nachlass'
            WHEN q.betrag IS NOT NULL AND abs(coalesce(j.betrag, 0) - q.betrag) <= 0.05 THEN 'trifft 97'
            WHEN r.betrag IS NOT NULL AND abs(coalesce(j.betrag, 0) - r.betrag) <= 0.05 THEN 'trifft 92'
            ELSE 'weicht ab' END                        AS befund
  FROM t
  LEFT JOIN LATERAL (
        SELECT sum(f.rabatt_zeilen)::int AS zeilen, sum(f.rabatt_balance) AS betrag
          FROM core.kassenjournal_finanzweg_tag f
         WHERE f.betrieb_key = t.betrieb_key AND f.geschaeftstag = t.geschaeftstag
       ) j ON true
  LEFT JOIN LATERAL (
        SELECT sum(q.anzahl) AS vorgaenge, sum(coalesce(q.umsatz, q.umsatz_ueberlauf)) AS betrag
          FROM core.finanzweg_tag q
         WHERE q.bericht = 97 AND q.betrieb_key = t.betrieb_key
           AND q.geschaeftstag = t.geschaeftstag AND q.zeitraum_bis = q.geschaeftstag
           AND mart.finanzweg_art(q.finanzgruppe) = 'nachlass'
        HAVING count(*) > 0
       ) q ON true
  LEFT JOIN LATERAL (
        SELECT sum(r.anzahl) AS artikel, sum(r.brutto) AS betrag
          FROM core.rabatt_artikel_tag r
         WHERE r.betrieb_key = t.betrieb_key
           AND r.geschaeftstag = t.geschaeftstag AND r.zeitraum_bis = r.geschaeftstag
        HAVING count(*) > 0
       ) r ON true
  JOIN core.betrieb b ON b.betrieb_key = t.betrieb_key;

COMMENT ON VIEW mart.kassenjournal_nachlass_abgleich IS
'Abgleich (S10, 0153): je Betrieb und geladenem Journaltag die Journalzeilen mit Nachlass
(rabatt_id <> 0: Zahl und Summe balance) gegen die Nachlass-Finanzwege aus Bericht 97 (Vorgaenge,
Betrag) und den Rabattbericht 92 (Artikel, Betrag). Alle Betraege mit LINAs Vorzeichen (Nachlass
negativ). Deutung offen: ob eine Zeile mit rabatt_id der Nachlassbetrag selbst ist oder die
rabattierte Position, ist nicht gemessen — genau das zeigt befund: trifft 97 | trifft 92 | weicht ab
| kein nachlass | ohne gegenstueck (92 und 97 fuer den Tag nicht geladen). Zahlen nicht
gegeneinander addieren: 97 zaehlt Vorgaenge, 92 Artikel, das Journal Zeilen.';

CREATE VIEW mart.kassenjournal_storno_abgleich AS
WITH m AS (
    SELECT f.betrieb_key,
           date_trunc('month', f.geschaeftstag::timestamp)::date AS monat,
           count(DISTINCT f.geschaeftstag)::int                   AS tage_mit_journal,
           sum(f.zeilen)  FILTER (WHERE f.finanzweg = 10)         AS sofortstorno_zeilen,
           sum(f.balance) FILTER (WHERE f.finanzweg = 10)         AS sofortstorno_betrag,
           sum(f.storno_zeilen)                                   AS storno_grund_zeilen,
           sum(f.storno_balance)                                  AS storno_grund_betrag
      FROM core.kassenjournal_finanzweg_tag f
     GROUP BY f.betrieb_key, date_trunc('month', f.geschaeftstag::timestamp)::date
)
SELECT m.monat,
       m.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       m.tage_mit_journal,
       coalesce(m.sofortstorno_zeilen, 0)               AS journal_sofortstorno_zeilen,
       coalesce(m.sofortstorno_betrag, 0)               AS journal_sofortstorno_betrag,
       coalesce(m.storno_grund_zeilen, 0)               AS journal_storno_mit_grund_zeilen,
       coalesce(m.storno_grund_betrag, 0)               AS journal_storno_mit_grund_betrag,
       s.sofortstorno_menge                             AS bericht_39_sofortstorno_menge,
       s.sofortstorno_betrag                            AS bericht_39_sofortstorno_betrag,
       s.storno_menge                                   AS bericht_39_storno_menge,
       s.storno_betrag                                  AS bericht_39_storno_betrag,
       CASE WHEN s.monat IS NULL                                            THEN 'ohne bericht 39'
            WHEN abs(coalesce(m.sofortstorno_betrag, 0) + coalesce(m.storno_grund_betrag, 0)
                     - coalesce(s.sofortstorno_betrag, 0) - coalesce(s.storno_betrag, 0)) <= 0.05
                                                                            THEN 'trifft'
            ELSE 'weicht ab' END                        AS befund
  FROM m
  JOIN core.betrieb b ON b.betrieb_key = m.betrieb_key
  LEFT JOIN LATERAL (
        SELECT s.monat,
               sum(s.anzahl)        FILTER (WHERE s.stornotyp ILIKE 'sofort%') AS sofortstorno_menge,
               sum(s.umsatz_brutto) FILTER (WHERE s.stornotyp ILIKE 'sofort%') AS sofortstorno_betrag,
               sum(s.anzahl)        FILTER (WHERE s.stornotyp NOT ILIKE 'sofort%') AS storno_menge,
               sum(s.umsatz_brutto) FILTER (WHERE s.stornotyp NOT ILIKE 'sofort%') AS storno_betrag
          FROM core.storno_artikel_monat s
         WHERE s.betrieb_key = m.betrieb_key AND s.monat = m.monat
         GROUP BY s.monat
       ) s ON true;

COMMENT ON VIEW mart.kassenjournal_storno_abgleich IS
'Abgleich (S10, 0153): je Betrieb und Monat die Stornos im Kassenjournal (Finanzweg 10 Sofortstorno;
Zeilen mit cancellationreason <> 0 = Storno mit Grund) gegen den Stornobericht 39
(core.storno_artikel_monat, nach Stornotyp). Monatlich, weil 39 nur je Monat geholt wird. Betraege mit
LINAs Vorzeichen (negativ). tage_mit_journal: wie viele Tage des Monats im Journal stehen — ein
unvollstaendiger Monat kann nicht treffen. befund: trifft (Summe beider Stornoarten auf 5 Cent) |
weicht ab | ohne bericht 39. Deutung offen: ob ein Sofortstorno eine Zeile in Finanzweg 10 UND
eine Position mit Grund sein kann (dann zaehlte er doppelt), ist nicht gemessen.';

CREATE VIEW mart.kassenjournal_abgleich_monat AS
WITH u AS (
    SELECT betrieb_key, monat,
           count(*)::int                                                         AS tage,
           count(*) FILTER (WHERE NOT vorlaeufig AND befund IN ('trifft','nah','weicht ab'))::int AS tage_vergleichbar,
           count(*) FILTER (WHERE NOT vorlaeufig AND befund = 'trifft')::int    AS tage_trifft,
           count(*) FILTER (WHERE NOT vorlaeufig AND befund = 'nah')::int       AS tage_nah,
           count(*) FILTER (WHERE NOT vorlaeufig AND befund IN ('trifft','nah','weicht ab')
                              AND trifft_nur_boniert)::int                      AS tage_trifft_nur_boniert,
           count(*) FILTER (WHERE NOT vorlaeufig AND befund IN ('trifft','nah','weicht ab')
                              AND trifft_ohne_nachlasszeilen)::int              AS tage_trifft_ohne_nachlass,
           count(*) FILTER (WHERE NOT vorlaeufig AND befund IN ('trifft','nah','weicht ab')
                              AND trifft_netto)::int                            AS tage_trifft_netto,
           count(*) FILTER (WHERE befund = 'fehleingabe')::int                  AS tage_fehleingabe,
           count(*) FILTER (WHERE befund = 'ohne umsatzbericht')::int           AS tage_ohne_umsatzbericht,
           sum(journal_umsatz_brutto) FILTER (WHERE NOT vorlaeufig AND befund IN ('trifft','nah','weicht ab')) AS journal_brutto,
           sum(umsatzbericht_brutto)  FILTER (WHERE NOT vorlaeufig AND befund IN ('trifft','nah','weicht ab')) AS umsatzbericht_brutto,
           sum(zeilen_unbekannt)::bigint                                        AS zeilen_unbekannt
      FROM mart.kassenjournal_umsatz_abgleich
     GROUP BY betrieb_key, monat
), f AS (
    SELECT betrieb_key, monat,
           count(*) FILTER (WHERE befund IN ('trifft','weicht ab','nur journal','nur bericht 97'))::int AS finanzwege_vergleichbar,
           count(*) FILTER (WHERE befund = 'trifft')::int                       AS finanzwege_trifft
      FROM mart.kassenjournal_finanzweg_abgleich
     GROUP BY betrieb_key, monat
), k AS (
    SELECT betrieb_key, monat,
           count(*) FILTER (WHERE NOT vorlaeufig AND befund_bons <> 'ohne bericht 96')::int AS bontage_vergleichbar,
           count(*) FILTER (WHERE NOT vorlaeufig AND befund_bons LIKE 'trifft%')::int        AS bontage_trifft,
           count(*) FILTER (WHERE NOT vorlaeufig AND befund_gaeste <> 'ohne umsatzbericht')::int AS gaestetage_vergleichbar,
           count(*) FILTER (WHERE NOT vorlaeufig AND befund_gaeste = 'trifft')::int           AS gaestetage_trifft
      FROM mart.kassenbon_abgleich
     GROUP BY betrieb_key, monat
)
SELECT u.monat,
       u.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       u.tage                                           AS tage_im_journal,
       u.tage_vergleichbar,
       u.tage_trifft,
       round(100.0 * u.tage_trifft / nullif(u.tage_vergleichbar, 0), 2) AS umsatz_trifft_pct,
       u.tage_nah,
       round(100.0 * u.tage_trifft_netto / nullif(u.tage_vergleichbar, 0), 2) AS umsatz_trifft_netto_pct,
       round(100.0 * u.tage_trifft_nur_boniert / nullif(u.tage_vergleichbar, 0), 2) AS kandidat_nur_boniert_pct,
       round(100.0 * u.tage_trifft_ohne_nachlass / nullif(u.tage_vergleichbar, 0), 2) AS kandidat_ohne_nachlass_pct,
       u.journal_brutto,
       u.umsatzbericht_brutto,
       u.journal_brutto - u.umsatzbericht_brutto        AS differenz_brutto,
       u.tage_fehleingabe,
       u.tage_ohne_umsatzbericht,
       u.zeilen_unbekannt,
       f.finanzwege_vergleichbar,
       f.finanzwege_trifft,
       round(100.0 * f.finanzwege_trifft / nullif(f.finanzwege_vergleichbar, 0), 2) AS finanzwege_trifft_pct,
       k.bontage_vergleichbar,
       round(100.0 * k.bontage_trifft / nullif(k.bontage_vergleichbar, 0), 2) AS bons_trifft_pct,
       k.gaestetage_vergleichbar,
       round(100.0 * k.gaestetage_trifft / nullif(k.gaestetage_vergleichbar, 0), 2) AS gaeste_trifft_pct
  FROM u
  JOIN core.betrieb b ON b.betrieb_key = u.betrieb_key
  LEFT JOIN f ON f.betrieb_key = u.betrieb_key AND f.monat = u.monat
  LEFT JOIN k ON k.betrieb_key = u.betrieb_key AND k.monat = u.monat;

COMMENT ON VIEW mart.kassenjournal_abgleich_monat IS
'Abgleich verdichtet (S10, 0153): je Betrieb und Monat, wie oft die Deutung des Kassenjournals trifft
— der Anteil treffender Tage (Umsatz gegen Umsatzbericht, umsatz_trifft_pct; ohne die letzten
sieben Tage), die Differenz in EUR, und dieselbe Quote fuer die Kandidaten (nur Boniert, ohne
Nachlasszeilen), fuer die Finanzwege gegen Bericht 97 (Anteil treffender Finanzweg-Tage), die Bons
gegen 96 und die Gaeste gegen den Umsatzbericht. Die Zahl, an der sich entscheidet, ob die Deutung
stimmt: umsatz_trifft_pct nahe 100 bei allen Betrieben. Steht stattdessen ein Kandidat dort, ist die
Deutung in mart.kassenjournal_zeilenart() zu aendern. Immer nach monat filtern. Prozentzahlen.';


-- ---------------------------------------------------------------------
-- 7. Der Laderstand je Endpunkt
-- ---------------------------------------------------------------------

CREATE VIEW mart.tpapi_core_stand AS
WITH l AS (
    SELECT endpunkt, stand, horizont_monate, mart.tpapi_core_ab(horizont_monate) AS ab
      FROM sync.tpapi_core_lader
), z AS (
    SELECT 'tag'::text AS art, a.endpunkt, l.stand, l.ab, a.geschaeftstag,
           coalesce(a.geaendert_am, a.erstmals_am) AS roh_seit,
           a.core_geladen_am, a.core_auffaellig, a.payload_bytes,
           CASE WHEN a.core_stand = l.stand                                    THEN 'in core'
                WHEN l.ab IS NOT NULL AND a.geschaeftstag < l.ab               THEN 'ausserhalb horizont'
                WHEN a.ladefehler IS NOT NULL AND a.ladeversuche >= 3
                 AND a.ladefehler_stand = l.stand                              THEN 'ladefehler endgueltig'
                WHEN a.ladefehler IS NOT NULL                                  THEN 'ladefehler'
                ELSE 'wartend' END AS zustand
      FROM core.tpapi_abruf a
      LEFT JOIN l ON l.endpunkt = a.endpunkt
    UNION ALL
    SELECT 'stamm'::text, s.endpunkt, l.stand, NULL::date, NULL::date,
           s.abgerufen_am, s.core_geladen_am, s.core_auffaellig, s.payload_bytes,
           CASE WHEN s.core_stand = l.stand                                    THEN 'in core'
                WHEN s.ladefehler IS NOT NULL AND s.ladeversuche >= 3
                 AND s.ladefehler_stand = l.stand                              THEN 'ladefehler endgueltig'
                WHEN s.ladefehler IS NOT NULL                                  THEN 'ladefehler'
                ELSE 'wartend' END
      FROM core.tpapi_stammabzug s
      LEFT JOIN l ON l.endpunkt = s.endpunkt
)
SELECT z.art,
       z.endpunkt,
       max(z.stand)                                                   AS laderstand,
       max(z.ab)                                                      AS horizont_ab,
       count(*)::int                                                  AS roh_gesichert,
       count(*) FILTER (WHERE z.zustand = 'in core')::int             AS in_core,
       count(*) FILTER (WHERE z.zustand = 'ausserhalb horizont')::int AS ausserhalb_horizont,
       count(*) FILTER (WHERE z.zustand = 'wartend')::int             AS wartend,
       count(*) FILTER (WHERE z.zustand = 'wartend'
                          AND z.roh_seit < now() - interval '48 hours')::int AS wartend_ueber_48h,
       count(*) FILTER (WHERE z.zustand = 'ladefehler')::int          AS ladefehler,
       count(*) FILTER (WHERE z.zustand = 'ladefehler endgueltig')::int AS ladefehler_endgueltig,
       count(*) FILTER (WHERE z.core_auffaellig IS NOT NULL)::int     AS auffaellig,
       sum(z.payload_bytes) FILTER (WHERE z.zustand = 'ausserhalb horizont')::bigint AS bytes_ausserhalb_horizont,
       min(z.geschaeftstag) FILTER (WHERE z.zustand = 'in core')      AS aeltester_tag_in_core,
       max(z.geschaeftstag) FILTER (WHERE z.zustand = 'in core')      AS juengster_tag_in_core,
       max(z.core_geladen_am)                                         AS zuletzt_geladen
  FROM z
 GROUP BY z.art, z.endpunkt;

COMMENT ON VIEW mart.tpapi_core_stand IS
'TPAPI raw → core je Endpunkt (0153): wie viele Rohsaetze liegen roh gesichert (roh_gesichert), wie
viele davon stehen mit dem aktuellen Laderstand in core (in_core), wie viele liegen BEWUSST nur roh,
weil ihr Geschaeftstag vor dem Horizont liegt (ausserhalb_horizont: Journal und Bons vor
horizont_ab, TPAPI_CORE_MONATE — kein Rueckstand, eine Entscheidung), wie viele warten auf den Lader
(wartend; wartend_ueber_48h ist ein Befund), und wie viele scheiterten (ladefehler: wird wieder
versucht; ladefehler_endgueltig: drei Versuche mit diesem Laderstand, erst ein neuer Rohsatz oder
eine neue Laderversion versucht es wieder). auffaellig: geladen, aber mit unerwartetem Feld, Saldo
oder Zeitpunkt (core.tpapi_abruf.core_auffaellig). art = tag (je Betrieb und Tag) | stamm (je
Abzug: Artikelstamm und Prognose).';
COMMENT ON COLUMN mart.tpapi_core_stand.bytes_ausserhalb_horizont IS
'Groesse der Rohsaetze ausserhalb des Horizonts (JSON-Text vor Kompression) — fuer die Entscheidung,
ob der Horizont weiter werden kann.';


-- Die Befunde je Rohsatz — fuer mcp_leser, der core nicht lesen darf. Ohne
-- Inhalt der Antwort: Feldnamen und Zaehler, und die Meldung des Laders (die
-- castet nur Zahlenfelder, nie Freitext).
CREATE VIEW mart.tpapi_core_befund AS
WITH l AS (SELECT endpunkt, stand FROM sync.tpapi_core_lader)
SELECT 'tag'::text                                       AS art,
       a.endpunkt,
       a.betrieb_key,
       b.enc_id,
       b.name                                            AS betrieb,
       a.geschaeftstag,
       CASE WHEN a.ladefehler IS NOT NULL AND a.ladeversuche >= 3 AND a.ladefehler_stand = l.stand
                 THEN 'ladefehler endgueltig'
            WHEN a.ladefehler IS NOT NULL THEN 'ladefehler'
            ELSE 'auffaellig' END                        AS befund,
       a.ladefehler,
       a.ladeversuche,
       a.core_auffaellig                                 AS auffaellig,
       a.core_geladen_am,
       a.abgerufen_am
  FROM core.tpapi_abruf a
  JOIN core.betrieb b ON b.betrieb_key = a.betrieb_key
  LEFT JOIN l ON l.endpunkt = a.endpunkt
 WHERE a.ladefehler IS NOT NULL OR a.core_auffaellig IS NOT NULL
UNION ALL
SELECT 'stamm'::text, s.endpunkt, s.betrieb_key, b.enc_id, b.name, s.von,
       CASE WHEN s.ladefehler IS NOT NULL AND s.ladeversuche >= 3 AND s.ladefehler_stand = l.stand
                 THEN 'ladefehler endgueltig'
            WHEN s.ladefehler IS NOT NULL THEN 'ladefehler'
            ELSE 'auffaellig' END,
       s.ladefehler, s.ladeversuche, s.core_auffaellig, s.core_geladen_am, s.abgerufen_am
  FROM core.tpapi_stammabzug s
  JOIN core.betrieb b ON b.betrieb_key = s.betrieb_key
  LEFT JOIN l ON l.endpunkt = s.endpunkt
 WHERE s.ladefehler IS NOT NULL OR s.core_auffaellig IS NOT NULL;

COMMENT ON VIEW mart.tpapi_core_befund IS
'Je TPAPI-Rohsatz, der nicht glatt nach core kam (0153): ladefehler (wird wieder versucht) | ladefehler
endgueltig (drei Versuche mit diesem Laderstand) | auffaellig (geladen, aber mit unerwartetem Feld,
Zeitpunkt ausserhalb des Geschaeftstags, Saldo ungleich null — Schluessel in auffaellig: felder,
ausserhalb_geschaeftstag, ohne_zeitpunkt, refdate_abweichend, saldo, unbekannte_felder,
nicht_berliner_mitternacht, ausserhalb_bereich). Kein Inhalt der Antwort, nur Feldnamen und Zaehler.
Leer ist der Normalfall; die Zahl steht in mart.tpapi_core_stand und mart.pruefung_uebersicht.';


-- ---------------------------------------------------------------------
-- 7b. in_core in mart.tpapi_abruf_stand meint den AKTUELLEN Laderstand
--
-- Gleiche Spalten, gleiche Reihenfolge — nur die Zaehlung ist genauer: ein
-- Rohsatz, der mit einer alten Laderversion geladen wurde, wartet auf den
-- neuen Lader und ist nicht "in core".
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.tpapi_abruf_stand AS
SELECT 'tag'::text                                              AS art,
       a.endpunkt,
       count(DISTINCT a.betrieb_key)::int                       AS betriebe,
       count(*)::int                                            AS eintraege,
       count(*) FILTER (WHERE a.core_stand = l.stand)::int      AS in_core,
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
  LEFT JOIN sync.tpapi_core_lader l ON l.endpunkt = a.endpunkt
 GROUP BY a.endpunkt
UNION ALL
SELECT 'stamm'::text,
       s.endpunkt,
       count(DISTINCT s.betrieb_key)::int,
       count(*)::int,
       count(*) FILTER (WHERE s.core_stand = l.stand)::int,
       count(*) FILTER (WHERE s.neu)::int,
       count(*)::bigint,
       sum(s.payload_bytes) FILTER (WHERE s.neu)::bigint,
       sum(s.zeilen)::bigint,
       count(*) FILTER (WHERE s.zeilen = 0)::int,
       NULL::date,
       NULL::date,
       max(s.abgerufen_am),
       count(*) FILTER (WHERE s.ladefehler IS NOT NULL)::int
  FROM core.tpapi_stammabzug s
  LEFT JOIN sync.tpapi_core_lader l ON l.endpunkt = s.endpunkt
 GROUP BY s.endpunkt;

COMMENT ON COLUMN mart.tpapi_abruf_stand.in_core IS
'Davon mit dem aktuellen Laderstand in core (seit 0153). Journal und Bons vor dem Horizont kommen
bewusst nicht nach core — die Aufteilung steht in mart.tpapi_core_stand.';


-- ---------------------------------------------------------------------
-- 8. Personal je Stunde auf die Tiefe von listdays (Plan S3)
--
-- Die Formprobe fand personalkostenprostunde fuer Aposto Aalen am aeltesten
-- Tag aus listdays (23.10.2019). Der Horizont von 365 Tagen aus 0149 war
-- damit zu kurz. Ab hier: die Tage der juengsten listdays-Antwort UND die
-- letzten 365 Kalendertage (das Zweite, damit nichts zurueckgeht: Betriebe
-- ohne Sales Data haben keine Liste, und Ruhetage stehen nicht darin). Die
-- Spalten wie 0149, eine neue am Ende. Phase A holt weiter nur die letzten
-- TPAPI_HISTORIE_TAGE (365); den Rest laedt Phase C nach.
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
'Arbeitsliste fuer Personal je Stunde (0149, seit 0153 mit der Tiefe von listdays): je Betrieb mit
Schluessel die Geschaeftstage, die noch nie erfolgreich geholt wurden — die letzten 365 Tage und
dazu jeder aeltere Tag, den LINAs listdays fuer den Betrieb fuehrt (Aposto Aalen bis Oktober 2019).
Ein leerer Tag zaehlt als erledigt. Phase A holt davon die letzten 365 Tage (feste Grenze je
Betrieb), Phase C den Rest unter TPAPI_NACHLADEN_JE_LAUF. Die Zeilenzahl MUSS von Nacht zu Nacht
fallen und 0 erreichen. Betriebe, deren Modul nicht lizenziert ist, fehlen hier — sie stehen in
mart.tpapi_zugang.';
COMMENT ON COLUMN mart.personal_rueckstand.arbeitsliste IS
'horizont 365 (letzte 365 Tage, jeder Betrieb mit Schluessel) | listdays (aelter, nur Betriebe mit
Sales Data API, so weit listdays reicht).';
COMMENT ON COLUMN mart.tpapi_zugang.rueckstand_tage IS
'Tage, die fuer Personal je Stunde noch fehlen — Zeilen in mart.personal_rueckstand (seit 0153 bis
zur Tiefe von listdays, nicht nur 365 Tage).';

COMMENT ON VIEW mart.personal_stunde IS
'Personen und Lohnkosten je Betrieb, Geschaeftstag und Stunde aus LINAs Personalplanung (TPAPI,
0149), daneben der Nettoumsatz derselben Stunde. Nur Betriebe mit TPAPI-Schluessel — wer fehlt und
warum, sagt mart.tpapi_zugang; ein fehlender Betrieb hat nicht null Personal. Eine Stunde ohne
Zeile ist keine Stunde mit null Personen, sondern eine, die LINA nicht fuehrt. Der Geschaeftstag
laeuft 08:00 bis 07:59: "ab 18 Uhr" ist stunde >= 18 OR stunde < 8, fuer den Verlauf nach
stunde_folge sortieren. LINA liefert so weit zurueck, wie die Kasse des Betriebs reicht (bei
manchen bis 2019, seit 0153 nachgeladen; was noch fehlt, steht in mart.personal_rueckstand). Die
Lohnkosten sind die der Personalplanung, NICHT die Personalkosten der BWA — Quoten nicht gegen die
BWA vergleichen. Arbeitsstunden je Tag (statt Kopfzahlen) in mart.personalkosten_tag.';


-- ---------------------------------------------------------------------
-- 8b. Die Prognose-Historie: welche Monate noch fehlen
--
-- Je Betrieb mit Sales Data API jeder abgeschlossene Monat ab dem ersten
-- Tag in listdays, fuer den es noch keinen Abzug mit genau diesem Monat
-- gibt. Phase C holt ihn — NACH allen fehlenden Tagen von Journal, Bons und
-- Personal: die fallen hinten aus listdays heraus, die Prognose nicht, und
-- eine nachtraeglich geholte Prognose ist die schwaechere Zahl (Plan §8).
-- ---------------------------------------------------------------------

CREATE VIEW mart.umsatzprognose_rueckstand AS
WITH liste AS (
    SELECT g.betrieb_key, max(g.gesehen_am) AS liste_am
      FROM core.tpapi_geschaeftstag g
     GROUP BY g.betrieb_key
), beginn AS (
    SELECT g.betrieb_key, min(g.geschaeftstag) AS erster_tag
      FROM core.tpapi_geschaeftstag g
      JOIN liste l ON l.betrieb_key = g.betrieb_key AND g.gesehen_am = l.liste_am
     GROUP BY g.betrieb_key
), zugang AS (
    SELECT z.betrieb_key, z.enc_id, z.zustand, bg.erster_tag
      FROM sync.tpapi_zugang z
      JOIN beginn bg ON bg.betrieb_key = z.betrieb_key
     WHERE z.modul = 'revenue'
       AND z.schluessel_vorhanden
       AND z.zustand <> 'nicht_lizenziert'
)
SELECT a.betrieb_key,
       a.enc_id,
       b.name                                           AS betrieb,
       m.monat::date                                    AS monat,
       m.monat::date                                    AS von,
       (m.monat + interval '1 month - 1 day')::date     AS bis,
       a.zustand                                        AS zugang_zustand
  FROM zugang a
  JOIN core.betrieb b ON b.betrieb_key = a.betrieb_key
  CROSS JOIN LATERAL generate_series(date_trunc('month', a.erster_tag::timestamp),
                                     date_trunc('month', current_date::timestamp) - interval '1 month',
                                     interval '1 month') AS m(monat)
 WHERE NOT EXISTS (SELECT 1 FROM core.tpapi_stammabzug s
                    WHERE s.betrieb_key = a.betrieb_key
                      AND s.endpunkt = 'tpapi:getforecastperday'
                      AND s.von = m.monat::date
                      AND s.bis = (m.monat + interval '1 month - 1 day')::date);

COMMENT ON VIEW mart.umsatzprognose_rueckstand IS
'Arbeitsliste der Prognose-Historie (0153): je Betrieb mit Sales Data API jeder abgeschlossene Monat
ab dem ersten Tag in listdays, fuer den LINAs Umsatzprognose noch nicht geholt ist. Phase C holt einen
Aufruf je Monat, nach allen fehlenden Tagen von Journal, Bons und Personal. Muss auf 0 fallen.';


-- ---------------------------------------------------------------------
-- 9. Pruefuebersicht: drei Zeilen, alle koennen auf null gehen
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%tpapi_core_stand%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s UNION ALL %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        SELECT 'TPAPI: Rohsaetze im Horizont ohne core, aelter als 48 h'::text AS pruefung,
               coalesce(sum(s.roh_gesichert - s.ausserhalb_horizont), 0)::bigint AS geprueft,
               coalesce(sum(s.wartend_ueber_48h), 0)::bigint                    AS auffaellig,
               'mart.tpapi_core_stand'::text AS sicht
          FROM mart.tpapi_core_stand s
        $zweig$,
        $zweig$
        SELECT 'TPAPI: Ladefehler raw -> core'::text AS pruefung,
               coalesce(sum(s.roh_gesichert - s.ausserhalb_horizont), 0)::bigint AS geprueft,
               coalesce(sum(s.ladefehler + s.ladefehler_endgueltig), 0)::bigint AS auffaellig,
               'mart.tpapi_core_stand'::text AS sicht
          FROM mart.tpapi_core_stand s
        $zweig$,
        $zweig$
        SELECT 'TPAPI: Journal/Bons mit unerwartetem Feld, Saldo oder Zeitpunkt (14 Tage)'::text AS pruefung,
               count(*)::bigint                                              AS geprueft,
               count(*) FILTER (WHERE a.core_auffaellig IS NOT NULL)::bigint AS auffaellig,
               'mart.tpapi_core_stand'::text AS sicht
          FROM core.tpapi_abruf a
         WHERE a.endpunkt IN ('tpapi:journal', 'tpapi:journaltables')
           AND a.core_stand IS NOT NULL
           AND a.geschaeftstag >= current_date - 14
        $zweig$);

    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def NOT LIKE '%Rohsaetze im Horizont ohne core%'
       OR v_def NOT LIKE '%Ladefehler raw -> core%'
       OR v_def NOT LIKE '%Journal/Bons mit unerwartetem Feld%' THEN
        RAISE EXCEPTION '0153: mart.pruefung_uebersicht traegt nach dem Umbau nicht die erwarteten Zeilen';
    END IF;
END $aussen$;


-- ---------------------------------------------------------------------
-- 10. Die Leserolle: das Zugriffsprotokoll bleibt zu (0148)
--
-- BEFUND (12.11.2026, auf dem Klon nachgemessen): mcp.rechte_auffrischen()
-- stammt aus 0110 und vergibt der Leserolle SELECT und INSERT auf
-- mcp.zugriff samt Sequenz. 0148 hat das entzogen — und 0149, 0150 und 0151
-- haben die Funktion danach aufgerufen und es still zurueckgegeben:
-- mart.mcp_rechte_pruefung stand nach 0152 auf zwei Zeilen (mcp.zugriff,
-- mcp.zugriff_zugriff_id_seq). mcp/test/nutzung.test.ts prueft nur den Text
-- der Migrationen, nicht den Rumpf der Funktion. Neu: die Funktion vergibt
-- im Schema mcp nur noch den Katalog und entzieht zum Schluss alles, was
-- 0148 schuetzt. Der Rest des Rumpfs ist der aus 0110.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mcp.rechte_auffrischen()
RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
    EXECUTE 'CREATE ROLE mcp_leser NOLOGIN';
  END IF;

  EXECUTE 'ALTER ROLE mcp_leser SET default_transaction_read_only = on';
  EXECUTE 'ALTER ROLE mcp_leser SET statement_timeout = ''20s''';
  EXECUTE 'ALTER ROLE mcp_leser SET idle_in_transaction_session_timeout = ''30s''';
  EXECUTE 'ALTER ROLE mcp_leser SET work_mem = ''32MB''';
  EXECUTE 'ALTER ROLE mcp_leser SET search_path = mart, manual, ampel, mcp';

  EXECUTE 'REVOKE ALL ON SCHEMA public FROM mcp_leser';
  EXECUTE 'REVOKE ALL ON SCHEMA raw, part, core, sync FROM mcp_leser';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA raw, part, core, sync FROM mcp_leser';

  -- Die Auswertungsschichten: pauschal, das ist ihr Zweck.
  EXECUTE 'GRANT USAGE ON SCHEMA mart, manual, ampel, mcp TO mcp_leser';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA mart, manual, ampel TO mcp_leser';
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA mart, manual, ampel '
    'GRANT SELECT ON TABLES TO mcp_leser', current_user);

  -- Das Schema mcp: ERST ALLES ENTZIEHEN, DANN NAMENTLICH VERGEBEN — und nur
  -- den Katalog. Das Zugriffsprotokoll gehoert seit 0148 mcp_anmeldung.
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA mcp FROM mcp_leser';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA mcp FROM mcp_leser';
  EXECUTE 'GRANT SELECT ON
             mcp.sicht, mcp.achse, mcp.sicht_achse, mcp.kennzahl, mcp.fallstrick,
             mcp.sicht_katalog, mcp.koernung_fehlend, mcp.einrichtung_offen,
             mcp.sicht_gesundheit
           TO mcp_leser';
  -- Schreiben auf mcp.sicht_gesundheit NUR ueber diese Funktion (0110).
  EXECUTE 'GRANT EXECUTE ON FUNCTION mcp.gesundheit_melden(jsonb) TO mcp_leser';

  DELETE FROM mcp.einrichtung_offen WHERE punkt = 'mcp_leser';

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser' AND rolcanlogin) THEN
    INSERT INTO mcp.einrichtung_offen (punkt, meldung, behebung) VALUES (
      'mcp_leser_passwort',
      'Die Leserolle mcp_leser hat keine Anmeldung — der MCP-Server kann sich nicht verbinden.',
      'Einmal von Hand: ALTER ROLE mcp_leser LOGIN PASSWORD ''...''; danach MCP_DATABASE_URL setzen. '
      'Das Passwort gehoert NICHT ins Repository (harte Regel 2).')
    ON CONFLICT (punkt) DO NOTHING;
  ELSE
    DELETE FROM mcp.einrichtung_offen WHERE punkt = 'mcp_leser_passwort';
  END IF;

  RETURN 'mcp_leser eingerichtet';
END $$;

COMMENT ON FUNCTION mcp.rechte_auffrischen() IS
'Richtet die Leserolle mcp_leser ein: mart, manual, ampel lesbar, im Schema mcp nur der Katalog.
Seit 0153 ohne das Zugriffsprotokoll (mcp.zugriff, 0148) — der Rumpf aus 0110 gab es bei jedem Aufruf
zurueck, und 0149-0151 riefen ihn auf. mart.mcp_rechte_pruefung muss danach leer sein.';


-- ---------------------------------------------------------------------
-- 11. MCP-Katalog: Koernung, Fallstricke, Rechte, Leseprobe
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.kassenjournal_position',
     'Betrieb × Geschaeftstag × Journalzeile (TPAPI) — Buchungsliste mit Saldo null, nur mit Filter auf zeilenart summieren; nur Betriebe mit Schluessel, nur im Horizont',
     'kasse', true),
    ('mart.kassenbon',
     'Betrieb × Geschaeftstag × Bon (TPAPI journaltables) — Tisch, Gaeste, Kellner; Bons zaehlen nur mit abrechnung = BILL',
     'kasse', true),
    ('mart.personalkosten_tag',
     'Betrieb × Geschaeftstag — Arbeitsstunden, Zuschlagsstunden, Bruttolohn, Lohnkosten (TPAPI), daneben Kopfzahlstunden und Umsatz',
     'personal', true),
    ('mart.umsatzprognose_tag',
     'Betrieb × Geschaeftstag — LINAs Umsatzprognose netto gegen den Nettoumsatz',
     'umsatz', true),
    ('mart.kassenartikel',
     'Betrieb × Kassenartikel (TPAPI recipe) — Nummer, Name, Warengruppe, Hauptgruppe, fixedwe',
     'stammdaten', false),
    ('mart.kassenartikel_fixedwe_abgleich',
     'Betrieb × Kassenartikel — fixedwe der Kasse gegen fixer_we der Konzernberichte; nur Messung, keine Marge',
     'pruefung', false),
    ('mart.kassenjournal_fehleingabe',
     'Betrieb × Geschaeftstag × Finanzweg mit Kassen-Fehleingabe (Journal und Bericht 97)',
     'pruefung', false),
    ('mart.kassenjournal_finanzweg_stamm',
     'Betrieb × Finanzweg im Journal — Name im Kassenstamm ueber Nummer und id gegen Bericht 97',
     'pruefung', false),
    ('mart.kassenjournal_stamm_pruefung',
     'Betrieb × Monat — Journalpositionen mit Artikelnummer, davon im Kassenstamm und in core.artikel; nach monat filtern',
     'pruefung', false),
    ('mart.kassenjournal_umsatz_abgleich',
     'Betrieb × Geschaeftstag — Journalumsatz nach der Deutung gegen den Umsatzbericht, mit Kandidaten',
     'pruefung', false),
    ('mart.kassenjournal_finanzweg_abgleich',
     'Betrieb × Geschaeftstag × Finanzweg — Journal gegen Bericht 97',
     'pruefung', false),
    ('mart.kassenbon_abgleich',
     'Betrieb × Geschaeftstag — Bons und Gaeste der Kasse gegen Bericht 96 und den Umsatzbericht',
     'pruefung', false),
    ('mart.kassenjournal_nachlass_abgleich',
     'Betrieb × Geschaeftstag — Nachlasszeilen im Journal gegen Bericht 97 und 92',
     'pruefung', false),
    ('mart.kassenjournal_storno_abgleich',
     'Betrieb × Monat — Stornos im Journal gegen Bericht 39',
     'pruefung', false),
    ('mart.kassenjournal_abgleich_monat',
     'Betrieb × Monat — Anteil treffender Tage je Abgleich (Umsatz, Finanzwege, Bons, Gaeste); nach monat filtern',
     'pruefung', false),
    ('mart.tpapi_core_stand',
     'TPAPI-Endpunkt — roh gesichert, in core, ausserhalb Horizont, wartend, Ladefehler',
     'import', false),
    ('mart.tpapi_core_befund',
     'TPAPI-Rohsatz mit Ladefehler oder Auffaelligkeit — Betrieb × Endpunkt × Tag, leer im Normalfall',
     'import', false),
    ('mart.umsatzprognose_rueckstand',
     'Betrieb × fehlender Monat — Arbeitsliste der Prognose-Historie, muss auf 0 fallen',
     'import', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

UPDATE mcp.sicht
   SET koernung = 'Betrieb × fehlender Geschaeftstag — Arbeitsliste fuer Personal je Stunde bis zur Tiefe von listdays, muss auf 0 fallen'
 WHERE sicht = 'mart.personal_rueckstand';

-- Nur Regelarten, die mcp/src/pruefen.ts kennt (filter_noetig, zeitraum_noetig,
-- deutung, sichten_mischen) — eine unbekannte liesse den Server nicht starten.
INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle)
VALUES
  ('kassenjournal_saldo_null', 'filter_noetig', 'sperre', 'mart.kassenjournal_position',
   '{"spalte": "zeilenart", "beispiel": "zeilenart = ''umsatz''"}'::jsonb,
   'Das Kassenjournal ist eine Buchungsliste mit Saldo null: Verkaeufe positiv, Zahlungen negativ, '
   'Trinkgeld positiv, Tischuebergabe hin und zurueck. Eine Summe ueber alle Zeilen ist 0, eine '
   'Zaehlung zaehlt Zahlungen als Positionen.',
   'Immer auf zeilenart filtern: zeilenart = ''umsatz'' fuer Verkaeufe, ''zahlung'' fuer Zahlarten. '
   'Fuer Umsatz je Tag oder Monat mart.umsatz_tag nehmen.',
   '0153'),
  ('kassenjournal_deutung_hypothese_position', 'deutung', 'warnung', 'mart.kassenjournal_position', '{}'::jsonb,
   'Welche Journalzeilen Umsatz sind (zeilenart), ist eine Hypothese aus zwei Stichproben — ob sie '
   'den Umsatzbericht trifft, steht in mart.kassenjournal_abgleich_monat (umsatz_trifft_pct). '
   'Das Journal gibt es nur fuer Betriebe mit TPAPI-Schluessel und nur im Horizont '
   '(mart.tpapi_core_stand, horizont_ab); ein fehlender Betrieb oder Monat ist nicht null.',
   'Vor einer Umsatzzahl aus dem Journal in mart.kassenjournal_abgleich_monat nachsehen und die '
   'Trefferquote nennen. Fuer Stunde × Artikel und Bonfragen ist das Journal richtig, fuer Umsatzsummen '
   'mart.umsatz_tag. Fehlende Betriebe in mart.tpapi_zugang_modul (modul revenue) nachsehen und nennen.',
   '0153'),
  ('kassenjournal_ohne_zeitraum', 'zeitraum_noetig', 'sperre', 'mart.kassenjournal_position',
   '{"spalte": "geschaeftstag"}'::jsonb,
   'Das Kassenjournal hat rund 1.500 Zeilen je Betrieb und Tag, fuer zwei Jahre Dutzende Millionen. '
   'Ohne Bereich auf geschaeftstag liest die Abfrage jede Monatspartition — auch mit einem Filter '
   'auf monat, der keine Partition ausschliesst (gemessen: eine Marke und ein Monat 2,6 s ueber monat '
   'gegen 1,2 s ueber geschaeftstag bei 5 Mio. Zeilen, mit der Historie entsprechend laenger).',
   'Immer einen Bereich auf geschaeftstag setzen (geschaeftstag >= ''2026-10-01'' AND geschaeftstag < '
   '''2026-11-01''), auch wenn nach monat gruppiert wird.',
   '0153'),
  ('kassenbon_ohne_zeitraum', 'zeitraum_noetig', 'warnung', 'mart.kassenbon',
   '{"spalte": "geschaeftstag"}'::jsonb,
   'Die Bons der Kasse haben rund 200 Zeilen je Betrieb und Tag. Ohne Zeitraum liest die Abfrage alles.',
   'Immer auf geschaeftstag filtern.',
   '0153'),
  ('kassenbon_leere_tische', 'filter_noetig', 'warnung', 'mart.kassenbon',
   '{"spalte": "abrechnung", "beispiel": "abrechnung = ''BILL''"}'::jsonb,
   'Die Kasse fuehrt auch Tische ohne Buchung (abrechnung = EMPTY, in der Formprobe 26 von 190). Wer '
   'Bons oder Gaeste je Bon zaehlt, ohne sie herauszunehmen, zaehlt leere Tische mit.',
   'Fuer Bons und Gaeste je Bon: abrechnung = ''BILL''.',
   '0153'),
  ('kassenbon_nur_mit_schluessel', 'deutung', 'warnung', 'mart.kassenbon', '{}'::jsonb,
   'Bons der Kasse gibt es nur fuer Betriebe mit TPAPI-Schluessel und nur im Horizont '
   '(mart.tpapi_core_stand). Ein fehlender Betrieb hat nicht null Bons. Gaeste = 0 heisst: nicht '
   'eingetragen.',
   'Fehlende Betriebe in mart.tpapi_zugang_modul (modul revenue) nachsehen und nennen; fuer Gaeste '
   'aller Betriebe mart.umsatz_tag.',
   '0153'),
  ('kassenjournal_gegen_umsatzbericht', 'sichten_mischen', 'warnung', NULL,
   '{"a": ["mart.kassenjournal_position", "mart.kassenbon"], "b": ["mart.umsatz_tag", "mart.artikelverkauf", "mart.bon_tag", "mart.finanzweg_tag"]}'::jsonb,
   'Kassenjournal (TPAPI) und Umsatzbericht, Artikelverkauf, Bons (96) und Finanzwege (97) des '
   'Scrapers beschreiben DIESELBEN Verkaeufe aus zwei Quellen. Zusammen summiert zaehlt jede doppelt; '
   'gegeneinander gerechnet ist eine Abweichung so lange offen, bis der Abgleich sie erklaert.',
   'Nicht addieren. Fuer den Vergleich beider Quellen die Abgleichsichten nehmen '
   '(mart.kassenjournal_umsatz_abgleich, _finanzweg_abgleich, mart.kassenbon_abgleich).',
   '0153'),
  ('umsatzprognose_ist_lina', 'deutung', 'warnung', 'mart.umsatzprognose_tag', '{}'::jsonb,
   'Die Prognose ist LINAs Zahl, keine eigene. Fuer Tage, die erst nachtraeglich geholt wurden '
   '(prognose_grundlage = nachtraeglich), ist unbekannt, ob LINA sie nach dem Tag angepasst hat — '
   'eine Trefferquote daraus waere geschoent. Nur Betriebe mit TPAPI-Schluessel.',
   'Fuer die Guete der Prognose nur prognose_grundlage = ''vorab'' auswerten und das sagen; '
   'Abweichungen aus den Summen neu rechnen, nicht abweichung_pct mitteln.',
   '0153'),
  ('personalkosten_tag_nicht_bwa', 'sichten_mischen', 'warnung', NULL,
   '{"a": ["mart.personalkosten_tag"], "b": ["mart.personal_bereich_monat", "mart.round_table_monat", "mart.personalkosten"]}'::jsonb,
   'Die Lohnkosten je Tag stammen aus LINAs Personalplanung, die Personalkosten der BWA, des Round '
   'Table und des Personalkostenberichts aus anderer Basis und zu anderem Zeitpunkt. Gegeneinander '
   'gerechnet entsteht eine Zahl ohne Bedeutung.',
   'Nicht gegeneinander rechnen, Quoten nicht vergleichen. Fuer die Personalquote '
   'mart.personal_bereich_monat bzw. mart.round_table_monat nehmen.',
   '0153'),
  ('personalkosten_tag_planung', 'deutung', 'warnung', 'mart.personalkosten_tag', '{}'::jsonb,
   'Arbeitsstunden und Lohnkosten je Tag sind die der Personalplanung in LINA, nur fuer Betriebe mit '
   'TPAPI-Schluessel und Team Data API. tag_leer heisst: LINA fuehrt dort niemanden, nicht "niemand '
   'da". Ob arbeitsstunden Pausen enthalten, ist nicht gemessen.',
   'Leere Tage aus Durchschnitten herausnehmen und ihre Zahl nennen; fehlende Betriebe in '
   'mart.tpapi_zugang_modul (modul personal) nachsehen.',
   '0153'),
  ('fixedwe_keine_marge_abgleich', 'deutung', 'warnung', 'mart.kassenartikel_fixedwe_abgleich', '{}'::jsonb,
   'fixedwe und fixer_we sind hinterlegte Wareneinsaetze je Artikel, deren Pflege niemand kennt '
   '(Regel 5). Diese Sicht misst nur, ob beide dieselbe Zahl sind — sie sagt nichts ueber Marge oder '
   'echten Wareneinsatz.',
   'Keine Marge, keinen Wareneinsatz und keinen Deckungsbeitrag daraus ableiten. Fuer Einkauf und '
   'Wareneinsatz die FoodNotify-Sichten.',
   '0153'),
  ('fixedwe_keine_marge_artikel', 'deutung', 'warnung', 'mart.kassenartikel', '{}'::jsonb,
   'fixedwe ist ein in der Kasse hinterlegter Wareneinsatz je Artikel, dessen Pflege niemand kennt '
   '(Regel 5) — keine Marge, kein Wareneinsatz der BWA.',
   'fixedwe nicht fuer Margen- oder Wareneinsatzaussagen verwenden.',
   '0153')
ON CONFLICT (schluessel) DO UPDATE
   SET art = excluded.art, schwere = excluded.schwere, sicht = excluded.sicht,
       parameter = excluded.parameter, hinweis = excluded.hinweis,
       berichtigung = excluded.berichtigung, quelle = excluded.quelle;

-- Die Historie reicht jetzt so weit wie die Kasse (Plan S3).
UPDATE mcp.fallstrick
   SET hinweis = 'LINAs Schnittstelle liefert Personal je Stunde so weit zurueck, wie die Kasse des '
                 'Betriebs reicht (bei manchen bis 2019, bei anderen ein Jahr). Seit 0153 laedt das '
                 'Nachladen die aelteren Tage nach — bis es durch ist, fehlen sie; sie sind nicht null.',
       berichtigung = 'Vor einer Zeitreihe oder einem Vorjahresvergleich in mart.personal_rueckstand und '
                      'mart.tpapi_zugang (aeltester_tag, rueckstand_tage) nachsehen, ab wann die Daten '
                      'vollstaendig sind.',
       quelle = '0149, 0153'
 WHERE schluessel IN ('personal_historie_ein_jahr_stunde', 'personal_historie_ein_jahr_tag');

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

SELECT mcp.rechte_auffrischen();

-- Was 0148 schuetzt, ausdruecklich noch einmal entziehen — die Funktion oben
-- tut es nicht mehr, aber 0149-0151 haben es auf jeder Datenbank vergeben.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
    EXECUTE 'REVOKE ALL ON mcp.zugriff FROM mcp_leser';
    EXECUTE 'REVOKE ALL ON SEQUENCE mcp.zugriff_zugriff_id_seq FROM mcp_leser';
    IF to_regclass('mcp.nutzung_tag') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON mcp.nutzung_tag, mcp.wiederholte_fragen, mcp.anmeldung_tag,
                             mcp.nutzer_aktivitaet FROM mcp_leser';
    END IF;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO mcp.einrichtung_offen (punkt, meldung, behebung) VALUES (
    'mcp_nutzung_rechte',
    'Die Rechte aus 0148 sind nicht gesetzt: mcp_leser liest womoeglich das Zugriffsprotokoll.',
    'Als Administrator die Rechte-Bloecke aus migrations/0153_tpapi_core.sql ausfuehren, danach diese '
    'Zeile loeschen. SELECT * FROM mart.mcp_rechte_pruefung muss leer sein.')
  ON CONFLICT (punkt) DO NOTHING;
END $$;

-- Die Gegenprobe als Leserolle (Pflicht seit 0110): SELECT * … LIMIT 1, nicht
-- count(*) — der wertet die Spaltenausdruecke nicht aus. Und die
-- Rechtepruefung aus 0148 muss danach leer sein.
DO $probe$
DECLARE
    v_abfrage text;
    v_liegen  text[] := '{}';
    v_rechte  int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0153 ist uebersprungen';
        RETURN;
    END IF;

    SELECT count(*) INTO v_rechte FROM mart.mcp_rechte_pruefung;
    IF v_rechte > 0 THEN
        RAISE EXCEPTION '0153: mart.mcp_rechte_pruefung ist nicht leer (% Zeilen) — die Leserolle sieht das Zugriffsprotokoll', v_rechte;
    END IF;

    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0153 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_abfrage IN ARRAY ARRAY[
        'SELECT * FROM mart.kassenjournal_position WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.kassenbon WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.personalkosten_tag WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.umsatzprognose_tag WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.kassenartikel LIMIT 1',
        'SELECT * FROM mart.kassenartikel_fixedwe_abgleich LIMIT 1',
        'SELECT * FROM mart.kassenjournal_fehleingabe LIMIT 1',
        'SELECT * FROM mart.kassenjournal_finanzweg_stamm LIMIT 1',
        'SELECT * FROM mart.kassenjournal_stamm_pruefung WHERE monat = date_trunc(''month'', current_date)::date LIMIT 1',
        'SELECT * FROM mart.kassenjournal_umsatz_abgleich WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.kassenjournal_finanzweg_abgleich WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.kassenbon_abgleich WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.kassenjournal_nachlass_abgleich WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.kassenjournal_storno_abgleich LIMIT 1',
        'SELECT * FROM mart.kassenjournal_abgleich_monat WHERE monat = date_trunc(''month'', current_date)::date LIMIT 1',
        'SELECT * FROM mart.tpapi_core_stand LIMIT 1',
        'SELECT * FROM mart.tpapi_core_befund LIMIT 1',
        'SELECT * FROM mart.tpapi_abruf_stand LIMIT 1',
        'SELECT * FROM mart.umsatzprognose_rueckstand LIMIT 1',
        'SELECT * FROM mart.personal_rueckstand LIMIT 1',
        'SELECT * FROM mart.tpapi_zugang LIMIT 1',
        'SELECT * FROM mart.pruefung_uebersicht WHERE sicht = ''mart.tpapi_core_stand''']
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
        RAISE EXCEPTION '0153 hat sein Ziel nicht erreicht — fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
