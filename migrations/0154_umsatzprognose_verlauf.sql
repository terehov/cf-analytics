-- =====================================================================
-- 0154 LINAs Umsatzprognose als Vergleichsbasis — Verlauf je Vorlauf,
--      Guete, und die Messung, ob LINA nachtraeglich aendert
--
-- ANLASS (12.11.2026, Auftrag Eugene). Brainfood wird eigene
-- Umsatzprognosen rechnen und will belegen, dass sie genauer sind als LINAs.
-- Dafuer muss LINAs Prognose (TPAPI revenue/getforecastperday, netto EUR je
-- Betrieb und Tag) so abgelegt sein, dass sich spaeter fair dagegen rechnen
-- laesst — auch rueckwirkend ("wie haette unser System fuer die
-- Vergangenheit gerechnet").
--
-- WARUM 0153 DAFUER NICHT REICHT. core.umsatzprognose_tag haelt je Betrieb
-- und Tag drei Werte (erste, letzte vor 08:00, juengste). Eine Prognose wird
-- aber zu einem bestimmten VORLAUF benutzt: der Dienstplan zwei Wochen
-- vorher, die Bestellung zwei Tage vorher, die Tagesplanung am Morgen. Eine
-- eigene Prognose mit sieben Tagen Vorlauf gegen LINAs Wert vom Morgen des
-- Tages zu stellen, waere unfair gegen uns — gegen LINAs ersten Wert unfair
-- gegen LINA. Fair ist nur derselbe Vorlauf auf beiden Seiten. Dazu braucht
-- es den VERLAUF: welcher Wert stand wann da.
--
-- WAS DIESE MIGRATION ANLEGT
--   1. core.umsatzprognose_beobachtung — eine Zeile je Betrieb, Tag und
--      Wert (erste Sichtung und jede Aenderung), "zuletzt gesehen" nachgefuehrt
--   2. Laderstand der Prognose auf 2 — der Lader baut den Verlauf aus den
--      schon gesicherten Rohabzuegen auf (src/tpapi/core_laden.ts)
--   3. mart.umsatzprognose_verlauf   — der Verlauf fuer die Leserolle
--   4. mart.umsatzprognose_vorlauf   — Betrieb × Tag × Vorlauf gegen das Ist
--   5. mart.umsatzprognose_guete     — MAE, MAPE, WAPE, Bias je Betrieb,
--                                      Monat, Vorlauf
--   6. mart.umsatzprognose_nachher(_betrieb) — aendert LINA nach dem Tag?
--   7. mart.umsatzprognose_horizont  — wie weit liefert LINA voraus?
--   8. Kommentar an mart.umsatzprognose_rueckstand (Historie jetzt zuerst)
--   9. eine Pruefzeile, MCP-Katalog, Fallstricke, Leseprobe als mcp_leser
--
-- Der Lader (Verlauf, Neuaufbau je Betrieb), das Fenster nach vorn
-- (TPAPI_PROGNOSE_TAGE_VORAUS, 60 statt 14) und die Historie vor dem
-- Tagesrueckstand (src/tpapi/rohabzug.ts) stehen im selben Commit.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Der Verlauf
--
-- Eine Zeile bei der ersten Sichtung eines Tages und bei jeder
-- Wertaenderung, NICHT bei gleichem Wert — der rueckt nur
-- zuletzt_gesehen_am, zuletzt_abzug_id und sichtungen nach. Damit ist je
-- Zeile bekannt, ab wann (gesehen_ab) und bis wann mindestens
-- (zuletzt_gesehen_am) der Wert galt; die naechste Zeile desselben Tages
-- loest ihn ab.
--
-- "Welche Prognose stand N Tage vorher da?" heisst: die Zeile mit dem
-- groessten gesehen_ab VOR dem Stichtag (Tag - N) 08:00 Berlin, sofern ihre
-- Nachfolgerin erst danach kam (mart.umsatzprognose_vorlauf).
--
-- vor_beginn: beim Schreiben festgehalten, ob die Zeile vor Beginn des
-- Geschaeftstags (08:00 Berlin) gesehen wurde — eine echte Vorabprognose.
-- Eine Zeile mit vor_beginn = false ist nachtraeglich geholt (Nachladen der
-- Historie, oder eine Aenderung waehrend oder nach dem Tag).
--
-- AUS RAW NEU AUFBAUBAR (Regel 4). Der Lader schreibt in der Reihenfolge der
-- Abrufe; kommt ein Abzug ausser der Reihe, baut er den Betrieb aus allen
-- geladenen Abzuegen neu auf (src/tpapi/core_laden.ts, prognoseLaden). Eine
-- neue Laderversion laedt so den ganzen Verlauf aus core.tpapi_stammabzug
-- und raw nach, ohne einen Aufruf; src/tpapi/core_laden.test.ts prueft, dass
-- dabei dieselben Zeilen entstehen.
-- ---------------------------------------------------------------------

CREATE TABLE core.umsatzprognose_beobachtung (
    betrieb_key         integer      NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag       date         NOT NULL,
    abzug_id            bigint       NOT NULL,
    gesehen_ab          timestamptz  NOT NULL,
    wert                numeric(12,2),
    zuletzt_gesehen_am  timestamptz  NOT NULL,
    zuletzt_abzug_id    bigint       NOT NULL,
    sichtungen          integer      NOT NULL DEFAULT 1 CHECK (sichtungen > 0),
    vor_beginn          boolean      NOT NULL,
    geladen_am          timestamptz  NOT NULL DEFAULT now(),
    aktualisiert_am     timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, geschaeftstag, abzug_id),
    CHECK (zuletzt_gesehen_am >= gesehen_ab)
);

CREATE INDEX umsatzprognose_beobachtung_reihe
    ON core.umsatzprognose_beobachtung (betrieb_key, geschaeftstag, gesehen_ab DESC, abzug_id DESC);
CREATE INDEX umsatzprognose_beobachtung_zuletzt
    ON core.umsatzprognose_beobachtung (betrieb_key, zuletzt_gesehen_am);
CREATE INDEX umsatzprognose_beobachtung_abzug
    ON core.umsatzprognose_beobachtung (zuletzt_abzug_id);

