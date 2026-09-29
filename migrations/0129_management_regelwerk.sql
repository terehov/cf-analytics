-- =====================================================================
-- 0129 — Das Management-Regelwerk: gemessen wird die ABWEICHUNG, nicht
--        der Wert
--
-- Anlass: das Management-Dashboard, das Daniel am 29.09.2026 vorgelegt
-- hat — die bisherigen Round-Table-Seiten waren zu kompliziert. Mit ihm
-- kommt ein neues Regelwerk, und Daniel hat entschieden, dass es UEBERALL
-- gilt: im Round Table, im MCP-Zugang und im neuen Dashboard. Das alte
-- Regelwerk (0107) bleibt als `round_table_global` stehen, urteilt aber
-- nicht mehr.
--
-- DIE NEUE MATRIX
--
--   Bereich               gemessen wird                gruen        gelb/orange       rot
--   ---------------------------------------------------------------------------------------
--   Umsatz vs. VJ         Veraenderung in %            > +2 %       -2 % bis +2 %     < -2 %
--   Personal o. GF        Abweichung vom Budget, Pkt.  <= 0         bis +1            > +1
--   Personal Service      Abweichung vom VJ, Pkt.      <= 0         bis +1            > +1
--   Personal Kueche       Abweichung vom VJ, Pkt.      <= 0         bis +1            > +1
--   Personal Bar          Abweichung vom VJ, Pkt.      <= 0         bis +1            > +1
--   WE Kueche             Abweichung vom Soll, Pkt.    <= +0,5      bis +1,0          > +1,0
--   WE Getraenke          Abweichung vom Soll, Pkt.    <= +0,5      bis +1,0          > +1,0
--   Online-Bewertung      Sterne                       >= 4,30      4,00 bis 4,29     < 4,00
--   Rendite (YTD)         EBIT / Umsatz, %             > 10 %       5 bis 10 %        < 5 %
--   Bounti Abschluss      Anteil abgeschlossen, %      > 90 %       75 bis 90 %       < 75 %
--   Bounti Teilnahme      Anteil Koepfe mit Abschluss  > 95 %       85 bis 95 %       < 85 %
--
-- DAS GESAMTURTEIL — "nur die Zahlen sprechen lassen" (Daniel): Umsatz,
-- die vier Personalampeln, die beiden Wareneinsaetze und die Bewertung.
-- NICHT darin: Rendite und Bounti (stehen daneben, faerben den Betrieb
-- nicht), und die OM-Einschaetzung faellt ganz heraus. Das ist die
-- operative Performance. Welche Bereiche zaehlen, steht als Daten in
-- ampel.regel.im_gesamturteil und nicht im Code der Sichten.
--
-- VIER ENTSCHEIDUNGEN AUS DER RUECKFRAGE AN DANIEL (29.09.2026):
--
-- 1. BUDGET BEIM PERSONAL. Fuer 2026 ist in LINA keine Plan-BWA gepflegt
--    (0 von 62 operativen Betrieben; 2025: 38). Bis sie kommt, ist das
--    Budget die Sollquote aus ampel.soll (34 %, der Wert aus 0107). Steht
--    eine Planquote in core.bwa_plan, gewinnt sie AUTOMATISCH — ohne
--    Migration, ohne Schalter. Woher das Budget eines Betriebs kommt,
--    steht in personal_budget_quelle.
--
-- 2. WARENEINSATZ: die Schwelle aus Daniels Wareneinsatz-Block (gruen bis
--    +0,5, gelb bis +1,0), nicht die aus seiner Tabelle (gelb bis +0,5).
--    Das Soll je Marke sind die Gruenschwellen aus 0107. WE Getraenke bei
--    den Deutschen Konzepten bleibt OHNE URTEIL (Brauereibindung, 0107).
--
-- 3. RENDITE: die Ampel auf YTD, der Monat nur als Zahl. Ein Einzelmonat
--    schwankt mit jeder Einmalbuchung; nachgemessen am 29.09.2026 lag der
--    Median der operativen Betriebe im Juli bei 2,8 %, YTD Januar bis Juli
--    bei 0,18 % — die Wintermonate sind Verlustmonate. Dass die YTD-Ampel
--    damit bei rund zwei Dritteln der Betriebe rot steht, ist ein Befund
--    und kein Rechenfehler: die Gruppe lag im Juli bei 10,4 %.
--
-- 4. OM RAUS. Die Regel steht im neuen Regelwerk nicht, ampel_om bleibt als
--    Spalte (sie wird von Karten gelesen) und ist leer.
--
-- WIE DIE ABWEICHUNG IN DIE AMPEL KOMMT
--
-- ampel.bewerte() bleibt, was sie war: Wert gegen zwei Schwellen. Neu ist
-- ampel.regel.bezug. Bei `abweichung` bekommt die Regel nicht den Wert,
-- sondern seinen Abstand zum Bezug (Soll, Budget, Vorjahr) — und das
-- entscheidet ampel.urteil(), nicht jeder Aufrufer fuer sich. Ohne diese
-- Stelle haette mart.round_table(monat) den absoluten Getraenkeeinsatz
-- (z. B. 21,4) gegen die Schwelle +0,5 gehalten und JEDEN Betrieb rot
-- gefaerbt, fehlerfrei und still.
--
-- Die Rechenwege, alle nachgemessen am 29.09.2026 gegen Produktion:
--
--   Personal o. GF % = Personalkosten o.G. / (Erloese Speisen + Getraenke
--                      + sonstige Erloese)   — trifft LINAs Quote auf
--                      0,003 Pkt. (Median, 50 Betriebe, Juli 2026)
--   WE Kueche %      = WE Speisen / Erloese Speisen      (0,002 Pkt.)
--   WE Bar %         = WE Getraenke / Erloese Getraenke   (0,003 Pkt.)
--   Rendite %        = EBIT / Umsatz aus getKennzahlen (mart.rendite_monat)
--
-- Die Planquote rechnet mit denselben Zeilen aus core.bwa_plan. Probe an
-- 2025 (454 Betriebsmonate mit Plan): Median 36,5 %, p10 33 %, p90 40 %.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Drei neue Eigenschaften einer Regel
-- ---------------------------------------------------------------------

ALTER TABLE ampel.regel
    ADD COLUMN IF NOT EXISTS bezug text NOT NULL DEFAULT 'wert'
        CHECK (bezug IN ('wert', 'abweichung')),
    ADD COLUMN IF NOT EXISTS gruen_ausschliesslich boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS im_gesamturteil boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN ampel.regel.bezug IS
