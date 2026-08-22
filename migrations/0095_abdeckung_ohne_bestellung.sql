-- =====================================================================
-- 0095 Abdeckung: "hat nichts bestellt" ist nicht "hat alles vergessen"
--
-- ANLASS. mart.pflichtartikel_abdeckung fuehrt eine Zeile je Betrieb und
-- Pflichtartikel. Ein Betrieb, der im Laufzeitraum ueberhaupt nichts
-- bestellt hat, bekommt damit fuer JEDEN Pflichtartikel ein
-- bezogen = false — und sieht in der Liste aus wie der schlimmste Fall
-- des Konzepts.
--
-- Nachgemessen am 22.08.2026 (lokal, Zeitraum der jeweiligen Liste):
--
--   Datenbasis         Betriebe   Fehlmeldungen
--   belastbar                45           3.166
--   keine Bestellung          7           1.503
--
-- Ein Drittel der Fehlmeldungen stammt also von sieben Betrieben, ueber
-- die die Auswertung nichts weiss — darunter "Geschlossen Wilma Wunder
-- Hannover". Das ist dieselbe Signatur wie in 0080 (`ampel.gesamt()` fiel
-- bei einem fehlenden Signal auf gruen durch) und in 0071 (eine Kachel,
-- die nie auf null geht, liest niemand mehr), nur mit umgekehrtem
-- Vorzeichen: hier wird aus fehlenden Daten ein maximal schlechtes Urteil
-- statt eines guten.
--
-- WAS SICH AENDERT. Die Sicht bekommt die Spalte `datenbasis` — dieselben
-- vier Werte wie in mart.pflichtartikel_betrieb, plus 'keine Bestellung'
-- fuer Betriebe, die dort gar nicht vorkommen.
--
-- WAS SICH NICHT AENDERT: es wird nichts weggefiltert. Die Zeilen bleiben
-- vollstaendig stehen, sie sind nur ab jetzt als das lesbar, was sie sind.
-- Wer einen geschlossenen Betrieb nachsehen will, kann das weiterhin —
-- dieselbe Regel wie beim Kalenderausschluss in 0093, der auch nur in der
-- Auswertungsschicht wirkt.
--
-- CREATE OR REPLACE VIEW darf Spalten nur ANHAENGEN (die Lehre aus 0058).
-- `datenbasis` steht deshalb am Ende, nicht neben `betrieb`.
-- =====================================================================

