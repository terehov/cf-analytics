-- =====================================================================
-- 0084 — Der Vergleichstag wird materialisiert (Plan Kalender/Wetter, Phase 1)
--
-- WARUM. mart.vergleichstag liegt seit 0051 in der Datenbank und wird von
-- KEINER Karte gelesen. Der Grund steht im Kommentar der Sicht selbst: sie
-- rechnet je Zeile vier Nachbartage nach und ist nur mit Filter benutzbar.
-- Eine Kachel ueber alle Betriebe gab es damit nie — geladen, gerechnet,
-- nie gezeigt.
--
-- WARUM DIE SICHT SO NICHT MATERIALISIERBAR IST. Sie referenziert ihre CTE
-- `basis` ZWEIMAL (als b und als r2 in der LATERAL). Postgres inlined nur
-- einfach referenzierte CTEs — `basis` wird also materialisiert, und ein
-- Filter auf betrieb_key wird NICHT hineingereicht. Die Sicht auf einen
-- Betrieb zu filtern macht sie deshalb nicht billig; sie baut trotzdem alle
-- Zeilen auf und scannt sie je Ergebniszeile erneut.
--
-- NACHGEMESSEN AM 20.08.2026, lokal, 188.640 Zeilen:
--
--   LATERAL-Fassung aus 0051, ganzer Bestand    nach 10 Minuten abgebrochen
--   Fensterfunktion + Kumulierung               33,1 s kalt / 35,2 s warm
--
-- docs/plan-kalender-wetter.md nennt 16,1 s. Der Wert ist auf dieser
-- Maschine nicht reproduzierbar; gemessen wird gut das Doppelte. An der
-- Folgerung aendert das nichts — 35 s neben den zwei Minuten des
-- Artikel-Refresh (0068) sind unauffaellig —, aber die Zahl im Plan ist
-- falsch, und hier steht die gemessene.
--
-- DASS DER UMBAU KEINE NAEHERUNG IST, ist nachgewiesen und bleibt es:
-- src/sync/vergleichstag.test.ts stellt beide Fassungen ueber denselben
-- kleinen Bestand nebeneinander und besteht nur bei NULL Abweichung in
-- allen acht Spalten. Am 20.08.2026 ueber 9.432 Zeilen, drei Betriebe,
-- volle Historie 2018-2026, 352 Feiertage darin: null.
--
-- ZWEI DINGE, DIE DIE GEGENPROBE DABEI GEFUNDEN HAT — beide waren in der
-- Vorarbeit nicht sichtbar, weil sie ueber einen Betrieb in 2026 lief:
--
--   1. Ein Entwurf mit `WHERE vorher > 0` verliert die Zeilen am Anfang
--      der Historie. Die LATERAL-Fassung behaelt sie mit
--      vergleichstage = 0. Sie bleiben auch hier drin (Regel 10: eine
--      Liste, in der Tage fehlen, ohne dass es dasteht).
--   2. ferien_abweichung ist bei vergleichstage = 0 eine Zaehlung ueber
--      die leere Menge, also 0 und nicht NULL. Das sind 1.661 von 9.432
--      Zeilen (17,6 %) — weit mehr als der Anfang der Historie, weil ein
--      Betrieb, der montags schliesst, fuer JEDEN Montag einen leeren
--      Vergleichsvorrat hat.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Zwei Quellen, zwei Schreibweisen fuer denselben Feiertag
--
-- NACHGEMESSEN AM 20.08.2026: manual.feiertag traegt 21 Namen aus zwei
-- Quellen. feiertage-api.de lieferte 2018-2019, openholidaysapi.org ab
-- 2020 — und die beiden schreiben vier Feiertage verschieden:
--
--   Neujahrstag              -> Neujahr
--   1. Weihnachtstag         -> 1. Weihnachtsfeiertag
--   2. Weihnachtstag         -> 2. Weihnachtsfeiertag
--   Augsburger Friedensfest  -> Friedensfest
--
-- WAS DAS ANRICHTET: eine Effektsicht, die nach Namen gruppiert, spaltet
-- diese vier in je zwei Zeilen — ausgerechnet Neujahr, den Extremwert der
-- ganzen Auswertung (-68,7 % Median). Zwei Zeilen mit halber Fallzahl,
-- beide plausibel aussehend, keine Fehlermeldung.
--
-- WARUM HIER UND NICHT BEIM IMPORT: die Rohzeilen bleiben, wie die Quelle
-- sie geliefert hat (dieselbe Haltung wie bei raw.api_antwort). Wer
-- nachsehen will, welche Quelle was gesagt hat, kann das weiterhin.
-- Normiert wird beim Lesen.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manual.feiertag_alias (
  name_alt     text PRIMARY KEY,
  name_neu     text NOT NULL,
  bemerkung    text,
  gepflegt_am  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE manual.feiertag_alias IS
'Schreibweisen desselben Feiertags auf einen Namen. Anlass: manual.feiertag traegt '
'zwei Quellen (feiertage-api.de bis 2019, openholidaysapi.org ab 2020), die vier '
'Feiertage verschieden schreiben. Ohne diese Zuordnung spaltet jede Gruppierung nach '
'Name sie in zwei Zeilen mit halber Fallzahl. Erweiterbar ohne Migration.';

INSERT INTO manual.feiertag_alias (name_alt, name_neu, bemerkung) VALUES
  ('Neujahrstag',             'Neujahr',               'feiertage-api.de 2018-2019'),
  ('1. Weihnachtstag',        '1. Weihnachtsfeiertag', 'feiertage-api.de 2018-2019'),
  ('2. Weihnachtstag',        '2. Weihnachtsfeiertag', 'feiertage-api.de 2018-2019'),
  ('Augsburger Friedensfest', 'Friedensfest',          'feiertage-api.de 2018-2019')
ON CONFLICT (name_alt) DO NOTHING;


CREATE OR REPLACE VIEW mart.feiertag_normiert AS
SELECT f.kuerzel,
       f.datum,
       coalesce(a.name_neu, f.name) AS name,
       f.name                       AS name_roh,
       f.quelle
  FROM manual.feiertag f
  LEFT JOIN manual.feiertag_alias a ON a.name_alt = f.name;

COMMENT ON VIEW mart.feiertag_normiert IS
'manual.feiertag mit vereinheitlichten Namen (siehe manual.feiertag_alias). name_roh '
'behaelt, was die Quelle geliefert hat. Jede Auswertung, die nach Feiertagsnamen '
'gruppiert, liest hier und nicht direkt aus manual.feiertag.';


-- ---------------------------------------------------------------------
-- 2. Die Waechterzeile dazu (Regel 10)
--
-- Ein Feiertag, dessen Name vor dem Ende der Historie aufhoert, ist fast
-- immer eine Umbenennung — genau die vier oben. Kommt eine fuenfte dazu,
-- weil eine Quelle wechselt, faellt sie hier auf und nicht erst in einer
-- halbierten Kachel.
--
-- ERWARTUNG: leer. Nicht "0 gefunden" — leer.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.feiertag_namenswechsel AS
WITH reichweite AS (SELECT max(datum) AS bis FROM manual.feiertag)
SELECT f.name,
       min(f.datum) AS erster_termin,
       max(f.datum) AS letzter_termin,
       count(DISTINCT f.datum) AS termine,
       string_agg(DISTINCT f.quelle, ', ') AS quellen
  FROM mart.feiertag_normiert f, reichweite r
 GROUP BY f.name, r.bis
HAVING max(f.datum) < r.bis - INTERVAL '2 years'
 ORDER BY max(f.datum);

COMMENT ON VIEW mart.feiertag_namenswechsel IS
'Feiertagsnamen, die mehr als zwei Jahre vor dem Ende des Bestands aufhoeren — fast '
'immer eine Umbenennung durch einen Quellenwechsel. ERWARTUNG: leer. Wer hier auftaucht, '
'gehoert nach manual.feiertag_alias, sonst zaehlt jede Gruppierung ihn doppelt.';


-- ---------------------------------------------------------------------
-- 3. Bundesweite Feiertage — der Rueckfall fuer Betriebe ohne PLZ
--
-- 81 der 141 Betriebe haben keinen gepflegten Standort, neun davon
-- machen laufenden Umsatz (15,1 Mio EUR in 2026, 22 % der Gruppe,
-- angefuehrt vom umsatzstaerksten Betrieb ueberhaupt). Ohne Bundesland
-- gibt es fuer sie keinen Feiertagskalender — und damit bisher keine
-- einzige Zeile im Vergleichstag, auch nicht fuer den reinen
-- Wochentagsvergleich, der gar kein Bundesland braucht.
--
-- DIE ENTSCHEIDUNG: sie kommen rein, mit den BUNDESWEITEN Feiertagen als
-- Rueckfall, und die Herkunft steht in kalender_quelle daneben. Die neun
-- bundesweiten tragen genau die grossen Ausschlaege (Neujahr -68,7 %,
-- Christi Himmelfahrt +68,4 %, Karfreitag -32,1 %, Pfingstmontag
-- +52,4 %); es fehlen die regionalen (Fronleichnam, Allerheiligen,
-- Heilige Drei Koenige, Mariae Himmelfahrt, Friedensfest).
--
-- WARUM NICHT EINFACH GANZ OHNE FEIERTAGSLOGIK: dann landen Feiertage
-- ungefiltert im Vergleichsvorrat. Ein Neujahr zieht den Schnitt der vier
-- Vergleichs-Mittwoche nach unten und laesst den Folgemittwoch glaenzen —
-- eine still falsche Zahl, kein Fehler.
--
-- Bundesweit heisst hier: in ALLEN Laendern des Bestands vorhanden. Wird
-- ein elftes Land nachgezogen, rechnet sich das von selbst mit.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.feiertag_bundesweit AS
SELECT f.datum, min(f.name) AS name
  FROM mart.feiertag_normiert f
 GROUP BY f.datum
HAVING count(DISTINCT f.kuerzel) = (SELECT count(DISTINCT kuerzel) FROM manual.feiertag);

COMMENT ON VIEW mart.feiertag_bundesweit IS
'Feiertage, die in allen Bundeslaendern des Bestands gelten — der Rueckfall fuer '
'Betriebe ohne gepflegte PLZ. Neun Termine im Jahr. Die regionalen fehlen '
'bauartbedingt; deshalb steht in mart.betrieb_kalender.kalender_quelle, welcher '
'Kalender einen Betrieb traegt.';


-- ---------------------------------------------------------------------
-- 4. Der Kalender je Betrieb und Tag — jetzt fuer ALLE Betriebe
--
-- Bis hierher standen in dieser Sicht 60 von 141 Betrieben: die mit
-- gepflegter PLZ. Ab jetzt alle, mit kalender_quelle als Herkunftsangabe.
--
-- ZWEI NEUE SPALTEN, weil sie hier fast nichts kosten und fachlich
-- zaehlen: vortag_feiertag und folgetag_feiertag. Der Abend vor einem
-- Feiertag ist in der Gastronomie ein eigenes Geschaeft, und ein
-- Brueckentag erklaert einen schwachen Freitag besser als jede
-- Wetterlage.
--
-- UMBAU VON LATERAL AUF VORAGGREGATION. Die alte Fassung holte je Zeile
-- zwei Nachbarwerte per LATERAL; bei 141 Betrieben und vier Nachschlagen
-- (Feiertag, Ferien, Vortag, Folgetag) waeren das 1,8 Mio Unterabfragen.
-- Stattdessen werden Feiertage und Ferien einmal auf (kuerzel, datum)
-- verdichtet und per Gleichheits-Join angehaengt. min(name) statt LIMIT 1
-- — dieselbe Absicht, deterministisch, und es faellt kein zweiter
-- Feiertag am selben Tag unter den Tisch, ohne dass es jemand merkt.
--
-- Die Tagesachse ist der Bestand selbst: 3.144 verschiedene
-- Geschaeftstage zwischen dem 01.01.2018 und dem 12.08.2026 (nachgezaehlt
-- am 20.08.2026 — zwei Kalendertage fehlen darin, deshalb wird der Vor-
-- und Folgetag ueber datum +/- 1 gesucht und nicht ueber lag/lead: sonst
-- spraenge die Nachbarschaft ueber die Luecke hinweg).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.betrieb_kalender AS
WITH tag AS (
  SELECT DISTINCT geschaeftstag FROM mart.umsatz_tag
), betrieb AS (
  SELECT b.betrieb_key,
         b.name        AS betrieb,
         bl.kuerzel,
         bl.bundesland,
         CASE WHEN bl.kuerzel IS NOT NULL THEN 'bundesland' ELSE 'bundesweit' END AS kalender_quelle
    FROM core.betrieb b
    LEFT JOIN mart.betrieb_bundesland bl ON bl.betrieb_key = b.betrieb_key
), feiertag_tag AS (
  SELECT kuerzel, datum, min(name) AS name FROM mart.feiertag_normiert GROUP BY 1, 2
), ferien_tag AS (
  SELECT s.kuerzel, d::date AS datum, min(s.name) AS name
    FROM manual.schulferien s,
         LATERAL generate_series(s.von, s.bis, INTERVAL '1 day') d
   GROUP BY 1, 2
)
SELECT b.betrieb_key,
       b.betrieb,
       b.kuerzel                                  AS bundesland_kuerzel,
       b.bundesland,
       t.geschaeftstag,
       extract(isodow FROM t.geschaeftstag)::int  AS wochentag_nr,
       to_char(t.geschaeftstag, 'TMDay')          AS wochentag,
       coalesce(ft.name, bw.name)                 AS feiertag,
       sf.name                                    AS schulferien,
       (coalesce(ft.name, bw.name) IS NOT NULL)   AS ist_feiertag,
       -- NULL und nicht false, wo es keinen Landeskalender gibt: fuer
       -- Schulferien gibt es keinen bundesweiten Ersatz — die Sommerferien
       -- liegen zwischen Bayern und Bremen sechs Wochen auseinander. false
       -- hiesse "nachgesehen, keine Ferien"; NULL heisst "unbekannt".
       CASE WHEN b.kuerzel IS NOT NULL THEN (sf.name IS NOT NULL) END AS ist_schulferien,
       b.kalender_quelle,
       (coalesce(ftv.name, bwv.name) IS NOT NULL) AS vortag_feiertag,
       (coalesce(ftf.name, bwf.name) IS NOT NULL) AS folgetag_feiertag
  FROM betrieb b
  CROSS JOIN tag t
  LEFT JOIN feiertag_tag ft  ON ft.kuerzel  = b.kuerzel AND ft.datum  = t.geschaeftstag
  LEFT JOIN feiertag_tag ftv ON ftv.kuerzel = b.kuerzel AND ftv.datum = t.geschaeftstag - 1
  LEFT JOIN feiertag_tag ftf ON ftf.kuerzel = b.kuerzel AND ftf.datum = t.geschaeftstag + 1
  LEFT JOIN ferien_tag   sf  ON sf.kuerzel  = b.kuerzel AND sf.datum  = t.geschaeftstag
  -- Der Rueckfall greift nur, wo es kein Bundesland gibt.
  LEFT JOIN mart.feiertag_bundesweit bw  ON b.kuerzel IS NULL AND bw.datum  = t.geschaeftstag
  LEFT JOIN mart.feiertag_bundesweit bwv ON b.kuerzel IS NULL AND bwv.datum = t.geschaeftstag - 1
  LEFT JOIN mart.feiertag_bundesweit bwf ON b.kuerzel IS NULL AND bwf.datum = t.geschaeftstag + 1;

COMMENT ON VIEW mart.betrieb_kalender IS
'Je Betrieb und Geschaeftstag: Wochentag, Feiertag, Schulferien, Vor- und Folgetag. '
'Seit 0084 fuer ALLE Betriebe — die ohne gepflegte PLZ bekommen die bundesweiten '
'Feiertage und keine Schulferien. Welcher Kalender einen Betrieb traegt, steht in '
'kalender_quelle; die Arbeitsliste dazu ist mart.kalender_fehlend.';

COMMENT ON COLUMN mart.betrieb_kalender.kalender_quelle IS
'bundesland = eigener Landeskalender, aus der gepflegten PLZ. bundesweit = Rueckfall '
'ohne Standort: nur die neun bundesweiten Feiertage, keine Schulferien. Wer Feiertags- '
'oder Ferieneffekte auswertet, filtert auf bundesland — sonst mischt er zwei '
'Genauigkeiten in eine Zahl.';

COMMENT ON COLUMN mart.betrieb_kalender.ist_schulferien IS
'NULL heisst UNBEKANNT, nicht "keine Ferien" — der Betrieb hat keinen Landeskalender. '
'Einen bundesweiten Ersatz gibt es nicht: zwischen Bayern und Bremen liegen die '
'Sommerferien sechs Wochen auseinander.';


-- ---------------------------------------------------------------------
-- 5. Die Materialisierung
--
-- WARUM DER TRICK FUNKTIONIERT. Der Vergleichsvorrat (kein Feiertag,
-- Umsatz > 0) bekommt je Betrieb und Wochentag eine laufende Nummer und
-- eine kumulierte Summe. Der Schnitt der letzten vier Vorrats-Tage vor
-- einem beliebigen Tag ist dann eine DIFFERENZ ZWEIER KUMULIERTER WERTE
-- statt einer eigenen Suche: zwei Gleichheits-Joins statt 188.640
-- Unterabfragen.
--
-- Feiertage bleiben dabei ausserhalb des Vorrats, bekommen aber weiterhin
-- einen Vergleichswert — genau die Eigenschaft, um die es fachlich geht
-- (Entscheidung 1 im Kommentar von 0051).
--
-- WAS HIER NICHT PASSIERT: Ruhetage fliegen nicht raus. Sie stehen mit
-- vergleichstage = 0 und leerem Vergleichswert drin. Ein Betrieb, der
-- montags schliesst, verschwindet sonst montags aus jeder Tagesliste, und
-- eine Liste, in der Tage fehlen, ohne dass es dasteht, ist die
-- Fehlerklasse aus Regel 10. Nachgezaehlt am 20.08.2026: 1.661 von 9.432
-- Zeilen der Stichprobe (17,6 %) sind solche Tage.
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mart.vergleichstag_basis;
CREATE MATERIALIZED VIEW mart.vergleichstag_basis AS
WITH basis AS (
  SELECT k.betrieb_key, k.betrieb, k.geschaeftstag, k.wochentag_nr, k.wochentag,
         k.bundesland_kuerzel, k.bundesland, k.kalender_quelle,
         k.feiertag, k.ist_feiertag, k.schulferien, k.ist_schulferien,
         k.vortag_feiertag, k.folgetag_feiertag,
         u.umsatz_netto, u.gaeste
    FROM mart.betrieb_kalender k
    JOIN mart.umsatz_tag u
      ON u.betrieb_key = k.betrieb_key AND u.geschaeftstag = k.geschaeftstag
), markiert AS (
  -- Wie viele Vorrats-Tage liegen VOR diesem Tag? Das ist zugleich der
  -- Rang der oberen Kante.
  SELECT b.*,
         count(*) FILTER (WHERE NOT b.ist_feiertag AND b.umsatz_netto > 0)
           OVER (PARTITION BY b.betrieb_key, b.wochentag_nr ORDER BY b.geschaeftstag
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS vorher
    FROM basis b
), vorrat AS (
  SELECT betrieb_key, wochentag_nr, geschaeftstag, umsatz_netto, gaeste, ist_schulferien,
         row_number() OVER (PARTITION BY betrieb_key, wochentag_nr
                            ORDER BY geschaeftstag) AS rang
    FROM basis
   WHERE NOT ist_feiertag AND umsatz_netto > 0
), kum AS (
  SELECT v.betrieb_key, v.wochentag_nr, v.rang, v.geschaeftstag,
         sum(v.umsatz_netto) OVER w                       AS ku,
         sum(v.gaeste) FILTER (WHERE v.gaeste > 0) OVER w AS kg,
         count(*)      FILTER (WHERE v.gaeste > 0) OVER w AS kgn,
         sum(v.ist_schulferien::int) OVER w               AS kf
    FROM vorrat v
  WINDOW w AS (PARTITION BY v.betrieb_key, v.wochentag_nr ORDER BY v.rang)
), roh AS (
  SELECT m.*,
         least(m.vorher, 4)                                          AS tage,
         -- nullif: bei vorher = 0 gibt es keinen Vergleich und keine Division.
         (a.ku - coalesce(v.ku, 0)) / nullif(least(m.vorher, 4), 0)  AS schnitt,
         (a.kg  - coalesce(v.kg,  0))                                AS gaeste_summe,
         (a.kgn - coalesce(v.kgn, 0))                                AS gaeste_anzahl,
         (a.kf  - coalesce(v.kf,  0))                                AS ferien_im_vorrat,
         c.geschaeftstag                                             AS von,
         a.geschaeftstag                                             AS bis
    FROM markiert m
    LEFT JOIN kum a ON a.betrieb_key  = m.betrieb_key            -- obere Kante
                   AND a.wochentag_nr = m.wochentag_nr AND a.rang = m.vorher
    LEFT JOIN kum v ON v.betrieb_key  = m.betrieb_key            -- untere Kante
                   AND v.wochentag_nr = m.wochentag_nr AND v.rang = m.vorher - 4
    LEFT JOIN kum c ON c.betrieb_key  = m.betrieb_key            -- fuer vergleich_von
                   AND c.wochentag_nr = m.wochentag_nr
                   AND m.vorher > 0 AND c.rang = greatest(m.vorher - 3, 1)
)
SELECT betrieb_key,
       betrieb,
       geschaeftstag,
       date_trunc('month', geschaeftstag)::date AS monat,
       wochentag_nr,
       wochentag,
       bundesland_kuerzel,
       bundesland,
       kalender_quelle,
       feiertag,
       ist_feiertag,
       schulferien,
       ist_schulferien,
       vortag_feiertag,
       folgetag_feiertag,
       umsatz_netto,
       gaeste,
       tage                                                  AS vergleichstage,
       round(schnitt, 2)                                     AS umsatz_vergleich,
       CASE WHEN gaeste_anzahl > 0
            THEN round(gaeste_summe::numeric / gaeste_anzahl, 1) END AS gaeste_vergleich,
       -- Aus dem UNGERUNDETEN Schnitt, wie in 0051. Aus dem gerundeten
       -- gerechnet weicht die letzte Stelle ab, und die Gegenprobe faellt.
       CASE WHEN schnitt > 0
            THEN round(100.0 * (umsatz_netto - schnitt) / schnitt, 1) END AS abweichung_pct,
       -- Ohne Landeskalender gibt es keine Ferienlage, also auch keine
       -- Abweichung davon. coalesce(...,0) im uebrigen Zweig, weil die
       -- LATERAL-Fassung bei vergleichstage = 0 ueber die leere Menge
       -- zaehlt und damit 0 liefert, nicht NULL.
       CASE WHEN kalender_quelle <> 'bundesland' THEN NULL
            WHEN ist_schulferien THEN tage - coalesce(ferien_im_vorrat, 0)
            ELSE coalesce(ferien_im_vorrat, 0) END           AS ferien_abweichung,
       von                                                   AS vergleich_von,
       bis                                                   AS vergleich_bis
  FROM roh;

-- Der eindeutige Index ist die Voraussetzung fuer REFRESH ... CONCURRENTLY,
-- wie bei round_table_monat in 0039.
CREATE UNIQUE INDEX vergleichstag_basis_zeile
    ON mart.vergleichstag_basis (betrieb_key, geschaeftstag);
CREATE INDEX vergleichstag_basis_tag     ON mart.vergleichstag_basis (geschaeftstag);
CREATE INDEX vergleichstag_basis_monat   ON mart.vergleichstag_basis (monat);
CREATE INDEX vergleichstag_basis_feiertag
    ON mart.vergleichstag_basis (feiertag) WHERE feiertag IS NOT NULL;

COMMENT ON MATERIALIZED VIEW mart.vergleichstag_basis IS
'Kapitel 7.1 der Round-Table-Map, materialisiert: jeder Tag gegen den Durchschnitt der '
'letzten vier gleichen Wochentage ohne Feiertag und ohne Ruhetag. Wird vom naechtlichen '
'Lauf aufgefrischt (src/sync/vergleichstag.ts), NACH pflegeNachlauf() — der schreibt die '
'Feiertage, aus denen hier gelesen wird. Was hier NICHT drinsteckt: lokale Events.';

COMMENT ON COLUMN mart.vergleichstag_basis.vergleichstage IS
'Wie viele Tage der Schnitt tatsaechlich trug. Weniger als 4 heisst: am Anfang der '
'Historie oder nach einer laengeren Schliessung. 0 heisst: gar kein Vergleich moeglich — '
'meist ein dauerhafter Ruhetag, denn ein Betrieb, der montags schliesst, hat fuer jeden '
'Montag einen leeren Vorrat. Ein Vergleich aus einem Tag ist keiner: Auswertungen '
'filtern auf vergleichstage = 4.';

COMMENT ON COLUMN mart.vergleichstag_basis.ferien_abweichung IS
'Wie viele der Vergleichstage eine andere Ferienlage hatten als der Tag selbst. 0 heisst '
'sauber vergleichbar, 4 heisst: der Tag liegt in den Ferien und die Vergleichstage nicht '
'(oder umgekehrt). Wird ausgewiesen, nicht bereinigt. NULL heisst: kein Landeskalender, '
'siehe kalender_quelle. ACHTUNG, 0 bei vergleichstage = 0 heisst nicht "sauber", sondern '
'"nichts zu vergleichen" — so rechnet die Fassung aus 0051, und so bleibt es.';


-- ---------------------------------------------------------------------
-- 6. Die alte Sicht bleibt, als duenne Huelle
--
-- Dieselben Spaltennamen in derselben Reihenfolge — alles, was auf
-- mart.vergleichstag verweist, gilt weiter. Die neuen Spalten haengen
-- hinten dran, damit CREATE OR REPLACE durchgeht.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.vergleichstag AS
SELECT betrieb_key, betrieb, geschaeftstag, wochentag, feiertag, ist_schulferien,
       umsatz_netto, gaeste, vergleichstage, umsatz_vergleich, gaeste_vergleich,
       abweichung_pct, ferien_abweichung, vergleich_von, vergleich_bis,
       monat, wochentag_nr, bundesland_kuerzel, bundesland, kalender_quelle,
       ist_feiertag, schulferien, vortag_feiertag, folgetag_feiertag
  FROM mart.vergleichstag_basis;

COMMENT ON VIEW mart.vergleichstag IS
'Duenne Huelle ueber mart.vergleichstag_basis. Bis 0084 rechnete diese Sicht je Zeile '
'vier Nachbartage nach und war nur mit Filter benutzbar; seitdem liest sie eine '
'materialisierte Tabelle und darf ungefiltert abgefragt werden.';


-- ---------------------------------------------------------------------
-- 7. Der Stand der Materialisierung — OHNE sie zu lesen
--
-- Eine frisch geklonte Datenbank hat unbefuellte materialisierte Sichten;
-- ein SELECT darauf endet mit PG 55000 und reisst den Ende-zu-Ende-Test
-- mit. Genau daran ist 0080 schon einmal haengengeblieben. Diese Sicht
-- liest deshalb ausschliesslich sync.merker und sync.lauf.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.vergleichstag_stand AS
WITH letzter_lauf AS (
  SELECT max(beendet_am) AS beendet_am
    FROM sync.lauf
   WHERE status IN ('ok', 'teilweise')
), merker AS (
  SELECT gesetzt_am, (wert ->> 'dauer_s')::numeric AS dauer_s
    FROM sync.merker WHERE schluessel = 'vergleichstag_refresh'
)
SELECT m.gesetzt_am        AS zuletzt_aufgefrischt,
       m.dauer_s,
       l.beendet_am        AS letzter_lauf,
       CASE WHEN m.gesetzt_am IS NULL              THEN 'nie aufgefrischt'
            WHEN l.beendet_am IS NULL              THEN 'kein Lauf'
            WHEN m.gesetzt_am < l.beendet_am - INTERVAL '1 hour' THEN 'veraltet'
            ELSE 'aktuell' END AS zustand
  FROM letzter_lauf l LEFT JOIN merker m ON true;

COMMENT ON VIEW mart.vergleichstag_stand IS
'Ist mart.vergleichstag_basis so frisch wie der letzte Lauf? Liest bewusst NUR '
'sync.merker und sync.lauf und nicht die Materialisierung selbst — eine frisch '
'geklonte Datenbank hat unbefuellte Sichten, und ein SELECT darauf endet mit PG 55000.';


-- ---------------------------------------------------------------------
-- 8. Die Pruefzeilen (Regel 10)
--
-- IN EINER EIGENEN SICHT, und das ist Absicht. mart.pruefung_uebersicht
-- wird von JEDER Migration, die eine Zeile ergaenzt, komplett neu
-- erzeugt. Arbeiten zwei Sessions parallel am Repo — wie am 20.08.2026 —,
-- ueberschreibt die spaeter angewendete Migration die Zeilen der
-- frueheren still. Als eigene Sicht kostet eine solche Kollision genau
-- eine UNION-Zeile statt drei Pruefungen, und sie faellt sofort auf.
--
-- ZU JEDER ZEILE GEHOERT DIE ERWARTUNG (0071-Hygiene): eine Kachel, die
-- nie auf null geht, liest nach zwei Wochen niemand mehr.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pruefung_kalender AS
SELECT 'Vergleichstag: Materialisierung aelter als der letzte Lauf'::text AS pruefung,
       1 AS geprueft,
       count(*) FILTER (WHERE zustand <> 'aktuell')::int AS auffaellig,
       'mart.vergleichstag_stand'::text AS sicht
  FROM mart.vergleichstag_stand
UNION ALL
-- ERWARTUNG: konstant 9, bis Eugene die Standorte pflegt. Faellt die Zahl,
-- wachsen die Sichten von selbst mit; steigt sie, ist ein neuer Betrieb
-- ohne Standort dazugekommen.
SELECT 'Vergleichstag: Betrieb mit Umsatz, aber ohne Bundesland'::text,
       (SELECT count(DISTINCT betrieb_key)::int FROM mart.umsatz_tag),
       count(*)::int,
       'mart.kalender_fehlend'::text
  FROM mart.kalender_fehlend
UNION ALL
-- ERWARTUNG: 0. Wer hier auftaucht, gehoert nach manual.feiertag_alias.
SELECT 'Feiertag: Name endet vor dem Ende der Historie'::text,
       (SELECT count(DISTINCT name)::int FROM mart.feiertag_normiert),
       count(*)::int,
       'mart.feiertag_namenswechsel'::text
  FROM mart.feiertag_namenswechsel;

COMMENT ON VIEW mart.pruefung_kalender IS
'Die Pruefzeilen rund um Kalender und Vergleichstag. Eigene Sicht, damit eine parallel '
'entwickelte Migration sie nicht beim Neuerzeugen von mart.pruefung_uebersicht '
'verschluckt. Erwartungen: Materialisierung 0, Betriebe ohne Bundesland konstant 9, '
'Namenswechsel 0.';


-- ---------------------------------------------------------------------
-- 9. Angehaengt an die Uebersicht — mit genau EINER Zeile
--
-- Der Rest der Definition ist unveraendert der Stand nach 0081.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS
 SELECT 'Umsatz: Artikelsumme vs. Umsatzbericht'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE pruefung_umsatz.auffaellig) AS auffaellig,
    'mart.pruefung_umsatz'::text AS sicht
   FROM mart.pruefung_umsatz
UNION ALL
 SELECT 'Bon: avgTicket vs. Umsatz/Rechnungen'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE pruefung_bon.auffaellig) AS auffaellig,
    'mart.pruefung_bon'::text AS sicht
   FROM mart.pruefung_bon
