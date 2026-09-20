-- =====================================================================
-- 0107 — Neue Ampelschwellen, und die erste, die je Marke gilt
--
-- Eugene hat das Regelwerk am 20.09.2026 neu gesetzt. Vier der sechs
-- Bereiche bekommen andere Zahlen, und beim Wareneinsatz faellt eine
-- Annahme, die seit 0004 in diesem Schema steckte: EINE Schwelle fuer
-- alle Betriebe. Eine Bar in einem Wilma Wunder und eine in einem
-- Enchilada sind nicht dasselbe Geschaeft, und ein gemeinsamer
-- Grenzwert sagt ueber beide wenig.
--
-- DIE NEUE MATRIX
--
--   Bereich          Marke                  gruen bis   orange bis
--   ---------------------------------------------------------------
--   Umsatz vs. VJ    alle                       >= 5 %      >= 0 %
--   Personal o. GF   alle                         34          38
--   Online-Bewertung alle                      >= 4,40     >= 4,00
--   OM vor Ort       alle                      >= 4        >= 3      (unveraendert)
--   ---------------------------------------------------------------
--   WE Bar           Wilma Wunder                 17          19
--                    Aposto                       19          22
--                    Enchilada                    22          24
--                    Deutsche Konzepte        KEIN URTEIL
--                    alle uebrigen                17          19
--   ---------------------------------------------------------------
--   WE Kueche        Wilma Wunder                 25          27
--                    Aposto                       23          25
--                    Enchilada                    24          26
--                    Deutsche Konzepte            25          27
--                    alle uebrigen                25          27
--
-- ZWEI ENTSCHEIDUNGEN, DIE MAN DEN ZAHLEN NICHT ANSIEHT:
--
-- 1. WE Bar bei den Deutschen Konzepten bleibt OHNE URTEIL. Die
--    Brauereibindungen dieser Betriebe machen den Getraenkeeinsatz
--    zwischen ihnen unvergleichbar; eine Schwelle waere geraten. Die
--    Zahl steht weiter in jeder Tabelle, nur ohne Farbe. Nachgemessen
--    am 20.09.2026 in Produktion: die zwoelf betroffenen Betriebe
--    streuen von 7,50 % bis 27,59 % — jede einheitliche Grenze haette
--    diese Spanne mitten durchgeschnitten.
--
--    Das ist ausdruecklich KEIN fehlendes Signal im Sinne von 0080,
--    sondern ein ausgesetztes. Der Unterschied steht in
--    mart.round_table_unvollstaendig: `fehlt_we_bar` heisst "keine
--    Zahl", `ohne_schwelle_we_bar` heisst "Zahl da, Schwelle offen".
--    Ohne diese Trennung waere "unvollstaendig" wieder das, wovor 0080
--    warnt: ein anderes Wort fuer "keine Ahnung".
--
-- 2. DER RUECKFALL IST DER WILMA-SATZ. Wer keinen eigenen Satz hat —
--    Kooperationspartner, Besitos, Schlager Cafe, Ghost Kitchen und
--    jede Marke, die morgen dazukommt —, wird an Wilma Wunder gemessen.
--    Deshalb stehen die Wilma-Zahlen zweimal: einmal als Rueckfall in
--    ampel.regel, einmal als eigener Satz in ampel.regel_konzept. Das
--    ist Absicht und keine Dopplung — die beiden bedeuten Verschiedenes
--    und koennen morgen auseinanderlaufen, ohne dass jemand erst die
--    Herkunft der Zahl rekonstruieren muss.
--
-- WARUM EINE TABELLE UND KEIN CODE: dieselbe Begruendung wie 0004. Das
-- Regelwerk ist bewusst Daten. Die naechste Schwellenaenderung ist ein
-- UPDATE und kein Deploy — und mart.ampel_schwelle zeigt jederzeit, was
-- gerade gilt und wen es trifft.
--
-- LEHNERS: die Lehners-Betriebe laufen heute unter dem Hauptkonzept
-- "Deutsche Konzepte", das eigene Konzept `Lehners` traegt keinen
-- einzigen Betrieb (nachgemessen am 20.09.2026). Es bekommt trotzdem
-- denselben Satz. Wuerde ein Betrieb morgen dorthin umgehaengt, bekaeme
-- er sonst stillschweigend den Wilma-Satz auf den Getraenkeeinsatz —
-- genau das Urteil, das oben als "geraten" verworfen wurde.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Welche Marke gilt fuer einen Betrieb — im Schema ampel
--
-- Dieselbe Aufloesung wie mart.konzept_zuordnung: die Handentscheidung
-- aus manual.betrieb_hauptkonzept gewinnt, sonst zaehlt ein Konzept nur,
-- wenn es das einzige ist. Mehrdeutige bleiben NULL und fallen damit auf
-- den Rueckfall zurueck.
--
-- Bewusst hier und nicht per Join auf mart: ampel.bewerte() haengt an
-- dieser Aufloesung, und mart haengt an ampel.bewerte(). Ein Blick von
-- ampel nach mart waere ein Ring — beim naechsten CREATE OR REPLACE in
-- mart faellt er jemandem auf die Fuesse. core liest ampel ohnehin schon
-- (core.schwellenwert_betrieb, seit 0004).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ampel.hauptkonzept(p_betrieb_key integer)
RETURNS integer
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT coalesce(
        (SELECT m.konzept_key
           FROM manual.betrieb_hauptkonzept m
          WHERE m.betrieb_key = p_betrieb_key),
        -- min() + HAVING count(*) = 1: genau ein Konzept, sonst nichts.
        (SELECT min(bk.konzept_key)
           FROM core.betrieb_konzept bk
          WHERE bk.betrieb_key = p_betrieb_key
         HAVING count(*) = 1));
