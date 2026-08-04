-- ============================================================================
-- Betriebsstatus, Plausibilitätsgrenzen und ehrliche Kennzahlen.
--
-- Anlass ist ein systematischer Dashboard-Review am 03.08.2026 mit 90
-- Befunden. Die tragenden davon werden hier an der Wurzel behoben — in den
-- Sichten, nicht in 133 Karten einzeln:
--
--   1. GESCHLOSSENE, VERWALTENDE UND TEST-BETRIEBE stellten ein Drittel der
--      roten Ampeln ("GESCHLOSSEN - Aposto Frankfurt": Sofort eskalieren).
--      Neu: mart.betrieb_status leitet einen Status aus Konzept, Namensmuster
--      und letztem Umsatztag ab; mart.round_table_monat führt je Monat ein
--      Feld `operativ` (Umsatz im Monat UND weder Test noch Verwaltung).
--      Karten filtern darauf, statt Karteileichen zu eskalieren.
--
--   2. BWA-CARRY-FORWARD WAR UNBEGRENZT: Juli-2026-Eskalationen aus einer
--      BWA von 2018 (100 Monate alt). Neu: höchstens 3 Monate Nachtrag,
--      ältere BWA ⇒ kein Personal-/WE-Urteil, der Betrieb fällt ehrlich in
--      "ohne Urteil". `bwa_alter_monate` macht das Alter sichtbar.
--
--   3. QUOTEN BIS 974 % flossen ungefiltert in Ampeln (fehlender Nenner beim
--      Steuerberater). Neu: Quoten über 150 % gelten als unplausibel und
--      werden NULL; mart.bwa_prozent_unplausibel senkt die Meldegrenze von
--      1000 auf 150, damit die Arbeitsliste die Fälle auch zeigt.
--
--   4. DER LAUFENDE MONAT bekam ein Umsatz-Urteil aus zwei Tagen gegen den
--      vollen Vorjahresmonat (-92 % überall am Monatsdritten). Neu: kein
--      umsatz_pct und keine Umsatzampel für den angebrochenen Monat.
--
--   5. fixer_we IST NIE NULL, SONDERN 0 — "Abdeckung 100 %" und "DB % = 100"
--      für drei Viertel der Artikel. Neu: nullif(fixer_we, 0) in
--      mart.artikelverkauf; Wareneinsatz und Deckungsbeitrag sind NULL, wo
--      kein Ansatz hinterlegt ist. Exakt der Fehler aus Migration 0029,
--      nur eine Sicht weiter.
--
--   6. EINKAUFSPREIS-VERGLEICH über Einheitsgrenzen hinweg (+3,2 Mio. % bei
--      g/kg-Wechsel). Neu: lag() partitioniert auch über die Einheit, und
--      `verdaechtig` kennzeichnet Restfälle statt sie als Teuerung zu zeigen.
--
--   7. mart.einkauf_ladestand BESCHEINIGTE 100 % VOLLSTÄNDIGKEIT, während
--      1.703 Bestelllisten-Seiten offen waren: positionen_pct misst nur die
--      Tiefe je GELADENER Bestellung. Neu: offene/erledigte Listen-Seiten je
--      Marke stehen daneben.
--
--   8. mart.import_gesamt MELDETE "Daten bis 2026-12-31" (Jahresfenster der
--      Kennzahlen-Posten). Neu: geladen_bis ist auf heute gedeckelt.
--
--   9. UMSATZ JE GAST BIS 390 €: 23 % der Umsatztage haben keine Gästezahl.
--      Neu: umsatz_pro_gast nur bei ≥ 80 % Gäste-Abdeckung im Monat,
--      Abdeckung als eigene Spalte.
--
--  10. round_table_monat und round_table_trend werden MATERIALISIERT
--      (dd_betrieb_kopf brauchte 8–16 s, sieben Karten über 5 s). Refresh im
--      Sync-Nachlauf, wie mart.deckungsbeitrag_warengruppe seit 0027.
--
--  11. Neue Datenqualitäts-Sichten: gruppenweite Umsatz-Lochtage (22.07.2026
--      hatte 0 € über alle 141 Betriebe und niemand sah es), Gäste-Abdeckung
--      je Betrieb, Betriebe ohne Yext-Zuordnung, Gesamtampel-Wechsel.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Betriebsstatus.
--
-- Kein neues Stammdatum, sondern abgeleitet: die Wahrheit steht längst in
-- Konzept ("Enchi-Gruppe geschlossene", "Franchisegebergesellschaften"),
-- Namensmuster (GESCHLOSSEN/INSOLVENT/Testladen) und dem letzten Umsatztag.
-- Ein Pflege-Flag wäre eine weitere Stelle, die veralten kann.
--
-- 'geschlossen' und 'inaktiv' sind der HEUTIGE Zustand. Für Monatsurteile
-- zählt `operativ` in round_table_basis: Umsatz im jeweiligen Monat — ein
-- 2019 laufendes, heute geschlossenes Haus bleibt in der Historie operativ.
-- ----------------------------------------------------------------------------
CREATE VIEW mart.betrieb_status AS
WITH letzter AS (
    SELECT betrieb_key, max(geschaeftstag) AS letzter_umsatztag
      FROM core.umsatzbericht_tag
     WHERE umsatz_netto > 0 AND hauptsparte_key IS NULL AND verkaufsstelle_key IS NULL
     GROUP BY betrieb_key
)
SELECT b.betrieb_key,
       b.name AS betrieb,
       kz.hauptkonzept AS konzept,
       u.letzter_umsatztag,
       CASE
         WHEN b.name ~* 'testladen|zav[ -]?test'                          THEN 'test'
         WHEN kz.hauptkonzept = 'Franchisegebergesellschaften'
              OR b.name ~* 'franchise (gmbh|ag)|^concept family'          THEN 'verwaltend'
         WHEN b.name ~* '^\s*(geschlossen|insolvent)'
              OR kz.hauptkonzept = 'Enchi-Gruppe geschlossene'            THEN 'geschlossen'
         WHEN u.letzter_umsatztag IS NULL                                 THEN 'ohne_geschaeft'
         WHEN u.letzter_umsatztag < current_date - 60                     THEN 'inaktiv'
         ELSE 'operativ'
       END AS status
  FROM core.betrieb b
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = b.betrieb_key
  LEFT JOIN letzter u ON u.betrieb_key = b.betrieb_key;

COMMENT ON VIEW mart.betrieb_status IS
  'Heutiger Status je Betrieb, abgeleitet aus Konzept, Namensmuster und letztem Umsatztag. '
  'operativ | inaktiv (60 Tage ohne Umsatz) | geschlossen | verwaltend | test | ohne_geschaeft. '
  'Für Monatsurteile gilt nicht dieser Status, sondern round_table_monat.operativ.';

