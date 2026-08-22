-- =====================================================================
-- 0094 Pflichtartikel — halten sich die Betriebe an die Sortimentsvorgabe?
--
-- Der Fachbereich pflegt je Konzept eine PFLICHTARTIKELLISTE (PAL): was
-- ein Betrieb fuehren MUSS. Drei Listen liegen vor (examples/pflichtartikel/):
--
--   Wilma Wunder   zwei PDF, Bar und Kueche, "Sommer-Standardkarte"
--                  mit ausdruecklicher Laufzeit 13.04.-04.10.2026
--   Aposto         eine XLSX, Blaetter Kueche / Bar / Eiskarte
--   Enchilada      eine XLSX, Blaetter je Bereich UND Lieferant
--
-- Deutsche Konzepte hat keine Liste — die Marke bleibt hier deshalb
-- vollstaendig aussen vor. Ohne diesen Ausschluss stuende sie mit 100 %
-- "abseits" in jeder Rangliste, und das waere keine Aussage, sondern eine
-- fehlende Datei.
--
-- ---------------------------------------------------------------------
-- DIE LEITFRAGE IST DIE UMGEKEHRTE
--
-- Nicht "welche Pflichtartikel fehlen dem Betrieb", sondern: WIE VIEL
-- SEINES EINKAUFS LAEUFT AN DER LISTE VORBEI. Beides steht hier, aber die
-- Rangliste haengt an der zweiten Zahl (`abseits_pct`) — sie ist die, die
-- der Fachbereich sortieren wollte.
--
-- Der Unterschied ist nicht kosmetisch. "Artikel fehlt" traf am
-- 22.08.2026 vor allem Betriebe, die ueberhaupt wenig bestellen; die
-- Rangliste fuellte sich mit geschlossenen und insolventen Haeusern.
-- "Anteil am Einkauf" normiert das von selbst.
--
-- ---------------------------------------------------------------------
-- VIER MESSUNGEN VOM 22.08.2026, DIE DEN BAU BESTIMMT HABEN
--
-- 1. DER SCHLUESSEL IST `core.bestellposition.lieferanten_nr`, NICHT
--    `core.ware.fn_id`. Die PAL nennt Lieferanten-Artikelnummern (Distra
--    300047, Chefs Culinar 60038400). `core.ware.fn_id` traegt je nach
--    `quelle` ZWEI verschiedene Nummernkreise: bei `concrete_product` die
--    interne FoodNotify-ID (derselbe Aperol steht bei Aposto unter 20
--    verschiedenen), bei `lieferant` die Lieferantennummer. Letztere ist
--    nur duenn belegt (Aposto 29 Waren, Wilma Wunder 184). Ueber
--    `core.ware` gemessen trafen 10,1 % der Aposto-Nummern; ueber
--    `bestellposition.lieferanten_nr` sind es 100 %. Die Spalte ist zu
--    99,8 % gefuellt (591.590 von 634.175 Positionen).
--
-- 2. DER BEREICH DARF NICHT MITJOINEN. Naheliegend waere, die Kueche-PAL
--    gegen `kostenstelle.art = 'kueche'` zu pruefen und die Bar-PAL gegen
--    'bar'. Gemessen: die groessten "abseits"-Posten der Aposto-BAR waren
--    Mozzarella, Pizzateigkugeln, Spaghettinester und Rumpsteak — also
--    Kuechenware, ueber die Bar-Kostenstelle bestellt. Mit Bereichsbindung
--    stand Aposto Bar auf 80,7 % abseits, ohne sie das ganze Konzept auf
--    34,1 %. Die Betriebe buchen nicht so, wie die Liste gegliedert ist.
--    Deshalb wird je Konzept die VEREINIGUNG beider Listen geprueft; der
--    Bereich bleibt als Beschreibung erhalten, nicht als Bedingung.
--
-- 3. ARTIKELNUMMERN WECHSELN, DIE LISTE BLEIBT STEHEN. "Cheddar / Gouda
--    Mix" lief bis 13.11.2025 unter Distra 268 und laeuft seit 15.11.2025
--    unter 500096 — gleicher Name, gleiches Gebinde, neue Nummer. Die PAL
--    2026 nennt 268. Ohne Gegenmittel stuenden 124.936 EUR eines
--    Kernartikels als "abseits" da. Deshalb der dritte Zustand
--    `namensgleich` (unten) und `manual.pflichtartikel_alias`.
--
-- 4. 112 DER 765 POSITIONEN HABEN KEINE NUMMER. Ueberwiegend GFGH-
--    Getraenke ("Pepsi Cola", "Granini Apfelsaft naturtrueb"): jeder
--    Betrieb hat seinen eigenen regionalen Getraenkefachgrosshandel mit
--    eigenem Nummernkreis. Die Haendler stehen in FoodNotify (Getraenke
--    Keller, HFS, GLH, Trinkkontor), nur die Nummern passen nicht. Fuer
--    sie ist der Namensabgleich der EINZIGE Weg — entschieden am
--    22.08.2026.
--
-- ---------------------------------------------------------------------
-- VIER ZUSTAENDE JE BESTELLPOSITION, NICHT ZWEI
--
--   pflicht        Nummer steht auf der Liste des Konzepts
--   alias          Nummer ist in manual.pflichtartikel_alias einer
--                  Listennummer zugeordnet (der Fall 268 -> 500096),
--                  gepflegt ueber pflege/ ohne Migration
--   namensgleich   Name trifft eine Listenposition, die Nummer nicht.
--                  ZWEI GRUENDE, die dieselbe Signatur haben: eine
--                  Position OHNE Nummer (GFGH) — dann ist es der einzig
--                  moegliche Treffer und zaehlt als erfuellt —, oder eine
--                  MIT Nummer — dann ist es ein Verdacht auf eine
--                  Nachfolgenummer und gehoert auf die Arbeitsliste, NICHT
--                  in die Erfuellung. Die Sicht trennt beide.
--   abseits        nichts davon. Das ist der Befund.
--
-- Warum vier und nicht zwei: dieselbe Begruendung wie bei
-- `ampel.gesamt()` in 0080 und der Lieferantenfreigabe in 0055. Ein
-- Zustand, der "wir wissen es nicht" bedeutet, darf nicht in den Topf
-- fallen, der "in Ordnung" oder "Verstoss" heisst — sonst entscheidet die
-- Luecke ueber das Urteil.
--
-- ---------------------------------------------------------------------
-- GUELTIGKEIT WIRD GESCHNITTEN
--
-- Die Wilma-Wunder-Liste ist eine Sommerkarte mit Datum. Eine Bestellung
-- vom Januar gegen die Sommerliste zu pruefen, misst die Karte und nicht
-- den Betrieb. Jede Position wird deshalb gegen die Liste geprueft, die AM
-- BESTELLTAG galt (`gueltig_von`/`gueltig_bis`). Kommt die Winterkarte,
-- ist das eine Zeile in pflege/ und keine Migration.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Ein eigener Normalisierer fuer ARTIKELnamen
--
-- WARUM NICHT core.name_norm(). Die Funktion aus 0073 ist fuer
-- BETRIEBSnamen gebaut und streicht am Wortende Rechtsformen: gmbh, ohg,
-- ug — und kg, weil das dort KOMMANDITGESELLSCHAFT heisst.
--
-- In einem Artikelnamen sind dieselben zwei Buchstaben eine MENGENANGABE,
-- und genau daran zerbricht der Vergleich. Nachgestellt am 22.08.2026:
--
--   core.name_norm('Cheddar / Gouda Mix Karton 4 X 2,5Kg')
--     -> "cheddar / gouda mix karton 4 x 2,5"        das Gebinde fehlt
--
-- "2,5Kg" und "2,5" sind nicht dasselbe Produkt, und ein Vergleich, der
-- die Menge wegwirft, trifft das falsche Gebinde, ohne sich zu melden.
-- Fuer zwei Betriebsnamen ist das Streichen richtig, fuer zwei
-- Artikelnamen falsch — deshalb eine eigene Funktion und kein Parameter
-- an der alten.
--
-- WAS DIESE FUNKTION ZUSAETZLICH TUT. FoodNotify haengt an den
-- Positionsnamen das Gebinde ein zweites Mal an, abgetrennt durch einen
-- Doppelpunkt: "Cheddar / Gouda Mix Karton 4 X 2,5Kg:karton 4 X 2,5Kg".
-- Alles ab dem ersten Doppelpunkt faellt weg — sonst haengt der Vergleich
-- an einer Wiederholung.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.artikel_name_norm(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT trim(regexp_replace(
        regexp_replace(
            translate(
                replace(replace(replace(replace(
                    -- Gebinde-Wiederholung ab dem ersten Doppelpunkt weg
                    lower(split_part(coalesce(p, ''), ':', 1)),
                    'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'),
                /*
                 * Das Ziel ist ABSICHTLICH kuerzer als die Quelle: translate()
                 * LOESCHT die ueberzaehligen Zeichen. Betroffen sind genau die
                 * sechs Apostroph- und Anfuehrungsvarianten am Ende — und das
                 * ist der nachgemessene Befund aus 0073: aus "Bailey's" muss
                 * "baileys" werden, nicht "bailey s". Die Listen fuehren
                 * "Bailey's", "Hendrick´s Gin" und "Homestyle Chik´n Burger",
                 * FoodNotify schreibt dieselben Artikel mal so, mal so.
                 *
                 * Die Akzente muessen dagegen HIER fallen und nicht erst im
                 * regexp darunter: waere "é" ein Leerzeichen, zerfiele
                 * "Crème" in zwei Woerter und der Praefixvergleich ginge fehl.
                 */
                'áàâéèêíìîóòôúùû´`''’‘"', 'aaaeeeiiiooouuu'),
            -- alles Uebrige, was kein Buchstabe und keine Ziffer ist, wird ein
            -- Leerzeichen. Nebenwirkung mit Absicht: LIKE-Platzhalter koennen
            -- den Namensvergleich unten nicht erreichen.
            '[^a-z0-9]+', ' ', 'g'),
        '[[:space:]]+', ' ', 'g'))
$$;

COMMENT ON FUNCTION core.artikel_name_norm(text) IS
'Normalisiert ARTIKELnamen fuer den Vergleich PAL gegen Bestellposition.

NICHT core.name_norm() dafuer benutzen: die ist fuer Betriebsnamen und streicht
am Wortende Rechtsformen — auch "kg", weil es dort Kommanditgesellschaft
bedeutet. In einem Artikelnamen ist "2,5Kg" eine Mengenangabe, und aus
"Cheddar / Gouda Mix Karton 4 X 2,5Kg" wird dort "... 4 x 2,5". Ein Vergleich
ohne Gebinde trifft das falsche Produkt und meldet sich nicht.

Schneidet zusaetzlich die FoodNotify-Gebindewiederholung ab dem ersten
Doppelpunkt ab.';


-- ---------------------------------------------------------------------
-- 2. Die Listen — Kopf
--
-- Der Schluessel enthaelt gueltig_von, damit die Winterkarte neben der
-- Sommerkarte stehen kann statt sie zu ueberschreiben. Ueberlappen zwei
-- Listen desselben Konzepts, wuerde eine Position doppelt zaehlen — das
-- faengt mart.pflichtartikel_ueberlappung ab (unten), statt es
-- vorauszusetzen.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manual.pflichtartikel_liste (
    konzept       text NOT NULL,
    bereich       text NOT NULL CHECK (bereich IN ('kueche', 'bar')),
    gueltig_von   date NOT NULL,
    gueltig_bis   date,
    name          text,
    quelle_datei  text,
    stand         text,
    notiz         text,
    gepflegt_am   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (konzept, bereich, gueltig_von)
);

COMMENT ON TABLE manual.pflichtartikel_liste IS
'Kopfzeile je Pflichtartikelliste. konzept entspricht core.marke.name — nicht
core.konzept: die PAL kommt aus FoodNotify-Sicht, und dort ist die Marke der
Mandant. gueltig_bis NULL heisst "laeuft weiter".
Pflegbar ueber pflege/pflichtartikel_liste.csv.';

COMMENT ON COLUMN manual.pflichtartikel_liste.gueltig_von IS
'Ab wann die Liste gilt. Teil des Schluessels, damit eine Folgeliste (Winter-
karte) danebensteht statt zu ueberschreiben — die Historie ist die halbe
Auswertung.';


-- ---------------------------------------------------------------------
-- 3. Die Listen — Positionen
--
-- UNIQUE NULLS NOT DISTINCT: eine Position ohne Artikelnummer (GFGH,
-- Wilmas Zauberladen) muss ueber ihre Bezeichnung eindeutig sein, und
-- zwei NULL-Nummern duerfen sich nicht gegenseitig ausschliessen. Ohne
-- NULLS NOT DISTINCT liesse Postgres beliebig viele "Pepsi Cola ohne
-- Nummer" nebeneinander zu.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manual.pflichtartikel (
    konzept       text NOT NULL,
    bereich       text NOT NULL CHECK (bereich IN ('kueche', 'bar')),
    gueltig_von   date NOT NULL,
    artikelnummer text,
    bezeichnung   text NOT NULL,
    lieferant     text,
    rubrik        text,
    optional      boolean NOT NULL DEFAULT false,
    nur_betriebe  text,
    quelle        text,
    notiz         text,
    gepflegt_am   timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (konzept, bereich, gueltig_von, artikelnummer, bezeichnung),
    FOREIGN KEY (konzept, bereich, gueltig_von)
        REFERENCES manual.pflichtartikel_liste (konzept, bereich, gueltig_von)
);

COMMENT ON TABLE manual.pflichtartikel IS
'Die einzelnen Pflichtartikel. Pflegbar ueber pflege/pflichtartikel.csv —
Kopfzeile muss vorher stehen (Fremdschluessel).';

COMMENT ON COLUMN manual.pflichtartikel.artikelnummer IS
'Lieferanten-Artikelnummer, wie sie auf der Liste steht. Trifft auf
core.bestellposition.lieferanten_nr — NICHT auf core.ware.fn_id, das je nach
quelle einen anderen Nummernkreis fuehrt (Begruendung im Kopf dieser Datei).
NULL bei GFGH-Getraenken und Kleinlieferanten: dort hat jeder Betrieb einen
eigenen Nummernkreis. Diese Positionen sind NUR ueber den Namen pruefbar.';

COMMENT ON COLUMN manual.pflichtartikel.nur_betriebe IS
'Gesetzt bei den regionalen Gerichten der Wilma-Wunder-Kuechenliste
("Sauerbraten (Dresden, Koeln, Duesseldorf)"). Rohtext aus der Vorlage; die
Aufloesung auf Betriebe steht in mart.pflichtartikel_regional und ist
ausdruecklich unsicher — deshalb bleibt der Rohtext stehen.';

COMMENT ON COLUMN manual.pflichtartikel.optional IS
'Auf der Vorlage als "(optional)" gekennzeichnet. Zaehlt nicht in die
Abdeckungspflicht, gilt aber als freigegeben — wer ihn kauft, kauft nicht
abseits.';


-- ---------------------------------------------------------------------
-- 4. Nachfolgenummern von Hand
--
-- Der Fall aus Messung 3: die Liste nennt 268, der Lieferant liefert seit
-- November unter 500096. Ohne diese Tabelle bliebe nur, die Liste zu
-- aendern — und damit die Vorlage des Fachbereichs zu verfaelschen.
--
-- Der Weg dahin ist mart.pflichtartikel_verdacht: dort stehen genau die
-- Positionen, die namensgleich sind und eine andere Nummer tragen. Wer
-- eine davon bestaetigt, traegt sie hier ein.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manual.pflichtartikel_alias (
    konzept        text NOT NULL,
    artikelnummer  text NOT NULL,
    gilt_fuer      text NOT NULL,
    grund          text,
    gilt_ab        date,
    gepflegt_am    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (konzept, artikelnummer)
);

COMMENT ON TABLE manual.pflichtartikel_alias IS
'Nachfolge- und Ersatznummern: "diese bestellte Nummer erfuellt jene
Listenposition". gilt_fuer ist die Artikelnummer AUF DER LISTE.
Pflegbar ueber pflege/pflichtartikel_alias.csv.
Anlass: Distra 268 "Cheddar / Gouda Mix" laeuft seit 15.11.2025 unter 500096 —
gleicher Name, gleiches Gebinde, 124.936 EUR im Zwoelfmonatsfenster.';


-- ---------------------------------------------------------------------
-- 5. Ueberlappen zwei Listen desselben Konzepts?
--
-- Der Zeitschnitt unten ordnet jede Bestellposition der Liste zu, die am
-- Bestelltag galt. Ueberlappen zwei Fenster, trifft eine Position BEIDE
-- und zaehlt doppelt — die Ausgaben eines Betriebs waeren dann groesser
-- als seine Ausgaben. Heute gibt es je Konzept genau ein Fenster; das
-- bleibt nicht so, sobald die Winterkarte kommt.
--
-- ERWARTUNG: leer. Steht hier etwas, ist die Rangliste falsch, nicht nur
-- ungenau.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pflichtartikel_ueberlappung AS
SELECT a.konzept,
       a.bereich       AS bereich_a,
       a.gueltig_von   AS von_a,
       a.gueltig_bis   AS bis_a,
       b.bereich       AS bereich_b,
       b.gueltig_von   AS von_b,
       b.gueltig_bis   AS bis_b
  FROM manual.pflichtartikel_liste a
  JOIN manual.pflichtartikel_liste b
    ON b.konzept = a.konzept
   AND (b.gueltig_von, b.bereich) > (a.gueltig_von, a.bereich)
   AND daterange(a.gueltig_von, a.gueltig_bis, '[]')
    && daterange(b.gueltig_von, b.gueltig_bis, '[]')
   -- Kueche und Bar derselben Karte laufen absichtlich parallel; erst
   -- zwei Fenster MIT verschiedenen Grenzen sind das Problem.
   AND (a.gueltig_von, a.gueltig_bis) IS DISTINCT FROM (b.gueltig_von, b.gueltig_bis);

COMMENT ON VIEW mart.pflichtartikel_ueberlappung IS
'Zwei Pflichtartikellisten desselben Konzepts mit ueberlappender, aber nicht
gleicher Laufzeit. ERWARTUNG: leer. Solange hier etwas steht, zaehlt jede
Bestellposition im ueberlappenden Zeitraum doppelt.';


-- ---------------------------------------------------------------------
-- 6. Was steht ueberhaupt auf den Listen
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pflichtartikel_stand AS
SELECT l.konzept,
       l.bereich,
       l.name                                        AS liste,
       l.gueltig_von,
       l.gueltig_bis,
       (current_date BETWEEN l.gueltig_von
        AND coalesce(l.gueltig_bis, 'infinity'::date)) AS laeuft,
       count(p.*)                                    AS artikel,
       count(*) FILTER (WHERE p.artikelnummer IS NOT NULL) AS mit_nummer,
       count(*) FILTER (WHERE p.artikelnummer IS NULL)     AS ohne_nummer,
       count(*) FILTER (WHERE p.optional)                  AS optional,
       count(*) FILTER (WHERE p.nur_betriebe IS NOT NULL)  AS nur_regional,
       count(DISTINCT p.lieferant)                   AS lieferanten,
       l.quelle_datei
  FROM manual.pflichtartikel_liste l
  LEFT JOIN manual.pflichtartikel p
         ON p.konzept = l.konzept AND p.bereich = l.bereich
        AND p.gueltig_von = l.gueltig_von
 GROUP BY l.konzept, l.bereich, l.name, l.gueltig_von, l.gueltig_bis, l.quelle_datei;

COMMENT ON VIEW mart.pflichtartikel_stand IS
'Eine Zeile je Liste: Laufzeit, Umfang, und wie viele Positionen ohne
Artikelnummer dastehen. ohne_nummer ist die Zahl, die den pruefbaren Anteil
begrenzt — diese Positionen sind nur ueber den Namen erreichbar.';


-- ---------------------------------------------------------------------
-- 7. Die Klassifikation — der Kern
--
-- Korn: ein ARTIKEL (Nummer + normalisierter Name) je Konzept und
-- Gueltigkeitsfenster. Nicht je Position: im Zwoelfmonatsfenster stehen
-- 6.852 verschiedene Artikel gegen rund 600.000 Positionen, und der
-- Namensabgleich ist ein Praefixvergleich gegen bis zu 765 Listeneintraege.
-- Ueber die Positionen gerechnet lief er in einen Zeitausfall (gemessen
-- 22.08.2026: > 2 min, abgebrochen); ueber die Artikel sind es Sekunden.
--
-- DER NAMENSVERGLEICH ENDET AN EINER WORTGRENZE. "Zitrone" (CF Gastro
-- 12502510) ist ein Praefix von "Zitronensaft Tk Karton 6 X 1L" — zwei
-- verschiedene Artikel. Deshalb `= bez_norm` ODER `LIKE bez_norm || ' %'`
-- und nie `LIKE bez_norm || '%'`.
--
-- MINDESTENS SECHS ZEICHEN. Die Listen fuehren "Huhn", "Salz", "Dill",
-- "Kiwi" — vier Buchstaben treffen quer durch den Warenstamm. Wer diese
-- Grenze senkt, macht aus dem Abgleich einen Zufallsgenerator.
--
-- WILDCARDS KOENNEN NICHT DURCHRUTSCHEN, weil core.artikel_name_norm()
-- jedes Nicht-alphanumerische Zeichen zu einem Leerzeichen macht — aus
-- "H-Milch 1,5%" wird "h milch 1 5". Das ist kein Zufall, sondern der
-- Grund fuer die harte Normalisierung.
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mart.pflichtartikel_klassifikation_basis AS
WITH fenster AS (
    SELECT DISTINCT konzept, gueltig_von, gueltig_bis
      FROM manual.pflichtartikel_liste
), soll AS (
    SELECT f.konzept, f.gueltig_von, f.gueltig_bis,
           p.artikelnummer, p.bezeichnung, p.lieferant, p.bereich,
           p.optional, p.nur_betriebe,
           core.artikel_name_norm(p.bezeichnung) AS bez_norm
      FROM fenster f
      JOIN manual.pflichtartikel p
        ON p.konzept = f.konzept AND p.gueltig_von = f.gueltig_von
), ist AS (
    -- Die im Fenster tatsaechlich bestellten Artikel, entdoppelt.
    SELECT DISTINCT
           f.konzept, f.gueltig_von, f.gueltig_bis,
           coalesce(bp.lieferanten_nr, '')      AS nr,
           core.artikel_name_norm(bp.name)      AS nm,
           bp.name                              AS name_roh
      FROM core.bestellposition bp
      JOIN core.bestellung   b USING (bestellung_key)
      JOIN core.kostenstelle k USING (kostenstelle_key)
      JOIN core.marke        m ON m.marke_key = k.marke_key
      JOIN fenster f ON f.konzept = m.name
       AND b.bestellt_am::date >= f.gueltig_von
       AND b.bestellt_am::date <= coalesce(f.gueltig_bis, 'infinity'::date)
     WHERE b.status IS DISTINCT FROM 'canceled'
       AND k.betrieb_key IS NOT NULL
)
SELECT i.konzept, i.gueltig_von, i.gueltig_bis, i.nr, i.nm, i.name_roh,
       CASE WHEN dn.bezeichnung  IS NOT NULL THEN 'pflicht'
            WHEN al.gilt_fuer    IS NOT NULL THEN 'alias'
            WHEN no.bezeichnung  IS NOT NULL THEN 'pflicht_namentlich'
            WHEN mi.bezeichnung  IS NOT NULL THEN 'namensgleich'
            ELSE 'abseits' END AS zustand,
       coalesce(dn.bezeichnung, al.bezeichnung, no.bezeichnung, mi.bezeichnung) AS liste_bezeichnung,
       coalesce(dn.artikelnummer, al.gilt_fuer, mi.artikelnummer)               AS liste_nummer,
       coalesce(dn.lieferant, al.lieferant, no.lieferant, mi.lieferant)         AS liste_lieferant,
       coalesce(dn.bereich, al.bereich, no.bereich, mi.bereich)                 AS liste_bereich,
       coalesce(dn.optional, al.optional, no.optional, mi.optional, false)      AS optional,
       coalesce(dn.nur_betriebe, al.nur_betriebe, no.nur_betriebe, mi.nur_betriebe) AS nur_betriebe
  FROM ist i
  -- 1. Nummer steht auf der Liste
  LEFT JOIN LATERAL (
      SELECT s.* FROM soll s
       WHERE s.konzept = i.konzept AND s.gueltig_von = i.gueltig_von
         AND s.artikelnummer = i.nr
       LIMIT 1) dn ON true
  -- 2. Nummer ist von Hand einer Listennummer zugeordnet
  LEFT JOIN LATERAL (
      SELECT s.*, a.gilt_fuer
        FROM manual.pflichtartikel_alias a
        JOIN soll s ON s.konzept = i.konzept AND s.gueltig_von = i.gueltig_von
                   AND s.artikelnummer = a.gilt_fuer
       WHERE a.konzept = i.konzept AND a.artikelnummer = i.nr
         AND (a.gilt_ab IS NULL OR a.gilt_ab <= i.gueltig_bis
              OR i.gueltig_bis IS NULL)
       LIMIT 1) al ON true
  -- 3. Name trifft eine Listenposition OHNE Nummer -> der einzig moegliche
  --    Treffer, zaehlt als erfuellt (GFGH, Wilmas Zauberladen, Trink Meer Tee)
  LEFT JOIN LATERAL (
      SELECT s.* FROM soll s
       WHERE s.konzept = i.konzept AND s.gueltig_von = i.gueltig_von
         AND s.artikelnummer IS NULL
         AND length(s.bez_norm) >= 6
         AND (i.nm = s.bez_norm OR i.nm LIKE s.bez_norm || ' %')
       ORDER BY length(s.bez_norm) DESC
       LIMIT 1) no ON true
  -- 4. Name trifft eine Listenposition MIT Nummer, aber die Nummer weicht ab
  --    -> Verdacht auf Nachfolgenummer. NICHT erfuellt, sondern Arbeitsliste.
  LEFT JOIN LATERAL (
      SELECT s.* FROM soll s
       WHERE s.konzept = i.konzept AND s.gueltig_von = i.gueltig_von
         AND s.artikelnummer IS NOT NULL
         AND length(s.bez_norm) >= 6
         AND (i.nm = s.bez_norm OR i.nm LIKE s.bez_norm || ' %')
       ORDER BY length(s.bez_norm) DESC
       LIMIT 1) mi ON true;

CREATE UNIQUE INDEX pflichtartikel_klassifikation_korn
    ON mart.pflichtartikel_klassifikation_basis (konzept, gueltig_von, nr, nm);

COMMENT ON MATERIALIZED VIEW mart.pflichtartikel_klassifikation_basis IS
'Rechenstand: ein bestellter Artikel je Konzept und Gueltigkeitsfenster, mit
seinem Zustand gegen die Pflichtartikelliste. NICHT direkt abfragen — die Sicht
mart.pflichtartikel_klassifikation darueber traegt die Erklaerung.';

CREATE OR REPLACE VIEW mart.pflichtartikel_klassifikation AS
SELECT konzept, gueltig_von, gueltig_bis,
       nullif(nr, '') AS artikelnummer,
       name_roh       AS artikel,
       zustand,
       liste_bezeichnung, liste_nummer, liste_lieferant, liste_bereich,
       optional, nur_betriebe
  FROM mart.pflichtartikel_klassifikation_basis;

COMMENT ON VIEW mart.pflichtartikel_klassifikation IS
'Je bestelltem Artikel: steht er auf der Pflichtartikelliste des Konzepts?
Fuenf Zustaende. pflicht = Nummer steht auf der Liste. alias = Nummer wurde von
Hand einer Listennummer zugeordnet (Nachfolgenummer). pflicht_namentlich = die
Listenposition hat gar keine Nummer (GFGH-Getraenke), der Name trifft — das ist
dort der einzige moegliche Nachweis. namensgleich = der Name trifft eine
Listenposition, die Nummer weicht ab; das ist ein VERDACHT auf eine
Nachfolgenummer und zaehlt NICHT als erfuellt. abseits = nichts davon.';


-- ---------------------------------------------------------------------
-- 8. Der Einkauf je Betrieb und Monat — die Leitzahl
--
-- Korn: Konzept, Fenster, Betrieb, Monat, Zustand. Klein genug fuer jede
-- Kachel und jeden Verlauf, und die Quelle der Rangliste darunter.
--
-- ZWEI FILTER, DIE BEIDE SCHON EINMAL EINE ZAHL VERDORBEN HABEN:
--   * status <> 'canceled' — stornierte Bestellungen sind kein Einkauf.
--   * betrieb_key IS NOT NULL — Kostenstellen ohne Betriebszuordnung
--     (art = 'sonstige', Zentrale) haben keinen Adressaten fuer eine
--     Rangliste. Sie stehen in mart.kostenstelle_ohne_betrieb.
--
-- summe_preis > 0 wird NICHT gefiltert: Gutschriften und Nullzeilen
-- gehoeren in die Summe, sonst weicht sie vom Einkaufs-Dashboard ab.
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mart.pflichtartikel_einkauf_basis AS
SELECT kl.konzept,
       kl.gueltig_von,
       k.betrieb_key,
       date_trunc('month', b.bestellt_am)::date AS monat,
       kl.zustand,
       count(*)                                  AS positionen,
       count(DISTINCT b.bestellung_key)          AS bestellungen,
       count(DISTINCT kl.nr || '|' || kl.nm)     AS artikel,
       sum(bp.summe_preis)                       AS ausgaben
  FROM core.bestellposition bp
  JOIN core.bestellung   b USING (bestellung_key)
  JOIN core.kostenstelle k USING (kostenstelle_key)
  JOIN core.marke        m ON m.marke_key = k.marke_key
  JOIN mart.pflichtartikel_klassifikation_basis kl
    ON kl.konzept     = m.name
   AND kl.nr          = coalesce(bp.lieferanten_nr, '')
   AND kl.nm          = core.artikel_name_norm(bp.name)
   AND b.bestellt_am::date >= kl.gueltig_von
   AND b.bestellt_am::date <= coalesce(kl.gueltig_bis, 'infinity'::date)
 WHERE b.status IS DISTINCT FROM 'canceled'
   AND k.betrieb_key IS NOT NULL
 GROUP BY 1, 2, 3, 4, 5;

CREATE UNIQUE INDEX pflichtartikel_einkauf_korn
    ON mart.pflichtartikel_einkauf_basis (konzept, gueltig_von, betrieb_key, monat, zustand);

COMMENT ON MATERIALIZED VIEW mart.pflichtartikel_einkauf_basis IS
'Rechenstand fuer mart.pflichtartikel_einkauf. NICHT direkt abfragen.';


CREATE OR REPLACE VIEW mart.pflichtartikel_einkauf AS
SELECT e.konzept,
       bt.name        AS betrieb,
       e.betrieb_key,
       e.monat,
       e.zustand,
       e.positionen,
       e.bestellungen,
       e.artikel,
       round(e.ausgaben, 2) AS ausgaben
  FROM mart.pflichtartikel_einkauf_basis e
  JOIN core.betrieb bt USING (betrieb_key);

COMMENT ON VIEW mart.pflichtartikel_einkauf IS
'Einkauf je Betrieb und Monat, aufgeteilt nach dem Zustand gegen die
Pflichtartikelliste. Nur Monate innerhalb der Listenlaufzeit — eine Bestellung
wird gegen die Liste geprueft, die am Bestelltag galt.';


-- ---------------------------------------------------------------------
-- 9. Die Rangliste — wer haelt sich am wenigsten dran
--
-- DIE ZAHL, UM DIE ES GEHT, IST abseits_pct. Sie ist ein Anteil an den
-- Ausgaben, nicht an der Artikelzahl: eine Palette Fremdbier wiegt mehr
-- als eine Packung Zahnstocher, und die Rangliste soll das abbilden.
--
-- WARUM datenbasis DANEBENSTEHT UND NICHT WEGGEFILTERT WIRD. Ein Betrieb
-- mit drei Bestellungen im Fenster kann rechnerisch auf 90 % abseits
-- kommen; das ist wahr und trotzdem keine Aussage. Gemessen am 22.08.2026
-- standen ohne diese Spalte geschlossene und insolvente Haeuser an der
-- Spitze der Liste. Sie bleiben drin — aber lesbar als das, was sie sind.
-- Die Grenzen sind gesetzt, nicht gemessen: sie sollen eine Zeile
-- kennzeichnen, nicht ein Urteil ersetzen.
--
-- namensgleich_pct IST KEIN BEFUND, sondern die Unschaerfe der Messung:
-- so viel Prozent haengen an einem Artikel, dessen Name auf der Liste
-- steht und dessen Nummer nicht. Solange die Zahl gross ist, ist
-- abseits_pct eine OBERGRENZE.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pflichtartikel_betrieb AS
WITH je_betrieb AS (
  SELECT e.konzept, e.betrieb_key, e.gueltig_von,
         min(e.monat)                                    AS von_monat,
         max(e.monat)                                    AS bis_monat,
         sum(e.ausgaben)                                 AS ausgaben,
         sum(e.bestellungen)                             AS bestellungen,
         sum(e.ausgaben) FILTER (WHERE e.zustand IN ('pflicht','alias','pflicht_namentlich')) AS ausgaben_pflicht,
         sum(e.ausgaben) FILTER (WHERE e.zustand = 'namensgleich') AS ausgaben_namensgleich,
         sum(e.ausgaben) FILTER (WHERE e.zustand = 'abseits')      AS ausgaben_abseits
    FROM mart.pflichtartikel_einkauf_basis e
   GROUP BY 1, 2, 3
)
SELECT j.konzept,
       bt.name        AS betrieb,
       j.betrieb_key,
       j.von_monat, j.bis_monat,
       j.bestellungen,
       round(j.ausgaben, 2)                        AS ausgaben,
       round(coalesce(j.ausgaben_pflicht, 0), 2)   AS ausgaben_pflicht,
       round(coalesce(j.ausgaben_abseits, 0), 2)   AS ausgaben_abseits,
       round(100.0 * coalesce(j.ausgaben_pflicht, 0)      / nullif(j.ausgaben, 0), 1) AS pflicht_pct,
       round(100.0 * coalesce(j.ausgaben_namensgleich, 0) / nullif(j.ausgaben, 0), 1) AS namensgleich_pct,
       round(100.0 * coalesce(j.ausgaben_abseits, 0)      / nullif(j.ausgaben, 0), 1) AS abseits_pct,
       rank() OVER (PARTITION BY j.konzept ORDER BY
             coalesce(j.ausgaben_abseits, 0) / nullif(j.ausgaben, 0) DESC NULLS LAST) AS rang_im_konzept,
       CASE WHEN j.bestellungen IS NULL OR j.bestellungen = 0 THEN 'keine Bestellung'
            WHEN j.bestellungen < 10 OR j.ausgaben < 5000     THEN 'duenn'
            ELSE 'belastbar' END                   AS datenbasis
  FROM je_betrieb j
  JOIN core.betrieb bt USING (betrieb_key);

COMMENT ON VIEW mart.pflichtartikel_betrieb IS
'Die Rangliste: welcher Anteil des Einkaufs laeuft an der Pflichtartikelliste
vorbei. abseits_pct ist die Leitzahl, gerechnet auf die AUSGABEN und nicht auf
die Artikelzahl.

Immer zusammen mit datenbasis lesen: "duenn" heisst weniger als zehn
Bestellungen oder weniger als 5.000 EUR im Fenster — dort ist der Prozentwert
richtig gerechnet und trotzdem keine Aussage.

namensgleich_pct ist die Unschaerfe: Artikel, deren Name auf der Liste steht
und deren Nummer nicht. Solange diese Zahl gross ist, ist abseits_pct eine
Obergrenze. Was dahintersteckt, zeigt mart.pflichtartikel_verdacht.';


-- ---------------------------------------------------------------------
-- 10. Artikel je Betrieb — die Grundlage beider Drilldowns
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mart.pflichtartikel_artikel_basis AS
SELECT kl.konzept,
       kl.gueltig_von,
       k.betrieb_key,
       kl.nr,
       kl.nm,
       min(kl.name_roh)                    AS artikel,
       min(kl.zustand)                     AS zustand,
       min(kl.liste_bezeichnung)           AS liste_bezeichnung,
       min(kl.liste_nummer)                AS liste_nummer,
       min(kl.liste_lieferant)             AS liste_lieferant,
       string_agg(DISTINCT l.name, ', ')   AS lieferanten,
       count(*)                            AS positionen,
       sum(bp.summe_preis)                 AS ausgaben,
       min(b.bestellt_am)::date            AS erste_bestellung,
       max(b.bestellt_am)::date            AS letzte_bestellung
  FROM core.bestellposition bp
  JOIN core.bestellung   b USING (bestellung_key)
  JOIN core.kostenstelle k USING (kostenstelle_key)
  JOIN core.marke        m ON m.marke_key = k.marke_key
  LEFT JOIN core.lieferant l ON l.lieferant_key = b.lieferant_key
  JOIN mart.pflichtartikel_klassifikation_basis kl
    ON kl.konzept = m.name
   AND kl.nr      = coalesce(bp.lieferanten_nr, '')
   AND kl.nm      = core.artikel_name_norm(bp.name)
   AND b.bestellt_am::date >= kl.gueltig_von
   AND b.bestellt_am::date <= coalesce(kl.gueltig_bis, 'infinity'::date)
 WHERE b.status IS DISTINCT FROM 'canceled'
   AND k.betrieb_key IS NOT NULL
 GROUP BY 1, 2, 3, 4, 5;

CREATE UNIQUE INDEX pflichtartikel_artikel_korn
    ON mart.pflichtartikel_artikel_basis (konzept, gueltig_von, betrieb_key, nr, nm);

COMMENT ON MATERIALIZED VIEW mart.pflichtartikel_artikel_basis IS
'Rechenstand: ein Artikel je Betrieb im Fenster, mit Zustand und Ausgaben.
Traegt sowohl mart.pflichtartikel_abseits als auch mart.pflichtartikel_abdeckung.
NICHT direkt abfragen.';


-- ---------------------------------------------------------------------
-- 11. Der Drilldown: was genau wurde abseits der Liste gekauft
--
-- DIE EIGENTLICH HANDLUNGSFAEHIGE SICHT. Eine Quote sagt, DASS etwas nicht
-- stimmt; diese Liste sagt, WAS. Und sie ist zugleich die Gegenprobe: wer
-- hier "Tork Falthandtuecher" und "Spuelmaschinenreiniger" ganz oben
-- sieht, weiss, dass die Liste Reinigungsbedarf nicht fuehrt und der
-- Prozentwert entsprechend zu lesen ist.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pflichtartikel_abseits AS
SELECT a.konzept,
       bt.name              AS betrieb,
       a.betrieb_key,
       nullif(a.nr, '')     AS artikelnummer,
       a.artikel,
       a.lieferanten        AS lieferant,
       a.positionen,
       round(a.ausgaben, 2) AS ausgaben,
       a.erste_bestellung,
       a.letzte_bestellung
  FROM mart.pflichtartikel_artikel_basis a
  JOIN core.betrieb bt USING (betrieb_key)
 WHERE a.zustand = 'abseits';

COMMENT ON VIEW mart.pflichtartikel_abseits IS
'Was ein Betrieb gekauft hat, das auf keiner Pflichtartikelliste seines
Konzepts steht — nach Ausgaben die Arbeitsliste hinter der Quote.

Zum Lesen gehoert die Gegenprobe: die Listen fuehren keinen Reinigungs- und
Verpackungsbedarf und keine Weine ausser den genannten. Steht so etwas oben,
ist es kein Verstoss, sondern eine Luecke der Liste.';


-- ---------------------------------------------------------------------
-- 12. Der Verdacht: Nachfolgenummern, die noch niemand bestaetigt hat
--
-- Die Einspeisung fuer manual.pflichtartikel_alias. Je groesser die
-- Ausgaben, desto mehr verzerrt der Fall die Quote — deshalb ist das
-- die Sortierung.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pflichtartikel_verdacht AS
SELECT a.konzept,
       nullif(a.nr, '')                AS bestellte_nummer,
       a.artikel                       AS bestellter_artikel,
       a.liste_nummer                  AS nummer_auf_liste,
       a.liste_bezeichnung             AS bezeichnung_auf_liste,
       a.liste_lieferant               AS lieferant_auf_liste,
       count(DISTINCT a.betrieb_key)   AS betriebe,
       sum(a.positionen)               AS positionen,
       round(sum(a.ausgaben), 2)       AS ausgaben,
       max(a.letzte_bestellung)        AS letzte_bestellung
  FROM mart.pflichtartikel_artikel_basis a
 WHERE a.zustand = 'namensgleich'
 GROUP BY 1, 2, 3, 4, 5, 6;

COMMENT ON VIEW mart.pflichtartikel_verdacht IS
'Artikel, deren NAME eine Listenposition trifft, deren NUMMER aber abweicht —
der Verdacht auf eine Nachfolgenummer. Zaehlt bewusst NICHT als erfuellt.

Wer eine Zeile bestaetigt, traegt sie in pflege/pflichtartikel_alias.csv ein;
ab dem naechsten Lauf zaehlt der Artikel als Pflichtartikel. Anlass war Distra
268 "Cheddar / Gouda Mix", seit 15.11.2025 unter 500096 gefuehrt.';


-- ---------------------------------------------------------------------
-- 13. Regionale Gerichte: fuer wen gelten sie
--
-- Die Wilma-Wunder-Kuechenliste fuehrt 24 Artikel, die nur an genannten
-- Standorten Pflicht sind — "Sauerbraten (Dresden, Koeln, Duesseldorf)",
-- "Fleischwurst (Mainz Ballplatz)", "Apfelkompott (DD&Koeln)". Der Rohtext
-- steht so in der Vorlage; er ist kein Schluessel, sondern eine Notiz.
--
-- DIE AUFLOESUNG IST UNSICHER, UND DAS BLEIBT SICHTBAR. "DD" ist Dresden,
-- "Mainz Ballplatz" ist einer von zwei Mainzer Betrieben, und keiner der
-- Namen ist der aus core.betrieb. Was leer ausgeht, steht in
-- mart.pflichtartikel_regional_offen und gilt vorsorglich fuer ALLE.
-- Lieber ein Artikel zu viel auf der Arbeitsliste als einer, der still
-- verschwindet.
--
-- ZWEI FALLEN, BEIDE AM 22.08.2026 IN DIE FALSCHE RICHTUNG GELAUFEN:
--
--   1. UMLAUTE. Die Vorlage schreibt "Nuernberg" als "Nürnberg",
--      core.name_norm faltet den Betriebsnamen zu "wilma wunder
--      nuernberg". Ein Vergleich, der nur EINE Seite faltet, findet
--      nichts — und liefert dabei keinen Fehler, sondern eine leere
--      Menge. Beide Seiten laufen deshalb durch core.name_norm.
--
--   2. WORTREIHENFOLGE. Die Vorlage sagt "Mainz Ballplatz", der Betrieb
--      heisst "Wilma Wunder Ballplatz Mainz GmbH". Ein Praefix- oder
--      Teilstringvergleich ueber die ganze Angabe scheitert daran.
--      Getroffen wird deshalb wortweise: JEDES Wort der Ortsangabe muss
--      im Betriebsnamen vorkommen, die Reihenfolge ist egal.
--
-- Vor der Korrektur blieben 7 der 24 regionalen Artikel ohne Betrieb,
-- danach 0.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pflichtartikel_regional AS
WITH aufgeteilt AS (
  SELECT p.konzept, p.bereich, p.gueltig_von, p.artikelnummer, p.bezeichnung,
         p.nur_betriebe,
         btrim(teil) AS ort_roh
    FROM manual.pflichtartikel p,
         LATERAL regexp_split_to_table(p.nur_betriebe, '[,&/]') AS teil
   WHERE p.nur_betriebe IS NOT NULL
), uebersetzt AS (
  -- Die einzige Abkuerzung, die in den Vorlagen vorkommt. Als Daten hier
  -- und nicht als Sonderfall im Vergleich darunter.
  SELECT a.*, CASE lower(btrim(a.ort_roh))
                WHEN 'dd' THEN 'dresden'
                ELSE lower(btrim(a.ort_roh)) END AS ort
    FROM aufgeteilt a
)
SELECT u.konzept, u.bereich, u.gueltig_von, u.artikelnummer, u.bezeichnung,
       u.nur_betriebe, u.ort_roh, u.ort,
       bt.betrieb_key, bt.name AS betrieb
  FROM uebersetzt u
  JOIN core.kostenstelle k ON k.betrieb_key IS NOT NULL
  JOIN core.marke        m ON m.marke_key = k.marke_key AND m.name = u.konzept
  JOIN core.betrieb     bt ON bt.betrieb_key = k.betrieb_key
 WHERE core.name_norm(u.ort) <> ''
   -- Jedes Wort der Ortsangabe muss im Betriebsnamen vorkommen; die
   -- Reihenfolge nicht ("Mainz Ballplatz" gegen "Ballplatz Mainz").
   AND NOT EXISTS (
       SELECT 1
         FROM regexp_split_to_table(core.name_norm(u.ort), '[[:space:]]+') AS wort
        WHERE wort <> ''
          AND core.name_norm(bt.name) NOT LIKE '%' || wort || '%')
 GROUP BY u.konzept, u.bereich, u.gueltig_von, u.artikelnummer, u.bezeichnung,
          u.nur_betriebe, u.ort_roh, u.ort, bt.betrieb_key, bt.name;

COMMENT ON VIEW mart.pflichtartikel_regional IS
'Aufloesung der regionalen Gerichte auf Betriebe. Der Ortsname stammt aus einer
Klammer in der Vorlage und ist kein Schluessel — getroffen wird ueber
Teilwortsuche. Was ohne Treffer bleibt, steht in
mart.pflichtartikel_regional_offen und gilt vorsorglich fuer alle Betriebe des
Konzepts.';


CREATE OR REPLACE VIEW mart.pflichtartikel_regional_offen AS
SELECT DISTINCT p.konzept, p.bereich, p.artikelnummer, p.bezeichnung, p.nur_betriebe
  FROM manual.pflichtartikel p
 WHERE p.nur_betriebe IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM mart.pflichtartikel_regional r
                    WHERE r.konzept = p.konzept AND r.bezeichnung = p.bezeichnung);

COMMENT ON VIEW mart.pflichtartikel_regional_offen IS
'Regionale Gerichte, deren Ortsangabe auf keinen Betrieb passt. ERWARTUNG: leer.
Solange hier etwas steht, gilt der Artikel vorsorglich fuer ALLE Betriebe des
Konzepts und erzeugt in mart.pflichtartikel_abdeckung Fehlmeldungen — sichtbar,
nicht still.';


-- ---------------------------------------------------------------------
-- 14. Die Gegenrichtung: welcher Pflichtartikel fehlt welchem Betrieb
--
-- Die urspruengliche Lesart der Frage. Sie bleibt, weil sie etwas zeigt,
-- was die Quote nicht kann: einen Artikel, den NIEMAND fuehrt — das ist
-- dann kein Betriebsproblem, sondern eine Listenpflege.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pflichtartikel_abdeckung AS
WITH betriebe AS (
  SELECT DISTINCT m.name AS konzept, k.betrieb_key
    FROM core.kostenstelle k
    JOIN core.marke m USING (marke_key)
   WHERE k.betrieb_key IS NOT NULL
), soll AS (
  SELECT l.konzept, l.gueltig_von, l.gueltig_bis, p.bereich,
         p.artikelnummer, p.bezeichnung, p.lieferant, p.optional, p.nur_betriebe
    FROM manual.pflichtartikel p
    JOIN manual.pflichtartikel_liste l
      ON l.konzept = p.konzept AND l.bereich = p.bereich
     AND l.gueltig_von = p.gueltig_von
   WHERE p.artikelnummer IS NOT NULL
)
SELECT s.konzept,
       bt.name          AS betrieb,
       b.betrieb_key,
       s.gueltig_von, s.gueltig_bis,
       s.bereich,
       s.lieferant,
       s.artikelnummer,
       s.bezeichnung,
       s.optional,
       s.nur_betriebe,
       (a.nr IS NOT NULL)                AS bezogen,
       coalesce(a.positionen, 0)         AS positionen,
       round(coalesce(a.ausgaben, 0), 2) AS ausgaben,
       a.letzte_bestellung
  FROM soll s
  JOIN betriebe b ON b.konzept = s.konzept
  JOIN core.betrieb bt ON bt.betrieb_key = b.betrieb_key
  LEFT JOIN mart.pflichtartikel_artikel_basis a
         ON a.konzept     = s.konzept
        AND a.gueltig_von = s.gueltig_von
        AND a.betrieb_key = b.betrieb_key
        AND (a.nr = s.artikelnummer OR a.liste_nummer = s.artikelnummer)
 WHERE s.nur_betriebe IS NULL
    OR EXISTS (SELECT 1 FROM mart.pflichtartikel_regional r
                WHERE r.konzept = s.konzept AND r.bezeichnung = s.bezeichnung
                  AND r.betrieb_key = b.betrieb_key)
    OR EXISTS (SELECT 1 FROM mart.pflichtartikel_regional_offen o
                WHERE o.konzept = s.konzept AND o.bezeichnung = s.bezeichnung);

COMMENT ON VIEW mart.pflichtartikel_abdeckung IS
'Eine Zeile je Betrieb und Pflichtartikel mit Nummer: wurde er im
Gueltigkeitszeitraum bezogen? bezogen = false ist der fehlende Artikel.

Positionen ohne Artikelnummer fehlen hier bewusst — sie sind ueber die Nummer
nicht pruefbar und stehen in mart.pflichtartikel_nicht_pruefbar.

Regionale Gerichte gelten nur an den Standorten, die die Vorlage nennt
(mart.pflichtartikel_regional). Laesst sich die Ortsangabe nicht aufloesen,
gilt der Artikel vorsorglich fuer alle — sichtbar in
mart.pflichtartikel_regional_offen.

Wer nach einem Artikel sucht, den KEIN Betrieb fuehrt, gruppiert nach
bezeichnung: das ist dann kein Betriebsproblem, sondern eine veraltete Liste.';


-- ---------------------------------------------------------------------
-- 15. Was ueber die Nummer nicht pruefbar ist — die Arbeitsliste
--
-- 112 der 765 Positionen haben keine Artikelnummer. Sie stillschweigend
-- wegzulassen waere eine Kuerzung von einem Siebtel der Vorgabe; sie als
-- "nicht erfuellt" zu zaehlen waere erfunden. Sie stehen deshalb hier,
-- mit der einen Angabe, die weiterhilft: hat der Namensabgleich sie
-- irgendwo gefunden, und wenn ja, bei wie vielen Betrieben.
--
-- Wer die Zeile aufloesen will, traegt die Artikelnummer des jeweiligen
-- Getraenkefachgrosshandels in pflege/pflichtartikel.csv nach.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pflichtartikel_nicht_pruefbar AS
SELECT p.konzept,
       p.bereich,
       p.lieferant,
       p.bezeichnung,
       p.rubrik,
       length(core.artikel_name_norm(p.bezeichnung)) >= 6 AS namensabgleich_moeglich,
       coalesce(t.betriebe, 0)   AS betriebe_mit_treffer,
       round(coalesce(t.ausgaben, 0), 2) AS ausgaben,
       CASE WHEN length(core.artikel_name_norm(p.bezeichnung)) < 6
              THEN 'Name zu kurz fuer den Abgleich'
            WHEN coalesce(t.betriebe, 0) = 0
              THEN 'kein Treffer — Nummer nachtragen'
            ELSE 'ueber den Namen erkannt' END AS zustand
  FROM manual.pflichtartikel p
  LEFT JOIN LATERAL (
      SELECT count(DISTINCT a.betrieb_key) AS betriebe, sum(a.ausgaben) AS ausgaben
        FROM mart.pflichtartikel_artikel_basis a
       WHERE a.konzept = p.konzept
         AND a.zustand = 'pflicht_namentlich'
         AND a.liste_bezeichnung = p.bezeichnung) t ON true
 WHERE p.artikelnummer IS NULL;

COMMENT ON VIEW mart.pflichtartikel_nicht_pruefbar IS
'Pflichtartikel ohne Artikelnummer — ueberwiegend GFGH-Getraenke, bei denen
jeder Betrieb einen eigenen Nummernkreis hat. Fuer sie ist der Namensabgleich
der einzige Nachweis.

"kein Treffer" heisst NICHT "wird nicht gefuehrt": es kann ebenso gut heissen,
dass der Haendler den Artikel anders schreibt. Erst die nachgetragene Nummer in
pflege/pflichtartikel.csv macht daraus eine Messung.';


-- ---------------------------------------------------------------------
-- 16. Die Pruefzeilen
--
-- Vier Zeilen, und jede hat einen anderen Ausfall im Blick:
--
--   * Ueberlappende Listen    -> die Quote zaehlt doppelt (Abschnitt 5)
--   * Regional ohne Betrieb   -> Fehlmeldungen in der Abdeckung
--   * Liste ausgelaufen       -> die Sommerkarte endet am 04.10.2026, und
--                                ab dann misst die Seite NICHTS mehr. Das
--                                ist die Zeile, die das rechtzeitig sagt.
--   * Verdacht unbearbeitet   -> je mehr Ausgaben auf 'namensgleich'
--                                stehen, desto weiter ist abseits_pct von
--                                der Wahrheit entfernt.
--
-- Die dritte ist die wichtigste und die unauffaelligste. Eine Liste, deren
-- Laufzeit abgelaufen ist, erzeugt keinen Fehler — sie erzeugt eine leere
-- Seite, und eine leere Seite sieht aus wie "nichts zu beanstanden"
-- (Regel 10).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.pruefung_pflichtartikel AS
SELECT 'Pflichtartikel: ueberlappende Listen'::text AS pruefung,
       (SELECT count(*) FROM manual.pflichtartikel_liste) AS geprueft,
       count(*)                                           AS auffaellig,
       'mart.pflichtartikel_ueberlappung'::text           AS sicht
  FROM mart.pflichtartikel_ueberlappung
UNION ALL
SELECT 'Pflichtartikel: regionale Angabe ohne Betrieb'::text,
       (SELECT count(*) FROM manual.pflichtartikel WHERE nur_betriebe IS NOT NULL),
       count(*),
       'mart.pflichtartikel_regional_offen'::text
  FROM mart.pflichtartikel_regional_offen
UNION ALL
SELECT 'Pflichtartikel: Liste laeuft in weniger als 30 Tagen aus'::text,
       count(*),
       count(*) FILTER (WHERE gueltig_bis IS NOT NULL
                          AND gueltig_bis < current_date + 30),
       'mart.pflichtartikel_stand'::text
  FROM manual.pflichtartikel_liste
UNION ALL
SELECT 'Pflichtartikel: Nachfolgenummer unbestaetigt (ueber 10.000 EUR)'::text,
       (SELECT count(*) FROM mart.pflichtartikel_verdacht),
       count(*) FILTER (WHERE ausgaben > 10000),
       'mart.pflichtartikel_verdacht'::text
  FROM mart.pflichtartikel_verdacht;

COMMENT ON VIEW mart.pruefung_pflichtartikel IS
'Vier Pruefzeilen zur Pflichtartikelauswertung. Die dritte ist die stille: eine
ausgelaufene Liste erzeugt keinen Fehler, sondern eine leere Seite — und die
sieht aus wie "nichts zu beanstanden".';


/*
 * Anhaengen statt neu schreiben — mit Absicht.
 *
 * mart.pruefung_uebersicht ist ueber ein Dutzend Migrationen gewachsen und
 * traegt inzwischen ueber zwanzig Zeilen. Sie hier vollstaendig neu zu
 * setzen hiesse, den Stand von heute festzuschreiben; arbeitet eine zweite
 * Sitzung parallel an einer weiteren Pruefzeile, waere sie nach dieser
 * Migration verschwunden — ohne Fehler, ohne Konflikt, ohne Spur.
 *
 * Deshalb wird die vorhandene Definition gelesen und ergaenzt. Der
 * NOT LIKE-Schutz macht den Block wiederholbar: ein zweiter Lauf haengt
 * nichts ein zweites Mal an.
 */
DO $$
DECLARE d text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO d;
    IF d NOT LIKE '%pruefung_pflichtartikel%' THEN
        EXECUTE 'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS '
             || rtrim(btrim(d), ';')
             || ' UNION ALL SELECT pruefung, geprueft, auffaellig, sicht'
             || ' FROM mart.pruefung_pflichtartikel';
    END IF;
END $$;


-- ---------------------------------------------------------------------
-- 17. Die drei neuen Materialisierungen im Register
--
-- Ohne diesen Eintrag stuenden sie in mart.materialisierung_stand als
-- "ohne Refresh" — die Zeile, die 0091 eingebaut hat, um genau das zu
-- verhindern. Der Nachlauf ist src/sync/pflichtartikel_sichten.ts.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.materialisierung_stand AS
WITH letzter_lauf AS (
  SELECT max(beendet_am) AS beendet_am
    FROM sync.lauf
   WHERE status IN ('ok', 'teilweise')
), vorhanden AS (
  SELECT (schemaname || '.' || matviewname)::text AS sicht
    FROM pg_matviews
   WHERE schemaname = 'mart'
), zuordnung(sicht, schluessel, nachlauf) AS (
  VALUES
    ('mart.deckungsbeitrag_warengruppe'::text, 'deckungsbeitrag_refresh'::text, 'src/sync/deckungsbeitrag.ts'::text),
    ('mart.round_table_monat',                 'round_table_refresh',           'src/sync/round_table.ts'),
    ('mart.round_table_trend',                 'round_table_refresh',           'src/sync/round_table.ts'),
    ('mart.artikel_monat_basis',               'round_table_refresh',           'src/sync/round_table.ts'),
    ('mart.vergleichstag_basis',               'vergleichstag_refresh',         'src/sync/vergleichstag.ts'),
    ('mart.einkauf_kreditor_monat',            'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkaufspreis_monat_basis',         'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkaufspreis_betrieb_basis',       'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkauf_betrieb_monat_basis',       'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    ('mart.einkauf_pruefung_basis',            'einkauf_sichten_refresh',       'src/sync/einkauf_sichten.ts'),
    -- 0094: die Pflichtartikelauswertung. Eigener Merker, weil sie NACH
    -- der Handpflege laufen muss — die Listen kommen aus pflege/.
    ('mart.pflichtartikel_klassifikation_basis', 'pflichtartikel_refresh',      'src/sync/pflichtartikel_sichten.ts'),
    ('mart.pflichtartikel_einkauf_basis',        'pflichtartikel_refresh',      'src/sync/pflichtartikel_sichten.ts'),
    ('mart.pflichtartikel_artikel_basis',        'pflichtartikel_refresh',      'src/sync/pflichtartikel_sichten.ts')
)
SELECT coalesce(v.sicht, z.sicht)      AS sicht,
       z.schluessel,
       z.nachlauf,
       m.gesetzt_am                    AS zuletzt_aufgefrischt,
       (m.wert ->> 'dauer_s')::numeric AS dauer_s,
       l.beendet_am                    AS letzter_lauf,
       CASE WHEN z.sicht IS NULL      THEN 'ohne Refresh'
            WHEN v.sicht IS NULL      THEN 'Sicht fehlt'
            WHEN m.gesetzt_am IS NULL THEN 'nie aufgefrischt'
            WHEN l.beendet_am IS NULL THEN 'kein Lauf'
            WHEN m.gesetzt_am < l.beendet_am - INTERVAL '1 hour' THEN 'veraltet'
            ELSE 'aktuell' END         AS zustand
  FROM vorhanden v
  FULL JOIN zuordnung z ON z.sicht = v.sicht
  CROSS JOIN letzter_lauf l
  LEFT JOIN sync.merker m ON m.schluessel = z.schluessel;


-- ---------------------------------------------------------------------
-- 18. Startbelegung: die drei Listen, wie sie am 22.08.2026 vorlagen
--
-- Die Daten stehen ZUSAETZLICH in pflege/pflichtartikel*.csv. Dieselbe
-- Bauart wie manual.wetter_klasse in 0087: die Migration setzt einen
-- Stand, damit die Seite vom ersten Tag an etwas zeigt, und die Pflege
-- laeuft danach ueber pflege/ ohne Migration. Der Import dort ist ein
-- Upsert auf denselben Schluessel — beides nebeneinander ist kein
-- Konflikt, sondern derselbe Inhalt.
--
-- WORAUS SIE STAMMEN. Zwei PDF und zwei XLSX aus examples/pflichtartikel/,
-- maschinell ausgelesen. Was dabei zu entscheiden war, steht in
-- docs/entscheidungen.md; die drei Faelle, in denen die Vorlage nicht
-- eindeutig ist, in docs/offene-punkte.md.
-- ---------------------------------------------------------------------
INSERT INTO manual.pflichtartikel_liste
    (konzept, bereich, gueltig_von, gueltig_bis, name, quelle_datei, notiz) VALUES
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', DATE '2026-10-04', 'Sommer-Standardkarte Küche', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf', 'START 13.04.2026 / ENDE 04.10.2026, so auf der Vorlage'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', DATE '2026-10-04', 'Sommer-Standardkarte Bar', 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf', 'START 13.04.2026 / ENDE 04.10.2026, so auf der Vorlage'),
    ('Aposto', 'kueche', DATE '2026-01-01', NULL, 'PAL Aposto 2026 — Küche', 'PAL Aposto 2026.xlsx (Blatt Küche)', 'Die Vorlage nennt nur das Jahr; gueltig_von auf Jahresbeginn gesetzt, Ende offen'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'PAL Aposto 2026 — Bar und Eiskarte', 'PAL Aposto 2026.xlsx (Blätter Bar, Eiskarte)', 'Die Vorlage nennt nur das Jahr; Eiskarte als Rubrik in der Bar-Liste gefuehrt'),
    ('Enchilada', 'kueche', DATE '2026-01-01', NULL, 'PAL Enchilada 2026 — Küche', '2026 PAL Enchilada.xlsx (Blätter Küche *)', 'Die Vorlage nennt nur das Jahr; gueltig_von auf Jahresbeginn gesetzt, Ende offen'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'PAL Enchilada 2026 — Bar', '2026 PAL Enchilada.xlsx (Blätter Bar *)', 'Die Vorlage nennt nur das Jahr; gueltig_von auf Jahresbeginn gesetzt, Ende offen')
ON CONFLICT (konzept, bereich, gueltig_von) DO NOTHING;


/*
 * 765 Positionen, nicht 767.
 *
 * Aposto fuehrt "H-Milch 1,5%" (18459173) und "H-Kakao Gourmet" (60169268)
 * auf ZWEI Blaettern derselben Bar-Liste: einmal unter Bar, einmal unter
 * Eiskarte. Es ist derselbe Artikel mit derselben Lieferantennummer — die
 * Rubrik steht deshalb als "Bar / Eiskarte" an EINER Zeile, statt den
 * Artikel doppelt zu fuehren.
 *
 * Aufgefallen ist es nicht hier, sondern am Pflege-Import: dessen
 * ON CONFLICT DO UPDATE bricht bei einer Dublette in derselben Datei ab
 * ("cannot affect row a second time") und weist die GANZE Datei zurueck.
 * Ein INSERT mit ON CONFLICT DO NOTHING haette sie stillschweigend
 * verschluckt und 765 von 767 geschrieben, ohne ein Wort zu sagen.
 */
INSERT INTO manual.pflichtartikel
    (konzept, bereich, gueltig_von, artikelnummer, bezeichnung, lieferant,
     rubrik, optional, nur_betriebe, quelle) VALUES
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '300047', '"Acai Berry" Smoothie (Pomom)', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '300070', '"Bali Bowl" (Pomom)', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '300049', '"Cinnamon Bowl" (Pomom)', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '300069', '"Pink Pitaya" (Pomom)', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '605', 'Angostura Bitter', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '9501', 'Aperol', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '90141', 'Apricot Brandy', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '964', 'Bailey''s', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '955', 'Bacardi Rum', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '77751', 'Berliner Luft', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200022', 'Blanc de rouge Villa Neus', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '400143', 'Blütenmix', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '987', 'Bombay Gin', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '78851', 'Captain Morgan Dark Rum', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '3915058', 'Chai und zuckerfrei', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '6750', 'Dörrorangenscheibe', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '6753', 'Dörrzitronenscheibe', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '27155', 'Dunkle Schokoladen Kuvertüre (Heiße Schokolade)', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200217', 'Gin Sul', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200208', 'Giffard Veilchen', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200147', 'Giffard Grenadine', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200209', 'Giffard Himbeerpüree', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200149', 'Giffard Kokos', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200162', 'Giffard Lavendel', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200144', 'Giffard Mango', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200137', 'Giffard Rohrzucker', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200146', 'Giffard Rose', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200141', 'Giffard Vanille', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '10953', 'Hausgemachter Eisteesirup', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '10957', 'Hausgemachter Grapefruit-Sirup', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '7302', 'Havana Club 3 Jahre', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200120', 'Holunderblütensirup zuckerfrei', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200183', 'Jägermeister Orange', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '779160', 'Kessler Sekt', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200043', 'Kessler Rosé Sekt', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '5271', 'Lillet Blanc', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '7773', 'Mandarine Napoleone', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '500069', 'Matcha Pistazie YEAH', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '108804', 'Monin Birnenpüree', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '108806', 'Monin Coldbrew Konzentrat', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200124', 'Monin Pure Rote Früchte Konzentrat', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '517', 'Monkey 47 Schwarzwald Dry Gin', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200214', 'Müller-Oswald Scheurebe', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200215', 'Müller-Oswald Cabernet Mitos', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '780017', 'Nymphenburg Sekt alkoholfrei', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '807', 'Prinz Alte Marille', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '808', 'Prinz Alte Wald-Himbeere', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '806', 'Prinz Alte Williamsbirne', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '779137', 'Rosé, Kitzer, trocken', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '500074', 'Rosmarin Cracker', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200012', 'Sarti Rosa', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '779131', 'Sauvignon Blanc, Kitzer, trocken', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '200220', 'Schmittmann Edelkorn', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '779112', 'Secco Bianco Frizzante', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '9712', 'Smirnoff Red Label Vodka', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '7770', 'St. Germain', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '400441', 'Trinkhalm cremeweiß', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '500091', 'Ube Latte YEAH', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '779141', 'WW Lieblingswein, Kitzer, trocken', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '496', 'Zitronensaft (Ersatzprodukt: Frozen Lemon 490)', 'Distra', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '60038400', 'Ahoj Brausepulver 4-fach sortiert', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '60149869', 'Beerenmischung TK', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '15698261', 'Eigelb', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '13187903', 'Granatapfelsaft', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '60115766', 'Gimme Gelato Schokoladeneis', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '60115800', 'Gimme Gelato Vanille-Hafer vegan', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '60115794', 'Gimme Gelato Erdbeersorbet', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '18217568', 'Haferdrink Naarman', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '20076269', 'H-Milch 3,5% 10L (waren vorher nur 5l)', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '18459241', 'H-Milch 3,5% 1L', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '60083040', 'H-Milch 3,5% 1L laktosefrei', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '15955401', 'H-Sahne 30% (Sahnespender)', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '12121403', 'Hafertaler', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '12290833', 'Honigsticks', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '17165655', 'Isi-Sahnekapseln (Sahnespender: Alternative zur Sprühsahne)', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '17141659', 'Kakao Drink', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '15345615', 'Kardamomkapseln', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '15847294', 'Koriander ganz', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '17377485', 'Krümelkandis', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '16873131', 'Mandelmilch Barista', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '10188026', 'Oliven grün gefüllt', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '12040032', 'Orangia Sun Gewürzzubereitung', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '18668162', 'Orangensaft m. Fruchtfleisch', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '20020194', 'Puderzucker', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '15429872', 'Rosa Pfeffer ganz', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '60021753', 'Rote Bete Saft', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '10001783', 'Sprühsahne, 700ml (Alternative zum Sahnespender)', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '14038075', 'Ulmer Raspelschokolade', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '16327115', 'Bourbon Vanille gemahlen', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '20019044', 'Vanille Zucker', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '17012744', 'Wacholderbeeren ganz', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '20020163', 'Zucker weiß', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '14931338', 'Zuckerstreusel bunt', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Acai Pulver', 'Wilmas Zauberladen', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Getrocknete Hibiskusblüten', 'Wilmas Zauberladen', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, '"Alle Mann an Bord" Assamtee', 'Trink Meer Tee', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, '"Watt ist denn hier los" Earl Grey', 'Trink Meer Tee', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, '"Anker lichten" Grüntee', 'Trink Meer Tee', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, '"Rette mit, wer kann" Kräutertee', 'Trink Meer Tee', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, '"Rückenwind" Früchtetee', 'Trink Meer Tee', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, '"Flitzpiepe" Rooibostee', 'Trink Meer Tee', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '80107', 'Glytter Pulver Gold', 'DekoBack', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Granini Apfelsaft naturtrüb', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Granini Ananassaft', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Granini Cranberry', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Granini Johannisbeernektar', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Granini Maracujanektar', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Granini Pfirsichnektar', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Granini Rhabarber', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Granini Lemon Squash', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, '7 Up', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Pepsi Cola', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Pepsi Cola Zero', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Schwip Schwap Orange', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Schweppes Bitter Lemon', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Schweppes Dry Tonic Water', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Schweppes Ginger Ale', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Schweppes Ginger B.', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', NULL, 'Schweppes Wild Berry', 'GFGH', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '16060510', 'Ingwer', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '12520515', 'Limetten', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '13298142', 'Minze', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '12342510', 'Orange', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '13298328', 'Rosmarin', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'bar', DATE '2026-04-13', '12502510', 'Zitrone', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Bar_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '4035', '1000-Sassa', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '400108', 'Backpapierzuschnitte 25*25cm', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '1040', 'Bacon in Scheiben', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '301732', 'Baguette de Paris', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '482', 'Basis Balsamico Dressing hell', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500117', 'Bebivita Feines Gemüse', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500118', 'Bebvita Maracuja-Apfel-Pfirsich', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '306033', 'Bechamel Sauce Lukull', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300163', 'Brioche', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '400143', 'Blütenmix', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '301743', 'Buttercroissant', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500080', 'Caesardressing', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300156', 'Champignonrahmsauce', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '777821', 'Crema Tartuffo', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '482046', 'Crunchy Müsli Ahorn Mandel', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '4034', 'Dinkel-Süsskartoffel (Spiegel)', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300129', 'Edamamesauce mit Kokosmilch', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '486', 'Enchilada Burgersauce', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '4825', 'Erdbeer-Tonka Fruchtaufstrich', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '4824', 'Feigenchutney', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300151', 'Flammkuchenboden oval', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500066', 'Frittieröl Una', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '2641', 'Frischkäse', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '482045', 'Gemüsechips mit Meersalz', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300199', 'Gimme Gelato Vanille-Hafer', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300167', 'Gimme Gelato Schokolade', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300165', 'Gimme Gelato Erdbeersorbet', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300203', 'Gimme Gelato Erdbeersauce', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '54017', 'Guacamole', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500110', 'Hartkäse', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300159', 'Huhn', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300149', 'Kalbsschnitzel á 220 g', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500055', 'Karotten-Ingwer Aufstrich', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500085', 'Konjaknudeln', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300154', 'Küstendressing (Sanddorn)', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500115', 'Leerdammer Käse', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500058', 'Marinierter Sesam', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500105', 'Meerrettich frisch', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '301742', 'Mini-Baguette (Finedor)', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500097', 'Olivenöl', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '2210015', 'Trüffelöl', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500056', 'Pistaziencreme', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500083', 'Pistazien gehackt', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300090', 'Räucherlachs', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300072', 'Rinderroulade 300g', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '4815', 'Rotkohl', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500098', 'Schinkenspeckstreifen', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '306031', 'Schmand 5kg', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300142', 'Schweineschnitzel 120g', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300005', 'Scoop&Bake Cookie Dough TK', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300103', 'Serviettenknödel (optional)', 'Distra', NULL, true, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300092', 'Rote Beete Hummus TK', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300074', 'Tortellini Salmone', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300067', 'Veganes Schnitzel á 80g', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '300117', 'Veganes Beef', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '4262', 'Velouté', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '500002', 'Tomaten getrocknet', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '278', 'Ziegenkäserolle', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '496', 'Zitronensaft (Ersatzprodukt: Frozen Lemon 490)', 'Distra', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '10779231', 'Ahornsirup', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '60149869', 'Beerenmischung TK', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '60119733', 'Bergkäse in Scheiben', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '12852093', 'Bio Vollei Flüssig', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '60072397', 'Bircher Müsli', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '16996472', 'Brauner Zucker', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '16024755', 'Brie 3kg', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14418662', 'Butter-Rosetten', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '60121335', 'Burger Patty TK', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '60066131', 'Chicken Nuggets', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '60117348', 'Chocolate Chunks', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '12270859', 'Crema di Aceto', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '17799812', 'Dijon-Senf körnig', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14145643', 'Feta-Würfel', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '18528152', 'Fischstäbchen', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '60115453', 'Ei-Freilandei', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '12964994', 'Gemüsebrühe', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '10995631', 'Gewürzgurke', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14681677', 'Glutenfreies Brot TK (Optional)', 'Chefs Culinar', NULL, true, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '20076269', 'H-Milch 3,5% 10L', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '18459241', 'H-Milch 3,5% 1L', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '15955401', 'H-Sahne 30% (Sahnespender)', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '12121403', 'Hafertaler', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '60000937', 'HaYo von Naarmann', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '60088483', 'Hollandaise', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14234873', 'Honig flüssig', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '20058579', 'Honigschinken (1 Scheibe á 25g)', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '17165655', 'Isi-Sahnekapseln (Sahnespender: Alternative zur Sprühsahne)', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '12034628', 'Italienische Kräuter Wiberg', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '60106518', 'Kapernäpfel', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14111136', 'Kartoffelsalat', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '60067489', 'Ketchup', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14765995', 'Kichererbsen', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '10290019', 'Mayonnaise Remia', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '18039283', 'Muskatnuss gemahlen', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '15979049', 'Nutella mini', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '15792136', 'Nutella 750g (Glas)', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '18039474', 'Pfeffer weiß gemahlen', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '18039375', 'Pfefferkörner schwarz', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '16788367', 'Pinienkerne', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14172137', 'Preiselbeeren', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '20020194', 'Puderzucker', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '15955364', 'Quark Mager', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '11426738', 'Rapsöl', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '10173619', 'Rote Beete Würfel', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '18312386', 'Salz', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14414619', 'Sardellenfilet', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14694141', 'Schwarzer Sesam', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '60083726', 'Süßkartoffelsalat Kühlmann', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '16777170', 'Sonnenblumenkerne', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14467134', 'Spätzle', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '12446742', 'Spätzlekäse', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '18182736', 'Spianata Romana Salami (1 Scheibe á 7g)', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '10001783', 'Sprühsahne, 700ml (Alternative zum Sahnespender)', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '18652109', 'Steakhouse Pommes (Aviko)', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '18631364', 'Tafelessig', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '10168486', 'Tomaten gewürfelt (Dose)', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '20151782', 'Trennfett', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14038075', 'Ulmer Raspelschokolade', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '60115264', 'Vegane Pancakes', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '17676649', 'Walnusskerne Bruch', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '20020163', 'Zucker weiß', 'Chefs Culinar', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', NULL, 'Wilma Fähnchen', 'Wilmas Zauberladen', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', NULL, 'Anrichtering (Tatar)', 'Wilmas Zauberladen', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '11534665', 'Apfel', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '16310515', 'Avocado', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '23710015', 'Babyspinat', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '11500550', 'Birne', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '15610535', 'Cocktailtomaten', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '13298323', 'Dill', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '13330520', 'Gurke', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '11410510', 'Heidelbeeren', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '13298326', 'Kerbel', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '16250520', 'Kiwi', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '12520515', 'Limette', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '13298142', 'Minze', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '23148010', 'Salatmischung "Monaco"', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14310510', 'Paprika rot', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '13298320', 'Petersilie', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '24505020', 'Poree/Lauch geschnitten o. 14510510 (ganz)', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '15145515', 'Romanasalat', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '25112038', 'Rucola', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '15480510', 'Schlotten (Frühlingszwiebeln)', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '13298322', 'Schnittlauch', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '13298327', 'Thymian', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '11680510', 'Trauben dunkel', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '12502510', 'Zitrone', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '15900505', 'Zucchini', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '15790513', 'Zwiebel rot', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '15800510', 'Zwiebel weiß', 'CF Gastro', NULL, false, NULL, 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '10170755', 'Apfelkompott', 'Chefs Culinar', 'Regionale Gerichte', false, 'DD&Köln', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', NULL, 'Blutwurst', 'Chefs Culinar', 'Regionale Gerichte', false, 'Köln', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '16387904', 'Drillinge gekocht', 'Chefs Culinar', 'Regionale Gerichte', false, 'Hannover', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '18374339', 'Fleischwurst', 'Chefs Culinar', 'Regionale Gerichte', false, 'Mainz Ballplatz', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '17274920', 'Forellenfilet', 'Chefs Culinar', 'Regionale Gerichte', false, 'Freudenstadt', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14537301', 'Hackfleisch', 'Chefs Culinar', 'Regionale Gerichte', false, 'Passau', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '60100518', 'Harzer Bauernhandkäse', 'Chefs Culinar', 'Regionale Gerichte', false, 'Mainz', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14560118', 'Kartoffeln', 'Chefs Culinar', 'Regionale Gerichte', false, 'Viernheim', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14437212', 'Knoblauchwürfel TK', 'Chefs Culinar', 'Regionale Gerichte', false, 'Mainz', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '16107236', 'Kümmel', 'Chefs Culinar', 'Regionale Gerichte', false, 'Mainz Ballplatz', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '18027303', 'Landjäger', 'Chefs Culinar', 'Regionale Gerichte', false, 'Freudenstadt', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '14286384', 'Leberwurst', 'Chefs Culinar', 'Regionale Gerichte', false, 'Freudenstadt', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '18039344', 'Paprika edelsüß', 'Chefs Culinar', 'Regionale Gerichte', false, 'Mainz', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '17530972', 'Pflanzenfett', 'Chefs Culinar', 'Regionale Gerichte', false, 'Nürnberg', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '11139126', 'Sahne-Meerrettich', 'Chefs Culinar', 'Regionale Gerichte', false, 'Freudenstadt', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '10173350', 'Sauerkraut', 'Chefs Culinar', 'Regionale Gerichte', false, 'Speyer', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '13533618', 'Semmelbrösel', 'Chefs Culinar', 'Regionale Gerichte', false, 'Nürnberg', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '15809803', 'Senf mittelscharf', 'Chefs Culinar', 'Regionale Gerichte', false, 'Mainz, Speyer, Viernheim', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '20002336', 'Weizenmehl', 'Chefs Culinar', 'Regionale Gerichte', false, 'DD&Köln', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '306032', 'Bratensoße', 'Distra', 'Regionale Gerichte', false, 'Speyer, Passau', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '2803032', 'Papardelle TK', 'Distra', 'Regionale Gerichte', false, 'Nürnberg', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '48612', 'Kalbsjus', 'Distra', 'Regionale Gerichte', false, 'Stuttgart, Karlsruhe', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', NULL, 'Tafelspitz in Meerrettichsauce', 'Distra', 'Regionale Gerichte', false, 'Nürnberg', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Wilma Wunder', 'kueche', DATE '2026-04-13', '4818', 'Sauerbraten', 'Distra', 'Regionale Gerichte', false, 'Dresden, Köln, Düsseldorf', 'WW_PAL_Küche_Sommer-Standardkarte_2026.pdf'),
    ('Aposto', 'kueche', DATE '2026-01-01', '20020163', 'Feiner Zucker Raffinade EG 1Kg', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '14036460', 'Deutsche Markenbutter 250G', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '20020194', 'Puderzucker 250G', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '14357886', 'Kräuterbutter Rosetten', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '60115915', 'Bauernbrot TK', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '15404343', 'Pizza Tomatenpulpe Fein', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '18039337', 'Oregano Gerebelt', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '15955548', 'H-Sahne 20%', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '14354403', 'Kochschinken', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '12101153', 'Cranberrys', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '10234921', 'Imkerhonig', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '14467660', 'Snickers', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '12270859', 'Crema Di Aceto', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '18652932', 'TK Erdbeeren', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '13788728', 'Condimento Bianco', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '14607554', 'Aceto Balsamico', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '14690471', 'Gemüsebouillon', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '60119520', 'Pizza Salami', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '18039375', 'Pfeffer Schwarz', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '18039474', 'Pfeffer Weiß', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '12171583', 'Chilischoten', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '60115450', 'Carpaccio Rind', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '14437212', 'Knoblauchwürfel', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '14542145', 'Coleslawsalat', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '16126763', 'Chili Cheese Dip', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '17150514', 'Pesto Genovese', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '60079191', 'Carpaccio Kalb', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '17782937', 'Roasted Sesam Sauce', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '14030598', 'Tintenfischtuben', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '12143542', 'Gorgonzola Dolce', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '60037861', 'Frutti di Mare', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '10887516', 'Mango Scheiben', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '10187241', 'Kapern', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '60146333', 'Lasagne Kalb', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '18129533', 'Lasagne Ricotta Spinat', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '60183982', 'Pizzateigling Aposto', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '18312386', 'Speisesalz', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '10173541', 'Pizza Sauce', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '60068070', 'Bedda Pizza Käse', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '60003825', 'Mutti Pastasauce', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '14388842', 'Meersalz', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '11032510', 'Ananas Sweet', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '12700510', 'Auberginen', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '13298340', 'Basilikum', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '21993010', 'Blattsalatmix', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '13880515', 'Kartoffel Drillinge', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '13330520', 'Gurken', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '12520515', 'Limetten', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '13298142', 'Minze', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '24162008', 'Karottenstifte', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '14350510', 'Paprika Mix', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '14370510', 'Peperoni Rot', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '13298320', 'Petersilie', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '16561515', 'Portobello Pilze', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '13298328', 'Rosmarin', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '25112038', 'Rucola', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '23710015', 'Spinat Baby', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '15580505', 'Tomaten', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '12502510', 'Zitronen', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '15900505', 'Zucchini', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '15800510', 'Zwiebeln', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '25794120', 'Zwiebel Rot geschält', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '46010027', 'Burrata', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '15145515', 'Romana Salatherzen', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '12342510', 'Orangen', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '15620560', 'Tomaten Cherry Mix', 'CF Gastro', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '300028', 'Rumpsteak', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '482', 'Balsamicodressing Hell', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '54017', 'Guacamole', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '300091', 'Lachsportion', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '301732', 'Baguette de Paris', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '2803032', 'Pappardelle Grande', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '1037', 'Hähnchenbrustfilet', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '1035', 'Hähnchenbruststreifen', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '393', 'Garnele Vannamei', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '300005', 'Vanilla Cookie', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '4620', 'Pizzagewürz', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '500110', 'Hartkäse Flakes', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '500029', 'Landschinken', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '500113', 'Mozzarella gerieben', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '777822', 'Salsiccia Napoli', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '278', 'Ziegenrolle', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '281', 'Crispmehl', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '777821', 'Crema Tartuffo', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '6747', 'Thunfisch in Öl', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '2210015', 'Trüffelöl', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '300110', 'Rinderstreifen', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '500087', 'Vitello Sauce', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '300135', 'Thunfischtatar', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '500080', 'Caesar Dressing', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '300120', 'Chicken Tinga', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '300121', 'Pulled Beef Barbacoa', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '306029', 'BBQ Dip', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '300117', 'Veganes Beef', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '300134', 'Carbonara Sauce', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '300131', 'Agnolotti Feige Pecorino', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '300130', 'Spaghettinester', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '300094', 'Rigatoni', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '4551', 'Bolognese Sauce', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '500085', 'Shirataki Udon', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '300145', 'Pizzateig Protein', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '500097', 'Olivenöl 5L', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '306034', 'Aioli', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '492001', 'Himbeeren TK', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'kueche', DATE '2026-01-01', '263', 'Mozzarella gerieben', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Küche'),
    ('Aposto', 'bar', DATE '2026-01-01', '10170335', 'Drey Honig Portionspackung', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '14866661', 'Kaffeesahne', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '20183820', 'Zuckersticks', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '10001783', 'Debic Sprühsahne', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '15640277', 'Rohrzucker Weiß', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '18217568', 'Haferdrink', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '18459173', 'H-Milch 1,5%', 'Chefs Culinar', 'Eiskarte', false, NULL, 'PAL Aposto 2026.xlsx / Bar / PAL Aposto 2026.xlsx / Eiskarte'),
    ('Aposto', 'bar', DATE '2026-01-01', '12604777', 'Amarettini', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '18459241', 'H-Milch 3,5%', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '18651676', 'TK Melonenbällchen', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '60149869', 'TK Beerenmix', 'Chefs Culinar', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '60169268', 'H-Kakao Gourmet', 'Chefs Culinar', 'Eiskarte', false, NULL, 'PAL Aposto 2026.xlsx / Bar / PAL Aposto 2026.xlsx / Eiskarte'),
    ('Aposto', 'bar', DATE '2026-01-01', '9501', 'Aperol', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '756', 'Averna', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '964', 'Baileys', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '604', 'Frangelico', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '934', 'Kahlua', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '5271', 'Lillet Blanc', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '4146', 'Grappa Nonino', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '750', 'Ramazzotti', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '9712', 'Smirnoff Red', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '200012', 'Sarti Rosa', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '7884', 'Martini Floreale', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '90141', 'Apricot Brandy', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '90171', 'Cachaca', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '90161', 'Basic Dry Gin', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '90121', 'Triple Sec', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '9982', 'Overproof Rum', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '90152', 'Basic Vodka', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '200030', 'Long Island Mix', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '9771', 'Gordons Pink', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '515', 'Hendricks Gin', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '540', 'Malfy Limone', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '526', 'Tanqueray Gin', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '200147', 'Grenadine Sirup', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '9085', 'Holunderblütensirup', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '200137', 'Rohrzucker Sirup', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '200149', 'Kokossirup', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '108817', 'Minzlimo Sirup', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '108816', 'Himbeerlimo Sirup', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '108819', 'Blaubeer Honig Sirup', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '757', 'Campari', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '7471', 'Jim Beam', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '751', 'Likör 43', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '747', 'Jack Daniels', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '77831', 'Limoncello', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '9891', 'Cointreau', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '3805081', 'Zitronensaft Frisch', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '955', 'Bacardi Rum', 'Distra', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Acqua Panna Mw 16X0,75L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Acqua Panna Mw 24X0,25L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Allg. Büble Afrei Bv', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Allg. Büble Edelweiss', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Bierra Moretti', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Bitburger Alkoholfrei Ln 24X0,33L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Bitburger Premium Pils 30L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Büble Edelweißbier 30L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Fever-Tree Mediterreaneum Tonic', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Granini Ananas Mw 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Granini Apfel Trüb Mw 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Granini Banane Mw 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Granini Cranberry Mw 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Granini Guave Drachenfrucht', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Granini Johannisbeer Mw 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Granini Kirsch Mw 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Granini Lime Juice Cord.', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Granini Maracuja Mw 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Granini Orangen Saft Mw 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Granini Pfirsich Mw 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Granini Zitronensaft', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Köstritzer Edel Pils 50L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Köstritzer Kellerbier 30L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Köstritzer Schwarzbier 30L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Mirinda Orange Postm.bib', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Pepsi Cola Bib 10L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Pepsi Zero Zucker Mw 24X0,20L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Red Bull Energy Ds-P 24X0,25L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'San Pellegrino Mw 16X0,75L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'San Pellegrino Mw 24X0,25L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Schweppes Bitter Lemon Mw 24X0,20L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Schweppes Bitter Lemon Pet 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Schweppes Dry Tonic Water 24X0,20L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Schweppes Ginger Ale Mw 24X0,20L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Schweppes Ginger Ale Pet 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Schweppes Ginger Beer Mw 24X0,20L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Schweppes Pomegranate 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Schweppes Tonic Water Mw 24X0,20L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Schweppes Tonic Water Pet 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Schweppes White Peach 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Schweppes Wild Berry Pet 6X1,0L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', NULL, 'Seven Up Bib 10L', 'GFGH', NULL, false, NULL, 'PAL Aposto 2026.xlsx / Bar'),
    ('Aposto', 'bar', DATE '2026-01-01', '14038075', 'Ulmer Raspelschokolade', 'Chefs Culinar', 'Eiskarte', false, NULL, 'PAL Aposto 2026.xlsx / Eiskarte'),
    ('Aposto', 'bar', DATE '2026-01-01', '15955401', 'H-Schlagsahne', 'Chefs Culinar', 'Eiskarte', false, NULL, 'PAL Aposto 2026.xlsx / Eiskarte'),
    ('Aposto', 'bar', DATE '2026-01-01', '11137825', 'Oreo Cookies', 'Chefs Culinar', 'Eiskarte', false, NULL, 'PAL Aposto 2026.xlsx / Eiskarte'),
    ('Aposto', 'bar', DATE '2026-01-01', '60036474', 'Raspelschokolade Weiss', 'Chefs Culinar', 'Eiskarte', false, NULL, 'PAL Aposto 2026.xlsx / Eiskarte'),
    ('Aposto', 'bar', DATE '2026-01-01', '14083310', 'Zuckerperlen Bunt', 'Chefs Culinar', 'Eiskarte', false, NULL, 'PAL Aposto 2026.xlsx / Eiskarte'),
    ('Aposto', 'bar', DATE '2026-01-01', '60053764', 'Schokosauce Vegan', 'Chefs Culinar', 'Eiskarte', false, NULL, 'PAL Aposto 2026.xlsx / Eiskarte'),
    ('Aposto', 'bar', DATE '2026-01-01', '500042', 'Kokoschips Kakao', 'Distra', 'Eiskarte', false, NULL, 'PAL Aposto 2026.xlsx / Eiskarte'),
    ('Aposto', 'bar', DATE '2026-01-01', '500041', 'Popcornmischung Cinemix', 'Distra', 'Eiskarte', false, NULL, 'PAL Aposto 2026.xlsx / Eiskarte'),
    ('Aposto', 'bar', DATE '2026-01-01', '300167', 'Schokoladen Milcheis', 'Distra', 'Eiskarte', false, NULL, 'PAL Aposto 2026.xlsx / Eiskarte'),
    ('Aposto', 'bar', DATE '2026-01-01', '300166', 'Mangosorbet Eis', 'Distra', 'Eiskarte', false, NULL, 'PAL Aposto 2026.xlsx / Eiskarte'),
    ('Aposto', 'bar', DATE '2026-01-01', '300165', 'Erdbeersorbet Eis', 'Distra', 'Eiskarte', false, NULL, 'PAL Aposto 2026.xlsx / Eiskarte'),
    ('Aposto', 'bar', DATE '2026-01-01', '300168', 'Vanille Milcheis', 'Distra', 'Eiskarte', false, NULL, 'PAL Aposto 2026.xlsx / Eiskarte'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '10165003', 'Gemuesemais Jung Zart 2650Ml', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '10169674', 'Ananas Stücke 3100ml', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '11426738', 'Rapsöl 10L', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '12131648', 'Kuchm.Milchbroetchen 10St/400G', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '13327910', 'Frischli Bourbon-Vanille-Sauce 1L', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '18858570', 'Grana Padano Pdo Gehobelt 32% 500G', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '14357886', 'Tk Megg.kraeuterbutt.-Roset.100X10G', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '15465313', 'Jalapeno Chili Scheiben Grue.2,89Kg', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '60149171', 'Cheddar Scheiben 50% 50 x 20 g (PK 1 KG)', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '16107960', 'Wib.Zimt Gemahlen 1Kg', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '16126763', 'Starline Chili Cheese Dip 850g', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '16283695', 'Tk Aviko Super Crunch 7Mm 2,5Kg', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '18039405', 'Bc Pfeffer Schwarz Gemahlen 1Kg', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '18312294', 'Gustosal Speisesalz Unjodiert 10Kg', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '60149869', 'TK-Beerenmix ohne Erdbeeren 2,5 kg / BT', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '18651645', 'Tk Maiskolben 48X230G', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '18374674', 'Kokosnussmilch 1L', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '20020163', 'Feiner Zucker Raffinade Eg I 1Kg', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '20020194', 'Puderzucker 250G', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '60067489', 'Sc Tomatenketchup 875Ml', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '60067494', 'Sc Salatmayonnaise 50% 875Ml', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '60072376', 'Starline Jalapeno Bbq Dip 850g', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '60073794', 'Thai.langk.jasmin Duftreis 20Kg', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '60096179', 'Bc Saure Sahne 10% 5Kg', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '60115919', 'Tk Gimme Sosse mit Kakao 3X1L', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '60125115', 'Tk Sueßkart. Pommes 9x9mm "Cf" 2,5Kg', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '80030011', 'Alpro Soja-Joghurt Alt.natur 400G', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Chefs Culinar'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '393', 'Garnelen Geschält Vannamei 26/30 roh TK', 'Distra', 'Fleischwaren / Veg. Produkte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '1035', 'Hähnchenbruststreifen Gewürzt Tk Karton', 'Distra', 'Fleischwaren / Veg. Produkte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '1038', 'Chicken Wings Bbq Tk Karton', 'Distra', 'Fleischwaren / Veg. Produkte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '1040', 'Bacon In Scheiben Schale', 'Distra', 'Fleischwaren / Veg. Produkte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '40271', 'Hamburger 150g Tk Karton', 'Distra', 'Fleischwaren / Veg. Produkte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '48630', 'Chimichurri Pulled Planted Tk', 'Distra', 'Fleischwaren / Veg. Produkte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '300028', 'Rumpsteak Ohne Fett 200Gr. Tk Karton', 'Distra', 'Fleischwaren / Veg. Produkte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '300060', 'Redefine Beef Flank 10x0,3kg TK', 'Distra', 'Fleischwaren / Veg. Produkte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '300078', 'Redefine Burger 100g TK', 'Distra', 'Fleischwaren / Veg. Produkte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '300080', 'Cauli Wings Tk Karton 1kg', 'Distra', 'Fleischwaren / Veg. Produkte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '300081', 'Homestyle Chik´n Burger 120G Karton', 'Distra', 'Fleischwaren / Veg. Produkte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '300120', 'Chicken Tinga Tk 12x0,5Kg', 'Distra', 'Fleischwaren / Veg. Produkte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '300121', 'Pulled Beef Barbacoa Tk 12x0,5Kg', 'Distra', 'Fleischwaren / Veg. Produkte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '482', 'Balsamicodressing hell Tk', 'Distra', 'Saucen / Dips / Dressing', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '486', 'Enchilada Burgersauce Vegan', 'Distra', 'Saucen / Dips / Dressing', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '488', 'Salsa Mexicana Verde Dose', 'Distra', 'Saucen / Dips / Dressing', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '4262', 'Veloute', 'Distra', 'Saucen / Dips / Dressing', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '48613', 'Chipotle Salsa Cremosa Tk', 'Distra', 'Saucen / Dips / Dressing', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '48614', 'Salsa Tk Karton', 'Distra', 'Saucen / Dips / Dressing', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '54017', 'Guacamole 6X1Kg Tk', 'Distra', 'Saucen / Dips / Dressing', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '306032', 'Braten-Sauce bayrische Art 10Kg Eimer', 'Distra', 'Saucen / Dips / Dressing', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '500049', 'La Costena Chipotle Sauce', 'Distra', 'Saucen / Dips / Dressing', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '500051', 'La Costena Chipotle Sauce', 'Distra', 'Saucen / Dips / Dressing', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '2302091', 'Caesar Dressing Schale 1Kg', 'Distra', 'Saucen / Dips / Dressing', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '6800', 'Schwarze Bohnen', 'Distra', 'Salat / Topping / Reis / Dosen', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '500019', 'Rotkrautsalat Enchilada', 'Distra', 'Salat / Topping / Reis / Dosen', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '500081', 'Pickled Onions Geld 3kg Eimer', 'Distra', 'Salat / Topping / Reis / Dosen', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '2510026', 'Quinoa Bunt 2Kg Beutel', 'Distra', 'Salat / Topping / Reis / Dosen', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '268', 'Cheddar / Gouda Mix', 'Distra', 'Milchprodukte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '2641', 'Frischkäse Eimer 2,5Kg', 'Distra', 'Milchprodukte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '300033', 'Knoblauchbutter 6kg TK', 'Distra', 'Milchprodukte', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '4046', 'Burger Buns Mais vegan 85G Tk', 'Distra', 'Teigwaren', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '37219', 'Rote Beete Tortillas 30cm Tk', 'Distra', 'Teigwaren', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '110141', 'Komali Maistortillas Gelb 15cm', 'Distra', 'Teigwaren', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '200304', 'Churros Vorfrittiert Tk', 'Distra', 'Teigwaren', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '300042', 'Maistortilla 15cm rot Tk', 'Distra', 'Teigwaren', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '300043', 'Maistortilla 15cm grün Tk', 'Distra', 'Teigwaren', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '300058', 'Maistortilla 15cm gelb Tk', 'Distra', 'Teigwaren', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '300128', 'Vegan Chocolate Lava Cake TK', 'Distra', 'Teigwaren', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '301735', 'Balkan Fladenbrot 100g TK', 'Distra', 'Teigwaren', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '500075', 'Weitzentortillas 20 cm', 'Distra', 'Teigwaren', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '500076', 'Weizentortilla 16cm', 'Distra', 'Teigwaren', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '500077', 'Weizentortillas 30cm', 'Distra', 'Teigwaren', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '661', 'Enchilada Würzmischung Beutel', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '662', 'Fajita Gewürzzubereitung Beutel', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '664', 'Pepper Crust Beutel 1Kg', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '1300', 'Tortilla-Wärmer Sombrero', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '1558', 'Anhängeetiketten Molcajete Guacamole Pack 100 Stk', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '1589', 'Lagerungsetikett Wasserlöslich Rolle 500Stk.', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '13923', 'Serviette naturbraun klein 20x20', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '15161', 'Take Away Karton Boxen 600Ml', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '15162', 'Take Away Karton Boxen 1200Ml', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '15163', 'Take Away Karton Boxen 1500Ml', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '15197', 'Papiertragetaschen', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '200151', 'Giffard Falernum Sirup 1,0L', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '400066', 'Saucenbecher Pla 2Oz/60Ml Karton 20X100', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '400067', 'Saucenbecher Pla 3Oz/90Ml Karton 20X100', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '400068', 'Deckel Pla Zu Saucenbecher 60Ml+90Ml Karton 2X100', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '400229', 'Pergamentpapier Enchilada 16X16cm', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '400236', 'Serviette naturbraun schmal 40x40', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '400336', 'Nitrilhandschuhe schwarz S Box 100Stk.', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '400337', 'Nitrilhandschuhe schwarz M Box 100Stk.', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '400338', 'Nitrilhandschuhe schwarz L Box 100Stk.', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '400339', 'Nitrilhandschuhe schwarz XL Box 100Stk.', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '400399', 'Gewürzmischung f. Quark', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '500050', 'Mais Frito (Pikant) Beutel 1,5kg', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', '500066', 'Una Frittieröl 10L Bib Pure Box', 'Distra', 'Gewürze und sonstiges', false, NULL, '2026 PAL Enchilada.xlsx / Küche Distra'),
    ('Enchilada', 'kueche', DATE '2026-01-01', NULL, 'Avocado frisch, gross', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Gemüse'),
    ('Enchilada', 'kueche', DATE '2026-01-01', NULL, 'Babyspinat', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Gemüse'),
    ('Enchilada', 'kueche', DATE '2026-01-01', NULL, 'Koriander, Bund', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Gemüse'),
    ('Enchilada', 'kueche', DATE '2026-01-01', NULL, 'Limetten, Kiste', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Gemüse'),
    ('Enchilada', 'kueche', DATE '2026-01-01', NULL, 'Minze', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Gemüse'),
    ('Enchilada', 'kueche', DATE '2026-01-01', NULL, 'Paprikamix', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Gemüse'),
    ('Enchilada', 'kueche', DATE '2026-01-01', NULL, 'Radieschen', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Gemüse'),
    ('Enchilada', 'kueche', DATE '2026-01-01', NULL, 'Romana Salat Herzen', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Gemüse'),
    ('Enchilada', 'kueche', DATE '2026-01-01', NULL, 'Sommermix 6 Mixsalat', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Gemüse'),
    ('Enchilada', 'kueche', DATE '2026-01-01', NULL, 'Strauchtomaten', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Gemüse'),
    ('Enchilada', 'kueche', DATE '2026-01-01', NULL, 'Zucchini frisch', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Gemüse'),
    ('Enchilada', 'kueche', DATE '2026-01-01', NULL, 'Zwiebel Rot', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Küche Gemüse'),
    ('Enchilada', 'bar', DATE '2026-01-01', '18459241', 'H-Milch 3,5% Eu Drehverschluss 1L', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '18651614', 'Tk Beerenmix Extra M.erdb. 2,5Kg', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '14625268', 'Sc Karamellgebaeck 300/1Er', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '17012744', 'Bc Streu Ds.wacholderbeeren 400G', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '18374674', 'Kokosnussmilch 1L', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '18777062', 'Paloma Pink Grap.lem.dpg Ds0,33L', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '60052997', 'Tk Erdbeeren Cama. 2,5Kg', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '15640277', 'Rohrzucker Weiss 500G', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '14031106', 'Drey Bio Agavensirup 180Ml', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '20020163', 'Feiner Zucker Raffinade Eg I 1Kg', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '15603067', 'Alpro Mandel Drink Original 1L', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '10378403', 'Duni Erfrischungstuecher', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '18851298', 'Cool Soft Kaubonbons Vegan 1Kg', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '12583812', 'Becher Milchaufschaeumer reiniger 1L', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '10098929', 'Becher Kaffeemaschinen Reiniger 1Kg', 'Chefs Culinar', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Chefs Culinar'),
    ('Enchilada', 'bar', DATE '2026-01-01', '90141', 'Apricot Brandy 20%', 'Distra', 'BASIC', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '90131', 'Cherry Likör 20%', 'Distra', 'BASIC', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '90171', 'Cachaca 38%', 'Distra', 'BASIC', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '90111', 'Tequila Silver 38%', 'Distra', 'BASIC', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '90121', 'Curacao Triple Sec 22%', 'Distra', 'BASIC', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '90152', 'Basic Vodka 37,5%', 'Distra', 'BASIC', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '90161', 'Basic Dry Gin 37,5%', 'Distra', 'BASIC', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '9982', 'Basic Dark Overproof Rum 73%', 'Distra', 'BASIC', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '90101', 'Basic White Rum 37,5%', 'Distra', 'BASIC', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200030', 'Basic Long island Mix 34%', 'Distra', 'BASIC', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200036', 'Basic Coconut Rum Liqueur 21%', 'Distra', 'BASIC', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200037', 'Basic Peach Liqueur 16%', 'Distra', 'BASIC', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200163', 'Shaker´s Choice No 13 Melone 17% 1,0l', 'Distra', 'BASIC', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '529', 'Ketel One', 'Distra', 'Vodka', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '9712', 'Smirnoff Red', 'Distra', 'Vodka', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '732', 'Havana Club Anejo 7 Anos', 'Distra', 'Rum', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '774', 'Ron Zacapa 23y', 'Distra', 'Rum', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '955', 'Bacardi Rum', 'Distra', 'Rum', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '7302', 'Havana Club Anejo 3 Anos', 'Distra', 'Rum', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '7601', 'Captain Morgan', 'Distra', 'Rum', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '9550', 'Bacardi Razz', 'Distra', 'Rum', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '78851', 'Captain Morgan Dark Rum', 'Distra', 'Rum', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200028', 'Don Papa 7 40% 0,7l', 'Distra', 'Rum', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200115', 'Captain Morgan S.G. 0,0% 0,7l', 'Distra', 'Rum', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200155', 'Rum Bacardi Carta Oro', 'Distra', 'Rum', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200192', 'Malfy con arancia 0,7 41%', 'Distra', 'GIN', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '515', 'Hendrick´s Gin', 'Distra', 'GIN', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '517', 'Monkey 47 Gin', 'Distra', 'GIN', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200046', 'Bombay Pressé', 'Distra', 'GIN', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '5264', 'Tanqueray Flor de Sevilla', 'Distra', 'GIN', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '9772', 'Gin Brockmans Agave Cut', 'Distra', 'GIN', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '712', 'Tequila Don Julio Reposado', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '713', 'Tequila Don Julio Anejo', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '714', 'Tequila Patron Blanco', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '715', 'Tequila Patron Reposado', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '716', 'Tequila Patron Anejo', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '719', 'Tequila Don Julio Blanco', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '722', 'San Cosme Mezcal', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '743', 'Mezcal Gusano Rojo', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '936', 'Tequila Olmaca Altos Reposado 38% 0,7l', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '937', 'Tequila Olmeca Altos Plata 38% 0,7l', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200031', 'Corralejo Gran Anejo 38% 1l', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200032', 'Corralejo 99000 Horas 38% 0,7l', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200033', 'Corralejo Anejo 38% 0,7l', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200035', 'Corralejo Blanco 38% 0,7l', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200128', 'Tequila Teremana Blanco 40 % 0,7 Fl', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200129', 'Tequila Teremana Reposado 40 % 0,7l Fl', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200131', 'Tequila Teremana Anejo  40 % 0,7 Fl', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200156', 'Corralejo Reposado 38% 0,7l', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200161', 'Corralejo Tequila Likör 20% 0,7l', 'Distra', 'Tequila/Mezcal', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '773', 'Bulleit Bourbon', 'Distra', 'Whisky', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '7471', 'Jim Beam', 'Distra', 'Whisky', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '7886', 'Auchentoshan 12Y.o.', 'Distra', 'Whisky', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '605', 'Angostura Bitters', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '750', 'Ramazotti Amaro', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '751', 'Likör 43', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '767', 'Jägermeister', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '934', 'Kahlua', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '4450', 'Dos Mas Zimtlikör', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '5271', 'Lillet Blanc', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '9021', 'De Kuyper Blue Curacao', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '9501', 'Aperol', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '58155', 'Warninks Lemon Cheesecake', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '77751', 'Berliner Luft', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200012', 'Aperitif Sarti Rosa 17% 0,7l', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200015', 'Liokos Mundfeuerwerk (Mexikaner)', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200112', 'Jägermeister Manifest', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200196', 'Giffard Spritz alkoholfrei', 'Distra', 'Aperetivs, Bitters & Co.', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200120', 'Holunderblütensirup 0% Zuckerfrei 0,7L', 'Distra', 'PÜREES & SIRUPE', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200137', 'Giffard Rohrzuckersirup', 'Distra', 'PÜREES & SIRUPE', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200141', 'Giffard Vanille Sirup 1,0L', 'Distra', 'PÜREES & SIRUPE', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200147', 'Giffard Grenadine Sirup 1,0L', 'Distra', 'PÜREES & SIRUPE', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200151', 'Giffard Falernum Sirup 1,0L', 'Distra', 'PÜREES & SIRUPE', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200153', 'Giffard Fruit F. Mix Maracuja', 'Distra', 'PÜREES & SIRUPE', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200154', 'Giffard Fruit f. Mix Mango Pet 1,0l', 'Distra', 'PÜREES & SIRUPE', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200185', 'Giffard Fruit f. Mix Banane Pet 1,0l', 'Distra', 'PÜREES & SIRUPE', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200186', 'Giffard Fruit f. Mix Kiwi Pet 1,0l', 'Distra', 'PÜREES & SIRUPE', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200187', 'Giffard Fruit f. Mix Ananas Pet 1,0l', 'Distra', 'PÜREES & SIRUPE', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200188', 'Giffard Fruit f. Mix Sour Apple  Pet 1,0l', 'Distra', 'PÜREES & SIRUPE', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '500011', 'Horchata Konzentrat 0,7l', 'Distra', 'PÜREES & SIRUPE', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '10953', 'Hausgemachter Eistee Sirup 3Kg Kanister', 'Distra', 'HAUSGEMACHTE SIRUPE', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '496', 'Zitronensaft Tk Karton 6 X 1L', 'Distra', 'SÄFTE', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '779112', 'Secco Bianco Frizzante 0,75l', 'Distra', 'Sekt', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '779160', 'Kessler Sekt 0,75L', 'Distra', 'Sekt', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '779103', 'Manana Vino Blanco 0,75l', 'Distra', 'Weißwein', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '779105', 'Casa Santos Lima Lisboa Blanco Share', 'Distra', 'Weißwein', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200177', 'Weiß Rafa Canizares Sauvignon 0,75l', 'Distra', 'Weißwein', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '779107', 'Manana Vino Rosado 0,75l', 'Distra', 'Rosé', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '779108', 'Manana Vino Tinto 0,75l', 'Distra', 'Rotwein', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '779110', 'Rot Casa Santos Lima Lisboa Share', 'Distra', 'Rotwein', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200178', 'Rot Real Cranza Rioja Doca 0,75l', 'Distra', 'Rotwein', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '6750', 'Orangenscheibe Gedörrt', 'Distra', 'DÖRROBST', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '1524', 'Anhängeetiketten Enchilada Pack 250 Stk.', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '1582', 'Thermorollen', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '1589', 'Lagerungsetikett Wasserlöslich Rolle 500 Stk.', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '1598', 'Thermorollen für Drucker mit Bewirtung', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '13923', 'Servietten 20x20', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '14200', 'Kerze 36 Stunden Für Kerzenglas Karton', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '78127', 'Trinkhalme Cremeweiß', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '200193', 'Fee Foam 150ml', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '400100', 'Trinkbecher Pla 0,5L', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '400101', 'Deckel Flach Für Becher 0,3-0,5L', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '400179', 'Becher 0,3l ToGo', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '400236', 'Servietten 40x40', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '500042', 'Kokoschips mit Kakao', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '500052', 'Tajin (Fruit Seasonning) Flasche', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '638134', 'Ausgießer 0,7l Silikon', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '638136', 'Ausgießer 1,0l Schwarz für Sirupe', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', '638137', 'Ausgießer 1,0l Schwarz', 'Distra', 'SONDERARTIKEL', false, NULL, '2026 PAL Enchilada.xlsx / Bar Distra'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Zitronen', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Obst und Gemüse'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Orangen', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Obst und Gemüse'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Limetten(Kiste 4,5Kg)', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Obst und Gemüse'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Minze', 'CF Gastro', NULL, false, NULL, '2026 PAL Enchilada.xlsx / Bar Obst und Gemüse'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Fentimens Indian Tonic 0,2', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Schweppes Bitterlemon 24x0,2', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Schweppes Indian Tonic Water 24x0,2', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Schweppes Ginger Beer 24x0,2', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Schweppes Russian Wildberry 6x1,0', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Schweppes White Peach 24x0,2', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Granini Ananas 6x1,0', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Granini Apfelsaft naturtrüb 6x1,0', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Granini Cranberry 6x1,0', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Granini Johannisbeernektar 6x1,0', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Granini Kirschnektar 6x1,0', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Granini Maracujanektar 6x1,0', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Granini Orangensaft 6x1,0', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Granini Lemon Squash 6x1,l', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Granini Pfirsichnektar 6x1,0', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Granini Pink Grapefruit 6x1,0', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Selters Classic 20x0,5', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Selters Naturell 20x0,5', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, '7UP BiB', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Mirinda BiB', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Pepsi BiB', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Pepsi Maxx 24x0,33', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Red Bull', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Red Bull Zero', 'GFGH', 'ALKOHOLFREIE GETRÄNKE', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH'),
    ('Enchilada', 'bar', DATE '2026-01-01', NULL, 'Bierdeckel', 'GFGH', 'SONSTIGES', false, NULL, '2026 PAL Enchilada.xlsx / Bar GFGH')
ON CONFLICT DO NOTHING;



INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0094', to_jsonb(
        'Pflichtartikellisten fuer Wilma Wunder, Aposto und Enchilada — 765 '
        'Positionen aus zwei PDF und zwei XLSX. Die Leitzahl ist NICHT die '
        'Erfuellung, sondern der Anteil des Einkaufs, der an der Liste '
        'vorbeilaeuft (mart.pflichtartikel_betrieb.abseits_pct). Drei '
        'Messungen haben den Bau bestimmt: der Schluessel ist '
        'bestellposition.lieferanten_nr und nicht ware.fn_id (10,1 Prozent '
        'Treffer gegen 100), der Bereich Kueche/Bar darf NICHT mitjoinen '
        '(Aposto Bar bestellt Mozzarella und Pizzateig: 80,7 Prozent abseits '
        'mit Bindung, 34,1 ohne), und Artikelnummern wechseln, waehrend die '
        'Liste stehenbleibt (Cheddar/Gouda Mix von 268 auf 500096, 124.936 '
        'EUR). Deutsche Konzepte hat keine Liste und bleibt aussen vor.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;

-- ---------------------------------------------------------------------
-- 19. Die drei Materialisierungen befuellen
--
-- WARUM DAS HIER STEHEN MUSS. `CREATE MATERIALIZED VIEW ... AS SELECT`
-- fuellt sofort — mit dem Stand von DIESEM Augenblick. Die Sichten
-- entstehen in Abschnitt 7, 8 und 10, die Listen kommen aber erst in
-- Abschnitt 18 dazu. Ohne diesen Block endet die Migration fehlerfrei und
-- hinterlaesst drei leere Sichten; die Seite zeigt dann nichts, und
-- "nichts" sieht aus wie "keine Beanstandungen" (Regel 10).
--
-- Beim ersten Mal absichtlich OHNE CONCURRENTLY: das braucht einen
-- vorhandenen Stand, den es hier noch nicht gibt (PG 55000, die Lehre aus
-- 0084 und src/sync/auffrischen.ts). Ab dem naechsten Lauf uebernimmt
-- src/sync/pflichtartikel_sichten.ts den nebenlaeufigen Weg.
--
-- Die Reihenfolge ist bindend: die beiden unteren lesen die obere.
-- ---------------------------------------------------------------------
REFRESH MATERIALIZED VIEW mart.pflichtartikel_klassifikation_basis;
REFRESH MATERIALIZED VIEW mart.pflichtartikel_einkauf_basis;
REFRESH MATERIALIZED VIEW mart.pflichtartikel_artikel_basis;
