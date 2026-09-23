-- =====================================================================
-- 0120 Der laufende Monat aus 97 — jede Nacht bis zum Vortag, vorlaeufig
--
-- ANLASS. Seit 0119 kommen die Finanzwege (Nachlaesse, Zahlungsmix) nur noch
-- aus Bericht 97, einem Monatsbericht. Der reguläre Erstabruf holt einen
-- Monat erst ab Monatsende + 7 Tagen (BETRIEBSBERICHT_REIFE_TAGE) — die
-- Zahlen hingen damit bis zu fuenf Wochen hinterher. Auftrag 23.09.2026:
-- 97 jede Nacht zusaetzlich fuer den laufenden Monat bis zum Vortag holen.
--
-- DER EINREIHWEG steht in src/sync/nachfuellen.ts (betriebsberichteNachfuellen,
-- Schritte 0a und 0b), der Lader in src/sync/betriebsbericht_laden.ts. Diese
-- Migration liefert, was die Datenbank dafuer wissen muss:
--
--   1. core.betriebsbericht_abruf.vorlaeufig — der Abruf wurde vor der Reife
--      seines Zeitraums geholt, seine letzten Tage koennen noch wachsen.
--      Gesetzt vom Lader (abrufVorlaeufig()), bei jedem Abruf neu.
--   2. mart.betriebsbericht_gegenprobe: befund 'vorlaeufig' statt einer
--      Abweichung, die nur daher kommt, dass LINA die Tage noch fuellt.
--   3. mart.betriebsbericht_ladestand_monat: ein Monat mit vorlaeufigem
--      Abruf ist 'teilweise', nie 'vollstaendig'; neue Spalte
--      betriebe_vorlaeufig am Ende.
--   4. Beschreibungen, die seit 0119 "erst ab dem 7. des Folgemonats" sagten.
--
-- WAS SICH NICHT AENDERT, und warum es trotzdem stimmt:
--   * mart.finanzweg_tag: 97 schreibt je Tag einen Block mit
--     zeitraum_bis = geschaeftstag. Der Lader loescht je Abruf die Tage
--     von..bis des Betriebs und schreibt sie neu — ein Teilmonat 1.–20.
--     ersetzt den Teilmonat 1.–19., der Vollmonat ersetzt beide. Keine Zeile
--     steht doppelt (Test in src/sync/betriebsbericht.test.ts).
--   * core.betriebsbericht_abruf: der Lader loescht jede Abrufzeile, deren
--     Zeitraum der neue Abruf ganz enthaelt — es steht immer nur die
--     juengste Teilmonatszeile da, und der Vollmonat ersetzt sie.
--   * mart.betriebsbericht_luecke: fragt 97 erst ab Monatsende + 9 Tagen
--     (einheit_bis), und ein vorlaeufiger Abruf deckt die Tage ab — kein
--     Fehlalarm, keine Doppelmeldung.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. core.betriebsbericht_abruf.vorlaeufig
-- ---------------------------------------------------------------------

ALTER TABLE core.betriebsbericht_abruf
    ADD COLUMN IF NOT EXISTS vorlaeufig boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN core.betriebsbericht_abruf.vorlaeufig IS
'true = zum Zeitpunkt des (letzten) Abrufs war der Zeitraum noch nicht reif: sein Ende lag
weniger als BETRIEBSBERICHT_REIFE_TAGE (7) vor dem Geschaeftstag des Abrufs. LINA fuellt einen
Tag erst nach fuenf bis sieben Tagen — die letzten Tage eines solchen Abrufs koennen noch wachsen.
Entsteht beim laufenden Monat von 97 (0120). Folgen: die Gegenprobe prueft ihn nicht
(befund vorlaeufig), der Ladestand zaehlt den Monat als teilweise, und
betriebsberichteNachfuellen() holt ihn jede Nacht neu, bis ein Abruf nach der Reife ihn
endgueltig macht (false).';