'wert = die Regel bewertet die Kennzahl selbst (Umsatzveraenderung, Sterne).
abweichung = die Regel bewertet den ABSTAND der Kennzahl zu ihrem Bezug — Soll,
Budget oder Vorjahr, in Prozentpunkten. Welcher Wert an ampel.bewerte() geht,
entscheidet ampel.urteil(); wer bewerte() direkt ruft, muss es selbst wissen.
Seit 0129.';
COMMENT ON COLUMN ampel.regel.gruen_ausschliesslich IS
'true = gruen erst UEBER der Schwelle (bzw. darunter), nicht auf ihr. Daniels Tabelle
sagt "> +2 %", "> 10 %", "> 90 %" — bei 2,00 % steht ein Betrieb dort auf gelb. Nur
fuer die Gruenschwelle; die Orangeschwelle ist immer einschliesslich ("-2 % bis
+2 %" ist gelb). Seit 0129.';
COMMENT ON COLUMN ampel.regel.im_gesamturteil IS
'true = diese Ampel zaehlt in gesamt und intensitaet. false = sie steht daneben und
faerbt den Betrieb nicht (seit 0129: Rendite und Bounti — "nur die Zahlen sprechen
lassen", Entscheidung Daniel 29.09.2026).';


-- ---------------------------------------------------------------------
-- 2. Soll und Budget als Daten
--
-- Eigene Tabelle und nicht die Gruenschwelle einer Regel: das Soll ist
-- eine fachliche Vorgabe, die Schwelle eine Toleranz darum. In 0107
-- steckte beides in einer Zahl (gruen bis 17), und genau das hat Daniels
-- Tabelle aufgedroeselt: gruen bis Soll + 0,5.
-- ---------------------------------------------------------------------

CREATE TABLE ampel.soll (
    bereich      text NOT NULL,
    -- NULL = der Rueckfall fuer jede Marke ohne eigene Zeile
    konzept_key  integer REFERENCES core.konzept(konzept_key),
    soll         numeric(6,2),
    hinweis      text,
    CONSTRAINT soll_eindeutig UNIQUE NULLS NOT DISTINCT (bereich, konzept_key),
    -- Ein Soll ohne Zahl ist ein ausgesetztes Urteil und braucht einen
    -- Grund — sonst ist es von einem vergessenen nicht zu unterscheiden.
    CONSTRAINT soll_leer_begruendet CHECK (soll IS NOT NULL OR hinweis IS NOT NULL)
);

COMMENT ON TABLE ampel.soll IS
'Das Soll je Bereich und Marke — die Groesse, gegen die eine Regel mit bezug =
abweichung misst. Eine Zeile mit konzept_key NULL ist der Rueckfall.
soll IS NULL heisst: fuer diese Marke gibt es BEWUSST kein Soll (Grund in hinweis).
Beim Personal ist es das Budget, solange keine Plan-BWA gepflegt ist — die
Planquote gewinnt in mart.round_table_basis.
Aufgeloest je Betrieb: ampel.soll_je_betrieb. Seit 0129.';

CREATE VIEW ampel.soll_je_betrieb AS
SELECT kb.betrieb_key,
       s.bereich,
       coalesce(m.soll, CASE WHEN m.bereich IS NULL THEN s.soll END) AS soll,
       CASE WHEN m.bereich IS NOT NULL THEN 'Marke' ELSE 'Rückfall' END AS quelle,
       coalesce(m.hinweis, s.hinweis) AS hinweis
  FROM ampel.konzept_je_betrieb kb
 CROSS JOIN ampel.soll s
  LEFT JOIN ampel.soll m ON m.bereich     = s.bereich
                        AND m.konzept_key = kb.konzept_key
 WHERE s.konzept_key IS NULL;

COMMENT ON VIEW ampel.soll_je_betrieb IS
'Das Soll je Betrieb und Bereich: die Zeile der Marke, sonst der Rueckfall. Steht die
Marke mit soll IS NULL in ampel.soll, bleibt das Soll leer — der Rueckfall springt
dann NICHT ein (sonst bekaeme eine Brauereimarke still den Wilma-Satz).
Eine Sicht und keine Funktion: ein Funktionsrumpf erbt die Rechte des Aufrufers,
und konzept_je_betrieb greift in core (0109).';


-- ---------------------------------------------------------------------
-- 3. ampel.bewerte() kennt "gruen erst oberhalb"
--
-- Der Rumpf ist der aus 0109, eine Zeile anders: die Gruenpruefung.
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

    -- Stufe 1: was LINA fuer diesen einen Betrieb fuehrt (0109: ueber die Sicht).
    IF r.schwellenquelle = 'lina_betrieb' THEN
        SELECT s.schwelle_gruen, s.schwelle_orange INTO v_gruen, v_orange
          FROM ampel.schwelle_je_betrieb s
         WHERE s.betrieb_key = p_betrieb_key
           AND s.bereich     = p_bereich
           AND (p_stichtag IS NULL OR s.gueltig_ab <= p_stichtag)
         ORDER BY s.gueltig_ab DESC
         LIMIT 1;
    END IF;

    -- Stufe 2: der Satz der Marke.
    IF v_gruen IS NULL
       AND EXISTS (SELECT 1 FROM ampel.regel_konzept x
                    WHERE x.regelwerk_key = v_regelwerk AND x.bereich = p_bereich) THEN
        SELECT * INTO rk FROM ampel.regel_konzept x
         WHERE x.regelwerk_key = v_regelwerk
           AND x.bereich       = p_bereich
           AND x.konzept_key   = ampel.hauptkonzept(p_betrieb_key);
        IF FOUND THEN
            IF rk.ohne_urteil THEN RETURN NULL; END IF;
            v_gruen  := rk.schwelle_gruen;
            v_orange := rk.schwelle_orange;
        END IF;
    END IF;

    -- Stufe 3: der Rueckfall des Regelwerks.
    v_gruen  := COALESCE(v_gruen,  r.schwelle_gruen);
    v_orange := COALESCE(v_orange, r.schwelle_orange);
    IF v_gruen IS NULL OR v_orange IS NULL THEN RETURN NULL; END IF;

    -- Seit 0129: gruen_ausschliesslich. Auf der Schwelle selbst ist dann
    -- noch nicht gruen, sondern orange.
    IF r.richtung = 'niedriger_ist_besser' THEN
        IF p_wert < v_gruen OR (p_wert = v_gruen AND NOT r.gruen_ausschliesslich)
                              THEN RETURN 'gruen';  END IF;
        IF p_wert <= v_orange THEN RETURN 'orange'; END IF;
        RETURN 'rot';
    ELSE
        IF p_wert > v_gruen OR (p_wert = v_gruen AND NOT r.gruen_ausschliesslich)
                              THEN RETURN 'gruen';  END IF;
        IF p_wert >= v_orange THEN RETURN 'orange'; END IF;
        RETURN 'rot';
    END IF;
END $$;

COMMENT ON FUNCTION ampel.bewerte IS
'Bewertet einen Wert gegen ein Regelwerk. Ohne p_regelwerk gilt das Standardregelwerk.

DREI STUFEN, von spezifisch nach allgemein:
  1. ampel.schwelle_je_betrieb, wenn die Regel schwellenquelle=lina_betrieb traegt
  2. ampel.regel_konzept fuer das Hauptkonzept des Betriebs (seit 0107)
  3. die festen Schwellen der Regel selbst

ACHTUNG seit 0129: bei Regeln mit bezug = abweichung erwartet diese Funktion die
ABWEICHUNG (Pkt. gegen Soll, Budget oder Vorjahr), nicht den Wert. Wer nicht weiss,
welches von beiden, ruft ampel.urteil().

NULL heisst "kein Urteil" und hat zwei Ursachen: kein Wert, oder ein Markensatz
mit ohne_urteil = true. Welche davon, sagt mart.round_table_unvollstaendig.';


-- ---------------------------------------------------------------------
-- 4. Der eine Einstieg, der Wert und Abweichung auseinanderhaelt
-- ---------------------------------------------------------------------

CREATE FUNCTION ampel.urteil(
    p_bereich       text,
    p_wert          numeric,
    p_abweichung    numeric,
    p_regelwerk     text    DEFAULT NULL,
    p_betrieb_key   integer DEFAULT NULL,
    p_stichtag      date    DEFAULT NULL
) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT ampel.bewerte(CASE r.bezug WHEN 'abweichung' THEN p_abweichung ELSE p_wert END,
                         p_bereich, r.regelwerk_key, p_betrieb_key, p_stichtag)
      FROM ampel.regel r
     WHERE r.regelwerk_key = coalesce(p_regelwerk,
                                      (SELECT w.regelwerk_key FROM ampel.regelwerk w
                                        WHERE w.ist_standard LIMIT 1))
       AND r.bereich = p_bereich;
$$;

COMMENT ON FUNCTION ampel.urteil IS
'Die Ampel eines Bereichs — mit dem Wert UND seiner Abweichung aufgerufen; welches von
beiden bewertet wird, sagt ampel.regel.bezug. Kennt das Regelwerk den Bereich nicht,
ist das Ergebnis NULL. Der Weg fuer jede Sicht, die mehr als ein Regelwerk kennt.
Seit 0129.';


CREATE FUNCTION ampel.signale(
    p_regelwerk text,
    p_bereiche  text[],
    p_status    text[]
) RETURNS text[]
LANGUAGE sql STABLE AS $$
    SELECT coalesce(array_agg(u.status ORDER BY u.nr), '{}')
      FROM unnest(p_bereiche, p_status) WITH ORDINALITY AS u(bereich, status, nr)
     WHERE EXISTS (SELECT 1 FROM ampel.regel r
                    WHERE r.regelwerk_key = coalesce(p_regelwerk,
                                                     (SELECT w.regelwerk_key FROM ampel.regelwerk w
                                                       WHERE w.ist_standard LIMIT 1))
                      AND r.bereich = u.bereich
                      AND r.im_gesamturteil);
$$;

COMMENT ON FUNCTION ampel.signale IS
'Aus einer Liste von Bereichen und ihren Ampeln die, die im Gesamturteil zaehlen: der
Bereich muss im Regelwerk stehen UND im_gesamturteil tragen. NULL-Ampeln bleiben
drin — sie sind ein fehlendes Signal und machen das Urteil unvollstaendig (0080).
Ein Bereich, den das Regelwerk gar nicht kennt, faellt heraus (so verlaesst OM das
Urteil, ohne dass jede Sicht davon wissen muss). Seit 0129.';


-- ---------------------------------------------------------------------
-- 5. Das Regelwerk
-- ---------------------------------------------------------------------

DO $$
DECLARE
    v_fehlend text;
BEGIN
    SELECT string_agg(n, ', ') INTO v_fehlend
      FROM unnest(ARRAY['Wilma Wunder','Aposto','Enchilada','Deutsche Konzepte','Lehners']) n
     WHERE NOT EXISTS (SELECT 1 FROM core.konzept k WHERE k.name = n);
    IF v_fehlend IS NOT NULL THEN
        RAISE EXCEPTION 'Konzept nicht gefunden: %. Soll und Sperren in 0129 haengen am Namen.',
                        v_fehlend;
    END IF;
END $$;

INSERT INTO ampel.regelwerk (regelwerk_key, name, beschreibung, ist_standard) VALUES
 ('management', 'Management (Daniel, 29.09.2026)',
  'Misst Personal und Wareneinsatz als Abweichung von Budget, Soll und Vorjahr statt als '
  'feste Quote. Gesamturteil nur aus den Zahlen: Umsatz, Personal (o. GF und je Bereich), '
  'Wareneinsatz, Bewertung. Rendite und Bounti stehen daneben, OM entfaellt.', false);

INSERT INTO ampel.regel
    (regelwerk_key, bereich, richtung, schwellenquelle, schwelle_gruen, schwelle_orange,
     bezug, gruen_ausschliesslich, im_gesamturteil, hinweis) VALUES
 ('management','umsatz',     'hoeher_ist_besser',   'fest',  2.00, -2.00, 'wert',       true,  true,
  'Veraenderung zum Vorjahr in %. Gruen ueber +2 %, gelb von -2 % bis +2 %.'),
 ('management','personal',   'niedriger_ist_besser','fest',  0.00,  1.00, 'abweichung', false, true,
  'Personalkosten o. GF: Pkt. ueber Budget. Budget = Plan-BWA, sonst das Soll aus ampel.soll.'),
 ('management','pk_service', 'niedriger_ist_besser','fest',  0.00,  1.00, 'abweichung', false, true,
  'Personalkosten Service: Pkt. ueber Vorjahr. Quote aus der Kasse (LINA), nicht aus der BWA.'),
 ('management','pk_kueche',  'niedriger_ist_besser','fest',  0.00,  1.00, 'abweichung', false, true,
  'Personalkosten Kueche: Pkt. ueber Vorjahr. Nenner ist der Speisenumsatz.'),
 ('management','pk_bar',     'niedriger_ist_besser','fest',  0.00,  1.00, 'abweichung', false, true,
  'Personalkosten Bar: Pkt. ueber Vorjahr. Nenner ist der Getraenkeumsatz.'),
 ('management','we_kueche',  'niedriger_ist_besser','fest',  0.50,  1.00, 'abweichung', false, true,
  'Wareneinsatz Kueche: Pkt. ueber Soll der Marke (ampel.soll).'),
 ('management','we_bar',     'niedriger_ist_besser','fest',  0.50,  1.00, 'abweichung', false, true,
  'Wareneinsatz Getraenke: Pkt. ueber Soll der Marke (ampel.soll).'),
 ('management','bewertung',  'hoeher_ist_besser',   'fest',  4.30,  4.00, 'wert',       false, true,
  'Online-Bewertung 1-5.'),
 ('management','rendite',    'hoeher_ist_besser',   'fest', 10.00,  5.00, 'wert',       true,  false,
  'EBIT / Umsatz laut BWA, Januar bis BWA-Monat (YTD). Steht neben dem Gesamturteil.'),
 ('management','bounti_abschluss', 'hoeher_ist_besser','fest', 90.00, 75.00, 'wert',    true,  false,
  'Anteil abgeschlossener Schulungszuweisungen, Stand heute. Steht neben dem Gesamturteil.'),
 ('management','bounti_teilnahme', 'hoeher_ist_besser','fest', 95.00, 85.00, 'wert',    true,  false,
  'Anteil der aktiven Mitarbeitenden mit mindestens einer abgeschlossenen Schulung, Stand heute. '
  'Bounti kennt keinen Zustand "begonnen" — nur zugewiesen und abgeschlossen.');

-- Die Brauereibindung aus 0107 gilt weiter: kein Urteil ueber den
-- Getraenkeeinsatz der Deutschen Konzepte.
INSERT INTO ampel.regel_konzept
    (regelwerk_key, bereich, konzept_key, schwelle_gruen, schwelle_orange, ohne_urteil, hinweis)
SELECT 'management', rk.bereich, rk.konzept_key, NULL, NULL, true, rk.hinweis
  FROM ampel.regel_konzept rk
 WHERE rk.regelwerk_key = 'round_table_global'
   AND rk.ohne_urteil;

-- Das Soll: die Gruenschwellen aus 0107, jetzt als das, was sie fachlich
-- waren. Beim Personal das Budget, bis die Plan-BWA gepflegt ist.
INSERT INTO ampel.soll (bereich, konzept_key, soll, hinweis)
SELECT v.bereich, k.konzept_key, v.soll, v.hinweis
  FROM (VALUES
    ('personal',  NULL,               34.00::numeric,
     'Budget, solange keine Plan-BWA gepflegt ist (fuer 2026 bei keinem Betrieb, Stand 29.09.2026). Entscheidung Daniel.'),
    ('we_bar',    NULL,               17.00,
     'Rueckfall fuer Marken ohne eigenes Soll — der Wilma-Wunder-Satz, wie in 0107.'),
    ('we_bar',    'Wilma Wunder',     17.00, 'Vorgabe Eugene, 20.09.2026 (0107)'),
    ('we_bar',    'Aposto',           19.00, 'Vorgabe Eugene, 20.09.2026 (0107)'),
    ('we_bar',    'Enchilada',        22.00, 'Vorgabe Eugene, 20.09.2026 (0107)'),
    ('we_bar',    'Deutsche Konzepte', NULL,
     'Kein Soll: die Brauereibindungen machen den Getraenkeeinsatz dieser Betriebe untereinander unvergleichbar (0107).'),
    ('we_bar',    'Lehners',           NULL,
     'Wie Deutsche Konzepte: Brauereibindung (0107).'),
    ('we_kueche', NULL,               25.00,
     'Rueckfall fuer Marken ohne eigenes Soll — der Wilma-Wunder-Satz, wie in 0107.'),
    ('we_kueche', 'Wilma Wunder',     25.00, 'Vorgabe Eugene, 20.09.2026 (0107)'),
    ('we_kueche', 'Aposto',           23.00, 'Vorgabe Eugene, 20.09.2026 (0107)'),
    ('we_kueche', 'Enchilada',        24.00, 'Vorgabe Eugene, 20.09.2026 (0107)'),
    ('we_kueche', 'Deutsche Konzepte',25.00, 'Vorgabe Eugene, 20.09.2026 (0107)'),
    ('we_kueche', 'Lehners',          25.00, 'Wie Deutsche Konzepte (0107)')
  ) AS v(bereich, konzept, soll, hinweis)
  LEFT JOIN core.konzept k ON k.name = v.konzept
 WHERE v.konzept IS NULL OR k.konzept_key IS NOT NULL;

-- Umschalten. Zwei Anweisungen, weil der Teilindex regelwerk_ein_standard
-- zeilenweise prueft und ein einziges UPDATE kurz zwei Standards haben kann.
UPDATE ampel.regelwerk SET ist_standard = false WHERE ist_standard;
UPDATE ampel.regelwerk SET ist_standard = true  WHERE regelwerk_key = 'management';


-- ---------------------------------------------------------------------
-- 6. Personal je Bereich und Monat — aus der Kasse, im MONATSABRUF
--
-- LINA liefert die Personalkostenquoten je Bereich (Service, Kueche, Bar)
-- nur in getPersonalkosten, und bisher holten wir den Bericht nur je TAG.
-- Dort sind pek_* keine Quoten: der Zaehler laeuft seit Monatsanfang auf,
-- der Nenner ist der Tag (docs/fehlerkatalog.md). Zurueckgerechnet streuen
-- sie rund 15 % gegen die BWA — bei 35 % Personalquote gut fuenf Punkte,
-- fuer eine Ampel mit einem Punkt Toleranz also Zufall. Versucht und
-- verworfen am 29.09.2026: weder "kumuliert / Tagesumsatz" (nur 61-66 %
-- der Folgetage steigen) noch "Quote x Monatstag" (Verhaeltnis zur BWA
-- streut von 0,31 bis 1,07) traegt.
--
-- Ueber einen ganzen MONAT abgerufen stimmen sie. Beleg ist der archivierte
-- Payload (docs/payloads/getPersonalkosten.json): mit den Nennern der
-- Effektivitaet ergeben sich plausible, untereinander gleiche Stundensaetze
-- (Betrieb 01: Service 18,81, Kueche 22,76, Bar 19,43 EUR/h; Betrieb 02:
-- 17,71 / 17,21 / 19,29), und pekGesamt liegt neben persoogBwa (38,10
-- gegen 38,27). Der Importer holt den Bericht deshalb seit 0129 zusaetzlich
-- im Monatsschritt (getPersonalkosten:monat) in diese eigene Tabelle — nicht
-- in core.personalkosten, wo jede Tagesauswertung die Monatszeile
-- mitzaehlen wuerde.
--
-- JEDER BEREICH HAT SEINEN EIGENEN NENNER, wie bei der Effektivitaet
-- (lina-api-korrekturen.md, Identitaet ueber 16.110 Betriebstage):
-- Service den Gesamtumsatz, Kueche den Speisenumsatz (Hauptsparte 10001),
-- Bar den Getraenkeumsatz (10002). Die drei Quoten addieren sich deshalb
-- nicht zur Gesamtquote.
-- ---------------------------------------------------------------------

CREATE TABLE core.personalkosten_monat (
    betrieb_key     integer NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat           date    NOT NULL CHECK (monat = date_trunc('month', monat)::date),
    zeitraum_bis    date    NOT NULL,
    eff_service     numeric(12,2),
    eff_bar         numeric(12,2),
    eff_kueche      numeric(12,2),
    eff_gesamt      numeric(12,2),
    pek_service     numeric(12,2),
    pek_bar         numeric(12,2),
    pek_kueche      numeric(12,2),
    pek_gesamt      numeric(12,2),
    persoog_bwa     numeric(12,2),
    raw_id          bigint,
    geladen_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat)
);

COMMENT ON TABLE core.personalkosten_monat IS
'getPersonalkosten ueber einen ganzen Kalendermonat (Registereintrag
getPersonalkosten:monat, seit 0129). NUR HIER sind pek_* Quoten in Prozent: Service
gegen den Gesamtumsatz, Kueche gegen den Speisenumsatz, Bar gegen den Getraenkeumsatz,
gesamt gegen den Gesamtumsatz. Im Tagesabruf (core.personalkosten) ist der Zaehler seit
Monatsanfang kumuliert und der Wert keine Quote.
Upsert: die drei zuletzt abgeschlossenen Monate werden jede Nacht neu geholt, weil die
Lohnabrechnung spaet abschliesst.';


