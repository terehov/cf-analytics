-- =====================================================================
-- 0156 Lieferkonditionen — was die Bestellungen BEOBACHTEN lassen
--
-- ANLASS (19.11.2026). Der Fachbereich fragt nach den Lieferkonditionen je
-- Lieferant und Betrieb: Liefertage (Tourenplan), Bestellfrist (Vorlauf),
-- Mindestbestellwert. Wir laden davon nichts ausdruecklich, und kein bisher
-- gemessener FoodNotify-GET liefert es. Die Bundle-Analyse
-- (docs/payloads/foodnotify-2026-11/lieferkonditionen-bundle-2026-11-19.md)
-- hat den Ort gefunden: den Warenkorb-GET, nicht POST /api/shop/{id}/info.
-- Bis jemand ihn lesend misst, steht in unseren eigenen Bestellungen, wie
-- sich die Lieferanten TATSAECHLICH verhalten haben.
--
-- WAS DIESE MIGRATION TUT
--   1. REPARIERT core.bestellung.geliefert_am. Die Spalte stand bei 50.014
--      von 50.050 Bestellungen (nachgemessen 19.11.2026, lokaler Bestand
--      Stand 04.08.2026) EINEN TAG ZU FRUEH — siehe unten. Ohne diese
--      Reparatur waeren alle Wochentage der neuen Sicht um einen Tag
--      verschoben.
--   2. legt mart.lieferkondition_beobachtet an.
--   3. Katalog fuer den MCP-Zugang, ein Fallstrick, Leseprobe als mcp_leser.
--
-- ZU 1 — DER LIEFERTAG STAND EINEN TAG ZU FRUEH.
-- FoodNotify liefert markedShopOrder.deliveryDate als Unix-Sekunden der
-- BERLINER MITTERNACHT: 22:00 UTC im Sommer, 23:00 UTC im Winter
-- (29.792 + 20.226 von 50.050 Koepfen; 36 um 00:00 UTC, der Rest vereinzelt).
-- Der Lader schnitt den UTC-Tag ab (`alsDatum`, src/foodnotify/transform.ts)
-- und schrieb damit den Tag VOR der Lieferung. Gegenprobe am Bestellzeitpunkt:
-- mit dem alten Wert lagen 139 Lieferungen VOR ihrer Bestellung und 18.218
-- am selben Tag; mit dem Berliner Kalendertag sind es 6 und 134. Der
-- Rechnungstag (invoiceDate, 11:00/12:00 UTC) war nie betroffen. Der Lader
-- ist im selben Commit repariert; diese Migration baut den Bestand aus raw
-- zurueck (Regel 4: core ist aus raw neu aufbaubar — kein API-Aufruf).
-- Betroffen war bis hierher auch mart.einkauf_beleg.lieferdatum (Karten
-- „Lieferdatum" / „Geliefert am" im Drill-down): ab hier der richtige Tag.
--
-- ZU 2 — BEOBACHTET, NICHT VEREINBART. Die Sicht zeigt je Kostenstelle
-- (= Betrieb × Bereich Bar/Kueche) und Lieferant, was in den letzten zwölf
-- Monaten bestellt wurde. Ein Lieferant, der dienstags nie geliefert hat,
-- liefert dienstags vielleicht trotzdem — nur hat in diesem Zeitraum
-- niemand dienstags bestellt oder gebraucht. Und umgekehrt: FoodNotify
-- bietet beim Bestellen nur die Termine an, die der Lieferant freigegeben
-- hat; der gewaehlte Termin liegt also in der Regel IM Tourenplan, ohne ihn
-- ausfuellen zu muessen. Der Mindestbestellwert ist besonders unsicher: die
-- Oberflaeche warnt nur („es koennen zusaetzliche Lieferkosten anfallen
-- oder die Lieferung kann verweigert werden"), sie sperrt nicht — kleine
-- Bestellungen sind moeglich und stehen in der Sicht (kleinster Wert bei
-- den drei meistbestellten Paaren: 1,50 bis 2,82 EUR). Der Wert ist ein
-- HINWEIS, nicht der Mindestbestellwert.
--
-- KEINE MATERIALISIERUNG. Gemessen auf einem Klon des lokalen Bestands
-- (12.779 Bestellungen im Fenster, 449 Zeilen; EXPLAIN ANALYZE auf einem
-- frisch kopierten Bestand): 1,5 s kalt, rund 0,1 s warm, mit Markenfilter
-- 40 ms. In Produktion mehr Zeilen, nicht Groessenordnungen mehr.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Rueckbau: geliefert_am als Berliner Kalendertag
--
-- Je Bestellung gilt der JUENGSTE Kopf-Abruf (fn:bestellung) — dort steht
-- deliveryDate. Das Schreiben ist wiederholbar: es aendert nur Zeilen, die
-- vom Berliner Kalendertag abweichen.
-- ---------------------------------------------------------------------

WITH kopf AS (
    SELECT DISTINCT ON ((r.parameter->>'markeKey')::int, r.parameter->>'orderId')
           (r.parameter->>'markeKey')::int AS marke_key,
           r.parameter->>'orderId'         AS fn_id,
           (to_timestamp((r.payload->'payload'->'markedShopOrder'->'deliveryDate'->>'timestamp')::bigint)
                AT TIME ZONE 'Europe/Berlin')::date AS liefertag
      FROM raw.api_antwort r
     WHERE r.quelle = 'foodnotify'
       AND r.endpunkt = 'fn:bestellung'
       AND r.payload->'payload'->'markedShopOrder'->'deliveryDate'->>'timestamp' IS NOT NULL
     ORDER BY (r.parameter->>'markeKey')::int, r.parameter->>'orderId',
              r.abgerufen_am DESC
)
UPDATE core.bestellung b
   SET geliefert_am = kopf.liefertag
  FROM kopf, core.kostenstelle k
 WHERE k.kostenstelle_key = b.kostenstelle_key
   AND k.marke_key        = kopf.marke_key
   AND b.fn_id            = kopf.fn_id
   AND b.geliefert_am IS DISTINCT FROM kopf.liefertag;

-- Ein Waechter, keine Kosmetik: bleibt eine Zeile, deren Rohsatz einen anderen
-- Tag nennt, hat der Rueckbau seine Quelle nicht gefunden — oder ein Worker mit
-- altem Code schreibt gerade nach. Dann abbrechen (eine Transaktion); der
-- Rueckbau ist ausserhalb des Migrationslaufs gefahrlos wiederholbar.
DO $$
DECLARE offen bigint;
BEGIN
    SELECT count(*) INTO offen
      FROM (SELECT DISTINCT ON ((r.parameter->>'markeKey')::int, r.parameter->>'orderId')
                   (r.parameter->>'markeKey')::int AS marke_key,
                   r.parameter->>'orderId'         AS fn_id,
                   (to_timestamp((r.payload->'payload'->'markedShopOrder'->'deliveryDate'->>'timestamp')::bigint)
                        AT TIME ZONE 'Europe/Berlin')::date AS liefertag
              FROM raw.api_antwort r
             WHERE r.quelle = 'foodnotify'
               AND r.endpunkt = 'fn:bestellung'
               AND r.payload->'payload'->'markedShopOrder'->'deliveryDate'->>'timestamp' IS NOT NULL
             ORDER BY (r.parameter->>'markeKey')::int, r.parameter->>'orderId',
                      r.abgerufen_am DESC) kopf
      JOIN core.kostenstelle k ON k.marke_key = kopf.marke_key
      JOIN core.bestellung   b ON b.kostenstelle_key = k.kostenstelle_key
                              AND b.fn_id = kopf.fn_id
     WHERE b.geliefert_am IS DISTINCT FROM kopf.liefertag;
    IF offen > 0 THEN
        RAISE EXCEPTION '0156: % Bestellungen tragen geliefert_am nicht als Berliner Kalendertag, '
                        'obwohl raw ihn kennt', offen;
    END IF;
END $$;

-- Zweiter Waechter, fuer die Luecke des ersten: der Rueckbau liest GENAU EINE
-- Form des Rohsatzes (payload.markedShopOrder.deliveryDate.timestamp), der
-- Lader vertraegt mehrere. Liefert FoodNotify seit dem Umbau vom 09.11.2026
-- eine andere, findet der Rueckbau diese Bestellungen nicht, laesst sie einen
-- Tag zu frueh stehen — und der Waechter darueber sieht sie auch nicht.
-- Nachgemessen am 19.11.2026 lokal (Stand 04.08.2026): 0 von 50.050 ohne
-- lesbaren Rohsatz. Ueber 1 % bricht die Migration ab, statt halb zu reparieren.
DO $$
DECLARE mit_termin bigint; ohne_rohsatz bigint;
BEGIN
    WITH kopf AS (
        SELECT DISTINCT (r.parameter->>'markeKey')::int AS marke_key,
                        r.parameter->>'orderId'         AS fn_id
          FROM raw.api_antwort r
         WHERE r.quelle = 'foodnotify'
           AND r.endpunkt = 'fn:bestellung'
           AND r.payload->'payload'->'markedShopOrder'->'deliveryDate'->>'timestamp' IS NOT NULL
    )
    SELECT count(*) FILTER (WHERE b.geliefert_am IS NOT NULL),
           count(*) FILTER (WHERE b.geliefert_am IS NOT NULL AND kopf.fn_id IS NULL)
      INTO mit_termin, ohne_rohsatz
      FROM core.bestellung b
      JOIN core.kostenstelle k ON k.kostenstelle_key = b.kostenstelle_key
      LEFT JOIN kopf ON kopf.marke_key = k.marke_key AND kopf.fn_id = b.fn_id;
    RAISE NOTICE '0156: % Bestellungen mit Liefertermin, % ohne lesbaren Rohsatz', mit_termin, ohne_rohsatz;
    IF ohne_rohsatz > mit_termin * 0.01 THEN
        RAISE EXCEPTION '0156: % von % Bestellungen mit Liefertermin haben keinen Rohsatz in der '
                        'erwarteten Form — der Rueckbau waere unvollstaendig', ohne_rohsatz, mit_termin;
    END IF;
END $$;

COMMENT ON COLUMN core.bestellung.geliefert_am IS
'Der bei der Bestellung GEWAEHLTE Liefertermin (markedShopOrder.deliveryDate), als
Berliner Kalendertag. Kein Wareneingang: ob und wann die Ware kam, steht hier nicht.
Bis Migration 0156 stand bei fast allen Zeilen der Tag davor (UTC-Tag der Berliner
Mitternacht); der Bestand ist aus raw zurueckgebaut, der Lader repariert.';


-- ---------------------------------------------------------------------
-- 2. Die Sicht
--
-- KOERNUNG: eine Zeile je Kostenstelle × Lieferant, ueber alle nicht
-- stornierten Bestellungen der letzten zwoelf Monate (nach Bestelltag in
-- Berlin). Kostenstelle statt Betrieb, weil Bar und Kueche eines Betriebs
-- verschieden beliefert werden; betrieb_key ist NULL, solange die
-- Kostenstelle keinem LINA-Betrieb zugeordnet ist (wie in mart.einkauf_beleg).
--
-- WOCHENTAGE zaehlen LIEFERTAGE, nicht Bestellungen: zwei Bestellungen
-- fuer denselben Dienstag sind eine Lieferung. „Üblich" ist ein Wochentag
-- mit mindestens 15 % der Liefertage. Begruendung: ein regelmaessiger
-- Lieferant liegt je Liefertag bei 17 % (sechs Tage pro Woche), 20 %, 33 %
-- oder 50 %; eine Ausnahme (Feiertagsverschiebung, Sonderlieferung) bei
-- 1 bis 5 %. 15 % trennt beides — nachgemessen an CF Gastro Aschaffenburg:
-- Mo 35, Mi 34, Fr 35, dazu Di 1, Do 1, Sa 5 von 111 Liefertagen → „Mo, Mi, Fr".
-- Ein Lieferant, der jeden Tag liefert (je 14 %), fiele durch die Schwelle:
-- dann steht liefertage_gesehen daneben.
--
-- VORLAUF = Liefertag minus Bestelltag (Berliner Kalendertage). Negative
-- Werte (Lieferung vor Bestellung: 6 von 48.489 nach der Reparatur) sind
-- Erfassungsfehler und stehen in lieferung_vor_bestellung, nicht im Vorlauf.
-- Die BESTELLZEIT am Vortag gilt nur fuer Bestellungen mit Vorlauf 1: der
-- spaeteste Wert ist die Naeherung an einen Bestellschluss VON UNTEN (wer
-- spaeter bestellt, bekommt den Folgetag meist nicht mehr) — der 95-%-Wert
-- daneben ist robust gegen einzelne Nachzuegler.
--
-- BESTELLWERT = Summe der geladenen Positionen (summe_preis, netto), wie bei
-- mart.einkauf_beleg. Die Oberflaeche prueft den Mindestbestellwert gegen den
-- NETTOwert. Bestellungen ohne geladene Positionen fehlen hier
-- (bestellungen_mit_wert zaehlt, wie viele es sind).
--
-- STORNOS: raus (status = 'canceled'); pending bleibt drin, ist aber in
-- bestellungen_pending sichtbar — ob diese Bestellungen je beim Lieferanten
-- ankamen, ist offen (0043).
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.lieferkondition_beobachtet AS
WITH fenster AS (
    SELECT (now() AT TIME ZONE 'Europe/Berlin')::date                                 AS bis,
           ((now() AT TIME ZONE 'Europe/Berlin')::date - interval '12 months')::date AS von
), bestellung AS (
    SELECT b.kostenstelle_key,
           b.lieferant_key,
           b.status,
           b.geliefert_am                                                       AS liefertag,
           (b.bestellt_am AT TIME ZONE 'Europe/Berlin')                         AS bestellt_lokal,
           (b.bestellt_am AT TIME ZONE 'Europe/Berlin')::date                   AS bestelltag,
           b.geliefert_am - (b.bestellt_am AT TIME ZONE 'Europe/Berlin')::date  AS vorlauf_tage,
           w.netto
      FROM core.bestellung b
     CROSS JOIN fenster f
     CROSS JOIN LATERAL (
           SELECT NULLIF(sum(p.summe_preis), 0) AS netto
             FROM core.bestellposition p
            WHERE p.bestellung_key = b.bestellung_key) w
     WHERE b.bestellt_am IS NOT NULL
       AND b.lieferant_key IS NOT NULL
       AND b.status IS DISTINCT FROM 'canceled'
       AND (b.bestellt_am AT TIME ZONE 'Europe/Berlin')::date >= f.von
), je_stelle AS (
    SELECT kostenstelle_key,
           lieferant_key,
           count(*)                                                            AS bestellungen,
           count(*) FILTER (WHERE status = 'pending')                          AS bestellungen_pending,
           min(bestelltag)                                                     AS erste_bestellung,
           max(bestelltag)                                                     AS letzte_bestellung,
           count(*) FILTER (WHERE liefertag IS NOT NULL)                       AS bestellungen_mit_liefertermin,
           count(DISTINCT liefertag)                                           AS liefertage,
           count(DISTINCT liefertag) FILTER (WHERE extract(isodow FROM liefertag) = 1) AS lieferungen_mo,
           count(DISTINCT liefertag) FILTER (WHERE extract(isodow FROM liefertag) = 2) AS lieferungen_di,
           count(DISTINCT liefertag) FILTER (WHERE extract(isodow FROM liefertag) = 3) AS lieferungen_mi,
           count(DISTINCT liefertag) FILTER (WHERE extract(isodow FROM liefertag) = 4) AS lieferungen_do,
           count(DISTINCT liefertag) FILTER (WHERE extract(isodow FROM liefertag) = 5) AS lieferungen_fr,
           count(DISTINCT liefertag) FILTER (WHERE extract(isodow FROM liefertag) = 6) AS lieferungen_sa,
           count(DISTINCT liefertag) FILTER (WHERE extract(isodow FROM liefertag) = 7) AS lieferungen_so,
           count(*) FILTER (WHERE vorlauf_tage < 0)                            AS lieferung_vor_bestellung,
           min(vorlauf_tage) FILTER (WHERE vorlauf_tage >= 0)                  AS vorlauf_min_tage,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY vorlauf_tage)
               FILTER (WHERE vorlauf_tage >= 0)                                AS vorlauf_median_tage,
           mode() WITHIN GROUP (ORDER BY vorlauf_tage)
               FILTER (WHERE vorlauf_tage >= 0)                                AS vorlauf_typisch_tage,
           count(*) FILTER (WHERE vorlauf_tage = 1)                            AS bestellungen_vortag,
           max(bestellt_lokal::time) FILTER (WHERE vorlauf_tage = 1)           AS bestellzeit_vortag_spaetest,
           percentile_disc(0.95) WITHIN GROUP (ORDER BY bestellt_lokal::time)
               FILTER (WHERE vorlauf_tage = 1)                                 AS bestellzeit_vortag_p95,
           count(netto)                                                        AS bestellungen_mit_wert,
           min(netto)                                                          AS bestellwert_min_netto,
           percentile_cont(0.05) WITHIN GROUP (ORDER BY netto)                 AS bestellwert_p05_netto,
           percentile_cont(0.5)  WITHIN GROUP (ORDER BY netto)                 AS bestellwert_median_netto
      FROM bestellung
     GROUP BY kostenstelle_key, lieferant_key
)
SELECT
    m.name                       AS marke,
    k.restaurant_name            AS fn_betrieb,
    bt.betrieb_key,
    bt.name                      AS betrieb,
    k.art                        AS bereich,
    k.kostenstelle_key,
    l.lieferant_key,
    l.name                       AS lieferant,
    f.von                        AS zeitraum_von,
    f.bis                        AS zeitraum_bis,
    s.bestellungen,
    s.bestellungen >= 10         AS belastbar,
    s.bestellungen_pending,
    s.erste_bestellung,
    s.letzte_bestellung,
    s.bestellungen_mit_liefertermin,
    s.liefertage,
    s.lieferungen_mo, s.lieferungen_di, s.lieferungen_mi, s.lieferungen_do,
    s.lieferungen_fr, s.lieferungen_sa, s.lieferungen_so,
    NULLIF(concat_ws(', ',
        CASE WHEN s.lieferungen_mo >= 0.15 * s.liefertage THEN 'Mo' END,
        CASE WHEN s.lieferungen_di >= 0.15 * s.liefertage THEN 'Di' END,
        CASE WHEN s.lieferungen_mi >= 0.15 * s.liefertage THEN 'Mi' END,
        CASE WHEN s.lieferungen_do >= 0.15 * s.liefertage THEN 'Do' END,
        CASE WHEN s.lieferungen_fr >= 0.15 * s.liefertage THEN 'Fr' END,
        CASE WHEN s.lieferungen_sa >= 0.15 * s.liefertage THEN 'Sa' END,
        CASE WHEN s.lieferungen_so >= 0.15 * s.liefertage THEN 'So' END), '') AS liefertage_ueblich,
    NULLIF(concat_ws(', ',
        CASE WHEN s.lieferungen_mo > 0 THEN 'Mo' END,
        CASE WHEN s.lieferungen_di > 0 THEN 'Di' END,
        CASE WHEN s.lieferungen_mi > 0 THEN 'Mi' END,
        CASE WHEN s.lieferungen_do > 0 THEN 'Do' END,
        CASE WHEN s.lieferungen_fr > 0 THEN 'Fr' END,
        CASE WHEN s.lieferungen_sa > 0 THEN 'Sa' END,
        CASE WHEN s.lieferungen_so > 0 THEN 'So' END), '') AS liefertage_gesehen,
    s.lieferung_vor_bestellung,
    s.vorlauf_min_tage,
    s.vorlauf_median_tage,
    s.vorlauf_typisch_tage,
    s.bestellungen_vortag,
    s.bestellzeit_vortag_spaetest,
    s.bestellzeit_vortag_p95,
    s.bestellungen_mit_wert,
    round(s.bestellwert_min_netto, 2)             AS bestellwert_min_netto,
    round(s.bestellwert_p05_netto::numeric, 2)    AS bestellwert_p05_netto,
    round(s.bestellwert_median_netto::numeric, 2) AS bestellwert_median_netto
  FROM je_stelle s
  CROSS JOIN fenster f
  JOIN core.kostenstelle  k  USING (kostenstelle_key)
  JOIN core.marke         m  ON m.marke_key = k.marke_key
  LEFT JOIN core.betrieb  bt ON bt.betrieb_key = k.betrieb_key
  JOIN core.lieferant     l  ON l.lieferant_key = s.lieferant_key;

