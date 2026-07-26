-- =====================================================================
-- 0008 Standort — die Grundlage fuer eine Karte
--
-- ANLASS: Alle Betriebe auf einer Deutschlandkarte, eingefaerbt nach der
-- Round-Table-Gesamtampel, anklickbar bis ins Betriebsblatt. Bei mehreren
-- Marken in derselben Stadt ist die geografische Verteilung anders nicht
-- sichtbar.
--
-- BEFUND: LINA liefert dafuer nichts. Am 26.07.2026 wurden alle 489
-- archivierten API-Antworten rekursiv nach Adress- und Geofeldern
-- durchsucht. Ergebnis:
--
--   * Fuer BETRIEBE: kein einziges Feld. analyticsFilterOptions liefert
--     {id, name}, alle Berichtsendpunkte liefern {name, encId} plus
--     Kennzahlen. core.betrieb.stadt ist bei allen 141 Betrieben NULL.
--   * Fuer LIEFERANTEN: wawi:suppliers hat strasse, plz, ort. LINA KENNT
--     das Konzept Adresse also -- fuehrt es fuer Betriebe aber nicht.
--
-- Details in docs/befunde-datenlage.md.
--
-- WARUM NICHT AUS DEM NAMEN ABLEITEN: "Aposto Aalen GmbH" enthaelt die
-- Stadt, "Alter Kranen GmbH" und "SCHAFFERONE GmbH" nicht. Ein Betrieb an
-- der falschen Stelle auf einer Karte ist schlimmer als ein fehlender --
-- er wird nicht hinterfragt. Zudem sind fuenf Betriebe nach derselben
-- Stadt benannt, ohne dieselbe Stadt zu sein (siehe AGENTS.md).
--
-- DESHALB diese Tabelle: gepflegte Standorte mit ausgewiesener Herkunft.
-- Sie ist leer, bis jemand sie fuellt, und die Karte zeigt genau die
-- Betriebe, die darin stehen. Keine geratene Position.
-- =====================================================================

CREATE TABLE manual.betrieb_standort (
    betrieb_key   integer PRIMARY KEY REFERENCES core.betrieb(betrieb_key),

    strasse       text,
    plz           text,
    ort           text,
    land          text NOT NULL DEFAULT 'DE',

    -- WGS 84, wie jede Kartenbibliothek und Metabase sie erwartet.
    -- numeric statt double: Koordinaten werden verglichen und exportiert,
    -- und ein Rundungsfehler in der sechsten Nachkommastelle sind rund
    -- zehn Zentimeter -- irrelevant fuer die Sache, aber laestig beim
    -- Vergleichen zweier Importe.
    breitengrad   numeric(9,6),
    laengengrad   numeric(9,6),

    -- Woher der Punkt kommt. Ohne diese Spalte laesst sich spaeter nicht
    -- mehr unterscheiden, was jemand nachgeschlagen und was eine
    -- Automatik geraten hat.
    herkunft      text NOT NULL
                  CHECK (herkunft IN ('lina', 'manuell', 'geocoding', 'concept_family')),
    genauigkeit   text CHECK (genauigkeit IN ('adresse', 'strasse', 'ort', 'unbekannt')),

    notiz         text,
    erfasst_am    timestamptz NOT NULL DEFAULT now(),
    geaendert_am  timestamptz NOT NULL DEFAULT now(),

    -- Entweder beide Koordinaten oder keine. Ein halber Punkt ist keiner.
    CONSTRAINT standort_koordinaten_paarweise
        CHECK ((breitengrad IS NULL) = (laengengrad IS NULL)),
    -- Grob Mitteleuropa. Faengt vertauschte Achsen ab, den haeufigsten
    -- Fehler beim Uebernehmen aus einer Tabelle: 49.8/9.9 ist Wuerzburg,
    -- 9.9/49.8 liegt im Golf von Guinea.
    CONSTRAINT standort_plausibel
        CHECK (breitengrad IS NULL
               OR (breitengrad BETWEEN 45 AND 56 AND laengengrad BETWEEN 5 AND 16))
);

COMMENT ON TABLE manual.betrieb_standort IS
'Wo ein Betrieb steht. VON HAND GEPFLEGT -- LINA liefert fuer Betriebe keine Adresse und
keine Koordinaten (nachgemessen am 26.07.2026 ueber alle archivierten Antworten; nur
wawi:suppliers hat strasse/plz/ort, und das sind Lieferanten).
Die Karte zeigt ausschliesslich Betriebe, die hier stehen. Betriebe ohne Eintrag fehlen auf
der Karte -- das ist Absicht: ein Betrieb an der falschen Stelle wird nicht hinterfragt, ein
fehlender schon.
NICHT aus dem Betriebsnamen ableiten. "Aposto Aalen GmbH" traegt die Stadt, "Alter Kranen
GmbH" nicht, und fuenf Betriebe heissen nach derselben Stadt, ohne dieselbe zu sein.';

