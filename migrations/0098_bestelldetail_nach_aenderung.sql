-- =====================================================================
-- 0098 — Bestelldetails werden geholt, wenn sich etwas GEAENDERT hat
--
-- ANLASS (25.08.2026, Eugene): "stelle sicher, dass bei FoodNotify nicht
-- die ganze Zeit die gleichen Bestellungen mehrfach abgerufen werden,
-- sondern dass es sauber jeweils nur einmal passiert."
--
-- ─────────────────────────────────────────────────────────────────────
-- WAS GEMESSEN WURDE
--
-- `bestelldetailsAuffrischen()` holte bis heute JEDE Bestellung der
-- letzten 45 Tage jede Nacht neu, sofern ihr Status weder `canceled` noch
-- `finished` war. Das waren 2.960 Bestellungen mal zwei Endpunkte =
-- 5.920 Aufrufe je Nacht, rund 16 % der Laufzeit.
--
-- Die Statusbedingung greift dabei praktisch nie: `finished` gibt es
-- 13 Mal in 67.632 Bestellungen. Eine Bestellung verlaesst das Fenster
-- also nicht ueber ihren Status, sondern nur, indem sie 45 Tage alt wird.
--
-- WAS DIE AUFFRISCHUNG EINBRACHTE, ueber `raw.payload_hash` nachgerechnet:
--
--   Positionen: 322 von 400 Antworten aenderten sich auf Rohebene — aber
--   NULL von 400 im Inhalt der Bestellung. Was sich aenderte, war
--   `concreteProduct.stock` (der aktuelle Lagerbestand des Artikels),
--   `timeModified` des Artikelstamms und `productStockDetails`. Menge,
--   Preis, Status: unveraendert.
--
--   Koepfe: 87 % aenderten sich nie. Von 408 Aenderungen lagen 277 in den
--   ersten drei Tagen, 189 bis Tag sieben, 6 bis Tag 14 — und KEINE
--   danach.
--
-- DER LAGERBESTAND IST FUER UNS KEIN DATUM. `core.bestellposition` hat
-- keine Lagerspalte, und das ist richtig so: der Wert in der Antwort ist
-- der Bestand ZUM ABRUFZEITPUNKT, nicht der zur Bestellung. Er taugt
-- deshalb grundsaetzlich nicht dazu, den Verbrauch einer Zutat
-- nachzuvollziehen — dafuer braeuchte es eine eigene Zeitreihe, und die
-- gibt es bei FoodNotify bereits als Inventur (`/api/erp/stocktakings`,
-- `theoreticalStockLevelInBaseUnits`), die dieses Projekt laedt.
--
-- ─────────────────────────────────────────────────────────────────────
-- WAS SICH AENDERT
--
-- Nicht die Haeufigkeit, sondern der AUSLOESER. Statt "alles, was juenger
-- als 45 Tage ist" gilt jetzt: "alles, dessen LISTENEINTRAG sich seit dem
-- letzten Detailabruf geaendert hat".
--
-- Die Bestellliste (`fn:bestellungen`) wird ohnehin in jedem Lauf geholt
-- und traegt GENAU die Felder, die sich aendern: `shopOrderStatus`,
-- `shopOrderInvoices`, `shopOrderDeliveryNote`, `extDeliveryNoteId`,
-- `billingSyncStatus`, `total`, `markedShopOrder`, `comment`,
-- `updatedByUser`. Einen Lagerbestand enthaelt sie NICHT — das Rauschen,
-- an dem `payload_hash` scheitert, gibt es hier gar nicht.
--
-- ZWEI SPALTEN STATT EINER, und das ist der ganze Trick:
--
--   listen_fingerabdruck   was die Liste zuletzt gesagt hat
--   detail_fingerabdruck   fuer welchen Listenstand das Detail geholt wurde
--
-- Sind beide gleich, ist das Detail aktuell. Sind sie verschieden, gibt es
-- Arbeit. Der Zustand steht damit IN DER DATENBANK und nicht in einer
-- Zeitrechnung, die niemand nachvollziehen kann (Regel 10) — und
-- `mart.bestelldetail_offen` zaehlt ihn.
--
-- WARUM NICHT EINFACH DAS FENSTER AUF 14 TAGE VERKLEINERN. Das waere ein
-- Einzeiler gewesen und haette 4.288 Aufrufe gespart. Es bliebe aber
-- dabei, dass jede Bestellung im Fenster VIERZEHNMAL geholt wird, obwohl
-- sie sich im Schnitt einmal aendert. Und es haengt an einer Messung ueber
-- zwoelf Tage, die keinen Monatswechsel enthaelt: werden Rechnungen zum
-- Monatsende gebuendelt nachgetragen, wuerde eine 14-Tage-Grenze genau
-- den Fall verfehlen, fuer den die Auffrischung gebaut wurde. Der
-- Fingerabdruck verfehlt ihn nicht — er sieht die Aenderung, wann immer
-- sie kommt, solange die Bestellung in den geholten Listenseiten steht.
-- =====================================================================


