-- =====================================================================
-- 0080 — Gruen heisst ab jetzt "geprueft", nicht "nichts gefunden"
--        (Plan, Abschnitt 4, Entscheidung 1)
--
-- DIE FRAGE WAR: darf eine Ampel gruen sein, wenn ein Signal fehlt?
-- Heute ja. Die Empfehlung des Plans lautet nein, und die Messung sagt,
-- warum das mehr ist als eine Geschmacksfrage.
--
-- Am 14.08.2026 in Produktion, Juni bis August 2026:
--
--   rot            198
--   (kein Urteil)  189
--   gruen           19
--   orange          17
--
-- Von diesen 19 gruenen Urteilen entstand ein Teil dadurch, dass die
-- OM-Note FEHLT. `manual.om_einschaetzung` endet im Juni; seit Juli ist
-- `ampel_om` fuer alle 141 Betriebe leer. `ampel.gesamt()` ignoriert
-- NULL-Signale und faellt damit auf `ELSE 'gruen'` durch: **das
-- Gesamturteil wird gruen, WEIL ein Signal weggefallen ist.**
--
-- Das ist derselbe Fehler wie ueberall in diesem Plan, nur eine Ebene
-- hoeher: ein fehlender Wert sieht aus wie ein guter. Ein Importer ohne
-- Arbeit sieht aus wie einer, der fertig ist — und ein Betrieb ohne
-- Bewertung sieht aus wie einer ohne Probleme.
--
-- WAS SICH AENDERT UND WAS AUSDRUECKLICH NICHT:
--
--   rot bleibt rot        Ein fehlendes Signal darf ein rotes NIE
--   orange bleibt orange  verdecken. Die Eskalationsstufe wird durch
--                         diese Aenderung nicht weicher, sondern nur der
--                         Freispruch strenger.
--   gruen wird gruen      nur noch, wenn ALLE sechs Signale da sind.
--   sonst unvollstaendig  ein eigener Zustand neben gruen/orange/rot.
--
-- ZURUECKDREHEN IST EINE ZEILE. Wer das anders entscheidet, ersetzt in
-- der Funktion unten die eine WHEN-Zeile durch nichts — der Rest bleibt,
-- wie er war. Die Begruendung steht in `docs/entscheidungen.md`.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Das Gesamturteil
--
-- Eine IMMUTABLE SQL-Funktion, an der `mart.round_table_monat`,
-- `mart.round_table_marke`, `mart.konzept_schnitt` und die
-- Trendrechnung haengen. Sie zu aendern aendert alle zugleich — genau
-- deshalb ist die Regel HIER und nicht in jeder Sicht einzeln.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ampel.gesamt(p_status text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        -- Gar kein Signal: kein Urteil. Ein Betrieb ohne jede Zahl ist
        -- nicht "unvollstaendig", sondern nicht beurteilt.
        WHEN cardinality(array_remove(p_status, NULL)) = 0 THEN NULL
        WHEN 'rot'    = ANY(p_status) THEN 'rot'
        WHEN 'orange' = ANY(p_status) THEN 'orange'
        /*
         * NEU MIT 0080, und die einzige geaenderte Zeile: gruen setzt
         * voraus, dass jedes Signal da war. Fehlt eines, ist das Urteil
         * unvollstaendig — nicht gut.
         */
        WHEN cardinality(array_remove(p_status, NULL)) < cardinality(p_status)
             THEN 'unvollstaendig'
        ELSE 'gruen'
    END;
$$;

COMMENT ON FUNCTION ampel.gesamt(text[]) IS
'Das Gesamturteil aus den sechs Einzelampeln. Die schlechteste gewinnt.

SEIT 0080 GIBT ES VIER ZUSTAENDE. gruen heisst "alle sechs Signale lagen vor und
keines war auffaellig"; fehlt eines, steht dort unvollstaendig. Davor fiel ein
fehlendes Signal durch auf ELSE gruen — das Urteil wurde also GUT, WEIL etwas
fehlte. Anlass: manual.om_einschaetzung endet im Juni 2026, ampel_om ist seit
Juli fuer alle 141 Betriebe leer.

rot und orange sind unberuehrt. Ein fehlendes Signal darf ein rotes nie
verdecken — diese Aenderung macht den Freispruch strenger, nicht die
Eskalation weicher.

NULL heisst weiterhin "kein Urteil": ein Betrieb ohne jede Zahl ist nicht
unvollstaendig beurteilt, sondern gar nicht.';


-- ---------------------------------------------------------------------
-- 2. Und die Frage dahinter: WELCHES Signal fehlt?
--
-- Ohne diese Sicht waere "unvollstaendig" nur ein anderes Wort fuer
-- "keine Ahnung". Sie sagt je Betrieb und Monat, welche der sechs
-- Kennzahlen nicht da ist — und damit, wo jemand etwas nachtragen muss.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.round_table_unvollstaendig AS
SELECT r.monat,
       r.betrieb_key,
       r.betrieb,
       r.konzept,
       r.status,
       r.operativ,
       (r.umsatz_pct IS NULL)::int
     + (r.personalkosten_ogf_pct IS NULL)::int
     + (r.we_bar_pct IS NULL)::int
     + (r.we_kueche_pct IS NULL)::int
     + (r.online_bewertung IS NULL)::int
     + (r.om_score IS NULL)::int                AS signale_fehlen,
       r.umsatz_pct             IS NULL AS fehlt_umsatz,
       r.personalkosten_ogf_pct IS NULL AS fehlt_personal,
       r.we_bar_pct             IS NULL AS fehlt_we_bar,
       r.we_kueche_pct          IS NULL AS fehlt_we_kueche,
       r.online_bewertung       IS NULL AS fehlt_bewertung,
       r.om_score               IS NULL AS fehlt_om
  FROM mart.round_table_basis r
 WHERE r.umsatz_pct IS NULL
    OR r.personalkosten_ogf_pct IS NULL
    OR r.we_bar_pct IS NULL
    OR r.we_kueche_pct IS NULL
    OR r.online_bewertung IS NULL
    OR r.om_score IS NULL
 ORDER BY r.monat DESC, signale_fehlen DESC, r.betrieb;

COMMENT ON VIEW mart.round_table_unvollstaendig IS
'Welche der sechs Round-Table-Kennzahlen fehlt, je Betrieb und Monat.

Die Begruendung zu jedem `unvollstaendig` in mart.round_table_monat — ohne sie
waere der neue Zustand nur ein anderes Wort fuer "keine Ahnung".

Die haeufigste Spalte ist seit Juli 2026 fehlt_om: manual.om_einschaetzung
endet im Juni. Nachgetragen wird sie ueber pflege/om_einschaetzung.csv (0079),
nicht mehr ueber eine Migration.';


-- ---------------------------------------------------------------------
-- 3. Die Pruefzeile
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
SELECT 'Zulauf: Quelle ohne Zulauf in ihrer Kadenz',
       count(*) FILTER (WHERE erwartet),
       count(*) FILTER (WHERE erwartet AND zustand IN ('stumm','nie')),
       'mart.quelle_zulauf'
  FROM mart.quelle_zulauf
UNION ALL
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
SELECT 'Belegarchiv: Belegdatum spaeter als der eigene Upload',
       (SELECT count(*) FROM core.buchungsbeleg),
       count(*), 'mart.belegdatum_ausreisser'
  FROM mart.belegdatum_ausreisser
UNION ALL
SELECT 'Inventur: Zaehlung abgeschnitten',
       (SELECT count(*) FROM core.inventur WHERE anzahl_positionen IS NOT NULL),
       count(*), 'mart.inventur_abgeschnitten'
  FROM mart.inventur_abgeschnitten
UNION ALL
SELECT 'Inventur: Position ueber 50.000 EUR (aus dem Schwund genommen)',
       (SELECT count(*) FROM core.inventurposition),
       coalesce(sum(positionen_unplausibel), 0)::bigint,
       'mart.inventur_schwund'
  FROM mart.inventur_schwund
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
SELECT 'Umsatz: Monat mit mehr als 10 % nicht aufteilbarem Umsatz',
       count(*), count(*) FILTER (WHERE nicht_aufteilbar_pct > 10),
       'mart.hauptsparte_abdeckung'
  FROM mart.hauptsparte_abdeckung
UNION ALL
SELECT 'Yext: operativer Betrieb mit Umsatz, aber ohne Zuordnung',
       (SELECT count(*) FROM mart.betrieb_status WHERE status = 'operativ'),
       count(*) FILTER (WHERE status = 'operativ' AND macht_umsatz),
       'mart.betrieb_ohne_yext'
  FROM mart.betrieb_ohne_yext
UNION ALL
SELECT 'Yext: Vollabgleich aelter als 45 Tage',
       count(*) FILTER (WHERE schluessel = 'yext_letzter_vollabgleich'),
       count(*) FILTER (WHERE schluessel = 'yext_letzter_vollabgleich'
                          AND tage_her > 45),
       'mart.yext_abgleich'
  FROM mart.yext_abgleich
UNION ALL
SELECT 'Yext: Sichtbarkeitszeile ohne eintraege_live',
       count(*), count(*) FILTER (WHERE eintraege_live IS NULL),
       'core.betrieb_sichtbarkeit'
  FROM core.betrieb_sichtbarkeit
UNION ALL
SELECT 'Handpflege: Datei abgewiesen',
       (SELECT count(*) FROM sync.pflege_import),
       count(*) FILTER (WHERE zustand = 'abgewiesen'),
       'mart.pflege_stand'
  FROM mart.pflege_stand
UNION ALL
SELECT 'Handpflege: Tabelle veraltet oder laeuft aus',
       count(*),
       count(*) FILTER (WHERE zustand IN ('veraltet', 'laeuft bald aus')),
       'mart.pflege_stand'
  FROM mart.pflege_stand
UNION ALL
/*
 * NEU 0080, und der Monat ist mit Bedacht gewaehlt: der VORVORMONAT,
 * nicht der laufende.
 *
 * Im laufenden Monat fehlt der Umsatzvergleich bei ALLEN 141 Betrieben,
 * weil die BWA noch nicht gebucht ist — nachgemessen am 14.08.2026. Eine
 * Zeile, die deshalb jeden Monat auf 141 steht, ist keine Pruefung
 * mehr, sondern Tapete; dieselbe Ueberlegung wie in 0070, 0071 und 0073.
 *
 * Zwei Monate zurueck ist der erste Monat, in dem alles dagewesen sein
 * KANN. Was dort fehlt, fehlt wirklich.
 */
SELECT 'Round Table: operativer Betrieb ohne vollstaendige Signale (Vorvormonat)',
       /*
        * GEZAEHLT WIRD AUS round_table_BASIS, nicht aus round_table_monat.
        * Letzteres ist seit 0039 MATERIALISIERT, und eine nicht befuellte
        * materialisierte Sicht laesst jede Abfrage darauf scheitern — sie
        * haette also die ganze Pruefuebersicht mitgerissen, und zwar auf
        * genau der Datenbank, auf der man sie am dringendsten braucht: einer
        * frisch aufgesetzten.
        */
       (SELECT count(*) FROM mart.round_table_basis
         WHERE operativ
           AND monat = (date_trunc('month', current_date) - interval '2 months')::date),
       count(*) FILTER (WHERE operativ
                          AND monat = (date_trunc('month', current_date)
                                       - interval '2 months')::date),
       'mart.round_table_unvollstaendig'
  FROM mart.round_table_unvollstaendig
UNION ALL
SELECT 'Warteschlange: endgueltig aufgegeben',
       count(*), count(*) FILTER (WHERE zustand = 'endgueltig'),
       'mart.posten_aufgegeben'
  FROM mart.posten_aufgegeben;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0080', to_jsonb(
        'Entscheidung 1 des Plans: gruen heisst ab jetzt "alle sechs Signale lagen '
        'vor und keines war auffaellig". Fehlt eines, steht dort unvollstaendig. '
        'Davor fiel ein fehlendes Signal durch auf ELSE gruen — das Urteil wurde '
        'also GUT, WEIL etwas fehlte; seit Juli 2026 ist ampel_om fuer alle 141 '
        'Betriebe leer. rot und orange sind unberuehrt: ein fehlendes Signal darf '
        'ein rotes nie verdecken. mart.round_table_unvollstaendig sagt, welches '
        'Signal fehlt. Zurueckdrehen ist eine WHEN-Zeile in ampel.gesamt().'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
