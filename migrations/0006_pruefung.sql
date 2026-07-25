-- =====================================================================
-- Gegenrechnung: LINAs Aggregate gegen unsere eigene Neuberechnung
--
-- Bisher uebernehmen wir LINAs fertige Zahlen. Das ist bequem und meistens
-- richtig - aber wenn dort ein Rechenfehler steckt, uebernehmen wir ihn
-- kommentarlos und diskutieren im Round Table ueber eine falsche Ampel.
--
-- Diese Sichten rechnen aus der jeweils feineren Ebene neu und stellen
-- beides nebeneinander. Sie kosten KEINE einzige zusaetzliche Anfrage bei
-- LINA - die Artikeldaten holen wir ohnehin.
--
-- Grundsatz: nichts korrigieren, nur sichtbar machen. Wer automatisch
-- "korrigiert", verschiebt den Fehler nur dorthin, wo ihn keiner sucht.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Umsatz: Artikelsumme gegen Umsatzbericht
--
-- Der Artikelverkaufsbericht ist die feinste Ebene, die wir bekommen:
-- Betrieb x Tag x Artikel. Aufsummiert muss er den Tagesumsatz aus
-- getUmsatzbericht ergeben. Tut er das nicht, stimmt entweder LINAs
-- Aggregation nicht oder unser Verstaendnis davon - beides will man wissen.
-- ---------------------------------------------------------------------

CREATE VIEW mart.pruefung_umsatz AS
WITH aus_artikeln AS (
    SELECT betrieb_key, geschaeftstag,
           sum(umsatz_netto)  AS netto,
           sum(umsatz_brutto) AS brutto
      FROM core.artikelverkauf_tag
     GROUP BY 1, 2
),
gemeldet AS (
    SELECT betrieb_key, geschaeftstag, umsatz_netto, umsatz_brutto
      FROM core.umsatzbericht_tag
     WHERE hauptsparte_key IS NULL AND verkaufsstelle_key IS NULL
)
SELECT b.name                                    AS betrieb,
       g.geschaeftstag,
       g.umsatz_netto                            AS lina_netto,
       a.netto                                   AS artikel_netto,
       round(a.netto - g.umsatz_netto, 2)        AS differenz,
       round((a.netto - g.umsatz_netto)
             / NULLIF(g.umsatz_netto, 0) * 100, 3) AS differenz_pct,
       -- 0,5 % Toleranz: Rundungen je Artikel summieren sich, echte
       -- Aggregationsfehler liegen erfahrungsgemaess deutlich darueber.
       (abs(a.netto - g.umsatz_netto)
        > 0.005 * abs(NULLIF(g.umsatz_netto, 0)))  AS auffaellig
  FROM gemeldet g
  JOIN aus_artikeln a USING (betrieb_key, geschaeftstag)
  JOIN core.betrieb b USING (betrieb_key);

COMMENT ON VIEW mart.pruefung_umsatz IS
'Tagesumsatz aus den Artikelzeilen neu aufaddiert gegen getUmsatzbericht.
Erste Frage nach jedem Backfill: SELECT count(*) FROM mart.pruefung_umsatz WHERE auffaellig;
Erwartung 0. Ist es nicht 0, vor der naechsten Auswertung klaeren - nicht danach.
Nur Tage, an denen BEIDE Berichte geladen sind; ein fehlender Bericht faellt hier
nicht auf, dafuer ist mart.warteschlange_stand zustaendig.';


-- ---------------------------------------------------------------------
-- 2. Bon: Rechnungen x Durchschnittsbon gegen Umsatz
--
-- LINA liefert avgTicket fertig. Der Kommentar an core.umsatzbericht_tag
-- warnt davor, ihn selbst aus Umsatz/Rechnungen zu rechnen, weil das bei
-- Nullwerten abweicht - hier laeuft die Rechnung in die andere Richtung
-- und prueft LINAs eigene Angabe gegen sich selbst.
--
-- Echte Bon-Rohdaten (ein Datensatz je Bon) haben wir NICHT. Die laegen
-- unter /finanzen/report/kassenjournal, sind ungeprueft, vermutlich HTML
-- statt JSON, um Groessenordnungen umfangreicher und personenbezogen
-- (Kellner, Zeitstempel). Siehe docs/offene-punkte.md.
-- ---------------------------------------------------------------------

CREATE VIEW mart.pruefung_bon AS
SELECT b.name                          AS betrieb,
       u.geschaeftstag,
       u.umsatz_netto,
       u.rechnungen,
       u.durchschnittsbon              AS lina_bon,
       round(u.umsatz_netto / NULLIF(u.rechnungen, 0), 2) AS bon_gerechnet,
       round(u.durchschnittsbon
             - u.umsatz_netto / NULLIF(u.rechnungen, 0), 2) AS differenz,
       (abs(u.durchschnittsbon - u.umsatz_netto / NULLIF(u.rechnungen, 0)) > 0.05)
                                       AS auffaellig
  FROM core.umsatzbericht_tag u
  JOIN core.betrieb b USING (betrieb_key)
 WHERE u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
   AND u.rechnungen > 0;

COMMENT ON VIEW mart.pruefung_bon IS
'Durchschnittsbon: LINAs avgTicket gegen Umsatz/Rechnungen. Abweichungen sind hier NICHT
automatisch ein Fehler - avgTicket kann auf Brutto oder auf einer anderen Rechnungsmenge
beruhen (Sammelrechnungen, stornierte Bons). Die Sicht sagt, WO nachzusehen ist, nicht was falsch ist.
Toleranz 5 Cent.';


