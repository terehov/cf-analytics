-- =====================================================================
-- 0097 — Bounti: die Auswertungsschicht
--
-- Migration 0096 hat die Daten geholt und neun Sichten gebaut, die
-- BEANTWORTEN, OB DIE ANBINDUNG STIMMT: Zuordnungsluecken, Rueckstand
-- des Zuweisungsabgleichs, Gegenprobe gegen Bountis eigene Aggregation.
-- Das ist Betriebsueberwachung, keine Auswertung.
--
-- Was fehlte, war die andere Haelfte: WAS SAGEN DIE DATEN UEBER DIE
-- BETRIEBE. Diese Migration liefert genau das und nichts weiter — sie
-- legt keine Tabelle an, holt nichts nach und aendert keine bestehende
-- Sicht. Sie besteht aus acht Sichten auf dem Bestand von 0096.
--
-- ─────────────────────────────────────────────────────────────────────
-- DIE DREI ENTSCHEIDUNGEN, DIE MAN DEN SICHTEN SONST NICHT ANSIEHT
--
-- 1. STAND HEUTE, NICHT STICHMONAT.
--    Die Leitsicht mart.bounti_betrieb_stand kennt keinen Monat. Das ist
--    Absicht: "ueberfaellig" ist eine Aussage ueber HEUTE, nicht ueber
--    Juni. Wer eine ueberfaellige Schulung in den Monat ihrer Zuweisung
--    zurueckrechnet, bekommt eine Zahl, die mit jedem Tag steigt und
--    trotzdem unter einem alten Monat steht.
--    Den Verlauf gibt es daneben (mart.bounti_schulung_verlauf), und der
--    traegt ausdruecklich den Monat der ZUWEISUNG — dieselbe Festlegung
--    wie in 0096, aus demselben Grund.
--
-- 2. ALLE BETRIEBE, AUCH DIE OHNE BOUNTI.
--    mart.bounti_betrieb_stand geht von core.betrieb aus und haengt
--    Bounti links an, nicht umgekehrt. Ein Betrieb ohne Bounti-Standort
--    steht damit MIT LEEREN ZAHLEN in derselben Tabelle statt gar nicht
--    (Regel 10). Waere die Sicht andersherum gebaut, saehe eine Liste von
--    62 Betrieben aus wie der ganze Konzern — es sind aber 62 von 141.
--    Die Spalte heisst in_bounti und ist der Unterschied zwischen
--    "keine ueberfaellige Schulung" und "wir wissen es nicht".
--
-- 3. PERSONEN STEHEN MIT NAMEN DRIN, KONTAKTDATEN NICHT.
--    Dieselbe Linie wie 0096: eine ueberfaellige Pflichtschulung ohne
--    Namen ist eine Zahl, mit der niemand etwas tun kann. E-Mail und
--    Telefon stehen schon in 0096 nicht im Schema und koennen hier
--    deshalb auch nicht auftauchen.
--
-- ─────────────────────────────────────────────────────────────────────
-- WAS DIE ZAHLEN NICHT SAGEN — GEMESSEN AM 24.08.2026
--
--   * 26 der 88 Standorte haben keinen Betrieb. An ihnen haengen 598 der
--     2372 aktiven Personen, also JEDE VIERTE. Jede Betriebszahl dieser
--     Migration laesst sie aus. mart.bounti_abdeckung sagt das in Zahlen,
--     und keine Auswertung darf ohne sie gelesen werden.
--   * ALLE 133 Auditberichte haengen an drei dieser 26 Standorte
--     (Wirtshaus am Muenzplatz, Wirtshaus im Park Moenchengladbach,
--     Wuerzburger Augustiner). mart.bounti_audit_betrieb_monat ist
--     deshalb LEER, und mart.bounti_auditbericht_liste fuehrt die 133
--     bewusst MIT betrieb_key IS NULL — eine leere Auditsicht neben einer
--     unauffaelligen Pruefzeile ist der Zustand, vor dem 0092 warnt.
--   * Die Zuordnung Person → Standort ist die von HEUTE. Bounti fuehrt
--     dazu keine Historie; wer den Betrieb gewechselt hat, bringt seine
--     alten Zuweisungen mit. Bei weit zurueckliegenden Monaten ist der
--     Verlauf deshalb eine Annaeherung.
--   * Eine Person an zwei Standorten zaehlt in beiden Betrieben. Die
--     Summe ueber alle Betriebe ist deshalb groesser als die Kopfzahl des
--     Unternehmens (mart.bounti_mehrfachzuordnung).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Die Zeile je Zuweisung — die Grundlage aller anderen Sichten
--
-- Sie ist bewusst die UNTERSTE Ebene: Person, Lerneinheit, Frist,
-- Zustand. Alles darueber (Betrieb, Lerneinheit, Person) ist eine
-- Verdichtung davon, und zwar in SQL an einer Stelle statt in fuenf
-- Metabase-Karten mit je eigener Zustandslogik.
--
-- DER ZUSTAND HAT VIER WERTE UND NICHT ZWEI. "offen" und "ueberfaellig"
-- auseinanderzuhalten ist der ganze Punkt; "ohne Frist" ist der dritte
-- und der stille.
--
-- DIE REIHENFOLGE DER CASE-ZWEIGE IST EINE AUSSAGE, keine Formalie:
-- ABGESCHLOSSEN GEWINNT VOR OHNE-FRIST. Eine erledigte Zuweisung ohne
-- Frist zaehlt als erledigt und nicht als Sonderfall. Gemessen am
-- 24.08.2026: 29513 der 74683 Zuweisungen tragen ueberhaupt kein
-- Faelligkeitsdatum (39,5 %) — davon sind aber 21505 laengst
-- abgeschlossen. Uebrig bleiben 8008 offene ohne Frist, und NUR die
-- zaehlt zustand = 'ohne Frist'.
--
-- Das ist der Unterschied zwischen einer Eigenschaft der Zuweisung
-- (kein dueAt gesetzt) und einem Zustand der Arbeit (liegt offen und
-- kann nie faellig werden). Ausgewertet wird der Zustand. Wer die andere
-- Zahl braucht, zaehlt in core.bounti_zuweisung auf faellig_am IS NULL.
--
-- Wer offene Zuweisungen ohne Frist unter "offen" mitzaehlt, haelt einen
-- Betrieb fuer saeumig, der nichts versaeumt hat.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bounti_schulung_person AS
WITH rollen AS (
    SELECT mr.mitarbeiter_id,
           string_agg(ro.name, ', ' ORDER BY ro.name) AS rollen
      FROM core.bounti_mitarbeiter_rolle mr
      JOIN core.bounti_rolle ro ON ro.bounti_id = mr.rolle_id
     GROUP BY mr.mitarbeiter_id
)
SELECT sb.betrieb_key,
       sb.betrieb,
       bst.konzept,
       sb.standort,
       z.mitarbeiter_id,
       nullif(btrim(coalesce(m.vorname, '') || ' ' || coalesce(m.nachname, '')), '')
                                                     AS person,
       m.archiviert,
       r.rollen,
       z.art,
       l.name                                        AS lerneinheit,
       z.erstellt_am,
       z.faellig_am,
       z.abgeschlossen_am,
       z.ergebnis_pct,
       CASE
         WHEN z.abgeschlossen_am IS NOT NULL THEN 'abgeschlossen'
         WHEN z.faellig_am IS NULL           THEN 'ohne Frist'
         WHEN z.faellig_am < now()           THEN 'ueberfaellig'
         ELSE 'offen'
       END                                           AS zustand,
       CASE WHEN z.abgeschlossen_am IS NULL AND z.faellig_am < now()
            THEN (current_date - z.faellig_am::date)
       END                                           AS tage_ueberfaellig,
       /*
        * NICHT OPERATIVE BETRIEBE MUESSEN ERKENNBAR BLEIBEN. 13 der 62
        * zugeordneten Betriebe sind geschlossen, verwaltend oder ohne
        * Umsatz — ihre offenen Zuweisungen sind kein Rueckstand, sondern
        * Karteileichen. Dieselbe Ueberlegung wie beim Operativ-Filter des
        * Round Table (Migration 0039): eine rote Ampel eines geschlossenen
        * Betriebs ist keine Handlungsaufforderung.
        *
        * Die Spalte steht am ENDE der Liste, weil CREATE OR REPLACE VIEW
        * Spalten nur anhaengen und nicht einschieben kann.
        */
       (bst.status = 'operativ')                     AS operativ
  FROM core.bounti_zuweisung z
  JOIN core.bounti_mitarbeiter m           ON m.bounti_id = z.mitarbeiter_id
  JOIN core.bounti_lerneinheit l           ON l.bounti_id = z.lerneinheit_id
                                          AND l.art = z.art
  JOIN core.bounti_mitarbeiter_standort ms ON ms.mitarbeiter_id = z.mitarbeiter_id
  JOIN mart.bounti_standort_betrieb sb     ON sb.standort_id = ms.standort_id
  LEFT JOIN mart.betrieb_status bst        ON bst.betrieb_key = sb.betrieb_key
  LEFT JOIN rollen r                       ON r.mitarbeiter_id = z.mitarbeiter_id;

