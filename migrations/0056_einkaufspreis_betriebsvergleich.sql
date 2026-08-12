-- =====================================================================
-- 0056 Einkaufspreis im Betriebsvergleich — die Excel, gefuellt
--
-- ANLASS (12.08.2026): die Erhebung "GFGH Q2 2026.xlsx" wollte je Betrieb
-- und Produkt einen Preis und daneben Durchschnitt, Hoechst- und
-- Tiefstpreis. Zurueck kamen 607 von 6.952 Zellen (8,7 Prozent). Die
-- Zahlen, nach denen gefragt wurde, stehen laengst in FoodNotify — nur
-- ohne die Achse, die die Frage stellt.
--
-- WAS ES SCHON GAB UND WARUM ES NICHT REICHT:
--   mart.einkaufspreis_monat (0041) gruppiert nach Ware, Marke, Einheit
--   und Monat. Kein Betrieb, kein Lieferant. Sie beantwortet "was kostet
--   diese Ware im Konzern", nicht "was zahlt DIESES Haus, und wie stehen
--   die anderen da". Genau das ist die Excel-Frage.
--
--   Diese Migration ergaenzt deshalb NUR die fehlende Achse. Basis,
--   Preisformel und Ausreisserbremse sind woertlich aus
--   mart.einkaufspreis_monat uebernommen — eine zweite, leicht andere
--   Preisdefinition waere der sichere Weg zu zwei Zahlen fuer dieselbe
--   Frage. Wer die Formel dort aendert, aendert sie hier mit.
--
-- ---------------------------------------------------------------------
-- WELCHER PREIS VERGLICHEN WIRD — UND WARUM NICHT DER GEBINDEPREIS
--
-- Nicht einzelpreis: nachgemessen am 12.08.2026 ueber bar-Positionen der
-- letzten zwoelf Monate traegt er Werte von 0,00 und bis zu MINUS 16,16
-- (Gutschriften und Korrekturen), und "H-Milch 3,5% 1L" streut von 0,00
-- bis 10,68. Eine Spanne, die groesstenteils aus Buchungsartefakten
-- besteht, ist als Preisvergleich wertlos.
--
-- ABER AUCH NICHT DER GEBINDEPREIS, und das ist der Unterschied zu
-- mart.einkaufspreis_monat (0041). Dort wird ueber EINE Ware ueber die
-- Zeit verglichen; da ist summe_preis/menge richtig, weil derselbe
-- Besteller dieselbe Gebindeeinheit bucht. Hier wird ueber BETRIEBE
-- verglichen, und dort bucht das eine Haus einen Karton als menge=1,
-- das andere sechs Flaschen als menge=6. Dieselbe Ware, dasselbe Geld,
-- Faktor 6 im Gebindepreis.
--
-- Die erste Fassung dieser Sicht rechnete mit dem Gebindepreis, und die
-- Trefferliste bestand aus genau diesem Artefakt: "Elka Orangensaft"
-- 67,02 gegen 11,17 (Faktor 6,00), "Grana Padano" 147,90 gegen 14,79
-- (Faktor 10,00), dazu ein Dutzend Zeilen mit exakt 500,0 Prozent
-- Abweichung. Saubere Vielfache sind der Fingerabdruck dieses Fehlers,
-- und die Faktor-20-Bremse aus 0041 faengt Faktor 6 nicht.
--
-- Verglichen wird deshalb summe_preis / gesamt_menge, der Preis je
-- BASISEINHEIT (Liter, Kilogramm, Stueck). Er normalisiert die
-- Verpackung weg. Nachgemessen ueber 979 Waren mit mindestens vier
-- Betrieben: der Median der Spanne ist bei beiden 1,03, aber ueber
-- Faktor 3 hinaus streuen 119 Waren beim Gebindepreis und nur 67 beim
-- Preis je Basiseinheit. Am Rand — dort, wo die Befunde entstehen — ist
-- die Basiseinheit messbar der bessere Massstab.
--
-- DER GEBINDEPREIS STEHT TROTZDEM DANEBEN, weil ein Einkaeufer in
-- Kartonpreisen denkt und nicht in Cent je Milliliter. Er ist zum Lesen
-- da, nicht zum Rechnen.
--
-- OFFEN UND GEMESSEN: gesamt_menge ist NICHT durchgaengig
-- menge * gebinde_menge — das stimmt nur in 162.519 von 633.652
-- Positionen (26 Prozent). Woher die Abweichung kommt, ist ungeklaert;
-- gefuellt ist die Spalte praktisch immer (2 Ausreisser). Solange das so
-- ist, traegt gebinde_uneinheitlich die Warnung je Zeile.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- Preis je Ware, Gebinde, Betrieb, Lieferant und Monat — mit Vergleich
--
-- MONAT IST EINE ACHSE UND KEIN ZIERAT. Der Bestand reicht bis 2020; ein
-- Vergleich ueber die ganze Historie stellt einen Preis von 2021 neben
-- einen von 2026 und nennt die Differenz "Abweichung". Wer ein Quartal
-- auswerten will, filtert auf die Monate — so wie die Excel es fuer
-- Q2 2026 wollte.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW mart.einkaufspreis_betrieb AS
WITH basis AS (
  /*
   * DIE PREISGROESSE KOMMT AUS core.bestellposition UND WIRD HIER NICHT
   * NEU GERECHNET. Migration 0042 hat preis_je_einheit genau dafuer
   * gebaut und entzieht sie dort, wo die Gesamtmenge nicht belastbar
   * ist (menge_unstimmig) — "FoodNotify meldet die Gebindegroesse
   * derselben Ware uneinheitlich".
   *
   * ES REICHT ABER NICHT, AUF preis_je_einheit IS NOT NULL ZU PRUEFEN.
   * Beide Bedingungen stehen hier, weil das Entziehen nicht haelt:
   * core.gebinde_vereinheitlichen() laeuft im Nachlauf VOR
   * core.preis_ausreisser_markieren() (sync/einkaufspreis.ts:37-40) und
   * schreibt preis_je_einheit neu, ohne bereits markierte Zeilen
   * auszunehmen (0040:77-82). Der Markierer fasst sie danach nicht mehr
   * an, denn er filtert "AND NOT p.menge_unstimmig" (0040:135). So
   * entsteht die Kombination markiert UND Preis vorhanden — gemessen am
   * 12.08.2026: 561 Positionen, nach einem weiteren Nachlauf 613.
   * NULL heisst also "geprueft und verworfen", NOT NULL heisst nicht
   * "geprueft und bestanden". Das Urteil steht in menge_unstimmig.
   *
   * Die erste Fassung dieser Sicht rechnete summe_preis/gesamt_menge
   * selbst und umging damit die Pruefung: 5.946 als unstimmig markierte
   * Positionen liefen wieder mit, und "Idee Entkoffeiniert 50 Pouches"
   * stand mit 48.400 EUR je Kilogramm in der Auswertung — genau der
   * Wert, dessentwegen 0042 ueberhaupt gebaut wurde. Wer eine gepruefte
   * Groesse nachrechnet, verliert die Pruefung.
   *
   * Kosten: 5.398 von 621.614 Positionen fallen weg, 99,1 Prozent
   * bleiben.
   */
  SELECT w.name                        AS ware,
         bp.einheit,
         k.betrieb_key,
         coalesce(g.dach_name, core.kreditor_name_norm(l.name)) AS lieferant,
         k.art                          AS bereich,
         date_trunc('month', b.bestellt_am)::date AS monat,
         bp.menge,
         bp.gebinde_menge,
         bp.gesamt_menge,
         bp.summe_preis,
         bp.preis_je_einheit,
         bp.summe_preis / bp.menge      AS preis_je_gebinde
    FROM core.bestellposition bp
    JOIN core.bestellung   b USING (bestellung_key)
    JOIN core.kostenstelle k USING (kostenstelle_key)
    JOIN core.ware         w ON w.ware_key = bp.ware_key
    LEFT JOIN core.lieferant l ON l.lieferant_key = b.lieferant_key
    LEFT JOIN manual.kreditor_gruppe g
           ON g.name_norm = core.kreditor_name_norm(l.name)
   WHERE b.bestellt_am IS NOT NULL
     AND bp.menge             > 0
     AND bp.summe_preis       > 0
     AND bp.preis_je_einheit IS NOT NULL
     AND NOT bp.menge_unstimmig
     AND b.status IS DISTINCT FROM 'canceled'
     AND k.betrieb_key IS NOT NULL
), je_betrieb AS (
  /*
   * KEIN bereich IM KORN. Er stand hier zuerst mit drin, und weil der
   * Massstab weiter unten die Zeilen dieser Ableitung zaehlt, ging ein
   * Haus, das dieselbe Ware ueber bar UND kueche bucht, zweimal in
   * betriebe_operativ ein. Gemessen: 50 Warengruppen erreichten die
   * Drei-Haeuser-Schwelle ausschliesslich dadurch. Der Bereich steht
   * jetzt als haeufigster Wert daneben, statt das Korn zu verfeinern.
   *
   * Der Lieferant ist ebenfalls raus: er zersplitterte das Haus ein
   * zweites Mal. Welche Lieferanten es waren, sagt lieferanten.
   */
  SELECT ware, einheit, betrieb_key, monat,
         mode() WITHIN GROUP (ORDER BY bereich)       AS bereich,
         string_agg(DISTINCT lieferant, ', ')         AS lieferanten,
         count(*)                                     AS bestellungen,
         sum(menge)                                   AS gebinde,
         sum(gesamt_menge)                            AS menge,
         sum(summe_preis)                             AS ausgaben,
         mode() WITHIN GROUP (ORDER BY gebinde_menge) AS gebinde_typisch,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY preis_je_einheit::float8)::numeric AS preis,
         min(preis_je_einheit)                        AS preis_min,
         max(preis_je_einheit)                        AS preis_max,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY preis_je_gebinde::float8)::numeric AS preis_je_gebinde
    FROM basis
   GROUP BY ware, einheit, betrieb_key, monat
), vergleich AS (
  /*
   * Der Massstab: der Median DER HAUSPREISE, jedes Haus einmal, gebildet
   * nur aus operativen Haeusern. Ein geschlossenes Haus soll den Preis
   * nicht mitbestimmen, an dem sich ein offenes messen lassen muss; seine
   * Zeile bleibt aber stehen und bekommt ihre Abweichung (Falle 12 — die
   * Sicht filtert nicht, sie kennzeichnet).
   *
   * DIE MENGENSPERRE, dritter Anlauf und diesmal am Fingerabdruck des
   * Fehlers statt an einer Zahlenform:
   *
   * Buchen zwei Haeuser dieselbe Lieferung verschieden — das eine zaehlt
   * Kartons, das andere Liter —, dann ist der GEBINDEPREIS bei beiden
   * gleich und nur der Preis je Basiseinheit laeuft auseinander.
   * "Captain Morgan Dark Rum 12x1l": jedes Haus zahlt exakt 147,84 EUR
   * je Gebinde, die Basiseinheit streut von 1,03 bis 12,32, und die
   * Sicht meldete +84,6 Prozent fuer die einen und -84,6 fuer die
   * anderen.
   *
   * Ein echter Preisunterschied bewegt BEIDE Groessen gleich. Deshalb
   * werden die beiden Spreizungen verglichen: laeuft die Basiseinheit
   * deutlich weiter auseinander als das Gebinde, liegt es an der Menge
   * und nicht am Preis.
   *
   * Zwei Vorgaenger sind daran gescheitert: eine Faktor-20-Bremse (faengt
   * Faktor 6 nicht) und eine Pruefung auf ganzzahlige Vielfache (prueft
   * nur die teure Richtung und versagt, sobald der Median zwischen zwei
   * Mengen-Clustern liegt — dort war kein Quotient ganzzahlig).
   */
  SELECT ware, einheit, monat,
         count(*) FILTER (WHERE operativ)              AS betriebe_operativ,
         count(*)                                      AS betriebe_gesamt,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY CASE WHEN operativ THEN preis END::float8)::numeric AS median_preis,
         min(preis) FILTER (WHERE operativ)            AS bester_preis,
         max(preis) FILTER (WHERE operativ)            AS schlechtester_preis,
         (count(DISTINCT gebinde_typisch) > 1)         AS gebinde_uneinheitlich,
         coalesce(
           max(preis) / nullif(min(preis), 0)
             > 1.5 * (max(preis_je_gebinde) / nullif(min(preis_je_gebinde), 0)),
           false)                                      AS menge_widerspruechlich,
         /*
          * Und die stumpfe Grenze zum Schluss, weil die drei feinen
          * Sperren davor je eine Artefaktklasse fangen und die naechste
          * durchlassen: liegen die Haeuser um mehr als Faktor 3
          * auseinander, ist das kein Preisunterschied.
          *
          * Bei derselben Ware, derselben Einheit und demselben Monat gibt
          * es keinen Einkauf, der das Dreifache kostet — es gibt eine
          * anders gebuchte Menge. Nachgemessen am 12.08.2026 kostet die
          * Grenze 96 von 17.748 Warengruppen, also ein halbes Prozent,
          * und raeumt die 300-, 500- und 700-Prozent-Zeilen ab, die alle
          * vorherigen Fassungen ganz oben stehen hatten.
          *
          * SIE UNTERDRUECKT AUCH ECHTE FAELLE. Wer wirklich das
          * Vierfache zahlt, faellt heraus. Der Tausch ist bewusst: eine
          * erfundene 700-Prozent-Meldung verbrennt die Auswertung, ein
          * uebersehener Extremfall nicht — und er faellt im Einkauf
          * ohnehin auf.
          */
         coalesce(
           max(preis) FILTER (WHERE operativ)
             / nullif(min(preis) FILTER (WHERE operativ), 0) > 3,
           false)                                      AS spreizung_zu_gross
    FROM (SELECT jb.*, (st.status = 'operativ') AS operativ
            FROM je_betrieb jb
            LEFT JOIN mart.betrieb_status st ON st.betrieb_key = jb.betrieb_key) x
   GROUP BY ware, einheit, monat
)
SELECT jb.betrieb_key,
       b.name          AS betrieb,
       kz.hauptkonzept AS konzept,
       st.status       AS betrieb_status,
       (st.status = 'operativ') AS operativ,
       jb.monat,
       jb.ware,
       jb.einheit,
       jb.bereich,
       jb.lieferanten,
       jb.bestellungen,
       jb.gebinde,
       jb.menge,
       round(jb.ausgaben, 2)          AS ausgaben,
       round(jb.preis, 4)             AS preis,
       round(jb.preis_min, 4)         AS preis_min,
       round(jb.preis_max, 4)         AS preis_max,
       round(jb.preis_je_gebinde, 2)  AS preis_je_gebinde,
       v.betriebe_operativ,
       v.betriebe_gesamt,
       v.gebinde_uneinheitlich,
       v.menge_widerspruechlich,
       v.spreizung_zu_gross,
       round(v.median_preis, 4)        AS konzern_median,
       round(v.bester_preis, 4)        AS konzern_bester,
       round(v.schlechtester_preis, 4) AS konzern_schlechtester,
       (v.betriebe_operativ >= 3
        AND NOT v.gebinde_uneinheitlich
        AND NOT v.menge_widerspruechlich
        AND NOT v.spreizung_zu_gross)     AS vergleichbar,
       CASE WHEN v.betriebe_operativ >= 3
             AND NOT v.gebinde_uneinheitlich
             AND NOT v.menge_widerspruechlich
             AND NOT v.spreizung_zu_gross
             AND v.median_preis > 0
            THEN round(100 * (jb.preis / v.median_preis - 1), 1)
       END                             AS abweichung_pct,
       -- Mehrkosten auf der BASISEINHEIT gerechnet, also mal gesamt_menge
       -- und nicht mal Gebindezahl: (EUR/Einheit - EUR/Einheit) * Einheiten.
       CASE WHEN v.betriebe_operativ >= 3
             AND NOT v.gebinde_uneinheitlich
             AND NOT v.menge_widerspruechlich
             AND NOT v.spreizung_zu_gross
             AND v.median_preis > 0
            THEN round((jb.preis - v.median_preis) * jb.menge, 2)
       END                             AS mehrkosten
  FROM je_betrieb jb
  JOIN vergleich v USING (ware, einheit, monat)
  JOIN core.betrieb b                 ON b.betrieb_key  = jb.betrieb_key
  LEFT JOIN mart.konzept_zuordnung kz ON kz.betrieb_key = jb.betrieb_key
  LEFT JOIN mart.betrieb_status    st ON st.betrieb_key = jb.betrieb_key;

