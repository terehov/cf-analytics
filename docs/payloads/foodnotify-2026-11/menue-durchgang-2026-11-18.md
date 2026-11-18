# FoodNotify: Durchgang durch die neue Oberfläche (`/brew`), 18.11.2026

Konto Wilma Wunder, angemeldete Browser-Sitzung, **nur lesend**: jede Seite einmal geöffnet, nichts
angeklickt, nichts gespeichert. 68 Seiten aus der Routentabelle (`intern/brew-routen.csv`): alle ohne
Parameter, dazu die mit `erpId` 7984, `costCenterId` 7911, `restaurantId` 7846, `connectionId` 2052.
Ausgelassen: Anmelden, Registrieren, Passwort vergessen, OAuth-Zustimmung, E-Mail-Bestätigung,
Lieferantenregistrierung, Abmelden.

Der Wechsel lief über `history.pushState` in der geladenen Anwendung (kein Neuladen je Seite). Je Seite
gewartet, bis 2,5 s lang kein neuer Abruf kam (höchstens 12 s). Mitgeschrieben: ausgelöste Abrufe mit
Status, Dauer und Größe (ohne Werte der Query-Parameter), fremde Hosts, Konsolenfehler.

Die Rohdaten (`fn-menue-durchgang.json`) hat die Seite als Datei in den Downloads-Ordner des Nutzers
geschrieben. Diese Datei hier ist die Zusammenfassung, aus der Ausgabe abgeschrieben.

## Welche Seite welche Abrufe auslöst

Alle Abrufe 200, wenn nicht anders vermerkt. Pfade ohne `/api`-Präfix sind als solche geschrieben.