COMMENT ON VIEW mart.bounti_schulung_person IS
'Eine Zeile je Zuweisung und Standort — die unterste Ebene der
Schulungsauswertung und die Grundlage aller verdichteten Sichten daneben.

zustand hat VIER Werte: abgeschlossen, ueberfaellig, offen, ohne Frist.

ABGESCHLOSSEN GEWINNT VOR OHNE-FRIST. "ohne Frist" heisst deshalb OFFEN UND
OHNE FRIST und nicht "traegt kein Faelligkeitsdatum" — das sind zwei
verschiedene Zahlen. Am 24.08.2026: 29513 Zuweisungen ohne Faelligkeitsdatum,
davon 21505 abgeschlossen, 8008 offen. Nur die 8008 stehen hier.

Sie koennen nie ueberfaellig werden. Wer sie unter "offen" mitzaehlt, haelt
einen Betrieb fuer saeumig, der nichts versaeumt hat.

ZWEI DINGE, DIE DIE ZEILENZAHL ERKLAEREN:
  * betrieb_key IS NULL heisst: der Standort dieser Person hat keinen
    Betrieb. Diese Zeilen bleiben ABSICHTLICH drin (Regel 10) — sie sind
    der einzige Ort, an dem sichtbar wird, wie viel Schulung an der
    Betriebsauswertung vorbeilaeuft.
  * Eine Person an zwei Standorten erzeugt zwei Zeilen je Zuweisung. Ueber
    Betriebe hinweg darf deshalb nicht summiert werden.';


