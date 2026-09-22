-- =====================================================================
-- 0117 Die Auswertungsschicht zu den Betriebsberichten (M5 in
--      docs/plan-lina-vollabzug.md, Abschnitt 6.1)
--
-- WOFUER. Bis 0115 lagen die neuen Kassendaten nur in core — und core ist
-- fuer den MCP-Zugang (mcp_leser) und fuer jede Karte gesperrt bzw.
-- verboten. Die Frage, die das Vorhaben ausgeloest hat ("Wie viele Stueck je
-- Artikel liefen im August ueber die Gluecksrad-Finanzwege 10/25/50 %, je
-- Betrieb?"), war damit weiter nur per Auftrag beantwortbar. Ab hier steht
-- sie in mart, und dort sind die Fallen dieser Daten ausgeraeumt, statt sie
-- jedem Leser zu erklaeren.
--
-- DIE FALLEN, DIE HIER AUSGERAEUMT WERDEN — jede Sicht nennt die ihre im
-- Kommentar:
--
--   1. core.finanzweg_tag traegt dieselbe Zahl aus ZWEI Berichten (88 und 97,
--      gemessen auf den Cent gleich). mart.finanzweg_tag nimmt je Betrieb und
--      Tag GENAU EINE Quelle: 97, wo es ihn gibt, sonst 88.
--   2. Berichte der Klasse T (88, 92) tragen den ABRUFZEITRAUM. Im Betrieb ist
--      er ein Tag; ein Mehrtagesabruf (Abnahme M1, Handabruf) steht daneben.
--      Die Tagessichten nehmen einen Mehrtagesabruf nur, wo es fuer diesen
--      Betrieb im Zeitraum KEINEN Tagesabruf gibt — sonst zaehlte er doppelt.
--   3. 92 zaehlt ARTIKEL, 88/97 zaehlen VORGAENGE. Die Spalten heissen deshalb
--      verschieden (menge gegen anzahl_vorgaenge), nie "anzahl".
--   4. 92: nur Zeilen MIT Artikelnamen (die Gluecksrad-Zahl vom 22.09.2026
--      zaehlt genau diese). Gruppenkoepfe sind schon in core nicht geladen.
--   5. Zwei Finanzwege "25 % Gluecksrad" (3501 mit Apostroph, 3168 ohne). Die
--      Sichten tragen deshalb aktion (Name ohne Prozentzahl) und prozentsatz;
--      gebuendelt wird darueber, nicht ueber eine Nummernliste.
--   6. LINAs Vorzeichen: Zahlungen und Nachlaesse sind in core NEGATIV. In
--      mart sind Nachlass, Storno und Zahlbetrag POSITIV, der Name der Spalte
--      sagt, was gezaehlt ist.
--   7. Kopfzeilen der Blockberichte (61, 53, 75, 76) sind Monatssummen und
--      stehen nicht in mart.
--
-- DIE LEITSPALTEN. Jede fachliche Sicht traegt betrieb_key, enc_id, betrieb,
-- marke (das Hauptkonzept) und am ENDE operativ — dieselbe Ordnung wie die
-- Bounti-Sichten (0097), damit eine spaetere Spalte angehaengt werden kann
-- (CREATE OR REPLACE VIEW kann nur anhaengen).
--
-- LADESTAND. Ein Monat, fuer den ein Bericht nicht geladen ist, ist KEINE
-- NULL. mart.betriebsbericht_ladestand sagt je Bericht, fuer welchen
-- Zeitraum er vollstaendig da ist (harte Regel 10); der MCP-Server haengt
-- diese Aussage an jede Antwort, die eine der Sichten hier liest.
--
-- KEINE MATERIALISIERUNG. Gemessen am 23.09.2026 auf einem Klon mit
-- synthetischem Vollbestand (docs/metabase.md, Abschnitt zu 0117). Die
-- Tagessichten filtern auf der partitionierten Spalte; die Monatssichten der
-- Stufe B lesen Tabellen mit einer Zeile je Betrieb und Monat.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Zwei reine Funktionen: Aktion und Prozentsatz aus dem Finanzwegnamen
--
-- IN mart UND OHNE TABELLENZUGRIFF. Ein Funktionsrumpf laeuft mit den
-- Rechten des AUFRUFERS (0109/0110) — diese beiden lesen nichts, also gibt
-- es nichts, woran die Leserolle scheitern koennte. Dieselbe Regel wie
-- prozentAusName() im Lader (src/transform/betriebsbericht.ts), damit
-- core.finanzweg.prozentsatz und diese Spalte nie auseinanderlaufen.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mart.finanzweg_prozentsatz(p_name text)
RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN v <= 100 THEN v END
      FROM (SELECT replace(substring(p_name from '(\d{1,3}(?:[.,]\d+)?)\s*%'), ',', '.')::numeric AS v) x
$$;

COMMENT ON FUNCTION mart.finanzweg_prozentsatz(text) IS
'Prozentsatz aus einem Finanzwegnamen: "50% Gluecksrad" → 50, "Perso 40%" → 40,
"Family&Friends20 %" → 20, ohne Prozentzahl NULL. Prozentzahl, kein Bruch (harte Regel 6).
Dieselbe Regel wie prozentAusName() im Lader.';

CREATE OR REPLACE FUNCTION mart.finanzweg_aktion(p_name text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT nullif(btrim(regexp_replace(regexp_replace(regexp_replace(p_name,
             '\d{1,3}([.,]\d+)?\s*%', ' ', 'g'),
             '[''"´`’‘]', '', 'g'),
             '\s+', ' ', 'g')), '')
$$;

COMMENT ON FUNCTION mart.finanzweg_aktion(text) IS
'Der Finanzwegname ohne Prozentzahl und ohne Apostroph: "25% Gluecksrad''" und
"25% Gluecksrad" werden beide zu "Gluecksrad". Damit buendelt man eine Aktion ueber
ihre Finanzwege — zusammen mit dem Prozentsatz, NICHT ueber eine Nummernliste: am
22.09.2026 lief die 25-%-Stufe des Gluecksrads ueber zwei Nummern (3501 und 3168),
und wer nach 3500/3501/3502 filterte, verlor 31 Vorgaenge in einem Betrieb still.';


-- ---------------------------------------------------------------------
-- 1. Der Finanzweg-Stamm
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.finanzweg AS
SELECT f.nummer                                            AS finanzweg_nummer,
       f.name                                              AS finanzweg_name,
       f.finanzgruppe,
       f.art,
       f.prozentsatz,
       CASE WHEN f.art = 'nachlass' THEN mart.finanzweg_aktion(f.name) END AS aktion,
       f.erstmals_gesehen,
       f.zuletzt_gesehen,
       (SELECT count(DISTINCT s.name)::int FROM core.finanzweg_stand s
         WHERE s.nummer = f.nummer)                        AS namen
  FROM core.finanzweg f;

COMMENT ON VIEW mart.finanzweg IS
'Koernung: ein Finanzweg (LINAs Nummer). Der Stamm entsteht aus den Berichten 88 und 97 —
eine andere Quelle gibt es nicht. art: nachlass (Hausbon, Rabatt) | zahlart | umsatz |
statistik, abgeleitet aus der Finanzgruppe. aktion ist der Name ohne Prozentzahl, nur bei
Nachlaessen gesetzt.

namen > 1 heisst: dieselbe Nummer lief in verschiedenen Monaten oder Betrieben unter
verschiedenen Namen. Dann taugt die Nummer allein nicht als Schluessel.

Die Auswahlliste fuer den Finanzweg-Filter der Dashboards kommt von hier.';


-- ---------------------------------------------------------------------
-- 2. Nachlass je Artikel (Bericht 92) — die Gluecksrad-Tabelle
-- ---------------------------------------------------------------------

-- DER MONAT ALS INDEX. Die Tabellen sind nach geschaeftstag partitioniert;
-- ein Filter auf den MONAT einer Sicht ("monat = 2026-08-01") schneidet
-- keine Partition weg, weil er auf einem Ausdruck liegt. Gemessen am
-- 23.09.2026 auf einem Klon mit 7,8 Mio. synthetischen Rabattzeilen (62
-- Betriebe, 2018 bis Juli 2026, je Tag 40 Zeilen): die Gluecksrad-Frage
-- fuer EINEN Monat brauchte 9,3 s, jeder weitere Monat 2,2 s — die
-- Monatssicht aggregierte den ganzen Bestand und filterte danach. Der
-- Ausdrucksindex traegt den Filter in jede Partition; dafuer muss die Sicht
-- den Monat mit GENAU diesem Ausdruck bilden (date auf timestamp, nicht auf
-- timestamptz — nur so ist date_trunc unveraenderlich und indexierbar).
CREATE INDEX IF NOT EXISTS rabatt_artikel_tag_monat_idx
    ON core.rabatt_artikel_tag ((date_trunc('month', geschaeftstag::timestamp)::date), betrieb_key);
CREATE INDEX IF NOT EXISTS finanzweg_tag_monat_idx
    ON core.finanzweg_tag ((date_trunc('month', geschaeftstag::timestamp)::date), betrieb_key);

CREATE OR REPLACE VIEW mart.artikel_nachlass_tag AS
WITH r AS (
    -- ERST VERDICHTEN, DANN BENENNEN. Betrieb, Marke und Status kommen nach
    -- der Gruppierung dazu: mit ihnen in der Gruppierung sortierte Postgres
    -- jede Rabattzeile nach elf Schluesseln (23.09.2026).
    SELECT r.geschaeftstag, r.zeitraum_bis, r.betrieb_key, r.finanzweg_name, r.finanzweg_nummer,
           r.artikel_name, r.artikel_key,
           sum(r.anzahl) AS menge, sum(r.brutto) AS brutto, sum(r.netto) AS netto,
           count(*)::int AS zeilen
      FROM core.rabatt_artikel_tag r
     WHERE r.artikel_name IS NOT NULL
       AND (r.zeitraum_bis = r.geschaeftstag
            -- Ein Mehrtagesabruf zaehlt nur, wo dieser Betrieb im Zeitraum
            -- keinen einzigen Tagesabruf hat — sonst stuenden dieselben
            -- Nachlaesse zweimal da (Falle 2 im Kopf).
            OR NOT EXISTS (SELECT 1 FROM core.rabatt_artikel_tag t
                            WHERE t.betrieb_key = r.betrieb_key
                              AND t.geschaeftstag BETWEEN r.geschaeftstag AND r.zeitraum_bis
                              AND t.zeitraum_bis = t.geschaeftstag))
     GROUP BY r.geschaeftstag, r.zeitraum_bis, r.betrieb_key, r.finanzweg_name, r.finanzweg_nummer,
              r.artikel_name, r.artikel_key
)
SELECT r.geschaeftstag,
       r.zeitraum_bis,
       (r.zeitraum_bis - r.geschaeftstag + 1)              AS tage,
       date_trunc('month', r.geschaeftstag::timestamp)::date AS monat,
       r.betrieb_key,
       b.enc_id,
       b.name                                              AS betrieb,
       bs.konzept                                          AS marke,
       mart.finanzweg_aktion(r.finanzweg_name)             AS aktion,
       mart.finanzweg_prozentsatz(r.finanzweg_name)        AS prozentsatz,
       r.finanzweg_name,
       r.finanzweg_nummer,
       f.finanzgruppe,
       r.artikel_name                                      AS artikel,
       r.artikel_key,
       a.artikelnummer,
       r.menge,
       -r.brutto                                           AS nachlass_brutto,
       -r.netto                                            AS nachlass_netto,
       r.zeilen,
       (bs.status = 'operativ')                            AS operativ
  FROM r
  JOIN core.betrieb b              ON b.betrieb_key  = r.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = r.betrieb_key
  LEFT JOIN core.finanzweg f       ON f.nummer       = r.finanzweg_nummer
  LEFT JOIN core.artikel a         ON a.artikel_key  = r.artikel_key;

COMMENT ON VIEW mart.artikel_nachlass_tag IS
'Koernung: Betrieb × Abrufzeitraum × Finanzweg × Artikel aus dem Rabattbericht (92). Im
Regelbetrieb ist der Abrufzeitraum EIN TAG (tage = 1). Ein Mehrtagesabruf (tage > 1) steht nur
da, wo es fuer diesen Betrieb im Zeitraum keinen Tagesabruf gibt. Fuer einen Zeitraum von..bis
also filtern: geschaeftstag >= von AND zeitraum_bis <= bis (und geschaeftstag <= bis, damit
Postgres nur die betroffenen Monate liest).

menge ist die Zahl der ARTIKEL auf Bons, auf die dieser Nachlass gebucht wurde — NICHT die
Verkaufsmenge und NICHT die Zahl der Nachlass-Vorgaenge. Der Nachlass gilt fuer den ganzen Bon:
im August 2026 trugen 327 verschiedene Artikel einen Gluecksrad-Nachlass, auch Getraenke.
nachlass_brutto/-netto sind der GEWAEHRTE Nachlass, positiv (LINA fuehrt ihn negativ).

Nur Zeilen MIT Artikelnamen: 28 von 8.533 Zeilen im August 2026 trugen keinen Namen, wohl aber
einen Betrag — die Gluecksrad-Auswertung vom 22.09.2026 zaehlt sie nicht mit, diese Sicht auch
nicht. Den vollstaendigen Nachlassbetrag je Finanzweg fuehrt mart.finanzweg_tag (88/97).

Eine Aktion buendelt man ueber aktion und prozentsatz, nie ueber finanzweg_nummer: zwei Wege
heissen "25 % Gluecksrad" (3501, 3168), und die Nummer ist NULL, solange 88/97 fuer den Tag
fehlt. artikel_key/artikelnummer sind ueber den NAMEN zugeordnet (92 liefert keine Nummer),
nur bei genau einem Treffer im selben Betrieb und Zeitraum; die Luecken zeigt
mart.rabatt_artikel_unaufgeloest.';


CREATE OR REPLACE VIEW mart.artikel_nachlass_monat AS
SELECT n.monat,
       n.betrieb_key, n.enc_id, n.betrieb, n.marke,
       n.aktion, n.prozentsatz, n.finanzweg_name, n.finanzweg_nummer, n.finanzgruppe,
       n.artikel, n.artikel_key, n.artikelnummer,
       sum(n.menge)                                        AS menge,
       sum(n.nachlass_brutto)                              AS nachlass_brutto,
       sum(n.nachlass_netto)                               AS nachlass_netto,
       count(DISTINCT n.geschaeftstag) FILTER (WHERE n.tage = 1)::int AS tage_mit_nachlass,
       bool_or(n.tage > 1)                                 AS aus_mehrtagesabruf,
       n.operativ
  FROM mart.artikel_nachlass_tag n
 -- Nur Abrufzeitraeume innerhalb EINES Kalendermonats. Ein Handabruf ueber
 -- eine Monatsgrenze steht in der Tagessicht, hier nicht — er liesse sich
 -- keinem Monat ehrlich zuschlagen.
 WHERE n.zeitraum_bis < (n.monat + interval '1 month')
 GROUP BY n.monat, n.betrieb_key, n.enc_id, n.betrieb, n.marke, n.aktion, n.prozentsatz,
          n.finanzweg_name, n.finanzweg_nummer, n.finanzgruppe, n.artikel, n.artikel_key,
          n.artikelnummer, n.operativ;

COMMENT ON VIEW mart.artikel_nachlass_monat IS
'Koernung: Betrieb × Monat × Finanzweg × Artikel — die Gluecksrad-Tabelle (F1 im Plan). Summe
der Tageszeilen aus mart.artikel_nachlass_tag; ein Monatsabruf zaehlt nur, wo der Betrieb im
Monat keinen Tagesabruf hat (aus_mehrtagesabruf = true).

ABNAHME am 23.09.2026 (Klon, echte Antworten der 14 Wilma-Wunder-Betriebe, August 2026):
sum(menge) WHERE aktion = ''Gluecksrad'' GROUP BY prozentsatz ergibt 10 %: 149, 25 %: 1.413
(beide Nummern), 50 %: 7.335; davon Durchstarter 12 / 107 / 432 = 551.

menge = Artikel auf Bons mit diesem Nachlass, nicht Verkaufsmenge (der Nachlass gilt fuer den
ganzen Bon). Nachlass positiv. Fuer Vorgaenge und den vollstaendigen Betrag je Finanzweg:
mart.nachlass_monat. Eine Aktion ueber aktion + prozentsatz buendeln, nie ueber
finanzweg_nummer. Ein fehlender Monat ist keine Null — mart.betriebsbericht_ladestand.';


-- ---------------------------------------------------------------------
-- 3. Finanzwege je Tag und Monat (88/97) — ohne Doppelzaehlung
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.finanzweg_tag AS
WITH q AS (
    SELECT t.*
      FROM core.finanzweg_tag t
     WHERE (t.bericht = 97 AND t.zeitraum_bis = t.geschaeftstag)
        OR (t.bericht = 88 AND t.zeitraum_bis = t.geschaeftstag
            AND NOT EXISTS (SELECT 1 FROM core.finanzweg_tag x
                             WHERE x.bericht = 97 AND x.betrieb_key = t.betrieb_key
                               AND x.geschaeftstag = t.geschaeftstag))
        OR (t.bericht = 88 AND t.zeitraum_bis > t.geschaeftstag
            AND NOT EXISTS (SELECT 1 FROM core.finanzweg_tag x
                             WHERE x.betrieb_key = t.betrieb_key
                               AND x.geschaeftstag BETWEEN t.geschaeftstag AND t.zeitraum_bis
                               AND x.zeitraum_bis = x.geschaeftstag))
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
       -- Dieselbe Ableitung wie finanzwegArt() im Lader, hier aus der Zeile
       -- selbst: ein Join auf core.finanzweg nur dafuer verdarb dem Planer
       -- die Schaetzung (6,5 s statt 0,4 s fuer einen Monat, 23.09.2026).
       CASE lower(q.finanzgruppe)
         WHEN 'hausbon' THEN 'nachlass' WHEN 'rabatt' THEN 'nachlass'
         WHEN 'umsatz' THEN 'umsatz' WHEN 'statistik' THEN 'statistik'
         ELSE 'zahlart' END                                AS art,
       q.abschnitt,
       mart.finanzweg_prozentsatz(q.finanzweg_name)        AS prozentsatz,
       CASE WHEN lower(q.finanzgruppe) IN ('hausbon', 'rabatt')
            THEN mart.finanzweg_aktion(q.finanzweg_name) END AS aktion,
       -- Zahlungen und Nachlaesse fuehrt LINA negativ. Hier positiv: dann
       -- summieren sich die Zahlarten eines Tages zum Bruttoumsatz
       -- (Trinkgeld und Rueckgeld stehen dabei negativ — sie stecken in den
       -- Zahlbetraegen darueber). Umsatzzeilen mit LINAs Vorzeichen.
       CASE WHEN lower(q.finanzgruppe) IN ('umsatz', 'statistik') THEN q.umsatz
            ELSE -q.umsatz END                             AS betrag,
       q.anzahl                                            AS anzahl_vorgaenge,
       (bs.status = 'operativ')                            AS operativ
  FROM q
  JOIN core.betrieb b              ON b.betrieb_key  = q.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = q.betrieb_key;

COMMENT ON VIEW mart.finanzweg_tag IS
'Koernung: Betrieb × Tag × Finanzweg — aus GENAU EINER Quelle je Betrieb und Tag: Bericht 97
(Tagesabschluss), wo es ihn gibt, sonst 88 (quelle_bericht). core.finanzweg_tag fuehrt beide,
und eine Summe darueber waere doppelt (0114, gemessen auf den Cent gleich). Ein Mehrtagesabruf
von 88 (tage > 1) steht nur da, wo der Betrieb im Zeitraum keinen Tageswert hat.

betrag: Zahlungen und Nachlaesse POSITIV (LINA fuehrt sie negativ). Die Zahlarten eines Tages
summieren sich zum Bruttoumsatz — Trinkgeld und Rueckgeld stehen dabei negativ, weil sie in den
Zahlbetraegen darueber enthalten sind (Wilma Wunder Duesseldorf, August 2026: 369.841,09 EUR,
nachgerechnet am 23.09.2026). Umsatzzeilen (Boniert, Sofortstorno, Storno) behalten LINAs
Vorzeichen.

anzahl_vorgaenge zaehlt VORGAENGE (50 % Gluecksrad: 600 in Duesseldorf), nicht Artikel — der
Rabattbericht zaehlt fuer denselben Finanzweg 712 Artikel. Nie gegen mart.artikel_nachlass_*
addieren. Eine Aktion buendelt man ueber aktion + prozentsatz, nicht ueber die Nummer.';


-- MATERIALISIERT, gemessen: auf einem Klon mit 10,4 Mio. Finanzwegzeilen
-- (88 und 97 fuer 152.782 echte Betrieb-Tage) brauchte der Zahlungsmix
-- einer Marke ueber zwoelf Monate 2,6 s in der Datenbank — jede Tageszeile
-- von 88 prueft, ob es fuer ihren Tag 97 gibt. Das Ergebnis aendert sich
-- nur mit einem Lauf. Die Basis fuehrt keine Namen: Betrieb, Marke und
-- operativ kommen live aus der Sicht darueber (wie 0111).
CREATE MATERIALIZED VIEW IF NOT EXISTS mart.finanzweg_monat_basis AS
SELECT t.monat,
       t.betrieb_key,
       t.finanzweg_nummer, t.finanzweg_name, t.finanzgruppe, t.art, t.abschnitt,
       t.prozentsatz, t.aktion,
       sum(t.betrag)                                       AS betrag,
       sum(t.anzahl_vorgaenge)                             AS anzahl_vorgaenge,
       count(DISTINCT t.geschaeftstag) FILTER (WHERE t.tage = 1)::int AS tage_mit_wert,
       string_agg(DISTINCT t.quelle_bericht::text, '+')    AS quellen
  FROM mart.finanzweg_tag t
 WHERE t.zeitraum_bis < (t.monat + interval '1 month')
 GROUP BY t.monat, t.betrieb_key, t.finanzweg_nummer, t.finanzweg_name, t.finanzgruppe, t.art,
          t.abschnitt, t.prozentsatz, t.aktion
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS finanzweg_monat_basis_uq
    ON mart.finanzweg_monat_basis (betrieb_key, monat, finanzweg_nummer, finanzweg_name,
                                   finanzgruppe, abschnitt) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS finanzweg_monat_basis_monat_idx
    ON mart.finanzweg_monat_basis (monat, art);

REFRESH MATERIALIZED VIEW mart.finanzweg_monat_basis;

COMMENT ON MATERIALIZED VIEW mart.finanzweg_monat_basis IS
'Koernung: Betrieb × Monat × Finanzweg — die materialisierte Summe von mart.finanzweg_tag (je
Betrieb und Tag eine Quelle, 97 vor 88). Aufgefrischt in Phase B und nach Phase C
(src/sync/betriebsbericht_sichten.ts); wie alt, sagt mart.materialisierung_stand. Gelesen wird
mart.finanzweg_monat — dort stehen Betrieb, Marke und operativ live dazu.';

CREATE OR REPLACE VIEW mart.finanzweg_monat AS
SELECT m.monat,
       m.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       m.finanzweg_nummer, m.finanzweg_name, m.finanzgruppe, m.art, m.abschnitt,
       m.prozentsatz, m.aktion,
       m.betrag,
       m.anzahl_vorgaenge,
       m.tage_mit_wert,
       m.quellen,
       (bs.status = 'operativ')                            AS operativ
  FROM mart.finanzweg_monat_basis m
  JOIN core.betrieb b              ON b.betrieb_key  = m.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = m.betrieb_key;

COMMENT ON VIEW mart.finanzweg_monat IS
'Koernung: Betrieb × Monat × Finanzweg — Summe von mart.finanzweg_tag (je Tag eine Quelle,
quellen nennt sie: 97, 88 oder 97+88), materialisiert in mart.finanzweg_monat_basis und damit so
frisch wie der letzte Lauf (mart.materialisierung_stand). betrag positiv fuer Zahlungen und Nachlaesse,
anzahl_vorgaenge sind Vorgaenge. tage_mit_wert zaehlt die Tage, an denen der Finanzweg
ueberhaupt vorkam — nicht die geladenen Tage (die stehen in mart.betriebsbericht_ladestand).';


CREATE OR REPLACE VIEW mart.nachlass_monat AS
WITH n AS (
    SELECT m.monat, m.betrieb_key, m.enc_id, m.betrieb, m.marke, m.finanzgruppe, m.aktion,
           m.prozentsatz,
           string_agg(DISTINCT m.finanzweg_name, ' | ' ORDER BY m.finanzweg_name) AS finanzwege,
           sum(m.betrag)                                   AS nachlass_brutto,
           sum(m.anzahl_vorgaenge)                         AS anzahl_vorgaenge,
           m.operativ
      FROM mart.finanzweg_monat m
     WHERE m.art = 'nachlass'
     GROUP BY m.monat, m.betrieb_key, m.enc_id, m.betrieb, m.marke, m.finanzgruppe, m.aktion,
              m.prozentsatz, m.operativ
)
SELECT n.monat,
       n.betrieb_key, n.enc_id, n.betrieb, n.marke,
       n.finanzgruppe,
       n.aktion,
       n.prozentsatz,
       n.finanzwege,
       n.nachlass_brutto,
       n.anzahl_vorgaenge,
       u.umsatz_brutto                                     AS umsatz_brutto_monat,
       round(100 * n.nachlass_brutto / nullif(u.umsatz_brutto, 0), 2) AS nachlass_anteil_pct,
       n.operativ
  FROM n
  LEFT JOIN LATERAL (
       -- Je Betrieb und Monat EIN Griff in den Umsatzbericht ueber seinen
       -- Index (betrieb_key, geschaeftstag). Als gruppierte Unterabfrage mit
       -- Join las jede Abfrage den ganzen Umsatzbericht: ein Datumsbereich
       -- wandert nicht ueber einen Join in eine zweite Gruppierung.
       SELECT sum(u.umsatz_brutto) AS umsatz_brutto
         FROM core.umsatzbericht_tag u
        WHERE u.betrieb_key = n.betrieb_key
          AND u.geschaeftstag >= n.monat AND u.geschaeftstag < (n.monat + interval '1 month')::date
          AND u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL) u ON true;

COMMENT ON VIEW mart.nachlass_monat IS
'Koernung: Betrieb × Monat × Finanzgruppe × Aktion × Prozentsatz — was die Nachlaesse kosten
(F2). Die Finanzwege einer Aktion sind zusammengefasst (finanzwege nennt sie): die beiden
"25 % Gluecksrad" (3501, 3168) stehen in EINER Zeile. nachlass_brutto ist der gewaehrte
Nachlass, positiv, VOLLSTAENDIG (aus 88/97, nicht aus dem Rabattbericht). anzahl_vorgaenge sind
Vorgaenge, keine Artikel. nachlass_anteil_pct: Prozentzahl vom Bruttoumsatz des Betriebs im
Monat (Umsatzbericht) — nicht mitteln, nicht summieren.';


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
       m.operativ
  FROM mart.finanzweg_monat m
 WHERE m.art = 'zahlart';

COMMENT ON VIEW mart.zahlart_monat IS
'Koernung: Betrieb × Monat × Zahlart (F3: Karte gegen bar, Lieferdienste, Gutscheine). Aus
88/97, je Tag eine Quelle. zahlbetrag positiv; die Summe aller Zeilen eines Betriebs und
Monats ist der Bruttoumsatz. Trinkgeld und Rueckgeld stehen NEGATIV, weil sie in den
Zahlbetraegen der anderen Zeilen stecken. zahlart_anteil_pct: Prozentzahl von allem, was
Gaeste bezahlt haben (Summe der positiven Zeilen, also einschliesslich Trinkgeld); fuer
Trinkgeld und Rueckgeld leer. Nicht summieren, nicht mitteln.';


-- ---------------------------------------------------------------------
-- 4. Bons (96)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bon_tag AS
WITH t AS (
    -- Erst je Betrieb und Tag verdichten, dann benennen (siehe
    -- mart.artikel_nachlass_tag).
    SELECT o.geschaeftstag, o.betrieb_key,
           count(*) FILTER (WHERE o.art = 'Rechnung')                AS bons,
           count(*) FILTER (WHERE o.art = 'Stornierte Rechnung')     AS stornierte_bons,
           count(*) FILTER (WHERE o.art = 'Gutschrift')              AS gutschriften,
           sum(o.brutto)                                             AS umsatz_brutto,
           sum(o.brutto) FILTER (WHERE o.art = 'Rechnung')           AS bons_brutto,
           sum(o.brutto) FILTER (WHERE o.art = 'Gutschrift')         AS gutschriften_brutto,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY o.brutto)
             FILTER (WHERE o.art = 'Rechnung')                       AS bon_median,
           sum(o.anzahl_artikel) FILTER (WHERE o.art = 'Rechnung')   AS artikel,
           count(*) FILTER (WHERE o.art = 'Rechnung' AND cardinality(o.finanzwege) > 1
                              AND NOT (o.finanzwege <@ ARRAY['Trinkgeld', 'Tischübergabe',
                                                             'Tischübernahme', 'Rückgeld']))
                                                                     AS bons_geteilt_bezahlt,
           count(*) FILTER (WHERE o.art = 'Rechnung' AND o.debitor IS NOT NULL) AS debitor_bons
      FROM core.bon o
     GROUP BY o.geschaeftstag, o.betrieb_key
)
SELECT t.geschaeftstag,
       date_trunc('month', t.geschaeftstag::timestamp)::date AS monat,
       t.betrieb_key,
       b.enc_id,
       b.name                                              AS betrieb,
       bs.konzept                                          AS marke,
       t.bons::int                                         AS bons,
       t.stornierte_bons::int                              AS stornierte_bons,
       t.gutschriften::int                                 AS gutschriften,
       t.umsatz_brutto,
       t.bons_brutto,
       t.gutschriften_brutto,
       round(t.bons_brutto / nullif(t.bons, 0), 2)         AS bon_durchschnitt,
       round(t.bon_median::numeric, 2)                     AS bon_median,
       t.artikel,
       t.bons_geteilt_bezahlt::int                         AS bons_geteilt_bezahlt,
       t.debitor_bons::int                                 AS debitor_bons,
       round(100.0 * t.gutschriften / nullif(t.bons + t.stornierte_bons, 0), 2) AS gutschriftenquote_pct,
       (bs.status = 'operativ')                            AS operativ
  FROM t
  JOIN core.betrieb b              ON b.betrieb_key  = t.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = t.betrieb_key;

