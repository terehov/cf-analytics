-- =====================================================================
-- Die Einkaufssichten rechnen jede Karte neu. Das haelt nicht mehr.
--
-- GEMESSEN AM 12.08.2026 auf der Produktionsdatenbank, waehrend der Nutzer
-- das Dashboard "Fremdeinkauf" geoeffnet hatte: siebzehn gleichzeitige
-- Abfragen, die aeltesten neun Minuten alt und noch nicht fertig. Es waren
-- die Karten EINER Seite.
--
-- WARUM. mart.fremdeinkauf ist eine Sicht. Jede ihrer zwoelf Karten liest
-- damit 394.575 Buchungsbelege und 66.926 Bestellungen von vorn, normiert
-- dabei jeden Kreditorennamen mit zwei regexp_replace ueber
-- core.kreditor_name_norm und aggregiert das Ergebnis. Zwoelf Karten sind
-- zwoelf vollstaendige Durchlaeufe derselben Rechnung, gleichzeitig
-- gestartet, um dieselben Kerne konkurrierend. mart.einkaufspreis_monat und
-- mart.einkaufspreis_betrieb machen dasselbe mit 876.611 Bestellpositionen,
-- je zwei percentile_cont und einem mode() obendrauf: lokal auf leerer
-- Maschine 1,2 bis 1,7 Sekunden je Aufruf, auf der Produktionsdatenbank
-- unter Last ein Vielfaches davon.
--
-- WAS SICH AENDERT. Die teure Haelfte — Scan, Normierung, Aggregation —
-- steht ab jetzt in materialisierten Sichten und wird einmal je Sync-Lauf
-- gerechnet (src/sync/einkauf_sichten.ts). Die fachliche Haelfte bleibt
-- Sicht.
--
-- DIE TRENNLINIE LAEUFT AN DER PFLEGEARBEIT ENTLANG, nicht am Rechenaufwand.
-- manual.lieferant_art und manual.lieferant_freigabe sind die Arbeitsliste
-- des Einkaufs: wer dort einen Lieferanten eintraegt, muss das Ergebnis
-- SOFORT sehen und nicht nach dem naechsten Sync. Deshalb liegt in der
-- Materialisierung nur das, was aus LINA und FoodNotify kommt; jede
-- Einordnung aus manual.* wird bei jedem Kartenaufruf frisch dazugejoint.
-- Das kostet nichts — die Pflegetabellen haben 5 bis 85 Zeilen.
--
-- KEIN NAME AENDERT SICH. mart.fremdeinkauf, mart.lieferant_freigabe_stand,
-- mart.einkaufspreis_monat und mart.einkaufspreis_betrieb bleiben Sichten
-- mit denselben Spalten in derselben Reihenfolge — CREATE OR REPLACE, kein
-- DROP. Metabase behaelt damit seine Feld-IDs, die Karten laufen weiter,
-- und kuenftige Migrationen koennen die Sichten wie bisher ersetzen. Wer
-- die LOGIK aendert, aendert die Sicht; wer die AGGREGATION aendert, muss
-- die materialisierte Sicht neu bauen.
--
-- Neu ist eine einzige fachliche Spalte: mart.einkaufspreis_betrieb.sperre
-- nennt, welche der vier Sperren eine Ware vom Vergleich ausschliesst. Sie
-- stand bisher als CASE in der Karte "Warum eine Ware nicht verglichen
-- wird" und wird jetzt fuer den Drill-Down ein zweites Mal gebraucht —
-- zwei Kopien derselben Fallunterscheidung waeren zwei Kopien zum
-- Auseinanderlaufen.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. mart.einkauf_kreditor_monat — die gemeinsame Grundlage
--
-- Je Quelle, Betrieb, Monat, Dachlieferant, Schreibweise und Bereich eine
-- Zeile mit Belegzahl und Netto. Genau das Korn, das die CTE "zeilen" in
-- mart.fremdeinkauf (0058) schon hatte; mart.lieferant_freigabe_stand
-- (0055) rechnete dieselbe Aggregation ein zweites Mal, nur groeber.
-- Ab jetzt rechnen beide auf derselben Tabelle.
--
-- DREI UNTERSCHIEDE ZUR CTE AUS 0058, alle drei absichtlich:
--
--   name_norm steht als eigene Spalte daneben. mart.lieferant_freigabe_stand
--   zaehlt daraus die Schreibweisen ("chefs culinar", "Chefs Culinar GmbH",
--   "CHEFS CULINAR SUED") je Dachname. Die Spalte ist funktional abhaengig
--   von name_quelle und verfeinert das Korn deshalb nicht.
--
--   erster/letzter halten das genaue Datum fest. Das Korn ist der Monat;
--   ohne diese beiden waere der Tag verloren, und die Spalte "Letzter Beleg"
--   in der Freigabeliste zeigte nur noch Monatserste.
--
--   Der FoodNotify-Zweig laesst Kostenstellen OHNE betrieb_key stehen. In
--   0058 filterte er sie weg, weil mart.fremdeinkauf den Betrieb ohnehin
--   per JOIN erzwingt — das tut die Sicht weiter unten unveraendert. Aber
--   mart.lieferant_freigabe_stand braucht sie: 25 der 152 Kostenstellen
--   haengen an keinem Betrieb, und ihre 1.127.133 EUR stehen dort als
--   fn_netto_ohne_betrieb. Wird hier gefiltert, verschwindet die Bruecke
--   zwischen zwei Zahlen, die sonst unerklaerlich auseinanderlaufen.
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mart.einkauf_kreditor_monat AS
WITH zeilen AS (
  SELECT 'foodnotify'::text                                    AS quelle,
         k.betrieb_key,
         date_trunc('month', b.bestellt_am)::date              AS monat,
         coalesce(g.dach_name, core.kreditor_name_norm(l.name)) AS dach_name,
         core.kreditor_name_norm(l.name)                       AS name_norm,
         l.name                                                AS name_quelle,
         k.art                                                 AS bereich,
         count(DISTINCT b.bestellung_key)                      AS belege,
         sum(b.summe)                                          AS netto,
         min(b.bestellt_am)::date                              AS erster,
         max(b.bestellt_am)::date                              AS letzter
    FROM core.bestellung b
    JOIN core.lieferant   l ON l.lieferant_key = b.lieferant_key
    JOIN core.kostenstelle k USING (kostenstelle_key)
    LEFT JOIN manual.kreditor_gruppe g
           ON g.name_norm = core.kreditor_name_norm(l.name)
   WHERE b.status IS DISTINCT FROM 'canceled'
     AND b.bestellt_am IS NOT NULL
     AND core.kreditor_name_norm(l.name) IS NOT NULL
   GROUP BY k.betrieb_key, date_trunc('month', b.bestellt_am),
            coalesce(g.dach_name, core.kreditor_name_norm(l.name)),
            core.kreditor_name_norm(l.name), l.name, k.art
  UNION ALL
  SELECT 'belegarchiv',
         bl.betrieb_key,
         date_trunc('month', bl.beleg_datum)::date,
         coalesce(g.dach_name, core.kreditor_name_norm(bl.verkaeufer_name)),
         core.kreditor_name_norm(bl.verkaeufer_name),
         bl.verkaeufer_name,
         /*
          * GRUPPIERT WIRD UEBER DEN CASE, nicht ueber zuordnung_fibu wie in
          * 0058. Nachgemessen am 12.08.2026 kennt die Spalte genau drei
          * Werte (0: 589.931, 1: 3.280, 2: 142) — die Umsetzung ist also
          * umkehrbar eindeutig und das Korn unveraendert. Notwendig ist der
          * Schritt fuer den Schluessel weiter unten: zwei verschiedene
          * Rohwerte, die beide auf NULL abbilden, ergaeben zwei Zeilen mit
          * demselben zeile_key und liessen den Refresh scheitern.
          */
         CASE WHEN bl.zuordnung_fibu = 1 THEN 'bar'
              WHEN bl.zuordnung_fibu = 2 THEN 'kueche'
              WHEN bl.zuordnung_fibu = 0 THEN 'sonstige'
              ELSE NULL
         END,
         count(*),
         sum(bl.netto),
         min(bl.beleg_datum),
         max(bl.beleg_datum)
    FROM core.buchungsbeleg bl
    LEFT JOIN manual.kreditor_gruppe g
           ON g.name_norm = core.kreditor_name_norm(bl.verkaeufer_name)
   WHERE bl.typ_id = '1'
     AND bl.beleg_datum IS NOT NULL
     AND core.kreditor_name_norm(bl.verkaeufer_name) IS NOT NULL
   GROUP BY bl.betrieb_key, date_trunc('month', bl.beleg_datum),
            coalesce(g.dach_name, core.kreditor_name_norm(bl.verkaeufer_name)),
            core.kreditor_name_norm(bl.verkaeufer_name), bl.verkaeufer_name,
            CASE WHEN bl.zuordnung_fibu = 1 THEN 'bar'
                 WHEN bl.zuordnung_fibu = 2 THEN 'kueche'
                 WHEN bl.zuordnung_fibu = 0 THEN 'sonstige'
                 ELSE NULL
            END
)
/*
 * DER SCHLUESSEL IST EIN HASH ueber das fachliche Korn, kein Zaehler.
 *
 * REFRESH ... CONCURRENTLY braucht einen eindeutigen Index, und er braucht
 * ihn ohne NULL: betrieb_key und bereich duerfen beide leer sein, und ueber
 * NULL vergleicht Postgres nicht. Ein zusammengesetzter Index waere fuer
 * genau die Zeilen wirkungslos, bei denen es darauf ankommt — sie wuerden
 * bei jedem Refresh geloescht und neu geschrieben statt erkannt.
 *
 * Kein row_number(): die Nummer waere bei jedem Lauf eine andere, und der
 * Abgleich verglichene dann jede Zeile mit einer fremden.
 */
