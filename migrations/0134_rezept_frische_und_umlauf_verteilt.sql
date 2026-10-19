-- =====================================================================
-- 0134 — Rezepte: Frische je Rezept sichtbar, Umlauf ueber den Zyklus
--        verteilt, Ueberfaellige als Befund
--
-- ANLASS 1 (19.10.2026): Claude beantwortete ueber den MCP-Zugang „in
-- welchen Rezepten steckt 300203" und nannte als Datenstand den 15.10.2026.
-- Es nahm mart.rezept_stand.aeltester_zutatenabruf, weil
-- mart.artikel_in_rezept je Rezept KEINEN Zeitstempel fuehrte. Die Zahl ist
-- das Minimum ueber alle Rezepte der Marke und sagt ueber ein einzelnes
-- Rezept nichts: die Liste wird taeglich geprueft, die Zusammensetzung im
-- Umlauf (REZEPT_UMLAUF_TAGE = 14).
--
-- ANLASS 2: alle ~17.700 Rezepte kamen am 15./16.10.2026 im ersten Abzug.
-- Mit der Regel „aelter als 14 Tage" waeren sie um den 29./30.10. ALLE
-- gleichzeitig faellig geworden (~35.000 Aufrufe in einer Nacht) und danach
-- alle 14 Tage wieder — der Umlauf haette den Gleichstand des ersten Abzugs
-- fuer immer konserviert.
--
-- WAS DIESE MIGRATION TUT:
--
--   sync   rezept_umlauf_faellig(fn_id, zutaten_geholt_am, jetzt, umlauf):
--          jedes Rezept hat einen festen Tag im Zyklus (fn_id mod umlauf =
--          Tageszahl mod umlauf). Faellig an seinem Tag, wenn der letzte
--          Abruf mindestens einen Tag alt ist — und IMMER, sobald er aelter
--          als der Umlauf ist (eine ausgefallene Nacht verschiebt kein
--          Rezept um einen ganzen Zyklus). Begruendung der Mindestalter-
--          Grenze von EINEM Tag statt eines halben Zyklus:
--          docs/entscheidungen.md, 19.10.2026.
--   mart   rezept_position + rezept_zuletzt_gesehen (zutaten_geholt_am
--          hatte sie schon).
--   mart   artikel_in_rezept + zutaten_geholt_am, rezept_zuletzt_gesehen,
--          via_zutaten_geholt_am, weg_zutaten_geholt_am.
--   mart   rezept_stand + ueberfaellig, umlauf_tage, umlauf_tage_quelle,
--          Zustand 'umlauf ueberfaellig'. Der Umlauf kommt aus sync.merker
--          (rezept_umlauf_tage), geschrieben von rezepteNachfuellen().
--   mart   pruefung_uebersicht: der neue Zustand faellt in der Rezept-Zeile auf.
--   mcp    Koernung, Kommentare, Fallstrick rezept_stand_kein_rezeptstand.
--
-- Alle Spalten werden nur ANGEHAENGT (CREATE OR REPLACE VIEW kann nicht
-- umsortieren). Die Definitionen sind am 19.10.2026 aus einer Datenbank im
-- Stand 0133 gezogen (pg_get_viewdef), nicht aus 0132 abgeschrieben. Weil
-- 0132 nach dem ersten Anlegen mehrfach nachgebessert wurde, prueft
-- Abschnitt 0 die Spaltenlisten der Zieldatenbank, bevor etwas ersetzt wird:
-- weicht sie ab, bricht die Migration ab, statt eine fremde Fassung still zu
-- ueberschreiben.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Steht in der Zieldatenbank die Fassung, auf der diese Migration baut?
-- ---------------------------------------------------------------------

DO $pruefung$
DECLARE
    r record;
    v_ist text[];
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('mart.rezept_position', ARRAY[
            'marke', 'marke_key', 'rezept_key', 'rezept_fn_id', 'rezept', 'position', 'art',
            'artikelnummer', 'ware', 'lieferant', 'lieferant_fn_id', 'menge', 'einheit', 'kosten',
            'gruppe', 'sub_rezept_fn_id', 'unterrezept', 'zuordnung', 'in_liste', 'zutaten_geholt_am',
            'fehlt_seit', 'unterrezept_unbekannt', 'archiviert', 'basis_menge', 'basis_einheit',
            'unterrezept_archiviert', 'rezept_erstellt_am']),
        ('mart.artikel_in_rezept', ARRAY[
            'marke', 'marke_key', 'artikelnummer', 'ware', 'lieferant', 'lieferant_fn_id', 'zuordnung',
            'rezept', 'rezept_fn_id', 'rezept_key', 'ebene', 'via_rezept', 'via_rezept_fn_id',
            'via_position', 'via_menge', 'via_einheit', 'direkt_rezept', 'direkt_key', 'position',
            'menge', 'einheit', 'kosten', 'pfad', 'art', 'rezept_fehlt_seit', 'rezept_archiviert',
            'basis_menge', 'basis_einheit', 'via_archiviert', 'rezept_erstellt_am',
            'direkt_rezept_fn_id']),
        ('mart.rezept_stand', ARRAY[
            'marke_key', 'marke', 'rezepte', 'in_liste', 'nur_ueber_verweis', 'mit_zutaten',
            'ohne_zutaten', 'zutatenzeilen', 'aus_liste_verschwunden', 'aeltester_zutatenabruf',
            'juengster_zutatenabruf', 'tage_seit_aeltestem_abruf', 'letzte_liste', 'letzter_fn_abruf',
            'zustand', 'nicht_gefunden', 'verweise_ohne_rezept', 'archiviert', 'rezepte_fn',
            'liste_noch_unbekannt', 'abzug_pct', 'volle_runde_am', 'volle_runde_abgeschlossen_am',
            'tagesgeschaeft_gedeckelt_am'])
    ) AS v(sicht, spalten)
    LOOP
        SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_ist
          FROM pg_attribute a
         WHERE a.attrelid = r.sicht::regclass AND a.attnum > 0 AND NOT a.attisdropped;
        IF v_ist IS DISTINCT FROM r.spalten THEN
            RAISE EXCEPTION '0134: % hat nicht die erwartete Fassung (Stand 0133). Ist: %',
                r.sicht, array_to_string(v_ist, ', ');
        END IF;
    END LOOP;
