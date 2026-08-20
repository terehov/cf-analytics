-- =====================================================================
-- 0093 — Geschlossene Betriebe raus aus der Kalenderauswertung
--
-- ANLASS (Eugene, 21.08.2026): "Enchi-Gruppe geschlossene ausschliessen."
--
-- Das ist kein Betrieb, sondern ein KONZEPT in mart.konzept_zuordnung —
-- der Sammelposten fuer geschlossene und insolvente Enchilada-Betriebe.
-- Am 21.08.2026 nachgezaehlt: 34 Betriebe, davon 0 mit Umsatz in den
-- letzten 90 Tagen. Die Namen sagen es selbst ("GESCHLOSSEN Enchilada
-- Kassel", "INSOLVENT - Enchilada Giessen").
--
-- WARUM DAS DIE ZAHLEN SPUERBAR AENDERT, obwohl es wenige Tage sind:
-- gemessen am 21.08.2026 ueber die Feiertagszeilen mit Landeskalender
--
--   Feiertag                 Tage  davon geschl.   mit      ohne
--   Neujahr                   186        3       -68,7 %   -97,3 %
--   1. Weihnachtsfeiertag     143        3        -0,4 %    +5,8 %
--   Pfingstmontag             190        3       +52,4 %   +54,8 %
--   Karfreitag                188        3       -32,1 %   -32,1 %
--
-- Drei von 186 Tagen verschieben Neujahr um 28 Punkte. Der Grund ist
-- nicht das Gewicht dieser Betriebe, sondern die VERTEILUNG: an Neujahr
-- steht ein grosser Teil der Gruppe bei -100 % (geschlossen), und der
-- Median sitzt genau auf dieser Kante. Wer die Neujahrszahl liest, liest
-- keinen typischen Betrieb, sondern die Grenze zwischen "hat auf" und
-- "hat zu". Das gehoert in den Sichtkommentar, sonst zitiert es jemand
-- als Umsatzrueckgang.
--
-- ALS DATEN, NICHT ALS NAME IM SQL. Der Ausschluss steht in
-- manual.kalender_ausschluss und ist ueber pflege/ ohne Migration
-- aenderbar — dieselbe Bauart wie manual.wetter_klasse. Es gibt naemlich
-- drei weitere Konzepte mit derselben Signatur (0 aktive Betriebe):
-- Franchisegebergesellschaften (17), Sonstige Enchilada Gruppe (9),
-- Ghost Kitchen (3). Sie bleiben vorerst DRIN, weil danach nicht gefragt
-- war; sie stehen in mart.kalender_ausschluss_kandidaten und sind eine
-- Zeile in der CSV entfernt.
--
-- WAS NICHT PASSIERT: mart.vergleichstag_basis bleibt vollstaendig. Die
-- Rohebene verliert keine Zeile — ausgeschlossen wird erst in der
-- Auswertungsschicht. Wer einen geschlossenen Betrieb nachsehen will,
-- kann das weiterhin (Regel 10: sichtbar machen, nicht verschwinden
-- lassen).
-- =====================================================================


CREATE TABLE IF NOT EXISTS manual.kalender_ausschluss (
  hauptkonzept text PRIMARY KEY,
  grund        text NOT NULL,
  gepflegt_am  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE manual.kalender_ausschluss IS
'Konzepte, die aus der Kalender- und Wetterauswertung herausfallen — Sammelposten fuer '
'geschlossene, insolvente oder nicht operative Betriebe. Gepflegt ueber '
'pflege/kalender_ausschluss.csv. Betrifft NUR die Auswertungsschicht '
'(mart.kalendertag_lage, mart.wettertag_lage); mart.vergleichstag_basis bleibt '
'vollstaendig.';

INSERT INTO manual.kalender_ausschluss (hauptkonzept, grund) VALUES
  ('Enchi-Gruppe geschlossene',
   'Sammelposten fuer geschlossene und insolvente Betriebe; 34 Betriebe, 0 mit laufendem Umsatz (21.08.2026)')
ON CONFLICT (hauptkonzept) DO NOTHING;


-- ---------------------------------------------------------------------
-- Was NICHT ausgeschlossen ist, aber danach aussieht (Regel 10)
--
-- Ein Ausschluss, den niemand nachvollziehen kann, ist eine stille
-- Filterung. Diese Sicht zeigt beide Seiten: was draussen ist, und was
-- dieselbe Signatur traegt und trotzdem drin ist.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.kalender_ausschluss_kandidaten AS
SELECT k.hauptkonzept,
       count(*)::int AS betriebe,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM mart.umsatz_tag u
          WHERE u.betrieb_key = k.betrieb_key
            AND u.geschaeftstag >= current_date - 90
            AND u.umsatz_netto > 0))::int AS mit_laufendem_umsatz,
       (a.hauptkonzept IS NOT NULL) AS ausgeschlossen,
       a.grund
  FROM mart.konzept_zuordnung k
  LEFT JOIN manual.kalender_ausschluss a ON a.hauptkonzept = k.hauptkonzept
 WHERE k.hauptkonzept IS NOT NULL
 GROUP BY k.hauptkonzept, a.hauptkonzept, a.grund