-- mart.betrieb: Status und letzter Umsatztag stehen jetzt in der Betriebsliste.
-- Die Stadt kommt aus den Standort-Stammdaten — core.betrieb.stadt ist in
-- allen 141 Zeilen leer, manual.betrieb_standort.ort ist gepflegt.
CREATE OR REPLACE VIEW mart.betrieb AS
SELECT b.betrieb_key,
       b.enc_id,
       b.name AS betrieb,
       coalesce(b.stadt, st.ort) AS stadt,
       b.aktiv,
       b.hat_bwa,
       string_agg(k.name, ', ' ORDER BY k.name) AS konzepte,
       min(s.status) AS status,
       min(s.letzter_umsatztag) AS letzter_umsatztag
  FROM core.betrieb b
  LEFT JOIN core.betrieb_konzept bk ON bk.betrieb_key = b.betrieb_key
  LEFT JOIN core.konzept k ON k.konzept_key = bk.konzept_key
  LEFT JOIN mart.betrieb_status s ON s.betrieb_key = b.betrieb_key
  LEFT JOIN manual.betrieb_standort st ON st.betrieb_key = b.betrieb_key
 GROUP BY b.betrieb_key, b.enc_id, b.name, coalesce(b.stadt, st.ort), b.aktiv, b.hat_bwa;

-- ----------------------------------------------------------------------------
-- 3./Personal: Die Ampel einer ungebuchten Quote ist keine grüne Ampel.
--
-- LINA liefert 0.00 statt NULL, und ampel.bewerte(0, 'personal', ...) sagte
-- 'gruen' — für Verwaltungs-GmbHs, geschlossene Tage und ungebuchte Monate
-- gleichermaßen (8.115 von 12.972 Zeilen im Drei-Monats-Fenster, dazu Zeilen
-- wie "49,38 % / gruen" aus persoog_bwa = 0 bei realer Tagesquote).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.personalkosten AS
SELECT b.name AS betrieb,
       coalesce(b.stadt, st.ort) AS stadt,
       kz.hauptkonzept AS konzept,
       p.zeitraum_von,
       p.zeitraum_bis,
       date_trunc('month', p.zeitraum_von)::date AS monat,
       p.zeitraum_bis - p.zeitraum_von + 1 AS tage,
       p.pek_gesamt,
       p.pek_service,
       p.pek_bar,
       p.pek_kueche,
       p.eff_gesamt,
       p.eff_service,
       p.eff_bar,
       p.eff_kueche,
       p.persoog_bwa,
       s.schwelle_gruen  AS schwelle_gruen_lina,
       s.schwelle_orange AS schwelle_orange_lina,
       CASE WHEN p.persoog_bwa = 0 THEN NULL
            ELSE ampel.bewerte(p.persoog_bwa, 'personal', 'round_table_global') END AS ampel_global,
       CASE WHEN p.persoog_bwa = 0 THEN NULL
            ELSE ampel.bewerte(p.persoog_bwa, 'personal', 'lina_betrieb', p.betrieb_key, p.zeitraum_von) END AS ampel_lina,
       p.betrieb_key
  FROM core.personalkosten p
  JOIN core.betrieb b ON b.betrieb_key = p.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = p.betrieb_key
  LEFT JOIN manual.betrieb_standort st ON st.betrieb_key = p.betrieb_key
  LEFT JOIN LATERAL (
        SELECT sw.schwelle_gruen, sw.schwelle_orange
          FROM core.schwellenwert_betrieb sw
         WHERE sw.betrieb_key = p.betrieb_key
           AND sw.bereich = 'personal'
           AND sw.gueltig_ab <= p.zeitraum_von
         ORDER BY sw.gueltig_ab DESC
         LIMIT 1) s ON true;

-- ----------------------------------------------------------------------------
-- 5. fixer_we = 0 heißt "kein Ansatz hinterlegt", nicht "Ware kostet nichts".
--
-- Mit nullif werden wareneinsatz_theoretisch und deckungsbeitrag NULL statt
-- voller Umsatz; jede Abdeckungs-Formel auf IS NOT NULL rechnet damit von
-- selbst richtig (real ~30 % statt angezeigter 100 %).
-- mart.deckungsbeitrag_warengruppe übernimmt das beim nächsten REFRESH.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.artikelverkauf AS
SELECT av.geschaeftstag,
       date_trunc('month', av.geschaeftstag)::date AS monat,
       b.betrieb_key,
       b.name AS betrieb,
       coalesce(b.stadt, st.ort) AS stadt,
       kz.hauptkonzept AS konzept,
       a.artikel_key,
       a.artikelnummer,
       coalesce(az.name, a.name) AS artikel,
       g.name  AS grosskategorie,
       mg.name AS warengruppe,
       d.name  AS detailkategorie,
       aw.artikel_key IS NOT NULL AND av.geschaeftstag < aw.erfasst_ab AS warengruppe_geschaetzt,
       av.menge,
       av.umsatz_netto,
       av.umsatz_brutto,
       av.verkaufspreis,
       nullif(az.fixer_we, 0) AS fixer_we,
       round(av.menge * nullif(az.fixer_we, 0), 2) AS wareneinsatz_theoretisch,
       round(av.umsatz_netto - av.menge * nullif(az.fixer_we, 0), 2) AS deckungsbeitrag
  FROM core.artikelverkauf_tag av
  JOIN core.betrieb b ON b.betrieb_key = av.betrieb_key
  JOIN core.artikel a ON a.artikel_key = av.artikel_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = av.betrieb_key
  LEFT JOIN manual.betrieb_standort st ON st.betrieb_key = av.betrieb_key
  LEFT JOIN core.artikel_stand_zeitraum az
         ON az.artikel_key = av.artikel_key
        AND av.geschaeftstag >= az.gilt_ab
        AND (az.gilt_bis IS NULL OR av.geschaeftstag < az.gilt_bis)
  LEFT JOIN core.artikel_warengruppe_zeitraum aw
         ON aw.artikel_key = av.artikel_key
        AND av.geschaeftstag >= aw.gilt_ab
        AND (aw.gilt_bis IS NULL OR av.geschaeftstag < aw.gilt_bis)
  LEFT JOIN core.warengruppe g  ON g.warengruppe_key  = aw.gross_key
  LEFT JOIN core.warengruppe mg ON mg.warengruppe_key = aw.mec_key
  LEFT JOIN core.warengruppe d  ON d.warengruppe_key  = aw.detail_key;