END $pruefung$;


-- ---------------------------------------------------------------------
-- 1. sync.rezept_umlauf_faellig — die Auswahl im Umlauf
--
-- Der feste Tag: fn_id mod umlauf gegen die Tageszahl (Kalendertag in
-- Europe/Berlin, gezaehlt ab 2000-01-01) mod umlauf. fn_id ist FoodNotifys
-- fortlaufende Rezept-ID, also gleichmaessig ueber die Reste verteilt.
--
-- Drei Faelle:
--   * sein Tag, letzter Abruf mindestens 1 Tag alt   -> faellig
--   * letzter Abruf aelter als umlauf Tage           -> faellig (ueberfaellig:
--     sein Tag ist ausgefallen oder das Rezept laeuft ausser Takt)
--   * nie geholt (NULL)                              -> NICHT hier: das ist
--     der erste Abzug, ein eigener Schritt in rezepteNachfuellen()
--
-- WARUM EIN TAG UND NICHT EIN HALBER ZYKLUS (docs/entscheidungen.md,
-- 19.10.2026): ein Rezept, das ausser Takt gelesen wurde (neu, ueberfaellig
-- nachgeholt, erster Abzug), muss an seinem naechsten Tag wieder einrasten.
-- Liegt dieser Tag naeher als die Mindestgrenze, wird es erst wieder ueber
-- „aelter als umlauf" gelesen — wieder ausser Takt, einen Tag frueher im
-- Zyklus. Mit einem halben Zyklus (7 Tage) blieben so bis zu sechs
-- Tagesgruppen ueber mehrere Zyklen zusammengeklumpt; mit einem Tag rastet
-- jedes Rezept spaetestens nach einem Zyklus ein. Gemessen am Test mit 140
-- gleich alten Rezepten (nachgemessen 19.10.2026 mit der zeitzonenfesten
-- Fassung, unter Sitzungszeitzone UTC und Europe/Berlin gleich): ein Tag ->
-- 0 an Tag 1, je 10 an Tag 2–15 und danach; sieben Tage -> 0 an Tag 1–7,
-- 10 an Tag 8–14, 70 an Tag 15, danach sechs Naechte 0.
--
-- ZEITZONE: alle Vergleiche auf Berliner Ortszeit (AT TIME ZONE
-- 'Europe/Berlin'), nicht auf timestamptz. p_jetzt - interval 'N days' ist
-- Kalenderarithmetik in der SITZUNGSzeitzone — die Produktion steht auf UTC
-- (0001), lokale Klone erben das per createdb -T nicht. Unter UTC sind N Tage
-- N x 24 h; ueber das Ende der Sommerzeit galt der Abzug vom 15.10. 06:00
-- MESZ am 29.10. um 05:02 MEZ schon als aelter als der Umlauf (20 statt 10
-- an Tag 14, 0 an Tag 15). Gefunden im Review vom 19.10.2026, vor dem
-- ersten Anwenden.
--
-- Garantie: kein Rezept wird aelter als umlauf + 1 Tage, solange hoechstens
-- eine Nacht ausfaellt — am Tag nach dem ausgefallenen ist es ueberfaellig
-- und wird eingereiht.
-- ---------------------------------------------------------------------

CREATE FUNCTION sync.rezept_umlauf_faellig(
    p_fn_id  bigint,
    p_geholt timestamptz,
    p_jetzt  timestamptz,
    p_umlauf integer
) RETURNS boolean
LANGUAGE sql STABLE
AS $$
    SELECT p_geholt IS NOT NULL
       AND ((p_geholt AT TIME ZONE 'Europe/Berlin')
              < (p_jetzt AT TIME ZONE 'Europe/Berlin') - make_interval(days => p_umlauf)
            OR (p_fn_id % p_umlauf
                  = (((p_jetzt AT TIME ZONE 'Europe/Berlin')::date - DATE '2000-01-01') % p_umlauf)
                AND (p_geholt AT TIME ZONE 'Europe/Berlin')
                      < (p_jetzt AT TIME ZONE 'Europe/Berlin') - interval '1 day'))
