# Inventar 1c — im Browser verifiziert (25.07.2026)

Nachtrag zu `lina-api-inventar.md` und `-1b.md`. Alles hier wurde **live gegen die
angemeldete Sitzung geprüft**, ausschließlich lesend (GET), keine Formulare, nichts
gespeichert. Wo dieses Dokument den beiden anderen widerspricht, gilt dieses.

---

## 1. Die n:m-Frage ist entschieden: es ist 1:n

Direkt gegen `getKennzahlen` gemessen:

```
14 Konzeptgruppen, 131 eindeutige Betriebe
Betriebe, die in mehr als einer Gruppe hängen: 0
```

Und die fünf Karlsruher Einträge:

| Betriebsschlüssel | Name | Konzept |
|---|---|---|
| 15 | Enchilada Karlsruhe GmbH | Enchilada |
| 10 | Aposto Karlsruhe GmbH | Aposto |
| 38 | Lehners Karlsruhe | Deutsche Konzepte |
| 44 | GESCHLOSSEN Besitos Karlsruhe GmbH | Enchi-Gruppe geschlossene |
| 4316 | Wilma Wunder Karlsruhe GmbH | Wilma Wunder |

Fünf verschiedene Schlüssel, fünf verschiedene Betriebe. **Und die Namen enthalten die
Marke** — meine Behauptung, das Kind trage nur die Stadt, war ebenfalls falsch. Sie kam
aus der anonymisierten Fixture, in der die Namen ersetzt sind.

Damit ist `mart.konzept_zuordnung` in der Praxis vollständig automatisch befüllt;
`manual.betrieb_hauptkonzept` bleibt leer, bis irgendwann ein echter Mehrfachfall auftaucht.

Nebenbefund: `analyticsFilterOptions.betriebe` liefert 141 Einträge, `getKennzahlen`
nur 131 — die Differenz sind Einheiten ohne BWA-Zuordnung.

---

## 2. Die Personal- und Wareneinsatzberichte sind gesperrt

Meine Holding-Hypothese war falsch. Getestet **auf Betriebsebene**, mit `storeId` des
umsatzstärksten Betriebs (712.801 € im Juni), über drei verschiedene Zeiträume:

| Bericht | Ergebnis |
|---|---|
| 7 Wareneinsätze (Jahr) | HTTP 500, leerer Body |
| 8 Personalkosten (Jahr) | HTTP 500, leerer Body |
| 9 Urlaubsverteilung | HTTP 500, leerer Body |
| 23 Personalkostenschätzung | HTTP 500, leerer Body |
| 24 Personalrechner | HTTP 500, leerer Body |
| **107 Gearbeitete Stunden** | HTTP 500, leerer Body — auch für Mai 2026, März 2026, Gesamtjahr 2025 — *über `getReport` (falscher Endpunkt, Korrektur 7); über `getHoursWorked` antwortet er, siehe Abschnitt 8* |
| **118 Wareneinsatz und Deckungsbeitrag** | HTTP 500, leerer Body |
| 97 Tagesabschluss | ✅ 200, 55 kB JSON |
| 114 Mitarbeiter Verpflegung / Kost-Sach-Bezug | ✅ 200, JSON |

Der Gegentest ist das Entscheidende: **derselbe Betrieb, dieselben Parameter, dasselbe
Datumsformat** — 97 und 114 liefern sauberes JSON, die ganze Personal- und
Wareneinsatzgruppe nicht. Kein Datenproblem, kein Holding-Problem: für diesen Account
sind diese Berichte gesperrt oder nicht lizenziert.

**Konsequenz:** `getReport:107` steht wieder auf `aktiv: false`. Aktiviert hätte er rund
8.500 Backfill-Anfragen für garantiert leere Antworten gekostet.

**Damit bleibt es dabei: die Mitarbeiterstunden bekommen wir nicht.** `getPersonalkosten`
liefert nachweislich nur `effService`, `effBar`, `effKueche`, `effGesamt`, die
`pek*`-Quoten, `pekThreshold`, `thresholds` und `persoogBwa` — keine Stunden, keine
Lohnsummen. Es ist keine Nachlässigkeit unsererseits, sondern eine Rechtefrage, die nur
Concept Family mit LINA klären kann.

---

## 3. WAWI ist eine vollwertige JSON-API

Alles `application/json`, alles per GET erreichbar:

| Endpunkt | Umfang | Inhalt |
|---|---|---|
| `/wawi/api/items?archive=0` | 898 Sätze, 482 kB | **Waren mit Einkaufspreisen.** Felder: `price`, `prices`, `supplierId`, `unitId`, `unitName`, `ve`, `ve_unit`, `groupId`, `inStock`, `soll`, `missing` |
| `/wawi/api/suppliers` | 540 Sätze, 216 kB | Lieferantenstamm inkl. Kreditor, Gegenkonten, Mindestbestellwert, Liefertage |
| `/wawi/api/units` | 2,5 kB | 32 Einheiten mit `factor` und `baseUnit` |
| `/wawi/api/groups` | 1 Satz | Warengruppen — im aktuellen Kontext nur eine |
| `/wawi/api/orders` | 4 Sätze | Bestellungen mit `posten` und `articleSum` |
| `/wawi/inventory/inventory` | 11 Termine | Inventurstichtage mit `isEditable` |

**Der Preisaufbau ist wertvoller als erwartet.** `prices` ist kein einzelner Wert, sondern
ein Objekt je Lieferantenpreis:

```json
{"249":{"id":249,"ware_id":1,"unit_id":1,"seller_id":1,"seller_sku":"108661",
        "ordertype":"single","updated":1361833200,"qty":1,"bulk_qty":6,
        "price":5.20,"base_unit_mult":1}}
```

Also: Preis je Lieferant, mit Artikelnummer beim Lieferanten, Gebindegröße, Umrechnung
auf die Basiseinheit — **und `updated` als Unix-Zeitstempel**. Damit ist erkennbar, wann
ein Preis zuletzt geändert wurde, aber es ist **keine Preishistorie**: gespeichert ist nur
der jeweils aktuelle Stand. Wer die Preisentwicklung über die Jahre haben will, muss ab
jetzt regelmäßig Momentaufnahmen ziehen. Rückwirkend ist das nicht nachholbar.

**Wichtige Einschränkung:** Die WAWI-Daten hängen am aktuell gewählten Betrieb. Mit dem
Zentral-Kontext kommen 898 Waren, 540 Lieferanten und nur 4 Bestellungen zurück. Ob und
wie sich der Betriebskontext für WAWI umschalten lässt, ist **offen** — `storeId` als
Parameter wird hier nicht ausgewertet.

---

## 4. Rezepturen: kein JSON

`/wawi/rezept/recipe` ist eine Seitenhülle, `/wawi/rezept/recipeedit?items=b-<base64>`
liefert 1,4 MB **HTML** je Rezept. Die Zutatenzeilen stehen nicht als Datenstruktur darin;
in `recipeEdit.js` gibt es nur Schreibpfade (`updaterecipe`, `calcweajax`, `artnrvalid` —
alle POST) und keinen Lese-Endpunkt.

Der eingebettete Kalkulationsblock ist immerhin da:

```
Preis | Deckungsbeitrag | Wareneinsatz
Standardpreis / Kleine Portion / Fixierter Preis  →  je € / € / %
```

**Einschätzung:** Rezepturen sind nur über HTML-Auswertung je Artikel zu holen — bei 9.132
Artikeln × 1,4 MB rund 12 GB Abruf. Das ist kein realistischer Weg, und es wäre auch
fragil. Der praktikable Ersatz bleibt `fixed_we` aus dem Artikelverkaufsbericht, den wir
über `core.artikel_stand` jetzt monatsgenau historisieren. Die eigentliche Rezeptur — welche
Zutat in welcher Menge — bekommen wir nicht.

---

## 5. Der beste unerwartete Fund: die Sortimentshierarchie

`/wawi/rezept/articleApi?franchise=1` — **ein einziger Aufruf, 3,2 MB, 9.132 Artikel**:

```json
{"id":19324,"name":"0,75l Badnerbub","artnr":300213,
 "mec":"Weine (2900)","detailcat":"Weisswein (3000)","grosscat":"Getränke (2)",
 "group_ids":[5],"encId":"…"}
```

Dreistufige Warengliederung je Artikel:

| Ebene | Anzahl | Beispiel |
|---|---|---|
| `grosscat` | 8 | Speisen (1) · 4.634 Artikel, Getränke (2) · 3.836, Sonstiges/Divers (5) · 606, Pfand · 32, Gutscheine · 8, Lieferkosten · 8, Trinkgeld · 3 |
| `mec` | **329** | Weine (2900), Klassiker (13400), Burger Day (99952), Greenday (26190) |
| `detailcat` | **278** | Weisswein (3000), Lieblingsspeisen (13400), Aktion Getränke (26500) |

