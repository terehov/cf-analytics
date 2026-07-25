-- =====================================================================
-- Concept Family Analytics — Basisschema
-- Quelle: LINA TeamCloud (app.lina.de), siehe phase1/lina-api-inventory.md
-- Zielplattform: PostgreSQL 18, Dokploy Managed Database
--
-- NAMENSKONVENTION
--   Fachbegriffe kommen aus LINA und bleiben deutsch: Betrieb, Konzept,
--   Umsatz, Wareneinsatz, BWA, Ampel, Hauptsparte, Verkaufsstelle. Wo LINA
--   einen Bericht so nennt, heisst die Tabelle auch so (umsatzbericht_tag,
--   personalkosten, kennzahlen_monat). Damit ist die Zuordnung zwischen
--   Endpunkt und Tabelle ohne Uebersetzungsschritt lesbar - und genau da
--   entstehen sonst die Fehler.
--
--   Englisch bleiben ausschliesslich die Schichtnamen (raw, core, manual,
--   sync, mart). Das sind Architekturbegriffe, keine LINA-Begriffe.
--
-- WEITERE KONVENTIONEN
--   * Prozentwerte IMMER als Prozentzahl (23.64), NIE als Bruch (0.2364).
--     Das Excel speichert Brueche, LINA liefert Prozent - hier gilt Prozent.
--   * Geldbetraege numeric(14,2), niemals float.
--   * Zeitpunkte timestamptz (intern UTC). Geschaeftsdaten als date, ohne
--     Zeitzone - siehe 0002_zeit.sql.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS manual;
CREATE SCHEMA IF NOT EXISTS ampel;
CREATE SCHEMA IF NOT EXISTS sync;
CREATE SCHEMA IF NOT EXISTS mart;

COMMENT ON SCHEMA raw    IS 'Unveraenderte API-Antworten aus LINA. Append-only, niemals UPDATE/DELETE. Versicherung gegen Schemaaenderungen: bei Bedarf wird von hier neu transformiert.';
COMMENT ON SCHEMA core   IS 'Stammdaten und Bewegungsdaten, aus raw abgeleitet. Darf jederzeit neu aufgebaut werden. Tabellen heissen wie die LINA-Berichte, aus denen sie stammen.';
COMMENT ON SCHEMA manual IS 'Daten ohne Quelle in LINA: OM-Einschaetzung, Ursachen, Massnahmen, Online-Bewertungen (YEXT).';
COMMENT ON SCHEMA ampel  IS 'Ampel-Regelwerke. Bewusst datengetrieben, damit globale und betriebsindividuelle Schwellen umschaltbar sind.';
COMMENT ON SCHEMA sync   IS 'Betriebszustand des Importers. Bewusst flach und lesbar, damit man ihn in Postico direkt pruefen kann.';
COMMENT ON SCHEMA mart   IS 'Sichten fuer Metabase. Erst materialisieren, wenn eine Abfrage messbar zu langsam ist.';


-- =====================================================================
-- RAW — eine Zeile je LINA-Aufruf
-- =====================================================================

CREATE TABLE raw.api_antwort (
    id              bigint GENERATED ALWAYS AS IDENTITY,
    quelle          text        NOT NULL DEFAULT 'lina',
    endpunkt        text        NOT NULL,
    betrieb_enc_id  text,
    zeitraum_von    date,
    zeitraum_bis    date,
    parameter       jsonb       NOT NULL,
    http_status     integer     NOT NULL,
    payload         jsonb,
    payload_hash    text        NOT NULL,
    payload_bytes   integer     NOT NULL,
    abgerufen_am    timestamptz NOT NULL DEFAULT now(),
    lauf_id         bigint,
    PRIMARY KEY (id, abgerufen_am)
) PARTITION BY RANGE (abgerufen_am);