$$;

COMMENT ON FUNCTION sync.rezept_umlauf_faellig(bigint, timestamptz, timestamptz, integer) IS
'Ist die Zusammensetzung dieses Rezepts im Umlauf faellig? Jedes Rezept hat einen festen
Tag im Zyklus (fn_id mod umlauf = Tageszahl mod umlauf, Kalendertag Europe/Berlin ab
2000-01-01): faellig an seinem Tag, wenn der letzte Abruf mindestens einen Tag alt ist,
und immer, sobald er aelter als umlauf Tage ist. NULL (nie geholt) ist der erste Abzug,
nicht der Umlauf -> false. Aufgerufen von rezepteNachfuellen() mit REZEPT_UMLAUF_TAGE
(0134, docs/entscheidungen.md 19.10.2026).';


-- ---------------------------------------------------------------------
-- 2. mart.rezept_position — rezept_zuletzt_gesehen am Ende
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.rezept_position AS
 SELECT m.name AS marke,
    r.marke_key,
    r.rezept_key,
    r.fn_id AS rezept_fn_id,
    r.name AS rezept,
    z."position",
    z.art,
    z.artikelnummer,
    z.name AS ware,
    z.lieferant_name AS lieferant,
    z.lieferant_fn_id,
    z.menge,
    z.einheit,
    z.kosten,
    z.gruppe,
    z.sub_rezept_fn_id,
    u.name AS unterrezept,
        CASE
            WHEN z.art = 'sub_recipe'::text THEN 'unterrezept'::text
            WHEN NULLIF(btrim(z.artikelnummer), ''::text) IS NULL THEN 'ohne nummer'::text
            WHEN (EXISTS ( SELECT 1
               FROM core.bestellposition bp
                 JOIN core.bestellung b ON b.bestellung_key = bp.bestellung_key
                 JOIN core.kostenstelle ks ON ks.kostenstelle_key = b.kostenstelle_key
              WHERE bp.lieferanten_nr = z.artikelnummer AND ks.marke_key = r.marke_key)) THEN 'eingekauft'::text
            ELSE 'nummer ohne einkauf'::text
        END AS zuordnung,
    r.in_liste,
    r.zutaten_geholt_am,
    r.fehlt_seit,
    z.art = 'sub_recipe'::text AND u.rezept_key IS NULL AS unterrezept_unbekannt,
    r.archiviert,
    z.basis_menge,
    z.basis_einheit,
    u.archiviert AS unterrezept_archiviert,
    r.erstellt_am AS rezept_erstellt_am,
    r.zuletzt_am AS rezept_zuletzt_gesehen
   FROM core.zutat z
     JOIN core.rezept r ON r.rezept_key = z.rezept_key
     JOIN core.marke m ON m.marke_key = r.marke_key
     LEFT JOIN core.rezept u ON u.marke_key = r.marke_key AND u.fn_id = z.sub_rezept_fn_id;

COMMENT ON COLUMN mart.rezept_position.zutaten_geholt_am IS
'Wann die Zusammensetzung DIESES Rezepts zuletzt bei FoodNotify gelesen wurde -- der
Datenstand der Zeile. Bekannte Rezepte werden im Umlauf neu gelesen (alle 14 Tage, je
Rezept an einem festen Tag), neue sofort. Wer einen Datenstand nennt, nennt diesen Wert
der betroffenen Rezepte, nicht den aeltesten Abruf der Marke (mart.rezept_stand).';
COMMENT ON COLUMN mart.rezept_position.rezept_zuletzt_gesehen IS
'Wann das Rezept zuletzt in der Rezeptliste oder ueber seinen Kopf gesehen wurde. Die
Liste wird taeglich geprueft -- das belegt, dass es das Rezept noch gibt, NICHT, dass
die Zusammensetzung von diesem Tag ist (dafuer zutaten_geholt_am).';


