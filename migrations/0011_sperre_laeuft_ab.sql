-- ---------------------------------------------------------------------
-- 0011 Eine Sperre wartet nicht auf einen Menschen
--
-- ANLASS, Eugene: "Falls es in die Sperre kommt, soll es nicht auf eine
-- Freigabe warten, sondern einfach im Zeitintervall von einem Tag neu
-- versuchen oder vielleicht zwei Tagen."
--
-- Richtig, und es korrigiert eine Schieflage in 0009. Technisch lief die
-- Sperre schon immer von selbst ab -- `sperre_aktiv()` prueft
-- `pausiert_bis > now()`. Die Basisdauer war mit sechs Stunden aber so kurz
-- gewaehlt, dass sie eher als Wiedervorlage taugte denn als Ruhepause, und
-- die Verdopplung lief bis zum Sechzehnfachen: aus sechs Stunden waeren
-- ueber vier Tage geworden, ohne dass jemand das der Zahl ansieht.
--
-- Neu: ein Tag Grundpause, hoechstens vier Tage nach mehrfacher Sperre.
--
--     erste Sperre        24 h
--     zweite binnen 24 h  48 h
--     dritte und weitere  96 h
--
-- Das Aufheben von Hand bleibt -- aber als ABKUERZUNG, nicht als Bedingung.
-- Wer im Browser geprueft hat, dass der Zugang wieder geht, muss nicht bis
-- morgen warten. Wer nichts tut, dem laeuft die Sperre ab und der Importer
-- versucht es von selbst erneut.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync.sperre_setzen(
    p_art          text,
    p_basis_stunden numeric,
    p_http_status  integer DEFAULT NULL,
    p_endpunkt     text    DEFAULT NULL,
    p_hinweis      text    DEFAULT NULL,
    p_lauf_id      bigint  DEFAULT NULL,
    p_bis          timestamptz DEFAULT NULL   -- z.B. aus dem Retry-After-Header
) RETURNS timestamptz
LANGUAGE plpgsql AS $$
DECLARE
    v_vorher  integer;
    v_stunden numeric;
    v_bis     timestamptz;
BEGIN
    SELECT count(*) INTO v_vorher
      FROM sync.zugangssperre
     WHERE erkannt_am > now() - interval '24 hours';

    -- Hoechstens zweimal verdoppeln. Bei einem Tag Grundpause sind das vier
    -- Tage -- lange genug, dass wiederholte Sperren wehtun, kurz genug, dass
    -- der Importer ohne Zutun zurueckkommt.
    v_stunden := p_basis_stunden * power(2, least(v_vorher, 2));
    v_bis := greatest(now() + (v_stunden || ' hours')::interval, coalesce(p_bis, '-infinity'));

    INSERT INTO sync.zugangssperre
        (pausiert_bis, art, http_status, endpunkt, hinweis, lauf_id)
    VALUES (v_bis, p_art, p_http_status, p_endpunkt, p_hinweis, p_lauf_id);

    RETURN v_bis;
END $$;

COMMENT ON FUNCTION sync.sperre_setzen IS
'Legt eine Sperre an und gibt zurueck, bis wann pausiert wird. Die Sperre LAEUFT VON SELBST
AB -- danach versucht es der Importer ohne Zutun erneut. Die Basisdauer verdoppelt sich je
weiterer Sperre der letzten 24 Stunden, hoechstens zweimal (also maximal das Vierfache).
p_bis setzt eine Untergrenze; dort gehoert ein Retry-After-Header hin.';

COMMENT ON FUNCTION sync.sperre_aufheben IS
'Hebt alle laufenden Sperren vorzeitig auf. Eine ABKUERZUNG, keine Bedingung: ohne Zutun
laeuft die Sperre ohnehin ab. Sinnvoll, wenn im Browser geprueft wurde, dass der Zugang
wieder geht und man nicht bis morgen warten will:
    SELECT sync.sperre_aufheben(''eugene'');';

COMMENT ON COLUMN sync.zugangssperre.aufgehoben_am IS
'Von Hand vorzeitig freigegeben. Nicht noetig -- die Sperre laeuft von selbst ab. Wer sie
abkuerzt, sollte vorher im Browser geprueft haben, dass der Zugang wieder geht; sonst geht
der naechste Lauf sofort in dieselbe Sperre und verlaengert sie.';
