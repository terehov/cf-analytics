-- =====================================================================
-- 0150 — Die TPAPI liefert Kopfzahlen, und ein Schluessel ohne Schichten
--        ist kein "ok"
--
-- Nachgemessen am 09.11.2026 nach dem ersten echten Lauf (195, 2.560
-- Betrieb-Tage vom 06.09. bis 08.11.2026, 40 Betriebe):
--
-- 1. `personen` ist in allen 36.586 Stunden GANZZAHLIG. LINAs `eff` je
--    Stunde ist die Kopfzahl der eingeplanten Personen in dieser Stunde,
--    keine Personenstunde: wer von 11:45 bis 15:15 arbeitet, zaehlt in fuenf
--    Stunden als 1 und hat 3,5 Stunden gearbeitet. Die Summe ueber den Tag
--    (hier "personenstunden") ist damit eine OBERGRENZE. Gegen LINAs eigene
--    Effektivitaet (Umsatz / eff_gesamt) liegt sie im Median 26 % hoeher
--    (p25 15 %, p75 44 %, 1.873 Tage), je Betrieb zwischen +7 % (Wilsdruffer
--    Strasse) und +57 % (Ballplatz Mainz), und die Lohnkosten des Oktobers
--    bei 23 von 31 Betrieben ebenso (Median +27 %) — LINA verteilt `kost`
--    offenbar genauso ueber die Stunden. Fuer die Besetzungsfrage ("wie
--    viele stehen sonntags um 19 Uhr da") ist die Kopfzahl genau die richtige
--    Zahl; als Personenstunden oder Lohnkosten gegen BWA oder
--    Personalkostenbericht ist sie keine.
--
--    Die Nachtprobe ist damit trotzdem beantwortet: die Stunden 0-7 dem
--    Folgetag zugeschlagen passen SCHLECHTER zum Scraper (Korrelation 0,918
--    gegen 0,925, Streuung des Quotienten 0,323 gegen 0,313 ueber 1.084
--    Tage mit Nachtstunden). Die Nacht steht am richtigen Tag, keine
--    KORREKTUR noetig.
--
--    Die Pruefzeile "Tageskosten weichen von LINAs Quote ab" stand nach dem
--    ersten Lauf auf 852 von 949 und wird nie auf null gehen — sie misst
--    eine Erwartung, die die Quelle nicht erfuellen kann (0071: eine Kachel,
--    die nie auf null geht, liest niemand mehr). Sie wird ersetzt, nicht
--    gesenkt. Die Pruefsicht bleibt als Messung stehen, mit ehrlichem
--    Kommentar.
--
-- 2. Vier Betriebe mit Schluessel lieferten an keinem der 64 Tage eine
--    Schicht — Enchilada Rosenheim an 54 Tagen MIT Umsatz, Wilma Wunder
--    Bochum seit dem 25.09.2026 (49 Tage mit Umsatz), Aposto Wuppertal GmbH
--    und Park Cafe Muenchen ohne Umsatz. mart.tpapi_zugang meldete alle vier
--    als `ok`, weil HTTP 200 kam. Das ist Regel 10 wortwoertlich: eine
--    Quelle ohne Zulauf, die als ok gemeldet wird. Neuer befund
--    `Schluessel ohne Schichten` — in den letzten 14 Tagen mindestens sieben
--    Tage mit Umsatz und kein einziger mit einer Schicht — und eine
--    Pruefzeile dazu, die auf null gehen KANN (wenn der Betrieb seine
--    Schichten in LINA plant oder der Schluessel weg ist).
--
-- Betroffen: mart.tpapi_zugang (drei Spalten angehaengt, befund erweitert),
-- mart.pruefung_uebersicht (eine Zeile ersetzt), Kommentare, drei
-- Fallstricke. Keine Tabelle, kein Importer.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Kommentare: die Zahl heisst, was sie ist
-- ---------------------------------------------------------------------

COMMENT ON COLUMN core.personalkosten_stunde.personen IS
'Kopfzahl der in dieser Stunde eingeplanten Personen (TPAPI eff). GANZZAHLIG — wer einen Teil der
Stunde arbeitet, zaehlt voll (nachgemessen 09.11.2026: 36.586 von 36.586 Stunden ohne Bruchteil).
Die Summe ueber den Tag ist deshalb eine Obergrenze der Personenstunden, im Median 26 % ueber
LINAs eigener Effektivitaetsrechnung (0150).';

COMMENT ON COLUMN mart.personal_stunde.personen IS
'Kopfzahl der eingeplanten Personen in dieser Stunde — die Antwort auf "wie viele stehen da".
Ganzzahlig; ein Teil der Stunde zaehlt voll. Keine Personenstunde (0150).';

COMMENT ON COLUMN mart.personal_zeitfenster.personenstunden IS
'Summe der stuendlichen Kopfzahlen im Fenster. OBERGRENZE der Personenstunden: eine Person, die in
der Stunde nur 15 Minuten da ist, zaehlt 1. Zwischen Betrieben, Fenstern und Tagen vergleichbar,
als absolute Arbeitszeit nicht (0150).';

COMMENT ON COLUMN mart.personal_tag.personenstunden IS
'Summe der stuendlichen Kopfzahlen ueber den Geschaeftstag. OBERGRENZE der Personenstunden — im
Median 26 % ueber Umsatz / eff_gesamt aus LINAs Personalkostenbericht (09.11.2026). Zwischen
Betrieben und Tagen vergleichbar, als Arbeitszeit oder gegen die BWA nicht (0150).';

COMMENT ON VIEW mart.personal_stunde_pruefung IS
'Messsicht (0149, Befund 0150): je Betrieb und abgerufenem Geschaeftstag die TPAPI-Personaldaten
gegen LINAs Personalkostenbericht (Scraper, core.personalkosten). befund vergleicht die
TPAPI-Lohnkosten vom Monatsersten bis zu diesem Tag mit pek_gesamt × Tagesumsatz (pek ist seit
Monatsanfang aufgelaufen); befund_stunden die Kopfzahlsumme des Tages mit Tagesumsatz / eff_gesamt.
ERWARTUNG SEIT 09.11.2026: "weicht ab" ist der Normalfall, nicht der Fehler — die TPAPI liefert
Kopfzahlen je Stunde (Obergrenze), die Summe liegt im Median 26 % ueber LINAs Effektivitaet, die
Lohnkosten des Monats ebenso (+27 %, 23 von 31 Betrieben im Oktober 2026). Die Nachtprobe ist
bestanden: die Stunden 0-7 dem Folgetag zugeschlagen passen schlechter (Korrelation 0,918 gegen
0,925). Brauchbar ist die Sicht fuer den Faktor je Betrieb (Median von abweichung_stunden_pct) und
seine Stabilitaet, nicht fuer ok/weicht ab. Werte: ok (hoechstens 5 %) | weicht ab | ohne vergleich
| leer | monat unvollstaendig (nur befund). Immer nach geschaeftstag filtern.';

COMMENT ON COLUMN mart.personal_stunde_pruefung.befund_stunden IS
'ok | weicht ab | ohne vergleich | leer. Seit 0150 keine Fehlermeldung: "weicht ab" ist bei
Kopfzahlen der Normalfall (Median +26 %). Den Faktor je Betrieb ueber abweichung_stunden_pct lesen.';


-- ---------------------------------------------------------------------
-- 2. mart.tpapi_zugang: Schichten zaehlen, nicht nur HTTP-Antworten
--
-- CREATE OR REPLACE: gleiche Spalten in gleicher Reihenfolge, drei neue am
-- Ende (sonst laesst Postgres es nicht zu). Die 14 Tage sind das
-- Tagesfenster des Importers (TPAPI_FENSTER_TAGE): in dem Zeitraum wird
-- jeder Tag jede Nacht neu geholt, eine Schicht, die nachtraeglich
-- eingetragen wird, kaeme also noch an. Sieben Umsatztage, damit ein
-- Betrieb mit Ruhetagen oder einer Schliesswoche nicht faelschlich
-- auffaellt.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.tpapi_zugang AS
SELECT bs.betrieb_key,
       bs.betrieb,
       bs.konzept,
       bs.status,
       coalesce(z.schluessel_vorhanden, false)      AS schluessel,
       z.zustand,
       z.zuletzt_gefragt_am                         AS zuletzt_gefragt,
       z.zuletzt_erfolg_am                          AS zuletzt_erfolg,
       z.letzter_fehler,
       coalesce(ab.tage_geladen, 0)                 AS tage_geladen,
       ab.aeltester_tag,
       ab.juengster_tag,
       coalesce(rs.rueckstand_tage, 0)              AS rueckstand_tage,
       CASE WHEN coalesce(z.schluessel_vorhanden, false) THEN
                CASE WHEN z.zustand = 'nicht_lizenziert' THEN 'nicht lizenziert'
                     WHEN z.zustand = 'abgewiesen'       THEN 'abgewiesen'
                     WHEN z.zustand = 'gebremst'         THEN 'gebremst'
                     WHEN z.zuletzt_erfolg_am IS NULL
                       OR z.zuletzt_erfolg_am < now() - interval '48 hours'
                                                         THEN 'Schluessel ohne Zulauf'
                     WHEN coalesce(f.tage_mit_umsatz, 0) >= 7
                      AND coalesce(f.tage_mit_schichten, 0) = 0
                                                         THEN 'Schluessel ohne Schichten'
                     ELSE 'ok' END
            WHEN bs.status = 'operativ'                  THEN 'operativ ohne Schluessel'
            ELSE 'nicht operativ' END               AS befund,
       z.letzter_http,
       coalesce(f.tage_mit_umsatz, 0)               AS tage_mit_umsatz_14,
       coalesce(f.tage_mit_schichten, 0)            AS tage_mit_schichten_14,
       ab.letzter_tag_mit_schichten
  FROM mart.betrieb_status bs
  LEFT JOIN sync.tpapi_zugang z
         ON z.betrieb_key = bs.betrieb_key
        AND z.modul = 'personal'
  LEFT JOIN LATERAL (
        SELECT count(*)::int                                     AS tage_geladen,
               min(a.geschaeftstag)                              AS aeltester_tag,
               max(a.geschaeftstag)                              AS juengster_tag,
               max(a.geschaeftstag) FILTER (WHERE a.stunden > 0) AS letzter_tag_mit_schichten
          FROM core.personalkosten_stunde_abruf a
         WHERE a.betrieb_key = bs.betrieb_key
       ) ab ON true
  LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE u.umsatz_netto > 0)::int AS tage_mit_umsatz,
               count(*) FILTER (WHERE a.stunden > 0)::int      AS tage_mit_schichten
          FROM core.personalkosten_stunde_abruf a
          LEFT JOIN core.umsatzbericht_tag u
                 ON u.betrieb_key = a.betrieb_key
                AND u.geschaeftstag = a.geschaeftstag
                AND u.hauptsparte_key IS NULL
                AND u.verkaufsstelle_key IS NULL
         WHERE a.betrieb_key = bs.betrieb_key
           AND a.geschaeftstag >= current_date - 14
       ) f ON true
  LEFT JOIN LATERAL (
        SELECT count(*)::int AS rueckstand_tage
          FROM mart.personal_rueckstand r
         WHERE r.betrieb_key = bs.betrieb_key
       ) rs ON true;