COMMENT ON TABLE  raw.api_antwort               IS 'Eine Zeile je LINA-Aufruf. Monatlich partitioniert.';
COMMENT ON COLUMN raw.api_antwort.endpunkt      IS 'z.B. getUmsatzbericht, getKennzahlen, getReport:38 - wortwoertlich wie LINA den Endpunkt nennt.';
COMMENT ON COLUMN raw.api_antwort.betrieb_enc_id IS 'Nur bei Betriebs-Reports (/finanzen/...). Bei Konzern-Reports NULL, weil die Antwort alle 141 Betriebe enthaelt.';
COMMENT ON COLUMN raw.api_antwort.parameter     IS 'Die tatsaechlich gesendeten Query-Parameter. Macht jeden Aufruf reproduzierbar.';
COMMENT ON COLUMN raw.api_antwort.payload_hash  IS 'sha256 der Antwort. Gleicher Hash = fachlich nichts geaendert. Spart Transformationsarbeit und macht BWA-Nachbuchungen sichtbar.';
COMMENT ON COLUMN raw.api_antwort.http_status   IS 'ACHTUNG: LINA liefert 500 mit leerem Body, wenn ein Betrieb fuer diesen Bericht keine Daten hat. Kein Retry-Fall.';

CREATE INDEX ON raw.api_antwort (endpunkt, zeitraum_von, abgerufen_am DESC);
CREATE INDEX ON raw.api_antwort (betrieb_enc_id, endpunkt, abgerufen_am DESC) WHERE betrieb_enc_id IS NOT NULL;


-- =====================================================================
-- CORE — Stammdaten
-- =====================================================================