Das ist die Zuordnung, die den 334 Feinsparten aus `analyticsFilterOptions` entspricht —
**hier aber je Artikel**, nicht nur als Liste. Damit wird aus dem Artikelverkaufsbericht
eine echte Sortimentsanalyse: Deckungsbeitrag je Warengruppe, Preisentwicklung je
Kategorie, Anteilsverschiebungen zwischen Speisen und Getränken über Jahre.

Ohne diesen einen Aufruf sind das alles nur Artikelnummern.

Ohne `franchise=1` liefert derselbe Endpunkt 1.428 Artikel — die des aktuellen Betriebs.

---

## 6. Dienstplan

`/personal/dienstplanApi/dienstplaene` liefert JSON, aber nur **drei** Pläne:
Bürodienstplan, Notfall ZAV, Internorga — alles Zentrale, kein Restaurantbetrieb.
`/personal/dienstplanApi/dienstplan?dpid=…&start=…&end=…` liefert dafür sauberes JSON
(21 kB je Woche). Ein `storeId`-Parameter wird **nicht** ausgewertet — die Liste bleibt
bei drei.

Die Restaurant-Dienstpläne hängen also am Betriebskontext, den wir über diese API nicht
umschalten können. Zusammen mit den gesperrten Personalberichten heißt das: **an die
geplanten wie an die geleisteten Stunden kommen wir derzeit nicht.**

`reservation-summary` antwortet mit 200 und leerem Array — im Zentral-Kontext erwartbar.

---

## 7. Was daraus folgt

**Nachziehen (Wert hoch, Kosten minimal):**

1. `articleApi?franchise=1` — Sortimentshierarchie je Artikel, ein Aufruf, monatliche Momentaufnahme
2. `analyticsFilterOptions` — die 334 Feinsparten als Dimension, bisher nicht gespeichert
3. `wawi/api/items` + `suppliers` + `units` — Einkaufspreise, monatliche Momentaufnahme. **Rückwirkend nicht nachholbar**
4. `wawi/inventory/inventory` — Inventurstichtage

~~**Streichen:** 107, 118, 23, 8, 7, 9, 24 — gesperrt, nicht bloß leer.~~ *(Stand 29.09.2026: 8 und 23 tragen `missingModule: [67]`, ein nicht gebuchtes Modul; 107 antwortet im Report Center des Mandanten, über `getHoursWorked`; 24, 7, 9 und 118 tragen kein `missingModule`, wurden aber nicht aufgerufen. Abschnitt 8.)*

**Nicht verfolgen:** Rezepturen über HTML (≈12 GB).

**Zurückgestellt, nicht ausgeschlossen:** Stundenzettel (HTML, kein JSON — Aufwandsfrage). Der
frühere Zusatzgrund „personenbezogen" ist seit dem 11.08.2026 keiner mehr, siehe
`entscheidungen.md`.

**Fragen an Concept Family bzw. LINA:**

- Lassen sich die Rechte für die Berichte 107 und 118 freischalten? Das ist der einzige Weg zu Stunden und zur LINA-eigenen Deckungsbeitragsrechnung.
- Wie schaltet man den Betriebskontext für WAWI und Dienstplan um? Ohne das bleiben Einkaufspreise und Bestellungen auf die Zentrale beschränkt.

---

## 8. Personal, Stunden und Kopfzahl — im Browser erhoben am 29.09.2026

Angemeldete Sitzung des Nutzers, Mandant *CONCEPT FAMILY Franchise AG*, nur `GET` — bis auf das
Blättern in `persozahl`, das die Oberfläche selbst als `POST` schickt. Kein Export, kein
Favorit, kein Mandantenwechsel. **Personen und Beträge Einzelner sind hier nicht festgehalten.**
Herleitung und Folgen: `lina-api-korrekturen.md`, Korrektur 10.

### 8.1 Menü: welches Personalblatt ist offen

`GET /common/api/menu` → Liste von Knoten mit `label`, `alias`, `type`, `data` (die Route),
`access`, `key`. **Die Route steht in `data`**, nicht in `route`/`url`/`link`/`href` — das war
die Lücke, die `d10` am 24.08.2026 nicht schloss. `type: "denied"` mit `access: false` ist ein
gesperrtes Blatt; die Oberfläche zeigt ein Schloss und lädt beim Klick nichts.

