-- =====================================================================
-- 0030 FoodNotify: Marke, Kostenstelle, POS-Zuordnung, Rezeptur, Einkauf
--
-- Stufe 1.1 aus docs/plan-foodnotify.md.
--
-- WARUM KEIN EIGENES SCHEMA. core bleibt die fachliche Wahrheit, und die
-- Tabellen heissen nach dem Begriff, nicht nach dem System. Kollisionen
-- gibt es nicht: LINAs Tabellen sind nach LINA-BERICHTEN benannt
-- (umsatzbericht_tag, artikelverkauf_tag, kennzahlen_monat), FoodNotifys
-- nach FACHBEGRIFFEN (rezept, zutat, ware, bestellung).
--
-- DIE DREI BEGRIFFE, DIE NICHT VERMISCHT WERDEN DUERFEN. Beide Systeme
-- sagen "Artikel" und meinen Verschiedenes:
--
--   core.artikel   LINA       was VERKAUFT wird - die Position auf dem Bon
--   core.rezept    FoodNotify woraus ein verkaufter Artikel besteht
--   core.ware      FoodNotify was EINGEKAUFT wird - Rohware, Zutat
--
-- Die Kette, die diese Migration ermoeglicht:
--
--   core.artikelverkauf_tag              (LINA: wie oft verkauft)
--        | artikelnummer = pos_artikel.plu
--   core.pos_artikel  -> core.rezept     (FoodNotify: woraus besteht es)
--        | zutat.ware
--   core.ware                            (FoodNotify: Rohware)
--        | bestellposition.ware
--   core.bestellposition                 (was hat sie gekostet, wann)
--
-- JEDE TABELLE TRAEGT DIE MARKE. Vier getrennte Mandanten mit eigenen
-- Zugangsdaten und eigenen ID-Raeumen. Ohne Mandantenspalte kollidieren
-- die IDs beim ersten Import der zweiten Marke -- und zwar still, weil
-- eine fremde ID zufaellig eine gueltige eigene sein kann.
--
-- ---------------------------------------------------------------------
-- WAS HIER ABGERAEUMT WIRD, UND WARUM NICHT NACHGENUTZT
--
-- Sieben Tabellen aus 0002/0003 halten LINAs Warenwirtschaft. Die ist
-- laut Vorgabe vom 27.07.2026 DEMODATEN (AGENTS.md Regel 5) und darf
-- ueberschrieben werden. Vorgefunden am 01.08.2026:
--
--     core.ware                 898   core.bestellposten          18
--     core.ware_stand           898   core.einkaufspreis_stand  1111
--     core.lieferant            540   core.einheit                32
--     core.bestellung             4   core.inventurtermin         11
--
-- Vier Bestellungen und 18 Positionen ueber angeblich 540 Lieferanten --
-- daran haette man es sehen koennen. Es war schlicht ein leeres Modul.
--
-- MIT ECHTER WIRKUNG: mart.preisentwicklung_ware liest core.ware und
-- core.einkaufspreis_stand und liefert 1.111 Zeilen. Die Metabase-Karte
-- "Einkaufspreise im Verlauf" zeigt diese Demodaten heute als echte
-- Einkaufspreise an -- ohne Kennzeichnung. Dieselbe Sorte Fehler wie bei
-- mart.pruefung_wareneinsatz in 0029: eine Zahl, die aussieht wie eine
-- Antwort. Die Sicht wird deshalb mit entfernt und in Stufe 1.7 auf
-- core.bestellposition neu gebaut -- dann auf Belegpreisen.
--
-- WARUM NEU BAUEN STATT UMBENENNEN. Die alten Strukturen tragen LINAs
-- Begriffe und LINAs Annahmen: lina_id als Schluessel, listenpreis
-- (Katalog- statt Belegpreis), liefertage, mindestbestellwert. Es fehlen
-- Marke, Kostenstelle und Belegnummer -- also genau die drei Achsen, um
-- die es bei FoodNotify geht. Ein Umbau waere ein Zwitter, dem man in
-- einem Jahr nicht mehr ansieht, welche Spalte woher stammt.
--
-- core.einheit (32 Zeilen) faellt ebenfalls: FoodNotify liefert eigene
-- Einheiten je Ware, und ein gemeinsamer Einheitenschluessel ueber zwei
-- Systeme hinweg waere eine Uebersetzung, die niemand pflegt.
--
-- WAS BLEIBT. raw.api_antwort ist append-only und behaelt alle bereits
-- geholten Antworten (Regel 4) -- es ist nichts unwiederbringlich weg.
-- Die Transformationsfunktionen in src/transform/index.ts bleiben
-- ebenfalls stehen, samt ihrer Tests: sie sind rein, beschreiben LINAs
-- Antwortstruktur und haben Arbeit gekostet. Geloescht wird die
-- Datenhaltung, nicht das Wissen, wie man die Antwort liest.
--
-- Die Endpunkte stehen in src/lina/endpunkte.ts auf aktiv: false, die
-- fuenf Ladefaelle in src/sync/laden.ts sind entfernt. Wer einen davon
-- wieder einschaltet, braucht beides neu.
-- ---------------------------------------------------------------------

