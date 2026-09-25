-- =====================================================================
-- 0121 Die Gegenprobe kennt das Loch im Umsatzbericht, der Ladestand den Tag
--
-- ZWEI KORREKTUREN an den Pruefsichten der Betriebsberichte, beide aus dem
-- Produktionsbefund vom 24./25.09.2026 (ueber den MCP-Zugang gemessen).
--
-- 1. GEGENPROBE. mart.betriebsbericht_gegenprobe zeigte 952 "abweichung /
--    wartet" und 190 "abweichung / historisch". Fast alle betrafen Zeitraeume
--    mit dem 21.07. oder 22.07.2026: 97 Juli bei 57 Betrieben, 96/86/113 in
--    der Woche 20.–26.07. bei 56, 92/88 am 21.07. bei 21, alle Monatsberichte
--    der Stufe B im Juli bei je 62. Genau diese beiden Tage fuehrt
--    mart.umsatz_lochtag (0101): der 21.07. "lueckenhaft" (21 von 55
--    Betrieben), der 22.07. "komplett leer", dreimal nachgeholt ohne Erfolg.
--    Die Betriebsberichte hatten recht, UNSER Umsatzbericht hat das Loch —
--    und der Nachholzweig haette jeden dieser Abrufe bis zu dreimal neu bei
--    LINA geholt (rund 2.800 Aufrufe, die nichts aendern koennen, harte
--    Regel 3).
--
--    Neu: befund 'umsatzbericht lueckenhaft', wenn
--      * LINAs Summe UEBER dem Umsatzbericht liegt (ein Loch im Umsatzbericht
--        macht ihn nur kleiner — liegt der Bericht darunter oder ist er leer,
--        erklaert das Loch nichts, und es bleibt bei abweichung bzw. leer
--        trotz Umsatz, mit Nachholen), und
--      * der Zeitraum einen Tag enthaelt, an dem der Umsatzbericht
--        nachweislich unvollstaendig ist: einen Lochtag (mart.umsatz_lochtag,
--        gilt fuer ALLE Betriebe — am 21.07. wichen auch die 21 Betriebe ab,
--        die einen Umsatz hatten, er war also auch bei ihnen zu klein) oder
--        einen Nulltag dieses Betriebs (mart.umsatztag_luecke: der
--        Artikelverkauf kennt Umsatz, der Umsatzbericht steht auf null).
--    Kein Nachholen (nachholen NULL), die Zeile bleibt stehen (Regel 10) und
--    nennt die Lochtage in der neuen Spalte umsatzbericht_luecke. Beide
--    Quellsichten reichen 120 Tage zurueck; nachgeholt wird ohnehin nur in
--    60 Tagen. Heilt der Umsatzbericht (lochtageNachziehen), wird die Zeile
--    von selbst wieder ok — oder eine echte Abweichung, die dann nachgeholt
--    wird.
--
-- 2. LADESTAND. Der Satz, den der MCP-Server an jede Kassen-Antwort haengt,
--    lautete am 24.09. fuer 92 "geladen 09/2026 bis 09/2026, vollstaendig bis
--    09/2026" — geladen war bis zum 16.09., und der August war schon zum Teil
--    da. Drei Ursachen:
--      a) Monate sind fuer Tagesberichte zu grob: "vollstaendig 09/2026"
--         hiess "alle Tage bis heute − 9 abgedeckt".
--      b) Die Basis zaehlte fuer T/W JEDEN abgedeckten Betrieb-Tag, auch
--         solche ohne Umsatz — ein fehlender Umsatztag konnte von einem
--         geladenen Tag ohne Umsatz aufgewogen werden. Jetzt exakt: gezaehlt
--         werden nur Betrieb-Tage mit Umsatz, die ein Abruf abdeckt.
--      c) Die Basis ist materialisiert und wird in Phase B und nach Phase C
--         aufgefrischt. Waehrend Phase C (bis 23 Uhr) und Phase A des
--         naechsten Morgens steht dort der Stand davor — der August war
--         geladen, aber noch nicht aufgefrischt. Der Satz nennt jetzt den
--         Zeitpunkt des Refresh ("Stand: …").
--    Nebenbei: fuer Monatsberichte galt ein Monat ab dem 10. als "reif" —
--    der laufende Monat stand damit als "nicht geladen" in der Luecken-
--    zaehlung, obwohl ihn der Erstabruf erst ab Monatsende + 7 holt. Jetzt
--    ist ein Monat fuer M/M-Tag reif, wenn sein LETZTER Tag 9 Tage zurueckliegt.
--
--    Die Basis bekommt dafuer zwei Spalten je Bericht (vollstaendig_ab_tag,
--    vollstaendig_bis_tag: die juengste lueckenlose Strecke fuer T/W) und
--    stand (Zeitpunkt des Refresh). Neue Spalten in einer Materialisierung
--    gehen nur ueber DROP/CREATE — die beiden abhaengigen Sichten
--    (ladestand_monat, ladestand) werden mit neu angelegt, die Rechte ueber
--    rechte_auffrischen(), die Probe als mcp_leser am Ende.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Gegenprobe: 'umsatzbericht lueckenhaft' — Fassung aus 0120, der eine
--    Zweig und die Spalte am Ende sind neu
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.betriebsbericht_gegenprobe AS
WITH loch AS MATERIALIZED (
    -- Tage, an denen der Umsatzbericht nachweislich unvollstaendig ist.
    -- betrieb_key NULL = Lochtag, gilt fuer jeden Betrieb.
    -- MATERIALIZED: einmal je Abfrage berechnet, und nur, wenn eine Zeile
    -- ueberhaupt bis hierher kommt (alles ok → nie berechnet).
    SELECT NULL::integer AS betrieb_key, l.geschaeftstag FROM mart.umsatz_lochtag l
    UNION ALL
    SELECT n.betrieb_key, n.geschaeftstag FROM mart.umsatztag_luecke n
), v AS (
    SELECT a.endpunkt, a.bericht, a.betrieb_key, b.name AS betrieb,
           a.zeitraum_von, a.zeitraum_bis, a.abrufe, a.nachgeholt,
           a.erstmals_abgerufen_am, a.zuletzt_abgerufen_am, a.zeilen,
           a.n_bills,
           round(a.balance_brutto, 2) AS bericht_brutto,
           k.umsatz_brutto            AS konzern_brutto,
           k.rechnungen               AS konzern_rechnungen,
           k.tage                     AS konzern_tage,
           round(a.balance_brutto - k.umsatz_brutto, 2) AS abweichung_brutto,
           CASE
             -- 0120: vor der Reife geholt — nicht gegen den Umsatzbericht stellen.
             WHEN a.vorlaeufig THEN 'vorlaeufig'
             WHEN coalesce(k.tage, 0) = 0 THEN 'ohne Konzernzahl'
             WHEN coalesce(a.n_bills, 0) = 0 AND coalesce(k.umsatz_brutto, 0) <> 0 THEN 'leer trotz Umsatz'
             -- Je Tag rundet der Umsatzbericht auf Cent; ueber einen Monat sind
             -- das bis zu 31 halbe Cent.
             WHEN abs(coalesce(a.balance_brutto, 0) - coalesce(k.umsatz_brutto, 0))
                  <= 0.01 * (a.zeitraum_bis - a.zeitraum_von + 1) THEN 'ok'
             -- 0121: LINAs Summe liegt UEBER unserem Umsatzbericht, und der hat
             -- im Zeitraum ein nachgewiesenes Loch. Der Fehler liegt bei uns —
             -- ein neuer Abruf des Betriebsberichts aendert daran nichts.
             WHEN coalesce(a.balance_brutto, 0) > coalesce(k.umsatz_brutto, 0)
                  AND EXISTS (SELECT 1 FROM loch l
                               WHERE l.geschaeftstag BETWEEN a.zeitraum_von AND a.zeitraum_bis
                                 AND (l.betrieb_key IS NULL OR l.betrieb_key = a.betrieb_key))
                  THEN 'umsatzbericht lueckenhaft'
             ELSE 'abweichung'
           END AS befund
      FROM core.betriebsbericht_abruf a
      JOIN core.betrieb b ON b.betrieb_key = a.betrieb_key
      LEFT JOIN LATERAL (
           SELECT count(*)            AS tage,
                  sum(u.umsatz_brutto) AS umsatz_brutto,
                  sum(u.rechnungen)    AS rechnungen
             FROM core.umsatzbericht_tag u
            WHERE u.betrieb_key = a.betrieb_key
              AND u.geschaeftstag BETWEEN a.zeitraum_von AND a.zeitraum_bis
              AND u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL) k ON true
)
SELECT v.*,
       CASE
         WHEN v.befund IN ('ok', 'ohne Konzernzahl', 'vorlaeufig', 'umsatzbericht lueckenhaft') THEN NULL
         WHEN v.nachgeholt >= 3 THEN 'aufgegeben'
         -- 0119: ein Bericht, den das Register ausdruecklich nicht erwartet
         -- (abgeschaltet wie 88, oder alle unter der Notbremse), wird nicht
         -- nachgeholt — betriebsberichteNachfuellen() reiht nur aktive ein.
         WHEN EXISTS (SELECT 1 FROM sync.quelle q
                       WHERE q.endpunkt = v.endpunkt AND NOT q.erwartet) THEN 'abgeschaltet'
         -- Aelter als 60 Tage: LINA fuellt nicht mehr nach.
         WHEN v.zeitraum_bis < current_date - 60 THEN 'historisch'
         WHEN v.zuletzt_abgerufen_am > now() - interval '7 days' THEN 'wartet'
         ELSE 'faellig'
       END AS nachholen,
       -- 0121: welche Tage des Zeitraums im Umsatzbericht fehlen — nur bei
       -- befund 'umsatzbericht lueckenhaft', sonst NULL.
       CASE WHEN v.befund = 'umsatzbericht lueckenhaft' THEN
            ARRAY(SELECT DISTINCT l.geschaeftstag FROM loch l
                   WHERE l.geschaeftstag BETWEEN v.zeitraum_von AND v.zeitraum_bis
                     AND (l.betrieb_key IS NULL OR l.betrieb_key = v.betrieb_key)
                   ORDER BY 1)
       END AS umsatzbericht_luecke
  FROM v;