COMMENT ON VIEW mart.lieferkondition_beobachtet IS
'BEOBACHTET, NICHT VEREINBART. Was die Bestellungen der letzten zwoelf Monate ueber
Liefertage, Vorlauf und Bestellwert je Kostenstelle (Betrieb × Bereich Bar/Kueche)
und Lieferant zeigen. Eine Zeile je Kostenstelle × Lieferant, ohne Stornos. Ein
Lieferant, der in dem Zeitraum nie an einem Dienstag geliefert hat, liefert
dienstags vielleicht trotzdem; der kleinste beobachtete Bestellwert ist nicht der
Mindestbestellwert (FoodNotify warnt nur, es sperrt nicht). Die echten
Konditionen fuehrt FoodNotify am Warenkorb (docs/payloads/foodnotify-2026-11/
lieferkonditionen-bundle-2026-11-19.md) — hier nicht geladen. Zahlen mit
belastbar = false (unter 10 Bestellungen) nur als Anhaltspunkt nennen, und immer
sagen, dass es beobachtetes Verhalten ist. betrieb ist NULL, solange die
Kostenstelle keinem LINA-Betrieb zugeordnet ist; ueber betrieb_key joinen, nie
ueber den Namen.';

COMMENT ON COLUMN mart.lieferkondition_beobachtet.marke IS 'FoodNotify-Marke der Kostenstelle.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.fn_betrieb IS 'Name des Betriebs in FoodNotify (Restaurantname) — nicht zum Joinen.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.betrieb_key IS 'LINA-Betrieb (core.betrieb); NULL = Kostenstelle noch keinem Betrieb zugeordnet.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.betrieb IS 'Betriebsname aus LINA; nicht eindeutig, ueber betrieb_key joinen.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.bereich IS 'bar | kueche | sonstige — aus dem Kostenstellennamen abgeleitet. Bar und Kueche eines Betriebs werden getrennt beliefert und stehen in getrennten Zeilen.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.kostenstelle_key IS 'Kostenstelle (core.kostenstelle) — Betrieb × Bereich.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.lieferant_key IS 'Lieferant (core.lieferant). Je Marke eigene Schluessel: derselbe Lieferant steht bei zwei Marken unter zwei Schluesseln.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.lieferant IS 'Lieferantenname aus FoodNotify (markedShop).';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.zeitraum_von IS 'Beginn des Beobachtungsfensters (Bestelltag, zwoelf Monate vor heute, Berlin). Die Sicht rechnet immer gegen heute.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.zeitraum_bis IS 'Ende des Fensters = heute (Berlin). Die juengste Bestellung steht in letzte_bestellung.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.bestellungen IS 'Datenbasis: nicht stornierte Bestellungen im Fenster. Unter 10 ist jede Aussage daraus duenn.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.belastbar IS 'true ab 10 Bestellungen. Das ist eine Mindestmenge fuer „sieht regelmaessig aus", keine Aussage, dass die Zahlen die Konditionen sind. Das 5-%-Quantil des Bestellwerts braucht mehr (ab etwa 20).';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.bestellungen_pending IS 'Davon im Status pending (nie weitergeschaltet oder noch offen). Ob diese Bestellungen den Lieferanten erreichten, ist offen.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.erste_bestellung IS 'Erster Bestelltag im Fenster (Berlin).';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.letzte_bestellung IS 'Letzter Bestelltag im Fenster (Berlin). Liegt er Monate zurueck, bestellt der Betrieb dort nicht mehr — die Zeile beschreibt dann Vergangenheit.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.bestellungen_mit_liefertermin IS 'Bestellungen mit gewaehltem Liefertermin (geliefert_am); nur diese gehen in Wochentage und Vorlauf ein.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.liefertage IS 'Verschiedene gewaehlte Liefertage. Zwei Bestellungen fuer denselben Tag sind eine Lieferung.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.lieferungen_mo IS 'Liefertage (verschiedene Kalendertage), die auf einen Montag fielen. Beobachtet, nicht vereinbart.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.lieferungen_di IS 'Liefertage auf einen Dienstag. Beobachtet, nicht vereinbart.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.lieferungen_mi IS 'Liefertage auf einen Mittwoch. Beobachtet, nicht vereinbart.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.lieferungen_do IS 'Liefertage auf einen Donnerstag. Beobachtet, nicht vereinbart.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.lieferungen_fr IS 'Liefertage auf einen Freitag. Beobachtet, nicht vereinbart.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.lieferungen_sa IS 'Liefertage auf einen Samstag. Beobachtet, nicht vereinbart.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.lieferungen_so IS 'Liefertage auf einen Sonntag. Beobachtet, nicht vereinbart.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.liefertage_ueblich IS 'Wochentage mit mindestens 15 % der Liefertage, z. B. „Di, Fr". BEOBACHTET, nicht der Tourenplan: ein Tag, der hier fehlt, kann trotzdem beliefert werden. Wer jeden Tag liefert (je 14 %), faellt durch die Schwelle — dann liefertage_gesehen lesen.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.liefertage_gesehen IS 'Alle Wochentage, an denen im Fenster mindestens einmal geliefert wurde — einschliesslich Ausnahmen (Feiertagsverschiebung, Sonderlieferung).';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.lieferung_vor_bestellung IS 'Bestellungen, deren gewaehlter Liefertag VOR dem Bestelltag liegt — Erfassungsfehler; sie gehen nicht in den Vorlauf ein.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.vorlauf_min_tage IS 'Kleinster beobachteter Vorlauf (Liefertag minus Bestelltag, Kalendertage Berlin, nur 0 oder mehr). Ein Hinweis auf die Bestellfrist, nicht die Frist: wer Vorlauf 0 hat, hat bei diesem Lieferanten Lieferung am selben Tag erhalten — vereinbart ist das damit nicht.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.vorlauf_median_tage IS 'Mittlerer beobachteter Vorlauf in Kalendertagen (ein tatsaechlich vorgekommener Wert).';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.vorlauf_typisch_tage IS 'Haeufigster beobachteter Vorlauf in Kalendertagen. Bei Gleichstand der kleinere.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.bestellungen_vortag IS 'Bestellungen mit Vorlauf genau 1 (Bestellung am Vortag der Lieferung) — Grundlage der beiden Uhrzeiten.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.bestellzeit_vortag_spaetest IS 'Spaeteste Uhrzeit (Berlin), zu der am Vortag noch eine Bestellung mit Lieferung am naechsten Tag entstand. Naeherung an einen Bestellschluss von unten — kein Bestellschluss.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.bestellzeit_vortag_p95 IS '95 % dieser Vortags-Bestellungen entstanden bis zu dieser Uhrzeit (Berlin) — unempfindlich gegen einzelne Nachzuegler.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.bestellungen_mit_wert IS 'Bestellungen mit geladenen Positionen und Nettowert ueber 0; nur diese gehen in die Bestellwert-Spalten.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.bestellwert_min_netto IS 'Kleinster beobachteter Nettowert (EUR) einer Bestellung. NICHT der Mindestbestellwert: FoodNotify warnt bei Unterschreitung, sperrt aber nicht, kleine Bestellungen sind moeglich.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.bestellwert_p05_netto IS 'Nettowert (EUR), unter dem nur 5 % der Bestellungen lagen. Hinweis auf eine Untergrenze, nicht der Mindestbestellwert; unter etwa 20 Bestellungen gleicht er dem Minimum.';
COMMENT ON COLUMN mart.lieferkondition_beobachtet.bestellwert_median_netto IS 'Mittlerer Nettowert (EUR) einer Bestellung im Fenster.';