ALTER TABLE core.bestellung
  ADD COLUMN IF NOT EXISTS listen_fingerabdruck text,
  ADD COLUMN IF NOT EXISTS detail_fingerabdruck text;

COMMENT ON COLUMN core.bestellung.listen_fingerabdruck IS
'Fingerabdruck des Eintrags aus fn:bestellungen — md5 ueber den kanonisch
sortierten Listeneintrag. Wird bei JEDEM Listenabruf neu gesetzt.

Der Listeneintrag traegt keinen Lagerbestand und kein timeModified des
Artikelstamms; er aendert sich also nur, wenn sich die BESTELLUNG aendert.
Genau daran scheitert payload_hash auf dem Detailabruf: dort sind 81 % der
Aenderungen Rauschen aus dem Artikelstamm.';

COMMENT ON COLUMN core.bestellung.detail_fingerabdruck IS
'Fuer welchen Listenstand das Detail zuletzt geholt wurde. Gleich
listen_fingerabdruck heisst: das Detail ist aktuell. Verschieden heisst:
es gibt Arbeit — mart.bestelldetail_offen zaehlt diese Zeilen.

NULL bei allen Bestellungen aus der Zeit vor Migration 0098. Sie gelten
NICHT als veraltet (sonst waeren es am Tag der Migration 67.632 Stueck);
sie werden aufgefrischt, sobald ihr Listeneintrag das naechste Mal
abweicht. Das ist die richtige Antwort: fuer sie ist nichts gemessen, und
eine erfundene Dringlichkeit ist schlechter als keine.';


-- ---------------------------------------------------------------------
-- Der Zugriffspfad der Arbeitsabfrage.
--
-- Sie fragt "wo weicht der Fingerabdruck ab", und das ist ohne Index ein
-- Scan ueber 67.632 Zeilen je Marke und Nacht. Partiell auf die
-- abweichenden: das sind im eingeschwungenen Zustand ein paar Dutzend.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS bestellung_detail_veraltet
    ON core.bestellung (kostenstelle_key, bestellt_am DESC)
 WHERE listen_fingerabdruck IS DISTINCT FROM detail_fingerabdruck;


-- ---------------------------------------------------------------------
-- mart.bestelldetail_offen — die Zahl, die fallen muss
--
-- Ohne sie sieht ein Fingerabdruck, der aus irgendeinem Grund nie
-- uebereinstimmt, genauso aus wie ein gepflegter Bestand: der Lauf holt
-- jede Nacht dieselben Bestellungen und meldet "ok". Das ist derselbe
-- stille Zustand, den dieses Projekt beim Belegarchiv (12.08.) und beim
-- Zuweisungsrueckstand (24.08.) schon zweimal bezahlt hat.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.bestelldetail_offen AS
SELECT m.schluessel                                                     AS marke,
       count(*)::int                                                    AS offen,
       count(*) FILTER (WHERE b.detail_geholt_am IS NULL)::int          AS nie_geholt,
       count(*) FILTER (WHERE b.detail_fingerabdruck IS NULL
                          AND b.detail_geholt_am IS NOT NULL)::int      AS ohne_fingerabdruck,
       count(*) FILTER (WHERE b.bestellt_am > now() - interval '14 days')::int AS juenger_14_tage,
       min(b.bestellt_am)                                               AS aelteste,
       max(b.bestellt_am)                                               AS juengste
  FROM core.bestellung b
  JOIN core.kostenstelle k ON k.kostenstelle_key = b.kostenstelle_key
  JOIN core.marke m        ON m.marke_key = k.marke_key
 WHERE b.listen_fingerabdruck IS DISTINCT FROM b.detail_fingerabdruck
 GROUP BY m.schluessel;

COMMENT ON VIEW mart.bestelldetail_offen IS
'Bestellungen, deren Detail nicht zum letzten Listenstand passt — die
Arbeitsliste der Detailauffrischung seit Migration 0098.

