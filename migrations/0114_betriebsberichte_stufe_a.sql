-- =====================================================================
-- 0114 Betriebsberichte, Stufe A: Rabatt (92), Finanzwege (88), Bons (96),
--      Tagesabschluss (97) — und die Gegenprobe, die entscheidet, ob ein
--      Bericht als geladen gilt (docs/plan-lina-vollabzug.md, 4 und 5.3)
--
-- WARUM DIE GEGENPROBE VOR JEDER TABELLE STEHT. Zwei Monate lang lief der
-- Betriebsbericht-Endpunkt ueber einen Weg, der fuer jeden Betrieb leere
-- Geruese liefert — mit 200, mit plausibler Groesse (byte-gleich 65.830
-- Byte fuer zwei Betriebe und zwei Monate), und als "geloest" gefuehrt
-- (fehlerkatalog.md, 22.09.2026). Eine Antwort beweist nichts ueber ihren
-- Inhalt. Was sie beweist, ist LINAs eigene Summe: balanceSumBrutto muss
-- den Konzern-Umsatzbericht desselben Betriebs und Zeitraums treffen
-- (Wilma Wunder Duesseldorf, August 2026: 369.841,09 = 369.841,09).
-- core.betriebsbericht_abruf haelt je Abruf diese Summe fest,
-- mart.betriebsbericht_gegenprobe vergleicht.
--
-- ZEITRAEUME. Jede Tabelle ist nach dem Tag partitioniert, zu dem ihre
-- Zeilen gehoeren. Berichte der Klasse T (92, 88) tragen KEIN Datum je
-- Zeile — ihr Tag ist der Abrufzeitraum: geschaeftstag = zeitraum_von,
-- dazu zeitraum_bis. Im Regelbetrieb sind beide gleich (ein Tag je
-- Posten). Ein Abruf ueber mehrere Tage (Abnahme M1 mit einem Monat,
-- Handabruf) steht mit zeitraum_bis > geschaeftstag in derselben Tabelle —
-- wer Tage summiert, filtert zeitraum_bis = geschaeftstag.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Je Abruf: LINAs eigene Summen — die Gegenprobe
-- ---------------------------------------------------------------------

CREATE TABLE core.betriebsbericht_abruf (
    endpunkt        text    NOT NULL,
    bericht         integer NOT NULL,
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    zeitraum_von    date    NOT NULL,
    zeitraum_bis    date    NOT NULL,
    n_bills         integer,
    balance_brutto  numeric(16,4),
    balance_netto   numeric(16,4),
    zeilen          integer,
    hinweis         text,
    abrufe          integer NOT NULL DEFAULT 1,
    nachgeholt      integer NOT NULL DEFAULT 0,
    erstmals_abgerufen_am timestamptz NOT NULL DEFAULT now(),
    zuletzt_abgerufen_am  timestamptz NOT NULL DEFAULT now(),
    raw_id          bigint,
    PRIMARY KEY (endpunkt, betrieb_key, zeitraum_von, zeitraum_bis)
);
CREATE INDEX ON core.betriebsbericht_abruf (zeitraum_bis);
CREATE INDEX ON core.betriebsbericht_abruf (betrieb_key, zeitraum_von);

COMMENT ON TABLE core.betriebsbericht_abruf IS
'Koernung: Betriebsbericht × Betrieb × Abrufzeitraum — eine Zeile je geholtem Zeitraum,
bei jedem erneuten Abruf fortgeschrieben (abrufe + 1).

Traegt LINAs eigene Summen aus der Huelle (nBillsGesamt, balanceSumBrutto/-Netto). Diese
sind fuer ALLE 72 Berichte gleich: die Bonzahl und der Umsatz des Betriebs im Zeitraum,
keine Summe ueber die Berichtszeilen. Genau deshalb taugen sie als Gegenprobe gegen
core.umsatzbericht_tag (mart.betriebsbericht_gegenprobe).

