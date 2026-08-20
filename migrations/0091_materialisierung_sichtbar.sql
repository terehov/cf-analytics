-- =====================================================================
-- 0091 — Die Materialisierungen werden sichtbar
--
-- ANLASS: geprueft am 20.08.2026, ob jede materialisierte Sicht zur
-- richtigen Zeit aufgefrischt wird. Die Reihenfolge stimmte, die
-- SICHTBARKEIT nicht.
--
-- Zehn materialisierte Sichten haengen an vier Nachlaeufen, und alle vier
-- fangen jeden Fehler ab und schreiben nur log.warn — mit Absicht: ein
-- misslungener Refresh bedeutet veraltete Zahlen, nicht verlorene Daten,
-- und darf einen Importlauf nicht scheitern lassen. Der Preis dafuer ist,
-- dass ein dauerhaft scheiternder Refresh wie ein gelungener Lauf
-- aussieht. sync.lauf.status kennt nur die Frage "sind Aufgaben
-- gescheitert?", und ein Refresh ist keine Aufgabe.
--
-- Gesehen hat man davon bisher genau eine: den Vergleichstag ueber
-- mart.vergleichstag_stand und seine Pruefzeile aus 0084. Der
-- Deckungsbeitrag hat mit mart.deckungsbeitrag_stand eine Sicht, aber
-- keine Pruefzeile. Die Merker round_table_refresh und
-- einkauf_sichten_refresh wurden seit 0039 bzw. 0063 jede Nacht
-- geschrieben und von NICHTS gelesen — kein Dashboard, keine Pruefung,
-- kein /status.
--
-- Dass das kein gedachter Fall ist, steht in AGENTS.md bei 0088: der
-- Vergleichstags-Refresh lief in die Zeitgrenze, nachdem aus 10
-- Bundeslaendern 16 wurden. Aufgefallen ist er, weil er als einziger eine
-- Pruefzeile hat. Derselbe Ausfall im Round Table oder im Einkauf waere
-- still geblieben.
--
-- ZWEI PRUEFZEILEN, NICHT EINE. Die zweite beantwortet eine andere Frage:
-- gibt es eine materialisierte Sicht, die in KEINEM Nachlauf steht? Die
-- Zuordnung unten ist Handarbeit, und Handarbeit veraltet. Verglichen wird
-- deshalb gegen pg_matviews — wer die elfte Sicht anlegt und den Refresh
-- vergisst, sieht es am naechsten Morgen statt in einem halben Jahr.
--
-- LIEST DIE SICHTEN NICHT SELBST, sondern nur sync.merker, sync.lauf und
-- den Katalog. Die Lehre aus 0084: eine frisch geklonte Datenbank hat
-- unbefuellte Materialisierungen, ein SELECT darauf endet mit PG 55000
-- und reisst den Ende-zu-Ende-Test mit.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Der Stand je Sicht
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.materialisierung_stand AS
WITH letzter_lauf AS (
  SELECT max(beendet_am) AS beendet_am
    FROM sync.lauf
   WHERE status IN ('ok', 'teilweise')
), vorhanden AS (
  SELECT (schemaname || '.' || matviewname)::text AS sicht
    FROM pg_matviews
   WHERE schemaname = 'mart'
), zuordnung(sicht, schluessel, nachlauf) AS (
  VALUES
    ('mart.deckungsbeitrag_warengruppe'::text, 'deckungsbeitrag_refresh'::text, 'src/sync/deckungsbeitrag.ts'::text),
    ('mart.round_table_monat',                 'round_table_refresh',           'src/sync/round_table.ts'),
    ('mart.round_table_trend',                 'round_table_refresh',           'src/sync/round_table.ts'),
    ('mart.artikel_monat_basis',               'round_table_refresh',           'src/sync/round_table.ts'),
    ('mart.vergleichstag_basis',               'vergleichstag_refresh',         'src/sync/vergleichstag.ts'),
    ('mart.einkauf_kreditor_monat',            'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkaufspreis_monat_basis',         'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkaufspreis_betrieb_basis',       'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkauf_betrieb_monat_basis',       'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkauf_pruefung_basis',            'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts')
)
SELECT coalesce(v.sicht, z.sicht)      AS sicht,
       z.schluessel,
       z.nachlauf,
       m.gesetzt_am                    AS zuletzt_aufgefrischt,
       (m.wert ->> 'dauer_s')::numeric AS dauer_s,
       l.beendet_am                    AS letzter_lauf,
       -- Die Zeitgrenze ist dieselbe wie in mart.vergleichstag_stand: der
       -- Merker wird NACH dem Lauf gesetzt, er darf dem Lauf also nie
       -- hinterherhinken. Eine Stunde Luft, weil die Refreshes selbst
       -- Minuten brauchen und beendet_am vom Importende stammt.
       CASE WHEN z.sicht IS NULL      THEN 'ohne Refresh'
            WHEN v.sicht IS NULL      THEN 'Sicht fehlt'
            WHEN m.gesetzt_am IS NULL THEN 'nie aufgefrischt'
            WHEN l.beendet_am IS NULL THEN 'kein Lauf'
            WHEN m.gesetzt_am < l.beendet_am - INTERVAL '1 hour' THEN 'veraltet'
            ELSE 'aktuell' END         AS zustand
  FROM vorhanden v
  FULL JOIN zuordnung z ON z.sicht = v.sicht
  CROSS JOIN letzter_lauf l
  LEFT JOIN sync.merker m ON m.schluessel = z.schluessel;

