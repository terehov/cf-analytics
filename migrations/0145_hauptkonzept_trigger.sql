-- =====================================================================
-- 0145 — Eine Hauptkonzept-Entscheidung wirkt sofort, nicht erst morgen.
--
-- ANLASS: 0144 hat Betrieb → Marke materialisiert. Der Preis stand ehrlich
-- dabei: Wer in Postico manual.betrieb_hauptkonzept pflegt, sah die Wirkung
-- erst nach dem naechsten Nachtlauf. Eugene (29.10.2026): „Koennen wir hier
-- nicht einen Trigger bauen, der es sofort nachzieht?" — koennen wir.
--
-- NACHGEMESSEN, bevor es gebaut wurde (29.10.2026, PostgreSQL 18, lokal):
-- REFRESH MATERIALIZED VIEW CONCURRENTLY und ANALYZE laufen beide innerhalb
-- eines Statement-Triggers, sehen die Aenderung derselben Transaktion und
-- gelten nach COMMIT; ein ROLLBACK nimmt den Refresh mit zurueck. Weder
-- REFRESH CONCURRENTLY noch ANALYZE stehen auf der Liste der Befehle, die
-- Postgres ausserhalb eines Transaktionsblocks verlangt (das ist VACUUM).
--
-- NUR DIESE EINE TABELLE, mit Absicht:
--   * core.betrieb und core.betrieb_konzept schreibt der Importer in Phase A.
--     Phase A liest mart.konzept_zuordnung nicht, und Phase B frischt die
--     Basis als ersten Nachlauf auf (0144). Ein Trigger dort brachte nichts
--     und haette einen Weg mehr, auf dem ein Stammdatenlauf scheitern kann.
--   * manual.betrieb_hauptkonzept schreibt nur ein Mensch, als cf. cf
--     besitzt die Materialisierung, deshalb kein SECURITY DEFINER: die
--     Funktion laeuft mit den Rechten dessen, der schreibt, und das reicht.
--
-- Scheitert der Refresh, scheitert die Pflege — laut, vor dem Menschen, der
-- gerade schreibt. Das ist hier die richtige Seite: eine still veraltete
-- Marke ist genau das, was 0144 abschaffen sollte. Der Merker wird
-- mitgeschrieben, damit mart.materialisierung_stand die Wahrheit sagt.
-- =====================================================================

CREATE OR REPLACE FUNCTION manual.hauptkonzept_nachziehen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, mart, sync
AS $$
DECLARE
    t0 timestamptz := clock_timestamp();
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mart.konzept_zuordnung_basis;
    -- Die Statistik ist der Zweck der Materialisierung (0144); REFRESH
    -- schreibt sie nicht.
    ANALYZE mart.konzept_zuordnung_basis;

    INSERT INTO sync.merker (schluessel, wert)
    VALUES ('konzept_zuordnung_refresh',
            jsonb_build_object(
                'dauer_s', round(extract(epoch FROM clock_timestamp() - t0)::numeric, 1),
                'anlass',  'trigger ' || TG_OP || ' auf manual.betrieb_hauptkonzept'))
    ON CONFLICT (schluessel)
    DO UPDATE SET wert = EXCLUDED.wert, gesetzt_am = now();

    RETURN NULL;
END $$;

COMMENT ON FUNCTION manual.hauptkonzept_nachziehen() IS
'Frischt mart.konzept_zuordnung_basis nach jeder Aenderung an
manual.betrieb_hauptkonzept auf (Migration 0145), mit ANALYZE und Merker.
Statement-Trigger: einmal je Befehl, nicht je Zeile.';

DROP TRIGGER IF EXISTS hauptkonzept_nachziehen ON manual.betrieb_hauptkonzept;
CREATE TRIGGER hauptkonzept_nachziehen
    AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON manual.betrieb_hauptkonzept
    FOR EACH STATEMENT
    EXECUTE FUNCTION manual.hauptkonzept_nachziehen();

-- Der Kommentar aus 0004, um den einen Satz ergaenzt, der sich geaendert hat.
COMMENT ON TABLE manual.betrieb_hauptkonzept IS
'Welche Marke gilt fuer einen Betrieb, der in LINA in mehreren Konzepten haengt.
Nur fuer die Mehrdeutigen noetig - wer genau ein Konzept hat, wird automatisch zugeordnet.
Diese Tabelle gewinnt immer, auch gegen eine eindeutige LINA-Zuordnung: wenn LINA falsch
gruppiert, ist das hier die Stelle zum Geradeziehen.
Wirkt SOFORT in mart.konzept_zuordnung und allen Sichten darueber: ein Trigger (0145)
frischt mart.konzept_zuordnung_basis beim Schreiben auf.';
