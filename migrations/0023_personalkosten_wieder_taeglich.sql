-- =====================================================================
-- 0023 Zuruecknahme von 0022: die Personalkosten bleiben tagesgenau
--
-- 0022 hat den Backfill von getPersonalkosten auf Monate umgestellt, um
-- 2.758 Aufrufe auf 91 zu druecken -- der Endpunkt kostet 22,3 s je
-- Antwort und war fuer 38 % der Restlaufzeit verantwortlich.
--
-- Die Rechnung war richtig, die Voraussetzung nicht vollstaendig geprueft.
-- Nachgesehen in der Rohantwort (raw.api_antwort id 6409):
--
--     {"timeframe": "18.07.2025",
--      "stores": [{"name": "...", "effGesamt": 0, "pekGesamt": 0,
--                  "persoogBwa": 0, "pekThreshold": ["28","34","50"], ...}]}
--
-- `timeframe` ist EIN Datum, und `stores[]` traegt flache Werte je
-- Betrieb. Es gibt keine Zeitdimension in der Antwort. Ein Aufruf ueber
-- einen Monat liefert also einen Aggregatwert, KEINE 30 Tageswerte.
--
-- Damit war die Umstellung nicht "gruober abfragen", sondern
-- Datenverlust: `pek_*` und `eff_*` schwanken taeglich -- nachgemessen
-- schwanken sie in 740 von 740 Betrieb-Monaten, ausnahmslos. Sie waeren
-- fuer 2018 bis Juli 2025 auf je einen Monatswert zusammengefallen.
--
-- ENTSCHEIDUNG (Eugene, 27.07.2026): "so genau alle daten wie moeglich".
-- Tagesaufloesung schlaegt Laufzeit. Der Backfill dauert damit wieder
-- rund drei statt 1,65 Tage. Das ist der Preis, und er ist es wert:
-- Laufzeit vergeht, verlorene Aufloesung nicht -- sie liesse sich nur
-- durch einen zweiten Backfill zurueckholen, also durch dieselben 2.758
-- Aufrufe noch einmal.
--
-- WAS BLEIBT: `persoog_bwa` ist tatsaechlich in jedem Monat konstant
-- (714 von 714 Betrieb-Monaten ohne jede Schwankung). Das ist ein
-- korrekter Befund und bleibt in der Doku -- er traegt nur die
-- Umstellung nicht, weil dieselbe Antwort eben auch die taeglichen
-- Effektivitaeten enthaelt. Ein Feld war monatlich, sieben nicht.
-- =====================================================================

DO $$
DECLARE
    v_weg  integer;
    v_neu  integer;
BEGIN
    -- Die Monatsposten wieder heraus. Keiner von ihnen ist gelaufen --
    -- geprueft ueber sync.aufgabe, dort steht kein einziger Eintrag mit
    -- zeitraum_von <> zeitraum_bis. Es wurde also nichts geholt, was jetzt
    -- verwaisen wuerde.
    WITH weg AS (
        DELETE FROM sync.warteschlange
         WHERE endpunkt = 'getPersonalkosten'
           AND erledigt_am IS NULL
           AND zeitraum_von <> zeitraum_bis
        RETURNING 1
    ) SELECT count(*) INTO v_weg FROM weg;

    -- Und die Tagesposten zurueck. historie_einreihen() prueft gegen ALLE
    -- Posten, erledigte eingeschlossen -- die 373 bereits geholten Tage
    -- (18.07.2025 bis 25.07.2026) werden also nicht erneut eingereiht.
    SELECT sync.historie_einreihen('getPersonalkosten', '2018-01-01'::date,
                                   '2025-07-31'::date, 'tag')
      INTO v_neu;

    RAISE NOTICE '% Monatsposten entfernt, % Tagesposten wieder eingereiht', v_weg, v_neu;
END $$;


COMMENT ON TABLE core.personalkosten IS
'Aus getPersonalkosten. Spaltennamen wie in LINAs Antwort. Alle pek_*/persoog_* sind
Prozentzahlen (37.21 = 37,21 %), alle eff_* sind Effektivitaeten.
Eine Zeile je Betrieb und TAG -- zeitraum_von = zeitraum_bis, ausnahmslos.

ACHTUNG BEIM MITTELN: pek_* und persoog_* sind Quoten auf den Umsatz. Betriebe ohne
nennenswerten Umsatz erzeugen dreistellige Prozentwerte -- gemessen bis 316.576 % bei
6,05 EUR Tagesumsatz. Ein ungefilterter Mittelwert ueber alle Zeilen ist damit wertlos.
Immer gegen einen Umsatzfilter rechnen; mart.personalkosten_warnung nennt die Zahlen.

persoog_bwa ist ein BWA-MONATSWERT, den LINA ueber alle Tage des Monats auswalzt --
714 von 714 Betrieb-Monaten ohne jede Schwankung. Wer ihn monatlich braucht, nimmt
einen beliebigen Tag des Monats, nicht den Durchschnitt ueber die Tage: der waere
derselbe Wert, aber die Rechnung suggeriert eine Genauigkeit, die es nicht gibt.
pek_* und eff_* schwanken dagegen taeglich, in 740 von 740 Betrieb-Monaten.';