-- ----------------------------------------------------------------------------
-- 6. Einkaufspreise: ein Preisvergleich gilt nur innerhalb derselben Einheit.
--
-- lag() lief bisher über (ware, marke) — wechselte eine Ware von g auf kg,
-- wurde daraus +3.213.133 % "Teuerung". Zusätzlich `verdaechtig`: Sprünge
-- über ±100 % sind fast immer Buchungs- oder Einheitenfehler, und die Einheit
-- 'baseUnit' ist API-Jargon ohne geklärte Gebindesemantik.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.einkaufspreis_veraenderung AS
WITH mit_vormonat AS (
    SELECT p.ware, p.marke, p.einheit, p.monat,
           p.bestellungen, p.gebinde, p.menge, p.ausgaben,
           p.preis_je_gebinde, p.preis_min, p.preis_max, p.preis_je_einheit_median,
           lag(p.preis_je_gebinde) OVER (PARTITION BY p.ware, p.marke, p.einheit ORDER BY p.monat) AS vormonat_preis,
           lag(p.monat)            OVER (PARTITION BY p.ware, p.marke, p.einheit ORDER BY p.monat) AS vormonat
      FROM mart.einkaufspreis_monat p
)
SELECT ware, marke, einheit, monat,
       preis_je_gebinde AS preis,
       vormonat_preis,
       vormonat,
       CASE WHEN vormonat = (monat - interval '1 mon') AND vormonat_preis > 0
            THEN round(100.0 * (preis_je_gebinde - vormonat_preis) / vormonat_preis, 1)
       END AS veraenderung_pct,
       bestellungen, gebinde, menge, ausgaben,
       (einheit = 'baseUnit'
        OR (vormonat = (monat - interval '1 mon') AND vormonat_preis > 0
            AND abs(100.0 * (preis_je_gebinde - vormonat_preis) / vormonat_preis) > 100)) AS verdaechtig
  FROM mit_vormonat;

COMMENT ON COLUMN mart.einkaufspreis_veraenderung.verdaechtig IS
  'Sprung über ±100 % oder Einheit baseUnit — fast immer Einheiten-/Buchungsfehler, keine Teuerung. '
  'Karten zeigen diese Zeilen getrennt (Datenqualität), nicht als Preisentwicklung.';

-- ----------------------------------------------------------------------------
-- 7. Ladestand: fehlende Bestellungen sieht positionen_pct nicht.
--
-- Die Spalte misst die Positions-Tiefe je bereits geladener Bestellung. Ob
-- die Bestell-LISTE einer Marke vollständig ist, steht in der Warteschlange —
-- deshalb jetzt daneben. Enchilada zeigte "1 Bestellung / 100 %" für 2026-07,
-- während 600 Listen-Seiten offen waren.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.einkauf_ladestand AS
WITH seiten AS (
    SELECT w.marke_key,
           count(*) FILTER (WHERE w.erledigt_am IS NOT NULL) AS seiten_erledigt,
           count(*) FILTER (WHERE w.erledigt_am IS NULL)     AS seiten_offen
      FROM sync.warteschlange w
     WHERE w.endpunkt = 'fn:bestellungen'
     GROUP BY w.marke_key
)
SELECT m.name AS marke,
       date_trunc('month', b.bestellt_am)::date AS monat,
       count(*) AS bestellungen,
       count(*) FILTER (WHERE b.summe IS NOT NULL) AS mit_kopfdaten,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.bestellposition p
                                       WHERE p.bestellung_key = b.bestellung_key)) AS mit_positionen,
       round(100.0 * count(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.bestellposition p
                                                     WHERE p.bestellung_key = b.bestellung_key))::numeric
                   / count(*)::numeric, 1) AS positionen_pct,
       coalesce(s.seiten_erledigt, 0) AS seiten_erledigt,
       coalesce(s.seiten_offen, 0)    AS seiten_offen,
       coalesce(s.seiten_offen, 0) = 0 AS liste_vollstaendig
  FROM core.bestellung b
  JOIN core.kostenstelle k USING (kostenstelle_key)
  JOIN core.marke m ON m.marke_key = k.marke_key
  LEFT JOIN seiten s ON s.marke_key = m.marke_key
 WHERE b.bestellt_am IS NOT NULL
 GROUP BY m.name, date_trunc('month', b.bestellt_am), s.seiten_erledigt, s.seiten_offen;

COMMENT ON COLUMN mart.einkauf_ladestand.seiten_offen IS
  'Offene fn:bestellungen-Seiten der Marke. Solange hier etwas steht, fehlen ganze '
  'Bestellungen — egal was positionen_pct sagt. Die Seiten laufen je Kostenstelle '
  'chronologisch AUFSTEIGEND: es fehlen vor allem die jüngsten Monate.';

-- ----------------------------------------------------------------------------
-- 8. Import-Übersicht: ein Jahresfenster-Posten ist kein Datenstand.
--
-- getKennzahlen-Posten decken 2026-01-01..2026-12-31 ab und stehen auf 'ok' —
-- damit meldete geladen_bis den 31.12.2026 am 3. August. Gedeckelt auf heute.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.import_gesamt AS
WITH w AS (
    SELECT count(*) AS posten,
           count(*) FILTER (WHERE erledigt_am IS NOT NULL) AS erledigt,
           count(*) FILTER (WHERE erledigt_am IS NULL) AS offen,
           count(*) FILTER (WHERE ergebnis = 'aufgegeben') AS aufgegeben,
           count(*) FILTER (WHERE erledigt_am IS NULL AND prioritaet <= 10) AS offen_laufend,
           count(*) FILTER (WHERE erledigt_am IS NULL AND prioritaet >= 90) AS offen_historie,
           min(zeitraum_von) FILTER (WHERE ergebnis = 'ok') AS reicht_zurueck_bis,
           least(max(zeitraum_bis) FILTER (WHERE ergebnis = 'ok'), current_date) AS geladen_bis
      FROM sync.warteschlange
), takt AS (
    SELECT count(*) AS pro_stunde
      FROM sync.aufgabe
     WHERE beendet_am > now() - interval '1 hour'
       AND status IN ('ok', 'keine_daten')
), sperre AS (
    SELECT art, pausiert_bis, hinweis FROM sync.sperre_aktiv()
)
SELECT w.posten AS posten_gesamt,
       w.erledigt,
       w.offen,
       w.offen_laufend,
       w.offen_historie,
       w.aufgegeben,
       round(100.0 * w.erledigt::numeric / nullif(w.posten, 0)::numeric, 1) AS prozent,
       w.reicht_zurueck_bis,
       w.geladen_bis,
       t.pro_stunde AS tempo_pro_stunde,
       CASE WHEN t.pro_stunde > 0 THEN round(w.offen::numeric / t.pro_stunde::numeric, 1) END AS reststunden,
       CASE WHEN t.pro_stunde > 0
            THEN now() + (w.offen::numeric / t.pro_stunde::numeric)::double precision * interval '1 hour'
       END AS fertig_etwa,
       s.art AS sperre_art,
       s.pausiert_bis AS sperre_bis,
       s.hinweis AS sperre_hinweis
  FROM w
 CROSS JOIN takt t
  LEFT JOIN sperre s ON true;

