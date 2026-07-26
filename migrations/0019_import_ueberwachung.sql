-- =====================================================================
-- 0019 Sichten fuer die Importueberwachung
--
-- ANLASS: "Ich moechte schnell feststellen, wenn etwas scheitert, und
-- woran es liegt." Bisher beantwortete mart.sync_status und
-- mart.backfill_fortschritt je einen Teil davon; was fehlte, war das
-- Ganze: Wie weit sind wir? Was kommt als Naechstes? Wie aktuell sind die
-- Daten, und wie weit reichen sie zurueck? Und im Fehlerfall: woran liegt
-- es, in einem Satz.
--
-- Die Sichten hier sind bewusst LESEND und rechnen nichts fort. Der
-- Betriebszustand steht in sync.*; hier wird er nur so zusammengelegt,
-- dass ein Dashboard ihn zeigen kann, ohne dass jede Karte dieselbe
-- Aggregation noch einmal schreibt.
--
-- EINE WARNUNG VORWEG, die in mehreren Sichten wiederkehrt: "keine_daten"
-- ist KEIN Fehler. LINA antwortet mit HTTP 500 und leerem Body, wenn ein
-- Betrieb fuer einen Bericht nichts hat -- ein geschlossenes Haus, ein
-- Bericht, den dieser Betrieb nicht fuehrt. Wer das als Fehler zaehlt,
-- sieht bei 141 Betrieben permanent Alarm.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Der eine Blick: wie weit ist der Import insgesamt?
--
-- Eine einzige Zeile. Alles, was man in drei Sekunden wissen will, bevor
-- man ueberhaupt hinsieht, ob irgendwo etwas rot ist.
-- ---------------------------------------------------------------------
CREATE VIEW mart.import_gesamt AS
WITH w AS (
    SELECT count(*)                                            AS posten,
           count(*) FILTER (WHERE erledigt_am IS NOT NULL)      AS erledigt,
           count(*) FILTER (WHERE erledigt_am IS NULL)          AS offen,
           count(*) FILTER (WHERE ergebnis = 'aufgegeben')      AS aufgegeben,
           count(*) FILTER (WHERE erledigt_am IS NULL
                              AND prioritaet <= 10)             AS offen_laufend,
           count(*) FILTER (WHERE erledigt_am IS NULL
                              AND prioritaet >= 90)             AS offen_historie,
           min(zeitraum_von) FILTER (WHERE ergebnis = 'ok')     AS reicht_zurueck_bis,
           max(zeitraum_bis) FILTER (WHERE ergebnis = 'ok')     AS geladen_bis
      FROM sync.warteschlange
),
-- Durchsatz der letzten Stunde. Grundlage fuer die Restzeit -- bewusst
-- kurz gefenstert: das Tempo haengt an TAKT_* und am Tagesbudget, ein
-- Mittel ueber Tage wuerde eine Pause als dauerhafte Langsamkeit lesen.
takt AS (
    SELECT count(*) AS pro_stunde
      FROM sync.aufgabe
     WHERE beendet_am > now() - interval '1 hour'
       AND status IN ('ok', 'keine_daten')
),
sperre AS (
    SELECT art, pausiert_bis, hinweis FROM sync.sperre_aktiv()
)
SELECT w.posten                                                AS posten_gesamt,
       w.erledigt,
       w.offen,
       w.offen_laufend,
       w.offen_historie,
       w.aufgegeben,
       round(100.0 * w.erledigt / nullif(w.posten, 0), 1)       AS prozent,
       w.reicht_zurueck_bis,
       w.geladen_bis,
       t.pro_stunde                                            AS tempo_pro_stunde,
       -- Restzeit nur, wenn ueberhaupt etwas laeuft. Ohne Durchsatz waere
       -- die Division unendlich, und "noch 99999 Stunden" ist keine
       -- Auskunft, sondern Rauschen.
       CASE WHEN t.pro_stunde > 0
            THEN round(w.offen::numeric / t.pro_stunde, 1)
       END                                                     AS reststunden,
       CASE WHEN t.pro_stunde > 0
            THEN (now() + (w.offen::numeric / t.pro_stunde) * interval '1 hour')
       END                                                     AS fertig_etwa,
       s.art                                                   AS sperre_art,
       s.pausiert_bis                                          AS sperre_bis,
       s.hinweis                                               AS sperre_hinweis
  FROM w CROSS JOIN takt t LEFT JOIN sperre s ON true;

COMMENT ON VIEW mart.import_gesamt IS
'Eine Zeile: Fortschritt, Tempo, geschaetzte Restzeit, Datenreichweite und eine etwaige
Zugangssperre. Die Restzeit ist aus dem Durchsatz der letzten Stunde gerechnet und daher eine
Groessenordnung, keine Zusage -- sie aendert sich mit dem Tagesbudget und mit LINAs Tempo.';