COMMENT ON COLUMN manual.betrieb_standort.herkunft IS
'lina = aus einem LINA-Endpunkt (gibt es derzeit nicht), manuell = von Hand nachgeschlagen,
geocoding = aus einer Adresse berechnet, concept_family = aus einer Liste des Kunden.
Wer die Spalte weglaesst, kann spaeter nicht mehr sagen, welcher Punkt belastbar ist.';

COMMENT ON COLUMN manual.betrieb_standort.genauigkeit IS
'Wie genau der Punkt ist. Bei ort ist er der Stadtmittelpunkt, nicht der Betrieb -- fuer
eine Uebersichtskarte ausreichend, fuer eine Einzugsgebietsanalyse nicht.';


CREATE INDEX betrieb_standort_ort_idx ON manual.betrieb_standort (ort);


-- ---------------------------------------------------------------------
-- Die Sicht fuer die Karte.
--
-- Bringt Standort, Ampel und Umsatz zusammen, damit Metabase eine
-- Kartenkarte ohne Join bauen kann. Ein INNER JOIN auf den Standort:
-- ohne Koordinate kein Punkt.
-- ---------------------------------------------------------------------
CREATE VIEW mart.standort AS
SELECT s.betrieb_key,
       b.name                          AS betrieb,
       kz.hauptkonzept                 AS konzept,
       s.ort,
       s.plz,
       s.strasse,
       s.breitengrad,
       s.laengengrad,
       s.genauigkeit,
       r.monat,
       r.gesamt                        AS ampel,
       coalesce(be.emoji, '⚪')         AS ampel_emoji,
       -- Der Beschriftungstext des Kartenpunkts. Bei eng beieinander
       -- liegenden Betrieben ist der Betriebsname allein mehrdeutig --
       -- die Marke davor macht auf einen Blick klar, um welches Haus es
       -- geht. Ein echtes Logo kann Metabase auf einer Karte nicht
       -- zeichnen; siehe docs/dashboards.md.
       coalesce(be.emoji, '⚪') || ' ' ||
       coalesce(kz.hauptkonzept || ' — ', '') || b.name AS punkt,
       r.umsatz_ist                    AS umsatz,
       r.personalkosten_ogf_pct,
       r.we_bar_pct,
       r.we_kueche_pct,
       r.intensitaet,
       r.prioritaet
  FROM manual.betrieb_standort s
  JOIN core.betrieb b                 ON b.betrieb_key  = s.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = s.betrieb_key
  LEFT JOIN mart.round_table_monat r  ON r.betrieb_key  = s.betrieb_key
  LEFT JOIN ampel.beschriftung be     ON be.status      = r.gesamt
 WHERE s.breitengrad IS NOT NULL;

COMMENT ON VIEW mart.standort IS
'Betriebe mit Koordinate, je Monat, mit der Round-Table-Gesamtampel — die Grundlage der
Karte. Eine Zeile je Betrieb UND Monat, deshalb in Metabase immer nach monat filtern, sonst
liegen sieben Punkte uebereinander.
LEER, SOLANGE manual.betrieb_standort LEER IST. Das ist kein Fehler: LINA liefert fuer
Betriebe keine Adresse, die Standorte muessen von Hand oder aus einer Liste von Concept
Family kommen. Wie viele fehlen, sagt mart.standort_fehlend.';


CREATE VIEW mart.standort_fehlend AS
SELECT b.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       b.aktiv,
       (u.umsatz > 0)  AS macht_umsatz,
       u.umsatz        AS umsatz_gesamt
  FROM core.betrieb b
  LEFT JOIN manual.betrieb_standort s  ON s.betrieb_key  = b.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz  ON kz.betrieb_key = b.betrieb_key
  LEFT JOIN LATERAL (
        SELECT sum(t.umsatz_netto) AS umsatz
          FROM mart.umsatz_tag t WHERE t.betrieb_key = b.betrieb_key
  ) u ON true
 WHERE s.betrieb_key IS NULL OR s.breitengrad IS NULL;

COMMENT ON VIEW mart.standort_fehlend IS
'Betriebe ohne Koordinate — die Arbeitsliste fuer die Karte, nach Umsatz sortierbar.
ERWARTUNG: mit der Zeit leer, zumindest fuer die Betriebe mit Umsatz. Am 26.07.2026 waren
das alle 141, weil LINA keine Adressen liefert.';