COMMENT ON VIEW mart.materialisierung_stand IS
'Eine Zeile je materialisierter Sicht: welcher Nachlauf sie auffrischt, wann das zuletzt '
'geschah und ob das zum letzten Lauf passt. Liest bewusst NUR sync.merker, sync.lauf und '
'pg_matviews und nie die Materialisierungen selbst — eine frisch geklonte Datenbank hat '
'unbefuellte Sichten, und ein SELECT darauf endet mit PG 55000 (die Lehre aus 0084). '
'FULL JOIN gegen pg_matviews, damit beide Richtungen auffallen: eine Sicht ohne Nachlauf '
'("ohne Refresh") und ein Nachlauf ohne Sicht ("Sicht fehlt").';

COMMENT ON COLUMN mart.materialisierung_stand.zustand IS
'aktuell = so frisch wie der letzte Lauf. veraltet = der Refresh ist mehr als eine Stunde '
'aelter als das Importende, also in der Nacht gescheitert (die Nachlaeufe werfen nie, sie '
'schreiben nur log.warn). nie aufgefrischt = der Merker fehlt ganz. ohne Refresh = die '
'Sicht steht in pg_matviews, aber in keinem Nachlauf — jemand hat sie angelegt und das '
'Auffrischen vergessen. Sicht fehlt = umgekehrt, die Zuordnung nennt eine Sicht, die es '
'nicht mehr gibt.';


-- ---------------------------------------------------------------------
-- 2. Die Pruefzeilen (Regel 10) — in EIGENER Sicht
--
-- Wie mart.pruefung_kalender in 0084, und aus demselben Grund:
-- mart.pruefung_uebersicht wird von jeder Migration, die eine Zeile
-- ergaenzt, komplett neu erzeugt. Arbeiten zwei Sessions parallel am
-- Repo — wie am 20.08.2026 —, ueberschreibt die spaeter angewendete
-- Migration die Zeilen der frueheren still.
--
-- ZU JEDER ZEILE GEHOERT DIE ERWARTUNG (0071-Hygiene):
--   * Frische:  0. Jede andere Zahl heisst, dass in der Nacht ein Refresh
--               gescheitert ist und die Karten darauf alte Zahlen zeigen.
--   * Abdeckung: 0, und sie bleibt es, bis jemand eine neue
--               materialisierte Sicht anlegt.
--
-- Der Vergleichstag steht hier MIT drin und hat seit 0084 zusaetzlich
-- seine eigene Zeile in mart.pruefung_kalender. Die Doppelung ist
-- bewusst in Kauf genommen: mart.pruefung_kalender gehoert der
-- Kalender-Arbeit und wurde am selben Tag von einer zweiten Session
-- angefasst (0090). Wer sie das naechste Mal ohnehin neu erzeugt, kann
-- die Vergleichstags-Zeile dort streichen.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pruefung_materialisierung AS
SELECT 'Materialisierung: aelter als der letzte Lauf'::text AS pruefung,
       count(*)::int                                        AS geprueft,
       count(*) FILTER (WHERE zustand NOT IN ('aktuell', 'ohne Refresh'))::int AS auffaellig,
       'mart.materialisierung_stand'::text                  AS sicht
  FROM mart.materialisierung_stand
