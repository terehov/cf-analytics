-- =====================================================================
-- 0116 Erst das Tagesgeschaeft, dann die Auswertungen, dann das Nachladen
--      (Entscheidung Eugene, 23.09.2026; docs/entscheidungen.md)
--
-- ANLASS. Seit 0113 laden die Betriebsberichte mit dem Tagesbudget, das
-- nach dem Tagesgeschaeft uebrig bleibt, und zwar VERSCHRAENKT mit den
-- uebrigen LINA-Posten. Richtig fuer LINA (E8: nicht zuballern), teuer fuer
-- die Dashboards: bei ~5,3 s je Aufruf dauert eine Nacht mit 10.500
-- Aufrufen rund 15,5 Stunden, und Phase B (alle Materialisierungen, der
-- Round Table, die Zulaufpruefung) lief erst danach — gegen 20:30. Die
-- Dashboards haetten den ganzen Tag den Vortag gezeigt.
--
-- Eugenes Wahl, woertlich: "Erst Tagesgeschaeft, dann nachladen — Der Lauf
-- holt zuerst die Tagesdaten und frischt die Auswertungen morgens auf.
-- Danach laedt er die Historie bis zum Tagesbudget nach."
--
-- Der Lauf hat damit drei Abschnitte (src/sync.ts):
--   Phase A  Tagesgeschaeft: alle Dienste parallel, die LINA-Spur zieht
--            nur Posten mit nachladen = false
--   Phase B  Ableitungen, unveraendert
--   Phase C  Nachladen: die LINA-Spur zieht, was noch faellig ist — die
--            Historie, weiter verschraenkt und im selben Takt
--
-- WAS "NACHLADEN" IST, STEHT AM POSTEN, NICHT AN DER UHR. Eine Uhrzeit
-- ("nach 08:00 nur noch Historie") waere nach jeder Stoerung falsch: ein
-- Lauf, der um 11:00 startet, haette kein Tagesgeschaeft. Die Prioritaet
-- taugt auch nicht: 90 heisst Historie, 95 heisst Ladenakte (taeglich), und
-- die Betriebsberichte stehen laufend UND historisch auf 85 — ihre
-- Reihenfolge ist das Datum (0113). Also eine eigene Spalte, gesetzt vom
-- Einreihweg, der es weiss.
--
-- Vier Teile:
--   1. sync.warteschlange.nachladen, vorhandene offene Posten eingeordnet
--   2. sync.posten_holen mit 'lina_br_laufend' und 'lina_sonst_laufend'
--   3. sync.lauf: wann das Tagesgeschaeft und die Ableitungen fertig waren,
--      was nachgeladen wurde und was aussteht; mart.sync_status zeigt es
--   4. Die Frischepruefungen messen gegen das Ende des Tagesgeschaefts,
--      nicht gegen das Laufende — sonst waere jede Materialisierung nach
--      Phase C "veraltet". Mitbehoben: der Wetter-Refresh (0111) laeuft in
--      Phase A und stand deshalb seit dem 21.09.2026 JEDEN Tag auf veraltet.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die Eigenschaft des Postens
-- ---------------------------------------------------------------------

ALTER TABLE sync.warteschlange
    ADD COLUMN IF NOT EXISTS nachladen boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN sync.warteschlange.nachladen IS
'true = Nachladen (Historie), false = Tagesgeschaeft (0116, Entscheidung 23.09.2026). Das
Tagesgeschaeft laeuft in Phase A VOR den Ableitungen, das Nachladen in Phase C DANACH — die
Dashboards warten damit nicht mehr auf den Backfill. Gesetzt vom Einreihweg:
  true   historieNachziehen() (Konzern-Historie, HISTORIE_JE_LAUF), sync.historie_einreihen()
         (einreihen --historie), Betriebsberichte ausser den laufenden Tages- und Wochenberichten
  false  alles andere — Nachzuegler-Fenster, Jahres- und Momentaufnahmen, Nacharbeit (Nulltage,
         Lochtage, Nachlese, Gegenprobe), Ladenakte, FoodNotify, und Betriebsberichte der Klassen
         T und W, deren Zeitraum in den letzten BETRIEBSBERICHT_LAUFEND_TAGE (21) endet.
