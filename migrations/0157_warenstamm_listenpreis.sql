-- =====================================================================
-- 0157 Warenstamm taeglich als Stand, Listenpreis-Verlauf, und eine
--      Einkaufspreis-Reihe ueber die Lieferanten-Artikelnummer
--
-- ANLASS (Entscheidung Eugene, 19.11.2026): die Preisentwicklung der Waren
-- besser erfassen. Zwei Teile in einer Datei.
--
-- TEIL A — WARENSTAMM (fn:warenstamm, core.ware_stand seit 0030 leer)
--
-- Gemessen am 19.11.2026 (docs/payloads/foodnotify-2026-11/
-- fn-probe-2026-11-19-tag.md, Abschnitt 2; Rohantworten in
-- belege/fn-probe-2026-11-19-0612/, nicht in Git):
--
--   GET /api/{erpId}/products?page=1&page_size=1000   (Cookie-Sitzung)
--   -> {errors, code, isError, payload: {current_page, current_page_size,
--       page_count, total_count, order_by, order_direction, currency, data[]}}
--
-- ZWEI KOSTENSTELLEN GEMESSEN, UND DIE ERSTE WAR EIN TESTRESTAURANT.
-- ~~Kostenstelle 11035 (Wilma Wunder)~~ — 11035 ist "AAA Testrestaurant Wilma
-- Wunder Bar" (die Probe nahm die alphabetisch ersten Kostenstellen,
-- docs/fehlerkatalog.md 19.11.2026): 746 Produkte in einem Aufruf, 1,07 MB,
-- 6,4 s, aber KEIN Katalog angebunden. Massgeblich ist die echte Kostenstelle
-- 7984 (Bar Ballplatz Mainz, 19.11.2026 07:29 UTC,
-- docs/payloads/foodnotify-2026-11/fn-probe-2026-11-19-echt.md): 206 Produkte
-- in einem Aufruf, 813 KB, 4,6 s. Ob es ueber 1000 eine Obergrenze gibt, ist
-- nicht gemessen; der Lader holt deshalb weitere Seiten, wenn die Antwort mehr
-- meldet, und prueft jede Seite gegen total_count und current_page_size.
--
-- Befunde, die den Bau bestimmt haben (am Klon nachgemessen, 19.11.2026):
--
--   1. unitPrice IST DER PREIS JE BASISEINHEIT (kg, l), nicht je Gebinde, und
--      FOLGT DEM PREIS DER LETZTEN BESTELLUNG. Bar Ballplatz gegen die eigenen
--      Bestellungen (Bestand bis 02.08.2026): 163 Waren gefunden, 141 treffen
--      preis_je_einheit der letzten Bestellung auf 2 %, 28 den Gebindepreis —
--      bei Inhalt <> 1 sind es 111 gegen 2; seit Juni bestellt 99 von 106.
--      (Am Testrestaurant gegen ganz Wilma Wunder: 438 / 109 von 733.)
--   2. pricePerUnit IST DER PREIS IM LIEFERANTENKATALOG, und nur bei
--      bestellbaren Waren gefuellt. ~~pricePerUnit, packagingUnit(s) sind immer
--      null~~ — das galt im Testrestaurant (kein Katalog). Bei 7984 traegt
--      jede Ware mit isOrderable (110 von 206) einen Katalogeintrag
--      (productForShow), 109 davon pricePerUnit {quantity 1, unit KG/L, price}
--      und packagingUnit(s) mit Gebindepreis. pricePerUnit.price = unitPrice
--      bei 105 von 109; in den vier anderen liegt der Katalog UNTER unitPrice,
--      und dreimal ist unitPrice genau der Preis der letzten Bestellung — der
--      Katalog hat sich bewegt, der Warenstamm noch nicht. Deshalb ZWEI Preise
--      in core und im Verlauf: listenpreis (unitPrice) und katalogpreis.
--   3. timeModified ~~IST KEIN PREISAENDERUNGSDATUM (650 von 746 tragen 2024)~~
--      — das war das Testrestaurant. Bei 7984 liegt es zwischen 19.08. und
--      19.11.2026 (40 Produkte am 19.08.), bewegt sich also. Was es ausloest,
--      ist nicht gemessen; es steht als fn_geaendert_am da, nicht als
--      Preisdatum. Die Preisreihe entsteht aus unseren eigenen Beobachtungen
--      und beginnt am Tag des ersten Abzugs.
--   4. artikelId ist je Kostenstelle NICHT ZUGESICHERT EINDEUTIG: im
--      Testrestaurant 739 Nummern fuer 742 Produkte (dieselbe Nummer bei zwei
--      Lieferanten), bei 7984 194 von 194. Lieferant + artikelId war in beiden
--      eindeutig. 12 von 206 Produkten bei 7984 haben keine Nummer (6
--      Eigenproduktion, 6 Kleinlieferanten mit leerem artikelId). shop.id ist
--      core.lieferant.fn_id (Testrestaurant 11 von 11).
--
-- TEIL B — mart.einkaufspreis_artikel_monat (kein neuer Abruf)
--
-- Die bezahlten Preise je Lieferant und Lieferanten-Artikelnummer statt je
-- Warenname. Abschnitt 8 unten.
--
-- WAS DIESE MIGRATION ANLEGT
--   1. core.ware_stand neu: ZUSTAND je (Kostenstelle, Produkt) statt
--      Monatsmomentaufnahme je Ware
--   2. core.listenpreis_beobachtung — Verlauf des Listenpreises
--   3. core.ware_stand_abruf — Stand des Abzugs je Kostenstelle
--   4. core.warenstamm_zeilen(), core.warenstamm_laden(),
--      core.warenstamm_neu_aufbauen() — EIN Lader fuer Nachtlauf und
--      Neuaufbau aus raw (Regel 4)
--   5. mart.listenpreis_aktuell, mart.listenpreis_aenderung,
--      mart.warenstamm_stand
--   6. eine Zeile in mart.pruefung_uebersicht
--   7. sync.quelle: fn:warenstamm und core:ware_stand erwartet
--   8. mart.einkaufspreis_artikel_monat_basis (materialisiert) und
--      mart.einkaufspreis_artikel_monat, Eintrag in
--      mart.materialisierung_stand
--   9. MCP-Katalog, Fallstricke, Rechte, Leseprobe als mcp_leser
--
-- Der Importer (Registereintrag fn:warenstamm, Einreihweg, Schalter
-- WARENSTAMM_MARKEN — vorerst nur wilma_wunder) steht im selben Zug.
-- GEBAUT GEGEN DIE ATTRAPPE, in Produktion noch nicht gelaufen.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. core.ware_stand: Zustand je Kostenstelle und Produkt
--
-- 0030 legte die Tabelle als Monatsmomentaufnahme je Ware an (PK ware_key,
-- monat; preis_je_einheit, bestand). Drei Gruende fuer den Umbau:
--
--   * DER SCHLUESSEL. Der Warenstamm gehoert der KOSTENSTELLE: dieselbe
--     Ware steht in Bar und Kueche als zwei Produkte mit eigener id, eigenem
--     Preis und eigenem Bestand. core.ware ist je Marke und Nummernraum
--     geschluesselt (0042) — die Lieferantennummer 5222 zweier Lieferanten
--     faellt dort in EINE Ware. Ein ware_key waere also an genau der Stelle
--     ungenau, an der der Warenstamm genau ist.
--   * DAS PRODUKT, NICHT DIE ARTIKELNUMMER. Schluessel ist die Produkt-id
--     der Kostenstelle (Feld `id`): je Antwort eindeutig (7984: 206 von 206,
--     Testrestaurant 746 von 746), von FoodNotify vergeben, sie bleibt, wenn
--     der Lieferant die Artikelnummer wechselt (0094: Cheddar/Gouda Mix von 268
--     auf 500096). artikelId ist je Kostenstelle nicht zugesichert eindeutig
--     (siehe Kopf), fehlt bei 12 von 206 (Eigenproduktion, Kleinlieferanten),
--     und ihr Wechsel soll im Verlauf als Aenderung sichtbar sein, statt eine
--     Reihe abzubrechen.
--   * NACH AENDERUNG, NICHT JE MONAT. Der Stand wird jede Nacht
--     ueberschrieben; was sich am Listenpreis aendert, haelt
--     core.listenpreis_beobachtung fest. Eine Monatskopie haette die
--     Preisaenderung innerhalb des Monats verschluckt, eine Tageskopie
--     ~25.000 Zeilen je Nacht dupliziert, die sich fast nie aendern.
--
-- Die Tabelle ist leer (in Produktion am 14.08.2026 nachgezaehlt, kein
-- Schreiber im Repo, keine Sicht haengt an ihr). Die Migration bricht ab,
-- falls doch Zeilen darin stehen.
--
-- TESTKOSTENSTELLEN werden mit abgezogen (Wilma Wunder: "AAA Testrestaurant"
-- Bar und Kueche, "CF GASTRO TESTBETRIEB", "DISTRA TESTBETRIEB" — 4 von 35
-- Kostenstellen mit erpId). Nicht still gefiltert: sie haben keinen Betrieb
-- und stehen in mart.warenstamm_stand als 'ohne betrieb'. Der
-- Kostenstellenvergleich in mart.listenpreis_aktuell rechnet nur mit
-- Kostenstellen, die einem Betrieb zugeordnet sind.
-- ---------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM core.ware_stand) THEN
        RAISE EXCEPTION '0157: core.ware_stand ist nicht leer — der Umbau verwirft (ware_key, monat). '
                        'Erst klaeren, wer dort geschrieben hat.';
    END IF;
END $$;

DROP TABLE core.ware_stand;

CREATE TABLE core.ware_stand (
    kostenstelle_key    integer      NOT NULL REFERENCES core.kostenstelle(kostenstelle_key),
    produkt_id          integer      NOT NULL,
    fn_produkt_id       integer,
    artikelnummer       text,
    name                text         NOT NULL,
    lieferant_fn_id     text,
    lieferant_name      text,
    einheit             text,
    inhalt              numeric(14,6),
    gebinde_menge       numeric(14,4),
    listenpreis         numeric(14,6),
    katalogpreis        numeric(14,6),
    katalogpreis_einheit text,
    katalog_gebinde     text,
    katalog_gebinde_menge numeric(14,4),
    katalog_gebinde_preis numeric(14,4),
    katalog_gebinde_alle jsonb,
    katalog_produkt_id  integer,
    rezept_fn_id        integer,
    bestellbar          boolean,
    verfuegbar          boolean,
    in_inventur         boolean,
    bestand_menge       numeric(14,4),
    bestand_wert        numeric(14,4),
    bestand_deaktiviert boolean,
    fn_geaendert_am     timestamptz,
    erstmals_am         timestamptz  NOT NULL,
    geaendert_am        timestamptz  NOT NULL,
    zuletzt_gesehen_am  timestamptz  NOT NULL,
    fehlt_seit          timestamptz,
    raw_id              bigint,
    PRIMARY KEY (kostenstelle_key, produkt_id)
);

CREATE INDEX ware_stand_artikelnummer ON core.ware_stand (lieferant_fn_id, artikelnummer)
    WHERE artikelnummer IS NOT NULL;
CREATE INDEX ware_stand_zuletzt ON core.ware_stand (zuletzt_gesehen_am);

