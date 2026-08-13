-- =====================================================================
-- 0072 Bestelldetails altern nie nach — der groesste Befund des Reviews
--
-- ANLASS (13.08.2026, lesend in Produktion gemessen). Von 66.966
-- Bestellungen wurde JEDE GENAU EINMAL im Detail geholt. Keine einzige je
-- erneut:
--
--   SELECT count(*), count(DISTINCT parameter->>'orderId')
--     FROM sync.aufgabe WHERE endpunkt = 'fn:bestellung' AND status = 'ok';
--   -- 66.966 | 66.966   → mehrfach geholt: 0
--
-- Der Grund ist dieselbe Bauform wie bei allen Befunden dieses Plans: die
-- Detailposten entstehen aus der Bestellliste ueber folgepostenEinreihen()
-- mit der Sperre gegen ALLE Posten — die Sperre eines EINMALIGEN Abrufs.
-- Fuer den Backfill war das richtig. Als laufender Abgleich ist es falsch.
--
-- WAS DAS KOSTET. Der Listen-Upsert frischt nur `status` auf, und auch das
-- nur, solange die Bestellung auf der LETZTEN Seite ihrer Kostenstelle
-- steht. Liefermengen (`adjustedQuantity`), Lieferdatum, Belegnummer und
-- alle Preisstaende stehen auf dem Stand des ERSTEN Abrufs. Der Transform
-- liest `adjustedQuantity` laengst korrekt — es fehlt nur der erneute
-- Abruf. In den Einkaufssichten stehen damit heute laufend Bestellmengen,
-- wo Liefermengen stehen muessten.
--
-- Der Bestand am 13.08.2026:
--   imported  47.340    pending  16.203    canceled  3.350
--   accepted      61    finished     12
-- 32.812 der Detailabrufe stammen vom 04.08.2026, 6.942 vom 05.08. — der
-- Backfill. Danach nur noch, was neu dazukam.
--
-- ---------------------------------------------------------------------
-- WARUM EINE SPALTE UND KEINE ABFRAGE AUF sync.aufgabe
--
-- „Wann wurde diese Bestellung zuletzt im Detail geholt?" liesse sich aus
-- sync.aufgabe beantworten. Das waere aber je Nacht eine Gruppierung ueber
-- inzwischen 66.966 orderId-Parameter in einer Tabelle, die um 1.834
-- Zeilen am Tag waechst. core.bestellung.detail_geholt_am beantwortet
-- dieselbe Frage mit einem Indexzugriff — und sie steht dort, wo auch die
-- Bestellung steht, also sieht sie jeder, der die Zeile ansieht.
--
-- NULL HEISST „SEIT EINFUEHRUNG DIESER SPALTE NICHT GEHOLT", nicht „nie".
-- Alle 66.966 vorhandenen Zeilen starten auf NULL, und genau das ist
-- gewollt: sie SIND der eingefrorene Altbestand, den der Nachholauf
-- abarbeitet. Die Spalte braucht keinen Backfill, weil ihr Anfangswert
-- die Wahrheit sagt.
--
-- ---------------------------------------------------------------------
-- DER NACHHOLAUF IST KEIN BEFEHL
--
-- Der Nachtrag sah ihn „neben dem Nachtlauf, wie die Phase-1-Backfills"
-- vor, also als Handbefehl. Entscheidung Eugene vom 13.08.2026 gilt
-- weiter und ist staerker: KEIN BEFEHL AUF DEM SERVER. Eine Reparatur,
-- die ein Mensch anstossen muss, ist eine Verabredung — sie faellt
-- irgendwann aus, und ihr Ausfall sieht aus wie Ruhe.
--
-- Der Nachholauf ist deshalb kein zweiter Lauf, sondern eine OBERGRENZE
-- im normalen Nachtlauf: bestelldetailsAuffrischen() nimmt je Lauf
-- hoechstens BESTELLDETAIL_JE_LAUF Bestellungen, JUENGSTE ZUERST. Der
-- Altbestand arbeitet sich damit von selbst ab und der Verbrauch faellt
-- danach auf das rollierende Fenster zurueck. Dass die neuesten zuerst
-- kommen, ist dieselbe Entscheidung wie beim Bestell-Backfill am
-- 02.08.2026: aktuelle Preise vor der Historie.
--
-- ---------------------------------------------------------------------
-- DIE RECHNUNG (src/config.ts: FN_TAGESBUDGET 140.000, verbraucht ~200)
--
-- Gemessen am 13.08.2026, „nicht final" = Status weder canceled noch
-- finished:
--
--   rollierendes Fenster, 45 Tage      2.981 Bestellungen →  5.962 Aufrufe
--   Nachholtiefe 12 Monate            21.737 Bestellungen → 43.474 Aufrufe
--   (ganzer nicht-finaler Bestand     63.616 Bestellungen → 127.232 — die
--    verworfene Alternative aus Entscheidung 5)
--
-- Je Bestellung zwei Aufrufe: fn:bestellung und fn:bestellpositionen.
--
--   Aufholphase, 2 Naechte    je 11.000 Bestellungen = 22.000 Aufrufe
--                             = 15,7 % des Tagesbudgets
--   Dauerbetrieb danach        2.981 Bestellungen     =  5.962 Aufrufe
--                             = 4,3 % des Tagesbudgets
--
-- Zeitbedarf der Aufholphase bei gemessenem Takt 200–500 ms: rund zwei
-- Stunden je Nacht. Das Fenster ist 0–24 Uhr, MAX_POSTEN_PRO_LAUF ist 0
-- (unbegrenzt) — es passt hinein.
--
-- LINAs Budget ist nicht betroffen: das sind seit dem 02.08.2026 zwei
-- getrennte Zaehler fuer zwei Firmen mit zwei Vertraegen.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Wann wurde der Kopf zuletzt im Detail geholt?
-- ---------------------------------------------------------------------