nachgeholt zaehlt, wie oft der Zeitraum wegen einer abweichenden Gegenprobe erneut
eingereiht wurde (hoechstens dreimal, wie die Nulltage aus 0100).
Geschrieben von src/sync/betriebsbericht_laden.ts, auch bei null Zeilen.';

COMMENT ON COLUMN core.betriebsbericht_abruf.zeilen IS
'Wie viele Zeilen der Lader nach core geschrieben hat. Ein Bericht darf legitim null Zeilen
haben (Storno ohne Stornos) — ob das stimmt, sagt n_bills gegen den Umsatzbericht.';


CREATE TABLE core.bericht_hinweis (
    endpunkt      text    NOT NULL,
    betrieb_key   integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    zeitraum_von  date    NOT NULL,
    zeitraum_bis  date    NOT NULL,
    hinweis       text    NOT NULL,
    erstmals_am   timestamptz NOT NULL DEFAULT now(),
    zuletzt_am    timestamptz NOT NULL DEFAULT now(),
    raw_id        bigint,
    PRIMARY KEY (endpunkt, betrieb_key, zeitraum_von, zeitraum_bis, hinweis)
);

COMMENT ON TABLE core.bericht_hinweis IS
'Koernung: Bericht × Betrieb × Zeitraum × Hinweistext. LINAs Feld "errors" in der Huelle der
Betriebsberichte — KEIN technischer Fehler, sondern ein fachlicher Hinweis aus LINA, z. B.
"Doppelte Artikelnummern, unbedingt korrigieren: " (Stornobericht, 25.07.2026,
lina-api-inventar-1b.md §1.3). Ein Datenqualitaetskanal, der sichtbar gehoert
(mart.bericht_hinweis), nicht in ein Log.';


-- ---------------------------------------------------------------------
-- 2. Finanzwege: Stamm, Namenshistorie, Tageswerte (88 und 97)
-- ---------------------------------------------------------------------

CREATE TABLE core.finanzweg (
    nummer           integer PRIMARY KEY,
    name             text    NOT NULL,
    finanzgruppe     text,
    art              text,
    prozentsatz      numeric(5,2),
    erstmals_gesehen date    NOT NULL,
    zuletzt_gesehen  date    NOT NULL
);

COMMENT ON TABLE core.finanzweg IS
'Koernung: ein Finanzweg (LINAs Nummer). Der Stamm entsteht AUS DEN BERICHTEN 88 und 97 —
es gibt keine Stammdatenquelle: /wawi/badata/fintyp fuehrt 34 System-Finanzwege (-10 bis 91),
die vierstelligen (3168, 3500-3502, 2700 …) stehen dort nicht (lina-api-inventar-1d.md).
Deshalb erstmals_gesehen/zuletzt_gesehen statt gueltig_ab, beides nach DATENSTAND (Tag der
Zeile), nicht nach Abrufzeit — der Backfill laeuft rueckwaerts.

DIE ZUORDNUNG "IST GLUECKSRAD" LAEUFT UEBER DEN NAMEN, NIE UEBER EINE NUMMERNLISTE. Es gibt
zwei Finanzwege "25 % Gluecksrad": 3501 (mit Apostroph im Namen) und 3168 (ohne). Wilma
Wunder Duesseldorf, August 2026: 31 Vorgaenge ueber 3168, 66 ueber 3501 — wer nach
3500/3501/3502 filtert, verliert 31 still.';
COMMENT ON COLUMN core.finanzweg.name IS
'Der Name im juengsten Datenstand. Fruehere Namen stehen in core.finanzweg_stand.';
COMMENT ON COLUMN core.finanzweg.art IS
'ABGELEITET aus finanzgruppe, nicht von LINA: nachlass (Hausbon, Rabatt), zahlart (Unbar,
Bargeld, Gutschein, Auslagen, Unbarer Finanzweg), umsatz (Boniert, Storno), statistik
(Tischuebergabe).';
COMMENT ON COLUMN core.finanzweg.prozentsatz IS
'ABGELEITET aus dem Namen ("50% Gluecksrad" → 50). Ein Name ohne Prozentzahl ergibt NULL.
Prozentzahl, kein Bruch (harte Regel 6).';