-- Dasselbe je Bericht: geladen_bis gedeckelt (tage_alt war es schon). Dazu
-- der zweite Befund an dieser Sicht: prozent stand durch Rundung auf 100.0,
-- während Posten offen waren und der Zustand 'Fehler' hieß — 100 % gibt es
-- jetzt erst, wenn wirklich nichts mehr offen ist.
CREATE OR REPLACE VIEW mart.import_bericht AS
WITH warte AS (
    SELECT endpunkt,
           count(*) AS posten,
           count(*) FILTER (WHERE erledigt_am IS NOT NULL) AS erledigt,
           count(*) FILTER (WHERE erledigt_am IS NULL) AS offen,
           count(*) FILTER (WHERE ergebnis = 'ok') AS geladen,
           count(*) FILTER (WHERE ergebnis = 'keine_daten') AS keine_daten,
           count(*) FILTER (WHERE ergebnis = 'aufgegeben') AS aufgegeben,
           min(zeitraum_von) FILTER (WHERE ergebnis = 'ok') AS reicht_zurueck_bis,
           least(max(zeitraum_bis) FILTER (WHERE ergebnis = 'ok'), current_date) AS geladen_bis
      FROM sync.warteschlange
     GROUP BY endpunkt
), letzte AS (
    SELECT endpunkt,
           max(beendet_am) FILTER (WHERE status IN ('ok', 'keine_daten')) AS letzter_erfolg,
           count(*) FILTER (WHERE status = 'fehler' AND beendet_am > now() - interval '24 hours') AS fehler_24h,
           count(*) FILTER (WHERE beendet_am > now() - interval '24 hours') AS aufrufe_24h,
           round(avg(dauer_ms) FILTER (WHERE status = 'ok' AND beendet_am > now() - interval '24 hours'))::integer AS dauer_ms
      FROM sync.aufgabe
     GROUP BY endpunkt
), gestoppt AS (
    SELECT endpunkt, count(*) AS betriebe_pausiert
      FROM sync.fortschritt
     WHERE pausiert_bis > now()
     GROUP BY endpunkt
)
SELECT w.endpunkt,
       CASE WHEN w.offen = 0 THEN 100.0
            ELSE least(round(100.0 * w.erledigt::numeric / nullif(w.posten, 0)::numeric, 1), 99.9)
       END AS prozent,
       w.posten,
       w.erledigt,
       w.offen,
       w.geladen,
       w.keine_daten,
       w.aufgegeben,
       w.reicht_zurueck_bis,
       w.geladen_bis,
       current_date - least(w.geladen_bis, current_date) AS tage_alt,
       l.letzter_erfolg,
       round(extract(epoch FROM now() - l.letzter_erfolg) / 3600::numeric, 1) AS stunden_seit_erfolg,
       l.aufrufe_24h,
       l.fehler_24h,
       l.dauer_ms AS dauer_ms_schnitt,
       coalesce(g.betriebe_pausiert, 0::bigint) AS betriebe_pausiert,
       CASE WHEN w.offen = 0 THEN 'fertig'
            WHEN l.fehler_24h > 0 THEN 'Fehler'
            WHEN coalesce(g.betriebe_pausiert, 0::bigint) > 0 THEN 'teilweise pausiert'
            WHEN l.aufrufe_24h > 0 THEN 'laeuft'
            ELSE 'wartet'
       END AS zustand
  FROM warte w
  LEFT JOIN letzte l ON l.endpunkt = w.endpunkt
  LEFT JOIN gestoppt g ON g.endpunkt = w.endpunkt
 ORDER BY w.offen DESC, w.endpunkt;

-- ----------------------------------------------------------------------------
-- 9. Umsatz je Gast braucht gezählte Gäste.
--
-- 12 Betriebe liefern an über 90 % ihrer Umsatztage keine Gästezahl; deren
-- Monatsumsatz durch die Gäste der restlichen Tage zu teilen ergab 390 €
-- je Gast. Ab 20 % Lücke ist die Zahl keine Kennzahl mehr, sondern Zufall.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.umsatz_ytd AS
WITH monat AS (
    SELECT betrieb_key,
           date_trunc('month', geschaeftstag)::date AS monat,
           sum(umsatz_netto) AS umsatz,
           sum(rechnungen) AS rechnungen,
           sum(gaeste) AS gaeste,
           count(*) FILTER (WHERE umsatz_netto > 0) AS umsatztage,
           count(*) FILTER (WHERE umsatz_netto > 0 AND gaeste > 0) AS tage_mit_gaesten
      FROM core.umsatzbericht_tag
     WHERE hauptsparte_key IS NULL AND verkaufsstelle_key IS NULL
     GROUP BY betrieb_key, date_trunc('month', geschaeftstag)::date
), kumuliert AS (
    SELECT betrieb_key, monat, umsatz, rechnungen, gaeste, umsatztage, tage_mit_gaesten,
           sum(umsatz) OVER (PARTITION BY betrieb_key, date_trunc('year', monat)
                             ORDER BY monat) AS umsatz_ytd
      FROM monat
)
SELECT b.name AS betrieb,
       coalesce(b.stadt, st.ort) AS stadt,
       kz.hauptkonzept AS konzept,
       k.monat,
       k.umsatz AS umsatz_monat,
       v.umsatz AS umsatz_monat_vj,
       CASE WHEN v.umsatz > 0 THEN round((k.umsatz - v.umsatz) / v.umsatz * 100, 2) END AS umsatz_pct,
       k.umsatz_ytd,
       v.umsatz_ytd AS umsatz_ytd_vj,
       CASE WHEN v.umsatz_ytd > 0 THEN round((k.umsatz_ytd - v.umsatz_ytd) / v.umsatz_ytd * 100, 2) END AS umsatz_ytd_pct,
       k.rechnungen,
       k.gaeste,
       CASE WHEN k.rechnungen > 0 THEN round(k.umsatz / k.rechnungen, 2) END AS bon_schnitt,
       -- Nur wenn mindestens 80 % der Umsatztage eine Gästezahl tragen —
       -- sonst teilt man den Monat durch die Gäste weniger Tage.
       CASE WHEN k.gaeste > 0 AND k.umsatztage > 0
             AND k.tage_mit_gaesten >= 0.8 * k.umsatztage
            THEN round(k.umsatz / k.gaeste, 2) END AS umsatz_pro_gast,
       k.betrieb_key,
       k.umsatztage,
       k.tage_mit_gaesten,
       CASE WHEN k.umsatztage > 0
            THEN round(100.0 * k.tage_mit_gaesten / k.umsatztage, 1) END AS gaeste_abdeckung_pct
  FROM kumuliert k
  JOIN core.betrieb b ON b.betrieb_key = k.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = k.betrieb_key
  LEFT JOIN manual.betrieb_standort st ON st.betrieb_key = k.betrieb_key
  LEFT JOIN kumuliert v ON v.betrieb_key = k.betrieb_key
                       AND v.monat = (k.monat - interval '1 year')::date;