CREATE TABLE core.betrieb (
    betrieb_key     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enc_id          text        NOT NULL UNIQUE,
    lina_betrieb_id integer,
    name            text        NOT NULL,
    stadt           text,
    aktiv           boolean     NOT NULL DEFAULT true,
    hat_bwa         boolean     NOT NULL DEFAULT false,
    erstmals_am     timestamptz NOT NULL DEFAULT now(),
    zuletzt_am      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE  core.betrieb                 IS '141 Betriebe aus LINA.';
COMMENT ON COLUMN core.betrieb.enc_id          IS 'LINAs encId. Join-Key ueber ALLE Report-Endpunkte und zugleich der storeId-Parameter der Betriebs-Reports.';
COMMENT ON COLUMN core.betrieb.lina_betrieb_id IS 'Numerische ID aus analyticsFilterOptions.betriebe bzw. getKennzahlen children[].key.';
COMMENT ON COLUMN core.betrieb.hat_bwa         IS 'Nur ca. 66 der 131 Einheiten haben ueberhaupt BWA-Daten. Der Rest sind geschlossene Betriebe und Beteiligungsgesellschaften. Verhindert Fehlalarme.';

CREATE TABLE core.konzept (
    konzept_key     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lina_gruppen_id integer     NOT NULL UNIQUE,
    name            text        NOT NULL
);
COMMENT ON TABLE core.konzept IS 'Konzepte/Marken aus analyticsFilterOptions.gruppen (14 Stueck: Enchilada, Besitos, Lehners, Aposto, ...). LINA nennt sie im Filter "Konzepte", in der API "gruppen".';

CREATE TABLE core.betrieb_konzept (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    konzept_key     integer NOT NULL REFERENCES core.konzept(konzept_key),
    PRIMARY KEY (betrieb_key, konzept_key)
);
COMMENT ON TABLE core.betrieb_konzept IS 'Zuordnung. Ein Betrieb kann in MEHREREN Konzepten auftauchen (Karlsruhe existiert als Enchilada, Aposto, Lehners, Besitos und Wilma Wunder) - deshalb eigene Tabelle statt Spalte in core.betrieb.';

CREATE TABLE core.hauptsparte (
    hauptsparte_key integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pos_id          integer NOT NULL UNIQUE,
    nummer          integer,
    name            text    NOT NULL
);
COMMENT ON COLUMN core.hauptsparte.pos_id IS 'ACHTUNG: der Query-Parameter hauptsparten erwartet posId (10001=Speisen, 10002=Getraenke), NICHT nummer. Mit nummer kommt kommentarlos 0 EUR zurueck.';

CREATE TABLE core.verkaufsstelle (
    verkaufsstelle_key integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nummer          integer NOT NULL UNIQUE,
    name            text    NOT NULL
);

CREATE TABLE core.artikel (
    artikel_key     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    artikelnummer   bigint      NOT NULL UNIQUE,
    name            text        NOT NULL,
    fixer_we        numeric(12,4),
    zuletzt_am      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN core.artikel.fixer_we IS 'LINAs fixed_we aus getArtikelverkaufsbericht.columns[]: hinterlegter Wareneinsatz je Artikel. Ergebnis der LINA-Rezepturkalkulation - macht die Rezepturaufloesung fuer den theoretischen Wareneinsatz entbehrlich.';

CREATE TABLE core.zeitzone (
    zeitzone_key    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lina_id         integer NOT NULL UNIQUE,
    name            text    NOT NULL,
    minute_von      integer NOT NULL,
    minute_bis      integer NOT NULL
);
COMMENT ON TABLE core.zeitzone IS 'Vordefinierte Zeitzonen aus getVordefinierteZeitzonenBericht. minute_von/bis sind Minuten seit Mitternacht (690 = 11:30). "Late Night" laeuft ueber Mitternacht (1320 -> 60).';


-- =====================================================================
-- CORE — Bewegungsdaten, benannt nach dem LINA-Bericht
-- =====================================================================

-- getUmsatzbericht
CREATE TABLE core.umsatzbericht_tag (
    betrieb_key         integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag       date    NOT NULL,
    hauptsparte_key     integer REFERENCES core.hauptsparte(hauptsparte_key),
    verkaufsstelle_key  integer REFERENCES core.verkaufsstelle(verkaufsstelle_key),
    umsatz_netto        numeric(14,2),
    umsatz_brutto       numeric(14,2),
    rechnungen          integer,
    gaeste              integer,
    durchschnittsbon    numeric(10,2),
    umsatz_pro_gast     numeric(10,2),
    raw_id              bigint,
    geladen_am          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT umsatzbericht_tag_uq
        UNIQUE NULLS NOT DISTINCT (betrieb_key, geschaeftstag, hauptsparte_key, verkaufsstelle_key)
);
COMMENT ON TABLE  core.umsatzbericht_tag IS 'Aus getUmsatzbericht. NULL in hauptsparte_key/verkaufsstelle_key = Gesamtwert ohne Filter. NULLS NOT DISTINCT macht diese NULLs eindeutig - sonst liesse sich derselbe Gesamtwert mehrfach einfuegen.';
COMMENT ON COLUMN core.umsatzbericht_tag.durchschnittsbon IS 'LINAs avgTicket. Kommt fertig berechnet - nicht selbst aus umsatz/rechnungen rechnen, das weicht bei Nullwerten ab.';
COMMENT ON COLUMN core.umsatzbericht_tag.umsatz_pro_gast  IS 'LINAs avgGuest.';

CREATE INDEX ON core.umsatzbericht_tag USING brin (geschaeftstag) WITH (autosummarize = on);

-- getZeitzonenbericht
CREATE TABLE core.zeitzonenbericht_stunde (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag   date    NOT NULL,
    stunde          smallint NOT NULL CHECK (stunde BETWEEN 0 AND 23),
    umsatz_netto    numeric(14,2),
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, geschaeftstag, stunde)
);
COMMENT ON TABLE core.zeitzonenbericht_stunde IS 'Aus getZeitzonenbericht. Der Geschaeftstag laeuft 08:00 bis 07:59 des Folgetags - die Stunden 0-7 gehoeren fachlich zum Vortag. geschaeftstag ist bereits umgerechnet, nicht das Kalenderdatum.';

-- getVordefinierteZeitzonenBericht
CREATE TABLE core.zeitzonenbericht_zone (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag   date    NOT NULL,
    zeitzone_key    integer NOT NULL REFERENCES core.zeitzone(zeitzone_key),
    umsatz_netto    numeric(14,2),
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, geschaeftstag, zeitzone_key)
);