COMMENT ON VIEW mart.betriebsbericht_gegenprobe IS
'Koernung: Betriebsbericht × Betrieb × Abrufzeitraum. Trifft LINAs eigene Summe
(balanceSumBrutto) den Konzern-Umsatzbericht desselben Betriebs und Zeitraums?

befund: ok | abweichung | leer trotz Umsatz (nBillsGesamt 0, der Umsatzbericht kennt Umsatz)
| ohne Konzernzahl (kein Umsatzbericht fuer den Zeitraum — dann ist nichts zu pruefen)
| vorlaeufig (0120: vor der Reife geholt, etwa der laufende Monat von 97 — nicht geprueft,
weil LINA die letzten Tage noch fuellt; geprueft wird der Abruf, der ihn nach der Reife ersetzt)
| umsatzbericht lueckenhaft (0121: LINAs Summe liegt UEBER unserem Umsatzbericht, und der hat im
Zeitraum einen Lochtag — mart.umsatz_lochtag, gilt fuer alle Betriebe — oder einen Nulltag dieses
Betriebs — mart.umsatztag_luecke. Der Fehler liegt dann bei uns, nicht im Betriebsbericht: kein
Nachholen. Welche Tage, steht in umsatzbericht_luecke. Anlass: 21./22.07.2026, rund 1.100 Abrufe).
nachholen: faellig (wird von betriebsberichteNachfuellen() erneut eingereiht, hoechstens
dreimal, frühestens eine Woche nach dem letzten Abruf) | wartet | aufgegeben | abgeschaltet
(der Bericht wird nicht mehr geholt — sync.quelle.erwartet = false, etwa 88 seit 23.09.2026
oder alle unter der Notbremse; es wird nichts nachgeholt) | historisch (aelter als 60 Tage:
nicht mehr nachgeholt, sichtbar bleibt es trotzdem) | NULL (nichts nachzuholen).

