-- Der Katalogabzug als EINE JSON-Zelle — fuer Postico, wenn der Weg ueber
-- `bun run katalog:abzug` nicht zur Verfuegung steht (29.10.2026: Passwort
-- lag nur in Postico). Dieselben drei Abfragen wie in katalog_export.ts;
-- Sortierung und Form uebernimmt danach `bun run katalog:normieren <datei>`.
-- Ergebniszelle kopieren, als Datei speichern, normieren. json statt jsonb,
-- damit die Reihenfolge der Schluessel die der Abfrage bleibt.
SELECT json_build_object(
  'sichten', (
    SELECT coalesce(json_agg(json_build_object(
             'sicht', s.sicht, 'koernung', s.koernung, 'thema', s.thema,
             'summen_erlaubt', s.summen_erlaubt,
             'kommentar', obj_description(c.oid, 'pg_class'),
             'spalten', coalesce(sp.spalten, ARRAY[]::text[]),
             'achsen', coalesce(a.achsen, ARRAY[]::text[]),
             'kennzahlen', coalesce(k.kennzahlen, '[]'::jsonb),
             'fallstricke', '[]'::jsonb) ORDER BY s.sicht), '[]'::json)
      FROM mcp.sicht s
      LEFT JOIN pg_class c ON c.relname = split_part(s.sicht, '.', 2)
           AND c.relnamespace = 'mart'::regnamespace
      LEFT JOIN LATERAL (SELECT array_agg(att.attname::text ORDER BY att.attnum) AS spalten
                           FROM pg_attribute att
                          WHERE att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped) sp ON true
      LEFT JOIN LATERAL (SELECT array_agg(sa.achse ORDER BY sa.achse) AS achsen
                           FROM mcp.sicht_achse sa WHERE sa.sicht = s.sicht) a ON true
      LEFT JOIN LATERAL (
            SELECT jsonb_agg(jsonb_build_object('spalte', kz.spalte, 'regel', kz.regel,
                     'einheit', kz.einheit, 'hinweis', kz.hinweis) ORDER BY kz.spalte) AS kennzahlen
              FROM mcp.kennzahl kz WHERE kz.sicht = s.sicht) k ON true),
  'achsen', (
    SELECT coalesce(json_agg(json_build_object(
             'achse', achse, 'bezeichnung', bezeichnung, 'art', art, 'ziel_sicht', ziel_sicht,
             'ziel_spalte', ziel_spalte, 'anzeige_spalte', anzeige_spalte, 'hinweis', hinweis)
             ORDER BY achse), '[]'::json)
      FROM mcp.achse),
  'fallstricke', (
    SELECT coalesce(json_agg(json_build_object(
             'schluessel', schluessel, 'art', art, 'schwere', schwere, 'sicht', sicht,
             'parameter', parameter, 'hinweis', hinweis, 'berichtigung', berichtigung, 'quelle', quelle)
             ORDER BY schluessel), '[]'::json)
      FROM mcp.fallstrick WHERE aktiv)
)::text AS katalog;