COMMENT ON VIEW mart.tpapi_zugang IS
'TPAPI-Zugang je Betrieb, alle Betriebe (0149, 0150): hat er einen Schluessel fuer das
Personalmodul, wie ging der letzte Aufruf aus, wie viele Tage sind geladen und wie viele fehlen
noch. befund: ok | Schluessel ohne Zulauf (seit 48 h keine erfolgreiche Antwort) | Schluessel ohne
Schichten (Antworten kommen, aber in 14 Tagen mit mindestens sieben Umsatztagen keine einzige
Schicht — der Betrieb plant sein Personal nicht in LINA, oder nicht mehr) | nicht lizenziert
(Modul fuer den Betrieb nicht gebucht — ein Zustand, kein Fehler) | abgewiesen (Schluessel
abgelehnt) | gebremst (Anfragelimit erreicht) | operativ ohne Schluessel (laufender Betrieb, fuer
den es keine Personaldaten gibt) | nicht operativ (kein Schluessel, kein laufendes Geschaeft). Wer
in den Personalsichten fehlt oder leer ist, steht hier mit Grund.';

COMMENT ON COLUMN mart.tpapi_zugang.tage_mit_umsatz_14 IS
'Abgerufene Tage der letzten 14 mit Nettoumsatz > 0 (Umsatzbericht, Gesamtzeile).';
COMMENT ON COLUMN mart.tpapi_zugang.tage_mit_schichten_14 IS
'Abgerufene Tage der letzten 14, an denen LINA mindestens eine Stunde mit Personal lieferte.';
COMMENT ON COLUMN mart.tpapi_zugang.letzter_tag_mit_schichten IS
'Juengster Geschaeftstag, an dem LINA Schichten lieferte; NULL = noch nie. Bei "Schluessel ohne
Schichten" sagt er, ob der Betrieb nie geplant hat oder damit aufgehoert hat.';


