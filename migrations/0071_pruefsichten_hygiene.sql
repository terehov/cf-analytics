-- =====================================================================
-- 0071 Drei Unehrlichkeiten der Pruefsichten
--
-- ANLASS. Ein unabhaengiges Review der Phase-1-Implementierung am
-- 13.08.2026 (docs/plan-datenvollstaendigkeit-nachtrag.md, Punkt N3).
-- Die Mechanik aus 0069/0070 wirkt — 0 abgeschnittene Inventuren, 0
-- endgueltig aufgegebene Posten, das Belegarchiv bekommt wieder Zulauf.
-- Ihre Anzeige sagt aber an drei Stellen etwas anderes, als sie meint,
-- und alle drei fuehren zum selben Ergebnis: eine Kachel, die dauerhaft
-- rot steht, sieht sich niemand mehr an. Das ist derselbe Verlust wie
-- eine, die dauerhaft gruen steht — nur langsamer.
--
-- ---------------------------------------------------------------------
-- 1. "SEIT UEBER 36 H NICHT GEZAEHLT" ZAEHLT BETRIEBE MIT, DIE GAR KEIN
--    BELEGARCHIV HABEN
--
-- Die Ladenakte kennt Betriebe ohne einen einzigen Belegordner. Fuer sie
-- wirft belegToken() ein KeinBelegarchiv, der Client macht daraus
-- 'keine_daten' — gefragt, nichts da, kein Retry (src/ladenakte/token.ts).
-- Genau richtig. Nur: sie bekommen damit NIE eine Zeile in
-- core.belegarchiv_bestand, stehen also fuer immer auf "nie gezaehlt" und
-- damit fuer immer in der 36-h-Zeile.
--
-- Am 13.08.2026 waehrend Lauf 89 gemessen: 1.645 von 1.974 Paaren
-- gezaehlt, ausnahmslos Status 'ok', kein einziges 'keine_daten'. Die
-- ausstehenden 329 Paare gehoeren aber zu den 23 noch nicht gezaehlten
-- Betrieben — und darunter sind genau die, die die Vollzaehlung vom
-- 11.08.2026 nicht kannte: drei geschlossene, sechs ohne Geschaeft, einer
-- Test, alle mit null Belegen. Diese Migration kommt der Messung also
-- absichtlich zuvor; die Zeile entsteht, bevor sie zum ersten Mal rot
-- wird, nicht danach.
--
-- Die Paare bekommen einen eigenen Zustand und eine eigene Zeile in der
-- Pruefuebersicht. Erwartung dort ist NICHT null, sondern KONSTANT.
--
-- WARUM DIE AUSKLAMMERUNG EIN ZEITFENSTER HAT (7 Tage). Sie stuetzt sich
-- auf einen Befund, und ein Befund veraltet. Ohne Fenster wuerde ein
-- einziges 'keine_daten' aus dem Maerz einen Betrieb fuer immer aus der
-- Ueberwachung nehmen — und falls die Zaehlung insgesamt ausfaellt, waere
-- ausgerechnet die Zeile still, die den Ausfall melden soll. Mit Fenster
-- altert die Ausnahme aus, und der Betrieb faellt zurueck in die 36-h-
-- Zeile. Die Ausnahme darf ihren Beleg nicht ueberleben.
--
-- ---------------------------------------------------------------------
-- 2. DAS WIEDERBELEBUNGS-LIMIT STEHT AN ZWEI STELLEN UND KANN AUSEINANDER
--    LAUFEN
--
-- mart.posten_aufgegeben verdrahtet wiederbelebt >= 3, src/status.ts und
-- src/sync/nachfuellen.ts lesen MAX_WIEDERBELEBUNGEN aus der Umgebung
-- (Vorgabe 3). Wer die Umgebungsvariable auf 5 setzt, bekommt eine Sicht,
-- die zwei Posten als "endgueltig" fuehrt, die der Lauf noch zweimal
-- zurueckholt — und einen Statusbericht, der etwas anderes sagt als das
-- Dashboard.
--
-- Eine Sicht kann keine Umgebungsvariable lesen. Die saubere Loesung
-- waere eine Einstellungstabelle; das ist mehr Bau, als das Problem
-- verdient. Stattdessen wird die 3 an BEIDEN Stellen festgenagelt: hier
-- im Sichtkommentar mit Verweis auf config.ts, dort mit Verweis hierher,
-- und ein Test prueft den config-Vorgabewert gegen 3
-- (src/config.test.ts). Wer den Wert aendert, findet ueber den roten Test
-- diese Sicht. Das ist keine Kopplung, aber eine Leine.
--
-- ---------------------------------------------------------------------
-- 3. "ABZUG FEHLT" HIESS NICHT, WAS ES SAGT
--
-- Bis heute konnte ein Abzug fehlerfrei laufen und trotzdem nichts
-- aendern: belegeSchreiben() war ein reiner Upsert, ein in LINA
-- geloeschter Beleg blieb bei uns stehen. Damit galt dauerhaft
-- gehalten > gezaehlt, und der Lauf holte den vollen Ordner jede Nacht
-- neu — der Zustand pendelte zwischen "abzug eingereiht" und "abzug
-- fehlt", ohne dass je etwas konvergierte. Der Abzug fehlte nicht, er war
-- wirkungslos.
--
-- Mit N2 (verschwundeneEntfernen() in src/ladenakte/laden.ts, im selben
-- Deploy) loescht der Abzug jetzt, was LINA nicht mehr fuehrt. "abzug
-- fehlt" heisst damit wieder, was es sagt: es wurde eine Abweichung
-- gemessen und es steht kein Posten dafuer. Der Kommentar sagt das jetzt
-- auch.
--
-- ---------------------------------------------------------------------
-- KEIN AUFRUFBUDGET BETROFFEN. Diese Migration aendert drei Sichten und
-- legt einen Index an. Sie holt nichts, sie reiht nichts ein.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Der Zugriffspfad fuer "war die letzte Zaehlung keine_daten?"
--
-- sync.aufgabe waechst seit 0069 um 1.834 Zeilen am Tag. Der vorhandene
-- Index (endpunkt, betrieb_enc_id, beendet_am DESC) aus 0005 traegt die
-- Frage nicht: betrieb_enc_id ist bei allen la:-Zeilen NULL, der Betrieb
-- steckt im parameter-JSON. Partiell auf den einen Endpunkt, weil das
-- die einzige Frage ist, die diesen Pfad braucht.
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS aufgabe_belegzahl_betrieb
    ON sync.aufgabe ((parameter->>'linaBetriebId'), beendet_am DESC)
 WHERE endpunkt = 'la:belegzahl';