-- ---------------------------------------------------------------------
-- 2. Was macht der Importer gerade, was kommt als Naechstes?
--
-- Die Warteschlange in der Reihenfolge, in der sie abgearbeitet wird --
-- genau die Sortierung, die der Worker benutzt (Prioritaet, dann
-- Faelligkeit). Damit ist "was kommt als Naechstes" nicht geraten,
-- sondern abgelesen.
-- ---------------------------------------------------------------------
CREATE VIEW mart.import_naechste AS
SELECT w.posten_id,
       row_number() OVER (ORDER BY w.prioritaet, w.faellig_ab, w.posten_id) AS position,
       w.endpunkt,
       b.name                                          AS betrieb,
       w.zeitraum_von,
       w.zeitraum_bis,
       w.prioritaet,
       CASE WHEN w.prioritaet <= 10 THEN 'laufend'
            WHEN w.prioritaet >= 90 THEN 'Historie'
            ELSE 'normal' END                          AS art,
       w.faellig_ab,
       w.versuche,
       w.in_arbeit_seit,
       (w.in_arbeit_seit IS NOT NULL)                  AS laeuft_gerade,
       w.letzter_fehler
  FROM sync.warteschlange w
  LEFT JOIN core.betrieb b ON b.enc_id = w.betrieb_enc_id
 WHERE w.erledigt_am IS NULL
 ORDER BY w.prioritaet, w.faellig_ab, w.posten_id;

COMMENT ON VIEW mart.import_naechste IS
'Die offene Warteschlange in der Reihenfolge der Abarbeitung. Zeile 1 ist der naechste Posten.
laeuft_gerade = true heisst, dass ein Worker ihn gerade in Arbeit hat.

Prioritaet: <= 10 sind die laufenden Tage (heute, gestern), >= 90 ist die Historie. Der
laufende Betrieb geht immer vor -- deshalb kann die Historie tagelang stillstehen, ohne dass
etwas kaputt ist.';


-- ---------------------------------------------------------------------
-- 3. Woran liegt es? -- Fehler der letzten 24 Stunden, gruppiert
--
-- Nicht jede einzelne Fehlermeldung, sondern die MUSTER. Bei 141
-- Betrieben erzeugt ein einziger struktureller Fehler hunderte Zeilen;
-- was man wissen will, ist "welcher Fehler, wie oft, seit wann, welcher
-- Endpunkt".
-- ---------------------------------------------------------------------
CREATE VIEW mart.import_fehler AS
SELECT a.endpunkt,
       coalesce(a.http_status, 0)                      AS http_status,
       -- Fehlertexte enthalten oft Zeitstempel oder IDs. Fuer die
       -- Gruppierung wird alles Variable ersetzt, sonst ist jede Zeile
       -- ihre eigene Gruppe und das Muster verschwindet.
       regexp_replace(
         regexp_replace(coalesce(a.fehler, 'ohne Meldung'),
                        '\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?', '<zeit>', 'g'),
         '\m\d{3,}\M', '<zahl>', 'g')                  AS fehler,
       count(*)                                        AS faelle,
       count(DISTINCT a.betrieb_enc_id)                AS betriebe,
       min(a.beendet_am)                               AS zuerst,
       max(a.beendet_am)                               AS zuletzt
  FROM sync.aufgabe a
 WHERE a.status = 'fehler'
   AND a.beendet_am > now() - interval '24 hours'
 GROUP BY a.endpunkt, coalesce(a.http_status, 0), 3
 ORDER BY count(*) DESC, max(a.beendet_am) DESC;

COMMENT ON VIEW mart.import_fehler IS
'Fehlermuster der letzten 24 Stunden, nach Haeufigkeit. Zeitstempel und lange Zahlen sind im
Text durch <zeit> und <zahl> ersetzt, damit gleichartige Fehler zusammenfallen.

Hier stehen NUR echte Fehler. "keine_daten" ist keiner: LINA antwortet mit HTTP 500 und leerem
Body, wenn ein Betrieb fuer einen Bericht nichts hat -- ein geschlossenes Haus oder ein
Bericht, den dieser Betrieb nicht fuehrt.';