-- ---------------------------------------------------------------------
-- 3. mart.artikel_in_rezept — vier Zeitstempel am Ende
--
-- weg_zutaten_geholt_am traegt die Rekursion mit: das Minimum von
-- zutaten_geholt_am ueber alle Rezepte des Wegs (Rezept der Zeile, alle
-- Halbfabrikate dazwischen, das Rezept, in dem die Ware direkt steht). Die
-- Aussage „Ware X steckt ueber V in R" ist hoechstens so frisch wie das
-- aelteste Glied — bei ebene 3 stehen weder zutaten_geholt_am noch
-- via_zutaten_geholt_am fuer das Rezept, in dem die Ware direkt steht.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.artikel_in_rezept AS
 WITH RECURSIVE kante AS (
         SELECT z.rezept_key AS eltern_key,
            k.rezept_key AS kind_key,
            z."position" AS via_position,
            z.menge AS via_menge,
            z.einheit AS via_einheit
           FROM core.zutat z
             JOIN core.rezept p ON p.rezept_key = z.rezept_key
             JOIN core.rezept k ON k.marke_key = p.marke_key AND k.fn_id = z.sub_rezept_fn_id
          WHERE z.art = 'sub_recipe'::text
        ), weg AS (
         SELECT rp.marke,
            rp.marke_key,
            rp.artikelnummer,
            rp.ware,
            rp.lieferant,
            rp.lieferant_fn_id,
            rp.zuordnung,
            rp.art,
            rp.rezept_key AS direkt_key,
            rp.rezept AS direkt_rezept,
            rp.rezept_fn_id AS direkt_fn_id,
            rp."position",
            rp.menge,
            rp.einheit,
            rp.kosten,
            rp.basis_menge,
            rp.basis_einheit,
            rp.rezept_key,
            1 AS ebene,
            NULL::integer AS via_key,
            NULL::integer AS via_position,
            NULL::numeric AS via_menge,
            NULL::text AS via_einheit,
            ARRAY[rp.rezept_key] AS kette,
            rp.rezept AS pfad,
            rp.zutaten_geholt_am AS weg_geholt
           FROM mart.rezept_position rp
          WHERE rp.art <> 'sub_recipe'::text
        UNION ALL
         SELECT w_1.marke,
            w_1.marke_key,
            w_1.artikelnummer,
            w_1.ware,
            w_1.lieferant,
            w_1.lieferant_fn_id,
            w_1.zuordnung,
            w_1.art,
            w_1.direkt_key,
            w_1.direkt_rezept,
            w_1.direkt_fn_id,
            w_1."position",
            w_1.menge,
            w_1.einheit,
            w_1.kosten,
            w_1.basis_menge,
            w_1.basis_einheit,
            k.eltern_key,
            w_1.ebene + 1,
            k.kind_key,
            k.via_position,
            k.via_menge,
            k.via_einheit,
            k.eltern_key || w_1.kette,
            (e.name || ' → '::text) || w_1.pfad,
            LEAST(w_1.weg_geholt, e.zutaten_geholt_am)
           FROM weg w_1
             JOIN kante k ON k.kind_key = w_1.rezept_key
             JOIN core.rezept e ON e.rezept_key = k.eltern_key
          WHERE (k.eltern_key <> ALL (w_1.kette)) AND w_1.ebene < 12
        )
 SELECT w.marke,
    w.marke_key,
    w.artikelnummer,
    w.ware,
    w.lieferant,
    w.lieferant_fn_id,
    w.zuordnung,
    r.name AS rezept,
    r.fn_id AS rezept_fn_id,
    w.rezept_key,
    w.ebene,
    v.name AS via_rezept,
    v.fn_id AS via_rezept_fn_id,
    w.via_position,
    w.via_menge,
    w.via_einheit,
    w.direkt_rezept,
    w.direkt_key,
    w."position",
    w.menge,
    w.einheit,
    w.kosten,
    w.pfad,
    w.art,
    r.fehlt_seit AS rezept_fehlt_seit,
    r.archiviert AS rezept_archiviert,
    w.basis_menge,
    w.basis_einheit,
    v.archiviert AS via_archiviert,
    r.erstellt_am AS rezept_erstellt_am,
    w.direkt_fn_id AS direkt_rezept_fn_id,
    r.zutaten_geholt_am,
    r.zuletzt_am AS rezept_zuletzt_gesehen,
    v.zutaten_geholt_am AS via_zutaten_geholt_am,
    w.weg_geholt AS weg_zutaten_geholt_am
   FROM weg w
     JOIN core.rezept r ON r.rezept_key = w.rezept_key
     LEFT JOIN core.rezept v ON v.rezept_key = w.via_key;

COMMENT ON COLUMN mart.artikel_in_rezept.zutaten_geholt_am IS
'Wann die Zusammensetzung des Rezepts DIESER Zeile (rezept) zuletzt gelesen wurde. Bei
ebene 1 der Datenstand der Zeile; bei ebene > 1 gilt weg_zutaten_geholt_am. Nicht den
aeltesten Abruf der Marke (mart.rezept_stand) als Datenstand nennen.';
COMMENT ON COLUMN mart.artikel_in_rezept.rezept_zuletzt_gesehen IS
'Wann das Rezept der Zeile zuletzt in der Rezeptliste (taeglich geprueft) oder ueber
seinen Kopf gesehen wurde -- belegt, dass es das Rezept noch gibt, nicht die
Zusammensetzung (dafuer zutaten_geholt_am).';
COMMENT ON COLUMN mart.artikel_in_rezept.via_zutaten_geholt_am IS
'Wann die Zusammensetzung des Halbfabrikats via_rezept zuletzt gelesen wurde. NULL bei ebene 1.';
COMMENT ON COLUMN mart.artikel_in_rezept.weg_zutaten_geholt_am IS
'Der Datenstand der Zeile: der aelteste Zutatenabruf aller Rezepte des Wegs (Rezept der
Zeile, Halbfabrikate dazwischen, das Rezept, in dem die Ware direkt steht). Bei ebene 1
gleich zutaten_geholt_am. Wer fuer eine Antwort einen Datenstand nennt, nimmt das
Minimum DIESER Spalte ueber die gezeigten Zeilen.';


