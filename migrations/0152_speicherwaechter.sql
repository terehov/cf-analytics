-- =====================================================================
-- 0152 Der Speicherwaechter: wie viel ist frei, wie schnell waechst es,
--      wann ist es voll
--
-- ANLASS (12.11.2026). Eugene will rechtzeitig wissen, wann der Server
-- hochskaliert werden muss. Der Server (Hetzner CX43) hat EINE Platte:
-- 150 GB, am 12.11.2026 46 GB belegt, 99 GB frei (df -h auf dem Host).
-- Postgres, Docker-Images, Build-Cache und Logs liegen auf demselben
-- Dateisystem. Seit heute laeuft der TPAPI-Rohabzug (0151), der ueber etwa
-- zwei Wochen geschaetzt 12-45 GB dazulegt; Schritt 2b baut Tabellen
-- aehnlicher Groesse daneben. Bis hierher gab es keine einzige Zahl dazu in
-- der Datenbank — nur ein df -h, das jemand von Hand tippen musste.
--
-- WAS DIESE MIGRATION ANLEGT
--   1. sync.speicher_messung — eine Zeile je Nachtlauf: Platte (gesamt,
--      belegt, frei), Datenbank, raw, je Schema, die zehn groessten Brocken.
--      Geschrieben von src/sync/speicher.ts am Ende des Laufs.
--   2. mart.speicher_stand   — EINE Zeile: der juengste Stand, Verbrauch je
--      Tag, Tage und Datum bis zur Warnschwelle und bis voll, ein befund.
--   3. mart.speicher_verlauf — eine Zeile je Messung, fuer die Verlaufskarte.
--   4. eine Pruefzeile in mart.pruefung_uebersicht (normal 0).
--   5. MCP-Katalog, Rechte, Leseprobe als mcp_leser.
--
-- DIE SCHWELLEN (Begruendung in docs/entscheidungen.md, 12.11.2026) stehen
-- als Konstanten in mart.speicher_stand und werden als Spalten mitgeliefert.
-- Bewusst KEINE Parametertabelle in manual: die Werte folgen aus dem, was
-- PostgreSQL und ein Umzug an Luft brauchen, nicht aus einer fachlichen
-- Vorliebe — und eine Tabelle, die man in Postico aendern kann, laedt dazu
-- ein, einen laestigen Alarm still leiser zu drehen. Wer sie aendert,
-- schreibt eine Migration und die Begruendung dazu (wie Regel 3 fuer das
-- Anfragetempo). Prozentschwellen skalieren mit der Platte: nach einem
-- Hochskalieren muss niemand etwas anpassen.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die Messung
--
-- APPEND-ONLY, UND ES WIRD NIE GELOESCHT. Eine Zeile je Lauf sind rund
-- 365 Zeilen im Jahr mit zwei kleinen jsonb — wenige hundert Kilobyte. Die
-- Reihe ist dafuer die einzige Antwort auf "seit wann waechst das so?", und
-- genau die Frage stellt man, nachdem es eng geworden ist.
--
-- lauf_id OHNE Fremdschluessel auf sync.lauf: mehrere Tests leeren sync.lauf
-- per TRUNCATE ohne CASCADE (src/sync/phasen.test.ts), und ein Fremdschluessel
-- liesse das scheitern. Fuer die Messung ist der Lauf ohnehin nur ein Hinweis.
--
-- Die Platte darf fehlen (statfs gescheitert): dann stehen die drei
-- Plattenspalten auf NULL und platte_fehler sagt warum. Die Datenbankgroesse
-- wird trotzdem geschrieben — eine halbe Messung ist mehr als keine.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sync.speicher_messung (
    messung_id     bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gemessen_am    timestamptz  NOT NULL DEFAULT now(),
    lauf_id        bigint,
    pfad           text         NOT NULL,
    platte_gesamt  bigint       CHECK (platte_gesamt > 0),
    platte_belegt  bigint       CHECK (platte_belegt >= 0),
    platte_frei    bigint       CHECK (platte_frei >= 0),
    platte_fehler  text,
    db_bytes       bigint       NOT NULL CHECK (db_bytes >= 0),
    raw_bytes      bigint       NOT NULL CHECK (raw_bytes >= 0),
    je_schema      jsonb        NOT NULL DEFAULT '{}'::jsonb,
    groesste       jsonb        NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT speicher_messung_platte_vollstaendig
        CHECK ((platte_gesamt IS NULL) = (platte_frei IS NULL)
           AND (platte_gesamt IS NULL) = (platte_belegt IS NULL))
);

