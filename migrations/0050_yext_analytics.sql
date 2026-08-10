-- =====================================================================
-- 0050 Yext Analytics — woran es liegt, wer geantwortet hat, wer uns findet
--
-- ANLASS (gefragt am 10.08.2026): "Wir importieren von Yext aktuell nur
-- die Bewertung. Allerdings interessiert uns die Klusterung, was denn
-- genau die Themen sind."
--
-- Bis heute beantwortet der Round Table die Frage OB ein Haus abrutscht
-- (core.bewertung_stand) und laesst die Texte daneben stehen, damit ein
-- Mensch das WORAN selbst liest (core.bewertung, Migration 0037). Yext
-- klassifiziert diese Texte aber bereits selbst. Diese Migration holt das
-- Ergebnis dieser Klassifizierung herein -- und drei Bloecke, die bei der
-- Sondierung derselben API daneben lagen.
--
-- Der Befund im Ganzen: docs/yext-analytics-inventar.md.
--
-- ---------------------------------------------------------------------
-- WOHER DIE ZAHLEN KOMMEN -- und warum das ein anderer Weg ist als bisher
--
-- Nicht aus /reviews, sondern aus POST /analytics/reports. Der
-- Unterschied ist nicht die Quelle, sondern die KOERNUNG: /reviews
-- liefert Bewertungen und wir rechnen, /analytics/reports liefert das
-- fertige Aggregat und wir speichern. Ein einziger Aufruf bringt alle 60
-- Betriebe ueber alle Monate (gemessen: 790 Zeilen in einem Aufruf).
--
-- Konsequenz, die man kennen muss: WIR KOENNEN DIESE ZAHLEN NICHT
-- NACHRECHNEN. Bei core.bewertung_stand ist das genauso und dort bewusst
-- so entschieden (0036). Hier gilt derselbe Satz aus demselben Grund --
-- eine geloeschte Bewertung faellt bei Yext sofort aus dem Aggregat, eine
-- selbstgerechnete Kopie liefe langsam auseinander.
--
-- ---------------------------------------------------------------------
-- DIE DREI FALLEN, DIE IN DEN SPALTENKOMMENTAREN WIEDERKEHREN
--
-- 1. DIE THEMEN BEGINNEN IM APRIL 2026. Davor null bis zwei Treffer je
--    Monat im ganzen Konto, ab April 1.201 und mehr. Wer einen
--    Vorjahresvergleich auf Themen baut, bekommt keinen Fehler, sondern
--    eine Kurve, die im April aus dem Nichts anspringt -- und die liest
--    sich als Verschlechterung. Deshalb mart.bewertung_thema_start.
--
-- 2. EINE BEWERTUNG TRAEGT MEHRERE THEMEN. Im Mai 2026 stehen 2.064
--    Themen-Treffer gegen 2.019 Bewertungen. Die Summe ueber die Themen
--    ist NICHT die Zahl der Bewertungen, und ein Anteil, der gegen diese
--    Summe rechnet, ergibt in Summe 100 Prozent und ist trotzdem falsch.
--    Deshalb traegt core.bewertung_antwort.bewertungen die echte Zahl,
--    und mart.bewertung_thema rechnet den Anteil gegen SIE.
--
-- 3. NUR BEWERTUNGEN MIT TEXT bekommen ein Thema. Ein Haus mit vielen
--    Sterne-ohne-Wort-Bewertungen sieht deshalb themenarm aus, ohne es
--    zu sein.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Die Klusterung: welches Thema, wie oft, mit welcher Note
--
-- thema ist Yexts eigene Beschriftung, englisch und unuebersetzt
-- ("Service and Staff", "Speed of Service"). Bewusst nicht eingedeutscht:
-- eine Uebersetzungstabelle waere eine zweite Wahrheit, die beim naechsten
-- neuen Label stillschweigend veraltet. Die Karten beschriften.
--
-- schnitt ist die Durchschnittsnote DER BEWERTUNGEN MIT DIESEM THEMA,
-- nicht eine Bewertung des Themas selbst. "Order 2,50" heisst: wer ueber
-- die Bestellung schrieb, vergab im Schnitt 2,5 Sterne.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.bewertung_thema (
    betrieb_key  integer     NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat        date        NOT NULL,
    thema        text        NOT NULL,
    anzahl       integer     NOT NULL,
    schnitt      numeric(3,2),
    geladen_am   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, thema),
    CONSTRAINT bewertung_thema_monatserster CHECK (monat = date_trunc('month', monat)::date),
    CONSTRAINT bewertung_thema_skala CHECK (schnitt IS NULL OR schnitt BETWEEN 0 AND 5)
);

