-- =====================================================================
-- 0125 Das Wetter merkt Lücken im laufenden Jahr, die Adresse kommt aus
--      LINA, Betriebe mit fremder Kasse heißen so — und der Datenstand
--      zählt nur Tage mit Umsatz
--
-- ANLASS (29.09.2026). Eine Auswertung über den MCP-Zugang (Stand
-- 23.09.2026) zeigte Lücken, die keine Prüfung gemeldet hatte. Jede ist am
-- Code und an der Produktion nachgeprüft; die Befunde stehen in
-- docs/fehlerkatalog.md (29.09.2026).
--
-- 1. WETTER. Jan–Jul 2026 fehlten für alle 48 Gitterpunkte: 96 Stunden im
--    Januar, dann nichts bis zum 06.08. mart.wetter_rueckstand gab dem
--    laufenden Jahr den Zustand 'laufendes Jahr', und der Nachlauf holt nur
--    'fehlt' und 'unvollstaendig' (src/wetter/nachlauf.ts). Beim ersten Lauf
--    am 20.08. hatte 2026 schon Stunden aus dem 14-Tage-Fenster — es war nie
--    'fehlt'. Die Prüfzeile „Backfill-Rueckstand" stand dabei auf 0.
--    Dazu: ein vergangenes Jahr galt ab 8.000 Stunden als vollständig — eine
--    fehlende Woche (168 Stunden) wäre nie aufgefallen.
--    JETZT zählt die Sicht zusätzlich fehlende TAGE je Gitterpunkt über die
--    letzten 24 Monate bis vorgestern, auch im laufenden Jahr. Ein Ortsjahr
--    mit einem fehlenden Tag ist 'unvollstaendig' und wird neu geholt.
--    Fehlend heißt: keine einzige Stunde an diesem Tag. Einzelne fehlende
--    Stunden sind Messlücken des DWD (2023-02 an einem Punkt: 4 Stunden) —
--    die kämen auch beim nächsten Abruf nicht, und die Sicht holte sonst
--    jede Nacht dasselbe Jahr.
--
-- 2. ADRESSE. manual.betrieb_standort war für 60 von 141 Betrieben gepflegt,
--    alle aus Yext; sieben operative fehlten, darunter der umsatzstärkste.
--    docs/befunde-datenlage.md sagte, LINA liefere keine Betriebsadresse —
--    das galt für die Berichtsendpunkte. Das Stammdatenblatt der Ladenakte
--    (la:stammdaten, liegt seit 0053 in raw) hat eine Zeile „Adresse", für
--    alle 141. Gegen Yext geprüft: bei 58 von 60 dieselbe PLZ, die zwei
--    Abweichungen sind Fehler in LINA (Aposto Wuppertal trägt die Adresse
--    von Enchilada Wuppertal, Viernheim eine Heidelberger). Deshalb:
--    core.betrieb_adresse hält, was LINA sagt; in manual.betrieb_standort
--    kommt es nur, wo weder Yext noch die Pflege etwas eingetragen hat
--    (src/standort/ergaenzen.ts). Die Tabelle füllt der Nachtlauf aus raw.
--
-- 3. FREMDE KASSE. Enchilada Bremen, Leipzig, Minden, Aposto Wuppertal,
--    Ratskeller Augsburg und Wilma Wunder Ballplatz Mainz standen als
--    'ohne_geschaeft' — sie haben in LINA nie Umsatz gemeldet. Sie arbeiten
--    aber: FoodNotify-Bestellungen bis in die letzte Woche, gebuchte BWA bis
--    07/08-2026, aktuelle Bewertungen. Ihre Kasse ist nicht LINA/Amadeus
--    (Wuppertal: ikentoo). Neuer Status 'fremdkasse' (Entscheidung Eugene,
--    29.09.2026): kein LINA-Umsatz je, aber FoodNotify-Bestellung in 60
--    Tagen oder gebuchte BWA in den letzten vier Monaten. In Produktion
--    vorab geprüft: trifft genau diese sechs.
--    Sie zählen in den Bewertungs- und BWA-Sichten mit (dort gibt es für sie
--    Daten), NICHT in Umsatz-, Kassen- und Einkaufsvergleichen.
--
-- 4. DATENSTAND. LINA liefert für jeden nicht operativen Betrieb jeden Tag
--    eine Zeile mit 0,00 € (1.131 in 30 Tagen, alle genau null).
--    mart.datenstand nahm max(geschaeftstag) über alle Zeilen — damit stand
--    jeder geschlossene Betrieb auf „bis gestern", und zwei operative Fälle
--    waren unsichtbar: Enchilada Aalen ohne Umsatz seit 02.08.2026, Aposto
--    Augsburg seit 13.09.2026. Jetzt zählen nur Tage mit Umsatz > 0; der
--    Ladestand steht daneben (letzter_geladener_tag).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. mart.wetter_rueckstand (Definition aus 0086; neu sind tagesfenster,
--    vorhanden, luecke und die Spalte fehlende_tage am Ende)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.wetter_rueckstand AS
WITH jahre AS (
    SELECT generate_series(
             extract(year FROM (SELECT min(geschaeftstag) FROM mart.umsatz_tag))::int,
             extract(year FROM current_date)::int) AS jahr
), soll AS (
    SELECT o.breite, o.laenge, j.jahr
      FROM mart.wetter_ort o
     CROSS JOIN jahre j
), ist AS (
    SELECT w.breite, w.laenge,
           extract(year FROM (w.zeitpunkt AT TIME ZONE 'Europe/Berlin'))::int AS jahr,
           count(*)::int AS stunden
      FROM manual.wetter_stunde w
     GROUP BY 1, 2, 3
), tagesfenster AS (
    -- 24 Monate bis vorgestern. Gestern kann um 05:02 noch unvollständig
    -- sein; das 14-Tage-Fenster holt es in der nächsten Nacht ohnehin.
    SELECT greatest((date_trunc('month', current_date) - interval '24 months')::date,
                    (SELECT min(geschaeftstag) FROM mart.umsatz_tag)) AS von,
           current_date - 2                                        AS bis
), vorhanden AS (
    SELECT w.breite, w.laenge, (w.zeitpunkt AT TIME ZONE 'Europe/Berlin')::date AS tag
      FROM manual.wetter_stunde w
     WHERE w.zeitpunkt >= (SELECT von FROM tagesfenster)::timestamp AT TIME ZONE 'Europe/Berlin'
     GROUP BY 1, 2, 3
), luecke AS (
    SELECT o.breite, o.laenge, extract(year FROM d)::int AS jahr, count(*)::int AS fehlende_tage
      FROM mart.wetter_ort o
     CROSS JOIN tagesfenster f
     CROSS JOIN LATERAL generate_series(f.von, f.bis, interval '1 day') d
      LEFT JOIN vorhanden v
             ON v.breite = o.breite AND v.laenge = o.laenge AND v.tag = d::date
     WHERE v.tag IS NULL
     GROUP BY 1, 2, 3
)
SELECT s.breite,
       s.laenge,
       s.jahr,
       coalesce(i.stunden, 0) AS stunden,
       CASE WHEN i.stunden IS NULL                                  THEN 'fehlt'
            WHEN coalesce(l.fehlende_tage, 0) > 0                   THEN 'unvollstaendig'
            WHEN s.jahr = extract(year FROM current_date)::int      THEN 'laufendes Jahr'
            WHEN i.stunden < 8000                                   THEN 'unvollstaendig'
            ELSE 'vollstaendig'
       END AS zustand,
       coalesce(l.fehlende_tage, 0) AS fehlende_tage
  FROM soll s
  LEFT JOIN ist i    ON i.breite = s.breite AND i.laenge = s.laenge AND i.jahr = s.jahr
  LEFT JOIN luecke l ON l.breite = s.breite AND l.laenge = s.laenge AND l.jahr = s.jahr;