-- getArtikelverkaufsbericht — die groesste Tabelle, ca. 56.000 Zeilen/Tag
CREATE TABLE core.artikelverkauf_tag (
    betrieb_key     integer NOT NULL,
    geschaeftstag   date    NOT NULL,
    artikel_key     integer NOT NULL,
    menge           numeric(12,3),
    umsatz_netto    numeric(14,2),
    umsatz_brutto   numeric(14,2),
    verkaufspreis   numeric(12,4),
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (geschaeftstag, betrieb_key, artikel_key)
) PARTITION BY RANGE (geschaeftstag);

COMMENT ON TABLE core.artikelverkauf_tag IS
'Aus getArtikelverkaufsbericht (groesste Response, ca. 2 MB fuer alle Betriebe).
Monatlich partitioniert, PK beginnt mit geschaeftstag fuer Partition Pruning.
Bewusst KEIN eigener Index auf betrieb_key: dank Skip Scan (PG 18) und nur ~30
verschiedenen Tagen je Partitionsindex nutzt der Planer dafuer den PK. Spart
Schreiblast beim Backfill.';

-- getPersonalkosten
CREATE TABLE core.personalkosten (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    zeitraum_von    date    NOT NULL,
    zeitraum_bis    date    NOT NULL,
    eff_service     numeric(10,2),
    eff_bar         numeric(10,2),
    eff_kueche      numeric(10,2),
    eff_gesamt      numeric(10,2),
    pek_service     numeric(6,2),
    pek_bar         numeric(6,2),
    pek_kueche      numeric(6,2),
    pek_gesamt      numeric(6,2),
    persoog_bwa     numeric(6,2),
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, zeitraum_von, zeitraum_bis)
);
COMMENT ON TABLE  core.personalkosten IS 'Aus getPersonalkosten. Spaltennamen wie in LINAs Antwort. Alle pek_*/persoog_* sind Prozentzahlen (37.21 = 37,21 %), alle eff_* sind Effektivitaeten.';
COMMENT ON COLUMN core.personalkosten.persoog_bwa IS 'LINAs persoogBwa: Personalkosten ohne GF laut BWA, in Prozent. Entspricht der Excel-Spalte "Personal-kosten o. GF %".';

-- Betriebsindividuelle Ampelschwellen, die LINA in getPersonalkosten mitliefert
CREATE TABLE core.schwellenwert_betrieb (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    gueltig_ab      date    NOT NULL,
    bereich         text    NOT NULL,
    schwelle_gruen  numeric(10,2),
    schwelle_orange numeric(10,2),
    schwelle_rot    numeric(10,2),
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, gueltig_ab, bereich)
);
COMMENT ON TABLE core.schwellenwert_betrieb IS 'Aus getPersonalkosten: pekThreshold [gruen, orange, rot] und thresholds je Bereich. LINA pflegt diese Schwellen PRO BETRIEB (z.B. 29/35 statt global 28/32).';

-- getKennzahlen (BWA) — append-only, weil der Steuerberater rueckwirkend nachbucht
CREATE TABLE core.kennzahlen_monat (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    kennzahl        text    NOT NULL,
    wert_absolut    numeric(14,2),
    wert_prozent    numeric(8,2),
    abgerufen_am    timestamptz NOT NULL,
    raw_id          bigint,
    PRIMARY KEY (betrieb_key, monat, kennzahl, abgerufen_am)
);
COMMENT ON TABLE  core.kennzahlen_monat IS
'Aus getKennzahlen, BEIDE Modi in einer Zeile: mode=absolut -> wert_absolut, mode=relativ -> wert_prozent.
APPEND-ONLY: die BWA kommt per Import vom Steuerberater und wird rueckwirkend korrigiert. abgerufen_am
gehoert deshalb in den Primaerschluessel - so bleibt rekonstruierbar, welcher Stand einem Round Table
zugrunde lag. Genau dafuer wird heute das Excel-Blatt "Ampelhistorie" von Hand gepflegt.';
COMMENT ON COLUMN core.kennzahlen_monat.kennzahl     IS 'Wortwoertlich wie LINA liefert: Umsatz | EBIT | WE Bar | WE Küche | Personalkosten ohne GF';
COMMENT ON COLUMN core.kennzahlen_monat.monat        IS 'Immer der Monatserste.';
COMMENT ON COLUMN core.kennzahlen_monat.wert_prozent IS 'Prozent vom BWA-Umsatzkonto, direkt aus mode=relativ. NICHT selbst aus den POS-Hauptsparten rechnen - das ergibt nachweislich falsche Werte (45,90 statt 23,64).';

