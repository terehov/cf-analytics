-- ---------------------------------------------------------------------
-- Migration 0041 · Der Einkaufspreis ist der Preis je GEBINDE
--
-- WARUM DIE UMSTELLUNG.
--
-- Bis heute wies `mart.einkaufspreis_monat` den Preis je Basiseinheit aus
-- (Euro je Kilo, je Liter). Diese Zahl haengt an `unitQuantity` -- der
-- FoodNotify-Angabe, wie viel in einem Gebinde steckt. Und die ist
-- nachweislich unbrauchbar: fuer DIESELBE Ware ("Idee Entkoffeiniert 50
-- Pouches a 7G") meldet FoodNotify 0,00035, 0,007, 0,35 und 50 --
-- Faktor 140.000. Ergebnis in der Karte: 48.400 EUR/kg fuer Kaffee.
--
-- Der Preis JE GEBINDE dagegen ist stabil. Gemessen am 03.08.2026 an
-- 310.496 Positionen: Median 14,36 EUR, dreizehn Werte ueber 1.000 EUR.
-- Er braucht nur zwei Zahlen, `sumPrice` und `adjustedQuantity`, und
-- beide stehen sauber in der Antwort.
--
-- Fachlich ist er ausserdem die richtigere Zahl: "Was kostet ein Karton
-- Mozzarella?" ist die Frage, die im Einkauf gestellt wird. "Was kostet
-- ein Kilo davon?" haengt an einer Stammdatenangabe, die der Lieferant
-- pflegt und niemand prueft.
--
-- WAS MIT DEM PREIS JE EINHEIT PASSIERT: er bleibt als Zusatzspalte
-- stehen, wo er belastbar ist (`core.bestellposition.preis_je_einheit`,
-- Migration 0042). Er verschwindet nur aus der fuehrenden Rolle.
--
-- WAS DAS FUER DIE REZEPTE HEISST: nichts. Der Soll-Wareneinsatz rechnet
-- `artikelverkauf_tag.menge x zutat.cost` -- Euro je Portion, fertig von
-- FoodNotify geliefert. In dieser Kette kommt keine Einheit vor.
-- ---------------------------------------------------------------------

-- `CREATE OR REPLACE VIEW` kann Spalten weder umbenennen noch umordnen.
-- Die Spaltenfolge aendert sich hier (preis_je_gebinde kommt dazu, menge
-- rueckt), also erst weg, dann neu. Kein CASCADE: die abhaengigen
-- Sichten werden unten ausdruecklich mit angelegt, und was sonst noch
-- daran haengt, soll auffallen statt still zu verschwinden.
DROP VIEW IF EXISTS mart.einkaufspreis_veraenderung;
DROP VIEW IF EXISTS mart.einkaufspreis_monat;

CREATE VIEW mart.einkaufspreis_monat AS
WITH basis AS (
    SELECT
        w.name  AS ware,
        m.name  AS marke,
        bp.einheit,
        date_trunc('month', b.bestellt_am)::date AS monat,
        bp.menge,
        bp.summe_preis,
        bp.gesamt_menge,
        bp.preis_je_einheit,
        -- DER FUEHRENDE PREIS: was ein bestelltes Gebinde gekostet hat.
        bp.summe_preis / bp.menge AS preis_je_gebinde
      FROM core.bestellposition bp
      JOIN core.bestellung b USING (bestellung_key)
      JOIN core.kostenstelle k USING (kostenstelle_key)
      JOIN core.marke m ON m.marke_key = k.marke_key
      JOIN core.ware  w ON w.ware_key = bp.ware_key
     WHERE b.bestellt_am IS NOT NULL
       AND bp.menge > 0 AND bp.summe_preis > 0
), streuung AS (
    -- Der Median je Ware ueber ALLE Monate: der Massstab, an dem eine
    -- einzelne Zeile als Ausreisser erkennbar wird. Ab vier Belegen --
    -- bei zwei oder drei ist der Median selbst noch Zufall.
    SELECT ware, percentile_cont(0.5) WITHIN GROUP (
             ORDER BY preis_je_gebinde)::numeric AS median_gesamt,
           count(*) AS belege
      FROM basis GROUP BY ware
), bereinigt AS (
    /**
     * Ausreisser fliegen raus, in BEIDE Richtungen.
     *
     * Es sind echte Falschbuchungen im Quellsystem: 1.002.250 EUR fuer
     * eine Packung Falthandtuecher, gemessen am 03.08.2026. Sie stehen so
     * in FoodNotify, wir lesen sie richtig -- sie als Preis auszuweisen
     * waere trotzdem falsch. 710 von 251.580 Zeilen (0,3 %).
     *
     * Sie sind nicht verloren: `mart.einkauf_pruefung` zeigt sie mit
     * Grund. Eine stille Kuerzung waere schlimmer als der Ausreisser.
     */
    SELECT b.* FROM basis b JOIN streuung s USING (ware)
     WHERE s.belege < 4
        OR (b.preis_je_gebinde <= s.median_gesamt * 20
        AND b.preis_je_gebinde * 20 >= s.median_gesamt)
)
SELECT
    ware, marke, einheit, monat,
    count(*)                       AS bestellungen,
    sum(menge)                     AS gebinde,
    sum(gesamt_menge)              AS menge,
    sum(summe_preis)               AS ausgaben,
    -- MEDIAN, nicht Mittelwert: bei Preisreihen ist der Ausreisser die
    -- Regel, nicht die Ausnahme.
    round(percentile_cont(0.5) WITHIN GROUP (
        ORDER BY preis_je_gebinde)::numeric, 2) AS preis_je_gebinde,
    round(min(preis_je_gebinde)::numeric, 2)    AS preis_min,
    round(max(preis_je_gebinde)::numeric, 2)    AS preis_max,
    -- Der Preis je Basiseinheit bleibt als Zusatz, wo er belastbar ist.
    -- NULL heisst: die Gebindeangabe der Ware war nicht verwertbar.
    round(percentile_cont(0.5) WITHIN GROUP (
        ORDER BY preis_je_einheit)::numeric, 4) AS preis_je_einheit_median
  FROM bereinigt
 GROUP BY ware, marke, einheit, monat;

COMMENT ON VIEW mart.einkaufspreis_monat IS
'Einkaufspreis je Ware und Monat. FUEHREND ist der Preis je GEBINDE (was ein
bestellter Karton gekostet hat) -- er braucht nur sumPrice und Menge und ist
damit belastbar. Der Preis je Basiseinheit steht daneben, wo FoodNotifys
Gebindeangabe verwertbar war; sie schwankt fuer dieselbe Ware um Faktor 140.000.
Gruppiert ueber den NAMEN: FoodNotify vergibt je Betrieb eigene Waren-IDs.';