Vorgabe false: ein Einreihweg, der es vergisst, macht Phase A laenger (sichtbar in
mart.sync_status.ableitungen_bis), er verliert keine Daten. Das Fensterteilen im Worker erbt
den Wert.';

-- Vorhandene offene Posten einordnen. Erledigte bleiben false: fuer sie
-- ist die Frage beantwortet, und ein UPDATE ueber die ganze Historie der
-- Schlange kostete nur Zeit.
UPDATE sync.warteschlange w
   SET nachladen = true
 WHERE w.erledigt_am IS NULL
   AND w.marke_key IS NULL
   AND (
        -- Konzern-Historie (historieNachziehen, einreihen --historie)
        (w.prioritaet = 90 AND w.endpunkt NOT LIKE 'la:%' AND w.endpunkt NOT LIKE 'getReport:%')
        -- Betriebsberichte: Erstabruf und Nachlauf (85), ausser laufenden T/W
     OR (w.endpunkt LIKE 'getReport:%' AND w.prioritaet = 85
         AND NOT (w.zeitraum_bis >= current_date - 21
                  AND EXISTS (SELECT 1 FROM sync.quelle q
                               WHERE q.quelle = w.endpunkt AND q.fensterklasse IN ('T','W'))))
   );


-- ---------------------------------------------------------------------
-- 2. posten_holen: die Haelften des Tagesgeschaefts
--
-- 'lina_br' und 'lina_sonst' bleiben unveraendert (ALLES Faellige) — Phase C
-- zieht damit auch ein Tagesgeschaeft, das in Phase A in eine Wiedervorlage
-- ging und inzwischen faellig ist. Die beiden neuen Werte sind dieselben
-- Haelften ohne das Nachladen. Zwei feste Praedikate je Zweig statt eines
-- Parameters, dieselbe Begruendung wie in 0082 und 0113: der Planer kann
-- aus einem Parameter keinen Teilindex waehlen.
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS warteschlange_naechster_lina_br_laufend
    ON sync.warteschlange (prioritaet, zeitraum_von DESC, endpunkt)
 WHERE erledigt_am IS NULL AND in_arbeit_seit IS NULL AND marke_key IS NULL
   AND endpunkt LIKE 'getReport:%' AND NOT nachladen;

CREATE INDEX IF NOT EXISTS warteschlange_naechster_lina_sonst_laufend
    ON sync.warteschlange (prioritaet, zeitraum_von DESC, endpunkt)
 WHERE erledigt_am IS NULL AND in_arbeit_seit IS NULL AND marke_key IS NULL
   AND endpunkt NOT LIKE 'getReport:%' AND NOT nachladen;

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

    ELSIF p_anbieter = 'lina_br_laufend' THEN
        SELECT * INTO p
          FROM sync.warteschlange
         WHERE erledigt_am IS NULL
           AND in_arbeit_seit IS NULL
           AND faellig_ab <= now()
           AND marke_key IS NULL
           AND endpunkt LIKE 'getReport:%'
           AND NOT nachladen
         ORDER BY prioritaet, zeitraum_von DESC, endpunkt, posten_id
         FOR UPDATE SKIP LOCKED
         LIMIT 1;

    ELSIF p_anbieter = 'lina_sonst_laufend' THEN
        SELECT * INTO p
          FROM sync.warteschlange
         WHERE erledigt_am IS NULL
           AND in_arbeit_seit IS NULL
           AND faellig_ab <= now()
           AND marke_key IS NULL
           AND endpunkt NOT LIKE 'getReport:%'
           AND NOT nachladen
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
            'sync.posten_holen: unbekannter Anbieter %. Erlaubt: lina, lina_br, lina_sonst, lina_br_laufend, lina_sonst_laufend, fn, NULL.',
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
NULL = alles. Seit 0113 ''lina_br'' (nur Betriebsberichte, getReport:%) und ''lina_sonst''
(LINA ohne Betriebsberichte) — Haelften DERSELBEN Spur (Entscheidung E8). Seit 0116
''lina_br_laufend'' und ''lina_sonst_laufend'': dieselben Haelften ohne nachladen — die
zieht die LINA-Spur in Phase A (Tagesgeschaeft), die beiden anderen in Phase C.
Ein unbekannter Wert wirft absichtlich.';