CREATE MATERIALIZED VIEW mart.personal_bereich_monat AS
WITH umsatz AS (
    SELECT u.betrieb_key,
           date_trunc('month', u.geschaeftstag)::date                     AS monat,
           sum(u.umsatz_netto) FILTER (WHERE u.hauptsparte_key IS NULL)   AS gesamt,
           sum(u.umsatz_netto) FILTER (WHERE h.pos_id = 10001)            AS speisen,
           sum(u.umsatz_netto) FILTER (WHERE h.pos_id = 10002)            AS getraenke
      FROM core.umsatzbericht_tag u
      LEFT JOIN core.hauptsparte h ON h.hauptsparte_key = u.hauptsparte_key
     WHERE u.verkaufsstelle_key IS NULL
       AND (u.hauptsparte_key IS NULL OR h.pos_id IN (10001, 10002))
       AND u.geschaeftstag >= (SELECT min(monat) FROM core.personalkosten_monat)
     GROUP BY u.betrieb_key, date_trunc('month', u.geschaeftstag)::date
)
SELECT p.betrieb_key,
       p.monat,
       round(u.gesamt, 2)    AS umsatz_gesamt,
       round(u.speisen, 2)   AS umsatz_speisen,
       round(u.getraenke, 2) AS umsatz_getraenke,
       -- LINA liefert fuer Betriebe ohne Zeiterfassung 0,00 statt NULL.
       -- Eine Personalquote von null ist kein guter Monat, sondern keiner.
       nullif(p.pek_gesamt, 0)  AS pk_gesamt_pct,
       nullif(p.pek_service, 0) AS pk_service_pct,
       nullif(p.pek_kueche, 0)  AS pk_kueche_pct,
       nullif(p.pek_bar, 0)     AS pk_bar_pct,
       round(nullif(p.pek_gesamt, 0)  * u.gesamt    / 100, 2) AS pk_gesamt_eur,
       round(nullif(p.pek_service, 0) * u.gesamt    / 100, 2) AS pk_service_eur,
       round(nullif(p.pek_kueche, 0)  * u.speisen   / 100, 2) AS pk_kueche_eur,
       round(nullif(p.pek_bar, 0)     * u.getraenke / 100, 2) AS pk_bar_eur,
       nullif(p.eff_gesamt, 0)  AS eff_gesamt,
       nullif(p.eff_service, 0) AS eff_service,
       nullif(p.eff_kueche, 0)  AS eff_kueche,
       nullif(p.eff_bar, 0)     AS eff_bar,
       round(u.gesamt    / nullif(p.eff_gesamt, 0), 1)  AS stunden_gesamt,
       round(u.gesamt    / nullif(p.eff_service, 0), 1) AS stunden_service,
       round(u.speisen   / nullif(p.eff_kueche, 0), 1)  AS stunden_kueche,
       round(u.getraenke / nullif(p.eff_bar, 0), 1)     AS stunden_bar,
       nullif(p.persoog_bwa, 0) AS persoog_bwa,
       p.zeitraum_bis,
       p.geladen_am
  FROM core.personalkosten_monat p
  LEFT JOIN umsatz u ON u.betrieb_key = p.betrieb_key AND u.monat = p.monat;

CREATE UNIQUE INDEX personal_bereich_monat_eindeutig
    ON mart.personal_bereich_monat (betrieb_key, monat);

COMMENT ON MATERIALIZED VIEW mart.personal_bereich_monat IS
'Koernung: Betrieb und Monat. Personalkosten und Effektivitaet je Bereich (Service,
Kueche, Bar) aus der KASSE (LINA, getPersonalkosten im Monatsabruf) — als Quote, in Euro
und in Stunden.

JEDER BEREICH HAT SEINEN EIGENEN NENNER, wie in LINA: Service den Gesamtumsatz, Kueche
den Speisenumsatz, Bar den Getraenkeumsatz. Die drei Quoten addieren sich deshalb NICHT
zur Gesamtquote. Euro = Quote x eigener Nenner; auch die drei Euro-Betraege ergeben nicht
pk_gesamt_eur (Personal ausserhalb der drei Bereiche).
eff_* ist Umsatz je Personalstunde im Bereich, stunden_* daraus zurueckgerechnet.

Das ist NICHT die BWA. Die Round-Table-Ampel "Personal o. GF" haengt weiter an der BWA
(persoog_bwa steht zum Vergleich daneben).
Leer, solange der Monatsabruf noch nicht gelaufen ist — der erste Nachtlauf nach 0129
holt 25 Monate. Aufgefrischt im Round-Table-Nachlauf VOR mart.round_table_monat.';


-- ---------------------------------------------------------------------
-- 7. Rendite je Betrieb und Monat, mit YTD
-- ---------------------------------------------------------------------

CREATE VIEW mart.rendite_monat AS
WITH monat AS (
    SELECT betrieb_key,
           monat,
           max(wert_absolut) FILTER (WHERE kennzahl = 'Umsatz') AS umsatz_bwa,
           max(wert_absolut) FILTER (WHERE kennzahl = 'EBIT')   AS ebit
      FROM mart.kennzahlen_aktuell
     WHERE kennzahl IN ('Umsatz', 'EBIT')
     GROUP BY betrieb_key, monat
    -- getKennzahlen fuehrt auch ungebuchte Monate, mit 0 statt NULL — ein
    -- Monat ohne Umsatz ist keiner, und in der YTD waere er ein Loch mit
    -- Gewicht null, das niemand saehe.
    HAVING coalesce(max(wert_absolut) FILTER (WHERE kennzahl = 'Umsatz'), 0) <> 0
       AND max(wert_absolut) FILTER (WHERE kennzahl = 'EBIT') IS NOT NULL
)
SELECT m.betrieb_key,
       m.monat,
       m.umsatz_bwa,
       m.ebit,
       round(100 * m.ebit / nullif(m.umsatz_bwa, 0), 2) AS rendite_pct,
       sum(m.umsatz_bwa) OVER ytd                       AS umsatz_bwa_ytd,
       sum(m.ebit)       OVER ytd                       AS ebit_ytd,
       round(100 * sum(m.ebit) OVER ytd / nullif(sum(m.umsatz_bwa) OVER ytd, 0), 2) AS rendite_ytd_pct,
       count(*)          OVER ytd                       AS monate_ytd
  FROM monat m
WINDOW ytd AS (PARTITION BY m.betrieb_key, date_trunc('year', m.monat)
               ORDER BY m.monat ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW);

COMMENT ON VIEW mart.rendite_monat IS
'Koernung: Betrieb und BWA-Monat. Rendite = EBIT / Umsatz laut BWA (getKennzahlen), fuer
den Monat und kumuliert ab Januar (YTD).
Aus getKennzahlen und nicht aus der BWA-Langzeitreihe der Ladenakte, weil der Round Table
seinen BWA-Monat aus derselben Quelle nimmt. Gegenprobe am 29.09.2026 (Januar bis Juli
2026, 434 Betriebsmonate): Umsatz in 413 identisch, EBIT im Median 8 EUR auseinander.
Nur gebuchte Monate: ein Monat ohne Umsatz fehlt, statt mit 0 in die YTD zu laufen.
monate_ytd sagt, wie viele Monate in der YTD stecken.
Ein Einzelmonat schwankt mit jeder Einmalbuchung; die Ampel steht deshalb auf der YTD
(Entscheidung Daniel 29.09.2026). Prozentzahlen, nie Brueche.';


