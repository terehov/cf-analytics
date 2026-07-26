-- =====================================================================
-- 0009 Die BWA bekommt Namen — damit core ganz aus Metabase verschwindet
--
-- ANLASS: Nach dem Ausblenden der core-Tabellen blieb genau EINE sichtbar,
-- core.betrieb. Drei Karten brauchten sie, und alle drei fuer dasselbe:
-- den Betriebsnamen an mart.kennzahlen_aktuell dranzuhaengen.
--
--   FROM mart.kennzahlen_aktuell k
--   JOIN core.betrieb b ON b.betrieb_key = k.betrieb_key
--
-- Das ist nach dem Grundsatz aus docs/metabase.md keine Ausnahme, sondern
-- eine Luecke: "Wer in core joinen muss, um eine Frage zu beantworten, hat
-- eine Luecke in mart gefunden — dann gehoert dort eine Sicht hin."
--
--
-- WARUM EINE NEUE SICHT UND NICHT kennzahlen_aktuell ERWEITERT
--
-- Der erste Entwurf wollte kennzahlen_aktuell per DROP ... CASCADE
-- ersetzen, weil Postgres beim Ersetzen nur das Anhaengen am ENDE der
-- Spaltenliste erlaubt und betrieb/konzept nach vorn gehoerten.
--
-- Vor dem Anwenden nachgemessen, was CASCADE mitreisst -- rekursiv, nicht
-- nur die erste Ebene:
--
--   mart.ampel_bereich          mart.round_table_basis
--   mart.datenstand             mart.round_table_monat
--   mart.pruefung_uebersicht    mart.round_table_trend
--   mart.pruefung_wareneinsatz  mart.standort
--   mart.ursachen_analyse
--
-- Neun Sichten, also praktisch der gesamte Round Table. Sie alle woertlich
-- in dieser Migration wiederherzustellen hiesse, ihre Definitionen aus drei
-- Migrationen zu duplizieren -- und jede kuenftige Aenderung an einer von
-- ihnen muesste an zwei Stellen gepflegt werden. Der erste vergessene
-- Nachzug waere ein stiller Fehler.
--
-- Deshalb bleibt kennzahlen_aktuell unangetastet, und die Namen kommen in
-- eine eigene Sicht daneben. Sie kostet einen Join, den die drei Karten
-- ohnehin gemacht haben -- nur steht er jetzt an einer Stelle statt an drei.
-- =====================================================================

CREATE VIEW mart.bwa_kennzahl AS
SELECT k.betrieb_key,
       b.name          AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       k.monat,
       k.kennzahl,
       k.wert_absolut,
       k.wert_prozent,
       k.abgerufen_am,
       -- Ob der Monat ueberhaupt gebucht ist. Ohne diese Spalte muss jede
       -- Karte die HAVING-Bedingung selbst mitbringen, und genau das ist am
       -- 26.07.2026 einmal vergessen worden: September bis Dezember standen
       -- fuer alle 131 Betriebe auf gruen, weil ungebuchte Monate als 0,00
       -- ankommen und "niedriger ist besser" daraus eine gruene Ampel macht.
       (k.wert_absolut IS NOT NULL AND k.wert_absolut <> 0) AS gebucht
  FROM mart.kennzahlen_aktuell k
  JOIN core.betrieb b                 ON b.betrieb_key  = k.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = k.betrieb_key;

COMMENT ON VIEW mart.bwa_kennzahl IS
'BWA-Kennzahlen mit Betriebsname, Stadt und Marke -- die Sicht, mit der Metabase arbeitet.
Identisch zu mart.kennzahlen_aktuell, nur mit aufgeloesten Namen; wer die Schluessel
braucht, nimmt weiterhin die andere.

ACHTUNG: gebucht = false heisst NICHT "null Umsatz", sondern "der Steuerberater hat diesen
Monat noch nicht gebucht". getKennzahlen liefert immer das ganze Jahr, ungebuchte Monate
als 0,00 statt NULL. Wer darauf nicht filtert, bekommt fuer jeden kuenftigen Monat eine
vollstaendige, gruene und vollstaendig erfundene Auswertung -- am 26.07.2026 einmal
passiert, September bis Dezember fuer alle 131 Betriebe.

Fuer "was wussten wir am Stichtag X" stattdessen direkt core.kennzahlen_monat mit
abgerufen_am <= X abfragen.';
