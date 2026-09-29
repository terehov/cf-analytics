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

> **Widerlegt am 22.09.2026 — siehe KORREKTUR 7.** `storeId` wird ignoriert; der Endpunkt
> heißt `/intranet/storeanalytics/getReport` mit `laden=<encId>`. Der Text darunter bleibt als
> Stand vom Juli stehen.

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

---

## ~~KORREKTUR 6 — Die Personalrechte sind **da** (24.08.2026)~~ — **widerrufen am 29.09.2026, siehe KORREKTUR 10**

> **Widerruf 29.09.2026.** Im Browser nachgemessen: die fünf Einträge unten sind **Ordner**
> und andere Blätter. Das Blatt, das `manageusers` trägt — `Team > Mitarbeiter > Stammdaten` —
> steht in `/common/api/menu` auf `type: "denied"`, `access: false`, ebenso `Vorgesetzte`. Die
> Aussage vom 25.07.2026 war für dieses Blatt **richtig**, und der 0-Byte-Antwort liegt keine
> Hülle zugrunde, sondern eine Abweisung. Punkt 3 unten („ob Mitarbeiter derselbe Knoten ist
> wie `manageusers`") ist damit beantwortet: **nein**. Was stimmt und was nicht, steht in
> Korrektur 10. Der Text darunter bleibt stehen, damit man sieht, dass er einmal galt.

**Die alte Aussage**, seit dem 25.07.2026 in `lina-api-inventar.md` §5 und seither in jeder
Aufwandsschätzung mitgeschleppt:

> ~~Team > Mitarbeiter > Stammdaten | `/personal/mitarbeiter/manageusers` | **`access: false`**
> für den genutzten Account~~

**Gemessen am 24.08.2026** (`bun run lina-fragen d10`, Schritt 1, aus `/common/api/menu` —
derselben Quelle wie damals):

```
Mitarbeiter            access=true
Lohnbuchhaltung        access=true
Lohnrechner            access=true
Upload Lohndateien     access=true
Personalstruktur       access=true
```

**Fünfmal `true`.** Ob sich die Rechte seit Juli geändert haben oder ob damals ein anderer
Knoten gelesen wurde, lässt sich nicht mehr feststellen — beides ist möglich, und für die
Folge ist es gleichgültig: ~~**die Personaldaten sind für diesen Zugang keine Rechtefrage
mehr.** Damit fällt der Punkt „Mitarbeiter-Stammdaten" aus der Rechteliste an Concept Family
heraus und wird zu einer Aufwandsfrage.~~ *(widerrufen, Korrektur 10: die Mitarbeiter-
Stammdaten sind weiter eine Rechtefrage; `Personalstruktur` ist dagegen wirklich offen.)*

**Was damit NOCH NICHT geklärt ist — und was man deshalb nicht behaupten darf:**

1. **Die Adresse.** Das Menü nennt die fünf Namen ohne Route; das Feld, in dem LINA sie
   führt, heißt anders als `route`/`url`/`link`/`href`. `d10` gibt seit heute den **ganzen
   Knoten** aus, statt das Feld zu erraten.
2. **`/personal/mitarbeiter/manageusers` liefert weiter HTTP 200 mit 0 Bytes** — zweimal
   gemessen, einmal als JSON, einmal als HTML. Bei `access=true` heißt das mit einiger
   Wahrscheinlichkeit: die Seite ist eine **Hülle**, die ihre Daten per zweitem Aufruf holt —
   dieselbe Bauart wie das Belegarchiv mit `getFilesUrl` (Korrektur 5). `d10` sucht seither
   im HTML nach genau solchen Ankern.
3. **Ob „Mitarbeiter" im Menü derselbe Knoten ist wie `manageusers`.** Nicht gemessen. Der
   Name allein sagt es nicht.
4. **Ob Eintritts- und Austrittsdatum überhaupt dabei sind**, und ob **ausgeschiedene**
   Personen mitgeliefert werden. Ohne die letzten sieht jeder Austritt aus wie ein
   Verschwinden — und die Fluktuationsrate wäre wieder nur halb, genau wie bei Bounti.

**Ein Name aus der Liste verdient dabei besondere Aufmerksamkeit: `Personalstruktur`.** Wenn
irgendwo eine Kopfzahl je Betrieb steht, dann dort.

**Woran das hängt:** an der Kennzahl „Fluktuationsraten" (Berichtsliste, Ebene *Laden*,
Prio 3, *Status Bericht = 1*). Sie kommt aus LINA und nicht aus Bounti — Bounti liest die
Personaldaten selbst über einen LINA-API-Schlüssel mit dem Scope *Personalstammdaten und
Kosten* (`lina-api-inventar-ladenakte.md` §4 e). Der Hergang dieser Verwechslung steht in
`entscheidungen.md`, B4.