DROP VIEW  IF EXISTS mart.preisentwicklung_ware;
DROP TABLE IF EXISTS core.einkaufspreis_stand;
DROP TABLE IF EXISTS core.bestellposten;
DROP TABLE IF EXISTS core.bestellung;
DROP TABLE IF EXISTS core.ware_stand;
DROP TABLE IF EXISTS core.ware;
DROP TABLE IF EXISTS core.lieferant;
DROP TABLE IF EXISTS core.einheit;
DROP TABLE IF EXISTS core.inventurtermin;
-- =====================================================================


-- ---------------------------------------------------------------------
-- Marke -- der Mandant
-- ---------------------------------------------------------------------

CREATE TABLE core.marke (
    marke_key       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    schluessel      text        NOT NULL UNIQUE,
    name            text        NOT NULL,
    aktiv           boolean     NOT NULL DEFAULT true,
    angelegt_am     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.marke IS
'Die vier Marken, die FoodNotify nutzen. NICHT zu verwechseln mit core.konzept:
das sind LINAs 14 Konzepte. Eine FoodNotify-Marke ist ein MANDANT mit eigenem
Zugang, eigenem ID-Raum und eigener Rezepturpflege (geprueft am 01.08.2026:
Aposto 672 Rezepte, Enchilada 1.846 -- getrennte Bestaende).';
COMMENT ON COLUMN core.marke.schluessel IS
'Kleingeschrieben mit Unterstrich. Traegt zugleich den Namen der Umgebungs-
variablen: schluessel "aposto" -> FN_APOSTO_USER / FN_APOSTO_PASSWORD. Damit
ist die Zuordnung ohne Uebersetzungstabelle lesbar.';

INSERT INTO core.marke (schluessel, name) VALUES
    ('aposto',            'Aposto'),
    ('enchilada',         'Enchilada'),
    ('deutsche_konzepte', 'Deutsche Konzepte'),
    ('wilma_wunder',      'Wilma Wunder');


-- ---------------------------------------------------------------------
-- Kostenstelle -- Bar oder Kueche eines Betriebs
--
-- DREI SCHLUESSELEBENEN, die nicht verwechselt werden duerfen:
--
--   restaurant_id     10945   der Betrieb
--   kostenstelle_id   11544   die Kostenstelle (Bar oder Kueche)
--   erp_id            11033   die Warenwirtschaft dieser Kostenstelle
--
-- Alle drei kommen aus /api/erp/all und werden gebraucht: erp_id fuer
-- Bestellungen und Waren, kostenstelle_id fuer Inventuren, restaurant_id
-- fuer die Zuordnung zum LINA-Betrieb.
-- ---------------------------------------------------------------------

CREATE TABLE core.kostenstelle (
    kostenstelle_key integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    marke_key        integer NOT NULL REFERENCES core.marke(marke_key),
    kostenstelle_id  integer NOT NULL,
    restaurant_id    integer NOT NULL,
    erp_id           integer,
    name             text    NOT NULL,
    restaurant_name  text    NOT NULL,
    art              text    NOT NULL DEFAULT 'sonstige'
                     CHECK (art IN ('bar', 'kueche', 'sonstige')),
    art_bestaetigt   boolean NOT NULL DEFAULT false,
    -- Die Kassenanbindung. NULL heisst: dieser Kostenstelle haengt keine
    -- Kasse an -- bei Aposto 23 von 27.
    connection_id    integer,
    kassensystem     text,
    betrieb_key      integer REFERENCES core.betrieb(betrieb_key),
    erstmals_am      timestamptz NOT NULL DEFAULT now(),
    zuletzt_am       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (marke_key, kostenstelle_id)
);
COMMENT ON TABLE core.kostenstelle IS
'Kostenstellen aus /api/erp/all und /api/pos/locations. Ein LINA-Betrieb
entspricht ZWEI Kostenstellen: Bar und Kueche. Genau das ermoeglicht den
Bar/Kueche-Split, den mart.pruefung_wareneinsatz nie bilden konnte -- dort
haengt die Hauptsparte am Umsatzbericht, nicht am Artikel.';
COMMENT ON COLUMN core.kostenstelle.art IS
'bar | kueche | sonstige, aus dem Namen abgeleitet und MANUELL BESTAETIGT
(art_bestaetigt). Gemessen am 01.08.2026 fuer Aposto: 13 Bar, 13 Kueche,
1 unklar ("AAA Testbetrieb Aposto"). Die Ableitung traegt also fast immer,
aber nicht immer -- deshalb ist sie ein Vorschlag und kein Automatismus.';
COMMENT ON COLUMN core.kostenstelle.name IS
'Wie FoodNotify ihn liefert -- MIT etwaigem Leerzeichen am Ende (bei Aposto
4 von 27) und mit typografischen Apostrophen ("Lehner''s" gegen "Lehner´s").
Nicht trimmen, nicht normalisieren: der Rohwert ist der Beleg. Wer vergleicht,
trimmt beim Vergleich.';
COMMENT ON COLUMN core.kostenstelle.betrieb_key IS
'Die Bruecke zu LINA. NULL, solange nicht zugeordnet. BEWUSST HIER und nicht
in manual.betrieb_fremd_id: deren PRIMARY KEY (betrieb_key, system) laesst nur
EINE Fremd-ID je Betrieb und System zu -- ein LINA-Betrieb hat aber ZWEI
FoodNotify-Kostenstellen. Die Zuordnung ist n:1, nicht 1:1.