UNION ALL
 SELECT 'Zulauf: Quelle ohne Zulauf in ihrer Kadenz'::text AS pruefung,
    count(*) FILTER (WHERE quelle_zulauf.erwartet) AS geprueft,
    count(*) FILTER (WHERE quelle_zulauf.erwartet AND (quelle_zulauf.zustand = ANY (ARRAY['stumm'::text, 'nie'::text]))) AS auffaellig,
    'mart.quelle_zulauf'::text AS sicht
   FROM mart.quelle_zulauf
UNION ALL
 SELECT 'Zulauf: Quelle wird nicht mehr abgefragt'::text AS pruefung,
    count(*) FILTER (WHERE quelle_zulauf.erwartet) AS geprueft,
    count(*) FILTER (WHERE quelle_zulauf.erwartet AND NOT quelle_zulauf.wird_noch_gefragt) AS auffaellig,
    'mart.quelle_zulauf'::text AS sicht
   FROM mart.quelle_zulauf
UNION ALL
 SELECT 'Belegarchiv: Ordner ohne den faelligen Abzug'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE belegarchiv_zulauf.zustand = 'abzug fehlt'::text) AS auffaellig,
    'mart.belegarchiv_zulauf'::text AS sicht
   FROM mart.belegarchiv_zulauf
