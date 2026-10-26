-- =====================================================================
-- 0138 — Die Stunden 0–7 stehen auf dem Geschaeftstag, zu dem sie gehoeren
-- =====================================================================
--
-- DER FEHLER (gefunden 26.10.2026 ueber mart.umsatz_stunde_sparte_pruefung
-- aus 0137, die 29 % der Tage als „weicht ab" meldete):
--
-- LINAs Zeitzonenbericht fuer den Tag D IST der Geschaeftstag D. Sein
-- hours-Array [8,9,…,23,0,…,7] endet mit dem Morgen von D+1. Der Lader zog
-- die Stunden 0–7 trotzdem noch einmal auf D−1 (geschaeftstagFuerStunde() in
-- src/lib/time.ts) — er rechnete die Tagesgrenze ein zweites Mal ein.
--
-- Folge seit dem ersten Abruf: die Nacht stand einen Tag zu frueh. Die
-- Samstagnacht eines Betriebs stand beim Freitag, die Nacht des Freitags beim
-- Donnerstag. Monatssummen stimmen bis auf die Raender, Tageswerte, Wochentage
-- und jedes Fenster ueber Mitternacht („ab 20 Uhr") nicht.
--
-- GEMESSEN (26.10.2026, Produktion, alle Betrieb-Tage 2026 mit Umsatz):
-- Summe der 24 Stunden gegen core.umsatzbericht_tag (Gesamtzeile), 5 Cent:
--   heute                                   8.254 von 16.309 treffen
--   Stunden 0–7 einen Tag spaeter gezaehlt  16.309 von 16.309 treffen
-- Beispiel Aposto Karlsruhe, 17.10.2026 (Samstag): 1.353,14 EUR nach
-- Mitternacht standen auf dem 16.10.; der 17.10. lag genau so viel unter dem
-- Umsatzbericht.
--
-- DIE KORREKTUR ist eine Verschiebung, kein Neuladen: jede Zeile mit
-- stunde < 8 stammt aus der Antwort fuer geschaeftstag + 1 und gehoert genau
-- dorthin. Das gilt fuer jede Zeile, weil alle mit derselben Funktion
-- geschrieben wurden — auch dort, wo ein Nachbartag fehlt. raw_id bleibt,
-- was sie war: die Antwort, aus der die Zeile kommt.
--
-- WARUM LOESCHEN UND EINFUEGEN statt UPDATE geschaeftstag + 1: der
-- Primaerschluessel wird zeilenweise geprueft, nicht am Ende der Anweisung.
-- Ein UPDATE stiesse mitten im Lauf auf die Zeile des Folgetags, die selbst
-- noch nicht verschoben ist.
--
-- Umfang am 26.10.2026: 3.632.072 von 10.896.216 Zeilen in der Gesamttabelle,
-- 7.212.800 von 21.638.400 in der Spartentabelle. Keine materialisierte Sicht
-- liest eine der beiden Tabellen (gemessen ueber pg_depend); die sieben Sichten
-- darauf rechnen live und sind ab dem Commit richtig.
-- =====================================================================

-- Gesamttabelle ------------------------------------------------------------
CREATE TEMP TABLE _nacht_gesamt ON COMMIT DROP AS
SELECT betrieb_key, geschaeftstag + 1 AS geschaeftstag, stunde, umsatz_netto, raw_id, geladen_am
  FROM core.zeitzonenbericht_stunde
 WHERE stunde < 8;

DELETE FROM core.zeitzonenbericht_stunde WHERE stunde < 8;

INSERT INTO core.zeitzonenbericht_stunde (betrieb_key, geschaeftstag, stunde, umsatz_netto, raw_id, geladen_am)
SELECT betrieb_key, geschaeftstag, stunde, umsatz_netto, raw_id, geladen_am
  FROM _nacht_gesamt;

-- Spartentabelle (0137) ----------------------------------------------------
CREATE TEMP TABLE _nacht_sparte ON COMMIT DROP AS
SELECT betrieb_key, geschaeftstag + 1 AS geschaeftstag, stunde, hauptsparte_key, umsatz_netto, raw_id, geladen_am
  FROM core.zeitzonenbericht_stunde_sparte
 WHERE stunde < 8;

DELETE FROM core.zeitzonenbericht_stunde_sparte WHERE stunde < 8;

INSERT INTO core.zeitzonenbericht_stunde_sparte
       (betrieb_key, geschaeftstag, stunde, hauptsparte_key, umsatz_netto, raw_id, geladen_am)
SELECT betrieb_key, geschaeftstag, stunde, hauptsparte_key, umsatz_netto, raw_id, geladen_am
  FROM _nacht_sparte;

-- Nach der Verschiebung muss jeder Tag des laufenden Jahres, an dem beide
-- Berichte Umsatz kennen, auf 5 Cent treffen. Liegt die Quote darunter, war
-- die Annahme falsch — dann lieber abbrechen als 10 Mio. Zeilen falsch
-- verschoben lassen. (Auf einer Testdatenbank ohne Zahlen 2026 greift nichts.)
DO $$
DECLARE v_tage int; v_treffer int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE abs(s.summe - u.umsatz_netto) <= 0.05)
    INTO v_tage, v_treffer
    FROM (SELECT betrieb_key, geschaeftstag, sum(umsatz_netto) AS summe
            FROM core.zeitzonenbericht_stunde
           WHERE geschaeftstag BETWEEN DATE '2026-01-01' AND DATE '2026-10-24'
           GROUP BY 1, 2) s
    JOIN core.umsatzbericht_tag u
      ON u.betrieb_key = s.betrieb_key AND u.geschaeftstag = s.geschaeftstag
     AND u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
   WHERE u.umsatz_netto <> 0;
  IF v_tage > 1000 AND v_treffer < v_tage * 0.99 THEN
    RAISE EXCEPTION '0138: nach der Verschiebung treffen nur % von % Betrieb-Tagen den Umsatzbericht — Annahme pruefen, nichts uebernommen', v_treffer, v_tage;
  END IF;
  RAISE NOTICE '0138: % von % Betrieb-Tagen 2026 treffen den Umsatzbericht', v_treffer, v_tage;
END $$;

COMMENT ON TABLE core.zeitzonenbericht_stunde IS
'Aus getZeitzonenbericht. Der Geschaeftstag laeuft 08:00 bis 07:59 des Folgetags. Die Antwort fuer den Tag D ist der Geschaeftstag D; ihre Stunden 0-7 sind der Morgen von D+1 und stehen auf D, an seinem Ende. Nach stunde sortiert ergibt deshalb keinen zeitlichen Verlauf ((stunde + 16) % 24). Bis 0138 (26.10.2026) standen die Stunden 0-7 einen Tag zu frueh.';

COMMENT ON TABLE core.zeitzonenbericht_stunde_sparte IS
'Aus getZeitzonenbericht mit hauptsparten=<posId> (0137): Umsatz je Betrieb, Geschaeftstag, Stunde
UND Hauptsparte. Geholt werden Speisen (10001) und Getraenke (10002); die Summe beider ist deshalb
kleiner als die Gesamtzeile in core.zeitzonenbericht_stunde (Gutscheine, Pfand, Trinkgeld fehlen).
Der Geschaeftstag laeuft 08:00 bis 07:59 des Folgetags; die Antwort fuer den Tag D ist der
Geschaeftstag D, ihre Stunden 0-7 stehen an seinem Ende (seit 0138, 26.10.2026 — vorher einen Tag
zu frueh). NICHT mit core.zeitzonenbericht_stunde addieren — das ist derselbe Umsatz, einmal gesamt
und einmal nach Sparte.';