CREATE INDEX IF NOT EXISTS speicher_messung_gemessen_am
    ON sync.speicher_messung (gemessen_am DESC);

COMMENT ON TABLE sync.speicher_messung IS
'Speicherwaechter (0152): eine Zeile je Nachtlauf, geschrieben am Laufende von src/sync/speicher.ts.
Platte ueber statfs(SPEICHER_PFAD, Vorgabe /) im Importer-Container, Datenbank ueber
pg_database_size. Append-only, nichts wird geloescht (eine Zeile je Tag). Auswertung:
mart.speicher_stand (juengster Stand, Prognose, befund) und mart.speicher_verlauf.';
COMMENT ON COLUMN sync.speicher_messung.lauf_id IS
'Der Lauf, an dessen Ende gemessen wurde (sync.lauf.lauf_id); NULL bei einer Messung ausserhalb
eines Laufs oder wenn der Lauf vor dem Oeffnen abbrach. Bewusst ohne Fremdschluessel.';
COMMENT ON COLUMN sync.speicher_messung.pfad IS
'Der gemessene Pfad im Importer-Container (SPEICHER_PFAD). ANNAHME: das Overlay-Dateisystem des
Containers liegt auf derselben Host-Platte wie das Postgres-Volume und meldet deren Groesse. Gilt
nicht mehr, sobald die Datenbank auf einem eigenen Volume oder Server liegt — dann zeigt
mart.speicher_stand den befund falsche platte, wenn die Datenbank groesser ist als der belegte Teil.';
COMMENT ON COLUMN sync.speicher_messung.platte_gesamt IS
'Groesse des Dateisystems in Bytes (blocks x frsize) — wie Size in df.';
COMMENT ON COLUMN sync.speicher_messung.platte_belegt IS
'Belegt in Bytes ((blocks - bfree) x frsize) — wie Used in df.';
COMMENT ON COLUMN sync.speicher_messung.platte_frei IS
'Frei fuer Prozesse ohne Root-Rechte in Bytes (bavail x frsize) — wie Avail in df. Das ist der Platz,
den PostgreSQL tatsaechlich hat; die Root-Reserve des Dateisystems (ext4: 5 %) zaehlt nicht mit.';
COMMENT ON COLUMN sync.speicher_messung.platte_fehler IS
'Warum statfs scheiterte (dann sind die drei Plattenspalten NULL); sonst NULL.';
COMMENT ON COLUMN sync.speicher_messung.db_bytes IS
'pg_database_size(current_database()) — die ganze Datenbank mit Indizes, TOAST und Sichten.';
COMMENT ON COLUMN sync.speicher_messung.raw_bytes IS
'raw.api_antwort mit allen Partitionen (Schema part), Indizes und TOAST — der Posten, der waechst.';
COMMENT ON COLUMN sync.speicher_messung.je_schema IS
'Bytes je Schema als Objekt {schema: bytes}, Summe von pg_total_relation_size ueber Tabellen und
materialisierte Sichten. Partitionen zaehlen beim Schema ihrer ELTERNTABELLE (raw, core), nicht bei
part, wo sie physisch liegen — so steht raw.api_antwort unter raw.';
COMMENT ON COLUMN sync.speicher_messung.groesste IS
'Die zehn groessten Relationen als Liste [{relation, bytes, teile}], Partitionen zu ihrer
Elterntabelle zusammengefasst (teile = Zahl der Partitionen bzw. 1).';