Lochtage und Nulltage reichen 120 Tage zurueck — ein aelteres Loch im Umsatzbericht steht hier
als abweichung/historisch.

Anlass: der falsche Endpunkt lieferte zwei Monate lang leere Gerueste mit plausibler
Groesse (fehlerkatalog.md, 22.09.2026). Eine Antwort beweist nichts, ihre Summe schon.
Wer die Sicht ueber viele Monate liest, filtert zeitraum_bis — sonst rechnet sie jeden
Abruf seit 2018 gegen den Umsatzbericht.';


-- ---------------------------------------------------------------------
-- 1b. Pruefuebersicht: eine Zeile mehr, angehaengt wie in 0114
--
-- ERWARTUNG: 0, ausser solange ein Lochtag oder Nulltag in den letzten 60
-- Tagen liegt. Die Zeile sagt, wie viele Betriebsberichte deshalb NICHT
-- geprueft sind — die Ursache steht in den Zeilen "Lochtag" und "Nulltag".
-- Die Zeile "Gegenprobe ... aufgegeben" bleibt unveraendert: sie zaehlt nur
-- nachholen = 'aufgegeben', und das erreicht ein lueckenhafter Umsatzbericht
-- nicht mehr.
-- ---------------------------------------------------------------------
DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%umsatzbericht lueckenhaft%' THEN RETURN; END IF;
    IF v_def NOT LIKE '%betriebsbericht_gegenprobe%' THEN
        RAISE EXCEPTION '0121: mart.pruefung_uebersicht fuehrt die Gegenprobe nicht mehr — '
                        'die Sicht wurde umgebaut, die Zeile von Hand ergaenzen.';
    END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        SELECT 'Betriebsberichte: Gegenprobe ausgesetzt, Umsatzbericht lueckenhaft (60 Tage)'::text AS pruefung,
               (SELECT count(*) FROM core.betriebsbericht_abruf
                 WHERE zeitraum_bis >= current_date - 60)::bigint AS geprueft,
               (SELECT count(*) FROM mart.betriebsbericht_gegenprobe
                 WHERE zeitraum_bis >= current_date - 60
                   AND befund = 'umsatzbericht lueckenhaft')::bigint AS auffaellig,
               'mart.betriebsbericht_gegenprobe'::text AS sicht
        $zweig$);
END $aussen$;


-- ---------------------------------------------------------------------
-- 2. Ladestand: die Basis neu, mit exakter Tageszaehlung fuer T/W
--
-- Unveraendert aus 0117: sichten, berichte, monate, umsatz, abgedeckt,
-- je_monat und alle Spalten bis sichten. Neu: die CTEs tw_* und drei
-- Spalten am Ende.
-- ---------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS mart.betriebsbericht_ladestand_basis CASCADE;