ALTER TABLE core.bestellung
    ADD COLUMN IF NOT EXISTS detail_geholt_am timestamptz;

COMMENT ON COLUMN core.bestellung.detail_geholt_am IS
'Wann der BestellKOPF zuletzt ueber fn:bestellung geholt wurde — nicht wann die Zeile
entstanden ist (das ist geladen_am).

NULL heisst "seit Einfuehrung dieser Spalte am 13.08.2026 nicht geholt". Beim Anlegen gilt
das fuer alle 66.966 Bestellungen, und das ist die Wahrheit und kein fehlender Backfill: bis
dahin wurde JEDE Bestellung genau einmal im Detail geholt und keine einzige je erneut
(gemessen: 66.966 Aufgaben, 66.966 verschiedene orderId, 0 mehrfach). Die NULL-Zeilen SIND
der eingefrorene Altbestand.

Woran das haengt: Liefermenge (adjustedQuantity), Lieferdatum, Belegnummer und alle
Preisstaende kommen aus dem Detail. Der Listen-Upsert frischt nur den Status auf, und auch
das nur, solange die Bestellung auf der letzten Seite ihrer Kostenstelle steht.';

/**
 * Der Zugriffspfad von bestelldetailsAuffrischen(): nicht-finale Bestellungen,
 * juengste zuerst. Partiell auf die nicht-finalen — canceled und finished sind
 * 3.362 von 66.966, und um die geht es nie.
 */
CREATE INDEX IF NOT EXISTS bestellung_detail_faellig
    ON core.bestellung (bestellt_am DESC)
 WHERE coalesce(status, '') NOT IN ('canceled', 'finished');


-- ---------------------------------------------------------------------
-- 2. mart.bestelldetail_stand — wie weit ist das Auffrischen?
--
-- Ohne diese Sicht saehe ein stiller Ausfall des neuen Einreihens
-- genauso aus wie "nichts zu tun" (AGENTS.md Regel 10). Der Unterschied
-- muss in der Datenbank stehen.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bestelldetail_stand AS
WITH grundlage AS (
  SELECT m.schluessel                                  AS marke,
         b.bestellt_am,
         b.detail_geholt_am,
         (b.bestellt_am > now() - interval '45 days')   AS im_fenster
    FROM core.bestellung b
    JOIN core.kostenstelle ks USING (kostenstelle_key)
    JOIN core.marke m USING (marke_key)
   WHERE coalesce(b.status, '') NOT IN ('canceled', 'finished')
     AND b.bestellt_am > now() - interval '12 months'
)
SELECT marke,
       count(*)                                                        AS nicht_final,
       count(*) FILTER (WHERE im_fenster)                              AS im_fenster,
       count(*) FILTER (WHERE detail_geholt_am IS NULL)                AS nie_aufgefrischt,
       count(*) FILTER (WHERE im_fenster
                          AND (detail_geholt_am IS NULL
                            OR detail_geholt_am < now() - interval '48 hours'))
                                                                       AS fenster_veraltet,
       min(detail_geholt_am)                                           AS aeltester_stand,
       max(detail_geholt_am)                                           AS juengster_stand
  FROM grundlage
 GROUP BY marke
 ORDER BY marke;