COMMENT ON VIEW mart.einkaufspreis_betrieb IS
'Was JEDES Haus fuer eine Ware zahlt, mit dem Konzernmassstab daneben — die Auswertung,
die "GFGH Q2 2026.xlsx" von den Betrieben erfragen wollte und die zu 8,7 Prozent
zurueckkam. Eine Zeile je Ware, Einheit, Betrieb und Monat.

IMMER AUF vergleichbar = true FILTERN. Ohne diesen Filter stehen Mengenartefakte als
Preisbefunde da, und zwar die spektakulaersten zuoberst. Die Sicht rechnet abweichung_pct
und mehrkosten deshalb nur, wo vergleichbar gilt; wer die Rohspalten selbst verrechnet,
umgeht die Sperren.

DIE PREISGROESSE IST core.bestellposition.preis_je_einheit AUS 0042 und wird hier NICHT
nachgerechnet. Eine frueher hier selbst gerechnete Fassung umging die Pruefung und brachte
"Idee Entkoffeiniert" mit 48.400 EUR je Kilogramm zurueck — den Wert, dessentwegen 0042
gebaut wurde.

GEPRUEFT WIRD GEGEN menge_unstimmig, NICHT GEGEN NULL. Der entzogene Preis kommt wieder:
der Nachlauf ruft core.gebinde_vereinheitlichen() VOR core.preis_ausreisser_markieren()
auf, der erste schreibt preis_je_einheit ohne Ruecksicht auf die Markierung neu, der zweite
fasst markierte Zeilen nicht mehr an. Gemessen am 12.08.2026 tragen 561 markierte
Positionen wieder einen Preis. Deshalb stehen beide Bedingungen im WHERE. Kosten der
Pruefung: 5.398 von 621.614 Positionen ueber NULL, 561 weitere ueber die Markierung —
99,0 Prozent bleiben.

