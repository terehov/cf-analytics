-- =====================================================================
-- 0032 Das Aufgabenprotokoll lernt Mandant und Parameter
--
-- Teil von Stufe 1.4 (docs/plan-foodnotify.md).
--
-- Zwei Spalten, ein Zweck: die Regel "eine leere 200er-Antwort ist
-- verdaechtig, sobald dieselbe Kombination schon einmal Daten lieferte"
-- braucht eine Kombination, die es fuer FoodNotify bisher nicht gibt.
--
-- LINA-Posten sind ueber (endpunkt, betrieb_enc_id, zeitraum) eindeutig.
-- FoodNotify-Posten nicht: fn:bestellungen fuer erpId 10483, Seite 3,
-- unterscheidet sich von derselben Seite fuer erpId 11034 NUR im
-- parameter-Feld -- und ohne Marke waere nicht einmal klar, zu welchem
-- Mandanten erpId 10483 gehoert.
--
-- parameter auch fuer LINA-Aufgaben mitzuschreiben kostet nichts und
-- macht das Protokoll nachvollziehbarer: bisher stand dort, DASS ein
-- Posten lief, aber nicht, WOMIT.
-- =====================================================================

ALTER TABLE sync.aufgabe
    ADD COLUMN marke_key integer REFERENCES core.marke(marke_key),
    ADD COLUMN parameter jsonb;

COMMENT ON COLUMN sync.aufgabe.marke_key IS
'FoodNotify-Mandant des Postens, NULL = LINA. Uebernommen aus
sync.warteschlange.marke_key beim Protokollieren.';
COMMENT ON COLUMN sync.aufgabe.parameter IS
'Die Zusatzparameter des Postens (warteschlange.parameter), z. B. erpId und
Seite bei fn:bestellungen. Zusammen mit endpunkt und marke_key die
Kombination, ueber die "kam hier frueher schon einmal etwas?" beantwortbar
ist -- die Grundlage der Leere-200er-Pruefung in src/foodnotify/laden.ts.';

-- Der Suchpfad der Leere-200er-Pruefung: gab es fuer genau diese
-- Kombination schon einmal Daten? Partiell auf ok-Aufgaben mit Zeilen,
-- denn nur die interessieren die Pruefung.
CREATE INDEX aufgabe_fn_kombination
    ON sync.aufgabe (endpunkt, marke_key, parameter)
 WHERE status = 'ok' AND zeilen > 0;
