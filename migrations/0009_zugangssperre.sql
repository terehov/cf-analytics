-- ---------------------------------------------------------------------
-- 0009 Zugangssperre — was passiert, wenn LINA dichtmacht
--
-- Bis hierher kannte der Importer nur zwei Sorten Fehler: wiederholbar und
-- nicht wiederholbar. Beide sind auf EINEN Posten bezogen. Eine Sperre ist
-- aber keine Eigenschaft des Postens, sondern des Zugangs -- und sie
-- richtig zu behandeln heisst, etwas zu tun, was der Importer bisher gar
-- nicht konnte: aufhoeren.
--
-- Was heute stattdessen passieren wuerde, am Code nachgelesen:
--
--   * HTTP 403 gilt als "nicht wiederholbar". Der Posten wird ALS
--     AUFGEGEBEN quittiert -- obwohl mit ihm nichts verkehrt ist, nur mit
--     dem Zugang. Zehn Posten sind so dauerhaft weg, je Lauf.
--   * Nach ABBRUCH_NACH_FEHLERN (10) stoppt der Lauf. Der Zeitplan startet
--     eine Stunde spaeter den naechsten, der dieselben zehn Anfragen gegen
--     ein System schickt, das gerade "nein" gesagt hat.
--   * Am schlimmsten beim Anmeldefehler: `holen()` faengt ihn ab und gibt
--     einen gewoehnlichen Fehler zurueck. Beim naechsten Posten ist die
--     Session immer noch nicht angemeldet, also wird ERNEUT angemeldet --
--     zehnmal in Folge, stuendlich. Genau das verbietet harte Regel 6, und
--     zwar weil es der schnellste Weg zu einer Kontosperre ist. Es gibt
--     genau einen Zugang.
--
-- Deshalb dieser Zustand HIER und nicht im Prozess. Dieselbe Lektion wie
-- beim Tagesbudget: was im Arbeitsspeicher liegt, ist beim stuendlichen
-- Neustart wieder null, und eine Pause, die einen Neustart nicht ueberlebt,
-- ist keine Pause.
-- ---------------------------------------------------------------------

CREATE TABLE sync.zugangssperre (
    sperre_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    erkannt_am      timestamptz NOT NULL DEFAULT now(),
    pausiert_bis    timestamptz NOT NULL,
    art             text NOT NULL CHECK (art IN
                        ('http_429', 'http_403', 'challenge', 'anmeldung', 'manuell')),
    http_status     integer,
    endpunkt        text,
    hinweis         text,
    lauf_id         bigint,
    aufgehoben_am   timestamptz,
    aufgehoben_von  text
);

COMMENT ON TABLE sync.zugangssperre IS
'Erkannte Zugangssperren. Append-only bis auf das Aufheben von Hand.
Solange eine Zeile aktiv ist (aufgehoben_am IS NULL AND pausiert_bis > now()), nimmt der
Importer GAR KEINEN Kontakt zu LINA auf -- er meldet sich nicht einmal an.
Erste Frage, wenn nichts mehr laeuft: SELECT * FROM mart.zugangssperre;';

COMMENT ON COLUMN sync.zugangssperre.art IS
'http_429 = zu viele Anfragen. http_403 = Zugriff verweigert. challenge = HTML statt JSON,
also vermutlich eine Abwehrseite. anmeldung = die Anmeldung selbst schlug fehl, der
schwerste Fall (moeglicherweise gesperrtes Konto). manuell = von Hand gesetzt.';

COMMENT ON COLUMN sync.zugangssperre.aufgehoben_am IS
'Von Hand vorzeitig freigegeben. NUR setzen, wenn jemand im Browser geprueft hat, dass der
Zugang wieder geht -- ein blindes Aufheben schickt den Importer sofort zurueck in dieselbe
Sperre.';

CREATE INDEX ON sync.zugangssperre (pausiert_bis DESC) WHERE aufgehoben_am IS NULL;