Namensaehnlichkeit darf als VORSCHLAG dienen, nie als automatische Zuordnung:
LINA sagt "Aposto Karlsruhe GmbH", FoodNotify "Bar Aposto Karlsruhe".';
COMMENT ON COLUMN core.kostenstelle.connection_id IS
'Der Schluessel fuer /api/pos/mapping/{connectionId}/articles -- und damit fuer
die einzige Bruecke zwischen LINA-Artikel und FoodNotify-Rezept. NICHT die
erp_id, nicht die kostenstelle_id, nicht die restaurant_id: genau diese
Verwechslung liess die POS-Zuordnung im Inventar vom 27.07.2026 als
unauffindbar erscheinen.';
COMMENT ON COLUMN core.kostenstelle.kassensystem IS
'deviceType.name aus /api/pos/locations, etwa "amadeus" oder "ikentoo".

ENTSCHEIDET, OB DIE PLU-BRUECKE TRAEGT. Nur bei amadeus ist plu dieselbe
Nummer wie core.artikel.artikelnummer (99,7 % Namensgleichheit gegen 0,3 %
Zufallserwartung). Bei ikentoo laeuft ein eigener, kleiner Nummernkreis
(8-580); ein Join dorthin trifft still falsche Artikel, weil kleine Nummern
bei uns dicht besetzt sind. Siehe docs/foodnotify-0-1-nummernraum.md.';

CREATE INDEX kostenstelle_betrieb ON core.kostenstelle (betrieb_key);
CREATE INDEX kostenstelle_erp     ON core.kostenstelle (marke_key, erp_id);


-- ---------------------------------------------------------------------
-- Rezept und Zutat
-- ---------------------------------------------------------------------

CREATE TABLE core.rezept (
    rezept_key      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    marke_key       integer NOT NULL REFERENCES core.marke(marke_key),
    fn_id           integer NOT NULL,
    name            text    NOT NULL,
    erstellt_am     timestamptz,
    gruppen         text[],
    erstmals_am     timestamptz NOT NULL DEFAULT now(),
    zuletzt_am      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (marke_key, fn_id)
);
COMMENT ON TABLE core.rezept IS
'Rezepte aus /api/recipes. JE MARKE GETRENNT gepflegt (Aposto 672,
Enchilada 1.846) -- deshalb marke_key im Schluessel, sonst kollidieren die
fn_id beim zweiten Mandanten.';
COMMENT ON COLUMN core.rezept.gruppen IS
'Aus recipe.groups[].name. Traegt unter anderem "POS" und den Namen des
Kassensystems ("amadeus") -- ein Hinweis darauf, wofuer das Rezept gedacht ist.';