SELECT md5(z.quelle
           || '|' || coalesce(z.betrieb_key::text, '')
           || '|' || z.monat::text
           || '|' || z.dach_name
           || '|' || coalesce(z.name_quelle, '')
           || '|' || coalesce(z.bereich, ''))  AS zeile_key,
       z.*
  FROM zeilen z;

CREATE UNIQUE INDEX einkauf_kreditor_monat_zeile
    ON mart.einkauf_kreditor_monat (zeile_key);
CREATE INDEX einkauf_kreditor_monat_monat
    ON mart.einkauf_kreditor_monat (monat);
CREATE INDEX einkauf_kreditor_monat_betrieb
    ON mart.einkauf_kreditor_monat (betrieb_key);
CREATE INDEX einkauf_kreditor_monat_dach
    ON mart.einkauf_kreditor_monat (dach_name);

COMMENT ON MATERIALIZED VIEW mart.einkauf_kreditor_monat IS
'Einkaufsvolumen je Quelle, Betrieb, Monat, Dachlieferant, Schreibweise und Bereich —
die gemeinsame Grundlage von mart.fremdeinkauf und mart.lieferant_freigabe_stand.
Materialisiert seit 0063, aufgefrischt im Sync-Nachlauf (src/sync/einkauf_sichten.ts).

