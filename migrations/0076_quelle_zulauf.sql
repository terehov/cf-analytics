-- =====================================================================
-- 0076 — Der Waechter: Zulauf je Quelle (Plan Phase 4)
--
-- DER KONSTRUKTIONSFEHLER HINTER ALLEN BEFUNDEN DIESES PLANS lautet in
-- einem Satz: **Stillstand sieht aus wie Erfolg.**
--
--   02.08.2026  LINA stand acht Tage still. Der Sync lief fehlerfrei.
--   12.08.2026  Das Belegarchiv fror ein. Die Laeufe 85 bis 88 meldeten
--               269 von 269 Aufgaben "ok" und holten null Belege.
--
-- Beide Male gab es die Zahl, die es verraten haette — sie stand nur
-- nirgends. Ein Importer ohne Arbeit sieht genauso aus wie einer, der
-- fertig ist (AGENTS.md Regel 10).
--
-- WAS DIESE MIGRATION BAUT: eine Stelle, an der steht, welche Quelle in
-- welchem Takt Zulauf haben MUSS, und eine Sicht, die das nachmisst.
-- Nicht ein Log-WARN: Logs liest niemand. Die Erwartung gehoert
-- aufgeschrieben, sonst ist sie im Kopf dessen, der zuletzt hingesehen
-- hat.
--
-- ZWEI ZAHLEN, NICHT EINE, und das ist der Kern:
--
--   zuletzt_gefragt   wann der Importer diese Quelle zuletzt ANGEFASST hat
--   zuletzt_zulauf    wann daraus zuletzt eine Zeile ENTSTANDEN ist
--
-- Der Unterschied ist genau der Fehler vom 12.08.: dort wurde nicht
-- einmal mehr gefragt. Und er ist auch der Fehler vom 10.08. bei Yext:
-- dort war der Zeitstempel frisch und die Tabellen leer. Eine Zahl
-- allein haette beide Male beruhigt.
--
-- KLEIN GEHALTEN, wie der Plan verlangt: eine Tabelle, eine Funktion,
-- eine Sicht, eine Pruefzeile. Ein Waechter, der drei Wochen Arbeit ist,
-- entsteht nie.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Das Register: was wir von welcher Quelle erwarten
--
-- Gefuellt wird es NICHT hier, sondern aus `src/sync/quellen.ts` bei
-- jedem Lauf. Das ist Absicht: die Erwartung gehoert neben die
-- Endpunkte, die sie beschreibt, und `waechter.test.ts` prueft ohne
-- Datenbank, dass kein aktiver Endpunkt fehlt. Ein Register in einer
-- Migration waere ein zweiter Ort, an dem dieselbe Sache falsch stehen
-- kann — und der zweite Ort ist immer der veraltete.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sync.quelle (
    quelle          text PRIMARY KEY,
    bezeichnung     text NOT NULL,
    system          text NOT NULL
                    CHECK (system IN ('lina','ladenakte','foodnotify','yext','intern')),

    -- Gemessen wird ENTWEDER ueber sync.aufgabe (der Importer hat es
    -- selbst protokolliert) ODER direkt an einer Tabelle (fuer die
    -- Nachlaeufe, die keine Aufgabe schreiben — Yext).
    endpunkt        text,
    schema_name     text,
    tabelle         text,
    zeitspalte      text,

    kadenz_stunden  integer NOT NULL CHECK (kadenz_stunden > 0),

    /*
     * erwartet = false heisst: diese Quelle liefert bewusst nichts.
     * LINAs Warenwirtschaft ist Demodaten (Regel 5), fuer Rezepte und
     * die POS-Artikelbruecke gibt es keinen Endpunkt.
     *
     * Sie stehen trotzdem hier, und das ist der Punkt: eine leere
     * Tabelle ohne Eintrag ist unsichtbar, eine leere Tabelle MIT
     * Eintrag und Begruendung ist eine Entscheidung. Gezaehlt werden
     * sie nicht — eine Pruefzeile, die nie auf null geht, liest
     * niemand mehr (dieselbe Ueberlegung wie in 0070, 0071 und 0073).
     */
    erwartet        boolean NOT NULL DEFAULT true,
    bemerkung       text,

    CONSTRAINT quelle_genau_eine_messung
        CHECK ((endpunkt IS NOT NULL) <> (tabelle IS NOT NULL)),
    CONSTRAINT quelle_tabelle_vollstaendig
        CHECK (tabelle IS NULL OR (schema_name IS NOT NULL AND zeitspalte IS NOT NULL))
);

