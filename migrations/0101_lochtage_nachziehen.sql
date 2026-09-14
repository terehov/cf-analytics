-- =====================================================================
-- 0101 — Lochtage holen sich selbst nach (14.09.2026)
--
-- DER FALL, den 0100 nicht sieht. mart.umsatztag_luecke verlangt Artikel-
-- umsatz ueber null bei Tagesumsatz null — den Kassenausfall mit spaeter
-- Nachlieferung. Am 20.–22.07.2026 stehen aber BEIDE Berichte leer: der
-- erste echte Lauf am 26.07. holte die Tage genau einmal, vier bis sechs
-- Tage nach dem Geschaeftstag, und LINA hatte sie noch nicht. Der 23.07.
-- kam im selben Lauf ebenso mit `columns: 0` (19 KB) zurueck und war beim
-- naechsten Abruf am 02.08. voll (3.503 Artikel, 1,1 MB) — LINA fuellt den
-- Artikelverkaufsbericht erst nach fuenf bis sieben Tagen. Das taegliche
-- Fenster begann am 02.08. und reichte zehn Tage zurueck, genau bis zum
-- 23.07.; historieNachziehen() haelt einen ok-Posten fuer erledigt.
--
-- Gemessen 14.09.2026: 22.07. = 0 EUR bei allen 141 Betrieben und keine
-- Artikelzeile; 21.07. = Umsatz bei 21 statt rund 55 Betrieben (13.268 EUR
-- statt rund 300.000); 20.07. = 3.244 statt rund 3.500 Artikel. Sieben
-- Wochen lang, in jeder Auswertung, ohne Meldung — die Karte "Tage mit
-- Datenloch" (mart.umsatz_lochtag, seit 0039) zeigte den Tag mit dem Satz
-- "gehoert neu eingereiht", und kein Mechanismus tat es. Regel 10.
--
-- WAS SICH AENDERT. mart.umsatz_lochtag bekommt am Ende dieselben fuenf
-- Spalten wie mart.umsatztag_luecke (alter_tage, nachgeholt, offen,
-- zuletzt_eingereiht, zustand), gerechnet aus denselben getUmsatzbericht-
-- Posten hinter dem Fenster. lochtageNachziehen() in src/sync/nachfuellen.ts
-- liest zustand = 'faellig' und reiht jeden Tag fuer JEDEN aktiven Konzern-
-- Tagesbericht neu ein, dessen Fenster ihn nicht mehr erreicht — auch fuer
-- den Artikelverkauf, denn hier ist der Umsatzbericht selbst das Signal, es
-- gibt kein Orakel. Hoechstens LOCHTAGE_JE_LAUF Tage je Nacht, dreimal,
-- dann 'aufgegeben' und in der Pruefuebersicht.
--
-- CREATE OR REPLACE VIEW kann nur Spalten ANHAENGEN: die ersten sechs
-- bleiben in Name, Typ und Reihenfolge, wie 0039 sie anlegte.
-- =====================================================================

CREATE OR REPLACE VIEW mart.umsatz_lochtag AS
WITH fenster AS (
    SELECT coalesce(max(nachzuegler_tage), 10) AS tage
      FROM sync.quelle WHERE quelle = 'getUmsatzbericht'
), tag AS (
    SELECT geschaeftstag,
           count(*) FILTER (WHERE umsatz_netto > 0) AS betriebe_mit_umsatz,
           sum(umsatz_netto) AS umsatz
      FROM core.umsatzbericht_tag
     WHERE hauptsparte_key IS NULL AND verkaufsstelle_key IS NULL
       AND geschaeftstag >= current_date - 120
     GROUP BY geschaeftstag
), erwartung AS (
    SELECT geschaeftstag, betriebe_mit_umsatz, umsatz,
           round(avg(betriebe_mit_umsatz)
                 OVER (ORDER BY geschaeftstag ROWS BETWEEN 28 PRECEDING AND 1 PRECEDING)) AS betriebe_erwartet
      FROM tag
), loch AS (
    SELECT geschaeftstag, betriebe_mit_umsatz, betriebe_erwartet, umsatz
      FROM erwartung
     WHERE geschaeftstag < current_date
       AND betriebe_erwartet > 0
       AND betriebe_mit_umsatz < 0.6 * betriebe_erwartet
), nachholung AS (
    -- Posten fuer getUmsatzbericht, die NACH dem Ende des Fensters angelegt
    -- wurden — von lochtageNachziehen() oder nulltageNachziehen(), nicht vom
    -- taeglichen Fenster. Ein Tag ist ein Konzernbericht: ein Posten holt
    -- ihn fuer alle Betriebe. Dieselbe Rechnung wie in mart.umsatztag_luecke.
    SELECT w.zeitraum_von AS geschaeftstag,
           count(*) FILTER (WHERE w.erledigt_am IS NOT NULL) AS nachgeholt,
           bool_or(w.erledigt_am IS NULL)                     AS offen,
           max(w.erstellt_am)                                 AS zuletzt_eingereiht
      FROM sync.warteschlange w, fenster f
     WHERE w.endpunkt = 'getUmsatzbericht'
       AND w.erstellt_am::date > w.zeitraum_von + f.tage + 1
     GROUP BY 1
)
SELECT l.geschaeftstag,
       (ARRAY['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'])
           [extract(isodow FROM l.geschaeftstag)::int]        AS wochentag,
       l.betriebe_mit_umsatz,
       l.betriebe_erwartet,
       l.umsatz,
       CASE WHEN l.betriebe_mit_umsatz = 0 THEN 'komplett leer' ELSE 'lückenhaft' END AS befund,
       (current_date - l.geschaeftstag)                       AS alter_tage,
       coalesce(n.nachgeholt, 0)                              AS nachgeholt,
       coalesce(n.offen, false)                               AS offen,
       n.zuletzt_eingereiht,
       CASE WHEN (current_date - l.geschaeftstag) <= f.tage            THEN 'im Fenster'
            WHEN coalesce(n.offen, false)                               THEN 'eingereiht'
            WHEN coalesce(n.nachgeholt, 0) >= 3                         THEN 'aufgegeben'
            WHEN n.zuletzt_eingereiht > now() - interval '7 days'       THEN 'wartet'
            ELSE 'faellig' END                                 AS zustand
  FROM loch l
  LEFT JOIN nachholung n USING (geschaeftstag)
  CROSS JOIN fenster f
 ORDER BY l.geschaeftstag DESC;