CREATE TABLE core.finanzweg_stand (
    nummer        integer NOT NULL,
    monat         date    NOT NULL,
    name          text    NOT NULL,
    finanzgruppe  text    NOT NULL DEFAULT '',
    PRIMARY KEY (nummer, monat, name, finanzgruppe)
);

COMMENT ON TABLE core.finanzweg_stand IS
'Koernung: Finanzweg × Monat × Name × Finanzgruppe — append-only. Welche Namen eine Nummer
in welchem Monat trug. Mehrere Zeilen je Nummer und Monat heissen: verschiedene Betriebe
fuehren dieselbe Nummer unter verschiedenen Namen — dann taugt die Nummer allein nicht
als Schluessel.';


CREATE TABLE core.finanzweg_tag (
    geschaeftstag     date     NOT NULL,
    zeitraum_bis      date     NOT NULL,
    betrieb_key       integer  NOT NULL REFERENCES core.betrieb(betrieb_key),
    bericht           smallint NOT NULL CHECK (bericht IN (88, 97)),
    finanzweg_nummer  integer  NOT NULL,
    finanzweg_name    text     NOT NULL,
    finanzgruppe      text,
    abschnitt         text,
    umsatz            numeric(16,4),
    anzahl            numeric(14,3),
    raw_id            bigint,
    geladen_am        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (geschaeftstag, betrieb_key, bericht, zeitraum_bis, finanzweg_nummer)
) PARTITION BY RANGE (geschaeftstag);

COMMENT ON TABLE core.finanzweg_tag IS
'Koernung: Betrieb × Tag × Finanzweg × QUELLBERICHT. Aus Bericht 88 (Tagesaufruf) und aus
Bericht 97 (Tagesabschluss: je Tag derselbe Finanzwegblock aus einem Monatsaufruf).

ZWEI QUELLEN FUER DIESELBE ZAHL — WER SUMMIERT, WAEHLT EINE. Gemessen am 22.09.2026
(Wilma Wunder Duesseldorf, August): die Tagesbloecke von 97 summieren sich fuer alle 34
Finanzwege auf den Cent und die Anzahl genau zum Monatsaufruf von 88. sum() ueber beide
bericht-Werte zaehlt doppelt. mart.finanzweg_88_97_abgleich prueft, dass beide
uebereinstimmen.

anzahl zaehlt VORGAENGE (50 % Gluecksrad: 600), nicht Artikel — in 92 zaehlt dieselbe
Spalte Artikel (712). Nie ueber beide Berichte addieren.

umsatz ist LINAs Vorzeichen: Zahlungen und Nachlaesse negativ, Boniert positiv.
Abschnittskoepfe und Summenzeilen ("Gesamt Umsatz", "Summe Umsaetze - Zahlungen") sind
nicht geladen — sie lassen sich rechnen und wuerden jede Summe verdoppeln.
geschaeftstag = zeitraum_von bei 88; zeitraum_bis > geschaeftstag nur bei einem
Mehrtagesabruf (Abnahmetest, Handabruf).';
COMMENT ON COLUMN core.finanzweg_tag.abschnitt IS
'Abschnitt der LINA-Tabelle: Umsaetze, Zahlungswege, Rabatte, Sonstiges.';


-- ---------------------------------------------------------------------
-- 3. Nachlass je Artikel (92)
-- ---------------------------------------------------------------------

CREATE TABLE core.rabatt_artikel_tag (
    geschaeftstag     date    NOT NULL,
    zeitraum_bis      date    NOT NULL,
    betrieb_key       integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    zeile             integer NOT NULL,
    gruppe            integer NOT NULL,
    finanzweg_name    text    NOT NULL,
    finanzweg_nummer  integer,
    artikel_name      text,
    artikel_key       integer REFERENCES core.artikel(artikel_key),
    anzahl            numeric(14,3),
    brutto            numeric(16,4),
    netto             numeric(16,4),
    raw_id            bigint,
    geladen_am        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (geschaeftstag, betrieb_key, zeitraum_bis, zeile)
) PARTITION BY RANGE (geschaeftstag);

