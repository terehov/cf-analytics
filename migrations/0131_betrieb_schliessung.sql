-- =====================================================================
-- 0131 — Geschlossene Betriebe als Daten: der letzte offene Tag
--
-- ANLASS (Eugene, 11.10.2026): Aposto Augsburg (letzter Umsatz 13.09.2026)
-- und Wilma Wunder Recklinghausen (24.09.2026) sind geschlossen. Beide
-- standen weiter auf `operativ` und tauchten in mart.luecke_monat
-- ("seit mehr als 8 Tagen ohne Umsatz") und im Datenstand als "Umsatz
-- veraltet" auf — eine Meldung, die nichts mehr zu tun hat und deshalb die
-- naechste echte verdeckt.
--
-- WARUM ES BISHER KEINEN WEG GAB: `geschlossen` kam in mart.betrieb_status
-- nur ueber den Namen ("geschlossen ...", "insolvent ...") oder das
-- LINA-Konzept "Enchi-Gruppe geschlossene". Beides liegt in LINA, und dort
-- aendern wir nichts (Regel 1). Ohne Handpflege kippt ein Betrieb erst nach
-- 60 Tagen ohne Umsatz von selbst auf `inaktiv`.
--
-- DER LETZTE OFFENE TAG IST EIN DATUM, KEIN KENNZEICHEN. Eine Zeile sagt
-- nicht nur "zu", sondern "zu nach diesem Tag". Das hat zwei Folgen:
--   * Umsatz NACH dem letzten offenen Tag hebt die Schliessung in der Sicht
--     auf (der Betrieb steht dann wieder auf operativ). Eine Wiedereroeffnung
--     muss nicht jemand von Hand aus der Tabelle nehmen, und ein Betrieb mit
--     Umsatz wird nie unsichtbar als geschlossen gefuehrt.
--   * Weicht der eingetragene Tag vom letzten Umsatztag ab, steht das in
--     mart.betrieb_schliessung_stand. Das ist Absicht und kein Fehler: ein
--     Ruhetag am Ende, ein Tag mit 0,00 EUR — aber es soll jemand gesehen
--     haben (Regel 10).
--
-- GEPFLEGT UEBER pflege/betrieb_schliessung.csv, ohne Migration (Bauart wie
-- manual.kalender_ausschluss aus 0093). Die Zeilen stehen bewusst NICHT
-- hier: eine Zeile in einer Migration ist beim naechsten Betrieb wieder eine
-- Migration — genau der Weg, den 0079 abgeschafft hat.
-- =====================================================================

CREATE TABLE IF NOT EXISTS manual.betrieb_schliessung (
  betrieb_key         integer PRIMARY KEY REFERENCES core.betrieb (betrieb_key),
  letzter_offener_tag date NOT NULL,
  notiz               text,
  gepflegt_am         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE manual.betrieb_schliessung IS
'Betriebe, die geschlossen sind, mit dem letzten Tag, an dem sie offen waren. Gepflegt ueber '
'pflege/betrieb_schliessung.csv. Wirkt in mart.betrieb_status: geschlossen, solange es keinen '
'Umsatz NACH letzter_offener_tag gibt. Beobachtung: mart.betrieb_schliessung_stand.';


-- ---------------------------------------------------------------------
-- mart.betrieb_status: Definition aus 0125, neu ist der Join auf
-- manual.betrieb_schliessung und die dritte Bedingung im Zweig
-- `geschlossen`. Spalten unveraendert (CREATE OR REPLACE VIEW kann nur
-- anhaengen, nicht umbauen).
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
              OR kz.hauptkonzept = 'Enchi-Gruppe geschlossene'
              -- 0131: von Hand gepflegt. Umsatz nach dem letzten offenen Tag
              -- hebt es auf — dann ist der Betrieb offensichtlich wieder offen.
              OR (sc.betrieb_key IS NOT NULL
                  AND (u.letzter_umsatztag IS NULL
                       OR u.letzter_umsatztag <= sc.letzter_offener_tag))  THEN 'geschlossen'
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
  LEFT JOIN letzter u ON u.betrieb_key = b.betrieb_key
  LEFT JOIN manual.betrieb_schliessung sc ON sc.betrieb_key = b.betrieb_key;

COMMENT ON VIEW mart.betrieb_status IS
'Betriebsstatus aus Namen, Konzept, Handpflege und Umsatz: test | verwaltend | geschlossen | fremdkasse |
ohne_geschaeft | inaktiv | operativ. geschlossen (0131) auch ueber manual.betrieb_schliessung — solange
es keinen Umsatz nach dem letzten offenen Tag gibt. fremdkasse (0125): nie Umsatz in LINA, aber
FoodNotify-Bestellung in 60 Tagen oder gebuchte BWA in den letzten vier Monaten — die Kasse laeuft
nicht ueber LINA. Solche Betriebe zaehlen in Bewertungs- und BWA-Sichten, nicht in Umsatzvergleichen.
operativ heisst: Umsatz in LINA in den letzten 60 Tagen.';


-- ---------------------------------------------------------------------
-- Was die Handpflege gerade bewirkt (Regel 10: eine Zeile, die nichts
-- bewirkt, soll nicht wie eine wirkende aussehen).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.betrieb_schliessung_stand AS
SELECT sc.betrieb_key,
       bs.betrieb,
       bs.konzept,
       sc.letzter_offener_tag,
       bs.letzter_umsatztag,
       bs.status,
       CASE
         WHEN bs.letzter_umsatztag > sc.letzter_offener_tag
           THEN 'wirkt nicht: Umsatz nach dem letzten offenen Tag - wieder offen? Zeile pruefen'
         WHEN bs.letzter_umsatztag IS DISTINCT FROM sc.letzter_offener_tag
           THEN 'wirkt, aber letzter offener Tag weicht vom letzten Umsatztag ab'
         ELSE 'wirkt'
       END AS zustand,
       sc.notiz,
       sc.gepflegt_am
  FROM manual.betrieb_schliessung sc
  JOIN mart.betrieb_status bs ON bs.betrieb_key = sc.betrieb_key;

COMMENT ON VIEW mart.betrieb_schliessung_stand IS
'Eine Zeile je handgepflegter Schliessung und ob sie wirkt. ERWARTUNG: zustand = wirkt. '
'"wirkt nicht" heisst: es gibt Umsatz nach dem letzten offenen Tag, der Betrieb steht wieder auf operativ.';

-- Leserechte fuer mcp_leser kommen aus den Standardrechten (0105) — kein GRANT hier,
-- sonst scheitert die Migration dort, wo die Rolle fehlt.
