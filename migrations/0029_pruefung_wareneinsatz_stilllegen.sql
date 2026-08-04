-- =====================================================================
-- 0029 mart.pruefung_wareneinsatz stilllegen
--
-- ANLASS. Stufe 0.3 aus docs/plan-foodnotify.md. LINAs Warenwirtschaft
-- enthaelt Demodaten (Vorgabe Eugene, 27.07.2026). core.artikel.fixer_we
-- stammt aus dem Artikelverkaufsbericht und galt als "Ergebnis der
-- LINA-Rezepturkalkulation" -- wenn die Rezepturen aber in FoodNotify
-- gepflegt werden und LINAs WAWI Demodaten sind, ist die Herkunft dieser
-- Zahl ungeklaert. Eine Pruefsicht, deren Sollwert niemand verantworten
-- kann, ist keine Pruefung.
--
-- DER ZWEITE GRUND, gefunden am 01.08.2026 bei der Vorbereitung dieser
-- Migration: DIE SICHT HAT IHREN EIGENEN WAECHTER NIE AUSGELOEST.
--
-- Der Kommentar an der Sicht warnt seit 0006 ausdruecklich:
--
--     "abdeckung_pct sagt, welcher Anteil des Artikelumsatzes ueberhaupt
--      einen hinterlegten Ansatz hat. UNTER ETWA 90 PROZENT IST DER
--      VERGLEICH NICHT AUSSAGEKRAEFTIG - dann ist der theoretische WE nur
--      strukturell zu niedrig."
--
-- Gemessen wurde am 01.08.2026:
--
--     Zeilen in der Sicht                              5.068
--     davon abdeckung_pct < 90                             0
--     Durchschnitt abdeckung_pct                       100,0
--
-- Kein einziger Fall. Der Grund steht in 0027:
--
--     sum(umsatz_netto) FILTER (WHERE fixer_we IS NOT NULL)
--
-- FIXER_WE IST NIE NULL. LINA liefert 0.0000, nicht NULL. Gemessen an
-- core.artikel_stand: 591.464 Zeilen, davon 0 mit NULL, 574.254 mit dem
-- Wert 0 (97,1 %) und nur 17.210 positiv. Der Filter greift damit nie,
-- umsatz_mit_we ist identisch mit umsatz_netto_pos, und abdeckung_pct
-- steht per Konstruktion auf 100.
--
-- WAS DAS ANGERICHTET HAT. 2.590 der 5.364 Betrieb-Monat-Kombinationen
-- (48 %) haben einen theoretischen Wareneinsatz von exakt null. Die
-- Sicht weist deren Luecke in voller Hoehe des BWA-Wareneinsatzes aus --
-- und meldet daneben 100 % Abdeckung. Zum Beispiel:
--
--     BS Bier & Speisen Gastro GmbH   2023-05   Luecke 235.900,27 EUR
--     Wirtshaus am Schlossplatz GmbH  2023-12   Luecke 197.452,41 EUR
--
-- Das sind keine Schwundwerte. Das ist ein fehlender Ansatz, der als
-- Schwund gelesen wird -- genau der Fehler, vor dem der Kommentar warnt,
-- unbemerkt, weil der Waechter selbst defekt war.
--
-- Die Stilllegung ist damit nicht nur eine Folge der FoodNotify-
-- Entscheidung, sondern unabhaengig davon richtig.
--
-- WARUM DROP UND NICHT REPARIEREN. Der Filter liesse sich in einer Zeile
-- korrigieren (fixer_we > 0 statt IS NOT NULL). Dann meldete die Sicht
-- korrekt, dass sie fuer die Haelfte aller Betriebsmonate nichts sagen
-- kann -- und fuer den Rest Zahlen liefert, deren Herkunft weiterhin
-- ungeklaert ist. Eine Pruefsicht, die zur Haelfte schweigt und zur
-- anderen Haelfte unbelegte Werte liefert, ist schlechter als keine:
-- sie sieht aus wie eine Antwort.
--
-- WAS AN IHRE STELLE TRITT. Stufe 2.4 aus docs/plan-foodnotify.md: der
-- theoretische Wareneinsatz aus FoodNotifys Zutatenkosten
-- (core.rezept x core.zutat x core.ware), verknuepft ueber die
-- POS-Zuordnung (core.pos_artikel.plu = core.artikel.artikelnummer,
-- belegt in docs/foodnotify-0-1-nummernraum.md). Dann mit dem
-- Bar/Kueche-Split, den diese Sicht nie bilden konnte, weil die
-- Hauptsparte am Umsatzbericht haengt und nicht am Artikel.
--
-- BIS DAHIN GILT: keine Entscheidung auf dieser Sicht aufbauen. Deshalb
-- DROP und nicht auskommentiert -- eine Sicht, die noch antwortet, wird
-- benutzt.
--
-- NICHT BETROFFEN. mart.deckungsbeitrag_warengruppe bleibt. Sie hat
-- dieselbe Schwaeche in abdeckung_pct (siehe unten), aber ihr Zweck ist
-- der Umsatz je Warengruppe, nicht der Soll-Ist-Vergleich. Ihre
-- Abdeckungsspalte wird hier mit korrigiert, damit sie nicht dieselbe
-- falsche Sicherheit ausstrahlt.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. mart.pruefung_uebersicht ohne die Wareneinsatz-Zeile
--
-- Die Uebersicht ist die "erste Abfrage nach jedem groesseren Backfill".
-- Sie muss zuerst weichen, sonst blockiert sie den DROP.
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS mart.pruefung_uebersicht;

