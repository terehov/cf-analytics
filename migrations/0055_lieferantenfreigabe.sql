-- =====================================================================
-- 0055 Lieferantenfreigabe — was gekauft werden darf, und bei wem
--
-- ANLASS (12.08.2026): die Erhebung "GFGH Q2 2026.xlsx" sollte je Betrieb
-- den Getraenkefachgrosshandel, die Bindung und 79 Produktpreise abfragen.
-- Gemessen am 12.08.2026 ueber die Datei selbst:
--
--   88 Betriebsspalten, 79 Produktzeilen
--   GFGH-Name eingetragen:            14 von 88
--   Preiszellen gefuellt:            607 von 6.952  (8,7 Prozent)
--   Spalten ganz ohne jede Angabe:    44
--
-- Die Erhebung ist als Fragebogen gescheitert. Diese Migration dreht die
-- Richtung um: statt die Betriebe zu fragen, was sie kaufen, wird es aus
-- den Rechnungen abgeleitet. Dafuer fehlt genau ein Stueck — die Aussage,
-- WAS freigegeben ist. Die steht nirgends im System; sie ist eine
-- Einkaufsentscheidung und wird deshalb hier gepflegt und nicht geladen.
--
-- ---------------------------------------------------------------------
-- WAS DIESE MIGRATION NICHT TUT
--
-- Sie klassifiziert keinen einzigen Lieferanten, den der Nutzer nicht
-- benannt hat. Gesetzt sind am 12.08.2026 fuenf konzernweite Freigaben
-- (Distra, Chefs Culinar, CF Gastro, Layer-Chemie, J.J. Darboven) und
-- 13 GFGH-Zeilen aus den ausgefuellten Excel-Spalten, davon 5 mit
-- aufgeloestem Dachnamen. Alles
-- andere bleibt NICHT EINGEORDNET und steht in mart.lieferant_freigabe_stand
-- nach Volumen sortiert zur Pflege.
--
-- Das ist die tragende Entscheidung dieser Migration, und sie hat einen
-- Grund: bei 119 Dachnamen in beiden Quellen wuerde ein Standardwert
-- "nicht freigegeben" auf einen Schlag 112 Firmen zu Fremdeinkauf erklaeren,
-- darunter Brauereien mit Liefervertrag und Winzer. Diese Liste wuerde
-- einmal herumgereicht, und danach glaubt ihr niemand mehr. Drei Zustaende
-- statt zwei ist der ganze Unterschied.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Die konzernweite Freigabe
--
-- Geschluesselt ueber dach_name und damit ueber dieselbe Achse wie
-- mart.kreditor_konzern (0053): der gepflegte Dachname, ersatzweise der
-- normalisierte Verkaeufername. NICHT ueber einen Surrogatschluessel aus
-- core.lieferant — der gilt je FoodNotify-Mandant, und die Freigabe soll
-- auch fuer Rechnungen gelten, die nie durch FoodNotify gelaufen sind.
-- Genau die sind der interessante Fall.
--
-- KEIN Fremdschluessel auf manual.kreditor_gruppe.dach_name: der Dachname
-- dort ist kein Schluessel, sondern ein Zielwert (mehrere Schreibweisen
-- zeigen auf denselben). Eine Freigabe darf ausserdem VOR der ersten
-- Rechnung dieses Lieferanten stehen.
-- ---------------------------------------------------------------------
CREATE TABLE manual.lieferant_freigabe (
    dach_name    text        PRIMARY KEY,
    warengruppe  text        NOT NULL,
    freigegeben  boolean     NOT NULL,
    gilt_ab      date,
    quelle       text        NOT NULL,
    notiz        text,
    gepflegt_am  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE manual.lieferant_freigabe IS
'Welche Lieferanten konzernweit freigegeben sind — die Einkaufsentscheidung, die in
keinem Quellsystem steht. Stand 12.08.2026 vom Nutzer benannt: Food ueber Distra,
Chefs Culinar und CF Gastro, Hygiene ueber Layer-Chemie, Kaffee und Tee ueber
J.J. Darboven.

DIE ABWESENHEIT EINER ZEILE HEISST "NICHT EINGEORDNET" UND NIEMALS "NICHT FREIGEGEBEN".
Beide Sichten dieser Migration halten die drei Zustaende auseinander. Wer sie zu zweien
zusammenzieht, erklaert 112 von 119 Firmen zu Fremdeinkauf, darunter Brauereien mit Liefervertrag
(Dinkelacker in Stuttgart, Hoepfner in Karlsruhe, Auerbraeu in Rosenheim) und ein Dutzend
Winzer. Die Arbeitsliste ist mart.lieferant_freigabe_stand, nach Volumen sortiert.

GETRAENKE STEHEN HIER NICHT. Der Getraenkefachgrosshandel ist JE BETRIEB ein anderer und
gehoert nach manual.gfgh_betrieb; konzernweit ist ein GFGH weder freigegeben noch
verboten. Eine Zeile mit warengruppe = ''getraenke'' waere fast immer falsch — der CHECK
weiter unten laesst sie deshalb nicht zu.';

COMMENT ON COLUMN manual.lieferant_freigabe.dach_name IS
'Dieselbe Achse wie mart.kreditor_konzern.lieferant: der Dachname aus
manual.kreditor_gruppe, ersatzweise core.kreditor_name_norm(Verkaeufername). Wer hier
einen Namen eintraegt, der in manual.kreditor_gruppe kein Ziel ist, trifft nichts —
mart.lieferant_freigabe_stand weist das als trifft_nichts aus.';
COMMENT ON COLUMN manual.lieferant_freigabe.freigegeben IS
'false ist eine AUSDRUECKLICHE Sperre und etwas anderes als eine fehlende Zeile. Fuer
"haben wir noch nicht angesehen" wird KEINE Zeile angelegt.';
COMMENT ON COLUMN manual.lieferant_freigabe.gilt_ab IS
'NULL heisst "seit jeher". Gesetzt bei einem Lieferantenwechsel, damit ein Bestand von
2022 nicht rueckwirkend zu Fremdeinkauf wird. mart.fremdeinkauf wertet die Spalte aus.';
COMMENT ON COLUMN manual.lieferant_freigabe.quelle IS
'Wer das entschieden hat und wann. Freier Text, aber bitte mit Datum — eine Freigabe ohne
Herkunft ist in sechs Monaten nicht mehr verteidigbar.';

ALTER TABLE manual.lieferant_freigabe
  ADD CONSTRAINT lieferant_freigabe_warengruppe_ck
  CHECK (warengruppe IN ('food', 'nonfood', 'kaffee_tee', 'sonstiges'));

-- Kein 'getraenke' in der Aufzaehlung, und das ist der Zweck des CHECK:
-- die Getraenkefreigabe ist je Betrieb verschieden und hat ihre eigene
-- Tabelle. Ohne diese Sperre landet der erste GFGH hier, gilt damit
-- konzernweit, und in Aalen ist der Mainzer Haendler ploetzlich freigegeben.


-- ---------------------------------------------------------------------
-- Der Getraenkefachgrosshandel — je Betrieb
--
-- Eine Zeile je Betrieb, nicht je Betrieb und Lieferant: die Erhebung
-- fragt nach EINEM GFGH. Wo zwei genannt sind ("Dinkelacker ja / GLH
-- nein"), steht der Rohtext in roh_eintrag und dach_name bleibt NULL —
-- lieber unaufgeloest als halb aufgeloest.
--
-- roh_eintrag und dach_name STEHEN NEBENEINANDER und nicht
-- uebereinander. Der Rohtext ist das, was der Betrieb gesagt hat; der
-- Dachname ist unsere Deutung davon. Wird die Deutung spaeter besser,
-- bleibt die Aussage des Betriebs unveraendert daneben stehen. Dieselbe
-- Trennung wie bei core.buchungsbeleg.netto_split_roh (0053).
-- ---------------------------------------------------------------------
CREATE TABLE manual.gfgh_betrieb (
    betrieb_key  integer     PRIMARY KEY REFERENCES core.betrieb(betrieb_key),
    dach_name    text,
    roh_eintrag  text,
    gebunden     boolean,
    verraeumt    boolean,
    gilt_ab      date,
    quelle       text        NOT NULL,
    notiz        text,
    gepflegt_am  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE manual.gfgh_betrieb IS
'Der Getraenkefachgrosshandel je Betrieb, aus der Erhebung "GFGH Q2 2026.xlsx".
GEFUELLT SIND 13 VON 141, davon 5 mit aufgeloestem Dachnamen — das ist keine Luecke im
Schema, sondern der Ruecklauf. Die Excel hatte 88 Spalten, 14 trugen einen Namen, einer
davon ("Carls Brauhaus") zeigt auf keinen Betrieb in core.betrieb. Alles Uebrige ist
offen und ueber mart.lieferant_freigabe_stand aus den Rechnungen nachziehbar.

WOFUER DAS DA IST: ein Getraenkehaendler ist konzernweit weder erlaubt noch verboten.
Erst diese Zeile sagt, WER das Haus beliefern darf.

EIN BEFUND BRAUCHT BEIDE SEITEN: hier einen aufgeloesten dach_name, und den liefernden
Haendler in manual.gfgh_haendler. Fehlt eine davon, steht die Zeile als
"nicht eingeordnet" da und nicht als Fremdeinkauf. Beispiel Aposto Aalen: das Haus nennt
"Getraenke Keller", der Name ist aber nicht aufgeloest — solange das so bleibt, kann fuer
Aalen kein Getraenke-Befund entstehen, gleich wer dorthin liefert.';

COMMENT ON COLUMN manual.gfgh_betrieb.dach_name IS
'Unsere Deutung des Rohtexts, auf derselben Achse wie manual.lieferant_freigabe.dach_name.
NULL heisst: nicht aufloesbar oder mehrdeutig, und das ist ein zulaessiger Endzustand.
mart.fremdeinkauf behandelt eine solche Zeile wie "kein GFGH bekannt" — sie behauptet
nichts, wo nichts feststeht.';
COMMENT ON COLUMN manual.gfgh_betrieb.roh_eintrag IS
'Der Zellinhalt der Excel VERBATIM, mitsamt "Dinkelacker ja/ GLH nein" und
"Getraenke Staude / Team Bev.". Er wird nie ueberschrieben. Wer die Aufloesung
verbessert, aendert dach_name und laesst diese Spalte in Ruhe.';
COMMENT ON COLUMN manual.gfgh_betrieb.gebunden IS
'Aus der Zeile "Bist du am GFGH gebunden?". DREIWERTIG MIT ABSICHT: NULL heisst
"nicht beantwortet", und das ist bei dieser Erhebung der haeufigste Fall — 44 der 88
Spalten haben zu dieser Frage gar nichts gesagt. Ein DEFAULT false haette daraus
"nicht gebunden" gemacht und die Verhandlungsposition genau falsch herum dargestellt.';
COMMENT ON COLUMN manual.gfgh_betrieb.verraeumt IS
'Aus der Zeile "verraeumt der GFGH?". Dieselbe Dreiwertigkeit, derselbe Grund.';


-- =====================================================================
-- SAAT
--
-- Alles hier ist BENANNT und nichts abgeleitet: die fuenf Freigaben hat
-- der Nutzer am 12.08.2026 genannt, die 13 GFGH-Zeilen stehen in der Excel.
-- Die Schreibweisen darunter sind gemessen — sie stammen aus
-- SELECT DISTINCT lieferant FROM mart.einkauf_beleg und nicht aus einer
-- Vermutung darueber, wie eine Firma heissen koennte.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Namensvarianten auf den Dachnamen
--
-- Der Schluessel wird NICHT von Hand geschrieben, sondern von
-- core.kreditor_name_norm() gerechnet. Ein von Hand normalisierter
-- Schluessel weicht beim ersten Umlaut ab und trifft dann nichts — und
-- eine Zuordnung, die nichts trifft, meldet sich nicht.
--
-- ZUSAMMENGEFUEHRT WIRD NUR, WO ES EINE FIRMA IST. "Distra Aposto" und
-- "Distra GmbH" sind FoodNotify-Mandantennamen desselben Lieferanten —
-- die vier Distra-Zeilen sind kein Namenschaos, sondern vier Mandanten.
-- "Trinkkontor" und "Trinkkartell" stehen deshalb NICHT hier: das sind
-- zwei Firmen, und der Anfangsbuchstabe entscheidet das nicht.
-- ---------------------------------------------------------------------
INSERT INTO manual.kreditor_gruppe (name_norm, dach_name, notiz)
SELECT core.kreditor_name_norm(v.roh), v.dach, v.notiz
  FROM (VALUES
    -- Vier FoodNotify-Mandanten, ein Lieferant.
    ('DISTRA Enchilada_Coyacan',        'Distra',                      'FoodNotify-Mandant Enchilada/Coyacan'),
    ('Distra Aposto',                   'Distra',                      'FoodNotify-Mandant Aposto'),
    ('Distra GmbH',                     'Distra',                      'FoodNotify-Mandant Wilma Wunder'),
    ('Distra_Deutsche',                 'Distra',                      'FoodNotify-Mandant Deutsche Konzepte'),
    ('CHEFS CULINAR',                   'Chefs Culinar',               NULL),
    ('CF Gastro',                       'CF Gastro',                   NULL),
    ('Layer-Chemie',                    'Layer-Chemie',                NULL),
    ('J.J. Darboven',                   'J.J. Darboven',               NULL),
    -- Zwei Schluessel, drei Schreibweisen: "WIGEM" und "Wigem" faltet
    -- core.kreditor_name_norm() bereits zu einem, deshalb steht nur einer hier.
    ('WIGEM Getränke GmbH',             'WIGEM Getränke',              NULL),
    ('WIGEM',                           'WIGEM Getränke',              NULL),
    -- Abkuerzung und ausgeschriebener Name.
    ('GLH',                             'GLH Getränke Logistik Heilbronn', NULL),
    ('GLH Getränke Logistik Heilbronn', 'GLH Getränke Logistik Heilbronn', NULL),
    -- Zwei Schluessel: die Fassung mit Bindestrich und die ohne fallen auf
    -- denselben, die mit "GmbH" nicht — die Normalisierung entfernt
    -- ausdruecklich keine Rechtsformen (Begruendung an der Funktion, 0053).
    ('FFD - Frisch Fruchtig Delp',      'FFD Frisch Fruchtig Delp',    NULL),
    ('FFD Frisch Fruchtig Delp GmbH',   'FFD Frisch Fruchtig Delp',    NULL),
    ('Firma Pentz GmbH',                'Pentz',                       NULL),
    ('Pentz',                           'Pentz',                       NULL),
    -- Zwei Niederlassungen, eine Firma. Falls das nicht stimmt: hier trennen.
    ('Splendid Drinks (Chemnitz)',      'Splendid Drinks',             'Niederlassung Chemnitz'),
    ('Splendid Drinks - Leipzig',       'Splendid Drinks',             'Niederlassung Leipzig')
  ) AS v(roh, dach, notiz)
ON CONFLICT (name_norm) DO NOTHING;

-- ON CONFLICT DO NOTHING und nicht DO UPDATE: falls in der Zwischenzeit
-- jemand von Hand gepflegt hat, gewinnt die Handarbeit. Diese Migration
-- ist ein Startbestand, keine Autoritaet.
--
-- NICHT ZUSAMMENGEFUEHRT, obwohl es naheliegt:
--   "Weingut Achim Hochthurn" / "Hochthurn"  — vermutlich dieselbe Firma,
--       aber "Hochthurn" allein koennte auch ein zweiter Betrieb sein.
--   "Andreas Brummund Wein, Die WeinWerkstatt" / "... die Weinwerkstatt"
--       — braucht keine Zeile, core.kreditor_name_norm() faltet die
--       Grossschreibung ohnehin und macht daraus einen Schluessel.


INSERT INTO manual.lieferant_freigabe (dach_name, warengruppe, freigegeben, quelle, notiz) VALUES
  ('Distra',        'food',       true, 'Nutzer 12.08.2026', NULL),
  ('Chefs Culinar', 'food',       true, 'Nutzer 12.08.2026', NULL),
  ('CF Gastro',     'food',       true, 'Nutzer 12.08.2026', NULL),
  ('Layer-Chemie',  'nonfood',    true, 'Nutzer 12.08.2026', 'Hygiene'),
  ('J.J. Darboven', 'kaffee_tee', true, 'Nutzer 12.08.2026', 'Kaffee und Tee')
ON CONFLICT (dach_name) DO NOTHING;


-- ---------------------------------------------------------------------
-- Die dreizehn ausgefuellten GFGH-Spalten
--
-- Der Betrieb wird ueber core.betrieb.name aufgeloest und NICHT ueber
-- eine hier hineingeschriebene Schluesselzahl. Der Grund ist die
-- Fehlerart: eine Zahl, die auf den falschen Betrieb zeigt, laedt
-- klaglos.
--
-- DESHALB LEFT JOIN UND NICHT JOIN, und das ist kein Schoenheitsfehler.
-- Hier stand zuerst ein INNER JOIN mit genau der Begruendung, ein nicht
-- mehr existierender Name breche "am NOT NULL des Primaerschluessels laut
-- ab". Das war falsch: ein INNER JOIN laesst die Zeile still fallen.
-- Nachgemessen am 12.08.2026 mit einem absichtlich verfaelschten Namen —
-- 14 VALUES-Zeilen, 13 Treffer, keine Meldung. Die einzige Absicherung,
-- auf die sich diese Saat beruft, existierte nicht.
-- Mit LEFT JOIN liefert ein unbekannter Name NULL, und NULL bricht am
-- NOT NULL des Primaerschluessels tatsaechlich ab. Der Kommentar
-- beschreibt jetzt, was der Code tut.
--
-- EINER DER VIERZEHN EXCEL-EINTRAEGE FEHLT HIER, und das ist ein Befund
-- und kein Versehen:
--
--   "Carls Brauhaus"  (GFGH "Dinkelacker ja/ GLH nein") — steht in der
--       Erhebung, existiert aber in core.betrieb nicht. Entweder fehlt
--       der Betrieb in LINA, oder die Erhebung fragt jemanden ab, der
--       nicht zum Bestand gehoert. Das gehoert geklaert, nicht geraten.
--
-- Der zweite Zweifelsfall ist ausgeraeumt: "Wilma Wunder Markt Mainz" der
-- Erhebung ist "Gastronomie am Markt Mainz GmbH", vom Nutzer am
-- 12.08.2026 bestaetigt. Die Zeile steht jetzt oben in der Saat und nicht
-- mehr als Vorschlag daneben.
-- ---------------------------------------------------------------------
INSERT INTO manual.gfgh_betrieb (betrieb_key, dach_name, roh_eintrag, gebunden, verraeumt, quelle)
SELECT b.betrieb_key, v.dach, v.roh, v.gebunden, v.verraeumt, 'GFGH Q2 2026.xlsx'
  FROM (VALUES
    ('Aposto Aalen GmbH',                 NULL,                              'Getränke Keller',                           false, false),
    ('Aposto Mainz GmbH',                 'WIGEM Getränke',                  'Wigem GmbH',                                true,  true),
    ('Enchilada Hannover GmbH',           NULL,                              'Hermann Wecken Getränke GmbH',              false, true),
    ('Enchilada Kempten GmbH',            NULL,                              'Allgäuer Getränkeservice & C+C Oberallgäu', true,  false),
    -- Zwei Namen in einer Zelle: nicht aufloesbar, dach_name bleibt NULL.
    ('Enchilada Leipzig GmbH',            NULL,                              'Getränke Staude / Team Bev.',               false, false),
    ('Enchilada Nürnberg GmbH',           NULL,                              'Trinkkartell/Tucher',                       false, false),
    ('Ratskeller Saarbrücken GmbH',       NULL,                              'Getränke Express',                          false, true),
    ('Wilma Wunder Ballplatz Mainz GmbH', 'WIGEM Getränke',                  'WIGEM Getränke',                            false, true),
    -- "Wilma Wunder Markt Mainz" der Erhebung. Die Zuordnung auf diesen
    -- Betrieb hat der Nutzer am 12.08.2026 ausdruecklich bestaetigt; sie
    -- stand vorher nur als Vorschlag auskommentiert hier.
    ('Gastronomie am Markt Mainz GmbH',   'WIGEM Getränke',                  'WIGEM Getränke',                            false, true),
    ('Wilma Wunder Dresden GmbH',         NULL,                              'Hubauer Getränkefachgrosshandel',           false, true),
    ('Wilma Wunder Recklinghausen GmbH',  NULL,                              'Getränke Weidlich',                         false, true),
    ('Wilma Wunder Stuttgart GmbH',       'GLH Getränke Logistik Heilbronn', 'GLH',                                       false, true),
    ('Wirtshaus Lautenschlager GmbH',     'GLH Getränke Logistik Heilbronn', 'GLH Heilbronn',                             true,  true)
  ) AS v(betrieb, dach, roh, gebunden, verraeumt)
  LEFT JOIN core.betrieb b ON b.name = v.betrieb
ON CONFLICT (betrieb_key) DO NOTHING;

-- Die ACHT Betriebe, deren dach_name oben NULL ist, haben einen Haendler
-- genannt, den wir nicht zweifelsfrei auf einen Dachnamen abbilden konnten
-- — teils weil zwei Namen in einer Zelle stehen, teils weil der Haendler
-- in FoodNotify unter anderer Schreibweise gefuehrt wird. Fuenf Zeilen
-- tragen einen Dachnamen, acht nicht; nachgezaehlt am 12.08.2026.
-- Wie der Haendler wirklich heisst, sagt der erste Belegarchiv-Abzug —
-- dort steht der Name so, wie er auf der Rechnung steht.


-- ---------------------------------------------------------------------
-- Wer ueberhaupt ein Getraenkefachgrosshandel IST
--
-- Getrennt von der Frage, wer bei ihm kaufen darf. Diese Trennung ist der
-- Kern und wurde beim ersten Bau uebersehen.
--
-- Zuerst leitete mart.fremdeinkauf die GFGH-Eigenschaft daraus ab, ob
-- IRGENDEIN Betrieb denselben Lieferanten als seinen GFGH gepflegt hatte.
-- Das hatte zwei Wirkungen, beide falsch: die Einordnung eines Betriebs
-- hing an der Pflegearbeit eines FREMDEN Betriebs und kippte rueckwirkend,
-- sobald dort jemand etwas nachtrug. Und der im Tabellenkommentar von
-- manual.gfgh_betrieb genannte Beispielfall — "WIGEM liefert nach Aalen" —
-- konnte nie ein Befund werden, weil Aalens eigener Eintrag unaufgeloest
-- ist. Nachgemessen am 12.08.2026: 0 von 9.078 Zeilen trugen
-- 'nicht freigegeben'.
--
-- Deshalb eine eigene Liste. Sie beantwortet nur "ist ein GFGH", nie
-- "darf beliefern"; das Duerfen steht je Betrieb in manual.gfgh_betrieb.
-- ---------------------------------------------------------------------
CREATE TABLE manual.gfgh_haendler (
    dach_name   text PRIMARY KEY,
    notiz       text,
    gepflegt_am timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE manual.gfgh_haendler IS
'Die Lieferanten, die ein Getraenkefachgrosshandel SIND — unabhaengig davon, wer bei ihnen
kaufen darf. Nur so kann mart.fremdeinkauf "liefert Getraenke an ein Haus mit anderem GFGH"
erkennen, ohne die Einordnung eines Betriebs von der Pflegearbeit eines anderen abhaengig
zu machen.
GESAT WIRD NUR, WAS BELEGT IST: die Dachnamen, die in manual.gfgh_betrieb als GFGH eines
Hauses stehen. Das sind am 12.08.2026 ZWEI (WIGEM Getraenke, GLH Getraenke Logistik
Heilbronn) aus fuenf Zeilen — drei Haeuser nennen WIGEM, zwei GLH. Zwei Haendler sind eine
duenne Grundlage; jeder weitere Eintrag ist Pflege. Ein Name allein entscheidet es
nicht — "Getraenke Keller" klingt nach GFGH und koennte ein Einzelhandel sein; dieselbe
Regel wie bei manual.kreditor_gruppe.
SOLANGE DIESE LISTE DUENN IST, IST DIE VERDACHTSLISTE KURZ. Das ist kein Fehler der Sicht,
sondern der Stand der Pflege — mart.lieferant_freigabe_stand zeigt, was fehlt.';

INSERT INTO manual.gfgh_haendler (dach_name, notiz)
SELECT DISTINCT dach_name, 'aus manual.gfgh_betrieb, Erhebung GFGH Q2 2026'
  FROM manual.gfgh_betrieb
 WHERE dach_name IS NOT NULL
ON CONFLICT (dach_name) DO NOTHING;


-- =====================================================================
-- SICHTEN
--
-- mart.fremdeinkauf traegt betrieb_status und operativ und filtert NICHT
-- selbst (Falle 12). Keine gruppiert nach einem Klarnamen (Falle 13).
--
-- mart.lieferant_freigabe_stand HAT KEINE BETRIEBSACHSE — eine Zeile ist
-- ein Lieferant, kein Betrieb, und betrieb_status waere dort sinnlos.
-- Falle 12 trifft sie trotzdem, nur anders: ihre Volumina enthalten
-- geschlossene und verwaltende Haeuser mit, nachgemessen am 12.08.2026
-- 3.385.426 EUR oder 9,7 Prozent. Deshalb steht neben jeder Summe die
-- auf operative Betriebe eingeschraenkte Fassung. Der frueher hier
-- stehende Satz "Beide tragen betrieb_status und operativ" war schlicht
-- falsch und hat die Falle zugedeckt, die er benennen sollte.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Die Arbeitsliste
--
-- Nach Volumen sortiert, damit die teuersten Lieferanten zuerst
-- eingeordnet werden — dieselbe Bauart wie mart.sachkonto_fehlend (0053),
-- MITSAMT dem ORDER BY. Das fehlte zuerst, waehrend der Kommentar
-- "nach Volumen sortiert" behauptete.
-- Sie zeigt AUCH die bereits eingeordneten, weil sonst nicht sichtbar
-- ist, ob eine Freigabe ins Leere zeigt.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.lieferant_freigabe_stand AS
WITH fn AS (
  SELECT coalesce(g.dach_name, core.kreditor_name_norm(l.name)) AS dach_name,
         count(DISTINCT core.kreditor_name_norm(l.name))        AS schreibweisen,
         count(DISTINCT k.betrieb_key)                          AS betriebe,
         count(DISTINCT b.bestellung_key)                       AS belege,
         sum(b.summe)                                           AS netto,
         sum(b.summe) FILTER (WHERE st.status = 'operativ')     AS netto_operativ,
         sum(b.summe) FILTER (WHERE k.betrieb_key IS NULL)      AS netto_ohne_betrieb,
         min(b.bestellt_am)::date                               AS erster,
         max(b.bestellt_am)::date                               AS letzter
    FROM core.bestellung b
    JOIN core.lieferant   l ON l.lieferant_key = b.lieferant_key
    JOIN core.kostenstelle k USING (kostenstelle_key)
    LEFT JOIN mart.betrieb_status st ON st.betrieb_key = k.betrieb_key
    LEFT JOIN manual.kreditor_gruppe g
           ON g.name_norm = core.kreditor_name_norm(l.name)
   WHERE b.status IS DISTINCT FROM 'canceled'
     AND b.bestellt_am IS NOT NULL
     AND core.kreditor_name_norm(l.name) IS NOT NULL
   GROUP BY coalesce(g.dach_name, core.kreditor_name_norm(l.name))
), beleg AS (
  SELECT coalesce(g.dach_name, core.kreditor_name_norm(bl.verkaeufer_name)) AS dach_name,
         count(DISTINCT core.kreditor_name_norm(bl.verkaeufer_name))        AS schreibweisen,
         count(DISTINCT bl.betrieb_key)                                     AS betriebe,
         count(*)                                                           AS belege,
         sum(bl.netto)                                                      AS netto,
         sum(bl.netto) FILTER (WHERE st.status = 'operativ')                AS netto_operativ,
         min(bl.beleg_datum)                                                AS erster,
         max(bl.beleg_datum)                                                AS letzter
    FROM core.buchungsbeleg bl
    LEFT JOIN mart.betrieb_status st ON st.betrieb_key = bl.betrieb_key
    LEFT JOIN manual.kreditor_gruppe g
           ON g.name_norm = core.kreditor_name_norm(bl.verkaeufer_name)
   WHERE bl.typ_id = '1'
     AND bl.beleg_datum IS NOT NULL
     AND core.kreditor_name_norm(bl.verkaeufer_name) IS NOT NULL
   GROUP BY coalesce(g.dach_name, core.kreditor_name_norm(bl.verkaeufer_name))
), achse AS (
  SELECT dach_name FROM fn
  UNION
  SELECT dach_name FROM beleg
  UNION
  SELECT dach_name FROM manual.lieferant_freigabe
  UNION
  SELECT dach_name FROM manual.gfgh_betrieb WHERE dach_name IS NOT NULL
)
SELECT a.dach_name,
       CASE WHEN f.freigegeben IS TRUE  THEN 'freigegeben'
            WHEN f.freigegeben IS FALSE THEN 'gesperrt'
            WHEN gf.betriebe > 0        THEN 'GFGH je Betrieb'
            ELSE 'nicht eingeordnet'
       END                                          AS einordnung,
       coalesce(f.warengruppe,
                CASE WHEN h.dach_name IS NOT NULL THEN 'getraenke' END)
                                                    AS warengruppe,
       (h.dach_name IS NOT NULL)                    AS ist_gfgh,
       gf.betriebe                                  AS gfgh_fuer_betriebe,
       (fn.dach_name IS NULL AND beleg.dach_name IS NULL) AS trifft_nichts,
       coalesce(fn.schreibweisen, 0)                AS fn_schreibweisen,
       coalesce(fn.betriebe, 0)                     AS fn_betriebe,
       fn.netto                                     AS fn_netto,
       fn.netto_operativ                            AS fn_netto_operativ,
       fn.netto_ohne_betrieb                        AS fn_netto_ohne_betrieb,
       fn.letzter                                   AS fn_letzter_beleg,
       coalesce(beleg.schreibweisen, 0)             AS beleg_schreibweisen,
       coalesce(beleg.betriebe, 0)                  AS beleg_betriebe,
       beleg.netto                                  AS beleg_netto,
       beleg.netto_operativ                         AS beleg_netto_operativ,
       beleg.letzter                                AS beleg_letzter_beleg
  FROM achse a
  LEFT JOIN fn                        ON fn.dach_name    = a.dach_name
  LEFT JOIN beleg                     ON beleg.dach_name = a.dach_name
  LEFT JOIN manual.lieferant_freigabe f ON f.dach_name   = a.dach_name
  LEFT JOIN manual.gfgh_haendler      h ON h.dach_name   = a.dach_name
  LEFT JOIN LATERAL (
         SELECT count(*) AS betriebe
           FROM manual.gfgh_betrieb gb
          WHERE gb.dach_name = a.dach_name
       ) gf ON true
 ORDER BY greatest(coalesce(fn.netto, 0), coalesce(beleg.netto, 0)) DESC;

COMMENT ON VIEW mart.lieferant_freigabe_stand IS
'Die Arbeitsliste zur Lieferantenfreigabe: jeder Lieferant beider Quellen mit Volumen und
Einordnungsstand, absteigend nach dem groesseren der beiden Volumina. Bauart wie
mart.sachkonto_fehlend (0053).
STAND 12.08.2026: 119 Dachnamen, davon 112 nicht eingeordnet. Das ist die offene Arbeit.

VIER ZUSTAENDE in der Spalte einordnung: freigegeben, gesperrt, "GFGH je Betrieb"
(steht in manual.gfgh_betrieb und ist damit fuer bestimmte Haeuser erlaubt) und
"nicht eingeordnet". Der letzte ist KEIN Fremdeinkauf, sondern offene Pflege.

DIESE SICHT HAT KEINE BETRIEBSACHSE — eine Zeile ist ein Lieferant. betrieb_status waere
hier sinnlos, Falle 12 trifft sie aber trotzdem: fn_netto enthaelt geschlossene und
verwaltende Haeuser mit, nachgemessen am 12.08.2026 3.385.426 EUR oder 9,7 Prozent.
Deshalb steht neben jeder Summe fn_netto_operativ beziehungsweise beleg_netto_operativ.
Wer eine Zahl weitergibt, sagt dazu, welche der beiden er genommen hat.

fn_netto_ohne_betrieb IST DIE BRUECKE ZU mart.fremdeinkauf. Dort ist der Betrieb ein
Pflichtjoin, hier nicht — 25 der 152 Kostenstellen haben keinen betrieb_key, und ihr
Volumen von 1.127.133 EUR erscheint deshalb nur in dieser Sicht. Ohne diese Spalte nennen
zwei Sichten derselben Migration fuer denselben Bestand verschiedene Summen (35.894.104
gegen 34.766.971 EUR) und niemand findet den Grund.

trifft_nichts = true heisst: der Dachname steht in einer Pflegetabelle, hat aber keinen
einzigen Beleg. Entweder ist der Name falsch geschrieben, oder der Lieferant hat nie
geliefert. Beides gehoert angesehen, bevor jemand der Freigabeliste vertraut.

fn_netto und beleg_netto DUERFEN NICHT ADDIERT WERDEN. Dieselbe Rechnung steht in beiden,
wenn sie ueber FoodNotify bestellt und in LINA gebucht wurde. Die beiden Spalten stehen
nebeneinander, damit ihr Abstand sichtbar ist — er ist die eigentliche Aussage.';


-- ---------------------------------------------------------------------
-- Der Fremdeinkauf
--
-- Die Sicht, um die es geht. Sie ENTSCHEIDET NICHT und filtert nicht;
-- sie stellt je Betrieb, Monat und Lieferant die Einordnung daneben.
-- Wer nur die Fremdeinkaeufe will, filtert auf
-- einordnung = 'nicht freigegeben'.
--
-- ZWEI QUELLEN NEBENEINANDER, NICHT VERRECHNET. Die Spalte quelle sagt,
-- woher eine Zeile kommt. Ueber sie zu summieren zaehlt jede
-- FoodNotify-Bestellung doppelt, die auch als Rechnung gebucht wurde —
-- also fast alle. Dieselbe Regel wie in mart.wareneinsatz_quellen (0053),
-- und aus demselben Grund: eine Sicht, die zwei Quellen addiert, sieht
-- aus wie eine Antwort.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.fremdeinkauf AS
WITH zeilen AS (
  SELECT 'foodnotify'::text                            AS quelle,
         k.betrieb_key,
         date_trunc('month', b.bestellt_am)::date      AS monat,
         coalesce(g.dach_name, core.kreditor_name_norm(l.name)) AS dach_name,
         l.name                                        AS name_quelle,
         k.art                                         AS bereich,
         count(DISTINCT b.bestellung_key)              AS belege,
         sum(b.summe)                                  AS netto
    FROM core.bestellung b
    JOIN core.lieferant   l ON l.lieferant_key = b.lieferant_key
    JOIN core.kostenstelle k USING (kostenstelle_key)
    LEFT JOIN manual.kreditor_gruppe g
           ON g.name_norm = core.kreditor_name_norm(l.name)
   WHERE b.status IS DISTINCT FROM 'canceled'
     AND b.bestellt_am IS NOT NULL
     AND k.betrieb_key IS NOT NULL
     AND core.kreditor_name_norm(l.name) IS NOT NULL
   GROUP BY k.betrieb_key, date_trunc('month', b.bestellt_am),
            coalesce(g.dach_name, core.kreditor_name_norm(l.name)), l.name, k.art
  UNION ALL
  SELECT 'belegarchiv',
         bl.betrieb_key,
         date_trunc('month', bl.beleg_datum)::date,
         coalesce(g.dach_name, core.kreditor_name_norm(bl.verkaeufer_name)),
         bl.verkaeufer_name,
         CASE WHEN bl.zuordnung_fibu = 1 THEN 'bar'
              WHEN bl.zuordnung_fibu = 2 THEN 'kueche'
              WHEN bl.zuordnung_fibu = 0 THEN 'sonstige'
              ELSE NULL
         END,
         count(*),
         sum(bl.netto)
    FROM core.buchungsbeleg bl
    LEFT JOIN manual.kreditor_gruppe g
           ON g.name_norm = core.kreditor_name_norm(bl.verkaeufer_name)
   WHERE bl.typ_id = '1'
     AND bl.beleg_datum IS NOT NULL
     AND core.kreditor_name_norm(bl.verkaeufer_name) IS NOT NULL
   GROUP BY bl.betrieb_key, date_trunc('month', bl.beleg_datum),
            coalesce(g.dach_name, core.kreditor_name_norm(bl.verkaeufer_name)),
            bl.verkaeufer_name, bl.zuordnung_fibu
)
SELECT z.quelle,
       z.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       z.monat,
       z.dach_name     AS lieferant,
       z.name_quelle,
       z.bereich,
       coalesce(f.warengruppe,
                CASE WHEN h.dach_name IS NOT NULL THEN 'getraenke' END)
                       AS warengruppe,
       CASE
         WHEN f.freigegeben IS TRUE
              AND (f.gilt_ab IS NULL OR z.monat >= date_trunc('month', f.gilt_ab)::date)
           THEN 'freigegeben'
         WHEN f.freigegeben IS FALSE
              AND (f.gilt_ab IS NULL OR z.monat >= date_trunc('month', f.gilt_ab)::date)
           THEN 'nicht freigegeben'
         WHEN gb.dach_name IS NOT NULL
           THEN 'freigegeben'
         -- Ein bekannter Getraenkehaendler liefert an ein Haus, das einen
         -- ANDEREN GFGH hinterlegt hat. Das ist der Befund.
         WHEN h.dach_name IS NOT NULL
              AND gb_haus.dach_name IS NOT NULL
              AND gb_haus.dach_name IS DISTINCT FROM z.dach_name
           THEN 'nicht freigegeben'
         ELSE 'nicht eingeordnet'
       END             AS einordnung,
       -- Der hinterlegte GFGH des Hauses, IMMER wenn es einen gibt — nicht
       -- nur im Befundfall. Zuerst stand hier gb_fremd.dach_name; die Spalte
       -- war damit in 9.078 von 9.078 Zeilen NULL und log ueber ihren Namen.
       gb_haus.dach_name AS gfgh_des_betriebs,
       z.belege,
       z.netto
  FROM zeilen z
  JOIN core.betrieb b                 ON b.betrieb_key  = z.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = z.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = z.betrieb_key
  LEFT JOIN manual.lieferant_freigabe f ON f.dach_name  = z.dach_name
  -- Ist dieser Lieferant ueberhaupt ein Getraenkehaendler?
  LEFT JOIN manual.gfgh_haendler   h  ON h.dach_name    = z.dach_name
  -- Der GFGH DIESES Betriebs, und nur wenn er es ist:
  LEFT JOIN manual.gfgh_betrieb gb
         ON gb.betrieb_key = z.betrieb_key AND gb.dach_name = z.dach_name
  -- Welchen GFGH hat dieses Haus hinterlegt? Ohne Bezug zum Lieferanten der
  -- Zeile — dadurch ist die Spalte gfgh_des_betriebs immer gefuellt, und die
  -- Einordnung haengt nicht mehr an der Pflegearbeit FREMDER Betriebe.
  -- Vorher stand hier ein EXISTS ueber manual.gfgh_betrieb: trug jemand fuer
  -- Aposto Aalen einen Dachnamen nach, kippte rueckwirkend die Einordnung
  -- anderer Haeuser. Diese Fernwirkung ist weg.
  LEFT JOIN manual.gfgh_betrieb gb_haus
         ON gb_haus.betrieb_key = z.betrieb_key;

COMMENT ON VIEW mart.fremdeinkauf IS
'Einkaufsvolumen je Betrieb, Monat und Lieferant, mit der Einordnung daneben —
die Grundlage fuer Fremdeinkauf, Lieferantenkonzentration und Volumen je Haus.
Filtern auf einordnung = ''nicht freigegeben'' liefert die Verdachtsliste.

DIESE VERDACHTSLISTE IST AM 12.08.2026 FAST LEER, und das ist eine Aussage ueber den
Pflegestand und nicht ueber den Einkauf. Ein Befund entsteht nur, wo BEIDES gepflegt ist:
der Lieferant steht in manual.gfgh_haendler UND das belieferte Haus hat einen anderen GFGH
in manual.gfgh_betrieb. Gepflegt sind 5 Haendler und 13 Haeuser, davon 5 mit aufgeloestem
Dachnamen. Wer aus einer kurzen Liste "kaum Fremdeinkauf" liest, liest sie falsch.

DREI ZUSTAENDE, NICHT ZWEI. "nicht eingeordnet" heisst, dass niemand ueber diesen
Lieferanten entschieden hat — es ist die Arbeitsliste, nicht der Befund. Am 12.08.2026
sind das die meisten: 112 von 119 Dachnamen. Gesetzt sind fuenf konzernweite Freigaben
und 13 GFGH-Zeilen.

DIE SPALTE quelle DARF NICHT WEGGRUPPIERT WERDEN. ''foodnotify'' und ''belegarchiv''
zeigen dieselbe Rechnung, wenn sie ueber FoodNotify bestellt und in LINA gebucht wurde.
Jede Karte in Metabase filtert auf GENAU EINE Quelle. Wer beide summiert, verdoppelt.

WOFUER JEDE QUELLE TAUGT:
  foodnotify  — artikelgenau, mit Einzelpreisen (mart.einkauf_position), aber NUR was
                ueber FoodNotify bestellt wurde. 62 der 141 Betriebe ueber die ganze
                Historie, 51 in den letzten zwoelf Monaten. FUER FREMDEINKAUF
                IST DAS DIE SCHWAECHERE QUELLE, und zwar systematisch: wer am System
                vorbei bestellt, erzeugt hier keine Zeile. Diese Quelle unterschaetzt
                Fremdeinkauf genau dort, wo er am groessten ist.
  belegarchiv — jede gebuchte Eingangsrechnung, unabhaengig vom Bestellweg, alle
                Betriebe, Historie bis 2009. Dafuer OHNE Positionen: kein Artikel,
                kein Einzelpreis (Weg A der Erhebung vom 11.08.2026, siehe 0053).
                Preisabweichungen je Produkt sind hierueber NICHT erreichbar.

bereich ist bei foodnotify core.kostenstelle.art und bei belegarchiv das Feld
zuordnung_fibu AN DER RECHNUNG. Beide sagen bar/kueche, sie sind aber nicht dasselbe
Urteil — die Kostenstelle gehoert dem Betrieb, das Rechnungsfeld der Buchhaltung.
Dass Distra unter bar auftaucht, ist deshalb kein Fehler, sondern eine Buchung.

KEIN BEFUND SIND: Brauereien und Winzer mit eigenem Liefervertrag. Sie stehen als
"nicht eingeordnet" in der Liste, bis jemand sie einordnet.';