COMMENT ON TABLE sync.quelle IS
'Das Register der Zulauferwartungen: welche Quelle muss in welchem Takt Zeilen
liefern. Gefuellt aus src/sync/quellen.ts bei jedem Lauf, nicht von Hand.

Gelesen wird es von mart.quelle_zulauf. Wer eine neue Quelle anschliesst, traegt
sie dort ein — waechter.test.ts laesst einen aktiven Endpunkt ohne Eintrag nicht
durch.';

COMMENT ON COLUMN sync.quelle.kadenz_stunden IS
'Nach so vielen Stunden ohne Zulauf gilt die Quelle als stumm. Bewusst
grosszuegig: eine Schwelle, die bei jedem normalen Schwanken ausschlaegt, wird
abgeschaltet. Die Begruendung je Quelle steht in src/sync/quellen.ts.';


-- ---------------------------------------------------------------------
-- 2. Die Messung
--
-- Dynamisches SQL, weil das Register sagt, WO gemessen wird. Die
-- Alternative waere ein UNION ALL ueber zwei Dutzend Tabellen, das
-- jemand von Hand nachzieht — und genau die Sorte zweiter Liste, die
-- irgendwann still hinter der ersten zurueckbleibt.
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS aufgabe_endpunkt_beendet
    ON sync.aufgabe (endpunkt, beendet_am DESC);

-- Yext schreibt keine sync.aufgabe; dort wird an der Tabelle gemessen.
CREATE INDEX IF NOT EXISTS bewertung_geladen
    ON core.bewertung (geladen_am DESC);

CREATE OR REPLACE FUNCTION mart.quelle_messen()
RETURNS TABLE (quelle text, zuletzt_gefragt timestamptz, zuletzt_zulauf timestamptz)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r record;
    g timestamptz;
    z timestamptz;
BEGIN
    FOR r IN SELECT * FROM sync.quelle ORDER BY quelle LOOP
        IF r.endpunkt IS NOT NULL THEN
            /*
             * `zeilen > 0` ist die Zulaufbedingung, `status` allein
             * nicht: eine Aufgabe mit status = 'ok' und null Zeilen ist
             * genau der Zustand, den 0069 beim Belegarchiv gefunden hat.
             *
             * `keine_daten` zaehlt beim FRAGEN mit — es ist ein
             * gelungener Aufruf ohne Inhalt (AGENTS.md) — und beim
             * ZULAUF ausdruecklich nicht.
             */
            SELECT max(a.beendet_am) FILTER (WHERE a.status IN ('ok','keine_daten')),
                   max(a.beendet_am) FILTER (WHERE a.status = 'ok' AND coalesce(a.zeilen,0) > 0)
              INTO g, z
              FROM sync.aufgabe a
             WHERE a.endpunkt = r.endpunkt;
        ELSE
            EXECUTE format('SELECT max(%I) FROM %I.%I', r.zeitspalte, r.schema_name, r.tabelle)
              INTO z;
            -- An einer Tabelle laesst sich "gefragt" nicht von
            -- "geliefert" trennen. Die Sicht sagt das auch so.
            g := z;
        END IF;
        quelle := r.quelle; zuletzt_gefragt := g; zuletzt_zulauf := z;
        RETURN NEXT;
    END LOOP;
END $$;

COMMENT ON FUNCTION mart.quelle_messen() IS
'Misst je Zeile in sync.quelle, wann zuletzt gefragt und wann zuletzt Zulauf
entstanden ist. Ueber sync.aufgabe, wo der Importer selbst protokolliert hat,
sonst direkt an der Zieltabelle (Yext-Nachlauf schreibt keine Aufgabe).';