COMMENT ON TABLE core.rabatt_artikel_tag IS
'Koernung: Betrieb × Tag × Zeile des Rabattberichts (92) — je Finanzweg der Gruppen Hausbon
und Rabatt die Artikel, die ueber ihn liefen. Im Regelbetrieb EIN TAG je Abruf
(zeitraum_bis = geschaeftstag); Mehrtagesabrufe (Abnahme M1) stehen mit zeitraum_bis >
geschaeftstag und duerfen nicht mit Tageszeilen summiert werden.

DER NACHLASS GILT FUER DEN GANZEN BON. 327 verschiedene Artikel trugen im August 2026 bei
Wilma Wunder einen Gluecksrad-Nachlass, auch Getraenke. "Menge Durchstarter ueber 50 %
Gluecksrad" heisst also "Menge Durchstarter auf Bons mit 50-%-Nachlass" — Nachlassmenge,
nicht Verkaufsmenge.

brutto/netto sind der GEWAEHRTE NACHLASS (negativ), nicht der Verkaufspreis. Dieselbe
Kombination Finanzweg × Artikel kann mehrfach stehen (-3,50 und +3,50: gewaehrt und
zurueckgenommen); anzahl ist dabei beide Male positiv. Die Summe der anzahl ueber die
Artikelzeilen ist genau die Zahl der Auswertung vom 22.09.2026 (Gluecksrad August,
14 Betriebe: 10 % 149, 25 % 1.413, 50 % 7.335).

artikel_name kann NULL sein, und das ist echt: 28 von 8.505 Zeilen im August trugen keinen
Namen, wohl aber Anzahl und Betrag (die Gruppenkoepfe sind NICHT geladen — sie waeren die
Summe darunter). Die Auswertung vom 22.09.2026 zaehlt nur Zeilen MIT Namen.

Der Schluessel ist die laufende Zeile der Antwort; ein erneuter Abruf ersetzt den Zeitraum.';
COMMENT ON COLUMN core.rabatt_artikel_tag.gruppe IS
'Laufende Nummer des Gruppenkopfs in der Antwort. Zwei Gruppen koennen denselben
finanzweg_name tragen.';
COMMENT ON COLUMN core.rabatt_artikel_tag.finanzweg_nummer IS
'ABGELEITET: die Nummer aus 88/97 desselben Betriebs und Zeitraums mit genau diesem Namen.
NULL, solange 88/97 fuer den Tag fehlt oder der Name dort mehrdeutig ist. Nie nach einer
festen Nummernliste filtern — siehe core.finanzweg.';
COMMENT ON COLUMN core.rabatt_artikel_tag.artikel_key IS
'ABGELEITET ueber den NAMEN (core.artikel_name_norm), nur gegen Artikel, die dieser Betrieb im
selben Zeitraum verkauft hat, nur bei genau einem Treffer. 92 liefert keine Artikelnummer.
Die Aufloesungsquote steht in mart.rabatt_artikel_unaufgeloest — ohne sie ist sie ein
Geruecht (gemessen einmal: 50 von 51 Aktionsartikeln).';


-- ---------------------------------------------------------------------
-- 4. Bons (96)
-- ---------------------------------------------------------------------

CREATE TABLE core.bon (
    geschaeftstag     date    NOT NULL,
    betrieb_key       integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    laufnummer        integer NOT NULL,
    rechnungsnummer   bigint,
    art               text,
    anzahl_artikel    integer,
    finanzwege        text[]  NOT NULL DEFAULT '{}',
    brutto            numeric(14,2),
    debitor           text,
    debitor_anschrift text,
    raw_id            bigint,
    geladen_am        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (geschaeftstag, betrieb_key, laufnummer)
) PARTITION BY RANGE (geschaeftstag);

CREATE INDEX ON core.bon USING gin (finanzwege);