---

## KORREKTUR 7 — KORREKTUR 3 war falsch: der echte Endpunkt heißt anders (22.09.2026)

**Im Browser erhoben, gegen Wilma Wunder Düsseldorf und den umsatzstärksten Betrieb
(Wirtshaus am Schlossplatz).** Anlass war `plan-lina-kassendaten.md`, Phase 0 — die Frage,
ob die Glücksrad-Nachlässe (Finanzwege 3500–3502) über einen Betriebsbericht zu bekommen
sind. Dabei fiel auf: **jeder** Aufruf des in KORREKTUR 3 dokumentierten Endpunkts liefert
für **jeden** Betrieb und **jeden** Zeitraum `nBillsGesamt: 0` und leere Tabellen — auch für
Berichte, die zweifelsfrei Daten haben müssen (Artikelverkauf für einen Betrieb mit
330.080,34 € Monatsumsatz laut `getUmsatzbericht`).

**Falsch war:**

~~```~~
~~GET /finanzen/analytics/getReport~~
~~    ?report=<id>&von=1.6.2026&bis=30.6.2026&reltime=lastMonth&interval=8~~
~~    &storeId=<encId>~~
~~```~~

~~Verifiziert: `report=97` (Tagesabschluss) liefert mit `storeId` 55 KB echte Daten für den
adressierten Betrieb.~~

**Richtig ist:** Dieser Pfad existiert und antwortet mit `200`, aber `storeId` wird
**ignoriert** — er landet auf einer Route, die keine Daten dahinter hat (vermutlich ein
Alias oder ein Legacy-Rest der Konzernebene). Die 55 KB waren echt, aber sie waren
**Struktur, nicht Inhalt**: Report 97 zwingt `interval` serverseitig auf `3` („pro Tag“) und
baut damit für jeden Monat ~62 Gerüstzeilen auf, auch wenn jeder Wert darin `0` ist —
**Bytegröße ist damit kein Beleg für echte Daten.** Nachgemessen: derselbe Aufruf lieferte
für zwei verschiedene Betriebe und zwei verschiedene Monate exakt **65.830 Byte**, beide
Male mit lauter Nullen.

**Der tatsächliche Endpunkt**, gefunden über die Netzwerkspur eines echten UI-Klicks
(„Bericht anzeigen“ im Report Center):

```
GET /intranet/storeanalytics/getReport
    ?report=<id>&von=1.8.2026&bis=31.8.2026&reltime=custom&interval=8
    &laden=<encId>
```

Zwei Unterschiede zu KORREKTUR 3: der Pfad steht unter `/intranet/storeanalytics/`, nicht
unter `/finanzen/analytics/`, und der Parameter heißt **`laden`**, nicht `storeId`. Der
Katalog-Aufruf folgt demselben Muster: `GET /intranet/storeanalytics/reportList?laden=<encId>`
(72 Berichte, vollständig, siehe `lina-api-inventar-1d.md`). Mit `laden` liefert Report 27
(Artikelverkaufsbericht) für Wilma Wunder Düsseldorf, August 2026: `nBillsGesamt: 12186`,
`balanceSumBrutto: 369841,09` — **exakt** der Bruttoumsatz aus `getUmsatzbericht` für
denselben Betrieb und Monat. Report 88 (Finanzwege) zeigt darunter die drei gesuchten
Glücksrad-Finanzwege mit echten Werten (3500/3501/3502, dazu ein vierter, `3168`, ebenfalls
„25% Glücksrad“ benannt — zwei verschiedene Finanzwege-Nummern mit demselben Namen, eine
eigene Datenqualitätsfalle). Details, Werte und die Artikel×Finanzweg-Frage in
`lina-api-inventar-1d.md`.

**Für Phase 2/3 des Kassendaten-Plans heißt das:** jeder Aufruf, der auf KORREKTUR 3 basiert
(auch der geplante `for (store of stores) for (report of reports)`-Loop), muss auf
`/intranet/storeanalytics/getReport` und `laden=` umgestellt werden, bevor er gebaut wird —
sonst holt der Importer 141 × 72 × leere Antworten und meldet das als Erfolg (Regel 10).

