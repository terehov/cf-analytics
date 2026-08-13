-- =====================================================================
-- 0078 — Yext ohne Handbefehl (Plan Phase 5.2 und 5.3)
--
-- ZWEI HANDBEFEHLE UND EINE REIHENFOLGE, alle drei am 14.08.2026 in
-- Produktion nachgemessen.
--
--   1. `bun run yext --voll` (25 Monate) lief zuletzt am 03.08.2026.
--      Alle Staende vor Mai 2026 tragen seitdem denselben `geladen_am`.
--      Ein Stand ist kumuliert und aendert sich nicht mehr — GELOESCHTE
--      Bewertungen aendern aber auch alte Staende, und die sieht das
--      Drei-Monats-Fenster nie.
--
--   2. `bun run yext:zuordnen --schreiben` lief ebenfalls zuletzt am
--      03.08.2026. **Sieben operative Betriebe** haben keine
--      Yext-Zuordnung und fehlen damit in jeder Bewertungstabelle:
--      B+L Pforzheim, BS Bier & Speisen, Gastronomie Wilsdruffer
--      Strasse, SCHAFFERONE, WHK Gastronomie, Wirtshaus am Schlossplatz,
--      Wirtshaus Lautenschlager.
--
--   3. `yextNachlauf()` lief als LETZTER Nachlauf, hinter dem
--      Round-Table-Refresh — und `mart.round_table_monat` ist seit 0039
--      materialisiert. Zwei Betriebe trugen dauerhaft eine Note aus dem
--      Vortag in der Ampel.
--
-- Alle drei sind ab jetzt Sache des naechtlichen Laufs. Diese Migration
-- baut, was dazugehoert: die Sichten, an denen man sieht, ob es wirkt.
--
-- DAZU EIN TIPPFEHLER MIT VIER MONATEN WIRKUNG. `core.betrieb_sichtbar-
-- keit.eintraege_live` war in ALLEN 1.497 Zeilen NULL, waehrend die neun
-- uebrigen Metriken derselben Antwort gefuellt sind. Angefordert wird
-- `POWERLISTINGS_LIVE`, gelesen wurde `LISTINGS_LIVE`. Der Plan wollte
-- „erst pruefen, ob Yext das Feld ueberhaupt liefert — wenn nicht,
-- gehoert die Spalte aus der Karte". Es liefert es. Die Spalte bleibt.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die sieben Betriebe ohne Yext-Zuordnung — sichtbar, nicht geraten
--
-- Der Abgleich ordnet ueber Namen zu. Wo das nicht eindeutig geht, steht
-- die Entscheidung in `VON_HAND` (src/yext/zuordnen.ts) — und wo auch das
-- offen ist, steht sie hier. Dieselbe Bauart wie
-- mart.kostenstelle_ohne_betrieb (0073): eine Entscheidungsliste, keine
-- Heuristik.
--
-- ZWEI RICHTUNGEN, WEIL ES ZWEI FRAGEN SIND: ein Betrieb ohne Entitaet
-- ist etwas anderes als eine Entitaet ohne Betrieb. Die zweite Richtung
-- steht im Log des Nachlaufs und in `VON_HAND`; hier steht die erste,
-- weil nur sie in einer Auswertung fehlt.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.betrieb_ohne_yext AS
SELECT b.betrieb_key,
       b.name AS betrieb,
       s.status,
       kz.hauptkonzept AS konzept,
       st.ort,
       /*
        * Hat der Betrieb ueberhaupt Umsatz? Ein operativer Betrieb ohne
        * Umsatz ist eine andere Frage als einer mit — und nur der zweite
        * fehlt jemandem im Round Table.
        */
       EXISTS (SELECT 1 FROM core.umsatzbericht_tag u
                WHERE u.betrieb_key = b.betrieb_key
                  AND u.geschaeftstag > current_date - 90
                  AND coalesce(u.umsatz_netto, 0) > 0) AS macht_umsatz
  FROM core.betrieb b
  JOIN mart.betrieb_status s ON s.betrieb_key = b.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = b.betrieb_key
  LEFT JOIN manual.betrieb_standort st ON st.betrieb_key = b.betrieb_key
 WHERE NOT EXISTS (SELECT 1 FROM manual.betrieb_fremd_id f
                    WHERE f.betrieb_key = b.betrieb_key AND f.system = 'yext')
 ORDER BY s.status, b.name;

COMMENT ON VIEW mart.betrieb_ohne_yext IS
'Betriebe ohne Yext-Zuordnung — sie fehlen in JEDER Bewertungstabelle, und zwar
lautlos: `staendeLaden()` fragt Yext je zugeordnetem Betrieb, ein nicht
zugeordneter erzeugt keine leere Zeile, sondern gar keine.

ERWARTUNG: keine Zeile mit status = operativ UND macht_umsatz = true. Alles
andere ist in Ordnung — geschlossene Betriebe, Holdings und Testeintraege haben
zu Recht keine Yext-Entitaet.

Am 14.08.2026 standen hier sieben operative Betriebe: B+L Pforzheim, BS Bier &
Speisen, Gastronomie Wilsdruffer Strasse, SCHAFFERONE, WHK Gastronomie,
Wirtshaus am Schlossplatz, Wirtshaus Lautenschlager. Fuer drei davon gibt es in
`src/yext/zuordnen.ts` einen Verdacht (L_03, EK_14, EK_06), der ausdruecklich
als OFFEN eingetragen ist — sechsstellige Bewertungszahlen zu raten waere
teurer als sie zu vermissen.';