COMMENT ON VIEW mart.umsatz_lochtag IS
'Geschaeftstage der letzten 120 Tage, an denen weniger als 60 % der Betriebe Umsatz melden,
die es im 28-Tage-Schnitt davor taten. Seit 0101 zugleich Arbeitsliste des Laufs:
lochtageNachziehen() liest zustand = ''faellig'' und reiht den Tag fuer JEDEN Konzern-
Tagesbericht neu ein, dessen Fenster ihn nicht mehr erreicht — auch fuer den Artikelverkauf.

zustand: im Fenster = holt der taegliche Lauf ohnehin · faellig = naechste Nacht ·
eingereiht = Posten offen · wartet = vor weniger als sieben Tagen nachgeholt, weiter leer ·
aufgegeben = dreimal nachgeholt, LINA hat den Tag nicht. Die Pruefuebersicht zaehlt NUR
aufgegeben — was faellig ist, ist Betrieb und kein Befund.

Anlass: 20.–22.07.2026, am 26.07. im ersten Lauf vier bis sechs Tage nach dem Geschaeftstag
geholt (LINA fuellt erst nach fuenf bis sieben Tagen), vom Fenster ab 02.08. nicht mehr
erreicht. Der 22.07. stand sieben Wochen bei allen 141 Betrieben auf null, in beiden
Berichten. Der Unterschied zu mart.umsatztag_luecke: dort kennt der Artikelverkauf den Tag,
hier kennt ihn keiner.';

-- ---------------------------------------------------------------------
-- Pruefuebersicht: eine Zeile mehr. Wortgleich aus 0100 uebernommen, nur
-- die letzte Zeile ist neu — CREATE OR REPLACE VIEW braucht die ganze Sicht.
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
 SELECT 'Belegarchiv: Zaehlung ueberfaellig (Takt je Freigabe)'::text AS pruefung,
    count(*) FILTER (WHERE belegarchiv_zulauf.zustand <> 'kein belegarchiv'::text) AS geprueft,
    count(*) FILTER (WHERE belegarchiv_zulauf.zustand <> 'kein belegarchiv'::text AND (belegarchiv_zulauf.zuletzt_gezaehlt IS NULL OR belegarchiv_zulauf.zuletzt_gezaehlt < (now() -
        CASE
            WHEN belegarchiv_zulauf.inhalt_holen THEN '10 days'::interval
            ELSE '36 days'::interval
        END))) AS auffaellig,
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
   FROM mart.pruefung_materialisierung
UNION ALL
 SELECT pruefung_pflichtartikel.pruefung,
    pruefung_pflichtartikel.geprueft,
    pruefung_pflichtartikel.auffaellig,
    pruefung_pflichtartikel.sicht
   FROM mart.pruefung_pflichtartikel
UNION ALL
 SELECT pruefung_bounti.pruefung,
    pruefung_bounti.geprueft,
    pruefung_bounti.auffaellig,
    pruefung_bounti.sicht
   FROM mart.pruefung_bounti
UNION ALL
 SELECT pruefung_bestelldetail.pruefung,
    pruefung_bestelldetail.geprueft,
    pruefung_bestelldetail.auffaellig,
    pruefung_bestelldetail.sicht
   FROM mart.pruefung_bestelldetail
UNION ALL
 SELECT 'Umsatz: Nulltag mit Artikelverkauf ausserhalb des Fensters (3x nachgeholt, bleibt null)'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE umsatztag_luecke.zustand = 'aufgegeben') AS auffaellig,
    'mart.umsatztag_luecke'::text AS sicht
   FROM mart.umsatztag_luecke
UNION ALL
 SELECT 'Umsatz: Lochtag ausserhalb des Fensters (3x nachgeholt, bleibt leer)'::text AS pruefung,
    count(*) AS geprueft,
    count(*) FILTER (WHERE umsatz_lochtag.zustand = 'aufgegeben') AS auffaellig,
    'mart.umsatz_lochtag'::text AS sicht
   FROM mart.umsatz_lochtag;