COMMENT ON TABLE core.umsatzprognose_beobachtung IS
'Koernung: Betrieb × Geschaeftstag × Wert (erste Sichtung und jede Aenderung) — der Verlauf von LINAs
Umsatzprognose (TPAPI revenue/getforecastperday, netto EUR), 0154. Eine Zeile je neuem Wert, nicht je
Abzug: bei gleichem Wert ruecken nur zuletzt_gesehen_am, zuletzt_abzug_id und sichtungen nach. Daraus
ist fuer jeden Vorlauf N beantwortbar, welche Prognose N Tage vor dem Tag (vor 08:00 Berlin) dastand
(mart.umsatzprognose_vorlauf). Vom Lader im selben Zug wie core.umsatzprognose_tag geschrieben und aus
raw neu aufbaubar (Laderstand in sync.tpapi_core_lader).';
COMMENT ON COLUMN core.umsatzprognose_beobachtung.abzug_id IS
'Der Abzug (core.tpapi_stammabzug), in dem dieser Wert zum ersten Mal stand.';
COMMENT ON COLUMN core.umsatzprognose_beobachtung.gesehen_ab IS
'Abrufzeitpunkt des Abzugs, in dem der Wert zum ersten Mal stand — ab hier galt er nachweislich.';
COMMENT ON COLUMN core.umsatzprognose_beobachtung.wert IS
'LINAs Prognose netto EUR, auf Cent gerundet. NULL, wenn LINA den Tag ohne Wert lieferte.';
COMMENT ON COLUMN core.umsatzprognose_beobachtung.zuletzt_gesehen_am IS
'Letzter Abzug, in dem der Tag mit DIESEM Wert stand — bis hierher galt er nachweislich. Was zwischen
zuletzt_gesehen_am und der naechsten Zeile lag, hat niemand gesehen.';
COMMENT ON COLUMN core.umsatzprognose_beobachtung.zuletzt_abzug_id IS
'Der Abzug zu zuletzt_gesehen_am. Alle Zeilen mit derselben zuletzt_abzug_id sind genau die Tage, die
dieser Abzug geliefert hat (mart.umsatzprognose_horizont).';
COMMENT ON COLUMN core.umsatzprognose_beobachtung.sichtungen IS
'In wie vielen Abzuegen der Wert unveraendert stand (mindestens 1).';
COMMENT ON COLUMN core.umsatzprognose_beobachtung.vor_beginn IS
'true: zum ersten Mal gesehen VOR Beginn des Geschaeftstags (08:00 Berlin) — eine echte Vorabprognose.
false: erst danach gesehen (Nachladen der Historie, oder geaendert waehrend oder nach dem Tag) — fuer
einen Vergleich nur eingeschraenkt brauchbar, siehe mart.umsatzprognose_nachher_betrieb.';
COMMENT ON COLUMN core.umsatzprognose_beobachtung.aktualisiert_am IS
'Wann der Lader die Zeile zuletzt angefasst hat (neu oder nachgefuehrt) — daran misst sync.quelle den Zulauf.';


-- ---------------------------------------------------------------------
-- 2. Laderstand: der Verlauf kommt aus den gesicherten Abzuegen
--
-- Der Importer schreibt den Stand bei jedem Lauf selbst; hier nur, damit
-- mart.tpapi_core_stand die Abzuege schon vor dem ersten Lauf als wartend
-- zeigt (dieselbe Zahl wie src/tpapi/core_laden.ts, LADERSTAND).
-- ---------------------------------------------------------------------

UPDATE sync.tpapi_core_lader
   SET stand = 2, aktualisiert_am = now()
 WHERE endpunkt = 'tpapi:getforecastperday' AND stand < 2;


-- ---------------------------------------------------------------------
-- 3. Der Verlauf fuer die Leserolle
--
-- vorlauf_tage: fuer welchen Vorlauf dieser Wert hoechstens zaehlt. Der
-- Stichtag zum Vorlauf N ist (Tag - N) 08:00 Berlin; eine Sichtung zum
-- Zeitpunkt t liegt davor genau dann, wenn N <= Tag - Datum(t + 16 h). Eine
-- Sichtung am Vortag um 05:30 zaehlt fuer N = 1, eine am Vortag um 09:00 nur
-- fuer N = 0. Negativ: erst nach Beginn des Tages gesehen.
-- ---------------------------------------------------------------------

CREATE VIEW mart.umsatzprognose_verlauf AS
SELECT o.geschaeftstag,
       date_trunc('month', o.geschaeftstag::timestamp)::date AS monat,
       o.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       bs.konzept                                       AS marke,
       row_number() OVER w                              AS nr,
       o.wert                                           AS prognose_netto,
       o.gesehen_ab,
       o.zuletzt_gesehen_am,
       lead(o.gesehen_ab) OVER w                        AS abgeloest_am,
       o.sichtungen,
       o.vor_beginn,
       (o.geschaeftstag - ((o.gesehen_ab AT TIME ZONE core.geschaefts_zeitzone())
                           + interval '16 hours')::date) AS vorlauf_tage,
       o.abzug_id,
       o.zuletzt_abzug_id,
       (bs.status = 'operativ')                         AS operativ
  FROM core.umsatzprognose_beobachtung o
  JOIN core.betrieb b              ON b.betrieb_key = o.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = o.betrieb_key
WINDOW w AS (PARTITION BY o.betrieb_key, o.geschaeftstag ORDER BY o.gesehen_ab, o.abzug_id);

COMMENT ON VIEW mart.umsatzprognose_verlauf IS
'Koernung: Betrieb × Geschaeftstag × Wert — der Verlauf von LINAs Umsatzprognose (0154): eine Zeile
bei der ersten Sichtung und bei jeder Aenderung, nr zaehlt sie je Tag. Ein Wert galt nachweislich von
gesehen_ab bis zuletzt_gesehen_am und wurde zu abgeloest_am durch die naechste Zeile ersetzt (NULL =
gilt noch). vor_beginn = true: gesehen vor 08:00 des Tages (echte Vorabprognose). vorlauf_tage: fuer
welchen Vorlauf der Wert hoechstens zaehlt (negativ = erst nach Beginn des Tages gesehen). LINAs Zahl,
keine eigene; nur Betriebe mit TPAPI-Schluessel und Sales Data API. Fuer Prognose gegen Ist
mart.umsatzprognose_vorlauf.';
COMMENT ON COLUMN mart.umsatzprognose_verlauf.vorlauf_tage IS
'Groesster Vorlauf N, fuer den dieser Wert zaehlt: gesehen vor (Tag - N) 08:00 Berlin. 0 = am Morgen des
Tages, negativ = erst nach Beginn des Tages gesehen.';


-- ---------------------------------------------------------------------
-- 4. Prognose je Vorlauf gegen das Ist
--
-- DIE STUETZSTELLEN 0, 1, 2, 3, 7, 14, 28 TAGE — und warum genau die:
--    0  am Morgen des Tages (Stand 08:00): Tagesplanung, Vorbereitung.
--       Entspricht vorab_netto aus 0153.
--    1  am Vortag: kurzfristige Schichtaenderung, Frischware.
--    2, 3  Bestellrhythmus der Lieferanten (zwei bis drei Tage Vorlauf).
--    7  eine Woche: Wochendienstplan, Wochentagsmuster.
--   14  zwei Wochen: der uebliche Vorlauf des Dienstplans.
--   28  vier Wochen: Monatsplanung — und die Grenze, bis zu der LINAs
--       Fenster (60 Tage) sicher reicht, falls LINA so weit liefert.
-- Die dazwischenliegenden Vorlaeufe liefert mart.umsatzprognose_verlauf
-- (vorlauf_tage) fuer jede andere Frage. Mehr Stuetzstellen vervielfachen
-- nur die Zeilen.
--
-- NACHTRAEGLICH. Zusaetzlich eine Zeile je Tag mit grundlage =
-- 'nachtraeglich' und vorlauf_tage = NULL: der erste Wert, der nach dem
-- Ende des Geschaeftstags (Folgetag 08:00) noch oder neu gesehen wurde —
-- das, was LINA liefert, wenn man nach dem Tag fragt. Fuer die Historie vor
-- dem ersten Lauf ist das der einzige Wert. Ob er der damals ausgegebenen
-- Prognose entspricht, ist NICHT bekannt (mart.umsatzprognose_nachher_betrieb).
--
-- FEHLER = PROGNOSE - IST (positiv: LINA zu hoch). Das ist die uebliche
-- Richtung fuer Prognosefehler und Bias — und die UMGEKEHRTE von
-- mart.umsatzprognose_tag.abweichung_netto (Ist - Prognose). Prozent immer
-- vom Ist, als Prozentzahl.
--
-- AUSSCHLUSS. Tage, die keine Fehlerrechnung vertragen, bleiben sichtbar und
-- tragen einen Grund (der erste zutreffende): Tag nicht vorbei, keine
-- Prognose, Betrieb nicht operativ (Stand heute), kein Ist, Ist null oder
-- negativ (geschlossen — darunter auch die Datenloecher aus 0101, die fuer
-- den Betrieb als 0 stehen), Kassen-Fehleingabe (Journal oder Bericht 97,
-- mart.kassenjournal_fehleingabe), Ist noch offen (juenger als sieben Tage:
-- LINA fuellt den Umsatzbericht erst nach fuenf bis sieben Tagen, 0101).
-- ---------------------------------------------------------------------

