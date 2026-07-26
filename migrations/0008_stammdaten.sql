-- ---------------------------------------------------------------------
-- 0008 Stammdaten-Momentaufnahmen
--
-- Warum es diese Migration gibt:
--
-- Bewegungsdaten sind viel, aber jeder Tag ist ein abgeschlossener Fakt --
-- der Umsatzbericht fuer den 14.06.2023 liefert heute dasselbe wie in fuenf
-- Jahren. Stammdaten sind wenig, aber LINA UEBERSCHREIBT sie. Es gibt keine
-- Preishistorie; `prices[].updated` verraet nur, wann zuletzt geaendert
-- wurde, nicht was vorher galt.
--
-- Eine Verkaufsmenge ohne den Einkaufspreis und die Warengruppe, die DAMALS
-- galten, ist eine Zahl ohne Bedeutung. Genau dieser Fehler steckte bis 0007
-- im eigenen Schema (core.artikel ueberschrieb fixer_we); core.artikel_stand
-- hat ihn fuer den Artikel geloest. Diese Migration loest ihn fuer
-- Warengruppen, Einkaufspreise, Lieferanten und Einheiten.
--
-- Durchgaengiges Prinzip, wie bei core.artikel_stand:
--   *_stand-Tabellen sind APPEND-ONLY und je Monat gueltig.
--   Die Dimensionstabellen daneben halten den aktuellen Stand fuer Joins.
--
-- Was hier NICHT gespeichert wird, steht bei core.lieferant.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- Feinsparten -- die dritte Sortimentsdimension neben Haupt- und
-- Verkaufsstelle. 334 Stueck, bisher gar nicht gespeichert.
-- ---------------------------------------------------------------------

CREATE TABLE core.feinsparte (
    feinsparte_key  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lina_id         integer NOT NULL UNIQUE,
    nummer          integer,
    name            text    NOT NULL
);

COMMENT ON TABLE core.feinsparte IS
'Feinsparten aus /intranet/api/analyticsFilterOptions.feinsparten (334 Stueck, 25.07.2026).';

COMMENT ON COLUMN core.feinsparte.lina_id IS
'Das Feld "id" der Antwort. VERMUTLICH der Filterschluessel -- bei hauptsparten erwartet LINA
posId und nicht nummer, und feinsparten sind gleich aufgebaut {id, number, name}.
UNGEPRUEFT: wir speichern die Dimension nur, gefiltert wird noch nicht danach.
Wer sie als Filter benutzt, prueft das vorher gegen eine bekannte Summe.';


-- ---------------------------------------------------------------------
-- Warengruppen -- die dreistufige Gliederung aus articleApi
--
-- LINA liefert sie je Artikel als String "Weine (2900)": Name und ID in
-- einem Feld. Beides wird getrennt gespeichert, sonst ist weder ein Join
-- noch eine Umbenennung moeglich.
-- ---------------------------------------------------------------------

CREATE TYPE core.warengruppe_ebene AS ENUM ('gross', 'mec', 'detail');

CREATE TABLE core.warengruppe (
    warengruppe_key integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ebene           core.warengruppe_ebene NOT NULL,
    lina_id         integer NOT NULL,
    name            text    NOT NULL,
    zuletzt_am      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (ebene, lina_id)
);

COMMENT ON TABLE core.warengruppe IS
'Dreistufige Warengliederung aus /wawi/rezept/articleApi?franchise=1 (25.07.2026):
gross 7 Werte, mec 329, detail 278. Der Auslieferungsstand nannte 8 Grosskategorien --
gemessen wurden 7.';


-- ---------------------------------------------------------------------
-- Warengruppe je Artikel, monatlich -- APPEND-ONLY
--
-- Bewusst eine eigene Tabelle statt zusaetzlicher Spalten an
-- core.artikel_stand: die Zuordnung stammt aus einem ANDEREN Endpunkt
-- (articleApi statt Artikelverkaufsbericht) und traegt damit ein eigenes
-- Abrufdatum. Ein Artikel kann umgruppiert werden, ohne dass sich sein
-- fixer_we aendert -- und umgekehrt.
-- ---------------------------------------------------------------------

