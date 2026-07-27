-- =====================================================================
-- 0021 Die Historie laeuft datumsweise, nicht endpunktweise
--
-- Befund vom 27.07.2026, aus dem laufenden Backfill:
--
--     getUmsatzbericht                  3.123 erledigt      fertig bis 2018
--     getUmsatzbericht:speisen            969 erledigt      steht bei 2023-12-14
--     getAktionsbericht                   205 erledigt      erst 2026
--     getArtikelverkaufsbericht           205 erledigt      erst 2026
--     getVordefinierteZeitzonenBericht    205 erledigt      erst 2026
--     getZeitzonenbericht                 205 erledigt      erst 2026
--     getUmsatzbericht:getraenke          205 erledigt      erst 2026
--     getPersonalkosten                   173 erledigt      erst 2026
--
-- Ein Endpunkt war acht Jahre weit, sechs andere kamen ueber das laufende
-- Jahr nicht hinaus. Ursache: sync.posten_holen() sortierte innerhalb einer
-- Prioritaet nach `faellig_ab, posten_id`, also nach EINREIHUNGSREIHENFOLGE.
-- Eingereiht wurde endpunktweise - der erste Endpunkt lief damit komplett
-- durch, bevor der zweite ueberhaupt anfing.
--
-- Warum das ein Risiko und nicht nur unschoen ist: Es gibt genau einen
-- Zugang, und eine Sperre waere nicht rueckgaengig zu machen. Bricht der
-- Backfill ab - Sperre, Vertragsende, Abschaltung -, dann ist der Bestand
-- bei endpunktweiser Reihenfolge ein vollstaendiger Endpunkt neben sieben
-- leeren. Damit laesst sich kein einziger Monatsbericht rechnen, denn der
-- Round Table braucht Umsatz UND Personal UND Ware.
--
-- Datumsweise abgearbeitet reicht dagegen jeder Endpunkt gleich weit
-- zurueck. Ein Abbruch kostet dann Tiefe, nicht Breite: der Bestand ist
-- kuerzer, aber vollstaendig und auswertbar.
--
--     vorher   Endpunkt A ################  Endpunkt B .
--     nachher  Endpunkt A ########          Endpunkt B ########
--
-- Die Menge der Aufrufe aendert sich NICHT. Nur ihre Reihenfolge.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Der Zugriffspfad muss zur neuen Sortierung passen
-- ---------------------------------------------------------------------

DROP INDEX IF EXISTS sync.warteschlange_naechster;

CREATE INDEX warteschlange_naechster
    ON sync.warteschlange (prioritaet, zeitraum_von DESC, endpunkt)
 WHERE erledigt_am IS NULL AND in_arbeit_seit IS NULL;

COMMENT ON INDEX sync.warteschlange_naechster IS
'Zugriffspfad von sync.posten_holen(). Die Spaltenfolge MUSS der Sortierung
dort entsprechen - sonst sortiert Postgres die gesamte offene Warteschlange.';


-- ---------------------------------------------------------------------
-- Naechsten Posten reservieren - jetzt nach Datum
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync.posten_holen(p_lauf_id bigint)
RETURNS sync.warteschlange
LANGUAGE plpgsql AS $$
DECLARE p sync.warteschlange;
BEGIN
    SELECT * INTO p
      FROM sync.warteschlange
     WHERE erledigt_am IS NULL
       AND in_arbeit_seit IS NULL
       AND faellig_ab <= now()
     -- prioritaet zuerst: ein neuer Geschaeftstag (10) draengelt sich weiter
     -- vor die Historie (90). Das war richtig und bleibt.
     --
     -- Dann zeitraum_von DESC statt faellig_ab: alle Endpunkte arbeiten
     -- denselben Tag ab, bevor irgendeiner den naechsten anfaengt.
     --
     -- faellig_ab faellt als SORTIERschluessel weg, bleibt aber als FILTER
     -- oben stehen - die Wiedervorlage nach einem Fehler funktioniert
     -- unveraendert. Der Unterschied: ein wiedervorgelegter Posten rutscht
     -- nicht ans Ende der Schlange, sondern zurueck an seine Datumsstelle.
     ORDER BY prioritaet, zeitraum_von DESC, endpunkt, posten_id
     FOR UPDATE SKIP LOCKED
     LIMIT 1;

    IF NOT FOUND THEN RETURN NULL; END IF;

    UPDATE sync.warteschlange
       SET in_arbeit_seit = now(), versuche = versuche + 1
     WHERE posten_id = p.posten_id
    RETURNING * INTO p;

    RETURN p;
END $$;

COMMENT ON FUNCTION sync.posten_holen IS
'Reserviert den naechsten faelligen Posten. Sortierung: Prioritaet, dann
Datum absteigend - die Historie laeuft datumsweise rueckwaerts, alle
Endpunkte gemeinsam. Siehe Migration 0021 fuer die Begruendung.';


-- ---------------------------------------------------------------------
-- Sichtbar machen, wie weit jeder Endpunkt zurueckreicht
--
-- Ohne diese Sicht war die Schieflage oben nur mit einer von Hand
-- geschriebenen Abfrage zu sehen - und deshalb wochenlang niemandem
-- aufgefallen.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.historie_stand AS
WITH je_endpunkt AS (
    SELECT endpunkt,
           count(*) FILTER (WHERE erledigt_am IS NOT NULL)             AS erledigt,
           count(*) FILTER (WHERE erledigt_am IS NULL)                 AS offen,
           min(zeitraum_von) FILTER (WHERE erledigt_am IS NOT NULL)    AS reicht_zurueck_bis,
           max(zeitraum_von) FILTER (WHERE erledigt_am IS NULL)        AS naechstes_datum
      FROM sync.warteschlange
     WHERE prioritaet >= 90
     GROUP BY endpunkt
)
SELECT endpunkt,
       erledigt,
       offen,
       reicht_zurueck_bis,
       naechstes_datum,
       -- Wie weit dieser Endpunkt hinter dem am weitesten zurueckreichenden
       -- liegt. 0 = gleichauf. Genau diese Spalte soll dauerhaft klein sein.
       (reicht_zurueck_bis - min(reicht_zurueck_bis) OVER ())::int      AS tage_hinter_spitze
  FROM je_endpunkt
 ORDER BY reicht_zurueck_bis DESC NULLS FIRST, endpunkt;

COMMENT ON VIEW mart.historie_stand IS
'Wie weit die Historie je Endpunkt zurueckreicht. tage_hinter_spitze zeigt
die Schieflage: solange der Backfill datumsweise laeuft (Migration 0021),
bleiben alle Endpunkte dicht beieinander. Laeuft ein Wert davon, arbeitet
jemand wieder endpunktweise ab.';
