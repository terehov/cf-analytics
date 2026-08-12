-- =====================================================================
-- "Haus" heisst hier Betrieb — auch in den Daten
--
-- Vorgabe vom 12.08.2026: durchgehend, ueber alle Dashboards und Charts,
-- heisst es Betrieb und nicht Haus. In den Kartentexten ist das eine
-- Wortersetzung. An einer Stelle steht das Wort aber IN DER DATENBANK:
-- mart.einkaufspreis_betrieb.sperre traegt seit 0063 die Beschriftung
-- 'zu wenige Häuser (unter 3)' als Wert, und der Drill-Down filtert
-- darauf.
--
-- UND DESHALB WANDERT DIE FALLUNTERSCHEIDUNG EINE ETAGE HOCH. Sie stand in
-- der materialisierten Sicht; eine Beschriftung dort zu aendern heisst
-- DROP ... CASCADE und Neuaufbau von 278.054 Zeilen — fuer ein Wort. In
-- der Sicht darueber ist derselbe Fall ein CREATE OR REPLACE VIEW von
-- Millisekunden. Die Sperre wird ohnehin aus vier Spalten gerechnet, die
-- in der Materialisierung liegen (betriebe_operativ, gebinde_uneinheitlich,
-- menge_widerspruechlich, spreizung_zu_gross) — der CASE kostet nichts.
--
-- REGEL DAHINTER, fuer den naechsten Fall: in die materialisierte Sicht
-- gehoert, was gerechnet werden muss. Beschriftungen gehoeren in die Sicht
-- darueber. Was jemand irgendwann umbenennt, darf nicht in einer Tabelle
-- festliegen, die man nur mit CASCADE aendern kann.
--
-- Der Index auf sperre faellt damit weg. Er war ohnehin wirkungslos: die
-- Karten filtern ueber monat und operativ, und 278.054 Zeilen sequenziell
-- zu lesen kostet gemessen 196 ms.
-- =====================================================================

DROP MATERIALIZED VIEW mart.einkaufspreis_betrieb_basis CASCADE;

