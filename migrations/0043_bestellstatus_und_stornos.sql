-- ---------------------------------------------------------------------
-- Migration 0043 · Der Bestellstatus ist ein Wort, kein [object Object]
--
-- WAS KAPUTT WAR.
--
-- `shopOrderStatus` kommt von FoodNotify als Objekt: `{"name":
-- "canceled"}`. Der Importer las ihn mit `String()`. In `core.bestellung`
-- stand deshalb in JEDER Zeile — 44.271 am 04.08.2026, über alle vier
-- Marken und den ganzen Zeitraum seit 2020 — der Text `[object Object]`.
--
-- Die Spalte war damit nicht bloß hässlich, sie war LEER im fachlichen
-- Sinn: es gab keinen Weg, eine stornierte Bestellung von einer gelieferten
-- zu unterscheiden. Und weil keine Sicht danach filterte, zählten
-- 1.561 Stornos über 2.490.460,47 EUR im Einkaufsvolumen mit wie jede
-- andere Bestellung — 7,5 % des ausgewiesenen Einkaufs, der nie
-- stattgefunden hat.
--
-- Der Parser ist in `src/foodnotify/transform.ts` repariert
-- (`alsBezeichnung`). Diese Migration macht zwei Dinge, die der Parser
-- nicht kann: den Bestand zurückbauen und die Sichten die Stornos
-- aussortieren lassen.
--
-- WARUM DER RÜCKBAU AUS raw GEHT UND KEIN NEULADEN BRAUCHT.
--
-- AGENTS.md Regel 4: alles in `core` ist aus `raw` neu aufbaubar. Der
-- Status stand die ganze Zeit vollständig in `raw.api_antwort` — nur der
-- Weg nach `core` war kaputt. 44.213 Bestellköpfe tragen ihn direkt,
-- der Rest kommt aus den Listenseiten. Kein einziger API-Aufruf nötig.
--
-- WIEDERHOLBAR: Beide UPDATEs lesen aus `raw` und schreiben nur, wo sich
-- etwas ändert. Solange ein Worker mit altem Code läuft, schreibt er
-- weiter `[object Object]` — dann diese Datei einfach nochmal ausführen
-- (sie ist ausserhalb des Migrationslaufs gefahrlos wiederholbar).
--
-- WAS BEWUSST NICHT DRIN IST: `pending`.
--
-- 15.893 Bestellungen über 13,2 Mio EUR stehen auf `pending`, verteilt
-- über 2020 bis 2026 und ohne einen einzigen Beleg. Das sind keine
-- offenen Bestellungen, sondern nie weitergeschaltete — ob sie fachlich
-- eingekauft wurden, ist offen und wird gemessen, nicht geraten. Bis
-- dahin zählen sie mit, sind aber in `mart.einkauf_ladestand` als eigene
-- Spalte sichtbar, statt in der Summe zu verschwinden.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. Rückbau: der Status aus dem Rohbestand
-- ---------------------------------------------------------------------

-- Zuerst die Bestellköpfe (`fn:bestellung`) — die genaueste Quelle, ein
-- Aufruf je Bestellung. Bei mehreren Abrufen derselben Bestellung gilt der
-- JÜNGSTE: ein Storno passiert nach der Bestellung, nicht davor.
WITH kopf AS (
    SELECT DISTINCT ON ((r.parameter->>'markeKey')::int, r.parameter->>'orderId')
           (r.parameter->>'markeKey')::int                    AS marke_key,
           r.parameter->>'orderId'                            AS fn_id,
           r.payload->'payload'->'shopOrderStatus'->>'name'   AS status
      FROM raw.api_antwort r
     WHERE r.quelle = 'foodnotify'
       AND r.endpunkt = 'fn:bestellung'
       AND r.payload->'payload'->'shopOrderStatus'->>'name' IS NOT NULL
     ORDER BY (r.parameter->>'markeKey')::int, r.parameter->>'orderId',
              r.abgerufen_am DESC
)
UPDATE core.bestellung b
   SET status = kopf.status
  FROM kopf, core.kostenstelle k
 WHERE k.kostenstelle_key = b.kostenstelle_key
   AND k.marke_key        = kopf.marke_key
   AND b.fn_id            = kopf.fn_id
   AND b.status IS DISTINCT FROM kopf.status;

