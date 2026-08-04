-- ---------------------------------------------------------------------
-- Migration 0034 · Die Bruecke zwischen FoodNotify und LINA
--
-- Ohne core.kostenstelle.betrieb_key ist keine gemeinsame Kennzahl
-- moeglich: Wareneinsatz kommt von FoodNotify, Umsatz von LINA, und
-- beide zaehlen nur zusammen, wenn sie am selben Betrieb haengen.
-- Gemessen am 02.08.2026: 0 von 152 Kostenstellen hatten eine Zuordnung.
--
-- WARUM EINE VORSCHLAGSTABELLE UND KEIN DIREKTES UPDATE.
--
-- Die Zuordnung geschieht ueber Namen, und Namen luegen. Gemessen an
-- 79 FoodNotify-Restaurants:
--   * "Enchilada Halle" hat zum FALSCHEN Kandidaten ("Enchilada Hamm")
--     die hoehere Trigramm-Aehnlichkeit (0.63) als zum richtigen (0.53).
--     Trigramm allein erzeugt hier eine stille Fehlzuordnung — und eine
--     falsche Zuordnung ist schlimmer als gar keine: sie rechnet den
--     Wareneinsatz eines Betriebs gegen den Umsatz eines anderen.
--   * "Aposto Wuppertal II" passt namentlich am besten auf
--     "Aposto Wuppertal GmbH" — das ist aber schon durch "Aposto
--     Wuppertal" belegt. Kein Algorithmus entscheidet das; ein Mensch
--     mit Ortskenntnis schon.
--
-- Deshalb: der Automat SCHLAEGT VOR und legt seine Begruendung offen.
-- Uebernommen wird nur, was eindeutig ist; alles andere wartet sichtbar
-- auf eine Entscheidung, statt sich als Zahl zu tarnen.
--
-- WAS BEIM VERGLEICH PASSIERT (norm()):
--   * LINA fuehrt den Betriebsstatus IM NAMEN: "GESCHLOSSEN Enchilada
--     Dresden GmbH", "INSOLVENT - Aposto Muenster GmbH". 6 der 13
--     Namensvarianten scheiterten allein daran.
--   * Umlaute stehen mal als "ue", mal als "ü" (Muenster/Münster).
--   * Rechtsformen fehlen auf der FoodNotify-Seite durchgaengig.
--   * core.betrieb.name ist bei 50 Zeichen gekappt (betrieb_key 82, 93,
--     109) — deshalb zaehlt beim Token-Vergleich auch ein Praefix.
-- ---------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- Namen vergleichbar machen. Absichtlich IMMUTABLE, damit sie in einem
-- Index stehen koennte, und absichtlich ohne Sonderfaelle je Marke:
-- was hier nicht greift, gehoert in die menschliche Entscheidung.
CREATE OR REPLACE FUNCTION core.name_norm(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    WITH gefaltet AS (
        SELECT regexp_replace(
            /**
             * Umlaute ZWEISTELLIG falten: ue, oe, ae — nicht u, o, a.
             * FoodNotify schreibt "Aposto Münster", LINA "Aposto Muenster".
             * Ein einstelliges translate() macht daraus "munster" und
             * "muenster" — die beiden treffen sich dann NICHT, und der
             * Betrieb bliebe ohne Zuordnung, obwohl beide Namen dasselbe
             * Haus meinen.
             */
            translate(
                replace(replace(replace(replace(
                    lower(coalesce(p, '')),
                    'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'),
                'áàâéèêíìîóòôúùû´`''',
                'aaaeeeiiiooouuu   '),
            -- Statuspraefixe: LINA schreibt den Zustand in den Namen.
            '^(geschlossen|insolvent|inaktiv)[[:space:]-]*', '', 'gi') AS t
    )
    /**
     * Rechtsformen und Fuellwoerter am ENDE — bis zu dreimal, weil sie
     * sich stapeln: "Alte Post Aachen Gaststaettenbetriebs GmbH" traegt
     * zwei davon. Ein einzelner Durchlauf entfernt nur "GmbH" und laesst
     * "gaststaettenbetriebs" stehen; gegenueber "GESCHLOSSEN Alte Post
     * Aachen GmbH" (das sauber zu "alte post aachen" wird) verliert der
     * AKTIVE Betrieb dann den Vergleich 0.4 zu 0.8 — der Automat haette
     * die stillgelegte Gesellschaft vorgeschlagen.
     */
    SELECT trim(regexp_replace(regexp_replace(regexp_replace(t,
        '[[:space:],.-]*(gmbh([[:space:]]*&[[:space:]]*co\.?[[:space:]]*kg)?|ug|kg|ohg|e\.?k\.?|mbh|gaststa[e]?ttenbetriebs?|gastrobetriebs?|betriebs?)[[:space:],.-]*$', '', 'gi'),
        '[[:space:],.-]*(gmbh([[:space:]]*&[[:space:]]*co\.?[[:space:]]*kg)?|ug|kg|ohg|e\.?k\.?|mbh|gaststa[e]?ttenbetriebs?|gastrobetriebs?|betriebs?)[[:space:],.-]*$', '', 'gi'),
        '[[:space:],.-]*(gmbh([[:space:]]*&[[:space:]]*co\.?[[:space:]]*kg)?|ug|kg|ohg|e\.?k\.?|mbh|gaststa[e]?ttenbetriebs?|gastrobetriebs?|betriebs?)[[:space:],.-]*$', '', 'gi'))
      FROM gefaltet;
$$;

COMMENT ON FUNCTION core.name_norm(text) IS
'Normalisiert Betriebsnamen fuer den Vergleich zwischen LINA und FoodNotify:
Umlaute gefaltet, LINA-Statuspraefixe (GESCHLOSSEN/INSOLVENT) und gestapelte
Rechtsformen entfernt. Ohne die Statuspraefixe scheitern 6 von 13
Namensvarianten; ohne den mehrfachen Durchlauf gewinnt bei "Alte Post Aachen"
die geschlossene Gesellschaft gegen die aktive.';


-- ---------------------------------------------------------------------
-- Die Vorschlagstabelle
--
-- Eine Zeile je FoodNotify-Restaurant. `entscheidung` ist das Feld, das
-- ein Mensch aendert; alles andere ist Beleg, wie der Vorschlag zustande
-- kam. Ein Vorschlag wird NIE stillschweigend ueberschrieben.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS manual.betrieb_zuordnung (
    restaurant_id     integer PRIMARY KEY,
    marke_key         integer NOT NULL REFERENCES core.marke(marke_key),
    fn_name           text    NOT NULL,
    -- Der Vorschlag des Automaten.
    vorschlag_key     integer REFERENCES core.betrieb(betrieb_key),
    vorschlag_name    text,
    trgm              numeric(4,3),
    token_jaccard     numeric(4,3),
    -- Warum: 'exakt', 'variante', 'unsicher', 'testbetrieb', 'kein_treffer'
    grund             text    NOT NULL,
    -- Die menschliche Entscheidung. NULL = noch nicht entschieden.
    -- Ein gesetzter Wert gewinnt IMMER gegen den Vorschlag.
    entscheidung_key  integer REFERENCES core.betrieb(betrieb_key),
    -- Ausdrueckliches "hat kein Gegenstueck" — unterscheidbar von
    -- "noch nicht angeschaut". Das ist der Grund fuer die eigene Spalte:
    -- NULL kann beides heissen, und dieser Unterschied entscheidet, ob
    -- eine Luecke eine Aufgabe ist oder ein Ergebnis.
    ohne_gegenstueck  boolean NOT NULL DEFAULT false,
    notiz             text,
    geprueft_am       timestamptz,
    erstellt_am       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE manual.betrieb_zuordnung IS
'FoodNotify-Restaurant zu LINA-Betrieb. Der Automat schlaegt vor (vorschlag_key
mit Begruendung), der Mensch entscheidet (entscheidung_key). Eine falsche
Zuordnung rechnet Wareneinsatz gegen fremden Umsatz — deshalb wird nur
Eindeutiges automatisch uebernommen.';

COMMENT ON COLUMN manual.betrieb_zuordnung.ohne_gegenstueck IS
'true = geprueft, es gibt nachweislich keinen LINA-Betrieb (Testbetrieb oder
fehlender Stammsatz). Unterscheidet das Ergebnis "keins" von "noch offen".';


-- ---------------------------------------------------------------------
-- Vorschlaege berechnen
--
-- Kombiniert Trigramm UND Token-Ueberschneidung, weil Trigramm allein
-- messbar falsch liegt (Halle/Hamm). Der Token-Anteil zaehlt doppelt:
-- gemeinsame ganze Woerter ("Enchilada", "Halle") sind bei Ortsnamen
-- aussagekraeftiger als gemeinsame Buchstabenfolgen.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION manual.betrieb_vorschlaege_berechnen()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
    WITH fn AS (
        SELECT DISTINCT ON (restaurant_id)
               restaurant_id, marke_key,
               trim(restaurant_name) AS fn_name,
               core.name_norm(restaurant_name) AS norm
          FROM core.kostenstelle
         ORDER BY restaurant_id, kostenstelle_id
    ), li AS (
        SELECT betrieb_key, name, core.name_norm(name) AS norm
          FROM core.betrieb
    ), paar AS (
        SELECT fn.restaurant_id, fn.marke_key, fn.fn_name, fn.norm AS fn_norm,
               li.betrieb_key, li.name AS li_name,
               similarity(fn.norm, li.norm) AS trgm,
               -- Token-Jaccard: gemeinsame Woerter geteilt durch alle.
               (SELECT count(*)::numeric FROM (
                    SELECT unnest(string_to_array(fn.norm, ' '))
                    INTERSECT
                    SELECT unnest(string_to_array(li.norm, ' '))) x)
               / nullif((SELECT count(*)::numeric FROM (
                    SELECT unnest(string_to_array(fn.norm, ' '))
                    UNION
                    SELECT unnest(string_to_array(li.norm, ' '))) y), 0)
               AS jacc
          FROM fn CROSS JOIN li
         WHERE similarity(fn.norm, li.norm) > 0.2
            OR li.norm LIKE fn.norm || '%'      -- LINA-Name bei 50 Zeichen gekappt
            OR fn.norm LIKE li.norm || '%'
    ), bewertet AS (
        SELECT *,
               -- Token-Ueberschneidung doppelt gewichtet: sie entscheidet
               -- Halle/Hamm richtig, wo Trigramm falsch liegt.
               (trgm + 2 * coalesce(jacc, 0)) / 3
               -- Ein aktiver Betrieb schlaegt einen stillgelegten bei
               -- gleichem Namen. "Alte Post Aachen" gibt es zweimal: als
               -- GmbH (aktiv) und als "GESCHLOSSEN ... GmbH". Nach der
               -- Normalisierung sind beide identisch, der Zufall der
               -- Sortierung entschied — jetzt der Zustand.
               - CASE WHEN li_name ~* '^(geschlossen|insolvent|inaktiv)'
                      THEN 0.02 ELSE 0 END AS punkte
          FROM paar
    ), best AS (
        SELECT DISTINCT ON (restaurant_id) *,
               punkte - coalesce(lead(punkte) OVER (
                   PARTITION BY restaurant_id ORDER BY punkte DESC), 0) AS abstand
          FROM bewertet
         ORDER BY restaurant_id, punkte DESC, betrieb_key
    ), alle AS (
        SELECT fn.restaurant_id, fn.marke_key, fn.fn_name,
               b.betrieb_key, b.li_name, b.trgm, b.jacc, b.punkte, b.abstand,
               fn.norm AS fn_norm,
               /**
                * DOPPELBELEGUNG ERKENNEN.
                *
                * "Aposto Wuppertal" trifft exakt auf "Aposto Wuppertal
                * GmbH". "Aposto Wuppertal II" trifft namentlich auf
                * DENSELBEN Betrieb — obwohl daneben "Aposto Wuppertal -
                * Alter Papierfabrik" steht, der Zweitstandort. Der beste
                * Name ist hier nicht der richtige Betrieb, und kein
                * Aehnlichkeitsmass merkt das: es vergleicht Paare, nicht
                * die Gesamtverteilung.
                *
                * Wer den schwaecheren Treffer auf einen schon exakt
                * belegten Betrieb hat, wird deshalb 'unsicher' — ein
                * Mensch mit Ortskenntnis entscheidet.
                */
               (b.betrieb_key IS NOT NULL AND EXISTS (
                    SELECT 1 FROM best b2
                     WHERE b2.betrieb_key = b.betrieb_key
                       AND b2.restaurant_id <> fn.restaurant_id
                       AND b2.punkte > b.punkte)) AS doppelt_belegt
          FROM fn LEFT JOIN best b USING (restaurant_id)
    )
    INSERT INTO manual.betrieb_zuordnung
        (restaurant_id, marke_key, fn_name, vorschlag_key, vorschlag_name,
         trgm, token_jaccard, grund, ohne_gegenstueck)
    SELECT a.restaurant_id, a.marke_key, a.fn_name,
           -- Der Vorschlag bleibt sichtbar, auch wenn er doppelt belegt
           -- waere: er ist der beste Hinweis fuer den, der entscheidet.
           CASE WHEN a.punkte >= 0.55 THEN a.betrieb_key END,
           CASE WHEN a.punkte >= 0.55 THEN a.li_name END,
           round(a.trgm::numeric, 3), round(a.jacc::numeric, 3),
           CASE
             -- Testbetriebe zuerst: sie treffen manchmal zufaellig gut,
             -- gehoeren aber nie zugeordnet.
             WHEN a.fn_norm ~ '(^|[[:space:]])(aaa|test)' THEN 'testbetrieb'
             WHEN a.punkte IS NULL OR a.punkte < 0.40      THEN 'kein_treffer'
             -- Vor 'exakt': ein exakter Name auf einen schon vergebenen
             -- Betrieb ist gerade KEIN Beweis, sondern der Zweifelsfall.
             WHEN a.doppelt_belegt                         THEN 'unsicher'
             WHEN a.jacc >= 0.95                           THEN 'exakt'
             -- Eindeutig heisst: gut UND deutlich besser als der Zweite.
             WHEN a.punkte >= 0.55 AND a.abstand >= 0.10   THEN 'variante'
             ELSE 'unsicher'
           END,
           a.fn_norm ~ '(^|[[:space:]])(aaa|test)'
      FROM alle a
    ON CONFLICT (restaurant_id) DO UPDATE SET
           -- Vorschlaege duerfen sich aktualisieren; Entscheidungen NICHT.
           vorschlag_key  = excluded.vorschlag_key,
           vorschlag_name = excluded.vorschlag_name,
           trgm           = excluded.trgm,
           token_jaccard  = excluded.token_jaccard,
           grund          = excluded.grund,
           fn_name        = excluded.fn_name;

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

COMMENT ON FUNCTION manual.betrieb_vorschlaege_berechnen() IS
'Berechnet Zuordnungsvorschlaege neu. Aendert getroffene Entscheidungen
(entscheidung_key, ohne_gegenstueck, notiz) NICHT — nur die Vorschlagsspalten.
Nach jedem Import neuer Kostenstellen aufrufbar.';


-- ---------------------------------------------------------------------
-- Entscheidungen und eindeutige Vorschlaege nach core.kostenstelle
--
-- 'unsicher' und 'kein_treffer' werden bewusst NICHT uebernommen: sie
-- bleiben NULL und damit sichtbar offen.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION manual.betrieb_zuordnung_anwenden()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
    UPDATE core.kostenstelle k
       SET betrieb_key = coalesce(z.entscheidung_key, z.vorschlag_key)
      FROM manual.betrieb_zuordnung z
     WHERE k.restaurant_id = z.restaurant_id
       AND NOT z.ohne_gegenstueck
       AND (z.entscheidung_key IS NOT NULL
            OR z.grund IN ('exakt', 'variante'))
       AND k.betrieb_key IS DISTINCT FROM
           coalesce(z.entscheidung_key, z.vorschlag_key);

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

COMMENT ON FUNCTION manual.betrieb_zuordnung_anwenden() IS
'Traegt Entscheidungen und eindeutige Vorschlaege in core.kostenstelle.betrieb_key
ein. "unsicher" und "kein_treffer" bleiben NULL — offen ist besser als falsch.';


-- Die offenen Faelle sichtbar machen: was ein Mensch anschauen muss.
CREATE OR REPLACE VIEW manual.betrieb_zuordnung_offen AS
SELECT z.restaurant_id, m.name AS marke, z.fn_name, z.grund,
       z.vorschlag_key, z.vorschlag_name, z.trgm, z.token_jaccard,
       (SELECT count(*) FROM core.kostenstelle k
         WHERE k.restaurant_id = z.restaurant_id) AS kostenstellen,
       (SELECT count(*) FROM core.bestellung b
          JOIN core.kostenstelle k USING (kostenstelle_key)
         WHERE k.restaurant_id = z.restaurant_id) AS bestellungen
  FROM manual.betrieb_zuordnung z
  JOIN core.marke m USING (marke_key)
 WHERE z.entscheidung_key IS NULL
   AND NOT z.ohne_gegenstueck
   AND z.grund IN ('unsicher', 'kein_treffer')
 ORDER BY bestellungen DESC, z.fn_name;

COMMENT ON VIEW manual.betrieb_zuordnung_offen IS
'Faelle, die eine menschliche Entscheidung brauchen — nach Bestellmenge
sortiert, damit der groesste Hebel oben steht.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0034', to_jsonb(
        'Betriebszuordnung FoodNotify<->LINA: Vorschlagstabelle '
        'manual.betrieb_zuordnung, Trigramm plus Token-Ueberschneidung. '
        'Trigramm allein ordnet Enchilada Halle falsch zu (Hamm 0.63 > Halle 0.53).'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