-- ---------------------------------------------------------------------
-- 2. Der Stand — EINE Zeile, immer
--
-- Auch ohne jede Messung steht genau eine Zeile da, mit befund = keine
-- messung (Regel 10: ein Waechter ohne Messung ist kein "ok"). Deshalb
-- FROM (SELECT 1) LEFT JOIN statt FROM der Tabelle.
--
-- PROZENT WIE df: frei / (belegt + frei). Die Root-Reserve zaehlt weder als
-- belegt noch als frei — so steht hier dieselbe Zahl wie in Use% von df -h
-- auf dem Host, und "0 % frei" heisst wirklich: PostgreSQL kann nicht mehr
-- schreiben. GB sind wie bei df -h 1024^3 Bytes.
--
-- VERBRAUCH JE TAG = Abnahme des freien Platzes, nicht Zuwachs der
-- Datenbank. Auf der Platte liegen auch Images, Build-Cache und Logs; was
-- voll laeuft, ist die Platte. Der Datenbankzuwachs steht daneben, damit man
-- sieht, wer verbraucht.
--
-- ZWEI FENSTER, UND DIE PROGNOSE NIMMT DEN GROESSEREN VERBRAUCH:
--   7 Tage  die Bezugsmessung liegt mindestens 6,5 Tage zurueck
--   2 Tage  die Bezugsmessung liegt mindestens 36 Stunden zurueck
-- Die Toleranz von zwoelf Stunden, weil der Lauf nicht jeden Tag zur selben
-- Minute endet (Phase C endet um 04:30 oder frueher, ein Abbruch irgendwann).
-- Gibt es noch keine so alte Messung, gilt die aelteste, die mindestens 20
-- Stunden zurueckliegt — sonst kaeme in der ersten Woche gar keine Prognose.
-- Der Rohabzug kommt in Schueben: ein Schub, der vor zwei Tagen begann, ist
-- im Siebentagesmittel auf ein Dreieinhalbtel verduennt. Zu viel Verbrauch
-- angenommen heisst zu frueh gewarnt; zu wenig angenommen heisst zu spaet —
-- und zu spaet ist hier ein Ausfall mit Server-Umzug unter Zeitdruck. Der
-- Preis: ein einmaliger Sprung (ein Deploy mit neuem Image) hebt die Prognose
-- zwei Tage lang an. Das ist ein Fehlalarm in der harmlosen Richtung.
--
-- VOLL HEISST 10 % FREI, NICHT 0 BYTES. Bei 145 GB nutzbarer Platte sind das
-- rund 14,5 GB, und die braucht der Betrieb: VACUUM FULL und jede
-- Tabellenumschreibung legen die Tabelle neben der alten noch einmal an,
-- REFRESH MATERIALIZED VIEW CONCURRENTLY baut die ganze Sicht neu neben die
-- alte, WAL waechst bei grossen Schreibschueben ueber max_wal_size hinaus,
-- grosse Sortierungen schreiben temporaere Dateien, und jeder Deploy baut
-- ein Image auf derselben Platte. Laeuft Postgres wirklich voll, haelt es an
-- (PANIC beim WAL-Schreiben) — und das Hochskalieren selbst (Server aus,
-- umziehen, an) will dann unter Druck geschehen.
--
-- DIE STUFEN, schlechteste zuerst:
--   keine messung   keine Messung, die juengste aelter als 48 h, oder die
--                   Platte war nicht messbar
--   falsche platte  die Datenbank ist groesser als der belegte Teil der
--                   gemessenen Platte — gemessen wird die falsche
--   dringend        weniger als 10 % frei, oder voll in weniger als 10 Tagen
--   hochskalieren   weniger als 25 % frei, oder voll in weniger als 30 Tagen
--   beobachten      die Warnschwelle (25 % frei) in weniger als 60 Tagen
--   ok              sonst
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.speicher_stand AS
WITH schwelle AS (
    SELECT 10.0::numeric AS voll_pct,        -- darunter gilt die Platte als voll
           25.0::numeric AS warn_pct,        -- darunter: hochskalieren
           48            AS max_alter_h,     -- aelter: keine messung
           10            AS dringend_tage,   -- voll in weniger Tagen: dringend
           30            AS hochskalieren_tage,
           60            AS beobachten_tage, -- Warnschwelle in weniger Tagen: beobachten
           (1024.0 ^ 3)::numeric AS gb
),
jung AS (
    SELECT m.*, (m.platte_belegt + m.platte_frei) AS nutzbar
      FROM sync.speicher_messung m
     ORDER BY m.gemessen_am DESC, m.messung_id DESC
     LIMIT 1
),
anzahl AS (
    SELECT count(*)::int AS messungen, min(gemessen_am) AS erste_messung
      FROM sync.speicher_messung
),
-- Bezugsmessungen: gleicher Pfad, Platte gemessen.
bezug AS (
    SELECT
      (SELECT r FROM sync.speicher_messung r
        WHERE r.pfad = j.pfad AND r.platte_frei IS NOT NULL
          AND r.gemessen_am <= j.gemessen_am - interval '156 hours'
        ORDER BY r.gemessen_am DESC LIMIT 1) AS r7,
      (SELECT r FROM sync.speicher_messung r
        WHERE r.pfad = j.pfad AND r.platte_frei IS NOT NULL
          AND r.gemessen_am <= j.gemessen_am - interval '36 hours'
        ORDER BY r.gemessen_am DESC LIMIT 1) AS r2,
      (SELECT r FROM sync.speicher_messung r
        WHERE r.pfad = j.pfad AND r.platte_frei IS NOT NULL
          AND r.gemessen_am <= j.gemessen_am - interval '20 hours'
        ORDER BY r.gemessen_am ASC LIMIT 1) AS r1
      FROM jung j
),
ref AS (
    SELECT coalesce(b.r7, b.r1) AS r7, coalesce(b.r2, b.r1) AS r2 FROM bezug b
),
rate AS (
    SELECT j.messung_id,
           extract(epoch FROM j.gemessen_am - (f.r7).gemessen_am) / 86400.0  AS tage7,
           extract(epoch FROM j.gemessen_am - (f.r2).gemessen_am) / 86400.0  AS tage2,
           ((f.r7).platte_frei - j.platte_frei)
             / nullif(extract(epoch FROM j.gemessen_am - (f.r7).gemessen_am) / 86400.0, 0) AS verbrauch7,
           ((f.r2).platte_frei - j.platte_frei)
             / nullif(extract(epoch FROM j.gemessen_am - (f.r2).gemessen_am) / 86400.0, 0) AS verbrauch2,
           (j.db_bytes - (f.r7).db_bytes)
             / nullif(extract(epoch FROM j.gemessen_am - (f.r7).gemessen_am) / 86400.0, 0) AS db7,
           (j.db_bytes - (f.r2).db_bytes)
             / nullif(extract(epoch FROM j.gemessen_am - (f.r2).gemessen_am) / 86400.0, 0) AS db2,
           (j.raw_bytes - (f.r7).raw_bytes)
             / nullif(extract(epoch FROM j.gemessen_am - (f.r7).gemessen_am) / 86400.0, 0) AS raw7
      FROM jung j CROSS JOIN ref f
),
rechnung AS (
    SELECT j.*,
           r.tage7, r.tage2, r.verbrauch7, r.verbrauch2, r.db7, r.db2, r.raw7,
           -- greatest() uebergeht NULL: fehlt ein Fenster, gilt das andere.
           greatest(r.verbrauch7, r.verbrauch2)                     AS verbrauch,
           100.0 * j.platte_frei / nullif(j.nutzbar, 0)             AS frei_pct,
           j.platte_frei - s.voll_pct / 100.0 * j.nutzbar           AS bis_voll,
           j.platte_frei - s.warn_pct / 100.0 * j.nutzbar           AS bis_warn,
           extract(epoch FROM now() - j.gemessen_am) / 3600.0       AS alter_h
      FROM jung j
      CROSS JOIN schwelle s
      LEFT JOIN rate r ON r.messung_id = j.messung_id
),
prognose AS (
    SELECT x.*,
           CASE WHEN x.verbrauch > 0 THEN greatest(x.bis_voll, 0) / x.verbrauch END AS tage_voll,
           CASE WHEN x.verbrauch > 0 THEN greatest(x.bis_warn, 0) / x.verbrauch END AS tage_warn
      FROM rechnung x
),
urteil AS (
    SELECT p.*,
           CASE
             WHEN p.messung_id IS NULL                       THEN 'keine messung'
             WHEN p.alter_h > s.max_alter_h                  THEN 'keine messung'
             WHEN p.platte_frei IS NULL                      THEN 'keine messung'
             WHEN p.db_bytes > p.platte_belegt               THEN 'falsche platte'
             WHEN p.frei_pct < s.voll_pct
               OR p.tage_voll < s.dringend_tage              THEN 'dringend'
             WHEN p.frei_pct < s.warn_pct
               OR p.tage_voll < s.hochskalieren_tage         THEN 'hochskalieren'
             WHEN p.tage_warn < s.beobachten_tage            THEN 'beobachten'
             ELSE 'ok'
           END AS befund
      FROM (SELECT 1) eins
      CROSS JOIN schwelle s
      LEFT JOIN prognose p ON true
)
SELECT u.befund,
       -- Der Satz fuer Menschen. Dezimalkomma von Hand: to_char haengt an lc_numeric.
       CASE
         WHEN u.messung_id IS NULL THEN
           'Noch keine Speichermessung — der naechste Nachtlauf misst zum ersten Mal.'
         WHEN u.alter_h > s.max_alter_h THEN
           format('Die juengste Speichermessung ist %s Stunden alt (erwartet: eine je Nachtlauf). Laeuft der Nachtlauf?',
                  round(u.alter_h))
         WHEN u.platte_frei IS NULL THEN
           'Die Platte war beim letzten Lauf nicht messbar: ' || coalesce(u.platte_fehler, 'ohne Grund')
         WHEN u.befund = 'falsche platte' THEN
           format('Die Datenbank (%s GB) ist groesser als der belegte Teil der gemessenen Platte (%s GB, Pfad %s) — gemessen wird nicht die Platte der Datenbank.',
                  replace(round(u.db_bytes / s.gb, 1)::text, '.', ','),
                  replace(round(u.platte_belegt / s.gb, 1)::text, '.', ','), u.pfad)
         ELSE
           format('%s GB frei (%s %%)', replace(round(u.platte_frei / s.gb, 1)::text, '.', ','),
                  replace(round(u.frei_pct, 1)::text, '.', ','))
           || CASE
                WHEN u.verbrauch IS NULL THEN ', Verbrauch noch nicht messbar (erst eine Messung)'
                WHEN u.verbrauch <= 0 THEN ', kein Wachstum'
                ELSE format(', Verbrauch %s GB/Tag, voll (%s %% frei) voraussichtlich am %s',
                            replace(round(u.verbrauch / s.gb, 2)::text, '.', ','),
                            round(s.voll_pct),
                            to_char(((u.gemessen_am + u.tage_voll * interval '1 day')
                                     AT TIME ZONE 'Europe/Berlin')::date, 'DD.MM.YYYY'))
              END
       END                                                        AS befund_text,
       u.gemessen_am,
       round(u.alter_h::numeric, 1)                               AS alter_stunden,
       u.lauf_id,
       u.pfad,
       a.messungen,
       a.erste_messung,
       round(u.platte_gesamt / s.gb, 1)                           AS platte_gesamt_gb,
       round(u.nutzbar / s.gb, 1)                                 AS platte_nutzbar_gb,
       round(u.platte_belegt / s.gb, 1)                           AS belegt_gb,
       round(u.platte_frei / s.gb, 1)                             AS frei_gb,
       round(u.frei_pct, 1)                                       AS frei_pct,
       round(u.db_bytes / s.gb, 2)                                AS db_gb,
       round(u.raw_bytes / s.gb, 2)                               AS raw_gb,
       round(u.verbrauch7 / s.gb, 2)                              AS verbrauch_7t_gb_tag,
       round(u.verbrauch2 / s.gb, 2)                              AS verbrauch_2t_gb_tag,
       round(u.verbrauch / s.gb, 2)                               AS verbrauch_prognose_gb_tag,
       round(u.tage7::numeric, 1)                                 AS fenster_7t_tage,
       round(u.tage2::numeric, 1)                                 AS fenster_2t_tage,
       round(u.db7 / s.gb, 2)                                     AS db_wachstum_7t_gb_tag,
       round(u.db2 / s.gb, 2)                                     AS db_wachstum_2t_gb_tag,
       round(u.raw7 / s.gb, 2)                                    AS raw_wachstum_7t_gb_tag,
       floor(u.tage_warn)::int                                    AS tage_bis_warnschwelle,
       ((u.gemessen_am + u.tage_warn * interval '1 day') AT TIME ZONE 'Europe/Berlin')::date
                                                                  AS datum_warnschwelle,
       floor(u.tage_voll)::int                                    AS tage_bis_voll,
       ((u.gemessen_am + u.tage_voll * interval '1 day') AT TIME ZONE 'Europe/Berlin')::date
                                                                  AS datum_voll,
       s.warn_pct                                                 AS warnschwelle_pct,
       s.voll_pct                                                 AS voll_pct,
       round(s.warn_pct / 100.0 * u.nutzbar / s.gb, 1)            AS warnschwelle_gb,
       round(s.voll_pct / 100.0 * u.nutzbar / s.gb, 1)            AS voll_gb,
       u.platte_fehler,
       u.groesste,
       u.je_schema
  FROM urteil u
  CROSS JOIN schwelle s
  CROSS JOIN anzahl a;