$$;

COMMENT ON FUNCTION ampel.hauptkonzept(integer) IS
'Das Hauptkonzept eines Betriebs als Schluessel, nach denselben Regeln wie
mart.konzept_zuordnung.hauptkonzept: Handentscheidung vor LINA-Eindeutigkeit,
Mehrdeutige bleiben NULL.
Liegt im Schema ampel, weil ampel.bewerte() sie braucht und mart umgekehrt an
ampel.bewerte() haengt.';


CREATE OR REPLACE VIEW ampel.konzept_je_betrieb AS
SELECT b.betrieb_key,
       ampel.hauptkonzept(b.betrieb_key) AS konzept_key
  FROM core.betrieb b;

COMMENT ON VIEW ampel.konzept_je_betrieb IS
'Betrieb zu Hauptkonzept-Schluessel, eine Zeile je Betrieb. Die Form von
ampel.hauptkonzept(), die sich joinen laesst — fuer die Sichten, die wissen
muessen, WELCHE Schwelle auf einen Betrieb angewendet wurde.';


-- ---------------------------------------------------------------------
-- 2. Der Satz je Marke
--
-- Kein zweites Regelwerk: ein Regelwerk ist eine andere PHILOSOPHIE
-- (einheitlich messen gegen LINAs betriebsindividuelle Werte), eine
-- Marke ist eine andere ZAHL in derselben Philosophie. Als Regelwerk
-- modelliert braeuchte jeder Markenwechsel ein neues Regelwerk und jede
-- Auswertung eine Fallunterscheidung.
-- ---------------------------------------------------------------------

CREATE TABLE ampel.regel_konzept (
    regelwerk_key   text    NOT NULL,
    bereich         text    NOT NULL,
    konzept_key     integer NOT NULL REFERENCES core.konzept(konzept_key),
    schwelle_gruen  numeric(10,2),
    schwelle_orange numeric(10,2),
    ohne_urteil     boolean NOT NULL DEFAULT false,
    hinweis         text,
    PRIMARY KEY (regelwerk_key, bereich, konzept_key),
    FOREIGN KEY (regelwerk_key, bereich)
        REFERENCES ampel.regel (regelwerk_key, bereich) ON DELETE CASCADE,

    -- Ein Satz ist entweder vollstaendig oder ausdruecklich ausgesetzt.
    -- Halbe Saetze gaebe es sonst lautlos: eine fehlende Schwelle faellt
    -- in ampel.bewerte() auf den Rueckfall durch, und niemand saehe, dass
    -- die Marke eigentlich einen eigenen Wert haben sollte.
    CONSTRAINT regel_konzept_entweder_oder CHECK (
        CASE WHEN ohne_urteil
             THEN schwelle_gruen IS NULL AND schwelle_orange IS NULL
             ELSE schwelle_gruen IS NOT NULL AND schwelle_orange IS NOT NULL
        END),

    -- Ein ausgesetztes Urteil OHNE Begruendung waere in einem Jahr nicht
    -- mehr von einem vergessenen zu unterscheiden.
    CONSTRAINT regel_konzept_ausgesetzt_begruendet CHECK (
        NOT ohne_urteil OR hinweis IS NOT NULL)
);

COMMENT ON TABLE ampel.regel_konzept IS
'Schwellen, die nur fuer EINE Marke gelten. Ueberschreibt ampel.regel fuer die
Betriebe dieser Marke; wer hier keine Zeile hat, wird am Rueckfall in
ampel.regel gemessen.
Seit 0107 fuer den Wareneinsatz belegt — eine Bar im Wilma Wunder und eine im
Enchilada sind nicht dasselbe Geschaeft.
Was gerade gilt und wen es trifft: mart.ampel_schwelle.';
COMMENT ON COLUMN ampel.regel_konzept.ohne_urteil IS
'true = fuer diese Marke wird in diesem Bereich BEWUSST nicht bewertet. Die Zahl
bleibt sichtbar, die Ampel bleibt leer. Nicht dasselbe wie eine fehlende Zahl:
den Unterschied fuehrt mart.round_table_unvollstaendig in getrennten Spalten.';
COMMENT ON COLUMN ampel.regel_konzept.hinweis IS
'Warum dieser Satz — bei ohne_urteil Pflicht. Ein ausgesetztes Urteil ohne
Begruendung ist von einem vergessenen nicht zu unterscheiden.';