---

## KORREKTUR 8 — 97 trägt die Finanzwege je Tag, und `businessDate` ist kein Tag (22.09.2026, beim Bau des Importers)

Offline an den echten Rohantworten vom 22.09.2026 nachgerechnet (Wilma Wunder Düsseldorf,
August 2026), kein zusätzlicher Aufruf gegen LINA.

**Falsch war (Plan „Vollabzug", Abschnitt 3 und E1):** ~~Die Finanzwege je Tag gibt es nur über
einen Tagesaufruf von 88 — „Klasse T", 152.840 Aufrufe Historie.~~

**Richtig ist:** Der Tagesabschluss **97** liefert aus EINEM Monatsaufruf (`interval=3`) je Tag
zwei Blöcke — Hauptsparte × Steuersatz **und die vollständige Finanzwegtabelle** im Format von
88 (`Nummer`, `Finanzweg`, `Finanzgruppe`, `Umsatz`, `Anzahl`, mit denselben Abschnitten und
Summenzeilen). Über die 31 Tage summiert treffen alle 34 Finanzwege den Monatsaufruf von 88 auf
den Cent, die Anzahl genau — auch 3168, 3500, 3501, 3502. Die Hauptsparten-Blöcke summieren sich
zu `balanceSumBrutto` (369.841,09). Damit kostet die Finanzwegtabelle je Betrieb-Tag 5.115 statt
152.840 Aufrufe. ~~Gemessen an EINEM Betrieb und EINEM Monat; der Importer lädt beide und
vergleicht sie laufend (`mart.finanzweg_88_97_abgleich`). Ob 88 im Tagesraster entfallen kann,
entscheidet Eugene (`offene-punkte.md`, `entscheidungen.md` 22.09.2026 Punkt 5).~~
**Nachtrag 23.09.2026:** an zwei weiteren Stichproben bestätigt — Markt Mainz, Tagesaufruf
15.08.2026 (25 von 25 gleich), und Düsseldorf Januar 2019 (22 von 22 gleich, `balanceSumBrutto`
315.456,17; 97 reicht also mindestens bis 2019). **88 ist daraufhin abgeschaltet** (Migration
`0119`, `entscheidungen.md` 23.09.2026); die Finanzwege kommen nur noch aus 97.
`mart.finanzweg_88_97_abgleich` vergleicht nur noch die bis dahin geladenen 88-Tage.

**Falsch war (stillschweigend angenommen):** ~~`table[].businessDate` nennt den Zeitraum des
Blocks.~~

**Richtig ist:** Bei 88 steht für einen Monatsaufruf (1.8.–31.8.) `businessDate: "01.08.2026"` —
nur der erste Tag —, während 27, 55, 92 und 99 für denselben Zeitraum
„01.08.2026 - 31.08.2026" schreiben und 97 je Block genau einen Tag. Wer das Blockdatum von 88
als Tag nimmt, bucht einen Monat auf den Ersten (im Test als Schlüsselkollision aufgefallen).
Der Importer nimmt den Tag deshalb nur bei 97 aus dem Block, sonst aus dem Posten oder aus einer
Datumsspalte der Zeile.

**Offen bleibt:** Ob die Leitung die Antwort doppelt JSON-kodiert, lässt sich aus den Dateien
nicht sicher sagen — sie wurden teils als JSON-String gespeichert. Der Client packt beides aus.

## KORREKTUR 9 — LINA liefert die Betriebsadresse doch, im Stammdatenblatt (29.09.2026)

~~LINA liefert für Betriebe keine Adresse~~ (`befunde-datenlage.md` Abschnitt 8, 26.07.2026). Das
galt für die 489 damals archivierten Antworten — die Berichtsendpunkte. Das **Stammdatenblatt der
Ladenakte** (`/intranet/ladenakte/ladenstamm/laden/<hash>/admin/1/`, Endpunkt `la:stammdaten`,
seit `0053` monatlich in `raw.api_antwort`) hat in seiner Schlüssel-Wert-Tabelle eine Zeile
**„Adresse"**: Gesellschaft, Straße, PLZ und Ort, mit `<br>` getrennt. Nachgezählt am 29.09.2026:
für **alle 141 Betriebe** vorhanden, bei 140 mit fünfstelliger PLZ.

**Gegen Yext geprüft:** bei 58 von 60 Betrieben dieselbe PLZ. Die zwei Abweichungen sind Fehler
in LINA, nicht in Yext:

| Betrieb | LINA | Yext |
|---|---|---|
| Aposto Wuppertal GmbH | Friedrich-Ebert-Straße 130, 42117 Wuppertal (= Adresse von Enchilada Wuppertal) | Mohrenstraße 3, 42289 Wuppertal |
| Wilma Wunder Viernheim GmbH | Hauptstraße 190, 69117 Heidelberg | Robert-Schuman-Straße 8a, 68519 Viernheim |

Dazu ein Tippfehler: GSF Gastro „Karmeltenstr. 20" (vermutlich Karmelitenstraße) — Nominatim
findet die Straße nicht und fällt auf den Ort zurück.

**Folge:** Yext geht vor, LINA füllt die Lücken (`core.betrieb_adresse`, `src/standort/`). Die
Koordinaten kommen aus OpenStreetMap, nicht aus LINA — dort gibt es keine.

## KORREKTUR 10 — Die Mitarbeiter-Stammdaten sind gesperrt, die Kopfzahl ist es nicht; und der Monatsabruf der Personalkosten stimmt (29.09.2026)

**Im Browser erhoben** (angemeldete Sitzung des Nutzers, Mandant *CONCEPT FAMILY Franchise AG*,
nur lesend, kein Mandantenwechsel, kein Export). Anlass: `d10` sollte den Datenweg der
Fluktuationsrate finden, und der Monatsabruf von `getPersonalkosten` war nie gegen LINA gelaufen.
Die Einzelheiten der Aufrufe stehen in [`lina-api-inventar-1c.md`](lina-api-inventar-1c.md),
Abschnitt „Personal, Stunden und Kopfzahl".

### a) KORREKTUR 6 war falsch — für das Blatt, auf das es ankam

~~„`access=true` für Mitarbeiter … die Personaldaten sind keine Rechtefrage mehr."~~

Nachgemessen am 29.09.2026 in `/common/api/menu` (Antwort im Browser mitgeschnitten, je Knoten
`type`, `data`, `access`):

| Knoten | `data` | `type` | `access` |
|---|---|---|---|
| Team > **Mitarbeiter** (Ordner) | — | — | `true` |
| Team > Mitarbeiter > **Stammdaten** | `/personal/mitarbeiter/manageusers` | **`denied`** | **`false`** |
| Team > Mitarbeiter > **Vorgesetzte** | `/personal/mitarbeiter/vorgesetzte` | **`denied`** | **`false`** |
| Team > Lohnbuchhaltung > Lohnrechner | `/personal/mitarbeiter/lohnrechner` | `url` | `true` |
| Finance > Steuerberater > Upload Lohndateien | `/finanzen/stb/lohnup` | `url` | `true` |
| Stores > Auswertungen > Sonstige > **Personalstruktur** | `/intranet/auswertung/persozahl?admin=1&franchise=1` | `url` | `true` |

In der Oberfläche trägt *Stammdaten* ein Schloss; ein Klick lädt nichts (kein einziger
Netzwerkaufruf). **Der Ordner „Mitarbeiter" ist `true`, das Blatt darunter nicht** — die
KORREKTUR-6-Liste hat den Ordner mitgezählt.

**Was sich nicht mehr klären lässt:** ob sich die Rechte seit dem 24.08.2026 geändert haben oder
`d10` den Kindknoten übersehen hat. `d10` durchsuchte den Baum nach dem Muster
`personal|mitarbeiter|zeitkonto|lohn|dienstplan|struktur` und **kürzte auf 25 Treffer**
(`gefunden.slice(0, 25)`); das Blatt hätte über seinen Alias „Personalakte" trotzdem
getroffen. Beides ist möglich, für die Folge gleichgültig: **heute ist es gesperrt.**

**Die 0-Byte-Antwort von `manageusers`** (zweimal gemessen am 24.08.2026) ist damit erklärt:
keine Hülle, die ihre Daten nachlädt, sondern eine stille Abweisung eines `denied`-Blatts.
~~„spricht für eine Hülle wie beim Belegarchiv"~~ — verworfen.

**Folge:** Die Fluktuationsrate (Eintritt und Austritt je Person) ist wieder eine
**Rechtefrage an Concept Family** — nicht an LINA. Deren Administrator hat den Bounti-Schlüssel
mit Scope *Personalstammdaten und Kosten* angelegt; **vermutlich** hängt die Sperre an der
Nutzerrolle des Zugangs (`Team > Mitarbeiter > Nutzerrollen` ist für uns `true` und erreichbar,
wurde aber nicht geöffnet) — das ist eine Annahme, keine Messung. Keine Anfrage an LINA (`kein Kontakt zu LINA`).

### b) Neu: „Personalstruktur" liefert die Kopfzahl je Betrieb und Monat

`/intranet/auswertung/persozahl` — serverseitig gerendertes HTML, kein JSON. Je Betrieb eine
Zeile, je **Anstellungsverhältnis** (neun Arten plus zwei Summenzeilen) die Kopfzahl für die
Monate 1–12 und einen Durchschnitt; Jahr wählbar ab 2008. Blättern per `POST persozahlSlice`
(`limit=10&offset=…&refyear=…`), rund 310 Zeilen in 31 Seiten (mehr als die 141 Betriebe der
Berichte). **Das ist ein Bestand, keine Bewegung:** Eintritte und Austritte, die sich im
selben Monat aufheben, sind darin unsichtbar, und Personen kommen nicht vor. Eine Fluktuations-
**rate** lässt sich daraus **nicht** rechnen; als Nenner (Ø Kopfzahl) taugt sie.

Nachgemessen am 29.09.2026, Jahr 2025, die ersten 10 Betriebe: Summe der neun Arten je Monat
zwischen 395 und 453. **Zukunftsmonate sind befüllt, und man sieht nicht, womit:** in der
Ansicht 2026 stehen Oktober bis Dezember, obwohl der Oktober noch nicht begonnen hat. Bei
fünf von sechs geprüften Betrieben sind sie identisch mit dem September (Fortschreibung des
Bestands); bei einem (Aposto Mainz) weichen sie ab — 46 im September, dann 51, 53, 53 —, was
Eintritte mit künftigem Datum sein können oder etwas anderes. Beides sieht aus wie Kopfzahl.
**Ein Import darf Monate nach dem laufenden nicht als Messung führen.**

**Nicht enthalten:** Bereich (Service/Küche/Bar) — nur das Anstellungsverhältnis. Die
Personalquote je Bereich bleibt an `getPersonalkosten`.

### c) `getPersonalkosten` über einen Monat: bestätigt, mit Einschränkung

Aufruf, wie die Oberfläche ihn schickt (Stores > Auswertungen > Report Center > Personalkosten):

```
GET /intranet/analytics/getPersonalkosten
    ?report=intranet-personalkosten&von=01.08.2026&bis=31.08.2026
    &reltime=custom&brutto=0&preExistingRevenue=0
```

Antwort `{timeframe, stores[141]}`; je Betrieb `name`, `encId`, `effService/Bar/Kueche/Gesamt`,
`thresholds`, `pekService/Bar/Kueche/Gesamt`, `pekThreshold`, `persoogBwa` — dieselben Felder
wie im archivierten Payload. **Nachgemessen am 29.09.2026** (August 2026, ein Aufruf, lokal
ausgewertet):

| Frage | Ergebnis |
|---|---|
| Betriebe mit Wert | `eff` bei **56 von 141**, `persoogBwa` bei **20** (August noch nicht gebucht), beide bei **18** |
| `pekGesamt` gegen `persoogBwa` | Median **−0,18 pp**; p10 −6,15, p90 +3,34, größte Abweichung 9,87 pp. **Nur 4 von 18 innerhalb 1 pp, 11 von 18 innerhalb 3 pp** |
| Stundensatz aus `pek × eff` | Service **17,8**, Küche **18,8**, Bar **18,6** €/h (Median, 18/18/17 Betriebe) — untereinander gleich, im Band 15–30 |
| `pekGesamt` als Stundensatz | 22,6 €/h — **höher** als die drei Bereiche (siehe unten) |
| Ausreißer | Enchilada Aalen `pekGesamt` 187,1 %; Domhof 67,9 % (Bereiche 88–119 %) |

**Bewertung.** Die Bereichsquoten sind Quoten und plausibel: gleiche Stundensätze bestätigen
die Nenner **indirekt** (Küche gegen Speisen, Bar gegen Getränke) — der Bericht nennt seine
Nenner nirgends (Tabelle ohne Fußnote, Spaltenköpfe ohne Erläuterung). `pekGesamt` liegt im Median
nahe an `persoogBwa`, streut aber breit; **„nahe" gilt für den Median, nicht für den
einzelnen Betrieb.** Der Vergleich stützt sich auf **einen** Monat mit unvollständiger BWA — ein
zweiter, vollständig gebuchter Monat (Juli) steht aus. Der höhere Gesamt-Stundensatz sagt, dass
`pekGesamt` mehr enthält als die drei Bereiche (vermutlich Verwaltung/Geschäftsführung); was,
ist ungeklärt.

### d) Der Tageswert ist aufgelaufen, keine Quote — bestätigt

Gleicher Aufruf für **einen Tag** (`von=28.09.2026&bis=28.09.2026`), 32 Betriebe mit `eff`:
`pekGesamt` Median **879,5 %** (Spanne 501,6–2.314,8) — der September seit dem 1., geteilt
durch den Umsatz eines Tages. Gegen den Monatsabruf der Betriebe, die in beiden stehen:
`pekGesamt` Tag/Monat Median **21,4**, `effGesamt` Tag/Monat Median **0,83** (flach).
`persoogBwa` steht am Tag bei **0** Betrieben. Korrektur 4, Nachtrag, ist damit belegt.

### e) Nebenbefund: Bericht 107 läuft — über einen anderen Endpunkt

~~„107 Gearbeitete Stunden: HTTP 500, gesperrt oder nicht lizenziert."~~ (`lina-api-inventar-1c.md`
Abschnitt 2, 25.07.2026.) Das Report Center des Mandanten (`/finanzen/analytics/reports`) ruft ihn
so auf:

```
GET /finanzen/analytics/getHoursWorked?report=107&von=1.8.2026&bis=1.8.2026&reltime=lastMonth&interval=8
```

Antwort `{from, to, rows:[{name, anstellung, stunden_soll, stunden_ist, abweichung, state}]}` —
**je Person**, nicht je Betrieb. Im Mandanten *Franchise AG* liefert er genau eine Person (deren
eigenes Personal). `reportList` desselben Mandanten führt 107 und 24 ohne `missingModule`,
dagegen **8 (Personalkosten) und 23 (Personalkostenschätzung) mit `missingModule: [67]`** — das
erklärt deren 500er als **nicht gebuchtes Modul**, nicht als Rechtemangel. Die 500er vom
25.07.2026 für 107 kamen über `getReport` (Korrektur 7: falscher Endpunkt); **ob 107 für
einen einzelnen Betrieb geht, ist damit nicht gemessen**, nur dass der Bericht existiert und
antwortet. Dieser Zugang liefert Stunden **mit Personenbezug** — wer ihn je Betrieb holt, holt
Namen. Sie gehören nicht in `docs/` und nicht in `docs/payloads/`; ob und wie das je
importiert wird, ist eine Entscheidung vor dem Bau, nicht danach.

### f) Nebenbefund: Stunden je Wochentag und Stunde — auf dem Konzern-Dashboard

