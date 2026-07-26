-- =====================================================================
-- 0002 Stammdaten — die Dimensionen und ihre Historie
--
-- Das durchgaengige Muster dieser Datei:
--
--   <ding>        haelt den AKTUELLEN Stand. Dafuer da, dass man joinen und
--                 anzeigen kann. Wird per UPSERT ueberschrieben.
--   <ding>_stand  haelt die HISTORIE, je Monat, APPEND-ONLY.
--
-- Der Grund ist nicht Ordnungsliebe, sondern ein Fehler, der uns schon
-- einmal untergekommen ist: LINA kennt keine Historie fuer Stammdaten. Der
-- hinterlegte Wareneinsatz eines Artikels aendert sich mit jeder Rezeptur-
-- und Einkaufspreisanpassung, und `prices[].updated` verraet nur, WANN
-- zuletzt geaendert wurde - nicht, was vorher galt.
--
-- Ohne die _stand-Tabellen wuerde jede Rueckrechnung auf einen vergangenen
-- Monat mit der HEUTIGEN Kalkulation laufen. Das Ergebnis sieht plausibel
-- aus und ist still falsch - die schlimmste Sorte Fehler.
--
-- Was hier NICHT gespeichert wird, steht bei core.lieferant.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Betriebe und Marken
-- ---------------------------------------------------------------------

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
COMMENT ON COLUMN core.betrieb.lina_betrieb_id IS
'Numerische ID aus analyticsFilterOptions.betriebe bzw. getKennzahlen children[].key.
DIE BRUECKE ZUR BWA: getKennzahlen kennt Betriebe nur ueber diese Zahl, alle anderen
Endpunkte nur ueber enc_id. Am 26.07.2026 fehlte sie - alle 7.860 Kennzahlenzeilen fielen
still durch den Filter, waehrend der Posten "ok" meldete.';
COMMENT ON COLUMN core.betrieb.hat_bwa         IS 'Nur ca. 66 der 131 Einheiten haben ueberhaupt BWA-Daten. Der Rest sind geschlossene Betriebe und Beteiligungsgesellschaften. Verhindert Fehlalarme.';
COMMENT ON COLUMN core.betrieb.name IS
'Betriebsname wie LINA ihn liefert - haeufig nur die Stadt, weil die Marke aus
der Konzeptgruppe kommt. NICHT eindeutig: mehrere Betriebe heissen "Karlsruhe".
Fuer die Anzeige Konzept und Name zusammensetzen, fuers Joinen enc_id nehmen.';

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
COMMENT ON TABLE core.betrieb_konzept IS
'Zuordnung Betrieb zu Konzept (Marke).

Erwartung: faktisch 1:n - ein Aposto ist ein Aposto. Als n:m modelliert, weil
LINA es nicht ausschliesst und "Eat Tasty" ein plausibler Mehrfachfall ist.

ACHTUNG BEIM JOINEN: in getKennzahlen liefert die GRUPPE die Marke, das Kind
traegt nur die Stadt. Der Betriebsname ist deshalb NICHT eindeutig - "Karlsruhe"
existiert fuenfmal, je einmal unter Enchilada, Aposto, Lehners, Besitos und
Wilma Wunder. Das sind fuenf Restaurants in einer Stadt, nicht ein Restaurant
in fuenf Marken; gegengeprueft am Juniumsatz, der auf den Cent zur Excel-Zeile
"Enchilada Karlsruhe" passt. Immer ueber core.betrieb.enc_id joinen, nie ueber
den Namen.

Pruefstand: SELECT anzahl_konzepte, count(*) FROM mart.konzept_zuordnung GROUP BY 1;';


-- ---------------------------------------------------------------------
-- Sortimentsdimensionen
-- ---------------------------------------------------------------------

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

CREATE TABLE core.zeitzone (
    zeitzone_key    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lina_id         integer NOT NULL UNIQUE,
    name            text    NOT NULL,
    minute_von      integer NOT NULL,
    minute_bis      integer NOT NULL
);
COMMENT ON TABLE core.zeitzone IS 'Vordefinierte Zeitzonen aus getVordefinierteZeitzonenBericht. minute_von/bis sind Minuten seit Mitternacht (690 = 11:30). "Late Night" laeuft ueber Mitternacht (1320 -> 60).';


