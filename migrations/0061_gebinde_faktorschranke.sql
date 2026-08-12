/**
 * 0061 — Die zweite Schranke: eine Korrektur um Faktor 1000 ist keine
 *
 * WARUM EINE EIGENE NUMMER UND KEINE KORREKTUR IN 0060
 *
 * 0060 steht seit dem 12.08.2026 um 14:17 in public.schema_migration der
 * Serverbank. Der Runner überspringt jede Datei, deren Name dort steht — eine
 * nachträgliche Änderung an 0060 wäre lokal grün gewesen und hätte den Server
 * nie erreicht.
 *
 * Das ist an EINEM Tag der zweite Anlauf zu demselben Fehler: 0056 wurde am
 * selben Vormittag nachträglich geändert, obwohl sie schon angewendet war, und
 * musste als 0057 nachgezogen werden. Beim zweiten Mal war die Ausrede
 * "0060 steht ja nur lokal" — sie stimmte nicht.
 *
 * REGEL, JETZT ZUM ZWEITEN MAL GELERNT: bevor eine Migration angefasst wird,
 * `SELECT filename FROM public.schema_migration` — und zwar auf der Bank, die
 * es betrifft, nicht auf der lokalen. Die beiden sind hier verschieden.
 *
 * ---------------------------------------------------------------------
 * WAS 0060 SCHON TUT UND WAS FEHLT
 *
 * 0060 prüft, ob das Ergebnis in die Spalte passt. Das fängt die zwei Zeilen,
 * die den Nachlauf drei Läufe lang zum Absturz brachten (die Packungsgrösse
 * wird mit sich selbst multipliziert: 4 x 432.000 x 432.000). Der Absturz ist
 * damit erledigt, und die Ausreisserprüfung läuft wieder.
 *
 * Es bleiben 412 Korrekturen, die keine Spaltengrenze reissen, aber die Menge
 * um mehr als das Tausendfache verschieben — bis zum 432.000-fachen.
 *
 * ---------------------------------------------------------------------
 * WARUM DIE FAKTORSCHRANKE JETZT DOCH KOMMT
 *
 * Im Kopf von 0060 steht, sie komme bewusst nicht, weil 0040 selbst
 * Gebindeangaben zwischen 0,00035 und 50 beschreibt — Faktor 142.857 — und
 * eine Grenze bei 1000 also Richtiges mit dem Falschen verwürfe.
 *
 * DIESE BEGRÜNDUNG VERWECHSELT ZWEI VERSCHIEDENE AKTIONEN:
 *
 *   Korrektur VERWERFEN        -> der alte Wert bleibt stehen, und der stammt
 *                                 aus derselben widersprüchlichen Menge.
 *                                 Eine zu enge Grenze kostet RICHTIGKEIT.
 *   als UNENTSCHEIDBAR markieren -> gar kein Preis bleibt stehen.
 *                                 Eine zu enge Grenze kostet ABDECKUNG.
 *
 * Nur die zweite Aktion steht hier zur Debatte, und sie ist die Regel des
 * Hauses: aus unbekannt darf kein Wert werden. Die 1000 ist und bleibt
 * geraten — sie entscheidet aber nur, OB eine Zahl behalten wird, nie WELCHE.
 * Genau das ist der Unterschied zu 0056, wo ein geratener Schwellwert einen
 * WERT bestimmte und dabei 66 Zeilen um 90 Prozent heruntergerechnet und
 * 37.339 EUR Ersparnis erfunden hat.
 *
 * DEN AUSSCHLAG GAB EINE MESSUNG, DIE VORHER NUR BEHAUPTET WAR. Die Annahme
 * lautete, der zweite Schritt des Nachlaufs — core.preis_ausreisser_markieren()
 * mit seiner Faktor-20-Prüfung — fange die Folgeschäden ohnehin ab. Auf der
 * Serverbank nachgerechnet fängt er 173 der 412, also 42 Prozent. Die übrigen
 * 239 kämen durch beide Netze und fütterten mart.einkaufspreis_betrieb.
 *
 * KOSTEN: 414 von 876.341 Positionen verlieren ihren Preis je Einheit,
 * 0,05 Prozent. Gegen die Serverbank gerechnet bleiben 79.356 Korrekturen.
 *
 * ---------------------------------------------------------------------
 * WAS OFFEN BLEIBT
 *
 * Die bessere Frage, auf die es noch keine Antwort gibt: woran liesse sich
 * eine falsche von einer grossen richtigen Korrektur unterscheiden, OHNE eine
 * Zahl zu raten? Vermutlich daran, welches Feld die Packungsgrösse trägt — der
 * naheliegende Test dafür ist aber widerlegt: `gebinde_menge = inhalt_soll`
 * trifft 19.568 Zeilen, von denen 19.547 einwandfrei sind. Bis das geklärt
 * ist, verwirft die Faktorgrenze bewusst zu viel. Siehe docs/offene-punkte.md.
 */

