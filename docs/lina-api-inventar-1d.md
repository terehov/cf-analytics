# LINA API Inventory — Nachtrag Phase 1d (Kassendaten, Phase 0)

**Erhebungsdatum:** 22.09.2026 · **Methode:** Claude im angemeldeten Browser des Nutzers, nur
lesend, Betrieb Wilma Wunder Düsseldorf (`encId bc58d22fa71a45f4393bb60eff910afe4431c6d0`),
Zeitraum August 2026, dazu Stichproben gegen den umsatzstärksten Betrieb (Wirtshaus am
Schlossplatz). Auftrag war Phase 0 aus [`plan-lina-kassendaten.md`](plan-lina-kassendaten.md).
Rohantworten liegen im Scratchpad der Sitzung, drei anonymisierte Beispiele unter
`docs/payloads/`. Screenshots unter `docs/lina-screenshots/2026-09-22/`.

**Wichtigster Befund vorweg:** [`lina-api-korrekturen.md`](lina-api-korrekturen.md),
KORREKTUR 7 — der bisher dokumentierte Endpunkt für die 72 Betriebsberichte
(`/finanzen/analytics/getReport?storeId=`) ist **falsch**. Er antwortet mit `200`, liefert
aber für jeden Betrieb und jeden Zeitraum leere Daten. Der echte Endpunkt heißt
`/intranet/storeanalytics/getReport` mit dem Parameter `laden=<encId>`. Alles unten Stehende
nutzt den korrigierten Endpunkt.

---

## A1 — Der vollständige Berichtskatalog (72 von 72)

```
GET /intranet/storeanalytics/reportList?laden=<encId>
```

Antwort: ein Baum aus `folder`- und `report`-Knoten, `id`/`name`/`route`/`date_select` je
Blatt. **Exakt 72 Blattknoten**, in 8 Ordnern plus 7 Direktberichte, bestätigt gegen die
Zählung aus `lina-api-inventar-1b.md`. Vollständige Rohantwort im Scratchpad
(`reportList.json`, 29.318 Byte), Ausschnitt unter `docs/payloads/reportList-ausschnitt.json`.

