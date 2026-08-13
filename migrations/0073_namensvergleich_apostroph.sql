-- =====================================================================
-- 0073 Ein Apostroph kostet einen Betrieb — und die Zuordnung laeuft
--      endlich mit
--
-- ANLASS. Punkt 2.4/2.8 des Plans: 25 der 152 Kostenstellen haben keinen
-- betrieb_key, darunter zwei mit erheblichem Einkaufsvolumen. Ihr Einkauf
-- faellt aus jeder betriebsbezogenen Sicht. Die beiden dafuer gebauten
-- Funktionen — manual.betrieb_vorschlaege_berechnen() und
-- manual.betrieb_zuordnung_anwenden() — werden in Produktion NIE
-- aufgerufen; nur Tests rufen sie.
--
-- ---------------------------------------------------------------------
-- WAS DIE MESSUNG WIDERLEGT HAT
--
-- Der Nachtrag (§2.8) nahm an, die ungenutzte fn:betriebe-Antwort in
-- raw.api_antwort halte die Restaurantliste, die diese 25 zuordnen
-- koennte. Am 13.08.2026 lesend in Produktion nachgemessen: SIE HAELT SIE
-- NICHT.
--
--   fn:betriebe kennt 78 Restaurants.
--   Davon ohne Kostenstelle in core:        0
--   Namen, die von core.kostenstelle.restaurant_name abweichen: 0
--   Verschiedene Zeitzonen:                 1 (alle Europe/Vienna)
--
-- Ein Lader-Case fuer fn:betriebe schriebe also eine Tabelle, die
-- core.kostenstelle Spalte fuer Spalte doppelt, plus eine konstante
-- Zeitzone. Er ist deshalb NICHT gebaut worden — das steht so in
-- docs/entscheidungen.md, damit es niemand fuer Vergesslichkeit haelt.
--
-- ---------------------------------------------------------------------
-- WAS ES STATTDESSEN IST: EIN APOSTROPH
--
-- core.name_norm() faltet Umlaute und Akzente und uebersetzt dabei die
-- Apostroph-Zeichen ´ ` ' in LEERZEICHEN statt sie zu entfernen. Das
-- typografische ’ (U+2019) kennt sie gar nicht.
--
--   core.name_norm('Lehner´s Wirtshaus Rastatt GmbH') -> lehner s wirtshaus rastatt
--   core.name_norm('Lehners Wirtshaus Rastatt GmbH')  -> lehners wirtshaus rastatt
--
-- Zwei Namen, die dasselbe Haus meinen, treffen sich nicht: Aehnlichkeit
-- 0.83 statt Gleichheit, also 'unsicher' statt 'exakt', also keine
-- Zuordnung. Genau derselbe Fehler, den der Kommentar an dieser Funktion
-- fuer Umlaute beschreibt ("munster" gegen "muenster") — eine Zeile
-- darunter, mit einem anderen Zeichen.
--
-- DIE WIRKUNG IST GEMESSEN, NICHT GESCHAETZT. Ueber alle 79 Restaurants
-- mal 141 Betriebe:
--
--   exakte Treffer heute                      59
--   exakte Treffer mit entfernten Apostrophen 60
--   neu dazu                                   1   (Lehner´s Rastatt)
--   verloren                                   0
--
-- Kein einziger bestehender Treffer geht verloren, keine neue Kollision.
-- Apostroph-Zeichen tragen ueberhaupt nur 6 der 79 Restaurantnamen und
-- KEINER der 141 Betriebsnamen.
--
-- ---------------------------------------------------------------------
-- WAS DANACH NOCH OFFEN IST — UND WARUM DAS KEIN FEHLER IST
--
-- Sechs Restaurants mit Bestellungen bleiben ohne Betrieb, und sie
-- brauchen eine ENTSCHEIDUNG, keinen Automaten:
--
--   Aposto Aachen - Alte Post  458 Bestellungen. LINA fuehrt sowohl
--                              "Alte Post Aachen Gaststaettenbetriebs
--                              GmbH" als auch "GESCHLOSSEN Alte Post
--                              Aachen GmbH".
--   Aposto Wuppertal II        246 Bestellungen. LINA fuehrt "Aposto
--                              Wuppertal GmbH" UND "Aposto Wuppertal -
--                              Alter Papierfabrik". Welches Haus das "II"
--                              meint, sagt kein Name.
--   Enchilada Darmstadt         76, Riegele Wirtshaus 76,
--   Enchilada Halle             34 (LINA kennt nur eine GESCHLOSSENE),
--   Lehner's Wirtshaus Karlsruhe 1
--
-- Ein Automat, der hier raet, ordnet sechsstellige Einkaufsbetraege dem
-- falschen Betrieb zu — lautlos und plausibel. Deshalb bleiben sie offen
-- und werden SICHTBAR statt geraten: mart.kostenstelle_ohne_betrieb und
-- eine eigene Zeile in der Pruefuebersicht.
--
-- ---------------------------------------------------------------------
-- KEIN AUFRUFBUDGET BETROFFEN. Diese Migration rechnet auf vorhandenen
-- Daten. Sie holt nichts.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Apostroph-Zeichen ERSATZLOS entfernen, nicht in Leerzeichen wandeln
--
-- translate() loescht jedes Quellzeichen, fuer das es kein Zielzeichen
-- gibt — die fuenf Apostroph-Varianten stehen deshalb am Ende der Quelle
-- und haben in der Zielzeichenkette keine Entsprechung mehr.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.name_norm(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    WITH gefaltet AS (
        SELECT regexp_replace(
            /**
             * Umlaute ZWEISTELLIG falten: ue, oe, ae — nicht u, o, a.
             * FoodNotify schreibt "Aposto Münster", LINA "Aposto Muenster".
             * Ein einstelliges translate() macht daraus "munster" und
             * "muenster" — die beiden treffen sich dann NICHT, und der
             * Betrieb bliebe ohne Zuordnung, obwohl beide Namen dasselbe
             * Haus meinen.
             *
             * APOSTROPHE WERDEN GELOESCHT, NICHT ZU LEERZEICHEN (13.08.2026).
             * Bis dahin standen ´ ` ' in der Quelle mit je einem Leerzeichen
             * als Ziel — aus "Lehner´s" wurde "lehner s" statt "lehners",
             * und der Vergleich gegen LINAs "Lehners Wirtshaus Rastatt GmbH"
             * ergab 0.83 statt Gleichheit: 'unsicher' statt 'exakt', also
             * keine Zuordnung. Derselbe Fehler wie bei den Umlauten, ein
             * Zeichen weiter. Das typografische ’ und das ‘ fehlten ganz und
             * blieben unveraendert im Namen stehen.
             *
             * Gemessen ueber alle 79 Restaurants mal 141 Betriebe: 59 exakte
             * Treffer vorher, 60 nachher, 0 verloren, keine neue Kollision.
             */
            translate(
                replace(replace(replace(replace(
                    lower(coalesce(p, '')),
                    'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'),
                'áàâéèêíìîóòôúùû´`''’‘',
                'aaaeeeiiiooouuu'),
            -- Statuspraefixe: LINA schreibt den Zustand in den Namen.
            '^(geschlossen|insolvent|inaktiv)[[:space:]-]*', '', 'gi') AS t
    )
    /**
     * Rechtsformen und Fuellwoerter am ENDE — bis zu dreimal, weil sie
     * sich stapeln: "Alte Post Aachen Gaststaettenbetriebs GmbH" traegt
     * zwei davon. Ein einzelner Durchlauf entfernt nur "GmbH" und laesst
     * "gaststaettenbetriebs" stehen; gegenueber "GESCHLOSSEN Alte Post
     * Aachen GmbH" (das sauber zu "alte post aachen" wird) verliert der
     * AKTIVE Betrieb dann den Vergleich 0.4 zu 0.8 — der Automat haette
     * die stillgelegte Gesellschaft vorgeschlagen.
     */
    SELECT trim(regexp_replace(regexp_replace(regexp_replace(t,
        '[[:space:],.-]*(gmbh([[:space:]]*&[[:space:]]*co\.?[[:space:]]*kg)?|ug|kg|ohg|e\.?k\.?|mbh|gaststa[e]?ttenbetriebs?|gastrobetriebs?|betriebs?)[[:space:],.-]*$', '', 'gi'),
        '[[:space:],.-]*(gmbh([[:space:]]*&[[:space:]]*co\.?[[:space:]]*kg)?|ug|kg|ohg|e\.?k\.?|mbh|gaststa[e]?ttenbetriebs?|gastrobetriebs?|betriebs?)[[:space:],.-]*$', '', 'gi'),
        '[[:space:],.-]*(gmbh([[:space:]]*&[[:space:]]*co\.?[[:space:]]*kg)?|ug|kg|ohg|e\.?k\.?|mbh|gaststa[e]?ttenbetriebs?|gastrobetriebs?|betriebs?)[[:space:],.-]*$', '', 'gi'))
      FROM gefaltet;
$$;

COMMENT ON FUNCTION core.name_norm(text) IS
'Normalisiert Betriebsnamen fuer den Vergleich zwischen LINA und FoodNotify:
Umlaute gefaltet, Akzente gefaltet, Apostrophe GELOESCHT, LINA-Statuspraefixe
(GESCHLOSSEN/INSOLVENT) und gestapelte Rechtsformen entfernt.

Ohne die Statuspraefixe scheitern 6 von 13 Namensvarianten; ohne den mehrfachen
Durchlauf gewinnt bei "Alte Post Aachen" die geschlossene Gesellschaft gegen die
aktive. Und ohne das Loeschen der Apostrophe (13.08.2026) wird aus "Lehner´s"
ein "lehner s" statt "lehners" — gemessen ein verlorener Betrieb.

Die drei Faltungen sind derselbe Gedanke auf drei Zeichenklassen: was zwei
Systeme verschieden schreiben, aber gleich meinen, muss gleich aussehen.';


-- ---------------------------------------------------------------------
-- 2. Die Zuordnung sofort neu rechnen und anwenden
--
-- Ohne diesen Schritt wirkte die Korrektur erst beim naechsten Lauf. Und
-- der Nachlauf, der sie kuenftig bei JEDEM Lauf zieht, ist Teil desselben
-- Deploys — er wuerde es also ohnehin tun. Hier steht es, damit der
-- Zustand unmittelbar nach der Migration schon stimmt.
-- ---------------------------------------------------------------------

SELECT manual.betrieb_vorschlaege_berechnen();
SELECT manual.betrieb_zuordnung_anwenden();


-- ---------------------------------------------------------------------
-- 3. mart.kostenstelle_ohne_betrieb — die Entscheidungsliste
--
-- Was hier steht, ist kein Fehler und kein Rueckstand, sondern eine
-- offene fachliche Frage. Sie darf nur nicht still sein: der Einkauf
-- dieser Kostenstellen faellt aus jeder betriebsbezogenen Sicht, und in
-- den Zahlen sieht man ihm das nicht an.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.kostenstelle_ohne_betrieb AS
SELECT k.restaurant_id,
       m.schluessel                       AS marke,
       trim(k.restaurant_name)            AS restaurant,
       count(*)::int                      AS kostenstellen,
       (SELECT count(*)::int FROM core.bestellung b
          JOIN core.kostenstelle k2 USING (kostenstelle_key)
         WHERE k2.restaurant_id = k.restaurant_id) AS bestellungen,
       z.grund,
       z.vorschlag_name,
       round(z.trgm::numeric, 3)          AS trgm,
       round(z.token_jaccard::numeric, 3) AS token_jaccard,
       -- Testbetriebe sind kein Befund: sie gehoeren uns nicht und sollen
       -- keinen Betrieb bekommen. Getrennt gefuehrt, nicht weggelassen —
       -- wer sie nicht sieht, sucht sie irgendwann.
       (z.grund = 'testbetrieb')          AS testbetrieb
  FROM core.kostenstelle k
  JOIN core.marke m USING (marke_key)
  LEFT JOIN manual.betrieb_zuordnung z ON z.restaurant_id = k.restaurant_id
 WHERE k.betrieb_key IS NULL
 GROUP BY k.restaurant_id, m.schluessel, trim(k.restaurant_name),
          z.grund, z.vorschlag_name, z.trgm, z.token_jaccard
 ORDER BY (SELECT count(*) FROM core.bestellung b
             JOIN core.kostenstelle k2 USING (kostenstelle_key)
            WHERE k2.restaurant_id = k.restaurant_id) DESC;

COMMENT ON VIEW mart.kostenstelle_ohne_betrieb IS
'Kostenstellen ohne betrieb_key — je Restaurant eine Zeile, nach Bestellvolumen
sortiert. Ihr Einkauf faellt aus JEDER betriebsbezogenen Sicht heraus, ohne dass
man es einer Zahl ansieht.

ERWARTUNG: nur Zeilen mit testbetrieb = true, plus die, zu denen eine bewusste
Entscheidung vorliegt. Alles andere ist Arbeit.

  grund = exakt / variante   sollte gar nicht hier stehen — dann hat der Nachlauf
                             nicht gegriffen.
  grund = unsicher           es gibt einen Vorschlag, aber er ist nicht eindeutig.
                             ENTSCHEIDUNG NOETIG: manual.betrieb_zuordnung.
                             entscheidung_key setzen, der naechste Lauf traegt sie ein.
  grund = kein_treffer       LINA fuehrt diesen Betrieb nicht. Das ist eine Grenze
                             der Quelle, keine Nachlaessigkeit.
  grund = testbetrieb        gehoert uns nicht. Bleibt so.

Am 13.08.2026 standen hier nach der Apostroph-Korrektur sechs Restaurants mit
Bestellungen. Die beiden schwersten brauchen eine Entscheidung und duerfen NICHT
geraten werden: "Aposto Aachen - Alte Post" (458 Bestellungen; LINA fuehrt eine
aktive UND eine geschlossene Gesellschaft desselben Namens) und "Aposto Wuppertal
II" (246; LINA fuehrt "Aposto Wuppertal GmbH" und "Aposto Wuppertal - Alter
Papierfabrik", und welches Haus das "II" meint, sagt kein Name). Ein Automat, der
hier raet, ordnet sechsstellige Betraege lautlos dem falschen Betrieb zu.';


-- ---------------------------------------------------------------------
-- 4. Die Pruefzeile
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
/*
 * NEU MIT 0073. Testbetriebe zaehlen NICHT mit — sie gehoeren uns nicht und
 * sollen keinen Betrieb bekommen. Wer sie mitzaehlte, bekaeme eine Zeile, die
 * nie auf null geht, und die liest dann niemand mehr.
 *
 * Gezaehlt werden nur Restaurants MIT Bestellungen: eine Kostenstelle ohne
 * Einkauf ist keine Luecke in den Zahlen.
 */
SELECT 'Einkauf: Kostenstelle ohne Betrieb, mit Bestellungen',
       count(*), count(*) FILTER (WHERE NOT testbetrieb AND bestellungen > 0),
       'mart.kostenstelle_ohne_betrieb'
  FROM mart.kostenstelle_ohne_betrieb
UNION ALL
SELECT 'Warteschlange: endgueltig aufgegeben',
       count(*), count(*) FILTER (WHERE zustand = 'endgueltig'),
       'mart.posten_aufgegeben'
  FROM mart.posten_aufgegeben;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0073', to_jsonb(
        'core.name_norm() loescht Apostrophe, statt sie in Leerzeichen zu '
        'wandeln — gemessen 59 exakte Namenstreffer vorher, 60 nachher, 0 '
        'verloren. Dazu mart.kostenstelle_ohne_betrieb als Entscheidungsliste '
        'und eine Pruefzeile dafuer. WIDERLEGT: fn:betriebe haelt NICHT die '
        'Restaurantliste, die die 25 Kostenstellen ohne betrieb_key zuordnen '
        'koennte — alle 78 Restaurants sind bereits in core.kostenstelle, mit '
        'identischen Namen und einer einzigen Zeitzone. Ein Lader-Case dafuer '
        'ist deshalb nicht gebaut worden.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
