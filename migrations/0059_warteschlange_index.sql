/**
 * 0059 — Der Index, ohne den das Nachfüllen quadratisch wird
 *
 * ANLASS (12.08.2026). Lauf 85 brauchte SIEBEN MINUTEN, bevor er die erste
 * Anfrage stellte; Lauf 84 zwei Stunden zuvor noch 2:47 — bei identischem
 * Ergebnis (lina 82, foodnotify 155). Im Nachfüllen gibt es kein Netzwerk,
 * das war reine Datenbankzeit.
 *
 * WAS GEMESSEN WURDE. `einreihenJeMonat` (src/sync/nachfuellen.ts) fragt vor
 * jedem Einreihen, ob es den Posten schon gibt. Diese eine Frage kostete auf
 * der Serverbank:
 *
 *   Parallel Seq Scan on warteschlange   27 ms
 *   Rows Removed by Filter: 56073 x 3 Worker  ->  168.218 Zeilen
 *   Buffers: shared hit=3415
 *
 * Bei 420 Sekunden Nachfüllzeit sind das rund 15.500 Prüfungen, um 237 Posten
 * einzureihen — 168.000 gelesene Zeilen je Prüfung.
 *
 * ZWEI URSACHEN, UND BEIDE MUESSEN WEG.
 *
 * 1. `date_trunc('month', w.zeitraum_von) = …` rechnet auf der SPALTE und ist
 *    damit nicht indexfähig. Das ist in nachfuellen.ts zu einem Bereich
 *    umgeschrieben — fachlich dasselbe, aber sargable.
 *
 * 2. Es gab keinen passenden Index. Die vorhandenen sind PARTIELL:
 *    warteschlange_offen_uq auf `erledigt_am IS NULL` (17 Zeilen),
 *    warteschlange_historie auf `IS NOT NULL`. Die Prüfung nennt weder das
 *    eine noch das andere, also darf der Planer keinen von beiden verwenden —
 *    nachgemessen blieb es auch mit dem Bereichsprädikat beim Seq Scan.
 *    Deshalb hier ein NICHT-partieller Index.
 *
 * WARUM DAS SCHLIMMER WIRD UND NICHT BESSER: die Tabelle wächst nur. 168.218
 * Zeilen, davon 17 offen — alles andere ist erledigte Historie, die jede
 * künftige Prüfung mitschleppt. fn:bestellung und fn:bestellpositionen stehen
 * bei je 66.907 und wachsen mit jeder geladenen Bestellung. Zahl der Prüfungen
 * mal Tabellengröße: der Aufwand steigt quadratisch.
 *
 * WIRKUNG. Grösste Kombination aus Endpunkt und Monat sind 2.223 Zeilen
 * (fn:bestellpositionen, März 2026). Statt 168.218 Zeilen liest die Prüfung
 * also höchstens 2.223 und filtert darin nach parameter.
 *
 * BEIM EINSPIELEN: `CREATE INDEX` ohne CONCURRENTLY sperrt Schreibzugriffe auf
 * sync.warteschlange, solange er baut. Bei 39 MB sind das Sekunden, aber der
 * Sync-Worker schreibt genau in diese Tabelle — NICHT waehrend eines
 * laufenden Laufs einspielen. CONCURRENTLY geht hier nicht: migrate.ts fährt
 * jede Migration in einer Transaktion (src/db/migrate.ts:22).
 */

-- Nicht partiell, und in dieser Spaltenreihenfolge: endpunkt ist immer eine
-- Gleichheit, zeitraum_von immer ein Bereich. Der parameter-Vergleich bleibt
-- Filter statt Indexspalte — innerhalb eines Endpunkts und Monats sind es
-- wenige tausend Zeilen, und ein jsonb im Btree waere teuer bezahlt.
CREATE INDEX IF NOT EXISTS warteschlange_endpunkt_zeitraum
    ON sync.warteschlange (endpunkt, zeitraum_von);

COMMENT ON INDEX sync.warteschlange_endpunkt_zeitraum IS
'Fuer die Wiedervorlage-Pruefung in einreihenJeMonat. BEWUSST NICHT PARTIELL:
die Pruefung fragt ueber erledigte UND offene Posten, ein Index mit
WHERE erledigt_am IS NULL waere fuer sie unbenutzbar. Ohne ihn liest jede
Pruefung die ganze Tabelle — am 12.08.2026 waren das 168.218 Zeilen und 27 ms,
siebenmal je Sekunde.';

INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0059', to_jsonb(
        'sync.warteschlange: nicht-partieller Index auf (endpunkt, zeitraum_von). '
        'Zusammen mit dem Bereichspraedikat in nachfuellen.ts faellt die '
        'Wiedervorlage-Pruefung von 168.218 gelesenen Zeilen auf hoechstens 2.223. '
        'Anlass: Lauf 85 brauchte 7 Minuten Nachfuellzeit, Lauf 84 noch 2:47.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