-- ---------------------------------------------------------------------
-- 2. Wie alt ist der letzte Vollabgleich?
--
-- Die Frage, die man dem Bestand nicht ansieht: `core.bewertung_stand`
-- sieht vollstaendig aus, weil die 25 Monate einmal geholt wurden. Dass
-- sie seit dem 03.08.2026 nicht mehr nachgezogen wurden, steht nur im
-- `geladen_am` — und danach sieht niemand.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.yext_abgleich AS
SELECT m.schluessel,
       CASE m.schluessel
         WHEN 'yext_letzter_lauf'        THEN 'Taeglicher Lauf (3 Monate)'
         WHEN 'yext_letzter_vollabgleich' THEN 'Vollabgleich (25 Monate)'
         WHEN 'yext_letzte_zuordnung'    THEN 'Zuordnung Betrieb → Entitaet'
         ELSE m.schluessel
       END AS aufgabe,
       coalesce((m.wert->>'am')::timestamptz,
                (m.wert->>'beendet_am')::timestamptz) AS zuletzt,
       round(EXTRACT(epoch FROM (now() - coalesce((m.wert->>'am')::timestamptz,
                                                  (m.wert->>'beendet_am')::timestamptz)))
             / 86400, 1) AS tage_her
  FROM sync.merker m
 WHERE m.schluessel IN ('yext_letzter_lauf', 'yext_letzter_vollabgleich',
                        'yext_letzte_zuordnung')
 ORDER BY 1;

COMMENT ON VIEW mart.yext_abgleich IS
'Wann die drei Yext-Aufgaben zuletzt gelaufen sind. Alle drei haengen am
naechtlichen Lauf und brauchen keinen Befehl (seit 14.08.2026):

  taeglicher Lauf   drei Monate, hoechstens einmal in 20 Stunden
  Vollabgleich      25 Monate, alle YEXT_VOLLABGLEICH_TAGE (30)
  Zuordnung         Betrieb → Yext-Entitaet, im selben Takt

Eine fehlende Zeile heisst "noch nie gelaufen" und ist vor dem ersten Lauf mit
dieser Version normal. Bleibt sie leer, laeuft der Nachlauf nicht — die
Pruefung "yext" in src/status.ts sagt dann, woran es liegt.';


-- ---------------------------------------------------------------------
-- 3. Drei Pruefzeilen
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
/*
 * NEU 0078. Gezaehlt wird nur, wem die Bewertung wirklich fehlt: ein
 * operativer Betrieb MIT Umsatz. Geschlossene Betriebe, Holdings und
 * Testeintraege haben zu Recht keine Entitaet — sie mitzuzaehlen ergaebe
 * eine Zeile, die nie auf null geht.
 */
SELECT 'Yext: operativer Betrieb mit Umsatz, aber ohne Zuordnung',
       (SELECT count(*) FROM mart.betrieb_status WHERE status = 'operativ'),
       count(*) FILTER (WHERE status = 'operativ' AND macht_umsatz),
       'mart.betrieb_ohne_yext'
  FROM mart.betrieb_ohne_yext
UNION ALL
/*
 * NEU 0078. Der Vollabgleich haengt am naechtlichen Lauf und laeuft alle
 * 30 Tage; 45 ist die Schwelle, ab der er ausgefallen sein muss und nicht
 * nur spaet ist.
 */
SELECT 'Yext: Vollabgleich aelter als 45 Tage',
       count(*) FILTER (WHERE schluessel = 'yext_letzter_vollabgleich'),
       count(*) FILTER (WHERE schluessel = 'yext_letzter_vollabgleich'
                          AND tage_her > 45),
       'mart.yext_abgleich'
  FROM mart.yext_abgleich
UNION ALL
/*
 * NEU 0078. Die Gegenprobe zum Tippfehler: `eintraege_live` stand in
 * allen 1.497 Zeilen auf NULL, weil POWERLISTINGS_LIVE angefordert und
 * LISTINGS_LIVE gelesen wurde. Eine leere Spalte hinter einer gruenen
 * Ampel faellt sonst niemandem auf.
 */
SELECT 'Yext: Sichtbarkeitszeile ohne eintraege_live',
       count(*), count(*) FILTER (WHERE eintraege_live IS NULL),
       'core.betrieb_sichtbarkeit'
  FROM core.betrieb_sichtbarkeit
UNION ALL
SELECT 'Warteschlange: endgueltig aufgegeben',
       count(*), count(*) FILTER (WHERE zustand = 'endgueltig'),
       'mart.posten_aufgegeben'
  FROM mart.posten_aufgegeben;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0078', to_jsonb(
        'Yext ohne Handbefehl. Der Vollabgleich (25 Monate) und der '
        'Zuordnungsabgleich laufen ab jetzt einmal im Monat als Teil des '
        'naechtlichen Laufs; beide waren bis zum 14.08.2026 Handbefehle und '
        'liefen zuletzt am 03.08. Sieben operative Betriebe hatten deshalb keine '
        'Yext-Zuordnung und fehlten in jeder Bewertungstabelle. Dazu: '
        'yextNachlauf() steht jetzt VOR dem Round-Table-Refresh (zwei Betriebe '
        'trugen eine Note aus dem Vortag), und eintraege_live wird endlich '
        'gefuellt — angefordert wurde POWERLISTINGS_LIVE, gelesen LISTINGS_LIVE.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
