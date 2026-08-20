-- =====================================================================
-- 0085 — Was Feiertage, Ferien und Wochentage am Umsatz bewegen
--        (Plan Kalender/Wetter, Phase 2)
--
-- Die Frage, auf die es bis heute keine Antwort gab: "war das ein guter
-- Samstag?" — und die dahinter: "was bringt uns eigentlich ein
-- Feiertag?". Der Vergleichstag liefert die Rohzahl seit 0051; hier wird
-- sie zur Aussage verdichtet.
--
-- DREI ENTWURFSENTSCHEIDUNGEN, die man den Sichten sonst nicht ansieht:
--
-- 1. MEDIAN STATT MITTELWERT. Ein einzelner Betriebsausfall oder eine
--    Grossveranstaltung kippt einen Mittelwert ueber 45 Beobachtungen.
--    p25 und p75 stehen daneben, damit eine breite Streuung nicht wie ein
--    praeziser Wert aussieht.
--
-- 2. EIN MEDIAN LAESST SICH NICHT WEITER AGGREGIEREN. Der Median ueber
--    "alle Betriebe der Marke" ist NICHT der Median der Betriebs-Mediane.
--    Karten mit Marken- oder Zeitraumfilter rechnen deshalb DIREKT auf
--    mart.vergleichstag_basis mit percentile_cont, statt diese Sicht
--    weiterzuverdichten. mart.kalendereffekt ist die Betriebsebene und
--    der Drill-Down — nicht die Zwischenstufe fuer Gruppenzahlen.
--
-- 3. DIE DREI EFFEKTE WERDEN NEBENEINANDER AUSGEWIESEN, NICHT
--    GEGENEINANDER VERRECHNET. Wer Feiertag, Ferienlage und (ab 0086)
--    Wetter addiert, zaehlt doppelt: ein Feiertag im Sommer ist auch ein
--    warmer Tag. Das hier ist eine Messung, kein Modell.
--
-- WARUM EINE ROLLIERENDE UNTERGRENZE UND KEINE JAHRESZAHL
--
-- Nachgemessen am 20.08.2026: im Januar 2021 hatten 27 Betriebe Umsatz,
-- im April 2020 waren es 32 — gegen rund 59 im Normalbetrieb. Ein
-- Feiertagseffekt ueber die ganze Historie mischt die Lockdown-Monate
-- mit, und zwar besonders haesslich: ein Feiertag mit Umsatz wird gegen
-- vier Vergleichstage VOR der Schliessung gerechnet.
--
-- Der Prototyp in docs/plan-kalender-wetter.md rechnete deshalb "ab
-- 2023". Eine feste Jahreszahl veraltet aber still — 2030 waere sie
-- unsinnig. Also die letzten drei vollen Jahre plus das laufende; heute
-- ist das der 01.01.2023, und die Grenze wandert von selbst mit.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Der Auswertungszeitraum, an EINER Stelle
--
-- Steht als Sicht da und nicht als Konstante in vier Abfragen: sonst
-- verschiebt jemand sie an drei Stellen und uebersieht die vierte.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.kalender_zeitraum AS
SELECT (date_trunc('year', current_date) - INTERVAL '3 years')::date AS von,
       current_date                                                  AS bis,
       'die letzten drei vollen Jahre plus das laufende — haelt die '
       'Lockdown-Monate 2020/2021 draussen, ohne als Jahreszahl zu veralten'::text AS begruendung;

COMMENT ON VIEW mart.kalender_zeitraum IS
'Die Untergrenze aller Effektsichten, rollierend. Nachgemessen am 20.08.2026: im Januar '
'2021 hatten 27 Betriebe Umsatz statt der ueblichen 59 — eine Auswertung ueber die ganze '
'Historie misst dort die Schliessung und nennt sie Feiertagseffekt.';