ERWARTUNG: eine kleine, schwankende Zahl. Sie steigt tagsueber, wenn
FoodNotify Rechnungen nachtraegt, und faellt in der naechsten Nacht wieder.

WAS EIN BEFUND IST: eine Zahl, die NICHT mehr faellt. Dann stimmt entweder
der Fingerabdruck nie ueberein (dann wird jede Nacht dasselbe geholt, und
nichts meldet es) oder die Detailposten scheitern dauerhaft (dann stehen
sie in sync.warteschlange mit letzter_fehler).

ohne_fingerabdruck ist der Altbestand aus der Zeit vor 0098: Detail
geholt, aber ohne Vergleichswert. Diese Zeilen verschwinden von selbst,
sobald ihr Listeneintrag das naechste Mal gelesen wird.';


-- ---------------------------------------------------------------------
-- mart.bestelldetail_stand bekommt eine neue Bedeutung fuer EINE Spalte
--
-- `fenster_veraltet` hiess: "im 45-Tage-Fenster und trotzdem aelter als
-- 48 h", Erwartung 0 nach jedem Nachtlauf. Genau das wird es ab heute
-- NICHT mehr sein — es wird ja nicht mehr nach Frist aufgefrischt. Die
-- Spalte stehen zu lassen hiesse, eine funktionierende Pruefung in einen
-- dauerhaften Fehlalarm zu verwandeln, und ein Alarm, der immer schlaegt,
-- wird abgeschaltet und nimmt die echten Faelle mit.
--
-- Sie misst deshalb jetzt dasselbe wie vorher — "hier ist Arbeit offen" —
-- nur mit dem richtigen Kriterium: Listenstand gegen Detailstand.
-- Die Spaltennamen bleiben, weil CREATE OR REPLACE VIEW sie nicht
-- umbenennen kann und weil mart.pruefung_uebersicht sie liest.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.bestelldetail_stand AS
WITH grundlage AS (
  SELECT m.schluessel                                  AS marke,
         b.bestellt_am,
         b.detail_geholt_am,
         (b.bestellt_am > now() - interval '14 days')  AS im_fenster,
         (b.listen_fingerabdruck IS DISTINCT FROM b.detail_fingerabdruck) AS offen
    FROM core.bestellung b
    JOIN core.kostenstelle ks USING (kostenstelle_key)
    JOIN core.marke m USING (marke_key)
   WHERE coalesce(b.status, '') NOT IN ('canceled', 'finished')
     AND b.bestellt_am > now() - interval '12 months'
)
SELECT marke,
       count(*)                                                        AS nicht_final,
       count(*) FILTER (WHERE im_fenster)                              AS im_fenster,
       count(*) FILTER (WHERE detail_geholt_am IS NULL)                AS nie_aufgefrischt,
       count(*) FILTER (WHERE im_fenster AND offen)                    AS fenster_veraltet,
       min(detail_geholt_am)                                           AS aeltester_stand,
       max(detail_geholt_am)                                           AS juengster_stand
  FROM grundlage
 GROUP BY marke
 ORDER BY marke;

COMMENT ON VIEW mart.bestelldetail_stand IS
'Wie frisch sind die Bestelldetails? Eine Zeile je Marke, ueber den nicht-finalen
Bestand der letzten zwoelf Monate.

SEIT MIGRATION 0098 HAENGEN ZWEI SPALTEN AN EINEM ANDEREN KRITERIUM, und das
gehoert gelesen, bevor jemand die Zahlen deutet:

  im_fenster        die letzten 14 TAGE (vorher 45). Vierzehn, weil in zwoelf
                    Tagen Messung ueber 400 Bestellungen KEINE einzige
                    Kopfaenderung jenseits von Tag 14 vorkam.
  fenster_veraltet  im Fenster UND Listenstand ungleich Detailstand — also
                    echte offene Arbeit. Vorher hiess es "aelter als 48 h",
                    was seit 0098 nichts mehr bedeutet: aufgefrischt wird
                    nicht nach Frist, sondern nach Aenderung.
                    ERWARTUNG weiterhin: 0 nach jedem Nachtlauf.
  nicht_final       Status weder canceled noch finished. Die Zahl ist fast so
                    gross wie der Bestand (finished gibt es 13 Mal in 67.632)
                    und taugt deshalb nur als Nenner, nicht als Befund.
  nie_aufgefrischt  detail_geholt_am IS NULL. Der Rest des Nachholaufs.