CREATE VIEW mart.umsatzprognose_vorlauf AS
WITH stuetz(vorlauf_tage) AS (
    VALUES (0), (1), (2), (3), (7), (14), (28)
), verlauf AS (
    SELECT o.betrieb_key, o.geschaeftstag, o.wert, o.gesehen_ab, o.zuletzt_gesehen_am, o.abzug_id,
           lead(o.gesehen_ab) OVER (PARTITION BY o.betrieb_key, o.geschaeftstag
                                    ORDER BY o.gesehen_ab, o.abzug_id) AS abgeloest_am,
           ((o.geschaeftstag + 1) + time '08:00') AT TIME ZONE core.geschaefts_zeitzone() AS ende
      FROM core.umsatzprognose_beobachtung o
), vorab AS (
    SELECT v.betrieb_key, v.geschaeftstag, s.vorlauf_tage, 'vorab'::text AS grundlage, v.wert,
           v.gesehen_ab, v.zuletzt_gesehen_am, st.stichtag,
           round((greatest(extract(epoch FROM st.stichtag - v.zuletzt_gesehen_am), 0) / 86400.0)::numeric, 1)
                                                        AS sichtung_luecke_tage
      FROM verlauf v
     CROSS JOIN stuetz s
     CROSS JOIN LATERAL (SELECT ((v.geschaeftstag - s.vorlauf_tage) + time '08:00')
                                AT TIME ZONE core.geschaefts_zeitzone() AS stichtag) st
     WHERE v.gesehen_ab < st.stichtag
       AND (v.abgeloest_am IS NULL OR v.abgeloest_am >= st.stichtag)
       -- Ein Stichtag in der Zukunft ist noch kein Stand: der Wert kann bis dahin wechseln.
       AND st.stichtag <= now()
), nach AS (
    SELECT DISTINCT ON (v.betrieb_key, v.geschaeftstag)
           v.betrieb_key, v.geschaeftstag, NULL::integer AS vorlauf_tage, 'nachtraeglich'::text AS grundlage,
           v.wert, v.gesehen_ab, v.zuletzt_gesehen_am, v.ende AS stichtag, NULL::numeric AS sichtung_luecke_tage
      FROM verlauf v
     WHERE v.zuletzt_gesehen_am >= v.ende
     ORDER BY v.betrieb_key, v.geschaeftstag, v.gesehen_ab, v.abzug_id
), x AS (
    SELECT * FROM vorab
    UNION ALL
    SELECT * FROM nach
), fe AS (
    SELECT DISTINCT f.betrieb_key, f.geschaeftstag FROM mart.kassenjournal_fehleingabe f
), y AS (
    SELECT x.*,
           u.umsatz_netto                               AS ist_netto,
           bs.status                                    AS betrieb_status,
           bs.konzept                                   AS marke,
           CASE WHEN x.geschaeftstag >= current_date               THEN 'tag nicht vorbei'
                WHEN x.wert IS NULL                                THEN 'keine prognose'
                WHEN bs.status IS DISTINCT FROM 'operativ'         THEN 'betrieb nicht operativ'
                WHEN u.umsatz_netto IS NULL                        THEN 'kein ist'
                WHEN u.umsatz_netto <= 0                           THEN 'ist null (geschlossen)'
                WHEN fe.betrieb_key IS NOT NULL                    THEN 'kassen-fehleingabe'
                WHEN x.geschaeftstag > current_date - 7            THEN 'ist noch offen'
           END                                          AS ausschluss_grund
      FROM x
      LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = x.betrieb_key
      LEFT JOIN mart.umsatz_tag u      ON u.betrieb_key = x.betrieb_key
                                      AND u.geschaeftstag = x.geschaeftstag
      LEFT JOIN fe                     ON fe.betrieb_key = x.betrieb_key
                                      AND fe.geschaeftstag = x.geschaeftstag
)
SELECT y.geschaeftstag,
       date_trunc('month', y.geschaeftstag::timestamp)::date AS monat,
       (ARRAY['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'])
           [extract(isodow FROM y.geschaeftstag)::int]  AS wochentag,
       y.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       y.marke,
       y.grundlage,
       y.vorlauf_tage,
       y.stichtag,
       y.wert                                           AS prognose_netto,
       y.ist_netto,
       y.wert - y.ist_netto                             AS fehler_netto,
       abs(y.wert - y.ist_netto)                        AS fehler_abs_netto,
       CASE WHEN y.ist_netto > 0
            THEN round((y.wert - y.ist_netto) / y.ist_netto * 100, 2) END AS fehler_pct,
       CASE WHEN y.ist_netto > 0
            THEN round(abs(y.wert - y.ist_netto) / y.ist_netto * 100, 2) END AS fehler_abs_pct,
       y.gesehen_ab                                     AS prognose_gesehen_ab,
       y.zuletzt_gesehen_am                             AS prognose_zuletzt_gesehen,
       y.sichtung_luecke_tage,
       bool_or(y.grundlage = 'vorab') OVER (PARTITION BY y.betrieb_key, y.geschaeftstag) AS tag_hat_vorab,
       y.ausschluss_grund,
       (y.ausschluss_grund IS NULL)                     AS vergleichbar,
       (y.betrieb_status = 'operativ')                  AS operativ
  FROM y
  JOIN core.betrieb b ON b.betrieb_key = y.betrieb_key;