COMMENT ON TABLE core.bon IS
'Koernung: EIN BON (Rechnung, stornierte Rechnung oder Gutschrift) je Betrieb und Tag, aus dem
Rechnungsausgangsbuch (96). Entscheidung E2 (22.09.2026): je Bon, nicht als Tagesaggregat —
aus Bons folgt das Aggregat, umgekehrt nicht. Rund 30 Mio. Bons seit 2018.

WAS 96 NICHT KANN: keine Uhrzeit (Datum ist ein Tag), keine Artikelzeilen und KEINE
Nachlass-Finanzwege. finanzwege fuehrt nur Zahlarten, Trinkgeld und Tischuebergabe —
am 15.08.2026 zeigte 88 fuer Duesseldorf 32 Gluecksrad-Vorgaenge, in 96 trug keiner der 519
Bons "Gluecksrad". "Bons mit Aktion" oder "Durchschnittsbon mit vs. ohne Aktion" sind damit
NICHT beantwortbar.

laufnummer ist der Schluessel, nicht rechnungsnummer: am 15.08.2026 trugen neun Bons die
Nummer 0, und Gutschriften haben einen eigenen Nummernkreis. Die Summenzeile der Antwort
(ohne Datum) ist nicht geladen. Die Summe der Bons eines Abrufs trifft balanceSumBrutto
(15.08.2026: 519 Bons, 15.920,61 EUR).

Geholt in Sieben-Tage-Fenstern (Fensterklasse W): ein Monat laeuft in 504.';
COMMENT ON COLUMN core.bon.finanzwege IS
'LINAs kommagetrennte Liste als Array, z. B. {Trinkgeld,VISA}. Ohne Betraege je Zahlart —
die liefert 96 nicht. Die in LINA eingerutschte Spaltenbeschriftung ("Finanzwege" als
Wert, 20 von 519 Bons am 15.08.2026) ist als leere Liste geladen.';
COMMENT ON COLUMN core.bon.art IS 'Rechnung | Stornierte Rechnung | Gutschrift (LINA-Feld "Rechnung/Butschrift", sic).';


-- ---------------------------------------------------------------------
-- 5. Tagesabschluss (97): Hauptsparte × Steuersatz je Tag
-- ---------------------------------------------------------------------

CREATE TABLE core.tagesabschluss_tag (
    geschaeftstag  date    NOT NULL,
    betrieb_key    integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    hauptsparte    text    NOT NULL,
    steuersatz     text    NOT NULL,
    brutto         numeric(16,4),
    raw_id         bigint,
    geladen_am     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (geschaeftstag, betrieb_key, hauptsparte, steuersatz)
);

COMMENT ON TABLE core.tagesabschluss_tag IS
'Koernung: Betrieb × Tag × Hauptsparte × Steuersatz, aus dem Tagesabschluss (97) — ein
Monatsaufruf mit interval=3 liefert je Tag einen Block. Werte sind BRUTTO: ueber August
summiert genau balanceSumBrutto (Wilma Wunder Duesseldorf 369.841,09, gemessen 22.09.2026).
hauptsparte und steuersatz sind LINAs Texte ("Speisen", "19%_Mwst") — die Steuersatzspalten
wechseln je Betrieb. Nullzellen sind nicht geladen.

Der zweite Block je Tag (die Finanzwege) steht in core.finanzweg_tag mit bericht = 97.';


-- ---------------------------------------------------------------------
-- 6. Die Pruefsichten
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
dreimal, frühestens eine Woche nach dem letzten Abruf) | wartet | aufgegeben | historisch
(aelter als 60 Tage: nicht mehr nachgeholt, sichtbar bleibt es trotzdem).

Anlass: der falsche Endpunkt lieferte zwei Monate lang leere Gerueste mit plausibler
Groesse (fehlerkatalog.md, 22.09.2026). Eine Antwort beweist nichts, ihre Summe schon.
Wer die Sicht ueber viele Monate liest, filtert zeitraum_bis — sonst rechnet sie jeden
Abruf seit 2018 gegen den Umsatzbericht.';


