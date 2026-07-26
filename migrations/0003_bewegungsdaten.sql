-- =====================================================================
-- 0003 Bewegungsdaten — der Raw-Layer und die Faktentabellen
--
-- Anders als bei den Stammdaten ist hier jeder Tag ein abgeschlossener
-- Fakt: der Umsatzbericht fuer den 14.06.2023 liefert heute dasselbe wie in
-- fuenf Jahren. Deshalb braucht keine dieser Tabellen eine _stand-Historie.
--
-- Die eine Ausnahme ist die BWA (core.kennzahlen_monat) - die kommt vom
-- Steuerberater und wird rueckwirkend korrigiert. Sie ist append-only.
-- =====================================================================


-- =====================================================================
-- RAW — eine Zeile je LINA-Aufruf
--
-- Die Versicherung. Wenn sich morgen herausstellt, dass wir ein Feld falsch
-- interpretiert haben, wird von hier neu transformiert - ohne LINA noch
-- einmal anzufassen. Deshalb append-only, deshalb vollstaendig.
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

COMMENT ON TABLE  raw.api_antwort               IS 'Eine Zeile je LINA-Aufruf. Monatlich partitioniert nach ABRUFZEITPUNKT, nicht nach Geschaeftstag - so laesst sich ein Zeitraum, den man nicht mehr braucht, als Ganzes wegwerfen. Die Kinder liegen im Schema part.';
COMMENT ON COLUMN raw.api_antwort.endpunkt      IS 'z.B. getUmsatzbericht, getKennzahlen, getReport:38 - wortwoertlich wie LINA den Endpunkt nennt.';
COMMENT ON COLUMN raw.api_antwort.betrieb_enc_id IS 'Nur bei Betriebs-Reports (/finanzen/...). Bei Konzern-Reports NULL, weil die Antwort alle 141 Betriebe enthaelt.';
COMMENT ON COLUMN raw.api_antwort.parameter     IS 'Die tatsaechlich gesendeten Query-Parameter. Macht jeden Aufruf reproduzierbar.';
COMMENT ON COLUMN raw.api_antwort.payload_hash  IS 'sha256 der Antwort. Gleicher Hash = fachlich nichts geaendert. Spart Transformationsarbeit und macht BWA-Nachbuchungen sichtbar.';
COMMENT ON COLUMN raw.api_antwort.http_status   IS 'ACHTUNG: LINA liefert 500 mit leerem Body, wenn ein Betrieb fuer diesen Bericht keine Daten hat. Kein Retry-Fall.';

CREATE INDEX ON raw.api_antwort (endpunkt, zeitraum_von, abgerufen_am DESC);
CREATE INDEX ON raw.api_antwort (betrieb_enc_id, endpunkt, abgerufen_am DESC) WHERE betrieb_enc_id IS NOT NULL;


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
--
-- Die Fremdschluessel sind neu und Absicht: Metabase liest sie aus dem
-- Katalog und bietet daraufhin von selbst den Sprung zum Betrieb und zum
-- Artikel an. Ohne sie sind betrieb_key und artikel_key dort namenlose
-- Zahlenspalten. Die Kosten sind zwei Indexzugriffe je eingefuegter Zeile
-- auf zwei winzige, dauerhaft gecachte Tabellen (141 bzw. 6.451 Zeilen) -
-- gegen einen Takt von 20 bis 40 Sekunden je Anfrage faellt das nicht ins
-- Gewicht. Die Ladereihenfolge passt: src/sync/laden.ts sichert Betriebe
-- und Artikel in derselben Transaktion, bevor die Verkaufszeilen kommen.
CREATE TABLE core.artikelverkauf_tag (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag   date    NOT NULL,
    artikel_key     integer NOT NULL REFERENCES core.artikel(artikel_key),
    menge           numeric(12,3),
    umsatz_netto    numeric(14,2),
    umsatz_brutto   numeric(14,2),
    verkaufspreis   numeric(12,4),
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (geschaeftstag, betrieb_key, artikel_key)
) PARTITION BY RANGE (geschaeftstag);

COMMENT ON TABLE core.artikelverkauf_tag IS
'VERKAEUFE je Betrieb, Tag und Artikel - nicht zu verwechseln mit dem Katalog core.artikel.
Aus getArtikelverkaufsbericht (groesste Response, ca. 2 MB fuer alle Betriebe), rund
20 Millionen Zeilen im Jahr.

