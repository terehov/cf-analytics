# LINA API Inventory — Nachtrag Phase 1b

**Erhebungsdatum:** 25.07.2026 · **Methode:** wie Phase 1 (Claude in Chrome, nur lesend, sequenziell mit Jitter)
Ergänzt `lina-api-inventar.md` um die Bereiche Team, Finance/BWA, Buy/WAWI und den Stornobericht.

---

## 1. Der zentrale Fund: es gibt **zwei** Report Center

| | Konzern-Ebene | Betriebs-Ebene |
|---|---|---|
| UI-Pfad | `/intranet/analytics/reportcenter` | `/finanzen/analytics/reports` |
| Menü | Stores > Auswertungen > Report Center | Analytics > Reportcenter |
| Anzahl Berichte | **7** | **72** |
| Scope | alle 141 Betriebe in einer Response | **nur der aktiv gewählte Betrieb** |
| Daten-Endpunkt | `getUmsatzbericht`, `getPersonalkosten`, … (je Bericht einer) | **`getReport?report=<id>`** (ein generischer für alle 72) |
| Datumsformat | `01.06.2026` (führende Nullen) | `1.6.2026` (**ohne** führende Nullen) |
| Filter | Betriebe, Konzepte, Verkaufsstellen, Haupt-/Feinsparten, Wochentage, Aktion | Artikel, Feinsparten, **Kellner**, **Tisch**, Betriebsstellen, Verkaufsstellen, Wochentage, Intervall |

Das erklärt, warum in Phase 1 der Stornobericht nicht auffindbar war: Er lebt auf der Betriebs-Ebene.

### 1.1 Der generische Endpunkt

```
GET /finanzen/analytics/getReport?report=<id>&von=1.6.2026&bis=30.6.2026&reltime=lastMonth&interval=8
```

**Einheitliche Response-Hülle für alle 72 Berichte:**
```json
{
  "possibleIntervals": [{"value":8,"name":"Kumuliert"}],
  "defaultInterval": 8,
  "title": "Stornobericht",
  "timeframe": "01.06.2026 - 30.06.2026",
  "from": 1780264800, "to": 1782856799,
  "balanceSumBrutto": 0, "balanceSumNetto": 0, "balanceSumCount": 0,
  "balanceSumBruttoExclusive": 0, "balanceSumNettoExclusive": 0, "balanceSumCountExclusive": 0,
  "nGaesteGesamtExclusive": 0, "nAdults": 0, "nKids": 0, "nInfants": 0, "nBillsGesamt": 0,
  "isCurrentZCount": false, "zcounts": "",
  "filters": [],
  "errors": "Doppelte Artikelnummern, unbedingt korrigieren: ",
  "tableHead": [[{"id":0,"field":"Artikelnummer","header":"Artikelnummer","sortable":""}, …]],
  "table": [{"businessDate":"01.06.2026 - 30.06.2026", …}],
  "chart": []
}
```

Das ist für den Importer ein Glücksfall: **ein Fetcher, ein Parser, 72 Berichte.** Die Spalten kommen dynamisch aus `tableHead[].field`, die Zeilen in `table` sind darauf geschlüsselt. Ein generischer Loader `fetchReport(id, von, bis)` reicht.

### 1.2 Zeitzone — endgültig geklärt

`from = 1780264800` → `2026-05-31T22:00:00Z` → **2026-06-01T00:00:00 Europe/Berlin (CEST, UTC+2)**
`to = 1782856799` → `2026-06-30T23:59:59 Europe/Berlin`

→ **Der Server rechnet in `Europe/Berlin` und ist DST-bewusst.** Für Phase 2: `timestamptz` in Postgres, Business-Datum als `date` in Europe/Berlin separat mitführen. In Kombination mit dem `hours`-Array des Zeitzonenberichts (08:00 → 07:59 Folgetag) ist die Geschäftstag-Definition damit vollständig.

### 1.3 Zwei Fallstricke für den Importer

**`errors` ist ein Daten-Qualitäts-Kanal.** Der Stornobericht lieferte `"Doppelte Artikelnummern, unbedingt korrigieren: "`. Dieses Feld muss ins Monitoring — es ist kein technischer Fehler, sondern ein fachlicher Hinweis aus LINA.