-- ---------------------------------------------------------------------
-- Artikel — der Verkaufskatalog
--
-- Nicht zu verwechseln mit core.artikelverkauf_tag in 0003. Hier steht der
-- KATALOG: eine Zeile je Artikel, 6.451 Stueck. Dort stehen die VERKAEUFE:
-- eine Zeile je Betrieb, Tag und Artikel, rund 20 Millionen im Jahr.
-- ---------------------------------------------------------------------

CREATE TABLE core.artikel (
    artikel_key     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    artikelnummer   bigint      NOT NULL UNIQUE,
    name            text        NOT NULL,
    fixer_we        numeric(12,4),
    zuletzt_am      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE  core.artikel IS
'Artikelkatalog, eine Zeile je Artikel (6.451 Stueck). Der AKTUELLE Stand, per UPSERT
gepflegt - die Historie steht in core.artikel_stand, die Verkaufszahlen in
core.artikelverkauf_tag.';
COMMENT ON COLUMN core.artikel.fixer_we IS 'LINAs fixed_we aus getArtikelverkaufsbericht.columns[]: hinterlegter Wareneinsatz je Artikel. Ergebnis der LINA-Rezepturkalkulation - macht die Rezepturaufloesung fuer den theoretischen Wareneinsatz entbehrlich.';

-- Monatsgranularitaet mit Absicht: taeglich waeren es 6.451 Artikel x 365
-- Tage, und die fachliche Frage lautet ohnehin "welcher Ansatz galt in
-- Monat X". Ausserdem ist der Monat unabhaengig davon, in welcher
-- Reihenfolge der Backfill die Zeitraeume abarbeitet.
CREATE TABLE core.artikel_stand (
    artikel_key   integer NOT NULL REFERENCES core.artikel(artikel_key),
    monat         date    NOT NULL,
    name          text    NOT NULL,
    fixer_we      numeric(12,4),
    erfasst_am    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (artikel_key, monat)
);
COMMENT ON TABLE core.artikel_stand IS
'Wie sah ein Artikel in einem bestimmten Monat aus? Append-only.
GESCHRIEBEN WIRD NUR BEI AENDERUNG - es gibt also nicht fuer jeden Monat eine Zeile.
Wer den Stand eines Monats braucht, nimmt core.artikel_stand_zeitraum, nicht monat = X.';
COMMENT ON COLUMN core.artikel_stand.monat    IS 'Monatserster des Zeitraums, aus dem die Antwort stammt.';
COMMENT ON COLUMN core.artikel_stand.fixer_we IS 'LINAs hinterlegter Wareneinsatz je Einheit, wie er in diesem Monat galt.';


-- ---------------------------------------------------------------------
-- Warengruppen — die dreistufige Gliederung aus articleApi
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

-- Bewusst eine eigene Tabelle statt zusaetzlicher Spalten an
-- core.artikel_stand: die Zuordnung stammt aus einem ANDEREN Endpunkt
-- (articleApi statt Artikelverkaufsbericht) und traegt damit ein eigenes
-- Abrufdatum. Ein Artikel kann umgruppiert werden, ohne dass sich sein
-- fixer_we aendert -- und umgekehrt.
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
-- Die Historie als ZEITRAUM statt als Monatsschluessel
--
-- Der Fallstrick, den diese beiden Sichten beseitigen: die _stand-Tabellen
-- haben nicht fuer jeden Monat eine Zeile. core.artikel_stand wird nur
-- fortgeschrieben, wenn sich etwas GEAENDERT hat - genau richtig, weil ein
-- unveraenderter Artikel keine 60 identischen Zeilen braucht.
--
-- Wer daraufhin `... AND s.monat = date_trunc('month', tag)` schreibt,
-- bekommt fuer die allermeisten Monate NULL zurueck und merkt es nicht:
-- ein theoretischer Wareneinsatz von NULL sieht aus wie "kein Ansatz
-- hinterlegt", nicht wie "falsch verknuepft". Genau dieser Fehler steckte
-- in der ersten Fassung von mart.deckungsbeitrag_warengruppe.
--
-- Hier wird die Punktfolge einmal in Gueltigkeitszeitraeume uebersetzt.
-- Danach ist der Join ein Bereichsvergleich und kann nicht mehr danebengehen.
-- ---------------------------------------------------------------------

CREATE VIEW core.artikel_stand_zeitraum AS
SELECT artikel_key,
       monat AS gilt_ab,
       lead(monat) OVER (PARTITION BY artikel_key ORDER BY monat) AS gilt_bis,
       name,
       fixer_we
  FROM core.artikel_stand;

COMMENT ON VIEW core.artikel_stand_zeitraum IS
'core.artikel_stand als Gueltigkeitszeitraeume. gilt_bis ist EXKLUSIV und NULL fuer den
jeweils juengsten Stand. Join-Muster:
    JOIN core.artikel_stand_zeitraum z
      ON z.artikel_key = av.artikel_key
     AND av.geschaeftstag >= z.gilt_ab
     AND (z.gilt_bis IS NULL OR av.geschaeftstag < z.gilt_bis)
Nie ueber monat = date_trunc(...) verknuepfen: die Stand-Tabelle hat nur bei Aenderung
eine Zeile, der Treffer bliebe fuer die meisten Monate leer.';

-- Ein Unterschied zu core.artikel_stand_zeitraum, und er ist Absicht: die
-- aelteste bekannte Zuordnung gilt hier RUECKWIRKEND (gilt_ab = -infinity).
--
-- Der Grund liegt in der Natur der beiden Groessen. Die Warengruppen-
-- momentaufnahme laeuft nur vorwaerts - articleApi liefert immer den
-- heutigen Stand, eine Historie gibt es bei LINA nicht. Ohne Rueckgriff
-- haette also die gesamte Vergangenheit keine Warengruppe, und
-- mart.deckungsbeitrag_warengruppe waere fuer alles ausser dem laufenden
-- Monat leer.
--
-- Beim Wareneinsatzansatz waere derselbe Rueckgriff falsch: ein Preis von
-- heute auf 2023 angewandt ergibt eine konkrete, konkret falsche Zahl. Eine
-- Warengruppe dagegen ist eine Einordnung, sie aendert sich selten, und die
-- aelteste bekannte ist die beste verfuegbare Schaetzung. Dass es eine
-- Schaetzung ist, weist mart.artikelverkauf.warengruppe_geschaetzt aus -
-- angenommen wird also etwas, verschwiegen nichts.
CREATE VIEW core.artikel_warengruppe_zeitraum AS
SELECT artikel_key,
       CASE WHEN lag(monat) OVER w IS NULL THEN '-infinity'::date ELSE monat END AS gilt_ab,
       monat                                                                     AS erfasst_ab,
       lead(monat) OVER w                                                        AS gilt_bis,
       gross_key, mec_key, detail_key
  FROM core.artikel_warengruppe_stand
WINDOW w AS (PARTITION BY artikel_key ORDER BY monat);

COMMENT ON VIEW core.artikel_warengruppe_zeitraum IS
'Warengruppenzuordnung als Gueltigkeitszeitraeume, wie core.artikel_stand_zeitraum.
UNTERSCHIED: die aelteste bekannte Zuordnung reicht rueckwirkend bis -infinity, weil die
Momentaufnahme nur vorwaerts laeuft und die Historie sonst gar keine Warengruppe haette.
erfasst_ab sagt, ab wann die Zuordnung tatsaechlich BEOBACHTET wurde - alles davor ist
eine Annahme.';


-- ---------------------------------------------------------------------
-- Warenwirtschaft: Einheiten, Lieferanten, Waren
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


-- HIER GILT DATENMINIMIERUNG
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
-- ergaenzt, begruendet das im Ticket. Ein Test in src/sync/e2e.test.ts
-- prueft die Abwesenheit dieser Spalten in der Datenbank nach.
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
die Historie steht in core.ware_stand und core.einkaufspreis_stand.
Nicht zu verwechseln mit core.artikel: Ware ist, was EINGEKAUFT wird, Artikel ist,
was VERKAUFT wird.';

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


-- Einkaufspreise je Ware und Lieferant, monatlich -- APPEND-ONLY
--
-- Der eigentliche Grund fuer die ganze _stand-Mechanik. 299 der 898 Waren
-- haben mehr als einen Lieferantenpreis, deshalb eine eigene Tabelle statt
-- einer Spalte an der Ware.
--
-- RUECKWIRKEND NICHT NACHHOLBAR: LINA speichert nur den jeweils aktuellen
-- Preis. Jeder Monat, in dem diese Momentaufnahme nicht laeuft, ist eine
-- dauerhafte Luecke in der Margenbetrachtung.
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


-- =====================================================================
-- Seed — was LINA nicht liefert oder nur mit Umweg
-- =====================================================================

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
