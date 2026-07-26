-- =====================================================================
-- 0006 Mart — die Schicht, mit der Metabase arbeitet
--
-- Leitgedanke: in Metabase soll niemand core-Tabellen von Hand verbinden
-- muessen. Jede Sicht hier bringt die Namen schon mit (Betrieb, Konzept,
-- Artikel, Warengruppe), und jede ist so geschnitten, dass eine naive
-- Summenbildung darueber ein richtiges Ergebnis liefert.
--
-- Der zweite Punkt ist der wichtigere und der Grund fuer ein paar
-- Aufteilungen, die auf den ersten Blick redundant wirken. Beispiel
-- Umsatzbericht: in core stehen Gesamtwerte und Hauptspartenwerte in
-- DERSELBEN Tabelle, unterschieden nur durch hauptsparte_key IS NULL. Wer
-- das in Metabase zusammenzaehlt, bekommt den doppelten Umsatz und merkt es
-- nicht. Deshalb gibt es hier mart.umsatz_tag (nur Gesamtwerte) und
-- mart.umsatz_tag_sparte (nur Hauptsparten) getrennt.
-- =====================================================================


-- =====================================================================
-- Dimensionen
-- =====================================================================

CREATE VIEW mart.betrieb AS
SELECT b.betrieb_key, b.enc_id, b.name AS betrieb, b.stadt, b.aktiv, b.hat_bwa,
       string_agg(k.name, ', ' ORDER BY k.name) AS konzepte
  FROM core.betrieb b
  LEFT JOIN core.betrieb_konzept bk ON bk.betrieb_key = b.betrieb_key
  LEFT JOIN core.konzept k          ON k.konzept_key  = bk.konzept_key
 GROUP BY b.betrieb_key, b.enc_id, b.name, b.stadt, b.aktiv, b.hat_bwa;

COMMENT ON VIEW mart.betrieb IS
'Betriebsuebersicht mit allen Konzepten als Text. Fuer Markenschnitte NICHT diese Sicht
nehmen, sondern mart.konzept_zuordnung.hauptkonzept - sonst zaehlt ein mehrfach
zugeordneter Betrieb in mehreren Marken mit.';


-- Die Bruecke zur BWA, und die Arbeitsliste, wenn sie fehlt.
--
-- getKennzahlen kennt Betriebe nur ueber lina_betrieb_id, alle anderen
-- Endpunkte nur ueber enc_id. Verbunden werden die beiden ueber den NAMEN -
-- nachgemessen beidseitig eindeutig, aber eben nur nachgemessen. Faellt ein
-- Betrieb hier auf, bekommt er keine einzige BWA-Zeile, und zwar lautlos:
-- am 26.07.2026 fielen so alle 7.860 Kennzahlenzeilen durch den Filter,
-- waehrend der Importer "ok" meldete.
CREATE VIEW mart.betrieb_ohne_lina_id AS
SELECT b.betrieb_key, b.enc_id, b.name AS betrieb, b.stadt, b.aktiv, b.hat_bwa,
       b.zuletzt_am
  FROM core.betrieb b
 WHERE b.lina_betrieb_id IS NULL
 ORDER BY b.aktiv DESC, b.name;

COMMENT ON VIEW mart.betrieb_ohne_lina_id IS
'Betriebe ohne Bruecke zur BWA. ERWARTUNG: leer. Jede Zeile hier ist ein Betrieb, der in
keiner Kennzahlenauswertung auftaucht - ohne Fehlermeldung, weil ihn der Importer schlicht
nicht zuordnen kann. Zu fuellen ist die Spalte ueber den Endpunkt analyticsFilterOptions,
der monatlich als Momentaufnahme laeuft.';


-- Aufgeloeste Markenzuordnung, siehe Kopf von manual.betrieb_hauptkonzept.
CREATE VIEW mart.konzept_zuordnung AS
WITH zaehlung AS (
    SELECT bk.betrieb_key,
           count(*)::int                              AS anzahl_konzepte,
           min(bk.konzept_key)                        AS einziges_konzept,
           string_agg(k.name, ', ' ORDER BY k.name)   AS konzepte
      FROM core.betrieb_konzept bk
      JOIN core.konzept k ON k.konzept_key = bk.konzept_key
     GROUP BY bk.betrieb_key
)
SELECT b.betrieb_key,
       b.name  AS betrieb,
       b.stadt,
       b.aktiv,
       coalesce(z.anzahl_konzepte, 0) AS anzahl_konzepte,
       z.konzepte,
       kh.name AS hauptkonzept,
       CASE WHEN m.betrieb_key IS NOT NULL          THEN 'manuell gesetzt'
            WHEN z.anzahl_konzepte = 1              THEN 'aus LINA eindeutig'
            WHEN coalesce(z.anzahl_konzepte, 0) = 0 THEN 'LINA kennt kein Konzept'
            ELSE 'mehrdeutig - Entscheidung fehlt'
       END AS herkunft
  FROM core.betrieb b
  LEFT JOIN zaehlung z                      ON z.betrieb_key = b.betrieb_key
  LEFT JOIN manual.betrieb_hauptkonzept m   ON m.betrieb_key = b.betrieb_key
  LEFT JOIN core.konzept kh
         ON kh.konzept_key = coalesce(m.konzept_key,
                                      CASE WHEN z.anzahl_konzepte = 1
                                           THEN z.einziges_konzept END);

COMMENT ON VIEW mart.konzept_zuordnung IS
'Welche Marke gilt fuer welchen Betrieb - und woher das kommt. GENAU EINE ZEILE JE BETRIEB,
deshalb in allen anderen Sichten diese hier joinen und nicht core.betrieb_konzept.
Die Zeilen mit herkunft = ''mehrdeutig - Entscheidung fehlt'' sind die Arbeitsliste: solange
sie offen sind, laufen diese Betriebe in allen Markenauswertungen unter "(nicht zugeordnet)".
Erste Frage vor jedem Markenvergleich: SELECT * FROM mart.konzept_zuordnung WHERE hauptkonzept IS NULL;';


-- Auswahlliste fuer den Metabase-Dropdown
CREATE VIEW mart.regelwerk AS
SELECT regelwerk_key, name, beschreibung, ist_standard
  FROM ampel.regelwerk
 ORDER BY ist_standard DESC, name;

COMMENT ON VIEW mart.regelwerk IS
'Auswahlliste der Regelwerke. In Metabase als Quelle fuer den Dropdown-Parameter der
Round-Table-Frage hinterlegen, dann ist das Umschalten ein Klick in der Oberflaeche.';


