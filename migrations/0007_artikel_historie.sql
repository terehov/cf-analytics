-- =====================================================================
-- Artikelstand je Monat - Stammdaten als Historie, nicht als Momentaufnahme
--
-- Fehler, der in 0000 steckt und den 0006 sichtbar gemacht hat:
-- core.artikel wird per UPSERT gepflegt. name und fixer_we werden dabei
-- ueberschrieben. fixer_we ist aber das Ergebnis der LINA-Rezepturkalkulation
-- und aendert sich, sobald Rezepturen oder Einkaufspreise angepasst werden.
--
-- Damit war mart.pruefung_wareneinsatz falsch: sie haette den theoretischen
-- Wareneinsatz fuer Juni 2023 mit der HEUTIGEN Kalkulation gerechnet. Bei
-- einem Backfill ueber fuenf Jahre ist das kein Randfall, sondern der
-- Regelfall - und der Fehler waere nicht aufgefallen, weil das Ergebnis
-- plausibel aussieht.
--
-- Genauso wichtig fuer die Zeit NACH LINA: ohne diese Tabelle laesst sich
-- nie mehr rekonstruieren, mit welcher Kalkulation ein historischer Monat
-- gerechnet wurde. Die Bewegungsdaten allein reichen dafuer nicht.
--
-- Monatsgranularitaet mit Absicht: taeglich waeren es 6.451 Artikel x 365
-- Tage, und die fachliche Frage lautet ohnehin "welcher Ansatz galt in
-- Monat X". Ausserdem ist der Monat unabhaengig davon, in welcher
-- Reihenfolge der Backfill die Zeitraeume abarbeitet.
-- =====================================================================

CREATE TABLE core.artikel_stand (
    artikel_key   integer NOT NULL REFERENCES core.artikel(artikel_key),
    monat         date    NOT NULL,
    name          text    NOT NULL,
    fixer_we      numeric(12,4),
    erfasst_am    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (artikel_key, monat)
);

COMMENT ON TABLE core.artikel_stand IS
'Wie sah ein Artikel in einem bestimmten Monat aus? Append-only.
core.artikel haelt den AKTUELLEN Stand fuer Joins und Anzeige, diese Tabelle die Historie.
Ohne sie waere jede Rueckrechnung auf vergangene Monate still falsch, weil fixer_we mit
jeder Rezeptur- und Einkaufspreisaenderung ueberschrieben wird.';

COMMENT ON COLUMN core.artikel_stand.monat    IS 'Monatserster des Zeitraums, aus dem die Antwort stammt.';
COMMENT ON COLUMN core.artikel_stand.fixer_we IS 'LINAs hinterlegter Wareneinsatz je Einheit, wie er in diesem Monat galt.';


-- ---------------------------------------------------------------------
-- pruefung_wareneinsatz auf die Historie umstellen
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.pruefung_wareneinsatz AS
WITH je_artikel AS (
    SELECT av.betrieb_key,
           date_trunc('month', av.geschaeftstag)::date AS monat,
           av.artikel_key,
           sum(av.menge)        AS menge,
           sum(av.umsatz_netto) AS umsatz
      FROM core.artikelverkauf_tag av
     GROUP BY 1, 2, 3
),
mit_ansatz AS (
    -- Der Ansatz, der IN DIESEM MONAT galt. Faellt auf den aktuellen Stand
    -- zurueck, solange fuer den Monat noch kein Eintrag existiert - etwa fuer
    -- Daten, die vor dieser Migration geladen wurden.
    SELECT j.*,
           COALESCE(h.fixer_we, a.fixer_we) AS fixer_we
      FROM je_artikel j
      JOIN core.artikel a ON a.artikel_key = j.artikel_key
      LEFT JOIN LATERAL (
          SELECT s.fixer_we
            FROM core.artikel_stand s
           WHERE s.artikel_key = j.artikel_key
             AND s.monat <= j.monat
           ORDER BY s.monat DESC
           LIMIT 1
      ) h ON true
),
theoretisch AS (
    SELECT betrieb_key, monat,
           sum(menge * fixer_we) FILTER (WHERE fixer_we IS NOT NULL) AS we_theoretisch,
           sum(umsatz)                                               AS umsatz_artikel,
           sum(umsatz) FILTER (WHERE fixer_we IS NOT NULL)           AS umsatz_mit_we
      FROM mit_ansatz
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
'Soll-Wareneinsatz aus der LINA-Kalkulation (Menge x fixer_we des jeweiligen MONATS, aus
core.artikel_stand) gegen den Ist-Wareneinsatz aus der BWA.

luecke = BWA minus theoretisch. Ein POSITIVER Wert heisst: es wurde mehr eingekauft als
laut Rezeptur verbraucht - Schwund, Bruch, Portionierung, Personalverzehr, Lageraufbau.
Das ist die eigentliche Kennzahl, nicht der Fehlerhinweis.

abdeckung_pct sagt, welcher Anteil des Artikelumsatzes ueberhaupt einen hinterlegten
fixer_we hat. UNTER ETWA 90 PROZENT IST DER VERGLEICH NICHT AUSSAGEKRAEFTIG.

Kein Bar/Kueche-Split moeglich: die Hauptsparte haengt am Umsatzbericht, nicht am Artikel.';