-- ---------------------------------------------------------------------
-- 8. mart.round_table_basis: Bezugsgroessen und Abweichungen
--
-- Die bisherigen Spalten unveraendert (CREATE OR REPLACE kann nur
-- anhaengen), dahinter alles, was das neue Regelwerk braucht.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.round_table_basis AS
WITH bwa AS (
         SELECT kennzahlen_aktuell.betrieb_key,
            kennzahlen_aktuell.monat,
                CASE
                    WHEN abs(max(kennzahlen_aktuell.wert_prozent) FILTER (WHERE kennzahlen_aktuell.kennzahl = 'Personalkosten ohne GF'::text)) <= 150::numeric THEN max(kennzahlen_aktuell.wert_prozent) FILTER (WHERE kennzahlen_aktuell.kennzahl = 'Personalkosten ohne GF'::text)
                    ELSE NULL::numeric
                END AS personalkosten_ogf_pct,
                CASE
                    WHEN abs(max(kennzahlen_aktuell.wert_prozent) FILTER (WHERE kennzahlen_aktuell.kennzahl = 'WE Bar'::text)) <= 150::numeric THEN max(kennzahlen_aktuell.wert_prozent) FILTER (WHERE kennzahlen_aktuell.kennzahl = 'WE Bar'::text)
                    ELSE NULL::numeric
                END AS we_bar_pct,
                CASE
                    WHEN abs(max(kennzahlen_aktuell.wert_prozent) FILTER (WHERE kennzahlen_aktuell.kennzahl = 'WE Küche'::text)) <= 150::numeric THEN max(kennzahlen_aktuell.wert_prozent) FILTER (WHERE kennzahlen_aktuell.kennzahl = 'WE Küche'::text)
                    ELSE NULL::numeric
                END AS we_kueche_pct
           FROM mart.kennzahlen_aktuell
          GROUP BY kennzahlen_aktuell.betrieb_key, kennzahlen_aktuell.monat
         HAVING count(*) FILTER (WHERE kennzahlen_aktuell.wert_absolut IS NOT NULL AND kennzahlen_aktuell.wert_absolut <> 0::numeric) > 0
        ), monate AS (
         SELECT DISTINCT date_trunc('month'::text, umsatzbericht_tag.geschaeftstag::timestamp with time zone)::date AS monat
           FROM core.umsatzbericht_tag
        UNION
         SELECT DISTINCT bwa.monat
           FROM bwa
        ), umsatz AS (
         SELECT umsatzbericht_tag.betrieb_key,
            date_trunc('month'::text, umsatzbericht_tag.geschaeftstag::timestamp with time zone)::date AS monat,
            sum(umsatzbericht_tag.umsatz_netto) AS umsatz
           FROM core.umsatzbericht_tag
          WHERE umsatzbericht_tag.hauptsparte_key IS NULL AND umsatzbericht_tag.verkaufsstelle_key IS NULL
          GROUP BY umsatzbericht_tag.betrieb_key, (date_trunc('month'::text, umsatzbericht_tag.geschaeftstag::timestamp with time zone)::date)
        ), plan AS (
         -- Die Planquote mit demselben Nenner wie LINAs Ist-Quote (0129, Kopf).
         SELECT bp.betrieb_key,
            bp.monat,
            round(100 * sum(bp.betrag) FILTER (WHERE bp.zeile = 'Personalkosten o.G.')
                  / nullif(sum(bp.betrag) FILTER (WHERE bp.zeile IN ('Erlöse Speisen', 'Erlöse Getränke', 'sonstige Erlöse')), 0), 2) AS personal_plan_pct
           FROM core.bwa_plan bp
          WHERE bp.zeile IN ('Personalkosten o.G.', 'Erlöse Speisen', 'Erlöse Getränke', 'sonstige Erlöse')
          GROUP BY bp.betrieb_key, bp.monat
        ), soll AS (
         SELECT s.betrieb_key,
            max(s.soll) FILTER (WHERE s.bereich = 'personal')  AS personal,
            max(s.soll) FILTER (WHERE s.bereich = 'we_bar')    AS we_bar,
            max(s.soll) FILTER (WHERE s.bereich = 'we_kueche') AS we_kueche
           FROM ampel.soll_je_betrieb s
          GROUP BY s.betrieb_key
        ), grund AS (
 SELECT b.betrieb_key,
    b.name AS betrieb,
    COALESCE(b.stadt, stx.ort) AS stadt,
    kz.hauptkonzept AS konzept,
    m.monat,
    k.bwa_monat,
    u.umsatz AS umsatz_ist,
    v.umsatz AS umsatz_vj,
        CASE
            WHEN m.monat >= date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date THEN NULL::numeric
            WHEN v.umsatz > 0::numeric THEN mart.prozent_plausibel(round((u.umsatz - v.umsatz) / v.umsatz * 100::numeric, 2))
            ELSE NULL::numeric
        END AS umsatz_pct,
    k.personalkosten_ogf_pct,
    k.we_bar_pct,
    k.we_kueche_pct,
    ob.bewertung AS online_bewertung,
    om.om_score,
    bs.status,
    COALESCE(u.umsatz, 0::numeric) > 0::numeric AND (bs.status <> ALL (ARRAY['test'::text, 'verwaltend'::text])) AS operativ,
    -- ab hier 0129
    COALESCE(pl.personal_plan_pct, so.personal) AS personal_budget_pct,
        CASE
            WHEN pl.personal_plan_pct IS NOT NULL THEN 'Plan-BWA'::text
            WHEN so.personal IS NOT NULL THEN 'Soll'::text
            ELSE NULL::text
        END AS personal_budget_quelle,
    so.we_bar    AS we_bar_soll_pct,
    so.we_kueche AS we_kueche_soll_pct,
    -- Personal je Bereich wie der Umsatz: kein Urteil ueber den laufenden
    -- Monat (ein halber Monat gegen den vollen Vorjahresmonat), und eine
    -- Quote ueber 150 % ist ein Monat ohne Geschaeft, keine Kennzahl.
        CASE WHEN m.monat < date_trunc('month', CURRENT_DATE)::date AND pm.pk_service_pct <= 150 THEN pm.pk_service_pct END AS pk_service_pct,
        CASE WHEN m.monat < date_trunc('month', CURRENT_DATE)::date AND pv.pk_service_pct <= 150 THEN pv.pk_service_pct END AS pk_service_vj_pct,
        CASE WHEN m.monat < date_trunc('month', CURRENT_DATE)::date AND pm.pk_kueche_pct  <= 150 THEN pm.pk_kueche_pct  END AS pk_kueche_pct,
        CASE WHEN m.monat < date_trunc('month', CURRENT_DATE)::date AND pv.pk_kueche_pct  <= 150 THEN pv.pk_kueche_pct  END AS pk_kueche_vj_pct,
        CASE WHEN m.monat < date_trunc('month', CURRENT_DATE)::date AND pm.pk_bar_pct     <= 150 THEN pm.pk_bar_pct     END AS pk_bar_pct,
        CASE WHEN m.monat < date_trunc('month', CURRENT_DATE)::date AND pv.pk_bar_pct     <= 150 THEN pv.pk_bar_pct     END AS pk_bar_vj_pct,
    rm.rendite_pct     AS rendite_monat_pct,
    rm.rendite_ytd_pct
   FROM core.betrieb b
     CROSS JOIN monate m
     LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = b.betrieb_key
     LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = b.betrieb_key
     LEFT JOIN manual.betrieb_standort stx ON stx.betrieb_key = b.betrieb_key
     LEFT JOIN umsatz u ON u.betrieb_key = b.betrieb_key AND u.monat = m.monat
     LEFT JOIN umsatz v ON v.betrieb_key = b.betrieb_key AND v.monat = (m.monat - '1 year'::interval)::date
     LEFT JOIN LATERAL ( SELECT w.monat AS bwa_monat,
            w.personalkosten_ogf_pct,
            w.we_bar_pct,
            w.we_kueche_pct
           FROM bwa w
          WHERE w.betrieb_key = b.betrieb_key AND w.monat <= m.monat AND w.monat >= (m.monat - '3 mons'::interval)::date
          ORDER BY w.monat DESC
         LIMIT 1) k ON true
     LEFT JOIN LATERAL ( SELECT o.bewertung
           FROM manual.online_bewertung o
          WHERE o.betrieb_key = b.betrieb_key AND o.monat = m.monat
          ORDER BY (o.quelle = 'yext'::text) DESC, o.anzahl DESC NULLS LAST
         LIMIT 1) ob ON true
     LEFT JOIN manual.om_einschaetzung om ON om.betrieb_key = b.betrieb_key AND om.monat = m.monat
     LEFT JOIN plan pl ON pl.betrieb_key = b.betrieb_key AND pl.monat = k.bwa_monat
     LEFT JOIN soll so ON so.betrieb_key = b.betrieb_key
     LEFT JOIN mart.personal_bereich_monat pm ON pm.betrieb_key = b.betrieb_key AND pm.monat = m.monat
     LEFT JOIN mart.personal_bereich_monat pv ON pv.betrieb_key = b.betrieb_key AND pv.monat = (m.monat - '1 year'::interval)::date
     LEFT JOIN mart.rendite_monat rm ON rm.betrieb_key = b.betrieb_key AND rm.monat = k.bwa_monat
  WHERE b.aktiv
)
SELECT betrieb_key, betrieb, stadt, konzept, monat, bwa_monat,
       umsatz_ist, umsatz_vj, umsatz_pct,
       personalkosten_ogf_pct, we_bar_pct, we_kueche_pct,
       online_bewertung, om_score, status, operativ,
       personal_budget_pct,
       personal_budget_quelle,
       round(personalkosten_ogf_pct - personal_budget_pct, 2) AS personal_abw_pp,
       we_bar_soll_pct,
       round(we_bar_pct - we_bar_soll_pct, 2)                 AS we_bar_abw_pp,
       we_kueche_soll_pct,
       round(we_kueche_pct - we_kueche_soll_pct, 2)           AS we_kueche_abw_pp,
       pk_service_pct, pk_service_vj_pct,
       round(pk_service_pct - pk_service_vj_pct, 2)           AS pk_service_abw_pp,
       pk_kueche_pct, pk_kueche_vj_pct,
       round(pk_kueche_pct - pk_kueche_vj_pct, 2)             AS pk_kueche_abw_pp,
       pk_bar_pct, pk_bar_vj_pct,
       round(pk_bar_pct - pk_bar_vj_pct, 2)                   AS pk_bar_abw_pp,
       rendite_monat_pct,
       rendite_ytd_pct
  FROM grund;

COMMENT ON VIEW mart.round_table_basis IS
'Koernung: aktiver Betrieb und Monat, ohne Ampelbewertung — alle Zahlen, die der Round
Table beurteilt, mit ihrem Bezug.
Seit 0129 zusaetzlich die Bezugsgroessen des Management-Regelwerks: Budget (Plan-BWA,
sonst Soll) und Abweichung beim Personal o. GF, Soll und Abweichung beim Wareneinsatz,
Personal je Bereich gegen den Vorjahresmonat (aus der Kasse, mart.personal_bereich_monat)
und die Rendite des BWA-Monats und YTD (mart.rendite_monat).
*_abw_pp sind Prozentpunkte; positiv heisst beim Personal und Wareneinsatz: teurer als
Bezug. Personal, Wareneinsatz und Rendite stehen auf dem BWA-Monat (bwa_monat), Umsatz und
Personal je Bereich auf dem Berichtsmonat.';