ENTHAELT KEINE EINORDNUNG. Freigabe, GFGH und Lieferantenart kommen erst in den beiden
Sichten darueber dazu, und zwar bei jedem Kartenaufruf frisch: wer in
manual.lieferant_art einen Lieferanten eintraegt, sieht das Ergebnis sofort und nicht
nach dem naechsten Lauf.

QUELLE NIE SUMMIEREN. FoodNotify und Belegarchiv fuehren dieselbe Rechnung doppelt.';

COMMENT ON COLUMN mart.einkauf_kreditor_monat.zeile_key IS
'md5 ueber das fachliche Korn. Existiert nur, damit REFRESH CONCURRENTLY einen
eindeutigen Index ohne NULL-Spalten hat — fachlich sagt der Wert nichts.';
COMMENT ON COLUMN mart.einkauf_kreditor_monat.name_norm IS
'Normierte Schreibweise dieses einen Kreditors. dach_name fasst mehrere davon zusammen;
die Differenz ist die Spalte "Schreibweisen" in der Freigabeliste.';


-- ---------------------------------------------------------------------
-- 2. mart.fremdeinkauf — dieselbe Sicht, andere Grundlage
--
-- Spalten, Reihenfolge und Logik unveraendert gegenueber 0058. Ersetzt ist
-- allein die CTE "zeilen" durch mart.einkauf_kreditor_monat.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.fremdeinkauf AS
SELECT z.quelle,
       z.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       z.monat,
       z.dach_name     AS lieferant,
       z.name_quelle,
       z.bereich,
       coalesce(f.warengruppe,
                CASE WHEN h.dach_name IS NOT NULL THEN 'getraenke' END)
                       AS warengruppe,
       CASE
         WHEN f.freigegeben IS TRUE
              AND (f.gilt_ab IS NULL OR z.monat >= date_trunc('month', f.gilt_ab)::date)
           THEN 'freigegeben'
         WHEN gb.dach_name IS NOT NULL
           THEN 'freigegeben'
         ELSE 'nicht freigegeben'
       END             AS einordnung,
       CASE
         WHEN f.freigegeben IS TRUE
              AND (f.gilt_ab IS NULL OR z.monat >= date_trunc('month', f.gilt_ab)::date)
           THEN 'konzernfreigabe'
         WHEN gb.dach_name IS NOT NULL
           THEN 'gfgh des hauses'
         WHEN f.freigegeben IS FALSE
              AND (f.gilt_ab IS NULL OR z.monat >= date_trunc('month', f.gilt_ab)::date)
           THEN 'ausdruecklich gesperrt'
         WHEN h.dach_name IS NOT NULL
              AND gb_haus.dach_name IS NOT NULL
              AND gb_haus.dach_name IS DISTINCT FROM z.dach_name
           THEN 'fremder getraenkehaendler'
         WHEN f.freigegeben IS TRUE AND z.monat < date_trunc('month', f.gilt_ab)::date
           THEN 'freigabe galt damals noch nicht'
         ELSE 'steht nicht auf der liste'
       END             AS grund,
       gb_haus.dach_name AS gfgh_des_betriebs,
       z.belege,
       z.netto,
       la.art          AS lieferant_art,
       (la.art = 'wareneinkauf') AS wareneinkauf
  FROM mart.einkauf_kreditor_monat z
  -- Pflichtjoin wie bisher: eine Zeile ohne Betrieb hat in dieser Sicht
  -- nichts zu suchen. Sie steht in mart.lieferant_freigabe_stand als
  -- fn_netto_ohne_betrieb.
  JOIN core.betrieb b                 ON b.betrieb_key  = z.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = z.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = z.betrieb_key
  LEFT JOIN manual.lieferant_freigabe f ON f.dach_name  = z.dach_name
  LEFT JOIN manual.lieferant_art     la ON la.dach_name = z.dach_name
  LEFT JOIN manual.gfgh_haendler   h  ON h.dach_name    = z.dach_name
  LEFT JOIN manual.gfgh_betrieb gb
         ON gb.betrieb_key = z.betrieb_key AND gb.dach_name = z.dach_name
  LEFT JOIN manual.gfgh_betrieb gb_haus
         ON gb_haus.betrieb_key = z.betrieb_key;