-- Klein: je Bericht mit laufendem Monat hoechstens zwei Zeilen je Betrieb
-- (laufender Monat und, in den ersten Tagen, der Vormonat). Der Ladestand
-- und der Einreihweg lesen nur diese.
CREATE INDEX IF NOT EXISTS betriebsbericht_abruf_vorlaeufig_idx
    ON core.betriebsbericht_abruf (endpunkt, zeitraum_von)
 WHERE vorlaeufig;

-- Vorhandene Zeilen nach derselben Regel. Der reguläre Erstabruf holt nie
-- vor der Reife; erwartet werden hier null Zeilen. Faende sich eine (ein
-- Handabruf), wird sie nachgezogen, statt als endgueltig zu gelten.
DO $$
DECLARE v integer;
BEGIN
    WITH z AS (
        UPDATE core.betriebsbericht_abruf
           SET vorlaeufig = true
         WHERE NOT vorlaeufig
           AND zuletzt_abgerufen_am < (zeitraum_bis + 7)::timestamptz
        RETURNING 1)
    SELECT count(*) INTO v FROM z;
    RAISE NOTICE '0120: % vorhandene Abrufzeilen als vorlaeufig markiert', v;
END $$;


-- ---------------------------------------------------------------------
-- 2. Gegenprobe: 'vorlaeufig' — Fassung aus 0119, nur dieser Zweig neu
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.betriebsbericht_gegenprobe AS
WITH v AS (
    SELECT a.endpunkt, a.bericht, a.betrieb_key, b.name AS betrieb,
           a.zeitraum_von, a.zeitraum_bis, a.abrufe, a.nachgeholt,
           a.erstmals_abgerufen_am, a.zuletzt_abgerufen_am, a.zeilen,
           a.n_bills,
           round(a.balance_brutto, 2) AS bericht_brutto,
           k.umsatz_brutto            AS konzern_brutto,
           k.rechnungen               AS konzern_rechnungen,
           k.tage                     AS konzern_tage,
           round(a.balance_brutto - k.umsatz_brutto, 2) AS abweichung_brutto,
           CASE
             -- 0120: ein vorlaeufiger Abruf (vor der Reife geholt, etwa der
             -- laufende Monat von 97) wird nicht gegen den Umsatzbericht
             -- gestellt — LINA fuellt die letzten Tage erst nach fuenf bis
             -- sieben Tagen, und eine "Abweichung" waere dort ein Fehlalarm.
             -- Geprueft wird der Abruf, der ihn nach der Reife ersetzt.
             WHEN a.vorlaeufig THEN 'vorlaeufig'
             WHEN coalesce(k.tage, 0) = 0 THEN 'ohne Konzernzahl'
             WHEN coalesce(a.n_bills, 0) = 0 AND coalesce(k.umsatz_brutto, 0) <> 0 THEN 'leer trotz Umsatz'
             -- Je Tag rundet der Umsatzbericht auf Cent; ueber einen Monat sind
             -- das bis zu 31 halbe Cent.
             WHEN abs(coalesce(a.balance_brutto, 0) - coalesce(k.umsatz_brutto, 0))
                  <= 0.01 * (a.zeitraum_bis - a.zeitraum_von + 1) THEN 'ok'
             ELSE 'abweichung'
           END AS befund
      FROM core.betriebsbericht_abruf a
      JOIN core.betrieb b ON b.betrieb_key = a.betrieb_key
      LEFT JOIN LATERAL (
           SELECT count(*)            AS tage,
                  sum(u.umsatz_brutto) AS umsatz_brutto,
                  sum(u.rechnungen)    AS rechnungen
             FROM core.umsatzbericht_tag u
            WHERE u.betrieb_key = a.betrieb_key
              AND u.geschaeftstag BETWEEN a.zeitraum_von AND a.zeitraum_bis
              AND u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL) k ON true
)
SELECT v.*,
       CASE
         WHEN v.befund IN ('ok', 'ohne Konzernzahl', 'vorlaeufig') THEN NULL
         WHEN v.nachgeholt >= 3 THEN 'aufgegeben'
         -- 0119: ein Bericht, den das Register ausdruecklich nicht erwartet
         -- (abgeschaltet wie 88, oder alle unter der Notbremse), wird nicht
         -- nachgeholt — betriebsberichteNachfuellen() reiht nur aktive ein.
         -- Ohne diesen Zweig stuende hier "faellig" fuer eine Arbeit, die
         -- niemand tut (harte Regel 10).
         WHEN EXISTS (SELECT 1 FROM sync.quelle q
                       WHERE q.endpunkt = v.endpunkt AND NOT q.erwartet) THEN 'abgeschaltet'
         -- Aelter als 60 Tage: LINA fuellt nicht mehr nach. Ein Abruf mehr
         -- bringt nichts, und die Historie vor ~2020 ist je Betrieb evtl.
         -- ganz leer (lina-api-inventar-1d.md, A6) — dreimal nachholen
         -- hiesse vierfache Kosten fuer eine bekannte Luecke.
         WHEN v.zeitraum_bis < current_date - 60 THEN 'historisch'
         WHEN v.zuletzt_abgerufen_am > now() - interval '7 days' THEN 'wartet'
         ELSE 'faellig'
       END AS nachholen
  FROM v;

