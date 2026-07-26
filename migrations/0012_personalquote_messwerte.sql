-- ---------------------------------------------------------------------
-- 0012 Der Tabellenkommentar nannte eine zu kleine Zahl
--
-- 0010 hat die Quotenspalten geweitet und dabei als Beleg den hoechsten
-- Wert genannt, der zu diesem Zeitpunkt in der Datenbank stand: 9.079,37
-- Prozent. Das war der hoechste Wert der ueberlebenden Zeilen -- also genau
-- die Auswahl, die NICHT am Ueberlauf gescheitert war. Ein Zirkelschluss.
--
-- Nachdem die 33 reparierten Posten durchgelaufen sind, steht der
-- tatsaechliche Hoechstwert bei 316.576,50 Prozent, dem 35-Fachen der alten
-- Spaltengrenze. Der Fall dahinter ist unspektakulaer und genau der
-- vorhergesagte:
--
--     Enchilada Wuerzburg, 15.06.2026:  6,05 EUR Umsatz -> 316.576,5 %
--     Enchilada Bremen,    23.03.2026:  0,00 EUR Umsatz -> 259.441,5 %
--
-- Der Nenner geht gegen null, die Quote gegen unendlich. Das ist keine
-- Anomalie in den Daten, sondern die Bauart der Kennzahl.
--
-- Warum das als Kommentar in der Datenbank steht und nicht nur in docs/:
-- Metabase zeigt Tabellenkommentare als Beschreibung an. Wer dort einen
-- Mittelwert ueber pek_gesamt bildet, soll die Warnung sehen, bevor er die
-- Zahl weitergibt -- ein einziger solcher Tag verschiebt einen Monatsschnitt
-- um Groessenordnungen.
-- ---------------------------------------------------------------------

COMMENT ON TABLE core.personalkosten IS
'Aus getPersonalkosten. Spaltennamen wie in LINAs Antwort. Alle pek_*/persoog_* sind
Prozentzahlen (37.21 = 37,21 %), alle eff_* sind Effektivitaeten.

ACHTUNG BEI DER GROESSENORDNUNG: Diese Quoten haben den Umsatz im NENNER, und der geht bei
Betrieben ohne Geschaeftsbetrieb gegen null. Gemessen am 26.07.2026 ueber das laufende Jahr:
pek_gesamt bis 316.576,50 Prozent -- Enchilada Wuerzburg am 15.06.2026 bei 6,05 EUR Umsatz.
79 der 141 gefuehrten Betriebe machen ueberhaupt keinen Umsatz (siehe befunde-datenlage.md).

Daraus folgt zweierlei: NIEMALS mitteln, immer den Median nehmen -- ein einziger solcher Tag
verschiebt einen Monatsschnitt um Groessenordnungen. Und wer die Spalte enger macht als
numeric(12,2), verliert ganze Tage an einem numeric field overflow, ohne dass es auffaellt.';