WAS AUCH DANACH DRINBLEIBT, UND WARUM ES TROTZDEM NICHT LUEGT: ein Preis, der in ALLEN
Haeusern gleich falsch ist, ueberlebt beide Pruefungen. "Idee Entkoffeiniert 50 Pouches
A 7G" steht im Februar 2026 in drei Haeusern bei 48.400 EUR je Kilogramm — 0040 markiert
nichts, weil der Median derselben Ware genauso hoch liegt und ihn nichts widerlegt. In
dieser Sicht ist die Zeile dann abweichung_pct = 0,0 und mehrkosten = 0: die Spalte preis
ist Unsinn, der Befund ist keiner. Die Sicht prueft ABWEICHUNGEN, nicht absolute
Plausibilitaet — wo alle gleich falsch buchen, gibt es keine Referenz, die widerspricht.
Wer absolute Preise lesen will, nimmt nicht diese Sicht.
DER GEBINDEPREIS STEHT DANEBEN, weil ein Einkaeufer in Kartonpreisen denkt. Er ist zum
Lesen da, nicht zum Rechnen — verglichen wird die Basiseinheit.

VIER SPERREN, jede setzt vergleichbar = false:
  betriebe_operativ < 3      — unter drei Haeusern ist der "Median" nur der andere Betrieb.
  gebinde_uneinheitlich      — die Haeuser buchen verschiedene Gebindegroessen.
  menge_widerspruechlich     — die Basiseinheit streut deutlich weiter als der Gebindepreis.
                               Das ist der Fingerabdruck einer Mengenbuchung, nicht eines
                               Preises: bei "Captain Morgan Dark Rum 12x1l" zahlt jedes
                               Haus exakt 147,84 EUR je Gebinde, waehrend die Basiseinheit
                               von 1,03 bis 12,32 laeuft. Ein echter Preisunterschied
                               bewegt beide Groessen gleich.
  spreizung_zu_gross         — die operativen Haeuser liegen um mehr als Faktor 3
                               auseinander. Bei gleicher Ware, Einheit und Monat gibt es
                               keinen Einkauf, der das Dreifache kostet; es gibt eine
                               anders gebuchte Menge. Kostet 96 von 17.748 Warengruppen.