-- ---------------------------------------------------------------------
-- 9. mart.round_table_monat neu — und was an ihr haengt
--
-- Eine materialisierte Sicht laesst sich nicht ersetzen, nur neu anlegen.
-- An ihr haengen neun Sichten (nachgemessen am 29.09.2026): ampel_bereich,
-- konzept_schnitt_monat, standort, round_table_gesamt_wechsel,
-- stadt_schnitt_monat und darueber round_table_trend, ursachen_analyse,
-- marke_vergleich, stadt_vergleich.
--
-- Sie werden NICHT aus einer Abschrift in dieser Datei neu angelegt,
-- sondern aus ihrer Definition IN DER ZIELDATENBANK, unmittelbar vor dem
-- DROP gelesen. Grund: die Migrationsdateien geben den Stand einer Bank
-- nicht zuverlaessig wieder (docs/offene-punkte.md, "Migrationen nicht
-- abspielbar") — eine Abschrift von hier koennte in Produktion eine
-- spaetere Aenderung still zurueckdrehen. Mitgenommen werden Kommentare
-- (auch je Spalte), Rechte und Indizes. Nur ampel_bereich wird bewusst
-- neu definiert (neue Bereiche, OM raus) und deshalb nicht uebernommen.
-- ---------------------------------------------------------------------

CREATE TEMP TABLE _rt_abh ON COMMIT DROP AS
WITH RECURSIVE dep AS (
    SELECT DISTINCT r.ev_class AS oid, 1 AS tiefe
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
     WHERE d.refobjid = 'mart.round_table_monat'::regclass
       AND r.ev_class <> 'mart.round_table_monat'::regclass
    UNION
    SELECT DISTINCT r.ev_class, dep.tiefe + 1
      FROM dep
      JOIN pg_depend d  ON d.refobjid = dep.oid
      JOIN pg_rewrite r ON r.oid = d.objid
     WHERE r.ev_class <> dep.oid
       AND dep.tiefe < 10
)
SELECT c.oid,
       c.relkind,
       n.nspname,
       c.relname,
       min(dep.tiefe) AS tiefe,
       pg_get_viewdef(c.oid) AS definition,
       obj_description(c.oid, 'pg_class') AS kommentar
  FROM dep
  JOIN pg_class c     ON c.oid = dep.oid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 GROUP BY c.oid, c.relkind, n.nspname, c.relname;

-- Dieselben Nebenangaben auch fuer round_table_monat selbst.
CREATE TEMP TABLE _rt_objekt ON COMMIT DROP AS
SELECT oid, relkind, nspname, relname FROM _rt_abh
UNION ALL
SELECT c.oid, c.relkind, n.nspname, c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.oid = 'mart.round_table_monat'::regclass;

CREATE TEMP TABLE _rt_spaltenkommentar ON COMMIT DROP AS
SELECT o.nspname, o.relname, a.attname, d.description
  FROM _rt_objekt o
  JOIN pg_description d ON d.objoid = o.oid AND d.classoid = 'pg_class'::regclass AND d.objsubid > 0
  JOIN pg_attribute a   ON a.attrelid = o.oid AND a.attnum = d.objsubid;

CREATE TEMP TABLE _rt_recht ON COMMIT DROP AS
SELECT o.nspname, o.relname, x.privilege_type, x.grantee
  FROM _rt_objekt o
  JOIN pg_class c ON c.oid = o.oid
 CROSS JOIN LATERAL aclexplode(c.relacl) x
 WHERE x.grantee <> c.relowner;

CREATE TEMP TABLE _rt_index ON COMMIT DROP AS
SELECT i.schemaname, i.tablename, i.indexdef
  FROM pg_indexes i
  JOIN _rt_abh a ON a.nspname = i.schemaname AND a.relname = i.tablename;

DO $$
DECLARE
    v_erwartet text[] := ARRAY['ampel_bereich','konzept_schnitt_monat','standort',
                               'round_table_gesamt_wechsel','stadt_schnitt_monat',
                               'round_table_trend','ursachen_analyse','marke_vergleich',
                               'stadt_vergleich'];
    v_fremd text;
BEGIN
    -- Haengt etwas daran, das hier niemand kennt, soll die Migration
    -- scheitern und nicht still eine fremde Sicht aus einer Abschrift
    -- zurueckholen, deren Bedeutung sich mit dieser Datei aendert.
    SELECT string_agg(nspname || '.' || relname, ', ') INTO v_fremd
      FROM _rt_abh
     WHERE nspname <> 'mart' OR NOT relname = ANY (v_erwartet);
    IF v_fremd IS NOT NULL THEN
        RAISE EXCEPTION 'Unerwartete Abhaengigkeit von mart.round_table_monat: %. '
                        '0129 kennt nur die neun Sichten aus dem Kopf von Abschnitt 9.', v_fremd;
    END IF;
END $$;

DROP MATERIALIZED VIEW mart.round_table_monat CASCADE;

CREATE MATERIALIZED VIEW mart.round_table_monat AS
WITH bewertet AS (
    SELECT r.*,
           ampel.urteil('umsatz',     r.umsatz_pct,             NULL,                NULL, r.betrieb_key, r.bwa_monat) AS ampel_umsatz,
           ampel.urteil('personal',   r.personalkosten_ogf_pct, r.personal_abw_pp,   NULL, r.betrieb_key, r.bwa_monat) AS ampel_personal,
           ampel.urteil('we_bar',     r.we_bar_pct,             r.we_bar_abw_pp,     NULL, r.betrieb_key, r.bwa_monat) AS ampel_we_bar,
           ampel.urteil('we_kueche',  r.we_kueche_pct,          r.we_kueche_abw_pp,  NULL, r.betrieb_key, r.bwa_monat) AS ampel_we_kueche,
           ampel.urteil('bewertung',  r.online_bewertung,       NULL,                NULL, r.betrieb_key, r.bwa_monat) AS ampel_bewertung,
           ampel.urteil('om',         r.om_score::numeric,      NULL,                NULL, r.betrieb_key, r.bwa_monat) AS ampel_om,
           ampel.urteil('pk_service', r.pk_service_pct,         r.pk_service_abw_pp, NULL, r.betrieb_key, r.monat)     AS ampel_pk_service,
           ampel.urteil('pk_kueche',  r.pk_kueche_pct,          r.pk_kueche_abw_pp,  NULL, r.betrieb_key, r.monat)     AS ampel_pk_kueche,
           ampel.urteil('pk_bar',     r.pk_bar_pct,             r.pk_bar_abw_pp,     NULL, r.betrieb_key, r.monat)     AS ampel_pk_bar,
           ampel.urteil('rendite',    r.rendite_ytd_pct,        NULL,                NULL, r.betrieb_key, r.bwa_monat) AS ampel_rendite
      FROM mart.round_table_basis r
), signale AS (
    SELECT b.*,
           -- Welche Ampeln zaehlen, entscheidet das Regelwerk (im_gesamturteil),
           -- nicht diese Liste: sie nennt nur alle, die es geben kann.
           ampel.signale(NULL,
               ARRAY['umsatz','personal','we_bar','we_kueche','bewertung','om',
                     'pk_service','pk_kueche','pk_bar','rendite'],
               ARRAY[b.ampel_umsatz, b.ampel_personal, b.ampel_we_bar, b.ampel_we_kueche,
                     b.ampel_bewertung, b.ampel_om, b.ampel_pk_service, b.ampel_pk_kueche,
                     b.ampel_pk_bar, b.ampel_rendite]) AS st
      FROM bewertet b
)
SELECT s.monat,
       s.betrieb,
       COALESCE(s.konzept, '(nicht zugeordnet)') AS konzept,
       s.stadt,
       s.bwa_monat,
       s.umsatz_ist,
       s.umsatz_vj,
       s.umsatz_pct,
       s.personalkosten_ogf_pct,
       s.we_bar_pct,
       s.we_kueche_pct,
       s.online_bewertung,
       s.om_score,
       s.ampel_umsatz,
       s.ampel_personal,
       s.ampel_we_bar,
       s.ampel_we_kueche,
       s.ampel_bewertung,
       s.ampel_om,
       ampel.gesamt(s.st)      AS gesamt,
       ampel.intensitaet(s.st) AS intensitaet,
       CASE WHEN ampel.gesamt(s.st) = 'rot' OR ampel.intensitaet(s.st) = 'Nachforschung'
            THEN 'Ja' ELSE 'Nein' END AS massnahme,
       CASE WHEN ampel.gesamt(s.st) = 'rot'                THEN 'Hoch'
            WHEN ampel.intensitaet(s.st) = 'Nachforschung' THEN 'Mittel'
            ELSE 'Niedrig' END AS prioritaet,
       s.betrieb_key,
       s.status,
       s.operativ,
       (EXTRACT(year FROM age(s.monat::timestamptz, s.bwa_monat::timestamptz)) * 12
        + EXTRACT(month FROM age(s.monat::timestamptz, s.bwa_monat::timestamptz)))::integer AS bwa_alter_monate,
       -- ab hier 0129
       s.personal_budget_pct,
       s.personal_budget_quelle,
       s.personal_abw_pp,
       s.we_bar_soll_pct,
       s.we_bar_abw_pp,
       s.we_kueche_soll_pct,
       s.we_kueche_abw_pp,
       s.pk_service_pct,
       s.pk_service_vj_pct,
       s.pk_service_abw_pp,
       s.ampel_pk_service,
       s.pk_kueche_pct,
       s.pk_kueche_vj_pct,
       s.pk_kueche_abw_pp,
       s.ampel_pk_kueche,
       s.pk_bar_pct,
       s.pk_bar_vj_pct,
       s.pk_bar_abw_pp,
       s.ampel_pk_bar,
       s.rendite_monat_pct,
       s.rendite_ytd_pct,
       s.ampel_rendite
  FROM signale s;

CREATE UNIQUE INDEX round_table_monat_betrieb_monat ON mart.round_table_monat (betrieb_key, monat);
CREATE INDEX round_table_monat_monat ON mart.round_table_monat (monat);

COMMENT ON MATERIALIZED VIEW mart.round_table_monat IS
'Koernung: Betrieb und Monat, fertig bewertet mit dem Standardregelwerk.

SEIT 0129 IST DAS DAS MANAGEMENT-REGELWERK: Personal und Wareneinsatz werden als
ABWEICHUNG bewertet (vom Budget, vom Soll der Marke, beim Personal je Bereich vom
Vorjahr), nicht als feste Quote. Die Werte stehen in *_pct, der Bezug in
*_budget_pct / *_soll_pct / *_vj_pct, die bewertete Abweichung in *_abw_pp.

gesamt und intensitaet zaehlen nur die Ampeln mit ampel.regel.im_gesamturteil: Umsatz,
Personal o. GF, Personal Service/Kueche/Bar, WE Bar, WE Kueche, Bewertung. ampel_rendite
steht daneben und faerbt den Betrieb nicht; ampel_om ist leer (OM entfaellt,
Entscheidung Daniel 29.09.2026). Eine fehlende Ampel macht das Urteil unvollstaendig
(0080) — auch eine fehlende Personalampel je Bereich.

Personal, Wareneinsatz und Rendite stehen auf dem BWA-Monat (bwa_monat), Umsatz und
Personal je Bereich auf dem Berichtsmonat.
Aufgefrischt im Round-Table-Nachlauf (src/sync/round_table.ts).';


-- Die neu definierte Sicht. Alles andere kommt aus _rt_abh zurueck.
CREATE VIEW mart.ampel_bereich AS
WITH ausgesetzt AS (
    SELECT kb.betrieb_key, rk.bereich, rk.hinweis
      FROM ampel.regel_konzept rk
      JOIN ampel.regelwerk w           ON w.regelwerk_key = rk.regelwerk_key AND w.ist_standard
      JOIN ampel.konzept_je_betrieb kb ON kb.konzept_key  = rk.konzept_key
     WHERE rk.ohne_urteil
),
regel AS (
    SELECT r.bereich, r.im_gesamturteil
      FROM ampel.regel r
      JOIN ampel.regelwerk w ON w.regelwerk_key = r.regelwerk_key AND w.ist_standard
),
lang AS (
    SELECT r.monat, r.betrieb_key, r.betrieb, r.stadt, r.konzept, r.bwa_monat,
           r.gesamt, r.intensitaet, r.prioritaet, r.massnahme,
           r.status, r.operativ,
           b.bereich, b.bereich_name, b.reihenfolge, b.wert, b.ampel,
           b.bezugswert, b.bezug_art, b.abweichung
      FROM mart.round_table_monat r
      CROSS JOIN LATERAL (
          VALUES ('umsatz'::text,     'Umsatz'::text,           1, r.umsatz_pct,             r.ampel_umsatz,
                  NULL::numeric,        'Vorjahr'::text, r.umsatz_pct),
                 ('personal'::text,   'Personal'::text,         2, r.personalkosten_ogf_pct, r.ampel_personal,
                  r.personal_budget_pct, 'Budget'::text,  r.personal_abw_pp),
                 ('pk_service'::text, 'Personal Service'::text, 3, r.pk_service_pct,         r.ampel_pk_service,
                  r.pk_service_vj_pct,  'Vorjahr'::text, r.pk_service_abw_pp),
                 ('pk_kueche'::text,  'Personal Küche'::text,   4, r.pk_kueche_pct,          r.ampel_pk_kueche,
                  r.pk_kueche_vj_pct,   'Vorjahr'::text, r.pk_kueche_abw_pp),
                 ('pk_bar'::text,     'Personal Bar'::text,     5, r.pk_bar_pct,             r.ampel_pk_bar,
                  r.pk_bar_vj_pct,      'Vorjahr'::text, r.pk_bar_abw_pp),
                 ('we_kueche'::text,  'WE Küche'::text,         6, r.we_kueche_pct,          r.ampel_we_kueche,
                  r.we_kueche_soll_pct, 'Soll'::text,    r.we_kueche_abw_pp),
                 ('we_bar'::text,     'WE Bar'::text,           7, r.we_bar_pct,             r.ampel_we_bar,
                  r.we_bar_soll_pct,    'Soll'::text,    r.we_bar_abw_pp),
                 ('bewertung'::text,  'Online-Bewertung'::text, 8, r.online_bewertung,       r.ampel_bewertung,
                  NULL::numeric,        NULL::text,      NULL::numeric),
                 ('rendite'::text,    'Rendite YTD'::text,      9, r.rendite_ytd_pct,        r.ampel_rendite,
                  NULL::numeric,        NULL::text,      NULL::numeric)
      ) AS b(bereich, bereich_name, reihenfolge, wert, ampel, bezugswert, bezug_art, abweichung)
)
SELECT l.monat, l.betrieb_key, l.betrieb, l.stadt, l.konzept, l.bwa_monat,
       l.bereich, l.bereich_name, l.reihenfolge,
       l.wert,
       l.ampel,
       be.emoji,
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
       CASE WHEN l.wert IS NOT NULL THEN aus.hinweis END AS ohne_schwelle_hinweis,
       -- ab hier 0129
       l.bezugswert,
       l.bezug_art,
       l.abweichung,
       coalesce(rg.im_gesamturteil, false) AS im_gesamturteil
  FROM lang l
  LEFT JOIN ampel.beschriftung be ON be.status = l.ampel
  LEFT JOIN ausgesetzt aus        ON aus.betrieb_key = l.betrieb_key
                                 AND aus.bereich     = l.bereich
  LEFT JOIN regel rg              ON rg.bereich = l.bereich
  LEFT JOIN manual.ursache u      ON u.betrieb_key = l.betrieb_key
                                 AND u.monat       = l.monat
                                 AND u.bereich     = l.bereich
  LEFT JOIN manual.ursache_katalog uk ON uk.ursache_code = u.ursache_code;

COMMENT ON VIEW mart.ampel_bereich IS
'Koernung: Betrieb, Monat und Bereich — die Ampeln des Round Table im Langformat, mit dem
zugrunde liegenden Wert, seinem Bezug und der erfassten Ursache.

SEIT 0129 neun Bereiche: Umsatz, Personal (o. GF, gegen Budget), Personal Service /
Kueche / Bar (gegen Vorjahr), WE Kueche und WE Bar (gegen Soll der Marke), Bewertung,
Rendite YTD. OM vor Ort entfaellt. wert ist die Kennzahl selbst (Quote, Sterne,
Prozent), bezugswert das Budget / Soll / Vorjahr, abweichung der Abstand in Pkt. —
beim Management-Regelwerk wird die Abweichung bewertet, nicht der Wert.
im_gesamturteil = false (Rendite): die Ampel faerbt den Betrieb nicht.

Fuer alles, was ueber Bereiche hinweg zaehlt oder gruppiert. Fuer die klassische
Round-Table-Tabelle bleibt mart.round_table_monat die richtige Sicht.
ACHTUNG: eine Summe ueber wert ist sinnlos, die Spalte mischt Prozente mit Schulnoten.
ampel IS NULL hat zwei Ursachen: keine Daten, oder ohne_schwelle = true (Grund in
ohne_schwelle_hinweis). In keinem der beiden Faelle heisst es "in Ordnung".';


-- Die uebrigen acht zurueck, in ihrer eigenen Definition. Reihenfolge
-- nach Tiefe, und wer an einer noch fehlenden Sicht haengt, kommt in der
-- naechsten Runde dran.
DO $$
DECLARE
    v_offen  integer;
    v_vorher integer := -1;
    v_runde  integer := 0;
    rec      record;
BEGIN
    CREATE TEMP TABLE _rt_offen ON COMMIT DROP AS
    SELECT * FROM _rt_abh WHERE relname <> 'ampel_bereich';

    LOOP
        SELECT count(*) INTO v_offen FROM _rt_offen;
        EXIT WHEN v_offen = 0;
        IF v_offen = v_vorher THEN
            RAISE EXCEPTION 'Nicht wiederherstellbar: %',
                (SELECT string_agg(nspname || '.' || relname, ', ') FROM _rt_offen);
        END IF;
        v_vorher := v_offen;
        v_runde  := v_runde + 1;

        FOR rec IN SELECT * FROM _rt_offen ORDER BY tiefe, relname LOOP
            BEGIN
                EXECUTE format('CREATE %s %I.%I AS %s',
                               CASE rec.relkind WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END,
                               rec.nspname, rec.relname,
                               rtrim(rtrim(rec.definition), ';'));
                DELETE FROM _rt_offen WHERE oid = rec.oid;
            EXCEPTION WHEN undefined_table OR undefined_column THEN
                -- in der naechsten Runde, wenn das, woran sie haengt, steht
                NULL;
            END;
        END LOOP;
    END LOOP;
END $$;

-- Kommentare, Spaltenkommentare, Rechte und Indizes zurueck.
DO $$
DECLARE
    rec record;
BEGIN
    FOR rec IN SELECT * FROM _rt_abh WHERE relname <> 'ampel_bereich' AND kommentar IS NOT NULL LOOP
        EXECUTE format('COMMENT ON %s %I.%I IS %L',
                       CASE rec.relkind WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END,
                       rec.nspname, rec.relname, rec.kommentar);
    END LOOP;

    FOR rec IN
        SELECT k.* FROM _rt_spaltenkommentar k
         WHERE EXISTS (SELECT 1 FROM pg_attribute a
                        WHERE a.attrelid = format('%I.%I', k.nspname, k.relname)::regclass
                          AND a.attname = k.attname AND NOT a.attisdropped)
    LOOP
        EXECUTE format('COMMENT ON COLUMN %I.%I.%I IS %L',
                       rec.nspname, rec.relname, rec.attname, rec.description);
    END LOOP;

    FOR rec IN SELECT * FROM _rt_recht LOOP
        EXECUTE format('GRANT %s ON %I.%I TO %s', rec.privilege_type, rec.nspname, rec.relname,
                       CASE WHEN rec.grantee = 0 THEN 'PUBLIC'
                            ELSE quote_ident(pg_get_userbyid(rec.grantee)) END);
    END LOOP;

    FOR rec IN SELECT * FROM _rt_index LOOP
        EXECUTE rec.indexdef;
    END LOOP;
END $$;


-- ---------------------------------------------------------------------
-- 10. Was fehlt fuer ein vollstaendiges Urteil
--
-- Dieselben Spalten wie in 0107 (CREATE OR REPLACE), fehlt_om bleibt
-- stehen und ist immer false — OM gehoert nicht mehr zum Urteil. Die
-- drei Personalbereiche kommen hinten dazu und zaehlen in
-- signale_fehlen mit.
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
           bool_or(bereich = 'umsatz')     AS umsatz,
           bool_or(bereich = 'personal')   AS personal,
           bool_or(bereich = 'we_bar')     AS we_bar,
           bool_or(bereich = 'we_kueche')  AS we_kueche,
           bool_or(bereich = 'bewertung')  AS bewertung,
           bool_or(bereich = 'pk_service') AS pk_service,
           bool_or(bereich = 'pk_kueche')  AS pk_kueche,
           bool_or(bereich = 'pk_bar')     AS pk_bar,
           string_agg(DISTINCT hinweis, ' | ') AS grund
      FROM ausgesetzt
     GROUP BY betrieb_key
),
-- Welche Bereiche das Standardregelwerk ueberhaupt urteilt. Ein Bereich,
-- den es nicht kennt (OM seit 0129), kann nicht fehlen.
gefragt AS (
    SELECT bool_or(r.bereich = 'umsatz')     AS umsatz,
           bool_or(r.bereich = 'personal')   AS personal,
           bool_or(r.bereich = 'we_bar')     AS we_bar,
           bool_or(r.bereich = 'we_kueche')  AS we_kueche,
           bool_or(r.bereich = 'bewertung')  AS bewertung,
           bool_or(r.bereich = 'om')         AS om,
           bool_or(r.bereich = 'pk_service') AS pk_service,
           bool_or(r.bereich = 'pk_kueche')  AS pk_kueche,
           bool_or(r.bereich = 'pk_bar')     AS pk_bar
      FROM ampel.regel r
      JOIN ampel.regelwerk w ON w.regelwerk_key = r.regelwerk_key AND w.ist_standard
     WHERE r.im_gesamturteil
),
markiert AS (
    SELECT r.monat, r.betrieb_key, r.betrieb, r.konzept, r.status, r.operativ,
           coalesce(g.umsatz, false)     AND r.umsatz_pct             IS NULL AS fehlt_umsatz,
           coalesce(g.personal, false)   AND r.personalkosten_ogf_pct IS NULL AS fehlt_personal,
           coalesce(g.we_bar, false)     AND r.we_bar_pct             IS NULL AS fehlt_we_bar,
           coalesce(g.we_kueche, false)  AND r.we_kueche_pct          IS NULL AS fehlt_we_kueche,
           coalesce(g.bewertung, false)  AND r.online_bewertung       IS NULL AS fehlt_bewertung,
           coalesce(g.om, false)         AND r.om_score               IS NULL AS fehlt_om,
           -- Bei den Personalbereichen fehlt die Ampel auch, wenn der
           -- Vorjahresmonat fehlt — ohne Bezug kein Urteil.
           coalesce(g.pk_service, false) AND r.pk_service_abw_pp      IS NULL AS fehlt_pk_service,
           coalesce(g.pk_kueche, false)  AND r.pk_kueche_abw_pp       IS NULL AS fehlt_pk_kueche,
           coalesce(g.pk_bar, false)     AND r.pk_bar_abw_pp          IS NULL AS fehlt_pk_bar,
           coalesce(a.umsatz,    false) AND r.umsatz_pct             IS NOT NULL AS ohne_schwelle_umsatz,
           coalesce(a.personal,  false) AND r.personalkosten_ogf_pct IS NOT NULL AS ohne_schwelle_personal,
           coalesce(a.we_bar,    false) AND r.we_bar_pct             IS NOT NULL AS ohne_schwelle_we_bar,
           coalesce(a.we_kueche, false) AND r.we_kueche_pct          IS NOT NULL AS ohne_schwelle_we_kueche,
           coalesce(a.bewertung, false) AND r.online_bewertung       IS NOT NULL AS ohne_schwelle_bewertung,
           false                                                              AS ohne_schwelle_om,
           coalesce(a.pk_service, false) AND r.pk_service_abw_pp     IS NOT NULL AS ohne_schwelle_pk_service,
           coalesce(a.pk_kueche,  false) AND r.pk_kueche_abw_pp      IS NOT NULL AS ohne_schwelle_pk_kueche,
           coalesce(a.pk_bar,     false) AND r.pk_bar_abw_pp         IS NOT NULL AS ohne_schwelle_pk_bar,
           a.grund
      FROM mart.round_table_basis r
      CROSS JOIN gefragt g
      LEFT JOIN je_betrieb a ON a.betrieb_key = r.betrieb_key
)
SELECT monat,
       betrieb_key,
       betrieb,
       konzept,
       status,
       operativ,
       fehlt_umsatz::int + fehlt_personal::int + fehlt_we_bar::int
     + fehlt_we_kueche::int + fehlt_bewertung::int + fehlt_om::int
     + fehlt_pk_service::int + fehlt_pk_kueche::int + fehlt_pk_bar::int AS signale_fehlen,
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
     + ohne_schwelle_pk_service::int + ohne_schwelle_pk_kueche::int
     + ohne_schwelle_pk_bar::int AS signale_ohne_schwelle,
       CASE WHEN ohne_schwelle_umsatz OR ohne_schwelle_personal OR ohne_schwelle_we_bar
              OR ohne_schwelle_we_kueche OR ohne_schwelle_bewertung
              OR ohne_schwelle_pk_service OR ohne_schwelle_pk_kueche OR ohne_schwelle_pk_bar
            THEN grund END AS grund_ohne_schwelle,
       -- ab hier 0129
       fehlt_pk_service,
       fehlt_pk_kueche,
       fehlt_pk_bar
  FROM markiert
 WHERE fehlt_umsatz OR fehlt_personal OR fehlt_we_bar
    OR fehlt_we_kueche OR fehlt_bewertung OR fehlt_om
    OR fehlt_pk_service OR fehlt_pk_kueche OR fehlt_pk_bar
    OR ohne_schwelle_umsatz OR ohne_schwelle_personal OR ohne_schwelle_we_bar
    OR ohne_schwelle_we_kueche OR ohne_schwelle_bewertung
    OR ohne_schwelle_pk_service OR ohne_schwelle_pk_kueche OR ohne_schwelle_pk_bar
 ORDER BY monat DESC, signale_fehlen DESC, betrieb;

