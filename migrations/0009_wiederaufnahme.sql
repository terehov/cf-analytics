-- ---------------------------------------------------------------------
-- 0009 Wiederaufnahme: einreihen darf nichts doppelt holen
--
-- Der Importer soll ueber Tage unbeaufsichtigt laufen, unterbrochen werden
-- duerfen und anderswo weitermachen koennen -- lokal anfangen, per pg_dump
-- auf den Server umziehen, dort weiterlaufen. Der Zustand liegt vollstaendig
-- in sync.warteschlange, das traegt diesen Ablauf.
--
-- Eine Stelle trug ihn NICHT: sync.historie_einreihen() benutzte
-- ON CONFLICT DO NOTHING und verliess sich damit auf
--
--     CREATE UNIQUE INDEX warteschlange_offen_uq
--         ON sync.warteschlange (endpunkt, ..., zeitraum_von, zeitraum_bis)
--      WHERE erledigt_am IS NULL;
--
-- Dieser Index ist PARTIELL. Ein ERLEDIGTER Posten blockiert nichts, also
-- reihte ein zweiter Aufruf alles Fertige erneut ein. Am 26.07.2026
-- nachgemessen: fuenf Tage einreihen, erledigen, erneut einreihen -> zehn
-- Posten statt fuenf.
--
-- Fuer den geplanten Ablauf waere das teuer: erst lokal das laufende Jahr
-- holen, dann auf dem Server `--historie --von 2018-01-01` -- und alles
-- bereits Geholte liefe ein zweites Mal gegen LINA. Bei einem Zugang ohne
-- offizielle Limits ist das die Sorte Fehler, die man sich nicht leistet.
--
-- Geprueft wird jetzt gegen ALLE Posten desselben Zeitraums, erledigte
-- eingeschlossen. Damit ist `einreihen --historie` beliebig oft wiederholbar
-- und fuellt nur die echten Luecken auf.
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
wiederholen und fuellt nur echte Luecken. Das ON CONFLICT DO NOTHING davor konnte das nicht,
weil der Eindeutigkeitsindex partiell ist (nur offene Posten).
Beispiel: SELECT sync.historie_einreihen(''getUmsatzbericht'', DATE ''2018-01-01'', DATE ''2026-07-24'', ''tag'');';


-- ---------------------------------------------------------------------
-- Fortschritt beim Backfill -- die Frage "wie weit sind wir?"
--
-- Bei 23.000 Posten ueber Tage ist das die Sicht, die man morgens aufmacht.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.backfill_fortschritt AS
SELECT endpunkt,
       count(*)::int                                                  AS posten_gesamt,
       count(*) FILTER (WHERE erledigt_am IS NOT NULL)::int           AS erledigt,
       count(*) FILTER (WHERE erledigt_am IS NULL)::int               AS offen,
       count(*) FILTER (WHERE ergebnis = 'aufgegeben')::int           AS aufgegeben,
       round(100.0 * count(*) FILTER (WHERE erledigt_am IS NOT NULL)
                   / nullif(count(*), 0), 1)                          AS prozent,
       min(zeitraum_von) FILTER (WHERE erledigt_am IS NULL)           AS aeltester_offener,
       max(zeitraum_von) FILTER (WHERE erledigt_am IS NULL)           AS juengster_offener
  FROM sync.warteschlange
 GROUP BY endpunkt
 ORDER BY offen DESC, endpunkt;

COMMENT ON VIEW mart.backfill_fortschritt IS
'Wie weit ist der Backfill je Endpunkt? Prozentwerte sind Prozentzahlen (23.64), nie Brueche.
Ein Lauf laesst sich jederzeit unterbrechen und neu starten: der Zustand steht hier, nicht im
Prozess. Nach einem pg_dump/restore macht der Importer auf dem Zielserver genau hier weiter.';