-- ---------------------------------------------------------------------
-- 2. Die Einordnung jedes Tages in die vier Kategorien
--
-- Eine Zeile je Tag und Kategorie — ein Tag ist gleichzeitig ein
-- Donnerstag, vielleicht ein Feiertag und vielleicht ein Brueckentag.
--
-- NUR SAUBERE FAELLE: vergleichstage = 4. Ein Vergleich aus einem Tag ist
-- keiner, und ein Median ueber halb belegte Vergleiche sieht genauso
-- praezise aus wie einer ueber volle.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.kalendertag_lage AS
SELECT v.betrieb_key, v.betrieb, v.geschaeftstag, v.kalender_quelle,
       v.bundesland, v.abweichung_pct, v.umsatz_netto, v.umsatz_vergleich,
       l.kategorie, l.auspraegung
  FROM mart.vergleichstag_basis v
  CROSS JOIN LATERAL (VALUES
        ('feiertag',   CASE WHEN v.ist_feiertag THEN v.feiertag END),
        ('wochentag',  v.wochentag),
        -- STRIKT VIER, nicht "irgendein Unterschied". Die Beschriftung sagt
        -- "Vergleichstage nicht" — das ist nur wahr, wenn ALLE VIER anders
        -- liegen. Mit ferien_abweichung >= 1 gebuendelt stuenden 12.494 Tage
        -- unter einem Etikett, das fuer 6.064 davon falsch ist (nachgezaehlt
        -- am 20.08.2026). Die Mischfaelle bekommen ihre eigene Zeile, statt
        -- die klare Aussage zu verwaessern.
        ('ferienlage', CASE
             WHEN v.ist_schulferien IS NULL          THEN NULL
             WHEN v.ferien_abweichung = 0            THEN 'gleiche Ferienlage'
             WHEN v.ferien_abweichung < 4            THEN 'gemischte Ferienlage'
             WHEN v.ist_schulferien                  THEN 'Tag in den Ferien, Vergleichstage nicht'
                                                     ELSE 'Tag ausserhalb, Vergleichstage in den Ferien'
           END),
        ('brueckentag', CASE
             WHEN v.ist_feiertag                     THEN NULL
             WHEN v.folgetag_feiertag AND v.vortag_feiertag THEN 'zwischen zwei Feiertagen'
             WHEN v.folgetag_feiertag                THEN 'Tag vor einem Feiertag'
             WHEN v.vortag_feiertag                  THEN 'Tag nach einem Feiertag'
                                                     ELSE 'gewoehnlicher Tag'
           END)
       ) AS l(kategorie, auspraegung)
 WHERE v.vergleichstage = 4
   AND v.abweichung_pct IS NOT NULL
   AND l.auspraegung IS NOT NULL
   AND v.geschaeftstag >= (SELECT von FROM mart.kalender_zeitraum);

COMMENT ON VIEW mart.kalendertag_lage IS
'Jeder auswertbare Tag in seinen vier Lagen: Feiertag, Wochentag, Ferienlage, '
'Brueckentag. Ein Tag steht in mehreren Zeilen — er ist gleichzeitig ein Donnerstag und '
'vielleicht ein Brueckentag. Die Rohebene unter mart.kalendereffekt; Karten mit Marken- '
'oder Zeitraumfilter rechnen HIER mit percentile_cont, nicht auf dem fertigen Median.';


-- ---------------------------------------------------------------------
-- 3. Der Effekt je Betrieb
--
-- ACHTUNG, DER NULLPUNKT LIEGT NICHT BEI NULL. Nachgemessen am
-- 20.08.2026 ueber alle Betriebe mit Landeskalender: ein GEWOEHNLICHER
-- Tag — kein Feiertag, kein Nachbar eines Feiertags — hat einen Median
-- von -3,5 %, nicht 0 %.
--
-- Das ist kein Fehler, sondern die Bauart des Vergleichs: verglichen wird
-- ein einzelner Tag gegen den MITTELWERT von vier Tagen. Tagesumsaetze
-- sind rechtsschief (ein paar sehr starke Tage, viele mittlere), und der
-- Mittelwert liegt bei einer rechtsschiefen Verteilung ueber dem Median.
-- Der typische Tag liegt also unter dem Schnitt seiner vier Vorgaenger,
-- ohne dass irgendetwas schiefgelaufen waere.
--
-- FOLGE FUER DIE DEUTUNG: eine Abweichung von -2 % ist NICHT "leicht
-- unter normal", sondern leicht UEBER dem, was ein gewoehnlicher Tag
-- ohnehin zeigt. Deshalb steht neben median_pct die Spalte
-- median_gegen_basis_pp — derselbe Wert, gemessen gegen den gewoehnlichen
-- Tag DIESES Betriebs statt gegen die Null. Wer die Kacheln gegen null
-- liest, haelt die halbe Gruppe fuer schwach.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.kalendereffekt AS
WITH basiswert AS (   -- der gewoehnliche Tag je Betrieb: der wahre Nullpunkt
  SELECT betrieb_key,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct) AS basis_pct
    FROM mart.kalendertag_lage
   WHERE kategorie = 'brueckentag' AND auspraegung = 'gewoehnlicher Tag'
   GROUP BY betrieb_key
), roh AS (
  SELECT betrieb_key, betrieb, kalender_quelle, kategorie, auspraegung,
         count(*)::int                                               AS tage,
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY abweichung_pct) AS median_pct,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY abweichung_pct) AS p25_pct,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY abweichung_pct) AS p75_pct,
         max(geschaeftstag)                                          AS letzter_termin
    FROM mart.kalendertag_lage
   GROUP BY betrieb_key, betrieb, kalender_quelle, kategorie, auspraegung
)
SELECT r.betrieb_key, r.betrieb, r.kalender_quelle, r.kategorie, r.auspraegung,
       r.tage,
       round(r.median_pct::numeric, 1) AS median_pct,
       round(r.p25_pct::numeric, 1)    AS p25_pct,
       round(r.p75_pct::numeric, 1)    AS p75_pct,
       round(b.basis_pct::numeric, 1)  AS basis_pct,
       round((r.median_pct - b.basis_pct)::numeric, 1) AS median_gegen_basis_pp,
       r.letzter_termin
  FROM roh r LEFT JOIN basiswert b ON b.betrieb_key = r.betrieb_key;