COMMENT ON TABLE core.bewertung_thema IS
'Yexts eigene Klusterung der Bewertungstexte, je Betrieb, Monat und Thema (Quelle:
POST /analytics/reports, dimensions REVIEW_LABELS x ENTITY_IDS x MONTHS).

ERST AB APRIL 2026 gefuellt -- davor hat Yext nicht klassifiziert. Kein
Vorjahresvergleich vor April 2027.

MEHRFACHVERGABE: eine Bewertung kann mehrere Themen tragen. sum(anzahl) ueber die
Themen eines Monats ist deshalb GROESSER als die Zahl der Bewertungen und taugt nicht
als Nenner. Der Nenner steht in core.bewertung_antwort.bewertungen.';

COMMENT ON COLUMN core.bewertung_thema.thema IS
'Yexts Beschriftung, unuebersetzt: Food, Service and Staff, Speed of Service, Order,
Restaurant Cleanliness. Wer die Regeln dahinter pflegt, ist offen -- sie gelten
kontoweit, auch fuer die Fremdkunden im selben Yext-Konto
(docs/yext-analytics-inventar.md §13).';

COMMENT ON COLUMN core.bewertung_thema.schnitt IS
'Durchschnittsnote der Bewertungen MIT diesem Thema -- keine Note des Themas. Die
Spannweite ueber alle Betriebe lag im Mai-August 2026 zwischen 2,50 (Order) und 4,35
(Food); der Gesamtschnitt betraegt 4,23.';


-- ---------------------------------------------------------------------
-- Antwortverhalten: wie viele Bewertungen, wie viele Antworten, wie schnell
--
-- WARUM DIE BEWERTUNGSZAHL HIER STEHT und nicht nur in bewertung_stand:
-- dort ist sie KUMULIERT (der Stand bis Monatsende), hier ist sie die des
-- MONATS. mart.bewertung_verlauf rechnet den Monatswert bisher aus der
-- Differenz zweier Staende -- das ist richtig, bricht aber bei einer
-- Luecke in der Reihe ab. Yext liefert ihn direkt, und er ist der Nenner
-- fuer Falle 2 oben.
--
-- REAKTION_STUNDEN kommt aus REVIEW_RESPONSE_TIME_REVIEW_TIMESTAMP_BASED
-- und NICHT aus RESPONSE_TIME. Yext fuehrt beide, sie messen
-- Verschiedenes und weichen deutlich ab (Juni 2026: 49,4 gegen 100,5
-- Stunden). Die hier gespeicherte zaehlt ab dem Zeitpunkt der BEWERTUNG,
-- also ab dem, was der Gast erlebt.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.bewertung_antwort (
    betrieb_key       integer     NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat             date        NOT NULL,
    bewertungen       integer     NOT NULL,
    antworten         integer,
    -- 0 bis 1, nicht 0 bis 100: so liefert Yext es, und eine stille
    -- Skalenumrechnung im Import waere genau die Sorte Umrechnung, die
    -- man drei Monate spaeter nicht mehr findet.
    quote             numeric(4,3),
    reaktion_stunden  numeric(10,2),
    -- Bewertungen dieses Monats, die noch auf eine Antwort warten. Ein
    -- Zustand, kein Monatswert -- die Zahl sinkt, wenn jemand nachtraeglich
    -- antwortet, und genau das soll sie.
    offen             integer,
    offen_schlecht    integer,
    geladen_am        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat),
    CONSTRAINT bewertung_antwort_monatserster CHECK (monat = date_trunc('month', monat)::date),
    CONSTRAINT bewertung_antwort_quote CHECK (quote IS NULL OR quote BETWEEN 0 AND 1)
);