-- sync.historie_einreihen ist der Handweg fuer einen bestimmten Zeitraum
-- (einreihen --historie). Was er einreiht, ist per Definition Nachladen.
-- Rumpf wie in 0005, nur die Spalte nachladen kommt dazu.
CREATE OR REPLACE FUNCTION sync.historie_einreihen(
    p_endpunkt   text,
    p_von        date,
    p_bis        date,
    p_schrittweite text DEFAULT 'tag',      -- 'tag' | 'monat' | 'jahr'
    p_parameter  jsonb DEFAULT '{}'::jsonb,
    p_prioritaet smallint DEFAULT 90
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_schritt interval := CASE p_schrittweite
                            WHEN 'tag'   THEN interval '1 day'
                            WHEN 'monat' THEN interval '1 month'
                            WHEN 'jahr'  THEN interval '1 year'
                          END;
    v_von date;
    v_bis date;
    v_cursor date := p_bis;
    v_anzahl integer := 0;
BEGIN
    IF v_schritt IS NULL THEN
        RAISE EXCEPTION 'Unbekannte Schrittweite: %', p_schrittweite;
    END IF;

    WHILE v_cursor >= p_von LOOP
        v_von := CASE p_schrittweite
                    WHEN 'tag'   THEN v_cursor
                    WHEN 'monat' THEN date_trunc('month', v_cursor)::date
                    WHEN 'jahr'  THEN date_trunc('year',  v_cursor)::date
                 END;
        v_bis := CASE p_schrittweite
                    WHEN 'tag'   THEN v_cursor
                    WHEN 'monat' THEN (date_trunc('month', v_cursor) + interval '1 month - 1 day')::date
                    WHEN 'jahr'  THEN (date_trunc('year',  v_cursor) + interval '1 year - 1 day')::date
                 END;

        -- Gegen ALLE Posten pruefen, nicht nur gegen offene: ein bereits
        -- geholter Zeitraum wird nicht noch einmal geholt.
        INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, parameter, prioritaet, nachladen)
        SELECT p_endpunkt, v_von, v_bis, p_parameter, p_prioritaet, true
         WHERE NOT EXISTS (
               SELECT 1 FROM sync.warteschlange w
                WHERE w.endpunkt = p_endpunkt
                  AND w.betrieb_enc_id IS NOT DISTINCT FROM NULL
                  AND w.zeitraum_von = v_von
                  AND w.zeitraum_bis = v_bis);

        IF FOUND THEN v_anzahl := v_anzahl + 1; END IF;
        v_cursor := (v_von - interval '1 day')::date;
    END LOOP;

    RETURN v_anzahl;
END $$;


-- ---------------------------------------------------------------------
-- 3. Der Lauf sagt, wann die Dashboards frisch waren und was nachgeladen
--    wurde (harte Regel 10)
-- ---------------------------------------------------------------------

ALTER TABLE sync.lauf
    ADD COLUMN IF NOT EXISTS tagesgeschaeft_bis timestamptz,
    ADD COLUMN IF NOT EXISTS ableitungen_bis    timestamptz,
    ADD COLUMN IF NOT EXISTS nachladen_posten   integer,
    ADD COLUMN IF NOT EXISTS nachladen_offen    integer;

