/**
 * 0062 — Die Verdopplungen sind Gebindewechsel, und der Schwund misst Lücken
 *
 * ANLASS (12.08.2026): Durchsicht des Dashboards "Einkauf — Preise,
 * Lieferanten, Volumen" durch den Fachbereich. Drei Beobachtungen, alle drei
 * bestätigt und gegen die Serverbank nachgemessen.
 *
 * ---------------------------------------------------------------------
 * 1. "VIELE PREISE VERDOPPELN SICH EXAKT" — GEBINDEWECHSEL, KEINE TEUERUNG
 *
 * In der Karte "Was ist teurer geworden?" sind 41 von 200 Zeilen exakt
 * +100,0 Prozent, 39 davon exakt das Doppelte des Vormonats. Weil die Karte
 * nach Sprunggroesse sortiert, stehen sie ALLE GANZ OBEN — die ersten zehn
 * Zeilen sind ausnahmslos Verdopplungen.
 *
 * Die Ursache, an "Grana Padano Pdo Gehobelt 32% 500G" nachgemessen, im
 * SELBEN Monat (Juni 2026):
 *
 *     menge  gebinde_menge  Preis je Gebinde  Zeilen
 *       1          1              8,82          19
 *       1          2             17,64           5
 *
 * Dieselbe Ware, zwei Buchungsstile nebeneinander. Der Monatsmedian kippt
 * zwischen 8,82 und 17,64, je nachdem welcher Stil im Monat ueberwiegt — und
 * das meldet die Sicht als "100 Prozent teurer geworden".
 *
 * Es ist dieselbe Krankheit, gegen die 0056 die Sperre gebinde_uneinheitlich
 * gebaut hat; mart.einkaufspreis_monat kannte sie nicht.
 *
 * DAZU EIN FILTERFEHLER: verdaechtig markierte Spruenge UEBER +/-100 Prozent.
 * Exakt 100,0 rutschte durch die Luecke — also genau der haeufigste Fall.
 *
 * BEHOBEN mit zwei Ergaenzungen:
 *   - mart.einkaufspreis_monat traegt jetzt gebinde_typisch (Modus der
 *     Gebindegroesse im Monat) und gebinde_varianten.
 *   - mart.einkaufspreis_veraenderung markiert verdaechtig, wenn sich
 *     gebinde_typisch gegenueber dem Vormonat geaendert hat. Dann ist der
 *     Sprung kein Preis, sondern eine Umstellung.
 *   - Die Grenze rechnet ausserdem als VERHAELTNIS statt in Prozent. Die
 *     Prozentskala ist asymmetrisch: eine Verdopplung sind +100, eine
 *     Halbierung nur -50, ein Sturz auf ein Hundertstel -99. Nach unten
 *     konnte die alte Grenze nie greifen -- "Karotten Standart (10 Kg)"
 *     stand mit 62,90 auf 0,63 als unverdaechtig in der Liste.
 *
 * WARUM NICHT DER PREIS JE BASISEINHEIT STATTDESSEN: der waere gegen
 * Gebindewechsel immun, haengt aber an FoodNotifys Mengenangabe — genau der,
 * die 0040, 0042, 0060 und 0061 beschaeftigt hat. Der Gebindepreis bleibt
 * fuehrend (0041), er bekommt nur die fehlende Warnung.
 *
 * ---------------------------------------------------------------------
 * 2. "SCHWUND WIRKT ZU HOCH" — ER MISST DREI VERSCHIEDENE DINGE
 *
 * Gemeldet wurden Aposto Gera 80,2 Prozent, Freudenstadt 72,3, Koeln 60,0.
 * Ein Haus, das vier Fuenftel seines Warenwerts verliert, hat kein
 * Schwundproblem, sondern eine kaputte Messung. Drei Fehler uebereinander:
 *
 * (a) TESTINVENTUREN ZAEHLEN MIT. Von 358 Inventuren tragen 61 "Test" im
 *     Namen. "Test Inventur" bei Aposto Gera steht auf signed mit 285
 *     Positionen und geht voll in die Zahl ein.
 *
 * (b) TEILINVENTUREN GEGEN VOLLSORTIMENT. 155 Inventuren nennen einen
 *     Teilbereich im Namen ("Inventur Bar Juni", "Inventur Mai Kueche"). Wer
 *     nur die Bar zaehlt, dem fehlt die Kueche — und die zaehlt als Schwund.
 *     Konzernweit tragen 27.395 von 67.219 Positionen (42,6 Prozent) einen
 *     Sollbestand ohne jede Zaehlung; bei Aposto Gera haengen daran
 *     2,07 von 3,98 Mio EUR.
 *
 * (c) DER SOLLBESTAND SELBST IST AUFGEBLAEHT, und das erklaert, warum auch
 *     auf GEZAEHLTEN Positionen noch 94 Prozent uebrig bleiben:
 *
 *         TK Pizzateigling     Soll 971.750 g   gezaehlt 138.000 g
 *         Mozzarella gerieben  Soll 206.480 g   gezaehlt 101.000 g
 *         Thunfisch in Oel     Soll  92.650 g   gezaehlt  16.000 g
 *
 *     971 Kilo Pizzateig in einem Aposto. Der theoretische Bestand waechst
 *     mit jeder Lieferung; wird der Verbrauch nicht dagegen gebucht, misst
 *     "Schwund" nicht Verlust, sondern die Luecke in der Rezepturpflege.
 *
 * WAS DIESE MIGRATION LOEST UND WAS NICHT. (a) und (b) sind behoben: Tests
 * fliegen aus allen Kennzahlen, und gerechnet wird nur ueber Positionen, die
 * tatsaechlich gezaehlt wurden. (c) ist ein FoodNotify-Datenproblem und
 * BLEIBT — deshalb traegt die Sicht jetzt Spalten, die es sichtbar machen,
 * statt es zu verstecken. Solange soll_je_gezaehlt weit ueber 1 liegt, ist
 * keine Schwundzahl belastbar.
 *
 * EINE UNSCHAERFE, DIE BLEIBT: eine Position, die ehrlich mit 0 gezaehlt
 * wurde, ist von einer nie gezaehlten nicht zu unterscheiden — FoodNotify
 * liefert beides als 0. Die Einschraenkung auf gezaehlte Positionen
 * UNTERSCHAETZT den Schwund deshalb eher, als ihn zu uebertreiben. Das ist
 * die sichere Richtung und steht hier, damit niemand sie fuer Genauigkeit
 * haelt.
 */