CREATE OR REPLACE VIEW mart.betriebsbericht_luecke AS
WITH tage AS (
    SELECT u.betrieb_key, u.geschaeftstag
      FROM core.umsatzbericht_tag u
     WHERE u.geschaeftstag >= current_date - 60
       AND u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
       AND (coalesce(u.umsatz_netto, 0) <> 0 OR coalesce(u.rechnungen, 0) > 0)
    UNION
    -- Die Vereinigung, nicht der Umsatzbericht allein: ein Tag, den der
    -- Umsatzbericht nicht kennt, wuerde sonst nie gefragt (Plan 5.2 —
    -- der 22.07.2026 stand sieben Wochen bei allen Betrieben auf null).
    SELECT a.betrieb_key, a.geschaeftstag
      FROM core.artikelverkauf_tag a
     WHERE a.geschaeftstag >= current_date - 60
       AND (coalesce(a.umsatz_netto, 0) <> 0 OR coalesce(a.menge, 0) <> 0)
), berichte AS (
    SELECT q.endpunkt, q.fensterklasse
      FROM sync.quelle q
     WHERE q.endpunkt LIKE 'getReport:%' AND q.erwartet AND q.fensterklasse IS NOT NULL
), einheit AS (
    SELECT r.endpunkt, r.fensterklasse, t.betrieb_key, t.geschaeftstag,
           CASE r.fensterklasse
             WHEN 'T' THEN t.geschaeftstag
             WHEN 'W' THEN (date_trunc('week', t.geschaeftstag) + interval '6 days')::date
             ELSE (date_trunc('month', t.geschaeftstag) + interval '1 month - 1 day')::date
           END AS einheit_bis
      FROM tage t CROSS JOIN berichte r
)
SELECT e.endpunkt, e.fensterklasse, e.betrieb_key, b.name AS betrieb,
       e.geschaeftstag, e.einheit_bis,
       EXISTS (SELECT 1 FROM sync.warteschlange w
                WHERE w.endpunkt = e.endpunkt AND w.betrieb_enc_id = b.enc_id
                  AND w.erledigt_am IS NULL
                  AND e.geschaeftstag BETWEEN w.zeitraum_von AND w.zeitraum_bis) AS eingereiht
  FROM einheit e
  JOIN core.betrieb b ON b.betrieb_key = e.betrieb_key
 -- Reife: Erstabruf ab Tag + 7 (BETRIEBSBERICHT_REIFE_TAGE), dazu zwei Tage
 -- Luft fuer einen ausgefallenen Lauf.
 WHERE e.einheit_bis <= current_date - 9
   AND NOT EXISTS (SELECT 1 FROM core.betriebsbericht_abruf a
                    WHERE a.endpunkt = e.endpunkt AND a.betrieb_key = e.betrieb_key
                      AND e.geschaeftstag BETWEEN a.zeitraum_von AND a.zeitraum_bis);

COMMENT ON VIEW mart.betriebsbericht_luecke IS
'Koernung: Betriebsbericht × Betrieb × Tag. Betrieb-Tage mit Umsatz der letzten 60 Tage, deren
Zeitraum reif ist (Reife 7 Tage + 2 Tage Luft) und fuer die dieser Bericht NICHT geholt
wurde — die Regel-10-Zeile zum Import der Betriebsberichte.

ERWARTUNG: leer ab der zweiten Nacht. Der Einreihweg arbeitet neueste zuerst, also muss
der juengste reife Zeitraum jeder Nacht als erstes drankommen. Steht hier etwas, bekommen
die Betriebsberichte kein Budget (eingereiht = true) oder werden gar nicht mehr eingereiht
(eingereiht = false). Ein Abruf mit keine_daten (HTTP 500, leer) hinterlaesst keine
Abrufzeile und steht deshalb ebenfalls hier — fuer einen Betrieb MIT Umsatz ist das ein
Befund. Die Backfill-Historie aelter als 60 Tage zeigt mart.backfill_fortschritt.
Welche Berichte gemessen werden, steht in sync.quelle (fensterklasse, erwartet).';


