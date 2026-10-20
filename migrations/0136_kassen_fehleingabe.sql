-- =====================================================================
-- 0136 — Kassen-Fehleingaben in den Finanzwegen: laden, erkennen, ausblenden
--
-- ANLASS. Bericht 97 (Tagesabschluss) fuer Aposto Aalen, Juli 2025, scheiterte
-- seit dem 02.10.2026 jede Nacht mit "numeric field overflow" — 27 Versuche,
-- keine einzige Rohantwort (sie lag in derselben Transaktion wie das Laden).
-- Die Probe vom 20.10.2026 (ein lesender Abruf im Terminal) zeigte den Grund:
-- am 19.07.2025 hat jemand einen Bon ueber rund 17,98 EUR mit einem absurden
-- Betrag "Bar gegeben" abgeschlossen (fast genau 2^63 / 10^6), die Kasse hat
-- daraus ein Rueckgeld derselben Groesse gerechnet:
--
--     Bar gegeben  -9.223.372.043.271,11   ohne den Unsinn  -6.416,34
--     Rueckgeld    +9.223.372.036.836,80   ohne den Unsinn     -17,97
--     Summe beider            -6.434,31   stimmt
--
-- numeric(16,4) faengt bei 10^12 an zu kippen. Das ist aber nur der eine Fall,
-- der zu gross fuer die Spalte war. Dieselbe Fehleingabe stand am 20.10.2026
-- an acht weiteren Betrieb-Tagen schon in core, mit Betraegen von 19.482 EUR
-- bis 555 Mrd. EUR, und kam bis in mart.zahlart_monat (Schlager Cafe
-- Duesseldorf, Maerz 2026: "Bar gegeben" 555,6 Mrd. EUR, Anteil 100 %;
-- Aposto Gera, August 2026: EC-Karte und Trinkgeld je 11,1 Mrd. EUR).
-- Messung und Liste: docs/befunde-datenlage.md, 20.10.2026.
--
-- WAS DIESE MIGRATION TUT:
--   1. core.finanzweg_tag bekommt umsatz_ueberlauf / anzahl_ueberlauf. Ein
--      Wert, der numeric(16,4) bzw. numeric(14,3) sprengt, steht dort, die
--      eigentliche Spalte ist dann NULL. Die Spalte selbst zu vergroessern
--      ging nicht: Postgres aendert keinen Typ einer Spalte, auf der Sichten
--      stehen, und auf umsatz stehen mehrere.
--   2. core.finanzweg_fehleingabe und core.finanzweg_fehleingabe_pruefen():
--      die Erkennung, je Betrieb, Tag und Quellbericht. Der Lader ruft die
--      Funktion nach jedem Finanzwegabruf fuer genau seinen Zeitraum auf.
--   3. mart.finanzweg_tag laesst an einem solchen Tag ALLE Zahlart-Zeilen des
--      Betriebs weg — nicht nur die beiden unsinnigen. Welcher Teil von
--      "Bar gegeben" echt war, laesst sich nicht trennen; eine fast richtige
--      Zahl ist teurer als eine fehlende. Der Tag fehlt sichtbar:
--      mart.zahlart_monat.tage_fehleingabe, mart.finanzweg_fehleingabe und
--      eine Zeile in mart.pruefung_uebersicht.
--   4. raw.api_antwort.ladefehler: scheitert das Laden, sichert der Worker
--      die Antwort trotzdem (src/sync/worker.ts), damit man sie lesen kann.
--   5. Warteschlangen-Ergebnis 'ladefehler': nach LADEFEHLER_MAX_VERSUCHEN
--      (10) bricht der Worker einen Posten ab, dessen Laden scheitert. Vorher
--      wurde er unbegrenzt vertagt (Aalen: 27 Versuche) und stand in keiner
--      Pruefsicht. Jetzt in mart.posten_aufgegeben als 'endgueltig'.
--   6. Tischuebergabe/-uebernahme sind keine Zahlart. Manche Kassen fuehren
--      sie unter "Uebernahme / Uebergabe" statt "Statistik"; sie fielen in
--      den ELSE-Zweig und zaehlten im Nenner des Zahlart-Anteils mit (2.047
--      Tage, 5,0 Mio. EUR je Richtung). Eine Regel fuer Sicht, Erkennung und
--      Lader: mart.finanzweg_art().
--
-- core BLEIBT QUELLENTREU. Nichts in core wird korrigiert oder geloescht —
-- die Fehleingabe steht dort so, wie LINA sie liefert. Ausgeblendet wird
-- nur in mart.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Steht in der Zieldatenbank die Fassung, auf der diese Migration baut?
--
-- Die beiden Sichten unten sind am 20.10.2026 aus der Produktion gezogen
-- (pg_get_viewdef, Stand 0135) und hier nur ergaenzt. Weicht die
-- Spaltenliste ab, hat eine andere Session sie geaendert: dann abbrechen,
-- statt eine fremde Fassung still zu ueberschreiben (dieselbe Regel wie 0134).
-- ---------------------------------------------------------------------