CREATE TABLE core.zutat (
    zutat_key       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rezept_key      integer NOT NULL REFERENCES core.rezept(rezept_key) ON DELETE CASCADE,
    fn_id           bigint,
    position        integer NOT NULL,
    art             text    NOT NULL CHECK (art IN ('ingredient', 'sub_recipe')),
    name            text    NOT NULL,
    ware_fn_id      text,
    sub_rezept_key  integer REFERENCES core.rezept(rezept_key),
    menge           numeric(14,4),
    einheit         text,
    kosten          numeric(14,6),
    lieferant_name  text,
    UNIQUE (rezept_key, position)
);
COMMENT ON TABLE core.zutat IS
'Zutaten je Rezept aus /api/recipes/{id}/ingredients.';
COMMENT ON COLUMN core.zutat.kosten IS
'cost aus der Antwort: die Kosten DIESER Zutat in dieser Menge, in Euro.
Sechs Nachkommastellen, weil FoodNotify sie so liefert (0,807000322800129).

DAS IST DER SOLL-WARENEINSATZ, FERTIG GERECHNET. Summiert je Rezept und
multipliziert mit core.artikelverkauf_tag.menge ergibt sich der theoretische
Wareneinsatz -- ohne FoodNotifys eigene Verkaufsverarbeitung, die seit Juli
2026 an einem Datenbankfehler scheitert. Belegt an Aposto Gera, Juni 2026:
19,8 % Wareneinsatzquote. Siehe docs/entscheidungen.md.';
COMMENT ON COLUMN core.zutat.ware_fn_id IS
'artikelId aus der Antwort -- die LIEFERANTEN-Artikelnummer der Rohware,
dieselbe Art Schluessel wie shopArticleId in den Inventurpositionen. Zeigt
auf core.ware, NICHT auf core.artikel.

Geprueft am 01.08.2026: von 47 artikelId trafen 4 eine core.artikelnummer,
alle auf Artikel ohne Namen, keiner bestaetigbar. Text und nicht integer,
weil FoodNotify sie als String liefert und fuehrende Nullen moeglich sind.';
COMMENT ON COLUMN core.zutat.sub_rezept_key IS
'REZEPTE ENTHALTEN REZEPTE. Von 92 geprueften Zutaten waren 20 Unterrezepte.
Die Kostenaufloesung muss deshalb rekursiv sein (WITH RECURSIVE, Stufe 2.1)
und braucht einen Zyklusschutz -- ein Rezept, das sich mittelbar selbst
enthaelt, laesst die Abfrage sonst nicht terminieren. Kosten duerfen erst auf
der untersten Ebene summiert werden.';

CREATE INDEX zutat_rezept     ON core.zutat (rezept_key);
CREATE INDEX zutat_ware       ON core.zutat (ware_fn_id);
CREATE INDEX zutat_sub_rezept ON core.zutat (sub_rezept_key) WHERE sub_rezept_key IS NOT NULL;


-- ---------------------------------------------------------------------
-- POS-Zuordnung -- die Bruecke zu LINA
--
-- ALS MONATSMOMENTAUFNAHME, wie core.artikel_stand. Die Zuordnung wird
-- gepflegt: recipeId aendert sich, Artikel kommen dazu, Preise auch. Wer
-- wissen will, welches Rezept im Maerz hinter einem Artikel stand, braucht
-- den Stand von Maerz. Ohne Historie ist keine Rueckrechnung moeglich --
-- derselbe Fehler, den 0007 fuer die Artikel behoben hat.
-- ---------------------------------------------------------------------

CREATE TABLE core.pos_artikel (
    kostenstelle_key integer NOT NULL REFERENCES core.kostenstelle(kostenstelle_key),
    monat            date    NOT NULL,
    plu              text    NOT NULL,
    remote_id        bigint,
    name             text    NOT NULL,
    rezept_key       integer REFERENCES core.rezept(rezept_key),
    preis            numeric(12,4),
    mwst             numeric(5,2),
    ignoriert        boolean NOT NULL DEFAULT false,
    geladen_am       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (kostenstelle_key, monat, plu)
);
COMMENT ON TABLE core.pos_artikel IS
'Die Zuordnung POS-Artikel zu Rezept, aus /api/pos/mapping/{connectionId}/articles.
Monatsmomentaufnahme, weil die Pflege sich aendert.