-- ---------------------------------------------------------------------
-- 3. Die Bewertung, jetzt dreistufig
--
-- Von spezifisch nach allgemein: Betrieb (LINAs eigene Schwellen) vor
-- Marke vor Rueckfall. Heute ueberschneiden sich die beiden oberen
-- Stufen nirgends — `schwellenquelle = lina_betrieb` gibt es nur fuer
-- den Personalbereich, Markensaetze nur fuer den Wareneinsatz. Die
-- Reihenfolge steht trotzdem fest, damit sie nicht beim ersten
-- Ueberschneidungsfall neu erfunden wird.
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
    rk          ampel.regel_konzept%ROWTYPE;
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

    -- Stufe 1: was LINA fuer diesen einen Betrieb fuehrt.
    IF r.schwellenquelle = 'lina_betrieb' THEN
        SELECT s.schwelle_gruen, s.schwelle_orange INTO v_gruen, v_orange
          FROM core.schwellenwert_betrieb s
         WHERE s.betrieb_key = p_betrieb_key
           AND s.bereich     = p_bereich
           AND (p_stichtag IS NULL OR s.gueltig_ab <= p_stichtag)
         ORDER BY s.gueltig_ab DESC
         LIMIT 1;
    END IF;

    -- Stufe 2: der Satz der Marke.
    --
    -- Das EXISTS davor ist kein Zierrat: ohne es kostete JEDE Bewertung
    -- die Konzeptaufloesung, auch in den vier Bereichen, die gar keine
    -- Markensaetze kennen. mart.round_table_monat ruft diese Funktion
    -- beim Auffrischen rund 88.000 Mal auf (141 Betriebe x 104 Monate x
    -- 6 Bereiche).
    IF v_gruen IS NULL
       AND EXISTS (SELECT 1 FROM ampel.regel_konzept x
                    WHERE x.regelwerk_key = v_regelwerk AND x.bereich = p_bereich) THEN
        SELECT * INTO rk FROM ampel.regel_konzept x
         WHERE x.regelwerk_key = v_regelwerk
           AND x.bereich       = p_bereich
           AND x.konzept_key   = ampel.hauptkonzept(p_betrieb_key);
        IF FOUND THEN
            -- Ausdruecklich kein Urteil. Nicht "gruen, weil nichts
            -- dagegen spricht" — das waere derselbe Fehler wie in 0080.
            IF rk.ohne_urteil THEN RETURN NULL; END IF;
            v_gruen  := rk.schwelle_gruen;
            v_orange := rk.schwelle_orange;
        END IF;
    END IF;

    -- Stufe 3: der Rueckfall des Regelwerks.
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

DREI STUFEN, von spezifisch nach allgemein:
  1. core.schwellenwert_betrieb, wenn die Regel schwellenquelle=lina_betrieb traegt
  2. ampel.regel_konzept fuer das Hauptkonzept des Betriebs (seit 0107)
  3. die festen Schwellen der Regel selbst

NULL heisst "kein Urteil" und hat zwei Ursachen: kein Wert, oder ein Markensatz
mit ohne_urteil = true. Welche davon, sagt mart.round_table_unvollstaendig.';


-- ---------------------------------------------------------------------
-- 4. Die neuen Zahlen
--
-- Erst der Rueckfall, dann die Saetze der Marken. Davor eine Probe auf
-- die Namen: die Markensaetze werden ueber core.konzept.name zugeordnet,
-- und ein Tippfehler wuerde sonst genau nichts tun — keine Zeile, keine
-- Meldung, und die Marke liefe still im Rueckfall mit. Das ist die
-- Signatur, die dieses Projekt schon zweimal Tage gekostet hat.
-- ---------------------------------------------------------------------

DO $$
DECLARE
    v_fehlend text;
BEGIN
    SELECT string_agg(n, ', ') INTO v_fehlend
      FROM unnest(ARRAY['Wilma Wunder','Aposto','Enchilada','Deutsche Konzepte','Lehners']) n
     WHERE NOT EXISTS (SELECT 1 FROM core.konzept k WHERE k.name = n);

    IF v_fehlend IS NOT NULL THEN
        RAISE EXCEPTION
          'Konzept nicht gefunden: %. Die Markensaetze in 0107 haengen an core.konzept.name; '
          'wurde eine Marke umbenannt, gehoert der Name hier korrigiert — sonst laeuft sie '
          'stillschweigend im Rueckfall.', v_fehlend;
    END IF;
END $$;


-- Der Rueckfall, fuer beide Regelwerke. Die Bewertung (4,40 / 4,00) und
-- die OM-Note (4 / 3) bleiben unangetastet.
UPDATE ampel.regel SET
    schwelle_gruen  = 5.00,
    schwelle_orange = 0.00,
    hinweis = 'Veraenderung zum Vorjahr in Prozent. Ab 0107: gruen ab +5 % (davor +10 %).'
 WHERE bereich = 'umsatz';

UPDATE ampel.regel SET
    schwelle_gruen  = 34.00,
    schwelle_orange = 38.00,
    hinweis = 'Personalkosten ohne GF in Prozent. Ab 0107: 34 / 38 (davor 28 / 32).'
 WHERE bereich = 'personal' AND schwellenquelle = 'fest';