Die feinere Sicht auf dieselbe Frage ist mart.bestelldetail_offen: sie zaehlt
ohne Fensterbegrenzung und trennt den Altbestand ohne Fingerabdruck ab.';


/*
 * DIE ALTE PRUEFZEILE WIRD ENTFERNT, nicht nur umgedeutet.
 *
 * "Bestellung: Details im Fenster aelter als 48 h" beschreibt ein
 * Verfahren, das es nicht mehr gibt. Ein Prueflabel, das etwas anderes
 * sagt als es misst, ist schlimmer als eine fehlende Zeile — es steht in
 * derselben Tabelle wie die richtigen und wird genauso gelesen.
 *
 * An ihre Stelle tritt mart.pruefung_bestelldetail weiter unten, mit
 * derselben Frage und einem Namen, der sie trifft.
 *
 * Der Eingriff ist eine Textersetzung an der Sichtdefinition — dasselbe
 * Verfahren wie das Anhaengen, nur andersherum, und ebenso durch einen
 * LIKE-Test wiederholbar gemacht.
 */
DO $$
DECLARE d text; neu text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO d;
    IF d LIKE '%aelter als 48 h%' THEN
        neu := regexp_replace(
            d,
            'UNION ALL\s+SELECT ''Bestellung: Details im Fenster aelter als 48 h''.*?FROM mart\.bestelldetail_stand\s*',
            '', 'gs');
        IF neu = d THEN
            RAISE EXCEPTION 'Die alte Pruefzeile wurde nicht getroffen — Definition von Hand pruefen';
        END IF;
        EXECUTE 'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS ' || rtrim(btrim(neu), ';');
    END IF;
END $$;


/*
 * Die Pruefzeile — angehaengt an mart.pruefung_uebersicht, mit demselben
 * pg_get_viewdef-Verfahren wie in 0094, 0096 und 0097. Eine Pruefsicht,
 * die niemand liest, ist keine.
 */
CREATE OR REPLACE VIEW mart.pruefung_bestelldetail AS
SELECT 'FoodNotify: Detail passt nicht zum Listenstand'::text AS pruefung,
       (SELECT count(*)::int FROM core.bestellung)            AS geprueft,
       (SELECT count(*)::int FROM core.bestellung
         WHERE listen_fingerabdruck IS DISTINCT FROM detail_fingerabdruck
           AND bestellt_am > now() - interval '14 days')      AS auffaellig,
       'mart.bestelldetail_offen'::text                       AS sicht;

COMMENT ON VIEW mart.pruefung_bestelldetail IS
'Gezaehlt werden nur Bestellungen der letzten 14 Tage: aeltere ohne
Fingerabdruck sind der Altbestand aus der Zeit vor Migration 0098 und
KEIN Befund. Eine Pruefzeile, die am Tag ihrer Entstehung 67.632 meldet,
liest niemand ein zweites Mal.';

DO $$
DECLARE d text;
BEGIN
    SELECT pg_get_viewdef('mart.pruefung_uebersicht'::regclass, true) INTO d;
    IF d NOT LIKE '%pruefung_bestelldetail%' THEN
        EXECUTE 'CREATE OR REPLACE VIEW mart.pruefung_uebersicht AS '
             || rtrim(btrim(d), ';')
             || ' UNION ALL SELECT pruefung, geprueft, auffaellig, sicht'
             || ' FROM mart.pruefung_bestelldetail';
    END IF;
END $$;


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0098', to_jsonb(
        'Bestelldetails werden nicht mehr nach Alter aufgefrischt, sondern '
        'nach Aenderung: core.bestellung traegt listen_fingerabdruck (was die '
        'Liste sagt) und detail_fingerabdruck (wofuer das Detail geholt wurde). '
        'Vorher wurden 2.960 Bestellungen je Nacht doppelt geholt = 5.920 '
        'Aufrufe, davon 4.288 nachweislich ohne Ertrag: von 408 gemessenen '
        'Kopfaenderungen lagen 277 in den ersten drei Tagen, 6 bis Tag 14 und '
        'KEINE danach; bei den Positionen aenderte sich in 400 Bestellungen '
        'ueber zwoelf Tage NICHTS am Inhalt — nur der mitgelieferte '
        'Lagerbestand des Artikelstamms, den dieses Projekt gar nicht '
        'erfasst.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
