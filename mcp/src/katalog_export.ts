/**
 * Den Katalog als JSON ausgeben — die Abzugsdatei fuer die Tests.
 *
 * WARUM EINE ABZUGSDATEI. Die zehn Fallenfragen sind die Regressionssicherung
 * dieses Vorhabens; sie muessen bei jedem `bun test` laufen, auch ohne
 * Datenbank. Damit die Abzugsdatei nicht unbemerkt von den Migrationen
 * abdriftet, vergleicht `katalog_abzug.test.ts` sie gegen die echte
 * Datenbank, sobald MCP_DATABASE_URL gesetzt ist.
 *
 *   bun run mcp/src/katalog_export.ts > mcp/test/katalog.json
 *
 * WARUM HIER NICHT mcp.sicht_katalog GELESEN WIRD, obwohl der Server das tut:
 * jene Sicht blendet entfallene Sichten aus, und das ist im Betrieb richtig —
 * `sichten_suchen` soll nichts anbieten, was es nicht gibt. Ein Abzug soll
 * dagegen den VOLLEN Stand abbilden, auch wenn er aus einer unvollstaendigen
 * Datenbank gezogen wird: eine Entwicklungsdatenbank, in der die Migrationen
 * nicht alle durchlaufen (docs/fehlerkatalog.md, 13.09.2026), wuerde sonst
 * eine Fallenfrage stillschweigend nicht mehr pruefen — genau der Ausfall,
 * gegen den die Tests geschrieben sind.
 */
import { abfragen, poolBeenden } from './db'

const [sichten, achsen, fallstricke] = await Promise.all([
  abfragen(`SELECT s.sicht, s.koernung, s.thema, s.summen_erlaubt,
                   obj_description(c.oid, 'pg_class')      AS kommentar,
                   coalesce(sp.spalten, ARRAY[]::text[])   AS spalten,
                   coalesce(a.achsen, ARRAY[]::text[])     AS achsen,
                   coalesce(k.kennzahlen, '[]'::jsonb)     AS kennzahlen,
                   '[]'::jsonb                             AS fallstricke
              FROM mcp.sicht s
              LEFT JOIN pg_class c ON c.relname = split_part(s.sicht, '.', 2)
                   AND c.relnamespace = 'mart'::regnamespace
              LEFT JOIN LATERAL (SELECT array_agg(col.column_name::text ORDER BY col.ordinal_position) AS spalten
                                   FROM information_schema.columns col
                                  WHERE col.table_schema = split_part(s.sicht, '.', 1)
                                    AND col.table_name   = split_part(s.sicht, '.', 2)) sp ON true
              LEFT JOIN LATERAL (SELECT array_agg(sa.achse ORDER BY sa.achse) AS achsen
                                   FROM mcp.sicht_achse sa WHERE sa.sicht = s.sicht) a ON true
              LEFT JOIN LATERAL (
                    SELECT jsonb_agg(jsonb_build_object('spalte', kz.spalte, 'regel', kz.regel,
                             'einheit', kz.einheit, 'hinweis', kz.hinweis) ORDER BY kz.spalte) AS kennzahlen
                      FROM mcp.kennzahl kz WHERE kz.sicht = s.sicht) k ON true
             ORDER BY s.sicht`),
  abfragen(`SELECT achse, bezeichnung, art, ziel_sicht, ziel_spalte, anzeige_spalte, hinweis
              FROM mcp.achse ORDER BY achse`),
  abfragen(`SELECT schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle
              FROM mcp.fallstrick WHERE aktiv ORDER BY schluessel`),
])

console.log(JSON.stringify({ sichten, achsen, fallstricke }, null, 1))
await poolBeenden()
