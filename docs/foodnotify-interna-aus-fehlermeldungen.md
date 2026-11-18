# FoodNotify: was die Fehlermeldungen über das System verraten

Stand 18.11.2026. Gesammelt aus den Messungen dieses Tages (Konto Wilma Wunder, nur GET) und aus den
älteren Befunden des Projekts. **Zweck:** Die Fehlertexte von FoodNotify sind ungewöhnlich gesprächig.
Wer sie lesen kann, erfährt aus einem einzigen fehlgeschlagenen Aufruf, welcher Parameter fehlt, welcher
Typ erwartet wird und welche Route tatsächlich gegriffen hat. Das spart beim nächsten Mal das Raten.

Auftrag Eugene, 18.11.2026: alles notieren, es kann künftig helfen.

**Quellen**

| Was | Wo |
|---|---|
| Alle Fehlermeldungen wörtlich, je Aufruf | `docs/payloads/foodnotify-2026-11/fehlermeldungen-2026-11-18.csv` |
| Die ganze Sitzungsmessung (Status, Form) | `docs/payloads/foodnotify-2026-11/messung-sitzung-2026-11-18.csv`, Zusammenfassung in `…/messung-sitzung-2026-11-18.md` |
| Die Token-Messung | `docs/payloads/foodnotify-2026-11/messung-token-2026-11-18.csv` |
| Rohdatei der Sitzungsmessung | `belege/foodnotify-inventur-2026-11-18/fn-cookie-messung-1.json` (lokal, nicht in Git) |
| Ältere Fehlerbefunde | `docs/foodnotify-http500.md`, `docs/foodnotify-api-inventar.md` §8a und §11 |

Die Meldungen der Sitzungsmessung sind beim Erfassen auf 200 Zeichen gekürzt worden; einige enden deshalb
mitten in „on lin…". Beide Runden der Sitzungsmessung sind eingearbeitet (204 + 55 Pfade; Rohdateien
`fn-cookie-messung-1.json` und `-2.json`).

## 1. Der Aufbau, wie er sich aus den Meldungen ergibt

Alles in diesem Abschnitt ist **aus Antworten gelesen**, nicht aus einer Dokumentation.

| Schicht | Befund | Woher |
|---|---|---|
| Webserver | `nginx/1.31.7` | Antwortkopf `server` (`api3`, 18.11.2026) |
| Sprache | `PHP/8.2.35` | Antwortkopf `x-powered-by` |
| Framework | Symfony — `/var/www/vendor/symfony/http-kernel/HttpKernel.php on line 183`, `Symfony\Bridge\Doctrine\ArgumentResolver\EntityValueResolver`, Dienstecontainer mit Namen wie `erp.category.normalizer` | 500er, 404 auf Pos 2.0 |
| ORM | Doctrine — `NonUniqueResultException`, „The identifier id is missing for a query of `ErpBundle\Database\Entity\Erp`" | 500er |
| Datenbank | **PostgreSQL** — `SQLSTATE[22P02]: Invalid text representation: 7 ERROR: invalid input syntax for type integer`, `CONTEXT: unnamed portal parameter $1`; am 27.07.2026 `SQLSTATE[42703] column t0.root_recipe_id does not exist` | 500er, `finishError` der Verkäufe |
| Datumsbibliothek | Carbon — das Feld `"\u0000Carbon\CarbonTimeZone\u0000clock"` steht **in der Antwort** von `/api/{erpId}/statistics/sales` und `…/shop-orders` (ein privates Objektfeld, das beim Serialisieren mit herausgefallen ist) | 200er |
| Installationspfad | `/var/www`, eigener Code unter `/var/www/src/` | 500er |
| Übersetzung | Validierungsfehler kommen **deutsch** („Dieser Wert sollte nicht leer sein.") — die Sprache folgt dem Konto, nicht dem `Accept-Language` | 404/422 |

### Zwei Code-Generationen nebeneinander

| Generation | Erkennbar an | Beispiele |
|---|---|---|
| **alt: „Bundles"** | Namensraum `ErpBundle\…`, `BaseBundle\…`, `PosBundle\…`; Antworthülle `{errors, payload, code, isError}`; Seitensteuerung `page`, `page_size`, `order_by`; Klasse `BaseBundle\Dto\LegacyPaginatedData` (heißt selbst „Legacy") | `/api/{erpId}/…`, `/api/erpSettings/…`, `/api/pos/connection/…`, `/api/eventCatering/…` |
| **neu: „Modules"** | Namensraum `App\Modules\<Bereich>\<Thema>\Presentation\Controller\…`; Antworthülle `{data, pagination{currentPage, perPage, totalItems, totalPages}}`; Fehlerform `{type, title, status, detail}` (RFC 7807) oder `{statusCode, title, message}`; Eingaben als typisierte Query-Objekte | `/api/erp/stocktakings`, `/api/recipe-viewer/…`, `/api/core/business/…`, `/api/2.0/…`, `/api/user/api-tokens` |