HAVING count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM mart.umsatz_tag u
          WHERE u.betrieb_key = k.betrieb_key
            AND u.geschaeftstag >= current_date - 90
            AND u.umsatz_netto > 0)) = 0
 ORDER BY 4 DESC, 2 DESC;

COMMENT ON VIEW mart.kalender_ausschluss_kandidaten IS
'Konzepte ohne einen einzigen Betrieb mit laufendem Umsatz. ausgeschlossen = true sind '
'die, die manual.kalender_ausschluss kennt; false heisst: sie zaehlen in den Kacheln von '
'⑫ weiterhin mit, obwohl kein Betrieb darin noch arbeitet. Das ist keine Fehlermeldung, '
'sondern eine Entscheidungsliste — eine Zeile in pflege/kalender_ausschluss.csv genuegt.';


-- ---------------------------------------------------------------------
-- Die Auswertungsschicht filtert
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.kalendertag_lage AS
SELECT v.betrieb_key, v.betrieb, v.geschaeftstag, v.kalender_quelle,
       v.bundesland, v.abweichung_pct, v.umsatz_netto, v.umsatz_vergleich,
       l.kategorie, l.auspraegung
  FROM mart.vergleichstag_basis v
  CROSS JOIN LATERAL (VALUES
        ('feiertag',   CASE WHEN v.ist_feiertag THEN v.feiertag END),
        ('wochentag',  v.wochentag),
        ('ferienlage', CASE
             WHEN v.ist_schulferien IS NULL          THEN NULL
             WHEN v.ferien_abweichung = 0            THEN 'gleiche Ferienlage'
             WHEN v.ferien_abweichung < 4            THEN 'gemischte Ferienlage'
             WHEN v.ist_schulferien                  THEN 'Tag in den Ferien, Vergleichstage nicht'
                                                     ELSE 'Tag ausserhalb, Vergleichstage in den Ferien'
           END),
        ('brueckentag', CASE
             WHEN v.ist_feiertag                     THEN NULL
             WHEN v.folgetag_feiertag AND v.vortag_feiertag THEN 'zwischen zwei Feiertagen'
             WHEN v.folgetag_feiertag                THEN 'Tag vor einem Feiertag'
             WHEN v.vortag_feiertag                  THEN 'Tag nach einem Feiertag'
                                                     ELSE 'gewoehnlicher Tag'
           END)
       ) AS l(kategorie, auspraegung)
 WHERE v.vergleichstage = 4
   AND v.abweichung_pct IS NOT NULL
   AND l.auspraegung IS NOT NULL
   AND v.geschaeftstag >= (SELECT von FROM mart.kalender_zeitraum)
   -- Seit 0093: geschlossene Sammelposten raus. NOT EXISTS statt NOT IN,
   -- damit ein NULL-Konzept den Betrieb nicht stillschweigend mit
   -- herauswirft — zehn Betriebe haben keins.
   AND NOT EXISTS (
         SELECT 1 FROM mart.konzept_zuordnung z
           JOIN manual.kalender_ausschluss a ON a.hauptkonzept = z.hauptkonzept
          WHERE z.betrieb_key = v.betrieb_key);

