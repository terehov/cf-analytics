-- =====================================================================
-- 0049 Vergleichsgruppen — der Betrieb gegen seine Marke, der Betrieb
--      gegen seine Stadt
--
-- ANLASS (gefragt am 10.08.2026): "Angenommen, wir moechten Enchilada
-- Karlsruhe gegen Aposto und Wilma Wunder vergleichen, um festzustellen,
-- ob bei allen der Umsatz eingebrochen ist oder nur bei einem." Das ist
-- die Frage nach dem MASSSTAB. Ein Umsatzrueckgang von 12 Prozent heisst
-- etwas voellig anderes, je nachdem ob die Nachbarhaeuser dasselbe zeigen
-- (Wetter, Baustelle, Feiertagslage, Kaufkraft) oder ob das Haus allein
-- dasteht (dann liegt es am Haus).
--
-- ZWEI GRUPPEN, ZWEI VERSCHIEDENE FRAGEN:
--
--   * MARKE  — gleiches Konzept, gleiche Karte, gleiche Preise, verteilt
--     ueber ganz Deutschland. Faengt ab, was am KONZEPT liegt.
--   * STADT  — gleiches Einzugsgebiet, gleiches Wetter, gleiche
--     Feiertage, verschiedene Konzepte. Faengt ab, was am STANDORT liegt.
--
-- Genau deshalb sind es zwei Auswertungen und nicht eine mit Umschalter:
-- wer beide nebeneinander liest, kann die dritte Aussage treffen — der
-- Betrieb faellt gegenueber seiner Marke ab UND gegenueber seiner Stadt,
-- also liegt es am Haus.
--
-- ---------------------------------------------------------------------
-- WOHER DIE STADT KOMMT — und woher NICHT
--
-- NICHT aus core.betrieb.stadt. Diese Spalte ist bei ALLEN 141 Betrieben
-- NULL und war es immer (nachgemessen am 26.07.2026 ueber alle 489
-- archivierten API-Antworten, erneut am 10.08.2026: 0 von 141 gefuellt).
-- LINA liefert fuer Betriebe keine Adresse. Die Spalte wird trotzdem
-- durch ein Dutzend mart-Sichten durchgereicht — mart.umsatz_ytd.stadt,
-- mart.round_table_monat.stadt, mart.ampel_bereich.stadt. Wer eine
-- Stadtauswertung darauf baut, bekommt kein leeres Ergebnis mit
-- Fehlermeldung, sondern EINE Gruppe namens NULL, in der alle 141
-- Betriebe liegen. Deshalb stehen unten Spaltenkommentare an genau diesen
-- drei Stellen.
--
-- SONDERN aus manual.betrieb_standort.ort — der von Hand gepflegten
-- Standortliste aus Migration 0008. Am 10.08.2026 stehen dort 60 der 141
-- Betriebe, darunter 49 der 56 im letzten bewerteten Monat operativen.
-- Sieben operative Haeuser fehlen also, und ihre Nachbarn wissen nichts
-- davon. Deshalb gibt es mart.nachbarschaft_fehlend: eine unvollstaendige
-- Vergleichsgruppe, die sich als vollstaendig ausgibt, ist schlimmer als
-- gar keine.
--
-- WARUM NICHT AUS DEM BETRIEBSNAMEN: steht in 0008 und gilt unveraendert.
-- "Aposto Aalen GmbH" traegt die Stadt, "Alter Kranen GmbH" nicht, und
-- fuenf Betriebe heissen nach derselben Stadt, ohne dieselbe zu sein.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Die tote Spalte kennzeichnen, bevor jemand darauf baut
--
-- Ein Kommentar an der Sicht haette niemand gelesen, der auf die SPALTE
-- klickt. Metabase zeigt Spaltenkommentare im Datenmodell an.
-- ---------------------------------------------------------------------
COMMENT ON COLUMN mart.umsatz_ytd.stadt IS
'IMMER NULL. LINA liefert fuer Betriebe keine Adresse (nachgemessen 26.07.2026 und
10.08.2026: 0 von 141 gefuellt). Die gepflegte Stadt steht in mart.nachbarschaft.ort.
Wer nach dieser Spalte gruppiert, bekommt EINE Gruppe mit allen Betrieben darin -- ohne
Fehlermeldung.';