COMMENT ON VIEW mart.betriebsbericht_gegenprobe IS
'Koernung: Betriebsbericht × Betrieb × Abrufzeitraum. Trifft LINAs eigene Summe
(balanceSumBrutto) den Konzern-Umsatzbericht desselben Betriebs und Zeitraums?

befund: ok | abweichung | leer trotz Umsatz (nBillsGesamt 0, der Umsatzbericht kennt Umsatz)
| ohne Konzernzahl (kein Umsatzbericht fuer den Zeitraum — dann ist nichts zu pruefen)
| vorlaeufig (0120: vor der Reife geholt, etwa der laufende Monat von 97 — nicht geprueft,
weil LINA die letzten Tage noch fuellt; geprueft wird der Abruf, der ihn nach der Reife ersetzt).
nachholen: faellig (wird von betriebsberichteNachfuellen() erneut eingereiht, hoechstens
dreimal, frühestens eine Woche nach dem letzten Abruf) | wartet | aufgegeben | abgeschaltet
(der Bericht wird nicht mehr geholt — sync.quelle.erwartet = false, etwa 88 seit 23.09.2026
oder alle unter der Notbremse; es wird nichts nachgeholt) | historisch (aelter als 60 Tage:
nicht mehr nachgeholt, sichtbar bleibt es trotzdem).

Anlass: der falsche Endpunkt lieferte zwei Monate lang leere Gerueste mit plausibler
Groesse (fehlerkatalog.md, 22.09.2026). Eine Antwort beweist nichts, ihre Summe schon.
Wer die Sicht ueber viele Monate liest, filtert zeitraum_bis — sonst rechnet sie jeden
Abruf seit 2018 gegen den Umsatzbericht.';


-- ---------------------------------------------------------------------
-- 3. Ladestand: ein vorlaeufiger Monat ist 'teilweise'
--
-- In der Sicht und nicht in der materialisierten Basis: vorlaeufig
-- wechselt jede Nacht, und die Basis wird erst in Phase B aufgefrischt —
-- nach genau den Posten, die den Zustand aendern. Live gelesen stimmt es
-- sofort. Der Teilindex aus Abschnitt 1 haelt das billig (hoechstens ein
-- paar hundert Zeilen). Spalten in der Reihenfolge aus 0117/0119, die neue
-- am Ende (CREATE OR REPLACE VIEW kann nur anhaengen).
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.betriebsbericht_ladestand_monat AS
WITH v AS (
    SELECT a.endpunkt, m.monat::date AS monat, count(DISTINCT a.betrieb_key)::int AS betriebe
      FROM core.betriebsbericht_abruf a
      CROSS JOIN LATERAL generate_series(date_trunc('month', a.zeitraum_von),
                                         date_trunc('month', a.zeitraum_bis),
                                         interval '1 month') AS m(monat)
     WHERE a.vorlaeufig
     GROUP BY 1, 2
)
SELECT b.endpunkt,
       b.bericht,
       b.bezeichnung,
       b.fensterklasse,
       b.monat,
       b.betriebe_mit_umsatz,
       b.betriebe_geladen,
       b.betriebe_leer,
       b.betrieb_tage_mit_umsatz,
       b.betrieb_tage_abgedeckt,
       CASE WHEN coalesce(v.betriebe, 0) > 0 AND b.zustand = 'vollstaendig' THEN 'teilweise'
            ELSE b.zustand END                        AS zustand,
       b.sichten,
       coalesce(v.betriebe, 0)                        AS betriebe_vorlaeufig
  FROM mart.betriebsbericht_ladestand_basis b
  LEFT JOIN v ON v.endpunkt = b.endpunkt AND v.monat = b.monat
 WHERE b.endpunkt <> 'getReport:88';

