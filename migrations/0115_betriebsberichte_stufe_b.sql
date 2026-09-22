-- =====================================================================
-- 0115 Betriebsberichte, Stufe B — monatlich bzw. in ihrem gemessenen Raster
--      (docs/plan-lina-vollabzug.md, Abschnitt 3; Vermessung 22.09.2026 in
--      lina-api-inventar-1d.md)
--
-- Je Bericht eine Tabelle, befuellt ueber einen Spaltenplan in
-- src/sync/betriebsbericht_laden.ts (SPALTENPLAENE). Die Felder stammen aus
-- der Vermessung an EINEM Betrieb (Wilma Wunder Duesseldorf, August 2026) —
-- meist aus zwei Beispielzeilen je Bericht. Die Struktur ist an einem
-- zweiten Betrieb zu bestaetigen (offene-punkte.md). Eine umbenannte Spalte
-- faengt das Schema je Bericht (sync.schema_abweichung).
--
-- GEMEINSAM FUER ALLE:
--   * zeile: laufende Nummer der Zeile in der Antwort — der Schluessel. Die
--     Berichte haben keine stabile Kennung je Zeile; ein erneuter Abruf
--     ERSETZT den Zeitraum des Betriebs (DELETE, dann INSERT).
--   * monat bzw. geschaeftstag: Monatsberichte (Fensterklasse M) stehen je
--     Monat, Berichte mit Datumsspalte (M-Tag, W) je Tag.
--   * Die Spaltenbeschriftung, die LINA teils in die Datenfelder schreibt
--     ("Anzahl Artikel" in Anzahl_Artikel, "Status" in Status), ist NULL.
--   * Geldbetraege numeric(16,4): LINA liefert Netto mit vielen Stellen;
--     auf Cent gerundet waeren Monatssummen um Cent daneben.
--
-- NICHT HIER, BEWUSST: 38 (in 39 enthalten), 114 (fuer Duesseldorf echt
-- leer — erst an drei Betrieben messen), 81/82 (Gutscheine, 0 Zeilen), 56
-- und 70 (nicht vermessen), 87 (Sammelbericht aus 29/45/68/73), 64 (nur
-- eine Summenzeile), die neun "gesperrten" (500 mit leerem Rumpf).
-- =====================================================================


-- --- 39 Stornogrundbericht ---------------------------------------------
CREATE TABLE core.storno_artikel_monat (
    betrieb_key    integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat          date    NOT NULL,
    zeile          integer NOT NULL,
    artikelnummer  bigint,
    artikel_name   text,
    stornotyp      text,
    stornogrund    text,
    anzahl         numeric(14,3),
    umsatz_brutto  numeric(16,4),
    umsatz_netto   numeric(16,4),
    raw_id         bigint,
    geladen_am     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, zeile)
);
COMMENT ON TABLE core.storno_artikel_monat IS
'Koernung: Betrieb × Monat × Zeile des Stornogrundberichts (39) = Artikel × Stornotyp ×
Stornogrund. Enthaelt den Stornobericht 38 vollstaendig (gleiche Summen: August 2026
Duesseldorf -3.313 Stueck, -20.538,06 EUR brutto in beiden). Anzahl und Umsatz sind bei
Stornos NEGATIV. Stornotyp: Sofortstorno | Storno. Entscheidung E3 (22.09.2026): geladen,
monatlich. Die Stornogruende sind laut entscheidungen.md eher Schwundgruende.';

-- --- 90 Monatsaufstellung Tag fuer Tag ---------------------------------
CREATE TABLE core.monatsaufstellung_tag (
    geschaeftstag  date    NOT NULL,
    betrieb_key    integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    zeile          integer NOT NULL,
    anzahl         numeric(14,3),
    brutto         numeric(16,4),
    netto          numeric(16,4),
    ust            numeric(16,4),
    steuersaetze   jsonb,
    raw_id         bigint,
    geladen_am     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (geschaeftstag, betrieb_key, zeile)
);
COMMENT ON TABLE core.monatsaufstellung_tag IS
'Koernung: Betrieb × Tag (Monatsaufstellung Tag fuer Tag, 90). Ein Monatsaufruf liefert eine
Zeile je Geschaeftstag (M-Tag, gemessen: 31 Zeilen fuer August, der Tagesaufruf deckungsgleich).
steuersaetze: die uebrigen Spalten als jsonb ({"19%_Mwst": 12638, "7%_Mwst": 9644.34, ...})
— sie wechseln je Betrieb und Zeit (NEUE_STEUER_AB_15, 16%_Mwst._older).';

