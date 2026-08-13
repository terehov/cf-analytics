-- =====================================================================
-- 0075 — Die Anzeige sagt, was sie meint (Plan Phase 3)
--
-- DREI SPALTEN, DIE ALLE DREI IN DIESELBE FALLE LIEFEN: sie messen einen
-- MOMENTANEN Warteschlangenzustand und behaupten damit eine Aussage ueber
-- die DATEN.
--
--   mart.einkauf_ladestand.liste_vollstaendig  zaehlt offene fn:bestellungen
--                                              je Marke, egal wie alt
--   sync.fortschritt.pausiert_bis              hat keinen Schreiber
--   sync.warteschlange (403-Zweig)             zaehlt hoch und wieder runter
--
-- NACHGEMESSEN AM 14.08.2026, 00:16 UHR, WAEHREND LAUF 90 LIEF:
-- **alle 251** Monatszeilen von mart.einkauf_ladestand standen auf
-- "… laedt" — nicht die 60 Enchilada-Zeilen, die der Plan erwartet hatte,
-- sondern jede einzelne Zeile jeder Marke.
--
-- Das ist kein groesserer Schaden, sondern ein anderer Befund. Der Plan
-- hatte an einem Moment OHNE laufenden Lauf gemessen und den einen
-- haengenden Posten 28629 gesehen. Der Normalfall ist ein anderer: der
-- naechtliche Lauf reiht je Kostenstelle die letzte Bestellseite ein, und
-- solange die abgearbeitet wird, ist "offene Seite" der Regelzustand.
--
--   Marke               Monatszeilen   davon "… laedt"
--   Aposto                        60                60
--   Deutsche Konzepte             56                56
--   Enchilada                     60                60
--   Wilma Wunder                  75                75
--
-- Eine Spalte, die in jeder Nacht bei allen vier Marken ausschlaegt, ist
-- keine Warnung mehr. Sie ist Hintergrundrauschen — und das gilt genauso
-- fuer eine Kachel, die nie ausschlaegt (0071).
--
-- DIE UNTERSCHEIDUNG, DIE GEFEHLT HAT, IST NICHT "offen ODER NICHT",
-- SONDERN "HAT EIN GANZER LAUF SIE NICHT WEGGEARBEITET".
-- Eine Seite, die waehrend des laufenden Laufs entstanden ist, ist Arbeit.
-- Eine Seite, die einen VOLLSTAENDIGEN Lauf ueberlebt hat, ist Rueckstand.
-- Der Unterschied steht in erstellt_am gegen den Beginn des letzten
-- beendeten Laufs — ein Fakt an der Sache, kein Zustand an der Schlange.
-- Dieselbe Lehre wie bei detail_geholt_am (0072) und der Zaehlung (0069).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Ein 403 ist kein Fehler und kein Erfolg — er ist eine dritte Sache
--
-- Der 403-Zweig in src/sync/worker.ts vertagt den Posten um 24 Stunden
-- und nimmt ihm dabei einen Versuch ab (`versuche - 1`). sync.posten_holen
-- zaehlt vorher hoch, der Zweig zaehlt wieder herunter: netto null.
--
-- Das ist bewusst so gebaut und fuer den gedachten Fall auch richtig — ein
-- fehlender Anspruch kann nachgetragen werden, und ein Aufruf am Tag
-- kostet nichts. Nur endet er nie. Posten 28629 (Enchilada, erpId 11805,
-- "Layer-Chemie Testbetrieb") liegt seit dem 02.08.2026 in dieser Schleife
-- und hatte am 14.08.2026 immer noch versuche = 0.
--
-- gesperrt_seit ist der Fakt, der gefehlt hat: seit wann sagt die Quelle
-- nein. Aus ihm folgt die Obergrenze, ohne dass der Versuchszaehler
-- missbraucht werden muss.
-- ---------------------------------------------------------------------

ALTER TABLE sync.warteschlange
    ADD COLUMN IF NOT EXISTS gesperrt_seit timestamptz;

