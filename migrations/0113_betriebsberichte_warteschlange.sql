-- =====================================================================
-- 0113 Die Warteschlange lernt Betriebsberichte
--      (docs/plan-lina-vollabzug.md, Abschnitt 5; Entscheidung E8)
--
-- Vier Dinge, die der Importer fuer die 72 Betriebsberichte braucht und
-- die im Schema stehen muessen:
--
-- 1. VERSCHRAENKT STATT ALS BLOCK (E8, 22.09.2026). Eugene: "Es kann gerne
--    auch laenger laden, solange wir das System nicht zuballern und sich
--    ueber alle API-Aufrufe des gleichen Systems verteilen." Die LINA-Spur
--    zieht deshalb abwechselnd einen Betriebsbericht und einen uebrigen
--    LINA-Posten (src/sync/worker.ts, linaPostenHolen). Dafuer braucht
--    sync.posten_holen() zwei neue Anbieterwerte:
--
--      'lina_br'     nur Betriebsberichte   (endpunkt LIKE 'getReport:%')
--      'lina_sonst'  LINA ohne Betriebsberichte
--
--    'lina' (alles von LINA) bleibt fuer Tests und Aufrufer, die nicht
--    verschraenken. Zwei feste Praedikate je Zweig statt einer
--    ODER-Bedingung — dieselbe Begruendung wie in 0082: der Planer kann aus
--    einem Parameter keinen Teilindex waehlen.
--
--    DAS TEMPO AENDERT SICH NICHT (harte Regel 3). Es bleibt EINE
--    LINA-Schleife mit EINEM Client; verschraenkt wird die Reihenfolge,
--    nicht die Rate.
--
-- 2. EIN FENSTER, DAS ZU GROSS IST, IST KEIN FEHLER, DER SICH WIEDERHOLEN
--    DARF. LINA beantwortet einen Monatsaufruf von 96, 86 und 113 nach rund
--    einer Minute mit 504 und einer 970-kB-HTML-Fehlerseite (Vermessung
--    22.09.2026). Der Worker halbiert dann das Fenster und schliesst den
--    alten Posten mit dem neuen Ergebnis 'fenster_zu_gross' — sichtbar,
--    nicht still wiederholt, und von aufgegebeneWiederbeleben() nicht
--    angefasst (die holt nur 'aufgegeben').
--
-- 3. DER PRODUCER FUER betrieb_enc_id. Die Spalte steht seit 0005 da und
--    hatte bis heute keinen Schreiber (Waechter-Befund 13.08.2026).
--    betriebsberichteNachfuellen() prueft je Einheit, ob es sie je gab —
--    der Index dafuer steht hier.
--
-- 4. core.partition_anlegen() liest die Partitionsspalte aus dem Katalog.
--    Bisher war sie fest 'geschaeftstag' (bzw. 'abgerufen_am' fuer raw);
--    core.kellner_artikel_monat ist nach 'monat' partitioniert.
--
-- 5. sync.quelle.fensterklasse — damit mart.betriebsbericht_luecke (0114)
--    weiss, welcher Zeitraum eines Berichts wann faellig ist.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Ergebnis 'fenster_zu_gross'
-- ---------------------------------------------------------------------

ALTER TABLE sync.warteschlange DROP CONSTRAINT IF EXISTS warteschlange_ergebnis_check;
ALTER TABLE sync.warteschlange
    ADD CONSTRAINT warteschlange_ergebnis_check
    CHECK (ergebnis IN ('ok','keine_daten','aufgegeben','kein_zugriff','fenster_zu_gross'));

COMMENT ON COLUMN sync.warteschlange.ergebnis IS
'keine_daten ist ein NORMALZUSTAND, kein Fehler: LINA antwortet mit HTTP 500 und
leerem Body, wenn ein Betrieb fuer diesen Bericht keine Daten hat.
kein_zugriff (0075): die Quelle verweigert dauerhaft (403), waehrend derselbe
Endpunkt sonst antwortet.
fenster_zu_gross (0113): ein Betriebsbericht ueber mehrere Tage lief in 504 oder in
unser Zeitlimit; der Worker hat ihn in zwei halbe Posten geteilt. Der alte Posten ist
damit beantwortet und wird nicht wiederbelebt.';


-- ---------------------------------------------------------------------
-- 2. Zugriffspfade und posten_holen mit den beiden LINA-Haelften
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS warteschlange_naechster_lina_br
    ON sync.warteschlange (prioritaet, zeitraum_von DESC, endpunkt)
 WHERE erledigt_am IS NULL AND in_arbeit_seit IS NULL AND marke_key IS NULL
   AND endpunkt LIKE 'getReport:%';

CREATE INDEX IF NOT EXISTS warteschlange_naechster_lina_sonst
    ON sync.warteschlange (prioritaet, zeitraum_von DESC, endpunkt)
 WHERE erledigt_am IS NULL AND in_arbeit_seit IS NULL AND marke_key IS NULL
   AND endpunkt NOT LIKE 'getReport:%';

-- Der Producer fragt je Einheit: gab es diesen Posten je? Gleich welcher
-- Ausgang — ein Takt, der am Ergebnis haengt, kennt immer einen vergessenen
-- (fehlerkatalog.md, 12.08.2026).
CREATE INDEX IF NOT EXISTS warteschlange_betrieb_einheit
    ON sync.warteschlange (endpunkt, betrieb_enc_id, zeitraum_von, zeitraum_bis)
 WHERE betrieb_enc_id IS NOT NULL;