COMMENT ON VIEW mart.umsatzprognose_vorlauf IS
'Koernung: Betrieb × Geschaeftstag × Vorlauf — LINAs Umsatzprognose, wie sie N Tage vor dem Tag (vor
08:00 Berlin) dastand, gegen den Nettoumsatz (mart.umsatz_tag), 0154. Die Vergleichsbasis fuer eigene
Prognosen: immer DENSELBEN Vorlauf vergleichen. vorlauf_tage in 0, 1, 2, 3, 7, 14, 28 (0 = am Morgen
des Tages) mit grundlage = vorab; dazu je Tag eine Zeile grundlage = nachtraeglich (vorlauf_tage
NULL): der erste Wert, der nach dem Tag gesehen wurde — ob LINA ihn nachtraeglich angepasst hat, ist
unbekannt (mart.umsatzprognose_nachher_betrieb). Jeder Tag steht bis zu achtmal da: nie ohne Filter
auf vorlauf_tage bzw. grundlage summieren. fehler_netto = Prognose - Ist (positiv = LINA zu hoch, die
umgekehrte Richtung von mart.umsatzprognose_tag.abweichung_netto), fehler_pct in Prozent des Ist
(Prozentzahl). Fuer Fehlermasse nur vergleichbar = true; ausschluss_grund sagt, warum ein Tag nicht
zaehlt. Fertige Fehlermasse je Betrieb und Monat: mart.umsatzprognose_guete. Nur Betriebe mit
TPAPI-Schluessel und Sales Data API; Vorabwerte erst ab dem ersten Lauf mit 0154.';
COMMENT ON COLUMN mart.umsatzprognose_vorlauf.grundlage IS
'vorab: gesehen vor dem Stichtag (Tag - vorlauf_tage) 08:00 — eine echte Vorabprognose. nachtraeglich:
erster Wert, der nach Ende des Tages (Folgetag 08:00) gesehen wurde; vorlauf_tage ist dann NULL.';
COMMENT ON COLUMN mart.umsatzprognose_vorlauf.vorlauf_tage IS
'Vorlauf in Tagen (0 = Stand am Morgen des Tages um 08:00, 1 = am Vortag um 08:00, ...). NULL bei
grundlage = nachtraeglich.';
COMMENT ON COLUMN mart.umsatzprognose_vorlauf.stichtag IS
'Zeitpunkt, zu dem der Wert galt: (Tag - vorlauf_tage) 08:00 Berlin; bei nachtraeglich das Ende des Tages.';
COMMENT ON COLUMN mart.umsatzprognose_vorlauf.fehler_netto IS
'prognose_netto - ist_netto in EUR; positiv = LINA hat zu hoch prognostiziert.';
COMMENT ON COLUMN mart.umsatzprognose_vorlauf.fehler_pct IS
'fehler_netto in Prozent des Ist (Prozentzahl, 23.64 = 23,64 %). Nicht mitteln — aus Summen neu rechnen
oder mart.umsatzprognose_guete nehmen.';
COMMENT ON COLUMN mart.umsatzprognose_vorlauf.sichtung_luecke_tage IS
'Nur vorab: wie viele Tage vor dem Stichtag der Wert zuletzt gesehen wurde (0 = auch danach noch
unveraendert gesehen). Gross heisst: zwischen letzter Sichtung und Stichtag hat niemand hingesehen.';
COMMENT ON COLUMN mart.umsatzprognose_vorlauf.tag_hat_vorab IS
'true, wenn es fuer diesen Tag mindestens einen Vorabwert gibt — damit lassen sich vorab und
nachtraeglich ueber DIESELBEN Tage vergleichen.';
COMMENT ON COLUMN mart.umsatzprognose_vorlauf.ausschluss_grund IS
'Warum der Tag aus einer Fehlerrechnung herausgehoert (erster zutreffender Grund): tag nicht vorbei,
keine prognose, betrieb nicht operativ (Stand heute), kein ist, ist null (geschlossen), kassen-fehleingabe,
ist noch offen (juenger als 7 Tage). NULL = vergleichbar.';


-- ---------------------------------------------------------------------
-- 5. Die Guete je Betrieb, Monat und Vorlauf
--
-- Die ueblichen Fehlermasse, nur ueber vergleichbare Tage, vorab und
-- nachtraeglich getrennt (vorlauf_tage NULL = nachtraeglich). Die Summen
-- stehen daneben, damit Marke, Quartal oder Gruppe aus SUMMEN neu gerechnet
-- werden und nicht aus gemittelten Prozenten:
--   MAE  = summe_fehler_abs_netto / tage
--   MAPE = summe_ape_pct / tage           (jeder Tag gleich schwer)
--   WAPE = summe_fehler_abs_netto / summe_ist_netto * 100
--                                         (umsatzgewichtet, das Mass fuer den Vergleich)
--   Bias = summe_fehler_netto / summe_ist_netto * 100
-- ---------------------------------------------------------------------

CREATE VIEW mart.umsatzprognose_guete AS
SELECT v.betrieb_key,
       v.enc_id,
       v.betrieb,
       v.marke,
       v.monat,
       v.grundlage,
       v.vorlauf_tage,
       count(*) FILTER (WHERE v.vergleichbar)::int                         AS tage,
       count(*) FILTER (WHERE NOT v.vergleichbar)::int                     AS tage_ausgeschlossen,
       count(*) FILTER (WHERE v.ausschluss_grund = 'ist null (geschlossen)')::int AS tage_geschlossen,
       count(*) FILTER (WHERE v.ausschluss_grund = 'ist null (geschlossen)'
                          AND v.prognose_netto > 0)::int                   AS tage_geschlossen_mit_prognose,
       sum(v.ist_netto) FILTER (WHERE v.vergleichbar)                      AS summe_ist_netto,
       sum(v.prognose_netto) FILTER (WHERE v.vergleichbar)                 AS summe_prognose_netto,
       sum(v.fehler_netto) FILTER (WHERE v.vergleichbar)                   AS summe_fehler_netto,
       sum(v.fehler_abs_netto) FILTER (WHERE v.vergleichbar)               AS summe_fehler_abs_netto,
       sum(v.fehler_abs_netto / v.ist_netto * 100) FILTER (WHERE v.vergleichbar) AS summe_ape_pct,
       round(avg(v.fehler_abs_netto) FILTER (WHERE v.vergleichbar), 2)     AS mae_netto,
       round(avg(v.fehler_abs_netto / v.ist_netto * 100) FILTER (WHERE v.vergleichbar), 2) AS mape_pct,
       round(sum(v.fehler_abs_netto) FILTER (WHERE v.vergleichbar)
             / nullif(sum(v.ist_netto) FILTER (WHERE v.vergleichbar), 0) * 100, 2) AS wape_pct,
       round(avg(v.fehler_netto) FILTER (WHERE v.vergleichbar), 2)         AS bias_netto,
       round(sum(v.fehler_netto) FILTER (WHERE v.vergleichbar)
             / nullif(sum(v.ist_netto) FILTER (WHERE v.vergleichbar), 0) * 100, 2) AS bias_pct,
       bool_or(v.operativ)                                                 AS operativ
  FROM mart.umsatzprognose_vorlauf v
 GROUP BY v.betrieb_key, v.enc_id, v.betrieb, v.marke, v.monat, v.grundlage, v.vorlauf_tage;