COMMENT ON TABLE core.ware_stand IS
'Warenstamm je Kostenstelle: ein Produkt je Zeile, der ZUSTAND der letzten erfolgreichen Antwort von
/api/{erpId}/products (fn:warenstamm, seit 0157). Was eingekauft wird — nicht core.artikel (verkauft).
Der Listenpreis-Verlauf steht in core.listenpreis_beobachtung, der Bestandsverlauf NUR in raw.api_antwort
(jede Antwort, append-only): ein Bestandsverlauf ist nicht beauftragt und nicht gebaut. core ist aus raw neu
aufbaubar (core.warenstamm_neu_aufbauen()). Ein Abbruch aendert nichts; ein Produkt, das ein VOLLSTAENDIGER
Abzug nicht mehr nennt, bekommt fehlt_seit und bleibt stehen. Vorerst nur Wilma Wunder (WARENSTAMM_MARKEN).
Auswertung: mart.listenpreis_aktuell, mart.listenpreis_aenderung, mart.warenstamm_stand.';
COMMENT ON COLUMN core.ware_stand.produkt_id IS
'id — FoodNotifys Kennung des Produkts IN DIESER KOSTENSTELLE. Schluessel, weil je Antwort eindeutig und
stabil, wenn der Lieferant die Artikelnummer wechselt. Dieselbe Ware in Bar und Kueche hat zwei produkt_id.';
COMMENT ON COLUMN core.ware_stand.fn_produkt_id IS
'productId (= ingredient.id) — FoodNotifys Warennummer hinter dem Produkt. Bedeutung ueber Kostenstellen
hinweg nicht gemessen. NULL bei Eigenproduktion.';
COMMENT ON COLUMN core.ware_stand.artikelnummer IS
'artikelId — die LIEFERANTEN-Artikelnummer, dieselbe Art Nummer wie core.bestellposition.lieferanten_nr und
core.zutat.artikelnummer. Nur zusammen mit dem Lieferanten sicher eindeutig (Testrestaurant: 739 Nummern fuer
742 Produkte; Bar Ballplatz 7984: 194 von 194). NULL bei Eigenproduktion und bei leerem artikelId
(Kleinlieferanten, 6 von 206 bei 7984).';
COMMENT ON COLUMN core.ware_stand.lieferant_fn_id IS
'shop.id — dieselbe Nummer wie core.lieferant.fn_id derselben Marke (19.11.2026, Testrestaurant: 11 von 11; bei
7984 sind die Lieferanten ueber (fn_id, lieferanten_nr) in den Bestellungen gefunden). Aufloesen in
den Sichten ueber (marke_key, fn_id), nicht beim Laden: der Lieferant kommt in core.lieferant erst mit der
ersten Bestellung an. NULL bei Eigenproduktion.';
COMMENT ON COLUMN core.ware_stand.einheit IS 'unit.name — die Basiseinheit des Listenpreises (kg, l, selten baseUnit).';
COMMENT ON COLUMN core.ware_stand.inhalt IS
'unitQuantity — Inhalt eines Gebindes in der Einheit (0,27 kg fuer einen Karton 6 x 15 x 3 g Tee). Dieselbe
Groesse, die transform.ts bei Bestellpositionen als inhalt liest. Bei 7984 trifft listenpreis x inhalt bei 96
von 110 Katalogwaren einen Gebindepreis aus packagingUnits. Im Testrestaurant auch unsinnige Werte (0,003 kg
fuer eine Kiste mit 10 Rettich) — der Wert ist Pflege in FoodNotify, nicht geprueft.';
COMMENT ON COLUMN core.ware_stand.gebinde_menge IS
'packagingQuantity — wie core.bestellposition.gebinde_menge. Fast immer 1 (7984: 200 von 206, die uebrigen 6
sind Eigenproduktion ohne Wert). baseUnitQuantity und baseUnitUnit sind in beiden gemessenen Kostenstellen
immer null und werden nicht gelesen. ~~packagingUnit, packagingUnits und pricePerUnit sind IMMER null~~ —
das galt nur im Testrestaurant ohne Katalog; siehe katalog*.';
COMMENT ON COLUMN core.ware_stand.listenpreis IS
'unitPrice — Preis JE EINHEIT (kg, l), netto EUR, wie FoodNotify ihn im Warenstamm fuehrt, fuer jedes Produkt
gefuellt. Nicht der Gebindepreis: der ist rechnerisch listenpreis x inhalt x gebinde_menge
(mart.listenpreis_aktuell). FOLGT DEM PREIS JE EINHEIT DER LETZTEN BESTELLUNG (Bar Ballplatz 19.11.2026: 141
von 163 auf 2 %, seit Juni bestellt 99 von 106) — er ist kein Lieferantenkatalog, den fuehrt katalogpreis.
0 heisst kein Preis (Testrestaurant 4 von 746, 7984 keiner), keine Gratisware. Auf 6 Nachkommastellen
gerundet (FoodNotify liefert 3,3166666667); NULL, wenn der Wert nicht in die Spalte passt.';
COMMENT ON COLUMN core.ware_stand.katalogpreis IS
'pricePerUnit.price — der Preis JE EINHEIT im angebundenen LIEFERANTENKATALOG, netto EUR. Nur bei Waren mit
Katalogeintrag (bestellbar, productForShow): bei 7984 109 von 206, im Testrestaurant keine. Gleich listenpreis
bei 105 von 109; in den vier anderen lag er darunter, und listenpreis war der Preis der letzten Bestellung —
der Katalog hatte sich bewegt. NULL heisst kein Katalogpreis, nicht 0.';
COMMENT ON COLUMN core.ware_stand.katalogpreis_einheit IS 'pricePerUnit.unit — gemessen KG und L (zu einheit kg und l), Menge immer 1.';
COMMENT ON COLUMN core.ware_stand.katalog_gebinde IS 'packagingUnit.label — die Bestelleinheit im Katalog ("Karton (6)", "Flasche (1)").';
COMMENT ON COLUMN core.ware_stand.katalog_gebinde_menge IS 'packagingUnit.quantity — Stueck je Bestelleinheit.';
COMMENT ON COLUMN core.ware_stand.katalog_gebinde_preis IS
'packagingUnit.price.amount — Preis der Bestelleinheit im Katalog, netto EUR. Bei 8 von 110 Katalogwaren (7984) ohne Preis.';
COMMENT ON COLUMN core.ware_stand.katalog_gebinde_alle IS
'packagingUnits — alle Bestelleinheiten des Katalogs mit Preis, wie geliefert (meist eine, bei 6 von 110 zwei).';
COMMENT ON COLUMN core.ware_stand.katalog_produkt_id IS 'productForShow.id — das Katalogprodukt des Lieferanten hinter dem Produkt.';
COMMENT ON COLUMN core.ware_stand.rezept_fn_id IS
'recipeProduct.recipe.id — das Produkt ist Eigenproduktion aus diesem Rezept (core.rezept.fn_id derselben
Marke), dann ohne Lieferant und Artikelnummer. Der Listenpreis ist dann FoodNotifys Rezeptkalkulation.';
COMMENT ON COLUMN core.ware_stand.bestellbar IS
'isOrderable — die Ware haengt an einem Lieferantenkatalog (7984: 110 von 206 true, genau die mit
productForShow). ~~am 19.11.2026 bei ALLEN 746 Produkten false, Bedeutung ungeklaert~~ — das war das
Testrestaurant ohne Katalog.';
COMMENT ON COLUMN core.ware_stand.verfuegbar IS 'isAvailable — von FoodNotify geliefert, Bedeutung nicht gemessen.';
COMMENT ON COLUMN core.ware_stand.in_inventur IS 'showInStocktaking.';
COMMENT ON COLUMN core.ware_stand.bestand_menge IS
'stock.sumAmount — Bestand in Gebinden laut FoodNotify zum Abrufzeitpunkt. NUR DER LETZTE STAND: der
Verlauf steht in raw (jede Antwort), ein Bestandsverlauf in core ist nicht gebaut. Negative Werte kommen vor.';
COMMENT ON COLUMN core.ware_stand.bestand_wert IS
'stock.sumPrice — Bestandswert netto EUR laut FoodNotify. Nicht durchweg bestand_menge x listenpreis (7984: 69
von 206; im Testrestaurant 743 von 746) — FoodNotify bewertet den Bestand eigen. Letzter Stand, kein Verlauf.';
COMMENT ON COLUMN core.ware_stand.fn_geaendert_am IS
'timeModified — wann FoodNotify das Produkt zuletzt geaendert hat. Bei 7984 zwischen 19.08. und 19.11.2026 (40
Produkte am 19.08.), im Testrestaurant meist 2024. WAS es ausloest (Preis, Bestand, Pflege), ist nicht
gemessen — deshalb kein Preisaenderungsdatum. Wann sich ein Preis aendert, sagt core.listenpreis_beobachtung.';
COMMENT ON COLUMN core.ware_stand.geaendert_am IS
'Letzte fachliche Aenderung (Artikelnummer, Name, Lieferant, Einheit, Inhalt, Gebinde, Listenpreis, Rezept,
bestellbar, fehlt/wieder da). Der Bestand zaehlt nicht: er aendert sich fast jede Nacht.';
COMMENT ON COLUMN core.ware_stand.zuletzt_gesehen_am IS
'Abrufzeitpunkt der letzten Antwort, die das Produkt nannte (= raw.api_antwort.abgerufen_am). Daran misst
sync.quelle (core:ware_stand) den Zulauf.';
COMMENT ON COLUMN core.ware_stand.fehlt_seit IS
'Seit wann ein VOLLSTAENDIGER Abzug (alle Seiten, Zeilenzahl = total_count) das Produkt nicht mehr nennt.
Nicht geloescht. Steht es wieder in einer Antwort, wird fehlt_seit geleert. Ein Abbruch, eine fehlende
Folgeseite oder eine Antwort mit Befund setzen es nie.';
COMMENT ON COLUMN core.ware_stand.raw_id IS 'raw.api_antwort.id der Antwort, aus der die Zeile zuletzt geladen wurde.';


-- ---------------------------------------------------------------------
-- 2. core.listenpreis_beobachtung — der Verlauf
--
-- Muster core.umsatzprognose_beobachtung (0154): eine Zeile je neuem Wert,
-- nicht je Abruf. Ein neuer Wert ist eine Aenderung an Listenpreis,
-- Katalogpreis, Einheit, Inhalt, Gebinde, Artikelnummer ODER Lieferant. Beide
-- Preise, weil sie sich gemessen getrennt bewegen (7984: 4 von 109 Katalogwaren
-- mit abweichendem Katalogpreis) — die fuenf Begleitfelder
-- gehoeren dazu, weil ein Preis ohne sie nicht lesbar ist (gleicher
-- Kilopreis bei halbem Gebinde ist eine andere Ware). Bei gleichem Wert
-- ruecken nur zuletzt_gesehen_am, zuletzt_raw_id und sichtungen nach.
-- ---------------------------------------------------------------------

CREATE TABLE core.listenpreis_beobachtung (
    kostenstelle_key    integer      NOT NULL,
    produkt_id          integer      NOT NULL,
    gesehen_ab          timestamptz  NOT NULL,
    gueltig_ab          date         NOT NULL,
    listenpreis         numeric(14,6),
    katalogpreis        numeric(14,6),
    einheit             text,
    inhalt              numeric(14,6),
    gebinde_menge       numeric(14,4),
    artikelnummer       text,
    lieferant_fn_id     text,
    zuletzt_gesehen_am  timestamptz  NOT NULL,
    sichtungen          integer      NOT NULL DEFAULT 1 CHECK (sichtungen > 0),
    raw_id              bigint,
    zuletzt_raw_id      bigint,
    PRIMARY KEY (kostenstelle_key, produkt_id, gesehen_ab),
    FOREIGN KEY (kostenstelle_key, produkt_id) REFERENCES core.ware_stand (kostenstelle_key, produkt_id),
    CHECK (zuletzt_gesehen_am >= gesehen_ab)
);

CREATE INDEX listenpreis_beobachtung_tag ON core.listenpreis_beobachtung (gueltig_ab);

COMMENT ON TABLE core.listenpreis_beobachtung IS
'Koernung: Kostenstelle × Produkt × Wert (erste Sichtung und jede Aenderung) — der Verlauf des Listenpreises
aus dem Warenstamm (fn:warenstamm, 0157). Eine Zeile je neuem Wert von (listenpreis, katalogpreis, einheit,
inhalt, gebinde_menge, artikelnummer, lieferant_fn_id), nicht je Abruf. DIE REIHE BEGINNT AM TAG DES ERSTEN ABZUGS:
FoodNotify fuehrt keine Preishistorie (timeModified sagt nicht, was sich aenderte), die erste Zeile je Produkt ist
deshalb keine Aenderung, sondern der Stand, den wir vorfanden. Vom Lader im selben Zug wie core.ware_stand
geschrieben und aus raw neu aufbaubar (core.warenstamm_neu_aufbauen()). Auswertung: mart.listenpreis_aenderung.';
COMMENT ON COLUMN core.listenpreis_beobachtung.katalogpreis IS
'pricePerUnit.price — Preis je Einheit im Lieferantenkatalog; NULL ohne Katalogeintrag (siehe core.ware_stand).';
COMMENT ON COLUMN core.listenpreis_beobachtung.gesehen_ab IS
'Abrufzeitpunkt, an dem dieser Wert zum ersten Mal stand — ab hier galt er nachweislich.';
COMMENT ON COLUMN core.listenpreis_beobachtung.gueltig_ab IS
'Berliner Kalendertag von gesehen_ab (nicht der UTC-Tag, siehe 0156). Der Wert kann frueher gegolten haben:
zwischen zuletzt_gesehen_am der Vorgaengerzeile und gesehen_ab hat niemand hingesehen.';
COMMENT ON COLUMN core.listenpreis_beobachtung.zuletzt_gesehen_am IS
'Letzter Abruf, in dem das Produkt mit DIESEM Wert stand. Fehlte das Produkt zwischendurch (fehlt_seit in
core.ware_stand) und kam mit gleichem Wert zurueck, laeuft die Zeile weiter — die Luecke steht in raw.';
COMMENT ON COLUMN core.listenpreis_beobachtung.sichtungen IS 'In wie vielen Abrufen der Wert unveraendert stand (mindestens 1).';


-- ---------------------------------------------------------------------
-- 3. core.ware_stand_abruf — der Abzug je Kostenstelle
--
-- Ein Abzug ist alle Seiten EINES Tages (zeitraum_von des Postens). Heute
-- ist das eine Seite; meldet FoodNotify mehr (page_count > 1), reiht Seite 1
-- die uebrigen ein, und erst wenn alle da sind und die Zeilen total_count
-- treffen, gilt der Abzug als vollstaendig — erst dann darf fehlt_seit
-- gesetzt werden. Ohne diese Zeile saehe eine Kostenstelle, deren Seite 2
-- nie kam, aus wie eine, deren halbes Sortiment gestrichen wurde.
-- ---------------------------------------------------------------------

CREATE TABLE core.ware_stand_abruf (
    kostenstelle_key    integer      PRIMARY KEY REFERENCES core.kostenstelle(kostenstelle_key),
    erp_id              integer      NOT NULL,
    abzug_tag           date         NOT NULL,
    abzug_beginn        timestamptz  NOT NULL,
    seiten_gesamt       integer      NOT NULL,
    seiten_geladen      integer[]    NOT NULL,
    produkte_gemeldet   integer      NOT NULL,
    produkte_geladen    integer      NOT NULL,
    befund              text,
    letzter_abruf_am    timestamptz  NOT NULL,
    vollstaendig_am     timestamptz,
    produkte            integer,
    raw_id              bigint
);

COMMENT ON TABLE core.ware_stand_abruf IS
'Der Abzug des Warenstamms je Kostenstelle (fn:warenstamm, 0157): der laufende bzw. letzte Abzug
(abzug_tag, Seiten, gemeldete und geladene Produkte, Befund) und der letzte VOLLSTAENDIGE (vollstaendig_am,
produkte). Ein Abbruch oder eine Antwort mit Befund aendert die Zeile nicht. Zustand je Kostenstelle:
mart.warenstamm_stand.';
COMMENT ON COLUMN core.ware_stand_abruf.abzug_tag IS 'zeitraum_von des Postens (Geschaeftstag des Einreihens) — alle Seiten eines Abzugs tragen denselben.';
COMMENT ON COLUMN core.ware_stand_abruf.abzug_beginn IS 'Abrufzeitpunkt von Seite 1. Was danach nicht gesehen wurde, fehlt nach einem vollstaendigen Abzug.';
COMMENT ON COLUMN core.ware_stand_abruf.produkte_gemeldet IS 'total_count laut Seite 1.';
COMMENT ON COLUMN core.ware_stand_abruf.befund IS
'Gesetzt, wenn eine Folgeseite eine andere Gesamtzahl meldet als Seite 1 — der Abzug bleibt dann
unvollstaendig (kein fehlt_seit) bis zur naechsten Seite 1.';
COMMENT ON COLUMN core.ware_stand_abruf.vollstaendig_am IS 'Abschluss des letzten vollstaendigen Abzugs. Daran misst mart.warenstamm_stand, ob die Kostenstelle frisch ist.';