COMMENT ON COLUMN mart.ampel_bereich.stadt IS
'IMMER NULL -- siehe mart.umsatz_ytd.stadt. Die gepflegte Stadt steht in
mart.nachbarschaft.ort, der Stadtvergleich in mart.stadt_vergleich.';


-- ---------------------------------------------------------------------
-- Wer steht mit wem in einer Stadt
--
-- Eine Zeile je Betrieb MIT Ortsangabe. Kein Monatsbezug: eine Adresse
-- ist ein Zustand, kein Monatswert.
--
-- haeuser_am_ort zaehlt die GEFUEHRTEN Haeuser am Ort, nicht die in einem
-- bestimmten Monat operativen -- das kann diese Sicht nicht wissen. In
-- Karlsruhe sind das fuenf, von denen eines (Wirtshaus Im Jagdgrund)
-- seit Monaten keinen Umsatz mehr macht. Die monatsbezogene Zahl steht in
-- mart.stadt_schnitt_monat.haeuser.
-- ---------------------------------------------------------------------
CREATE VIEW mart.nachbarschaft AS
SELECT s.betrieb_key,
       b.name                                          AS betrieb,
       kz.hauptkonzept                                 AS konzept,
       s.ort,
       s.plz,
       count(*) OVER (PARTITION BY s.ort)::integer     AS haeuser_am_ort,
       (count(*) OVER (PARTITION BY s.ort) > 1)        AS hat_nachbarn
  FROM manual.betrieb_standort s
  JOIN core.betrieb b                 ON b.betrieb_key  = s.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = s.betrieb_key
 WHERE s.ort IS NOT NULL;

COMMENT ON VIEW mart.nachbarschaft IS
'Welcher Betrieb steht in welcher Stadt, und wie viele Haeuser der Gruppe stehen dort
sonst noch. Die Quelle der Stadt ist manual.betrieb_standort -- von Hand gepflegt, weil
LINA fuer Betriebe keine Adresse liefert.

UNVOLLSTAENDIG, SOLANGE manual.betrieb_standort unvollstaendig ist. Wer fehlt, sagt
mart.nachbarschaft_fehlend. Ein fehlender Betrieb faellt hier nicht auf: seine Stadt
sieht dann einfach so aus, als stuende er nicht dort.

haeuser_am_ort zaehlt gefuehrte Haeuser, nicht in einem Monat operative -- diese Sicht
kennt keinen Monat. Fuer die monatsbezogene Zahl: mart.stadt_schnitt_monat.haeuser.';

COMMENT ON COLUMN mart.nachbarschaft.hat_nachbarn IS
'false = allein am Ort. Fuer diese Betriebe gibt es keinen Stadtvergleich, und das ist
kein Datenfehler, sondern die Lage.';


-- ---------------------------------------------------------------------
-- Wem die Ortsangabe fehlt — die Arbeitsliste
--
-- Bewusst nicht auf mart.standort_fehlend abgebildet: die fragt nach der
-- KOORDINATE (fuer die Karte), diese nach dem ORT (fuer die Gruppe). Heute
-- faellt beides zusammen, weil jeder gepflegte Standort beides hat; es
-- muss aber nicht so bleiben, und ein Ort ohne Koordinate reicht fuer den
-- Vergleich vollkommen.
-- ---------------------------------------------------------------------
CREATE VIEW mart.nachbarschaft_fehlend AS
SELECT b.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       bs.status,
       u.letzter_monat,
       u.umsatz_letzter_monat
  FROM core.betrieb b
  LEFT JOIN mart.nachbarschaft n        ON n.betrieb_key  = b.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz   ON kz.betrieb_key = b.betrieb_key
  LEFT JOIN mart.betrieb_status bs      ON bs.betrieb_key = b.betrieb_key
  LEFT JOIN LATERAL (
        SELECT y.monat AS letzter_monat, y.umsatz_monat AS umsatz_letzter_monat
          FROM mart.umsatz_ytd y
         WHERE y.betrieb_key = b.betrieb_key AND y.umsatz_monat > 0
         ORDER BY y.monat DESC
         LIMIT 1
  ) u ON true
 WHERE n.betrieb_key IS NULL;