DO $pruefung$
DECLARE
    r record;
    v_ist text[];
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('mart.finanzweg_tag', ARRAY[
            'geschaeftstag', 'zeitraum_bis', 'tage', 'monat', 'betrieb_key', 'enc_id', 'betrieb',
            'marke', 'quelle_bericht', 'finanzweg_nummer', 'finanzweg_name', 'finanzgruppe', 'art',
            'abschnitt', 'prozentsatz', 'aktion', 'betrag', 'anzahl_vorgaenge', 'operativ']),
        ('mart.zahlart_monat', ARRAY[
            'monat', 'betrieb_key', 'enc_id', 'betrieb', 'marke', 'zahlart', 'finanzweg_nummer',
            'finanzgruppe', 'zahlbetrag', 'anzahl_vorgaenge', 'zahlart_anteil_pct', 'quellen',
            'operativ']),
        ('mart.posten_aufgegeben', ARRAY[
            'posten_id', 'endpunkt', 'marke', 'zeitraum_von', 'parameter', 'versuche',
            'wiederbelebt', 'zuletzt_aufgegeben', 'fehler', 'zustand', 'quelle_antwortet'])
    ) AS v(sicht, spalten)
    LOOP
        SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_ist
          FROM pg_attribute a
         WHERE a.attrelid = r.sicht::regclass AND a.attnum > 0 AND NOT a.attisdropped;
        IF v_ist IS DISTINCT FROM r.spalten THEN
            RAISE EXCEPTION '0136: % hat nicht die erwartete Spaltenliste (ist: %) — nicht ersetzt',
                            r.sicht, v_ist;
        END IF;
    END LOOP;
END $pruefung$;


-- ---------------------------------------------------------------------
-- 1. Werte, die die Spalte sprengen
-- ---------------------------------------------------------------------

ALTER TABLE core.finanzweg_tag
    ADD COLUMN IF NOT EXISTS umsatz_ueberlauf numeric,
    ADD COLUMN IF NOT EXISTS anzahl_ueberlauf numeric;

COMMENT ON COLUMN core.finanzweg_tag.umsatz_ueberlauf IS
'Nur gesetzt, wenn LINAs Betrag numeric(16,4) sprengt (|x| >= 10^12): dann steht er hier und umsatz
ist NULL (0136). Kein echter Umsatz, sondern eine Fehleingabe an der Kasse — Aposto Aalen,
19.07.2025: Bar gegeben -9.223.372.043.271,11 EUR. Die Erkennung (core.finanzweg_fehleingabe)
liest coalesce(umsatz, umsatz_ueberlauf).';
COMMENT ON COLUMN core.finanzweg_tag.anzahl_ueberlauf IS
'Wie umsatz_ueberlauf, fuer die Anzahl (numeric(14,3), |x| >= 10^11). anzahl ist dann NULL.';