-- Aktueller BWA-Stand je Betrieb/Monat/Kennzahl
--
-- Die beiden Spalten werden GETRENNT aufgeloest, und das ist der ganze Witz
-- dieser Sicht. LINA liefert Euro und Prozent aus zwei Aufrufen
-- (mode=absolut, mode=relativ), die als zwei Zeilen mit unterschiedlichem
-- abgerufen_am ankommen -- jede mit genau einem gefuellten Wert.
--
-- Ein DISTINCT ON ueber abgerufen_am DESC nimmt davon nur EINE, naemlich die
-- spaeter geholte, und wirft die andere Spalte weg. Nachgemessen am
-- 26.07.2026 im ersten echten Lauf: 7.860 Zeilen, davon 7.860 mit Prozent und
-- NULL mit Euro, weil relativ 35 Sekunden nach absolut lief. Damit war
-- mart.pruefung_wareneinsatz still wirkungslos -- die Sicht braucht Euro.
--
-- Deshalb je Spalte der juengste NICHT-LEERE Wert. Die Zeitreise bleibt
-- erhalten: die Rohtabelle ist unangetastet und weiterhin append-only.
CREATE VIEW mart.kennzahlen_aktuell AS
SELECT betrieb_key, monat, kennzahl,
       ((array_agg(wert_absolut ORDER BY abgerufen_am DESC)
         FILTER (WHERE wert_absolut IS NOT NULL))[1])::numeric(14,2) AS wert_absolut,
       ((array_agg(wert_prozent ORDER BY abgerufen_am DESC)
         FILTER (WHERE wert_prozent IS NOT NULL))[1])::numeric(8,2)  AS wert_prozent,
       max(abgerufen_am)                                             AS abgerufen_am
  FROM core.kennzahlen_monat
 GROUP BY betrieb_key, monat, kennzahl;

COMMENT ON VIEW mart.kennzahlen_aktuell IS
'Juengster bekannter BWA-Stand, je Wertspalte getrennt aufgeloest -- Euro und Prozent kommen
aus zwei getrennten LINA-Aufrufen und wuerden sich sonst gegenseitig verdraengen.
abgerufen_am ist der juengste der beiden Abrufe.
Fuer "was wussten wir am Stichtag X" stattdessen direkt core.kennzahlen_monat mit
abgerufen_am <= X abfragen.';


-- =====================================================================
-- Fakten mit Namen — hier faengt eine Metabase-Frage an
-- =====================================================================

CREATE VIEW mart.umsatz_tag AS
SELECT u.geschaeftstag,
       date_trunc('month', u.geschaeftstag)::date AS monat,
       b.betrieb_key,
       b.name         AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       u.umsatz_netto, u.umsatz_brutto, u.rechnungen, u.gaeste,
       u.durchschnittsbon, u.umsatz_pro_gast
  FROM core.umsatzbericht_tag u
  JOIN core.betrieb b            ON b.betrieb_key  = u.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = u.betrieb_key
 WHERE u.hauptsparte_key IS NULL
   AND u.verkaufsstelle_key IS NULL;

COMMENT ON VIEW mart.umsatz_tag IS
'Tagesumsatz je Betrieb, GESAMT. Genau eine Zeile je Betrieb und Geschaeftstag - diese Sicht
darf man bedenkenlos aufsummieren.
Die Aufteilung nach Speisen und Getraenken steht in mart.umsatz_tag_sparte. Beide zusammen
zu zaehlen ergaebe den doppelten Umsatz; in core.umsatzbericht_tag liegen sie in derselben
Tabelle, unterschieden nur durch hauptsparte_key IS NULL. Genau deshalb sind sie hier getrennt.
durchschnittsbon und umsatz_pro_gast kommen fertig von LINA - nicht selbst nachrechnen.';


CREATE VIEW mart.umsatz_tag_sparte AS
SELECT u.geschaeftstag,
       date_trunc('month', u.geschaeftstag)::date AS monat,
       b.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       hs.name         AS hauptsparte,
       vs.name         AS verkaufsstelle,
       u.umsatz_netto, u.umsatz_brutto, u.rechnungen, u.gaeste,
       u.durchschnittsbon, u.umsatz_pro_gast
  FROM core.umsatzbericht_tag u
  JOIN core.betrieb b                 ON b.betrieb_key = u.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = u.betrieb_key
  LEFT JOIN core.hauptsparte hs       ON hs.hauptsparte_key = u.hauptsparte_key
  LEFT JOIN core.verkaufsstelle vs    ON vs.verkaufsstelle_key = u.verkaufsstelle_key
 WHERE u.hauptsparte_key IS NOT NULL
    OR u.verkaufsstelle_key IS NOT NULL;

COMMENT ON VIEW mart.umsatz_tag_sparte IS
'Tagesumsatz je Betrieb, aufgeteilt nach Hauptsparte bzw. Verkaufsstelle. Nur die
aufgeteilten Zeilen - der Gesamtwert steht in mart.umsatz_tag und ist hier bewusst NICHT
enthalten, damit eine Summe ueber diese Sicht nicht doppelt zaehlt.
Geholt werden bisher nur Speisen und Getraenke; die Summe beider ist deshalb kleiner als
der Gesamtumsatz.';


CREATE VIEW mart.umsatz_stunde AS
SELECT z.geschaeftstag,
       date_trunc('month', z.geschaeftstag)::date AS monat,
       b.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       z.stunde,
       z.umsatz_netto
  FROM core.zeitzonenbericht_stunde z
  JOIN core.betrieb b                 ON b.betrieb_key = z.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = z.betrieb_key;

COMMENT ON VIEW mart.umsatz_stunde IS
'Umsatz je Betrieb, Geschaeftstag und Stunde. ACHTUNG bei der Tagesgrenze: der Geschaeftstag
laeuft 08:00 bis 07:59 des Folgetags, die Stunden 0-7 gehoeren also zum VORTAG. geschaeftstag
ist bereits entsprechend umgerechnet - nach stunde sortieren ergibt deshalb keinen zeitlichen
Verlauf, dafuer nach ((stunde + 16) % 24) sortieren.';


CREATE VIEW mart.umsatz_zeitzone AS
SELECT z.geschaeftstag,
       date_trunc('month', z.geschaeftstag)::date AS monat,
       b.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       t.name          AS zeitzone,
       t.minute_von, t.minute_bis,
       z.umsatz_netto
  FROM core.zeitzonenbericht_zone z
  JOIN core.betrieb b                 ON b.betrieb_key = z.betrieb_key
  JOIN core.zeitzone t                ON t.zeitzone_key = z.zeitzone_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = z.betrieb_key;

COMMENT ON VIEW mart.umsatz_zeitzone IS
'Umsatz je Betrieb, Geschaeftstag und vordefinierter Zeitzone (Fruehstueck, Mittagszeit,
Happy Hour, ...). "Late Night" laeuft ueber Mitternacht: minute_von 1320 > minute_bis 60.';


