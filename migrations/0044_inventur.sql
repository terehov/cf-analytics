-- ---------------------------------------------------------------------
-- Migration 0044 · Inventuren (B1, Stufe 4 aus docs/plan-foodnotify.md)
--
-- Letzter Baustein aus dem ursprünglichen FoodNotify-Plan. Anders als
-- Bestellungen und Rezepturen hing dieser Teil nie am kaputten
-- Verkaufs-Import (plan-foodnotify.md §8a/0.2): gezählte Menge,
-- Sollbestand und Preis je Basiseinheit stehen unabhängig davon in
-- `/api/erp/stocktakings/{uuid}/items`. Zusammen ergeben sie den
-- BEWERTBAREN SCHWUND — Differenz aus Soll und gezählter Menge, bewertet
-- mit dem Preis je Basiseinheit, in Euro.
--
-- LOHNEND FAST NUR BEI WILMA WUNDER (docs/foodnotify-api-inventar.md §8b,
-- gemessen 27.07.2026 – 01.08.2026):
--
--     Wilma Wunder        275 Inventuren, 154 signiert
--     Enchilada            ~70 Inventuren
--     Aposto                19 Inventuren, 14 signiert
--     Deutsche Konzepte       9 Inventuren, 5 davon storniert
--
-- Bei Aposto und Deutsche Konzepte ist eine inventurgestützte
-- Schwundrechnung damit praktisch nicht möglich — die Tabellen werden
-- trotzdem für alle vier Marken angelegt (dieselbe Mandantenlogik wie
-- core.bestellung), aber nur Wilma Wunder wird eine belastbare Aussage
-- liefern.
--
-- ---------------------------------------------------------------------
-- SCHLÜSSEL UND ART DER SPALTEN — bewusst wie core.bestellung, nicht wie
-- core.rezept: eine Inventur hängt an einer KOSTENSTELLE (Bar oder Küche),
-- nicht an der Marke direkt. `/api/erp/stocktakings` liefert erpId je
-- Kopf — das ist derselbe Schlüssel wie bei Bestellungen, und core.marke
-- ergibt sich daraus über core.kostenstelle.marke_key, muss also nicht
-- noch einmal in dieser Tabelle stehen (dieselbe Begründung wie bei
-- core.bestellung in 0030).
--
-- fn_uuid statt fn_id: FoodNotify vergibt hier UUIDv7 statt der sonst
-- üblichen numerischen oder Text-IDs (Inventar §4: "id (UUIDv7)"). Der
-- Spaltentyp bleibt trotzdem TEXT, nicht `uuid` — dieselbe Vorsicht wie
-- bei core.zutat.ware_fn_id (0030): ein Feld, das FoodNotify als String
-- liefert, soll keine Zeile zum Abbruch bringen, nur weil ein einzelner
-- Wert nicht ins strengere Format passt. Die Eindeutigkeit stellt der
-- UNIQUE-Index sicher, nicht der Spaltentyp.
--
-- STATUS UND ART OHNE CHECK-CONSTRAINT — bewusst wie core.bestellung.status
-- (siehe 0043) und NICHT wie core.warengruppe_fn.art. Das Inventar nennt
-- signed | counting | canceled als Vokabular, aber ungeprüft am echten
-- Endpunkt (der wurde nie live abgefragt — AGENTS.md Regel 1 gilt sinngemäß
-- für FoodNotify: nicht auf Verdacht schreiben). Ein CHECK, der ein
-- fünftes Wort nicht kennt, ließe die GANZE Transaktion scheitern, und
-- genau das ist bei core.bestellung.status schon einmal danebengegangen
-- (0043: '[object Object]' wegen eines zu engen Parsers, nicht wegen des
-- Schemas — aber die Lehre gilt genauso für ein zu enges CHECK).
--
-- `type` (API) → `art` (Spalte): Werte nicht gemessen, deshalb frei TEXT.
-- ---------------------------------------------------------------------

CREATE TABLE core.inventur (
    inventur_key      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kostenstelle_key  integer NOT NULL REFERENCES core.kostenstelle(kostenstelle_key),
    fn_uuid           text    NOT NULL,
    name              text,
    art               text,
    status            text,
    anzahl_positionen integer,
    notiz             text,
    erstellt_am       timestamptz,
    geaendert_am      timestamptz,
    erstmals_am       timestamptz NOT NULL DEFAULT now(),
    zuletzt_am        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (kostenstelle_key, fn_uuid)
);
COMMENT ON TABLE core.inventur IS
'Inventurköpfe aus /api/erp/stocktakings. LOHNEND FAST NUR BEI WILMA WUNDER
(275 Stück, 154 signiert) — bei Aposto und Deutsche Konzepte gibt es praktisch
keine (19 bzw. 9, davon 5 storniert). Siehe docs/foodnotify-api-inventar.md §8b
und docs/plan-foodnotify.md Stufe 4.

