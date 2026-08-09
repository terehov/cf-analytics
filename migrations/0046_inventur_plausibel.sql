-- ---------------------------------------------------------------------
-- Migration 0046 · Inventurmengen, die nicht in die Spalte passen —
--                  und Werte, die niemand gezaehlt haben kann
--
-- Zwei Befunde aus dem ersten echten Inventurlauf (Lauf 79, 09.08.2026),
-- beide an derselben Wurzel: FoodNotifys `theoreticalStockLevelInBaseUnits`
-- ist fuer einen kleinen Teil der Positionen unbrauchbar.
--
-- BEFUND 1 — der Import scheiterte an neun Posten.
-- `numeric field overflow`: numeric(16,4) fasst hoechstens 12 Vorkomma-
-- stellen. Gemessen wurden Sollmengen bis 6.002.002.000 (sechs Milliarden
-- Zuckersticks) — das passt zwar noch, aber dieselben Antworten enthalten
-- Positionen daneben, die es nicht tun. Vier Inventuren von Wilma Wunder
-- blieben deshalb ungeladen und standen nach drei Versuchen als Fehler in
-- sync.aufgabe.
--
-- BEFUND 2 — was geladen wurde, war teilweise unlesbar.
-- 73 von 79.750 Positionen (0,09 %) tragen einen Sollwert ueber 100.000 EUR,
-- Spitzenwert 80.126.726 EUR fuer Zuckersticks. Das klingt nach einem
-- Randproblem, ist aber keins: die Karte summiert JE INVENTUR, und die 73
-- Ausreisser verteilen sich auf 31 Inventuren. Eine einzige kaputte Zeile
-- macht die ganze Zeile unlesbar — auf ③ Betrieb stand fuer Wilma Wunder
-- Speyer "Soll 680.859 EUR gegen gezaehlt 13.523 EUR".
--
-- Ein zweiter Hinweis auf die Ursache steht in den Daten selbst: dieselbe
-- Ware fuehrt Positionen mit Basiseinheit `g` UND `mpce` (1000 x 4G). Wo
-- FoodNotify die Gebindegroesse in die Basiseinheit multipliziert und das
-- Ergebnis noch einmal umrechnet, entstehen genau solche Zahlen.
--
-- WAS DIESE MIGRATION TUT
--
--   1. Die Mengenspalten werden breiter (numeric(20,4)). Damit laeuft der
--      Import durch, statt an einzelnen Antworten haengenzubleiben — die
--      Rohantwort bleibt in raw.api_antwort ohnehin unveraendert erhalten.
--      Breiter heisst NICHT "wir glauben diesen Zahlen jetzt".
--   2. Die mart-Sichten rechnen nur noch mit PLAUSIBLEN Positionen und
--      sagen daneben, wie viele sie verworfen haben.
--
-- WARUM NICHT DIE ROHZEILEN LOESCHEN: dieselbe Regel wie bei den Stornos
-- (0043) und bei mart.einkauf_position — core ist die Beweissicht, die
-- Bewertung passiert in mart. Wer nachsehen will, warum eine Zaehlung
-- unglaubwuerdig ist, muss die Zeile noch finden koennen.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 1. Breitere Mengenspalten
--
-- numeric(16,4) → numeric(20,4): 16 Vorkommastellen. Die groesste bisher
-- gemessene Menge hat 10 (6.002.002.000); der Abstand ist Absicht, denn
-- die Ursache liegt bei FoodNotify und ist nicht unter unserer Kontrolle.
-- Ein Importlauf, der an einer Zahl scheitert, verliert die ganze
-- Inventur — das waere der teurere Fehler.
--
-- Die beiden Sichten muessen dafuer weichen: Postgres laesst den Typ einer
-- Spalte nicht aendern, solange eine Sicht darauf steht ("cannot alter type
-- of a column used by a view or rule"). Sie werden unten vollstaendig neu
-- angelegt — deshalb DROP und nicht CREATE OR REPLACE.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS mart.inventur_schwund;
DROP VIEW IF EXISTS mart.inventur;

ALTER TABLE core.inventurposition
  ALTER COLUMN soll_menge         TYPE numeric(20,4),
  ALTER COLUMN gezaehlt_menge     TYPE numeric(20,4),
  ALTER COLUMN nachzaehlung_menge TYPE numeric(20,4);

COMMENT ON COLUMN core.inventurposition.soll_menge IS
'theoreticalStockLevelInBaseUnits — der rechnerische Bestand vor der Zaehlung,
in der Basiseinheit (baseUnit).

ACHTUNG, DIESER WERT IST NICHT IMMER BRAUCHBAR (gemessen 09.08.2026): 73 von
79.750 Positionen ergeben einen Sollwert ueber 100.000 EUR, Spitzenwert 80 Mio
EUR fuer Zuckersticks. Dieselbe Ware fuehrt dabei Positionen mit Basiseinheit
`g` und `mpce` nebeneinander — FoodNotify rechnet die Gebindegroesse
offenbar mehrfach in die Basiseinheit hinein. Die Spalte bleibt roh (Beweis-
sicht); gefiltert wird in mart.inventur / mart.inventur_schwund ueber die
Plausibilitaetsgrenze.';


-- ---------------------------------------------------------------------
-- 2. Die Sichten rechnen nur noch mit plausiblen Positionen
--
-- DIE GRENZE IST GEMESSEN, NICHT GERATEN (09.08.2026, 79.750 Positionen):
--
--     Median                     35,28 EUR
--     99. Perzentil           2.596,24 EUR
--     99,9. Perzentil        93.860,61 EUR
--     99,99. Perzentil    1.397.672,28 EUR
--
-- 50.000 EUR je EINZELNER Position liegt deutlich ueber allem, was ein
-- echter Warenbestand in einem Gastronomiebetrieb je ausmacht (die
-- teuerste plausible Position im Bestand liegt im vierstelligen Bereich),
-- und deutlich unter dem, was die kaputten Zeilen ausweisen. 103
-- Positionen fallen darunter.
--
-- Gefiltert wird auf dem WERT, nicht auf der Menge: 6 Milliarden Gramm
-- Zucker sind auffaellig, 6 Milliarden Milliliter Fassbier waeren es
-- ebenso — aber eine Mengengrenze muesste je Einheit anders lauten. Der
-- Euro-Wert ist die gemeinsame Waehrung aller Einheiten.
-- ---------------------------------------------------------------------
CREATE VIEW mart.inventur AS
WITH bewertet AS (
    SELECT p.inventur_key,
           p.inventurposition_key,
           -- Plausibel = ein Positionswert, den ein Lager tatsaechlich
           -- haben kann. Unplausible zaehlen NICHT in die Summen, werden
           -- aber gezaehlt (Spalte `positionen_unplausibel`), damit eine
           -- stille Kuerzung sichtbar bleibt.
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
    -- count(SPALTE), nicht count(*): beim LEFT JOIN zaehlte count(*) bei
    -- einer Inventur ganz ohne geladene Positionen die eine NULL-Zeile mit.
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
     -- Dieselbe Grenze wie in mart.inventur, hier als WHERE: in eine
     -- Schwundsumme gehoert nur, was auch plausibel ist.
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
    -- Prozent als Zahl (23.64), nie als Bruch — AGENTS.md Regel 6.
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