**HTTP 500 bedeutet nicht zwingend „Serverfehler".** Die Berichte 2 (BWA Jahresübersicht), 3 (BWA monatlich), 107 (Gearbeitete Stunden), 23 (Personalkostenschätzung) und 118 (Wareneinsatz und Deckungsbeitrag) antworten für den aktuell gewählten Mandanten durchgängig mit **HTTP 500 und leerem Body** — vermutlich weil „CONCEPT FAMILY Franchise AG" eine Holding-Entität ohne eigene POS-/BWA-Daten ist. Bericht 38 (Storno) liefert dagegen sauber `200` mit leerer Tabelle.
→ **Der Importer darf 500 nicht blind als Retry-Fall behandeln**, sonst läuft er in Endlosschleifen gegen Betriebe ohne Daten. Regel: 500 + leerer Body ⇒ einmal loggen, Betrieb/Bericht-Kombination merken, nicht erneut versuchen.

### 1.4 Der Storno-Fund

| ID | Bericht | Route |
|---|---|---|
| 38 | **Stornobericht** | `finanzen/kassereport/prev/cat/artikel/kind/Storno` |
| 39 | **Stornogrundbericht** | `…/kind/CancelReason` |
| 58 | **Stornobericht pro Kellner** | `…/cat/kellner/kind/Storno…` |
| 92 | Rabattbericht (Hausbon) | `…/cat/buch/kind/Hausbon` |
| 113 | Tischtransfer | `…/cat/buch/kind/TableTransfer` |
| 59 | Tischübergabe pro Kellner | `…/cat/kellner/kind/…` |

**Spalten des Stornoberichts:** `Artikelnummer`, `Artikel`, **`Stornotyp`**, `Anzahl`, `Umsatz_Brutto`, `Umsatz_Netto`.
Das Feld `Stornotyp` ist vermutlich die Unterscheidung, nach der im Auftrag gefragt wurde (Storno vs. Trainings-/Übungsbuchung). Die Stornogründe selbst sind Stammdaten unter `POS > Stammdaten > Stornogründe` (`/wawi/badata/cancelreq`).
Ein separater „Trainingsbuchungs"-Bericht existiert nicht — Trainingsbuchungen sind vermutlich ein `Stornotyp`-Wert. **Zu verifizieren an einem Betrieb mit echten Daten.**

### 1.5 Katalog der 72 Betriebs-Berichte

| Gruppe | Anzahl | Für uns besonders relevant |
|---|---|---|
| (Direkt) | 7 | Die letzten Tage (`vue:LastDays`), Die letzten Jahre, Tagesverlauf, Tagesanalyse, **Wetteranalyse**, **BWA Jahresübersicht** (id 2), **BWA monatlich** (id 3) |
| LINA AI Reports | 1 | **Auffällige Buchungen** (`vue:AnomalieDetection`) — LINA hat bereits Anomalieerkennung |
| Jahresbezogene Auswertungen | 5 | Umsatzentwicklung, Kostenaufteilung, **Wareneinsätze**, **Personalkosten**, Urlaubsverteilung |
| Monatsbezogene Auswertungen | 7 | **Gearbeitete Stunden** (107), **Wareneinsatz und Deckungsbeitrag** (118), Personalkostenschätzung (23), Ranking, Personalrechner, Gutscheinumsatz, **Reservierungen** |
| Artikelbezogen | 19 | Artikelverkaufsbericht (7 Varianten), **Storno** (38), **Stornogrund** (39), Umsatz nach Fein-/Hauptsparten/MecCodes/Sparten |
| Kellnerbezogen | 9 | Umsatz pro Kellner, **Zusatzverkauf-Basis**, Finanzwege, Gutschriften, Stornos, Tischübergaben |
| Betriebswirtschaftliche Reports | 8 | Aktionsreport, Umsatz nach Betriebsstellen/Tischen/Verkaufsstellen, Zeitzonenberichte (3 Varianten) |
| Listen und Tabellen | 2 | Gutscheine im Umlauf, Gutscheintransaktionen |
| Buchhalterische Reports | 11 | Debitoren, **Mitarbeiter Verpflegung/Kost-Sach-Bezug**, Erweiterter Tagesabschluss, Finanzwege, Monatsaufstellung Tag für Tag, **Rabattbericht**, Tischtransfer, Rechnungsausgangsbuch, Tagesabschluss, Unbare Zahlungen |

Damit sind aus der Wunschliste `Umsetzung Berichte` zusätzlich abgedeckt: Stornobericht, Tenderverkauf/Rabatt, Zusatzverkauf pro Kellner, Gutscheinverkauf und Einlösung, Personalverzehr (Kost-Sach-Bezug), Wareneinsatz nach Sparte/Verkaufsstelle/Zeitzone.