COMMENT ON VIEW mart.bon_tag IS
'Koernung: Betrieb × Tag, aus dem Rechnungsausgangsbuch (96, eine Zeile je Bon in core.bon) — F9.

bons zaehlt die gueltigen Rechnungen. Eine stornierte Rechnung und ihre Gutschrift heben sich auf
(15.08.2026 Duesseldorf: 13 und 13, +1.230,50 und -1.230,50 EUR); umsatz_brutto ist die Summe
ALLER Bons des Tages und trifft LINAs balanceSumBrutto. bon_durchschnitt = bons_brutto / bons,
bon_median der Median der Rechnungen — beide nicht ueber Tage mitteln, sondern aus den Summen
neu rechnen. gutschriftenquote_pct: Gutschriften je 100 ausgestellte Rechnungen (Prozentzahl).
bons_geteilt_bezahlt: Rechnungen mit mehr als einer Zahlart (Trinkgeld, Rueckgeld und die
Tischuebergabe zaehlen dabei nicht als Zahlart).

WAS 96 NICHT KANN: keine Uhrzeit, keine Artikel und KEINE Nachlass-Finanzwege — "Bons mit
Aktion" und "Durchschnittsbon mit gegen ohne Aktion" sind hieraus nicht beantwortbar (am
15.08.2026 zeigte 88 fuer Duesseldorf 32 Gluecksrad-Vorgaenge, keiner der 519 Bons trug ihn).
Zeitraum immer ueber geschaeftstag filtern — core.bon hat rund 30 Mio. Zeilen.';


