-- =====================================================================
-- 0082 posten_holen kennt jetzt den Anbieter — die Vorbedingung dafuer,
--      dass LINA und FoodNotify nebeneinander laufen duerfen
--
-- ANLASS (Lauf 95 vom 18.08.2026, nachgemessen am Laufprotokoll).
-- Der Lauf begann um 03:03 und war erst gegen 15:20 fertig: 12 h 17 min.
-- Aufgeteilt nach Anbieter, gerechnet aus den Fortschrittszeilen:
--
--   LINA         4.160 Posten     ~10 h 10 min   (Taktpause 4–6 s je Abruf)
--     davon la:belegzahl  1.974 Posten   6 h 51 min   (~12,5 s je Posten)
--     davon Historie      2.000 Posten   2 h 57 min   (~5,3 s je Posten)
--     davon Tagesdaten      186 Posten     22 min
--   FoodNotify   6.097 Posten     ~2 h 12 min   (Takt 200–500 ms)
--
-- Beide teilten sich EINE serielle Schleife, also addierte sich das:
-- 10 h 10 + 2 h 12 = 12 h 22, und gemessen wurden 12 h 17. Die
-- FoodNotify-Posten warteten dabei in LINAs Taktpausen, obwohl
-- FoodNotify seit dem 02.08.2026 eigenen Takt und eigenes Budget hat
-- (docs/fehlerkatalog.md, "Eine Grenze, die fuer zwei Anbieter
-- gleichzeitig gilt"). Zwei Anbieter, zwei Bremsen — aber eine Schlange,
-- die sie hintereinander stellte.
--
-- WAS DER KOMMENTAR IM CODE BEHAUPTETE UND WAS STIMMTE. In
-- src/sync/worker.ts stand ueber dem FoodNotify-Client: "Eigener Takt
-- (anderes Zielsystem), aber dasselbe Tagesbudget aus derselben Zaehlung
-- — der eine Worker bleibt die eine Bremse." Der Satz kam am 04.08.2026
-- herein und beschrieb den Stand VOR dem 02.08.: die Budgets sind seither
-- getrennt (src/foodnotify/client.ts zaehlt endpunkt LIKE 'fn:%' gegen
-- FN_TAGESBUDGET). Uebrig blieb von "der eine Worker" nur der Prozess,
-- nicht die Bremse. Ein Kommentar, der das Gegenteil dessen sagt, was der
-- Code tut — zum dritten Mal in diesem Projekt, siehe AGENTS.md.
--
-- WAS "EIN WORKER" WIRKLICH SCHUETZT, und warum es hier nicht verletzt
-- wird. docs/entscheidungen.md, "Ein Worker, abgesichert per
-- Advisory-Sperre": "Zehn Worker waeren zehnfaches Tempo gegen einen
-- Zugang ohne Limits." Das Argument gilt PROZESSUEBERGREIFEND — mehrere
-- `bun run sync` nebeneinander, jeder mit eigenem Client und eigenem
-- Budgetzaehler im Speicher. Die Advisory-Sperre bleibt unangetastet:
-- ein Prozess, eine Sperre, zwei Schleifen darin. Die Drosselung haengt
-- an der Client-INSTANZ (letzterRequest ist ein Instanzfeld), und je
-- Anbieter existiert weiterhin genau eine Instanz mit genau einem
-- Aufrufer. LINA sieht denselben Mindestabstand wie vorher, FoodNotify
-- auch. Was sich aendert, ist allein, wer waehrend LINAs Taktpause
-- arbeiten darf.
--
-- ---------------------------------------------------------------------
-- DIESER FILTER IST DIE DROSSEL, NICHT EINE OPTIMIERUNG
-- ---------------------------------------------------------------------
--
-- Ohne Anbieterfilter zoegen beide Schleifen aus derselben Schlange. Die
-- Weiche im Worker (marke_key != null -> fnClient) waehlte dann brav den
-- richtigen Client — und zwei Aufrufer haengen an einer Instanz. Beide
-- lesen dasselbe letzterRequest, errechnen dieselbe Restwartezeit,
-- schlafen gleichzeitig und feuern gleichzeitig, weil erst NACH der
-- Antwort gestempelt wird (src/lina/client.ts). Ergebnis: doppelte
-- LINA-Rate in Zweierbursts, ohne eine einzige Fehlermeldung. Es gibt
-- genau einen LINA-Zugang, und eine Sperre waere nicht rueckgaengig zu
-- machen (AGENTS.md Regel 3).
--
-- Deshalb kennt diese Funktion nur drei Antworten und keine vierte: ein
-- unbekannter Anbietername wirft, statt still die ganze Schlange zu
-- liefern. Ein Tippfehler soll scheitern und nicht beschleunigen.
--
-- DREI ZWEIGE STATT EINER ODER-BEDINGUNG. `(p_anbieter IS NULL OR
-- (p_anbieter = 'lina' AND marke_key IS NULL) OR ...)` waere kuerzer und
-- waere langsam: der Planer kann aus einem PARAMETER nicht ableiten, dass
-- marke_key IS NULL gilt, und faellt damit auf den ungefilterten Index
-- zurueck. Bei 1.974 offenen Ladenakte-Posten gegen 6.097 FoodNotify-
-- Posten scannt der LINA-Zweig sonst quer durch den fremden Block. Mit
-- festen Praedikaten je Zweig greifen die beiden Teilindizes unten.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Zugriffspfade je Anbieter
--
-- Die Spaltenfolge MUSS der Sortierung in posten_holen entsprechen —
-- dieselbe Begruendung wie bei warteschlange_naechster aus 0021, nur
-- jetzt zweimal, einmal je Seite der Weiche. Der ungefilterte Index aus
-- 0021 bleibt: er traegt den Aufruf ohne Anbieter, den die Tests und
-- src/einreihen.ts benutzen.
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS warteschlange_naechster_lina
    ON sync.warteschlange (prioritaet, zeitraum_von DESC, endpunkt)
 WHERE erledigt_am IS NULL AND in_arbeit_seit IS NULL AND marke_key IS NULL;

COMMENT ON INDEX sync.warteschlange_naechster_lina IS
'Zugriffspfad von sync.posten_holen(lauf, ''lina''). marke_key IS NULL heisst
LINA (Migration 0031) und schliesst die la:*-Endpunkte der Ladenakte ein — die
laufen ueber denselben Zugang, denselben Takt und dasselbe Tagesbudget.';

CREATE INDEX IF NOT EXISTS warteschlange_naechster_fn
    ON sync.warteschlange (prioritaet, zeitraum_von DESC, endpunkt)
 WHERE erledigt_am IS NULL AND in_arbeit_seit IS NULL AND marke_key IS NOT NULL;

COMMENT ON INDEX sync.warteschlange_naechster_fn IS
'Zugriffspfad von sync.posten_holen(lauf, ''fn''). Alle vier FoodNotify-Marken
teilen sich diesen Index — sie teilen sich auch den Client und damit den Takt.';


-- ---------------------------------------------------------------------
-- 2. posten_holen mit Anbieter
--
-- DIE EINSTELLIGE FASSUNG MUSS WEG, bevor die zweistellige kommt. Ein
-- DEFAULT auf dem zweiten Parameter macht `posten_holen($1)` sonst
-- mehrdeutig ("function is not unique"), und der bestehende Aufruf ohne
-- Anbieter braeche — genau der, den die Tests benutzen.
--
-- p_lauf_id wird weiterhin nicht gelesen. Der Parameter stand schon in
-- 0005 so da; er bleibt, weil jeder Aufrufer ihn uebergibt und das
-- Entfernen eine zweite Signaturaenderung ohne Nutzen waere.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS sync.posten_holen(bigint);

CREATE OR REPLACE FUNCTION sync.posten_holen(
    p_lauf_id  bigint,
    p_anbieter text DEFAULT NULL)
RETURNS sync.warteschlange
LANGUAGE plpgsql AS $$
DECLARE p sync.warteschlange;
BEGIN
    IF p_anbieter IS NULL THEN
        -- Ohne Anbieter: die ganze Schlange, wie bis 0081. Fuer Aufrufer,
        -- die gar nicht nebenlaeufig arbeiten.
        SELECT * INTO p
          FROM sync.warteschlange
         WHERE erledigt_am IS NULL
           AND in_arbeit_seit IS NULL
           AND faellig_ab <= now()
         ORDER BY prioritaet, zeitraum_von DESC, endpunkt, posten_id
         FOR UPDATE SKIP LOCKED
         LIMIT 1;

    ELSIF p_anbieter = 'lina' THEN
        SELECT * INTO p
          FROM sync.warteschlange
         WHERE erledigt_am IS NULL
           AND in_arbeit_seit IS NULL
           AND faellig_ab <= now()
           AND marke_key IS NULL
         ORDER BY prioritaet, zeitraum_von DESC, endpunkt, posten_id
         FOR UPDATE SKIP LOCKED
         LIMIT 1;

    ELSIF p_anbieter = 'fn' THEN
        SELECT * INTO p
          FROM sync.warteschlange
         WHERE erledigt_am IS NULL
           AND in_arbeit_seit IS NULL
           AND faellig_ab <= now()
           AND marke_key IS NOT NULL
         ORDER BY prioritaet, zeitraum_von DESC, endpunkt, posten_id
         FOR UPDATE SKIP LOCKED
         LIMIT 1;

    ELSE
        -- Kein stiller Rueckfall auf "alles". Wer sich hier vertippt,
        -- bekaeme sonst zwei Aufrufer auf einer Client-Instanz und damit
        -- doppeltes Tempo gegen den einen LINA-Zugang.
        RAISE EXCEPTION
            'sync.posten_holen: unbekannter Anbieter %. Erlaubt: lina, fn, NULL.',
            p_anbieter;
    END IF;

    IF NOT FOUND THEN RETURN NULL; END IF;

    UPDATE sync.warteschlange
       SET in_arbeit_seit = now(), versuche = versuche + 1
     WHERE posten_id = p.posten_id
    RETURNING * INTO p;

    RETURN p;
END $$;

COMMENT ON FUNCTION sync.posten_holen(bigint, text) IS
'Reserviert den naechsten faelligen Posten. Sortierung: Prioritaet, dann Datum
absteigend — die Historie laeuft datumsweise rueckwaerts, alle Endpunkte
gemeinsam (Migration 0021).

p_anbieter grenzt auf eine Quelle ein: ''lina'' (marke_key IS NULL, inklusive
der la:*-Ladenakte), ''fn'' (marke_key IS NOT NULL), NULL = alles. Seit 0082,
damit je Anbieter eine eigene Schleife laufen kann, ohne dass zwei Aufrufer an
derselben Client-Instanz haengen — deren Taktpause ist die einzige Drosselung,
die es gibt. Ein unbekannter Wert wirft absichtlich, statt die ganze Schlange
zu liefern.

FOR UPDATE SKIP LOCKED trug schon vorher nebenlaeufige Aufrufer; neu ist nur,
dass sich die beiden Schleifen nicht mehr gegenseitig Posten wegnehmen.';