-- ---------------------------------------------------------------------
-- 1b. Was ein Finanzweg ist — EINE Regel fuer Sicht, Erkennung und Lader
--
-- In mart und ohne Tabellenzugriff, wie mart.finanzweg_prozentsatz (0117):
-- eine Funktion in einer Sicht laeuft mit den Rechten des Aufrufers, und
-- mcp_leser darf in core nichts. Dieselbe Regel wie finanzwegArt() im
-- Lader (src/transform/betriebsbericht.ts).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mart.finanzweg_art(p_gruppe text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE
             WHEN lower(p_gruppe) IN ('hausbon', 'rabatt') THEN 'nachlass'
             WHEN lower(p_gruppe) = 'umsatz' THEN 'umsatz'
             WHEN lower(p_gruppe) = 'statistik' THEN 'statistik'
             WHEN p_gruppe ~* '(ü|Ü|ue)bergabe|(ü|Ü|ue)bernahme' THEN 'statistik'
             ELSE 'zahlart'
           END
$$;

COMMENT ON FUNCTION mart.finanzweg_art(text) IS
'Art eines Finanzwegs aus seiner Finanzgruppe: nachlass (Hausbon, Rabatt) | umsatz | statistik |
zahlart (alles andere, auch ohne Gruppe). Statistik sind auch Tischuebergabe und -uebernahme unter
der Gruppe "Uebernahme / Uebergabe" (0136): sie verschieben einen offenen Tisch, kein Gast bezahlt
damit. Vorher fielen sie in zahlart, und ihre positive Haelfte zaehlte im Nenner von
mart.zahlart_monat.zahlart_anteil_pct mit (2.047 Tage, 5,0 Mio. EUR je Richtung, 20.10.2026).';

-- Der Stamm fuehrt die Art als Spalte; der Lader schreibt ab hier die neue Regel.
UPDATE core.finanzweg
   SET art = 'statistik'
 WHERE art = 'zahlart' AND mart.finanzweg_art(finanzgruppe) = 'statistik';


-- ---------------------------------------------------------------------
-- 2. Die Erkennung
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS core.finanzweg_fehleingabe (
    betrieb_key       integer  NOT NULL REFERENCES core.betrieb(betrieb_key),
    geschaeftstag     date     NOT NULL,
    bericht           smallint NOT NULL,
    zeitraum_bis      date     NOT NULL,
    finanzweg_nummer  integer  NOT NULL,
    finanzweg_name    text     NOT NULL,
    regel             text     NOT NULL CHECK (regel IN ('ausgleich ueber einnahmen', 'betrag absurd')),
    betrag_lina       numeric  NOT NULL,
    bezug             numeric  NOT NULL,
    erkannt_am        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, geschaeftstag, bericht, zeitraum_bis, finanzweg_nummer)
);

COMMENT ON TABLE core.finanzweg_fehleingabe IS
'Koernung: eine Finanzwegzeile aus core.finanzweg_tag, an der eine Kassen-Fehleingabe erkannt ist
(0136). Abgeleitet, jederzeit neu rechenbar: core.finanzweg_fehleingabe_pruefen(). Der Lader ruft
sie nach jedem Finanzwegabruf fuer seinen Betrieb, Bericht und Zeitraum auf.

Ein Betrieb-Tag mit mindestens einer Zeile hier verliert in mart.finanzweg_tag ALLE Zahlart-Zeilen
(nicht nur diese): der Unsinn steckt in "Bar gegeben" oder "EC-Karte" zusammen mit dem echten
Tagesbetrag, und wie viel davon echt war, laesst sich nicht trennen.';
COMMENT ON COLUMN core.finanzweg_fehleingabe.regel IS
'ausgleich ueber einnahmen: Trinkgeld, TIP oder Rueckgeld groesser als der Bezug des Tages — wer zu
viel eintippt, bekommt den Rest als Trinkgeld oder Rueckgeld. betrag absurd: eine Zahlart ueber
1 Mio. EUR und ueber dem 50-fachen des Bezugs.';
COMMENT ON COLUMN core.finanzweg_fehleingabe.betrag_lina IS
'Der Betrag mit LINAs Vorzeichen (Zahlungen negativ, Trinkgeld und Rueckgeld positiv), aus umsatz
oder umsatz_ueberlauf.';
COMMENT ON COLUMN core.finanzweg_fehleingabe.bezug IS
'Womit verglichen wurde: das Groessere aus (a) dem Betrag der Zahlartensumme des Tages — darin heben
sich die beiden Haelften einer Fehleingabe auf, sie ist der Tagesumsatz — und (b) den Zahlungen des
Tages ohne die groesste. (b) gibt es fuer Tage, an denen eine Gegenbuchung (Gastrechnung,
Gutscheinverkauf) die Summe drueckt: Ratskeller Ludwigsburg, 03.05.2026, Summe 80 EUR bei 2.781 EUR
Zahlungen und 158 EUR Trinkgeld. Mindestens 100 EUR.';


