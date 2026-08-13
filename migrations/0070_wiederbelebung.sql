-- =====================================================================
-- 0070 Aufgegebene Posten kommen zurueck — begrenzt, und ohne Handbefehl
--
-- ANLASS. 0069 hat den Zulauf des Belegarchivs automatisch gemacht, die
-- beiden anderen Luecken aus Phase 1 aber an zwei Handbefehle gehaengt:
-- `einreihen --foodnotify-inventurpositionen` fuer die 936 abgeschnittenen
-- Inventurpositionen und `einreihen --aufgegebene` fuer die 275
-- aufgegebenen Posten. Entscheidung Eugene vom 13.08.2026: **kein Befehl
-- auf dem Server.** Was fehlt, holt der Lauf selbst.
--
-- Und das ist nicht nur bequemer, es ist richtiger. Eine Reparatur, die
-- ein Mensch anstossen muss, ist eine Verabredung — sie faellt irgendwann
-- aus, und ihr Ausfall sieht aus wie Ruhe. Am 02.08.2026 stand LINA
-- deshalb acht Tage still, am 12.08.2026 fror das Belegarchiv deshalb ein.
-- Zweimal dieselbe Signatur, zweimal Tage.
--
-- ---------------------------------------------------------------------
-- DIE INVENTUREN BRAUCHEN KEIN SCHEMA — SIE HABEN SCHON EINE INVARIANTE
--
-- `core.inventur.anzahl_positionen` kommt aus FoodNotifys
-- `totalNumberOfItems` und sagt, wie viele Positionen die Zaehlung hat.
-- Weicht `count(*)` in core.inventurposition davon ab, fehlt etwas. Am
-- 13.08.2026 in Produktion gemessen: 349 von 358 stimmen auf die Position
-- genau ueberein, 9 sind bei exakt 800 abgeschnitten, NULL andere
-- Ausreisser, keine einzige Inventur ohne Positionen. Die Bedingung feuert
-- also fuer genau die neun und danach fuer keine mehr —
-- `inventurpositionenNachziehen()` in src/sync/nachfuellen.ts.
--
-- ---------------------------------------------------------------------
-- DIE AUFGEGEBENEN POSTEN BRAUCHEN EINEN ZAEHLER
--
-- Fuer sie gibt es keine solche Invariante: `core.bestellung` fuehrt keine
-- Positionszahl im Kopf, an der man „unvollstaendig" ablesen koennte
-- (nachgesehen am 13.08.2026, die Spalte existiert schlicht nicht). Der
-- Rueckholvorgang muss sich deshalb selbst begrenzen, sonst kostet ein
-- dauerhaft kaputter Posten jede Nacht MAX_VERSUCHE Aufrufe und kommt nie
-- zur Ruhe. Das ist derselbe Bau wie der 403-Zweig in src/sync/worker.ts,
-- der seit neun Tagen bei netto ±0 Versuchen steht.
--
-- `wiederbelebt` zaehlt mit. Nach MAX_WIEDERBELEBUNGEN (3) ist Schluss,
-- und was dann noch steht, ist eine Quellengrenze und keine Stoerung —
-- sichtbar in mart.posten_aufgegeben, nicht in einem Log.
--
-- Warum drei reichen: aufgegeben ist selten. 275 von 168.725 erledigten
-- Posten sind 0,16 %, und alle 275 stammen aus zwei Tagen schwerer
-- Backfill-Last (02. bis 04.08.2026, ausnahmslos HTTP 500). Drei Anlaeufe
-- an drei Tagen unterscheiden einen Aussetzer der Gegenstelle von einer
-- Grenze der Quelle. Zu FoodNotify gibt es keinen Kontakt; die Frage laesst
-- sich nur durch einen erneuten Versuch beantworten.
--
-- Die Wiederbelebung verlangt zusaetzlich, dass derselbe Endpunkt in den
-- letzten 24 Stunden mindestens einmal 'ok' geliefert hat. Ohne das
-- verbraeuchte ein zweitaegiger Ausfall der Gegenstelle den ganzen Vorrat —
-- ausgerechnet bevor sie wieder da ist.
--
-- ---------------------------------------------------------------------
-- DIE RECHNUNG
--
-- FoodNotify, Tagesbudget 140.000, verbraucht rund 155 bis 1.000:
--   275 aufgegebene x hoechstens 4 Versuche x 3 Wiederbelebungen
--     = hoechstens 3.300 Aufrufe, verteilt auf mehrere Tage      (2,4 %)
--   9 abgeschnittene Inventuren, Seite 1 plus Folgeseiten
--     = rund 20 Aufrufe, einmalig                                (0,01 %)
-- Danach faellt beides auf null zurueck, weil die Bedingungen nicht mehr
-- zutreffen. Kein Dauerverbrauch.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Der Zaehler
-- ---------------------------------------------------------------------

