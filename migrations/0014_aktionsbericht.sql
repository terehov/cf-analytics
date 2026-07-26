-- ---------------------------------------------------------------------
-- 0014 Der Aktionsbericht bekommt ein Ziel
--
-- ANLASS: `getAktionsbericht` wird seit dem ersten Lauf geholt und landete
-- nur in `raw.api_antwort`. Der `switch` in src/sync/laden.ts fiel in den
-- `default`-Zweig, der Posten meldete `ok`, `zeilen: 0`. Kein Datenverlust
-- -- der Raw-Layer hat alles --, aber auch keine Auswertung: "Umsatz
-- Marketingaktion" steht in docs/kennzahlen-mapping.md als abgedeckt und war
-- es nicht.
--
-- WAS DER BERICHT LIEFERT (gemessen am 26.07.2026, ein Tag im Bestand)
--
--   {"timeframe":"25.07.2026", "brutto":false,
--    "aktionen":[{"id":4,"name":"Sekt alkoholfrei","dateFrom":null,"dateTo":null},
--                {"id":8,"name":"Mexican Summer","dateFrom":1780264800,"dateTo":1785448800}],
--    "rows":[{"name":"…","encId":"…","cells":{"4":null,"6":null,"8":null}}]}   // 141 Betriebe
--
-- Also eine Kreuztabelle: Betriebe in den Zeilen, Aktionen in den Spalten.
-- Daraus werden hier zwei Tabellen -- die Aktion als Dimension, der Umsatz
-- als Faktum.
--
-- WARUM NICHT PARTITIONIERT
--
-- Bewusst anders als core.artikelverkauf_tag. Dort sind es 56.000 Zeilen am
-- Tag, hier 141 Betriebe mal drei Aktionen, und davon ist fast alles leer.
-- Eine Partitionierung waere hier reine Verwaltung ohne Gegenwert -- und
-- jede Partition, die niemand braucht, ist eine Tabelle mehr im Katalog.
-- Genau darum ging es beim Aufraeumen von `core`.
-- ---------------------------------------------------------------------