-- ---------------------------------------------------------------------
-- Artikelverkauf mit Namen, Warengruppe und dem Ansatz DES TAGES
--
-- Die beiden LEFT JOINs auf die *_zeitraum-Sichten sind der Kern dieser
-- Sicht. Sie holen den Wareneinsatzansatz und die Warengruppe, die AN
-- DIESEM TAG galten, nicht die heutigen. Wer stattdessen core.artikel
-- joint, rechnet die Vergangenheit mit der aktuellen Kalkulation - das
-- Ergebnis sieht plausibel aus und ist falsch.
-- ---------------------------------------------------------------------

CREATE VIEW mart.artikelverkauf AS
SELECT av.geschaeftstag,
       date_trunc('month', av.geschaeftstag)::date AS monat,
       b.betrieb_key,
       b.name          AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       a.artikel_key,
       a.artikelnummer,
       coalesce(az.name, a.name) AS artikel,
       g.name  AS grosskategorie,
       mg.name AS warengruppe,
       d.name  AS detailkategorie,
       (aw.artikel_key IS NOT NULL AND av.geschaeftstag < aw.erfasst_ab) AS warengruppe_geschaetzt,
       av.menge,
       av.umsatz_netto,
       av.umsatz_brutto,
       av.verkaufspreis,
       az.fixer_we,
       round(av.menge * az.fixer_we, 2)                    AS wareneinsatz_theoretisch,
       round(av.umsatz_netto - av.menge * az.fixer_we, 2)  AS deckungsbeitrag
  FROM core.artikelverkauf_tag av
  JOIN core.betrieb b                 ON b.betrieb_key  = av.betrieb_key
  JOIN core.artikel  a                ON a.artikel_key  = av.artikel_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = av.betrieb_key
  LEFT JOIN core.artikel_stand_zeitraum az
         ON az.artikel_key = av.artikel_key
        AND av.geschaeftstag >= az.gilt_ab
        AND (az.gilt_bis IS NULL OR av.geschaeftstag < az.gilt_bis)
  LEFT JOIN core.artikel_warengruppe_zeitraum aw
         ON aw.artikel_key = av.artikel_key
        AND av.geschaeftstag >= aw.gilt_ab
        AND (aw.gilt_bis IS NULL OR av.geschaeftstag < aw.gilt_bis)
  LEFT JOIN core.warengruppe g  ON g.warengruppe_key  = aw.gross_key
  LEFT JOIN core.warengruppe mg ON mg.warengruppe_key = aw.mec_key
  LEFT JOIN core.warengruppe d  ON d.warengruppe_key  = aw.detail_key;

COMMENT ON VIEW mart.artikelverkauf IS
'Artikelverkaeufe mit Namen, Warengruppe und dem Wareneinsatzansatz, der AN DIESEM TAG galt.
Die groesste Sicht des Systems - rund 20 Millionen Zeilen im Jahr. In Metabase immer nach
geschaeftstag filtern, dann greift das Partition Pruning und es werden nur die betroffenen
Monate gelesen.

fixer_we ist NULL, wenn fuer diesen Tag kein Ansatz erfasst ist. Dann sind auch
wareneinsatz_theoretisch und deckungsbeitrag NULL - das ist Absicht. Eine Null waere eine
Behauptung, ein NULL ist die Wahrheit. Wie gross die Luecke ist, zeigt abdeckung_pct in
mart.deckungsbeitrag_warengruppe.

warengruppe_geschaetzt = true heisst: die Warengruppe stammt aus einer SPAETEREN
Momentaufnahme und wurde rueckwirkend angenommen. Fuer die Historie ist das der Normalfall
(LINA fuehrt keine Warengruppenhistorie), fuer eine Umgruppierungsanalyse ist es der
Ausschlusskandidat. Begruendung an core.artikel_warengruppe_zeitraum.';


-- =====================================================================
-- Round Table — ersetzt das Excel-Blatt "Eingabe"
-- =====================================================================

-- Die unbewertete Grundlage: eine Zeile je aktivem Betrieb und Monat.
-- Sowohl die Metabase-Sicht als auch die Funktionen weiter unten setzen
-- darauf auf - die Zahlen stehen damit an genau einer Stelle.
CREATE VIEW mart.round_table_basis AS
WITH monate AS (
    SELECT DISTINCT date_trunc('month', geschaeftstag)::date AS monat FROM core.umsatzbericht_tag
    UNION
    SELECT DISTINCT monat FROM core.kennzahlen_monat
),
umsatz AS (
    SELECT betrieb_key,
           date_trunc('month', geschaeftstag)::date AS monat,
           sum(umsatz_netto) AS umsatz
      FROM core.umsatzbericht_tag
     WHERE hauptsparte_key IS NULL AND verkaufsstelle_key IS NULL
     GROUP BY 1, 2
),
-- Nur GEBUCHTE Monate zaehlen, und "gebucht" heisst: irgendein Wert ist
-- ungleich null.
--
-- getKennzahlen liefert immer das ganze Jahr, auch die Monate, die der
-- Steuerberater noch nicht gebucht hat -- die kommen mit 0,00 zurueck, nicht
-- als NULL. Ein Filter auf `wert_prozent IS NOT NULL` laesst sie also
-- durch, und weil sie die juengsten sind, gewinnen sie.
--
-- Die Folge waere eine erfundene Ampel: 0,00 % Personalkosten ist "niedriger
-- ist besser" und damit gruen. Am 26.07.2026 im ersten echten Lauf gemessen --
-- September bis Dezember 2026 standen fuer alle 131 Betriebe auf gruen, mit
-- bwa_monat = Dezember und Nullen in jeder Spalte. Ein Round Table, der
-- Entwarnung gibt, weil noch nichts gebucht ist, ist schlimmer als gar keiner.
bwa AS (
    SELECT betrieb_key, monat,
           max(wert_prozent) FILTER (WHERE kennzahl = 'Personalkosten ohne GF') AS personalkosten_ogf_pct,
           max(wert_prozent) FILTER (WHERE kennzahl = 'WE Bar')                 AS we_bar_pct,
           max(wert_prozent) FILTER (WHERE kennzahl = 'WE Küche')               AS we_kueche_pct
      FROM mart.kennzahlen_aktuell
     GROUP BY 1, 2
    HAVING count(*) FILTER (WHERE wert_absolut IS NOT NULL AND wert_absolut <> 0) > 0
)
SELECT b.betrieb_key,
       b.name         AS betrieb,
       b.stadt,
       kz.hauptkonzept AS konzept,
       m.monat,
       k.bwa_monat,
       u.umsatz       AS umsatz_ist,
       v.umsatz       AS umsatz_vj,
       CASE WHEN v.umsatz > 0
            THEN round((u.umsatz - v.umsatz) / v.umsatz * 100, 2)
       END            AS umsatz_pct,
       k.personalkosten_ogf_pct,
       k.we_bar_pct,
       k.we_kueche_pct,
       ob.bewertung   AS online_bewertung,
       om.om_score
  FROM core.betrieb b
  CROSS JOIN monate m
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = b.betrieb_key
  LEFT JOIN umsatz u ON u.betrieb_key = b.betrieb_key AND u.monat = m.monat
  LEFT JOIN umsatz v ON v.betrieb_key = b.betrieb_key
                    AND v.monat = (m.monat - interval '1 year')::date
  -- Der juengste gebuchte BWA-Monat, hoechstens der Berichtsmonat.
  LEFT JOIN LATERAL (
        SELECT w.monat AS bwa_monat, w.personalkosten_ogf_pct, w.we_bar_pct, w.we_kueche_pct
          FROM bwa w
         WHERE w.betrieb_key = b.betrieb_key AND w.monat <= m.monat
         ORDER BY w.monat DESC
         LIMIT 1
  ) k ON true
  -- LIMIT 1 statt eines direkten Joins: die Tabelle erlaubt mehrere Quellen
  -- je Monat, und zwei Zeilen wuerden den Betrieb im Round Table verdoppeln.
  LEFT JOIN LATERAL (
        SELECT o.bewertung
          FROM manual.online_bewertung o
         WHERE o.betrieb_key = b.betrieb_key AND o.monat = m.monat
         ORDER BY (o.quelle = 'yext') DESC, o.anzahl DESC NULLS LAST
         LIMIT 1
  ) ob ON true
  LEFT JOIN manual.om_einschaetzung om
         ON om.betrieb_key = b.betrieb_key AND om.monat = m.monat
 WHERE b.aktiv;