ALTER TABLE sync.warteschlange
    ADD COLUMN IF NOT EXISTS wiederbelebt smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN sync.warteschlange.wiederbelebt IS
'Wie oft der naechtliche Lauf diesen Posten aus dem Zustand aufgegeben zurueckgeholt
hat. Obergrenze ist MAX_WIEDERBELEBUNGEN (Vorgabe 3, src/config.ts); danach bleibt er
liegen und gilt als Grenze der Quelle, nicht als Stoerung.
NICHT zu verwechseln mit versuche: das zaehlt die Anlaeufe INNERHALB eines Lebens und
wird beim Wiederbeleben auf 0 zurueckgesetzt. wiederbelebt zaehlt die Leben.';

-- Der Zugriffspfad von aufgegebeneWiederbeleben(): sie sucht genau die
-- Zeilen mit ergebnis = 'aufgegeben' und noch freiem Zaehler. Partiell,
-- weil das 275 von 168.000 Zeilen sind — ein voller Index waere hier
-- 600-mal so gross wie noetig.
CREATE INDEX IF NOT EXISTS warteschlange_aufgegeben
    ON sync.warteschlange (endpunkt, wiederbelebt, erledigt_am)
 WHERE ergebnis = 'aufgegeben';


-- ---------------------------------------------------------------------
-- 2. mart.posten_aufgegeben — was noch versucht wird und was nicht mehr
--
-- Die Regel aus AGENTS.md: ein Zweig, der "nichts zu tun" bedeutet, muss
-- sichtbar sein. "Endgueltig aufgegeben" IST so ein Zweig — und der
-- gefaehrlichste, weil er dauerhaft ist und nichts mehr meldet.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.posten_aufgegeben AS
SELECT w.posten_id,
       w.endpunkt,
       m.schluessel                AS marke,
       w.zeitraum_von,
       w.parameter,
       w.versuche,
       w.wiederbelebt,
       w.erledigt_am               AS zuletzt_aufgegeben,
       left(w.letzter_fehler, 200) AS fehler,
       CASE WHEN w.wiederbelebt >= 3 THEN 'endgueltig'
            ELSE 'wird erneut versucht' END AS zustand,
       -- Antwortet die Quelle ueberhaupt? Ohne ein frisches 'ok' desselben
       -- Endpunkts ruht die Wiederbelebung, statt den Vorrat zu verbrauchen.
       EXISTS (SELECT 1 FROM sync.aufgabe a
                WHERE a.endpunkt = w.endpunkt AND a.status = 'ok'
                  AND a.beendet_am > now() - interval '24 hours') AS quelle_antwortet
  FROM sync.warteschlange w
  LEFT JOIN core.marke m ON m.marke_key = w.marke_key
 WHERE w.ergebnis = 'aufgegeben'
 ORDER BY w.wiederbelebt DESC, w.erledigt_am DESC;

COMMENT ON VIEW mart.posten_aufgegeben IS
'Posten, die der Worker aufgegeben hat. ERWARTUNG: leer, oder nur Zeilen mit
zustand = endgueltig und einer Begruendung, die jemand gelesen hat.

  wird erneut versucht  der naechtliche Lauf holt ihn zurueck, solange
                        quelle_antwortet true ist. Hoechstens dreimal.
  endgueltig            der Vorrat ist aufgebraucht. Das ist die Aussage
                        "diese Daten sind aus der Quelle nicht zu bekommen",
                        und sie gehoert geprueft, nicht ignoriert.

Am 13.08.2026 standen hier 275 Zeilen, ausnahmslos fn:bestellpositionen mit HTTP 500
aus dem Backfill vom 02. bis 04.08.2026 — und mit ihnen 322 Bestellungen ueber
686.535,93 EUR, die einen Kopf hatten und keine einzige Position.

wiederbelebt ist NICHT versuche: versuche zaehlt die Anlaeufe innerhalb eines Lebens
und faengt nach dem Wiederbeleben bei 0 an, wiederbelebt zaehlt die Leben.';


-- ---------------------------------------------------------------------
-- 3. Die Uebersicht trennt jetzt beide Zustaende
--
-- Eine Zeile "275 aufgegeben" sagt nicht, ob jemand etwas tun muss. Eine
-- Zeile "0 endgueltig" sagt es.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS
SELECT 'Umsatz: Artikelsumme vs. Umsatzbericht' AS pruefung,
       count(*)                                  AS geprueft,
       count(*) FILTER (WHERE auffaellig)        AS auffaellig,
       'mart.pruefung_umsatz'                    AS sicht
  FROM mart.pruefung_umsatz