COMMENT ON VIEW mart.umsatzprognose_guete IS
'Koernung: Betrieb × Monat × Grundlage × Vorlauf — wie genau LINAs Umsatzprognose war (0154): MAE (EUR),
MAPE, WAPE (Summe |Fehler| / Summe Ist) und Bias, nur ueber vergleichbare Tage (mart.umsatzprognose_vorlauf,
vergleichbar). Fehler = Prognose - Ist; Prozentwerte sind Prozentzahlen. grundlage = vorab mit
vorlauf_tage 0/1/2/3/7/14/28 ist die belastbare Zahl; grundlage = nachtraeglich (vorlauf_tage NULL) erst
dann, wenn mart.umsatzprognose_nachher_betrieb ueber Wochen zeigt, dass LINA nachtraeglich nichts aendert.
Nie ueber Vorlaeufe oder Grundlagen summieren; fuer Marke, Quartal oder Gruppe aus den summe_-Spalten neu
rechnen (WAPE = summe_fehler_abs_netto / summe_ist_netto * 100), nicht Prozente mitteln. Fuer den Vergleich
mit eigenen Prognosen dieselben Tage und denselben Vorlauf nehmen.';
COMMENT ON COLUMN mart.umsatzprognose_guete.tage IS 'Vergleichbare Tage — der Nenner von MAE und MAPE.';
COMMENT ON COLUMN mart.umsatzprognose_guete.tage_geschlossen_mit_prognose IS
'Tage mit Ist 0 (geschlossen), fuer die LINA trotzdem Umsatz prognostiziert hat — nicht im Fehler, aber
ein Hinweis, ob LINA Ruhetage kennt.';
COMMENT ON COLUMN mart.umsatzprognose_guete.summe_ape_pct IS
'Summe der absoluten Prozentfehler je Tag — MAPE fuer groessere Gruppen = summe_ape_pct / tage.';
COMMENT ON COLUMN mart.umsatzprognose_guete.mape_pct IS
'Mittlerer absoluter Prozentfehler (Prozentzahl): jeder Tag gleich schwer, schwache Tage ziehen ihn hoch.';
COMMENT ON COLUMN mart.umsatzprognose_guete.wape_pct IS
'Summe |Fehler| / Summe Ist * 100 (Prozentzahl): umsatzgewichtet, das Mass fuer den Vergleich zweier Prognosen.';
COMMENT ON COLUMN mart.umsatzprognose_guete.bias_pct IS
'Summe Fehler / Summe Ist * 100 (Prozentzahl): positiv = LINA liegt im Mittel zu hoch.';


-- ---------------------------------------------------------------------
-- 6. Aendert LINA ihre Prognose nach dem Tag? (Die wichtigste Messung.)
--
-- Fuer jeden Tag, fuer den es einen echten Vorabwert gibt (gesehen vor
-- 08:00 des Tages) UND eine Beobachtung nach dem Ende des Tages (Folgetag
-- 08:00): stimmt der nachher gesehene Wert mit dem Vorabwert ueberein?
--
-- WARUM ES DARAUF ANKOMMT. Die Historie vor dem ersten Lauf kennt nur
-- nachtraeglich geholte Werte. Liefert LINA fuer vergangene Tage die
-- damals ausgegebene Prognose, ist sie eine faire Vergleichsbasis. Rechnet
-- LINA sie nachtraeglich neu (etwa mit dem inzwischen bekannten Ist oder
-- einem neuen Modell), ist der Vergleich verzerrt — zu LINAs Gunsten, wenn
-- das Ist einfliesst, zu ihren Ungunsten, wenn ein schlechteres Modell
-- nachrechnet. Niemand weiss es.
--
-- WIE DIE MESSUNG ENTSTEHT. Das Fenster von Phase A reicht bis zum
-- Monatsersten bzw. sieben Tage zurueck, und nach jedem Monatsende holt
-- Phase C den ganzen Monat noch einmal (mart.umsatzprognose_rueckstand).
-- Jeder Tag wird so vorher gesehen und bis zu gut fuenf Wochen danach
-- erneut. WAS SIE NICHT MISST: ob LINA Jahre alte Prognosen anders
-- liefert als vor Wochen — dafuer muesste die Historie spaeter noch einmal
-- geholt werden (docs/offene-punkte.md).
--
-- FREIGABE. Erst wenn mart.umsatzprognose_nachher_betrieb ueber einige
-- Wochen (Vorschlag: vier) bei allen Betrieben befund = 'unveraendert'
-- zeigt, mit groesster_abstand_tage ueber 28, darf grundlage =
-- 'nachtraeglich' in mart.umsatzprognose_vorlauf und _guete als
-- Vergleichsbasis gelten. Bis dahin ist sie eine Zahl mit unbekannter
-- Verzerrung. Die Entscheidung trifft ein Mensch und schreibt sie in
-- docs/entscheidungen.md.
-- ---------------------------------------------------------------------

CREATE VIEW mart.umsatzprognose_nachher AS
WITH verlauf AS (
    SELECT o.betrieb_key, o.geschaeftstag, o.wert, o.gesehen_ab, o.zuletzt_gesehen_am, o.abzug_id,
           (o.geschaeftstag + time '08:00') AT TIME ZONE core.geschaefts_zeitzone()       AS beginn,
           ((o.geschaeftstag + 1) + time '08:00') AT TIME ZONE core.geschaefts_zeitzone() AS ende
      FROM core.umsatzprognose_beobachtung o
), tag AS (
    SELECT v.betrieb_key, v.geschaeftstag,
           (array_agg(v.wert ORDER BY v.gesehen_ab DESC, v.abzug_id DESC)
                FILTER (WHERE v.gesehen_ab < v.beginn))[1]               AS vorab_netto,
           max(v.gesehen_ab) FILTER (WHERE v.gesehen_ab < v.beginn)      AS vorab_gesehen_ab,
           (array_agg(v.wert ORDER BY v.gesehen_ab DESC, v.abzug_id DESC)
                FILTER (WHERE v.zuletzt_gesehen_am >= v.ende))[1]        AS nachher_netto,
           bool_or(v.zuletzt_gesehen_am >= v.ende)                       AS hat_nachher,
           max(v.zuletzt_gesehen_am)                                     AS zuletzt_gesehen_am,
           count(*) FILTER (WHERE v.gesehen_ab >= v.beginn)::int         AS wechsel_ab_beginn
      FROM verlauf v
     GROUP BY v.betrieb_key, v.geschaeftstag
)
SELECT t.geschaeftstag,
       date_trunc('month', t.geschaeftstag::timestamp)::date AS monat,
       t.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       bs.konzept                                       AS marke,
       t.vorab_netto,
       t.vorab_gesehen_ab,
       t.nachher_netto,
       t.zuletzt_gesehen_am                             AS nachher_zuletzt_gesehen,
       ((t.zuletzt_gesehen_am AT TIME ZONE core.geschaefts_zeitzone())::date - t.geschaeftstag) AS beobachtet_tage_danach,
       t.wechsel_ab_beginn,
       (t.nachher_netto IS NOT DISTINCT FROM t.vorab_netto) AS unveraendert,
       t.nachher_netto - t.vorab_netto                  AS aenderung_netto,
       CASE WHEN t.vorab_netto > 0
            THEN round((t.nachher_netto - t.vorab_netto) / t.vorab_netto * 100, 2) END AS aenderung_pct,
       (bs.status = 'operativ')                         AS operativ
  FROM tag t
  JOIN core.betrieb b              ON b.betrieb_key = t.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = t.betrieb_key
 WHERE t.vorab_gesehen_ab IS NOT NULL
   AND t.hat_nachher;

COMMENT ON VIEW mart.umsatzprognose_nachher IS
'Koernung: Betrieb × Geschaeftstag — Tage mit echter Vorabprognose (gesehen vor 08:00 des Tages) UND
einer Beobachtung nach Ende des Tages (Folgetag 08:00), 0154: hat LINA den Wert nach dem Tag noch
geaendert? vorab_netto = Stand bei Beginn des Tages, nachher_netto = juengster Wert, der nach dem Tag
gesehen wurde, unveraendert = beide gleich, aenderung_pct in Prozent des Vorabwerts (Prozentzahl).
beobachtet_tage_danach: wie lange nach dem Tag zuletzt hingesehen wurde. wechsel_ab_beginn: wie viele neue
Werte ab Beginn des Tages kamen (auch hin und zurueck, das unveraendert nicht sieht). Je Betrieb
zusammengefasst in mart.umsatzprognose_nachher_betrieb.';
COMMENT ON COLUMN mart.umsatzprognose_nachher.aenderung_netto IS
'nachher_netto - vorab_netto in EUR; positiv = LINA hat nach dem Tag erhoeht.';