-- ---------------------------------------------------------------------
-- 4. mart.rezept_stand — ueberfaellig, umlauf_tage, umlauf_tage_quelle am
--    Ende, Zustand 'umlauf ueberfaellig'
--
-- Regel 10: ein Umlauf, der nicht mehr nachkommt (Notschalter
-- REZEPTE_NACHLADEN = 0, Phase C ohne Budget, ein Fehler in der Auswahl),
-- sieht genauso aus wie einer, der fertig ist — bis jemand die Zeitstempel
-- liest. ueberfaellig zaehlt Rezepte, deren Zusammensetzung aelter als
-- Umlauf + 2 Tage ist: ein Tag fuer die Garantie (Umlauf + 1), einer fuer
-- einen Lauf, der seine Posten nicht in derselben Nacht schafft.
--
-- DER UMLAUF KOMMT AUS DER UMGEBUNG, nicht aus dieser Datei: REZEPT_UMLAUF_TAGE
-- ist per Umgebung aenderbar, die Sicht kennt die Umgebung nicht.
-- rezepteNachfuellen() schreibt den wirksamen Wert bei jedem Lauf nach
-- sync.merker (Schluessel rezept_umlauf_tage, wert {"tage": N}); die Sicht
-- misst gegen N + 2 und zeigt N in umlauf_tage. Hat der Importer nie
-- gemeldet, gilt 14 — umlauf_tage_quelle sagt dann „rueckfall 14". Bis zur
-- Review-Korrektur vom 19.10.2026 standen hier fest 16 Tage, und ein Test
-- verglich sie mit dem STANDARDWERT aus src/config.ts — ein per Umgebung
-- geaenderter Umlauf waere daran vorbeigegangen.
--
-- Gezaehlt in Berliner Kalendertagen (AT TIME ZONE), wie
-- sync.rezept_umlauf_faellig: die Produktion rechnet in UTC (0001), und
-- now() - interval 'N days' ist Kalenderarithmetik in der Sitzungszeitzone.
--
-- Rezepte mit fehlt_seit (HTTP 404) zaehlen NICHT: ihr Stempel steht
-- dauerhaft, sie stehen in nicht_gefunden. Eine Pruefzeile, die nie auf
-- null geht, liest niemand (0071).
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.rezept_stand AS
 WITH umlauf AS (
         SELECT COALESCE(( SELECT (mk.wert ->> 'tage'::text)::integer
                   FROM sync.merker mk
                  WHERE mk.schluessel = 'rezept_umlauf_tage'::text), 14) AS tage,
            (EXISTS ( SELECT 1
                   FROM sync.merker mk
                  WHERE mk.schluessel = 'rezept_umlauf_tage'::text)) AS gemeldet
        ), r AS (
         SELECT rezept.marke_key,
            count(*)::integer AS rezepte,
            count(*) FILTER (WHERE rezept.in_liste)::integer AS in_liste,
            count(*) FILTER (WHERE NOT rezept.in_liste)::integer AS nur_ueber_verweis,
            count(*) FILTER (WHERE rezept.zutaten_geholt_am IS NOT NULL)::integer AS mit_zutaten,
            count(*) FILTER (WHERE rezept.zutaten_geholt_am IS NULL)::integer AS ohne_zutaten,
            min(rezept.zutaten_geholt_am) AS aeltester_zutatenabruf,
            max(rezept.zutaten_geholt_am) AS juengster_zutatenabruf,
            max(rezept.zuletzt_am) AS zuletzt_gesehen,
            count(*) FILTER (WHERE rezept.fehlt_seit IS NOT NULL)::integer AS nicht_gefunden,
            count(*) FILTER (WHERE rezept.archiviert)::integer AS archiviert,
            count(*) FILTER (WHERE (rezept.zutaten_geholt_am AT TIME ZONE 'Europe/Berlin'::text)
                                     < ((now() AT TIME ZONE 'Europe/Berlin'::text) - make_interval(days => u.tage + 2))
                               AND rezept.fehlt_seit IS NULL)::integer AS ueberfaellig
           FROM core.rezept
             CROSS JOIN umlauf u
          GROUP BY rezept.marke_key, u.tage
        ), weg AS (
         SELECT x.marke_key,
            count(*)::integer AS aus_liste_verschwunden
           FROM core.rezept x
             JOIN core.rezept_liste_stand ls ON ls.marke_key = x.marke_key
          WHERE x.in_liste AND x.zuletzt_am < ls.volle_runde_fertig_beginn
          GROUP BY x.marke_key
        ), z AS (
         SELECT r2.marke_key,
            count(*)::integer AS zutatenzeilen
           FROM core.zutat zz
             JOIN core.rezept r2 ON r2.rezept_key = zz.rezept_key
          GROUP BY r2.marke_key
        ), verweis AS (
         SELECT p.marke_key,
            count(DISTINCT zz.sub_rezept_fn_id)::integer AS verweise_ohne_rezept
           FROM core.zutat zz
             JOIN core.rezept p ON p.rezept_key = zz.rezept_key
          WHERE zz.sub_rezept_fn_id IS NOT NULL AND NOT (EXISTS ( SELECT 1
                   FROM core.rezept u
                  WHERE u.marke_key = p.marke_key AND u.fn_id = zz.sub_rezept_fn_id))
          GROUP BY p.marke_key
        ), liste AS (
         SELECT ls.marke_key,
            ls.seite1_am AS letzte_liste,
            ls.rezepte_gesamt,
            ls.seiten,
            ls.volle_runde_am,
            ls.volle_runde_fertig_ende,
            ls.tagesgeschaeft_gedeckelt_am,
            ls.volle_runde_fertig_beginn
           FROM core.rezept_liste_stand ls
        ), fn AS (
         SELECT a.marke_key,
            max(a.beendet_am) FILTER (WHERE a.status = 'ok'::text) AS letzter_fn_abruf,
            count(*) > 0 AS je_gefragt
           FROM sync.aufgabe a
          WHERE a.endpunkt = ANY (ARRAY['fn:profil'::text, 'fn:kostenstellen'::text, 'fn:rezepte'::text])
          GROUP BY a.marke_key
        )
 SELECT m.marke_key,
    m.name AS marke,
    COALESCE(r.rezepte, 0) AS rezepte,
    COALESCE(r.in_liste, 0) AS in_liste,
    COALESCE(r.nur_ueber_verweis, 0) AS nur_ueber_verweis,
    COALESCE(r.mit_zutaten, 0) AS mit_zutaten,
    COALESCE(r.ohne_zutaten, 0) AS ohne_zutaten,
    COALESCE(z.zutatenzeilen, 0) AS zutatenzeilen,
    COALESCE(weg.aus_liste_verschwunden, 0) AS aus_liste_verschwunden,
    r.aeltester_zutatenabruf,
    r.juengster_zutatenabruf,
    CURRENT_DATE - r.aeltester_zutatenabruf::date AS tage_seit_aeltestem_abruf,
    liste.letzte_liste,
    fn.letzter_fn_abruf,
        CASE
            WHEN fn.je_gefragt IS NOT TRUE THEN 'kein FoodNotify-Zulauf'::text
            WHEN fn.letzter_fn_abruf IS NULL OR fn.letzter_fn_abruf < (now() - '36:00:00'::interval) THEN 'zugang ausgefallen'::text
            WHEN liste.letzte_liste IS NULL THEN 'liste nie geholt'::text
            WHEN liste.letzte_liste < (now() - '36:00:00'::interval) THEN 'liste veraltet'::text
            WHEN COALESCE(r.rezepte, 0) = 0 THEN 'keine rezepte'::text
            WHEN r.mit_zutaten > 0 AND COALESCE(z.zutatenzeilen, 0) = 0 THEN 'zutaten leer'::text
            WHEN liste.volle_runde_am < (now() - '3 days'::interval) AND (liste.volle_runde_fertig_beginn IS NULL OR liste.volle_runde_fertig_beginn <> liste.volle_runde_am) THEN 'volle runde nicht abgeschlossen'::text
            WHEN r.ueberfaellig > 0 THEN 'umlauf ueberfaellig'::text
            WHEN liste.tagesgeschaeft_gedeckelt_am > (now() - '36:00:00'::interval) THEN 'tagesgeschaeft gedeckelt'::text
            WHEN r.ohne_zutaten > 0 THEN 'zutaten ausstehend'::text
            ELSE 'ok'::text
        END AS zustand,
    COALESCE(r.nicht_gefunden, 0) AS nicht_gefunden,
    COALESCE(verweis.verweise_ohne_rezept, 0) AS verweise_ohne_rezept,
    COALESCE(r.archiviert, 0) AS archiviert,
    liste.rezepte_gesamt AS rezepte_fn,
    GREATEST(COALESCE(liste.rezepte_gesamt, 0) - COALESCE(r.in_liste, 0), 0) AS liste_noch_unbekannt,
        CASE
            WHEN GREATEST(COALESCE(liste.rezepte_gesamt, 0), COALESCE(r.rezepte, 0)) > 0 THEN round(100.0 * COALESCE(r.mit_zutaten, 0)::numeric / GREATEST(COALESCE(liste.rezepte_gesamt, 0), COALESCE(r.rezepte, 0))::numeric, 2)
            ELSE NULL::numeric
        END AS abzug_pct,
    liste.volle_runde_am,
    liste.volle_runde_fertig_ende AS volle_runde_abgeschlossen_am,
    liste.tagesgeschaeft_gedeckelt_am,
    COALESCE(r.ueberfaellig, 0) AS ueberfaellig,
    umlauf.tage AS umlauf_tage,
        CASE
            WHEN umlauf.gemeldet THEN 'REZEPT_UMLAUF_TAGE'::text
            ELSE 'rueckfall 14 (vom importer nie gemeldet)'::text
        END AS umlauf_tage_quelle
   FROM core.marke m
     CROSS JOIN umlauf
     LEFT JOIN r ON r.marke_key = m.marke_key
     LEFT JOIN z ON z.marke_key = m.marke_key
     LEFT JOIN weg ON weg.marke_key = m.marke_key
     LEFT JOIN liste ON liste.marke_key = m.marke_key
     LEFT JOIN fn ON fn.marke_key = m.marke_key
     LEFT JOIN verweis ON verweis.marke_key = m.marke_key;