`GET /finanzen/api/chartjson?von=<epoch>&bis=<epoch>&charts=umsatzperso` liefert je Wochentag
und Stunde (08:00–07:00) Umsatz, Personalkosten und **Effektivität in €/h** — im Mandanten
*Franchise AG* überall 0, weil dort nichts kassiert wird. Ob der Aufruf mit Betriebskontext
Daten liefert, ist **nicht gemessen**. Er wäre die einzige Quelle für Personalkosten *je Stunde*
(Korrektur 4: „Personalstunden je Zeitzone gibt es nicht").

### Folgen

* `d10` ist umgebaut: Schritt 1 wertet **jedes** Personalblatt einzeln aus (Ordner und Blatt
  getrennt), Schritt 2 ruft `persozahl` statt `manageusers`. Kommando siehe `offene-punkte.md`.
* `docs/offene-punkte.md` Punkt 4, `kennzahlen-mapping.md` (Fluktuationsraten),
  `lina-api-inventar-1b.md`, `lina-api-inventar.md`, `datensicherung.md`, `entscheidungen.md`,
  `metabase/karten-management.ts` und `migrations/0129_management_regelwerk.sql` führten die
  Aussage aus Korrektur 6 — alle nachgezogen (`grep` siehe `fehlerkatalog.md`, 29.09.2026, zweiter Eintrag).