-- ---------------------------------------------------------------------
-- 3. Die Sicht mit der Ampel
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.quelle_zulauf AS
SELECT q.quelle,
       q.bezeichnung,
       q.system,
       q.kadenz_stunden,
       q.erwartet,
       q.bemerkung,
       m.zuletzt_gefragt,
       m.zuletzt_zulauf,
       round(EXTRACT(epoch FROM (now() - m.zuletzt_zulauf)) / 3600, 1) AS stunden_ohne_zulauf,
       CASE
         WHEN NOT q.erwartet                    THEN 'nicht erwartet'
         WHEN m.zuletzt_zulauf IS NULL          THEN 'nie'
         WHEN m.zuletzt_zulauf
              < now() - make_interval(hours => q.kadenz_stunden) THEN 'stumm'
         ELSE 'ok'
       END AS zustand,
       /*
        * Die Unterscheidung, die 0069 gekostet hat: wurde ueberhaupt
        * noch gefragt? Ein "stumm" mit frischem zuletzt_gefragt heisst
        * "die Quelle hat nichts". Ein "stumm" mit altem heisst "wir
        * fragen nicht mehr" — und das ist ein Baufehler, kein Befund.
        */
       m.zuletzt_gefragt IS NOT NULL
         AND m.zuletzt_gefragt >= now() - make_interval(hours => q.kadenz_stunden)
         AS wird_noch_gefragt
  FROM sync.quelle q
  JOIN mart.quelle_messen() m ON m.quelle = q.quelle
 ORDER BY q.erwartet DESC, q.system, q.quelle;

COMMENT ON VIEW mart.quelle_zulauf IS
'Bekommt jede Quelle noch Zulauf? Die Sicht zu AGENTS.md Regel 10.

  ok               Zulauf innerhalb der erwarteten Kadenz.
  stumm            seit laenger als kadenz_stunden keine Zeile mehr. Auf
                   wird_noch_gefragt sehen: false heisst, der Importer fragt
                   nicht mehr — ein Baufehler. true heisst, die Quelle liefert
                   nichts — ein Befund.
  nie              es ist noch nie eine Zeile entstanden. Der schwerste Fall,
                   weil er wie ein frisch aufgesetztes System aussieht.
  nicht erwartet   liefert bewusst nichts. Steht hier MIT Begruendung, damit
                   die Entscheidung sichtbar bleibt und nicht als Luecke
                   wiederentdeckt wird.

ZWEI ZAHLEN, NICHT EINE: zuletzt_gefragt und zuletzt_zulauf. Am 12.08.2026 fror
das Belegarchiv ein, weil nicht mehr gefragt wurde; am 10.08.2026 stand Yext mit
frischem Zeitstempel neben leeren Tabellen. Eine Zahl allein haette beide Male
beruhigt.';


-- ---------------------------------------------------------------------
-- 4. Die Pruefzeile — und der Lauf selbst
--
-- Der Lauf meldet ab hier nicht mehr blind "ok": src/sync/zulauf.ts
-- liest diese Sicht am Ende jedes Laufs und setzt sync.lauf.status auf
-- 'teilweise', wenn eine erwartete Quelle stumm ist. Damit steht es in
-- mart.sync_status, in /status und im Dashboard — nicht nur im Log.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS
SELECT 'Umsatz: Artikelsumme vs. Umsatzbericht' AS pruefung,
       count(*)                                  AS geprueft,
       count(*) FILTER (WHERE auffaellig)        AS auffaellig,
       'mart.pruefung_umsatz'                    AS sicht
  FROM mart.pruefung_umsatz
UNION ALL
SELECT 'Bon: avgTicket vs. Umsatz/Rechnungen',
       count(*), count(*) FILTER (WHERE auffaellig), 'mart.pruefung_bon'
  FROM mart.pruefung_bon
UNION ALL
/*
 * DIE ZEILE, DIE ALLE ANDEREN ABDECKT — deshalb steht sie vorn.
 * Gezaehlt werden nur die erwarteten Quellen; die bewusst stillen
 * stehen in der Sicht, aber nicht in dieser Zahl.
 */
SELECT 'Zulauf: Quelle ohne Zulauf in ihrer Kadenz',
       count(*) FILTER (WHERE erwartet),
       count(*) FILTER (WHERE erwartet AND zustand IN ('stumm','nie')),
       'mart.quelle_zulauf'
  FROM mart.quelle_zulauf
UNION ALL
/*
 * Und die schaerfere Gegenprobe daneben: wird ueberhaupt noch gefragt?
 * Genau das war der 12.08.2026 — die Antwort auf "warum kommt nichts"
 * lautete "weil niemand fragt", und das sieht man der Zulaufzahl nicht an.
 */
