-- ---------------------------------------------------------------------
-- 0017 Eine Aktionszelle ist ein Objekt, keine Zahl
--
-- ANLASS UND EIGENER FEHLER: 0014 wurde gegen die einzige Antwort gebaut,
-- die zu dem Zeitpunkt im Bestand lag -- den 25.07.2026, an dem ALLE 423
-- Zellen auf null standen. Aus einer leeren Antwort laesst sich die Struktur
-- der gefuellten nicht ablesen. Angenommen war eine Zahl:
--
--   "cells": {"8": 128.40}
--
-- Tatsaechlich liefert LINA ein Objekt, und zwar mit dem Anteil gleich dabei:
--
--   "cells": {"12": {"revenue": 798.15, "percent": 8.73}}
--
-- Die Folge waere ein zweiter stiller Totalausfall gewesen: Number({...}) ist
-- NaN, die Transformation haette jede Zelle verworfen und fuer jeden Tag
-- null Zeilen geschrieben -- bei Status `ok`. Genau der Fehler, den 0014
-- beheben sollte, nur eine Ebene tiefer.
--
-- AUFGEFALLEN IST ES NICHT VON SELBST, sondern beim Nachtransformieren aus
-- raw: "cannot cast jsonb object to type numeric". Die Strukturpruefung hatte
-- es allerdings sehr wohl bemerkt -- 26 Eintraege in sync.schema_abweichung,
-- geschrieben in derselben Viertelstunde. Der Mechanismus funktioniert; nur
-- angesehen hatte sie in dem Moment niemand.
--
-- WAS `percent` IST -- NACHGEMESSEN, NICHT ANGENOMMEN
--
-- Anteil am NETTO-TAGESUMSATZ des Betriebs aus dem POS. Ueber alle 946
-- gefuellten Zellen gegen core.umsatzbericht_tag geprueft: 0 Abweichungen
-- ueber 0,01 Prozentpunkte, keine einzige Zelle ohne Gegenstueck.
--
-- Gespeichert wird trotzdem LINAs Wert und nicht der nachgerechnete -- nach
-- derselben Regel wie bei durchschnittsbon und kennzahlen_monat.wert_prozent:
-- wer selbst rechnet, weicht irgendwann in einem Randfall ab und merkt es
-- nicht. Der Anteil ueber einen MONAT ist etwas anderes und wird weiterhin in
-- mart.aktionsumsatz_monat gerechnet -- LINA liefert nur den Tageswert.
-- ---------------------------------------------------------------------

ALTER TABLE core.aktionsumsatz_tag
    ADD COLUMN anteil_pct numeric(8,2);

COMMENT ON COLUMN core.aktionsumsatz_tag.anteil_pct IS
'LINAs `percent` aus der Zelle: Anteil dieser Aktion am Netto-TAGESUMSATZ des Betriebs.
Kommt fertig gerechnet und wird nicht nachgerechnet -- gegengeprueft ueber 946 Zellen mit
0 Abweichungen. Fuer den Monatsanteil: mart.aktionsumsatz_monat.anteil_pct.';

COMMENT ON TABLE core.aktionsumsatz_tag IS
'Umsatz je Betrieb, Tag und Marketingaktion. Aus getAktionsbericht.rows[].cells, wobei der
Schluessel der Zelle die lina_id der Aktion ist und der WERT EIN OBJEKT:
  {"revenue": 798.15, "percent": 8.73}
Nicht eine blosse Zahl -- siehe Migration 0017, das war schon einmal falsch angenommen.

NUR ZEILEN MIT UMSATZ. Leere und auf null stehende Zellen werden verworfen -- sonst
entstuenden 141 mal (Anzahl Aktionen) Zeilen am Tag, praktisch alle mit NULL. Gemessen ueber
27 Tage: 15.510 Zellen, davon 946 gefuellt. Dieselbe Entscheidung wie bei
core.artikelverkauf_tag, und derselbe Preis: eine fehlende Zeile heisst "keine Aktion an
diesem Tag" UND "Tag nicht geholt". Welcher Fall vorliegt, beantwortet sync.warteschlange.

Netto oder brutto entscheidet das Feld `brutto` IN DER ANTWORT, nicht unser
Anfrageparameter. Wir fragen zwar immer mit brutto=0, aber wer sich auf die eigene Anfrage
verlaesst statt auf die Antwort, beschriftet irgendwann brutto als netto.';


-- ---------------------------------------------------------------------
-- Die Sichten zeigen den Tagesanteil mit
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.aktionsumsatz AS
SELECT au.geschaeftstag,
       date_trunc('month', au.geschaeftstag)::date AS monat,
       b.betrieb_key,
       b.name          AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       a.aktion_key,
       a.name          AS aktion,
       au.umsatz_netto,
       au.umsatz_brutto,
       au.anteil_pct
  FROM core.aktionsumsatz_tag au
  JOIN core.betrieb b                 ON b.betrieb_key  = au.betrieb_key
  JOIN core.aktion  a                 ON a.aktion_key   = au.aktion_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = au.betrieb_key;

COMMENT ON VIEW mart.aktionsumsatz IS
'Aktionsumsaetze mit Namen. Eine Zeile je Betrieb, Tag und Aktion -- und nur dort, wo es
Umsatz gab.

anteil_pct kommt von LINA und ist der Anteil am NETTO-TAGESUMSATZ des Betriebs. Ueber Tage
hinweg darf man ihn NICHT mitteln: das gewichtet einen 900-Euro-Tag wie einen
9.000-Euro-Tag. Fuer den Monat: mart.aktionsumsatz_monat.';
