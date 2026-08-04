-- ---------------------------------------------------------------------
-- Migration 0037 · Einzelne Bewertungen — zum Lesen, nicht zum Rechnen
--
-- BEWUSSTE ABWEICHUNG VON docs/yext-anbindung.md §3.
--
-- Dort steht: "authorName, authorEmail und der Bewertungstext (content,
-- comments) werden NICHT gespeichert. Fuer eine Monatskennzahl sind sie
-- nicht noetig, und personenbezogene Daten ohne Zweck zu speichern wollen
-- wir vermeiden. Sollte spaeter eine Textauswertung gewuenscht sein, kaeme
-- das als eigener Antrag mit eigener datenschutzrechtlicher Pruefung --
-- nicht durch die Hintertuer dieses Zugangs."
--
-- Diese Migration IST dieser eigene Antrag, ausdruecklich entschieden am
-- 03.08.2026: Eugene will die besten und schlechtesten Bewertungen eines
-- Betriebs lesen koennen. Eine Zahl sagt, DASS ein Haus abrutscht; erst
-- der Text sagt, WORAN es liegt -- Service, Wartezeit, Kueche. Ohne das
-- ist die Kennzahl eine Ampel ohne Ursache.
--
-- WAS TROTZDEM NICHT GESPEICHERT WIRD: der Autorenname. Er ist das
-- einzige Feld, das eindeutig eine Person benennt, und zum Lesen einer
-- Bewertung braucht ihn niemand. Ebenso wenig die Antworten des Betriebs
-- (`comments`). Wer die Bewertung im Zusammenhang sehen will, folgt der
-- gespeicherten URL zur Quelle -- dort steht ohnehin alles, oeffentlich.
--
-- WOFUER DIESE TABELLE NICHT DA IST: die Kennzahl. Die kommt weiterhin
-- aus core.bewertung_stand, also aus Yexts eigenem Aggregat. Der Grund
-- ist Drift: eine geloeschte Bewertung verschwindet bei Yext aus dem
-- Durchschnitt, unsere Kopie hier bliebe stehen. Wer aus dieser Tabelle
-- einen Schnitt rechnet, bekommt darum eine andere Zahl als der Round
-- Table -- und die falsche.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS core.bewertung (
    quelle         text        NOT NULL DEFAULT 'yext',
    -- Die ID der Bewertung beim Anbieter. Traegt keine Aussage ueber die
    -- Person, sondern ueber den Datensatz -- und macht den Import
    -- wiederholbar, ohne dass Zeilen doppelt entstehen.
    bewertung_id   text        NOT NULL,
    betrieb_key    integer     NOT NULL REFERENCES core.betrieb(betrieb_key),
    publisher      text        NOT NULL,
    rating         numeric(2,1),
    publiziert_am  timestamptz NOT NULL,
    -- 'LIVE' zaehlt. 'QUARANTINED' und 'REMOVED' werden gar nicht erst
    -- geholt, die Spalte haelt den Stand fest, falls sich das aendert.
    status         text        NOT NULL,
    -- Der Text der Bewertung. Oft leer: viele Gaeste vergeben nur Sterne.
    inhalt         text,
    -- Link zur Quelle. Der Ersatz fuer alles, was wir NICHT speichern.
    url            text,
    geladen_am     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (quelle, bewertung_id),
    CONSTRAINT bewertung_skala CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
);

COMMENT ON TABLE core.bewertung IS
'Einzelne Online-Bewertungen zum LESEN (Quelle Yext). Ohne Autorenname und ohne
Antworten des Betriebs; wer den Zusammenhang braucht, folgt der URL.
NICHT die Grundlage der Kennzahl -- die kommt aus core.bewertung_stand, also
aus Yexts eigenem Aggregat. Eine geloeschte Bewertung faellt dort sofort raus,
hier erst beim naechsten vollen Lauf.';

COMMENT ON COLUMN core.bewertung.inhalt IS
'Bewertungstext, wie er oeffentlich beim Portal steht. Haeufig leer -- viele
Gaeste vergeben nur Sterne.';

CREATE INDEX IF NOT EXISTS bewertung_betrieb_datum_idx
    ON core.bewertung (betrieb_key, publiziert_am DESC);
-- Fuer "beste" und "schlechteste": der Teilindex laesst die Sternchen-ohne-Text
-- weg, und das sind rund zwei Drittel aller Zeilen.
CREATE INDEX IF NOT EXISTS bewertung_betrieb_rating_idx
    ON core.bewertung (betrieb_key, rating)
 WHERE inhalt IS NOT NULL AND inhalt <> '';


-- ---------------------------------------------------------------------
-- Die Lesesicht
--
-- Bringt den Betriebsnamen mit und laesst weg, was nicht lesbar ist:
-- Bewertungen ohne Text sind fuer "was schreiben die Gaeste" wertlos, und
-- eine Liste, in der neun von zehn Zeilen leer sind, beantwortet die
-- Frage nicht.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.bewertung_einzel AS
SELECT b.betrieb_key,
       bt.name                                   AS betrieb,
       kz.hauptkonzept                           AS konzept,
       b.quelle,
       b.publisher,
       b.rating,
       b.publiziert_am,
       b.publiziert_am::date                     AS datum,
       date_trunc('month', b.publiziert_am)::date AS monat,
       b.inhalt,
       b.url
  FROM core.bewertung b
  JOIN core.betrieb bt USING (betrieb_key)
  LEFT JOIN mart.konzept_zuordnung kz USING (betrieb_key)
 WHERE b.status = 'LIVE'
   AND b.rating IS NOT NULL
   AND coalesce(btrim(b.inhalt), '') <> '';

COMMENT ON VIEW mart.bewertung_einzel IS
'Einzelne Bewertungen MIT Text, je Betrieb -- die Lesesicht hinter der Kennzahl.
Sternewertungen ohne Text sind ausgelassen: sie beantworten die Frage "was
schreiben die Gaeste" nicht. Kein Autorenname; die Spalte url fuehrt zur Quelle.
Nicht zum Rechnen -- dafuer ist mart.bewertung_verlauf da.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0037', to_jsonb(
        'Einzelne Bewertungen (core.bewertung, mart.bewertung_einzel) zum Lesen. '
        'Ausdrueckliche Abweichung von yext-anbindung.md §3, entschieden am '
        '03.08.2026 -- ohne Autorenname und ohne Antworten des Betriebs. '
        'Die Kennzahl bleibt bei core.bewertung_stand.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
