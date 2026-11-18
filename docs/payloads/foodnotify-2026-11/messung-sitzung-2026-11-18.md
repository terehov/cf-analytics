# FoodNotify: Messung der internen Schnittstelle mit der Browser-Sitzung, 18.11.2026

Konto Wilma Wunder, angemeldete Sitzung (Cookie) gegen `https://my.foodnotify.com`, **nur GET**, je Pfad
ein Aufruf, rund eine Sekunde Abstand. Kein 429, kein 401. Festgehalten sind Status, Größe, Fehlermeldung
und die **Form** der Antwort (Feldnamen und Typen, keine Werte) sowie je Antwort bis zu drei Beispiel-IDs
zum Verketten.

* **Runde 1:** 204 Pfade — alle als lesend eingestuften GETs aus `messliste-token.csv`, deren Parameter mit
  bekannten IDs füllbar waren (`erpId` 7984, `costCenterId` 7911, `restaurantId` 7846, `connectionId` 2052,
  `userId` 10616), ohne die Pfade mit Abgleich-, Export- oder Warenkorb-Namen.
* **Runde 2:** 55 Detailpfade mit IDs aus Runde 1 (Bestellung, Bestellpositionen, Inventur, Rezept, Produkt,
  Verkauf, Benutzerverwaltung, Kostenanalyse).
* **Nachprobe:** drei Rezepte mit Zutaten aus `link-targets` (Kopf und Zutaten), dazu ein Rezept und
  `link-targets` mit dem Scope-Token gegen `api3`.

Rohdaten: `fn-cookie-messung-1.json`, `fn-cookie-messung-2.json` unter `belege/foodnotify-inventur-2026-11-18/`
(lokal, nicht in Git). Daraus erzeugt: `messung-sitzung-2026-11-18.csv` (258 Pfade, Spalte `runde`) und
`fehlermeldungen-2026-11-18.csv`. Der Durchgang durch die Oberfläche steht in
`menue-durchgang-2026-11-18.md`.

## Ergebnis in Zahlen

| | Runde 1 (204) | Runde 2 (55) |
|---|---|---|
| 200 / 204 | 129 | 45 |
| 405 „No route found … Method Not Allowed" | 40 | 7 |
| 500 | 21 | 2 |
| 404 / 422 (Pflichtparameter fehlt) | 9 | 1 |
| 403 (`Access Denied`, `ROLE_ADMIN`) | 5 | 0 |

Mit dem Scope-Token antworteten von denselben Pfaden 41 (`messung-token-2026-11-18.csv`).

## Was für den Importer zählt

1. **Alle Pfade des Registers antworten weiter mit der Sitzung** (je ein Aufruf): `/api/profile`,
   `/api/core/business/{userId}/restaurants`, `/api/erp/all`, `/api/pos/locations`,
   `/api/{erpId}/shop-order/paginate`, `/api/{erpId}/shop-order/{id}`, `…/change?order_by=name`,
   `/api/erp/stocktakings?erpIds[]=…`, `/api/erp/stocktakings/{uuid}/items`, `/api/recipes?page=N`,
   `/api/recipes/{id}`, `/ingredients`, `/meta`. Nicht gemessen: die Bestellansicht (`/shop/{shopId}/orders/{nr}`).
2. **`/api/recipes` und `/api/recipe-viewer/recipes` liefern dieselbe Antwort** (Seite 1 bytegleich groß,
   gleiche Felder: `id, name, names, imagePath, createdAt, archived, groups, tags`, Hülle `data` + `pagination`
   mit `totalItems`). Dasselbe für `/api/recipes/{id}` und `/api/recipe-viewer/recipes/{id}`. Die Liste führt also
   **`archived` je Eintrag** und eine Gesamtzahl. Ob das schon vor dem Umbau vom 09.11.2026 so war, ist gegen
   `raw.api_antwort` zu prüfen (offener Punkt 4a in `docs/offene-punkte.md`).