-- ---------------------------------------------------------------------
-- 1a. Die Gebindegroesse gehoert in die Monatssicht
--
-- Neue Spalten stehen am ENDE: CREATE OR REPLACE VIEW darf nur anhaengen,
-- und mart.einkaufspreis_veraenderung haengt an dieser Sicht.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.einkaufspreis_monat AS
WITH basis AS (
    SELECT
        w.name  AS ware,
        m.name  AS marke,
        bp.einheit,
        date_trunc('month', b.bestellt_am)::date AS monat,
        bp.menge,
        bp.gebinde_menge,
        bp.summe_preis,
        bp.gesamt_menge,
        bp.preis_je_einheit,
        bp.summe_preis / bp.menge AS preis_je_gebinde
      FROM core.bestellposition bp
      JOIN core.bestellung b USING (bestellung_key)
      JOIN core.kostenstelle k USING (kostenstelle_key)
      JOIN core.marke m ON m.marke_key = k.marke_key
      JOIN core.ware  w ON w.ware_key = bp.ware_key
     WHERE b.bestellt_am IS NOT NULL
       AND bp.menge > 0 AND bp.summe_preis > 0
       AND b.status IS DISTINCT FROM 'canceled'
), streuung AS (
    SELECT ware, percentile_cont(0.5) WITHIN GROUP (
             ORDER BY preis_je_gebinde)::numeric AS median_gesamt,
           count(*) AS belege
      FROM basis GROUP BY ware
), bereinigt AS (
    SELECT b.* FROM basis b JOIN streuung s USING (ware)
     WHERE s.belege < 4
        OR (b.preis_je_gebinde <= s.median_gesamt * 20
        AND b.preis_je_gebinde * 20 >= s.median_gesamt)
)
SELECT
    ware, marke, einheit, monat,
    count(*)                       AS bestellungen,
    sum(menge)                     AS gebinde,
    sum(gesamt_menge)              AS menge,
    sum(summe_preis)               AS ausgaben,
    round(percentile_cont(0.5) WITHIN GROUP (
        ORDER BY preis_je_gebinde)::numeric, 2) AS preis_je_gebinde,
    round(min(preis_je_gebinde)::numeric, 2)    AS preis_min,
    round(max(preis_je_gebinde)::numeric, 2)    AS preis_max,
    round(percentile_cont(0.5) WITHIN GROUP (
        ORDER BY preis_je_einheit)::numeric, 4) AS preis_je_einheit_median,
    -- NEU (0062). MODUS und nicht Durchschnitt: die Gebindegroesse ist keine
    -- Groesse mit Streuung, sondern eine Angabe, die stimmt oder nicht --
    -- dieselbe Begruendung wie in core.gebinde_vereinheitlichen() (0040).
    mode() WITHIN GROUP (ORDER BY gebinde_menge) AS gebinde_typisch,
    count(DISTINCT gebinde_menge)                AS gebinde_varianten
  FROM bereinigt
 GROUP BY ware, marke, einheit, monat;