COMMENT ON VIEW mart.round_table_unvollstaendig IS
'Koernung: Betrieb und Monat — warum ein Round-Table-Urteil nicht vollstaendig ist.

ZWEI VERSCHIEDENE URSACHEN, und sie stehen mit Absicht in getrennten Spalten:
  fehlt_*          die Zahl fehlt. Jemand muss etwas nachtragen.
  ohne_schwelle_*  die Zahl ist da, aber fuer diese Marke wird in diesem Bereich
                   bewusst nicht bewertet (ampel.regel_konzept.ohne_urteil).
                   Seit 0107 belegt: WE Bar bei den Deutschen Konzepten.

SEIT 0129 (Management-Regelwerk): fehlt_om ist immer false — OM gehoert nicht mehr zum
Urteil. Dazu fehlt_pk_service / fehlt_pk_kueche / fehlt_pk_bar: die Personalampel je
Bereich fehlt, wenn die Kasse fuer den Monat ODER fuer den Vorjahresmonat keine
Personalkosten fuehrt. Ein Betrieb ohne Zeiterfassung in LINA bleibt damit dauerhaft
unvollstaendig — das ist gewollt, nicht gruen.';


-- ---------------------------------------------------------------------
-- 11. mart.round_table(monat, regelwerk) — die Funktion fuer JEDES
--     Regelwerk
--
-- Neu angelegt, weil sich die Ergebnisspalten aendern (die Personal-
-- ampeln je Bereich und die Rendite kommen hinten dazu). Die alten
-- Regelwerke rechnen weiter wie bisher: sie kennen nur bezug = wert und
-- zaehlen OM mit.
-- ---------------------------------------------------------------------

DROP FUNCTION mart.round_table(date, text);

CREATE FUNCTION mart.round_table(p_monat date, p_regelwerk text DEFAULT NULL)
RETURNS TABLE(betrieb text, stadt text, bwa_monat date, umsatz_ist numeric, umsatz_vj numeric,
              umsatz_pct numeric, personalkosten_ogf_pct numeric, we_bar_pct numeric,
              we_kueche_pct numeric, online_bewertung numeric, om_score smallint,
              ampel_umsatz text, ampel_personal text, ampel_we_bar text, ampel_we_kueche text,
              ampel_bewertung text, ampel_om text, gesamt text, intensitaet text,
              massnahme text, prioritaet text, betrieb_key integer, konzept text,
              ampel_pk_service text, ampel_pk_kueche text, ampel_pk_bar text,
              ampel_rendite text, rendite_ytd_pct numeric)