COMMENT ON VIEW mart.kalendereffekt IS
'Je Betrieb, Kategorie und Auspraegung: wie weit weicht der Umsatz vom Durchschnitt der '
'letzten vier gleichen Wochentage ab. Median, weil ein einzelner Ausfall einen Mittelwert '
'kippt; p25/p75 daneben, damit breite Streuung nicht wie Praezision aussieht. '
'NICHT WEITER AGGREGIERBAR: der Median einer Marke ist nicht der Median der '
'Betriebs-Mediane — dafuer auf mart.kalendertag_lage rechnen. Und NICHT ADDIERBAR: wer '
'Feiertag, Ferien und Wetter zusammenzaehlt, zaehlt doppelt.';

COMMENT ON COLUMN mart.kalendereffekt.kalender_quelle IS
'bundesweit heisst: der Betrieb hat keinen gepflegten Standort und traegt nur die neun '
'bundesweiten Feiertage. Seine Feiertagszeilen stimmen, seine regionalen fehlen, und '
'Ferienzeilen hat er gar nicht. Wer Marken vergleicht, filtert auf bundesland.';


-- ---------------------------------------------------------------------
-- 4. Die einzige Sicht, die nach vorn schaut
--
-- Welche Feiertage stehen in den naechsten 90 Tagen an, wen treffen sie,
-- und was war es beim letzten Mal? Das ist der Grund, warum jemand das
-- Dashboard ein zweites Mal oeffnet.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.feiertag_kalender AS
WITH kommend AS (
  SELECT k.betrieb_key, k.betrieb, k.kalender_quelle, k.geschaeftstag AS datum,
         k.feiertag, k.wochentag
    FROM mart.betrieb_kalender k
   WHERE k.feiertag IS NOT NULL
     AND k.geschaeftstag > current_date
     AND k.geschaeftstag <= current_date + 90
)
SELECT kommend.betrieb_key, kommend.betrieb, kommend.datum, kommend.feiertag,
       kommend.wochentag,
       (kommend.datum - current_date)::int AS in_tagen,
       e.tage           AS bisherige_termine,
       e.median_pct     AS median_bisher_pct,
       e.p25_pct, e.p75_pct,
       e.letzter_termin
  FROM kommend
  LEFT JOIN mart.kalendereffekt e
    ON e.betrieb_key = kommend.betrieb_key
   AND e.kategorie   = 'feiertag'
   AND e.auspraegung = kommend.feiertag
 ORDER BY kommend.datum, kommend.betrieb;

COMMENT ON VIEW mart.feiertag_kalender IS
'Die naechsten 90 Tage: welcher Feiertag trifft welchen Betrieb, und was war er beim '
'letzten Mal wert. Leere Werte in median_bisher_pct heissen, dass es diesen Feiertag fuer '
'diesen Betrieb im Auswertungszeitraum noch nicht mit vier sauberen Vergleichstagen gab — '
'nicht, dass er wirkungslos waere.';