| Pfad im Menü | `data` | `type` | `access` |
|---|---|---|---|
| Team > Mitarbeiter (Ordner) | — | — | `true` |
| … > **Stammdaten** | `/personal/mitarbeiter/manageusers` | `denied` | **`false`** |
| … > **Vorgesetzte** | `/personal/mitarbeiter/vorgesetzte` | `denied` | **`false`** |
| … > Nutzerrollen | `/personal/mitarbeiter/role` | `url` | `true` |
| … > Nutzerrollen LINA | `/personal/rechtegruppen/index` | `vueroute` | `true` |
| … > Zeitkonten / Urlaubsplanung | `/personal/zeitkonto/zeitkonto` / `…/urlaub` | `url` | `true` |
| Team > Lohnbuchhaltung > Stundenzettel / Vorschüsse / Lohnrechner | `/personal/lohn/stundenzettel` / `/personal/mitarbeiter/vorschuss` / `/personal/mitarbeiter/lohnrechner` | `url` | `true` |
| Finance > Steuerberater > Upload Lohndateien | `/finanzen/stb/lohnup` | `url` | `true` |
| **Stores > Auswertungen > Sonstige > Personalstruktur** | `/intranet/auswertung/persozahl?admin=1&franchise=1` | `url` | `true` |

`Stores > Auswertungen` führt fünf Blätter: *Report Center*, *Report Konfiguration* (nicht
geöffnet — Konfiguration), *BWA*, *POS*, *Sonstige*.

### 8.2 `persozahl` — Kopfzahl je Betrieb, Monat und Anstellungsverhältnis

```
GET  /intranet/auswertung/persozahl?admin=1&franchise=1              erste Seite, Jahr 2025
GET  /intranet/auswertung/persozahl/admin/1/refyear/<jahr>           Jahresansicht (so ruft select_year sie auf)
POST /intranet/auswertung/persozahlSlice                             Blättern
     limit=10&offset=<n>&refyear=<jahr>           (x-www-form-urlencoded, X-Requested-With: XMLHttpRequest)
```

* **Format:** HTML, verschachtelt — eine äußere Tabelle, je Betrieb eine Zeile, darin je Spalte
  eine **innere Tabelle** mit einer Zeile je Anstellungsverhältnis. `document.querySelectorAll('table')`
  zählt deshalb 141 Tabellen bei nur **10 Betrieben** je Seite.