CREATE OR REPLACE VIEW mart.finanzweg_88_97_abgleich AS
SELECT a.betrieb_key, b.name AS betrieb, a.geschaeftstag, a.finanzweg_nummer,
       a.finanzweg_name,
       a.umsatz AS umsatz_88, t.umsatz AS umsatz_97,
       a.anzahl AS anzahl_88, t.anzahl AS anzahl_97,
       CASE
         WHEN t.finanzweg_nummer IS NULL THEN 'nur 88'
         WHEN abs(coalesce(a.umsatz,0) - coalesce(t.umsatz,0)) > 0.01
           OR coalesce(a.anzahl,0) <> coalesce(t.anzahl,0) THEN 'weicht ab'
         ELSE 'gleich'
       END AS befund
  FROM core.finanzweg_tag a
  JOIN core.betrieb b ON b.betrieb_key = a.betrieb_key
  LEFT JOIN core.finanzweg_tag t
         ON t.bericht = 97 AND t.betrieb_key = a.betrieb_key
        AND t.geschaeftstag = a.geschaeftstag AND t.zeitraum_bis = a.zeitraum_bis
        AND t.finanzweg_nummer = a.finanzweg_nummer
 WHERE a.bericht = 88 AND a.zeitraum_bis = a.geschaeftstag
   AND EXISTS (SELECT 1 FROM core.finanzweg_tag x
                WHERE x.bericht = 97 AND x.betrieb_key = a.betrieb_key
                  AND x.geschaeftstag = a.geschaeftstag);

COMMENT ON VIEW mart.finanzweg_88_97_abgleich IS
'Koernung: Betrieb × Tag × Finanzweg — nur Tage, fuer die BEIDE Quellen geladen sind.
Bericht 88 (ein Tagesaufruf je Betrieb-Tag, 152.840 Aufrufe Historie) und Bericht 97 (je Tag
derselbe Finanzwegblock aus EINEM Monatsaufruf, 5.115 Aufrufe) liefern dieselben Zahlen —
gemessen einmal, Wilma Wunder Duesseldorf August 2026, alle 34 Finanzwege gleich. Steht hier
ueber viele Betriebe und Monate nur "gleich", ist der Tagesabruf von 88 verzichtbar
(offene-punkte.md). ERWARTUNG: kein "weicht ab".';


CREATE OR REPLACE VIEW mart.bericht_hinweis AS
SELECT h.endpunkt, h.betrieb_key, b.name AS betrieb, h.zeitraum_von, h.zeitraum_bis,
       h.hinweis, h.erstmals_am, h.zuletzt_am
  FROM core.bericht_hinweis h
  JOIN core.betrieb b ON b.betrieb_key = h.betrieb_key;

COMMENT ON VIEW mart.bericht_hinweis IS
'Koernung: Bericht × Betrieb × Zeitraum × Hinweis. LINAs fachliche Hinweise aus dem Feld
"errors" der Betriebsberichte (z. B. "Doppelte Artikelnummern, unbedingt korrigieren").
Ein Datenqualitaetskanal aus LINA selbst, kein Importfehler.';


CREATE OR REPLACE VIEW mart.rabatt_artikel_unaufgeloest AS
SELECT r.betrieb_key, b.name AS betrieb,
       date_trunc('month', r.geschaeftstag)::date AS monat,
       r.artikel_name,
       count(*)                 AS zeilen,
       sum(r.anzahl)            AS anzahl,
       round(sum(r.brutto), 2)  AS nachlass_brutto
  FROM core.rabatt_artikel_tag r
  JOIN core.betrieb b ON b.betrieb_key = r.betrieb_key
 WHERE r.artikel_key IS NULL AND r.artikel_name IS NOT NULL
 GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW mart.rabatt_artikel_unaufgeloest IS
'Koernung: Betrieb × Monat × Artikelname — Namen aus dem Rabattbericht (92), die keinem
verkauften Artikel desselben Betriebs und Zeitraums eindeutig zugeordnet werden konnten.
92 liefert keine Artikelnummer; der Weg ist core.artikel_name_norm(). Ohne diese Sicht waere
die Aufloesungsquote ein Geruecht (einmal gemessen: 50 von 51 Aktionsartikeln).
Zeilen ohne Artikelnamen (echt, 28 von 8.505 im August 2026) stehen hier nicht.';