UNION ALL
 SELECT 'Belegarchiv: seit ueber 36 h nicht gezaehlt'::text AS pruefung,
    count(*) FILTER (WHERE belegarchiv_zulauf.zustand <> 'kein belegarchiv'::text) AS geprueft,
    count(*) FILTER (WHERE belegarchiv_zulauf.zustand <> 'kein belegarchiv'::text AND (belegarchiv_zulauf.zuletzt_gezaehlt IS NULL OR belegarchiv_zulauf.zuletzt_gezaehlt < (now() - '36:00:00'::interval))) AS auffaellig,
    'mart.belegarchiv_zulauf'::text AS sicht
   FROM mart.belegarchiv_zulauf
UNION ALL
 SELECT 'Belegarchiv: Betrieb ohne Belegarchiv'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE belegarchiv_zulauf.zustand = 'kein belegarchiv'::text) AS auffaellig,
    'mart.belegarchiv_zulauf'::text AS sicht
   FROM mart.belegarchiv_zulauf
UNION ALL
 SELECT 'Belegarchiv: Belegdatum spaeter als der eigene Upload'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM core.buchungsbeleg) AS geprueft,
    count(*) AS auffaellig,
    'mart.belegdatum_ausreisser'::text AS sicht
   FROM mart.belegdatum_ausreisser