-- ---------------------------------------------------------------------
-- 2. Die Zeile je Person — die Arbeitsliste
--
-- Aus der Frage "welcher Betrieb ist saeumig" wird hier "wer muss was
-- nachholen". Das ist die einzige Ebene, auf der jemand handeln kann:
-- ein Betrieb holt keine Schulung nach, eine Person tut es.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bounti_person_stand AS
SELECT betrieb_key,
       betrieb,
       konzept,
       standort,
       mitarbeiter_id,
       person,
       archiviert,
       rollen,
       count(*)::int                                                   AS zuweisungen,
       count(*) FILTER (WHERE zustand = 'abgeschlossen')::int          AS abgeschlossen,
       count(*) FILTER (WHERE zustand = 'ueberfaellig')::int           AS ueberfaellig,
       count(*) FILTER (WHERE zustand = 'offen')::int                  AS offen,
       count(*) FILTER (WHERE zustand = 'ohne Frist')::int             AS ohne_frist,
       max(tage_ueberfaellig)                                          AS laengste_ueberschreitung_tage,
       min(faellig_am) FILTER (WHERE zustand = 'ueberfaellig')         AS aelteste_frist,
       min(faellig_am) FILTER (WHERE zustand = 'offen')                AS naechste_frist,
       round(100.0 * count(*) FILTER (WHERE zustand = 'abgeschlossen')
                   / nullif(count(*), 0), 2)                           AS erfuellung_pct,
       round(avg(ergebnis_pct) FILTER (WHERE ergebnis_pct IS NOT NULL), 2)
                                                                       AS ergebnis_schnitt_pct,
       operativ
  FROM mart.bounti_schulung_person
 GROUP BY betrieb_key, betrieb, konzept, operativ, standort,
          mitarbeiter_id, person, archiviert, rollen;

COMMENT ON VIEW mart.bounti_person_stand IS
'Je Person und Standort: was offen ist, was ueberfaellig ist, wie lange
schon. Die Arbeitsliste — ein Betrieb holt keine Schulung nach, eine Person
tut es.

archiviert = true heisst: das Konto ist in Bounti stillgelegt. Offene
Zuweisungen dieser Konten sind KEINE Arbeitsliste, sondern Karteileichen;
jede Auswertung, die zum Handeln auffordert, muss sie ausschliessen. Sie
stehen trotzdem hier, weil eine grosse Zahl davon heisst, dass in Bounti
Konten stillgelegt werden, ohne die Zuweisungen zu schliessen.';


