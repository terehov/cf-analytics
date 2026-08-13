-- =====================================================================
-- 0074 Das Nachzuegler-Fenster misst sich selbst
--
-- ANLASS. Punkte 2.1 und 2.3 des Plans wollten zwei Fenster verbreitern:
-- das Rueckschaufenster von getKennzahlen ("gemessene Rueckbuchungstiefe:
-- sieben Monate") und das Nachzuegler-Fenster je Endpunkt
-- ("Personalkosten brauchen mehr als 10 Tage, Umsatz und Artikel kommen
-- mit 5 aus").
--
-- ---------------------------------------------------------------------
-- BEIDE ZAHLEN SIND ARTEFAKTE DES FENSTERS, DAS SIE MESSEN SOLLTEN
--
-- Am 13.08.2026 lesend in Produktion nachgerechnet.
--
-- (1) TAGESBERICHTE. Wie oft sich payload_hash zwischen zwei Abrufen
--     desselben Geschaeftstags aendert, nach Abstand in Tagen:
--
--       Abstand            1   2   3   4   5   6   7   8   9  10  11
--       getArtikelverkauf 22  28  31  31  31  31  30  31  30  30   9
--       getPersonalkosten 13  23  25  22  21  20  22  24  21  22   9
--       getUmsatzbericht   -   5   1   1   1   -   -   1   1   1   -
--
--     Bei Artikel und Personal ist die Rate FLACH bis Tag 10 — kein
--     Abklingen, kein Ende in Sicht. Der Einbruch bei Tag 11 ist kein
--     Befund, sondern die Grenze: NACHZUEGLER_TAGE ist 10, ab da sehen
--     wir nicht mehr hin. Die Aussage "Umsatz und Artikel kommen mit 5
--     Tagen aus" ist damit widerlegt: der Umsatzbericht kommt mit 5 aus,
--     der Artikelbericht nachweislich NICHT.
--
-- (2) BWA. core.kennzahlen_monat ist append-only, echte Aenderungen sind
--     also zaehlbar. Sie reichen "sieben Monate zurueck" — aber die
--     betroffenen Monate sind ausnahmslos die des LAUFENDEN Jahres, und
--     sieben Monate ist genau der Abstand von August zu Januar. Alles
--     dahinter (Abstand 8 bis 24) zeigt konstant 655 Werte aus einem
--     einzigen Monat, zuletzt am 27./28.07.2026 — das sind die Altjahre
--     aus dem Backfill, je zweimal geholt, also je eine Erst-gegen-Zweit-
--     Differenz. Keine Rueckbuchung.
--
--     `linaNachfuellen()` reiht nur das Jahr von "gestern" ein. Wir sehen
--     Rueckbuchungen also nur so weit zurueck, wie das laufende Jahr alt
--     ist. Im Januar waeren es "null Monate Tiefe" — und niemand haette
--     bemerkt, dass die Zahl nur den Kalender beschreibt.
--
-- ---------------------------------------------------------------------
-- WAS DARAUS FOLGT
--
-- Die Fenster werden verbreitert (src/lina/endpunkte.ts, src/config.ts),
-- aber die neuen Zahlen sind ausdruecklich KEINE Messergebnisse, sondern
-- Schaetzungen mit Reserve. Damit die naechste Zahl eine Messung sein
-- kann, misst sich das Fenster ab jetzt selbst:
--
--   mart.nachzuegler_tiefe   Aenderungsrate je Endpunkt und Abstand
--   Pruefzeile               schlaegt an, wenn am RAND des Fensters noch
--                            Aenderungen ankommen — dann ist es zu kurz
--
-- Das ist der Unterschied zu heute: bisher war die Grenze unsichtbar,
-- weil das Fenster genau dort aufhoerte, wo die Frage anfing.
--
-- ---------------------------------------------------------------------
-- DIE RECHNUNG (src/config.ts: TAGESBUDGET 10.500, verbraucht ~82)
--
--   heute      8 Tagesendpunkte x 10 Tage                     80
--   neu        6 x 10 + 2 x 21 (Personal, Artikel)           102
--   Kennzahlen 2 Endpunkte x 2 Jahre statt x 1                 +2
--   ------------------------------------------------------------
--                                              ~104 von 10.500 (1 %)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. mart.nachzuegler_tiefe — wie lange bucht LINA nach?
--
-- Gezaehlt werden ECHTE Aenderungen: derselbe Geschaeftstag, zweimal
-- geholt, verschiedener payload_hash. raw.api_antwort ist append-only,
-- die Frage also beantwortbar, ohne irgendetwas mitzuschreiben.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.nachzuegler_tiefe AS
WITH abrufe AS (
  SELECT endpunkt,
         zeitraum_von,
         abgerufen_am,
         payload_hash,
         (abgerufen_am::date - zeitraum_von) AS abstand_tage,
         lag(payload_hash) OVER (PARTITION BY endpunkt, zeitraum_von
                                 ORDER BY abgerufen_am) AS vorher
    FROM raw.api_antwort
   WHERE quelle = 'lina'
     AND zeitraum_von = zeitraum_bis          -- nur Tagesberichte
     AND zeitraum_von > current_date - 180
), je_abstand AS (
  SELECT endpunkt,
         abstand_tage,
         count(*)                                                       AS abrufe,
         count(*) FILTER (WHERE vorher IS NOT NULL
                            AND payload_hash IS DISTINCT FROM vorher)   AS aenderungen
    FROM abrufe
   WHERE abstand_tage BETWEEN 0 AND 60
   GROUP BY endpunkt, abstand_tage
)
SELECT j.endpunkt,
       j.abstand_tage,
       j.abrufe,
       j.aenderungen,
       -- Der Rand: der groesste Abstand, den wir fuer diesen Endpunkt
       -- ueberhaupt beobachtet haben. Weiter draussen wird nicht geholt,
       -- also kann dort auch nichts auffallen.
       max(j.abstand_tage) OVER (PARTITION BY j.endpunkt)               AS rand,
       (j.abstand_tage >= max(j.abstand_tage) OVER (PARTITION BY j.endpunkt) - 1
        AND j.aenderungen > 0)                                          AS am_rand_noch_aenderungen
  FROM je_abstand j
 ORDER BY j.endpunkt, j.abstand_tage;

COMMENT ON VIEW mart.nachzuegler_tiefe IS
'Wie lange bucht LINA einen Geschaeftstag nach? Eine Zeile je Endpunkt und Abstand
in Tagen, gezaehlt an ECHTEN Aenderungen: derselbe Tag, zweimal geholt,
verschiedener payload_hash. raw.api_antwort ist append-only, die Frage also
beantwortbar, ohne etwas mitzuschreiben.

WARUM ES DIESE SICHT GIBT: bis zum 13.08.2026 stand im Plan "Umsatz und Artikel
setzen sich binnen fuenf Tagen, Personalkosten brauchen laenger". Nachgerechnet war
die Aenderungsrate bei Artikel und Personal bis Tag 10 FLACH — rund 30 bzw. 22
Aenderungen an JEDEM Tag, ohne Abklingen. Der Einbruch bei Tag 11 war kein Befund,
sondern die Grenze von NACHZUEGLER_TAGE. Die Zahl beschrieb also unser Fenster und
nicht LINAs Verhalten.

am_rand_noch_aenderungen ist die Zeile, auf die man sieht: true heisst, dass am
aeusseren Rand des Fensters noch Aenderungen ankommen — dann ist das Fenster zu
kurz, und was dahinter liegt, sehen wir nicht. Die Pruefuebersicht zaehlt genau
das.

ERWARTUNG: fuer jeden Endpunkt faellt aenderungen gegen null, BEVOR abstand_tage
den rand erreicht. Wo das nicht so ist, gehoert NACHZUEGLER_TAGE bzw. das
endpunkteigene Fenster in src/lina/endpunkte.ts erhoeht — mit dieser Sicht als
Begruendung statt mit einer Schaetzung.';


-- ---------------------------------------------------------------------
-- 2. mart.bwa_rueckbuchung — dieselbe Frage fuer die BWA
--
-- core.kennzahlen_monat ist append-only (abgerufen_am steckt im
-- Primaerschluessel). Eine echte Rueckbuchung ist damit ein Wert, der
-- sich zwischen zwei Abrufen desselben Monats geaendert hat.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bwa_rueckbuchung AS
WITH lauf AS (
  SELECT betrieb_key, monat, kennzahl, abgerufen_am, wert_absolut,
         lag(wert_absolut) OVER (PARTITION BY betrieb_key, monat, kennzahl
                                 ORDER BY abgerufen_am) AS vorher
    FROM core.kennzahlen_monat
), aenderung AS (
  SELECT monat,
         abgerufen_am,
         ((date_part('year', abgerufen_am) * 12 + date_part('month', abgerufen_am))
        - (date_part('year', monat) * 12 + date_part('month', monat)))::int AS monate_zurueck
    FROM lauf
   WHERE vorher IS NOT NULL
     AND wert_absolut IS DISTINCT FROM vorher
)
SELECT monate_zurueck,
       count(*)                        AS geaenderte_werte,
       count(DISTINCT monat)           AS betroffene_monate,
       min(abgerufen_am)::date         AS erstmals,
       max(abgerufen_am)::date         AS zuletzt
  FROM aenderung
 WHERE monate_zurueck >= 0
 GROUP BY monate_zurueck
 ORDER BY monate_zurueck;

COMMENT ON VIEW mart.bwa_rueckbuchung IS
'Wie weit rueckwirkend aendert LINA die BWA? Gezaehlt an echten Wertaenderungen in
core.kennzahlen_monat, das append-only ist (abgerufen_am steckt im Primaerschluessel).

DIESE SICHT IST NUR SO TIEF WIE DAS EINREIHFENSTER. Bis zum 13.08.2026 reihte
linaNachfuellen() ausschliesslich das Jahr von "gestern" ein — Rueckbuchungen waren
damit nur innerhalb des laufenden Jahres sichtbar, und die viel zitierte
"Rueckbuchungstiefe von sieben Monaten" war schlicht der Abstand von August zu
Januar. Im Januar haette dieselbe Messung "null Monate" ergeben.

Was jenseits davon steht (Abstand 8 und mehr, konstant 655 Werte aus einem Monat,
zuletzt 27./28.07.2026), sind die Altjahre aus dem einmaligen Backfill: je zweimal
geholt, also je eine Erst-gegen-Zweit-Differenz. KEINE Rueckbuchung.

Seit dem 13.08.2026 wird zusaetzlich das VORJAHR eingereiht. Ab dann waechst die
beobachtbare Tiefe auf bis zu 24 Monate, und erst dann sagt diese Sicht etwas ueber
LINA statt ueber unser Fenster.';


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
/*
 * NEU MIT 0074, und die einzige Zeile, die etwas ueber unser eigenes
 * Hinsehen sagt statt ueber die Daten: kommen am RAND des
 * Nachzuegler-Fensters noch Aenderungen an, dann ist das Fenster zu kurz
 * und wir wissen nicht, was dahinter liegt.
 *
 * Gezaehlt werden Endpunkte, nicht Zeilen — "zwei Endpunkte sehen zu kurz"
 * ist die Aussage, die jemand braucht.
 */
SELECT 'Nachzuegler: Aenderungen am Rand des Fensters',
       count(DISTINCT endpunkt),
       count(DISTINCT endpunkt) FILTER (WHERE am_rand_noch_aenderungen),
       'mart.nachzuegler_tiefe'
  FROM mart.nachzuegler_tiefe
UNION ALL
SELECT 'Warteschlange: endgueltig aufgegeben',
       count(*), count(*) FILTER (WHERE zustand = 'endgueltig'),
       'mart.posten_aufgegeben'
  FROM mart.posten_aufgegeben;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0074', to_jsonb(
        'mart.nachzuegler_tiefe und mart.bwa_rueckbuchung: das Nachzuegler-Fenster '
        'misst ab jetzt selbst, ob es lang genug ist. Anlass: beide Zahlen, mit '
        'denen der Plan die Fenster begruenden wollte, waren Artefakte der Fenster '
        'selbst. Bei getArtikelverkaufsbericht und getPersonalkosten ist die '
        'Aenderungsrate bis Tag 10 FLACH (30 bzw. 22 je Tag) und bricht erst bei '
        'Tag 11 ein — dort endet NACHZUEGLER_TAGE. Und die "Rueckbuchungstiefe von '
        'sieben Monaten" der BWA war der Abstand von August zu Januar: eingereiht '
        'wurde nur das laufende Jahr.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