COMMENT ON VIEW mart.nachbarschaft_fehlend IS
'Betriebe ohne Ortsangabe -- die Luecke im Stadtvergleich, nach zuletzt gemachtem Umsatz
lesbar. Jede Zeile hier ist ein Haus, das in seiner Stadt nicht mitverglichen wird, ohne
dass es dort auffiele.

ERWARTUNG: fuer alle Betriebe mit laufendem Umsatz leer. Gefuellt wird
manual.betrieb_standort von Hand oder aus einer Liste von Concept Family.';


-- ---------------------------------------------------------------------
-- Der Betrieb gegen den Schnitt seiner MARKE
--
-- Lange Form: eine Zeile je Monat, Betrieb und Bereich. Dieselbe Koernung
-- wie mart.ampel_bereich, damit sich beide ohne Umformung nebeneinander
-- lesen lassen.
--
-- DREI ENTSCHEIDUNGEN, DIE HIER FALLEN UND NICHT IN DER KARTE:
--
-- 1. MEDIAN, NICHT MITTELWERT. Dieselbe Begruendung wie in 0013: die
--    Personalquote hat den Umsatz im Nenner und erreicht gemessen bis
--    316.576 Prozent. Ein einziger solcher Betrieb verschoebe den
--    Vergleichsmassstab einer ganzen Marke um Groessenordnungen.
--
-- 2. DER MASSSTAB ZAEHLT NUR OPERATIVE HAEUSER. Ein stillgelegtes Haus
--    steht mit -100 Prozent Umsatz in den Daten. Zwei davon in einer
--    kleinen Marke, und jeder laufende Betrieb sieht ueberdurchschnittlich
--    aus. Der BETRACHTETE Betrieb darf trotzdem still sein -- sonst
--    oeffnet sich die Seite fuer ihn leer, und leer liest sich als "keine
--    Daten" statt als "stillgelegt". Er steht dann mit operativ = false
--    da und zaehlt im Median nicht mit.
--
-- 3. DIE RICHTUNG STEHT IN DEN DATEN, NICHT IM KOPF DES LESERS. Bei
--    Umsatz und Bewertung ist mehr besser, bei Personal und Wareneinsatz
--    weniger. Eine Spalte "Abweichung: +3,2" ist ohne diese Angabe
--    zweideutig -- und zwar auf die gefaehrliche Art, weil sie
--    entschieden aussieht. Deshalb traegt jede Zeile richtung und
--    vergleich ("besser" / "schlechter" / "gleich"), aus ampel.regel des
--    Standardregelwerks abgeleitet.
-- ---------------------------------------------------------------------
CREATE VIEW mart.marke_vergleich AS
WITH regel AS (
    SELECT r.bereich, r.richtung
      FROM ampel.regel r
      JOIN ampel.regelwerk w ON w.regelwerk_key = r.regelwerk_key AND w.ist_standard
), basis AS (
    SELECT a.monat, a.betrieb_key, a.betrieb, a.konzept,
           a.bereich, a.bereich_name, a.reihenfolge,
           a.wert, a.ampel, a.emoji, a.operativ,
           g.richtung
      FROM mart.ampel_bereich a
      LEFT JOIN regel g ON g.bereich = a.bereich
), schnitt AS (
    -- HAVING count(*) > 1: der Median aus EINEM Haus ist dieses Haus.
    -- Ohne die Zeile stuende bei einer Ein-Haus-Marke "Abweichung 0,00 --
    -- gleich -- Rang 1 von 1" da: ein Nichts, das wie ein Befund aussieht.
    -- So bleiben Median, Abweichung und Rang leer, und leer ist hier die
    -- richtige Aussage.
    SELECT monat, konzept, bereich,
           count(*)::integer AS haeuser,
           round(percentile_cont(0.5) WITHIN GROUP (
                     ORDER BY wert::double precision)::numeric, 2) AS median
      FROM basis
     WHERE operativ AND wert IS NOT NULL
     GROUP BY monat, konzept, bereich
    HAVING count(*) > 1
), rangliste AS (
    SELECT monat, konzept, bereich, betrieb_key,
           rank() OVER (PARTITION BY monat, konzept, bereich
                        ORDER BY CASE WHEN richtung = 'hoeher_ist_besser'
                                      THEN -wert ELSE wert END)::integer AS rang
      FROM basis
     WHERE operativ AND wert IS NOT NULL
)
SELECT b.monat,
       b.betrieb_key,
       b.betrieb,
       b.konzept,
       b.bereich,
       b.bereich_name,
       b.reihenfolge,
       b.wert,
       b.ampel,
       b.emoji,
       b.operativ,
       b.richtung,
       s.median                        AS marke_median,
       s.haeuser                       AS marke_haeuser,
       round(b.wert - s.median, 2)     AS abweichung,
       CASE WHEN b.wert IS NULL OR s.median IS NULL             THEN NULL
            WHEN b.wert = s.median                              THEN 'gleich'
            WHEN (b.wert > s.median) = (b.richtung = 'hoeher_ist_besser')
                                                                THEN 'besser'
            ELSE 'schlechter'
       END                             AS vergleich,
       r.rang
  FROM basis b
  LEFT JOIN schnitt s   ON s.monat = b.monat AND s.konzept = b.konzept
                       AND s.bereich = b.bereich
  LEFT JOIN rangliste r ON r.monat = b.monat AND r.konzept = b.konzept
                       AND r.bereich = b.bereich AND r.betrieb_key = b.betrieb_key;