| ID | Bericht | Gruppe | Route | Zeitraster |
|---|---|---|---|---|
| 102 | Die letzten Tage | (direkt) | `vue:LastDays` | custom |
| 117 | Die letzten Jahre | (direkt) | `vue:LastYears` | month |
| 20 | Tagesverlauf | (direkt) | `vue:PerDay` | custom |
| 103 | Tagesanalyse | (direkt) | `vue:AnalyzeDay` | custom |
| 104 | Wetteranalyse | (direkt) | `vue:AnalyzeWeather` | custom |
| 2 | BWA Jahresübersicht | (direkt) | `finanzen/bwa/auswertung` | year |
| 3 | BWA monatlich | (direkt) | `finanzen/bwa/auswertungsingle` | month |
| 116 | Auffällige Buchungen | LINA AI Reports | `vue:AnomalieDetection` | custom |
| 5 | Umsatzentwicklung | Jahresbezogene Auswertungen | `vue:Entwicklung` | year |
| 6 | Kostenaufteilung | Jahresbezogene Auswertungen | `vue:Kosten` | year |
| 7 | Wareneinsätze | Jahresbezogene Auswertungen | `vue:Wareneinsatz` | year |
| 8 | Personalkosten | Jahresbezogene Auswertungen | `vue:Persokosten` | year |
| 9 | Urlaubsverteilung | Jahresbezogene Auswertungen | `vue:Urlaubsverteilung` | year |
| 107 | Gearbeitete Stunden | Monatsbezogene Auswertungen | `vue:HoursWorked` | month |
| 118 | Wareneinsatz und Deckungsbeitrag | Monatsbezogene Auswertungen | `vue:Deckungsbeitrag` | custom |
| 23 | Personalkostenschätzung | Monatsbezogene Auswertungen | `vue:Persok` | month |
| 18 | Ranking | Monatsbezogene Auswertungen | `finanzen/report/ranking` | month |
| 24 | Personalrechner | Monatsbezogene Auswertungen | `finanzen/stat/personalk2` | month |
| 12 | Gutscheinumsatz | Monatsbezogene Auswertungen | `finanzen/report/token` | month |
| 13 | Reservierungen | Monatsbezogene Auswertungen | `vue:Resdashboard` | month |
| 27 | Artikelverkaufsbericht | Artikelbezogen | `finanzen/kassereport/prev/cat/artikel/kind/Renner` | custom |
| 29 | Artikelverkaufsbericht nach Betriebsstelle | Artikelbezogen | `…/artikel/kind/Betriebsstellen` | custom |
| 30 | Artikelverkaufsbericht nach Feinsparte | Artikelbezogen | `…/artikel/kind/ArticleFeinsparten` | custom |
| 31 | Artikelverkaufsbericht nach Meccode | Artikelbezogen | `…/artikel/kind/ArticleMecCodes` | custom |
| 32 | Artikelverkaufsbericht nach Steuersatz | Artikelbezogen | `…/artikel/kind/ArtikelVat` | custom |
| 33 | Artikelverkaufsbericht nach Verkaufspreis | Artikelbezogen | `…/artikel/kind/Preis` | custom |
| 34 | Artikelverkaufsbericht nach Verkaufsstelle | Artikelbezogen | `…/artikel/kind/Verkaufsstelle` | custom |
| 38 | Stornobericht | Artikelbezogen | `…/artikel/kind/Storno` | custom |
| 39 | Stornogrundbericht | Artikelbezogen | `…/artikel/kind/CancelReason` | custom |
| 42 | Umsatz nach Feinsparten | Artikelbezogen | `…/artikel/kind/UmsatzFeinsparten` | custom |
| 43 | Umsatz nach Hauptsparten | Artikelbezogen | `…/artikel/kind/UmsatzHauptsparte` | custom |
| 105 | Umsatz nach Hauptsparten und Steuern | Artikelbezogen | `…/artikel/kind/UmsatzHauptsparteSteuer` | custom |
| 44 | Umsatz nach Hauptsparten pro Wochentag | Artikelbezogen | `…/artikel/kind/Hauptspwochentage` | custom |
| 110 | Umsatz nach Hauptsparten, Steuern und Verkaufsstellen | Artikelbezogen | `…/artikel/kind/UmsatzHsVatSituation` | custom |
| 45 | Artikelverkaufsbericht nach Hauptsparte | Artikelbezogen | `…/artikel/kind/UmsatzHauptart` | custom |
| 46 | Umsatz nach Meccodes | Artikelbezogen | `…/artikel/kind/UmsatzMecCode` | custom |
| 47 | Umsatz nach Mecgruppen | Artikelbezogen | `…/artikel/kind/UmsatzMecGruppe` | custom |
| 48 | Umsatz nach Sparten | Artikelbezogen | `…/artikel/kind/UmsatzSparten` | custom |
| 49 | Umsatz nach Steuer und Feinsparten | Artikelbezogen | `…/artikel/kind/UmsatzsteuerFeinsparten` | custom |
| 53 | Artikelbericht pro Kellner | Kellnerbezogen | `…/kellner/kind/Rp` | custom |
| 54 | Einzelbericht Kellner nach Feinsparten | Kellnerbezogen | `…/kellner/kind/Einzel` | custom |
| **55** | **Finanzwege artikelgenau** | Kellnerbezogen | `…/kellner/kind/FinanzArtikel` | custom |
| **56** | **Finanzwege pro Kellner** | Kellnerbezogen | `…/kellner/kind/Finanz` | custom |
| 57 | Gutschriften pro Kellner | Kellnerbezogen | `…/kellner/kind/Gutschriften` | custom |
| 58 | Stornobericht pro Kellner | Kellnerbezogen | `…/kellner/kind/Storno` | custom |
| 59 | Tischübergabe pro Kellner | Kellnerbezogen | `…/kellner/kind/Uebergabe` | custom |
| 60 | Umsatz pro Kellner | Kellnerbezogen | `…/kellner/kind/Umsatz` | custom |
| 61 | Umsatz pro Kellner pro Tag | Kellnerbezogen | `…/kellner/kind/UmsatzTag` | custom |
| 64 | Aktionsreport | Betriebswirtschaftliche Reports | `…/betrieb/kind/AktionsReport` | custom |
| 68 | Umsatz nach Betriebsstellen | Betriebswirtschaftliche Reports | `…/betrieb/kind/Betriebsstellen` | custom |
| 69 | Umsatz nach Betriebsstellen und Hauptsparten | Betriebswirtschaftliche Reports | `…/betrieb/kind/BetriebsstellenHs` | custom |
| 70 | Umsatz nach Tischen | Betriebswirtschaftliche Reports | `…/betrieb/kind/Tische` | custom |
| 71 | Umsatz nach Verkaufsstelle und Hauptsparte | Betriebswirtschaftliche Reports | `…/betrieb/kind/VerkaufsstelleHs` | custom |
| 112 | Umsatz nach Verkaufsstelle | Betriebswirtschaftliche Reports | `…/betrieb/kind/Verkaufsstelle` | custom |
| 73 | Zeitzonenbericht | Betriebswirtschaftliche Reports | `…/betrieb/kind/Zeitzone` | custom |
| 74 | Zeitzonenbericht vordefinierte Zeitzonen | Betriebswirtschaftliche Reports | `…/betrieb/kind/ZeitzonenSp` | custom |
| 75 | Zeitzonenbericht Feinsparten vordefinierte Zeitzonen | Betriebswirtschaftliche Reports | `…/betrieb/kind/ZeitzonenspFeinsparte` | custom |
| 76 | Zeitzonenbericht Hauptsparten vordefinierte Zeitzonen | Betriebswirtschaftliche Reports | `…/betrieb/kind/ZeitzonenspHauptsparten` | custom |
| 81 | Gutscheine im Umlauf | Listen und Tabellen | `…/listen/kind/GutscheineUmlauf` | custom |
| 82 | Gutscheintransaktionen | Listen und Tabellen | `…/listen/kind/Gutscheine` | custom |
| 86 | Debitorenauswertung | Buchhalterische Reports | `…/buch/kind/Debitor` | custom |
| 114 | Mitarbeiter Verpflegung / Kost-Sach-Bezug | Buchhalterische Reports | `…/buch/kind/EmployeeMeals` | custom |
| 87 | Erweiterter Tagesabschluss | Buchhalterische Reports | `…/buch/kind/Erweitert` | custom |
| **88** | **Finanzwege** | Buchhalterische Reports | `…/buch/kind/Finanz` | custom |
| **111** | **Finanzwege pro Terminal** | Buchhalterische Reports | `…/buch/kind/FinanzTerminal` | custom |
| 90 | Monatsaufstellung Tag für Tag | Buchhalterische Reports | `…/buch/kind/TagFuerTag` | custom |
| **92** | **Rabattbericht** | Buchhalterische Reports | `…/buch/kind/Hausbon` | custom |
| 113 | Tischtransfer | Buchhalterische Reports | `…/buch/kind/TableTransfer` | custom |
| 96 | Rechnungsausgangsbuch | Buchhalterische Reports | `…/buch/kind/Rechnungen` | custom |
| **97** | **Tagesabschluss** | Buchhalterische Reports | `…/buch/kind/Tagesabschl` | custom |
| **99** | **Unbare Zahlungen nach Betriebsstelle** | Buchhalterische Reports | `…/buch/kind/FinanzSite` | custom |
| 108 | Verkaufszahlen | Buchhalterische Reports | `…/buch/kind/Verkaufszahlen` | month |

Die Gruppengrößen ergeben jetzt 72 statt der zuvor kolportierten 69 aus `lina-api-inventar-1b.md`
— der Unterschied lag an den zwei „direkten" Reports 102/117, die 1b nicht mitgezählt hatte,
und am vollständigen Kellnerbezogen-Ordner (9 statt 8 wegen `55`).

---

## A2 — Finanzwege, August 2026: die Glücksrad-Frage ist beantwortet

```
GET /intranet/storeanalytics/getReport?report=88&von=1.8.2026&bis=31.8.2026&reltime=custom&interval=8&laden=<encId>
```