COMMENT ON COLUMN mart.rezept_stand.aeltester_zutatenabruf IS
'Der aelteste Zutatenabruf UEBER ALLE Rezepte der Marke -- eine Aussage ueber den Umlauf,
KEIN Datenstand fuer ein einzelnes Rezept oder eine Antwort. Der Datenstand eines Rezepts
ist sein zutaten_geholt_am (mart.rezept_position, mart.artikel_in_rezept; dort auch
weg_zutaten_geholt_am fuer Halbfabrikate).';
COMMENT ON COLUMN mart.rezept_stand.ueberfaellig IS
'Rezepte, deren Zusammensetzung laenger als umlauf_tage + 2 Tage nicht gelesen wurde (bei
REZEPT_UMLAUF_TAGE = 14 also 16 Tage, gezaehlt in Berliner Kalendertagen) -- ohne die, die
FoodNotify nicht mehr findet (nicht_gefunden). Erwartung: 0. Mehr als 0 setzt den Zustand
auf "umlauf ueberfaellig" und faellt in mart.pruefung_uebersicht auf.';
COMMENT ON COLUMN mart.rezept_stand.umlauf_tage IS
'Der Umlauf in Tagen, gegen den ueberfaellig misst: REZEPT_UMLAUF_TAGE, wie der Importer ihn
beim letzten Nachfuellen gemeldet hat (sync.merker rezept_umlauf_tage). Hat er nie gemeldet,
steht hier der Standardwert 14 -- dann sagt es umlauf_tage_quelle.';
COMMENT ON COLUMN mart.rezept_stand.umlauf_tage_quelle IS
'Woher umlauf_tage stammt: REZEPT_UMLAUF_TAGE (vom Importer gemeldet) oder der Rueckfall 14,
solange rezepteNachfuellen() noch nie gelaufen ist.';
COMMENT ON COLUMN mart.datenstand.rezepte_zutaten_seit IS
'Aeltester Zutatenabruf der Marke: die Rezeptinhalte sind mindestens so frisch.
NULL = mindestens ein Rezept der Marke hat noch keine Zutaten (oder keine Rezepte).
KEIN Datenstand fuer ein einzelnes Rezept -- der steht je Rezept in zutaten_geholt_am
(mart.rezept_position, mart.artikel_in_rezept).';