COMMENT ON VIEW mart.marke_vergleich IS
'Der Betrieb gegen den Schnitt seiner Marke, je Monat und Bereich. Beantwortet die Frage
vor jeder Massnahme: schwaechelt dieses Haus, oder seine ganze Marke?

marke_median ist ein MEDIAN ueber die im Monat OPERATIVEN Haeuser der Marke -- ein
einzelner Ausreisser soll den Massstab nicht verziehen, und ein stillgelegtes Haus steht
mit -100 Prozent Umsatz in den Daten. Der betrachtete Betrieb selbst darf still sein
(operativ = false); er zaehlt dann im Median und im Rang nicht mit.

vergleich sagt BESSER oder SCHLECHTER, nicht hoeher oder niedriger. Bei Personal und
Wareneinsatz ist weniger besser -- ein blosses Vorzeichen an der Abweichung waere hier
zweideutig. Die Richtung kommt aus dem Standardregelwerk (ampel.regel).

rang ist der Platz innerhalb der Marke, 1 = bester. Nur operative Haeuser mit Wert
bekommen einen Rang; marke_haeuser sagt, aus wie vielen.

BEI EINER MARKE MIT NUR EINEM OPERATIVEN HAUS bleiben marke_median, abweichung, vergleich,
rang und marke_haeuser LEER. Das ist Absicht: "Abweichung 0,00 -- gleich -- Rang 1 von 1"
waere ein Nichts, das wie ein Befund aussieht.';

COMMENT ON COLUMN mart.marke_vergleich.abweichung IS
'wert minus marke_median, in der Einheit des Bereichs (Prozentpunkte, bei der Bewertung
Sterne). VORZEICHEN IST NICHT WERTUNG -- dafuer ist vergleich da.';


