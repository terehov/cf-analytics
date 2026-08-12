-- =====================================================================
-- Zwei Befunde aus der Dashboard-Durchsicht vom 12.08.2026, beide nur
-- per Migration zu beheben:
--
--   1. mart.datenstand meldete "Umsatz veraltet" ab VIER Tagen — LINA
--      liefert die juengsten fuenf bis sechs Tage aber grundsaetzlich
--      nach (so steht es seit dem 03.08. am ZEITRAUM_CTE und auf ④).
--      Eine Schwelle unterhalb des normalen Nachlaufs meldet jeden Tag
--      Falschalarm, und eine Warnliste, die immer voll ist, liest
--      niemand mehr. Neu: acht Tage — Nachlauf plus Wochenend-Puffer;
--      was dann noch fehlt, fehlt wirklich.
--
--   2. mart.einkauf_pruefung fuehrte keinen bestellung_key. Die
--      Pruefliste auf dem Einkaufs-Dashboard konnte deshalb nicht zum
--      Beleg verlinken — ausgerechnet die Karte, deren Zeilen man ohne
--      den Beleg gar nicht beurteilen kann ("wer eine grosse Abweichung
--      weitergibt, prueft sie vorher am Beleg"). 0064 hatte den
--      Schluessel bewusst weggelassen ("eine Schluesselzahl beantwortet
--      keine Frage") — das stimmte, solange niemand klicken konnte.
--      Jetzt traegt er den Klick, unsichtbar wie in der Bestellliste
--      von ③ (Spalte ausgeblendet, "ansehen →" daneben).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Datenstand: Schwelle acht Tage
--
-- Definition unveraendert aus 0007 bis auf die eine Zahl im befund-CASE.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.datenstand AS
SELECT b.name          AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       b.aktiv,
       b.hat_bwa,
       (b.lina_betrieb_id IS NOT NULL) AS bwa_bruecke,
       u.erster_tag,
       u.letzter_tag,
       u.tage                          AS umsatztage,
       (current_date - u.letzter_tag)  AS umsatz_alter_tage,
       k.letzter_gebuchter_monat       AS bwa_monat,
       CASE WHEN k.letzter_gebuchter_monat IS NOT NULL
            THEN (date_part('year',  age(date_trunc('month', current_date)::date,
                                          k.letzter_gebuchter_monat)) * 12
                + date_part('month', age(date_trunc('month', current_date)::date,
                                          k.letzter_gebuchter_monat)))::int
       END                             AS bwa_verzug_monate,
       a.artikeltage,
       a.letzter_artikeltag,
       p.letzter_personaltag,
       CASE WHEN u.letzter_tag IS NULL                       THEN 'kein Umsatz geladen'
            -- > 8, nicht > 3: LINA fuellt die juengsten 5-6 Tage nach,
            -- ein "veraltet" unterhalb dessen ist Bauart, kein Befund.
            WHEN current_date - u.letzter_tag > 8             THEN 'Umsatz veraltet'
            WHEN k.letzter_gebuchter_monat IS NULL            THEN 'keine BWA gebucht'
            WHEN a.artikeltage = 0                            THEN 'keine Artikeldaten'
            ELSE 'vollstaendig'
       END                             AS befund,
       b.betrieb_key
  FROM core.betrieb b
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = b.betrieb_key
  LEFT JOIN LATERAL (
        SELECT min(geschaeftstag) AS erster_tag, max(geschaeftstag) AS letzter_tag,
               count(*)::int      AS tage
          FROM core.umsatzbericht_tag t
         WHERE t.betrieb_key = b.betrieb_key
           AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL
  ) u ON true
  LEFT JOIN LATERAL (
        SELECT max(monat) AS letzter_gebuchter_monat
          FROM mart.kennzahlen_aktuell ka
         WHERE ka.betrieb_key = b.betrieb_key
           AND ka.wert_absolut IS NOT NULL AND ka.wert_absolut <> 0
  ) k ON true
  LEFT JOIN LATERAL (
        SELECT count(DISTINCT geschaeftstag)::int AS artikeltage,
               max(geschaeftstag)                 AS letzter_artikeltag
          FROM core.artikelverkauf_tag av
         WHERE av.betrieb_key = b.betrieb_key
  ) a ON true
  LEFT JOIN LATERAL (
        SELECT max(zeitraum_bis) AS letzter_personaltag
          FROM core.personalkosten pk
         WHERE pk.betrieb_key = b.betrieb_key
  ) p ON true;

COMMENT ON VIEW mart.datenstand IS
'Wie alt die Daten jedes Betriebs je Quelle sind. befund nennt das dringendste
Problem: kein Umsatz geladen > Umsatz veraltet (aelter als ACHT Tage — LINA
liefert 5-6 Tage grundsaetzlich nach, erst darueber fehlt wirklich etwas) >
keine BWA gebucht > keine Artikeldaten > vollstaendig.';


-- ---------------------------------------------------------------------
-- 2. Einkaufs-Pruefliste: der Weg zum Beleg
--
-- DROP + Neuaufbau, weil eine materialisierte Sicht keine neue Spalte
-- per REPLACE bekommt (dasselbe Verfahren wie 0065). CASCADE reisst
-- mart.einkauf_pruefung mit; sie wird darunter neu angelegt.
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW mart.einkauf_pruefung_basis CASCADE;

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
    b.bestellung_key,
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
zusaetzlich bestellposition_key und bestellung_key; letzterer steht seit 0067
auch in der Sicht darueber — er traegt den Klick zum Beleg.';

CREATE OR REPLACE VIEW mart.einkauf_pruefung AS
SELECT marke, betrieb, bestelldatum, bestellnummer, ware,
       menge, gebinde_menge, gesamt_menge, einheit, summe_preis,
       preis_je_gebinde, ueblich, grund,
       bestellung_key
  FROM mart.einkauf_pruefung_basis;

COMMENT ON VIEW mart.einkauf_pruefung IS
'Bestellpositionen, die im Preisvergleich nicht verwertbar sind oder extrem vom
Ueblichen abweichen (Faktor 20 gegen den Median der Ware). Eine Zeile je
Bestellposition. bestellung_key fuehrt zum Beleg-Drill-Down — in Metabase
ausgeblendet, dort klickt man "ansehen →".';
