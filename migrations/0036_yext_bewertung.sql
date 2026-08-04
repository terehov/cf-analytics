-- ---------------------------------------------------------------------
-- Migration 0036 · Online-Bewertungen aus Yext
--
-- Die sechste Kennzahl des Round Table. Bis hierher war sie die einzige,
-- die von Hand abgetippt wurde; manual.online_bewertung stand seit
-- Migration 0004 leer da und wartete auf eine Quelle.
--
-- WAS AM 03.08.2026 GEGEN DIE ECHTE API GEMESSEN WURDE, und warum das
-- Modell so aussieht und nicht anders:
--
--   * Es gibt KEINEN Aggregat-Endpunkt. /reviewsAggregate antwortet 404.
--     Dafuer liefert die normale Bewertungsliste `count` und
--     `averageRating` im Kopf mit — zusammen mit `maxPublisherDate` ist
--     das ein Aggregat je Stichtag fuer einen einzigen Aufruf.
--   * FACEBOOK fuehrt Bewertungen OHNE `rating`. Das ist Frage 5 aus
--     docs/yext-anbindung.md, empirisch beantwortet: Facebook arbeitet
--     mit "empfohlen / nicht empfohlen". Ein Mittelwert ueber alle
--     Portale mischt damit zwei verschiedene Skalen.
--   * Bei Enchilada Hamm: 2.001 Bewertungen gesamt (Schnitt 4,30),
--     davon 1.639 bei Google (4,32), 164 bei OpenTable, 119 bei
--     Facebook. Die Wahl des Portals verschiebt die Kennzahl also
--     sichtbar — und die Ampel steht bei 4,40 zu 4,00.
--
-- DESHALB WIRD JE PORTAL GESPEICHERT UND ERST IN DER SICHT ENTSCHIEDEN.
-- Waere die Entscheidung im Importer, muesste ein Meinungswechsel 3.200
-- Aufrufe neu ausloesen. So kostet er ein UPDATE.
--
-- WARUM STAENDE UND KEINE MONATSWERTE. Die Zahl, die im Round Table
-- steht, ist die, die ein Gast auf Google sieht: der Schnitt ueber alle
-- Bewertungen. Der Schnitt der Bewertungen EINES Monats ist etwas
-- anderes — Enchilada Hamm hatte im Juli 2026 neun Stueck, ein Ausrutscher
-- darunter bewegt den Monatswert um mehr als eine halbe Note. Eine Ampel
-- darauf waere Rauschen mit Farbe.
--
-- Der Monatswert geht trotzdem nicht verloren: er ist die Differenz
-- zweier Staende und steht in mart.bewertung_verlauf. Ein Aufruf je
-- Betrieb und Monat liefert beides.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- Der Stand je Betrieb, Monat und Portal
--
-- `monat` ist der Monatserste, gemeint ist der Stand am Monatsletzten:
-- "so sah die Bewertung aus, als der Monat zu Ende war".
--
-- Gespeichert wird `anzahl` und `schnitt`, NICHT die Summe der Sterne.
-- Yext liefert den Schnitt mit sechs Nachkommastellen, das Produkt aus
-- beidem ist damit auf ein Tausendstel genau — genug, um durch Differenz
-- den Monatswert zu rechnen, und ehrlicher als eine Summe, die wir selbst
-- gerundet haetten.
--
-- KEINE EINZELBEWERTUNGEN. Kein Autorenname, kein Text, keine ID einer
-- fremden Person (docs/yext-anbindung.md §3). Was hier steht, ist
-- gezaehlt und gemittelt, sonst nichts.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.bewertung_stand (
    betrieb_key  integer     NOT NULL REFERENCES core.betrieb(betrieb_key),
    monat        date        NOT NULL,
    quelle       text        NOT NULL DEFAULT 'yext',
    -- 'GOOGLEMYBUSINESS', 'OPENTABLE', ... oder 'ALLE' fuer den Schnitt
    -- ueber saemtliche Portale.
    publisher    text        NOT NULL,
    -- Kumuliert bis Monatsende, nicht im Monat.
    anzahl       integer     NOT NULL,
    schnitt      numeric(8,6),
    geladen_am   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (betrieb_key, monat, quelle, publisher),
    CONSTRAINT bewertung_stand_monatserster CHECK (monat = date_trunc('month', monat)::date),
    CONSTRAINT bewertung_stand_skala CHECK (schnitt IS NULL OR schnitt BETWEEN 1 AND 5),
    CONSTRAINT bewertung_stand_anzahl CHECK (anzahl >= 0)
);