CREATE MATERIALIZED VIEW mart.betriebsbericht_ladestand_basis AS
WITH sichten (endpunkt, sichten) AS (
    -- Welche mart-Sicht aus welchem Bericht liest. Der MCP-Server haengt
    -- ueber diese Liste den Ladestand an jede Antwort — eine Sicht, die hier
    -- fehlt, bekommt keinen Hinweis.
    VALUES
      ('getReport:92',  ARRAY['mart.artikel_nachlass_tag', 'mart.artikel_nachlass_monat']),
      ('getReport:88',  ARRAY['mart.finanzweg_tag', 'mart.finanzweg_monat', 'mart.nachlass_monat', 'mart.zahlart_monat']),
      ('getReport:97',  ARRAY['mart.finanzweg_tag', 'mart.finanzweg_monat', 'mart.nachlass_monat', 'mart.zahlart_monat', 'mart.tagesabschluss_tag']),
      ('getReport:96',  ARRAY['mart.bon_tag', 'mart.bon_zahlart_tag', 'mart.debitor_monat']),
      ('getReport:90',  ARRAY['mart.monatsaufstellung_tag']),
      ('getReport:108', ARRAY['mart.monatsaufstellung_tag']),
      ('getReport:39',  ARRAY['mart.storno_artikel_monat', 'mart.storno_grund_monat']),
      ('getReport:60',  ARRAY['mart.kellner_monat', 'mart.kellner_umsatz_tag', 'mart.kellner_artikel_monat']),
      ('getReport:61',  ARRAY['mart.kellner_umsatz_tag']),
      ('getReport:53',  ARRAY['mart.kellner_artikel_monat']),
      ('getReport:57',  ARRAY['mart.kellner_monat', 'mart.gutschrift']),
      ('getReport:86',  ARRAY['mart.debitorenauswertung_tag']),
      ('getReport:113', ARRAY['mart.tisch_tag']),
      ('getReport:68',  ARRAY['mart.betriebsstelle_monat']),
      ('getReport:69',  ARRAY['mart.betriebsstelle_hauptsparte_monat']),
      ('getReport:112', ARRAY['mart.verkaufsstelle_monat']),
      ('getReport:71',  ARRAY['mart.verkaufsstelle_hauptsparte_monat']),
      ('getReport:75',  ARRAY['mart.zeitzone_feinsparte_monat']),
      ('getReport:76',  ARRAY['mart.zeitzone_hauptsparte_monat']),
      ('getReport:99',  ARRAY['mart.unbar_zahlung_monat'])
), berichte AS (
    SELECT q.endpunkt, q.bezeichnung, q.fensterklasse
      FROM sync.quelle q
     WHERE q.endpunkt LIKE 'getReport:%' AND q.erwartet
    UNION
    -- Auch ein Bericht, der (noch) nicht im Register steht, aber geladen
    -- wurde — sonst verschwaende sein Stand still.
    SELECT DISTINCT a.endpunkt, NULL::text, NULL::text
      FROM core.betriebsbericht_abruf a
     WHERE NOT EXISTS (SELECT 1 FROM sync.quelle q WHERE q.endpunkt = a.endpunkt AND q.erwartet)
), monate AS (
    SELECT m::date AS monat,
           ((m + interval '1 month')::date - m::date)       AS tage_im_monat
      FROM generate_series(DATE '2018-01-01', date_trunc('month', current_date), interval '1 month') m
), umsatz AS (
    -- Betrieb-Tage mit Umsatz, nur reife (Erstabruf ab Tag + 7, zwei Tage
    -- Luft — dieselbe Reife wie mart.betriebsbericht_luecke).
    SELECT date_trunc('month', u.geschaeftstag)::date AS monat,
           count(DISTINCT u.betrieb_key)::int          AS betriebe,
           count(*)::int                               AS betrieb_tage
      FROM core.umsatzbericht_tag u
     WHERE u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
       AND (coalesce(u.umsatz_netto, 0) <> 0 OR coalesce(u.rechnungen, 0) > 0)
       AND u.geschaeftstag <= current_date - 9
     GROUP BY 1
), abgedeckt AS (
    -- Je Bericht, Betrieb und Monat: wie viele Tage ein Abruf abdeckt (auch
    -- mit null Zeilen — ein leerer Bericht ist ein geladener Bericht) oder
    -- LINA als "keine Daten" (HTTP 500, leer) gemeldet hat.
    SELECT x.endpunkt, x.betrieb_key, x.monat,
           least(sum(x.tage), max(x.tage_im_monat))::int AS tage,
           bool_or(x.leer)                                AS leer
      FROM (
        SELECT a.endpunkt, a.betrieb_key, m.monat, m.tage_im_monat, false AS leer,
               (least(a.zeitraum_bis, (m.monat + interval '1 month')::date - 1)
                - greatest(a.zeitraum_von, m.monat) + 1)  AS tage
          FROM core.betriebsbericht_abruf a
          JOIN monate m ON m.monat BETWEEN date_trunc('month', a.zeitraum_von)::date
                                       AND date_trunc('month', a.zeitraum_bis)::date
        UNION ALL
        SELECT w.endpunkt, b.betrieb_key, m.monat, m.tage_im_monat, true,
               (least(w.zeitraum_bis, (m.monat + interval '1 month')::date - 1)
                - greatest(w.zeitraum_von, m.monat) + 1)
          FROM sync.warteschlange w
          JOIN core.betrieb b ON b.enc_id = w.betrieb_enc_id
          JOIN monate m ON m.monat BETWEEN date_trunc('month', w.zeitraum_von)::date
                                       AND date_trunc('month', w.zeitraum_bis)::date
         WHERE w.endpunkt LIKE 'getReport:%' AND w.ergebnis = 'keine_daten'
      ) x
     GROUP BY 1, 2, 3
), je_monat AS (
    SELECT d.endpunkt, d.monat,
           count(DISTINCT d.betrieb_key) FILTER (WHERE NOT d.leer)::int AS betriebe_geladen,
           count(DISTINCT d.betrieb_key) FILTER (WHERE d.leer)::int     AS betriebe_leer,
           sum(d.tage)::int                                             AS betrieb_tage_abgedeckt
      FROM abgedeckt d
     GROUP BY 1, 2
),
-- 0121: Tagesberichte (T, W) exakt je Betrieb-Tag. Abgedeckt zaehlt nur,
-- wo der Umsatzbericht Umsatz kennt — ein geladener Tag ohne Umsatz wiegt
-- keinen fehlenden Umsatztag mehr auf.
umsatz_tag AS (
    SELECT u.betrieb_key, u.geschaeftstag AS tag
      FROM core.umsatzbericht_tag u
     WHERE u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
       AND (coalesce(u.umsatz_netto, 0) <> 0 OR coalesce(u.rechnungen, 0) > 0)
       AND u.geschaeftstag >= DATE '2018-01-01'
), tw AS (
    SELECT endpunkt FROM berichte WHERE fensterklasse IN ('T', 'W')
), tw_abdeckung AS (
    SELECT a.endpunkt, a.betrieb_key, d::date AS tag
      FROM core.betriebsbericht_abruf a
      JOIN tw ON tw.endpunkt = a.endpunkt
     CROSS JOIN LATERAL generate_series(a.zeitraum_von, a.zeitraum_bis, interval '1 day') d
    UNION
    SELECT w.endpunkt, b.betrieb_key, d::date
      FROM sync.warteschlange w
      JOIN tw ON tw.endpunkt = w.endpunkt
      JOIN core.betrieb b ON b.enc_id = w.betrieb_enc_id
     CROSS JOIN LATERAL generate_series(w.zeitraum_von, w.zeitraum_bis, interval '1 day') d
     WHERE w.ergebnis = 'keine_daten'
), tw_tag AS (
    -- Je Bericht und Tag: Betriebe mit Umsatz, davon abgedeckt. Alle Tage,
    -- nicht nur reife — fuer die Strecke zaehlt auch, was noch fehlt.
    SELECT t.endpunkt, u.tag,
           count(*)::int             AS betriebe,
           count(c.betrieb_key)::int AS abgedeckt
      FROM tw t
     CROSS JOIN umsatz_tag u
      LEFT JOIN tw_abdeckung c
             ON c.endpunkt = t.endpunkt AND c.betrieb_key = u.betrieb_key AND c.tag = u.tag
     GROUP BY 1, 2
), tw_monat AS (
    SELECT endpunkt, date_trunc('month', tag)::date AS monat,
           sum(abgedeckt)::int AS betrieb_tage_abgedeckt
      FROM tw_tag
     WHERE tag <= current_date - 9
     GROUP BY 1, 2
), tw_insel AS (
    -- Inseln lueckenlos abgedeckter Tage: die laufende Zahl der Lueckentage
    -- bis hierher ist die Inselnummer. Tage ohne Umsatz bei allen Betrieben
    -- (Ruhetag, der 22.07.2026) stehen hier gar nicht und unterbrechen nichts.
    SELECT endpunkt, tag, abgedeckt = betriebe AS voll,
           count(*) FILTER (WHERE abgedeckt < betriebe)
               OVER (PARTITION BY endpunkt ORDER BY tag) AS insel
      FROM tw_tag
), tw_strecke AS (
    -- Die juengste Insel: endet am letzten voll abgedeckten Tag.
    SELECT e.endpunkt, min(i.tag) AS vollstaendig_ab_tag, e.tag AS vollstaendig_bis_tag
      FROM (SELECT DISTINCT ON (endpunkt) endpunkt, tag, insel
              FROM tw_insel WHERE voll
             ORDER BY endpunkt, tag DESC) e
      JOIN tw_insel i ON i.endpunkt = e.endpunkt AND i.insel = e.insel AND i.voll
     GROUP BY e.endpunkt, e.tag
)
SELECT r.endpunkt,
       split_part(r.endpunkt, ':', 2)::int                 AS bericht,
       r.bezeichnung,
       r.fensterklasse,
       m.monat,
       coalesce(u.betriebe, 0)                             AS betriebe_mit_umsatz,
       coalesce(j.betriebe_geladen, 0)                     AS betriebe_geladen,
       coalesce(j.betriebe_leer, 0)                        AS betriebe_leer,
       coalesce(u.betrieb_tage, 0)                         AS betrieb_tage_mit_umsatz,
       CASE WHEN r.fensterklasse IN ('T', 'W') THEN coalesce(tm.betrieb_tage_abgedeckt, 0)
            ELSE coalesce(j.betrieb_tage_abgedeckt, 0) END AS betrieb_tage_abgedeckt,
       CASE
         WHEN coalesce(u.betriebe, 0) = 0 AND coalesce(j.betriebe_geladen, 0) = 0 THEN 'kein Umsatz'
         WHEN coalesce(j.betriebe_geladen, 0) + coalesce(j.betriebe_leer, 0) = 0  THEN 'nicht geladen'
         WHEN r.fensterklasse IN ('T', 'W')
              AND coalesce(tm.betrieb_tage_abgedeckt, 0) >= coalesce(u.betrieb_tage, 0) THEN 'vollstaendig'
         WHEN coalesce(r.fensterklasse, 'M') IN ('M', 'M-Tag')
              AND coalesce(j.betriebe_geladen, 0) + coalesce(j.betriebe_leer, 0)
                  >= coalesce(u.betriebe, 0) THEN 'vollstaendig'
         ELSE 'teilweise'
       END                                                 AS zustand,
       s.sichten,
       st.vollstaendig_ab_tag,
       st.vollstaendig_bis_tag,
       now()                                               AS stand
  FROM berichte r
  CROSS JOIN monate m
  LEFT JOIN umsatz u      ON u.monat = m.monat
  LEFT JOIN je_monat j    ON j.endpunkt = r.endpunkt AND j.monat = m.monat
  LEFT JOIN tw_monat tm   ON tm.endpunkt = r.endpunkt AND tm.monat = m.monat
  LEFT JOIN tw_strecke st ON st.endpunkt = r.endpunkt
  LEFT JOIN sichten s     ON s.endpunkt = r.endpunkt