-- ---------------------------------------------------------------------
-- 5. Die Gruppenzahl, an EINER Stelle richtig gerechnet
--
-- Fuer die Kachel "was bringt ein Feiertag" ueber alle Betriebe. Rechnet
-- auf der Tagesebene und nicht auf den Betriebs-Medianen — siehe
-- Entwurfsentscheidung 2 oben. Nur Betriebe mit eigenem Landeskalender,
-- sonst mischt die Zahl zwei Genauigkeiten.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.kalendereffekt_gruppe AS
WITH basiswert AS (
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY abweichung_pct) AS basis_pct
    FROM mart.kalendertag_lage
   WHERE kalender_quelle = 'bundesland'
     AND kategorie = 'brueckentag' AND auspraegung = 'gewoehnlicher Tag'
), roh AS (
  SELECT kategorie, auspraegung,
         count(*)::int                    AS tage,
         count(DISTINCT betrieb_key)::int AS betriebe,
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY abweichung_pct) AS median_pct,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY abweichung_pct) AS p25_pct,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY abweichung_pct) AS p75_pct,
         max(geschaeftstag)               AS letzter_termin
    FROM mart.kalendertag_lage
   WHERE kalender_quelle = 'bundesland'
   GROUP BY kategorie, auspraegung
)
SELECT r.kategorie, r.auspraegung, r.tage, r.betriebe,
       round(r.median_pct::numeric, 1) AS median_pct,
       round(r.p25_pct::numeric, 1)    AS p25_pct,
       round(r.p75_pct::numeric, 1)    AS p75_pct,
       round(b.basis_pct::numeric, 1)  AS basis_pct,
       round((r.median_pct - b.basis_pct)::numeric, 1) AS median_gegen_basis_pp,
       r.letzter_termin
  FROM roh r CROSS JOIN basiswert b;

COMMENT ON VIEW mart.kalendereffekt_gruppe IS
'Derselbe Median ueber alle Betriebe mit eigenem Landeskalender — auf der TAGESEBENE '
'gerechnet, nicht als Mittel der Betriebs-Mediane. Genau deshalb steht diese Sicht hier '
'und wird nicht in der Karte zusammengerechnet.';


-- ---------------------------------------------------------------------
-- 6. Was die Spalten bedeuten — und was die Kategorie wochentag NICHT ist
-- ---------------------------------------------------------------------
COMMENT ON COLUMN mart.kalendereffekt.basis_pct IS
'Der Median eines GEWOEHNLICHEN Tages dieses Betriebs — der wahre Nullpunkt. Ueber die '
'Gruppe waren das am 20.08.2026 -3,5 %, nicht 0 %: verglichen wird ein einzelner Tag '
'gegen den MITTELWERT von vier Tagen, und bei rechtsschiefen Tagesumsaetzen liegt der '
'Mittelwert ueber dem Median. Wer die Kacheln gegen null liest, haelt die halbe Gruppe '
'fuer schwach.';

COMMENT ON COLUMN mart.kalendereffekt.median_gegen_basis_pp IS
'median_pct minus basis_pct, in Prozentpunkten — die Zahl, die man eigentlich meint. '
'Beispiel vom 20.08.2026: der Tag vor einem Feiertag steht bei +17,4 % roh, aber bei '
'+20,9 pp gegen den gewoehnlichen Tag.';

COMMENT ON COLUMN mart.kalendereffekt_gruppe.median_gegen_basis_pp IS
'Wie bei mart.kalendereffekt, nur ueber alle Betriebe mit Landeskalender. Der Nullpunkt '
'ist der gewoehnliche Tag, nicht die Null.';

/*
 * ZUR KATEGORIE `wochentag`: sie misst fast nichts, und das ist Absicht.
 * Der Vergleichstag stellt jeden Tag ohnehin schon gegen DIESELBEN vier
 * Wochentage — der Wochentagseffekt ist damit bauartbedingt
 * herausgerechnet. Nachgemessen am 20.08.2026 liegen alle sieben Mediane
 * zwischen -5,2 % und -0,4 %, also im Rauschen um den Basiswert.
 *
 * Sie bleibt trotzdem stehen, weil genau das ihr Nutzen ist: sie zeigt,
 * wie ein Nicht-Effekt in diesen Kacheln aussieht. Wer Christi
 * Himmelfahrt mit +68,4 % neben Samstag mit -0,4 % sieht, weiss, dass die
 * erste Zahl etwas bedeutet. Ohne diese Zeile fehlt der Massstab.
 *
 * WAS SIE NICHT IST: eine Aussage darueber, welcher Wochentag stark ist.
 * Die steht in mart.umsatz_tag, nicht hier.
 */

INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0085', to_jsonb(
        'Feiertags-, Ferien-, Wochentags- und Brueckentagseffekt je Betrieb, aus '
        'mart.vergleichstag_basis. Median statt Mittelwert, p25/p75 daneben, nur '
        'Tage mit vier sauberen Vergleichstagen. Die Untergrenze ist rollierend '
        '(drei volle Jahre plus das laufende) und haelt die Lockdown-Monate '
        'draussen: im Januar 2021 hatten 27 Betriebe Umsatz statt 59. Dazu '
        'mart.feiertag_kalender — die einzige Sicht, die nach vorn schaut.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
