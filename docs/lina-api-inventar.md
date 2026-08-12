# LINA API Inventory — Phase 1 Exploration

**Projekt:** Lina-Kassensystem → Postgres → Metabase Analytics-Pipeline (Concept Family AG)
**Erhebungsdatum:** 25.07.2026
**System:** LINA TeamCloud, `https://app.lina.de`
**Mandant:** CONCEPT FAMILY Franchise AG
**Erhebungsmethode:** Interaktive Exploration in der echten Browser-Session (Claude in Chrome), Mitlesen aller XHR/Fetch-Calls, Auslesen der Vue-Bundles. **Ausschließlich lesende Zugriffe**, sequenziell mit 1,5–4 s Jitter.

> **Hinweis zum Werkzeug:** In dieser Session war kein Playwright-MCP verbunden. Die Exploration lief über *Claude in Chrome* gegen die manuell eingeloggte Session von Evgenij Terehov. Für Phase 3 ist das insofern relevant, als der Session-Reuse-Fallback dort mit Playwright gebaut werden kann — die hier dokumentierten Endpunkte sind davon unabhängig.

---

## 1. Architektur des Zielsystems

| Aspekt | Befund |
|---|---|
| Frontend | Legacy PHP/jQuery-Shell (`/intranet/…`) mit eingebetteter **Vue-3-SPA** (Vite-Bundles unter `/lina/assets/`, PrimeVue, ECharts, axios, pinia) |
| Analytics-Backend | `reportList` liefert `"starrocksAllowed": true` → **StarRocks** (spaltenorientierte OLAP-DB) als Auswertungs-Backend |
| Edge | Cloudflare (`cf-ray`, `cf-cache-status` in allen Responses) |
| Datenformat | JSON, `Content-Type: application/json` |
| Zeitformat | Datumsparameter **`DD.MM.YYYY`**, Response-`timeframe` als `"01.06.2026 - 30.06.2026"`. Keine Zeitzonenangabe, keine ISO-Timestamps, keine Uhrzeit → Server rechnet in lokaler Zeit (Europe/Berlin). **Offene Frage: Behandlung von Nachtumsätzen über Mitternacht** (siehe Zeitzonenbericht, Stunden-Array beginnt bei 8 und läuft bis 7 des Folgetags). |
| Paginierung | **Keine.** Alle Report-Endpunkte liefern immer *alle* 141 Betriebe in einer Response. Größte beobachtete Response: Artikelverkaufsbericht ≈ 2,0 MB. |

---

## 2. Authentifizierung & Session

| Aspekt | Befund |
|---|---|
| Login-Flow | Formular unter `/login?source=<base64(redirect-pfad)>`, gepostet wird aber auf **`/common/index/dologin`**. Felder: `username`, `password` (**MD5-Hex**), `system` (`a360` = LINA TeamCloud), `source`, `secret`. Das `secret` steht als `window.secret` in der Loginseite, 64 Hex-Zeichen, je Aufruf neu und nur einmal gültig. Aus `/js/common/login.js` verifiziert. Siehe `docs/importer.md`. |
| Session-Träger | **httpOnly-Cookie** — via `document.cookie` nicht sichtbar. Same-Origin-`fetch(..., {credentials:'include'})` funktioniert damit ohne zusätzlichen Header. |
| CSRF | Für die **lesenden** GET-Endpunkte kein CSRF-Token nötig oder beobachtet. Für schreibende Endpunkte (`saveFav`, `delfav`, `saveStoreSetting`) nicht geprüft — wurden bewusst **nicht** aufgerufen. |
| Bearer/Token | Kein Authorization-Header, kein JWT im Einsatz. Es existiert ein `/common/api/getWsTicket` (WebSocket-Ticket) — nicht weiter untersucht. |
| Token-Lifetime / Refresh | Nicht ermittelbar ohne Langzeittest. **Offene Frage für Phase 3.** |
| 2FA | Auf der Login-Maske nicht sichtbar. |
| Rate-Limits | **Keine** `X-RateLimit-*`- oder `Retry-After`-Header in irgendeiner Response. Vorhandene Header: `cache-control, cf-cache-status, cf-ray, content-encoding, content-security-policy, content-type, date, expires, nel, pragma, referrer-policy, report-to, server, strict-transport-security, x-content-type-options, x-frame-options, x-xss-protection`. → **Es gibt kein dokumentiertes Limit, an dem man sich orientieren könnte. Daher gilt umso strikter die selbstauferlegte Drosselung** (sequenziell, 1–4 s Jitter, Nachtfenster, Backoff). |
| IP-Sperren | Nicht beobachtet, aber Cloudflare davor → Bot-Management ist grundsätzlich möglich. |