LANGUAGE sql STABLE AS $$
WITH bewertet AS (
    SELECT r.*,
           ampel.urteil('umsatz',     r.umsatz_pct,             NULL,                p_regelwerk, r.betrieb_key, r.bwa_monat) AS a_umsatz,
           ampel.urteil('personal',   r.personalkosten_ogf_pct, r.personal_abw_pp,   p_regelwerk, r.betrieb_key, r.bwa_monat) AS a_personal,
           ampel.urteil('we_bar',     r.we_bar_pct,             r.we_bar_abw_pp,     p_regelwerk, r.betrieb_key, r.bwa_monat) AS a_we_bar,
           ampel.urteil('we_kueche',  r.we_kueche_pct,          r.we_kueche_abw_pp,  p_regelwerk, r.betrieb_key, r.bwa_monat) AS a_we_kueche,
           ampel.urteil('bewertung',  r.online_bewertung,       NULL,                p_regelwerk, r.betrieb_key, r.bwa_monat) AS a_bewertung,
           ampel.urteil('om',         r.om_score::numeric,      NULL,                p_regelwerk, r.betrieb_key, r.bwa_monat) AS a_om,
           ampel.urteil('pk_service', r.pk_service_pct,         r.pk_service_abw_pp, p_regelwerk, r.betrieb_key, r.monat)     AS a_pk_service,
           ampel.urteil('pk_kueche',  r.pk_kueche_pct,          r.pk_kueche_abw_pp,  p_regelwerk, r.betrieb_key, r.monat)     AS a_pk_kueche,
           ampel.urteil('pk_bar',     r.pk_bar_pct,             r.pk_bar_abw_pp,     p_regelwerk, r.betrieb_key, r.monat)     AS a_pk_bar,
           ampel.urteil('rendite',    r.rendite_ytd_pct,        NULL,                p_regelwerk, r.betrieb_key, r.bwa_monat) AS a_rendite
      FROM mart.round_table_basis r
     WHERE r.monat = date_trunc('month', p_monat)::date
), mit_signalen AS (
    SELECT b.*,
           ampel.signale(p_regelwerk,
               ARRAY['umsatz','personal','we_bar','we_kueche','bewertung','om',
                     'pk_service','pk_kueche','pk_bar','rendite'],
               ARRAY[a_umsatz, a_personal, a_we_bar, a_we_kueche, a_bewertung, a_om,
                     a_pk_service, a_pk_kueche, a_pk_bar, a_rendite]) AS st
      FROM bewertet b
)
SELECT betrieb, stadt, bwa_monat,
       umsatz_ist, umsatz_vj, umsatz_pct,
       personalkosten_ogf_pct, we_bar_pct, we_kueche_pct, online_bewertung, om_score,
       a_umsatz, a_personal, a_we_bar, a_we_kueche, a_bewertung, a_om,
       ampel.gesamt(st)      AS gesamt,
       ampel.intensitaet(st) AS intensitaet,
       CASE WHEN ampel.gesamt(st) = 'rot'
              OR ampel.intensitaet(st) = 'Nachforschung' THEN 'Ja' ELSE 'Nein' END AS massnahme,
       CASE WHEN ampel.gesamt(st) = 'rot'                THEN 'Hoch'
            WHEN ampel.intensitaet(st) = 'Nachforschung' THEN 'Mittel'
            ELSE 'Niedrig' END AS prioritaet,
       betrieb_key,
       konzept,
       a_pk_service, a_pk_kueche, a_pk_bar,
       a_rendite, rendite_ytd_pct
  FROM mit_signalen
 ORDER BY betrieb;
$$;

COMMENT ON FUNCTION mart.round_table IS
'Round Table fuer einen Monat, bewertet mit einem beliebigen Regelwerk (ohne Angabe: dem
Standard). Fuer den Standard ist mart.round_table_monat dieselbe Zahl, nur schneller.
Seit 0129 ueber ampel.urteil(): jedes Regelwerk bekommt, was es bewertet — die alten den
Wert, das Management-Regelwerk die Abweichung. Welche Ampeln ins Gesamturteil zaehlen,
sagt ampel.regel.im_gesamturteil des gewaehlten Regelwerks.';