-- ---------------------------------------------------------------------
-- 4. Der Lader — in SQL, damit Nachtlauf und Neuaufbau derselbe sind
--
-- REGEL 4 VERSPRICHT, DASS core AUS raw NEU AUFBAUBAR IST. Beim Warenstamm
-- ist das nicht trivial: der Verlauf entsteht erst aus der REIHENFOLGE der
-- Antworten. Laege die Logik in TypeScript, braeuchte der Neuaufbau eine
-- zweite Fassung davon, und zwei Fassungen laufen auseinander. Deshalb
-- arbeitet src/foodnotify/laden.ts genau eine Antwort mit
-- core.warenstamm_laden() ab, und core.warenstamm_neu_aufbauen() ruft
-- dieselbe Funktion fuer alle Rohantworten in Abrufreihenfolge auf. Zeit ist
-- dabei immer raw.api_antwort.abgerufen_am, nie now() — sonst stuende nach
-- einem Neuaufbau jede Preisaenderung auf dem Tag des Neuaufbaus.
--
-- Die Formpruefung in TypeScript (src/foodnotify/warenstamm.ts, zod) laeuft
-- vorher und nennt Gruende genauer. Die Pruefung hier ist die Untergrenze,
-- die auch der Neuaufbau braucht.
-- ---------------------------------------------------------------------