-- Dann die Listenseiten (`fn:bestellungen`) — sie tragen denselben Status
-- in derselben Form und decken die Bestellungen ab, deren Kopf noch nicht
-- geholt ist (der Backfill arbeitet Liste und Detail getrennt ab).
-- NUR wo noch nichts Brauchbares steht: der Kopf hat Vorrang.
WITH liste AS (
    SELECT DISTINCT ON ((r.parameter->>'markeKey')::int, e->>'id')
           (r.parameter->>'markeKey')::int      AS marke_key,
           e->>'id'                             AS fn_id,
           e->'shopOrderStatus'->>'name'        AS status
      FROM raw.api_antwort r
      CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(r.payload->'payload'->'data') = 'array'
                  THEN r.payload->'payload'->'data'
                  ELSE '[]'::jsonb END) AS e
     WHERE r.quelle = 'foodnotify'
       AND r.endpunkt = 'fn:bestellungen'
       AND e->'shopOrderStatus'->>'name' IS NOT NULL
     ORDER BY (r.parameter->>'markeKey')::int, e->>'id', r.abgerufen_am DESC
)
UPDATE core.bestellung b
   SET status = liste.status
  FROM liste, core.kostenstelle k
 WHERE k.kostenstelle_key = b.kostenstelle_key
   AND k.marke_key        = liste.marke_key
   AND b.fn_id            = liste.fn_id
   AND (b.status IS NULL OR b.status = '[object Object]')
   AND b.status IS DISTINCT FROM liste.status;

/**
 * Ein Wächter, keine Kosmetik.
 *
 * Bleibt auch nur eine Zeile auf `[object Object]` stehen, hat der Rückbau
 * seine Quelle nicht gefunden — und eine halb reparierte Statusspalte ist
 * schlimmer als eine erkennbar kaputte, weil sie glaubwürdig aussieht.
 * Dann bricht die Migration ab (eine Transaktion, siehe db/migrate.ts) und
 * nichts davon ist passiert.
 *
 * ES SEI DENN, ein Worker mit altem Code schreibt gerade nach: dieser Fall
 * ist am Zeitstempel erkennbar und darf nicht blockieren. Deshalb zählt
 * der Wächter nur Bestellungen, für die `raw` überhaupt einen Status
 * kennt — was er kennt, muss angekommen sein.
 */
DO $$
DECLARE offen bigint;
BEGIN
    SELECT count(*) INTO offen
      FROM core.bestellung b
      JOIN core.kostenstelle k USING (kostenstelle_key)
     WHERE b.status = '[object Object]'
       AND EXISTS (
           SELECT 1 FROM raw.api_antwort r
            WHERE r.quelle = 'foodnotify'
              AND r.endpunkt = 'fn:bestellung'
              AND (r.parameter->>'markeKey')::int = k.marke_key
              AND r.parameter->>'orderId' = b.fn_id
              AND r.payload->'payload'->'shopOrderStatus'->>'name' IS NOT NULL);
    IF offen > 0 THEN
        RAISE EXCEPTION
            'Rueckbau unvollstaendig: % Bestellungen stehen auf [object Object], '
            'obwohl raw ihren Status kennt.', offen;
    END IF;
END $$;


-- ---------------------------------------------------------------------
-- 2. Die Detailsicht behält jede Zeile — und sagt jetzt, welche storniert ist
--
-- Hier wird NICHT gefiltert: das ist die Beweissicht, an der die
-- Aufrisse hängen. Wer eine Bestellung aufmacht, muss den Storno SEHEN,
-- nicht vermissen. Gefiltert wird eine Ebene höher, in den Summen.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.einkauf_position AS
SELECT
    bp.bestellposition_key,
    b.bestellung_key,
    m.name                       AS marke,
    k.restaurant_name            AS fn_betrieb,
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
    b.status                     AS bestellstatus,
    -- NEU. `IS NOT DISTINCT FROM` statt `=`: ein unbekannter Status (NULL,
    -- Bestellung noch ohne Kopf) ist NICHT storniert — im Zweifel zählt
    -- eine Bestellung mit, sonst verschwände sie beim Laden aus der Summe
    -- und käme später zurück.
    b.status IS NOT DISTINCT FROM 'canceled' AS storniert
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
die Kostenstelle keinem LINA-Betrieb zugeordnet ist. STORNOS STEHEN HIER MIT
DRIN und sind an `storniert` erkennbar: das ist die Beweissicht. Wer Summen
bildet, filtert `NOT storniert` — oder nimmt einkauf_betrieb_monat.';


