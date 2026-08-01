-- =====================================================================
-- 0028 mart.pruefung_wareneinsatz rechnet auf dem materialisierten Aggregat
--
-- ANLASS. Nachlauf zu 0027. Nachdem die Karte "Deckungsbeitrag je
-- Warengruppe" behoben war, blieb auf der Seite "Warenwirtschaft" eine
-- Karte stehen, die noch langsamer ist:
--
--     wa_we_pruefung   63,2 s
--
-- Und diese Karte hat GAR KEINEN Zeitraumfilter (metabase/karten-fach.ts,
-- parameter: [BETRIEB, MARKE]). Sie kann also nicht durch Filtern schnell
-- werden -- Partition Pruning greift hier grundsaetzlich nicht, weil die
-- Sicht bewusst alle Monate nebeneinander stellt.
--
-- URSACHE. Die CTE `theoretisch` aggregiert mart.artikelverkauf ohne jede
-- Zeitgrenze, also alle 27,5 Mio. Zeilen aus 108 Partitionen -- bei jedem
-- Aufruf der Karte neu.
--
-- LOESUNG. Genau dafuer wurde in 0027 materialisiert. Das gesuchte
-- Aggregat (Betrieb x Monat) ist eine Stufe GROEBER als das bereits
-- materialisierte (Betrieb x Monat x Warengruppe) -- es laesst sich also
-- daraus aufsummieren, statt die Rohdaten erneut zu lesen.
--
-- Gemessen am 01.08.2026, identisches Ergebnis:
--
--     alt (mart.artikelverkauf)               61,7 s
--     neu (deckungsbeitrag_warengruppe)       0,037 s
--     beide: 5.364 Zeilen, Summe WE 21.808.454
--
-- WARUM DAS EXAKT UND NICHT NUR UNGEFAEHR IST. `umsatz_mit_we` wird in
-- 0027 als eigene Summenspalte gefuehrt, nicht aus abdeckung_pct
-- zurueckgerechnet -- aus einem Prozentwert laesst sich ein Betrag nicht
-- rekonstruieren. Die Summe einer Summe ist dieselbe Summe; die
-- Gruppierung von 0027 (betrieb_key, monat, ...) enthaelt die hier
-- gebrauchte (betrieb_key, monat) vollstaendig.
--
-- DER PREIS: mart.pruefung_wareneinsatz ist damit so aktuell wie der
-- letzte REFRESH aus dem Sync-Nachlauf. Fuer eine Pruefsicht, die
-- Monatssummen vergleicht, ist das richtig -- sie beantwortet ohnehin
-- keine Frage nach dem heutigen Tag. Der Stand steht in
-- mart.deckungsbeitrag_stand.
-- =====================================================================

CREATE OR REPLACE VIEW mart.pruefung_wareneinsatz AS
WITH theoretisch AS (
    -- Eine Stufe groeber als das materialisierte Aggregat: die
    -- Warengruppendimension faellt weg, Betrieb und Monat bleiben.
    SELECT betrieb_key, monat,
           sum(wareneinsatz_theoretisch) AS we_theoretisch,
           sum(umsatz_netto_pos)         AS umsatz_artikel,
           sum(umsatz_mit_we)            AS umsatz_mit_we
      FROM mart.deckungsbeitrag_warengruppe
     GROUP BY 1, 2
),
bwa AS (
    -- Unveraendert gegenueber 0006. Dieselbe Bedingung wie in
    -- mart.round_table_basis: ein Monat, in dem alles null ist, ist nicht
    -- gebucht, sondern leer. Ohne sie stuende hier fuer jeden noch nicht
    -- gebuchten Monat eine Luecke in voller Hoehe des theoretischen
    -- Wareneinsatzes.
    SELECT betrieb_key, monat,
           sum(wert_absolut) FILTER (WHERE kennzahl IN ('WE Bar', 'WE Küche')) AS we_bwa,
           max(wert_absolut) FILTER (WHERE kennzahl = 'Umsatz')                AS umsatz_bwa
      FROM mart.kennzahlen_aktuell
     GROUP BY 1, 2
    HAVING count(*) FILTER (WHERE wert_absolut IS NOT NULL AND wert_absolut <> 0) > 0
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
'Soll-Wareneinsatz aus der LINA-Kalkulation (Menge x Ansatz DES JEWEILIGEN TAGES, aus
core.artikel_stand_zeitraum) gegen den Ist-Wareneinsatz aus der BWA.

RECHNET SEIT 01.08.2026 AUF mart.deckungsbeitrag_warengruppe, die materialisiert ist. Die
Zahlen sind damit so alt wie der letzte REFRESH (siehe mart.deckungsbeitrag_stand); vorher
las die Sicht bei jedem Aufruf 27,5 Mio. Zeilen und brauchte 61,7 statt 0,04 Sekunden.

luecke = BWA minus theoretisch. Ein POSITIVER Wert heisst: es wurde mehr eingekauft als
laut Rezeptur verbraucht - Schwund, Bruch, Portionierung, Personalverzehr, Lageraufbau.
Das ist die eigentliche Kennzahl, nicht der Fehlerhinweis.

abdeckung_pct sagt, welcher Anteil des Artikelumsatzes ueberhaupt einen hinterlegten
Ansatz hat. UNTER ETWA 90 PROZENT IST DER VERGLEICH NICHT AUSSAGEKRAEFTIG - dann ist
der theoretische WE nur strukturell zu niedrig.

Kein Bar/Kueche-Split moeglich: die Hauptsparte haengt am Umsatzbericht, nicht am Artikel.
Bezugsgroessen sind bewusst getrennt ausgewiesen (Artikelumsatz vs. BWA-Umsatzkonto) -
die beiden sind nicht identisch.';
