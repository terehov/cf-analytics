-- ---------------------------------------------------------------------
-- Migration 0035 · Einkauf im Mart — die Ausgangsfrage beantworten
--
-- "Wie haben sich unsere Einkaufspreise entwickelt?" Genau das war der
-- Anlass fuer die FoodNotify-Anbindung (Stufe 1.7 aus plan-foodnotify.md).
--
-- Diese Sichten loesen die stillgelegte `mart.preisentwicklung_ware` ab.
-- Der Unterschied: dort standen 1.111 KATALOGpreise aus einer Demo-
-- Bestueckung von LINA, hier stehen BELEGpreise — was tatsaechlich
-- bestellt und berechnet wurde.
--
-- WAS BEWUSST NICHT DRIN IST.
--
-- Keine Wareneinsatzquote. Die braeuchte Einkauf UND Umsatz im selben
-- Zeitraum, und der Backfill laeuft rueckwaerts: fuer 2026 liegen die
-- Positionen vor, fuer 2021 noch nicht. Eine Quote auf halbem Bestand
-- sieht aus wie eine Kennzahl und ist eine Momentaufnahme des
-- Ladefortschritts. Sie folgt, wenn der Backfill durch ist.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Einkaufspositionen — die Basissicht
--
-- Eine Zeile je bestellter Position, angereichert um Betrieb, Marke und
-- Lieferant. Alles Weitere baut darauf auf.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.einkauf_position AS
SELECT
    bp.bestellposition_key,
    b.bestellung_key,
    m.name                       AS marke,
    k.restaurant_name            AS fn_betrieb,
    -- NULL heisst: Kostenstelle noch keinem LINA-Betrieb zugeordnet
    -- (manual.betrieb_zuordnung_offen). Sichtbar lassen, nicht ausblenden.
    bt.name                      AS betrieb,
    k.art                        AS bereich,
    b.bestellt_am,
    b.bestellt_am::date          AS bestelldatum,
    date_trunc('month', b.bestellt_am)::date AS monat,
    l.name                       AS lieferant,
    w.name                       AS ware,
    w.fn_id                      AS ware_fn_id,
    bp.name                      AS positionsname,
    bp.menge,
    bp.gebinde_menge,
    bp.gesamt_menge,
    bp.einheit,
    bp.einzelpreis,
    bp.summe_preis,
    bp.preis_abweichend,
    bp.ersetzt,
    b.beleg_nummer,
    b.status                     AS bestellstatus
  FROM core.bestellposition bp
  JOIN core.bestellung      b  USING (bestellung_key)
  JOIN core.kostenstelle    k  USING (kostenstelle_key)
  JOIN core.marke           m  ON m.marke_key = k.marke_key
  LEFT JOIN core.betrieb    bt ON bt.betrieb_key = k.betrieb_key
  LEFT JOIN core.lieferant  l  ON l.lieferant_key = b.lieferant_key
  LEFT JOIN core.ware       w  ON w.ware_key = bp.ware_key;

COMMENT ON VIEW mart.einkauf_position IS
'Jede bestellte Position mit Betrieb, Marke, Lieferant und Ware. Echte
Belegpreise aus FoodNotify — nicht Katalogpreise. `betrieb` ist NULL, solange
die Kostenstelle keinem LINA-Betrieb zugeordnet ist.';


-- ---------------------------------------------------------------------
-- Einkaufspreisentwicklung je Ware und Monat — die eigentliche Antwort
--
-- Der Preis je Einheit, nicht je Gebinde: nur so ist "6 Flaschen a 0,75 l"
-- mit "12 Flaschen a 0,7 l" vergleichbar. Ohne diese Umrechnung misst man
-- Gebindegroessen statt Preise.
-- ---------------------------------------------------------------------

