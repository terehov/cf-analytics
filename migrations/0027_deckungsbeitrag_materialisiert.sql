-- =====================================================================
-- 0027 mart.deckungsbeitrag_warengruppe wird materialisiert
--
-- ANLASS. Am 01.08.2026 gemeldet: einzelne Dashboards sind seit dem
-- abgeschlossenen Lina-Import langsam. Nachgemessen auf der Seite
-- "Warenwirtschaft" mit ihrer Voreinstellung "letzte 3 Monate":
--
--     wa_db_warengruppe   > 120 s (Abbruch)
--     pf_karteileichen      23,9 s
--     wa_renner              7,0 s
--     wa_penner              5,9 s
--
-- Der Round Table (Dashboard 2) war NICHT betroffen -- 3,9 s fuer alle
-- 17 Karten zusammen, die Karten laufen parallel.
--
-- ZWEI URSACHEN, ZWEI FIXES. Die erste steckte in der Karte selbst und
-- ist in metabase/karten-fach.ts behoben (Zeitraum direkt auf
-- geschaeftstag statt in einer Unterabfrage -- 111 Partitionsscans auf
-- core.artikelverkauf_tag statt drei). Die zweite ist diese Migration.
--
-- WARUM MATERIALISIEREN. mart.deckungsbeitrag_warengruppe aggregiert
-- core.artikelverkauf_tag: 27,5 Mio. Zeilen in 108 Monatspartitionen ab
-- Januar 2018, 3,8 GB. Das Ergebnis sind 173.952 Zeilen ueber 103
-- Monate -- und es aendert sich genau einmal je Importlauf, wird aber
-- bei jedem Kartenaufruf neu gerechnet.
--
-- Bis heute war JEDES der 34 mart-Objekte eine reine Sicht. Das ist als
-- Grundhaltung richtig -- eine Sicht kann nicht veralten, und genau
-- deshalb steht in docs/metabase.md, dass mart die Fallen ausraeumt.
-- Fuer eine Aggregation ueber 27,5 Mio. Zeilen traegt die Haltung
-- nicht mehr: der Zuwachs kommt aus dem Backfill, nicht aus dem
-- laufenden Betrieb, und er hoert nicht auf.
--
-- DER PREIS, BEWUSST BEZAHLT: die Zahlen sind jetzt so alt wie der
-- letzte REFRESH. Abgefedert dadurch, dass der Refresh im Nachlauf
-- jedes Sync-Laufs passiert (src/sync/deckungsbeitrag.ts, angehaengt in
-- src/sync.ts) -- also genau dann, wenn sich die Grundlage geaendert
-- hat. Wer den Stand wissen will, liest mart.deckungsbeitrag_stand.
--
-- CONCURRENTLY BRAUCHT EINEN UNIQUE INDEX. Ohne ihn sperrt der Refresh
-- die Sicht fuer die Dauer des Neuaufbaus, und wer in dem Moment das
-- Dashboard oeffnet, wartet. Der Index unten deckt genau die
-- Gruppierung ab und ist deshalb eindeutig.
-- =====================================================================

DROP VIEW IF EXISTS mart.deckungsbeitrag_warengruppe;

CREATE MATERIALIZED VIEW mart.deckungsbeitrag_warengruppe AS
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
             / nullif(sum(umsatz_netto), 0), 1)                AS abdeckung_pct,
       -- Der Umsatz MIT hinterlegtem Ansatz, als eigene Summe.
       --
       -- abdeckung_pct ist ein Prozentwert und damit nicht wieder
       -- aufsummierbar: aus Prozenten laesst sich der zugrunde liegende
       -- Betrag nicht zurueckrechnen. mart.pruefung_wareneinsatz braucht
       -- aber genau diesen Betrag, um auf einer hoeheren Ebene
       -- (Betrieb x Monat) weiterzurechnen. Ohne diese Spalte muesste die
       -- Pruefung wieder auf core.artikelverkauf_tag zurueck -- und das
       -- sind die 61,7 Sekunden, die sie hier verliert.
       sum(umsatz_netto) FILTER (WHERE fixer_we IS NOT NULL)   AS umsatz_mit_we
  FROM mart.artikelverkauf
 GROUP BY 1, 2, 3, 4, 5, 6, 7;

