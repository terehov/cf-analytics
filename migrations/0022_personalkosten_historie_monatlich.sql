-- =====================================================================
-- 0022 Die Personalkosten-Historie laeuft monatsweise
--
-- BEFUND vom 27.07.2026, am laufenden Backfill gemessen. Von 13,9
-- Sekunden je Posten entfielen 8,5 s auf unsere Wartepause und 5,1 s auf
-- LINAs Antwortzeit. Aufgeschluesselt nach Endpunkt:
--
--     getPersonalkosten                  151 Aufrufe   22.272 ms   3.363 s
--     getArtikelverkaufsbericht          151 Aufrufe    5.378 ms     812 s
--     getAktionsbericht                  151 Aufrufe      952 ms     144 s
--     getVordefinierteZeitzonenBericht   152 Aufrufe      665 ms     101 s
--     getZeitzonenbericht                151 Aufrufe      635 ms      96 s
--     getUmsatzbericht:getraenke         152 Aufrufe      543 ms      83 s
--
-- Ein Endpunkt verbrauchte 73 % der gesamten Wartezeit auf LINA -- mit
-- 17 % der Aufrufe. Hochgerechnet auf die 2.758 offenen Posten: 23,6 von
-- 72 Stunden Restlaufzeit, also 38 %.
--
-- UND ER LIEFERT DABEI 30 MAL DASSELBE. `persoog_bwa` ist die Kennzahl,
-- die den Round Table traegt, und sie ist an jedem Tag eines Monats
-- identisch -- ein BWA-Monatswert, den LINA ueber den Monat auswalzt.
-- Nachgesehen fuer Betrieb 45:
--
--     23.06.  24.06.  25.06.  26.06.  27.06.  28.06.  29.06.  30.06.
--      42,51   42,51   42,51   42,51   42,51   42,51   42,51   42,51
--
-- WAS VERLOREN GEHT, ehrlich benannt: `pek_*` und `eff_*`
-- (Personaleffektivitaet) schwanken sehr wohl taeglich und speisen
-- mart.personalkosten. Fuer die Historie ist das vertretbar -- ein
-- Tagesprofil der Personaleffektivitaet aus 2019 wertet niemand aus, und
-- der Round Table rechnet ohnehin monatlich. Der TAEGLICHE Lauf bleibt
-- unveraendert tagesgenau; umgestellt wird nur der Backfill.
--
-- Diese Migration stellt die bereits eingereihten offenen Posten um. Die
-- Regel dafuer steht als `historieSchrittweite` im Berichtsregister
-- (src/lina/endpunkte.ts) und gilt fuer kuenftige Einreihungen.
--
-- Die Last auf LINA sinkt dadurch, sie steigt nicht: 2.758 Aufrufe
-- werden zu rund 100.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Nur OFFENE Posten. Erledigte bleiben, wie sie sind -- ihre Tageszeilen
-- stehen in core.personalkosten und sollen dort bleiben.
--
-- Der Primaerschluessel von core.personalkosten ist
-- (betrieb_key, zeitraum_von, zeitraum_bis). Eine Monatszeile
-- (01.03.-31.03.) kollidiert also nicht mit einer Tageszeile
-- (01.03.-01.03.), sondern steht daneben. Nichts wird ueberschrieben.
-- ---------------------------------------------------------------------

DO $$
DECLARE
    v_geloescht integer;
    v_neu       integer;
    v_von       date;
    v_bis       date;
BEGIN
    SELECT min(zeitraum_von), max(zeitraum_von) INTO v_von, v_bis
      FROM sync.warteschlange
     WHERE endpunkt = 'getPersonalkosten'
       AND erledigt_am IS NULL
       AND zeitraum_von = zeitraum_bis;      -- nur Tagesposten

    IF v_von IS NULL THEN
        RAISE NOTICE 'Keine offenen Tagesposten fuer getPersonalkosten -- nichts zu tun.';
        RETURN;
    END IF;

    WITH weg AS (
        DELETE FROM sync.warteschlange
         WHERE endpunkt = 'getPersonalkosten'
           AND erledigt_am IS NULL
           AND zeitraum_von = zeitraum_bis
        RETURNING 1
    ) SELECT count(*) INTO v_geloescht FROM weg;

    -- Monatsposten ueber denselben Bereich. Der letzte Monat wird auf sein
    -- echtes Ende gesetzt, nicht auf den Tag, an dem der Bereich zufaellig
    -- endete -- sonst fehlte der Rest des Monats fuer immer.
    WITH monate AS (
        SELECT d::date AS anfang,
               (d + interval '1 month - 1 day')::date AS ende
          FROM generate_series(date_trunc('month', v_von),
                               date_trunc('month', v_bis), interval '1 month') d
    ), neu AS (
        INSERT INTO sync.warteschlange (endpunkt, zeitraum_von, zeitraum_bis, prioritaet)
        SELECT 'getPersonalkosten', m.anfang, m.ende, 90
          FROM monate m
         WHERE NOT EXISTS (
               SELECT 1 FROM sync.warteschlange w
                WHERE w.endpunkt = 'getPersonalkosten'
                  AND w.zeitraum_von = m.anfang
                  AND w.zeitraum_bis = m.ende)
        RETURNING 1
    ) SELECT count(*) INTO v_neu FROM neu;

    RAISE NOTICE 'getPersonalkosten: % Tagesposten entfernt, % Monatsposten eingereiht (% bis %)',
                 v_geloescht, v_neu, v_von, v_bis;
END $$;


COMMENT ON TABLE core.personalkosten IS
'Aus getPersonalkosten. Spaltennamen wie in LINAs Antwort. Alle pek_*/persoog_* sind
Prozentzahlen (37.21 = 37,21 %), alle eff_* sind Effektivitaeten.

ACHTUNG BEIM MITTELN: pek_* und persoog_* sind Quoten auf den Umsatz. Betriebe ohne
nennenswerten Umsatz erzeugen dreistellige Prozentwerte -- gemessen bis 316.576 % bei
6,05 EUR Tagesumsatz. Ein ungefilterter Mittelwert ueber alle Zeilen ist damit wertlos.
Immer gegen einen Umsatzfilter rechnen; mart.personalkosten_warnung nennt die Zahlen.

ZWEI ZEITRASTER seit Migration 0022: Zeilen mit zeitraum_von = zeitraum_bis sind
Tageswerte aus dem laufenden Betrieb. Zeilen ueber einen ganzen Monat stammen aus dem
Backfill -- fuer die Historie holt der Importer Monate statt Tage, weil persoog_bwa
ohnehin ein BWA-Monatswert ist und an jedem Tag des Monats denselben Wert traegt.
Wer ueber diese Tabelle rechnet, muss sich fuer EIN Raster entscheiden, sonst zaehlt
derselbe Monat doppelt.';