/**
 * GRUPPIERT WIRD UEBER DEN NAMEN, NICHT UEBER ware_key.
 *
 * Gemessen am 02.08.2026: 866 Warensaetze tragen nur 428 verschiedene
 * Namen. FoodNotify vergibt je Betrieb und Lieferant eine eigene
 * artikelId — "Secco Bianco Frizzante 0,75l" existiert neunmal, ueber
 * drei Marken verteilt. Nach ware_key gruppiert zerfaellt jede
 * Preisreihe in neun Einzelpunkte mit je einer Bestellung, und die
 * Preisentwicklung — der Zweck dieser Sicht — waere unsichtbar.
 *
 * Der Name traegt bei FoodNotify die Gebindeangabe mit ("Karton 6 x
 * 0,75 l"), ist also praeziser als er aussieht: gleicher Name heisst
 * gleiches Produkt im gleichen Gebinde.
 *
 * Die Einheit kommt von der POSITION, nicht von core.ware — dort sind
 * `einheit` und `basis_einheit` bei allen 866 Saetzen leer.
 */
CREATE OR REPLACE VIEW mart.einkaufspreis_monat AS
WITH basis AS (
    SELECT
        w.name  AS ware,
        m.name  AS marke,
        bp.einheit,
        date_trunc('month', b.bestellt_am)::date AS monat,
        bp.summe_preis,
        bp.gesamt_menge,
        -- Preis je EINHEIT (Liter, Kilo, Stueck). gesamt_menge ist
        -- Gebindezahl x Inhalt; die Division macht Gebinde vergleichbar.
        bp.summe_preis / bp.gesamt_menge AS preis_je_einheit
      FROM core.bestellposition bp
      JOIN core.bestellung b USING (bestellung_key)
      JOIN core.kostenstelle k USING (kostenstelle_key)
      JOIN core.marke m ON m.marke_key = k.marke_key
      JOIN core.ware  w ON w.ware_key = bp.ware_key
     WHERE b.bestellt_am IS NOT NULL
       AND bp.gesamt_menge > 0
       AND bp.summe_preis > 0
)
SELECT
    ware, marke, einheit, monat,
    count(*)                                    AS bestellungen,
    sum(gesamt_menge)                           AS menge,
    sum(summe_preis)                            AS ausgaben,
    -- MEDIAN, nicht Mittelwert: eine einzelne Fehlbuchung (falsche
    -- Gebindezahl, Rueckbelastung) zieht den Mittelwert weg, den Median
    -- nicht. Bei Preisreihen ist der Ausreisser die Regel, nicht die
    -- Ausnahme.
    round(percentile_cont(0.5) WITHIN GROUP (
        ORDER BY preis_je_einheit)::numeric, 4) AS preis_je_einheit_median,
    round(min(preis_je_einheit)::numeric, 4)    AS preis_min,
    round(max(preis_je_einheit)::numeric, 4)    AS preis_max
  FROM basis
 GROUP BY ware, marke, einheit, monat;

COMMENT ON VIEW mart.einkaufspreis_monat IS
'Einkaufspreis je Ware und Monat, umgerechnet auf die Einheit (Liter, Kilo,
Stueck) — sonst vergleicht man Gebindegroessen statt Preise. Gruppiert ueber den
NAMEN: FoodNotify vergibt je Betrieb eigene Waren-IDs, 866 Saetze tragen nur 428
Namen. Median statt Mittelwert, weil Fehlbuchungen den Mittelwert wegziehen.';


-- ---------------------------------------------------------------------
-- Preisveraenderung gegenueber dem Vormonat
--
-- Die Frage hinter der Frage: WAS ist teurer geworden, und um wie viel.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.einkaufspreis_veraenderung AS
WITH mit_vormonat AS (
    SELECT p.*,
           lag(p.preis_je_einheit_median) OVER (
               PARTITION BY p.ware, p.marke ORDER BY p.monat) AS vormonat_preis,
           lag(p.monat) OVER (
               PARTITION BY p.ware, p.marke ORDER BY p.monat) AS vormonat
      FROM mart.einkaufspreis_monat p
)
SELECT
    ware, marke, einheit, monat,
    preis_je_einheit_median AS preis,
    vormonat_preis,
    vormonat,
    -- Nur vergleichen, wenn der Vormonat WIRKLICH der Vormonat ist.
    -- lag() nimmt sonst die letzte vorhandene Zeile — bei einer Ware, die
    -- nur zweimal im Jahr bestellt wird, waere das ein Halbjahressprung,
    -- ausgewiesen als Monatsveraenderung.
    CASE WHEN vormonat = monat - interval '1 month'
          AND vormonat_preis > 0
         THEN round(100.0 * (preis_je_einheit_median - vormonat_preis)
                    / vormonat_preis, 1) END AS veraenderung_pct,
    bestellungen, menge, ausgaben
  FROM mit_vormonat;