UPDATE ampel.regel SET
    schwelle_gruen  = 17.00,
    schwelle_orange = 19.00,
    hinweis = 'Rueckfall fuer Marken ohne eigenen Satz — bewusst der Wilma-Wunder-Satz '
              '(Entscheidung 20.09.2026). Die Markensaetze stehen in ampel.regel_konzept.'
 WHERE bereich = 'we_bar';

UPDATE ampel.regel SET
    schwelle_gruen  = 25.00,
    schwelle_orange = 27.00,
    hinweis = 'Rueckfall fuer Marken ohne eigenen Satz — bewusst der Wilma-Wunder-Satz '
              '(Entscheidung 20.09.2026). Die Markensaetze stehen in ampel.regel_konzept.'
 WHERE bereich = 'we_kueche';


-- Die Saetze der Marken. Fuer BEIDE Regelwerke dieselben: LINA kennt
-- keine Wareneinsatzschwellen, das stand schon 2004 als Begruendung an
-- den uebernommenen Zeilen.
INSERT INTO ampel.regel_konzept
    (regelwerk_key, bereich, konzept_key, schwelle_gruen, schwelle_orange, ohne_urteil, hinweis)
SELECT w.regelwerk_key, v.bereich, k.konzept_key,
       v.gruen, v.orange, v.ohne_urteil, v.hinweis
  FROM (VALUES
    ('we_bar',    'Wilma Wunder',      17.00::numeric, 19.00::numeric, false,
     'Vorgabe Eugene, 20.09.2026'),
    ('we_bar',    'Aposto',            19.00,          22.00,          false,
     'Vorgabe Eugene, 20.09.2026'),
    ('we_bar',    'Enchilada',         22.00,          24.00,          false,
     'Vorgabe Eugene, 20.09.2026'),
    ('we_bar',    'Deutsche Konzepte', NULL,           NULL,           true,
     'Kein Urteil: die Brauereibindungen dieser Betriebe machen den Getraenkeeinsatz '
     'untereinander unvergleichbar. Gemessen am 20.09.2026 streuen die zwoelf operativen '
     'Betriebe mit Zahl von 7,50 % bis 27,59 % — jede einheitliche Grenze schnitte mitten '
     'hindurch. Die Zahl bleibt sichtbar, nur ohne Ampel. Offen in docs/offene-punkte.md.'),
    ('we_bar',    'Lehners',           NULL,           NULL,           true,
     'Wie Deutsche Konzepte: Brauereibindung. Das Konzept traegt heute keinen Betrieb '
     '(nachgemessen 20.09.2026) — die Zeile steht hier, damit ein umgehaengter Betrieb '
     'nicht stillschweigend den Wilma-Satz auf den Getraenkeeinsatz bekommt.'),

    ('we_kueche', 'Wilma Wunder',      25.00,          27.00,          false,
     'Vorgabe Eugene, 20.09.2026'),
    ('we_kueche', 'Aposto',            23.00,          25.00,          false,
     'Vorgabe Eugene, 20.09.2026'),
    ('we_kueche', 'Enchilada',         24.00,          26.00,          false,
     'Vorgabe Eugene, 20.09.2026'),
    ('we_kueche', 'Deutsche Konzepte', 25.00,          27.00,          false,
     'Wie Wilma Wunder — Vorgabe Eugene, 20.09.2026. Beim Essenseinsatz ist die Marke '
     'vergleichbar, beim Getraenkeeinsatz nicht.'),
    ('we_kueche', 'Lehners',           25.00,          27.00,          false,
     'Wie Deutsche Konzepte, siehe dort.')
  ) AS v(bereich, konzept, gruen, orange, ohne_urteil, hinweis)
  JOIN core.konzept k    ON k.name = v.konzept
  CROSS JOIN ampel.regelwerk w;


-- ---------------------------------------------------------------------
-- 5. Was gilt gerade, und fuer wen?
--
-- Ohne diese Sicht waere die Antwort auf "warum steht dieser Betrieb auf
-- rot" eine Wanderung durch drei Tabellen. Sie loest die drei Stufen aus
-- ampel.bewerte() auf und zaehlt dazu, wie viele operative Betriebe an
-- jeder Zeile haengen — eine Schwelle ohne Betriebe dahinter ist meist
-- ein Rest und kein Regelwerk.
-- ---------------------------------------------------------------------

