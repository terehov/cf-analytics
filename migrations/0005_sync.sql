-- =====================================================================
-- 0005 Sync — der Betriebszustand des Importers
--
-- Der Zustand liegt VOLLSTAENDIG hier und nicht im Prozess. Daraus folgt
-- alles, was den Betrieb entspannt macht: ein Containerabsturz kostet
-- nichts, ein Neustart macht beim naechsten offenen Posten weiter, und ein
-- pg_dump nimmt die Arbeitsschlange mit auf den Zielserver.
--
-- In Metabase ausblenden - dafuer gibt es mart.sync_status und
-- mart.backfill_fortschritt.
-- =====================================================================

CREATE TABLE sync.lauf (
    lauf_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gestartet_am    timestamptz NOT NULL DEFAULT now(),
    beendet_am      timestamptz,
    ausloeser       text NOT NULL CHECK (ausloeser IN ('zeitplan','manuell','backfill')),
    status          text NOT NULL DEFAULT 'laeuft'
                    CHECK (status IN ('laeuft','ok','teilweise','fehlgeschlagen','abgebrochen')),
    aufgaben_gesamt integer NOT NULL DEFAULT 0,
    aufgaben_ok     integer NOT NULL DEFAULT 0,
    aufgaben_fehler integer NOT NULL DEFAULT 0,
    aufgaben_uebersprungen integer NOT NULL DEFAULT 0,
    notiz           text
);