-- ----------------------------------------------------------------------------
-- 2./4./10. Round Table: Urteil nur, wo eines möglich ist — und schnell.
--
-- Der Umbau von round_table_monat zur materialisierten Sicht reißt die
-- abhängigen Sichten mit (CASCADE); sie werden unten identisch bzw. um
-- `operativ` erweitert wieder aufgebaut.
-- ----------------------------------------------------------------------------
DROP VIEW mart.round_table_monat CASCADE;

CREATE OR REPLACE VIEW mart.round_table_basis AS
WITH bwa AS (
    SELECT betrieb_key,
           monat,
           -- Quoten über 150 % sind kein Messwert, sondern ein fehlender
           -- Nenner beim Steuerberater (Extrem: 974 %). NULL statt rot.
           CASE WHEN abs(max(wert_prozent) FILTER (WHERE kennzahl = 'Personalkosten ohne GF')) <= 150
                THEN max(wert_prozent) FILTER (WHERE kennzahl = 'Personalkosten ohne GF') END AS personalkosten_ogf_pct,
           CASE WHEN abs(max(wert_prozent) FILTER (WHERE kennzahl = 'WE Bar')) <= 150
                THEN max(wert_prozent) FILTER (WHERE kennzahl = 'WE Bar') END AS we_bar_pct,
           CASE WHEN abs(max(wert_prozent) FILTER (WHERE kennzahl = 'WE Küche')) <= 150
                THEN max(wert_prozent) FILTER (WHERE kennzahl = 'WE Küche') END AS we_kueche_pct
      FROM mart.kennzahlen_aktuell
     GROUP BY betrieb_key, monat
    HAVING count(*) FILTER (WHERE wert_absolut IS NOT NULL AND wert_absolut <> 0) > 0
), monate AS (
    SELECT DISTINCT date_trunc('month', geschaeftstag)::date AS monat FROM core.umsatzbericht_tag
    UNION
    SELECT DISTINCT monat FROM bwa
), umsatz AS (
    SELECT betrieb_key,
           date_trunc('month', geschaeftstag)::date AS monat,
           sum(umsatz_netto) AS umsatz
      FROM core.umsatzbericht_tag
     WHERE hauptsparte_key IS NULL AND verkaufsstelle_key IS NULL
     GROUP BY betrieb_key, date_trunc('month', geschaeftstag)::date
)
SELECT b.betrieb_key,
       b.name AS betrieb,
       coalesce(b.stadt, stx.ort) AS stadt,
       kz.hauptkonzept AS konzept,
       m.monat,
       k.bwa_monat,
       u.umsatz AS umsatz_ist,
       v.umsatz AS umsatz_vj,
       -- Der laufende Monat bekommt kein Umsatz-Urteil: zwei Tage gegen den
       -- vollen Vorjahresmonat sind -92 %, egal wie das Geschäft läuft.
       CASE WHEN m.monat >= date_trunc('month', current_date)::date THEN NULL
            WHEN v.umsatz > 0 THEN mart.prozent_plausibel(round((u.umsatz - v.umsatz) / v.umsatz * 100, 2))
       END AS umsatz_pct,
       k.personalkosten_ogf_pct,
       k.we_bar_pct,
       k.we_kueche_pct,
       ob.bewertung AS online_bewertung,
       om.om_score,
       bs.status,
       -- Operativ IM MONAT: Umsatz vorhanden und weder Test noch Verwaltung.
       -- Ein heute geschlossenes Haus bleibt in seinen Betriebsjahren operativ
       -- (die Historie soll die damalige Flotte zeigen), fällt danach aber
       -- aus Zählern, Ranglisten und Marken-Medianen.
       (coalesce(u.umsatz, 0) > 0 AND bs.status NOT IN ('test', 'verwaltend')) AS operativ
  FROM core.betrieb b
 CROSS JOIN monate m
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = b.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = b.betrieb_key
  LEFT JOIN manual.betrieb_standort stx ON stx.betrieb_key = b.betrieb_key
  LEFT JOIN umsatz u ON u.betrieb_key = b.betrieb_key AND u.monat = m.monat
  LEFT JOIN umsatz v ON v.betrieb_key = b.betrieb_key AND v.monat = (m.monat - interval '1 year')::date
  LEFT JOIN LATERAL (
        SELECT w.monat AS bwa_monat, w.personalkosten_ogf_pct, w.we_bar_pct, w.we_kueche_pct
          FROM bwa w
         WHERE w.betrieb_key = b.betrieb_key
           AND w.monat <= m.monat
           -- Höchstens drei Monate Nachtrag. Eine BWA von 2025 erzeugt keine
           -- Eskalation für 2026 — der Betrieb fällt stattdessen ehrlich in
           -- "ohne Urteil", und bwa_alter_monate sagt jedem warum.
           AND w.monat >= (m.monat - interval '3 months')::date
         ORDER BY w.monat DESC
         LIMIT 1) k ON true
  LEFT JOIN LATERAL (
        SELECT o.bewertung
          FROM manual.online_bewertung o
         WHERE o.betrieb_key = b.betrieb_key AND o.monat = m.monat
         ORDER BY (o.quelle = 'yext') DESC, o.anzahl DESC NULLS LAST
         LIMIT 1) ob ON true
  LEFT JOIN manual.om_einschaetzung om ON om.betrieb_key = b.betrieb_key AND om.monat = m.monat
 WHERE b.aktiv;