CREATE VIEW mart.umsatzprognose_nachher_betrieb AS
WITH betriebe AS (
    SELECT DISTINCT o.betrieb_key FROM core.umsatzprognose_beobachtung o
), m AS (
    SELECT n.betrieb_key,
           count(*)::int                                AS tage,
           count(*) FILTER (WHERE n.unveraendert)::int  AS tage_unveraendert,
           count(*) FILTER (WHERE n.wechsel_ab_beginn > 0)::int AS tage_mit_wechsel,
           avg(abs(n.aenderung_netto))                  AS mittel_abs,
           avg(abs(n.aenderung_pct))                    AS mittel_abs_pct,
           max(abs(n.aenderung_netto))                  AS max_abs,
           avg(n.beobachtet_tage_danach)                AS mittel_abstand,
           max(n.beobachtet_tage_danach)                AS max_abstand,
           min(n.geschaeftstag)                         AS erster_tag,
           max(n.geschaeftstag)                         AS letzter_tag
      FROM mart.umsatzprognose_nachher n
     GROUP BY n.betrieb_key
)
SELECT g.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       bs.konzept                                       AS marke,
       coalesce(m.tage, 0)                              AS tage,
       coalesce(m.tage_unveraendert, 0)                 AS tage_unveraendert,
       round(100.0 * m.tage_unveraendert / nullif(m.tage, 0), 2) AS anteil_unveraendert_pct,
       coalesce(m.tage_mit_wechsel, 0)                  AS tage_mit_wechsel,
       round(m.mittel_abs, 2)                           AS mittlere_abs_aenderung_netto,
       round(m.mittel_abs_pct, 2)                       AS mittlere_abs_aenderung_pct,
       m.max_abs                                        AS groesste_abs_aenderung_netto,
       round(m.mittel_abstand, 1)                       AS mittlerer_abstand_tage,
       m.max_abstand                                    AS groesster_abstand_tage,
       m.erster_tag,
       m.letzter_tag,
       CASE WHEN coalesce(m.tage, 0) = 0                THEN 'noch keine messung'
            WHEN m.tage_unveraendert = m.tage
             AND m.tage_mit_wechsel = 0                 THEN 'unveraendert'
            WHEN m.tage_unveraendert = m.tage           THEN 'wechselt, kehrt zurueck'
            ELSE 'aendert nachtraeglich'
       END                                              AS befund,
       (bs.status = 'operativ')                         AS operativ
  FROM betriebe g
  JOIN core.betrieb b              ON b.betrieb_key = g.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = g.betrieb_key
  LEFT JOIN m                      ON m.betrieb_key = g.betrieb_key;

COMMENT ON VIEW mart.umsatzprognose_nachher_betrieb IS
'Koernung: Betrieb — aendert LINA ihre Umsatzprognose nach dem Tag noch (0154)? Ueber alle Tage mit
echter Vorabprognose und spaeterer Beobachtung (mart.umsatzprognose_nachher): Anteil unveraenderter Tage,
mittlere und groesste Aenderung, wie lange nach dem Tag gemessen wurde. befund: noch keine messung |
unveraendert | wechselt, kehrt zurueck | aendert nachtraeglich. DIE FREIGABE: erst wenn diese Sicht
ueber einige Wochen (Vorschlag: vier) bei allen Betrieben "unveraendert" zeigt, mit groesster_abstand_tage
ueber 28, darf die nachtraeglich geholte Historie (grundlage = nachtraeglich in
mart.umsatzprognose_vorlauf und _guete) als Vergleichsbasis gelten — vorher ist ihre Verzerrung
unbekannt, in beide Richtungen. Gemessen wird nur bis gut fuenf Wochen nach dem Tag; ob LINA Jahre alte
Prognosen anders liefert, misst die Sicht nicht.';
COMMENT ON COLUMN mart.umsatzprognose_nachher_betrieb.anteil_unveraendert_pct IS
'Tage, deren nachher gesehener Wert gleich dem Vorabwert ist, in Prozent der gemessenen Tage (Prozentzahl).';


-- ---------------------------------------------------------------------
-- 7. Wie weit liefert LINA voraus?
--
-- Je Betrieb der juengste FENSTERabzug aus Phase A (bis liegt nicht vor dem
-- Abruftag — die Monate der Historie zaehlen nicht): bis wann gefragt
-- (angefragt_bis, TPAPI_PROGNOSE_TAGE_VORAUS), bis wann geliefert. Der
-- Vorlauf wird wie in mart.umsatzprognose_verlauf gerechnet: der groesste
-- N, fuer den der Abzug zaehlt (Abruf vor (Tag - N) 08:00).
-- ---------------------------------------------------------------------

CREATE VIEW mart.umsatzprognose_horizont AS
WITH letzter AS (
    SELECT DISTINCT ON (s.betrieb_key)
           s.betrieb_key, s.abzug_id, s.abgerufen_am, s.von, s.bis, s.core_stand,
           ((s.abgerufen_am AT TIME ZONE core.geschaefts_zeitzone()) + interval '16 hours')::date AS bezug
      FROM core.tpapi_stammabzug s
     WHERE s.endpunkt = 'tpapi:getforecastperday'
       AND s.bis >= (s.abgerufen_am AT TIME ZONE core.geschaefts_zeitzone())::date
     ORDER BY s.betrieb_key, s.abgerufen_am DESC, s.abzug_id DESC
), geliefert AS (
    SELECT o.zuletzt_abzug_id AS abzug_id, max(o.geschaeftstag) AS geliefert_bis, count(*)::int AS tage
      FROM core.umsatzprognose_beobachtung o
     WHERE o.zuletzt_abzug_id IN (SELECT abzug_id FROM letzter)
     GROUP BY o.zuletzt_abzug_id
), je_betrieb AS (
    SELECT o.betrieb_key,
           max(o.geschaeftstag - ((o.gesehen_ab AT TIME ZONE core.geschaefts_zeitzone())
                                  + interval '16 hours')::date)              AS groesster_vorlauf_tage,
           count(DISTINCT o.geschaeftstag)::int                              AS tage,
           count(DISTINCT o.geschaeftstag) FILTER (WHERE o.vor_beginn)::int  AS tage_mit_vorab,
           min(o.geschaeftstag) FILTER (WHERE o.vor_beginn)                  AS erster_tag_mit_vorab,
           min(o.geschaeftstag)                                              AS erster_tag
      FROM core.umsatzprognose_beobachtung o
     GROUP BY o.betrieb_key
)
SELECT l.betrieb_key,
       b.enc_id,
       b.name                                           AS betrieb,
       bs.konzept                                       AS marke,
       l.abgerufen_am                                   AS letzter_abzug_am,
       l.bis                                            AS angefragt_bis,
       g.geliefert_bis,
       (l.bis - l.bezug)                                AS vorlauf_angefragt_tage,
       (g.geliefert_bis - l.bezug)                      AS vorlauf_geliefert_tage,
       coalesce(g.tage, 0)                              AS tage_im_abzug,
       j.groesster_vorlauf_tage,
       coalesce(j.tage, 0)                              AS tage,
       coalesce(j.tage_mit_vorab, 0)                    AS tage_mit_vorab,
       j.erster_tag,
       j.erster_tag_mit_vorab,
       CASE WHEN l.core_stand IS DISTINCT FROM ld.stand                            THEN 'wartet auf lader'
            WHEN g.geliefert_bis IS NULL                                           THEN 'abzug leer'
            WHEN g.geliefert_bis < (l.abgerufen_am AT TIME ZONE core.geschaefts_zeitzone())::date
                                                                                   THEN 'liefert kein heute'
            WHEN g.geliefert_bis >= l.bis                                          THEN 'liefert bis fensterende'
            ELSE 'liefert kuerzer als gefragt'
       END                                              AS befund,
       (bs.status = 'operativ')                         AS operativ
  FROM letzter l
  JOIN core.betrieb b              ON b.betrieb_key = l.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = l.betrieb_key
  LEFT JOIN sync.tpapi_core_lader ld ON ld.endpunkt = 'tpapi:getforecastperday'
  LEFT JOIN geliefert g            ON g.abzug_id = l.abzug_id
  LEFT JOIN je_betrieb j           ON j.betrieb_key = l.betrieb_key;

