-- =====================================================================
-- 0018 Ein Platz fuer "wann wurde das zuletzt gemacht"
--
-- ANLASS: Die Auswahllisten der Dashboard-Filter (Betrieb, Marke) sind in
-- Metabase feste Wertelisten. Technisch unvermeidbar -- die Karten sind
-- natives SQL, ihre Filter haengen an einer Variablen statt an einer
-- Spalte, und dort bietet Metabase kein Feld-Dropdown an.
--
-- Fest heisst: eine Momentaufnahme. Kommt ein Betrieb dazu, fehlt er in
-- der Auswahl, und das faellt niemandem auf -- das Dashboard sieht
-- vollstaendig richtig aus, es fehlt nur eine Zeile im Dropdown. Niemand
-- vermisst, was er nicht sieht.
--
-- Damit /status das melden kann, muss es die beiden Zahlen vergleichen
-- koennen: wie viele Betriebe gibt es, wie viele kennt der Filter. Die
-- erste steht in dieser Datenbank, die zweite in Metabases eigener.
-- Beide liegen in derselben Postgres-Instanz, sind aber VERSCHIEDENE
-- Datenbanken -- ein Join geht nicht, und ein zweiter Verbindungspool nur
-- fuer diese eine Pruefung waere zu teuer.
--
-- Deshalb hinterlegt das Sync-Skript hier, was es zuletzt geschrieben
-- hat, und /status liest diesen Wert.
--
-- WARUM ALLGEMEIN UND NICHT "sync.auswahllisten_stand": Solche Faelle
-- kommen wieder -- irgendein Vorgang laeuft ausserhalb des Importers und
-- jemand will wissen, wann er zuletzt lief. Eine Tabelle mit Schluessel
-- und JSONB nimmt den naechsten Fall auf, ohne dass eine Migration noetig
-- wird. Fuer Betriebszustand ist das richtig; fachliche Daten gehoeren
-- weiterhin in eigene, getypte Tabellen.
-- =====================================================================

CREATE TABLE sync.merker (
    schluessel  text PRIMARY KEY,
    wert        jsonb NOT NULL,
    gesetzt_am  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sync.merker IS
'Kleine Zustandsnotizen von Vorgaengen, die ausserhalb des Importers laufen.
Schluessel ist der Name des Vorgangs, wert sein Ergebnis als JSONB.

Nicht fuer fachliche Daten -- die gehoeren in getypte Tabellen. Hier steht nur,
was noetig ist, um "laeuft das noch?" zu beantworten.

Belegte Schluessel:
  metabase_auswahllisten  {anzahl_betriebe, anzahl_marken} -- gesetzt von
                          metabase/auswahllisten.ts, gelesen von /status';

COMMENT ON COLUMN sync.merker.gesetzt_am IS
'Wann der Vorgang zuletzt lief. Ein alter Zeitstempel ist selbst eine Aussage:
der Cron-Auftrag laeuft nicht mehr.';