COMMENT ON VIEW mart.einkaufspreis_monat IS
'Einkaufspreis je Ware und Monat. FUEHREND ist der Preis je GEBINDE (was ein
bestellter Karton gekostet hat) -- er braucht nur sumPrice und Menge und ist
damit belastbar. Der Preis je Basiseinheit steht daneben, wo FoodNotifys
Gebindeangabe verwertbar war; sie schwankt fuer dieselbe Ware um Faktor 140.000.
Gruppiert ueber den NAMEN: FoodNotify vergibt je Betrieb eigene Waren-IDs.
STORNIERTE Bestellungen sind ausgeschlossen (Migration 0043).
SEIT 0062 MIT gebinde_typisch: derselbe Artikel wird im selben Monat mit
verschiedenen Gebindegroessen gebucht (Grana Padano 8,82 bei gebinde_menge 1
und 17,64 bei 2). Der Median kippt dann zwischen beiden, und das sieht wie eine
Preisverdopplung aus. Wer zwei Monate vergleicht, muss gebinde_typisch
mitvergleichen -- mart.einkaufspreis_veraenderung tut das.';

COMMENT ON COLUMN mart.einkaufspreis_monat.gebinde_typisch IS
'Haeufigste Gebindegroesse dieser Ware im Monat (Modus). Aendert sie sich von
Monat zu Monat, ist ein Preissprung eine Umstellung und keine Teuerung.';
COMMENT ON COLUMN mart.einkaufspreis_monat.gebinde_varianten IS
'Wie viele verschiedene Gebindegroessen im Monat gebucht wurden. Ueber 1 heisst:
der Median steht zwischen zwei Buchungsstilen und ist entsprechend wackelig.';