-- ---------------------------------------------------------------------
-- Der Betrieb gegen die anderen Haeuser seiner STADT
--
-- Gleiche Form wie marke_vergleich, damit beide Dashboards dieselben
-- Spalten lesen. Ein Unterschied ist wesentlich:
--
-- DER MEDIAN IST HIER NEBENSACHE. Eine Stadt hat zwei bis fuenf Haeuser;
-- der Median aus zweien ist ihr Mittelwert und sagt weniger als die beiden
-- Zahlen nebeneinander. Deshalb zeigen die Karten die Haeuser einzeln und
-- benutzen den Median nur als Bezugslinie. Er steht trotzdem hier, damit
-- die Spalte "Abweichung" dieselbe Bedeutung hat wie im Markenvergleich.
--
-- Und ein zweiter: DIE MARKEN SIND VERSCHIEDEN. In Karlsruhe stehen
-- Aposto, Enchilada, Lehners und Wilma Wunder nebeneinander -- vier
-- Konzepte mit verschiedenen Karten, Preisen und Personalstrukturen. Eine
-- absolute Personalquote von 45 Prozent gegen 40 Prozent ist deshalb hier
-- KEINE Aussage. Die Veraenderung gegenueber dem Vorjahr ist eine: die
-- traegt jedes Haus in seiner eigenen Einheit, und Wetter, Baustellen und
-- Feiertage treffen alle vier gleichzeitig.
-- ---------------------------------------------------------------------
CREATE VIEW mart.stadt_vergleich AS
WITH regel AS (
    SELECT r.bereich, r.richtung
      FROM ampel.regel r
      JOIN ampel.regelwerk w ON w.regelwerk_key = r.regelwerk_key AND w.ist_standard
), basis AS (
    SELECT a.monat, a.betrieb_key, a.betrieb, a.konzept, n.ort,
           n.haeuser_am_ort,
           a.bereich, a.bereich_name, a.reihenfolge,
           a.wert, a.ampel, a.emoji, a.operativ,
           g.richtung
      FROM mart.ampel_bereich a
      JOIN mart.nachbarschaft n ON n.betrieb_key = a.betrieb_key
      LEFT JOIN regel g         ON g.bereich     = a.bereich
), schnitt AS (
    -- Wie beim Markenvergleich: kein Median aus einem einzigen Haus.
    SELECT monat, ort, bereich,
           count(*)::integer AS haeuser,
           round(percentile_cont(0.5) WITHIN GROUP (
                     ORDER BY wert::double precision)::numeric, 2) AS median
      FROM basis
     WHERE operativ AND wert IS NOT NULL
     GROUP BY monat, ort, bereich
    HAVING count(*) > 1
), rangliste AS (
    SELECT monat, ort, bereich, betrieb_key,
           rank() OVER (PARTITION BY monat, ort, bereich
                        ORDER BY CASE WHEN richtung = 'hoeher_ist_besser'
                                      THEN -wert ELSE wert END)::integer AS rang
      FROM basis
     WHERE operativ AND wert IS NOT NULL
)
SELECT b.monat,
       b.betrieb_key,
       b.betrieb,
       b.konzept,
       b.ort,
       -- Die Gruppengroesse der STADT, nicht die der Kennzahl. Wer die
       -- Zeilen einer Kennzahl nach ort_haeuser filtert, verliert genau
       -- die Zeilen, bei denen der NACHBAR keinen Wert hat -- und liest
       -- das als "fuer mein Haus fehlt die Kennzahl". Fuer die Frage
       -- "gibt es hier ueberhaupt jemanden zum Vergleichen" ist diese
       -- Spalte die richtige.
       b.haeuser_am_ort,
       b.bereich,
       b.bereich_name,
       b.reihenfolge,
       b.wert,
       b.ampel,
       b.emoji,
       b.operativ,
       b.richtung,
       s.median                        AS ort_median,
       s.haeuser                       AS ort_haeuser,
       round(b.wert - s.median, 2)     AS abweichung,
       CASE WHEN b.wert IS NULL OR s.median IS NULL             THEN NULL
            WHEN b.wert = s.median                              THEN 'gleich'
            WHEN (b.wert > s.median) = (b.richtung = 'hoeher_ist_besser')
                                                                THEN 'besser'
            ELSE 'schlechter'
       END                             AS vergleich,
       r.rang
  FROM basis b
  LEFT JOIN schnitt s   ON s.monat = b.monat AND s.ort = b.ort
                       AND s.bereich = b.bereich
  LEFT JOIN rangliste r ON r.monat = b.monat AND r.ort = b.ort
                       AND r.bereich = b.bereich AND r.betrieb_key = b.betrieb_key;

COMMENT ON VIEW mart.stadt_vergleich IS
'Der Betrieb gegen die anderen Haeuser seiner Stadt, je Monat und Bereich. Beantwortet:
liegt der Rueckgang am Haus oder am Standort? Wetter, Baustellen, Feiertagslage und
Kaufkraft treffen alle Haeuser einer Stadt gleichzeitig -- eine Marke ueber ganz
Deutschland dagegen nicht.

VORSICHT BEI ABSOLUTEN QUOTEN. Die Haeuser einer Stadt gehoeren verschiedenen Marken mit
verschiedenen Karten, Preisen und Personalstrukturen; eine Personalquote von 45 gegen 40
Prozent ist zwischen Lehners und Aposto keine Aussage. Belastbar ist die VERAENDERUNG
(Bereich umsatz = Prozent gegenueber Vorjahresmonat): die traegt jedes Haus in seiner
eigenen Einheit.

