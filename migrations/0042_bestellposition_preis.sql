-- ---------------------------------------------------------------------
-- Migration 0042 · Preis je Einheit und die Herkunft der Warennummer
--
-- Zwei Befunde vom 03.08.2026, beide an 310.761 echten Positionen
-- gemessen, beide in `core` zu beheben statt in einer Sicht: was hier
-- steht, gilt fuer jeden kuenftigen Import genauso.
--
-- 1. DIE GEBINDEGROESSE IST UNEINHEITLICH.
--
--    `totalUnitQuantity` entspricht in 310.032 von 310.761 Faellen
--    `menge x packagingQuantity x unitQuantity`. Bei 2.116 von 20.750
--    Waren steht `packagingQuantity` aber mal auf 50 und mal auf 1 --
--    derselbe Kaffee, dieselbe Bestellung, zwei Angaben. Steht dort 1,
--    ist die Gesamtmenge um den Gebindefaktor zu klein und der Preis je
--    Einheit entsprechend zu gross: 48.400 EUR/kg statt 48,40 EUR/kg.
--
--    `preis_je_einheit` traegt deshalb NULL, wo die Menge unstimmig ist,
--    und `menge_unstimmig` sagt, dass es eine Pruefung gab. Eine fehlende
--    Zahl ist besser als eine erfundene: die fehlende faellt auf.
--
-- 2. 18 % DER POSITIONEN HABEN KEINE WARENNUMMER.
--
--    FoodNotify liefert bei 55.408 Positionen keine `concreteProduct.id`.
--    55.232 davon tragen aber `ingredient.artikelId` -- die Nummer des
--    Lieferanten, ueber die schon Stufe 0.1 den Warenstamm verknuepft hat.
--    Ohne diesen Rueckfall bliebe fast jede fuenfte Position ohne Ware.
--
--    `core.ware.quelle` haelt fest, WOHER die Nummer stammt. Ohne diese
--    Angabe stuenden zwei Nummernraeume unmarkiert nebeneinander, und
--    eine Kollision zwischen ihnen waere spaeter nicht mehr aufzuklaeren.
-- ---------------------------------------------------------------------

ALTER TABLE core.bestellposition
    ADD COLUMN IF NOT EXISTS preis_je_einheit numeric(14,6),
    ADD COLUMN IF NOT EXISTS menge_unstimmig  boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS lieferanten_nr   text;

COMMENT ON COLUMN core.bestellposition.preis_je_einheit IS
'Bezahlter Preis je Basiseinheit (Liter, Kilo, Stueck). NULL, wenn die
Gesamtmenge nicht belastbar ist (menge_unstimmig) -- FoodNotify meldet die
Gebindegroesse derselben Ware uneinheitlich.';

COMMENT ON COLUMN core.bestellposition.menge_unstimmig IS
'true = gesamt_menge liess sich nicht gegen menge x Gebinde x Inhalt
bestaetigen. Die Position bleibt vollstaendig erhalten, nur der Preis je
Einheit wird verweigert.';

COMMENT ON COLUMN core.bestellposition.lieferanten_nr IS
'Warennummer des Lieferanten (ingredient.artikelId) -- der Rueckfall, wenn
FoodNotify keine concreteProduct.id liefert (18 % der Positionen).';

ALTER TABLE core.ware
    ADD COLUMN IF NOT EXISTS quelle text NOT NULL DEFAULT 'concrete_product';

COMMENT ON COLUMN core.ware.quelle IS
'Herkunft von fn_id: "concrete_product" = FoodNotifys eigene Warennummer,
"lieferant" = Artikelnummer des Lieferanten (ingredient.artikelId). Zwei
Nummernraeume, die nicht vermischt werden duerfen.';

-- Der Rueckfall braucht seinen eigenen Nummernraum: dieselbe Zahl kann in
-- beiden Raeumen etwas anderes bedeuten. Der bisherige Eindeutigkeits-
-- schluessel (marke_key, fn_id) wird deshalb um die Quelle erweitert.
ALTER TABLE core.ware DROP CONSTRAINT IF EXISTS ware_marke_key_fn_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS ware_marke_quelle_fn_id
    ON core.ware (marke_key, quelle, fn_id);

CREATE INDEX IF NOT EXISTS bestellposition_unstimmig
    ON core.bestellposition (menge_unstimmig) WHERE menge_unstimmig;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0042', to_jsonb(
        'core.bestellposition: preis_je_einheit, menge_unstimmig, lieferanten_nr. '
        'core.ware.quelle trennt FoodNotify-Warennummer und Lieferantennummer. '
        'Gemessen 03.08.2026: 2.116 von 20.750 Waren mit uneinheitlichem Gebinde, '
        '55.408 Positionen ohne concreteProduct.id.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