-- ---------------------------------------------------------------------
-- 3. Die Zeile je Betrieb — die Leitsicht
--
-- Ausgangspunkt ist core.betrieb und NICHT Bounti. Der Unterschied ist
-- der zwischen "dieser Betrieb hat nichts Ueberfaelliges" und "wir wissen
-- nichts ueber diesen Betrieb", und er entscheidet ueber die Haelfte der
-- Betriebe: 62 der 141 haben einen Bounti-Standort.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bounti_betrieb_stand AS
WITH standort AS (
    SELECT betrieb_key,
           count(*)::int                                      AS standorte,
           string_agg(standort, ', ' ORDER BY standort)       AS standortnamen
      FROM mart.bounti_standort_betrieb
     WHERE betrieb_key IS NOT NULL
     GROUP BY betrieb_key
), kopf AS (
    SELECT sb.betrieb_key,
           count(*) FILTER (WHERE NOT m.archiviert)::int      AS koepfe_aktiv,
           count(*) FILTER (WHERE m.archiviert)::int          AS koepfe_archiviert
      FROM core.bounti_mitarbeiter_standort ms
      JOIN core.bounti_mitarbeiter m       ON m.bounti_id = ms.mitarbeiter_id
      JOIN mart.bounti_standort_betrieb sb ON sb.standort_id = ms.standort_id
     WHERE sb.betrieb_key IS NOT NULL
     GROUP BY sb.betrieb_key
), zuw AS (
    SELECT betrieb_key,
           count(*)::int                                              AS zuweisungen,
           count(DISTINCT mitarbeiter_id)::int                        AS koepfe_mit_zuweisung,
           count(*) FILTER (WHERE zustand = 'abgeschlossen')::int     AS abgeschlossen,
           count(*) FILTER (WHERE zustand = 'ueberfaellig')::int      AS ueberfaellig,
           count(*) FILTER (WHERE zustand = 'offen')::int             AS offen,
           count(*) FILTER (WHERE zustand = 'ohne Frist')::int        AS ohne_frist,
           count(DISTINCT mitarbeiter_id) FILTER (WHERE zustand = 'ueberfaellig'
                                              AND NOT archiviert)::int AS koepfe_ueberfaellig,
           max(tage_ueberfaellig)                                     AS laengste_ueberschreitung_tage,
           round(100.0 * count(*) FILTER (WHERE zustand = 'abgeschlossen')
                       / nullif(count(*), 0), 2)                      AS erfuellung_pct,
           round(avg(ergebnis_pct) FILTER (WHERE ergebnis_pct IS NOT NULL), 2)
                                                                      AS ergebnis_schnitt_pct
      FROM mart.bounti_schulung_person
     WHERE betrieb_key IS NOT NULL
     GROUP BY betrieb_key
), audit AS (
    SELECT sb.betrieb_key,
           count(*)::int                                              AS auditberichte,
           count(*) FILTER (WHERE r.abgeschlossen_am IS NOT NULL)::int AS auditberichte_fertig,
           round(avg(r.prozent) FILTER (WHERE r.abgeschlossen_am IS NOT NULL), 2)
                                                                      AS audit_schnitt_pct,
           max(r.erstellt_am)::date                                   AS letztes_audit_am
      FROM core.bounti_auditbericht r
      JOIN mart.bounti_standort_betrieb sb ON sb.standort_id = r.ziel_id
     WHERE r.ziel_art = 'LOCATION'
       AND sb.betrieb_key IS NOT NULL
     GROUP BY sb.betrieb_key
)
SELECT bs.betrieb_key,
       bs.betrieb,
       bs.konzept,
       b.stadt,
       bs.status,
       (bs.status = 'operativ')                       AS operativ,
       (st.betrieb_key IS NOT NULL)                   AS in_bounti,
       coalesce(st.standorte, 0)                      AS standorte,
       st.standortnamen,
       coalesce(k.koepfe_aktiv, 0)                    AS koepfe_aktiv,
       coalesce(k.koepfe_archiviert, 0)               AS koepfe_archiviert,
       coalesce(z.zuweisungen, 0)                     AS zuweisungen,
       coalesce(z.abgeschlossen, 0)                   AS abgeschlossen,
       coalesce(z.ueberfaellig, 0)                    AS ueberfaellig,
       coalesce(z.offen, 0)                           AS offen,
       coalesce(z.ohne_frist, 0)                      AS ohne_frist,
       coalesce(z.koepfe_ueberfaellig, 0)             AS koepfe_ueberfaellig,
       z.laengste_ueberschreitung_tage,
       z.erfuellung_pct,
       z.ergebnis_schnitt_pct,
       /*
        * Die Vergleichszahl zwischen ungleich grossen Betrieben. Aalen
        * hat 1109 ueberfaellige Zuweisungen und Schwetzingen 389 — bei
        * 53 gegen 22 Koepfen ist das derselbe Rueckstand. Ohne diese
        * Spalte fuehrt jede Rangliste die grossen Haeuser an, und zwar
        * dauerhaft.
        */
       round(coalesce(z.ueberfaellig, 0)::numeric / nullif(k.koepfe_aktiv, 0), 1)
                                                      AS ueberfaellig_je_kopf,
       coalesce(a.auditberichte, 0)                   AS auditberichte,
       coalesce(a.auditberichte_fertig, 0)            AS auditberichte_fertig,
       a.audit_schnitt_pct,
       a.letztes_audit_am,
       /*
        * Wie bei mart.pflichtartikel_betrieb: der Prozentwert ohne die
        * Datenbasis daneben ist eine richtig gerechnete Nicht-Aussage.
        * Ein Betrieb mit drei Zuweisungen kommt auf 0 oder 100 %.
        */
       CASE
         WHEN st.betrieb_key IS NULL             THEN 'kein Bounti-Standort'
         WHEN coalesce(z.zuweisungen, 0) = 0     THEN 'keine Zuweisung'
         WHEN coalesce(k.koepfe_aktiv, 0) < 5
           OR z.zuweisungen < 20                 THEN 'duenn'
         ELSE 'belastbar'
       END                                            AS datenbasis
  FROM mart.betrieb_status bs
  JOIN core.betrieb b        ON b.betrieb_key = bs.betrieb_key
  LEFT JOIN standort st      ON st.betrieb_key = bs.betrieb_key
  LEFT JOIN kopf k           ON k.betrieb_key = bs.betrieb_key
  LEFT JOIN zuw z            ON z.betrieb_key = bs.betrieb_key
  LEFT JOIN audit a          ON a.betrieb_key = bs.betrieb_key;

