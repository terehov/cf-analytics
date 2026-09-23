-- =====================================================================
-- 0119 Bericht 88 (Finanzwege) ist abgeschaltet — die Finanzwege kommen
--      nur noch aus 97 (Tagesabschluss, Monatsaufruf mit interval=3)
--
-- ENTSCHEIDUNG Eugene, 23.09.2026, woertlich: "Wenn du dir sicher bist, dass
-- 97 die Werte genauso liefert, dann schalte 88 ganz ab."
--
-- DER NACHWEIS (docs/lina-api-inventar-1d.md, Nachtrag 23.09.2026), drei
-- Stichproben ueber /intranet/storeanalytics/getReport?...&laden=:
--   Wilma Wunder Duesseldorf, August 2026    88 Monat gegen Summe der 31 Tagesbloecke
--                                            von 97: 34 von 34 Finanzwegen gleich in
--                                            Nummer, Name, Gruppe, Umsatz, Anzahl
--   Markt Mainz, 15.08.2026                  88 Tagesaufruf gegen den Block 15.08. aus
--                                            dem Monatsaufruf 97: 25 von 25 gleich
--   Wilma Wunder Duesseldorf, Januar 2019    88 Monat gegen 30 Tagesbloecke 97: 22 von
--                                            22 gleich, balanceSumBrutto 315.456,17 —
--                                            97 reicht mindestens bis 2019 zurueck
-- Ersparnis: rund 153.000 Aufrufe Historie (am Klon 153.363) plus die
-- laufenden Tagesaufrufe.
--
-- WAS DIESE MIGRATION TUT — und was nicht:
--   1. ergebnis 'abgeschaltet' fuer sync.warteschlange. Nicht 'aufgegeben':
--      das wird wiederbelebt und steht in mart.posten_aufgegeben. Nicht
--      loeschen: der Posten ist eine Aussage ("war eingereiht, wurde
--      bewusst nicht geholt"), und core.betriebsbericht_abruf/sync.aufgabe
--      sagen, was vorher geholt wurde.
--   2. Die offenen, nicht in Arbeit befindlichen 88-Posten und die
--      aufgegebenen werden damit geschlossen. Danach haelt es
--      abgeschalteteBetriebsberichteSchliessen() (src/sync/nachfuellen.ts)
--      bei jedem Lauf so — auch fuer einen Posten, der gerade in Arbeit war.
--   3. sync.quelle fuehrt 88 als erwartet = false mit Begruendung. Das
--      schreibt auch quellenSpiegeln() beim naechsten Lauf; hier steht es,
--      damit die Pruefsichten ab der Migration stimmen und nicht erst ab
--      der naechsten Nacht.
--   4. mart.betriebsbericht_gegenprobe kennt 'abgeschaltet' (statt ewig
--      'faellig'), mart.betriebsbericht_ladestand* zeigen 88 nicht mehr —
--      die Finanzwegsichten lesen fuer jeden neuen Tag aus 97, und ein
--      Satz "Bericht 88: 100 Monate nicht geladen" an jeder MCP-Antwort
--      waere falsch.
--   NICHT angefasst:
--   * raw und core. Der Lader fuer 88 bleibt, der Registereintrag auch
--     (aktiv: false): core muss aus raw neu aufbaubar sein (harte Regel 4).
--   * mart.finanzweg_tag. Sie nimmt je Betrieb und Tag 97, wo es ihn gibt,
--     sonst 88 — die bis heute geladenen 88-Tage bleiben Rueckfall, eine
--     Doppelzaehlung entsteht nicht (je Betrieb und Tag genau eine Quelle,
--     unveraendert seit 0117).
--   * mart.finanzweg_88_97_abgleich. Sie vergleicht weiter die Tage, fuer
--     die beide geladen sind; ihre Pruefzeile in mart.pruefung_uebersicht
--     laeuft mit dem 60-Tage-Fenster von selbst aus.
--
-- FOLGE, die man kennen muss: 97 ist ein Monatsbericht (Klasse M-Tag). Die
-- Finanzwege eines Monats stehen damit erst ab Monatsende + 7 Tagen
-- (BETRIEBSBERICHT_REIFE_TAGE) da, nicht mehr sieben Tage nach jedem Tag.
-- Bis dahin traegt auch der Rabattbericht (92) keine Finanzwegnummer.
-- Siehe docs/entscheidungen.md, 23.09.2026.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Ergebnis 'abgeschaltet'
-- ---------------------------------------------------------------------

ALTER TABLE sync.warteschlange DROP CONSTRAINT IF EXISTS warteschlange_ergebnis_check;
ALTER TABLE sync.warteschlange
    ADD CONSTRAINT warteschlange_ergebnis_check
    CHECK (ergebnis IN ('ok','keine_daten','aufgegeben','kein_zugriff','fenster_zu_gross',
                        'abgeschaltet'));

COMMENT ON COLUMN sync.warteschlange.ergebnis IS
'keine_daten ist ein NORMALZUSTAND, kein Fehler: LINA antwortet mit HTTP 500 und
leerem Body, wenn ein Betrieb fuer diesen Bericht keine Daten hat.
kein_zugriff (0075): die Quelle verweigert dauerhaft (403), waehrend derselbe
Endpunkt sonst antwortet.
fenster_zu_gross (0113): ein Betriebsbericht ueber mehrere Tage lief in 504 oder in
unser Zeitlimit; der Worker hat ihn in zwei halbe Posten geteilt. Der alte Posten ist
damit beantwortet und wird nicht wiederbelebt.
abgeschaltet (0119): der Posten wurde NICHT geholt, weil sein Bericht abgeschaltet ist
(Register: aktiv = false; erstmals Bericht 88 am 23.09.2026). Geschlossen von der
Migration bzw. von abgeschalteteBetriebsberichteSchliessen(); wird nicht wiederbelebt.';


-- ---------------------------------------------------------------------
-- 2. Die offenen und die aufgegebenen 88-Posten schliessen
--
-- In Arbeit befindliche bleiben stehen: den Posten schliesst der Worker,
-- der ihn gerade haelt. Wird er nach einem Abbruch freigegeben, schliesst
-- ihn der naechste Lauf (src/sync/nachfuellen.ts).
-- ---------------------------------------------------------------------

DO $$
DECLARE
    v_offen      integer;
    v_aufgegeben integer;
    v_in_arbeit  integer;
BEGIN
    WITH z AS (
        UPDATE sync.warteschlange
           SET erledigt_am = now(), ergebnis = 'abgeschaltet'
         WHERE endpunkt = 'getReport:88'
           AND erledigt_am IS NULL AND in_arbeit_seit IS NULL
        RETURNING 1)
    SELECT count(*) INTO v_offen FROM z;

    -- Aufgegebene wuerden sonst wiederbelebt, solange 88 in den letzten
    -- 24 Stunden ein 'ok' hatte — also genau in der ersten Nacht danach.
    -- letzter_fehler bleibt stehen: er sagt, woran der Posten scheiterte.
    WITH z AS (
        UPDATE sync.warteschlange
           SET ergebnis = 'abgeschaltet'
         WHERE endpunkt = 'getReport:88' AND ergebnis = 'aufgegeben'
        RETURNING 1)
    SELECT count(*) INTO v_aufgegeben FROM z;

    SELECT count(*) INTO v_in_arbeit FROM sync.warteschlange
     WHERE endpunkt = 'getReport:88' AND erledigt_am IS NULL;

    RAISE NOTICE '0119: % offene und % aufgegebene 88-Posten als abgeschaltet geschlossen, % in Arbeit belassen',
        v_offen, v_aufgegeben, v_in_arbeit;
END $$;


-- ---------------------------------------------------------------------
-- 3. sync.quelle: abgeschaltet, nicht stumm (harte Regel 10)
--
-- Wortgleich mit src/sync/quellen.ts — quellenSpiegeln() ueberschreibt die
-- Zeile ohnehin bei jedem Lauf. Fehlt sie (leere Datenbank), legt der
-- naechste Lauf sie an.
-- ---------------------------------------------------------------------

UPDATE sync.quelle
   SET erwartet = false,
       bemerkung = 'Abgeschaltet 23.09.2026 (Entscheidung Eugene): die Finanzwege kommen nur noch aus '
                || 'Bericht 97 (Tagesabschluss), der dieselbe Tabelle je Tag liefert. Bereits geladene '
                || '88-Tage bleiben als Rueckfall in mart.finanzweg_tag (entscheidungen.md, 23.09.2026).'
 WHERE quelle = 'getReport:88';


-- ---------------------------------------------------------------------
-- 4. Die Pruefsichten
-- ---------------------------------------------------------------------

-- 4a. Gegenprobe: 'abgeschaltet' statt 'faellig'. Fassung aus 0114, nur der
--     eine Zweig ist neu; Spalten unveraendert.
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
         WHEN v.befund IN ('ok', 'ohne Konzernzahl') THEN NULL
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
| ohne Konzernzahl (kein Umsatzbericht fuer den Zeitraum — dann ist nichts zu pruefen).
nachholen: faellig (wird von betriebsberichteNachfuellen() erneut eingereiht, hoechstens
dreimal, frühestens eine Woche nach dem letzten Abruf) | wartet | aufgegeben | abgeschaltet
(der Bericht wird nicht mehr geholt — sync.quelle.erwartet = false, etwa 88 seit 23.09.2026
oder alle unter der Notbremse; es wird nichts nachgeholt) | historisch (aelter als 60 Tage:
nicht mehr nachgeholt, sichtbar bleibt es trotzdem).

Anlass: der falsche Endpunkt lieferte zwei Monate lang leere Gerueste mit plausibler
Groesse (fehlerkatalog.md, 22.09.2026). Eine Antwort beweist nichts, ihre Summe schon.
Wer die Sicht ueber viele Monate liest, filtert zeitraum_bis — sonst rechnet sie jeden
Abruf seit 2018 gegen den Umsatzbericht.';


-- 4b. Ladestand ohne 88. mart.betriebsbericht_luecke braucht nichts: sie
--     liest nur Berichte mit sync.quelle.erwartet (0114), und das ist 88 ab
--     Abschnitt 3 nicht mehr.
--
--     Die Basis (materialisiert, 0117) nimmt jeden Bericht auf, der je
--     geladen wurde — mit Absicht, damit ein Bericht ohne Registereintrag
--     nicht still verschwindet. Fuer 88 ist das hier falsch: seine Sichten
--     (finanzweg_tag, _monat, nachlass_monat, zahlart_monat) lesen jeden
--     neuen Tag aus 97, und der Satz "Bericht 88: ... Monate nicht geladen",
--     den der MCP-Server an jede Antwort auf diese Sichten haengt, beschriebe
--     eine Luecke, die keine ist. Der Stand von 97 ist der, der zaehlt.
--
--     Ausgeschlossen wird ausdruecklich 88 und nicht "alles mit
--     erwartet = false": unter der Notbremse (BETRIEBSBERICHT_JE_LAUF = 0)
--     steht JEDER Bericht auf nicht erwartet, und gerade dann muss der
--     Ladestand sagen, was fehlt. Die Basis bleibt unveraendert — kein
--     DROP der Materialisierung, kein Refresh noetig.
CREATE OR REPLACE VIEW mart.betriebsbericht_ladestand_monat AS
SELECT *
  FROM mart.betriebsbericht_ladestand_basis
 WHERE endpunkt <> 'getReport:88';

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

Bericht 88 (Finanzwege) steht seit 0119 NICHT hier: abgeschaltet am 23.09.2026, die
Finanzwegsichten lesen aus 97 (Tagesabschluss) — dessen Zeile ist der Stand der Finanzwege.';


-- ---------------------------------------------------------------------
-- 5. Beschreibungen, die 88 als laufende Quelle darstellten
--
-- Nur Kommentare und Katalogtexte; keine Sicht aendert ihre Rechnung.
-- ---------------------------------------------------------------------

COMMENT ON VIEW mart.finanzweg_tag IS
'Koernung: Betrieb × Tag × Finanzweg — aus GENAU EINER Quelle je Betrieb und Tag: Bericht 97
(Tagesabschluss), wo es ihn gibt, sonst 88 (quelle_bericht). 97 ist seit dem 23.09.2026 die
EINZIGE laufende Quelle; 88 ist abgeschaltet und steht nur noch fuer Tage, die bis dahin geladen
wurden und fuer die 97 fehlt. 97 ist ein Monatsbericht: ein Monat steht erst ab etwa dem 7. des
Folgemonats da (mart.betriebsbericht_ladestand, Bericht 97). core.finanzweg_tag fuehrt beide
Quellen, und eine Summe darueber waere doppelt (0114, gemessen auf den Cent gleich). Ein
Mehrtagesabruf von 88 (tage > 1) steht nur da, wo der Betrieb im Zeitraum keinen Tageswert hat.

betrag: Zahlungen und Nachlaesse POSITIV (LINA fuehrt sie negativ). Die Zahlarten eines Tages
summieren sich zum Bruttoumsatz — Trinkgeld und Rueckgeld stehen dabei negativ, weil sie in den
Zahlbetraegen darueber enthalten sind (Wilma Wunder Duesseldorf, August 2026: 369.841,09 EUR,
nachgerechnet am 23.09.2026). Umsatzzeilen (Boniert, Sofortstorno, Storno) behalten LINAs
Vorzeichen.

anzahl_vorgaenge zaehlt VORGAENGE (50 % Gluecksrad: 600 in Duesseldorf), nicht Artikel — der
Rabattbericht zaehlt fuer denselben Finanzweg 712 Artikel. Nie gegen mart.artikel_nachlass_*
addieren. Eine Aktion buendelt man ueber aktion + prozentsatz, nicht ueber die Nummer.';

COMMENT ON VIEW mart.finanzweg_88_97_abgleich IS
'Koernung: Betrieb × Tag × Finanzweg — nur Tage, fuer die BEIDE Quellen geladen sind.
Bericht 88 (ein Tagesaufruf je Betrieb-Tag, 152.840 Aufrufe Historie) und Bericht 97 (je Tag
derselbe Finanzwegblock aus EINEM Monatsaufruf, 5.115 Aufrufe) liefern dieselben Zahlen —
gemessen an drei Stichproben (Wilma Wunder Duesseldorf August 2026 und Januar 2019, Markt Mainz
15.08.2026), jede auf den Cent gleich. Deshalb ist 88 seit dem 23.09.2026 ABGESCHALTET (0119):
die Sicht vergleicht nur noch die bis dahin geladenen 88-Tage und waechst nicht mehr.
ERWARTUNG: kein "weicht ab".';

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
fuer den Tag fehlt — seit 88 abgeschaltet ist (23.09.2026), also fuer den laufenden Monat bis etwa
zum 7. des Folgemonats. artikel_key/artikelnummer sind ueber den NAMEN zugeordnet (92 liefert
keine Nummer), nur bei genau einem Treffer im selben Betrieb und Zeitraum; die Luecken zeigt
mart.rabatt_artikel_unaufgeloest.';

UPDATE mcp.sicht SET koernung = 'Betrieb × Tag × Finanzweg — je Tag EINE Quelle (97; 88 nur fuer bis 23.09.2026 geladene Tage ohne 97)'
 WHERE sicht = 'mart.finanzweg_tag';
UPDATE mcp.sicht SET koernung = 'Betrieb × Tag × Finanzweg — Bericht 88 gegen 97, nur bis 23.09.2026 geladene 88-Tage (88 abgeschaltet); ERWARTUNG: kein weicht ab'
 WHERE sicht = 'mart.finanzweg_88_97_abgleich';

UPDATE mcp.fallstrick
   SET hinweis = replace(hinweis,
         'die Nummer im Rabattbericht NULL, solange 88/97 fuer den Tag fehlt.',
         'die Nummer im Rabattbericht NULL, solange der Tagesabschluss (97) fuer den Tag fehlt — '
         'fuer den laufenden Monat bis etwa zum 7. des Folgemonats (88 ist seit 23.09.2026 abgeschaltet).')
 WHERE schluessel IN ('nachlass_nummernliste_tag', 'nachlass_nummernliste_monat');

UPDATE mcp.fallstrick
   SET hinweis = replace(hinweis,
         'Der Rabattbericht (92) zaehlt ARTIKEL auf Nachlass-Bons, 88/97 zaehlen VORGAENGE',
         'Der Rabattbericht (92) zaehlt ARTIKEL auf Nachlass-Bons, die Finanzwege (97, frueher 88) '
         'zaehlen VORGAENGE')
 WHERE schluessel = 'artikel_gegen_vorgaenge';

UPDATE mcp.fallstrick
   SET hinweis = 'Pruefsicht: dieselbe Finanzwegzahl aus ZWEI Berichten (88 und 97) nebeneinander — '
                 'nur fuer die bis 23.09.2026 geladenen 88-Tage, 88 ist seitdem abgeschaltet. Wer '
                 'daraus summiert, zaehlt doppelt.'
 WHERE schluessel = 'finanzweg_88_97_pruefsicht';

-- Greifen die Ersetzungen nicht (Text inzwischen anders), soll die Migration
-- es sagen, statt still nichts zu tun.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM mcp.fallstrick
                WHERE schluessel IN ('nachlass_nummernliste_tag', 'nachlass_nummernliste_monat',
                                     'artikel_gegen_vorgaenge')
                  AND hinweis LIKE '%88/97%') THEN
        RAISE EXCEPTION '0119: ein Fallstricktext nennt 88/97 noch als laufende Quelle — Ersetzung griff nicht';
    END IF;
END $$;