| Seite | Überschrift | Abrufe beim Öffnen |
|---|---|---|
| `/dashboard` | Anbindungen | (beim ersten Laden) `erp/available`, `carts/count`, `dashboard/getDashboard/{costCenterId}`, `erp/last-used/{erpId}` |
| `/shops` | Lieferanten | `shops/list?q&sector&my`, `shops/categories`, Logos unter `/i/c/<sha1>-m.jpeg` |
| `/shop` | – | `allowedLocations`, `erp/available` |
| `/shop/carts/active` · `draft` · `all` · `faulty` | Warenkörbe | `carts/{status}?supplierId&locationId&cartId&page&limit`, `connectedSuppliers`, `allowedLocations` |
| `/shop/smartlists` | Smart-Listen | leitet auf `/shop/cost-center/{costCenterId}/smartlists`; `shop/shoppingList/{costCenterId}` |
| `/shop/mass-ordering` · `/new` | Neue Bestellung erstellen | `core/business/{userId}/restaurants` |
| `/recipes` | – | keine (Hülle) |
| `/recipes/ingredients` | Zutaten | `recipe/ingredients?page&source`, `recipe/ingredients/suppliers`, Bilder `/i/shop/a/…` |
| `/recipes/groups` | Rezeptgruppen | `recipes/distinct-categories` |
| `/recipes/contribution-margin` | Deckungsbeitrag | `core/business/{userId}/restaurants`, `recipes/distinct-categories`, `recipes/cost-calculation/summary`, `recipes/cogs-corridors/recipe-types`, `recipes/cost-calculation/recipes?sortBy&sortDirection&page&limit` |
| `/recipes/contribution-margin/settings` | Wareneinsatz-Korridore | `recipes/cogs-corridors/recipe-types`, `…/distinct-categories` |
| `/recipes/dashboard-mix` · `/recipes` | – | `recipes/dashboard-mix/restaurants`, `recipes/dashboard-mix/{restaurantId}?day`, `…/{restaurantId}/items?day` |
| `/apps/recipe-viewer` | Rezepte | `recipe-viewer/groups`, `recipes/tags`, `recipe-viewer/recipes?page&limit&orderBy&orderDirection` |
| `/apps/recipe-viewer/config` | Rezept-Viewer-Konfiguration | `recipe-viewer/config` |
| `/apps/recipe-viewer/cards` · `/preview` | Minirezept-Karte · PDF-Vorschau | keine |
| `/erp` | – | leitet auf `/erp/{zuletzt benutzt}/dashboard` |
| `/erp/{erpId}` | – | **`erp/last-used/{erpId}`** (siehe unten), `erp/stock-transfer/notifications/{erpId}` |
| `/erp/{erpId}/dashboard` | – | `{erpId}/dashboard?low_on_stock_*&pending_orders_*`, `{erpId}/products?stocktakingVisibility&page_size`, `completion/{costCenterId}/overall`, `erp/stocktakings/validation/{erpId}`, `erp/stock-transfer/notifications/{erpId}` |
| `/erp/{erpId}/category` · `/edit` | Warengruppen | `{erpId}/category/paginate?search&page&page_size`, `{erpId}/category` |
| `/erp/{erpId}/product` | Produkte | `shops/list`, `shops/{erpId}/list/disconnected`, `{erpId}/category`, `{erpId}/storage`, `{erpId}/products?page&page_size&order_by&additional_order_by&additional_order_by_direction&order_direction&search` |
| `/erp/{erpId}/product-groups` | Produktgruppen | `erpSettings/productGroups?page&pageSize&search&erpId` |
| `/erp/{erpId}/storage` · `/edit` | Lager | `{erpId}/storage` |
| `/erp/{erpId}/order` | Bestellungen | `{erpId}/shop-order/paginate?page_size&page&order_by&order_direction`, `…/get-shops-for-all-orders`, `…/get-status-for-all-orders`, `erp/order/auto-import-settings` |
| `/erp/{erpId}/stocktaking` | Inventur | `erp/stocktakings?erpIds[]&page`, `erp/stock-transfer/notifications/{erpId}` |
| `/erp/{erpId}/stocktransfer` | Produkttransfer | `erp/stock-transfer?erpId&page&limit&order_by&order_direction`, `erp/all` |
| `/erp/{erpId}/stocktransfer-request` | Transferanfragen | `erp/stock-transfer-request?erpId&page&limit`, `erp/all` |
| `/erp/{erpId}/sale` | Verkauf | `{erpId}/sales?page&page_size&order_by&order_direction` |
| `/erp/{erpId}/food-waste` | Food Waste | `erp/food-waste-alpha/totals?erpId`, `erp/food-waste?erpId&limit&page`, `{erpId}/category`, `{erpId}/storage`, `{erpId}/products?search&page&page_size` |
| `/erp/{erpId}/global/commodity-groups` | Warengruppen | `erp/commodity-groups?page&perPage`, `core/business/{userId}/cost-centers` |
| `/erp/{erpId}/global/product-groups` | Produktgruppen | `erp/product-groups?page&perPage&costCenterId`, `core/business/{userId}/cost-centers` |
| `/erp/{erpId}/global/storages` | Lagerorte | `erpSettings/restaurants`, `erpSettings/storages?page&pageSize&search` |
| `/erp/{erpId}/test` | – | `erpSettings/restaurants/shared`, `{erpId}/storage`, `{erpId}/category` |
| `/analytics` | – | `v2/analytics` |
| `/analytics-custom/cost-analysis` | F&B Cost Analysis | `core/business/{userId}/restaurants` (die Berichte erst nach Auswahl) |
| `/completion-dashboard` | – | `completion/{costCenterId}/overall`, `erp/available` |
| `/translations` | – | keine |
| `/settings/general` | Einstellungen | `recipes/settings/{userId}/display` |
| `/settings/business-information` | Unternehmen | `core/business/{userId}/company`, `…/locations/form-options` |
| `/settings/business-information/locations/{restaurantId}` · `/new` | Betrieb · Neuer Betrieb | `…/locations/form-options`, `core/languages/{userId}/business`, `…/locations/{restaurantId}` bzw. `…/vat-defaults`, `…/company`; Google Maps |
| `/settings/users` | Benutzer | `user/auth/users/{userId}/security-policy`, `subuser-roles`, `core/business/{userId}/restaurants`, `subusers?page&limit` |
| `/settings/users/new` · `/roles` · `/roles/new` | Rollen | `subuser-roles`, `subuser-permissions`, `core/business/{userId}/restaurants` |
| `/settings/profile` | Profil | `profile`, `user/email-change?email`, `user/auth/users/{userId}`, `shop/order-reminder/subscription/upcoming_order_deadline`, `…/order_placed`, `user/api-tokens` |
| `/settings/pos/locations` | Standorte | `pos/device_types`, `pos/locations` |
| `/settings/pos/synchronisation` | Synchronization | `pos/sync/user/distinct_categories` |
| `/settings/pos/{connectionId}/mapping` | POS-Artikel mit Rezepten verbinden | `pos/mapping/{id}/articles`, `…/jobs/active` (204), verzögert `…/article-sales` und `…/link-targets` |
| `/admin`, `/admin/analytics`, `/admin/customer-success` | – | leiten auf `/analytics` (kein Recht) |
| `/admin/erp-catalog-sync`, `/admin/supplier-onboarding` | – | bleiben stehen, leer, kein Abruf |