COMMENT ON VIEW mart.bounti_betrieb_stand IS
'Der Schulungs- und Auditstand je Betrieb — STAND HEUTE, ohne Monatsbezug.
Die Leitsicht der Bounti-Auswertung.

WARUM KEIN MONAT: "ueberfaellig" ist eine Aussage ueber heute. Rechnet man
sie in den Monat der Zuweisung zurueck, steht eine mit jedem Tag steigende
Zahl unter einem abgeschlossenen Monat. Den Verlauf gibt es daneben:
mart.bounti_schulung_verlauf, dort ist der Monat der der ZUWEISUNG.

WARUM ALLE BETRIEBE: die Sicht geht von core.betrieb aus. in_bounti = false
heisst "wir wissen nichts ueber diesen Betrieb" und nicht "dort ist nichts
offen" — der Unterschied betrifft rund die Haelfte der Betriebe.

ueberfaellig_je_kopf ist die einzige zwischen ungleich grossen Betrieben
vergleichbare Zahl. Die Rohzahl ueberfaellig fuehrt jede Rangliste
dauerhaft nach Betriebsgroesse.

datenbasis immer mitlesen: bei "duenn" ist erfuellung_pct richtig gerechnet
und trotzdem keine Aussage.

NICHT IN DER ROUND-TABLE-AMPEL. Weder die Erfuellungsquote noch die
Auditnote geht in eines der sechs Signale ein — das entscheidet der
Fachbereich (docs/offene-punkte.md), nicht eine Migration.';


-- ---------------------------------------------------------------------
-- 4. Der Verlauf je Betrieb und Monat
--
-- Dieselbe Grundlage wie mart.bounti_schulung_betrieb_monat aus 0096,
-- aber mit Betriebsnamen und Marke statt nur betrieb_key, und ueber
-- beide Arten zusammengefasst. Der Grund ist schlicht: Metabase-Karten
-- filtern auf betrieb und konzept, nicht auf einen Schluessel, und die
-- Verdichtung ueber Kurs+Pfad ist die Frage der Verlaufskurve.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bounti_schulung_verlauf AS
SELECT betrieb_key,
       betrieb,
       konzept,
       date_trunc('month', erstellt_am)::date                          AS monat,
       count(*)::int                                                   AS zugewiesen,
       count(*) FILTER (WHERE zustand = 'abgeschlossen')::int          AS abgeschlossen,
       count(*) FILTER (WHERE zustand = 'ueberfaellig')::int           AS ueberfaellig,
       count(*) FILTER (WHERE zustand = 'ohne Frist')::int             AS ohne_frist,
       count(DISTINCT mitarbeiter_id)::int                             AS koepfe,
       round(100.0 * count(*) FILTER (WHERE zustand = 'abgeschlossen')
                   / nullif(count(*), 0), 2)                           AS erfuellung_pct,
       round(avg(ergebnis_pct) FILTER (WHERE ergebnis_pct IS NOT NULL), 2)
                                                                       AS ergebnis_schnitt_pct,
       operativ
  FROM mart.bounti_schulung_person
 WHERE erstellt_am IS NOT NULL
 GROUP BY betrieb_key, betrieb, konzept, operativ, date_trunc('month', erstellt_am)::date;

COMMENT ON VIEW mart.bounti_schulung_verlauf IS
'Schulung je Betrieb und Monat, ueber Kurse und Lernpfade zusammengefasst.
Der Monat ist der der ZUWEISUNG, nicht der des Abschlusses — sonst faellt
die nie erledigte Pflichtschulung aus der Statistik, also genau der Fall,
den sie zeigen soll.

Die Aufteilung nach Kurs und Pfad steht in
mart.bounti_schulung_betrieb_monat (Migration 0096).

Die Zuordnung Person → Standort ist die von HEUTE; Bounti fuehrt dazu keine
Historie. Weit zurueckliegende Monate sind deshalb eine Annaeherung — wer
den Betrieb gewechselt hat, bringt seine alten Zuweisungen mit.';


-- ---------------------------------------------------------------------
-- 5. Die Zeile je Lerneinheit
--
-- Die andere Leserichtung: nicht "welcher Betrieb haengt hinterher",
-- sondern "welche Schulung wird nicht gemacht". Beides ist noetig — eine
-- Lerneinheit, die konzernweit bei 20 % steht, ist kein Betriebsproblem,
-- sondern ein Problem der Lerneinheit.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bounti_lerneinheit_betrieb AS
SELECT betrieb_key,
       betrieb,
       konzept,
       art,
       lerneinheit,
       count(*)::int                                                   AS zugewiesen,
       count(DISTINCT mitarbeiter_id)::int                             AS koepfe,
       count(*) FILTER (WHERE zustand = 'abgeschlossen')::int          AS abgeschlossen,
       count(*) FILTER (WHERE zustand = 'ueberfaellig')::int           AS ueberfaellig,
       count(*) FILTER (WHERE zustand = 'offen')::int                  AS offen,
       count(*) FILTER (WHERE zustand = 'ohne Frist')::int             AS ohne_frist,
       round(100.0 * count(*) FILTER (WHERE zustand = 'abgeschlossen')
                   / nullif(count(*), 0), 2)                           AS erfuellung_pct,
       round(avg(ergebnis_pct) FILTER (WHERE ergebnis_pct IS NOT NULL), 2)
                                                                       AS ergebnis_schnitt_pct,
       max(abgeschlossen_am)                                           AS zuletzt_abgeschlossen_am,
       operativ
  FROM mart.bounti_schulung_person
 GROUP BY betrieb_key, betrieb, konzept, operativ, art, lerneinheit;