COMMENT ON TABLE core.bewertung_antwort IS
'Wie ein Betrieb auf seine Bewertungen reagiert, je Monat (Quelle: Yext Analytics).
Neu am 10.08.2026 -- vorher war nirgends sichtbar, dass einzelne Haeuser gar nicht
antworten (Badischer Hof Ettlingen 0 Prozent bei 54 Bewertungen, Ratskeller Augsburg
1 Prozent bei 125, waehrend andere ueber 90 liegen).

bewertungen ist die Zahl DIESES Monats -- der kumulierte Stand steht in
core.bewertung_stand. Diese Spalte ist der richtige Nenner fuer Themen-Anteile.';

COMMENT ON COLUMN core.bewertung_antwort.quote IS
'0 bis 1, so wie Yext es liefert. Konzernschnitt Juni 2026: 0,91.';

COMMENT ON COLUMN core.bewertung_antwort.reaktion_stunden IS
'Stunden von der BEWERTUNG bis zur Antwort (Yext-Metrik
REVIEW_RESPONSE_TIME_REVIEW_TIMESTAMP_BASED). NICHT dieselbe Zahl wie Yexts
RESPONSE_TIME, die ab einem anderen Zeitpunkt misst -- im Juni 2026 49,4 gegen 100,5
Stunden. Wer die Zahl gegen eine Yext-Oberflaeche haelt, muss wissen, welche dort steht.';

COMMENT ON COLUMN core.bewertung_antwort.offen_schlecht IS
'Bewertungen mit 1 oder 2 Sternen, die noch keine Antwort haben -- die Arbeitsliste.
Ein ZUSTAND, kein Monatswert: die Zahl sinkt, sobald jemand antwortet.';


-- ---------------------------------------------------------------------
-- Notenverteilung -- die robustere Ampel
--
-- Der Stand bewegt sich bei mehreren tausend Bewertungen um Hundertstel;
-- der Anteil der 1-2-Sterne-Faelle reagiert sofort. mart.bewertung_note
-- rechnet ihn aus, die Tabelle haelt die Verteilung.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.bewertung_note (
    betrieb_key  integer     NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat        date        NOT NULL,
    note         smallint    NOT NULL,
    anzahl       integer     NOT NULL,
    geladen_am   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, note),
    CONSTRAINT bewertung_note_monatserster CHECK (monat = date_trunc('month', monat)::date),
    CONSTRAINT bewertung_note_skala CHECK (note BETWEEN 1 AND 5)
);

COMMENT ON TABLE core.bewertung_note IS
'Wie viele 1-, 2-, ... 5-Sterne-Bewertungen ein Betrieb in einem Monat bekam.
Grundlage fuer den Anteil schlechter Bewertungen, der frueher ausschlaegt als der
Schnitt. Portale ohne Sternewertung (Facebook, Foursquare) liefern hier nichts.';