SELECT 'Zulauf: Quelle wird nicht mehr abgefragt',
       count(*) FILTER (WHERE erwartet),
       count(*) FILTER (WHERE erwartet AND NOT wird_noch_gefragt),
       'mart.quelle_zulauf'
  FROM mart.quelle_zulauf
UNION ALL
SELECT 'Belegarchiv: Ordner ohne den faelligen Abzug',
       count(*), count(*) FILTER (WHERE zustand = 'abzug fehlt'),
       'mart.belegarchiv_zulauf'
  FROM mart.belegarchiv_zulauf
UNION ALL
SELECT 'Belegarchiv: seit ueber 36 h nicht gezaehlt',
       count(*) FILTER (WHERE zustand <> 'kein belegarchiv'),
       count(*) FILTER (WHERE zustand <> 'kein belegarchiv'
                          AND (zuletzt_gezaehlt IS NULL
                            OR zuletzt_gezaehlt < now() - interval '36 hours')),
       'mart.belegarchiv_zulauf'
  FROM mart.belegarchiv_zulauf
UNION ALL
SELECT 'Belegarchiv: Betrieb ohne Belegarchiv',
       count(*), count(*) FILTER (WHERE zustand = 'kein belegarchiv'),
       'mart.belegarchiv_zulauf'
  FROM mart.belegarchiv_zulauf
UNION ALL
SELECT 'Inventur: Zaehlung abgeschnitten',
       (SELECT count(*) FROM core.inventur WHERE anzahl_positionen IS NOT NULL),
       count(*), 'mart.inventur_abgeschnitten'
  FROM mart.inventur_abgeschnitten
UNION ALL
SELECT 'Bestellung: Kopf ohne eine einzige Position',
       count(*), count(*) FILTER (WHERE NOT EXISTS (
                   SELECT 1 FROM core.bestellposition p
                    WHERE p.bestellung_key = b.bestellung_key)),
       'core.bestellung'
  FROM core.bestellung b
UNION ALL
SELECT 'Bestellung: Details im Fenster aelter als 48 h',
       coalesce(sum(im_fenster), 0)::bigint,
       coalesce(sum(fenster_veraltet), 0)::bigint,
       'mart.bestelldetail_stand'
  FROM mart.bestelldetail_stand
UNION ALL
SELECT 'Einkauf: Kostenstelle ohne Betrieb, mit Bestellungen',
       count(*), count(*) FILTER (WHERE NOT testbetrieb AND bestellungen > 0),
       'mart.kostenstelle_ohne_betrieb'
  FROM mart.kostenstelle_ohne_betrieb
UNION ALL
SELECT 'Nachzuegler: Aenderungen am Rand des Fensters',
       count(DISTINCT endpunkt),
       count(DISTINCT endpunkt) FILTER (WHERE am_rand_noch_aenderungen),
       'mart.nachzuegler_tiefe'
  FROM mart.nachzuegler_tiefe
UNION ALL
SELECT 'Einkauf: Bestellseiten aus einem frueheren Lauf offen',
       count(DISTINCT marke),
       count(DISTINCT marke) FILTER (WHERE seiten_rueckstand > 0),
       'mart.einkauf_ladestand'
  FROM mart.einkauf_ladestand
UNION ALL
SELECT 'Einkauf: 403 auf einem EIGENEN Betrieb',
       count(*), count(*) FILTER (WHERE eigener_betrieb),
       'mart.posten_ohne_zugriff'
  FROM mart.posten_ohne_zugriff
UNION ALL
SELECT 'Warteschlange: endgueltig aufgegeben',
       count(*), count(*) FILTER (WHERE zustand = 'endgueltig'),
       'mart.posten_aufgegeben'
  FROM mart.posten_aufgegeben;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0076', to_jsonb(
        'Der Waechter aus Phase 4: sync.quelle als Register der Zulauferwartungen '
        'und mart.quelle_zulauf als Messung dazu. Zwei Zahlen statt einer — '
        'zuletzt_gefragt und zuletzt_zulauf —, weil die beiden Ausfaelle dieses '
        'Projekts verschiedene waren: am 12.08.2026 wurde nicht mehr gefragt, am '
        '10.08.2026 war der Zeitstempel frisch und die Tabellen leer. Der Lauf '
        'meldet ab jetzt "teilweise" statt "ok", wenn eine erwartete Quelle stumm '
        'ist.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