COMMENT ON VIEW mart.bounti_lerneinheit_betrieb IS
'Je Lerneinheit und Betrieb: zugewiesen, abgeschlossen, ueberfaellig.

Die zweite Leserichtung neben mart.bounti_betrieb_stand. Eine Lerneinheit,
die ueber ALLE Betriebe bei 20 % Erfuellung steht, ist kein Betriebsproblem
— sie ist zu lang, zu unklar oder an die falschen Personen verteilt. Diese
Frage laesst sich in der Betriebsrangliste nicht stellen.

Fuer die konzernweite Sicht ueber betrieb_key hinweg summieren; Personen an
mehreren Standorten zaehlen dabei mehrfach.';


-- ---------------------------------------------------------------------
-- 6. Die Auditberichte, EINSCHLIESSLICH der ohne Betrieb
--
-- mart.bounti_audit_betrieb_monat (0096) filtert auf zugeordnete
-- Standorte und ist deshalb am 24.08.2026 LEER — alle 133 Berichte
-- haengen an drei Standorten ohne Betrieb. Eine leere Auswertung sagt
-- "es wird nicht auditiert", und das ist das Gegenteil der Wahrheit.
--
-- Diese Sicht fuehrt die Berichte deshalb ALLE, mit betrieb_key IS NULL,
-- wo die Zuordnung fehlt.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bounti_auditbericht_liste AS
SELECT r.bounti_id,
       a.name                                         AS audit,
       a.art                                          AS audit_art,
       sb.betrieb_key,
       sb.betrieb,
       bst.konzept,
       coalesce(sb.standort, s.name)                  AS standort,
       r.erstellt_am,
       r.begonnen_am,
       r.abgeschlossen_am,
       r.punkte_erreicht,
       r.punkte_gesamt,
       r.prozent,
       nullif(btrim(coalesce(au.vorname, '') || ' ' || coalesce(au.nachname, '')), '')
                                                      AS auditor,
       CASE
         WHEN r.abgeschlossen_am IS NOT NULL THEN 'abgeschlossen'
         WHEN r.begonnen_am IS NOT NULL      THEN 'angefangen'
         ELSE 'offen'
       END                                            AS zustand,
       (bst.status = 'operativ')                      AS operativ
  FROM core.bounti_auditbericht r
  JOIN core.bounti_audit a                 ON a.bounti_id = r.audit_id
  LEFT JOIN core.bounti_standort s         ON s.bounti_id = r.ziel_id
                                          AND r.ziel_art = 'LOCATION'
  LEFT JOIN mart.bounti_standort_betrieb sb ON sb.standort_id = r.ziel_id
                                          AND r.ziel_art = 'LOCATION'
  LEFT JOIN mart.betrieb_status bst        ON bst.betrieb_key = sb.betrieb_key
  LEFT JOIN core.bounti_mitarbeiter au     ON au.bounti_id = r.auditor_id;

COMMENT ON VIEW mart.bounti_auditbericht_liste IS
'Alle Auditberichte, AUCH die ohne Betrieb — und das ist der Zweck.

mart.bounti_audit_betrieb_monat filtert auf zugeordnete Standorte und war
am 24.08.2026 leer: alle 133 Berichte hingen an genau drei Standorten ohne
Betrieb. Eine leere Auditauswertung liest sich als "es wird nicht
auditiert", und das war das Gegenteil der Wahrheit.

prozent ist eine PROZENTZAHL (Bounti liefert achievedPercentage bereits so).
Der Zustand trennt abgeschlossen / angefangen / offen: ein angefangenes
Audit hat null Punkte, und ein Mittelwert darueber ist keine schlechte Note,
sondern eine falsche.';


