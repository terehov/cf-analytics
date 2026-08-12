-- =====================================================================
-- mart.artikel_monat — der Artikelverkauf, auf Monate verdichtet.
--
-- Der Anlass ist der Artikel-Drill-Down (dd_artikel): wer in den
-- Rennern auf "Sarti Spritz" klickt, will dessen Verlauf und die
-- Betriebe dahinter sehen. mart.artikelverkauf fuehrt 27,7 Mio
-- Tageszeilen, und eine einzelne Artikelfrage darueber braucht
-- gemessen 7 Sekunden — je Karte. Das ist dieselbe Lage wie bei den
-- Einkaufssichten am 12.08. (0063), und die Antwort ist dieselbe:
-- materialisieren, im Sync-Nachlauf auffrischen (src/sync/round_table.ts
-- — Artikelverkauf ist LINA-Ware, dort laufen die LINA-Refreshes).
--
-- Verdichtet wird auf Artikel x Betrieb x Monat. Feiner braucht der
-- Drill-Down nicht, groeber ginge die Betriebsfrage verloren.
-- warengruppe als max() weggefasst: sie haengt am Artikel, aber
-- warengruppe_geschaetzt kann je Tageszeile abweichen — ein Artikel
-- darf im Monat trotzdem nur EINE Zeile je Betrieb haben.
-- =====================================================================

CREATE MATERIALIZED VIEW mart.artikel_monat_basis AS
SELECT md5(coalesce(artikel_key::text, artikel) || '|'
           || betrieb_key::text || '|' || monat::text)      AS zeile_key,
       artikel_key,
       artikel,
       max(warengruppe)                                     AS warengruppe,
       betrieb_key,
       betrieb,
       konzept,
       monat,
       sum(menge)                                           AS menge,
       sum(umsatz_netto)                                    AS umsatz_netto,
       sum(deckungsbeitrag)                                 AS deckungsbeitrag,
       -- Der Umsatzanteil MIT hinterlegtem Wareneinsatz — der Nenner,
       -- auf den sich ein DB-Prozent beziehen darf (Regel aus 0039:
       -- deckungsbeitrag ist NULL ohne WE-Ansatz, und ein DB % auf den
       -- vollen Umsatz waere eine Margenaussage aus dem falschen Nenner).
       sum(umsatz_netto) FILTER (WHERE fixer_we IS NOT NULL) AS umsatz_mit_we,
       count(DISTINCT geschaeftstag)::int                    AS verkaufstage
  FROM mart.artikelverkauf
 GROUP BY artikel_key, artikel, betrieb_key, betrieb, konzept, monat;

CREATE UNIQUE INDEX artikel_monat_basis_zeile
    ON mart.artikel_monat_basis (zeile_key);
CREATE INDEX artikel_monat_basis_artikel
    ON mart.artikel_monat_basis (artikel);
CREATE INDEX artikel_monat_basis_monat
    ON mart.artikel_monat_basis (monat);
CREATE INDEX artikel_monat_basis_betrieb
    ON mart.artikel_monat_basis (betrieb_key);

COMMENT ON MATERIALIZED VIEW mart.artikel_monat_basis IS
'Rechenstand von mart.artikel_monat, aufgefrischt im Sync-Nachlauf
(src/sync/round_table.ts). NICHT direkt abfragen — die Sicht darueber ist
die dokumentierte Schnittstelle.';

CREATE VIEW mart.artikel_monat AS
SELECT artikel_key, artikel, warengruppe, betrieb_key, betrieb, konzept,
       monat, menge, umsatz_netto, deckungsbeitrag, umsatz_mit_we,
       verkaufstage
  FROM mart.artikel_monat_basis;

COMMENT ON VIEW mart.artikel_monat IS
'Artikelverkauf je Artikel, Betrieb und Monat — die schnelle Grundlage des
Artikel-Drill-Downs. Gleiche Zahlen wie mart.artikelverkauf, nur verdichtet;
wer Tage braucht, liest weiter die Tagessicht. deckungsbeitrag und
umsatz_mit_we gehoeren zusammen: ein DB-Prozent rechnet gegen umsatz_mit_we,
nicht gegen den vollen Umsatz.';