COMMENT ON TABLE core.bewertung_stand IS
'Kumulierter Bewertungsstand je Betrieb, Monatsende und Portal (Quelle Yext).
Keine Einzelbewertungen, keine personenbezogenen Felder. Der Monatswert ergibt
sich als Differenz zweier Staende in mart.bewertung_verlauf.';

COMMENT ON COLUMN core.bewertung_stand.monat IS
'Monatserster. Gemeint ist der Stand am Monatsletzten (maxPublisherDate).';

COMMENT ON COLUMN core.bewertung_stand.publisher IS
'Portal. ''ALLE'' ist der Schnitt ueber saemtliche Portale — mit der bekannten
Einschraenkung, dass Facebook ohne Sternewertung arbeitet und dort nur die
bewerteten Eintraege einfliessen.';

CREATE INDEX IF NOT EXISTS bewertung_stand_monat_idx
    ON core.bewertung_stand (monat, publisher);


-- ---------------------------------------------------------------------
-- Verlauf: Stand und Monatswert nebeneinander
--
-- Die Sicht fuer Einzelauswertungen — Betriebsblatt, Markenvergleich,
-- Zeitreihe. Sie liefert vier Zahlen je Zeile, und die Trennung ist der
-- ganze Zweck:
--
--   schnitt_stand    was ein Gast sieht (kumuliert)      -> Ampel
--   schnitt_monat    wie die neuen Bewertungen ausfielen -> Fruehwarnung
--   anzahl_stand     wie viele Stimmen dahinterstehen
--   anzahl_monat     wie viel Bewegung der Monat brachte
--
-- Der erste geladene Monat einer Reihe hat KEINEN Vormonat und damit
-- keinen ehrlich berechenbaren Monatswert: die Differenz waere die
-- gesamte Vorgeschichte. Beide Monatsspalten bleiben dort NULL. Deshalb
-- laedt der Importer einen Monat mehr, als berichtet werden soll.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.bewertung_verlauf AS
WITH s AS (
    SELECT st.betrieb_key, st.monat, st.quelle, st.publisher,
           st.anzahl, st.schnitt,
           st.anzahl * st.schnitt                       AS summe,
           lag(st.anzahl)               OVER w          AS anzahl_vor,
           lag(st.anzahl * st.schnitt)  OVER w          AS summe_vor,
           lag(st.monat)                OVER w          AS monat_vor
      FROM core.bewertung_stand st
    WINDOW w AS (PARTITION BY st.betrieb_key, st.quelle, st.publisher ORDER BY st.monat)
)
SELECT b.betrieb_key,
       b.name                       AS betrieb,
       b.stadt,
       kz.hauptkonzept              AS konzept,
       s.monat,
       s.quelle,
       s.publisher,
       round(s.schnitt, 2)          AS schnitt_stand,
       s.anzahl                     AS anzahl_stand,
       -- Nur rechnen, wenn der Vormonat auch WIRKLICH der Vormonat ist:
       -- eine Luecke in der Reihe (ausgefallener Lauf) wuerde sonst zwei
       -- Monate zu einem verschmelzen und als ein starker Monat gelesen.
       CASE WHEN s.monat_vor = (s.monat - interval '1 month')::date
            THEN s.anzahl - s.anzahl_vor END            AS anzahl_monat,
       CASE WHEN s.monat_vor = (s.monat - interval '1 month')::date
             AND s.anzahl - s.anzahl_vor > 0
            THEN round((s.summe - s.summe_vor) / (s.anzahl - s.anzahl_vor), 2)
       END                                              AS schnitt_monat
  FROM s
  JOIN core.betrieb b USING (betrieb_key)
  LEFT JOIN mart.konzept_zuordnung kz USING (betrieb_key);

