-- =====================================================================
-- Korrektur einer Kommentaraussage, nicht der Struktur
--
-- In 0000 stand als Begruendung fuer core.betrieb_konzept:
--   "Karlsruhe existiert als Enchilada, Aposto, Lehners, Besitos und
--    Wilma Wunder"
-- Das war die richtige Beobachtung mit der falschen Schlussfolgerung.
--
-- Was tatsaechlich beobachtet wurde: der NAME "Karlsruhe" taucht in fuenf
-- Konzeptgruppen auf. In getKennzahlen liefert die Gruppe die Marke, das
-- Kind traegt nur die Stadt - "Enchilada Karlsruhe" heisst dort unter der
-- Gruppe Enchilada schlicht "Karlsruhe". Fuenf Restaurants in einer Stadt,
-- nicht ein Restaurant in fuenf Marken.
--
-- Gegenprobe aus den Zahlen: der verifizierte Juniumsatz von "Karlsruhe"
-- unter Enchilada betraegt 136.612,46 EUR und stimmt auf den Cent mit der
-- Excel-Zeile "Enchilada Karlsruhe". Waere es ein gemeinsamer Betrieb aller
-- fuenf Marken, muesste dort ein Vielfaches stehen.
--
-- Die Struktur bleibt trotzdem n:m. Erstens ist es endgueltig erst mit
-- echten Daten pruefbar (die anonymisierten Fixtures enthalten nur eine
-- Gruppe), zweitens gibt es mit "Eat Tasty" mindestens einen Fall, bei dem
-- eine Mehrfachzuordnung fachlich plausibel ist. Eine n:m-Tabelle, die nur
-- 1:1-Zeilen enthaelt, kostet nichts; eine 1:n-Spalte, die einen echten
-- Mehrfachfall nicht abbilden kann, kostet eine Migration unter Zeitdruck.
--
-- Pruefung, sobald Betriebe geladen sind - eine Zeile mit anzahl = 1
-- bedeutet: faktisch 1:n, Annahme bestaetigt.
--
--   SELECT anzahl_konzepte, count(*) AS betriebe
--     FROM mart.konzept_zuordnung GROUP BY 1 ORDER BY 1;
-- =====================================================================

COMMENT ON TABLE core.betrieb_konzept IS
'Zuordnung Betrieb zu Konzept (Marke).

Erwartung: faktisch 1:n - ein Aposto ist ein Aposto. Als n:m modelliert, weil
LINA es nicht ausschliesst und "Eat Tasty" ein plausibler Mehrfachfall ist.

ACHTUNG BEIM JOINEN: in getKennzahlen liefert die GRUPPE die Marke, das Kind
traegt nur die Stadt. Der Betriebsname ist deshalb NICHT eindeutig - "Karlsruhe"
existiert fuenfmal, je einmal unter Enchilada, Aposto, Lehners, Besitos und
Wilma Wunder. Immer ueber core.betrieb.enc_id joinen, nie ueber den Namen.

Pruefstand: SELECT anzahl_konzepte, count(*) FROM mart.konzept_zuordnung GROUP BY 1;';

COMMENT ON COLUMN core.betrieb.name IS
'Betriebsname wie LINA ihn liefert - haeufig nur die Stadt, weil die Marke aus
der Konzeptgruppe kommt. NICHT eindeutig: mehrere Betriebe heissen "Karlsruhe".
Fuer die Anzeige Konzept und Name zusammensetzen, fuers Joinen enc_id nehmen.';
