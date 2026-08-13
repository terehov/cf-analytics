-- =====================================================================
-- 0077 — Datenqualitaet und Hauptsparten (Plan Phase 5.1 und 5.4)
--
-- DREI STELLEN, AN DENEN EINE EINZELNE ZEILE EINE GANZE SICHT KIPPT.
-- Alle drei sind am 14.08.2026 in Produktion nachgemessen.
--
--   1. 13 Belege tragen ein Belegdatum, das mehr als ein Jahr NACH dem
--      Hochladedatum liegt — bis 2038-01-19. Sie machen max(monat) in
--      vier Mart-Sichten unbrauchbar und erzeugen Phantomzeilen.
--   2. 123 Inventurpositionen sind ueber 50.000 EUR wert. mart.inventur-
--      position kennzeichnet sie als `unplausibel`, mart.inventur_schwund
--      rechnet sie trotzdem mit: der Februar 2026 steht mit minus
--      2,97 Mio EUR aus EINER Zeile.
--   3. Von 9.002.801,71 EUR Umsatz der letzten 30 Tage sind 3.504.469,69
--      Speisen und 2.634.893,62 Getraenke. Die uebrigen 2.863.438,40 EUR
--      (31,8 %) stecken in der Gesamtzeile und sind nicht aufteilbar.
--
-- DER ROTE FADEN, wie ueberall in diesem Plan: nicht wegrechnen, sondern
-- NENNEN. Was aus einer Summe herausfaellt, bekommt eine eigene Sicht und
-- eine eigene Pruefzeile. Sonst ist die Bereinigung von morgen der Befund
-- von uebermorgen.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Das Belegdatum, das nicht sein kann
--
-- WARUM DIE GRENZE AM HOCHLADEDATUM HAENGT UND NICHT AN EINER JAHRESZAHL.
-- Eine feste Schranke ("nach 2030 ist falsch") veraltet still und wird
-- irgendwann selbst zum Fehler. Das Hochladedatum ist dagegen eine harte
-- Tatsache: ein Beleg, der ein Jahr NACH seinem eigenen Upload datiert,
-- ist falsch erfasst, ganz gleich welches Jahr wir schreiben.
--
-- EIN JAHR TOLERANZ UND NICHT NULL: Vorausrechnungen, Dauerrechnungen und
-- Wartungsvertraege datieren regulaer in die Zukunft. Gemessen am
-- 14.08.2026 liegen 39 Belege mehr als 30 Tage voraus, aber nur 13 mehr
-- als ein Jahr — und genau die 13 sind die 2038er, 2035er und 2030er.
--
-- RUECKWAERTS WIRD NICHT GEFILTERT. 6.802 Belege datieren mehr als zehn
-- Jahre vor ihrem Upload; das sind nachgereichte Altbelege und keine
-- Fehler. Sie stoeren auch nichts: max(monat) misst nach oben.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.belegdatum_unglaubhaft(
    p_beleg_datum date, p_hochgeladen_am timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT p_beleg_datum IS NOT NULL
       AND p_hochgeladen_am IS NOT NULL
       AND p_beleg_datum > (p_hochgeladen_am + interval '1 year')::date
$$;

COMMENT ON FUNCTION core.belegdatum_unglaubhaft(date, timestamptz) IS
'Ein Beleg, der ein Jahr nach seinem eigenen Upload datiert, ist falsch erfasst.
Die Grenze haengt bewusst am Hochladedatum und nicht an einer Jahreszahl: eine
feste Schranke veraltet still. Ein Jahr Toleranz, weil Voraus- und
Dauerrechnungen regulaer in der Zukunft liegen.

Der Importer setzt beleg_datum in diesem Fall auf NULL und hebt den Rohwert in
beleg_datum_roh — dieselbe Behandlung wie bei unglaubhaften Betraegen (0058).
Aus "unbekannt" darf kein Wert werden.';

/*
 * Der Rohwert bleibt erhalten. Ohne ihn waere die Bereinigung genau der
 * stille Zweig, gegen den Regel 10 geschrieben ist: eine Zeile
 * verschwindet, und niemand kann nachsehen, warum.
 */
ALTER TABLE core.buchungsbeleg
    ADD COLUMN IF NOT EXISTS beleg_datum_roh date;

COMMENT ON COLUMN core.buchungsbeleg.beleg_datum_roh IS
'Das Belegdatum, wie LINA es geliefert hat, wenn es unglaubhaft war (siehe
core.belegdatum_unglaubhaft). In diesem Fall steht beleg_datum auf NULL und der
Beleg faellt aus allen datumsbezogenen Sichten — sichtbar in
mart.belegdatum_ausreisser.';