Bekannte Klassen und Dateien (wörtlich aus Meldungen):

* `ErpBundle\Controller\Api\CategoryController::showAction`
* `ErpBundle\Controller\Api\PreproductionConcreteProductController::showAction`
* `ErpBundle\Controller\Api\StocktakingController::show`
* `ErpBundle\Service\EntityService\CategoryService::getSearch`
* `ErpBundle\Database\Entity\Erp`
* `BaseBundle\Dto\LegacyPaginatedData::fromQuery`
* `PosBundle\Database\Entity\Account`
* `App\Modules\Erp\Stocktaking\Presentation\Controller\Stocktaking\StocktakingListQuery`
* `/var/www/src/ErpBundle/Controller/Api/ProductController.php`
* `/var/www/src/ErpBundle/Service/EntityService/ConcreteProductEntityService.php` (Zeile 10…)
* `/var/www/src/ErpBundle/Service/EntityService/StockEntityService.php` (Zeile 292)
* Dienste im Container: `erp.category.icon.group.normalizer`, `erp.category.icon.service`, `erp.category.normalizer` — und **nicht** `erp.category.icon.normalizer` (siehe 3.4)

**Faustregel:** An der Hülle der Antwort erkennt man die Generation, und an der Generation die Namen der
Parameter. `payload` → `page_size`/`order_by`. `data` + `pagination` → `perPage` oder `limit`.

## 2. Fehlermeldung lesen: was sie über den richtigen Aufruf sagt

