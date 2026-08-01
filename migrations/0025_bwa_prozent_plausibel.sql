-- ---------------------------------------------------------------------
-- 0025 BWA-Prozentwerte: unplausibel heisst NULL, nicht "gruen"
--
-- ANLASS: 0024 hat die Spalte verbreitert, damit der Import nicht mehr an
-- „numeric field overflow" scheitert. Damit war der Import gerettet und die
-- eigentliche Frage offen: diese Zahlen sind als Kennzahl wertlos.
--
-- Nachgerechnet am schlimmsten Fall (Aposto Muenchen, Dezember 2019,
-- Betrieb geschlossen):
--
--     EBIT -24.809,18 EUR / Umsatz -0,34 EUR = 7.296.817,6 %
--
-- Das ist auf die Nachkommastelle LINAs Wert. Die Zahl ist also NICHT
-- kaputt -- sie ist richtig gerechnet und trotzdem unbrauchbar. Eine Quote
-- gegen 34 Cent Umsatz sagt nichts ueber den Betrieb.
--
-- WARUM DAS NICHT NUR HAESSLICH IST, SONDERN FALSCH
--
-- mart.ampel_bereich reicht diese Werte ungefiltert an die Ampel weiter.
-- Gemessen am 01.08.2026 stand dort:
--
--     Aposto Mainz, 02/2021, Personal  -1.272.960,53 %  ->  Ampel GRUEN
--     Park Cafe Muenchen, 04/2022, Umsatz  723.757,29 %  ->  Ampel GRUEN
--
-- Eine Personalkostenquote von minus 1,3 Millionen Prozent wird im Round
-- Table als gesunder Betrieb angezeigt. Das ist schlimmer als ein
-- abgebrochener Import: der Import faellt auf, die gruene Ampel nicht.
--
-- DIE GRENZE: 1.000 %
--
-- Verteilung ueber alle 14.148 Zeilen je Kennzahl (01.08.2026):
--
--                          >100%   >200%   >1000%
--     EBIT                    565     390      242
--     Personalkosten o. GF    352     239      145
--     WE Bar                  102      54       11
--     WE Kueche                39      24       15
--     Umsatz                    0       0        0
--
-- Ueber 100 % ist normal und gehoert gezeigt: ein Verlustmonat hat eine
-- Kostenquote ueber 100, das ist die Aussage. Ab 1.000 % ist nicht mehr der
-- Betrieb auffaellig, sondern der Nenner verschwunden. Die Grenze liegt
-- bewusst weit ueber jedem echten Signal und weit unter dem Unsinn --
-- dazwischen ist die Verteilung duenn.
--
-- Umsatz ist als Anteil gebaut und erreicht nie mehr als 100 %; die Grenze
-- greift dort nie und schadet auch nicht.
--
-- WARUM NULL UND NICHT DIE ZEILE VERWERFEN
--
-- wert_prozent und wert_absolut stehen in DERSELBEN Zeile. Wer die Zeile
-- verwirft, um das Prozent loszuwerden, verliert die -24.809,18 EUR mit --
-- und die sind richtig, brauchbar und die Grundlage des Round Table. Also
-- nur den unbrauchbaren Wert auf NULL, den Euro-Betrag behalten.
--
-- Gleiche Haltung wie `anzahl` und `menge` in src/transform/index.ts:
-- unplausibel wird NULL, nicht eine Zahl, die zufaellig in die Spalte passt
-- und dann still mitgemittelt wird. NULL ist in allen Sichten darueber
-- bereits als "keine Daten" behandelt -- die Ampel zeigt dann grau statt
-- falsch gruen.
--
-- Gefiltert wird in mart.kennzahlen_aktuell, nicht in core: core bleibt die
-- Wahrheit, append-only und unangetastet. Wer den Rohwert sehen will,
-- findet ihn dort -- und ueber mart.bwa_prozent_unplausibel gezielt.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mart.bwa_prozent_plausibel(p_wert numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p_wert IS NULL OR abs(p_wert) > 1000 THEN NULL ELSE p_wert END
$$;

COMMENT ON FUNCTION mart.bwa_prozent_plausibel IS
'BWA-Quoten oberhalb von 1.000 Prozent sind kein Befund, sondern ein verschwundener Nenner
(Umsatz gegen null bei geschlossenen Betrieben). Sie werden NULL, damit sie nicht als
Kennzahl gelten -- gemessen am 01.08.2026 stand sonst -1.272.960 % Personalquote als
gruene Ampel im Round Table. Der Rohwert bleibt in core.kennzahlen_monat.';

-- Die Sicht neu bauen. Sie ist die einzige Stelle, an der die BWA-Prozente
-- in mart eintreten -- round_table_basis, bwa_kennzahl und alles darueber
-- lesen ausschliesslich hier. Ein Filter an dieser Stelle wirkt damit im
-- ganzen Baum, ohne dass zwoelf Sichten angefasst werden muessen.
CREATE OR REPLACE VIEW mart.kennzahlen_aktuell AS
SELECT betrieb_key, monat, kennzahl,
       ((array_agg(wert_absolut ORDER BY abgerufen_am DESC)
         FILTER (WHERE wert_absolut IS NOT NULL))[1])::numeric(14,2) AS wert_absolut,
       -- numeric(14,2) wie die Spalte selbst (siehe 0024) und durch den
       -- Plausibilitaetsfilter (siehe oben). Der Cast allein reichte nicht:
       -- er haette den Ueberlauf nur vom Schreiben ins Lesen verschoben.
       -- Der Cast steht AUSSEN: die Funktion gibt blankes numeric zurueck,
       -- und CREATE OR REPLACE VIEW darf den Spaltentyp nicht aendern.
       mart.bwa_prozent_plausibel(
         ((array_agg(wert_prozent ORDER BY abgerufen_am DESC)
           FILTER (WHERE wert_prozent IS NOT NULL))[1]))::numeric(14,2) AS wert_prozent,
       max(abgerufen_am)                                                AS abgerufen_am
  FROM core.kennzahlen_monat
 GROUP BY betrieb_key, monat, kennzahl;

COMMENT ON VIEW mart.kennzahlen_aktuell IS
'Juengster bekannter BWA-Stand, je Wertspalte getrennt aufgeloest -- Euro und Prozent kommen
aus zwei getrennten LINA-Aufrufen und wuerden sich sonst gegenseitig verdraengen.
abgerufen_am ist der juengste der beiden Abrufe.

wert_prozent ist plausibilitaetsgefiltert (mart.bwa_prozent_plausibel): ueber 1.000 Prozent
wird NULL, weil dort der Umsatz im Nenner verschwunden ist und die Quote nichts mehr aussagt.
wert_absolut bleibt in derselben Zeile erhalten -- der Euro-Betrag ist richtig und wird
gebraucht. Die verworfenen Werte stehen in mart.bwa_prozent_unplausibel.

Fuer "was wussten wir am Stichtag X" stattdessen direkt core.kennzahlen_monat mit
abgerufen_am <= X abfragen.';

-- Nichts verschwindet stillschweigend: was der Filter aussortiert, ist hier
-- nachzusehen -- mit dem Umsatz daneben, der die Ursache zeigt.
CREATE OR REPLACE VIEW mart.bwa_prozent_unplausibel AS
SELECT k.betrieb_key, b.name AS betrieb, b.aktiv, k.monat, k.kennzahl,
       k.wert_prozent, k.wert_absolut,
       u.wert_absolut AS umsatz_absolut,
       k.abgerufen_am
  FROM core.kennzahlen_monat k
  JOIN core.betrieb b USING (betrieb_key)
  LEFT JOIN core.kennzahlen_monat u
         ON u.betrieb_key = k.betrieb_key AND u.monat = k.monat
        AND u.kennzahl = 'Umsatz' AND u.abgerufen_am = k.abgerufen_am
 WHERE k.wert_prozent IS NOT NULL AND abs(k.wert_prozent) > 1000;

COMMENT ON VIEW mart.bwa_prozent_unplausibel IS
'BWA-Quoten, die mart.kennzahlen_aktuell als unplausibel aussortiert (ueber 1.000 Prozent).
umsatz_absolut steht daneben, weil er fast immer die Erklaerung ist: ein Nenner nahe null.
Erwartungswert ist NICHT null -- geschlossene Betriebe buchen weiter Restkosten. Auffaellig
waere ein AKTIVER Betrieb mit nennenswertem Umsatz in dieser Liste.';
