-- =====================================================================
-- Arbeitsschlange
--
-- Es gibt bewusst KEINEN getrennten Backfill- und Sync-Modus. Beides ist
-- dieselbe Sache: Eintraege in dieser Schlange, die ein einzelner Worker
-- konstant und langsam abarbeitet.
--
--   prioritaet 10  laufende Daten (gestern), taeglich eingereiht
--   prioritaet 50  Nacharbeiten nach Fehlern
--   prioritaet 90  Historie, rueckwaerts
--
-- Damit kann aktuelle Daten nie hinter dem Backfill verhungern, und es gibt
-- nur einen Codepfad statt zweier, die auseinanderlaufen.
-- =====================================================================

CREATE TABLE sync.warteschlange (
    posten_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    endpunkt        text        NOT NULL,
    betrieb_enc_id  text,
    zeitraum_von    date        NOT NULL,
    zeitraum_bis    date        NOT NULL,
    parameter       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    prioritaet      smallint    NOT NULL DEFAULT 90,
    faellig_ab      timestamptz NOT NULL DEFAULT now(),
    versuche        smallint    NOT NULL DEFAULT 0,
    in_arbeit_seit  timestamptz,
    erledigt_am     timestamptz,
    ergebnis        text CHECK (ergebnis IN ('ok','keine_daten','aufgegeben')),
    letzter_fehler  text,
    erstellt_am     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  sync.warteschlange                IS 'Eine Zeile je zu holendem Zeitraum. Der Zustand des Importers liegt vollstaendig hier - ein Containerabsturz kostet damit nichts.';
COMMENT ON COLUMN sync.warteschlange.prioritaet     IS '10 = laufende Daten, 50 = Nacharbeit nach Fehler, 90 = Historie. Kleiner gewinnt.';
COMMENT ON COLUMN sync.warteschlange.faellig_ab     IS 'Wiedervorlage. Nach einem Fehler in die Zukunft gesetzt (exponentielles Backoff mit Jitter), statt sofort erneut zu versuchen.';
COMMENT ON COLUMN sync.warteschlange.in_arbeit_seit IS 'Reservierung durch den Worker. Bleibt ein Posten haengen (Absturz mitten im Lauf), gibt ihn core-seitig die Aufraeumfunktion wieder frei.';
COMMENT ON COLUMN sync.warteschlange.ergebnis       IS 'keine_daten ist ein NORMALZUSTAND, kein Fehler: LINA antwortet mit HTTP 500 und leerem Body, wenn ein Betrieb fuer diesen Bericht keine Daten hat.';

-- Ein Zeitraum je Endpunkt/Betrieb darf nur einmal offen sein.
CREATE UNIQUE INDEX warteschlange_offen_uq
    ON sync.warteschlange (endpunkt, coalesce(betrieb_enc_id,''), zeitraum_von, zeitraum_bis)
 WHERE erledigt_am IS NULL;

-- Der Zugriffspfad des Workers.
CREATE INDEX warteschlange_naechster
    ON sync.warteschlange (prioritaet, faellig_ab)
 WHERE erledigt_am IS NULL AND in_arbeit_seit IS NULL;

CREATE INDEX warteschlange_historie
    ON sync.warteschlange (endpunkt, zeitraum_von DESC)
 WHERE erledigt_am IS NOT NULL;


-- ---------------------------------------------------------------------
-- Naechsten Posten reservieren
--
-- SKIP LOCKED, damit spaeter mehrere Worker moeglich waeren, ohne dass sich
-- zwei denselben Posten greifen. Aktuell laeuft nur einer - aber die Sperre
-- kostet nichts und erspart einen spaeteren Umbau.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync.posten_holen(p_lauf_id bigint)
RETURNS sync.warteschlange
LANGUAGE plpgsql AS $$
DECLARE p sync.warteschlange;
BEGIN
    SELECT * INTO p
      FROM sync.warteschlange
     WHERE erledigt_am IS NULL
       AND in_arbeit_seit IS NULL
       AND faellig_ab <= now()
     ORDER BY prioritaet, faellig_ab, posten_id
     FOR UPDATE SKIP LOCKED
     LIMIT 1;

    IF NOT FOUND THEN RETURN NULL; END IF;

    UPDATE sync.warteschlange
       SET in_arbeit_seit = now(), versuche = versuche + 1
     WHERE posten_id = p.posten_id
    RETURNING * INTO p;

    RETURN p;
END $$;


-- Haengengebliebene Reservierungen freigeben (Container abgestuerzt o.ae.)
CREATE OR REPLACE FUNCTION sync.haengende_posten_freigeben(p_aelter_als interval DEFAULT interval '1 hour')
RETURNS integer LANGUAGE sql AS $$
    WITH frei AS (
        UPDATE sync.warteschlange
           SET in_arbeit_seit = NULL
         WHERE erledigt_am IS NULL
           AND in_arbeit_seit < now() - p_aelter_als
        RETURNING 1)
    SELECT count(*)::int FROM frei;
$$;


-- ---------------------------------------------------------------------
-- Historie einreihen
--
-- Reiht rueckwaerts ab p_bis bis p_von ein - der juengste Zeitraum zuerst,
-- damit die Daten wachsen, die am wahrscheinlichsten gebraucht werden.
-- Bestehende offene Posten werden dank Unique-Index uebersprungen.
-- ---------------------------------------------------------------------

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

        INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, parameter, prioritaet)
        VALUES (p_endpunkt, v_von, v_bis, p_parameter, p_prioritaet)
        ON CONFLICT DO NOTHING;

        IF FOUND THEN v_anzahl := v_anzahl + 1; END IF;
        v_cursor := (v_von - interval '1 day')::date;
    END LOOP;

    RETURN v_anzahl;
END $$;

COMMENT ON FUNCTION sync.historie_einreihen IS
'Reiht Zeitraeume rueckwaerts ein, juengster zuerst.
Beispiel: SELECT sync.historie_einreihen(''getUmsatzbericht'', DATE ''2018-01-01'', DATE ''2026-07-24'', ''tag'');';


-- ---------------------------------------------------------------------
-- Fortschrittsuebersicht — erste Anlaufstelle in Postico
-- ---------------------------------------------------------------------

CREATE VIEW mart.warteschlange_stand AS
SELECT endpunkt,
       count(*) FILTER (WHERE erledigt_am IS NULL)                        AS offen,
       count(*) FILTER (WHERE erledigt_am IS NULL AND prioritaet <= 10)   AS offen_laufend,
       count(*) FILTER (WHERE erledigt_am IS NULL AND prioritaet >= 90)   AS offen_historie,
       count(*) FILTER (WHERE ergebnis = 'ok')                            AS geladen,
       count(*) FILTER (WHERE ergebnis = 'keine_daten')                   AS keine_daten,
       count(*) FILTER (WHERE ergebnis = 'aufgegeben')                    AS aufgegeben,
       min(zeitraum_von) FILTER (WHERE ergebnis = 'ok')                   AS aeltester_geladen,
       max(zeitraum_bis) FILTER (WHERE ergebnis = 'ok')                   AS juengster_geladen
  FROM sync.warteschlange
 GROUP BY endpunkt
 ORDER BY endpunkt;

COMMENT ON VIEW mart.warteschlange_stand IS
'Wie weit ist der Backfill? Eine Zeile je Endpunkt mit offenen, geladenen und aufgegebenen
Zeitraeumen sowie der abgedeckten Zeitspanne.';