-- ---------------------------------------------------------------------
-- 3. Die Summen lassen Stornos draußen
-- ---------------------------------------------------------------------

-- Der Preis einer stornierten Bestellung ist kein bezahlter Preis. Er
-- gehoert in keine Preisreihe — auch nicht als Ausreisser, denn er ist
-- kein Messfehler, sondern ein Vorgang, der zurueckgenommen wurde.
-- Spaltenliste unveraendert, deshalb reicht REPLACE und die abhaengige
-- Sicht einkaufspreis_veraenderung bleibt stehen.
CREATE OR REPLACE VIEW mart.einkaufspreis_monat AS
WITH basis AS (
    SELECT
        w.name  AS ware,
        m.name  AS marke,
        bp.einheit,
        date_trunc('month', b.bestellt_am)::date AS monat,
        bp.menge,
        bp.summe_preis,
        bp.gesamt_menge,
        bp.preis_je_einheit,
        bp.summe_preis / bp.menge AS preis_je_gebinde
      FROM core.bestellposition bp
      JOIN core.bestellung b USING (bestellung_key)
      JOIN core.kostenstelle k USING (kostenstelle_key)
      JOIN core.marke m ON m.marke_key = k.marke_key
      JOIN core.ware  w ON w.ware_key = bp.ware_key
     WHERE b.bestellt_am IS NOT NULL
       AND bp.menge > 0 AND bp.summe_preis > 0
       -- NEU: Stornos raus.
       AND b.status IS DISTINCT FROM 'canceled'
), streuung AS (
    SELECT ware, percentile_cont(0.5) WITHIN GROUP (
             ORDER BY preis_je_gebinde)::numeric AS median_gesamt,
           count(*) AS belege
      FROM basis GROUP BY ware
), bereinigt AS (
    SELECT b.* FROM basis b JOIN streuung s USING (ware)
     WHERE s.belege < 4
        OR (b.preis_je_gebinde <= s.median_gesamt * 20
        AND b.preis_je_gebinde * 20 >= s.median_gesamt)
)
SELECT
    ware, marke, einheit, monat,
    count(*)                       AS bestellungen,
    sum(menge)                     AS gebinde,
    sum(gesamt_menge)              AS menge,
    sum(summe_preis)               AS ausgaben,
    round(percentile_cont(0.5) WITHIN GROUP (
        ORDER BY preis_je_gebinde)::numeric, 2) AS preis_je_gebinde,
    round(min(preis_je_gebinde)::numeric, 2)    AS preis_min,
    round(max(preis_je_gebinde)::numeric, 2)    AS preis_max,
    round(percentile_cont(0.5) WITHIN GROUP (
        ORDER BY preis_je_einheit)::numeric, 4) AS preis_je_einheit_median
  FROM bereinigt
 GROUP BY ware, marke, einheit, monat;

COMMENT ON VIEW mart.einkaufspreis_monat IS
'Einkaufspreis je Ware und Monat. FUEHREND ist der Preis je GEBINDE (was ein
bestellter Karton gekostet hat) -- er braucht nur sumPrice und Menge und ist
damit belastbar. Der Preis je Basiseinheit steht daneben, wo FoodNotifys
Gebindeangabe verwertbar war; sie schwankt fuer dieselbe Ware um Faktor 140.000.
Gruppiert ueber den NAMEN: FoodNotify vergibt je Betrieb eigene Waren-IDs.
STORNIERTE Bestellungen sind ausgeschlossen (Migration 0043).';


-- Das Einkaufsvolumen je Betrieb: die Sicht, die neben dem Umsatz steht,
-- und damit die, in der die 2,49 Mio EUR Stornos am meisten wehtaten.
-- FILTER statt WHERE, damit der Storno nicht verschwindet, sondern in
-- eigenen Spalten danebensteht — eine stille Kuerzung waere derselbe
-- Fehler nochmal, nur in die andere Richtung.
CREATE OR REPLACE VIEW mart.einkauf_betrieb_monat AS
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
    -- coalesce auf 0, nicht NULL: ein Monat, in dem NUR storniert wurde,
    -- soll mit 0 EUR dastehen. NULL sortierte bei "ORDER BY einkauf_netto
    -- DESC" nach oben und fuehrte ausgerechnet die Volumenkarte an.
    coalesce(round(sum(bp.summe_preis)
        FILTER (WHERE b.status IS DISTINCT FROM 'canceled'), 2), 0) AS einkauf_netto,
    count(DISTINCT b.lieferant_key)
        FILTER (WHERE b.status IS DISTINCT FROM 'canceled') AS lieferanten,
    -- NEU: der Storno als eigene Groesse, sichtbar statt weggerechnet.
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
          date_trunc('month', b.bestellt_am);

