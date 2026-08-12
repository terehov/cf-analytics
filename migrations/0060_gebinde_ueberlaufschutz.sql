/**
 * 0060 — Der Einkaufspreis-Nachlauf scheitert an zwei Zeilen, seit drei Läufen
 *
 * ANLASS. Die Läufe 83, 84 und 85 melden alle
 * `einkaufspreis-nachlauf gescheitert — numeric field overflow`
 * (src/sync/einkaufspreis.ts:55). Weil der Nachlauf bewusst nie wirft, blieb
 * der Import gültig — und der Fehler drei Läufe lang stehen.
 *
 * ---------------------------------------------------------------------
 * WAS ES NICHT WAR
 *
 * docs/offene-punkte.md nannte am 12.08.2026 den PREIS als Ursache: eine
 * Position über 10.000 EUR geteilt durch eine winzige Menge sprenge
 * preis_je_einheit numeric(14,6). Auf der Serverbank nachgemessen ist das
 * falsch — der grösste entstehende Preis je Einheit liegt bei 46.200 gegen
 * eine Grenze von 100.000.000, Faktor 2.165 Luft. Kein einziger Satz kommt
 * dort in die Nähe.
 *
 * Widerlegen liess sich die Vermutung vorher nicht, weil in der Arbeitsumgebung
 * eine ANDERE Datenbank steht: dort endet sync.lauf bei Lauf 74 und die jüngste
 * Rohantwort stammt vom 08.08.2026. Die Läufe 83 bis 85 stehen dort gar nicht.
 *
 * ---------------------------------------------------------------------
 * WAS ES IST: DIE MENGE, UND SIE WIRD QUADRIERT
 *
 * Es sind genau ZWEI Zeilen, beide in core.gebinde_vereinheitlichen():
 *
 *   Knusperschnitzel Homestyle   menge 4  gebinde_menge 432.000  inhalt_soll 432.000
 *   Kalbsschnitzel roh paniert   menge 2  gebinde_menge 198.000  inhalt_soll 198.000
 *
 * Dieselbe Ware wird von den Häusern auf zwei Arten gebucht. Die einen tragen
 * die Packungsgrösse in gesamt_menge und lassen gebinde_menge auf 1 — daraus
 * wird der Modus inhalt_soll = 432.000. Diese Zeile trägt die Packungsgrösse
 * dagegen in gebinde_menge. Die Korrektur rechnet
 *
 *     gesamt_neu = menge * gebinde_menge * inhalt_soll
 *                = 4 * 432.000 * 432.000
 *                = 746.496.000.000
 *
 * und multipliziert die Packungsgrösse damit mit sich selbst.
 * core.bestellposition.gesamt_menge ist numeric(14,4) und fasst zehn
 * Vorkommastellen, also höchstens 9.999.999.999. Die eine Zeile bringt den
 * gesamten Nachlauf zu Fall — auch den zweiten Schritt
 * core.preis_ausreisser_markieren(), der danach gar nicht mehr läuft.
 *
 * ---------------------------------------------------------------------
 * DIE SCHRANKE IST DIE SPALTE, NICHT EIN GERATENER SCHWELLWERT
 *
 * Naheliegend wäre gewesen, Korrekturen ab einem bestimmten Faktor zu
 * verwerfen: 414 der 79.770 Korrekturen ändern die Menge um mehr als das
 * Tausendfache oder weniger als ein Tausendstel. Diese Grenze steht hier
 * BEWUSST NICHT, und der Grund steht in 0040 selbst: FoodNotify meldet die
 * Gebindeangabe derselben Ware zwischen 0,00035 und 50 — das ist Faktor
 * 142.857, und eine solche Korrektur wäre nach eigener Beschreibung richtig.
 * Wer hier 1000 hinschreibt, verwirft Richtiges mit dem Falschen. Es ist
 * derselbe Fehler, der in 0056 schon einmal 66 Zeilen um 90 Prozent
 * heruntergerechnet und 37.339 EUR Ersparnis erfunden hat.
 *
 * Geprüft wird deshalb nur, was beweisbar ist: passt das Ergebnis in die
 * Spalte. Zwei Zeilen tut es nicht.
 *
 * Auch der Mechanismus taugt nicht als Regel — `gebinde_menge = inhalt_soll`
 * trifft zwar beide Absturzzeilen, aber insgesamt 19.568, von denen 19.547
 * einwandfrei sind.
 *
 * ---------------------------------------------------------------------
 * WAS MIT DEN VERWORFENEN ZEILEN PASSIERT
 *
 * Nicht "unverändert lassen": die Zeile ist nachweislich widersprüchlich, und
 * ihr alter preis_je_einheit stammt aus derselben zweifelhaften Menge. Sie
 * bekommt deshalb menge_unstimmig = true und preis_je_einheit = NULL — das
 * Urteil "unentscheidbar", nach derselben Regel wie überall hier: aus
 * unbekannt darf kein Wert werden.
 *
 * Damit ist der Verlust auch nicht still. Die Zeilen sind über
 * menge_unstimmig zählbar, und mart.einkaufspreis_betrieb filtert seit 0057
 * genau darauf.
 *
 * OFFEN BLEIBT, was mit den 412 übrigen unplausiblen Korrekturen ist — sie
 * überschreiten keine Spaltengrenze und werden weiterhin geschrieben. Ob sie
 * falsch sind, ist gemessen, aber nicht bewiesen; steht in
 * docs/offene-punkte.md.
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
        SELECT z.bestellposition_key,
               round(z.menge * z.gebinde_menge * h.inhalt_soll, 4) AS gesamt_neu,
               z.summe_preis
          FROM zeile z JOIN haeufigster h
            ON h.ware = z.ware AND h.einheit IS NOT DISTINCT FROM z.einheit
         WHERE h.inhalt_soll > 0
           AND abs(z.inhalt - h.inhalt_soll) > h.inhalt_soll * 0.01
    ), geprueft AS (
        /*
         * PASST DAS ERGEBNIS UEBERHAUPT IN DIE SPALTEN?
         *
         * gesamt_menge ist numeric(14,4) -> zehn Vorkommastellen,
         * preis_je_einheit numeric(14,6) -> acht. Beides ist keine
         * Ermessensgrenze, sondern eine harte. Wo sie reisst, ist die Zeile
         * nicht "knapp daneben", sondern widerspruechlich: 4 x 432.000 x
         * 432.000 entsteht, weil die Packungsgroesse mit sich selbst
         * multipliziert wird.
         */
        SELECT k.*,
               k.gesamt_neu < 10000000000
               AND (k.summe_preis <= 0 OR k.gesamt_neu <= 0
                    OR round(k.summe_preis / k.gesamt_neu, 6) < 100000000) AS passt
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
SEIT 0060 MIT UEBERLAUFSCHUTZ: wo das Ergebnis nicht in numeric(14,4) bzw.
numeric(14,6) passt, wird es NICHT geschrieben; die Zeile bekommt stattdessen
menge_unstimmig = true und preis_je_einheit = NULL. Zwei Zeilen haben den
Nachlauf sonst drei Laeufe lang komplett zum Absturz gebracht -- samt
core.preis_ausreisser_markieren(), das danach gar nicht mehr lief.';