* **Umfang:** 31 Seiten à 10 (Pager „1 2 3 4 5 … 31") — bis zu 310 Zeilen; die Berichte kennen 141
  Betriebe. Nicht geprüft, welche Zeilen die Differenz sind (Testläden, geschlossene Gesellschaften, Holdings).
* **Zeilen je Betrieb:** *angestellter Geschäftsführer, Azubi, Fest- Teilzeitangestellter, Freier
  Mitarbeiter, Gesellschafter-Geschäftsführer, kurzfristige Beschäftigung, Minijob, Praktikant,
  Student*, dazu *Gesamt nach Kündigungsschutzgesetzt* (gewichtet: > 30 h Faktor 1, 20–30 h 0,75, bis
  20 h 0,5, Azubis nicht) und *Gesamt nach Berechnung Jahr* (Jahresarbeitszeit 2080 h).
* **Spalten:** `Laden`, `Anstellungsverh.`, Monate `1`–`12`, `Durchschnitt`. Zahlen deutsch (`10,08`).
* **Jahr:** Auswahlliste ab 2008. **Excel-Export** `…/refyear/<jahr>/csv/1` — **nicht aufgerufen**
  (Regel 1: kein Export anstoßen).
* **Schlüssel:** der Betriebsname im Klartext, **keine `encId`, keine LINA-ID** — Zuordnung über
  den Namen, und der ist nicht eindeutig (Betriebsname-Falle, `AGENTS.md`).
* **Blätterzustand:** der Aufruf von `…/refyear/2026` lieferte als erste Zeile „Aposto Gera" statt
  „A Testladen" — der Offset des zuletzt gesehenen `persozahlSlice` scheint serverseitig in der
  Sitzung zu hängen. Beobachtet, nicht gesichert. Ein Import setzt `offset` immer selbst.
* **Zukunftsmonate:** befüllt (Oktober–Dezember 2026 am 29.09.2026), Herkunft ungeklärt — siehe
  Korrektur 10 b.
* **Was es nicht ist:** kein Ein-/Austritt, keine Person, kein Bereich. Ein Bestand.

### 8.3 Report Center des Mandanten — `Analytics > Reportcenter`

`/finanzen/analytics/reports`. Katalog `GET /finanzen/analytics/reportList` (Baum mit `id`, `name`,
`route`, `req_modules`, **`missingModule`**, `date_select`, `config`). `req_modules` nennt die
Module, die der Bericht braucht; `missingModule` die davon **nicht gebuchten**. Ein Bericht mit
gefülltem `missingModule` antwortet leer oder mit 500 — das ist die Erklärung für 8 und 23
(`[67]`), nicht ein Rechtemangel. Ohne `missingModule` und `disabled: false`: 107 („Gearbeitete
Stunden", Module 10, 2; aufgerufen), 24 („Personalrechner", 10, 2), 118, 7, 9 (nicht aufgerufen).

Auswahl eines Berichts **lädt ihn sofort** (kein „Anzeigen" nötig), Zeitraum-Schnellwahl
(„Letzter Monat") ebenfalls. Wer nur schauen will, ändert nichts, aber ruft dabei Berichte ab.

```
GET /finanzen/analytics/getHoursWorked?report=107&von=1.8.2026&bis=1.8.2026&reltime=lastMonth&interval=8
→ {from, to, rows:[{name, anstellung, stunden_soll, stunden_ist, abweichung, state}]}
```

Je **Person** eine Zeile (Name, Anstellungsverhältnis, Soll- und Ist-Stunden des Monats). Im
Mandanten *Franchise AG*: eine Zeile — dessen eigenes Personal. `von` und `bis` tragen beide den
**Ersten** des Monats (`date_select: month`). Ob der Bericht mit Betriebskontext Betriebe
liefert, ist offen.

### 8.4 Konzern-Report-Center — `Stores > Auswertungen > Report Center`

`/intranet/analytics/reportcenter`. Berichtsauswahl: *Umsatzbericht, Umsatzentwicklungbericht,
Zeitzonenbericht, Artikelverkaufsbericht, Aktionsbericht, **Personalkosten**, Vordefinierte
Zeitzonen, Kennzahlen* — **kein** Stundenbericht. Filter: Zeitraum-Schnellwahl (Gestern, Akt. Monat,
Letzter Monat, 30/60/90 Tage, Dieses/Letztes Jahr, Individuell), Betriebe, Konzepte,
Verkaufsstellen, Hauptsparten, Feinsparten, Artikel, Aktion, Wertart Netto/Brutto,
Wochentage, Vergleichszeitraum. **Favoriten („Neu", „+") und „Automatischer E-Mail Versand"
sind Schreibfunktionen und wurden nicht berührt.**

```
GET /intranet/analytics/getPersonalkosten
    ?report=intranet-personalkosten&von=01.08.2026&bis=31.08.2026&reltime=custom&brutto=0&preExistingRevenue=0
```

Tag: `von=bis=28.09.2026`. Tabellenspalten: *Betrieb, Eff. Service/Bar/Küche/Gesamt, PEK
Service/Bar/Küche/Gesamt, **Pers.kosten o. GF (BWA)*** — Letzteres ist `persoogBwa`, „–" wo die BWA
fehlt. **Betriebe ohne Wert stehen mit „–", nicht mit 0** in der Oberfläche; die JSON-Antwort führt sie mit `0`.

Nachmessung Monat gegen BWA, Stundensätze und Tageswert: `lina-api-korrekturen.md`, Korrektur 10 c/d.

### 8.5 Dashboard des Mandanten — `chartjson`

`GET /finanzen/api/chartjson?von=<epoch>&bis=<epoch>&charts=forecast|verkaufsstelle|umsatzperso`
(FusionCharts-JSON). `umsatzperso`: 24 Stundenkategorien (08:00 bis 07:00, der Geschäftstag
beginnt um 8), je Wochentag die Reihen *Umsatz*, *Personalkosten* (linke Achse, €) und
*Effektivität* (rechte Achse, €/h). Im Mandanten *Franchise AG* überall 0. Mit Betriebskontext
nicht gemessen.
