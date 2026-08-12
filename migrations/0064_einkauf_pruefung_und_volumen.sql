-- =====================================================================
-- Die letzten zwei vollen Durchlaeufe ueber die Bestellpositionen
--
-- 0063 hat die Einkaufsseiten aus den Minuten geholt. Nachgemessen an der
-- fertigen Seite (alle Karten gleichzeitig, wie im Browser):
--
--   Dashboard 26 Fremdeinkauf   12 Karten   2,7 s gesamt
--   Dashboard 16 Einkauf        10 Karten   5,8 s gesamt
--
-- Auf 16 tragen zwei Karten diese 5,8 s praktisch allein:
--
--   Einkaufsvolumen je Betrieb        5.789 ms   (mart.einkauf_betrieb_monat)
--   Auffaellige Einkaufspositionen    4.973 ms   (mart.einkauf_pruefung)
--
-- Alle uebrigen liegen zwischen 128 und 2.234 ms. Beide Sichten lesen
-- 876.611 Bestellpositionen von vorn; einkauf_pruefung bildet dabei je Ware
-- einen Median (percentile_cont ueber 21.338 Warennamen) und braucht allein
-- gemessen 3,0 Sekunden, einkauf_betrieb_monat 1,0 Sekunden.
--
-- Gleiche Bauart wie 0063, gleiche Begruendung, gleiche Regeln: die
-- Aggregation wird materialisiert und einmal je Sync-Lauf gerechnet, die
-- Sicht behaelt Namen, Spalten und Reihenfolge, und Metabase behaelt seine
-- Feld-IDs.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. mart.einkauf_betrieb_monat
--
-- Definition aus 0043 unveraendert. Nur der Schluessel kommt dazu: bereich
-- (k.art) darf NULL sein, und ueber NULL vergleicht REFRESH CONCURRENTLY
-- nicht — dieselbe Ueberlegung wie bei mart.einkauf_kreditor_monat.
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mart.einkauf_betrieb_monat_basis AS
WITH zeilen AS (
  SELECT
      bt.betrieb_key,
      bt.name AS betrieb,
      m.name  AS marke,
      k.art   AS bereich,
      date_trunc('month', b.bestellt_am)::date AS monat,
      count(DISTINCT b.bestellung_key)
          FILTER (WHERE b.status IS DISTINCT FROM 'canceled') AS bestellungen,
      count(*)
          FILTER (WHERE b.status IS DISTINCT FROM 'canceled') AS positionen,
      coalesce(round(sum(bp.summe_preis)
          FILTER (WHERE b.status IS DISTINCT FROM 'canceled'), 2), 0) AS einkauf_netto,
      count(DISTINCT b.lieferant_key)
          FILTER (WHERE b.status IS DISTINCT FROM 'canceled') AS lieferanten,
      count(DISTINCT b.bestellung_key)
          FILTER (WHERE b.status = 'canceled')                AS bestellungen_storniert,
      coalesce(round(sum(bp.summe_preis)
          FILTER (WHERE b.status = 'canceled'), 2), 0)        AS storniert_netto
    FROM core.bestellposition bp
    JOIN core.bestellung   b  USING (bestellung_key)
    JOIN core.kostenstelle k  USING (kostenstelle_key)
    JOIN core.betrieb      bt ON bt.betrieb_key = k.betrieb_key
    JOIN core.marke        m  ON m.marke_key = k.marke_key
   WHERE b.bestellt_am IS NOT NULL
   GROUP BY bt.betrieb_key, bt.name, m.name, k.art,
            date_trunc('month', b.bestellt_am)
)
SELECT md5(z.betrieb_key::text || '|' || z.marke || '|'
           || coalesce(z.bereich, '') || '|' || z.monat::text) AS zeile_key,
       z.*
  FROM zeilen z;

CREATE UNIQUE INDEX einkauf_betrieb_monat_basis_zeile
    ON mart.einkauf_betrieb_monat_basis (zeile_key);
CREATE INDEX einkauf_betrieb_monat_basis_monat
    ON mart.einkauf_betrieb_monat_basis (monat);
CREATE INDEX einkauf_betrieb_monat_basis_betrieb
    ON mart.einkauf_betrieb_monat_basis (betrieb_key);

COMMENT ON MATERIALIZED VIEW mart.einkauf_betrieb_monat_basis IS
'Rechenstand von mart.einkauf_betrieb_monat, aufgefrischt im Sync-Nachlauf
(src/sync/einkauf_sichten.ts). NICHT direkt abfragen — die Sicht darueber ist die
dokumentierte Schnittstelle.';

CREATE OR REPLACE VIEW mart.einkauf_betrieb_monat AS
SELECT betrieb_key, betrieb, marke, bereich, monat,
       bestellungen, positionen, einkauf_netto, lieferanten,
       bestellungen_storniert, storniert_netto
  FROM mart.einkauf_betrieb_monat_basis;


-- ---------------------------------------------------------------------
-- 2. mart.einkauf_pruefung
--
-- Definition aus 0041 unveraendert. Der Schluessel ist hier fachlich schon
-- da — eine Zeile ist genau eine Bestellposition —, er stand nur nicht in
-- der Ausgabe. In der materialisierten Sicht steht er jetzt, in der Sicht
-- darueber weiterhin nicht: eine Schluesselzahl in einer Prueftabelle
-- beantwortet keine Frage, die jemand hat.
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mart.einkauf_pruefung_basis AS
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
    bp.bestellposition_key,
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

CREATE UNIQUE INDEX einkauf_pruefung_basis_position
    ON mart.einkauf_pruefung_basis (bestellposition_key);
CREATE INDEX einkauf_pruefung_basis_datum
    ON mart.einkauf_pruefung_basis (bestelldatum);
CREATE INDEX einkauf_pruefung_basis_marke
    ON mart.einkauf_pruefung_basis (marke);

COMMENT ON MATERIALIZED VIEW mart.einkauf_pruefung_basis IS
'Rechenstand von mart.einkauf_pruefung, aufgefrischt im Sync-Nachlauf. Traegt
zusaetzlich bestellposition_key — die Sicht darueber nicht, dort beantwortet eine
Schluesselzahl keine Frage.';

CREATE OR REPLACE VIEW mart.einkauf_pruefung AS
SELECT marke, betrieb, bestelldatum, bestellnummer, ware,
       menge, gebinde_menge, gesamt_menge, einheit, summe_preis,
       preis_je_gebinde, ueblich, grund
  FROM mart.einkauf_pruefung_basis;