COMMENT ON VIEW mart.bestelldetail_stand IS
'Wie frisch sind die Bestelldetails? Eine Zeile je Marke, ueber den nicht-finalen Bestand
der letzten zwoelf Monate (die Nachholtiefe aus Entscheidung 5).

  nicht_final       Bestellungen, deren Status weder canceled noch finished ist.
  im_fenster        davon aus den letzten 45 Tagen — die, die JEDE Nacht drankommen.
  nie_aufgefrischt  detail_geholt_am IS NULL: seit dem 13.08.2026 nicht im Detail
                    geholt. Diese Zahl ist der Rest des Nachholaufs und MUSS fallen.
                    Bleibt sie zwei Naechte gleich, reiht das Auffrischen nicht mehr ein.
  fenster_veraltet  im Fenster und trotzdem aelter als 48 h. ERWARTUNG: 0 nach jedem
                    Nachtlauf. Genau diese Zahl zaehlt mart.pruefung_uebersicht.

WARUM ES DIESE SICHT GIBT: bis zum 13.08.2026 wurde jede der 66.966 Bestellungen genau
einmal im Detail geholt und keine je erneut. Liefermengen und Preisstaende standen damit auf
dem Stand des ersten Abrufs, und in den Einkaufssichten standen Bestellmengen, wo
Liefermengen stehen sollten. Nichts daran hat sich gemeldet — der Lauf meldete jede Nacht ok.

nie_aufgefrischt faellt in der Aufholphase um bis zu BESTELLDETAIL_JE_LAUF je Nacht und
bleibt danach auf dem Rest, der aelter als das Fenster ist. Das ist kein Rueckstand, sondern
die Grenze aus Entscheidung 5: zwoelf Monate zurueck, nicht der ganze Bestand.';


-- ---------------------------------------------------------------------
-- 3. Die Pruefzeile
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
-- Betriebe ohne Belegarchiv sind hier AUSGEKLAMMERT (0071). Sie bekommen nie
-- eine Zaehlzeile und stuenden sonst fuer immer in dieser Zahl.
SELECT 'Belegarchiv: seit ueber 36 h nicht gezaehlt',
       count(*) FILTER (WHERE zustand <> 'kein belegarchiv'),
       count(*) FILTER (WHERE zustand <> 'kein belegarchiv'
                          AND (zuletzt_gezaehlt IS NULL
                            OR zuletzt_gezaehlt < now() - interval '36 hours')),
       'mart.belegarchiv_zulauf'
  FROM mart.belegarchiv_zulauf
UNION ALL
-- ERWARTUNG: KONSTANT, nicht null (0071).
SELECT 'Belegarchiv: Betrieb ohne Belegarchiv',
       count(*), count(*) FILTER (WHERE zustand = 'kein belegarchiv'),
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
/*
 * NEU MIT 0072. Ohne diese Zeile saehe ein stiller Ausfall des Auffrischens
 * wieder genauso aus wie "nichts zu tun" — und das ist der Fehler, der
 * diesem Projekt zweimal Tage gekostet hat.
 *
 * Gezaehlt wird NUR das rollierende Fenster (45 Tage). Der Altbestand
 * dahinter arbeitet sich ueber mehrere Naechte ab und stuende hier sonst
 * zwei Naechte lang mit fuenfstelligen Zahlen — eine Kachel, die beim
 * Einschalten rot ist, sieht sich niemand mehr an. Wie weit der Nachholauf
 * ist, steht in mart.bestelldetail_stand.nie_aufgefrischt.
 */