WAS DIE VIER SPERREN NICHT LEISTEN: dicht unter der Dreifach-Grenze stehen weiter Zeilen
mit auffaellig glatten Faktoren (150,0 und 200,0 Prozent, also 2,5x und 3x). Die sind
wahrscheinlich ebenfalls Mengenartefakte. Belastbar ist diese Sicht im Bereich, in dem
Einkaufsbefunde tatsaechlich liegen — einstellige bis niedrige zweistellige Prozentwerte.
Wer eine dreistellige Abweichung sieht, prueft sie am Beleg, bevor er sie weitergibt.

DER MASSSTAB IST DER MEDIAN DER HAUSPREISE, nicht der aller Positionen: jedes Haus zaehlt
einmal, sonst bestimmt der groesste Besteller den Wert, gegen den alle gemessen werden.
Gebildet wird er NUR aus operativen Haeusern. Die Zeilen geschlossener Haeuser bleiben
stehen und bekommen ihre Abweichung — die Sicht filtert nicht, sie kennzeichnet (Falle 12).

bereich UND lieferanten SIND ANZEIGE, NICHT KORN. Beide standen einmal im GROUP BY und
zersplitterten damit das Haus: wer dieselbe Ware ueber bar und kueche bucht, zaehlte
zweimal in betriebe_operativ, und 50 Warengruppen erreichten die Drei-Haeuser-Schwelle
allein dadurch. Jetzt steht der haeufigste Bereich daneben und die Lieferanten als Liste.