DROP VIEW IF EXISTS mart.pruefung_wareneinsatz;

CREATE VIEW mart.pruefung_uebersicht AS
SELECT 'Umsatz: Artikelsumme vs. Umsatzbericht' AS pruefung,
       count(*)                                  AS geprueft,
       count(*) FILTER (WHERE auffaellig)        AS auffaellig,
       'mart.pruefung_umsatz'                    AS sicht
  FROM mart.pruefung_umsatz
UNION ALL
SELECT 'Bon: avgTicket vs. Umsatz/Rechnungen',
       count(*), count(*) FILTER (WHERE auffaellig), 'mart.pruefung_bon'
  FROM mart.pruefung_bon;

COMMENT ON VIEW mart.pruefung_uebersicht IS
'Erste Abfrage nach jedem groesseren Backfill: SELECT * FROM mart.pruefung_uebersicht;
Die Spalte auffaellig ist eine Arbeitsliste, kein Alarm.

Die Zeile "Wareneinsatz: Abdeckung unter 90 %" ist am 01.08.2026 entfallen (Migration
0029). Sie hat nie ausgeloest, weil ihr Filter auf IS NOT NULL prueft und fixer_we nie
NULL ist, sondern 0. Sie meldete 100 % Abdeckung fuer 5.068 Zeilen, darunter 2.590 ohne
jeden hinterlegten Ansatz. Ein Waechter, der immer gruen zeigt, ist schlimmer als keiner.

Der Soll-Ist-Vergleich des Wareneinsatzes kommt in Stufe 2.4 auf Basis der
FoodNotify-Zutatenkosten zurueck, siehe docs/plan-foodnotify.md.';


-- ---------------------------------------------------------------------
-- 2. abdeckung_pct in mart.deckungsbeitrag_warengruppe korrigieren
--
-- Dieselbe Ursache, andere Sicht. Hier ist die Spalte nicht tragend --
-- die Sicht dient dem Umsatz je Warengruppe --, aber sie behauptet
-- flaechendeckend 100 % und wuerde beim naechsten Leser dieselbe
-- Fehlannahme ausloesen.
--
-- fixer_we > 0 ist die richtige Bedingung: ein Ansatz von exakt null ist
-- kein hinterlegter Ansatz, sondern ein fehlender. Das ist bei einem
-- Wareneinsatz auch fachlich so -- ein Artikel, der nichts kostet, gibt
-- es nicht.
--
-- CONCURRENTLY ist hier nicht moeglich (die Sicht wird neu angelegt);
-- der Aufbau dauert rund 145 Sekunden. Migrationen laufen ohnehin nicht
-- im laufenden Betrieb.
-- ---------------------------------------------------------------------