COMMENT ON COLUMN sync.lauf.tagesgeschaeft_bis IS
'Ende von Phase A (0116): beide Spuren haben das Tagesgeschaeft abgearbeitet. Bezugspunkt der
Frischepruefungen (mart.materialisierung_stand, mart.vergleichstag_stand). NULL bei Laeufen vor
0116 und bei Starts, die nicht gearbeitet haben.';
COMMENT ON COLUMN sync.lauf.ableitungen_bis IS
'Ende von Phase B (0116): alle Materialisierungen und der Round Table sind aufgefrischt, die
Zulaufpruefung ist gelaufen. AB HIER ZEIGEN DIE DASHBOARDS DEN VORTAG. Steht der Lauf auf
laeuft und ableitungen_bis ist gesetzt, arbeitet er am Nachladen (Phase C).';
COMMENT ON COLUMN sync.lauf.nachladen_posten IS
'Phase C (0116): so viele Nachlade-Posten hat dieser Lauf bearbeitet (ok, keine_daten, Fehler).
0 bei offenem Nachladen ist ein Befund — der Lauf steht dann auf teilweise, die Notiz nennt den
Grund. NULL: der Lauf kannte Phase C noch nicht.';
COMMENT ON COLUMN sync.lauf.nachladen_offen IS
'Am Ende von Phase C noch offene Nachlade-Posten der LINA-Spur (auch vertagte). Faellt diese
Zahl von Lauf zu Lauf, laeuft der Backfill; bleibt sie stehen, laeuft er nicht. Betriebsberichte
zaehlen nicht mit, solange die Notbremse BETRIEBSBERICHT_JE_LAUF = 0 sie abschaltet.';

-- CREATE OR REPLACE kann nur anhaengen: die neuen Spalten stehen am Ende.
CREATE OR REPLACE VIEW mart.sync_status AS
SELECT lauf_id,
       gestartet_am,
       beendet_am,
       ausloeser,
       status,
       aufgaben_gesamt,
       aufgaben_ok,
       aufgaben_fehler,
       aufgaben_uebersprungen,
       round(EXTRACT(epoch FROM beendet_am - gestartet_am), 1) AS dauer_s,
       (SELECT count(*) FROM sync.schema_abweichung a
         WHERE a.erkannt_am >= l.gestartet_am AND a.quittiert_am IS NULL) AS offene_abweichungen,
       (SELECT count(*) FROM sync.fortschritt f
         WHERE f.pausiert_bis > now()) AS pausierte_kombinationen,
       l.tagesgeschaeft_bis,
       l.ableitungen_bis,
       l.nachladen_posten,
       l.nachladen_offen
  FROM sync.lauf l
 ORDER BY lauf_id DESC;

COMMENT ON COLUMN mart.sync_status.ableitungen_bis IS
'Seit 0116: wann die Auswertungen dieses Laufs fertig aufgefrischt waren — die Frische der
Dashboards. Das Laufende (beendet_am) liegt im Backfill viele Stunden spaeter, weil danach
die Historie nachgeladen wird.';
COMMENT ON COLUMN mart.sync_status.nachladen_offen IS
'Seit 0116: was nach diesem Lauf noch nachzuladen ist (LINA-Historie, Betriebsberichte).';


