-- ---------------------------------------------------------------------
-- Migration 0040 · Ausreisser erkennt man an der Ware, nicht an der Zeile
--
-- Migration 0036 prueft `totalUnitQuantity` gegen
-- `menge x Gebinde x Inhalt`. Das faengt den Fall, in dem EIN Feld falsch
-- ist -- aber nicht den, in dem FoodNotify beide falsch liefert.
--
-- Gemessen am 03.08.2026 an "Idee Entkoffeiniert 50 Pouches a 7G":
--   packagingQuantity 50, totalUnitQuantity 0,35   ->   38 EUR/kg
--   packagingQuantity  1, totalUnitQuantity 0,00035 -> 8.567 EUR/kg
-- Beide Zeilen sind IN SICH stimmig (1 x 1 x 0,00035 = 0,00035). Die
-- Rechnung stimmt, die Stammdaten nicht. Fuer sich betrachtet ist keine
-- der beiden Zeilen widerlegbar.
--
-- Widerlegbar werden sie erst NEBENEINANDER: dieselbe Ware, derselbe
-- Lieferant, Faktor 225 im Preis. Deshalb prueft diese Migration nicht
-- die Zeile, sondern die Verteilung je Ware -- der Median ist robust
-- gegen einzelne Ausreisser, und wer ihn um mehr als das Zwanzigfache
-- ueberschreitet, ist keiner Preiserhoehung aufgesessen.
--
-- WARUM ALS FUNKTION UND NICHT IM LADEPFAD: beim Laden einer einzelnen
-- Position ist die Verteilung der Ware noch nicht bekannt -- die
-- Vergleichszeilen kommen erst spaeter im Backfill. Die Pruefung laeuft
-- deshalb im Nachlauf jedes Sync-Laufs, ueber alles, was inzwischen da
-- ist.
-- ---------------------------------------------------------------------

/**
 * DIE GESAMTMENGE AUS DER HAEUFIGSTEN GEBINDEANGABE HERSTELLEN.
 *
 * Gemessen am 03.08.2026 an "Idee Ent(c|k)offeiniert 50 Pouches a 7G":
 * der Preis JE GEBINDE ist stabil (13,03 bis 16,94 EUR ueber 178
 * Bestellungen), waehrend `unitQuantity` zwischen 0,00035, 0,007, 0,35
 * und 50 schwankt -- Faktor 140.000. Nicht der Preis ist unklar, sondern
 * die Angabe, wie viel in einem Gebinde steckt.
 *
 * Was daraus folgt: die haeufigste Angabe je Ware ist die richtige. Ein
 * Datenfehler ist die Ausnahme, sonst waere er keiner. Diese Funktion
 * setzt `gesamt_menge` und `preis_je_einheit` auf den Modus der Ware um
 * -- und zwar nur, wo die eigene Angabe davon abweicht.
 *
 * Gruppiert wird ueber NAME UND EINHEIT, nicht ueber ware_key: derselbe
 * Kaffee traegt acht verschiedene Warennummern, und innerhalb einer
 * Nummer ist der Fehler konsistent (alle elf Zeilen bei 48.400 EUR/kg).
 * Erst neben den 37,91 EUR/kg derselben Ware unter anderer Nummer wird
 * er sichtbar.
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
    )
    UPDATE core.bestellposition p
       SET gesamt_menge = k.gesamt_neu,
           preis_je_einheit = CASE WHEN k.gesamt_neu > 0 AND k.summe_preis > 0
                                   THEN round(k.summe_preis / k.gesamt_neu, 6) END
      FROM korrektur k
     WHERE p.bestellposition_key = k.bestellposition_key;

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

COMMENT ON FUNCTION core.gebinde_vereinheitlichen() IS
'Setzt gesamt_menge auf die HAEUFIGSTE Gebindeangabe derselben Ware um.
FoodNotify meldet unitQuantity fuer dieselbe Ware zwischen 0,00035 und 50 --
der Preis je Gebinde bleibt dabei stabil, also ist die Mengenangabe der Fehler.
Gruppiert ueber Name und Einheit, weil dieselbe Ware acht Warennummern traegt.';


CREATE OR REPLACE FUNCTION core.preis_ausreisser_markieren()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
    /**
     * GRUPPIERT WIRD UEBER DEN NAMEN, NICHT UEBER ware_key.
     *
     * Derselbe Kaffee traegt acht verschiedene ware_key -- FoodNotify
     * vergibt je Betrieb und Lieferant eine eigene Nummer (866
     * Warensaetze auf 428 Namen, gemessen 02.08.2026). Innerhalb EINER
     * Nummer ist der Fehler konsistent: alle elf Zeilen von ware_key
     * 249826 stehen bei 48.400 EUR/kg, der Median liegt genauso hoch,
     * und nichts faellt auf. Erst neben den 37,91 EUR/kg derselben Ware
     * unter anderer Nummer wird es widerlegbar.
     *
     * Die Einheit gehoert in die Gruppe: derselbe Name in kg und in
     * Litern sind zwei Preisreihen, kein Widerspruch.
     */
    WITH je AS (
        SELECT p.bestellposition_key, w.name AS ware, p.einheit,
               p.preis_je_einheit AS p
          FROM core.bestellposition p JOIN core.ware w USING (ware_key)
         WHERE p.preis_je_einheit > 0
    ), verteilung AS (
        -- Mindestens vier Belege je Ware: bei zwei oder drei Zeilen ist
        -- der Median selbst noch Zufall, und eine Pruefung gegen Zufall
        -- ist keine.
        SELECT ware, einheit, count(*) AS n,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY p)::numeric AS median
          FROM je GROUP BY ware, einheit HAVING count(*) >= 4
    ), verdaechtig AS (
        SELECT j.bestellposition_key
          FROM je j JOIN verteilung v
            ON v.ware = j.ware AND v.einheit IS NOT DISTINCT FROM j.einheit
         -- Beide Richtungen: ein fehlendes Gebinde macht den Preis zu
         -- gross, ein doppelt gezaehltes zu klein.
         WHERE j.p > v.median * 20 OR j.p * 20 < v.median
    )
    UPDATE core.bestellposition p
       SET menge_unstimmig = true, preis_je_einheit = NULL
      FROM verdaechtig v
     WHERE p.bestellposition_key = v.bestellposition_key
       AND NOT p.menge_unstimmig;

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

COMMENT ON FUNCTION core.preis_ausreisser_markieren() IS
'Markiert Positionen, deren Preis je Einheit den Median DERSELBEN Ware um mehr
als das Zwanzigfache ueber- oder unterschreitet. Faengt die Faelle, in denen
FoodNotify Gebinde UND Gesamtmenge falsch liefert -- dann ist die Zeile in sich
stimmig und nur im Vergleich mit ihresgleichen widerlegbar. Laeuft im Nachlauf
jedes Sync-Laufs, weil die Vergleichszeilen beim Laden noch fehlen.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0040', to_jsonb(
        'core.preis_ausreisser_markieren(): Preis je Einheit gegen den Median '
        'derselben Ware, Faktor 20 in beide Richtungen. Anlass: Kaffee mit '
        '8.567 EUR/kg neben 38 EUR/kg, beide Zeilen in sich stimmig.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
