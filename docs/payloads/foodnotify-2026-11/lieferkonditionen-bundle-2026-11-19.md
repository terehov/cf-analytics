# Lieferkonditionen in FoodNotify — Bundle-Analyse (19.11.2026)

**Frage (Fachbereich):** Wo führt FoodNotify je Lieferant und Betrieb den **Tourenplan** (Liefertage),
die **Bestellfrist** (Vorlauf, Bestellschluss) und den **Mindestbestellwert**?

**Methode.** Nur lokale Dateien gelesen: die Bundles beider Oberflächen in
`belege/foodnotify-inventur-2026-11-18/` (`brew/` = neue React-Oberfläche, `panel/` = alte Angular-Oberfläche,
`hilfe/` = Hilfeartikel), dazu die Inventare `intern/brew-aufrufe.csv`, `intern/panel-aufrufe.csv`,
`messung-sitzung-2026-11-18.csv`, `openapi/`. **Kein Aufruf gegen FoodNotify, LINA oder eine Datenbank.**
Alles unten ist aus dem Code gelesen, nichts gemessen — außer dort, wo ausdrücklich „gemessen" steht.

## Antwort in drei Sätzen

1. **Die vermutete Stelle, `POST /api/shop/{shopId}/info`, trägt keine Konditionen.** Die Oberfläche liest daraus nur
   `shopInfo` (Name, Logo, Shop-ID), `availableCarts`, `costCentersInfo` und `selectedCostCenter`.
2. **Die Konditionen stehen am Warenkorb, und der ist ein GET:**
   `GET /api/shop/{shopId}/cart/{cartType}/{cartId}` — mit `minimalOrderSum` (Mindestbestellwert, netto),
   `deliveryDates[]` und `unavailableDeliveryDates[]` (die Liefertage, die FoodNotify für diesen Warenkorb **gerade**
   anbietet bzw. sperrt) und je Produkt `preorderDays` (bestellbar bis wann, für welche Lieferung). Dazu braucht es
   eine **bestehende Warenkorb-Nummer** — gelistet über `GET /api/carts/{status}`, am 18.11.2026 mit der Sitzung 200
   gemessen (`active`). Es gibt keinen Pfad ohne Warenkorb.
3. **Ein Bestellschluss als Feld existiert nicht.** FoodNotify rechnet ihn serverseitig in die Terminliste und in
   `preorderDays.orderableUntil` hinein; die Oberfläche kennt fest eingebaute Hinweistexte für **vier** Lieferanten
   (siehe Abschnitt 5). Der **Tourenplan je Kunde** (kundenspezifische Liefer- und Tourenpläne) liegt serverseitig und
   hat in keinem der beiden Bundles einen Lesepfad für Kunden — nur ein Lieferanten-Formular schreibt Standard-Liefertage.

## 1. `POST /api/shop/{shopId}/info` — trägt keine Konditionen

| | |
|---|---|
| Fundstelle | `brew/use-error-toast-CqzE9-UG.js` (`M=t=>s("POST",`/api/shop/${t}/info`,"")`), Aufrufer `brew/_cartId-DoiB21pW.js` (`ft`); alte Oberfläche `panel/239…js` (`getShopInfo(v)` → `post(.../shop/{v}/info, "")`), Aufrufer `panel/658…js` |
| Body | **leere Zeichenkette**, kein Parameter, kein Filter |
| Wann gerufen | beim Öffnen der Warenkorbseite (`queryFn`, zusammen mit dem Warenkorb-GET und `GET /api/cart/{cartId}/product/details`) und einmal nach dem Abschicken (`ga`, Neuladen) |
| Gelesene Felder | `shopInfo.shopId`, `shopInfo.name`, `shopInfo.logo`; `availableCarts`; `costCentersInfo[].costCenters[].id`; `selectedCostCenter` |
| Konditionen darin? | **Nein.** Weder `minOrder…` noch Termine noch Fristen werden aus der Antwort gelesen. (Gesucht über `panel/658…js` und `brew/_cartId…js`: `shopInfo\.\w+` ergibt nur `availableCarts`, `shopInfo`; `F\.\w+` nur `availableCarts`, `costCentersInfo`, `selectedCostCenter`.) |
| Schreibt er? | Im Code nichts erkennbar: die Seite ruft ihn beim bloßen Anzeigen, ohne Nutzeraktion. **Nicht beweisbar** — `selectedCostCenter` ist Zustand am Server (gesetzt durch `PUT /api/shop/setCostCenter`), und was der POST serverseitig sonst tut, sagt kein Bundle. |
| Folge | **Nicht aufrufen.** Er ist ein POST, und er liefert nichts, was wir suchen. Einziger Nutzen: `availableCarts` (Warenkörbe dieses Lieferanten) — die liefert `GET /api/carts/{status}` ohnehin. |