-- ---------------------------------------------------------------------
-- 4. Frische gegen das Ende des Tagesgeschaefts messen
--
-- Beide Sichten verglichen den Merker eines Refresh mit dem ENDE des
-- letzten Laufs (beendet_am - 1 Stunde). Solange Phase B nach dem Laufende
-- lief, ging das auf. Ab 0116 endet der Lauf erst nach Phase C, und ein
-- Refresh aus Phase B liegt dann bis zu dreizehn Stunden davor — alle
-- Materialisierungen stuenden jeden Abend auf "veraltet". Ein Alarm, der
-- jeden Tag schlaegt, liest niemand mehr.
--
-- Der richtige Bezug ist das, worauf der Refresh wartet: das Ende des
-- Tagesgeschaefts (tagesgeschaeft_bis), fuer Laeufe vor 0116 wie bisher
-- beendet_am. Was Phase C in eine materialisierte Sicht schreibt, frischt
-- sync.ts nach Phase C noch einmal auf; misslingt DAS, zeigt die Sicht die
-- Historie einen Tag spaeter — der naechste Lauf holt es nach.
--
-- DER WETTER-MERKER BEKOMMT DEN LAUFBEGINN. wetter_tag_refresh wird in
-- wetterNachlauf() gesetzt, also in Phase A, neben dem Import und damit
-- meist Stunden vor dessen Ende. Gemessen in Produktion am 23.09.2026:
-- aufgefrischt 22.09. 03:14 UTC, Laufende 05:06 UTC — "veraltet", und so
-- seit 0111 jeden Tag. Fuer ihn ist der Bezug der Laufbeginn.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.materialisierung_stand AS
WITH letzter_lauf AS (
  SELECT l.beendet_am,
         l.gestartet_am,
         coalesce(l.tagesgeschaeft_bis, l.beendet_am) AS tagesgeschaeft_bis
    FROM sync.lauf l
   WHERE l.status IN ('ok', 'teilweise')
   ORDER BY l.beendet_am DESC NULLS LAST
   LIMIT 1
), vorhanden AS (
  SELECT (schemaname || '.' || matviewname)::text AS sicht
    FROM pg_matviews
   WHERE schemaname = 'mart'
), zuordnung(sicht, schluessel, nachlauf) AS (
  VALUES
    ('mart.deckungsbeitrag_warengruppe'::text, 'deckungsbeitrag_refresh'::text, 'src/sync/deckungsbeitrag.ts'::text),
    ('mart.round_table_monat',                 'round_table_refresh',           'src/sync/round_table.ts'),
    ('mart.round_table_trend',                 'round_table_refresh',           'src/sync/round_table.ts'),
    ('mart.artikel_monat_basis',               'round_table_refresh',           'src/sync/round_table.ts'),
    -- 0106: die Artikeltage fuer mart.datenstand.
    ('mart.artikeltage_basis',                 'round_table_refresh',           'src/sync/round_table.ts'),
    ('mart.vergleichstag_basis',               'vergleichstag_refresh',         'src/sync/vergleichstag.ts'),
    ('mart.einkauf_kreditor_monat',            'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkaufspreis_monat_basis',         'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkaufspreis_betrieb_basis',       'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkauf_betrieb_monat_basis',       'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkauf_pruefung_basis',            'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    -- 0094: die Pflichtartikelauswertung. Eigener Merker, weil sie NACH
    -- der Handpflege laufen muss — die Listen kommen aus pflege/.
    ('mart.pflichtartikel_klassifikation_basis', 'pflichtartikel_refresh',      'src/sync/pflichtartikel_sichten.ts'),
    ('mart.pflichtartikel_einkauf_basis',        'pflichtartikel_refresh',      'src/sync/pflichtartikel_sichten.ts'),
    ('mart.pflichtartikel_artikel_basis',        'pflichtartikel_refresh',      'src/sync/pflichtartikel_sichten.ts'),
    -- 0111: das Wetter. Steht im Wetter-Nachlauf selbst, nicht in einem
    -- der vier Sammel-Nachlaeufe — nur er schreibt manual.wetter_stunde.
    ('mart.wetter_tag_basis',                    'wetter_tag_refresh',          'src/wetter/nachlauf.ts')
)
SELECT coalesce(v.sicht, z.sicht)      AS sicht,
       z.schluessel,
       z.nachlauf,
       m.gesetzt_am                    AS zuletzt_aufgefrischt,
       (m.wert ->> 'dauer_s')::numeric AS dauer_s,
       l.beendet_am                    AS letzter_lauf,
       CASE WHEN z.sicht IS NULL      THEN 'ohne Refresh'
            WHEN v.sicht IS NULL      THEN 'Sicht fehlt'
            WHEN m.gesetzt_am IS NULL THEN 'nie aufgefrischt'
            WHEN l.beendet_am IS NULL THEN 'kein Lauf'
            -- 0116: der Bezug ist, worauf der Refresh wartet (siehe Kopf).
            WHEN m.gesetzt_am < CASE WHEN z.schluessel = 'wetter_tag_refresh'
                                     THEN l.gestartet_am
                                     ELSE l.tagesgeschaeft_bis END
                                - INTERVAL '1 hour' THEN 'veraltet'
            ELSE 'aktuell' END         AS zustand
  FROM vorhanden v
  FULL JOIN zuordnung z ON z.sicht = v.sicht
  LEFT JOIN letzter_lauf l ON true
  LEFT JOIN sync.merker m ON m.schluessel = z.schluessel;

COMMENT ON COLUMN mart.materialisierung_stand.zustand IS
'aktuell = aufgefrischt nach dem Tagesgeschaeft des letzten Laufs (seit 0116; davor: nach dem
Laufende). veraltet = der Refresh ist mehr als eine Stunde aelter als dieser Bezug, also in der
Nacht gescheitert (die Nachlaeufe werfen nie, sie schreiben nur log.warn). Fuer den
Wetter-Merker ist der Bezug der Laufbeginn — er wird in Phase A gesetzt. nie aufgefrischt = der
Merker fehlt ganz. ohne Refresh = die Sicht steht in pg_matviews, aber in keinem Nachlauf.
Sicht fehlt = umgekehrt, die Zuordnung nennt eine Sicht, die es nicht mehr gibt.
letzter_lauf bleibt das Laufende (beendet_am) — im Backfill Stunden nach dem Refresh.';