COMMENT ON VIEW mart.speicher_stand IS
'Speicherwaechter (0152): EINE Zeile, der juengste Stand der Server-Platte und der Datenbank — frei
in GB und Prozent (wie df -h: frei / (belegt + frei)), Verbrauch je Tag ueber 7 und ueber 2 Tage,
die Prognose mit dem GROESSEREN der beiden, Tage und Datum bis zur Warnschwelle (25 % frei) und
bis voll (10 % frei — nicht 0, PostgreSQL braucht Luft fuer VACUUM FULL, Refresh, WAL und
temporaere Dateien). befund: ok | beobachten (Warnschwelle in weniger als 60 Tagen) |
hochskalieren (weniger als 25 % frei oder voll in weniger als 30 Tagen) | dringend (weniger als
10 % frei oder voll in weniger als 10 Tagen) | keine messung (keine, aelter als 48 h oder Platte
nicht messbar) | falsche platte (Datenbank groesser als der belegte Teil der gemessenen Platte).
Auch ohne Messung steht genau eine Zeile da. Verlauf: mart.speicher_verlauf.';
COMMENT ON COLUMN mart.speicher_stand.befund IS
'ok | beobachten | hochskalieren | dringend | keine messung | falsche platte — die schlechteste
zutreffende Stufe. /status und die Nachricht nach dem Lauf lesen genau diese Spalte.';
COMMENT ON COLUMN mart.speicher_stand.befund_text IS
'Der Stand als Satz: frei, Verbrauch je Tag, Datum, an dem die Platte voraussichtlich voll ist.';
COMMENT ON COLUMN mart.speicher_stand.alter_stunden IS
'Stunden seit der juengsten Messung. Ueber 48 heisst der befund keine messung.';
COMMENT ON COLUMN mart.speicher_stand.messungen IS
'Zahl aller Messungen. Bei 1 gibt es noch keinen Verbrauch und keine Prognose.';
COMMENT ON COLUMN mart.speicher_stand.platte_nutzbar_gb IS
'Belegt + frei in GB (1024^3) — die Platte ohne die Root-Reserve des Dateisystems.';
COMMENT ON COLUMN mart.speicher_stand.frei_pct IS
'Frei in Prozent der nutzbaren Platte, wie 100 - Use% in df -h. Prozentzahl, kein Bruch.';
COMMENT ON COLUMN mart.speicher_stand.verbrauch_7t_gb_tag IS
'Abnahme des freien Platzes je Tag gegen die Messung vor rund sieben Tagen (mindestens 6,5; in der
ersten Woche gegen die aelteste, die mindestens 20 h zurueckliegt). Negativ = Platz frei geworden.';
COMMENT ON COLUMN mart.speicher_stand.verbrauch_2t_gb_tag IS
'Wie verbrauch_7t_gb_tag, gegen die Messung vor rund zwei Tagen (mindestens 36 h).';
COMMENT ON COLUMN mart.speicher_stand.verbrauch_prognose_gb_tag IS
'Der groessere der beiden Verbraeuche — Grundlage aller Tage und Daten. Der Rohabzug kommt in
Schueben, und zu frueh gewarnt ist billiger als zu spaet. NULL = erst eine Messung.';
COMMENT ON COLUMN mart.speicher_stand.db_wachstum_7t_gb_tag IS
'Zuwachs der Datenbank je Tag ueber das 7-Tage-Fenster — wer vom Verbrauch der Platte die Datenbank ist.';
COMMENT ON COLUMN mart.speicher_stand.tage_bis_warnschwelle IS
'Ganze Tage, bis bei gleichem Verbrauch nur noch 25 % frei sind; 0 = schon darunter; NULL = kein
Wachstum oder keine Prognose.';
COMMENT ON COLUMN mart.speicher_stand.tage_bis_voll IS
'Ganze Tage, bis bei gleichem Verbrauch nur noch 10 % frei sind (die Marke "voll"); 0 = schon
darunter; NULL = kein Wachstum oder keine Prognose.';
COMMENT ON COLUMN mart.speicher_stand.datum_voll IS
'Berliner Kalendertag, an dem die Marke "voll" (10 % frei) voraussichtlich erreicht ist. Bis dahin
muss der groessere Server stehen.';
COMMENT ON COLUMN mart.speicher_stand.groesste IS
'Die zehn groessten Relationen der juengsten Messung [{relation, bytes, teile}], Partitionen
zusammengefasst.';