-- --- 108 Verkaufszahlen ------------------------------------------------
CREATE TABLE core.verkaufszahlen_tag (
    geschaeftstag      date    NOT NULL,
    betrieb_key        integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    zeile              integer NOT NULL,
    betrieb_name_lina  text,
    brutto             numeric(16,4),
    anzahl_artikel     numeric(14,3),
    anzahl_zahlungen   integer,
    anzahl_rechnungen  integer,
    raw_id             bigint,
    geladen_am         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (geschaeftstag, betrieb_key, zeile)
);
COMMENT ON TABLE core.verkaufszahlen_tag IS
'Koernung: Betrieb × Tag (Verkaufszahlen, 108; Monatsaufruf mit Tageszeilen). Neu gegenueber
dem Umsatzbericht ist anzahl_zahlungen (Duesseldorf 01.08.2026: 879 Rechnungen, 1.140
Zahlungen). betrieb_name_lina ist der Name, den LINA in die Antwort schreibt — eine
Gegenprobe, dass laden= den richtigen Betrieb adressiert hat.';

-- --- 99 Unbare Zahlungen nach Betriebsstelle ---------------------------
CREATE TABLE core.unbar_zahlung_monat (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    zeile           integer NOT NULL,
    betriebsstelle  text,
    finanzweg       text,
    saldo           numeric(16,4),
    anzahl          numeric(14,3),
    zahlungen       integer,
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, zeile)
);
COMMENT ON TABLE core.unbar_zahlung_monat IS
'Koernung: Betrieb × Monat × Betriebsstelle × Finanzweg — VERDICHTET. Bericht 99 liefert eine
Zeile je einzelner unbarer Zahlung ohne Datum und ohne Kennung (Duesseldorf August: 8.780
Zeilen, 2,1 MB). saldo und anzahl sind die Summen, zahlungen die Zahl der Einzelzeilen.
Die Einzelzahlungen (etwa fuer eine Verteilung der Zahlbetraege) stehen in raw.api_antwort.
Saldo ist LINAs Vorzeichen: eine Zahlung ist negativ. Entscheidung E6 (22.09.2026).';

-- --- 60 Umsatz pro Kellner ---------------------------------------------
CREATE TABLE core.kellner_umsatz_monat (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    zeile           integer NOT NULL,
    kellnernummer   integer,
    kellner_name    text,
    brutto          numeric(16,4),
    netto           numeric(16,4),
    anzahl_artikel  numeric(14,3),
    trinkgeld       numeric(16,4),
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, zeile)
);
COMMENT ON TABLE core.kellner_umsatz_monat IS
'Koernung: Betrieb × Monat × Kellner (60). Entscheidung E5: Kellnerberichte laden.
kellner_name ist in allen gemessenen Zeilen NULL — LINA liefert nur die Kellnernummer
(Vermessung 22.09.2026). Die Spalte steht trotzdem, falls LINA sie je fuellt. Die Kellnernummer
ist eine Kassennummer je Betrieb, KEINE Personenkennung ueber Betriebe hinweg; eine Zuordnung
zu Bounti-Konten ist damit nicht moeglich. Ein Bon kann mehreren Kellnern zugeschlagen sein —
die Summe ueber Kellner ist nicht der Betriebsumsatz.';

-- --- 61 Umsatz pro Kellner pro Tag -------------------------------------
CREATE TABLE core.kellner_umsatz_tag (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    zeile           integer NOT NULL,
    ist_kopf        boolean NOT NULL,
    kellner_block   integer,
    geschaeftstag   date,
    brutto          numeric(16,4),
    netto           numeric(16,4),
    anzahl_artikel  numeric(14,3),
    trinkgeld       numeric(16,4),
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, zeile)
);
COMMENT ON TABLE core.kellner_umsatz_tag IS
'Koernung: Betrieb × Monat × Kellnerblock × Tag (61). DER BERICHT NENNT DEN KELLNER NICHT:
je Kellner eine Kopfzeile (ist_kopf, Tag leer) mit seiner Monatssumme, darunter seine Tage.
kellner_block zaehlt die Bloecke in Antwortreihenfolge. Die Kopfsumme gleicht der Zeile des
Kellners in 60 (Duesseldorf: 4.628,25 EUR = Kellner 1000) — darueber liesse sich die Nummer
zuordnen, geraten wird sie hier nicht. Summen nur ueber ist_kopf = false.
Struktur aus zwei Beispielzeilen — an einem zweiten Betrieb bestaetigen.';