UNION ALL
SELECT 'Materialisierung: Sicht ohne Refresh im Nachlauf'::text,
       count(*)::int,
       count(*) FILTER (WHERE zustand IN ('ohne Refresh', 'Sicht fehlt'))::int,
       'mart.materialisierung_stand'::text
  FROM mart.materialisierung_stand;

COMMENT ON VIEW mart.pruefung_materialisierung IS
'Die zwei Pruefzeilen rund um die materialisierten Sichten. Eigene Sicht, damit eine '
'parallel entwickelte Migration sie nicht beim Neuerzeugen von mart.pruefung_uebersicht '
'verschluckt. Erwartung beide Male 0. Die erste Zeile zaehlt "ohne Refresh" NICHT mit — '
'eine Sicht ohne Nachlauf hat keinen Merker und waere sonst in beiden Zeilen auffaellig.';


-- ---------------------------------------------------------------------
-- 3. Angehaengt an die Uebersicht — mit genau EINER Zeile
--
-- Der Rest der Definition ist unveraendert der Stand nach 0084.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS
 SELECT 'Umsatz: Artikelsumme vs. Umsatzbericht'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE pruefung_umsatz.auffaellig) AS auffaellig,
    'mart.pruefung_umsatz'::text AS sicht
   FROM mart.pruefung_umsatz
UNION ALL
 SELECT 'Bon: avgTicket vs. Umsatz/Rechnungen'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE pruefung_bon.auffaellig) AS auffaellig,
    'mart.pruefung_bon'::text AS sicht
   FROM mart.pruefung_bon
UNION ALL
 SELECT 'Zulauf: Quelle ohne Zulauf in ihrer Kadenz'::text AS pruefung,
    count(*) FILTER (WHERE quelle_zulauf.erwartet) AS geprueft,
    count(*) FILTER (WHERE quelle_zulauf.erwartet AND (quelle_zulauf.zustand = ANY (ARRAY['stumm'::text, 'nie'::text]))) AS auffaellig,
    'mart.quelle_zulauf'::text AS sicht
   FROM mart.quelle_zulauf
UNION ALL
 SELECT 'Zulauf: Quelle wird nicht mehr abgefragt'::text AS pruefung,
    count(*) FILTER (WHERE quelle_zulauf.erwartet) AS geprueft,
    count(*) FILTER (WHERE quelle_zulauf.erwartet AND NOT quelle_zulauf.wird_noch_gefragt) AS auffaellig,
    'mart.quelle_zulauf'::text AS sicht
   FROM mart.quelle_zulauf
UNION ALL
 SELECT 'Belegarchiv: Ordner ohne den faelligen Abzug'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE belegarchiv_zulauf.zustand = 'abzug fehlt'::text) AS auffaellig,
    'mart.belegarchiv_zulauf'::text AS sicht
   FROM mart.belegarchiv_zulauf
UNION ALL
 SELECT 'Belegarchiv: seit ueber 36 h nicht gezaehlt'::text AS pruefung,
    count(*) FILTER (WHERE belegarchiv_zulauf.zustand <> 'kein belegarchiv'::text) AS geprueft,
    count(*) FILTER (WHERE belegarchiv_zulauf.zustand <> 'kein belegarchiv'::text AND (belegarchiv_zulauf.zuletzt_gezaehlt IS NULL OR belegarchiv_zulauf.zuletzt_gezaehlt < (now() - '36:00:00'::interval))) AS auffaellig,
    'mart.belegarchiv_zulauf'::text AS sicht
   FROM mart.belegarchiv_zulauf
UNION ALL
 SELECT 'Belegarchiv: Betrieb ohne Belegarchiv'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE belegarchiv_zulauf.zustand = 'kein belegarchiv'::text) AS auffaellig,
    'mart.belegarchiv_zulauf'::text AS sicht
   FROM mart.belegarchiv_zulauf