-- ---------------------------------------------------------------------
-- 2. mart.belegarchiv_zulauf — ein Zustand mehr, und er heisst, was er ist
--
-- Neu gegenueber 0069: die Spalte zaehlung_status (was die juengste
-- Zaehlung dieses Betriebs ergeben hat) und der Zustand
-- "kein belegarchiv".
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.belegarchiv_zulauf AS
WITH zaehlung AS (
  SELECT DISTINCT ON (betrieb_key, typ_id)
         betrieb_key, typ_id, records_total, gemessen_am
    FROM core.belegarchiv_bestand
   WHERE quelle = 'zaehlung'
   ORDER BY betrieb_key, typ_id, gemessen_am DESC
), abzug AS (
  SELECT DISTINCT ON (betrieb_key, typ_id)
         betrieb_key, typ_id, records_total, gemessen_am
    FROM core.belegarchiv_bestand
   WHERE quelle = 'abzug'
   ORDER BY betrieb_key, typ_id, gemessen_am DESC
), gehalten AS (
  SELECT betrieb_key, typ_id, count(*) AS ist,
         max(hochgeladen_am) AS letzter_beleg
    FROM core.buchungsbeleg
   GROUP BY betrieb_key, typ_id
), letzte_zaehlung AS (
  -- Je Betrieb der Ausgang der JUENGSTEN Zaehlung, und nur aus den letzten
  -- sieben Tagen. Je BETRIEB und nicht je Paar, weil KeinBelegarchiv eine
  -- Aussage ueber den Betrieb ist: fehlt der Baumknoten, fehlen alle
  -- vierzehn Ordner auf einmal.
  SELECT DISTINCT ON (a.parameter->>'linaBetriebId')
         (a.parameter->>'linaBetriebId')::int AS lina_betrieb_id,
         a.status,
         a.beendet_am
    FROM sync.aufgabe a
   WHERE a.endpunkt = 'la:belegzahl'
     AND a.beendet_am IS NOT NULL
     AND a.beendet_am > now() - interval '7 days'
   ORDER BY a.parameter->>'linaBetriebId', a.beendet_am DESC
)
SELECT b.betrieb_key,
       b.lina_betrieb_id,
       b.name                                    AS betrieb,
       stt.status                                AS betrieb_status,
       (stt.status = 'operativ')                 AS operativ,
       a.typ_id,
       a.name                                    AS ordner,
       a.inhalt_holen,
       z.records_total                           AS gezaehlt,
       z.gemessen_am                             AS zuletzt_gezaehlt,
       -- Auf integer geholt: count(*) ist bigint, und bigint kommt bei
       -- node-postgres als ZEICHENKETTE an (Genauigkeitsverlust in JS waere
       -- die Alternative). Eine Ordnergroesse passt millionenfach in int.
       g_.ist::int                               AS gehalten,
       v.gemessen_am                             AS zuletzt_abgezogen,
       g_.letzter_beleg,
       (coalesce(z.records_total, 0) - coalesce(g_.ist, 0))::int AS differenz,
       CASE
         -- ZUERST, aber eng gefasst: nur wo wir auch nichts halten und nie
         -- etwas gezaehlt haben. Ein Betrieb, der sein Belegarchiv VERLIERT,
         -- soll nicht als Normalzustand durchgehen — der faellt weiter unten
         -- auf "abzug fehlt" und gehoert angesehen.
         WHEN lz.status = 'keine_daten'
              AND z.gemessen_am IS NULL
              AND coalesce(g_.ist, 0) = 0
           THEN 'kein belegarchiv'
         WHEN z.gemessen_am IS NULL
           THEN 'nie gezaehlt'
         WHEN coalesce(z.records_total, 0) = coalesce(g_.ist, 0)
           THEN 'vollstaendig'
         WHEN NOT a.inhalt_holen
           THEN 'gezaehlt, nicht freigegeben'
         WHEN EXISTS (SELECT 1 FROM sync.warteschlange w
                       WHERE w.endpunkt = 'la:belegliste'
                         AND w.erledigt_am IS NULL
                         AND w.parameter->>'linaBetriebId' = b.lina_betrieb_id::text
                         AND w.parameter->>'typeId' = a.typ_id)
           THEN 'abzug eingereiht'
         ELSE 'abzug fehlt'
       END                                       AS zustand,
       lz.status                                 AS zaehlung_status
  FROM core.betrieb b
  CROSS JOIN core.belegart a
  LEFT JOIN mart.betrieb_status stt ON stt.betrieb_key = b.betrieb_key
  LEFT JOIN zaehlung z ON z.betrieb_key = b.betrieb_key AND z.typ_id = a.typ_id
  LEFT JOIN abzug    v ON v.betrieb_key = b.betrieb_key AND v.typ_id = a.typ_id
  LEFT JOIN gehalten g_ ON g_.betrieb_key = b.betrieb_key AND g_.typ_id = a.typ_id
  LEFT JOIN letzte_zaehlung lz ON lz.lina_betrieb_id = b.lina_betrieb_id
 WHERE b.lina_betrieb_id IS NOT NULL
   AND a.zweig = 'fibu';

