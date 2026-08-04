-- =====================================================================
-- 0033 Der Offen-Index unterscheidet Posten auch nach Parametern
--
-- Teil von Stufe 1.5 (docs/plan-foodnotify.md).
--
-- Der FoodNotify-Backfill ist SEITENWEISE: fn:bestellungen fuer erpId
-- 10483 existiert als Seite 1, Seite 2, ... Seite N — gleicher Endpunkt,
-- gleiche Marke, gleicher (nomineller) Zeitraum, verschieden nur im
-- parameter-Feld. Der bisherige Index
--
--     (endpunkt, betrieb, marke, zeitraum_von, zeitraum_bis)
--
-- haette den zweiten offenen Seiten-Posten abgewiesen, solange der erste
-- noch aussteht — der Backfill waere nach der ersten Seite stehen
-- geblieben, und zwar mit einem Unique-Fehler beim EINREIHEN, nicht beim
-- Abarbeiten.
--
-- jsonb::text ist als Vergleichsschluessel verlaesslich: jsonb
-- normalisiert beim Speichern (Schluesselreihenfolge, Duplikate,
-- Leerraum), gleiche Parameter ergeben also denselben Text.
--
-- Fuer LINA-Posten aendert sich nichts: ihr parameter ist durchgehend
-- '{}', der Index verhaelt sich dort exakt wie vorher.
--
-- ACHTUNG, DIE WARNUNG AUS 0005 GILT UNVERAENDERT: der Index ist
-- PARTIELL (nur offene Posten). Wer einreiht, prueft mit WHERE NOT
-- EXISTS gegen ALLE Posten — jetzt einschliesslich parameter.
-- =====================================================================

DROP INDEX sync.warteschlange_offen_uq;

CREATE UNIQUE INDEX warteschlange_offen_uq
    ON sync.warteschlange (endpunkt, coalesce(betrieb_enc_id, ''),
                           coalesce(marke_key, 0), zeitraum_von, zeitraum_bis,
                           coalesce(parameter::text, '{}'))
 WHERE erledigt_am IS NULL;