CREATE OR REPLACE FUNCTION sync.posten_holen(
    p_lauf_id  bigint,
    p_anbieter text DEFAULT NULL)
RETURNS sync.warteschlange
LANGUAGE plpgsql AS $$
DECLARE p sync.warteschlange;
BEGIN
    IF p_anbieter IS NULL THEN
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

    ELSIF p_anbieter = 'lina_br' THEN
        SELECT * INTO p
          FROM sync.warteschlange
         WHERE erledigt_am IS NULL
           AND in_arbeit_seit IS NULL
           AND faellig_ab <= now()
           AND marke_key IS NULL
           AND endpunkt LIKE 'getReport:%'
         ORDER BY prioritaet, zeitraum_von DESC, endpunkt, posten_id
         FOR UPDATE SKIP LOCKED
         LIMIT 1;

    ELSIF p_anbieter = 'lina_sonst' THEN
        SELECT * INTO p
          FROM sync.warteschlange
         WHERE erledigt_am IS NULL
           AND in_arbeit_seit IS NULL
           AND faellig_ab <= now()
           AND marke_key IS NULL
           AND endpunkt NOT LIKE 'getReport:%'
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
        RAISE EXCEPTION
            'sync.posten_holen: unbekannter Anbieter %. Erlaubt: lina, lina_br, lina_sonst, fn, NULL.',
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
absteigend — die Historie laeuft datumsweise rueckwaerts, alle Endpunkte und alle
Betriebe gemeinsam (0021; fuer Betriebsberichte: erst der juengste Zeitraum fuer
ALLE Betriebe, dann rueckwaerts).

p_anbieter: ''lina'' (marke_key IS NULL, inkl. la:*), ''fn'' (marke_key IS NOT NULL),
NULL = alles. Seit 0113 zusaetzlich ''lina_br'' (nur Betriebsberichte, getReport:%) und
''lina_sonst'' (LINA ohne Betriebsberichte) — damit die LINA-Spur beide verschraenken
kann (Entscheidung E8). Das sind Haelften DERSELBEN Spur mit demselben Client, keine
dritte Schleife. Ein unbekannter Wert wirft absichtlich.';


-- ---------------------------------------------------------------------
-- 3. Partitionsspalte aus dem Katalog
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.partition_anlegen(p_tabelle regclass, p_monat date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_von     date := date_trunc('month', p_monat)::date;
    v_bis     date := (date_trunc('month', p_monat) + interval '1 month')::date;
    v_basis   text := split_part(p_tabelle::text, '.', 2);
    v_name    text := format('%s_%s', v_basis, to_char(v_von,'YYYY_MM'));
    v_datumsspalte text;
BEGIN
    -- Seit 0113 aus dem Katalog: die erste Spalte des Partitionsschluessels.
    -- Bis dahin fest geschaeftstag (bzw. abgerufen_am fuer raw) — ergibt fuer
    -- alle bestehenden Tabellen dasselbe, und core.kellner_artikel_monat ist
    -- nach monat partitioniert.
    SELECT a.attname INTO v_datumsspalte
      FROM pg_partitioned_table pt
      JOIN pg_attribute a ON a.attrelid = pt.partrelid AND a.attnum = pt.partattrs[0]
     WHERE pt.partrelid = p_tabelle;
    v_datumsspalte := coalesce(v_datumsspalte,
        CASE WHEN v_basis = 'api_antwort' THEN 'abgerufen_am' ELSE 'geschaeftstag' END);

    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE c.relname = v_name AND n.nspname = 'part') THEN
        BEGIN
            EXECUTE format('CREATE TABLE IF NOT EXISTS part.%I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
                           v_name, p_tabelle::text, v_von, v_bis);
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON part.%I USING brin (%I) WITH (autosummarize = on)',
                           format('%s_%s_idx', v_name, v_datumsspalte), v_name, v_datumsspalte);
        EXCEPTION
            -- Die andere Schleife war schneller — der Erfolgsfall, von der
            -- anderen Seite gesehen (0083).
            WHEN duplicate_table OR duplicate_object OR unique_violation THEN NULL;
        END;
    END IF;
END $$;

COMMENT ON FUNCTION core.partition_anlegen IS
'Legt bei Bedarf die Monatspartition an - im Schema `part`, nicht neben der Elterntabelle -,
inklusive BRIN-Index mit autosummarize auf der Partitionsspalte (seit 0113 aus dem Katalog
gelesen, vorher fest geschaeftstag). Der Importer ruft das vor dem Schreiben auf, so gibt
es keinen Wartungsjob, den man vergessen kann. Nebenlaeufig sicher (0083).
Hinweis: Storage-Parameter lassen sich NICHT auf dem partitionierten Index setzen
("This operation is not supported for partitioned indexes"), nur je Kindindex.';


-- ---------------------------------------------------------------------
-- 4. sync.quelle.fensterklasse
-- ---------------------------------------------------------------------

ALTER TABLE sync.quelle ADD COLUMN IF NOT EXISTS fensterklasse text
    CHECK (fensterklasse IN ('T', 'W', 'M-Tag', 'M'));

COMMENT ON COLUMN sync.quelle.fensterklasse IS
'Nur bei Betriebsberichten (0113): T = Tagesaufruf, W = sieben Tage, M-Tag = Monatsaufruf
mit Tageszeilen, M = Monatsaufruf. Bestimmt, welcher Zeitraum eines Betrieb-Tags mit Umsatz
wann faellig ist (mart.betriebsbericht_luecke). Gespiegelt aus src/lina/betriebsberichte.ts.';
