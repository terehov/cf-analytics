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
| **107 Gearbeitete Stunden** | HTTP 500, leerer Body — auch für Mai 2026, März 2026, Gesamtjahr 2025 |
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

**Streichen:** 107, 118, 23, 8, 7, 9, 24 — gesperrt, nicht bloß leer.

**Nicht verfolgen:** Rezepturen über HTML (≈12 GB), Stundenzettel (personenbezogen, HTML).

**Fragen an Concept Family bzw. LINA:**

- Lassen sich die Rechte für die Berichte 107 und 118 freischalten? Das ist der einzige Weg zu Stunden und zur LINA-eigenen Deckungsbeitragsrechnung.
- Wie schaltet man den Betriebskontext für WAWI und Dienstplan um? Ohne das bleiben Einkaufspreise und Bestellungen auf die Zentrale beschränkt.
