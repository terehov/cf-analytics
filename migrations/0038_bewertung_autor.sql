-- ---------------------------------------------------------------------
-- Migration 0038 · Der Autor einer Bewertung
--
-- Migration 0037 hat den Autorennamen ausdruecklich WEGGELASSEN, mit der
-- Begruendung, er sei das einzige Feld, das eindeutig eine Person benennt,
-- und zum Lesen einer Bewertung brauche ihn niemand.
--
-- REVIDIERT AM 03.08.2026, von Eugene: "Lad die Autoren der Bewertungen
-- mit. Beim Abgeben der Bewertung haben sie der Verarbeitung zugestimmt."
--
-- Das traegt, und es ist mehr als eine Formalie: der Name steht bei Google,
-- TripAdvisor und OpenTable oeffentlich neben der Bewertung, sichtbar fuer
-- jeden. Wir speichern damit nichts, was nicht ohnehin oeffentlich neben
-- dem Text steht -- und wer im Restaurant auf eine Kritik antworten will,
-- muss wissen, an wen.
--
-- Praktisch kommt dazu: wiederkehrende Namen sind erkennbar. Dieselbe
-- Person, die dreimal in einem Monat einen Stern vergibt, ist etwas
-- anderes als drei enttaeuschte Gaeste, und ohne Namen sieht beides gleich
-- aus.
--
-- Was weiterhin NICHT gespeichert wird: `authorEmail` (liefert Yext bei
-- den hier genutzten Portalen ohnehin nicht) und die Antworten des
-- Betriebs (`comments`).
-- ---------------------------------------------------------------------

ALTER TABLE core.bewertung
    ADD COLUMN IF NOT EXISTS autor text;

COMMENT ON COLUMN core.bewertung.autor IS
'Anzeigename des Autors, wie er oeffentlich beim Portal neben der Bewertung
steht. Aufgenommen am 03.08.2026 (Migration 0038) -- Migration 0037 hatte ihn
bewusst ausgelassen, die Entscheidung wurde revidiert. Keine E-Mail-Adresse.';

COMMENT ON TABLE core.bewertung IS
'Einzelne Online-Bewertungen zum LESEN (Quelle Yext): Note, Datum, Portal, Text,
Autorenname und Link zur Quelle. Ohne Antworten des Betriebs und ohne
E-Mail-Adressen.
NICHT die Grundlage der Kennzahl -- die kommt aus core.bewertung_stand, also
aus Yexts eigenem Aggregat. Eine geloeschte Bewertung faellt dort sofort raus,
hier erst beim naechsten vollen Lauf.';


-- Die Lesesicht neu, mit Autor. CREATE OR REPLACE VIEW kann keine Spalte
-- in der Mitte einfuegen, deshalb faellt sie einmal weg.
DROP VIEW IF EXISTS mart.bewertung_einzel;

CREATE VIEW mart.bewertung_einzel AS
SELECT b.betrieb_key,
       bt.name                                   AS betrieb,
       kz.hauptkonzept                           AS konzept,
       b.quelle,
       b.publisher,
       b.rating,
       b.publiziert_am,
       b.publiziert_am::date                     AS datum,
       date_trunc('month', b.publiziert_am)::date AS monat,
       b.autor,
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
schreiben die Gaeste" nicht. Nicht zum Rechnen -- dafuer ist
mart.bewertung_verlauf da.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0038', to_jsonb(
        'Autorenname zu core.bewertung. Revidiert Migration 0037, die ihn '
        'bewusst weggelassen hatte -- Entscheidung vom 03.08.2026: die Namen '
        'stehen oeffentlich neben der Bewertung, und wer antworten will, muss '
        'wissen an wen.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