CREATE MATERIALIZED VIEW mart.einkaufspreis_betrieb_basis AS
WITH basis AS (
  SELECT w.name                        AS ware,
         bp.einheit,
         k.betrieb_key,
         coalesce(g.dach_name, core.kreditor_name_norm(l.name)) AS lieferant,
         k.art                          AS bereich,
         date_trunc('month', b.bestellt_am)::date AS monat,
         bp.menge,
         bp.gebinde_menge,
         bp.gesamt_menge,
         bp.summe_preis,
         bp.preis_je_einheit,
         bp.summe_preis / bp.menge      AS preis_je_gebinde
    FROM core.bestellposition bp
    JOIN core.bestellung   b USING (bestellung_key)
    JOIN core.kostenstelle k USING (kostenstelle_key)
    JOIN core.ware         w ON w.ware_key = bp.ware_key
    LEFT JOIN core.lieferant l ON l.lieferant_key = b.lieferant_key
    LEFT JOIN manual.kreditor_gruppe g
           ON g.name_norm = core.kreditor_name_norm(l.name)
   WHERE b.bestellt_am IS NOT NULL
     AND bp.menge             > 0
     AND bp.summe_preis       > 0
     AND bp.preis_je_einheit IS NOT NULL
     AND NOT bp.menge_unstimmig
     AND b.status IS DISTINCT FROM 'canceled'
     AND k.betrieb_key IS NOT NULL
), je_betrieb AS (
  SELECT ware, einheit, betrieb_key, monat,
         mode() WITHIN GROUP (ORDER BY bereich)       AS bereich,
         string_agg(DISTINCT lieferant, ', ')         AS lieferanten,
         count(*)                                     AS bestellungen,
         sum(menge)                                   AS gebinde,
         sum(gesamt_menge)                            AS menge,
         sum(summe_preis)                             AS ausgaben,
         mode() WITHIN GROUP (ORDER BY gebinde_menge) AS gebinde_typisch,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY preis_je_einheit::float8)::numeric AS preis,
         min(preis_je_einheit)                        AS preis_min,
         max(preis_je_einheit)                        AS preis_max,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY preis_je_gebinde::float8)::numeric AS preis_je_gebinde
    FROM basis
   GROUP BY ware, einheit, betrieb_key, monat
), vergleich AS (
  SELECT ware, einheit, monat,
         count(*) FILTER (WHERE operativ)              AS betriebe_operativ,
         count(*)                                      AS betriebe_gesamt,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY CASE WHEN operativ THEN preis END::float8)::numeric AS median_preis,
         min(preis) FILTER (WHERE operativ)            AS bester_preis,
         max(preis) FILTER (WHERE operativ)            AS schlechtester_preis,
         (count(DISTINCT gebinde_typisch) > 1)         AS gebinde_uneinheitlich,
         coalesce(
           max(preis) / nullif(min(preis), 0)
             > 1.5 * (max(preis_je_gebinde) / nullif(min(preis_je_gebinde), 0)),
           false)                                      AS menge_widerspruechlich,
         coalesce(
           max(preis) FILTER (WHERE operativ)
             / nullif(min(preis) FILTER (WHERE operativ), 0) > 3,
           false)                                      AS spreizung_zu_gross
    FROM (SELECT jb.*, (st.status = 'operativ') AS operativ
            FROM je_betrieb jb
            LEFT JOIN mart.betrieb_status st ON st.betrieb_key = jb.betrieb_key) x
   GROUP BY ware, einheit, monat
)
SELECT jb.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       jb.monat,
       jb.ware,
       jb.einheit,
       jb.bereich,
       jb.lieferanten,
       jb.bestellungen,
       jb.gebinde,
       jb.menge,
       round(jb.ausgaben, 2)          AS ausgaben,
       round(jb.preis, 4)             AS preis,
       round(jb.preis_min, 4)         AS preis_min,
       round(jb.preis_max, 4)         AS preis_max,
       round(jb.preis_je_gebinde, 2)  AS preis_je_gebinde,
       v.betriebe_operativ,
       v.betriebe_gesamt,
       v.gebinde_uneinheitlich,
       v.menge_widerspruechlich,
       v.spreizung_zu_gross,
       round(v.median_preis, 4)        AS konzern_median,
       round(v.bester_preis, 4)        AS konzern_bester,
       round(v.schlechtester_preis, 4) AS konzern_schlechtester,
       (v.betriebe_operativ >= 3
        AND NOT v.gebinde_uneinheitlich
        AND NOT v.menge_widerspruechlich
        AND NOT v.spreizung_zu_gross)     AS vergleichbar,
       CASE WHEN v.betriebe_operativ >= 3
             AND NOT v.gebinde_uneinheitlich
             AND NOT v.menge_widerspruechlich
             AND NOT v.spreizung_zu_gross
             AND v.median_preis > 0
            THEN round(100 * (jb.preis / v.median_preis - 1), 1)
       END                             AS abweichung_pct,
       CASE WHEN v.betriebe_operativ >= 3
             AND NOT v.gebinde_uneinheitlich
             AND NOT v.menge_widerspruechlich
             AND NOT v.spreizung_zu_gross
             AND v.median_preis > 0
            THEN round((jb.preis - v.median_preis) * jb.menge, 2)
       END                             AS mehrkosten,
       jb.gebinde_typisch
  FROM je_betrieb jb
  JOIN vergleich v USING (ware, einheit, monat)
  JOIN core.betrieb b                 ON b.betrieb_key  = jb.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = jb.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = jb.betrieb_key;

CREATE UNIQUE INDEX einkaufspreis_betrieb_basis_korn
    ON mart.einkaufspreis_betrieb_basis (ware, einheit, betrieb_key, monat);
CREATE INDEX einkaufspreis_betrieb_basis_monat
    ON mart.einkaufspreis_betrieb_basis (monat);
