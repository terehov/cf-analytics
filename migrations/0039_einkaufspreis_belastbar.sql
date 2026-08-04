-- ---------------------------------------------------------------------
-- Migration 0039 · Die Preissichten rechnen nicht mehr selbst
--
-- Bis heute teilte `mart.einkaufspreis_monat` Summe durch Gesamtmenge und
-- glaubte beiden Zahlen. Das Ergebnis stand am 03.08.2026 in der Karte:
-- **48.400 EUR/kg fuer Kaffee**, weil FoodNotify die Gebindegroesse
-- derselben Ware mal mit 50 und mal mit 1 meldet (Migration 0042).
--
-- Die Pruefung gehoert dorthin, wo die Daten ankommen, nicht in jede
-- Sicht, die sie liest: `core.bestellposition.preis_je_einheit` traegt
-- den Preis nur, wenn die Menge gegen `menge x Gebinde x Inhalt`
-- bestaetigt ist. Diese Sichten lesen ihn jetzt, statt ihn neu zu bilden.
--
-- Was das aendert: unstimmige Positionen verschwinden aus der Preisreihe
-- und tauchen in `mart.einkauf_pruefung` wieder auf. Sie sind nicht
-- verloren -- sie stehen nur nicht mehr als Preis da, den sie nie waren.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.einkaufspreis_monat AS
WITH basis AS (
    SELECT
        w.name  AS ware,
        m.name  AS marke,
        bp.einheit,
        date_trunc('month', b.bestellt_am)::date AS monat,
        bp.summe_preis,
        bp.gesamt_menge,
        -- GELESEN, nicht gerechnet: die Pruefung steckt in der Spalte.
        bp.preis_je_einheit
      FROM core.bestellposition bp
      JOIN core.bestellung b USING (bestellung_key)
      JOIN core.kostenstelle k USING (kostenstelle_key)
      JOIN core.marke m ON m.marke_key = k.marke_key
      JOIN core.ware  w ON w.ware_key = bp.ware_key
     WHERE b.bestellt_am IS NOT NULL
       AND bp.preis_je_einheit IS NOT NULL
       AND bp.preis_je_einheit > 0
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
'Einkaufspreis je Ware und Monat. Liest core.bestellposition.preis_je_einheit --
dort steht er nur, wenn die Gesamtmenge gegen menge x Gebinde x Inhalt
bestaetigt werden konnte. Gruppiert ueber den NAMEN: FoodNotify vergibt je
Betrieb eigene Waren-IDs. Median statt Mittelwert, weil Fehlbuchungen den
Mittelwert wegziehen.';


-- ---------------------------------------------------------------------
-- Was NICHT in der Preisreihe steht — und warum
--
-- Eine ausgeschlossene Zeile, die nirgends auftaucht, ist eine stille
-- Kuerzung. Diese Sicht macht sie sichtbar: Menge und Summe stimmen, nur
-- der Preis je Einheit war nicht zu bilden.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.einkauf_pruefung AS
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
    CASE
      WHEN bp.gesamt_menge IS NULL OR bp.gesamt_menge <= 0
        THEN 'keine Gesamtmenge gemeldet'
      ELSE 'Gebindegroesse widerspricht der Gesamtmenge'
    END AS grund
  FROM core.bestellposition bp
  JOIN core.bestellung   b  USING (bestellung_key)
  JOIN core.kostenstelle k  USING (kostenstelle_key)
  JOIN core.marke        m  ON m.marke_key = k.marke_key
  LEFT JOIN core.betrieb bt ON bt.betrieb_key = k.betrieb_key
  LEFT JOIN core.ware    w  ON w.ware_key = bp.ware_key
 WHERE bp.menge_unstimmig OR bp.preis_je_einheit IS NULL;

COMMENT ON VIEW mart.einkauf_pruefung IS
'Positionen, die keinen belastbaren Preis je Einheit haben. Sie fehlen in
mart.einkaufspreis_monat -- hier stehen sie mit Grund, damit die Luecke
sichtbar ist statt still.';


-- Die Veraenderungssicht folgt automatisch, sie liest die Monatssicht.
-- Neu angelegt, damit sie die geaenderten Spalten sieht.
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


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0039', to_jsonb(
        'mart.einkaufspreis_monat liest preis_je_einheit statt selbst zu rechnen; '
        'mart.einkauf_pruefung zeigt die ausgeschlossenen Positionen mit Grund. '
        'Anlass: 48.400 EUR/kg fuer Kaffee durch uneinheitliche Gebindegroesse.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