| Meldung (Muster) | Status | Bedeutung | Was zu tun ist |
|---|---|---|---|
| `…LegacyPaginatedData::fromQuery(): Argument #3 ($pageSize) must be of type int, null given` | 500 | Pflichtparameter `page_size` fehlt | `?page=1&page_size=N` mitgeben |
| `…LegacyPaginatedData::fromQuery(): Argument #2 ($page) must be of type int, null given` | 500 | Pflichtparameter `page` fehlt | `?page=1&page_size=N` |
| `…CategoryService::getSearch(): Argument #2 ($searchTerm) must be of type string, null given` | 500 | Suchtext fehlt | `?search=…` (Name aus dem Bundle: `search`) |
| `Typed property …StocktakingListQuery::$erpIds must not be accessed before initialization` | 500 | Pflichtfeld des Query-Objekts fehlt; der **Feldname steht in der Meldung** | `?erpIds[]=…` |
| `The identifier id is missing for a query of ErpBundle\Database\Entity\Erp` | 500 | Der Pfad erwartet eine `erpId`, die nicht kam (`/api/erp/dashboard` statt `/api/{erpId}/dashboard`) | den Pfad mit ID nehmen |
| `Dieser Wert sollte nicht leer sein.` / `…nicht null sein.` | **404** oder 422 | Validierung eines Pflichtparameters der neuen Generation. **404 heißt hier nicht „Pfad gibt es nicht"** | Parameter aus dem Bundle oder der Seite nachsehen (`erpId`, `costCenterId`, `day`, `source` …) |
| `Diese Zeichenkette ist zu kurz. Sie sollte mindestens 2 Zeichen haben.` / `Diese Sammlung sollte 1 oder mehr Elemente beinhalten.` | 404 | Suchtext unter zwei Zeichen, Liste leer (`recipe/ingredient-search/candidates`) | Suchtext ≥ 2 Zeichen, mindestens ein Listenelement |
| `Dieser Wert sollte vom Typ int\|string sein.` | 422 | Parameter mit leerem Wert übergeben (`recipe/ingredients?source=`) | Parameter weglassen oder füllen |
| `Call to a member function format() on bool` | 500 | Datum fehlt oder ist nicht lesbar (`recipes/dashboard-mix/{id}?day=`) — `DateTime::createFromFormat` gab `false` zurück | `day=YYYY-MM-DD` mitgeben |
| `No route found for "GET …": Method Not Allowed (Allow: OPTIONS)` | 405 | Für diesen Pfad gibt es **keine** Route außer der CORS-Voranfrage — der Pfad existiert nicht | nicht weiter probieren |
| `…Method Not Allowed (Allow: PUT, OPTIONS)` u. ä. | 405 | Der Pfad passt auf eine **schreibende** Route (siehe Abschnitt 3) | **nie** mit der genannten Methode nachprobieren |
| `"PosBundle\Database\Entity\Account" object not found by "…EntityValueResolver"` | 404 | Die ID im Pfad ist eine POS-Konto-ID (`connectionId`) und existiert nicht | richtige `connectionId` nehmen |
| `Account is not of type FnRecipe` | 500 | Der Pfad `/api/2.0/pos/vendors/fn-recipe/…` gilt nur für eine andere Kontoart | Pfad passt nicht zu Amadeus-Konten |
| `This endpoint does not support scope-limited tokens.` | 403 | Pfad existiert, nimmt aber kein Scope-Token | nur mit Sitzung (oder `full-access`, nicht anlegbar) |
| `Full authentication is required to access this resource.` | 401 | Bearer-Token gegen `my.foodnotify.com` — der Host nimmt nur die Sitzung | Token nur gegen `api3` |
| `Access Denied. The user doesn't have ROLE_ADMIN.` | 403 | Verwaltungsendpunkt von FoodNotify selbst | nicht unser Bereich |
| `Access Denied.` | 403 | fehlendes Recht des Kontos (`shop/multi-cost-center-ordering`) | Rechteobjekt in `/app/is-authenticated` ansehen |
| `Forbidden: Invalid Host header.` (Text) | 403 | einmal auf `api3…/mcp` und `connect…/mcp` gesehen, später nicht reproduziert | ungeklärt |
| leerer Text bei 500 | 500 | `eventCatering/eventStaffRole`, `eventCatering/roleOptionValue`, `{erpId}/sales/search` — Ursache nicht lesbar | – |
| `{"statusCode":500,"title":"NonUniqueResultException",…}` | 500 | Doppelter Datensatz auf FoodNotifys Seite (Bestellpositionen Bar Enchilada Augsburg) | `docs/foodnotify-http500.md`, Ersatzweg `0135` |

## 3. `paginate` und `search` werden als ID gelesen

### 3.1 Was passiert

Die alte Oberfläche erbt für jede Ressource eine Basisklasse mit `index`, `show`, `paginate`, `search`. Im
Server gibt es `…/paginate` und `…/search` aber nur für **einige** Ressourcen. Wo sie fehlen, greift die
nächste passende Route — `/api/{erpId}/<ressource>/{id}` — und das Wort landet als ID im Detail-Controller.

| Aufruf (GET) | Antwort | Lesart |
|---|---|---|
| `/api/{erpId}/stocktaking/paginate`, `…/search` | 500 `StocktakingController::show(): Argument #3 ($id) must be of type int, string given` | Route `stocktaking/{id}`, Typprüfung in PHP |
| `/api/{erpId}/preproductionConcreteProduct/paginate`, `…/search` | 500 `…Controller::showAction(): Argument #3 ($id) must be of type int` | ebenso |
| `/api/{erpId}/category/search` | 500 `CategoryController::showAction(): Argument #3 ($id) must be of type int` | ebenso (`category/paginate` gibt es dagegen: 200) |
| `/api/{erpId}/resets/paginate`, `…/search` | 500 `SQLSTATE[22P02] … invalid input syntax for type integer: "paginate"` | Route `resets/{id}` **ohne** Typprüfung — das Wort geht bis in die SQL-Abfrage |
| `/api/erp/stock-transfer/paginate`, `…/search` | 500 `SQLSTATE[22P02] … "paginate"` | ebenso, Route `stock-transfer/{id}` |
| `/api/{erpId}/category-icon/paginate` | 500 `non-existent service "erp.category.icon.normalizer"` | Route existiert, ist aber kaputt (3.4) |