-- ---------------------------------------------------------------------
-- 3. mart.lieferant_freigabe_stand — ebenfalls auf die Grundlage gesetzt
--
-- Spalten und Reihenfolge unveraendert gegenueber 0055. Die beiden CTEs fn
-- und beleg lesen statt core.bestellung und core.buchungsbeleg jetzt die
-- materialisierte Grundlage; gezaehlt wird dasselbe, nur eine Stufe
-- spaeter. count(DISTINCT bestellung_key) wird zu sum(belege) — beides
-- zaehlt jede Bestellung einmal, denn eine Bestellung liegt in genau einem
-- Betrieb und einem Monat.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.lieferant_freigabe_stand AS
WITH fn AS (
  SELECT z.dach_name,
         count(DISTINCT z.name_norm)                        AS schreibweisen,
         count(DISTINCT z.betrieb_key)                      AS betriebe,
         sum(z.belege)                                      AS belege,
         sum(z.netto)                                       AS netto,
         sum(z.netto) FILTER (WHERE st.status = 'operativ') AS netto_operativ,
         sum(z.netto) FILTER (WHERE z.betrieb_key IS NULL)  AS netto_ohne_betrieb,
         min(z.erster)                                      AS erster,
         max(z.letzter)                                     AS letzter
    FROM mart.einkauf_kreditor_monat z
    LEFT JOIN mart.betrieb_status st ON st.betrieb_key = z.betrieb_key
   WHERE z.quelle = 'foodnotify'
   GROUP BY z.dach_name
), beleg AS (
  SELECT z.dach_name,
         count(DISTINCT z.name_norm)                        AS schreibweisen,
         count(DISTINCT z.betrieb_key)                      AS betriebe,
         sum(z.belege)                                      AS belege,
         sum(z.netto)                                       AS netto,
         sum(z.netto) FILTER (WHERE st.status = 'operativ') AS netto_operativ,
         min(z.erster)                                      AS erster,
         max(z.letzter)                                     AS letzter
    FROM mart.einkauf_kreditor_monat z
    LEFT JOIN mart.betrieb_status st ON st.betrieb_key = z.betrieb_key
   WHERE z.quelle = 'belegarchiv'
   GROUP BY z.dach_name
), achse AS (
  SELECT dach_name FROM fn
  UNION
  SELECT dach_name FROM beleg
  UNION
  SELECT dach_name FROM manual.lieferant_freigabe
  UNION
  SELECT dach_name FROM manual.gfgh_betrieb WHERE dach_name IS NOT NULL
)
SELECT a.dach_name,
       CASE WHEN f.freigegeben IS TRUE  THEN 'freigegeben'
            WHEN f.freigegeben IS FALSE THEN 'gesperrt'
            WHEN gf.betriebe > 0        THEN 'GFGH je Betrieb'
            ELSE 'nicht eingeordnet'
       END                                          AS einordnung,
       coalesce(f.warengruppe,
                CASE WHEN h.dach_name IS NOT NULL THEN 'getraenke' END)
                                                    AS warengruppe,
       (h.dach_name IS NOT NULL)                    AS ist_gfgh,
       gf.betriebe                                  AS gfgh_fuer_betriebe,
       (fn.dach_name IS NULL AND beleg.dach_name IS NULL) AS trifft_nichts,
       coalesce(fn.schreibweisen, 0)                AS fn_schreibweisen,
       coalesce(fn.betriebe, 0)                     AS fn_betriebe,
       fn.netto                                     AS fn_netto,
       fn.netto_operativ                            AS fn_netto_operativ,
       fn.netto_ohne_betrieb                        AS fn_netto_ohne_betrieb,
       fn.letzter                                   AS fn_letzter_beleg,
       coalesce(beleg.schreibweisen, 0)             AS beleg_schreibweisen,
       coalesce(beleg.betriebe, 0)                  AS beleg_betriebe,
       beleg.netto                                  AS beleg_netto,
       beleg.netto_operativ                         AS beleg_netto_operativ,
       beleg.letzter                                AS beleg_letzter_beleg
  FROM achse a
  LEFT JOIN fn                        ON fn.dach_name    = a.dach_name
  LEFT JOIN beleg                     ON beleg.dach_name = a.dach_name
  LEFT JOIN manual.lieferant_freigabe f ON f.dach_name   = a.dach_name
  LEFT JOIN manual.gfgh_haendler      h ON h.dach_name   = a.dach_name
  LEFT JOIN LATERAL (
         SELECT count(*) AS betriebe
           FROM manual.gfgh_betrieb gb
          WHERE gb.dach_name = a.dach_name
       ) gf ON true
 ORDER BY greatest(coalesce(fn.netto, 0), coalesce(beleg.netto, 0)) DESC;