/** Ein Wert, der in numeric(14,s) passt — oder NULL (wie PREIS_MAX in transform.ts). */
CREATE FUNCTION core.warenstamm_zahl(p jsonb, p_stellen integer)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN jsonb_typeof(p) = 'number' AND abs((p #>> '{}')::numeric) < 1e8
                THEN round((p #>> '{}')::numeric, p_stellen) END
$$;

CREATE FUNCTION core.warenstamm_zeilen(p_daten jsonb)
RETURNS TABLE (
    produkt_id integer, fn_produkt_id integer, artikelnummer text, name text,
    lieferant_fn_id text, lieferant_name text, einheit text, inhalt numeric, gebinde_menge numeric,
    listenpreis numeric, katalogpreis numeric, katalogpreis_einheit text, katalog_gebinde text,
    katalog_gebinde_menge numeric, katalog_gebinde_preis numeric, katalog_gebinde_alle jsonb, katalog_produkt_id integer,
    rezept_fn_id integer, bestellbar boolean, verfuegbar boolean, in_inventur boolean,
    bestand_menge numeric, bestand_wert numeric, bestand_deaktiviert boolean, fn_geaendert_am timestamptz)
LANGUAGE sql IMMUTABLE AS $$
    SELECT (e->>'id')::integer,
           CASE WHEN jsonb_typeof(e->'productId') = 'number' AND e->>'productId' ~ '^\d{1,9}$'
                THEN (e->>'productId')::integer END,
           -- artikelId der Zeile; ingredient.artikelId ist derselbe Wert (742 von 742) und nur Rueckfall.
           nullif(btrim(coalesce(
               CASE WHEN jsonb_typeof(e->'artikelId') IN ('string', 'number') THEN e->>'artikelId' END,
               CASE WHEN jsonb_typeof(e->'ingredient') = 'object' THEN e->'ingredient'->>'artikelId' END)), ''),
           e->>'name',
           CASE WHEN jsonb_typeof(e->'shop') = 'object' THEN e->'shop'->>'id' END,
           CASE WHEN jsonb_typeof(e->'shop') = 'object' THEN e->'shop'->>'name' END,
           CASE WHEN jsonb_typeof(e->'unit') = 'object' THEN e->'unit'->>'name' END,
           core.warenstamm_zahl(e->'unitQuantity', 6),
           core.warenstamm_zahl(e->'packagingQuantity', 4),
           core.warenstamm_zahl(e->'unitPrice', 6),
           -- Katalog (nur bei bestellbaren Waren, gemessen an 7984): pricePerUnit {quantity, unit, price},
           -- packagingUnit {name, label, quantity, price {amount, currency}}, packagingUnits [...].
           CASE WHEN jsonb_typeof(e->'pricePerUnit') = 'object' THEN core.warenstamm_zahl(e->'pricePerUnit'->'price', 6) END,
           CASE WHEN jsonb_typeof(e->'pricePerUnit') = 'object' THEN e->'pricePerUnit'->>'unit' END,
           CASE WHEN jsonb_typeof(e->'packagingUnit') = 'object' THEN e->'packagingUnit'->>'label' END,
           CASE WHEN jsonb_typeof(e->'packagingUnit') = 'object' THEN core.warenstamm_zahl(e->'packagingUnit'->'quantity', 4) END,
           CASE WHEN jsonb_typeof(e->'packagingUnit') = 'object' AND jsonb_typeof(e->'packagingUnit'->'price') = 'object'
                THEN core.warenstamm_zahl(e->'packagingUnit'->'price'->'amount', 4) END,
           CASE WHEN jsonb_typeof(e->'packagingUnits') = 'array' THEN e->'packagingUnits' END,
           CASE WHEN jsonb_typeof(e->'productForShow') = 'object' AND e->'productForShow'->>'id' ~ '^\d{1,9}$'
                THEN (e->'productForShow'->>'id')::integer END,
           CASE WHEN jsonb_typeof(e->'recipeProduct') = 'object'
                 AND jsonb_typeof(e->'recipeProduct'->'recipe') = 'object'
                 AND e->'recipeProduct'->'recipe'->>'id' ~ '^\d{1,9}$'
                THEN (e->'recipeProduct'->'recipe'->>'id')::integer END,
           CASE WHEN jsonb_typeof(e->'isOrderable') = 'boolean' THEN (e->>'isOrderable')::boolean END,
           CASE WHEN jsonb_typeof(e->'isAvailable') = 'boolean' THEN (e->>'isAvailable')::boolean END,
           CASE WHEN jsonb_typeof(e->'showInStocktaking') = 'boolean' THEN (e->>'showInStocktaking')::boolean END,
           CASE WHEN jsonb_typeof(e->'stock') = 'object' THEN core.warenstamm_zahl(e->'stock'->'sumAmount', 4) END,
           CASE WHEN jsonb_typeof(e->'stock') = 'object' THEN core.warenstamm_zahl(e->'stock'->'sumPrice', 4) END,
           CASE WHEN jsonb_typeof(e->'stock') = 'object' AND jsonb_typeof(e->'stock'->'deactivated') = 'boolean'
                THEN (e->'stock'->>'deactivated')::boolean END,
           -- {date: '2024-12-10 09:39:00.799548', timezone: 'Europe/Berlin'} — gemessen ausnahmslos
           -- Europe/Berlin; eine fremde Zeitzone wird nicht gedeutet (ein ungueltiger Name braeche
           -- sonst den ganzen Abzug ab).
           CASE WHEN jsonb_typeof(e->'timeModified') = 'object'
                 AND e->'timeModified'->>'date' ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}'
                 AND coalesce(e->'timeModified'->>'timezone', 'Europe/Berlin') = 'Europe/Berlin'
                THEN (substr(e->'timeModified'->>'date', 1, 19)::timestamp AT TIME ZONE 'Europe/Berlin') END
      FROM jsonb_array_elements(p_daten) AS e
$$;

COMMENT ON FUNCTION core.warenstamm_zeilen(jsonb) IS
'Die Produktliste einer Warenstamm-Antwort (payload.data) als Zeilen fuer core.ware_stand (0157). Die
einzige Stelle, an der Feldnamen von FoodNotify auf Spalten abgebildet werden.';

CREATE FUNCTION core.warenstamm_laden(p_raw_id bigint, p_abgerufen_am timestamptz)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    r           record;
    v_ks        integer;
    v_treffer   integer;
    v_inhalt    jsonb;
    v_daten     jsonb;
    v_seite     integer;
    v_seiten    integer;
    v_gesamt    integer;
    v_groesse   integer;
    v_n         integer;
    v_erwartet  integer;
    v_bestand   integer;
    v_tag       date;
    v_ab        core.ware_stand_abruf%ROWTYPE;
    v_vollst    boolean := false;
    v_ergebnis  jsonb;
BEGIN
    SELECT a.parameter, a.payload, a.zeitraum_von, a.http_status, a.endpunkt INTO r
      FROM raw.api_antwort a
     WHERE a.id = p_raw_id AND a.abgerufen_am = p_abgerufen_am;
    IF NOT FOUND OR r.endpunkt <> 'fn:warenstamm' THEN
        RAISE EXCEPTION 'core.warenstamm_laden: keine Rohantwort fn:warenstamm mit id % und abgerufen_am %',
            p_raw_id, p_abgerufen_am;
    END IF;

    -- Die Kostenstelle: (Marke, erpId) muss genau eine treffen — zwei waeren neu und sollen
    -- auffallen, nicht still die erste beschreiben (wie kostenstelleKeyNachAnbindung, 0155).
    SELECT count(*), min(k.kostenstelle_key) INTO v_treffer, v_ks
      FROM core.kostenstelle k
     WHERE k.marke_key = (r.parameter->>'markeKey')::integer
       AND k.erp_id = (r.parameter->>'erpId')::integer;
    IF v_treffer <> 1 THEN
        RAISE EXCEPTION 'fn:warenstamm: erpId % (marke_key %) gehoert zu % Kostenstellen statt einer — erst fn:kostenstellen laden',
            r.parameter->>'erpId', r.parameter->>'markeKey', v_treffer;
    END IF;

    -- Schon verarbeitet oder aelter als der letzte Abruf: nichts tun. Macht den Lader wiederholbar
    -- (dieselbe Antwort zweimal aendert nichts) und den Neuaufbau reihenfolgefest.
    SELECT * INTO v_ab FROM core.ware_stand_abruf WHERE kostenstelle_key = v_ks;
    IF FOUND AND v_ab.letzter_abruf_am >= p_abgerufen_am THEN
        RETURN jsonb_build_object('produkte', 0, 'uebersprungen', true);
    END IF;

    -- ---- Form: die Untergrenze, die auch der Neuaufbau braucht ----------------------------
    IF r.http_status <> 200 THEN
        RETURN jsonb_build_object('befund', format('fn:warenstamm: HTTP %s', r.http_status));
    END IF;
    IF jsonb_typeof(r.payload) = 'object' AND (r.payload->>'isError' = 'true'
            OR jsonb_typeof(r.payload->'errors') = 'array' AND jsonb_array_length(r.payload->'errors') > 0) THEN
        RETURN jsonb_build_object('befund', 'fn:warenstamm: Hüllenfehler (isError/errors gesetzt)');
    END IF;
    v_inhalt := CASE WHEN jsonb_typeof(r.payload) = 'object' AND r.payload ? 'payload'
                     THEN r.payload->'payload' ELSE r.payload END;
    IF jsonb_typeof(v_inhalt) <> 'object' OR jsonb_typeof(v_inhalt->'data') <> 'array'
       OR jsonb_typeof(v_inhalt->'current_page') <> 'number' OR jsonb_typeof(v_inhalt->'page_count') <> 'number'
       OR jsonb_typeof(v_inhalt->'total_count') <> 'number' OR jsonb_typeof(v_inhalt->'current_page_size') <> 'number' THEN
        RETURN jsonb_build_object('befund',
            'fn:warenstamm: Antwort passt nicht auf die gemessene Form (payload.data[] mit current_page, '
            || 'page_count, total_count, current_page_size)');
    END IF;
    v_daten   := v_inhalt->'data';
    v_seite   := (v_inhalt->>'current_page')::integer;
    v_seiten  := (v_inhalt->>'page_count')::integer;
    v_gesamt  := (v_inhalt->>'total_count')::integer;
    v_groesse := (v_inhalt->>'current_page_size')::integer;
    v_n       := jsonb_array_length(v_daten);

    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_daten) e
                WHERE jsonb_typeof(e) <> 'object'
                   OR jsonb_typeof(e->'id') <> 'number' OR e->>'id' !~ '^\d{1,9}$'
                   OR jsonb_typeof(e->'name') <> 'string'
                   OR NOT (e ? 'unitPrice') OR jsonb_typeof(e->'unitPrice') NOT IN ('number', 'null')) THEN
        RETURN jsonb_build_object('befund',
            'fn:warenstamm: ein Produkt ohne id (Zahl), name (Text) oder unitPrice (Zahl oder null)');
    END IF;
    IF (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(v_daten) e) <> v_n THEN
        RETURN jsonb_build_object('befund', 'fn:warenstamm: dieselbe Produkt-id steht zweimal in einer Antwort');
    END IF;
    IF v_seite IS DISTINCT FROM coalesce((r.parameter->>'seite')::integer, 1) THEN
        RETURN jsonb_build_object('befund',
            format('fn:warenstamm: Seite %s angefragt, die Antwort meldet current_page %s',
                   r.parameter->>'seite', v_seite));
    END IF;

    -- ---- Nie still abschneiden: die Seite muss so viele Zeilen tragen, wie sie meldet ------
    v_erwartet := greatest(0, least(v_groesse, v_gesamt - (v_seite - 1) * v_groesse));
    IF v_groesse < 1 OR v_n <> v_erwartet THEN
        RETURN jsonb_build_object('befund',
            format('fn:warenstamm: Seite %s liefert %s Produkte, nach total_count %s und current_page_size %s '
                   || 'erwartet %s — nichts geladen', v_seite, v_n, v_gesamt, v_groesse, v_erwartet));
    END IF;

    -- ---- Null Produkte, wo gestern noch welche standen, ist kein Bestand ------------------
    IF v_gesamt = 0 THEN
        SELECT count(*) INTO v_bestand FROM core.ware_stand WHERE kostenstelle_key = v_ks AND fehlt_seit IS NULL;
        IF v_bestand > 0 THEN
            RETURN jsonb_build_object('befund',
                format('fn:warenstamm: erpId %s liefert 0 Produkte, im Bestand stehen %s — nichts als fehlend markiert',
                       r.parameter->>'erpId', v_bestand));
        END IF;
    END IF;

    -- ---- Ab hier wird geschrieben ---------------------------------------------------------
    v_tag := (p_abgerufen_am AT TIME ZONE 'Europe/Berlin')::date;

    INSERT INTO core.ware_stand AS w
        (kostenstelle_key, produkt_id, fn_produkt_id, artikelnummer, name, lieferant_fn_id, lieferant_name,
         einheit, inhalt, gebinde_menge, listenpreis, katalogpreis, katalogpreis_einheit, katalog_gebinde,
         katalog_gebinde_menge, katalog_gebinde_preis, katalog_gebinde_alle, katalog_produkt_id,
         rezept_fn_id, bestellbar, verfuegbar, in_inventur,
         bestand_menge, bestand_wert, bestand_deaktiviert, fn_geaendert_am,
         erstmals_am, geaendert_am, zuletzt_gesehen_am, fehlt_seit, raw_id)
    SELECT v_ks, z.produkt_id, z.fn_produkt_id, z.artikelnummer, z.name, z.lieferant_fn_id, z.lieferant_name,
           z.einheit, z.inhalt, z.gebinde_menge, z.listenpreis, z.katalogpreis, z.katalogpreis_einheit,
           z.katalog_gebinde, z.katalog_gebinde_menge, z.katalog_gebinde_preis, z.katalog_gebinde_alle,
           z.katalog_produkt_id, z.rezept_fn_id, z.bestellbar, z.verfuegbar,
           z.in_inventur, z.bestand_menge, z.bestand_wert, z.bestand_deaktiviert, z.fn_geaendert_am,
           p_abgerufen_am, p_abgerufen_am, p_abgerufen_am, NULL, p_raw_id
      FROM core.warenstamm_zeilen(v_daten) z
    ON CONFLICT (kostenstelle_key, produkt_id) DO UPDATE SET
        fn_produkt_id       = EXCLUDED.fn_produkt_id,
        artikelnummer       = EXCLUDED.artikelnummer,
        name                = EXCLUDED.name,
        lieferant_fn_id     = EXCLUDED.lieferant_fn_id,
        lieferant_name      = EXCLUDED.lieferant_name,
        einheit             = EXCLUDED.einheit,
        inhalt              = EXCLUDED.inhalt,
        gebinde_menge       = EXCLUDED.gebinde_menge,
        listenpreis         = EXCLUDED.listenpreis,
        katalogpreis        = EXCLUDED.katalogpreis,
        katalogpreis_einheit = EXCLUDED.katalogpreis_einheit,
        katalog_gebinde     = EXCLUDED.katalog_gebinde,
        katalog_gebinde_menge = EXCLUDED.katalog_gebinde_menge,
        katalog_gebinde_preis = EXCLUDED.katalog_gebinde_preis,
        katalog_gebinde_alle = EXCLUDED.katalog_gebinde_alle,
        katalog_produkt_id  = EXCLUDED.katalog_produkt_id,
        rezept_fn_id        = EXCLUDED.rezept_fn_id,
        bestellbar          = EXCLUDED.bestellbar,
        verfuegbar          = EXCLUDED.verfuegbar,
        in_inventur         = EXCLUDED.in_inventur,
        bestand_menge       = EXCLUDED.bestand_menge,
        bestand_wert        = EXCLUDED.bestand_wert,
        bestand_deaktiviert = EXCLUDED.bestand_deaktiviert,
        fn_geaendert_am     = EXCLUDED.fn_geaendert_am,
        geaendert_am = CASE
            WHEN (w.artikelnummer, w.name, w.lieferant_fn_id, w.einheit, w.inhalt, w.gebinde_menge,
                  w.listenpreis, w.katalogpreis, w.katalog_gebinde_preis, w.rezept_fn_id, w.bestellbar,
                  w.fehlt_seit IS NULL)
                 IS DISTINCT FROM
                 (EXCLUDED.artikelnummer, EXCLUDED.name, EXCLUDED.lieferant_fn_id, EXCLUDED.einheit,
                  EXCLUDED.inhalt, EXCLUDED.gebinde_menge, EXCLUDED.listenpreis, EXCLUDED.katalogpreis,
                  EXCLUDED.katalog_gebinde_preis, EXCLUDED.rezept_fn_id, EXCLUDED.bestellbar, true)
            THEN EXCLUDED.geaendert_am ELSE w.geaendert_am END,
        zuletzt_gesehen_am  = EXCLUDED.zuletzt_gesehen_am,
        fehlt_seit          = NULL,
        raw_id              = EXCLUDED.raw_id;

    -- Verlauf: gleicher Wert -> nachfuehren, neuer Wert -> neue Zeile. Erst nachfuehren, dann
    -- einfuegen: das Einfuegen vergleicht danach gegen dieselbe juengste Zeile.
    WITH neu AS (
        SELECT z.produkt_id, z.listenpreis, z.katalogpreis, z.einheit, z.inhalt, z.gebinde_menge,
               z.artikelnummer, z.lieferant_fn_id
          FROM core.warenstamm_zeilen(v_daten) z
    ), letzte AS (
        SELECT DISTINCT ON (b.produkt_id) b.produkt_id, b.gesehen_ab, b.listenpreis, b.katalogpreis, b.einheit,
               b.inhalt, b.gebinde_menge, b.artikelnummer, b.lieferant_fn_id
          FROM core.listenpreis_beobachtung b
         WHERE b.kostenstelle_key = v_ks
         ORDER BY b.produkt_id, b.gesehen_ab DESC
    )
    UPDATE core.listenpreis_beobachtung b
       SET zuletzt_gesehen_am = p_abgerufen_am, zuletzt_raw_id = p_raw_id, sichtungen = b.sichtungen + 1
      FROM letzte l
      JOIN neu n USING (produkt_id)
     WHERE b.kostenstelle_key = v_ks AND b.produkt_id = l.produkt_id AND b.gesehen_ab = l.gesehen_ab
       AND (n.listenpreis, n.katalogpreis, n.einheit, n.inhalt, n.gebinde_menge, n.artikelnummer, n.lieferant_fn_id)
           IS NOT DISTINCT FROM
           (l.listenpreis, l.katalogpreis, l.einheit, l.inhalt, l.gebinde_menge, l.artikelnummer, l.lieferant_fn_id);

    WITH neu AS (
        SELECT z.produkt_id, z.listenpreis, z.katalogpreis, z.einheit, z.inhalt, z.gebinde_menge,
               z.artikelnummer, z.lieferant_fn_id
          FROM core.warenstamm_zeilen(v_daten) z
    ), letzte AS (
        SELECT DISTINCT ON (b.produkt_id) b.produkt_id, b.listenpreis, b.katalogpreis, b.einheit, b.inhalt,
               b.gebinde_menge, b.artikelnummer, b.lieferant_fn_id
          FROM core.listenpreis_beobachtung b
         WHERE b.kostenstelle_key = v_ks
         ORDER BY b.produkt_id, b.gesehen_ab DESC
    )
    INSERT INTO core.listenpreis_beobachtung
        (kostenstelle_key, produkt_id, gesehen_ab, gueltig_ab, listenpreis, katalogpreis, einheit, inhalt,
         gebinde_menge, artikelnummer, lieferant_fn_id, zuletzt_gesehen_am, sichtungen, raw_id, zuletzt_raw_id)
    SELECT v_ks, n.produkt_id, p_abgerufen_am, v_tag, n.listenpreis, n.katalogpreis, n.einheit, n.inhalt, n.gebinde_menge,
           n.artikelnummer, n.lieferant_fn_id, p_abgerufen_am, 1, p_raw_id, p_raw_id
      FROM neu n
      LEFT JOIN letzte l USING (produkt_id)
     WHERE l.produkt_id IS NULL
        OR (n.listenpreis, n.katalogpreis, n.einheit, n.inhalt, n.gebinde_menge, n.artikelnummer, n.lieferant_fn_id)
           IS DISTINCT FROM
           (l.listenpreis, l.katalogpreis, l.einheit, l.inhalt, l.gebinde_menge, l.artikelnummer, l.lieferant_fn_id);

    -- ---- Der Abzug: Seite 1 beginnt ihn, jede weitere Seite desselben Tages ergaenzt ihn --------
    IF v_seite = 1 THEN
        INSERT INTO core.ware_stand_abruf AS a
            (kostenstelle_key, erp_id, abzug_tag, abzug_beginn, seiten_gesamt, seiten_geladen,
             produkte_gemeldet, produkte_geladen, befund, letzter_abruf_am, raw_id)
        VALUES (v_ks, (r.parameter->>'erpId')::integer, r.zeitraum_von, p_abgerufen_am, greatest(v_seiten, 1),
                ARRAY[1], v_gesamt, v_n, NULL, p_abgerufen_am, p_raw_id)
        ON CONFLICT (kostenstelle_key) DO UPDATE SET
            erp_id = EXCLUDED.erp_id, abzug_tag = EXCLUDED.abzug_tag, abzug_beginn = EXCLUDED.abzug_beginn,
            seiten_gesamt = EXCLUDED.seiten_gesamt, seiten_geladen = EXCLUDED.seiten_geladen,
            produkte_gemeldet = EXCLUDED.produkte_gemeldet, produkte_geladen = EXCLUDED.produkte_geladen,
            befund = NULL, letzter_abruf_am = EXCLUDED.letzter_abruf_am, raw_id = EXCLUDED.raw_id;
    ELSIF v_ab.kostenstelle_key IS NOT NULL AND v_ab.abzug_tag = r.zeitraum_von
          AND NOT (v_seite = ANY (v_ab.seiten_geladen)) THEN
        UPDATE core.ware_stand_abruf
           SET seiten_geladen   = seiten_geladen || v_seite,
               produkte_geladen = produkte_geladen + v_n,
               befund = CASE WHEN befund IS NULL AND v_gesamt <> produkte_gemeldet
                             THEN format('Gesamtzahl aenderte sich zwischen den Seiten (%s auf Seite 1, %s auf Seite %s)',
                                         produkte_gemeldet, v_gesamt, v_seite)
                             ELSE befund END,
               letzter_abruf_am = p_abgerufen_am, raw_id = p_raw_id
         WHERE kostenstelle_key = v_ks;
    ELSE
        -- Eine Folgeseite eines aelteren Abzugs (oder doppelt): die Zeilen sind geladen, der
        -- laufende Abzug zaehlt sie nicht.
        UPDATE core.ware_stand_abruf SET letzter_abruf_am = p_abgerufen_am WHERE kostenstelle_key = v_ks;
    END IF;

    -- ---- Vollstaendig? Erst dann fehlt, was nicht gesehen wurde ---------------------------
    SELECT * INTO v_ab FROM core.ware_stand_abruf WHERE kostenstelle_key = v_ks;
    IF v_ab.befund IS NULL
       AND v_ab.produkte_geladen = v_ab.produkte_gemeldet
       AND (SELECT bool_and(s = ANY (v_ab.seiten_geladen)) FROM generate_series(1, v_ab.seiten_gesamt) s)
       AND (v_ab.vollstaendig_am IS NULL OR v_ab.vollstaendig_am < v_ab.abzug_beginn) THEN
        UPDATE core.ware_stand
           SET fehlt_seit = p_abgerufen_am, geaendert_am = p_abgerufen_am
         WHERE kostenstelle_key = v_ks AND fehlt_seit IS NULL AND zuletzt_gesehen_am < v_ab.abzug_beginn;
        UPDATE core.ware_stand_abruf
           SET vollstaendig_am = p_abgerufen_am, produkte = v_ab.produkte_geladen
         WHERE kostenstelle_key = v_ks;
        v_vollst := true;
    END IF;

    v_ergebnis := jsonb_build_object('produkte', v_n, 'seite', v_seite, 'seiten', greatest(v_seiten, 1),
                                     'gesamt', v_gesamt, 'vollstaendig', v_vollst);
    RETURN v_ergebnis;
END $$;

COMMENT ON FUNCTION core.warenstamm_laden(bigint, timestamptz) IS
'Laedt EINE Rohantwort fn:warenstamm nach core.ware_stand, core.listenpreis_beobachtung und
core.ware_stand_abruf (0157). Zeit ist abgerufen_am der Rohantwort. Rueckgabe {produkte, seite, seiten,
gesamt, vollstaendig} oder {befund: text} — bei einem Befund ist NICHTS geschrieben (fremde Form, Seite
kuerzer als gemeldet, 0 Produkte bei vorhandenem Bestand). Schon verarbeitete oder aeltere Antworten werden
uebersprungen. Aufgerufen vom Importer (src/foodnotify/laden.ts) und von core.warenstamm_neu_aufbauen().';

CREATE FUNCTION core.warenstamm_neu_aufbauen(p_kostenstelle_key integer DEFAULT NULL)
RETURNS TABLE (antworten integer, geladen integer, befunde integer, fehler integer)
LANGUAGE plpgsql AS $$
DECLARE
    a        record;
    v        jsonb;
    v_marke  integer;
    v_erp    integer;
BEGIN
    antworten := 0; geladen := 0; befunde := 0; fehler := 0;
    IF p_kostenstelle_key IS NOT NULL THEN
        SELECT marke_key, erp_id INTO v_marke, v_erp FROM core.kostenstelle
         WHERE kostenstelle_key = p_kostenstelle_key;
        IF NOT FOUND THEN RAISE EXCEPTION 'Kostenstelle % gibt es nicht', p_kostenstelle_key; END IF;
    END IF;

    DELETE FROM core.listenpreis_beobachtung WHERE p_kostenstelle_key IS NULL OR kostenstelle_key = p_kostenstelle_key;
    DELETE FROM core.ware_stand              WHERE p_kostenstelle_key IS NULL OR kostenstelle_key = p_kostenstelle_key;
    DELETE FROM core.ware_stand_abruf        WHERE p_kostenstelle_key IS NULL OR kostenstelle_key = p_kostenstelle_key;

    FOR a IN
        SELECT r.id, r.abgerufen_am
          FROM raw.api_antwort r
         WHERE r.quelle = 'foodnotify' AND r.endpunkt = 'fn:warenstamm'
           AND (p_kostenstelle_key IS NULL
                OR ((r.parameter->>'markeKey')::integer = v_marke
                    AND (r.parameter->>'erpId')::integer = v_erp))
         ORDER BY r.abgerufen_am, r.id
    LOOP
        antworten := antworten + 1;
        BEGIN
            v := core.warenstamm_laden(a.id, a.abgerufen_am);
            IF v ? 'befund' THEN befunde := befunde + 1; ELSE geladen := geladen + 1; END IF;
        EXCEPTION WHEN OTHERS THEN
            fehler := fehler + 1;
        END;
    END LOOP;
    RETURN NEXT;
END $$;

COMMENT ON FUNCTION core.warenstamm_neu_aufbauen(integer) IS
'Baut core.ware_stand, core.listenpreis_beobachtung und core.ware_stand_abruf aus raw neu auf (Regel 4),
fuer eine Kostenstelle oder alle: loescht deren Zeilen und spielt jede Rohantwort fn:warenstamm in
Abrufreihenfolge durch core.warenstamm_laden() — dieselbe Funktion wie der Nachtlauf. Antworten mit Befund
werden wie im Nachtlauf nicht geladen. Nicht waehrend eines Laufs aufrufen.';


-- ---------------------------------------------------------------------
-- 5a. mart.listenpreis_aktuell — der Listenpreis heute, je Kostenstelle
--
-- Nur Produkte der letzten vollstaendigen Antwort (fehlt_seit IS NULL).
-- Der Kostenstellenvergleich (kostenstellen_gleiche_ware, Median, Abweichung)
-- gruppiert ueber Lieferant + Artikelnummer + Einheit + Inhalt derselben
-- Marke und zaehlt NUR Kostenstellen mit Betrieb — Testkostenstellen
-- (Testrestaurant, Testbetriebe) werden geladen, setzen aber keinen Massstab.
-- Ob dieselbe Ware in Bar und Kueche verschiedene Listenpreise traegt, liess
-- sich am 19.11.2026 NICHT messen (gemessen sind zwei Testkostenstellen ohne
-- gemeinsame Ware und eine echte). Die Spalten sind ein Angebot, kein Befund.
-- ---------------------------------------------------------------------

CREATE VIEW mart.listenpreis_aktuell AS
WITH stand AS (
    SELECT w.*, ks.marke_key, m.name AS marke, ks.betrieb_key, b.name AS betrieb, ks.kostenstelle_id,
           ks.name AS kostenstelle, ks.art AS kostenstelle_art, l.lieferant_key
      FROM core.ware_stand w
      JOIN core.kostenstelle ks  ON ks.kostenstelle_key = w.kostenstelle_key
      JOIN core.marke m          ON m.marke_key = ks.marke_key
      LEFT JOIN core.betrieb b   ON b.betrieb_key = ks.betrieb_key
      LEFT JOIN core.lieferant l ON l.marke_key = ks.marke_key AND l.fn_id = w.lieferant_fn_id
     WHERE w.fehlt_seit IS NULL
),
vergleich AS (
    SELECT marke_key, lieferant_fn_id, artikelnummer, einheit, inhalt,
           count(DISTINCT kostenstelle_key)                                    AS kostenstellen,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY listenpreis::float8)::numeric AS median_preis
      FROM stand
     WHERE listenpreis > 0 AND artikelnummer IS NOT NULL AND lieferant_fn_id IS NOT NULL
       AND betrieb_key IS NOT NULL
     GROUP BY 1, 2, 3, 4, 5
)
SELECT s.marke,
       s.betrieb_key,
       s.betrieb,
       s.kostenstelle_id,
       s.kostenstelle,
       s.kostenstelle_art,
       s.lieferant_key,
       s.lieferant_name                                                  AS lieferant,
       s.artikelnummer,
       s.name                                                            AS ware,
       s.produkt_id,
       s.einheit,
       s.inhalt,
       s.gebinde_menge,
       s.listenpreis,
       CASE WHEN s.listenpreis > 0 AND s.inhalt > 0
            THEN round(s.listenpreis * s.inhalt * coalesce(s.gebinde_menge, 1), 4) END AS listenpreis_gebinde,
       (s.listenpreis IS NULL OR s.listenpreis = 0)                      AS kein_preis,
       s.katalogpreis,
       CASE WHEN s.katalogpreis > 0 AND s.listenpreis > 0
            THEN round(100.0 * (s.katalogpreis - s.listenpreis) / s.listenpreis, 1) END AS katalog_abweichung_pct,
       s.katalog_gebinde,
       s.katalog_gebinde_menge,
       s.katalog_gebinde_preis,
       s.bestellbar,
       (s.rezept_fn_id IS NOT NULL)                                      AS eigenproduktion,
       h.preis_seit,
       (h.preis_seit = h.beobachtet_seit)                                AS preis_seit_erstem_abzug,
       h.beobachtet_seit,
       s.fn_geaendert_am,
       s.zuletzt_gesehen_am,
       s.bestand_menge,
       s.bestand_wert,
       coalesce(v.kostenstellen, 0)::int                                 AS kostenstellen_gleiche_ware,
       round(v.median_preis, 6)                                          AS listenpreis_median_marke,
       CASE WHEN v.kostenstellen >= 2 AND s.listenpreis > 0
            THEN round(100.0 * (s.listenpreis - v.median_preis) / v.median_preis, 1) END AS abweichung_median_pct
  FROM stand s
  LEFT JOIN vergleich v
         ON v.marke_key = s.marke_key AND v.lieferant_fn_id = s.lieferant_fn_id AND v.artikelnummer = s.artikelnummer
        AND v.einheit IS NOT DISTINCT FROM s.einheit AND v.inhalt IS NOT DISTINCT FROM s.inhalt
  LEFT JOIN LATERAL (
        SELECT min(b.gueltig_ab) AS beobachtet_seit,
               min(b.gueltig_ab) FILTER (WHERE b.gesehen_ab > coalesce(
                   (SELECT max(b2.gesehen_ab) FROM core.listenpreis_beobachtung b2
                     WHERE b2.kostenstelle_key = s.kostenstelle_key AND b2.produkt_id = s.produkt_id
                       AND b2.listenpreis IS DISTINCT FROM s.listenpreis), '-infinity'::timestamptz)) AS preis_seit
          FROM core.listenpreis_beobachtung b
         WHERE b.kostenstelle_key = s.kostenstelle_key AND b.produkt_id = s.produkt_id) h ON true;

