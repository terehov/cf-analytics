-- =====================================================================
-- 0147 — Lücken im Kassenumsatz aus dem Kassenblatt ergänzen
-- =====================================================================
--
-- DER BEFUND (28.10.2026, befunde-datenlage.md; nachgemessen 04.11.2026).
-- mart.kassenblatt_stand haelt LINAs Monatsuebersicht ("Die letzten Jahre")
-- gegen den Konzernbericht. 657 Monate abgeschlossener Monate standen auf
-- `abweichung`. Gegen die BWA geprueft (Umsatz, 628 Monate mit gebuchter BWA):
-- die Monatsuebersicht trifft die BWA auf 1 % in 425 Faellen, unser
-- Konzernbericht in 29. Wo beide voneinander abweichen, fehlt also bei UNS
-- etwas — Nulltage, Teiltage, die Lochtage vom 20.–22.07.2026.
--
-- WARUM DAS KASSENBLATT DIE LUECKE FUELLEN DARF. Fuer Betriebe mit LINA-Kasse
-- fuehrt es denselben Nettoumsatz wie getUmsatzbericht, auf den Cent
-- (Ludwigsburg, Saarbruecken, Ballplatz Mainz im September 2026,
-- lina-api-inventar-ladenakte.md). Ein Kassenblatt-Tag UEBER dem LINA-Wert
-- heisst: unser Tag ist unvollstaendig.
--
-- ~~0141: „Kassenblatt und Kasse mischen sich nicht"~~ — revidiert
-- (Eugene, 04.11.2026: „fixe es, dass die Werte bei uns stimmen"). Die Regel
-- war zu grob: sie schuetzte die echten Kassentage, liess aber jeden
-- fehlenden Tag als fehlend stehen. Jetzt gilt je Tag: der groessere Wert
-- gewinnt, und das Kassenblatt hebt nur an, es senkt nie.
--
-- NICHT FUER ALLE. Bei zwoelf Betrieben (Park Cafe Muenchen, BS Bier &
-- Speisen, Enchilada Freiburg, Alter Kranen, Muenster, Bayreuth u. a.; 402
-- Monate, 19,2 Mio. EUR, gemessen 04.11.2026) liegt LINA zu oft unter der
-- Monatsuebersicht — die Ladenakte zaehlt dort
-- mehr als den einen Konzern-Betrieb (GmbH-Ebene, weitere Kassen oder
-- Betriebsstellen, BS Bier hat mit "Lauterbacher am See" einen eigenen
-- LINA-Betrieb). Dort anzuheben zaehlte doppelt. Die Grenze ist gemessen,
-- nicht geraten: ergaenzt wird nur, wo mindestens 75 % der Monate mit beiden
-- Werten sich auf 1 % treffen (lina_quote). Die zwoelf bleiben `abweichung`
-- und sind eine Frage an den Fachbereich (offene-punkte.md).
--
-- NEUE ZUSTAENDE in mart.kassenblatt_stand:
--   luecke     LINA-Kasse unter der Monatsuebersicht, Betrieb sonst stimmig —
--              der Importer holt "Die letzten Tage" und hebt die Tage an
--              (eingereiht wie `faellig`, src/sync/nachfuellen.ts)
--   ergaenzt   LINA-Tage plus Kassenblatt-Tage treffen die Monatsuebersicht
-- Spalte lina_quote haengt am Ende an (CREATE OR REPLACE kann nur anhaengen).
-- =====================================================================

CREATE OR REPLACE VIEW mart.kassenblatt_stand AS
WITH historie AS (
    -- Unveraendert aus 0141: ueber alle Quellen, siehe dort.
    SELECT min(geschaeftstag) AS ab
      FROM core.umsatzbericht_tag
), je_monat AS (
    SELECT u.betrieb_key,
           date_trunc('month', u.geschaeftstag)::date AS monat,
           sum(u.umsatz_netto) FILTER (WHERE u.quelle = 'umsatzbericht') AS umsatz_lina,
           sum(u.umsatz_netto) FILTER (WHERE u.quelle = 'kassenblatt')   AS umsatz_kassenblatt,
           count(*)            FILTER (WHERE u.quelle = 'kassenblatt')   AS tage_kassenblatt,
           max(u.geladen_am)   FILTER (WHERE u.quelle = 'kassenblatt')   AS kassenblatt_geladen_am
      FROM core.umsatzbericht_tag u
     WHERE u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
       AND u.betrieb_key IN (SELECT betrieb_key FROM core.kassenblatt_monat)
     GROUP BY 1, 2
), basis AS (
    SELECT km.betrieb_key, km.monat, km.umsatz_netto AS jahresuebersicht, km.abgerufen_am,
           coalesce(j.umsatz_lina, 0)        AS umsatz_lina,
           j.umsatz_kassenblatt,
           coalesce(j.tage_kassenblatt, 0)   AS tage_kassenblatt,
           j.kassenblatt_geladen_am,
           greatest(1, 0.01 * abs(km.umsatz_netto)) AS toleranz
      FROM core.kassenblatt_monat km
      LEFT JOIN je_monat j ON j.betrieb_key = km.betrieb_key AND j.monat = km.monat
), quote AS (
    -- Je Betrieb: Anteil der abgeschlossenen Monate mit Kasse UND Uebersicht,
    -- in denen sich beide treffen. Kassenblatt-Tage zaehlen mit, sonst
    -- senkte jede Ergaenzung die Quote des Betriebs.
    SELECT b.betrieb_key,
           round(avg(CASE WHEN abs(b.umsatz_lina + coalesce(b.umsatz_kassenblatt, 0) - b.jahresuebersicht)
                               <= b.toleranz THEN 1.0 ELSE 0.0 END), 3) AS lina_quote
      FROM basis b
     CROSS JOIN historie h
     WHERE b.umsatz_lina <> 0
       AND b.monat >= date_trunc('month', h.ab)::date
       AND b.monat < date_trunc('month', current_date)::date
     GROUP BY b.betrieb_key
)
SELECT b.betrieb_key,
       bt.name                                 AS betrieb,
       kz.hauptkonzept                         AS konzept,
       b.monat,
       b.jahresuebersicht,
       b.umsatz_lina,
       b.umsatz_kassenblatt,
       b.tage_kassenblatt,
       b.abgerufen_am                          AS jahresuebersicht_abgerufen_am,
       b.kassenblatt_geladen_am,
       CASE
         WHEN b.monat < date_trunc('month', h.ab)::date                          THEN 'vor Historie'
         WHEN b.umsatz_lina <> 0
              AND abs(b.umsatz_lina - b.jahresuebersicht) <= b.toleranz           THEN 'lina-kasse'
         WHEN b.umsatz_lina <> 0 AND b.tage_kassenblatt > 0
              AND abs(b.umsatz_lina + b.umsatz_kassenblatt - b.jahresuebersicht)
                  <= b.toleranz                                                   THEN 'ergaenzt'
         WHEN b.umsatz_lina <> 0
              AND b.umsatz_lina + coalesce(b.umsatz_kassenblatt, 0) < b.jahresuebersicht - b.toleranz
              AND coalesce(q.lina_quote, 0) >= 0.75
              AND b.monat < date_trunc('month', current_date)::date               THEN 'luecke'
         WHEN b.umsatz_lina <> 0                                                  THEN 'abweichung'
         WHEN b.jahresuebersicht = 0 AND b.tage_kassenblatt = 0                    THEN 'kein Umsatz'
         WHEN b.tage_kassenblatt > 0
              AND abs(b.umsatz_kassenblatt - b.jahresuebersicht) <= 1             THEN 'geladen'
         WHEN b.tage_kassenblatt > 0
              AND b.kassenblatt_geladen_am > b.abgerufen_am                       THEN 'geladen, juenger'
         ELSE 'faellig'
       END                                     AS zustand,
       q.lina_quote
  FROM basis b
  JOIN core.betrieb bt                ON bt.betrieb_key = b.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = b.betrieb_key
  LEFT JOIN quote q                   ON q.betrieb_key = b.betrieb_key
 CROSS JOIN historie h;

COMMENT ON VIEW mart.kassenblatt_stand IS
'Betrieb x Monat: Monatswert aus "Die letzten Jahre" gegen LINAs Kasse und gegen geladene '
'Kassenblatt-Tage (0141, 0147). Zugleich die Einreihbedingung des Importers (faellig, luecke). '
'ERWARTUNG: keine Zeile "faellig" oder "luecke", die aelter als zwei Naechte ist. '
'"luecke": LINA-Kasse liegt unter dem Monatswert, der Betrieb trifft ihn sonst (lina_quote >= 0.75) — '
'das Kassenblatt hebt die unvollstaendigen Tage an. "ergaenzt": danach getroffen. '
'"abweichung": Kasse und Monatswert treffen sich nicht, und der Betrieb weicht auch sonst ab '
'(Ladenakte zaehlt mehr als den einen LINA-Betrieb) — wird nicht gefuellt, Frage an den Fachbereich.';

COMMENT ON COLUMN mart.kassenblatt_stand.lina_quote IS
'Je Betrieb: Anteil der abgeschlossenen Monate mit Kassenumsatz, in denen Kasse (plus ergaenzte '
'Kassenblatt-Tage) den Monatswert auf 1 % trifft. Unter 0,75 wird nicht ergaenzt (0147).';
