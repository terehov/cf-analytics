-- =====================================================================
-- 0079 — Ein Importweg fuer die Handpflege (Plan Phase 6)
--
-- SECHS TABELLEN, SECHS WEGE — und fuenf davon fuehrten durch eine
-- Migration. Am 14.08.2026 in Produktion nachgezaehlt:
--
--   manual.om_einschaetzung     22 Zeilen, endet 2026-06
--   manual.gfgh_betrieb         13 von 141 Betrieben
--   manual.lieferant_freigabe    5 Freigaben gegen 10.205 Dachnamen
--   manual.bwa_zeile             0
--   manual.sachkonto             0
--   manual.marktindex          101 Zeilen, endet 2026-05
--   manual.feiertag          1.127 Zeilen, endet 2027-12-26
--   manual.schulferien         591 Zeilen, endet 2028-01-11
--
-- DIE TEUERSTE DAVON IST DIE ERSTE. `om_einschaetzung` ist eine der sechs
-- Round-Table-Kennzahlen. Ihre 22 Noten stehen fest im Quelltext von
-- Migration 0044, auf einen verdrahteten Monat — seit Juli 2026 ist
-- `ampel_om` fuer alle 141 Betriebe leer, und das Gesamturteil wird
-- GRUEN, WENN EIN SIGNAL WEGFAELLT. `mart.round_table_monat` ist mit 42
-- Kartenreferenzen die meistgenutzte Sicht ueberhaupt.
--
-- DER KANAL IST DAS REPOSITORY. Eine Datei in `pflege/` wird committet,
-- gepusht, mit dem Container ausgerollt und vom naechsten Lauf
-- eingelesen. Damit hat die Handpflege eine Historie, eine Ueberpruefung
-- vor dem Wirksamwerden und einen Weg zurueck — drei Dinge, die weder
-- eine hochgeladene Datei noch ein Web-Formular haetten.
--
-- FEIERTAGE UND SCHULFERIEN HOLT DER LAUF SELBST, einmal im Monat, von
-- `openholidaysapi.org` — derselben Quelle, die schon in
-- `manual.feiertag.quelle` steht. Sie liefert beides ueber denselben Weg,
-- frei und ohne Schluessel.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Was eingelesen wurde, und was dabei schiefging
--
-- Eine Zeile je Datei, kein Verlauf. Die Historie steht in git — dort
-- gehoert sie hin, und eine zweite hier waere eine, die niemand pflegt.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sync.pflege_import (
    datei         text PRIMARY KEY,
    tabelle       text        NOT NULL,
    zeilen        integer     NOT NULL DEFAULT 0,
    geschrieben   integer     NOT NULL DEFAULT 0,
    inhalt_hash   text,
    /*
     * NULL heisst durchgelaufen. Steht hier etwas, wurde GAR NICHTS aus
     * dieser Datei uebernommen — eine Datei, die zu 90 % durchlaeuft,
     * ist die schlechteste aller Moeglichkeiten, weil sie wie ein Erfolg
     * aussieht.
     */
    fehler        text,
    importiert_am timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sync.pflege_import IS
'Der Stand des Handpflege-Imports aus dem Ordner pflege/. Eine Zeile je Datei,
geschrieben von src/pflege/tabellen.ts bei jedem Lauf.

inhalt_hash sagt, ob sich die Datei seit dem letzten Lauf geaendert hat —
nuetzlich, wenn eine Zahl im Dashboard springt und niemand weiss, warum.';


-- ---------------------------------------------------------------------
-- 2. Die Sicht: reicht die Pflege noch bis heute?
--
-- ZWEI FRAGEN IN EINER TABELLE, und beide muessen beantwortet sein:
--   * ist der letzte Import durchgelaufen?  (fehler)
--   * reicht der INHALT noch?               (letzter_stand)
--
-- Die zweite ist die wichtigere und die unsichtbarere. Eine Notenliste,
-- die im Juni endet, laesst sich fehlerfrei einlesen — und die Ampel ist
-- trotzdem leer.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.pflege_stand AS
WITH inhalt AS (
    SELECT 'manual.om_einschaetzung' AS tabelle, count(*) AS zeilen,
           max(monat)::date AS letzter_stand
      FROM manual.om_einschaetzung
    UNION ALL
    SELECT 'manual.marktindex', count(*), max(monat)::date FROM manual.marktindex
    UNION ALL
    SELECT 'manual.feiertag', count(*), max(datum)::date FROM manual.feiertag
    UNION ALL
    SELECT 'manual.schulferien', count(*), max(bis)::date FROM manual.schulferien
    UNION ALL
    SELECT 'manual.gfgh_betrieb', count(*), max(gilt_ab)::date FROM manual.gfgh_betrieb
    UNION ALL
    SELECT 'manual.lieferant_freigabe', count(*), max(gilt_ab)::date FROM manual.lieferant_freigabe
    UNION ALL
    SELECT 'manual.bwa_zeile', count(*), NULL::date FROM manual.bwa_zeile
    UNION ALL
    SELECT 'manual.sachkonto', count(*), NULL::date FROM manual.sachkonto
)
SELECT i.tabelle,
       i.zeilen,
       i.letzter_stand,
       CASE WHEN i.letzter_stand IS NULL THEN NULL
            ELSE (i.letzter_stand - current_date) END AS reicht_noch_tage,
       p.datei,
       p.zeilen      AS datei_zeilen,
       p.geschrieben AS datei_geschrieben,
       p.importiert_am,
       p.fehler,
       CASE
         WHEN p.fehler IS NOT NULL                      THEN 'abgewiesen'
         WHEN i.zeilen = 0                              THEN 'leer'
         WHEN i.letzter_stand IS NULL                   THEN 'ohne Zeitbezug'
         WHEN i.letzter_stand < current_date - 60       THEN 'veraltet'
         WHEN i.letzter_stand < current_date + 180      THEN 'laeuft bald aus'
         ELSE 'ok'
       END AS zustand
  FROM inhalt i
  LEFT JOIN sync.pflege_import p ON p.tabelle = i.tabelle
 ORDER BY i.tabelle;

COMMENT ON VIEW mart.pflege_stand IS
'Der Zustand der handgepflegten Tabellen — Inhalt UND letzter Import.

  abgewiesen        die Datei in pflege/ hat einen Fehler, es wurde GAR NICHTS
                    uebernommen. Der Grund steht in fehler.
  leer              null Zeilen. bwa_zeile und sachkonto stehen so seit 2026;
                    mart.bwa_quellen_vergleich laeuft deshalb per INNER JOIN
                    auf null Zeilen.
  veraltet          der letzte gepflegte Zeitpunkt liegt ueber 60 Tage zurueck.
                    Bei om_einschaetzung heisst das: die Ampel ist grau.
  laeuft bald aus   reicht weniger als ein halbes Jahr in die Zukunft. Gilt
                    fuer Feiertage und Schulferien, und die Frist ist bewusst
                    lang: sie sollen nachgezogen sein, BEVOR jemand einen
                    Feiertag mit einem Werktag vergleicht.
  ohne Zeitbezug    die Tabelle hat keinen Zeitstempel (bwa_zeile, sachkonto).

reicht_noch_tage ist die Zahl, auf die man sieht. Negativ heisst: der Bestand
endet in der Vergangenheit.';


-- ---------------------------------------------------------------------
-- 3. Zwei Pruefzeilen
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
/*
 * NEU 0079. Zwei Zeilen, weil es zwei verschiedene Fehler sind: eine
 * abgewiesene Datei ist ein Tippfehler von heute, eine veraltete Tabelle
 * ist eine Pflege, die vor Monaten aufgehoert hat. Die zweite faellt
 * niemandem auf — genau deshalb steht sie hier.
 */
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
SELECT 'Warteschlange: endgueltig aufgegeben',
       count(*), count(*) FILTER (WHERE zustand = 'endgueltig'),
       'mart.posten_aufgegeben'
  FROM mart.posten_aufgegeben;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0079', to_jsonb(
        'Ein Importweg fuer die Handpflege: Dateien in pflege/ liest der '
        'naechtliche Lauf ein, Feiertage und Schulferien holt er einmal im Monat '
        'selbst von openholidaysapi.org. Der Anlass ist manual.om_einschaetzung — '
        '22 Noten, fest im Quelltext von Migration 0044, auf einen verdrahteten '
        'Monat. Seit Juli 2026 ist ampel_om fuer alle 141 Betriebe leer, und das '
        'Round-Table-Gesamturteil wird gruen, wenn ein Signal wegfaellt.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