-- ---------------------------------------------------------------------
-- 1b. Ein Gebindewechsel ist kein Preissprung
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.einkaufspreis_veraenderung AS
WITH mit_vormonat AS (
    SELECT p.ware, p.marke, p.einheit, p.monat,
           p.bestellungen, p.gebinde, p.menge, p.ausgaben,
           p.preis_je_gebinde, p.preis_min, p.preis_max, p.preis_je_einheit_median,
           p.gebinde_typisch, p.gebinde_varianten,
           lag(p.preis_je_gebinde) OVER w AS vormonat_preis,
           lag(p.monat)            OVER w AS vormonat,
           lag(p.gebinde_typisch)  OVER w AS vormonat_gebinde
      FROM mart.einkaufspreis_monat p
    WINDOW w AS (PARTITION BY p.ware, p.marke, p.einheit ORDER BY p.monat)
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
        /*
         * 0062: ALS VERHAELTNIS UND NICHT IN PROZENT.
         *
         * Vorher stand hier abs(veraenderung_pct) > 100. Das ist in zwei
         * Richtungen falsch. Erstens rutschte exakt 100,0 durch die Luecke —
         * und das war die haeufigste Auspraegung ueberhaupt, 41 von 200
         * Zeilen. Zweitens, und schwerer: die Prozentskala ist ASYMMETRISCH.
         * Eine Verdopplung sind +100 Prozent, eine Halbierung nur -50, und
         * ein Sturz auf ein Hundertstel sind -99. Nach unten konnte die
         * Grenze also NIE greifen, egal wie absurd der Sprung war. Gemessen
         * blieb "Karotten Standart (10 Kg)" mit 62,90 auf 0,63 stehen —
         * Faktor 100, und die Zeile galt als unverdaechtig.
         *
         * Das Verhaeltnis ist symmetrisch: Faktor 2 in beide Richtungen.
         */
        OR (vormonat = (monat - interval '1 mon') AND vormonat_preis > 0
            AND (preis_je_gebinde >= vormonat_preis * 2
              OR preis_je_gebinde * 2 <= vormonat_preis))
        -- 0062: der eigentliche Fund. Hat sich die typische Gebindegroesse
        -- geaendert, vergleicht die Zeile zwei verschiedene Dinge.
        OR gebinde_typisch IS DISTINCT FROM vormonat_gebinde
        -- ... und wenn im Monat selbst zwei Stile nebeneinander laufen, steht
        -- der Median zwischen ihnen und springt schon beim naechsten Beleg.
        OR gebinde_varianten > 1) AS verdaechtig,
       -- NEU am Ende (CREATE OR REPLACE darf nur anhaengen).
       gebinde_typisch,
       vormonat_gebinde,
       gebinde_varianten,
       (gebinde_typisch IS DISTINCT FROM vormonat_gebinde) AS gebinde_gewechselt
  FROM mit_vormonat;

COMMENT ON COLUMN mart.einkaufspreis_veraenderung.verdaechtig IS
'Preis mindestens verdoppelt ODER hoechstens halbiert (Verhaeltnis, nicht
Prozent -- die Prozentskala ist asymmetrisch und liess nach unten alles durch,
auch einen Sturz um Faktor 100), Einheit baseUnit, gewechselte Gebindegroesse
oder mehrere Gebindegroessen im selben Monat. SEIT 0062 sind die letzten beiden dabei: 41 von
200 Zeilen der Karte waren exakt +100,0 % und standen ganz oben -- durchweg
Gebindewechsel, keine Teuerung. Karten zeigen diese Zeilen getrennt
(Datenqualitaet), nicht als Preisentwicklung.';
COMMENT ON COLUMN mart.einkaufspreis_veraenderung.gebinde_gewechselt IS
'true = die haeufigste Gebindegroesse ist eine andere als im Vormonat. Dann
vergleicht veraenderung_pct einen Karton mit einer Kiste.';