DER ENDPUNKT NIMMT erpIds[] ALS ARRAY — anders als core.bestellung wird eine
Inventurliste NICHT je Kostenstelle abgerufen, sondern EINMAL je Marke für
ALLE Kostenstellen zusammen (src/foodnotify/endpunkte.ts, fn:inventuren).
kostenstelle_key kommt trotzdem aus dem erpId, das JEDER Kopf einzeln trägt.';
COMMENT ON COLUMN core.inventur.fn_uuid IS
'id aus der Antwort — laut Inventar UUIDv7, hier trotzdem TEXT statt uuid:
ein einzelner Wert außerhalb des Formats soll keine Transaktion abbrechen.
Die Eindeutigkeit je Kostenstelle stellt der UNIQUE-Index sicher.';
COMMENT ON COLUMN core.inventur.art IS
'type aus der Antwort. Werte NICHT gemessen (der Endpunkt wurde nie gegen das
echte FoodNotify abgefragt) — deshalb frei TEXT statt CHECK. Über
alsBezeichnung() geparst, falls FoodNotify hier wie bei shopOrderStatus ein
Objekt statt einer Zeichenkette liefert (src/foodnotify/inventur.ts).';
COMMENT ON COLUMN core.inventur.status IS
'status aus der Antwort — laut Inventar signed | counting | canceled, ebenfalls
ungeprüft. Kein CHECK: ein fünftes Wort soll auffallen (sync.schema_abweichung
bei Bedarf), nicht die ganze Ladung verhindern. "154 von 275 signiert" bei
Wilma Wunder zählt sich als status = ''signed''.';
COMMENT ON COLUMN core.inventur.anzahl_positionen IS
'totalNumberOfItems aus der Antwort — die vom Server erwartete Zeilenzahl.
Zusammen mit einer Zählung über core.inventurposition eine kostenlose
Plausibilitätsprüfung: weichen beide ab, ist die Positionsseite nicht
vollständig geladen.';
COMMENT ON COLUMN core.inventur.geaendert_am IS
'timeModified aus der Antwort. NULL, solange FoodNotify keine Änderung nach
der Anlage meldet.';

CREATE INDEX inventur_kostenstelle ON core.inventur (kostenstelle_key);
CREATE INDEX inventur_status       ON core.inventur (status);


-- ---------------------------------------------------------------------
-- Inventurposition — die Zählung
--
-- ACHTUNG, DIE FALLE AUS plan-foodnotify.md ZEILE 146: shopArticleId zeigt
-- auf core.ware, NICHT auf core.artikel. Es ist dieselbe Art Schlüssel wie
-- core.zutat.ware_fn_id und core.bestellposition.lieferanten_nr — eine
-- LIEFERANTEN-Artikelnummer, kein FoodNotify-eigener Warenschlüssel.
-- Deshalb wird core.ware hier über quelle = 'lieferant' angelegt bzw.
-- gefunden (core.ware.quelle aus 0042) — GENAU WIE bei
-- core.bestellposition.lieferanten_nr, nicht wie bei
-- core.bestellposition.ware_key über die concreteProduct.id.
-- ---------------------------------------------------------------------

CREATE TABLE core.inventurposition (
    inventurposition_key  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inventur_key          integer NOT NULL REFERENCES core.inventur(inventur_key) ON DELETE CASCADE,
    fn_id                 text,
    ware_key              integer REFERENCES core.ware(ware_key),
    name                  text    NOT NULL,
    shop_name             text,
    basis_einheit         text,
    soll_menge            numeric(16,4),
    gezaehlt_menge        numeric(16,4),
    nachzaehlung_menge    numeric(16,4),
    preis_je_basiseinheit numeric(14,6),
    geladen_am            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (inventur_key, fn_id)
);
COMMENT ON TABLE core.inventurposition IS
'Die Zählung je Position aus /api/erp/stocktakings/{uuid}/items. Sollbestand,
gezählte Menge und Preis je Basiseinheit ergeben zusammen den bewertbaren
Schwund:

    (soll_menge - gezaehlt_menge) * preis_je_basiseinheit

ERSETZEN STATT UPSERT beim Laden (wie core.bestellposition, 0030): die
Antwort ist der VOLLSTÄNDIGE Stand der Zählung, ein DELETE+INSERT je Inventur
in EINER Transaktion verhindert einen halb sichtbaren Zwischenstand.';
COMMENT ON COLUMN core.inventurposition.ware_key IS
'Über shopArticleId, quelle = ''lieferant'' (core.ware.quelle, 0042) —
dieselbe Lieferanten-Artikelnummer wie core.zutat.ware_fn_id und
core.bestellposition.lieferanten_nr. NICHT core.artikel: siehe die Warnung
in plan-foodnotify.md, Zeile 146. NULL, wenn shopArticleId fehlt.';
COMMENT ON COLUMN core.inventurposition.soll_menge IS
'theoreticalStockLevelInBaseUnits — der rechnerische Bestand vor der Zählung,
in der Basiseinheit (baseUnit).';
COMMENT ON COLUMN core.inventurposition.gezaehlt_menge IS
'countedAmountInBaseUnits — was tatsächlich gezählt wurde.';
COMMENT ON COLUMN core.inventurposition.nachzaehlung_menge IS
'reviewAmountInBaseUnits — eine zweite, korrigierte Zählung, wo vorhanden.
Oft NULL (keine Nachzählung nötig gewesen).';
COMMENT ON COLUMN core.inventurposition.preis_je_basiseinheit IS
'pricePerBaseUnit — bereits in derselben Basiseinheit wie soll_menge und
gezaehlt_menge. Multipliziert mit der Differenz aus soll_menge und
gezaehlt_menge ergibt sich der bewertete Schwund in Euro.';
COMMENT ON COLUMN core.inventurposition.shop_name IS
'shopName aus der Antwort — Anzeigename des Lieferanten zu shopArticleId.
Nur Kontext, KEIN Fremdschlüssel auf core.lieferant: anders als bei
Bestellungen (markedShop.shopId) liefert die Positionsantwort keine
Lieferanten-ID, nur den Namen — und core.lieferant.fn_id ist NOT NULL.';

CREATE INDEX inventurposition_ware ON core.inventurposition (ware_key) WHERE ware_key IS NOT NULL;