-- ---------------------------------------------------------------------
-- 5. mart.pruefung_uebersicht — 'umlauf ueberfaellig' in der Rezept-Zeile
--
-- Die Definition wird beim Anwenden aus der Zieldatenbank gelesen und an
-- GENAU einer Stelle ergaenzt; fehlt die Stelle oder steht sie mehrfach da,
-- bricht die Migration ab (dieselbe Begruendung wie in 0132: eine fremde
-- Aenderung der anderen Session nicht still ueberschreiben).
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text := pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true);
    v_alt text := $alt$'volle runde nicht abgeschlossen'::text])) AS auffaellig,
    'mart.rezept_stand'::text AS sicht$alt$;
    v_neu text := $neu$'volle runde nicht abgeschlossen'::text, 'umlauf ueberfaellig'::text])) AS auffaellig,
    'mart.rezept_stand'::text AS sicht$neu$;
    v_treffer int;
BEGIN
    v_treffer := (length(v_def) - length(replace(v_def, v_alt, ''))) / length(v_alt);
    IF v_treffer <> 1 THEN
        RAISE EXCEPTION '0134: die Rezept-Zeile in mart.pruefung_uebersicht hat nicht die erwartete Form '
                        '(% Treffer statt 1) — Zustand umlauf ueberfaellig nicht eingefuegt', v_treffer;
    END IF;
    v_def := rtrim(replace(v_def, v_alt, v_neu), E'; \n');
    EXECUTE 'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS ' || v_def;
END $aussen$;


-- ---------------------------------------------------------------------
-- 6. MCP-Katalog: Koernung, Kommentare, Fallstrick
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung
  FROM (VALUES
    ('mart.rezept_position',
     'Marke × Rezept (rezept_fn_id) × Zutatenposition — eine Zeile je Position, wie FoodNotify sie fuehrt. Rezeptnamen sind nicht eindeutig: nach rezept_fn_id gruppieren oder zaehlen. Zusammensetzung Stand zutaten_geholt_am; die Rezeptliste wird taeglich geprueft (rezept_zuletzt_gesehen); wer einen Datenstand nennt, nennt zutaten_geholt_am der betroffenen Rezepte, nicht den aeltesten Abruf der Marke'),
    ('mart.artikel_in_rezept',
     'Marke × Ware (Lieferanten-Artikelnummer) × Rezept (rezept_fn_id) × Weg ueber Halbfabrikate — dieselbe Ware steht je Ebene erneut; Rezeptnamen sind nicht eindeutig, nach rezept_fn_id gruppieren oder zaehlen. Zusammensetzung Stand zutaten_geholt_am (ueber Halbfabrikate: weg_zutaten_geholt_am); die Rezeptliste wird taeglich geprueft (rezept_zuletzt_gesehen); wer einen Datenstand nennt, nennt zutaten_geholt_am der betroffenen Rezepte, nicht den aeltesten Abruf der Marke'),
    ('mart.rezept_stand',
     'eine Marke — Ladestand der Rezepte; aeltester_zutatenabruf ist kein Datenstand einzelner Rezepte')
  ) AS v(sicht, koernung)
 WHERE s.sicht = v.sicht;

