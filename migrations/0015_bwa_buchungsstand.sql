-- ---------------------------------------------------------------------
-- 0015 Der BWA-Buchungsstand bekommt einen Schreiber und eine Auswertung
--
-- ANLASS: `core.bwa_buchungsstand` steht seit 0003 im Schema, mit einem
-- Kommentar, der genau erklaert, wozu sie da ist -- und war leer. Kein
-- Ladepfad hat je hineingeschrieben. Eine Tabelle mit Absicht und ohne
-- Daten, gefunden bei der Bestandsaufnahme am 26.07.2026.
--
-- WOZU SIE DA IST
--
-- docs/lina-api-inventar.md warnt: ohne volle BWA-Rechte liefert
-- `getKennzahlen` stillschweigend Nullen statt eines Fehlers. Die
-- naheliegende Gegenprobe -- "Null-Quote ueber X Prozent, also Alarm" --
-- geht nicht, weil eine hohe Null-Quote der Normalfall ist: die BWA kommt
-- vom Steuerberater und trifft ueber Monate verteilt ein.
--
-- Gemessen am 26.07.2026, 141 Betriebe:
--
--   letzter gebuchter Monat   Betriebe
--   Juni 2026                       23
--   Mai 2026                        38
--   April 2026                       4
--   Maerz 2026                       2
--   Februar 2026                     2
--   (nie gebucht)                   72
--
-- Ein Alarm auf die Null-Quote wuerde hier jeden Monat losgehen. Ein Alarm
-- auf "faellt hinter die anderen zurueck" trifft acht Betriebe -- eine
-- Liste, die man tatsaechlich durchsehen kann.
--
-- WARUM EIN HOECHSTSTAND UND KEIN AKTUELLER WERT
--
-- `letzter_monat` waechst nur. Das ist Absicht: die Aussage lautet "dieser
-- Betrieb hat schon einmal bis Monat X geliefert", und die verjaehrt nicht.
-- Ein Wert, der auch sinken koennte, waere aus einem `getKennzahlen:relativ`
-- allein sofort NULL -- der relative Modus fuellt `wert_prozent`, und
-- gebucht heisst hier `wert_absolut`.
-- ---------------------------------------------------------------------

COMMENT ON TABLE core.bwa_buchungsstand IS
'Je Betrieb der juengste Monat, fuer den je eine BWA gebucht war -- ein HOECHSTSTAND, er
sinkt nie. Geschrieben von src/sync/laden.ts nach jedem getKennzahlen-Posten.

GEBUCHT heisst: mindestens eine Kennzahl mit wert_absolut IS NOT NULL AND <> 0. Wortgleich
mit der Bedingung in mart.round_table_basis -- zwei Definitionen von "gebucht" waeren zwei
Wahrheiten.

letzter_monat IS NULL bedeutet "hat nie eine BWA geliefert" (am 26.07.2026: 72 von 141) und
ist KEIN Alarm. Genau diese Unterscheidung ist der Zweck der Tabelle: sonst schlaegt die
Plausibilitaetspruefung jeden Monatsanfang grundlos an.

Keine Zeile bedeutet "noch nie geprueft" -- ein dritter Zustand, den ein NULL nicht
ausdruecken koennte.

Auswertung: mart.bwa_rueckstand.';

COMMENT ON COLUMN core.bwa_buchungsstand.geprueft_am IS
'Wann zuletzt ein getKennzahlen-Posten diesen Betrieb angefasst hat -- nicht, wann sich
letzter_monat zuletzt geaendert hat. Ein alter Wert hier heisst: seit langem kein
Kennzahlen-Abruf, nicht seit langem keine BWA.';


CREATE VIEW mart.bwa_rueckstand AS
WITH spitze AS (
    -- Die vorderste Kante: der juengste Monat, den IRGENDEIN Betrieb gebucht
    -- hat. Der Massstab ist bewusst die Gruppe und nicht der Kalender -- wenn
    -- der Steuerberater generell drei Wochen spaeter dran ist, ist das kein
    -- Befund, sondern die Realitaet dieses Monats.
    SELECT max(letzter_monat) AS monat FROM core.bwa_buchungsstand
)
SELECT b.betrieb_key,
       b.name          AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       s.letzter_monat,
       (SELECT monat FROM spitze) AS spitze,
       CASE WHEN s.letzter_monat IS NULL THEN NULL
            ELSE (EXTRACT(year  FROM age((SELECT monat FROM spitze), s.letzter_monat)) * 12
                + EXTRACT(month FROM age((SELECT monat FROM spitze), s.letzter_monat)))::int
       END AS rueckstand_monate,
       CASE WHEN s.betrieb_key IS NULL     THEN 'ungeprueft'
            WHEN s.letzter_monat IS NULL   THEN 'nie gebucht'
            WHEN s.letzter_monat >= (SELECT monat FROM spitze) THEN 'aktuell'
            ELSE 'im Rueckstand'
       END AS lage,
       -- Zwei Monate, nicht einer: am 26.07.2026 lagen 38 von 69 buchenden
       -- Betrieben genau einen Monat hinter der Spitze. Das ist der
       -- Normalfall und darf nicht rot werden. Zwei Monate trifft acht.
       (s.letzter_monat IS NOT NULL
        AND s.letzter_monat < ((SELECT monat FROM spitze) - interval '1 month')) AS auffaellig,
       s.geprueft_am
  FROM core.betrieb b
  LEFT JOIN core.bwa_buchungsstand s   ON s.betrieb_key  = b.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz  ON kz.betrieb_key = b.betrieb_key
 WHERE b.aktiv;

COMMENT ON VIEW mart.bwa_rueckstand IS
'Wer bei der BWA hinterherhaengt -- und wer nie eine hatte.

Der Massstab ist die SPITZE der Gruppe, nicht der Kalender: verglichen wird mit dem
juengsten Monat, den irgendein Betrieb gebucht hat. Ein Steuerberater, der generell spaet
dran ist, erzeugt so keinen Befund.

lage:
  aktuell       -- auf Hoehe der Spitze
  im Rueckstand -- gebucht, aber aelter als die Spitze
  nie gebucht   -- hatte noch nie eine BWA. KEIN Fehler, es gibt Betriebe ohne
                   BWA-Anbindung (am 26.07.2026: 72 von 141)
  ungeprueft    -- noch kein getKennzahlen-Posten fuer diesen Betrieb gelaufen

auffaellig ist die Zeile fuer das Monitoring: mehr als einen Monat hinter der Spitze.
Ein Monat Rueckstand ist der Normalfall (38 von 69 am 26.07.2026), zwei sind es nicht.';