COMMENT ON VIEW mart.belegarchiv_zulauf IS
'Bekommt das Belegarchiv noch Zulauf? Eine Zeile je Betrieb und Ordner, 1.974
insgesamt. Die Arbeitsliste steht in zustand:

  vollstaendig                 LINAs Zaehlung und unser Bestand stimmen ueberein.
  abzug eingereiht             Abweichung erkannt, der Abzug steht in der Schlange.
  abzug fehlt                  Abweichung erkannt, aber kein offener Posten. Das ist
                               der Befund, auf den man sehen will — er heisst, dass
                               das Nachreihen nicht greift.
  gezaehlt, nicht freigegeben  Dort liegen Belege, aber core.belegart.inhalt_holen
                               ist false. Betrifft die sechs nie geholten Belegarten
                               und ist die Entscheidungsgrundlage fuer Punkt 3 in
                               docs/plan-datenvollstaendigkeit.md Abschnitt 4.
  kein belegarchiv             Die juengste Zaehlung dieses Betriebs endete mit
                               keine_daten: die Ladenakte fuehrt fuer ihn keinen
                               einzigen Ordner (KeinBelegarchiv in
                               src/ladenakte/token.ts). Kein Fehler, aber auch kein
                               Zulauf — und deshalb aus der 36-h-Zeile der
                               Pruefuebersicht ausgeklammert, statt dort fuer immer
                               rot zu stehen. Nur wo wir auch nichts halten: ein
                               Betrieb, der sein Belegarchiv VERLIERT, steht
                               weiterhin auf "abzug fehlt".
  nie gezaehlt                 Noch keine Zaehlung. Vor dem ersten Lauf mit
                               la:belegzahl gilt das fuer alle Zeilen.

