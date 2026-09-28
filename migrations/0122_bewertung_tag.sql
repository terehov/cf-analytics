-- =====================================================================
-- 0122 Bewertungen je Tag — der Monat, nicht der Stand bis zum Monat
--
-- ANLASS (28.09.2026, Eugene): "Wenn ich einen Monat waehle, will ich die
-- Bewertungen und den Schnitt DIESES Monats sehen und nicht alles bis zu
-- diesem Monat — um etwa zu sehen, ob der Mai besser lief als der April.
-- Die Zahlen weichen von den Werkzeugen ab, mit denen sie bisher
-- gearbeitet haben."
--
-- Die erste Kachel auf "Online-Bewertungen" hiess "Ø Bewertung" und zeigte
-- den STAND: den Schnitt ueber alle Bewertungen seit Beginn, bis zum Ende
-- des gewaehlten Monats (mart.bewertung_verlauf.schnitt_stand). Rangliste
-- und Markenbalken genauso. Wer "Juli" waehlt und daneben Yext fuer Juli
-- aufmacht, vergleicht 137.000 Google-Bewertungen seit 2010 mit 1.400 aus
-- einem Monat. Zwei Monate lassen sich so nicht vergleichen: der Stand
-- bewegt sich von April auf Mai um Hundertstel, egal wie der Mai lief.
--
-- ALLE PORTALE (Entscheidung Eugene, 28.09.2026). Der Monatswert zaehlt
-- Google, OpenTable, TripAdvisor und die kleinen Portale zusammen. Die
-- AMPEL bleibt beim Google-Stand (manual.online_bewertung_aus_yext,
-- unveraendert) — sie ist eine Aussage ueber das, was ein Gast auf Google
-- sieht. Folge, die man kennen muss: TripAdvisor bewertet rund 0,9 Sterne
-- strenger als Google (bw_portalvergleich). Ein Monatswert ueber alle
-- Portale liegt deshalb systematisch UNTER dem Google-Stand und darf nicht
-- gegen ihn gestellt werden — die Fruehwarnung (Monat gegen Stand) bleibt
-- aus diesem Grund bei Google.
--
-- ZWEI ZAEHLER, weil nicht jedes Portal Sterne vergibt. Facebook und
-- Foursquare fuehren "empfohlen / nicht empfohlen" (0036). `bewertungen`
-- zaehlt jede Bewertung — das ist die Zahl, die ein Gast als "neue
-- Bewertungen" liest. `bewertet` zaehlt nur die mit Sternen und ist der
-- Nenner des Schnitts; sonst verduennte jede Facebook-Empfehlung ihn.
--
-- WARUM AUS DEN EINZELBEWERTUNGEN und nicht aus der Differenz zweier
-- Staende. 0037 sagt "nicht die Grundlage der Kennzahl" und nennt als
-- Grund Drift: eine geloeschte Bewertung faellt bei Yext sofort aus dem
-- Schnitt, hier erst beim naechsten vollen Lauf. Nachgemessen am
-- 28.09.2026 auf dem lokalen Stand (Juli 2026 letzter voller Monat):
--
--   * Google, Stand Ende Juli, 60 Betriebe: Yext 137.110 Bewertungen,
--     Einzelbewertungen 137.110. Schnitt 4,272 gegen 4,272. Kein Betrieb
--     weicht um mehr als 1 % ab.
--   * Je Betrieb und Monat (24 Monate): Anzahl in UTC-Monaten EXAKT gleich,
--     Schnitt je Betrieb nirgends mehr als 0,1 auseinander — der Rest ist
--     die Rundung von schnitt_monat auf zwei Stellen.
--
-- Die Drift ist messbar null. Die Staende gibt es ausserdem nur fuer
-- Google und 'ALLE', nicht je Portal und nicht je Tag.
--
-- DER TAG IST DER DEUTSCHE KALENDERTAG (Europe/Berlin), nicht der
-- UTC-Tag. Wer "Juli" waehlt, meint den Juli in Deutschland. Yext schneidet
-- seine Monatsstaende in UTC; der Unterschied ist die Stunde nach
-- Mitternacht am Monatsersten und lag in den 24 gemessenen Monaten bei
-- 0 bis 4 Bewertungen je Monat ueber alle Betriebe (von rund 1.300).
--
-- WAS DIE SICHT NICHT TRIFFT: Yexts Analytics-Zahlen. Die Anzahl in
-- core.bewertung_antwort / mart.bewertung_note liegt 2–3 % ueber den
-- Einzelbewertungen (September 2025: 1.740 gegen 1.698, alle Portale) — Yext
-- zaehlt dort Bewertungen mit, die die Bewertungsliste nicht ausliefert.
-- =====================================================================