COMMENT ON VIEW mart.umsatzprognose_horizont IS
'Koernung: Betrieb — wie weit LINA ihre Umsatzprognose voraus liefert (0154), aus dem juengsten
Fensterabzug von Phase A: angefragt_bis (TPAPI_PROGNOSE_TAGE_VORAUS) gegen geliefert_bis;
vorlauf_geliefert_tage = groesster Vorlauf, fuer den dieser Abzug zaehlt. groesster_vorlauf_tage: der
groesste je gesehene. tage_mit_vorab: wie viele Tage es mit echter Vorabprognose gibt (die Vergleichsbasis
waechst damit jede Nacht um einen Tag je Betrieb). befund: liefert bis fensterende | liefert kuerzer als
gefragt | liefert kein heute (dann gibt es KEINE Vorabprognose — ein Befund) | abzug leer | wartet auf
lader. Nur Betriebe mit Prognoseabzug.';
COMMENT ON COLUMN mart.umsatzprognose_horizont.vorlauf_geliefert_tage IS
'Bis zu welchem Vorlauf N (Tage) der juengste Abzug Werte lieferte: der spaeteste gelieferte Tag minus
den Tag, fuer dessen Vorlauf 0 der Abruf zaehlt. Liegt unter vorlauf_angefragt_tage, liefert LINA nicht
so weit wie gefragt.';


-- ---------------------------------------------------------------------
-- 8. Die Rueckstandssicht: die Historie kommt jetzt zuerst
-- ---------------------------------------------------------------------

COMMENT ON VIEW mart.umsatzprognose_rueckstand IS
'Arbeitsliste der Prognose-Historie (0153, Rang seit 0154): je Betrieb mit Sales Data API jeder
abgeschlossene Monat ab dem ersten Tag in listdays, fuer den LINAs Umsatzprognose noch nicht geholt ist.
Phase C holt einen Aufruf je Monat, seit 0154 VOR allen fehlenden Tagen von Journal, Bons und Personal
(neueste Monate zuerst) — es ist unbekannt, wie lange LINA alte Prognosen vorhaelt, und der Posten ist
klein (rund 3.000 Aufrufe). Muss nach der ersten Nacht auf 0 stehen; danach kommt je Betrieb und
Monatsende ein Monat dazu, der in der naechsten Nacht geholt wird.';


-- ---------------------------------------------------------------------
-- 9a. Pruefuebersicht: liefert der juengste Abzug heute und Zukunft?
--
-- Ohne den heutigen Tag im Abzug vor 08:00 gibt es keine Vorabprognose —
-- dann fehlt die ganze Vergleichsbasis, auch wenn der Abzug "ok" meldet
-- (Regel 10). Kann auf null gehen; steht sie dauerhaft, liefert LINA keine
-- Zukunft, und das ist ein Befund, der sichtbar bleiben soll.
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%umsatzprognose_horizont%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        SELECT 'TPAPI-Prognose: juengster Abzug (48 h) ohne heute oder Zukunft'::text AS pruefung,
               count(*)::bigint AS geprueft,
               count(*) FILTER (WHERE h.befund IN ('abzug leer', 'liefert kein heute'))::bigint AS auffaellig,
               'mart.umsatzprognose_horizont'::text AS sicht
          FROM mart.umsatzprognose_horizont h
         WHERE h.letzter_abzug_am > now() - interval '48 hours'
        $zweig$);

    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def NOT LIKE '%juengster Abzug (48 h) ohne heute oder Zukunft%' THEN
        RAISE EXCEPTION '0154: mart.pruefung_uebersicht traegt nach dem Umbau die Prognosezeile nicht';
    END IF;
END $aussen$;