CREATE TABLE core.artikel_warengruppe_stand (
    artikel_key     integer NOT NULL REFERENCES core.artikel(artikel_key),
    monat           date    NOT NULL,
    gross_key       integer REFERENCES core.warengruppe(warengruppe_key),
    mec_key         integer REFERENCES core.warengruppe(warengruppe_key),
    detail_key      integer REFERENCES core.warengruppe(warengruppe_key),
    erfasst_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (artikel_key, monat)
);

COMMENT ON TABLE core.artikel_warengruppe_stand IS
'In welcher Warengruppe hing ein Artikel in einem bestimmten Monat? Append-only.
Verknuepft ueber artnr, NICHT ueber die id aus articleApi -- am 25.07.2026 gemessen:
artnr trifft die Artikelnummern des Verkaufsberichts, id trifft keine einzige.';


-- ---------------------------------------------------------------------
-- Einheiten -- ohne die Faktoren sind Mengen nicht vergleichbar
-- ---------------------------------------------------------------------

CREATE TABLE core.einheit (
    einheit_key     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lina_id         integer NOT NULL UNIQUE,
    name            text    NOT NULL,
    abkuerzung      text,
    parent_lina_id  integer,
    faktor          numeric(16,6),
    ist_basis       boolean NOT NULL DEFAULT false,
    zuletzt_am      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.einheit IS
'Einheiten aus /wawi/api/units (32 Stueck). faktor rechnet auf parent um; Basiseinheiten
tragen ist_basis und faktor 0.';


-- ---------------------------------------------------------------------
-- Lieferanten -- HIER GILT DATENMINIMIERUNG
--
-- Die Antwort von /wawi/api/suppliers hat 28 Felder. Bewusst NICHT
-- uebernommen werden:
--     ustid, hrb, kreditor, gegenkonto, gegenkonto7, gegenkonto0,
--     global_discount_kontos, tel, Fax, email, ort, strasse, hnr, plz,
--     kdnr, partner, netz, re_def, id_general, api, einzelp, dh_supplier_id
--
-- Das sind Steuer-, Bank- und Kontaktdaten von 540 Geschaeftspartnern. Fuer
-- jede Auswertung, die dieses Projekt vorhat, sind sie ohne Nutzen -- und
-- ein Datenbestand, den man nicht hat, kann auch nicht abfliessen.
--
-- Die Transformation hat eine explizite Whitelist. Wer hier eine Spalte
-- ergaenzt, begruendet das im Ticket.
-- ---------------------------------------------------------------------

CREATE TABLE core.lieferant (
    lieferant_key       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lina_id             integer NOT NULL UNIQUE,
    name                text,
    aktiv               boolean,
    mindestbestellwert  numeric(12,2),
    liefertage          text,
    zuletzt_am          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.lieferant IS
'Lieferantenstamm aus /wawi/api/suppliers, auf das fachlich Noetige reduziert.
Kontakt-, Steuer- und Buchhaltungsfelder werden BEWUSST nicht gespeichert -- Begruendung
im Kopf dieser Migration. 540 Saetze, davon 539 mit Namen.';

COMMENT ON COLUMN core.lieferant.liefertage IS 'LINAs dow -- Wochentage, an denen geliefert wird.';


-- ---------------------------------------------------------------------
-- Waren
-- ---------------------------------------------------------------------

CREATE TABLE core.ware (
    ware_key        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lina_id         integer NOT NULL UNIQUE,
    name            text    NOT NULL,
    nummer          text,
    gruppe_lina_id  integer,
    gruppe_name     text,
    einheit_key     integer REFERENCES core.einheit(einheit_key),
    zuletzt_am      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.ware IS
'Waren aus /wawi/api/items?archive=0 (898 Saetze). Aktueller Stand fuer Joins;
die Historie steht in core.ware_stand und core.einkaufspreis_stand.';

CREATE TABLE core.ware_stand (
    ware_key            integer NOT NULL REFERENCES core.ware(ware_key),
    monat               date    NOT NULL,
    name                text    NOT NULL,
    gruppe_name         text,
    einheit_key         integer REFERENCES core.einheit(einheit_key),
    hauptlieferant_key  integer REFERENCES core.lieferant(lieferant_key),
    listenpreis         numeric(12,4),
    gebinde             numeric(12,4),
    gebinde_einheit     text,
    erfasst_am          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ware_key, monat)
);

COMMENT ON TABLE core.ware_stand IS
'Wie sah eine Ware in einem bestimmten Monat aus? Append-only.';
COMMENT ON COLUMN core.ware_stand.listenpreis IS
'Das Feld price der Ware -- der angezeigte Preis. Die belastbaren Werte stehen je Lieferant
in core.einkaufspreis_stand.';


-- ---------------------------------------------------------------------
-- Einkaufspreise je Ware und Lieferant, monatlich -- APPEND-ONLY
--
-- Das ist der eigentliche Grund fuer diese ganze Migration. 299 der 898
-- Waren haben mehr als einen Lieferantenpreis, deshalb eine eigene Tabelle
-- statt einer Spalte an der Ware.
--
-- RUECKWIRKEND NICHT NACHHOLBAR: LINA speichert nur den jeweils aktuellen
-- Preis. Jeder Monat, in dem diese Momentaufnahme nicht laeuft, ist eine
-- dauerhafte Luecke in der Margenbetrachtung.
-- ---------------------------------------------------------------------

CREATE TABLE core.einkaufspreis_stand (
    ware_key            integer NOT NULL REFERENCES core.ware(ware_key),
    monat               date    NOT NULL,
    lina_preis_id       integer NOT NULL,
    lieferant_key       integer REFERENCES core.lieferant(lieferant_key),
    einheit_key         integer REFERENCES core.einheit(einheit_key),
    lieferanten_artnr   text,
    bestellart          text,
    preis               numeric(12,4),
    menge               numeric(12,4),
    gebinde_menge       numeric(12,4),
    basis_faktor        numeric(16,6),
    aktiv               boolean,
    geaendert_am        timestamptz,
    erfasst_am          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ware_key, monat, lina_preis_id)
);

COMMENT ON TABLE core.einkaufspreis_stand IS
'Einkaufspreis je Ware und Lieferant, monatlich fortgeschrieben. Append-only.
LINA kennt KEINE Preishistorie -- was hier fehlt, ist dauerhaft weg.';

COMMENT ON COLUMN core.einkaufspreis_stand.geaendert_am IS
'LINAs updated, Unix-Sekunden, umgerechnet nach UTC. Sagt, WANN zuletzt geaendert wurde --
nicht, was vorher galt. Genau deshalb die monatliche Momentaufnahme.';
COMMENT ON COLUMN core.einkaufspreis_stand.basis_faktor IS
'base_unit_mult: Umrechnung auf die Basiseinheit. Ohne den sind Preise verschiedener
Gebindegroessen nicht vergleichbar.';


-- ---------------------------------------------------------------------
-- Bestellungen und Inventurtermine
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


-- ---------------------------------------------------------------------
-- Auswertung: Deckungsbeitrag je Warengruppe und Monat
--
-- Erst mit der Sortimentshierarchie moeglich. Bewusst getrennt ausgewiesen,
-- was getrennt gehoert -- dieselbe Sorgfalt wie in mart.pruefung_wareneinsatz:
-- der POS-Artikelumsatz ist NICHT das BWA-Umsatzkonto.
-- ---------------------------------------------------------------------

CREATE VIEW mart.deckungsbeitrag_warengruppe AS
SELECT b.betrieb_key,
       date_trunc('month', av.geschaeftstag)::date            AS monat,
       g.name                                                 AS grosskategorie,
       m.name                                                 AS warengruppe,
       d.name                                                 AS detailkategorie,
       sum(av.menge)                                          AS menge,
       sum(av.umsatz_netto)                                   AS umsatz_netto_pos,
       -- Theoretischer Wareneinsatz aus dem Stand DES MONATS, nicht aus dem
       -- heutigen core.artikel -- sonst rechnet man die Vergangenheit mit der
       -- aktuellen Kalkulation und es sieht trotzdem plausibel aus.
       sum(av.menge * ast.fixer_we)                           AS wareneinsatz_theoretisch,
       sum(av.umsatz_netto) - sum(av.menge * ast.fixer_we)    AS deckungsbeitrag,
       CASE WHEN sum(av.umsatz_netto) > 0
            THEN round(100 * (sum(av.umsatz_netto) - sum(av.menge * ast.fixer_we))
                       / sum(av.umsatz_netto), 2)
       END                                                    AS deckungsbeitrag_prozent
  FROM core.artikelverkauf_tag av
  JOIN core.betrieb b ON b.betrieb_key = av.betrieb_key
  LEFT JOIN core.artikel_stand ast
         ON ast.artikel_key = av.artikel_key
        AND ast.monat = date_trunc('month', av.geschaeftstag)::date
  LEFT JOIN core.artikel_warengruppe_stand aw
         ON aw.artikel_key = av.artikel_key
        AND aw.monat = date_trunc('month', av.geschaeftstag)::date
  LEFT JOIN core.warengruppe g ON g.warengruppe_key = aw.gross_key
  LEFT JOIN core.warengruppe m ON m.warengruppe_key = aw.mec_key
  LEFT JOIN core.warengruppe d ON d.warengruppe_key = aw.detail_key
 GROUP BY b.betrieb_key, 2, 3, 4, 5;

COMMENT ON VIEW mart.deckungsbeitrag_warengruppe IS
'Deckungsbeitrag je Warengruppe und Monat. Prozentwerte sind Prozentzahlen (23.64), nie Brueche.
ACHTUNG: umsatz_netto_pos ist der POS-Artikelumsatz und NICHT das BWA-Umsatzkonto aus
core.kennzahlen_monat -- die beiden weichen systematisch ab. Wer sie vergleicht, liest erst
den Kommentar an mart.pruefung_wareneinsatz.
wareneinsatz_theoretisch ist NULL, solange fuer den Monat kein core.artikel_stand vorliegt.';


-- ---------------------------------------------------------------------
-- Auswertung: Preisentwicklung
-- ---------------------------------------------------------------------

CREATE VIEW mart.preisentwicklung_ware AS
SELECT w.ware_key,
       w.name                AS ware,
       l.name                AS lieferant,
       p.monat,
       p.preis,
       p.menge,
       p.gebinde_menge,
       p.basis_faktor,
       CASE WHEN p.menge > 0 AND p.basis_faktor > 0
            THEN round(p.preis / (p.menge * p.basis_faktor), 4)
       END                   AS preis_je_basiseinheit,
       e.abkuerzung          AS basiseinheit,
       p.geaendert_am,
       lag(p.preis) OVER (PARTITION BY p.ware_key, p.lieferant_key ORDER BY p.monat)
                             AS preis_vormonat
  FROM core.einkaufspreis_stand p
  JOIN core.ware w      ON w.ware_key = p.ware_key
  LEFT JOIN core.lieferant l ON l.lieferant_key = p.lieferant_key
  LEFT JOIN core.einheit  e  ON e.einheit_key   = p.einheit_key;

COMMENT ON VIEW mart.preisentwicklung_ware IS
'Einkaufspreise je Ware, Lieferant und Monat, mit Vormonatsvergleich.
Die Reihe beginnt mit der ersten Momentaufnahme -- rueckwirkend gibt es nichts,
weil LINA keine Preishistorie fuehrt.';