-- ---------------------------------------------------------------------
-- 3. MCP-Katalog: Koernung, Fallstrick, Rechte, Leseprobe
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.lieferkondition_beobachtet',
     'Kostenstelle (Betrieb × Bar/Kueche) × Lieferant, letzte 12 Monate — BEOBACHTETE Liefertage, Vorlauf, Bestellwert; keine vereinbarten Konditionen; Quantile und Median nicht summieren',
     'einkauf', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

-- Nur Regelarten, die mcp/src/pruefen.ts kennt (deutung).
INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle)
VALUES
  ('lieferkondition_beobachtet_nicht_vereinbart', 'deutung', 'warnung', 'mart.lieferkondition_beobachtet', '{}'::jsonb,
   'Die Sicht zeigt, was in den letzten zwoelf Monaten bestellt wurde, nicht was mit dem Lieferanten vereinbart '
   'ist. Ein Wochentag ohne Lieferung kann trotzdem beliefert werden; der kleinste oder fuenf-Prozent-Bestellwert '
   'ist nicht der Mindestbestellwert (FoodNotify warnt bei Unterschreitung, sperrt nicht); der kleinste Vorlauf '
   'ist keine Bestellfrist. Tourenplan, Bestellschluss und Mindestbestellwert fuehrt FoodNotify am Warenkorb und '
   'sind hier nicht geladen.',
   'Als „beobachtet" benennen, belastbar und bestellungen mitnennen, bei Zeilen mit belastbar = false nur als '
   'Anhaltspunkt. Fuer die tatsaechlichen Konditionen den Lieferanten oder FoodNotify fragen, nicht diese Sicht.',
   '0156')