-- Der Bestand einmal nachziehen. `raw.api_antwort` bleibt unberuehrt
-- (Regel 4) — core laesst sich daraus jederzeit neu aufbauen.
UPDATE core.buchungsbeleg
   SET beleg_datum_roh = beleg_datum, beleg_datum = NULL
 WHERE core.belegdatum_unglaubhaft(beleg_datum, hochgeladen_am);

CREATE OR REPLACE VIEW mart.belegdatum_ausreisser AS
SELECT bl.buchungsbeleg_key,
       bl.betrieb_key,
       b.name                AS betrieb,
       a.name                AS ordner,
       bl.beleg_datum_roh    AS belegdatum_laut_lina,
       bl.hochgeladen_am::date AS hochgeladen_am,
       (bl.beleg_datum_roh - bl.hochgeladen_am::date) AS tage_voraus,
       bl.re_nummer,
       bl.verkaeufer_name    AS lieferant,
       bl.netto
  FROM core.buchungsbeleg bl
  JOIN core.betrieb b ON b.betrieb_key = bl.betrieb_key
  LEFT JOIN core.belegart a ON a.typ_id = bl.typ_id
 WHERE bl.beleg_datum_roh IS NOT NULL
 ORDER BY bl.beleg_datum_roh DESC;

COMMENT ON VIEW mart.belegdatum_ausreisser IS
'Belege, deren Belegdatum mehr als ein Jahr nach ihrem eigenen Upload lag. Sie
stehen mit beleg_datum = NULL in core und fallen damit aus allen datumsbezogenen
Sichten — hier stehen sie trotzdem, damit die Bereinigung nachvollziehbar ist
und nicht selbst zur naechsten stillen Luecke wird.

Am 14.08.2026 waren es 13 von 605.835, mit Belegdaten bis 2038-01-19. Sie haben
max(monat) in vier Mart-Sichten auf 2038-01 gesetzt und damit das Frischemass
unbrauchbar gemacht.';