-- Materialisiert: die Sicht rechnete bei jedem Kartenaufruf drei LATERALs
-- über 141 Betriebe × 104 Monate — dd_betrieb_kopf brauchte 8 bis 16
-- Sekunden. Als Tabelle sind es 14.664 Zeilen. Refresh im Sync-Nachlauf
-- (src/sync/round_table.ts), wie beim Deckungsbeitrag seit Migration 0027.
CREATE MATERIALIZED VIEW mart.round_table_monat AS
WITH bewertet AS (
    SELECT r.betrieb_key, r.betrieb, r.stadt, r.konzept, r.monat, r.bwa_monat,
           r.umsatz_ist, r.umsatz_vj, r.umsatz_pct,
           r.personalkosten_ogf_pct, r.we_bar_pct, r.we_kueche_pct,
           r.online_bewertung, r.om_score, r.status, r.operativ,
           ampel.bewerte(r.umsatz_pct,             'umsatz',    NULL, r.betrieb_key, r.bwa_monat) AS ampel_umsatz,
           ampel.bewerte(r.personalkosten_ogf_pct, 'personal',  NULL, r.betrieb_key, r.bwa_monat) AS ampel_personal,
           ampel.bewerte(r.we_bar_pct,             'we_bar',    NULL, r.betrieb_key, r.bwa_monat) AS ampel_we_bar,
           ampel.bewerte(r.we_kueche_pct,          'we_kueche', NULL, r.betrieb_key, r.bwa_monat) AS ampel_we_kueche,
           ampel.bewerte(r.online_bewertung,       'bewertung', NULL, r.betrieb_key, r.bwa_monat) AS ampel_bewertung,
           ampel.bewerte(r.om_score::numeric,      'om',        NULL, r.betrieb_key, r.bwa_monat) AS ampel_om
      FROM mart.round_table_basis r
)
SELECT bewertet.monat,
       bewertet.betrieb,
       coalesce(bewertet.konzept, '(nicht zugeordnet)') AS konzept,
       bewertet.stadt,
       bewertet.bwa_monat,
       bewertet.umsatz_ist,
       bewertet.umsatz_vj,
       bewertet.umsatz_pct,
       bewertet.personalkosten_ogf_pct,
       bewertet.we_bar_pct,
       bewertet.we_kueche_pct,
       bewertet.online_bewertung,
       bewertet.om_score,
       bewertet.ampel_umsatz,
       bewertet.ampel_personal,
       bewertet.ampel_we_bar,
       bewertet.ampel_we_kueche,
       bewertet.ampel_bewertung,
       bewertet.ampel_om,
       ampel.gesamt(x.st) AS gesamt,
       ampel.intensitaet(x.st) AS intensitaet,
       CASE WHEN ampel.gesamt(x.st) = 'rot' OR ampel.intensitaet(x.st) = 'Nachforschung'
            THEN 'Ja' ELSE 'Nein' END AS massnahme,
       CASE WHEN ampel.gesamt(x.st) = 'rot' THEN 'Hoch'
            WHEN ampel.intensitaet(x.st) = 'Nachforschung' THEN 'Mittel'
            ELSE 'Niedrig' END AS prioritaet,
       bewertet.betrieb_key,
       bewertet.status,
       bewertet.operativ,
       (extract(year FROM age(bewertet.monat, bewertet.bwa_monat)) * 12
        + extract(month FROM age(bewertet.monat, bewertet.bwa_monat)))::int AS bwa_alter_monate
  FROM bewertet,
       LATERAL (SELECT ARRAY[bewertet.ampel_umsatz, bewertet.ampel_personal,
                             bewertet.ampel_we_bar, bewertet.ampel_we_kueche,
                             bewertet.ampel_bewertung, bewertet.ampel_om]) x(st);

-- Eindeutiger Index: Voraussetzung für REFRESH CONCURRENTLY, damit während
-- des Neuaufbaus niemand vor einem gesperrten Dashboard sitzt.
CREATE UNIQUE INDEX round_table_monat_betrieb_monat
    ON mart.round_table_monat (betrieb_key, monat);
CREATE INDEX round_table_monat_monat ON mart.round_table_monat (monat);

COMMENT ON MATERIALIZED VIEW mart.round_table_monat IS
  'Round-Table-Urteile je Betrieb und Monat, materialisiert (Refresh im Sync-Nachlauf). '
  'operativ = Umsatz im Monat und weder Test noch Verwaltung — Zähler, Ranglisten und '
  'Mediane filtern darauf. bwa_alter_monate zeigt, wie alt die zugrunde liegende BWA ist '
  '(höchstens 3 Monate Nachtrag, ältere BWA ⇒ kein Personal-/WE-Urteil).';

-- Lange Form je Bereich — jetzt mit operativ/status für die Karten.
CREATE VIEW mart.ampel_bereich AS
WITH lang AS (
    SELECT r.monat, r.betrieb_key, r.betrieb, r.stadt, r.konzept, r.bwa_monat,
           r.gesamt, r.intensitaet, r.prioritaet, r.massnahme, r.status, r.operativ,
           b.bereich, b.bereich_name, b.reihenfolge, b.wert, b.ampel
      FROM mart.round_table_monat r
     CROSS JOIN LATERAL (VALUES
           ('umsatz',    'Umsatz',           1, r.umsatz_pct,             r.ampel_umsatz),
           ('personal',  'Personal',         2, r.personalkosten_ogf_pct, r.ampel_personal),
           ('we_bar',    'WE Bar',           3, r.we_bar_pct,             r.ampel_we_bar),
           ('we_kueche', 'WE Küche',         4, r.we_kueche_pct,          r.ampel_we_kueche),
           ('bewertung', 'Online-Bewertung', 5, r.online_bewertung,       r.ampel_bewertung),
           ('om',        'OM vor Ort',       6, r.om_score::numeric,      r.ampel_om)
       ) b(bereich, bereich_name, reihenfolge, wert, ampel)
)
SELECT l.monat, l.betrieb_key, l.betrieb, l.stadt, l.konzept, l.bwa_monat,
       l.bereich, l.bereich_name, l.reihenfolge, l.wert, l.ampel,
       be.emoji,
       coalesce(be.emoji || ' ' || be.bezeichnung, '– keine Daten') AS ampel_text,
       l.gesamt, l.intensitaet, l.prioritaet, l.massnahme,
       u.ursache_code,
       uk.bezeichnung AS ursache,
       u.notiz AS ursache_notiz,
       l.status, l.operativ
  FROM lang l
  LEFT JOIN ampel.beschriftung be ON be.status = l.ampel
  LEFT JOIN manual.ursache u ON u.betrieb_key = l.betrieb_key AND u.monat = l.monat AND u.bereich = l.bereich
  LEFT JOIN manual.ursache_katalog uk ON uk.ursache_code = u.ursache_code;