COMMENT ON VIEW mart.round_table_basis IS
'Die Zahlen des Round Table, noch ohne Ampel: eine Zeile je aktivem Betrieb und Monat.
WICHTIG: bwa_monat weist aus, aus welchem Monat Personal- und Wareneinsatzwerte stammen.
Weil die BWA vom Steuerberater importiert wird und 1-2 Monate nachhinkt, ist das oft NICHT
der Berichtsmonat - im Excel wurde derselbe Versatz stillschweigend gepflegt (Juli-Report
mit Mai-Werten, erkennbar nur an einer Kopfzeile).
Bewertet in mart.round_table_monat bzw. mart.round_table().';


-- Die Metabase-Sicht: fertig bewertet, ueber ALLE Monate.
--
-- Bewusst eine Sicht und nicht nur die Funktion darunter. Metabase kann
-- tabellenwertige Funktionen nicht im Abfrage-Editor benutzen - dafuer
-- braucht es jedes Mal eine SQL-Frage mit Parameter. Als Sicht laesst sich
-- der Round Table klicken, nach Monat filtern und nach Marke gruppieren.
CREATE VIEW mart.round_table_monat AS
WITH bewertet AS (
    SELECT r.*,
           ampel.bewerte(r.umsatz_pct,             'umsatz',    NULL, r.betrieb_key, r.bwa_monat) AS ampel_umsatz,
           ampel.bewerte(r.personalkosten_ogf_pct, 'personal',  NULL, r.betrieb_key, r.bwa_monat) AS ampel_personal,
           ampel.bewerte(r.we_bar_pct,             'we_bar',    NULL, r.betrieb_key, r.bwa_monat) AS ampel_we_bar,
           ampel.bewerte(r.we_kueche_pct,          'we_kueche', NULL, r.betrieb_key, r.bwa_monat) AS ampel_we_kueche,
           ampel.bewerte(r.online_bewertung,       'bewertung', NULL, r.betrieb_key, r.bwa_monat) AS ampel_bewertung,
           ampel.bewerte(r.om_score,               'om',        NULL, r.betrieb_key, r.bwa_monat) AS ampel_om
      FROM mart.round_table_basis r
)
SELECT monat, betrieb, coalesce(konzept, '(nicht zugeordnet)') AS konzept, stadt, bwa_monat,
       umsatz_ist, umsatz_vj, umsatz_pct,
       personalkosten_ogf_pct, we_bar_pct, we_kueche_pct,
       online_bewertung, om_score,
       ampel_umsatz, ampel_personal, ampel_we_bar, ampel_we_kueche, ampel_bewertung, ampel_om,
       ampel.gesamt(st)      AS gesamt,
       ampel.intensitaet(st) AS intensitaet,
       CASE WHEN ampel.gesamt(st) = 'rot'
              OR ampel.intensitaet(st) = 'Nachforschung' THEN 'Ja' ELSE 'Nein' END AS massnahme,
       CASE WHEN ampel.gesamt(st) = 'rot'                THEN 'Hoch'
            WHEN ampel.intensitaet(st) = 'Nachforschung' THEN 'Mittel'
            ELSE 'Niedrig' END AS prioritaet,
       betrieb_key
  FROM bewertet,
       LATERAL (SELECT ARRAY[ampel_umsatz, ampel_personal, ampel_we_bar,
                             ampel_we_kueche, ampel_bewertung, ampel_om]) AS x(st);

COMMENT ON VIEW mart.round_table_monat IS
'DER ROUND TABLE FUER METABASE. Ersetzt das Excel-Blatt "Eingabe", eine Zeile je Betrieb und
Monat, fertig bewertet mit dem STANDARDREGELWERK (ampel.regelwerk.ist_standard).
In Metabase nach monat filtern.
Wer die betriebsindividuellen LINA-Schwellen braucht, nimmt die Funktion
mart.round_table(monat, ''lina_betrieb''); den Unterschied zeigt mart.round_table_vergleich().';