-- ---------------------------------------------------------------------
-- 12. Das Regelwerk zum Nachlesen
--
-- Dieselben Spalten wie in 0107, dahinter Bezug und Soll. Die Zeilen je
-- Marke kommen jetzt aus ZWEI Quellen: regel_konzept (eigene Schwellen
-- oder ausgesetzt) und ampel.soll (eigenes Soll bei gleicher Toleranz).
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.ampel_schwelle AS
WITH bereich AS (
    SELECT * FROM (VALUES
        ('umsatz',           'Umsatz',             1),
        ('personal',         'Personal',           2),
        ('pk_service',       'Personal Service',   3),
        ('pk_kueche',        'Personal Küche',     4),
        ('pk_bar',           'Personal Bar',       5),
        ('we_kueche',        'WE Küche',           6),
        ('we_bar',           'WE Bar',             7),
        ('bewertung',        'Online-Bewertung',   8),
        ('om',               'OM vor Ort',         9),
        ('rendite',          'Rendite YTD',       10),
        ('bounti_abschluss', 'Bounti Abschluss',  11),
        ('bounti_teilnahme', 'Bounti Teilnahme',  12)
    ) v(bereich, bereich_name, reihenfolge)
),
saetze AS (
    -- Der Rueckfall: eine Zeile je Regel.
    SELECT r.regelwerk_key, r.bereich, r.richtung, r.schwellenquelle,
           NULL::integer            AS konzept_key,
           '(alle übrigen Marken)'  AS konzept,
           true                     AS ist_rueckfall,
           false                    AS ohne_urteil,
           r.schwelle_gruen, r.schwelle_orange,
           CASE WHEN r.bezug = 'abweichung'
                THEN (SELECT s.hinweis FROM ampel.soll s WHERE s.bereich = r.bereich AND s.konzept_key IS NULL)
           END                      AS soll_hinweis,
           r.hinweis
      FROM ampel.regel r
    UNION ALL
    -- Je Marke mit eigenem Satz oder ausgesetztem Urteil.
    SELECT r.regelwerk_key, r.bereich, r.richtung, r.schwellenquelle,
           k.konzept_key, k.name, false, rk.ohne_urteil,
           coalesce(rk.schwelle_gruen, r.schwelle_gruen),
           coalesce(rk.schwelle_orange, r.schwelle_orange),
           NULL, rk.hinweis
      FROM ampel.regel_konzept rk
      JOIN ampel.regel r    ON r.regelwerk_key = rk.regelwerk_key AND r.bereich = rk.bereich
      JOIN core.konzept k   ON k.konzept_key   = rk.konzept_key
    UNION ALL
    -- Je Marke mit eigenem Soll, wo die Regel eine Abweichung misst und
    -- die Marke keine eigene Zeile in regel_konzept hat.
    SELECT r.regelwerk_key, r.bereich, r.richtung, r.schwellenquelle,
           k.konzept_key, k.name, false, false,
           r.schwelle_gruen, r.schwelle_orange,
           s.hinweis, s.hinweis
      FROM ampel.soll s
      JOIN ampel.regel r  ON r.bereich = s.bereich AND r.bezug = 'abweichung'
      JOIN core.konzept k ON k.konzept_key = s.konzept_key
     WHERE NOT EXISTS (SELECT 1 FROM ampel.regel_konzept rk
                        WHERE rk.regelwerk_key = r.regelwerk_key
                          AND rk.bereich       = r.bereich
                          AND rk.konzept_key   = s.konzept_key)
),
mit_soll AS (
    SELECT sa.*,
           r.bezug,
           r.gruen_ausschliesslich,
           r.im_gesamturteil,
           CASE WHEN r.bezug = 'abweichung' THEN
                coalesce((SELECT s.soll FROM ampel.soll s
                           WHERE s.bereich = sa.bereich AND s.konzept_key = sa.konzept_key),
                         CASE WHEN NOT EXISTS (SELECT 1 FROM ampel.soll s
                                                WHERE s.bereich = sa.bereich
                                                  AND s.konzept_key = sa.konzept_key)
                              THEN (SELECT s.soll FROM ampel.soll s
                                     WHERE s.bereich = sa.bereich AND s.konzept_key IS NULL) END)
           END AS soll
      FROM saetze sa
      JOIN ampel.regel r ON r.regelwerk_key = sa.regelwerk_key AND r.bereich = sa.bereich
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
         WHEN s.ohne_urteil                      THEN 'kein Urteil'
         WHEN s.schwellenquelle = 'lina_betrieb' THEN 'je Betrieb aus LINA'
         WHEN s.schwelle_gruen IS NULL           THEN 'keine Schwelle hinterlegt'
         WHEN s.bezug = 'abweichung' THEN
              'grün bis ' || CASE WHEN s.schwelle_gruen = 0 THEN '±0' ELSE '+' || replace(trim(to_char(s.schwelle_gruen, 'FM999990.00')), '.', ',') END
           || ' Pkt. · orange bis +' || replace(trim(to_char(s.schwelle_orange, 'FM999990.00')), '.', ',')
           || ' Pkt. ' || CASE s.bereich WHEN 'personal' THEN 'über Budget'
                                         WHEN 'we_bar' THEN 'über Soll' WHEN 'we_kueche' THEN 'über Soll'
                                         ELSE 'über Vorjahr' END
         -- Dezimalkomma von Hand: to_char() folgt lc_numeric, und das
         -- steht auf dem Server auf C (0107).
         WHEN s.richtung = 'niedriger_ist_besser'
           THEN 'grün bis '      || replace(trim(to_char(s.schwelle_gruen,  'FM999990.00')), '.', ',')
             || ' · orange bis ' || replace(trim(to_char(s.schwelle_orange, 'FM999990.00')), '.', ',')
         ELSE 'grün ' || CASE WHEN s.gruen_ausschliesslich THEN 'über ' ELSE 'ab ' END
             || replace(trim(to_char(s.schwelle_gruen,  'FM999990.00')), '.', ',')
             || ' · orange ab '  || replace(trim(to_char(s.schwelle_orange, 'FM999990.00')), '.', ',')
       END AS gilt,
       CASE WHEN s.ist_rueckfall THEN (
              SELECT count(*)
                FROM ampel.konzept_je_betrieb kb
                JOIN mart.betrieb_status bs ON bs.betrieb_key = kb.betrieb_key
               WHERE bs.status = 'operativ'
                 AND NOT EXISTS (SELECT 1 FROM ampel.regel_konzept x
                                  WHERE x.regelwerk_key = s.regelwerk_key
                                    AND x.bereich       = s.bereich
                                    AND x.konzept_key   = kb.konzept_key)
                 AND NOT (s.bezug = 'abweichung'
                          AND EXISTS (SELECT 1 FROM ampel.soll y
                                       WHERE y.bereich = s.bereich
                                         AND y.konzept_key = kb.konzept_key)))
            ELSE (
              SELECT count(*)
                FROM ampel.konzept_je_betrieb kb
                JOIN mart.betrieb_status bs ON bs.betrieb_key = kb.betrieb_key
               WHERE bs.status = 'operativ'
                 AND kb.konzept_key = s.konzept_key)
       END::int AS betriebe_operativ,
       s.hinweis,
       -- ab hier 0129
       s.bezug,
       s.soll,
       s.im_gesamturteil
  FROM mit_soll s
  JOIN ampel.regelwerk w ON w.regelwerk_key = s.regelwerk_key
  JOIN bereich b         ON b.bereich       = s.bereich;

COMMENT ON VIEW mart.ampel_schwelle IS
'Koernung: Regelwerk, Bereich und Marke — welche Schwelle fuer wen gilt, und wie viele
operative Betriebe daran haengen.

Je Bereich die Zeile "(alle übrigen Marken)" (der Rueckfall) und je Marke eine Zeile,
wenn sie eigene Schwellen, ein ausgesetztes Urteil oder (seit 0129) ein eigenes Soll hat.
bezug = abweichung: bewertet wird der Abstand zu soll (beim Personal: zum Budget —
Plan-BWA, sonst dieses Soll; bei Personal je Bereich: zum Vorjahr, soll ist dann leer).
im_gesamturteil = false: die Ampel steht neben dem Gesamturteil (Rendite, Bounti).
Das Standardregelwerk ist die Zeile mit ist_standard; seit 0129 ist es `management`.';


-- ---------------------------------------------------------------------
-- 13. Bounti fuer das Management-Dashboard — Stand heute
--
-- Kein Monat: "wie viel ist abgeschlossen" ist eine Aussage ueber heute
-- (dieselbe Begruendung wie mart.bounti_betrieb_stand, 0097).
--
-- TEILNAHME: Daniel wollte "hat eine Schulung begonnen". Bounti kennt
-- keinen Zustand begonnen — eine Zuweisung ist offen oder abgeschlossen,
-- und zugewiesen wird von der Betriebsleitung, nicht vom Mitarbeitenden.
-- Gezaehlt wird deshalb, wer mindestens EINE Schulung abgeschlossen hat.
-- Der Abgleich gegen den Personalstand laut LINA fehlt: der Bericht
-- Team > Mitarbeiter > Stammdaten ist fuer unseren Zugang gesperrt
-- (access:false, kennzahlen-mapping.md). Der Nenner sind die aktiven
-- Koepfe in Bounti, und das steht in der Karte.
-- ---------------------------------------------------------------------

CREATE VIEW mart.bounti_quote_betrieb AS
WITH teilnahme AS (
    SELECT betrieb_key,
           count(DISTINCT mitarbeiter_id) FILTER (WHERE NOT archiviert AND abgeschlossen > 0)::int
               AS koepfe_mit_abschluss
      FROM mart.bounti_person_stand
     WHERE betrieb_key IS NOT NULL
     GROUP BY betrieb_key
)
SELECT s.betrieb_key,
       s.betrieb,
       s.konzept,
       s.operativ,
       s.in_bounti,
       s.datenbasis,
       s.koepfe_aktiv,
       coalesce(t.koepfe_mit_abschluss, 0)                           AS koepfe_mit_abschluss,
       s.zuweisungen,
       s.abgeschlossen,
       s.erfuellung_pct                                              AS abschluss_pct,
       CASE WHEN s.koepfe_aktiv > 0
            THEN round(100.0 * coalesce(t.koepfe_mit_abschluss, 0) / s.koepfe_aktiv, 2)
       END                                                           AS teilnahme_pct,
       s.ergebnis_schnitt_pct                                        AS punkte_schnitt_pct,
       -- Nur wo die Datenbasis traegt: bei drei Zuweisungen ist 0 % oder
       -- 100 % keine Aussage (0097).
       CASE WHEN s.datenbasis = 'belastbar'
            THEN ampel.urteil('bounti_abschluss', s.erfuellung_pct, NULL, NULL, s.betrieb_key) END
                                                                     AS ampel_abschluss,
       CASE WHEN s.datenbasis = 'belastbar' AND s.koepfe_aktiv > 0
            THEN ampel.urteil('bounti_teilnahme',
                              round(100.0 * coalesce(t.koepfe_mit_abschluss, 0) / s.koepfe_aktiv, 2),
                              NULL, NULL, s.betrieb_key) END         AS ampel_teilnahme
  FROM mart.bounti_betrieb_stand s
  LEFT JOIN teilnahme t ON t.betrieb_key = s.betrieb_key;

COMMENT ON VIEW mart.bounti_quote_betrieb IS
'Koernung: Betrieb, Stand heute. Die zwei Bounti-Ampeln des Management-Regelwerks.
abschluss_pct = abgeschlossene / alle Zuweisungen. teilnahme_pct = aktive Mitarbeitende
mit mindestens einem Abschluss / aktive Mitarbeitende in Bounti — Bounti kennt keinen
Zustand "begonnen", und den Personalstand laut LINA koennen wir nicht lesen (gesperrt).
Ampeln nur bei datenbasis = belastbar. Beide stehen NEBEN dem Gesamturteil, nicht darin.
Eine Person an mehreren Standorten zaehlt an jedem (mart.bounti_mehrfachzuordnung).
Prozentzahlen, nie Brueche.';


-- ---------------------------------------------------------------------
-- 14. Die neue Materialisierung muss auffallen, wenn sie nicht laeuft
--     (0091: jede materialisierte Sicht braucht eine Zeile)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.materialisierung_stand AS
WITH letzter_lauf AS (
         SELECT l_1.beendet_am,
            l_1.gestartet_am,
            COALESCE(l_1.tagesgeschaeft_bis, l_1.beendet_am) AS tagesgeschaeft_bis
           FROM sync.lauf l_1
          WHERE l_1.status = ANY (ARRAY['ok'::text, 'teilweise'::text])
          ORDER BY l_1.beendet_am DESC NULLS LAST
         LIMIT 1
        ), vorhanden AS (
         SELECT (pg_matviews.schemaname::text || '.'::text) || pg_matviews.matviewname::text AS sicht
           FROM pg_matviews
          WHERE pg_matviews.schemaname = 'mart'::name
        ), zuordnung(sicht, schluessel, nachlauf) AS (
         VALUES ('mart.deckungsbeitrag_warengruppe'::text,'deckungsbeitrag_refresh'::text,'src/sync/deckungsbeitrag.ts'::text), ('mart.round_table_monat'::text,'round_table_refresh'::text,'src/sync/round_table.ts'::text), ('mart.round_table_trend'::text,'round_table_refresh'::text,'src/sync/round_table.ts'::text), ('mart.artikel_monat_basis'::text,'round_table_refresh'::text,'src/sync/round_table.ts'::text), ('mart.artikeltage_basis'::text,'round_table_refresh'::text,'src/sync/round_table.ts'::text), ('mart.vergleichstag_basis'::text,'vergleichstag_refresh'::text,'src/sync/vergleichstag.ts'::text), ('mart.einkauf_kreditor_monat'::text,'einkauf_sichten_refresh'::text,'src/sync/einkauf_sichten.ts'::text), ('mart.einkaufspreis_monat_basis'::text,'einkauf_sichten_refresh'::text,'src/sync/einkauf_sichten.ts'::text), ('mart.einkaufspreis_betrieb_basis'::text,'einkauf_sichten_refresh'::text,'src/sync/einkauf_sichten.ts'::text), ('mart.einkauf_betrieb_monat_basis'::text,'einkauf_sichten_refresh'::text,'src/sync/einkauf_sichten.ts'::text), ('mart.einkauf_pruefung_basis'::text,'einkauf_sichten_refresh'::text,'src/sync/einkauf_sichten.ts'::text), ('mart.pflichtartikel_klassifikation_basis'::text,'pflichtartikel_refresh'::text,'src/sync/pflichtartikel_sichten.ts'::text), ('mart.pflichtartikel_einkauf_basis'::text,'pflichtartikel_refresh'::text,'src/sync/pflichtartikel_sichten.ts'::text), ('mart.pflichtartikel_artikel_basis'::text,'pflichtartikel_refresh'::text,'src/sync/pflichtartikel_sichten.ts'::text), ('mart.wetter_tag_basis'::text,'wetter_tag_refresh'::text,'src/wetter/nachlauf.ts'::text), ('mart.finanzweg_monat_basis'::text,'betriebsbericht_sichten_refresh'::text,'src/sync/betriebsbericht_sichten.ts'::text), ('mart.betriebsbericht_ladestand_basis'::text,'betriebsbericht_sichten_refresh'::text,'src/sync/betriebsbericht_sichten.ts'::text),
                -- 0129
                ('mart.personal_bereich_monat'::text,'round_table_refresh'::text,'src/sync/round_table.ts'::text)
        )
 SELECT COALESCE(v.sicht, z.sicht) AS sicht,
    z.schluessel,
    z.nachlauf,
    m.gesetzt_am AS zuletzt_aufgefrischt,
    (m.wert ->> 'dauer_s'::text)::numeric AS dauer_s,
    l.beendet_am AS letzter_lauf,
        CASE
            WHEN z.sicht IS NULL THEN 'ohne Refresh'::text
            WHEN v.sicht IS NULL THEN 'Sicht fehlt'::text
            WHEN m.gesetzt_am IS NULL THEN 'nie aufgefrischt'::text
            WHEN l.beendet_am IS NULL THEN 'kein Lauf'::text
            WHEN m.gesetzt_am < (
            CASE
                WHEN z.schluessel = 'wetter_tag_refresh'::text THEN l.gestartet_am
                ELSE l.tagesgeschaeft_bis
            END - '01:00:00'::interval) THEN 'veraltet'::text
            ELSE 'aktuell'::text
        END AS zustand
   FROM vorhanden v
     FULL JOIN zuordnung z ON z.sicht = v.sicht
     LEFT JOIN letzter_lauf l ON true
     LEFT JOIN sync.merker m ON m.schluessel = z.schluessel;


-- ---------------------------------------------------------------------
-- 15. Der MCP-Zugang soll es auch wissen
-- ---------------------------------------------------------------------

INSERT INTO mcp.sicht (sicht, koernung, thema, summen_erlaubt) VALUES
  ('mart.personal_bereich_monat',
   'Betrieb und Monat — Personalkosten und Effektivitaet je Bereich aus der Kasse', 'personal', false),
  ('mart.rendite_monat',
   'Betrieb und BWA-Monat — Rendite (EBIT / Umsatz), Monat und YTD', 'bwa', false),
  ('mart.bounti_quote_betrieb',
   'Betrieb, Stand heute — Bounti-Abschluss- und Teilnahmequote mit Ampel', 'schulung', false)
ON CONFLICT (sicht) DO UPDATE
   SET koernung = excluded.koernung, thema = excluded.thema;

SELECT mcp.achsen_ableiten();

INSERT INTO mcp.fallstrick (schluessel, art, schwere, sicht, parameter, hinweis, berichtigung, quelle) VALUES
  ('schwellen_seit_0129', 'deutung', 'warnung', 'mart.ampel_bereich',
   '{}',
   'Seit dem 29.09.2026 urteilt das Management-Regelwerk: Personal und Wareneinsatz werden als '
   'ABWEICHUNG bewertet (vom Budget, vom Soll der Marke, beim Personal je Bereich vom Vorjahr), '
   'Umsatz gruen erst ueber +2 %, Bewertung ab 4,30. OM zaehlt nicht mehr, Rendite und Bounti '
   'stehen neben dem Gesamturteil. Die Materialisierung rechnet ALLE Monate mit dem geltenden '
   'Regelwerk neu — eine Ampel von Juli 2026 heisst heute etwas anderes als im Juli-Round-Table.',
   'Fuer Zeitreihen die Werte und Abweichungen vergleichen (wert, bezugswert, abweichung), '
   'nicht die Ampeln. Was gilt: mart.ampel_schwelle WHERE ist_standard.',
   'migrations/0129_management_regelwerk.sql'),

  ('personal_bereich_nenner', 'deutung', 'warnung', 'mart.personal_bereich_monat',
   '{}',
   'Die drei Bereichsquoten haben DREI NENNER: Service den Gesamtumsatz, Kueche den '
   'Speisenumsatz, Bar den Getraenkeumsatz. Sie addieren sich nicht zur Gesamtquote, und die '
   'drei Euro-Betraege nicht zu pk_gesamt_eur (Personal ausserhalb der drei Bereiche). Das ist '
   'die Kasse, nicht die BWA.',
   'Quoten nie addieren. Fuer eine Summe die Euro-Spalten nehmen und dazusagen, dass der Rest '
   'fehlt; fuer die BWA-Quote mart.round_table_monat.personalkosten_ogf_pct.',
   'migrations/0129_management_regelwerk.sql')
ON CONFLICT (schluessel) DO UPDATE
   SET hinweis = excluded.hinweis, berichtigung = excluded.berichtigung,
       sicht = excluded.sicht, quelle = excluded.quelle, aktiv = true;

-- Die Warnung aus 0107 beschreibt ein Regelwerk, das nicht mehr urteilt.
UPDATE mcp.fallstrick SET aktiv = false WHERE schluessel = 'schwellen_seit_0107';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        EXECUTE 'GRANT SELECT ON ampel.soll, ampel.soll_je_betrieb, '
                'mart.personal_bereich_monat, mart.rendite_monat, mart.bounti_quote_betrieb, '
                'mart.round_table_monat, mart.ampel_bereich TO mcp_leser';
    END IF;
END $$;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0129', to_jsonb(
        'Management-Regelwerk ist Standard (Daniel, 29.09.2026). Personal o. GF gegen Budget '
        '(Plan-BWA, sonst Soll 34 %), Personal Service/Kueche/Bar gegen Vorjahr (Kasse), '
        'Wareneinsatz gegen Soll der Marke (+0,5 / +1,0), Umsatz >+2 / -2, Bewertung 4,30 / 4,00. '
        'Gesamturteil ohne OM, Rendite (YTD) und Bounti daneben. Was gilt: '
        'SELECT * FROM mart.ampel_schwelle WHERE ist_standard;'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