CREATE VIEW mart.ampel_schwelle AS
WITH bereich AS (
    SELECT * FROM (VALUES
        ('umsatz',    'Umsatz',           1),
        ('personal',  'Personal',         2),
        ('we_bar',    'WE Bar',           3),
        ('we_kueche', 'WE Küche',         4),
        ('bewertung', 'Online-Bewertung', 5),
        ('om',        'OM vor Ort',       6)
    ) v(bereich, bereich_name, reihenfolge)
),
saetze AS (
    -- Der Rueckfall: eine Zeile je Regel.
    SELECT r.regelwerk_key, r.bereich, r.richtung, r.schwellenquelle,
           NULL::integer            AS konzept_key,
           '(alle übrigen Marken)'  AS konzept,
           true                     AS ist_rueckfall,
           false                    AS ohne_urteil,
           r.schwelle_gruen, r.schwelle_orange, r.hinweis
      FROM ampel.regel r
    UNION ALL
    -- Und je Marke, die einen eigenen Satz hat.
    SELECT r.regelwerk_key, r.bereich, r.richtung, r.schwellenquelle,
           k.konzept_key, k.name, false, rk.ohne_urteil,
           rk.schwelle_gruen, rk.schwelle_orange, rk.hinweis
      FROM ampel.regel_konzept rk
      JOIN ampel.regel r    ON r.regelwerk_key = rk.regelwerk_key AND r.bereich = rk.bereich
      JOIN core.konzept k   ON k.konzept_key   = rk.konzept_key
)
SELECT w.regelwerk_key,
       w.name AS regelwerk,
       w.ist_standard,
       s.bereich,
       b.bereich_name,
       b.reihenfolge,
       s.konzept,
       s.konzept_key,
       s.ist_rueckfall,
       s.richtung,
       s.ohne_urteil,
       s.schwelle_gruen,
       s.schwelle_orange,
       CASE
         WHEN s.ohne_urteil                    THEN 'kein Urteil'
         WHEN s.schwellenquelle = 'lina_betrieb' THEN 'je Betrieb aus LINA'
         WHEN s.schwelle_gruen IS NULL         THEN 'keine Schwelle hinterlegt'
         -- Dezimalkomma von Hand: to_char() folgt lc_numeric, und das
         -- steht auf dem Server auf C. "17.00" in einer deutschen
         -- Kachel liest sich wie ein Tippfehler.
         WHEN s.richtung = 'niedriger_ist_besser'
           THEN 'grün bis '      || replace(trim(to_char(s.schwelle_gruen,  'FM999990.00')), '.', ',')
             || ' · orange bis ' || replace(trim(to_char(s.schwelle_orange, 'FM999990.00')), '.', ',')
         ELSE 'grün ab '         || replace(trim(to_char(s.schwelle_gruen,  'FM999990.00')), '.', ',')
             || ' · orange ab '  || replace(trim(to_char(s.schwelle_orange, 'FM999990.00')), '.', ',')
       END AS gilt,
       -- Wen trifft diese Zeile heute? Beim Rueckfall sind das genau die
       -- operativen Betriebe, deren Marke in diesem Bereich KEINEN
       -- eigenen Satz hat.
       CASE WHEN s.ist_rueckfall THEN (
              SELECT count(*)
                FROM ampel.konzept_je_betrieb kb
                JOIN mart.betrieb_status bs ON bs.betrieb_key = kb.betrieb_key
               WHERE bs.status = 'operativ'
                 AND NOT EXISTS (SELECT 1 FROM ampel.regel_konzept x
                                  WHERE x.regelwerk_key = s.regelwerk_key
                                    AND x.bereich       = s.bereich
                                    AND x.konzept_key   = kb.konzept_key))
            ELSE (
              SELECT count(*)
                FROM ampel.konzept_je_betrieb kb
                JOIN mart.betrieb_status bs ON bs.betrieb_key = kb.betrieb_key
               WHERE bs.status = 'operativ'
                 AND kb.konzept_key = s.konzept_key)
       END::int AS betriebe_operativ,
       s.hinweis
  FROM saetze s
  JOIN ampel.regelwerk w ON w.regelwerk_key = s.regelwerk_key
  JOIN bereich b         ON b.bereich       = s.bereich;

COMMENT ON VIEW mart.ampel_schwelle IS
'DAS REGELWERK ZUM NACHLESEN: welche Schwelle in welchem Bereich fuer welche Marke
gilt, und wie viele operative Betriebe daran haengen.

Eine Zeile je Regelwerk, Bereich und Marke, dazu je Bereich die Zeile
"(alle übrigen Marken)" — der Rueckfall aus ampel.regel, an dem gemessen wird,
wer keinen eigenen Satz hat.

ohne_urteil = true heisst: hier wird BEWUSST nicht bewertet. Der Grund steht in
hinweis. Das ist kein fehlender Wert — welche Betriebe es trifft, zeigt
mart.round_table_unvollstaendig.ohne_schwelle_*.

Das Standardregelwerk ist die Zeile mit ist_standard; nur danach urteilt
mart.round_table_monat.';