-- ---------------------------------------------------------------------
-- 3. Theoretischer Wareneinsatz
--
-- Menge x fixer_we je Artikel = was laut hinterlegter Kalkulation haette
-- verbraucht werden muessen. Gegenueber steht der WE aus der BWA - der
-- kommt vom Steuerberater und beruht auf EINKAUF, nicht auf Verbrauch.
--
-- WICHTIG: Eine Abweichung ist hier der Normalfall, kein Fehler. Genau
-- diese Luecke ist die fachlich interessante Groesse - sie enthaelt
-- Schwund, Bruch, Portionierung, Personalverzehr und Lagerbewegung. Wer
-- sie als "Rechenfehler" liest, hat den Bericht missverstanden.
--
-- Zwei Grenzen, die man kennen muss:
--   * Nicht jeder Artikel hat einen hinterlegten fixer_we. Deshalb wird
--     die ABDECKUNG mit ausgewiesen - ohne sie sieht ein theoretischer WE
--     bei halber Artikelabdeckung einfach nur niedrig aus.
--   * Die Trennung Bar/Kueche laesst sich aus den Artikelzeilen NICHT
--     nachbilden: die Hauptsparte haengt am Umsatzbericht, nicht am
--     Artikel. Verglichen wird deshalb nur die Summe.
-- ---------------------------------------------------------------------

CREATE VIEW mart.pruefung_wareneinsatz AS
WITH theoretisch AS (
    SELECT av.betrieb_key,
           date_trunc('month', av.geschaeftstag)::date AS monat,
           sum(av.menge * a.fixer_we) FILTER (WHERE a.fixer_we IS NOT NULL) AS we_theoretisch,
           sum(av.umsatz_netto)                                             AS umsatz_artikel,
           sum(av.umsatz_netto) FILTER (WHERE a.fixer_we IS NOT NULL)       AS umsatz_mit_we
      FROM core.artikelverkauf_tag av
      JOIN core.artikel a USING (artikel_key)
     GROUP BY 1, 2
),
bwa AS (
    SELECT betrieb_key, monat,
           sum(wert_absolut) FILTER (WHERE kennzahl IN ('WE Bar', 'WE Küche')) AS we_bwa,
           max(wert_absolut) FILTER (WHERE kennzahl = 'Umsatz')                AS umsatz_bwa
      FROM mart.kennzahlen_aktuell
     WHERE wert_absolut IS NOT NULL
     GROUP BY 1, 2
)
SELECT b.name                                          AS betrieb,
       t.monat,
       round(t.we_theoretisch, 2)                      AS we_theoretisch,
       w.we_bwa,
       round(w.we_bwa - t.we_theoretisch, 2)           AS luecke,
       round(t.we_theoretisch / NULLIF(t.umsatz_mit_we, 0) * 100, 2) AS we_theoretisch_pct,
       round(w.we_bwa / NULLIF(w.umsatz_bwa, 0) * 100, 2)           AS we_bwa_pct,
       round(t.umsatz_mit_we / NULLIF(t.umsatz_artikel, 0) * 100, 1) AS abdeckung_pct
  FROM theoretisch t
  JOIN bwa w  ON w.betrieb_key = t.betrieb_key AND w.monat = t.monat
  JOIN core.betrieb b ON b.betrieb_key = t.betrieb_key;

COMMENT ON VIEW mart.pruefung_wareneinsatz IS
'Soll-Wareneinsatz aus der LINA-Kalkulation (Menge x fixer_we) gegen den Ist-Wareneinsatz
aus der BWA.

luecke = BWA minus theoretisch. Ein POSITIVER Wert heisst: es wurde mehr eingekauft als
laut Rezeptur verbraucht - Schwund, Bruch, Portionierung, Personalverzehr, Lageraufbau.
Das ist die eigentliche Kennzahl, nicht der Fehlerhinweis.

abdeckung_pct sagt, welcher Anteil des Artikelumsatzes ueberhaupt einen hinterlegten
fixer_we hat. UNTER ETWA 90 PROZENT IST DER VERGLEICH NICHT AUSSAGEKRAEFTIG - dann ist
der theoretische WE nur strukturell zu niedrig.

Kein Bar/Kueche-Split moeglich: die Hauptsparte haengt am Umsatzbericht, nicht am Artikel.
Bezugsgroessen sind bewusst getrennt ausgewiesen (Artikelumsatz vs. BWA-Umsatzkonto) -
die beiden sind nicht identisch.';


-- ---------------------------------------------------------------------
-- 4. Eine Zeile fuer den Blick nach dem Backfill
-- ---------------------------------------------------------------------

CREATE VIEW mart.pruefung_uebersicht AS
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
SELECT 'Wareneinsatz: Abdeckung unter 90 %',
       count(*), count(*) FILTER (WHERE abdeckung_pct < 90), 'mart.pruefung_wareneinsatz'
  FROM mart.pruefung_wareneinsatz;

COMMENT ON VIEW mart.pruefung_uebersicht IS
'Erste Abfrage nach jedem groesseren Backfill: SELECT * FROM mart.pruefung_uebersicht;
Die Spalte auffaellig ist eine Arbeitsliste, kein Alarm - beim Wareneinsatz zaehlt sie
die Faelle mit zu duenner Artikelabdeckung, nicht die inhaltlichen Abweichungen.';