### Rechte-Abhängigkeit der Daten (wichtig!)
`/common/api/account` liefert u. a. `user.isGf1`, `user.isGf2`, `user.gfDashboard`, `user.isTeamLeader`, `store`, `franchise`, `storeList`.
**Beobachtung:** Im Kennzahlen-Report sind für den verwendeten Account nahezu alle BWA-Werte `0,00` (nur Juni teilweise befüllt), während der Screenshot aus dem Strategiemeeting vom 24.07.2026 (Account *Daniel Gantenberg*) für dieselben Betriebe volle Jan–Jun-Werte zeigt.
→ **Der Importer-Service braucht einen Account mit vollen BWA-/Finance-Rechten**, sonst liefert `getKennzahlen` stillschweigend Nullen statt eines Fehlers. Das ist ein Silent-Failure-Risiko und muss im Monitoring abgefangen werden (Plausibilitätscheck: „Anteil Null-Werte > X % → Alarm").

### Sicherheitsbefund (bitte an Concept Family / Gastro-MIS melden)
`GET /einstellungen/api/getStoreData` (≈ 370 KB) liefert die vollständigen Stammdaten des aktiven Betriebs — darunter die Felder **`db_name`, `db_user`, `db_pass`** im Klartext, zusätzlich `iban`, `bic`, `steuernr`, `hrb`. Diese Werte wurden bewusst **nicht** ausgelesen, gespeichert oder weiterverarbeitet. Der Endpunkt ist trotzdem als Datenquelle für Stammdaten (Adresse, Öffnungszeiten, Gesellschafter, Geokoordinaten) interessant — dann aber mit strikter Feld-Whitelist im Importer.

---

## 3. Report-Center-Endpunkte

Basis: `https://app.lina.de/intranet/analytics/`
Alle Endpunkte: **GET**, Response JSON, Session-Cookie erforderlich.

### 3.1 Gemeinsame Query-Parameter

Aus den Vue-Bundles extrahiert und teilweise verifiziert:

| Parameter | Werte | Anmerkung |
|---|---|---|
| `report` | `intranet-umsatz`, `intranet-zeitzonen`, `intranet-artikel`, `intranet-aktion`, `intranet-personalkosten`, `intranet-vordefinierte-zeitzonen`, `intranet-kennzahlen` | bei `getKennzahlen` **nicht** mitgesendet |
| `von` / `bis` | `DD.MM.YYYY` | |
| `reltime` | `custom` (bei UI-Presets andere Werte) | |
| `brutto` | `0` = Netto, `1` = Brutto | |
| `preExistingRevenue` | `0` / `1` | UI: „Auf bestehende Fläche" |
| `vergleichTyp` | `vorjahr` \| `vorzeitraum` | schaltet `umsatzNettoV` / `diff` frei |
| `vergleichBetriebe`, `vergleichKonzepte` | ID-Listen | abweichende Vergleichsgruppe |
| `betriebe` | Betriebs-IDs (aus `analyticsFilterOptions.betriebe[].id`) | |
| `konzepte` | Gruppen-IDs (aus `analyticsFilterOptions.gruppen[].id`) | |
| `verkaufsstellen` | `number` aus `analyticsFilterOptions.verkaufsstellen` | |
| `hauptsparten` | **`posId`**, *nicht* `number` — verifiziert | `10001`=Speisen, `10002`=Getränke |
| `feinsparten` | `id` aus `analyticsFilterOptions.feinsparten` | 334 Einträge |
| `wochentage` | Mo–So | |
| `aktion` | Aktions-ID aus `getAktionen` | |
| `mode` | `absolut` \| `relativ` | **nur** `getKennzahlen` |

**Verifikation `hauptsparten`:** Juni 2026, alle Betriebe — ohne Filter 8.984.319,71 € netto; `hauptsparten=10001` → 3.439.853,17 €; `hauptsparten=1` (die `number`) → 0,00 €. Der Parameter erwartet also die `posId`.

---

### 3.2 `reportList`

```
GET /intranet/analytics/reportList
```

**Response** (1,1 KB):
```json
{"reports":[{"id":"intranet-umsatz","name":"Umsatzbericht","route":"vue:IntranetUmsatzbericht","type":"item","date_select":"dateRange","disabled":false}, …],
 "favs":[], "starrocksAllowed":true}
```
7 Reports: Umsatzbericht, Zeitzonenbericht, Artikelverkaufsbericht, Aktionsbericht, Personalkosten, Vordefinierte Zeitzonen, Kennzahlen (`date_select:"year"`).

**Zweck für uns:** Katalog-Discovery, Erkennung neuer Reports beim Monitoring.

---

### 3.3 `getUmsatzbericht` — Kern-Endpunkt

```
GET /intranet/analytics/getUmsatzbericht
    ?report=intranet-umsatz&von=01.06.2026&bis=30.06.2026
    &reltime=custom&brutto=0&preExistingRevenue=0&vergleichTyp=vorjahr
```

**Response** (≈ 34 KB, 141 Betriebe):
```json
{
  "timeframe": "01.06.2026 - 30.06.2026",
  "vergleichTimeframe": "01.06.2025 - 30.06.2025",
  "hasVergleich": true,
  "brutto": false,
  "stores": [
    {"name":"Betrieb 02","encId":"ENCID_001",
     "umsatzNetto":436198.85,"umsatzBrutto":484614.80,
     "bills":14477,"guests":14977,
     "avgTicket":30.13,"avgGuest":29.12,
     "umsatzNettoV":394391.24,"umsatzBruttoV":469284.59,
     "diff":10.60}
  ],
  "totals": {"umsatzNetto":8984319.71,"umsatzBrutto":10048421.89,"bills":318437,"guests":354751,
             "avgTicket":28.21,"avgGuest":25.33,"umsatzNettoV":8884242.50,"umsatzBruttoV":10549333.85,"diff":1.13}
}
```

| Feld | Bedeutung | Excel-Entsprechung |
|---|---|---|
| `name` | Betriebsname | `Eingabe!A` Betrieb |
| `encId` | verschlüsselte Betriebs-ID — **Join-Key** über alle Report-Endpunkte | — |
| `umsatzNetto` | Nettoumsatz Periode | `Eingabe!C` Umsatz Ist |
| `umsatzNettoV` | Nettoumsatz Vergleichsperiode | `Eingabe!D` Umsatz VJ |
| `diff` | Veränderung **in Prozent** (bereits berechnet, z. B. `-97.92`) | `Eingabe!E` Umsatz % (dort als Dezimalbruch) |
| `bills` | Rechnungen | Durchschnittsbon-Bericht |
| `guests` | Gäste | Umsatz pro Kopf |
| `avgTicket` / `avgGuest` | Ø pro Rechnung / pro Gast | „Durchschnittsbon, Umsatz pro Kopf" |

**Verifiziert gegen Excel:** Enchilada Karlsruhe, Juni 2026 → API `umsatzNetto = 136.612,46 €`, Excel `Umsatz Ist = 136.612,47 €`. ✔

**YTD:** Für `Umsatz YTD` / `Umsatz YTD 2025` genügt derselbe Endpunkt mit `von=01.01.JJJJ&bis=<Monatsende>` und `vergleichTyp=vorjahr`.

---

### 3.4 `getPersonalkosten`

```
GET /intranet/analytics/getPersonalkosten
    ?report=intranet-personalkosten&von=…&bis=…&reltime=custom&brutto=0&preExistingRevenue=0
```

**Response** (≈ 50 KB):
```json
{"timeframe":"01.06.2026 - 30.06.2026",
 "stores":[{"name":"Betrieb 01","encId":"ENCID_000",
   "effService":199.28,"effBar":215.90,"effKueche":136.19,"effGesamt":87.45,
   "thresholds":{"1":["80","100","150"],"2":["80","100","150"],"3":["40","60","150"],"-1":["35","45","150"]},
   "pekService":9.44,"pekBar":9.00,"pekKueche":16.71,"pekGesamt":37.21,
   "pekThreshold":["29","35","50"],
   "persoogBwa":34.97}]}
```

| Feld | Bedeutung |
|---|---|
| `effService/Bar/Kueche/Gesamt` | Effektivität in % (Umsatz je Personalkosten-Einheit) |
| `pekService/Bar/Kueche/Gesamt` | Personalkostenquote in % je Bereich |
| `persoogBwa` | **Personalkosten ohne GF laut BWA, in %** → exakt die Excel-Spalte `Eingabe!J` |
| `pekThreshold` | **`[grün, orange, rot]` je Betrieb** — LINA hat bereits ein betriebsindividuelles Ampel-Schwellenwerk |
| `thresholds` | Schwellen je Bereich (`1`, `2`, `3`, `-1`) für die Effektivität |

> **Wichtiger Fund:** Die Excel-Datei arbeitet mit *globalen* Schwellen (`Regeln!B3=28 %`, `C3=32 %`). LINA liefert *pro Betrieb* konfigurierte Schwellen (Beispiel: 29/35 bzw. 30/34). **Offene Frage an Concept Family: Soll die Pipeline die globalen Round-Table-Schwellen oder die betriebsindividuellen LINA-Schwellen verwenden?** Fachlich spricht viel für die LINA-Werte (berücksichtigt Standortgröße/Konzept), für die Vergleichbarkeit im Round Table eher für die globalen.

---

### 3.5 `getKennzahlen` — BWA-Kennzahlen (Quelle für Wareneinsatz)

```
GET /intranet/analytics/getKennzahlen?von=01.06.2026&bis=30.06.2026&mode=absolut
```
(kein `report`-Parameter; `mode=relativ` für die Prozentdarstellung der UI)

**Response** (≈ 133 KB), dreistufige Hierarchie:
```json
{"year":"2026",
 "groups":[                                   // 14 Konzepte/Gruppen
   {"key":"group_1",
    "data":{"name":"Enchilada","jan":0,…,"jun":1101.91,"kum":150.26},   // Gruppenzeile = EBIT
    "children":[                                                          // Betriebe
      {"key":"4210",
       "data":{"name":"Betrieb XX","jun":-20500.78,"kum":-20500.78},      // Betriebszeile = EBIT
       "children":[                                                       // 5 feste Kennzahlen
         {"data":{"name":"Umsatz","jun":68433.72,…}},
         {"data":{"name":"EBIT","jun":-20500.78,…}},
         {"data":{"name":"WE Bar","jun":4954.27,…}},
         {"data":{"name":"WE Küche","jun":12057.28,…}},
         {"data":{"name":"Personalkosten ohne GF","jun":27362.87,…}}]}]}]}
```

* Werte sind **absolute EUR-Beträge je Monat** (`jan`…`dec`) plus `kum`.
* Die 5 Blattzeilen sind fest: `Umsatz`, `EBIT`, `WE Bar`, `WE Küche`, `Personalkosten ohne GF`.
* **Die Gruppe liefert die Marke, das Kind nur die Stadt.** Unter der Gruppe *Enchilada* heißt der Betrieb schlicht `Karlsruhe`, nicht `Enchilada Karlsruhe`. Der Name „Karlsruhe" erscheint deshalb fünfmal (Enchilada, Aposto, Lehners, Besitos (GESCHLOSSEN), Wilma Wunder) — das sind **fünf Restaurants in einer Stadt**, nicht ein Restaurant in fünf Marken. Der Betriebsname ist damit **nicht eindeutig**: immer über `children[].key` bzw. `encId` joinen, nie über den Namen. Details und Prüfstand am Kommentar von `core.betrieb_konzept` in `migrations/0002_stammdaten.sql`.
* **Datenverfügbarkeit hinkt hinterher:** BWA-Daten werden erst nach Monatsabschluss gebucht. Im Excel-Report „JULI" stehen deshalb in den Kopfzeilen der Personal-/WE-Spalten `MAI`, in der Bewertungsspalte `JUNI` — die Ampel mischt bewusst Perioden. Für die Pipeline heißt das: **Umsatz ist quasi live, WE/Personal/EBIT laufen 1–2 Monate nach.** Das muss im Mart-Layer als eigenes `data_asof`-Feld pro Kennzahl abgebildet werden, sonst entstehen falsche Trendaussagen.

---

### 3.6 `getZeitzonenbericht`

```
GET /intranet/analytics/getZeitzonenbericht?report=intranet-zeitzonen&von=…&bis=…
```
```json
{"timeframe":"01.06.2026 - 30.06.2026",
 "hours":[8,9,10,…,23,0,1,…,7],
 "stores":[{"name":"…","encId":"…","hours":{"0":0,…,"14":2.86,…,"23":0}}]}
```
`hours` (top level) definiert die **Anzeigereihenfolge**: Geschäftstag beginnt um 08:00 und endet um 07:59 des Folgetags. Die Keys im Store-Objekt sind die echten Stunden 0–23. → **Definition des Geschäftstags für den Importer: 08:00–07:59.**

### 3.7 `getVordefinierteZeitzonenBericht`

```json
{"timeframe":"…",
 "zeitzonen":[{"id":1,"name":"Mittagszeit","time_from":690,"time_to":840},
              {"id":2,"name":"Nachmittag","time_from":840,"time_to":1050},
              {"id":3,"name":"Happy Hour","time_from":1050,"time_to":1140},
              {"id":4,"name":"Abendessen","time_from":1140,"time_to":1320},
              {"id":5,"name":"Late Night","time_from":1320,"time_to":60},
              {"id":6,"name":"Frühstück","time_from":480,"time_to":690}],
 "stores":[{"name":"…","encId":"…","values":{"1":0,…,"6":0}}]}
```
`time_from`/`time_to` sind **Minuten seit Mitternacht** (690 = 11:30). Zone 5 „Late Night" läuft über Mitternacht (1320 → 60).
Entspricht direkt dem Wunsch aus `Umsatz-Berichte (Essenz)`: Frühstück / Mittag / Nachmittag / Happy Hour / Abendessen / Late Night.

### 3.8 `getArtikelverkaufsbericht`

```
GET /intranet/analytics/getArtikelverkaufsbericht?report=intranet-artikel&von=…&bis=…
```
**≈ 2,0 MB** — die mit Abstand größte Response.
```json
{"timeframe":"…",
 "columns":[{"artnr":450003,"name":"Aperol Spritz","fixed_we":0.83}, …],   // 6.451 Artikel
 "rows":[{"name":"…","encId":"…",
          "counts":{"<artnr>":n}, "netto":{"<artnr>":x}, "brutto":{"<artnr>":x},
          "prices":{"<artnr>":vk}}]}                                        // 141 Betriebe
```
`fixed_we` = hinterlegter Wareneinsatz je Artikel → ermöglicht den **theoretischen Wareneinsatz** (`Rezept × VK-Zahl`), den `Auswertung WAWI` fordert, ohne Foodnotify-Anbindung.
`prices` liefert die betriebsindividuellen VK-Preise → deckt „Ein Bericht mit allen VK-Preisen" und den Preisvergleich zwischen Betrieben ab.

**Für den Importer:** Dieser Endpunkt ist der teuerste. Nicht täglich in voller Breite ziehen — Tagesscheiben je Betrieb (`betriebe=<id>`) oder wöchentlich, nachts, gestreckt.

### 3.9 `getAktionsbericht` / `getAktionen` / `reportAktionConfig`

```json
{"timeframe":"…","brutto":false,
 "aktionen":[{"id":4,"name":"Sekt alkoholfrei"}, …],
 "rows":[{"name":"…","encId":"…","cells":{…}}]}
```
`getAktionen` liefert die Aktionsliste für den Filter, `reportAktionConfig` die Konfiguration. Deckt „Aktions-Umsatzbericht" / „Umsatz Marketingaktion" ab.

### 3.10 `exportCsv`

`/intranet/analytics/exportCsv` mit `downloadName`, `module`, `tab`. Erzeugt die CSV, die im Screenshot als `umsatzbericht_2026-07-24.csv` heruntergeladen wurde. **Für den Importer irrelevant** — die JSON-Endpunkte sind reichhaltiger und stabiler zu parsen. Nur als Fallback/Abgleich dokumentiert.

---

## 4. Stamm- und Kontextdaten

| Endpunkt | Inhalt |
|---|---|
| `GET /intranet/api/analyticsFilterOptions` | `gruppen[14]` (Marken), `betriebe[141]`, `hauptsparten[10]`, `feinsparten[334]`, `verkaufsstellen[7]` — **die Dimensionstabellen für Phase 2** |
| `GET /common/api/account` | `user{vorname,nachname,encryptedId,isGf1,isGf2,gfDashboard,isTeamLeader,language}`, `store`, `franchise`, `storeList` — Rechte-Kontext |
| `GET /common/api/menu` | Vollständiger Navigationsbaum, **282 routbare Blätter** in 12 Bereichen (POS, Shopsysteme, Voucher, Pay, Table, CRM, Buy, Team, Analytics, Finance, Stores, Config) inkl. `access: true/false` → Landkarte für weitere Datenquellen |
| `GET /common/api/translations?lang=de` | Übersetzungen |
| `GET /einstellungen/api/getStoreData` | Betriebs-Stammdaten (s. Sicherheitshinweis oben) |

**Dimensionen im Detail:**

```
gruppen (Marken):      Enchilada(1), Besitos(2), Lehners(3), Aposto(4), Sonstige Enchilada Gruppe(6),
                       Deutsche Konzepte(10), Enchi-…(19), …(32,59,73,75,78,80,83)  → 14 gesamt
hauptsparten (posId):  10001 Speisen | 10002 Getränke | 10003 Gutscheine | 10004 Sonstiges/Divers
                       10006 Strassenverkauf_Getränke | 10007 Strassenverkauf_Speisen
                       92 Pfand | 94 Trinkgeld | 95 Gutschein | 10008 Lieferkosten
verkaufsstellen:       0 Gesamtbetrieb | 1 Ausser Betrieb | 2 AmadeusGO | 51 Cocktail Casino
                       52 Delivery | 53 To Go Lehners | 56 To Go Aktionspreis
```

---

## 5. Noch nicht erschlossene Bereiche

Über `/common/api/menu` sichtbar, in Phase 1 bewusst nicht angefasst (der Auftrag priorisiert die Report-Center-Daten). Diese Bereiche decken die im Auftrag genannten Punkte *Personal-/Schichtdaten* und *Storno-/Trainingsbuchungen* ab:

| Bereich | Route (aus Menu) | Relevanz |
|---|---|---|
| Team > Mitarbeiter > Zeitkonten | `/personal/zeitkonto/zeitkonto` | Zeiterfassung, Ist-Stunden |
| Team > Mitarbeiter > Urlaubsplanung | `/personal/zeitkonto/urlaub` | nichtproduktive Kosten (Urlaub) |
| Team > Dienstpläne | `/personal/dienstplan/…` | Soll-Stunden, Dienstplan-Forecast |
| Team > Mitarbeiter > Stammdaten | `/personal/mitarbeiter/manageusers` | **`access:false`** für den genutzten Account |
| POS > Verkauf / Stammdaten | Artikel, Artikelpreise, Sparten, MecCodes | POS-Stammdaten |
| Finance / BWA | Menü „Finance" (Badge „20") | BWA/SuSa, Rechnungsdaten |
| Buy | Einkauf/Bestellungen | Einkaufsartikel, Lieferanten |

