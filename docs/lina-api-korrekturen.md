# Phase 1 — Korrekturen und Durchbrüche

**Stand 25.07.2026, nach den Zusatztests.** Dieses Dokument korrigiert drei Befunde aus `lina-api-inventar.md` und `lina-api-inventar-1b.md`. Wo es widerspricht, gilt dieses Dokument.

---

## KORREKTUR 1 — Es gibt **kein** Rechteproblem

**Falsch war:** „Der Account sieht die BWA-Zahlen nicht. Der Importer braucht einen Service-Account mit vollen Finance-Rechten. **Blockierend für Phase 3.**"

**Richtig ist:** Dein Account sieht exakt dieselben Daten wie Daniel. Ich hatte in Phase 1 nur nach *Karlsruhe* gesucht — einem der Betriebe, die tatsächlich keine BWA-Daten haben — und daraus falsch verallgemeinert.

Verifikation an Enchilada Bayreuth, `getKennzahlen` mode=absolut, 2026:

| | Jan | Feb | Mär | Apr | Mai |
|---|---|---|---|---|---|
| Umsatz (API) | 73.789,81 | 76.569,54 | 78.716,43 | 70.787,54 | 92.030,31 |
| Umsatz (Screenshot Daniel) | 73.789,81 | 76.569,54 | 78.716,43 | 70.787,54 | 92.030,31 |
| WE Bar | 5.376,65 | 5.878,79 | 8.717,00 | 7.258,40 | 11.994,34 |
| WE Küche | 13.105,43 | 8.111,01 | 13.362,25 | 12.889,57 | 12.755,92 |
| Personalkosten o. GF | 18.801,02 | 19.286,14 | 21.739,03 | 20.499,03 | 22.812,56 |

Alle Werte identisch mit dem Screenshot aus dem Strategiemeeting. **Der Blocker ist gestrichen.**

**Was stattdessen gilt — Datenverfügbarkeit, nicht Rechte:**

| Monat 2026 | Betriebe mit BWA-Umsatz (von 131) |
|---|---|
| Januar | 64 |
| Februar | 63 |
| März | 63 |
| April | 63 |
| Mai | 59 |
| **Juni** | **22** |
| Juli | 0 |

Zwei Effekte überlagern sich:
1. **Nur ~66 der 131 Betriebe haben überhaupt BWA-Daten** — der Rest sind geschlossene Betriebe, Beteiligungsgesellschaften und Verwaltungseinheiten ohne eigenen Kassenbetrieb.
2. **Der Buchungsstand hinkt nach.** Am 25.07. waren für Juni erst 22 von 131 Betrieben gebucht, für Mai 59. Das ist der Import vom Steuerberater in Aktion.

Für die Pipeline heißt das: Die Plausibilitätsprüfung darf **nicht** „Null-Quote > X % ⇒ Alarm" lauten, sondern muss zwischen „Betrieb hat grundsätzlich keine BWA" und „Monat noch nicht gebucht" unterscheiden. Konkret: pro Betrieb den letzten Monat mit Daten führen (`bwa_last_booked_month`) und nur alarmieren, wenn ein Betrieb, der bisher lieferte, plötzlich zurückfällt.

---

## KORREKTUR 2 — Die Ampel-Prozente kommen fertig aus **einem** Aufruf

**Falsch war:** „WE Bar % = WE Bar (EUR) ÷ Getränke-Umsatz aus `getUmsatzbericht(hauptsparten=10002)`" — also zwei Zusatz-Calls und eine eigene Berechnung, Status 🟡 ableitbar.

**Richtig ist:** `getKennzahlen` kennt einen zweiten Modus:

```
GET /intranet/analytics/getKennzahlen?von=01.01.2026&bis=31.12.2026&mode=relativ
```

Der liefert dieselbe Hierarchie, aber alle Werte **als Prozent vom BWA-Umsatz-Konto der jeweiligen Kennzahl**. Verifikation Enchilada Bayreuth, Mai 2026:

| Kennzahl | `mode=relativ` | Excel `Eingabe` | Treffer |
|---|---|---|---|
| Umsatz | 100,00 | — | Referenz |
| **WE Bar** | **23,64** | 0,2364 | ✔ exakt |
| **WE Küche** | **31,08** | 0,3108 | ✔ exakt |
| **Personalkosten ohne GF** | **24,79** | 0,2479 | ✔ exakt |
| EBIT | 1,49 | — | = Rendite, gratis dazu |

Meine POS-basierte Rechenvariante ergab dagegen 45,90 / 33,60 / 35,42 — **deutlich daneben.** Der Nenner kommt aus den BWA-Erlöskonten, nicht aus den POS-Hauptsparten. Wer das selbst nachrechnet, rechnet falsch.

**Konsequenzen:**
* Drei Zeilen der Mapping-Tabelle wechseln von 🟡 *ableitbar* auf ✅ *direkt*.
* Die zwei Sparten-Calls je Periode entfallen ersatzlos — weniger Last auf LINA.
* Die **Rendite** (EBIT %) fällt gratis mit ab, obwohl sie in `Umsetzung Berichte` noch mit `Status Live = 0,2` steht.
* Nebenbei bestätigt: Die Werte im JULI-Report sind **Mai**-Werte. Die Excel-Kopfzeile („MAI" über Personal/WE, „JUNI" über Bewertung) stimmt.

**Empfehlung:** Beide Modi in den Raw-Layer holen. `absolut` für EUR-Aggregationen über Betriebe hinweg, `relativ` für die Ampel. Zwei Calls pro Jahr und Mandant — vernachlässigbar.

---

## KORREKTUR 3 — Der Betriebswechsel ist gelöst: **`storeId`**

**Falsch war:** „Die 72 Betriebs-Berichte sind session-gebunden an den aktiven Betrieb. Wie der Importer zwischen 141 Betrieben wechselt, ist ungeklärt — **die** offene Architekturfrage für Phase 3."

**Richtig ist:** Es gibt gar keinen Session-Wechsel. Über das Management-Dashboard (`/intranet/index/madashboard`) führt je Betriebszeile ein Drill-Down-Button auf:

```
/intranet/analytics/storereportcenter?storeId=<encId>
```

Und der Daten-Endpunkt akzeptiert denselben Parameter:

```
GET /finanzen/analytics/getReport
    ?report=<id>&von=1.6.2026&bis=30.6.2026&reltime=lastMonth&interval=8
    &storeId=<encId>
```

Verifiziert: `report=97` (Tagesabschluss) liefert mit `storeId` 55 KB echte Daten für den adressierten Betrieb — ohne Mandantenwechsel, ohne Session-Manipulation.

**Und `storeId` ist genau die `encId` aus `getUmsatzbericht.stores[].encId`.** Damit schließt sich der Kreis: ein Aufruf des Umsatzberichts liefert alle 141 `encId`s, und über die sind alle 72 Betriebs-Berichte für jeden Betrieb adressierbar.

Für Phase 3 heißt das: eine flache Schleife `for (store of stores) for (report of reports)` mit Jitter dazwischen. Kein Impersonation-Mechanismus, keine Session-Verwaltung, kein Risiko, den Zustand des Nutzers zu verändern. **Der größte Architektur-Risikoposten aus 1b ist damit weg.**

---

## Neu: Rezepturen

`/wawi/rezept/articleApi?showAdditionalMecCodes=0` → **1.428 Verkaufsartikel** als JSON: `{id, active, name, artnr, mec, detailcat, grosscat, shop_ids, partners, selfordering, function, mecs, group_ids, encId}`.

Die **Zutatenliste** liegt dagegen nur in der Legacy-Bearbeitungsmaske:
`/wawi/rezept/recipeedit?items=b-<base64-JSON>&tab=ingred` — HTML, kein JSON. Der `items`-Parameter ist base64-kodiertes JSON der Form `{"unSelected":[],"filters":{},"all":false,"sel":[598],"search":""}`, wobei `sel` die Artikel-IDs enthält.