UNION ALL
 SELECT 'Inventur: Zaehlung abgeschnitten'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM core.inventur
          WHERE inventur.anzahl_positionen IS NOT NULL) AS geprueft,
    count(*) AS auffaellig,
    'mart.inventur_abgeschnitten'::text AS sicht
   FROM mart.inventur_abgeschnitten
UNION ALL
 SELECT 'Inventur: Position ueber 50.000 EUR (aus dem Schwund genommen)'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM core.inventurposition) AS geprueft,
    COALESCE(sum(inventur_schwund.positionen_unplausibel), 0::numeric)::bigint AS auffaellig,
    'mart.inventur_schwund'::text AS sicht
   FROM mart.inventur_schwund
UNION ALL
 SELECT 'Bestellung: Kopf ohne eine einzige Position'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE NOT (EXISTS ( SELECT 1
           FROM core.bestellposition p
          WHERE p.bestellung_key = b.bestellung_key))) AS auffaellig,
    'core.bestellung'::text AS sicht
   FROM core.bestellung b
UNION ALL
 SELECT 'Bestellung: Details im Fenster aelter als 48 h'::text AS pruefung,
    COALESCE(sum(bestelldetail_stand.im_fenster), 0::numeric)::bigint AS geprueft,
    COALESCE(sum(bestelldetail_stand.fenster_veraltet), 0::numeric)::bigint AS auffaellig,
    'mart.bestelldetail_stand'::text AS sicht
   FROM mart.bestelldetail_stand