### 3.2 Die gefährliche Seite: `Allow` nennt die Methode, die greifen würde

Bei einigen dieser Pfade gibt es für GET gar keine Route, wohl aber für eine schreibende Methode. Die
405-Antwort sagt es:

| Pfad | `Allow` | Bedeutet |
|---|---|---|
| `/api/{erpId}/shop-order/search` | `DELETE, OPTIONS` | `DELETE /api/{erpId}/shop-order/{id}` existiert — **Bestellung löschen** |
| `/api/{erpId}/storage/paginate`, `…/search` | `PUT, DELETE, OPTIONS` | Lagerort ändern oder löschen |
| `/api/{erpId}/product-group/paginate` | `PUT, DELETE, OPTIONS` | Produktgruppe ändern oder löschen |
| `/api/{erpId}/product/paginate` | `PUT, OPTIONS` | Produkt ändern |
| `/api/{erpId}/recipe-sale/paginate`, `…/search` | `PUT, OPTIONS` | Rezeptverkauf ändern |
| `/api/{erpId}/product/search-products-without-specified-products` | `PUT, OPTIONS` | Suche läuft über PUT mit Body |
| `/api/{erpId}/product/suppliers` | `PUT, OPTIONS` | ebenso |

**Gegenprobe mit echten IDs (Runde 2):** `GET /api/{erpId}/product/537540` → 405 `Allow: PUT, OPTIONS`,
`GET /api/{erpId}/product-group/186723` → 405 `Allow: PUT, DELETE, OPTIONS`, `GET /api/erp/commodity-groups/62248`
→ 405 `Allow: OPTIONS, PUT, DELETE`. Dieselben `Allow`-Listen wie bei `…/paginate` — das Wort wurde dort also
tatsächlich als ID gelesen, und für diese Ressourcen gibt es **kein Detail per GET**, nur Ändern und Löschen.

**Regel:** Ein 405 ist keine Einladung, die Methode aus `Allow` zu probieren. `DELETE …/shop-order/search`
träfe die Lösch-Route mit der „ID" `search`. Vermutlich scheitert das an der Typprüfung — darauf verlässt
sich hier niemand. Gilt zusätzlich zur Sicherheitsliste der 14 GETs mit Wirkung
(`docs/foodnotify-api-inventar-intern-2026-11.md` §6).

Nützliche Kehrseite: `Allow` verrät, **welche schreibenden Routen es gibt**, ohne dass man sie aufruft.
`Allow: OPTIONS` allein heißt: unter diesem Pfad gibt es nichts.

### 3.3 Welche Listenpfade es wirklich gibt (mit Sitzung, 200)

Je Ressource unter `/api/{erpId}/`, gemessen am 18.11.2026:

| Ressource | ohne Zusatz | `/paginate` | `/search` |
|---|---|---|---|
| `category` | 200 (Baum) | 200 | 500 (als ID gelesen) |
| `category-icon-group` | 405 | 200 | 405 |
| `category-icon` | 405 | 500 (Container) | 405 |
| `product-group` | 200 | 405 (`PUT, DELETE`) | 200 |
| `product-unit` | 200 | 405 | 405 |
| `products` | 200 | 405 | 405 |
| `product` | 500 (braucht `page_size`) | 405 (`PUT`) | 500 (braucht `search`) |
| `recipe` | 405 | 200 | 405 |
| `resets` | 200 | 500 (SQL) | 500 (SQL) |
| `shop-order` | 405 | 200 (auch `/paginate/all`) | 405 (`DELETE`) |
| `shop-order-order-tag-type` | 200 | 405 | 405 |
| `stocktaking` | 200 | 500 (als ID gelesen) | 500 (als ID gelesen) |
| `storage` | 200 (Baum) | 405 (`PUT, DELETE`) | 405 (`PUT, DELETE`) |
| `sales` | 200 | – | 500 (ohne Text) |
| `erpSettings`, `preproductionConcreteProduct`, `recipe-sale`, `shop`, `shop-order-mapped-product`, `statistics`, `stock` | 405 | 405 bzw. 500 | 405 bzw. 500 |