-- ---------------------------------------------------------------------
-- 4. mart.einkaufspreis_monat — Aggregation materialisiert
--
-- Der Rechenweg ist der aus 0062, Zeichen fuer Zeichen. Er steht jetzt in
-- einer materialisierten Sicht, und mart.einkaufspreis_monat reicht sie
-- durch. mart.einkaufspreis_veraenderung bleibt damit unangetastet: sie
-- liest weiter mart.einkaufspreis_monat und rechnet ihre Fensterfunktion
-- ueber eine Tabelle statt ueber 876.611 Bestellpositionen.
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mart.einkaufspreis_monat_basis AS
WITH basis AS (
    SELECT
        w.name  AS ware,
        m.name  AS marke,
        bp.einheit,
        date_trunc('month', b.bestellt_am)::date AS monat,
        bp.menge,
        bp.gebinde_menge,
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
        ORDER BY preis_je_einheit)::numeric, 4) AS preis_je_einheit_median,
    mode() WITHIN GROUP (ORDER BY gebinde_menge) AS gebinde_typisch,
    count(DISTINCT gebinde_menge)                AS gebinde_varianten
  FROM bereinigt
 GROUP BY ware, marke, einheit, monat;

-- Ware, Marke, Einheit und Monat sind das GROUP BY der Sicht und alle vier
-- ohne NULL (nachgemessen 12.08.2026: 0 von 577.257 Positionen). Der
-- zusammengesetzte Index reicht deshalb fuer CONCURRENTLY, ein Hash wie
-- oben ist hier nicht noetig.
CREATE UNIQUE INDEX einkaufspreis_monat_basis_korn
    ON mart.einkaufspreis_monat_basis (ware, marke, einheit, monat);