CREATE INDEX ON core.kennzahlen_monat (betrieb_key, monat, kennzahl, abgerufen_am DESC);

-- Buchungsstand: trennt "hat nie BWA" von "Monat noch nicht gebucht"
CREATE TABLE core.bwa_buchungsstand (
    betrieb_key         integer NOT NULL REFERENCES core.betrieb(betrieb_key) PRIMARY KEY,
    letzter_monat       date,
    geprueft_am         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.bwa_buchungsstand IS 'Fuer die Plausibilitaetspruefung. Alarm nur, wenn ein Betrieb, der bisher lieferte, zurueckfaellt - nicht bei genereller Nullquote. Am 25.07.2026 waren fuer Juni erst 22 von 131 Betrieben gebucht, fuer Mai 59.';


-- =====================================================================
-- MANUAL — was es in LINA nicht gibt
-- =====================================================================

CREATE TABLE manual.online_bewertung (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    bewertung       numeric(3,2),
    anzahl          integer,
    quelle          text    NOT NULL DEFAULT 'yext',
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, quelle)
);
COMMENT ON TABLE manual.online_bewertung IS 'Online-Bewertungen. Quelle YEXT, eigener Sync-Job mit eigenem Rhythmus.';

CREATE TABLE manual.betrieb_fremd_id (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    system          text    NOT NULL,
    fremd_id        text    NOT NULL,
    PRIMARY KEY (betrieb_key, system)
);
COMMENT ON TABLE manual.betrieb_fremd_id IS 'Zuordnung LINA-Betrieb zu externen Systemen (YEXT-Location, spaeter openTable, Bounti). Namen matchen NICHT zuverlaessig, deshalb explizit gepflegt.';

CREATE TABLE manual.om_einschaetzung (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    om_score        smallint CHECK (om_score BETWEEN 1 AND 5),
    erfasst_von     text,
    notiz           text,
    erfasst_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat)
);
COMMENT ON TABLE manual.om_einschaetzung IS 'Vor-Ort-Einschaetzung des Operations Managers, 1-5. Rein subjektiv, kein LINA-Pendant.';

CREATE TABLE manual.ursache_katalog (
    ursache_code    text    PRIMARY KEY,
    bezeichnung     text    NOT NULL,
    reihenfolge     integer NOT NULL
);
COMMENT ON TABLE manual.ursache_katalog IS 'Die 21 Ursachen aus dem Dropdown des Excel-Blatts "Regeln".';

CREATE TABLE manual.ursache (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    bereich         text    NOT NULL,
    ursache_code    text    REFERENCES manual.ursache_katalog(ursache_code),
    notiz           text,
    erfasst_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, bereich)
);