zaehlung_status ist der Ausgang der juengsten la:belegzahl-Aufgabe dieses Betriebs
aus den letzten SIEBEN TAGEN — je Betrieb, nicht je Ordner, weil das fehlende
Belegarchiv eine Eigenschaft des Betriebs ist. Das Fenster ist Absicht: die
Ausklammerung stuetzt sich auf einen Befund, und ein Befund veraltet. Faellt die
Zaehlung ganz aus, altert er heraus und der Betrieb steht wieder in der 36-h-Zeile
— sonst waere ausgerechnet die Zeile still, die den Ausfall melden soll.

WARUM ES DIESE SICHT GIBT: zwischen dem 12. und dem 13.08.2026 stand das Belegarchiv
still, waehrend der Lauf 269 von 269 Aufgaben als ok meldete. Ein Log-WARN haette das
nicht geaendert, weil niemand Logs liest. differenz und zustand stehen deshalb in der
Datenbank, wo auch die Zahlen stehen.

differenz rechnet Zaehlstand minus Bestand. NEGATIV heisst, wir halten mehr als LINA
zaehlt. Seit dem 13.08.2026 ist das ein voruebergehender Zustand und kein Dauerbefund:
der Abzug loescht seither Belege, die LINA nicht mehr fuehrt
(verschwundeneEntfernen() in src/ladenakte/laden.ts). Vorher konnte er das nicht — er
war ein reiner Upsert, und ein einziger in LINA geloeschter Beleg liess den vollen
Ordner jede Nacht neu holen, ohne dass sich je etwas aenderte.';


-- ---------------------------------------------------------------------
-- 3. mart.posten_aufgegeben — dieselbe Logik, ein ehrlicher Kommentar
--
-- Die Sicht bleibt unveraendert. Was sich aendert, ist die Leine zur
-- Umgebungsvariable: der Kommentar nennt sie beim Namen, und
-- src/config.test.ts haelt den Vorgabewert auf 3 fest.
-- ---------------------------------------------------------------------

COMMENT ON VIEW mart.posten_aufgegeben IS
'Posten, die der Worker aufgegeben hat. ERWARTUNG: leer, oder nur Zeilen mit
zustand = endgueltig und einer Begruendung, die jemand gelesen hat.

  wird erneut versucht  der naechtliche Lauf holt ihn zurueck, solange
                        quelle_antwortet true ist. Hoechstens dreimal.
  endgueltig            der Vorrat ist aufgebraucht. Das ist die Aussage
                        "diese Daten sind aus der Quelle nicht zu bekommen",
                        und sie gehoert geprueft, nicht ignoriert.

DIE 3 STEHT HIER FEST VERDRAHTET UND MUSS ZU config.MAX_WIEDERBELEBUNGEN PASSEN.
Eine Sicht kann keine Umgebungsvariable lesen; eine Einstellungstabelle waere mehr
Bau, als das Problem verdient. Wer MAX_WIEDERBELEBUNGEN aendert, aendert damit still
die Bedeutung dieser Spalte — und die von src/status.ts, das die Umgebung liest.
Deshalb haelt src/config.test.ts den Vorgabewert auf 3 fest: der rote Test fuehrt zu
dieser Zeile. Geaendert wird also beides oder keines.

Am 13.08.2026 standen hier 275 Zeilen, ausnahmslos fn:bestellpositionen mit HTTP 500
aus dem Backfill vom 02. bis 04.08.2026 — und mit ihnen 322 Bestellungen ueber
686.535,93 EUR, die einen Kopf hatten und keine einzige Position. Nach dem ersten Lauf
mit der Wiederbelebung (0070) waren es 0 von 66.966; die Bestellungen ohne Position
sind auf 47 gefallen.

wiederbelebt ist NICHT versuche: versuche zaehlt die Anlaeufe innerhalb eines Lebens
und faengt nach dem Wiederbeleben bei 0 an, wiederbelebt zaehlt die Leben.';


-- ---------------------------------------------------------------------
-- 4. mart.pruefung_uebersicht — die 36-h-Zeile klammert aus, was kein
--    Belegarchiv hat, und fuehrt es als eigene Zeile
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
-- Betriebe ohne Belegarchiv sind hier AUSGEKLAMMERT. Sie bekommen nie eine
-- Zaehlzeile und stuenden sonst fuer immer in dieser Zahl — eine Kachel, die
-- nie auf null geht, wird nicht gelesen, und dann ist auch der echte Ausfall
-- unsichtbar. Sie stehen stattdessen in der Zeile darunter.
SELECT 'Belegarchiv: seit ueber 36 h nicht gezaehlt',
       count(*) FILTER (WHERE zustand <> 'kein belegarchiv'),
       count(*) FILTER (WHERE zustand <> 'kein belegarchiv'
                          AND (zuletzt_gezaehlt IS NULL
                            OR zuletzt_gezaehlt < now() - interval '36 hours')),
       'mart.belegarchiv_zulauf'
  FROM mart.belegarchiv_zulauf