CREATE INDEX einkaufspreis_monat_basis_monat
    ON mart.einkaufspreis_monat_basis (monat);
CREATE INDEX einkaufspreis_monat_basis_ware
    ON mart.einkaufspreis_monat_basis (ware);

COMMENT ON MATERIALIZED VIEW mart.einkaufspreis_monat_basis IS
'Rechenstand von mart.einkaufspreis_monat, aufgefrischt im Sync-Nachlauf. NICHT direkt
abfragen — die Sicht mart.einkaufspreis_monat darueber ist die dokumentierte Schnittstelle
und traegt die Erklaerung der Spalten.';

CREATE OR REPLACE VIEW mart.einkaufspreis_monat AS
SELECT ware, marke, einheit, monat,
       bestellungen, gebinde, menge, ausgaben,
       preis_je_gebinde, preis_min, preis_max, preis_je_einheit_median,
       gebinde_typisch, gebinde_varianten
  FROM mart.einkaufspreis_monat_basis;


-- ---------------------------------------------------------------------
-- 5. mart.einkaufspreis_betrieb — Aggregation materialisiert, plus sperre
--
-- Rechenweg aus 0057 unveraendert. Neu ist allein die letzte Spalte der
-- Sicht: sperre nennt den Grund, aus dem vergleichbar = false gilt.
-- ---------------------------------------------------------------------
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
       /*
        * DIE SPERRE ALS TEXT, UND DIE REIHENFOLGE IST TEIL DER AUSSAGE.
        *
        * Ein Fall kann mehrere Sperren gleichzeitig reissen. Genannt wird
        * die erste — dieselbe Reihenfolge, in der die Karte "Warum eine
        * Ware nicht verglichen wird" bisher gezaehlt hat, damit die Zahlen
        * dieselben bleiben. "zu wenige Haeuser" steht zuoberst, weil es der
        * Normalfall ist und kein Datenproblem: unter drei Haeusern gibt es
        * keinen Massstab, egal wie sauber gebucht wurde.
        */
       CASE WHEN v.betriebe_operativ < 3   THEN 'zu wenige Häuser (unter 3)'
            WHEN v.gebinde_uneinheitlich   THEN 'Gebinde uneinheitlich'
            WHEN v.menge_widerspruechlich  THEN 'Menge widersprüchlich'
            WHEN v.spreizung_zu_gross      THEN 'Spreizung über Faktor 3'
            ELSE 'vergleichbar'
       END                             AS sperre,
       /*
        * Die haeufigste Gebindegroesse DIESES Hauses in diesem Monat. Sie
        * wurde in der CTE je_betrieb schon gerechnet und diente bisher nur
        * dazu, gebinde_uneinheitlich zu bilden — sichtbar war sie nirgends.
        * Fuer den Drill-Down ist sie die eigentliche Antwort: "Gebinde
        * uneinheitlich" heisst, dass diese Zahl zwischen den Haeusern
        * auseinandergeht, und das sieht man erst, wenn sie dasteht.
        */
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
CREATE INDEX einkaufspreis_betrieb_basis_sperre
    ON mart.einkaufspreis_betrieb_basis (sperre);

