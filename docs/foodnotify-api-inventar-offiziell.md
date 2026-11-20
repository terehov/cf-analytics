# FoodNotify — die offizielle öffentliche API (OpenAPI-Spezifikation)

~~**Entwurf, Stand 18.11.2026.** Wird vom Hauptagenten um die Messung mit Token ergänzt (Abschnitt „Messung mit Token").~~ **Stand 18.11.2026, mit Messung.** Die Abschnitte über die Spezifikation gelten **laut Spezifikation, nicht gemessen**, soweit dort nichts anderes steht. Was am 18.11.2026 mit einem Scope-Token tatsächlich geantwortet hat, steht im Abschnitt „Messung mit Token"; was daraus für die 14 Registereinträge folgt, im Abschnitt „Was das für den Importer heißt". Das Inventar der **internen** Schnittstelle (beide Oberflächen, 1.053 Methode-Pfad-Paare) steht in `docs/foodnotify-api-inventar-intern-2026-11.md`.

## Kopf

| | |
|---|---|
| Quelle | `https://api3.foodnotify.com/api/doc` — öffentliche Dokumentationsseite, ohne Anmeldung erreichbar |
| Abrufdatum | 18.11.2026 |
| Gespeichert unter | `docs/payloads/foodnotify-2026-11/openapi/` — `index.html` und neun JSON-Dateien (`<version>_<bereich>.json`) |
| Maschinenlesbare Fassung | `docs/payloads/foodnotify-2026-11/openapi/operationen.csv` — eine Zeile je Operation, 270 Zeilen (Spalten siehe Ende dieser Datei) |
| Erhoben wie | Die neun JSON-Dateien wurden heruntergeladen und offline mit einem Python-Skript (`python3 -I`) ausgewertet. Kein Aufruf gegen FoodNotify im Rahmen dieser Auswertung. |
| Format | OpenAPI 3.0.0; die Indexseite nennt Public API **v2.0** (Pos, Erp) und **v1.0** (Recipe, Catering, User, Erp.Legacy, Webhooks, Pos, Shop). Footer der Indexseite: „Powered by Agents. Fixed and polished by Humans" |
| Was NICHT geprüft wurde | ~~Verhalten der Endpunkte gegen den echten Server (siehe Abschnitt „Messung mit Token"). Ob unsere Zugänge die Endpunkte sehen dürfen. Wie ein Token ausgestellt wird.~~ (am 18.11.2026 für ein Konto gemessen, Abschnitt „Messung mit Token") Ob die Spezifikation zum Server passt — nur für die drei POS-Rücklese-Endpunkte gemessen. Die HTML-Ansichten („View Docs") der einzelnen Bereiche — nur die JSON-Dateien und die Indexseite wurden gelesen. ~~Rate Limits.~~ (beobachtet, nicht gemessen: Abschnitt „Drosselung") Ob die Pfade für alle vier Marken gelten — gemessen ist nur Wilma Wunder. |

**Zwei Dinge vorab:**

1. Die offiziellen Pfade (`/api/1.0/…`, `/api/2.0/…`) sind **nicht** die Pfade, die der Importer heute benutzt (`/api/recipes`, `/api/{erpId}/shop-order/…`, `/api/erp/stocktakings`, …, siehe `docs/foodnotify-api-inventar.md`). Das eine ist die dokumentierte Schnittstelle mit Bearer-Authentifizierung, das andere die interne Schnittstelle der Weboberfläche mit Cookie-Sitzung. Die offizielle Fassung ist kleiner und, wo sie Antwortfelder nennt, nur in Version 2.0.
   **Gemessen am 18.11.2026, und anders als hier vermutet:** Auf `https://api3.foodnotify.com` nimmt auch die **interne** Schnittstelle das Bearer-Token an — 38 interne Pfade antworteten mit 2xx, darunter `/api/{erpId}/shop-order/paginate`. Umgekehrt weist **jeder** gemessene `/api/1.0/…`-Pfad das Scope-Token ab. Die Grenze verläuft also nicht zwischen „offiziell" und „intern", sondern je Endpunkt (Abschnitt „Messung mit Token").
2. **Antwortfelder sind nur in den Dateien `2.0_pos`, `2.0_erp` und (teilweise, nur als Anfrage-Bodys) `1.0_pos` beschrieben.** In allen anderen sechs Dateien hat jede Operation nur eine leere `default`-Antwort ohne Schema. Für Recipe, Shop, User, Erp.Legacy, Webhooks und Catering lässt sich aus der Spezifikation **kein einziges Antwortfeld** ablesen.

## Messung mit Token (18.11.2026)

**Gemessen am 18.11.2026**, ein Konto (Wilma Wunder), nur GET, jeder Pfad **einmal**. Das ist eine Bestandsaufnahme der Zugangsgrenzen, keine Prüfung der Inhalte.

### Was gemessen wurde und womit

| | |
|---|---|
| Token | Konto Wilma Wunder, Name „CF Analytics", Id 179, alle zwölf Lese-Scopes: `recipe:read menu:read catering-card:read user-ingredient:read shop:read erp-product:read stocktaking:read order:read catering:read analytics:read pos:read user:read`. Der Eigentümer ersetzt es. **Der Tokenwert steht nirgends im Repo und gehört nirgends hin** (Regel 2) — auch nicht in eine Messdatei, ein Log oder `raw.api_antwort`. |
| Liste | `docs/payloads/foodnotify-2026-11/messliste-token.csv` — 574 GET-Pfadvorlagen aus beiden Oberflächen und der Spezifikation, eingestuft nach Wirkung (`messliste-token.md`). Gemessen werden darf nur `messen = ja` (226 Zeilen): lesend und alle Pfadparameter aus bekannten IDs füllbar. |
| Skript | `docs/payloads/foodnotify-2026-11/intern/werkzeug/token_messen.py` — je Zeile ein GET gegen `https://api3.foodnotify.com`, 1,2 s Pause plus Antwortzeit, Abbruch beim ersten 429. Aufruf `python3 -I token_messen.py <messliste.csv> <datei-mit-token> <ausgabe.csv>`; die Tokendatei liegt außerhalb des Repos. |
| Pfad-IDs (Wilma Wunder) | `erpId` 7984, `costCenterId` 7911, `restaurantId` 7846, `connectionId` 2052 (auch eingesetzt für `accountId`, `mappingId`, `accountIdentifier`), `userId` 10616 |
| Query | nur bei `…/paginate`, `…/search` und allen `/api/2.0/…`: `page=1&page_size=5&perPage=5`. Sonst keine — auch nicht die Parameter, die der Importer oder die Oberfläche mitschicken. |
| Ergebnis | `docs/payloads/foodnotify-2026-11/messung-token-2026-11-18.csv`, 226 Zeilen: **189 gemessen, 37 bewusst nicht** — 32 `/api/1.0/…` (die Familie war vorab gemessen, siehe unten) und fünf, deren Name nach Abgleich, Export oder Warenkorb klingt (`/api/eventCatering/eventOrder/costCenter/{id}/carts`, `/api/pos/export/without_reload/{id}`, `/api/pos/sync/locations`, `/api/pos/sync/user/distinct_categories`, `/api/shop/shoppingList/{id}`). Spalte `form`: die Antwortform **nur als Typen** (Listenlänge, Form des ersten Elements, höchstens 40 Schlüssel, drei Ebenen), keine Werte. |
| Vorab einzeln gemessen, **nicht** in der Messdatei | vom Hauptagenten am selben Tag: Anmeldung und Hosts (Tabelle unten), die Familie `/api/1.0/…` (403, nicht jeder Pfad einzeln), `/api/profile` (403, auch in `messliste-token.csv` Spalte `grund`), `/api/recipes` (~~abgewiesen; Statuscode und Meldung nicht festgehalten~~ 403 „This endpoint does not support scope-limited tokens.", am Vormittag), die Mengen 895 Produkte / 509 Produktgruppen / 316 Rechnungen und die Positionsfelder der Rechnungen bei Anbindung 2052, `recipe` gesetzt bei 3 von 5 Produkten einer Stichprobe. Diese Angaben sind unten mit „Einzelmessung" gekennzeichnet; einen Rohbeleg dafür gibt es im Repo nicht. |
| Nach der Reihe gemessen, **nicht** in der Messdatei | die Detailmessung des Hauptagenten am selben Tag: Bestellliste mit Sortierung, Bestellkopf, Bestellpositionen, Rezeptliste, -kopf, -zutaten, -meta, Inventuren, Betriebe — Abschnitt „Detailmessung nach der Reihe", unten als „Detailmessung" gekennzeichnet. Ebenfalls ohne Rohbeleg im Repo. |

**Ablage der Tokens (seit 19.11.2026):** `FN_API_TOKENS`, ein JSON `{ "<marke>": "<Token>" }` mit einem Token je
Marke (`aposto`, `enchilada`, `deutsche_konzepte`, `wilma_wunder`) — in `.env` lokal und in Dokploy, nie im Repo,
nie in einem Log oder einer Messdatei. `src/config.ts` prüft beim Start Form und Markennamen, nennt in keiner
Meldung einen Wert und reicht das Ergebnis als `config.FN_API_TOKEN` weiter. ~~**Noch liest kein Code die Tokens**;~~
**Seit 19.11.2026 liest nur die Messprobe `bun run fn-token-probe` (`src/fn_token_probe.ts`) die Tokens**, nicht der
Importer; der Importer arbeitet weiter mit der Sitzung (Bestellpositionen und Inventuren gehen mit Token nicht).

### Anmeldung und Hosts (Einzelmessung)

| Host | Ergebnis mit `Authorization: Bearer <token>` |
|---|---|
| `https://api3.foodnotify.com` | **nimmt das Token an.** Alle Zahlen dieses Abschnitts gelten für diesen Host. |
| `https://my.foodnotify.com` (der Host des Importers, `FN_BASE_URL`) | 401 „Full authentication is required" — das Token wird dort nicht angenommen; `/api/1.0/…` antwortet dort mit 405 |
| `https://api.foodnotify.com` | 401 mit `WWW-Authenticate: Basic realm` — ein anderer Dienst |
| `https://api3.foodnotify.com/mcp`, `https://connect.foodnotify.com/mcp` | 403 „Forbidden: Invalid Host header." (siehe „MCP-Server"). Eine spätere Abfrage am selben Tag gab dort 401; der MCP-Server liegt unter `https://my.foodnotify.com/mcp` (`docs/foodnotify-mcp-server.md`) |

Folgerung, nicht gemessen: `api3` und `my` sprechen dasselbe Backend an (die internen Pfade antworten auf `api3` mit denselben Hüllen wie im alten Inventar), prüfen aber verschieden — `my` nur die Cookie-Sitzung, `api3` auch das Token.

### Wie ein Token entsteht

Aus dem Bundle der neuen Oberfläche gelesen (`intern/brew-auth.md` §2–3) und am 18.11.2026 im Browser so durchlaufen:

1. Profil → Reiter **„API-Tokens"** (`/brew/settings/profile?tab=api-tokens`). Der Reiter erscheint nur, wenn das Hauptkonto das Recht `externalApi` hat (`masterPermissions`) — kein Unterbenutzerrecht. Hilfeseite: „Möchtest du ein eigenes Programm oder Skript an FoodNotify anbinden? Dafür erstellst du in deinem Profil ein API-Token." (`help.foodnotify.com/de/anbindungen-zu-ihren-drittsystemen`, Profilseite `help.foodnotify.com/profil-und-einstellungen`).
2. `POST /api/user/api-tokens` mit `{name, scopes, lifetime}` → Antwort mit `authorizeUrl`.
3. Der Browser springt auf die Zustimmungsseite (`/brew/oauth/authorize`), die Zustimmung ist ein HTML-Formular `POST /oauth/v2/auth`.
4. Zurück mit `code` und `state` → `POST /api/user/api-tokens/exchange` mit `{clientId: state, code}` → das Token, **einmal** angezeigt.

`GET /api/user/api-tokens/grantable-scopes` antwortete für Wilma Wunder mit **genau 22 Scopes** (in der Messdatei: `scopes[22]{value, resource, write}`, `lifetimes[5]`, `defaultLifetime`): `recipe`, `menu`, `catering-card`, `user-ingredient`, `shop`, `erp-product`, `stocktaking`, `order`, `catering`, `pos` je `:read` und `:write`, dazu `analytics:read` und `user:read`. Laufzeiten `P1D`, `P1W`, `P1M`, `P1Y`, `P10Y`; laut Hilfeseite Standard ein Jahr.

**`full-access` können wir nicht anlegen.** Der Code der Tokenliste kennt einen Scope `full-access` und markiert ihn rot als „Full access — unrestricted" (`index-C_S_dUhD.js`). Der Dialog bietet aber nur an, was `grantable-scopes` liefert, und dort steht er nicht. **Hypothese, nicht belegt:** Die Endpunkte, die „This endpoint does not support scope-limited tokens." antworten — darunter alle `/api/1.0/…` —, verlangen ein solches Token. Wer es ausstellen kann (FoodNotify selbst, ein anderes Konto, eine Lizenz), ist unbekannt. Entscheidung Eugene vom 18.11.2026: keine Anfrage beim Support (`docs/entscheidungen.md`).

### Was geht, was abgewiesen wird

189 gemessene Pfade, nachgezählt aus `messung-token-2026-11-18.csv`:

| Status | Meldung | Anzahl | Bedeutung |
|---|---|---|---|
| 200 | — | 40 | Antwort mit Daten (Tabelle unten) |
| 204 | — | 1 | `/api/pos/mapping/2052/jobs/active` — kein laufender Job, Token angenommen |
| 403 | „This endpoint does not support scope-limited tokens." | **93** | Der Endpunkt nimmt grundsätzlich kein Scope-Token an — unabhängig vom Scope. Darunter `/api/erp/all`, `/api/pos/locations`, `/api/erp/stocktakings`, alle drei `/api/2.0/erp/stock/*`, die ganze Familie `/api/{erpId}/stocktaking*`, `/api/{erpId}/sales`, `/api/erp/food-waste-alpha/*`, `/api/analytics` (Tableau-Ticket der alten Oberfläche) |
| 403 | „Access Denied." | 5 | Token angenommen, Recht fehlt: `/api/erp/commodity-groups`, `/api/erp/concrete-products`, `/api/erp/product-groups`, `/api/recipes/distinct-categories/name-translations`, `/api/shop/multi-cost-center-ordering`. Ob ein Scope, ein Unterbenutzerrecht oder ein Modul fehlt, sagt die Antwort nicht |
| 403 | „Access Denied. The user doesn't have ROLE_ADMIN." | 4 | Verwaltungspfade von FoodNotify (`/api/v2/analytics/management/groups`, `/api/v2/billing/management/providers`, `/api/v2/erp/catalog-sync/management/syncs`, `/api/supplier/onboardings/reminder-default`) — erwartbar |
| 404 | Validierungsfehler („Dieser Wert sollte nicht leer sein …") | 1 | `/api/recipe/ingredient-search/candidates` ohne Suchbegriff. Token angenommen; der 404 ist eine Formularprüfung, kein „nicht gefunden" |
| 405 | „No route found … Method Not Allowed (Allow: …)" | 40 | Für GET gibt es diesen Pfad nicht. 37 davon sind **geerbte CRUD-Zeilen** der alten Oberfläche (`…/paginate`, `…/search` an `/api/{erpId}/<ressource>`), dazu `/api/pub/version`, `/api/{erpId}/product/suppliers` und `…/product/search-products-without-specified-products`. Kein Befund über das Token |
| 500 | „Account is not of type FnRecipe" | 2 | die beiden fn-recipe-Feeds — Anbindung 2052 ist kein Konto dieses Typs |
| 500 | `SQLSTATE[22P02]: Invalid text representation …` | 2 | `/api/erp/stock-transfer/paginate` und `/search` — geerbte Zeilen; der Server gibt den Datenbankfehler im Klartext aus |
| 500 | „The identifier id is missing for a query of ErpBundle\Database\Entity\Erp" | 1 | `/api/erp/dashboard` ohne ERP-Parameter |
| — | nicht gemessen | 37 | siehe oben |

**Nach Herkunft:** Von den 41 Pfaden mit 2xx kommen 30 nur aus der neuen Oberfläche, 8 aus beiden und 3 aus der Spezifikation (`/api/2.0/pos/accounts/…`). **Kein einziger Pfad, den nur die alte Angular-Oberfläche benutzt, antwortet dem Token** (50 × 403, 40 × 405, 3 × 500). Das Token ist auf die Schnittstelle der neuen Oberfläche zugeschnitten, nicht auf die alte und nicht auf 1.0.

### Die 41 Pfade mit 2xx

Alle mit den IDs von Wilma Wunder. „Felder" ist die Form aus der Spalte `form` — Typen, keine Werte. Listenlängen gelten für den einen Aufruf (bei Seiten: die erste Seite in der gemessenen Größe).

#### Kasse (POS)

| Pfad | Bytes | Form und Felder |
|---|---|---|
| `GET /api/2.0/pos/accounts/{accountIdentifier}/products` | 1.288 | `{data[5], pagination{currentPage, perPage, totalItems, totalPages}}`; je Produkt `id, productId, name, description, netPrice, vatRate, plu, productGroupId, timeModified, absentFromFeedSince, recipe`. Felder wie in der Spezifikation. Einzelmessung: 895 Produkte, `recipe` gesetzt bei 3 von 5 einer Stichprobe (in der Probe der Messdatei bei 0 von 5) |
| `GET /api/2.0/pos/accounts/{accountIdentifier}/product-groups` | 513 | `{data[5], pagination}`; `id, productGroupId, name, description`. Einzelmessung: 509 Gruppen |
| `GET /api/2.0/pos/accounts/{accountIdentifier}/invoices` | 1.868 | `{data[5], pagination}`; je Rechnung `id, invoiceId, timeCreated, businessDay, total, invoiceItems[]`. In der Probe der Messdatei war `invoiceItems` der ersten Rechnung **leer**. Einzelmessung mit `businessDayFrom`/`businessDayTo` = 17.11.2026: 316 Rechnungen, Positionen mit `externalId, plu, name, quantity, netPricePerItem, vatRate, affectsStock, voidReason`, Storno als negative Menge |
| `GET /api/pos/mapping/{accountId}/articles` | 245.924 | `{location, restaurantId, items[895], canCreateRecipes, ingestIssues[2]}`; je Artikel `remoteProductId, name, plu, externalId, recipeId, recipeTitle, isSyncing, isIgnored, price (Text), vat (Ganzzahl), absentFromFeedSince, hasDuplicateName, hasLinkNameMismatch`; je Einlesefehler `product{posId, plu, name, price}, issue, decision, imported` |
| `GET /api/pos/mapping/{accountId}/article-sales` | 56.827 | nacktes Array `[565]` mit `remoteProductId, units, revenue, lastSoldAt`. Zeitraum der Summen unbekannt |
| `GET /api/pos/mapping/{mappingId}/link-targets` | 3.057.838 | nacktes Array `[13.253]` mit `recipeId, title, restaurantId, imagePath, restaurantName, ingredientCount, updatedAt` |
| `GET /api/pos/mapping/{mappingId}/jobs/active` | 0 | 204 ohne Inhalt |
| `GET /api/pos/connection/{connectionId}` | 936 | Hülle `{errors, payload, code, isError}`; `payload`: `connectionId, restaurant, restaurantId, costCenterId, costCenter, syncTime, deviceType{id, name, isWritable, inputFormFormat, bridgeApp, allowMultipleConnections, providesSkus, matchingStrategy, supportsInvoiceFetchTime}, disconnected, init, needsSync`, zehn Schalter `sync*`, `invoicesLastSyncDate, sendInvoicesToErp, excludeInvoicesToErpBeforeInvoiceDate, invoiceFetchTime, productIngestIssueSkippedCount, productIngestIssueImportedCount, vendorInfo, copySettingsErrors`. **Kein Feld `token` oder `apiKey`** in der Antwort |
| `GET /api/pos/connection/product_groups/{connectionId}` | 49.329 | `payload{productGroups[61]{productGroupId, externalId, productGroup, subgroups}, costCenters[3]{restaurant, restaurantId, costCenter, costCenterId}, connected[]}` |

#### Einkauf

| Pfad | Bytes | Form und Felder |
|---|---|---|
| `GET /api/{erpId}/shop-order/paginate` | 49.373 | `{errors, payload{order_by, order_direction, current_page, current_page_size, page_count, total_count, data[5], totalPrice, currency, billingEnabled}, code, isError}`; je Bestellung `markedShopOrder, shopOrderStatus, name, orderNumber, shopOrderChanges, markedShop, comment, shopOrderInvoices, shopOrderDeliveryNote, extDeliveryNoteId, id, timeCreated, createdByUser, updatedByUser, billingSyncStatus, total` |
| `GET /api/shop/order-reminder/subscriptions/options` | 4.766 | `{data{allowedOffsetHours[7], allowedChannels[2], availableSuppliers[91]{shopId, shopName}}}` |
| `GET /api/shops/{erpId}/list/disconnected` | 2 | leeres Array |

#### Warenwirtschaft

| Pfad | Bytes | Form und Felder |
|---|---|---|
| `GET /api/erp/core/{userId}/erps` | 10.041 | `{data[35]}`; je Eintrag `id, costCenter{id, name, restaurant}, hasPricesToUpdate, currency` |
| `GET /api/{erpId}/products` | 55.191 | `payload` mit flacher Seitenangabe (`order_by … total_count`), `data[20]`, `currency`; je Ware u. a. `id, name, unit, unitQuantity, ingredient, artikelId, productId, shop, pricePerUnit, unitPrice, stock, packagingQuantity, packagingUnit(s), baseUnitQuantity, baseUnitUnit, showInStocktaking, isOrderable, groups, storageProducts, categories, timeModified` (36 Schlüssel) |
| `GET /api/{erpId}/category` | 717 | `payload`: Baum `{title, lvl, children[], categoryIcon, sumProductCount, sumProductGroupCount, sumProductLowOnStockCount, sumProductEnoughStockCount, id}` |
| `GET /api/{erpId}/storage` | 1.394 | `payload`: Baum der Lagerorte `{id, name, lvl, children[8], sumProduct…}` |
| `GET /api/{erpId}/stock/change/reasons` | 407 | `payload[10]{reason, count}` |

#### Rezepte

| Pfad | Bytes | Form und Felder |
|---|---|---|
| `GET /api/recipe-viewer/recipes` | 6.347 | `{data[25], pagination}`; je Rezept `id, name, names{de}, imagePath, createdAt, archived, groups[]{id, name}, tags[]` |
| `GET /api/recipe-viewer/recipes/batch` | 11 | `{data[]}` — ohne `recipeIds[]` leer |
| `GET /api/recipe-viewer/config` | 6.281 | `{data{configured, groups[50]{id, name, parentId, visible, children}}}` |
| `GET /api/recipe-viewer/groups` | 5.126 | `{data[50]{id, name, parentId, children}}` |
| `GET /api/recipe/ingredients` | 10.838 | `{data[30], pagination, totalErpCount, totalInUse, currency, maxSelectable}`; je Zutat `source, shopProductId, ingredientId, name, articleNo, supplierId, supplierName, unit, price, imagePath, recipeCount, inErpCount, totalErpCount, productCount, recipeId` |
| `GET /api/recipe/ingredients/suppliers` | 3.975 | `[64]{identifier, name}` |
| `GET /api/recipe/ingredients/copy-target-erps` | 2.736 | `[35]{erpId, name}` |
| `GET /api/recipe/ingredient-search/suppliers` | 5.531 | `[88]{identifier, name}` |
| `GET /api/recipes/cost-calculation/recipes` | 7.027 | `{data[25], total, page, limit}`; je Rezept `recipeId, title, recipeType, locations, avgCogs, avgSalePrice, avgContributionMargin, costOfSalesMinPercent, costOfSalesMaxPercent, corridorMinPercent, corridorMaxPercent, fitsCorridor` |
| `GET /api/recipes/cost-calculation/summary` | 155 | `{data{avgCostOfSalesMealPercent, avgCostOfSalesDrinkPercent, recipesOutOfCorridor, invalidRecipes}}` |
| `GET /api/recipes/cogs-corridors/distinct-categories` | 7.384 | `{data[75]{categoryId, name, parentId, minPercent, maxPercent}}` |
| `GET /api/recipes/cogs-corridors/recipe-types` | 187 | `{data[3]{recipeType, minPercent, maxPercent}}` |
| `GET /api/recipes/distinct-categories` | 17.904 | `{data[50]{id, name, sourceLocale, displayName{…}, nameTranslations, slug, parentId, orderId, children}, languages{…}}` |
| `GET /api/recipes/dashboard-mix/restaurants` | 1.181 | `{restaurants[18]{id, name, currency}}` |
| `GET /api/recipes/dashboard-mix/{restaurantId}/monthly-costs` | 93 | `{currency, monthly_costs{"2026": [12 Zahlen]}}` |

#### Analytics

| Pfad | Bytes | Form und Felder |
|---|---|---|
| `GET /api/analytics/reports/cost-analysis/ingredients/cards` | 1.148 | `{data{…}}` mit 25 Kennzahlen: `posTurnoverMapped, posTurnoverNet, …Food/…Beverage, actualFnbCost, theoreticalFnbCost, …Percentage, potentialCostSavings…, recordSyncedAt, posRecordSyncedAt, stockRecordSyncedAt` |
| `GET /api/analytics/reports/cost-analysis/ingredients/by-month` | 17.427 | `{data[119]{restaurantId, restaurantName, month, actualFnbCost, theoreticalFnbCost}}` |
| `GET /api/analytics/reports/cost-analysis/ingredients/by-product` | 1.399.438 | `{data[5.077]{restaurantId, restaurantName, concreteProductId, concreteProductName, actualFnbCost, theoreticalFnbCost, diff, diffPercentage, isFood, isBeverage}}` |
| `GET /api/analytics/reports/cost-analysis/ingredients/by-restaurant` | 1.785 | `{data[13]{restaurantId, restaurantName, actualFnbCost, theoreticalFnbCost}}` |
| `GET /api/analytics/reports/cost-analysis/ingredients/food-waste` | 338.102 | `{data[1.980]{restaurantId, restaurantName, businessDate, breakageValue, spoilageValue, rawWasteValue, totalWasteValue}}` |
| `GET /api/analytics/reports/cost-analysis/runner-bummer/ingredients` | 7.262 | `{data[50]{posRecipeName, quantity, posCost, turnover, netTurnover, profit}, pagination}` |
| `GET /api/analytics/reports/cost-analysis/runner-bummer/unmapped` | 5.854 | wie oben |
| `GET /api/v2/analytics` | 5.753 | `{tableauUrl, siteContentUrl, analyticsId, views[28]{id, name, contentUrl, viewUrlName}}` — **kein Token in der Antwort** (das alte Inventar §7 beschreibt hier `{token: <JWT>}`; das JWT kommt heute aus `/api/v2/analytics/token`, nicht gemessen) |

#### Konto

| Pfad | Bytes | Form und Felder |
|---|---|---|
| `GET /api/user/api-tokens/grantable-scopes` | 1.439 | `{scopes[22]{value, resource, write}, lifetimes[5], defaultLifetime}` |

### Detailmessung nach der Reihe (18.11.2026)

**Gemessen am 18.11.2026** vom Hauptagenten, nach der Messreihe: Token, `api3.foodnotify.com`, Wilma Wunder, `erpId` 7984, **je ein GET**. Diese Pfade waren in der Messliste nicht messbar, weil sie eine Bestell-, Rezept- oder Benutzer-ID brauchen. Kein Rohbeleg im Repo; die Felder sind die vom Hauptagenten notierten.

| Pfad | Ergebnis | Form und Felder |
|---|---|---|
| `/api/7984/shop-order/paginate?page=1&page_size=5&order_by=timeCreated&order_direction=DESC` | **200** | `total_count` 1.988; Zeilenschlüssel wie in der Messreihe: `markedShopOrder, shopOrderStatus, name, orderNumber, shopOrderChanges, markedShop, comment, shopOrderInvoices, shopOrderDeliveryNote, extDeliveryNoteId, id, timeCreated, createdByUser, updatedByUser, billingSyncStatus, total`. Sortierparameter mit Token angenommen |
| `/api/7984/shop-order/{id}` (Bestellkopf) | **200** | `payload.markedShopOrder{total, deliveryDate, products[], orderId}`, `shopOrderChanges[{id}]`, `markedShop{shopId, name, hasDeliveryNotes, logo}`, `shopOrderInvoices[{invoiceNumber, invoiceDate, id}]`, `timeCreated{timestamp}`, `createdByUser`/`updatedByUser{uid, firstName, lastName}` |
| `/api/7984/shop-order/{id}/change?order_by=name` (Bestellpositionen) | **403** | „This endpoint does not support scope-limited tokens." |
| `/api/recipe-viewer/recipes?page=1` | **200** | `pagination{totalItems 13.263, perPage 25, totalPages 531}`; Felder `id, name, names, imagePath, createdAt, archived, groups, tags` |
| `/api/recipes?page=1` (Rezeptliste des Importers) | **403** | „This endpoint does not support scope-limited tokens." (am Vormittag) |
| `/api/recipes/{id}` | **200** | `{data:{id, name, names{de}, imagePath, createdAt, archived, groups[], tags[]}}`. `/api/recipe-viewer/recipes/{id}` liefert dieselbe Form, ebenfalls 200 |
| `/api/recipes/{id}/ingredients` | **200** | `{data: []}` — bei diesem Rezept leer, **Zutatenfelder daher nicht gesehen** |
| `/api/recipes/{id}/meta` | **200** | `{data:{weight{total, perPerson, portionSize, portionSizeUnit, loss}, allergens[], additives[], comment, nutritions[{name, sum, unit, children}]}}` |
| `/api/1.0/recipes/{id}`, `/api/1.0/recipes/{id}/ingredients` | **403** | „does not support scope-limited tokens" |
| `/api/erp/stocktakings?erpIds[]=7984&page=1` | **403** | „does not support scope-limited tokens" |
| `/api/7984/stocktaking/paginate` | **403** | „does not support scope-limited tokens" |
| `/api/profile` | **403** | „does not support scope-limited tokens" |
| `/api/core/business/10616/restaurants` | **200** | `{data:[18 × {id, name, timezone, language, countryCode}]}` |

Drei Dinge, die daraus folgen:

* **Die Grenze verläuft je Endpunkt, auch innerhalb einer Familie.** Die Rezeptliste `/api/recipes` ist abgewiesen, das Einzelrezept `/api/recipes/{id}` mit `/ingredients` und `/meta` nicht. Der Bestellkopf geht, die Positionen (`/change`) nicht.
* ~~**`markedShopOrder.products[]` ersetzt `/change` vermutlich nicht.** Das alte Inventar (§4) beschreibt dort nur `{price, productId}` je Produkt — ohne Menge, Gebinde und `concreteProduct`. **Nicht geprüft**; die Felder von `products[]` hat die Detailmessung nicht festgehalten.~~ **`markedShopOrder.products[]` ersetzt `/change` nicht** — die Sitzungsmessung zeigt dort nur `price` und `productId` je Produkt, ohne Menge, Gebinde und `concreteProduct` (`messung-sitzung-2026-11-18.md`, Befund 5).
* **`createdByUser`/`updatedByUser` tragen Vor- und Nachnamen** von Mitarbeitenden. Wie heute: in `raw` und `core` ja, nie in `mart`.

~~**Läuft (18.11.2026):** eine Messung derselben Lesepfade **mit der Cookie-Sitzung im Browser**, für die Antwortformen der internen Schnittstelle und den Vergleich Token gegen Sitzung. Ergebnis wird hier nachgetragen.~~ Erledigt am 18.11.2026, siehe den nächsten Abschnitt.

### Gegenprobe mit der Cookie-Sitzung (18.11.2026)

**Gemessen am 18.11.2026** vom Hauptagenten im Browser, Konto Wilma Wunder, angemeldete Sitzung gegen `my.foodnotify.com`, nur GET, je Pfad ein Aufruf. Bericht mit allen Zahlen, Befunden und technischen Auffälligkeiten: `docs/payloads/foodnotify-2026-11/messung-sitzung-2026-11-18.md`. Die Rohdateien `fn-cookie-messung-1.json` und `fn-cookie-messung-2.json` gehören nach `belege/foodnotify-inventur-2026-11-18/`; **sie liegen dort noch nicht**.

| | Sitzung, Runde 1 | Sitzung, Runde 2 (Detailpfade) | Token (Messreihe) |
|---|---|---|---|
| gemessene Pfade | 204 | 55 | 189 |
| 200 / 204 | **129** | **45** | **41** |
| 403 | 5 (`Access Denied`, `ROLE_ADMIN`) | 0 | 102 (davon 93 „scope-limited") |
| 405 | 40 | 7 | 40 |
| 500 | 21 | 2 | 5 |
| 404 / 422 | 9 | 1 | 1 |

Die beiden Pfadmengen sind **nicht deckungsgleich** (204 gegen 189; die Sitzung hat auch die Familie `/api/1.0/…` nicht, das Token die Detailpfade erst in der Detailmessung). Der Vergleich gilt für die Größenordnung: Die Sitzung erreicht rund dreimal so viele Pfade wie das Scope-Token. Zeilen und Werte sind zwischen beiden **nicht** verglichen.

Was davon für den Importer zählt (Befunde 1–8 dort, hier verkürzt):

* **Alle Register-Pfade antworten mit der Sitzung**, auch `/change` (5 Positionen, alle bekannten Felder) und `/api/erp/stocktakings/{uuid}/items` (172 Positionen). Nicht gemessen: die Bestellansicht.
* **`/api/recipes` und `/api/recipe-viewer/recipes` liefern mit der Sitzung dieselbe Antwort** (Seite 1 gleich groß, gleiche Felder, `archived` je Eintrag, `totalItems`); ebenso `/api/recipes/{id}` und `/api/recipe-viewer/recipes/{id}`. Mit dem Token ist nur die erste Liste gesperrt.
* **Zutaten:** `id, kind, name, quantity, unit, baseQuantity, baseUnit, cost, artikelId, supplier, subRecipeId, group`, mit der Sitzung an drei Rezepten (1, 2, 6 Zutaten). **Token-Nachprobe** (Hauptagent): dasselbe Rezept mit 6 Zutaten, dieselben Felder, `artikelId` bei 5 von 6 gesetzt, `kind` = `ingredient`, `product_group`, `sub_recipe`. Ein Rezept ohne Zutaten antwortet `{data: []}` mit 200.
* **`link-targets`** (Sitzung und Token): 13.253 Rezepte, davon 158 ohne Zutaten, 17 verschiedene `restaurantId`, `updatedAt` von 19.10.2022 bis 17.11.2026, rund 11 s, keine Seiten.
* **Verkäufe** (`/api/{erpId}/sales`): `finishError` bei allen zehn Probezeilen `null`. Ein Hinweis, kein Befund (`foodnotify-api-inventar.md` §8a).


### Was an den Antworten auffällt

* **Dieselbe Kasse, zwei Wege, gleiche Zahl.** `/api/2.0/pos/accounts/2052/products` (Einzelmessung) und `/api/pos/mapping/2052/articles` führen beide **895** Produkte. Dass es dieselben sind, ist nicht geprüft.
* **Zwei Steuerskalen.** `vatRate` (2.0) war in der Probe eine Kommazahl, laut Spezifikation ein Bruch (0.1 = 10 %); `vat` am Mapping-Artikel eine Ganzzahl — vermutlich Prozent. Regel 6: vor dem Laden je Feld messen, nicht annehmen.
* **`netPrice` war in allen fünf Probezeilen eine Ganzzahl**, `price` am Mapping-Artikel ein Text. Ob Euro oder Cent, ist nicht geprüft.
* **Die Bestellliste kommt mit Token in der `payload`-Hülle** (`{errors, payload{…, data}, code, isError}`), nicht flach. Das alte Inventar nennt für `/api/{erpId}/*` die flache Form und in §8b beide je nach Marke. `auspacken()` kennt beide; ob die Sitzung für Wilma Wunder dieselbe Hülle bekommt, ist nicht verglichen.
* **`link-targets` trägt `restaurantId` und `updatedAt` je Rezept** — 13.253 Zeilen. Die Rezeptprobe vom 15.10.2026 zählte für Wilma Wunder 12.655 Rezepte (`totalItems`). Ob eine Zeile je Rezept oder je Rezept und Betrieb steht, und ob `updatedAt` ein Änderungsdatum des Rezepts ist, ist **nicht geprüft**. Die Detailmessung zählt am selben Tag 13.263 Rezepte in `/api/recipe-viewer/recipes` (`totalItems`), zehn mehr als `link-targets` Zeilen hat — das spricht für eine Zeile je Rezept (geschlossen, nicht geprüft). Beides wäre neu: `docs/datenherkunft.md` sagt heute „kein Betriebsbezug" und „kein Änderungsdatum".
* **Prozentfelder der Kostenanalyse** (`…Percentage`, `diffPercentage`, `minPercent`) — Skala nicht geprüft (Regel 6).
* **Fehlerseiten sind weiter auskunftsfreudig:** zwei 500er geben den PostgreSQL-Fehler im Klartext zurück, einer den Entitätsnamen. Dasselbe hat das alte Inventar am 27.07.2026 für 405-Seiten notiert (§11).

### Drosselung

Rund 230 Aufrufe an diesem Tag (189 der Messreihe plus die Einzelmessungen, Angabe Hauptagent), im Abstand von 1,2 bis 1,5 s: **kein 429, keine Rate-Limit-Header.** Das ist eine Beobachtung, keine gemessene Grenze. Regel 3 gilt unverändert — eine fehlende Angabe ist keine Erlaubnis.

### MCP-Server

FoodNotify bewirbt einen MCP-Server „für Claude und ChatGPT", „mit Ihren Rechten", Schwerpunkt Rezeptdaten; seit 09.11.2026 kann er in Claude auch Rezepte **bearbeiten** (Hilfeseiten „KI" und „Neu im November 2026", lokal unter `belege/foodnotify-inventur-2026-11-18/hilfe/`). `GET https://api3.foodnotify.com/mcp` und `GET https://connect.foodnotify.com/mcp` antworteten mit 403 „Forbidden: Invalid Host header." (Einzelmessung). ~~Der Host des MCP-Servers ist **unbekannt**; im Bundle steht nichts dazu (`intern/brew-auth.md` §3). Für den Importer ohne Bedeutung, solange er nicht bekannt ist —~~ **Gefunden am 18.11.2026:** Der MCP-Server liegt unter `https://my.foodnotify.com/mcp`, mit eigenem OAuth (PKCE, `/mcp/oauth/authorize`) und eigenen Scopes (`recipe:read`, `recipe:write`, `erp-product:write`, `user:read`, `account:switch` — nicht die 22 der API-Tokens). Alles dazu in `docs/foodnotify-mcp-server.md`. Für den Importer ohne Bedeutung: Er hängt an einer angemeldeten Person und deckt nach seinen Scopes weder Einkauf noch Inventur noch Verkäufe ab — und ein Werkzeug, das Rezepte schreiben kann, ist für uns ohnehin nur lesend denkbar (Regel 1 sinngemäß).

### Was diese Messung nicht sagt

* ~~**Ein Konto.** Nur Wilma Wunder, nur die IDs eines Betriebs und einer Kassenanbindung. Ob die drei anderen Marken dieselben 22 Scopes bekommen und dieselben Pfade erreichen, ist nicht gemessen (Entscheidung Eugene: erst nach dem Inventar).~~ **Nachtrag 19.11.2026:** Die 14 Importer-Pfade sind bei allen vier Marken gemessen (Nachtrag „alle vier Marken" unten) — gleiches Ergebnis bei jeder Marke. Die Messreihe der 189 Pfade und `grantable-scopes` bleiben nur für Wilma Wunder gemessen.
* **Jeder Pfad einmal**, ohne die Parameter des Importers (`order_by`, `order_direction`, `page_size=25`, `erpIds[]`). Ob Sortierung und Seitengröße mit Token wirken, ist offen. (Detailmessung: `order_by=timeCreated&order_direction=DESC` an der Bestellliste angenommen; `ASC` und `page_size=25` nicht gemessen.)
* ~~**Keine Detailpfade.** Bestellkopf (`/api/{erpId}/shop-order/{id}`), Positionen (`…/change`), Inventurpositionen (`/api/erp/stocktakings/{uuid}/items`), Rezeptkopf, Zutaten und Meta sind **nicht** mit Token gemessen — die Messliste kannte für diese Parameter keine ID.~~ Seit der Detailmessung (oben) gemessen, je einmal: Bestellkopf, Positionen (403), Rezeptkopf, Zutaten, Meta. **Weiter nicht gemessen:** Inventurpositionen (`/api/erp/stocktakings/{uuid}/items`) und Zutaten eines Rezepts, das Zutaten hat.
* **Nicht verglichen mit der Sitzung.** Ob ein Pfad mit Token dieselben Zeilen liefert wie mit Cookie, ist nirgends geprüft. ~~Die Messung mit der Cookie-Sitzung im Browser läuft (18.11.2026).~~ Die Sitzungsmessung (Abschnitt „Gegenprobe mit der Cookie-Sitzung") vergleicht Status und Form, nicht Zeilen.
* **`/api/2.0/erp/goods-receipts/{billingAccountId}`** ist nicht gemessen; woher die `billingAccountId` kommt, ist unbekannt.
* **1.0 nicht je Pfad.** Die Familie wurde vorab als Ganzes geprüft; alle geprüften Pfade antworteten 403 „does not support scope-limited tokens".
* **Nichts Schreibendes, nichts aus der Sicherheitsliste** (`messliste-token.md` §4) wurde aufgerufen.

## Was das für den Importer heißt (Stand 18.11.2026)

Der Importer arbeitet heute mit Cookie-Sitzung gegen `my.foodnotify.com`. Diese Tabelle sagt je Registereintrag aus `src/foodnotify/endpunkte.ts`, ob es mit dem Token auf `api3` einen Weg gibt. **Gemessen für ein Konto (Wilma Wunder) und eine Kassenanbindung (2052).**

### Endstand (18.11.2026, nach Sitzungsmessung und Token-Nachprobe)

Je Zelle ein Aufruf. „Sitzung" aus `messung-sitzung-2026-11-18.md`, „Token" aus Messreihe, Detailmessung und Nachprobe (Abschnitte oben).

| Registereintrag | Pfad heute | Sitzung (`my`) | Token (`api3`) | Weg mit Token | Vorbehalt |
|---|---|---|---|---|---|
| `fn:profil` | `/api/profile` | 200 | **403** | keiner | Die Benutzer-ID (10616) brauchen `fn:betriebe` und `/api/erp/core/{userId}/erps`; mit Token müsste sie aus dem Bestand kommen |
| `fn:betriebe` | `/api/core/business/{userId}/restaurants` | 200 | **200**, 18 × `{id, name, timezone, language, countryCode}` | derselbe Pfad | — |
| `fn:kostenstellen` | `/api/erp/all` | 200 | **403** | `/api/erp/core/{userId}/erps` (200, 35 Einträge) | dass `id` die `erpId` ist, ist geschlossen |
| `fn:pos_standorte` | `/api/pos/locations` | 200 | **403** | nur je **bekannter** Anbindung `/api/pos/connection/{connectionId}` | aufzählen lassen sich die Anbindungen mit Token nicht |
| `fn:bestellungen` | `/api/{erpId}/shop-order/paginate` | 200 | **200** (mit `order_by=timeCreated&order_direction=DESC`, `total_count` 1.988) | derselbe Pfad | `ASC` und `page_size=25` mit Token nicht gemessen |
| `fn:bestellung` | `/api/{erpId}/shop-order/{orderId}` | 200 | **200** | derselbe Pfad | — |
| `fn:bestellpositionen` | `/api/{erpId}/shop-order/{orderId}/change` | 200 (5 Positionen) | **403** | **keiner** — `markedShopOrder.products[]` im Kopf trägt nur `price` und `productId`, **kein Ersatz** | **nur mit Sitzung** |
| `fn:bestellansicht` | `/shop/{shopId}/orders/{nr}` (HTML) | nicht gemessen | nicht gemessen | — | Seite von `my.foodnotify.com`; das Token wird dort abgewiesen (401) |
| `fn:inventuren` | `/api/erp/stocktakings?erpIds[]=…` | 200 | **403** | keiner | **nur mit Sitzung** |
| `fn:inventurpositionen` | `/api/erp/stocktakings/{uuid}/items` | 200 (172 Positionen) | nicht gemessen (Liste und Familie 403) | keiner | **nur mit Sitzung** |
| `fn:rezepte` | `/api/recipes?page=N` | 200 | **403** | `/api/recipe-viewer/recipes` (200; mit der Sitzung dieselbe Antwort wie `/api/recipes`; 13.263 Rezepte, 531 Seiten) | — |
| `fn:rezept` | `/api/recipes/{id}` | 200 | **200** | derselbe Pfad | gleiche Form wie `/api/recipe-viewer/recipes/{id}` |
| `fn:rezept_zutaten` | `/api/recipes/{id}/ingredients` | 200 (3 Rezepte) | **200**, 6 Zutaten, `artikelId` bei 5 von 6 | derselbe Pfad | ein Rezept mit Token; dieselben zwölf Felder wie mit der Sitzung |
| `fn:rezept_meta` | `/api/recipes/{id}/meta` | 200 | **200** | derselbe Pfad | — |

**Ergebnis (Endstand):** Mit der Sitzung antworten **13 von 14** Einträgen (die Bestellansicht ist nicht gemessen). Mit dem Token tragen **sechs** (`fn:betriebe`, `fn:bestellungen`, `fn:bestellung`, `fn:rezept`, `fn:rezept_zutaten`, `fn:rezept_meta`), **zwei** über einen anderen Pfad (`fn:rezepte`, `fn:kostenstellen`), **vier** sind abgewiesen (`fn:profil`, `fn:pos_standorte`, `fn:bestellpositionen`, `fn:inventuren`), `fn:inventurpositionen` ist mit Token nicht gemessen und `fn:bestellansicht` gar nicht. **Die Rezepte ließen sich vollständig über das Token holen** (Liste über `recipe-viewer`, Kopf, Zutaten mit `artikelId`, Meta) — belegt an je einem Aufruf eines Kontos. **Bestellpositionen und Inventuren gehen nur mit der Sitzung**, und ohne `/api/profile` und `/api/pos/locations` fehlen dem Token Benutzer-ID und Anbindungsliste. Das Token ersetzt die Sitzung deshalb nicht; ~~ein gemischter Betrieb wäre möglich, ist aber nicht entschieden~~ — seit `0160` (19.11.2026) läuft er (Nachtrag „Sitzung gegen Token auf Zeilenebene“ unten).

### Nachtrag: alle vier Marken, 19.11.2026

**Gemessen am 19.11.2026, 18:51–18:53 UTC** mit `bun run fn-token-probe` (`src/fn_token_probe.ts`): je Marke ein
Token aus `FN_API_TOKENS`, nur `api3`, je Pfad **ein** GET in der **Form des Registers** (mit `order_by`,
`order_direction`, `page_size=25` bzw. `1000`, `erpIds%5B%5D`), 16 GET je Marke. Benutzer-ID und Kassenanbindung
aus der Sitzung, die Kostenstelle aus der Token-Antwort `/api/erp/core/{userId}/erps`. Je Marke eine echte
Kostenstelle mit amadeus-Anbindung (Testbetriebe übersprungen): Aposto Aalen Küche (10117/2070), Enchilada Köln
Küche (10059/1095), Würzburger Hofbräu Küche (12011/1729), Wilma Wunder Ballplatz Mainz Bar (7984/2052). Bericht
mit allen Zahlen: `docs/payloads/foodnotify-2026-11/fn-token-probe-2026-11-19.md`.

| Registereintrag | Pfad mit Token | aposto | enchilada | deutsche_konzepte | wilma_wunder |
|---|---|---|---|---|---|
| `fn:profil` | `/api/profile` | nicht neu gemessen | nicht neu gemessen | nicht neu gemessen | 403 (18.11.) |
| `fn:betriebe` | `/api/core/business/{userId}/restaurants` | **200** | **200** | **200** | **200** |
| `fn:kostenstellen` | Ersatz `/api/erp/core/{userId}/erps` | **200** | **200** | **200** | **200** |
| `fn:pos_standorte` | `/api/pos/locations` | nicht neu gemessen | nicht neu gemessen | nicht neu gemessen | 403 (18.11.) |
| `fn:bestellungen` | `…/shop-order/paginate?page=1&page_size=25&order_by=timeCreated&order_direction=ASC` | **200** | **200** | **200** | **200** |
| `fn:bestellung` | `/api/{erpId}/shop-order/{orderId}` | **200** | **200** | **200** | **200** |
| `fn:bestellpositionen` | `…/change?order_by=name` | **403** | **403** | **403** | **403** |
| `fn:bestellansicht` | HTML auf `my` | nicht gemessen | nicht gemessen | nicht gemessen | nicht gemessen |
| `fn:inventuren` | `/api/erp/stocktakings?page=1&order_by=timeCreated&order_direction=ASC&erpIds%5B%5D=…` | **403** | **403** | **403** | **403** |
| `fn:inventurpositionen` | `/api/erp/stocktakings/{uuid}/items` | nicht gemessen | nicht gemessen | nicht gemessen | nicht gemessen |
| `fn:rezepte` | `/api/recipes?page=1` | **403** | **403** | **403** | **403** |
| `fn:rezepte` (Ersatz) | `/api/recipe-viewer/recipes?page=1` | **200** | **200** | **200** | **200** |
| `fn:rezept` | `/api/recipes/{id}` | **200** | **200** | **200** | **200** |
| `fn:rezept_zutaten` | `/api/recipes/{id}/ingredients` | **200**, `artikelId` 8 von 10 | **200**, 3 von 5 | **200**, 7 von 7 | **200**, 1 von 1 |
| `fn:rezept_meta` | `/api/recipes/{id}/meta` | **200** | **200** | **200** | **200** |
| `fn:warenstamm` | `/api/{erpId}/products?page=1&page_size=1000` | **200** (145) | **200** (627) | **200** (333) | **200** (206) |
| `fn:pos_artikel` | `/api/pos/mapping/{connectionId}/articles` | **200** (1.157) | **200** (1.357) | **200** (438) | **200** (895) |
| — | `/api/pos/mapping/{connectionId}/link-targets` | **200** (965) | **200** (1.972) | **200** (1.992) | **200** (13.265) |

Jede 403 lautet „This endpoint does not support scope-limited tokens.". **Keine Abweichung zwischen den Marken.**

**Ergebnis (19.11.2026, ersetzt den Vorbehalt „gemessen für ein Konto" im Endstand oben):**

* Das Ergebnis von Wilma Wunder gilt für **alle vier Marken**: Mit dem Token tragen `fn:betriebe`,
  `fn:bestellungen`, `fn:bestellung`, `fn:rezept`, `fn:rezept_zutaten`, `fn:rezept_meta` und — neu im Register seit
  `0155`/`0157` und erstmals in Registerform mit Token gemessen — **`fn:warenstamm`** und **`fn:pos_artikel`**;
  `fn:rezepte` über `recipe-viewer`, `fn:kostenstellen` über `/api/erp/core/{userId}/erps`. Abgewiesen bleiben
  `fn:bestellpositionen` und `fn:inventuren` (bei allen vier), `fn:profil` und `fn:pos_standorte` (bei Wilma
  gemessen, für die anderen geschlossen, nicht gemessen).
* **Die Registerform trägt mit Token:** `ASC` mit `page_size=25` an der Bestellliste (vorher nur `DESC` gemessen),
  `page_size=1000` am Warenstamm (`current_page_size` 1000, alle Zeilen in einer Antwort).
* **Rezepte gingen bei allen vier Marken vollständig über das Token** — Liste (`recipe-viewer`), Kopf, Zutaten mit
  `artikelId` (dieselben zwölf Felder je Marke), Meta. Je ein Aufruf je Marke; Folgeseiten der Liste nicht gemessen.
* **Kassenartikel (`fn:pos_artikel`) und Warenstamm (`fn:warenstamm`) gingen ebenfalls über das Token**; nur die
  Anbindungsliste fehlt dem Token (die `connectionId` muss aus der Sitzung oder dem Bestand kommen,
  `core.kostenstelle`). Die Kassenartikel kamen mit Token in 0,4–1,3 s statt 19–39 s mit der Sitzung — eine Messung,
  nicht geklärt.
* ~~Was offen bleibt: dieselbe Messung für die drei anderen Marken~~ erledigt. **Weiter offen:** ~~Token gegen Sitzung
  auf Zeilenebene~~ (gemessen, Nachtrag unten); die Differenz Rezeptliste gegen `link-targets` (Enchilada 2.079 gegen 1.972 — archivierte?);
  Inventurpositionen und Bestellansicht mit Token.

### Nachtrag: Sitzung gegen Token auf Zeilenebene, 19.11.2026 — und was der Importer seitdem tut

**Gemessen am 19.11.2026, 19:03–19:06 UTC** mit `bun run fn-token-probe --vergleich`, an denselben Zielen wie
oben, je Abruf einmal Sitzung und einmal Token (14 GET je Marke). **23 von 24 Abrufpaaren sind nach
Schlüsselsortierung byteweise gleich** — Rezeptliste Seite 1 (`/api/recipes` gegen `/api/recipe-viewer/recipes`,
samt `pagination`), Rezeptkopf, Zutaten, Meta, Kassenartikel und Warenstamm bei allen vier Marken. Das 24. Paar
(Warenstamm Deutsche Konzepte, 12011) wich nur in `cartProductQuantity` **einer** Ware ab, der Warenkorbmenge, die
zwischen den beiden Aufrufen geändert wurde und die der Lader nicht liest. Die Kassenartikel kamen diesmal auch mit
der Sitzung in unter einer Sekunde. Bericht: `payloads/foodnotify-2026-11/fn-token-probe-2026-11-19.md`,
Abschnitt „Vergleich Sitzung gegen Token".

**Folge (`0160`, Entscheidung Eugene 19.11.2026, gemischter Betrieb):** `fn:rezepte` (über `recipe-viewer`),
`fn:rezept`, `fn:rezept_zutaten`, `fn:rezept_meta`, `fn:pos_artikel` und `fn:warenstamm` laufen **über das Token**,
mit der Sitzung als dauerhaftem Rückfall je Posten; alles andere bleibt bei der Sitzung. ~~Ein gemischter Betrieb
wäre möglich, ist aber nicht entschieden.~~ Regel und Sichtbarkeit: `docs/importer.md`, Abschnitt „FoodNotify: zwei
Zugänge, eine Spur".

### Zwischenstand vor der Sitzungsmessung (überholt)

Die folgende Tabelle und die beiden Ergebnissätze darunter sind der Stand nach Messreihe und Detailmessung. Sie bleiben als Verlauf stehen; maßgeblich ist der Endstand oben.

| Registereintrag | Pfad heute | mit Token | Ersatz mit Token | Vorbehalt |
|---|---|---|---|---|
| `fn:profil` | `/api/profile` | **403** (Einzelmessung, in der Detailmessung bestätigt: „does not support scope-limited tokens") | keiner; `/api/1.0/user` ebenfalls 403 | Die Benutzer-ID (Wilma Wunder 10616) braucht `/api/erp/core/{userId}/erps`; mit Token ist sie aus keinem gemessenen Pfad zu lesen und müsste aus dem Bestand kommen (`raw.api_antwort`, `fn:profil`) |
| `fn:betriebe` | `/api/core/business/{userId}/restaurants` | ~~**nicht gemessen**~~ **200** (Detailmessung, mit 10616): `{data:[18 × {id, name, timezone, language, countryCode}]}` | derselbe Pfad. ~~Teilersatz `/api/recipes/dashboard-mix/restaurants`: 18 × `{id, name, currency}`, **ohne** `timezone`~~ | ~~Die Messliste führt den Parameter als `businessId` „unbekannt" — der Importer setzt dort die Benutzer-ID ein. Ein Aufruf mit 10616 hätte die Frage beantwortet~~ Die Benutzer-ID muss aus dem Bestand kommen (`fn:profil` ist abgewiesen). 18 Betriebe — dieselbe Zahl wie `dashboard-mix/restaurants` |
| `fn:kostenstellen` | `/api/erp/all` | **403** | `/api/erp/core/{userId}/erps` **200**: 35 × `{id, costCenter{id, name, restaurant}, hasPricesToUpdate, currency}` | 35 trifft die Kostenstellenzahl des alten Inventars für Wilma Wunder (§8b). Dass `id` die `erpId` ist und `costCenter.restaurant` die `restaurant.id` trägt, ist **geschlossen** — die Form reicht nur drei Ebenen tief |
| `fn:pos_standorte` | `/api/pos/locations` | **403** | nur für eine **bekannte** Anbindung: `/api/pos/connection/{connectionId}` **200** mit `restaurantId`, `costCenterId`, `deviceType.name` | Aufzählen lassen sich die Anbindungen mit Token nicht (kein gemessener Pfad). `deviceType.name` entscheidet, ob die PLU-Brücke trägt (nur `amadeus`) |
| `fn:bestellungen` | `/api/{erpId}/shop-order/paginate` | **200** | derselbe Pfad | gemessen mit `page_size=5` ohne `order_by`/`order_direction`; Hülle `payload` (oben). Detailmessung mit `order_by=timeCreated&order_direction=DESC`: 200, `total_count` 1.988. Die Registerwerte `ASC` und `page_size=25` sind nicht gemessen |
| `fn:bestellung` | `/api/{erpId}/shop-order/{orderId}` | ~~**nicht gemessen**~~ **200** (Detailmessung, ein Aufruf) | derselbe Pfad | `markedShopOrder{total, deliveryDate, products[], orderId}`, `shopOrderInvoices[{invoiceNumber, invoiceDate, id}]`, `markedShop{shopId, name, hasDeliveryNotes, logo}` — die Kopffelder des alten Inventars (§4). Pfad steht in beiden Bundles |
| `fn:bestellpositionen` | `/api/{erpId}/shop-order/{orderId}/change` | ~~**nicht gemessen**~~ **403** „does not support scope-limited tokens" (Detailmessung) | keiner gemessen | ohne Positionen ist der Einkauf wertlos. `markedShopOrder.products[]` im Kopf ersetzt sie vermutlich nicht (laut altem Inventar nur `price, productId`) — **nicht geprüft** |
| `fn:bestellansicht` | `/shop/{shopId}/orders/{nr}` (HTML) | **nicht gemessen** | — | Seite von `my.foodnotify.com`, wo das Token abgewiesen wird (401). Geschlossen: mit Token kein Weg |
| `fn:inventuren` | `/api/erp/stocktakings?erpIds[]=…` | **403** | keiner | auch `/api/{erpId}/stocktaking`, `…/paginate`, `…/search` und `/api/1.0/erp/stocktaking` abgewiesen; Detailmessung mit `erpIds[]=7984&page=1` ebenfalls 403 |
| `fn:inventurpositionen` | `/api/erp/stocktakings/{uuid}/items` | **nicht gemessen** | — | Hypothese: abgewiesen wie die Liste. Der Pfad steht in **keinem** der beiden Bundles |
| `fn:rezepte` | `/api/recipes?page=N` | ~~**abgewiesen** (Einzelmessung, Status nicht festgehalten)~~ **403** „does not support scope-limited tokens" (Einzelmessung) | Kandidat `/api/recipe-viewer/recipes` **200**: `{data[25], pagination}`, je Rezept `id, name, names, imagePath, createdAt, archived, groups, tags` — die Felder unseres Listeneintrags plus `names` und `archived`. Detailmessung: `totalItems` 13.263, 531 Seiten zu 25 | Ob die Liste dieselbe Menge aufzählt (archivierte, die 56 Rezepte nur über Verweise), ist nicht geprüft. `/api/recipes` steht in **keinem** der beiden Bundles |
| `fn:rezept` | `/api/recipes/{id}` | ~~**nicht gemessen**~~ **200** (Detailmessung, ein Aufruf): `{data:{id, name, names{de}, imagePath, createdAt, archived, groups[], tags[]}}` | derselbe Pfad; ~~Kandidat `/api/recipe-viewer/recipes/{recipeId}` (brew, nicht gemessen)~~ `/api/recipe-viewer/recipes/{recipeId}` gleiche Form, ebenfalls 200 | Die Liste `/api/recipes` ist abgewiesen, das Einzelrezept nicht. `/api/1.0/recipes/{id}` 403 |
| `fn:rezept_zutaten` | `/api/recipes/{id}/ingredients` | ~~**nicht gemessen**~~ **200** (Detailmessung, ein Aufruf): `{data: []}` | derselbe Pfad | **Bei diesem Rezept leer — die Felder sind nicht gesehen.** Die Lieferanten-Artikelnummer (`artikelId`) ist der Schlüssel des ganzen Rezeptmodells; an einem Rezept mit Zutaten nachmessen. `/api/1.0/recipes/{id}/ingredients` 403 |
| `fn:rezept_meta` | `/api/recipes/{id}/meta` | ~~**nicht gemessen**~~ **200** (Detailmessung, ein Aufruf): `{data:{weight{total, perPerson, portionSize, portionSizeUnit, loss}, allergens[], additives[], comment, nutritions[{name, sum, unit, children}]}}` | derselbe Pfad | `weight.loss` wie im Bestand (`core.rezept.verlust_roh`, ungedeutet) |

~~**Ergebnis:** Mit dem heutigen Token trägt **ein** Eintrag nachweislich (`fn:bestellungen`), **einer** hat einen gemessenen Ersatz (`fn:kostenstellen`), **vier** sind abgewiesen (`fn:profil`, `fn:pos_standorte`, `fn:inventuren`, `fn:rezepte`), **acht** sind offen. Das Token ersetzt die Sitzung heute **nicht**. Die Inventuren gehen mit Token gar nicht; ob Einkauf und Rezepte gehen, entscheiden die nicht gemessenen Detailpfade (`/change`, `recipe-viewer/…/ingredients`).~~

**Ergebnis nach der Detailmessung (18.11.2026):** **Sechs** Einträge tragen mit dem Token, je mit einem Aufruf belegt: `fn:betriebe`, `fn:bestellungen`, `fn:bestellung`, `fn:rezept`, `fn:rezept_zutaten` (Felder nicht gesehen, Antwort leer), `fn:rezept_meta`. **Zwei** gehen über einen anderen Pfad: `fn:rezepte` über `/api/recipe-viewer/recipes`, `fn:kostenstellen` über `/api/erp/core/{userId}/erps`. **Vier** sind abgewiesen: `fn:profil`, `fn:pos_standorte`, `fn:bestellpositionen`, `fn:inventuren`. **Zwei** sind nicht gemessen: `fn:inventurpositionen`, `fn:bestellansicht`. Das Token ersetzt die Sitzung trotzdem **nicht**: Ohne `/change` gibt es keine Einkaufspreise je Position, ohne `/api/erp/stocktakings` keine Inventuren, ohne `/api/profile` und `/api/pos/locations` weder die Benutzer-ID noch die Liste der Kassenanbindungen. ~~Für die Rezepte allein reicht es vermutlich — wenn die Zutaten an einem befüllten Rezept die `artikelId` tragen.~~ (Bedingung erfüllt, Token-Nachprobe: `artikelId` bei 5 von 6 Zutaten; Endstand oben.)

### Was mit dem Token erreichbar ist und heute nicht geladen wird

Alles gemessen für ein Konto und eine Anbindung. **Erreichbar heißt nicht neu:** Mehreres davon war auch mit der Sitzung schon zu holen und ist nur nie gebaut worden — das steht jeweils dabei.

| Daten | Pfad | Was es füllen könnte | Vorbehalt |
|---|---|---|---|
| Kassenprodukte mit Rezept | `/api/pos/mapping/{connectionId}/articles` (895, `plu`, `recipeId`, `isIgnored`, `price`, `vat`); dazu `/api/2.0/pos/accounts/{connectionId}/products` (`plu`, `recipe{id}`, `absentFromFeedSince`) | **`core.pos_artikel`** — heute leer, `erwartet: false`. Die Tabelle ist für genau den Mapping-Pfad entworfen (`migrations/0030_foodnotify.sql`: `plu`, `remote_id`, `rezept_key`, `preis`, `mwst`, `ignoriert`) | **Mit der Sitzung seit 01.08.2026 erreichbar** (Nachtrag im alten Inventar) und trotzdem nie gebaut — am Zugang lag es nicht. Der Join auf LINA gilt nur bei `kassensystem = 'amadeus'`; ob 2052 eine Amadeus-Anbindung ist, steht nicht in der Messdatei |
| Kassenrechnungen mit Positionen | `/api/2.0/pos/accounts/{connectionId}/invoices`, Filter `businessDayFrom`/`businessDayTo` | Gegenprobe: was FoodNotify von der Kasse bekommen hat | **Neu** — im alten Inventar nicht enthalten. Verkäufe nehmen wir aus LINA (Entscheidung 01.08.2026); ob diese Daten vom defekten Verkaufsimport (`foodnotify-api-inventar.md` §8a) betroffen sind, ist unbekannt |
| Verkaufsmengen je Kassenprodukt | `/api/pos/mapping/{connectionId}/article-sales` (565 × `units, revenue, lastSoldAt`) | — | Zeitraum der Summen unbekannt; Verkäufe kommen aus LINA |
| Rezept ↔ Betrieb, Änderungsdatum | `/api/pos/mapping/{connectionId}/link-targets` (13.253 × `recipeId, restaurantId, restaurantName, ingredientCount, updatedAt`) | den Betriebsbezug der Rezepte (`AGENTS.md`: „Rezepte gelten je Marke"); `updatedAt` könnte den 14-Tage-Umlauf (`0134`) auf geänderte Rezepte beschränken | **Hypothese.** Weder die Bedeutung von `restaurantId` (Eigentümer oder Verwendung) noch die von `updatedAt` ist geprüft. Mit der Sitzung seit 01.08.2026 erreichbar |
| Warenstamm mit Preis und Bestand | `/api/{erpId}/products` (`artikelId, pricePerUnit, unitPrice, stock, …`) | **`core.ware_stand`** — heute leer (`offene-punkte.md`, 14.08.2026) | Mit der Sitzung seit 27.07.2026 bekannt (altes Inventar §4). Probe: 20 Zeilen je Seite, Seitenparameter mit Token nicht geprüft. Der eigentliche Warenstamm `/api/erp/concrete-products` antwortet „Access Denied." |
| Rezeptliste mit `archived` | `/api/recipe-viewer/recipes` | beantwortet `offene-punkte.md` 4a (zeigt die Liste archivierte Rezepte?) — ein Lauf über alle Seiten zeigt, ob diese Liste archivierte führt und ob die 56 „nur über Verweise" darin stehen | Nur die erste Seite gemessen, nur Typen; ob dort ein `archived = true` stand, ist nicht festgehalten. Detailmessung: 13.263 Rezepte, 531 Seiten zu 25 — ein voller Lauf kostet 531 Aufrufe |
| Kostenstellen über die Benutzer-ID | `/api/erp/core/{userId}/erps` | Ersatz für `/api/erp/all` | siehe Tabelle oben |
| Rezeptkalkulation je Rezept | `/api/recipes/cost-calculation/recipes` (`avgCogs, avgSalePrice, avgContributionMargin, locations`), `/api/recipes/cogs-corridors/*` (Sollkorridore je Kategorie und Rezepttyp) | — | FoodNotifys eigene Rechnung; die Kostenanalyse ist nicht importiert (Entscheidung 01.08.2026), dieselbe Vorsicht gilt hier. Prozentskala nicht geprüft |
| Kostenanalyse, Food Waste, Renner-Penner | `/api/analytics/reports/cost-analysis/…` (7 Pfade, 200) | — | mit der Sitzung seit 27.07.2026 bekannt; **bewusst nicht importiert** (altes Inventar §8a/§8b: Werte unbrauchbar) |
| Gründe für Lagerbewegungen | `/api/{erpId}/stock/change/reasons` (10 × `reason, count`) | Wertevorrat für `reason` in `/api/2.0/erp/stock/movements` | die Bewegungen selbst sind abgewiesen (403) |

~~**Was zuerst zu messen wäre, bevor jemand umbaut** (je ein GET, Konto Wilma Wunder): `/api/{erpId}/shop-order/{id}` und `…/change` mit einer bekannten Bestellung; `/api/recipe-viewer/recipes/{id}`, `/ingredients`, `/meta` mit einem bekannten Rezept, gegen dieselben Abrufe aus `raw.api_antwort` gehalten; `/api/core/business/10616/restaurants`; `/api/erp/stocktakings/{uuid}/items` mit einer bekannten Inventur. Danach dieselbe Liste für die drei anderen Marken.~~ Bis auf die Inventurpositionen und den Abgleich mit `raw.api_antwort` am 18.11.2026 erledigt (Detailmessung).

~~**Was noch zu messen ist, bevor jemand umbaut:** `/api/recipes/{id}/ingredients` an einem Rezept **mit** Zutaten (trägt es `artikelId`?); `/api/erp/stocktakings/{uuid}/items` mit einer bekannten Inventur; die Felder von `markedShopOrder.products[]` gegen `/change` aus `raw.api_antwort`; Token- gegen Sitzungsantwort derselben Pfade (läuft, Cookie-Sitzung im Browser); danach dieselbe Liste für die drei anderen Marken.~~ Zutaten mit `artikelId`, `products[]` gegen `/change` und die Sitzungsmessung sind am 18.11.2026 erledigt.

**Was offen bleibt, bevor jemand umbaut:** ~~dieselbe Messung für die drei anderen Marken;~~ (erledigt 19.11.2026, Nachtrag „alle vier Marken" oben) Token gegen Sitzung **auf Zeilenebene** (dieselben Rezepte, dieselben Bestellungen); ob `link-targets.updatedAt` als Änderungsfilter für den Rezept-Umlauf taugt; ob `/api/recipes` schon vor dem 09.11.2026 die Form von `recipe-viewer` lieferte (gegen `raw.api_antwort`). Die Liste steht in `docs/offene-punkte.md` (18.11.2026).

## Was FoodNotify selbst über die Schnittstellen sagt (weitergegeben von Eugene, 18.11.2026)

Zwei Aussagen von FoodNotify, die Eugene am 18.11.2026 weitergegeben hat. Wörtlich nur die erste; die zweite sinngemäß.

1. **Aktuell:** „Für alle Kassen- und Partnersysteme bieten wir eine dokumentierte Standard-Schnittstelle an – unsere POS-API 2.0."
2. **Eine interne FoodNotify-Mail, rund eineinhalb Jahre alt** (also etwa Frühjahr 2025; nach Eugenes Einschätzung vermutlich überholt), sinngemäß: Die damalige POS-Schnittstelle sei eine Legacy-Schnittstelle, werde nicht verwendet, sei nicht getestet und solle nicht nach außen kommuniziert werden. Eine neue werde gebaut, sehr ähnlich der Schnittstelle, die für einen bestimmten Kassenanbieter entstanden war (in der Mail „Venus", in der Spezifikation heißen die Endpunkte „xenus"), mit drei Endpunkten: Warengruppen, Artikel, Verkäufe. Die Dokumentation sei unvollständig. Die Mail verweist auf die drei xenus-PUTs unter `https://api3.foodnotify.com/api/doc/1.0/pos`.

**Wie das zu dem passt, was wir gemessen und gelesen haben:**

* **Zur Spezifikation passt es.** Die drei xenus-Endpunkte stehen unter 1.0 (`PUT /api/1.0/pos/{costCenterId}/xenus-productGroups`, `…/xenus-products`, `…/xenus-invoices/{dateOfInvoices}`, Abschnitt „Bereich Pos v1.0"), die sieben Schemas dort sind alle „Xenus". Unter 2.0 stehen mit `restv2` genau die drei Gegenstücke der Mail: Produktgruppen, Produkte, Rechnungen (`PUT /api/2.0/pos/vendors/restv2/{accountIdentifier}/…`). Die neue Schnittstelle der Mail ist also sehr wahrscheinlich die heutige POS-API 2.0 (geschlossen).
* **Zur Messung passt es.** Das Scope-Token nimmt genau die POS-Rücklese-Endpunkte von 2.0 an (`/api/2.0/pos/accounts/{connectionId}/products|product-groups|invoices`, je 200) und lehnt jedes gemessene `/api/1.0/…` ab.
* **Was es nicht sagt.** Die Aussagen betreffen die **Kassenseite** — wie eine Kasse Artikel und Verkäufe an FoodNotify schickt. Über Einkauf, Inventur und Rezepte, also das, was der Importer holt, sagen sie nichts. „Dokumentiert" heißt bei 2.0: Antwortfelder ja (Abschnitt „Schemas"), aber ohne `securitySchemes` und mit nur einem genannten Scope.

## Überblick

Nachgezählt am 18.11.2026 aus den JSON-Dateien, 270 Operationen insgesamt (`paths` × HTTP-Methode):

| Bereich | Version | Datei | Pfade | GET | POST | davon POST-Suche | PUT | DELETE | schreibend (POST+PUT+DELETE) | Antwortschema |
|---|---|---|---|---|---|---|---|---|---|---|
| Pos | v2.0 | `2.0_pos` | 9 | 5 | 0 | 0 | 4 | 0 | 4 | ja (29 Schemas) |
| Erp | v2.0 | `2.0_erp` | 5 | 4 | 1 | 0 | 0 | 0 | 1 (Beispiel-Webhook für Fremdsysteme, siehe unten) | ja (19 Schemas) |
| Recipe | v1.0 | `1.0_recipes` | 33 | 22 | 12 | 2 | 4 | 9 | 25 | nein |
| Catering | v1.0 | `1.0_catering` | 100 | 52 | 60 | 19 | 23 | 23 | 106 | nein |
| User | v1.0 | `1.0_user` | 5 | 4 | 1 | 1 | 0 | 0 | 1 | nein |
| Erp.Legacy | v1.0 | `1.0_erp` | 5 | 4 | 2 | 1 | 0 | 0 | 2 | nein |
| Webhooks | v1.0 | `1.0_webhooks` | 5 | 4 | 2 | 1 | 1 | 1 | 4 | nein |
| Pos | v1.0 | `1.0_pos` | 18 | 8 | 10 | 4 | 7 | 3 | 20 | nur Anfrage-Bodys (7 Schemas, alle „Xenus") |
| Shop | v1.0 | `1.0_shops` | 4 | 4 | 0 | 0 | 0 | 0 | 0 | nein |
| **Summe** | | | 184 | **107** | **88** | **28** | **39** | **36** | **163** | |

Hinweise zur Zählung:

* GET + POST + PUT + DELETE = 107 + 88 + 39 + 36 = 270.
* „POST-Suche" sind POST-Operationen, deren Pfad auf `/search` endet oder `/search/…` enthält. Sie lesen vermutlich nur, der Filter-Body ist nirgends beschrieben. In `operationen.csv` steht dafür `lesend = unklar (POST-Suche)`; 135 Operationen sind `nein`, 107 `ja`, 28 `unklar`. Die Spalte „schreibend" oben rechnet die Suchen als POST mit und ist deshalb eine Obergrenze.
* `POST /api/2.0/erp/billing/webhook/{billingAccountId}` ist keine Operation, die wir bei FoodNotify aufrufen: sie beschreibt den Endpunkt, den ein **Fremdsystem** bereitstellen soll, damit FoodNotify Wareneingänge dorthin schickt (Beispiel „CisBox").
* Pfade = Schlüssel unter `paths` (184 insgesamt); ein Pfad trägt mehrere Methoden. Maßgeblich ist die Operationszahl.

**Wir lesen nur.** Die Schreib-Operationen stehen unten je Bereich in je einer Tabelle, damit bekannt ist, dass sie existieren. Zerstörerisch sind laut Beschreibung unter anderem: `DELETE /api/1.0/pos/productGroups/{id}` („will delete all products in group"), `PUT /api/1.0/pos/{costCenterId}/xenus-productGroups` („Groups which exist in FoodNotify but not in your request will get deleted"), `PUT /api/2.0/pos/vendors/restv2/{accountIdentifier}/products` („Replaces (default) all Products") und `…/product-groups` („Products that you do not send will be removed"). Zu `/product-groups` steht in der Beschreibung „Products", gemeint sind vermutlich Product Groups (Spezifikation widersprüchlich, siehe Abschnitt „Was die Spezifikation nicht sagt").

## Authentifizierung, Rechte, Grenzen — was die Spezifikation sagt

* **Alle neun Dateien** tragen auf oberster Ebene `security: [{"Bearer": []}]`. **Keine** Datei definiert `components.securitySchemes`. Der Verweis zeigt also auf ein nicht vorhandenes Schema. Je Operation steht keine Sicherheitsangabe. Welcher Art das Bearer-Token ist (JWT, API-Schlüssel, OAuth), wie man es bekommt, wie lange es gilt, und in welchem Header es steht, steht **nirgends**.
* **Scopes:** genau **ein** Scope kommt vor, `pos:read`, in den 403-Beschreibungen der drei Lese-Endpunkte unter `/api/2.0/pos/accounts/{accountIdentifier}/…` („No access to this POS account, or the token lacks the pos:read scope."). Andere Scopes werden nicht genannt; auch nicht für Erp, Recipe, Webhooks. Es gibt keine Scope-Liste. → Gemessen am 18.11.2026: Der Server bietet dem Konto Wilma Wunder 22 Scopes an (`GET /api/user/api-tokens/grantable-scopes`, Abschnitt „Wie ein Token entsteht"). Header ist `Authorization: Bearer <token>`, Host `api3.foodnotify.com`.
* **Weitere Hinweise zur Authentifizierung** (Wortlaut sinngemäß, aus `2.0_erp`): Der Endpunkt `…/goods-receipts/{billingAccountId}` verlangt, dass das Abrechnungskonto „zum authentifizierten Benutzer gehört" (403 sonst, 401 „Unauthorized"). Der Beispiel-Webhook beschreibt, dass das Fremdsystem „request signature/token from FoodNotify" prüfen soll — ohne Angabe, wie die Signatur gebildet wird.
* Die Stock-Endpunkte (`/api/2.0/erp/stock/*`) antworten mit 403, wenn der Benutzer keinen Zugriff auf eine der angefragten `erp_ids` hat. Wird `erp_ids` weggelassen, liefern sie laut Beschreibung „data across all ERPs the master user owns" — ~~ein Token eines Hauptbenutzers sieht also alle seine ERPs.~~ **Gemessen am 18.11.2026: alle drei Stock-Endpunkte antworten dem Scope-Token mit 403 „This endpoint does not support scope-limited tokens."** — unabhängig von `erp_ids`.
* **Rate Limits:** nirgends genannt, kein 429, keine Header-Beschreibung. (Regel 3 der Projekt-Anweisungen gilt trotzdem: das Tempo der Importer-Anfragen bleibt Teil der Anforderung.) Beobachtet am 18.11.2026: rund 230 Aufrufe im Abstand von 1,2–1,5 s ohne 429 und ohne Rate-Limit-Header (Abschnitt „Drosselung").
* **`servers`:** keine Datei trägt einen `servers`-Eintrag. Die Basis-URL steht nur auf der Indexseite (`https://api3.foodnotify.com`).

## Bereich Pos v2.0 (`2.0_pos`) — 5 GET, 4 PUT

Zwei Gruppen:

1. **POS read-back** (`/api/2.0/pos/accounts/{accountIdentifier}/…`): liest zurück, was ein POS-System **an FoodNotify gesendet** hat — Produkte (mit der Rezeptverknüpfung), Produktgruppen, Rechnungen. Scope `pos:read`.
2. **Vendor-Feeds** (`/api/2.0/pos/vendors/fn-recipe/…`): Produkte und Produktgruppen, die **aus FoodNotify-Rezepten** für ein angeschlossenes POS-System bereitgestellt werden (Richtung FoodNotify → Kasse).

Der Pfadparameter `accountIdentifier` (string) wird nirgends erklärt. Ob er die `connectionId` aus `/api/pos/locations` ist (so heißt der Schlüssel in unserem Importer, siehe `src/foodnotify/endpunkte.ts` und `docs/foodnotify-api-inventar.md` Nachtrag 01.08.2026), steht nicht dort — ~~**nicht gemessen**~~. **Gemessen am 18.11.2026: ja.** Mit der `connectionId` 2052 (Wilma Wunder) antworten alle drei Rücklese-Endpunkte mit 200; die Felder entsprechen der Spezifikation (Abschnitt „Messung mit Token").

Einheitliche Seitenhülle der drei Read-back-Listen: `{data: [...], pagination: {currentPage, perPage, totalItems, totalPages}}`. Fehlerantworten: 403 (kein Zugriff oder `pos:read` fehlt), 404 (unbekanntes Konto), 422 (Validierung, Liste `errors[{propertyPath, message}]`).

### Lesende Endpunkte

**`GET /api/2.0/pos/accounts/{accountIdentifier}/products`** — „List the products stored for the POS account, each with the recipe it is linked to."

| | |
|---|---|
| Parameter | `page` (Standard 1, max 1.000.000), `perPage` (Standard 50, max 200), `absentFromFeed` (boolean: `true` nur Produkte, die in der letzten Produktsynchronisation fehlen, `false` nur die noch enthaltenen, weglassen = beide) |
| Sortierung | „ordered by id" (Beschreibung der 200-Antwort) |
| Datumsfilter | keiner |
| Felder je Produkt | `id` (interne FoodNotify-ID), `productId` (die gesendete externe ID), `name`, `description`, `netPrice` (netto je Stück), `vatRate` (als Bruch, 0.1 = 10 %), `plu`, `productGroupId` (externe ID der Produktgruppe), `timeModified` (RFC 3339, UTC), `absentFromFeedSince` (gesetzt, wenn das Produkt in einer späteren Produktsynchronisation fehlte), **`recipe`** (`{id}`: das verknüpfte FoodNotify-Rezept, oder null) |

**`GET /api/2.0/pos/accounts/{accountIdentifier}/product-groups`** — „List the product groups stored for the POS account."

| | |
|---|---|
| Parameter | `page`, `perPage` (wie oben) |
| Felder | `id`, `productGroupId`, `name`, `description` |

**`GET /api/2.0/pos/accounts/{accountIdentifier}/invoices`** — „List the invoices stored for the POS account, with their items, newest business day first." Beschreibung: eine Stornierung erscheint als Positionen mit negativer Menge.

| | |
|---|---|
| Parameter | `page`, `perPage` (wie oben), `businessDayFrom`, `businessDayTo` (`Y-m-d`, inklusive), `externalIds[]` (nur diese `invoiceId`s, max. 200) |
| Sortierung | neuester Geschäftstag zuerst |
| Felder je Rechnung | `id`, `invoiceId` (externe ID), `timeCreated` (RFC 3339, UTC), `businessDay` (`Y-m-d`), `total` (netto: Summe aus `netPricePerItem × quantity`), `invoiceItems[]` |
| Felder je Position | `id`, `externalId` (Positions-ID des Senders), `plu`, `name`, `quantity` (negativ bei Storno/Retoure), `netPricePerItem` (netto, immer positiv), `vatRate` (Bruch), `affectsStock` (bucht gegen Bestand), `voidReason` |

**`GET /api/2.0/pos/vendors/fn-recipe/{accountIdentifier}/products`** — „List products synchronised from FoodNotify recipes for the connected location."

| | |
|---|---|
| Parameter | `updated_since` (RFC 3339) — in der Spezifikation als `deprecated: true` markiert und beschrieben mit „Reserved — not yet publicly documented; subject to change" |
| Seiten | keine angegeben |
| Felder | `products[]` mit `productId`, `name`, `grossPrice`, `vatRate` |

**`GET /api/2.0/pos/vendors/fn-recipe/{accountIdentifier}/product-groups`** — „List product groups synchronised from FoodNotify recipe categories for the connected location."

| | |
|---|---|
| Parameter | `updated_since` (wie oben) |
| Felder | `productGroups[]` mit `productGroupId`, `name`, `parentProductGroupId` |

**Gemessen am 18.11.2026:** Beide fn-recipe-Feeds antworten für die Anbindung 2052 mit 500 „Account is not of type FnRecipe". Sie gelten nur für Kassen, die ihre Produkte **aus** FoodNotify-Rezepten beziehen; unsere Anbindung ist keine solche.

### Schreibende Endpunkte (v2.0 Pos)

| Methode | Pfad | Summary |
|---|---|---|
| PUT | `/api/2.0/pos/vendors/fn-recipe/{accountIdentifier}/invoices/{invoiceId}` | Push a single invoice from the POS terminal to FoodNotify (idempotent auf `invoiceId`) |
| PUT | `/api/2.0/pos/vendors/restv2/{accountIdentifier}/products` | Replaces (default) all Products |
| PUT | `/api/2.0/pos/vendors/restv2/{accountIdentifier}/product-groups` | Replaces (default) all Product Groups |
| PUT | `/api/2.0/pos/vendors/restv2/{accountIdentifier}/invoices/{invoiceId}` | Invoices |

## Bereich Erp v2.0 (`2.0_erp`) — 4 GET, 1 POST

Vier lesende Endpunkte: Wareneingänge und drei Sichten auf Lagerbewegungen. Alle mit Seitenhülle `{data[], pagination{currentPage, perPage, totalItems, totalPages}}`; die Lager-Endpunkte liefern zusätzlich `filters` (die angewendeten Filter).

**`GET /api/2.0/erp/goods-receipts/{billingAccountId}`** — „List Goods Receipts" (Wareneingänge). Gedacht für externe Abrechnungssysteme (Beispiel „Cisbox"); das Abrechnungskonto muss zum angemeldeten Benutzer gehören. Wo man die `billingAccountId` bekommt, steht nicht in der Spezifikation.

| | |
|---|---|
| Parameter | `startDate`, `endDate` (`Y-m-d`, Filter auf das **Lieferdatum**), `syncStatus` (`not_synced`/`synced`/`failed`), `page` (Standard 1, min. 1), `limit` (Standard 25, max. 100) |
| Felder je Wareneingang | `goodsReceiptId`, `createdAt`, `supplier{vatNumber, GLN, identifier}`, `client{vatNumber, accountNumber}`, `type` (nur `GOODS_RECEIPT`), `currency`, `lineItemPriceType` (`gross`/`net`), `number`, `issueDate`, `totalPrice`, `lineItems[]`, `confirmationNumber` |
| Felder je Position | `position`, `productNumber`, `productName`, `unitPrice`, `quantity`, `totalPrice`, `taxRate`, `unit`, `stockGroup`, `discountInfo` |
| Beschreibung | Ein Wareneingang entsteht, wenn FoodNotify einen Lieferschein oder eine angenommene Bestellung anlegt oder ändert (Beschreibung des Beispiel-Webhooks) |

**`GET /api/2.0/erp/stock/balances`** — „List daily stock-change summaries": je ERP und konkretem Produkt (`concreteProductId`) und Geschäftstag Anfangs-, Änderungs- und Endwert.

| | |
|---|---|
| Parameter | `erp_ids[]` (integer), `concrete_product_ids[]` (integer), `business_date_from`, `business_date_to` (Typ `date-time`, nullable), `order` (`asc`/`desc`, nach Geschäftstag), `page` (Standard 1), `page_size` (Standard 50; erlaubte Werte 5, 10, 20, 50, 100, 1000, 5000, 10000) |
| Felder | `data[]` mit `group{erpId, period[von, bis], concreteProductId}` und `values{openingPrice, deltaPrice, closingPrice, openingAmount, deltaAmount, closingAmount, openingAmountBaseUnit, deltaAmountBaseUnit, closingAmountBaseUnit}`; dazu `filters`, `pagination` |
| Hinweis | ohne `erp_ids` alle ERPs des Hauptbenutzers; 403 bei fehlendem Zugriff auf ein ERP, 404 bei unbekanntem ERP |

**`GET /api/2.0/erp/stock/movements`** — „List stock movements grouped by reason": Summen je ERP, Geschäftstag, konkretem Produkt und Grund.

| | |
|---|---|
| Parameter | wie `balances`, dazu `reasons[]` (string, Filter auf den Bewegungsgrund) |
| Felder | `group{erpId, period, concreteProductId, reason}`, `values{totalAmount, totalAmountBaseUnit, totalPrice}` |
| Beschreibung zu `reason` | „food-waste detail → ref_type → raw reason, first non-empty" — der Grund ist also eine abgeleitete Zeichenkette; die möglichen Werte stehen nirgends |

**`GET /api/2.0/erp/stock/aggregate`** — „Aggregate stock movements across a flexible set of grouping dimensions".

| | |
|---|---|
| Parameter | wie `movements`, dazu `group_by[]` (string, mindestens einer; Beispiele in der Beschreibung: ERP, konkretes Produkt, Grund) und `granularity` (`day`/`week`/`month`/`year`/`period`) |
| Felder | `group` (freie Schlüssel nach `group_by`, plus `period` als `[von, bis]`) und `values` (`deltaPrice`, `grossInflowPrice`, `grossOutflowPrice` immer; Mengenfelder `deltaAmount`, `grossInflowAmount`, `grossOutflowAmount` und die `…BaseUnit`-Gegenstücke nur, wenn `concrete_product_id` in `group_by` steht; `grossInflow*` summiert nur positive, `grossOutflow*` nur negative Änderungen) |

### Schreibend / Beispiel

| Methode | Pfad | Summary |
|---|---|---|
| POST | `/api/2.0/erp/billing/webhook/{billingAccountId}` | Receive Goods Receipt (PUSH from FoodNotify) — Beispiel für Fremdsysteme, **kein** Endpunkt bei FoodNotify |

## Bereich Recipe v1.0 (`1.0_recipes`) — 22 GET, 25 schreibend

Keine Query-Parameter an den Listen, keine Antwortschemas, keine Sicherheits- oder Seitenangaben. Zwei Summaries sagen „paginated" (`/recipes/allData`, `/recipes/pricing`), deklarieren aber keinen Seitenparameter. Mit Tags versehen sind nur die Kategorie-Endpunkte („Category"). Die Datei enthält auch Pfade außerhalb von `/recipes`: `/api/1.0/dailymenus`, `/api/1.0/dailymenus/{id}`, `/api/1.0/ingredients/search`.

Auffällig für uns: `/recipes/pricing` („Get paginated list of recipes including per-restaurant pricing"), `/recipes/{id}/restaurants` („Get Recipe Restaurants") und `/recipes/{id}/contributionMarginData` (Deckungsbeitragsdaten eines Rezepts) — alle ohne Feldbeschreibung.

| Pfad | Summary | Parameter |
|---|---|---|
| `/api/1.0/dailymenus` | List all Dailymenus. | keine |
| `/api/1.0/dailymenus/{id}` | Get one Dailymenu. | Pfad: id |
| `/api/1.0/recipes` | Get All Recipes. | keine |
| `/api/1.0/recipes/allData` | Get All Recipes data paginated. | keine |
| `/api/1.0/recipes/pricing` | Get paginated list of recipes including per-restaurant pricing. | keine |
| `/api/1.0/recipes/{id}` | Get single Recipe. | Pfad: id |
| `/api/1.0/recipes/{id}/names` | Get all Recipe Names. | Pfad: id |
| `/api/1.0/recipes/{id}/categories` | Get Recipe Categories. | Pfad: id |
| `/api/1.0/recipes/{id}/tags` | Get all Tags for Recipe. | Pfad: id |
| `/api/1.0/recipes/{id}/nutritionTags` | Get all Nutrition Tags for Recipe. | Pfad: id |
| `/api/1.0/recipes/{id}/allergens` | Get Recipe allergens. | Pfad: id |
| `/api/1.0/recipes/{id}/additives` | Get Recipe additives. | Pfad: id |
| `/api/1.0/recipes/{id}/additionals` | Get Recipe additionals. | Pfad: id |
| `/api/1.0/recipes/{id}/nutritions` | Get Recipe nutritions. | Pfad: id |
| `/api/1.0/recipes/{id}/contributionMarginData` | Get Recipe ContributionMarginData. | Pfad: id |
| `/api/1.0/recipes/{id}/ingredients` | Get Recipe ingredients. | Pfad: id |
| `/api/1.0/recipes/{id}/restaurants` | Get Recipe Restaurants. | Pfad: id |
| `/api/1.0/recipes/restaurants/{id}` | Get single RecipeRestaurant. | Pfad: id |
| `/api/1.0/recipes/{id}/availabilities` | Get all Recipe Availabilities. | Pfad: id |
| `/api/1.0/recipes/{id}/blacklists` | Get Recipe blacklists. | Pfad: id |
| `/api/1.0/recipes/categories` | Get all Categories. | Query: page:integer:nein; pageSize:integer:nein; orderBy:string:nein; orderDirection:string:nein |
| `/api/1.0/recipes/categories/{id}` | Get one category. | Pfad: id |

Schreibend (nur zur Kenntnis):

| Methode | Pfad | Summary |
|---|---|---|
| POST (Suche) | `/api/1.0/ingredients/search` | Search ingredients. |
| POST | `/api/1.0/recipes` | Create Recipe. |
| PUT | `/api/1.0/recipes/{id}` | Update Recipe. |
| DELETE | `/api/1.0/recipes/{id}` | Delete Recipe. |
| POST (Suche) | `/api/1.0/recipes/search` | Search Recipes. |
| POST | `/api/1.0/recipes/{id}/image` | Add image to Recipe. Accept form with file upload. |
| DELETE | `/api/1.0/recipes/{id}/image/{imageId}` | Delete image from Recipe. |
| POST | `/api/1.0/recipes/{id}/names` | Add/Update Name to Recipe. |
| DELETE | `/api/1.0/recipes/{id}/names/{nameId}` | Remove Name from Recipe. |
| POST | `/api/1.0/recipes/{id}/categories` | Add Recipe to Category. |
| DELETE | `/api/1.0/recipes/{id}/categories/{categoryId}` | Remove Recipe from Category. |
| POST | `/api/1.0/recipes/{id}/tags` | Add Tag to Recipe. |
| DELETE | `/api/1.0/recipes/{id}/tags/{tagId}` | Remove Tag from Recipe. |
| POST | `/api/1.0/recipes/{id}/ingredients/{ingredientId}` | Add Ingredient to Recipe. |
| POST | `/api/1.0/recipes/{id}/ingredients/recipes/{recipeId}` | Add Recipe as Ingredient to Recipe. |
| PUT | `/api/1.0/recipes/ingredients/{id}` | Update RecipeIngredient. |
| DELETE | `/api/1.0/recipes/ingredients/{id}` | Delete RecipeIngredient. |
| POST | `/api/1.0/recipes/{id}/restaurants` | Add Recipe to Restaurant. |
| PUT | `/api/1.0/recipes/restaurants/{id}` | Update RecipeRestaurant. |
| DELETE | `/api/1.0/recipes/restaurants/{id}` | Delete RecipeRestaurant (Remove Recipe from Restaurant). |
| POST | `/api/1.0/recipes/{id}/availabilities` | Create Recipe Availability. |
| DELETE | `/api/1.0/recipes/{id}/availabilities/{availabilityId}` | Delete Recipe Availability. |
| POST | `/api/1.0/recipes/categories` | Create new Category. |
| PUT | `/api/1.0/recipes/categories/{id}` | Update Category. |
| DELETE | `/api/1.0/recipes/categories/{id}` | Delete Category. |

## Bereich Pos v1.0 (`1.0_pos`) — 8 GET, 20 schreibend

Konten (`accounts`) einer POS-Anbindung mit Rechnungen, Produkten und Produktgruppen. Die Pfade der Listen tragen die Seitenparameter `page` (Standard 1), `pageSize` (Standard 10), `orderBy` (Standard `timeCreated`), `orderDirection` (Standard `DESC`); die Antwort ist nur als „Get all …" beschrieben, ohne Hülle und ohne Felder. Kein Datumsfilter. Der Konto-Anlage-Body nennt unter anderem `accountType`, `costCenter`, `endpointUrl`, **`token`** und die Schalter `syncInvoices`, `syncAllergens`, `syncAdditives`, `syncCreate`, `syncUpdate`, `syncDelete` — ein Konto trägt also offenbar ein Zugangstoken zur Kasse. Ob `GET /api/1.0/pos` dieses Token mit ausliefert, ist nicht beschrieben; beim ersten Abruf darauf achten, dass kein Token in `raw.api_antwort` landet (Regel 2).

Die sieben Schemas sind alle für „Xenus" (ein Hotel-Kassensystem: `departmentId`, `roomNbr`) — sie beschreiben Anfrage-Bodys, keine Antworten.

| Pfad | Summary | Parameter |
|---|---|---|
| `/api/1.0/pos` | Get all accounts. | `page`, `pageSize`, `orderBy`, `orderDirection` |
| `/api/1.0/pos/{id}` | Get one account. | Pfad: `id` |
| `/api/1.0/pos/{id}/invoices` | Get all Invoices. | Pfad: `id`; `page`, `pageSize`, `orderBy`, `orderDirection` |
| `/api/1.0/pos/invoices/{id}` | Get one Invoice. | Pfad: `id` |
| `/api/1.0/pos/{id}/products` | Get all Products. | Pfad: `id`; `page`, `pageSize`, `orderBy`, `orderDirection` |
| `/api/1.0/pos/products/{id}` | Get one Product. | Pfad: `id` |
| `/api/1.0/pos/{id}/productGroups` | Get all Product Groups. | Pfad: `id`; `page`, `pageSize`, `orderBy`, `orderDirection` |
| `/api/1.0/pos/productGroups/{id}` | Get one Product Group. | Pfad: `id` |

Schreibend (nur zur Kenntnis):

| Methode | Pfad | Summary |
|---|---|---|
| POST | `/api/1.0/pos` | Create an account. |
| PUT | `/api/1.0/pos/{id}` | Update account. |
| DELETE | `/api/1.0/pos/{id}` | Delete Account. |
| POST (Suche) | `/api/1.0/pos/search` | Search accounts. |
| POST | `/api/1.0/pos/{id}/invoices` | Create Invoice. |
| POST (Suche) | `/api/1.0/pos/{id}/invoices/search` | Search Invoices. |
| PUT | `/api/1.0/pos/{id}/invoices/sync` | Sync Invoices (maximum 10 invoices in one request). |
| PUT | `/api/1.0/pos/{costCenterId}/xenus-invoices/{dateOfInvoices}` | Transfer invoices from your Xenus-POS to FoodNotify. |
| POST | `/api/1.0/pos/{id}/products` | Create new Product. |
| PUT | `/api/1.0/pos/products/{id}` | Update Product. |
| DELETE | `/api/1.0/pos/products/{id}` | Delete Product. |
| POST (Suche) | `/api/1.0/pos/{id}/products/search` | Search Products. |
| POST | `/api/1.0/pos/{id}/products/sync` | Sync Products (maximum 10 products in one request). |
| PUT | `/api/1.0/pos/{costCenterId}/xenus-products` | Transfer all products from your Xenus-POS to FoodNotify. |
| POST | `/api/1.0/pos/{id}/productGroups` | Create Product Group. |
| PUT | `/api/1.0/pos/productGroups/{id}` | Update Product Group. |
| DELETE | `/api/1.0/pos/productGroups/{id}` | Delete Product Group (!!! will delete all products in group). |
| POST (Suche) | `/api/1.0/pos/{id}/productGroups/search` | Search Product Groups. |
| POST | `/api/1.0/pos/{id}/productGroups/sync` | Sync Product Groups (maximum 10 product groups in one request). |
| PUT | `/api/1.0/pos/{costCenterId}/xenus-productGroups` | Transfer all product-groups from your Xenus-POS to FoodNotify. |

## Bereich Erp.Legacy v1.0 (`1.0_erp`) — 4 GET, 2 schreibend

Die Indexseite nennt den Bereich „Erp.Legacy". Pfade ohne jeden Parameter, ohne Antwortbeschreibung.

| Pfad | Summary | Parameter |
|---|---|---|
| `/api/1.0/erp/concrete-products` | Get all products. | keine |
| `/api/1.0/erp/erp` | Get all erps. | keine |
| `/api/1.0/erp/stock-changes` | Get all stock changes. | keine |
| `/api/1.0/erp/stocktaking` | Get all stocktaking. | keine |

Schreibend:

| Methode | Pfad | Summary |
|---|---|---|
| POST (Suche) | `/api/1.0/erp/concrete-products/event/{eventId}/search` | Search concreteProduct for event. |
| POST | `/api/1.0/erp/stocktaking` | Create stocktaking. |

## Bereich User v1.0 (`1.0_user`) — 4 GET, 1 POST (Suche)

| Pfad | Summary | Parameter |
|---|---|---|
| `/api/1.0/user/restaurants` | Get all Restaurants. | keine |
| `/api/1.0/user/restaurants/{id}` | Get single Restaurant. | Pfad: id |
| `/api/1.0/user` | Get Current User. | keine |
| `/api/1.0/user/subusers` | Get Current User Subusers. | keine |

Schreibend / Suche:

| Methode | Pfad | Summary |
|---|---|---|
| POST (Suche) | `/api/1.0/user/subusers/search` | Search Subusers. |

## Bereich Shop v1.0 (`1.0_shops`) — 4 GET

Ohne Antwortbeschreibung, ohne Parameter außer der Pfad-ID. „Shop" bezeichnet in FoodNotify vermutlich den Lieferanten-Shop (in unserem Modell `core.lieferant`, Pfad `/shop/{shopId}/orders/{nr}`) — in der Spezifikation steht das nicht.

| Pfad | Summary | Parameter |
|---|---|---|
| `/api/1.0/shops` | Get all Shops. | keine |
| `/api/1.0/shops/{id}` | Get one Shop. | Pfad: id |
| `/api/1.0/shops/{id}/orders` | Get all ShopOrders (with or without products). | Pfad: id |
| `/api/1.0/shops/orders/{id}` | Get one ShopOrder (with products). | Pfad: id |

## Bereich Webhooks v1.0 (`1.0_webhooks`) — 4 GET, 4 schreibend

Ereignisse, für die man eine Rückruf-URL hinterlegen kann. Welche Ereignisse es gibt (`GET /webhooks/events`), was in einem Post steht (`/webhooks/posts`) und wie die Zustellung gesichert wird, steht nicht in der Spezifikation. Webhooks anlegen schreibt bei FoodNotify (Regel 1 gilt sinngemäß: nicht anlegen).

| Pfad | Summary | Parameter |
|---|---|---|
| `/api/1.0/webhooks/events` | List Webhook Event values. | keine |
| `/api/1.0/webhooks` | List all users webhooks (urls). | keine |
| `/api/1.0/webhooks/{id}` | Get single Webhook. | Pfad: id |
| `/api/1.0/webhooks/posts` | List Posts created for user. | keine |

Schreibend / Suche:

| Methode | Pfad | Summary |
|---|---|---|
| POST | `/api/1.0/webhooks` | Set new Webhook (url) for event. |
| PUT | `/api/1.0/webhooks/{id}` | Update Webhook. |
| DELETE | `/api/1.0/webhooks/{id}` | Delete Webhook. |
| POST (Suche) | `/api/1.0/webhooks/posts/search` | Search Posts created for user. |

## Bereich Catering v1.0 (`1.0_catering`) — 52 GET, 106 schreibend

Veranstaltungsplanung (Events, Gäste, Speisen-, Getränke- und Ausrüstungsgruppen, Personal, Standorte). Für Concept Family voraussichtlich ohne Bedeutung. Keine Query-Parameter, keine Antwortschemas. Je Pfad die vorkommenden Methoden:

| Pfad | Methoden |
|---|---|
| `/api/1.0/catering/consumerGroups` | GET |
| `/api/1.0/catering/consumerGroups/{id}` | GET, PUT |
| `/api/1.0/catering/consumerGroups/event/{eventId}` | GET |
| `/api/1.0/catering/consumerGroups/{id}/event/{eventId}` | POST, DELETE |
| `/api/1.0/catering/customers` | GET, POST |
| `/api/1.0/catering/customers/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/drinks/event/{eventId}` | GET |
| `/api/1.0/catering/drinks/event/{eventId}/byDate` | GET |
| `/api/1.0/catering/drinks/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/drinks/recipe/{recipeId}` | POST |
| `/api/1.0/catering/drinks/search` | POST |
| `/api/1.0/catering/drinkGroups/event/{eventId}` | GET, POST |
| `/api/1.0/catering/drinkGroups/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/drinkGroups/search` | POST |
| `/api/1.0/catering/drinkGroups/{id}/clone` | POST |
| `/api/1.0/catering/drinkGroups/createMealGroups` | POST |
| `/api/1.0/catering/drinkGroups/createEquipmentGroups` | POST |
| `/api/1.0/catering/drinkGroups/event/{eventId}/copyToMealGroups` | POST |
| `/api/1.0/catering/drinkGroups/event/{eventId}/copyToEquipmentGroups` | POST |
| `/api/1.0/catering/drinkSubgroups/event/{eventId}` | GET, POST |
| `/api/1.0/catering/drinkSubgroups/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/drinkSubgroups/search` | POST |
| `/api/1.0/catering/drinkSubgroups/{id}/clone` | POST |
| `/api/1.0/catering/equipment/event/{eventId}` | GET |
| `/api/1.0/catering/equipment/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/equipment` | POST |
| `/api/1.0/catering/equipmentGroups/event/{eventId}` | GET, POST |
| `/api/1.0/catering/equipmentGroups/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/equipmentGroups/search` | POST |
| `/api/1.0/catering/equipmentGroups/{id}/clone` | POST |
| `/api/1.0/catering/equipmentGroups/createMealGroups` | POST |
| `/api/1.0/catering/equipmentGroups/createDrinkGroups` | POST |
| `/api/1.0/catering/equipmentGroups/event/{eventId}/copyToMealGroups` | POST |
| `/api/1.0/catering/equipmentGroups/event/{eventId}/copyToDrinkGroups` | POST |
| `/api/1.0/catering/equipmentSubgroups/event/{eventId}` | GET, POST |
| `/api/1.0/catering/equipmentSubgroups/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/equipmentSubgroups/search` | POST |
| `/api/1.0/catering/equipmentSubgroups/{id}/clone` | POST |
| `/api/1.0/catering/events` | GET, POST |
| `/api/1.0/catering/events/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/events/search` | POST |
| `/api/1.0/catering/events/search/dateRange` | POST |
| `/api/1.0/catering/events/search/filters` | POST |
| `/api/1.0/catering/events/{id}/search/recipes` | POST |
| `/api/1.0/catering/events/{id}/dateGroups` | GET |
| `/api/1.0/catering/events/{id}/allergens` | GET |
| `/api/1.0/catering/events/{id}/additives` | GET |
| `/api/1.0/catering/events/{id}/additionals` | GET |
| `/api/1.0/catering/events-recipes` | GET |
| `/api/1.0/catering/events-recipes/event/{eventId}` | GET |
| `/api/1.0/catering/eventTypes` | GET, POST |
| `/api/1.0/catering/eventTypes/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/locations` | GET, POST |
| `/api/1.0/catering/locations/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/locations/{id}/locationType/{typeId}` | PUT, DELETE |
| `/api/1.0/catering/locations/search` | POST |
| `/api/1.0/catering/locations/{id}/image` | POST, DELETE |
| `/api/1.0/catering/locationTypes` | GET |
| `/api/1.0/catering/meals/event/{eventId}` | GET |
| `/api/1.0/catering/meals/event/{eventId}/byDate` | GET |
| `/api/1.0/catering/meals/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/meals/recipe/{recipeId}` | POST |
| `/api/1.0/catering/meals/search` | POST |
| `/api/1.0/catering/meals/{id}/weights` | GET |
| `/api/1.0/catering/mealGroups/event/{eventId}` | GET, POST |
| `/api/1.0/catering/mealGroups/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/mealGroups/search` | POST |
| `/api/1.0/catering/mealGroups/{id}/clone` | POST |
| `/api/1.0/catering/mealGroups/createDrinkGroups` | POST |
| `/api/1.0/catering/mealGroups/createEquipmentGroups` | POST |
| `/api/1.0/catering/mealGroups/event/{eventId}/copyToDrinkGroups` | POST |
| `/api/1.0/catering/mealGroups/event/{eventId}/copyToEquipmentGroups` | POST |
| `/api/1.0/catering/mealSubgroups/event/{eventId}` | GET, POST |
| `/api/1.0/catering/mealSubgroups/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/mealSubgroups/search` | POST |
| `/api/1.0/catering/mealSubgroups/{id}/clone` | POST |
| `/api/1.0/catering/recipeBlacklist` | GET, POST |
| `/api/1.0/catering/recipeBlacklist/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/recipeBlacklist/search` | POST |
| `/api/1.0/catering/recipeCategoryBlacklist` | GET, POST |
| `/api/1.0/catering/recipeCategoryBlacklist/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/recipeCategoryBlacklist/search` | POST |
| `/api/1.0/catering/roles` | GET, POST |
| `/api/1.0/catering/roles/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/roles/search` | POST |
| `/api/1.0/catering/roleOptions` | GET |
| `/api/1.0/catering/roleOptionValues` | PUT |
| `/api/1.0/catering/serviceTypes` | GET, POST |
| `/api/1.0/catering/serviceTypes/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/serviceTypes/search` | POST |
| `/api/1.0/catering/staff` | GET, POST |
| `/api/1.0/catering/staff/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/staff/search` | POST |
| `/api/1.0/catering/staff/event/{eventId}` | POST |
| `/api/1.0/catering/staffGroups/event/{id}` | GET |
| `/api/1.0/catering/staffGroups` | POST |
| `/api/1.0/catering/staffGroups/{id}` | GET, PUT, DELETE |
| `/api/1.0/catering/staffGroups/search` | POST |
| `/api/1.0/catering/staffGroupStaff` | PUT, POST |
| `/api/1.0/catering/staffGroupStaff/{id}` | DELETE |

## Was die Spezifikation nicht sagt

### Sicherheit

* `securitySchemes` fehlt in **allen neun** Dateien, obwohl überall `security: Bearer` steht. Tokenart, Ausstellung, Laufzeit, Header-Name: nicht beschrieben.
* Nur ein Scope (`pos:read`), nur in drei 403-Beschreibungen. Welche Berechtigung die Erp- und Recipe-Endpunkte verlangen: nicht beschrieben.
* Keine Rate Limits, keine 429-Antwort, keine Retry-Hinweise.
* Der Weg zu den Pfad-IDs ist offen: ~~`accountIdentifier` (Pos v2.0),~~ (gemessen 18.11.2026: die `connectionId`) `billingAccountId` (Erp v2.0), `erp_ids`/`concrete_product_ids` (Stock) werden nicht erklärt. Beim Lagerbeispiel steht `erpId: 12284` — dieselbe Schlüsselebene wie unsere `core.kostenstelle.erp_id`, ob identisch, ist nicht gemessen.

### Schemas

| Datei | `components.schemas` | Antworten beschrieben |
|---|---|---|
| `2.0_pos` | 29 | ja (alle fünf GET mit 200-Schema) |
| `2.0_erp` | 19 | ja (alle vier GET) |
| `1.0_pos` | 7 (nur Anfrage-Bodys „Xenus") | nein — „Get all …" ohne Schema |
| `1.0_recipes` | keine | nein — nur `default`-Antwort ohne Schema (und 5 Operationen mit `200` ohne Schema) |
| `1.0_catering`, `1.0_erp`, `1.0_shops`, `1.0_user`, `1.0_webhooks` | keine | nein — `default`-Antwort mit leerer Beschreibung |

Das heißt: **Feldlisten für 1.0 gibt es nicht.** Einen Vergleich mit den Feldern des Importers ist nur gegen Version 2.0 möglich.

### Uneinheitliche Seitenparameter

Fünf Varianten in neun Dateien:

| Variante | Wo | Standard / Grenze | Hülle der Antwort |
|---|---|---|---|
| `page`, `pageSize`, `orderBy`, `orderDirection` | `1.0_pos` (Listen) | `pageSize` 10; `orderBy` `timeCreated`; `orderDirection` `DESC` | nicht beschrieben |
| `page`, `perPage` | `2.0_pos` (Read-back) | `perPage` 50, max. 200; `page` max. 1.000.000 | `data[]` + `pagination{currentPage,perPage,totalItems,totalPages}` |
| `page`, `limit` | `2.0_erp` Wareneingänge | `limit` 25, max. 100 | `data[]` + `pagination{…}` |
| `page`, `page_size` (+ `order`) | `2.0_erp` Stock | `page_size` 50, nur die Werte 5/10/20/50/100/1000/5000/10000 | `data[]` + `filters` + `pagination{…}` |
| keine | alles Übrige, auch die beiden fn-recipe-Feeds und die als „paginated" benannten Rezept-Endpunkte | — | — |

Gemeinsam ist nur die Hülle `pagination{currentPage, perPage, totalItems, totalPages}` bei Version 2.0. Das Parametersystem selbst ist je Endpunktgruppe ein anderes. (Zum Vergleich: der interne Weg, den der Importer nutzt, kennt `page`/`page_size`/`order_by`/`order_direction`, `page`/`perPage` ohne Wirkung und `page_count`/`total_count`; siehe `docs/foodnotify-api-inventar.md`, „Drei Antworthüllen".)

### Datumsfilter und Änderungsfilter

Datumsfilter gibt es nur an sechs Endpunkten:

| Endpunkt | Parameter | Gegenstand |
|---|---|---|
| `GET /api/2.0/erp/goods-receipts/{billingAccountId}` | `startDate`, `endDate` (`Y-m-d`) | Lieferdatum |
| `GET /api/2.0/erp/stock/balances`, `/movements`, `/aggregate` | `business_date_from`, `business_date_to` (Typ `date-time`) | Geschäftstag der Lagerbewegung |
| `GET /api/2.0/pos/accounts/{accountIdentifier}/invoices` | `businessDayFrom`, `businessDayTo` (`Y-m-d`) | Geschäftstag der Rechnung |

Einen Änderungsfilter („geändert seit") gibt es genau einmal: `updated_since` an den beiden fn-recipe-Feeds — und dort ist er laut Spezifikation `deprecated` und „Reserved — not yet publicly documented; subject to change". **Kein Endpunkt für Bestellungen, Rezepte, Inventuren oder Waren hat einen Änderungs- oder Datumsfilter.** Das Schema `InventoryFilterQuery` (Name klingt nach Inventur) trägt nur `updated_since` und gehört in Wahrheit zu den fn-recipe-Feeds.

### Widersprüche und Auffälligkeiten (offenbar automatisch erzeugt)

* **Zwei Generatoren.** `operationId` in 1.0 heißt `get_api_pos_accounts_index`, in 2.0 `get_api.pos.accounts.product-groups.collection` — zwei verschiedene Frameworks/Generatoren. Die 2.0-Schemas tragen Doppelgänger mit angehängter 2 (`InvoiceResource`/`InvoiceResource2`, `ProductCollectionResource`/`ProductCollectionResource2`, …).
* **`SupplierResource.identifier` ist `boolean`** (und Pflichtfeld), `vatNumber` und `GLN` sind Strings. Vermutlich ein Generatorfehler — ein Lieferanten-Kennzeichen als Wahrheitswert ergibt keinen Sinn. Beim ersten Abruf gegen den echten Wert prüfen.
* **Datumstypen uneinheitlich:** Stock-Filter `date-time`, Wareneingang- und Rechnungsfilter freie Strings mit Hinweis `Y-m-d`.
* **`updated_since`:** als `deprecated` markiert, aber zugleich als „reserved" beschrieben und der einzige Änderungsfilter der ganzen Spezifikation.
* **Beschreibung von `restv2/…/product-groups`:** „Products that you do not send will be removed in our system" — es geht um Produktgruppen; `fn-recipe` und `restv2` nennen beide „Replaces (default) all …", Details fehlen.
* **Summary „paginated" ohne Parameter** an `/api/1.0/recipes/allData` und `/api/1.0/recipes/pricing`.
* **Pfade außerhalb ihres Bereichs:** `dailymenus` und `ingredients/search` stehen in der Recipe-Datei; `concrete-products/event/{eventId}/search` (Catering-Bezug) in Erp.Legacy.
* **`PUT /api/1.0/pos/{id}`** hat als einzige Operation der Datei nur eine `default`-Antwort statt 200.
* **Emoji in Summaries** der Datei `2.0_erp` (z. B. „📁 List Goods Receipts."), neuere Endpunkte mit englischen Beschreibungen in Markdown.
* **Zwischen 1.0 und 2.0:** Beide führen einen Bereich „Pos" und einen Bereich „Erp", mit verschiedenem Zweck. 1.0 Pos ist eine Kontoverwaltung mit Anlegen/Ändern/Löschen (Produkte und Gruppen per Hand oder „Xenus"), 2.0 Pos ist ein Rücklesen von Daten, die ein POS gesendet hat, plus Feeds aus Rezepten. 1.0 Erp („Legacy") hat Listen ohne Parameter, 2.0 Erp hat gefilterte, paginierte Lagerabfragen. 2.0 ersetzt 1.0 nicht erkennbar: 1.0 trägt weiter Rezepte, Webhooks, User und Shops, wofür es in 2.0 kein Gegenstück gibt. Eine Abkündigung von 1.0 steht nicht in der Spezifikation.
* **Keine Beispiele** in 1.0; in 2.0 teils mit `example`-Werten (z. B. `erpId: 12284`, `concreteProductId: 389636`, Zeitraum `2026-01-01` bis `2026-01-31`).

## Abgleich mit dem, was der Importer heute holt

Quelle: `src/foodnotify/endpunkte.ts` (14 Registereinträge, Stand 18.11.2026) und `docs/foodnotify-api-inventar.md`. Alle Aussagen in der Spalte „Offizielles Gegenstück" gelten **laut Spezifikation, nicht gemessen**. Ein Feldvergleich ist nur möglich, wo die Spezifikation Felder nennt — das ist für **keinen** der 14 Einträge der Fall (alle Gegenstücke liegen in v1.0 ohne Antwortschema, oder es gibt keines).

> **Nach der Messung vom 18.11.2026 ist diese Tabelle für den Betrieb gegenstandslos:** jedes v1.0-Gegenstück, das unten genannt wird, weist das Scope-Token mit 403 ab. Sie bleibt als Abgleich der Spezifikation stehen. Was mit dem Token tatsächlich geht, steht im Abschnitt „Was das für den Importer heißt" weiter oben.

| Registereintrag | Unser Pfad (intern) | Offizielles Gegenstück (laut Spezifikation) | Anmerkung |
|---|---|---|---|
| `fn:profil` | `GET /api/profile` | `GET /api/1.0/user` („Get Current User") | Felder nicht beschrieben |
| `fn:betriebe` | `GET /api/core/business/{userId}/restaurants` | `GET /api/1.0/user/restaurants`, `/{id}` | Keine Benutzer-ID im Pfad (aus dem Token); Felder nicht beschrieben, ob die `timezone` mitkommt, unbekannt |
| `fn:kostenstellen` | `GET /api/erp/all` | `GET /api/1.0/erp/erp` („Get all erps", Erp.Legacy) | Felder nicht beschrieben; ob die drei Schlüsselebenen (`restaurant.id`, `costCenter.id`, `erpId`) mitkommen, unbekannt |
| `fn:pos_standorte` | `GET /api/pos/locations` | `GET /api/1.0/pos` („Get all accounts"), `POST /api/1.0/pos/search` | Das Anlage-Schema des Kontos nennt `accountType`, `costCenter`, `endpointUrl`, `token`, `sync*`; `connectionId` und `deviceType` kommen in der Spezifikation nicht vor. Ob es dieselbe Liste ist, unbekannt. Token-Risiko, siehe Bereich Pos v1.0 |
| `fn:bestellungen` | `GET /api/{erpId}/shop-order/paginate` | höchstens `GET /api/1.0/shops/{id}/orders` | **Kein belastbares Gegenstück.** Kein `erpId`, keine Seiten, kein Datumsfilter, keine Sortierung. Ergänzend, aber nicht gleichwertig: `GET /api/2.0/erp/goods-receipts/{billingAccountId}` (Wareneingänge, nicht Bestellungen; Lieferdatumsfilter) |
| `fn:bestellung` | `GET /api/{erpId}/shop-order/{orderId}` | `GET /api/1.0/shops/orders/{id}` („Get one ShopOrder (with products)") | Felder nicht beschrieben. Ob `{id}` unsere `fn_id` ist (nicht die Bestellnummer, nicht `markedShopOrder.orderId`), unbekannt |
| `fn:bestellpositionen` | `GET /api/{erpId}/shop-order/{orderId}/change` | `GET /api/1.0/shops/orders/{id}` („with products"); teilweise `lineItems` der Wareneingänge in `2.0 goods-receipts` | Bei den Wareneingängen: `position`, `productNumber`, `productName`, `unitPrice`, `quantity`, `totalPrice`, `taxRate`, `unit`, `stockGroup`, `discountInfo`. Es fehlen `concreteProduct.id`, Gebindegröße, Verpackungsmenge. Wareneingänge gibt es laut Beschreibung nur für Lieferscheine und angenommene Bestellungen |
| `fn:bestellansicht` | `GET /shop/{shopId}/orders/{nr}` (HTML) | kein Gegenstück | HTML der Oberfläche |
| `fn:inventuren` | `GET /api/erp/stocktakings?erpIds[]=…` | `GET /api/1.0/erp/stocktaking` („Get all stocktaking", Erp.Legacy) | Keine Parameter (kein `erpIds[]`, keine Seiten), Felder nicht beschrieben |
| `fn:inventurpositionen` | `GET /api/erp/stocktakings/{uuid}/items` | kein Gegenstück | Nächstes: `GET /api/2.0/erp/stock/balances` (Tagesstand je Ware, aus Bewegungen abgeleitet) — andere Aussage als eine Zählung |
| `fn:rezepte` | `GET /api/recipes?page=N` | `GET /api/1.0/recipes`, `/recipes/allData` („paginated"), `/recipes/pricing` | Keine Parameter deklariert. Ob die offizielle Liste vollständig und stabil sortiert ist (unsere interne nicht: 56 Enchilada-Rezepte nur über Verweise, 21 Doppelte an Seitengrenzen), ist offen |
| `fn:rezept` | `GET /api/recipes/{id}` | `GET /api/1.0/recipes/{id}` | Felder nicht beschrieben |
| `fn:rezept_zutaten` | `GET /api/recipes/{id}/ingredients` | `GET /api/1.0/recipes/{id}/ingredients` | Felder nicht beschrieben. Unsere Felder: `id, kind, name, quantity, unit, cost, artikelId, supplier, subRecipeId, group` |
| `fn:rezept_meta` | `GET /api/recipes/{id}/meta` | teilweise: `/recipes/{id}/allergens`, `/additives`, `/additionals`, `/nutritions` | Für Gewicht, Portion und Verlust (`weight.loss`) **kein erkennbares Gegenstück**; `contributionMarginData` ist unbeschrieben |

**Fazit zum Abgleich:** Von den 14 Einträgen hat nach Spezifikation einer ein einigermaßen sicheres Gegenstück mit gleicher Wirkung (`fn:rezept_zutaten`), vier haben ein plausibles (`fn:profil`, `fn:betriebe`, `fn:rezepte`, `fn:rezept`), drei ein vages (`fn:kostenstellen`, `fn:pos_standorte`, `fn:inventuren`), drei nur ein teilweises oder indirektes (`fn:bestellung`, `fn:bestellpositionen`, `fn:rezept_meta`), drei keines (`fn:bestellungen`, `fn:bestellansicht`, `fn:inventurpositionen`). Ohne Antwortfelder lässt sich keines davon als gleichwertig bestätigen. Die offizielle Schnittstelle ist kein Ersatz für den Importer, sondern eine mögliche Ergänzung.

### Was die offizielle Schnittstelle liefert, das wir heute nicht haben

Alle Zeilen: **laut Spezifikation, nicht gemessen.** ~~Ob die Endpunkte für unsere Konten freigeschaltet sind und Daten enthalten, zeigt erst die Messung mit Token.~~

> **Gemessen am 18.11.2026 (Konto Wilma Wunder, Scope-Token):** Erreichbar sind nur die drei POS-Rücklese-Endpunkte (Produkte, Produktgruppen, Rechnungen — 200). Die fn-recipe-Feeds antworten 500 („Account is not of type FnRecipe"), die drei Lager-Endpunkte (`/api/2.0/erp/stock/*`) und **alle** v1.0-Zeilen 403 („does not support scope-limited tokens"). Wareneingänge (`goods-receipts`) sind nicht gemessen — die `billingAccountId` ist unbekannt. Die Zeilen unten über Lagerbestand, Lagerbewegungen, Rezept je Betrieb, Rezeptpreise, Deckungsbeitrag, Rezept-Stammdaten, Lager-ERP-Listen und Webhooks sind damit mit diesem Token **nicht** zu holen.

| Kandidat | Endpunkt | Was es wäre | Was es bei uns füllen könnte / Vorbehalt |
|---|---|---|---|
| POS-Produkte mit verknüpftem Rezept | `GET /api/2.0/pos/accounts/{accountIdentifier}/products` | `plu`, `name`, `netPrice`, `vatRate`, `productGroupId`, **`recipe{id}`**, `absentFromFeedSince` je Kasse | Könnte `core.pos_artikel` füllen (heute leer, 0 Zeilen, `docs/offene-punkte.md`). Vorbehalt: zeigt nur Produkte, die ein POS an FoodNotify gesendet hat (Spezifikation: „stored for the POS account"). Ob die Amadeus-Anbindungen darunter fallen, ist unbekannt. Unser bisheriger Weg `/api/pos/mapping/{connectionId}/articles` ist der interne |
| POS-Produktgruppen | `GET /api/2.0/pos/accounts/{accountIdentifier}/product-groups` | `productGroupId`, `name`, `description` | Gliederung der Kassenprodukte; sonst nicht von uns geholt |
| POS-Rechnungen mit Positionen | `GET /api/2.0/pos/accounts/{accountIdentifier}/invoices` | Rechnung je Geschäftstag, Positionen mit `plu`, `quantity`, `netPricePerItem`, `voidReason`, `affectsStock`; Filter `businessDayFrom`/`businessDayTo` | Verkaufsdaten in FoodNotify — wir nehmen Verkäufe aus LINA (Entscheidung 01.08.2026). Vorbehalt: der Verkaufsimport war defekt (`saleStatus: init`, Fehler `root_recipe_id`, `docs/foodnotify-api-inventar.md` §8a); ob die Rücklese-Daten betroffen sind, unbekannt |
| Wareneingänge | `GET /api/2.0/erp/goods-receipts/{billingAccountId}` | Lieferscheine/angenommene Bestellungen mit Lieferant (USt-ID, GLN), Positionen mit Menge und Preis; Filter auf Lieferdatum | Neu: Wareneingang als eigener Beleg. Bei uns nur Bestellungen mit `deliveryDate`. Vorbehalt: `billingAccountId` und Lizenz offen |
| Lagerbestand je Tag | `GET /api/2.0/erp/stock/balances` | Anfangs-/Endbestand und Änderung je ERP, Ware und Geschäftstag, in Menge und Preis | Könnte `core.ware_stand` ersetzen/ergänzen (heute leer, nur Monatsmomentaufnahme geplant). Bestand je Tag statt je Monat. Vorbehalt: Datenmenge (`page_size` bis 10.000), Herkunft der Zahlen nicht beschrieben |
| Lagerbewegungen nach Grund | `GET /api/2.0/erp/stock/movements`, `/aggregate` | Summen je Geschäftstag, Ware und Grund, auch Verderb („food-waste"); Aggregation frei einstellbar | Schwund/Verderb als Bewegung; die interne Variante `/api/erp/food-waste-alpha` holen wir nicht. Vorbehalt: mögliche Gründe nicht beschrieben |
| Rezept je Betrieb | `GET /api/1.0/recipes/{id}/restaurants`, `/recipes/restaurants/{id}` | Zuordnung Rezept ↔ Restaurant | Würde den **Betriebsbezug** liefern, den `AGENTS.md` heute als fehlend nennt („Rezepte gelten je Marke"). Felder nicht beschrieben |
| Rezeptpreise je Betrieb | `GET /api/1.0/recipes/pricing` | „paginated list of recipes including per-restaurant pricing" | Verkaufspreise je Betrieb; Felder nicht beschrieben, keine Seitenparameter deklariert |
| Deckungsbeitrag je Rezept | `GET /api/1.0/recipes/{id}/contributionMarginData` | Deckungsbeitragsdaten | Unbeschrieben; Abgleich mit unserem Deckungsbeitrag (`mart.deckungsbeitrag_warengruppe`) wäre offen |
| Rezept-Verfügbarkeit, Kategorien, Tags, Allergene, Nährwerte | `/recipes/{id}/availabilities`, `/categories`, `/tags`, `/allergens`, `/additives`, `/nutritions` | Stammdaten zum Rezept | Für die Auswertung wenig relevant; Kategorien könnten Warengruppen der Rezepte liefern |
| Rezept-Feeds für Kassen | `GET /api/2.0/pos/vendors/fn-recipe/{accountIdentifier}/products`, `/product-groups` | Produkte mit `grossPrice`/`vatRate` aus Rezepten, Gruppen aus Rezeptkategorien | Verkaufspreis je Standort laut FoodNotify; `updated_since` laut Spezifikation reserviert |
| Lager-ERP-Listen | `GET /api/1.0/erp/concrete-products`, `/stock-changes`, `/stocktaking` | Waren, Lageränderungen, Inventuren | Ohne Parameter und Felder; `concrete-products` wäre der Warenstamm (`core.ware` kommt heute nur über Bestellpositionen: 43.271 Zeilen) |
| Webhooks | `GET/POST/PUT/DELETE /api/1.0/webhooks`, `/events`, `/posts` | Rückrufe für Ereignisse statt Abfrage | Ereignisliste nicht beschrieben. Anlegen schreibt bei FoodNotify; nicht ohne Entscheidung |
| Änderungsfilter | `updated_since` | nur an den beiden fn-recipe-Feeds und dort reserviert/deprecated | Kein Weg, „nur Geändertes" für Bestellungen, Rezepte oder Inventuren zu fragen — unser Fingerabdruck-Verfahren (`0098`) bleibt nötig |
| Benutzer und Unterbenutzer | `GET /api/1.0/user/subusers`, `/subusers/search` | personenbezogen | Nicht holen (kein Auswertungsnutzen) |

Nicht relevant: der gesamte Bereich Catering (158 Operationen) und die Xenus-Endpunkte unter 1.0 Pos.

## Spalten von `operationen.csv`

| Spalte | Inhalt |
|---|---|
| `datei`, `version`, `bereich` | Quelldatei, API-Version, Bereich (Dateiname) |
| `method`, `path`, `summary` | HTTP-Methode, Pfad, Summary der Spezifikation |
| `path_params`, `query_params` | Pfadparameter; Query-Parameter als `name:typ:Pflicht` (`array<…>` bei Listen, Schemanamen bei Enums) |
| `request_body_fields` | Top-Level-Felder des Anfrage-Bodys (`[]{…}` bei Listen; `[application/json]` o. ä., wenn kein Schema) |
| `response_200_fields` | Top-Level-Felder der 200-Antwort, bei Listen/Hüllen eine Ebene tiefer; `nicht beschrieben`, wenn die Spezifikation keine Struktur enthält |
| `pagination` | Seitenparameter mit Standard/Grenze und Antworthülle, sonst `keine angegeben` |
| `filter_by_date` | `ja: <Parameter>` oder `nein` |
| `security` | immer `global: Bearer (securityScheme nicht definiert); je Operation nicht deklariert` |
| `described_scope` | Scope-Zeichenketten aus den Beschreibungen (nur `pos:read` bei drei Operationen) |
| `lesend` | `ja` (GET), `nein`, `unklar (POST-Suche)` |
| `anmerkung` | Besonderheiten, z. B. Beispiel-Webhook, „paginated" ohne Parameter |