ON CONFLICT (schluessel) DO UPDATE
   SET art = excluded.art, schwere = excluded.schwere, sicht = excluded.sicht,
       parameter = excluded.parameter, hinweis = excluded.hinweis,
       berichtigung = excluded.berichtigung, quelle = excluded.quelle;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

-- Seit 0153 vergibt die Funktion im Schema mcp nur den Katalog.
SELECT mcp.rechte_auffrischen();

-- Die Gegenprobe als Leserolle (Pflicht seit 0110): SELECT * … LIMIT 1, nicht
-- count(*). Und die Rechtepruefung aus 0148 muss leer sein.
DO $probe$
DECLARE
    v_abfrage text;
    v_liegen  text[] := '{}';
    v_rechte  int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0156 ist uebersprungen';
        RETURN;
    END IF;

    SELECT count(*) INTO v_rechte FROM mart.mcp_rechte_pruefung;
    IF v_rechte > 0 THEN
        RAISE EXCEPTION '0156: mart.mcp_rechte_pruefung ist nicht leer (% Zeilen)', v_rechte;
    END IF;

    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0156 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_abfrage IN ARRAY ARRAY[
        'SELECT * FROM mart.lieferkondition_beobachtet LIMIT 1',
        'SELECT * FROM mart.einkauf_beleg WHERE lieferdatum IS NOT NULL LIMIT 1']
    LOOP
        BEGIN
            EXECUTE v_abfrage;
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_abfrage, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0156 hat sein Ziel nicht erreicht — fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