CREATE OR REPLACE VIEW mart.bewertung_tag AS
WITH t AS (
    SELECT b.betrieb_key,
           b.publisher,
           (b.publiziert_am AT TIME ZONE 'Europe/Berlin')::date AS tag,
           count(*)::integer                                     AS bewertungen,
           count(b.rating)::integer                              AS bewertet,
           coalesce(sum(b.rating), 0)                            AS sterne_summe,
           count(*) FILTER (WHERE b.rating <= 2)::integer        AS schlecht,
           count(*) FILTER (WHERE b.rating >= 4)::integer        AS gut
      FROM core.bewertung b
     WHERE b.status = 'LIVE'
     GROUP BY 1, 2, 3
)
SELECT t.betrieb_key,
       bt.name                              AS betrieb,
       kz.hauptkonzept                      AS konzept,
       t.publisher,
       t.tag,
       date_trunc('month', t.tag)::date     AS monat,
       t.bewertungen,
       t.bewertet,
       t.sterne_summe,
       t.schlecht,
       t.gut
  FROM t
  JOIN core.betrieb bt USING (betrieb_key)
  LEFT JOIN mart.konzept_zuordnung kz USING (betrieb_key);

COMMENT ON VIEW mart.bewertung_tag IS
'Online-Bewertungen je Betrieb, deutschem Kalendertag und Portal, gezaehlt aus den
Einzelbewertungen (Yext). Fuer Monat und Zeitraum: Schnitt = sum(sterne_summe) /
sum(bewertet) — nie Tagesschnitte mitteln, nie durch bewertungen teilen. NICHT der
Stand, den ein Gast auf Google sieht (der steht kumuliert in
mart.bewertung_verlauf.schnitt_stand und traegt die Ampel). Ueber alle Portale liegt
der Schnitt systematisch unter dem Google-Stand (TripAdvisor bewertet strenger).';

COMMENT ON COLUMN mart.bewertung_tag.tag IS
'Deutscher Kalendertag der Veroeffentlichung (Europe/Berlin). Yext schneidet seine
Monatsstaende in UTC — am Monatsersten kann eine Bewertung deshalb einen Monat
frueher stehen als in mart.bewertung_verlauf.';
COMMENT ON COLUMN mart.bewertung_tag.bewertungen IS
'Alle Bewertungen, auch ohne Sterne (Facebook-Empfehlungen). Nicht der Nenner des Schnitts.';
COMMENT ON COLUMN mart.bewertung_tag.bewertet IS
'Bewertungen mit Sternen — der Nenner des Schnitts.';
COMMENT ON COLUMN mart.bewertung_tag.sterne_summe IS
'Summe der Sterne. Geteilt durch bewertet ergibt den Schnitt des Zeitraums.';
COMMENT ON COLUMN mart.bewertung_tag.schlecht IS 'Bewertungen mit 1 oder 2 Sternen.';
COMMENT ON COLUMN mart.bewertung_tag.gut IS 'Bewertungen mit 4 oder 5 Sternen.';


-- ---------------------------------------------------------------------
-- MCP-Katalog: Koernung und wie die Spalten zusammengefasst werden duerfen
-- ---------------------------------------------------------------------
SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht
   SET koernung = 'Betrieb × deutschem Kalendertag × Portal — gezaehlte Einzelbewertungen; '
                  'Schnitt eines Zeitraums = sum(sterne_summe) / sum(bewertet), NICHT der Stand',
       thema = 'bewertung',
       summen_erlaubt = true
 WHERE sicht = 'mart.bewertung_tag';

INSERT INTO mcp.kennzahl (sicht, spalte, regel, einheit, hinweis) VALUES
  ('mart.bewertung_tag', 'bewertungen', 'summe', 'anzahl',
   'Alle Bewertungen des Tages, auch ohne Sterne. Nicht der Nenner des Schnitts.'),
  ('mart.bewertung_tag', 'bewertet', 'summe', 'anzahl',
   'Bewertungen mit Sternen — Nenner des Schnitts.'),
  ('mart.bewertung_tag', 'sterne_summe', 'summe', NULL,
   'Nur als Zaehler des Schnitts: sum(sterne_summe) / sum(bewertet).'),
  ('mart.bewertung_tag', 'schlecht', 'summe', 'anzahl', '1–2 Sterne.'),
  ('mart.bewertung_tag', 'gut', 'summe', 'anzahl', '4–5 Sterne.')
ON CONFLICT (sicht, spalte) DO NOTHING;


-- ---------------------------------------------------------------------
-- Probe: die Sicht ist fuer mcp_leser lesbar. Die Rechte kommen aus den
-- Standardrechten (0105); geprueft wird unter der Rolle selbst, weil ein
-- Lesen als Eigentuemer nichts beweist.
-- ---------------------------------------------------------------------
DO $probe$
BEGIN
    SET LOCAL ROLE mcp_leser;
    PERFORM 1 FROM mart.bewertung_tag LIMIT 1;
    RESET ROLE;
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '0122: mart.bewertung_tag ist fuer mcp_leser nicht lesbar (%: %)',
        SQLSTATE, SQLERRM;
END $probe$;