-- ---------------------------------------------------------------------
-- 2. Schwund: Tests raus, nur gezaehlte Positionen, Rest sichtbar machen
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.inventur_schwund AS
WITH inv AS (
    SELECT i.inventur_key, i.status, i.erstellt_am, k.betrieb_key, k.marke_key,
           -- Testinventuren. 61 von 358 tragen es im Namen, und eine davon
           -- steht auf signed mit 285 Positionen.
           (i.name ILIKE '%test%') AS ist_test,
           -- Teilinventuren: wer nur die Bar zaehlt, dem fehlt die Kueche --
           -- und die zaehlt sonst als Schwund. Nur ein Hinweis, kein
           -- Ausschluss: der Name ist eine Gewohnheit, keine Zusicherung.
           (i.name ~* '(bar|k[uü]che|keller|lager|getr[aä]nke)') AS ist_teilbereich
      FROM core.inventur i
      JOIN core.kostenstelle k USING (kostenstelle_key)
     WHERE i.status IS DISTINCT FROM 'canceled'
), pos AS (
    SELECT v.*, p.soll_menge, p.gezaehlt_menge, p.preis_je_basiseinheit,
           -- Eine ehrlich mit 0 gezaehlte Position ist von einer nie
           -- gezaehlten nicht zu unterscheiden; FoodNotify liefert beides
           -- als 0. Die Einschraenkung unterschaetzt den Schwund also eher.
           (coalesce(p.gezaehlt_menge, 0) <> 0) AS gezaehlt,
           (v.status = 'signed' AND NOT v.ist_test) AS zaehlt_mit
      FROM inv v
      LEFT JOIN core.inventurposition p ON p.inventur_key = v.inventur_key
)
SELECT
    bt.betrieb_key,
    bt.name AS betrieb,
    m.name  AS marke,
    date_trunc('month', p.erstellt_am)::date AS monat,
    count(DISTINCT p.inventur_key) FILTER (WHERE NOT p.ist_test)  AS inventuren,
    count(DISTINCT p.inventur_key) FILTER (WHERE p.zaehlt_mit)    AS inventuren_signiert,
    -- Die Euro-Spalten rechnen NUR ueber tatsaechlich gezaehlte Positionen.
    round(sum(p.soll_menge * p.preis_je_basiseinheit)
        FILTER (WHERE p.zaehlt_mit AND p.gezaehlt)::numeric, 2)   AS soll_eur,
    round(sum(p.gezaehlt_menge * p.preis_je_basiseinheit)
        FILTER (WHERE p.zaehlt_mit AND p.gezaehlt)::numeric, 2)   AS gezaehlt_eur,
    round(sum((p.soll_menge - p.gezaehlt_menge) * p.preis_je_basiseinheit)
        FILTER (WHERE p.zaehlt_mit AND p.gezaehlt)::numeric, 2)   AS schwund_eur,
    -- Prozent als Zahl (23.64), nie als Bruch — AGENTS.md Regel 6.
    CASE WHEN sum(p.soll_menge * p.preis_je_basiseinheit)
              FILTER (WHERE p.zaehlt_mit AND p.gezaehlt) > 0
         THEN round((100 * sum((p.soll_menge - p.gezaehlt_menge) * p.preis_je_basiseinheit)
                         FILTER (WHERE p.zaehlt_mit AND p.gezaehlt)
                    / sum(p.soll_menge * p.preis_je_basiseinheit)
                         FILTER (WHERE p.zaehlt_mit AND p.gezaehlt))::numeric, 2)
    END AS schwund_pct,
    -- NEU am Ende: was ausgeschlossen wurde und warum die Zahl wackelt.
    count(DISTINCT p.inventur_key) FILTER (WHERE p.ist_test)          AS inventuren_test,
    count(DISTINCT p.inventur_key) FILTER (WHERE p.ist_teilbereich
                                             AND NOT p.ist_test)      AS inventuren_teilbereich,
    count(*) FILTER (WHERE p.zaehlt_mit AND p.soll_menge IS NOT NULL) AS positionen,
    count(*) FILTER (WHERE p.zaehlt_mit AND p.soll_menge IS NOT NULL
                       AND NOT p.gezaehlt)                            AS positionen_ohne_zaehlung,
    round(sum(p.soll_menge * p.preis_je_basiseinheit)
        FILTER (WHERE p.zaehlt_mit AND NOT p.gezaehlt)::numeric, 2)   AS soll_eur_ohne_zaehlung,
    -- Der Kanarienvogel fuer Punkt (c): Soll durch Gezaehlt. Ein Haus, das
    -- sechsmal so viel im Soll hat wie im Regal, hat kein Schwundproblem.
    CASE WHEN sum(p.gezaehlt_menge * p.preis_je_basiseinheit)
              FILTER (WHERE p.zaehlt_mit AND p.gezaehlt) > 0
         THEN round((sum(p.soll_menge * p.preis_je_basiseinheit)
                         FILTER (WHERE p.zaehlt_mit AND p.gezaehlt)
                    / sum(p.gezaehlt_menge * p.preis_je_basiseinheit)
                         FILTER (WHERE p.zaehlt_mit AND p.gezaehlt))::numeric, 2)
    END AS soll_je_gezaehlt
  FROM pos p
  JOIN core.marke   m  ON m.marke_key   = p.marke_key
  JOIN core.betrieb bt ON bt.betrieb_key = p.betrieb_key
 GROUP BY bt.betrieb_key, bt.name, m.name, date_trunc('month', p.erstellt_am);

