-- =====================================================================
-- 0130 — Ein abgelehnter Aufruf ist kein Baufehler, und er steht nicht
--        nur im Log
--
-- WAS PASSIERT IST. Vom 18.09. bis zum 05.10.2026 scheiterte jeder
-- Analytics-Aufruf an Yext mit HTTP 400: `The entityId "A_03" does not
-- exist`. Aposto Augsburg war in Yext geloescht worden, die Zuordnung in
-- manual.betrieb_fremd_id stand noch, und weil alle Betriebe in EINEM
-- Filter stehen, lehnte Yext den ganzen Bericht ab. Siebzehn Naechte ohne
-- Themen, Antworten, Noten und Sichtbarkeit — fuer alle 60 Betriebe.
--
-- WARUM ES NIEMAND SAH, an vier Stellen zugleich:
--
--   1. Der Nachlauf fing den Fehler ab und schrieb ihn NUR ins Log.
--   2. `/status` warnte nur bei LEEREN Analytics-Tabellen. Sie waren nicht
--      leer, also stand dort „Analytics gefuellt".
--   3. sync.ts meldete „yext: ok", weil der Nachlauf nicht warf.
--   4. mart.quelle_zulauf meldete die beiden Quellen zwar als stumm — aber
--      mit wird_noch_gefragt = false, also „Baufehler, wir fragen nicht
--      mehr". Das war falsch: an einer Tabelle laesst sich „gefragt" nicht
--      von „geliefert" trennen, und die Sicht setzte beides gleich. Die
--      Herabstufung des Laufs auf `teilweise` aenderte nichts, weil seit
--      dem 10.09. ohnehin jeder Lauf `teilweise` war, und die Notiz mit den
--      Namen zeigte mart.sync_status nicht.
--
-- WAS HIER GESCHIEHT:
--   * sync.quelle.merker — ein Merker, der den VERSUCH stempelt. Ist er
--     gesetzt, ist zuletzt_gefragt der juengere von Tabelle und Merker.
--   * mart.quelle_zulauf bekommt letzter_fehler (aus demselben Merker).
--   * mart.sync_status bekommt die Notiz des Laufs.
-- Der Code dazu: src/yext/analytics.ts (gelöschte Entitaet ausklammern),
-- src/yext/nachlauf.ts (Merker `yext_analytics`), src/status.ts.
-- =====================================================================

ALTER TABLE sync.quelle ADD COLUMN IF NOT EXISTS merker text;

COMMENT ON COLUMN sync.quelle.merker IS
'Nur fuer Quellen, die an der Tabelle gemessen werden: ein Schluessel in sync.merker,
dessen wert->>''beendet_am'' den letzten VERSUCH stempelt und wert->>''ok'' / ''fehler''
seinen Ausgang. Ohne ihn ist "gefragt" dasselbe wie "geliefert" — und ein abgelehnter
Aufruf sieht aus wie ein Importer, der nicht mehr fragt (Yext, 18.09.–05.10.2026).';


-- Spaltenfolge und -typen wie in 0076, letzter_fehler haengt am Ende an
-- (CREATE OR REPLACE VIEW kann nur anhaengen).
CREATE OR REPLACE VIEW mart.quelle_zulauf AS
WITH g AS (
    SELECT q.*,
           m.zuletzt_zulauf,
           greatest(m.zuletzt_gefragt, (mk.wert->>'beendet_am')::timestamptz) AS zuletzt_gefragt,
           CASE WHEN (mk.wert->>'ok')::boolean IS FALSE THEN mk.wert->>'fehler' END AS letzter_fehler
      FROM sync.quelle q
      JOIN mart.quelle_messen() m ON m.quelle = q.quelle
      LEFT JOIN sync.merker mk ON mk.schluessel = q.merker
)
SELECT g.quelle,
       g.bezeichnung,
       g.system,
       g.kadenz_stunden,
       g.erwartet,
       g.bemerkung,
       g.zuletzt_gefragt,
       g.zuletzt_zulauf,
       round(EXTRACT(epoch FROM (now() - g.zuletzt_zulauf)) / 3600, 1) AS stunden_ohne_zulauf,
       CASE
         WHEN NOT g.erwartet                    THEN 'nicht erwartet'
         WHEN g.zuletzt_zulauf IS NULL          THEN 'nie'
         WHEN g.zuletzt_zulauf
              < now() - make_interval(hours => g.kadenz_stunden) THEN 'stumm'
         ELSE 'ok'
       END AS zustand,
       g.zuletzt_gefragt IS NOT NULL
         AND g.zuletzt_gefragt >= now() - make_interval(hours => g.kadenz_stunden)
         AS wird_noch_gefragt,
       g.letzter_fehler
  FROM g
 ORDER BY g.erwartet DESC, g.system, g.quelle;

COMMENT ON VIEW mart.quelle_zulauf IS
'Bekommt jede Quelle noch Zulauf? Die Sicht zu AGENTS.md Regel 10.

  ok               Zulauf innerhalb der erwarteten Kadenz.
  stumm            seit laenger als kadenz_stunden keine Zeile mehr. Auf
                   wird_noch_gefragt sehen: false heisst, der Importer fragt
                   nicht mehr — ein Baufehler. true heisst, die Quelle liefert
                   nichts — ein Befund; steht letzter_fehler daneben, lehnt
                   sie ab, und dort steht warum.
  nie              es ist noch nie eine Zeile entstanden.
  nicht erwartet   liefert bewusst nichts, mit Begruendung in bemerkung.

SEIT 0130: Bei Quellen mit sync.quelle.merker ist zuletzt_gefragt der juengere von
Tabelle und Merker. Vorher galt fuer jede an der Tabelle gemessene Quelle "gefragt =
geliefert", und Yexts abgelehnte Analytics-Aufrufe erschienen 17 Tage lang als
"wird nicht mehr gefragt".';


CREATE OR REPLACE VIEW mart.sync_status AS
SELECT lauf_id,
       gestartet_am,
       beendet_am,
       ausloeser,
       status,
       aufgaben_gesamt,
       aufgaben_ok,
       aufgaben_fehler,
       aufgaben_uebersprungen,
       round(EXTRACT(epoch FROM beendet_am - gestartet_am), 1) AS dauer_s,
       (SELECT count(*) FROM sync.schema_abweichung a
         WHERE a.erkannt_am >= l.gestartet_am AND a.quittiert_am IS NULL) AS offene_abweichungen,
       (SELECT count(*) FROM sync.fortschritt f
         WHERE f.pausiert_bis > now()) AS pausierte_kombinationen,
       l.tagesgeschaeft_bis,
       l.ableitungen_bis,
       l.nachladen_posten,
       l.nachladen_offen,
       -- SEIT 0130. Hier stehen die stummen Quellen mit Namen. `teilweise`
       -- allein sagt seit dem 10.09.2026 nichts mehr — es ist der Normalfall.
       l.notiz
  FROM sync.lauf l
 ORDER BY lauf_id DESC;