Spalten (`tableHead`): `Nummer`, `Finanzweg`, `Finanzgruppe`, `Umsatz`, `Anzahl`.
Wilma Wunder Düsseldorf, August 2026, `nBillsGesamt: 12186`, `balanceSumBrutto: 369.841,09`
(deckt sich exakt mit `getUmsatzbericht.stores[].umsatzBrutto` für denselben Betrieb/Monat).

Auszug der Zeilen (voll unter `docs/payloads/getReport-finanzwege-88.json`):

| Nummer | Finanzweg | Finanzgruppe | Umsatz | Anzahl |
|---|---|---|---|---|
| 1 | Boniert | Umsatz | 390.379,15 | 76.453 |
| 10 | Sofortstorno | Umsatz | −20.742,28 | 3.124 |
| 41 | EC-Karte | Unbar | −135.041,66 | 3.783 |
| 20 | Bar gegeben | Bargeld | −86.374,99 | 3.763 |
| **3168** | **25% Glücksrad** | Hausbon | **−109,50** | **31** |
| **3500** | **10% Glücksrad** | Hausbon | **−6,55** | **4** |
| **3501** | **25% Glücksrad'** | Hausbon | **−232,74** | **66** |
| **3502** | **50% Glücksrad** | Hausbon | **−4.281,50** | **600** |

**Die Hypothese aus dem Plan stimmt nur zur Hälfte** (korrigiert am selben Tag, siehe
„A3a"): Concept Family bucht die Glücksrad-Nachlässe als Finanzweg der **Finanzgruppe
Hausbon**. ~~nicht über den Rabattbericht~~: der Rabattbericht (92, Route `…/kind/Hausbon`)
ist genau die Artikelaufschlüsselung dieser Hausbon-Finanzwege. Die drei erwarteten Nummern 3500/3501/3502 sind da,
mit Werten. **Nebenbefund, nicht im Plan erwartet:** Es gibt eine **vierte**, ältere Zeile
`3168 „25% Glücksrad"` — derselbe Name wie `3501`, aber eine andere Finanzwege-Nummer, mit
eigenem Umsatz und eigener Anzahl. Für Wilma Wunder Düsseldorf im August liefen 31 Vorgänge
über `3168` und 66 über `3501` — wer nur nach `3500/3501/3502` filtert, verliert diese 31.
Wahrscheinlich wurde der 25 %-Weg einmal neu angelegt (Apostroph im Namen von `3501`,
`3168` ohne), ohne den alten zu deaktivieren. **Für Phase 6 des Kassendaten-Plans (`core.finanzweg`)
heißt das: die Zuordnung „welche Nummer ist Glücksrad" muss über den **Namen** laufen
(`LIKE '%Glücksrad%'`), nicht über eine feste Nummernliste.**

**`Rabattbericht (92)` ist entgegen KORREKTUR 3/„Offen geblieben: Stornotyp" NICHT leer.**
Mit dem korrigierten Endpunkt liefert er für denselben Betrieb/Monat 243 KB echte Zeilen, z. B.
`„100% auf Haus"`, Brutto −141,00 €, Anzahl 41. Die frühere Beobachtung „leer" war ein
Artefakt des falschen Endpunkts (KORREKTUR 7), nicht ein Befund über die Datenlage.
~~**Eine echte, unerwartete Erkenntnis bleibt trotzdem:** Rabatt UND Finanzwege tragen beide
Nachlassdaten, aber unterschiedliche — der Rabattbericht zeigt „100% auf Haus" (Personalverzehr/
Einladungen), die Finanzwege-Glücksrad-Zeilen NICHT. Es sind zwei getrennte Buchungswege für
zwei getrennte Sachverhalte, kein Duplikat.~~ **Falsch, nachgemessen am 22.09.2026:** der
Rabattbericht führt alle vier Glücksrad-Finanzwege als Gruppe, mit Artikelzeilen darunter.
Er ist kein getrennter Buchungsweg, sondern dieselben Hausbon-Finanzwege je Artikel. Siehe A3a.

---

## A3a — Artikel × Finanzweg: der Rabattbericht (92) liefert es (nachgemessen 22.09.2026)

Der Rabattbericht ist die gesuchte Kreuzung. Jede Gruppe ist ein **Finanzweg der Finanzgruppe
Hausbon** (Kopfzeile: `Artikel = null`, Summe), darunter je Artikel `Anzahl`, `Brutto`, `Netto`.
`Brutto`/`Netto` sind der **gewährte Nachlass** (negativ), nicht der Verkaufspreis. Die
Artikelzeilen tragen **nur den Namen, keine Artikelnummer**: die Zuordnung zu
`core.artikel` läuft über den Namen, und das ist die Stelle, an der sie brechen kann.

Gegenprobe Wilma Wunder Düsseldorf, August 2026: die Gruppensummen treffen Bericht 88 auf den
Cent: `50% Glücksrad` −4.281,50 €, `25% Glücksrad'` −232,74 €, `10% Glücksrad` −6,55 €,
`25% Glücksrad` −109,50 €. Die Summe der Artikelzeilen trifft die Kopfzeile in allen 13 Gruppen.
**Die `Anzahl` unterscheidet sich zwischen den Berichten**, und das ist erwartet: in 88 zählt sie
Vorgänge (600 bei 50 %), in 92 Artikel (712 bei 50 %).

Alle 18 Einträge mit „Wilma" im Namen abgerufen (18 Aufrufe, 1,5 s Abstand): 13 mit Daten, die
übrigen (zwei geschlossene, Management, Beteiligungs AG, KUZ Mainz) leer. **Der 14. Betrieb heißt
in LINA nicht „Wilma":** Wilma Wunder Markt Mainz steht als `Gastronomie am Markt Mainz GmbH`
darin, gefunden über die Artikelnummern in `core.artikelverkauf_tag`, nicht über den Namen.
Wer Wilma-Wunder-Betriebe über den Namen sucht, verliert ihn. Summe August 2026, 14 Betriebe,
alle Artikel: **10 %: 149 Stück, 25 % (beide Nummern): 1.413, 50 %: 7.335.** Durchstarter:
12 / 107 / 432 = **551 von 5.183**. Der Glücksrad-Nachlass gilt für den **ganzen Bon**: 327 verschiedene
Artikel tragen ihn, auch Getränke. Von den 51 Artikeln der Aktionsliste finden sich 50 per Name
wieder; `1220013 Meenzer Teller` lief im August nie über das Glücksrad.