-- mart.deckungsbeitrag_stand liest die Sicht und muss deshalb zuerst
-- weichen. Bewusst kein CASCADE: die Standsicht wird unten
-- unveraendert wieder angelegt, und ein CASCADE haette sie
-- stillschweigend verschluckt -- gerade die Sicht, die beantwortet, wie
-- alt die Zahlen sind.
DROP VIEW IF EXISTS mart.deckungsbeitrag_stand;

DROP MATERIALIZED VIEW IF EXISTS mart.deckungsbeitrag_warengruppe;

CREATE MATERIALIZED VIEW mart.deckungsbeitrag_warengruppe AS
SELECT betrieb_key, betrieb, konzept, monat,
       grosskategorie, warengruppe, detailkategorie,
       sum(menge)                                              AS menge,
       sum(umsatz_netto)                                       AS umsatz_netto_pos,
       sum(wareneinsatz_theoretisch)                           AS wareneinsatz_theoretisch,
       sum(umsatz_netto) - sum(wareneinsatz_theoretisch)       AS deckungsbeitrag,
       CASE WHEN sum(umsatz_netto) > 0
            THEN round(100 * (sum(umsatz_netto) - sum(wareneinsatz_theoretisch))
                       / sum(umsatz_netto), 2)
       END                                                     AS deckungsbeitrag_prozent,
       -- KORRIGIERT IN 0029: vorher FILTER (WHERE fixer_we IS NOT NULL).
       -- fixer_we ist nie NULL -- LINA liefert 0.0000 --, der Filter
       -- griff also nie und die Spalte stand ausnahmslos auf 100.
       round(100 * sum(umsatz_netto) FILTER (WHERE fixer_we > 0)
             / nullif(sum(umsatz_netto), 0), 1)                AS abdeckung_pct,
       -- Der Umsatz MIT hinterlegtem Ansatz, als eigene Summe.
       --
       -- abdeckung_pct ist ein Prozentwert und damit nicht wieder
       -- aufsummierbar: aus Prozenten laesst sich der zugrunde liegende
       -- Betrag nicht zurueckrechnen. Wer auf einer hoeheren Ebene
       -- (Betrieb x Monat) weiterrechnet, braucht genau diesen Betrag.
       sum(umsatz_netto) FILTER (WHERE fixer_we > 0)           AS umsatz_mit_we
  FROM mart.artikelverkauf
 GROUP BY 1, 2, 3, 4, 5, 6, 7;

-- Unveraendert aus 0027: die Gruppierung eins zu eins als eindeutiger
-- Index. NULLS NOT DISTINCT, weil die drei Kategoriespalten NULL sein
-- duerfen (Artikel ohne Sortimentszuordnung). Ohne den Index kein
-- REFRESH CONCURRENTLY.
CREATE UNIQUE INDEX deckungsbeitrag_warengruppe_schluessel
    ON mart.deckungsbeitrag_warengruppe
       (betrieb_key, monat, grosskategorie, warengruppe, detailkategorie)
       NULLS NOT DISTINCT;

-- Unveraendert aus 0027: die beiden Zugriffswege der Karten.
CREATE INDEX deckungsbeitrag_warengruppe_monat
    ON mart.deckungsbeitrag_warengruppe (monat);
CREATE INDEX deckungsbeitrag_warengruppe_betrieb
    ON mart.deckungsbeitrag_warengruppe (betrieb);
CREATE INDEX deckungsbeitrag_warengruppe_konzept
    ON mart.deckungsbeitrag_warengruppe (konzept);

COMMENT ON MATERIALIZED VIEW mart.deckungsbeitrag_warengruppe IS
'Deckungsbeitrag je Warengruppe und Monat. Prozentwerte sind Prozentzahlen (23.64), nie Brueche.

MATERIALISIERT seit 01.08.2026 -- die Zahlen sind so alt wie der letzte REFRESH. Der laeuft im
Nachlauf jedes Sync-Laufs; der Stand steht in mart.deckungsbeitrag_stand.