---

## 2. Team / Personal

| Zweck | Endpunkt | Format |
|---|---|---|
| Dienstplan-Liste | `GET /personal/dienstplanApi/dienstplaene` | **JSON** ✔ |
| Dienstplan-Daten | `GET /personal/dienstplanApi/dienstplan?dpid=<hex>&start=<unix>&end=<unix>` | JSON, **Unix-Timestamps** |
| Reservierungen | `GET /personal/dienstplan-api/reservation-summary?von=<unix>&bis=<unix>` | JSON |
| Stundenzettel | `GET /personal/lohn/stundenzettel` | **HTML, kein JSON** ✘ |
| Zeitkonten | `/personal/zeitkonto/zeitkonto` | HTML (legacy) |
| Urlaubsplanung | `/personal/zeitkonto/urlaub` | HTML (legacy) |
| Mitarbeiter-Stammdaten | `/personal/mitarbeiter/manageusers` | **`access: false`** für den genutzten Account |

**`dienstplaene`-Schema:**
```json
[{"id":"<hex-token>","number":0,"fields":0,"name":"Bürodienstplan","active":1,
  "bereichLocal":"…","taetigkeit":0,"wochen":1,"wochenstart":0,"format":0,
  "umsatz":0,"eff":0,"endzeitenAnzeigen":0,"sysrel":0,"global":"…","shiftGroupsEnabled":0}]
```
Interessant: `umsatz` und `eff` im Dienstplan-Objekt → LINA hinterlegt bereits Umsatz-/Effektivitätsziele je Dienstplan. Das ist die Grundlage für die im Projekt gewünschte „datengestützte Dienstplanerstellung".

**Wichtige Einschränkung:** Für den genutzten Account gilt „Keine Berechtigung für diesen Dienstplan vorhanden". Die API antwortet trotzdem mit 200 — die Rechteprüfung passiert im Frontend bzw. liefert leere Daten.

**Der Stundenzettel ist ein Problem.** Er ist eine serverseitig gerenderte, **editierbare** Seite je Mitarbeiter und Monat (Spalten: Datum, h gesamt, Zuschlagsstufen, Kost, TD von/bis, Von/Bis, Pause, Tage, Bereich; dazu Stammdaten Anstellungsverhältnis, Wochenstunden, Stunden/Tag). Es gibt **keine JSON-API**.
→ Für „Lohnniveau, Krankenstand, MA-Kosten pro Stunde" ist DOM-Scraping je Mitarbeiter × Monat **die falsche Antwort** (Aufwand, Fragilität, und man tippt auf einem Eingabeformular herum). **Der bessere Weg sind die aggregierten Betriebs-Berichte:** `107 Gearbeitete Stunden`, `23 Personalkostenschätzung`, `8 Personalkosten (Jahr)`, `9 Urlaubsverteilung` — alle über `getReport` als JSON. Personenbezogene Einzeldaten brauchen wir für das Reporting ohnehin nicht (Datenminimierung).

---

## 3. Buy / WAWI — vollständige JSON-API ✔

| Endpunkt | Inhalt |
|---|---|
| `GET /wawi/api/items?archive=0` | **898 Einkaufsartikel** (~490 KB) |
| `GET /wawi/api/suppliers` | **540 Lieferanten** (~220 KB) |
| `GET /wawi/api/groups` | Warengruppen |
| `GET /wawi/api/units` | **32 Einheiten mit Umrechnungsfaktoren** |
| `GET /wawi/api/orders` | Bestellungen inkl. Positionen |
| `GET /wawi/inventory/inventory` | Inventur |
| `GET /wawi/inventory/usedGroups` | Inventur-Gruppen |
| `POST /wawi/api/getdeliverydates` | Liefertermine (POST — nur lesend genutzt, hier **nicht** aufgerufen) |

**`items`-Schema:**
```json
{"id":n,"aktiv":true,"name":"…","number":"…","groupId":n,"groupName":"…","price":x,
 "supplierId":n,"bestellt":n,"inStock":n,"missing":n,"soll":n,
 "ve":n,"ve_lager":n,"ve_unit":"…","ve_unit_id":n,"unitId":n,"unitName":"…",
 "prices":{"<supplierId>":{"id":n,"active":n,"ware_id":n,"unit_id":n,"seller_id":n,
   "seller_sku":"…","ordertype":"…","updated":n,"qty":n,"bulk_qty":n,"price":x,"base_unit_mult":n}},
 "addSupps":[],"isSynced":n,"inNewOrder":false}
```

