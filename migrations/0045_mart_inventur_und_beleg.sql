-- ---------------------------------------------------------------------
-- Migration 0045 · Belegliste und Inventur-Schwund im Mart
--
-- Zwei offene Auswertungen aus der Anfrage des Nutzers, beide auf bereits
-- vorhandenen bzw. gerade angelegten Tabellen:
--
--   (a) Konkrete Bestellungen je Betrieb — eine Belegliste. Die Daten
--       liegen vollstaendig da (core.bestellung/core.bestellposition,
--       mart.einkauf_position). Es fehlte nur der BELEGKOPF: eine Zeile
--       je Bestellung statt je Position, mit dem Storno-Kennzeichen aus
--       Migration 0043.
--
--   (b) Inventuren und bewerteter Schwund, auf core.inventur und
--       core.inventurposition aus Migration 0044. DIESE TABELLEN SIND
--       LEER — der Backfill ist eine bewusste manuelle Entscheidung des
--       Nutzers (AGENTS.md: "bun run einreihen --foodnotify-inventuren")
--       und laeuft NICHT in dieser Migration. Die Sichten sind trotzdem
--       jetzt richtig, damit sie ohne weiteres Zutun anspringen, sobald
--       die erste Inventur geladen ist.
--
-- FACHLICHER VORBEHALT FUER (b), aus dem Kommentar von 0044: Inventuren
-- gibt es praktisch nur bei WILMA WUNDER (275, davon 154 signiert) — bei
-- Aposto (19, 14 signiert) und Deutsche Konzepte (9, davon 5 storniert)
-- ist eine inventurgestuetzte Schwundrechnung praktisch nicht moeglich.
-- Die Sichten werden trotzdem fuer alle vier Marken angelegt (dieselbe
-- Mandantenlogik wie core.bestellung), tragen den Vorbehalt aber bis in
-- die Kartenbeschreibung.
--
-- STORNOS UND UNSIGNIERTE INVENTUREN: 'canceled' wird komplett
-- ausgeschlossen (kein Beleg, keine Bewertung), 'signed' gegenueber jedem
-- anderen Status (typischerweise 'counting', eine laufende Zaehlung)
-- unterschieden. Eine noch nicht signierte Inventur ist keine
-- abgeschlossene Zaehlung — sie bleibt in der Detailliste SICHTBAR und
-- GEKENNZEICHNET (wie Stornos in mart.einkauf_position, 0043: Beweissicht
-- statt stille Kuerzung), geht aber NICHT in die bewerteten Euro-Summen
-- von mart.inventur_schwund ein.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 1. Belegkopf je Bestellung
--
-- mart.einkauf_position ist die Beweissicht je POSITION (0043). Fuer eine
-- Belegliste braucht es eine Zeile je BESTELLUNG — sonst sieht man eine
-- Bestellung mit zwoelf Positionen als zwoelf Zeilen und haelt es fuer
-- zwoelf Bestellungen.
--
-- LEFT JOIN auf core.betrieb wie in mart.einkauf_position: NULL heisst
-- "Kostenstelle noch keinem LINA-Betrieb zugeordnet", nicht "kein
-- Beleg". Genau wie dort bleibt das sichtbar statt ausgeblendet.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.einkauf_beleg AS
SELECT
    b.bestellung_key,
    m.name                       AS marke,
    k.restaurant_name            AS fn_betrieb,
    bt.name                      AS betrieb,
    k.art                        AS bereich,
    b.bestellnummer,
    b.beleg_nummer,
    b.bestellt_am,
    b.bestellt_am::date          AS bestelldatum,
    date_trunc('month', b.bestellt_am)::date AS monat,
    b.geliefert_am               AS lieferdatum,
    l.name                       AS lieferant,
    b.status                     AS bestellstatus,
    -- Wie mart.einkauf_position (0043): IS NOT DISTINCT FROM statt '=',
    -- ein unbekannter Status (NULL) gilt NICHT als storniert.
    b.status IS NOT DISTINCT FROM 'canceled' AS storniert,
    count(bp.bestellposition_key)::int       AS positionen,
    round(coalesce(sum(bp.summe_preis), 0), 2) AS summe
  FROM core.bestellung        b
  JOIN core.kostenstelle      k  USING (kostenstelle_key)
  JOIN core.marke             m  ON m.marke_key = k.marke_key
  LEFT JOIN core.betrieb      bt ON bt.betrieb_key = k.betrieb_key
  LEFT JOIN core.lieferant    l  ON l.lieferant_key = b.lieferant_key
  LEFT JOIN core.bestellposition bp USING (bestellung_key)
 WHERE b.bestellt_am IS NOT NULL
 GROUP BY b.bestellung_key, m.name, k.restaurant_name, bt.name, k.art,
          b.bestellnummer, b.beleg_nummer, b.bestellt_am, b.geliefert_am,
          l.name, b.status;