CREATE OR REPLACE VIEW mart.bon_zahlart_tag AS
WITH gruppe AS (
    -- Name → Finanzgruppe aus dem Stamm. Juengster Name gewinnt.
    SELECT DISTINCT ON (f.name) f.name, f.finanzgruppe, f.art
      FROM core.finanzweg f
     ORDER BY f.name, f.zuletzt_gesehen DESC
), je_bon AS (
    -- Die Zahl der Rechnungen des Tages als Fensterfunktion und nicht als
    -- zweite, gruppierte Unterabfrage: ein Datumsbereich wandert in eine
    -- Fensterfunktion ueber (geschaeftstag, betrieb_key), aber ueber einen
    -- Join nicht in eine zweite Gruppierung — mit der Unterabfrage las ein
    -- Monat alle Bons (10,1 s auf 6,1 Mio. synthetischen Bons, 23.09.2026).
    SELECT o.geschaeftstag, o.betrieb_key, o.finanzwege,
           count(*) OVER (PARTITION BY o.geschaeftstag, o.betrieb_key) AS bons_gesamt
      FROM core.bon o
     WHERE o.art = 'Rechnung'
), z AS (
    SELECT j.geschaeftstag, j.betrieb_key, u.zahlart,
           count(*) AS bons_mit_zahlart, max(j.bons_gesamt) AS bons_gesamt
      FROM je_bon j
      CROSS JOIN LATERAL (SELECT DISTINCT x AS zahlart FROM unnest(j.finanzwege) x) u
     GROUP BY j.geschaeftstag, j.betrieb_key, u.zahlart
)
SELECT z.geschaeftstag,
       date_trunc('month', z.geschaeftstag::timestamp)::date AS monat,
       z.betrieb_key,
       b.enc_id,
       b.name                                              AS betrieb,
       bs.konzept                                          AS marke,
       z.zahlart,
       g.finanzgruppe,
       z.bons_mit_zahlart::int                             AS bons_mit_zahlart,
       z.bons_gesamt::int                                  AS bons_gesamt,
       round(100.0 * z.bons_mit_zahlart / nullif(z.bons_gesamt, 0), 2) AS bons_anteil_pct,
       (bs.status = 'operativ')                            AS operativ
  FROM z
  JOIN core.betrieb b              ON b.betrieb_key  = z.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = z.betrieb_key
  LEFT JOIN gruppe g               ON g.name = z.zahlart
 WHERE coalesce(g.art, '') <> 'statistik';

COMMENT ON VIEW mart.bon_zahlart_tag IS
'Koernung: Betrieb × Tag × Zahlart — wie viele RECHNUNGEN diese Zahlart trugen (96). Ein Bon mit
EC-Karte und Trinkgeld steht in beiden Zeilen: bons_mit_zahlart summiert sich ueber die
Zahlarten NICHT zu bons_gesamt, und bons_anteil_pct (Prozentzahl der Rechnungen des Tages) nicht
zu 100. Die Tischuebergabe ist keine Zahlart und fehlt. Betraege je Zahlart liefert 96 nicht —
die stehen in mart.zahlart_monat (88/97). 96 fuehrt KEINE Nachlass-Finanzwege: eine Zeile
"Gluecksrad" gibt es hier nicht, und ihr Fehlen heisst nicht "kein Gluecksrad".';


-- Debitoren sind selten; ohne diesen Index laese jede Monatsabfrage alle Bons.
CREATE INDEX IF NOT EXISTS bon_debitor_idx
    ON core.bon (betrieb_key, geschaeftstag) WHERE debitor IS NOT NULL;

CREATE OR REPLACE VIEW mart.debitor_monat AS
WITH d AS (
    SELECT o.betrieb_key, date_trunc('month', o.geschaeftstag::timestamp)::date AS monat, o.debitor,
           max(o.debitor_anschrift)                              AS debitor_anschrift,
           count(*) FILTER (WHERE o.art = 'Rechnung')           AS bons,
           count(*) FILTER (WHERE o.art = 'Gutschrift')         AS gutschriften,
           sum(o.brutto)                                        AS umsatz_brutto
      FROM core.bon o
     WHERE o.debitor IS NOT NULL
     GROUP BY 1, 2, 3
)
SELECT d.monat,
       d.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       d.debitor,
       d.debitor_anschrift,
       d.bons::int                                          AS bons,
       d.gutschriften::int                                  AS gutschriften,
       d.umsatz_brutto,
       (bs.status = 'operativ')                             AS operativ
  FROM d
  JOIN core.betrieb b              ON b.betrieb_key  = d.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = d.betrieb_key;

COMMENT ON VIEW mart.debitor_monat IS
'Koernung: Betrieb × Monat × Debitor — wer auf Rechnung kauft (F10), aus den Debitorfeldern
des Rechnungsausgangsbuchs (96). umsatz_brutto ist die Summe aller Bons dieses Debitors
(Gutschriften mindern). Bericht 86 (core.debitor_bon) lieferte am 15.08.2026 dieselben Bons wie
96 und ist hier deshalb nicht Quelle, sondern Gegenprobe.';


-- ---------------------------------------------------------------------
-- 5. Tagesabschluss (97) und Monatsaufstellung (90 + 108)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.tagesabschluss_tag AS
SELECT t.geschaeftstag,
       date_trunc('month', t.geschaeftstag)::date          AS monat,
       t.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       t.hauptsparte,
       t.steuersatz,
       t.brutto                                            AS umsatz_brutto,
       (bs.status = 'operativ')                            AS operativ
  FROM core.tagesabschluss_tag t
  JOIN core.betrieb b              ON b.betrieb_key  = t.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = t.betrieb_key;