CREATE OR REPLACE FUNCTION core.gebinde_vereinheitlichen()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
    WITH zeile AS (
        SELECT p.bestellposition_key, w.name AS ware, p.einheit, p.menge,
               p.gebinde_menge, p.gesamt_menge, p.summe_preis,
               -- Inhalt je Gebinde, aus der Zeile zurueckgerechnet.
               p.gesamt_menge / nullif(p.menge * p.gebinde_menge, 0) AS inhalt
          FROM core.bestellposition p JOIN core.ware w USING (ware_key)
         WHERE p.menge > 0 AND p.gebinde_menge > 0 AND p.gesamt_menge > 0
    ), haeufigster AS (
        -- MODUS, nicht Median: die Gebindegroesse ist keine Groesse mit
        -- Streuung, sondern eine Angabe, die stimmt oder nicht. Der
        -- Median zwischen 0,00035 und 0,35 waere ein Wert, den es nie gab.
        SELECT ware, einheit,
               mode() WITHIN GROUP (ORDER BY inhalt) AS inhalt_soll,
               count(*) AS n, count(DISTINCT inhalt) AS varianten
          FROM zeile GROUP BY ware, einheit
         HAVING count(*) >= 4 AND count(DISTINCT inhalt) > 1
    ), korrektur AS (
        SELECT z.bestellposition_key, z.gesamt_menge,
               round(z.menge * z.gebinde_menge * h.inhalt_soll, 4) AS gesamt_neu,
               z.summe_preis
          FROM zeile z JOIN haeufigster h
            ON h.ware = z.ware AND h.einheit IS NOT DISTINCT FROM z.einheit
         WHERE h.inhalt_soll > 0
           AND abs(z.inhalt - h.inhalt_soll) > h.inhalt_soll * 0.01
    ), geprueft AS (
        /*
         * ZWEI SCHRANKEN VERSCHIEDENER ART, siehe Kopf.
         *
         * (1) DIE SPALTE, hart und beweisbar (aus 0060). gesamt_menge ist
         *     numeric(14,4) -> zehn Vorkommastellen, preis_je_einheit
         *     numeric(14,6) -> acht. Wo das reisst, ist die Zeile nicht knapp
         *     daneben, sondern widerspruechlich.
         *
         * (2) DER FAKTOR, geraten und als solcher benannt. Wer die Menge um
         *     mehr als das Tausendfache verschiebt, korrigiert keine
         *     Gebindeangabe. Vertretbar nur, weil die Folge "kein Preis" ist
         *     und nicht "dieser Preis".
         */
        SELECT k.*,
               k.gesamt_neu < 10000000000
               AND (k.summe_preis <= 0 OR k.gesamt_neu <= 0
                    OR round(k.summe_preis / k.gesamt_neu, 6) < 100000000)
               AND k.gesamt_menge > 0
               AND k.gesamt_neu / k.gesamt_menge BETWEEN 0.001 AND 1000 AS passt
          FROM korrektur k
    )
    UPDATE core.bestellposition p
       SET gesamt_menge     = CASE WHEN g.passt THEN g.gesamt_neu
                                   ELSE p.gesamt_menge END,
           preis_je_einheit = CASE WHEN g.passt AND g.gesamt_neu > 0 AND g.summe_preis > 0
                                   THEN round(g.summe_preis / g.gesamt_neu, 6) END,
           -- Unentscheidbar statt unveraendert: der alte Preis je Einheit
           -- stammt aus derselben zweifelhaften Menge.
           menge_unstimmig  = CASE WHEN g.passt THEN p.menge_unstimmig
                                   ELSE true END
      FROM geprueft g
     WHERE p.bestellposition_key = g.bestellposition_key;

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