CREATE TABLE sync.aufgabe (
    aufgabe_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lauf_id         bigint  NOT NULL REFERENCES sync.lauf(lauf_id),
    endpunkt        text    NOT NULL,
    betrieb_enc_id  text,
    zeitraum_von    date,
    zeitraum_bis    date,
    versuch         smallint NOT NULL DEFAULT 1,
    status          text    NOT NULL CHECK (status IN ('ok','keine_daten','fehler','uebersprungen')),
    http_status     integer,
    zeilen          integer,
    dauer_ms        integer,
    wartezeit_ms    integer,
    fehler          text,
    beendet_am      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN sync.aufgabe.status       IS 'keine_daten ist ein NORMALZUSTAND: LINA antwortet mit HTTP 500 und leerem Body, wenn ein Betrieb fuer diesen Bericht keine Daten hat. Kein Retry.';
COMMENT ON COLUMN sync.aufgabe.wartezeit_ms IS 'Tatsaechlich gewartete Zeit vor diesem Request. Macht die Drosselung im Nachhinein pruefbar.';

CREATE INDEX ON sync.aufgabe (lauf_id, status);
CREATE INDEX ON sync.aufgabe (endpunkt, betrieb_enc_id, beendet_am DESC);

CREATE TABLE sync.fortschritt (
    endpunkt            text NOT NULL,
    betrieb_enc_id      text NOT NULL DEFAULT '',
    letzter_zeitraum    date,
    letzter_erfolg_am   timestamptz,
    fehler_in_folge     smallint NOT NULL DEFAULT 0,
    pausiert_bis        timestamptz,
    PRIMARY KEY (endpunkt, betrieb_enc_id)
);
COMMENT ON TABLE  sync.fortschritt              IS 'Wo steht der Importer? Der Zustand liegt bewusst in der Datenbank und nicht im Container - ein Absturz kostet damit nichts.';
COMMENT ON COLUMN sync.fortschritt.pausiert_bis IS 'Selbstdrosselung: nach wiederholten Fehlern pausiert der Importer diese Kombination, statt stur weiterzulaufen.';

CREATE TABLE sync.schema_abweichung (
    abweichung_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    endpunkt        text        NOT NULL,
    erkannt_am      timestamptz NOT NULL DEFAULT now(),
    erwartet        jsonb,
    tatsaechlich    jsonb,
    quittiert_am    timestamptz
);
COMMENT ON TABLE sync.schema_abweichung IS 'LINAs API ist undokumentiert und unversioniert. Jede Antwort wird gegen ein zod-Schema geprueft; Abweichungen landen hier, statt still falsch interpretiert zu werden.';


-- Waechter: stimmt LINAs Zeitzonenannahme noch?
CREATE OR REPLACE FUNCTION core.pruefe_lina_epoch(p_epoch bigint, p_erwarteter_tag date)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_ist date;
BEGIN
    v_ist := (to_timestamp(p_epoch) AT TIME ZONE core.geschaefts_zeitzone())::date;
    IF v_ist <> p_erwarteter_tag THEN
        INSERT INTO sync.schema_abweichung (endpunkt, erwartet, tatsaechlich)
        VALUES ('zeitzonen-pruefung',
                jsonb_build_object('erwarteter_tag', p_erwarteter_tag, 'zeitzone', core.geschaefts_zeitzone()),
                jsonb_build_object('epoch', p_epoch, 'aufgeloester_tag', v_ist));
        RETURN false;
    END IF;
    RETURN true;
END $$;

COMMENT ON FUNCTION core.pruefe_lina_epoch IS
'Prueft LINAs from/to-Epoch gegen den erwarteten Geschaeftstag. Schlaegt sie fehl, landet das in
sync.schema_abweichung - ein stiller Zeitzonenwechsel bei LINA faellt damit sofort auf, statt
Monate spaeter in falschen Tagesumsaetzen.';


-- =====================================================================
-- Arbeitsschlange
--
-- Es gibt bewusst KEINEN getrennten Backfill- und Sync-Modus. Beides ist
-- dieselbe Sache: Eintraege in dieser Schlange, die ein einzelner Worker
-- konstant und langsam abarbeitet.
--
--   prioritaet  5  Vorlauf: liefert Schluessel, die andere Endpunkte brauchen
--   prioritaet 10  laufende Daten (gestern), taeglich eingereiht
--   prioritaet 20  Nachlauf: Momentaufnahmen, die auf die Tagesberichte aufbauen
--   prioritaet 50  Nacharbeiten nach Fehlern
--   prioritaet 90  Historie, rueckwaerts
--
-- Damit kann aktuelle Daten nie hinter dem Backfill verhungern, und es gibt
-- nur einen Codepfad statt zweier, die auseinanderlaufen.
--
-- 5 und 20 sind keine Feinheit, sondern eine echte Abhaengigkeit: ohne
-- analyticsFilterOptions findet keine BWA-Zeile ihren Betrieb, und
-- articleApi ordnet nur Artikeln zu, die der Verkaufsbericht schon angelegt
-- hat. Begruendung ausfuehrlich in src/einreihen.ts.
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
COMMENT ON COLUMN sync.warteschlange.prioritaet     IS '5 = Vorlauf (liefert Schluessel fuer andere Endpunkte), 10 = laufende Daten, 20 = Nachlauf (Momentaufnahmen, die auf die Tagesberichte aufbauen), 50 = Nacharbeit nach Fehler, 90 = Historie. Kleiner gewinnt.';
COMMENT ON COLUMN sync.warteschlange.faellig_ab     IS 'Wiedervorlage. Nach einem Fehler in die Zukunft gesetzt (exponentielles Backoff mit Jitter), statt sofort erneut zu versuchen.';
COMMENT ON COLUMN sync.warteschlange.in_arbeit_seit IS 'Reservierung durch den Worker. Bleibt ein Posten haengen (Absturz mitten im Lauf), gibt ihn die Aufraeumfunktion nach einer Stunde wieder frei.';
COMMENT ON COLUMN sync.warteschlange.ergebnis       IS 'keine_daten ist ein NORMALZUSTAND, kein Fehler: LINA antwortet mit HTTP 500 und leerem Body, wenn ein Betrieb fuer diesen Bericht keine Daten hat.';

-- Ein Zeitraum je Endpunkt/Betrieb darf nur einmal OFFEN sein.
--
-- ACHTUNG, hier steckte schon zweimal derselbe Fehler: dieser Index ist
-- PARTIELL. Ein erledigter Posten blockiert ihn NICHT. Wer Posten mit
-- ON CONFLICT DO NOTHING einreiht, reiht damit alles Erledigte erneut ein.
-- Zum Einreihen deshalb immer WHERE NOT EXISTS gegen ALLE Posten pruefen -
-- so wie es sync.historie_einreihen() weiter unten macht.
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
-- zwei denselben Posten greifen. Aktuell laeuft nur einer - abgesichert
-- ueber eine Advisory-Sperre in src/sync/worker.ts, denn SKIP LOCKED
-- verhindert nur doppelte Posten, nicht doppeltes Tempo.
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
--
-- IDEMPOTENT, und das ist der Punkt: geprueft wird gegen ALLE Posten
-- desselben Zeitraums, erledigte eingeschlossen. Die erste Fassung nahm
-- ON CONFLICT DO NOTHING und verliess sich damit auf den partiellen
-- Eindeutigkeitsindex - fuenf Tage einreihen, erledigen, erneut einreihen
-- ergab ZEHN Posten statt fuenf. Beim Umzug auf den Server waere dadurch
-- das komplette lokal geholte Jahr ein zweites Mal gegen LINA gelaufen.
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

        -- Gegen ALLE Posten pruefen, nicht nur gegen offene: ein bereits
        -- geholter Zeitraum wird nicht noch einmal geholt.
        INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, parameter, prioritaet)
        SELECT p_endpunkt, v_von, v_bis, p_parameter, p_prioritaet
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

COMMENT ON FUNCTION sync.historie_einreihen IS
'Reiht Zeitraeume rueckwaerts ein, juengster zuerst. IDEMPOTENT: bereits eingereihte oder
bereits erledigte Zeitraeume werden uebersprungen, der Aufruf laesst sich also beliebig oft
wiederholen und fuellt nur echte Luecken.
Beispiel: SELECT sync.historie_einreihen(''getUmsatzbericht'', DATE ''2018-01-01'', DATE ''2026-07-24'', ''tag'');';