Enthaelt nur Betriebe mit gepflegter Ortsangabe. Wer fehlt: mart.nachbarschaft_fehlend.
Uebrige Semantik wie mart.marke_vergleich.

ZWEI GROESSENANGABEN, DIE NICHT DASSELBE SIND: haeuser_am_ort zaehlt die gefuehrten Haeuser
der STADT (unabhaengig von Monat und Kennzahl) -- danach filtert man, wenn man wissen will,
ob es hier ueberhaupt jemanden zum Vergleichen gibt. ort_haeuser zaehlt die Haeuser, die in
DIESEM Monat fuer DIESE Kennzahl einen Wert haben, und traegt den Rang. Wer die Zeilen nach
ort_haeuser filtert, verliert genau die, bei denen der NACHBAR keinen Wert hat -- und liest
das als fehlende Kennzahl im eigenen Haus.';


-- ---------------------------------------------------------------------
-- Die Stadt als Zeile — das Gegenstueck zu mart.konzept_schnitt_monat
--
-- Damit die Median-Regel an EINER Stelle je Gruppenart steht und nicht in
-- jeder Karte nachgebaut wird. Genau diese Doppelung war der Anlass fuer
-- 0013.
--
-- Nur Staedte mit mindestens zwei im Monat operativen Haeusern: eine
-- "Vergleichsgruppe" aus einem Haus ist keine, und sie in einer Liste von
-- Vergleichsgruppen stehen zu lassen, laedt genau zu dem Fehlschluss ein,
-- den die Sicht verhindern soll.
-- ---------------------------------------------------------------------
CREATE VIEW mart.stadt_schnitt_monat AS
SELECT r.monat,
       n.ort,
       count(*)::integer                                                   AS haeuser,
       count(DISTINCT r.konzept)::integer                                  AS marken,
       string_agg(DISTINCT coalesce(r.konzept, '(ohne Marke)'), ', ')      AS marken_namen,
       round(sum(r.umsatz_ist), 2)                                         AS umsatz_ist,
       round(percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY r.umsatz_pct::double precision)::numeric, 2)     AS umsatz_pct,
       round(percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY r.personalkosten_ogf_pct::double precision)::numeric, 2)
                                                                           AS personalkosten_ogf_pct,
       round(percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY r.we_bar_pct::double precision)::numeric, 2)     AS we_bar_pct,
       round(percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY r.we_kueche_pct::double precision)::numeric, 2)  AS we_kueche_pct,
       round(avg(r.online_bewertung), 2)                                   AS online_bewertung,
       count(*) FILTER (WHERE r.gesamt = 'rot')::integer                   AS ampeln_rot,
       count(*) FILTER (WHERE r.gesamt = 'orange')::integer                AS ampeln_orange,
       count(*) FILTER (WHERE r.gesamt = 'gruen')::integer                 AS ampeln_gruen,
       count(*) FILTER (WHERE r.gesamt IS NULL)::integer                   AS ohne_urteil
  FROM mart.round_table_monat r
  JOIN mart.nachbarschaft n ON n.betrieb_key = r.betrieb_key
 WHERE r.operativ
 GROUP BY r.monat, n.ort
HAVING count(*) > 1;

COMMENT ON VIEW mart.stadt_schnitt_monat IS
'Die Stadt als eine Zeile je Monat -- das Gegenstueck zu mart.konzept_schnitt_monat, nur
nach Ort statt nach Marke gruppiert. Prozentwerte sind MEDIANE, umsatz_ist ist eine echte
Summe (Umsatz addiert sich, Quoten nicht).

Nur Staedte mit MINDESTENS ZWEI im Monat operativen Haeusern. Eine Vergleichsgruppe aus
einem Haus ist keine.

haeuser zaehlt die im Monat operativen; mart.nachbarschaft.haeuser_am_ort zaehlt die
gefuehrten. In Karlsruhe sind das fuenf gefuehrte und vier operative.

Quotenvergleiche zwischen den Haeusern einer Stadt sind mit Vorsicht zu lesen -- siehe
mart.stadt_vergleich.';