COMMENT ON FUNCTION core.gebinde_vereinheitlichen() IS
'Setzt gesamt_menge auf die HAEUFIGSTE Gebindeangabe derselben Ware um.
FoodNotify meldet unitQuantity fuer dieselbe Ware zwischen 0,00035 und 50 --
der Preis je Gebinde bleibt dabei stabil, also ist die Mengenangabe der Fehler.
Gruppiert ueber Name und Einheit, weil dieselbe Ware acht Warennummern traegt.
ZWEI SCHRANKEN (0060 und 0061). Erstens die Spalte: passt das Ergebnis nicht in
numeric(14,4) bzw. numeric(14,6), wird es nicht geschrieben -- zwei Zeilen haben
den Nachlauf sonst drei Laeufe lang zum Absturz gebracht, samt
core.preis_ausreisser_markieren(), das danach gar nicht mehr lief. Zweitens der
Faktor 0,001 bis 1000: wer die Menge um mehr als das Tausendfache verschiebt,
korrigiert keine Gebindeangabe. In beiden Faellen bekommt die Zeile
menge_unstimmig = true und preis_je_einheit = NULL -- unentscheidbar, nicht
unveraendert. Kosten 414 von 876.341 Positionen. Die Faktor-20-Pruefung des
zweiten Schritts faengt davon nur 173, deshalb reicht sie allein nicht.';


-- ---------------------------------------------------------------------
-- Die 412 sofort in Ordnung bringen
--
-- 0060 hat nur die zwei Zeilen erwischt, deren Korrektur die Spalte sprengt.
-- Die uebrigen tragen bis zum naechsten Nachlauf ihren alten, aus derselben
-- widerspruechlichen Menge gerechneten Preis.
--
-- Die Bedingung ist dieselbe wie in der Funktion, nur als eigenstaendige
-- Anweisung. `AND NOT p.menge_unstimmig` haelt sie idempotent: was 0060 schon
-- markiert hat, wird nicht noch einmal angefasst.
-- ---------------------------------------------------------------------
WITH zeile AS (
    SELECT p.bestellposition_key, w.name AS ware, p.einheit, p.menge,
           p.gebinde_menge, p.gesamt_menge,
           p.gesamt_menge / nullif(p.menge * p.gebinde_menge, 0) AS inhalt
      FROM core.bestellposition p JOIN core.ware w USING (ware_key)
     WHERE p.menge > 0 AND p.gebinde_menge > 0 AND p.gesamt_menge > 0
), haeufigster AS (
    SELECT ware, einheit, mode() WITHIN GROUP (ORDER BY inhalt) AS inhalt_soll
      FROM zeile GROUP BY ware, einheit
     HAVING count(*) >= 4 AND count(DISTINCT inhalt) > 1
), unentscheidbar AS (
    SELECT z.bestellposition_key
      FROM zeile z JOIN haeufigster h
        ON h.ware = z.ware AND h.einheit IS NOT DISTINCT FROM z.einheit
     WHERE h.inhalt_soll > 0
       AND abs(z.inhalt - h.inhalt_soll) > h.inhalt_soll * 0.01
       AND (round(z.menge * z.gebinde_menge * h.inhalt_soll, 4) >= 10000000000
            OR round(z.menge * z.gebinde_menge * h.inhalt_soll, 4)
               / nullif(z.gesamt_menge, 0) NOT BETWEEN 0.001 AND 1000)
)
UPDATE core.bestellposition p
   SET menge_unstimmig = true, preis_je_einheit = NULL
  FROM unentscheidbar u
 WHERE p.bestellposition_key = u.bestellposition_key
   AND NOT p.menge_unstimmig;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0061', to_jsonb(
        'Zweite Schranke in core.gebinde_vereinheitlichen(): Faktor 0,001 bis 1000. '
        'Anlass: die Faktor-20-Pruefung des zweiten Nachlaufschritts faengt nur 173 '
        'der 412 unplausiblen Korrekturen, 239 kaemen durch. Vertretbar, weil die '
        'Folge "kein Preis" ist und nicht "dieser Preis". Gegen die Serverbank: '
        '79.356 Korrekturen bleiben, 414 werden unentscheidbar. Eigene Nummer, weil '
        '0060 am 12.08.2026 um 14:17 bereits angewendet war.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
