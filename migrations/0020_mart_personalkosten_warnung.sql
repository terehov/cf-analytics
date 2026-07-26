-- ---------------------------------------------------------------------
-- 0020 Die Groessenordnungs-Warnung gehoert dorthin, wo sie gelesen wird
--
-- ANLASS: 0012 hat den Tabellenkommentar von core.personalkosten um die
-- Warnung ergaenzt, dass die Quoten den Umsatz im Nenner haben und bei
-- umsatzlosen Betrieben ins Sechsstellige gehen (gemessen: 316.576,50 %
-- bei 6,05 EUR Tagesumsatz).
--
-- Nur steht diese Warnung an einer Stelle, die in Metabase NIEMAND SIEHT:
-- core ist seit dem 26.07.2026 vollstaendig ausgeblendet (siehe
-- docs/metabase-sichtbarkeit.md). Sichtbar ist mart.personalkosten -- und
-- deren Kommentar erklaerte zwar sorgfaeltig, dass man nicht ueber
-- Zeitraeume summieren darf, sagte aber nichts ueber die Groessenordnung.
--
-- Das ist genau die Sorte Luecke, gegen die der Kommentar in 0012
-- geschrieben wurde: die Warnung existiert, sie steht nur im falschen
-- Fenster. Wer in Metabase einen Mittelwert ueber pek_gesamt bildet, sieht
-- die Beschreibung der SICHT, nicht die der Tabelle darunter.
--
-- Nachgemessen am 26.07.2026 ueber alle Tageswerte mit Umsatz:
--     Mittelwert ungefiltert  610,7 %
--     Median                  383,4 %
--     Mittelwert <= 200 %     113,0 %
-- Selbst der Median ist verzogen, weil ueber die Haelfte der gefuehrten
-- Betriebe keinen nennenswerten Umsatz macht. Fuer eine belastbare Aussage
-- reicht "nimm den Median" hier nicht -- es braucht zusaetzlich einen
-- Umsatzfilter.
-- ---------------------------------------------------------------------

COMMENT ON VIEW mart.personalkosten IS
'Personalkostenquoten und Effektivitaeten je Betrieb und Zeitraum, gesamt und je Bereich
(Service, Bar, Kueche) — die Berichte "Personalkosten/Effektivitaet" und "... pro Bereich".

pek_* sind Quoten in Prozent, eff_* ist Umsatz je Personalstunde in Euro. Beide heissen im
LINA-Bericht "Effektivitaet"; wer sie in ein Diagramm legt, bekommt zwei Achsen.

ACHTUNG BEI DER GROESSENORDNUNG. Diese Quoten haben den Umsatz im NENNER, und der geht bei
Betrieben ohne Geschaeftsbetrieb gegen null. Gemessen am 26.07.2026: pek_gesamt bis
316.576,50 Prozent — Enchilada Wuerzburg am 15.06.2026 bei 6,05 EUR Tagesumsatz. Das ist keine
Anomalie in den Daten, sondern die Bauart der Kennzahl.

Ein einziger solcher Tag verschiebt einen Mittelwert um Groessenordnungen: ueber alle
Tageswerte liegt der Mittelwert bei 610,7 Prozent, der Median bei 383,4 — und beide sind
unbrauchbar. Erst mit einem Umsatzfilter wird die Zahl plausibel (113,0 Prozent bei
pek_gesamt <= 200).

Fuer Auswertungen deshalb: den MEDIAN nehmen UND Betriebe ohne Umsatz ausschliessen. Welche das
sind, zeigt die Karte "Betriebe ohne laufendes Geschaeft" auf dem Dashboard "Portfolio und
Potenzial"; die Hintergruende stehen in docs/befunde-datenlage.md.

NICHT UEBER ZEITRAEUME SUMMIEREN. Ein Posten deckt zeitraum_von bis zeitraum_bis ab, und die
Zeitraeume koennen sich zwischen Tages- und Monatsabruf ueberlappen. Fuer einen Monatswert
den Posten mit dem passenden Zeitraum nehmen, nicht die Tage addieren — Quoten und
Stundenwerte sind ohnehin nicht additiv.

persoog_bwa ist die Groesse, auf der die Round-Table-Ampel Personal beruht.
schwelle_*_lina sind die betriebsindividuellen Schwellen aus LINA und meist ANDERE als die
28/32 des Excel-Regelblatts; ampel_global und ampel_lina zeigen den Unterschied nebeneinander.';