-- ---------------------------------------------------------------------
-- 2. Der Schwund rechnet nicht mehr mit dem, was er selbst unplausibel
--    nennt
--
-- mart.inventurposition kennzeichnet eine Position als `unplausibel`,
-- wenn Soll- oder Zaehlwert ueber 50.000 EUR liegen. Am 14.08.2026:
-- 123 von 82.126 Positionen, verteilt auf 53 Inventuren.
--
-- mart.inventur_schwund hat das Kennzeichen bis hierher ignoriert. Der
-- Februar 2026 steht deshalb mit minus 2,97 Mio EUR da — aus EINER Zeile.
-- Eine Kennzeichnung, die nur eine von zwei Sichten kennt, ist keine.
--
-- HERAUSGERECHNET UND GENANNT, nicht stillschweigend weggelassen: zwei
-- neue Spalten sagen, wie viel dabei ausgeklammert wurde. Sonst waere die
-- Korrektur derselbe stille Zweig wie der Fehler davor.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.inventur_schwund AS
WITH inv AS (
    SELECT i.inventur_key, i.status, i.erstellt_am,
           k.betrieb_key, k.marke_key,
           i.name ILIKE '%test%'                        AS ist_test,
           i.name ~* '(bar|k[uü]che|keller|lager|getr[aä]nke)' AS ist_teilbereich
      FROM core.inventur i
      JOIN core.kostenstelle k USING (kostenstelle_key)
     WHERE i.status IS DISTINCT FROM 'canceled'
), pos AS (
    SELECT v.inventur_key, v.status, v.erstellt_am, v.betrieb_key, v.marke_key,
           v.ist_test, v.ist_teilbereich,
           p.soll_menge, p.gezaehlt_menge, p.preis_je_basiseinheit,
           coalesce(p.gezaehlt_menge, 0) <> 0 AS gezaehlt,
           /*
            * Dieselbe Schwelle wie in mart.inventurposition. Sie steht hier
            * ein zweites Mal, weil ein Join auf die Sicht den Plan der
            * Aggregation verdoppeln wuerde — dafuer haelt der Test in
            * src/foodnotify/inventur.test.ts beide Stellen zusammen.
            */
           (coalesce(p.soll_menge     * p.preis_je_basiseinheit, 0) > 50000
         OR coalesce(p.gezaehlt_menge * p.preis_je_basiseinheit, 0) > 50000)
             AS unplausibel,
           v.status = 'signed' AND NOT v.ist_test AS zaehlt_mit
      FROM inv v
      LEFT JOIN core.inventurposition p ON p.inventur_key = v.inventur_key
)
SELECT p.betrieb_key,
       bt.name AS betrieb,
       m.name  AS marke,
       date_trunc('month', p.erstellt_am)::date AS monat,
       count(DISTINCT p.inventur_key) FILTER (WHERE NOT p.ist_test) AS inventuren,
       count(DISTINCT p.inventur_key) FILTER (WHERE p.zaehlt_mit)   AS inventuren_signiert,
       -- Ab hier ueberall zusaetzlich NOT p.unplausibel.
       round(sum(p.soll_menge * p.preis_je_basiseinheit)
             FILTER (WHERE p.zaehlt_mit AND p.gezaehlt AND NOT p.unplausibel), 2) AS soll_eur,
       round(sum(p.gezaehlt_menge * p.preis_je_basiseinheit)
             FILTER (WHERE p.zaehlt_mit AND p.gezaehlt AND NOT p.unplausibel), 2) AS gezaehlt_eur,
       round(sum((p.soll_menge - p.gezaehlt_menge) * p.preis_je_basiseinheit)
             FILTER (WHERE p.zaehlt_mit AND p.gezaehlt AND NOT p.unplausibel), 2) AS schwund_eur,
       CASE WHEN sum(p.soll_menge * p.preis_je_basiseinheit)
                 FILTER (WHERE p.zaehlt_mit AND p.gezaehlt AND NOT p.unplausibel) > 0
            THEN round(100 * sum((p.soll_menge - p.gezaehlt_menge) * p.preis_je_basiseinheit)
                             FILTER (WHERE p.zaehlt_mit AND p.gezaehlt AND NOT p.unplausibel)
                           / sum(p.soll_menge * p.preis_je_basiseinheit)
                             FILTER (WHERE p.zaehlt_mit AND p.gezaehlt AND NOT p.unplausibel), 2)
            ELSE NULL END AS schwund_pct,
       count(DISTINCT p.inventur_key) FILTER (WHERE p.ist_test) AS inventuren_test,
       count(DISTINCT p.inventur_key) FILTER (WHERE p.ist_teilbereich AND NOT p.ist_test)
         AS inventuren_teilbereich,
       count(*) FILTER (WHERE p.zaehlt_mit AND p.soll_menge IS NOT NULL AND NOT p.unplausibel)
         AS positionen,
       count(*) FILTER (WHERE p.zaehlt_mit AND p.soll_menge IS NOT NULL
                          AND NOT p.gezaehlt AND NOT p.unplausibel) AS positionen_ohne_zaehlung,
       round(sum(p.soll_menge * p.preis_je_basiseinheit)
             FILTER (WHERE p.zaehlt_mit AND NOT p.gezaehlt AND NOT p.unplausibel), 2)
         AS soll_eur_ohne_zaehlung,
       CASE WHEN sum(p.gezaehlt_menge * p.preis_je_basiseinheit)
                 FILTER (WHERE p.zaehlt_mit AND p.gezaehlt AND NOT p.unplausibel) > 0
            THEN round(sum(p.soll_menge * p.preis_je_basiseinheit)
                           FILTER (WHERE p.zaehlt_mit AND p.gezaehlt AND NOT p.unplausibel)
                       / sum(p.gezaehlt_menge * p.preis_je_basiseinheit)
                           FILTER (WHERE p.zaehlt_mit AND p.gezaehlt AND NOT p.unplausibel), 2)
            ELSE NULL END AS soll_je_gezaehlt,
       -- NEU 0077: was herausgerechnet wurde, steht daneben.
       count(*) FILTER (WHERE p.zaehlt_mit AND p.unplausibel) AS positionen_unplausibel,
       round(sum(greatest(coalesce(p.soll_menge, 0), coalesce(p.gezaehlt_menge, 0))
                 * p.preis_je_basiseinheit)
             FILTER (WHERE p.zaehlt_mit AND p.unplausibel), 2) AS wert_unplausibel
  FROM pos p
  JOIN core.marke m   ON m.marke_key = p.marke_key
  JOIN core.betrieb bt ON bt.betrieb_key = p.betrieb_key
 GROUP BY p.betrieb_key, bt.name, m.name, date_trunc('month', p.erstellt_am);