Struktur einer Rezeptur (aus der Maske gelesen): *Anzahl Zutaten*, *Zutaten Kosten*, je Zeile *Anzahl / Kalkulationseinheit / Drucktext / **Zutat (aus Einkaufsartikeln)** / Preis / Optional*, dazu *Zubereitungsverlust in %* und *Fixed Wareneinsatz in €*. Ein `POST /wawi/rezept/calcweajax?items=…` rechnet den Wareneinsatz aus der Rezeptur — **nicht aufgerufen**, da POST.

**Bewertung:** Die Rezepturauflösung per Scraping über 1.428 Artikel ist nicht sinnvoll. Sie wird auch nicht gebraucht: Das Feld **`fixed_we` aus `getArtikelverkaufsbericht.columns[]`** ist genau das Ergebnis dieser Kalkulation und liegt als JSON vor. Für „Theoretischer WE vs. BWA" und „WE und DB pro Artikel" reicht `fixed_we × counts`. Nur für „im Trend liegende Zutaten" (aus der Projektbeschreibung) bräuchte man die Auflösung — das ist ein Nice-to-have für später.

---

## Offen geblieben: Stornotyp

**Struktur geklärt, Werte nicht.**

| Bericht | id | Spalten |
|---|---|---|
| Stornobericht | 38 | `Artikelnummer`, `Artikel`, **`Stornotyp`**, `Anzahl`, `Umsatz_Brutto`, `Umsatz_Netto` |
| Stornogrundbericht | 39 | `Artikelnummer`, `Artikel`, **`Stornotyp`**, **`Stornogrund`**, `Anzahl`, `Umsatz_Brutto`, `Umsatz_Netto` |
| Rabattbericht | 92 | `Rabatt`, `Artikel`, `Brutto`, `Netto`, `Anzahl` |

Getestet gegen den umsatzstärksten Betrieb (19.055 Rechnungen im Juni) und gegen „gestern": alle drei liefern `200`, korrekte Spaltendefinition, aber **`nBillsGesamt: 0` und keine Zeilen** — während `report=97` (Tagesabschluss) für denselben Betrieb und Zeitraum 55 KB Daten zurückgibt.

Die Storno-/Rabatt-Berichte greifen also auf eine andere, offenbar leere Datenquelle zu. **Ohne einen Betrieb mit nachweislich vorhandenen Stornodaten lässt sich nicht klären, welche Werte `Stornotyp` annimmt** — und damit auch nicht, ob Trainingsbuchungen darüber unterscheidbar sind.

Die **Stornogründe** sind dagegen als Stammdaten sichtbar (`POS > Stammdaten > Stornogründe`) — und es sind nur vier:

| Nr | Name |
|---|---|
| 0 | Keine Zuordnung |
| 1 | Bruch/Kork |
| 2 | verderb |
| 5 | schwund |

→ **Rückfrage an dich:** Kennst du einen Betrieb, in dem Stornos nachweislich erfasst werden? Dann kläre ich `Stornotyp` in fünf Minuten. Andernfalls schlage ich vor, das in Phase 3 gegen echte Daten zu verifizieren statt jetzt weiter zu raten.

---

## Neu und strategisch relevant: **Amadeus 360 ist das führende System**

Auf der Stornogründe-Seite steht:

> „Die Daten sind nur eingeschränkt änderbar, weil Amadeus 360 nicht führendes System ist."

Das passt zu weiteren Spuren im Code: `a360.dataTable.js` in den Legacy-Skripten, `a360isMaster` im Rezept-API, `agenda_ID` in den Stammdaten. **LINA/Amadeus 360 ist bei Concept Family nicht das führende Kassensystem** — es gibt ein vorgelagertes System, aus dem Artikel- und Stammdaten in LINA synchronisiert werden (das Feld `isSynced` an den Einkaufsartikeln und die `syncGroups` im Rezept-API deuten in dieselbe Richtung).