-- Dieselbe Bewertung als Funktion, mit waehlbarem Regelwerk. Die Sicht
-- oben kann das nicht, weil ein Regelwerk kein Filterkriterium ist,
-- sondern eine Rechenvorschrift.
CREATE FUNCTION mart.round_table(
    p_monat     date,
    p_regelwerk text DEFAULT NULL
)
RETURNS TABLE (
    betrieb                 text,
    stadt                   text,
    bwa_monat               date,
    umsatz_ist              numeric,
    umsatz_vj               numeric,
    umsatz_pct              numeric,
    personalkosten_ogf_pct  numeric,
    we_bar_pct              numeric,
    we_kueche_pct           numeric,
    online_bewertung        numeric,
    om_score                smallint,
    ampel_umsatz            text,
    ampel_personal          text,
    ampel_we_bar            text,
    ampel_we_kueche         text,
    ampel_bewertung         text,
    ampel_om                text,
    gesamt                  text,
    intensitaet             text,
    massnahme               text,
    prioritaet              text,
    betrieb_key             integer,
    konzept                 text
)
LANGUAGE sql STABLE AS $$
WITH bewertet AS (
    SELECT r.*,
           ampel.bewerte(r.umsatz_pct,             'umsatz',    p_regelwerk, r.betrieb_key, r.bwa_monat) AS a_umsatz,
           ampel.bewerte(r.personalkosten_ogf_pct, 'personal',  p_regelwerk, r.betrieb_key, r.bwa_monat) AS a_personal,
           ampel.bewerte(r.we_bar_pct,             'we_bar',    p_regelwerk, r.betrieb_key, r.bwa_monat) AS a_we_bar,
           ampel.bewerte(r.we_kueche_pct,          'we_kueche', p_regelwerk, r.betrieb_key, r.bwa_monat) AS a_we_kueche,
           ampel.bewerte(r.online_bewertung,       'bewertung', p_regelwerk, r.betrieb_key, r.bwa_monat) AS a_bewertung,
           ampel.bewerte(r.om_score,               'om',        p_regelwerk, r.betrieb_key, r.bwa_monat) AS a_om
      FROM mart.round_table_basis r
     WHERE r.monat = date_trunc('month', p_monat)::date
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
       konzept
  FROM bewertet,
       LATERAL (SELECT ARRAY[a_umsatz,a_personal,a_we_bar,a_we_kueche,a_bewertung,a_om]) AS x(st)
 ORDER BY betrieb;
$$;

COMMENT ON FUNCTION mart.round_table IS
'Round Table eines Monats mit waehlbarem Regelwerk.
Aufruf: SELECT * FROM mart.round_table(DATE ''2026-06-01'', ''lina_betrieb'');
Zweites Argument NULL = Standardregelwerk - dann ist mart.round_table_monat die bequemere
Variante, weil Metabase damit ohne SQL arbeiten kann.';


-- Beide Regelwerke nebeneinander
CREATE FUNCTION mart.round_table_vergleich(p_monat date)
RETURNS TABLE (
    betrieb                     text,
    stadt                       text,
    bwa_monat                   date,
    umsatz_pct                  numeric,
    personalkosten_ogf_pct      numeric,
    we_bar_pct                  numeric,
    we_kueche_pct               numeric,
    online_bewertung            numeric,
    om_score                    smallint,
    gesamt_global               text,
    intensitaet_global          text,
    ampel_personal_global       text,
    gesamt_betrieb              text,
    intensitaet_betrieb         text,
    ampel_personal_betrieb      text,
    weicht_ab                   boolean,
    abweichung                  text
)
LANGUAGE sql STABLE AS $$
SELECT g.betrieb, g.stadt, g.bwa_monat,
       g.umsatz_pct, g.personalkosten_ogf_pct, g.we_bar_pct, g.we_kueche_pct,
       g.online_bewertung, g.om_score,
       g.gesamt, g.intensitaet, g.ampel_personal,
       b.gesamt, b.intensitaet, b.ampel_personal,
       (g.gesamt IS DISTINCT FROM b.gesamt) AS weicht_ab,
       CASE WHEN g.gesamt IS DISTINCT FROM b.gesamt
            THEN format('global: %s / betriebsindividuell: %s',
                        coalesce(g.gesamt,'-'), coalesce(b.gesamt,'-'))
       END AS abweichung
  FROM mart.round_table(p_monat, 'round_table_global') g
  FULL JOIN mart.round_table(p_monat, 'lina_betrieb')  b USING (betrieb)
 ORDER BY (g.gesamt IS DISTINCT FROM b.gesamt) DESC, g.betrieb;
$$;

COMMENT ON FUNCTION mart.round_table_vergleich IS
'Beide Regelwerke nebeneinander, abweichende Betriebe zuerst.
Fuer den Round Table auf weicht_ab filtern - das sind die Faelle, in denen die Wahl der
Schwellen tatsaechlich ein anderes Urteil ergibt. Bei allen uebrigen eruebrigt sich die Diskussion.';


-- ---------------------------------------------------------------------
-- Markenschnitt
--
-- Median statt Mittelwert: bei 141 Betrieben reicht ein einzelner Ausreisser
-- - ein Neubau im Anlaufjahr, ein Betrieb mit Umbau - um einen Mittelwert so
-- zu verziehen, dass die halbe Marke ploetzlich "unterdurchschnittlich"
-- aussieht. Der Median haelt still.
-- ---------------------------------------------------------------------

CREATE FUNCTION mart.konzept_schnitt(
    p_monat     date,
    p_regelwerk text DEFAULT NULL
)
RETURNS TABLE (
    konzept                 text,
    betriebe                integer,
    umsatz_ist              numeric,
    umsatz_pct              numeric,
    personalkosten_ogf_pct  numeric,
    we_bar_pct              numeric,
    we_kueche_pct           numeric,
    ampeln_rot              integer,
    ampeln_orange           integer,
    ampeln_gruen            integer,
    massnahme_faellig       integer
)
LANGUAGE sql STABLE AS $$
SELECT coalesce(r.konzept, '(nicht zugeordnet)')                                       AS konzept,
       count(*)::int                                                                   AS betriebe,
       round(sum(r.umsatz_ist), 2)                                                     AS umsatz_ist,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.umsatz_pct)::numeric, 2)    AS umsatz_pct,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.personalkosten_ogf_pct)::numeric, 2)
                                                                                       AS personalkosten_ogf_pct,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.we_bar_pct)::numeric, 2)    AS we_bar_pct,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.we_kueche_pct)::numeric, 2) AS we_kueche_pct,
       count(*) FILTER (WHERE r.gesamt = 'rot')::int                                   AS ampeln_rot,
       count(*) FILTER (WHERE r.gesamt = 'orange')::int                                AS ampeln_orange,
       count(*) FILTER (WHERE r.gesamt = 'gruen')::int                                 AS ampeln_gruen,
       count(*) FILTER (WHERE r.massnahme = 'Ja')::int                                 AS massnahme_faellig
  FROM mart.round_table(p_monat, p_regelwerk) r
 GROUP BY 1
 ORDER BY 1;
$$;

COMMENT ON FUNCTION mart.konzept_schnitt IS
'Eine Zeile je Marke. Die Prozentwerte sind MEDIANE, nicht Mittelwerte - ein einzelner
Ausreisser soll den Vergleichsmassstab einer ganzen Marke nicht verziehen. umsatz_ist ist
dagegen eine echte Summe.
"(nicht zugeordnet)" sammelt die Betriebe ohne eindeutiges Hauptkonzept; wer da landet und
warum, steht in mart.konzept_zuordnung.';