3. **Zutaten unverändert:** `/api/recipes/{id}/ingredients` liefert
   `id, kind, name, quantity, unit, baseQuantity, baseUnit, cost, artikelId, supplier, subRecipeId, group`
   — drei Rezepte mit 1, 2 und 6 Zutaten geprüft. **Mit dem Scope-Token dieselben Felder** (ein Rezept, 6 Zutaten,
   `artikelId` bei 5 gesetzt, `kind` = `ingredient`, `product_group`, `sub_recipe`). Ein Rezept ohne Zutaten
   antwortet `{data: []}` mit 200 — leer heißt dort leer, nicht gesperrt.
4. **`/api/pos/mapping/{connectionId}/link-targets` trägt je Rezept `ingredientCount` und `updatedAt`.**
   13.253 Rezepte, davon 158 ohne Zutaten; 17 verschiedene `restaurantId`; `updatedAt` von 19.10.2022 bis
   17.11.2026. Das ist die einzige Stelle mit einem Änderungsdatum je Rezept — Kandidat für den Umlauf (`0134`)
   statt des festen 14-Tage-Takts. **Nicht geprüft**, ob `updatedAt` sich bei jeder Änderung an Zutaten bewegt.
   Die Antwort ist 3,06 MB groß, braucht rund 11 s und hat keine Seiten.
5. **Bestellpositionen (`/change`)** antworten mit der Sitzung (5 Positionen, alle bekannten Felder), mit dem
   Token 403. Das Bestelldetail führt `markedShopOrder.products[]` nur mit `price` und `productId` —
   **kein Ersatz** für `/change`.
6. **Inventuren:** Liste, Kopf und Positionen (`items`, 172 in der Probe, mit `shopArticleId`,
   `theoreticalStockLevelInBaseUnits`, `countedAmountInBaseUnits`, `pricePerBaseUnit`, `storageItems`, `barcodes`)
   antworten mit der Sitzung; mit dem Token 403. Daneben lebt die alte Familie `/api/{erpId}/stocktaking`
   (ganzzahlige IDs, 4 Einträge) weiter.
7. **Verkäufe (`/api/{erpId}/sales`) tragen in der Probe keinen Fehler mehr:** `finishError` ist bei allen
   zehn Einträgen `null`, `sumPrice` eine Zahl; `…/sales/{id}/recipe-sale` liefert Positionen mit Rezept und
   `recipeIngredients`. Am 27.07.2026 standen alle Stichproben auf `saleStatus: init` mit Datenbankfehler
   (`docs/foodnotify-api-inventar.md` §8a). **Hinweis, kein Befund:** ein Betrieb, zehn Zeilen, Werte nicht
   gelesen. Ob der Verkaufsimport repariert ist und die Kostenanalyse damit stimmt, ist eine eigene Messung.
8. **Warenstamm je Betrieb:** `/api/{erpId}/products` liefert je Produkt `ingredient.artikelId`, `shop`,
   `unit`, `packagingQuantity`, `stock{sumAmount, sumPrice, warnAmount, …}`, `storageProducts`, `timeModified`.
   `/api/erp/concrete-products` (ohne `erpId`) liefert `shopProduct{articleId, shopId, shopName}`.

## Technische Auffälligkeiten