GRUPPIERT UEBER DEN WARENNAMEN. FoodNotify vergibt je Betrieb eigene Waren-IDs, der Name
ist die einzige Bruecke. Zwei Haeuser, die dieselbe Ware verschieden schreiben, finden
NICHT zusammen und stehen als zwei Waren mit je einem Betrieb da — sichtbar an
betriebe_operativ = 1. Untererfassung des Vergleichs, nie falsche Zusammenfuehrung.
Der Lieferant dagegen laeuft ueber dieselbe Achse wie mart.fremdeinkauf (0055):
manual.kreditor_gruppe, ersatzweise core.kreditor_name_norm.

NUR FOODNOTIFY. Was am Bestellsystem vorbei gekauft wurde, hat hier keine Zeile — fuer die
Frage "zahle ich zu viel" ist das richtig, denn verhandelte Preise gibt es nur bei
freigegebenen Lieferanten. Wer wissen will, WO eingekauft wurde, nimmt mart.fremdeinkauf.';

COMMENT ON COLUMN mart.einkaufspreis_betrieb.preis IS
'Median der Preise JE BASISEINHEIT (Liter, Kilogramm, Stueck) dieses Hauses fuer diese Ware
in diesem Monat, aus core.bestellposition.preis_je_einheit. Median und nicht Mittelwert:
eine einzelne Fehlbuchung soll den Hauspreis nicht verschieben.';
COMMENT ON COLUMN mart.einkaufspreis_betrieb.preis_je_gebinde IS
'Was ein Karton gekostet hat — zum Lesen, nicht zum Vergleichen. Ueber Betriebe hinweg
traegt er nicht, weil das eine Haus einen Karton als menge=1 bucht und das andere sechs
Flaschen als menge=6.';
COMMENT ON COLUMN mart.einkaufspreis_betrieb.konzern_median IS
'Median ueber die Hauspreise der OPERATIVEN Betriebe. NULL, wenn kein operatives Haus diese
Ware in diesem Monat gekauft hat — dann ist auch abweichung_pct NULL.';
COMMENT ON COLUMN mart.einkaufspreis_betrieb.abweichung_pct IS
'Prozentzahl (12.4 heisst zwoelf Komma vier Prozent teurer, nie 0.124 — Hausregel 6).
Positiv heisst teurer. NULL, solange vergleichbar = false.';
COMMENT ON COLUMN mart.einkaufspreis_betrieb.menge_widerspruechlich IS
'true, wenn die Preise je Basiseinheit ueber die Haeuser deutlich weiter streuen als die
Gebindepreise. Dann liegt der Unterschied an der Mengenbuchung und nicht am Preis. Nie
NULL — coalesce ist Absicht, damit WHERE NOT menge_widerspruechlich keine Zeile still
verliert.';
COMMENT ON COLUMN mart.einkaufspreis_betrieb.vergleichbar IS
'true nur, wenn drei operative Haeuser dieselbe Ware im selben Monat gekauft haben UND
beide Mengensperren schweigen. Wer die Spalte ignoriert, vergleicht Buchungsgewohnheiten
statt Preise.';