-- ---------------------------------------------------------------------
-- 7. Pruefzeilen — angehaengt, nicht abgeschrieben (Verfahren wie 0109/0110)
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%betriebsbericht_luecke%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        -- ERWARTUNG: 0 ab der zweiten Nacht. Neueste zuerst — der juengste
        -- reife Zeitraum muss jede Nacht drankommen (harte Regel 10).
        SELECT 'Betriebsberichte: Betrieb-Tage mit Umsatz ohne Bericht (9-60 Tage alt)'::text AS pruefung,
               (SELECT count(*) FROM core.umsatzbericht_tag
                 WHERE geschaeftstag >= current_date - 60
                   AND hauptsparte_key IS NULL AND verkaufsstelle_key IS NULL
                   AND coalesce(umsatz_netto, 0) <> 0)::bigint AS geprueft,
               (SELECT count(*) FROM mart.betriebsbericht_luecke)::bigint AS auffaellig,
               'mart.betriebsbericht_luecke'::text AS sicht
        UNION ALL
        -- ERWARTUNG: 0. Dreimal nachgeholt, und LINAs Summe trifft den
        -- Umsatzbericht immer noch nicht.
        SELECT 'Betriebsberichte: Gegenprobe gegen den Umsatzbericht aufgegeben (60 Tage)'::text,
               (SELECT count(*) FROM core.betriebsbericht_abruf
                 WHERE zeitraum_bis >= current_date - 60)::bigint,
               (SELECT count(*) FROM mart.betriebsbericht_gegenprobe
                 WHERE zeitraum_bis >= current_date - 60 AND nachholen = 'aufgegeben')::bigint,
               'mart.betriebsbericht_gegenprobe'::text
        UNION ALL
        -- ERWARTUNG: 0. Zwei Quellen fuer dieselbe Finanzwegzahl muessen
        -- uebereinstimmen.
        SELECT 'Finanzwege: Bericht 88 und 97 weichen ab (60 Tage)'::text,
               (SELECT count(*) FROM core.finanzweg_tag
                 WHERE bericht = 88 AND geschaeftstag >= current_date - 60)::bigint,
               (SELECT count(*) FROM mart.finanzweg_88_97_abgleich
                 WHERE geschaeftstag >= current_date - 60 AND befund = 'weicht ab')::bigint,
               'mart.finanzweg_88_97_abgleich'::text
        $zweig$);
END $aussen$;


-- ---------------------------------------------------------------------
-- 8. Katalog und Leserolle (Pflicht seit 0110 fuer jede neue mart-Sicht)
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht SET
    koernung = 'Betriebsbericht × Betrieb × Abrufzeitraum — Gegenprobe gegen den Umsatzbericht',
    thema    = 'import'
 WHERE sicht = 'mart.betriebsbericht_gegenprobe';
UPDATE mcp.sicht SET
    koernung = 'Betriebsbericht × Betrieb × Tag — ERWARTUNG: keine Zeile',
    thema    = 'import'
 WHERE sicht = 'mart.betriebsbericht_luecke';
UPDATE mcp.sicht SET
    koernung = 'Betrieb × Tag × Finanzweg — Bericht 88 gegen 97; ERWARTUNG: kein weicht ab',
    thema    = 'import'
 WHERE sicht = 'mart.finanzweg_88_97_abgleich';
UPDATE mcp.sicht SET
    koernung = 'Bericht × Betrieb × Zeitraum × Hinweistext aus LINA',
    thema    = 'import'
 WHERE sicht = 'mart.bericht_hinweis';
UPDATE mcp.sicht SET
    koernung = 'Betrieb × Monat × Artikelname ohne Zuordnung',
    thema    = 'import'
 WHERE sicht = 'mart.rabatt_artikel_unaufgeloest';

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

SELECT mcp.rechte_auffrischen();