COMMENT ON VIEW mart.inventur_schwund IS
'Schwund je Betrieb und Monat: Soll gegen Gezaehlt, in Euro und Prozent.

SEIT 0077 OHNE DIE UNPLAUSIBLEN POSITIONEN. Eine Einzelposition ueber 50.000 EUR
ist ein Erfassungsfehler und kein Warenbestand; mart.inventurposition nennt sie
seit 0062 `unplausibel`, diese Sicht hat das Kennzeichen bis dahin ignoriert.
Folge: der Februar 2026 stand mit minus 2,97 Mio EUR da — aus EINER Zeile.

Was herausgerechnet wurde, steht in positionen_unplausibel und
wert_unplausibel. Eine Bereinigung ohne diese beiden Spalten waere derselbe
stille Zweig wie der Fehler davor.

Gezaehlt werden nur signierte, nicht-Test-Inventuren, und nur Positionen mit
einer Zaehlung — was nicht gezaehlt wurde, steht in positionen_ohne_zaehlung.';


-- ---------------------------------------------------------------------
-- 3. Hauptsparten: acht statt zwei (Plan 5.1, Entscheidung 4)
--
-- DIE FRAGE DES PLANS WAR "IST DER SPARTENFILTER EIN PARAMETER?" — und
-- die Antwort steht seit dem 26.07.2026 im Register: ja.
-- `getUmsatzbericht:speisen` und `:getraenke` unterscheiden sich von
-- `getUmsatzbericht` durch genau einen Query-Parameter (`hauptsparten`),
-- und `src/sync/laden.ts` schlaegt daraus schon heute generisch die
-- hauptsparte_key nach. Die Reparatur ist damit klein, so wie der Plan
-- vermutet hat.
--
-- Was fehlte, waren acht Registereintraege — und eine Sicht, an der man
-- sieht, ob es gewirkt hat. Die gibt es hier: sie rechnet die Summe der
-- Sparten gegen die Gesamtzeile und nennt den Rest beim Namen.
--
-- LINA erwartet als Filter die posId und NICHT die nummer; mit der
-- nummer kommt kommentarlos 0 EUR (Hinweis am Registereintrag seit
-- 26.07.2026). Deshalb steht in dieser Sicht die posId.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.hauptsparte_abdeckung AS
WITH gesamt AS (
    SELECT u.geschaeftstag,
           date_trunc('month', u.geschaeftstag)::date AS monat,
           sum(u.umsatz_netto) AS umsatz_gesamt
      FROM core.umsatzbericht_tag u
     WHERE u.hauptsparte_key IS NULL
     GROUP BY 1, 2
), je_sparte AS (
    SELECT date_trunc('month', u.geschaeftstag)::date AS monat,
           sum(u.umsatz_netto) AS umsatz_sparten,
           count(DISTINCT u.hauptsparte_key) AS sparten_mit_umsatz
      FROM core.umsatzbericht_tag u
     WHERE u.hauptsparte_key IS NOT NULL
     GROUP BY 1
)
SELECT g.monat,
       round(sum(g.umsatz_gesamt), 2)                    AS umsatz_gesamt,
       round(coalesce(s.umsatz_sparten, 0), 2)           AS umsatz_sparten,
       round(sum(g.umsatz_gesamt) - coalesce(s.umsatz_sparten, 0), 2) AS nicht_aufteilbar,
       CASE WHEN sum(g.umsatz_gesamt) > 0
            THEN round(100 * (sum(g.umsatz_gesamt) - coalesce(s.umsatz_sparten, 0))
                           / sum(g.umsatz_gesamt), 2)
            ELSE NULL END                                AS nicht_aufteilbar_pct,
       coalesce(s.sparten_mit_umsatz, 0)                 AS sparten_mit_umsatz,
       (SELECT count(*) FROM core.hauptsparte)           AS sparten_bekannt
  FROM gesamt g
  LEFT JOIN je_sparte s ON s.monat = g.monat
 GROUP BY g.monat, s.umsatz_sparten, s.sparten_mit_umsatz
 ORDER BY g.monat DESC;