CREATE FUNCTION mart.round_table_marke(
    p_monat     date,
    p_regelwerk text DEFAULT NULL
)
RETURNS TABLE (
    betrieb                 text,
    konzept                 text,
    stadt                   text,
    bwa_monat               date,
    umsatz_pct              numeric,
    umsatz_abw_gesamt       numeric,
    umsatz_abw_marke        numeric,
    personalkosten_ogf_pct  numeric,
    personal_abw_gesamt     numeric,
    personal_abw_marke      numeric,
    we_bar_pct              numeric,
    we_bar_abw_gesamt       numeric,
    we_bar_abw_marke        numeric,
    we_kueche_pct           numeric,
    we_kueche_abw_gesamt    numeric,
    we_kueche_abw_marke     numeric,
    gesamt                  text,
    intensitaet             text,
    prioritaet              text
)
LANGUAGE sql STABLE AS $$
WITH r AS (
    SELECT * FROM mart.round_table(p_monat, p_regelwerk)
),
alle AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY umsatz_pct)             AS umsatz,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY personalkosten_ogf_pct) AS personal,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY we_bar_pct)             AS we_bar,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY we_kueche_pct)          AS we_kueche
      FROM r
),
marke AS (
    SELECT konzept,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY umsatz_pct)             AS umsatz,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY personalkosten_ogf_pct) AS personal,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY we_bar_pct)             AS we_bar,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY we_kueche_pct)          AS we_kueche
      FROM r
     GROUP BY konzept
)
SELECT r.betrieb,
       coalesce(r.konzept, '(nicht zugeordnet)'),
       r.stadt,
       r.bwa_monat,
       r.umsatz_pct,
       round((r.umsatz_pct             - a.umsatz)::numeric,   2),
       round((r.umsatz_pct             - m.umsatz)::numeric,   2),
       r.personalkosten_ogf_pct,
       round((r.personalkosten_ogf_pct - a.personal)::numeric, 2),
       round((r.personalkosten_ogf_pct - m.personal)::numeric, 2),
       r.we_bar_pct,
       round((r.we_bar_pct             - a.we_bar)::numeric,   2),
       round((r.we_bar_pct             - m.we_bar)::numeric,   2),
       r.we_kueche_pct,
       round((r.we_kueche_pct          - a.we_kueche)::numeric, 2),
       round((r.we_kueche_pct          - m.we_kueche)::numeric, 2),
       r.gesamt, r.intensitaet, r.prioritaet
  FROM r
  CROSS JOIN alle a
  LEFT JOIN marke m ON m.konzept IS NOT DISTINCT FROM r.konzept
 ORDER BY coalesce(r.konzept, 'zzz'), r.betrieb;
$$;

COMMENT ON FUNCTION mart.round_table_marke IS
'Round Table mit doppeltem Massstab: je Kennzahl die Abweichung zum Median ALLER Betriebe
und zum Median der eigenen Marke. Damit ist auf einen Blick unterscheidbar, ob ein Betrieb
schwach ist oder ob gerade seine ganze Marke schwaechelt - der Fall, in dem eine Massnahme
beim einzelnen Betrieb ins Leere laeuft.
Vorzeichen: bei Umsatz ist mehr besser, bei Personal- und Wareneinsatzquoten weniger.
Ein positiver Wert ist also nicht automatisch ein guter Wert.
Betriebe ohne eindeutiges Hauptkonzept haben keine Markenabweichung (NULL) - siehe
mart.konzept_zuordnung.';


-- =====================================================================
-- Warenwirtschaft
-- =====================================================================

CREATE VIEW mart.deckungsbeitrag_warengruppe AS
SELECT betrieb_key, betrieb, konzept, monat,
       grosskategorie, warengruppe, detailkategorie,
       sum(menge)                                              AS menge,
       sum(umsatz_netto)                                       AS umsatz_netto_pos,
       sum(wareneinsatz_theoretisch)                           AS wareneinsatz_theoretisch,
       sum(umsatz_netto) - sum(wareneinsatz_theoretisch)       AS deckungsbeitrag,
       CASE WHEN sum(umsatz_netto) > 0
            THEN round(100 * (sum(umsatz_netto) - sum(wareneinsatz_theoretisch))
                       / sum(umsatz_netto), 2)
       END                                                     AS deckungsbeitrag_prozent,
       round(100 * sum(umsatz_netto) FILTER (WHERE fixer_we IS NOT NULL)
             / nullif(sum(umsatz_netto), 0), 1)                AS abdeckung_pct
  FROM mart.artikelverkauf
 GROUP BY 1, 2, 3, 4, 5, 6, 7;

COMMENT ON VIEW mart.deckungsbeitrag_warengruppe IS
'Deckungsbeitrag je Warengruppe und Monat. Prozentwerte sind Prozentzahlen (23.64), nie Brueche.

ZUERST AUF abdeckung_pct SEHEN. Sie sagt, welcher Anteil des Umsatzes ueberhaupt einen
hinterlegten Wareneinsatzansatz hat. Bei 60 Prozent Abdeckung ist der Deckungsbeitrag
strukturell zu hoch, und zwar ohne dass man es der Zahl ansieht.

ACHTUNG: umsatz_netto_pos ist der POS-Artikelumsatz und NICHT das BWA-Umsatzkonto aus
core.kennzahlen_monat - die beiden weichen systematisch ab. Wer sie vergleicht, liest erst
den Kommentar an mart.pruefung_wareneinsatz.';


CREATE VIEW mart.preisentwicklung_ware AS
SELECT w.ware_key,
       w.name                AS ware,
       l.name                AS lieferant,
       p.monat,
       p.preis,
       p.menge,
       p.gebinde_menge,
       p.basis_faktor,
       CASE WHEN p.menge > 0 AND p.basis_faktor > 0
            THEN round(p.preis / (p.menge * p.basis_faktor), 4)
       END                   AS preis_je_basiseinheit,
       e.abkuerzung          AS basiseinheit,
       p.geaendert_am,
       lag(p.preis) OVER (PARTITION BY p.ware_key, p.lieferant_key ORDER BY p.monat)
                             AS preis_vormonat
  FROM core.einkaufspreis_stand p
  JOIN core.ware w      ON w.ware_key = p.ware_key
  LEFT JOIN core.lieferant l ON l.lieferant_key = p.lieferant_key
  LEFT JOIN core.einheit  e  ON e.einheit_key   = p.einheit_key;

COMMENT ON VIEW mart.preisentwicklung_ware IS
'Einkaufspreise je Ware, Lieferant und Monat, mit Vormonatsvergleich.
Die Reihe beginnt mit der ersten Momentaufnahme -- rueckwirkend gibt es nichts,
weil LINA keine Preishistorie fuehrt.';