**Storno- und Trainingsbuchungen** wurden in den 7 Report-Center-Endpunkten **nicht** gefunden. Die Excel-Liste `Umsetzung Berichte` führt „Stornobericht" mit `Status Bericht = 1, Status Live = 0` — der Bericht existiert also in LINA, ist aber nicht im Report Center freigeschaltet. → **Offene Frage / Aufgabe für Phase 1b.**

---

## 6. Empfehlung: API statt DOM-Scraping

**Klare Empfehlung: echte API-Calls.** Alle für die Excel-Reports benötigten Kennzahlen sind über die sieben JSON-Endpunkte erreichbar. DOM-Scraping ist **nicht** nötig und wäre die deutlich schlechtere Wahl — die Tabellen werden von PrimeVue clientseitig gerendert, virtualisiert und sortiert; ein Scraper wäre bei jedem Frontend-Release kaputt.

**Einschränkung:** Die Endpunkte sind undokumentiert und nicht versioniert. Risikominderung für Phase 3:
1. Response-Schema bei jedem Lauf validieren (zod), bei Abweichung Alarm statt stiller Fehlinterpretation.
2. Rohdaten 1:1 als JSONB im Raw-Layer ablegen → bei Schemaänderung kann rückwirkend neu transformiert werden.
3. Plausibilitätschecks (Null-Quote, Summenabgleich gegen `totals`) als Silent-Failure-Schutz.