COMMENT ON VIEW mart.kalendertag_lage IS
'Jeder auswertbare Tag in seinen vier Lagen: Feiertag, Wochentag, Ferienlage, '
'Brueckentag. Ein Tag steht in mehreren Zeilen. Seit 0093 ohne die Konzepte aus '
'manual.kalender_ausschluss (geschlossene Betriebe) — mart.vergleichstag_basis darunter '
'bleibt vollstaendig. Karten mit Marken- oder Zeitraumfilter rechnen HIER mit '
'percentile_cont, nicht auf dem fertigen Median.';


CREATE OR REPLACE VIEW mart.wettertag_lage AS
SELECT v.betrieb_key, v.betrieb, v.geschaeftstag, v.abweichung_pct,
       w.fenster_temp_max, w.fenster_niederschlag, w.sonne_abweichung_pp,
       k.kategorie, k.klasse, k.reihenfolge
  FROM mart.vergleichstag_basis v
  JOIN mart.betrieb_wetter_tag w
    ON w.betrieb_key = v.betrieb_key AND w.geschaeftstag = v.geschaeftstag
  CROSS JOIN LATERAL (VALUES
        ('temperatur',   w.fenster_temp_max),
        ('niederschlag', w.fenster_niederschlag),
        ('sonne',        w.sonne_abweichung_pp)
       ) AS m(kategorie, wert)
  JOIN manual.wetter_klasse k
    ON k.kategorie = m.kategorie
   AND (k.von IS NULL OR m.wert >= k.von)
   AND (k.bis IS NULL OR m.wert <  k.bis)
 WHERE v.vergleichstage = 4
   AND v.abweichung_pct IS NOT NULL
   AND m.wert IS NOT NULL
   AND w.stunden_fenster = 16
   AND v.geschaeftstag >= (SELECT von FROM mart.kalender_zeitraum)
   AND NOT EXISTS (
         SELECT 1 FROM mart.konzept_zuordnung z
           JOIN manual.kalender_ausschluss a ON a.hauptkonzept = z.hauptkonzept
          WHERE z.betrieb_key = v.betrieb_key);

COMMENT ON VIEW mart.wettertag_lage IS
'Jeder auswertbare Tag in seinen drei Wetterlagen. Dieselben Filter wie '
'mart.kalendertag_lage — vier saubere Vergleichstage, derselbe rollierende Zeitraum, '
'seit 0093 ohne die geschlossenen Sammelposten —, damit Kalender- und Wetterzahlen '
'nebeneinander lesbar sind. stunden_fenster = 16 schliesst Tage mit Messluecken aus.';


COMMENT ON COLUMN mart.kalendereffekt_gruppe.median_pct IS
'ACHTUNG BEI NEUJAHR UND DEN WEIHNACHTSFEIERTAGEN: dort steht ein grosser Teil der '
'Gruppe bei -100 % (der Betrieb hatte zu), und der Median sitzt auf der Kante zwischen '
'"hat auf" und "hat zu". Er verschiebt sich dann um zweistellige Betraege, wenn eine '
'Handvoll Betriebe dazukommt oder wegfaellt — am 21.08.2026 sprang Neujahr durch den '
'Ausschluss von DREI Tagen von -68,7 auf -97,3 %. Die Zahl ist keine typische '
'Umsatzveraenderung, sondern eine Grenze. Wer sie zitiert, nennt p25 und p75 dazu.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0093', to_jsonb(
        'Das Konzept "Enchi-Gruppe geschlossene" faellt aus der Kalender- und '
        'Wetterauswertung heraus (Eugene, 21.08.2026): 34 Betriebe, keiner mit '
        'laufendem Umsatz. Der Ausschluss steht als Daten in '
        'manual.kalender_ausschluss und ist ueber pflege/ aenderbar. Drei weitere '
        'Konzepte tragen dieselbe Signatur und bleiben vorerst drin, sichtbar in '
        'mart.kalender_ausschluss_kandidaten. Nebenbefund: Neujahr sprang durch den '
        'Ausschluss von drei Tagen von -68,7 auf -97,3 % — an Neujahr sitzt der '
        'Median auf der Kante zwischen "hat auf" und "hat zu".'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
