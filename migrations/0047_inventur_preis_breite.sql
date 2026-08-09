-- ---------------------------------------------------------------------
-- Migration 0047 · Der Preis war die engste Spalte, nicht die Menge
--
-- NACHTRAG ZU 0046, und eine Korrektur an dessen Begruendung.
--
-- 0046 verbreiterte die MENGEN-Spalten gegen den `numeric field overflow`
-- aus Lauf 79. Nachgemessen am 10.08.2026 traegt diese Begruendung nicht:
--
--     numeric(16,4) fasst 999.999.999.999 (zwoelf Vorkommastellen)
--     der groesste gemessene Rohwert  6.002.002.000 (zehn Stellen)
--
-- Der bekannte Hoechstwert passte also laengst hinein. Ueber ALLE 79.750
-- erfolgreich geladenen Positionen gemessen (aus raw.api_antwort, Huelle
-- {data, pagination}):
--
--     theoreticalStockLevelInBaseUnits  hoechstens 10 Vorkommastellen
--     countedAmountInBaseUnits          hoechstens  8
--     reviewAmountInBaseUnits           hoechstens  8
--     pricePerBaseUnit                  hoechstens  2
--
-- WARUM DIE VERURSACHENDEN WERTE NICHT MESSBAR SIND: `fnLaden` schreibt
-- raw.api_antwort und core.inventurposition in EINER Transaktion. Scheitert
-- das core-INSERT, rollt der raw-INSERT mit zurueck — von den vier
-- gescheiterten Inventuren existiert deshalb keine Rohantwort. Die Zahl,
-- die den Overflow ausgeloest hat, steht nirgends; sie ist nur aus dem
-- Fehler selbst bekannt.
--
-- DESHALB DIESE MIGRATION. `preis_je_basiseinheit` blieb in 0046
-- unangetastet und ist mit numeric(14,6) die MIT ABSTAND ENGSTE Spalte:
-- nur ACHT Vorkommastellen, gegen zwoelf bei den Mengen. Ist der Preis in
-- einer der vier Antworten ebenso verrechnet wie die Sollmengen
-- (Gebindegroesse mehrfach einmultipliziert, siehe 0046), lief er als
-- erstes ueber. Das ist der wahrscheinlichste verbliebene Kandidat.
--
-- numeric(14,6) → numeric(20,6): sechzehn Vorkommastellen, dieselbe Reserve
-- wie bei den Mengen. Die sechs Nachkommastellen bleiben — Preise je
-- Basiseinheit sind winzig (0,003338 EUR je Gramm), da zaehlt jede Stelle.
--
-- OB ES REICHT, ZEIGT DER NAECHSTE LAUF. Die vier Posten stehen bei zwei
-- bis drei Versuchen (Grenze vier) und laufen von selbst nach. Bleiben sie
-- danach als Fehler stehen, ist die Ursache eine andere — dann steht die
-- Antwort aber immer noch nicht in raw, und der naechste Schritt waere,
-- den Raw-Schreibvorgang aus der Transaktion zu loesen, damit die
-- verursachende Antwort ueberhaupt sichtbar wird (docs/offene-punkte.md).
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS mart.inventur_schwund;
DROP VIEW IF EXISTS mart.inventur;

ALTER TABLE core.inventurposition
  ALTER COLUMN preis_je_basiseinheit TYPE numeric(20,6);

COMMENT ON COLUMN core.inventurposition.preis_je_basiseinheit IS
'pricePerBaseUnit — bereits in derselben Basiseinheit wie soll_menge und
gezaehlt_menge. Multipliziert mit der Differenz aus soll_menge und
gezaehlt_menge ergibt sich der bewertete Schwund in Euro.

Breite 20,6 seit Migration 0047: mit numeric(14,6) war dies die engste Spalte
der Tabelle (acht Vorkommastellen gegen zwoelf bei den Mengen) und damit der
wahrscheinlichste Ausloeser des `numeric field overflow` aus Lauf 79. Gemessene
Preise sind winzig (0,003338 EUR je Gramm), die sechs Nachkommastellen bleiben
deshalb.';

-- Die beiden Sichten unveraendert aus 0046 wiederherstellen. Sie muessen
-- weichen, weil Postgres den Spaltentyp sonst nicht aendern laesst; ihr
-- Inhalt ist derselbe wie dort, samt Plausibilitaetsgrenze.
CREATE VIEW mart.inventur AS
WITH bewertet AS (
    SELECT p.inventur_key,
           p.inventurposition_key,
           (p.soll_menge     * p.preis_je_basiseinheit) AS soll_wert,
           (p.gezaehlt_menge * p.preis_je_basiseinheit) AS gezaehlt_wert,
           (coalesce(p.soll_menge     * p.preis_je_basiseinheit, 0) <= 50000
            AND coalesce(p.gezaehlt_menge * p.preis_je_basiseinheit, 0) <= 50000)
             AS plausibel
      FROM core.inventurposition p
)
SELECT
    i.inventur_key,
    m.name                       AS marke,
    k.restaurant_name            AS fn_betrieb,
    bt.name                      AS betrieb,
    k.art                        AS bereich,
    i.name,
    i.art,
    i.status,
    i.status = 'signed'          AS signiert,
    i.status = 'canceled'        AS storniert,
    i.erstellt_am,
    i.erstellt_am::date          AS datum,
    i.geaendert_am,
    i.anzahl_positionen          AS positionen_erwartet,
    count(b.inventurposition_key)::int AS positionen_geladen,
    count(b.inventurposition_key) FILTER (WHERE NOT b.plausibel)::int
      AS positionen_unplausibel,
    round(sum(b.soll_wert)     FILTER (WHERE b.plausibel)::numeric, 2) AS soll_bewertet,
    round(sum(b.gezaehlt_wert) FILTER (WHERE b.plausibel)::numeric, 2) AS gezaehlt_bewertet,
    round((sum(b.soll_wert)     FILTER (WHERE b.plausibel)
         - sum(b.gezaehlt_wert) FILTER (WHERE b.plausibel))::numeric, 2) AS schwund_eur
  FROM core.inventur             i
  JOIN core.kostenstelle         k  USING (kostenstelle_key)
  JOIN core.marke                m  ON m.marke_key = k.marke_key
  LEFT JOIN core.betrieb         bt ON bt.betrieb_key = k.betrieb_key
  LEFT JOIN bewertet             b  ON b.inventur_key = i.inventur_key
 GROUP BY i.inventur_key, m.name, k.restaurant_name, bt.name, k.art,
          i.name, i.art, i.status, i.erstellt_am, i.geaendert_am,
          i.anzahl_positionen;