**DOM-Scraping als zweite Wahl** wäre nur für Bereiche zu prüfen, die kein JSON-Backend haben — nach jetzigem Stand betrifft das potenziell den Stornobericht und Teile von Team/Finance. Erst nach Klärung von Abschnitt 5 entscheidbar.

---

## 7. Aktive Rückfragen an dich

1. **BWA-Rechte:** Mit welchem Account soll der Importer laufen? Der jetzige sieht die Kennzahlen (WE Bar, WE Küche, Personalkosten ohne GF, EBIT) fast durchgängig als `0,00`.
2. **Ampel-Schwellen:** Globale Round-Table-Werte (Excel `Regeln`) oder die betriebsindividuellen LINA-`pekThreshold`/`thresholds`?
3. **Umsatzabweichung:** Für Karlsruhe stimmen API und Excel exakt überein, für Bayreuth (API 52.712,58 € vs. Excel 69.886,44 €) und Freiburg (125.926,89 € vs. 142.090,80 €) nicht. Wurden diese Zeilen manuell aus einer anderen Quelle/Periode gepflegt, oder wurde Brutto/andere Verkaufsstellen gerechnet?
4. **Online-Bewertung & OM-Score:** In LINA nicht auffindbar (siehe Mapping-Tabelle). Quelle ist laut `BUCHHALTUNG`-Workbook **YEXT** bzw. eine manuelle Einschätzung des Operations Managers. Sollen diese beiden Spalten in Phase 2 als manuelle Eingabetabelle im Postgres modelliert werden?
5. **Storno-/Trainingsbuchungen:** Soll ich in einer kurzen Phase 1b die Bereiche Team (Zeitkonten/Dienstplan), Finance/BWA, Buy und den Stornobericht genauso erschließen?