-- ---------------------------------------------------------------------
-- 6. "Unvollstaendig" bekommt eine zweite Ursache
--
-- 0080 hat gruen von unvollstaendig getrennt, weil ein fehlendes Signal
-- wie ein gutes aussah. Ein ausgesetztes Urteil sieht jetzt wie ein
-- fehlendes aus — dieselbe Falle, eine Ebene weiter. Der Unterschied ist
-- fuer die Arbeitsliste entscheidend:
--
--   fehlt_we_bar          jemand muss etwas nachtragen
--   ohne_schwelle_we_bar  die Zahl ist da, die Schwelle ist offen —
--                         nachtragen hilft nicht, entscheiden hilft
--
-- Die sechs ohne_schwelle_*-Spalten bilden die sechs fehlt_*-Spalten
-- bewusst vollstaendig ab, obwohl heute nur we_bar belegt ist: wer
-- morgen einen Bereich fuer eine Marke aussetzt, braucht die Spalte
-- schon, sonst verschwindet es wieder still.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.round_table_unvollstaendig AS
WITH ausgesetzt AS (
    SELECT kb.betrieb_key, rk.bereich, rk.hinweis
      FROM ampel.regel_konzept rk
      JOIN ampel.regelwerk w           ON w.regelwerk_key = rk.regelwerk_key AND w.ist_standard
      JOIN ampel.konzept_je_betrieb kb ON kb.konzept_key  = rk.konzept_key
     WHERE rk.ohne_urteil
),
je_betrieb AS (
    SELECT betrieb_key,
           bool_or(bereich = 'umsatz')    AS umsatz,
           bool_or(bereich = 'personal')  AS personal,
           bool_or(bereich = 'we_bar')    AS we_bar,
           bool_or(bereich = 'we_kueche') AS we_kueche,
           bool_or(bereich = 'bewertung') AS bewertung,
           bool_or(bereich = 'om')        AS om,
           string_agg(DISTINCT hinweis, ' | ') AS grund
      FROM ausgesetzt
     GROUP BY betrieb_key
),
markiert AS (
    SELECT r.monat, r.betrieb_key, r.betrieb, r.konzept, r.status, r.operativ,
           r.umsatz_pct             IS NULL AS fehlt_umsatz,
           r.personalkosten_ogf_pct IS NULL AS fehlt_personal,
           r.we_bar_pct             IS NULL AS fehlt_we_bar,
           r.we_kueche_pct          IS NULL AS fehlt_we_kueche,
           r.online_bewertung       IS NULL AS fehlt_bewertung,
           r.om_score               IS NULL AS fehlt_om,
           -- Nur wo eine Zahl steht. Fehlt sie ohnehin, ist das eine
           -- Luecke und keine offene Schwelle — sonst zaehlte derselbe
           -- Betrieb in beiden Spalten.
           coalesce(a.umsatz,    false) AND r.umsatz_pct             IS NOT NULL AS ohne_schwelle_umsatz,
           coalesce(a.personal,  false) AND r.personalkosten_ogf_pct IS NOT NULL AS ohne_schwelle_personal,
           coalesce(a.we_bar,    false) AND r.we_bar_pct             IS NOT NULL AS ohne_schwelle_we_bar,
           coalesce(a.we_kueche, false) AND r.we_kueche_pct          IS NOT NULL AS ohne_schwelle_we_kueche,
           coalesce(a.bewertung, false) AND r.online_bewertung       IS NOT NULL AS ohne_schwelle_bewertung,
           coalesce(a.om,        false) AND r.om_score               IS NOT NULL AS ohne_schwelle_om,
           a.grund
      FROM mart.round_table_basis r
      LEFT JOIN je_betrieb a ON a.betrieb_key = r.betrieb_key
)
SELECT monat,
       betrieb_key,
       betrieb,
       konzept,
       status,
       operativ,
       fehlt_umsatz::int + fehlt_personal::int + fehlt_we_bar::int
     + fehlt_we_kueche::int + fehlt_bewertung::int + fehlt_om::int AS signale_fehlen,
       fehlt_umsatz,
       fehlt_personal,
       fehlt_we_bar,
       fehlt_we_kueche,
       fehlt_bewertung,
       fehlt_om,
       ohne_schwelle_umsatz,
       ohne_schwelle_personal,
       ohne_schwelle_we_bar,
       ohne_schwelle_we_kueche,
       ohne_schwelle_bewertung,
       ohne_schwelle_om,
       ohne_schwelle_umsatz::int + ohne_schwelle_personal::int + ohne_schwelle_we_bar::int
     + ohne_schwelle_we_kueche::int + ohne_schwelle_bewertung::int
     + ohne_schwelle_om::int AS signale_ohne_schwelle,
       CASE WHEN ohne_schwelle_umsatz OR ohne_schwelle_personal OR ohne_schwelle_we_bar
              OR ohne_schwelle_we_kueche OR ohne_schwelle_bewertung OR ohne_schwelle_om
            THEN grund END AS grund_ohne_schwelle
  FROM markiert
 WHERE fehlt_umsatz OR fehlt_personal OR fehlt_we_bar
    OR fehlt_we_kueche OR fehlt_bewertung OR fehlt_om
    OR ohne_schwelle_umsatz OR ohne_schwelle_personal OR ohne_schwelle_we_bar
    OR ohne_schwelle_we_kueche OR ohne_schwelle_bewertung OR ohne_schwelle_om
 ORDER BY monat DESC, signale_fehlen DESC, betrieb;

COMMENT ON VIEW mart.round_table_unvollstaendig IS
'Warum ein Round-Table-Urteil nicht vollstaendig ist, je Betrieb und Monat.

ZWEI VERSCHIEDENE URSACHEN, und sie stehen mit Absicht in getrennten Spalten:
  fehlt_*          die Zahl fehlt. Jemand muss etwas nachtragen.
  ohne_schwelle_*  die Zahl ist da, aber fuer diese Marke wird in diesem Bereich
                   bewusst nicht bewertet (ampel.regel_konzept.ohne_urteil).
                   Nachtragen hilft hier nicht — nur entscheiden.
                   Seit 0107 belegt: WE Bar bei den Deutschen Konzepten,
                   Begruendung in grund_ohne_schwelle.