CREATE INDEX einkaufspreis_betrieb_basis_betrieb
    ON mart.einkaufspreis_betrieb_basis (betrieb_key);

COMMENT ON MATERIALIZED VIEW mart.einkaufspreis_betrieb_basis IS
'Rechenstand von mart.einkaufspreis_betrieb, aufgefrischt im Sync-Nachlauf. NICHT direkt
abfragen — die Sicht darueber ist die dokumentierte Schnittstelle, traegt die Erklaerung
der vier Sperren und benennt sie. Beschriftungen stehen bewusst NICHT hier: sie zu aendern
hiesse sonst DROP ... CASCADE und Neuaufbau (0065).';

CREATE VIEW mart.einkaufspreis_betrieb AS
SELECT betrieb_key, betrieb, konzept, betrieb_status, operativ, monat,
       ware, einheit, bereich, lieferanten, bestellungen, gebinde, menge,
       ausgaben, preis, preis_min, preis_max, preis_je_gebinde,
       betriebe_operativ, betriebe_gesamt,
       gebinde_uneinheitlich, menge_widerspruechlich, spreizung_zu_gross,
       konzern_median, konzern_bester, konzern_schlechtester,
       vergleichbar, abweichung_pct, mehrkosten,
       /*
        * Die Sperre als Text — hier und nicht in der Materialisierung,
        * siehe Kopf. Reihenfolge ist Teil der Aussage: ein Fall kann
        * mehrere Sperren reissen, genannt wird die erste. "zu wenige
        * Betriebe" steht zuoberst, weil es der Normalfall ist und kein
        * Datenproblem — unter drei Betrieben gibt es keinen Massstab,
        * egal wie sauber gebucht wurde.
        */
       CASE WHEN betriebe_operativ < 3    THEN 'zu wenige Betriebe (unter 3)'
            WHEN gebinde_uneinheitlich    THEN 'Gebinde uneinheitlich'
            WHEN menge_widerspruechlich   THEN 'Menge widersprüchlich'
            WHEN spreizung_zu_gross       THEN 'Spreizung über Faktor 3'
            ELSE 'vergleichbar'
       END                             AS sperre,
       gebinde_typisch
  FROM mart.einkaufspreis_betrieb_basis;

COMMENT ON VIEW mart.einkaufspreis_betrieb IS
'Was JEDER Betrieb fuer eine Ware zahlt, mit dem Konzernmassstab daneben. Eine Zeile je
Ware, Einheit, Betrieb und Monat. Ausfuehrlich kommentiert in 0057; seit 0063
materialisiert (mart.einkaufspreis_betrieb_basis), seit 0065 traegt diese Sicht die
Beschriftung der Sperre.

IMMER AUF vergleichbar = true FILTERN. Ohne diesen Filter stehen Mengenartefakte als
Preisbefunde da, und zwar die spektakulaersten zuoberst.

VIER SPERREN, jede setzt vergleichbar = false, und sperre nennt die erste, die greift:
  betriebe_operativ < 3      — unter drei Betrieben ist der "Median" nur der andere Betrieb
  gebinde_uneinheitlich      — die Betriebe buchen verschiedene Gebindegroessen
  menge_widerspruechlich     — die Basiseinheit streut deutlich weiter als der Gebindepreis
  spreizung_zu_gross         — die operativen Betriebe liegen um mehr als Faktor 3 auseinander';

COMMENT ON COLUMN mart.einkaufspreis_betrieb.sperre IS
'Welche der vier Sperren diese Ware vom Preisvergleich ausschliesst, oder "vergleichbar".
Reisst ein Fall mehrere, steht die erste da. Filter des Drill-Downs dd_sperre.';
COMMENT ON COLUMN mart.einkaufspreis_betrieb.gebinde_typisch IS
'Haeufigste Gebindegroesse dieses Betriebs fuer diese Ware im Monat (Modus). Gehen die
Zahlen zwischen den Betrieben auseinander, ist gebinde_uneinheitlich = true.';