UNION ALL
 SELECT 'Belegarchiv: Belegdatum spaeter als der eigene Upload'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM core.buchungsbeleg) AS geprueft,
    count(*) AS auffaellig,
    'mart.belegdatum_ausreisser'::text AS sicht
   FROM mart.belegdatum_ausreisser
UNION ALL
 SELECT 'Inventur: Zaehlung abgeschnitten'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM core.inventur
          WHERE inventur.anzahl_positionen IS NOT NULL) AS geprueft,
    count(*) AS auffaellig,
    'mart.inventur_abgeschnitten'::text AS sicht
   FROM mart.inventur_abgeschnitten
UNION ALL
 SELECT 'Inventur: Position ueber 50.000 EUR (aus dem Schwund genommen)'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM core.inventurposition) AS geprueft,
    COALESCE(sum(inventur_schwund.positionen_unplausibel), 0::numeric)::bigint AS auffaellig,
    'mart.inventur_schwund'::text AS sicht
   FROM mart.inventur_schwund
UNION ALL
 SELECT 'Bestellung: Kopf ohne eine einzige Position'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE NOT (EXISTS ( SELECT 1
           FROM core.bestellposition p
          WHERE p.bestellung_key = b.bestellung_key))) AS auffaellig,
    'core.bestellung'::text AS sicht
   FROM core.bestellung b
UNION ALL
 SELECT 'Bestellung: Details im Fenster aelter als 48 h'::text AS pruefung,
    COALESCE(sum(bestelldetail_stand.im_fenster), 0::numeric)::bigint AS geprueft,
    COALESCE(sum(bestelldetail_stand.fenster_veraltet), 0::numeric)::bigint AS auffaellig,
    'mart.bestelldetail_stand'::text AS sicht
   FROM mart.bestelldetail_stand
UNION ALL
 SELECT 'Einkauf: Kostenstelle ohne Betrieb, mit Bestellungen'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE NOT kostenstelle_ohne_betrieb.testbetrieb AND kostenstelle_ohne_betrieb.bestellungen > 0) AS auffaellig,
    'mart.kostenstelle_ohne_betrieb'::text AS sicht
   FROM mart.kostenstelle_ohne_betrieb
UNION ALL
 SELECT 'Nachzuegler: Aenderungen am Rand des Fensters'::text AS pruefung,
    count(DISTINCT nachzuegler_tiefe.endpunkt) AS geprueft,
    count(DISTINCT nachzuegler_tiefe.endpunkt) FILTER (WHERE nachzuegler_tiefe.am_rand_noch_aenderungen) AS auffaellig,
    'mart.nachzuegler_tiefe'::text AS sicht
   FROM mart.nachzuegler_tiefe
UNION ALL
 SELECT 'Einkauf: Bestellseiten aus einem frueheren Lauf offen'::text AS pruefung,
    count(DISTINCT einkauf_ladestand.marke) AS geprueft,
    count(DISTINCT einkauf_ladestand.marke) FILTER (WHERE einkauf_ladestand.seiten_rueckstand > 0) AS auffaellig,
    'mart.einkauf_ladestand'::text AS sicht
   FROM mart.einkauf_ladestand
UNION ALL
 SELECT 'Einkauf: 403 auf einem EIGENEN Betrieb'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE posten_ohne_zugriff.eigener_betrieb) AS auffaellig,
    'mart.posten_ohne_zugriff'::text AS sicht
   FROM mart.posten_ohne_zugriff
UNION ALL
 SELECT 'Umsatz: Monat mit mehr als 10 % nicht aufteilbarem Umsatz'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE hauptsparte_abdeckung.nicht_aufteilbar_pct > 10::numeric) AS auffaellig,
    'mart.hauptsparte_abdeckung'::text AS sicht
   FROM mart.hauptsparte_abdeckung