WITH NO DATA;

CREATE UNIQUE INDEX betriebsbericht_ladestand_basis_uq
    ON mart.betriebsbericht_ladestand_basis (endpunkt, monat);

REFRESH MATERIALIZED VIEW mart.betriebsbericht_ladestand_basis;

COMMENT ON MATERIALIZED VIEW mart.betriebsbericht_ladestand_basis IS
'Koernung: Betriebsbericht × Monat — die materialisierte Fassung von
mart.betriebsbericht_ladestand_monat. Reife und Zustand gelten zum Zeitpunkt des Refresh (Phase B
und nach Phase C, src/sync/betriebsbericht_sichten.ts) — der steht in stand. Gelesen wird die
Sicht gleichen Namens ohne _basis.

Seit 0121 fuer Tagesberichte (T, W) exakt: betrieb_tage_abgedeckt zaehlt nur Betrieb-Tage MIT
Umsatz, die ein Abruf (oder "keine Daten") abdeckt. vollstaendig_ab_tag/vollstaendig_bis_tag
gelten je Bericht (in jeder Monatszeile gleich): die juengste lueckenlose Strecke von Tagen, an
denen jeder Betrieb mit Umsatz abgedeckt ist — auch ueber noch nicht reife Tage hinweg. Fuer
Monatsberichte NULL.';