-- ---------------------------------------------------------------------
-- 7. Rollen je Betrieb
--
-- Die einzige Strukturaussage, die Bounti ohne LINA hergibt: wie viele
-- Koepfe je Rolle. Bewusst OHNE Fluktuation, ohne Eintritt und ohne
-- Austritt — das sind LINA-Kennzahlen (0096, Abschnitt 2).
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bounti_rolle_betrieb AS
SELECT sb.betrieb_key,
       sb.betrieb,
       bst.konzept,
       coalesce(ro.name, '— ohne Rolle')                  AS rolle,
       count(*) FILTER (WHERE NOT m.archiviert)::int      AS koepfe_aktiv,
       count(*) FILTER (WHERE m.archiviert)::int          AS koepfe_archiviert,
       (bst.status = 'operativ')                          AS operativ
  FROM core.bounti_mitarbeiter_standort ms
  JOIN core.bounti_mitarbeiter m            ON m.bounti_id = ms.mitarbeiter_id
  JOIN mart.bounti_standort_betrieb sb      ON sb.standort_id = ms.standort_id
  LEFT JOIN core.bounti_mitarbeiter_rolle mr ON mr.mitarbeiter_id = m.bounti_id
  LEFT JOIN core.bounti_rolle ro            ON ro.bounti_id = mr.rolle_id
  LEFT JOIN mart.betrieb_status bst         ON bst.betrieb_key = sb.betrieb_key
 GROUP BY sb.betrieb_key, sb.betrieb, bst.konzept, (bst.status = 'operativ'),
          coalesce(ro.name, '— ohne Rolle');

COMMENT ON VIEW mart.bounti_rolle_betrieb IS
'Kopfzahl je Rolle und Betrieb, aktiv und archiviert getrennt.

Eine Person mit ZWEI Rollen zaehlt in beiden Zeilen — die Summe ueber die
Rollen ist deshalb groesser als die Kopfzahl des Betriebs. "— ohne Rolle"
ist keine Rolle, sondern ihr Fehlen.

KEINE FLUKTUATION. Eintritt und Austritt stehen in LINA (Team > Mitarbeiter
> Stammdaten), nicht in Bounti; das Archivierungskennzeichen hier ist kein
Austrittsdatum. Siehe Migration 0096, Abschnitt 2.';


-- ---------------------------------------------------------------------
-- 7b. Die Standorte ohne Betrieb — mit dem, was daran haengt
--
-- mart.bounti_ohne_betrieb (0096) nennt die Luecke, aber nicht ihr
-- Gewicht: 26 unzugeordnete Standorte sind eine Zahl, "26 Standorte mit
-- 592 aktiven Personen und allen 133 Auditberichten" ist ein Auftrag.
--
-- Die Reihenfolge ist deshalb nach Personen sortierbar und nicht nach
-- Namen. Wer die Liste von oben abarbeitet, schliesst zuerst die Luecken,
-- die am meisten Auswertung zurueckbringen.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bounti_standort_offen AS
SELECT s.bounti_id                                              AS standort_id,
       s.name                                                   AS standort,
       (SELECT count(*)::int
          FROM core.bounti_mitarbeiter_standort ms
          JOIN core.bounti_mitarbeiter m ON m.bounti_id = ms.mitarbeiter_id
         WHERE ms.standort_id = s.bounti_id AND NOT m.archiviert) AS koepfe_aktiv,
       (SELECT count(*)::int
          FROM core.bounti_zuweisung z
          JOIN core.bounti_mitarbeiter_standort ms ON ms.mitarbeiter_id = z.mitarbeiter_id
         WHERE ms.standort_id = s.bounti_id)                    AS zuweisungen,
       (SELECT count(*)::int
          FROM core.bounti_auditbericht r
         WHERE r.ziel_art = 'LOCATION' AND r.ziel_id = s.bounti_id) AS auditberichte,
       (SELECT max(r.erstellt_am)::date
          FROM core.bounti_auditbericht r
         WHERE r.ziel_art = 'LOCATION' AND r.ziel_id = s.bounti_id) AS letztes_audit_am,
       s.zuerst_gesehen_am,
       s.zuletzt_gesehen_am
  FROM core.bounti_standort s
 WHERE NOT EXISTS (SELECT 1 FROM manual.betrieb_fremd_id f
                    WHERE f.system = 'bounti' AND f.fremd_id = s.bounti_id);

COMMENT ON VIEW mart.bounti_standort_offen IS
'Die Standorte ohne Betrieb, mit dem was daran haengt: Koepfe, Zuweisungen,
Auditberichte. Die Arbeitsliste der Zuordnung, nach Gewicht statt nach Namen.

Sie ist die andere Haelfte von mart.bounti_ohne_betrieb: dort steht, DASS
etwas fehlt, hier was es kostet. Am 24.08.2026 hingen an diesen Zeilen
592 aktive Personen und ALLE 133 Auditberichte.

DREI GRUPPEN, DIE MAN AUSEINANDERHALTEN MUSS (docs/offene-punkte.md):
  * Fremdmandant Gimme Gelato — sieben Standorte, gehoeren nicht zum
    Konzern und sollen auch keinen Betrieb bekommen.
  * Neun Wirtshaeuser, die WEDER LINA NOCH FOODNOTIFY NOCH YEXT kennt.
    Alle drei auditierenden Standorte stehen hier.
  * Sechs, bei denen eine Entscheidung aussteht — dieselben, die auch bei
    Yext offen sind.