-- --- 53 Artikelbericht pro Kellner -------------------------------------
CREATE TABLE core.kellner_artikel_monat (
    monat           date    NOT NULL,
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    zeile           integer NOT NULL,
    ist_kopf        boolean NOT NULL,
    kellner_block   integer,
    artikelnummer   bigint,
    artikel_name    text,
    brutto          numeric(16,4),
    netto           numeric(16,4),
    anzahl_artikel  numeric(14,3),
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (monat, betrieb_key, zeile)
) PARTITION BY RANGE (monat);
COMMENT ON TABLE core.kellner_artikel_monat IS
'Koernung: Betrieb × Monat × Kellnerblock × Artikel (53). Groesster Bericht im Katalog
(1,88 MB, 6.684 Zeilen je Betrieb-Monat) — deshalb nach monat partitioniert. Wie 61 ohne
Kellnernummer: je Kellner eine Kopfzeile (ist_kopf, Artikelnummer leer), kellner_block
zaehlt. Summen nur ueber ist_kopf = false. An einem zweiten Betrieb bestaetigen.';

-- --- 57 Gutschriften pro Kellner ---------------------------------------
CREATE TABLE core.gutschrift_kellner (
    betrieb_key       integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat             date    NOT NULL,
    zeile             integer NOT NULL,
    kellnernummer     integer,
    kellner_name      text,
    geschaeftstag     date,
    gutschriftnummer  bigint,
    rechnungsnummer   bigint,
    anzahl_artikel    numeric(14,3),
    brutto            numeric(16,4),
    raw_id            bigint,
    geladen_am        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, zeile)
);
COMMENT ON TABLE core.gutschrift_kellner IS
'Koernung: eine Gutschrift (57), je Betrieb und Monat abgerufen. anzahl_artikel trug in den
gemessenen Zeilen den Text "Anzahl Artikel" (eingerutschte Spaltenbeschriftung) und ist dann
NULL. kellner_name ist bei LINA null (siehe core.kellner_umsatz_monat).';

-- --- 68/69 Betriebsstellen ---------------------------------------------
CREATE TABLE core.betriebsstelle_umsatz_monat (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    zeile           integer NOT NULL,
    betriebsstelle  text,
    umsatz_brutto   numeric(16,4),
    umsatz_netto    numeric(16,4),
    anzahl_artikel  numeric(14,3),
    anzahl_gaeste   numeric(14,3),
    pro_kopf_netto  numeric(16,4),
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, zeile)
);
COMMENT ON TABLE core.betriebsstelle_umsatz_monat IS
'Koernung: Betrieb × Monat × Betriebsstelle (68: Restaurant, Bar, Dachterrasse, …).
pro_kopf_netto ist LINAs Quotient — nie mitteln, aus Summen neu rechnen.';

CREATE TABLE core.betriebsstelle_hauptsparte_monat (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    zeile           integer NOT NULL,
    betriebsstelle  text,
    hauptsparte     text,
    umsatz_brutto   numeric(16,4),
    umsatz_netto    numeric(16,4),
    anzahl_artikel  numeric(14,3),
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, zeile)
);
COMMENT ON TABLE core.betriebsstelle_hauptsparte_monat IS
'Koernung: Betrieb × Monat × Betriebsstelle × Hauptsparte (69). hauptsparte ist LINAs Text,
kein Schluessel auf core.hauptsparte.';

-- --- 112/71 Verkaufsstellen --------------------------------------------
CREATE TABLE core.verkaufsstelle_umsatz_monat (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    zeile           integer NOT NULL,
    verkaufsstelle  text,
    umsatz_brutto   numeric(16,4),
    umsatz_netto    numeric(16,4),
    anzahl          numeric(14,3),
    anzahl_gaeste   numeric(14,3),
    pro_kopf_netto  numeric(16,4),
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, zeile)
);
COMMENT ON TABLE core.verkaufsstelle_umsatz_monat IS
'Koernung: Betrieb × Monat × Verkaufsstelle (112). Dieselbe Aussage liefert der Konzernweg
getUmsatzbericht:vs_* seit 0112 je TAG fuer alle Betriebe mit 7 Aufrufen — dieser Bericht ist
die Gegenprobe dazu (Duesseldorf August: Gesamtbetrieb 367.091,59 + Ausser Haus 2.749,50 =
369.841,09 EUR brutto).';

CREATE TABLE core.verkaufsstelle_hauptsparte_monat (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    zeile           integer NOT NULL,
    verkaufsstelle  text,
    hauptsparte     text,
    anzahl          numeric(14,3),
    umsatz_brutto   numeric(16,4),
    umsatz_netto    numeric(16,4),
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, zeile)
);
COMMENT ON TABLE core.verkaufsstelle_hauptsparte_monat IS
'Koernung: Betrieb × Monat × Verkaufsstelle × Hauptsparte (71).';