-- ---------------------------------------------------------------------
-- 3. Der Verlauf — eine Zeile je Messung
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.speicher_verlauf AS
SELECT m.messung_id,
       m.gemessen_am,
       (m.gemessen_am AT TIME ZONE 'Europe/Berlin')::date                      AS tag,
       m.lauf_id,
       m.pfad,
       round(m.platte_frei   / (1024.0 ^ 3)::numeric, 1)                       AS frei_gb,
       round(100.0 * m.platte_frei / nullif(m.platte_belegt + m.platte_frei, 0), 1) AS frei_pct,
       round(m.platte_belegt / (1024.0 ^ 3)::numeric, 1)                       AS belegt_gb,
       round(m.db_bytes      / (1024.0 ^ 3)::numeric, 2)                       AS db_gb,
       round(m.raw_bytes     / (1024.0 ^ 3)::numeric, 2)                       AS raw_gb,
       round((lag(m.platte_frei) OVER w - m.platte_frei) / (1024.0 ^ 3)::numeric, 2) AS verbrauch_gb,
       round((m.db_bytes  - lag(m.db_bytes)  OVER w) / (1024.0 ^ 3)::numeric, 2)    AS db_zuwachs_gb,
       round((m.raw_bytes - lag(m.raw_bytes) OVER w) / (1024.0 ^ 3)::numeric, 2)    AS raw_zuwachs_gb,
       round((extract(epoch FROM m.gemessen_am - lag(m.gemessen_am) OVER w) / 86400.0)::numeric, 2)
                                                                               AS tage_seit_vorher,
       m.platte_fehler
  FROM sync.speicher_messung m