COMMENT ON VIEW mart.tagesabschluss_tag IS
'Koernung: Betrieb × Tag × Hauptsparte × Steuersatz aus dem Tagesabschluss (97, Z-Bon-Block).
BRUTTO; ueber einen Monat summiert genau LINAs balanceSumBrutto (Duesseldorf August 2026:
369.841,09 EUR). hauptsparte und steuersatz sind LINAs Texte ("Speisen", "19%_Mwst"), keine
Schluessel. Die Finanzwege desselben Abschlusses stehen in mart.finanzweg_tag.';


CREATE OR REPLACE VIEW mart.monatsaufstellung_tag AS
WITH ma AS (
    SELECT betrieb_key, geschaeftstag, sum(anzahl) AS artikel, sum(brutto) AS brutto,
           sum(netto) AS netto, sum(ust) AS ust,
           (array_agg(steuersaetze ORDER BY zeile))[1] AS steuersaetze
      FROM core.monatsaufstellung_tag GROUP BY 1, 2
), vz AS (
    SELECT betrieb_key, geschaeftstag, sum(anzahl_rechnungen) AS rechnungen,
           sum(anzahl_zahlungen) AS zahlungen, sum(brutto) AS brutto,
           max(betrieb_name_lina) AS betrieb_name_lina
      FROM core.verkaufszahlen_tag GROUP BY 1, 2
), t AS (
    SELECT coalesce(ma.betrieb_key, vz.betrieb_key)       AS betrieb_key,
           coalesce(ma.geschaeftstag, vz.geschaeftstag)   AS geschaeftstag,
           ma.artikel, coalesce(ma.brutto, vz.brutto) AS brutto, ma.netto, ma.ust,
           vz.rechnungen, vz.zahlungen, ma.steuersaetze, vz.betrieb_name_lina
      FROM ma FULL JOIN vz ON vz.betrieb_key = ma.betrieb_key AND vz.geschaeftstag = ma.geschaeftstag
)
SELECT t.geschaeftstag,
       date_trunc('month', t.geschaeftstag)::date          AS monat,
       t.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       t.brutto                                            AS umsatz_brutto,
       t.netto                                             AS umsatz_netto,
       t.ust,
       t.artikel,
       t.rechnungen,
       t.zahlungen,
       round(t.zahlungen::numeric / nullif(t.rechnungen, 0), 2) AS zahlungen_je_rechnung,
       t.steuersaetze,
       t.betrieb_name_lina,
       (bs.status = 'operativ')                            AS operativ
  FROM t
  JOIN core.betrieb b              ON b.betrieb_key  = t.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = t.betrieb_key;

COMMENT ON VIEW mart.monatsaufstellung_tag IS
'Koernung: Betrieb × Tag — Monatsaufstellung Tag fuer Tag (90: Brutto, Netto, USt, Artikel,
Steuersaetze) neben den Verkaufszahlen (108: Rechnungen, Zahlungen). Neu gegenueber dem
Umsatzbericht ist zahlungen: am 01.08.2026 in Duesseldorf 879 Rechnungen mit 1.140 Zahlungen —
zahlungen_je_rechnung 1,30 heisst, dass Tische geteilt zahlen. Nicht ueber Tage mitteln.
steuersaetze: LINAs uebrige Spalten als jsonb; die Schluessel wechseln je Betrieb und Zeit.
betrieb_name_lina ist der Name, den LINA in die Antwort schreibt — die Gegenprobe, dass der
richtige Betrieb abgefragt wurde.';


-- ---------------------------------------------------------------------
-- 6. Storno mit Grund (39)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.storno_artikel_monat AS
WITH s AS (
    SELECT s.monat, s.betrieb_key, s.artikelnummer, max(s.artikel_name) AS artikel_name,
           s.stornotyp, s.stornogrund,
           -sum(s.anzahl) AS storno_menge, -sum(s.umsatz_brutto) AS storno_brutto,
           -sum(s.umsatz_netto) AS storno_netto
      FROM core.storno_artikel_monat s
     GROUP BY s.monat, s.betrieb_key, s.artikelnummer, s.stornotyp, s.stornogrund
)
SELECT s.monat,
       s.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       s.artikelnummer,
       coalesce(s.artikel_name, a.name)                    AS artikel,
       s.stornotyp,
       s.stornogrund,
       s.storno_menge,
       s.storno_brutto,
       s.storno_netto,
       (bs.status = 'operativ')                            AS operativ
  FROM s
  JOIN core.betrieb b              ON b.betrieb_key  = s.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = s.betrieb_key
  LEFT JOIN core.artikel a         ON a.artikelnummer = s.artikelnummer;

COMMENT ON VIEW mart.storno_artikel_monat IS
'Koernung: Betrieb × Monat × Artikel × Stornotyp × Stornogrund (39, enthaelt 38 vollstaendig).
storno_menge und storno_brutto sind POSITIV (LINA fuehrt Stornos negativ); eine Zeile kann
negativ werden, wenn in ihr mehr zurueckgenommen als storniert wurde. Stornotyp: Sofortstorno
(vor dem Bonieren) | Storno (danach). Die Stornogruende sind eher Schwundgruende
(entscheidungen.md) — "Keine Zuordnung" ist der haeufigste Grund und heisst: an der Kasse ohne
Grund storniert. Artikelname aus dem Bericht, sonst aus core.artikel ueber die Nummer.';


CREATE OR REPLACE VIEW mart.storno_grund_monat AS
WITH g AS (
    SELECT s.monat, s.betrieb_key, s.stornotyp, s.stornogrund,
           -sum(s.anzahl) AS storno_menge, -sum(s.umsatz_brutto) AS storno_brutto,
           count(DISTINCT s.artikelnummer) AS artikel
      FROM core.storno_artikel_monat s
     GROUP BY s.monat, s.betrieb_key, s.stornotyp, s.stornogrund
)
SELECT g.monat, g.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       g.stornotyp, g.stornogrund,
       g.storno_menge,
       g.storno_brutto,
       g.artikel::int                                      AS artikel,
       u.umsatz_brutto                                     AS umsatz_brutto_monat,
       round(100 * g.storno_brutto / nullif(u.umsatz_brutto, 0), 2) AS stornoquote_pct,
       (bs.status = 'operativ')                            AS operativ
  FROM g
  JOIN core.betrieb b              ON b.betrieb_key  = g.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = g.betrieb_key
  LEFT JOIN LATERAL (
       -- Je Betrieb und Monat EIN Griff in den Umsatzbericht ueber seinen
       -- Index (betrieb_key, geschaeftstag). Als gruppierte Unterabfrage mit
       -- Join las jede Abfrage den ganzen Umsatzbericht: ein Datumsbereich
       -- wandert nicht ueber einen Join in eine zweite Gruppierung.
       SELECT sum(u.umsatz_brutto) AS umsatz_brutto
         FROM core.umsatzbericht_tag u
        WHERE u.betrieb_key = g.betrieb_key
          AND u.geschaeftstag >= g.monat AND u.geschaeftstag < (g.monat + interval '1 month')::date
          AND u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL) u ON true;

COMMENT ON VIEW mart.storno_grund_monat IS
'Koernung: Betrieb × Monat × Stornotyp × Stornogrund (39). stornoquote_pct: storniertes Brutto
als Prozentzahl vom Bruttoumsatz des Betriebs im Monat (Umsatzbericht, also NACH Storno) — ueber
alle Gruende eines Betriebs summierbar, ueber Betriebe nicht mitteln. storno_brutto positiv.
Gemessen August 2026, Wilma Wunder Duesseldorf: 20.538,06 EUR storniert.';


-- ---------------------------------------------------------------------
-- 7. Kellner (60, 57)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.kellner_monat AS
WITH k AS (
    SELECT betrieb_key, monat, kellnernummer, max(kellner_name) AS kellner_name,
           sum(brutto) AS brutto, sum(netto) AS netto, sum(anzahl_artikel) AS artikel,
           sum(trinkgeld) AS trinkgeld
      FROM core.kellner_umsatz_monat GROUP BY 1, 2, 3
), g AS (
    SELECT betrieb_key, monat, kellnernummer, count(*) AS gutschriften,
           sum(brutto) AS gutschriften_brutto
      FROM core.gutschrift_kellner GROUP BY 1, 2, 3
)
SELECT k.monat,
       k.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       k.kellnernummer,
       coalesce(k.kellner_name, 'Kellner ' || k.kellnernummer) AS kellner,
       k.brutto                                            AS kellner_umsatz_brutto,
       k.netto                                             AS kellner_umsatz_netto,
       k.artikel                                           AS kellner_artikel,
       k.trinkgeld,
       coalesce(g.gutschriften, 0)::int                    AS gutschriften,
       coalesce(g.gutschriften_brutto, 0)                  AS gutschriften_brutto,
       round(100 * k.netto / nullif(sum(k.netto) OVER (PARTITION BY k.betrieb_key, k.monat), 0), 2)
                                                           AS kellner_anteil_pct,
       (bs.status = 'operativ')                            AS operativ
  FROM k
  JOIN core.betrieb b              ON b.betrieb_key  = k.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = k.betrieb_key
  LEFT JOIN g ON g.betrieb_key = k.betrieb_key AND g.monat = k.monat AND g.kellnernummer = k.kellnernummer;

COMMENT ON VIEW mart.kellner_monat IS
'Koernung: Betrieb × Monat × Kellnernummer (60 Umsatz pro Kellner, 57 Gutschriften) — F6.
LINA liefert KEINEN Kellnernamen (Vermessung 22.09.2026); kellner ist dann "Kellner <Nummer>".
Die Nummer ist eine Kassennummer JE BETRIEB, keine Person ueber Betriebe hinweg — eine Zuordnung
zu Bounti-Konten ist damit nicht moeglich.

DIE SUMME UEBER KELLNER IST NICHT DER BETRIEBSUMSATZ: ein Bon kann mehreren Kellnern
zugeschlagen sein. kellner_anteil_pct ist der Anteil am Kellnerumsatz des Betriebs (netto,
Prozentzahl), nicht am Umsatzbericht. Die Tagesberichte je Kellner (61) und die Artikel je
Kellner (53) nennen den Kellner nicht einmal mit Nummer und stehen deshalb nicht in mart.';


-- ---------------------------------------------------------------------
-- 8. Betriebsstellen (68, 69) und Verkaufsstellen (112, 71)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.betriebsstelle_monat AS
WITH s AS (
    SELECT betrieb_key, monat, betriebsstelle, sum(umsatz_brutto) AS brutto,
           sum(umsatz_netto) AS netto, sum(anzahl_artikel) AS artikel, sum(anzahl_gaeste) AS gaeste
      FROM core.betriebsstelle_umsatz_monat GROUP BY 1, 2, 3
)
SELECT s.monat,
       s.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       s.betriebsstelle,
       s.brutto                                            AS umsatz_brutto,
       s.netto                                             AS umsatz_netto,
       s.artikel,
       s.gaeste,
       round(s.netto / nullif(s.gaeste, 0), 2)             AS netto_je_gast,
       round(100 * s.netto / nullif(sum(s.netto) OVER (PARTITION BY s.betrieb_key, s.monat), 0), 2)
                                                           AS stelle_anteil_pct,
       (bs.status = 'operativ')                            AS operativ
  FROM s
  JOIN core.betrieb b              ON b.betrieb_key  = s.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = s.betrieb_key;

COMMENT ON VIEW mart.betriebsstelle_monat IS
'Koernung: Betrieb × Monat × Betriebsstelle (68: Restaurant, Bar, Dachterrasse …) — F7.
Summierbar zum Betriebsumsatz. netto_je_gast aus den Summen neu gerechnet (LINAs eigener
Quotient ist verworfen), stelle_anteil_pct ist die Prozentzahl vom Nettoumsatz des Betriebs —
beide nicht mitteln. Die Namen der Stellen vergibt jeder Betrieb selbst.';


CREATE OR REPLACE VIEW mart.betriebsstelle_hauptsparte_monat AS
WITH s AS (
    SELECT s.monat, s.betrieb_key, s.betriebsstelle, s.hauptsparte, sum(s.umsatz_brutto) AS umsatz_brutto,
           sum(s.umsatz_netto) AS umsatz_netto, sum(s.anzahl_artikel) AS artikel
      FROM core.betriebsstelle_hauptsparte_monat s
     GROUP BY s.monat, s.betrieb_key, s.betriebsstelle, s.hauptsparte
)
SELECT s.monat,
       s.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       s.betriebsstelle,
       s.hauptsparte,
       s.umsatz_brutto,
       s.umsatz_netto,
       s.artikel,
       (bs.status = 'operativ')                            AS operativ
  FROM s
  JOIN core.betrieb b              ON b.betrieb_key  = s.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = s.betrieb_key;