COMMENT ON COLUMN sync.warteschlange.gesperrt_seit IS
'Seit wann die Quelle diesen Posten mit 403 ablehnt. NULL heisst: sie tut es
nicht (mehr) — jeder Erfolg raeumt die Spalte. Nach SPERRE_AUFGEBEN_TAGE wird
der Posten mit ergebnis = kein_zugriff geschlossen. Ohne diese Spalte lief der
403-Zweig unbegrenzt: er nimmt einen Versuch zurueck, den posten_holen gerade
vergeben hat, und kommt damit nie am Aufgeben-Zweig vorbei.';

-- Der Zugriffspfad des Nachholaufs: welche Posten sind lange genug gesperrt.
CREATE INDEX IF NOT EXISTS warteschlange_gesperrt
    ON sync.warteschlange (gesperrt_seit)
 WHERE gesperrt_seit IS NOT NULL AND erledigt_am IS NULL;

/*
 * kein_zugriff als eigener Ausgang neben aufgegeben.
 *
 * WARUM NICHT EINFACH 'aufgegeben'. aufgegebeneWiederbeleben() holt jeden
 * aufgegebenen Posten bis zu MAX_WIEDERBELEBUNGEN mal zurueck, sobald der
 * Endpunkt irgendwo ein frisches 'ok' hat — und fn:bestellungen hat das
 * jede Nacht. Ein 403 auf einer fremden Kostenstelle wuerde damit dreimal
 * wiederbelebt, dreimal abgelehnt und dreimal aufgegeben, bis er
 * "endgueltig" heisst. Drei Wochen Rauschen fuer eine Antwort, die schon
 * am ersten Tag feststand.
 *
 * Der Unterschied ist inhaltlich und nicht kosmetisch: aufgegeben heisst
 * "wir haben es nicht geschafft", kein_zugriff heisst "es gehoert uns
 * nicht". Das erste ist ein Befund, das zweite eine Grenze.
 */
ALTER TABLE sync.warteschlange DROP CONSTRAINT IF EXISTS warteschlange_ergebnis_check;
ALTER TABLE sync.warteschlange
    ADD CONSTRAINT warteschlange_ergebnis_check
    CHECK (ergebnis IN ('ok','keine_daten','aufgegeben','kein_zugriff'));

COMMENT ON COLUMN sync.warteschlange.ergebnis IS
'keine_daten ist ein NORMALZUSTAND, kein Fehler: LINA antwortet mit HTTP 500 und
leerem Body, wenn ein Betrieb fuer diesen Bericht keine Daten hat. kein_zugriff
(seit 0075) ist ebenfalls ein Endzustand und ebenfalls kein Fehler: die Quelle
lehnt diese Ressource dauerhaft mit 403 ab. Er wird NICHT wiederbelebt.';


-- ---------------------------------------------------------------------
-- 2. Was uns nicht gehoert, steht jetzt da, statt zu blinken
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.posten_ohne_zugriff AS
SELECT w.posten_id,
       w.endpunkt,
       m.schluessel                AS marke,
       w.parameter,
       w.parameter->>'erpId'       AS erp_id,
       k.name                      AS kostenstelle,
       k.betrieb_key IS NOT NULL   AS eigener_betrieb,
       w.gesperrt_seit,
       w.erledigt_am               AS geschlossen_am,
       left(w.letzter_fehler, 200) AS fehler
  FROM sync.warteschlange w
  LEFT JOIN core.marke m ON m.marke_key = w.marke_key
  LEFT JOIN core.kostenstelle k
         ON k.marke_key = w.marke_key
        AND k.erp_id = nullif(w.parameter->>'erpId','')::int
 WHERE w.ergebnis = 'kein_zugriff'
 ORDER BY w.erledigt_am DESC;

COMMENT ON VIEW mart.posten_ohne_zugriff IS
'Posten, die die Quelle dauerhaft mit 403 ablehnt. ERWARTUNG: nur Zeilen mit
eigener_betrieb = false — dann ist der 403 richtig und die Sache erledigt.

Steht hier ein eigener Betrieb, ist es ein Rechteproblem und keine Grenze:
dann fehlen uns dessen Bestellungen, ohne dass irgendetwas rot wird.