COMMENT ON VIEW mart.betriebsbericht_ladestand_monat IS
'Koernung: Betriebsbericht × Monat seit Januar 2018 (materialisiert in
mart.betriebsbericht_ladestand_basis, Stand des letzten Laufs). Wie viel von einem Monat ist fuer diesen
Bericht geladen — gemessen an den Betrieben bzw. Betrieb-Tagen mit Umsatz (Umsatzbericht, nur
reife Tage: aelter als 9 Tage). Tagesberichte (T, W) zaehlen Betrieb-Tage, Monatsberichte (M,
M-Tag) Betriebe. Ein Abruf mit null Zeilen zaehlt als geladen, ebenso ein Posten, fuer den LINA
"keine Daten" gemeldet hat (betriebe_leer).

zustand: vollstaendig | teilweise | nicht geladen | kein Umsatz. "nicht geladen" ist der Fall,
um den es geht: eine Auswertung ueber diesen Monat liefert dann KEINE Zeile, und das heisst
nicht null. sichten nennt die mart-Sichten, die aus dem Bericht lesen.

betriebe_vorlaeufig (0120): Betriebe, deren Abruf fuer diesen Monat vor der Reife geholt wurde
(laufender Monat von 97, bis zum Vortag). Solange es sie gibt, ist der Monat "teilweise" — live
gelesen, nicht aus der Materialisierung: die letzten Tage koennen noch wachsen.

Bericht 88 (Finanzwege) steht seit 0119 NICHT hier: abgeschaltet am 23.09.2026, die
Finanzwegsichten lesen aus 97 (Tagesabschluss) — dessen Zeile ist der Stand der Finanzwege.';


-- ---------------------------------------------------------------------
-- 4. Beschreibungen: die Finanzwege kommen jede Nacht bis zum Vortag
-- ---------------------------------------------------------------------

COMMENT ON VIEW mart.finanzweg_tag IS
'Koernung: Betrieb × Tag × Finanzweg — aus GENAU EINER Quelle je Betrieb und Tag: Bericht 97
(Tagesabschluss), wo es ihn gibt, sonst 88 (quelle_bericht). 97 ist seit dem 23.09.2026 die
EINZIGE laufende Quelle; 88 ist abgeschaltet und steht nur noch fuer Tage, die bis dahin geladen
wurden und fuer die 97 fehlt. Der laufende Monat kommt jede Nacht bis zum Vortag (0120) — die
letzten sieben Tage sind VORLAEUFIG, LINA fuellt sie noch; endgueltig ist ein Monat, wenn
mart.betriebsbericht_ladestand_monat fuer Bericht 97 "vollstaendig" sagt. core.finanzweg_tag
fuehrt beide Quellen, und eine Summe darueber waere doppelt (0114, gemessen auf den Cent
gleich). Ein Mehrtagesabruf von 88 (tage > 1) steht nur da, wo der Betrieb im Zeitraum keinen
Tageswert hat.

betrag: Zahlungen und Nachlaesse POSITIV (LINA fuehrt sie negativ). Die Zahlarten eines Tages
summieren sich zum Bruttoumsatz — Trinkgeld und Rueckgeld stehen dabei negativ, weil sie in den
Zahlbetraegen darueber enthalten sind (Wilma Wunder Duesseldorf, August 2026: 369.841,09 EUR,
nachgerechnet am 23.09.2026). Umsatzzeilen (Boniert, Sofortstorno, Storno) behalten LINAs
Vorzeichen.