COMMENT ON VIEW mart.betriebsstelle_hauptsparte_monat IS
'Koernung: Betrieb × Monat × Betriebsstelle × Hauptsparte (69). hauptsparte ist LINAs Text,
kein Schluessel auf core.hauptsparte. Summierbar.';


CREATE OR REPLACE VIEW mart.verkaufsstelle_monat AS
WITH s AS (
    SELECT betrieb_key, monat, verkaufsstelle, sum(umsatz_brutto) AS brutto,
           sum(umsatz_netto) AS netto, sum(anzahl) AS artikel, sum(anzahl_gaeste) AS gaeste
      FROM core.verkaufsstelle_umsatz_monat GROUP BY 1, 2, 3
)
SELECT s.monat,
       s.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       s.verkaufsstelle,
       s.brutto                                            AS umsatz_brutto,
       s.netto                                             AS umsatz_netto,
       s.artikel,
       s.gaeste,
       round(s.netto / nullif(s.gaeste, 0), 2)             AS netto_je_gast,
       round(100 * s.netto / nullif(sum(s.netto) OVER (PARTITION BY s.betrieb_key, s.monat), 0), 2)
                                                           AS stelle_anteil_pct,
       (bs.status = 'operativ')                            AS operativ
  FROM s
  JOIN core.betrieb b              ON b.betrieb_key  = s.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = s.betrieb_key;

COMMENT ON VIEW mart.verkaufsstelle_monat IS
'Koernung: Betrieb × Monat × Verkaufsstelle (112: Gesamtbetrieb, Ausser Haus, Strassenverkauf …)
— F15 je Betrieb. Summierbar zum Betriebsumsatz (Duesseldorf August 2026: 367.091,59 +
2.749,50 = 369.841,09 EUR brutto). Der Konzernweg ueber den Umsatzbericht (0112) liefert
dasselbe je Tag; solange mart.verkaufsstelle_abdeckung dort nicht "ok" meldet, ist diese Sicht
die belastbare. netto_je_gast und stelle_anteil_pct nicht mitteln.';


CREATE OR REPLACE VIEW mart.verkaufsstelle_hauptsparte_monat AS
WITH s AS (
    SELECT s.monat, s.betrieb_key, s.verkaufsstelle, s.hauptsparte, sum(s.umsatz_brutto) AS umsatz_brutto,
           sum(s.umsatz_netto) AS umsatz_netto, sum(s.anzahl) AS artikel
      FROM core.verkaufsstelle_hauptsparte_monat s
     GROUP BY s.monat, s.betrieb_key, s.verkaufsstelle, s.hauptsparte
)
SELECT s.monat,
       s.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       s.verkaufsstelle,
       s.hauptsparte,
       s.umsatz_brutto,
       s.umsatz_netto,
       s.artikel,
       (bs.status = 'operativ')                            AS operativ
  FROM s
  JOIN core.betrieb b              ON b.betrieb_key  = s.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = s.betrieb_key;

COMMENT ON VIEW mart.verkaufsstelle_hauptsparte_monat IS
'Koernung: Betrieb × Monat × Verkaufsstelle × Hauptsparte (71). Summierbar.';


-- ---------------------------------------------------------------------
-- 9. Zeitzonen je Sparte (75, 76) — ohne Kopfzeilen
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.zeitzone_hauptsparte_monat AS
WITH z AS (
    SELECT z.monat, z.betrieb_key, z.hauptsparte, z.zeitzone,
           sum(z.brutto) AS umsatz_brutto, sum(z.netto) AS umsatz_netto
      FROM core.zeitzone_hauptsparte_monat z
     WHERE NOT z.ist_kopf
     GROUP BY z.monat, z.betrieb_key, z.hauptsparte, z.zeitzone
)
SELECT z.monat,
       z.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       z.hauptsparte,
       z.zeitzone,
       nullif(split_part(z.zeitzone, ':', 1), '')::int     AS zeitzone_beginn,
       z.umsatz_brutto,
       z.umsatz_netto,
       (bs.status = 'operativ')                            AS operativ
  FROM z
  JOIN core.betrieb b              ON b.betrieb_key  = z.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = z.betrieb_key;

COMMENT ON VIEW mart.zeitzone_hauptsparte_monat IS
'Koernung: Betrieb × Monat × Hauptsparte × vordefinierte Zeitzone (76) — F8: wann verdienen wir
womit. Die Kopfzeilen des Berichts (Monatssumme je Sparte) sind NICHT enthalten; die Zeilen
summieren sich zur Sparte. zeitzone ist LINAs Text ("9:00 - 12:00"), zeitzone_beginn die Stunde
zum Sortieren. Die Stundenwerte ohne Sparte stehen vollstaendiger in mart.umsatz_zeitzone
(Konzernbericht). LINAs "Durchschnitt pro Tag" ist verworfen — aus der Summe neu rechnen.';


CREATE OR REPLACE VIEW mart.zeitzone_feinsparte_monat AS
WITH z AS (
    SELECT z.monat, z.betrieb_key, z.feinsparte, z.zeitzone,
           sum(z.brutto) AS umsatz_brutto, sum(z.netto) AS umsatz_netto
      FROM core.zeitzone_feinsparte_monat z
     WHERE NOT z.ist_kopf
     GROUP BY z.monat, z.betrieb_key, z.feinsparte, z.zeitzone
)
SELECT z.monat,
       z.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       z.feinsparte,
       z.zeitzone,
       nullif(split_part(z.zeitzone, ':', 1), '')::int     AS zeitzone_beginn,
       z.umsatz_brutto,
       z.umsatz_netto,
       (bs.status = 'operativ')                            AS operativ
  FROM z
  JOIN core.betrieb b              ON b.betrieb_key  = z.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = z.betrieb_key;

COMMENT ON VIEW mart.zeitzone_feinsparte_monat IS
'Koernung: Betrieb × Monat × Feinsparte × vordefinierte Zeitzone (75). Wie
mart.zeitzone_hauptsparte_monat, eine Ebene feiner. Kopfzeilen nicht enthalten. Nie mit der
Hauptspartensicht zusammen summieren — es sind dieselben Umsaetze in zwei Gliederungen.';


-- ---------------------------------------------------------------------
-- 10. Unbare Zahlungen nach Betriebsstelle (99)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.unbar_zahlung_monat AS
WITH u AS (
    SELECT u.monat, u.betrieb_key, u.betriebsstelle, u.finanzweg,
           -sum(u.saldo) AS zahlbetrag, sum(u.zahlungen) AS zahlungen
      FROM core.unbar_zahlung_monat u
     GROUP BY u.monat, u.betrieb_key, u.betriebsstelle, u.finanzweg
)
SELECT u.monat,
       u.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       u.betriebsstelle,
       u.finanzweg                                         AS zahlart,
       u.zahlbetrag,
       u.zahlungen::int                                    AS zahlungen,
       round(u.zahlbetrag / nullif(u.zahlungen, 0), 2)     AS zahlung_durchschnitt,
       (bs.status = 'operativ')                            AS operativ
  FROM u
  JOIN core.betrieb b              ON b.betrieb_key  = u.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = u.betrieb_key;

COMMENT ON VIEW mart.unbar_zahlung_monat IS
'Koernung: Betrieb × Monat × Betriebsstelle × Zahlart — unbare Zahlungen (99, Entscheidung E6).
zahlbetrag positiv (LINA fuehrt Zahlungen negativ), zahlungen = Zahl der Einzelzahlungen
(Rueckbuchungen eingeschlossen), zahlung_durchschnitt daraus — nicht mitteln. Neu gegenueber
mart.zahlart_monat ist nur die Betriebsstelle; die Summe je Zahlart sollte dort gleich sein.';


-- ---------------------------------------------------------------------
-- 10b. Was sonst noch in core liegt — damit JEDE Tabelle aus 0112–0115 eine
--      lesbare Sicht hat (Auftrag vom 23.09.2026: "all diese neuen
--      Informationen auch ueber den MCP zugaenglich"). Ohne Sicht ist eine
--      Tabelle fuer den MCP-Zugang und fuer jede Karte unsichtbar.
-- ---------------------------------------------------------------------

-- Kellnerbloecke (61, 53): LINA nennt den Kellner nicht. Die Kopfzeile eines
-- Blocks traegt aber seine Monatssumme, und die gleicht der Zeile des Kellners
-- in Bericht 60 (Duesseldorf August 2026: 4.628,25 EUR = Kellner 1000). Wo
-- GENAU EIN Kellner diese Summe hat, steht seine Nummer daneben — sonst NULL,
-- geraten wird nicht.
CREATE OR REPLACE VIEW mart.kellner_umsatz_tag AS
WITH kopf AS (
    SELECT k.betrieb_key, k.monat, k.kellner_block, min(m.kellnernummer) AS kellnernummer,
           count(m.kellnernummer) AS treffer
      FROM core.kellner_umsatz_tag k
      LEFT JOIN core.kellner_umsatz_monat m
             ON m.betrieb_key = k.betrieb_key AND m.monat = k.monat
            AND abs(m.brutto - k.brutto) < 0.005
     WHERE k.ist_kopf
     GROUP BY k.betrieb_key, k.monat, k.kellner_block
), t AS (
    SELECT t.betrieb_key, t.monat, t.kellner_block, t.geschaeftstag,
           sum(t.brutto) AS brutto, sum(t.netto) AS netto, sum(t.anzahl_artikel) AS artikel,
           sum(t.trinkgeld) AS trinkgeld
      FROM core.kellner_umsatz_tag t
     WHERE NOT t.ist_kopf
     GROUP BY t.betrieb_key, t.monat, t.kellner_block, t.geschaeftstag
)
SELECT t.geschaeftstag,
       t.monat,
       t.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       t.kellner_block,
       CASE WHEN k.treffer = 1 THEN k.kellnernummer END    AS kellnernummer,
       t.brutto                                            AS kellner_umsatz_brutto,
       t.netto                                             AS kellner_umsatz_netto,
       t.artikel                                           AS kellner_artikel,
       t.trinkgeld,
       (bs.status = 'operativ')                            AS operativ
  FROM t
  JOIN core.betrieb b              ON b.betrieb_key  = t.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = t.betrieb_key
  LEFT JOIN kopf k ON k.betrieb_key = t.betrieb_key AND k.monat = t.monat AND k.kellner_block = t.kellner_block;

COMMENT ON VIEW mart.kellner_umsatz_tag IS
'Koernung: Betrieb × Tag × Kellnerblock (61 Umsatz pro Kellner pro Tag). LINA nennt den Kellner in
diesem Bericht NICHT, auch nicht mit Nummer: je Kellner ein Block, kellner_block zaehlt die Bloecke
in Antwortreihenfolge und ist nur innerhalb eines Betriebs und Monats eine Kennung.
kellnernummer steht da, wo die Monatssumme des Blocks genau EINEM Kellner aus Bericht 60 gleicht,
sonst NULL. Die Kopfzeilen (Monatssummen) sind nicht enthalten. Die Summe ueber Kellner ist nicht
der Betriebsumsatz (ein Bon kann mehreren Kellnern zugeschlagen sein).';


CREATE OR REPLACE VIEW mart.kellner_artikel_monat AS
WITH kopf AS (
    SELECT k.betrieb_key, k.monat, k.kellner_block, min(m.kellnernummer) AS kellnernummer,
           count(m.kellnernummer) AS treffer
      FROM core.kellner_artikel_monat k
      LEFT JOIN core.kellner_umsatz_monat m
             ON m.betrieb_key = k.betrieb_key AND m.monat = k.monat
            AND abs(m.brutto - k.brutto) < 0.005
     WHERE k.ist_kopf
     GROUP BY k.betrieb_key, k.monat, k.kellner_block
)
SELECT a.monat,
       a.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       a.kellner_block,
       CASE WHEN k.treffer = 1 THEN k.kellnernummer END    AS kellnernummer,
       a.artikelnummer,
       a.artikel_name                                      AS artikel,
       a.brutto                                            AS kellner_umsatz_brutto,
       a.netto                                             AS kellner_umsatz_netto,
       a.anzahl_artikel                                    AS menge,
       (bs.status = 'operativ')                            AS operativ
  FROM core.kellner_artikel_monat a
  JOIN core.betrieb b              ON b.betrieb_key  = a.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = a.betrieb_key
  LEFT JOIN kopf k ON k.betrieb_key = a.betrieb_key AND k.monat = a.monat AND k.kellner_block = a.kellner_block
 WHERE NOT a.ist_kopf;

COMMENT ON VIEW mart.kellner_artikel_monat IS
'Koernung: Betrieb × Monat × Kellnerblock × Artikel (53 Artikelbericht pro Kellner) — der groesste
Bericht im Katalog, rund 6.700 Zeilen je Betrieb und Monat. IMMER mit monat filtern: die Tabelle
darunter ist nach monat partitioniert. Kellner wie in mart.kellner_umsatz_tag: kellner_block je
Betrieb und Monat, kellnernummer nur bei eindeutiger Monatssumme. menge = verkaufte Stueck dieses
Artikels durch diesen Kellner. Kopfzeilen nicht enthalten.';


CREATE OR REPLACE VIEW mart.gutschrift AS
SELECT g.geschaeftstag,
       g.monat,
       g.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       g.kellnernummer,
       g.gutschriftnummer,
       g.rechnungsnummer,
       g.anzahl_artikel                                    AS artikel,
       g.brutto                                            AS gutschrift_brutto,
       (bs.status = 'operativ')                            AS operativ
  FROM core.gutschrift_kellner g
  JOIN core.betrieb b              ON b.betrieb_key  = g.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = g.betrieb_key;

COMMENT ON VIEW mart.gutschrift IS
'Koernung: eine Gutschrift (57 Gutschriften pro Kellner), mit Kellnernummer und der Rechnung, die
sie aufhebt. gutschrift_brutto mit LINAs Vorzeichen (in den gemessenen Zeilen 0,00). Die Zahl je
Kellner und Monat steht fertig in mart.kellner_monat, die Zahl je Tag in mart.bon_tag.';


CREATE OR REPLACE VIEW mart.tisch_tag AS
WITH t AS (
    SELECT t.geschaeftstag, t.betrieb_key, t.tisch_id,
           count(*) FILTER (WHERE t.art = 'Rechnung')          AS bons,
           sum(t.brutto)                                       AS umsatz_brutto,
           sum(t.anzahl_artikel) FILTER (WHERE t.art = 'Rechnung') AS artikel
      FROM core.tischtransfer_bon t
     GROUP BY t.geschaeftstag, t.betrieb_key, t.tisch_id
)
SELECT t.geschaeftstag,
       date_trunc('month', t.geschaeftstag::timestamp)::date AS monat,
       t.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       t.tisch_id,
       t.bons::int                                         AS bons,
       t.umsatz_brutto,
       t.artikel,
       (bs.status = 'operativ')                            AS operativ
  FROM t
  JOIN core.betrieb b              ON b.betrieb_key  = t.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = t.betrieb_key;

COMMENT ON VIEW mart.tisch_tag IS
'Koernung: Betrieb × Tag × Tisch (TischId aus dem Tischtransfer, 113). Am 15.08.2026 lieferte 113
dieselben 519 Bons wie 96 — neu ist nur die TischId. tisch_id ist LINAs interne Kennung, kein
Tischname. Zeitraum immer ueber geschaeftstag filtern.';


CREATE OR REPLACE VIEW mart.debitorenauswertung_tag AS
WITH d AS (
    SELECT o.geschaeftstag, o.betrieb_key, o.debitor, max(o.debitor_anschrift) AS debitor_anschrift,
           count(*) FILTER (WHERE o.art ILIKE 'Rechnung')      AS bons,
           count(*)                                            AS zeilen,
           sum(o.brutto)                                       AS umsatz_brutto
      FROM core.debitor_bon o
     GROUP BY o.geschaeftstag, o.betrieb_key, o.debitor
)
SELECT d.geschaeftstag,
       date_trunc('month', d.geschaeftstag::timestamp)::date AS monat,
       d.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       d.debitor,
       d.debitor_anschrift,
       d.bons::int                                         AS bons,
       d.zeilen::int                                       AS zeilen,
       d.umsatz_brutto,
       (bs.status = 'operativ')                            AS operativ
  FROM d
  JOIN core.betrieb b              ON b.betrieb_key  = d.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = d.betrieb_key;

COMMENT ON VIEW mart.debitorenauswertung_tag IS
'Koernung: Betrieb × Tag × Debitor aus der Debitorenauswertung (86). debitor NULL = Bons ohne
Debitor — am 15.08.2026 lieferte 86 dieselben 519 Bons wie 96, ob 86 bei Betrieben MIT Debitoren
nur deren Bons fuehrt, ist nicht gemessen (offene-punkte.md). Fuer die Frage "wer kauft auf
Rechnung" ist mart.debitor_monat (aus 96) die Quelle; diese Sicht ist die Gegenprobe.';


CREATE OR REPLACE VIEW mart.finanzweg_namen AS
SELECT s.nummer                                            AS finanzweg_nummer,
       s.monat,
       s.name                                              AS finanzweg_name,
       nullif(s.finanzgruppe, '')                          AS finanzgruppe,
       count(*) OVER (PARTITION BY s.nummer, s.monat)      AS namen_im_monat
  FROM core.finanzweg_stand s;

COMMENT ON VIEW mart.finanzweg_namen IS
'Koernung: Finanzweg × Monat × Name — welche Namen eine Nummer wann trug (core.finanzweg_stand,
append-only). namen_im_monat > 1: verschiedene Betriebe fuehren dieselbe Nummer unter
verschiedenen Namen — dann taugt die Nummer allein nicht als Schluessel.';