Der Anlass ist Posten 28629 (Enchilada, erpId 11805, Layer-Chemie
Testbetrieb): eine Kostenstelle im Enchilada-Mandanten, die uns nicht
gehoert. Sie lag vom 02.08. bis zum 14.08.2026 in der Schlange und faerbte
dabei ueber liste_vollstaendig alle 60 Enchilada-Monatszeilen auf
unvollstaendig.';


-- ---------------------------------------------------------------------
-- 3. Der Ladestand: drei Zustaende statt einem Haekchen
--
-- Die vier bestehenden Spalten bleiben unveraendert stehen (CREATE OR
-- REPLACE erlaubt nur ANHAENGEN, und die Karten lesen sie). Neu sind die
-- vier dahinter — und die Bedeutung von liste_vollstaendig.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.einkauf_ladestand AS
WITH letzter_lauf AS (
    /*
     * Der Beginn des letzten VOLLSTAENDIG durchgelaufenen Laufs.
     *
     * Alles, was danach eingereiht wurde, ist Arbeit von heute Nacht.
     * Alles davor hat einen ganzen Lauf ueberlebt, ohne abgearbeitet zu
     * werden — das ist Rueckstand, und nur der ist eine Aussage.
     *
     * coalesce auf now(): hat noch nie ein Lauf sauber geendet, ist JEDE
     * offene Seite Rueckstand. Auf einer frischen Datenbank ist "… laedt"
     * die ehrliche Antwort.
     */
    SELECT coalesce(max(gestartet_am), now()) AS ab
      FROM sync.lauf
     WHERE beendet_am IS NOT NULL AND status IN ('ok','teilweise')
), seiten AS (
    SELECT w.marke_key,
           count(*) FILTER (WHERE w.erledigt_am IS NOT NULL
                              AND w.ergebnis <> 'kein_zugriff')       AS seiten_erledigt,
           count(*) FILTER (WHERE w.erledigt_am IS NULL)              AS seiten_offen,
           count(*) FILTER (WHERE w.erledigt_am IS NULL
                              AND w.erstellt_am < (SELECT ab FROM letzter_lauf))
                                                                      AS seiten_rueckstand,
           count(*) FILTER (WHERE w.ergebnis = 'kein_zugriff')        AS seiten_kein_zugriff
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
    /*
     * GEAENDERT MIT 0075. Vorher: "keine offene Seite". Das war an jedem
     * Abend nach dem Einreihen falsch — alle 251 Zeilen standen auf
     * unvollstaendig, gemessen am 14.08.2026 um 00:16.
     * Jetzt: "kein Rueckstand aus einem frueheren Lauf".
     */
    coalesce(s.seiten_rueckstand, 0) = 0 AS liste_vollstaendig,
    count(*) FILTER (WHERE b.status = 'canceled')  AS storniert,
    count(*) FILTER (WHERE b.status = 'pending')   AS pending,
    count(*) FILTER (WHERE b.status IS NULL
                        OR b.status = '[object Object]') AS status_unbekannt,
    -- NEU 0075 -------------------------------------------------------
    -- Seiten, die einen ganzen Lauf ueberlebt haben. DAS ist die Zahl,
    -- die "es fehlen ganze Bestellungen" bedeutet.
    coalesce(s.seiten_rueckstand, 0) AS seiten_rueckstand,
    -- Seiten, die uns die Quelle dauerhaft verweigert. Kein Ladevorgang,
    -- sondern eine Grenze — und ein anderer Satz auf der Karte.
    coalesce(s.seiten_kein_zugriff, 0) AS seiten_kein_zugriff,
    /*
     * Der zweite Teil von Punkt 3.1: "Kopf ohne Position" als eigene
     * Spalte. positionen_pct sagt dasselbe in Prozent und wird deshalb
     * ueberlesen — 99,9 % sieht aus wie fertig. 47 Bestellungen ueber
     * vier Marken sind es nicht (nachgemessen am 14.08.2026).
     */
    count(*) - count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM core.bestellposition p
         WHERE p.bestellung_key = b.bestellung_key)) AS ohne_positionen,
    /*
     * Der Zustand als EIN Wert, damit die Karte nicht drei Spalten
     * gegeneinander rechnen muss (und beim naechsten Umbau anders rechnet
     * als diese Sicht).
     */
    CASE WHEN coalesce(s.seiten_rueckstand, 0)   > 0 THEN 'laedt'
         WHEN coalesce(s.seiten_kein_zugriff, 0) > 0 THEN 'kein zugriff'
         ELSE 'vollstaendig' END AS zustand
  FROM core.bestellung b
  JOIN core.kostenstelle k USING (kostenstelle_key)
  JOIN core.marke m ON m.marke_key = k.marke_key
  LEFT JOIN seiten s ON s.marke_key = m.marke_key
 WHERE b.bestellt_am IS NOT NULL
 GROUP BY m.name, date_trunc('month', b.bestellt_am), s.seiten_erledigt,
          s.seiten_offen, s.seiten_rueckstand, s.seiten_kein_zugriff
 ORDER BY 1, 2 DESC;