-- ---------------------------------------------------------------------
-- 3. Pruefuebersicht: die Zeile, die nie null wird, gegen eine, die es kann
--
-- Die Sicht ist seit 0149 ein UNION ALL, dessen letzter Zweig die
-- Kostenzeile ist. Der Zweig wird am Text seines Pruefnamens abgeschnitten
-- und durch die Schichtenzeile ersetzt. Zwei Wachen: die alte Zeile muss
-- da sein (sonst nichts tun — Wiederholbarkeit), und nach dem Umbau muss
-- die neue da und die alte weg sein.
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def  text;
    v_kopf text;
    v_pos  int;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def NOT LIKE '%Tageskosten weichen von LINAs Quote ab%' THEN RETURN; END IF;

    v_pos  := position('''Personal je Stunde: Tageskosten weichen von LINAs Quote ab' IN v_def);
    v_kopf := regexp_replace(left(v_def, v_pos - 1), '\s*UNION ALL\s*SELECT\s*$', '');
    IF v_kopf !~ 'mart\.tpapi_zugang t\s*$' THEN
        RAISE EXCEPTION '0150: die Kostenzeile ist nicht der letzte Zweig von mart.pruefung_uebersicht — von Hand ansehen';
    END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s',
        v_kopf,
        $zweig$
        SELECT 'TPAPI: Schluessel ohne Schichten trotz Umsatz (14 Tage)'::text AS pruefung,
               count(*) FILTER (WHERE t.schluessel AND t.zustand = 'ok')::bigint AS geprueft,
               count(*) FILTER (WHERE t.befund = 'Schluessel ohne Schichten')::bigint AS auffaellig,
               'mart.tpapi_zugang'::text AS sicht
          FROM mart.tpapi_zugang t
        $zweig$);

    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%Tageskosten weichen von LINAs Quote ab%'
       OR v_def NOT LIKE '%Schluessel ohne Schichten trotz Umsatz%' THEN
        RAISE EXCEPTION '0150: mart.pruefung_uebersicht traegt nach dem Umbau nicht die erwarteten Zeilen';
    END IF;
END $aussen$;


-- ---------------------------------------------------------------------
-- 4. MCP-Katalog: der Kopfzahl-Fallstrick, Kommentare, Rechte, Leseprobe
-- ---------------------------------------------------------------------

INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle)
SELECT 'personal_kopfzahl_' || v.endung, 'deutung', 'warnung', v.sicht, '{}'::jsonb,
       'personen ist die KOPFZAHL je Stunde (ganzzahlig: wer 15 Minuten in der Stunde arbeitet, '
       'zaehlt 1), personenstunden die Summe dieser Kopfzahlen — eine Obergrenze, im Median 26 % '
       'ueber LINAs eigener Effektivitaetsrechnung (09.11.2026), je Betrieb +7 bis +57 %. Als '
       'Besetzung ("wie viele stehen da") richtig, als geleistete Arbeitszeit oder Lohnsumme nicht.',
       'Besetzung je Stunde und Vergleiche zwischen Betrieben, Tagen und Fenstern sind in Ordnung. '
       'Umsatz je Personenstunde nur als Vergleich (Betrieb gegen Betrieb, Monat gegen Monat), nie '
       'als absolute Produktivitaet; keine Rechnung gegen core.personalkosten, BWA oder Lohnlisten.',
       '0150'
  FROM (VALUES ('stunde', 'mart.personal_stunde'),
               ('zeitfenster', 'mart.personal_zeitfenster'),
               ('tag', 'mart.personal_tag')) AS v(endung, sicht)
ON CONFLICT (schluessel) DO UPDATE
   SET art = excluded.art, schwere = excluded.schwere, sicht = excluded.sicht,
       parameter = excluded.parameter, hinweis = excluded.hinweis,
       berichtigung = excluded.berichtigung, quelle = excluded.quelle;

UPDATE mcp.sicht
   SET koernung = 'Betrieb (alle) — TPAPI-Schluessel, letzter Aufruf, Schichten der letzten 14 Tage, geladene und fehlende Tage'
 WHERE sicht = 'mart.tpapi_zugang';

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

SELECT mcp.rechte_auffrischen();

DO $probe$
DECLARE
    v_abfrage text;
    v_liegen  text[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0150 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0150 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_abfrage IN ARRAY ARRAY[
        'SELECT * FROM mart.tpapi_zugang LIMIT 1',
        'SELECT * FROM mart.pruefung_uebersicht WHERE sicht = ''mart.tpapi_zugang''']
    LOOP
        BEGIN
            EXECUTE v_abfrage;
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_abfrage, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0150 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