UNION ALL
 SELECT 'Einkauf: Kostenstelle ohne Betrieb, mit Bestellungen'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE NOT kostenstelle_ohne_betrieb.testbetrieb AND kostenstelle_ohne_betrieb.bestellungen > 0) AS auffaellig,
    'mart.kostenstelle_ohne_betrieb'::text AS sicht
   FROM mart.kostenstelle_ohne_betrieb
UNION ALL
 SELECT 'Nachzuegler: Aenderungen am Rand des Fensters'::text AS pruefung,
    count(DISTINCT nachzuegler_tiefe.endpunkt) AS geprueft,
    count(DISTINCT nachzuegler_tiefe.endpunkt) FILTER (WHERE nachzuegler_tiefe.am_rand_noch_aenderungen) AS auffaellig,
    'mart.nachzuegler_tiefe'::text AS sicht
   FROM mart.nachzuegler_tiefe
UNION ALL
 SELECT 'Einkauf: Bestellseiten aus einem frueheren Lauf offen'::text AS pruefung,
    count(DISTINCT einkauf_ladestand.marke) AS geprueft,
    count(DISTINCT einkauf_ladestand.marke) FILTER (WHERE einkauf_ladestand.seiten_rueckstand > 0) AS auffaellig,
    'mart.einkauf_ladestand'::text AS sicht
   FROM mart.einkauf_ladestand