-- ---------------------------------------------------------------------
-- Die aktive Sperre, oder nichts
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync.sperre_aktiv()
RETURNS sync.zugangssperre
LANGUAGE sql STABLE AS $$
    SELECT * FROM sync.zugangssperre
     WHERE aufgehoben_am IS NULL
       AND pausiert_bis > now()
     ORDER BY pausiert_bis DESC
     LIMIT 1;
$$;

COMMENT ON FUNCTION sync.sperre_aktiv IS
'Die laengste noch laufende Sperre, oder NULL. Der Worker fragt das beim Start und vor
jedem Posten.';


-- ---------------------------------------------------------------------
-- Sperre setzen — mit Verlaengerung bei Wiederholung
--
-- Wer zweimal am Tag gesperrt wird, hat ein anderes Problem als wer einmal
-- gesperrt wird. Die Pause verdoppelt sich deshalb mit jeder weiteren
-- Sperre der letzten 24 Stunden, gedeckelt bei dem Sechzehnfachen. Aus
-- sechs Stunden werden so 12, 24, 48, 96 -- und irgendwann sieht ein Mensch
-- hin, was der Sinn der Sache ist.
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

    v_stunden := p_basis_stunden * power(2, least(v_vorher, 4));
    v_bis := greatest(now() + (v_stunden || ' hours')::interval, coalesce(p_bis, '-infinity'));

    INSERT INTO sync.zugangssperre
        (pausiert_bis, art, http_status, endpunkt, hinweis, lauf_id)
    VALUES (v_bis, p_art, p_http_status, p_endpunkt, p_hinweis, p_lauf_id);

    RETURN v_bis;
END $$;

COMMENT ON FUNCTION sync.sperre_setzen IS
'Legt eine Sperre an und gibt zurueck, bis wann pausiert wird. Die Basisdauer verdoppelt
sich je weiterer Sperre der letzten 24 Stunden (gedeckelt bei 16x). p_bis setzt eine
Untergrenze -- dort gehoert ein Retry-After-Header hin, wenn LINA einen mitschickt.';


CREATE OR REPLACE FUNCTION sync.sperre_aufheben(p_von text DEFAULT NULL)
RETURNS integer LANGUAGE sql AS $$
    WITH frei AS (
        UPDATE sync.zugangssperre
           SET aufgehoben_am = now(), aufgehoben_von = p_von
         WHERE aufgehoben_am IS NULL AND pausiert_bis > now()
        RETURNING 1)
    SELECT count(*)::int FROM frei;
$$;

COMMENT ON FUNCTION sync.sperre_aufheben IS
'Hebt alle laufenden Sperren auf. Erst aufrufen, nachdem im Browser geprueft wurde, dass
der Zugang wirklich wieder geht: SELECT sync.sperre_aufheben(''eugene'');';


-- ---------------------------------------------------------------------
-- Sichtbar machen
-- ---------------------------------------------------------------------

CREATE VIEW mart.zugangssperre AS
SELECT s.sperre_id,
       s.erkannt_am,
       s.pausiert_bis,
       (s.aufgehoben_am IS NULL AND s.pausiert_bis > now()) AS aktiv,
       CASE WHEN s.aufgehoben_am IS NULL AND s.pausiert_bis > now()
            THEN date_trunc('minute', s.pausiert_bis - now())
       END                                                  AS verbleibt,
       s.art,
       s.http_status,
       s.endpunkt,
       s.hinweis,
       s.lauf_id,
       s.aufgehoben_am,
       s.aufgehoben_von
  FROM sync.zugangssperre s
 ORDER BY s.erkannt_am DESC;

COMMENT ON VIEW mart.zugangssperre IS
'Erkannte Zugangssperren, juengste zuerst. ERWARTUNG: leer.
Steht hier eine Zeile mit aktiv = true, ruht der Importer und nimmt keinen Kontakt zu LINA
auf. Das ist Absicht und kein Defekt -- erst im Browser pruefen, ob der Zugang wieder geht,
dann sync.sperre_aufheben(''name'') aufrufen.';