CREATE OR REPLACE VIEW mart.pflichtartikel_abdeckung AS
WITH betriebe AS (
  SELECT DISTINCT m.name AS konzept, k.betrieb_key
    FROM core.kostenstelle k
    JOIN core.marke m USING (marke_key)
   WHERE k.betrieb_key IS NOT NULL
), soll AS (
  SELECT l.konzept, l.gueltig_von, l.gueltig_bis, p.bereich,
         p.artikelnummer, p.bezeichnung, p.lieferant, p.optional, p.nur_betriebe
    FROM manual.pflichtartikel p
    JOIN manual.pflichtartikel_liste l
      ON l.konzept = p.konzept AND l.bereich = p.bereich
     AND l.gueltig_von = p.gueltig_von
   WHERE p.artikelnummer IS NOT NULL
)
SELECT s.konzept,
       bt.name          AS betrieb,
       b.betrieb_key,
       s.gueltig_von, s.gueltig_bis,
       s.bereich,
       s.lieferant,
       s.artikelnummer,
       s.bezeichnung,
       s.optional,
       s.nur_betriebe,
       (a.nr IS NOT NULL)                AS bezogen,
       coalesce(a.positionen, 0)         AS positionen,
       round(coalesce(a.ausgaben, 0), 2) AS ausgaben,
       a.letzte_bestellung,
       /*
        * NEU in 0095. 'keine Bestellung' heisst: der Betrieb taucht in
        * mart.pflichtartikel_betrieb gar nicht auf, hat im Laufzeitraum
        * der Liste also keine einzige Bestellung. Fuer ihn ist JEDER
        * Pflichtartikel "nicht bezogen", und das ist keine Aussage ueber
        * sein Sortiment.
        */
       CASE WHEN coalesce(pb.bestellungen, 0) = 0            THEN 'keine Bestellung'
            WHEN pb.bestellungen < 10 OR pb.ausgaben < 5000  THEN 'duenn'
            ELSE 'belastbar' END AS datenbasis
  FROM soll s
  JOIN betriebe b ON b.konzept = s.konzept
  JOIN core.betrieb bt ON bt.betrieb_key = b.betrieb_key
  LEFT JOIN mart.pflichtartikel_artikel_basis a
         ON a.konzept     = s.konzept
        AND a.gueltig_von = s.gueltig_von
        AND a.betrieb_key = b.betrieb_key
        AND (a.nr = s.artikelnummer OR a.liste_nummer = s.artikelnummer)
  /*
   * Die Datenbasis wird HIER gerechnet und nicht aus
   * mart.pflichtartikel_betrieb geholt: jene Sicht reicht `gueltig_von`
   * nicht durch. Ueber Konzept und Betrieb allein zu joinen ginge heute
   * gut (je Konzept gibt es genau ein Fenster) und bruecke in dem Moment,
   * in dem die Winterkarte danebensteht — dann traefe der Join zwei Zeilen
   * und verdoppelte jede Abdeckungszeile. Die Schwelle ist dieselbe wie
   * dort und steht bewusst an beiden Stellen gleich.
   */
  LEFT JOIN LATERAL (
      SELECT sum(e.bestellungen) AS bestellungen, sum(e.ausgaben) AS ausgaben
        FROM mart.pflichtartikel_einkauf_basis e
       WHERE e.konzept     = s.konzept
         AND e.betrieb_key = b.betrieb_key
         AND e.gueltig_von = s.gueltig_von) pb ON true
 WHERE s.nur_betriebe IS NULL
    OR EXISTS (SELECT 1 FROM mart.pflichtartikel_regional r
                WHERE r.konzept = s.konzept AND r.bezeichnung = s.bezeichnung
                  AND r.betrieb_key = b.betrieb_key)
    OR EXISTS (SELECT 1 FROM mart.pflichtartikel_regional_offen o
                WHERE o.konzept = s.konzept AND o.bezeichnung = s.bezeichnung);

COMMENT ON VIEW mart.pflichtartikel_abdeckung IS
'Eine Zeile je Betrieb und Pflichtartikel mit Nummer: wurde er im
Gueltigkeitszeitraum bezogen? bezogen = false ist der fehlende Artikel.

IMMER ZUSAMMEN MIT datenbasis LESEN. "keine Bestellung" heisst, dass der Betrieb
im Laufzeitraum gar nichts bestellt hat — fuer ihn fehlt zwangslaeufig JEDER
Pflichtartikel, und das ist keine Aussage ueber sein Sortiment. Am 22.08.2026
stammten 1.503 von 4.669 Fehlmeldungen aus sieben solchen Betrieben.

Positionen ohne Artikelnummer fehlen hier bewusst — sie sind ueber die Nummer
nicht pruefbar und stehen in mart.pflichtartikel_nicht_pruefbar.

Regionale Gerichte gelten nur an den Standorten, die die Vorlage nennt
(mart.pflichtartikel_regional). Laesst sich die Ortsangabe nicht aufloesen,
gilt der Artikel vorsorglich fuer alle — sichtbar in
mart.pflichtartikel_regional_offen.

Wer nach einem Artikel sucht, den KEIN Betrieb fuehrt, gruppiert nach
bezeichnung UND klammert datenbasis = ''keine Bestellung'' aus: das ist dann
kein Betriebsproblem, sondern eine veraltete Liste.';

COMMENT ON COLUMN mart.pflichtartikel_abdeckung.datenbasis IS
'belastbar = mindestens zehn Bestellungen und 5.000 EUR im Laufzeitraum.
duenn = weniger. keine Bestellung = der Betrieb hat im Laufzeitraum gar nichts
bestellt; seine Fehlmeldungen sind keine Aussage.';

INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0095', to_jsonb(
        'mart.pflichtartikel_abdeckung trennt jetzt "hat nichts bestellt" von '
        '"hat den Artikel nicht bestellt". Sieben Betriebe ohne eine einzige '
        'Bestellung im Laufzeitraum trugen 1.503 der 4.669 Fehlmeldungen — ein '
        'Drittel, darunter geschlossene Haeuser. Nichts wird weggefiltert, die '
        'neue Spalte datenbasis macht die Zeilen nur lesbar.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