UNION ALL
 SELECT 'Einkauf: 403 auf einem EIGENEN Betrieb'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE posten_ohne_zugriff.eigener_betrieb) AS auffaellig,
    'mart.posten_ohne_zugriff'::text AS sicht
   FROM mart.posten_ohne_zugriff
UNION ALL
 SELECT 'Umsatz: Monat mit mehr als 10 % nicht aufteilbarem Umsatz'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE hauptsparte_abdeckung.nicht_aufteilbar_pct > 10::numeric) AS auffaellig,
    'mart.hauptsparte_abdeckung'::text AS sicht
   FROM mart.hauptsparte_abdeckung
UNION ALL
 SELECT 'Yext: operativer Betrieb mit Umsatz, aber ohne Zuordnung'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM mart.betrieb_status
          WHERE betrieb_status.status = 'operativ'::text) AS geprueft,
    count(*) FILTER (WHERE betrieb_ohne_yext.status = 'operativ'::text AND betrieb_ohne_yext.macht_umsatz) AS auffaellig,
    'mart.betrieb_ohne_yext'::text AS sicht
   FROM mart.betrieb_ohne_yext
UNION ALL
 SELECT 'Yext: Vollabgleich aelter als 45 Tage'::text AS pruefung,
    count(*) FILTER (WHERE yext_abgleich.schluessel = 'yext_letzter_vollabgleich'::text) AS geprueft,
    count(*) FILTER (WHERE yext_abgleich.schluessel = 'yext_letzter_vollabgleich'::text AND yext_abgleich.tage_her > 45::numeric) AS auffaellig,
    'mart.yext_abgleich'::text AS sicht
   FROM mart.yext_abgleich