COMMENT ON VIEW mart.wetter_rueckstand IS
'Arbeitsliste des Wetter-Backfills: eine Zeile je Gitterpunkt und Jahr. zustand fehlt |
unvollstaendig | laufendes Jahr | vollstaendig. Der Nachlauf holt fehlt und unvollstaendig,
ein Ortsjahr je Aufruf. Seit 0125 ist ein Jahr auch dann unvollstaendig, wenn in den letzten
24 Monaten bis vorgestern ein ganzer Tag fehlt (fehlende_tage) — vorher galt das laufende Jahr
nie als Rueckstand, und Jan–Jul 2026 fehlten sieben Monate lang unbemerkt.';


-- ---------------------------------------------------------------------
-- 2. core.betrieb_adresse — was das LINA-Stammdatenblatt sagt
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.betrieb_adresse (
    betrieb_key   integer PRIMARY KEY REFERENCES core.betrieb(betrieb_key),
    name_zeile    text,
    strasse       text,
    plz           text,
    ort           text,
    roh           text        NOT NULL,
    abgerufen_am  timestamptz NOT NULL,
    raw_id        bigint,
    geladen_am    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.betrieb_adresse IS
'Anschrift je Betrieb aus dem Stammdatenblatt der Ladenakte (la:stammdaten, Zeile "Adresse"),
jeweils der juengste Abruf. Aus raw neu aufbaubar (src/standort/adresse.ts). KEINE Koordinate —
die kommt aus Yext oder aus dem Geocoding (src/standort/ergaenzen.ts). Nicht blind uebernehmen:
am 29.09.2026 gegen Yext geprueft, 58 von 60 PLZ gleich; Aposto Wuppertal trug die Adresse von
Enchilada Wuppertal, Viernheim eine Heidelberger. Deshalb gilt Yext vor LINA.';
COMMENT ON COLUMN core.betrieb_adresse.name_zeile IS 'Erste Zeile der Anschrift, meist die Gesellschaft.';
COMMENT ON COLUMN core.betrieb_adresse.roh        IS 'Alle Zeilen der Anschrift, mit " / " verbunden — fuer den Fall, dass die Zerlegung danebenliegt.';


-- ---------------------------------------------------------------------
-- 3. mart.betrieb_status mit 'fremdkasse' (Definition aus 0039; neu ist
--    der Zweig vor 'ohne_geschaeft')
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.betrieb_status AS
WITH letzter AS (
    SELECT betrieb_key, max(geschaeftstag) AS letzter_umsatztag
      FROM core.umsatzbericht_tag
     WHERE umsatz_netto > 0
       AND hauptsparte_key IS NULL AND verkaufsstelle_key IS NULL
     GROUP BY betrieb_key
)
SELECT b.betrieb_key,
       b.name AS betrieb,
       kz.hauptkonzept AS konzept,
       u.letzter_umsatztag,
       CASE
         WHEN b.name ~* 'testladen|zav[ -]?test'                        THEN 'test'
         WHEN kz.hauptkonzept = 'Franchisegebergesellschaften'
              OR b.name ~* 'franchise (gmbh|ag)|^concept family'         THEN 'verwaltend'
         WHEN b.name ~* '^\s*(geschlossen|insolvent)'
              OR kz.hauptkonzept = 'Enchi-Gruppe geschlossene'           THEN 'geschlossen'
         -- 0125: nie LINA-Umsatz, aber sichtbar im Geschäft. Die Kasse läuft
         -- woanders; Umsatz und Artikel kann es aus LINA nicht geben.
         WHEN u.letzter_umsatztag IS NULL
              AND (EXISTS (SELECT 1
                             FROM core.bestellung be
                             JOIN core.kostenstelle ks ON ks.kostenstelle_key = be.kostenstelle_key
                            WHERE ks.betrieb_key = b.betrieb_key
                              AND be.bestellt_am >= current_date - 60)
                   OR EXISTS (SELECT 1
                                FROM core.kennzahlen_monat km
                               WHERE km.betrieb_key = b.betrieb_key
                                 AND km.wert_absolut::numeric(14,2) <> 0
                                 AND km.monat >= (date_trunc('month', current_date) - interval '4 months')::date
                                 AND km.monat <= current_date))           THEN 'fremdkasse'
         WHEN u.letzter_umsatztag IS NULL                                THEN 'ohne_geschaeft'
         WHEN u.letzter_umsatztag < current_date - 60                    THEN 'inaktiv'
         ELSE 'operativ'
       END AS status
  FROM core.betrieb b
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = b.betrieb_key
  LEFT JOIN letzter u ON u.betrieb_key = b.betrieb_key;

COMMENT ON VIEW mart.betrieb_status IS
'Betriebsstatus aus Namen, Konzept und Umsatz: test | verwaltend | geschlossen | fremdkasse |
ohne_geschaeft | inaktiv | operativ. fremdkasse (0125): nie Umsatz in LINA, aber FoodNotify-
Bestellung in 60 Tagen oder gebuchte BWA in den letzten vier Monaten — die Kasse laeuft nicht
ueber LINA. Solche Betriebe zaehlen in Bewertungs- und BWA-Sichten, nicht in Umsatzvergleichen.
operativ heisst: Umsatz in LINA in den letzten 60 Tagen.';


-- ---------------------------------------------------------------------
-- 4. Bewertungs- und BWA-Sichten nehmen 'fremdkasse' mit
--
-- Zehn Sichten, je genau eine Stelle `status = 'operativ'`. Umgeschrieben
-- wird die gespeicherte Definition, nicht eine abgeschriebene: die Sichten
-- stammen aus 0050 und 0054 und wurden seitdem nicht neu definiert, aber
-- eine Kopie hier wäre die dritte Fassung derselben Sicht. Die Probe
-- „genau eine Fundstelle" bricht ab, wenn jemand die Sicht umgebaut hat.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v      text;
    d      text;
    alt    constant text := 'status = ''operativ''::text';
    neu    constant text := 'status = ANY (ARRAY[''operativ''::text, ''fremdkasse''::text])';
BEGIN
    FOREACH v IN ARRAY ARRAY[
        'mart.bwa_longterm', 'mart.bwa_longterm_stand', 'mart.bwa_plan_ist',
        'mart.bwa_quellen_vergleich',
        'mart.bewertung_thema', 'mart.bewertung_thema_monat', 'mart.bewertung_antwort',
        'mart.betrieb_sichtbarkeit', 'mart.bewertung_note', 'mart.bewertung_fehlend']
    LOOP
        d := pg_get_viewdef(v::regclass, true);
        IF (length(d) - length(replace(d, alt, ''))) / length(alt) <> 1 THEN
            RAISE EXCEPTION '0125: % enthaelt "%" nicht genau einmal — Sicht wurde umgebaut, von Hand anpassen', v, alt;
        END IF;
        EXECUTE format('CREATE OR REPLACE VIEW %s AS %s', v, replace(d, alt, neu));
    END LOOP;
END $$;


-- ---------------------------------------------------------------------
-- 5. mart.datenstand (Definition aus 0124; neu: letzter_tag nur aus Tagen
--    mit Umsatz, der Befund kennt den Status, zwei Spalten am Ende)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.datenstand AS
SELECT b.name          AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       b.aktiv,
       b.hat_bwa,
       (b.lina_betrieb_id IS NOT NULL) AS bwa_bruecke,
       u.erster_tag,
       u.letzter_tag,
       u.tage                          AS umsatztage,
       (current_date - u.letzter_tag)  AS umsatz_alter_tage,
       k.letzter_gebuchter_monat       AS bwa_monat,
       CASE WHEN k.letzter_gebuchter_monat IS NOT NULL
            THEN (date_part('year',  age(date_trunc('month', current_date)::date,
                                          k.letzter_gebuchter_monat)) * 12
                + date_part('month', age(date_trunc('month', current_date)::date,
                                          k.letzter_gebuchter_monat)))::int
       END                             AS bwa_verzug_monate,
       coalesce(a.artikeltage, 0)      AS artikeltage,
       a.letzter_artikeltag,
       p.letzter_personaltag,
       CASE WHEN bs.status IN ('geschlossen', 'verwaltend', 'test', 'ohne_geschaeft')
                                                             THEN 'kein laufender Betrieb'
            -- Fremde Kasse: Umsatz und Artikel gibt es aus LINA nicht, die BWA schon.
            WHEN bs.status = 'fremdkasse'
                 THEN CASE WHEN k.letzter_gebuchter_monat IS NULL THEN 'keine BWA gebucht'
                           ELSE 'fremde Kasse' END
            WHEN u.letzter_tag IS NULL                       THEN 'kein Umsatz geladen'
            -- > 8, nicht > 3: LINA fuellt die juengsten 5-6 Tage nach,
            -- ein "veraltet" unterhalb dessen ist Bauart, kein Befund.
            WHEN current_date - u.letzter_tag > 8             THEN 'Umsatz veraltet'
            WHEN k.letzter_gebuchter_monat IS NULL            THEN 'keine BWA gebucht'
            WHEN coalesce(a.artikeltage, 0) = 0               THEN 'keine Artikeldaten'
            ELSE 'vollstaendig'
       END                             AS befund,
       b.betrieb_key,
       u.letzter_geladener_tag,
       bs.status
  FROM core.betrieb b
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = b.betrieb_key
  LEFT JOIN mart.betrieb_status bs    ON bs.betrieb_key = b.betrieb_key
  -- 0125: nur Tage mit Umsatz. LINA liefert fuer jeden Betrieb jeden Tag eine
  -- Zeile, auch 0,00 EUR — der geladene Stand steht in letzter_geladener_tag.
  LEFT JOIN LATERAL (
        SELECT min(geschaeftstag) FILTER (WHERE t.umsatz_netto > 0) AS erster_tag,
               max(geschaeftstag) FILTER (WHERE t.umsatz_netto > 0) AS letzter_tag,
               (count(*) FILTER (WHERE t.umsatz_netto > 0))::int    AS tage,
               max(geschaeftstag)                                   AS letzter_geladener_tag
          FROM core.umsatzbericht_tag t
         WHERE t.betrieb_key = b.betrieb_key
           AND t.hauptsparte_key IS NULL AND t.verkaufsstelle_key IS NULL
  ) u ON true
  LEFT JOIN LATERAL (
        WITH RECURSIVE kandidat(monat) AS (
              SELECT max(km.monat)
                FROM core.kennzahlen_monat km
               WHERE km.betrieb_key = b.betrieb_key
                 AND km.wert_absolut::numeric(14,2) <> 0
            UNION ALL
              SELECT (SELECT max(km.monat)
                        FROM core.kennzahlen_monat km
                       WHERE km.betrieb_key = b.betrieb_key
                         AND km.wert_absolut::numeric(14,2) <> 0
                         AND km.monat < kandidat.monat)
                FROM kandidat
               WHERE kandidat.monat IS NOT NULL
        )
        SELECT kandidat.monat AS letzter_gebuchter_monat
          FROM kandidat
         WHERE kandidat.monat IS NOT NULL
           AND EXISTS (
                 SELECT 1
                   FROM (SELECT DISTINCT ON (km.kennzahl) km.wert_absolut
                           FROM core.kennzahlen_monat km
                          WHERE km.betrieb_key = b.betrieb_key
                            AND km.monat = kandidat.monat
                            AND km.wert_absolut IS NOT NULL
                          ORDER BY km.kennzahl, km.abgerufen_am DESC) juengster
                  WHERE juengster.wert_absolut::numeric(14,2) <> 0)
         LIMIT 1
  ) k ON true
  LEFT JOIN mart.artikeltage_basis a ON a.betrieb_key = b.betrieb_key
  LEFT JOIN LATERAL (
        SELECT max(zeitraum_bis) AS letzter_personaltag
          FROM core.personalkosten pk
         WHERE pk.betrieb_key = b.betrieb_key
  ) p ON true;

COMMENT ON COLUMN mart.datenstand.letzter_tag IS
'Letzter Geschaeftstag mit Umsatz > 0 (seit 0125). Vorher der letzte GELADENE Tag — LINA liefert
auch fuer geschlossene Betriebe taeglich 0,00 EUR, und jeder stand auf "bis gestern".';
COMMENT ON COLUMN mart.datenstand.letzter_geladener_tag IS
'Letzter Tag, fuer den der Umsatzbericht eine Zeile hat, auch mit 0,00 EUR. Sagt, wie weit
geladen ist — nicht, bis wann der Betrieb Umsatz hatte.';
COMMENT ON COLUMN mart.datenstand.befund IS
'kein laufender Betrieb | fremde Kasse | kein Umsatz geladen | Umsatz veraltet | keine BWA gebucht |
keine Artikeldaten | vollstaendig. "kein laufender Betrieb" (geschlossen, verwaltend, Test, nie
Umsatz) ist kein Rueckstand; "fremde Kasse" heisst: Umsatz und Artikel kommen nicht aus LINA.';


-- ---------------------------------------------------------------------
-- 6. Probe: beide Sichten fuer mcp_leser lesbar
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        SET LOCAL ROLE mcp_leser;
        PERFORM 1 FROM mart.datenstand LIMIT 1;
        PERFORM 1 FROM mart.betrieb_status LIMIT 1;
        RESET ROLE;
    END IF;
EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION '0125: mart.datenstand/betrieb_status fuer mcp_leser nicht lesbar (%: %)', SQLSTATE, SQLERRM;
END $$;
