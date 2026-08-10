-- ---------------------------------------------------------------------
-- Migration 0048 · Die einzelne Zaehlung sichtbar machen
--
-- Bisher endete die Inventur auf ③ Betrieb bei der Kopfzeile: Datum, Art,
-- Status, Positionen, Soll, Gezaehlt, Schwund. Damit sieht man DASS ein
-- Betrieb 5.500 EUR Schwund hat, aber nicht WORAN — und genau das ist die
-- Frage, mit der jemand in eine Inventur schaut. Angefragt am 10.08.2026.
--
-- `mart.inventurposition` ist die Positionsebene dazu: eine Zeile je
-- gezaehlter Ware, mit Mengen, Preis, bewertetem Soll und Ist, der
-- Differenz und dem Kopf daneben (Betrieb, Datum, Status), damit die Sicht
-- allein auskunftsfaehig ist.
--
-- ZWEI DINGE, DIE SIE ANDERS MACHT ALS DIE KOPFSICHT
--
-- 1. SIE FILTERT NICHTS WEG. mart.inventur und mart.inventur_schwund
--    lassen unplausible Positionen aus den Euro-Summen heraus (Migration
--    0046, Grenze 50.000 EUR je Position). Hier bleiben sie STEHEN und
--    tragen ein Kennzeichen — denn wer eine einzelne Zaehlung ansieht,
--    will gerade die Ausreisser finden. Eine Detailsicht, die die
--    auffaelligen Zeilen versteckt, beantwortet die Frage nicht, wegen
--    der man sie geoeffnet hat.
--
-- 2. SIE RECHNET DIE DIFFERENZ IN BEIDE RICHTUNGEN. `differenz_menge`
--    und `differenz_eur` sind Soll minus Gezaehlt: positiv heisst, es
--    fehlt etwas (Schwund), negativ heisst, es ist mehr da als gebucht
--    (Ueberbestand, meist ein Buchungsfehler). Beides ist ein Befund,
--    keins davon ist "richtiger".
--
-- Die Basiseinheit steht bewusst als eigene Spalte neben den Mengen: bei
-- FoodNotify fuehrt dieselbe Ware Positionen in `g` und in `mpce`
-- nebeneinander (0046), und eine Menge ohne ihre Einheit ist hier keine
-- Aussage, sondern eine Falle.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.inventurposition AS
SELECT
    p.inventurposition_key,
    p.inventur_key,
    -- Der Kopf mit dabei, damit die Sicht ohne zweiten Join lesbar ist
    -- und sich nach Betrieb/Datum filtern laesst.
    m.name                       AS marke,
    bt.name                      AS betrieb,
    k.restaurant_name            AS fn_betrieb,
    k.art                        AS bereich,
    i.name                       AS inventur,
    i.erstellt_am::date          AS datum,
    i.status                     AS inventur_status,
    i.status = 'signed'          AS signiert,
    i.status = 'canceled'        AS storniert,

    p.name                       AS ware,
    p.shop_name                  AS lieferant,
    p.basis_einheit,
    p.soll_menge,
    p.gezaehlt_menge,
    p.nachzaehlung_menge,
    p.preis_je_basiseinheit,

    round((p.soll_menge     * p.preis_je_basiseinheit)::numeric, 2) AS soll_eur,
    round((p.gezaehlt_menge * p.preis_je_basiseinheit)::numeric, 2) AS gezaehlt_eur,

    -- Soll minus Gezaehlt: positiv = es fehlt (Schwund), negativ =
    -- Ueberbestand. Beide Richtungen sind ein Befund.
    (p.soll_menge - p.gezaehlt_menge)                               AS differenz_menge,
    round(((p.soll_menge - p.gezaehlt_menge)
           * p.preis_je_basiseinheit)::numeric, 2)                  AS differenz_eur,

    -- Fehlmenge in Prozent des Sollbestands — als Zahl (23.64), nie als
    -- Bruch (AGENTS.md Regel 6). NULL, wo kein Soll gebucht war: 100 %
    -- Schwund auf einem Sollbestand von null waere eine erfundene Zahl.
    CASE WHEN p.soll_menge > 0
         THEN round((100 * (p.soll_menge - p.gezaehlt_menge)
                     / p.soll_menge)::numeric, 1)
    END                                                             AS differenz_pct,

    -- Dieselbe Grenze wie in 0046 — hier aber als KENNZEICHEN, nicht als
    -- Filter: die Detailsicht zeigt gerade die Ausreisser.
    (coalesce(p.soll_menge     * p.preis_je_basiseinheit, 0) > 50000
     OR coalesce(p.gezaehlt_menge * p.preis_je_basiseinheit, 0) > 50000)
                                                                    AS unplausibel,
    p.ware_key,
    bt.betrieb_key
  FROM core.inventurposition p
  JOIN core.inventur         i  USING (inventur_key)
  JOIN core.kostenstelle     k  USING (kostenstelle_key)
  JOIN core.marke            m  ON m.marke_key = k.marke_key
  LEFT JOIN core.betrieb     bt ON bt.betrieb_key = k.betrieb_key;

COMMENT ON VIEW mart.inventurposition IS
'Die einzelne Zaehlung: eine Zeile je Ware und Inventur, mit Mengen, Preis je
Basiseinheit, bewertetem Soll und Ist sowie der Differenz. Der Inventurkopf
(Betrieb, Datum, Status) steht mit dabei, damit sich die Sicht allein filtern
laesst.

`differenz_menge` / `differenz_eur` sind SOLL MINUS GEZAEHLT: positiv heisst,
es fehlt etwas (Schwund); negativ heisst, es ist mehr da als gebucht
(Ueberbestand, meist ein Buchungsfehler).

ANDERS ALS mart.inventur FILTERT DIESE SICHT NICHTS WEG. Unplausible
Positionen (Migration 0046: Positionswert ueber 50.000 EUR, FoodNotify-
Artefakte) bleiben stehen und tragen `unplausibel = true` — wer eine einzelne
Zaehlung ansieht, sucht gerade die Ausreisser. Fuer Summen und Schwundquoten
gilt weiterhin mart.inventur bzw. mart.inventur_schwund, die sie ausnehmen.

DIE BASISEINHEIT GEHOERT ZUR MENGE: dieselbe Ware fuehrt bei FoodNotify
Positionen in `g` und in `mpce` nebeneinander. Eine Menge ohne ihre Einheit
ist hier keine Aussage.';

CREATE INDEX IF NOT EXISTS inventurposition_inventur
  ON core.inventurposition (inventur_key);