COMMENT ON VIEW mart.listenpreis_aktuell IS
'Was kostet eine Ware heute laut FoodNotify-Warenstamm? Eine Zeile je Kostenstelle und Produkt der letzten
Antwort (0157). ZWEI PREISE, beide JE EINHEIT (kg, l), nicht je Gebinde: listenpreis (unitPrice, immer
gefuellt) folgt nach der Messung vom 19.11.2026 dem Preis der letzten Bestellung; katalogpreis (pricePerUnit)
ist der heutige Preis im Lieferantenkatalog, nur bei bestellbaren Waren. katalog_abweichung_pct ungleich 0
heisst: der Katalog hat sich bewegt, seit zuletzt bestellt wurde. Bezahlte Preise:
mart.einkaufspreis_artikel_monat. preis_seit = erster Tag, an dem dieser Preis gesehen wurde; steht
preis_seit_erstem_abzug auf true, gilt er MINDESTENS seit dann — die Reihe beginnt mit unserem ersten Abzug.
Ein Betrieb hat oft zwei Kostenstellen (Bar, Kueche) mit eigenem Warenstamm. Vorerst nur Wilma Wunder;
Stand je Kostenstelle: mart.warenstamm_stand.';
COMMENT ON COLUMN mart.listenpreis_aktuell.listenpreis IS
'unitPrice: netto EUR je einheit (kg, l), folgt dem Preis der letzten Bestellung. 0 oder leer heisst kein Preis
(kein_preis), keine Gratisware.';
COMMENT ON COLUMN mart.listenpreis_aktuell.katalogpreis IS
'pricePerUnit: netto EUR je einheit im Lieferantenkatalog, heute. NULL ohne Katalogeintrag (nicht bestellbar,
Eigenproduktion, Kleinlieferant) — kein Preis, nicht 0.';
COMMENT ON COLUMN mart.listenpreis_aktuell.katalog_abweichung_pct IS
'(katalogpreis - listenpreis) / listenpreis, Prozentzahl. Bar Ballplatz 19.11.2026: 105 von 109 bei 0, vier
zwischen -1,6 und -8,5 — der Katalog war billiger als die letzte Bestellung.';
COMMENT ON COLUMN mart.listenpreis_aktuell.katalog_gebinde_preis IS
'Preis der Bestelleinheit (katalog_gebinde, z. B. "Karton (6)") im Katalog, wie geliefert — nicht gerechnet.';
COMMENT ON COLUMN mart.listenpreis_aktuell.fn_geaendert_am IS
'timeModified: wann FoodNotify das Produkt zuletzt geaendert hat. Was es ausloest, ist nicht gemessen — kein Preisdatum.';
COMMENT ON COLUMN mart.listenpreis_aktuell.listenpreis_gebinde IS
'GERECHNET, nicht geliefert: listenpreis x inhalt x gebinde_menge. Bei Bar Ballplatz (19.11.2026) trifft er
bei 96 von 110 Katalogwaren einen Gebindepreis des Katalogs auf 1 %. Haengt an FoodNotifys Inhaltsangabe, die
im Testrestaurant teils unsinnig gepflegt ist (0,003 kg fuer eine Kiste) — vor einem Extremwert die Zeile ansehen.';
COMMENT ON COLUMN mart.listenpreis_aktuell.preis_seit IS
'Erster Berliner Kalendertag, an dem der heutige Listenpreis im Warenstamm stand (durchgehend seitdem).';
COMMENT ON COLUMN mart.listenpreis_aktuell.preis_seit_erstem_abzug IS
'true: der Preis stand schon im ersten Abzug — er gilt mindestens seit preis_seit, wie lange davor, weiss niemand.';
COMMENT ON COLUMN mart.listenpreis_aktuell.kostenstellen_gleiche_ware IS
'Kostenstellen derselben Marke MIT BETRIEB, die dieselbe Ware (Lieferant, Artikelnummer, Einheit, Inhalt) mit
Preis fuehren. Eine Kostenstelle ohne Betrieb (Testkostenstelle) zaehlt nicht mit, sieht aber den Vergleich der echten.';
COMMENT ON COLUMN mart.listenpreis_aktuell.abweichung_median_pct IS
'Abweichung vom Median der Kostenstellen derselben Marke fuer dieselbe Ware, Prozentzahl (12.5, nicht 0.125).
Gezaehlt werden nur Kostenstellen mit Betrieb. NULL bei nur einer Kostenstelle. Ob die Listenpreise ueber
Kostenstellen ueberhaupt auseinanderlaufen, ist nicht gemessen.';
COMMENT ON COLUMN mart.listenpreis_aktuell.lieferant_key IS
'core.lieferant derselben Marke (shop.id = fn_id). NULL, solange von diesem Lieferanten keine Bestellung geladen ist.';


-- ---------------------------------------------------------------------
-- 5b. mart.listenpreis_aenderung — jede beobachtete Preisaenderung
--
-- Eine Zeile je Aenderung UND PREISART: listenpreis (unitPrice) und
-- katalogpreis (pricePerUnit) bewegen sich getrennt (7984: 4 von 109
-- Katalogwaren mit abweichendem Katalogpreis), eine Aenderung beider steht
-- also zweimal da. Immer nach preisart filtern.
-- ---------------------------------------------------------------------