-- Ebenfalls materialisiert: die Fensterfunktionen liefen über die gesamte
-- lange Form (88.000 Zeilen × Fenster) bei jedem Aufruf von ② und ③.
CREATE MATERIALIZED VIEW mart.round_table_trend AS
WITH reihe AS (
    SELECT a.monat, a.betrieb_key, a.betrieb, a.stadt, a.konzept,
           a.bereich, a.bereich_name, a.reihenfolge, a.wert, a.ampel,
           a.status, a.operativ,
           lag(a.wert, 1)  OVER w AS wert_vormonat,
           lag(a.wert, 2)  OVER w AS wert_vorvormonat,
           lag(a.ampel, 1) OVER w AS ampel_vormonat
      FROM mart.ampel_bereich a
    WINDOW w AS (PARTITION BY a.betrieb_key, a.bereich ORDER BY a.monat)
), richtung AS (
    SELECT DISTINCT bereich, richtung
      FROM ampel.regel
     WHERE regelwerk_key = (SELECT regelwerk_key FROM ampel.regelwerk WHERE ist_standard LIMIT 1)
)
SELECT r.monat, r.betrieb_key, r.betrieb, r.stadt, r.konzept,
       r.bereich, r.bereich_name, r.reihenfolge,
       r.wert_vorvormonat, r.wert_vormonat, r.wert,
       round(r.wert - r.wert_vormonat, 2) AS veraenderung,
       CASE WHEN r.wert IS NULL OR r.wert_vormonat IS NULL THEN NULL
            WHEN g.richtung = 'niedriger_ist_besser' THEN
                 CASE WHEN r.wert <= r.wert_vormonat THEN '↗ besser/gleich' ELSE '↘ schlechter' END
            ELSE CASE WHEN r.wert >= r.wert_vormonat THEN '↗ besser/gleich' ELSE '↘ schlechter' END
       END AS trend,
       r.ampel,
       r.ampel_vormonat,
       CASE WHEN r.ampel IS NULL OR r.ampel_vormonat IS NULL THEN NULL
            WHEN r.ampel = r.ampel_vormonat THEN 'unveraendert'
            WHEN r.ampel = 'rot' THEN 'verschlechtert'
            WHEN r.ampel_vormonat = 'rot' THEN 'verbessert'
            WHEN r.ampel = 'gruen' THEN 'verbessert'
            ELSE 'verschlechtert'
       END AS ampelwechsel,
       r.status,
       r.operativ
  FROM reihe r
  LEFT JOIN richtung g ON g.bereich = r.bereich;

CREATE UNIQUE INDEX round_table_trend_eindeutig
    ON mart.round_table_trend (betrieb_key, bereich, monat);
CREATE INDEX round_table_trend_monat ON mart.round_table_trend (monat);

-- Ursachen-Verdichtung, unverändert wieder aufgebaut.
CREATE VIEW mart.ursachen_analyse AS
SELECT a.monat,
       uk.ursache_code,
       uk.bezeichnung AS ursache,
       uk.reihenfolge,
       count(*) FILTER (WHERE a.ampel IN ('rot', 'orange'))::integer AS faelle,
       count(*)::integer AS faelle_gesamt,
       count(*) FILTER (WHERE a.ampel = 'rot')::integer AS rot,
       count(*) FILTER (WHERE a.ampel = 'orange')::integer AS orange,
       count(*) FILTER (WHERE a.bereich = 'umsatz'    AND a.ampel IN ('rot', 'orange'))::integer AS umsatz,
       count(*) FILTER (WHERE a.bereich = 'personal'  AND a.ampel IN ('rot', 'orange'))::integer AS personal,
       count(*) FILTER (WHERE a.bereich = 'we_bar'    AND a.ampel IN ('rot', 'orange'))::integer AS we_bar,
       count(*) FILTER (WHERE a.bereich = 'we_kueche' AND a.ampel IN ('rot', 'orange'))::integer AS we_kueche,
       CASE WHEN count(*) FILTER (WHERE a.ampel IN ('rot', 'orange')) >= 3 THEN 'Hoch'
            WHEN count(*) FILTER (WHERE a.ampel IN ('rot', 'orange')) = 2 THEN 'Mittel'
            WHEN count(*) FILTER (WHERE a.ampel IN ('rot', 'orange')) > 0 THEN 'Niedrig'
       END AS prioritaet,
       string_agg(DISTINCT a.betrieb, ', ' ORDER BY a.betrieb)
           FILTER (WHERE a.ampel IN ('rot', 'orange')) AS betriebe
  FROM mart.ampel_bereich a
  JOIN manual.ursache_katalog uk ON uk.ursache_code = a.ursache_code
 GROUP BY a.monat, uk.ursache_code, uk.bezeichnung, uk.reihenfolge;

-- Marken-Schnitt: nur operative Betriebe. Vorher bestand die Marke "Besitos"
-- aus einer Verwaltungs-GmbH und einem Testladen — beide rot, Marke rot.
CREATE VIEW mart.konzept_schnitt_monat AS
SELECT monat,
       konzept,
       count(*)::integer AS betriebe,
       round(sum(umsatz_ist), 2) AS umsatz_ist,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY umsatz_pct::double precision)::numeric, 2) AS umsatz_pct,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY personalkosten_ogf_pct::double precision)::numeric, 2) AS personalkosten_ogf_pct,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY we_bar_pct::double precision)::numeric, 2) AS we_bar_pct,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY we_kueche_pct::double precision)::numeric, 2) AS we_kueche_pct,
       round(avg(online_bewertung), 2) AS online_bewertung,
       round(avg(om_score), 2) AS om_score,
       count(*) FILTER (WHERE gesamt = 'rot')::integer AS ampeln_rot,
       count(*) FILTER (WHERE gesamt = 'orange')::integer AS ampeln_orange,
       count(*) FILTER (WHERE gesamt = 'gruen')::integer AS ampeln_gruen,
       count(*) FILTER (WHERE gesamt IS NULL)::integer AS ohne_urteil,
       count(*) FILTER (WHERE massnahme = 'Ja')::integer AS massnahme_faellig
  FROM mart.round_table_monat
 WHERE operativ
 GROUP BY monat, konzept;

-- Standortkarte, unverändert wieder aufgebaut (liest jetzt die Materialisierung).
CREATE VIEW mart.standort AS
SELECT s.betrieb_key,
       b.name AS betrieb,
       kz.hauptkonzept AS konzept,
       s.ort,
       s.plz,
       s.strasse,
       s.breitengrad,
       s.laengengrad,
       s.genauigkeit,
       r.monat,
       r.gesamt AS ampel,
       coalesce(be.emoji, '⚪') AS ampel_emoji,
       coalesce(be.emoji, '⚪') || ' ' || coalesce(kz.hauptkonzept || ' — ', '') || b.name AS punkt,
       r.umsatz_ist AS umsatz,
       r.personalkosten_ogf_pct,
       r.we_bar_pct,
       r.we_kueche_pct,
       r.intensitaet,
       r.prioritaet
  FROM manual.betrieb_standort s
  JOIN core.betrieb b ON b.betrieb_key = s.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = s.betrieb_key
  LEFT JOIN mart.round_table_monat r ON r.betrieb_key = s.betrieb_key
  LEFT JOIN ampel.beschriftung be ON be.status = r.gesamt
 WHERE s.breitengrad IS NOT NULL;