COMMENT ON VIEW mart.einkaufspreis_veraenderung IS
'Preisveraenderung je Ware gegenueber dem VORMONAT. veraenderung_pct ist NULL,
wenn der letzte Einkauf laenger her ist als einen Monat — ein Halbjahressprung
als Monatsveraenderung auszuweisen waere eine erfundene Zahl.';


-- ---------------------------------------------------------------------
-- Einkauf je Betrieb und Monat — die Bruecke zu LINA
--
-- Erst diese Sicht steht neben dem Umsatz. Deshalb NUR zugeordnete
-- Betriebe: eine Summe ohne Betrieb liesse sich mit nichts vergleichen.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.einkauf_betrieb_monat AS
SELECT
    bt.betrieb_key,
    bt.name AS betrieb,
    m.name  AS marke,
    k.art   AS bereich,
    date_trunc('month', b.bestellt_am)::date AS monat,
    count(DISTINCT b.bestellung_key) AS bestellungen,
    count(*)                         AS positionen,
    round(sum(bp.summe_preis), 2)    AS einkauf_netto,
    count(DISTINCT b.lieferant_key)  AS lieferanten
  FROM core.bestellposition bp
  JOIN core.bestellung   b  USING (bestellung_key)
  JOIN core.kostenstelle k  USING (kostenstelle_key)
  JOIN core.betrieb      bt ON bt.betrieb_key = k.betrieb_key
  JOIN core.marke        m  ON m.marke_key = k.marke_key
 WHERE b.bestellt_am IS NOT NULL
 GROUP BY bt.betrieb_key, bt.name, m.name, k.art,
          date_trunc('month', b.bestellt_am);

COMMENT ON VIEW mart.einkauf_betrieb_monat IS
'Einkaufsvolumen je Betrieb, Bereich (Bar/Kueche) und Monat. Nur zugeordnete
Betriebe — die Sicht existiert, um neben dem LINA-Umsatz zu stehen.';


-- ---------------------------------------------------------------------
-- Der Ladefortschritt als eigene Sicht
--
-- WARUM DAS HIERHIN GEHOERT: der Backfill laeuft rueckwaerts von heute in
-- die Vergangenheit. Wer im Juli 2026 vollstaendige Daten sieht und im
-- Maerz 2022 fast keine, koennte einen Einbruch vermuten — es ist aber
-- der Ladestand. Diese Sicht sagt, welchem Monat man schon trauen darf.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.einkauf_ladestand AS
SELECT
    m.name AS marke,
    date_trunc('month', b.bestellt_am)::date AS monat,
    count(*)                                        AS bestellungen,
    count(*) FILTER (WHERE b.summe IS NOT NULL)     AS mit_kopfdaten,
    count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM core.bestellposition p
         WHERE p.bestellung_key = b.bestellung_key)) AS mit_positionen,
    round(100.0 * count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM core.bestellposition p
         WHERE p.bestellung_key = b.bestellung_key)) / count(*), 1)
                                                    AS positionen_pct
  FROM core.bestellung b
  JOIN core.kostenstelle k USING (kostenstelle_key)
  JOIN core.marke m ON m.marke_key = k.marke_key
 WHERE b.bestellt_am IS NOT NULL
 GROUP BY m.name, date_trunc('month', b.bestellt_am);

COMMENT ON VIEW mart.einkauf_ladestand IS
'Wie vollstaendig ist ein Monat geladen? Der Backfill laeuft rueckwaerts von
heute; ein duenner Monat in der Vergangenheit ist Ladestand, nicht Einbruch.
Vor jeder Aussage ueber einen Zeitraum hier nachsehen.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0035', to_jsonb(
        'Mart-Sichten Einkauf: einkauf_position, einkaufspreis_monat (Median je '
        'Basiseinheit), einkaufspreis_veraenderung (nur echter Vormonat), '
        'einkauf_betrieb_monat, einkauf_ladestand. Nachfolger der stillgelegten '
        'preisentwicklung_ware mit Belegpreisen statt Katalogpreisen.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