Beides fuehrt in mart.round_table_monat zu gesamt = unvollstaendig. Ohne die
Trennung waere das wieder nur ein anderes Wort fuer "keine Ahnung" — genau das,
wovor 0080 warnt.

Die haeufigste Spalte ist seit Juli 2026 fehlt_om: manual.om_einschaetzung endet
im Juni. Nachgetragen wird sie ueber pflege/om_einschaetzung.csv (0079).';


-- ---------------------------------------------------------------------
-- 7. Dasselbe im Langformat
--
-- mart.ampel_bereich ist die Sicht, auf der die Kachel "Ampeln nach
-- Bereich" und die Ampelhistorie stehen. Dort stand fuer jede leere
-- Ampel "– keine Daten". Fuer die zwoelf Deutschen Konzepte mit einer
-- Getraenkeeinsatzzahl waere das schlicht falsch: die Daten sind da.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.ampel_bereich AS
WITH ausgesetzt AS (
    SELECT kb.betrieb_key, rk.bereich, rk.hinweis
      FROM ampel.regel_konzept rk
      JOIN ampel.regelwerk w           ON w.regelwerk_key = rk.regelwerk_key AND w.ist_standard
      JOIN ampel.konzept_je_betrieb kb ON kb.konzept_key  = rk.konzept_key
     WHERE rk.ohne_urteil
),
lang AS (
    SELECT r.monat, r.betrieb_key, r.betrieb, r.stadt, r.konzept, r.bwa_monat,
           r.gesamt, r.intensitaet, r.prioritaet, r.massnahme,
           r.status, r.operativ,
           b.bereich, b.bereich_name, b.reihenfolge, b.wert, b.ampel
      FROM mart.round_table_monat r
      CROSS JOIN LATERAL (
          VALUES ('umsatz'::text,    'Umsatz'::text,            1, r.umsatz_pct,             r.ampel_umsatz),
                 ('personal'::text,  'Personal'::text,          2, r.personalkosten_ogf_pct, r.ampel_personal),
                 ('we_bar'::text,    'WE Bar'::text,            3, r.we_bar_pct,             r.ampel_we_bar),
                 ('we_kueche'::text, 'WE Küche'::text,          4, r.we_kueche_pct,          r.ampel_we_kueche),
                 ('bewertung'::text, 'Online-Bewertung'::text,  5, r.online_bewertung,       r.ampel_bewertung),
                 ('om'::text,        'OM vor Ort'::text,        6, r.om_score::numeric,      r.ampel_om)
      ) AS b(bereich, bereich_name, reihenfolge, wert, ampel)
)
SELECT l.monat, l.betrieb_key, l.betrieb, l.stadt, l.konzept, l.bwa_monat,
       l.bereich, l.bereich_name, l.reihenfolge,
       l.wert,
       l.ampel,
       be.emoji,
       /*
        * Drei Faelle statt zwei. Die Reihenfolge ist die Aussagekraft:
        * ein Urteil schlaegt eine offene Schwelle schlaegt eine Luecke.
        */
       COALESCE(be.emoji || ' ' || be.bezeichnung,
                CASE WHEN aus.hinweis IS NOT NULL AND l.wert IS NOT NULL
                     THEN '– keine Schwelle' END,
                '– keine Daten') AS ampel_text,
       l.gesamt, l.intensitaet, l.prioritaet, l.massnahme,
       u.ursache_code,
       uk.bezeichnung AS ursache,
       u.notiz        AS ursache_notiz,
       l.status, l.operativ,
       (aus.hinweis IS NOT NULL AND l.wert IS NOT NULL) AS ohne_schwelle,
       CASE WHEN l.wert IS NOT NULL THEN aus.hinweis END AS ohne_schwelle_hinweis
  FROM lang l
  LEFT JOIN ampel.beschriftung be ON be.status = l.ampel
  LEFT JOIN ausgesetzt aus        ON aus.betrieb_key = l.betrieb_key
                                 AND aus.bereich     = l.bereich
  LEFT JOIN manual.ursache u      ON u.betrieb_key = l.betrieb_key
                                 AND u.monat       = l.monat
                                 AND u.bereich     = l.bereich
  LEFT JOIN manual.ursache_katalog uk ON uk.ursache_code = u.ursache_code;

COMMENT ON VIEW mart.ampel_bereich IS
'Die sechs Ampeln des Round Table im Langformat: eine Zeile je Betrieb, Monat und Bereich,
mit dem zugrunde liegenden Wert und der erfassten Ursache.
Fuer alles, was ueber Bereiche hinweg zaehlt oder gruppiert — "Rot-Treiber nach Bereich",
Ampelhistorie, Ursachenzuordnung. Fuer die klassische Round-Table-Tabelle bleibt
mart.round_table_monat die richtige Sicht.
ACHTUNG: eine Summe ueber wert ist sinnlos, die Spalte mischt Prozente mit Schulnoten.
ampel IS NULL hat seit 0107 ZWEI Ursachen: keine Daten, oder ohne_schwelle = true —
fuer diese Marke wird in diesem Bereich bewusst nicht bewertet (Grund in
ohne_schwelle_hinweis). In keinem der beiden Faelle heisst es "in Ordnung".';