COMMENT ON VIEW mart.bewertung_verlauf IS
'Bewertungsverlauf je Betrieb und Monat: kumulierter Stand (das, was ein Gast
sieht, Grundlage der Ampel) neben dem Monatswert (Differenz zum Vormonat,
Fruehwarnung). Monatsspalten sind NULL, wo der Vormonat fehlt — eine Luecke
wird nicht zu einem starken Monat verrechnet.';


-- ---------------------------------------------------------------------
-- Von der Quelle in die Kennzahl
--
-- manual.online_bewertung ist die Tabelle, die der Round Table liest
-- (mart-Sichten seit Migration 0006). Sie bleibt bewusst bestehen, statt
-- dass der Round Table direkt auf Yext zeigt: dort darf auch weiterhin
-- ein Wert von Hand stehen, etwa fuer einen Betrieb ohne Yext-Eintrag.
--
-- WELCHES PORTAL IN DIE KENNZAHL GEHT, steht als Vorgabewert genau hier
-- und nirgends sonst. Google, weil das die Zahl ist, die bisher von Hand
-- gepflegt wurde und die ein Gast meint, wenn er "die Bewertung" sagt.
-- Ein Wechsel auf 'ALLE' ist ein Funktionsaufruf, kein neuer Import.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION manual.online_bewertung_aus_yext(
    p_publisher text DEFAULT 'GOOGLEMYBUSINESS')
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
    INSERT INTO manual.online_bewertung (betrieb_key, monat, bewertung, anzahl, quelle, geladen_am)
    SELECT v.betrieb_key, v.monat, v.schnitt_stand, v.anzahl_monat, 'yext', now()
      FROM mart.bewertung_verlauf v
     WHERE v.quelle = 'yext'
       AND v.publisher = p_publisher
       AND v.schnitt_stand IS NOT NULL
    ON CONFLICT (betrieb_key, monat, quelle) DO UPDATE SET
        bewertung  = excluded.bewertung,
        anzahl     = excluded.anzahl,
        geladen_am = now();

    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

COMMENT ON FUNCTION manual.online_bewertung_aus_yext(text) IS
'Traegt den kumulierten Bewertungsstand als Round-Table-Kennzahl ein.
Vorgabe GOOGLEMYBUSINESS — das Portal ist hier waehlbar, weil Facebook ohne
Sternewertung arbeitet und ein Schnitt ueber alle Portale zwei Skalen mischt.
Aendert nur Zeilen mit quelle=''yext''; von Hand gepflegte Werte anderer
Quellen bleiben unberuehrt.';


-- ---------------------------------------------------------------------
-- Was der Importer zuletzt getan hat — fuer /status und fuer Menschen.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.bewertung_ladestand AS
SELECT s.quelle,
       s.publisher,
       count(DISTINCT s.betrieb_key)                  AS betriebe,
       min(s.monat)                                   AS von,
       max(s.monat)                                   AS bis,
       sum(s.anzahl) FILTER (WHERE s.monat = (SELECT max(monat) FROM core.bewertung_stand))
                                                      AS bewertungen_aktuell,
       round(avg(s.schnitt) FILTER (WHERE s.monat = (SELECT max(monat) FROM core.bewertung_stand)), 2)
                                                      AS schnitt_aktuell,
       max(s.geladen_am)                              AS zuletzt_geladen
  FROM core.bewertung_stand s
 GROUP BY s.quelle, s.publisher;

COMMENT ON VIEW mart.bewertung_ladestand IS
'Ladestand der Bewertungen je Quelle und Portal: Abdeckung, Zeitraum und
letzter Lauf. Erste Anlaufstelle, wenn eine Ampel im Round Table grau bleibt.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0036', to_jsonb(
        'Online-Bewertungen aus Yext: core.bewertung_stand (kumuliert je '
        'Betrieb/Monat/Portal), mart.bewertung_verlauf (Stand und Monatswert), '
        'manual.online_bewertung_aus_yext() fuellt die Round-Table-Kennzahl. '
        'Portalwahl erst in der Sicht, weil Facebook ohne Sternewertung '
        'arbeitet und /reviewsAggregate 404 liefert.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert;