Das ist für den Parallelwelt-Ansatz eine wichtige Information: Ein Teil der Stammdaten, die wir aus LINA ziehen, ist dort selbst nur eine Kopie. Falls die Qualitätsprobleme (Stichwort „Doppelte Artikelnummern, unbedingt korrigieren") aus dieser Synchronisation stammen, wäre die Quelle möglicherweise der bessere Anknüpfungspunkt als LINA. **Frage an dich: Welches System ist bei euch führend, und hättet ihr dort direkteren Zugang?**

---

## Aktualisierte Blocker-Liste

| Vorher | Jetzt |
|---|---|
| ~~Service-Account mit vollen BWA-Rechten — blockierend~~ | ✅ **erledigt** — kein Rechteproblem |
| ~~Betriebswechsel für die 72 Betriebs-Reports ungeklärt~~ | ✅ **erledigt** — `storeId=<encId>` |
| ~~WE-% braucht Sparten-Nenner~~ | ✅ **erledigt** — `mode=relativ` |
| ~~Rezepturen ungeprüft~~ | ✅ geprüft — HTML-only, aber über `fixed_we` nicht nötig |
| Ampel-Schwellen global vs. betriebsindividuell | ✅ **entschieden: beide, umschaltbar** |
| Stornotyp-Ausprägungen | 🟡 offen — Betrieb mit echten Stornodaten nötig |
| Umsatzabweichung Bayreuth/Freiburg Excel vs. API | 🟡 offen — vermutlich manuelle Pflege aus anderer Quelle |
| Führendes Vorsystem (Amadeus 360 / anderes) | 🟡 **neu** — Zugang dorthin prüfen? |

Damit ist Phase 1 aus meiner Sicht abgeschlossen und Phase 2 nicht mehr blockiert.

---

## KORREKTUR 4 — LINA liefert **doch** Arbeitsstunden (11.08.2026)

~~„LINA liefert Personalkosten nur als Quote, keine einzige Arbeitsstunde und keinen
Euro-Betrag je Bereich. Damit fehlen: Personalkosten je Umsatzstunde, Umsatz je
Arbeitsstunde, Gäste je Arbeitsstunde. Betrifft die Kapitel 2.1, 2.3 und 7.2
**vollständig**."~~ — so stand es bis zum 11.08.2026 in `datenlage-round-table.html`, und es
war der Grund, Bericht 107 als Blocker zu führen.

**Widerlegt.** `getPersonalkosten.eff*` ist **Umsatz je Arbeitsstunde**. Der Beleg steht
schon im archivierten Payload (`docs/payloads/getPersonalkosten.json`): `effService` 199,28
neben `pekService` 9,44 % ergibt 18,81 € Stundensatz — eine plausible Zahl, und zwar nur
dann, wenn `eff` €/Stunde ist.

**Die Bereichszuordnung ist nicht geraten, sie schließt als Identität:**

```
Stunden_Service = Umsatz_gesamt    / effService
Stunden_Bar     = Umsatz_Getränke  / effBar
Stunden_Küche   = Umsatz_Speisen   / effKueche
                                        Summe  =  Umsatz_gesamt / effGesamt
```

Über **16.110 Betriebstage** mit vollständiger Spartenaufteilung: Median des Verhältnisses
**0,99995**. Beispiel Enchilada Augsburg, 03.06.2026: 26,0 + 19,5 + 27,6 = 73,1 gegen 73,1.

**Unabhängige Gegenprobe** (BWA-Personalkosten ÷ zurückgerechnete Stunden): Median
**21,12 €/h**, 97,7 % von 838 Betriebsmonaten im Band 14–32 €/h. Rechnung und Zahlen in
[`befunde-datenlage.md`](befunde-datenlage.md), Befund 2.

**Was daraus folgt:** Kapitel 2.1 hängt **nicht** an Bericht 107. Der Bericht bleibt
interessant — er brächte die Schichtebene für 2.3 —, aber er blockiert nichts. Der Messaufruf
dafür ist `bun run lina-fragen d2`.

**Was weiter gilt:** Personalstunden je *Zeitzone* gibt es nicht (die Stunden liegen je Tag
vor), und die **Soll**-Stunden für den Plan-Ist-Vergleich aus 7.2 stecken im Dienstplan, der
gesperrt ist.

### Nachtrag zur selben Antwort: `pek*` ist auf Tagesebene keine Quote

Beim Prüfen aufgefallen. Wer `getPersonalkosten` **je Tag** abruft, bekommt in `pek*` einen
Zähler, der **seit Monatsanfang kumuliert** ist, über einem Nenner aus dem angefragten Tag.
Der Wert wächst dadurch linear mit dem Monatstag (Median `pekGesamt`: Tag 1 = 43,8,
Tag 31 = 717,6), während `eff*` flach bleibt.

Für den Monatsabruf — so wie der archivierte Payload entstanden ist — stimmt `pek*`. Für
Tagesabrufe **nicht**. Verlässlich ist `persoogBwa`: identisch mit dem BWA-Prozentwert
(Median-Abweichung 0,000 pp). Hergang in [`fehlerkatalog.md`](fehlerkatalog.md).

---

## KORREKTUR 5 — Die Ladenakte trägt, was wir für unerreichbar hielten (11.08.2026)

Erhoben in der angemeldeten Browser-Sitzung des Nutzers, nur lesend. Vollständige
Aufnahme in [`lina-api-inventar-ladenakte.md`](lina-api-inventar-ladenakte.md).
Drei Aussagen aus früheren Dokumenten sind damit überholt.

**a) „Rendite ist in den Buchhaltungsdaten ohne Definition, der Wilma-Wunder-Report
fehlt im Repo" (Posten A11, 11.08.2026 vormittags).**
Überholt. `/finanzen/bwa/longterm?module=franchise&laden=<hash>` liefert je Betrieb
**77 BWA-Zeilen über 207 Monate (06/2009–08/2026)** in *einer* Antwort — darunter
`Erg.v Zins/Tax(EBIT)`, `Ergeb v Steuer (EBT)`, `Vorläufiges Ergebnis` und
`zur Info: EBITDA`, dazu Mietaufwand, Mietnebenkosten, Energiekosten,
Abschreibungen und Franchisegebühr. Für Enchilada Karlsruhe tragen die Spalten ab
01/2012 Werte. Unser Bestand kennt keinen dieser Kostenblöcke.