-- ---------------------------------------------------------------------
-- 8. Der MCP-Zugang soll es auch wissen
--
-- Wer ueber ChatGPT oder Claude fragt "wie viele Betriebe stehen beim
-- Getraenkeeinsatz auf gruen", zaehlt sonst die Deutschen Konzepte
-- stillschweigend unter "keine Daten" mit.
-- ---------------------------------------------------------------------

INSERT INTO mcp.sicht (sicht, koernung, thema, summen_erlaubt) VALUES
  ('mart.ampel_schwelle',
   'Regelwerk, Bereich und Marke — welche Schwelle fuer wen gilt', 'round_table', false)
ON CONFLICT (sicht) DO UPDATE
   SET koernung = excluded.koernung, thema = excluded.thema;

-- Achsen und Spalten der neuen Sicht nachfuehren — sonst kennt
-- sichten_suchen sie, sicht_beschreiben aber nicht.
SELECT mcp.achsen_ableiten();

INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle) VALUES
  ('we_bar_ohne_schwelle', 'deutung', 'warnung', 'mart.round_table_monat',
   '{}',
   'ampel_we_bar ist bei den Deutschen Konzepten (Lehners, Ratskeller, Wirtshaeuser) '
   'ABSICHTLICH leer, obwohl we_bar_pct dort steht: die Brauereibindungen machen den '
   'Getraenkeeinsatz dieser Betriebe untereinander unvergleichbar, eine Schwelle waere '
   'geraten (Entscheidung 20.09.2026). Wer Ampeln zaehlt, darf diese Betriebe nicht unter '
   '"keine Daten" fuehren.',
   'Welche Schwelle fuer welche Marke gilt, steht in mart.ampel_schwelle; welche Betriebe '
   'es trifft, in mart.round_table_unvollstaendig.ohne_schwelle_we_bar.',
   'migrations/0107_schwellen_je_marke.sql'),

  ('schwellen_seit_0107', 'deutung', 'warnung', 'mart.ampel_bereich',
   '{}',
   'Die Ampelschwellen wurden am 20.09.2026 neu gesetzt: Umsatz gruen ab +5 % (davor +10 %), '
   'Personal o. GF gruen bis 34 % / orange bis 38 % (davor 28 / 32), Wareneinsatz seither JE '
   'MARKE. Ein Vergleich von Ampeln ueber dieses Datum hinweg vergleicht zwei Regelwerke.',
   'Fuer Zeitreihen ueber den 20.09.2026 hinaus die WERTE vergleichen (umsatz_pct, '
   'personalkosten_ogf_pct, we_bar_pct, we_kueche_pct), nicht die Ampeln.',
   'migrations/0107_schwellen_je_marke.sql')
ON CONFLICT (schluessel) DO UPDATE
   SET hinweis = excluded.hinweis, berichtigung = excluded.berichtigung,
       sicht = excluded.sicht, quelle = excluded.quelle, aktiv = true;


-- Die Leserolle. In mart/manual/ampel gilt die Standardvergabe aus 0105,
-- die neuen Objekte sind damit schon lesbar — der Grant steht hier als
-- Notnagel fuer den Fall, dass die Migration unter einem anderen Nutzer
-- laeuft als die Standardvergabe.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        EXECUTE 'GRANT SELECT ON ampel.regel_konzept, ampel.konzept_je_betrieb, '
                'mart.ampel_schwelle TO mcp_leser';
    END IF;
END $$;


-- ---------------------------------------------------------------------
-- 9. Die Urteile neu rechnen
--
-- mart.round_table_monat ist seit 0039 materialisiert: ohne diesen
-- Refresh stuenden bis zum naechsten Sync-Lauf die alten Ampeln neben
-- den neuen Schwellen. Ohne CONCURRENTLY, weil der Migrationslauf in
-- einer Transaktion steckt — die Sperre dauert Sekunden und faellt
-- nachts nicht auf.
-- ---------------------------------------------------------------------

REFRESH MATERIALIZED VIEW mart.round_table_monat;
REFRESH MATERIALIZED VIEW mart.round_table_trend;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0107', to_jsonb(
        'Ampelschwellen neu gesetzt (Vorgabe Eugene, 20.09.2026): Umsatz gruen ab +5 % '
        'statt +10 %, Personal o. GF 34/38 statt 28/32, Bewertung und OM unveraendert. '
        'Der Wareneinsatz gilt seither JE MARKE (ampel.regel_konzept): WE Bar 17/19 Wilma, '
        '19/22 Aposto, 22/24 Enchilada; WE Kueche 25/27 Wilma, 23/25 Aposto, 24/26 '
        'Enchilada. Rueckfall fuer Marken ohne eigenen Satz ist der Wilma-Satz. WE Bar bei '
        'den Deutschen Konzepten steht bewusst OHNE URTEIL (Brauereibindung) — sichtbar in '
        'mart.round_table_unvollstaendig.ohne_schwelle_we_bar, nicht als fehlender Wert. '
        'Was gerade gilt: SELECT * FROM mart.ampel_schwelle WHERE ist_standard;'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
