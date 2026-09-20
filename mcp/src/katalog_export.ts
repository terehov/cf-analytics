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
import { nachSchluessel, sortiert } from './katalog_ordnung'

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
              -- SPALTEN AUS pg_attribute, nicht aus information_schema.columns:
              -- dort stehen materialisierte Sichten nicht, und der Abzug
              -- fuehrte vierzehn Sichten ohne eine einzige Spalte — darunter
              -- mart.round_table_monat. Hergang in Migration 0108.
              LEFT JOIN LATERAL (SELECT array_agg(att.attname::text ORDER BY att.attnum) AS spalten
                                   FROM pg_attribute att
                                  WHERE att.attrelid = c.oid
                                    AND att.attnum > 0
                                    AND NOT att.attisdropped) sp ON true
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

/*
 * SORTIERT WIRD HIER, NICHT IN SQL.
 *
 * Die ORDER BY oben stehen weiter da, damit die Abfragen fuer sich lesbar
 * bleiben — verlassen darf sich der Abzug nicht auf sie: ihre Reihenfolge
 * haengt an der Kollation der Datenbank, und die ist auf macOS eine andere
 * als auf dem Server. Begruendung und Messung in katalog_ordnung.ts.
 *
 * Auch die verschachtelten Listen: `achsen` und `kennzahlen` kamen aus
 * array_agg/jsonb_agg mit ORDER BY und trugen denselben Fehler in sich.
 * `spalten` bleibt unberuehrt — dort ist die Reihenfolge die der Spalten in
 * der Sicht und damit eine Aussage, keine Sortierung.
 */
const sichtenStabil = nachSchluessel(sichten as any[], s => s.sicht)
  .map(s => ({
    ...s,
    achsen: sortiert(s.achsen ?? []),
    kennzahlen: nachSchluessel((s.kennzahlen ?? []) as any[], k => k.spalte),
  }))

console.log(JSON.stringify({
  sichten:     sichtenStabil,
  achsen:      nachSchluessel(achsen as any[], a => a.achse),
  fallstricke: nachSchluessel(fallstricke as any[], f => f.schluessel),
}, null, 1))
await poolBeenden()