**b) „Bounti ist nicht angebunden" (Lückenanalyse 10.08.2026).**
Überholt. Das Stammdatenblatt jedes Betriebs führt eine Tabelle vergebener
**API-Keys mit Scopes**. Eingetragen sind „Sell & Pick" und **„Bounti"** (Scope
*Personalstammdaten und Kosten*), Ebene Franchise, auf feste IPs gebunden.
LINA hat also eine **offizielle Third-Party-API**, und Concept Family nutzt sie
bereits. Das ist zugleich der mögliche Ausweg aus Regel 7a: ein eigener Schlüssel
mit lesenden Scopes, gebunden auf die Hetzner-IP, ersetzt Anmeldung und Scraping.
Zu klären mit LINA und Tobias Lindemann — keine technische Frage.

**c) Regel 5 gilt weiter — aber nicht für das Belegarchiv.**
Gegenprobe bestätigt die Regel für das Buy-Modul: `/wawi/inventory/inventory`
liefert für Betrieb 62 elf Inventurstichtage, der **jüngste vom 08.02.2017**.
Der Bericht *Inventurstände* in der Ladenakte ist ebenso leer.

Das **Belegarchiv ist davon nicht berührt.** Dort liegen echte, OCR-erschlossene
Eingangsrechnungen mit Lieferant, Kreditorenkonto, Sachkonto, MwSt-Aufteilung und
DATEV-GUID — gemessen **394.552 Stück** über alle 131 Betriebe (Gesamtbestand
des Archivs: mindestens 593.314 Dokumente in acht der vierzehn Belegarten). Wer Regel 5 („LINAs
Warenwirtschaft und Einkauf sind Demodaten") auf das Belegarchiv anwendet, wirft
die beste Wareneinsatzquelle des Projekts weg. Insbesondere trägt jede Rechnung
`zuordnungFibu` ∈ {Bar, Küche, sonstiges} — der **Wareneinsatz-Split am Beleg
selbst**, unabhängig von Artikelpflege und PLU-Nummernraum.

> **Korrektur an dieser Stelle (nachgetragen).** Hier stand zuerst „FoodNotify-PLU
> (~34 %) und `fixer_we` (~63 %)". Das war eine falsche Zuordnung. Richtig nach der
> Messung in [`befunde-datenlage.md`](befunde-datenlage.md): **`fixer_we` deckt 31,3 %**
> des Umsatzes, die **Amadeus/FoodNotify-Obergrenze liegt bei 33,9 %**, und die **63 %**
> sind erst die *Summe beider Wege auf Markenebene* — sie gehören nicht zu `fixer_we`
> allein.

**Und eine Warnung, die keine Korrektur ist, aber dringender:** Auf der
Verträge-Seite ist das Löschen ein **gewöhnlicher GET-Link**
(`…/vertragid/<id>/delete/1`). Ein Crawler, der Links folgt, löscht Verträge.
Jeder Zugriff auf die Ladenakte läuft über eine Positivliste zusammengesetzter
URLs — niemals über Linkverfolgung.

## 13.08.2026 — `fn:betriebe` hält NICHT die fehlende Restaurantliste

**Die Annahme** stand in `docs/plan-datenvollstaendigkeit-nachtrag.md` §2.8: *„Die
Restaurantliste, die die 25 Kostenstellen ohne `betrieb_key` zuordnen könnte, liegt seit
Wochen ungenutzt in `raw.api_antwort`."* Daraus folgte der Auftrag, `fn:betriebe` einen echten
Lader-Case zu geben und danach die Zuordnungsfunktionen anzuschließen.

~~`fn:betriebe` liefert Restaurants, die `core.kostenstelle` nicht kennt.~~ **Widerlegt am
13.08.2026, lesend in Produktion gemessen:**

| Messung | Ergebnis |
|---|---|
| Restaurants in `fn:betriebe` | 78 |
| davon **ohne** Kostenstelle in `core` | **0** |
| Namen, die von `core.kostenstelle.restaurant_name` abweichen | **0** |
| verschiedene Zeitzonen | **1** (alle `Europe/Vienna`) |

Ein Lader-Case für `fn:betriebe` schriebe also eine Tabelle, die `core.kostenstelle` Spalte
für Spalte doppelt, plus eine konstante Zeitzone. **Er ist deshalb nicht gebaut worden** —
das steht auch in `entscheidungen.md`, damit es niemand für Vergesslichkeit hält.

**Was es stattdessen war.** Ein Apostroph in `core.name_norm()`: die Funktion übersetzte
`´`, `` ` `` und `'` in Leerzeichen statt sie zu entfernen, und `’` kannte sie gar nicht. Aus
`Lehner´s` wurde `lehner s` statt `lehners`. Gemessen über alle 79 Restaurants × 141 Betriebe:
59 exakte Treffer vorher, 60 nachher, 0 verloren. Migration `0073`.

**Und was bleibt.** Sechs Restaurants mit Bestellungen ohne Betrieb — die brauchen eine
**Entscheidung**, keinen Automaten, und stehen dafür in `mart.kostenstelle_ohne_betrieb`.
Bei „Aposto Wuppertal II" führt LINA zwei Gesellschaften gleichen Namens; welche gemeint ist,
sagt kein Name. Wer hier raten lässt, ordnet 246 Bestellungen lautlos dem falschen Betrieb zu.