1. **Fehlermeldungen geben Interna preis.** 500er nennen Klassen, Dateipfade und Zeilen
   (`/var/www/src/ErpBundle/Service/EntityService/ConcreteProductEntityService.php`, `…/http-kernel/HttpKernel.php
   on line 183`), SQL-Fehler mit `SQLSTATE[22P02]`, fehlende Dienste im Container („You have requested a
   non-existent service `erp.category.icon.normalizer`"), nicht initialisierte Eigenschaften
   (`StocktakingListQuery::$erpIds must not be accessed before initialization`), PHP-Fehler
   („Call to a member function format() on bool" bei `dashboard-mix/{id}?day=` ohne Datum).
2. **`paginate` und `search` werden als ID gelesen.** Bei mehreren Ressourcen
   (`stocktaking`, `resets`, `preproductionConcreteProduct`, `erp/stock-transfer`, `category/search`) landet der
   Pfadteil im Detail-Controller und endet in einem Typ- oder SQL-Fehler statt in 404. Das sind die geerbten
   Zeilen der alten Basisklasse — es gibt diese Pfade nicht.
3. **Fehlende Pflichtparameter kommen uneinheitlich zurück:** 404 „Dieser Wert sollte nicht leer sein"
   (`erp/stock-transfer`, `erp/food-waste`), 422 (`analytics/budget/{id}`, `recipe/ingredients?source=`), 500
   (`erp/stocktakings` ohne `erpIds`, `{erpId}/product`, `{erpId}/dashboard` ohne Seitenangaben).
4. **405 mit `Allow: OPTIONS`** bei 40 Pfaden: die Route kennt nur die CORS-Voranfrage — der Pfad existiert für
   GET nicht. Wo `Allow: PUT` oder `DELETE` steht, gibt es den Pfad nur schreibend
   (`{erpId}/product/paginate`, `…/product-group/paginate`, `…/storage/search`, `…/shop-order/search` → `DELETE`).
   **Diese Pfade nie mit einer anderen Methode nachprobieren.**
5. **Verwaltungsendpunkte sind für das Kundenkonto geroutet und antworten 403** mit
   „The user doesn't have ROLE_ADMIN": `v2/analytics/management/groups`, `v2/billing/management/providers`,
   `v2/erp/catalog-sync/management/syncs`, `supplier/onboardings/reminder-default`.
6. **`/api/pub/version`** (im alten Bundle als GET geführt) antwortet 405.
7. **Zwei Tableau-Wege nebeneinander:** `/api/analytics` (alt) gibt ein `ticket` samt `siteId` heraus,
   `/api/v2/analytics` (neu) nur Host und Ansichten. Beide 200. Das Ticket ist ein kurzlebiges Zugangsmerkmal —
   Antworten dieses Pfads nicht ablegen.
8. **Große Antworten ohne Seiten:** `cost-analysis/ingredients/by-product` 1,4 MB (5.077 Zeilen),
   `erpSettings/restaurants/shared` 0,7 MB, `link-targets` 3,06 MB, `cost-analysis/ingredients/food-waste` 0,34 MB.
9. **Personenbezogenes in Lesepfaden:** `createdByUser`/`updatedByUser` mit Vor- und Nachname an jeder
   Bestellung und Bestellposition, `signature.signer.name` an Inventuren, `subusers` mit Name, E-Mail und
   2FA-Status, `company` mit Ansprechperson. Nichts davon gehört nach `mart` (vgl. S6 in `plan-tpapi-stufe2.md`).
10. **`/app/is-authenticated`** liefert das vollständige Rechteobjekt des Kontos (`roles`, `allowedModules`,
    `masterPermissions{erpGlobalSettings, externalApi, gesoca}`, `posPermissions`, `shopPermissions`,
    `navigation`, `hasRecipeViewerAccess`) — die schnellste Probe, was ein Konto darf.

## Was die Messung nicht sagt

* Ein Konto, eine Marke, ein Betrieb je Parameter. Kein Vergleich Token gegen Sitzung auf Zeilenebene.
* Je Pfad ein Aufruf mit Standardparametern; Filter, Sortierung, Seitengrößen und Datumsgrenzen sind nicht
  durchprobiert.
* 258 lesende Pfadvorlagen mit Parametern, die sich nicht aus den Antworten ergeben (vor allem Catering-
  Ereignisse, Menükarten, Lieferantenportal, Verwaltung), sind nicht gemessen.
* Ausgenommen blieben die 14 GETs mit Wirkung, Downloads, und alles mit Abgleich-, Export- oder
  Warenkorb-Namen (`messliste-token.md`).
* Werte sind nicht gelesen worden — keine Aussage darüber, ob Zahlen stimmen.