**`units`-Schema:** `{ID, name, abk, parent, factor, baseUnit}` — mit `factor`/`parent` lässt sich sauber auf Basiseinheiten normalisieren. Genau das, was `Auswertung WAWI` als Voraussetzung fordert.

**`orders`-Schema:**
```json
{"bestellid":n,"lieferant":n,"created":<unix>,"bestellt_am":<unix>,"send_method":n,
 "liefertermin":<unix>,"geliefert":n,"status":n,"abgeschlossen":"…","bereich":n,
 "besteller":n,"articleCount":n,"articleSum":x,
 "posten":[{"bestellschein":n,"ware":n,"unit_id":n,"menge":x,"abweichend":n,"komplett":n,
   "wareName":"…","artNr":"…","unitPrice":null,"sellerId":n,"sellerName":"…",
   "totalPrice":x,"priceDate":<unix>,"prices":[…],"dataHubLink":null}]}
```

→ **Einkauf, Lieferanten, Bestellungen und Einheiten sind vollständig und sauber per JSON verfügbar.** Zusammen mit `fixed_we` aus dem Artikelverkaufsbericht ist damit „Theoretischer WE vs. BWA" und „WE und DB pro Artikel" rechenbar — **ohne Foodnotify-Anbindung.** Das ist ein größerer Fund, als es zunächst aussieht: Die Projektbeschreibung geht davon aus, dass Foodnotify für Einkaufsartikel und Rezepturen angebunden werden muss; die Einkaufsseite liegt bereits in LINA.

Offen bleibt nur die **Rezepturauflösung** (Artikel → Zutaten). `POS > Verkauf > Artikel` zeigt auf `/wawi/rezept/recipe` — **noch nicht geprüft.**

---

## 4. Finance / BWA

| Endpunkt | Inhalt |
|---|---|
| `/finanzen/abrechnung/monatueb` | Monatsübersicht: Netto-Umsätze nach Steuersatz, Aktueller Monat / Vormonat / Vorjahr / Kumuliert / Vorjahr kumuliert — **serverseitig gerendert** |
| `/finanzen/abrechnung/monthOverview` | Monatsabschluss |
| `/finanzen/abrechnung/kassenblatt2` | Kassenbuch |
| `/finanzen/document/posBills` | Rechnungen |
| `/finanzen/document/billcollectionlist` | Sammelrechnungen |
| `/finanzen/document/archive` | Belegarchiv |
| **`/finanzen/stb/import`** | **BWA/SuSa-Import vom Steuerberater** |
| `/finanzen/stb/export` | Datenexport an den Steuerberater |
| `/finanzen/stb/lohnup` | Upload Lohndateien |
| `/finanzen/report/kassenjournal` | **Kassen-Journal** (Bon-Rohdaten) |
| `/finanzen/report/forecast` | Forecast |
| `/finanzen/stat/umsatzwetter` | Wetteranalyse |

**Wichtigster Befund:** `Finance > Steuerberater > BWA/SuSa - Import`. Die BWA-Zahlen entstehen **nicht** in LINA, sie werden vom Steuerberater importiert. Das erklärt den Zeitverzug von 1–2 Monaten aus Phase 1 abschließend und heißt für die Pipeline:

* Der BWA-Stand ist eine Funktion des Import-Zeitpunkts, nicht des Geschäftsmonats.
* Zahlen können sich **rückwirkend ändern** (Nachbuchungen, korrigierte SuSa).
* → Der Raw-Layer muss **append-only** sein und jeden Abruf mit `fetched_at` versionieren. Nur so ist rekonstruierbar, welcher BWA-Stand einem Round-Table-Report zugrunde lag. Genau dafür gibt es im Excel die `Ampelhistorie`.

Das Menü zeigt bei „Finance" bzw. „Fragen zu Buchhaltung" ein Badge **20** — 20 offene Buchhaltungsrückfragen. Für ein Ops-Dashboard evtl. selbst eine Kennzahl.

---

## 5. Aktualisierte Lückenliste