CREATE OR REPLACE VIEW mart.verkaufsstelle_tag AS
SELECT u.geschaeftstag,
       date_trunc('month', u.geschaeftstag::timestamp)::date AS monat,
       u.betrieb_key, b.enc_id, b.name AS betrieb, bs.konzept AS marke,
       v.nummer                                            AS verkaufsstelle_nummer,
       v.name                                              AS verkaufsstelle,
       u.umsatz_brutto,
       u.umsatz_netto,
       u.rechnungen,
       (bs.status = 'operativ')                            AS operativ
  FROM core.umsatzbericht_tag u
  JOIN core.verkaufsstelle v       ON v.verkaufsstelle_key = u.verkaufsstelle_key
  JOIN core.betrieb b              ON b.betrieb_key  = u.betrieb_key
  LEFT JOIN mart.betrieb_status bs ON bs.betrieb_key = u.betrieb_key
 WHERE u.verkaufsstelle_key IS NOT NULL AND u.hauptsparte_key IS NULL;

COMMENT ON VIEW mart.verkaufsstelle_tag IS
'Koernung: Betrieb × Tag × Verkaufsstelle aus dem KONZERN-Umsatzbericht (getUmsatzbericht mit
verkaufsstellen=, seit 0112). Der Parameter ist ungeprueft: solange mart.verkaufsstelle_abdeckung
fuer den Monat nicht "ok" meldet, ist mart.verkaufsstelle_monat (Betriebsbericht 112) die
belastbare Zahl. Nie mit mart.umsatz_tag addieren — die Stellen sind ein Teil des Gesamtumsatzes.';


-- ---------------------------------------------------------------------
-- 11. Ladestand: welcher Zeitraum je Bericht geladen ist (harte Regel 10)
-- ---------------------------------------------------------------------

-- MATERIALISIERT, gemessen: gegen 454.626 Abrufzeilen (Produktionsgroesse nach
-- vollstaendigem Backfill, synthetisch) brauchte die Sicht 10,9 s — und der
-- MCP-Server haengt ihre Aussage an JEDE Antwort auf eine Kassensicht. Jede
-- Antwort waere damit elf Sekunden langsamer gewesen als ihre Abfrage.
CREATE MATERIALIZED VIEW IF NOT EXISTS mart.betriebsbericht_ladestand_basis AS
WITH sichten (endpunkt, sichten) AS (
    -- Welche mart-Sicht aus welchem Bericht liest. Der MCP-Server haengt
    -- ueber diese Liste den Ladestand an jede Antwort — eine Sicht, die hier
    -- fehlt, bekommt keinen Hinweis.
    VALUES
      ('getReport:92',  ARRAY['mart.artikel_nachlass_tag', 'mart.artikel_nachlass_monat']),
      ('getReport:88',  ARRAY['mart.finanzweg_tag', 'mart.finanzweg_monat', 'mart.nachlass_monat', 'mart.zahlart_monat']),
      ('getReport:97',  ARRAY['mart.finanzweg_tag', 'mart.finanzweg_monat', 'mart.nachlass_monat', 'mart.zahlart_monat', 'mart.tagesabschluss_tag']),
      ('getReport:96',  ARRAY['mart.bon_tag', 'mart.bon_zahlart_tag', 'mart.debitor_monat']),
      ('getReport:90',  ARRAY['mart.monatsaufstellung_tag']),
      ('getReport:108', ARRAY['mart.monatsaufstellung_tag']),
      ('getReport:39',  ARRAY['mart.storno_artikel_monat', 'mart.storno_grund_monat']),
      ('getReport:60',  ARRAY['mart.kellner_monat', 'mart.kellner_umsatz_tag', 'mart.kellner_artikel_monat']),
      ('getReport:61',  ARRAY['mart.kellner_umsatz_tag']),
      ('getReport:53',  ARRAY['mart.kellner_artikel_monat']),
      ('getReport:57',  ARRAY['mart.kellner_monat', 'mart.gutschrift']),
      ('getReport:86',  ARRAY['mart.debitorenauswertung_tag']),
      ('getReport:113', ARRAY['mart.tisch_tag']),
      ('getReport:68',  ARRAY['mart.betriebsstelle_monat']),
      ('getReport:69',  ARRAY['mart.betriebsstelle_hauptsparte_monat']),
      ('getReport:112', ARRAY['mart.verkaufsstelle_monat']),
      ('getReport:71',  ARRAY['mart.verkaufsstelle_hauptsparte_monat']),
      ('getReport:75',  ARRAY['mart.zeitzone_feinsparte_monat']),
      ('getReport:76',  ARRAY['mart.zeitzone_hauptsparte_monat']),
      ('getReport:99',  ARRAY['mart.unbar_zahlung_monat'])
), berichte AS (
    SELECT q.endpunkt, q.bezeichnung, q.fensterklasse
      FROM sync.quelle q
     WHERE q.endpunkt LIKE 'getReport:%' AND q.erwartet
    UNION
    -- Auch ein Bericht, der (noch) nicht im Register steht, aber geladen
    -- wurde — sonst verschwaende sein Stand still.
    SELECT DISTINCT a.endpunkt, NULL::text, NULL::text
      FROM core.betriebsbericht_abruf a
     WHERE NOT EXISTS (SELECT 1 FROM sync.quelle q WHERE q.endpunkt = a.endpunkt AND q.erwartet)
), monate AS (
    SELECT m::date AS monat,
           ((m + interval '1 month')::date - m::date)       AS tage_im_monat
      FROM generate_series(DATE '2018-01-01', date_trunc('month', current_date), interval '1 month') m
), umsatz AS (
    -- Betrieb-Tage mit Umsatz, nur reife (Erstabruf ab Tag + 7, zwei Tage
    -- Luft — dieselbe Reife wie mart.betriebsbericht_luecke).
    SELECT date_trunc('month', u.geschaeftstag)::date AS monat,
           count(DISTINCT u.betrieb_key)::int          AS betriebe,
           count(*)::int                               AS betrieb_tage
      FROM core.umsatzbericht_tag u
     WHERE u.hauptsparte_key IS NULL AND u.verkaufsstelle_key IS NULL
       AND (coalesce(u.umsatz_netto, 0) <> 0 OR coalesce(u.rechnungen, 0) > 0)
       AND u.geschaeftstag <= current_date - 9
     GROUP BY 1
), abgedeckt AS (
    -- Je Bericht, Betrieb und Monat: wie viele Tage ein Abruf abdeckt (auch
    -- mit null Zeilen — ein leerer Bericht ist ein geladener Bericht) oder
    -- LINA als "keine Daten" (HTTP 500, leer) gemeldet hat.
    SELECT x.endpunkt, x.betrieb_key, x.monat,
           least(sum(x.tage), max(x.tage_im_monat))::int AS tage,
           bool_or(x.leer)                                AS leer
      FROM (
        SELECT a.endpunkt, a.betrieb_key, m.monat, m.tage_im_monat, false AS leer,
               (least(a.zeitraum_bis, (m.monat + interval '1 month')::date - 1)
                - greatest(a.zeitraum_von, m.monat) + 1)  AS tage
          FROM core.betriebsbericht_abruf a
          JOIN monate m ON m.monat BETWEEN date_trunc('month', a.zeitraum_von)::date
                                       AND date_trunc('month', a.zeitraum_bis)::date
        UNION ALL
        SELECT w.endpunkt, b.betrieb_key, m.monat, m.tage_im_monat, true,
               (least(w.zeitraum_bis, (m.monat + interval '1 month')::date - 1)
                - greatest(w.zeitraum_von, m.monat) + 1)
          FROM sync.warteschlange w
          JOIN core.betrieb b ON b.enc_id = w.betrieb_enc_id
          JOIN monate m ON m.monat BETWEEN date_trunc('month', w.zeitraum_von)::date
                                       AND date_trunc('month', w.zeitraum_bis)::date
         WHERE w.endpunkt LIKE 'getReport:%' AND w.ergebnis = 'keine_daten'
      ) x
     GROUP BY 1, 2, 3
), je_monat AS (
    SELECT d.endpunkt, d.monat,
           count(DISTINCT d.betrieb_key) FILTER (WHERE NOT d.leer)::int AS betriebe_geladen,
           count(DISTINCT d.betrieb_key) FILTER (WHERE d.leer)::int     AS betriebe_leer,
           sum(d.tage)::int                                             AS betrieb_tage_abgedeckt
      FROM abgedeckt d
     GROUP BY 1, 2
)
SELECT r.endpunkt,
       split_part(r.endpunkt, ':', 2)::int                 AS bericht,
       r.bezeichnung,
       r.fensterklasse,
       m.monat,
       coalesce(u.betriebe, 0)                             AS betriebe_mit_umsatz,
       coalesce(j.betriebe_geladen, 0)                     AS betriebe_geladen,
       coalesce(j.betriebe_leer, 0)                        AS betriebe_leer,
       coalesce(u.betrieb_tage, 0)                         AS betrieb_tage_mit_umsatz,
       coalesce(j.betrieb_tage_abgedeckt, 0)               AS betrieb_tage_abgedeckt,
       CASE
         WHEN coalesce(u.betriebe, 0) = 0 AND coalesce(j.betriebe_geladen, 0) = 0 THEN 'kein Umsatz'
         WHEN coalesce(j.betriebe_geladen, 0) + coalesce(j.betriebe_leer, 0) = 0  THEN 'nicht geladen'
         WHEN r.fensterklasse IN ('T', 'W')
              AND coalesce(j.betrieb_tage_abgedeckt, 0) >= coalesce(u.betrieb_tage, 0) THEN 'vollstaendig'
         WHEN coalesce(r.fensterklasse, 'M') IN ('M', 'M-Tag')
              AND coalesce(j.betriebe_geladen, 0) + coalesce(j.betriebe_leer, 0)
                  >= coalesce(u.betriebe, 0) THEN 'vollstaendig'
         ELSE 'teilweise'
       END                                                 AS zustand,
       s.sichten
  FROM berichte r
  CROSS JOIN monate m
  LEFT JOIN umsatz u   ON u.monat = m.monat
  LEFT JOIN je_monat j ON j.endpunkt = r.endpunkt AND j.monat = m.monat
  LEFT JOIN sichten s  ON s.endpunkt = r.endpunkt
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS betriebsbericht_ladestand_basis_uq
    ON mart.betriebsbericht_ladestand_basis (endpunkt, monat);