COMMENT ON VIEW mart.einkauf_ladestand IS
'Der Vertrauensanker vor jeder Aussage ueber einen Zeitraum: was fehlt, was ist
fraglich, und was bekommen wir gar nicht.

  zustand = laedt          es liegt Rueckstand aus einem frueheren Lauf. GANZE
                           Bestellungen fehlen, die Prozentspalte sieht das nicht.
  zustand = kein zugriff   die Quelle verweigert eine Kostenstelle dauerhaft
                           (403). Kein Ladevorgang. mart.posten_ohne_zugriff
                           sagt, ob es ein eigener Betrieb ist — nur dann ist
                           es ein Problem.
  zustand = vollstaendig   die Liste ist durch.

seiten_offen zaehlt weiterhin ALLE offenen Seiten und ist waehrend eines Laufs
normalerweise > 0. Wer eine Aussage will, liest seiten_rueckstand.

ohne_positionen ist die absolute Fassung von positionen_pct — 99,9 % sieht aus
wie fertig, 47 fehlende Bestellungen nicht.

einkauf_netto ist OHNE Stornos (Migration 0043); was storniert wurde, steht in
storniert_netto daneben.';

COMMENT ON COLUMN mart.einkauf_ladestand.seiten_offen IS
'Alle offenen fn:bestellungen-Seiten der Marke, unabhaengig vom Alter. Waehrend
und kurz nach einem Lauf ist die Zahl normalerweise > 0 — das ist Arbeit, kein
Rueckstand. Die Aussage steht in seiten_rueckstand.';