UNION ALL
 SELECT 'Yext: Sichtbarkeitszeile ohne eintraege_live'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE betrieb_sichtbarkeit.eintraege_live IS NULL) AS auffaellig,
    'core.betrieb_sichtbarkeit'::text AS sicht
   FROM core.betrieb_sichtbarkeit
UNION ALL
 SELECT 'Handpflege: Datei abgewiesen'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM sync.pflege_import) AS geprueft,
    count(*) FILTER (WHERE pflege_stand.zustand = 'abgewiesen'::text) AS auffaellig,
    'mart.pflege_stand'::text AS sicht
   FROM mart.pflege_stand
UNION ALL
 SELECT 'Handpflege: Tabelle veraltet oder laeuft aus'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE pflege_stand.zustand = ANY (ARRAY['veraltet'::text, 'laeuft bald aus'::text])) AS auffaellig,
    'mart.pflege_stand'::text AS sicht
   FROM mart.pflege_stand
UNION ALL
 SELECT 'Round Table: operativer Betrieb ohne vollstaendige Signale (Vorvormonat)'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM mart.round_table_basis
          WHERE round_table_basis.operativ AND round_table_basis.monat = (date_trunc('month'::text, CURRENT_DATE::timestamp with time zone) - '2 mons'::interval)::date) AS geprueft,
    count(*) FILTER (WHERE round_table_unvollstaendig.operativ AND round_table_unvollstaendig.monat = (date_trunc('month'::text, CURRENT_DATE::timestamp with time zone) - '2 mons'::interval)::date) AS auffaellig,
    'mart.round_table_unvollstaendig'::text AS sicht
   FROM mart.round_table_unvollstaendig
