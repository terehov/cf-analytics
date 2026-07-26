-- ---------------------------------------------------------------------
-- 0013 Der Markenschnitt als Sicht, nicht nur als Funktion
--
-- ANLASS: dieselbe Luecke wie beim Round Table. Metabase kann tabellen-
-- wertige Funktionen im Abfrage-Editor nicht benutzen, `mart.konzept_schnitt
-- (monat, regelwerk)` ist dort also nur ueber eine SQL-Frage mit Parameter
-- erreichbar. Die Marken-Karte hat deshalb die Median-Aggregation in
-- nativem SQL nachgebaut -- und damit stand die Regel "Median statt
-- Mittelwert bei Marken" an ZWEI Stellen. Wer die eine aendert, aendert die
-- andere nicht mit.
--
-- Diese Sicht ist ab jetzt die kanonische Zahl: eine Zeile je Marke UND
-- Monat, fertig aggregiert, in Metabase klickbar und nach `monat` filterbar.
--
-- WARUM MEDIAN UND NICHT MITTELWERT
--
-- Bei 141 Betrieben reicht ein einzelner Ausreisser, um den Massstab einer
-- ganzen Marke zu verziehen. Das ist hier keine Vorsichtsmassnahme, sondern
-- gemessen: die Personalquote hat den Umsatz im Nenner und erreicht am
-- 26.07.2026 bis zu 316.576,50 Prozent -- Enchilada Wuerzburg am 15.06. bei
-- 6,05 EUR Umsatz. Ein einziger solcher Tag verschiebt einen Mittelwert um
-- Groessenordnungen. Der Median haelt still.
--
-- `umsatz_ist` ist dagegen eine echte SUMME. Umsatz addiert sich, Quoten
-- nicht.
--
-- WAS DIE FUNKTION NOCH SOLL
--
-- `mart.konzept_schnitt(monat, regelwerk)` bleibt -- aber nur noch fuer den
-- einen Fall, den eine Sicht nicht abbilden kann: ein ANDERES Regelwerk. Ein
-- Regelwerk ist kein Filterkriterium, sondern eine Rechenvorschrift. Fuer
-- das Standardregelwerk ist diese Sicht die Quelle, und beide liefern
-- dieselben Zahlen.
-- ---------------------------------------------------------------------

CREATE VIEW mart.konzept_schnitt_monat AS
SELECT r.monat,
       r.konzept,
       count(*)::int                                                                   AS betriebe,
       round(sum(r.umsatz_ist), 2)                                                     AS umsatz_ist,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.umsatz_pct)::numeric, 2)    AS umsatz_pct,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.personalkosten_ogf_pct)::numeric, 2)
                                                                                       AS personalkosten_ogf_pct,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.we_bar_pct)::numeric, 2)    AS we_bar_pct,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.we_kueche_pct)::numeric, 2) AS we_kueche_pct,
       round(avg(r.online_bewertung), 2)                                               AS online_bewertung,
       round(avg(r.om_score), 2)                                                       AS om_score,
       count(*) FILTER (WHERE r.gesamt = 'rot')::int                                   AS ampeln_rot,
       count(*) FILTER (WHERE r.gesamt = 'orange')::int                                AS ampeln_orange,
       count(*) FILTER (WHERE r.gesamt = 'gruen')::int                                 AS ampeln_gruen,
       -- Im Excel fielen Betriebe ohne BWA unsichtbar unter den Tisch und
       -- sahen aus wie Betriebe ohne Befund. Hier stehen sie als eigene Zahl.
       count(*) FILTER (WHERE r.gesamt IS NULL)::int                                   AS ohne_urteil,
       count(*) FILTER (WHERE r.massnahme = 'Ja')::int                                 AS massnahme_faellig
  FROM mart.round_table_monat r
 GROUP BY r.monat, r.konzept;

COMMENT ON VIEW mart.konzept_schnitt_monat IS
'DER MARKENSCHNITT FUER METABASE. Eine Zeile je Marke und Monat, bewertet mit dem
STANDARDREGELWERK. In Metabase nach monat filtern.

Die Prozentwerte sind MEDIANE, nicht Mittelwerte -- ein einzelner Ausreisser soll den
Vergleichsmassstab einer ganzen Marke nicht verziehen. Gemessen: die Personalquote erreicht
bis 316.576,50 Prozent, weil der Umsatz im Nenner steht und gegen null gehen kann.
umsatz_ist ist dagegen eine echte Summe -- Umsatz addiert sich, Quoten nicht.
Bewertung und OM-Score sind Mittelwerte: beide sind auf 1 bis 5 begrenzt und koennen nicht
entgleisen.

ohne_urteil zaehlt die Betriebe ohne BWA-Stand. Im Excel fielen die unsichtbar unter den
Tisch und sahen aus wie Betriebe ohne Befund.

Fuer ein anderes Regelwerk: mart.konzept_schnitt(monat, ''lina_betrieb'').';


-- ---------------------------------------------------------------------
-- Die Funktion zeigt jetzt auf die Sicht
-- ---------------------------------------------------------------------

COMMENT ON FUNCTION mart.konzept_schnitt IS
'Markenschnitt eines Monats mit waehlbarem Regelwerk.

FUER DAS STANDARDREGELWERK IST mart.konzept_schnitt_monat DIE BESSERE WAHL -- dieselben
Zahlen, aber als Sicht, und damit in Metabase ohne SQL benutzbar. Diese Funktion bleibt fuer
den einen Fall, den eine Sicht nicht abbilden kann: ein anderes Regelwerk. Ein Regelwerk ist
kein Filterkriterium, sondern eine Rechenvorschrift.

Die Prozentwerte sind MEDIANE, umsatz_ist ist eine echte Summe. "(nicht zugeordnet)" sammelt
die Betriebe ohne eindeutiges Hauptkonzept; wer da landet und warum, steht in
mart.konzept_zuordnung.';