REFRESH MATERIALIZED VIEW mart.betriebsbericht_ladestand_basis;

COMMENT ON MATERIALIZED VIEW mart.betriebsbericht_ladestand_basis IS
'Koernung: Betriebsbericht × Monat — die materialisierte Fassung von
mart.betriebsbericht_ladestand_monat. Reife und Zustand gelten zum Zeitpunkt des Refresh (Phase B
und nach Phase C, src/sync/betriebsbericht_sichten.ts). Gelesen wird die Sicht gleichen Namens
ohne _basis.';

CREATE OR REPLACE VIEW mart.betriebsbericht_ladestand_monat AS
SELECT * FROM mart.betriebsbericht_ladestand_basis;

COMMENT ON VIEW mart.betriebsbericht_ladestand_monat IS
'Koernung: Betriebsbericht × Monat seit Januar 2018 (materialisiert in
mart.betriebsbericht_ladestand_basis, Stand des letzten Laufs). Wie viel von einem Monat ist fuer diesen
Bericht geladen — gemessen an den Betrieben bzw. Betrieb-Tagen mit Umsatz (Umsatzbericht, nur
reife Tage: aelter als 9 Tage). Tagesberichte (T, W) zaehlen Betrieb-Tage, Monatsberichte (M,
M-Tag) Betriebe. Ein Abruf mit null Zeilen zaehlt als geladen, ebenso ein Posten, fuer den LINA
"keine Daten" gemeldet hat (betriebe_leer).

zustand: vollstaendig | teilweise | nicht geladen | kein Umsatz. "nicht geladen" ist der Fall,
um den es geht: eine Auswertung ueber diesen Monat liefert dann KEINE Zeile, und das heisst
nicht null. sichten nennt die mart-Sichten, die aus dem Bericht lesen.';


CREATE OR REPLACE VIEW mart.betriebsbericht_ladestand AS
WITH m AS (
    SELECT l.*,
           -- der juengste Monat, dessen Tage schon reif sein koennen
           (l.monat <= date_trunc('month', current_date - 9)::date) AS reif
      FROM mart.betriebsbericht_ladestand_monat l
), s AS (
    SELECT m.endpunkt, m.bericht, m.bezeichnung, m.fensterklasse, m.sichten,
           min(m.monat) FILTER (WHERE m.betriebe_geladen > 0)                    AS erster_monat,
           max(m.monat) FILTER (WHERE m.betriebe_geladen > 0)                    AS letzter_monat,
           max(m.monat) FILTER (WHERE m.reif AND m.zustand IN ('teilweise', 'nicht geladen')) AS letzte_luecke,
           max(m.monat) FILTER (WHERE m.reif AND m.zustand = 'vollstaendig')     AS letzter_vollstaendig,
           count(*) FILTER (WHERE m.reif AND m.zustand = 'vollstaendig')::int    AS monate_vollstaendig,
           count(*) FILTER (WHERE m.reif AND m.zustand = 'teilweise')::int       AS monate_teilweise,
           count(*) FILTER (WHERE m.reif AND m.zustand = 'nicht geladen')::int   AS monate_nicht_geladen,
           max(m.monat) FILTER (WHERE m.reif)                                    AS reif_bis
      FROM m
     GROUP BY m.endpunkt, m.bericht, m.bezeichnung, m.fensterklasse, m.sichten
)
SELECT s.endpunkt, s.bericht, s.bezeichnung, s.fensterklasse,
       s.erster_monat, s.letzter_monat,
       CASE WHEN s.letzter_vollstaendig IS NULL THEN NULL
            WHEN s.letzte_luecke IS NULL THEN
                 (SELECT min(x.monat) FROM mart.betriebsbericht_ladestand_monat x
                   WHERE x.endpunkt = s.endpunkt AND x.zustand = 'vollstaendig')
            WHEN s.letzte_luecke < s.letzter_vollstaendig THEN (s.letzte_luecke + interval '1 month')::date
       END                                                 AS vollstaendig_ab,
       s.letzter_vollstaendig                              AS vollstaendig_bis,
       s.monate_vollstaendig, s.monate_teilweise, s.monate_nicht_geladen,
       CASE
         WHEN s.erster_monat IS NULL THEN
           format('Bericht %s%s ist fuer keinen Monat geladen. Eine Auswertung daraus liefert keine '
                  'Zeilen — das ist KEINE Null.', s.bericht, coalesce(' (' || regexp_replace(s.bezeichnung, '^Betriebsbericht \d+:\s*', '') || ')', ''))
         ELSE
           format('Bericht %s%s: geladen %s bis %s%s; %s reife Monate mit Umsatz nicht geladen, %s nur '
                  'teilweise. Ein Monat ohne Zeilen ist dort KEINE Null, sondern nicht geladen '
                  '(mart.betriebsbericht_ladestand_monat).',
                  s.bericht, coalesce(' (' || regexp_replace(s.bezeichnung, '^Betriebsbericht \d+:\s*', '') || ')', ''),
                  to_char(s.erster_monat, 'MM/YYYY'), to_char(s.letzter_monat, 'MM/YYYY'),
                  CASE WHEN s.letzter_vollstaendig IS NOT NULL
                       THEN format(', vollstaendig bis %s', to_char(s.letzter_vollstaendig, 'MM/YYYY'))
                       ELSE ', kein Monat vollstaendig' END,
                  s.monate_nicht_geladen, s.monate_teilweise)
       END                                                 AS aussage,
       s.sichten
  FROM s;

COMMENT ON VIEW mart.betriebsbericht_ladestand IS
'Koernung: ein Betriebsbericht. Fuer welchen Zeitraum er geladen ist: erster und letzter
geladener Monat, vollstaendig_ab/-bis (die juengste lueckenlose Strecke reifer Monate), wie
viele reife Monate mit Umsatz fehlen, und die Aussage als Satz. Der MCP-Server haengt aussage an
jede Antwort, die eine der sichten liest — damit eine Auswertung ueber 2019 "fuer 2019 nicht
geladen" sagt statt 0 (harte Regel 10). Der Backfill laeuft rueckwaerts: waehrend er laeuft,
steht hier eine wachsende Strecke, und davor "nicht geladen".';


-- ---------------------------------------------------------------------
-- 11b. Die beiden Materialisierungen in mart.materialisierung_stand
--
-- Angehaengt, nicht abgeschrieben: die Sicht wurde zuletzt von 0116 neu
-- gefasst (Frische gegen das Ende des Tagesgeschaefts), und eine Abschrift
-- hier wuerde deren Stand einfrieren. Findet sich die Verankerung nicht,
-- bricht die Migration ab — eine Materialisierung ohne Eintrag waere genau
-- die elfte Sicht, die 0091 sichtbar machen sollte.
-- ---------------------------------------------------------------------
DO $aussen$
DECLARE
    v_def  text;
    v_neu  text;
BEGIN
    SELECT pg_get_viewdef('mart.materialisierung_stand'::regclass, true) INTO v_def;
    IF v_def LIKE '%finanzweg_monat_basis%' THEN RETURN; END IF;
    -- Verankert am Eintrag des Wetters, ueber einen regulaeren Ausdruck: wie
    -- pg_get_viewdef Leerzeichen und Umbrueche setzt, ist keine Zusage.
    v_neu := regexp_replace(v_def,
        '(''src/wetter/nachlauf\.ts''::text\s*\))',
        '\1, (''mart.finanzweg_monat_basis''::text, ''betriebsbericht_sichten_refresh''::text, '
        '''src/sync/betriebsbericht_sichten.ts''::text), (''mart.betriebsbericht_ladestand_basis''::text, '
        '''betriebsbericht_sichten_refresh''::text, ''src/sync/betriebsbericht_sichten.ts''::text)');
    IF v_neu = v_def THEN
        RAISE EXCEPTION '0117: Verankerung in mart.materialisierung_stand nicht gefunden — die Sicht '
                        'wurde umgebaut. Die beiden Basen von Hand eintragen.';
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW mart.materialisierung_stand AS ' || v_neu;
END $aussen$;


-- ---------------------------------------------------------------------
-- 12. Katalog: Koernung, Thema, Summierbarkeit, Kennzahlregeln
-- ---------------------------------------------------------------------

SELECT mcp.achsen_ableiten();

