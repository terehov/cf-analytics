-- =====================================================================
-- 0004 Bewertung — was Menschen beitragen und wie daraus eine Ampel wird
--
-- Zwei Schichten:
--   manual  Daten, die es in LINA nicht gibt. Online-Bewertungen, die
--           Vor-Ort-Einschaetzung des Operations Managers, Ursachen,
--           Massnahmen - und die Aufloesung mehrdeutiger Markenzuordnungen.
--   ampel   Das Regelwerk. Bewusst als Daten und nicht als Code, damit sich
--           Schwellen aendern lassen, ohne dass jemand deployen muss.
-- =====================================================================


-- =====================================================================
-- MANUAL — was es in LINA nicht gibt
-- =====================================================================

CREATE TABLE manual.online_bewertung (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    bewertung       numeric(3,2),
    anzahl          integer,
    quelle          text    NOT NULL DEFAULT 'yext',
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, quelle)
);
COMMENT ON TABLE manual.online_bewertung IS 'Online-Bewertungen. Quelle YEXT, eigener Sync-Job mit eigenem Rhythmus.';

CREATE TABLE manual.betrieb_fremd_id (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    system          text    NOT NULL,
    fremd_id        text    NOT NULL,
    PRIMARY KEY (betrieb_key, system)
);
COMMENT ON TABLE manual.betrieb_fremd_id IS 'Zuordnung LINA-Betrieb zu externen Systemen (YEXT-Location, spaeter openTable, Bounti). Namen matchen NICHT zuverlaessig, deshalb explizit gepflegt.';

CREATE TABLE manual.om_einschaetzung (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    om_score        smallint CHECK (om_score BETWEEN 1 AND 5),
    erfasst_von     text,
    notiz           text,
    erfasst_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat)
);
COMMENT ON TABLE manual.om_einschaetzung IS 'Vor-Ort-Einschaetzung des Operations Managers, 1-5. Rein subjektiv, kein LINA-Pendant.';

CREATE TABLE manual.ursache_katalog (
    ursache_code    text    PRIMARY KEY,
    bezeichnung     text    NOT NULL,
    reihenfolge     integer NOT NULL
);
COMMENT ON TABLE manual.ursache_katalog IS 'Die 21 Ursachen aus dem Dropdown des Excel-Blatts "Regeln".';

CREATE TABLE manual.ursache (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    bereich         text    NOT NULL,
    ursache_code    text    REFERENCES manual.ursache_katalog(ursache_code),
    notiz           text,
    erfasst_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, bereich)
);