COMMENT ON MATERIALIZED VIEW mart.einkaufspreis_betrieb_basis IS
'Rechenstand von mart.einkaufspreis_betrieb, aufgefrischt im Sync-Nachlauf. NICHT direkt
abfragen — die Sicht darueber ist die dokumentierte Schnittstelle und traegt die
Erklaerung der vier Sperren.';

-- Die Sicht haengt die neue Spalte hinten an; CREATE OR REPLACE darf nur
-- anhaengen, und genau dort steht sie.
CREATE OR REPLACE VIEW mart.einkaufspreis_betrieb AS
SELECT betrieb_key, betrieb, konzept, betrieb_status, operativ, monat,
       ware, einheit, bereich, lieferanten, bestellungen, gebinde, menge,
       ausgaben, preis, preis_min, preis_max, preis_je_gebinde,
       betriebe_operativ, betriebe_gesamt,
       gebinde_uneinheitlich, menge_widerspruechlich, spreizung_zu_gross,
       konzern_median, konzern_bester, konzern_schlechtester,
       vergleichbar, abweichung_pct, mehrkosten,
       sperre, gebinde_typisch
  FROM mart.einkaufspreis_betrieb_basis;

COMMENT ON COLUMN mart.einkaufspreis_betrieb.gebinde_typisch IS
'Haeufigste Gebindegroesse dieses Hauses fuer diese Ware im Monat (Modus). Gehen die
Zahlen zwischen den Haeusern auseinander, ist gebinde_uneinheitlich = true — die Spalte
ist die Begruendung dieser Sperre, nicht nur eine Zusatzangabe.';

COMMENT ON COLUMN mart.einkaufspreis_betrieb.sperre IS
'Welche der vier Sperren diese Ware vom Preisvergleich ausschliesst, oder "vergleichbar".
Reisst ein Fall mehrere, steht die erste da — Reihenfolge wie in der Zaehlkarte. Die
Spalte ist der Filter des Drill-Downs "Warum diese Ware nicht verglichen wird".';