-- ---------------------------------------------------------------------
-- Sichtbarkeit und Pflegezustand der Portaleintraege
--
-- Eine von den Bewertungen UNABHAENGIGE Datenquelle: wie oft ein Betrieb
-- in den Portalen ueberhaupt auftaucht, und wie gut seine Eintraege
-- gepflegt sind.
--
-- ZUR SPALTE IMPRESSIONEN_GOOGLE UND DER FALLE DAHINTER: Yext kennt eine
-- Metrik LISTINGS_IMPRESSIONS, die nicht im Katalog steht, trotzdem
-- angenommen wird und die GOOGLE-Zahl liefert -- nicht die ueber alle
-- Portale. Wer den naheliegenden Namen nimmt, bekommt stillschweigend ein
-- Drittel weniger (Juni 2026: 1.302.862 gegen 1.968.357). Der Importer
-- fragt deshalb ausdruecklich TOTAL_LISTINGS_IMPRESSIONS und
-- GOOGLE_LISTINGS_IMPRESSIONS.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.betrieb_sichtbarkeit (
    betrieb_key           integer     NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat                 date        NOT NULL,
    impressionen_gesamt   bigint,
    impressionen_google   bigint,
    -- Der Median vergleichbarer Betriebe, den Yext selbst mitliefert.
    -- Haeufig 0 -- dann gibt es fuer dieses Haus keinen Vergleich, und das
    -- ist keine Null, sondern eine Leerstelle. Der Importer schreibt
    -- deshalb NULL statt 0.
    benchmark_google      bigint,
    suchen                bigint,
    profilaufrufe         bigint,
    klicks                bigint,
    -- 0 bis 1. Anteil der Portaleintraege, die mit unseren Stammdaten
    -- uebereinstimmen.
    genauigkeit           numeric(4,3),
    eintraege_live        integer,
    eintraege_unavailable integer,
    vorschlaege_offen     integer,
    geladen_am            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat),
    CONSTRAINT betrieb_sichtbarkeit_monatserster CHECK (monat = date_trunc('month', monat)::date),
    CONSTRAINT betrieb_sichtbarkeit_genauigkeit CHECK (genauigkeit IS NULL OR genauigkeit BETWEEN 0 AND 1)
);

COMMENT ON TABLE core.betrieb_sichtbarkeit IS
'Wie sichtbar ein Betrieb in den Portalen ist und wie gepflegt seine Eintraege sind,
je Monat (Quelle: Yext Analytics). Unabhaengig von den Bewertungen -- beantwortet
"finden uns Gaeste ueberhaupt", nicht "was sagen sie".

NICHT TAGESAKTUELL. Die Sichtbarkeitsmetriken hinken bis zu einer Woche hinterher,
waehrend Bewertungs- und Antwortzahlen bis gestern vollstaendig sind. Was wann
vollstaendig ist, steht in core.yext_datenstand -- der laufende Monat ist hier immer
ein Teilmonat und darf nicht gegen einen Vollmonat gehalten werden.';

COMMENT ON COLUMN core.betrieb_sichtbarkeit.impressionen_gesamt IS
'Ueber ALLE Portale (Yext-Metrik TOTAL_LISTINGS_IMPRESSIONS). Nicht zu verwechseln mit
Yexts LISTINGS_IMPRESSIONS -- die steht nicht im Metrik-Katalog, wird trotzdem
angenommen und liefert nur Google.';

COMMENT ON COLUMN core.betrieb_sichtbarkeit.benchmark_google IS
'Median vergleichbarer Betriebe bei Google, von Yext geliefert. NULL heisst: fuer
dieses Haus fuehrt Yext keinen Vergleich (betrifft u. a. alle Enchiladas) -- das ist
eine Leerstelle, keine Null. NICHT ADDIERBAR: die Summe von Medianen ist kein Median.
Nur je Betrieb gegen impressionen_google halten.';

COMMENT ON COLUMN core.betrieb_sichtbarkeit.genauigkeit IS
'Anteil der Portaleintraege, die mit unseren Stammdaten uebereinstimmen (0 bis 1).
Konzern Juni 2026: 0,95; je Betrieb zwischen 0,85 und 1,00.';