CREATE OR REPLACE VIEW mart.vergleichstag_stand AS
WITH letzter_lauf AS (
  SELECT l.beendet_am,
         coalesce(l.tagesgeschaeft_bis, l.beendet_am) AS tagesgeschaeft_bis
    FROM sync.lauf l
   WHERE l.status IN ('ok', 'teilweise')
   ORDER BY l.beendet_am DESC NULLS LAST
   LIMIT 1
), merker AS (
  SELECT gesetzt_am, (wert ->> 'dauer_s')::numeric AS dauer_s
    FROM sync.merker
   WHERE schluessel = 'vergleichstag_refresh'
)
SELECT m.gesetzt_am AS zuletzt_aufgefrischt,
       m.dauer_s,
       l.beendet_am AS letzter_lauf,
       CASE WHEN m.gesetzt_am IS NULL THEN 'nie aufgefrischt'
            WHEN l.beendet_am IS NULL THEN 'kein Lauf'
            -- 0116: gegen das Ende des Tagesgeschaefts, nicht des Laufs.
            WHEN m.gesetzt_am < l.tagesgeschaeft_bis - INTERVAL '1 hour' THEN 'veraltet'
            ELSE 'aktuell' END AS zustand
  FROM (SELECT 1) eins
  LEFT JOIN letzter_lauf l ON true
  LEFT JOIN merker m ON true;


INSERT INTO sync.merker (schluessel, wert)
VALUES ('migration_0116', to_jsonb(
  'Der Nachtlauf hat drei Abschnitte: Phase A laedt das Tagesgeschaeft (sync.warteschlange.nachladen = false), '
  || 'Phase B frischt die Auswertungen auf, Phase C laedt danach die Historie bis zum Tagesbudget nach. '
  || 'Bis dahin lief das Nachladen der Betriebsberichte verschraenkt IM Import, und Phase B kam im Backfill erst gegen 20:30. '
  || 'Wann die Dashboards frisch waren: mart.sync_status.ableitungen_bis; was nachgeladen wurde und was aussteht: '
  || 'nachladen_posten und nachladen_offen. Die Frischepruefung misst seitdem gegen das Ende des Tagesgeschaefts, '
  || 'den Wetter-Merker gegen den Laufbeginn — er stand seit 0111 jeden Tag grundlos auf veraltet.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert, gesetzt_am = now();