-- ---------------------------------------------------------------------
-- 9b. MCP-Katalog: Koernung, Fallstricke, Rechte, Leseprobe
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.umsatzprognose_verlauf',
     'Betrieb × Geschaeftstag × Wert — Verlauf von LINAs Umsatzprognose, eine Zeile je neuem Wert',
     'umsatz', false),
    ('mart.umsatzprognose_vorlauf',
     'Betrieb × Geschaeftstag × Vorlauf (0/1/2/3/7/14/28, dazu nachtraeglich) — LINAs Prognose gegen Ist; nur mit Filter auf vorlauf_tage bzw. grundlage summieren',
     'umsatz', true),
    ('mart.umsatzprognose_guete',
     'Betrieb × Monat × Grundlage × Vorlauf — MAE, MAPE, WAPE, Bias von LINAs Prognose; aus den summe_-Spalten neu rechnen',
     'umsatz', false),
    ('mart.umsatzprognose_nachher',
     'Betrieb × Geschaeftstag — Vorabwert gegen den nach dem Tag gesehenen Wert (aendert LINA nachtraeglich?)',
     'pruefung', false),
    ('mart.umsatzprognose_nachher_betrieb',
     'Betrieb — Anteil Tage, an denen LINA die Prognose nach dem Tag nicht geaendert hat; Freigabe der Historie',
     'pruefung', false),
    ('mart.umsatzprognose_horizont',
     'Betrieb — wie weit LINA die Prognose voraus liefert, Tage mit Vorabprognose',
     'import', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

-- Nur Regelarten, die mcp/src/pruefen.ts kennt (deutung, filter_noetig).
INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle)
VALUES
  ('umsatzprognose_vorlauf_nachtraeglich', 'deutung', 'warnung', 'mart.umsatzprognose_vorlauf', '{}'::jsonb,
   'Zeilen mit grundlage = nachtraeglich sind Werte, die erst NACH dem Tag gesehen wurden (vor allem die '
   'Historie vor dem ersten Lauf). Ob LINA sie nachtraeglich angepasst hat, ist nicht gemessen; eine '
   'Trefferquote daraus kann in beide Richtungen verzerrt sein. Die Prognose ist LINAs Zahl, nur fuer '
   'Betriebe mit TPAPI-Schluessel.',
   'Fuer die Guete grundlage = ''vorab'' und einen festen vorlauf_tage nehmen und das sagen. Nachtraegliche '
   'Werte erst verwenden, wenn mart.umsatzprognose_nachher_betrieb ueber Wochen befund = ''unveraendert'' '
   'zeigt — und dann den Stand dieser Sicht nennen.',
   '0154'),
  ('umsatzprognose_vorlauf_mehrfach', 'filter_noetig', 'warnung', 'mart.umsatzprognose_vorlauf',
   '{"spalte": "vorlauf_tage", "beispiel": "vorlauf_tage = 1"}'::jsonb,
   'Jeder Tag steht in mart.umsatzprognose_vorlauf bis zu achtmal: je Vorlauf (0, 1, 2, 3, 7, 14, 28) und '
   'einmal nachtraeglich. Eine Summe oder Zaehlung ohne Filter auf vorlauf_tage zaehlt Ist und Prognose '
   'mehrfach und mischt Vorlaeufe.',
   'Auf einen Vorlauf filtern (vorlauf_tage = 1) oder nach vorlauf_tage gruppieren; fuer nachtraeglich '
   'grundlage = ''nachtraeglich'' (vorlauf_tage ist dort NULL).',
   '0154'),
  ('umsatzprognose_vorlauf_vergleichbar', 'filter_noetig', 'warnung', 'mart.umsatzprognose_vorlauf',
   '{"spalte": "vergleichbar", "wert": true}'::jsonb,
   'Nicht jeder Tag vertraegt eine Fehlerrechnung: geschlossene Tage (Ist 0), Tage ohne Ist, mit '
   'Kassen-Fehleingabe, mit noch offenem Ist (juenger als 7 Tage) und nicht operative Betriebe. Mit ihnen '
   'werden MAPE und WAPE sinnlos (Teilung durch 0, Fehler von 100 %).',
   'Fuer Fehlermasse vergleichbar = true filtern und die Zahl der ausgeschlossenen Tage nennen '
   '(ausschluss_grund) — oder gleich mart.umsatzprognose_guete nehmen.',
   '0154'),
  ('umsatzprognose_guete_nachtraeglich', 'deutung', 'warnung', 'mart.umsatzprognose_guete', '{}'::jsonb,
   'Die Guete gibt es getrennt nach grundlage: vorab (echte Vorabprognose, vorlauf_tage 0 bis 28) und '
   'nachtraeglich (vorlauf_tage NULL, erst nach dem Tag gesehen). Ob LINA nachtraeglich geholte Werte '
   'angepasst hat, ist nicht gemessen; ihre Guete ist bis zur Freigabe keine Aussage ueber LINAs Prognose. '
   'MAPE und WAPE sind Prozentzahlen und lassen sich nicht mitteln.',
   'Fuer Aussagen ueber LINAs Prognose grundlage = ''vorab'' und einen vorlauf_tage nehmen. Ueber Monate, '
   'Betriebe oder Marken aus den summe_-Spalten neu rechnen (WAPE = sum(summe_fehler_abs_netto) / '
   'sum(summe_ist_netto) * 100). Nachtraegliche Werte erst nach Freigabe in '
   'mart.umsatzprognose_nachher_betrieb, und den Stand dieser Sicht nennen.',
   '0154'),
  ('umsatzprognose_guete_vorlauf', 'filter_noetig', 'warnung', 'mart.umsatzprognose_guete',
   '{"spalte": "vorlauf_tage", "beispiel": "vorlauf_tage = 1"}'::jsonb,
   'mart.umsatzprognose_guete hat je Betrieb und Monat eine Zeile je Vorlauf und Grundlage. Eine Summe der '
   'Tage oder des Ist ueber alle Zeilen zaehlt jeden Tag bis zu achtmal.',
   'Auf einen Vorlauf filtern oder nach vorlauf_tage und grundlage gruppieren.',
   '0154'),
  ('umsatzprognose_nachher_freigabe', 'deutung', 'warnung', 'mart.umsatzprognose_nachher_betrieb', '{}'::jsonb,
   'Die Sicht misst nur, ob LINA eine Prognose bis gut fuenf Wochen nach dem Tag aendert. Ob LINA Jahre '
   'alte Prognosen so liefert, wie sie damals ausgegeben wurden, misst sie nicht.',
   'Den Befund mit groesster_abstand_tage und dem Zeitraum (erster_tag, letzter_tag) nennen; fuer die '
   'Historie von vor dem ersten Lauf die Einschraenkung dazusagen.',
   '0154')
ON CONFLICT (schluessel) DO UPDATE
   SET art = excluded.art, schwere = excluded.schwere, sicht = excluded.sicht,
       parameter = excluded.parameter, hinweis = excluded.hinweis,
       berichtigung = excluded.berichtigung, quelle = excluded.quelle;

-- Der Fallstrick aus 0153 verweist jetzt auf die Messung.
UPDATE mcp.fallstrick
   SET berichtigung = 'Fuer die Guete der Prognose nur prognose_grundlage = ''vorab'' auswerten und das sagen; '
                      'Abweichungen aus den Summen neu rechnen, nicht abweichung_pct mitteln. Fuer den '
                      'Vergleich je Vorlauf mart.umsatzprognose_vorlauf bzw. mart.umsatzprognose_guete; ob '
                      'LINA nachtraeglich aendert, misst mart.umsatzprognose_nachher_betrieb.',
       quelle = '0153, 0154'
 WHERE schluessel = 'umsatzprognose_ist_lina';

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

-- Seit 0153 vergibt die Funktion im Schema mcp nur den Katalog.
SELECT mcp.rechte_auffrischen();

-- Die Gegenprobe als Leserolle (Pflicht seit 0110): SELECT * … LIMIT 1, nicht
-- count(*). Und die Rechtepruefung aus 0148 muss leer sein.
DO $probe$
DECLARE
    v_abfrage text;
    v_liegen  text[] := '{}';
    v_rechte  int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0154 ist uebersprungen';
        RETURN;
    END IF;

    SELECT count(*) INTO v_rechte FROM mart.mcp_rechte_pruefung;
    IF v_rechte > 0 THEN
        RAISE EXCEPTION '0154: mart.mcp_rechte_pruefung ist nicht leer (% Zeilen)', v_rechte;
    END IF;

    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0154 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_abfrage IN ARRAY ARRAY[
        'SELECT * FROM mart.umsatzprognose_verlauf WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.umsatzprognose_vorlauf WHERE geschaeftstag >= current_date - 3 LIMIT 1',
        'SELECT * FROM mart.umsatzprognose_guete WHERE monat = date_trunc(''month'', current_date)::date LIMIT 1',
        'SELECT * FROM mart.umsatzprognose_nachher LIMIT 1',
        'SELECT * FROM mart.umsatzprognose_nachher_betrieb LIMIT 1',
        'SELECT * FROM mart.umsatzprognose_horizont LIMIT 1',
        'SELECT * FROM mart.umsatzprognose_rueckstand LIMIT 1',
        'SELECT * FROM mart.pruefung_uebersicht WHERE sicht = ''mart.umsatzprognose_horizont''']
    LOOP
        BEGIN
            EXECUTE v_abfrage;
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_abfrage, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    BEGIN
        EXECUTE 'SELECT * FROM core.umsatzprognose_beobachtung LIMIT 1';
        v_liegen := v_liegen || 'core.umsatzprognose_beobachtung ist fuer mcp_leser lesbar'::text;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0154 hat sein Ziel nicht erreicht — fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