COMMENT ON VIEW mart.hauptsparte_abdeckung IS
'Wie viel Umsatz laesst sich auf Hauptsparten aufteilen, und wie viel nicht.

VORHER (14.08.2026, letzte 30 Tage): 9.002.801,71 EUR gesamt, davon Speisen
3.504.469,69 und Getraenke 2.634.893,62 — 2.863.438,40 EUR oder 31,8 % standen
nur in der Gesamtzeile. Geholt wurden zwei von zehn Sparten.

ERWARTUNG nach 0077: nicht_aufteilbar_pct faellt gegen null und
sparten_mit_umsatz steigt. Bleibt ein Rest, ist er echt — LINA fuehrt zehn
Sparten, und ob jede davon bebucht wird, ist eine Frage an den Fachbereich und
keine an den Importer.

Die Zeile mit hauptsparte_key IS NULL ist die Gesamtzeile aus
getUmsatzbericht ohne Filter. Sie wird NICHT durch die Summe der Sparten
ersetzt: die Differenz ist genau die Aussage dieser Sicht.';


-- ---------------------------------------------------------------------
-- 4. Zwei Pruefzeilen dazu
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
/*
 * NEU 0077. ERWARTUNG ist NICHT null, sondern KONSTANZ: die 13 Belege
 * vom 14.08.2026 bleiben stehen, weil ihr Rohwert erhalten bleibt.
 * Waechst die Zahl, liefert LINA neue Ausreisser — das ist die Frage.
 */
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
/*
 * NEU 0077. Auch hier ist die Erwartung Konstanz und nicht null: eine
 * Position ueber 50.000 EUR ist ein Erfassungsfehler in FoodNotify, den
 * wir nicht beheben koennen. Sie soll nur nicht mehr in den Schwund
 * einfliessen — und sichtbar bleiben.
 */
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
/*
 * NEU 0077. Gezaehlt werden MONATE, nicht Euro: "in drei Monaten laesst
 * sich ein Drittel nicht aufteilen" ist die Aussage, die jemand braucht.
 * Zehn Prozent ist die Schwelle, ab der aus Rundung ein Loch wird.
 */
SELECT 'Umsatz: Monat mit mehr als 10 % nicht aufteilbarem Umsatz',
       count(*), count(*) FILTER (WHERE nicht_aufteilbar_pct > 10),
       'mart.hauptsparte_abdeckung'
  FROM mart.hauptsparte_abdeckung
UNION ALL
SELECT 'Warteschlange: endgueltig aufgegeben',
       count(*), count(*) FILTER (WHERE zustand = 'endgueltig'),
       'mart.posten_aufgegeben'
  FROM mart.posten_aufgegeben;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0077', to_jsonb(
        'Datenqualitaet und Hauptsparten. 13 Belege datierten mehr als ein Jahr '
        'nach ihrem eigenen Upload (bis 2038) und setzten max(monat) in vier '
        'Sichten auf 2038-01; ihr Rohwert steht jetzt in beleg_datum_roh und sie '
        'sind in mart.belegdatum_ausreisser sichtbar. mart.inventur_schwund '
        'rechnet nicht mehr mit Positionen, die es selbst unplausibel nennt (123 '
        'Stueck, Februar 2026 stand mit minus 2,97 Mio EUR aus EINER Zeile). Und '
        'acht weitere Hauptsparten werden geholt: 31,8 Prozent des Umsatzes waren '
        'bis dahin nicht aufteilbar, gemessen an den letzten 30 Tagen.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
