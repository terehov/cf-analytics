-- =====================================================================
-- 0133 — Abgegebene Betriebe: geschlossen UND nicht mehr abfragen
--
-- ANLASS (Eugene, 19.10.2026): Wirtshaus Lautenschlager (LINA 861) gehoert
-- nicht mehr zur Gruppe, er ist zu Waldbacher gegangen. Seit dem 15.10.2026
-- verweigert LINA fuer diesen Betrieb jeden betriebsbezogenen Abruf:
--   * die Belegzaehlung scheitert an der Ordnerseite ("getFilesUrl fehlt"),
--     jede Nacht, je Ordner viermal;
--   * jeder Betriebsbericht antwortet mit einem Text statt JSON ("Dieser
--     Punkt sollte eigentlich nicht erreicht werden") — auch die Nachlaeufe
--     fuer August, also auch fuer Zeitraeume, in denen der Betrieb noch uns
--     gehoerte.
-- Lauf 170 meldete 34 Fehler statt 9. Der letzte Umsatz ist vom 14.10.2026.
--
-- WARUM EIN EIGENES KENNZEICHEN UND NICHT NUR DIE SCHLIESSUNG AUS 0131.
-- Ein geschlossener Betrieb, der uns noch gehoert, liefert weiter: Aposto
-- Augsburg hat am 09.10. noch Belege gezaehlt, Schlussrechnungen und BWA
-- kommen nach. Den nicht mehr zu fragen, waere ein stiller Verlust. Ein
-- abgegebener Betrieb dagegen ist fuer LINA nicht mehr unserer — jede Frage
-- ist ein Fehler im Lauf und eine Last auf einem Zugang, dessen Tempo Teil
-- der Anforderung ist (Regel 3).
--
-- WAS ES BEWIRKT (src/sync/nachfuellen.ts, NICHT_ABGEGEBEN):
--   * keine Belegzaehlung, keine BWA-Longterm, keine Stammdaten mehr;
--   * keine Betriebsberichte, in keinem der fuenf Einreihwege;
--   * offene und aufgegebene Posten des Betriebs werden als 'abgeschaltet'
--     geschlossen (abgegebeneBetriebePostenSchliessen) und nicht wiederbelebt.
-- Die Daten bis zum letzten offenen Tag bleiben, wie sie sind.
--
-- WAS ES NICHT BEWIRKT — UND SICHTBAR BLEIBT (Regel 10): die Tage, die LINA
-- uns vor dem Wechsel nicht mehr geliefert hat (bei Lautenschlager die
-- Betriebsberichte ab etwa 05.10.), fehlen dauerhaft. Die Ladestand-Sicht
-- zaehlt sie weiter als "teilweise" — sie ist materialisiert und haengt an
-- mart.luecke_monat und mart.pruefung_uebersicht; sie dafuer neu aufzubauen
-- steht als offener Punkt in docs/offene-punkte.md.
-- =====================================================================

ALTER TABLE manual.betrieb_schliessung
    ADD COLUMN IF NOT EXISTS abgegeben boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN manual.betrieb_schliessung.abgegeben IS
'true: der Betrieb gehoert nicht mehr zur Gruppe (an einen anderen Betreiber gegangen). Der Importer '
'stellt dann JEDEN betriebsbezogenen LINA-Abruf ein — Belegarchiv, BWA-Longterm, Stammdaten, '
'Betriebsberichte — und schliesst offene Posten als abgeschaltet. false (Standard): nur geschlossen, '
'nachlaufende Belege und BWA kommen weiter.';


-- mart.betrieb_schliessung_stand: Definition aus 0131, neu ist abgegeben
-- am ENDE (CREATE OR REPLACE VIEW kann nur anhaengen).
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
       sc.gepflegt_am,
       sc.abgegeben
  FROM manual.betrieb_schliessung sc
  JOIN mart.betrieb_status bs ON bs.betrieb_key = sc.betrieb_key;

COMMENT ON VIEW mart.betrieb_schliessung_stand IS
'Eine Zeile je handgepflegter Schliessung und ob sie wirkt. ERWARTUNG: zustand = wirkt. '
'"wirkt nicht" heisst: es gibt Umsatz nach dem letzten offenen Tag, der Betrieb steht wieder auf operativ. '
'abgegeben (0133): der Betrieb gehoert nicht mehr zur Gruppe, der Importer fragt ihn nicht mehr ab.';