COMMENT ON VIEW mart.inventur IS
'Inventurkoepfe mit bewertetem Soll- und Zaehlbestand, eine Zeile je Inventur.
LOHNEND FAST NUR BEI WILMA WUNDER (278 Stueck, 157 signiert; Enchilada 49,
Aposto 19, Deutsche Konzepte 9 — gemessen 09.08.2026 nach dem ersten echten
Lauf). STORNIERTE UND UNSIGNIERTE INVENTUREN STEHEN HIER MIT DRIN (Beweissicht
wie mart.einkauf_position) und sind an `storniert` bzw. `signiert` erkennbar.

UNPLAUSIBLE POSITIONEN SIND AUS DEN EURO-SUMMEN AUSGENOMMEN: FoodNotifys
Sollmenge ist fuer einen kleinen Teil der Positionen unbrauchbar (Migration
0046). Wie viele es je Inventur waren, steht in `positionen_unplausibel` —
eine Zeile mit hohem Wert dort ist mit Vorsicht zu lesen.

Wer eine Schwundaussage treffen will, nimmt mart.inventur_schwund: die rechnet
nur mit signierten, nicht stornierten Inventuren.';

CREATE VIEW mart.inventur_schwund AS
WITH bewertet AS (
    SELECT p.inventur_key,
           (p.soll_menge     * p.preis_je_basiseinheit) AS soll_wert,
           (p.gezaehlt_menge * p.preis_je_basiseinheit) AS gezaehlt_wert
      FROM core.inventurposition p
     WHERE coalesce(p.soll_menge     * p.preis_je_basiseinheit, 0) <= 50000
       AND coalesce(p.gezaehlt_menge * p.preis_je_basiseinheit, 0) <= 50000
)
SELECT
    bt.betrieb_key,
    bt.name AS betrieb,
    m.name  AS marke,
    date_trunc('month', i.erstellt_am)::date AS monat,
    count(DISTINCT i.inventur_key)                                   AS inventuren,
    count(DISTINCT i.inventur_key) FILTER (WHERE i.status = 'signed') AS inventuren_signiert,
    round(sum(b.soll_wert)     FILTER (WHERE i.status = 'signed')::numeric, 2) AS soll_eur,
    round(sum(b.gezaehlt_wert) FILTER (WHERE i.status = 'signed')::numeric, 2) AS gezaehlt_eur,
    round((sum(b.soll_wert)     FILTER (WHERE i.status = 'signed')
         - sum(b.gezaehlt_wert) FILTER (WHERE i.status = 'signed'))::numeric, 2) AS schwund_eur,
    CASE WHEN sum(b.soll_wert) FILTER (WHERE i.status = 'signed') > 0
         THEN round((100 * (sum(b.soll_wert)     FILTER (WHERE i.status = 'signed')
                          - sum(b.gezaehlt_wert) FILTER (WHERE i.status = 'signed'))
                    / sum(b.soll_wert) FILTER (WHERE i.status = 'signed'))::numeric, 2)
    END AS schwund_pct
  FROM core.inventur              i
  JOIN core.kostenstelle          k  USING (kostenstelle_key)
  JOIN core.marke                 m  ON m.marke_key = k.marke_key
  JOIN core.betrieb               bt ON bt.betrieb_key = k.betrieb_key
  LEFT JOIN bewertet              b  ON b.inventur_key = i.inventur_key
 WHERE i.status IS DISTINCT FROM 'canceled'
 GROUP BY bt.betrieb_key, bt.name, m.name, date_trunc('month', i.erstellt_am);

COMMENT ON VIEW mart.inventur_schwund IS
'Bewerteter Schwund (Soll minus gezaehlt, bewertet mit dem Preis je
Basiseinheit) je Betrieb und Monat. NUR SIGNIERTE Inventuren zaehlen in den
Euro-Spalten mit, stornierte sind komplett ausgeschlossen (WHERE) — eine
laufende oder verworfene Zaehlung ist kein Ergebnis.

UNPLAUSIBLE POSITIONEN SIND AUSGESCHLOSSEN (Migration 0046): Positionswerte
ueber 50.000 EUR sind FoodNotify-Artefakte, nicht Warenbestand. Der Median
einer Position liegt bei 35 EUR, das 99. Perzentil bei 2.596 EUR.

EINE FLAECHIGE AUSSAGE UEBER ALLE MARKEN IST NICHT MOEGLICH: belastbar viele
Inventuren hat praktisch nur Wilma Wunder.';