| Thema | Status nach 1b |
|---|---|
| Stornobericht | ✅ **gefunden** — `getReport?report=38`, Spalte `Stornotyp` |
| Trainingsbuchungen | 🟡 vermutlich `Stornotyp`-Ausprägung — an Betrieb mit Daten verifizieren |
| Einkauf / Lieferanten / Bestellungen | ✅ **vollständige JSON-API** |
| Einheiten-Umrechnung | ✅ `/wawi/api/units` mit `factor` |
| Inventur | ✅ `/wawi/inventory/inventory` |
| Theoretischer WE | ✅ rechenbar (`fixed_we` × `counts` vs. BWA) — **ohne Foodnotify** |
| Rezepturen | 🟡 `/wawi/rezept/recipe` — noch nicht geprüft |
| Gearbeitete Stunden / Personalkosten je Betrieb | ✅ als Bericht (107, 23, 8) — 🔴 aktuell HTTP 500 mangels Daten/Rechten |
| Lohnniveau, Krankenstand je Mitarbeiter | 🔴 nur HTML-Stundenzettel — bewusst **nicht** verfolgen |
| Dienstplan (Soll-Stunden) | ✅ JSON-API, 🔴 Rechte fehlen |
| Reservierungen | ✅ `reservation-summary` (JSON) — Quelle für OpenTable-Thema |
| Wetterdaten | ✅ Wetteranalyse-Bericht vorhanden |
| Holding (Darlehen, Budget, EK-Konsolidierung) | 🔴 unverändert — existiert in LINA nicht |
| Online-Bewertung (YEXT), OM-Score, Ursachen, Maßnahmen | ✅ **entschieden:** werden als eigene Tabellen/Quelle modelliert (siehe unten) |

---

## 6. Entschieden: YEXT und OM-Score

Auf Rückfrage bestätigt: **Online-Bewertung und OM-Score kommen nicht aus LINA und werden separat modelliert.**

**Online-Bewertung — Quelle YEXT.** YEXT hat eine dokumentierte REST-API (Reviews/Analytics). Vorschlag für Phase 2/3:
* eigene Quelle `yext` im Raw-Layer, eigener Sync-Job, eigener Rhythmus (täglich reicht)
* Mapping YEXT-Location → LINA-Betrieb als explizite Mapping-Tabelle (`dim_store_external_ids`) — Namen matchen nicht zuverlässig, das braucht eine gepflegte Zuordnung
* Kennzahlen: Ø-Bewertung, Anzahl Bewertungen, Verteilung, Zeitverlauf, unbeantwortete Reviews

**OM-Score — manuelle Eingabe.** 1–5, subjektive Vor-Ort-Einschätzung des Operations Managers, je Betrieb und Monat. Zusammen mit den **Ursachen** (21 Werte aus `Regeln!G2:G22`) und dem **Maßnahmen-Tracking** ist das die Klasse „von Menschen gepflegte Daten":

```
fact_om_assessment   (store_id, period_month, om_score, assessed_by, assessed_at, note)
fact_cause           (store_id, period_month, bereich, cause_code, note)
fact_measure         (id, store_id, period_month, bereich, cause_code, measure,
                      responsible, due_date, status, priority, progress, notes,
                      created_at, updated_at)
dim_cause            (cause_code, label, sort_order)
```

**Wichtig:** Metabase kann nicht schreiben. Für diese drei Tabellen braucht es entweder ein kleines Eingabe-UI (passt gut in den Bun/TS-Service als schlanke Maske) oder — als Zwischenlösung für den ersten Round Table — einen Excel-/CSV-Upload, der in dieselben Tabellen schreibt. Ich würde mit dem Upload starten und das UI erst bauen, wenn die Dashboards stehen.

---

## 7. Offene Punkte für Phase 2

1. **Rezepturen** (`/wawi/rezept/recipe`) prüfen — letzter größerer weißer Fleck.
2. **`Stornotyp`-Ausprägungen** an einem Betrieb mit echten Daten verifizieren.
3. **Mandanten-/Betriebswechsel:** Die 72 Betriebs-Berichte sind session-gebunden an den aktiven Betrieb. Wie der Importer zwischen 141 Betrieben wechselt, ist noch ungeklärt — und das ist **die** offene Architekturfrage für Phase 3. Ich habe bewusst nicht getestet, ob ein Betriebswechsel per API geht, weil das Session-Zustand verändert hätte.
4. **Service-Account mit vollen Rechten** — ohne den bleiben BWA, Dienstplan und Personalberichte leer bzw. werfen 500.