-- ---------------------------------------------------------------------
-- 4. Je Bericht: wie weit, wie aktuell, wie gesund
--
-- Die Zeile, die man liest, wenn irgendwo Zahlen fehlen: welcher Bericht
-- haengt, seit wann kam nichts mehr, und wie viele Betriebe sind
-- betroffen.
-- ---------------------------------------------------------------------
CREATE VIEW mart.import_bericht AS
WITH warte AS (
    SELECT endpunkt,
           count(*)                                        AS posten,
           count(*) FILTER (WHERE erledigt_am IS NOT NULL)  AS erledigt,
           count(*) FILTER (WHERE erledigt_am IS NULL)      AS offen,
           count(*) FILTER (WHERE ergebnis = 'ok')          AS geladen,
           count(*) FILTER (WHERE ergebnis = 'keine_daten') AS keine_daten,
           count(*) FILTER (WHERE ergebnis = 'aufgegeben')  AS aufgegeben,
           min(zeitraum_von) FILTER (WHERE ergebnis = 'ok') AS reicht_zurueck_bis,
           max(zeitraum_bis) FILTER (WHERE ergebnis = 'ok') AS geladen_bis
      FROM sync.warteschlange
     GROUP BY endpunkt
),
letzte AS (
    SELECT endpunkt,
           max(beendet_am) FILTER (WHERE status IN ('ok', 'keine_daten')) AS letzter_erfolg,
           count(*) FILTER (WHERE status = 'fehler'
                              AND beendet_am > now() - interval '24 hours') AS fehler_24h,
           count(*) FILTER (WHERE beendet_am > now() - interval '24 hours') AS aufrufe_24h,
           round(avg(dauer_ms) FILTER (WHERE status = 'ok'
                              AND beendet_am > now() - interval '24 hours'))::int AS dauer_ms
      FROM sync.aufgabe
     GROUP BY endpunkt
),
gestoppt AS (
    SELECT endpunkt, count(*) AS betriebe_pausiert
      FROM sync.fortschritt
     WHERE pausiert_bis > now()
     GROUP BY endpunkt
)
SELECT w.endpunkt,
       round(100.0 * w.erledigt / nullif(w.posten, 0), 1)  AS prozent,
       w.posten,
       w.erledigt,
       w.offen,
       w.geladen,
       w.keine_daten,
       w.aufgegeben,
       w.reicht_zurueck_bis,
       w.geladen_bis,
       -- Wie alt sind die juengsten Daten dieses Berichts? Die Zahl, an
       -- der man einen haengenden Bericht erkennt.
       --
       -- least(...) gegen heute: getKennzahlen wird je KALENDERJAHR geholt,
       -- zeitraum_bis ist deshalb der 31.12. Ohne die Deckelung stuende
       -- dort "-158 Tage alt" -- eine Zahl, die aussieht wie ein Fehler und
       -- keine ist. Gedeckelt heisst sie 0: aktuell, mehr geht nicht.
       (current_date - least(w.geladen_bis, current_date))  AS tage_alt,
       l.letzter_erfolg,
       round(EXTRACT(epoch FROM (now() - l.letzter_erfolg)) / 3600, 1) AS stunden_seit_erfolg,
       l.aufrufe_24h,
       l.fehler_24h,
       l.dauer_ms                                          AS dauer_ms_schnitt,
       coalesce(g.betriebe_pausiert, 0)                    AS betriebe_pausiert,
       CASE WHEN w.offen = 0                    THEN 'fertig'
            WHEN l.fehler_24h > 0               THEN 'Fehler'
            WHEN coalesce(g.betriebe_pausiert, 0) > 0 THEN 'teilweise pausiert'
            WHEN l.aufrufe_24h > 0              THEN 'laeuft'
            ELSE 'wartet' END                              AS zustand
  FROM warte w
  LEFT JOIN letzte l   ON l.endpunkt = w.endpunkt
  LEFT JOIN gestoppt g ON g.endpunkt = w.endpunkt
 ORDER BY w.offen DESC, w.endpunkt;

COMMENT ON VIEW mart.import_bericht IS
'Je LINA-Bericht: Fortschritt, Datenreichweite, Aktualitaet und Gesundheit.

tage_alt ist die wichtigste Spalte: sie sagt, wie alt die juengsten Daten dieses Berichts sind.
Bei taeglichen Berichten sind 1-2 Tage normal.

zustand = "wartet" heisst nicht "kaputt": der laufende Betrieb hat Vorrang vor der Historie,
deshalb koennen Historienposten laenger unberuehrt bleiben.';