UNION ALL
 SELECT 'Yext: operativer Betrieb mit Umsatz, aber ohne Zuordnung'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM mart.betrieb_status
          WHERE betrieb_status.status = 'operativ'::text) AS geprueft,
    count(*) FILTER (WHERE betrieb_ohne_yext.status = 'operativ'::text AND betrieb_ohne_yext.macht_umsatz) AS auffaellig,
    'mart.betrieb_ohne_yext'::text AS sicht
   FROM mart.betrieb_ohne_yext
UNION ALL
 SELECT 'Yext: Vollabgleich aelter als 45 Tage'::text AS pruefung,
    count(*) FILTER (WHERE yext_abgleich.schluessel = 'yext_letzter_vollabgleich'::text) AS geprueft,
    count(*) FILTER (WHERE yext_abgleich.schluessel = 'yext_letzter_vollabgleich'::text AND yext_abgleich.tage_her > 45::numeric) AS auffaellig,
    'mart.yext_abgleich'::text AS sicht
   FROM mart.yext_abgleich
UNION ALL
 SELECT 'Yext: Sichtbarkeitszeile ohne eintraege_live'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE betrieb_sichtbarkeit.eintraege_live IS NULL) AS auffaellig,
    'core.betrieb_sichtbarkeit'::text AS sicht
   FROM core.betrieb_sichtbarkeit
UNION ALL
 SELECT 'Handpflege: Datei abgewiesen'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM sync.pflege_import) AS geprueft,
    count(*) FILTER (WHERE pflege_stand.zustand = 'abgewiesen'::text) AS auffaellig,
    'mart.pflege_stand'::text AS sicht
   FROM mart.pflege_stand
UNION ALL
 SELECT 'Handpflege: Tabelle veraltet oder laeuft aus'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE pflege_stand.zustand = ANY (ARRAY['veraltet'::text, 'laeuft bald aus'::text])) AS auffaellig,
    'mart.pflege_stand'::text AS sicht
   FROM mart.pflege_stand
UNION ALL
 SELECT 'Round Table: operativer Betrieb ohne vollstaendige Signale (Vorvormonat)'::text AS pruefung,
    ( SELECT count(*) AS count
           FROM mart.round_table_basis
          WHERE round_table_basis.operativ AND round_table_basis.monat = (date_trunc('month'::text, CURRENT_DATE::timestamp with time zone) - '2 mons'::interval)::date) AS geprueft,
    count(*) FILTER (WHERE round_table_unvollstaendig.operativ AND round_table_unvollstaendig.monat = (date_trunc('month'::text, CURRENT_DATE::timestamp with time zone) - '2 mons'::interval)::date) AS auffaellig,
    'mart.round_table_unvollstaendig'::text AS sicht
   FROM mart.round_table_unvollstaendig
UNION ALL
 SELECT 'Warteschlange: endgueltig aufgegeben'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE posten_aufgegeben.zustand = 'endgueltig'::text) AS auffaellig,
    'mart.posten_aufgegeben'::text AS sicht
   FROM mart.posten_aufgegeben
UNION ALL
 SELECT pruefung_kalender.pruefung,
    pruefung_kalender.geprueft,
    pruefung_kalender.auffaellig,
    pruefung_kalender.sicht
   FROM mart.pruefung_kalender
UNION ALL
 SELECT pruefung_materialisierung.pruefung,
    pruefung_materialisierung.geprueft,
    pruefung_materialisierung.auffaellig,
    pruefung_materialisierung.sicht
   FROM mart.pruefung_materialisierung;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0091', to_jsonb(
        'Zehn materialisierte Sichten, vier Nachlaeufe, und sichtbar war davon '
        'genau einer. Die Nachlaeufe fangen jeden Fehler ab (Absicht: ein '
        'misslungener Refresh ist kein verlorener Import), damit sah ein '
        'dauerhaft scheiternder Refresh aus wie ein gelungener Lauf. Die Merker '
        'round_table_refresh und einkauf_sichten_refresh wurden seit 0039 bzw. '
        '0063 jede Nacht geschrieben und von nichts gelesen. Ab jetzt: '
        'mart.materialisierung_stand mit einer Zeile je Sicht und zwei '
        'Pruefzeilen — eine fuer die Frische, eine fuer die Abdeckung gegen '
        'pg_matviews, damit die elfte Sicht ohne Nachlauf am naechsten Morgen '
        'auffaellt.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