COMMENT ON VIEW mart.einkauf_beleg IS
'Belegkopf je Bestellung — eine Zeile je Bestellung, nicht je Position (dafuer
ist mart.einkauf_position da). STORNOS STEHEN HIER MIT DRIN und sind an
`storniert` erkennbar, wie in mart.einkauf_position: das ist die Beweissicht,
wer summiert filtert selbst. `betrieb` ist NULL, solange die Kostenstelle
keinem LINA-Betrieb zugeordnet ist. `summe` ist die Summe der geladenen
Positionen, nicht der FoodNotify-Kopfwert — konsistent mit
mart.einkauf_betrieb_monat.';


-- ---------------------------------------------------------------------
-- 2. Inventurkopf mit bewertetem Bestand
--
-- Je Inventur eine Zeile, mit Betrieb ueber dieselbe Kostenstellen-
-- Zuordnung wie beim Einkauf (core.kostenstelle.betrieb_key). Die
-- Bewertung kommt aus core.inventurposition: Sollmenge und gezaehlte
-- Menge, multipliziert mit dem Preis je Basiseinheit (Kommentar an
-- core.inventurposition, 0044).
--
-- LEFT JOIN auf die Positionen: eine Inventur ohne geladene Positionen
-- (noch nicht abgerufen, oder wirklich leer) bleibt sichtbar mit NULL
-- statt zu verschwinden.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.inventur AS
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
    count(p.inventurposition_key)::int AS positionen_geladen,
    round(sum(p.soll_menge * p.preis_je_basiseinheit)::numeric, 2)     AS soll_bewertet,
    round(sum(p.gezaehlt_menge * p.preis_je_basiseinheit)::numeric, 2) AS gezaehlt_bewertet,
    round(sum((p.soll_menge - p.gezaehlt_menge)
              * p.preis_je_basiseinheit)::numeric, 2)                 AS schwund_eur
  FROM core.inventur             i
  JOIN core.kostenstelle         k  USING (kostenstelle_key)
  JOIN core.marke                m  ON m.marke_key = k.marke_key
  LEFT JOIN core.betrieb         bt ON bt.betrieb_key = k.betrieb_key
  LEFT JOIN core.inventurposition p ON p.inventur_key = i.inventur_key
 GROUP BY i.inventur_key, m.name, k.restaurant_name, bt.name, k.art,
          i.name, i.art, i.status, i.erstellt_am, i.geaendert_am,
          i.anzahl_positionen;

COMMENT ON VIEW mart.inventur IS
'Inventurkoepfe mit bewertetem Soll- und Zaehlbestand, eine Zeile je Inventur.
LOHNEND FAST NUR BEI WILMA WUNDER (275 Stueck, 154 signiert) — bei Aposto und
Deutsche Konzepte gibt es praktisch keine belastbare Menge (siehe
core.inventur, Migration 0044). STORNIERTE UND UNSIGNIERTE INVENTUREN STEHEN
HIER MIT DRIN (Beweissicht wie mart.einkauf_position) und sind an `storniert`
bzw. `signiert` erkennbar — die Euro-Spalten aus einer noch nicht signierten
Zaehlung sind ein Zwischenstand, kein Ergebnis. Wer eine Schwundaussage
treffen will, nimmt mart.inventur_schwund: die rechnet nur mit signierten,
nicht stornierten Inventuren. AKTUELL LEER, solange der Inventur-Backfill
nicht gelaufen ist (bewusste manuelle Entscheidung, siehe AGENTS.md).';