Wer sie von Hand auffrischt:
    REFRESH MATERIALIZED VIEW CONCURRENTLY mart.deckungsbeitrag_warengruppe;

ZUERST AUF abdeckung_pct SEHEN. Sie sagt, welcher Anteil des Umsatzes ueberhaupt einen
hinterlegten Wareneinsatzansatz hat. Bei 60 Prozent Abdeckung ist der Deckungsbeitrag
strukturell zu hoch, und zwar ohne dass man es der Zahl ansieht.

DIE SPALTE WAR BIS 0029 DEFEKT: sie filterte auf fixer_we IS NOT NULL, doch fixer_we ist nie
NULL (LINA liefert 0.0000). Sie stand deshalb ausnahmslos auf 100. Seit 0029 filtert sie auf
fixer_we > 0 und zeigt die tatsaechliche, deutlich niedrigere Abdeckung.

ACHTUNG BEIM WARENEINSATZ: wareneinsatz_theoretisch beruht auf core.artikel.fixer_we, und
dessen Herkunft ist seit dem 27.07.2026 ungeklaert (LINAs Warenwirtschaft enthaelt Demodaten,
die Rezepturen werden in FoodNotify gepflegt). Der Deckungsbeitrag ist als Umsatzgliederung
belastbar, als Margenaussage NICHT. Siehe docs/plan-foodnotify.md, Stufe 2.4.

ACHTUNG: umsatz_netto_pos ist der POS-Artikelumsatz und NICHT das BWA-Umsatzkonto aus
core.kennzahlen_monat - die beiden weichen systematisch ab.';


-- ---------------------------------------------------------------------
-- 3. mart.deckungsbeitrag_stand wieder anlegen
--
-- Unveraendert aus 0027. Sie musste nur weichen, weil sie auf der
-- materialisierten Sicht steht.
-- ---------------------------------------------------------------------

CREATE VIEW mart.deckungsbeitrag_stand AS
SELECT (SELECT gesetzt_am FROM sync.merker
         WHERE schluessel = 'deckungsbeitrag_refresh')             AS aufgefrischt_am,
       (SELECT (wert->>'dauer_s')::numeric FROM sync.merker
         WHERE schluessel = 'deckungsbeitrag_refresh')             AS dauer_s,
       (SELECT count(*) FROM mart.deckungsbeitrag_warengruppe)     AS zeilen,
       (SELECT max(monat) FROM mart.deckungsbeitrag_warengruppe)   AS juengster_monat;

COMMENT ON VIEW mart.deckungsbeitrag_stand IS
'Wie alt die Zahlen in mart.deckungsbeitrag_warengruppe sind. aufgefrischt_am ist NULL, solange
der erste Refresh im Sync-Nachlauf nicht gelaufen ist -- die Sicht selbst ist dann trotzdem
gefuellt, naemlich mit dem Stand aus der Migration.';


-- ---------------------------------------------------------------------
-- 4. Den Refresh-Merker auf jetzt setzen
--
-- Der CREATE MATERIALIZED VIEW oben hat die Sicht frisch aufgebaut --
-- aber sync.merker weiss davon nichts und traegt noch den Zeitpunkt des
-- letzten Nachlaufs. mart.deckungsbeitrag_stand haette damit einen
-- Zeitstempel gemeldet, der VOR dem tatsaechlichen Aufbau liegt.
--
-- Das ist genau die Sorte Zahl, gegen die diese Standsicht gebaut wurde:
-- eine, die aelter aussieht als sie ist, ohne dass man es merkt. Also
-- hier mitziehen. dauer_s bleibt der gemessene Wert aus 0027 (145 s);
-- der naechste echte Nachlauf ueberschreibt beides.
-- ---------------------------------------------------------------------

INSERT INTO sync.merker (schluessel, wert)
VALUES ('deckungsbeitrag_refresh', jsonb_build_object('dauer_s', 145.2))
ON CONFLICT (schluessel)
DO UPDATE SET wert = EXCLUDED.wert, gesetzt_am = now();