Nicht alle Abrufe einer Seite stehen in den Bundles so, wie sie hier laufen: `completion/{costCenterId}/overall`,
`erp/stocktakings/validation/{erpId}`, `erp/stock-transfer/notifications/{erpId}`, `recipes/dashboard-mix/{id}/items`
und `shop/order-reminder/subscription/{typ}` sind beim Durchgang gesehen; gegen `intern/brew-aufrufe.csv`
abgleichen, bevor man sie als neu führt.

## Technische Auffälligkeiten

1. **Das Öffnen der Warenwirtschaft eines Betriebs schreibt.** `/erp/{erpId}` ruft `GET /api/erp/last-used/{erpId}`
   — einer der 14 GETs mit Wirkung (`messliste-token.md`). Der Durchgang hat ihn dadurch **einmal ausgelöst**
   (für 7984): das Konto merkt sich jetzt 7984 als zuletzt benutzten Betrieb statt 11035. Dieselbe Wirkung
   wie ein Klick eines Benutzers auf den Betrieb, sonst nichts. Wer künftig Seiten automatisch öffnet: die Route
   `/erp/{erpId}` ohne Unterseite auslassen, die Unterseiten (`/erp/{erpId}/order` usw.) lösen ihn nicht aus.
2. **Eine Testseite steht in der Produktion:** `/brew/erp/{erpId}/test` ist erreichbar, zeigt nichts und lädt
   `erpSettings/restaurants/shared` (4,1 s, 69 KB).
3. **Langsame Abrufe:** `pos/mapping/{id}/link-targets` 11,3 s für 551 KB (alle ~13.250 Rezepte des Kontos in
   einer Antwort, ohne Seiten), `pos/mapping/{id}/article-sales` 11,3 s, ein Artikelbild 9,1 s für 23 KB.
   Alles Übrige 0,1 bis 1,6 s.
4. **Keine Seitensteuerung bei `link-targets`** — die größte einzelne Antwort der Oberfläche. Wer sie lädt,
   bekommt immer alles.
5. **Fremde Hosts im Betrieb:** `cdn.jsdelivr.net` (ein WebAssembly-Baustein für Animationen, 479 KB, auf der
   Warenwirtschafts-Startseite), `maps.googleapis.com` / `maps.gstatic.com` / `fonts.googleapis.com` (nur auf den
   Betriebsseiten unter Einstellungen; der Browser-Schlüssel steht in der Abruf-URL). **Kein** Sentry, kein Gleap,
   kein Tableau-Abruf beim bloßen Öffnen — Tableau erst nach Auswahl einer Ansicht. Die Adresse des Betriebs geht
   beim Öffnen der Betriebsseite als Suchtext an Google (Geocoding).
6. **`/admin/*` ist für das Kundenkonto geroutet, nicht gesperrt.** Drei Seiten leiten auf `/analytics`, zwei
   bleiben leer stehen. Beim Umleiten warf die Anwendung über 50-mal „Minified React error #185" (zu viele
   Aktualisierungen in Folge). Das kann am Seitenwechsel per `pushState` liegen und ist **nicht** als Fehler der
   Oberfläche belegt.
7. **`/settings/pos/configure/{id}` und `/settings/pos/export/{id}`** haben beim Wechsel per `pushState` keinen
   Abruf ausgelöst und zeigten weiter den Inhalt der Zuordnungsseite. Ob sie beim echten Laden etwas holen, ist
   nicht gemessen (die zugehörigen Pfade `pos/connection/{id}` und `pos/export/…` stehen im Bundle).
8. **Zwei Benennungen für Seitensteuerung in einer Oberfläche:** `page_size`/`order_by` (Warenwirtschaft je
   Betrieb), `pageSize` (`erpSettings`), `perPage` (`erp/commodity-groups`), `limit` (Warenkörbe, Unterbenutzer,
   Rezept-Viewer, Kostenrechnung).
9. **Mengen, im Vorbeigehen gesehen** (Betrieb mit `erpId` 7984): 2 Warengruppen, 339 Produktgruppen, 8 Lager.
   Rezept-Viewer: „Karten (0/32)".

## Was der Durchgang nicht sagt

* Nur die neue Oberfläche. `/panel` (Catering, Tagesmenü, Menükarten, Lieferantenportal) und die klassischen
  Seiten (`/recipes/db`, `/menucreator`, `/users`, `/account/subscription`) sind nicht geöffnet.
* Nur Öffnen. Was Filter, Suchfelder, Reiter und Dialoge nachladen, fehlt.
* Detailseiten mit einer Bestell-, Rezept-, Inventur- oder Rollen-ID sind nicht geöffnet.
* Ein Konto, eine Marke.