WINDOW w AS (ORDER BY m.gemessen_am, m.messung_id);

COMMENT ON VIEW mart.speicher_verlauf IS
'Speicherwaechter (0152): eine Zeile je Messung (eine je Nachtlauf) — frei, belegt, Datenbank, raw,
und was sich gegen die Messung davor geaendert hat. Fuer die Verlaufskarte; die Prognose steht in
mart.speicher_stand.';
COMMENT ON COLUMN mart.speicher_verlauf.verbrauch_gb IS
'Wie viel freier Platz seit der Messung davor verschwunden ist (negativ = frei geworden). Nicht je
Tag: tage_seit_vorher daneben.';
COMMENT ON COLUMN mart.speicher_verlauf.db_zuwachs_gb IS
'Zuwachs der Datenbank seit der Messung davor.';
COMMENT ON COLUMN mart.speicher_verlauf.frei_pct IS
'Frei in Prozent der nutzbaren Platte (wie df -h), Prozentzahl.';


-- ---------------------------------------------------------------------
-- 4. Pruefuebersicht: eine Zeile, normal 0
--
-- auffaellig = 1, wenn jemand handeln muss: hochskalieren, dringend, keine
-- messung, falsche platte. "beobachten" zaehlt nicht — das ist ein Termin im
-- Kalender, kein Befund, und eine Zeile, die waehrend des ganzen Rohabzugs
-- auf 1 stuende, liest niemand (0071).
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%speicher_stand%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        SELECT 'Speicher: hochskalieren, keine Messung oder falsche Platte'::text AS pruefung,
               count(*)::bigint AS geprueft,
               count(*) FILTER (WHERE s.befund IN ('hochskalieren', 'dringend',
                                                   'keine messung', 'falsche platte'))::bigint AS auffaellig,
               'mart.speicher_stand'::text AS sicht
          FROM mart.speicher_stand s
        $zweig$);

    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def NOT LIKE '%Speicher: hochskalieren, keine Messung oder falsche Platte%' THEN
        RAISE EXCEPTION '0152: mart.pruefung_uebersicht traegt nach dem Umbau nicht die erwartete Zeile';
    END IF;