UPDATE mcp.sicht s SET koernung = v.koernung, thema = v.thema, summen_erlaubt = v.summen
  FROM (VALUES
    ('mart.finanzweg',                         'ein Finanzweg (LINA-Nummer) — Stamm aus 88/97', 'kasse', false),
    ('mart.artikel_nachlass_tag',              'Betrieb × Abrufzeitraum (ein Tag) × Finanzweg × Artikel — Nachlassmenge aus dem Rabattbericht 92', 'aktion', true),
    ('mart.artikel_nachlass_monat',            'Betrieb × Monat × Finanzweg × Artikel — die Gluecksrad-Tabelle (92)', 'aktion', true),
    ('mart.finanzweg_tag',                     'Betrieb × Tag × Finanzweg — je Tag EINE Quelle (97, sonst 88)', 'kasse', true),
    ('mart.finanzweg_monat',                   'Betrieb × Monat × Finanzweg — je Tag eine Quelle', 'kasse', true),
    ('mart.nachlass_monat',                    'Betrieb × Monat × Finanzgruppe × Aktion × Prozentsatz — vollstaendiger Nachlass (88/97)', 'aktion', true),
    ('mart.zahlart_monat',                     'Betrieb × Monat × Zahlart (88/97)', 'kasse', true),
    ('mart.bon_tag',                           'Betrieb × Tag — Bonkennzahlen aus dem Rechnungsausgangsbuch (96)', 'kasse', true),
    ('mart.bon_zahlart_tag',                   'Betrieb × Tag × Zahlart — Rechnungen mit dieser Zahlart (96); ueber Zahlarten NICHT summierbar', 'kasse', false),
    ('mart.debitor_monat',                     'Betrieb × Monat × Debitor (96)', 'kasse', true),
    ('mart.tagesabschluss_tag',                'Betrieb × Tag × Hauptsparte × Steuersatz — Z-Bon (97)', 'kasse', true),
    ('mart.monatsaufstellung_tag',             'Betrieb × Tag — Monatsaufstellung (90) und Verkaufszahlen (108)', 'kasse', true),
    ('mart.storno_artikel_monat',              'Betrieb × Monat × Artikel × Stornotyp × Stornogrund (39)', 'kasse', true),
    ('mart.storno_grund_monat',                'Betrieb × Monat × Stornotyp × Stornogrund mit Stornoquote (39)', 'kasse', true),
    ('mart.kellner_monat',                     'Betrieb × Monat × Kellnernummer (60, 57) — Summe ueber Kellner ist NICHT der Betriebsumsatz', 'kasse', false),
    ('mart.betriebsstelle_monat',              'Betrieb × Monat × Betriebsstelle (68)', 'kasse', true),
    ('mart.betriebsstelle_hauptsparte_monat',  'Betrieb × Monat × Betriebsstelle × Hauptsparte (69)', 'kasse', true),
    ('mart.verkaufsstelle_monat',              'Betrieb × Monat × Verkaufsstelle (112)', 'kasse', true),
    ('mart.verkaufsstelle_hauptsparte_monat',  'Betrieb × Monat × Verkaufsstelle × Hauptsparte (71)', 'kasse', true),
    ('mart.zeitzone_hauptsparte_monat',        'Betrieb × Monat × Hauptsparte × Zeitzone (76), ohne Kopfzeilen', 'kasse', true),
    ('mart.zeitzone_feinsparte_monat',         'Betrieb × Monat × Feinsparte × Zeitzone (75), ohne Kopfzeilen', 'kasse', true),
    ('mart.unbar_zahlung_monat',               'Betrieb × Monat × Betriebsstelle × Zahlart — unbare Zahlungen (99)', 'kasse', true),
    ('mart.kellner_umsatz_tag',                'Betrieb × Tag × Kellnerblock (61) — Kellnernummer nur bei eindeutiger Monatssumme', 'kasse', false),
    ('mart.kellner_artikel_monat',             'Betrieb × Monat × Kellnerblock × Artikel (53) — immer mit monat filtern', 'kasse', false),
    ('mart.gutschrift',                        'eine Gutschrift (57)', 'kasse', true),
    ('mart.tisch_tag',                         'Betrieb × Tag × Tisch (113)', 'kasse', true),
    ('mart.debitorenauswertung_tag',           'Betrieb × Tag × Debitor (86) — Gegenprobe zu mart.debitor_monat', 'kasse', true),
    ('mart.finanzweg_namen',                   'Finanzweg × Monat × Name — Namenshistorie', 'kasse', false),
    ('mart.verkaufsstelle_tag',                'Betrieb × Tag × Verkaufsstelle aus dem Konzern-Umsatzbericht (0112)', 'kasse', true),
    ('mart.betriebsbericht_ladestand_monat',   'Betriebsbericht × Monat — wie viel geladen ist', 'import', false),
    ('mart.betriebsbericht_ladestand_basis',   'Betriebsbericht × Monat — materialisierte Fassung von mart.betriebsbericht_ladestand_monat', 'import', false),
    ('mart.finanzweg_monat_basis',             'Betrieb × Monat × Finanzweg — materialisierte Fassung von mart.finanzweg_monat (ohne Namen)', 'kasse', true),
    ('mart.betriebsbericht_ladestand',         'ein Betriebsbericht — geladener Zeitraum als Satz', 'import', false)
  ) AS v(sicht, koernung, thema, summen)
 WHERE s.sicht = v.sicht;

-- Wie eine Spalte aggregiert werden darf. Die Regel gilt im Pruefer fuer den
-- SPALTENNAMEN ueber alle Sichten (die strengste gewinnt) — deshalb tragen
-- die Quotienten hier eigene Namen, die sonst nirgends vorkommen.
INSERT INTO mcp.kennzahl (sicht, spalte, regel, einheit, hinweis) VALUES
  ('mart.artikel_nachlass_monat', 'menge', 'summe', 'anzahl',
   'Artikel auf Bons mit diesem Nachlass — nicht Verkaufsmenge, nicht Vorgaenge.'),
  ('mart.artikel_nachlass_monat', 'nachlass_brutto', 'summe', 'euro', 'Gewaehrter Nachlass, positiv.'),
  ('mart.artikel_nachlass_monat', 'prozentsatz', 'nicht_aggregieren', 'prozentzahl',
   'Der Satz des Finanzwegs, eine Eigenschaft — gruppieren, nicht rechnen.'),
  ('mart.finanzweg_monat', 'betrag', 'summe', 'euro',
   'Zahlungen und Nachlaesse positiv; Summe der Zahlarten = Bruttoumsatz.'),
  ('mart.finanzweg_monat', 'anzahl_vorgaenge', 'summe', 'anzahl', 'Vorgaenge, keine Artikel.'),
  ('mart.nachlass_monat', 'nachlass_anteil_pct', 'nicht_aggregieren', 'prozentzahl',
   'Anteil am Bruttoumsatz des Betriebs. Ueber Betriebe oder Monate aus den Summen neu rechnen.'),
  ('mart.zahlart_monat', 'zahlbetrag', 'summe', 'euro', NULL),
  ('mart.zahlart_monat', 'zahlart_anteil_pct', 'nicht_aggregieren', 'prozentzahl',
   'Anteil an allem, was Gaeste bezahlt haben. Aus den Summen neu rechnen.'),
  ('mart.bon_tag', 'bons', 'summe', 'anzahl', NULL),
  ('mart.bon_tag', 'bons_brutto', 'summe', 'euro', NULL),
  ('mart.bon_tag', 'bon_durchschnitt', 'nicht_aggregieren', 'euro',
   'Ein Quotient. Ueber Tage: sum(bons_brutto) / sum(bons).'),
  ('mart.bon_tag', 'bon_median', 'nicht_aggregieren', 'euro',
   'Ein Median je Tag. Ueber Tage nicht mitteln und nicht summieren.'),
  ('mart.bon_tag', 'gutschriftenquote_pct', 'nicht_aggregieren', 'prozentzahl',
   'Ueber Tage: 100 * sum(gutschriften) / (sum(bons) + sum(stornierte_bons)).'),
  ('mart.bon_zahlart_tag', 'bons_anteil_pct', 'nicht_aggregieren', 'prozentzahl',
   'Ein Bon traegt mehrere Zahlarten — die Anteile summieren sich nicht zu 100.'),
  ('mart.monatsaufstellung_tag', 'zahlungen_je_rechnung', 'nicht_aggregieren', NULL,
   'Ueber Tage: sum(zahlungen) / sum(rechnungen).'),
  ('mart.storno_grund_monat', 'stornoquote_pct', 'nicht_aggregieren', 'prozentzahl',
   'Ueber Betriebe oder Monate aus den Summen neu rechnen.'),
  ('mart.storno_artikel_monat', 'storno_brutto', 'summe', 'euro', 'Storniert, positiv.'),
  ('mart.kellner_monat', 'kellner_anteil_pct', 'nicht_aggregieren', 'prozentzahl', NULL),
  ('mart.betriebsstelle_monat', 'netto_je_gast', 'nicht_aggregieren', 'euro',
   'Ueber Stellen oder Monate: sum(umsatz_netto) / sum(gaeste).'),
  ('mart.betriebsstelle_monat', 'stelle_anteil_pct', 'nicht_aggregieren', 'prozentzahl', NULL),
  ('mart.unbar_zahlung_monat', 'zahlung_durchschnitt', 'nicht_aggregieren', 'euro',
   'Ueber Zeilen: sum(zahlbetrag) / sum(zahlungen).'),
  -- Die Pruefsicht aus 0114 fuehrt dieselbe Zahl aus zwei Berichten
  -- nebeneinander. Eine Summe ueber beide Spalten ist die Doppelzaehlung, die
  -- mart.finanzweg_tag ausraeumt.
  ('mart.finanzweg_88_97_abgleich', 'umsatz_88', 'nicht_aggregieren', 'euro',
   'Pruefsicht: dieselbe Zahl wie umsatz_97 aus einem zweiten Bericht. Summen stehen in mart.finanzweg_tag/_monat (je Tag eine Quelle).'),
  ('mart.finanzweg_88_97_abgleich', 'umsatz_97', 'nicht_aggregieren', 'euro',
   'Pruefsicht: dieselbe Zahl wie umsatz_88 aus einem zweiten Bericht. Summen stehen in mart.finanzweg_tag/_monat (je Tag eine Quelle).'),
  ('mart.finanzweg_88_97_abgleich', 'anzahl_88', 'nicht_aggregieren', 'anzahl',
   'Pruefsicht: dieselbe Zahl wie anzahl_97. Summen stehen in mart.finanzweg_tag/_monat.'),
  ('mart.finanzweg_88_97_abgleich', 'anzahl_97', 'nicht_aggregieren', 'anzahl',
   'Pruefsicht: dieselbe Zahl wie anzahl_88. Summen stehen in mart.finanzweg_tag/_monat.')
ON CONFLICT (sicht, spalte) DO UPDATE
   SET regel = excluded.regel, einheit = excluded.einheit, hinweis = excluded.hinweis;

SELECT count(*) FILTER (WHERE gesetzt) AS kommentare_ergaenzt
  FROM mcp.koernung_in_kommentare();


-- ---------------------------------------------------------------------
-- 13. Rechte und die Gegenprobe als Leserolle (Pflicht seit 0110)
--
-- Metabase liest als Eigentuemer der Schemata und braucht nichts; die
-- Leserolle bekommt ihr SELECT ueber rechte_auffrischen(). Danach JEDE neue
-- Sicht einmal als mcp_leser mit SELECT * … LIMIT 1 — nicht count(*), der
-- wertet die Spaltenausdruecke nicht aus (0109), und die beiden Funktionen
-- oben stehen genau in den Spaltenausdruecken.
-- ---------------------------------------------------------------------

SELECT mcp.rechte_auffrischen();

DO $probe$
DECLARE
    v_sicht  text;
    v_liegen text[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_leser') THEN
        RAISE WARNING 'Rolle mcp_leser fehlt — die Gegenprobe zu 0117 ist uebersprungen';
        RETURN;
    END IF;
    IF NOT pg_has_role(current_user, 'mcp_leser', 'MEMBER') THEN
        RAISE WARNING '% ist kein Mitglied von mcp_leser — die Gegenprobe zu 0117 ist '
                      'uebersprungen. Nachtraeglich pruefen: SELECT * FROM mart.sicht_defekt;',
                      current_user;
        RETURN;
    END IF;

    SET LOCAL ROLE mcp_leser;
    FOREACH v_sicht IN ARRAY ARRAY[
        'mart.finanzweg', 'mart.artikel_nachlass_tag', 'mart.artikel_nachlass_monat',
        'mart.finanzweg_tag', 'mart.finanzweg_monat', 'mart.nachlass_monat', 'mart.zahlart_monat',
        'mart.bon_tag', 'mart.bon_zahlart_tag', 'mart.debitor_monat', 'mart.tagesabschluss_tag',
        'mart.monatsaufstellung_tag', 'mart.storno_artikel_monat', 'mart.storno_grund_monat',
        'mart.kellner_monat', 'mart.betriebsstelle_monat', 'mart.betriebsstelle_hauptsparte_monat',
        'mart.verkaufsstelle_monat', 'mart.verkaufsstelle_hauptsparte_monat',
        'mart.zeitzone_hauptsparte_monat', 'mart.zeitzone_feinsparte_monat',
        'mart.unbar_zahlung_monat', 'mart.kellner_umsatz_tag', 'mart.kellner_artikel_monat',
        'mart.gutschrift', 'mart.tisch_tag', 'mart.debitorenauswertung_tag', 'mart.finanzweg_namen',
        'mart.verkaufsstelle_tag', 'mart.betriebsbericht_ladestand_monat',
        'mart.betriebsbericht_ladestand_basis', 'mart.finanzweg_monat_basis',
        'mart.betriebsbericht_ladestand']
    LOOP
        BEGIN
            EXECUTE format('SELECT * FROM %s LIMIT 1', v_sicht);
        EXCEPTION WHEN OTHERS THEN
            v_liegen := v_liegen || format('%s (%s: %s)', v_sicht, SQLSTATE, SQLERRM);
        END;
    END LOOP;
    RESET ROLE;

    IF array_length(v_liegen, 1) > 0 THEN
        RAISE EXCEPTION '0117 hat sein Ziel nicht erreicht — unlesbar fuer mcp_leser: %',
            array_to_string(v_liegen, ' | ');
    END IF;
END $probe$;