UNION ALL
-- ERWARTUNG: KONSTANT, nicht null. Jede Aenderung ist ein Befund — nach oben
-- heisst, ein Betrieb hat sein Belegarchiv verloren oder ein neuer ist ohne
-- eines angelegt worden; nach unten heisst, einer hat eines bekommen und wird
-- ab jetzt gezaehlt. Ohne diese Zeile waere "kein Belegarchiv" ein stiller
-- Zweig, der nichts zu tun bedeutet (AGENTS.md Regel 10).
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
-- Getrennt gezaehlt: "wird noch versucht" ist Betrieb, "endgueltig" ist ein Befund.
SELECT 'Warteschlange: endgueltig aufgegeben',
       count(*), count(*) FILTER (WHERE zustand = 'endgueltig'),
       'mart.posten_aufgegeben'
  FROM mart.posten_aufgegeben;

COMMENT ON VIEW mart.pruefung_uebersicht IS
'Erste Abfrage nach jedem groesseren Backfill: SELECT * FROM mart.pruefung_uebersicht;
Die Spalte auffaellig ist eine Arbeitsliste, kein Alarm.

Am 13.08.2026 sind fuenf Zulaufpruefungen dazugekommen, alle aus demselben Anlass: eine
Quelle ohne Zulauf ist ein Fehler und kein Normalzustand, und der Lauf hat sie zweimal
als "ok" gemeldet (AGENTS.md Regel 10). Was sie beim Anlegen zeigten:

  Belegarchiv: Ordner ohne den faelligen Abzug       0 von 1.974
  Belegarchiv: seit ueber 36 h nicht gezaehlt      329 von 1.974 (mitten in Lauf 89 —
                                                   genau die noch nicht gezaehlten)
  Belegarchiv: Betrieb ohne Belegarchiv              0 von 1.974 (Lauf 89 hatte die
                                                   fraglichen 23 Betriebe noch nicht
                                                   erreicht; erwartet werden bis zu
                                                   zehn Betriebe, also 140 Paare)
  Inventur: Zaehlung abgeschnitten                   0 von 358 (vor 0069: 9, mit 936
                                                   fehlenden Positionen)
  Bestellung: Kopf ohne eine einzige Position       47 von 66.966 (vor 0070: 322)
  Warteschlange: endgueltig aufgegeben               0 von 0 (vor 0070: 275 aufgegeben)

ZWEI ZEILEN LESEN SICH ANDERS ALS DIE UEBRIGEN.

"Betrieb ohne Belegarchiv" erwartet KONSTANZ, nicht null. Die Zahl ist eine
Eigenschaft des Bestands, kein Rueckstand; interessant ist allein, wenn sie sich
aendert.

"Warteschlange: endgueltig aufgegeben" zaehlt AUSDRUECKLICH nur die endgueltigen. Ein
aufgegebener Posten, den der Lauf noch dreimal zurueckholt, ist Betrieb und kein
Befund — wer beides in eine Zahl wirft, bekommt eine Kachel, die immer rot ist und die
deshalb niemand mehr ansieht.

Die Zeile "Wareneinsatz: Abdeckung unter 90 %" ist am 01.08.2026 entfallen (Migration
0029). Sie hat nie ausgeloest, weil ihr Filter auf IS NOT NULL prueft und fixer_we nie
NULL ist, sondern 0. Ein Waechter, der immer gruen zeigt, ist schlimmer als keiner.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0071', to_jsonb(
        'Pruefsichten-Hygiene nach dem Review vom 13.08.2026. Die 36-h-Zeile '
        'klammert Betriebe aus, deren Ladenakte gar kein Belegarchiv fuehrt '
        '(zustand "kein belegarchiv", eigene Zeile mit Erwartung KONSTANT); '
        'mart.belegarchiv_zulauf bekommt dafuer zaehlung_status und einen Index '
        'auf sync.aufgabe. Der Kommentar von mart.posten_aufgegeben nennt jetzt '
        'MAX_WIEDERBELEBUNGEN, und src/config.test.ts haelt den Vorgabewert 3 '
        'fest. Dazu der geschaerfte Hinweis, dass "abzug fehlt" seit N2 wieder '
        'heisst, was es sagt.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