CREATE VIEW mart.einkaufspreis_veraenderung AS
WITH mit_vormonat AS (
    SELECT p.*,
           lag(p.preis_je_gebinde) OVER (
               PARTITION BY p.ware, p.marke ORDER BY p.monat) AS vormonat_preis,
           lag(p.monat) OVER (
               PARTITION BY p.ware, p.marke ORDER BY p.monat) AS vormonat
      FROM mart.einkaufspreis_monat p
)
SELECT
    ware, marke, einheit, monat,
    preis_je_gebinde AS preis,
    vormonat_preis,
    vormonat,
    -- Nur vergleichen, wenn der Vormonat WIRKLICH der Vormonat ist.
    -- lag() nimmt sonst die letzte vorhandene Zeile — bei einer Ware, die
    -- nur zweimal im Jahr bestellt wird, waere das ein Halbjahressprung,
    -- ausgewiesen als Monatsveraenderung.
    CASE WHEN vormonat = monat - interval '1 month'
          AND vormonat_preis > 0
         THEN round(100.0 * (preis_je_gebinde - vormonat_preis)
                    / vormonat_preis, 1) END AS veraenderung_pct,
    bestellungen, gebinde, menge, ausgaben
  FROM mit_vormonat;

COMMENT ON VIEW mart.einkaufspreis_veraenderung IS
'Preisveraenderung je Ware und Gebinde gegenueber dem VORMONAT.
veraenderung_pct ist NULL, wenn der letzte Einkauf laenger her ist als einen
Monat — ein Halbjahressprung als Monatsveraenderung waere eine erfundene Zahl.';