-- --- 75/76 Zeitzonen × Sparte ------------------------------------------
CREATE TABLE core.zeitzone_feinsparte_monat (
    betrieb_key           integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat                 date    NOT NULL,
    zeile                 integer NOT NULL,
    ist_kopf              boolean NOT NULL,
    feinsparte            text,
    zeitzone              text,
    brutto                numeric(16,4),
    netto                 numeric(16,4),
    durchschnitt_pro_tag  numeric(16,4),
    raw_id                bigint,
    geladen_am            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, zeile)
);
COMMENT ON TABLE core.zeitzone_feinsparte_monat IS
'Koernung: Betrieb × Monat × Feinsparte × vordefinierte Zeitzone (75). LINA schreibt beides in
die Spalte "Zeitzone": eine Kopfzeile je Feinsparte (ist_kopf, zeitzone = Spartenname,
Monatssumme der Sparte) und darunter die Zeitfenster ("9:00 - 12:00"). Summen nur ueber
ist_kopf = false. Die Stundenwerte je Betrieb stehen vollstaendiger in
core.zeitzonenbericht_stunde (Konzern) — neu ist hier nur die Kreuzung mit der Sparte (F8).
Aus zwei Beispielzeilen abgelesen; an einem zweiten Betrieb bestaetigen.';

CREATE TABLE core.zeitzone_hauptsparte_monat (
    betrieb_key           integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat                 date    NOT NULL,
    zeile                 integer NOT NULL,
    ist_kopf              boolean NOT NULL,
    hauptsparte           text,
    zeitzone              text,
    brutto                numeric(16,4),
    netto                 numeric(16,4),
    durchschnitt_pro_tag  numeric(16,4),
    raw_id                bigint,
    geladen_am            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, zeile)
);
COMMENT ON TABLE core.zeitzone_hauptsparte_monat IS
'Koernung: Betrieb × Monat × Hauptsparte × vordefinierte Zeitzone (76). Aufbau wie
core.zeitzone_feinsparte_monat. Januar 2022 lieferte fuer Duesseldorf 500 mit leerem Rumpf.';

-- --- 86 Debitorenauswertung (W) ----------------------------------------
CREATE TABLE core.debitor_bon (
    geschaeftstag      date    NOT NULL,
    betrieb_key        integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    zeile              integer NOT NULL,
    rechnungsnummer    bigint,
    art                text,
    anzahl_artikel     integer,
    finanzwege         text[]  NOT NULL DEFAULT '{}',
    brutto             numeric(16,4),
    debitor            text,
    debitor_anschrift  text,
    raw_id             bigint,
    geladen_am         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (geschaeftstag, betrieb_key, zeile)
);
COMMENT ON TABLE core.debitor_bon IS
'Koernung: ein Bon je Zeile (Debitorenauswertung, 86), in Sieben-Tage-Fenstern (Monat → 504).
AM TAGESAUFRUF 15.08.2026 LIEFERTE 86 DIESELBEN 519 BONS WIE 96 (plus eine Summenzeile, die
hier fehlt) — moeglicherweise ein Duplikat von core.bon mit anderem Feldnamen
("Rechnung/Gutschrift" statt "Rechnung/Butschrift"). Ob 86 bei Betrieben MIT Debitoren
nur deren Bons fuehrt, ist nicht gemessen (offene-punkte.md). zeile ist die laufende
Nummer in der Antwort.';

-- --- 113 Tischtransfer (W) ---------------------------------------------
CREATE TABLE core.tischtransfer_bon (
    geschaeftstag    date    NOT NULL,
    betrieb_key      integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    zeile            integer NOT NULL,
    rechnungsnummer  bigint,
    tisch_id         bigint,
    art              text,
    anzahl_artikel   integer,
    finanzwege       text[]  NOT NULL DEFAULT '{}',
    brutto           numeric(16,4),
    status           text,
    versuche         text,
    antwort          text,
    raw_id           bigint,
    geladen_am       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (geschaeftstag, betrieb_key, zeile)
);
COMMENT ON TABLE core.tischtransfer_bon IS
'Koernung: ein Bon je Zeile mit TischId (Tischtransfer, 113), Sieben-Tage-Fenster. Am
15.08.2026 dieselben 519 Bons wie 96 — neu ist nur tisch_id. status und versuche trugen in
den gemessenen Zeilen ihre eigene Spaltenbeschriftung und sind dann NULL; was sie im
Ernstfall enthalten, ist nicht gemessen.';