-- ---------------------------------------------------------------------
-- 3. Bewerteter Schwund je Betrieb und Monat
--
-- Granularitaet Betrieb+Monat, nicht je Inventur: dieselbe Koernung wie
-- mart.einkauf_betrieb_monat und mart.personalkosten, damit sich Schwund
-- neben Einkauf und Personalkosten in denselben Zeitraster einordnet und
-- sich ueber mehrere Monate zusammenfassen laesst (die Kartenschicht tut
-- das fuer wa_inventur_schwund).
--
-- NUR SIGNIERTE, NICHT STORNIERTE INVENTUREN gehen in die Euro-Summen ein
-- -- FILTER (WHERE i.status = 'signed') statt eines WHERE auf der ganzen
-- Abfrage, damit `inventuren` weiterhin zaehlt, WIE VIELE Inventuren es
-- in dem Monat ueberhaupt gab (Kontext fuer die Kachel), auch wenn nicht
-- alle signiert sind.
--
-- NUR BETRIEBE MIT LINA-ZUORDNUNG (INNER JOIN core.betrieb), wie
-- mart.einkauf_betrieb_monat: eine Schwundsumme ohne Betrieb liesse sich
-- mit nichts vergleichen.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.inventur_schwund AS
SELECT
    bt.betrieb_key,
    bt.name AS betrieb,
    m.name  AS marke,
    date_trunc('month', i.erstellt_am)::date AS monat,
    count(*)                                          AS inventuren,
    count(*) FILTER (WHERE i.status = 'signed')        AS inventuren_signiert,
    round(sum(p.soll_menge * p.preis_je_basiseinheit)
        FILTER (WHERE i.status = 'signed')::numeric, 2)     AS soll_eur,
    round(sum(p.gezaehlt_menge * p.preis_je_basiseinheit)
        FILTER (WHERE i.status = 'signed')::numeric, 2)     AS gezaehlt_eur,
    round(sum((p.soll_menge - p.gezaehlt_menge) * p.preis_je_basiseinheit)
        FILTER (WHERE i.status = 'signed')::numeric, 2)     AS schwund_eur,
    -- Prozent als Zahl (23.64), nie als Bruch — AGENTS.md Regel 6.
    CASE WHEN sum(p.soll_menge * p.preis_je_basiseinheit)
              FILTER (WHERE i.status = 'signed') > 0
         THEN round((100 * sum((p.soll_menge - p.gezaehlt_menge) * p.preis_je_basiseinheit)
                         FILTER (WHERE i.status = 'signed')
                    / sum(p.soll_menge * p.preis_je_basiseinheit)
                         FILTER (WHERE i.status = 'signed'))::numeric, 2)
    END AS schwund_pct
  FROM core.inventur              i
  JOIN core.kostenstelle          k  USING (kostenstelle_key)
  JOIN core.marke                 m  ON m.marke_key = k.marke_key
  JOIN core.betrieb               bt ON bt.betrieb_key = k.betrieb_key
  LEFT JOIN core.inventurposition p  ON p.inventur_key = i.inventur_key
 WHERE i.status IS DISTINCT FROM 'canceled'
 GROUP BY bt.betrieb_key, bt.name, m.name, date_trunc('month', i.erstellt_am);

COMMENT ON VIEW mart.inventur_schwund IS
'Bewerteter Schwund (Soll minus gezaehlt, bewertet mit dem Preis je
Basiseinheit) je Betrieb und Monat. NUR SIGNIERTE Inventuren zaehlen in den
Euro-Spalten mit, stornierte sind komplett ausgeschlossen (WHERE) — eine
laufende oder verworfene Zaehlung ist kein Ergebnis. `inventuren` zaehlt
trotzdem alle nicht stornierten, damit sichtbar bleibt, wie viele davon noch
nicht signiert sind (inventuren < inventuren_signiert waere ein Fehler,
inventuren > inventuren_signiert der Normalfall waehrend eine Zaehlung
laeuft). EINE FLAECHIGE AUSSAGE UEBER ALLE MARKEN IST NICHT MOEGLICH:
Inventuren gibt es praktisch nur bei Wilma Wunder (siehe core.inventur,
Migration 0044) — bei den anderen drei Marken ist die Fallzahl zu klein fuer
einen belastbaren Schwundwert. AKTUELL LEER, solange der Inventur-Backfill
nicht gelaufen ist.';