CREATE TABLE manual.massnahme (
    massnahme_id    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    bereich         text,
    ursache_code    text REFERENCES manual.ursache_katalog(ursache_code),
    massnahme       text    NOT NULL,
    verantwortlich  text,
    faellig_am      date,
    status          text    NOT NULL DEFAULT 'Offen'
                    CHECK (status IN ('Offen','In Arbeit','Erledigt','Eskalieren','Wartet auf Rückmeldung')),
    prioritaet      text    CHECK (prioritaet IN ('Hoch','Mittel','Niedrig')),
    fortschritt     smallint CHECK (fortschritt BETWEEN 0 AND 100),
    notizen         text,
    erstellt_am     timestamptz NOT NULL DEFAULT now(),
    geaendert_am    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE manual.massnahme IS 'Massnahmen-Tracking, ersetzt das Excel-Blatt "Massnahmen". Spalten und Statuswerte wortwoertlich von dort. Metabase kann nicht schreiben - v1 per CSV-Upload, spaeter kleine Eingabemaske.';


-- =====================================================================
-- AMPEL — Regelwerke, bewusst datengetrieben
-- =====================================================================

CREATE TABLE ampel.regelwerk (
    regelwerk_key   text    PRIMARY KEY,
    name            text    NOT NULL,
    beschreibung    text,
    ist_standard    boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX regelwerk_ein_standard ON ampel.regelwerk (ist_standard) WHERE ist_standard;

CREATE TABLE ampel.regel (
    regelwerk_key   text    NOT NULL REFERENCES ampel.regelwerk(regelwerk_key),
    bereich         text    NOT NULL,
    richtung        text    NOT NULL CHECK (richtung IN ('hoeher_ist_besser','niedriger_ist_besser')),
    schwellenquelle text    NOT NULL DEFAULT 'fest'
                    CHECK (schwellenquelle IN ('fest','lina_betrieb')),
    schwelle_gruen  numeric(10,2),
    schwelle_orange numeric(10,2),
    hinweis         text,
    PRIMARY KEY (regelwerk_key, bereich)
);
COMMENT ON TABLE  ampel.regel                 IS 'Eine Regel je Bereich und Regelwerk.';
COMMENT ON COLUMN ampel.regel.schwellenquelle IS 'fest = feste Schwellen aus diesem Datensatz. lina_betrieb = Schwellen je Betrieb aus core.schwellenwert_betrieb. So sind global und betriebsindividuell umschaltbar, ohne Code zu aendern.';
COMMENT ON COLUMN ampel.regel.richtung        IS 'hoeher_ist_besser: Umsatz, Bewertung, OM. niedriger_ist_besser: Personalkosten, Wareneinsatz.';

-- Anzeigebeschriftung. Gespeichert wird der schlanke Schluessel, angezeigt
-- die Schreibweise aus dem Excel - damit steht die Zuordnung in Daten und
-- nicht in Metabase-Formeln.
CREATE TABLE ampel.beschriftung (
    status          text PRIMARY KEY CHECK (status IN ('rot','orange','gruen')),
    bezeichnung     text NOT NULL,
    emoji           text NOT NULL,
    reihenfolge     smallint NOT NULL
);


-- =====================================================================
-- SYNC — Betriebszustand, bewusst in Postico lesbar
-- =====================================================================

CREATE TABLE sync.lauf (
    lauf_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gestartet_am    timestamptz NOT NULL DEFAULT now(),
    beendet_am      timestamptz,
    ausloeser       text NOT NULL CHECK (ausloeser IN ('zeitplan','manuell','backfill')),
    status          text NOT NULL DEFAULT 'laeuft'
                    CHECK (status IN ('laeuft','ok','teilweise','fehlgeschlagen','abgebrochen')),
    aufgaben_gesamt integer NOT NULL DEFAULT 0,
    aufgaben_ok     integer NOT NULL DEFAULT 0,
    aufgaben_fehler integer NOT NULL DEFAULT 0,
    aufgaben_uebersprungen integer NOT NULL DEFAULT 0,
    notiz           text
);

CREATE TABLE sync.aufgabe (
    aufgabe_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lauf_id         bigint  NOT NULL REFERENCES sync.lauf(lauf_id),
    endpunkt        text    NOT NULL,
    betrieb_enc_id  text,
    zeitraum_von    date,
    zeitraum_bis    date,
    versuch         smallint NOT NULL DEFAULT 1,
    status          text    NOT NULL CHECK (status IN ('ok','keine_daten','fehler','uebersprungen')),
    http_status     integer,
    zeilen          integer,
    dauer_ms        integer,
    wartezeit_ms    integer,
    fehler          text,
    beendet_am      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN sync.aufgabe.status       IS 'keine_daten ist ein NORMALZUSTAND: LINA antwortet mit HTTP 500 und leerem Body, wenn ein Betrieb fuer diesen Bericht keine Daten hat. Kein Retry.';
COMMENT ON COLUMN sync.aufgabe.wartezeit_ms IS 'Tatsaechlich gewartete Zeit vor diesem Request. Macht die Drosselung im Nachhinein pruefbar.';

CREATE INDEX ON sync.aufgabe (lauf_id, status);
CREATE INDEX ON sync.aufgabe (endpunkt, betrieb_enc_id, beendet_am DESC);

CREATE TABLE sync.fortschritt (
    endpunkt            text NOT NULL,
    betrieb_enc_id      text NOT NULL DEFAULT '',
    letzter_zeitraum    date,
    letzter_erfolg_am   timestamptz,
    fehler_in_folge     smallint NOT NULL DEFAULT 0,
    pausiert_bis        timestamptz,
    PRIMARY KEY (endpunkt, betrieb_enc_id)
);
COMMENT ON TABLE  sync.fortschritt              IS 'Wo steht der Importer? Der Zustand liegt bewusst in der Datenbank und nicht im Container - ein Absturz kostet damit nichts.';
COMMENT ON COLUMN sync.fortschritt.pausiert_bis IS 'Selbstdrosselung: nach wiederholten Fehlern pausiert der Importer diese Kombination, statt stur weiterzulaufen.';

CREATE TABLE sync.schema_abweichung (
    abweichung_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    endpunkt        text        NOT NULL,
    erkannt_am      timestamptz NOT NULL DEFAULT now(),
    erwartet        jsonb,
    tatsaechlich    jsonb,
    quittiert_am    timestamptz
);
COMMENT ON TABLE sync.schema_abweichung IS 'LINAs API ist undokumentiert und unversioniert. Jede Antwort wird gegen ein zod-Schema geprueft; Abweichungen landen hier, statt still falsch interpretiert zu werden.';


-- =====================================================================
-- Seed
-- =====================================================================

INSERT INTO ampel.beschriftung (status, bezeichnung, emoji, reihenfolge) VALUES
 ('rot','Rot','🔴',1), ('orange','Orange','🟠',2), ('gruen','Grün','🟢',3);

INSERT INTO ampel.regelwerk (regelwerk_key, name, beschreibung, ist_standard) VALUES
 ('round_table_global', 'Round Table (global)',
  'Feste Schwellen aus dem Excel-Blatt "Regeln". Alle Betriebe werden gleich gemessen - beste Vergleichbarkeit im Round Table.', true),
 ('lina_betrieb', 'LINA (betriebsindividuell)',
  'Schwellen, die LINA je Betrieb pflegt. Beruecksichtigt Standortgroesse und Konzept, macht Betriebe untereinander aber schlechter vergleichbar.', false);

INSERT INTO ampel.regel (regelwerk_key, bereich, richtung, schwellenquelle, schwelle_gruen, schwelle_orange, hinweis) VALUES
 ('round_table_global','umsatz',    'hoeher_ist_besser',   'fest',        10.00,  0.00, 'Veraenderung zum Vorjahr in Prozent'),
 ('round_table_global','personal',  'niedriger_ist_besser','fest',        28.00, 32.00, 'Personalkosten ohne GF in Prozent'),
 ('round_table_global','we_bar',    'niedriger_ist_besser','fest',        23.00, 26.00, 'Feste Vorgabe laut Regeln-Blatt'),
 ('round_table_global','we_kueche', 'niedriger_ist_besser','fest',        25.00, 30.00, 'Feste Vorgabe laut Regeln-Blatt'),
 ('round_table_global','bewertung', 'hoeher_ist_besser',   'fest',         4.40,  4.00, 'Online-Bewertung 1-5'),
 ('round_table_global','om',        'hoeher_ist_besser',   'fest',         4.00,  3.00, 'Operations-Manager-Score 1-5'),
 ('lina_betrieb',      'umsatz',    'hoeher_ist_besser',   'fest',        10.00,  0.00, 'LINA kennt keine Umsatzschwelle - global uebernommen'),
 ('lina_betrieb',      'personal',  'niedriger_ist_besser','lina_betrieb', NULL,  NULL, 'aus getPersonalkosten.pekThreshold'),
 ('lina_betrieb',      'we_bar',    'niedriger_ist_besser','fest',        23.00, 26.00, 'LINA kennt keine WE-Schwelle - global uebernommen'),
 ('lina_betrieb',      'we_kueche', 'niedriger_ist_besser','fest',        25.00, 30.00, 'LINA kennt keine WE-Schwelle - global uebernommen'),
 ('lina_betrieb',      'bewertung', 'hoeher_ist_besser',   'fest',         4.40,  4.00, 'kein LINA-Pendant'),
 ('lina_betrieb',      'om',        'hoeher_ist_besser',   'fest',         4.00,  3.00, 'kein LINA-Pendant');

INSERT INTO manual.ursache_katalog (ursache_code, bezeichnung, reihenfolge) VALUES
 ('umsatzrueckgang','Umsatzrückgang',1), ('lokaler_wettbewerb','Lokaler Wettbewerb',2),
 ('wetter_saison','Wetter/Saison',3),    ('marketing_schwach','Marketing schwach',4),
 ('oeffnungszeiten','Öffnungszeiten',5), ('events_reservierungen','Events/Reservierungen',6),
 ('krankheit_ausfall','Krankheit/Ausfall',7), ('dienstplanung','Dienstplanung',8),
 ('ueberstunden','Überstunden',9),       ('einarbeitung_training','Einarbeitung/Training',10),
 ('produktivitaet','Produktivität',11),  ('einkaufspreise','Einkaufspreise',12),
 ('inventur_differenzen','Inventur/Differenzen',13), ('rezeptur_portionierung','Rezeptur/Portionierung',14),
 ('bruch_schwund','Bruch/Schwund',15),   ('kassen_buchungsfehler','Kassen-/Buchungsfehler',16),
 ('qualitaet','Qualität',17),            ('service','Service',18),
 ('bewertungen','Bewertungen',19),       ('vor_ort_befund','Vor-Ort-Befund',20),
 ('sonstiges','Sonstiges',21);

INSERT INTO core.hauptsparte (pos_id, nummer, name) VALUES
 (10001,1,'Speisen'), (10002,2,'Getränke'), (10003,3,'Gutscheine'), (10004,5,'Sonstiges / Divers'),
 (10006,6,'Strassenverkauf_Getränke'), (10007,7,'Strassenverkauf_Speisen'),
 (92,54,'Pfand'), (94,56,'Trinkgeld'), (95,57,'Gutschein'), (10008,58,'Lieferkosten');

INSERT INTO core.verkaufsstelle (nummer, name) VALUES
 (0,'Gesamtbetrieb'), (1,'Ausser Haus'), (2,'AmadeusGO'), (51,'Cocktail Casino'),
 (52,'Delivery'), (53,'To Go Lehners'), (56,'To Go Aktionspreis');

INSERT INTO core.zeitzone (lina_id, name, minute_von, minute_bis) VALUES
 (6,'Frühstück',480,690), (1,'Mittagszeit',690,840), (2,'Nachmittag',840,1050),
 (3,'Happy Hour',1050,1140), (4,'Abendessen',1140,1320), (5,'Late Night',1320,60);

-- Statistikziele auf den Ampelspalten: schmal verteilt, fast immer mit
-- Schwellen verglichen. Verbessert die Selektivitaetsschaetzung spuerbar.
ALTER TABLE core.kennzahlen_monat ALTER COLUMN wert_prozent SET STATISTICS 500;
ALTER TABLE core.personalkosten   ALTER COLUMN persoog_bwa  SET STATISTICS 500;

-- betrieb_key und artikel_key korrelieren stark (nicht jeder Betrieb fuehrt
-- jeden Artikel). Ohne diese Statistik unterschaetzt der Planer kombinierte
-- Filter teils um Groessenordnungen und waehlt Nested Loops statt Hash Joins.
CREATE STATISTICS core.stat_artikelverkauf_betrieb_artikel
    (ndistinct, dependencies)
    ON betrieb_key, artikel_key
    FROM core.artikelverkauf_tag;