-- =====================================================================
-- Gegenrechnung: LINAs Aggregate gegen unsere eigene Neuberechnung
--
-- Bisher uebernehmen wir LINAs fertige Zahlen. Das ist bequem und meistens
-- richtig - aber wenn dort ein Rechenfehler steckt, uebernehmen wir ihn
-- kommentarlos und diskutieren im Round Table ueber eine falsche Ampel.
--
-- Diese Sichten rechnen aus der jeweils feineren Ebene neu und stellen
-- beides nebeneinander. Sie kosten KEINE einzige zusaetzliche Anfrage bei
-- LINA - die Artikeldaten holen wir ohnehin.
--
-- Grundsatz: nichts korrigieren, nur sichtbar machen. Wer automatisch
-- "korrigiert", verschiebt den Fehler nur dorthin, wo ihn keiner sucht.
-- =====================================================================

CREATE VIEW mart.pruefung_umsatz AS
WITH aus_artikeln AS (
    SELECT betrieb_key, geschaeftstag,
           sum(umsatz_netto)  AS netto,
           sum(umsatz_brutto) AS brutto
      FROM core.artikelverkauf_tag
     GROUP BY 1, 2
),
gemeldet AS (
    SELECT betrieb_key, geschaeftstag, umsatz_netto, umsatz_brutto
      FROM core.umsatzbericht_tag
     WHERE hauptsparte_key IS NULL AND verkaufsstelle_key IS NULL
)
SELECT b.name                                    AS betrieb,
       g.geschaeftstag,
       g.umsatz_netto                            AS lina_netto,
       a.netto                                   AS artikel_netto,
       round(a.netto - g.umsatz_netto, 2)        AS differenz,
       round((a.netto - g.umsatz_netto)
             / NULLIF(g.umsatz_netto, 0) * 100, 3) AS differenz_pct,
       -- 0,5 % Toleranz: Rundungen je Artikel summieren sich, echte
       -- Aggregationsfehler liegen erfahrungsgemaess deutlich darueber.
       (abs(a.netto - g.umsatz_netto)
        > 0.005 * abs(NULLIF(g.umsatz_netto, 0)))  AS auffaellig
  FROM gemeldet g
  JOIN aus_artikeln a USING (betrieb_key, geschaeftstag)
  JOIN core.betrieb b USING (betrieb_key);

COMMENT ON VIEW mart.pruefung_umsatz IS
'Tagesumsatz aus den Artikelzeilen neu aufaddiert gegen getUmsatzbericht.
Erste Frage nach jedem Backfill: SELECT count(*) FROM mart.pruefung_umsatz WHERE auffaellig;
Erwartung 0. Ist es nicht 0, vor der naechsten Auswertung klaeren - nicht danach.
Nur Tage, an denen BEIDE Berichte geladen sind; ein fehlender Bericht faellt hier
nicht auf, dafuer ist mart.backfill_fortschritt zustaendig.';


-- Echte Bon-Rohdaten (ein Datensatz je Bon) haben wir NICHT. Die laegen
-- unter /finanzen/report/kassenjournal, sind ungeprueft, vermutlich HTML
-- statt JSON, um Groessenordnungen umfangreicher und personenbezogen
-- (Kellner, Zeitstempel). Siehe docs/offene-punkte.md.
CREATE VIEW mart.pruefung_bon AS
SELECT b.name                          AS betrieb,
       u.geschaeftstag,
       u.umsatz_netto,
       u.rechnungen,
       u.durchschnittsbon              AS lina_bon,
       round(u.umsatz_netto / NULLIF(u.rechnungen, 0), 2) AS bon_gerechnet,
       round(u.durchschnittsbon
             - u.umsatz_netto / NULLIF(u.rechnungen, 0), 2) AS differenz,
       (abs(u.durchschnittsbon - u.umsatz_netto / NULLIF(u.rechnungen, 0)) > 0.05)
                                       AS auffaellig
  FROM core.umsatzbericht_tag u
  JOIN core.betrieb b USING (betrieb_key)
 WHERE u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
   AND u.rechnungen > 0;

COMMENT ON VIEW mart.pruefung_bon IS
'Durchschnittsbon: LINAs avgTicket gegen Umsatz/Rechnungen. Abweichungen sind hier NICHT
automatisch ein Fehler - avgTicket kann auf Brutto oder auf einer anderen Rechnungsmenge
beruhen (Sammelrechnungen, stornierte Bons). Die Sicht sagt, WO nachzusehen ist, nicht was falsch ist.
Toleranz 5 Cent.';


-- Theoretischer Wareneinsatz gegen die BWA.
--
-- WICHTIG: Eine Abweichung ist hier der Normalfall, kein Fehler. Genau
-- diese Luecke ist die fachlich interessante Groesse - sie enthaelt
-- Schwund, Bruch, Portionierung, Personalverzehr und Lagerbewegung. Wer
-- sie als "Rechenfehler" liest, hat den Bericht missverstanden.
--
-- Zwei Grenzen, die man kennen muss:
--   * Nicht jeder Artikel hat einen hinterlegten Ansatz. Deshalb wird die
--     ABDECKUNG mit ausgewiesen - ohne sie sieht ein theoretischer WE bei
--     halber Artikelabdeckung einfach nur niedrig aus.
--   * Die Trennung Bar/Kueche laesst sich aus den Artikelzeilen NICHT
--     nachbilden: die Hauptsparte haengt am Umsatzbericht, nicht am
--     Artikel. Verglichen wird deshalb nur die Summe.
CREATE VIEW mart.pruefung_wareneinsatz AS
WITH theoretisch AS (
    SELECT betrieb_key, monat,
           sum(wareneinsatz_theoretisch)                              AS we_theoretisch,
           sum(umsatz_netto)                                          AS umsatz_artikel,
           sum(umsatz_netto) FILTER (WHERE fixer_we IS NOT NULL)      AS umsatz_mit_we
      FROM mart.artikelverkauf
     GROUP BY 1, 2
),
bwa AS (
    -- Dieselbe Bedingung wie in mart.round_table_basis: ein Monat, in dem
    -- alles null ist, ist nicht gebucht, sondern leer. Ohne sie stuende hier
    -- fuer jeden noch nicht gebuchten Monat eine Luecke in voller Hoehe des
    -- theoretischen Wareneinsatzes.
    SELECT betrieb_key, monat,
           sum(wert_absolut) FILTER (WHERE kennzahl IN ('WE Bar', 'WE Küche')) AS we_bwa,
           max(wert_absolut) FILTER (WHERE kennzahl = 'Umsatz')                AS umsatz_bwa
      FROM mart.kennzahlen_aktuell
     GROUP BY 1, 2
    HAVING count(*) FILTER (WHERE wert_absolut IS NOT NULL AND wert_absolut <> 0) > 0
)
SELECT b.name                                          AS betrieb,
       t.monat,
       round(t.we_theoretisch, 2)                      AS we_theoretisch,
       w.we_bwa,
       round(w.we_bwa - t.we_theoretisch, 2)           AS luecke,
       round(t.we_theoretisch / NULLIF(t.umsatz_mit_we, 0) * 100, 2) AS we_theoretisch_pct,
       round(w.we_bwa / NULLIF(w.umsatz_bwa, 0) * 100, 2)           AS we_bwa_pct,
       round(t.umsatz_mit_we / NULLIF(t.umsatz_artikel, 0) * 100, 1) AS abdeckung_pct
  FROM theoretisch t
  JOIN bwa w  ON w.betrieb_key = t.betrieb_key AND w.monat = t.monat
  JOIN core.betrieb b ON b.betrieb_key = t.betrieb_key;