-- ---------------------------------------------------------------------
-- 3. mart.betriebsbericht_ladestand_monat — wortgleich aus 0120
-- ---------------------------------------------------------------------

CREATE VIEW mart.betriebsbericht_ladestand_monat AS
WITH v AS (
    SELECT a.endpunkt, m.monat::date AS monat, count(DISTINCT a.betrieb_key)::int AS betriebe
      FROM core.betriebsbericht_abruf a
      CROSS JOIN LATERAL generate_series(date_trunc('month', a.zeitraum_von),
                                         date_trunc('month', a.zeitraum_bis),
                                         interval '1 month') AS m(monat)
     WHERE a.vorlaeufig
     GROUP BY 1, 2
)
SELECT b.endpunkt,
       b.bericht,
       b.bezeichnung,
       b.fensterklasse,
       b.monat,
       b.betriebe_mit_umsatz,
       b.betriebe_geladen,
       b.betriebe_leer,
       b.betrieb_tage_mit_umsatz,
       b.betrieb_tage_abgedeckt,
       CASE WHEN coalesce(v.betriebe, 0) > 0 AND b.zustand = 'vollstaendig' THEN 'teilweise'
            ELSE b.zustand END                        AS zustand,
       b.sichten,
       coalesce(v.betriebe, 0)                        AS betriebe_vorlaeufig
  FROM mart.betriebsbericht_ladestand_basis b
  LEFT JOIN v ON v.endpunkt = b.endpunkt AND v.monat = b.monat
 WHERE b.endpunkt <> 'getReport:88';

COMMENT ON VIEW mart.betriebsbericht_ladestand_monat IS
'Koernung: Betriebsbericht × Monat seit Januar 2018 (materialisiert in
mart.betriebsbericht_ladestand_basis, Stand des letzten Laufs). Wie viel von einem Monat ist fuer diesen
Bericht geladen — gemessen an den Betrieben bzw. Betrieb-Tagen mit Umsatz (Umsatzbericht, nur
reife Tage: aelter als 9 Tage). Tagesberichte (T, W) zaehlen Betrieb-Tage mit Umsatz, die ein
Abruf abdeckt (seit 0121 exakt), Monatsberichte (M, M-Tag) Betriebe. Ein Abruf mit null Zeilen
zaehlt als geladen, ebenso ein Posten, fuer den LINA "keine Daten" gemeldet hat (betriebe_leer).

zustand: vollstaendig | teilweise | nicht geladen | kein Umsatz. "nicht geladen" ist der Fall,
um den es geht: eine Auswertung ueber diesen Monat liefert dann KEINE Zeile, und das heisst
nicht null. sichten nennt die mart-Sichten, die aus dem Bericht lesen. Fuer den laufenden Monat
eines Tagesberichts heisst "vollstaendig" nur: bis heute − 9 abgedeckt — den Tag nennt
mart.betriebsbericht_ladestand (vollstaendig_bis_tag).

betriebe_vorlaeufig (0120): Betriebe, deren Abruf fuer diesen Monat vor der Reife geholt wurde
(laufender Monat von 97, bis zum Vortag). Solange es sie gibt, ist der Monat "teilweise" — live
gelesen, nicht aus der Materialisierung: die letzten Tage koennen noch wachsen.

Bericht 88 (Finanzwege) steht seit 0119 NICHT hier: abgeschaltet am 23.09.2026, die
Finanzwegsichten lesen aus 97 (Tagesabschluss) — dessen Zeile ist der Stand der Finanzwege.';


-- ---------------------------------------------------------------------
-- 4. mart.betriebsbericht_ladestand — der Satz, genauer
--
-- Spalten wie in 0117, dazu am Ende vollstaendig_ab_tag,
-- vollstaendig_bis_tag, vorlaeufig_von, vorlaeufig_bis, stand.
-- ---------------------------------------------------------------------