COMMENT ON VIEW mart.einkauf_betrieb_monat IS
'Einkaufsvolumen je Betrieb, Bereich (Bar/Kueche) und Monat. Nur zugeordnete
Betriebe — die Sicht existiert, um neben dem LINA-Umsatz zu stehen.
`einkauf_netto` ist OHNE Stornos (Migration 0043); was storniert wurde, steht
in `storniert_netto` daneben.';


-- ---------------------------------------------------------------------
-- 4. Der Ladestand zeigt, was in der Summe fehlt und was fraglich ist
--
-- Diese Sicht ist der Vertrauensanker vor jeder Aussage ueber einen
-- Zeitraum. Sie muss deshalb auch die beiden Posten nennen, die NICHT im
-- Einkaufsvolumen stehen bzw. dort fraglich stehen: Stornos (raus) und
-- pending (drin, aber ungeklaert).
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.einkauf_ladestand AS
WITH seiten AS (
    SELECT w.marke_key,
           count(*) FILTER (WHERE w.erledigt_am IS NOT NULL) AS seiten_erledigt,
           count(*) FILTER (WHERE w.erledigt_am IS NULL)     AS seiten_offen
      FROM sync.warteschlange w
     WHERE w.endpunkt = 'fn:bestellungen'
     GROUP BY w.marke_key
)
SELECT
    m.name AS marke,
    date_trunc('month', b.bestellt_am)::date AS monat,
    count(*) AS bestellungen,
    count(*) FILTER (WHERE b.summe IS NOT NULL) AS mit_kopfdaten,
    count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM core.bestellposition p
         WHERE p.bestellung_key = b.bestellung_key)) AS mit_positionen,
    round(100.0 * count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM core.bestellposition p
         WHERE p.bestellung_key = b.bestellung_key)) / count(*), 1) AS positionen_pct,
    coalesce(s.seiten_erledigt, 0) AS seiten_erledigt,
    coalesce(s.seiten_offen, 0)    AS seiten_offen,
    coalesce(s.seiten_offen, 0) = 0 AS liste_vollstaendig,
    -- NEU. Storniert: aus dem Einkaufsvolumen ausgeschlossen.
    count(*) FILTER (WHERE b.status = 'canceled')  AS storniert,
    -- NEU. pending: zaehlt MIT, ist aber ungeklaert. 15.893 Stueck ueber
    -- 13,2 Mio EUR, verteilt ueber 2020-2026 und ohne einen Beleg. Steht
    -- hier, damit die Frage sichtbar bleibt, bis sie beantwortet ist.
    count(*) FILTER (WHERE b.status = 'pending')   AS pending,
    -- NEU. Der Waechter gegen den naechsten stillen Parserfehler: ist
    -- diese Zahl groesser als 0, kommt ein Status nicht durch.
    count(*) FILTER (WHERE b.status IS NULL
                        OR b.status = '[object Object]') AS status_unbekannt
  FROM core.bestellung b
  JOIN core.kostenstelle k USING (kostenstelle_key)
  JOIN core.marke m ON m.marke_key = k.marke_key
  LEFT JOIN seiten s ON s.marke_key = m.marke_key
 WHERE b.bestellt_am IS NOT NULL
 GROUP BY m.name, date_trunc('month', b.bestellt_am),
          s.seiten_erledigt, s.seiten_offen;

COMMENT ON VIEW mart.einkauf_ladestand IS
'Wie vollstaendig ist ein Monat geladen? Der Backfill laeuft rueckwaerts von
heute; ein duenner Monat in der Vergangenheit ist Ladestand, nicht Einbruch.
Vor jeder Aussage ueber einen Zeitraum hier nachsehen. `storniert` ist aus dem
Einkaufsvolumen heraus, `pending` zaehlt noch mit (ungeklaert),
`status_unbekannt` > 0 heisst: ein Status kommt nicht durch den Importer.';