-- Die Gruppierung eins zu eins als eindeutiger Index. NULLS NOT DISTINCT
-- ist noetig, weil grosskategorie, warengruppe und detailkategorie NULL
-- sein duerfen (Artikel ohne Sortimentszuordnung) -- ohne das gaelten
-- zwei NULL-Zeilen als verschieden, und der Index waere nicht eindeutig.
CREATE UNIQUE INDEX deckungsbeitrag_warengruppe_schluessel
    ON mart.deckungsbeitrag_warengruppe
       (betrieb_key, monat, grosskategorie, warengruppe, detailkategorie)
       NULLS NOT DISTINCT;

-- Die beiden Zugriffswege der Karten: nach Monat (Zeitraumfilter) und
-- nach Betrieb bzw. Marke.
CREATE INDEX deckungsbeitrag_warengruppe_monat
    ON mart.deckungsbeitrag_warengruppe (monat);
CREATE INDEX deckungsbeitrag_warengruppe_betrieb
    ON mart.deckungsbeitrag_warengruppe (betrieb);
CREATE INDEX deckungsbeitrag_warengruppe_konzept
    ON mart.deckungsbeitrag_warengruppe (konzept);

COMMENT ON MATERIALIZED VIEW mart.deckungsbeitrag_warengruppe IS
'Deckungsbeitrag je Warengruppe und Monat. Prozentwerte sind Prozentzahlen (23.64), nie Brueche.

MATERIALISIERT seit 01.08.2026 -- die Zahlen sind so alt wie der letzte REFRESH. Der laeuft im
Nachlauf jedes Sync-Laufs; der Stand steht in mart.deckungsbeitrag_stand. Grund: die Sicht
aggregiert 27,5 Mio. Zeilen aus core.artikelverkauf_tag und wurde bei JEDEM Kartenaufruf neu
gerechnet.

Wer sie von Hand auffrischt:
    REFRESH MATERIALIZED VIEW CONCURRENTLY mart.deckungsbeitrag_warengruppe;
CONCURRENTLY, damit niemand waehrenddessen vor einem sperrenden Dashboard sitzt.

ZUERST AUF abdeckung_pct SEHEN. Sie sagt, welcher Anteil des Umsatzes ueberhaupt einen
hinterlegten Wareneinsatzansatz hat. Bei 60 Prozent Abdeckung ist der Deckungsbeitrag
strukturell zu hoch, und zwar ohne dass man es der Zahl ansieht.

ACHTUNG: umsatz_netto_pos ist der POS-Artikelumsatz und NICHT das BWA-Umsatzkonto aus
core.kennzahlen_monat - die beiden weichen systematisch ab. Wer sie vergleicht, liest erst
den Kommentar an mart.pruefung_wareneinsatz.';


-- ---------------------------------------------------------------------
-- Der Stand, damit "wie alt sind diese Zahlen" beantwortbar ist.
--
-- Eine materialisierte Sicht traegt ihren Refresh-Zeitpunkt nirgends
-- sichtbar. Ohne diese Sicht waere die einzige ehrliche Antwort auf die
-- Frage "ist das aktuell?" ein Achselzucken -- und eine veraltete Zahl,
-- die aussieht wie eine frische, ist genau die Sorte Fehler, die sich
-- laut docs/fehlerkatalog.md nie von selbst meldet.
-- ---------------------------------------------------------------------
-- gesetzt_am statt eines Zeitstempels im JSON: die Spalte gibt es
-- bereits, und zwei Wahrheiten ueber denselben Zeitpunkt waeren eine zu
-- viel.
CREATE VIEW mart.deckungsbeitrag_stand AS
SELECT (SELECT gesetzt_am FROM sync.merker
         WHERE schluessel = 'deckungsbeitrag_refresh')             AS aufgefrischt_am,
       (SELECT (wert->>'dauer_s')::numeric FROM sync.merker
         WHERE schluessel = 'deckungsbeitrag_refresh')             AS dauer_s,
       (SELECT count(*) FROM mart.deckungsbeitrag_warengruppe)     AS zeilen,
       (SELECT max(monat) FROM mart.deckungsbeitrag_warengruppe)   AS juengster_monat;

COMMENT ON VIEW mart.deckungsbeitrag_stand IS
'Wie alt die Zahlen in mart.deckungsbeitrag_warengruppe sind. aufgefrischt_am ist NULL, solange
der erste Refresh im Sync-Nachlauf nicht gelaufen ist -- die Sicht selbst ist dann trotzdem
gefuellt, naemlich mit dem Stand aus der Migration.';