-- Wechsel der GESAMT-Ampel. rt_ampelwechsel zeigte bisher nur Bereichswechsel;
-- "der Betrieb ist von grün auf rot gekippt" — die erste Frage jedes Round
-- Table — stand nirgends.
CREATE VIEW mart.round_table_gesamt_wechsel AS
WITH reihe AS (
    SELECT monat, betrieb_key, betrieb, konzept, stadt, gesamt, intensitaet, operativ,
           lag(gesamt) OVER (PARTITION BY betrieb_key ORDER BY monat) AS gesamt_vormonat
      FROM mart.round_table_monat
)
SELECT monat, betrieb_key, betrieb, konzept, stadt,
       gesamt_vormonat, gesamt, intensitaet, operativ,
       CASE WHEN gesamt = 'rot' OR (gesamt = 'orange' AND gesamt_vormonat = 'gruen')
            THEN 'verschlechtert' ELSE 'verbessert' END AS wechsel
  FROM reihe
 WHERE gesamt IS NOT NULL
   AND gesamt_vormonat IS NOT NULL
   AND gesamt <> gesamt_vormonat;

-- ----------------------------------------------------------------------------
-- 3. Die Arbeitsliste für unplausible Quoten meldet jetzt ab 150 %, nicht
--    erst ab 1000. Über 150 % ist keine Gastronomie-Quote mehr; die Ampel
--    oben ignoriert solche Werte, also muss die Liste sie zeigen.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.bwa_prozent_unplausibel AS
SELECT k.betrieb_key,
       b.name AS betrieb,
       b.aktiv,
       k.monat,
       k.kennzahl,
       k.wert_prozent,
       k.wert_absolut,
       u.wert_absolut AS umsatz_absolut,
       k.abgerufen_am
  FROM core.kennzahlen_monat k
  JOIN core.betrieb b USING (betrieb_key)
  LEFT JOIN core.kennzahlen_monat u
         ON u.betrieb_key = k.betrieb_key AND u.monat = k.monat
        AND u.kennzahl = 'Umsatz' AND u.abgerufen_am = k.abgerufen_am
 WHERE k.wert_prozent IS NOT NULL
   AND abs(k.wert_prozent) > 150;

-- ----------------------------------------------------------------------------
-- 11. Datenqualität: die Sichten zu den Löchern, die bisher niemand sah.
-- ----------------------------------------------------------------------------

-- Gruppenweite Umsatz-Lochtage. Der 22.07.2026 hatte 0 € über alle 141
-- Betriebe — jeder Verlauf zeigte einen erfundenen Absturz, und keine Karte
-- meldete es. Maßstab ist der Schnitt der 28 Vortage; die jüngsten Tage
-- laufen normal nach (LINA-Nachzügler-Fenster) und gehören deshalb dazu,
-- aber mit diesem Vorbehalt in der Karte.
CREATE VIEW mart.umsatz_lochtag AS
WITH tag AS (
    SELECT geschaeftstag,
           count(*) FILTER (WHERE umsatz_netto > 0) AS betriebe_mit_umsatz,
           sum(umsatz_netto) AS umsatz
      FROM core.umsatzbericht_tag
     WHERE hauptsparte_key IS NULL AND verkaufsstelle_key IS NULL
       AND geschaeftstag >= current_date - 120
     GROUP BY geschaeftstag
), erwartung AS (
    SELECT geschaeftstag, betriebe_mit_umsatz, umsatz,
           round(avg(betriebe_mit_umsatz)
                 OVER (ORDER BY geschaeftstag ROWS BETWEEN 28 PRECEDING AND 1 PRECEDING)) AS betriebe_erwartet
      FROM tag
)
SELECT geschaeftstag,
       (ARRAY['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'])
           [extract(isodow FROM geschaeftstag)::int] AS wochentag,
       betriebe_mit_umsatz,
       betriebe_erwartet,
       umsatz,
       CASE WHEN betriebe_mit_umsatz = 0 THEN 'komplett leer' ELSE 'lückenhaft' END AS befund
  FROM erwartung
 WHERE geschaeftstag < current_date
   AND betriebe_erwartet > 0
   AND betriebe_mit_umsatz < 0.6 * betriebe_erwartet
 ORDER BY geschaeftstag DESC;

COMMENT ON VIEW mart.umsatz_lochtag IS
  'Geschäftstage der letzten 120 Tage, an denen deutlich weniger Betriebe Umsatz melden '
  'als im 28-Tage-Schnitt davor. Die jüngsten ~6 Tage füllt LINA von selbst nach — ältere '
  'Zeilen sind echte Löcher und gehören neu eingereiht.';

-- Gäste-Abdeckung je Betrieb: wer liefert keine Gästezahlen? Für diese
-- Betriebe sind Umsatz je Gast und die Gäste-Kacheln bewusst leer.
CREATE VIEW mart.gaeste_abdeckung AS
SELECT u.betrieb_key,
       b.name AS betrieb,
       kz.hauptkonzept AS konzept,
       bs.status,
       count(*) FILTER (WHERE u.umsatz_netto > 0) AS umsatztage,
       count(*) FILTER (WHERE u.umsatz_netto > 0 AND u.gaeste > 0) AS tage_mit_gaesten,
       round(100.0 * count(*) FILTER (WHERE u.umsatz_netto > 0 AND u.gaeste > 0)
                   / nullif(count(*) FILTER (WHERE u.umsatz_netto > 0), 0), 1) AS abdeckung_pct,
       sum(u.umsatz_netto) FILTER (WHERE u.umsatz_netto > 0) AS umsatz_12m
  FROM core.umsatzbericht_tag u
  JOIN core.betrieb b ON b.betrieb_key = u.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = u.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = u.betrieb_key
 WHERE u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
   AND u.geschaeftstag >= current_date - 365
 GROUP BY u.betrieb_key, b.name, kz.hauptkonzept, bs.status
HAVING count(*) FILTER (WHERE u.umsatz_netto > 0) > 0;

-- Operative Betriebe ohne Yext-Zuordnung: deren Bewertungsampel bleibt grau,
-- und bisher stand das nirgends. Acht Betriebe, darunter eines mit 1,5 Mio €
-- Umsatz seit Juni.
CREATE VIEW mart.bewertung_fehlend AS
SELECT bs.betrieb_key,
       bs.betrieb,
       bs.konzept,
       bs.status,
       bs.letzter_umsatztag,
       u.umsatz_60_tage
  FROM mart.betrieb_status bs
  LEFT JOIN LATERAL (
        SELECT sum(umsatz_netto) AS umsatz_60_tage
          FROM core.umsatzbericht_tag
         WHERE betrieb_key = bs.betrieb_key
           AND hauptsparte_key IS NULL AND verkaufsstelle_key IS NULL
           AND geschaeftstag >= current_date - 60) u ON true
 WHERE bs.status = 'operativ'
   AND NOT EXISTS (SELECT 1 FROM manual.betrieb_fremd_id f
                    WHERE f.betrieb_key = bs.betrieb_key AND f.system = 'yext')
 ORDER BY u.umsatz_60_tage DESC NULLS LAST;