-- ---------------------------------------------------------------------
-- Die beiden bekannten Zeilen sofort in Ordnung bringen
--
-- Ohne das laeuft der naechste Nachlauf zwar durch, die zwei Zeilen traegen
-- aber bis dahin ihren alten, aus derselben widerspruechlichen Menge
-- gerechneten Preis. Die Bedingung ist dieselbe wie oben, nur als
-- eigenstaendige Anweisung -- sie trifft genau die Zeilen, deren Korrektur
-- die Spalte sprengen wuerde.
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
), sprengt AS (
    SELECT z.bestellposition_key
      FROM zeile z JOIN haeufigster h
        ON h.ware = z.ware AND h.einheit IS NOT DISTINCT FROM z.einheit
     WHERE h.inhalt_soll > 0
       AND abs(z.inhalt - h.inhalt_soll) > h.inhalt_soll * 0.01
       AND round(z.menge * z.gebinde_menge * h.inhalt_soll, 4) >= 10000000000
)
UPDATE core.bestellposition p
   SET menge_unstimmig = true, preis_je_einheit = NULL
  FROM sprengt s
 WHERE p.bestellposition_key = s.bestellposition_key
   AND NOT p.menge_unstimmig;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0060', to_jsonb(
        'core.gebinde_vereinheitlichen() mit Ueberlaufschutz. Ursache des '
        '"numeric field overflow" in den Laeufen 83-85: nicht der Preis (Faktor '
        '2.165 Luft), sondern die MENGE. Zwei Zeilen buchen die Packungsgroesse '
        'in gebinde_menge, waehrend der Modus derselben Ware sie in gesamt_menge '
        'fuehrt -- 4 x 432.000 x 432.000 quadriert sie. Verworfene Korrekturen '
        'gelten als unentscheidbar (menge_unstimmig), nicht als unveraendert.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