COMMENT ON VIEW mart.inventur_schwund IS
'Bewerteter Schwund je Betrieb und Monat. SEIT 0062 GRUNDLEGEND ENGER GEFASST,
weil die Sicht vorher drei verschiedene Dinge in einer Zahl vermischt hat:
 (a) TESTINVENTUREN sind raus. 61 von 358 tragen "Test" im Namen, eine davon
     signiert mit 285 Positionen. Sie stehen in inventuren_test.
 (b) GERECHNET WIRD NUR UEBER GEZAEHLTE POSITIONEN. 27.395 von 67.219
     Positionen tragen ein Soll ohne jede Zaehlung -- eine nicht gezaehlte
     Position ist kein Schwund, sondern eine Luecke. Was so herausfaellt,
     steht in positionen_ohne_zaehlung und soll_eur_ohne_zaehlung.
     Teilinventuren ("Inventur Bar Juni") sind der haeufigste Grund und in
     inventuren_teilbereich gezaehlt.
 (c) NICHT GELOEST: der theoretische Bestand selbst ist aufgeblaeht. Gemessen
     971.750 g Pizzateig gegen 138.000 g gezaehlt. Wird der Verbrauch nicht
     gegen den Bestand gebucht, waechst das Soll mit jeder Lieferung.
     soll_je_gezaehlt macht es sichtbar: liegt der Wert weit ueber 1, ist
     KEINE Schwundzahl dieser Zeile belastbar.
NUR SIGNIERTE Inventuren zaehlen in den Euro-Spalten, stornierte sind ganz
ausgeschlossen. Eine flaechige Aussage ueber alle Marken bleibt unmoeglich:
Inventuren gibt es praktisch nur bei Wilma Wunder.';

COMMENT ON COLUMN mart.inventur_schwund.soll_je_gezaehlt IS
'Sollwert geteilt durch gezaehlten Wert. Nahe 1 = plausibel. Weit darueber =
der theoretische Bestand ist aufgeblaeht und die Schwundzahl daneben wertlos.';
COMMENT ON COLUMN mart.inventur_schwund.positionen_ohne_zaehlung IS
'Positionen mit Sollbestand, die niemand gezaehlt hat. Sie sind aus den
Euro-Spalten heraus -- hier steht, wie viele es waren.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0062', to_jsonb(
        'Preisverdopplungen sind Gebindewechsel: 41 von 200 Zeilen der Karte '
        '"Was ist teurer geworden?" waren exakt +100,0 % und standen ganz oben. '
        'gebinde_typisch in einkaufspreis_monat, verdaechtig bei Gebindewechsel, '
        'Grenze >= statt > 100. Schwund: Testinventuren raus (61 von 358), nur '
        'gezaehlte Positionen (27.395 von 67.219 hatten Soll ohne Zaehlung), und '
        'soll_je_gezaehlt zeigt den aufgeblaehten Sollbestand, der bleibt.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