DAS IST DIE EINZIGE STELLE, AN DER LINA UND FOODNOTIFY FACHLICH ZUSAMMENTREFFEN.
Der Join ist plu = core.artikel.artikelnummer, UND ER GILT NUR, WO
kostenstelle.kassensystem = ''amadeus'' -- siehe Kommentar dort.

Stand 01.08.2026 ist die Zuordnung duenn: in Aposto Gera 146 von 1.283 Artikeln
(11 %), die aber knapp die Haelfte des Umsatzes tragen (1,77 von 3,54 Mio. EUR).
Das ist eine Pflegefrage bei Concept Family, kein technisches Problem.';
COMMENT ON COLUMN core.pos_artikel.plu IS
'Die Kassenartikelnummer. Text und nicht bigint: FoodNotify liefert sie als
String, und bei anderen Kassensystemen sind nichtnumerische Werte moeglich.
Fuer den Join gegen core.artikel.artikelnummer beidseitig als Text vergleichen.';
COMMENT ON COLUMN core.pos_artikel.rezept_key IS
'NULL heisst: dieser Artikel hat kein Rezept. Das ist der Normalfall, nicht die
Ausnahme -- und genau die Zahl, die zaehlt, wenn jemand fragt, wie belastbar der
theoretische Wareneinsatz ist.';

CREATE INDEX pos_artikel_plu    ON core.pos_artikel (plu);
CREATE INDEX pos_artikel_rezept ON core.pos_artikel (rezept_key) WHERE rezept_key IS NOT NULL;


-- ---------------------------------------------------------------------
-- Warenstamm
-- ---------------------------------------------------------------------

CREATE TABLE core.warengruppe_fn (
    warengruppe_fn_key integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    marke_key          integer NOT NULL REFERENCES core.marke(marke_key),
    fn_id              integer NOT NULL,
    name               text    NOT NULL,
    art                text    NOT NULL DEFAULT 'commodity'
                       CHECK (art IN ('commodity', 'product')),
    UNIQUE (marke_key, fn_id, art)
);
COMMENT ON TABLE core.warengruppe_fn IS
'Warengruppen aus /api/erp/commodity-groups und /api/erp/product-groups.
Suffix _fn, weil core.warengruppe bereits LINAs Sortimentshierarchie haelt --
zwei verschiedene Gliederungen fuer zwei verschiedene Dinge: LINA gliedert,
was verkauft wird, FoodNotify, was eingekauft wird.';

CREATE TABLE core.ware (
    ware_key        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    marke_key       integer NOT NULL REFERENCES core.marke(marke_key),
    fn_id           text    NOT NULL,
    name            text    NOT NULL,
    einheit         text,
    basis_einheit   text,
    warengruppe_fn_key integer REFERENCES core.warengruppe_fn(warengruppe_fn_key),
    lieferant_key   integer,
    erstmals_am     timestamptz NOT NULL DEFAULT now(),
    zuletzt_am      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (marke_key, fn_id)
);
COMMENT ON TABLE core.ware IS
'Rohware aus /api/{erpId}/products. Was EINGEKAUFT wird -- nicht zu verwechseln
mit core.artikel (was verkauft wird).';
COMMENT ON COLUMN core.ware.fn_id IS
'artikelId bzw. concreteProduct.id. Dieselbe Nummer, die in core.zutat.ware_fn_id
steht -- diese Verknuepfung ist systemintern und braucht kein Matching.';

CREATE TABLE core.ware_stand (
    ware_key        integer NOT NULL REFERENCES core.ware(ware_key),
    monat           date    NOT NULL,
    preis_je_einheit numeric(14,6),
    bestand         numeric(14,4),
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ware_key, monat)
);
COMMENT ON TABLE core.ware_stand IS
'Preis und Bestand je Ware und Monat. MOMENTAUFNAHME wie core.artikel_stand:
pricePerUnit und stock aendern sich, und der Warenstamm kennt nur den aktuellen
Wert. Ohne diese Tabelle waere jede Rueckrechnung auf einen vergangenen Monat
mit heutigen Preisen gerechnet -- plausibel aussehend und still falsch.