-- Die Pruefsicht zeigt jetzt auch die Preisausreisser, nicht nur die
-- Positionen ohne verwertbare Einheit. Zwei Spalten kommen dazu, also
-- ebenfalls erst weg und neu (siehe oben).
DROP VIEW IF EXISTS mart.einkauf_pruefung;

CREATE VIEW mart.einkauf_pruefung AS
WITH je AS (
    SELECT bp.bestellposition_key, w.name AS ware,
           bp.summe_preis / nullif(bp.menge, 0) AS preis_je_gebinde
      FROM core.bestellposition bp JOIN core.ware w USING (ware_key)
     WHERE bp.menge > 0 AND bp.summe_preis > 0
), streuung AS (
    SELECT ware, count(*) AS belege,
           percentile_cont(0.5) WITHIN GROUP (
             ORDER BY preis_je_gebinde)::numeric AS median
      FROM je GROUP BY ware HAVING count(*) >= 4
), ausreisser AS (
    SELECT j.bestellposition_key, j.preis_je_gebinde, s.median
      FROM je j JOIN streuung s USING (ware)
     WHERE j.preis_je_gebinde > s.median * 20
        OR j.preis_je_gebinde * 20 < s.median
)
SELECT
    m.name  AS marke,
    bt.name AS betrieb,
    b.bestellt_am::date AS bestelldatum,
    b.bestellnummer,
    coalesce(w.name, bp.name) AS ware,
    bp.menge,
    bp.gebinde_menge,
    bp.gesamt_menge,
    bp.einheit,
    bp.summe_preis,
    round(a.preis_je_gebinde, 2) AS preis_je_gebinde,
    round(a.median, 2)           AS ueblich,
    CASE
      WHEN a.bestellposition_key IS NOT NULL AND a.preis_je_gebinde > a.median
        THEN 'Preis je Gebinde weit ueber dem Ueblichen'
      WHEN a.bestellposition_key IS NOT NULL
        THEN 'Preis je Gebinde weit unter dem Ueblichen'
      WHEN bp.menge IS NULL OR bp.menge <= 0
        THEN 'keine Menge gemeldet'
      ELSE 'Gebindeangabe nicht verwertbar — kein Preis je Einheit'
    END AS grund
  FROM core.bestellposition bp
  JOIN core.bestellung   b  USING (bestellung_key)
  JOIN core.kostenstelle k  USING (kostenstelle_key)
  JOIN core.marke        m  ON m.marke_key = k.marke_key
  LEFT JOIN core.betrieb bt ON bt.betrieb_key = k.betrieb_key
  LEFT JOIN core.ware    w  ON w.ware_key = bp.ware_key
  LEFT JOIN ausreisser   a  ON a.bestellposition_key = bp.bestellposition_key
 WHERE a.bestellposition_key IS NOT NULL
    OR bp.menge IS NULL OR bp.menge <= 0
    OR bp.preis_je_einheit IS NULL;

COMMENT ON VIEW mart.einkauf_pruefung IS
'Positionen, die in der Preisreihe fehlen oder dort auffallen — mit Grund und
dem ueblichen Preis derselben Ware zum Vergleich. Damit die Luecke sichtbar ist
statt still.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0041', to_jsonb(
        'mart.einkaufspreis_monat fuehrt den Preis je GEBINDE statt je Einheit. '
        'Anlass: unitQuantity schwankt fuer dieselbe Ware um Faktor 140.000 '
        '(0,00035 bis 50), der Gebindepreis hat Median 14,36 EUR bei 310.496 '
        'Positionen. Rezeptrechnung ist NICHT betroffen (zutat.cost ist Euro '
        'je Portion, ohne Einheit).'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
