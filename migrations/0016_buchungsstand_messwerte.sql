-- ---------------------------------------------------------------------
-- 0016 Die 72 waren zwei verschiedene Zustaende
--
-- 0015 nennt in den Kommentaren "72 von 141 haben nie eine BWA geliefert".
-- Die Zahl stammt aus einer Abfrage, die genau die Unterscheidung nicht
-- machte, um die es in dieser Tabelle geht: ein LEFT JOIN auf die gebuchten
-- Monate liefert NULL sowohl fuer "kam vor, nie gebucht" als auch fuer "kam
-- in keiner Antwort vor".
--
-- Nach dem ersten Fuellen am 26.07.2026 auseinandergezogen:
--
--   nie gebucht     62   kamen in getKennzahlen vor, ohne je eine gebuchte BWA
--   im Rueckstand   46   davon 8 mehr als einen Monat hinter der Spitze
--   aktuell         23   auf Hoehe der Spitze (Juni 2026)
--   ungeprueft      10   kamen in keiner getKennzahlen-Antwort vor
--
-- Die zehn "ungeprueft" sind kein Randfall, sondern der Beleg dafuer, dass
-- die dritte Stufe noetig ist: 141 Betriebe stehen in core.betrieb, nur 131
-- tauchen in der BWA ueberhaupt auf. Haetten wir NULL und "keine Zeile"
-- zusammengeworfen, saehen diese zehn aus wie Betriebe ohne BWA-Anbindung --
-- und niemand haette je nachgesehen, warum sie fehlen.
-- ---------------------------------------------------------------------

COMMENT ON TABLE core.bwa_buchungsstand IS
'Je Betrieb der juengste Monat, fuer den je eine BWA gebucht war -- ein HOECHSTSTAND, er
sinkt nie. Geschrieben von src/sync/laden.ts nach jedem getKennzahlen-Posten.

GEBUCHT heisst: mindestens eine Kennzahl mit wert_absolut IS NOT NULL AND <> 0. Wortgleich
mit der Bedingung in mart.round_table_basis -- zwei Definitionen von "gebucht" waeren zwei
Wahrheiten.

DREI ZUSTAENDE, und alle drei werden gebraucht (gemessen am 26.07.2026, 141 Betriebe):
  letzter_monat gesetzt   69   hat schon einmal eine BWA geliefert
  letzter_monat IS NULL   62   kam in getKennzahlen vor, nie etwas gebucht -- KEIN Alarm
  keine Zeile             10   kam in keiner getKennzahlen-Antwort vor

Genau diese Unterscheidung ist der Zweck der Tabelle: sonst schlaegt die
Plausibilitaetspruefung jeden Monatsanfang grundlos an, und die zehn Betriebe, die in der
BWA gar nicht auftauchen, saehen aus wie Betriebe ohne Buchung.

Auswertung: mart.bwa_rueckstand.';

COMMENT ON VIEW mart.bwa_rueckstand IS
'Wer bei der BWA hinterherhaengt -- und wer nie eine hatte.

Der Massstab ist die SPITZE der Gruppe, nicht der Kalender: verglichen wird mit dem
juengsten Monat, den irgendein Betrieb gebucht hat. Ein Steuerberater, der generell spaet
dran ist, erzeugt so keinen Befund.

lage, mit den Zahlen vom 26.07.2026:
  aktuell        23  auf Hoehe der Spitze (Juni 2026)
  im Rueckstand  46  gebucht, aber aelter als die Spitze
  nie gebucht    62  hatte noch nie eine BWA. KEIN Fehler, es gibt Betriebe ohne
                     BWA-Anbindung
  ungeprueft     10  noch kein getKennzahlen-Posten hat diesen Betrieb angefasst

auffaellig ist die Zeile fuer das Monitoring: mehr als einen Monat hinter der Spitze. Ein
Monat Rueckstand ist der Normalfall (38 von 69 buchenden Betrieben), zwei sind es nicht --
gemessen trifft die Schwelle 8 Betriebe.';