-- Die Koernungszeile steht schon in den Kommentaren (0132), und
-- mcp.koernung_in_kommentare() ueberschreibt eine vorhandene nicht. Deshalb
-- hier: alles vor "Koernung:" bleibt, wie es in der Zieldatenbank steht,
-- ein Absatz zum Datenstand kommt dazu, die Koernung wird neu gesetzt.
DO $kommentar$
DECLARE
    r record;
    v_alt text;
    v_k text;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('mart.rezept_position',
         'DATENSTAND: zutaten_geholt_am ist der Stand der Zusammensetzung DIESES Rezepts. Die '
         'Rezeptliste wird taeglich geprueft (rezept_zuletzt_gesehen), die Zusammensetzung '
         'bekannter Rezepte alle 14 Tage neu gelesen, je Rezept an einem festen Tag. Wer einen '
         'Datenstand nennt, nennt zutaten_geholt_am der betroffenen Rezepte -- nicht den '
         'aeltesten Abruf der Marke (mart.rezept_stand.aeltester_zutatenabruf).'),
        ('mart.artikel_in_rezept',
         'DATENSTAND: zutaten_geholt_am ist der Stand des Rezepts der Zeile, '
         'via_zutaten_geholt_am der des Halbfabrikats, weg_zutaten_geholt_am der aelteste ueber '
         'den ganzen Weg -- das ist der Datenstand der Zeile. Die Rezeptliste wird taeglich '
         'geprueft (rezept_zuletzt_gesehen), die Zusammensetzung alle 14 Tage neu gelesen. Wer '
         'einen Datenstand nennt, nennt den der betroffenen Rezepte (Minimum von '
         'weg_zutaten_geholt_am ueber die gezeigten Zeilen) -- nicht den aeltesten Abruf der '
         'Marke (mart.rezept_stand.aeltester_zutatenabruf).'),
        ('mart.rezept_stand',
         'aeltester_zutatenabruf ist das Minimum ueber ALLE Rezepte der Marke und KEIN Datenstand '
         'fuer ein einzelnes Rezept. ueberfaellig: Rezepte, deren Zusammensetzung laenger als '
         'Umlauf + 2 Tage nicht gelesen wurde (Zustand umlauf ueberfaellig, Befund); der Umlauf '
         'steht in umlauf_tage, so wie der Importer ihn meldet.')
    ) AS v(sicht, absatz)
    LOOP
        v_alt := coalesce(obj_description(r.sicht::regclass, 'pg_class'), '');
        SELECT s.koernung INTO v_k FROM mcp.sicht s WHERE s.sicht = r.sicht;
        EXECUTE format('COMMENT ON VIEW %s IS %L', r.sicht,
            split_part(v_alt, E'\n\nKoernung:', 1) || E'\n\n' || r.absatz
            || CASE WHEN v_k IS NOT NULL THEN E'\n\nKoernung: ' || v_k ELSE '' END);
    END LOOP;
END $kommentar$;

-- 'deutung' kennt mcp/src/pruefen.ts (mcp-Regel 1): warnt, sobald die Sicht
-- in einer Abfrage vorkommt. parameter.spalten dokumentiert, worum es geht.
INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle) VALUES
  ('rezept_stand_kein_rezeptstand', 'deutung', 'warnung', 'mart.rezept_stand',
   '{"spalten": ["aeltester_zutatenabruf", "tage_seit_aeltestem_abruf"]}',
   'aeltester_zutatenabruf ist das Minimum ueber ALLE Rezepte der Marke -- kein Datenstand fuer '
   'einzelne Rezepte. Die Zusammensetzung wird je Rezept an einem festen Tag im 14-Tage-Umlauf neu '
   'gelesen, die Rezeptliste taeglich; ein einzelnes Rezept ist meist viel frischer.',
   'Fuer den Datenstand einer Rezeptantwort zutaten_geholt_am der betroffenen Rezepte nennen '
   '(mart.rezept_position, mart.artikel_in_rezept; ueber Halbfabrikate weg_zutaten_geholt_am).',
   '0134')
ON CONFLICT (schluessel) DO UPDATE
   SET art = excluded.art, schwere = excluded.schwere, sicht = excluded.sicht,
       parameter = excluded.parameter, hinweis = excluded.hinweis,
       berichtigung = excluded.berichtigung, quelle = excluded.quelle;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();


-- ---------------------------------------------------------------------
-- 7. Rechte und die Gegenprobe als Leserolle (Pflicht seit 0110)
-- ---------------------------------------------------------------------

SELECT mcp.rechte_auffrischen();

DO $probe$
DECLARE
    v_sicht  text;
    v_liegen text[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0134 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0134 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_sicht IN ARRAY ARRAY[
        'mart.rezept_position', 'mart.artikel_in_rezept', 'mart.rezept_stand',
        'mart.rezept_zuordnung_pruefung', 'mart.datenstand', 'mart.pruefung_uebersicht']
    LOOP
        BEGIN
            EXECUTE format('SELECT * FROM %s LIMIT 1', v_sicht);
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_sicht, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0134 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