CREATE VIEW mart.listenpreis_aenderung AS
WITH reihe AS (
    SELECT b.*,
           lag(b.listenpreis)        OVER w AS listenpreis_alt,
           lag(b.katalogpreis)       OVER w AS katalogpreis_alt,
           lag(b.zuletzt_gesehen_am) OVER w AS vorher_zuletzt_gesehen_am,
           lag(b.einheit)            OVER w AS einheit_alt,
           lag(b.inhalt)             OVER w AS inhalt_alt,
           lag(b.gebinde_menge)      OVER w AS gebinde_alt,
           lag(b.artikelnummer)      OVER w AS artikelnummer_alt,
           lag(b.lieferant_fn_id)    OVER w AS lieferant_alt,
           row_number()              OVER w AS nr
      FROM core.listenpreis_beobachtung b
    WINDOW w AS (PARTITION BY b.kostenstelle_key, b.produkt_id ORDER BY b.gesehen_ab)
),
begleit AS (
    SELECT r.*,
           array_remove(ARRAY[
               CASE WHEN r.einheit         IS DISTINCT FROM r.einheit_alt       THEN 'einheit' END,
               CASE WHEN r.inhalt          IS DISTINCT FROM r.inhalt_alt        THEN 'inhalt' END,
               CASE WHEN r.gebinde_menge   IS DISTINCT FROM r.gebinde_alt       THEN 'gebinde' END,
               CASE WHEN r.artikelnummer   IS DISTINCT FROM r.artikelnummer_alt THEN 'artikelnummer' END,
               CASE WHEN r.lieferant_fn_id IS DISTINCT FROM r.lieferant_alt     THEN 'lieferant' END
           ], NULL) AS auch_geaendert
      FROM reihe r
     -- Die erste Zeile je Produkt ist keine Aenderung, sondern der Stand beim ersten Abzug.
     WHERE r.nr > 1
),
geaendert AS (
    SELECT g.*, 'listenpreis'::text AS preisart, g.listenpreis_alt AS preis_alt, g.listenpreis AS preis_neu
      FROM begleit g WHERE g.listenpreis IS DISTINCT FROM g.listenpreis_alt
    UNION ALL
    SELECT g.*, 'katalogpreis'::text, g.katalogpreis_alt, g.katalogpreis
      FROM begleit g WHERE g.katalogpreis IS DISTINCT FROM g.katalogpreis_alt
)
SELECT m.name                                                            AS marke,
       ks.betrieb_key,
       bt.name                                                           AS betrieb,
       ks.kostenstelle_id,
       ks.name                                                           AS kostenstelle,
       g.kostenstelle_key,
       l.lieferant_key,
       w.lieferant_name                                                  AS lieferant,
       g.artikelnummer,
       g.artikelnummer_alt,
       w.name                                                            AS ware,
       g.produkt_id,
       g.preisart,
       g.einheit,
       g.inhalt,
       g.gebinde_menge,
       g.preis_alt,
       g.preis_neu,
       CASE WHEN g.preis_alt > 0 AND g.preis_neu > 0
            THEN round(100.0 * (g.preis_neu - g.preis_alt) / g.preis_alt, 1) END AS aenderung_pct,
       CASE WHEN coalesce(g.preis_alt, 0) = 0 THEN 'preis neu'
            WHEN coalesce(g.preis_neu, 0) = 0 THEN 'kein preis mehr'
            WHEN g.preis_neu > g.preis_alt     THEN 'erhoehung'
            ELSE 'senkung' END                                           AS art,
       g.gueltig_ab,
       g.gesehen_ab,
       g.vorher_zuletzt_gesehen_am,
       g.auch_geaendert,
       coalesce(g.preis_alt > 0 AND g.preis_neu > 0 AND cardinality(g.auch_geaendert) = 0, false) AS vergleichbar,
       (w.fehlt_seit IS NOT NULL)                                        AS nicht_mehr_geliefert
  FROM geaendert g
  JOIN core.ware_stand w     ON w.kostenstelle_key = g.kostenstelle_key AND w.produkt_id = g.produkt_id
  JOIN core.kostenstelle ks  ON ks.kostenstelle_key = g.kostenstelle_key
  JOIN core.marke m          ON m.marke_key = ks.marke_key
  LEFT JOIN core.betrieb bt  ON bt.betrieb_key = ks.betrieb_key
  LEFT JOIN core.lieferant l ON l.marke_key = ks.marke_key AND l.fn_id = w.lieferant_fn_id;

COMMENT ON VIEW mart.listenpreis_aenderung IS
'Jede beobachtete Preisaenderung im FoodNotify-Warenstamm (0157), je PREISART: listenpreis (unitPrice, folgt
dem Preis der letzten Bestellung) oder katalogpreis (pricePerUnit, Lieferantenkatalog). Alter und neuer Preis
je Einheit, Aenderung in Prozent, Tag, Kostenstelle, Lieferant, Artikelnummer. IMMER NACH preisart FILTERN —
eine Aenderung beider Preise steht zweimal da. DIE REIHE BEGINNT AM TAG DES ERSTEN ABZUGS: der erste Wert je
Produkt ist keine Aenderung und steht hier nicht. EIN PREIS 0 ODER LEER IST KEIN PREIS — der Wechsel auf oder
davon steht als ''kein preis mehr'' bzw. ''preis neu'' da (beim Katalogpreis auch: Ware kommt in den oder
faellt aus dem Katalog), ohne Prozent, nie als Senkung auf null. Nur vergleichbar = true ist eine reine
Preisaenderung (Einheit, Inhalt, Gebinde, Artikelnummer und Lieferant unveraendert). Eine
Listenpreisaenderung heisst meist "es wurde zu einem neuen Preis bestellt", eine Katalogpreisaenderung "der
Lieferant hat den Katalog geaendert". Vorerst nur Wilma Wunder.';
COMMENT ON COLUMN mart.listenpreis_aenderung.preisart IS
'listenpreis (unitPrice, Warenstamm) oder katalogpreis (pricePerUnit, Lieferantenkatalog). Nie ueber beide zaehlen.';
COMMENT ON COLUMN mart.listenpreis_aenderung.aenderung_pct IS
'(neu - alt) / alt, Prozentzahl (8.5, nicht 0.085). NULL, wenn einer der beiden Preise 0 oder leer ist. Nur mit
vergleichbar = true als Preisaenderung lesen; ueber Waren nicht mitteln.';
COMMENT ON COLUMN mart.listenpreis_aenderung.gueltig_ab IS
'Erster Berliner Kalendertag mit dem neuen Preis. Geaendert hat er sich zwischen vorher_zuletzt_gesehen_am und
gesehen_ab — genauer weiss es niemand.';
COMMENT ON COLUMN mart.listenpreis_aenderung.auch_geaendert IS
'Was sich mit dem Preis zusammen geaendert hat (einheit, inhalt, gebinde, artikelnummer, lieferant). Leer bei
einer reinen Preisaenderung.';


-- ---------------------------------------------------------------------
-- 5c. mart.warenstamm_stand — Zulauf je Kostenstelle (Regel 10)
-- ---------------------------------------------------------------------

CREATE VIEW mart.warenstamm_stand AS
WITH aktiv AS (
    -- Der wirksame Schalter WARENSTAMM_MARKEN, vom Einreihweg je Lauf gemeldet.
    SELECT wert->'marken' AS marken FROM sync.merker WHERE schluessel = 'warenstamm_marken'
),
ks AS (
    SELECT k.kostenstelle_key, k.marke_key, m.name AS marke, k.betrieb_key, b.name AS betrieb,
           k.kostenstelle_id, k.name AS kostenstelle, k.art AS kostenstelle_art, k.erp_id,
           coalesce((SELECT a.marken ? m.schluessel FROM aktiv a), false) AS marke_aktiv
      FROM core.kostenstelle k
      JOIN core.marke m        ON m.marke_key = k.marke_key
      LEFT JOIN core.betrieb b ON b.betrieb_key = k.betrieb_key
     WHERE k.erp_id IS NOT NULL
),
zugriff AS (
    -- Der zuletzt abgeschlossene Posten je Kostenstelle: kein_zugriff heisst, FoodNotify verweigert
    -- diese Kostenstelle dauerhaft (0075) — eine fremde Kostenstelle im Mandanten.
    SELECT DISTINCT ON (w.marke_key, w.parameter->>'erpId')
           w.marke_key, w.parameter->>'erpId' AS erp_id, w.ergebnis
      FROM sync.warteschlange w
     WHERE w.endpunkt = 'fn:warenstamm' AND w.erledigt_am IS NOT NULL
     ORDER BY w.marke_key, w.parameter->>'erpId', w.erledigt_am DESC
),
produkte AS (
    SELECT kostenstelle_key,
           count(*) FILTER (WHERE fehlt_seit IS NULL)                                               AS produkte,
           count(*) FILTER (WHERE fehlt_seit IS NOT NULL)                                           AS nicht_mehr_geliefert,
           count(*) FILTER (WHERE fehlt_seit IS NULL AND coalesce(listenpreis, 0) = 0)              AS ohne_preis,
           count(*) FILTER (WHERE fehlt_seit IS NULL AND artikelnummer IS NULL AND rezept_fn_id IS NULL) AS ohne_artikelnummer,
           count(*) FILTER (WHERE fehlt_seit IS NULL AND rezept_fn_id IS NOT NULL)                  AS eigenproduktion,
           count(*) FILTER (WHERE fehlt_seit IS NULL AND katalogpreis > 0)                         AS mit_katalogpreis
      FROM core.ware_stand
     GROUP BY kostenstelle_key
),
verlauf AS (
    SELECT kostenstelle_key, min(gueltig_ab) AS reihe_ab
      FROM core.listenpreis_beobachtung
     GROUP BY kostenstelle_key
),
aenderung AS (
    SELECT a.kostenstelle_key,
           count(*) FILTER (WHERE a.preisart = 'listenpreis')  AS preisaenderungen_30_tage,
           count(*) FILTER (WHERE a.preisart = 'katalogpreis') AS katalogaenderungen_30_tage
      FROM mart.listenpreis_aenderung a
     WHERE a.gueltig_ab >= current_date - 30 AND a.vergleichbar
     GROUP BY a.kostenstelle_key
)
SELECT k.marke,
       k.marke_aktiv,
       k.betrieb_key,
       k.betrieb,
       k.kostenstelle_id,
       k.kostenstelle,
       k.kostenstelle_art,
       k.erp_id,
       CASE
         WHEN NOT k.marke_aktiv                                               THEN 'marke nicht aktiv'
         WHEN z.ergebnis = 'kein_zugriff'                                     THEN 'kein zugriff'
         WHEN ab.kostenstelle_key IS NULL                                     THEN 'nie geladen'
         WHEN ab.befund IS NOT NULL                                           THEN 'unvollstaendig'
         WHEN ab.vollstaendig_am IS NULL
           OR ab.vollstaendig_am < now() - interval '36 hours'                THEN 'veraltet'
         WHEN coalesce(p.produkte, 0) = 0                                     THEN 'leer'
         WHEN k.betrieb_key IS NULL                                           THEN 'ohne betrieb'
         ELSE 'ok'
       END                                                                    AS zustand,
       ab.letzter_abruf_am,
       ab.vollstaendig_am,
       ab.abzug_tag,
       ab.seiten_gesamt                                                       AS seiten,
       ab.produkte_gemeldet,
       coalesce(p.produkte, 0)::int                                           AS produkte,
       coalesce(p.nicht_mehr_geliefert, 0)::int                               AS nicht_mehr_geliefert,
       coalesce(p.ohne_preis, 0)::int                                         AS ohne_preis,
       coalesce(p.ohne_artikelnummer, 0)::int                                 AS ohne_artikelnummer,
       coalesce(p.eigenproduktion, 0)::int                                    AS eigenproduktion,
       coalesce(p.mit_katalogpreis, 0)::int                                   AS mit_katalogpreis,
       v.reihe_ab,
       coalesce(a.preisaenderungen_30_tage, 0)::int                           AS preisaenderungen_30_tage,
       coalesce(a.katalogaenderungen_30_tage, 0)::int                         AS katalogaenderungen_30_tage,
       ab.befund
  FROM ks k
  LEFT JOIN core.ware_stand_abruf ab ON ab.kostenstelle_key = k.kostenstelle_key
  LEFT JOIN zugriff z                ON z.marke_key = k.marke_key AND z.erp_id = k.erp_id::text
  LEFT JOIN produkte p               ON p.kostenstelle_key = k.kostenstelle_key
  LEFT JOIN verlauf v                ON v.kostenstelle_key = k.kostenstelle_key
  LEFT JOIN aenderung a              ON a.kostenstelle_key = k.kostenstelle_key;

COMMENT ON VIEW mart.warenstamm_stand IS
'Je Kostenstelle mit Warenwirtschaft (erpId): kommt der Warenstamm an (0157, Regel 10)? zustand: ok / marke nicht
aktiv (WARENSTAMM_MARKEN, vorerst nur Wilma Wunder) / kein zugriff (FoodNotify verweigert die Kostenstelle
dauerhaft, 0075) / nie geladen / unvollstaendig (eine Folgeseite meldete eine andere Gesamtzahl) / veraltet
(letzter VOLLSTAENDIGER Abzug aelter als 36 h) / leer / ohne betrieb (Kostenstelle keinem Betrieb zugeordnet —
darunter die Testkostenstellen "AAA Testrestaurant", "… TESTBETRIEB", die mit geladen werden).
Dazu die Zahl der Produkte der letzten Antwort, ohne Preis, ohne Artikelnummer, Eigenproduktion, und reihe_ab:
ab diesem Tag gibt es fuer die Kostenstelle eine Preisreihe — davor nicht.';
COMMENT ON COLUMN mart.warenstamm_stand.reihe_ab IS
'Tag des ersten Abzugs. Ab hier ist eine Listenpreis-Aenderung beobachtbar; FoodNotify kennt keine Preishistorie.';
COMMENT ON COLUMN mart.warenstamm_stand.preisaenderungen_30_tage IS
'Reine Aenderungen des Listenpreises (unitPrice, vergleichbar) der letzten 30 Tage, aus mart.listenpreis_aenderung.';
COMMENT ON COLUMN mart.warenstamm_stand.katalogaenderungen_30_tage IS
'Reine Aenderungen des Katalogpreises (pricePerUnit, vergleichbar) der letzten 30 Tage.';
COMMENT ON COLUMN mart.warenstamm_stand.mit_katalogpreis IS
'Produkte mit Katalogpreis (angebundener Lieferantenkatalog). Bar Ballplatz 19.11.2026: 109 von 206; ein
Testrestaurant ohne Katalog hat 0.';


-- ---------------------------------------------------------------------
-- 6. mart.pruefung_uebersicht — eine Zeile am Ende
--
-- Wie 0155: die Definition aus der Zieldatenbank gelesen und ergaenzt.
-- Erwartung 0. Gezaehlt werden Kostenstellen aktiver Marken mit Zugriff.
-- Abgeschaltete Marken und dauerhaft verweigerte Kostenstellen zaehlen nicht
-- mit — sonst stuende die Zeile fuer immer auf denselben und niemand laese
-- sie mehr.
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%warenstamm_stand%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        SELECT 'FoodNotify-Warenstamm: Kostenstelle einer aktiven Marke ohne vollstaendigen Abzug (36 h) oder leer'::text AS pruefung,
               count(*) FILTER (WHERE ws.marke_aktiv AND ws.zustand <> 'kein zugriff')::bigint            AS geprueft,
               count(*) FILTER (WHERE ws.zustand IN ('nie geladen', 'unvollstaendig', 'veraltet', 'leer'))::bigint AS auffaellig,
               'mart.warenstamm_stand'::text AS sicht
          FROM mart.warenstamm_stand ws
        $zweig$);

    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def NOT LIKE '%FoodNotify-Warenstamm: Kostenstelle einer aktiven Marke%' THEN
        RAISE EXCEPTION '0157: mart.pruefung_uebersicht traegt nach dem Umbau nicht die erwartete Zeile';
    END IF;
