-- ---------------------------------------------------------------------
-- 0010 Personalkosten: die Prozentspalten waren zu schmal
--
-- ANLASS: Beim Backfill scheiterten 33 Posten an
-- „numeric field overflow". Die Quotenspalten stehen auf numeric(6,2),
-- fassen also hoechstens 9.999,99 -- und in den echten Daten steht bereits
-- ein pekGesamt von 9.079,37.
--
-- Das ist kein Ausreisser, sondern die Bauart der Kennzahl: eine Quote ist
-- Kosten durch Umsatz, und der Umsatz geht bei den Karteileichen im Bestand
-- gegen null. 79 der 141 gefuehrten Betriebe machen ueberhaupt keinen
-- Umsatz (siehe befunde-datenlage.md). Bei einem Betrieb mit ein paar Euro
-- Umsatz und normalen Personalkosten wird die Quote beliebig gross. Eine
-- Obergrenze von 9.999,99 % ist damit schlicht falsch angenommen.
--
-- WARUM DAS SCHLIMMER IST, ALS ES AUSSIEHT
--
-- `laden()` schreibt Rohantwort und core in EINER Transaktion. Scheitert die
-- Transformation, rollt auch der Raw-Layer zurueck -- die Versicherung greift
-- also ausgerechnet dann nicht, wenn man sie braeuchte. Der ueberzaehlige
-- Wert liess sich hinterher nicht einmal mehr nachsehen; er ist mit der
-- Transaktion verschwunden.
--
-- Und der Posten kommt in Wiedervorlage. Nach MAX_VERSUCHE (4) waere er
-- `aufgegeben` -- 33 Tage Personalkosten dauerhaft weg, ohne Alarm, nur eine
-- Luecke. Rechtzeitig aufgefallen: alle 33 standen erst bei Versuch 1.
--
-- Die eff_*-Spalten bekommen dieselbe Breite. Sie sind heute unauffaellig
-- (Hoechstwert 3.291,41), haben aber genau denselben Nenner und damit genau
-- dieselbe Bauart.
-- ---------------------------------------------------------------------

-- Postgres laesst den Typ einer Spalte nicht aendern, solange eine Sicht
-- darauf zeigt. Die abhaengigen Sichten werden deshalb aus dem Katalog
-- gesichert, abgeraeumt und WORTGLEICH wiederhergestellt -- samt Kommentar.
-- Bewusst nicht von Hand abgeschrieben: die Sichten stammen aus paralleler
-- Arbeit, und eine hier eingefrorene Kopie waere beim naechsten Aufsetzen
-- der Datenbank ein stiller Rueckschritt.
DO $$
DECLARE
    v_sichten text[] := ARRAY['mart.personalkosten', 'mart.datenstand'];
    v_name    text;
    v_def     text[] := '{}';
    v_komm    text[] := '{}';
    i         int;
BEGIN
    FOREACH v_name IN ARRAY v_sichten LOOP
        IF to_regclass(v_name) IS NULL THEN
            v_def := v_def || ''; v_komm := v_komm || '';
            CONTINUE;
        END IF;
        v_def  := v_def  || pg_get_viewdef(v_name::regclass, true);
        v_komm := v_komm || coalesce(obj_description(v_name::regclass, 'pg_class'), '');
        EXECUTE format('DROP VIEW %s', v_name);
    END LOOP;

    EXECUTE $sql$
        ALTER TABLE core.personalkosten
            ALTER COLUMN pek_service TYPE numeric(12,2),
            ALTER COLUMN pek_bar     TYPE numeric(12,2),
            ALTER COLUMN pek_kueche  TYPE numeric(12,2),
            ALTER COLUMN pek_gesamt  TYPE numeric(12,2),
            ALTER COLUMN persoog_bwa TYPE numeric(12,2),
            ALTER COLUMN eff_service TYPE numeric(12,2),
            ALTER COLUMN eff_bar     TYPE numeric(12,2),
            ALTER COLUMN eff_kueche  TYPE numeric(12,2),
            ALTER COLUMN eff_gesamt  TYPE numeric(12,2)
    $sql$;
    EXECUTE $sql$
        ALTER TABLE core.schwellenwert_betrieb
            ALTER COLUMN schwelle_gruen  TYPE numeric(12,2),
            ALTER COLUMN schwelle_orange TYPE numeric(12,2),
            ALTER COLUMN schwelle_rot    TYPE numeric(12,2)
    $sql$;

    -- Rueckwaerts wiederherstellen: mart.datenstand koennte auf
    -- mart.personalkosten aufsetzen.
    FOR i IN REVERSE array_length(v_sichten, 1) .. 1 LOOP
        IF v_def[i] IS NULL OR v_def[i] = '' THEN CONTINUE; END IF;
        EXECUTE format('CREATE VIEW %s AS %s', v_sichten[i], v_def[i]);
        IF v_komm[i] <> '' THEN
            EXECUTE format('COMMENT ON VIEW %s IS %L', v_sichten[i], v_komm[i]);
        END IF;
    END LOOP;
END $$;

COMMENT ON TABLE core.personalkosten IS
'Aus getPersonalkosten. Spaltennamen wie in LINAs Antwort. Alle pek_*/persoog_* sind
Prozentzahlen (37.21 = 37,21 %), alle eff_* sind Effektivitaeten.

ACHTUNG BEI DER GROESSENORDNUNG: Diese Quoten haben den Umsatz im Nenner, und der geht bei
Betrieben ohne Geschaeftsbetrieb gegen null. Gemessen am 26.07.2026: pek_gesamt bis
9.079,37 Prozent. Wer hier mittelt statt den Median zu nehmen, bekommt Unsinn -- und wer
die Spalte enger macht, verliert ganze Tage an einem numeric field overflow.';

COMMENT ON COLUMN core.personalkosten.persoog_bwa IS
'LINAs persoogBwa: Personalkosten ohne GF laut BWA, in Prozent. Entspricht der
Excel-Spalte "Personal-kosten o. GF %". Bis 1.132,51 gemessen.';


-- ---------------------------------------------------------------------
-- Die gescheiterten Posten zurueck in die Schlange
--
-- Sie sind an uns gescheitert, nicht an LINA. Der verbrauchte Versuch
-- gehoert deshalb zurueck, sonst zaehlt er auf MAX_VERSUCHE mit.
-- ---------------------------------------------------------------------

UPDATE sync.warteschlange
   SET versuche = 0, faellig_ab = now(), letzter_fehler = NULL,
       erledigt_am = NULL, ergebnis = NULL
 WHERE endpunkt = 'getPersonalkosten'
   AND (letzter_fehler LIKE '%numeric field overflow%'
        OR (ergebnis = 'aufgegeben' AND letzter_fehler LIKE '%overflow%'));