CREATE TABLE manual.massnahme (
    massnahme_id    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL,
    bereich         text,
    ursache_code    text REFERENCES manual.ursache_katalog(ursache_code),
    massnahme       text    NOT NULL,
    verantwortlich  text,
    faellig_am      date,
    status          text    NOT NULL DEFAULT 'Offen'
                    CHECK (status IN ('Offen','In Arbeit','Erledigt','Eskalieren','Wartet auf Rückmeldung')),
    prioritaet      text    CHECK (prioritaet IN ('Hoch','Mittel','Niedrig')),
    fortschritt     smallint CHECK (fortschritt BETWEEN 0 AND 100),
    notizen         text,
    erstellt_am     timestamptz NOT NULL DEFAULT now(),
    geaendert_am    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE manual.massnahme IS 'Massnahmen-Tracking, ersetzt das Excel-Blatt "Massnahmen". Spalten und Statuswerte wortwoertlich von dort. Metabase kann nicht schreiben - v1 per CSV-Upload, spaeter kleine Eingabemaske.';


-- ---------------------------------------------------------------------
-- Markenzuordnung, wo LINA sie nicht eindeutig hergibt
--
-- Der Knackpunkt ist die n:m-Zuordnung: ein Betriebsschluessel kann in
-- mehreren Konzepten haengen. Wuerde man Markenschnitte direkt ueber
-- core.betrieb_konzept bilden, zaehlte derselbe Betrieb in mehreren
-- Markenschnitten mit und verzoege jeden davon. Deshalb:
--
--   * Markenschnitte laufen ueber das HAUPTKONZEPT - eine saubere 1:1-Sicht.
--   * Betriebe mit genau einem Konzept bekommen es automatisch.
--   * Betriebe mit mehreren bleiben unzugeordnet, bis jemand entscheidet.
--     Sie verschwinden nicht, sondern erscheinen als "(nicht zugeordnet)".
--
-- Nicht raten, sondern die Luecke sichtbar lassen. mart.konzept_zuordnung
-- zeigt genau, wo noch eine Entscheidung fehlt.
-- ---------------------------------------------------------------------

CREATE TABLE manual.betrieb_hauptkonzept (
    betrieb_key   integer PRIMARY KEY REFERENCES core.betrieb(betrieb_key),
    konzept_key   integer NOT NULL REFERENCES core.konzept(konzept_key),
    begruendung   text,
    gepflegt_am   timestamptz NOT NULL DEFAULT now(),
    gepflegt_von  text
);
COMMENT ON TABLE manual.betrieb_hauptkonzept IS
'Welche Marke gilt fuer einen Betrieb, der in LINA in mehreren Konzepten haengt.
Nur fuer die Mehrdeutigen noetig - wer genau ein Konzept hat, wird automatisch zugeordnet.
Diese Tabelle gewinnt immer, auch gegen eine eindeutige LINA-Zuordnung: wenn LINA falsch
gruppiert, ist das hier die Stelle zum Geradeziehen.';
COMMENT ON COLUMN manual.betrieb_hauptkonzept.begruendung IS
'Warum diese Marke. In einem Jahr weiss es sonst niemand mehr.';


-- =====================================================================
-- AMPEL — Regelwerke, bewusst datengetrieben
-- =====================================================================

CREATE TABLE ampel.regelwerk (
    regelwerk_key   text    PRIMARY KEY,
    name            text    NOT NULL,
    beschreibung    text,
    ist_standard    boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX regelwerk_ein_standard ON ampel.regelwerk (ist_standard) WHERE ist_standard;

CREATE TABLE ampel.regel (
    regelwerk_key   text    NOT NULL REFERENCES ampel.regelwerk(regelwerk_key),
    bereich         text    NOT NULL,
    richtung        text    NOT NULL CHECK (richtung IN ('hoeher_ist_besser','niedriger_ist_besser')),
    schwellenquelle text    NOT NULL DEFAULT 'fest'
                    CHECK (schwellenquelle IN ('fest','lina_betrieb')),
    schwelle_gruen  numeric(10,2),
    schwelle_orange numeric(10,2),
    hinweis         text,
    PRIMARY KEY (regelwerk_key, bereich)
);
COMMENT ON TABLE  ampel.regel                 IS 'Eine Regel je Bereich und Regelwerk.';
COMMENT ON COLUMN ampel.regel.schwellenquelle IS 'fest = feste Schwellen aus diesem Datensatz. lina_betrieb = Schwellen je Betrieb aus core.schwellenwert_betrieb. So sind global und betriebsindividuell umschaltbar, ohne Code zu aendern.';
COMMENT ON COLUMN ampel.regel.richtung        IS 'hoeher_ist_besser: Umsatz, Bewertung, OM. niedriger_ist_besser: Personalkosten, Wareneinsatz.';

-- Anzeigebeschriftung. Gespeichert wird der schlanke Schluessel, angezeigt
-- die Schreibweise aus dem Excel - damit steht die Zuordnung in Daten und
-- nicht in Metabase-Formeln.
CREATE TABLE ampel.beschriftung (
    status          text PRIMARY KEY CHECK (status IN ('rot','orange','gruen')),
    bezeichnung     text NOT NULL,
    emoji           text NOT NULL,
    reihenfolge     smallint NOT NULL
);


-- ---------------------------------------------------------------------
-- Ampellogik
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ampel.bewerte(
    p_wert          numeric,
    p_bereich       text,
    p_regelwerk     text    DEFAULT NULL,
    p_betrieb_key   integer DEFAULT NULL,
    p_stichtag      date    DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r           ampel.regel%ROWTYPE;
    v_regelwerk text;
    v_gruen     numeric;
    v_orange    numeric;
BEGIN
    IF p_wert IS NULL THEN RETURN NULL; END IF;

    v_regelwerk := COALESCE(p_regelwerk,
                            (SELECT regelwerk_key FROM ampel.regelwerk WHERE ist_standard LIMIT 1));

    SELECT * INTO r FROM ampel.regel
     WHERE regelwerk_key = v_regelwerk AND bereich = p_bereich;
    IF NOT FOUND THEN RETURN NULL; END IF;

    IF r.schwellenquelle = 'lina_betrieb' THEN
        SELECT s.schwelle_gruen, s.schwelle_orange INTO v_gruen, v_orange
          FROM core.schwellenwert_betrieb s
         WHERE s.betrieb_key = p_betrieb_key
           AND s.bereich     = p_bereich
           AND (p_stichtag IS NULL OR s.gueltig_ab <= p_stichtag)
         ORDER BY s.gueltig_ab DESC
         LIMIT 1;
    END IF;

    -- Rueckfall auf die festen Werte der Regel, wenn LINA nichts liefert
    v_gruen  := COALESCE(v_gruen,  r.schwelle_gruen);
    v_orange := COALESCE(v_orange, r.schwelle_orange);
    IF v_gruen IS NULL OR v_orange IS NULL THEN RETURN NULL; END IF;

    IF r.richtung = 'niedriger_ist_besser' THEN
        IF p_wert <= v_gruen  THEN RETURN 'gruen';  END IF;
        IF p_wert <= v_orange THEN RETURN 'orange'; END IF;
        RETURN 'rot';
    ELSE
        IF p_wert >= v_gruen  THEN RETURN 'gruen';  END IF;
        IF p_wert >= v_orange THEN RETURN 'orange'; END IF;
        RETURN 'rot';
    END IF;
END $$;

COMMENT ON FUNCTION ampel.bewerte IS
'Bewertet einen Wert gegen ein Regelwerk. Ohne p_regelwerk gilt das Standardregelwerk.
Bei schwellenquelle=lina_betrieb werden die betriebsindividuellen Schwellen gezogen,
mit Rueckfall auf die festen.';


-- Gesamtstatus wie im Excel: ein Rot faerbt alles rot.
CREATE OR REPLACE FUNCTION ampel.gesamt(p_status text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN cardinality(array_remove(p_status, NULL)) = 0 THEN NULL
        WHEN 'rot'    = ANY(p_status) THEN 'rot'
        WHEN 'orange' = ANY(p_status) THEN 'orange'
        ELSE 'gruen'
    END;
$$;

CREATE OR REPLACE FUNCTION ampel.intensitaet(p_status text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN cardinality(array_remove(p_status, NULL)) = 0 THEN NULL
        WHEN (SELECT count(*) FROM unnest(p_status) s WHERE s = 'rot')    >= 2 THEN 'Sofort eskalieren'
        WHEN (SELECT count(*) FROM unnest(p_status) s WHERE s = 'rot')    =  1 THEN 'Sofort handeln'
        WHEN (SELECT count(*) FROM unnest(p_status) s WHERE s = 'orange') >= 2 THEN 'Nachforschung'
        ELSE 'Beobachten/OK'
    END;
$$;

COMMENT ON FUNCTION ampel.intensitaet IS 'Eskalationsstufe wie im Excel: >=2 Rot eskalieren, 1 Rot handeln, >=2 Orange nachforschen, sonst beobachten.';


-- =====================================================================
-- Seed
-- =====================================================================

INSERT INTO ampel.beschriftung (status, bezeichnung, emoji, reihenfolge) VALUES
 ('rot','Rot','🔴',1), ('orange','Orange','🟠',2), ('gruen','Grün','🟢',3);

INSERT INTO ampel.regelwerk (regelwerk_key, name, beschreibung, ist_standard) VALUES
 ('round_table_global', 'Round Table (global)',
  'Feste Schwellen aus dem Excel-Blatt "Regeln". Alle Betriebe werden gleich gemessen - beste Vergleichbarkeit im Round Table.', true),
 ('lina_betrieb', 'LINA (betriebsindividuell)',
  'Schwellen, die LINA je Betrieb pflegt. Beruecksichtigt Standortgroesse und Konzept, macht Betriebe untereinander aber schlechter vergleichbar.', false);

INSERT INTO ampel.regel (regelwerk_key, bereich, richtung, schwellenquelle, schwelle_gruen, schwelle_orange, hinweis) VALUES
 ('round_table_global','umsatz',    'hoeher_ist_besser',   'fest',        10.00,  0.00, 'Veraenderung zum Vorjahr in Prozent'),
 ('round_table_global','personal',  'niedriger_ist_besser','fest',        28.00, 32.00, 'Personalkosten ohne GF in Prozent'),
 ('round_table_global','we_bar',    'niedriger_ist_besser','fest',        23.00, 26.00, 'Feste Vorgabe laut Regeln-Blatt'),
 ('round_table_global','we_kueche', 'niedriger_ist_besser','fest',        25.00, 30.00, 'Feste Vorgabe laut Regeln-Blatt'),
 ('round_table_global','bewertung', 'hoeher_ist_besser',   'fest',         4.40,  4.00, 'Online-Bewertung 1-5'),
 ('round_table_global','om',        'hoeher_ist_besser',   'fest',         4.00,  3.00, 'Operations-Manager-Score 1-5'),
 ('lina_betrieb',      'umsatz',    'hoeher_ist_besser',   'fest',        10.00,  0.00, 'LINA kennt keine Umsatzschwelle - global uebernommen'),
 ('lina_betrieb',      'personal',  'niedriger_ist_besser','lina_betrieb', NULL,  NULL, 'aus getPersonalkosten.pekThreshold'),
 ('lina_betrieb',      'we_bar',    'niedriger_ist_besser','fest',        23.00, 26.00, 'LINA kennt keine WE-Schwelle - global uebernommen'),
 ('lina_betrieb',      'we_kueche', 'niedriger_ist_besser','fest',        25.00, 30.00, 'LINA kennt keine WE-Schwelle - global uebernommen'),
 ('lina_betrieb',      'bewertung', 'hoeher_ist_besser',   'fest',         4.40,  4.00, 'kein LINA-Pendant'),
 ('lina_betrieb',      'om',        'hoeher_ist_besser',   'fest',         4.00,  3.00, 'kein LINA-Pendant');

INSERT INTO manual.ursache_katalog (ursache_code, bezeichnung, reihenfolge) VALUES
 ('umsatzrueckgang','Umsatzrückgang',1), ('lokaler_wettbewerb','Lokaler Wettbewerb',2),
 ('wetter_saison','Wetter/Saison',3),    ('marketing_schwach','Marketing schwach',4),
 ('oeffnungszeiten','Öffnungszeiten',5), ('events_reservierungen','Events/Reservierungen',6),
 ('krankheit_ausfall','Krankheit/Ausfall',7), ('dienstplanung','Dienstplanung',8),
 ('ueberstunden','Überstunden',9),       ('einarbeitung_training','Einarbeitung/Training',10),
 ('produktivitaet','Produktivität',11),  ('einkaufspreise','Einkaufspreise',12),
 ('inventur_differenzen','Inventur/Differenzen',13), ('rezeptur_portionierung','Rezeptur/Portionierung',14),
 ('bruch_schwund','Bruch/Schwund',15),   ('kassen_buchungsfehler','Kassen-/Buchungsfehler',16),
 ('qualitaet','Qualität',17),            ('service','Service',18),
 ('bewertungen','Bewertungen',19),       ('vor_ort_befund','Vor-Ort-Befund',20),
 ('sonstiges','Sonstiges',21);