END $aussen$;


-- ---------------------------------------------------------------------
-- 7. sync.quelle — die Zulauferwartung (Regel 10)
--
-- Das Register steht in src/sync/quellen.ts und wird bei jedem Lauf
-- gespiegelt; die Zeilen stehen hier zusaetzlich, damit mart.quelle_zulauf
-- schon vor dem ersten Lauf nach dem Deploy die Erwartung kennt. erwartet =
-- true entspricht WARENSTAMM_MARKEN = wilma_wunder (Vorgabe). core:ware_stand
-- stand seit 0076 als erwartet = false (kein Schreiber) — jetzt gemessen an
-- zuletzt_gesehen_am, taeglich.
-- ---------------------------------------------------------------------

INSERT INTO sync.quelle (quelle, bezeichnung, system, endpunkt, kadenz_stunden, erwartet, bemerkung)
VALUES ('fn:warenstamm', 'Warenstamm je Kostenstelle mit Listenpreis und Bestand', 'foodnotify',
        'fn:warenstamm', 36, true,
        'Marken: wilma_wunder (WARENSTAMM_MARKEN). Je Kostenstelle: mart.warenstamm_stand.')
ON CONFLICT (quelle) DO UPDATE
   SET bezeichnung = excluded.bezeichnung, system = excluded.system, endpunkt = excluded.endpunkt,
       kadenz_stunden = excluded.kadenz_stunden, erwartet = excluded.erwartet, bemerkung = excluded.bemerkung;

INSERT INTO sync.quelle (quelle, bezeichnung, system, schema_name, tabelle, zeitspalte, kadenz_stunden,
                         erwartet, bemerkung)
VALUES ('core:ware_stand', 'Warenstamm und Listenpreis (FoodNotify)', 'foodnotify',
        'core', 'ware_stand', 'zuletzt_gesehen_am', 36, true,
        'Seit 0157 befuellt (fn:warenstamm), gemessen an zuletzt_gesehen_am. Je Kostenstelle: mart.warenstamm_stand.')
ON CONFLICT (quelle) DO UPDATE
   SET bezeichnung = excluded.bezeichnung, system = excluded.system, schema_name = excluded.schema_name,
       tabelle = excluded.tabelle, zeitspalte = excluded.zeitspalte, kadenz_stunden = excluded.kadenz_stunden,
       erwartet = excluded.erwartet, bemerkung = excluded.bemerkung;


-- ---------------------------------------------------------------------
-- 8. TEIL B — mart.einkaufspreis_artikel_monat: bezahlte Preise je
--    Lieferant und Lieferanten-Artikelnummer
--
-- WARUM EINE NEUE SICHT. mart.einkaufspreis_monat (0041/0063) gruppiert
-- nach dem WARENNAMEN (core.ware.name). Wechselt die Schreibweise
-- ("Karton 12x1l" gegen "Karton 12X1L") oder die Nummer, bricht die Reihe,
-- und gleichnamige Waren zweier Lieferanten fallen zusammen. Der belastbare
-- Schluessel ist core.bestellposition.lieferanten_nr zusammen mit dem
-- Lieferanten der Bestellung (0094: 100 % Treffer gegen 10,1 % ueber
-- core.ware.fn_id). Der Name steht nur noch daneben: der juengste und die
-- Zahl der verschiedenen. Die bestehenden Sichten bleiben unveraendert.
--
-- DIE REGELN DER BESTEHENDEN SICHTEN GELTEN HIER GENAUSO:
--   * Stornos zaehlen nicht (0043: status IS DISTINCT FROM 'canceled').
--   * Rechengroesse ist der GEBINDEPREIS summe_preis / menge (0041): ueber
--     die Zeit bucht derselbe Besteller dieselbe Einheit. Der Preis je
--     Basiseinheit haengt an FoodNotifys Mengenangabe, die 0040, 0042,
--     0057, 0060 und 0061 beschaeftigt hat.
--   * Gebindewechsel sind keine Teuerung (0062): gebinde_typisch je Monat,
--     gebinde_varianten, und verdaechtig bei Wechsel des typischen Gebindes,
--     mehreren Gebinden im Monat, Einheitswechsel, baseUnit oder einem
--     Sprung um Faktor 2 in EINE der beiden Richtungen (Verhaeltnis statt
--     Prozent, 0062).
--   * Ausreisser ueber Faktor 20 zum Median der ganzen Reihe fallen heraus,
--     wenn die Reihe mindestens vier Positionen hat (wie
--     mart.einkaufspreis_monat_basis); wie viele, steht in `ausreisser`.
--
-- VERAENDERUNG GEGEN DEN LETZTEN MONAT MIT BESTELLUNG, nicht gegen den
-- Kalender-Vormonat: die meisten Waren werden nicht jeden Monat bestellt,
-- und eine Reihe mit Luecken hatte in mart.einkaufspreis_veraenderung dann
-- gar keinen Vergleich. monate_seit_vorher sagt, wie weit der Vergleich
-- zurueckgreift.
--
-- MONAT ist der Berliner Kalendermonat des Bestellzeitpunkts (explizit, nicht
-- die Zeitzone der Sitzung — 0156).
--
-- MATERIALISIERT, weil die Rechnung die ganze Reihe braucht (Median fuer die
-- Ausreisser, Vorgaenger je Reihe) und ein Filter auf Marke oder Monat deshalb
-- nicht nach innen wirkt: am Klon (634.175 Positionen) 3,0 bis 4,3 s je Abfrage,
-- in Produktion mehr. Aufgefrischt im Einkaufs-Nachlauf (src/sync/einkauf_sichten.ts),
-- nach core.gebinde_vereinheitlichen() — wie die uebrigen Einkaufssichten (0063).
-- Namen von Marke und Lieferant werden live gejoint.
-- ---------------------------------------------------------------------

CREATE MATERIALIZED VIEW mart.einkaufspreis_artikel_monat_basis AS
WITH basis AS (
    SELECT k.marke_key,
           b.lieferant_key,
           bp.lieferanten_nr,
           -- EIN Schluessel fuer die Reihe: die Joins unten laufen ueber diese eine Spalte. Ueber drei
           -- Spalten schaetzte der Planer die Zwischenstufe auf 274 statt 614.000 Zeilen und waehlte
           -- Nested Loops — die Materialisierung lief am Klon nach 2 Minuten noch (19.11.2026).
           k.marke_key::text || '|' || b.lieferant_key::text || '|' || bp.lieferanten_nr AS reihe_id,
           date_trunc('month', b.bestellt_am AT TIME ZONE 'Europe/Berlin')::date AS monat,
           b.bestellt_am,
           b.bestellung_key,
           k.kostenstelle_key,
           k.betrieb_key,
           bp.bestellposition_key,
           bp.name,
           bp.einheit,
           bp.menge,
           bp.gebinde_menge,
           bp.summe_preis,
           bp.summe_preis / bp.menge AS preis_je_gebinde
      FROM core.bestellposition bp
      JOIN core.bestellung b   ON b.bestellung_key = bp.bestellung_key
      JOIN core.kostenstelle k ON k.kostenstelle_key = b.kostenstelle_key
     WHERE b.bestellt_am IS NOT NULL
       AND b.status IS DISTINCT FROM 'canceled'
       AND b.lieferant_key IS NOT NULL
       -- '' ist keine Nummer: 2.192 Positionen am Klon, bei einem Lieferanten 13 verschiedene Waren
       -- unter derselben leeren Nummer — ohne diese Bedingung eine Scheinreihe.
       AND bp.lieferanten_nr IS NOT NULL AND bp.lieferanten_nr <> ''
       AND bp.menge > 0
       AND bp.summe_preis > 0
),
streuung AS (
    SELECT reihe_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY preis_je_gebinde::float8)::numeric AS median_gesamt,
           count(*) AS belege
      FROM basis
     GROUP BY reihe_id
),
markiert AS (
    SELECT b.*,
           NOT (s.belege < 4
                OR (b.preis_je_gebinde <= s.median_gesamt * 20 AND b.preis_je_gebinde * 20 >= s.median_gesamt))
             AS ist_ausreisser
      FROM basis b
      JOIN streuung s ON s.reihe_id = b.reihe_id
),
reihe AS (
    SELECT reihe_id,
           (array_agg(name ORDER BY bestellt_am DESC, bestellposition_key DESC)
              FILTER (WHERE NOT ist_ausreisser))[1]                          AS ware,
           count(DISTINCT name) FILTER (WHERE NOT ist_ausreisser)             AS namen
      FROM markiert
     GROUP BY reihe_id
),
monat AS (
    SELECT reihe_id, marke_key, lieferant_key, lieferanten_nr, monat,
           (array_agg(name ORDER BY bestellt_am DESC, bestellposition_key DESC)
              FILTER (WHERE NOT ist_ausreisser))[1]                          AS ware_im_monat,
           count(DISTINCT name) FILTER (WHERE NOT ist_ausreisser)             AS namen_monat,
           count(DISTINCT bestellung_key) FILTER (WHERE NOT ist_ausreisser)   AS bestellungen,
           count(*) FILTER (WHERE NOT ist_ausreisser)                         AS positionen,
           count(DISTINCT betrieb_key) FILTER (WHERE NOT ist_ausreisser)      AS betriebe,
           count(DISTINCT kostenstelle_key) FILTER (WHERE NOT ist_ausreisser) AS kostenstellen,
           sum(menge) FILTER (WHERE NOT ist_ausreisser)                       AS gebinde,
           sum(summe_preis) FILTER (WHERE NOT ist_ausreisser)                 AS ausgaben,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY preis_je_gebinde::float8)
                   FILTER (WHERE NOT ist_ausreisser)::numeric, 4)             AS preis_je_gebinde,
           round(min(preis_je_gebinde) FILTER (WHERE NOT ist_ausreisser), 4)  AS preis_min,
           round(max(preis_je_gebinde) FILTER (WHERE NOT ist_ausreisser), 4)  AS preis_max,
           mode() WITHIN GROUP (ORDER BY gebinde_menge) FILTER (WHERE NOT ist_ausreisser) AS gebinde_typisch,
           count(DISTINCT gebinde_menge) FILTER (WHERE NOT ist_ausreisser)    AS gebinde_varianten,
           mode() WITHIN GROUP (ORDER BY einheit) FILTER (WHERE NOT ist_ausreisser) AS einheit,
           count(DISTINCT einheit) FILTER (WHERE NOT ist_ausreisser)          AS einheiten,
           count(*) FILTER (WHERE ist_ausreisser)                             AS ausreisser
      FROM markiert
     GROUP BY reihe_id, marke_key, lieferant_key, lieferanten_nr, monat
     -- Ein Monat, in dem nur Ausreisser stehen, hat keinen Preis und keine Zeile.
    HAVING count(*) FILTER (WHERE NOT ist_ausreisser) > 0
),
mit_vorher AS (
    SELECT mo.*,
           lag(mo.monat)            OVER w AS vorher_monat,
           lag(mo.preis_je_gebinde) OVER w AS vorher_preis,
           lag(mo.gebinde_typisch)  OVER w AS vorher_gebinde,
           lag(mo.einheit)          OVER w AS vorher_einheit
      FROM monat mo
    WINDOW w AS (PARTITION BY mo.reihe_id ORDER BY mo.monat)
)
SELECT v.marke_key, v.lieferant_key, v.lieferanten_nr, v.monat,
       r.ware, r.namen, v.ware_im_monat, v.namen_monat,
       v.bestellungen, v.positionen, v.betriebe, v.kostenstellen, v.gebinde, v.ausgaben,
       v.preis_je_gebinde, v.preis_min, v.preis_max,
       v.gebinde_typisch, v.gebinde_varianten, v.einheit, v.einheiten,
       v.vorher_monat, v.vorher_preis, v.vorher_gebinde, v.vorher_einheit,
       v.ausreisser
  FROM mit_vorher v
  JOIN reihe r ON r.reihe_id = v.reihe_id;

-- CONCURRENTLY braucht einen eindeutigen Index.
CREATE UNIQUE INDEX einkaufspreis_artikel_monat_basis_pk
    ON mart.einkaufspreis_artikel_monat_basis (marke_key, lieferant_key, lieferanten_nr, monat);
CREATE INDEX einkaufspreis_artikel_monat_basis_monat
    ON mart.einkaufspreis_artikel_monat_basis (monat);
CREATE INDEX einkaufspreis_artikel_monat_basis_nr
    ON mart.einkaufspreis_artikel_monat_basis (lieferanten_nr);

COMMENT ON MATERIALIZED VIEW mart.einkaufspreis_artikel_monat_basis IS
'Koernung: Marke × Lieferant × Lieferanten-Artikelnummer × Monat — Zwischenstufe von
mart.einkaufspreis_artikel_monat (0157), aufgefrischt im Einkaufs-Nachlauf. Wie alt: mart.materialisierung_stand.';