-- ---------------------------------------------------------------------
-- 4. sync.fortschritt bekommt einen Schreiber (Punkt 3.4)
--
-- Die Tabelle steht seit Migration 0005 da, hat vier Leser
-- (src/health.ts, mart.sync_status, 0019, 0039) und hatte keinen
-- einzigen Schreiber. Am 14.08.2026 in Produktion nachgezaehlt: 0 Zeilen.
--
-- Der Gesundheitsbericht meldete damit strukturbedingt fuer immer "null
-- pausierte Endpunkte" — die gefaehrlichste Sorte Pruefung, weil sie nie
-- ausschlaegt und deshalb nie hinterfragt wird.
--
-- FUELLEN STATT ENTFERNEN, und zwar aus einem Grund, der erst beim
-- Nachsehen klar wurde: die drei anderen Spalten haben echte Leser mit
-- echten Fragen (0019 "wo steht welcher Endpunkt", 0039 "welcher Betrieb
-- haengt"). Nur pausiert_bis hatte keine Entsprechung mehr, weil die
-- Selbstdrosselung inzwischen als faellig_ab am POSTEN sitzt und nicht als
-- Pause an der Kombination. Der Schreiber in src/sync/worker.ts traegt
-- deshalb genau das dort ein: die Wiedervorlage, die er gerade gesetzt hat.
-- ---------------------------------------------------------------------

COMMENT ON TABLE sync.fortschritt IS
'Wo steht der Importer je Endpunkt und Betrieb? Der Zustand liegt bewusst in der
Datenbank und nicht im Container - ein Absturz kostet damit nichts.

Geschrieben von src/sync/worker.ts, seit 0075. Davor hatte die Tabelle vier
Leser und keinen Schreiber: sie stand seit Migration 0005 auf 0 Zeilen, und
src/health.ts meldete daraus fuer immer "null pausierte Endpunkte".';

COMMENT ON COLUMN sync.fortschritt.pausiert_bis IS
'Selbstdrosselung: bis wann die Wiedervorlage dieser Kombination in der Zukunft
liegt. Der Worker traegt hier die faellig_ab ein, die er nach einem Fehler
gesetzt hat (exponentiell mit Jitter), und raeumt sie beim naechsten Erfolg.

NICHT dasselbe wie eine Zugangssperre: die steht in sync.sperre und gilt fuer
den ganzen Zugang, nicht fuer eine Kombination.';


-- ---------------------------------------------------------------------
-- 5. Zwei Pruefzeilen dazu
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
       count(*) FILTER (WHERE zustand <> 'kein belegarchiv'),
       count(*) FILTER (WHERE zustand <> 'kein belegarchiv'
                          AND (zuletzt_gezaehlt IS NULL
                            OR zuletzt_gezaehlt < now() - interval '36 hours')),
       'mart.belegarchiv_zulauf'
  FROM mart.belegarchiv_zulauf
UNION ALL
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
SELECT 'Bestellung: Details im Fenster aelter als 48 h',
       coalesce(sum(im_fenster), 0)::bigint,
       coalesce(sum(fenster_veraltet), 0)::bigint,
       'mart.bestelldetail_stand'
  FROM mart.bestelldetail_stand
UNION ALL
SELECT 'Einkauf: Kostenstelle ohne Betrieb, mit Bestellungen',
       count(*), count(*) FILTER (WHERE NOT testbetrieb AND bestellungen > 0),
       'mart.kostenstelle_ohne_betrieb'
  FROM mart.kostenstelle_ohne_betrieb
UNION ALL
SELECT 'Nachzuegler: Aenderungen am Rand des Fensters',
       count(DISTINCT endpunkt),
       count(DISTINCT endpunkt) FILTER (WHERE am_rand_noch_aenderungen),
       'mart.nachzuegler_tiefe'
  FROM mart.nachzuegler_tiefe
UNION ALL
/*
 * NEU MIT 0075. Rueckstand statt "offen": die Zeile schlaegt nur an, wenn
 * eine Bestellseite einen ganzen Lauf ueberlebt hat.
 */
SELECT 'Einkauf: Bestellseiten aus einem frueheren Lauf offen',
       count(DISTINCT marke),
       count(DISTINCT marke) FILTER (WHERE seiten_rueckstand > 0),
       'mart.einkauf_ladestand'
  FROM mart.einkauf_ladestand
UNION ALL
/*
 * NEU MIT 0075. Die Gegenprobe zu mart.posten_ohne_zugriff: ein 403 auf
 * einer fremden Kostenstelle ist in Ordnung, einer auf unserer nicht.
 */
SELECT 'Einkauf: 403 auf einem EIGENEN Betrieb',
       count(*), count(*) FILTER (WHERE eigener_betrieb),
       'mart.posten_ohne_zugriff'
  FROM mart.posten_ohne_zugriff
UNION ALL
SELECT 'Warteschlange: endgueltig aufgegeben',
       count(*), count(*) FILTER (WHERE zustand = 'endgueltig'),
       'mart.posten_aufgegeben'
  FROM mart.posten_aufgegeben;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0075', to_jsonb(
        'Die Anzeige sagt, was sie meint. mart.einkauf_ladestand trennt Rueckstand '
        '(eine Seite hat einen ganzen Lauf ueberlebt) von laufender Arbeit und von '
        'fehlendem Zugriff; sync.warteschlange.gesperrt_seit beendet den 403-Zweig, '
        'der bis dahin unbegrenzt lief; sync.fortschritt bekommt nach acht Wochen '
        'ohne Schreiber einen. Anlass fuer die Neufassung war eine Messung, die den '
        'Plan korrigiert: nicht 60 Zeilen standen auf "… laedt", sondern alle 251.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