-- ---------------------------------------------------------------------
-- Datenstand je Metrik -- damit ein Erhebungsloch kein Trend wird
--
-- Yext liefert fuer angefangene Zeitraeume Zahlen, ohne zu sagen, dass sie
-- unvollstaendig sind. GET /analytics/catalog sagt es je Metrik. Ohne
-- diese Tabelle erklaert irgendwann jemand einen fehlenden Erhebungstag
-- zum Einbruch.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.yext_datenstand (
    metrik            text        NOT NULL PRIMARY KEY,
    vollstaendig_bis  date        NOT NULL,
    geladen_am        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.yext_datenstand IS
'Bis wann Yext eine Metrik als vollstaendig meldet (GET /analytics/catalog). Am
10.08.2026 waren Bewertungs- und Antwortmetriken bis zum 09.08. vollstaendig, die
Sichtbarkeitsmetriken bis zum 02.-07.08., die Google-Suchbegriffe nur bis zum 30.06.';


-- =====================================================================
-- mart — was die Dashboards lesen
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ab wann Themen ueberhaupt erhoben werden
--
-- Eine eigene Sicht und keine Konstante in den Karten: der Starttermin ist
-- eine Eigenschaft der DATEN, und wenn Yext rueckwirkend nachklassifiziert
-- (danach ist gefragt), soll die Beschriftung von selbst mitwandern statt
-- in acht Karten nachgezogen zu werden.
--
-- WARUM NICHT EINFACH min(monat). Weil das die falsche Antwort gibt:
-- im Bestand stehen vier von Hand vergebene Alt-Labels ("5",
-- "5 Sterne AR") mit je EINER Nennung aus Dezember 2024 bis April 2025,
-- danach elf Monate nichts, dann ab April 2026 die systematische
-- Klassifizierung mit 882 Nennungen im ersten Monat. min(monat) meldete
-- Dezember 2024 -- und damit "Vorjahresvergleich moeglich", obwohl der
-- Vergleich gegen eine einzige handvergebene Marke liefe.
--
-- Gesucht ist der Beginn der LUECKENLOSEN Reihe: der aelteste Monat, von
-- dem an bis heute kein Monat fehlt. Die Rechnung dahinter ist der
-- uebliche Griff (Monat minus laufende Nummer ist innerhalb einer
-- ununterbrochenen Reihe konstant) -- ohne Schwellenwert, den irgendwann
-- niemand mehr begruenden koennte.
-- ---------------------------------------------------------------------
CREATE VIEW mart.bewertung_thema_start AS
WITH lauf AS (
    SELECT monat,
           (monat - (row_number() OVER (ORDER BY monat) * interval '1 month'))::date AS anker
      FROM (SELECT DISTINCT monat FROM core.bewertung_thema) m
), letzter AS (
    SELECT anker FROM lauf ORDER BY monat DESC LIMIT 1
), zeitraum AS (
    SELECT min(l.monat) AS ab_monat, max(l.monat) AS bis_monat
      FROM lauf l JOIN letzter x ON x.anker = l.anker
)
SELECT z.ab_monat,
       z.bis_monat,
       (SELECT count(DISTINCT t.thema)::integer FROM core.bewertung_thema t
         WHERE t.monat >= z.ab_monat)                            AS themen,
       (SELECT count(DISTINCT t.betrieb_key)::integer FROM core.bewertung_thema t
         WHERE t.monat >= z.ab_monat)                            AS betriebe,
       (SELECT count(*)::integer FROM core.bewertung_thema t
         WHERE t.monat < z.ab_monat)                             AS zeilen_davor,
       (z.ab_monat > (current_date - interval '13 months')::date) AS zu_kurz_fuer_vorjahr
  FROM zeitraum z;

COMMENT ON VIEW mart.bewertung_thema_start IS
'Seit wann die Themen LUECKENLOS erhoben werden -- am 10.08.2026 seit April 2026.

Bewusst nicht min(monat) ueber die ganze Tabelle: davor stehen vier von Hand vergebene
Alt-Labels mit je einer Nennung (Dezember 2024 bis April 2025), gefolgt von elf leeren
Monaten. zeilen_davor zaehlt sie -- sie sind kein Fehler, aber auch keine Reihe.

zu_kurz_fuer_vorjahr sagt, ob ein Vorjahresvergleich moeglich ist. Die Karten
beschriften sich daraus, statt den Termin fest einzutragen.';


-- ---------------------------------------------------------------------
-- Die Themen je Betrieb und Monat, mit Anteil und Abstand zum Haus
--
-- ZWEI BEZUGSGROESSEN, und beide werden gebraucht:
--
--   anteil       -- wie viele der Bewertungen dieses Monats das Thema
--                   ansprechen. Nenner ist die ECHTE Bewertungszahl aus
--                   core.bewertung_antwort, nicht die Themensumme
--                   (Mehrfachvergabe, siehe Kopf).
--   abstand      -- wie die Note DIESES Themas gegen die Note des Hauses
--                   im selben Monat steht. Das ist die eigentliche
--                   Aussage: "Order 2,5" allein sagt wenig, "Order 1,8
--                   unter dem eigenen Schnitt" sagt, wo man ansetzt.
-- ---------------------------------------------------------------------
CREATE VIEW mart.bewertung_thema AS
WITH haus AS (
    SELECT t.betrieb_key, t.monat,
           sum(t.anzahl * t.schnitt) / nullif(sum(t.anzahl), 0) AS schnitt_themen
      FROM core.bewertung_thema t
     WHERE t.schnitt IS NOT NULL
     GROUP BY t.betrieb_key, t.monat
)
SELECT t.betrieb_key,
       b.name                                   AS betrieb,
       kz.hauptkonzept                          AS konzept,
       t.monat,
       t.thema,
       t.anzahl,
       t.schnitt,
       a.bewertungen                            AS bewertungen_monat,
       CASE WHEN a.bewertungen > 0
            THEN round(100.0 * t.anzahl / a.bewertungen, 1) END  AS anteil,
       round(t.schnitt - h.schnitt_themen, 2)   AS abstand,
       -- Liegt die Zeile in der lueckenlosen Reihe? Die vier Alt-Labels
       -- von Hand (siehe mart.bewertung_thema_start) stehen sonst als
       -- eigene "Themen" in jeder Liste, die nicht nach Monat filtert.
       (t.monat >= (SELECT ab_monat FROM mart.bewertung_thema_start)) AS laufend,
       bs.status                                AS betrieb_status,
       (bs.status = 'operativ')                 AS operativ
  FROM core.bewertung_thema t
  JOIN core.betrieb b                    ON b.betrieb_key  = t.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz    ON kz.betrieb_key = t.betrieb_key
  LEFT JOIN mart.betrieb_status bs       ON bs.betrieb_key = t.betrieb_key
  LEFT JOIN core.bewertung_antwort a     ON a.betrieb_key  = t.betrieb_key AND a.monat = t.monat
  LEFT JOIN haus h                       ON h.betrieb_key  = t.betrieb_key AND h.monat = t.monat;

COMMENT ON VIEW mart.bewertung_thema IS
'Yexts Klusterung der Bewertungstexte je Betrieb, Monat und Thema -- die Antwort auf
"woran liegt es", wenn die Note faellt.

ERST AB APRIL 2026 (siehe mart.bewertung_thema_start). Eine Kurve, die dort anspringt,
ist der Beginn der Erhebung und kein Ereignis.

anteil rechnet gegen die ECHTE Bewertungszahl des Monats, nicht gegen die Summe der
Themen -- eine Bewertung kann mehrere Themen tragen, die Anteile ergeben deshalb
zusammen MEHR als 100 Prozent. Das ist richtig so.

abstand ist die Themennote minus der mengengewichteten Themennote desselben Hauses im
selben Monat. Negativ = dieses Thema zieht das Haus herunter.';

COMMENT ON COLUMN mart.bewertung_thema.anteil IS
'Prozent der Bewertungen des Monats, die dieses Thema ansprechen. Summiert ueber alle
Themen ABSICHTLICH ueber 100 -- Mehrfachvergabe.';


-- ---------------------------------------------------------------------
-- Die Themen ohne Betrieb -- fuer Marke und Konzern
--
-- Eigene Sicht statt einer Gruppierung in der Karte, weil hier eine
-- Entscheidung faellt: der Schnitt ueber Betriebe muss MENGENGEWICHTET
-- sein. Ein Haus mit zwei Nennungen darf nicht so schwer waehlen wie eines
-- mit achtzig; genau dieser Fehler steckt in jedem naiven avg(schnitt).
-- ---------------------------------------------------------------------
CREATE VIEW mart.bewertung_thema_monat AS
SELECT t.monat,
       t.thema,
       kz.hauptkonzept                                       AS konzept,
       count(DISTINCT t.betrieb_key)::integer                AS betriebe,
       sum(t.anzahl)::integer                                AS anzahl,
       round(sum(t.anzahl * t.schnitt)
             / nullif(sum(t.anzahl) FILTER (WHERE t.schnitt IS NOT NULL), 0), 2) AS schnitt
  FROM core.bewertung_thema t
  JOIN mart.betrieb_status bs         ON bs.betrieb_key = t.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = t.betrieb_key
 WHERE bs.status = 'operativ'
   AND t.monat >= (SELECT ab_monat FROM mart.bewertung_thema_start)
 GROUP BY t.monat, t.thema, kz.hauptkonzept;

COMMENT ON VIEW mart.bewertung_thema_monat IS
'Die Themen je Monat und Marke, ueber die operativen Betriebe verdichtet. Der Schnitt
ist MENGENGEWICHTET (Summe der Notenpunkte durch Summe der Nennungen) -- ein Haus mit
zwei Nennungen soll nicht so schwer waehlen wie eines mit achtzig.

Fuer den Konzern ueber alle Marken hinweg noch einmal aggregieren, aber NICHT den
Schnitt mitteln -- dann waere die Gewichtung wieder weg.';


-- ---------------------------------------------------------------------
-- Antwortverhalten, lesbar
-- ---------------------------------------------------------------------
CREATE VIEW mart.bewertung_antwort AS
SELECT a.betrieb_key,
       b.name                                  AS betrieb,
       kz.hauptkonzept                         AS konzept,
       a.monat,
       a.bewertungen,
       a.antworten,
       a.quote,
       round(100 * a.quote, 1)                 AS quote_prozent,
       a.reaktion_stunden,
       round(a.reaktion_stunden / 24.0, 1)     AS reaktion_tage,
       a.offen,
       a.offen_schlecht,
       bs.status                               AS betrieb_status,
       (bs.status = 'operativ')                AS operativ
  FROM core.bewertung_antwort a
  JOIN core.betrieb b                 ON b.betrieb_key  = a.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = a.betrieb_key
  LEFT JOIN mart.betrieb_status bs    ON bs.betrieb_key = a.betrieb_key;

COMMENT ON VIEW mart.bewertung_antwort IS
'Wie ein Betrieb auf Bewertungen reagiert, je Monat. Antwortquote, Reaktionszeit und
die offenen Faelle -- offen_schlecht (1-2 Sterne ohne Antwort) ist die Arbeitsliste,
keine Kennzahl.

reaktion_stunden zaehlt ab der BEWERTUNG, nicht ab dem Zeitpunkt, an dem sie bei Yext
ankam -- die beiden Yext-Metriken dafuer weichen deutlich ab (49,4 gegen 100,5 Stunden
im Juni 2026).';


-- ---------------------------------------------------------------------
-- Sichtbarkeit, mit dem Vergleich als Faktor
--
-- faktor ist der eigentliche Punkt: 3.056 Impressionen sind ohne Massstab
-- keine Aussage, 0,53 mal der Median vergleichbarer Haeuser ist eine.
-- NULL, wo Yext keinen Vergleich fuehrt -- eine 0 stuende sonst fuer
-- "unendlich schlecht" statt fuer "unbekannt".
-- ---------------------------------------------------------------------
CREATE VIEW mart.betrieb_sichtbarkeit AS
SELECT s.betrieb_key,
       b.name                                   AS betrieb,
       kz.hauptkonzept                          AS konzept,
       s.monat,
       s.impressionen_gesamt,
       s.impressionen_google,
       s.benchmark_google,
       CASE WHEN s.benchmark_google > 0
            THEN round(s.impressionen_google::numeric / s.benchmark_google, 2) END AS faktor,
       s.suchen,
       s.profilaufrufe,
       s.klicks,
       s.genauigkeit,
       round(100 * s.genauigkeit, 1)            AS genauigkeit_prozent,
       s.eintraege_live,
       s.eintraege_unavailable,
       s.vorschlaege_offen,
       bs.status                                AS betrieb_status,
       (bs.status = 'operativ')                 AS operativ
  FROM core.betrieb_sichtbarkeit s
  JOIN core.betrieb b                 ON b.betrieb_key  = s.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = s.betrieb_key
  LEFT JOIN mart.betrieb_status bs    ON bs.betrieb_key = s.betrieb_key;

COMMENT ON VIEW mart.betrieb_sichtbarkeit IS
'Wie sichtbar ein Betrieb in den Portalen ist -- Impressionen, Suchen, Profilaufrufe,
Klicks -- und wie gepflegt seine Eintraege sind (genauigkeit).

faktor = impressionen_google geteilt durch den von Yext gelieferten Median
vergleichbarer Betriebe. Unter 1 heisst: dieses Haus wird seltener gesehen als
vergleichbare. NULL heisst, dass Yext fuer dieses Haus keinen Vergleich fuehrt --
das ist eine Leerstelle und kein schlechter Wert.

Der laufende Monat ist IMMER ein Teilmonat und liegt zusaetzlich hinter dem Datenstand
zurueck (core.yext_datenstand). Nicht gegen einen Vollmonat halten.';

COMMENT ON COLUMN mart.betrieb_sichtbarkeit.faktor IS
'Unter 1 = seltener gesehen als vergleichbare Betriebe. Im Juni 2026 lagen die sechs
schwaechsten Haeuser (nach einem geschlossenen) allesamt bei Aposto.';


-- ---------------------------------------------------------------------
-- Notenverteilung und der Anteil, der frueher ausschlaegt
-- ---------------------------------------------------------------------
CREATE VIEW mart.bewertung_note AS
SELECT n.betrieb_key,
       b.name                                          AS betrieb,
       kz.hauptkonzept                                 AS konzept,
       n.monat,
       sum(n.anzahl)::integer                          AS bewertungen,
       sum(n.anzahl) FILTER (WHERE n.note <= 2)::integer AS schlecht,
       sum(n.anzahl) FILTER (WHERE n.note >= 4)::integer AS gut,
       round(100.0 * sum(n.anzahl) FILTER (WHERE n.note <= 2)
             / nullif(sum(n.anzahl), 0), 1)            AS anteil_schlecht,
       round(sum(n.note * n.anzahl)::numeric
             / nullif(sum(n.anzahl), 0), 2)            AS schnitt,
       bs.status                                       AS betrieb_status,
       (bs.status = 'operativ')                        AS operativ
  FROM core.bewertung_note n
  JOIN core.betrieb b                 ON b.betrieb_key  = n.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = n.betrieb_key
  LEFT JOIN mart.betrieb_status bs    ON bs.betrieb_key = n.betrieb_key
 GROUP BY n.betrieb_key, b.name, kz.hauptkonzept, n.monat, bs.status;

COMMENT ON VIEW mart.bewertung_note IS
'Notenverteilung je Betrieb und Monat. anteil_schlecht (1-2 Sterne in Prozent) reagiert
frueher als der Bewertungsstand: bei mehreren tausend Altbewertungen bewegt ein
schlechter Monat den Stand um Hundertstel, den Anteil sofort.

schnitt ist aus der Verteilung gerechnet und deshalb der Monatswert -- nicht der
Stand, den ein Gast auf Google sieht. Der steht in mart.bewertung_verlauf.';