Die BELEGPREISE stehen dagegen in core.bestellposition und tragen ihr eigenes
Datum; daraus entsteht die Preishistorie von selbst. Diese Tabelle ist die
Ergaenzung fuer Waren, die im Zeitraum nicht bestellt wurden.';


-- ---------------------------------------------------------------------
-- Einkauf -- der eigentliche Gewinn
-- ---------------------------------------------------------------------

CREATE TABLE core.lieferant (
    lieferant_key   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    marke_key       integer NOT NULL REFERENCES core.marke(marke_key),
    fn_id           text    NOT NULL,
    name            text    NOT NULL,
    UNIQUE (marke_key, fn_id)
);
COMMENT ON TABLE core.lieferant IS
'Lieferanten aus markedShop der Bestellungen. NICHT aus LINAs /wawi/api/suppliers --
das sind Demodaten (540 Stueck, siehe AGENTS.md Regel 5).';

ALTER TABLE core.ware
    ADD CONSTRAINT ware_lieferant_fk
    FOREIGN KEY (lieferant_key) REFERENCES core.lieferant(lieferant_key);

CREATE TABLE core.bestellung (
    bestellung_key   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kostenstelle_key integer NOT NULL REFERENCES core.kostenstelle(kostenstelle_key),
    fn_id            text    NOT NULL,
    bestellnummer    text,
    lieferant_key    integer REFERENCES core.lieferant(lieferant_key),
    bestellt_am      timestamptz,
    geliefert_am     date,
    status           text,
    summe            numeric(14,2),
    beleg_nummer     text,
    beleg_datum      date,
    kommentar        text,
    raw_id           bigint,
    geladen_am       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (kostenstelle_key, fn_id)
);
COMMENT ON TABLE core.bestellung IS
'Bestellkoepfe aus /api/{erpId}/shop-order/paginate und /{orderId}.
Bei Aposto 11.578 Stueck ueber alle 26 Kostenstellen, aelteste vom 15.10.2021 --
die einzige Marke mit flaechendeckender Bestellhistorie.';
COMMENT ON COLUMN core.bestellung.beleg_nummer IS
'invoiceNumber aus shopOrderInvoices[]. DIE RECHNUNGEN HAENGEN AN DER BESTELLUNG --
damit sind es echte Belegpreise, nicht Katalogpreise wie in LINAs WAWI.';

CREATE TABLE core.bestellposition (
    bestellposition_key bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bestellung_key   integer NOT NULL REFERENCES core.bestellung(bestellung_key) ON DELETE CASCADE,
    fn_id            text,
    ware_key         integer REFERENCES core.ware(ware_key),
    name             text    NOT NULL,
    menge            numeric(14,4),
    gebinde_menge    numeric(14,4),
    einheit          text,
    gesamt_menge     numeric(14,4),
    einzelpreis      numeric(14,6),
    summe_preis      numeric(14,2),
    neuer_preis      numeric(14,6),
    preis_abweichend boolean NOT NULL DEFAULT false,
    ersetzt          boolean NOT NULL DEFAULT false
);
COMMENT ON TABLE core.bestellposition IS
'Positionen aus /api/{erpId}/shop-order/{orderId}/change. Preis je Position,
Gebindegroesse, Einheit, normalisierte Gesamtmenge -- und ueber ware_key die
Verknuepfung zum Warenstamm.

WEIL JEDE BESTELLUNG EIN DATUM TRAEGT, ENTSTEHT DIE PREISHISTORIE VON SELBST.
Genau das, was in docs/datensicherung.md als "rueckwirkend nicht nachholbar"
notiert ist -- hier ist es nachholbar, soweit die Bestellhistorie reicht.';
COMMENT ON COLUMN core.bestellposition.preis_abweichend IS
'isNotEqualSumPrice: der berechnete Preis weicht vom bestellten ab. Zusammen mit
neuer_preis (newPrice) macht das Preisaenderungen zwischen Bestellung und
Lieferung sichtbar -- eine eigene Auswertung wert.';

CREATE INDEX bestellung_kostenstelle ON core.bestellung (kostenstelle_key, bestellt_am);
CREATE INDEX bestellung_lieferant    ON core.bestellung (lieferant_key);
CREATE INDEX bestellposition_ware    ON core.bestellposition (ware_key);
CREATE INDEX bestellposition_kopf    ON core.bestellposition (bestellung_key);