UNION ALL
SELECT 'Bon: avgTicket vs. Umsatz/Rechnungen',
       count(*), count(*) FILTER (WHERE auffaellig), 'mart.pruefung_bon'
  FROM mart.pruefung_bon
UNION ALL
SELECT 'Belegarchiv: Ordner ohne den faelligen Abzug',
       count(*), count(*) FILTER (WHERE zustand = 'abzug fehlt'),
       'mart.belegarchiv_zulauf'
  FROM mart.belegarchiv_zulauf
UNION ALL
SELECT 'Belegarchiv: seit ueber 36 h nicht gezaehlt',
       count(*),
       count(*) FILTER (WHERE zuletzt_gezaehlt IS NULL
                           OR zuletzt_gezaehlt < now() - interval '36 hours'),
       'mart.belegarchiv_zulauf'
  FROM mart.belegarchiv_zulauf
UNION ALL
SELECT 'Inventur: Zaehlung abgeschnitten',
       (SELECT count(*) FROM core.inventur WHERE anzahl_positionen IS NOT NULL),
       count(*), 'mart.inventur_abgeschnitten'
  FROM mart.inventur_abgeschnitten
UNION ALL
SELECT 'Bestellung: Kopf ohne eine einzige Position',
       count(*), count(*) FILTER (WHERE NOT EXISTS (
                   SELECT 1 FROM core.bestellposition p
                    WHERE p.bestellung_key = b.bestellung_key)),
       'core.bestellung'
  FROM core.bestellung b
UNION ALL
-- Getrennt gezaehlt: "wird noch versucht" ist Betrieb, "endgueltig" ist ein Befund.
SELECT 'Warteschlange: endgueltig aufgegeben',
       count(*), count(*) FILTER (WHERE zustand = 'endgueltig'),
       'mart.posten_aufgegeben'
  FROM mart.posten_aufgegeben;

COMMENT ON VIEW mart.pruefung_uebersicht IS
'Erste Abfrage nach jedem groesseren Backfill: SELECT * FROM mart.pruefung_uebersicht;
Die Spalte auffaellig ist eine Arbeitsliste, kein Alarm.

Am 13.08.2026 sind vier Zulaufpruefungen dazugekommen, alle aus demselben Anlass: eine
Quelle ohne Zulauf ist ein Fehler und kein Normalzustand, und der Lauf hat sie zweimal
als "ok" gemeldet (AGENTS.md Regel 10). Was sie beim Anlegen zeigten:

  Belegarchiv: Ordner ohne den faelligen Abzug       0 von 1.974
  Belegarchiv: seit ueber 36 h nicht gezaehlt    1.974 von 1.974 (vor dem ersten Lauf
                                                 mit la:belegzahl)
  Inventur: Zaehlung abgeschnitten                   9 von 358, 936 Positionen
  Bestellung: Kopf ohne eine einzige Position      322 von 66.942, 686.535,93 EUR
  Warteschlange: endgueltig aufgegeben               0 von 275

Die letzte Zeile zaehlt AUSDRUECKLICH nur die endgueltigen. Ein aufgegebener Posten,
den der Lauf noch dreimal zurueckholt, ist Betrieb und kein Befund — wer beides in
eine Zahl wirft, bekommt eine Kachel, die immer rot ist und die deshalb niemand mehr
ansieht.

Die Zeile "Wareneinsatz: Abdeckung unter 90 %" ist am 01.08.2026 entfallen (Migration
0029). Sie hat nie ausgeloest, weil ihr Filter auf IS NOT NULL prueft und fixer_we nie
NULL ist, sondern 0. Ein Waechter, der immer gruen zeigt, ist schlimmer als keiner.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0070', to_jsonb(
        'sync.warteschlange.wiederbelebt und mart.posten_aufgegeben. Die beiden '
        'Handbefehle aus 0069 sind entfallen: der naechtliche Lauf zieht '
        'unvollstaendige Inventurzaehlungen selbst nach (Invariante '
        'anzahl_positionen <> count(*)) und holt aufgegebene Posten hoechstens '
        'dreimal zurueck. Entscheidung Eugene, 13.08.2026: kein Befehl auf dem '
        'Server. Eine Reparatur, die ein Mensch anstossen muss, faellt aus, und '
        'ihr Ausfall sieht aus wie Ruhe.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