UNION ALL
 SELECT 'Warteschlange: endgueltig aufgegeben'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE posten_aufgegeben.zustand = 'endgueltig'::text) AS auffaellig,
    'mart.posten_aufgegeben'::text AS sicht
   FROM mart.posten_aufgegeben
UNION ALL
 SELECT * FROM mart.pruefung_kalender;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0084', to_jsonb(
        'Der Vergleichstag ist materialisiert. Die Fassung aus 0051 rechnete je '
        'Zeile vier Nachbartage nach und war nur mit Filter benutzbar — deshalb '
        'las sie keine einzige Karte. Umbau auf Fensterfunktion und Kumulierung: '
        'gemessen 33,1 s kalt / 35,2 s warm ueber 188.640 Zeilen, gegen einen '
        'Abbruch nach 10 Minuten. Wertgleichheit gegen die alte Fassung ist als '
        'Test abgesichert (null Abweichung in acht Spalten ueber 9.432 Zeilen). '
        'Der Kalender deckt ab jetzt alle 141 Betriebe statt 60: die ohne '
        'gepflegte PLZ bekommen die bundesweiten Feiertage, sichtbar in '
        'kalender_quelle. Dazu manual.feiertag_alias — zwei Quellen schrieben '
        'vier Feiertage verschieden, und eine Gruppierung nach Namen spaltete '
        'ausgerechnet Neujahr in zwei Zeilen.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