COMMENT ON VIEW mart.pruefung_wareneinsatz IS
'Soll-Wareneinsatz aus der LINA-Kalkulation (Menge x Ansatz DES JEWEILIGEN TAGES, aus
core.artikel_stand_zeitraum) gegen den Ist-Wareneinsatz aus der BWA.

luecke = BWA minus theoretisch. Ein POSITIVER Wert heisst: es wurde mehr eingekauft als
laut Rezeptur verbraucht - Schwund, Bruch, Portionierung, Personalverzehr, Lageraufbau.
Das ist die eigentliche Kennzahl, nicht der Fehlerhinweis.

abdeckung_pct sagt, welcher Anteil des Artikelumsatzes ueberhaupt einen hinterlegten
Ansatz hat. UNTER ETWA 90 PROZENT IST DER VERGLEICH NICHT AUSSAGEKRAEFTIG - dann ist
der theoretische WE nur strukturell zu niedrig.

Kein Bar/Kueche-Split moeglich: die Hauptsparte haengt am Umsatzbericht, nicht am Artikel.
Bezugsgroessen sind bewusst getrennt ausgewiesen (Artikelumsatz vs. BWA-Umsatzkonto) -
die beiden sind nicht identisch.';


CREATE VIEW mart.pruefung_uebersicht AS
SELECT 'Umsatz: Artikelsumme vs. Umsatzbericht' AS pruefung,
       count(*)                                  AS geprueft,
       count(*) FILTER (WHERE auffaellig)        AS auffaellig,
       'mart.pruefung_umsatz'                    AS sicht
  FROM mart.pruefung_umsatz
UNION ALL
SELECT 'Bon: avgTicket vs. Umsatz/Rechnungen',
       count(*), count(*) FILTER (WHERE auffaellig), 'mart.pruefung_bon'
  FROM mart.pruefung_bon
UNION ALL
SELECT 'Wareneinsatz: Abdeckung unter 90 %',
       count(*), count(*) FILTER (WHERE abdeckung_pct < 90), 'mart.pruefung_wareneinsatz'
  FROM mart.pruefung_wareneinsatz;

COMMENT ON VIEW mart.pruefung_uebersicht IS
'Erste Abfrage nach jedem groesseren Backfill: SELECT * FROM mart.pruefung_uebersicht;
Die Spalte auffaellig ist eine Arbeitsliste, kein Alarm - beim Wareneinsatz zaehlt sie
die Faelle mit zu duenner Artikelabdeckung, nicht die inhaltlichen Abweichungen.';


-- =====================================================================
-- Betrieb des Importers
-- =====================================================================

CREATE VIEW mart.sync_status AS
SELECT l.lauf_id, l.gestartet_am, l.beendet_am, l.ausloeser, l.status,
       l.aufgaben_gesamt, l.aufgaben_ok, l.aufgaben_fehler, l.aufgaben_uebersprungen,
       round(EXTRACT(epoch FROM (l.beendet_am - l.gestartet_am))::numeric, 1) AS dauer_s,
       (SELECT count(*) FROM sync.schema_abweichung a
         WHERE a.erkannt_am >= l.gestartet_am AND a.quittiert_am IS NULL) AS offene_abweichungen,
       (SELECT count(*) FROM sync.fortschritt f WHERE f.pausiert_bis > now()) AS pausierte_kombinationen
  FROM sync.lauf l
 ORDER BY l.lauf_id DESC;

COMMENT ON VIEW mart.sync_status IS
'Gesundheit der letzten Laeufe, juengster zuerst. Erste Anlaufstelle, wenn Zahlen fehlen.';


CREATE VIEW mart.backfill_fortschritt AS
SELECT endpunkt,
       count(*)::int                                                  AS posten_gesamt,
       count(*) FILTER (WHERE erledigt_am IS NOT NULL)::int           AS erledigt,
       count(*) FILTER (WHERE erledigt_am IS NULL)::int               AS offen,
       count(*) FILTER (WHERE erledigt_am IS NULL AND prioritaet <= 10)::int AS offen_laufend,
       count(*) FILTER (WHERE erledigt_am IS NULL AND prioritaet >= 90)::int AS offen_historie,
       count(*) FILTER (WHERE ergebnis = 'ok')::int                   AS geladen,
       count(*) FILTER (WHERE ergebnis = 'keine_daten')::int          AS keine_daten,
       count(*) FILTER (WHERE ergebnis = 'aufgegeben')::int           AS aufgegeben,
       round(100.0 * count(*) FILTER (WHERE erledigt_am IS NOT NULL)
                   / nullif(count(*), 0), 1)                          AS prozent,
       min(zeitraum_von) FILTER (WHERE ergebnis = 'ok')               AS aeltester_geladen,
       max(zeitraum_bis) FILTER (WHERE ergebnis = 'ok')               AS juengster_geladen,
       min(zeitraum_von) FILTER (WHERE erledigt_am IS NULL)           AS aeltester_offener,
       max(zeitraum_von) FILTER (WHERE erledigt_am IS NULL)           AS juengster_offener
  FROM sync.warteschlange
 GROUP BY endpunkt
 ORDER BY offen DESC, endpunkt;

COMMENT ON VIEW mart.backfill_fortschritt IS
'Wie weit ist der Backfill je Endpunkt? Die Sicht, die man morgens aufmacht.
Prozentwerte sind Prozentzahlen (23.64), nie Brueche.
Ein Lauf laesst sich jederzeit unterbrechen und neu starten: der Zustand steht in
sync.warteschlange, nicht im Prozess. Nach einem pg_dump/restore macht der Importer auf dem
Zielserver genau hier weiter.';