Auswertung für den Fachbereich: `docs/gluecksrad-august-2026-finanzwege.xlsx`.

Weitere Gruppen im selben Bericht (Düsseldorf): `100% auf Haus`, `100% intern`, `Bruch`,
`50% Perso`, `NeoTaste`, `Los Gutschein`, `25% Los-Gutschein`, `50% Gewinnspiel`, `Freachly 20%`.
Damit sind Personalverzehr, Bruch, Einladungen und jede künftige Aktion dieser Bauart je Artikel
aus **einem** Aufruf je Betrieb und Monat zu haben.

---

## A3 — Artikelfilter

Der Filter-Bereich des Report Centers bietet: **Artikelfilter, Feinspartenfilter,
Kellnerfilter, Tischfilter, Betriebsstellenfilter, Verkaufsstellenfilter, Wochentagsfilter**,
dazu ein Intervall-Feld. Aus der Netzwerkspur des UI-Klicks (Bericht „Die letzten Tage" mit
Artikelfilter „Durchstarter"):

```
GET /intranet/storeanalytics/getLastDays?report=102&…&laden=<encId>&filterart=Durchstarter
```

**Der Parametername für den Artikelfilter ist `filterart`.**

**Aber: reiner Freitext filtert nicht.** `filterart=Durchstarter` direkt gegen
`getReport?report=88` und `report=27` gesetzt lieferte **exakt dieselben** Werte wie ohne
Filter (`nBillsGesamt`, `balanceSumBrutto` und Zeilenzahl identisch, Byte für Byte
nachvollzogen). Die UI-Combobox bietet vermutlich eine Autocomplete-Liste, aus der ein
Eintrag mit einer internen Artikel-ID ausgewählt werden muss — reiner Text im Feld wird vom
Server offenbar ignoriert oder verlangt ein anderes Format (z. B. die Artikelnummer statt des
Namens). **Ungetestet, da die Autocomplete-Interaktion im Agentenbrowser nicht zuverlässig
auslösbar war** (die Report-Auswahl-Combobox im selben Panel reagierte über mehrere Versuche
inkonsistent auf Tastatureingaben). K4 aus dem Plan („Finanzwege gefiltert auf einen Artikel")
ist damit **nicht geklärt** — weder bestätigt noch widerlegt.

**Report 55 „Finanzwege artikelgenau" beantwortet die Glücksrad-Frage NICHT, auch mit
funktionierendem Filter nicht.** Trotz des Namens kreuzt dieser Bericht Artikel nicht mit
Zahlungsart: die Spalte `Finanzwege` enthält je Artikelzeile eine verkettete Zeichenkette aus
Bon-**Ereignissen** (`„TischübergabeTischübernahme"`, `„Bar gegeben"`, `„Bar gegebenRückgeld"`),
nicht die Zahlungsart im Sinne von Report 88. In den 6.685 Zeilen des Berichts für Wilma Wunder
Düsseldorf/August kommt „Glücksrad" **kein einziges Mal** vor — 13 Zeilen enthalten
„Durchstarter", keine davon mit einem Glücksrad-Ereignis in der Spalte. **Für die Frage
„wie viele Durchstarter liefen über 50 % Glücksrad" bringt dieser Bericht nichts**, egal ob
der Filter funktioniert.

**Folgerung für den Plan:** K4 ist als Weg zur Glücksrad-Frage vermutlich eine Sackgasse
(Bericht 55 kreuzt das Falsche, und selbst ein korrekt gesetzter Artikelfilter auf 88 würde
nur „Umsatz aller Finanzwege für Bons mit diesem Artikel" liefern, nicht „Menge dieses Artikels
je Finanzweg" — dieselbe Ungenauigkeit, die der Plan unter Phase 3 als offene fachliche Frage
führt). Die Artikel×Finanzweg-Kreuzung bleibt eine Frage der **Bonebene** (K1/K2).

---

## A4 — Kassenjournal (K1) und Rechnungen/posBills (K2)

### Kassenjournal

```
GET /finanzen/api/getJournalData?businessdate=15.08.2026
```

**Format: JSON, ein Geschäftstag pro Aufruf**, kein `laden`/`storeId`-Parameter im
UI-generierten Aufruf. Antwortstruktur: `filter`, `businessdate` (Unix), `financetypes`
(dict, alle Finanzwege-Stammdaten), `financetypesNumber`, `articles`, `kellner`, `sites`,
`terminals`, `vats`, `splits`, sechs `filter_*`-Arrays, `revenue` (`{list, list_table, list_z,
tables, tables_count, zcount, businessdate}`), **`to_show`** (die Bon-Liste, wenn befüllt),
`umsatzsumme`, `umsatzsumme_filtered`.

**`to_show` und `revenue.list` waren in jedem Test leer (0 Zeilen, `umsatzsumme: 0`)** — für
den 15.08.2026 und für „heute" (22.09.2026), obwohl Wilma Wunder Düsseldorf an beiden Tagen
zweifelsfrei Umsatz hatte (siehe `getUmsatzbericht`/Report 27/88 oben). Getestet mit
zusätzlichem `&laden=<encId>` — **ohne jede Wirkung**, byteidentische Antwort. `sites`,
`terminals`, `kellner` in der Antwort gehören sichtbar zu einem **anderen, kleineren**
Betrieb (`kellner` enthält nur „Keine Zuordnung" und „Chef", `tblname: enchi_franchise.waiters`)
— vermutlich dem Home-/Standardbetrieb des angemeldeten Kontos, nicht Wilma Wunder Düsseldorf.

**Schlussfolgerung:** Das Kassenjournal hängt an einem **sitzungsgebundenen aktiven Betrieb**,
der über keinen bekannten Query-Parameter umgeschaltet werden kann — anders als die
Betriebsberichte (`laden=`). Der einzige sichtbare Umschalter ist die Mandanten-Combobox oben
links („CONCEPT FAMILY Franchise AG"), und die anzufassen ist laut Auftrag ausdrücklich
untersagt (Regel 4/harte Regel „No Mandant switch"). **Damit ist für Wilma Wunder Düsseldorf
über diesen Weg kein Bon mit Finanzweg 3500–3502 auffindbar gewesen** — nicht weil keiner
existiert, sondern weil der Zugriffsweg blockiert war. Größe pro Tag lässt sich mangels
befüllter Antwort nicht messen; die leere Antwort selbst ist bereits 873.689 Byte groß
(Stammdaten-Wörterbücher `financetypes`/`articles`/`kellner` sind immer enthalten, unabhängig
vom Bonaufkommen).

Beispielstruktur (leer, anonymisiert) unter `docs/payloads/kassenjournal-beispiel.json`.

### Rechnungen / posBills

```
GET /finanzen/document/billitems?startDate=22.09.2026&endDate=22.09.2026
```

**Falsch vermutet im Plan:** „vermutlich Bonebene wie K1". **Richtig:** Dies ist die
**Debitoren-Rechnungsliste** (Rechnungsausgangsbuch, vgl. Report 96), nicht die POS-Bonebene.
Format ist klassisches DataTables-Server-Side-JSON: `{draw, recordsTotal, recordsFiltered,
data, debitors, billTemplates, selectedBillTemplate, standardBillTemplateActive}`. Für den
22.09.2026 (sitzungsgebundener Betrieb, wie oben): `recordsTotal: 0`, aber `debitors` listet
einen echten Debitor (`„Gastro-MIS GmbH"`). **K2 entfällt damit als Bonebene-Quelle** — es ist
ein Beleg-/Rechnungsbuch für Debitoren, redundant mit Report 96, nicht mit K1 verwandt.

---

## A5 — Weitere Buchhalterische Reports, August 2026 (Wilma Wunder Düsseldorf, korrigierter Endpunkt)

| Report | Bytes | `nBillsGesamt` | Bemerkung |
|---|---|---|---|
| 97 Tagesabschluss | 351.766 | 12.186 | echte Daten je Tag (`interval` serverseitig auf 3 „pro Tag" erzwungen, `possibleIntervals` meldet nur diesen einen Wert) |
| 92 Rabattbericht | 243.230 | 12.186 | echte Zeilen, s. o. |
| 114 Kost-Sach-Bezug | 1.539 | 12.186 | **echt leer** — 0 Personalverzehr-Buchungen im Monat, kein Endpunktfehler (`table` hat nur die `businessDate`-Kopfzeile) |
| 87 Erweiterter Tagesabschluss | 992.434 | — | **liefert HTML, kein JSON** — abweichend von der einheitlichen `getReport`-Hülle aus `lina-api-inventar-1b.md` §1.1. Vermutlich eine serverseitig gerenderte Sonderroute, wie der Stundenzettel. Nicht weiter zerlegt |
| 99 Unbare Zahlungen nach Betriebsstelle | 2.117.042 | 12.186 | echte Daten, sehr groß (Betriebsstelle × Finanzweg × Tag vermutlich) |

Alle bis auf 114 und 87 bestätigen `balanceSumBrutto: 369.841,09`, identisch mit
`getUmsatzbericht`.

---

## A6 — Historische Tiefe

Getestet an Wilma Wunder Düsseldorf, Report 27 (Artikelverkauf) und Report 88 (Finanzwege):

| Zeitraum | Ergebnis |
|---|---|
| Januar 2018 | **leer** (`nBillsGesamt: 0`, beide Reports) |
| Januar 2020 | echte Daten (`nBillsGesamt: 13.729`, Brutto 371.604,40 €) |
| Januar 2022 | echte Daten (`nBillsGesamt: 7.946`, Brutto 253.548,15 €) |

**Die Betriebsberichte reichen für diesen Betrieb nicht bis 2018 zurück**, anders als die
Konzernberichte (`getUmsatzbericht` deckt laut `datenherkunft.md` bis 2018 ab). Ob das an der
Eröffnung des Betriebs liegt oder an einer generellen Tiefenbegrenzung der Betriebsberichte,
ist mit dieser einen Stichprobe **nicht unterscheidbar** — nur an einem Betrieb gemessen, nicht
weiter eingegrenzt (Bisektion zwischen 2018 und 2020 nicht durchgeführt, Budget-Grenze dieser
Sitzung). Für Phase 4 des Kassendaten-Plans („neueste Tage zuerst") ist das unkritisch, aber die
Annahme „Historie reicht bis 2018" darf für die 72 Betriebsberichte **nicht** ungeprüft aus den
Konzernberichten übernommen werden — pro Betrieb selbst grenzt sich das beim Rückwärts-Backfill
von selbst ein (leere Antwort ⇒ fertig), muss aber im Fortschrittszähler von „keine Daten mehr"
unterschieden werden von „Zugriff verweigert".

---

## A7 — Zeitraster (`interval`)

`possibleIntervals` ist **berichtsspezifisch**, nicht global:

- Report 97 (Tagesabschluss): `[{value: 3, name: "pro Tag"}]` — nur Tagesraster, kein
  `Kumuliert`.
- Report 88 (Finanzwege), 55, 56, 99, 27, 92: `[{value: 8, name: "Kumuliert"}]` — nur
  kumuliert.

**Ein angefragtes `interval`, das nicht in `possibleIntervals` des jeweiligen Berichts steht,
wird still ignoriert.** Getestet: `interval=3` gegen Report 88 gesendet → Server antwortet mit
`defaultInterval: 8` und identischer Byte-Antwort wie ohne den Parameter. Kein Fehler, keine
Warnung. **Für den Kassendaten-Plan heißt das:** Tagesgenaue Historie ist nur über Berichte mit
„pro Tag" in `possibleIntervals` zu bekommen (wie Report 97) — für alle anderen (inkl.
Finanzwege) ist der günstigste Weg ein monatlicher Aufruf mit `interval=8`, wie im Plan unter
K3 veranschlagt (5.115 statt 152.840 Aufrufe für die Historie).

---

## Finanzwege-Stammdaten (im Plan als „Finanzwege master-data list" gesucht)

```
GET /wawi/badata/fintyp   (POS > Stammdaten > Finanzwege, HTML/DataTable, keine separate XHR)
```

**34 von 34 Einträgen**, System-/Basis-Finanzwege mit Nummern von `-10` bis `91`:
`AmadeusStorno, Boniert, Rundungsdifferenz, Gutschein Einlösung/Verkauf,
Einzweck-/Mehrzweckgutschein Ein-/Verkauf, TrinkgeldAG/AN, Sofortstorno, Storno,
Waren-Retoure, MenuStorno, Mindestverzehr, Pfand/-rückgabe, Bar gegeben, Rückgeld,
Tischübergabe/-übernahme, Zwischensumme, Trinkgeld, Auslagen, EC-Karte, Kreditkarte, Kredit,
Hausbon, Rabatt 50/20/10%, Zimmertransfer, AmadeusGO`.

**Die Glücksrad-Finanzwege (3168, 3500–3502) stehen NICHT in dieser Liste.** Sie sind
vierstellige, betriebs- oder markenspezifische Finanzwege, offenbar oberhalb des globalen
Systemkatalogs angelegt (vermutlich über eine separate Franchise-/Marken-Konfiguration, nicht
unter `POS > Stammdaten > Finanzwege`). Wo genau diese hinterlegt sind, ist **offen** — für
`core.finanzweg` (Phase 3 des Plans) heißt das, dass die Stammdaten **aus den Berichtsantworten
selbst** aufgebaut werden müssen (`Nummer`/`Finanzweg`/`Finanzgruppe` aus Report 88), nicht aus
einer einzigen Stammdatenquelle. Screenshot: `finanzwege-stammdaten.png`. Hinweis auf der
Seite: „Die Daten sind nur eingeschränkt änderbar, weil LINA nicht führendes System ist" —
deckt sich mit dem Amadeus-360-Befund aus KORREKTUR 3/1c.

---

## Sonstige Funde

- **Storno-Report 38 funktioniert jetzt vermutlich auch** (nicht erneut getestet, aber
  derselbe Korrekturmechanismus wie 92 dürfte gelten) — die „Offen geblieben: Stornotyp"-Frage
  aus `lina-api-korrekturen.md` sollte mit dem richtigen Endpunkt neu versucht werden, bevor sie
  weiter als ungeklärt geführt wird.
- **`filterart` (Artikelfilter) ist der einzige neu gefundene Filterparameter-Name.** Die
  übrigen sechs Filter (Feinsparte, Kellner, Tisch, Betriebsstelle, Verkaufsstelle, Wochentag)
  wurden nicht bis auf ihren Parameternamen zurückverfolgt (Zeitbudget) — nur ihre Label sind
  bekannt.
- **Dashboard (`/common/dashboard/storeDashboard`) ist ebenfalls sitzungsgebunden** an denselben
  „Home"-Betrieb wie das Kassenjournal — alle Kennzahlen dort standen auf 0 €, obwohl die URL
  keinen Betriebsbezug in der Adresse trägt. Dieselbe Einschränkung wie beim Kassenjournal.

---

## Nachtrag: Kassenjournal mit Betriebswechsel (22.09.2026, zweite Sitzung)

Auftrag war, den Sitzungsbetrieb umzustellen (laut Eugene ausdrücklich erlaubt, anders als der
Mandantenwechsel) und damit das Kassenjournal für Wilma Wunder Düsseldorf zu lesen. **Das ist
nicht gelungen** — es wurde kein Weg gefunden, den sitzungsgebundenen Betrieb umzustellen, ohne
möglicherweise die Mandanten-Combobox zu betätigen.

Geprüft und ausgeschlossen:

- **URL-Parameter.** Weder `&laden=<encId>` noch `&storeId=<encId>` an
  `/finanzen/api/getJournalData` wirken (schon in der ersten Sitzung getestet). Auch
  `/intranet/analytics/storereportcenter?storeId=…&report=…&von=…&bis=…` lädt den Report NICHT
  automatisch — die UI ignoriert Query-Parameter für Bericht/Datum vollständig und zeigt
  weiterhin „Bitte Bericht auswählen"; Report und Datum müssen über die UI-Steuerelemente
  gesetzt werden.
- **Der Store-Auswahl-Button im Report Center** (Symbol neben dem Betriebsnamen, z. B. neben
  „Wilma Wunder Düsseldorf GmbH") wechselt nur zwischen zwei Ansichten **desselben** Betriebs
  (`storereportcenter` ↔ `storeanalyticsdashboard`, das „Analyse Dashboard"). Kein
  Betriebswechsel.
- **Hauptmenü „Stores" → Management/Administration/Intranet/CRM/Auswertungen/Accounts/ZAV**:
  keine Betriebsauswahl gefunden, nur Konzern-Filter (Konzept, Zeitraum).
- **Direkte Aufrufe der Kassenjournal- und Kassenbuch-Seite** zeigen nur ein Datumsfeld
  (`Geschäftsdatum`), kein Betriebs- oder Standortfeld — bestätigt am Vue-Quelltext
  (`KassenjournalView_BZHpmEWn.js`): der einzige an `getJournalData` übergebene Parameter ist
  `businessdate`, kein `storeId`/`laden`.

**Ein Kandidat bleibt ungeklärt.** Im ausgelieferten Haupt-Bundle (`index_EmlX5sfy.js`,
1.407.831 Byte) ist die Combobox oben links im Kopfbereich — beschriftet mit
„CONCEPT FAMILY Franchise AG" und bisher als reiner Mandanten-Umschalter verstanden — im Code
an `currentStore` aus dem Account-Pinia-Store gebunden:

```
await D.value?.initMenuState(), await g.getAccount(),
l.value = g.currentStore.encryptedId, …
```

`l` ist der reaktive Wert, der später an das `combobox`-Element im Template gebunden wird.
LINAs Datenmodell benennt den obersten wählbaren Kontext offenbar generisch `store` — was auf
Rechnungsebene sowohl der Mandant als auch (bei anderen Konten mit mehreren zugeordneten
Betrieben) ein einzelner Betrieb sein könnte. **Das ist ein Indiz, kein Beweis**: nicht
verifiziert, weil der Klick auf diese Combobox blockiert war.

**Der Klick wurde von der Agentenumgebung selbst verweigert** (Permission-Grant-Anforderung,
unabhängig von der im Auftrag erteilten Erlaubnis). Da genau diese Combobox im Code mit dem
Mandantenkontext verwoben ist und Regel 4 („nie den Mandanten wechseln") harte Priorität hat,
wurde die Sperre **nicht** umgangen (kein `evaluate`-basierter Direktklick, kein erneuter
Versuch mit anderem Selektor). Die Frage „ist das der Betriebs- oder der Mandantenschalter,
und listet er überhaupt einzelne Betriebe auf" bleibt damit offen.

**Ergebnis für Task 1:** Kein Bon von Wilma Wunder Düsseldorf wurde über das Kassenjournal
gelesen. `docs/lina-screenshots/2026-09-22/kassenjournal.png` zeigt weiterhin den leeren
sitzungsgebundenen Default-Betrieb. Die Bonebene (K1/K2 im Kassendaten-Plan) bleibt vollständig
ungeklärt — Abschnitt „Was noch offen ist", Punkt 2 unten gilt unverändert, jetzt mit dieser
zusätzlichen Negativevidenz.

---

## Nachtrag: breite Erkundung (22.09.2026, zweite Sitzung)

Sechs weitere der 72 Betriebsberichte für Wilma Wunder Düsseldorf, August 2026, über den
korrigierten Endpunkt (`laden=`) abgerufen und als Screenshot dokumentiert
(`docs/lina-screenshots/2026-09-22/`). Neu bestätigt, nicht vorher gemessen:

| Report | Ergebnis |
|---|---|
| 88 Finanzwege | 369.841,09 € brutto / 330.080,34 € netto, 12.186 Rechnungen — deckt sich exakt mit `getUmsatzbericht` und mit Report 60 |
| 92 Rabattbericht | lädt korrekt, s. A3a oben |
| 27 Artikelverkaufsbericht | lädt korrekt |
| 60 Umsatz pro Kellner | lädt korrekt, **Kopftabelle bestätigt** 12.186 Rechnungen, Ø-Bon 27,09 € (nach Aufteilung auf Kellner — der Betrag weicht leicht vom Betriebs-Ø ab, weil ein Bon ggf. mehreren Kellnern zugeschlagen wird); Tabelle darunter zeigt **Kellnernamen** |
| 97 Tagesabschluss | lädt korrekt, tägliche Zeilen |
| 68 Umsatz nach Betriebsstellen | lädt korrekt; **UI-Eigenheit**: nach Klick auf „Letzter Monat" blieb „Bericht anzeigen" deaktiviert, obwohl der Report bereits mit den korrekten Daten neu geladen hatte (Netzwerk bestätigt `von=1.8.2026&bis=31.8.2026` → 200) — kein Fehler, nur irreführend für UI-Automatisierung |

**Neuer, echter Fehler gefunden: die Schnellwahl-Buttons „Letzter Monat" (und vermutlich auch
„Aktueller Monat") sind für Berichte mit `date_select: month` (statt `custom`) defekt.**
Getestet an Report 18 (Ranking) und Report 12 (Gutscheinumsatz), beide Monatsbezogene
Auswertungen: Klick auf „Letzter Monat" erzeugt einen Request mit `bis` = `von` (Ein-Tages-
Zeitraum statt Monat) und `reltime=lastMonth`, z. B.
`getReport?report=18&von=1.8.2026&bis=1.8.2026&reltime=lastMonth&interval=3&…` → **HTTP 500**,
gefolgt von einem Client-Fehler `TypeError: Cannot set properties of null (setting
'reportURL')` (`StoreReportCenter_CeOKVcb9.js`). Der „Bericht anzeigen"-Button bleibt danach
deaktiviert, auch nach einem erneuten Klick auf „Letzter Monat". Für diese Berichte funktioniert
vermutlich nur die tatsächliche Monatsauswahl über den Kalender (Monat/Jahr-Buttons im
Datepicker, wie bei `getUmsatzbericht`), nicht die Schnellwahl-Leiste. Nicht weiter verifiziert
(Zeitbudget) — für Phase 0/2 des Kassendaten-Plans heißt das: **Schnellwahl-Buttons sind für
`month`-Berichte kein verlässlicher Automatisierungsweg**, ein expliziter Kalenderklick oder
direkte API-Parameter (`von`/`bis` beide auf den Monatsersten/-letzten) sind nötig.

**Konzernebene:** Das Management-Dashboard (`/intranet/index/madashboard`) liefert für August
2026 mit dem Filter „Letzter Monat" + „Anzeigen" eine Tabelle „Management-Bericht" je Betrieb
(Forecast, Plan, Umsatz Netto/Brutto, Stundenbudget/-Ist) sowie die Charts „Umsatz pro Betrieb",
„Umsatzbringer Top 30" und „Effektivität" — alles auf Konzernebene, kein neuer Endpunkt
dokumentiert (die zugrundeliegende Route lädt serverseitig gerendert, keine separate JSON-XHR
identifiziert).

**Sitzungsgebundene Seiten (derselbe Default-Betrieb wie Kassenjournal/Kassenbuch):**
`/finanzen/abrechnung/monatueb` (Monatsübersicht) — bestätigt dieselbe Sitzungsbindung: alle
Werte 0 €, Monat/Jahr-Auswahl reicht bis 2011 zurück, aber immer für denselben Betrieb. Die
Seite trägt einen Monat/Jahr-`<select>` (kein Button „Letzter Monat"), der serverseitig über die
URL `/finanzen/abrechnung/monatueb?...` oder eine Formularauswahl läuft — nicht weiter zerlegt.

**POS-Stammdaten „Artikel" (Menüpfad POS → Verkauf → Artikel) führt auf `/wawi/rezept/recipe`.**
Das ist WAWI — laut AGENTS.md Regel 5 Demodaten von LINA, nicht FoodNotify. Bewusst nicht
weiter angeschaut oder dokumentiert.

**Table → Reservierungen** ließ sich in der Seitenleiste als aktiv markieren, der Hauptbereich
wechselte aber nicht vom Report Center weg — vermutlich dieselbe „leer im Zentralkontext"-
Eigenheit, die schon in `lina-api-inventar-1b.md` für `reservation-summary`/`d3` vermerkt ist.
Nicht weiter verfolgt.

---

## Was noch offen ist

1. **Artikelfilter (`filterart`) mit korrektem Wertformat.** Vermutlich eine interne
   Artikel-ID statt Freitext — nicht verifiziert.
2. **Bonebene für einen konkreten, namentlich belegten Betrieb.** Weder Kassenjournal noch
   posBills lieferten für Wilma Wunder Düsseldorf einen Bon. Um „Artikel × Finanzweg" wirklich
   zu bekommen, muss entweder (a) ein Weg gefunden werden, das Kassenjournal auf einen anderen
   Betrieb als den Sitzungs-Default zu lenken, ohne die Mandanten-Combobox zu benutzen, oder
   (b) K3/K4 fachlich als „Näherung auf Bonebene" akzeptiert werden (alle Artikel eines Bons
   zählen als „über Glücksrad gelaufen", wenn der Bon eine 35xx-Zeile trägt — das ist ohnehin
   eine der drei Lesarten, die der Plan unter Phase 3 offen lässt).
3. **Historische Tiefe der Betriebsberichte an mehr als einem Betrieb** — ob 2018–2019 generell
   fehlt oder nur, weil Wilma Wunder Düsseldorf später eröffnet hat.
4. **Bericht 87 (Erweiterter Tagesabschluss) liefert HTML statt JSON** — nicht zerlegt, unklar
   ob und wie er automatisiert gelesen werden könnte.
5. **Wo die Glücksrad-Finanzwege (3168/3500–3502) als Stammdaten gepflegt werden**, wenn nicht
   unter `POS > Stammdaten > Finanzwege`.

---

## Nachtrag: Rechnungsausgangsbuch (96) ist Bonebene, aber ohne Nachlässe (22.09.2026)

`GET /intranet/storeanalytics/getReport?report=96&von=15.8.2026&bis=15.8.2026&reltime=custom&interval=8&laden=<encId>`,
Wilma Wunder Düsseldorf, 15.08.2026. **Eine Zeile je Bon**, erreichbar für jeden Betrieb über
`laden=`, anders als das Kassenjournal.

| Spalte | Beispiel |
|---|---|
| `Datum` | 1786744800 (Geschäftstag, Unix, `format: day`, **keine Uhrzeit**) |
| `Rechnungsnummer` | 1138062 |
| `Rechnung/Butschrift` (sic) | `Rechnung` / `Stornierte Rechnung` / `Gutschrift` |
| `Anzahl_Artikel` | „7" (Text) |
| `Finanzwege` | „Trinkgeld,VISA" (kommagetrennt) |
| `Brutto` | 11,50 |
| `Debitor_-_Anschrift`, `Debitor` | leer bis auf Debitorenrechnungen |

519 Zeilen (493 Rechnungen, 13 stornierte, 13 Gutschriften), 185.990 Byte je Tag. `nBillsGesamt`
493 trifft Bericht 88.

**Die Spalte `Finanzwege` führt nur Zahlarten** (Bar, Karte, Trinkgeld, Gutschein, Lieferdienste,
Auslagen, Tischübergabe) und **keinen Finanzweg der Gruppen Hausbon oder Rabatt**. Nachgemessen:
am selben Tag zeigt Bericht 88 32 Glücksrad-Vorgänge (28 × 3502, 2 × 3501, 2 × 3168), aber in 96
trägt keiner der 519 Bons „Glücksrad". Artikelzeilen gibt es nicht. Für die Frage „welche Artikel
standen auf Bons mit Nachlass X" reicht 96 deshalb nicht. Diese Frage beantwortet der
Rabattbericht (92) je Betrieb und Tag, ohne Bonbezug.

Die Vue-Berichte 103 (Tagesanalyse) und 116 (Auffällige Buchungen) antworten über `getReport`
mit 500 und leerem Body. Sie laden ihre Daten über eigene Abrufe.

## Nachtrag: Bonebene mit Artikeln ist je Betrieb nicht erreichbar (22.09.2026, nachgemessen)

Gesucht war eine Quelle mit einer Zeile je Bon, samt Artikelzeilen und **allen** Finanzwegen
(auch Hausbon und Rabatt), adressierbar über die encId eines beliebigen Betriebs. **Keine
gefunden.**

| Kandidat | Bonebene | Artikel | Hausbon/Rabatt | je Betrieb adressierbar |
|---|---|---|---|---|
| 96 Rechnungsausgangsbuch | ja | nur Anzahl | **nein** | ja (`laden=`) |
| 92 Rabattbericht | nein (Tagessumme) | ja | ja | ja |
| 88 Finanzwege | nein (Tagessumme) | nein | ja | ja |
| 55 Finanzwege artikelgenau | nein | ja | nein (nur Bar/Tischübergabe) | ja |
| 103 Tagesanalyse (`getAnalyzeDay`) | — | — | — | 500, auch aus der Oberfläche |
| 20 Tagesverlauf | nein (Stundenraster) | nein | nein | ja |
| Kassenjournal `getJournalData` | ja | ja | ja | **nein**, nur `businessdate` |
| Rechnungsdetail `/finanzen/document/billitems?renum=` | ja | ja (eBon, ZUGFeRD-XML) | vermutlich | **nein**, nur `renum` oder `startDate`/`endDate` |

Die letzten beiden hängen am Betrieb der Sitzung. Im Kopf lässt sich nur der Mandant wählen,
keinen Betrieb, und im Quelltext (`KassenjournalView_*.js`, `PosBills_*.js`) gibt es keinen
Parameter für den Betrieb. **Gegenprobe:** erst das Report Center von Wilma Wunder Düsseldorf
geöffnet, danach `getJournalData?businessdate=15.08.2026` (0 Bons, Umsatz 0) und
`billitems?renum=1138062`, eine echte Düsseldorfer Rechnungsnummer aus 96
(`recordsTotal: 0`). Der Sitzungsbetrieb folgt also nicht dem zuletzt angesehenen Betrieb.

**Korrektur zur Oberfläche:** Das Report Center eines Betriebs liegt unter
`/intranet/analytics/storereportcenter?storeId=<encId>`, nicht unter
`/intranet/storeanalytics/storereportcenter?laden=`. Die **Daten**-Abrufe dahinter heißen
`/intranet/storeanalytics/getReport` bzw. `reportList` und nehmen `laden=`. Oberfläche und
Schnittstelle benennen denselben Schlüssel verschieden.