Monatlich partitioniert, die Kinder liegen im Schema part. PK beginnt mit geschaeftstag
fuer Partition Pruning. Bewusst KEIN eigener Index auf betrieb_key: dank Skip Scan (PG 18)
und nur ~30 verschiedenen Tagen je Partitionsindex nutzt der Planer dafuer den PK. Spart
Schreiblast beim Backfill.

Fuer Auswertungen mit Namen statt Schluesseln: mart.artikelverkauf.';

-- artikel_key ist hochkardinal und braucht einen eigenen Index
-- ("wie lief Artikel X ueber die Zeit"). betrieb_key nicht: dafuer greift
-- Skip Scan auf dem PK, siehe Kommentar an der Tabelle.
CREATE INDEX ON core.artikelverkauf_tag (artikel_key, geschaeftstag);

-- betrieb_key und artikel_key korrelieren stark (nicht jeder Betrieb fuehrt
-- jeden Artikel). Ohne diese Statistik unterschaetzt der Planer kombinierte
-- Filter teils um Groessenordnungen und waehlt Nested Loops statt Hash Joins.
CREATE STATISTICS core.stat_artikelverkauf_betrieb_artikel
    (ndistinct, dependencies)
    ON betrieb_key, artikel_key
    FROM core.artikelverkauf_tag;


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
zugrunde lag. Genau dafuer wird heute das Excel-Blatt "Ampelhistorie" von Hand gepflegt.
Fuer den juengsten Stand: mart.kennzahlen_aktuell.';
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


-- ---------------------------------------------------------------------
-- Warenwirtschaft: Bestellungen und Inventurtermine
-- ---------------------------------------------------------------------

CREATE TABLE core.bestellung (
    bestellung_key  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lina_id         integer NOT NULL UNIQUE,
    lieferant_key   integer REFERENCES core.lieferant(lieferant_key),
    erstellt_am     timestamptz,
    bestellt_am     timestamptz,
    liefertermin    timestamptz,
    geliefert       boolean,
    status          integer,
    posten_anzahl   integer,
    summe           numeric(14,2),
    zuletzt_am      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.bestellung IS
'Bestellungen aus /wawi/api/orders. Im Zentral-Kontext nur 4 Saetze -- siehe die
Einschraenkung zum Betriebskontext in docs/offene-punkte.md.';

CREATE TABLE core.bestellposten (
    bestellung_key  integer NOT NULL REFERENCES core.bestellung(bestellung_key) ON DELETE CASCADE,
    ware_lina_id    integer NOT NULL,
    einheit_key     integer REFERENCES core.einheit(einheit_key),
    ware_name       text,
    menge           numeric(12,4),
    einzelpreis     numeric(12,4),
    PRIMARY KEY (bestellung_key, ware_lina_id)
);

CREATE TABLE core.inventurtermin (
    datum           date PRIMARY KEY,
    bearbeitbar     boolean,
    zuletzt_am      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.inventurtermin IS
'Inventurstichtage aus /wawi/inventory/inventory. Das Datum kommt als Unix-Sekunden
und wird ueber den Berliner Geschaeftstag aufgeloest, nicht ueber UTC.';


-- =====================================================================
-- Partitionen
--
-- Nur ein kleiner Vorrat. Alles Weitere legt core.partition_anlegen() beim
-- Schreiben an - der Importer ruft es fuer beide Tabellen auf, bevor er
-- einfuegt. Ein Backfill bis 2018 braucht deshalb hier nichts.
--
-- Fuer raw.api_antwort waere ein Vorrat in die Vergangenheit ohnehin
-- sinnlos: partitioniert wird nach abgerufen_am, und das ist immer jetzt.
-- =====================================================================

DO $$
DECLARE d date;
BEGIN
    d := date '2025-01-01';
    WHILE d < date '2027-01-01' LOOP
        PERFORM core.partition_anlegen('core.artikelverkauf_tag', d);
        d := (d + interval '1 month')::date;
    END LOOP;

    d := date '2026-01-01';
    WHILE d < date '2027-01-01' LOOP
        PERFORM core.partition_anlegen('raw.api_antwort', d);
        d := (d + interval '1 month')::date;
    END LOOP;
END $$;


-- Statistikziele auf den Ampelspalten: schmal verteilt, fast immer mit
-- Schwellen verglichen. Verbessert die Selektivitaetsschaetzung spuerbar.
ALTER TABLE core.kennzahlen_monat ALTER COLUMN wert_prozent SET STATISTICS 500;
ALTER TABLE core.personalkosten   ALTER COLUMN persoog_bwa  SET STATISTICS 500;