Ohne diese Einteilung liest sich die Liste als 26-facher Fehler; sie ist
aber bei sechzehn Zeilen kein Fehler, sondern eine Feststellung.';


-- ---------------------------------------------------------------------
-- 8. Die Abdeckung — die Zahl, ohne die keine der obigen gelesen
--    werden darf
--
-- Jede Betriebsauswertung dieser Migration laesst die Standorte ohne
-- Betrieb aus. Am 24.08.2026 sind das 26 von 88 Standorten mit 598 von
-- 2372 aktiven Personen — jede vierte. Diese Sicht sagt das in Zahlen,
-- in derselben Form wie mart.pruefung_uebersicht, und gehoert auf jedes
-- Dashboard, das Bounti-Zahlen zeigt.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW mart.bounti_abdeckung AS
SELECT 'Standorte in Bounti'::text                                     AS kennzahl,
       (SELECT count(*)::int FROM core.bounti_standort)                AS gesamt,
       (SELECT count(*)::int FROM mart.bounti_standort_betrieb
         WHERE betrieb_key IS NOT NULL)                                AS zugeordnet,
       'mart.bounti_ohne_betrieb'::text                                AS sicht
UNION ALL
SELECT 'Aktive Personen',
       (SELECT count(DISTINCT ms.mitarbeiter_id)::int
          FROM core.bounti_mitarbeiter_standort ms
          JOIN core.bounti_mitarbeiter m ON m.bounti_id = ms.mitarbeiter_id
         WHERE NOT m.archiviert),
       (SELECT count(DISTINCT ms.mitarbeiter_id)::int
          FROM core.bounti_mitarbeiter_standort ms
          JOIN core.bounti_mitarbeiter m ON m.bounti_id = ms.mitarbeiter_id
          JOIN mart.bounti_standort_betrieb sb ON sb.standort_id = ms.standort_id
         WHERE NOT m.archiviert AND sb.betrieb_key IS NOT NULL),
       'mart.bounti_ohne_betrieb'
UNION ALL
SELECT 'Zuweisungen',
       (SELECT count(*)::int FROM core.bounti_zuweisung),
       (SELECT count(*)::int FROM mart.bounti_schulung_person
         WHERE betrieb_key IS NOT NULL),
       'mart.bounti_schulung_person'
UNION ALL
SELECT 'Auditberichte',
       (SELECT count(*)::int FROM core.bounti_auditbericht),
       (SELECT count(*)::int FROM mart.bounti_auditbericht_liste
         WHERE betrieb_key IS NOT NULL),
       'mart.bounti_auditbericht_liste'
UNION ALL
SELECT 'Betriebe mit Bounti-Standort',
       (SELECT count(*)::int FROM mart.bounti_betrieb_stand),
       (SELECT count(*)::int FROM mart.bounti_betrieb_stand WHERE in_bounti),
       'mart.bounti_betrieb_stand'
UNION ALL
SELECT 'Operative Betriebe mit Bounti-Standort',
       (SELECT count(*)::int FROM mart.bounti_betrieb_stand WHERE operativ),
       (SELECT count(*)::int FROM mart.bounti_betrieb_stand WHERE operativ AND in_bounti),
       'mart.bounti_betrieb_stand';

COMMENT ON VIEW mart.bounti_abdeckung IS
'Wie viel von Bounti ueberhaupt in einer Betriebsauswertung ankommt —
gesamt gegen zugeordnet, je Gegenstand.

DIE ZAHL, DIE ALLES EINORDNET. Am 24.08.2026 hingen 598 von 2372 aktiven
Personen an Standorten ohne Betrieb, und ALLE 133 Auditberichte. Wer eine
Erfuellungsquote je Betrieb liest, ohne diese Zeilen gesehen zu haben,
haelt einen Ausschnitt fuer das Ganze.

Gleiche Form wie mart.pruefung_uebersicht, aber andere Frage: dort geht es
um Fehler, hier um Reichweite. Die Arbeitsliste zum Schliessen der Luecke
ist mart.bounti_ohne_betrieb.';


INSERT INTO sync.merker (schluessel, wert) VALUES
    ('migration_0097', to_jsonb(
        'Bounti-Auswertungsschicht: acht Sichten auf dem Bestand von 0096, '
        'keine neue Tabelle und kein neuer Abruf. Leitsicht ist '
        'mart.bounti_betrieb_stand (Stand HEUTE, alle Betriebe, auch die '
        'ohne Bounti-Standort), unterste Ebene mart.bounti_schulung_person '
        '(eine Zeile je Zuweisung, vier Zustaende). '
        'mart.bounti_abdeckung sagt, wie viel davon ueberhaupt bei einem '
        'Betrieb ankommt — am 24.08.2026 waren es 62 von 141 Betrieben, '
        '1774 von 2372 aktiven Personen und 0 von 133 Auditberichten.'::text))
ON CONFLICT (schluessel) DO UPDATE SET wert = EXCLUDED.wert;