Es gibt also keine einheitliche Regel „Liste = `/paginate`". Vor dem Einreihen eines neuen Pfads: in dieser
Tabelle nachsehen oder einmal messen.

### 3.4 Ein Endpunkt, der bei FoodNotify selbst kaputt ist

`GET /api/{erpId}/category-icon/paginate` → 500 „You have requested a non-existent service
`erp.category.icon.normalizer`. Did you mean one of these: `erp.category.icon.group.normalizer`,
`erp.category.icon.service`, `erp.category.normalizer`?" Die Route verweist auf einen Dienst, den es im
Container nicht gibt. Kein Fehler unseres Aufrufs; der Pfad wird von keiner Oberfläche benutzt.

## 4. Fehlende Pflichtparameter: drei verschiedene Antworten

| Generation | Antwort bei fehlendem Pflichtparameter | Beispiele |
|---|---|---|
| neu, mit Validierung | **404** „Dieser Wert sollte nicht leer/null sein." | `erp/stock-transfer` (braucht `erpId`), `erp/stock-transfer-request`, `erp/food-waste`, `erp/food-waste-alpha/totals`, `erp/catalog/commodity-groups`, `core/business/{id}/locations/vat-defaults` |
| neu, mit Validierung | 422, gleicher Text | `erp/food-waste-alpha/recipes`, `analytics/budget/{id}` |
| neu, ohne Vorbelegung | 500 „Typed property … must not be accessed before initialization" | `erp/stocktakings` (braucht `erpIds[]`) |
| alt | 500 PHP-Typfehler mit Parametername | `{erpId}/product`, `{erpId}/dashboard`, `{erpId}/product/categories`, `…/additional-sorting`, `…/storages` |

**Folge für den Importer:** Ein 404 von FoodNotify ist kein Beweis, dass ein Pfad oder ein Datensatz fehlt.
Wer 404 als „gibt es nicht" verbucht (und nicht wiederholt), verliert bei einem geänderten Pflichtparameter
still eine Quelle — dieselbe Signatur wie Regel 10. Den Antworttext mitlesen: „Dieser Wert sollte…" ist
Validierung.

## 5. Was sonst noch aus Antworten herausfällt

* **`/app/is-authenticated`** liefert das ganze Rechteobjekt des Kontos (`roles`, `allowedModules`,
  `masterPermissions`, `posPermissions`, `shopPermissions`, `navigation`) — die schnellste Probe, was ein
  Konto darf, bevor man 403er deutet.
* **`/api/erp/stocktakings/validation/{erpId}`** führt Spalten mit dem Namen `dbMetaTimeCreated`,
  `dbMetaTimeUpdated` — interne Metaspalten, die durchgereicht werden.
* **`timeCreated` in zwei Formen:** alt `{date, timezone_type, timezone}` (ein serialisiertes PHP-`DateTime`)
  oder `{timestamp}`, neu ISO-Zeichenketten. Beim Laden beide erwarten.
* **Verwaltungspfade sind geroutet:** `v2/analytics/management/groups`, `v2/billing/management/providers`,
  `v2/erp/catalog-sync/management/syncs`, `supplier/onboardings/reminder-default` antworten einem Kundenkonto
  mit 403 statt 404 — es gibt sie.
* **Stacktraces bei 405** hatte schon das Inventar vom 27.07.2026 notiert (§11). Am 18.11.2026 kamen bei 405
  nur noch die Routenmeldungen, keine Traces.

## 6. Was hier nicht steht

* Nur GET, nur ein Konto (Wilma Wunder), je Pfad ein Aufruf. Wie POST/PUT/DELETE antworten, ist unbekannt und
  bleibt es.
* Keine gezielte Suche nach Schwachstellen. Notiert ist, was bei gewöhnlichen Leseaufrufen von selbst
  zurückkam.
* Ob FoodNotify die Fehlertexte abstellt, ist offen — die Zeilennummern und Klassennamen altern mit jedem
  Release. Die **Muster** in Abschnitt 2 sind das Haltbare.
* **Kein Kontakt zu FoodNotify** wegen dieser Befunde (Entscheidung Eugene, 01.08.2026 und 18.11.2026).