END $aussen$;


-- ---------------------------------------------------------------------
-- 5. MCP-Katalog: Koernung, Rechte, Leseprobe
--
-- Die Sichten lesen sync.speicher_messung. Eine gewoehnliche Sicht prueft
-- Tabellenrechte gegen ihren EIGENTUEMER, deshalb sieht mcp_leser sie ohne
-- Recht auf sync. Das gilt NICHT fuer Funktionen im Rumpf (die laufen mit
-- den Rechten des Aufrufers, "Sicht gegen Funktionsrumpf", 0109) — darum
-- steht die Zeitzone hier als Text und nicht als core.geschaefts_zeitzone().
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.speicher_stand',
     'Eine Zeile — juengste Speichermessung des Servers: frei, Verbrauch je Tag, Tage/Datum bis Warnschwelle und voll, befund',
     'import', false),
    ('mart.speicher_verlauf',
     'Messung (eine je Nachtlauf) — frei, belegt, Datenbank, raw, Aenderung gegen die Messung davor',
     'import', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();

SELECT mcp.rechte_auffrischen();

-- Die Gegenprobe als Leserolle (Pflicht seit 0110): SELECT * … LIMIT 1, nicht
-- count(*) — der wertet die Spaltenausdruecke nicht aus.
DO $probe$
DECLARE
    v_abfrage text;
    v_liegen  text[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0152 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0152 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_abfrage IN ARRAY ARRAY[
        'SELECT * FROM mart.speicher_stand LIMIT 1',
        'SELECT * FROM mart.speicher_verlauf LIMIT 1',
        'SELECT * FROM mart.pruefung_uebersicht WHERE sicht = ''mart.speicher_stand''']
    LOOP
        BEGIN
            EXECUTE v_abfrage;
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_abfrage, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0152 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