-- Auf bigint geholt: die uebrigen Zweige liefern count(*), und sum(bigint)
-- ist numeric. CREATE OR REPLACE VIEW kann den Spaltentyp einer bestehenden
-- Sicht nicht aendern — ohne den Cast scheitert die Migration, statt still
-- eine andere Sicht zu bauen.
SELECT 'Bestellung: Details im Fenster aelter als 48 h',
       coalesce(sum(im_fenster), 0)::bigint,
       coalesce(sum(fenster_veraltet), 0)::bigint,
       'mart.bestelldetail_stand'
  FROM mart.bestelldetail_stand
UNION ALL
-- Getrennt gezaehlt: "wird noch versucht" ist Betrieb, "endgueltig" ist ein Befund.
SELECT 'Warteschlange: endgueltig aufgegeben',
       count(*), count(*) FILTER (WHERE zustand = 'endgueltig'),
       'mart.posten_aufgegeben'
  FROM mart.posten_aufgegeben;

COMMENT ON VIEW mart.pruefung_uebersicht IS
'Erste Abfrage nach jedem groesseren Backfill: SELECT * FROM mart.pruefung_uebersicht;
Die Spalte auffaellig ist eine Arbeitsliste, kein Alarm.

Am 13.08.2026 sind sechs Zulaufpruefungen dazugekommen, alle aus demselben Anlass: eine
Quelle ohne Zulauf ist ein Fehler und kein Normalzustand, und der Lauf hat sie zweimal als
"ok" gemeldet (AGENTS.md Regel 10). Was sie beim Anlegen zeigten:

  Belegarchiv: Ordner ohne den faelligen Abzug       0 von 1.974
  Belegarchiv: seit ueber 36 h nicht gezaehlt        0 von 1.974 (nach dem fertigen Lauf 89)
  Belegarchiv: Betrieb ohne Belegarchiv              0 von 1.974 — alle 141 Betriebe haben
                                                     eines; die Zeile ist vorbeugend
  Inventur: Zaehlung abgeschnitten                   0 von 358 (vor 0069: 9)
  Bestellung: Kopf ohne eine einzige Position       47 von 66.966 (vor 0070: 322)
  Bestellung: Details im Fenster aelter als 48 h  2.981 von 2.981 — beim Anlegen ist das
                                                     der GANZE Bestand des Fensters, weil
                                                     bis dahin keine Bestellung je erneut
                                                     geholt wurde. Nach dem ersten Lauf mit
                                                     0072 muss die Zahl 0 sein
  Warteschlange: endgueltig aufgegeben               0 von 0 (vor 0070: 275 aufgegeben)

ZWEI ZEILEN LESEN SICH ANDERS ALS DIE UEBRIGEN.

"Betrieb ohne Belegarchiv" erwartet KONSTANZ, nicht null. Die Zahl ist eine Eigenschaft des
Bestands, kein Rueckstand; interessant ist allein, wenn sie sich aendert.

"Warteschlange: endgueltig aufgegeben" zaehlt AUSDRUECKLICH nur die endgueltigen. Ein
aufgegebener Posten, den der Lauf noch dreimal zurueckholt, ist Betrieb und kein Befund — wer
beides in eine Zahl wirft, bekommt eine Kachel, die immer rot ist und die deshalb niemand
mehr ansieht.

Die Zeile "Wareneinsatz: Abdeckung unter 90 %" ist am 01.08.2026 entfallen (Migration 0029).
Sie hat nie ausgeloest, weil ihr Filter auf IS NOT NULL prueft und fixer_we nie NULL ist,
sondern 0. Ein Waechter, der immer gruen zeigt, ist schlimmer als keiner.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0072', to_jsonb(
        'core.bestellung.detail_geholt_am, mart.bestelldetail_stand und eine '
        'Pruefzeile. Anlass: alle 66.966 Bestellungen wurden GENAU EINMAL im '
        'Detail geholt, keine einzige je erneut — Liefermengen, Lieferdatum und '
        'Preisstaende standen auf dem Stand des ersten Abrufs, und in den '
        'Einkaufssichten standen Bestellmengen statt Liefermengen. Der Nachholauf '
        'ist kein Befehl, sondern eine Obergrenze im Nachtlauf: juengste zuerst, '
        'hoechstens BESTELLDETAIL_JE_LAUF je Lauf, danach faellt der Verbrauch '
        'auf das rollierende 45-Tage-Fenster zurueck.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