CREATE VIEW mart.betriebsbericht_ladestand AS
WITH m AS (
    SELECT l.*,
           -- Reif ist, was der Erstabruf schon geholt haben muesste: ein Tag
           -- 9 Tage nach seinem Ende (7 Reife + 2 Luft). Tagesberichte: der
           -- Monat, sobald sein erster Tag reif ist (gezaehlt werden ohnehin
           -- nur reife Tage). Monatsberichte (0121): erst, wenn sein LETZTER
           -- Tag reif ist — vorher holt ihn der Erstabruf gar nicht, und der
           -- laufende Monat stand als Luecke da.
           CASE WHEN l.fensterklasse IN ('T', 'W')
                THEN l.monat <= date_trunc('month', current_date - 9)::date
                ELSE (l.monat + interval '1 month')::date - 1 <= current_date - 9
           END AS reif
      FROM mart.betriebsbericht_ladestand_monat l
), s AS (
    SELECT m.endpunkt, m.bericht, m.bezeichnung, m.fensterklasse, m.sichten,
           min(m.monat) FILTER (WHERE m.betriebe_geladen > 0)                    AS erster_monat,
           max(m.monat) FILTER (WHERE m.betriebe_geladen > 0)                    AS letzter_monat,
           max(m.monat) FILTER (WHERE m.reif AND m.zustand IN ('teilweise', 'nicht geladen')) AS letzte_luecke,
           max(m.monat) FILTER (WHERE m.reif AND m.zustand = 'vollstaendig')     AS letzter_vollstaendig,
           count(*) FILTER (WHERE m.reif AND m.zustand = 'vollstaendig')::int    AS monate_vollstaendig,
           count(*) FILTER (WHERE m.reif AND m.zustand = 'teilweise')::int       AS monate_teilweise,
           count(*) FILTER (WHERE m.reif AND m.zustand = 'nicht geladen')::int   AS monate_nicht_geladen,
           array_agg(m.monat ORDER BY m.monat DESC)
               FILTER (WHERE m.reif AND m.zustand = 'teilweise')                 AS teilweise_monate,
           min(m.monat) FILTER (WHERE m.reif AND m.zustand = 'nicht geladen')    AS nicht_geladen_von,
           max(m.monat) FILTER (WHERE m.reif AND m.zustand = 'nicht geladen')    AS nicht_geladen_bis
      FROM m
     GROUP BY m.endpunkt, m.bericht, m.bezeichnung, m.fensterklasse, m.sichten
), t AS (
    SELECT b.endpunkt,
           max(b.vollstaendig_ab_tag)  AS vollstaendig_ab_tag,
           max(b.vollstaendig_bis_tag) AS vollstaendig_bis_tag,
           max(b.stand)                AS stand
      FROM mart.betriebsbericht_ladestand_basis b
     GROUP BY b.endpunkt
), vl AS (
    -- LIVE, nicht aus der Materialisierung (wie betriebe_vorlaeufig, 0120):
    -- der laufende Monat von 97 waechst jede Nacht. Bis = der kleinste
    -- Stand ueber die Betriebe — so weit ist er fuer JEDEN Betrieb da.
    -- Nur die letzten 45 Tage: ein alter vorlaeufiger Abruf, der nie
    -- endgueltig wurde, steht als "teilweise" in seinem Monat.
    SELECT x.endpunkt, min(x.von) AS vorlaeufig_von, min(x.bis) AS vorlaeufig_bis
      FROM (SELECT a.endpunkt, a.betrieb_key,
                   min(a.zeitraum_von) AS von, max(a.zeitraum_bis) AS bis
              FROM core.betriebsbericht_abruf a
             WHERE a.vorlaeufig AND a.zeitraum_bis >= current_date - 45
             GROUP BY 1, 2) x
     GROUP BY 1
), f AS (
    SELECT s.*,
           t.vollstaendig_ab_tag, t.vollstaendig_bis_tag, t.stand,
           vl.vorlaeufig_von, vl.vorlaeufig_bis,
           -- 0121: der Anfang der Strecke, die in vollstaendig_bis endet — der
           -- erste vollstaendige Monat nach der letzten Luecke davor. Bis 0121
           -- stand hier NULL, sobald nach dem letzten vollstaendigen Monat noch
           -- eine Luecke kam (vollstaendig_bis gesetzt, _ab leer), und ein
           -- Monat ohne Umsatz direkt nach der Luecke galt als Anfang.
           (SELECT min(x.monat) FROM m x
             WHERE x.endpunkt = s.endpunkt AND x.reif AND x.zustand = 'vollstaendig'
               AND x.monat <= s.letzter_vollstaendig
               AND x.monat > coalesce(
                     (SELECT max(y.monat) FROM m y
                       WHERE y.endpunkt = s.endpunkt AND y.reif
                         AND y.zustand IN ('teilweise', 'nicht geladen')
                         AND y.monat < s.letzter_vollstaendig), DATE '1900-01-01')
           ) AS vollstaendig_ab,
           'Bericht ' || s.bericht
               || coalesce(' (' || regexp_replace(s.bezeichnung, '^Betriebsbericht \d+:\s*', '') || ')', '')
               AS name,
           CASE WHEN t.stand IS NULL THEN ''
                ELSE ' Stand: ' || to_char(t.stand AT TIME ZONE 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') || ' Uhr'
                     || CASE WHEN t.stand < now() - interval '36 hours'
                             THEN ' — seitdem nicht aufgefrischt, der Stand kann veraltet sein'
                             ELSE '' END
                     || '.'
           END AS stand_satz
      FROM s
      LEFT JOIN t  ON t.endpunkt = s.endpunkt
      LEFT JOIN vl ON vl.endpunkt = s.endpunkt
)
SELECT f.endpunkt, f.bericht, f.bezeichnung, f.fensterklasse,
       f.erster_monat, f.letzter_monat,
       f.vollstaendig_ab,
       f.letzter_vollstaendig                              AS vollstaendig_bis,
       f.monate_vollstaendig, f.monate_teilweise, f.monate_nicht_geladen,
       CASE
         WHEN f.erster_monat IS NULL THEN
           f.name || ' ist fuer keinen Monat geladen. Eine Auswertung daraus liefert keine Zeilen — '
                  || 'das ist KEINE Null.' || f.stand_satz
         ELSE
           f.name || ': '
           -- Was lueckenlos da ist: Tagesberichte auf den Tag, Monatsberichte auf den Monat.
           || CASE
                WHEN f.fensterklasse IN ('T', 'W') THEN
                  CASE WHEN f.vollstaendig_bis_tag IS NULL THEN 'kein Tag lueckenlos geladen'
                       ELSE 'vollstaendig vom ' || to_char(f.vollstaendig_ab_tag, 'DD.MM.YYYY')
                            || ' bis ' || to_char(f.vollstaendig_bis_tag, 'DD.MM.YYYY') END
                WHEN f.letzter_vollstaendig IS NULL THEN 'kein Monat vollstaendig geladen'
                ELSE 'vollstaendig von ' || to_char(f.vollstaendig_ab, 'MM/YYYY')
                     || ' bis ' || to_char(f.letzter_vollstaendig, 'MM/YYYY')
              END
           -- Der laufende Monat, vor der Reife geholt (97, seit 0120).
           || CASE WHEN f.vorlaeufig_bis IS NULL THEN ''
                   ELSE '; vorlaeufig vom ' || to_char(f.vorlaeufig_von, 'DD.MM.YYYY')
                        || ' bis ' || to_char(f.vorlaeufig_bis, 'DD.MM.YYYY')
                        || ' (LINA fuellt die letzten sieben Tage noch nach)' END
           || CASE WHEN f.monate_teilweise = 0 THEN ''
                   ELSE '; teilweise geladen: '
                        || array_to_string(ARRAY(
                               SELECT to_char(x.monat, 'MM/YYYY')
                                 FROM unnest(f.teilweise_monate[1:6]) WITH ORDINALITY AS x(monat, n)
                                ORDER BY x.n), ', ')
                        || CASE WHEN f.monate_teilweise > 6
                                THEN ' und ' || (f.monate_teilweise - 6) || ' weitere' ELSE '' END END
           || CASE WHEN f.monate_nicht_geladen = 0 THEN ''
                   WHEN f.monate_nicht_geladen = 1 THEN
                        '; nicht geladen: 1 Monat mit Umsatz (' || to_char(f.nicht_geladen_von, 'MM/YYYY') || ')'
                   ELSE '; nicht geladen: ' || f.monate_nicht_geladen || ' Monate mit Umsatz zwischen '
                        || to_char(f.nicht_geladen_von, 'MM/YYYY') || ' und '
                        || to_char(f.nicht_geladen_bis, 'MM/YYYY') END
           || '. Ein Zeitraum ohne Zeilen ist dort KEINE Null, sondern nicht geladen '
           || '(mart.betriebsbericht_ladestand_monat).'
           || f.stand_satz
       END                                                 AS aussage,
       f.sichten,
       f.vollstaendig_ab_tag,
       f.vollstaendig_bis_tag,
       f.vorlaeufig_von,
       f.vorlaeufig_bis,
       f.stand
  FROM f;

COMMENT ON VIEW mart.betriebsbericht_ladestand IS
'Koernung: ein Betriebsbericht. Fuer welchen Zeitraum er geladen ist, und die Aussage als Satz.
Der MCP-Server haengt aussage an jede Antwort, die eine der sichten liest — damit eine
Auswertung ueber 2019 "nicht geladen" sagt statt 0 (harte Regel 10).

Seit 0121: Tagesberichte (fensterklasse T, W) nennen den TAG — vollstaendig_ab_tag bis
vollstaendig_bis_tag ist die juengste lueckenlose Strecke (jeder Betrieb mit Umsatz an jedem
Tag abgedeckt). Monatsberichte nennen Monate: vollstaendig_bis ist der juengste vollstaendige
reife Monat, vollstaendig_ab der Anfang der lueckenlosen Strecke, die dort endet (bis 0121 NULL,
sobald danach noch eine Luecke kam); ein Monatsbericht ist reif, wenn sein letzter Tag 9 Tage
zurueckliegt, ein Tagesbericht, sobald sein erster Tag es tut.
vorlaeufig_von/-bis: der laufende Monat von 97, vor der Reife geholt — live gelesen, bis = so
weit ist er fuer jeden Betrieb da. monate_teilweise / monate_nicht_geladen zaehlen reife Monate
mit Umsatz. stand: wann die Materialisierung zuletzt aufgefrischt wurde (Phase B und nach
Phase C) — waehrend Phase C und am Morgen vor Phase B ist alles ausser vorlaeufig_* so alt.

Der Backfill laeuft rueckwaerts: waehrend er laeuft, steht hier eine wachsende Strecke, und
davor "nicht geladen".';


-- ---------------------------------------------------------------------
-- 5. Katalog, Rechte, Probe als Leserolle (Pflicht seit 0110)
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.betriebsbericht_ladestand_monat',   'Betriebsbericht × Monat — wie viel geladen ist', 'import', false),
    ('mart.betriebsbericht_ladestand_basis',   'Betriebsbericht × Monat — materialisierte Fassung von mart.betriebsbericht_ladestand_monat', 'import', false),
    ('mart.betriebsbericht_ladestand',         'ein Betriebsbericht — geladener Zeitraum als Satz', 'import', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

SELECT mcp.rechte_auffrischen();

DO $probe$
DECLARE
    v_sicht  text;
    v_liegen text[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Probe zu 0121 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Probe zu 0121 ist uebersprungen. '
                      'Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;', current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_sicht IN ARRAY ARRAY[
        'mart.betriebsbericht_gegenprobe', 'mart.betriebsbericht_ladestand_basis',
        'mart.betriebsbericht_ladestand_monat', 'mart.betriebsbericht_ladestand']
    LOOP
        BEGIN
            EXECUTE format('SELECT * FROM %s LIMIT 1', v_sicht);
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_sicht, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0121 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
