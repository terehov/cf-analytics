-- =====================================================================
-- 0031 Die Warteschlange lernt Mandanten
--
-- Stufe 1.2 aus docs/plan-foodnotify.md.
--
-- FoodNotify sind VIER Mandanten mit eigenen Zugangsdaten und eigenen
-- ID-Raeumen. Derselbe Endpunkt ("fn:rezepte", Seite 3) existiert je
-- Marke einmal -- ohne Mandantenspalte waere er in der Warteschlange
-- nur EINMAL einreihbar, und drei Marken gingen still leer aus.
--
-- marke_key statt eines Textfelds: der Fremdschluessel auf core.marke
-- macht Tippfehler zu einem Constraint-Fehler statt zu einem stillen
-- Posten, den nie ein Worker greift.
--
-- NULL heisst LINA. Bewusst kein eigener core.marke-Eintrag fuer LINA:
-- LINA ist kein Mandant unter vieren, sondern das andere Quellsystem.
-- Ein Pseudo-Eintrag "lina" in core.marke wuerde in jeder
-- FoodNotify-Auswertung als fuenfte Marke auftauchen und muesste
-- ueberall herausgefiltert werden.
-- =====================================================================

ALTER TABLE sync.warteschlange
    ADD COLUMN marke_key integer REFERENCES core.marke(marke_key);

COMMENT ON COLUMN sync.warteschlange.marke_key IS
'Der FoodNotify-Mandant, fuer den dieser Posten gilt. NULL = LINA.
Bestimmt, mit welchen Zugangsdaten der Worker den Posten abruft
(FN_<MARKE>_USER aus der Konfiguration, Schluessel aus core.marke.schluessel).';

-- ---------------------------------------------------------------------
-- Der partielle Unique-Index muss die Marke mit aufnehmen.
--
-- Ohne das gilt "ein Zeitraum je Endpunkt/Betrieb nur einmal offen"
-- MARKENUEBERGREIFEND: der Aposto-Posten wuerde den Enchilada-Posten
-- desselben Endpunkts und Zeitraums blockieren.
--
-- coalesce(marke_key, 0) aus demselben Grund wie coalesce(betrieb_enc_id, '')
-- eine Zeile darueber: in einem Unique-Index sind zwei NULLs verschieden,
-- und LINA-Posten (marke_key IS NULL) sollen sich weiterhin gegenseitig
-- ausschliessen.
--
-- ACHTUNG, DIE WARNUNG AUS 0005 GILT WEITER: dieser Index ist PARTIELL.
-- Ein erledigter Posten blockiert ihn nicht. Wer mit ON CONFLICT DO
-- NOTHING einreiht, reiht alles Erledigte erneut ein -- zum Einreihen
-- immer WHERE NOT EXISTS gegen ALLE Posten pruefen.
-- ---------------------------------------------------------------------

DROP INDEX sync.warteschlange_offen_uq;

CREATE UNIQUE INDEX warteschlange_offen_uq
    ON sync.warteschlange (endpunkt, coalesce(betrieb_enc_id, ''),
                           coalesce(marke_key, 0), zeitraum_von, zeitraum_bis)
 WHERE erledigt_am IS NULL;

-- Die uebrigen Indizes und Funktionen bleiben unveraendert:
--
--   * warteschlange_naechster kennt keine Marke -- richtig so, denn es
--     gibt EINEN Worker und EINE Drosselung ueber alle Quellsysteme
--     (Plan §6: "Vier Marken heissen nicht viermal so schnell").
--   * sync.posten_holen() gibt die ganze Zeile zurueck, marke_key laeuft
--     als neue Spalte automatisch mit.
--   * sync.historie_einreihen() reiht LINA-Posten ein (marke_key NULL);
--     das WHERE NOT EXISTS dort prueft ohne Marke und bleibt damit fuer
--     LINA korrekt. FoodNotify-Posten reiht ein eigener Einreiher ein
--     (Stufe 1.4), der die Marke explizit prueft.