## 2. Der GET, der die Konditionen trägt

`GET /api/shop/{shopId}/cart/{cartType}/{cartId}`

* **Fundstelle neue Oberfläche:** `brew/use-error-toast-CqzE9-UG.js`
  (`x=(t,e,a)=>r(`/api/shop/${t}/cart/${e}/${a}`)`, `r` = GET-Helfer aus `legacy-http-CfXkuvQ-.js`),
  Aufrufer `brew/_cartId-DoiB21pW.js` (`Qa`) auf der Route `/brew/shop/{id}/cart/{type}/{cartId}`.
  **Alte Oberfläche:** `panel/239…js` `getCart(shopId, cartType, cartId)` → `get(baseApiUrl/shop/{shopId}/cart/{cartType}/{cartId})`,
  Aufrufer `panel/658…js` (Seite `/panel/shop/{shopId}/cart/{type}/{cartId}`).
* **Parameter:** drei Pfadsegmente, keine Query, kein Body. `shopId` = Lieferanten-Shop (bei uns `core.lieferant.fn_id`,
  je Marke), `cartType` ∈ `active` | `draft` | `faulty` (so verzweigt die Oberfläche), `cartId` = Warenkorb-Nummer.
* **Im Inventar:** `brew-aufrufe.csv` Zeile 311 (`GET /api/shop/{shopId}/cart/{cartId}/{cartId2}`, Platzhalter nur anders
  benannt), `messliste-token.csv` Zeile 428: `lesend`, **nicht gemessen** („Parameter unbekannt: shopId, cartType, cartId").
  Nicht unter den 14 zustandsändernden GETs von `foodnotify-api-inventar-intern-2026-11.md` §6.
* **Aus der Antwort gelesen** (`brew/_cartId…js`, `panel/658…js`):

| Feld | Bedeutung für die Oberfläche | Entspricht |
|---|---|---|
| `minimalOrderSum` | wird zu `minOrderSum`; Vergleich `amount.net < minOrderSum` → Hinweis „Der Mindestbestellwert von {value} wurde nicht erreicht. Es können zusätzliche Lieferkosten anfallen oder die Lieferung kann verweigert werden." (`min_order`, `brew/index-lKBZAT8Z.js`) | **Mindestbestellwert, netto**, Währung in `currency`. **Eine Warnung, keine Sperre** |
| `currency` | Währungskürzel für Beträge | — |
| `deliveryDates[].date` | die **auswählbaren Liefertage** dieses Warenkorbs (Kalender, Erstwert = `deliveryDates[0]`); leer → „Keine Liefertage verfügbar", Bestellen gesperrt | **Tourenplan, soweit er jetzt gilt**, mit schon eingerechnetem Bestellschluss |
| `unavailableDeliveryDates[].date` | gesperrte Tage, im Kalender grau | — |
| `deliveryDate` / `deliveryDateUpdated` | gewählter Termin; `deliveryDateUpdated` → Hinweis „Lieferdatum wurde auf das Ehestmögliche verschoben" | siehe Vorsicht unten |
| `products[].preorderDays` | `{passed, orderableUntil{date}, available_from{date}, desiredDeliveryDate{date}}` — Tooltip „Bestellbar bis {orderableUntil} für die Lieferung am {available_from \| desiredDeliveryDate}"; `passed` = Frist verstrichen | **Bestellfrist je Artikel** (Vorlauf), absolut als Zeitpunkt |
| `products[].available`, `.packagingUnit.price` | bestellbar / Preis vorhanden → Warenkorb, Entwurf oder fehlerhaft | — |
| `net`, `vat`, `total`, `note`, `enableComments`, `restaurantId`, `cartId` | Summen und Kopf | — |

**Warenkorb-Nummern kommen aus:** `GET /api/carts/{status}` mit `status` ∈ `active` | `draft` | `faulty` | `all` und
Query `supplierId, locationId, cartId, page, limit` (`brew/_status-BrTaD2lB.js`). Gemessen am 18.11.2026 mit der Sitzung
(`messung-sitzung-2026-11-18.csv` Zeile 252, `/api/carts/active?page=1&limit=5`, **200**): `data.carts[]` mit
`cartId, shopId, restaurantId, costCenterId, type, shopName, restaurantName, costCenterName, productCount, cartTotal,
currency, logo, timeUpdated`, dazu `totalPages`, `totalResults`, `currentPage`. Mit dem Token war `/api/carts/count`
**403** (Zeile 11) — die Warenkörbe gehen also nur über die Sitzung.

**Was das für eine spätere Messung heißt**

* **Es gibt nur Konditionen dort, wo ein Warenkorb existiert.** Ein Warenkorb entsteht, wenn jemand für Betrieb und
  Lieferant etwas hineinlegt; anlegen kann ihn nur ein schreibender Aufruf (`PUT /api/shop/setCostCenter`,
  `POST /api/shop/cart/add`) — **tabu**. Für Lieferanten ohne offenen Warenkorb bleibt die Lücke.
* **Die Terminliste ist ein Kalender ab heute, kein Plan.** Wiederholtes Lesen über Wochen ergibt Liefertage je Woche.
  Beim Lieferanten mit Bestellschluss um 10:00 hängt der erste angebotene Termin von der Uhrzeit des Abrufs ab.
* **Muster für eine lesende Probe (nur im Terminal des Nutzers, Erlaubtliste, streng GET):**
  1. `GET /api/carts/all?page=1&limit=50` — Warenkörbe auflisten (Seiten nachblättern, `totalPages`).
  2. Je Warenkorb **ein** Aufruf `GET /api/shop/{shopId}/cart/{type}/{cartId}`; protokollieren nur die Felder der Tabelle
     (`minimalOrderSum`, `currency`, `deliveryDates[].date`, `unavailableDeliveryDates[].date`,
     `products[].preorderDays.*`), keine Positionen, keine Preise. Mit drei Warenkörben anfangen.
  3. **Nie die Warenkorb-Seite im Browser öffnen** — sie setzt beim Laden `POST /info` und `GET /api/cart/{cartId}/product/details`
     ab (Lehre aus dem Vorfall `/erp/{erpId}`, §6 des Inventars).
* **Vorsicht, nicht ausgeschlossen:** `deliveryDateUpdated` deutet darauf, dass der Server beim **Lesen** den gewählten
  Termin des Warenkorbs auf den frühestmöglichen setzt, wenn der gespeicherte nicht mehr verfügbar ist. Ob das beim GET
  gespeichert wird, ist aus dem Code nicht zu sehen. Folge wäre ein geänderter Liefertermin **im offenen Warenkorb**
  (keine Bestellung). Vor der Probe dem Nutzer sagen; mit einem Entwurf-Warenkorb beginnen, nicht mit einem aktiven.

## 3. Weitere Fundstellen, die **nicht** helfen

| Fund | Warum nicht |
|---|---|
| `cutoffHour`/`cutoffMinute`, `PUT /api/core/business/{masterUserId}/locations/cutoff` (`brew/location-form-page…js`, `index-lKBZAT8Z.js`) | Das ist der **Geschäftstagswechsel des Betriebs** („Cutoff Time", `plannedCutoffTime`), kein Bestellschluss eines Lieferanten. Zudem PUT. |
| `deadlineOptions` / `autoImportDeadline` (`brew/index-lKBZAT8Z.js`, Neuigkeit 11/2026 in `hilfe/art_neu-im-november-2026.html`) | „Import-Frist": wann FoodNotify Bestellungen **automatisch als geliefert in die Warenwirtschaft** übernimmt (am Liefertag 12:00/18:00 usw.). `GET /api/erp/order/auto-import-settings`. Hat mit der Lieferantenfrist nichts zu tun. |
| `PUT /api/shop/order-reminder/subscription…` (`offsetHours`, `channels`, `excludedSupplierShopIds`) | Persönliche Erinnerung „N Stunden vor Bestellschluss" je Benutzer, je Standort und Lieferant (`hilfe/art_neu-im-oktober-2026.html`). Es gibt **nur PUT** im Bundle; der Bestellschluss selbst steht nicht darin. |
| `/api/shop/multi-cost-center-ordering/…` (Sammelbestellung) | Fehlercodes `mcc.placement.all_cutoffs_passed`, `no_delivery_dates`, `scheduled_date_not_available` zeigen, dass der Server je Standort Fristen und Termine kennt — aber `place`, `schedule`, `quantities` sind POST/PATCH. Das GET `/api/shop/multi-cost-center-ordering/{orderId}` liest eine Sammelbestellung, nicht die Konditionen. |
| `POST /api/supplier/intake` (Felder `deliveryDays`, `deliveryDaysConsistent`, `deliveryDaysNotes`) und `GET /api/supplier/intake/{submissionId}` | **Lieferanten-Onboarding:** ein Formular, mit dem ein Lieferant seine Standard-Liefertage meldet („verwendet, wenn keine kundenspezifischen Liefer- oder Tourenpläne vorliegen", `brew/index-BjQq4Ilz.js`, `use-intake-sections…js`). Das **POST schreibt**. Das GET gehört zur Verwaltungsseite `/brew/admin/supplier-onboarding` (Customer-Success, `/api/customer-success/…`) — kein Kundenzugang. Der Text bestätigt allerdings: FoodNotify führt Standard-Liefertage je Lieferant und kundenspezifische Tourenpläne **serverseitig**. |
| `shopSettings: "/shops/settings?tab=shop-settings"` (`brew/legacy-system-url…js`), `/shops/private/…` (`panel/488…js`) | Lieferantenportal (serverseitig gerenderte Seiten, Lieferantenkonto). Für uns kein Zugang; vier der dortigen Pfade sind zustandsändernde GETs (§6 des Inventars). |
| Öffentliche OpenAPI (`openapi/1.0_shops.json`) | `GET /api/1.0/shops`, `/shops/{id}` ohne beschriebene Antwortstruktur; im ganzen Verzeichnis kein Feld mit `minimum…`, `delivery…`, `cutoff…`, `schedule`, `tour` außer JSON-Schema-Grenzen (`minimum`). Ob die Shop-Antwort Konditionen trägt, ist **unbekannt**, aber die Spezifikation verspricht es nicht. |
| Hilfeartikel (`hilfe/`, 14 Dateien) | Kein Hinweis auf Mindestbestellwert, Tourenplan oder Bestellschluss außer den beiden oben. |

## 4. Wo steht was — Übersicht

| Kondition | Ort in FoodNotify | Lesepfad (aus Code) | Anmerkung |
|---|---|---|---|
| Mindestbestellwert | Warenkorb: `minimalOrderSum` | **GET** `/api/shop/{shopId}/cart/{type}/{cartId}` | je Lieferant und Standort, netto; Warnung, keine Sperre |
| Liefertage / Tourenplan | Warenkorb: `deliveryDates[]`, `unavailableDeliveryDates[]` | **GET** (derselbe) | Kalender ab jetzt, nicht der Plan als Regel |
| Bestellfrist / Vorlauf | Warenkorb: `products[].preorderDays.orderableUntil`, `.available_from`, `.desiredDeliveryDate`, `.passed` | **GET** (derselbe) | je Artikel, absolut; keine Regel „bis 14 Uhr am Vortag" |
| Bestellschluss als Uhrzeit | nicht als Feld; **fest eingebaut** für vier Shops (Abschnitt 5) | — | sonst nur indirekt in den Terminen |
| Standard-Liefertage des Lieferanten | Onboarding-Antwort (`deliveryDays`, `deliveryDaysConsistent`, `deliveryDaysNotes`) | GET nur für Customer-Success | kein Kundenzugang |
| Kundenspezifischer Tourenplan | nur serverseitig | **keiner gefunden** | die Frage, die offen bleibt |

## 5. Fest eingebaute Hinweise je Lieferant (`brew/_cartId-DoiB21pW.js`)

Die Warenkorbseite zeigt für vier Shop-IDs einen Hinweistext, der nicht aus der Antwort kommt, sondern am Code hängt
(`l === <shopId>`). Sie sind der einzige **Uhrzeit-Bestellschluss**, den die Bundles nennen:

| `shopId` | Schlüssel | Aussage |
|---|---|---|
| 9243 | `cutoff_havi` | bestellen bis **10:00 Uhr** für die nächste mögliche Lieferung; später Hinzugefügtes bleibt im Warenkorb bis zur nächsten Bestellmöglichkeit; **die einzige Bestellung, die für diesen Tag angenommen wird** |
| 8014 | `cutoff_gvs` | bis **8:00 Uhr** |
| 8522 | `cutoff_ultra` | bis **8:00 Uhr** |
| 130036 | `nordmann` | Gesamtmenge muss **durch 6 teilbar** sein (Flaschenkarton), sonst liefert der Lieferant nicht |

Die Namen (Havi, GVS, Ultra, Nordmann) stammen aus den Schlüsseln, **nicht** aus einer Zuordnung zu unseren
`core.lieferant`-Zeilen. Welche unserer Lieferanten das sind, steht nirgends belegt; ein Abgleich `core.lieferant.fn_id`
gegen diese vier Nummern wäre eine lokale Abfrage (nicht gemacht).

## 6. Was offen bleibt

* **Nicht gemessen:** der Warenkorb-GET (Antwortform, ob `deliveryDates` wirklich je Standort gilt, ob er beim Lesen
  schreibt). Die Felder oben sind aus dem Quelltext der Oberfläche, nicht aus einer Antwort.
* **Nicht beantwortbar aus den Bundles:** der kundenspezifische Tourenplan als Regel (Wochentage), der Mindestbestellwert
  für Lieferanten ohne offenen Warenkorb, die Bestellfrist als Uhrzeit.
* **POST nur mit ausdrücklichem Ja des Nutzers.** Es gibt keinen Grund für `POST /api/shop/{shopId}/info`: die
  Konditionen stehen nicht darin.
* Bis dahin: `mart.lieferkondition_beobachtet` (Migration `0156`) — **beobachtet, nicht vereinbart.**