CREATE VIEW mart.einkaufspreis_artikel_monat AS
SELECT m.name                                                            AS marke,
       b.marke_key,
       b.lieferant_key,
       l.name                                                            AS lieferant,
       b.lieferanten_nr,
       b.ware,
       b.namen,
       (b.namen > 1)                                                     AS name_gewechselt,
       b.ware_im_monat,
       b.monat,
       b.bestellungen,
       b.positionen,
       b.betriebe,
       b.kostenstellen,
       b.gebinde,
       b.ausgaben,
       b.preis_je_gebinde,
       b.preis_min,
       b.preis_max,
       b.gebinde_typisch,
       b.gebinde_varianten,
       b.einheit,
       b.vorher_monat,
       b.vorher_preis,
       ((extract(year FROM b.monat) - extract(year FROM b.vorher_monat)) * 12
         + extract(month FROM b.monat) - extract(month FROM b.vorher_monat))::int AS monate_seit_vorher,
       CASE WHEN b.vorher_preis > 0
            THEN round(100.0 * (b.preis_je_gebinde - b.vorher_preis) / b.vorher_preis, 1) END AS veraenderung_pct,
       (b.vorher_monat IS NOT NULL AND b.gebinde_typisch IS DISTINCT FROM b.vorher_gebinde) AS gebinde_gewechselt,
       (b.vorher_monat IS NOT NULL AND b.einheit IS DISTINCT FROM b.vorher_einheit)         AS einheit_gewechselt,
       coalesce(
           b.einheit = 'baseUnit'
        OR b.gebinde_varianten > 1
        OR b.einheiten > 1
        OR (b.vorher_monat IS NOT NULL AND b.gebinde_typisch IS DISTINCT FROM b.vorher_gebinde)
        OR (b.vorher_monat IS NOT NULL AND b.einheit IS DISTINCT FROM b.vorher_einheit)
        OR (b.vorher_preis > 0 AND (b.preis_je_gebinde >= b.vorher_preis * 2
                                    OR b.preis_je_gebinde * 2 <= b.vorher_preis)), false) AS verdaechtig,
       b.ausreisser
  FROM mart.einkaufspreis_artikel_monat_basis b
  JOIN core.marke m          ON m.marke_key = b.marke_key
  JOIN core.lieferant l      ON l.lieferant_key = b.lieferant_key;

COMMENT ON VIEW mart.einkaufspreis_artikel_monat IS
'Was hat eine Ware gekostet, und wie hat sich der Preis entwickelt — je Marke, Lieferant und
LIEFERANTEN-ARTIKELNUMMER (nicht je Warenname) und Monat (0157). Echte Belegpreise aus FoodNotify-Bestellungen,
ohne Stornos. preis_je_gebinde ist der Median von summe_preis / menge, also je bestellter Einheit (Karton,
Sack), nicht je kg. veraenderung_pct vergleicht mit dem LETZTEN MONAT MIT BESTELLUNG (vorher_monat,
monate_seit_vorher), nicht mit dem Kalender-Vormonat. verdaechtig = true heisst: der Sprung kann ein
Gebinde- oder Einheitenwechsel sein, keine Teuerung — fuer "was ist teurer geworden" auf NOT verdaechtig
filtern. Eine Ware, deren Name wechselte, bleibt EINE Reihe (ware = juengster Name, namen = Zahl der
Schreibweisen). Wechselt der Lieferant die Artikelnummer, beginnt eine neue Reihe. Listenpreise aus dem
Warenstamm: mart.listenpreis_aktuell.';
COMMENT ON COLUMN mart.einkaufspreis_artikel_monat.preis_je_gebinde IS
'Median des Gebindepreises (summe_preis / menge) der Positionen im Monat, netto EUR je bestellter Einheit.';
COMMENT ON COLUMN mart.einkaufspreis_artikel_monat.veraenderung_pct IS
'Gegen vorher_preis (letzter Monat mit Bestellung), Prozentzahl (8.5, nicht 0.085). Nur mit NOT verdaechtig
als Preisaenderung lesen; ueber Waren nicht mitteln.';
COMMENT ON COLUMN mart.einkaufspreis_artikel_monat.monate_seit_vorher IS
'Abstand zum Vergleichsmonat in Monaten. 1 = Vormonat; 12 heisst, der Vergleich reicht ein Jahr zurueck.';
COMMENT ON COLUMN mart.einkaufspreis_artikel_monat.ware IS
'Juengster Positionsname der ganzen Reihe — damit traegt jede Zeile der Reihe denselben Namen.';
COMMENT ON COLUMN mart.einkaufspreis_artikel_monat.namen IS
'Verschiedene Positionsnamen ueber die ganze Reihe. Ueber 1: die Ware hiess frueher anders (name_gewechselt).';
COMMENT ON COLUMN mart.einkaufspreis_artikel_monat.betriebe IS
'Verschiedene LINA-Betriebe mit Bestellung. Kostenstellen ohne Betriebszuordnung zaehlen hier nicht, aber in kostenstellen.';
COMMENT ON COLUMN mart.einkaufspreis_artikel_monat.ausreisser IS
'Positionen im Monat, die um mehr als Faktor 20 vom Median der Reihe abweichen und deshalb nicht mitzaehlen.';

-- In mart.materialisierung_stand verankern (0091) — angehaengt, nicht abgeschrieben (wie 0142).
DO $aussen$
DECLARE
    v_def  text;
    v_neu  text;
BEGIN
    SELECT pg_get_viewdef('mart.materialisierung_stand'::regclass, true) INTO v_def;
    IF v_def LIKE '%einkaufspreis_artikel_monat_basis%' THEN RETURN; END IF;
    v_neu := regexp_replace(v_def,
        '(''mart\.einkauf_pruefung_basis''::text\s*,\s*''einkauf_sichten_refresh''::text\s*,\s*''src/sync/einkauf_sichten\.ts''::text\s*\))',
        '\1, (''mart.einkaufspreis_artikel_monat_basis''::text, ''einkauf_sichten_refresh''::text, '
        '''src/sync/einkauf_sichten.ts''::text)');
    IF v_neu = v_def THEN
        RAISE EXCEPTION '0157: Verankerung in mart.materialisierung_stand nicht gefunden — die Sicht '
                        'wurde umgebaut. mart.einkaufspreis_artikel_monat_basis von Hand eintragen.';
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW mart.materialisierung_stand AS ' || v_neu;
END $aussen$;


-- ---------------------------------------------------------------------
-- 9. MCP-Katalog: Koernung, Thema, Summierbarkeit, Kennzahlen, Fallstricke
--
-- Nur die Regelart deutung, die mcp/src/pruefen.ts kennt — eine unbekannte
-- liesse den Server nicht starten (AGENTS.md, mcp-Regel 1).
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.listenpreis_aktuell',
     'Kostenstelle × Produkt des Warenstamms (heutiger Stand) — ein Betrieb hat oft zwei Kostenstellen (Bar, Kueche) mit eigenem Warenstamm',
     'einkauf', false),
    ('mart.listenpreis_aenderung',
     'eine beobachtete Aenderung des Listenpreises je Kostenstelle und Produkt — die Reihe beginnt am Tag des ersten Abzugs',
     'einkauf', false),
    ('mart.warenstamm_stand',
     'eine Kostenstelle mit Warenwirtschaft (erpId) — Zulauf des Warenstamms',
     'pruefung', false),
    ('mart.einkaufspreis_artikel_monat',
     'Marke × Lieferant × Lieferanten-Artikelnummer × Monat — bezahlte Gebindepreise, Vergleich mit dem letzten Monat mit Bestellung',
     'einkauf', false),
    ('mart.einkaufspreis_artikel_monat_basis',
     'Marke × Lieferant × Lieferanten-Artikelnummer × Monat (Zwischenstufe von mart.einkaufspreis_artikel_monat)',
     'einkauf', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

INSERT INTO mcp.kennzahl (sicht, spalte, regel, einheit, hinweis) VALUES
  ('mart.listenpreis_aktuell', 'listenpreis', 'nicht_aggregieren', 'euro',
   'Preis je Einheit (kg, l), nicht je Gebinde. Ueber Waren nicht summieren oder mitteln.'),
  ('mart.listenpreis_aktuell', 'listenpreis_gebinde', 'nicht_aggregieren', 'euro',
   'Gerechnet aus listenpreis x inhalt x gebinde_menge, nicht geliefert.'),
  ('mart.listenpreis_aktuell', 'abweichung_median_pct', 'nicht_aggregieren', 'prozentzahl', NULL),
  ('mart.listenpreis_aktuell', 'katalogpreis', 'nicht_aggregieren', 'euro',
   'Preis je Einheit im Lieferantenkatalog, nur bei bestellbaren Waren; NULL ist kein Preis.'),
  ('mart.listenpreis_aktuell', 'katalog_abweichung_pct', 'nicht_aggregieren', 'prozentzahl', NULL),
  ('mart.listenpreis_aktuell', 'bestand_wert', 'summe', 'euro',
   'Bestandswert laut FoodNotify zum Abrufzeitpunkt; ueber Kostenstellen summierbar, nicht ueber Tage.'),
  ('mart.listenpreis_aenderung', 'aenderung_pct', 'nicht_aggregieren', 'prozentzahl',
   'Nur mit vergleichbar = true als Preisaenderung lesen.'),
  ('mart.listenpreis_aenderung', 'preis_alt', 'nicht_aggregieren', 'euro', NULL),
  ('mart.listenpreis_aenderung', 'preis_neu', 'nicht_aggregieren', 'euro', NULL),
  ('mart.einkaufspreis_artikel_monat', 'preis_je_gebinde', 'nicht_aggregieren', 'euro',
   'Median je Monat. Fuer mehrere Monate nicht mitteln, sondern ausgaben / gebinde rechnen.'),
  ('mart.einkaufspreis_artikel_monat', 'veraenderung_pct', 'nicht_aggregieren', 'prozentzahl',
   'Gegen den letzten Monat mit Bestellung; nur mit NOT verdaechtig lesen.'),
  ('mart.einkaufspreis_artikel_monat', 'ausgaben', 'summe', 'euro', NULL),
  ('mart.einkaufspreis_artikel_monat', 'gebinde', 'summe', 'anzahl', NULL)
ON CONFLICT (sicht, spalte) DO UPDATE
   SET regel = excluded.regel, einheit = excluded.einheit, hinweis = excluded.hinweis;

INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle) VALUES
  ('listenpreis_ist_nicht_bezahlt', 'deutung', 'warnung', 'mart.listenpreis_aktuell', '{}',
   'Zwei Preise je Einheit (kg, l), beide nicht bezahlt und nicht je Gebinde: listenpreis (Warenstamm) folgt nach '
   'der Messung vom 19.11.2026 dem Preis der letzten Bestellung, katalogpreis ist der heutige Lieferantenkatalog '
   'und nur bei bestellbaren Waren gefuellt. Ein Preis 0 oder leer heisst kein Preis. Vorerst nur Wilma Wunder; '
   'Kostenstellen ohne Betrieb sind oft Testkostenstellen.',
   'Fuer bezahlte Preise mart.einkaufspreis_artikel_monat nehmen; Preise als "laut Warenstamm" bzw. "laut '
   'Lieferantenkatalog, je kg/l" nennen, kein_preis ausschliessen, fuer Betriebsaussagen betrieb_key IS NOT NULL setzen.',
   '0157'),
  ('listenpreis_reihe_beginnt_spaet', 'deutung', 'warnung', 'mart.listenpreis_aenderung', '{}',
   'Die Listenpreis-Reihe beginnt mit dem ersten Abzug des Warenstamms (0157); FoodNotify fuehrt keine '
   'Preishistorie. Vor diesem Tag gibt es keine Aenderungen, auch wenn es welche gab. Der Tag einer Aenderung ist '
   'der Tag, an dem wir sie sahen.',
   'Bei Fragen vor reihe_ab (mart.warenstamm_stand) auf mart.einkaufspreis_artikel_monat ausweichen; Aenderungen '
   'nur mit vergleichbar = true und immer je preisart (listenpreis oder katalogpreis) zaehlen.',
   '0157'),
  ('einkaufspreis_artikel_vergleich_letzte_bestellung', 'deutung', 'warnung', 'mart.einkaufspreis_artikel_monat', '{}',
   'veraenderung_pct vergleicht mit dem letzten Monat MIT Bestellung (monate_seit_vorher kann 12 und mehr sein), '
   'und preis_je_gebinde ist je bestellter Einheit. Ein Gebinde- oder Einheitenwechsel sieht aus wie eine '
   'Preisaenderung; dann steht verdaechtig auf true.',
   'Fuer Teuerung auf NOT verdaechtig filtern und monate_seit_vorher nennen; ueber Waren nicht mitteln.',
   '0157')
ON CONFLICT (schluessel) DO UPDATE
   SET art = excluded.art, schwere = excluded.schwere, sicht = excluded.sicht,
       parameter = excluded.parameter, hinweis = excluded.hinweis,
       berichtigung = excluded.berichtigung, quelle = excluded.quelle;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();


-- ---------------------------------------------------------------------
-- 10. Rechte und die Gegenprobe als Leserolle (Pflicht seit 0110)
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
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0157 ist uebersprungen';
        RETURN;
    END IF;

    SELECT count(*) INTO v_rechte FROM mart.mcp_rechte_pruefung;
    IF v_rechte > 0 THEN
        RAISE EXCEPTION '0157: mart.mcp_rechte_pruefung ist nicht leer (% Zeilen)', v_rechte;
    END IF;

    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0157 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_abfrage IN ARRAY ARRAY[
        'SELECT * FROM mart.listenpreis_aktuell LIMIT 1',
        'SELECT * FROM mart.listenpreis_aenderung LIMIT 1',
        'SELECT * FROM mart.warenstamm_stand LIMIT 1',
        'SELECT * FROM mart.einkaufspreis_artikel_monat LIMIT 1',
        'SELECT * FROM mart.einkaufspreis_artikel_monat_basis LIMIT 1',
        'SELECT * FROM mart.pruefung_uebersicht WHERE sicht = ''mart.warenstamm_stand''',
        'SELECT * FROM mart.materialisierung_stand WHERE sicht = ''mart.einkaufspreis_artikel_monat_basis''']
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
        RAISE EXCEPTION '0157 hat sein Ziel nicht erreicht — fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