anzahl_vorgaenge zaehlt VORGAENGE (50 % Gluecksrad: 600 in Duesseldorf), nicht Artikel — der
Rabattbericht zaehlt fuer denselben Finanzweg 712 Artikel. Nie gegen mart.artikel_nachlass_*
addieren. Eine Aktion buendelt man ueber aktion + prozentsatz, nicht ueber die Nummer.';

COMMENT ON VIEW mart.artikel_nachlass_tag IS
'Koernung: Betrieb × Abrufzeitraum × Finanzweg × Artikel aus dem Rabattbericht (92). Im
Regelbetrieb ist der Abrufzeitraum EIN TAG (tage = 1). Ein Mehrtagesabruf (tage > 1) steht nur
da, wo es fuer diesen Betrieb im Zeitraum keinen Tagesabruf gibt. Fuer einen Zeitraum von..bis
also filtern: geschaeftstag >= von AND zeitraum_bis <= bis (und geschaeftstag <= bis, damit
Postgres nur die betroffenen Monate liest).

menge ist die Zahl der ARTIKEL auf Bons, auf die dieser Nachlass gebucht wurde — NICHT die
Verkaufsmenge und NICHT die Zahl der Nachlass-Vorgaenge. Der Nachlass gilt fuer den ganzen Bon:
im August 2026 trugen 327 verschiedene Artikel einen Gluecksrad-Nachlass, auch Getraenke.
nachlass_brutto/-netto sind der GEWAEHRTE Nachlass, positiv (LINA fuehrt ihn negativ).

Nur Zeilen MIT Artikelnamen: 28 von 8.533 Zeilen im August 2026 trugen keinen Namen, wohl aber
einen Betrag — die Gluecksrad-Auswertung vom 22.09.2026 zaehlt sie nicht mit, diese Sicht auch
nicht. Den vollstaendigen Nachlassbetrag je Finanzweg fuehrt mart.finanzweg_tag (aus 97).

Eine Aktion buendelt man ueber aktion und prozentsatz, nie ueber finanzweg_nummer: zwei Wege
heissen "25 % Gluecksrad" (3501, 3168), und die Nummer ist NULL, solange der Tagesabschluss (97)
fuer den Tag fehlt — 97 kommt seit 0120 jede Nacht bis zum Vortag, die Nummer fehlt also
hoechstens fuer die juengsten Tage. artikel_key/artikelnummer sind ueber den NAMEN zugeordnet
(92 liefert keine Nummer), nur bei genau einem Treffer im selben Betrieb und Zeitraum; die
Luecken zeigt mart.rabatt_artikel_unaufgeloest.';

UPDATE mcp.fallstrick
   SET hinweis = replace(hinweis,
         'die Nummer im Rabattbericht NULL, solange der Tagesabschluss (97) fuer den Tag fehlt — '
         'fuer den laufenden Monat bis etwa zum 7. des Folgemonats (88 ist seit 23.09.2026 abgeschaltet).',
         'die Nummer im Rabattbericht NULL, solange der Tagesabschluss (97) fuer den Tag fehlt — '
         '97 kommt jede Nacht bis zum Vortag, es fehlen also hoechstens die juengsten Tage.')
 WHERE schluessel IN ('nachlass_nummernliste_tag', 'nachlass_nummernliste_monat');

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM mcp.fallstrick
                WHERE schluessel IN ('nachlass_nummernliste_tag', 'nachlass_nummernliste_monat')
                  AND hinweis LIKE '%7. des Folgemonats%') THEN
        RAISE EXCEPTION '0120: Fallstricktext nennt noch "7. des Folgemonats" — Ersetzung griff nicht';
    END IF;
END $$;

-- Die neue Spalte in den Katalog (0110: Pflicht fuer jede mart-Aenderung).
SELECT mcp.achsen_ableiten();