CREATE TABLE core.aktion (
    aktion_key      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lina_id         integer NOT NULL UNIQUE,
    name            text    NOT NULL,
    gueltig_von     date,
    gueltig_bis     date,
    zuletzt_am      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.aktion IS
'Marketingaktionen aus getAktionsbericht.aktionen. Am 26.07.2026 drei Stueck: Sekt
alkoholfrei, Sarti Aktion, Mexican Summer.

BEWUSST KEINE MONATLICHE MOMENTAUFNAHME, anders als core.artikel_stand. Eine Aktion
traegt ihre Laufzeit selbst (gueltig_von/gueltig_bis), sie muss nicht aus der Historie
rekonstruiert werden. Ein neuer Name unter derselben lina_id ist eine Umbenennung,
keine neue Aktion -- deshalb genuegt hier ein Upsert.';

COMMENT ON COLUMN core.aktion.gueltig_von IS
'Aus dateFrom (Unix-Sekunden, ueber die Berliner Wanduhr aufgeloest). Oft NULL: zwei der
drei bekannten Aktionen laufen unbefristet.';
COMMENT ON COLUMN core.aktion.gueltig_bis IS 'Aus dateTo. Siehe gueltig_von.';


CREATE TABLE core.aktionsumsatz_tag (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag   date    NOT NULL,
    aktion_key      integer NOT NULL REFERENCES core.aktion(aktion_key),
    umsatz_netto    numeric(14,2),
    umsatz_brutto   numeric(14,2),
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (geschaeftstag, betrieb_key, aktion_key)
);

COMMENT ON TABLE core.aktionsumsatz_tag IS
'Umsatz je Betrieb, Tag und Marketingaktion. Aus getAktionsbericht.rows[].cells, wobei der
Schluessel der Zelle die lina_id der Aktion ist.

NUR ZEILEN MIT UMSATZ. Leere und auf null stehende Zellen werden verworfen -- sonst
entstuenden 141 mal 3 Zeilen am Tag, praktisch alle mit NULL. Dieselbe Entscheidung wie
bei core.artikelverkauf_tag. Der Preis dafuer ist derselbe: eine fehlende Zeile heisst
"keine Aktion an diesem Tag" UND "Tag nicht geholt". Welcher Fall vorliegt, beantwortet
sync.warteschlange, nicht diese Tabelle.

Netto oder brutto entscheidet das Feld `brutto` IN DER ANTWORT, nicht unser
Anfrageparameter. Wir fragen zwar immer mit brutto=0, aber wer sich auf die eigene
Anfrage verlaesst statt auf die Antwort, beschriftet irgendwann brutto als netto.';

-- Auswertungen fragen "wie lief Aktion X ueber die Zeit" -- der PK beginnt
-- mit geschaeftstag und hilft dabei nicht.
CREATE INDEX ON core.aktionsumsatz_tag (aktion_key, geschaeftstag);


-- =====================================================================
-- MART
-- =====================================================================

CREATE VIEW mart.aktion AS
SELECT a.aktion_key,
       a.lina_id,
       a.name AS aktion,
       a.gueltig_von,
       a.gueltig_bis,
       (a.gueltig_von IS NULL AND a.gueltig_bis IS NULL) AS unbefristet,
       (SELECT min(u.geschaeftstag) FROM core.aktionsumsatz_tag u WHERE u.aktion_key = a.aktion_key)
         AS erster_umsatztag,
       (SELECT max(u.geschaeftstag) FROM core.aktionsumsatz_tag u WHERE u.aktion_key = a.aktion_key)
         AS letzter_umsatztag
  FROM core.aktion a;

COMMENT ON VIEW mart.aktion IS
'Die Marketingaktionen als Dimension. gueltig_von/bis ist die HINTERLEGTE Laufzeit,
erster_/letzter_umsatztag die TATSAECHLICHE -- die beiden auseinanderzuhalten lohnt sich:
eine unbefristete Aktion ohne Umsatz seit Monaten ist im Kassensystem noch aktiv und
faktisch tot.';


CREATE VIEW mart.aktionsumsatz AS
SELECT au.geschaeftstag,
       date_trunc('month', au.geschaeftstag)::date AS monat,
       b.betrieb_key,
       b.name          AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       a.aktion_key,
       a.name          AS aktion,
       au.umsatz_netto,
       au.umsatz_brutto
  FROM core.aktionsumsatz_tag au
  JOIN core.betrieb b                 ON b.betrieb_key  = au.betrieb_key
  JOIN core.aktion  a                 ON a.aktion_key   = au.aktion_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = au.betrieb_key;

COMMENT ON VIEW mart.aktionsumsatz IS
'Aktionsumsaetze mit Namen. Eine Zeile je Betrieb, Tag und Aktion -- und nur dort, wo es
Umsatz gab. Fuer den Anteil am Gesamtumsatz: mart.aktionsumsatz_monat.';


CREATE VIEW mart.aktionsumsatz_monat AS
WITH je_aktion AS (
    SELECT date_trunc('month', au.geschaeftstag)::date AS monat,
           au.betrieb_key,
           au.aktion_key,
           sum(au.umsatz_netto)              AS umsatz_netto,
           count(DISTINCT au.geschaeftstag)  AS tage_mit_umsatz
      FROM core.aktionsumsatz_tag au
     GROUP BY 1, 2, 3
),
/*
 * Der Nenner kommt aus dem Umsatzbericht, nicht aus der Summe aller Aktionen.
 * "Anteil an allen Aktionen" waere eine andere Frage und immer 100 Prozent im
 * Zaehler ueber alle Zeilen -- gefragt ist, wie viel vom GESCHAEFT auf eine
 * Aktion entfaellt.
 *
 * Dieselbe Filterbedingung wie in mart.umsatz_tag: nur die Gesamtzeile ohne
 * Hauptsparte und Verkaufsstelle, sonst wird der Nenner mehrfach gezaehlt.
 */
gesamt AS (
    SELECT date_trunc('month', u.geschaeftstag)::date AS monat,
           u.betrieb_key,
           sum(u.umsatz_netto) AS umsatz_netto
      FROM core.umsatzbericht_tag u
     WHERE u.hauptsparte_key IS NULL
       AND u.verkaufsstelle_key IS NULL
     GROUP BY 1, 2
)
SELECT j.monat,
       b.betrieb_key,
       b.name          AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       a.aktion_key,
       a.name          AS aktion,
       j.umsatz_netto,
       j.tage_mit_umsatz,
       g.umsatz_netto  AS umsatz_betrieb_gesamt,
       round(100 * j.umsatz_netto / nullif(g.umsatz_netto, 0), 2) AS anteil_pct
  FROM je_aktion j
  JOIN core.betrieb b                 ON b.betrieb_key  = j.betrieb_key
  JOIN core.aktion  a                 ON a.aktion_key   = j.aktion_key
  LEFT JOIN gesamt g                  ON g.betrieb_key  = j.betrieb_key AND g.monat = j.monat
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = j.betrieb_key;

COMMENT ON VIEW mart.aktionsumsatz_monat IS
'Aktionsumsatz je Betrieb und Monat, mit dem Anteil am Gesamtumsatz des Betriebs.

anteil_pct hat den Umsatz aus mart.umsatz_tag im Nenner, nicht die Summe der Aktionen --
gefragt ist, wie viel vom Geschaeft auf eine Aktion entfaellt. Bleibt NULL, wenn fuer den
Monat kein Umsatzbericht vorliegt; das ist ehrlicher als eine 100.

tage_mit_umsatz zaehlt nur Tage MIT Umsatz. Ein Monat mit 3 statt 30 Tagen kann heissen:
die Aktion lief nur drei Tage -- oder es sind nur drei Tage geholt. Der Datenstand steht
in mart.datenstand.';