CREATE OR REPLACE FUNCTION core.finanzweg_fehleingabe_pruefen(
    p_betrieb_key integer DEFAULT NULL,
    p_bericht     integer DEFAULT NULL,
    p_von         date    DEFAULT NULL,
    p_bis         date    DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_n integer;
BEGIN
    DELETE FROM core.finanzweg_fehleingabe f
     WHERE (p_betrieb_key IS NULL OR f.betrieb_key = p_betrieb_key)
       AND (p_bericht IS NULL OR f.bericht = p_bericht)
       AND (p_von IS NULL OR f.geschaeftstag >= p_von)
       AND (p_bis IS NULL OR f.geschaeftstag <= p_bis);

    INSERT INTO core.finanzweg_fehleingabe
           (betrieb_key, geschaeftstag, bericht, zeitraum_bis, finanzweg_nummer, finanzweg_name,
            regel, betrag_lina, bezug)
    WITH z AS (
        -- Nur Zahlarten: dieselbe Abgrenzung wie die Spalte art in mart.finanzweg_tag.
        SELECT t.betrieb_key, t.geschaeftstag, t.bericht, t.zeitraum_bis,
               t.finanzweg_nummer, t.finanzweg_name,
               coalesce(t.umsatz, t.umsatz_ueberlauf) AS betrag
          FROM core.finanzweg_tag t
         WHERE mart.finanzweg_art(t.finanzgruppe) = 'zahlart'
           AND (p_betrieb_key IS NULL OR t.betrieb_key = p_betrieb_key)
           AND (p_bericht IS NULL OR t.bericht = p_bericht)
           AND (p_von IS NULL OR t.geschaeftstag >= p_von)
           AND (p_bis IS NULL OR t.geschaeftstag <= p_bis)
           AND coalesce(t.umsatz, t.umsatz_ueberlauf) IS NOT NULL
    ), tag AS (
        SELECT z.betrieb_key, z.geschaeftstag, z.bericht, z.zeitraum_bis,
               greatest(abs(sum(z.betrag)),
                        coalesce(sum(-z.betrag) FILTER (WHERE z.betrag < 0), 0)
                          - coalesce(max(-z.betrag) FILTER (WHERE z.betrag < 0), 0),
                        100) AS bezug
          FROM z
         GROUP BY z.betrieb_key, z.geschaeftstag, z.bericht, z.zeitraum_bis
    )
    SELECT z.betrieb_key, z.geschaeftstag, z.bericht, z.zeitraum_bis,
           z.finanzweg_nummer, z.finanzweg_name,
           CASE WHEN z.finanzweg_name ~* '^(trinkgeld|tip)|^r(ü|ue)ckgeld$' AND z.betrag > tag.bezug
                THEN 'ausgleich ueber einnahmen' ELSE 'betrag absurd' END,
           z.betrag, tag.bezug
      FROM z
      JOIN tag USING (betrieb_key, geschaeftstag, bericht, zeitraum_bis)
     WHERE (z.finanzweg_name ~* '^(trinkgeld|tip)|^r(ü|ue)ckgeld$' AND z.betrag > tag.bezug)
        OR (abs(z.betrag) >= 1000000 AND abs(z.betrag) > 50 * tag.bezug);

    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END $$;

COMMENT ON FUNCTION core.finanzweg_fehleingabe_pruefen(integer, integer, date, date) IS
'Rechnet core.finanzweg_fehleingabe fuer einen Betrieb, Bericht und Zeitraum neu (NULL = alle) und
gibt die Zahl der erkannten Zeilen zurueck. Gemessen am 20.10.2026 an allen 685.614 Finanzwegzeilen
der Produktion: 8 Betrieb-Tage (11 Tagesquellen, weil drei Tage in 88 UND 97 stehen; 16 Zeilen),
keiner davon plausibel — und kein Fehltreffer mehr, seit der Bezug (b) dazukam.
Die Namensregel trifft Trinkgeld, TIP, "Trinkgeld 0%", TrinkgeldAN/AG und Rueckgeld — NICHT
Pfandrueckgabe. Die Schwellen sind gemessen, nicht geschaetzt (docs/befunde-datenlage.md).';

SELECT core.finanzweg_fehleingabe_pruefen();


-- ---------------------------------------------------------------------
-- 3. mart: der Tag fehlt sichtbar
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.finanzweg_tag AS
WITH q AS (
    SELECT t.geschaeftstag, t.zeitraum_bis, t.betrieb_key, t.bericht, t.finanzweg_nummer,
           t.finanzweg_name, t.finanzgruppe, t.abschnitt, t.umsatz, t.anzahl, t.raw_id, t.geladen_am
      FROM core.finanzweg_tag t
     WHERE ((t.bericht = 97 AND t.zeitraum_bis = t.geschaeftstag)
        OR (t.bericht = 88 AND t.zeitraum_bis = t.geschaeftstag
            AND NOT EXISTS (SELECT 1 FROM core.finanzweg_tag x
                             WHERE x.bericht = 97 AND x.betrieb_key = t.betrieb_key
                               AND x.geschaeftstag = t.geschaeftstag))
        OR (t.bericht = 88 AND t.zeitraum_bis > t.geschaeftstag
            AND NOT EXISTS (SELECT 1 FROM core.finanzweg_tag x
                             WHERE x.betrieb_key = t.betrieb_key
                               AND x.geschaeftstag BETWEEN t.geschaeftstag AND t.zeitraum_bis
                               AND x.zeitraum_bis = x.geschaeftstag)))
       -- 0136: an einem Tag mit Kassen-Fehleingabe keine Zahlart-Zeile dieser Quelle
       AND NOT (mart.finanzweg_art(t.finanzgruppe) = 'zahlart'
                AND EXISTS (SELECT 1 FROM core.finanzweg_fehleingabe fe
                             WHERE fe.betrieb_key = t.betrieb_key AND fe.geschaeftstag = t.geschaeftstag
                               AND fe.bericht = t.bericht AND fe.zeitraum_bis = t.zeitraum_bis))
)
SELECT q.geschaeftstag,
       q.zeitraum_bis,
       (q.zeitraum_bis - q.geschaeftstag + 1)              AS tage,
       date_trunc('month', q.geschaeftstag::timestamp)::date AS monat,
       q.betrieb_key,
       b.enc_id,
       b.name                                              AS betrieb,
       bs.konzept                                          AS marke,
       q.bericht                                           AS quelle_bericht,
       q.finanzweg_nummer,
       q.finanzweg_name,
       q.finanzgruppe,
       -- Seit 0136 aus mart.finanzweg_art(): Tischuebergabe unter "Uebernahme /
       -- Uebergabe" ist Statistik, nicht Zahlart. Ein Join auf core.finanzweg
       -- nur dafuer verdarb dem Planer die Schaetzung (6,5 s statt 0,4 s, 23.09.2026).
       mart.finanzweg_art(q.finanzgruppe)                  AS art,
       q.abschnitt,
       mart.finanzweg_prozentsatz(q.finanzweg_name)        AS prozentsatz,
       CASE WHEN lower(q.finanzgruppe) IN ('hausbon', 'rabatt')
            THEN mart.finanzweg_aktion(q.finanzweg_name) END AS aktion,
       CASE WHEN mart.finanzweg_art(q.finanzgruppe) IN ('umsatz', 'statistik') THEN q.umsatz
            ELSE -q.umsatz END                             AS betrag,
       q.anzahl                                            AS anzahl_vorgaenge,
       (bs.status = 'operativ')                            AS operativ
  FROM q
  JOIN core.betrieb b              ON b.betrieb_key  = q.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = q.betrieb_key;

COMMENT ON VIEW mart.finanzweg_tag IS
'Koernung: Betrieb × Tag × Finanzweg — aus GENAU EINER Quelle je Betrieb und Tag: Bericht 97
(Tagesabschluss), wo es ihn gibt, sonst 88 (quelle_bericht). 97 ist seit dem 23.09.2026 die
EINZIGE laufende Quelle; 88 ist abgeschaltet und steht nur noch fuer Tage, die bis dahin geladen
wurden und fuer die 97 fehlt. Der laufende Monat kommt jede Nacht bis zum Vortag (0120) — die
letzten sieben Tage sind VORLAEUFIG, LINA fuellt sie noch; endgueltig ist ein Monat, wenn
mart.betriebsbericht_ladestand_monat fuer Bericht 97 "vollstaendig" sagt. core.finanzweg_tag
fuehrt beide Quellen, und eine Summe darueber waere doppelt (0114, gemessen auf den Cent
gleich). Ein Mehrtagesabruf von 88 (tage > 1) steht nur da, wo der Betrieb im Zeitraum keinen
Tageswert hat.

TISCHUEBERGABE (0136). Tischuebergabe und -uebernahme sind art = statistik, auch wo die Kasse sie
unter "Uebernahme / Uebergabe" fuehrt — vorher fielen sie dort unter zahlart.

KASSEN-FEHLEINGABEN (0136). An einem Tag, an dem jemand an der Kasse einen absurden Betrag
eingetippt hat (Bar gegeben 555 Mrd. EUR, dazu ein Rueckgeld oder Trinkgeld derselben Groesse),
fehlen ALLE Zahlart-Zeilen dieses Betriebs und Tages — Nachlaesse, Umsatz- und Statistikzeilen
bleiben. Welche Tage das sind: mart.finanzweg_fehleingabe.

betrag: Zahlungen und Nachlaesse POSITIV (LINA fuehrt sie negativ). Die Zahlarten eines Tages
summieren sich zum Bruttoumsatz — Trinkgeld und Rueckgeld stehen dabei negativ, weil sie in den
Zahlbetraegen darueber enthalten sind (Wilma Wunder Duesseldorf, August 2026: 369.841,09 EUR,
nachgerechnet am 23.09.2026). Umsatzzeilen (Boniert, Sofortstorno, Storno) behalten LINAs
Vorzeichen.

anzahl_vorgaenge zaehlt VORGAENGE (50 % Gluecksrad: 600 in Duesseldorf), nicht Artikel — der
Rabattbericht zaehlt fuer denselben Finanzweg 712 Artikel. Nie gegen mart.artikel_nachlass_*
addieren. Eine Aktion buendelt man ueber aktion + prozentsatz, nicht ueber die Nummer.';


-- tage_fehleingabe am ENDE (CREATE OR REPLACE VIEW kann nur anhaengen).
CREATE OR REPLACE VIEW mart.zahlart_monat AS
SELECT m.monat,
       m.betrieb_key, m.enc_id, m.betrieb, m.marke,
       m.finanzweg_name                                    AS zahlart,
       m.finanzweg_nummer,
       m.finanzgruppe,
       m.betrag                                            AS zahlbetrag,
       m.anzahl_vorgaenge,
       CASE WHEN m.betrag > 0 THEN
         round(100 * m.betrag / nullif(sum(m.betrag) FILTER (WHERE m.betrag > 0)
                                       OVER (PARTITION BY m.betrieb_key, m.monat), 0), 2)
       END                                                 AS zahlart_anteil_pct,
       m.quellen,
       m.operativ,
       (SELECT count(DISTINCT fe.geschaeftstag)::int
          FROM core.finanzweg_fehleingabe fe
         WHERE fe.betrieb_key = m.betrieb_key
           AND fe.geschaeftstag >= m.monat
           AND fe.geschaeftstag < (m.monat + interval '1 month')::date) AS tage_fehleingabe
  FROM mart.finanzweg_monat m
 WHERE m.art = 'zahlart';

COMMENT ON VIEW mart.zahlart_monat IS
'Koernung: Betrieb × Monat × Zahlart (F3: Karte gegen bar, Lieferdienste, Gutscheine). Aus
88/97, je Tag eine Quelle. zahlbetrag positiv; die Summe aller Zeilen eines Betriebs und
Monats ist der Bruttoumsatz — ohne die Tage in tage_fehleingabe. Trinkgeld und Rueckgeld stehen
NEGATIV, weil sie in den Zahlbetraegen der anderen Zeilen stecken. zahlart_anteil_pct:
Prozentzahl von allem, was Gaeste bezahlt haben (Summe der positiven Zeilen, also
einschliesslich Trinkgeld); fuer Trinkgeld und Rueckgeld leer. Nicht summieren, nicht mitteln.

tage_fehleingabe (0136): an so vielen Tagen des Monats hat jemand an der Kasse einen absurden
Betrag eingetippt; die Zahlarten dieser Tage fehlen hier ganz (mart.finanzweg_fehleingabe).
Groesser als 0 heisst: der Monat ist um diese Tage zu klein, nicht falsch verteilt.';
COMMENT ON COLUMN mart.zahlart_monat.tage_fehleingabe IS
'Tage dieses Betriebs und Monats, deren Zahlarten wegen einer Kassen-Fehleingabe fehlen (0136).
Steht an jeder Zeile des Betriebs und Monats gleich — nicht summieren.';


CREATE OR REPLACE VIEW mart.finanzweg_fehleingabe AS
SELECT fe.geschaeftstag,
       fe.zeitraum_bis,
       date_trunc('month', fe.geschaeftstag::timestamp)::date AS monat,
       fe.betrieb_key,
       b.enc_id,
       b.name                                              AS betrieb,
       bs.konzept                                          AS marke,
       fe.bericht                                          AS quelle_bericht,
       fe.finanzweg_nummer,
       fe.finanzweg_name,
       fe.regel,
       fe.betrag_lina,
       fe.bezug,
       (fe.bericht = 97
        OR NOT EXISTS (SELECT 1 FROM core.finanzweg_tag x
                        WHERE x.bericht = 97 AND x.betrieb_key = fe.betrieb_key
                          AND x.geschaeftstag = fe.geschaeftstag)) AS in_auswertung,
       fe.erkannt_am,
       (bs.status = 'operativ')                            AS operativ
  FROM core.finanzweg_fehleingabe fe
  JOIN core.betrieb b              ON b.betrieb_key  = fe.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = fe.betrieb_key;

COMMENT ON VIEW mart.finanzweg_fehleingabe IS
'Koernung: eine Finanzwegzeile, an der eine Kassen-Fehleingabe erkannt ist (0136). Jemand hat an
der Kasse einen absurden Betrag eingetippt — Bar gegeben 555 Mrd. EUR, EC-Karte 11 Mrd. EUR — und
die Kasse hat den Rest als Rueckgeld oder Trinkgeld verbucht. An diesem Betrieb und Tag fehlen
deshalb ALLE Zahlarten in mart.finanzweg_tag, mart.finanzweg_monat und mart.zahlart_monat
(in_auswertung: diese Quelle ist die, die dort gezaehlt wuerde).

betrag_lina hat LINAs Vorzeichen: Zahlungen negativ, Trinkgeld und Rueckgeld positiv. bezug ist
das, womit verglichen wurde (etwa der Tagesumsatz). regel: "ausgleich ueber einnahmen" (Trinkgeld
oder Rueckgeld groesser als der Bezug) oder "betrag absurd" (ueber 1 Mio. EUR und ueber dem
50-fachen des Bezugs). Kein Fehler des Imports: die Zahl steht so in der Kasse.';
COMMENT ON COLUMN mart.finanzweg_fehleingabe.in_auswertung IS
'true: diese Quelle ist die, aus der mart.finanzweg_tag den Tag nehmen wuerde (97, sonst 88) — ihre
Zahlarten fehlen dort. false: eine 88-Zeile fuer einen Tag, der aus 97 kommt.';


-- ---------------------------------------------------------------------
-- 4. Pruefuebersicht: eine Zeile, auch wenn sie null ist (wie 0127)
--
-- 60 Tage, nicht seit Beginn: die Altfaelle bleiben fuer immer stehen, und
-- eine Zeile, die nie auf null geht, liest niemand mehr (0071).
-- ---------------------------------------------------------------------

DO $aussen$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO v_def;
    IF v_def LIKE '%finanzweg_fehleingabe%' THEN RETURN; END IF;

    EXECUTE format(
        'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS %s UNION ALL %s',
        rtrim(v_def, E' ;\n\t'),
        $zweig$
        SELECT 'Finanzwege: Tag mit Kassen-Fehleingabe, Zahlarten ausgeblendet (60 Tage)'::text AS pruefung,
               (SELECT count(*) FROM (SELECT DISTINCT t.betrieb_key, t.geschaeftstag
                                        FROM core.finanzweg_tag t
                                       WHERE t.bericht = 97
                                         AND t.geschaeftstag >= current_date - 60) g)::bigint AS geprueft,
               (SELECT count(*) FROM (SELECT DISTINCT fe.betrieb_key, fe.geschaeftstag
                                        FROM core.finanzweg_fehleingabe fe
                                       WHERE fe.geschaeftstag >= current_date - 60) a)::bigint AS auffaellig,
               'mart.finanzweg_fehleingabe'::text AS sicht
        $zweig$);
END $aussen$;


-- ---------------------------------------------------------------------
-- 5. Die Rohantwort auch dann, wenn das Laden scheitert
-- ---------------------------------------------------------------------

ALTER TABLE raw.api_antwort
    ADD COLUMN IF NOT EXISTS ladefehler text;

COMMENT ON COLUMN raw.api_antwort.ladefehler IS
'NULL: die Antwort ist geladen (der Normalfall, in derselben Transaktion wie core). Sonst die
Fehlermeldung des Laders: die Antwort kam, aber das Schreiben nach core scheiterte, und der Worker
hat sie danach in einer eigenen Transaktion gesichert (0136). Je Posten nur beim ersten Auftreten
eines Fehlers, nicht bei jeder Wiederholung. Ein Neuaufbau von core aus raw trifft diese Zeile
und scheitert dort erneut — das ist richtig, die Daten sind nicht ladbar. Anlass: Aposto Aalen,
Bericht 97, Juli 2025, 27 gescheiterte Abrufe ohne eine einzige gesicherte Antwort.';


-- ---------------------------------------------------------------------
-- 5b. Ein Ladefehler gibt nach zehn Versuchen auf — sichtbar
-- ---------------------------------------------------------------------

ALTER TABLE sync.warteschlange DROP CONSTRAINT IF EXISTS warteschlange_ergebnis_check;
ALTER TABLE sync.warteschlange ADD CONSTRAINT warteschlange_ergebnis_check
    CHECK (ergebnis IN ('ok', 'keine_daten', 'aufgegeben', 'kein_zugriff',
                        'fenster_zu_gross', 'abgeschaltet', 'nicht_gefunden', 'ersatzweg',
                        'ladefehler'));

COMMENT ON CONSTRAINT warteschlange_ergebnis_check ON sync.warteschlange IS
'ersatzweg (0135): der Posten ist gescheitert, aber seine Daten kamen ueber einen anderen Weg '
'(fn:bestellpositionen → fn:bestellansicht). ladefehler (0136): die Antwort kam, das Laden '
'scheiterte LADEFEHLER_MAX_VERSUCHE mal (Vorgabe 10) — abgebrochen, nicht wiederbelebt, in '
'mart.posten_aufgegeben als endgueltig; die Rohantwort steht in raw.api_antwort (ladefehler).';

-- Dieselben Spalten wie 0070, ladefehler kommt dazu und ist immer endgueltig.
CREATE OR REPLACE VIEW mart.posten_aufgegeben AS
SELECT w.posten_id,
       w.endpunkt,
       m.schluessel                AS marke,
       w.zeitraum_von,
       w.parameter,
       w.versuche,
       w.wiederbelebt,
       w.erledigt_am               AS zuletzt_aufgegeben,
       left(w.letzter_fehler, 200) AS fehler,
       CASE WHEN w.ergebnis = 'ladefehler' OR w.wiederbelebt >= 3 THEN 'endgueltig'
            ELSE 'wird erneut versucht' END AS zustand,
       EXISTS (SELECT 1 FROM sync.aufgabe a
                WHERE a.endpunkt = w.endpunkt AND a.status = 'ok'
                  AND a.beendet_am > now() - interval '24 hours') AS quelle_antwortet
  FROM sync.warteschlange w
  LEFT JOIN core.marke m ON m.marke_key = w.marke_key
 WHERE w.ergebnis IN ('aufgegeben', 'ladefehler')
 ORDER BY w.wiederbelebt DESC, w.erledigt_am DESC;

COMMENT ON VIEW mart.posten_aufgegeben IS
'Posten, die der Worker aufgegeben hat. ERWARTUNG: leer, oder nur Zeilen mit
zustand = endgueltig und einer Begruendung, die jemand gelesen hat.

  wird erneut versucht  der naechtliche Lauf holt ihn zurueck, solange
                        quelle_antwortet true ist. Hoechstens dreimal.
  endgueltig            der Vorrat ist aufgebraucht — oder das Laden ist
                        LADEFEHLER_MAX_VERSUCHE mal gescheitert (0136): die
                        Antwort kam, aber sie liess sich nicht nach core
                        schreiben. Die Antwort steht in raw.api_antwort
                        (ladefehler). Das ist ein Baufehler oder Unsinn in der
                        Quelle, und er gehoert geprueft, nicht ignoriert.

DIE 3 STEHT HIER FEST VERDRAHTET UND MUSS ZU config.MAX_WIEDERBELEBUNGEN PASSEN.
Eine Sicht kann keine Umgebungsvariable lesen; eine Einstellungstabelle waere mehr
Bau, als das Problem verdient. Wer MAX_WIEDERBELEBUNGEN aendert, aendert damit still
die Bedeutung dieser Spalte — und die von src/status.ts, das die Umgebung liest.
Deshalb haelt src/config.test.ts den Vorgabewert auf 3 fest: der rote Test fuehrt zu
dieser Zeile. Geaendert wird also beides oder keines.

Am 13.08.2026 standen hier 275 Zeilen, ausnahmslos fn:bestellpositionen mit HTTP 500
aus dem Backfill vom 02. bis 04.08.2026 — und mit ihnen 322 Bestellungen ueber
686.535,93 EUR, die einen Kopf hatten und keine einzige Position. Nach dem ersten Lauf
mit der Wiederbelebung (0070) waren es 0 von 66.966; die Bestellungen ohne Position
sind auf 47 gefallen.

wiederbelebt ist NICHT versuche: versuche zaehlt die Anlaeufe innerhalb eines Lebens
und faengt nach dem Wiederbeleben bei 0 an, wiederbelebt zaehlt die Leben.';


-- ---------------------------------------------------------------------
-- 6. Die Monatssumme sofort, nicht erst nach dem naechsten Lauf
-- ---------------------------------------------------------------------

DO $refresh$
BEGIN
    IF (SELECT ispopulated FROM pg_matviews
         WHERE schemaname = 'mart' AND matviewname = 'finanzweg_monat_basis') THEN
        REFRESH MATERIALIZED VIEW CONCURRENTLY mart.finanzweg_monat_basis;
    END IF;
END $refresh$;
