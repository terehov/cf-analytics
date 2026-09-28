-- =====================================================================
-- 0123 Die FoodNotify-Vorbereitung sucht per Index statt durch 9 GB
--
-- ANLASS (28.09.2026). Jeder Lauf beginnt mit nachfuellen(), und darin
-- sucht bestellungenNachfuellen() je Kostenstelle die jüngste
-- fn:bestellungen-Antwort, um die letzte Bestellseite zu kennen
-- (src/sync/nachfuellen.ts, "Die jeweils letzte Bestellseite je
-- Kostenstelle"). Nachgemessen in Produktion, EXPLAIN ANALYZE:
--
--   Marke 1, 27 Kostenstellen: 84,7 s — 3,1 s je Kostenstelle,
--   4,3 Mio. Puffer gelesen. Für alle 152 Kostenstellen ~8 Minuten.
--
-- Deshalb begannen die Läufe um 05:14 statt 05:02. Der Grund: kein Index
-- trifft `parameter->>'erpId'`. Postgres las je Kostenstelle alle
-- Monatspartitionen von raw.api_antwort und entpackte dabei die Antworten,
-- um `page_count` zu prüfen — für 18.218 Zeilen (2,9 GB) unter 9,4 GB.
--
-- DER INDEX IST EIN TEILINDEX über genau diese Zeilen, mit genau den
-- Bedingungen der Abfrage. Er ist klein (eine Zeile je Bestellseitenabruf)
-- und liefert je Kostenstelle die jüngste Zeile direkt — die Partitionen
-- sind nach abgerufen_am geschnitten, der Planer kann also von der
-- jüngsten an lesen und nach der ersten Zeile aufhören.
--
-- Dasselbe für fn:inventuren (inventurenNachfuellen, eine Abfrage je
-- Marke über `(parameter->>'markeKey')::int`), weil es dieselbe Bauart
-- ist und fast nichts kostet (271 Zeilen).
--
-- raw bleibt append-only (harte Regel 4): ein Index ändert keine Zeile.
--
-- DAUER DER MIGRATION. CREATE INDEX auf einer partitionierten Tabelle geht
-- nicht CONCURRENTLY; jede Partition wird einmal gelesen und ist währenddessen
-- für Schreiber gesperrt. Ein laufender Import wartet an dieser Stelle,
-- er bricht nicht ab.
-- =====================================================================

CREATE INDEX IF NOT EXISTS api_antwort_fn_bestellseite_idx
    ON raw.api_antwort ((parameter->>'erpId'), abgerufen_am DESC)
 WHERE endpunkt = 'fn:bestellungen'
   AND payload->'payload'->>'page_count' IS NOT NULL;

CREATE INDEX IF NOT EXISTS api_antwort_fn_inventurseite_idx
    ON raw.api_antwort (((parameter->>'markeKey')::int), abgerufen_am DESC)
 WHERE endpunkt = 'fn:inventuren'
   AND payload->'payload'->'pagination'->>'totalPages' IS NOT NULL;