-- ---------------------------------------------------------------------
-- 5. Die Laeufe -- was ist beim letzten Mal passiert?
-- ---------------------------------------------------------------------
CREATE VIEW mart.import_lauf AS
SELECT l.lauf_id,
       l.gestartet_am,
       l.beendet_am,
       coalesce(l.beendet_am, now()) - l.gestartet_am      AS dauer,
       l.ausloeser,
       l.status,
       l.aufgaben_gesamt,
       l.aufgaben_ok,
       l.aufgaben_fehler,
       l.aufgaben_uebersprungen,
       -- Wie viele Posten je Minute? Der Vergleich zwischen den Laeufen
       -- zeigt eine Drosselung, bevor sie als Fehler auffaellt.
       CASE WHEN l.beendet_am IS NOT NULL
             AND l.beendet_am > l.gestartet_am
            THEN round(l.aufgaben_gesamt::numeric
                       / (EXTRACT(epoch FROM (l.beendet_am - l.gestartet_am)) / 60), 1)
       END                                                 AS posten_pro_minute,
       l.notiz
  FROM sync.lauf l
 ORDER BY l.lauf_id DESC;

COMMENT ON VIEW mart.import_lauf IS
'Die Importlaeufe, juengster zuerst. status = "abgebrochen" mit einer Notiz ueber SIGTERM ist
der Normalfall bei einem Lauf mit Zeitfrist -- der naechste macht weiter, wo dieser aufhoerte.
Der Zustand liegt in der Datenbank, nicht im Prozess.';


-- ---------------------------------------------------------------------
-- 6. Der Puls -- Posten je Stunde ueber die letzten drei Tage
--
-- Die Kurve, an der man sieht, ob es laeuft, langsamer wird oder steht.
-- Eine Luecke ist eine Pause; ein Absacken ohne Fehler ist meistens das
-- Tagesbudget.
-- ---------------------------------------------------------------------
CREATE VIEW mart.import_puls AS
SELECT date_trunc('hour', beendet_am)                       AS stunde,
       count(*) FILTER (WHERE status = 'ok')                AS geladen,
       count(*) FILTER (WHERE status = 'keine_daten')       AS keine_daten,
       count(*) FILTER (WHERE status = 'fehler')            AS fehler,
       count(*)                                             AS gesamt,
       round(avg(dauer_ms) FILTER (WHERE status = 'ok'))::int AS dauer_ms,
       round(avg(wartezeit_ms))::int                        AS wartezeit_ms
  FROM sync.aufgabe
 WHERE beendet_am > now() - interval '3 days'
 GROUP BY 1
 ORDER BY 1;

COMMENT ON VIEW mart.import_puls IS
'Posten je Stunde, letzte drei Tage. Eine Luecke ist eine Pause (Sperre, Budget oder kein
laufender Prozess), ein Absacken ohne Fehler meistens das Tagesbudget.

wartezeit_ms ist die selbst auferlegte Drosselung -- sie soll da sein. Steigt sie ohne unser
Zutun, hat LINA gebremst.';


-- ---------------------------------------------------------------------
-- 7. Datenreichweite je Betrieb -- wem fehlt was?
--
-- Die Umkehrung von import_bericht: nicht "welcher Bericht haengt",
-- sondern "welcher Betrieb hat Luecken".
-- ---------------------------------------------------------------------
CREATE VIEW mart.import_betrieb AS
SELECT b.betrieb_key,
       b.name                                              AS betrieb,
       b.enc_id,
       count(*) FILTER (WHERE w.erledigt_am IS NOT NULL)    AS erledigt,
       count(*) FILTER (WHERE w.erledigt_am IS NULL)        AS offen,
       round(100.0 * count(*) FILTER (WHERE w.erledigt_am IS NOT NULL)
             / nullif(count(*), 0), 1)                      AS prozent,
       min(w.zeitraum_von) FILTER (WHERE w.ergebnis = 'ok') AS reicht_zurueck_bis,
       max(w.zeitraum_bis) FILTER (WHERE w.ergebnis = 'ok') AS geladen_bis,
       count(*) FILTER (WHERE w.ergebnis = 'keine_daten')   AS keine_daten,
       count(*) FILTER (WHERE w.ergebnis = 'aufgegeben')    AS aufgegeben,
       count(DISTINCT f.endpunkt) FILTER (WHERE f.pausiert_bis > now()) AS berichte_pausiert
  FROM core.betrieb b
  LEFT JOIN sync.warteschlange w ON w.betrieb_enc_id = b.enc_id
  LEFT JOIN sync.fortschritt f   ON f.betrieb_enc_id = b.enc_id
 GROUP BY b.betrieb_key, b.name, b.enc_id
 ORDER BY count(*) FILTER (WHERE w.erledigt_am IS NULL) DESC, b.name;

COMMENT ON VIEW mart.import_betrieb IS
'Je Betrieb: wie viel geladen ist und wie weit die Daten reichen.

aufgegeben > 0 heisst, dass ein Posten nach mehreren Versuchen aufgegeben wurde -- das ist die
Spalte, die eine echte Luecke anzeigt. keine_daten dagegen ist Normalzustand fuer Betriebe, die
einen Bericht nicht fuehren.';
